import { type ClassValue, clsx } from 'clsx';
import type { TFunction } from 'i18next';
import { twMerge } from 'tailwind-merge';
import { ApiError } from './api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function relativeTime(iso: string | null | undefined, lang: string, justNow: string): string {
  if (!iso) return '–';
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return justNow;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (abs >= size || unit === 'minute') return rtf.format(Math.round(seconds / size), unit);
  }
  return justNow;
}

export function formatDate(
  iso: string,
  lang: string,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
) {
  return new Intl.DateTimeFormat(lang, opts).format(new Date(iso));
}

/** Day labels for chart axes: input is YYYY-MM-DD (local calendar day). */
export function formatDay(day: string, lang: string, opts: Intl.DateTimeFormatOptions) {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(lang, opts).format(new Date(y!, (m ?? 1) - 1, d ?? 1));
}

export function formatBytes(bytes: number | null | undefined, lang: string): string {
  if (bytes == null) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: value < 10 && i > 0 ? 1 : 0 }).format(value)} ${units[i]}`;
}

export function formatDuration(seconds: number, lang: string): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const fmt = (v: number, unit: 'day' | 'hour' | 'minute') =>
    new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'narrow' }).format(v);
  if (days > 0) return `${fmt(days, 'day')} ${fmt(hours, 'hour')}`;
  if (hours > 0) return `${fmt(hours, 'hour')} ${fmt(minutes, 'minute')}`;
  return fmt(minutes, 'minute');
}

/** Turns any thrown value into a translated, user-facing message. */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    const translated = t(key);
    return translated === key ? err.message : translated;
  }
  return t('errors.INTERNAL');
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0]?.[0] ?? '?');
  return letters.toUpperCase();
}

/** Very small Markdown-to-text conversion for card previews. */
export function plainText(markdown: string, max = 180): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[[ xX]\]\s*/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
