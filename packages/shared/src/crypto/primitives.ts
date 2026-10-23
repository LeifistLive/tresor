import { argon2id as argon2idWasm } from 'hash-wasm';
import { type Bytes, bytes, concat, fromBase64, fromUtf8, randomBytes, toBase64Url, utf8 } from './bytes.js';

/**
 * Envelope layout (base64url): version (1 byte) | IV (12 bytes) | ciphertext | GCM tag (16 bytes).
 */
const ENVELOPE_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class DecryptionError extends Error {
  constructor(message = 'Decryption failed') {
    super(message);
    this.name = 'DecryptionError';
  }
}

const subtle = () => globalThis.crypto.subtle;
type AesKey = Awaited<ReturnType<ReturnType<typeof subtle>['importKey']>>;

function aesKey(key: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<AesKey> {
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  return subtle().importKey('raw', bytes(key), 'AES-GCM', false, [usage]);
}

/** AES-256-GCM. `aad` binds the ciphertext to its context (row id, purpose). Returns the binary envelope. */
export async function sealBytes(
  key: Uint8Array,
  plaintext: Uint8Array | string,
  aad: string,
): Promise<Bytes> {
  const iv = randomBytes(IV_LENGTH);
  const data = typeof plaintext === 'string' ? utf8(plaintext) : bytes(plaintext);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad), tagLength: TAG_LENGTH * 8 },
    await aesKey(key, 'encrypt'),
    data,
  );
  return concat(new Uint8Array([ENVELOPE_VERSION]), iv, new Uint8Array(ct));
}

export async function openBytes(key: Uint8Array, envelope: Uint8Array, aad: string): Promise<Bytes> {
  if (envelope.length < 1 + IV_LENGTH + TAG_LENGTH || envelope[0] !== ENVELOPE_VERSION) {
    throw new DecryptionError('Unsupported or corrupt envelope');
  }
  try {
    const pt = await subtle().decrypt(
      {
        name: 'AES-GCM',
        iv: bytes(envelope.subarray(1, 1 + IV_LENGTH)),
        additionalData: utf8(aad),
        tagLength: TAG_LENGTH * 8,
      },
      await aesKey(key, 'decrypt'),
      bytes(envelope.subarray(1 + IV_LENGTH)),
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptionError();
  }
}

/** Text variant of `sealBytes` (base64url envelope). */
export async function seal(key: Uint8Array, plaintext: Uint8Array | string, aad: string): Promise<string> {
  return toBase64Url(await sealBytes(key, plaintext, aad));
}

export async function open(key: Uint8Array, envelope: string, aad: string): Promise<Bytes> {
  let raw: Bytes;
  try {
    raw = fromBase64(envelope);
  } catch {
    throw new DecryptionError('Corrupt envelope');
  }
  return openBytes(key, raw, aad);
}

export async function openText(key: Uint8Array, envelope: string, aad: string): Promise<string> {
  return fromUtf8(await open(key, envelope, aad));
}

/** HKDF-SHA256. An empty salt behaves like Node's `hkdfSync(…, '', …)`. */
export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array | string,
  info: string,
  length = 32,
): Promise<Bytes> {
  const base = await subtle().importKey('raw', bytes(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: typeof salt === 'string' ? utf8(salt) : bytes(salt),
      info: utf8(info),
    },
    base,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function sha256(data: Uint8Array | string): Promise<Bytes> {
  return new Uint8Array(
    await subtle().digest('SHA-256', typeof data === 'string' ? utf8(data) : bytes(data)),
  );
}

export interface Argon2Params {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** Upper bounds for parameters read from untrusted places (server responses, backup files). */
export const ARGON2_LIMITS = { memoryKiB: 1_048_576, iterations: 10, parallelism: 8 } as const;

export function formatParams(p: Argon2Params): string {
  return `m=${p.memoryKiB},t=${p.iterations},p=${p.parallelism}`;
}

export function parseParams(s: string): Argon2Params {
  const m = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(s);
  if (!m) throw new Error(`Invalid argon2 params: ${s}`);
  const p = { memoryKiB: Number(m[1]), iterations: Number(m[2]), parallelism: Number(m[3]) };
  if (
    p.memoryKiB < 1024 ||
    p.memoryKiB > ARGON2_LIMITS.memoryKiB ||
    p.iterations < 1 ||
    p.iterations > ARGON2_LIMITS.iterations ||
    p.parallelism < 1 ||
    p.parallelism > ARGON2_LIMITS.parallelism
  ) {
    throw new Error(`Unsupported argon2 params: ${s}`);
  }
  return p;
}

/** Argon2id (RFC 9106) via WebAssembly – bit-identical to Node's built-in `crypto.argon2`. */
export async function argon2id(
  password: string | Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
  length = 32,
): Promise<Bytes> {
  const out = await argon2idWasm({
    password: typeof password === 'string' ? utf8(password) : bytes(password),
    salt: bytes(salt),
    iterations: params.iterations,
    parallelism: params.parallelism,
    memorySize: params.memoryKiB,
    hashLength: length,
    outputType: 'binary',
  });
  return bytes(out);
}
