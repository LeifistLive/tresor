import type { DayCount } from '@tresor/shared';

export const DAY_MS = 86_400_000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD of a date in the given IANA time zone. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Buckets timestamps into one count per calendar day (oldest first), including empty days. */
export function bucketByDay(dates: Date[], days: number, timeZone: string, now = new Date()): DayCount[] {
  const counts = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) counts.set(dayKey(new Date(now.getTime() - i * DAY_MS), timeZone), 0);
  for (const d of dates) {
    const key = dayKey(d, timeZone);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count }));
}

export function daysSince(date: Date | null, now = Date.now()): number | null {
  return date ? Math.floor((now - date.getTime()) / DAY_MS) : null;
}
