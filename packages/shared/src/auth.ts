export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEMES = ['system', 'dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const PASSWORD_MIN = 10;

/** Crude password strength estimate (0–4) used for UI feedback only. */
export function passwordStrength(pw: string): number {
  if (pw.length < PASSWORD_MIN) return 0;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/\d/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  let score = 1;
  if (pw.length >= 14) score++;
  if (pw.length >= 20) score++;
  if (classes >= 3) score++;
  return Math.min(4, score);
}
