import type { Language, Role, Theme } from './auth.js';
import type { NotifyEvent, NotifyProvider, VaultRole } from './features.js';
import type { NoteType } from './notes.js';

/** Machine-readable error codes returned by the API as `{ error: { code, message } }`. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'TOTP_REQUIRED'
  | 'TOTP_INVALID'
  | 'INVALID_RECOVERY_KEY'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'SETUP_DONE'
  | 'LAST_ADMIN'
  | 'BAD_PASSPHRASE'
  | 'BAD_IMPORT'
  | 'NO_KEYS'
  | 'READ_ONLY'
  | 'TOO_LARGE'
  | 'PASSKEY_FAILED'
  | 'PASSKEY_NO_PRF'
  | 'NOTIFY_FAILED'
  | 'STALE'
  | 'LOCKED'
  | 'WEAK_KDF'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface MeDto {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  language: Language;
  theme: Theme;
  autoLockMinutes: number;
  totpEnabled: boolean;
  hasRecoveryKey: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lastExportAt: string | null;
  passwordChangedAt: string;
  /** False for admin-created accounts until the user picked a password (no keys yet). */
  hasKeys: boolean;
  passkeyCount: number;
  notificationsEnabled: boolean;
}

export interface SessionDto {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface DayCount {
  date: string;
  count: number;
}

/** Statistics the server can compute from metadata alone. */
export interface ServerStatsDto {
  total: number;
  pinned: number;
  trashed: number;
  byType: Record<NoteType, number>;
  createdLast7Days: number;
  activity: DayCount[];
  storageBytes: number;
  security: {
    score: number;
    totpEnabled: boolean;
    hasRecoveryKey: boolean;
    autoLockEnabled: boolean;
    passwordAgeDays: number;
    lastExportDays: number | null;
  };
}

/** Dashboard statistics: server metadata plus the parts the browser computes from decrypted entries. */
export interface UserStatsDto extends ServerStatsDto {
  topTags: { tag: string; count: number }[];
  recent: { id: string; type: NoteType; title: string; updatedAt: string }[];
  expiringSoon: { id: string; type: NoteType; title: string; expiresAt: string }[];
}

export interface AdminStatsDto {
  users: { total: number; admins: number; disabled: number; pendingPasswordChange: number };
  notes: { total: number; trashed: number; storageBytes: number; byType: Record<NoteType, number> };
  logins: DayCount[];
  failedLogins14d: number;
  successfulLogins14d: number;
  lastFailedLogin: { at: string; ip: string | null; username: string | null } | null;
  activeSessions: number;
  notesPerUser: { username: string; displayName: string; count: number }[];
  system: {
    version: string;
    uptimeSeconds: number;
    databaseBytes: number | null;
    postgresVersion: string | null;
  };
}

export interface AdminUserDto {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  noteCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuditEntryDto {
  id: string;
  action: string;
  actor: string | null;
  target: string | null;
  ip: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface LoginResponse {
  user: MeDto;
}

export interface RecoveryKeyResponse {
  recoveryKey: string;
}

export interface TotpSetupResponse {
  secret: string;
  uri: string;
}

export interface ServerInfoDto {
  version: string;
  /** Argon2id parameters for new passwords ("m=…,t=…,p=…"). */
  kdfParams: string;
  trashRetentionDays: number;
  sessionIdleMinutes: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

export interface DirectoryUserDto {
  id: string;
  username: string;
  displayName: string;
  /** X25519 public key, or null while the account has no keys yet (admin-created, not signed in). */
  publicKey: string | null;
}

export interface VaultMemberDto {
  userId: string;
  username: string;
  displayName: string;
  role: VaultRole;
  /** Fingerprint of the member's public key (computed in the browser) – compare it out of band. */
  fingerprint?: string;
}

export interface VaultDto {
  id: string;
  name: string;
  role: VaultRole;
  members: VaultMemberDto[];
  noteCount: number;
  /** A member left; an owner's browser replaces the vault key automatically. */
  rotationPending: boolean;
  createdAt: string;
}

export interface PasskeyDto {
  id: string;
  name: string;
  canUnlock: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export type EmergencyStatus = 'idle' | 'requested' | 'granted';

export interface EmergencyAccessDto {
  id: string;
  grantor: { id: string; username: string; displayName: string };
  grantee: { id: string; username: string; displayName: string };
  waitDays: number;
  status: EmergencyStatus;
  requestedAt: string | null;
  /** When access opens automatically (requested + wait days), or null. */
  availableAt: string | null;
  /** True when the grantee can open the grantor's vault right now. */
  accessible: boolean;
  createdAt: string;
}

export interface NotificationConfigDto {
  enabled: boolean;
  provider: NotifyProvider;
  url: string;
  topic: string;
  hasToken: boolean;
  events: Record<NotifyEvent, boolean>;
}

export interface WebAuthnOptionsResponse {
  challengeId: string;
  /** PublicKeyCredentialCreationOptionsJSON / RequestOptionsJSON (base64url encoded binary fields). */
  options: Record<string, unknown>;
  /** Salt for the PRF extension (base64url). */
  prfSalt: string;
}
