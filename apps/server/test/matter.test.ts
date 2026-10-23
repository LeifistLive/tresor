import {
  formatMatterCode,
  isValidMatterCode,
  manualCodeFromSetup,
  parseManualCode,
  parseMatterQr,
  parseWifiQr,
  verhoeffCheckDigit,
  wifiQrPayload,
} from '@tresor/shared';
import { describe, expect, it } from 'vitest';

describe('Matter onboarding payloads', () => {
  it('decodes the specification test vector', () => {
    const info = parseMatterQr('MT:Y.K9042C00KA0648G00');
    expect(info).toEqual({
      version: 0,
      vendorId: 0xfff1,
      productId: 0x8000,
      commissioningFlow: 0,
      discovery: ['ble'],
      discriminator: 3840,
      passcode: 20202021,
    });
    expect(manualCodeFromSetup(info!)).toBe('34970112332');
    expect(formatMatterCode('34970112332')).toBe('3497-011-2332');
  });

  it('validates manual codes with the Verhoeff check digit', () => {
    expect(verhoeffCheckDigit('3497011233')).toBe(2);
    expect(isValidMatterCode('3497-011-2332')).toBe(true);
    expect(isValidMatterCode('3497-011-2333')).toBe(false);
    expect(isValidMatterCode('1234')).toBe(false);
    expect(parseManualCode('34970112332')).toEqual({ shortDiscriminator: 15, passcode: 20202021 });
  });

  it('rejects garbage', () => {
    expect(parseMatterQr('MT:')).toBeNull();
    expect(parseMatterQr('MT:abc')).toBeNull();
    expect(parseMatterQr('https://example.com')).toBeNull();
  });
});

describe('Wi-Fi QR codes', () => {
  it('round-trips escaped values', () => {
    const qr = wifiQrPayload('Home;Net', 'p:a\\ss"', 'WPA');
    expect(parseWifiQr(qr)).toEqual({
      ssid: 'Home;Net',
      password: 'p:a\\ss"',
      security: 'WPA',
      hidden: false,
    });
    expect(parseWifiQr('WIFI:S:Guest;T:nopass;H:true;;')).toEqual({
      ssid: 'Guest',
      password: '',
      security: 'nopass',
      hidden: true,
    });
    expect(parseWifiQr('nope')).toBeNull();
  });
});
