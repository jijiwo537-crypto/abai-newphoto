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
    let advance = Math.max(scanSize, ctx.measureText(text).width);
    const desiredW = advance + scanSize * 8;
    if (desiredW > MAX_SCAN_SIDE) {
      scanSize = Math.max(8, scanSize * (MAX_SCAN_SIDE / desiredW));
      ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
      advance = Math.max(scanSize, ctx.measureText(text).width);
    }

    const padX = Math.min(scanSize * 4, Math.max(2, (MAX_SCAN_SIDE - advance) / 2));
    const padY = Math.min(scanSize * 4, MAX_SCAN_SIDE / 2);
    canvas.width = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(advance + padX * 2)));
    canvas.height = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(Math.max(scanSize * 2, padY * 2))));
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const ax = canvas.width / 2, ay = canvas.height / 2;

    /* TextMetrics 只作為 iOS 拒絕 getImageData 時的備援，而且使用真正墨水邊界，
       不能把 advance 算進外框：長字串兩端的空白／方向控制字元沒有墨水，
       把 advance 當內容正是左側莫名突出一塊的原因。 */
    const metrics = ctx.measureText(text);
    const metricLeft = Number(metrics.actualBoundingBoxLeft) || 0;
    const metricRight = Number(metrics.actualBoundingBoxRight) || 0;
    const metricTop = Number(metrics.actualBoundingBoxAscent) || 0;
    const metricBottom = Number(metrics.actualBoundingBoxDescent) || 0;
    const hasMetricInk = metricLeft > 0 || metricRight > 0;
    let left = hasMetricInk ? -metricLeft : -advance / 2;
    let right = hasMetricInk ? metricRight : advance / 2;
    let top = metricTop > 0 ? -metricTop : -scanSize * .75;
    let bottom = metricBottom > 0 ? metricBottom : scanSize * .45;

    ctx.fillText(text, ax, ay);
    try {
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
      if (x1 >= x0 && y1 >= y0) {
        left = Math.min(left, x0 - ax);
        right = Math.max(right, x1 + 1 - ax);
        top = Math.min(top, y0 - ay);
        bottom = Math.max(bottom, y1 + 1 - ay);
      }
    } catch {
      /* 部分 iOS 裝置會拒絕讀大型 Canvas；上面的向量度量仍完整可用。 */
    }
    canvas.width = canvas.height = 0;
    return {
      w: Math.max(.01, right - left) / scanSize,
      h: Math.max(.01, bottom - top) / scanSize,
      cx: (left + right) / 2 / scanSize,
      cy: (top + bottom) / 2 / scanSize,
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
  /* Canvas 不提供已塑形字串的逐字 glyph 位置。含組合記號、雙向控制或需上下文
     塑形的文字若硬拆，任何 prefix-width 算法都可能破壞原本排版。這類符號保留
     為單一穩定 run；泡泡／縮放 II 仍會對整個 run 播放，絕不會停住或錯位。 */
  if (/[\p{Mark}\u0590-\u0fff\u1780-\u1cff\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(text)) {
    return [text];
  }
  let raw: string[] = [];
  try {
    const Segmenter = (Intl as any).Segmenter;
    if (Segmenter) {
      raw = Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        (part: any) => part.segment as string);
    }
  } catch { /* Safari 舊版走下面的保守分組 */ }
  if (!raw.length) {
    for (const ch of Array.from(text)) {
      if (raw.length && (/\p{Mark}/u.test(ch) || /[\ufe00-\ufe0f\u200d]/u.test(ch))) raw[raw.length - 1] += ch;
      else raw.push(ch);
    }
  }

  /* 方向／格式控制字元沒有自己的墨水，不能成為一個動畫單位。
     併回相鄰字素後仍保留原字串順序，但不會產生一個看不見的停頓。 */
  const controls = /^[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/u;
  const out: string[] = [];
  let leading = '';
  for (const part of raw) {
    if (controls.test(part)) {
      if (out.length) out[out.length - 1] += part;
      else leading += part;
    } else {
      out.push(leading + part);
      leading = '';
    }
  }
  if (leading && out.length) out[out.length - 1] += leading;
  return out.length ? out : [text];
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

      /* 單獨畫字素與整串 shaping 的左右 bearing 可能不同。用每個字素的
         actualBoundingBox 算出動畫整組可見中心，再一次性校回靜止整串的墨水中心。
         這個 correction 是固定值，不會逐幀重算，因此動畫頁不會向左跳。 */
      let visibleLeft = Infinity, visibleRight = -Infinity;
      units.forEach((unit, i) => {
        const m = ctx.measureText(unit);
        const half = Math.max(.05, m.width / 2);
        const l = centers[i] - Math.max(half, Number(m.actualBoundingBoxLeft) || 0);
        const r = centers[i] + Math.max(half, Number(m.actualBoundingBoxRight) || 0);
        visibleLeft = Math.min(visibleLeft, l);
        visibleRight = Math.max(visibleRight, r);
      });
      if (Number.isFinite(visibleLeft) && Number.isFinite(visibleRight)) {
        const targetCenter = measureSymbolInkAtSize(text, family, size).cx * size;
        const correction = targetCenter - (visibleLeft + visibleRight) / 2;
        centers = centers.map(x => x + correction);
      }
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
