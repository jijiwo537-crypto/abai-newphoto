import { fontStack } from './fonts';

export type SymbolInk = { w: number; h: number; cx: number; cy: number };
const REF = 100;
const cache = new Map<string, SymbolInk>();
const sizedCache = new Map<string, SymbolInk>();
/** 字體剛下載完成時丟掉 fallback 的量測結果。 */
export const clearSymbolInkCache = () => { cache.clear(); sizedCache.clear(); };
// 字型載入前量到的是 fallback；載入完成後不可繼續沿用錯誤的墨水中心。
if (typeof document !== 'undefined') document.fonts?.ready?.then(clearSymbolInkCache).catch(() => {});

/** 直接掃描字形 alpha，取得符號真正的可見邊界；結果以字級 1 為單位。 */
export const measureSymbolInk = (text: string, family: string): SymbolInk => {
  const key = `${family}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: SymbolInk = { w: Math.max(.3, text.length * .5), h: 1.2, cx: 0, cy: 0 };
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (ctx) {
      const font = `400 ${REF}px ${fontStack(family)}`;
      ctx.font = font;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tm = ctx.measureText(text);
      /* 現代 Safari/Chrome 直接提供向量字形的實際四邊，無需建立巨大點陣
         再逐像素掃描；點擊符號時可同步完成且邊界與 Canvas 繪製一致。 */
      if (Number.isFinite(tm.actualBoundingBoxLeft) && Number.isFinite(tm.actualBoundingBoxRight)
          && tm.actualBoundingBoxLeft + tm.actualBoundingBoxRight > 0) {
        out = {
          w: (tm.actualBoundingBoxLeft + tm.actualBoundingBoxRight) / REF,
          h: (tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent) / REF,
          cx: (tm.actualBoundingBoxRight - tm.actualBoundingBoxLeft) / (2 * REF),
          cy: (tm.actualBoundingBoxDescent - tm.actualBoundingBoxAscent) / (2 * REF),
        };
        cache.set(key, out);
        return out;
      }
      const advance = Math.max(REF, tm.width);
      /* 大量符號含組合附加記號，墨水可能遠超出 advance/em box。
         留四個 em 才不會先被量測畫布裁掉，導致算出錯誤中心與過小外框。 */
      const px = Math.ceil(REF * 4), py = Math.ceil(REF * 4);
      canvas.width = Math.ceil(advance) + px * 2;
      canvas.height = py * 2;
      ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      const ax = canvas.width / 2, ay = canvas.height / 2;
      ctx.fillText(text, ax, ay);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        // 連最外圈的抗鋸齒像素也算入；門檻過高會在大倍率下露出框外。
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      if (x1 >= x0 && y1 >= y0) out = {
        w: (x1 - x0 + 1) / REF, h: (y1 - y0 + 1) / REF,
        cx: ((x0 + x1 + 1) / 2 - ax) / REF,
        cy: ((y0 + y1 + 1) / 2 - ay) / REF,
      };
      canvas.width = canvas.height = 0;
    }
  } catch { /* fallback metrics above keep the symbol usable */ }
  cache.set(key, out);
  return out;
};

/**
 * 以最终显示字号扫描一次。大部分字体可以直接把 100px 结果等比缩放，但某些
 * 组合 Unicode 会落到多套系统 fallback 字体；WebKit 对这些字形会在不同字号
 * 使用不同 hinting / baseline。经典拼图的符号 Canvas 与选中框共同使用这份结果，
 * 因此无论符号放多大，墨水中心和四边范围都仍是同一套数据。
 */
export const measureSymbolInkAtSize = (text: string, family: string, fontSize: number): SymbolInk => {
  const size = Math.max(8, Math.round(fontSize * 1000) / 1000);
  const key = `${family}|${text}|${size}`;
  const hit = sizedCache.get(key);
  if (hit) return hit;
  let out = measureSymbolInk(text, family);
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (ctx) {
      const font = `400 ${size}px ${fontStack(family)}`;
      ctx.font = font;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tm = ctx.measureText(text);
      if (Number.isFinite(tm.actualBoundingBoxLeft) && Number.isFinite(tm.actualBoundingBoxRight)
          && tm.actualBoundingBoxLeft + tm.actualBoundingBoxRight > 0) {
        out = {
          w: (tm.actualBoundingBoxLeft + tm.actualBoundingBoxRight) / size,
          h: (tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent) / size,
          cx: (tm.actualBoundingBoxRight - tm.actualBoundingBoxLeft) / (2 * size),
          cy: (tm.actualBoundingBoxDescent - tm.actualBoundingBoxAscent) / (2 * size),
        };
        sizedCache.set(key, out);
        return out;
      }
      const advance = Math.max(size, tm.width);
      const px = Math.ceil(size * 4), py = Math.ceil(size * 4);
      canvas.width = Math.ceil(advance) + px * 2;
      canvas.height = py * 2;
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      const ax = canvas.width / 2, ay = canvas.height / 2;
      ctx.fillText(text, ax, ay);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      if (x1 >= x0 && y1 >= y0) out = {
        w: (x1 - x0 + 1) / size,
        h: (y1 - y0 + 1) / size,
        cx: ((x0 + x1 + 1) / 2 - ax) / size,
        cy: ((y0 + y1 + 1) / 2 - ay) / size,
      };
      canvas.width = canvas.height = 0;
    }
  } catch { /* 固定 100px 的共用量测仍可安全兜底 */ }
  sizedCache.set(key, out);
  return out;
};

/** 完整包住墨水並在四邊保留一致安全距離。 */
export const symbolBox = (text: string, family: string, size: number, gap = 4) => {
  const ink = measureSymbolInk(text, family);
  return { w: Math.max(6, ink.w * size + gap * 2), h: Math.max(6, ink.h * size + gap * 2) };
};
