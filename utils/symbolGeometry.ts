import { fontStack } from './fonts';

export type SymbolInk = { w: number; h: number; cx: number; cy: number };
export type SymbolUnitLayout = {
  units: string[];
  /** 每個字素中心相對於整串 advance 中心的位置；單位是 canvas px。 */
  centers: number[];
  advance: number;
};

const REF = 100;
const MAX_SCAN_SIDE = 3072;
const cache = new Map<string, SymbolInk>();
const sizedCache = new Map<string, SymbolInk>();
const advanceCache = new Map<string, number>();
const unitLayoutCache = new Map<string, SymbolUnitLayout>();

/** 字體剛下載完成時丟掉 fallback 的量測結果。 */
export const clearSymbolInkCache = () => {
  cache.clear();
  sizedCache.clear();
  advanceCache.clear();
  unitLayoutCache.clear();
};
// 字型載入前量到的是 fallback；載入完成後不可繼續沿用錯誤的墨水中心。
if (typeof document !== 'undefined') document.fonts?.ready?.then(clearSymbolInkCache).catch(() => {});

const fallbackInk = (text: string): SymbolInk => ({
  w: Math.max(.3, Array.from(text).length * .5),
  h: 1.2,
  cx: 0,
  cy: 0,
});

/**
 * 直接掃描字形 alpha。長符號不能照原字級無限制拉寬 Canvas：iOS WebKit
 * 超過可用邊長時會回傳空白，舊版因此只量到 fallback 寬度，外框只包住左半邊。
 * 先用 measureText 預估，再把掃描字級縮到安全尺寸；結果除回 scanSize 後仍是
 * 同一份標準化墨水幾何。
 */
const scanInk = (text: string, family: string, requestedSize: number): SymbolInk | null => {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return null;

    let scanSize = Math.max(8, requestedSize);
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    const initialAdvance = Math.max(scanSize, ctx.measureText(text).width);
    const desiredW = initialAdvance + scanSize * 8;
    if (desiredW > MAX_SCAN_SIDE) {
      scanSize = Math.max(8, scanSize * (MAX_SCAN_SIDE / desiredW));
      ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    }

    const advance = Math.max(scanSize, ctx.measureText(text).width);
    /* 四個 em 能完整收進大量上下組合記號，同時仍守住 Safari 的 Canvas 上限。 */
    const padX = Math.min(scanSize * 4, (MAX_SCAN_SIDE - advance) / 2);
    const padY = Math.min(scanSize * 4, MAX_SCAN_SIDE / 2);
    canvas.width = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(advance + Math.max(2, padX) * 2)));
    canvas.height = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(Math.max(scanSize * 2, padY * 2))));
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const ax = canvas.width / 2, ay = canvas.height / 2;
    ctx.fillText(text, ax, ay);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
    }
    canvas.width = canvas.height = 0;
    if (x1 < x0 || y1 < y0) return null;
    return {
      w: (x1 - x0 + 1) / scanSize,
      h: (y1 - y0 + 1) / scanSize,
      cx: ((x0 + x1 + 1) / 2 - ax) / scanSize,
      cy: ((y0 + y1 + 1) / 2 - ay) / scanSize,
    };
  } catch {
    return null;
  }
};

/** 直接掃描字形 alpha，取得符號真正的可見邊界；結果以字級 1 為單位。 */
export const measureSymbolInk = (text: string, family: string): SymbolInk => {
  const key = `${family}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = scanInk(text, family, REF) || fallbackInk(text);
  cache.set(key, out);
  return out;
};

/**
 * 以最終顯示字級掃描。WebKit 對混合 fallback 字形會依字級採用不同 hinting，
 * 外框與本體都使用這份結果，放大、縮小或重新進入專案都不會換另一套中心。
 */
export const measureSymbolInkAtSize = (text: string, family: string, fontSize: number): SymbolInk => {
  const size = Math.max(8, Math.round(fontSize * 1000) / 1000);
  const key = `${family}|${text}|${size}`;
  const hit = sizedCache.get(key);
  if (hit) return hit;
  const out = scanInk(text, family, size) || measureSymbolInk(text, family);
  sizedCache.set(key, out);
  return out;
};

/** 快速量 advance，給符號按鈕與初始大小使用；不掃 alpha，因此清單可立即出現。 */
export const measureSymbolAdvance = (text: string, family: string, fontSize: number) => {
  const size = Math.max(1, fontSize);
  const key = `${family}|${text}|${size}`;
  const hit = advanceCache.get(key);
  if (hit !== undefined) return hit;
  let width = Math.max(size * .3, Array.from(text).length * size * .5);
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `400 ${size}px ${fontStack(family)}`;
      width = Math.max(.1, ctx.measureText(text).width);
    }
  } catch { /* 使用穩定 fallback */ }
  advanceCache.set(key, width);
  return width;
};

/**
 * 泡泡與縮放 II 的最小單位必須是「字素」，不能是 UTF-16 code unit/code point。
 * 否則代理對、附加記號與變體選擇符會被拆開，畫面上就會重疊或四散。
 * 含方向控制字元或需要上下文塑形的文字整串視為一個 run，優先保留正確排版。
 */
export const splitSymbolUnits = (text: string): string[] => {
  if (!text) return [];
  if (/[֐-࿿ក-᳿‎‏‪-‮⁦-⁩]/u.test(text)) return [text];
  try {
    const Segmenter = (Intl as any).Segmenter;
    if (Segmenter) {
      const parts = Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        (part: any) => part.segment as string);
      if (parts.length) return parts;
    }
  } catch { /* Safari 舊版走下面的保守分組 */ }

  const out: string[] = [];
  for (const ch of Array.from(text)) {
    if (out.length && (/\p{Mark}/u.test(ch) || /[\ufe00-\ufe0f\u200d]/u.test(ch))) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
};

/**
 * 每個字素的動畫錨點來自「整串文字逐步增加字素」的 prefix advance，
 * 而不是把每個字寬相加。這會保留 kerning 與 fallback run 的原始位置；
 * 靜止、進場與常駐因此都共用同一個整串中心，不會進動畫頁就向左偏移。
 */
export const measureSymbolUnitLayout = (
  text: string,
  family: string,
  fontSize: number,
): SymbolUnitLayout => {
  const size = Math.max(1, fontSize);
  const key = `${family}|${text}|${size}`;
  const hit = unitLayoutCache.get(key);
  if (hit) return hit;
  const units = splitSymbolUnits(text);
  let advance = measureSymbolAdvance(text, family, size);
  let centers = units.map((_u, i) => ((i + .5) / Math.max(1, units.length) - .5) * advance);
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `400 ${size}px ${fontStack(family)}`;
      advance = Math.max(.1, ctx.measureText(text).width);
      let prefix = '';
      const edges = [0];
      for (const unit of units) {
        prefix += unit;
        edges.push(ctx.measureText(prefix).width);
      }
      centers = units.map((_u, i) => (edges[i] + edges[i + 1]) / 2 - advance / 2);
    }
  } catch { /* 均勻錨點仍保持整組中心不動 */ }
  const out = { units, centers, advance };
  unitLayoutCache.set(key, out);
  return out;
};

/** 完整包住墨水並在四邊保留一致安全距離。 */
export const symbolBox = (text: string, family: string, size: number, gap = 4) => {
  const ink = measureSymbolInkAtSize(text, family, size);
  return { w: Math.max(6, ink.w * size + gap * 2), h: Math.max(6, ink.h * size + gap * 2) };
};
