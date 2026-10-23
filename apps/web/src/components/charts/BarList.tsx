import type { ReactNode } from 'react';

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Small identity mark next to the label (e.g. the entry type color). Never used on the bar itself. */
  marker?: ReactNode;
  onClick?: () => void;
}

/** Ranked horizontal bars in one hue – identity comes from the direct label, not from color. */
export function BarList({ items, max }: { items: BarListItem[]; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const content = (
          <>
            <div className="flex items-center gap-2 text-[13px]">
              {item.marker}
              <span className="truncate text-fg-2">{item.label}</span>
              <span className="ml-auto font-mono text-xs text-fg tabular-nums">{item.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-mark transition-[width] duration-500"
                style={{ width: `${item.value === 0 ? 0 : Math.max(2, (item.value / top) * 100)}%` }}
              />
            </div>
          </>
        );
        return (
          <li key={item.key}>
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="-mx-2 -my-1 flex w-[calc(100%+16px)] flex-col gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-surface-2"
              >
                {content}
              </button>
            ) : (
              <div className="flex flex-col gap-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Meter({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-2 overflow-hidden rounded-full bg-surface-3"
    >
      <div
        className="h-full rounded-full bg-mark transition-[width] duration-700"
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  );
}
