import { z } from 'zod';
import { NOTE_TYPES } from './notes.js';
import { isoDateSchema, notePayloadSchema } from './notes.schema.js';

/** Version of the JSON export document. */
export const EXPORT_VERSION = 1;

export const exportedAttachmentSchema = z.object({
  name: z.string().max(255),
  mime: z.string().max(100).default('application/octet-stream'),
  data: z.base64(),
});

/** One entry inside an export file (lenient: unknown values fall back to defaults). */
export const exportedNoteSchema = notePayloadSchema.extend({
  type: z.enum(NOTE_TYPES).catch('note'),
  pinned: z.boolean().default(false),
  expiresAt: isoDateSchema.nullable().optional().catch(null),
  createdAt: z.iso.datetime({ offset: true }).optional().catch(undefined),
  updatedAt: z.iso.datetime({ offset: true }).optional().catch(undefined),
  attachments: z.array(exportedAttachmentSchema).max(200).optional().catch([]),
});
export type ExportedNote = z.infer<typeof exportedNoteSchema>;

export const exportFileSchema = z.object({
  format: z.literal('tresor-export'),
  notes: z.array(z.unknown()).max(100_000),
});

/** Passphrase-protected backup file (`.tresor`); independent of the server's master key. */
export const encryptedBackupFileSchema = z.object({
  format: z.literal('tresor-backup'),
  version: z.literal(1),
  kdf: z.object({ alg: z.literal('argon2id'), params: z.string().max(40), salt: z.string().max(64) }),
  data: z.string(),
});
