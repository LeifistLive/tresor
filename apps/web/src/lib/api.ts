import type {
  AdminStatsDto,
  AdminUserDto,
  AttachmentDto,
  AuditEntryDto,
  ErrorCode,
  ImportResult,
  Language,
  MeDto,
  NoteInput,
  NoteUpdate,
  NotificationConfigDto,
  NotificationConfigInput,
  PasskeyDto,
  Role,
  ServerInfoDto,
  ServerStatsDto,
  SessionDto,
  SessionKeyResponse,
  TemplateInput,
  Theme,
  TotpSetupResponse,
  VaultRole,
  WebAuthnOptionsResponse,
} from '@tresor/shared';
import {
  ApiError,
  decryptBackup,
  encryptBackup,
  type Method,
  markdownZip,
  type PlainFile,
  type Transport,
  TresorClient,
  type UploadForm,
} from '@tresor/shared/client';
import { DecryptionError, fromBase64 } from '@tresor/shared/crypto';

export type { VersionDetail } from '@tresor/shared/client';
export { ApiError };

let unauthorizedHandler: (() => void) | null = null;

/** Called whenever an authenticated request comes back 401 (session expired or revoked). */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

async function send(method: Method, path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-tresor-csrf': '1',
        ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) {
    let payload: { error?: { code?: ErrorCode; message?: string; details?: unknown } } | undefined;
    try {
      payload = await res.json();
    } catch {
      payload = undefined;
    }
    const err = new ApiError(
      res.status,
      payload?.error?.code ?? (res.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
      payload?.error?.message ?? res.statusText,
      payload?.error?.details,
    );
    // /auth/me reports a missing session itself; everything else means the session ended mid-use.
    if (res.status === 401 && err.code === 'UNAUTHORIZED' && path !== '/auth/me') unauthorizedHandler?.();
    throw err;
  }
  return res;
}

async function json<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  return (await res.json()) as T;
}

const transport: Transport = {
  json,
  bytes: async (path) => new Uint8Array(await (await send('GET', path)).arrayBuffer()),
  upload: async <T>(method: 'POST' | 'PUT', path: string, form: UploadForm) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(form.fields)) data.append(k, v);
    data.append('file', new Blob([form.file.data as Uint8Array<ArrayBuffer>]), form.file.name);
    return (await (await send(method, path, data)).json()) as T;
  },
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The zero-knowledge client. It holds the unlocked keys in memory; everything is encrypted before it is
 * sent and decrypted after it arrives.
 */
export const vault = new TresorClient(transport);

// --- Keeping the vault unlocked across reloads --------------------------------------------------------
// The account key is stored in localStorage encrypted with a random per-session key that only the server
// can hand out to this session (cookie). Signing out or an expired session makes the stored copy useless.

const LOCAL_KEYS = 'tresor.keys';

async function persistKeys(sessionKey?: string) {
  const key = sessionKey ?? (await json<SessionKeyResponse>('GET', '/auth/session-key')).sessionKey;
  try {
    storage()?.setItem(LOCAL_KEYS, await vault.persist(key));
  } catch {
    // Storage unavailable (private mode): the vault simply locks on reload.
  }
}

/** Re-opens the keys after a reload. False when they are gone – the user has to sign in again. */
export async function restoreKeys(user: MeDto): Promise<boolean> {
  if (vault.unlocked) return true;
  if (!user.hasKeys) {
    vault.resumePending(user.id, user.username);
    return true;
  }
  const blob = storage()?.getItem(LOCAL_KEYS);
  if (!blob) return false;
  try {
    return await vault.restore(blob, await json<SessionKeyResponse>('GET', '/auth/session-key'));
  } catch {
    return false;
  }
}

export function forgetKeys() {
  vault.lock();
  try {
    storage()?.removeItem(LOCAL_KEYS);
  } catch {
    // ignore
  }
}

/** Locks this tab when another tab signs out or locks. */
export function onKeysForgotten(handler: () => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === LOCAL_KEYS && e.newValue === null && vault.unlocked) {
      vault.lock();
      handler();
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

function download(data: Uint8Array | string, filename: string, type: string) {
  const blob = new Blob([typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File types the browser may display directly. Everything else is only ever offered as a download. */
const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
]);

/** A decrypted file as Blob; non-whitelisted types are neutralised so they can never render as HTML. */
export function fileBlob(data: Uint8Array, mime: string): Blob {
  return new Blob([data as Uint8Array<ArrayBuffer>], {
    type: INLINE_TYPES.has(mime) ? mime : 'application/octet-stream',
  });
}

export function saveFile(data: Uint8Array, name: string) {
  download(data, name, 'application/octet-stream');
}

// --- API -----------------------------------------------------------------------------------------------

export const api = {
  info: () => json<ServerInfoDto>('GET', '/info'),
  setupStatus: () => json<{ needsSetup: boolean }>('GET', '/setup/status'),

  async setup(body: { username: string; displayName: string; password: string; language: Language }) {
    const res = await vault.setup(body);
    await persistKeys(res.sessionKey);
    return res;
  },
  /** Throws `TOTP_REQUIRED` when a second factor is needed – call again with `totp`. */
  async login(body: { username: string; password: string; totp?: string }) {
    const res = await vault.login(body);
    if (vault.unlocked) await persistKeys(res.sessionKey);
    return res;
  },
  async loginWithPasskey(body: { challengeId: string; response: { id: string }; prf?: string }) {
    const res = await vault.loginWithPasskey({ ...body, prf: body.prf ? fromBase64(body.prf) : undefined });
    await persistKeys(res.sessionKey);
    return res;
  },
  async recover(body: { username: string; recoveryKey: string; newPassword: string }) {
    const res = await vault.recover(body);
    await persistKeys(res.sessionKey);
    return res;
  },
  logout: () => json<{ ok: true }>('POST', '/auth/logout'),
  me: () => json<{ user: MeDto }>('GET', '/auth/me'),

  async changePassword(body: { currentPassword: string; newPassword: string }) {
    const hadKeys = vault.unlocked;
    const res = await vault.changePassword(body);
    if (!hadKeys) await persistKeys();
    return res;
  },
  regenerateRecoveryKey: (password: string) => vault.newRecoveryKey(password),
  updatePreferences: (body: {
    displayName?: string;
    language?: Language;
    theme?: Theme;
    autoLockMinutes?: number;
  }) => json<{ user: MeDto }>('PATCH', '/account/preferences', body),
  sessions: () => json<{ sessions: SessionDto[] }>('GET', '/account/sessions'),
  revokeSession: (id: string) =>
    json<{ revoked: number }>('DELETE', `/account/sessions/${encodeURIComponent(id)}`),
  totpSetup: async (password: string) =>
    json<TotpSetupResponse>('POST', '/account/totp/setup', { authKey: await vault.authKeyFor(password) }),
  totpEnable: (code: string) => json<{ user: MeDto }>('POST', '/account/totp/enable', { code }),
  totpDisable: async (password: string) =>
    json<{ user: MeDto }>('POST', '/account/totp/disable', { authKey: await vault.authKeyFor(password) }),

  notes: {
    list: (status: 'active' | 'trash' = 'active') => vault.notes(status),
    create: (body: NoteInput) => vault.createNote(body),
    update: (id: string, body: NoteUpdate) => vault.updateNote(id, body),
    trash: (id: string) => json<{ ok: true }>('DELETE', `/notes/${id}`),
    purge: (id: string) => json<{ ok: true }>('DELETE', `/notes/${id}?permanent=true`),
    restore: (id: string) => json<unknown>('POST', `/notes/${id}/restore`),
    emptyTrash: () => json<{ deleted: number }>('DELETE', '/trash'),
  },

  attachments: {
    upload: async (noteId: string, file: File) =>
      vault.uploadAttachment(noteId, {
        name: file.name,
        mime: file.type,
        data: new Uint8Array(await file.arrayBuffer()),
      } satisfies PlainFile),
    download: (noteId: string, file: AttachmentDto) => vault.downloadAttachment(noteId, file),
    remove: (noteId: string, id: string) =>
      json<{ ok: true }>('DELETE', `/notes/${noteId}/attachments/${id}`),
  },
  versions: {
    list: (noteId: string) => vault.versions(noteId),
    restore: (noteId: string, id: string) => json<unknown>('POST', `/notes/${noteId}/versions/${id}/restore`),
  },
  templates: {
    list: () => vault.templates(),
    create: (body: TemplateInput) => vault.saveTemplate(body),
    update: (id: string, body: TemplateInput) => vault.saveTemplate(body, id),
    remove: (id: string) => json<{ ok: true }>('DELETE', `/templates/${id}`),
  },
  vaults: {
    list: () => vault.vaults(),
    directory: () => vault.directory(),
    create: (name: string) => vault.createVault(name),
    rename: (id: string, name: string) => vault.renameVault(id, name),
    remove: (id: string) => json<{ ok: true }>('DELETE', `/vaults/${id}`),
    addMember: (id: string, username: string, role: VaultRole) => vault.addMember(id, username, role),
    setRole: (id: string, userId: string, role: VaultRole) =>
      json<unknown>('PATCH', `/vaults/${id}/members/${userId}`, { role }),
    removeMember: (id: string, userId: string) => vault.removeMember(id, userId),
  },
  emergency: {
    list: () => vault.emergencyList(),
    /** Hands the account key to a trusted contact – confirmed with the password. */
    grant: (username: string, waitDays: number, password: string) =>
      vault.grantEmergency(username, waitDays, password),
    setWait: (id: string, waitDays: number) => json<{ ok: true }>('PATCH', `/emergency/${id}`, { waitDays }),
    remove: (id: string) => json<{ ok: true }>('DELETE', `/emergency/${id}`),
    request: (id: string) => json<{ ok: true }>('POST', `/emergency/${id}/request`),
    approve: (id: string) => json<{ ok: true }>('POST', `/emergency/${id}/approve`),
    reject: (id: string) => json<{ ok: true }>('POST', `/emergency/${id}/reject`),
    notes: (id: string) => vault.emergencyNotes(id),
    download: (grantId: string, noteId: string, file: AttachmentDto) =>
      vault.downloadEmergencyAttachment(grantId, noteId, file.id),
  },
  passkeys: {
    list: () => json<{ passkeys: PasskeyDto[] }>('GET', '/account/passkeys'),
    registerOptions: () => json<WebAuthnOptionsResponse>('POST', '/account/passkeys/options'),
    /** Registers a passkey; with a PRF output it also gets a copy of the account key to unlock the vault. */
    register: async (body: {
      challengeId: string;
      name: string;
      response: { id: string };
      prf?: string;
      /** Confirms with the password: a passkey is a lasting way into the account. */
      password: string;
    }) =>
      json<{ ok: true; canUnlock: boolean }>('POST', '/account/passkeys', {
        authKey: await vault.authKeyFor(body.password),
        challengeId: body.challengeId,
        name: body.name,
        response: body.response,
        ...(body.prf ? { dekWrapped: await vault.passkeyWrap(fromBase64(body.prf), body.response.id) } : {}),
      }),
    verifyPassword: async (password: string) =>
      json<{ ok: true }>('POST', '/account/verify-password', { authKey: await vault.authKeyFor(password) }),
    rename: (id: string, name: string) => json<{ ok: true }>('PATCH', `/account/passkeys/${id}`, { name }),
    remove: (id: string) => json<{ ok: true }>('DELETE', `/account/passkeys/${id}`),
    loginOptions: () => json<WebAuthnOptionsResponse>('POST', '/auth/passkey/options'),
  },
  notifications: {
    get: () => json<{ config: NotificationConfigDto }>('GET', '/account/notifications'),
    save: (body: NotificationConfigInput) =>
      json<{ config: NotificationConfigDto }>('PUT', '/account/notifications', body),
    test: () => json<{ ok: true }>('POST', '/account/notifications/test'),
  },

  stats: (days: number) =>
    json<ServerStatsDto>(
      'GET',
      `/stats?days=${days}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
    ),

  /** Builds the export in the browser (nothing is decrypted on the server) and downloads it. */
  async exportData(body: { format: 'json' | 'markdown' } | { format: 'tresor'; passphrase: string }) {
    const me = (await api.me()).user;
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `tresor-${me.username}-${stamp}`;
    let count: number;
    if (body.format === 'markdown') {
      const { notes, files } = await vault.exportData();
      download(markdownZip(notes, files), `${base}-markdown.zip`, 'application/zip');
      count = notes.length;
    } else {
      const exported = await vault.exportJson();
      count = exported.count;
      if (body.format === 'tresor') {
        download(
          await encryptBackup(exported.json, body.passphrase),
          `${base}.tresor`,
          'application/octet-stream',
        );
      } else download(exported.json, `${base}.json`, 'application/json');
    }
    await json('POST', '/account/exported', { format: body.format, count });
  },
  /** Decrypts (for `.tresor`), re-encrypts every entry in the browser and uploads it. */
  async importData(body: {
    format: 'json' | 'tresor';
    data: string;
    passphrase?: string;
  }): Promise<ImportResult> {
    let text = body.data;
    if (body.format === 'tresor') {
      try {
        text = await decryptBackup(body.data, body.passphrase ?? '');
      } catch (err) {
        if (err instanceof DecryptionError) throw new ApiError(400, 'BAD_PASSPHRASE', err.message);
        throw err;
      }
    }
    return vault.importJson(text);
  },

  admin: {
    stats: () =>
      json<AdminStatsDto>(
        'GET',
        `/admin/stats?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
      ),
    users: () => json<{ users: AdminUserDto[] }>('GET', '/admin/users'),
    createUser: (body: { username: string; displayName: string; role: Role; password: string }) =>
      json<{ user: AdminUserDto }>('POST', '/admin/users', body),
    updateUser: (id: string, body: { role?: Role; disabled?: boolean; displayName?: string }) =>
      json<{ user: AdminUserDto }>('PATCH', `/admin/users/${id}`, body),
    resetUser: (id: string, password: string) =>
      json<{ user: AdminUserDto; deletedNotes: number }>('POST', `/admin/users/${id}/reset`, { password }),
    logoutUser: (id: string) => json<{ revoked: number }>('POST', `/admin/users/${id}/logout`),
    deleteUser: (id: string) => json<{ ok: true }>('DELETE', `/admin/users/${id}`),
    audit: (params: { before?: string; action?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (params.before) q.set('before', params.before);
      if (params.action) q.set('action', params.action);
      q.set('limit', String(params.limit ?? 50));
      return json<{ entries: AuditEntryDto[]; hasMore: boolean }>('GET', `/admin/audit?${q}`);
    },
  },
};
