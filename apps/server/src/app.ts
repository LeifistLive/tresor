import './types.js';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { ApiErrorBody, ErrorCode } from '@tresor/shared';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import { KeyRing } from './crypto/keys.js';
import { formatParams } from './crypto/primitives.js';
import type { Database } from './db/client.js';
import { AppError, forbidden } from './lib/errors.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { attachmentRoutes } from './routes/attachments.js';
import { authRoutes } from './routes/auth.js';
import { emergencyRoutes } from './routes/emergency.js';
import { noteRoutes } from './routes/notes.js';
import { passkeyRoutes } from './routes/passkeys.js';
import { statsRoutes } from './routes/stats.js';
import { templateRoutes } from './routes/templates.js';
import { vaultRoutes } from './routes/vaults.js';
import { VERSION } from './version.js';

export interface BuildOptions {
  config: Config;
  db: Database;
  logger?: FastifyServerOptions['logger'];
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function findWebRoot(explicit?: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, resolve(here, '../public'), resolve(here, '../../web/dist')].filter(
    (p): p is string => Boolean(p),
  );
  return candidates.find((p) => existsSync(resolve(p, 'index.html'))) ?? null;
}

function errorBody(code: ErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export async function buildApp({ config, db, logger }: BuildOptions) {
  const app = Fastify({
    logger: logger ?? { level: config.LOG_LEVEL },
    // Fastify accepts a hop count at runtime, its typings only list string/boolean.
    trustProxy: config.trustProxy as boolean | string,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('keys', new KeyRing(config.VAULT_MASTER_KEY));
  app.decorate('argon', {
    memoryKiB: config.ARGON2_MEMORY_KIB,
    iterations: config.ARGON2_ITERATIONS,
    parallelism: 1,
  });
  app.decorate('startedAt', Date.now());
  app.decorateRequest('auth', null);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // Argon2id runs as WebAssembly in the browser; this allows compiling WASM, not eval() of JavaScript.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: config.ENABLE_HSTS ? { maxAge: 15_552_000, includeSubDomains: false } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: config.ATTACHMENT_MAX_MB * 1024 * 1024, files: 1 } });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('permissions-policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  });

  // CSRF defence in depth (cookies are already SameSite=Strict): state-changing API calls must carry a
  // custom header, which browsers never attach to cross-site form posts and which forces a CORS preflight.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || SAFE_METHODS.has(req.method)) return;
    if (req.headers['x-tresor-csrf'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') {
      throw forbidden('FORBIDDEN', 'Cross-site request rejected');
    }
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }));
      return reply.code(400).send(errorBody('VALIDATION', 'Invalid input', issues));
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(errorBody(err.code, err.message, err.details));
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send(errorBody('RATE_LIMITED', 'Too many attempts – please wait a few minutes'));
    }
    if (status < 500) {
      const code: ErrorCode = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST';
      return reply.code(status).send(errorBody(code, err.message));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL', 'Internal server error'));
  });

  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { status: 'ok', version: VERSION };
  });

  /** Public, non-sensitive settings the web app needs before/after sign-in. */
  app.get('/api/info', async () => ({
    version: VERSION,
    kdfParams: formatParams(app.argon),
    trashRetentionDays: config.TRASH_RETENTION_DAYS,
    sessionIdleMinutes: config.SESSION_IDLE_MINUTES,
  }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(accountRoutes);
      await api.register(noteRoutes);
      await api.register(attachmentRoutes);
      await api.register(vaultRoutes);
      await api.register(emergencyRoutes);
      await api.register(passkeyRoutes);
      await api.register(templateRoutes);
      await api.register(statsRoutes);
      await api.register(adminRoutes);
    },
    { prefix: '/api' },
  );

  const webRoot = findWebRoot(config.WEB_DIST);
  if (webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      index: false,
      setHeaders(res, path) {
        res.header(
          'cache-control',
          path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
    app.log.info({ webRoot }, 'serving web app');
  }

  app.setNotFoundHandler((req, reply) => {
    const wantsPage =
      (req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api') && webRoot;
    if (!wantsPage) return reply.code(404).send(errorBody('NOT_FOUND', 'Not found'));
    // Client-side routes (/notes, /admin, …) all render the SPA shell; real files are served by @fastify/static.
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });

  return app;
}
