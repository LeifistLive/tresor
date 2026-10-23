import { type CustomField, LIMITS } from '@tresor/shared';
import { Copy, Eye, EyeOff, LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { IconAction, useCopy } from './FieldInput';

function Row({
  field,
  onChange,
  onRemove,
  readOnly,
}: {
  field: CustomField;
  onChange: (f: CustomField) => void;
  onRemove: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const copy = useCopy();
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
      <Input
        value={field.label}
        onChange={(e) => onChange({ ...field, label: e.target.value })}
        placeholder={t('editor.customLabel')}
        aria-label={t('editor.customLabel')}
        maxLength={LIMITS.customLabel}
        readOnly={readOnly}
        className="text-[13px]"
      />
      <Input
        value={field.value}
        onChange={(e) => onChange({ ...field, value: e.target.value })}
        placeholder={t('editor.customValue')}
        aria-label={field.label || t('editor.customValue')}
        type={field.secret && !revealed ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        readOnly={readOnly}
        className={cn('text-[13px]', field.secret && 'font-mono')}
      />
      <div className="flex items-center">
        {field.secret ? (
          <IconAction
            label={revealed ? t('common.hide') : t('common.reveal')}
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed ? <EyeOff /> : <Eye />}
          </IconAction>
        ) : null}
        {field.value ? (
          <IconAction label={t('common.copy')} onClick={() => copy(field.value)}>
            <Copy />
          </IconAction>
        ) : null}
        {readOnly ? null : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={field.secret}
              aria-label={t('editor.customSecret')}
              title={t('editor.customSecret')}
              onClick={() => onChange({ ...field, secret: !field.secret })}
              className={cn('text-muted', field.secret && 'text-accent-text')}
            >
              <LockKeyhole />
            </Button>
            <IconAction label={t('common.delete')} onClick={onRemove}>
              <Trash2 />
            </IconAction>
          </>
        )}
      </div>
    </div>
  );
}

export function CustomFields({
  value,
  onChange,
  readOnly,
}: {
  value: CustomField[];
  onChange: (fields: CustomField[]) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  if (readOnly && value.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-fg-2">{t('editor.customFields')}</span>
      {value.map((f, i) => (
        <Row
          key={i}
          field={f}
          readOnly={readOnly}
          onChange={(next) => onChange(value.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
        />
      ))}
      {readOnly || value.length >= LIMITS.customFields ? null : (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange([...value, { label: '', value: '', secret: false }])}
          >
            <Plus /> {t('editor.addCustomField')}
          </Button>
        </div>
      )}
    </div>
  );
}
