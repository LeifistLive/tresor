import type { AccountKeysDto, Language, MeDto } from '@tresor/shared';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  authKeyFromPassword,
  checkAuthVerifier,
  newKdfSalt,
  proofHash,
  SERVER_AAD,
  sealAuthVerifier,
} from '../crypto/keys.js';
import { formatParams, parseParams } from '../crypto/primitives.js';
import type { Database } from '../db/client.js';
import { passkeys, type UserRow, users } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import { readNotifyConfig } from './notify.js';

export async function toMe(app: FastifyInstance, user: UserRow): Promise<MeDto> {
  const [pk] = await app.db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, user.id));
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    language: user.language as Language,
    theme: user.theme as MeDto['theme'],
    autoLockMinutes: user.autoLockMinutes,
    totpEnabled: user.totpEnabled,
    hasRecoveryKey: user.dekRecoveryWrapped !== null,
    hasKeys: user.dekWrapped !== null,
    mustChangePassword: user.mustChangePassword || user.dekWrapped === null,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastExportAt: user.lastExportAt?.toISOString() ?? null,
    passwordChangedAt: user.passwordChangedAt.toISOString(),
    passkeyCount: pk?.n ?? 0,
    notificationsEnabled: readNotifyConfig(app, user)?.enabled ?? false,
  };
}

export async function findUserByUsername(db: Database, username: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return row;
}

export async function findUserById(db: Database, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

/** The wrapped keys a browser needs after signing in (server layer removed). */
export function accountKeys(app: FastifyInstance, user: UserRow, dekWrapped?: string): AccountKeysDto | null {
  if (!user.dekWrapped) return null;
  return {
    userId: user.id,
    dekWrapped:
      dekWrapped ?? app.keys.serverOpen(user.dekWrapped, SERVER_AAD.passwordWrap(user.id)).toString('utf8'),
    publicKey: user.publicKey,
    privateKeyEnc: user.privateKeyEnc,
  };
}

/** Rejects key derivation settings that are weaker than the server's configuration or absurdly expensive. */
export function assertKdfParams(app: FastifyInstance, kdfParams: string): void {
  let p: ReturnType<typeof parseParams>;
  try {
    p = parseParams(kdfParams);
  } catch {
    throw badRequest('VALIDATION', 'Unsupported key derivation parameters');
  }
  const ok =
    p.memoryKiB >= app.argon.memoryKiB &&
    p.iterations >= app.argon.iterations &&
    p.memoryKiB <= 1_048_576 &&
    p.iterations <= 10 &&
    p.parallelism >= 1 &&
    p.parallelism <= 8;
  if (!ok) throw badRequest('VALIDATION', 'Key derivation parameters are too weak or too expensive');
}

export interface PasswordInput {
  kdfSalt: string;
  kdfParams: string;
  authKey: string;
  dekWrapped: string;
}

/** Columns for a password chosen in the browser: login verifier + wrapped DEK (+ server layer). */
export function passwordColumns(app: FastifyInstance, userId: string, input: PasswordInput) {
  assertKdfParams(app, input.kdfParams);
  return {
    authHash: sealAuthVerifier(app.keys, userId, input.authKey),
    kdfSalt: input.kdfSalt,
    kdfParams: input.kdfParams,
    dekWrapped: app.keys.serverSeal(input.dekWrapped, SERVER_AAD.passwordWrap(userId)),
    passwordChangedAt: new Date(),
  } satisfies Partial<typeof users.$inferInsert>;
}

export interface AccountInput {
  publicKey: string;
  privateKeyEnc: string;
  recoveryWrapped: string;
  recoveryProof: string;
}

/** Columns for a brand-new key set (first admin, or an admin-created account choosing its password). */
export function accountColumns(app: FastifyInstance, userId: string, input: AccountInput) {
  return {
    publicKey: input.publicKey,
    privateKeyEnc: input.privateKeyEnc,
    ...recoveryColumns(app, userId, input.recoveryWrapped, input.recoveryProof),
  } satisfies Partial<typeof users.$inferInsert>;
}

/** A (new) recovery key: its wrap of the DEK (+ server layer) and the hash of its proof. */
export function recoveryColumns(app: FastifyInstance, userId: string, wrapped: string, proof: string) {
  return {
    dekRecoveryWrapped: app.keys.serverSeal(wrapped, SERVER_AAD.recoveryWrap(userId)),
    recoveryProofHash: proofHash(proof),
  } satisfies Partial<typeof users.$inferInsert>;
}

/**
 * Temporary credentials set by an admin (new account or reset). The account has no keys yet: the user's
 * browser creates them when they choose their own password, so the admin never learns anything about them.
 * The temporary password itself protects nothing and is therefore handled server-side.
 */
export async function temporaryCredentialColumns(app: FastifyInstance, userId: string, password: string) {
  const kdfSalt = newKdfSalt();
  const kdfParams = formatParams(app.argon);
  const authKey = await authKeyFromPassword(password, kdfSalt, kdfParams);
  return {
    authHash: sealAuthVerifier(app.keys, userId, authKey),
    kdfSalt,
    kdfParams,
    dekWrapped: null,
    recoveryProofHash: null,
    dekRecoveryWrapped: null,
    publicKey: null,
    privateKeyEnc: null,
    totpEnabled: false,
    totpSecretEnc: null,
    totpLastStep: null,
    mustChangePassword: true,
    passwordChangedAt: new Date(),
  } satisfies Partial<typeof users.$inferInsert>;
}

export function verifyAuthKey(app: FastifyInstance, user: UserRow, authKey: string): boolean {
  return checkAuthVerifier(app.keys, user.id, user.authHash, authKey);
}
