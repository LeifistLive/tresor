import { randomBytes } from 'node:crypto';
import { argon2id, hkdf, hmacHex, open, parseParams, safeEqual, seal, sha256Hex } from './primitives.js';

/**
 * Server-side key material
 * ------------------------
 * The browser derives and uses every key that protects content (see packages/shared/src/crypto). The server
 * only keeps:
 *
 *   VAULT_MASTER_KEY (env) ──HKDF──► server key   – outer layer around stored wrapped keys, login verifiers,
 *                                                   TOTP secrets and notification settings (rotatable)
 *                          ──HKDF──► session salt – encrypts each session's random key with its cookie token
 *                          ──HKDF──► key-check value
 */
export class KeyRing {
  readonly sessionSalt: Buffer;
  /** Key of the outer encryption layer around wrapped keys and server-side secrets. */
  readonly serverKey: Buffer;
  readonly checkValue: string;
  /** Derives deterministic decoy values for unknown usernames (no account enumeration). */
  private readonly decoyKey: Buffer;

  constructor(masterKey: string) {
    const ikm = Buffer.from(masterKey, 'utf8');
    this.sessionSalt = hkdf(ikm, 'tresor', 'tresor/session-salt/v1');
    this.serverKey = hkdf(ikm, 'tresor', 'tresor/server-key/v1');
    this.checkValue = hmacHex(hkdf(ikm, 'tresor', 'tresor/key-check/v1'), 'tresor-key-check');
    this.decoyKey = hkdf(ikm, 'tresor', 'tresor/decoy/v1');
  }

  serverSeal(data: Buffer | string, aad: string): string {
    return seal(this.serverKey, data, `server:${aad}`);
  }

  serverOpen(envelope: string, aad: string): Buffer {
    return open(this.serverKey, envelope, `server:${aad}`);
  }

  /** Stable pseudo-random bytes for a label (decoy salts and wrapped keys of unknown users). */
  decoy(label: string, length: number): Buffer {
    return hkdf(this.decoyKey, '', `decoy:${label}`, length);
  }
}

export const SERVER_AAD = {
  /** Sealed SHA-256 of the browser-derived auth key. */
  authHash: (userId: string) => `user:${userId}:auth-hash`,
  passwordWrap: (userId: string) => `user:${userId}:dek:password`,
  recoveryWrap: (userId: string) => `user:${userId}:dek:recovery`,
  passkeyWrap: (credentialId: string) => `passkey:${credentialId}:dek`,
  totp: (userId: string) => `user:${userId}:totp`,
  notifyConfig: (userId: string) => `user:${userId}:notify`,
};

/** Re-encrypts the outer server layer with another key ring (master key rotation). */
export function reseal(from: KeyRing, to: KeyRing, envelope: string, aad: string): string {
  return to.serverSeal(from.serverOpen(envelope, aad), aad);
}

// ===========================================================================
// Verifiers for values derived in the browser
// ===========================================================================

const fromKey = (b64url: string) => Buffer.from(b64url, 'base64url');

/** Stores SHA-256(auth key), sealed with the server key – a database dump alone cannot be used to log in. */
export function sealAuthVerifier(keys: KeyRing, userId: string, authKey: string): string {
  return keys.serverSeal(sha256Hex(fromKey(authKey)), SERVER_AAD.authHash(userId));
}

export function checkAuthVerifier(keys: KeyRing, userId: string, sealed: string, authKey: string): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(keys.serverOpen(sealed, SERVER_AAD.authHash(userId)).toString('utf8'), 'hex');
  } catch {
    return false;
  }
  return safeEqual(expected, Buffer.from(sha256Hex(fromKey(authKey)), 'hex'));
}

/** SHA-256 (hex) of a recovery proof, as stored in the database. */
export function proofHash(proof: string): string {
  return sha256Hex(fromKey(proof));
}

export function checkProof(hash: string | null, proof: string): boolean {
  if (!hash) return false;
  return safeEqual(Buffer.from(hash, 'hex'), Buffer.from(proofHash(proof), 'hex'));
}

/**
 * What the browser derives from a password (`authKeyOf(deriveMasterKey(…))`). Only used for temporary
 * passwords set by an admin – they protect no keys.
 */
export async function authKeyFromPassword(password: string, kdfSalt: string, kdfParams: string) {
  const master = await argon2id(password, Buffer.from(kdfSalt, 'base64'), parseParams(kdfParams));
  return hkdf(master, '', 'tresor/auth/v1').toString('base64url');
}

export function newKdfSalt(): string {
  return randomBytes(16).toString('base64');
}

// ===========================================================================
// Sessions: the cookie token is the only thing that can unlock the session's random key
// ===========================================================================

export function newSessionToken(): { token: string; id: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, id: sessionIdFromToken(token) };
}

export function sessionIdFromToken(token: string): string {
  return sha256Hex(`tresor-session:${token}`);
}

function tokenKey(keys: KeyRing, token: string): Buffer {
  return hkdf(Buffer.from(token, 'utf8'), keys.sessionSalt, 'tresor/session-key/v1');
}

export function sealSessionKey(keys: KeyRing, token: string, sessionId: string, sessionKey: Buffer): string {
  return seal(tokenKey(keys, token), sessionKey, `session:${sessionId}`);
}

export function openSessionKey(keys: KeyRing, token: string, sessionId: string, sealed: string): Buffer {
  return open(tokenKey(keys, token), sealed, `session:${sessionId}`);
}
