# Development

TypeScript monorepo: `apps/server` (Fastify, Drizzle, PostgreSQL), `apps/web` (React, Vite, Tailwind) and
`packages/shared` (schemas, API types, browser crypto and the zero-knowledge client used by both).

## Setup

Requirements: Node.js 24.7+ (see `.nvmrc`).

```bash
npm ci
cp .env.example .env                          # fill in VAULT_MASTER_KEY
DATABASE_URL=pglite:./data/dev npm run dev    # API on :8080, web app on http://localhost:5173
```

PGlite is an embedded PostgreSQL; for a real one use `DATABASE_URL=postgres://…`.

| Command | |
|---|---|
| `npm run dev` | API and web app in watch mode |
| `npm test` | Crypto unit tests and API tests (PGlite, same client as the web app) |
| `npm run typecheck` | TypeScript checks |
| `npm run check` / `npm run format` | Biome lint & format check / fix |
| `npm run build` | Production build |
| `npm run db:generate` | SQL migration after changing `apps/server/src/db/schema.ts` |

## Rules

- The server never receives plain text or keys: content is encrypted in `packages/shared/src/client`.
- Every UI text exists in German and English (`apps/web/src/i18n`).
- [Conventional Commits](https://www.conventionalcommits.org/); user-facing changes go into `CHANGELOG.md` under
  **Unreleased**.

## Docker image

```bash
docker build -t tresor:local .
```

Then set `TRESOR_IMAGE=tresor:local` in `.env` and run `docker compose up -d`.

## Releasing

Example for 1.2.0:

1. In `CHANGELOG.md` add `## [1.2.0] - YYYY-MM-DD` below `## [Unreleased]`.
2. Bump the versions and commit:
   ```bash
   npm version 1.2.0 --workspaces --include-workspace-root --no-git-tag-version
   npm install --package-lock-only
   git commit -am "chore(release): v1.2.0"
   git tag -a v1.2.0 -m "Tresor v1.2.0"
   ```
3. `git push`, wait for the green CI, then `git push origin v1.2.0`. The release workflow publishes the image
   (`1.2.0`, `1.2`, `1`, `latest`) and the GitHub release with `docker-compose.yml` and `env.example`.
