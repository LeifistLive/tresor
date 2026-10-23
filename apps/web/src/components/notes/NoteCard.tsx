import { formatMatterCode, type NoteDto } from '@tresor/shared';
import type { TFunction } from 'i18next';
import { CalendarClock, Copy, Paperclip, Pin, ShieldAlert, Users } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthIssue } from '@/lib/health';
import { primarySecret } from '@/lib/secrets';
import { cn, formatDate, plainText, relativeTime } from '@/lib/utils';
import { TypeBadge, TypeIcon } from './bits';
import { useCopy } from './FieldInput';

const DOTS = '••••••••';

/** One-line summary of an entry for cards and lists. Never reveals secret fields. */
export function notePreview(note: NoteDto, t: TFunction): { text: string; mono: boolean } {
  const f = note.fields;
  const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ');
  switch (note.type) {
    case 'matter':
      return {
        text:
          join(f.setupCode && formatMatterCode(f.setupCode), f.manufacturer, f.model, f.room) ||
          plainText(note.content),
        mono: Boolean(f.setupCode),
      };
    case 'login':
      return { text: join(f.username, f.password && DOTS) || f.url || plainText(note.content), mono: true };
    case 'wifi':
      return { text: join(f.ssid, f.security && t(`options.${f.security}`), f.password && DOTS), mono: true };
    case 'card':
      return {
        text: join(f.holder, f.number && `•••• ${f.number.replace(/\s/g, '').slice(-4)}`, f.expiry),
        mono: true,
      };
    case 'secret':
      return { text: join(f.value && DOTS, plainText(note.content, 120)), mono: false };
    default:
      return { text: plainText(note.content), mono: false };
  }
}

interface Props {
  note: NoteDto;
  onOpen: () => void;
  onTogglePin: () => void;
  layout: 'grid' | 'list';
  vaultName?: string;
  issues?: HealthIssue[];
}

/** Small status chips: shared vault, attachments, expiry date, password health. */
function MetaChips({ note, vaultName, issues }: Pick<Props, 'note' | 'vaultName' | 'issues'>) {
  const { t, i18n } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const chips: ReactElement[] = [];
  if (vaultName) {
    chips.push(
      <span
        key="vault"
        className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-xs text-fg-2"
      >
        <Users className="size-3" aria-hidden /> {vaultName}
      </span>,
    );
  }
  if (note.attachments.length) {
    chips.push(
      <span
        key="files"
        className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-xs text-fg-2"
      >
        <Paperclip className="size-3" aria-hidden />
        <span className="sr-only">{t('editor.attachments')}:</span> {note.attachments.length}
      </span>,
    );
  }
  if (note.expiresAt) {
    const state = note.expiresAt < today ? 'expired' : note.expiresAt <= soon ? 'soon' : 'ok';
    chips.push(
      <span
        key="exp"
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs',
          state === 'ok'
            ? 'bg-surface-3 text-fg-2'
            : state === 'soon'
              ? 'bg-warn-soft text-warn'
              : 'bg-danger-soft text-danger-text',
        )}
      >
        <CalendarClock className="size-3" aria-hidden />
        {state === 'expired'
          ? t('notes.expired')
          : formatDate(note.expiresAt, i18n.language, { dateStyle: 'medium' })}
      </span>,
    );
  }
  if (issues?.length) {
    chips.push(
      <span
        key="health"
        className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-2 py-0.5 text-xs text-warn"
      >
        <ShieldAlert className="size-3" aria-hidden /> {issues.map((i) => t(`health.short_${i}`)).join(', ')}
      </span>,
    );
  }
  return chips.length ? chips : null;
}

export function NoteCard({ note, onOpen, onTogglePin, layout, vaultName, issues }: Props) {
  const { t, i18n } = useTranslation();
  const copy = useCopy();
  const preview = notePreview(note, t);
  const secret = primarySecret(note);
  const time = relativeTime(note.updatedAt, i18n.language, t('common.justNow'));
  const title = note.title || t('notes.untitled');

  const actions = (
    <div className="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
      {secret ? (
        <button
          type="button"
          onClick={() => copy(secret)}
          aria-label={`${t('notes.copySecret')}: ${title}`}
          title={t('notes.copySecret')}
          className="relative z-10 grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg"
        >
          <Copy className="size-4" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onTogglePin}
        aria-pressed={note.pinned}
        aria-label={`${note.pinned ? t('notes.unpin') : t('notes.pin')}: ${title}`}
        title={note.pinned ? t('notes.unpin') : t('notes.pin')}
        className="relative z-10 grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg"
      >
        <Pin className={cn('size-4', note.pinned && 'fill-current text-accent-text')} />
      </button>
    </div>
  );

  if (layout === 'list') {
    return (
      <article className="group relative flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2 focus-within:bg-surface-2">
        <TypeIcon type={note.type} />
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={onOpen}
            className="truncate text-left font-medium after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </button>
          <span className={cn('truncate text-xs text-muted', preview.mono && 'font-mono')}>
            {preview.text || t(`types.${note.type}`)}
          </span>
        </div>
        <div className="hidden shrink-0 items-center gap-1 lg:flex">
          <MetaChips note={note} vaultName={vaultName} issues={issues} />
        </div>
        <div className="hidden max-w-52 shrink-0 gap-1 md:flex">
          {note.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="truncate rounded-md bg-surface-3 px-2 py-0.5 text-xs text-fg-2">
              #{tag}
            </span>
          ))}
        </div>
        {note.pinned ? (
          <Pin
            className="size-3.5 shrink-0 fill-current text-muted group-hover:hidden"
            aria-label={t('notes.pinned')}
          />
        ) : null}
        {actions}
        <span className="hidden w-24 shrink-0 text-right text-xs text-muted sm:block">{time}</span>
      </article>
    );
  }

  return (
    <article className="group relative flex min-h-[176px] flex-col gap-3.5 rounded-2xl border border-line bg-surface-1 p-4 shadow-card transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop focus-within:border-line-strong">
      <div className="flex items-center gap-2">
        <TypeBadge type={note.type} />
        {note.pinned ? (
          <Pin className="size-3.5 fill-current text-muted" aria-label={t('notes.pinned')} />
        ) : null}
        <span className="ml-auto text-xs text-muted group-hover:hidden">{time}</span>
        <div className="ml-auto hidden group-focus-within:flex group-hover:flex">{actions}</div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="text-[15px] leading-snug font-semibold">
          <button
            type="button"
            onClick={onOpen}
            className="text-left outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--accent)]"
          >
            {title}
          </button>
        </h3>
        {preview.text ? (
          <p
            className={cn(
              'line-clamp-3 text-[13px] leading-relaxed text-fg-2',
              preview.mono && 'font-mono text-xs',
            )}
          >
            {preview.text}
          </p>
        ) : null}
      </div>
      {note.tags.length || note.attachments.length || note.expiresAt || vaultName || issues?.length ? (
        <div className="mt-auto flex flex-wrap gap-1.5">
          <MetaChips note={note} vaultName={vaultName} issues={issues} />
          {note.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-md bg-surface-3 px-2 py-0.5 text-xs text-fg-2">
              #{tag}
            </span>
          ))}
          {note.tags.length > 4 ? (
            <span className="px-1 text-xs text-muted">+{note.tags.length - 4}</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
