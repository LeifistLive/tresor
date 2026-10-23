import { randomUUID } from 'node:crypto';
import {
  type AdminStatsDto,
  type AdminUserDto,
  type AuditEntryDto,
  createUserSchema,
  type NoteType,
  resetUserSchema,
  updateUserSchema,
} from '@tresor/shared';
import { and, count, desc, eq, gte, isNull, like, lt, or, sql, sum } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryRows } from '../db/client.js';
import {
  auditLog,
  emergencyAccess,
  notes,
  passkeys,
  sessions,
  templates,
  type UserRow,
  users,
} from '../db/schema.js';
import { bucketByDay, DAY_MS } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { auth, requireAdmin } from '../plugins/auth.js';
import { audit } from '../services/audit.js';
import { findUserById, findUserByUsername, temporaryCredentialColumns } from '../services/users.js';
import { detachUserFromVaults } from '../services/vaults.js';
import { VERSION } from '../version.js';
import { emptyTypeCounts, statsQuery } from './stats.js';

const idParams = z.object({ id: z.uuid() });

function toAdminUser(u: UserRow, noteCount: number): AdminUserDto {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    disabled: u.disabled,
    totpEnabled: u.totpEnabled,
    mustChangePassword: u.mustChangePassword,
    noteCount,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  const activeAdminCount = async () => {
    const [r] = await app.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.disabled, false)));
    return r?.n ?? 0;
  };

  const loadTarget = async (id: string) => {
    const target = await findUserById(app.db, id);
    if (!target) throw notFound('User not found');
    return target;
  };

  app.get('/admin/stats', async (req): Promise<AdminStatsDto> => {
    const { tz } = statsQuery.parse(req.query);
    const now = Date.now();
    const since = new Date(now - 15 * DAY_MS);

    const allUsers = await app.db.select().from(users);
    const noteAgg = await app.db
      .select({
        userId: notes.userId,
        type: notes.type,
        trashed: sql<boolean>`${notes.deletedAt} is not null`,
        n: count(),
        bytes: sum(notes.sizeBytes),
      })
      .from(notes)
      .groupBy(notes.userId, notes.type, sql`${notes.deletedAt} is not null`);

    const byType = emptyTypeCounts();
    const perUser = new Map<string, number>();
    let total = 0;
    let trashed = 0;
    let storageBytes = 0;
    for (const row of noteAgg) {
      const n = Number(row.n);
      storageBytes += Number(row.bytes ?? 0);
      if (row.trashed) {
        trashed += n;
        continue;
      }
      total += n;
      if (row.type in byType) byType[row.type as NoteType] += n;
      perUser.set(row.userId, (perUser.get(row.userId) ?? 0) + n);
    }

    const loginEvents = await app.db
      .select({
        action: auditLog.action,
        createdAt: auditLog.createdAt,
        ip: auditLog.ip,
        actor: auditLog.actor,
      })
      .from(auditLog)
      .where(
        and(
          gte(auditLog.createdAt, since),
          or(eq(auditLog.action, 'auth.login'), eq(auditLog.action, 'auth.login_failed')),
        ),
      )
      .orderBy(desc(auditLog.createdAt));
    const successes = loginEvents.filter((e) => e.action === 'auth.login');
    const failures = loginEvents.filter((e) => e.action === 'auth.login_failed');
    const inWindow = (d: Date) => now - d.getTime() <= 14 * DAY_MS;

    const [sessionCount] = await app.db
      .select({ n: count() })
      .from(sessions)
      .where(gte(sessions.expiresAt, new Date(now)));

    let databaseBytes: number | null = null;
    let postgresVersion: string | null = null;
    try {
      const [info] = await queryRows<{ size: string | number; version: string }>(
        app.db,
        sql`select pg_database_size(current_database()) as size, current_setting('server_version') as version`,
      );
      databaseBytes = info ? Number(info.size) : null;
      postgresVersion = info?.version ?? null;
    } catch (err) {
      req.log.warn({ err }, 'could not read database size');
    }

    const lastFailed = failures[0];
    return {
      users: {
        total: allUsers.length,
        admins: allUsers.filter((u) => u.role === 'admin').length,
        disabled: allUsers.filter((u) => u.disabled).length,
        pendingPasswordChange: allUsers.filter((u) => u.mustChangePassword).length,
      },
      notes: { total, trashed, storageBytes, byType },
      logins: bucketByDay(
        successes.map((e) => e.createdAt),
        14,
        tz,
        new Date(now),
      ),
      successfulLogins14d: successes.filter((e) => inWindow(e.createdAt)).length,
      failedLogins14d: failures.filter((e) => inWindow(e.createdAt)).length,
      lastFailedLogin: lastFailed
        ? { at: lastFailed.createdAt.toISOString(), ip: lastFailed.ip, username: lastFailed.actor }
        : null,
      activeSessions: sessionCount?.n ?? 0,
      notesPerUser: allUsers
        .map((u) => ({ username: u.username, displayName: u.displayName, count: perUser.get(u.id) ?? 0 }))
        .sort((a, b) => b.count - a.count),
      system: {
        version: VERSION,
        uptimeSeconds: Math.floor((now - app.startedAt) / 1000),
        databaseBytes,
        postgresVersion,
      },
    };
  });

  app.get('/admin/users', async () => {
    const all = await app.db.select().from(users).orderBy(users.createdAt);
    const counts = await app.db
      .select({ userId: notes.userId, n: count() })
      .from(notes)
      .where(isNull(notes.deletedAt))
      .groupBy(notes.userId);
    const map = new Map(counts.map((c) => [c.userId, Number(c.n)]));
    return { users: all.map((u) => toAdminUser(u, map.get(u.id) ?? 0)) };
  });

  /**
   * Creates an account with a temporary password. It has no keys until the user signs in and chooses their
   * own password – their browser then creates the keys, so the admin never knows anything that unlocks them.
   */
  app.post('/admin/users', async (req, reply) => {
    const input = createUserSchema.parse(req.body);
    if (await findUserByUsername(app.db, input.username))
      throw conflict('CONFLICT', 'Username already taken');
    const id = randomUUID();
    const [created] = await app.db
      .insert(users)
      .values({
        id,
        username: input.username,
        displayName: input.displayName,
        role: input.role,
        ...(await temporaryCredentialColumns(app, id, input.password)),
      })
      .returning();
    await audit(app, req, {
      action: 'admin.user_create',
      target: created!.username,
      meta: { role: input.role },
    });
    reply.code(201);
    return { user: toAdminUser(created!, 0) };
  });

  app.patch('/admin/users/:id', async (req) => {
    const me = auth(req).user;
    const { id } = idParams.parse(req.params);
    const input = updateUserSchema.parse(req.body);
    const target = await loadTarget(id);

    if (id === me.id && (input.disabled === true || input.role === 'user')) {
      throw badRequest('BAD_REQUEST', 'You cannot disable or demote yourself');
    }
    const losesAdmin =
      target.role === 'admin' && !target.disabled && (input.role === 'user' || input.disabled === true);
    if (losesAdmin && (await activeAdminCount()) <= 1)
      throw conflict('LAST_ADMIN', 'At least one admin is required');

    const [updated] = await app.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (input.disabled) await app.db.delete(sessions).where(eq(sessions.userId, id));
    await audit(app, req, { action: 'admin.user_update', target: target.username, meta: input });
    const [c] = await app.db
      .select({ n: count() })
      .from(notes)
      .where(and(eq(notes.userId, id), isNull(notes.deletedAt)));
    return { user: toAdminUser(updated!, c?.n ?? 0) };
  });

  /**
   * Last resort when a user lost both password and recovery key. Their encrypted notes cannot be
   * recovered by anyone, so they are deleted and the account starts over with a temporary password.
   */
  app.post('/admin/users/:id/reset', async (req) => {
    const me = auth(req).user;
    const { id } = idParams.parse(req.params);
    const { password } = resetUserSchema.parse(req.body);
    if (id === me.id) throw badRequest('BAD_REQUEST', 'Use the recovery flow for your own account');
    const target = await loadTarget(id);

    const temporary = await temporaryCredentialColumns(app, id, password);
    const deleted = await app.db.transaction(async (tx) => {
      // Everything bound to the old key is unusable now: personal entries, templates, passkeys,
      // shared-vault memberships and emergency access (in both directions).
      const removed = await tx
        .delete(notes)
        .where(and(eq(notes.userId, id), isNull(notes.vaultId)))
        .returning({ id: notes.id });
      await detachUserFromVaults(tx, id);
      await tx.delete(templates).where(eq(templates.userId, id));
      await tx.delete(passkeys).where(eq(passkeys.userId, id));
      await tx
        .delete(emergencyAccess)
        .where(or(eq(emergencyAccess.grantorId, id), eq(emergencyAccess.granteeId, id)));
      await tx.delete(sessions).where(eq(sessions.userId, id));
      await tx
        .update(users)
        .set({ ...temporary, updatedAt: new Date() })
        .where(eq(users.id, id));
      return removed.length;
    });
    await audit(app, req, {
      action: 'admin.user_reset',
      target: target.username,
      meta: { deletedNotes: deleted },
    });
    const fresh = await loadTarget(id);
    return { user: toAdminUser(fresh, 0), deletedNotes: deleted };
  });

  app.post('/admin/users/:id/logout', async (req) => {
    const { id } = idParams.parse(req.params);
    const target = await loadTarget(id);
    const removed = await app.db
      .delete(sessions)
      .where(eq(sessions.userId, id))
      .returning({ id: sessions.id });
    await audit(app, req, {
      action: 'admin.user_logout',
      target: target.username,
      meta: { count: removed.length },
    });
    return { revoked: removed.length };
  });

  app.delete('/admin/users/:id', async (req) => {
    const me = auth(req).user;
    const { id } = idParams.parse(req.params);
    if (id === me.id) throw badRequest('BAD_REQUEST', 'You cannot delete yourself');
    const target = await loadTarget(id);
    if (target.role === 'admin' && !target.disabled && (await activeAdminCount()) <= 1) {
      throw conflict('LAST_ADMIN', 'At least one admin is required');
    }
    await app.db.transaction(async (tx) => {
      // Shared vaults keep their entries; another member takes them over.
      await detachUserFromVaults(tx, id);
      await tx.delete(users).where(eq(users.id, id));
    });
    await audit(app, req, { action: 'admin.user_delete', target: target.username });
    return { ok: true };
  });

  app.get('/admin/audit', async (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        before: z.iso.datetime({ offset: true }).optional(),
        action: z.string().max(40).optional(),
        user: z.string().max(64).optional(),
      })
      .parse(req.query);
    const filters = [
      q.before ? lt(auditLog.createdAt, new Date(q.before)) : undefined,
      q.action ? like(auditLog.action, `${q.action.replace(/[%_]/g, '')}%`) : undefined,
      q.user ? eq(auditLog.actor, q.user.toLowerCase()) : undefined,
    ].filter(Boolean);
    const rows = await app.db
      .select()
      .from(auditLog)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(q.limit + 1);
    const entries: AuditEntryDto[] = rows.slice(0, q.limit).map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor,
      target: r.target,
      ip: r.ip,
      meta: r.meta ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { entries, hasMore: rows.length > q.limit };
  });
}
