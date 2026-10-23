import { useQuery } from '@tanstack/react-query';
import {
  EXPIRY_WARNING_DAYS,
  type MeDto,
  NOTE_TYPES,
  type NoteType,
  type UserStatsDto,
} from '@tresor/shared';
import { ArrowRight, CalendarClock, Check, Download, LockKeyhole, Plus, TriangleAlert } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { BarList, Meter } from '@/components/charts/BarList';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { TypeDot, TypeIcon } from '@/components/notes/bits';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, Segmented, Skeleton } from '@/components/ui/misc';
import { useNotes } from '@/hooks/notes';
import { api } from '@/lib/api';
import { analyzePasswords, healthScore } from '@/lib/health';
import { TYPE_ICONS } from '@/lib/note-types';
import { cn, formatDate, relativeTime } from '@/lib/utils';

function greetingKey(): 'morning' | 'day' | 'evening' | 'night' {
  const h = new Date().getHours();
  if (h < 5) return 'night';
  if (h < 11) return 'morning';
  if (h < 18) return 'day';
  if (h < 23) return 'evening';
  return 'night';
}

function Kpi({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <span className="text-[13px] text-fg-2">{label}</span>
      <span className="text-[34px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{value}</span>
      {children}
      {hint ? <span className="text-xs text-fg-2">{hint}</span> : null}
    </Card>
  );
}

function SecurityItem({
  ok,
  warn,
  children,
  to,
}: {
  ok: boolean;
  warn?: boolean;
  children: ReactNode;
  to?: string;
}) {
  const icon = (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5',
        ok ? 'bg-ok-soft text-ok' : warn ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-muted',
      )}
      aria-hidden
    >
      {ok ? <Check strokeWidth={3} /> : <TriangleAlert strokeWidth={2.4} />}
    </span>
  );
  const body = (
    <>
      {icon}
      <span className={cn('text-[13px]', ok ? 'text-fg-2' : 'text-fg')}>{children}</span>
      {!ok && to ? <ArrowRight className="ml-auto size-4 text-muted" aria-hidden /> : null}
    </>
  );
  return to && !ok ? (
    <Link to={to} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-3 py-1">{body}</div>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useOutletContext<MeDto>();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const stats = useQuery({
    queryKey: ['stats', days],
    queryFn: () => api.stats(Number(days)),
    placeholderData: (p) => p,
  });
  const notes = useNotes();
  // Tags, titles and expiry lists come from the entries decrypted in this browser; the server only knows
  // metadata (counts, dates).
  const local = useMemo(() => {
    const list = notes.data ?? [];
    const tags = new Map<string, number>();
    for (const n of list) for (const tag of n.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const horizon = new Date(Date.now() + EXPIRY_WARNING_DAYS * 86_400_000).toISOString().slice(0, 10);
    return {
      topTags: [...tags.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 12)
        .map(([tag, count]) => ({ tag, count })),
      recent: [...list]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 6)
        .map((n) => ({ id: n.id, type: n.type, title: n.title, updatedAt: n.updatedAt })),
      expiringSoon: list
        .filter((n) => n.expiresAt !== null && n.expiresAt <= horizon)
        .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))
        .slice(0, 10)
        .map((n) => ({ id: n.id, type: n.type, title: n.title, expiresAt: n.expiresAt! })),
    };
  }, [notes.data]);
  const s: UserStatsDto | undefined = stats.data && notes.data ? { ...stats.data, ...local } : undefined;
  const health = useMemo(() => analyzePasswords(notes.data ?? []), [notes.data]);

  const rooms = new Set(
    (notes.data ?? [])
      .filter((n) => n.type === 'matter' && n.fields.room)
      .map((n) => n.fields.room!.trim().toLowerCase()),
  ).size;

  if (s && s.total === 0 && s.trashed === 0) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-[30px] font-semibold tracking-[-0.025em]">
          {t(`dashboard.greeting.${greetingKey()}`, { name: me.displayName })}
        </h1>
        <Card>
          <EmptyState
            icon={<LockKeyhole />}
            title={t('dashboard.emptyTitle')}
            text={t('dashboard.emptyText')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {NOTE_TYPES.map((type) => {
                  const Icon = TYPE_ICONS[type];
                  return (
                    <Button key={type} size="sm" onClick={() => navigate(`/notes?new=${type}`)}>
                      <Icon style={{ color: `var(--t-${type})` }} /> {t(`types.${type}`)}
                    </Button>
                  );
                })}
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[30px] font-semibold tracking-[-0.025em]">
            {t(`dashboard.greeting.${greetingKey()}`, { name: me.displayName })}
          </h1>
          <p className="text-fg-2">
            {s ? t('dashboard.subtitle', { count: s.total }) : ' '}{' '}
            {me.autoLockMinutes
              ? t('dashboard.autoLock', { count: me.autoLockMinutes })
              : t('dashboard.autoLockOff')}
          </p>
        </div>
        <span className="inline-flex h-8 items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--mark)_35%,transparent)] bg-accent-soft px-3 text-xs font-medium text-accent-text">
          <LockKeyhole className="size-3.5" aria-hidden />
          {t('dashboard.unlocked')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {s ? (
          <>
            <Kpi
              label={t('dashboard.kpiTotal')}
              value={s.total}
              hint={
                <>
                  <span className="font-medium text-accent-text">+{s.createdLast7Days}</span>{' '}
                  {t('dashboard.kpiTotalHint')}
                </>
              }
            />
            <Kpi
              label={t('dashboard.kpiMatter')}
              value={s.byType.matter}
              hint={t('dashboard.kpiMatterHint', { count: rooms })}
            />
            <Kpi
              label={t('dashboard.kpiLogins')}
              value={s.byType.login}
              hint={t('dashboard.kpiLoginsHint', { count: s.byType.wifi })}
            />
            <Kpi
              label={t('dashboard.kpiScore')}
              value={
                <span className="flex items-baseline gap-1.5">
                  {s.security.score}
                  <span className="text-base font-normal tracking-normal text-muted">/ 100</span>
                </span>
              }
            >
              <Meter value={s.security.score} label={t('dashboard.kpiScore')} />
            </Kpi>
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[134px] rounded-2xl" />)
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-5 p-5">
          <CardHeader
            title={t('dashboard.activityTitle')}
            subtitle={t('dashboard.activitySubtitle')}
            action={
              <Segmented
                label={t('dashboard.rangeLabel')}
                value={days}
                onChange={setDays}
                options={(['7', '30', '90'] as const).map((d) => ({
                  value: d,
                  label: t('dashboard.range', { count: Number(d) }),
                }))}
              />
            }
          />
          {s ? (
            <ColumnChart
              data={s.activity}
              valueKey="dashboard.activityTooltip"
              label={t('dashboard.activityTitle')}
            />
          ) : (
            <Skeleton className="h-[200px]" />
          )}
        </Card>

        <Card className="flex flex-col gap-5 p-5">
          <CardHeader
            title={t('dashboard.byTypeTitle')}
            subtitle={t('dashboard.byTypeSubtitle', { count: s?.total ?? 0 })}
          />
          {s ? (
            <BarList
              items={[...NOTE_TYPES]
                .sort((a, b) => s.byType[b] - s.byType[a])
                .map((type: NoteType) => ({
                  key: type,
                  label: t(`typesPlural.${type}`),
                  value: s.byType[type],
                  marker: <TypeDot type={type} />,
                  onClick: () => navigate(`/notes?type=${type}`),
                }))}
            />
          ) : (
            <Skeleton className="h-[200px]" />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col p-2">
          <CardHeader
            className="px-3 pt-3 pb-2"
            title={t('dashboard.expiringTitle')}
            subtitle={t('dashboard.expiringSubtitle', { count: EXPIRY_WARNING_DAYS })}
            action={
              s?.expiringSoon.length ? (
                <Link
                  to="/notes?filter=expiring"
                  className="text-[13px] font-medium text-accent-text hover:underline"
                >
                  {t('dashboard.recentAll')}
                </Link>
              ) : null
            }
          />
          {s && s.expiringSoon.length === 0 ? (
            <p className="flex items-center gap-2 px-3 pt-1 pb-3 text-sm text-fg-2">
              <Check className="size-4 text-ok" aria-hidden /> {t('dashboard.expiringNone')}
            </p>
          ) : (
            s?.expiringSoon.slice(0, 5).map((n) => {
              const expired = n.expiresAt < new Date().toISOString().slice(0, 10);
              return (
                <Link
                  key={n.id}
                  to={`/notes?id=${n.id}`}
                  className="flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <TypeIcon type={n.type} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {n.title || t('notes.untitled')}
                  </span>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs',
                      expired ? 'bg-danger-soft text-danger-text' : 'bg-warn-soft text-warn',
                    )}
                  >
                    <CalendarClock className="size-3" aria-hidden />
                    {expired
                      ? t('notes.expired')
                      : formatDate(n.expiresAt, i18n.language, { dateStyle: 'medium' })}
                  </span>
                </Link>
              );
            })
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <CardHeader
            title={t('health.title')}
            subtitle={t('health.subtitle', { count: health.checked })}
            action={
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {healthScore(health)}
                <span className="text-sm font-normal text-muted">%</span>
              </span>
            }
          />
          <Meter value={healthScore(health)} label={t('health.title')} />
          <div className="grid grid-cols-3 gap-2">
            {(['weak', 'reused', 'old'] as const).map((issue) => (
              <Link
                key={issue}
                to={`/notes?health=${issue}`}
                className={cn(
                  'flex flex-col gap-0.5 rounded-xl border border-line p-3 transition-colors hover:bg-surface-2',
                  health.counts[issue] > 0 && 'border-[color-mix(in_oklab,var(--warn)_40%,transparent)]',
                )}
              >
                <span
                  className={cn(
                    'text-xl font-semibold tabular-nums',
                    health.counts[issue] > 0 && 'text-warn',
                  )}
                >
                  {health.counts[issue]}
                </span>
                <span className="text-xs text-fg-2">{t(`health.${issue}`)}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="flex flex-col p-2">
          <CardHeader
            className="px-3 pt-3 pb-2"
            title={t('dashboard.recentTitle')}
            action={
              <Link to="/notes" className="text-[13px] font-medium text-accent-text hover:underline">
                {t('dashboard.recentAll')}
              </Link>
            }
          />
          {s?.recent.map((n) => (
            <Link
              key={n.id}
              to={`/notes?id=${n.id}`}
              className="flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2"
            >
              <TypeIcon type={n.type} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{n.title || t('notes.untitled')}</span>
                <span className="text-xs text-muted">{t(`types.${n.type}`)}</span>
              </div>
              <span className="shrink-0 text-xs text-muted">
                {relativeTime(n.updatedAt, i18n.language, t('common.justNow'))}
              </span>
            </Link>
          )) ?? <Skeleton className="m-3 h-48" />}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-5">
            <CardHeader title={t('dashboard.securityTitle')} />
            {s ? (
              <div className="flex flex-col gap-1.5">
                <SecurityItem ok={s.security.totpEnabled || me.passkeyCount > 0} to="/settings?tab=security">
                  {s.security.totpEnabled
                    ? t('dashboard.totpOn')
                    : me.passkeyCount > 0
                      ? t('dashboard.passkeysOn', { count: me.passkeyCount })
                      : t('dashboard.totpOff')}
                </SecurityItem>
                <SecurityItem ok={s.security.hasRecoveryKey} warn to="/settings?tab=security">
                  {s.security.hasRecoveryKey ? t('dashboard.recoveryOn') : t('dashboard.recoveryOff')}
                </SecurityItem>
                <SecurityItem ok={s.security.autoLockEnabled} to="/settings">
                  {s.security.autoLockEnabled
                    ? t('dashboard.autoLockOn', { count: me.autoLockMinutes })
                    : t('dashboard.autoLockOffItem')}
                </SecurityItem>
                <SecurityItem
                  ok={s.security.lastExportDays !== null && s.security.lastExportDays <= 90}
                  warn
                  to="/settings?tab=data"
                >
                  {s.security.lastExportDays === null
                    ? t('dashboard.exportNever')
                    : t('dashboard.exportAge', { count: s.security.lastExportDays })}
                </SecurityItem>
              </div>
            ) : (
              <Skeleton className="h-36" />
            )}
            <Button className="mt-2" onClick={() => navigate('/settings?tab=data')}>
              <Download /> {t('dashboard.exportCta')}
            </Button>
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <CardHeader title={t('dashboard.quickAdd')} />
            <div className="grid grid-cols-3 gap-2">
              {NOTE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => navigate(`/notes?new=${type}`)}
                  className="group flex flex-col items-center gap-2 rounded-xl border border-line px-2 py-3 text-center text-xs text-fg-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg"
                >
                  <span className="relative">
                    <TypeIcon type={type} size="sm" />
                    <Plus
                      className="absolute -right-1.5 -bottom-1.5 size-3.5 rounded-full bg-surface-1 p-px text-fg"
                      aria-hidden
                    />
                  </span>
                  <span className="line-clamp-1">{t(`types.${type}`)}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
