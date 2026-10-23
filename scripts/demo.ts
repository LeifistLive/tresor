// Starts a self-contained Tresor demo: embedded PGlite database in data/demo, realistic sample data, no Docker.
// The sample data is created through the same zero-knowledge client the web app uses (encrypted locally).
//
//   npm run build && npm run demo        → http://localhost:8080
//   npm run demo -- --reset              → wipe the demo data and seed it again
//
// DEMO_PORT (default 8080) and DEMO_HOST (default 127.0.0.1, use 0.0.0.0 for other devices in the LAN) override
// the listen address. Everything here is for local testing only – never reuse the keys or passwords below.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { ApiError, type Transport, TresorClient } from '@tresor/shared/client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEMO_PORT ?? 8080);
const HOST = process.env.DEMO_HOST ?? '127.0.0.1';
const DATA_DIR = resolve(root, 'data/demo');
const DB_DIR = resolve(DATA_DIR, 'db');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = `${ORIGIN}/api`;

/** Demo accounts (local testing only). `ben` keeps his temporary password to show the forced change. */
const ACCOUNTS = {
  demo: { username: 'demo', displayName: 'Demo Admin', password: 'tresor-demo-2026' },
  anna: { username: 'anna', displayName: 'Anna', temporary: 'anna-start-2026', password: 'anna-demo-2026' },
  ben: { username: 'ben', displayName: 'Ben', temporary: 'ben-start-2026' },
  gast: { username: 'gast', displayName: 'Gast', temporary: 'gast-start-2026' },
};

const SERVER_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: `pglite:${DB_DIR}`,
  VAULT_MASTER_KEY: 'demo-only-master-key-never-use-in-production-0000',
  PORT: String(PORT),
  HOST,
  COOKIE_SECURE: 'false',
  WEB_DIST: resolve(root, 'apps/web/dist'),
  MIGRATIONS_DIR: resolve(root, 'apps/server/drizzle'),
  LOGIN_RATE_LIMIT: '200',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
};

// --- Server process -------------------------------------------------------------------------------

function startServer() {
  const child = spawn(process.execPath, [resolve(root, 'apps/server/dist/index.js')], {
    env: { ...process.env, ...SERVER_ENV },
    stdio: 'inherit',
  });
  const exited = new Promise((done) => child.once('exit', done));
  return { child, exited };
}

async function waitForHealth(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become healthy in time');
}

async function stopServer({ child, exited }) {
  child.kill('SIGTERM');
  await exited;
}

// --- API client with a cookie jar -----------------------------------------------------------------

class Client {
  cookie = '';

  async call(method, path, body) {
    const headers = { 'x-tresor-csrf': '1', origin: ORIGIN };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(API + path, { method, headers, body: payload });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      if (pair.startsWith('tresor_session=')) this.cookie = pair;
    }
    const text = await res.text();
    if (!res.ok) {
      const code = (() => {
        try {
          return JSON.parse(text).error.code;
        } catch {
          return 'INTERNAL';
        }
      })();
      throw new ApiError(res.status, code, `${method} ${path} → ${res.status} ${text}`);
    }
    return text ? JSON.parse(text) : null;
  }

  /** Transport for the zero-knowledge client, sharing this cookie jar. */
  transport(): Transport {
    return {
      json: (method, path, body) => this.call(method, path, body),
      bytes: async (path) => {
        const res = await fetch(API + path, { headers: { cookie: this.cookie } });
        if (!res.ok) throw new ApiError(res.status, 'INTERNAL', `GET ${path} → ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      upload: (method, path, form) => {
        const data = new FormData();
        for (const [k, v] of Object.entries(form.fields)) data.append(k, v);
        data.append('file', new Blob([form.file.data as Uint8Array<ArrayBuffer>]), form.file.name);
        return this.call(method, path, data);
      },
    };
  }

  get = (p) => this.call('GET', p);
  post = (p, b) => this.call('POST', p, b);
  patch = (p, b) => this.call('PATCH', p, b);
  del = (p) => this.call('DELETE', p);

  async tryLogin(username, password) {
    try {
      await this.post('/auth/login', { username, password });
    } catch {
      // expected for the failed-attempt samples
    }
  }
}

// --- Sample files ---------------------------------------------------------------------------------

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** A small "type plate" picture: graphite card with a lime frame and a fake 2D code. */
function samplePng() {
  const w = 360;
  const h = 200;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const border = x < 6 || y < 6 || x >= w - 6 || y >= h - 6;
      const inCode = x >= 230 && x < 330 && y >= 50 && y < 150;
      const cell = inCode && (Math.floor((x - 230) / 10) * 7 + Math.floor((y - 50) / 10) * 3) % 5 < 2;
      const line = x >= 30 && x < 190 && [60, 90, 120].some((l) => y >= l && y < l + 8);
      const [r, g, b] = border ? [197, 240, 74] : cell || line ? [230, 232, 235] : [24, 26, 30];
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF with a few lines of text. */
function samplePdf(lines) {
  const text = lines
    .map(
      (l, i) =>
        `BT /F1 ${i === 0 ? 18 : 12} Tf 60 ${760 - i * 26} Td (${l.replace(/[()\\]/g, '\\$&')}) Tj ET`,
    )
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// --- Sample data ----------------------------------------------------------------------------------

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const cardExpiry = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};

const WELCOME = `Diese Instanz ist mit Beispieldaten gefüllt. Ein paar Dinge zum Ausprobieren:

- [ ] **⌘K / Strg+K** öffnet die Befehlspalette – tippe „Matter“ oder „WLAN“
- [ ] **Smart Home** in der Seitenleiste: Geräte nach Raum, Etiketten und Gästekarte drucken
- [ ] **QR scannen** (Symbol oben in der Leiste): Matter-, WLAN- oder 2FA-Code vor die Kamera halten oder ein Foto wählen
- [ ] Eintrag **Nextcloud** öffnen: der 2FA-Code läuft live mit
- [ ] **WLAN Zuhause → Verlauf**: das alte Passwort wiederherstellen
- [ ] **Dashboard**: Passwort-Gesundheit (schwach, mehrfach, alt) und bald ablaufende Einträge
- [ ] **Freigaben**: Tresor „Familie“ (du bist Besitzer) und „Garten“ (Anna hat dich mit *Nur lesen* eingeladen)
- [ ] **Notfallzugriff**: Anna hat Zugriff auf deinen Tresor angefordert – genehmigen oder ablehnen
- [ ] **Einstellungen → Sicherheit**: Passkey mit Touch ID anlegen, danach abmelden und per Passkey entsperren
- [ ] **Admin**: Benutzer, Anmelde-Statistik, Audit-Log – Ben muss sein Passwort bei der ersten Anmeldung ändern
- [ ] **Export**: verschlüsseltes \`.tresor\`-Backup erstellen und wieder importieren

> Alles hier ist Demo-Material. Die Zugangsdaten stehen in \`scripts/demo.ts\`.`;

/**
 * Entries of the demo admin. `age` = days since creation, `touched` = days since the last change –
 * applied directly in the database after seeding so charts and password health have some history.
 */
function demoEntries(vaults) {
  return [
    {
      age: 60,
      touched: 0,
      input: {
        type: 'note',
        title: 'Willkommen in der Demo',
        content: WELCOME,
        tags: ['demo'],
        pinned: true,
      },
    },
    {
      age: 42,
      touched: 42,
      input: {
        type: 'matter',
        title: 'Steckdose Kaffeemaschine',
        fields: {
          setupCode: '11164621185',
          qrPayload: 'MT:-AM14O.R02MGPW2XR00',
          manufacturer: 'Eve Systems',
          model: 'Eve Energy',
          room: 'Küche',
          network: 'thread',
        },
        tags: ['smart-home'],
      },
    },
    {
      age: 35,
      touched: 30,
      input: {
        type: 'matter',
        title: 'Türsensor Haustür',
        fields: {
          setupCode: '23725030712',
          qrPayload: 'MT:CUSJ0-4F15YQQ45F210',
          manufacturer: 'Aqara',
          model: 'Door and Window Sensor P2',
          room: 'Flur',
          network: 'thread',
        },
        content: 'Batterie (CR123A) zuletzt im Frühjahr getauscht.',
        tags: ['smart-home', 'sicherheit'],
      },
    },
    {
      age: 21,
      touched: 21,
      input: {
        type: 'matter',
        title: 'Stehlampe Wohnzimmer',
        fields: {
          setupCode: '31173341657',
          qrPayload: 'MT:K6KT18DB00VRDY6UG10',
          manufacturer: 'Nanoleaf',
          model: 'Essentials A19',
          room: 'Wohnzimmer',
          network: 'thread',
        },
        customFields: [{ label: 'Firmware', value: '3.5.10', secret: false }],
        tags: ['smart-home', 'licht'],
      },
    },
    {
      key: 'hue',
      age: 58,
      touched: 12,
      input: {
        type: 'matter',
        title: 'Hue Bridge',
        fields: {
          setupCode: '16201713380',
          qrPayload: 'MT:QV5A0SC1126R163NH00',
          manufacturer: 'Philips Hue',
          model: 'Bridge v2',
          room: 'Technikraum',
          network: 'ethernet',
        },
        customFields: [{ label: 'IP-Adresse', value: '192.168.178.40', secret: false }],
        content: 'Foto vom Typenschild hängt an.',
        tags: ['smart-home', 'licht'],
      },
    },
    {
      age: 18,
      touched: 18,
      input: {
        type: 'matter',
        title: 'IKEA Dirigera Hub',
        vaultId: vaults.familie,
        fields: {
          setupCode: '06254628797',
          qrPayload: 'MT:K4X01K0V01ZHWB7X.00',
          manufacturer: 'IKEA',
          model: 'Dirigera',
          room: 'Wohnzimmer',
          network: 'ethernet',
        },
        tags: ['smart-home'],
      },
    },
    {
      key: 'fritz',
      age: 520,
      touched: 430,
      input: {
        type: 'login',
        title: 'FRITZ!Box',
        fields: { username: 'admin', password: 'admin123', url: 'http://fritz.box' },
        content: 'Werkseinstellung nie geändert – sollte dringend erneuert werden.',
        tags: ['netzwerk'],
      },
    },
    {
      age: 40,
      touched: 40,
      input: {
        type: 'login',
        title: 'Home Assistant',
        fields: { username: 'demo', password: 'Sonnenblume!2024', url: 'http://homeassistant.local:8123' },
        tags: ['smart-home', 'homelab'],
      },
    },
    {
      age: 38,
      touched: 9,
      input: {
        type: 'login',
        title: 'Nextcloud',
        fields: {
          username: 'demo',
          password: 'Sonnenblume!2024',
          url: 'https://cloud.example.home',
          totp: 'otpauth://totp/Nextcloud:demo?secret=JBSWY3DPEHPK3PXP&issuer=Nextcloud',
        },
        tags: ['homelab'],
      },
    },
    {
      age: 27,
      touched: 6,
      input: {
        type: 'login',
        title: 'Proxmox VE',
        fields: {
          username: 'root@pam',
          password: 'kX7#vR2q!mZp9Lw$eT4u',
          url: 'https://192.168.178.10:8006',
        },
        customFields: [
          { label: 'IP-Adresse', value: '192.168.178.10', secret: false },
          { label: 'SSH-Port', value: '22', secret: false },
          {
            label: 'API-Token',
            value: 'PVEAPIToken=root@pam!demo=3f9c1e2a-7b4d-4e8f-9a6c-1d2e3f4a5b6c',
            secret: true,
          },
        ],
        tags: ['homelab', 'server'],
      },
    },
    {
      age: 5,
      touched: 5,
      input: {
        type: 'login',
        title: 'GitHub',
        fields: {
          username: 'demo-user',
          password: 'f8Q!rL2#pW9z^Nc6Tb1y',
          url: 'https://github.com',
          totp: 'KRSXG5CTMVRXEZLU',
        },
        tags: ['dev'],
      },
    },
    {
      key: 'wifi',
      age: 55,
      touched: 3,
      input: {
        type: 'wifi',
        title: 'WLAN Zuhause',
        fields: { ssid: 'Zuhause-5G', password: 'Lichtschalter-Kompass-42', security: 'WPA' },
        tags: ['netzwerk'],
        pinned: true,
      },
      updates: [{ fields: { ssid: 'Zuhause-5G', password: 'Regenbogen-Waschbär-77', security: 'WPA' } }],
    },
    {
      age: 50,
      touched: 50,
      input: {
        type: 'wifi',
        title: 'Gäste-WLAN',
        vaultId: vaults.familie,
        fields: { ssid: 'Zuhause-Gast', password: 'Willkommen-2026', security: 'WPA' },
        content: 'Für Besuch – Gästekarte unter Smart Home → Drucken.',
        tags: ['netzwerk', 'gäste'],
      },
    },
    {
      age: 31,
      touched: 31,
      input: {
        type: 'card',
        title: 'Kreditkarte',
        fields: {
          holder: 'Demo Admin',
          number: '4242 4242 4242 4242',
          expiry: cardExpiry(14),
          cvc: '123',
          pin: '0000',
        },
        content: 'Testkartennummer – keine echte Karte.',
        expiresAt: day(14),
        tags: ['finanzen'],
      },
    },
    {
      age: 29,
      touched: 29,
      input: {
        type: 'card',
        title: 'Bibliotheksausweis',
        fields: { holder: 'Demo Admin', number: '0815 4711 2342', pin: '4711' },
        expiresAt: day(160),
      },
    },
    {
      age: 48,
      touched: 48,
      input: {
        type: 'secret',
        title: 'Alarmanlage',
        vaultId: vaults.familie,
        fields: { value: 'Scharf: 2580 #\nUnscharf: 2580 *' },
        tags: ['sicherheit'],
        pinned: true,
      },
    },
    {
      age: 46,
      touched: 46,
      input: {
        type: 'secret',
        title: 'Restic-Backup-Passwort',
        fields: { value: 'correct-horse-battery-staple-tresor-demo' },
        content: 'Repository: `sftp:backup@nas.local:/restic/homelab`',
        tags: ['backup', 'homelab'],
      },
    },
    {
      age: 24,
      touched: 24,
      input: {
        type: 'secret',
        title: 'Home Assistant – Long-Lived Token',
        fields: { value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ZGVtby10b2tlbg.dGhpcy1pcy1ub3QtcmVhbA' },
        tags: ['smart-home', 'homelab'],
      },
    },
    {
      age: 120,
      touched: 11,
      input: {
        type: 'secret',
        title: 'Domain example.home',
        fields: { value: 'Auth-Code: 7Hk#2pQ9-xLm4' },
        content: 'Läuft bald aus – rechtzeitig verlängern.',
        expiresAt: day(25),
        tags: ['homelab'],
      },
    },
    {
      key: 'heizung',
      age: 33,
      touched: 8,
      input: {
        type: 'note',
        title: 'Heizung – Wartung',
        content: `## Gastherme

| | |
|---|---|
| Modell | Vaillant ecoTEC plus |
| Letzte Wartung | vor 11 Monaten |
| Techniker | Fa. Beispiel, 0123 456789 |

- [x] Filter geprüft
- [x] Druck auf 1,5 bar
- [ ] Termin für die nächste Wartung vereinbaren

Rechnung hängt als PDF an.`,
        expiresAt: day(40),
        tags: ['haus'],
      },
      updates: [{ content: 'Wird gleich ergänzt …' }],
    },
    {
      age: 26,
      touched: 1,
      input: {
        type: 'note',
        title: 'Zählerstände',
        content: `| Datum | Strom (kWh) | Gas (m³) | Wasser (m³) |
|---|---:|---:|---:|
| 01.07. | 18 412 | 6 210 | 812 |
| 01.08. | 18 655 | 6 228 | 821 |
| 01.09. | 18 891 | 6 249 | 830 |
| 01.10. | 19 140 | 6 301 | 838 |`,
        tags: ['haus'],
      },
    },
    {
      age: 2,
      touched: 1,
      input: {
        type: 'note',
        title: 'Netzwerkplan',
        content: `\`\`\`
192.168.178.1    FRITZ!Box
192.168.178.10   Proxmox VE
192.168.178.20   NAS (Unraid)
192.168.178.30   Home Assistant
192.168.178.40   Hue Bridge
\`\`\`

VLAN 20 = IoT, VLAN 30 = Gäste.`,
        tags: ['netzwerk', 'homelab'],
      },
    },
    {
      key: 'trash',
      age: 70,
      touched: 65,
      input: { type: 'note', title: 'Alte Router-Notizen', content: 'Vom Speedport – nicht mehr relevant.' },
    },
  ];
}

async function seed() {
  const demo = new Client();
  const anna = new Client();
  const demoVault = new TresorClient(demo.transport());
  const annaVault = new TresorClient(anna.transport());
  const info: Record<string, string> = {};

  const setup = await demoVault.setup({ ...ACCOUNTS.demo, language: 'de' });
  info.demoRecoveryKey = setup.recoveryKey;

  const created: Record<string, string> = {};
  for (const key of ['anna', 'ben', 'gast']) {
    const a = ACCOUNTS[key];
    const res = await demo.post('/admin/users', {
      username: a.username,
      displayName: a.displayName,
      role: 'user',
      password: a.temporary,
    });
    created[key] = res.user.id;
  }
  await demo.patch(`/admin/users/${created.gast}`, { disabled: true });

  await annaVault.login({ username: 'anna', password: ACCOUNTS.anna.temporary });
  const changed = await annaVault.changePassword({
    currentPassword: ACCOUNTS.anna.temporary,
    newPassword: ACCOUNTS.anna.password,
  });
  info.annaRecoveryKey = changed.recoveryKey ?? '';

  // A few failed attempts for the admin statistics.
  const stranger = new Client();
  const strangerVault = new TresorClient(stranger.transport());
  await strangerVault.login({ username: 'demo', password: 'falsches-passwort' }).catch(() => {});
  await strangerVault.login({ username: 'admin', password: 'admin-admin' }).catch(() => {});

  // Templates
  await demoVault.saveTemplate({
    name: 'Matter-Steckdose',
    type: 'matter',
    fields: { manufacturer: 'Eve Systems', model: 'Eve Energy', network: 'thread' },
    tags: ['smart-home'],
  });
  await demoVault.saveTemplate({
    name: 'Server-Zugang',
    type: 'login',
    customFields: [
      { label: 'IP-Adresse', value: '', secret: false },
      { label: 'SSH-Port', value: '22', secret: false },
    ],
    tags: ['homelab', 'server'],
  });

  // Shared vaults: "Familie" (demo owns, Anna edits) and "Garten" (Anna owns, demo reads).
  const familie = (await demoVault.createVault('Familie')).id;
  await demoVault.addMember(familie, 'anna', 'editor');
  const garten = (await annaVault.createVault('Garten')).id;
  await annaVault.addMember(garten, 'demo', 'viewer');

  const timeline: { id: string; age: number; touched: number }[] = [];
  const ids: Record<string, string> = {};
  for (const entry of demoEntries({ familie })) {
    const note = await demoVault.createNote(entry.input);
    for (const update of entry.updates ?? []) await demoVault.updateNote(note.id, update);
    if (entry.key === 'heizung') await demoVault.updateNote(note.id, { content: entry.input.content });
    if (entry.key) ids[entry.key] = note.id;
    timeline.push({ id: note.id, age: entry.age, touched: entry.touched });
  }
  await demoVault.uploadAttachment(ids.hue, {
    name: 'Typenschild.png',
    mime: 'image/png',
    data: samplePng(),
  });
  await demoVault.uploadAttachment(ids.heizung, {
    name: 'Rechnung-Heizungswartung.pdf',
    mime: 'application/pdf',
    data: samplePdf([
      'Rechnung Nr. 2026-0815 (Demo)',
      'Heizungswartung Gastherme',
      'Arbeitszeit 1,5 h ........ 127,50 EUR',
      'Material .................. 18,90 EUR',
      'Summe inkl. MwSt. ........ 146,40 EUR',
    ]),
  });
  await demo.del(`/notes/${ids.trash}`);

  // Anna's entries: one in "Familie", some in "Garten", a few personal ones.
  const annaEntries = [
    {
      age: 12,
      touched: 2,
      input: {
        type: 'secret',
        title: 'Garagentor',
        vaultId: familie,
        fields: { value: 'Code: 1357' },
        tags: ['haus'],
      },
    },
    {
      age: 30,
      touched: 30,
      input: {
        type: 'wifi',
        title: 'WLAN Gartenhaus',
        vaultId: garten,
        fields: { ssid: 'Garten-IoT', password: 'Tomaten-Gießkanne-19', security: 'WPA' },
        tags: ['netzwerk'],
      },
    },
    {
      age: 30,
      touched: 30,
      input: {
        type: 'secret',
        title: 'Schuppen-Schloss',
        vaultId: garten,
        fields: { value: '0-4-2-7' },
      },
    },
    {
      age: 20,
      touched: 5,
      input: {
        type: 'note',
        title: 'Bewässerungsplan',
        vaultId: garten,
        content:
          '- Hochbeet: täglich 6:00, 10 min\n- Rasen: Mo/Do 5:30, 20 min\n- Tomaten: täglich 19:00, 5 min',
        tags: ['garten'],
      },
    },
    {
      age: 44,
      touched: 44,
      input: {
        type: 'login',
        title: 'Paperless-ngx',
        fields: { username: 'anna', password: 'Brief-Ordner-Stempel-8', url: 'http://paperless.local:8000' },
      },
    },
    {
      age: 9,
      touched: 9,
      input: { type: 'note', title: 'Geschenkideen', content: '- Kräuterset\n- Gartenschere' },
    },
  ];
  for (const entry of annaEntries) {
    const note = await annaVault.createNote(entry.input);
    timeline.push({ id: note.id, age: entry.age, touched: entry.touched });
  }

  // Emergency access both ways; Anna has requested access to the demo vault (waiting for a decision).
  await demoVault.grantEmergency('anna', 7, ACCOUNTS.demo.password);
  await annaVault.grantEmergency('demo', 3, ACCOUNTS.anna.password);
  const { received } = await anna.get('/emergency');
  await anna.post(`/emergency/${received[0].id}/request`);

  await demo.post('/auth/logout');
  await anna.post('/auth/logout');
  return {
    info,
    timeline,
    users: { demo: setup.user.id, anna: created.anna, ben: created.ben, gast: created.gast },
  };
}

/** Spreads timestamps over the past weeks so charts, "old password" and the version history look lived-in. */
async function backdate({ timeline, users }) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(DB_DIR);
  try {
    for (const { id, age, touched } of timeline) {
      await db.query(
        `UPDATE notes SET created_at = now() - make_interval(days => $2::int) - make_interval(hours => (random() * 10)::int),
                          updated_at = now() - make_interval(days => $3::int) - make_interval(mins => (random() * 600)::int)
          WHERE id = $1`,
        [id, age, touched],
      );
    }
    await db.exec(`
      UPDATE notes SET updated_at = created_at WHERE updated_at < created_at;
      UPDATE notes SET deleted_at = now() - interval '2 days' WHERE deleted_at IS NOT NULL;
      UPDATE attachments a SET created_at = n.updated_at FROM notes n WHERE n.id = a.note_id;
      WITH r AS (
        SELECT v.id, n.created_at AS c, n.updated_at AS u,
               row_number() OVER (PARTITION BY v.note_id ORDER BY v.saved_at) AS rn,
               count(*) OVER (PARTITION BY v.note_id) AS cnt
          FROM note_versions v JOIN notes n ON n.id = v.note_id)
      UPDATE note_versions SET saved_at = r.c + (r.u - r.c) * (r.rn::float / (r.cnt + 1)) FROM r WHERE note_versions.id = r.id;
      UPDATE audit_log a SET created_at = n.created_at FROM notes n WHERE a.target = n.id::text AND a.action = 'note.create';
      UPDATE audit_log a SET created_at = n.updated_at FROM notes n
        WHERE a.target = n.id::text AND a.action = 'note.update';
      UPDATE audit_log a SET created_at = n.deleted_at FROM notes n WHERE a.target = n.id::text AND a.action = 'note.trash';
    `);
    await db.query(
      `UPDATE users SET created_at = now() - interval '60 days', password_changed_at = now() - interval '60 days' WHERE id = $1`,
      [users.demo],
    );
    await db.query(`UPDATE users SET created_at = now() - interval '45 days' WHERE id = $1`, [users.anna]);
    await db.query(`UPDATE users SET created_at = now() - interval '3 days' WHERE id IN ($1, $2)`, [
      users.ben,
      users.gast,
    ]);
    // Sign-in history for the admin statistics (two weeks, a handful per day, some failures).
    await db.query(
      `INSERT INTO audit_log (user_id, actor, action, ip, created_at)
       SELECT u.id, u.username, 'auth.login', '192.168.178.' || (20 + (random() * 30)::int),
              now() - make_interval(days => d) - make_interval(mins => (random() * 900)::int)
         FROM generate_series(1, 13) AS d
         CROSS JOIN LATERAL generate_series(1, 1 + (d * 7) % 4) AS n
         JOIN users u ON u.id = CASE WHEN n % 2 = 0 THEN $2::uuid ELSE $1::uuid END`,
      [users.demo, users.anna],
    );
    await db.query(
      `INSERT INTO audit_log (actor, action, ip, meta, created_at)
       SELECT 'admin', 'auth.login_failed', '203.0.113.' || (10 + d), '{"reason":"unknown_user"}'::jsonb,
              now() - make_interval(days => d) - make_interval(mins => (random() * 600)::int)
         FROM generate_series(2, 11, 3) AS d`,
    );
  } finally {
    await db.close();
  }
}

// --- Main -----------------------------------------------------------------------------------------

async function main() {
  for (const p of ['apps/server/dist/index.js', 'apps/web/dist/index.html']) {
    if (!existsSync(resolve(root, p))) {
      console.error(`Missing ${p} – run "npm run build" first.`);
      process.exit(1);
    }
  }
  const occupied = await fetch(`${API}/health`).then(
    () => true,
    () => false,
  );
  if (occupied) {
    console.error(`Port ${PORT} is already in use – stop the other server or set DEMO_PORT.`);
    process.exit(1);
  }
  if (process.argv.includes('--reset')) rmSync(DATA_DIR, { recursive: true, force: true });
  const fresh = !existsSync(DB_DIR);
  mkdirSync(DATA_DIR, { recursive: true });

  if (fresh) {
    console.log('Seeding demo data …');
    const seeding = startServer();
    try {
      await waitForHealth();
      const result = await seed();
      await stopServer(seeding);
      await backdate(result);
      writeFileSync(
        resolve(DATA_DIR, 'recovery-keys.txt'),
        `Recovery keys of the demo accounts (for trying "Passwort vergessen?"):\n\ndemo: ${result.info.demoRecoveryKey}\nanna: ${result.info.annaRecoveryKey}\n`,
      );
    } catch (err) {
      seeding.child.kill('SIGTERM');
      await seeding.exited;
      rmSync(DATA_DIR, { recursive: true, force: true });
      throw err;
    }
  }

  const server = startServer();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.child.kill(signal));
  }
  await waitForHealth();
  const shown = HOST === '0.0.0.0' ? `http://<this-machine>:${PORT}` : `http://localhost:${PORT}`;
  console.log(`\nTresor demo running on ${shown}`);
  console.log('Accounts: see ACCOUNTS in scripts/demo.ts · recovery keys: data/demo/recovery-keys.txt\n');
  const code = await server.exited;
  process.exit(typeof code === 'number' ? code : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
