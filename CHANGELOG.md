# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-23

First public release.

### Added

- **Zero-knowledge encryption:** keys are derived and used only in the browser (Argon2id via WebAssembly,
  AES-256-GCM and HKDF via WebCrypto, X25519 via @noble/curves). The server stores ciphertext, checks a login proof
  instead of the password and never holds a key that opens content; a server master key adds an outer, rotatable
  layer around stored keys.
- **Entry types** for notes (Markdown), Matter devices, logins, Wi-Fi, cards and keys/codes, with custom fields,
  tags, pinning, expiry dates, version history, encrypted attachments (one key per file) and a trash.
- **Matter & smart home:** QR scanner (camera or photo) for Matter, Wi-Fi and 2FA codes, Matter payload decoding
  with Verhoeff check, devices by room and network, printable QR labels and a Wi-Fi guest card.
- **Sign-in:** password with optional TOTP, passkeys (WebAuthn) that unlock the vault via PRF, recovery key,
  auto-lock, session management.
- **Sharing:** shared vaults with owner/editor/viewer roles; the vault key is replaced by an owner's browser when a
  member leaves, writes carry a key version; public-key fingerprints to verify members.
- **Emergency access** for trusted contacts with a waiting period the grantor can veto.
- **Dashboard** with activity, distribution, expiring entries, password health (weak / reused / old) and a
  security score; **admin dashboard** with users, sign-in statistics, system info and audit log.
- **Notifications** via ntfy, Gotify or webhook (new sign-ins, failed attempts, emergency access, reminders),
  SSRF-hardened.
- **Export / import** in the browser: JSON, Markdown (ZIP) or passphrase-encrypted `.tresor` backup.
- **Operations:** Docker image (multi-stage, non-root, read-only) and Compose stack with PostgreSQL 18, optional
  profiles for local HTTPS (Caddy), nightly dumps and off-site copies via rclone; master key rotation CLI;
  German and English UI; GitHub Actions for CI and releases to GHCR.

### Security

Reviewed from an attacker's perspective before the release; the findings are fixed and covered by tests
(details in `docs/security.md`): recovery proofs derived from the recovery key (not from the account key that
emergency contacts receive), a browser-side floor for Argon2 parameters, password confirmation for adding passkeys
and emergency contacts, SSRF guard for notifications, attachment-to-entry binding, decoy responses for unknown
usernames and safe redirects after sign-in.
