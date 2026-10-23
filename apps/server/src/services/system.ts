import { eq } from 'drizzle-orm';
import type { KeyRing } from '../crypto/keys.js';
import type { Database } from '../db/client.js';
import { system } from '../db/schema.js';

const KEY_CHECK = 'master_key_check';

/**
 * Guards against starting with a different VAULT_MASTER_KEY than the one the data was written with –
 * that would make every account unreadable. The first start stores a fingerprint of the key.
 */
export async function verifyMasterKey(db: Database, keys: KeyRing): Promise<'initialized' | 'ok'> {
  const [row] = await db.select().from(system).where(eq(system.key, KEY_CHECK)).limit(1);
  if (!row) {
    await db.insert(system).values({ key: KEY_CHECK, value: keys.checkValue }).onConflictDoNothing();
    return 'initialized';
  }
  if (row.value !== keys.checkValue) {
    throw new Error(
      'VAULT_MASTER_KEY does not match the key this database was created with. ' +
        'Restore the original key – without it no stored data can be decrypted.',
    );
  }
  return 'ok';
}
