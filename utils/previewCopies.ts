/* 預覽用的照片小副本（跨頁拼圖）。
 *
 * 跨頁拼圖以前每張照片在畫面上都用原圖（一張 1200 萬像素解開約 48MB），
 * 但手機畫面上一格照片通常只有幾百個點寬。這裡在導入時替每張照片做一份「預覽用」的小副本，
 * 畫面上需要多少就給多少：
 *   ‧ 一般大小：用小副本（長邊 PREVIEW_LONG）；
 *   ‧ 放大到小副本不夠清楚時（畫面放大、格子裡放大、圖層拉大）：先在背景把原圖讀好、解碼完，
 *     再換上原圖（不會出現空白或閃一下）；
 *   ‧ 存檔、構圖、草稿、復原紀錄一律還是原圖的網址 —— 成品畫質跟以前完全一樣。
 * 程式裡存的永遠是原圖網址；只有「畫到預覽上」的那幾個地方透過 previewSrc() 換成適合的那一份。 */
import { useEffect, useState } from 'react';
import { get2dWide } from './colorSpace';

export const PREVIEW_LONG = 2048;

interface Entry { small: string | null; smallLong: number; long: number; orig: HTMLImageElement | null; origReady: boolean; origLoading: boolean }
const copies = new Map<string, Entry>();
const pending = new Map<string, Promise<void>>();
let version = 0;
const subs = new Set<(v: number) => void>();
const bump = () => { version++; subs.forEach(f => f(version)); };

/** 預覽畫面目前放大幾倍（跨頁拼圖的雙指縮放）。畫到預覽上需要多少像素要乘它 */
let viewZoom = 1;
export function setPreviewZoom(k: number) {
  const prev = viewZoom; viewZoom = Math.max(1, k || 1);
  // 放大跨過「小副本夠不夠」的門檻時通知一次，各處重算該用哪一份
  if (Math.abs(prev - viewZoom) > 0.05) bump();
}
export const previewZoom = () => viewZoom;

const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('load')); im.src = src;
});

/** 導入照片時呼叫（等它做完再放進畫面）：原圖比 PREVIEW_LONG 大就做一份小副本 */
export function ensurePreviewCopy(url: string, type = ''): Promise<void> {
  if (!url || copies.has(url)) return Promise.resolve();
  const run = pending.get(url);
  if (run) return run;
  const p = (async () => {
    try {
      const im = await loadImg(url);
      const w = im.naturalWidth, h = im.naturalHeight, long = Math.max(w, h);
      if (!long || long <= PREVIEW_LONG * 1.15) { copies.set(url, { small: null, smallLong: long, long, orig: im, origReady: true, origLoading: false }); return; }
      const k = PREVIEW_LONG / long, cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      try {
        const g = get2dWide(c); if (!g) throw new Error('no 2d');
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, cw, ch);
        const alpha = /png|webp|gif|avif/i.test(type);
        const blob = await new Promise<Blob | null>(r => c.toBlob(r, alpha ? 'image/png' : 'image/jpeg', alpha ? undefined : 0.95));
        if (!blob) throw new Error('encode');
        const small = URL.createObjectURL(blob);
        const s = await loadImg(small); try { await s.decode?.(); } catch { /* ok */ }
        copies.set(url, { small, smallLong: PREVIEW_LONG, long, orig: null, origReady: false, origLoading: false });
      } finally { c.width = c.height = 0; }
    } catch {
      copies.set(url, { small: null, smallLong: 0, long: 0, orig: null, origReady: true, origLoading: false });
    } finally { pending.delete(url); }
    bump();
  })();
  pending.set(url, p);
  return p;
}

/**
 * 預覽上畫這張照片要用哪一份網址。need＝畫面上它實際佔的「裝置像素」長邊（不知道就傳 0）。
 * 小副本夠清楚就用小副本；不夠的話原圖解碼好了就用原圖，還沒好就先用小副本、同時開始讀原圖。
 */
export function previewSrc(url: string, need = 0): string {
  const e = url ? copies.get(url) : undefined;
  if (!e || !e.small) return url;
  if (need <= e.smallLong * 0.98) return e.small;
  if (e.origReady) return url;
  if (!e.origLoading) {
    e.origLoading = true;
    loadImg(url).then(async im => { try { await im.decode?.(); } catch { /* ok */ } e.orig = im; e.origReady = true; bump(); })
      .catch(() => { e.origLoading = false; });
  }
  return e.small;
}

/** 預覽用的副本換了（做好了、或改用原圖了）時讓元件重畫 */
export function usePreviewCopies(): number {
  const [v, setV] = useState(version);
  useEffect(() => { subs.add(setV); setV(version); return () => { subs.delete(setV); }; }, []);
  return v;
}
export const previewCopiesVersion = () => version;
export const subscribePreviewCopies = (f: (v: number) => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** 離開跨頁拼圖時收掉小副本 */
export function forgetPreviewCopies() {
  for (const e of copies.values()) if (e.small) URL.revokeObjectURL(e.small);
  copies.clear(); pending.clear(); viewZoom = 1;
}
