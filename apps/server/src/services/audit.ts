import type { FastifyInstance, FastifyRequest } from 'fastify';
import { auditLog } from '../db/schema.js';

export type AuditAction =
  | 'auth.setup'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.recover'
  | 'account.password_changed'
  | 'account.recovery_key_generated'
  | 'account.totp_enabled'
  | 'account.totp_disabled'
  | 'account.session_revoked'
  | 'note.create'
  | 'note.update'
  | 'note.trash'
  | 'note.restore'
  | 'note.delete'
  | 'trash.empty'
  | 'data.export'
  | 'data.import'
  | 'admin.user_create'
  | 'admin.user_update'
  | 'admin.user_reset'
  | 'admin.user_delete'
  | 'admin.user_logout'
  | 'note.move'
  | 'note.version_restore'
  | 'attachment.add'
  | 'attachment.delete'
  | 'template.create'
  | 'vault.create'
  | 'vault.update'
  | 'vault.delete'
  | 'vault.member_add'
  | 'vault.member_update'
  | 'vault.member_remove'
  | 'vault.leave'
  | 'vault.rotate'
  | 'emergency.grant'
  | 'emergency.revoke'
  | 'emergency.request'
  | 'emergency.approve'
  | 'emergency.reject'
  | 'emergency.view'
  | 'passkey.add'
  | 'passkey.delete'
  | 'account.notifications_updated';

/** Actions that count as "activity" on a user's dashboard chart. */
export const NOTE_ACTIVITY_ACTIONS: AuditAction[] = [
  'note.create',
  'note.update',
  'note.trash',
  'note.restore',
  'note.delete',
  'note.move',
  'note.version_restore',
  'attachment.add',
  'attachment.delete',
  'data.import',
];

export interface AuditEntry {
  action: AuditAction;
  userId?: string | null;
  actor?: string | null;
  target?: string | null;
  meta?: Record<string, unknown>;
}

/** Writes an audit entry. Never throws: auditing must not break the request that triggered it. */
export async function audit(app: FastifyInstance, req: FastifyRequest | null, entry: AuditEntry) {
  try {
    await app.db.insert(auditLog).values({
      action: entry.action,
      userId: entry.userId ?? req?.auth?.user.id ?? null,
      actor: (entry.actor ?? req?.auth?.user.username ?? null)?.slice(0, 64) ?? null,
      target: entry.target ?? null,
      ip: req?.ip ?? null,
      meta: entry.meta ?? null,
    });
  } catch (err) {
    app.log.error({ err, action: entry.action }, 'failed to write audit entry');
  }
}
