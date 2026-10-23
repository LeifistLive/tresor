import type { NoteType } from '../notes.js';
import { sanitizeFields } from '../notes.js';
import { type Bytes, fromBase64, toBase64Url } from './bytes.js';
import { AAD, newSymmetricKey } from './keys.js';
import { DecryptionError, open, openBytes, openText, seal, sealBytes } from './primitives.js';

/** Plain content of an entry before encryption (validated by the caller). */
export interface NoteContent {
  title: string;
  content: string;
  fields: Record<string, string>;
  customFields: { label: string; value: string; secret: boolean }[];
  tags: string[];
}

export async function encryptNote(key: Uint8Array, id: string, type: NoteType, content: NoteContent) {
  const clean: NoteContent = { ...content, fields: sanitizeFields(type, content.fields) };
  return seal(key, JSON.stringify(clean), AAD.note(id));
}

/** Returns the parsed JSON; callers validate it with `notePayloadSchema`. */
export async function decryptNote(key: Uint8Array, id: string, payload: string): Promise<unknown> {
  return JSON.parse(await openText(key, payload, AAD.note(id)));
}

export async function encryptTemplate(dek: Uint8Array, id: string, data: unknown) {
  return seal(dek, JSON.stringify(data), AAD.template(id));
}

export async function decryptTemplate(dek: Uint8Array, id: string, payload: string): Promise<unknown> {
  return JSON.parse(await openText(dek, payload, AAD.template(id)));
}

export async function encryptVaultName(vaultKey: Uint8Array, vaultId: string, name: string) {
  return seal(vaultKey, name, AAD.vaultName(vaultId));
}

export async function decryptVaultName(vaultKey: Uint8Array, vaultId: string, nameEnc: string) {
  return openText(vaultKey, nameEnc, AAD.vaultName(vaultId));
}

// --- Attachments -------------------------------------------------------------------------------------
// Every file has its own random key, stored inside the (container-key encrypted) metadata. Moving an entry
// or rotating a vault key then only re-encrypts the small metadata, never the file.

export interface AttachmentMeta {
  name: string;
  mime: string;
  /** Per-file key (base64url). */
  key: string;
  /** Entry the file belongs to – lets the browser notice files moved between entries. */
  note: string;
}

export async function encryptAttachment(
  containerKey: Uint8Array,
  id: string,
  file: Uint8Array,
  info: { name: string; mime: string; note: string },
): Promise<{ metaEnc: string; data: Bytes; meta: AttachmentMeta }> {
  const fileKey = newSymmetricKey();
  const meta: AttachmentMeta = {
    name: info.name,
    mime: info.mime,
    key: toBase64Url(fileKey),
    note: info.note,
  };
  return {
    meta,
    metaEnc: await sealAttachmentMeta(containerKey, id, meta),
    data: await sealBytes(fileKey, file, AAD.attachmentData(id)),
  };
}

export async function sealAttachmentMeta(containerKey: Uint8Array, id: string, meta: AttachmentMeta) {
  return seal(containerKey, JSON.stringify(meta), AAD.attachmentMeta(id));
}

export async function decryptAttachmentMeta(
  containerKey: Uint8Array,
  id: string,
  metaEnc: string,
): Promise<AttachmentMeta> {
  const raw = JSON.parse(await openText(containerKey, metaEnc, AAD.attachmentMeta(id))) as Record<
    string,
    unknown
  >;
  if (typeof raw.key !== 'string' || typeof raw.note !== 'string')
    throw new DecryptionError('Invalid file metadata');
  return {
    name: typeof raw.name === 'string' ? raw.name : 'file',
    mime: typeof raw.mime === 'string' ? raw.mime : 'application/octet-stream',
    key: raw.key,
    note: raw.note,
  };
}

/** Key that decrypts the file content. */
export function attachmentDataKey(meta: AttachmentMeta): Bytes {
  return fromBase64(meta.key);
}

export async function decryptAttachmentData(dataKey: Uint8Array, id: string, data: Uint8Array) {
  return openBytes(dataKey, data, AAD.attachmentData(id));
}

/** Re-encrypts only the metadata envelope from one container key to another. */
export async function rewrapAttachmentMeta(from: Uint8Array, to: Uint8Array, id: string, metaEnc: string) {
  return seal(to, await open(from, metaEnc, AAD.attachmentMeta(id)), AAD.attachmentMeta(id));
}

/** Re-encrypts a note payload (or a version of it) from one container key to another. */
export async function rewrapNote(from: Uint8Array, to: Uint8Array, id: string, payload: string) {
  return seal(to, await open(from, payload, AAD.note(id)), AAD.note(id));
}
