import { formatMatterCode, isValidMatterQrPayload, type NoteDto, wifiQrPayload } from '@tresor/shared';
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { QrCode } from '@/components/notes/bits';
import { Button } from '@/components/ui/button';
import { FullPageSpinner } from '@/components/ui/misc';
import { useNotes } from '@/hooks/notes';

function MatterLabel({ note }: { note: NoteDto }) {
  const f = note.fields;
  const qr = f.qrPayload && isValidMatterQrPayload(f.qrPayload) ? f.qrPayload.trim() : null;
  return (
    <div className="print-label flex items-center gap-3 rounded-lg border border-black/25 p-3">
      {qr ? <QrCode value={qr} label="Matter" className="size-24 shrink-0 rounded-none p-0" /> : null}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-semibold leading-tight">{note.title}</span>
        {f.room ? <span className="text-[11px] text-black/60">{f.room}</span> : null}
        <span className="font-mono text-base tracking-wide">
          {f.setupCode ? formatMatterCode(f.setupCode) : ''}
        </span>
        <span className="text-[10px] text-black/50">
          {[f.manufacturer, f.model].filter(Boolean).join(' · ')}
        </span>
      </div>
    </div>
  );
}

function WifiCard({ note }: { note: NoteDto }) {
  const { t } = useTranslation();
  const f = note.fields;
  return (
    <div className="print-label col-span-full mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-black/25 p-8 text-center">
      <span className="text-sm tracking-[0.2em] text-black/50 uppercase">{t('print.wifiHeading')}</span>
      <QrCode
        value={wifiQrPayload(f.ssid ?? '', f.password ?? '', f.security ?? 'WPA')}
        label="Wi-Fi"
        className="size-56 p-0"
      />
      <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-left text-sm">
        <dt className="text-black/50">{t('fields.wifi.ssid')}</dt>
        <dd className="font-mono font-medium break-all">{f.ssid}</dd>
        {f.security !== 'nopass' ? (
          <>
            <dt className="text-black/50">{t('fields.wifi.password')}</dt>
            <dd className="font-mono font-medium break-all">{f.password}</dd>
          </>
        ) : null}
      </dl>
      <span className="text-xs text-black/50">{t('editor.wifiQrHint')}</span>
    </div>
  );
}

/** Printable labels: Matter QR stickers and a Wi-Fi guest card. Forces a white, ink-friendly layout. */
export function PrintPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const notes = useNotes();
  const idList = params.get('ids') ?? '';
  const type = params.get('type');

  const items = useMemo(() => {
    const all = notes.data ?? [];
    const ids = idList.split(',').filter(Boolean);
    if (ids.length) return all.filter((n) => ids.includes(n.id));
    if (type === 'matter') return all.filter((n) => n.type === 'matter');
    return [];
  }, [notes.data, idList, type]);

  useEffect(() => {
    if (!notes.isLoading && items.length) {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [notes.isLoading, items.length]);

  if (notes.isLoading) return <FullPageSpinner />;

  return (
    <div className="min-h-dvh bg-white text-black">
      <div className="flex items-center gap-2 border-b border-black/10 px-6 py-4 print:hidden">
        <Button variant="ghost" onClick={() => navigate(-1)} className="text-black hover:bg-black/5">
          <ArrowLeft /> {t('common.back')}
        </Button>
        <span className="text-sm text-black/60">{t('print.count', { count: items.length })}</span>
        <Button variant="primary" className="ml-auto" onClick={() => window.print()}>
          <Printer /> {t('print.action')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 print:grid-cols-2 print:gap-3 print:p-0">
        {items.map((n) =>
          n.type === 'wifi' ? <WifiCard key={n.id} note={n} /> : <MatterLabel key={n.id} note={n} />,
        )}
      </div>
    </div>
  );
}
