# Configuration

Tresor is configured with environment variables. With Docker Compose put them into `.env` (see
[`.env.example`](../.env.example)); the compose file passes the relevant ones to the containers.

## Application (`app` container)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | – (required) | PostgreSQL connection string. Set by `docker-compose.yml`. For development also `pglite:memory` or `pglite:/path` (embedded, not for production). |
| `VAULT_MASTER_KEY` | – (required) | ≥ 32 characters of high-entropy text. Protects the outer layer around stored keys, login verifiers, TOTP secrets and notification settings (content is protected by the users' own keys). Back it up; change it only with `rotate-master-key` ([security.md](security.md#rotating-the-master-key)). |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address inside the container. |
| `COOKIE_SECURE` | `auto` | `auto` = `Secure` cookies when the request came in via HTTPS (honours `X-Forwarded-Proto` with `TRUST_PROXY`), `true`, `false`. |
| `TRUST_PROXY` | `false` | `true`, a hop count (`1`) or IPs/CIDRs of trusted proxies. Needed for correct client IPs, rate limiting and HTTPS detection behind a reverse proxy. |
| `ENABLE_HSTS` | `false` | Send `Strict-Transport-Security`. Only when Tresor is always reached via HTTPS. |
| `SESSION_TTL_HOURS` | `12` | Absolute session lifetime. |
| `SESSION_IDLE_MINUTES` | `60` | Server-side expiry of sessions without requests (the web app's own auto-lock is configured per user). |
| `ARGON2_MEMORY_KIB` | `65536` | Argon2id memory cost for new passwords. Runs in the browser; the server refuses weaker settings, browsers refuse anything below `19456`. |
| `ARGON2_ITERATIONS` | `3` | Argon2id time cost (browsers require at least `2`). |
| `LOGIN_RATE_LIMIT` | `10` | Attempts per IP and 5 minutes for sign-in, recovery and setup. |
| `TRASH_RETENTION_DAYS` | `30` | Entries in the trash are purged after this many days (`0` = never). |
| `AUDIT_RETENTION_DAYS` | `365` | Audit entries older than this are deleted (`0` = never). |
| `ATTACHMENT_MAX_MB` | `25` | Maximum size of one attachment. |
| `IMPORT_MAX_MB` | `200` | Maximum size of an import request (JSON / `.tresor`, attachments included). |
| `WEBAUTHN_RP_ID` | request host | Passkey relying-party ID, e.g. `tresor.example.home`. Only needed if the server sees another host name than the browser. |
| `WEBAUTHN_ORIGIN` | request origin | Comma-separated allowed origins for passkeys, e.g. `https://tresor.example.home`. |
| `NOTIFY_ALLOW_PRIVATE` | `true` | Notifications may go to loopback/private addresses (local ntfy/Gotify). Link-local targets such as `169.254.169.254` are always refused; redirects are never followed. Set `false` when users are not fully trusted. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `WEB_DIST` | `/app/public` | Directory of the built web app (set in the image). |
| `MIGRATIONS_DIR` | `/app/drizzle` | SQL migrations (set in the image). |

## Compose-only variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | – (required) | Password of the internal database user. |
| `COMPOSE_PROFILES` | `https` (in `.env.example`) | Optional services, comma-separated: `https` (bundled Caddy), `backup` (nightly dumps), `offsite` (rclone copies, with `backup`). Read by Docker Compose itself. |
| `TRESOR_PORT` | `8080` | Published host port. |
| `TRESOR_BIND` | `0.0.0.0` | Host address the port is bound to (`127.0.0.1` behind a local proxy). |
| `TRESOR_HOSTNAME` | – | `https` profile: IP or host name the browsers use (host name needed for passkeys). |
| `TRESOR_HTTPS_PORT` / `TRESOR_HTTPS_BIND` | `8443` / `0.0.0.0` | `https` profile: published HTTPS port and bind address. |
| `TRESOR_IMAGE` | `tresor:local` | Image name. Use `ghcr.io/leifistlive/tresor:<version>` for published images. |
| `TRESOR_PULL_POLICY` | `build` | `build` builds from the repository; `missing`/`always` pull `TRESOR_IMAGE`. |
| `TRESOR_DB_PATH` | named volume `db-data` | Host path for PostgreSQL data (e.g. on Unraid appdata). |
| `TRESOR_BACKUP_PATH` | `./backups` | Target of the `backup` profile. |
| `BACKUP_INTERVAL_HOURS` | `24` | Dump interval of the `backup` profile. |
| `BACKUP_KEEP_DAYS` | `14` | Dumps older than this are removed. |
| `RCLONE_REMOTE` | – | Target of the `offsite` profile, e.g. `b2crypt:tresor` (configured in `./rclone/rclone.conf`). |
| `RCLONE_CONFIG_PATH` | `./rclone` | Folder with `rclone.conf`. |
| `OFFSITE_INTERVAL_HOURS` | `24` | How often dumps are copied off-site. |
| `OFFSITE_KEEP_DAYS` | `60` | Off-site dumps older than this are deleted. |
| `NEW_VAULT_MASTER_KEY` | – | Only for `node dist/cli.js rotate-master-key` (see [security.md](security.md#rotating-the-master-key)). |

## Per-user settings (in the app)

Language (German/English), theme (system/dark/light), display name and auto-lock (never, 5–60 minutes) are
stored per account under **Settings → Profile & appearance**. Passkeys, two-factor sign-in, recovery key and
sessions live under **Security**, push notifications (ntfy, Gotify, webhook) under **Notifications** and entry
templates under **Templates**.
