import { LoaderCircle } from 'lucide-react';
import { Tabs as T } from 'radix-ui';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-2xl border border-line bg-surface-1 shadow-card', className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  className,
  style,
  children,
  tone = 'neutral',
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok';
}) {
  const tones = {
    neutral: 'bg-surface-3 text-fg-2',
    accent: 'bg-accent-soft text-accent-text',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger-text',
    ok: 'bg-ok-soft text-ok',
  };
  return (
    <span
      style={style}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-5 animate-spin text-muted', className)} aria-hidden />;
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner className="size-6" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-16 text-center', className)}>
      <div className="grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-muted [&_svg]:size-6">
        {icon}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {text ? <p className="max-w-sm text-sm text-fg-2">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-3/70', className)} />;
}

/** Pill-style single choice (used for ranges, language, view mode). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  mono,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; ariaLabel?: string }[];
  label: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex gap-0.5 rounded-[10px] border border-line bg-surface-1 p-[3px]', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.ariaLabel}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-7 items-center justify-center gap-1.5 rounded-[7px] px-2.5 text-xs font-medium text-muted transition-colors hover:text-fg [&_svg]:size-3.5',
            value === o.value && 'bg-surface-3 text-fg',
            mono && 'font-mono',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn('flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        '-mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-fg data-[state=active]:border-mark data-[state=active]:text-fg [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
