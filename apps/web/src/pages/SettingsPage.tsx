import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto, Theme } from '@tresor/shared';
import {
  BellRing,
  BookmarkPlus,
  Database,
  FileArchive,
  FileJson,
  KeyRound,
  LogOut,
  Monitor,
  Palette,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { OwnFingerprint } from '@/components/Fingerprint';
import { QrCode } from '@/components/notes/bits';
import { useCopy } from '@/components/notes/FieldInput';
import { NewPasswordFields, passwordsValid } from '@/components/PasswordFields';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { RecoveryKeyDialog } from '@/components/RecoveryKeyDialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, Card, Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useApplyUser } from '@/hooks/auth';
import { setLanguage } from '@/i18n';
import { api } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { LanguageSelect } from './auth';
import { NotificationsTab, PasskeysSection, TemplatesTab } from './settings-extra';

const AUTO_LOCK_OPTIONS = [0, 5, 10, 15, 30, 60];

function Section({
  title,
  text,
  children,
  aside,
}: {
  title: string;
  text?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Card className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {aside}
        </div>
        {text ? <p className="text-[13px] leading-relaxed text-fg-2">{text}</p> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  );
}

function ProfileTab({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const applyUser = useApplyUser();
  const [displayName, setDisplayName] = useState(me.displayName);
  const save = useMutation({
    mutationFn: (prefs: Parameters<typeof api.updatePreferences>[0]) => api.updatePreferences(prefs),
    onSuccess: ({ user }) => applyUser(user),
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('settings.profileTitle')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ displayName }, { onSuccess: () => toast.success(t('common.saved')) });
          }}
        >
          <Field label={t('settings.username')}>
            {(a) => <Input {...a} value={`@${me.username}`} disabled />}
          </Field>
          <Field label={t('settings.displayName')}>
            {(a) => (
              <Input
                {...a}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
                required
              />
            )}
          </Field>
          <div>
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={displayName.trim() === me.displayName}
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Section>

      <Section title={t('settings.appearanceTitle')}>
        <Field label={t('settings.language')}>
          {() => (
            <LanguageSelect
              value={me.language}
              onChange={(language) => {
                setLanguage(language);
                save.mutate({ language });
              }}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-fg-2">{t('settings.theme')}</span>
          <Segmented
            label={t('settings.theme')}
            value={me.theme}
            onChange={(theme: Theme) => {
              applyTheme(theme);
              save.mutate({ theme });
            }}
            className="self-start"
            options={(['system', 'dark', 'light'] as const).map((v) => ({
              value: v,
              label: t(`themes.${v}`),
            }))}
          />
        </div>
        <Field label={t('settings.autoLock')} hint={t('settings.autoLockHint')}>
          {(a) => (
            <Select
              {...a}
              value={me.autoLockMinutes}
              onChange={(e) => save.mutate({ autoLockMinutes: Number(e.target.value) })}
            >
              {AUTO_LOCK_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? t('settings.autoLockNever') : t('settings.autoLockMinutes', { count: m })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Section>
    </div>
  );
}

function PasswordSection() {
  const { t } = useTranslation();
  const applyUser = useApplyUser();
  const qc = useQueryClient();
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!passwordsValid(form.password, form.confirm)) return;
    setBusy(true);
    try {
      const res = await api.changePassword({ currentPassword: form.current, newPassword: form.password });
      applyUser(res.user);
      setForm({ current: '', password: '', confirm: '' });
      setTouched(false);
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success(t('settings.passwordChanged'));
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('settings.passwordTitle')} text={t('settings.passwordText')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('settings.currentPassword')}>
          {(a) => (
            <Input
              {...a}
              type="password"
              autoComplete="current-password"
              value={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.value })}
              required
            />
          )}
        </Field>
        <NewPasswordFields
          password={form.password}
          confirm={form.confirm}
          onPassword={(v) => setForm({ ...form, password: v })}
          onConfirm={(v) => setForm({ ...form, confirm: v })}
          labels={{ password: t('settings.newPassword'), confirm: t('settings.confirmPassword') }}
          touched={touched}
        />
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            {t('settings.changePassword')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function TotpSection({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const applyUser = useApplyUser();
  const copy = useCopy();
  const [prompt, setPrompt] = useState<'setup' | 'disable' | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Section
      title={t('settings.totpTitle')}
      text={t('settings.totpText')}
      aside={
        <Badge tone={me.totpEnabled ? 'ok' : 'neutral'}>
          {me.totpEnabled ? t('settings.active') : t('settings.inactive')}
        </Badge>
      }
    >
      {setup ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              applyUser((await api.totpEnable(code)).user);
              setSetup(null);
              setCode('');
              toast.success(t('settings.totpEnabled'));
            } catch (err) {
              toast.error(errorMessage(err, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-[13px] text-fg-2">{t('settings.totpScan')}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <QrCode value={setup.uri} label={t('settings.totpTitle')} className="size-40 shrink-0" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs text-muted">{t('settings.totpSecret')}</span>
              <button
                type="button"
                onClick={() => copy(setup.secret)}
                className="text-left font-mono text-sm tracking-wider break-all hover:text-accent-text"
              >
                {setup.secret.match(/.{1,4}/g)?.join(' ')}
              </button>
            </div>
          </div>
          <Field label={t('settings.totpCode')}>
            {(a) => (
              <Input
                {...a}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="max-w-40 font-mono tracking-[0.3em]"
                required
                autoFocus
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
              {t('settings.totpActivate')}
            </Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-fg-2">
            <Smartphone className="size-5" />
          </span>
          <span className="flex-1 text-[13px] text-fg-2">TOTP · RFC 6238 · 6 / 30 s</span>
          {me.totpEnabled ? (
            <Button variant="danger-outline" size="sm" onClick={() => setPrompt('disable')}>
              {t('settings.disable')}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setPrompt('setup')}>
              {t('settings.setup')}
            </Button>
          )}
        </div>
      )}
      <PasswordPrompt
        open={prompt !== null}
        title={t('settings.totpTitle')}
        confirmLabel={prompt === 'disable' ? t('settings.disable') : t('common.continue')}
        danger={prompt === 'disable'}
        onClose={() => setPrompt(null)}
        onConfirm={async (password) => {
          if (prompt === 'disable') {
            applyUser((await api.totpDisable(password)).user);
            toast.success(t('settings.totpDisabled'));
          } else {
            setSetup(await api.totpSetup(password));
          }
          setPrompt(null);
        }}
      />
    </Section>
  );
}

function RecoverySection({ me }: { me: MeDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  return (
    <Section
      title={t('settings.recoveryTitle')}
      text={t('settings.recoveryText')}
      aside={
        <Badge tone={me.hasRecoveryKey ? 'ok' : 'warn'}>
          {me.hasRecoveryKey ? t('settings.present') : t('settings.missing')}
        </Badge>
      }
    >
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-fg-2">
          <KeyRound className="size-5" />
        </span>
        <span className="flex-1 font-mono text-[13px] tracking-wider text-muted">XXXX-XXXX-…-XXXX</span>
        <Button size="sm" onClick={() => setPrompt(true)}>
          {t('settings.regenerate')}
        </Button>
      </div>
      <PasswordPrompt
        open={prompt}
        title={t('settings.recoveryTitle')}
        confirmLabel={t('settings.regenerate')}
        onClose={() => setPrompt(false)}
        onConfirm={async (password) => {
          setKey((await api.regenerateRecoveryKey(password)).recoveryKey);
          setPrompt(false);
        }}
      />
      <RecoveryKeyDialog
        recoveryKey={key}
        username={me.username}
        onDone={() => {
          setKey(null);
          void qc.invalidateQueries({ queryKey: ['me'] });
          void qc.invalidateQueries({ queryKey: ['stats'] });
        }}
      />
    </Section>
  );
}

function describeAgent(ua: string | null, fallback: string) {
  if (!ua) return fallback;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
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
            : null;
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

function SessionsSection() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: async () => (await api.sessions()).sessions });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: ({ revoked }) => {
      toast.success(t('settings.revoked', { count: revoked }));
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });
  const others = (sessions.data ?? []).filter((s) => !s.current).length;

  return (
    <Section title={t('settings.sessionsTitle')} text={t('settings.sessionsText')}>
      <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {(sessions.data ?? []).map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3">
            <Monitor className="size-4 shrink-0 text-muted" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2 truncate text-sm font-medium">
                {describeAgent(s.userAgent, t('common.unknown'))}
                {s.current ? <Badge tone="accent">{t('settings.currentSession')}</Badge> : null}
              </span>
              <span className="truncate text-xs text-muted">
                {s.ip ?? '–'} ·{' '}
                {t('settings.lastSeen', {
                  time: relativeTime(s.lastSeenAt, i18n.language, t('common.justNow')),
                })}
              </span>
            </div>
            {!s.current ? (
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                {t('settings.revoke')}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {others > 0 ? (
        <div>
          <Button variant="danger-outline" size="sm" onClick={() => revoke.mutate('others')}>
            <LogOut /> {t('settings.revokeOthers')}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function ExportSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [format, setFormat] = useState<'tresor' | 'json' | 'markdown'>('tresor');
  const [pass, setPass] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);
  const mismatch = format === 'tresor' && pass.b.length > 0 && pass.a !== pass.b;

  const formats = [
    {
      value: 'tresor' as const,
      icon: <ShieldCheck />,
      title: t('settings.formatTresor'),
      text: t('settings.formatTresorText'),
    },
    {
      value: 'json' as const,
      icon: <FileJson />,
      title: t('settings.formatJson'),
      text: t('settings.formatJsonText'),
    },
    {
      value: 'markdown' as const,
      icon: <FileArchive />,
      title: t('settings.formatMarkdown'),
      text: t('settings.formatMarkdownText'),
    },
  ];

  return (
    <Section title={t('settings.exportTitle')} text={t('settings.exportText')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (format === 'tresor' && (pass.a.length < 8 || pass.a !== pass.b)) return;
          setBusy(true);
          try {
            await api.exportData(format === 'tresor' ? { format, passphrase: pass.a } : { format });
            setPass({ a: '', b: '' });
            toast.success(t('settings.exported'));
            void qc.invalidateQueries({ queryKey: ['stats'] });
            void qc.invalidateQueries({ queryKey: ['me'] });
          } catch (err) {
            toast.error(errorMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div role="radiogroup" aria-label={t('settings.exportTitle')} className="grid gap-2">
          {formats.map((f) => (
            <label
              key={f.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
                format === f.value
                  ? 'border-[color-mix(in_oklab,var(--mark)_60%,transparent)] bg-accent-soft'
                  : 'border-line hover:bg-surface-2',
              )}
            >
              <input
                type="radio"
                name="format"
                value={f.value}
                checked={format === f.value}
                onChange={() => setFormat(f.value)}
                className="sr-only"
              />
              <span className="mt-0.5 text-fg-2 [&_svg]:size-[18px]">{f.icon}</span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{f.title}</span>
                <span className="text-xs text-fg-2">{f.text}</span>
              </span>
            </label>
          ))}
        </div>
        {format === 'tresor' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.passphrase')} hint={t('settings.passphraseHint')}>
              {(a) => (
                <Input
                  {...a}
                  type="password"
                  autoComplete="new-password"
                  value={pass.a}
                  onChange={(e) => setPass({ ...pass, a: e.target.value })}
                  minLength={8}
                  required
                />
              )}
            </Field>
            <Field
              label={t('settings.passphraseConfirm')}
              error={mismatch ? t('password.mismatch') : undefined}
            >
              {(a) => (
                <Input
                  {...a}
                  type="password"
                  autoComplete="new-password"
                  value={pass.b}
                  onChange={(e) => setPass({ ...pass, b: e.target.value })}
                  required
                />
              )}
            </Field>
          </div>
        ) : (
          <p className="flex gap-2.5 rounded-xl bg-warn-soft p-3 text-[13px]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            {t('settings.plainWarning')}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            <Database /> {t('settings.exportButton')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function ImportSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const isEncrypted = file?.name.endsWith('.tresor') ?? false;

  return (
    <Section title={t('settings.importTitle')} text={t('settings.importText')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          try {
            const data = await file.text();
            const encrypted = isEncrypted || data.includes('"tresor-backup"');
            const res = await api.importData({
              format: encrypted ? 'tresor' : 'json',
              data,
              ...(encrypted ? { passphrase } : {}),
            });
            toast.success(
              [
                t('settings.imported', { count: res.imported }),
                res.skipped ? t('settings.skipped', { count: res.skipped }) : '',
              ]
                .filter(Boolean)
                .join(' · '),
            );
            setFile(null);
            setPassphrase('');
            void qc.invalidateQueries({ queryKey: ['notes'] });
            void qc.invalidateQueries({ queryKey: ['stats'] });
          } catch (err) {
            toast.error(errorMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-strong p-4 transition-colors hover:bg-surface-2">
          <Upload className="size-5 text-muted" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{t('settings.chooseFile')}</span>
            <span className="truncate text-xs text-muted">{file?.name ?? t('settings.noFile')}</span>
          </span>
          <input
            type="file"
            accept=".json,.tresor,application/json"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {isEncrypted ? (
          <Field label={t('settings.passphrase')}>
            {(a) => (
              <Input
                {...a}
                type="password"
                autoComplete="off"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required
              />
            )}
          </Field>
        ) : null}
        <div>
          <Button type="submit" variant="primary" loading={busy} disabled={!file}>
            {t('settings.importButton')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const me = useOutletContext<MeDto>();
  const [params, setParams] = useSearchParams();
  const tab = ['profile', 'security', 'notifications', 'templates', 'data'].includes(params.get('tab') ?? '')
    ? params.get('tab')!
    : 'profile';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t('settings.title')}</h1>
      <Tabs
        value={tab}
        onValueChange={(v) => setParams({ tab: v }, { replace: true })}
        className="flex flex-col gap-6"
      >
        <TabsList>
          <TabsTrigger value="profile">
            <Palette /> {t('settings.tabProfile')}
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck /> {t('settings.tabSecurity')}
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <BellRing /> {t('settings.tabNotifications')}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <BookmarkPlus /> {t('settings.tabTemplates')}
          </TabsTrigger>
          <TabsTrigger value="data">
            <Database /> {t('settings.tabData')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab me={me} />
        </TabsContent>
        <TabsContent value="security" className="flex flex-col gap-4">
          <PasswordSection />
          <PasskeysSection me={me} />
          <TotpSection me={me} />
          <RecoverySection me={me} />
          <Section title={t('keys.title')} text={t('keys.text')}>
            <OwnFingerprint />
          </Section>
          <SessionsSection />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="data" className="flex flex-col gap-4">
          <ExportSection />
          <ImportSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
