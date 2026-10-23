import type { NoteType } from '@tresor/shared';
import {
  CreditCard,
  HousePlug,
  KeyRound,
  LockKeyhole,
  type LucideIcon,
  StickyNote,
  Wifi,
} from 'lucide-react';
import type { CSSProperties } from 'react';

export const TYPE_ICONS: Record<NoteType, LucideIcon> = {
  note: StickyNote,
  matter: HousePlug,
  login: KeyRound,
  wifi: Wifi,
  card: CreditCard,
  secret: LockKeyhole,
};

/** Identity color of an entry type (theme-aware CSS variable). */
export function typeColor(type: NoteType): string {
  return `var(--t-${type})`;
}

export function typeTint(type: NoteType, strength = 14): CSSProperties {
  return {
    color: typeColor(type),
    backgroundColor: `color-mix(in oklab, ${typeColor(type)} ${strength}%, transparent)`,
  };
}
