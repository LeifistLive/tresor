import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { newSessionToken, openSessionKey, sealSessionKey, sessionIdFromToken } from '../crypto/keys.js';
import { randomKey } from '../crypto/primitives.js';
import { sessions, type UserRow, users } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { AuthContext } from '../types.js';

export const SESSION_COOKIE = 'tresor_session';
const LAST_SEEN_RESOLUTION_MS = 60_000;

function cookieSecure(app: FastifyInstance, req: FastifyRequest): boolean {
  const mode = app.config.COOKIE_SECURE;
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  return req.protocol === 'https';
}

/**
 * Starts a session and returns its random session key (base64url). The browser encrypts its unlocked keys
 * with it for reloads; the server keeps the key only sealed with the cookie token, which it never stores.
 */
export async function startSession(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  user: UserRow,
): Promise<string> {
  const { token, id } = newSessionToken();
  const sessionKey = randomKey(32);
  const keyEnc = sealSessionKey(app.keys, token, id, sessionKey);
  const ttlMs = app.config.SESSION_TTL_HOURS * 3_600_000;
  await app.db.insert(sessions).values({
    id,
    userId: user.id,
    keyEnc,
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 255) || null,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure(app, req),
    maxAge: Math.floor(ttlMs / 1000),
  });
  req.auth = { user, sessionId: id, keyEnc };
  return sessionKey.toString('base64url');
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Resolves the session cookie into the user, or null. */
export async function loadSession(app: FastifyInstance, req: FastifyRequest): Promise<AuthContext | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || token.length > 128) return null;
  const id = sessionIdFromToken(token);

  const [row] = await app.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;

  const now = Date.now();
  const idleMs = app.config.SESSION_IDLE_MINUTES * 60_000;
  const expired = row.session.expiresAt.getTime() <= now || row.session.lastSeenAt.getTime() + idleMs <= now;
  if (expired || row.user.disabled) {
    await app.db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  if (now - row.session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    await app.db
      .update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(sessions.id, id));
  }
  return { user: row.user, sessionId: id, keyEnc: row.session.keyEnc };
}

/** The current session's key, or null when the cookie no longer matches (should not happen). */
export function sessionKeyOf(app: FastifyInstance, req: FastifyRequest): string | null {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || !req.auth) return null;
  try {
    return openSessionKey(app.keys, token, req.auth.sessionId, req.auth.keyEnc).toString('base64url');
  } catch {
    return null;
  }
}

/** Accounts created by an admin have to pick their own password (and get keys) before anything else. */
export function isPending(user: UserRow): boolean {
  return user.mustChangePassword || user.dekWrapped === null;
}

export async function requireAuth(this: FastifyInstance, req: FastifyRequest) {
  const ctx = await loadSession(this, req);
  if (!ctx) throw unauthorized();
  if (isPending(ctx.user) && !req.routeOptions.config.allowPending) {
    throw forbidden('PASSWORD_CHANGE_REQUIRED', 'Password change required');
  }
  req.auth = ctx;
}

export async function requireAdmin(this: FastifyInstance, req: FastifyRequest) {
  await requireAuth.call(this, req);
  if (req.auth?.user.role !== 'admin') throw forbidden();
}

/** Narrowing helper for handlers behind `requireAuth`. */
export function auth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
