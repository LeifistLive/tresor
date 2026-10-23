import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@tresor/shared';
import { VAULT_ROLES, type VaultDto, type VaultRole } from '@tresor/shared';
import { ArrowRight, LogOut, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/misc';
import { useVaults } from '@/hooks/vaults';
import { api } from '@/lib/api';
import { errorMessage, initials } from '@/lib/utils';

function NameDialog({
  open,
  onOpenChange,
  title,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setName(initial);
        onOpenChange(o);
      }}
      title={title}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit(name.trim());
            onOpenChange(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('vaults.name')}>
          {(a) => (
            <Input
              {...a}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoFocus
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function VaultCard({ vault, me }: { vault: VaultDto; me: MeDto }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [renameOpen, setRenameOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<VaultRole>('editor');
  const isOwner = vault.role === 'owner';
  const directory = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.vaults.directory(),
    enabled: isOwner,
  });
  const candidates = (directory.data ?? []).filter((u) => !vault.members.some((m) => m.userId === u.id));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['vaults'] });
    void qc.invalidateQueries({ queryKey: ['notes'] });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  const leave = async () => {
    const last = vault.members.length === 1;
    const ok = await confirm({
      title: t('vaults.leaveTitle', { name: vault.name }),
      description: last ? t('vaults.leaveLast') : t('vaults.leaveText'),
      confirmLabel: t('vaults.leave'),
      danger: true,
    });
    if (ok) run.mutate(() => api.vaults.removeMember(vault.id, me.id));
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('vaults.deleteTitle', { name: vault.name }),
      description: t('vaults.deleteText', { count: vault.noteCount }),
      confirmLabel: t('vaults.delete'),
      danger: true,
      typeToConfirm: { value: vault.name, label: t('admin.typeToConfirm', { name: vault.name }) },
    });
    if (ok) run.mutate(() => api.vaults.remove(vault.id));
  };

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-text">
          <Users className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-lg font-semibold">{vault.name}</h2>
          <span className="text-xs text-muted">
            {t('vaults.entries', { count: vault.noteCount })} · {t(`vaults.role_${vault.role}`)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to={`/notes?vault=${vault.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-accent-text hover:bg-surface-2"
          >
            {t('vaults.open')} <ArrowRight className="size-4" />
          </Link>
          {isOwner ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('vaults.rename')}
              onClick={() => setRenameOpen(true)}
            >
              <Pencil />
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {vault.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-surface-3 text-xs font-semibold">
              {initials(m.displayName)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                {m.displayName}{' '}
                {m.userId === me.id ? <span className="text-muted">({t('common.you')})</span> : null}
              </span>
              <span className="text-xs text-muted">
                @{m.username}
                {m.fingerprint ? (
                  <span className="font-mono" title={t('keys.fingerprintHint')}>
                    {' · '}
                    {m.fingerprint}
                  </span>
                ) : null}
              </span>
            </span>
            {isOwner && m.userId !== me.id ? (
              <>
                <Select
                  aria-label={t('vaults.role')}
                  value={m.role}
                  onChange={(e) =>
                    run.mutate(() => api.vaults.setRole(vault.id, m.userId, e.target.value as VaultRole))
                  }
                  className="h-8 w-auto pr-8 text-xs"
                >
                  {VAULT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`vaults.role_${r}`)}
                    </option>
                  ))}
                </Select>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${t('vaults.removeMember')}: ${m.displayName}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('vaults.removeTitle', { name: m.displayName }),
                      description: t('vaults.removeText'),
                      confirmLabel: t('vaults.removeMember'),
                      danger: true,
                    });
                    if (ok) run.mutate(() => api.vaults.removeMember(vault.id, m.userId));
                  }}
                >
                  <X />
                </Button>
              </>
            ) : (
              <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{t(`vaults.role_${m.role}`)}</Badge>
            )}
          </li>
        ))}
      </ul>

      {isOwner ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!username) return;
            run.mutate(async () => {
              await api.vaults.addMember(vault.id, username, role);
              setUsername('');
              toast.success(t('vaults.memberAdded'));
            });
          }}
        >
          <Field label={t('vaults.addMember')} className="min-w-48 flex-1">
            {(a) => (
              <Select {...a} value={username} onChange={(e) => setUsername(e.target.value)}>
                <option value="">{t('vaults.pickUser')}</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.username} disabled={!u.publicKey}>
                    {u.displayName} (@{u.username}){u.publicKey ? '' : ` – ${t('vaults.noKeys')}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('vaults.role')}>
            {(a) => (
              <Select {...a} value={role} onChange={(e) => setRole(e.target.value as VaultRole)}>
                {VAULT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`vaults.role_${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" disabled={!username} loading={run.isPending}>
            <UserPlus /> {t('vaults.invite')}
          </Button>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button size="sm" variant="ghost" onClick={() => void leave()}>
          <LogOut /> {t('vaults.leave')}
        </Button>
        {isOwner ? (
          <Button size="sm" variant="danger-outline" onClick={() => void remove()}>
            <Trash2 /> {t('vaults.delete')}
          </Button>
        ) : null}
      </div>

      <NameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t('vaults.rename')}
        initial={vault.name}
        onSubmit={async (name) => {
          await run.mutateAsync(() => api.vaults.rename(vault.id, name));
        }}
      />
    </Card>
  );
}

export function SharingPage() {
  const { t } = useTranslation();
  const me = useOutletContext<MeDto>();
  const qc = useQueryClient();
  const vaults = useVaults();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('vaults.title')}</h1>
          <p className="text-fg-2">{t('vaults.subtitle')}</p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus /> {t('vaults.create')}
        </Button>
      </div>

      {vaults.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : vaults.data?.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {vaults.data.map((v) => (
            <VaultCard key={v.id} vault={v} me={me} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Users />}
            title={t('vaults.empty')}
            text={t('vaults.emptyText')}
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus /> {t('vaults.create')}
              </Button>
            }
          />
        </Card>
      )}

      <NameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('vaults.create')}
        initial=""
        onSubmit={async (name) => {
          try {
            await api.vaults.create(name);
            await qc.invalidateQueries({ queryKey: ['vaults'] });
            toast.success(t('vaults.created'));
          } catch (err) {
            toast.error(errorMessage(err, t));
            throw err;
          }
        }}
      />
    </div>
  );
}
