import catalog from './translations.json';
export const LOCALES = [
  { id: 'zh-Hant', name: '繁體中文' }, { id: 'zh-Hans', name: '简体中文' },
  { id: 'ja', name: '日本語' }, { id: 'ko', name: '한국어' }, { id: 'en', name: 'English' },
] as const;
export type Locale = typeof LOCALES[number]['id'];
let cachedLocale: Locale | undefined;
export function getLocale(): Locale {
  if (cachedLocale) return cachedLocale;
  try { const s = localStorage.getItem('abai.language'); if (LOCALES.some(l => l.id === s)) return cachedLocale = s as Locale; } catch {}
  return cachedLocale = 'zh-Hant';
}
export function changeLocale(locale: Locale) {
  if (locale === getLocale()) return;
  try { localStorage.setItem('abai.language', locale); } catch { return; }
  // Language changes are only exposed on Home. Reload static option catalogs
  // together; never translate or modify project text, IDs, symbols, or artwork.
  location.reload();
}
export function t(source: string, ...values: unknown[]): string {
  const lang = getLocale();
  const row = (catalog as Record<string, Record<string, string>>)[source];
  const text = lang === 'zh-Hant' ? source : row?.[lang] ?? source;
  return text.replace(/\{(\d+)\}/g, (_, n) => String(values[Number(n)] ?? ''));
}
if (typeof document !== 'undefined') document.documentElement.lang = getLocale();
