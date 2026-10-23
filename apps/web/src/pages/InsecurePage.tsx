import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/components/layout/Logo';

/** Browsers only offer WebCrypto in a secure context (HTTPS or localhost) – without it nothing can be decrypted. */
export function isSecureEnough(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && Boolean(globalThis.crypto?.subtle);
}

export function InsecurePage() {
  const { t } = useTranslation();
  const host = window.location.hostname;
  const steps = [t('insecure.optionProfile', { host }), t('insecure.optionProxy'), t('insecure.optionLocal')];
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="flex w-full max-w-lg flex-col gap-5">
        <span className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[17px] font-semibold">Tresor</span>
        </span>
        <span className="grid size-11 place-items-center rounded-xl bg-warn-soft text-warn [&_svg]:size-5">
          <ShieldAlert />
        </span>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">{t('insecure.title')}</h1>
        <p className="text-fg-2">{t('insecure.text')}</p>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px] text-fg-2">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="text-xs text-muted">{t('insecure.docs')}</p>
      </div>
    </div>
  );
}
