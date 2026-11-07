/* 照片的「解析度分級」：每張照片只留成品真正用得到的解析度。
 *
 * 照片如果都以原始尺寸留在記憶體裡（一張 1200 萬像素解開約 48MB，
 * 4800 萬像素約 190MB）——但成品最大就是長邊 4096，一張只佔一小格的照片，
 * 存檔時實際只會用到幾百萬像素，多的全部被縮掉。放好幾張大照片時記憶體爆掉、網頁閃退。
 *
 * 做法（跟專業拼圖軟體一樣）：
 *   ‧ 照片的「邏輯尺寸」永遠是原圖尺寸（排版、裁切、存檔尺寸全部照原圖算）；
 *   ‧ 實際拿來畫的那張（drawable）只做到「需要的長邊」：成品需要多少＋一點餘裕，
 *     原圖比這個小就直接用原圖，不重新編碼；
 *   ‧ 原始檔案一直留著（只是壓縮過的檔案，幾 MB）：照片被放大、換成更大的格子、
 *     預覽放大到超過現有細節、或要存檔時，從原檔重新做一張更清楚的換上去。
 * 所以成品的畫質不會變差，只是不再為「根本用不到的像素」付記憶體。 */
import { loadImage as loadImg, resampleImage, fitLong } from './imageResample';
import { registerBudget, scheduleBudgetCheck } from './memoryBudget';
import { nativePathOf } from './nativeBridge';
import { nativeDownsample, nativeImageSize } from './nativeImage';

/** 長邊的分級。分級是為了不要每放大一點點就重做一張 */
export const TIER_STEPS = [1280, 1600, 2048, 2560, 3072, 3584, 4096, 4608, 5120, 6144, 7168, 8192];
/** 需要的長邊 → 該做多大（多留 12% 餘裕，原圖比它小就用原圖） */
export const pickTier = (required: number, long: number) => {
  const want = required * 1.12;
  for (const t of TIER_STEPS) if (t >= want) return Math.min(t, long);
  return long;
};

interface Entry {
  ow: number; oh: number; alpha: boolean;
  /** 目前最清楚的那一張與它的長邊 */
  img: HTMLImageElement; tier: number;
  /** 正在做的那一張（同一張照片同時只做一張，要更大的話做完再做） */
  job: { tier: number; p: Promise<HTMLImageElement | null> } | null;
  /** 自己做出來的檔案網址（離開時一起收掉）。被取代的舊版本不立刻收：復原紀錄裡可能還拿著它 */
  made: string[];
}
const reg = new Map<string, Entry>();

/** 從原圖做一張長邊 long 的 */
async function make(src: string, e: Pick<Entry, 'ow' | 'oh' | 'alpha'>, long: number): Promise<{ img: HTMLImageElement; url: string } | null> {
  /* App 裡、照片從系統選擇器來的：原生端用 ImageIO 在解碼時就縮小，WebKit 不必解開原圖 */
  const nativePath = nativePathOf(src);
  if (nativePath) {
    const r = await nativeDownsample(nativePath, long);
    if (r) {
      const img = await loadImg(r.url);
      try { await img.decode?.(); } catch { /* 解碼延後也沒關係 */ }
      return { img, url: r.url };
    }
  }
  const original = await loadImg(src);
  const { w, h } = fitLong(e.ow, e.oh, long);
  return resampleImage(original, w, h, e.alpha, 0.97);
}

const mayHaveAlpha = (type: string) => /png|webp|gif|avif|svg/i.test(type || '');

/**
 * 打開一張照片：讀原圖尺寸（只讀檔頭，不整張解碼），再做出「起始長邊」那一張。
 * initialLong 傳 Infinity＝整張照原圖。回傳畫用的那張與原圖尺寸（邏輯尺寸）。
 */
export async function openTiered(src: string, type: string, initialLong: number): Promise<{ img: HTMLImageElement; ow: number; oh: number }> {
  /* App 裡有原生路徑時，尺寸只讀檔頭；原圖要等真的需要原尺寸才讀進 WebKit */
  const nativePath = nativePathOf(src);
  const nativeSize = nativePath ? await nativeImageSize(nativePath) : null;
  const head = nativeSize ? null : await loadImg(src);
  const ow = nativeSize ? nativeSize.width : head!.naturalWidth, oh = nativeSize ? nativeSize.height : head!.naturalHeight, long = Math.max(ow, oh);
  const alpha = mayHaveAlpha(type);
  const tier = Math.min(long, initialLong >= long ? long : pickTier(initialLong / 1.12, long));
  let img: HTMLImageElement | null = null, made: string[] = [];
  if (tier < long) {
    try { const m = await make(src, { ow, oh, alpha }, tier); if (m) { img = m.img; made = m.url.startsWith('blob:') ? [m.url] : []; } }
    catch { /* 做不出來就用原圖，不影響功能 */ }
  }
  const full = !img;
  if (!img) img = head ?? await loadImg(src);
  const prev = reg.get(src);
  if (prev) prev.made.forEach(u => URL.revokeObjectURL(u));
  reg.set(src, { ow, oh, alpha, img, tier: full ? long : tier, job: null, made });
  scheduleBudgetCheck();
  return { img, ow, oh };
}

/** 這張照片現在畫用的長邊與原圖長邊（不是分級管理的照片回傳 null） */
export function tierOf(src: string): { tier: number; long: number; img: HTMLImageElement } | null {
  const e = reg.get(src);
  return e ? { tier: e.tier, long: Math.max(e.ow, e.oh), img: e.img } : null;
}

/**
 * 需要長邊 required 的細節：現在那張不夠的話從原檔做一張更清楚的。
 * 回傳 null＝現在這張已經夠（或不是分級照片）；否則回傳做好的那張（呼叫端換上去）。
 */
export function ensureTier(src: string, required: number): Promise<HTMLImageElement | null> {
  const e = reg.get(src);
  if (!e) return Promise.resolve(null);
  const long = Math.max(e.ow, e.oh);
  if (e.tier >= long || e.tier >= required * 0.98) return Promise.resolve(null);
  const tier = pickTier(required, long);
  if (e.job && e.job.tier >= tier) return e.job.p;
  const prior = e.job?.p ?? Promise.resolve(null);
  const p = prior.then(async () => {
    if (e.tier >= tier) return null;
    try {
      let img: HTMLImageElement, url = '';
      if (tier >= long) img = await loadImg(src);
      else { const m = await make(src, e, tier); if (!m) return null; img = m.img; url = m.url; }
      if (reg.get(src) !== e) { if (url) URL.revokeObjectURL(url); return null; }
      if (url && url.startsWith('blob:')) e.made.push(url);
      e.img = img; e.tier = tier >= long ? long : tier;
      scheduleBudgetCheck();
      return img;
    } catch { return null; }
  }).finally(() => { if (e.job?.p === p) e.job = null; });
  e.job = { tier, p };
  return p;
}

/** 已經不用的照片（或離開工具時）：把自己做的檔案網址收掉 */
export function forgetTiered(src?: string) {
  const list = src ? [src] : [...reg.keys()];
  for (const s of list) { const e = reg.get(s); if (!e) continue; e.made.forEach(u => URL.revokeObjectURL(u)); reg.delete(s); }
}

/* 計入共用記憶體預算：這些是畫面和存檔正在用的那一張，不能放，但會讓其他快取讓出空間 */
registerBudget('photoTiers', {
  bytes: () => { let n = 0; for (const e of reg.values()) { const k = e.tier / Math.max(e.ow, e.oh); n += Math.round(e.ow * k) * Math.round(e.oh * k) * 4; } return n; },
  oldestIdle: () => Infinity,
  evictIdle: () => false,
});
