import {
  type NotificationConfigDto,
  type NotificationConfigInput,
  type NotifyEvent,
  notificationConfigSchema,
} from '@tresor/shared';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { SERVER_AAD } from '../crypto/keys.js';
import { type UserRow, users } from '../db/schema.js';
import { postOutbound } from '../lib/outbound.js';

type NotifyConfig = z.infer<typeof notificationConfigSchema>;

const ALERT_THROTTLE_MS = 15 * 60_000;

export function readNotifyConfig(app: FastifyInstance, user: UserRow): NotifyConfig | null {
  if (!user.notifyConfigEnc) return null;
  try {
    const json = app.keys.serverOpen(user.notifyConfigEnc, SERVER_AAD.notifyConfig(user.id)).toString('utf8');
    return notificationConfigSchema.parse(JSON.parse(json));
  } catch (err) {
    app.log.warn({ err, userId: user.id }, 'notification config unreadable');
    return null;
  }
}

export function notifyConfigDto(config: NotifyConfig | null): NotificationConfigDto {
  const c = config ?? notificationConfigSchema.parse({});
  return {
    enabled: c.enabled,
    provider: c.provider,
    url: c.url,
    topic: c.topic,
    hasToken: c.token !== '',
    events: c.events,
  };
}

/** Seals the config with the server key. An empty token keeps the previously stored token. */
export function sealNotifyConfig(
  app: FastifyInstance,
  user: UserRow,
  input: NotificationConfigInput,
): { sealed: string; config: NotifyConfig } {
  const next = notificationConfigSchema.parse(input);
  if (next.token === '') next.token = readNotifyConfig(app, user)?.token ?? '';
  return {
    sealed: app.keys.serverSeal(JSON.stringify(next), SERVER_AAD.notifyConfig(user.id)),
    config: next,
  };
}

// --- Messages ------------------------------------------------------------------------------------

type MessageKey =
  | 'newLogin'
  | 'failedLogin'
  | 'adminFailedLogin'
  | 'emergencyRequested'
  | 'emergencyGranted'
  | 'emergencyRejected'
  | 'reminders'
  | 'test';

const MESSAGES: Record<
  'de' | 'en',
  Record<MessageKey, (p: Record<string, string | number>) => [string, string]>
> = {
  de: {
    newLogin: (p) => [
      'Neue Anmeldung bei Tresor',
      `Konto @${p.user} · ${p.method} · ${p.device} · IP ${p.ip}`,
    ],
    failedLogin: (p) => [
      'Fehlgeschlagene Anmeldung',
      `Für dein Konto @${p.user} gab es einen fehlgeschlagenen Anmeldeversuch von IP ${p.ip}.`,
    ],
    adminFailedLogin: (p) => ['Tresor: fehlgeschlagene Anmeldung', `Benutzer „${p.user}“ · IP ${p.ip}`],
    emergencyRequested: (p) => [
      'Notfallzugriff angefordert',
      `${p.grantee} hat Notfallzugriff auf deinen Tresor angefordert. Ohne Ablehnung wird er nach ${p.days} Tag(en) freigegeben.`,
    ],
    emergencyGranted: (p) => [
      'Notfallzugriff freigegeben',
      `Du hast jetzt Lesezugriff auf den Tresor von ${p.grantor}.`,
    ],
    emergencyRejected: (p) => ['Notfallzugriff abgelehnt', `${p.grantor} hat deine Anfrage abgelehnt.`],
    reminders: (p) => [
      'Einträge laufen bald ab',
      `${p.count} Eintrag/Einträge in deinem Tresor erreichen in den nächsten ${p.days} Tagen ihr Ablaufdatum.`,
    ],
    test: () => ['Tresor', 'Testnachricht – Benachrichtigungen funktionieren.'],
  },
  en: {
    newLogin: (p) => ['New sign-in to Tresor', `Account @${p.user} · ${p.method} · ${p.device} · IP ${p.ip}`],
    failedLogin: (p) => [
      'Failed sign-in',
      `There was a failed sign-in attempt for @${p.user} from IP ${p.ip}.`,
    ],
    adminFailedLogin: (p) => ['Tresor: failed sign-in', `User "${p.user}" · IP ${p.ip}`],
    emergencyRequested: (p) => [
      'Emergency access requested',
      `${p.grantee} requested emergency access to your vault. Unless you reject it, access opens in ${p.days} day(s).`,
    ],
    emergencyGranted: (p) => ['Emergency access granted', `You can now read the vault of ${p.grantor}.`],
    emergencyRejected: (p) => ['Emergency access rejected', `${p.grantor} rejected your request.`],
    reminders: (p) => [
      'Entries expiring soon',
      `${p.count} entr(y/ies) in your vault reach their expiry date within the next ${p.days} days.`,
    ],
    test: () => ['Tresor', 'Test message – notifications work.'],
  },
};

const METHODS: Record<'de' | 'en', Record<string, string>> = {
  de: { password: 'Passwort', passkey: 'Passkey', recovery: 'Wiederherstellungsschlüssel' },
  en: { password: 'password', passkey: 'passkey', recovery: 'recovery key' },
};

const EVENT_OF: Record<MessageKey, NotifyEvent | null> = {
  newLogin: 'newLogin',
  failedLogin: 'failedLogin',
  adminFailedLogin: 'adminAlerts',
  emergencyRequested: 'emergency',
  emergencyGranted: 'emergency',
  emergencyRejected: 'emergency',
  reminders: 'reminders',
  test: null,
};

// --- Delivery ------------------------------------------------------------------------------------

export async function deliver(
  config: NotifyConfig,
  title: string,
  message: string,
  priority: 'default' | 'high',
  allowPrivate: boolean,
) {
  const base = config.url.replace(/\/+$/, '');
  const opts = { allowPrivate };
  let status: number;
  if (config.provider === 'ntfy') {
    status = await postOutbound(
      `${base}/${encodeURIComponent(config.topic)}`,
      {
        Title: encodeURIComponent(title),
        Priority: priority === 'high' ? '4' : '3',
        Tags: 'lock',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      message,
      opts,
    );
  } else if (config.provider === 'gotify') {
    status = await postOutbound(
      `${base}/message`,
      { 'content-type': 'application/json', 'X-Gotify-Key': config.token },
      JSON.stringify({ title, message, priority: priority === 'high' ? 8 : 5 }),
      opts,
    );
  } else {
    status = await postOutbound(
      config.url,
      {
        'content-type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      JSON.stringify({ source: 'tresor', title, message, priority, sentAt: new Date().toISOString() }),
      opts,
    );
  }
  // Only the status class is reported (no redirects are followed, nothing else is echoed).
  if (status < 200 || status >= 300) {
    throw new Error(
      status >= 300 && status < 400
        ? 'Endpoint redirected (not followed)'
        : 'Endpoint answered with an error',
    );
  }
}

/**
 * Sends a localized notification to one user if they enabled the matching event.
 * Never throws – failures are logged.
 */
export async function notifyUser(
  app: FastifyInstance,
  user: UserRow,
  key: MessageKey,
  params: Record<string, string | number> = {},
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const config = readNotifyConfig(app, user);
  if (!config?.url) return false;
  const event = EVENT_OF[key];
  if (!opts.force && (!config.enabled || (event && !config.events[event]))) return false;
  const lang = user.language === 'en' ? 'en' : 'de';
  const method = typeof params.method === 'string' ? METHODS[lang][params.method] : undefined;
  const [title, message] = MESSAGES[lang][key](method ? { ...params, method } : params);
  const high = key === 'failedLogin' || key === 'adminFailedLogin' || key === 'emergencyRequested';
  try {
    await deliver(config, title, message, high ? 'high' : 'default', app.config.NOTIFY_ALLOW_PRIVATE);
    return true;
  } catch (err) {
    app.log.warn({ err: (err as Error).message, userId: user.id, key }, 'notification failed');
    if (opts.force) throw err;
    return false;
  }
}

/** Throttled security alert: at most one per user every 15 minutes. */
export async function alertFailedLogin(
  app: FastifyInstance,
  target: UserRow | undefined,
  username: string,
  ip: string,
) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - ALERT_THROTTLE_MS);
  if (target) {
    const [claimed] = await app.db
      .update(users)
      .set({ lastAlertAt: now })
      .where(and(eq(users.id, target.id), or(isNull(users.lastAlertAt), lt(users.lastAlertAt, cutoff))))
      .returning();
    if (claimed) void notifyUser(app, claimed, 'failedLogin', { user: claimed.username, ip });
  }
  // Admins who opted into security alerts for all accounts.
  const admins = await app.db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, false)));
  for (const admin of admins) {
    if (admin.id === target?.id || !readNotifyConfig(app, admin)?.events.adminAlerts) continue;
    const [claimed] = await app.db
      .update(users)
      .set({ lastAlertAt: now })
      .where(and(eq(users.id, admin.id), or(isNull(users.lastAlertAt), lt(users.lastAlertAt, cutoff))))
      .returning();
    if (claimed) void notifyUser(app, claimed, 'adminFailedLogin', { user: username.slice(0, 64), ip });
  }
}

export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' / ');
}

/** Users with notifications whose reminder event is on (used by the daily reminder job). */
export function wantsReminders(app: FastifyInstance, user: UserRow): boolean {
  const c = readNotifyConfig(app, user);
  return Boolean(c?.enabled && c.url && c.events.reminders);
}
