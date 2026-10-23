import { formatMatterCode, isValidMatterQrPayload, type NoteDto } from '@tresor/shared';
import { HousePlug, Plus, Printer, ScanQrCode, Wifi } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { QrCode } from '@/components/notes/bits';
import { QrScanner } from '@/components/scan/QrScanner';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Segmented, Skeleton } from '@/components/ui/misc';
import { useNotes } from '@/hooks/notes';
import { setPrefill } from '@/lib/prefill';
import { prefillFromQr } from '@/lib/scan';

type Network = 'all' | 'thread' | 'wifi' | 'ethernet';

function DeviceCard({ device }: { device: NoteDto }) {
  const { t } = useTranslation();
  const f = device.fields;
  const qr = f.qrPayload && isValidMatterQrPayload(f.qrPayload) ? f.qrPayload.trim() : null;
  return (
    <Link
      to={`/notes?id=${device.id}`}
      className="group flex gap-4 rounded-2xl border border-line bg-surface-1 p-4 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-line-strong"
    >
      {qr ? (
        <QrCode value={qr} label={t('editor.matterQrAlt')} className="size-20 shrink-0 rounded-lg p-1.5" />
      ) : (
        <span className="grid size-20 shrink-0 place-items-center rounded-lg border border-dashed border-line-strong text-muted">
          <HousePlug className="size-6" aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-semibold">{device.title || t('notes.untitled')}</span>
        <span className="font-mono text-sm tracking-wide text-fg-2">
          {f.setupCode ? formatMatterCode(f.setupCode) : '––––-–––-––––'}
        </span>
        <span className="truncate text-xs text-muted">
          {[f.manufacturer, f.model].filter(Boolean).join(' · ') || ' '}
        </span>
        {f.network ? (
          <span className="mt-auto">
            <Badge className="h-5 text-[11px]">{t(`options.${f.network}`)}</Badge>
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function DevicesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notes = useNotes();
  const [network, setNetwork] = useState<Network>('all');
  const [scanOpen, setScanOpen] = useState(false);

  const devices = useMemo(() => (notes.data ?? []).filter((n) => n.type === 'matter'), [notes.data]);
  const wifi = useMemo(() => (notes.data ?? []).filter((n) => n.type === 'wifi'), [notes.data]);
  const visible = devices.filter((d) => network === 'all' || d.fields.network === network);
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const rooms = useMemo(() => {
    const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const map = new Map<string, NoteDto[]>();
    for (const d of visible) {
      const room = d.fields.room?.trim() || '';
      map.set(room, [...(map.get(room) ?? []), d]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : byName.compare(a, b)));
  }, [visible]);
  const byNetwork = (n: Exclude<Network, 'all'>) => devices.filter((d) => d.fields.network === n).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('devices.title')}</h1>
          <p className="text-fg-2">{t('devices.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setScanOpen(true)}>
            <ScanQrCode /> {t('scan.button')}
          </Button>
          <Button onClick={() => navigate('/print?type=matter')} disabled={devices.length === 0}>
            <Printer /> {t('print.labels')}
          </Button>
          <Button variant="primary" onClick={() => navigate('/notes?new=matter')}>
            <Plus /> {t('devices.add')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          [t('devices.kpiDevices'), devices.length],
          [t('devices.kpiRooms'), new Set(devices.map((d) => d.fields.room?.trim()).filter(Boolean)).size],
          [t('options.thread'), byNetwork('thread')],
          [t('options.wifi'), byNetwork('wifi')],
          [t('options.ethernet'), byNetwork('ethernet')],
        ].map(([label, value]) => (
          <Card key={label as string} className="flex flex-col gap-2 p-4">
            <span className="text-xs text-fg-2">{label}</span>
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
          </Card>
        ))}
      </div>

      <Segmented
        label={t('devices.network')}
        value={network}
        onChange={setNetwork}
        className="self-start"
        options={(['all', 'thread', 'wifi', 'ethernet'] as const).map((n) => ({
          value: n,
          label: n === 'all' ? t('common.all') : t(`options.${n}`),
        }))}
      />

      {notes.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HousePlug />}
            title={t('devices.empty')}
            text={t('devices.emptyText')}
            action={
              <Button variant="primary" onClick={() => setScanOpen(true)}>
                <ScanQrCode /> {t('scan.matterCta')}
              </Button>
            }
          />
        </Card>
      ) : (
        rooms.map(([room, list]) => (
          <section key={room || '-'} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              {room || t('devices.noRoom')}
              <span className="font-mono text-xs font-normal text-muted">{list.length}</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list
                .sort((a, b) => collator.compare(a.title, b.title))
                .map((d) => (
                  <DeviceCard key={d.id} device={d} />
                ))}
            </div>
          </section>
        ))
      )}

      {wifi.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">{t('devices.networks')}</h2>
          <Card className="flex flex-col p-1.5">
            {wifi.map((w) => (
              <div key={w.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                <Wifi className="size-4 text-muted" aria-hidden />
                <Link to={`/notes?id=${w.id}`} className="min-w-0 flex-1 truncate font-medium">
                  {w.title || w.fields.ssid}
                </Link>
                <span className="hidden font-mono text-xs text-muted sm:block">{w.fields.ssid}</span>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/print?ids=${w.id}`)}>
                  <Printer /> {t('print.guestCard')}
                </Button>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <QrScanner
        open={scanOpen}
        onOpenChange={setScanOpen}
        hint={t('scan.hint_matter')}
        onResult={(text) => {
          const prefill = prefillFromQr(text);
          setPrefill(prefill);
          navigate(`/notes?new=${prefill.type}`);
        }}
      />
    </div>
  );
}
