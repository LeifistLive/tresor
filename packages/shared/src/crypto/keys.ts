import { type Bytes, fromBase64, randomBytes, toBase64, toBase64Url, toHex } from './bytes.js';
import { generateKeyPair, type KeyPair } from './ecies.js';
import {
  type Argon2Params,
  argon2id,
  DecryptionError,
  formatParams,
  hkdf,
  open,
  parseParams,
  seal,
  sha256,
} from './primitives.js';

/**
 * Key hierarchy (zero knowledge)
 * ------------------------------
 * Everything below happens in the browser. The server only ever sees `authKey` (a login proof that cannot be
 * turned back into the password or the keys), wrapped keys and ciphertext.
 *
 *   password ──Argon2id(kdf salt)──► master key ─┬─HKDF──► auth key (login proof, sent to the server)
 *                                                └─HKDF──► password wrap key ──┐
 *   recovery key (160 bit) ───────────HKDF──► recovery wrap key ───────────────┼──► wraps the account key (DEK)
 *   passkey PRF output (256 bit) ─────HKDF──► passkey wrap key ────────────────┘
 *
 *   DEK (random, per user) ──► personal entries, templates, X25519 private key, file keys
 *   vault key (random, per shared vault) ──ECIES to each member's public key──► shared entries
 *   file key (random, per attachment) ──► attachment content
 *
 * The server adds an outer layer with its master key around stored wrapped keys (a database dump alone stays
 * useless) and never holds anything that opens content.
 */

export const AAD = {
  passwordWrap: (userId: string) => `user:${userId}:dek:password`,
  recoveryWrap: (userId: string) => `user:${userId}:dek:recovery`,
  passkeyWrap: (credentialId: string) => `passkey:${credentialId}:dek`,
  privateKey: (userId: string) => `user:${userId}:private-key`,
  note: (id: string) => `note:${id}`,
  attachmentMeta: (id: string) => `attachment:${id}:meta`,
  attachmentData: (id: string) => `attachment:${id}:data`,
  template: (id: string) => `template:${id}`,
  vaultName: (vaultId: string) => `vault:${vaultId}:name`,
  vaultKey: (vaultId: string, userId: string) => `vault:${vaultId}:member:${userId}`,
  emergency: (id: string) => `emergency:${id}`,
  localKeys: (userId: string) => `local-keys:${userId}`,
} as const;

const INFO = {
  auth: 'tresor/auth/v1',
  passwordWrap: 'tresor/dek-wrap/password/v1',
  recoveryWrap: 'tresor/dek-wrap/recovery/v1',
  passkeyWrap: 'tresor/dek-wrap/passkey/v1',
  recoveryProof: 'tresor/recovery-proof/v1',
} as const;

/** Default cost for new passwords (OWASP: ≥ 19 MiB; we use 64 MiB, 3 passes). */
export const DEFAULT_KDF: Argon2Params = { memoryKiB: 65_536, iterations: 3, parallelism: 1 };

/**
 * The weakest parameters the browser accepts from the server. Without this floor a compromised server could
 * hand out cheap parameters and harvest an auth key that is quick to brute-force.
 */
export const MIN_KDF = { memoryKiB: 19_456, iterations: 2 } as const;

export interface KdfSettings {
  kdfSalt: string;
  kdfParams: string;
}

export function newKdfSettings(params: Argon2Params = DEFAULT_KDF): KdfSettings {
  return { kdfSalt: toBase64(randomBytes(16)), kdfParams: formatParams(params) };
}

/** The expensive step: password → master key. Everything else derives from it. */
export function deriveMasterKey(password: string, kdf: KdfSettings): Promise<Bytes> {
  return argon2id(password, fromBase64(kdf.kdfSalt), parseParams(kdf.kdfParams));
}

/** Login proof sent to the server (base64url). */
export async function authKeyOf(masterKey: Uint8Array): Promise<string> {
  return toBase64Url(await hkdf(masterKey, '', INFO.auth));
}

/** What the server stores to check an auth key / recovery proof: SHA-256 (hex). */
export async function verifierOf(proof: string): Promise<string> {
  return toHex(await sha256(fromBase64(proof)));
}

/**
 * Proof that the client knows the recovery key (base64url). Derived from the recovery key itself – not from
 * the account key – so people who legitimately hold the account key (emergency contacts) cannot use it to
 * reset the password.
 */
export async function recoveryProofOf(recovery: Uint8Array): Promise<string> {
  return toBase64Url(await hkdf(recovery, '', INFO.recoveryProof));
}

export async function wrapWithMasterKey(masterKey: Uint8Array, userId: string, dek: Uint8Array) {
  return seal(await hkdf(masterKey, '', INFO.passwordWrap), dek, AAD.passwordWrap(userId));
}

export async function unwrapWithMasterKey(masterKey: Uint8Array, userId: string, wrapped: string) {
  return open(await hkdf(masterKey, '', INFO.passwordWrap), wrapped, AAD.passwordWrap(userId));
}

export async function wrapWithRecoveryKey(recovery: Uint8Array, userId: string, dek: Uint8Array) {
  return seal(await hkdf(recovery, '', INFO.recoveryWrap), dek, AAD.recoveryWrap(userId));
}

export async function unwrapWithRecoveryKey(recovery: Uint8Array, userId: string, wrapped: string) {
  return open(await hkdf(recovery, '', INFO.recoveryWrap), wrapped, AAD.recoveryWrap(userId));
}

export async function wrapWithPrf(prf: Uint8Array, credentialId: string, dek: Uint8Array) {
  if (prf.length < 32) throw new DecryptionError('PRF output too short');
  return seal(await hkdf(prf, '', INFO.passkeyWrap), dek, AAD.passkeyWrap(credentialId));
}

export async function unwrapWithPrf(prf: Uint8Array, credentialId: string, wrapped: string) {
  return open(await hkdf(prf, '', INFO.passkeyWrap), wrapped, AAD.passkeyWrap(credentialId));
}

export async function sealPrivateKey(dek: Uint8Array, userId: string, privateKey: Uint8Array) {
  return seal(dek, privateKey, AAD.privateKey(userId));
}

export async function openPrivateKey(dek: Uint8Array, userId: string, privateKeyEnc: string) {
  const key = await open(dek, privateKeyEnc, AAD.privateKey(userId));
  if (key.length !== 32) throw new DecryptionError('Invalid private key');
  return key;
}

export function newSymmetricKey(): Bytes {
  return randomBytes(32);
}

// --- Recovery key: 160 random bits, Crockford Base32, grouped as XXXX-XXXX-… ------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryKey(): { display: string; bytes: Bytes } {
  const raw = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of raw) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return { display: out.match(/.{4}/g)!.join('-'), bytes: raw };
}

export function parseRecoveryKey(input: string): Bytes {
  const normalized = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (normalized.length !== 32) throw new DecryptionError('Invalid recovery key');
  const out = new Uint8Array(20);
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of normalized) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx === -1) throw new DecryptionError('Invalid recovery key');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out[o++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

// --- Complete key sets --------------------------------------------------------------------------------

/** Password-dependent part of an account (sent on setup, password change and recovery). */
export interface PasswordKeys extends KdfSettings {
  authKey: string;
  dekWrapped: string;
}

/** Everything a brand-new account needs besides the password part. */
export interface AccountKeys {
  publicKey: string;
  privateKeyEnc: string;
  recoveryWrapped: string;
  recoveryProof: string;
}

export async function passwordKeys(
  password: string,
  userId: string,
  dek: Uint8Array,
  params: Argon2Params = DEFAULT_KDF,
): Promise<PasswordKeys & { masterKey: Bytes }> {
  const kdf = newKdfSettings(params);
  const masterKey = await deriveMasterKey(password, kdf);
  return {
    ...kdf,
    masterKey,
    authKey: await authKeyOf(masterKey),
    dekWrapped: await wrapWithMasterKey(masterKey, userId, dek),
  };
}

/** Creates DEK, key pair and recovery key for a new account. */
export async function newAccountKeys(userId: string): Promise<{
  dek: Bytes;
  keyPair: KeyPair;
  recoveryKey: string;
  keys: AccountKeys;
}> {
  const dek = newSymmetricKey();
  const keyPair = generateKeyPair();
  const rk = generateRecoveryKey();
  return {
    dek,
    keyPair,
    recoveryKey: rk.display,
    keys: {
      publicKey: keyPair.publicKey,
      privateKeyEnc: await sealPrivateKey(dek, userId, keyPair.privateKey),
      recoveryWrapped: await wrapWithRecoveryKey(rk.bytes, userId, dek),
      recoveryProof: await recoveryProofOf(rk.bytes),
    },
  };
}
