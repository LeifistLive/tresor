import { EXPIRY_WARNING_DAYS } from '@tresor/shared';
import { and, eq, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { auditLog, notes, sessions, system, users, vaultMembers } from '../db/schema.js';
import { DAY_MS } from '../lib/dates.js';
import { notifyUser, wantsReminders } from './notify.js';

/**
 * Once per day: notifies users about entries reaching their expiry date within EXPIRY_WARNING_DAYS.
 * Messages only contain counts – titles stay encrypted.
 */
export async function sendExpiryReminders(app: FastifyInstance, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const [last] = await app.db.select().from(system).where(eq(system.key, 'reminders_last_run'));
  if (last?.value === today) return 0;
  await app.db
    .insert(system)
    .values({ key: 'reminders_last_run', value: today })
    .onConflictDoUpdate({ target: system.key, set: { value: today, updatedAt: now } });

  const horizon = new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY_MS).toISOString().slice(0, 10);
  const due = await app.db
    .select({ id: notes.id, userId: notes.userId, vaultId: notes.vaultId })
    .from(notes)
    .where(and(lte(notes.expiresAt, horizon), isNull(notes.deletedAt), isNull(notes.remindedAt)));
  if (due.length === 0) return 0;

  // Personal entries go to their owner, shared entries to every member of the vault.
  const vaultIds = [...new Set(due.map((d) => d.vaultId).filter((v): v is string => v !== null))];
  const members = vaultIds.length
    ? await app.db.select().from(vaultMembers).where(inArray(vaultMembers.vaultId, vaultIds))
    : [];
  const perUser = new Map<string, number>();
  for (const d of due) {
    const recipients = d.vaultId
      ? members.filter((m) => m.vaultId === d.vaultId).map((m) => m.userId)
      : [d.userId];
    for (const r of recipients) perUser.set(r, (perUser.get(r) ?? 0) + 1);
  }
  const recipients = await app.db
    .select()
    .from(users)
    .where(inArray(users.id, [...perUser.keys()]));
  for (const user of recipients) {
    if (!user.disabled && wantsReminders(app, user)) {
      await notifyUser(app, user, 'reminders', {
        count: perUser.get(user.id) ?? 0,
        days: EXPIRY_WARNING_DAYS,
      });
    }
  }
  await app.db
    .update(notes)
    .set({ remindedAt: now })
    .where(
      inArray(
        notes.id,
        due.map((d) => d.id),
      ),
    );
  return due.length;
}

/** Removes expired sessions, old trash and old audit entries. Runs hourly. */
export async function runMaintenance(app: FastifyInstance) {
  const now = Date.now();
  const idleCutoff = new Date(now - app.config.SESSION_IDLE_MINUTES * 60_000);
  const expired = await app.db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, new Date(now)), lt(sessions.lastSeenAt, idleCutoff)))
    .returning({ id: sessions.id });

  let purged = 0;
  if (app.config.TRASH_RETENTION_DAYS > 0) {
    const cutoff = new Date(now - app.config.TRASH_RETENTION_DAYS * DAY_MS);
    const rows = await app.db
      .delete(notes)
      .where(and(isNotNull(notes.deletedAt), lt(notes.deletedAt, cutoff)))
      .returning({ id: notes.id });
    purged = rows.length;
  }

  let auditRemoved = 0;
  if (app.config.AUDIT_RETENTION_DAYS > 0) {
    const cutoff = new Date(now - app.config.AUDIT_RETENTION_DAYS * DAY_MS);
    const rows = await app.db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, cutoff))
      .returning({ id: auditLog.id });
    auditRemoved = rows.length;
  }

  const reminded = await sendExpiryReminders(app);

  if (expired.length || purged || auditRemoved || reminded) {
    app.log.info(
      { expiredSessions: expired.length, purgedNotes: purged, auditRemoved, reminded },
      'maintenance completed',
    );
  }
}

export function scheduleMaintenance(app: FastifyInstance) {
  const run = () => runMaintenance(app).catch((err) => app.log.error({ err }, 'maintenance failed'));
  const timer = setInterval(run, 3_600_000);
  timer.unref();
  void run();
  app.addHook('onClose', async () => clearInterval(timer));
}
