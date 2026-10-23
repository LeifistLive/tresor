import { z } from 'zod';
import { LANGUAGES } from './auth.js';
import { displayNameSchema, usernameSchema } from './auth.schema.js';
import { VAULT_ROLES } from './features.js';
import { NOTE_TYPES } from './notes.js';
import { isoDateSchema } from './notes.schema.js';

/** base64url, as produced by `seal()` (AES-GCM envelope). */
export const envelopeSchema = z
  .string()
  .min(40)
  .max(1_500_000)
  .regex(/^[A-Za-z0-9_-]+$/, 'envelope');

/** Small envelopes (names, wrapped keys, attachment metadata). */
export const smallEnvelopeSchema = envelopeSchema.max(4_096);

/** `<ephemeral public key>.<envelope>` from `sealTo()`. */
export const sealedBoxSchema = z
  .string()
  .max(1_024)
  .regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{40,}$/, 'sealed_box');

/** Version of the vault key a payload was encrypted with (writes into shared vaults). */
export const keyVersionSchema = z.number().int().min(1).max(1_000_000);

/** 32 random bytes, base64url (auth keys, recovery proofs, session keys). */
export const key32Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'key');

/** X25519 public key (raw, base64url). */
export const publicKeySchema = key32Schema;

/** 16 random bytes, standard base64. */
export const kdfSaltSchema = z.string().regex(/^[A-Za-z0-9+/]{22}==$/, 'kdf_salt');
export const kdfParamsSchema = z
  .string()
  .max(40)
  .regex(/^m=\d+,t=\d+,p=\d+$/, 'kdf_params');

export const passwordKeysSchema = z.object({
  kdfSalt: kdfSaltSchema,
  kdfParams: kdfParamsSchema,
  authKey: key32Schema,
  dekWrapped: smallEnvelopeSchema,
});

export const accountKeysSchema = z.object({
  publicKey: publicKeySchema,
  privateKeyEnc: smallEnvelopeSchema,
  recoveryWrapped: smallEnvelopeSchema,
  recoveryProof: key32Schema,
});

// --- Auth ----------------------------------------------------------------------------------------

export const preloginSchema = z.object({ username: z.string().trim().toLowerCase().min(1).max(64) });

export const setupWireSchema = z.object({
  id: z.uuid(),
  username: usernameSchema,
  displayName: displayNameSchema,
  language: z.enum(LANGUAGES).default('de'),
  ...passwordKeysSchema.shape,
  ...accountKeysSchema.shape,
});

export const loginWireSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  authKey: key32Schema,
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const recoverStartSchema = preloginSchema;

export const recoverFinishSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  /** Proof of the recovery key being used. */
  recoveryProof: key32Schema,
  /** The replacement recovery key (wrap + proof); the used one stops working. */
  recoveryWrapped: smallEnvelopeSchema,
  newRecoveryProof: key32Schema,
  ...passwordKeysSchema.shape,
});

// --- Account -------------------------------------------------------------------------------------

export const changePasswordWireSchema = z.object({
  currentAuthKey: key32Schema,
  ...passwordKeysSchema.shape,
  /** Required exactly once: when an admin-created account chooses its own password and gets its keys. */
  account: accountKeysSchema.optional(),
});

export const authConfirmSchema = z.object({ authKey: key32Schema });

export const recoveryKeyWireSchema = z.object({
  authKey: key32Schema,
  recoveryWrapped: smallEnvelopeSchema,
  recoveryProof: key32Schema,
});

export const exportedSchema = z.object({
  format: z.enum(['json', 'markdown', 'tresor']),
  count: z.number().int().min(0).max(1_000_000),
});

// --- Entries -------------------------------------------------------------------------------------

export const noteCreateWireSchema = z.object({
  id: z.uuid(),
  type: z.enum(NOTE_TYPES),
  payload: envelopeSchema,
  pinned: z.boolean().default(false),
  vaultId: z.uuid().nullable().default(null),
  vaultKeyVersion: keyVersionSchema.optional(),
  expiresAt: isoDateSchema.nullable().default(null),
});

export const noteUpdateWireSchema = z.object({
  type: z.enum(NOTE_TYPES).optional(),
  payload: envelopeSchema.optional(),
  vaultKeyVersion: keyVersionSchema.optional(),
  pinned: z.boolean().optional(),
  expiresAt: isoDateSchema.nullable().optional(),
});

const rewrapped = z.object({ id: z.uuid(), payload: envelopeSchema });
const rewrappedMeta = z.object({ id: z.uuid(), metaEnc: smallEnvelopeSchema });

/** Moves an entry into another vault; the browser re-encrypted everything with the target key. */
export const noteMoveSchema = z.object({
  vaultId: z.uuid().nullable(),
  vaultKeyVersion: keyVersionSchema.optional(),
  payload: envelopeSchema,
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  versions: z.array(rewrapped).max(200),
  attachments: z.array(rewrappedMeta).max(500),
});

export const noteImportSchema = z.object({
  notes: z
    .array(
      noteCreateWireSchema.omit({ vaultId: true, vaultKeyVersion: true }).extend({
        createdAt: z.iso.datetime({ offset: true }).optional(),
        updatedAt: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const attachmentFieldsSchema = z.object({
  id: z.uuid(),
  meta: smallEnvelopeSchema,
  keyVersion: z.coerce.number().int().min(1).optional(),
});

export const templateCreateWireSchema = z.object({ id: z.uuid(), payload: envelopeSchema.max(600_000) });
export const templateUpdateWireSchema = z.object({ payload: envelopeSchema.max(600_000) });

// --- Shared vaults -------------------------------------------------------------------------------

export const vaultCreateWireSchema = z.object({
  id: z.uuid(),
  nameEnc: smallEnvelopeSchema,
  keyWrapped: sealedBoxSchema,
});

export const vaultRenameWireSchema = z.object({ nameEnc: smallEnvelopeSchema, keyVersion: keyVersionSchema });

export const vaultMemberAddWireSchema = z.object({
  userId: z.uuid(),
  role: z.enum(VAULT_ROLES).default('editor'),
  keyWrapped: sealedBoxSchema,
  keyVersion: keyVersionSchema,
});

export const vaultRotateSchema = z.object({
  /** The key version the browser rotated from (must still be current). */
  keyVersion: keyVersionSchema,
  nameEnc: smallEnvelopeSchema,
  notes: z
    .array(
      z.object({
        id: z.uuid(),
        payload: envelopeSchema,
        expectedUpdatedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(20_000),
  versions: z.array(rewrapped).max(200_000),
  attachments: z.array(rewrappedMeta).max(50_000),
  members: z
    .array(z.object({ userId: z.uuid(), keyWrapped: sealedBoxSchema }))
    .min(1)
    .max(1_000),
});

// --- Emergency access ----------------------------------------------------------------------------

export const emergencyGrantWireSchema = z.object({
  /** Password confirmation – this hands the account key to another person. */
  authKey: key32Schema,
  id: z.uuid(),
  granteeId: z.uuid(),
  waitDays: z.number().int().min(1).max(90),
  keyWrapped: sealedBoxSchema,
});
