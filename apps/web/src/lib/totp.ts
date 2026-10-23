import { Secret, TOTP, URI } from 'otpauth';

export interface TotpInfo {
  totp: TOTP;
  issuer: string;
  label: string;
}

/** Accepts a Base32 secret or an otpauth:// URI. Returns null when the value cannot be used. */
export function parseTotp(value: string): TotpInfo | null {
  const v = value.trim();
  if (!v) return null;
  try {
    if (/^otpauth:\/\//i.test(v)) {
      const parsed = URI.parse(v);
      if (!(parsed instanceof TOTP)) return null;
      return { totp: parsed, issuer: parsed.issuer, label: parsed.label };
    }
    const secret = Secret.fromBase32(v.replace(/\s+/g, '').toUpperCase());
    if (secret.bytes.length < 10) return null;
    return { totp: new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' }), issuer: '', label: '' };
  } catch {
    return null;
  }
}

export function currentCode(info: TotpInfo, now = Date.now()) {
  const period = info.totp.period;
  return {
    code: info.totp.generate({ timestamp: now }),
    remaining: period - (Math.floor(now / 1000) % period),
    period,
  };
}
