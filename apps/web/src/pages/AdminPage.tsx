import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserDto, MeDto, Role } from '@tresor/shared';
import {
  Activity,
  Ban,
  Dices,
  Ellipsis,
  LogOut,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { BarList } from '@/components/charts/BarList';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/misc';
import { api } from '@/lib/api';
import { generatePassword } from '@/lib/secrets';
import {
  cn,
  errorMessage,
  formatBytes,
  formatDate,
  formatDuration,
  initials,
  relativeTime,
} from '@/lib/utils';

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <span className="text-[13px] text-fg-2">{label}</span>
      <span className="flex items-center gap-2.5 text-[32px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
        {value}
      </span>
      <span className="text-xs text-fg-2">{hint}</span>
    </Card>
  );
}

function Overview() {
  const { t, i18n } = useTranslation();
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: api.admin.stats, refetchInterval: 60_000 });
  const s = stats.data;
  if (!s) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          label={t('admin.kpiUsers')}
          value={s.users.total}
          hint={t('admin.kpiUsersHint', {
            admins: s.users.admins,
            disabled: s.users.disabled,
            pending: s.users.pendingPasswordChange,
          })}
        />
        <Kpi
          label={t('admin.kpiNotes')}
          value={s.notes.total}
          hint={t('admin.kpiNotesHint', { size: formatBytes(s.notes.storageBytes, i18n.language) })}
        />
        <Kpi
          label={t('admin.kpiLogins')}
          value={s.successfulLogins14d}
          hint={t('admin.kpiLoginsHint', { count: s.activeSessions })}
        />
        <Kpi
          label={t('admin.kpiFailed')}
          value={
            <>
              {s.failedLogins14d}
              {s.failedLogins14d > 0 ? (
                <Badge tone="warn" className="tracking-normal">
                  <TriangleAlert className="size-3" aria-hidden />
                  {t('admin.review')}
                </Badge>
              ) : null}
            </>
          }
          hint={
            s.lastFailedLogin
              ? t('admin.kpiFailedHint', {
                  time: relativeTime(s.lastFailedLogin.at, i18n.language, t('common.justNow')),
                  ip: s.lastFailedLogin.ip ?? '–',
                })
              : t('admin.kpiFailedNone')
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="flex flex-col gap-5 p-5">
          <CardHeader title={t('admin.loginsTitle')} subtitle={t('admin.loginsSubtitle')} />
          <ColumnChart
            data={s.logins}
            valueKey="admin.loginsTooltip"
            label={t('admin.loginsTitle')}
            height={150}
          />
        </Card>
        <Card className="flex flex-col gap-5 p-5">
          <CardHeader title={t('admin.perUserTitle')} subtitle={t('admin.perUserSubtitle')} />
          <BarList
            items={s.notesPerUser
              .slice(0, 8)
              .map((u) => ({ key: u.username, label: u.displayName, value: u.count }))}
          />
        </Card>
      </div>

      <Card className="grid gap-4 p-5 sm:grid-cols-4">
        {[
          [t('common.version'), s.system.version],
          [t('admin.postgres'), s.system.postgresVersion ?? '–'],
          [t('admin.database'), formatBytes(s.system.databaseBytes, i18n.language)],
          [t('admin.uptime'), formatDuration(s.system.uptimeSeconds, i18n.language)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="text-xs text-muted">{label}</span>
            <span className="font-mono text-sm">{value}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const empty = { username: '', displayName: '', role: 'user' as Role, password: '' };
  const [form, setForm] = useState(empty);
  const create = useMutation({
    mutationFn: () => api.admin.createUser(form),
    onSuccess: ({ user }) => {
      toast.success(t('admin.created', { name: user.displayName }));
      void qc.invalidateQueries({ queryKey: ['admin'] });
      setForm(empty);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.createTitle')}
      description={t('admin.createText')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('setup.displayName')}>
            {(a) => (
              <Input
                {...a}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                required
                autoFocus
              />
            )}
          </Field>
          <Field label={t('setup.username')}>
            {(a) => (
              <Input
                {...a}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
                required
                minLength={3}
                maxLength={32}
                pattern="[a-z0-9][a-z0-9._\-]*"
                autoCapitalize="none"
                autoComplete="off"
              />
            )}
          </Field>
        </div>
        <Field label={t('admin.role')}>
          {(a) => (
            <Select
              {...a}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              <option value="user">{t('admin.roleUser')}</option>
              <option value="admin">{t('admin.roleAdmin')}</option>
            </Select>
          )}
        </Field>
        <Field
          label={t('admin.tempPassword')}
          trailing={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setForm({ ...form, password: generatePassword(16) })}
            >
              <Dices /> {t('common.generate')}
            </Button>
          }
        >
          {(a) => (
            <Input
              {...a}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={10}
              className="font-mono"
              autoComplete="off"
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            {t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function UsersTable({ me }: { me: MeDto }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.admin.users()).users,
  });
  const [resetFor, setResetFor] = useState<AdminUserDto | null>(null);
  const [tempPassword, setTempPassword] = useState('');

  const act = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success(success);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  const status = (u: AdminUserDto) =>
    u.disabled ? (
      <Badge tone="danger">{t('admin.statusDisabled')}</Badge>
    ) : u.mustChangePassword ? (
      <Badge tone="warn">{t('admin.statusPending')}</Badge>
    ) : (
      <Badge tone="ok">{t('admin.statusActive')}</Badge>
    );

  if (!users.data) return <Skeleton className="h-64 rounded-2xl" />;

  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-5 py-3 font-medium">{t('admin.colUser')}</th>
              <th className="px-3 py-3 font-medium">{t('admin.colRole')}</th>
              <th className="px-3 py-3 font-medium">{t('admin.colStatus')}</th>
              <th className="px-3 py-3 font-medium">{t('admin.col2fa')}</th>
              <th className="px-3 py-3 text-right font-medium">{t('admin.colNotes')}</th>
              <th className="px-3 py-3 font-medium">{t('admin.colLastLogin')}</th>
              <th className="px-5 py-3 text-right font-medium">
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.data.map((u) => {
              const self = u.id === me.id;
              return (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-surface-3 text-xs font-semibold">
                        {initials(u.displayName)}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {u.displayName}{' '}
                          {self ? <span className="text-muted">({t('common.you')})</span> : null}
                        </span>
                        <span className="text-xs text-muted">@{u.username}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={u.role === 'admin' ? 'accent' : 'neutral'}>
                      {u.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser')}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">{status(u)}</td>
                  <td className="px-3 py-3 text-fg-2">{u.totpEnabled ? t('settings.active') : '–'}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{u.noteCount}</td>
                  <td className="px-3 py-3 text-fg-2">
                    {u.lastLoginAt
                      ? relativeTime(u.lastLoginAt, i18n.language, t('common.justNow'))
                      : t('common.never')}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`${t('common.actions')}: ${u.displayName}`}
                        >
                          <Ellipsis />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        {u.role === 'admin' ? (
                          <MenuItem
                            icon={<ShieldOff />}
                            disabled={self}
                            onSelect={() =>
                              act(() => api.admin.updateUser(u.id, { role: 'user' }), t('admin.updated'))
                            }
                          >
                            {t('admin.makeUser')}
                          </MenuItem>
                        ) : (
                          <MenuItem
                            icon={<ShieldCheck />}
                            onSelect={() =>
                              act(() => api.admin.updateUser(u.id, { role: 'admin' }), t('admin.updated'))
                            }
                          >
                            {t('admin.makeAdmin')}
                          </MenuItem>
                        )}
                        <MenuItem
                          icon={<Ban />}
                          disabled={self}
                          onSelect={() =>
                            act(
                              () => api.admin.updateUser(u.id, { disabled: !u.disabled }),
                              t('admin.updated'),
                            )
                          }
                        >
                          {u.disabled ? t('admin.enable') : t('admin.disable')}
                        </MenuItem>
                        <MenuItem
                          icon={<LogOut />}
                          onSelect={async () => {
                            try {
                              const r = await api.admin.logoutUser(u.id);
                              toast.success(t('admin.sessionsRevoked', { count: r.revoked }));
                            } catch (err) {
                              toast.error(errorMessage(err, t));
                            }
                          }}
                        >
                          {t('admin.logoutEverywhere')}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          icon={<RotateCcw />}
                          danger
                          disabled={self}
                          onSelect={() => {
                            setTempPassword(generatePassword(16));
                            setResetFor(u);
                          }}
                        >
                          {t('admin.reset')}
                        </MenuItem>
                        <MenuItem
                          icon={<Trash2 />}
                          danger
                          disabled={self}
                          onSelect={async () => {
                            const ok = await confirm({
                              title: t('admin.deleteTitle', { name: u.displayName }),
                              description: t('admin.deleteText', { count: u.noteCount }),
                              confirmLabel: t('admin.deleteSubmit'),
                              danger: true,
                              typeToConfirm: {
                                value: u.username,
                                label: t('admin.typeToConfirm', { name: u.username }),
                              },
                            });
                            if (ok) await act(() => api.admin.deleteUser(u.id), t('admin.deleted'));
                          }}
                        >
                          {t('admin.delete')}
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog
        open={resetFor !== null}
        onOpenChange={(o) => !o && setResetFor(null)}
        title={t('admin.resetTitle', { name: resetFor?.displayName ?? '' })}
        description={t('admin.resetText', { count: resetFor?.noteCount ?? 0 })}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!resetFor) return;
            const target = resetFor;
            await act(
              () => api.admin.resetUser(target.id, tempPassword),
              t('admin.resetDone', { name: target.displayName }),
            );
            setResetFor(null);
          }}
        >
          <Field label={t('admin.tempPassword')}>
            {(a) => (
              <Input
                {...a}
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                minLength={10}
                required
                className="font-mono"
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResetFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger">
              {t('admin.resetSubmit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

const AUDIT_FILTERS = [
  'auth',
  'auth.login_failed',
  'account',
  'note',
  'vault',
  'emergency',
  'passkey',
  'data',
  'admin',
];

function AuditLog() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState('');
  const audit = useInfiniteQuery({
    queryKey: ['admin', 'audit', action],
    queryFn: ({ pageParam }) =>
      api.admin.audit({ action: action || undefined, before: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.entries[last.entries.length - 1]?.createdAt : undefined),
  });
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="text-[15px] font-semibold">{t('admin.tabAudit')}</h2>
        <Select
          aria-label={t('admin.filterAction')}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">{t('admin.allActions')}</option>
          {AUDIT_FILTERS.map((f) => (
            <option key={f} value={f}>
              {f.includes('.') ? t(`audit.${f}`) : `${f}.*`}
            </option>
          ))}
        </Select>
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-5 py-2.5 font-medium">{t('admin.colTime')}</th>
              <th className="px-3 py-2.5 font-medium">{t('admin.colAction')}</th>
              <th className="px-3 py-2.5 font-medium">{t('admin.colActor')}</th>
              <th className="px-3 py-2.5 font-medium">{t('admin.colTarget')}</th>
              <th className="px-5 py-2.5 font-medium">{t('admin.colIp')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const failed = e.action === 'auth.login_failed';
              const label = t(`audit.${e.action}`, { defaultValue: e.action });
              return (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-5 py-2.5 whitespace-nowrap text-fg-2" title={e.createdAt}>
                    {formatDate(e.createdAt, i18n.language, { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('inline-flex items-center gap-1.5', failed && 'text-warn')}>
                      {failed ? <TriangleAlert className="size-3.5" aria-hidden /> : null}
                      {label}
                    </span>
                    {e.meta && 'reason' in e.meta ? (
                      <span className="ml-1.5 text-xs text-muted">({String(e.meta.reason)})</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">{e.actor ?? '–'}</td>
                  <td className="max-w-48 truncate px-3 py-2.5 font-mono text-xs text-fg-2">
                    {e.target ?? '–'}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-fg-2">{e.ip ?? '–'}</td>
                </tr>
              );
            })}
            {entries.length === 0 && !audit.isLoading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-muted">
                  {t('admin.noEntries')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {audit.hasNextPage ? (
        <div className="border-t border-line p-3 text-center">
          <Button
            variant="ghost"
            size="sm"
            loading={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            {t('admin.loadMore')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const me = useOutletContext<MeDto>();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const tab = ['overview', 'users', 'audit'].includes(params.get('tab') ?? '')
    ? params.get('tab')!
    : 'overview';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('admin.title')}</h1>
          <p className="text-fg-2">{t('admin.subtitle')}</p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <UserPlus /> {t('admin.createUser')}
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => setParams({ tab: v }, { replace: true })}
        className="flex flex-col gap-6"
      >
        <TabsList>
          <TabsTrigger value="overview">
            <Activity /> {t('admin.tabOverview')}
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users /> {t('admin.tabUsers')}
          </TabsTrigger>
          <TabsTrigger value="audit">
            <ScrollText /> {t('admin.tabAudit')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview />
        </TabsContent>
        <TabsContent value="users">
          <UsersTable me={me} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLog />
        </TabsContent>
      </Tabs>
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
