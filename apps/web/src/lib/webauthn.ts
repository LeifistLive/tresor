/**
 * Thin WebAuthn helpers: convert the server's JSON options into native objects, run the ceremony and
 * serialize the result – including the PRF extension output that unlocks the vault.
 */

const fromB64url = (s: string): ArrayBuffer => {
  const bin = atob(
    s
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(s.length / 4) * 4, '='),
  );
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

const toB64url = (buf: ArrayBuffer | ArrayBufferView): string => {
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function passkeysSupported(): { ok: boolean; reason?: 'insecure' | 'unsupported' } {
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!window.PublicKeyCredential || !navigator.credentials) return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

type Json = Record<string, unknown>;

interface PrfResults {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
}

function prfOutput(cred: PublicKeyCredential): string | undefined {
  const ext = cred.getClientExtensionResults() as { prf?: PrfResults };
  const first = ext.prf?.results?.first;
  return first ? toB64url(first) : undefined;
}

function prfEnabled(cred: PublicKeyCredential): boolean {
  const ext = cred.getClientExtensionResults() as { prf?: PrfResults };
  return Boolean(ext.prf?.enabled || ext.prf?.results?.first);
}

function serialize(cred: PublicKeyCredential) {
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Json = { clientDataJSON: toB64url(r.clientDataJSON) };
  if ('attestationObject' in r && r.attestationObject) {
    response.attestationObject = toB64url(r.attestationObject);
    response.transports = typeof r.getTransports === 'function' ? r.getTransports() : [];
  } else {
    response.authenticatorData = toB64url(r.authenticatorData);
    response.signature = toB64url(r.signature);
    if (r.userHandle) response.userHandle = toB64url(r.userHandle);
  }
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: 'public-key',
    response,
    clientExtensionResults: {},
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

/** Asks an existing credential for its PRF output (needed when `create()` did not return one). */
async function evaluatePrf(rawId: ArrayBuffer, salt: ArrayBuffer, rpId: string | undefined) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId,
      allowCredentials: [{ type: 'public-key', id: rawId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  return cred ? prfOutput(cred) : undefined;
}

export async function createPasskey(options: Json, prfSalt: string) {
  const user = options.user as Json;
  const rp = options.rp as { id?: string; name: string };
  const salt = fromB64url(prfSalt);
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...(options as unknown as PublicKeyCredentialCreationOptions),
    challenge: fromB64url(options.challenge as string),
    user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: fromB64url(user.id as string) },
    excludeCredentials: ((options.excludeCredentials as Json[] | undefined) ?? []).map((c) => ({
      type: 'public-key' as const,
      id: fromB64url(c.id as string),
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
  };
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  let prf = prfOutput(cred);
  if (!prf && prfEnabled(cred)) {
    try {
      prf = await evaluatePrf(cred.rawId, salt, rp.id);
    } catch {
      prf = undefined;
    }
  }
  return { response: serialize(cred), prf };
}

export async function getPasskey(options: Json, prfSalt: string) {
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...(options as unknown as PublicKeyCredentialRequestOptions),
    challenge: fromB64url(options.challenge as string),
    allowCredentials: ((options.allowCredentials as Json[] | undefined) ?? []).map((c) => ({
      type: 'public-key' as const,
      id: fromB64url(c.id as string),
    })),
    extensions: { prf: { eval: { first: fromB64url(prfSalt) } } } as AuthenticationExtensionsClientInputs,
  };
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  return { response: serialize(cred), prf: prfOutput(cred) };
}

/** Name suggestion for a new passkey based on the current device. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Passkey';
}
