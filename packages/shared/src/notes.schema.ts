import { z } from 'zod';
import { LIMITS, NOTE_TYPES } from './notes.js';

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((t) => t.replace(/^#+/, '').replace(/\s+/g, '-'))
  .pipe(z.string().min(1).max(LIMITS.tag));

const titleSchema = z.string().trim().max(LIMITS.title);
const contentSchema = z.string().max(LIMITS.content);
const fieldsSchema = z.record(z.string().max(64), z.string().max(LIMITS.fieldValue));
const tagsSchema = z
  .array(tagSchema)
  .max(LIMITS.tags)
  .transform((tags) => [...new Set(tags)]);

export const customFieldSchema = z.object({
  label: z.string().trim().max(LIMITS.customLabel),
  value: z.string().max(LIMITS.fieldValue),
  secret: z.boolean().default(false),
});
const customFieldsSchema = z
  .array(customFieldSchema)
  .max(LIMITS.customFields)
  .transform((list) => list.filter((f) => f.label !== '' || f.value !== ''));

/** YYYY-MM-DD (calendar date without time zone). */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_format');

/** Plain-text shape of an entry. This whole object is encrypted before it touches the database. */
export const notePayloadSchema = z.object({
  title: titleSchema.default(''),
  content: contentSchema.default(''),
  fields: fieldsSchema.default({}),
  customFields: customFieldsSchema.default([]),
  tags: tagsSchema.default([]),
});
export type NotePayload = z.infer<typeof notePayloadSchema>;

export const noteInputSchema = notePayloadSchema.extend({
  type: z.enum(NOTE_TYPES),
  pinned: z.boolean().default(false),
  vaultId: z.uuid().nullable().default(null),
  expiresAt: isoDateSchema.nullable().default(null),
});
export type NoteInput = z.input<typeof noteInputSchema>;

/** Partial update – deliberately without defaults so omitted keys stay untouched. */
export const noteUpdateSchema = z.object({
  type: z.enum(NOTE_TYPES).optional(),
  title: titleSchema.optional(),
  content: contentSchema.optional(),
  fields: fieldsSchema.optional(),
  customFields: customFieldsSchema.optional(),
  tags: tagsSchema.optional(),
  pinned: z.boolean().optional(),
  /** Moves the entry into another vault (null = personal). */
  vaultId: z.uuid().nullable().optional(),
  expiresAt: isoDateSchema.nullable().optional(),
});
export type NoteUpdate = z.input<typeof noteUpdateSchema>;

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.templateName),
  type: z.enum(NOTE_TYPES),
  title: titleSchema.default(''),
  content: contentSchema.default(''),
  fields: fieldsSchema.default({}),
  customFields: z.array(customFieldSchema).max(LIMITS.customFields).default([]),
  tags: tagsSchema.default([]),
});
export type TemplateInput = z.input<typeof templateInputSchema>;
