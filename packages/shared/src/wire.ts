import type { MeDto, VaultMemberDto } from './api.js';
import type { VaultRole } from './features.js';
import type { NoteType } from './notes.js';

/**
 * Wire format: the browser encrypts and decrypts, the server stores and returns ciphertext plus the
 * metadata it needs for access control, statistics and reminders (type, pin, vault, dates, sizes).
 */

export interface EncryptedAttachmentDto {
  id: string;
  /** { name, mime, key } encrypted with the entry's container key. */
  metaEnc: string;
  size: number;
  createdAt: string;
}

export interface NoteRecordDto {
  id: string;
  type: NoteType;
  /** AES-256-GCM envelope of { title, content, fields, customFields, tags }, AAD `note:<id>`. */
  payload: string;
  pinned: boolean;
  vaultId: string | null;
  canEdit: boolean;
  expiresAt: string | null;
  attachments: EncryptedAttachmentDto[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** A shared vault's key, sealed to the signed-in user's public key. */
export interface VaultKeyDto {
  vaultId: string;
  role: VaultRole;
  keyWrapped: string;
  /** Sent back with every write encrypted under this key; the server rejects outdated versions. */
  keyVersion: number;
}

export interface NoteListResponse {
  notes: NoteRecordDto[];
  vaultKeys: VaultKeyDto[];
}

export interface NoteVersionRecordDto {
  id: string;
  type: NoteType;
  payload: string;
  savedAt: string;
  author: string | null;
}

export interface TemplateRecordDto {
  id: string;
  payload: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultMemberRecordDto extends VaultMemberDto {
  publicKey: string | null;
}

export interface VaultRecordDto {
  id: string;
  nameEnc: string;
  role: VaultRole;
  keyWrapped: string;
  keyVersion: number;
  members: VaultMemberRecordDto[];
  noteCount: number;
  /** A member left or was removed and an owner still has to replace the vault key. */
  rotationPending: boolean;
  createdAt: string;
}

/** Everything an owner's browser needs to replace a vault key. */
export interface VaultRotationDataDto {
  keyVersion: number;
  nameEnc: string;
  notes: { id: string; payload: string; updatedAt: string }[];
  versions: { id: string; noteId: string; payload: string }[];
  attachments: { id: string; noteId: string; metaEnc: string }[];
  members: { userId: string; publicKey: string | null }[];
}

export interface PreloginResponse {
  kdfSalt: string;
  kdfParams: string;
}

/** The account's wrapped keys as stored server-side minus the server layer. */
export interface AccountKeysDto {
  userId: string;
  /** DEK wrapped with the password-derived key (or with the passkey PRF key after a passkey sign-in). */
  dekWrapped: string;
  publicKey: string | null;
  privateKeyEnc: string | null;
}

export interface SessionStartResponse {
  user: MeDto;
  /** Null for accounts created by an admin that have not chosen their own password yet. */
  keys: AccountKeysDto | null;
  /** Random key for this session; lets the browser keep its unlocked keys across reloads. */
  sessionKey: string;
}

export interface SessionKeyResponse {
  sessionKey: string;
  publicKey: string | null;
  privateKeyEnc: string | null;
}

export interface RecoverStartResponse {
  userId: string;
  recoveryWrapped: string;
}

export interface EmergencyNotesResponse {
  notes: NoteRecordDto[];
  /** The grantor's DEK, sealed to the contact's public key. */
  keyWrapped: string;
}
