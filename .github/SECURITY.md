# Security policy

Tresor stores secrets, so security reports are very welcome.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private
[security advisory](https://github.com/LeifistLive/tresor/security/advisories/new) form of this repository instead and include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible),
- the affected version (shown in the sidebar and in `GET /api/health`).

You can expect a first answer within a week. Fixes are released as a new patch version and mentioned in
`CHANGELOG.md` once users had a chance to update.

## Supported versions

Only the latest minor release receives security fixes.

## Scope & design

How data is encrypted, what an administrator or an attacker with database access can and cannot see, and
hardening recommendations are documented in [docs/security.md](../docs/security.md).
