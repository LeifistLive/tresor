import { decryptBackup, encryptBackup } from '@tresor/shared/client';
import { eq } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notes, users } from '../src/db/schema.js';
import { Browser, createTestApp, TestClient } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let ctx: Ctx;
let admin: Browser;
let adminRecoveryKey: string;
const ADMIN_PW = 'correct horse battery';

beforeAll(async () => {
  ctx = await createTestApp();
  admin = new Browser(ctx.app);
});

afterAll(async () => {
  await ctx.app.close();
});

describe('setup', () => {
  it('reports that setup is needed and creates the first admin with browser-made keys', async () => {
    expect((await admin.http.get('/api/setup/status')).body).toEqual({ needsSetup: true });
    const res = await admin.client.setup({
      username: 'leif',
      displayName: 'Leif',
      language: 'de',
      password: ADMIN_PW,
    });
    expect(res.user).toMatchObject({ username: 'leif', role: 'admin', hasKeys: true, hasRecoveryKey: true });
    expect(res.recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(res.sessionKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    adminRecoveryKey = res.recoveryKey;
    const [row] = await ctx.db.select().from(users);
    expect(row!.authHash).not.toContain('argon2');
    expect(row!.dekWrapped).toBeTruthy();
  });

  it('cannot be run twice', async () => {
    const res = await new Browser(ctx.app).client
      .setup({ username: 'mallory', displayName: 'M', language: 'en', password: 'another-password' })
      .catch((e) => e);
    expect(res.code).toBe('SETUP_DONE');
  });
});

describe('zero knowledge', () => {
  it('never sends the password or plaintext to the server and stores only ciphertext', async () => {
    const seen: string[] = [];
    const b = new Browser(ctx.app);
    const original = b.http.request.bind(b.http);
    b.http.request = (async (method, url, body, headers) => {
      seen.push(
        `${method} ${url} ${body instanceof Buffer ? body.toString('latin1') : JSON.stringify(body ?? '')}`,
      );
      return original(method, url, body, headers);
    }) as typeof b.http.request;

    await b.client.login({ username: 'leif', password: ADMIN_PW });
    const note = await b.client.createNote({
      type: 'login',
      title: 'Bank Geheimtitel',
      content: 'Sehr geheimer Inhalt',
      fields: { username: 'konto-4711', password: 'Pa55w0rd-Geheim' },
      tags: ['finanzen-geheim'],
    });
    await b.client.uploadAttachment(note.id, {
      name: 'kontoauszug-geheim.txt',
      mime: 'text/plain',
      data: new TextEncoder().encode('Kontostand: 1.234.567 EUR'),
    });
    await b.client.createVault('Tresor Familie Geheim');

    const wire = seen.join('\n');
    expect(wire).toContain('POST /api/auth/login');
    expect(wire).toContain('authKey');
    expect(wire).toContain('POST /api/vaults');
    expect(wire.length).toBeGreaterThan(1000);
    for (const secret of [
      ADMIN_PW,
      'Geheimtitel',
      'Sehr geheimer',
      'konto-4711',
      'Pa55w0rd',
      'finanzen-geheim',
      'kontoauszug',
      'Kontostand',
      'Familie Geheim',
    ]) {
      expect(wire).not.toContain(secret);
    }
    const dump = JSON.stringify(await ctx.db.select().from(notes));
    expect(dump).not.toContain('Geheimtitel');
    expect(dump).not.toContain('Pa55w0rd');
  });

  it('keeps keys across a reload via the session key, and only for this session', async () => {
    const blob = await admin.client.persist((await admin.http.get('/api/auth/session-key')).body.sessionKey);
    expect(blob).not.toContain(ADMIN_PW);
    const reloaded = new Browser(ctx.app);
    reloaded.http.cookie = admin.http.cookie;
    const sk = (await reloaded.http.get('/api/auth/session-key')).body;
    expect(await reloaded.client.restore(blob, sk)).toBe(true);
    expect((await reloaded.client.notes()).length).toBeGreaterThan(0);

    const other = new Browser(ctx.app);
    await other.client.login({ username: 'leif', password: ADMIN_PW });
    const otherKey = (await other.http.get('/api/auth/session-key')).body;
    expect(await new Browser(ctx.app).client.restore(blob, otherKey)).toBe(false);
  });
});

describe('security basics', () => {
  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'leif', authKey: 'x'.repeat(43) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthenticated access', async () => {
    expect((await new TestClient(ctx.app).get('/api/notes')).status).toBe(401);
    expect((await new TestClient(ctx.app).get('/api/auth/session-key')).status).toBe(401);
  });

  it('rejects wrong passwords without revealing whether the user exists', async () => {
    const wrong = await new Browser(ctx.app).client
      .login({ username: 'leif', password: 'nope-nope-nope' })
      .catch((e) => e);
    const unknown = await new Browser(ctx.app).client
      .login({ username: 'ghost', password: 'nope-nope-nope' })
      .catch((e) => e);
    expect(wrong.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.code).toBe('INVALID_CREDENTIALS');

    const c = new TestClient(ctx.app);
    const ghost1 = (await c.post('/api/auth/prelogin', { username: 'ghost' })).body;
    const ghost2 = (await c.post('/api/auth/prelogin', { username: 'ghost' })).body;
    const real = (await c.post('/api/auth/prelogin', { username: 'leif' })).body;
    expect(ghost1).toEqual(ghost2); // stable decoy
    expect(Object.keys(ghost1).sort()).toEqual(Object.keys(real).sort());
    expect(ghost1.kdfSalt).not.toBe(real.kdfSalt);
  });

  it('never accepts passwords or the master key, only the derived auth key', async () => {
    const c = new TestClient(ctx.app);
    expect((await c.post('/api/auth/login', { username: 'leif', password: ADMIN_PW })).status).toBe(400);
    const pre = (await c.post('/api/auth/prelogin', { username: 'leif' })).body;
    expect(Object.keys(pre).sort()).toEqual(['kdfParams', 'kdfSalt']);
    const { deriveMasterKey, toBase64Url } = await import('@tresor/shared/crypto');
    const masterKey = toBase64Url(await deriveMasterKey(ADMIN_PW, pre));
    const res = await c.post('/api/auth/login', { username: 'leif', authKey: masterKey });
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects weak key derivation parameters', async () => {
    const res = await admin.http.post('/api/account/password', {
      currentAuthKey: await admin.client.authKeyFor(ADMIN_PW),
      kdfSalt: 'AAAAAAAAAAAAAAAAAAAAAA==',
      kdfParams: 'm=1024,t=1,p=1',
      authKey: 'a'.repeat(43),
      dekWrapped: 'a'.repeat(60),
    });
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('sends security headers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
    expect(res.headers['content-security-policy']).not.toContain("'unsafe-eval'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('notes', () => {
  it('creates notes of different types and decrypts them in the client', async () => {
    const created = await admin.client.createNote({
      type: 'matter',
      title: 'Wohnzimmerlampe',
      fields: {
        setupCode: '34970112332',
        qrPayload: 'MT:Y.K9042C00KA0648G00',
        room: 'Wohnzimmer',
        bogus: 'x',
      },
      tags: ['Smart Home', '#licht'],
    });
    expect(created.fields).toEqual({
      setupCode: '34970112332',
      qrPayload: 'MT:Y.K9042C00KA0648G00',
      room: 'Wohnzimmer',
    });
    expect(created.tags).toEqual(['smart-home', 'licht']);
    const [row] = await ctx.db.select().from(notes).where(eq(notes.id, created.id));
    expect(row!.payload).not.toContain('Wohnzimmer');
  });

  it('lists, reads and updates notes', async () => {
    const n = await admin.client.createNote({ type: 'note', title: 'Einkauf', content: 'Milch' });
    const updated = await admin.client.updateNote(n.id, { content: 'Milch, Brot' });
    expect(updated).toMatchObject({ title: 'Einkauf', content: 'Milch, Brot' });
    const pinned = await admin.client.updateNote(n.id, { pinned: true });
    expect(pinned.pinned).toBe(true);
    expect((await admin.client.notes())[0]!.id).toBe(n.id);
  });

  it('moves notes to the trash, restores and deletes them', async () => {
    const n = await admin.client.createNote({ type: 'secret', title: 'Weg damit', fields: { value: '1' } });
    await admin.http.delete(`/api/notes/${n.id}`);
    expect((await admin.client.notes('trash')).map((x) => x.id)).toContain(n.id);
    await admin.http.post(`/api/notes/${n.id}/restore`);
    expect((await admin.client.notes()).map((x) => x.id)).toContain(n.id);
    await admin.http.delete(`/api/notes/${n.id}?permanent=true`);
    expect((await admin.http.get(`/api/notes/${n.id}`)).status).toBe(404);
  });

  it('only accepts ciphertext', async () => {
    const res = await admin.http.post('/api/notes', {
      id: crypto.randomUUID(),
      type: 'note',
      payload: 'this is plain text, not an envelope!!!!!!!!',
    });
    expect(res.status).toBe(400);
  });

  it('computes metadata statistics', async () => {
    const stats = (await admin.http.get('/api/stats?days=7')).body;
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.byType.matter).toBe(1);
    expect(stats).not.toHaveProperty('topTags');
    expect(stats.security.hasRecoveryKey).toBe(true);
  });
});

describe('export & import', () => {
  it('exports JSON in the browser and imports it into another account', async () => {
    const { json, count } = await admin.client.exportJson();
    expect(count).toBeGreaterThan(0);
    const doc = JSON.parse(json);
    expect(doc.format).toBe('tresor-export');
    expect(doc.notes.find((n: { title: string }) => n.title === 'Bank Geheimtitel').attachments[0].name).toBe(
      'kontoauszug-geheim.txt',
    );

    const backup = await encryptBackup(json, 'backup-passphrase', {
      memoryKiB: 8192,
      iterations: 1,
      parallelism: 1,
    });
    await expect(decryptBackup(backup, 'wrong-passphrase')).rejects.toThrow();
    const restored = await decryptBackup(backup, 'backup-passphrase');

    await admin.http.post('/api/admin/users', {
      username: 'importer',
      displayName: 'I',
      password: 'temporary-123',
    });
    const imp = new Browser(ctx.app);
    await imp.client.login({ username: 'importer', password: 'temporary-123' });
    await imp.client.changePassword({ currentPassword: 'temporary-123', newPassword: 'importer-password' });
    const result = await imp.client.importJson(restored);
    expect(result).toEqual({ imported: count, skipped: 0 });
    const imported = await imp.client.notes();
    const bank = imported.find((n) => n.title === 'Bank Geheimtitel')!;
    expect(bank.fields.password).toBe('Pa55w0rd-Geheim');
    const file = await imp.client.downloadAttachment(bank.id, bank.attachments[0]!);
    expect(new TextDecoder().decode(file)).toBe('Kontostand: 1.234.567 EUR');
  });
});

describe('multi-user & admin', () => {
  let anna: Browser;
  let annaId: string;

  it('creates accounts without keys; the user creates them with their own password', async () => {
    const created = await admin.http.post('/api/admin/users', {
      username: 'anna',
      displayName: 'Anna',
      password: 'temporary-pass-1',
    });
    expect(created.status).toBe(201);
    annaId = created.body.user.id;
    const [row] = await ctx.db.select().from(users).where(eq(users.id, annaId));
    expect(row!.dekWrapped).toBeNull();

    anna = new Browser(ctx.app);
    const login = await anna.client.login({ username: 'anna', password: 'temporary-pass-1' });
    expect(login.keys).toBeNull();
    expect(login.user.mustChangePassword).toBe(true);
    expect((await anna.http.get('/api/notes')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await anna.client.changePassword({
      currentPassword: 'temporary-pass-1',
      newPassword: 'annas-password-1',
    });
    expect(changed.recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}/);
    expect(changed.user).toMatchObject({ mustChangePassword: false, hasKeys: true });
    const n = await anna.client.createNote({ type: 'note', title: 'Annas Notiz' });
    expect(n.title).toBe('Annas Notiz');
  });

  it('isolates notes between users', async () => {
    const mine = await anna.client.createNote({ type: 'note', title: 'Privat' });
    expect((await admin.http.get(`/api/notes/${mine.id}`)).status).toBe(404);
    expect((await admin.client.notes()).map((n) => n.title)).not.toContain('Privat');
  });

  it('protects admin endpoints', async () => {
    expect((await anna.http.get('/api/admin/users')).status).toBe(403);
    expect((await anna.http.get('/api/admin/stats')).status).toBe(403);
    const stats = await admin.http.get('/api/admin/stats');
    expect(stats.body.users.total).toBeGreaterThanOrEqual(2);
  });

  it('prevents removing the last admin', async () => {
    const me = (await admin.http.get('/api/auth/me')).body.user;
    expect((await admin.http.patch(`/api/admin/users/${me.id}`, { role: 'user' })).status).toBe(400);
  });

  it('recovers an account with the recovery key and rotates it', async () => {
    const c = new Browser(ctx.app);
    const bad = await c.client
      .recover({
        username: 'leif',
        recoveryKey: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH',
        newPassword: 'x-new-password',
      })
      .catch((e) => e);
    expect(bad.code).toBe('INVALID_RECOVERY_KEY');
    const unknown = await c.client
      .recover({ username: 'nobody', recoveryKey: adminRecoveryKey, newPassword: 'x-new-password' })
      .catch((e) => e);
    expect(unknown.code).toBe('INVALID_RECOVERY_KEY');

    const res = await c.client.recover({
      username: 'leif',
      recoveryKey: adminRecoveryKey,
      newPassword: 'new-admin-password',
    });
    expect(res.recoveryKey).not.toBe(adminRecoveryKey);
    expect((await c.client.notes()).map((n) => n.title)).toContain('Wohnzimmerlampe');
    // the old key is gone, the new one works
    const again = await new Browser(ctx.app).client
      .recover({ username: 'leif', recoveryKey: adminRecoveryKey, newPassword: 'whatever-123' })
      .catch((e) => e);
    expect(again.code).toBe('INVALID_RECOVERY_KEY');
    adminRecoveryKey = res.recoveryKey;
    admin = c;
  });

  it('resets a user who lost everything (notes are wiped, keys removed)', async () => {
    const res = await admin.http.post(`/api/admin/users/${annaId}/reset`, { password: 'fresh-temp-pass' });
    expect(res.status).toBe(200);
    expect(res.body.deletedNotes).toBe(2);
    const c = new Browser(ctx.app);
    const login = await c.client.login({ username: 'anna', password: 'fresh-temp-pass' });
    expect(login.keys).toBeNull();
    expect(login.user.mustChangePassword).toBe(true);
  });

  it('disables and deletes users', async () => {
    await admin.http.patch(`/api/admin/users/${annaId}`, { disabled: true });
    const res = await new Browser(ctx.app).client
      .login({ username: 'anna', password: 'fresh-temp-pass' })
      .catch((e) => e);
    expect(res.code).toBe('ACCOUNT_DISABLED');
    expect((await admin.http.delete(`/api/admin/users/${annaId}`)).status).toBe(200);
  });
});

describe('two-factor authentication', () => {
  it('enables TOTP, requires it at login and rejects replays', async () => {
    const authKey = await admin.client.authKeyFor('new-admin-password');
    expect((await admin.http.post('/api/account/totp/setup', { authKey: 'b'.repeat(43) })).status).toBe(401);
    const setup = await admin.http.post('/api/account/totp/setup', { authKey });
    expect(setup.body.uri).toContain('otpauth://totp/Tresor:leif');
    const totp = new TOTP({ secret: Secret.fromBase32(setup.body.secret), digits: 6, period: 30 });
    expect((await admin.http.post('/api/account/totp/enable', { code: '000000' })).status).toBe(400);
    const enabled = await admin.http.post('/api/account/totp/enable', { code: totp.generate() });
    expect(enabled.body.user.totpEnabled).toBe(true);
    const [row] = await ctx.db.select().from(users).where(eq(users.username, 'leif'));
    expect(row!.totpSecretEnc).not.toContain(setup.body.secret);

    const c = new Browser(ctx.app);
    const step1 = await c.client.login({ username: 'leif', password: 'new-admin-password' }).catch((e) => e);
    expect(step1.code).toBe('TOTP_REQUIRED');
    const replay = await c.client
      .login({ username: 'leif', password: 'new-admin-password', totp: totp.generate() })
      .catch((e) => e);
    expect(replay.code).toBe('TOTP_INVALID');
    const next = totp.generate({ timestamp: Date.now() + 30_000 });
    const ok = await c.client.login({ username: 'leif', password: 'new-admin-password', totp: next });
    expect(ok.user.totpEnabled).toBe(true);
    expect(c.client.unlocked).toBe(true);
  });

  it('recovery disables 2FA', async () => {
    const c = new Browser(ctx.app);
    const res = await c.client.recover({
      username: 'leif',
      recoveryKey: adminRecoveryKey,
      newPassword: 'final-admin-password',
    });
    expect(res.user.totpEnabled).toBe(false);
    admin = c;
  });
});

describe('sessions', () => {
  it('lists and revokes sessions, logout clears the cookie', async () => {
    const c = new Browser(ctx.app);
    await c.client.login({ username: 'leif', password: 'final-admin-password' });
    const c2 = new Browser(ctx.app);
    await c2.client.login({ username: 'leif', password: 'final-admin-password' });
    const list = await c.http.get('/api/account/sessions');
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const revoked = await c.http.delete('/api/account/sessions/others');
    expect(revoked.body.revoked).toBeGreaterThanOrEqual(1);
    expect((await c2.http.get('/api/auth/me')).status).toBe(401);
    await c.http.post('/api/auth/logout');
    expect(c.http.cookie).toBeUndefined();
  });
});

describe('downgrade protection', () => {
  it('refuses weak key derivation parameters handed out by the server', async () => {
    const { TresorClient } = await import('@tresor/shared/client');
    const http = new TestClient(ctx.app);
    const seen: string[] = [];
    const original = http.request.bind(http);
    http.request = (async (method, url, body, headers) => {
      seen.push(url);
      return original(method, url, body, headers);
    }) as typeof http.request;
    // Default floor (19 MiB, 2 passes) vs. the test server's cheap parameters.
    const client = new TresorClient(http.transport());
    const res = await client.login({ username: 'leif', password: 'final-admin-password' }).catch((e) => e);
    expect(res.code).toBe('WEAK_KDF');
    expect(seen).not.toContain('/api/auth/login'); // nothing derived from the password was sent
  });
});
