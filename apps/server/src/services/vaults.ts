import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { notes, vaultMembers, vaults } from '../db/schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Removes a user from all shared vaults (admin reset/delete): vaults left without members are deleted,
 * otherwise another member becomes owner, takes over the entries the user created, and the vault is marked
 * for a key rotation by an owner's browser.
 */
export async function detachUserFromVaults(tx: Tx, userId: string) {
  const memberships = await tx.select().from(vaultMembers).where(eq(vaultMembers.userId, userId));
  for (const m of memberships) {
    await tx
      .delete(vaultMembers)
      .where(and(eq(vaultMembers.vaultId, m.vaultId), eq(vaultMembers.userId, userId)));
    const remaining = await tx
      .select()
      .from(vaultMembers)
      .where(eq(vaultMembers.vaultId, m.vaultId))
      .orderBy(asc(vaultMembers.createdAt));
    if (remaining.length === 0) {
      await tx.delete(vaults).where(eq(vaults.id, m.vaultId));
      continue;
    }
    let heir = remaining.find((r) => r.role === 'owner');
    if (!heir) {
      heir = remaining.find((r) => r.role === 'editor') ?? remaining[0]!;
      await tx
        .update(vaultMembers)
        .set({ role: 'owner' })
        .where(and(eq(vaultMembers.vaultId, m.vaultId), eq(vaultMembers.userId, heir.userId)));
    }
    await tx
      .update(notes)
      .set({ userId: heir.userId })
      .where(and(eq(notes.vaultId, m.vaultId), eq(notes.userId, userId)));
    await tx.update(vaults).set({ rotationPending: true }).where(eq(vaults.id, m.vaultId));
  }
}
