import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';
import { Dialog } from './dialog';
import { Input } from './input';

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
  /** Require the user to type this text before confirming. */
  typeToConfirm?: { value: string; label: string };
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<(v: boolean) => void>(undefined);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setTyped('');
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = undefined;
    setOptions(null);
  };

  const blocked = options?.typeToConfirm ? typed.trim() !== options.typeToConfirm.value : false;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        onOpenChange={(open) => !open && close(false)}
        title={options?.title}
        description={options?.description}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {options?.cancelLabel ?? t('common.cancel')}
            </Button>
            <Button
              variant={options?.danger ? 'danger' : 'primary'}
              disabled={blocked}
              onClick={() => close(true)}
              autoFocus={!options?.typeToConfirm}
            >
              {options?.confirmLabel ?? t('common.confirm')}
            </Button>
          </>
        }
      >
        {options?.typeToConfirm ? (
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg-2">
            {options.typeToConfirm.label}
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
          </label>
        ) : null}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
