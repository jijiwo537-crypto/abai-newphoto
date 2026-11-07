import catalog from './translations.json';
export const LOCALES = [
  { id: 'zh-Hant', name: '繁體中文' }, { id: 'zh-Hans', name: '简体中文' },
  { id: 'ja', name: '日本語' }, { id: 'ko', name: '한국어' }, { id: 'en', name: 'English' },
] as const;
export type Locale = typeof LOCALES[number]['id'];
let cachedLocale: Locale | undefined;
const restartCover = typeof document !== 'undefined' ? document.getElementById('boot')?.cloneNode(true) as HTMLElement | undefined : undefined;
export function getLocale(): Locale {
  if (cachedLocale) return cachedLocale;
  try { const s = localStorage.getItem('abai.language'); if (LOCALES.some(l => l.id === s)) return cachedLocale = s as Locale; } catch {}
  return cachedLocale = 'zh-Hant';
}
export function changeLocale(locale: Locale) {
  try { localStorage.setItem('abai.language', locale); } catch { return; }
  // 立刻顯示重新啟動，就算換頁還在等回應
  const cover = restartCover?.cloneNode(true) as HTMLElement | undefined;
  if (cover) {
  cover.setAttribute('role', 'status');
  cover.style.opacity = '1';
  cover.style.transition = 'none';
  document.body.appendChild(cover);
  }
  // 只有首頁能換語言。一起重新載入固定的選項目錄；絕不翻譯或修改作品的文字、ID、符號或圖案
  location.reload();
}
export function t(source: string, ...values: unknown[]): string {
  const lang = getLocale();
  const row = (catalog as Record<string, Record<string, string>>)[source];
  const text = lang === 'zh-Hant' ? source : row?.[lang] ?? source;
  return text.replace(/\{(\d+)\}/g, (_, n) => String(values[Number(n)] ?? ''));
}
if (typeof document !== 'undefined') document.documentElement.lang = getLocale();
