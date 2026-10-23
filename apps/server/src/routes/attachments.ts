import type { MultipartFile } from '@fastify/multipart';
import { attachmentFieldsSchema } from '@tresor/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { attachments, notes } from '../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { auth, requireAuth } from '../plugins/auth.js';
import { access, lockVaultKey } from '../services/access.js';
import { audit } from '../services/audit.js';
import { getNoteRow } from '../services/notes.js';

const params = z.object({ id: z.uuid(), aid: z.uuid() });

/** version byte + IV + GCM tag around the plaintext. */
const ENVELOPE_OVERHEAD = 1 + 12 + 16;

const readOnly = () => new AppError(403, 'READ_ONLY', 'You can only read this entry');

/** Sends stored ciphertext; the browser decrypts it. Never rendered by the browser directly. */
export function sendCiphertext(reply: FastifyReply, data: Buffer) {
  reply
    .header('content-type', 'application/octet-stream')
    .header('content-disposition', 'attachment; filename="encrypted.bin"')
    .header('cache-control', 'private, no-store')
    .header('content-security-policy', "default-src 'none'; sandbox");
  return data;
}

function field(file: MultipartFile, name: string): string | undefined {
  const f = file.fields[name];
  const one = Array.isArray(f) ? f[0] : f;
  return one && 'value' in one && typeof one.value === 'string' ? one.value : undefined;
}

export async function attachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const maxBytes = app.config.ATTACHMENT_MAX_MB * 1024 * 1024 + ENVELOPE_OVERHEAD;
  const tooLarge = () =>
    new AppError(413, 'TOO_LARGE', `Files may be at most ${app.config.ATTACHMENT_MAX_MB} MB`);

  async function noteAccess(req: FastifyRequest, noteId: string) {
    const row = await getNoteRow(app.db, noteId);
    const rights = row ? await access(app, req).forNote(row) : null;
    if (!row || !rights) throw notFound('Note not found');
    return { row, ...rights };
  }

  /** Reads `id`, `meta`, `keyVersion` (sent before the file) and the encrypted file content. */
  async function readUpload(req: FastifyRequest) {
    const file = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 5 } });
    if (!file) throw badRequest('BAD_REQUEST', 'No file uploaded');
    const fields = attachmentFieldsSchema.parse({
      id: field(file, 'id'),
      meta: field(file, 'meta'),
      keyVersion: field(file, 'keyVersion'),
    });
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch {
      throw tooLarge();
    }
    if (file.file.truncated) throw tooLarge();
    if (data.length < ENVELOPE_OVERHEAD || data[0] !== 1)
      throw badRequest('BAD_REQUEST', 'Not an encrypted file');
    return { ...fields, data };
  }

  app.post('/notes/:id/attachments', async (req, reply) => {
    const { user } = auth(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { row, canEdit } = await noteAccess(req, id);
    if (!canEdit) throw readOnly();
    const upload = await readUpload(req);
    const size = upload.data.length - ENVELOPE_OVERHEAD;

    let createdAt: Date;
    try {
      createdAt = await app.db.transaction(async (tx) => {
        if (row.vaultId) await lockVaultKey(tx, row.vaultId, upload.keyVersion);
        const [created] = await tx
          .insert(attachments)
          .values({
            id: upload.id,
            noteId: id,
            metaEnc: upload.meta,
            data: upload.data,
            sizeBytes: size,
            createdBy: user.id,
          })
          .returning({ createdAt: attachments.createdAt });
        await tx.update(notes).set({ updatedAt: new Date(), updatedBy: user.id }).where(eq(notes.id, id));
        return created!.createdAt;
      });
    } catch (err) {
      if (
        (err as { code?: string }).code === '23505' ||
        (err as { cause?: { code?: string } }).cause?.code === '23505'
      )
        throw conflict('CONFLICT', 'Attachment id already exists');
      throw err;
    }
    await audit(app, req, { action: 'attachment.add', target: id, meta: { size } });
    reply.code(201);
    return { attachment: { id: upload.id, metaEnc: upload.meta, size, createdAt: createdAt.toISOString() } };
  });

  app.get('/notes/:id/attachments/:aid', async (req, reply) => {
    const { id, aid } = params.parse(req.params);
    await noteAccess(req, id);
    const [row] = await app.db
      .select({ data: attachments.data })
      .from(attachments)
      .where(and(eq(attachments.id, aid), eq(attachments.noteId, id)));
    if (!row) throw notFound('Attachment not found');
    return sendCiphertext(reply, row.data);
  });

  app.delete('/notes/:id/attachments/:aid', async (req) => {
    const { id, aid } = params.parse(req.params);
    const { canEdit } = await noteAccess(req, id);
    if (!canEdit) throw readOnly();
    const deleted = await app.db
      .delete(attachments)
      .where(and(eq(attachments.id, aid), eq(attachments.noteId, id)))
      .returning({ id: attachments.id });
    if (deleted.length === 0) throw notFound('Attachment not found');
    await audit(app, req, { action: 'attachment.delete', target: id });
    return { ok: true };
  });
}
