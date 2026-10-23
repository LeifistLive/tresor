import type { CustomField, NoteType } from '@tresor/shared';

/** Initial values for the next "new entry" editor (from a scanned QR code or a template). */
export interface Prefill {
  type: NoteType;
  title?: string;
  content?: string;
  fields?: Record<string, string>;
  customFields?: CustomField[];
  tags?: string[];
}

// Kept in memory only – scanned secrets must never land in browser storage.
let pending: Prefill | null = null;

export function setPrefill(p: Prefill) {
  pending = p;
}

export function takePrefill(type: NoteType): Prefill | null {
  const p = pending;
  pending = null;
  return p && p.type === type ? p : null;
}
