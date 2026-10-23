# Development

## Prerequisites

- Node.js **24.7+** (see `.nvmrc`) – Tresor relies on the built-in `crypto.argon2`
- npm 11 (ships with Node 24)
- Optional: a PostgreSQL 18 server (otherwise the embedded PGlite is used)

## Setup

```bash
npm ci
cp .env.example .env    # set VAULT_MASTER_KEY (≥ 32 chars) and POSTGRES_PASSWORD
```

### Database options

**Embedded (no Docker):** PGlite runs Postgres in-process – ideal for quick UI work.

```bash
DATABASE_URL=pglite:./data/dev npm run dev
```

**Real PostgreSQL:** point `DATABASE_URL` at any PostgreSQL 18 database; migrations run on start.

```bash
DATABASE_URL=postgres://tresor:<password>@localhost:5432/tresor npm run dev
```

`npm run dev` starts the API on <http://localhost:8080> (tsx watch) and Vite on <http://localhost:5173> with
a proxy for `/api`. For plain-HTTP development set `COOKIE_SECURE=false` (the default `auto` also works on
`http://localhost`).

## Docker image

Build the image from the repository and run it with the normal compose file:

```bash
docker build -t tresor:local .
```

Then set `TRESOR_IMAGE=tresor:local` in `.env` and start with `docker compose up -d`.

## Scripts

| Command | |
|---|---|
| `npm run dev` | API + web app in watch mode |
| `npm run build` | Production build (`apps/web/dist`, `apps/server/dist`) |
| `npm start` | Run the built server (serves the built web app) |
| `npm test` | Vitest: crypto unit tests + API integration tests on PGlite |
| `npm run typecheck` | `tsc --noEmit` in all workspaces |
| `npm run check` / `npm run format` | Biome lint & format check / auto-fix |
| `npm run db:generate` | Create a SQL migration after changing `apps/server/src/db/schema.ts` |

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:` …).
- **Branches:** `main` is always releasable; work in `feat/*`, `fix/*` branches and open a pull request. CI must
  be green (lint, types, tests, build, Docker smoke test).
- **Code style:** Biome (2 spaces, single quotes, 110 columns). No default exports except where libraries need
  them (lazy pages, Markdown chunk).
- **i18n:** add every string in German and English (`apps/web/src/i18n/de.ts` + `en.ts`, or `de-features.ts` +
  `en-features.ts`); the English files are type-checked against the German ones.
- **Validation:** request schemas live in `packages/shared` and are used by API and UI.
- **Security-relevant code** (crypto, auth) needs tests in `apps/server/test`.
- **Zero knowledge:** the server must never receive plaintext or keys. New features that handle content encrypt in
  `packages/shared/src/client` (browser) and send ciphertext; the server only stores it and checks access.

## Testing

```bash
npm test
```

The API tests start Fastify with an in-memory PGlite database, run the real migrations and drive it with the
**same zero-knowledge client the web app uses** (`packages/shared/src/client`) over `app.inject`: setup, sign-in,
2FA with replay protection, recovery, multi-user isolation, admin actions, sharing with key rotation, emergency
access, passkeys (software authenticator with PRF), export/import and master key rotation.
They assert that neither the password nor plaintext ever reaches the server or the database, and they contain
attack scenarios from the security review (account takeover via emergency access, KDF downgrade, SSRF, stale
vault keys).

## Releasing

Example for version 1.1.0, starting from a clean working tree:

1. In `CHANGELOG.md`, add the heading `## [1.1.0] - YYYY-MM-DD` directly below `## [Unreleased]`, so the
   collected changes move into the new version.
2. Bump the version in all `package.json` files and the lockfile:
   ```bash
   npm version 1.1.0 --workspaces --include-workspace-root --no-git-tag-version
   npm install --package-lock-only
   ```
3. Commit and tag:
   ```bash
   git commit -am "chore(release): v1.1.0"
   git tag -a v1.1.0 -m "Tresor v1.1.0"
   ```
4. `git push --follow-tags` – the *Release* workflow builds `linux/amd64` + `linux/arm64` images, pushes
   `ghcr.io/leifistlive/tresor:{1.1.0,1.1,1,latest}` and creates the GitHub release from the changelog section.

Versioning follows SemVer: breaking changes to configuration, data format or API → major; features → minor;
fixes → patch.
