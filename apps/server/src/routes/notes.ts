import {
  type NoteVersionRecordDto,
  noteCreateWireSchema,
  noteImportSchema,
  noteMoveSchema,
  noteUpdateWireSchema,
} from '@tresor/shared';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { attachments, type NoteRow, notes, noteVersions, users } from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { auth, requireAuth } from '../plugins/auth.js';
import { access, lockVault, lockVaultKey } from '../services/access.js';
import { audit } from '../services/audit.js';
import {
  accessibleNoteRows,
  archiveVersion,
  asNoteType,
  getNoteRow,
  sameIds,
  toRecords,
} from '../services/notes.js';

const idParams = z.object({ id: z.uuid() });
const versionParams = z.object({ id: z.uuid(), vid: z.uuid() });

const readOnly = () => new AppError(403, 'READ_ONLY', 'You can only read this entry');
const stale = () =>
  new AppError(409, 'STALE', 'The entry was changed in the meantime – reload and try again');

/** Unique-violation of a client-chosen id. */
function isDuplicate(err: unknown): boolean {
  const code =
    (err as { code?: string; cause?: { code?: string } })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}

export async function noteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Loads an entry the user can access (404 otherwise). */
  async function load(req: FastifyRequest, id: string) {
    const row = await getNoteRow(app.db, id);
    const rights = row ? await access(app, req).forNote(row) : null;
    if (!row || !rights) throw notFound('Note not found');
    return { row, ...rights };
  }

  async function record(req: FastifyRequest, row: NoteRow) {
    const acc = access(app, req);
    const [note] = await toRecords(app.db, [row], async (r) => (await acc.forNote(r))?.canEdit ?? null);
    if (!note) throw notFound('Note not found');
    return note;
  }

  app.get('/notes', async (req) => {
    const { status } = z.object({ status: z.enum(['active', 'trash']).default('active') }).parse(req.query);
    const acc = access(app, req);
    const rows = await accessibleNoteRows(app.db, acc, status);
    return {
      notes: await toRecords(app.db, rows, async (r) => (await acc.forNote(r))?.canEdit ?? null),
      vaultKeys: await acc.vaultKeys(),
    };
  });

  app.get('/notes/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const { row } = await load(req, id);
    return { note: await record(req, row) };
  });

  app.post('/notes', async (req, reply) => {
    const { user } = auth(req);
    const input = noteCreateWireSchema.parse(req.body);
    if (input.vaultId) await access(app, req).requireVault(input.vaultId, 'editor');
    let row: NoteRow;
    try {
      row = await app.db.transaction(async (tx) => {
        if (input.vaultId) await lockVaultKey(tx, input.vaultId, input.vaultKeyVersion);
        const [created] = await tx
          .insert(notes)
          .values({
            id: input.id,
            userId: user.id,
            vaultId: input.vaultId,
            type: input.type,
            payload: input.payload,
            pinned: input.pinned,
            expiresAt: input.expiresAt,
            sizeBytes: input.payload.length,
            updatedBy: user.id,
          })
          .returning();
        return created!;
      });
    } catch (err) {
      if (isDuplicate(err)) throw conflict('CONFLICT', 'Entry id already exists');
      throw err;
    }
    await audit(app, req, {
      action: 'note.create',
      target: row.id,
      meta: { type: input.type, ...(input.vaultId ? { vaultId: input.vaultId } : {}) },
    });
    reply.code(201);
    return { note: await record(req, row) };
  });

  app.patch('/notes/:id', async (req) => {
    const { user } = auth(req);
    const { id } = idParams.parse(req.params);
    const patch = noteUpdateWireSchema.parse(req.body);
    const { row, canEdit } = await load(req, id);
    if (!canEdit) throw readOnly();

    const contentChanged =
      patch.payload !== undefined || (patch.type !== undefined && patch.type !== row.type);
    if (patch.type !== undefined && patch.payload === undefined && patch.type !== row.type) {
      // The type is part of the encrypted field sanitising – changing it requires a new payload.
      throw new AppError(400, 'VALIDATION', 'Changing the type requires a new payload');
    }
    const set: Partial<typeof notes.$inferInsert> = {};
    if (contentChanged) {
      Object.assign(set, {
        payload: patch.payload,
        sizeBytes: patch.payload!.length,
        type: patch.type ?? row.type,
        updatedAt: new Date(),
        updatedBy: user.id,
      });
    }
    if (patch.pinned !== undefined) set.pinned = patch.pinned;
    if (patch.expiresAt !== undefined && patch.expiresAt !== row.expiresAt) {
      Object.assign(set, { expiresAt: patch.expiresAt, remindedAt: null });
    }

    if (Object.keys(set).length > 0) {
      await app.db.transaction(async (tx) => {
        if (contentChanged && row.vaultId) await lockVaultKey(tx, row.vaultId, patch.vaultKeyVersion);
        const current = (await getNoteRow(tx, id))!;
        if (contentChanged) await archiveVersion(tx, current);
        await tx.update(notes).set(set).where(eq(notes.id, id));
      });
      if (contentChanged)
        await audit(app, req, { action: 'note.update', target: id, meta: { type: set.type } });
    }
    return { note: await record(req, (await getNoteRow(app.db, id))!) };
  });

  /**
   * Moves an entry between the personal vault and shared vaults. The browser re-encrypted the payload, all
   * versions and the attachment metadata with the target key; the server swaps them in atomically.
   */
  app.post('/notes/:id/move', { bodyLimit: app.config.IMPORT_MAX_MB * 1024 * 1024 }, async (req) => {
    const { user } = auth(req);
    const { id } = idParams.parse(req.params);
    const input = noteMoveSchema.parse(req.body);
    const { row, canEdit } = await load(req, id);
    if (!canEdit) throw readOnly();
    if (input.vaultId === row.vaultId) throw new AppError(400, 'BAD_REQUEST', 'Entry is already there');
    if (input.vaultId) await access(app, req).requireVault(input.vaultId, 'editor');

    await app.db.transaction(async (tx) => {
      if (input.vaultId) await lockVaultKey(tx, input.vaultId, input.vaultKeyVersion);
      const current = (await getNoteRow(tx, id))!;
      if (current.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) throw stale();
      const versions = await tx
        .select({ id: noteVersions.id })
        .from(noteVersions)
        .where(eq(noteVersions.noteId, id));
      const files = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(eq(attachments.noteId, id));
      if (!sameIds(versions, input.versions) || !sameIds(files, input.attachments)) throw stale();

      await tx
        .update(notes)
        .set({
          payload: input.payload,
          vaultId: input.vaultId,
          // Moving into the personal vault makes the mover the owner.
          ...(input.vaultId ? {} : { userId: user.id }),
        })
        .where(eq(notes.id, id));
      for (const v of input.versions) {
        await tx.update(noteVersions).set({ payload: v.payload }).where(eq(noteVersions.id, v.id));
      }
      for (const f of input.attachments) {
        await tx.update(attachments).set({ metaEnc: f.metaEnc }).where(eq(attachments.id, f.id));
      }
    });
    await audit(app, req, { action: 'note.move', target: id, meta: { to: input.vaultId ?? 'personal' } });
    return { note: await record(req, (await getNoteRow(app.db, id))!) };
  });

  /** Moves a note to the trash, or deletes it for good with `?permanent=true`. */
  app.delete('/notes/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const { permanent } = z.object({ permanent: z.stringbool().default(false) }).parse(req.query);
    const { canEdit } = await load(req, id);
    if (!canEdit) throw readOnly();
    if (permanent) {
      await app.db.delete(notes).where(eq(notes.id, id));
      await audit(app, req, { action: 'note.delete', target: id });
    } else {
      await app.db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, id));
      await audit(app, req, { action: 'note.trash', target: id });
    }
    return { ok: true };
  });

  app.post('/notes/:id/restore', async (req) => {
    const { id } = idParams.parse(req.params);
    const { canEdit } = await load(req, id);
    if (!canEdit) throw readOnly();
    const [row] = await app.db.update(notes).set({ deletedAt: null }).where(eq(notes.id, id)).returning();
    await audit(app, req, { action: 'note.restore', target: id });
    return { note: await record(req, row!) };
  });

  app.delete('/trash', async (req) => {
    const acc = access(app, req);
    const rows = await accessibleNoteRows(app.db, acc, 'trash', isNotNull(notes.deletedAt));
    const ids: string[] = [];
    for (const row of rows) if ((await acc.forNote(row))?.canEdit) ids.push(row.id);
    if (ids.length) await app.db.delete(notes).where(and(inArray(notes.id, ids), isNotNull(notes.deletedAt)));
    await audit(app, req, { action: 'trash.empty', meta: { count: ids.length } });
    return { deleted: ids.length };
  });

  /** Bulk insert of personal entries encrypted in the browser (import of export files). */
  app.post(
    '/notes/import',
    {
      bodyLimit: app.config.IMPORT_MAX_MB * 1024 * 1024,
      config: { rateLimit: { max: 120, timeWindow: '5 minutes' } },
    },
    async (req) => {
      const { user } = auth(req);
      const input = noteImportSchema.parse(req.body);
      try {
        await app.db.transaction(async (tx) => {
          await tx.insert(notes).values(
            input.notes.map((n) => ({
              id: n.id,
              userId: user.id,
              vaultId: null,
              type: n.type,
              payload: n.payload,
              pinned: n.pinned,
              expiresAt: n.expiresAt,
              sizeBytes: n.payload.length,
              updatedBy: user.id,
              ...(n.createdAt ? { createdAt: new Date(n.createdAt) } : {}),
              ...(n.updatedAt ? { updatedAt: new Date(n.updatedAt) } : {}),
            })),
          );
        });
      } catch (err) {
        if (isDuplicate(err)) throw conflict('CONFLICT', 'Entry id already exists');
        throw err;
      }
      await audit(app, req, { action: 'data.import', meta: { imported: input.notes.length } });
      return { imported: input.notes.length };
    },
  );

  // --- Version history ------------------------------------------------------------------------------

  app.get('/notes/:id/versions', async (req) => {
    const { id } = idParams.parse(req.params);
    await load(req, id);
    const rows = await app.db
      .select({ version: noteVersions, author: users.username })
      .from(noteVersions)
      .leftJoin(users, eq(noteVersions.authorId, users.id))
      .where(eq(noteVersions.noteId, id))
      .orderBy(desc(noteVersions.savedAt));
    const versions: NoteVersionRecordDto[] = rows.map(({ version, author }) => ({
      id: version.id,
      type: asNoteType(version.type),
      payload: version.payload,
      savedAt: version.savedAt.toISOString(),
      author,
    }));
    return { versions };
  });

  app.post('/notes/:id/versions/:vid/restore', async (req) => {
    const { user } = auth(req);
    const { id, vid } = versionParams.parse(req.params);
    const { row, canEdit } = await load(req, id);
    if (!canEdit) throw readOnly();
    await app.db.transaction(async (tx) => {
      // Copies ciphertext as-is; the vault lock keeps a concurrent key rotation from interleaving.
      if (row.vaultId) await lockVault(tx, row.vaultId);
      const [version] = await tx
        .select()
        .from(noteVersions)
        .where(and(eq(noteVersions.id, vid), eq(noteVersions.noteId, id)));
      if (!version) throw notFound('Version not found');
      const current = (await getNoteRow(tx, id))!;
      await archiveVersion(tx, current);
      await tx
        .update(notes)
        .set({ payload: version.payload, type: version.type, updatedAt: new Date(), updatedBy: user.id })
        .where(eq(notes.id, id));
    });
    await audit(app, req, { action: 'note.version_restore', target: id });
    return { note: await record(req, (await getNoteRow(app.db, id))!) };
  });
}
