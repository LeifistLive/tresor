import { decryptBackup, encryptBackup } from '@tresor/shared/client';
import * as C from '@tresor/shared/crypto';
import { describe, expect, it } from 'vitest';
import {
  authKeyFromPassword,
  checkAuthVerifier,
  checkProof,
  KeyRing,
  newSessionToken,
  openSessionKey,
  proofHash,
  sealAuthVerifier,
  sealSessionKey,
} from '../src/crypto/keys.js';
import { argon2id, DecryptionError, open, randomKey, seal } from '../src/crypto/primitives.js';
import { isBlockedAddress } from '../src/lib/outbound.js';

const params = { memoryKiB: 8192, iterations: 1, parallelism: 1 };
const keys = new KeyRing('unit-test-master-key-with-enough-entropy-123456');

describe('AES-256-GCM envelope', () => {
  it('round-trips and uses a fresh IV every time', () => {
    const key = randomKey();
    const a = seal(key, 'geheim', 'note:1');
    expect(a).not.toEqual(seal(key, 'geheim', 'note:1'));
    expect(open(key, a, 'note:1').toString()).toBe('geheim');
  });

  it('is the same format in Node and in the browser', async () => {
    const key = randomKey();
    expect(C.fromUtf8(await C.open(key, seal(key, 'node', 'x'), 'x'))).toBe('node');
    expect(open(key, await C.seal(key, 'browser', 'y'), 'y').toString()).toBe('browser');
  });

  it('rejects tampered ciphertext, wrong keys and wrong AAD', async () => {
    const key = randomKey();
    const env = await C.seal(key, 'geheim', 'note:1');
    const bytes = Buffer.from(env, 'base64url');
    bytes[bytes.length - 20]! ^= 0x01;
    expect(() => open(key, bytes.toString('base64url'), 'note:1')).toThrow(DecryptionError);
    await expect(C.open(key, bytes.toString('base64url'), 'note:1')).rejects.toThrow(C.DecryptionError);
    await expect(C.open(randomKey(), env, 'note:1')).rejects.toThrow(C.DecryptionError);
    await expect(C.open(key, env, 'note:2')).rejects.toThrow(C.DecryptionError);
  });
});

describe('key derivation', () => {
  it('Argon2id in the browser (WebAssembly) matches Node', async () => {
    const salt = Buffer.alloc(16, 3);
    const node = await argon2id('pässwört', salt, params);
    expect(Buffer.from(await C.argon2id('pässwört', salt, params)).equals(node)).toBe(true);
  });

  it('the server derives the same auth key for temporary passwords', async () => {
    const kdf = C.newKdfSettings(params);
    const browser = await C.authKeyOf(await C.deriveMasterKey('pw-12345678', kdf));
    expect(await authKeyFromPassword('pw-12345678', kdf.kdfSalt, kdf.kdfParams)).toBe(browser);
  });

  it('wraps the account key with password, recovery key and passkey PRF', async () => {
    const dek = C.newSymmetricKey();
    const master = await C.deriveMasterKey('password-123', C.newKdfSettings(params));
    const pw = await C.wrapWithMasterKey(master, 'u1', dek);
    expect([...(await C.unwrapWithMasterKey(master, 'u1', pw))]).toEqual([...dek]);
    await expect(C.unwrapWithMasterKey(master, 'u2', pw)).rejects.toThrow(); // bound to the account

    const rk = C.generateRecoveryKey();
    const typed = ` ${rk.display.toLowerCase().replace(/-/g, ' ')} `;
    const rw = await C.wrapWithRecoveryKey(rk.bytes, 'u1', dek);
    expect([...(await C.unwrapWithRecoveryKey(C.parseRecoveryKey(typed), 'u1', rw))]).toEqual([...dek]);
    expect(() => C.parseRecoveryKey('AAAA-BBBB')).toThrow(C.DecryptionError);

    const prf = C.newSymmetricKey();
    const pk = await C.wrapWithPrf(prf, 'cred-1', dek);
    expect([...(await C.unwrapWithPrf(prf, 'cred-1', pk))]).toEqual([...dek]);
    await expect(C.unwrapWithPrf(prf, 'cred-2', pk)).rejects.toThrow();
  });

  it('round-trips sealed boxes between users', async () => {
    const a = C.generateKeyPair();
    const box = await C.sealTo(a.publicKey, new Uint8Array([1, 2, 3]), 'aad');
    expect([...(await C.openFrom(a.privateKey, a.publicKey, box, 'aad'))]).toEqual([1, 2, 3]);
    await expect(C.openFrom(a.privateKey, a.publicKey, box, 'other')).rejects.toThrow();
    const b = C.generateKeyPair();
    await expect(C.openFrom(b.privateKey, b.publicKey, box, 'aad')).rejects.toThrow();
  });
});

describe('login verifiers', () => {
  it('accept only the right auth key and are bound to the account and master key', async () => {
    const authKey = await C.authKeyOf(C.newSymmetricKey());
    const sealed = sealAuthVerifier(keys, 'u1', authKey);
    expect(sealed).not.toContain(authKey);
    expect(checkAuthVerifier(keys, 'u1', sealed, authKey)).toBe(true);
    expect(checkAuthVerifier(keys, 'u1', sealed, await C.authKeyOf(C.newSymmetricKey()))).toBe(false);
    expect(checkAuthVerifier(keys, 'u2', sealed, authKey)).toBe(false);
    const other = new KeyRing('another-master-key-with-enough-entropy-654321');
    expect(checkAuthVerifier(other, 'u1', sealed, authKey)).toBe(false);
  });

  it('check recovery proofs', async () => {
    const rk = C.generateRecoveryKey();
    const hash = proofHash(await C.recoveryProofOf(rk.bytes));
    expect(hash).toBe(await C.verifierOf(await C.recoveryProofOf(rk.bytes)));
    expect(checkProof(hash, await C.recoveryProofOf(rk.bytes))).toBe(true);
    expect(checkProof(hash, await C.recoveryProofOf(C.generateRecoveryKey().bytes))).toBe(false);
    expect(checkProof(null, await C.recoveryProofOf(rk.bytes))).toBe(false);
  });
});

describe('outbound requests (SSRF guard)', () => {
  it('always refuses link-local, unspecified and multicast targets', () => {
    for (const ip of [
      '169.254.169.254',
      '0.0.0.0',
      '224.0.0.1',
      'fe80::1',
      '::',
      '::ffff:169.254.169.254',
      'nonsense',
    ]) {
      expect(isBlockedAddress(ip, true)).toBe(true);
    }
  });

  it('refuses loopback and private networks unless allowed', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.178.10',
      '100.64.1.1',
      '::1',
      'fd00::1',
      '::ffff:192.168.1.1',
    ]) {
      expect(isBlockedAddress(ip, false)).toBe(true);
      expect(isBlockedAddress(ip, true)).toBe(false);
    }
    expect(isBlockedAddress('93.184.216.34', false)).toBe(false);
    expect(isBlockedAddress('2606:4700::1111', false)).toBe(false);
  });
});

describe('sessions', () => {
  it('bind the session key to the cookie token', () => {
    const key = randomKey();
    const { token, id } = newSessionToken();
    const sealed = sealSessionKey(keys, token, id, key);
    expect(openSessionKey(keys, token, id, sealed).equals(key)).toBe(true);
    expect(() => openSessionKey(keys, newSessionToken().token, id, sealed)).toThrow(DecryptionError);
  });
});

describe('encrypted backup (.tresor)', () => {
  it('round-trips with the passphrase and rejects a wrong one', async () => {
    const json = JSON.stringify({ hello: 'Tresor', n: [1, 2, 3] });
    const file = await encryptBackup(json, 'backup-passphrase', params);
    expect(file).not.toContain('Tresor"');
    expect(await decryptBackup(file, 'backup-passphrase')).toBe(json);
    await expect(decryptBackup(file, 'wrong-passphrase')).rejects.toThrow();
  });

  it('refuses absurd key derivation parameters from a file', async () => {
    const file = JSON.stringify({
      format: 'tresor-backup',
      version: 1,
      kdf: { alg: 'argon2id', params: 'm=99999999,t=1,p=1', salt: Buffer.alloc(16).toString('base64') },
      data: 'AQ',
    });
    await expect(decryptBackup(file, 'x')).rejects.toThrow(/Unsupported/);
  });
});
