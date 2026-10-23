import { eq, isNotNull } from 'drizzle-orm';
import { KeyRing, reseal, SERVER_AAD } from '../crypto/keys.js';
import type { Database } from '../db/client.js';
import { passkeys, sessions, system, users } from '../db/schema.js';

export interface RotationReport {
  users: number;
  passkeys: number;
  sessionsRevoked: number;
}

/**
 * Re-encrypts every value that is protected by the server key (outer layers of wrapped keys, login
 * verifiers, TOTP secrets, notification settings) from the old to the new master key – in one transaction.
 * Inner wraps (password, recovery key, passkey PRF) are untouched, so no user secret is needed.
 * All sessions are revoked because session keys derive from the master key.
 */
export async function rotateMasterKey(
  db: Database,
  oldMasterKey: string,
  newMasterKey: string,
  opts: { dryRun?: boolean } = {},
): Promise<RotationReport> {
  if (newMasterKey.length < 32) throw new Error('NEW_VAULT_MASTER_KEY must be at least 32 characters');
  if (oldMasterKey === newMasterKey) throw new Error('The new master key equals the old one');
  const from = new KeyRing(oldMasterKey);
  const to = new KeyRing(newMasterKey);

  const [check] = await db.select().from(system).where(eq(system.key, 'master_key_check'));
  if (check && check.value !== from.checkValue) {
    throw new Error('VAULT_MASTER_KEY is not the key this database was created with');
  }

  const all = await db.select().from(users);
  const report: RotationReport = { users: 0, passkeys: 0, sessionsRevoked: 0 };
  const resealOptional = (value: string | null, aad: string) => (value ? reseal(from, to, value, aad) : null);

  await db
    .transaction(async (tx) => {
      for (const u of all) {
        await tx
          .update(users)
          .set({
            authHash: reseal(from, to, u.authHash, SERVER_AAD.authHash(u.id)),
            dekWrapped: resealOptional(u.dekWrapped, SERVER_AAD.passwordWrap(u.id)),
            dekRecoveryWrapped: resealOptional(u.dekRecoveryWrapped, SERVER_AAD.recoveryWrap(u.id)),
            totpSecretEnc: resealOptional(u.totpSecretEnc, SERVER_AAD.totp(u.id)),
            notifyConfigEnc: resealOptional(u.notifyConfigEnc, SERVER_AAD.notifyConfig(u.id)),
          })
          .where(eq(users.id, u.id));
        report.users++;
      }

      const keys = await tx.select().from(passkeys).where(isNotNull(passkeys.dekWrapped));
      for (const p of keys) {
        await tx
          .update(passkeys)
          .set({ dekWrapped: reseal(from, to, p.dekWrapped!, SERVER_AAD.passkeyWrap(p.credentialId)) })
          .where(eq(passkeys.id, p.id));
        report.passkeys++;
      }

      report.sessionsRevoked = (await tx.delete(sessions).returning({ id: sessions.id })).length;
      await tx
        .insert(system)
        .values({ key: 'master_key_check', value: to.checkValue })
        .onConflictDoUpdate({ target: system.key, set: { value: to.checkValue, updatedAt: new Date() } });

      if (opts.dryRun) throw new DryRunRollback(report);
    })
    .catch((err) => {
      if (err instanceof DryRunRollback) return;
      throw err;
    });

  return report;
}

class DryRunRollback extends Error {
  constructor(readonly report: RotationReport) {
    super('dry run');
  }
}
