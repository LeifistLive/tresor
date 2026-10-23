# Configuration

All settings go into `.env`. Only the values in [`.env.example`](../.env.example) are needed; everything else is
optional.

| Setting | Default | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD` | – | Database password (required) |
| `VAULT_MASTER_KEY` | – | Server key, at least 32 characters (required – keep a copy) |
| `TRESOR_HOSTNAME` | – | IP or host name for the bundled HTTPS |
| `COMPOSE_PROFILES` | – | Optional services: `https`, `backup`, `offsite` (comma-separated) |
| `TRUST_PROXY` | `false` | `true` behind the bundled Caddy or another reverse proxy |
| `TRESOR_BIND` / `TRESOR_PORT` | `0.0.0.0` / `8080` | Address and port for plain HTTP |
| `TRESOR_HTTPS_BIND` / `TRESOR_HTTPS_PORT` | `0.0.0.0` / `8443` | Address and port of the bundled HTTPS |
| `TRESOR_IMAGE` | `ghcr.io/leifistlive/tresor:1` | Image to run; pin a version with e.g. `…:1.1.1` |
| `TRESOR_DB_PATH` | Docker volume | Host folder for the database (e.g. Unraid appdata) |
| `TRESOR_BACKUP_PATH` | `./backups` | Folder for database dumps |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP_DAYS` | `24` / `14` | Dump interval and retention |
| `RCLONE_REMOTE` | – | Off-site target, e.g. `b2crypt:tresor` |
| `RCLONE_CONFIG_PATH` | `./rclone` | Folder with `rclone.conf` |
| `OFFSITE_INTERVAL_HOURS` / `OFFSITE_KEEP_DAYS` | `24` / `60` | Off-site interval and retention |
| `COOKIE_SECURE` | `auto` | `auto`, `true` or `false` |
| `ENABLE_HSTS` | `false` | Send HSTS – only if Tresor is always reached via HTTPS |
| `SESSION_TTL_HOURS` | `12` | Maximum session length |
| `SESSION_IDLE_MINUTES` | `60` | Sign-out after inactivity |
| `ARGON2_MEMORY_KIB` / `ARGON2_ITERATIONS` | `65536` / `3` | Password hashing cost (minimum `19456` / `2`) |
| `LOGIN_RATE_LIMIT` | `10` | Sign-in attempts per IP within 5 minutes |
| `TRASH_RETENTION_DAYS` | `30` | Days until the trash is emptied (`0` = never) |
| `AUDIT_RETENTION_DAYS` | `365` | Days the audit log is kept (`0` = forever) |
| `ATTACHMENT_MAX_MB` / `IMPORT_MAX_MB` | `25` / `200` | Upload limits |
| `NOTIFY_ALLOW_PRIVATE` | `true` | Allow notifications to local addresses (ntfy, Gotify) |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` | from the request | Passkeys behind a proxy that changes the host name |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` … |
