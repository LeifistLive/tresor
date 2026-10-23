import { LIMITS } from '@tresor/shared';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

function normalize(tag: string) {
  return tag.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, LIMITS.tag);
}

export function TagInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const listId = useId();
  const inputId = useId();

  const add = (raw: string) => {
    const tag = normalize(raw);
    if (tag && !value.includes(tag) && value.length < LIMITS.tags) onChange([...value, tag]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-fg-2">
        {t('editor.tags')}
      </label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface-1 p-1.5 focus-within:border-[color-mix(in_oklab,var(--mark)_70%,transparent)] focus-within:ring-4 focus-within:ring-accent-soft">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-surface-3 pr-1 pl-2 text-xs text-fg-2"
          >
            #{tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== tag))}
              aria-label={t('editor.removeTag', { tag })}
              className="grid size-5 place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          list={listId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
              if (draft.trim()) {
                e.preventDefault();
                add(draft);
              }
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? '' : t('editor.tagPlaceholder')}
          className="h-7 min-w-28 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted"
        />
        <datalist id={listId}>
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      </div>
    </div>
  );
}
