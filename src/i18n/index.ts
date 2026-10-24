/**
 * Tiny i18n: flat string tables per language with {placeholder} substitution.
 * Add a language by adding a table here (and to `LANGUAGES`).
 */
import type { Localized } from '../level/schema';
import { de } from './de';
import { en, type Strings } from './en';

export type Lang = 'en' | 'de';
export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
];

const tables: Record<Lang, Strings> = { en, de };
let current: Lang = 'en';
const listeners = new Set<() => void>();

export function detectLanguage(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
  return nav === 'de' ? 'de' : 'en';
}

export function setLanguage(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const fn of listeners) fn();
}

export const language = (): Lang => current;

export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: keyof Strings, vars?: Record<string, string | number>): string {
  let s: string = tables[current][key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Pick the current language from a level's localized text. */
export function loc(text: Localized | undefined): string {
  if (!text) return '';
  return text[current] ?? text.en;
}
