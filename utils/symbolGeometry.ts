import { fontStack } from './fonts';

export type SymbolInk = { w: number; h: number; cx: number; cy: number };
const REF = 100;
const cache = new Map<string, SymbolInk>();

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
      const advance = Math.max(REF, ctx.measureText(text).width);
      const px = Math.ceil(REF * 1.5), py = Math.ceil(REF * 2);
      canvas.width = Math.ceil(advance) + px * 2;
      canvas.height = py * 2;
      ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      const ax = canvas.width / 2, ay = canvas.height / 2;
      ctx.fillText(text, ax, ay);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 8) {
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

/** 完整包住墨水並在四邊保留一致安全距離。 */
export const symbolBox = (text: string, family: string, size: number, gap = 3) => {
  const ink = measureSymbolInk(text, family);
  return { w: Math.max(6, ink.w * size + gap * 2), h: Math.max(6, ink.h * size + gap * 2) };
};
