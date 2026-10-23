import {
  detectQrKind,
  formatMatterCode,
  manualCodeFromSetup,
  parseMatterQr,
  parseWifiQr,
} from '@tresor/shared';
import type { Prefill } from './prefill';
import { parseTotp } from './totp';

/** Matter fields derived from a scanned `MT:` payload (QR content + computed manual pairing code). */
export function matterFieldsFromQr(text: string): Record<string, string> | null {
  const info = parseMatterQr(text);
  if (!info) return null;
  return { qrPayload: text.trim().toUpperCase(), setupCode: formatMatterCode(manualCodeFromSetup(info)) };
}

/** Turns any scanned QR code into the best matching new entry. */
export function prefillFromQr(text: string): Prefill {
  switch (detectQrKind(text)) {
    case 'matter': {
      const fields = matterFieldsFromQr(text);
      if (fields) return { type: 'matter', fields };
      break;
    }
    case 'wifi': {
      const wifi = parseWifiQr(text);
      if (wifi) {
        return {
          type: 'wifi',
          title: wifi.ssid,
          fields: { ssid: wifi.ssid, password: wifi.password, security: wifi.security },
        };
      }
      break;
    }
    case 'otpauth': {
      const totp = parseTotp(text);
      if (totp) {
        return {
          type: 'login',
          title: totp.issuer || totp.label,
          fields: { totp: text.trim(), ...(totp.label ? { username: totp.label } : {}) },
        };
      }
      break;
    }
    case 'url':
      return { type: 'login', fields: { url: text.trim() } };
  }
  return { type: 'note', content: text };
}
