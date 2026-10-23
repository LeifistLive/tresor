import { useEffect, useRef } from 'react';

const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** Calls `onLock` after `minutes` without user input (0 disables auto-lock). */
export function useAutoLock(minutes: number, onLock: () => void) {
  const last = useRef(Date.now());
  const lockRef = useRef(onLock);
  lockRef.current = onLock;

  useEffect(() => {
    if (!minutes) return;
    last.current = Date.now();
    const bump = () => {
      last.current = Date.now();
    };
    for (const e of EVENTS) window.addEventListener(e, bump, { passive: true });
    const check = () => {
      if (Date.now() - last.current >= minutes * 60_000) lockRef.current();
    };
    const timer = setInterval(check, 10_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, bump);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [minutes]);
}
