import {
  loginWireSchema,
  type PreloginResponse,
  preloginSchema,
  type RecoverStartResponse,
  recoverFinishSchema,
  recoverStartSchema,
  type SessionStartResponse,
  setupWireSchema,
} from '@tresor/shared';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  checkAuthVerifier,
  checkProof,
  SERVER_AAD,
  sealAuthVerifier,
  sessionIdFromToken,
} from '../crypto/keys.js';
import { formatParams } from '../crypto/primitives.js';
import { sessions, system, type UserRow, users } from '../db/schema.js';
import { AppError, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { verifyTotp } from '../lib/totp.js';
import {
  auth,
  clearSessionCookie,
  requireAuth,
  SESSION_COOKIE,
  sessionKeyOf,
  startSession,
} from '../plugins/auth.js';
import { audit } from '../services/audit.js';
import { alertFailedLogin, describeDevice, notifyUser } from '../services/notify.js';
import {
  accountColumns,
  accountKeys,
  findUserByUsername,
  passwordColumns,
  recoveryColumns,
  toMe,
  verifyAuthKey,
} from '../services/users.js';

export async function authRoutes(app: FastifyInstance) {
  const loginLimit = { max: app.config.LOGIN_RATE_LIMIT, timeWindow: '5 minutes' };
  const preloginLimit = { max: app.config.LOGIN_RATE_LIMIT * 3, timeWindow: '5 minutes' };
  // Checked for unknown usernames too, so both cases take the same work.
  const decoyVerifier = sealAuthVerifier(app.keys, 'decoy', app.keys.decoy('auth', 32).toString('base64url'));

  async function sessionResponse(
    req: Parameters<typeof startSession>[1],
    reply: Parameters<typeof startSession>[2],
    user: UserRow,
    dekWrapped?: string,
  ): Promise<SessionStartResponse> {
    const sessionKey = await startSession(app, req, reply, user);
    return { user: await toMe(app, user), keys: accountKeys(app, user, dekWrapped), sessionKey };
  }

  app.get('/setup/status', async () => {
    const [row] = await app.db.select({ n: count() }).from(users);
    return { needsSetup: (row?.n ?? 0) === 0 };
  });

  /** First run: creates the initial administrator with keys generated in the browser. */
  app.post('/setup', { config: { rateLimit: loginLimit } }, async (req, reply) => {
    const input = setupWireSchema.parse(req.body);
    const values = {
      id: input.id,
      username: input.username,
      displayName: input.displayName,
      language: input.language,
      role: 'admin' as const,
      ...passwordColumns(app, input.id, input),
      ...accountColumns(app, input.id, input),
    };
    const user = await app.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(system)
        .values({ key: 'setup_completed', value: new Date().toISOString() })
        .onConflictDoNothing()
        .returning();
      const [existing] = await tx.select({ n: count() }).from(users);
      if (claimed.length === 0 || (existing?.n ?? 0) > 0) {
        throw conflict('SETUP_DONE', 'Setup has already been completed');
      }
      const [created] = await tx.insert(users).values(values).returning();
      return created!;
    });
    await audit(app, req, { action: 'auth.setup', userId: user.id, actor: user.username });
    reply.code(201);
    return sessionResponse(req, reply, user);
  });

  /**
   * Step 1 of signing in: the salt and cost parameters the browser needs to derive the master key.
   * Unknown usernames get stable decoy values, so the response does not reveal whether an account exists.
   */
  app.post(
    '/auth/prelogin',
    { config: { rateLimit: preloginLimit } },
    async (req): Promise<PreloginResponse> => {
      const { username } = preloginSchema.parse(req.body);
      const user = await findUserByUsername(app.db, username);
      if (!user) {
        return {
          kdfSalt: app.keys.decoy(`salt:${username}`, 16).toString('base64'),
          kdfParams: formatParams(app.argon),
        };
      }
      return { kdfSalt: user.kdfSalt, kdfParams: user.kdfParams };
    },
  );

  /**
   * Step 2: the browser proves knowledge of the password with the derived auth key (never the password).
   */
  app.post('/auth/login', { config: { rateLimit: loginLimit } }, async (req, reply) => {
    const input = loginWireSchema.parse(req.body);
    const user = await findUserByUsername(app.db, input.username);

    const fail = async (reason: string) => {
      await audit(app, req, {
        action: 'auth.login_failed',
        userId: user?.id ?? null,
        actor: input.username,
        meta: { reason },
      });
      void alertFailedLogin(app, user, input.username, req.ip).catch(() => {});
      return unauthorized('INVALID_CREDENTIALS', 'Invalid username or password');
    };

    if (!user) {
      checkAuthVerifier(app.keys, 'decoy', decoyVerifier, input.authKey);
      throw await fail('unknown_user');
    }
    if (!verifyAuthKey(app, user, input.authKey)) throw await fail('wrong_password');

    if (user.disabled) {
      await audit(app, req, {
        action: 'auth.login_failed',
        userId: user.id,
        actor: user.username,
        meta: { reason: 'disabled' },
      });
      throw forbidden('ACCOUNT_DISABLED', 'This account is disabled');
    }

    if (user.totpEnabled && user.totpSecretEnc) {
      if (!input.totp) throw unauthorized('TOTP_REQUIRED', 'Two-factor code required');
      const secret = app.keys.serverOpen(user.totpSecretEnc, SERVER_AAD.totp(user.id)).toString('utf8');
      const step = verifyTotp(secret, input.totp);
      if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) {
        await audit(app, req, {
          action: 'auth.login_failed',
          userId: user.id,
          actor: user.username,
          meta: { reason: 'totp' },
        });
        void alertFailedLogin(app, user, user.username, req.ip).catch(() => {});
        throw unauthorized('TOTP_INVALID', 'Invalid two-factor code');
      }
      await app.db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
    }

    const [fresh] = await app.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    await audit(app, req, { action: 'auth.login', userId: user.id, actor: user.username });
    void notifyUser(app, fresh!, 'newLogin', {
      user: user.username,
      method: 'password',
      device: describeDevice(req.headers['user-agent']),
      ip: req.ip,
    });
    return sessionResponse(req, reply, fresh!);
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const id = sessionIdFromToken(token);
      const [deleted] = await app.db
        .delete(sessions)
        .where(eq(sessions.id, id))
        .returning({ userId: sessions.userId });
      if (deleted) await audit(app, req, { action: 'auth.logout', userId: deleted.userId });
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth, config: { allowPending: true } }, async (req) => {
    return { user: await toMe(app, auth(req).user) };
  });

  /** The session key (to reopen the browser's locally stored keys after a reload) and the key pair. */
  app.get(
    '/auth/session-key',
    { preHandler: requireAuth, config: { allowPending: true } },
    async (req, reply) => {
      const { user } = auth(req);
      const sessionKey = sessionKeyOf(app, req);
      if (!sessionKey) throw unauthorized();
      reply.header('cache-control', 'no-store');
      return { sessionKey, publicKey: user.publicKey, privateKeyEnc: user.privateKeyEnc };
    },
  );

  // --- Recovery -------------------------------------------------------------------------------------

  const invalidRecovery = () => new AppError(401, 'INVALID_RECOVERY_KEY', 'Invalid username or recovery key');
  const recoveryFailed = (user: UserRow | undefined, username: string, req: Parameters<typeof audit>[1]) =>
    audit(app, req, {
      action: 'auth.login_failed',
      userId: user?.id ?? null,
      actor: username,
      meta: { reason: 'recovery' },
    });

  /**
   * Step 1: the recovery-wrapped account key. It is protected by 160 random bits, so handing it out is
   * safe; unknown users get a stable decoy that simply fails to decrypt in the browser.
   */
  app.post(
    '/auth/recover/start',
    { config: { rateLimit: loginLimit } },
    async (req): Promise<RecoverStartResponse> => {
      const { username } = recoverStartSchema.parse(req.body);
      const user = await findUserByUsername(app.db, username);
      if (!user?.dekRecoveryWrapped || user.disabled) {
        const fake = app.keys.decoy(`recovery:${username}`, 77);
        fake[0] = 1;
        const id = app.keys.decoy(`user:${username}`, 16).toString('hex');
        return {
          userId: `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`,
          recoveryWrapped: fake.toString('base64url'),
        };
      }
      return {
        userId: user.id,
        recoveryWrapped: app.keys
          .serverOpen(user.dekRecoveryWrapped, SERVER_AAD.recoveryWrap(user.id))
          .toString('utf8'),
      };
    },
  );

  /**
   * Step 2: the browser proves it knows the recovery key (recovery proof – not derived from the account key,
   * which emergency contacts may hold) and sends the key material for the new password and a new recovery
   * key. Two-factor sign-in is switched off (a lost authenticator is a common reason for recovery) and all
   * other sessions end.
   */
  app.post('/auth/recover', { config: { rateLimit: loginLimit } }, async (req, reply) => {
    const input = recoverFinishSchema.parse(req.body);
    const user = await findUserByUsername(app.db, input.username);
    if (!user || user.disabled || !checkProof(user.recoveryProofHash, input.recoveryProof)) {
      await recoveryFailed(user, input.username, req);
      throw invalidRecovery();
    }
    const pw = passwordColumns(app, user.id, input);
    await app.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          ...pw,
          ...recoveryColumns(app, user.id, input.recoveryWrapped, input.newRecoveryProof),
          mustChangePassword: false,
          totpEnabled: false,
          totpSecretEnc: null,
          totpLastStep: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await tx.delete(sessions).where(eq(sessions.userId, user.id));
    });
    await audit(app, req, { action: 'auth.recover', userId: user.id, actor: user.username });
    const [fresh] = await app.db.select().from(users).where(eq(users.id, user.id));
    void notifyUser(app, fresh!, 'newLogin', {
      user: user.username,
      method: 'recovery',
      device: describeDevice(req.headers['user-agent']),
      ip: req.ip,
    });
    return sessionResponse(req, reply, fresh!);
  });
}
