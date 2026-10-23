import { type NoteDto, passwordStrength } from '@tresor/shared';

export type HealthIssue = 'weak' | 'reused' | 'old';

const OLD_AFTER_DAYS = 365;

/** Secrets that are "passwords" in the sense of the health check. */
function passwordOf(note: NoteDto): string | null {
  if (note.type === 'login' || note.type === 'wifi') return note.fields.password || null;
  return null;
}

export interface HealthReport {
  checked: number;
  issues: Map<string, HealthIssue[]>;
  counts: Record<HealthIssue, number>;
}

/**
 * Analyses login & Wi-Fi passwords locally in the browser (decrypted data never leaves the page):
 * weak (strength score ≤ 1), reused (same value in several entries) and old (not changed for a year).
 */
export function analyzePasswords(notes: NoteDto[], now = Date.now()): HealthReport {
  const issues = new Map<string, HealthIssue[]>();
  const counts: Record<HealthIssue, number> = { weak: 0, reused: 0, old: 0 };
  const byValue = new Map<string, string[]>();
  let checked = 0;

  const add = (id: string, issue: HealthIssue) => {
    issues.set(id, [...(issues.get(id) ?? []), issue]);
    counts[issue]++;
  };

  for (const n of notes) {
    const pw = passwordOf(n);
    if (!pw) continue;
    checked++;
    if (passwordStrength(pw) <= 1 && !(n.type === 'wifi' && pw.length >= 12)) add(n.id, 'weak');
    if (n.type === 'login' && now - new Date(n.updatedAt).getTime() > OLD_AFTER_DAYS * 86_400_000)
      add(n.id, 'old');
    byValue.set(pw, [...(byValue.get(pw) ?? []), n.id]);
  }
  for (const ids of byValue.values()) if (ids.length > 1) for (const id of ids) add(id, 'reused');
  return { checked, issues, counts };
}

export function healthScore(report: HealthReport): number {
  if (report.checked === 0) return 100;
  const affected = report.issues.size;
  return Math.round(((report.checked - affected) / report.checked) * 100);
}
