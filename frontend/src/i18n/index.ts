// MyTasker — UI language. English strings are the keys; ka.ts maps them to Georgian.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { createSignal } from 'solid-js';
import { ka } from './ka';

export type Locale = 'ka' | 'en';

export const LOCALES: readonly Locale[] = ['ka', 'en'] as const;
export const LOCALE_LABEL: Record<Locale, string> = { ka: 'ქართული', en: 'English' };
export const LOCALE_SHORT: Record<Locale, string> = { ka: 'ქარ', en: 'EN' };

const STORAGE_KEY = 'mt_locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'ka' || value === 'en';
}

function readStored(): Locale | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isLocale(saved) ? saved : null;
  } catch {
    return null;
  }
}

function detect(): Locale {
  const stored = readStored();
  if (stored) return stored;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : '') ?? '';
  return nav.toLowerCase().startsWith('ka') ? 'ka' : 'en';
}

const [locale, setLocaleSignal] = createSignal<Locale>(detect());

/** Has the person explicitly picked a language in this browser? (Server default never overrides it.) */
export function hasExplicitLocale(): boolean {
  return readStored() !== null;
}

function applyToDocument(next: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}
applyToDocument(locale());

export function setLocale(next: Locale, options: { persist?: boolean } = {}): void {
  if (!isLocale(next)) return;
  if (options.persist !== false) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  }
  if (next === locale()) return;
  setLocaleSignal(next);
  applyToDocument(next);
}

export { locale };

const dictionaries: Record<Locale, Record<string, string>> = { en: {}, ka };
const reported = new Set<string>();

type Vars = Record<string, string | number>;

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/**
 * Translate a UI string. The English text is the key; falls back to itself when a locale has no entry.
 * Reactive: call it inside JSX / memos and it re-evaluates when the locale changes.
 */
export function t(key: string, vars?: Vars): string {
  const current = locale();
  const text = dictionaries[current][key];
  if (text === undefined) {
    if (import.meta.env.DEV && current !== 'en' && !reported.has(key)) {
      reported.add(key);
      console.warn(`[i18n] missing ${current} translation: "${key}"`);
    }
    return interpolate(key, vars);
  }
  return interpolate(text, vars);
}

/**
 * Count + noun. Georgian does not inflect nouns after numerals, so "3 დავალება" is correct;
 * English keeps its regular plural.
 */
export function tn(count: number, singular: string, plural?: string): string {
  if (locale() === 'ka') return `${count} ${t(singular)}`;
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/** BCP-47 tag for Intl formatting (dates, numbers). */
export function intlLocale(): string {
  return locale() === 'ka' ? 'ka-GE' : 'en-GB';
}
