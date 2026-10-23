# REST API

All endpoints live under `/api`, exchange JSON and authenticate with the `tresor_session` cookie set by sign-in.
Every request that changes state (`POST`, `PATCH`, `PUT`, `DELETE`) must send the header **`x-tresor-csrf: 1`**.

The API carries **ciphertext**: the browser encrypts before sending and decrypts after receiving. Use the
zero-knowledge client in [`packages/shared/src/client`](../packages/shared/src/client) rather than calling the
endpoints by hand – it implements key derivation, wrapping and the formats described in [security.md](security.md).
Request/response types: [`wire.ts`](../packages/shared/src/wire.ts), validation:
[`wire.schema.ts`](../packages/shared/src/wire.schema.ts).

Errors have the shape `{ "error": { "code": "INVALID_CREDENTIALS", "message": "…", "details": … } }`; the codes are
listed in [`packages/shared/src/api.ts`](../packages/shared/src/api.ts).

Notation: *envelope* = base64url AES-256-GCM envelope, *key32* = 32 bytes base64url, *sealed box* =
`<ephemeral public key>.<envelope>` (X25519 ECIES).

## Public

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ status, version }`, checks the database |
| GET | `/info` | `{ version, kdfParams, trashRetentionDays, sessionIdleMinutes }` |
| GET | `/setup/status` | `{ needsSetup }` – true while no user exists |
| POST | `/setup` | First admin: `{ id, username, displayName, language, kdfSalt, kdfParams, authKey, dekWrapped, publicKey, privateKeyEnc, recoveryWrapped, recoveryProof }` → session |
| POST | `/auth/prelogin` | `{ username }` → `{ kdfSalt, kdfParams }` (decoys for unknown users) |
| POST | `/auth/login` | `{ username, authKey, totp? }` → session. `401 TOTP_REQUIRED` asks for the code |
| POST | `/auth/passkey/options` | WebAuthn request options + PRF salt |
| POST | `/auth/passkey` | `{ challengeId, response }` → session (the PRF output never leaves the browser) |
| POST | `/auth/recover/start` | `{ username }` → `{ userId, recoveryWrapped }` (decoys for unknown users) |
| POST | `/auth/recover` | `{ username, recoveryProof, recoveryWrapped, newRecoveryProof, kdfSalt, kdfParams, authKey, dekWrapped }` → session |
| POST | `/auth/logout` | Ends the current session |

A *session* response is `{ user: MeDto, keys: { userId, dekWrapped, publicKey, privateKeyEnc } | null, sessionKey }`
(`keys` is null for admin-created accounts that have not chosen a password yet).

Sign-in, recovery and setup are rate limited per IP (`LOGIN_RATE_LIMIT` per 5 minutes; prelogin 3×).

## Account (signed in)

| Method | Path | Description |
|---|---|---|
| GET | `/auth/me` | Current user (`MeDto`) |
| GET | `/auth/session-key` | `{ sessionKey, publicKey, privateKeyEnc }` – reopens the browser's stored keys after a reload |
| POST | `/account/password` | `{ currentAuthKey, kdfSalt, kdfParams, authKey, dekWrapped, account? }` – `account` (`publicKey, privateKeyEnc, recoveryWrapped, recoveryProof`) exactly once for admin-created accounts; signs out other sessions |
| POST | `/account/recovery-key` | `{ authKey, recoveryWrapped, recoveryProof }` – replaces the recovery key |
| POST | `/account/verify-password` | `{ authKey }` – check before a passkey ceremony |
| PATCH | `/account/preferences` | `{ displayName?, language?, theme?, autoLockMinutes? }` |
| GET | `/account/sessions` | Active sessions |
| DELETE | `/account/sessions/:id` | Revoke one session, or `others` for all but the current |
| POST | `/account/totp/setup` | `{ authKey }` → `{ secret, uri }` |
| POST | `/account/totp/enable` | `{ code }` |
| POST | `/account/totp/disable` | `{ authKey }` |
| GET | `/account/passkeys` | Registered passkeys |
| POST | `/account/passkeys/options` | WebAuthn creation options + PRF salt |
| POST | `/account/passkeys` | `{ authKey, challengeId, name, response, dekWrapped? }` – `dekWrapped` = DEK wrapped with the PRF output (browser) |
| PATCH / DELETE | `/account/passkeys/:id` | Rename / remove |
| GET / PUT | `/account/notifications` | Push channel (`ntfy`/`gotify`/`webhook`) and events |
| POST | `/account/notifications/test` | Send a test message |
| POST | `/account/exported` | `{ format, count }` – records an export made in the browser |

While an admin-issued password has not been replaced, only `/auth/me`, `/auth/session-key`, `/auth/logout`,
`/account/password` and `/account/preferences` are allowed (`403 PASSWORD_CHANGE_REQUIRED`).

## Entries

| Method | Path | Description |
|---|---|---|
| GET | `/notes?status=active\|trash` | `{ notes: NoteRecordDto[], vaultKeys: [{ vaultId, role, keyWrapped, keyVersion }] }` |
| GET | `/notes/:id` | One record |
| POST | `/notes` | `{ id, type, payload, pinned?, vaultId?, vaultKeyVersion?, expiresAt? }` – `payload` = envelope of `{ title, content, fields, customFields, tags }` with AAD `note:<id>` |
| PATCH | `/notes/:id` | `{ type?, payload?, vaultKeyVersion?, pinned?, expiresAt? }` – a new payload archives the previous one as a version |
| POST | `/notes/:id/move` | `{ vaultId, vaultKeyVersion?, payload, expectedUpdatedAt, versions[], attachments[] }` – everything re-encrypted for the target |
| DELETE | `/notes/:id` | Move to trash; `?permanent=true` deletes for good |
| POST | `/notes/:id/restore` | Restore from trash |
| DELETE | `/trash` | Empty the trash |
| POST | `/notes/import` | `{ notes: [{ id, type, payload, pinned, expiresAt, createdAt?, updatedAt? }] }` (≤ 500 per request) |
| GET | `/notes/:id/versions` | `{ versions: [{ id, type, payload, savedAt, author }] }` |
| POST | `/notes/:id/versions/:vid/restore` | Restore a version (the current state becomes a version) |
| POST | `/notes/:id/attachments` | `multipart/form-data`: fields `id`, `meta` (envelope of `{ name, mime, key, note }`), `keyVersion?`, then `file` (encrypted) |
| GET | `/notes/:id/attachments/:aid` | The encrypted file |
| DELETE | `/notes/:id/attachments/:aid` | Delete |
| GET | `/stats?days=7\|14\|30\|90&tz=Europe/Berlin` | Metadata statistics (`ServerStatsDto`) |

Writes into shared vaults must carry the current `vaultKeyVersion` / `keyVersion`; otherwise `409 STALE`.

Entry types and their fields (inside the encrypted payload):

| `type` | `fields` |
|---|---|
| `note` | – |
| `matter` | `setupCode`, `qrPayload` (`MT:…`), `manufacturer`, `model`, `room`, `network` (`thread`/`wifi`/`ethernet`) |
| `login` | `username`, `password`, `url`, `totp` (Base32 secret or `otpauth://` URI) |
| `wifi` | `ssid`, `password`, `security` (`WPA`/`WEP`/`nopass`) |
| `card` | `holder`, `number`, `expiry`, `cvc`, `pin` |
| `secret` | `value` |

## Shared vaults, emergency access, templates

| Method | Path | Description |
|---|---|---|
| GET | `/users/directory` | Users entries can be shared with, including their `publicKey` |
| GET | `/vaults` | `VaultRecordDto[]` (encrypted name, own sealed key, key version, members with public keys) |
| POST | `/vaults` | `{ id, nameEnc, keyWrapped }` |
| PATCH | `/vaults/:id` | `{ nameEnc, keyVersion }` (owner) |
| DELETE | `/vaults/:id` | Delete (owner) |
| POST | `/vaults/:id/members` | `{ userId, role, keyWrapped, keyVersion }` (owner) |
| PATCH | `/vaults/:id/members/:userId` | `{ role }` (owner) |
| DELETE | `/vaults/:id/members/:userId` | Remove a member (owner) or leave (own id); marks the vault for key rotation |
| GET | `/vaults/:id/rotation` | Everything needed to rotate the key (owner) |
| POST | `/vaults/:id/rotate` | `{ keyVersion, nameEnc, notes[], versions[], attachments[], members[] }` (owner) – atomic, `409 STALE` if anything changed |
| GET | `/emergency` | `{ granted, received }` |
| POST | `/emergency` | `{ authKey, id, granteeId, waitDays, keyWrapped }` – DEK sealed to the contact |
| PATCH / DELETE | `/emergency/:id` | Change waiting period / revoke (grantor) or decline (contact) |
| POST | `/emergency/:id/request` | Contact requests access |
| POST | `/emergency/:id/approve` · `/reject` | Grantor decides |
| GET | `/emergency/:id/notes` | `{ notes: NoteRecordDto[], keyWrapped }` once access is open |
| GET | `/emergency/:id/notes/:noteId/attachments/:aid` | Encrypted file of the grantor |
| GET / POST | `/templates` | List / create `{ id, payload }` |
| PUT / DELETE | `/templates/:id` | Replace `{ payload }` / delete |

## Admin (role `admin`)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/stats?tz=…` | Users, entry counts, sign-ins per day, failed attempts, system info |
| GET | `/admin/users` | All users with entry counts |
| POST | `/admin/users` | `{ username, displayName, role, password }` – temporary password; the account gets keys when the user chooses their own |
| PATCH | `/admin/users/:id` | `{ role?, disabled?, displayName? }` (the last active admin is protected) |
| POST | `/admin/users/:id/reset` | `{ password }` – **deletes the user's entries and keys**, new temporary password |
| POST | `/admin/users/:id/logout` | Revoke all sessions of the user |
| DELETE | `/admin/users/:id` | Delete user and entries |
| GET | `/admin/audit?limit=&before=&action=&user=` | Audit log, newest first, cursor via `before` |
