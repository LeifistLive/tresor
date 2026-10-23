/** All entry types a vault item can have. The order is the display order in the UI. */
export const NOTE_TYPES = ['note', 'matter', 'login', 'wifi', 'card', 'secret'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export type FieldKind =
  | 'text'
  | 'secret'
  | 'url'
  | 'select'
  | 'matterCode'
  | 'matterQr'
  | 'multiline'
  /** TOTP seed (Base32 or otpauth:// URI) – the UI shows the live 6-digit code. */
  | 'totp';

export interface FieldDef {
  key: string;
  kind: FieldKind;
  /** Render the value in the monospace font (codes, numbers, keys). */
  mono?: boolean;
  /** Allowed values for `select` fields. */
  options?: readonly string[];
}

/**
 * Structured fields per entry type. Labels live in the i18n files under `fields.<type>.<key>`.
 * Every type additionally has a free-form Markdown `content` and `tags`.
 */
export const FIELD_DEFS: Record<NoteType, readonly FieldDef[]> = {
  note: [],
  matter: [
    { key: 'setupCode', kind: 'matterCode', mono: true },
    { key: 'qrPayload', kind: 'matterQr', mono: true },
    { key: 'manufacturer', kind: 'text' },
    { key: 'model', kind: 'text' },
    { key: 'room', kind: 'text' },
    { key: 'network', kind: 'select', options: ['thread', 'wifi', 'ethernet'] },
  ],
  login: [
    { key: 'username', kind: 'text', mono: true },
    { key: 'password', kind: 'secret', mono: true },
    { key: 'url', kind: 'url' },
    { key: 'totp', kind: 'totp', mono: true },
  ],
  wifi: [
    { key: 'ssid', kind: 'text', mono: true },
    { key: 'password', kind: 'secret', mono: true },
    { key: 'security', kind: 'select', options: ['WPA', 'WEP', 'nopass'] },
  ],
  card: [
    { key: 'holder', kind: 'text' },
    { key: 'number', kind: 'secret', mono: true },
    { key: 'expiry', kind: 'text', mono: true },
    { key: 'cvc', kind: 'secret', mono: true },
    { key: 'pin', kind: 'secret', mono: true },
  ],
  secret: [{ key: 'value', kind: 'multiline', mono: true }],
};

/** Field kinds whose values are masked in the UI until revealed. */
export const SECRET_FIELD_KINDS: readonly FieldKind[] = ['secret', 'multiline', 'totp'];

export const LIMITS = {
  title: 200,
  content: 100_000,
  fieldValue: 4_096,
  tags: 20,
  tag: 40,
  customFields: 30,
  customLabel: 64,
  versionsPerNote: 25,
  vaultName: 80,
  templateName: 80,
} as const;

/** Drops unknown field keys and empty values so only the fields of the entry's type are stored. */
export function sanitizeFields(type: NoteType, fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of FIELD_DEFS[type]) {
    const value = fields[def.key];
    if (value === undefined || value === '') continue;
    if (def.kind === 'select' && def.options && !def.options.includes(value)) continue;
    out[def.key] = value;
  }
  return out;
}

export interface CustomField {
  label: string;
  value: string;
  secret: boolean;
}

export interface AttachmentDto {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface NoteDto {
  id: string;
  type: NoteType;
  title: string;
  content: string;
  fields: Record<string, string>;
  customFields: CustomField[];
  tags: string[];
  pinned: boolean;
  /** Shared vault the entry belongs to, or null for the owner's personal vault. */
  vaultId: string | null;
  /** False for read-only access (viewer role, emergency access). */
  canEdit: boolean;
  /** Optional reminder date (YYYY-MM-DD). Stored unencrypted so reminders work while the vault is locked. */
  expiresAt: string | null;
  attachments: AttachmentDto[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteVersionDto {
  id: string;
  type: NoteType;
  title: string;
  createdAt: string;
  author: string | null;
}

/** Plain-text template for new entries. Stored encrypted with the user's key. */
export interface TemplateDto {
  id: string;
  name: string;
  type: NoteType;
  title: string;
  content: string;
  fields: Record<string, string>;
  customFields: CustomField[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
