import { x25519 } from '@noble/curves/ed25519.js';
import { type Bytes, bytes, concat, fromBase64, toBase64Url } from './bytes.js';
import { DecryptionError, hkdf, open, seal } from './primitives.js';

/**
 * X25519 key pairs and a small ECIES (ephemeral X25519 → HKDF-SHA256 → AES-256-GCM) used to hand vault keys
 * to members and the account key to emergency contacts. Format: `<ephemeral public key>.<envelope>`.
 */

export interface KeyPair {
  /** Raw 32-byte public key, base64url. */
  publicKey: string;
  privateKey: Bytes;
}

export function generateKeyPair(): KeyPair {
  const privateKey = bytes(x25519.utils.randomSecretKey());
  return { publicKey: toBase64Url(x25519.getPublicKey(privateKey)), privateKey };
}

export function publicKeyOf(privateKey: Uint8Array): string {
  return toBase64Url(x25519.getPublicKey(privateKey));
}

function sharedSecret(privateKey: Uint8Array, publicKey: string): Bytes {
  let pub: Bytes;
  try {
    pub = fromBase64(publicKey);
  } catch {
    throw new DecryptionError('Invalid public key');
  }
  if (pub.length !== 32) throw new DecryptionError('Invalid public key');
  try {
    return bytes(x25519.getSharedSecret(privateKey, pub));
  } catch {
    // Low-order points produce an all-zero secret, which noble rejects.
    throw new DecryptionError('Invalid public key');
  }
}

function boxKey(shared: Uint8Array, ephemeralPub: string, recipientPub: string) {
  return hkdf(shared, concat(fromBase64(ephemeralPub), fromBase64(recipientPub)), 'tresor/ecies/v1');
}

/** Encrypts `data` so that only the owner of `recipientPublicKey` can read it. */
export async function sealTo(recipientPublicKey: string, data: Uint8Array, aad: string): Promise<string> {
  const eph = generateKeyPair();
  const key = await boxKey(
    sharedSecret(eph.privateKey, recipientPublicKey),
    eph.publicKey,
    recipientPublicKey,
  );
  return `${eph.publicKey}.${await seal(key, data, aad)}`;
}

export async function openFrom(
  privateKey: Uint8Array,
  ownPublicKey: string,
  sealed: string,
  aad: string,
): Promise<Bytes> {
  const dot = sealed.indexOf('.');
  if (dot < 1) throw new DecryptionError('Invalid sealed box');
  const ephPub = sealed.slice(0, dot);
  const key = await boxKey(sharedSecret(privateKey, ephPub), ephPub, ownPublicKey);
  return open(key, sealed.slice(dot + 1), aad);
}

/** Short, human-comparable fingerprint of a public key (e.g. "4F2A 9C1B 77E0 D35A"). */
export async function fingerprint(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', fromBase64(publicKey)));
  const hex = Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return hex.match(/.{4}/g)!.join(' ');
}
