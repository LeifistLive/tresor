import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type MeDto,
  NOTE_TYPES,
  NOTIFY_EVENTS,
  NOTIFY_PROVIDERS,
  type NotificationConfigDto,
  type NotifyProvider,
} from '@tresor/shared';
import { BellRing, FingerprintPattern, KeyRound, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { TypeIcon } from '@/components/notes/bits';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState } from '@/components/ui/misc';
import { ME_KEY } from '@/hooks/auth';
import { useTemplates } from '@/hooks/vaults';
import { ApiError, api } from '@/lib/api';
import { setPrefill } from '@/lib/prefill';
import { errorMessage, relativeTime } from '@/lib/utils';
import { createPasskey, deviceName, passkeysSupported } from '@/lib/webauthn';

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

// --- Passkeys ---------------------------------------------------------------------------------------

export function PasskeysSection({ me }: { me: MeDto }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const support = passkeysSupported();
  const list = useQuery({
    queryKey: ['passkeys'],
    queryFn: async () => (await api.passkeys.list()).passkeys,
  });
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['passkeys'] });
    void qc.invalidateQueries({ queryKey: ME_KEY });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const add = async (password: string) => {
    setAsking(false);
    setBusy(true);
    try {
      // Checked before the ceremony, so a typo does not cost a passkey registration.
      await api.passkeys.verifyPassword(password);
      const { challengeId, options, prfSalt } = await api.passkeys.registerOptions();
      const { response, prf } = await createPasskey(options, prfSalt);
      const res = await api.passkeys.register({ challengeId, name: deviceName(), response, prf, password });
      toast.success(res.canUnlock ? t('passkeys.added') : t('passkeys.addedNoPrf'));
      refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(errorMessage(err, t));
      else if ((err as Error)?.name !== 'NotAllowedError') toast.error(t('passkeys.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t('passkeys.title')}
      text={t('passkeys.text')}
      aside={me.passkeyCount ? <Badge tone="ok">{me.passkeyCount}</Badge> : null}
    >
      {!support.ok ? (
        <p className="rounded-xl bg-warn-soft p-3 text-[13px]">{t(`passkeys.${support.reason}`)}</p>
      ) : null}
      {list.data?.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {list.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <FingerprintPattern className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 truncate text-sm font-medium">
                  {p.name}
                  {p.canUnlock ? null : <Badge tone="warn">{t('passkeys.noPrf')}</Badge>}
                </span>
                <span className="text-xs text-muted">
                  {p.lastUsedAt
                    ? t('passkeys.lastUsed', {
                        time: relativeTime(p.lastUsedAt, i18n.language, t('common.justNow')),
                      })
                    : t('passkeys.neverUsed')}
                </span>
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('passkeys.rename')}
                onClick={() => setRename(p)}
              >
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`${t('common.delete')}: ${p.name}`}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('passkeys.deleteTitle', { name: p.name }),
                    danger: true,
                    confirmLabel: t('common.delete'),
                  });
                  if (!ok) return;
                  await api.passkeys.remove(p.id);
                  refresh();
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button variant="primary" onClick={() => setAsking(true)} loading={busy} disabled={!support.ok}>
          <KeyRound /> {t('passkeys.add')}
        </Button>
      </div>
      <Dialog open={rename !== null} onOpenChange={(o) => !o && setRename(null)} title={t('passkeys.rename')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!rename) return;
            await api.passkeys.rename(rename.id, rename.name);
            setRename(null);
            refresh();
          }}
        >
          <Input
            aria-label={t('passkeys.rename')}
            value={rename?.name ?? ''}
            onChange={(e) => setRename((r) => (r ? { ...r, name: e.target.value } : r))}
            maxLength={64}
            required
            autoFocus
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
      <PasswordPrompt
        open={asking}
        title={t('passkeys.add')}
        confirmLabel={t('common.continue')}
        onClose={() => setAsking(false)}
        onConfirm={add}
      />
    </Section>
  );
}

// --- Notifications ----------------------------------------------------------------------------------

export function NotificationsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.notifications.get()).config,
  });
  const [form, setForm] = useState<(NotificationConfigDto & { token: string }) | null>(null);
  useEffect(() => {
    if (query.data && !form) setForm({ ...query.data, token: '' });
  }, [query.data, form]);

  const save = useMutation({
    mutationFn: () => {
      const { hasToken: _h, ...body } = form!;
      return api.notifications.save(body);
    },
    onSuccess: ({ config }) => {
      setForm({ ...config, token: '' });
      void qc.invalidateQueries({ queryKey: ME_KEY });
      toast.success(t('common.saved'));
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });
  const test = useMutation({
    mutationFn: api.notifications.test,
    onSuccess: () => toast.success(t('notify.testSent')),
    onError: (err) => toast.error(`${t('notify.testFailed')}: ${(err as Error).message}`),
  });

  if (!form) return null;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('notify.title')} text={t('notify.text')}>
        <label className="flex items-center gap-2.5 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="size-4 accent-[var(--mark)]"
          />
          {t('notify.enabled')}
        </label>
        <Field label={t('notify.provider')}>
          {(a) => (
            <Select
              {...a}
              value={form.provider}
              onChange={(e) => set('provider', e.target.value as NotifyProvider)}
            >
              {NOTIFY_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`notify.p_${p}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={form.provider === 'webhook' ? t('notify.webhookUrl') : t('notify.serverUrl')}
          hint={t(`notify.urlHint_${form.provider}`)}
        >
          {(a) => (
            <Input
              {...a}
              type="url"
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder={form.provider === 'ntfy' ? 'https://ntfy.sh' : 'https://'}
            />
          )}
        </Field>
        {form.provider === 'ntfy' ? (
          <Field label={t('notify.topic')} hint={t('notify.topicHint')}>
            {(a) => (
              <Input
                {...a}
                value={form.topic}
                onChange={(e) => set('topic', e.target.value)}
                placeholder="tresor-alerts"
              />
            )}
          </Field>
        ) : null}
        <Field
          label={form.provider === 'gotify' ? t('notify.appToken') : t('notify.token')}
          hint={form.hasToken ? t('notify.tokenKept') : undefined}
        >
          {(a) => (
            <Input
              {...a}
              type="password"
              autoComplete="off"
              value={form.token}
              onChange={(e) => set('token', e.target.value)}
              placeholder={form.hasToken ? '••••••••' : t('common.optional')}
            />
          )}
        </Field>
      </Section>
      <Section title={t('notify.events')} text={t('notify.eventsText')}>
        {NOTIFY_EVENTS.map((ev) => (
          <label key={ev} className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={form.events[ev]}
              onChange={(e) => set('events', { ...form.events, [ev]: e.target.checked })}
              className="mt-0.5 size-4 accent-[var(--mark)]"
            />
            <span className="flex flex-col">
              <span className="font-medium">{t(`notify.e_${ev}`)}</span>
              <span className="text-xs text-muted">{t(`notify.e_${ev}Text`)}</span>
            </span>
          </label>
        ))}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
          <Button loading={test.isPending} onClick={() => test.mutate()} disabled={!query.data?.url}>
            <Send /> {t('notify.test')}
          </Button>
        </div>
      </Section>
    </div>
  );
}

// --- Templates --------------------------------------------------------------------------------------

export function TemplatesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const templates = useTemplates();
  const [type, setType] = useState<(typeof NOTE_TYPES)[number]>('login');

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('templates.title')} text={t('templates.text')}>
        {templates.data?.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {templates.data.map((tpl) => (
              <li key={tpl.id} className="flex items-center gap-3 px-3 py-2.5">
                <TypeIcon type={tpl.type} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{tpl.name}</span>
                  <span className="text-xs text-muted">
                    {t(`types.${tpl.type}`)}
                    {tpl.customFields.length
                      ? ` · ${t('templates.fields', { count: tpl.customFields.length })}`
                      : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setPrefill({
                      type: tpl.type,
                      title: tpl.title,
                      content: tpl.content,
                      fields: tpl.fields,
                      customFields: tpl.customFields,
                      tags: tpl.tags,
                    });
                    navigate(`/notes?new=${tpl.type}`);
                  }}
                >
                  <Plus /> {t('templates.use')}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${t('common.delete')}: ${tpl.name}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('templates.deleteTitle', { name: tpl.name }),
                      confirmLabel: t('common.delete'),
                      danger: true,
                    });
                    if (!ok) return;
                    await api.templates.remove(tpl.id);
                    void qc.invalidateQueries({ queryKey: ['templates'] });
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<BellRing />}
            title={t('templates.empty')}
            text={t('templates.emptyText')}
            className="py-8"
          />
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get('name') as string;
            try {
              await api.templates.create({
                name,
                type,
                customFields: [{ label: t('templates.exampleField'), value: '', secret: false }],
              });
              (e.target as HTMLFormElement).reset();
              void qc.invalidateQueries({ queryKey: ['templates'] });
              toast.success(t('templates.saved'));
            } catch (err) {
              toast.error(errorMessage(err, t));
            }
          }}
        >
          <Field label={t('templates.name')} className="min-w-48 flex-1">
            {(a) => (
              <Input
                {...a}
                name="name"
                required
                maxLength={80}
                placeholder={t('templates.namePlaceholder')}
              />
            )}
          </Field>
          <Field label={t('editor.type')}>
            {(a) => (
              <Select {...a} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                {NOTE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`types.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit">
            <Plus /> {t('templates.create')}
          </Button>
        </form>
        <p className="text-xs text-muted">{t('templates.hint')}</p>
      </Section>
    </div>
  );
}
