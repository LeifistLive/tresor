<div align="center">

<img src="apps/web/public/favicon.svg" width="72" height="72" alt="Tresor logo" />

# Tresor

**Self-hosted, end-to-end encrypted vault for notes, Matter codes, logins and other secrets.**

[![CI](https://github.com/leifistlive/tresor/actions/workflows/ci.yml/badge.svg)](https://github.com/leifistlive/tresor/actions/workflows/ci.yml)
![Release](https://img.shields.io/github/v/release/leifistlive/tresor?style=flat-square&color=c5f04a)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

</div>

Everything is encrypted **in your browser** before it reaches the server. The server, its administrators and
anyone with a copy of the database only ever see ciphertext.

## Features

- Notes, Matter devices, logins with 2FA codes, Wi-Fi, cards and keys – with tags, custom fields, expiry dates,
  version history and encrypted attachments
- QR scanner for Matter, Wi-Fi and 2FA codes; smart home view with printable labels
- Passkeys, two-factor sign-in, recovery key, auto-lock
- Shared vaults and emergency access for trusted contacts
- Dashboard with password health, admin area with audit log, notifications via ntfy, Gotify or webhook
- Encrypted exports and nightly database backups
- German and English, dark and light theme

## Quick start

Requirements: Docker with Compose.

```bash
mkdir tresor && cd tresor
curl -LO https://github.com/leifistlive/tresor/releases/latest/download/docker-compose.yml
curl -L -o .env https://github.com/leifistlive/tresor/releases/latest/download/env.example
openssl rand -hex 32        # run twice: values for POSTGRES_PASSWORD and VAULT_MASTER_KEY
nano .env                   # fill in the two secrets and TRESOR_HOSTNAME
docker compose up -d
```

Open `https://<TRESOR_HOSTNAME>:8443` and create the admin account. Keep a copy of `VAULT_MASTER_KEY` – without
it the data cannot be recovered.

## Documentation

- [Installation & operation](docs/installation.md) – HTTPS, reverse proxy, updates, backups
- [Configuration](docs/configuration.md) – all settings
- [Security](docs/security.md) – how the encryption works and where its limits are
- [Development](docs/development.md) – local setup, tests, releases

[Changelog](CHANGELOG.md) · [MIT License](LICENSE)
