import {
  formatMatterCode,
  formatVendorId,
  isValidMatterCode,
  manualCodeFromSetup,
  normalizeMatterCode,
  parseMatterQr,
} from '@tresor/shared';
import { Copy, Maximize2, QrCode as QrIcon, ScanQrCode, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { QrCode } from './bits';
import { useCopy } from './FieldInput';

export function MatterPanel({
  setupCode,
  qrPayload,
  onScan,
  onEnlarge,
  readOnly,
}: {
  setupCode: string;
  qrPayload: string;
  onScan: () => void;
  onEnlarge: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const copy = useCopy();
  const info = qrPayload ? parseMatterQr(qrPayload) : null;
  const derived = info ? manualCodeFromSetup(info) : null;
  const code = setupCode || (derived ? formatMatterCode(derived) : '');
  const mismatch = Boolean(derived && setupCode && normalizeMatterCode(setupCode) !== derived);
  const checkFailed = Boolean(setupCode && !isValidMatterCode(setupCode));

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <div className="flex flex-col gap-5 sm:flex-row">
        {info ? (
          <button
            type="button"
            onClick={onEnlarge}
            className="group relative size-36 shrink-0 self-center sm:self-start"
            aria-label={t('editor.enlargeQr')}
          >
            <QrCode value={qrPayload.trim()} label={t('editor.matterQrAlt')} className="size-36" />
            <span className="absolute right-1.5 bottom-1.5 grid size-7 place-items-center rounded-md bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Maximize2 className="size-3.5" />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={readOnly ? undefined : onScan}
            disabled={readOnly}
            className="grid size-36 shrink-0 place-items-center self-center rounded-xl border border-dashed border-line-strong text-center text-xs text-muted transition-colors enabled:hover:bg-surface-2 sm:self-start"
          >
            <span className="flex flex-col items-center gap-2 px-3">
              {readOnly ? <QrIcon className="size-6" /> : <ScanQrCode className="size-6" />}
              {readOnly ? t('editor.noQr') : t('scan.matterCta')}
            </span>
          </button>
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-xs text-muted">{t('editor.matterCode')}</span>
          <span className="font-mono text-[26px] leading-tight font-medium tracking-wide break-all">
            {code || '––––-–––-––––'}
          </span>
          {info ? <span className="font-mono text-xs break-all text-fg-2">{qrPayload.trim()}</span> : null}
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <Button size="sm" disabled={!code} onClick={() => copy(normalizeMatterCode(code))}>
              <Copy /> {t('editor.copyCode')}
            </Button>
            {readOnly ? null : (
              <Button size="sm" variant="ghost" onClick={onScan}>
                <ScanQrCode /> {t('scan.button')}
              </Button>
            )}
          </div>
        </div>
      </div>
      {info ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-xs sm:grid-cols-4">
          {[
            [t('matter.vendor'), formatVendorId(info.vendorId)],
            [t('matter.product'), formatVendorId(info.productId)],
            [t('matter.discriminator'), String(info.discriminator)],
            [t('matter.discovery'), info.discovery.map((d) => t(`matter.d_${d}`)).join(', ') || '–'],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {mismatch || checkFailed ? (
        <p className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-fg">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden />
          {mismatch ? t('matter.mismatch') : t('editor.invalidMatterCode')}
        </p>
      ) : null}
    </div>
  );
}
