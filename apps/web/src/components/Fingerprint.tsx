import { useQuery } from '@tanstack/react-query';
import { fingerprint } from '@tresor/shared/crypto';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { vault } from '@/lib/api';

/** Short fingerprint of a public key (to compare out of band, e.g. by phone). */
export function useFingerprint(publicKey: string | null | undefined) {
  return useQuery({
    queryKey: ['fingerprint', publicKey],
    queryFn: () => fingerprint(publicKey!),
    enabled: Boolean(publicKey),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
}

export function FingerprintLine({ publicKey }: { publicKey: string | null | undefined }) {
  const { t } = useTranslation();
  const fp = useFingerprint(publicKey);
  if (!fp) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted" title={t('keys.fingerprintHint')}>
      <KeyRound className="size-3.5" aria-hidden /> {t('keys.fingerprint')}:{' '}
      <span className="font-mono">{fp}</span>
    </p>
  );
}

/** The signed-in account's own fingerprint. */
export function OwnFingerprint() {
  const { t } = useTranslation();
  const fp = useQuery({ queryKey: ['fingerprint', 'own'], queryFn: () => vault.ownFingerprint() }).data;
  if (!fp) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2 p-3">
      <span className="text-[13px] font-medium">{t('keys.ownTitle')}</span>
      <span className="font-mono text-[15px] tracking-wide">{fp}</span>
      <span className="text-xs text-muted">{t('keys.ownText')}</span>
    </div>
  );
}
