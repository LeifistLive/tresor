import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttachmentDto } from '@tresor/shared';
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm';
import { Spinner } from '@/components/ui/misc';
import { api, fileBlob, saveFile } from '@/lib/api';
import { cn, errorMessage, formatBytes } from '@/lib/utils';

const IMAGE = /^image\/(png|jpeg|gif|webp|avif)$/;

type Loader = (file: AttachmentDto) => Promise<Uint8Array>;

/** Decrypted image preview, held as a local object URL while visible. */
function Thumbnail({ file, load, onOpen }: { file: AttachmentDto; load: Loader; onOpen: () => void }) {
  const data = useQuery({
    queryKey: ['attachment', file.id],
    queryFn: () => load(file),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60_000,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data.data) return;
    const u = URL.createObjectURL(fileBlob(data.data, file.mime));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data.data, file.mime]);
  return (
    <button type="button" onClick={onOpen} className="shrink-0" aria-label={file.name}>
      {url ? (
        <img src={url} alt="" className="size-11 rounded-lg bg-surface-3 object-cover" />
      ) : (
        <span className="grid size-11 place-items-center rounded-lg bg-surface-3">
          <Spinner className="size-4" />
        </span>
      )}
    </button>
  );
}

export function Attachments({
  noteId,
  files,
  readOnly,
  load = (file) => api.attachments.download(noteId ?? '', file),
}: {
  noteId: string | null;
  files: AttachmentDto[];
  readOnly?: boolean;
  /** Fetches and decrypts a file (defaults to the entry's own attachments). */
  load?: Loader;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = async (list: FileList | File[] | null) => {
    if (!noteId || !list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) await api.attachments.upload(noteId, file);
      toast.success(t('editor.attachmentAdded', { count: list.length }));
      await qc.invalidateQueries({ queryKey: ['notes'] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (file: AttachmentDto) => {
    if (!noteId) return;
    const ok = await confirm({
      title: t('editor.attachmentDelete', { name: file.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.attachments.remove(noteId, file.id);
      await qc.invalidateQueries({ queryKey: ['notes'] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  /** Images and PDFs open in a new tab (as local blob), everything else is downloaded. */
  const open = async (file: AttachmentDto, forceDownload = false) => {
    try {
      const data = await load(file);
      const blob = fileBlob(data, file.mime);
      if (forceDownload || blob.type === 'application/octet-stream') {
        saveFile(data, file.name);
        return;
      }
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  if (readOnly && files.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
        <Paperclip className="size-3.5" aria-hidden /> {t('editor.attachments')}
      </span>
      {files.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-1 p-2 pr-1.5"
            >
              {IMAGE.test(f.mime) ? (
                <Thumbnail file={f} load={load} onOpen={() => void open(f)} />
              ) : (
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface-3 text-muted">
                  <FileText className="size-5" aria-hidden />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium" title={f.name}>
                  {f.name}
                </span>
                <span className="text-xs text-muted">{formatBytes(f.size, i18n.language)}</span>
              </span>
              <button
                type="button"
                onClick={() => void open(f, true)}
                aria-label={`${t('editor.download')}: ${f.name}`}
                title={t('editor.download')}
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg"
              >
                <Download className="size-4" />
              </button>
              {readOnly ? null : (
                <button
                  type="button"
                  onClick={() => void remove(f)}
                  aria-label={`${t('common.delete')}: ${f.name}`}
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger-text"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {readOnly ? null : noteId ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(e.dataTransfer.files);
          }}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-3 text-[13px] text-fg-2 transition-colors hover:bg-surface-2',
            dragging && 'border-[color-mix(in_oklab,var(--mark)_70%,transparent)] bg-accent-soft',
          )}
        >
          {busy ? <Spinner className="size-4" /> : <Upload className="size-4" aria-hidden />}
          {t('editor.attachmentDrop')}
        </button>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-xs text-muted">
          {t('editor.attachmentSaveFirst')}
        </p>
      )}
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => void upload(e.target.files)}
      />
    </div>
  );
}
