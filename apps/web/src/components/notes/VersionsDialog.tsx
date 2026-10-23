import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { cn, errorMessage, formatDate, relativeTime } from '@/lib/utils';

export function VersionsDialog({
  noteId,
  open,
  onOpenChange,
  canRestore,
  onRestored,
}: {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore: boolean;
  onRestored: () => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Versions arrive encrypted and are decrypted here in full, so picking one needs no further request.
  const list = useQuery({
    queryKey: ['versions', noteId],
    queryFn: () => api.versions.list(noteId),
    enabled: open,
  });

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.versions.restore(noteId, selected);
      await qc.invalidateQueries({ queryKey: ['notes'] });
      await qc.invalidateQueries({ queryKey: ['versions', noteId] });
      toast.success(t('editor.versionRestored'));
      onRestored();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const v = list.data?.find((x) => x.id === selected);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSelected(null);
        onOpenChange(o);
      }}
      title={t('editor.history')}
      description={t('editor.historyText')}
      className="max-w-2xl"
    >
      {list.isLoading ? (
        <Spinner />
      ) : !list.data?.length ? (
        <EmptyState icon={<History />} title={t('editor.noVersions')} className="py-8" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {list.data.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelected(item.id)}
                  className={cn(
                    'flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-surface-2',
                    selected === item.id && 'bg-surface-3 hover:bg-surface-3',
                  )}
                >
                  <span className="truncate text-sm font-medium">{item.title || t('notes.untitled')}</span>
                  <span className="text-xs text-muted">
                    {relativeTime(item.createdAt, i18n.language, t('common.justNow'))}
                    {item.author ? ` · @${item.author}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-40 rounded-xl border border-line bg-surface-2 p-4">
            {!selected ? (
              <p className="text-sm text-muted">{t('editor.pickVersion')}</p>
            ) : !v ? (
              <Spinner />
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <span className="text-xs text-muted">
                  {formatDate(v.createdAt, i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                <span className="text-base font-semibold">{v.title || t('notes.untitled')}</span>
                {Object.keys(v.fields).length ? (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
                    {Object.entries(v.fields).map(([k, val]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted">{t(`fields.${v.type}.${k}`, { defaultValue: k })}</dt>
                        <dd className="truncate font-mono">
                          {/password|pin|cvc|number|value|totp/.test(k) ? '••••••' : val}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {v.content ? <p className="line-clamp-6 whitespace-pre-wrap text-fg-2">{v.content}</p> : null}
                {canRestore ? (
                  <div className="pt-1">
                    <Button size="sm" variant="primary" loading={busy} onClick={() => void restore()}>
                      <RotateCcw /> {t('editor.restoreVersion')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
