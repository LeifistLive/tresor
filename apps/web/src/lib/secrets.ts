import { FIELD_DEFS, formatMatterCode, type NoteDto } from '@tresor/shared';

const CLEAR_AFTER_SECONDS = 30;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Copies a value and clears the clipboard again after 30 seconds (best effort – browsers only allow
 * writing while the page has focus).
 */
export async function copySecret(value: string): Promise<number> {
  await navigator.clipboard.writeText(value);
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (document.hasFocus()) void navigator.clipboard.writeText('').catch(() => {});
  }, CLEAR_AFTER_SECONDS * 1000);
  return CLEAR_AFTER_SECONDS;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SYMBOLS = '!#$%&*+-=?@_';

/** Cryptographically random password using the Web Crypto API (no modulo bias). */
export function generatePassword(length = 24): string {
  const pool = ALPHABET + SYMBOLS;
  const out: string[] = [];
  const limit = 256 - (256 % pool.length);
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit && out.length < length) out.push(pool[b % pool.length]!);
    }
  }
  return out.join('');
}

/** The value a "copy" shortcut on a card should copy, per entry type. */
export function primarySecret(note: NoteDto): string | null {
  const f = note.fields;
  switch (note.type) {
    case 'matter':
      return f.setupCode ? formatMatterCode(f.setupCode) : (f.qrPayload ?? null);
    case 'login':
    case 'wifi':
      return f.password ?? null;
    case 'card':
      return f.number ?? null;
    case 'secret':
      return f.value ?? null;
    default:
      return null;
  }
}

/** Text used by the local search – secrets are deliberately excluded. */
export function searchableText(note: NoteDto): string {
  const visibleFields = FIELD_DEFS[note.type]
    .filter((d) => d.kind !== 'secret' && d.kind !== 'multiline')
    .map((d) => note.fields[d.key] ?? '');
  return [note.title, note.content, ...note.tags, ...visibleFields].join(' ').toLowerCase();
}
