import { gunzipSync, gzipSync, strToU8, zipSync } from 'fflate';
import { fromBase64, toBase64, utf8 } from '../crypto/bytes.js';
import { DEFAULT_KDF } from '../crypto/keys.js';
import {
  type Argon2Params,
  argon2id,
  DecryptionError,
  formatParams,
  open,
  parseParams,
  seal,
} from '../crypto/primitives.js';
import type { NoteDto } from '../notes.js';
import { FIELD_DEFS } from '../notes.js';
import { EXPORT_VERSION, encryptedBackupFileSchema } from '../transfer.schema.js';

export interface ExportedFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

/** The JSON export document (entries with custom fields, expiry dates and attachments). */
export function exportDocument(username: string, list: NoteDto[], files: Map<string, ExportedFile[]>) {
  return {
    format: 'tresor-export' as const,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    user: username,
    notes: list.map(({ deletedAt: _d, canEdit: _c, vaultId: _v, attachments: _a, ...n }) => ({
      ...n,
      attachments: (files.get(n.id) ?? []).map((f) => ({
        name: f.name,
        mime: f.mime,
        data: toBase64(f.data),
      })),
    })),
  };
}

/** Removes characters that are unsafe in file names. */
export function safeFilename(name: string): string {
  const cleaned = [...name]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/"<>|:*?'.includes(c) ? '_' : c))
    .join('')
    .trim();
  return (cleaned || 'file').slice(0, 180);
}

function slugify(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}

function toMarkdown(n: NoteDto, files: ExportedFile[], folder: string): string {
  const y = (v: string) => JSON.stringify(v); // JSON strings are valid YAML scalars
  const lines = ['---', `title: ${y(n.title)}`, `type: ${n.type}`];
  if (n.tags.length) lines.push(`tags: [${n.tags.map(y).join(', ')}]`);
  if (n.pinned) lines.push('pinned: true');
  if (n.expiresAt) lines.push(`expires: ${n.expiresAt}`);
  lines.push(`created: ${n.createdAt}`, `updated: ${n.updatedAt}`);
  const fieldEntries = FIELD_DEFS[n.type].filter((d) => n.fields[d.key]);
  if (fieldEntries.length) {
    lines.push('fields:');
    for (const d of fieldEntries) lines.push(`  ${d.key}: ${y(n.fields[d.key]!)}`);
  }
  if (n.customFields.length) {
    lines.push('custom:');
    for (const f of n.customFields)
      lines.push(`  - { label: ${y(f.label)}, value: ${y(f.value)}, secret: ${f.secret} }`);
  }
  lines.push('---', '', n.title ? `# ${n.title}` : '', '', n.content, '');
  if (files.length) {
    lines.push('## Attachments', '');
    for (const f of files) lines.push(`- [${f.name}](${encodeURI(`${folder}/${f.name}`)})`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Markdown files (one per entry, grouped by type) plus attachments, as a ZIP archive. */
export function markdownZip(list: NoteDto[], files: Map<string, ExportedFile[]>): Uint8Array {
  const zip: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const n of list) {
    let name = `${n.type}/${slugify(n.title)}`;
    for (let i = 2; used.has(name); i++) name = `${n.type}/${slugify(n.title)}-${i}`;
    used.add(name);
    const own = files.get(n.id) ?? [];
    const folder = `${name.split('/').pop()}.files`;
    zip[`${name}.md`] = strToU8(toMarkdown(n, own, folder));
    for (const f of own) zip[`${name}.files/${safeFilename(f.name)}`] = f.data;
  }
  return zipSync(zip, { level: 6 });
}

// --- Passphrase-protected backup (`.tresor`) --------------------------------------------------------

const BACKUP_AAD = 'tresor-backup/v1';
/** Decompressed backups larger than this are refused (zip bombs). */
const MAX_BACKUP_BYTES = 500 * 1024 * 1024;

export async function encryptBackup(json: string, passphrase: string, params: Argon2Params = DEFAULT_KDF) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await argon2id(passphrase, salt, params);
  return JSON.stringify(
    {
      format: 'tresor-backup',
      version: 1,
      kdf: { alg: 'argon2id', params: formatParams(params), salt: toBase64(salt) },
      data: await seal(key, gzipSync(utf8(json)), BACKUP_AAD),
    },
    null,
    2,
  );
}

export async function decryptBackup(fileContent: string, passphrase: string): Promise<string> {
  let file: ReturnType<typeof encryptedBackupFileSchema.parse>;
  try {
    file = encryptedBackupFileSchema.parse(JSON.parse(fileContent));
  } catch {
    throw new DecryptionError('Not a Tresor backup file');
  }
  let params: Argon2Params;
  try {
    params = parseParams(file.kdf.params); // bounded, so a crafted file cannot exhaust memory
  } catch {
    throw new DecryptionError('Unsupported key derivation parameters');
  }
  const key = await argon2id(passphrase, fromBase64(file.kdf.salt), params);
  const compressed = await open(key, file.data, BACKUP_AAD);
  // gzip stores the uncompressed size (mod 2^32) in its last four bytes – refuse absurd sizes up front.
  const n = compressed.length;
  const declared =
    n >= 4
      ? (compressed[n - 4]! |
          (compressed[n - 3]! << 8) |
          (compressed[n - 2]! << 16) |
          (compressed[n - 1]! << 24)) >>>
        0
      : 0;
  if (declared > MAX_BACKUP_BYTES) throw new DecryptionError('Backup too large');
  const out = gunzipSync(compressed);
  if (out.length > MAX_BACKUP_BYTES) throw new DecryptionError('Backup too large');
  return new TextDecoder().decode(out);
}
