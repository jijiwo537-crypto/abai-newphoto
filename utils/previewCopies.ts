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
import { loadImage as loadImg, resampleImage, fitLong } from './imageResample';
import { registerTrim } from './memoryPressure';
import { registerBudget, scheduleBudgetCheck } from './memoryBudget';

/* 兩級小副本：一般大小的圖層（例如一頁放二十幾張）只要 1024，拉大才做 2048，再大才用原圖。
   一頁二十幾張的時候，只用一級 2048 的話預覽光照片就要兩百多 MB */
export const PREVIEW_LONG = 1024;
export const PREVIEW_MID = 2048;

interface Entry { small: string | null; smallLong: number; long: number; orig: HTMLImageElement | null; origReady: boolean; origLoading: boolean;
  mid: string | null; midLong: number; midLoading: boolean; type: string;
  /** 畫面上是不是正在用原圖；不用了從什麼時候開始（共用記憶體預算靠它挑要放掉哪一張） */
  wantOrig?: boolean; wantAt?: number; idleAt?: number }
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

/** 原圖縮成長邊 target 的一份，回傳網址 */
async function shrink(im: HTMLImageElement, target: number, type: string): Promise<string> {
  const { w, h } = fitLong(im.naturalWidth, im.naturalHeight, target);
  const r = await resampleImage(im, w, h, /png|webp|gif|avif/i.test(type), 0.95);
  if (!r) throw new Error('shrink');
  return r.url;
}

/** 導入照片時呼叫（等它做完再放進畫面）：原圖比 PREVIEW_LONG 大就做一份小副本 */
export function ensurePreviewCopy(url: string, type = ''): Promise<void> {
  if (!url || copies.has(url)) return Promise.resolve();
  const run = pending.get(url);
  if (run) return run;
  const p = (async () => {
    try {
      const im = await loadImg(url);
      const w = im.naturalWidth, h = im.naturalHeight, long = Math.max(w, h);
      if (!long || long <= PREVIEW_LONG * 1.15) { copies.set(url, { small: null, smallLong: long, long, orig: im, origReady: true, origLoading: false, mid: null, midLong: 0, midLoading: false, type }); return; }
      const small = await shrink(im, PREVIEW_LONG, type);
      copies.set(url, { small, smallLong: PREVIEW_LONG, long, orig: null, origReady: false, origLoading: false, mid: null, midLong: 0, midLoading: false, type });
    } catch {
      copies.set(url, { small: null, smallLong: 0, long: 0, orig: null, origReady: true, origLoading: false, mid: null, midLong: 0, midLoading: false, type });
    } finally { pending.delete(url); }
    bump();
  })();
  pending.set(url, p);
  return p;
}

/* need=0 是縮圖、卡片這類「不知道多大」的查詢，不算數；同一張照片可能好幾處同時在畫，
   剛剛（1.5 秒內）還有人要原圖就先不算閒置 */
const origIdle = (e: Entry, need: number) => {
  if (!e.wantOrig || need <= 0) return;
  const now = Date.now();
  if (now - (e.wantAt || 0) < 1500) return;
  e.wantOrig = false; e.idleAt = now;
  if (e.orig) scheduleBudgetCheck();
};

/**
 * 預覽上畫這張照片要用哪一份網址。need＝畫面上它實際佔的「裝置像素」長邊（不知道就傳 0）。
 * 小副本夠清楚就用小副本；不夠的話原圖解碼好了就用原圖，還沒好就先用小副本、同時開始讀原圖。
 */
export function previewSrc(url: string, need = 0): string {
  const e = url ? copies.get(url) : undefined;
  if (!e || !e.small) return url;
  if (need <= e.smallLong * 0.98) { origIdle(e, need); return e.small; }
  // 中間那一級：原圖比 2048 大很多才值得做
  if (e.long > PREVIEW_MID * 1.15 && need <= PREVIEW_MID * 0.98) {
    origIdle(e, need);
    if (e.mid) return e.mid;
    if (!e.midLoading) {
      e.midLoading = true;
      loadImg(url).then(im => shrink(im, PREVIEW_MID, e.type)).then(u => { if (copies.get(url) === e) { e.mid = u; e.midLong = PREVIEW_MID; bump(); } else URL.revokeObjectURL(u); })
        .catch(() => { e.midLoading = false; });
    }
    return e.small;
  }
  e.wantOrig = true; e.wantAt = Date.now();
  if (e.origReady) return url;
  if (!e.origLoading) {
    e.origLoading = true;
    loadImg(url).then(async im => { try { await im.decode?.(); } catch { /* ok */ } e.orig = im; e.origReady = true; bump(); scheduleBudgetCheck(); })
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
  for (const e of copies.values()) { if (e.small) URL.revokeObjectURL(e.small); if (e.mid) URL.revokeObjectURL(e.mid); }
  copies.clear(); pending.clear(); viewZoom = 1;
}

/* 記憶體吃緊時：放掉已經讀進來的大原圖（還要用的時候 previewSrc 會先用小副本、再重新讀） */
registerTrim('previewCopies', () => {
  let changed = false;
  for (const e of copies.values()) if (e.small && e.orig) { e.orig = null; e.origReady = false; e.origLoading = false; changed = true; }
  if (changed) bump();
});

/* 共用記憶體預算：已經讀進來、但畫面已經不用的原圖（放大看完又縮回去）算閒置，超過預算時從最久的放掉 */
const idleOrig = () => {
  let pick: Entry | null = null;
  for (const e of copies.values()) if (e.small && e.orig && !e.wantOrig && (!pick || (e.idleAt || 0) < (pick.idleAt || 0))) pick = e;
  return pick;
};
registerBudget('previewCopies', {
  bytes: () => { let n = 0; for (const e of copies.values()) if (e.small && e.orig) n += e.orig.naturalWidth * e.orig.naturalHeight * 4; return n; },
  oldestIdle: () => idleOrig()?.idleAt ?? Infinity,
  evictIdle: () => { const e = idleOrig(); if (!e) return false; e.orig = null; e.origReady = false; e.origLoading = false; return true; },
});
