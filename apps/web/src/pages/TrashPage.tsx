import { useQuery } from '@tanstack/react-query';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TypeIcon } from '@/components/notes/bits';
import { notePreview } from '@/components/notes/NoteCard';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Card, EmptyState, Skeleton } from '@/components/ui/misc';
import { useEmptyTrash, useNotes, usePurgeNote, useRestoreNote } from '@/hooks/notes';
import { api } from '@/lib/api';
import { cn, errorMessage, relativeTime } from '@/lib/utils';

export function TrashPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const trash = useNotes('trash');
  const restore = useRestoreNote();
  const purge = usePurgeNote();
  const empty = useEmptyTrash();
  const info = useQuery({ queryKey: ['info'], queryFn: api.info, staleTime: Number.POSITIVE_INFINITY });
  const items = trash.data ?? [];

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t('trash.title')}</h1>
          {info.data && info.data.trashRetentionDays > 0 ? (
            <p className="text-sm text-fg-2">
              {t('trash.subtitle', { count: info.data.trashRetentionDays })}
            </p>
          ) : null}
        </div>
        {items.length ? (
          <Button
            variant="danger-outline"
            loading={empty.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: t('trash.confirmEmpty', { count: items.length }),
                description: t('trash.irreversible'),
                confirmLabel: t('trash.emptyTrash'),
                danger: true,
              });
              if (ok) await run(() => empty.mutateAsync(), t('trash.purged'));
            }}
          >
            <Trash2 /> {t('trash.emptyTrash')}
          </Button>
        ) : null}
      </div>

      {trash.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<Trash2 />} title={t('trash.empty')} text={t('trash.emptyText')} />
        </Card>
      ) : (
        <Card className="flex flex-col p-1.5">
          {items.map((n) => {
            const preview = notePreview(n, t);
            return (
              <div key={n.id} className="flex items-center gap-3.5 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                <TypeIcon type={n.type} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{n.title || t('notes.untitled')}</span>
                  <span className={cn('truncate text-xs text-muted', preview.mono && 'font-mono')}>
                    {t('trash.deletedAt', {
                      time: relativeTime(n.deletedAt, i18n.language, t('common.justNow')),
                    })}
                    {preview.text ? ` · ${preview.text}` : ''}
                  </span>
                </div>
                <Button size="sm" onClick={() => run(() => restore.mutateAsync(n.id), t('trash.restored'))}>
                  <ArchiveRestore /> <span className="hidden sm:inline">{t('trash.restore')}</span>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('trash.deleteForever')}
                  title={t('trash.deleteForever')}
                  className="text-danger-text"
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('trash.confirmDelete', { title: n.title || t('notes.untitled') }),
                      description: t('trash.irreversible'),
                      confirmLabel: t('trash.deleteForever'),
                      danger: true,
                    });
                    if (ok) await run(() => purge.mutateAsync(n.id), t('trash.purged'));
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
