import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import {
  ApiError,
  type Method as ClientMethod,
  type Transport,
  TresorClient,
  type UploadForm,
} from '@tresor/shared/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { KeyRing } from '../src/crypto/keys.js';
import { type Database, openDatabase } from '../src/db/client.js';
import { verifyMasterKey } from '../src/services/system.js';

export const MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnopqrstuvwxyz';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite:memory',
    VAULT_MASTER_KEY: MASTER_KEY,
    ARGON2_MEMORY_KIB: '8192',
    ARGON2_ITERATIONS: '1',
    LOG_LEVEL: 'silent',
    LOGIN_RATE_LIMIT: '1000',
    WEB_DIST: '/nonexistent',
    ...overrides,
  });
}

export async function createTestApp(overrides: Record<string, string> = {}) {
  const config = testConfig(overrides);
  const database = await openDatabase(config.DATABASE_URL);
  await database.migrate();
  await verifyMasterKey(database.db, new KeyRing(config.VAULT_MASTER_KEY));
  const app = await buildApp({ config, db: database.db, logger: false });
  app.addHook('onClose', async () => database.close());
  await app.ready();
  return { app, db: database.db };
}

/** A second app instance on an existing database (e.g. after rotating the master key). */
export async function appOnDatabase(db: Database, overrides: Record<string, string> = {}) {
  const config = testConfig(overrides);
  await verifyMasterKey(db, new KeyRing(config.VAULT_MASTER_KEY));
  const app = await buildApp({ config, db, logger: false });
  await app.ready();
  return app;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Minimal cookie-aware client around `app.inject`. */
export class TestClient {
  cookie: string | undefined;

  constructor(private readonly app: FastifyInstance) {}

  async request<T = any>(method: Method, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      ...(body === undefined ? {} : { payload: body as object }),
      headers: {
        'x-tresor-csrf': '1',
        origin: 'http://localhost',
        ...(this.cookie ? { cookie: `tresor_session=${this.cookie}` } : {}),
        ...headers,
      },
    });
    const setCookie = res.cookies.find((c) => c.name === 'tresor_session');
    if (setCookie) this.cookie = setCookie.value || undefined;
    let json: T | undefined;
    try {
      json = res.json() as T;
    } catch {
      json = undefined;
    }
    return { status: res.statusCode, body: json as T, raw: res };
  }

  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown) {
    return this.request<T>('POST', url, body ?? {});
  }
  put<T = any>(url: string, body: unknown) {
    return this.request<T>('PUT', url, body);
  }
  patch<T = any>(url: string, body: unknown) {
    return this.request<T>('PATCH', url, body);
  }
  delete<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }

  upload<T = any>(method: 'POST' | 'PUT', url: string, form: UploadForm) {
    const boundary = `----tresor${randomBytes(8).toString('hex')}`;
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(form.fields)) {
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
      );
    }
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${form.file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(form.file.data),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    );
    return this.request<T>(method, url, Buffer.concat(parts), {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
  }

  /** A transport for the shared zero-knowledge client that goes through this cookie jar. */
  transport(): Transport {
    const check = <T>(res: { status: number; body: any }): T => {
      if (res.status >= 400) {
        throw new ApiError(res.status, res.body?.error?.code ?? 'INTERNAL', res.body?.error?.message ?? '');
      }
      return res.body as T;
    };
    return {
      json: async <T>(method: ClientMethod, path: string, body?: unknown) =>
        check<T>(await this.request(method, `/api${path}`, body)),
      bytes: async (path: string) => {
        const res = await this.request('GET', `/api${path}`);
        check(res);
        return new Uint8Array(res.raw.rawPayload);
      },
      upload: async <T>(method: 'POST' | 'PUT', path: string, form: UploadForm) =>
        check<T>(await this.upload(method, `/api${path}`, form)),
    };
  }
}

/** Test KDF cost – must match ARGON2_* in testConfig. */
export const TEST_KDF = 'm=8192,t=1,p=1';

/** A "browser": the shared zero-knowledge client plus the raw HTTP client it uses. */
export class Browser {
  readonly http: TestClient;
  readonly client: TresorClient;

  constructor(app: FastifyInstance) {
    this.http = new TestClient(app);
    this.client = new TresorClient(this.http.transport(), {
      kdfParams: TEST_KDF,
      minKdf: { memoryKiB: 8192, iterations: 1 },
    });
  }
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

/**
 * Software WebAuthn authenticator (ES256, "none" attestation, user verification, PRF via HMAC) – enough to
 * drive the real server-side verification in tests.
 */
export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private readonly prfSecret = randomBytes(32);
  private counter = 0;

  constructor(
    readonly rpId = 'localhost',
    readonly origin = 'http://localhost',
  ) {}

  prf(saltB64url: string): string {
    return b64url(createHmac('sha256', this.prfSecret).update(Buffer.from(saltB64url, 'base64url')).digest());
  }

  private authData(flags: number, extra?: Buffer) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.counter);
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), counter, ...(extra ? [extra] : [])]);
  }

  register(options: { challenge: string }) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, Buffer.from(cose)]);
    const authData = this.authData(0x45, attested); // UP | UV | AT
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, never>>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, never>()],
        ['authData', authData],
      ]),
    );
    const clientData = JSON.stringify({
      type: 'webauthn.create',
      challenge: options.challenge,
      origin: this.origin,
    });
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(Buffer.from(clientData)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  authenticate(options: { challenge: string }, tamper = false) {
    const authData = this.authData(0x05); // UP | UV
    const clientData = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: this.origin }),
    );
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.keys.privateKey);
    if (tamper) signature[signature.length - 1]! ^= 0xff;
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: b64url(randomBytes(16)),
      },
      clientExtensionResults: {},
    };
  }
}
