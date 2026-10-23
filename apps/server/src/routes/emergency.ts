import { type EmergencyAccessDto, emergencyGrantWireSchema } from '@tresor/shared';
import { and, eq, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { attachments, type EmergencyRow, emergencyAccess, users } from '../db/schema.js';
import { DAY_MS } from '../lib/dates.js';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { auth, requireAuth } from '../plugins/auth.js';
import { audit } from '../services/audit.js';
import { personalNoteRows, toRecords } from '../services/notes.js';
import { notifyUser } from '../services/notify.js';
import { findUserById, verifyAuthKey } from '../services/users.js';
import { sendCiphertext } from './attachments.js';

const idParams = z.object({ id: z.uuid() });

export function availableAt(row: Pick<EmergencyRow, 'requestedAt' | 'waitDays'>): Date | null {
  return row.requestedAt ? new Date(row.requestedAt.getTime() + row.waitDays * DAY_MS) : null;
}

export function isAccessible(
  row: Pick<EmergencyRow, 'status' | 'requestedAt' | 'waitDays'>,
  now = Date.now(),
) {
  if (row.status === 'granted') return true;
  const at = availableAt(row);
  return row.status === 'requested' && at !== null && at.getTime() <= now;
}

export async function emergencyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  const grantor = alias(users, 'grantor');
  const grantee = alias(users, 'grantee');

  async function list(where: ReturnType<typeof eq>) {
    const rows = await app.db
      .select({
        row: emergencyAccess,
        grantor: { id: grantor.id, username: grantor.username, displayName: grantor.displayName },
        grantee: { id: grantee.id, username: grantee.username, displayName: grantee.displayName },
      })
      .from(emergencyAccess)
      .innerJoin(grantor, eq(grantor.id, emergencyAccess.grantorId))
      .innerJoin(grantee, eq(grantee.id, emergencyAccess.granteeId))
      .where(where);
    return rows.map(({ row, grantor: from, grantee: to }): EmergencyAccessDto => {
      const at = availableAt(row);
      return {
        id: row.id,
        grantor: from,
        grantee: to,
        waitDays: row.waitDays,
        status: row.status,
        requestedAt: row.requestedAt?.toISOString() ?? null,
        availableAt: row.status === 'requested' && at ? at.toISOString() : null,
        accessible: isAccessible(row),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async function loadRow(id: string, userId: string) {
    const [row] = await app.db
      .select()
      .from(emergencyAccess)
      .where(
        and(
          eq(emergencyAccess.id, id),
          or(eq(emergencyAccess.grantorId, userId), eq(emergencyAccess.granteeId, userId)),
        ),
      );
    if (!row) throw notFound('Emergency access not found');
    return row;
  }

  app.get('/emergency', async (req) => {
    const { user } = auth(req);
    return {
      granted: await list(eq(emergencyAccess.grantorId, user.id)),
      received: await list(eq(emergencyAccess.granteeId, user.id)),
    };
  });

  /**
   * Grantor names a trusted contact. The grantor's browser sealed their account key to the contact's public
   * key; the server hands it out only once the waiting period is over (or the grantor approved).
   */
  app.post('/emergency', async (req, reply) => {
    const { user } = auth(req);
    const input = emergencyGrantWireSchema.parse(req.body);
    // This hands the account key to someone else – confirm with the password, not just the session.
    if (!verifyAuthKey(app, user, input.authKey)) throw unauthorized('INVALID_CREDENTIALS', 'Wrong password');
    const target = await findUserById(app.db, input.granteeId);
    if (!target || target.disabled || target.id === user.id) throw notFound('User not found');
    if (!target.publicKey) {
      throw new AppError(
        409,
        'NO_KEYS',
        'This user has to sign in once before they can be a trusted contact',
      );
    }
    const inserted = await app.db
      .insert(emergencyAccess)
      .values({
        id: input.id,
        grantorId: user.id,
        granteeId: target.id,
        waitDays: input.waitDays,
        keyWrapped: input.keyWrapped,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) throw conflict('CONFLICT', 'Already a trusted contact');
    await audit(app, req, {
      action: 'emergency.grant',
      target: target.username,
      meta: { waitDays: input.waitDays },
    });
    reply.code(201);
    return { ok: true };
  });

  app.patch('/emergency/:id', async (req) => {
    const { user } = auth(req);
    const { id } = idParams.parse(req.params);
    const { waitDays } = z.object({ waitDays: z.number().int().min(1).max(90) }).parse(req.body);
    const row = await loadRow(id, user.id);
    if (row.grantorId !== user.id) throw forbidden();
    await app.db.update(emergencyAccess).set({ waitDays }).where(eq(emergencyAccess.id, id));
    return { ok: true };
  });

  /** Grantor revokes, or grantee declines – both remove the entry. */
  app.delete('/emergency/:id', async (req) => {
    const { user } = auth(req);
    const { id } = idParams.parse(req.params);
    await loadRow(id, user.id);
    await app.db.delete(emergencyAccess).where(eq(emergencyAccess.id, id));
    await audit(app, req, { action: 'emergency.revoke', target: id });
    return { ok: true };
  });

  app.post('/emergency/:id/request', async (req) => {
    const { user } = auth(req);
    const { id } = idParams.parse(req.params);
    const row = await loadRow(id, user.id);
    if (row.granteeId !== user.id) throw forbidden();
    if (row.status !== 'idle') return { ok: true };
    await app.db
      .update(emergencyAccess)
      .set({ status: 'requested', requestedAt: new Date() })
      .where(eq(emergencyAccess.id, id));
    await audit(app, req, { action: 'emergency.request', target: id });
    const owner = await findUserById(app.db, row.grantorId);
    if (owner)
      void notifyUser(app, owner, 'emergencyRequested', { grantee: user.displayName, days: row.waitDays });
    return { ok: true };
  });

  app.post('/emergency/:id/:decision', async (req) => {
    const { user } = auth(req);
    const { id, decision } = z
      .object({ id: z.uuid(), decision: z.enum(['approve', 'reject']) })
      .parse(req.params);
    const row = await loadRow(id, user.id);
    if (row.grantorId !== user.id) throw forbidden();
    const approve = decision === 'approve';
    await app.db
      .update(emergencyAccess)
      .set(
        approve
          ? { status: 'granted', requestedAt: row.requestedAt ?? new Date() }
          : { status: 'idle', requestedAt: null },
      )
      .where(eq(emergencyAccess.id, id));
    await audit(app, req, { action: approve ? 'emergency.approve' : 'emergency.reject', target: id });
    const contact = await findUserById(app.db, row.granteeId);
    if (contact)
      void notifyUser(app, contact, approve ? 'emergencyGranted' : 'emergencyRejected', {
        grantor: user.displayName,
      });
    return { ok: true };
  });

  /** An emergency entry the signed-in contact can open right now (403 otherwise). */
  async function openGrant(req: FastifyRequest, id: string) {
    const { user } = auth(req);
    const row = await loadRow(id, user.id);
    if (row.granteeId !== user.id || !isAccessible(row)) throw forbidden();
    return row;
  }

  /** The grantor's personal entries (ciphertext) plus the sealed account key – decrypted in the browser. */
  app.get('/emergency/:id/notes', async (req) => {
    const { id } = idParams.parse(req.params);
    const row = await openGrant(req, id);
    if (row.status === 'requested') {
      await app.db.update(emergencyAccess).set({ status: 'granted' }).where(eq(emergencyAccess.id, id));
    }
    const rows = await personalNoteRows(app.db, row.grantorId);
    const notes = await toRecords(app.db, rows, async () => false);
    await audit(app, req, { action: 'emergency.view', target: id });
    return { notes, keyWrapped: row.keyWrapped };
  });

  app.get('/emergency/:id/notes/:noteId/attachments/:aid', async (req, reply) => {
    const { id, noteId, aid } = z.object({ id: z.uuid(), noteId: z.uuid(), aid: z.uuid() }).parse(req.params);
    const row = await openGrant(req, id);
    const owned = (await personalNoteRows(app.db, row.grantorId)).some((n) => n.id === noteId);
    const [file] = await app.db
      .select({ data: attachments.data })
      .from(attachments)
      .where(and(eq(attachments.id, aid), eq(attachments.noteId, noteId)));
    if (!file || !owned) throw notFound('Attachment not found');
    return sendCiphertext(reply, file.data);
  });
}
