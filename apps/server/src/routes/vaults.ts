import {
  type DirectoryUserDto,
  type VaultRecordDto,
  type VaultRotationDataDto,
  vaultCreateWireSchema,
  vaultMemberAddWireSchema,
  vaultMemberRoleSchema,
  vaultRenameWireSchema,
  vaultRotateSchema,
} from '@tresor/shared';
import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { attachments, notes, noteVersions, users, vaultMembers, vaults } from '../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { auth, requireAuth } from '../plugins/auth.js';
import { access, lockVault, lockVaultKey } from '../services/access.js';
import { audit } from '../services/audit.js';
import { findUserById } from '../services/users.js';

const idParams = z.object({ id: z.uuid() });
const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });
const stale = () => new AppError(409, 'STALE', 'The vault changed in the meantime – reload and try again');

export async function vaultRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  async function vaultRecords(req: FastifyRequest, ids?: string[]): Promise<VaultRecordDto[]> {
    const acc = access(app, req);
    const mine = await acc.loadMemberships();
    const vaultIds = (ids ?? [...mine.keys()]).filter((id) => mine.has(id));
    if (vaultIds.length === 0) return [];
    const rows = await app.db
      .select()
      .from(vaults)
      .where(inArray(vaults.id, vaultIds))
      .orderBy(asc(vaults.createdAt));
    const members = await app.db
      .select({
        vaultId: vaultMembers.vaultId,
        userId: vaultMembers.userId,
        role: vaultMembers.role,
        username: users.username,
        displayName: users.displayName,
        publicKey: users.publicKey,
      })
      .from(vaultMembers)
      .innerJoin(users, eq(users.id, vaultMembers.userId))
      .where(inArray(vaultMembers.vaultId, vaultIds))
      .orderBy(asc(vaultMembers.createdAt));
    const counts = await app.db
      .select({ vaultId: notes.vaultId, n: count() })
      .from(notes)
      .where(and(inArray(notes.vaultId, vaultIds), isNull(notes.deletedAt)))
      .groupBy(notes.vaultId);

    return rows.map((v) => {
      const m = mine.get(v.id)!;
      return {
        id: v.id,
        nameEnc: v.nameEnc,
        role: m.role,
        keyWrapped: m.keyWrapped,
        keyVersion: v.keyVersion,
        members: members.filter((x) => x.vaultId === v.id).map(({ vaultId: _v, ...x }) => x),
        noteCount: Number(counts.find((c) => c.vaultId === v.id)?.n ?? 0),
        rotationPending: v.rotationPending,
        createdAt: v.createdAt.toISOString(),
      };
    });
  }

  async function one(req: FastifyRequest, id: string) {
    access(app, req).invalidate(); // memberships may have changed within this request
    const [dto] = await vaultRecords(req, [id]);
    if (!dto) throw notFound('Vault not found');
    return dto;
  }

  /** Users that entries can be shared with (everyone active except the caller), with their public keys. */
  app.get('/users/directory', async (req) => {
    const { user } = auth(req);
    const rows = await app.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        publicKey: users.publicKey,
      })
      .from(users)
      .where(and(ne(users.id, user.id), eq(users.disabled, false)))
      .orderBy(asc(users.displayName));
    const list: DirectoryUserDto[] = rows;
    return { users: list };
  });

  app.get('/vaults', async (req) => ({ vaults: await vaultRecords(req) }));

  /** The browser generated the vault key, encrypted the name and sealed the key to the creator. */
  app.post('/vaults', async (req, reply) => {
    const { user } = auth(req);
    const input = vaultCreateWireSchema.parse(req.body);
    if (!user.publicKey) throw new AppError(409, 'NO_KEYS', 'Your account has no sharing keys yet');
    try {
      await app.db.transaction(async (tx) => {
        await tx.insert(vaults).values({ id: input.id, nameEnc: input.nameEnc, createdBy: user.id });
        await tx
          .insert(vaultMembers)
          .values({ vaultId: input.id, userId: user.id, role: 'owner', keyWrapped: input.keyWrapped });
      });
    } catch (err) {
      if (
        (err as { code?: string }).code === '23505' ||
        (err as { cause?: { code?: string } }).cause?.code === '23505'
      )
        throw conflict('CONFLICT', 'Vault id already exists');
      throw err;
    }
    await audit(app, req, { action: 'vault.create', target: input.id });
    reply.code(201);
    return { vault: await one(req, input.id) };
  });

  app.patch('/vaults/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const input = vaultRenameWireSchema.parse(req.body);
    await access(app, req).requireVault(id, 'owner');
    await app.db.transaction(async (tx) => {
      await lockVaultKey(tx, id, input.keyVersion);
      await tx.update(vaults).set({ nameEnc: input.nameEnc, updatedAt: new Date() }).where(eq(vaults.id, id));
    });
    await audit(app, req, { action: 'vault.update', target: id });
    return { vault: await one(req, id) };
  });

  app.delete('/vaults/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    await access(app, req).requireVault(id, 'owner');
    await app.db.delete(vaults).where(eq(vaults.id, id));
    await audit(app, req, { action: 'vault.delete', target: id });
    return { ok: true };
  });

  /** Adds a member; the owner's browser sealed the current vault key to the member's public key. */
  app.post('/vaults/:id/members', async (req) => {
    const { id } = idParams.parse(req.params);
    const input = vaultMemberAddWireSchema.parse(req.body);
    await access(app, req).requireVault(id, 'owner');
    const target = await findUserById(app.db, input.userId);
    if (!target || target.disabled) throw notFound('User not found');
    if (!target.publicKey) {
      throw new AppError(
        409,
        'NO_KEYS',
        'This user has to sign in once before entries can be shared with them',
      );
    }
    const inserted = await app.db.transaction(async (tx) => {
      await lockVaultKey(tx, id, input.keyVersion);
      return tx
        .insert(vaultMembers)
        .values({ vaultId: id, userId: target.id, role: input.role, keyWrapped: input.keyWrapped })
        .onConflictDoNothing()
        .returning();
    });
    if (inserted.length === 0) throw conflict('CONFLICT', 'Already a member');
    await audit(app, req, {
      action: 'vault.member_add',
      target: id,
      meta: { user: target.username, role: input.role },
    });
    return { vault: await one(req, id) };
  });

  const ownerCount = async (vaultId: string) => {
    const [r] = await app.db
      .select({ n: count() })
      .from(vaultMembers)
      .where(and(eq(vaultMembers.vaultId, vaultId), eq(vaultMembers.role, 'owner')));
    return Number(r?.n ?? 0);
  };

  app.patch('/vaults/:id/members/:userId', async (req) => {
    const { id, userId } = memberParams.parse(req.params);
    const { role } = vaultMemberRoleSchema.parse(req.body);
    await access(app, req).requireVault(id, 'owner');
    const [member] = await app.db
      .select()
      .from(vaultMembers)
      .where(and(eq(vaultMembers.vaultId, id), eq(vaultMembers.userId, userId)));
    if (!member) throw notFound('Member not found');
    if (member.role === 'owner' && role !== 'owner' && (await ownerCount(id)) <= 1) {
      throw badRequest('BAD_REQUEST', 'A vault needs at least one owner');
    }
    await app.db
      .update(vaultMembers)
      .set({ role })
      .where(and(eq(vaultMembers.vaultId, id), eq(vaultMembers.userId, userId)));
    await audit(app, req, { action: 'vault.member_update', target: id, meta: { userId, role } });
    return { vault: await one(req, id) };
  });

  /**
   * Removes a member (owners) or leaves the vault (any member, with their own id). Access ends immediately;
   * the vault is marked so that an owner's browser replaces the vault key (see /rotate).
   */
  app.delete('/vaults/:id/members/:userId', async (req) => {
    const { user } = auth(req);
    const { id, userId } = memberParams.parse(req.params);
    const self = userId === user.id;
    await access(app, req).requireVault(id, self ? 'viewer' : 'owner');
    const [member] = await app.db
      .select()
      .from(vaultMembers)
      .where(and(eq(vaultMembers.vaultId, id), eq(vaultMembers.userId, userId)));
    if (!member) throw notFound('Member not found');
    const [{ n: total } = { n: 0 }] = await app.db
      .select({ n: count() })
      .from(vaultMembers)
      .where(eq(vaultMembers.vaultId, id));

    if (Number(total) <= 1) {
      // Last member leaves → the vault and its entries are deleted.
      await app.db.delete(vaults).where(eq(vaults.id, id));
      await audit(app, req, { action: 'vault.delete', target: id, meta: { reason: 'last_member_left' } });
      return { ok: true, deleted: true };
    }
    if (member.role === 'owner' && (await ownerCount(id)) <= 1) {
      throw badRequest('BAD_REQUEST', 'Make another member owner first');
    }
    await app.db.transaction(async (tx) => {
      await lockVault(tx, id);
      await tx.delete(vaultMembers).where(and(eq(vaultMembers.vaultId, id), eq(vaultMembers.userId, userId)));
      // The remaining owner takes over entries created by the removed member.
      const [heir] = await tx
        .select()
        .from(vaultMembers)
        .where(and(eq(vaultMembers.vaultId, id), eq(vaultMembers.role, 'owner')))
        .orderBy(asc(vaultMembers.createdAt))
        .limit(1);
      if (heir) {
        await tx
          .update(notes)
          .set({ userId: heir.userId })
          .where(and(eq(notes.vaultId, id), eq(notes.userId, userId)));
      }
      await tx.update(vaults).set({ rotationPending: true }).where(eq(vaults.id, id));
    });
    await audit(app, req, {
      action: self ? 'vault.leave' : 'vault.member_remove',
      target: id,
      meta: { userId },
    });
    return { ok: true, deleted: false };
  });

  /** Everything an owner's browser needs to re-encrypt the vault with a new key. */
  app.get('/vaults/:id/rotation', async (req): Promise<VaultRotationDataDto> => {
    const { id } = idParams.parse(req.params);
    await access(app, req).requireVault(id, 'owner');
    const [vault] = await app.db.select().from(vaults).where(eq(vaults.id, id));
    if (!vault) throw notFound('Vault not found');
    const rows = await app.db
      .select({ id: notes.id, payload: notes.payload, updatedAt: notes.updatedAt })
      .from(notes)
      .where(eq(notes.vaultId, id));
    const noteIds = rows.map((r) => r.id);
    const versions = noteIds.length
      ? await app.db
          .select({ id: noteVersions.id, noteId: noteVersions.noteId, payload: noteVersions.payload })
          .from(noteVersions)
          .where(inArray(noteVersions.noteId, noteIds))
      : [];
    const files = noteIds.length
      ? await app.db
          .select({ id: attachments.id, noteId: attachments.noteId, metaEnc: attachments.metaEnc })
          .from(attachments)
          .where(inArray(attachments.noteId, noteIds))
      : [];
    const members = await app.db
      .select({ userId: vaultMembers.userId, publicKey: users.publicKey })
      .from(vaultMembers)
      .innerJoin(users, eq(users.id, vaultMembers.userId))
      .where(eq(vaultMembers.vaultId, id));
    return {
      keyVersion: vault.keyVersion,
      nameEnc: vault.nameEnc,
      notes: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
      versions,
      attachments: files,
      members,
    };
  });

  /**
   * Replaces the vault key. The browser re-encrypted every payload, version and attachment metadata and
   * sealed the new key for each remaining member. Applied atomically, and only if nothing changed since the
   * browser read the data – otherwise 409 and the browser starts over.
   */
  app.post('/vaults/:id/rotate', { bodyLimit: app.config.IMPORT_MAX_MB * 1024 * 1024 }, async (req) => {
    const { id } = idParams.parse(req.params);
    const input = vaultRotateSchema.parse(req.body);
    await access(app, req).requireVault(id, 'owner');

    await app.db.transaction(async (tx) => {
      await lockVaultKey(tx, id, input.keyVersion);
      const current = await tx
        .select({ id: notes.id, updatedAt: notes.updatedAt })
        .from(notes)
        .where(eq(notes.vaultId, id));
      const expected = new Map(input.notes.map((n) => [n.id, new Date(n.expectedUpdatedAt).getTime()]));
      if (
        current.length !== expected.size ||
        current.some((n) => expected.get(n.id) !== n.updatedAt.getTime())
      ) {
        throw stale();
      }
      const noteIds = current.map((n) => n.id);
      const versions = noteIds.length
        ? await tx
            .select({ id: noteVersions.id })
            .from(noteVersions)
            .where(inArray(noteVersions.noteId, noteIds))
        : [];
      const files = noteIds.length
        ? await tx
            .select({ id: attachments.id })
            .from(attachments)
            .where(inArray(attachments.noteId, noteIds))
        : [];
      const members = await tx
        .select({ userId: vaultMembers.userId })
        .from(vaultMembers)
        .where(eq(vaultMembers.vaultId, id));
      const sameSet = (a: string[], b: string[]) =>
        a.length === b.length && new Set([...a, ...b]).size === a.length;
      if (
        !sameSet(
          versions.map((v) => v.id),
          input.versions.map((v) => v.id),
        ) ||
        !sameSet(
          files.map((f) => f.id),
          input.attachments.map((f) => f.id),
        ) ||
        !sameSet(
          members.map((m) => m.userId),
          input.members.map((m) => m.userId),
        )
      ) {
        throw stale();
      }

      for (const n of input.notes)
        await tx.update(notes).set({ payload: n.payload }).where(eq(notes.id, n.id));
      for (const v of input.versions) {
        await tx.update(noteVersions).set({ payload: v.payload }).where(eq(noteVersions.id, v.id));
      }
      for (const f of input.attachments) {
        await tx.update(attachments).set({ metaEnc: f.metaEnc }).where(eq(attachments.id, f.id));
      }
      for (const m of input.members) {
        await tx
          .update(vaultMembers)
          .set({ keyWrapped: m.keyWrapped })
          .where(and(eq(vaultMembers.vaultId, id), eq(vaultMembers.userId, m.userId)));
      }
      await tx
        .update(vaults)
        .set({
          nameEnc: input.nameEnc,
          keyVersion: sql`${vaults.keyVersion} + 1`,
          rotationPending: false,
          updatedAt: new Date(),
        })
        .where(eq(vaults.id, id));
    });
    await audit(app, req, { action: 'vault.rotate', target: id, meta: { entries: input.notes.length } });
    return { vault: await one(req, id) };
  });
}
