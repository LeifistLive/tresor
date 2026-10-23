import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachments, emergencyAccess, notes, users, vaults } from '../src/db/schema.js';
import { sendExpiryReminders } from '../src/services/maintenance.js';
import { rotateMasterKey } from '../src/services/rotation.js';
import {
  appOnDatabase,
  Browser,
  createTestApp,
  MASTER_KEY,
  SoftAuthenticator,
  TestClient,
} from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let ctx: Ctx;
let admin: Browser;
let anna: Browser;
let annaId: string;

const ADMIN_PW = 'admin-password-1';
const ANNA_PW = 'annas-password-1';

// Minimal ntfy-compatible endpoint that records notifications.
let hook: Server;
let hookUrl: string;
const received: { path: string; title: string; body: string }[] = [];

async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function signIn(username: string, password: string) {
  const b = new Browser(ctx.app);
  await b.client.login({ username, password });
  return b;
}

beforeAll(async () => {
  ctx = await createTestApp();
  hook = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        title: decodeURIComponent(String(req.headers.title ?? '')),
        body,
      });
      res.end('ok');
    });
  });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}`;

  admin = new Browser(ctx.app);
  await admin.client.setup({ username: 'leif', displayName: 'Leif', language: 'de', password: ADMIN_PW });
  const created = await admin.http.post('/api/admin/users', {
    username: 'anna',
    displayName: 'Anna',
    password: 'temporary-pass-1',
  });
  annaId = created.body.user.id;
  anna = await signIn('anna', 'temporary-pass-1');
  await anna.client.changePassword({ currentPassword: 'temporary-pass-1', newPassword: ANNA_PW });
});

afterAll(async () => {
  hook.close();
  await ctx.app.close();
});

describe('custom fields and expiry', () => {
  it('stores custom fields encrypted and the expiry date as metadata', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const n = await admin.client.createNote({
      type: 'login',
      title: 'Router',
      fields: { username: 'admin', password: 'x', totp: 'JBSWY3DPEHPK3PXP' },
      customFields: [
        { label: 'Seriennummer', value: 'SN-123', secret: false },
        { label: '', value: '' },
      ],
      expiresAt: soon,
    });
    expect(n.customFields).toEqual([{ label: 'Seriennummer', value: 'SN-123', secret: false }]);
    expect(n.fields.totp).toBe('JBSWY3DPEHPK3PXP');
    expect(n.expiresAt).toBe(soon);
    const [row] = await ctx.db.select().from(notes).where(eq(notes.id, n.id));
    expect(row!.payload).not.toContain('SN-123');
    expect(row!.expiresAt).toBe(soon);
  });
});

describe('version history', () => {
  it('keeps previous states and restores them', async () => {
    const note = await admin.client.createNote({ type: 'note', title: 'v1', content: 'eins' });
    await admin.client.updateNote(note.id, { title: 'v2', content: 'zwei' });
    await admin.client.updateNote(note.id, { pinned: true }); // no new version for pin changes
    await admin.client.updateNote(note.id, { title: 'v3' });
    const versions = await admin.client.versions(note.id);
    expect(versions.map((v) => v.title)).toEqual(['v2', 'v1']);
    expect(versions[1]!.content).toBe('eins');
    await admin.http.post(`/api/notes/${note.id}/versions/${versions[1]!.id}/restore`);
    expect(await admin.client.note(note.id)).toMatchObject({ title: 'v1', content: 'eins', pinned: true });
    expect(await admin.client.versions(note.id)).toHaveLength(3);
  });
});

describe('attachments', () => {
  it('uploads, lists, downloads and deletes files encrypted with their own key', async () => {
    const note = await admin.client.createNote({ type: 'note', title: 'Mit Anhang' });
    const data = new Uint8Array(300_000).map((_, i) => i % 251);
    const a = await admin.client.uploadAttachment(note.id, { name: 'scan.png', mime: 'image/png', data });
    expect(a).toMatchObject({ name: 'scan.png', mime: 'image/png', size: data.length });
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, a.id));
    expect(row!.metaEnc).not.toContain('scan');
    expect(Buffer.from(row!.data).includes(Buffer.from(data.subarray(0, 64)))).toBe(false);

    const listed = (await admin.client.note(note.id)).attachments;
    expect(listed).toEqual([expect.objectContaining({ id: a.id, name: 'scan.png' })]);
    expect(Buffer.from(await admin.client.downloadAttachment(note.id, a)).equals(Buffer.from(data))).toBe(
      true,
    );
    expect((await anna.http.get(`/api/notes/${note.id}/attachments/${a.id}`)).status).toBe(404);
    expect((await admin.http.delete(`/api/notes/${note.id}/attachments/${a.id}`)).status).toBe(200);
    expect((await admin.client.note(note.id)).attachments).toHaveLength(0);
  });
});

describe('shared vaults', () => {
  let vaultId: string;
  let sharedNoteId: string;

  it('creates a vault and shares it (keys sealed in the browser)', async () => {
    const v = await admin.client.createVault('Familie');
    vaultId = v.id;
    expect(v).toMatchObject({ name: 'Familie', role: 'owner' });
    const [row] = await ctx.db.select().from(vaults).where(eq(vaults.id, vaultId));
    expect(row!.nameEnc).not.toContain('Familie');
    await admin.client.addMember(vaultId, 'anna', 'viewer');
    expect((await anna.client.vaults()).map((x) => x.name)).toEqual(['Familie']);
  });

  it('respects roles', async () => {
    const shared = await admin.client.createNote({
      type: 'wifi',
      title: 'Gäste-WLAN',
      fields: { ssid: 'Gast', password: 'willkommen' },
      vaultId,
    });
    sharedNoteId = shared.id;
    const seen = (await anna.client.notes()).find((n) => n.id === shared.id)!;
    expect(seen).toMatchObject({ canEdit: false, fields: { ssid: 'Gast', password: 'willkommen' } });
    const denied = await anna.client.updateNote(shared.id, { title: 'gehackt' }).catch((e) => e);
    expect(denied.code).toBe('READ_ONLY');
    const denied2 = await anna.client.createNote({ type: 'note', title: 'x', vaultId }).catch((e) => e);
    expect(denied2.code).toBe('READ_ONLY');

    await admin.http.patch(`/api/vaults/${vaultId}/members/${annaId}`, { role: 'editor' });
    const edited = await anna.client.updateNote(shared.id, { title: 'Gäste-WLAN 2' });
    expect(edited.title).toBe('Gäste-WLAN 2');
  });

  it('moves entries between personal and shared vaults (re-encrypting versions and files)', async () => {
    const own = await admin.client.createNote({ type: 'note', title: 'Wandert', content: 'a' });
    await admin.client.updateNote(own.id, { content: 'b' }); // creates a version
    await admin.client.uploadAttachment(own.id, {
      name: 'plan.pdf',
      mime: 'application/pdf',
      data: new TextEncoder().encode('%PDF plan'),
    });
    const moved = await admin.client.updateNote(own.id, { vaultId });
    expect(moved.vaultId).toBe(vaultId);
    const forAnna = (await anna.client.notes()).find((n) => n.id === own.id)!;
    expect(forAnna.content).toBe('b');
    expect((await anna.client.versions(own.id)).map((v) => v.content)).toEqual(['a']);
    expect(
      new TextDecoder().decode(await anna.client.downloadAttachment(own.id, forAnna.attachments[0]!)),
    ).toBe('%PDF plan');
    const back = await admin.client.moveNote(own.id, null);
    expect(back.vaultId).toBeNull();
    expect((await anna.http.get(`/api/notes/${own.id}`)).status).toBe(404);
  });

  it('rejects writes encrypted with an outdated vault key', async () => {
    const [row] = await ctx.db.select().from(vaults).where(eq(vaults.id, vaultId));
    const res = await admin.http.patch(`/api/notes/${sharedNoteId}`, {
      payload: 'A'.repeat(80),
      vaultKeyVersion: row!.keyVersion + 5,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE');
  });

  it('replaces the vault key when a member is removed', async () => {
    const before = (await ctx.db.select().from(notes).where(eq(notes.id, sharedNoteId)))[0]!.payload;
    const [vBefore] = await ctx.db.select().from(vaults).where(eq(vaults.id, vaultId));
    const res = await admin.client.removeMember(vaultId, annaId);
    expect(res).toEqual({ deleted: false, rotated: true });
    const [vAfter] = await ctx.db.select().from(vaults).where(eq(vaults.id, vaultId));
    expect(vAfter!.keyVersion).toBe(vBefore!.keyVersion + 1);
    expect(vAfter!.rotationPending).toBe(false);
    const after = (await ctx.db.select().from(notes).where(eq(notes.id, sharedNoteId)))[0]!.payload;
    expect(after).not.toBe(before);
    expect((await anna.http.get(`/api/notes/${sharedNoteId}`)).status).toBe(404);
    expect((await admin.client.note(sharedNoteId)).title).toBe('Gäste-WLAN 2');
  });

  it('marks the vault when a member leaves, and an owner rotates it later', async () => {
    await admin.client.addMember(vaultId, 'anna', 'editor');
    expect((await anna.client.note(sharedNoteId)).title).toBe('Gäste-WLAN 2');
    const left = await anna.client.removeMember(vaultId, annaId);
    expect(left).toEqual({ deleted: false, rotated: false });
    const list = await admin.client.vaults();
    expect(list[0]!.rotationPending).toBe(true);
    expect(await admin.client.rotatePending(list)).toBe(1);
    expect((await admin.client.vaults())[0]!.rotationPending).toBe(false);
    expect((await admin.client.note(sharedNoteId)).title).toBe('Gäste-WLAN 2');
  });
});

describe('templates', () => {
  it('creates, updates, lists and deletes encrypted templates', async () => {
    await admin.client.saveTemplate({ name: 'Steckdose', type: 'matter', fields: { manufacturer: 'Eve' } });
    const [t] = await admin.client.templates();
    expect(t).toMatchObject({ name: 'Steckdose', fields: { manufacturer: 'Eve' } });
    await admin.client.saveTemplate({ name: 'Steckdose 2', type: 'matter' }, t!.id);
    expect((await admin.client.templates())[0]!.name).toBe('Steckdose 2');
    expect(await anna.client.templates()).toHaveLength(0);
    expect((await admin.http.delete(`/api/templates/${t!.id}`)).status).toBe(200);
  });
});

describe('notifications', () => {
  it('stores the channel sealed and sends test, login and failure messages', async () => {
    const cfg = await anna.http.put('/api/account/notifications', {
      enabled: true,
      provider: 'ntfy',
      url: hookUrl,
      topic: 'tresor-anna',
      token: 'secret-token',
      events: { newLogin: true, failedLogin: true, emergency: true, reminders: true, adminAlerts: false },
    });
    expect(cfg.body.config).toMatchObject({ enabled: true, hasToken: true });
    expect(JSON.stringify(cfg.body)).not.toContain('secret-token');
    const [row] = await ctx.db.select().from(users).where(eq(users.id, annaId));
    expect(row!.notifyConfigEnc).not.toContain('tresor-anna');

    expect((await anna.http.post('/api/account/notifications/test')).status).toBe(200);
    await waitFor(() => received.find((r) => r.path === '/tresor-anna' && r.body.includes('Test')));
    await new Browser(ctx.app).client.login({ username: 'anna', password: 'wrong-password' }).catch(() => {});
    await waitFor(() => received.find((r) => r.title.includes('Fehlgeschlagene')));
    await signIn('anna', ANNA_PW);
    await waitFor(() => received.find((r) => r.title.includes('Neue Anmeldung')));
  });

  it('refuses SSRF targets and reports only generic errors', async () => {
    const events = {
      newLogin: true,
      failedLogin: true,
      emergency: true,
      reminders: true,
      adminAlerts: false,
    };
    await anna.http.put('/api/account/notifications', {
      enabled: true,
      provider: 'webhook',
      url: 'http://169.254.169.254/latest/meta-data',
      events,
    });
    const res = await anna.http.post('/api/account/notifications/test');
    expect(res.body.error).toEqual({ code: 'NOTIFY_FAILED', message: 'Destination not allowed' });

    // With private targets disallowed, the local endpoint is refused as well.
    const strict = await appOnDatabase(ctx.db, { NOTIFY_ALLOW_PRIVATE: 'false' });
    try {
      const b = new Browser(strict);
      await b.client.login({ username: 'anna', password: ANNA_PW });
      await b.http.put('/api/account/notifications', {
        enabled: true,
        provider: 'ntfy',
        url: hookUrl,
        topic: 'tresor-anna',
        events,
      });
      expect((await b.http.post('/api/account/notifications/test')).body.error.message).toBe(
        'Destination not allowed',
      );
    } finally {
      await strict.close();
    }
    const restore = await anna.http.put('/api/account/notifications', {
      enabled: true,
      provider: 'ntfy',
      url: hookUrl,
      topic: 'tresor-anna',
      events,
    });
    expect(restore.status).toBe(200);
  });

  it('sends a daily reminder for expiring entries (counts only)', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await anna.client.createNote({ type: 'card', title: 'Kreditkarte Geheim', expiresAt: soon });
    expect(await sendExpiryReminders(ctx.app, new Date())).toBeGreaterThan(0);
    const msg = await waitFor(() => received.find((r) => r.title.includes('laufen bald ab')));
    expect(msg.body).not.toContain('Kreditkarte');
    expect(await sendExpiryReminders(ctx.app, new Date())).toBe(0); // once per day
  });
});

describe('emergency access', () => {
  let grantId: string;

  it('opens only after the waiting period and is read-only', async () => {
    await admin.client.createNote({ type: 'secret', title: 'Testament', fields: { value: 'Safe 1234' } });
    const wrongPw = await admin.client.grantEmergency('anna', 3, 'wrong-password').catch((e) => e);
    expect(wrongPw.code).toBe('INVALID_CREDENTIALS');
    await admin.client.grantEmergency('anna', 3, ADMIN_PW);
    const list = (await anna.client.emergencyList()).received;
    expect(list).toHaveLength(1);
    grantId = list[0]!.id;
    expect((await anna.http.get(`/api/emergency/${grantId}/notes`)).status).toBe(403);

    await anna.http.post(`/api/emergency/${grantId}/request`);
    expect((await admin.client.emergencyList()).granted[0]).toMatchObject({
      status: 'requested',
      accessible: false,
    });
    expect((await anna.http.get(`/api/emergency/${grantId}/notes`)).status).toBe(403);
    await admin.http.post(`/api/emergency/${grantId}/reject`);
    expect((await admin.client.emergencyList()).granted[0]!.status).toBe('idle');

    await anna.http.post(`/api/emergency/${grantId}/request`);
    await ctx.db
      .update(emergencyAccess)
      .set({ requestedAt: new Date(Date.now() - 4 * 86_400_000) })
      .where(eq(emergencyAccess.id, grantId));
    const view = await anna.client.emergencyNotes(grantId);
    expect(view.find((n) => n.title === 'Testament')).toMatchObject({
      canEdit: false,
      fields: { value: 'Safe 1234' },
    });
  });

  it('does not let the contact take over the account (recovery needs the recovery key, not the DEK)', async () => {
    // The contact now holds the grantor's account key. Proofs derived from it must not unlock recovery.
    const dek = (admin.client as unknown as { state: { dek: Uint8Array } }).state.dek;
    const { hkdf, toBase64Url } = await import('@tresor/shared/crypto');
    const fromDek = [
      toBase64Url(await hkdf(dek, '', 'tresor/dek-proof/v3')),
      toBase64Url(await hkdf(dek, '', 'tresor/recovery-proof/v3')),
    ];
    for (const recoveryProof of fromDek) {
      const res = await new TestClient(ctx.app).post('/api/auth/recover', {
        username: 'leif',
        recoveryProof,
        recoveryWrapped: 'A'.repeat(60),
        newRecoveryProof: recoveryProof,
        kdfSalt: 'AAAAAAAAAAAAAAAAAAAAAA==',
        kdfParams: 'm=8192,t=1,p=1',
        authKey: recoveryProof,
        dekWrapped: 'A'.repeat(60),
      });
      expect(res.body.error.code).toBe('INVALID_RECOVERY_KEY');
    }
    expect((await admin.http.get('/api/auth/me')).status).toBe(200);
  });

  it('can be revoked by the grantor', async () => {
    await admin.http.delete(`/api/emergency/${grantId}`);
    expect((await anna.http.get(`/api/emergency/${grantId}/notes`)).status).toBe(404);
  });
});

describe('passkeys', () => {
  const authenticator = new SoftAuthenticator();
  const credentialId = Buffer.from(authenticator.credentialId).toString('base64url');

  it('registers a passkey that can unlock the vault (PRF stays in the browser)', async () => {
    const opts = (await admin.http.post('/api/account/passkeys/options')).body;
    expect(opts.options.extensions.prf.eval.first).toBe(opts.prfSalt);
    const prf = Buffer.from(authenticator.prf(opts.prfSalt), 'base64url');
    const body = {
      challengeId: opts.challengeId,
      name: 'MacBook',
      response: authenticator.register(opts.options),
      dekWrapped: await admin.client.passkeyWrap(prf, credentialId),
    };
    // A stolen session alone must not be enough to plant a passkey.
    expect((await admin.http.post('/api/account/passkeys', body)).status).toBe(400);
    const wrong = await admin.http.post('/api/account/passkeys', {
      ...body,
      authKey: await admin.client.authKeyFor('not-the-password'),
    });
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const opts2 = (await admin.http.post('/api/account/passkeys/options')).body;
    const res = await admin.http.post('/api/account/passkeys', {
      ...body,
      challengeId: opts2.challengeId,
      response: authenticator.register(opts2.options),
      authKey: await admin.client.authKeyFor(ADMIN_PW),
    });
    expect(res.status).toBe(201);
    expect(res.body.canUnlock).toBe(true);
    expect((await admin.http.get('/api/account/passkeys')).body.passkeys).toEqual([
      expect.objectContaining({ name: 'MacBook', canUnlock: true }),
    ]);
  });

  it('signs in with the passkey and decrypts entries', async () => {
    const b = new Browser(ctx.app);
    const opts = (await b.http.post('/api/auth/passkey/options')).body;
    const res = await b.client.loginWithPasskey({
      challengeId: opts.challengeId,
      response: authenticator.authenticate(opts.options),
      prf: Buffer.from(authenticator.prf(opts.prfSalt), 'base64url'),
    });
    expect(res.user.username).toBe('leif');
    expect((await b.client.notes()).map((n) => n.title)).toContain('Testament');
  });

  it('rejects tampered assertions, reused challenges, missing and wrong PRF', async () => {
    const b = new Browser(ctx.app);
    let opts = (await b.http.post('/api/auth/passkey/options')).body;
    const prf = Buffer.from(authenticator.prf(opts.prfSalt), 'base64url');
    const bad = await b.client
      .loginWithPasskey({
        challengeId: opts.challengeId,
        response: authenticator.authenticate(opts.options, true),
        prf,
      })
      .catch((e) => e);
    expect(bad.code).toBe('PASSKEY_FAILED');
    const reuse = await b.client
      .loginWithPasskey({
        challengeId: opts.challengeId,
        response: authenticator.authenticate(opts.options),
        prf,
      })
      .catch((e) => e);
    expect(reuse.code).toBe('PASSKEY_FAILED');
    opts = (await b.http.post('/api/auth/passkey/options')).body;
    const noPrf = await b.client
      .loginWithPasskey({
        challengeId: opts.challengeId,
        response: authenticator.authenticate(opts.options),
        prf: undefined,
      })
      .catch((e) => e);
    expect(noPrf.code).toBe('PASSKEY_NO_PRF');
    opts = (await b.http.post('/api/auth/passkey/options')).body;
    const wrong = await b.client
      .loginWithPasskey({
        challengeId: opts.challengeId,
        response: authenticator.authenticate(opts.options),
        prf: new Uint8Array(32).fill(7),
      })
      .catch((e) => e);
    expect(wrong.code).toBe('PASSKEY_FAILED');
    expect(b.client.unlocked).toBe(false);
    expect((await b.http.get('/api/auth/me')).status).toBe(401); // the session was closed again
  });

  it('rejects a foreign origin', async () => {
    const res = await new TestClient(ctx.app).request(
      'POST',
      '/api/auth/passkey/options',
      {},
      { origin: 'https://evil.example' },
    );
    expect(res.body.error.code).toBe('PASSKEY_FAILED');
  });
});

describe('master key rotation', () => {
  it('re-seals everything under a new master key (dry run first)', async () => {
    const NEW_KEY = 'rotated-master-key-abcdefghijklmnopqrstuvwxyz-0123456789';
    await expect(rotateMasterKey(ctx.db, MASTER_KEY, MASTER_KEY)).rejects.toThrow(/equals/);

    const dry = await rotateMasterKey(ctx.db, MASTER_KEY, NEW_KEY, { dryRun: true });
    expect(dry.users).toBeGreaterThan(0);
    expect((await admin.http.get('/api/auth/me')).status).toBe(200); // dry run changed nothing

    const report = await rotateMasterKey(ctx.db, MASTER_KEY, NEW_KEY);
    expect(report.passkeys).toBe(1);
    expect((await admin.http.get('/api/auth/me')).status).toBe(401); // sessions revoked

    let rotated: FastifyInstance | undefined;
    try {
      await expect(appOnDatabase(ctx.db)).rejects.toThrow(/does not match/);
      rotated = await appOnDatabase(ctx.db, { VAULT_MASTER_KEY: NEW_KEY });
      const b = new Browser(rotated);
      await b.client.login({ username: 'leif', password: ADMIN_PW });
      expect((await b.client.notes()).map((n) => n.title)).toContain('Testament');
      const a = new Browser(rotated);
      await a.client.login({ username: 'anna', password: ANNA_PW });
      expect((await a.http.get('/api/account/notifications')).body.config.topic).toBe('tresor-anna');
    } finally {
      await rotated?.close();
    }
  });
});
