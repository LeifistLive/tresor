import type { DayCount } from '@tresor/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn, formatDay } from '@/lib/utils';

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 4, 5, 10]) if (step * pow >= v) return step * pow;
  return 10 * pow;
}

interface Props {
  data: DayCount[];
  /** i18next key with _one/_other plural forms for the tooltip value. */
  valueKey: string;
  label: string;
  height?: number;
}

/**
 * Single-series column chart: thin bars with rounded data ends, hairline grid, hover/focus tooltip
 * and a screen-reader table. One series → no legend; the card title names it.
 */
export function ColumnChart({ data, valueKey, label, height = 168 }: Props) {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const max = niceMax(Math.max(0, ...data.map((d) => d.count)));
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const plotH = height - 12;

  const activeItem = active !== null ? data[active] : undefined;
  const tooltipLeft = active !== null ? ((active + 0.5) / data.length) * 100 : 0;

  return (
    <figure className="relative m-0 flex flex-col gap-2" aria-describedby={tableId}>
      <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
        <div
          className="flex flex-col justify-between text-right font-mono text-[11px] text-muted tabular-nums"
          style={{ height }}
          aria-hidden
        >
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: hover is a mouse-only enhancement; the data is also in the table below */}
        <div className="relative" style={{ height }} onMouseLeave={() => setActive(null)}>
          <div className="absolute inset-x-0 top-1.5 border-t border-line" aria-hidden />
          <div
            className="absolute inset-x-0 border-t border-line"
            style={{ top: 6 + plotH / 2 }}
            aria-hidden
          />
          <div className="absolute inset-x-0 bottom-1.5 border-t border-line-strong" aria-hidden />
          <div
            className="absolute inset-x-0 top-1.5 bottom-1.5 flex items-end"
            style={{ gap: data.length > 40 ? 2 : 4 }}
            role="img"
            aria-label={label}
          >
            {data.map((d, i) => (
              <button
                key={d.date}
                type="button"
                tabIndex={-1}
                aria-hidden
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                className="group relative flex h-full flex-1 items-end"
              >
                <span
                  className={cn(
                    'block w-full rounded-t-[4px] transition-[background-color,opacity] duration-150',
                    active === i ? 'bg-accent' : 'bg-mark',
                    active !== null && active !== i && 'opacity-55',
                  )}
                  style={{
                    height: d.count === 0 ? 2 : Math.max(4, (d.count / max) * plotH),
                    opacity: d.count === 0 ? 0.35 : undefined,
                  }}
                />
              </button>
            ))}
          </div>
          {activeItem ? (
            <div
              className="pointer-events-none absolute -top-2 z-10 flex -translate-x-1/2 -translate-y-full flex-col gap-0.5 rounded-[10px] border border-line-strong bg-surface-1 px-2.5 py-2 text-xs whitespace-nowrap shadow-pop"
              style={{ left: `clamp(48px, ${tooltipLeft}%, calc(100% - 48px))` }}
            >
              <span className="text-fg-2">
                {formatDay(activeItem.date, i18n.language, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
              <span className="font-semibold">{t(valueKey, { count: activeItem.count })}</span>
            </div>
          ) : null}
        </div>
        <span />
        <div className="relative h-4 font-mono text-[11px] text-muted" aria-hidden>
          {data.map((d, i) =>
            i % labelEvery === 0 && data.length - i > labelEvery / 2 ? (
              <span
                key={d.date}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${((i + 0.5) / data.length) * 100}%` }}
              >
                {formatDay(d.date, i18n.language, { day: 'numeric', month: 'short' })}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <table id={tableId} className="sr-only">
        <caption>{t('dashboard.chartTable')}</caption>
        <thead>
          <tr>
            <th>{t('dashboard.date')}</th>
            <th>{t('dashboard.count')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
