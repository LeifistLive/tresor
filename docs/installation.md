# Installation & operation

## Install

Requirements: Docker with Compose, `amd64` or `arm64`.

```bash
mkdir tresor && cd tresor
curl -LO https://github.com/leifistlive/tresor/releases/latest/download/docker-compose.yml
curl -L -o .env https://github.com/leifistlive/tresor/releases/latest/download/env.example
openssl rand -hex 32
```

Run `openssl` twice and put the values into `.env` as `POSTGRES_PASSWORD` and `VAULT_MASTER_KEY`. Set
`TRESOR_HOSTNAME` to the IP or host name of the server, then start:

```bash
docker compose up -d
```

Open `https://<TRESOR_HOSTNAME>:8443` and create the admin account. **Keep a copy of `VAULT_MASTER_KEY`** –
without it the data cannot be recovered.

## HTTPS

Browsers only allow the in-browser encryption over HTTPS (or on `localhost`). The bundled Caddy
(`COMPOSE_PROFILES=https`) uses its own certificate authority. Trust it once per device to avoid warnings:

```bash
docker compose cp https:/data/caddy/pki/authorities/local/root.crt ./tresor-root.crt
```

Import the file as a trusted root certificate (macOS: Keychain Access; iOS: install the profile, then enable it
under *Settings → General → About → Certificate Trust Settings*; Android: *Install a certificate → CA
certificate*; Windows: *Trusted Root Certification Authorities*). Passkeys need a host name instead of an IP,
e.g. `tresor.fritz.box`.

### Own reverse proxy

Set `COMPOSE_PROFILES=` in `.env` and forward the proxy to `http://127.0.0.1:8080` (proxy on another host: also
set `TRESOR_BIND=0.0.0.0`). The proxy has to send `X-Forwarded-For` and `X-Forwarded-Proto`, e.g. Caddy:

```caddy
tresor.example.home {
    reverse_proxy 127.0.0.1:8080
}
```

## Updates

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically. If the release notes mention `docker-compose.yml`, download it again.

## Backups

Add `backup` to `COMPOSE_PROFILES` (e.g. `https,backup`): a database dump is written to `./backups` every day and
kept for 14 days. For copies to S3, B2, a NAS … add `offsite`, set `RCLONE_REMOTE` and configure
[rclone](https://rclone.org) once:

```bash
docker run --rm -it -v "$PWD/rclone:/config/rclone" rclone/rclone:1 config
```

Manual dump and restore – the restore needs the same `VAULT_MASTER_KEY`:

```bash
docker compose exec -T db pg_dump -U tresor -d tresor --format=custom > tresor.dump
```

```bash
docker compose stop app
docker compose exec -T db dropdb -U tresor tresor
docker compose exec -T db createdb -U tresor tresor
docker compose exec -T db pg_restore -U tresor -d tresor --no-owner < tresor.dump
docker compose start app
```

Users can also export their entries in the app (*Settings → Export & import*) as an encrypted `.tresor` file,
JSON or Markdown.

## Troubleshooting

| Problem | Solution |
|---|---|
| "Tresor needs HTTPS" | Open it via `https://…:8443` or your reverse proxy. |
| Certificate warning | Trust the CA, see [HTTPS](#https). |
| `Invalid configuration: VAULT_MASTER_KEY …` | Fill in `.env`, the key needs at least 32 characters. |
| `VAULT_MASTER_KEY does not match …` | The key in `.env` changed – restore the original one. |
| Signed out right after sign-in | Behind a proxy: set `TRUST_PROXY=true`. |
| Sign-in slow on an old phone | Lower `ARGON2_MEMORY_KIB` (minimum `19456`). |
