# Security

Tresor is **zero-knowledge**: entries, files, templates and vault names are encrypted and decrypted in the
browser. Passwords, keys and plain text never reach the server.

## Who can read what

| | Can read entries? |
|---|---|
| Stolen database or backup | No |
| Database **and** `VAULT_MASTER_KEY` | Only by guessing each password (one Argon2id run with 64 MiB per guess) |
| Administrators | No – they manage accounts and see metadata |
| Other users | Only shared vaults they belong to |
| Emergency contacts | After the waiting period, read-only |
| Whoever can change the server's code | Eventually – like every web app, Tresor trusts the JavaScript the server delivers |

## How it works

- The browser turns the password into a master key with **Argon2id**. The server only receives a derived login
  key and stores a hash of it.
- Each user has a random data key that encrypts their entries with **AES-256-GCM**. It is stored wrapped by the
  password, by the recovery key and optionally by a passkey (WebAuthn PRF).
- Shared vaults have their own key, sealed to every member with **X25519**; it is replaced when someone leaves.
- Every attachment has its own key.
- Stored keys and login hashes carry an extra layer under the server's `VAULT_MASTER_KEY`.

Code: [`packages/shared/src/crypto`](../packages/shared/src/crypto). The tests in `apps/server/test` use the same
client as the web app and include the attack scenarios of the security review done before 1.0.

## What the server sees

Usernames, roles, entry types, timestamps, sizes, expiry dates (for reminders), vault membership and the audit
log. Titles, contents, tags, file names and vault names are encrypted. The server can read TOTP secrets and
notification settings (it needs them; they are sealed with the server key) and temporary passwords set by an
admin (they protect no data).

## Limits

- Whoever controls the server could ship code that reads data after the next unlock – keep the host secure and
  use only trusted images.
- Emergency contacts and removed vault members may keep what they already saw.
- Compare key fingerprints (*Settings → Security*) before sharing very sensitive vaults.

## Rotating the master key

If `.env` or a backup containing it may have leaked:

```bash
docker compose stop app
docker compose run --rm -e NEW_VAULT_MASTER_KEY='<new key>' app node dist/cli.js rotate-master-key
```

Then put the new key into `.env` and run `docker compose up -d`. Add `--dry-run` to test first.

## Recommendations

HTTPS only, ideally only inside your network or via VPN; a strong password plus 2FA or a passkey; the recovery
key printed and kept offline; `VAULT_MASTER_KEY` stored apart from the backups. Report vulnerabilities as
described in [SECURITY.md](../.github/SECURITY.md).
