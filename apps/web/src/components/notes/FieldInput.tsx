import { type FieldDef, isValidMatterCode, isValidMatterQrPayload, type NoteType } from '@tresor/shared';
import { Copy, Dices, ExternalLink, Eye, EyeOff, ScanQrCode } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, inputClass, Select } from '@/components/ui/input';
import { copySecret, generatePassword } from '@/lib/secrets';
import { currentCode, parseTotp } from '@/lib/totp';
import { cn } from '@/lib/utils';

interface Props {
  type: NoteType;
  def: FieldDef;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** Opens the QR scanner for this field (Matter payload, TOTP). */
  onScan?: () => void;
}

export function useCopy() {
  const { t } = useTranslation();
  return async (value: string) => {
    try {
      const seconds = await copySecret(value);
      toast.success(t('common.copied', { seconds }));
    } catch {
      toast.error(t('errors.INTERNAL'));
    }
  };
}

export function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-muted"
    >
      {children}
    </Button>
  );
}

/** Live 6-digit code with a countdown ring. */
export function TotpCode({ seed }: { seed: string }) {
  const { t } = useTranslation();
  const copy = useCopy();
  const info = useMemo(() => parseTotp(seed), [seed]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!info) return <p className="text-xs text-danger-text">{t('editor.totpInvalid')}</p>;
  const { code, remaining, period } = currentCode(info, now);
  const r = 9;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5">
      <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="3" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={remaining <= 5 ? 'var(--warn)' : 'var(--mark)'}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - remaining / period)}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="font-mono text-2xl font-medium tracking-[0.2em] tabular-nums" aria-live="polite">
        {code.slice(0, 3)} {code.slice(3)}
      </span>
      <span className="text-xs text-muted">{t('editor.totpRemaining', { count: remaining })}</span>
      <Button size="sm" className="ml-auto" onClick={() => copy(code)}>
        <Copy /> {t('common.copy')}
      </Button>
    </div>
  );
}

export function FieldInput({ type, def, value, onChange, readOnly, onScan }: Props) {
  const { t } = useTranslation();
  const copy = useCopy();
  const [revealed, setRevealed] = useState(false);
  const label = t(`fields.${type}.${def.key}`);
  const isSecret = def.kind === 'secret' || def.kind === 'multiline' || def.kind === 'totp';
  const canGenerate = !readOnly && def.kind === 'secret' && def.key === 'password';

  let error: string | undefined;
  if (value && def.kind === 'matterCode' && !isValidMatterCode(value)) error = t('editor.invalidMatterCode');
  if (value && def.kind === 'matterQr' && !isValidMatterQrPayload(value)) error = t('editor.invalidMatterQr');

  const placeholder =
    def.kind === 'matterCode'
      ? t('placeholders.setupCode')
      : def.kind === 'matterQr'
        ? t('placeholders.qrPayload')
        : def.kind === 'url'
          ? t('placeholders.url')
          : def.kind === 'totp'
            ? t('placeholders.totp')
            : def.key === 'expiry'
              ? t('placeholders.expiry')
              : def.kind === 'multiline'
                ? t('placeholders.secret')
                : undefined;

  const actions = (
    <div className="flex items-center gap-0.5">
      {onScan && !readOnly ? (
        <IconAction label={t('scan.button')} onClick={onScan}>
          <ScanQrCode />
        </IconAction>
      ) : null}
      {isSecret ? (
        <IconAction
          label={revealed ? t('common.hide') : t('common.reveal')}
          onClick={() => setRevealed((r) => !r)}
        >
          {revealed ? <EyeOff /> : <Eye />}
        </IconAction>
      ) : null}
      {canGenerate ? (
        <IconAction
          label={t('common.generate')}
          onClick={() => {
            onChange(generatePassword());
            setRevealed(true);
            toast.success(t('editor.generated'));
          }}
        >
          <Dices />
        </IconAction>
      ) : null}
      {def.kind === 'url' && /^https?:\/\//i.test(value) ? (
        <IconAction
          label={t('editor.openUrl')}
          onClick={() => window.open(value, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink />
        </IconAction>
      ) : null}
      {value && def.kind !== 'select' && def.kind !== 'totp' ? (
        <IconAction label={t('common.copy')} onClick={() => copy(value)}>
          <Copy />
        </IconAction>
      ) : null}
    </div>
  );

  return (
    <Field
      label={label}
      error={error}
      trailing={actions}
      className={cn((def.kind === 'multiline' || def.kind === 'totp') && 'sm:col-span-2')}
    >
      {(a11y) =>
        def.kind === 'select' ? (
          <Select {...a11y} value={value} onChange={(e) => onChange(e.target.value)} disabled={readOnly}>
            <option value="">{t('options.none')}</option>
            {def.options?.map((o) => (
              <option key={o} value={o}>
                {t(`options.${o}`)}
              </option>
            ))}
          </Select>
        ) : def.kind === 'multiline' ? (
          <textarea
            {...a11y}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            readOnly={readOnly}
            rows={4}
            className={cn(
              inputClass,
              'min-h-24 resize-y py-2.5 font-mono text-[13px] leading-relaxed',
              !revealed && value && 'blur-[5px] select-none hover:blur-[4px]',
            )}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {def.kind === 'totp' && value ? <TotpCode seed={value} /> : null}
            {def.kind === 'totp' && value && readOnly && !revealed ? null : (
              <Input
                {...a11y}
                type={isSecret && !revealed ? 'password' : def.kind === 'url' ? 'url' : 'text'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                spellCheck={false}
                readOnly={readOnly}
                autoComplete={isSecret ? 'new-password' : 'off'}
                inputMode={def.kind === 'matterCode' ? 'numeric' : undefined}
                className={cn(def.mono && 'font-mono text-[13px] tracking-wide')}
              />
            )}
          </div>
        )
      }
    </Field>
  );
}
