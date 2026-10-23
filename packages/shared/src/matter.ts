/**
 * Helpers for Matter onboarding codes (Matter Core Specification, chapter 5.1 "Onboarding Payload").
 *
 * - The manual pairing code is 11 digits (short form) or 21 digits (long form with vendor/product ID),
 *   printed as `XXXX-XXX-XXXX` or `XXXX-XXX-XXXX-XXXXX-XXXXX`. The last digit is a Verhoeff check digit.
 * - The QR code payload starts with `MT:` followed by Base38 characters that encode a packed bit field.
 */

export function normalizeMatterCode(input: string): string {
  return input.replace(/\D/g, '');
}

export function formatMatterCode(input: string): string {
  const d = normalizeMatterCode(input);
  if (d.length === 11) return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 21) {
    return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7, 11)}-${d.slice(11, 16)}-${d.slice(16)}`;
  }
  return input.trim();
}

// ---------------------------------------------------------------------------------------------------
// Verhoeff check digit
// ---------------------------------------------------------------------------------------------------

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffCheckDigit(digits: string): number {
  let c = 0;
  const rev = [...digits].reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c]![VERHOEFF_P[(i + 1) % 8]![Number(rev[i])]!]!;
  return VERHOEFF_INV[c]!;
}

export function verhoeffValid(digitsWithCheck: string): boolean {
  if (!/^\d+$/.test(digitsWithCheck)) return false;
  let c = 0;
  const rev = [...digitsWithCheck].reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(rev[i])]!]!;
  return c === 0;
}

// ---------------------------------------------------------------------------------------------------
// Manual pairing code
// ---------------------------------------------------------------------------------------------------

export interface ManualCodeInfo {
  /** Upper 4 bits of the 12-bit discriminator. */
  shortDiscriminator: number;
  passcode: number;
  vendorId?: number;
  productId?: number;
}

export function isValidMatterCode(input: string): boolean {
  const d = normalizeMatterCode(input);
  return (d.length === 11 || d.length === 21) && verhoeffValid(d);
}

export function parseManualCode(input: string): ManualCodeInfo | null {
  const d = normalizeMatterCode(input);
  if ((d.length !== 11 && d.length !== 21) || !verhoeffValid(d)) return null;
  const first = Number(d[0]);
  const chunk2 = Number(d.slice(1, 6));
  const chunk3 = Number(d.slice(6, 10));
  const info: ManualCodeInfo = {
    shortDiscriminator: ((first & 0x3) << 2) | (chunk2 >> 14),
    passcode: (chunk2 & 0x3fff) | (chunk3 << 14),
  };
  if (d.length === 21) {
    info.vendorId = Number(d.slice(10, 15));
    info.productId = Number(d.slice(15, 20));
  }
  return info;
}

/** Derives the manual pairing code (digits only) from a decoded QR payload. */
export function manualCodeFromSetup(info: MatterSetupPayload): string {
  const withVidPid = info.commissioningFlow !== 0;
  const shortDisc = info.discriminator >> 8;
  const first = ((withVidPid ? 1 : 0) << 2) | (shortDisc >> 2);
  const chunk2 = ((shortDisc & 0x3) << 14) | (info.passcode & 0x3fff);
  const chunk3 = info.passcode >> 14;
  let digits = `${first}${String(chunk2).padStart(5, '0')}${String(chunk3).padStart(4, '0')}`;
  if (withVidPid) {
    digits += `${String(info.vendorId).padStart(5, '0')}${String(info.productId).padStart(5, '0')}`;
  }
  return `${digits}${verhoeffCheckDigit(digits)}`;
}

// ---------------------------------------------------------------------------------------------------
// QR code payload ("MT:" + Base38)
// ---------------------------------------------------------------------------------------------------

const BASE38_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.';
const BASE38 = /^[0-9A-Z.-]+$/;

export function isValidMatterQrPayload(input: string): boolean {
  return parseMatterQr(input) !== null;
}

function base38Decode(input: string): Uint8Array | null {
  const out: number[] = [];
  for (let i = 0; i < input.length; ) {
    const remaining = input.length - i;
    const chars = remaining >= 5 ? 5 : remaining;
    const bytes = chars === 5 ? 3 : chars === 4 ? 2 : chars === 2 ? 1 : -1;
    if (bytes < 0) return null;
    let value = 0;
    for (let j = chars - 1; j >= 0; j--) {
      const idx = BASE38_ALPHABET.indexOf(input[i + j]!);
      if (idx < 0) return null;
      value = value * 38 + idx;
    }
    for (let b = 0; b < bytes; b++) {
      out.push(value & 0xff);
      value = Math.floor(value / 256);
    }
    if (value !== 0) return null;
    i += chars;
  }
  return Uint8Array.from(out);
}

export type MatterDiscovery = 'softap' | 'ble' | 'network' | 'wifipaf';

export interface MatterSetupPayload {
  version: number;
  vendorId: number;
  productId: number;
  /** 0 = standard, 1 = user action required, 2 = custom (manufacturer instructions). */
  commissioningFlow: number;
  discovery: MatterDiscovery[];
  discriminator: number;
  passcode: number;
}

/** Decodes an `MT:` QR payload into its fields, or returns null when it is not a valid payload. */
export function parseMatterQr(input: string): MatterSetupPayload | null {
  const v = input.trim().toUpperCase();
  if (!v.startsWith('MT:') || v.length < 4 || !BASE38.test(v.slice(3))) return null;
  const bytes = base38Decode(v.slice(3));
  if (!bytes || bytes.length < 11) return null;

  let n = 0n;
  for (let i = 0; i < 11; i++) n |= BigInt(bytes[i]!) << BigInt(8 * i);
  let offset = 0n;
  const read = (bits: number) => {
    const value = Number((n >> offset) & ((1n << BigInt(bits)) - 1n));
    offset += BigInt(bits);
    return value;
  };

  const version = read(3);
  const vendorId = read(16);
  const productId = read(16);
  const commissioningFlow = read(2);
  const rendezvous = read(8);
  const discriminator = read(12);
  const passcode = read(27);
  if (version !== 0 || passcode === 0 || passcode >= 99_999_999) return null;

  const discovery: MatterDiscovery[] = [];
  if (rendezvous & 0b0001) discovery.push('softap');
  if (rendezvous & 0b0010) discovery.push('ble');
  if (rendezvous & 0b0100) discovery.push('network');
  if (rendezvous & 0b1000) discovery.push('wifipaf');
  return { version, vendorId, productId, commissioningFlow, discovery, discriminator, passcode };
}

export function formatVendorId(id: number): string {
  return `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------------------------------
// Wi-Fi QR codes ("WIFI:T:WPA;S:ssid;P:password;H:false;;")
// ---------------------------------------------------------------------------------------------------

/** Builds the payload of a "join this Wi-Fi" QR code (supported by iOS and Android cameras). */
export function wifiQrPayload(ssid: string, password: string, security: string): string {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
  const type = security === 'nopass' ? 'nopass' : security || 'WPA';
  const pass = type === 'nopass' ? '' : `P:${esc(password)};`;
  return `WIFI:T:${type};S:${esc(ssid)};${pass};`;
}

export interface WifiQrInfo {
  ssid: string;
  password: string;
  security: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
}

export function parseWifiQr(input: string): WifiQrInfo | null {
  const v = input.trim();
  if (!/^WIFI:/i.test(v)) return null;
  const fields: Record<string, string> = {};
  let key = '';
  let value = '';
  let inValue = false;
  for (let i = 5; i < v.length; i++) {
    const ch = v[i]!;
    if (ch === '\\' && i + 1 < v.length) {
      value += v[++i];
      continue;
    }
    if (!inValue) {
      if (ch === ':') inValue = true;
      else if (ch !== ';') key += ch;
    } else if (ch === ';') {
      fields[key.toUpperCase()] = value;
      key = '';
      value = '';
      inValue = false;
    } else value += ch;
  }
  if (inValue && key) fields[key.toUpperCase()] = value;
  if (!fields.S) return null;
  const t = (fields.T ?? '').toUpperCase();
  const security = t === 'WEP' ? 'WEP' : t === 'NOPASS' || t === '' ? (fields.P ? 'WPA' : 'nopass') : 'WPA';
  return {
    ssid: fields.S,
    password: fields.P ?? '',
    security,
    hidden: (fields.H ?? '').toLowerCase() === 'true',
  };
}

/** Kind of content found in a scanned QR code. */
export function detectQrKind(text: string): 'matter' | 'wifi' | 'otpauth' | 'url' | 'text' {
  const t = text.trim();
  if (/^MT:/i.test(t)) return 'matter';
  if (/^WIFI:/i.test(t)) return 'wifi';
  if (/^otpauth:\/\//i.test(t)) return 'otpauth';
  if (/^https?:\/\//i.test(t)) return 'url';
  return 'text';
}
