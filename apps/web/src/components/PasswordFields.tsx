import { PASSWORD_MIN, passwordStrength } from '@tresor/shared';
import { useTranslation } from 'react-i18next';
import { Field, Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  const score = passwordStrength(password);
  const labels = t('password.strength', { returnObjects: true }) as string[];
  if (!password) return null;
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1 rounded-full bg-surface-3 transition-colors',
              score >= i && (score <= 1 ? 'bg-danger' : score === 2 ? 'bg-warn' : 'bg-mark'),
            )}
          />
        ))}
      </div>
      <span className="text-xs text-muted">{t('password.strengthLabel', { label: labels[score] })}</span>
    </div>
  );
}

/** "New password" + "repeat" pair with strength meter and validation. */
export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  labels,
  touched,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  labels: { password: string; confirm: string };
  touched: boolean;
}) {
  const { t } = useTranslation();
  const tooShort = touched && password.length < PASSWORD_MIN;
  const mismatch = touched && confirm.length > 0 && confirm !== password;
  return (
    <>
      <Field
        label={labels.password}
        error={tooShort ? t('password.min', { count: PASSWORD_MIN }) : undefined}
      >
        {(a) => (
          <Input
            {...a}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            required
            minLength={PASSWORD_MIN}
          />
        )}
      </Field>
      <PasswordStrength password={password} />
      <Field label={labels.confirm} error={mismatch ? t('password.mismatch') : undefined}>
        {(a) => (
          <Input
            {...a}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => onConfirm(e.target.value)}
            required
          />
        )}
      </Field>
    </>
  );
}

export function passwordsValid(password: string, confirm: string) {
  return password.length >= PASSWORD_MIN && password === confirm;
}
