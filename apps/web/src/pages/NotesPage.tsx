import { EXPIRY_WARNING_DAYS, NOTE_TYPES, type NoteDto, type NoteType } from '@tresor/shared';
import { LayoutGrid, List, Plus, Search, SearchX, StickyNote, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { TypeDot } from '@/components/notes/bits';
import { NoteCard } from '@/components/notes/NoteCard';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Card, EmptyState, Segmented, Skeleton } from '@/components/ui/misc';
import { useNotes, useUpdateNote } from '@/hooks/notes';
import { useVaults } from '@/hooks/vaults';
import { analyzePasswords, type HealthIssue } from '@/lib/health';
import { searchableText } from '@/lib/secrets';
import { cn } from '@/lib/utils';

type Sort = 'updated' | 'created' | 'title' | 'expires';
const VIEW_KEY = 'tresor.notesView';
const HEALTH: HealthIssue[] = ['weak', 'reused', 'old'];

function readView(): 'grid' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function isExpiringSoon(n: NoteDto, now = Date.now()) {
  if (!n.expiresAt) return false;
  return n.expiresAt <= new Date(now + EXPIRY_WARNING_DAYS * 86_400_000).toISOString().slice(0, 10);
}

export function NotesPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const notes = useNotes();
  const vaults = useVaults();
  const update = useUpdateNote();
  const [view, setView] = useState<'grid' | 'list'>(readView);
  const [sort, setSort] = useState<Sort>('updated');

  const type = (NOTE_TYPES as readonly string[]).includes(params.get('type') ?? '')
    ? (params.get('type') as NoteType)
    : null;
  const tag = params.get('tag');
  const vault = params.get('vault'); // 'personal' | vault id | null
  const expiring = params.get('filter') === 'expiring';
  const health = HEALTH.includes(params.get('health') as HealthIssue)
    ? (params.get('health') as HealthIssue)
    : null;
  const query = params.get('q') ?? '';
  const deferredQuery = useDeferredValue(query);
  const openId = params.get('id');
  const newType = (NOTE_TYPES as readonly string[]).includes(params.get('new') ?? '')
    ? (params.get('new') as NoteType)
    : null;

  const setParam = (key: string, value: string | null, replace = true) => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace },
    );
  };

  const all = notes.data ?? [];
  const allTags = useMemo(() => [...new Set(all.flatMap((n) => n.tags))].sort(), [all]);
  const report = useMemo(() => analyzePasswords(all), [all]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(NOTE_TYPES.map((x) => [x, 0])) as Record<NoteType, number>;
    for (const n of all) c[n.type]++;
    return c;
  }, [all]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const list = all.filter(
      (n) =>
        (!type || n.type === type) &&
        (!tag || n.tags.includes(tag)) &&
        (!vault || (vault === 'personal' ? n.vaultId === null : n.vaultId === vault)) &&
        (!expiring || isExpiringSoon(n)) &&
        (!health || report.issues.get(n.id)?.includes(health)) &&
        (terms.length === 0 || terms.every((term) => searchableText(n).includes(term))),
    );
    const collator = new Intl.Collator(i18n.language, { sensitivity: 'base', numeric: true });
    const by: Record<Sort, (a: NoteDto, b: NoteDto) => number> = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      title: (a, b) => collator.compare(a.title || '￿', b.title || '￿'),
      expires: (a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'),
    };
    return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || by[sort](a, b));
  }, [all, type, tag, vault, expiring, health, report, deferredQuery, sort, i18n.language]);

  const openNote = openId ? (all.find((n) => n.id === openId) ?? null) : null;
  const editorLoading = Boolean(openId && !openNote && notes.isLoading);
  const vaultName =
    vault === 'personal' ? t('vaults.personal') : vaults.data?.find((v) => v.id === vault)?.name;

  const closeEditor = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('id');
        next.delete('new');
        return next;
      },
      { replace: true },
    );

  const filtersActive = Boolean(type || tag || query || vault || expiring || health);
  const heading = health
    ? t(`health.${health}`)
    : expiring
      ? t('notes.expiringTitle')
      : type
        ? t(`typesPlural.${type}`)
        : (vaultName ?? t('notes.title'));

  const chip = (label: string, onRemove: () => void) => (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`${t('notes.removeFilter')}: ${label}`}
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-[13px] font-medium text-accent-text"
    >
      {label}
      <X className="size-3.5" />
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{heading}</h1>
          <span className="font-mono text-sm text-muted tabular-nums">{filtered.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label={t('notes.sortLabel')}
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-9 w-auto pr-9 text-[13px]"
          >
            <option value="updated">{t('notes.sortUpdated')}</option>
            <option value="created">{t('notes.sortCreated')}</option>
            <option value="title">{t('notes.sortTitle')}</option>
            <option value="expires">{t('notes.sortExpires')}</option>
          </Select>
          <Segmented
            label={t('notes.viewGrid')}
            value={view}
            onChange={(v) => {
              setView(v);
              try {
                localStorage.setItem(VIEW_KEY, v);
              } catch {
                /* ignore */
              }
            }}
            options={[
              { value: 'grid', label: <LayoutGrid />, ariaLabel: t('notes.viewGrid') },
              { value: 'list', label: <List />, ariaLabel: t('notes.viewList') },
            ]}
          />
        </div>
      </div>

      <label className="flex h-11 items-center gap-2.5 rounded-xl border border-line-strong bg-surface-1 px-3.5 text-muted focus-within:border-[color-mix(in_oklab,var(--mark)_70%,transparent)] focus-within:ring-4 focus-within:ring-accent-soft">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={t('notes.search', { count: all.length })}
          aria-label={t('common.search')}
          className="h-full flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('notes.filterLabel')}>
        <button
          type="button"
          aria-pressed={!type}
          onClick={() => setParam('type', null)}
          className={cn(
            'h-8 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
            !type ? 'border-fg bg-fg text-bg' : 'border-line-strong text-fg-2 hover:text-fg',
          )}
        >
          {t('common.all')} · {all.length}
        </button>
        {NOTE_TYPES.map((x) => (
          <button
            key={x}
            type="button"
            aria-pressed={type === x}
            onClick={() => setParam('type', type === x ? null : x)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors',
              type === x ? 'border-fg bg-fg text-bg' : 'border-line-strong text-fg-2 hover:text-fg',
            )}
          >
            <TypeDot type={x} />
            {t(`typesPlural.${x}`)}
            <span className="font-mono text-[11px] opacity-70">{counts[x]}</span>
          </button>
        ))}
        {tag ? chip(t('notes.tagFilter', { tag }), () => setParam('tag', null)) : null}
        {vault && vaultName ? chip(vaultName, () => setParam('vault', null)) : null}
        {expiring ? chip(t('notes.expiringTitle'), () => setParam('filter', null)) : null}
        {health ? chip(t(`health.${health}`), () => setParam('health', null)) : null}
      </div>

      {notes.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[176px] rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          {filtersActive ? (
            <EmptyState
              icon={<SearchX />}
              title={t('notes.emptyFiltered')}
              action={
                <Button onClick={() => setParams({}, { replace: true })}>{t('notes.clearFilters')}</Button>
              }
            />
          ) : (
            <EmptyState
              icon={<StickyNote />}
              title={t('dashboard.emptyTitle')}
              text={t('dashboard.emptyText')}
              action={
                <Button variant="primary" onClick={() => setParam('new', 'note', false)}>
                  <Plus /> {t('nav.newEntry')}
                </Button>
              }
            />
          )}
        </Card>
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((n) => (
            <div key={n.id} className="animate-pop-in">
              <NoteCard
                note={n}
                layout="grid"
                vaultName={n.vaultId ? vaults.data?.find((v) => v.id === n.vaultId)?.name : undefined}
                issues={report.issues.get(n.id)}
                onOpen={() => setParam('id', n.id, false)}
                onTogglePin={() => update.mutate({ id: n.id, patch: { pinned: !n.pinned } })}
              />
            </div>
          ))}
        </div>
      ) : (
        <Card className="flex flex-col p-1.5">
          {filtered.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              layout="list"
              vaultName={n.vaultId ? vaults.data?.find((v) => v.id === n.vaultId)?.name : undefined}
              issues={report.issues.get(n.id)}
              onOpen={() => setParam('id', n.id, false)}
              onTogglePin={() => update.mutate({ id: n.id, patch: { pinned: !n.pinned } })}
            />
          ))}
        </Card>
      )}

      <NoteEditor
        note={openNote}
        newType={openId ? null : newType}
        newVaultId={vault && vault !== 'personal' ? vault : null}
        loading={editorLoading}
        allTags={allTags}
        onClose={closeEditor}
        onCreated={(n) =>
          setParams(
            (p) => {
              const next = new URLSearchParams(p);
              next.delete('new');
              next.set('id', n.id);
              return next;
            },
            { replace: true },
          )
        }
      />
    </div>
  );
}
