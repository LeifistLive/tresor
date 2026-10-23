import type { VaultKeyDto, VaultRole } from '@tresor/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.js';
import { type NoteRow, vaultMembers, vaults } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import type { AuthContext } from '../types.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

interface Membership {
  role: VaultRole;
  keyWrapped: string;
  keyVersion: number;
}

/**
 * Access rules for one request. The server holds no keys any more – it only decides who may read or write
 * which ciphertext: own personal entries, and entries of shared vaults according to the member's role.
 */
export class Access {
  private memberships: Map<string, Membership> | undefined;

  constructor(
    private readonly app: FastifyInstance,
    readonly auth: AuthContext,
  ) {}

  get userId() {
    return this.auth.user.id;
  }

  async loadMemberships() {
    if (!this.memberships) {
      const rows = await this.app.db
        .select({
          vaultId: vaultMembers.vaultId,
          role: vaultMembers.role,
          keyWrapped: vaultMembers.keyWrapped,
          keyVersion: vaults.keyVersion,
        })
        .from(vaultMembers)
        .innerJoin(vaults, eq(vaults.id, vaultMembers.vaultId))
        .where(eq(vaultMembers.userId, this.userId));
      this.memberships = new Map(rows.map(({ vaultId, ...m }) => [vaultId, m]));
    }
    return this.memberships;
  }

  /** Forgets cached memberships (after they were changed in the same request). */
  invalidate() {
    this.memberships = undefined;
  }

  async vaultIds(): Promise<string[]> {
    return [...(await this.loadMemberships()).keys()];
  }

  /** The user's sealed vault keys (for the browser to decrypt shared entries). */
  async vaultKeys(): Promise<VaultKeyDto[]> {
    return [...(await this.loadMemberships()).entries()].map(([vaultId, m]) => ({ vaultId, ...m }));
  }

  async role(vaultId: string): Promise<VaultRole | null> {
    return (await this.loadMemberships()).get(vaultId)?.role ?? null;
  }

  async requireVault(vaultId: string, minRole: VaultRole = 'viewer'): Promise<VaultRole> {
    const role = await this.role(vaultId);
    if (!role) throw notFound('Vault not found');
    if (!roleAtLeast(role, minRole)) throw new AppError(403, 'READ_ONLY', 'Insufficient vault permissions');
    return role;
  }

  /** Whether the user may read an entry and whether they may change it; null when they have no access. */
  async forNote(row: Pick<NoteRow, 'userId' | 'vaultId'>): Promise<{ canEdit: boolean } | null> {
    if (!row.vaultId) return row.userId === this.userId ? { canEdit: true } : null;
    const role = await this.role(row.vaultId);
    if (!role) return null;
    return { canEdit: role !== 'viewer' };
  }
}

const RANK: Record<VaultRole, number> = { viewer: 0, editor: 1, owner: 2 };

export function roleAtLeast(role: VaultRole, min: VaultRole): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * Locks the vault row for the rest of the transaction and checks that a write was encrypted with the
 * current vault key. Rotations take the same lock, so no ciphertext under an old key can slip in.
 */
export async function lockVaultKey(tx: Tx, vaultId: string, keyVersion: number | undefined): Promise<void> {
  if (keyVersion !== (await lockVault(tx, vaultId))) {
    throw new AppError(409, 'STALE', 'The vault key changed – reload and try again');
  }
}

/** Locks the vault row (serialises writes against key rotation) and returns its current key version. */
export async function lockVault(tx: Tx, vaultId: string): Promise<number> {
  const [row] = await tx
    .select({ keyVersion: vaults.keyVersion })
    .from(vaults)
    .where(eq(vaults.id, vaultId))
    .for('update');
  if (!row) throw notFound('Vault not found');
  return row.keyVersion;
}

const CACHE = Symbol('access');

/** One access object per request (memoized). */
export function access(app: FastifyInstance, req: FastifyRequest): Access {
  const holder = req as FastifyRequest & { [CACHE]?: Access };
  if (!req.auth) throw new AppError(401, 'UNAUTHORIZED', 'Not signed in');
  holder[CACHE] ??= new Access(app, req.auth);
  return holder[CACHE];
}
