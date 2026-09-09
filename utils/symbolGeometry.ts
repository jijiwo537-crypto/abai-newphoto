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
      const probeFont = `400 ${REF}px ${fontStack(family)}`;
      ctx.font = probeFont;
      const probeAdvance = Math.max(REF, ctx.measureText(text).width);
      /* iOS 對單邊超過約 4K 的 Canvas 可能直接讓 getImageData 失敗。長符號
         不可用固定 100px 掃描；把掃描字級等比降到安全寬度，再依 scanSize
         正規化，才能完整量到最右側而不是落回粗略 fallback。 */
      const scanSize = Math.max(12, Math.min(REF, REF * 2200 / probeAdvance));
      const font = `400 ${scanSize}px ${fontStack(family)}`;
      ctx.font = font;
      const advance = Math.max(scanSize, ctx.measureText(text).width);
      const px = Math.ceil(scanSize * 4), py = Math.ceil(scanSize * 4);
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
        w: (x1 - x0 + 1) / scanSize, h: (y1 - y0 + 1) / scanSize,
        cx: ((x0 + x1 + 1) / 2 - ax) / scanSize,
        cy: ((y0 + y1 + 1) / 2 - ay) / scanSize,
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
      const probeFont = `400 ${size}px ${fontStack(family)}`;
      ctx.font = probeFont;
      const probeAdvance = Math.max(size, ctx.measureText(text).width);
      const scanSize = Math.max(12, Math.min(size, size * 2200 / probeAdvance));
      const font = `400 ${scanSize}px ${fontStack(family)}`;
      ctx.font = font;
      const advance = Math.max(scanSize, ctx.measureText(text).width);
      const px = Math.ceil(scanSize * 4), py = Math.ceil(scanSize * 4);
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
        w: (x1 - x0 + 1) / scanSize,
        h: (y1 - y0 + 1) / scanSize,
        cx: ((x0 + x1 + 1) / 2 - ax) / scanSize,
        cy: ((y0 + y1 + 1) / 2 - ay) / scanSize,
      };
      canvas.width = canvas.height = 0;
    }
  } catch { /* 固定 100px 的共用量测仍可安全兜底 */ }
  sizedCache.set(key, out);
  return out;
};

/** 完整包住墨水並在四邊保留一致安全距離。 */
export const symbolBox = (text: string, family: string, size: number, gap = 4) => {
  // 外框與真正顯示的字級必須使用同一次掃描。iOS 對含組合附加記號的
  // Unicode 在不同字級會套用不同 hinting；拿 100px 結果等比推算會讓少數
  // 符號在生成當下就偏出框，播放動畫後重新排版時才看似恢復。
  const ink = measureSymbolInkAtSize(text, family, size);
  return { w: Math.max(6, ink.w * size + gap * 2), h: Math.max(6, ink.h * size + gap * 2) };
};
