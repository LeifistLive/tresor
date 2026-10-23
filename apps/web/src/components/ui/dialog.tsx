import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Hide the visual header (title stays available to screen readers). */
  hideHeader?: boolean;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  onInteractOutside?: (e: Event) => void;
}

const overlayClass =
  'fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  hideHeader,
  onEscapeKeyDown,
  onInteractOutside,
}: BaseProps) {
  const { t } = useTranslation();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          onEscapeKeyDown={onEscapeKeyDown}
          onInteractOutside={onInteractOutside}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[min(90dvh,860px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface-1 shadow-pop data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in',
            className,
          )}
        >
          <div className={cn('flex items-start gap-4 px-6 pt-6', hideHeader && 'sr-only')}>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
              {description ? (
                <D.Description className="text-sm text-fg-2">{description}</D.Description>
              ) : null}
            </div>
            <D.Close
              className="-mt-1 -mr-2 grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg"
              aria-label={t('common.close')}
            >
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-6 py-4">
              {footer}
            </div>
          ) : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  onPointerDownOutside?: (e: CustomEvent<{ originalEvent: PointerEvent }>) => void;
}

/** Side panel sliding in from the right (full screen on phones). */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  onEscapeKeyDown,
  onPointerDownOutside,
}: SheetProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          aria-describedby={undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          onPointerDownOutside={(e) => {
            // Clicks inside other layers (confirm dialogs, toasts) are not "outside" the sheet.
            const target = e.target as HTMLElement | null;
            if (target?.closest('[role="dialog"], [role="alertdialog"], [data-sonner-toaster]')) {
              e.preventDefault();
              return;
            }
            onPointerDownOutside?.(e);
          }}
          // Focus leaving the window (or moving into a confirm dialog) must never close the sheet.
          onFocusOutside={(e) => e.preventDefault()}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-line-strong bg-[color-mix(in_oklab,var(--surface-1)_92%,var(--bg))] shadow-pop sm:w-[540px] sm:border-l data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in"
        >
          <D.Title className="sr-only">{title}</D.Title>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const DialogClose = D.Close;
