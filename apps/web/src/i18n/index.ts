import type { Language } from '@tresor/shared';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './de';
import deFeatures from './de-features';
import en from './en';
import enFeatures from './en-features';

type Tree = { [key: string]: string | string[] | Tree };

/** Deep-merges feature dictionaries into the base dictionary. */
function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const current = out[k];
    out[k] =
      typeof v === 'object' && !Array.isArray(v) && typeof current === 'object' && !Array.isArray(current)
        ? merge(current, v)
        : v;
  }
  return out;
}

const STORAGE_KEY = 'tresor.language';

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    /* storage unavailable */
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: merge(de as Tree, deFeatures as Tree) },
    en: { translation: merge(en as Tree, enFeatures as Tree) },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = i18n.language;

export function setLanguage(lang: Language) {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
}

export function currentLanguage(): Language {
  return i18n.language === 'de' ? 'de' : 'en';
}

export default i18n;
