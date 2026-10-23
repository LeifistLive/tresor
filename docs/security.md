# Security model

**Tresor is zero-knowledge**: every entry, file, template and vault name is encrypted and decrypted
**in the browser**. The password, the keys derived from it and the plain text never reach the server. The
server stores ciphertext and the metadata it needs for access control, statistics and reminders.

This page describes the design, what each party can and cannot see, the known limits and the results of the
security review.

## At a glance

| Who / what | Can read entries? | Notes |
|---|---|---|
| Stolen database dump or backup | **No** | Wrapped keys carry an extra layer under the server's master key; login verifiers are sealed too. |
| Dump **and** `VAULT_MASTER_KEY` | **No**, only by guessing each user's password | Every guess costs one Argon2id run (64 MiB, 3 passes by default). |
| Someone with read access to the running server | **No** | The server never holds a key that opens content (see *Exceptions*). |
| Someone who can **change** the server's code | **Yes, eventually** | They could ship JavaScript that copies data after the next unlock – inherent to every web app. See *Limits*. |
| Administrators (in the app) | **No** | They manage accounts and see metadata; resetting an account deletes its personal entries. |
| Other users | Only shared vaults they belong to | Viewer/editor/owner roles are enforced by the server. |
| Emergency contacts | After the waiting period, read-only | They then hold the account key (see *Emergency access*). |
| Network attacker | **No** with HTTPS | Tresor refuses to start over plain HTTP from another device (browsers disable WebCrypto there). |

## Key hierarchy

```
browser                                                                           server stores
───────                                                                           ─────────────
password ──Argon2id(salt, m=64 MiB, t=3)──► master key ─┬─HKDF──► auth key ──────► SHA-256(auth key), sealed¹
                                                        └─HKDF──► password wrap key ─┐
recovery key (160 bit) ─────────────HKDF──► recovery wrap key ──────────────────────┼─► wrapped DEK, sealed¹
                        └───────────HKDF──► recovery proof ────────────────────────────► SHA-256(proof)
passkey PRF output (256 bit) ───────HKDF──► passkey wrap key ────────────────────────┘

DEK (random, per user) ──► personal entries · templates · file keys · X25519 private key
vault key (random, per shared vault) ──ECIES to each member's public key──► shared entries · vault name
file key (random, per attachment) ──► file content

¹ "sealed" = an additional AES-256-GCM layer with a key derived from VAULT_MASTER_KEY (rotatable).
```

### Algorithms

| Purpose | Algorithm |
|---|---|
| Password → master key | Argon2id (RFC 9106) via WebAssembly; parameters chosen by the server (`ARGON2_*`), **minimum 19 MiB / 2 passes enforced by the browser** |
| Key derivation | HKDF-SHA-256 with distinct labels per purpose |
| Encryption | AES-256-GCM, random 96-bit IV, additional data binds every ciphertext to its record (`note:<id>`, `attachment:<id>:data`, `vault:<id>:member:<user>` …) |
| Sharing / emergency access | X25519 + HKDF-SHA-256 + AES-256-GCM (ephemeral-static ECIES) |
| Login verifier | SHA-256 of the auth key, sealed with the server key |
| Recovery key | 160 random bits, Crockford Base32 |

Browser code: [`packages/shared/src/crypto`](../packages/shared/src/crypto) (WebCrypto, `hash-wasm`, `@noble/curves`).
The same client library ([`packages/shared/src/client`](../packages/shared/src/client)) drives the server's integration
tests, so the tests exercise exactly the code the web app runs.

### What the server stores in plain text

Usernames, display names, roles, entry **types**, pinned flags, vault membership and roles, **expiry dates**
(for reminders), sizes, timestamps, audit-log events (who, when, which action, IP), public keys and the encrypted
notification settings' existence. Titles, contents, fields, tags, file names and vault names are encrypted.

## Flows

**Sign-in.** The browser asks `POST /auth/prelogin` for the salt and cost parameters, derives the master key with
Argon2id and sends only the auth key. Unknown usernames receive stable decoy parameters, and a decoy verifier is
checked, so the response does not reveal whether an account exists. Two-factor codes are checked afterwards
(the TOTP secret is sealed with the server key, because it must be checked before the vault is unlocked). The
response contains the wrapped DEK, which the browser opens with the password wrap key.

**Staying signed in.** Each session gets a random *session key*, stored on the server only encrypted with the
cookie token (which the server keeps as a hash). The browser keeps the DEK in `localStorage`, encrypted with that
session key – a reload re-opens it; signing out, expiry or another browser cannot. Signing out in one tab locks
all tabs.

**Recovery.** The browser fetches the recovery-wrapped DEK (protected by 160 random bits, so handing it out is
safe), opens it locally and proves possession of the recovery key with the *recovery proof* – derived from the
recovery key, deliberately **not** from the DEK. It sends a new password wrap and a new recovery key; two-factor
sign-in is switched off and all sessions end.

**Sharing.** Creating a vault: the browser generates the vault key, encrypts the name and seals the key to its own
public key. Adding a member seals the key to the member's public key. Removing a member (or a member leaving)
marks the vault; an owner's browser then re-encrypts every payload, version and file metadata with a new key and
seals it for the remaining members. Each rotation increments the vault's *key version*; writes encrypted with an
older version are refused (`409 STALE`) and writes and rotations are serialised with a row lock, so no ciphertext
under an outdated key can slip in.

**Public keys.** The server distributes public keys. To detect a substituted key, members and emergency contacts can
compare the **key fingerprint** shown next to each name with the one the person sees under *Settings → Security*.

**Emergency access.** The grantor's browser seals the DEK to the contact's public key (confirmed with the password).
The server releases it only after the waiting period, unless the grantor rejects the request.

**Attachments.** Every file gets its own random key, stored in the (container-key encrypted) metadata together with
the id of its entry. Moving entries or rotating vault keys therefore only re-encrypts small metadata. Decrypted
files are shown via local `blob:` URLs; only images and PDFs are displayed, every other type is offered as a
download and can never render as HTML in Tresor's origin.

**Exports and imports** are built and parsed in the browser. `.tresor` backups use Argon2id + AES-256-GCM with a
passphrase and do not depend on the server.

### Exceptions – where the server sees secrets

- **Temporary passwords** set by an admin (new account or reset). They protect nothing: the account has no keys
  until the user chooses a password, and then the browser creates the keys.
- **TOTP secrets** (sealed with the server key; needed to check codes before unlock).
- **Notification settings** (URLs and tokens for ntfy/Gotify/webhooks), sealed with the server key.

## Security review

Before the first release the code was reviewed from an attacker's perspective. Findings and fixes:

| Finding | Risk | Fix |
|---|---|---|
| The recovery proof was derived from the DEK – an emergency contact (who receives the DEK) could have reset the grantor's password and 2FA | High | Proof derived from the recovery key; regression test simulates the attack |
| A malicious server could hand out weak Argon2 parameters and harvest a cheap-to-crack auth key | High | Browser refuses parameters below 19 MiB / 2 passes (`WEAK_KDF`) |
| A stolen session could plant a passkey or name an emergency contact | Medium | Both require the password (auth key) |
| Notification URLs allowed SSRF (redirects, cloud metadata, network probing via error messages) | Medium | No redirects; target checked after DNS resolution; link-local always blocked, private ranges configurable (`NOTIFY_ALLOW_PRIVATE`); generic errors |
| Concurrent writes during a vault key rotation could store ciphertext under the old key | Medium | Key versions + row lock (`409 STALE`) |
| A server could swap files between entries in the same vault | Low | Entry id inside the encrypted file metadata, checked by the browser |
| Login timing differed for unknown users | Low | Decoy verifier check |
| Redirect target after sign-in (`?next=`) not restricted | Low | Only same-app paths |
| Unlimited bulk imports | Low | Rate limit |

Already in place and re-checked: authorization on every entry/vault/emergency route, CSRF header +
`SameSite=Strict` cookies, strict CSP (`script-src 'self' 'wasm-unsafe-eval'`, no inline scripts, `frame-ancestors
'none'`), Markdown without raw HTML and with sanitised links, `http(s)`-only link buttons, rate limits on all
authentication endpoints, single-use WebAuthn challenges with origin and user-verification checks, TOTP replay
protection, parameterised SQL, no secrets in logs, `npm audit` clean.

The full test suite contains the attack scenarios above (`apps/server/test`).

## Limits

- **Malicious server code.** Like every browser-based end-to-end encrypted app, Tresor trusts the JavaScript the
  server delivers. Someone who can modify the server or its image could serve code that leaks data after the next
  unlock. Protect the host, pull images only from sources you trust, and keep it updated.
- **Emergency contacts keep the key.** Once access was granted, the contact holds the grantor's account key.
  Revoking access stops further downloads but cannot make them forget what they already received. The account key
  is not rotated (a future version may add this).
- **Removed vault members** could have copied what they saw before; the key rotation protects later changes.
- **Public-key trust.** The server distributes public keys; compare fingerprints for sensitive shares.
- **Metadata** listed above is visible to the server and its administrators.
- **Rollback.** The server could serve an older version of an entry; there is no global integrity chain.

## Rotating the master key

The master key protects only the outer layers (wrapped keys, login verifiers, TOTP secrets, notification settings);
content is protected by the users' own keys. Rotate it if `.env` or a backup containing it may have leaked:

```bash
docker compose stop app
docker compose run --rm -e NEW_VAULT_MASTER_KEY='<new key>' app node dist/cli.js rotate-master-key --dry-run
docker compose run --rm -e NEW_VAULT_MASTER_KEY='<new key>' app node dist/cli.js rotate-master-key
# put the new key into .env as VAULT_MASTER_KEY, then
docker compose up -d
```

The command re-encrypts all server-key layers in one transaction, signs out every session and updates the key
fingerprint.

## Recommendations

- Serve Tresor **only via HTTPS** (bundled `https` profile or your reverse proxy) and preferably only inside your
  network or via VPN (WireGuard/Tailscale) – not via a port forwarding.
- Set `TRUST_PROXY` behind a proxy so rate limits see real client IPs; enable `ENABLE_HSTS` once HTTPS works.
- Use a strong password plus 2FA or a passkey; keep the recovery key offline (printed).
- Keep `VAULT_MASTER_KEY` separate from the backups.
- Set `NOTIFY_ALLOW_PRIVATE=false` if not every user is fully trusted.
- Compare key fingerprints before sharing very sensitive vaults.
