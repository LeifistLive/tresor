import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/utils';

/** Asks for the account password before a sensitive action (the browser turns it into a login proof). */
export function PasswordPrompt({
  open,
  title,
  onClose,
  onConfirm,
  confirmLabel,
  danger,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (password: string) => Promise<void>;
  confirmLabel: string;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPassword('');
          onClose();
        }
      }}
      title={title}
      description={t('settings.confirmWithPassword')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onConfirm(password);
            setPassword('');
          } catch (err) {
            toast.error(errorMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          type="password"
          autoComplete="current-password"
          aria-label={t('settings.currentPassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
