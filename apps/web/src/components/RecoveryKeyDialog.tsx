import { Copy, Download, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCopy } from '@/components/notes/FieldInput';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { downloadText } from '@/lib/utils';

/** Shows a freshly issued recovery key once and only lets the user continue after confirming they stored it. */
export function RecoveryKeyDialog({
  recoveryKey,
  username,
  onDone,
}: {
  recoveryKey: string | null;
  username: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const copy = useCopy();
  const [confirmed, setConfirmed] = useState(false);

  const save = () => {
    const content = [
      t('recoveryKey.fileHeader'),
      '',
      `${t('recoveryKey.fileUser')}: ${username}`,
      `${t('recoveryKey.fileCreated')}: ${new Date().toLocaleString()}`,
      '',
      recoveryKey ?? '',
      '',
      t('recoveryKey.warning'),
      '',
    ].join('\n');
    downloadText(`tresor-recovery-key-${username}.txt`, content);
  };

  return (
    <Dialog
      open={recoveryKey !== null}
      onOpenChange={() => {}}
      title={t('recoveryKey.title')}
      description={t('recoveryKey.text')}
      onEscapeKeyDown={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      footer={
        <Button
          variant="primary"
          disabled={!confirmed}
          onClick={() => {
            setConfirmed(false);
            onDone();
          }}
        >
          {t('common.continue')}
        </Button>
      }
    >
      <div className="grid grid-cols-4 gap-x-3 gap-y-1.5 rounded-xl border border-line-strong bg-surface-2 px-4 py-3.5 text-center font-mono text-base font-medium tracking-wider select-all sm:text-[17px]">
        {recoveryKey?.split('-').map((group, i) => (
          <span key={i}>{group}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => recoveryKey && copy(recoveryKey)}>
          <Copy /> {t('common.copy')}
        </Button>
        <Button size="sm" onClick={save}>
          <Download /> {t('recoveryKey.download')}
        </Button>
      </div>
      <p className="flex gap-2.5 rounded-xl bg-warn-soft p-3 text-[13px] text-fg">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        {t('recoveryKey.warning')}
      </p>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="size-4 accent-[var(--mark)]"
        />
        {t('recoveryKey.confirm')}
      </label>
    </Dialog>
  );
}
