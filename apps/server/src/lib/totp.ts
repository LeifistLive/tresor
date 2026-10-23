import { Secret, TOTP } from 'otpauth';

const PERIOD = 30;

export function createTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, username: string): string {
  return new TOTP({
    issuer: 'Tresor',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  }).toString();
}

/**
 * Validates a code (±1 step clock drift). Returns the matched time step, or null.
 * Callers reject steps <= the last accepted one to prevent replay.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  const totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: PERIOD, secret: Secret.fromBase32(secret) });
  const delta = totp.validate({ token: code, window: 1, timestamp: now });
  if (delta === null) return null;
  return Math.floor(now / 1000 / PERIOD) + delta;
}
