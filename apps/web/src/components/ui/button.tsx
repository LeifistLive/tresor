import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  primary:
    'bg-accent text-accent-ink font-semibold hover:bg-accent-hover shadow-[0_1px_0_rgb(255_255_255/0.25)_inset]',
  secondary: 'border border-line-strong bg-surface-2 text-fg hover:bg-surface-3',
  ghost: 'text-fg-2 hover:bg-surface-3 hover:text-fg',
  outline: 'border border-line-strong text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white font-semibold hover:opacity-90',
  'danger-outline': 'border border-danger/35 text-danger-text hover:bg-danger-soft',
} as const;

const sizes = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-[10px]',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'size-10 rounded-[10px]',
  'icon-sm': 'size-8 rounded-lg',
} as const;

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
