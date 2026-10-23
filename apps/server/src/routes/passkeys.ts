import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import {
  type PasskeyDto,
  passkeyLoginVerifySchema,
  passkeyNameSchema,
  passkeyRegisterVerifySchema,
} from '@tresor/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SERVER_AAD } from '../crypto/keys.js';
import { passkeys, users } from '../db/schema.js';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { auth, requireAuth, startSession } from '../plugins/auth.js';
import { audit } from '../services/audit.js';
import { describeDevice, notifyUser } from '../services/notify.js';
import { accountKeys, findUserById, toMe, verifyAuthKey } from '../services/users.js';

/** Fixed PRF input; the authenticator's output is unique per credential anyway. */
export const PRF_SALT = createHash('sha256').update('tresor/passkey-prf/v1').digest().toString('base64url');

interface Challenge {
  challenge: string;
  purpose: 'register' | 'login';
  userId?: string;
  expires: number;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const failed = () => new AppError(401, 'PASSKEY_FAILED', 'Passkey verification failed');

export async function passkeyRoutes(app: FastifyInstance) {
  const challenges = new Map<string, Challenge>();

  function putChallenge(c: Omit<Challenge, 'expires'>): string {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
    const id = randomBytes(16).toString('base64url');
    challenges.set(id, { ...c, expires: now + CHALLENGE_TTL_MS });
    return id;
  }

  function takeChallenge(id: string, purpose: Challenge['purpose'], userId?: string): string {
    const c = challenges.get(id);
    challenges.delete(id);
    if (!c || c.expires < Date.now() || c.purpose !== purpose || (userId && c.userId !== userId))
      throw failed();
    return c.challenge;
  }

  /** Relying party = the host the browser talks to (WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN override it). */
  function relyingParty(req: FastifyRequest) {
    const origin = String(req.headers.origin ?? '');
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      throw new AppError(400, 'PASSKEY_FAILED', 'Missing or invalid Origin header');
    }
    const rpID = app.config.WEBAUTHN_RP_ID ?? req.hostname;
    const allowed = app.config.WEBAUTHN_ORIGIN?.split(',').map((o) => o.trim());
    if (allowed ? !allowed.includes(origin) : host !== rpID && !host.endsWith(`.${rpID}`)) {
      throw new AppError(400, 'PASSKEY_FAILED', 'Origin does not match this server');
    }
    return { rpID, origin };
  }

  // --- Registration (signed in) ------------------------------------------------------------------

  await app.register(async (scoped) => {
    scoped.addHook('preHandler', requireAuth);

    scoped.get('/account/passkeys', async (req) => {
      const { user } = auth(req);
      const rows = await app.db
        .select()
        .from(passkeys)
        .where(eq(passkeys.userId, user.id))
        .orderBy(desc(passkeys.createdAt));
      const list: PasskeyDto[] = rows.map((p) => ({
        id: p.id,
        name: p.name,
        canUnlock: p.dekWrapped !== null,
        createdAt: p.createdAt.toISOString(),
        lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      }));
      return { passkeys: list };
    });

    scoped.post('/account/passkeys/options', async (req) => {
      const { user } = auth(req);
      const { rpID } = relyingParty(req);
      const existing = await app.db.select().from(passkeys).where(eq(passkeys.userId, user.id));
      const options = await generateRegistrationOptions({
        rpName: 'Tresor',
        rpID,
        userName: user.username,
        userDisplayName: user.displayName,
        userID: Buffer.from(user.id.replace(/-/g, ''), 'hex'),
        attestationType: 'none',
        excludeCredentials: existing.map((p) => ({
          id: p.credentialId,
          transports: p.transports ? (JSON.parse(p.transports) as string[]) : undefined,
        })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: { eval: { first: PRF_SALT } } } as never,
      });
      const challengeId = putChallenge({
        challenge: options.challenge,
        purpose: 'register',
        userId: user.id,
      });
      return { challengeId, options, prfSalt: PRF_SALT };
    });

    scoped.post(
      '/account/passkeys',
      { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
      async (req, reply) => {
        const { user } = auth(req);
        const input = passkeyRegisterVerifySchema.parse(req.body);
        // A passkey is a lasting way into the account: confirm with the password, not just the session.
        if (!verifyAuthKey(app, user, input.authKey))
          throw unauthorized('INVALID_CREDENTIALS', 'Wrong password');
        const { rpID, origin } = relyingParty(req);
        const expectedChallenge = takeChallenge(input.challengeId, 'register', user.id);
        let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
        try {
          verification = await verifyRegistrationResponse({
            response: input.response as never,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: true,
          });
        } catch (err) {
          req.log.warn({ err: (err as Error).message }, 'passkey registration rejected');
          throw failed();
        }
        if (!verification.verified) throw failed();
        const { credential } = verification.registrationInfo;
        // The browser wrapped the account key with the PRF output under this credential id.
        if (input.response.id !== credential.id) throw failed();
        const id = randomUUID();
        await app.db.insert(passkeys).values({
          id,
          userId: user.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter,
          transports: JSON.stringify(credential.transports ?? []),
          name: input.name,
          dekWrapped: input.dekWrapped
            ? app.keys.serverSeal(input.dekWrapped, SERVER_AAD.passkeyWrap(credential.id))
            : null,
        });
        await audit(app, req, { action: 'passkey.add', meta: { canUnlock: Boolean(input.dekWrapped) } });
        reply.code(201);
        return { ok: true, canUnlock: Boolean(input.dekWrapped) };
      },
    );

    scoped.patch('/account/passkeys/:id', async (req) => {
      const { user } = auth(req);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { name } = passkeyNameSchema.parse(req.body);
      const updated = await app.db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)))
        .returning({ id: passkeys.id });
      if (updated.length === 0) throw notFound('Passkey not found');
      return { ok: true };
    });

    scoped.delete('/account/passkeys/:id', async (req) => {
      const { user } = auth(req);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const deleted = await app.db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)))
        .returning({ id: passkeys.id });
      if (deleted.length === 0) throw notFound('Passkey not found');
      await audit(app, req, { action: 'passkey.delete' });
      return { ok: true };
    });
  });

  // --- Sign-in (public) ----------------------------------------------------------------------------

  const loginLimit = { max: app.config.LOGIN_RATE_LIMIT * 2, timeWindow: '5 minutes' };

  app.post('/auth/passkey/options', { config: { rateLimit: loginLimit } }, async (req) => {
    const { rpID } = relyingParty(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_SALT } } } as never,
    });
    const challengeId = putChallenge({ challenge: options.challenge, purpose: 'login' });
    return { challengeId, options, prfSalt: PRF_SALT };
  });

  app.post('/auth/passkey', { config: { rateLimit: loginLimit } }, async (req, reply) => {
    const input = passkeyLoginVerifySchema.parse(req.body);
    const { rpID, origin } = relyingParty(req);
    const expectedChallenge = takeChallenge(input.challengeId, 'login');
    const [pk] = await app.db.select().from(passkeys).where(eq(passkeys.credentialId, input.response.id));
    const user = pk ? await findUserById(app.db, pk.userId) : undefined;
    if (!pk || !user) {
      await audit(app, req, { action: 'auth.login_failed', meta: { reason: 'passkey_unknown' } });
      throw failed();
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: input.response as never,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: pk.credentialId,
          publicKey: Buffer.from(pk.publicKey, 'base64url'),
          counter: pk.counter,
          transports: pk.transports ? (JSON.parse(pk.transports) as never) : undefined,
        },
      });
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'passkey assertion rejected');
      verification = { verified: false } as never;
    }
    if (!verification.verified) {
      await audit(app, req, {
        action: 'auth.login_failed',
        userId: user.id,
        actor: user.username,
        meta: { reason: 'passkey' },
      });
      throw failed();
    }
    await app.db
      .update(passkeys)
      .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(passkeys.id, pk.id));

    if (user.disabled) throw forbidden('ACCOUNT_DISABLED', 'This account is disabled');
    if (!pk.dekWrapped) {
      throw new AppError(
        400,
        'PASSKEY_NO_PRF',
        'This passkey cannot unlock the vault – sign in with your password',
      );
    }
    const now = new Date();
    const [fresh] = await app.db
      .update(users)
      .set({ lastLoginAt: now })
      .where(eq(users.id, user.id))
      .returning();
    const sessionKey = await startSession(app, req, reply, fresh!);
    await audit(app, req, {
      action: 'auth.login',
      userId: user.id,
      actor: user.username,
      meta: { method: 'passkey' },
    });
    void notifyUser(app, fresh!, 'newLogin', {
      user: user.username,
      method: 'passkey',
      device: describeDevice(req.headers['user-agent']),
      ip: req.ip,
    });
    // The browser unwraps the account key with its PRF output; the server only removes its own layer.
    const inner = app.keys
      .serverOpen(pk.dekWrapped, SERVER_AAD.passkeyWrap(pk.credentialId))
      .toString('utf8');
    return { user: await toMe(app, fresh!), keys: accountKeys(app, fresh!, inner), sessionKey };
  });
}
