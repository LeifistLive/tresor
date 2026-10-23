import type { NoteType } from '@tresor/shared';
import { useTranslation } from 'react-i18next';
import { encode } from 'uqr';
import { TYPE_ICONS, typeColor, typeTint } from '@/lib/note-types';
import { cn } from '@/lib/utils';

export function TypeBadge({
  type,
  className,
  plural,
}: {
  type: NoteType;
  className?: string;
  plural?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = TYPE_ICONS[type];
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={typeTint(type)}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(plural ? `typesPlural.${type}` : `types.${type}`)}
    </span>
  );
}

export function TypeIcon({ type, size = 'md' }: { type: NoteType; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = TYPE_ICONS[type];
  const box = {
    sm: 'size-7 rounded-lg [&_svg]:size-3.5',
    md: 'size-9 rounded-[10px] [&_svg]:size-[18px]',
    lg: 'size-11 rounded-xl [&_svg]:size-5',
  }[size];
  return (
    <span className={cn('grid shrink-0 place-items-center', box)} style={typeTint(type)} aria-hidden>
      <Icon />
    </span>
  );
}

export function TypeDot({ type }: { type: NoteType }) {
  return (
    <span className="size-2 shrink-0 rounded-[3px]" style={{ background: typeColor(type) }} aria-hidden />
  );
}

/** QR code rendered as crisp SVG (always dark-on-white so phone cameras can read it in dark mode). */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, data } = encode(value, { ecc: 'M', border: 0 });
  let d = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x]) {
        const start = x;
        while (x < row.length && row[x]) x++;
        d += `M${start} ${y}h${x - start}v1h-${x - start}z`;
      } else x++;
    }
  });
  return (
    <div className={cn('rounded-xl bg-white p-3', className)}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={label}
        className="block size-full"
      >
        <path d={d} fill="#0A0B0F" />
      </svg>
    </div>
  );
}
