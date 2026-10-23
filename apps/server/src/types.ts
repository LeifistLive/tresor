import type { Config } from './config.js';
import type { KeyRing } from './crypto/keys.js';
import type { Argon2Params } from './crypto/primitives.js';
import type { Database } from './db/client.js';
import type { UserRow } from './db/schema.js';

export interface AuthContext {
  user: UserRow;
  sessionId: string;
  /** The session's random key, sealed with the cookie token (returned to the browser on request). */
  keyEnc: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    keys: KeyRing;
    /** Argon2id parameters for new passwords (advertised to browsers, minimum accepted). */
    argon: Argon2Params;
    startedAt: number;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    /** Route stays reachable while the user still has to replace an admin-issued password. */
    allowPending?: boolean;
  }
}
