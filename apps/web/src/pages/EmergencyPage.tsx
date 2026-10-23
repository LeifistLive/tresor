import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EMERGENCY_WAIT_DAYS, type EmergencyAccessDto } from '@tresor/shared';
import { Check, Clock, Eye, LifeBuoy, ShieldAlert, Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FingerprintLine } from '@/components/Fingerprint';
import { NoteCard } from '@/components/notes/NoteCard';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Field, Select } from '@/components/ui/input';
import { Badge, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { errorMessage, formatDate, relativeTime } from '@/lib/utils';

function StatusBadge({ e }: { e: EmergencyAccessDto }) {
  const { t, i18n } = useTranslation();
  if (e.accessible) return <Badge tone="danger">{t('emergency.statusOpen')}</Badge>;
  if (e.status === 'requested') {
    return (
      <Badge tone="warn">
        <Clock className="size-3" aria-hidden />
        {t('emergency.statusRequested', {
          date: formatDate(e.availableAt!, i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
        })}
      </Badge>
    );
  }
  return <Badge>{t('emergency.statusIdle')}</Badge>;
}

/** Read-only view of a grantor's vault. */
function EmergencyView({ grant, onBack }: { grant: EmergencyAccessDto; onBack: () => void }) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const notes = useQuery({
    queryKey: ['emergency', grant.id, 'notes'],
    queryFn: () => api.emergency.notes(grant.id),
  });
  const open = notes.data?.find((n) => n.id === openId) ?? null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onBack}>
          ← {t('common.back')}
        </Button>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">
          {t('emergency.viewTitle', { name: grant.grantor.displayName })}
        </h1>
        <Badge tone="warn">
          <Eye className="size-3" aria-hidden /> {t('emergency.readOnly')}
        </Badge>
      </div>
      {notes.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(notes.data ?? []).map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              layout="grid"
              onOpen={() => setOpenId(n.id)}
              onTogglePin={() => {}}
            />
          ))}
        </div>
      )}
      <NoteEditor
        note={open}
        newType={null}
        allTags={[]}
        onClose={() => setOpenId(null)}
        emergency={{
          grantId: grant.id,
          loadAttachment: (noteId, file) => api.emergency.download(grant.id, noteId, file),
        }}
      />
    </div>
  );
}

export function EmergencyPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [waitDays, setWaitDays] = useState(7);
  const [confirming, setConfirming] = useState(false);
  const list = useQuery({ queryKey: ['emergency'], queryFn: api.emergency.list });
  const directory = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.vaults.directory(),
  });

  const run = useMutation({
    mutationFn: async ({ fn, success }: { fn: () => Promise<unknown>; success?: string }) => {
      await fn();
      return success;
    },
    onSuccess: (success) => {
      if (success) toast.success(success);
      void qc.invalidateQueries({ queryKey: ['emergency'] });
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  const viewing = list.data?.received.find((g) => g.id === params.get('view') && g.accessible);
  if (viewing) return <EmergencyView grant={viewing} onBack={() => setParams({})} />;

  const granted = list.data?.granted ?? [];
  const received = list.data?.received ?? [];
  const candidates = (directory.data ?? []).filter((u) => !granted.some((g) => g.grantee.id === u.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('emergency.title')}</h1>
        <p className="text-fg-2">{t('emergency.subtitle')}</p>
      </div>

      <Card className="flex flex-col gap-5 p-5">
        <CardHeader title={t('emergency.myContacts')} subtitle={t('emergency.myContactsText')} />
        {list.isLoading ? (
          <Skeleton className="h-24" />
        ) : granted.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {granted.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{g.grantee.displayName}</span>
                  <span className="text-xs text-muted">
                    @{g.grantee.username} · {t('emergency.waitDays', { count: g.waitDays })}
                  </span>
                </span>
                <StatusBadge e={g} />
                {g.status === 'requested' ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger-outline"
                      onClick={() =>
                        run.mutate({ fn: () => api.emergency.reject(g.id), success: t('emergency.rejected') })
                      }
                    >
                      <X /> {t('emergency.reject')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        run.mutate({
                          fn: () => api.emergency.approve(g.id),
                          success: t('emergency.approved'),
                        })
                      }
                    >
                      <Check /> {t('emergency.approve')}
                    </Button>
                  </>
                ) : null}
                <Select
                  aria-label={t('emergency.waitLabel')}
                  value={g.waitDays}
                  onChange={(e) =>
                    run.mutate({ fn: () => api.emergency.setWait(g.id, Number(e.target.value)) })
                  }
                  className="h-8 w-auto pr-8 text-xs"
                >
                  {EMERGENCY_WAIT_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {t('emergency.waitDays', { count: d })}
                    </option>
                  ))}
                </Select>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${t('emergency.revoke')}: ${g.grantee.displayName}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('emergency.revokeTitle', { name: g.grantee.displayName }),
                      confirmLabel: t('emergency.revoke'),
                      danger: true,
                    });
                    if (ok) run.mutate({ fn: () => api.emergency.remove(g.id) });
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('emergency.noContacts')}</p>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (username) setConfirming(true);
          }}
        >
          <Field label={t('emergency.addContact')} className="min-w-52 flex-1">
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
          <Field label={t('emergency.waitLabel')}>
            {(a) => (
              <Select {...a} value={waitDays} onChange={(e) => setWaitDays(Number(e.target.value))}>
                {EMERGENCY_WAIT_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {t('emergency.waitDays', { count: d })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" disabled={!username} loading={run.isPending}>
            <UserPlus /> {t('emergency.add')}
          </Button>
        </form>
        <FingerprintLine publicKey={candidates.find((u) => u.username === username)?.publicKey} />
        <PasswordPrompt
          open={confirming}
          title={t('emergency.addContact')}
          confirmLabel={t('common.add', { defaultValue: t('common.continue') })}
          onClose={() => setConfirming(false)}
          onConfirm={async (password) => {
            await api.emergency.grant(username, waitDays, password);
            setConfirming(false);
            setUsername('');
            toast.success(t('emergency.added'));
            void qc.invalidateQueries({ queryKey: ['emergency'] });
          }}
        />
      </Card>

      <Card className="flex flex-col gap-5 p-5">
        <CardHeader title={t('emergency.trustedBy')} subtitle={t('emergency.trustedByText')} />
        {received.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {received.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{g.grantor.displayName}</span>
                  <span className="text-xs text-muted">
                    @{g.grantor.username} · {t('emergency.waitDays', { count: g.waitDays })}
                    {g.requestedAt
                      ? ` · ${t('emergency.requestedAgo', { time: relativeTime(g.requestedAt, i18n.language, t('common.justNow')) })}`
                      : ''}
                  </span>
                </span>
                <StatusBadge e={g} />
                {g.accessible ? (
                  <Button size="sm" variant="primary" onClick={() => setParams({ view: g.id })}>
                    <Eye /> {t('emergency.view')}
                  </Button>
                ) : g.status === 'idle' ? (
                  <Button
                    size="sm"
                    variant="danger-outline"
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('emergency.requestTitle', { name: g.grantor.displayName }),
                        description: t('emergency.requestText', { count: g.waitDays }),
                        confirmLabel: t('emergency.request'),
                        danger: true,
                      });
                      if (ok)
                        run.mutate({
                          fn: () => api.emergency.request(g.id),
                          success: t('emergency.requested'),
                        });
                    }}
                  >
                    <ShieldAlert /> {t('emergency.request')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<LifeBuoy />} title={t('emergency.noneReceived')} className="py-8" />
        )}
      </Card>
    </div>
  );
}
