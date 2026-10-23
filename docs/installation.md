# Installation & operation

## Requirements

- Docker Engine 24+ with the Compose plugin (`docker compose version`)
- 1 CPU core and ~300 MB RAM are plenty for a household; `amd64` and `arm64` (Raspberry Pi 4/5) are supported
- **HTTPS**: the bundled `https` profile or your own reverse proxy – see below

## Install

```bash
git clone https://github.com/leifistlive/tresor.git
cd tresor
cp .env.example .env
```

Create two random values – run the command twice:

```bash
openssl rand -hex 32
```

Open `.env` in an editor (e.g. `nano .env`) and fill in:

| Setting | Value |
|---|---|
| `POSTGRES_PASSWORD` | the first random value |
| `VAULT_MASTER_KEY` | the second random value – **keep a copy in a safe place** |
| `TRESOR_HOSTNAME` | IP or host name your devices use for the server, e.g. `192.168.178.20` (remove the `#`) |
| `TRUST_PROXY` | `true` |

`COMPOSE_PROFILES=https` is already set and starts the bundled HTTPS (Caddy). With your own reverse proxy, leave it
empty – see [HTTPS](#https).

Then start Tresor:

```bash
docker compose up -d
docker compose logs -f app      # wait for "Tresor … is ready"
```

Open `https://<TRESOR_HOSTNAME>:8443`. The first visit shows the **setup wizard** that creates the administrator.
Afterwards the administrator adds further users under **Admin → Create user**.

> **Back up `.env`** – especially `VAULT_MASTER_KEY`. Losing it means losing every entry.

### Using a published image instead of building

After a release has been published to GitHub Container Registry, set in `.env`:

```dotenv
TRESOR_IMAGE=ghcr.io/leifistlive/tresor:1.0.1
TRESOR_PULL_POLICY=missing
```

and run `docker compose up -d`.

## HTTPS

Tresor encrypts and decrypts **in the browser** (zero knowledge). Browsers only provide the required
WebCrypto API in a *secure context* – HTTPS, or `http://localhost` on the server itself. Opened via plain HTTP
from another device, Tresor shows a page explaining this instead of starting.

### Bundled: `https` profile (Caddy with a local CA)

```dotenv
COMPOSE_PROFILES=https           # starts the bundled Caddy (preset in .env.example)
TRESOR_HOSTNAME=192.168.178.20   # IP or host name the browsers use
TRESOR_HTTPS_PORT=8443           # optional
TRUST_PROXY=true                 # real client IPs + Secure cookies
TRESOR_BIND=127.0.0.1            # optional: hide the plain HTTP port from the network
```

```bash
docker compose up -d
```

Caddy ([`deploy/Caddyfile`](../deploy/Caddyfile)) issues a certificate from its own local certificate authority,
without internet access. Browsers warn until you trust that CA once on each device:

```bash
docker compose cp https:/data/caddy/pki/authorities/local/root.crt ./tresor-root.crt
```

Import `tresor-root.crt` as a trusted root (macOS: Keychain Access → System → "Always trust"; iOS: open the file,
install the profile, then *Settings → General → About → Certificate Trust Settings*; Android: *Encryption &
credentials → Install a certificate → CA certificate*; Windows: "Trusted Root Certification Authorities").

**Passkeys** additionally need a host name instead of an IP address (WebAuthn does not allow IPs), e.g. a local DNS
name from your router (`tresor.fritz.box`, `tresor.home`) or Tailscale MagicDNS. Use that name as `TRESOR_HOSTNAME`.

### Your own reverse proxy

Tresor speaks plain HTTP on port 8080; terminate TLS in front of it and set

```dotenv
COMPOSE_PROFILES=         # no bundled Caddy (add backup/offsite here if you use them)
TRUST_PROXY=true          # or the proxy's IP / CIDR, e.g. 172.18.0.0/16
COOKIE_SECURE=auto        # cookies become Secure automatically for HTTPS requests
ENABLE_HSTS=true          # once everything works via HTTPS
TRESOR_BIND=127.0.0.1     # optional: only reachable through the proxy on the same host
```

**Caddy**

```caddy
tresor.example.home {
    reverse_proxy 127.0.0.1:8080
}
```

**Nginx / Nginx Proxy Manager** – forward to `http://<host>:8080` and pass the usual headers:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 50m;   # imports
}
```

**Traefik** (labels on the `app` service):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.tresor.rule=Host(`tresor.example.home`)
  - traefik.http.routers.tresor.entrypoints=websecure
  - traefik.http.routers.tresor.tls=true
  - traefik.http.services.tresor.loadbalancer.server.port=8080
```

If the browser reaches Tresor under another name than the server sees, set `WEBAUTHN_RP_ID` and
`WEBAUTHN_ORIGIN` for passkeys.

**Tailscale** is an easy alternative for access from outside: `tailscale serve --https=443 http://127.0.0.1:8080`
gives Tresor a trusted HTTPS name inside your tailnet.

## Unraid, Portainer & co.

- **Unraid** (Compose Manager plugin or the built-in Compose support): create a stack, paste
  `docker-compose.yml`, add the variables from `.env.example`, and point the database to your appdata share:
  `TRESOR_DB_PATH=/mnt/user/appdata/tresor/postgres`, `TRESOR_BACKUP_PATH=/mnt/user/appdata/tresor/backups`.
- **Portainer**: *Stacks → Add stack → Repository* (this repository) or paste the compose file; set the
  environment variables in the UI. When you do not build from the repository, use a published image via
  `TRESOR_IMAGE`/`TRESOR_PULL_POLICY` (see above).
- **Synology Container Manager**: *Project → Create*, select the folder with `docker-compose.yml` and `.env`.

## Updating

```bash
git pull                     # or change TRESOR_IMAGE to the new version
docker compose up -d --build
```

Database migrations run automatically at start. Read the [changelog](../CHANGELOG.md) before major upgrades
and make a database dump first (see [backup-restore.md](backup-restore.md)).

## Health & monitoring

- `GET /api/health` → `{"status":"ok","version":"…"}` (checks the database); used by the Docker health check
  and suitable for Uptime Kuma & co.
- Logs are JSON lines (`docker compose logs app`), level via `LOG_LEVEL`.
- Admin dashboard → audit log for sign-ins, failed attempts and admin actions.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid configuration: VAULT_MASTER_KEY …` | `.env` missing or key shorter than 32 characters – create it as described under [Install](#install). |
| `VAULT_MASTER_KEY does not match the key this database was created with` | The key in `.env` changed. Restore the original key. |
| Login works but you are immediately signed out | Served via HTTPS → HTTP mix-up or a proxy without `X-Forwarded-Proto`: set `TRUST_PROXY=true`, or `COOKIE_SECURE=false` for pure HTTP access. |
| `Too many attempts` | Per-IP rate limit (`LOGIN_RATE_LIMIT` per 5 min). Behind a proxy make sure `TRUST_PROXY` is set, otherwise all users share the proxy IP. |
| Sign-in is slow on an old phone | Argon2id now runs in the browser. Lower `ARGON2_MEMORY_KIB` (not below `19456`) – applies to passwords set afterwards. |
| "Tresor braucht HTTPS" / "Tresor needs HTTPS" | Opened via plain HTTP from another device – use the `https` profile or a reverse proxy. |
| `WEAK_KDF` at sign-in | The server asks for Argon2 parameters below the browser's minimum (19 MiB / 2 passes) – raise `ARGON2_*`. |
| Database volume after upgrading from PostgreSQL ≤ 17 | PostgreSQL 18 images store data below `/var/lib/postgresql/18/docker`. Dump & restore when changing major versions. |
