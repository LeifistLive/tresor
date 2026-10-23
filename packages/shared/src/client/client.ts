import type { DirectoryUserDto, EmergencyAccessDto, MeDto, VaultDto } from '../api.js';
import type { Language } from '../auth.js';
import * as C from '../crypto/index.js';
import type { VaultRole } from '../features.js';
import type { AttachmentDto, NoteDto, NoteType, TemplateDto } from '../notes.js';
import {
  type NoteInput,
  type NoteUpdate,
  noteInputSchema,
  notePayloadSchema,
  noteUpdateSchema,
  type TemplateInput,
  templateInputSchema,
} from '../notes.schema.js';
import { exportedNoteSchema, exportFileSchema } from '../transfer.schema.js';
import type {
  AccountKeysDto,
  EmergencyNotesResponse,
  EncryptedAttachmentDto,
  NoteListResponse,
  NoteRecordDto,
  NoteVersionRecordDto,
  PreloginResponse,
  RecoverStartResponse,
  SessionKeyResponse,
  SessionStartResponse,
  TemplateRecordDto,
  VaultKeyDto,
  VaultRecordDto,
  VaultRotationDataDto,
} from '../wire.js';
import { type ExportedFile, exportDocument, safeFilename } from './backup.js';
import { ApiError, type Transport } from './transport.js';

interface Unlocked {
  userId: string;
  username: string;
  dek: C.Bytes;
  publicKey: string | null;
  privateKey: C.Bytes | null;
}

interface VaultKey {
  key: C.Bytes;
  version: number;
  role: VaultRole;
}

export interface VersionDetail {
  id: string;
  type: NoteType;
  title: string;
  content: string;
  fields: Record<string, string>;
  customFields: NoteDto['customFields'];
  tags: string[];
  createdAt: string;
  author: string | null;
}

export interface PlainFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

const locked = () => new ApiError(0, 'LOCKED', 'The vault is locked');
const invalidRecovery = () => new ApiError(401, 'INVALID_RECOVERY_KEY', 'Invalid username or recovery key');
const CONTENT_KEYS = ['type', 'title', 'content', 'fields', 'customFields', 'tags'] as const;
const LOCAL_FORMAT = 1;

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Zero-knowledge client: derives keys from the password, encrypts everything before it leaves the device
 * and decrypts what the server returns. Used by the web app (fetch transport) and by the server's
 * integration tests (inject transport), so both exercise the same code.
 */
export class TresorClient {
  private state: Unlocked | null = null;
  /** Who is signed in without keys yet (admin-created account before choosing a password). */
  private pendingUser: { userId: string; username: string } | null = null;
  private readonly vaultKeys = new Map<string, VaultKey>();
  private readonly sealedCache = new Map<string, C.Bytes>();
  /** attachment id → key that decrypts its content. */
  private readonly fileKeys = new Map<string, C.Bytes>();
  private derived: { tag: string; masterKey: C.Bytes } | null = null;

  constructor(
    private readonly http: Transport,
    private readonly options: {
      /** Fixed parameters for new passwords (tests); otherwise taken from /api/info. */
      kdfParams?: string;
      /** Weakest parameters accepted from the server (defaults to MIN_KDF). */
      minKdf?: { memoryKiB: number; iterations: number };
    } = {},
  ) {}

  /** Refuses key derivation settings below the floor (protection against a downgrading server). */
  private checkKdf(kdfParams: string): C.Argon2Params {
    const p = C.parseParams(kdfParams);
    const min = this.options.minKdf ?? C.MIN_KDF;
    if (p.memoryKiB < min.memoryKiB || p.iterations < min.iterations) {
      throw new ApiError(0, 'WEAK_KDF', `Refusing weak key derivation parameters (${kdfParams})`);
    }
    return p;
  }

  get unlocked(): boolean {
    return this.state !== null;
  }

  /** Remembers an account that has no keys yet (admin-created, must choose a password) after a reload. */
  resumePending(userId: string, username: string): void {
    if (!this.state) this.pendingUser = { userId, username };
  }

  get userId(): string | null {
    return this.state?.userId ?? this.pendingUser?.userId ?? null;
  }

  /** Forgets every key held in memory. */
  lock(): void {
    this.state = null;
    this.pendingUser = null;
    this.vaultKeys.clear();
    this.sealedCache.clear();
    this.fileKeys.clear();
    this.derived = null;
  }

  private keys(): Unlocked {
    if (!this.state) throw locked();
    return this.state;
  }

  // --- Key persistence across reloads ---------------------------------------------------------------

  /** The account key encrypted with the session key (only the signed-in session can open it again). */
  async persist(sessionKey: string): Promise<string> {
    const s = this.keys();
    return JSON.stringify({
      v: LOCAL_FORMAT,
      userId: s.userId,
      username: s.username,
      dek: await C.seal(C.fromBase64(sessionKey), s.dek, C.AAD.localKeys(s.userId)),
    });
  }

  /** Re-opens persisted keys with the session key from `/auth/session-key`. */
  async restore(blob: string, session: SessionKeyResponse): Promise<boolean> {
    try {
      const data = JSON.parse(blob) as { v: number; userId: string; username: string; dek: string };
      if (data.v !== LOCAL_FORMAT) return false;
      const dek = await C.open(C.fromBase64(session.sessionKey), data.dek, C.AAD.localKeys(data.userId));
      await this.unlock({ userId: data.userId, username: data.username }, dek, session);
      return true;
    } catch {
      return false;
    }
  }

  private async unlock(
    who: { userId: string; username: string },
    dek: C.Bytes,
    keys: Pick<AccountKeysDto, 'publicKey' | 'privateKeyEnc'> | null,
  ) {
    const privateKey = keys?.privateKeyEnc
      ? await C.openPrivateKey(dek, who.userId, keys.privateKeyEnc)
      : null;
    this.lock();
    this.state = { ...who, dek, publicKey: keys?.publicKey ?? null, privateKey };
  }

  // --- Sign-in ----------------------------------------------------------------------------------------

  private async kdfParams(): Promise<C.Argon2Params> {
    const raw =
      this.options.kdfParams ?? (await this.http.json<{ kdfParams: string }>('GET', '/info')).kdfParams;
    return this.checkKdf(raw);
  }

  prelogin(username: string) {
    return this.http.json<PreloginResponse>('POST', '/auth/prelogin', { username });
  }

  /** Argon2id is expensive – remember the last result so a 2FA retry does not pay twice. */
  private async masterKey(password: string, kdf: C.KdfSettings): Promise<C.Bytes> {
    this.checkKdf(kdf.kdfParams);
    const tag = C.toHex(await C.sha256(`${kdf.kdfSalt}|${kdf.kdfParams}|${password}`));
    if (this.derived?.tag === tag) return this.derived.masterKey;
    const masterKey = await C.deriveMasterKey(password, kdf);
    this.derived = { tag, masterKey };
    return masterKey;
  }

  /** The login proof for the signed-in user's password (to confirm sensitive actions). */
  async authKeyFor(
    password: string,
    username = this.state?.username ?? this.pendingUser?.username,
  ): Promise<string> {
    if (!username) throw locked();
    const pre = await this.prelogin(username);
    return C.authKeyOf(await this.masterKey(password, pre));
  }

  async setup(input: { username: string; displayName: string; language: Language; password: string }) {
    const id = uuid();
    const acct = await C.newAccountKeys(id);
    const pw = await C.passwordKeys(input.password, id, acct.dek, await this.kdfParams());
    const res = await this.http.json<SessionStartResponse>('POST', '/setup', {
      id,
      username: input.username,
      displayName: input.displayName,
      language: input.language,
      kdfSalt: pw.kdfSalt,
      kdfParams: pw.kdfParams,
      authKey: pw.authKey,
      dekWrapped: pw.dekWrapped,
      ...acct.keys,
    });
    await this.unlock({ userId: id, username: res.user.username }, acct.dek, {
      publicKey: acct.keyPair.publicKey,
      privateKeyEnc: acct.keys.privateKeyEnc,
    });
    return { ...res, recoveryKey: acct.recoveryKey };
  }

  /**
   * Password sign-in. Only the derived auth key is sent, never the password. Throws `TOTP_REQUIRED` when a
   * second factor is needed.
   */
  async login(input: { username: string; password: string; totp?: string }): Promise<SessionStartResponse> {
    const username = input.username.trim().toLowerCase();
    const pre = await this.prelogin(username);
    const masterKey = await this.masterKey(input.password, pre);
    const res = await this.http.json<SessionStartResponse>('POST', '/auth/login', {
      username,
      authKey: await C.authKeyOf(masterKey),
      totp: input.totp,
    });
    if (res.keys) {
      const dek = await C.unwrapWithMasterKey(masterKey, res.keys.userId, res.keys.dekWrapped);
      await this.unlock({ userId: res.user.id, username: res.user.username }, dek, res.keys);
    } else {
      this.lock();
      this.pendingUser = { userId: res.user.id, username: res.user.username };
    }
    this.derived = null;
    return res;
  }

  /** Finishes a passkey sign-in: the PRF output unwraps the account key locally. */
  async loginWithPasskey(input: {
    challengeId: string;
    response: { id: string };
    prf: Uint8Array | undefined;
  }): Promise<SessionStartResponse> {
    if (!input.prf) throw new ApiError(400, 'PASSKEY_NO_PRF', 'This passkey cannot unlock the vault');
    const res = await this.http.json<SessionStartResponse>('POST', '/auth/passkey', {
      challengeId: input.challengeId,
      response: input.response,
    });
    if (!res.keys) throw new ApiError(400, 'PASSKEY_NO_PRF', 'This passkey cannot unlock the vault');
    let dek: C.Bytes;
    try {
      dek = await C.unwrapWithPrf(input.prf, input.response.id, res.keys.dekWrapped);
    } catch {
      await this.http.json('POST', '/auth/logout').catch(() => {});
      throw new ApiError(401, 'PASSKEY_FAILED', 'Passkey verification failed');
    }
    await this.unlock({ userId: res.user.id, username: res.user.username }, dek, res.keys);
    return res;
  }

  /** Public key fingerprint of the signed-in account (to compare with what others see). */
  async ownFingerprint(): Promise<string | null> {
    const pub = this.state?.publicKey;
    return pub ? C.fingerprint(pub) : null;
  }

  /** The account key wrapped for a new passkey (sent along with its registration). */
  async passkeyWrap(prf: Uint8Array, credentialId: string): Promise<string> {
    return C.wrapWithPrf(prf, credentialId, this.keys().dek);
  }

  async recover(input: { username: string; recoveryKey: string; newPassword: string }) {
    const username = input.username.trim().toLowerCase();
    let rk: C.Bytes;
    try {
      rk = C.parseRecoveryKey(input.recoveryKey);
    } catch {
      throw invalidRecovery();
    }
    const start = await this.http.json<RecoverStartResponse>('POST', '/auth/recover/start', { username });
    const userId = start.userId;
    let dek: C.Bytes;
    try {
      dek = await C.unwrapWithRecoveryKey(rk, userId, start.recoveryWrapped);
    } catch {
      throw invalidRecovery();
    }
    const pw = await C.passwordKeys(input.newPassword, userId, dek, await this.kdfParams());
    const next = C.generateRecoveryKey();
    const res = await this.http.json<SessionStartResponse>('POST', '/auth/recover', {
      username,
      recoveryProof: await C.recoveryProofOf(rk),
      recoveryWrapped: await C.wrapWithRecoveryKey(next.bytes, userId, dek),
      newRecoveryProof: await C.recoveryProofOf(next.bytes),
      kdfSalt: pw.kdfSalt,
      kdfParams: pw.kdfParams,
      authKey: pw.authKey,
      dekWrapped: pw.dekWrapped,
    });
    await this.unlock({ userId, username: res.user.username }, dek, res.keys);
    return { ...res, recoveryKey: next.display };
  }

  /**
   * Changes the password (re-wraps the account key). Accounts created by an admin get their keys here –
   * the returned recovery key must be shown to the user.
   */
  async changePassword(input: { currentPassword: string; newPassword: string }) {
    const who = this.state ?? this.pendingUser;
    if (!who) throw locked();
    const currentAuthKey = await this.authKeyFor(input.currentPassword, who.username);
    const params = await this.kdfParams();
    if (this.state) {
      const pw = await C.passwordKeys(input.newPassword, who.userId, this.state.dek, params);
      const res = await this.http.json<{ user: MeDto }>('POST', '/account/password', {
        currentAuthKey,
        kdfSalt: pw.kdfSalt,
        kdfParams: pw.kdfParams,
        authKey: pw.authKey,
        dekWrapped: pw.dekWrapped,
      });
      return { user: res.user, recoveryKey: undefined as string | undefined };
    }
    const acct = await C.newAccountKeys(who.userId);
    const pw = await C.passwordKeys(input.newPassword, who.userId, acct.dek, params);
    const res = await this.http.json<{ user: MeDto }>('POST', '/account/password', {
      currentAuthKey,
      kdfSalt: pw.kdfSalt,
      kdfParams: pw.kdfParams,
      authKey: pw.authKey,
      dekWrapped: pw.dekWrapped,
      account: acct.keys,
    });
    await this.unlock(who, acct.dek, {
      publicKey: acct.keyPair.publicKey,
      privateKeyEnc: acct.keys.privateKeyEnc,
    });
    return { user: res.user, recoveryKey: acct.recoveryKey as string | undefined };
  }

  /** Replaces the recovery key (the old one stops working). Returns the new key for display. */
  async newRecoveryKey(password: string) {
    const s = this.keys();
    const authKey = await this.authKeyFor(password);
    const rk = C.generateRecoveryKey();
    const res = await this.http.json<{ user: MeDto }>('POST', '/account/recovery-key', {
      authKey,
      recoveryWrapped: await C.wrapWithRecoveryKey(rk.bytes, s.userId, s.dek),
      recoveryProof: await C.recoveryProofOf(rk.bytes),
    });
    return { user: res.user, recoveryKey: rk.display };
  }

  // --- Container keys ---------------------------------------------------------------------------------

  private async openSealed(sealed: string, aad: string): Promise<C.Bytes> {
    const cached = this.sealedCache.get(sealed);
    if (cached) return cached;
    const s = this.keys();
    if (!s.privateKey || !s.publicKey) throw new ApiError(409, 'NO_KEYS', 'This account has no key pair');
    const key = await C.openFrom(s.privateKey, s.publicKey, sealed, aad);
    this.sealedCache.set(sealed, key);
    return key;
  }

  private async rememberVaultKeys(list: VaultKeyDto[]) {
    const userId = this.keys().userId;
    for (const v of list) {
      try {
        const key = await this.openSealed(v.keyWrapped, C.AAD.vaultKey(v.vaultId, userId));
        this.vaultKeys.set(v.vaultId, { key, version: v.keyVersion, role: v.role });
      } catch {
        this.vaultKeys.delete(v.vaultId);
      }
    }
  }

  /** Key (and version) for personal entries (null) or a shared vault. */
  private async container(
    vaultId: string | null,
    refresh = false,
  ): Promise<{ key: C.Bytes; version?: number; role?: VaultRole }> {
    if (!vaultId) return { key: this.keys().dek };
    if (refresh || !this.vaultKeys.has(vaultId)) await this.rawVaults();
    const v = this.vaultKeys.get(vaultId);
    if (!v) throw new ApiError(404, 'NOT_FOUND', 'Vault not found');
    return v;
  }

  // --- Entries ----------------------------------------------------------------------------------------

  private async decryptAttachments(
    key: C.Bytes,
    noteId: string,
    list: EncryptedAttachmentDto[],
  ): Promise<AttachmentDto[]> {
    const out: AttachmentDto[] = [];
    for (const a of list) {
      const meta = await C.decryptAttachmentMeta(key, a.id, a.metaEnc);
      if (meta.note && meta.note !== noteId) continue; // a file that was moved to another entry behind our back
      this.fileKeys.set(a.id, C.attachmentDataKey(meta));
      out.push({ id: a.id, name: meta.name, mime: meta.mime, size: a.size, createdAt: a.createdAt });
    }
    return out;
  }

  private async decryptRecord(rec: NoteRecordDto, key: C.Bytes): Promise<NoteDto> {
    const payload = notePayloadSchema.parse(await C.decryptNote(key, rec.id, rec.payload));
    return {
      id: rec.id,
      type: rec.type,
      ...payload,
      pinned: rec.pinned,
      vaultId: rec.vaultId,
      canEdit: rec.canEdit,
      expiresAt: rec.expiresAt,
      attachments: await this.decryptAttachments(key, rec.id, rec.attachments),
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      deletedAt: rec.deletedAt,
    };
  }

  private async openRecord(rec: NoteRecordDto): Promise<NoteDto> {
    let c = await this.container(rec.vaultId);
    try {
      return await this.decryptRecord(rec, c.key);
    } catch (err) {
      if (!rec.vaultId) throw err;
      // The vault key may have been rotated since we cached it.
      c = await this.container(rec.vaultId, true);
      return this.decryptRecord(rec, c.key);
    }
  }

  /** All readable entries; entries that fail to decrypt are skipped and counted. */
  async notes(status: 'active' | 'trash' = 'active'): Promise<NoteDto[] & { failed?: number }> {
    const res = await this.http.json<NoteListResponse>('GET', `/notes?status=${status}`);
    await this.rememberVaultKeys(res.vaultKeys);
    const out: NoteDto[] & { failed?: number } = [];
    let failed = 0;
    for (const rec of res.notes) {
      const key = rec.vaultId ? this.vaultKeys.get(rec.vaultId)?.key : this.keys().dek;
      try {
        if (!key) throw new Error('no key');
        out.push(await this.decryptRecord(rec, key));
      } catch {
        failed++;
      }
    }
    if (failed) out.failed = failed;
    return out;
  }

  private async record(id: string): Promise<NoteRecordDto> {
    return (await this.http.json<{ note: NoteRecordDto }>('GET', `/notes/${id}`)).note;
  }

  async note(id: string): Promise<NoteDto> {
    return this.openRecord(await this.record(id));
  }

  async createNote(input: NoteInput): Promise<NoteDto> {
    const n = noteInputSchema.parse(input);
    const id = uuid();
    const { key, version } = await this.container(n.vaultId);
    const payload = await C.encryptNote(key, id, n.type, n);
    const res = await this.http.json<{ note: NoteRecordDto }>('POST', '/notes', {
      id,
      type: n.type,
      payload,
      pinned: n.pinned,
      vaultId: n.vaultId,
      vaultKeyVersion: version,
      expiresAt: n.expiresAt,
    });
    return this.openRecord(res.note);
  }

  async updateNote(id: string, input: NoteUpdate): Promise<NoteDto> {
    const patch = noteUpdateSchema.parse(input);
    let current = await this.note(id);
    if (patch.vaultId !== undefined && patch.vaultId !== current.vaultId) {
      current = await this.moveNote(id, patch.vaultId);
    }
    const body: Record<string, unknown> = {};
    if (CONTENT_KEYS.some((k) => patch[k] !== undefined)) {
      const type = patch.type ?? current.type;
      const { key, version } = await this.container(current.vaultId);
      body.type = type;
      body.payload = await C.encryptNote(key, id, type, {
        title: patch.title ?? current.title,
        content: patch.content ?? current.content,
        fields: patch.fields ?? current.fields,
        customFields: patch.customFields ?? current.customFields,
        tags: patch.tags ?? current.tags,
      });
      if (version !== undefined) body.vaultKeyVersion = version;
    }
    if (patch.pinned !== undefined) body.pinned = patch.pinned;
    if (patch.expiresAt !== undefined) body.expiresAt = patch.expiresAt;
    if (Object.keys(body).length === 0) return current;
    const res = await this.http.json<{ note: NoteRecordDto }>('PATCH', `/notes/${id}`, body);
    return this.openRecord(res.note);
  }

  /** Moves an entry between the personal vault (null) and shared vaults, re-encrypting it for the target. */
  async moveNote(id: string, vaultId: string | null): Promise<NoteDto> {
    const rec = await this.record(id);
    const from = await this.container(rec.vaultId);
    const to = await this.container(vaultId);
    const versions = (
      await this.http.json<{ versions: NoteVersionRecordDto[] }>('GET', `/notes/${id}/versions`)
    ).versions;
    const res = await this.http.json<{ note: NoteRecordDto }>('POST', `/notes/${id}/move`, {
      vaultId,
      vaultKeyVersion: to.version,
      expectedUpdatedAt: rec.updatedAt,
      payload: await C.rewrapNote(from.key, to.key, id, rec.payload),
      versions: await Promise.all(
        versions.map(async (v) => ({
          id: v.id,
          payload: await C.rewrapNote(from.key, to.key, id, v.payload),
        })),
      ),
      attachments: await Promise.all(
        rec.attachments.map(async (a) => ({
          id: a.id,
          metaEnc: await C.rewrapAttachmentMeta(from.key, to.key, a.id, a.metaEnc),
        })),
      ),
    });
    return this.openRecord(res.note);
  }

  async versions(id: string): Promise<VersionDetail[]> {
    const rec = await this.record(id);
    const { key } = await this.container(rec.vaultId);
    const list = (await this.http.json<{ versions: NoteVersionRecordDto[] }>('GET', `/notes/${id}/versions`))
      .versions;
    const out: VersionDetail[] = [];
    for (const v of list) {
      try {
        const p = notePayloadSchema.parse(await C.decryptNote(key, id, v.payload));
        out.push({ id: v.id, type: v.type, ...p, createdAt: v.savedAt, author: v.author });
      } catch {
        // unreadable version (should not happen) – skip
      }
    }
    return out;
  }

  // --- Attachments ------------------------------------------------------------------------------------

  async uploadAttachment(noteId: string, file: PlainFile): Promise<AttachmentDto> {
    const rec = await this.record(noteId);
    const { key, version } = await this.container(rec.vaultId);
    const id = uuid();
    const enc = await C.encryptAttachment(key, id, file.data, {
      name: safeFilename(file.name),
      mime: (file.mime || 'application/octet-stream').slice(0, 100),
      note: noteId,
    });
    const res = await this.http.upload<{ attachment: EncryptedAttachmentDto }>(
      'POST',
      `/notes/${noteId}/attachments`,
      {
        fields: { id, meta: enc.metaEnc, ...(version !== undefined ? { keyVersion: String(version) } : {}) },
        file: { name: 'blob', data: enc.data },
      },
    );
    this.fileKeys.set(id, C.fromBase64(enc.meta.key));
    return {
      id,
      name: enc.meta.name,
      mime: enc.meta.mime,
      size: res.attachment.size,
      createdAt: res.attachment.createdAt,
    };
  }

  /** Downloads and decrypts a file of an entry that was listed before (its key is known). */
  async downloadAttachment(noteId: string, attachment: Pick<AttachmentDto, 'id'>): Promise<Uint8Array> {
    if (!this.fileKeys.has(attachment.id)) await this.note(noteId);
    const key = this.fileKeys.get(attachment.id);
    if (!key) throw new ApiError(404, 'NOT_FOUND', 'Attachment not found');
    const raw = await this.http.bytes(`/notes/${noteId}/attachments/${attachment.id}`);
    return C.decryptAttachmentData(key, attachment.id, raw);
  }

  // --- Templates --------------------------------------------------------------------------------------

  async templates(): Promise<TemplateDto[]> {
    const { dek } = this.keys();
    const list = (await this.http.json<{ templates: TemplateRecordDto[] }>('GET', '/templates')).templates;
    const out: TemplateDto[] = [];
    for (const r of list) {
      try {
        const t = templateInputSchema.parse(await C.decryptTemplate(dek, r.id, r.payload));
        out.push({ id: r.id, ...t, createdAt: r.createdAt, updatedAt: r.updatedAt });
      } catch {
        // skip unreadable template
      }
    }
    return out;
  }

  async saveTemplate(input: TemplateInput, id?: string): Promise<void> {
    const { dek } = this.keys();
    const t = templateInputSchema.parse(input);
    const tid = id ?? uuid();
    const payload = await C.encryptTemplate(dek, tid, t);
    if (id) await this.http.json('PUT', `/templates/${id}`, { payload });
    else await this.http.json('POST', '/templates', { id: tid, payload });
  }

  // --- Shared vaults ----------------------------------------------------------------------------------

  private async rawVaults(): Promise<VaultRecordDto[]> {
    const list = (await this.http.json<{ vaults: VaultRecordDto[] }>('GET', '/vaults')).vaults;
    await this.rememberVaultKeys(
      list.map((v) => ({ vaultId: v.id, role: v.role, keyWrapped: v.keyWrapped, keyVersion: v.keyVersion })),
    );
    return list;
  }

  async vaults(): Promise<VaultDto[]> {
    const out: VaultDto[] = [];
    for (const v of await this.rawVaults()) {
      const key = this.vaultKeys.get(v.id);
      let name = '…';
      if (key) {
        try {
          name = await C.decryptVaultName(key.key, v.id, v.nameEnc);
        } catch {
          // keep placeholder
        }
      }
      out.push({
        id: v.id,
        name,
        role: v.role,
        members: await Promise.all(
          v.members.map(async ({ publicKey, ...m }) => ({
            ...m,
            ...(publicKey ? { fingerprint: await C.fingerprint(publicKey) } : {}),
          })),
        ),
        noteCount: v.noteCount,
        rotationPending: v.rotationPending,
        createdAt: v.createdAt,
      });
    }
    return out;
  }

  directory() {
    return this.http.json<{ users: DirectoryUserDto[] }>('GET', '/users/directory').then((r) => r.users);
  }

  async createVault(name: string): Promise<VaultDto> {
    const s = this.keys();
    if (!s.publicKey) throw new ApiError(409, 'NO_KEYS', 'This account has no key pair');
    const id = uuid();
    const key = C.newSymmetricKey();
    await this.http.json('POST', '/vaults', {
      id,
      nameEnc: await C.encryptVaultName(key, id, name.trim()),
      keyWrapped: await C.sealTo(s.publicKey, key, C.AAD.vaultKey(id, s.userId)),
    });
    return (await this.vaults()).find((v) => v.id === id)!;
  }

  async renameVault(vaultId: string, name: string): Promise<void> {
    const { key, version } = await this.container(vaultId, true);
    await this.http.json('PATCH', `/vaults/${vaultId}`, {
      nameEnc: await C.encryptVaultName(key, vaultId, name.trim()),
      keyVersion: version,
    });
  }

  /** Seals the vault key to the new member's public key. */
  async addMember(vaultId: string, username: string, role: VaultRole): Promise<void> {
    const target = (await this.directory()).find((u) => u.username === username.trim().toLowerCase());
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    if (!target.publicKey) throw new ApiError(409, 'NO_KEYS', 'This user has no keys yet');
    const { key, version } = await this.container(vaultId, true);
    await this.http.json('POST', `/vaults/${vaultId}/members`, {
      userId: target.id,
      role,
      keyWrapped: await C.sealTo(target.publicKey, key, C.AAD.vaultKey(vaultId, target.id)),
      keyVersion: version,
    });
  }

  /** Removes a member (or leaves with the own id). Owners replace the vault key right away. */
  async removeMember(vaultId: string, userId: string): Promise<{ deleted: boolean; rotated: boolean }> {
    const role = (await this.container(vaultId)).role;
    const res = await this.http.json<{ deleted: boolean }>('DELETE', `/vaults/${vaultId}/members/${userId}`);
    let rotated = false;
    if (!res.deleted && role === 'owner' && userId !== this.keys().userId) {
      try {
        await this.rotateVault(vaultId);
        rotated = true;
      } catch {
        // stays marked as pending and is retried the next time vaults are loaded
      }
    }
    if (userId === this.keys().userId) this.vaultKeys.delete(vaultId);
    return { deleted: res.deleted, rotated };
  }

  /**
   * Replaces a vault's key: every payload, version, attachment metadata and the name are re-encrypted and the
   * new key is sealed to each remaining member. Retries when the vault changed in the meantime.
   */
  async rotateVault(vaultId: string, attempts = 3): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.rotateOnce(vaultId);
        return;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'STALE') || attempt >= attempts) throw err;
      }
    }
  }

  private async rotateOnce(vaultId: string) {
    const data = await this.http.json<VaultRotationDataDto>('GET', `/vaults/${vaultId}/rotation`);
    let old = await this.container(vaultId);
    if (old.version !== data.keyVersion) old = await this.container(vaultId, true);

    const next = C.newSymmetricKey();
    const members = [];
    for (const m of data.members) {
      if (!m.publicKey) throw new ApiError(409, 'NO_KEYS', 'A member has no key pair');
      members.push({
        userId: m.userId,
        keyWrapped: await C.sealTo(m.publicKey, next, C.AAD.vaultKey(vaultId, m.userId)),
      });
    }
    await this.http.json('POST', `/vaults/${vaultId}/rotate`, {
      keyVersion: data.keyVersion,
      nameEnc: await C.encryptVaultName(
        next,
        vaultId,
        await C.decryptVaultName(old.key, vaultId, data.nameEnc),
      ),
      notes: await Promise.all(
        data.notes.map(async (n) => ({
          id: n.id,
          payload: await C.rewrapNote(old.key, next, n.id, n.payload),
          expectedUpdatedAt: n.updatedAt,
        })),
      ),
      versions: await Promise.all(
        data.versions.map(async (v) => ({
          id: v.id,
          payload: await C.rewrapNote(old.key, next, v.noteId, v.payload),
        })),
      ),
      attachments: await Promise.all(
        data.attachments.map(async (a) => ({
          id: a.id,
          metaEnc: await C.rewrapAttachmentMeta(old.key, next, a.id, a.metaEnc),
        })),
      ),
      members,
    });
    await this.container(vaultId, true);
  }

  /** Rotates vaults that are waiting for an owner (a member left while no owner was online). */
  async rotatePending(list: VaultDto[]): Promise<number> {
    let n = 0;
    for (const v of list) {
      if (!v.rotationPending || v.role !== 'owner') continue;
      try {
        await this.rotateVault(v.id);
        n++;
      } catch {
        // try again next time
      }
    }
    return n;
  }

  // --- Emergency access -------------------------------------------------------------------------------

  /** Seals the own account key to a trusted contact's public key. */
  async grantEmergency(username: string, waitDays: number, password: string): Promise<void> {
    const authKey = await this.authKeyFor(password);
    const target = (await this.directory()).find((u) => u.username === username.trim().toLowerCase());
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    if (!target.publicKey) throw new ApiError(409, 'NO_KEYS', 'This user has no keys yet');
    const id = uuid();
    await this.http.json('POST', '/emergency', {
      authKey,
      id,
      granteeId: target.id,
      waitDays,
      keyWrapped: await C.sealTo(target.publicKey, this.keys().dek, C.AAD.emergency(id)),
    });
  }

  emergencyList() {
    return this.http.json<{ granted: EmergencyAccessDto[]; received: EmergencyAccessDto[] }>(
      'GET',
      '/emergency',
    );
  }

  /** The grantor's entries, decrypted with their account key (read-only). */
  async emergencyNotes(grantId: string): Promise<NoteDto[]> {
    const res = await this.http.json<EmergencyNotesResponse>('GET', `/emergency/${grantId}/notes`);
    const grantorKey = await this.openSealed(res.keyWrapped, C.AAD.emergency(grantId));
    const out: NoteDto[] = [];
    for (const rec of res.notes) {
      try {
        out.push(await this.decryptRecord(rec, grantorKey));
      } catch {
        // skip
      }
    }
    return out;
  }

  async downloadEmergencyAttachment(
    grantId: string,
    noteId: string,
    attachmentId: string,
  ): Promise<Uint8Array> {
    if (!this.fileKeys.has(attachmentId)) await this.emergencyNotes(grantId);
    const key = this.fileKeys.get(attachmentId);
    if (!key) throw new ApiError(404, 'NOT_FOUND', 'Attachment not found');
    const raw = await this.http.bytes(`/emergency/${grantId}/notes/${noteId}/attachments/${attachmentId}`);
    return C.decryptAttachmentData(key, attachmentId, raw);
  }

  // --- Export / import --------------------------------------------------------------------------------

  /** Personal entries with their files, decrypted (for the export formats). */
  async exportData(): Promise<{ notes: NoteDto[]; files: Map<string, ExportedFile[]> }> {
    const list = (await this.notes('active')).filter((n) => n.vaultId === null);
    const files = new Map<string, ExportedFile[]>();
    for (const n of list) {
      for (const a of n.attachments) {
        const data = await this.downloadAttachment(n.id, a);
        files.set(n.id, [...(files.get(n.id) ?? []), { name: a.name, mime: a.mime, data }]);
      }
    }
    return { notes: list, files };
  }

  async exportJson(): Promise<{ json: string; count: number }> {
    const { notes, files } = await this.exportData();
    return {
      json: JSON.stringify(exportDocument(this.keys().username, notes, files), null, 2),
      count: notes.length,
    };
  }

  /** Imports a JSON export: every entry is encrypted here, then uploaded in batches. */
  async importJson(json: string, onProgress?: (done: number, total: number) => void) {
    let parsed: ReturnType<typeof exportFileSchema.parse>;
    try {
      parsed = exportFileSchema.parse(JSON.parse(json));
    } catch {
      throw new ApiError(400, 'BAD_IMPORT', 'Not a Tresor export file');
    }
    const { dek } = this.keys();
    let skipped = 0;
    const batch: Record<string, unknown>[] = [];
    const files: { noteId: string; file: PlainFile }[] = [];
    for (const raw of parsed.notes) {
      const r = exportedNoteSchema.safeParse(raw);
      if (!r.success) {
        skipped++;
        continue;
      }
      const n = r.data;
      const id = uuid();
      batch.push({
        id,
        type: n.type,
        payload: await C.encryptNote(dek, id, n.type, n),
        pinned: n.pinned,
        expiresAt: n.expiresAt ?? null,
        ...(n.createdAt ? { createdAt: n.createdAt } : {}),
        ...(n.updatedAt ? { updatedAt: n.updatedAt } : {}),
      });
      for (const f of n.attachments ?? []) {
        files.push({ noteId: id, file: { name: f.name, mime: f.mime, data: C.fromBase64(f.data) } });
      }
    }
    const total = batch.length;
    for (let i = 0; i < batch.length; i += 100) {
      await this.http.json('POST', '/notes/import', { notes: batch.slice(i, i + 100) });
      onProgress?.(Math.min(i + 100, total), total);
    }
    for (const f of files) await this.uploadAttachment(f.noteId, f.file);
    return { imported: total, skipped };
  }
}
