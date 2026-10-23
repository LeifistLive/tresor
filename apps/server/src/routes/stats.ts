import { NOTE_TYPES, type NoteType, type ServerStatsDto } from '@tresor/shared';
import { and, count, eq, gte, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLog, passkeys } from '../db/schema.js';
import { bucketByDay, DAY_MS, daysSince, isValidTimeZone } from '../lib/dates.js';
import { auth, requireAuth } from '../plugins/auth.js';
import { access } from '../services/access.js';
import { NOTE_ACTIVITY_ACTIONS } from '../services/audit.js';
import { accessibleNoteRows } from '../services/notes.js';

export const statsQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => [7, 14, 30, 90].includes(d))
    .default(30),
  tz: z.string().max(64).refine(isValidTimeZone).default('UTC'),
});

export function emptyTypeCounts(): Record<NoteType, number> {
  return Object.fromEntries(NOTE_TYPES.map((t) => [t, 0])) as Record<NoteType, number>;
}

export async function statsRoutes(app: FastifyInstance) {
  /** Metadata-only statistics; tags, titles and expiring entries are computed by the browser. */
  app.get('/stats', { preHandler: requireAuth }, async (req): Promise<ServerStatsDto> => {
    const { user } = auth(req);
    const { days, tz } = statsQuery.parse(req.query);
    const now = Date.now();
    const rows = await accessibleNoteRows(app.db, access(app, req), 'all');
    const active = rows.filter((r) => r.deletedAt === null);
    const byType = emptyTypeCounts();
    for (const r of active) if (r.type in byType) byType[r.type as NoteType]++;

    const [pk] = await app.db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, user.id));
    const passkeyCount = Number(pk?.n ?? 0);

    const events = await app.db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, user.id),
          inArray(auditLog.action, NOTE_ACTIVITY_ACTIONS),
          gte(auditLog.createdAt, new Date(now - (days + 1) * DAY_MS)),
        ),
      );

    const passwordAgeDays = daysSince(user.passwordChangedAt, now) ?? 0;
    const lastExportDays = daysSince(user.lastExportAt, now);
    const security = {
      totpEnabled: user.totpEnabled,
      hasRecoveryKey: user.dekRecoveryWrapped !== null,
      autoLockEnabled: user.autoLockMinutes > 0 && user.autoLockMinutes <= 60,
      passwordAgeDays,
      lastExportDays,
    };
    const score =
      (security.totpEnabled || passkeyCount > 0 ? 30 : 0) +
      (security.hasRecoveryKey ? 25 : 0) +
      (security.autoLockEnabled ? 15 : 0) +
      (passwordAgeDays <= 365 ? 15 : 0) +
      (lastExportDays !== null && lastExportDays <= 90 ? 15 : 0);

    return {
      total: active.length,
      pinned: active.filter((r) => r.pinned).length,
      trashed: rows.length - active.length,
      byType,
      createdLast7Days: active.filter((r) => now - r.createdAt.getTime() <= 7 * DAY_MS).length,
      activity: bucketByDay(
        events.map((e) => e.createdAt),
        days,
        tz,
        new Date(now),
      ),
      storageBytes: active.reduce((sum, r) => sum + r.sizeBytes, 0),
      security: { ...security, score },
    };
  });
}
