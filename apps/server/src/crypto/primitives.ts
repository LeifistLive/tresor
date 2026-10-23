import {
  argon2,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Envelope layout (base64url): version (1 byte) | IV (12 bytes) | ciphertext | GCM tag (16 bytes)
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

/** AES-256-GCM encryption. `aad` binds the ciphertext to its context (e.g. the row id). */
export function seal(key: Buffer, plaintext: Buffer | string, aad: string): string {
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, ct, cipher.getAuthTag()]).toString('base64url');
}

export function open(key: Buffer, envelope: string, aad: string): Buffer {
  const buf = Buffer.from(envelope, 'base64url');
  if (buf.length < 1 + IV_LENGTH + TAG_LENGTH || buf[0] !== ENVELOPE_VERSION) {
    throw new DecryptionError('Unsupported or corrupt envelope');
  }
  const iv = buf.subarray(1, 1 + IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ct = buf.subarray(1 + IV_LENGTH, buf.length - TAG_LENGTH);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

/** Binary variant of `seal` (no base64) for large blobs such as attachments. */
export function sealBytes(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  return Buffer.from(seal(key, plaintext, aad), 'base64url');
}

export function openBytes(key: Buffer, envelope: Buffer, aad: string): Buffer {
  return open(key, envelope.toString('base64url'), aad);
}

export function openText(key: Buffer, envelope: string, aad: string): string {
  return open(key, envelope, aad).toString('utf8');
}

export function hkdf(ikm: Buffer | string, salt: Buffer | string, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

export function hmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function randomKey(bytes = 32): Buffer {
  return randomBytes(bytes);
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Argon2Params {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** Argon2id via Node's built-in implementation (Node >= 24.7). */
export function argon2id(
  password: string | Buffer,
  salt: Buffer,
  params: Argon2Params,
  secret?: Buffer,
  length = 32,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        parallelism: params.parallelism,
        tagLength: length,
        memory: params.memoryKiB,
        passes: params.iterations,
        ...(secret ? { secret } : {}),
      },
      (err, derived) => (err ? reject(err) : resolve(Buffer.from(derived))),
    );
  });
}

export function formatParams(p: Argon2Params): string {
  return `m=${p.memoryKiB},t=${p.iterations},p=${p.parallelism}`;
}

export function parseParams(s: string): Argon2Params {
  const m = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(s);
  if (!m) throw new Error(`Invalid argon2 params: ${s}`);
  return { memoryKiB: Number(m[1]), iterations: Number(m[2]), parallelism: Number(m[3]) };
}
