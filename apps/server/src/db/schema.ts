import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Binary column; normalizes driver differences (postgres.js → Buffer, PGlite → Uint8Array). */
const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Buffer.from(value),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  /** SHA-256 of the auth key the browser derives from the password, sealed with the server key. */
  authHash: text('auth_hash').notNull(),
  /** Salt + Argon2id parameters the browser uses to derive the master key from the password. */
  kdfSalt: text('kdf_salt').notNull(),
  kdfParams: text('kdf_params').notNull(),
  /**
   * The user's data-encryption key, wrapped with the password-derived key (+ server layer).
   * Null for admin-created accounts until the user chose a password and their browser created the keys.
   */
  dekWrapped: text('dek_wrapped'),
  /**
   * SHA-256 of a proof derived from the recovery key (not from the DEK, which emergency contacts may hold):
   * lets the browser prove possession of the recovery key without sending it.
   */
  recoveryProofHash: text('recovery_proof_hash'),
  /** The same DEK wrapped with the recovery key (+ server layer; null until the user has one). */
  dekRecoveryWrapped: text('dek_recovery_wrapped'),
  /** X25519 public key (base64url) – lets others share vault keys with this user. */
  publicKey: text('public_key'),
  /** X25519 private key, encrypted with the user's DEK. */
  privateKeyEnc: text('private_key_enc'),
  /** TOTP secret, sealed with the server key (the code is checked before the vault is unlocked). */
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  totpLastStep: integer('totp_last_step'),
  /** Notification channel (JSON), sealed with the server key so alerts work while the vault is locked. */
  notifyConfigEnc: text('notify_config_enc'),
  lastAlertAt: timestamp('last_alert_at', { withTimezone: true }),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  disabled: boolean('disabled').notNull().default(false),
  language: text('language').notNull().default('de'),
  theme: text('theme').notNull().default('system'),
  autoLockMinutes: integer('auto_lock_minutes').notNull().default(15),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastExportAt: timestamp('last_export_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie token – the token itself is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Random per-session key (for the browser's local key cache), encrypted with a key derived from the token. */
    keyEnc: text('key_enc').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

/** Shared vaults. Personal entries have no vault (notes.vault_id is null). */
export const vaults = pgTable('vaults', {
  id: uuid('id').primaryKey(),
  /** Vault name, encrypted with the vault key. */
  nameEnc: text('name_enc').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  /** Set when a member left or was removed; cleared once an owner's browser replaced the vault key. */
  rotationPending: boolean('rotation_pending').notNull().default(false),
  /** Incremented with every key rotation; writes encrypted with an older key are rejected. */
  keyVersion: integer('key_version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const vaultMembers = pgTable(
  'vault_members',
  {
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => vaults.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
    /** The vault key, encrypted to the member's X25519 public key (ECIES). */
    keyWrapped: text('key_wrapped').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.vaultId, t.userId] }), index('vault_members_user_idx').on(t.userId)],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey(),
    /** Owner of a personal entry / creator of a shared entry. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vaultId: uuid('vault_id').references(() => vaults.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    /** AES-256-GCM envelope of the JSON payload { title, content, fields, customFields, tags }. */
    payload: text('payload').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    sizeBytes: integer('size_bytes').notNull().default(0),
    /** Optional reminder date – the only content-related value stored in plain text. */
    expiresAt: date('expires_at', { mode: 'string' }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('notes_user_deleted_idx').on(t.userId, t.deletedAt),
    index('notes_user_type_idx').on(t.userId, t.type),
    index('notes_vault_idx').on(t.vaultId),
    index('notes_expires_idx').on(t.expiresAt),
  ],
);

/** Previous states of an entry (same key and AAD as the entry itself). */
export const noteVersions = pgTable(
  'note_versions',
  {
    id: uuid('id').primaryKey(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** When this state was originally saved. */
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('note_versions_note_idx').on(t.noteId, t.savedAt)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    /** { name, mime, key } encrypted with the entry's container key. */
    metaEnc: text('meta_enc').notNull(),
    /** File content encrypted with its own file key (binary envelope). */
    data: bytea('data').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_note_idx').on(t.noteId)],
);

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    payload: text('payload').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('templates_user_idx').on(t.userId)],
);

export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports'),
    name: text('name').notNull(),
    /** DEK wrapped (in the browser) with a key derived from the PRF output, + server layer; null without PRF. */
    dekWrapped: text('dek_wrapped'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('passkeys_credential_idx').on(t.credentialId), index('passkeys_user_idx').on(t.userId)],
);

export const emergencyAccess = pgTable(
  'emergency_access',
  {
    id: uuid('id').primaryKey(),
    grantorId: uuid('grantor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    granteeId: uuid('grantee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    waitDays: integer('wait_days').notNull(),
    status: text('status', { enum: ['idle', 'requested', 'granted'] })
      .notNull()
      .default('idle'),
    /** The grantor's DEK, encrypted to the grantee's public key. */
    keyWrapped: text('key_wrapped').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('emergency_pair_idx').on(t.grantorId, t.granteeId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actor: text('actor'),
    action: text('action').notNull(),
    target: text('target'),
    ip: text('ip'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_created_idx').on(t.createdAt),
    index('audit_user_created_idx').on(t.userId, t.createdAt),
    index('audit_action_created_idx').on(t.action, t.createdAt),
  ],
);

export const system = pgTable('system', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type VaultMemberRow = typeof vaultMembers.$inferSelect;
export type PasskeyRow = typeof passkeys.$inferSelect;
export type EmergencyRow = typeof emergencyAccess.$inferSelect;
