import { ChevronDown } from 'lucide-react';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  'w-full rounded-[10px] border border-line-strong bg-surface-1 px-3 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted hover:border-[color-mix(in_oklab,var(--fg)_25%,transparent)] focus:border-[color-mix(in_oklab,var(--mark)_70%,transparent)] focus:ring-4 focus:ring-accent-soft disabled:opacity-60 aria-[invalid=true]:border-danger/60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(inputClass, 'min-h-24 resize-y py-2.5 leading-relaxed', className)} {...props} />
  );
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select className={cn(inputClass, 'h-10 appearance-none pr-9', className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
    </div>
  );
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  trailing?: ReactNode;
}

/** Label + control + hint/error, wired up for screen readers. */
export function Field({ label, hint, error, className, children, trailing }: FieldProps) {
  const id = useId();
  const descId = `${id}-desc`;
  const hasDesc = Boolean(error || hint);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-fg-2">
          {label}
        </label>
        {trailing}
      </div>
      {children({
        id,
        ...(hasDesc ? { 'aria-describedby': descId } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {hasDesc ? (
        <p id={descId} className={cn('text-xs', error ? 'text-danger-text' : 'text-muted')}>
          {error || hint}
        </p>
      ) : null}
    </div>
  );
}
