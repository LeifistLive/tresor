import { z } from 'zod';

const boolish = z.enum(['true', 'false']).transform((v) => v === 'true');
/** Compose passes unset variables as empty strings – treat those as "not configured". */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  VAULT_MASTER_KEY: z
    .string()
    .min(32, 'VAULT_MASTER_KEY must be at least 32 characters (generate one with: openssl rand -base64 48)'),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  TRUST_PROXY: z.string().default('false'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  SESSION_IDLE_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(4096).max(1_048_576).default(65_536),
  ARGON2_ITERATIONS: z.coerce.number().int().min(1).max(10).default(3),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  TRASH_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(365),
  ATTACHMENT_MAX_MB: z.coerce.number().int().min(1).max(500).default(25),
  IMPORT_MAX_MB: z.coerce.number().int().min(1).max(2000).default(200),
  /** Optional WebAuthn overrides when the hostname seen by the server differs from the browser's. */
  WEBAUTHN_RP_ID: optionalString,
  WEBAUTHN_ORIGIN: optionalString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WEB_DIST: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
  ENABLE_HSTS: boolish.default(false),
  /** Notifications may go to loopback/private addresses (local ntfy/Gotify). Link-local is always refused. */
  NOTIFY_ALLOW_PRIVATE: boolish.default(true),
});

export type Config = z.infer<typeof envSchema> & {
  trustProxy: boolean | number | string;
};

function parseTrustProxy(raw: string): boolean | number | string {
  const v = raw.trim();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return { ...result.data, trustProxy: parseTrustProxy(result.data.TRUST_PROXY) };
}
