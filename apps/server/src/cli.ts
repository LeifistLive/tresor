/**
 * Administrative command line.
 *
 *   node dist/cli.js rotate-master-key [--dry-run]
 *
 * Reads VAULT_MASTER_KEY (current key) and NEW_VAULT_MASTER_KEY (replacement) plus DATABASE_URL from the
 * environment. Stop the app container first; afterwards put the new key into .env and start it again.
 */
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { rotateMasterKey } from './services/rotation.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'rotate-master-key') {
    console.log('Usage: node dist/cli.js rotate-master-key [--dry-run]');
    process.exit(command ? 1 : 0);
  }
  const dryRun = args.includes('--dry-run');
  const config = loadConfig();
  const next = process.env.NEW_VAULT_MASTER_KEY ?? '';
  const database = await openDatabase(config.DATABASE_URL, config.MIGRATIONS_DIR);
  try {
    await database.migrate();
    const report = await rotateMasterKey(database.db, config.VAULT_MASTER_KEY, next, { dryRun });
    console.log(dryRun ? 'Dry run – nothing was changed.' : 'Master key rotated.');
    console.log(`  accounts re-sealed:  ${report.users}`);
    console.log(`  passkeys re-sealed:  ${report.passkeys}`);
    console.log(`  sessions revoked:    ${report.sessionsRevoked}`);
    if (!dryRun)
      console.log('\nNow replace VAULT_MASTER_KEY in .env with the new key and start Tresor again.');
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}

void main();
