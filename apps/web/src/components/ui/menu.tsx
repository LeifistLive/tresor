import { DropdownMenu as M } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, align = 'end', ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-48 rounded-xl border border-line-strong bg-surface-1 p-1.5 shadow-pop data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

interface ItemProps extends ComponentProps<typeof M.Item> {
  icon?: ReactNode;
  danger?: boolean;
  shortcut?: string;
}

export function MenuItem({ className, icon, danger, shortcut, children, ...props }: ItemProps) {
  return (
    <M.Item
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg outline-none select-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-3 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted',
        danger && 'text-danger-text [&_svg]:text-danger-text',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut ? <span className="font-mono text-[11px] text-muted">{shortcut}</span> : null}
    </M.Item>
  );
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <M.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wider text-muted uppercase">
      {children}
    </M.Label>
  );
}
