import type { Theme } from '@tresor/shared';

const STORAGE_KEY = 'tresor.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
let current: Theme = readStoredTheme();

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

function paint() {
  const dark = current === 'dark' || (current === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0A0B0F' : '#F6F7F9');
}

media.addEventListener('change', () => current === 'system' && paint());

export function applyTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable */
  }
  paint();
}

export function resolvedTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function currentThemePreference(): Theme {
  return current;
}

paint();
