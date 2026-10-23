import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { KeyRing } from './crypto/keys.js';
import { openDatabase } from './db/client.js';
import { scheduleMaintenance } from './services/maintenance.js';
import { verifyMasterKey } from './services/system.js';
import { VERSION } from './version.js';

async function main() {
  const config = loadConfig();
  const database = await openDatabase(config.DATABASE_URL, config.MIGRATIONS_DIR);
  await database.migrate();
  await verifyMasterKey(database.db, new KeyRing(config.VAULT_MASTER_KEY));

  const app = await buildApp({ config, db: database.db });
  app.addHook('onClose', async () => database.close());
  scheduleMaintenance(app);

  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(`Tresor ${VERSION} is ready on port ${config.PORT}`);

  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      app.log.info({ signal }, 'shutting down');
      app.close().then(
        () => process.exit(0),
        (err) => {
          app.log.error({ err }, 'error during shutdown');
          process.exit(1);
        },
      );
    });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
