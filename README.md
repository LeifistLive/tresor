<div align="center">

<img src="apps/web/public/favicon.svg" width="72" height="72" alt="Tresor logo" />

# Tresor

**Self-hosted, encrypted vault for notes, Matter codes, logins and other secrets.**

[Deutsch](README.de.md) · [Docs](docs/) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

[![CI](https://github.com/leifistlive/tresor/actions/workflows/ci.yml/badge.svg)](https://github.com/leifistlive/tresor/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-1.0.0-c5f04a?style=flat-square)
![Zero knowledge](https://img.shields.io/badge/encryption-zero--knowledge-c5f04a?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2024.7-339933?style=flat-square)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791?style=flat-square)

</div>

Tresor runs on your home server with Docker Compose. It is **zero-knowledge**: every entry, file and vault name
is encrypted **in your browser** before it is sent – the server only ever stores ciphertext and never sees your
password or keys. Administrators cannot read other users' entries, and a stolen database or backup is useless.

## Features

| | |
|---|---|
| **Six entry types** | Notes (Markdown), **Matter devices** (pairing code + QR, decoded vendor/product ID), logins (with live **2FA codes**), Wi-Fi (with "join" QR code), cards & IDs, keys & codes – plus custom fields, tags and expiry dates |
| **QR scanner** | Scan Matter, Wi-Fi and 2FA QR codes with the camera (or a photo) – fields fill themselves |
| **Smart home view** | Matter devices by room and network, printable QR labels and a Wi-Fi guest card |
| **Zero knowledge** | Encrypted in the browser: Argon2id · AES-256-GCM per entry and file · X25519 for sharing · the server never sees passwords, keys or plain text · rotatable server master key on top |
| **Sign-in** | Password + optional TOTP, **passkeys** (Face ID / Touch ID / security keys, unlock via PRF), recovery key, auto-lock |
| **Sharing** | Shared vaults (owner / editor / viewer) with their own key, replaced when members leave; key fingerprints to verify members |
| **Emergency access** | Trusted contacts get read access after a waiting period you can veto |
| **History & files** | Version history with restore, encrypted attachments (images, PDFs, any file) |
| **Dashboard** | Activity, distribution by type, expiring entries, **password health** (weak / reused / old), security score |
| **Admin dashboard** | Users (create, roles, disable, sign out, reset, delete), sign-in statistics, system info, audit log |
| **Notifications** | ntfy, Gotify or webhook: new sign-ins, failed attempts, emergency requests, expiry reminders |
| **Export / import** | JSON, Markdown (ZIP) or passphrase-encrypted `.tresor` backup – attachments included; nightly DB dumps with optional off-site copy via rclone |
| **UI** | Dark/light/system theme, German & English, command palette (⌘K), templates, responsive down to phones |

The design draft lives on a [design canvas](docs/design.md) (dashboard, entries with Matter detail, login with
2FA, admin dashboard, mobile).

## Quick start

Requirements: Docker with the Compose plugin (Linux, Unraid, Synology, Raspberry Pi 4/5 …).

```bash
git clone https://github.com/leifistlive/tresor.git && cd tresor
./scripts/generate-secrets.sh      # creates .env with random secrets
echo "TRESOR_HOSTNAME=192.168.178.20" >> .env && echo "TRUST_PROXY=true" >> .env   # your server's IP or name
docker compose --profile https up -d   # builds the image, starts Tresor + PostgreSQL + local HTTPS
```

Open `https://<TRESOR_HOSTNAME>:8443`, create the administrator account and **store the recovery key** that is
shown once. Back up `VAULT_MASTER_KEY` from `.env` in a safe place. Browsers only allow the in-browser encryption
over **HTTPS** (or on `localhost`), so the bundled `https` profile (Caddy with a local CA) or your own reverse
proxy is required.

For HTTPS, reverse proxies, Unraid and updates see [docs/installation.md](docs/installation.md).

## Documentation

| Topic | |
|---|---|
| [Installation & operation](docs/installation.md) | Compose, reverse proxy (Caddy/Traefik/NPM), Unraid, updates, troubleshooting |
| [Configuration](docs/configuration.md) | All environment variables |
| [Security model](docs/security.md) | Zero-knowledge design, threat model, limits, security review |
| [Backup & restore](docs/backup-restore.md) | Database dumps, encrypted exports, disaster recovery |
| [Architecture](docs/architecture.md) | Stack, monorepo layout, data model, request flow |
| [API](docs/api.md) | REST endpoints |
| [Development](docs/development.md) | Local setup, tests, conventions, release process |
| [Design](docs/design.md) | Design draft, tokens, typography, components |

## Tech stack

TypeScript end-to-end in an npm-workspaces monorepo:
**Fastify 5** · **Drizzle ORM** · **PostgreSQL 18** · **React 19** · **Vite 8** · **Tailwind CSS 4** ·
WebCrypto + hash-wasm (Argon2id) + @noble/curves (X25519) in the browser · TanStack Query · React Router ·
Radix UI · i18next · Zod · Vitest · Biome · Docker · GitHub Actions.

```
apps/server     Fastify API, crypto, migrations (serves the built web app in production)
apps/web        React single-page app
packages/shared Types, schemas, browser crypto and the zero-knowledge client used by both
docs/           Documentation
```

## Versioning

Tresor follows [Semantic Versioning](https://semver.org). Changes are recorded in [CHANGELOG.md](CHANGELOG.md);
`./scripts/release.sh <version>` bumps all packages, dates the changelog and tags the release. Pushing a
`v*.*.*` tag builds a multi-arch image (`linux/amd64`, `linux/arm64`) and publishes it to
`ghcr.io/leifistlive/tresor`.

## License

[MIT](LICENSE)
