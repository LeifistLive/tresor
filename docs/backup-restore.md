# Backup & restore

There are two complementary ways to back up Tresor.

| | Database dump | Encrypted export (`.tresor`) |
|---|---|---|
| Created by | Server (`backup` profile or `pg_dump`) | Each user in **Settings → Export & import** |
| Contains | All users, entries, sessions, audit log | The entries of one user |
| Needs to restore | Same `VAULT_MASTER_KEY` + users' passwords | Only the passphrase – works on any Tresor instance |
| Use for | Disaster recovery of the whole server | Personal backups, moving to another instance |

## 1. Database dumps

Enable the bundled backup service: add `backup` to `COMPOSE_PROFILES` in `.env` (e.g. `COMPOSE_PROFILES=https,backup`)
and run

```bash
docker compose up -d
```

It writes `tresor-YYYY-MM-DD_HHMMSS.dump` (PostgreSQL custom format) into `./backups` every
`BACKUP_INTERVAL_HOURS` and removes dumps older than `BACKUP_KEEP_DAYS`. Entries inside the dump stay encrypted.

Manual dump:

```bash
docker compose exec -T db pg_dump -U tresor -d tresor --format=custom > tresor-$(date +%F).dump
```

### Off-site copies

The `offsite` profile copies the dumps to any [rclone](https://rclone.org) remote – S3, Backblaze B2, a NAS via
SFTP/SMB, WebDAV … Configure the remote once (ideally as an rclone **crypt** remote so files are encrypted before
they leave your network):

```bash
mkdir -p rclone
docker run --rm -it -v "$PWD/rclone:/config/rclone" rclone/rclone:1 config
```

Then add the target to `.env`, e.g. `RCLONE_REMOTE=b2crypt:tresor`, add `offsite` to the profiles
(e.g. `COMPOSE_PROFILES=https,backup,offsite`) and run

```bash
docker compose up -d
```

**Always back up `.env` (or at least `VAULT_MASTER_KEY`) together with the dumps – but store it separately**
(e.g. in a password manager). A dump without the key cannot be decrypted; a dump together with the key in the
same place weakens the protection.

### Restore a dump

```bash
docker compose stop app
docker compose exec -T db dropdb -U tresor tresor
docker compose exec -T db createdb -U tresor tresor
docker compose exec -T db pg_restore -U tresor -d tresor --no-owner < tresor-2026-10-02_030000.dump
docker compose start app
```

Make sure `.env` contains the **same `VAULT_MASTER_KEY`** as when the dump was made – Tresor refuses to start
otherwise.

## 2. Encrypted exports

Exports are built **in the browser** (the server cannot decrypt anything). Users can download their entries in
three formats:

- **Encrypted backup (`.tresor`)** – JSON encrypted with AES-256-GCM using a key derived from a passphrase with
  Argon2id. Recommended.
- **JSON** – plain text, for scripts or migration to other tools.
- **Markdown (ZIP)** – one `.md` file per entry with YAML front matter, readable in any editor or Obsidian.

Exports contain your **personal** entries including custom fields, expiry dates and attachments (shared vaults
are not exported). Imports (`.tresor` or JSON) add entries to the current account; existing entries are kept.

The `.tresor` format:

```json
{
  "format": "tresor-backup",
  "version": 1,
  "kdf": { "alg": "argon2id", "params": "m=65536,t=3,p=1", "salt": "<base64>" },
  "data": "<base64url(version | iv | gzip(JSON export) encrypted | tag)>"
}
```

## Disaster scenarios

| Lost | Consequence |
|---|---|
| A user's password | User resets it with the recovery key on the login page. |
| Password **and** recovery key | Entries of that user are unrecoverable; an admin can reset the account (entries are deleted). Restore from a `.tresor` export if available. |
| `VAULT_MASTER_KEY` | The stored keys and login verifiers cannot be opened any more, so the dump is unusable. Users can only restore their own `.tresor` exports into a new instance. |
| `VAULT_MASTER_KEY` leaked | Rotate it with `node dist/cli.js rotate-master-key` (see [security.md](security.md#rotating-the-master-key)). |
| The server | New server + `.env` + latest dump → restore as above. |
