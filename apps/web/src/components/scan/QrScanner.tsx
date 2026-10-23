import { Camera, ImageUp, ScanQrCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/misc';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

type Decoder = (source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap) => Promise<string | null>;

/** Native BarcodeDetector where available (Chrome, Android), otherwise jsQR (lazy-loaded). */
async function createDecoder(): Promise<Decoder> {
  if (window.BarcodeDetector) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      return async (source) => (await detector.detect(source))[0]?.rawValue ?? null;
    } catch {
      /* fall through to jsQR */
    }
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (source) => {
    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!w || !h) return null;
    const scale = Math.min(1, 1280 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  };
}

export function QrScanner({
  open,
  onOpenChange,
  onResult,
  hint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (text: string) => void;
  hint?: string;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'starting' | 'live' | 'nocamera' | 'denied' | 'notfound'>('starting');
  const doneRef = useRef(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const finish = (text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    navigator.vibrate?.(40);
    resultRef.current(text.trim());
    onOpenChange(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only when the dialog opens
  useEffect(() => {
    if (!open) return;
    doneRef.current = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const start = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setState('nocamera');
        return;
      }
      setState('starting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (err) {
        setState((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'nocamera');
        return;
      }
      if (cancelled) return;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setState('live');
      const decode = await createDecoder();
      const tick = async () => {
        if (cancelled || doneRef.current) return;
        try {
          const text = await decode(video);
          if (text) return finish(text);
        } catch {
          /* keep scanning */
        }
        timer = setTimeout(tick, 180);
      };
      void tick();
    };
    void start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [open]);

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const text = await (await createDecoder())(bitmap);
      if (text) finish(text);
      else setState('notfound');
    } catch {
      setState('notfound');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('scan.title')}
      description={hint ?? t('scan.hint')}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          className={state === 'live' ? 'size-full object-cover' : 'absolute size-full opacity-0'}
        />
        {state === 'live' ? (
          <div className="pointer-events-none absolute inset-[18%] rounded-3xl border-2 border-accent/90 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
            {state === 'starting' ? (
              <Spinner className="text-white/70" />
            ) : (
              <span className="flex flex-col items-center gap-3">
                <ScanQrCode className="size-10 opacity-70" aria-hidden />
                {t(`scan.${state}`)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => fileRef.current?.click()}>
          {state === 'live' ? <ImageUp /> : <Camera />}
          {t('scan.photo')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => void fromFile(e.target.files?.[0])}
        />
      </div>
    </Dialog>
  );
}
