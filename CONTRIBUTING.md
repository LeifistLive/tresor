# Contributing

Thanks for helping to improve Tresor!

1. Read [docs/development.md](docs/development.md) to set up the project (Node.js ≥ 24.7).
2. Create a branch: `feat/short-description` or `fix/short-description`.
3. Keep changes focused. Run before pushing:
   ```bash
   npm run check      # Biome lint + format
   npm run typecheck
   npm test
   ```
4. Use [Conventional Commits](https://www.conventionalcommits.org/) – e.g. `feat(notes): add duplicate action`,
   `fix(auth): handle expired sessions`, `docs: explain backups`.
5. Add an entry under **Unreleased** in `CHANGELOG.md` for user-facing changes.
6. Every UI string needs a German (`apps/web/src/i18n/de.ts`) and an English (`en.ts`) translation – the
   English file is type-checked against the German one.
7. Changes to `apps/server/src/db/schema.ts` need a migration: `npm run db:generate`.

Security-relevant changes (crypto, auth, sessions) should explain their reasoning in the pull request and keep
[docs/security.md](docs/security.md) up to date.
