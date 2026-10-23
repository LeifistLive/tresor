import { randomUUID } from 'node:crypto';
import {
  type EncryptedAttachmentDto,
  LIMITS,
  NOTE_TYPES,
  type NoteRecordDto,
  type NoteType,
} from '@tresor/shared';
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { attachments, type NoteRow, notes, noteVersions } from '../db/schema.js';
import type { Access } from './access.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function asNoteType(type: string): NoteType {
  return (NOTE_TYPES as readonly string[]).includes(type) ? (type as NoteType) : 'note';
}

/** Rows the user may read: own personal entries plus entries of their shared vaults. */
export async function accessibleNoteRows(
  db: Database,
  acc: Access,
  status: 'active' | 'trash' | 'all',
  extra?: SQL,
): Promise<NoteRow[]> {
  const vaultIds = await acc.vaultIds();
  const scope = or(
    and(isNull(notes.vaultId), eq(notes.userId, acc.userId)),
    vaultIds.length ? inArray(notes.vaultId, vaultIds) : undefined,
  );
  const state =
    status === 'all' ? undefined : status === 'trash' ? isNotNull(notes.deletedAt) : isNull(notes.deletedAt);
  return db
    .select()
    .from(notes)
    .where(and(scope, state, extra))
    .orderBy(desc(notes.pinned), desc(notes.updatedAt));
}

/** Personal entries of one user (emergency access). */
export async function personalNoteRows(db: Database, userId: string): Promise<NoteRow[]> {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), isNull(notes.vaultId), isNull(notes.deletedAt)))
    .orderBy(desc(notes.pinned), desc(notes.updatedAt));
}

export async function getNoteRow(db: Tx, id: string): Promise<NoteRow | undefined> {
  const [row] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  return row;
}

async function attachmentsByNote(db: Database, noteIds: string[]) {
  const byNote = new Map<string, EncryptedAttachmentDto[]>();
  if (noteIds.length === 0) return byNote;
  const rows = await db
    .select({
      id: attachments.id,
      noteId: attachments.noteId,
      metaEnc: attachments.metaEnc,
      size: attachments.sizeBytes,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(inArray(attachments.noteId, noteIds))
    .orderBy(attachments.createdAt);
  for (const { noteId, createdAt, ...a } of rows) {
    byNote.set(noteId, [...(byNote.get(noteId) ?? []), { ...a, createdAt: createdAt.toISOString() }]);
  }
  return byNote;
}

/** Converts rows into wire records (ciphertext + metadata); `canEdit` decides per row, null drops the row. */
export async function toRecords(
  db: Database,
  rows: NoteRow[],
  canEdit: (row: NoteRow) => Promise<boolean | null>,
): Promise<NoteRecordDto[]> {
  const files = await attachmentsByNote(
    db,
    rows.map((r) => r.id),
  );
  const out: NoteRecordDto[] = [];
  for (const row of rows) {
    const edit = await canEdit(row);
    if (edit === null) continue;
    out.push({
      id: row.id,
      type: asNoteType(row.type),
      payload: row.payload,
      pinned: row.pinned,
      vaultId: row.vaultId,
      canEdit: edit,
      expiresAt: row.expiresAt,
      attachments: files.get(row.id) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    });
  }
  return out;
}

/** Keeps the previous state of an entry and prunes old versions beyond the limit. */
export async function archiveVersion(tx: Tx, row: NoteRow) {
  await tx.insert(noteVersions).values({
    id: randomUUID(),
    noteId: row.id,
    type: row.type,
    payload: row.payload,
    authorId: row.updatedBy ?? row.userId,
    savedAt: row.updatedAt,
  });
  const keep = await tx
    .select({ id: noteVersions.id })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, row.id))
    .orderBy(desc(noteVersions.savedAt))
    .limit(LIMITS.versionsPerNote);
  await tx.delete(noteVersions).where(
    and(
      eq(noteVersions.noteId, row.id),
      sql`${noteVersions.id} not in (${sql.join(
        keep.map((k) => sql`${k.id}`),
        sql`, `,
      )})`,
    ),
  );
}

/** True when both lists contain exactly the same ids. */
export function sameIds(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((x) => x.id));
  return set.size === a.length && b.every((x) => set.has(x.id));
}
