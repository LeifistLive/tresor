import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#C5F04A" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#0A0B0F" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="2.6" fill="#0A0B0F" />
      <path
        d="M16 7.5v3M16 21.5v3M7.5 16h3M21.5 16h3"
        stroke="#0A0B0F"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight">Tresor</span>
    </span>
  );
}

/** The decorative safe dial from the login screen. */
export function VaultDial({ label, className }: { label: string; className?: string }) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const minor: string[] = [];
  const major: string[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const isMajor = i % 6 === 0;
    const r1 = isMajor ? 168 : 174;
    const seg = `M${(Math.cos(a) * r1).toFixed(1)} ${(Math.sin(a) * r1).toFixed(1)}L${(Math.cos(a) * 184).toFixed(1)} ${(Math.sin(a) * 184).toFixed(1)}`;
    (isMajor ? major : minor).push(seg);
  }
  return (
    <svg viewBox="-210 -210 420 420" role="img" aria-label={label} className={className}>
      <circle r="200" fill="none" stroke="var(--line)" />
      <path d={minor.join('')} stroke="var(--line-strong)" strokeWidth="1.5" strokeLinecap="round" />
      <path d={major.join('')} stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" />
      <circle r="140" fill="none" stroke="var(--surface-3)" strokeWidth="18" />
      <circle
        r="140"
        fill="none"
        stroke="#C5F04A"
        strokeWidth="18"
        strokeLinecap="round"
        strokeDasharray="190 690"
        transform="rotate(-120)"
      >
        {reducedMotion ? null : (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="-120"
            to="240"
            dur="40s"
            repeatCount="indefinite"
          />
        )}
      </circle>
      <circle r="96" fill="var(--surface-1)" stroke="var(--line-strong)" />
      <circle r="64" fill="none" stroke="var(--line-strong)" strokeDasharray="2 6" />
      <rect
        x="-26"
        y="-26"
        width="52"
        height="52"
        rx="14"
        fill="var(--surface-3)"
        stroke="var(--line-strong)"
      />
      <circle cy="-5" r="7" fill="none" stroke="var(--mark)" strokeWidth="3" />
      <path d="M0 2v11" stroke="var(--mark)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
