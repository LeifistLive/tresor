# syntax=docker/dockerfile:1.7
# Tresor – multi-stage build: one small image that serves the API and the web app.

ARG NODE_VERSION=24-alpine

# --- 1. All dependencies (needed to build) --------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# --- 2. Build web app (Vite) and server bundle (tsup) ---------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build

# --- 3. Production dependencies of the server only ------------------------------------------------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace=@tresor/server --no-audit --no-fund \
 # optional peers that npm keeps but the runtime never loads (embedded dev DB, compiler, typings)
 && rm -rf node_modules/@electric-sql node_modules/typescript node_modules/@typescript node_modules/@types

# --- 4. Runtime -----------------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Tresor" \
      org.opencontainers.image.description="Self-hosted, zero-knowledge vault for notes, Matter codes and secrets" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIST=/app/public \
    MIGRATIONS_DIR=/app/drizzle

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./public

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/index.js"]
