import {
  authConfirmSchema,
  changePasswordWireSchema,
  exportedSchema,
  notificationConfigSchema,
  preferencesSchema,
  recoveryKeyWireSchema,
  type SessionDto,
  totpCodeSchema,
} from '@tresor/shared';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SERVER_AAD } from '../crypto/keys.js';
import { sessions, type UserRow, users } from '../db/schema.js';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { createTotpSecret, totpUri, verifyTotp } from '../lib/totp.js';
import { auth, requireAuth } from '../plugins/auth.js';
import { audit } from '../services/audit.js';
import { notifyConfigDto, notifyUser, readNotifyConfig, sealNotifyConfig } from '../services/notify.js';
import { accountColumns, passwordColumns, recoveryColumns, toMe, verifyAuthKey } from '../services/users.js';

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Sensitive actions are confirmed with the auth key the browser derives from the password. */
  const confirmAuth = (user: UserRow, authKey: string) => {
    if (!verifyAuthKey(app, user, authKey)) throw unauthorized('INVALID_CREDENTIALS', 'Wrong password');
  };

  /**
   * Changes the password: the browser re-wrapped the account key with the new password. Admin-created accounts
   * send their freshly generated key set here (exactly once). All other sessions end.
   */
  app.post(
    '/account/password',
    { config: { allowPending: true, rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req) => {
      const { user, sessionId } = auth(req);
      const input = changePasswordWireSchema.parse(req.body);
      confirmAuth(user, input.currentAuthKey);
      const needsKeys = user.dekWrapped === null;
      if (needsKeys !== Boolean(input.account)) {
        throw badRequest('BAD_REQUEST', needsKeys ? 'A key set is required' : 'Account already has keys');
      }
      await app.db
        .update(users)
        .set({
          ...passwordColumns(app, user.id, input),
          ...(input.account ? accountColumns(app, user.id, input.account) : {}),
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await app.db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, sessionId)));
      if (input.account) await audit(app, req, { action: 'account.recovery_key_generated' });
      await audit(app, req, { action: 'account.password_changed' });
      const [fresh] = await app.db.select().from(users).where(eq(users.id, user.id));
      return { user: await toMe(app, fresh!) };
    },
  );

  /** Stores a new recovery-key wrap created in the browser (the old recovery key stops working). */
  app.post(
    '/account/recovery-key',
    { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } },
    async (req) => {
      const { user } = auth(req);
      const input = recoveryKeyWireSchema.parse(req.body);
      confirmAuth(user, input.authKey);
      const [fresh] = await app.db
        .update(users)
        .set({
          ...recoveryColumns(app, user.id, input.recoveryWrapped, input.recoveryProof),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();
      await audit(app, req, { action: 'account.recovery_key_generated' });
      return { user: await toMe(app, fresh!) };
    },
  );

  /** Checks the password (as auth key) before a browser-side ceremony such as creating a passkey. */
  app.post(
    '/account/verify-password',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req) => {
      const { authKey } = authConfirmSchema.parse(req.body);
      confirmAuth(auth(req).user, authKey);
      return { ok: true };
    },
  );

  /** Remembers when the user last exported their data (exports are built in the browser). */
  app.post('/account/exported', async (req) => {
    const { user } = auth(req);
    const input = exportedSchema.parse(req.body);
    await app.db.update(users).set({ lastExportAt: new Date() }).where(eq(users.id, user.id));
    await audit(app, req, { action: 'data.export', meta: input });
    return { ok: true };
  });

  app.patch('/account/preferences', { config: { allowPending: true } }, async (req) => {
    const { user } = auth(req);
    const input = preferencesSchema.parse(req.body);
    const [updated] = await app.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return { user: await toMe(app, updated!) };
  });

  // --- Sessions -------------------------------------------------------------

  app.get('/account/sessions', async (req) => {
    const { user, sessionId } = auth(req);
    const rows = await app.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.lastSeenAt));
    const list: SessionDto[] = rows.map((s) => ({
      id: s.id.slice(0, 16),
      current: s.id === sessionId,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      ip: s.ip,
      userAgent: s.userAgent,
    }));
    return { sessions: list };
  });

  /** Revokes a session by its public id prefix, or all other sessions with id "others". */
  app.delete('/account/sessions/:id', async (req) => {
    const { user, sessionId } = auth(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const rows = await app.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id));
    const targets = rows
      .map((r) => r.id)
      .filter((sid) => sid !== sessionId && (id === 'others' || sid.startsWith(id)));
    if (targets.length === 0 && id !== 'others') throw notFound('Session not found');
    for (const sid of targets) await app.db.delete(sessions).where(eq(sessions.id, sid));
    await audit(app, req, { action: 'account.session_revoked', meta: { count: targets.length } });
    return { revoked: targets.length };
  });

  // --- Two-factor authentication (TOTP) ---------------------------------------

  app.post('/account/totp/setup', async (req) => {
    const { user } = auth(req);
    const { authKey } = authConfirmSchema.parse(req.body);
    confirmAuth(user, authKey);
    if (user.totpEnabled) throw conflict('CONFLICT', 'Two-factor authentication is already enabled');
    const secret = createTotpSecret();
    await app.db
      .update(users)
      .set({
        // Sealed with the server key: the code is checked at sign-in, before the vault is unlocked.
        totpSecretEnc: app.keys.serverSeal(secret, SERVER_AAD.totp(user.id)),
        totpEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    return { secret, uri: totpUri(secret, user.username) };
  });

  app.post(
    '/account/totp/enable',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req) => {
      const { user } = auth(req);
      const { code } = totpCodeSchema.parse(req.body);
      if (user.totpEnabled) throw conflict('CONFLICT', 'Two-factor authentication is already enabled');
      if (!user.totpSecretEnc) throw badRequest('BAD_REQUEST', 'Run the setup step first');
      const secret = app.keys.serverOpen(user.totpSecretEnc, SERVER_AAD.totp(user.id)).toString('utf8');
      const step = verifyTotp(secret, code);
      if (step === null) throw badRequest('TOTP_INVALID', 'Invalid code');
      const [updated] = await app.db
        .update(users)
        .set({ totpEnabled: true, totpLastStep: step, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      await audit(app, req, { action: 'account.totp_enabled' });
      return { user: await toMe(app, updated!) };
    },
  );

  app.post('/account/totp/disable', async (req) => {
    const { user } = auth(req);
    const { authKey } = authConfirmSchema.parse(req.body);
    confirmAuth(user, authKey);
    const [updated] = await app.db
      .update(users)
      .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    await audit(app, req, { action: 'account.totp_disabled' });
    return { user: await toMe(app, updated!) };
  });

  // --- Notifications ----------------------------------------------------------------------------------

  app.get('/account/notifications', async (req) => {
    return { config: notifyConfigDto(readNotifyConfig(app, auth(req).user)) };
  });

  app.put('/account/notifications', async (req) => {
    const { user } = auth(req);
    const input = notificationConfigSchema.parse(req.body);
    if (input.enabled && !input.url) throw badRequest('VALIDATION', 'A server URL is required');
    if (input.enabled && input.provider === 'ntfy' && !input.topic)
      throw badRequest('VALIDATION', 'A topic is required');
    const { sealed, config } = sealNotifyConfig(app, user, input);
    if (config.enabled && config.provider === 'gotify' && !config.token) {
      throw badRequest('VALIDATION', 'A Gotify application token is required');
    }
    await app.db
      .update(users)
      .set({ notifyConfigEnc: sealed, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await audit(app, req, { action: 'account.notifications_updated', meta: { provider: config.provider } });
    return { config: notifyConfigDto(config) };
  });

  app.post(
    '/account/notifications/test',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req) => {
      const { user } = auth(req);
      try {
        const sent = await notifyUser(app, user, 'test', {}, { force: true });
        if (!sent) throw new Error('No notification channel configured');
      } catch (err) {
        throw new AppError(400, 'NOTIFY_FAILED', (err as Error).message);
      }
      return { ok: true };
    },
  );
}
