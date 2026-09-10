import { fontStack } from './fonts';

export type SymbolInk = { w: number; h: number; cx: number; cy: number };
export type SymbolUnitLayout = {
  /** 動畫用的可見小單元；附加點、星、弧線可以各自取得時間相位。 */
  units: string[];
  centers: number[];
  /** 每个动画单元继承自哪一个稳定 grapheme，只用于辨认原生叠合关系。 */
  unitClusters: number[];
  /** 每个动画片段在整串原生 shaping 中的水平裁切范围（基准字号 px）。 */
  unitLefts: number[];
  unitRights: number[];
  /** 每段真正可見墨水的中心；動畫以此縮放，避免圖案在片段內滑動。 */
  unitPivots: number[];
  unitPivotsY: number[];
  /** 小單位獨立繪製時的 baseline 起點，已校回完整 native 字串的墨水中心。 */
  unitOrigins: number[];
  unitOriginsY: number[];
  unitBaseScaleX: number[];
  unitBaseScaleY: number[];
  unitBeatIndices: number[];
  beatCount: number;
  /** 保證正式動畫沒有任何矩形裁切；測試也會逐顆檢查此旗標。 */
  unitUseSlice: boolean[];
  /** 靜止顯示與外框沿用瀏覽器原生字素排版，不受動畫拆分影響。 */
  staticUnits: string[];
  staticCenters: number[];
  staticUnitInks: SymbolInk[];
  advance: number;
  /** 依照原始 units/centers 實際畫出的聯集墨水範圍；以字級 1 為單位。 */
  ink: SymbolInk;
};

const REF = 100;
const MAX_SCAN_SIDE = 3072;
const cache = new Map<string, SymbolInk>();
const sizedCache = new Map<string, SymbolInk>();
const advanceCache = new Map<string, number>();
const unitLayoutCache = new Map<string, SymbolUnitLayout>();
const splitUnitCache = new Map<string, string[]>();

/** 字體剛下載完成時丟掉 fallback 的量測結果。 */
export const clearSymbolInkCache = () => {
  cache.clear();
  sizedCache.clear();
  advanceCache.clear();
  unitLayoutCache.clear();
  splitUnitCache.clear();
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
        /* getImageData 成功時，alpha 掃描就是真正顯示在畫面上的墨水。
           不能再和 TextMetrics 聯集：WebKit/Chromium 的 actualBoundingBox*
           對 middle baseline 仍可能以 alphabetic baseline 回報，會在上方製造
           數十像素的假空白，正是長符號外框偏移、左／右留白不一致的來源。 */
        left = x0 - ax;
        right = x1 + 1 - ax;
        top = y0 - ay;
        bottom = y1 + 1 - ay;
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
  /* Canvas 在 iPhone 上实际以 DPR=2/3 rasterize；若只用 CSS 字号扫描，
     冷门字形的 hinting 会和画面相差数像素，框就会偏。用同一设备倍率扫描，
     最后仍除回 scanSize，所以回传几何单位不变。 */
  const dpr = typeof window !== 'undefined'
    ? Math.max(1, Math.min(3, window.devicePixelRatio || 1)) : 1;
  const rasterSize = size * dpr;
  const key = `${family}|${text}|${size}|dpr:${dpr}`;
  const hit = sizedCache.get(key);
  if (hit) return hit;
  const out = scanInk(text, family, rasterSize) || measureSymbolInk(text, family);
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
 * 把原生完整字串切在「真正沒有墨水」的直欄，而不是切在 advance 邊界。
 * 字形常會伸出 advance（星角、弧線、斜筆尤其明顯）；直接拿 prefix width
 * 當剪裁線就會把筆畫剖開，泡泡／縮放 II 看起來像被直刀切過。
 */
const findSafeSymbolSlices = (
  text: string,
  family: string,
  size: number,
  spans: Array<{ left: number; right: number }>,
) => {
  const fallback = () => ({
    lefts: spans.map(span => span.left),
    rights: spans.map(span => span.right),
    pivots: spans.map(span => (span.left + span.right) / 2),
    inkWidths: spans.map(span => Math.max(.01, span.right - span.left)),
    fullInkCenter: spans.length ? (spans[0].left + spans[spans.length - 1].right) / 2 : 0,
  });
  if (typeof document === 'undefined' || spans.length < 1) return fallback();
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return fallback();
    let scanSize = Math.max(16, size * Math.max(1, Math.min(2, window.devicePixelRatio || 1)));
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    let total = Math.max(scanSize, ctx.measureText(text).width);
    if (total + scanSize * 4 > MAX_SCAN_SIDE) {
      scanSize *= MAX_SCAN_SIDE / (total + scanSize * 4);
      ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
      total = Math.max(scanSize, ctx.measureText(text).width);
    }
    const ratio = scanSize / size;
    const pad = Math.min(scanSize * 2, Math.max(4, (MAX_SCAN_SIDE - total) / 2));
    canvas.width = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(total + pad * 2)));
    canvas.height = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(scanSize * 2.4)));
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const ax = canvas.width / 2, ay = canvas.height / 2;
    ctx.fillText(text, ax, ay);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const columns = new Uint16Array(canvas.width);
    let firstInk = canvas.width, lastInk = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 8) {
          columns[x]++;
          if (x < firstInk) firstInk = x;
          if (x > lastInk) lastInk = x;
        }
      }
    }
    if (lastInk < firstInk) return fallback();

    const boundaries: number[] = [];
    for (let i = 0; i < spans.length - 1; i++) {
      const nominal = ax + spans[i].right * ratio;
      const leftCenter = ax + (spans[i].left + spans[i].right) / 2 * ratio;
      const rightCenter = ax + (spans[i + 1].left + spans[i + 1].right) / 2 * ratio;
      const lo = Math.max(0, Math.ceil(Math.min(leftCenter, rightCenter)));
      const hi = Math.min(canvas.width - 1, Math.floor(Math.max(leftCenter, rightCenter)));
      let best = Math.max(lo, Math.min(hi, Math.round(nominal)));
      let bestInk = columns[best] ?? 65535;
      let bestDistance = Math.abs(best - nominal);
      for (let x = lo; x <= hi; x++) {
        const inkCount = columns[x];
        const distance = Math.abs(x - nominal);
        if (inkCount < bestInk || (inkCount === bestInk && distance < bestDistance)) {
          best = x; bestInk = inkCount; bestDistance = distance;
        }
      }
      boundaries.push((best + .5 - ax) / ratio);
    }
    /* 每條邊各自找最近透明欄時，密集符號的搜尋區可能重疊；強制維持
       左到右順序，否則相鄰 clip 會交叉並漏掉一整塊墨水。 */
    const minStep = .5 / ratio;
    for (let i = 1; i < boundaries.length; i++) {
      if (boundaries[i] <= boundaries[i - 1]) {
        boundaries[i] = boundaries[i - 1] + minStep;
      }
    }

    /* 小字級 hinting 可能讓最外側筆畫比 2× 掃描多冒出數個像素；外緣沒有
       鄰居會重疊，直接多留半個 em，絕不能把首尾裝飾裁掉。 */
    const outerLeft = Math.min(spans[0].left, (firstInk - 1 - ax) / ratio) - size * .5;
    const outerRight = Math.max(spans[spans.length - 1].right, (lastInk + 2 - ax) / ratio) + size * .5;
    const lefts = spans.map((_span, i) => i ? boundaries[i - 1] : outerLeft);
    const rights = spans.map((_span, i) => i < boundaries.length ? boundaries[i] : outerRight);
    const inkWidths: number[] = [];
    const pivots = lefts.map((left, i) => {
      const x0 = Math.max(0, Math.floor(ax + left * ratio));
      const x1 = Math.min(canvas.width - 1, Math.ceil(ax + rights[i] * ratio));
      let l = x1, r = x0 - 1;
      for (let x = x0; x <= x1; x++) if (columns[x]) { l = Math.min(l, x); r = Math.max(r, x); }
      inkWidths.push(r >= l ? (r - l + 1) / ratio : Math.max(.01, rights[i] - left));
      return r >= l ? ((l + r + 1) / 2 - ax) / ratio : (left + rights[i]) / 2;
    });
    canvas.width = canvas.height = 0;
    const fullInkCenter = ((firstInk + lastInk + 1) / 2 - ax) / ratio;
    return { lefts, rights, pivots, inkWidths, fullInkCenter };
  } catch {
    return fallback();
  }
};

/** 在同一個 DPR raster 上量一次「完整 grapheme 各自繪製」的聯集中心。
 * 只在建立版面時執行一次並快取；手勢與動畫幀完全不會重新量測。 */
const measureStandaloneCompositionCenter = (
  text: string,
  units: string[],
  origins: number[],
  originsY: number[],
  family: string,
  size: number,
): { x: number; y: number; w: number; h: number } | null => {
  if (typeof document === 'undefined' || !units.length) return null;
  try {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    let scanSize = Math.max(16, size * dpr);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return null;
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    let total = Math.max(scanSize, ctx.measureText(text).width);
    if (total + scanSize * 8 > MAX_SCAN_SIDE) {
      scanSize *= MAX_SCAN_SIDE / (total + scanSize * 8);
      ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
      total = Math.max(scanSize, ctx.measureText(text).width);
    }
    const ratio = scanSize / size;
    const pad = Math.min(scanSize * 4, Math.max(4, (MAX_SCAN_SIDE - total) / 2));
    canvas.width = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(total + pad * 2)));
    /* 附加記號可能伸到 em 方框數倍之外；高度太小會把 standalone 掃描本身
       截斷，接著產生假的垂直校正。與完整墨水掃描一樣保留上下各 4em。 */
    canvas.height = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(scanSize * 8)));
    const ax = canvas.width / 2, ay = canvas.height / 2;
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    units.forEach((unit, index) => ctx.fillText(
      unit, ax + origins[index] * ratio, ay + originsY[index] * ratio));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 0) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    canvas.width = canvas.height = 0;
    return right >= left ? {
      x: ((left + right + 1) / 2 - ax) / ratio,
      y: ((top + bottom + 1) / 2 - ay) / ratio,
      w: (right - left + 1) / ratio,
      h: (bottom - top + 1) / ratio,
    } : null;
  } catch { return null; }
};

/**
 * 泡泡與縮放 II 的最小單位必須是「完整字素」，不能是 UTF-16 code unit/code point。
 * Intl.Segmenter 會把代理對、附加記號與變體選擇符留在同一顆字素內，因此既不會
 * 把符號拆壞，也不會因整串含一個附加記號就讓整顆符號完全失去逐顆動畫。
 */
/* 靜止排版仍使用瀏覽器的完整 grapheme。這份切分只负责位置与外框，
   不参与泡泡／缩放 II 的节奏，避免动画需求反过来改变原符号位置。 */
const splitSymbolClusters = (text: string): string[] => {
  let raw: string[] = [];
  try {
    const Segmenter = (Intl as any).Segmenter;
    if (Segmenter) {
      raw = Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        (part: any) => part.segment as string);
    }
  } catch { /* 舊 Safari 走保守分組 */ }
  if (!raw.length) {
    for (const ch of Array.from(text)) {
      const attach = /\p{Mark}/u.test(ch) || /[\ufe00-\ufe0f\u200d]/u.test(ch)
        || (raw.length > 0 && raw[raw.length - 1].endsWith("\u200d"));
      if (raw.length && attach) raw[raw.length - 1] += ch;
      else raw.push(ch);
    }
  }
  const invisible = /^[\s\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/u;
  const out: string[] = [];
  let leading = '';
  raw.forEach(part => {
    if (invisible.test(part)) {
      if (out.length) out[out.length - 1] += part;
      else leading += part;
    } else {
      out.push(leading + part);
      leading = '';
    }
  });
  if (leading && out.length) out[out.length - 1] += leading;
  return out.length ? out : [text];
};

const splitSymbolTimingUnits = (text: string): string[] => {
  const raw: string[] = [];
  for (const ch of Array.from(text)) {
    const variation = /[\ufe00-\ufe0f]/u.test(ch);
    const joiner = ch === '\u200d';
    const continuesJoiner = raw.length > 0 && raw[raw.length - 1].endsWith('\u200d');
    if (raw.length && (variation || joiner || continuesJoiner)) raw[raw.length - 1] += ch;
    else raw.push(ch);
  }
  const invisible = /^[\s\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/u;
  const out: string[] = [];
  let leading = '';
  for (const part of raw) {
    if (invisible.test(part)) {
      if (out.length) out[out.length - 1] += part;
      else leading += part;
    } else { out.push(leading + part); leading = ''; }
  }
  if (leading && out.length) out[out.length - 1] += leading;
  return out.length ? out : [text];
};

export const countSymbolAnimationBeats = (text: string) =>
  text ? splitSymbolTimingUnits(text).length : 0;

/**
 * 判斷相鄰兩段分開繪製後是否仍與瀏覽器整段 shaping 相同。
 * 字寬相同不代表像素相同（fallback 字體、kerning、附加記號都可能改字形），
 * 所以直接比較同一張 Canvas 上的 alpha；有上下文依賴就必須合併成一個單位。
 */
const pairKeepsNativeShape = (left: string, right: string, family: string, size: number) => {
  if (typeof document === 'undefined') return true;
  try {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const scanSize = Math.max(24, size);
    const canvasA = document.createElement('canvas');
    const canvasB = document.createElement('canvas');
    const probe = canvasA.getContext('2d');
    if (!probe) return true;
    probe.font = `400 ${scanSize}px ${fontStack(family)}`;
    const leftW = probe.measureText(left).width;
    const totalW = Math.max(scanSize, probe.measureText(left + right).width, leftW + probe.measureText(right).width);
    const pad = scanSize * 2;
    const cssWidth = totalW + pad * 2, cssHeight = scanSize * 3;
    const width = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(cssWidth * dpr)));
    const height = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(cssHeight * dpr)));
    canvasA.width = canvasB.width = width;
    canvasA.height = canvasB.height = height;
    const a = canvasA.getContext('2d', { willReadFrequently: true } as any);
    const b = canvasB.getContext('2d', { willReadFrequently: true } as any);
    if (!a || !b) return true;
    for (const ctx of [a, b]) {
      ctx.scale(dpr, dpr);
      ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    }
    const y = cssHeight / 2;
    a.fillText(left + right, pad, y);
    b.fillText(left, pad, y);
    b.fillText(right, pad + leftW, y);
    const pa = a.getImageData(0, 0, width, height).data;
    const pb = b.getImageData(0, 0, width, height).data;
    let union = 0, changed = 0;
    for (let i = 3; i < pa.length; i += 4) {
      if (pa[i] > 8 || pb[i] > 8) union++;
      if (Math.abs(pa[i] - pb[i]) > 12) changed++;
    }
    canvasA.width = canvasA.height = canvasB.width = canvasB.height = 0;
    return union === 0 || changed / union <= .012;
  } catch { return false; }
};

const compositionKeepsNativeShape = (text: string, units: string[], family: string, size: number) => {
  if (typeof document === 'undefined' || units.length < 2) return true;
  try {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    let scanSize = Math.max(24, size);
    const probeCanvas = document.createElement('canvas');
    const probe = probeCanvas.getContext('2d');
    if (!probe) return true;
    probe.font = `400 ${scanSize}px ${fontStack(family)}`;
    let advance = probe.measureText(text).width;
    let totalW = Math.max(scanSize, advance);
    if ((totalW + scanSize * 4) * dpr > MAX_SCAN_SIDE) {
      scanSize *= MAX_SCAN_SIDE / ((totalW + scanSize * 4) * dpr);
      probe.font = `400 ${scanSize}px ${fontStack(family)}`;
      advance = probe.measureText(text).width;
      totalW = Math.max(scanSize, advance);
    }
    const pad = Math.min(scanSize * 2, Math.max(4, (MAX_SCAN_SIDE / dpr - totalW) / 2));
    const cssWidth = totalW + pad * 2, cssHeight = scanSize * 3;
    const width = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(cssWidth * dpr)));
    const height = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(cssHeight * dpr)));
    const nativeCanvas = document.createElement('canvas');
    const unitsCanvas = document.createElement('canvas');
    nativeCanvas.width = unitsCanvas.width = width;
    nativeCanvas.height = unitsCanvas.height = height;
    const nativeCtx = nativeCanvas.getContext('2d', { willReadFrequently: true } as any);
    const unitsCtx = unitsCanvas.getContext('2d', { willReadFrequently: true } as any);
    if (!nativeCtx || !unitsCtx) return true;
    for (const ctx of [nativeCtx, unitsCtx]) {
      ctx.scale(dpr, dpr);
      ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
      ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    }
    const y = cssHeight / 2;
    /* 正式畫布以物件中心為固定 anchor，再由整串 advance 往左右展開；
       不能反過來固定左緣，否則次像素相位不同時會漏判 emoji/fallback 差異。 */
    const anchor = Math.round(cssWidth / 2);
    nativeCtx.textAlign = 'center';
    nativeCtx.fillText(text, anchor, y);
    let prefix = '';
    for (const unit of units) {
      const start = unitsCtx.measureText(prefix).width;
      prefix += unit;
      const end = unitsCtx.measureText(prefix).width;
      unitsCtx.textAlign = 'center';
      unitsCtx.fillText(unit, anchor - advance / 2 + (start + end) / 2, y);
    }
    const nativePixels = nativeCtx.getImageData(0, 0, width, height).data;
    const unitPixels = unitsCtx.getImageData(0, 0, width, height).data;
    let union = 0, changed = 0;
    const nativeBounds = { left: width, right: -1, top: height, bottom: -1 };
    const unitBounds = { left: width, right: -1, top: height, bottom: -1 };
    for (let i = 3; i < nativePixels.length; i += 4) {
      if (nativePixels[i] > 8 || unitPixels[i] > 8) union++;
      if (Math.abs(nativePixels[i] - unitPixels[i]) > 1) changed++;
      const pixel = (i - 3) / 4;
      const x = pixel % width, py = Math.floor(pixel / width);
      if (nativePixels[i] > 8) {
        nativeBounds.left = Math.min(nativeBounds.left, x);
        nativeBounds.right = Math.max(nativeBounds.right, x);
        nativeBounds.top = Math.min(nativeBounds.top, py);
        nativeBounds.bottom = Math.max(nativeBounds.bottom, py);
      }
      if (unitPixels[i] > 8) {
        unitBounds.left = Math.min(unitBounds.left, x);
        unitBounds.right = Math.max(unitBounds.right, x);
        unitBounds.top = Math.min(unitBounds.top, py);
        unitBounds.bottom = Math.max(unitBounds.bottom, py);
      }
    }
    nativeCanvas.width = nativeCanvas.height = unitsCanvas.width = unitsCanvas.height = 0;
    /* 次像素 hinting 可能改變少量 alpha，卻不會讓肉眼看到跑位。只有拆分後
       的實際墨水邊界移動超過一個 device pixel 才整組合併；因此保住位置的
       同時，不會把原本可逐顆播放的長符號退化成一整組。 */
    const boundsStable = nativeBounds.right < nativeBounds.left || (
      Math.abs(nativeBounds.left - unitBounds.left) <= 1
      && Math.abs(nativeBounds.right - unitBounds.right) <= 1
      && Math.abs(nativeBounds.top - unitBounds.top) <= 1
      && Math.abs(nativeBounds.bottom - unitBounds.bottom) <= 1
    );
    return union === 0 || changed <= 2 || boundsStable;
  } catch { return false; }
};

/**
 * 泡泡與縮放 II 的最小單位以原生 grapheme 為起點；若相鄰單位分開畫會
 * 改變任何字形結構，就自動合併。這讓可安全分開的小符號仍各自播放，同時
 * 保證帶附加記號、fallback 或 contextual shaping 的組合不會錯位散開。
 */
export const splitSymbolUnits = (text: string, family = 'sans-serif', fontSize = REF): string[] => {
  if (!text) return [];
  const size = Math.max(8, Math.round(fontSize * 1000) / 1000);
  const key = `${family}|${text}|${size}`;
  const cached = splitUnitCache.get(key);
  if (cached) return cached;
  const raw = splitSymbolClusters(text);
  const out: string[] = [];
  for (const cluster of raw) {
    if (out.length && !pairKeepsNativeShape(out[out.length - 1], cluster, family, size)) {
      out[out.length - 1] += cluster;
    } else out.push(cluster);
  }
  /* 不再因整串 fallback 有細微差異就把所有單元合成一組；版面建立時會用
     完整原生墨水边界统一校准，泡泡與縮放 II 才能保留逐顆動畫。 */
  const result = out.length ? out : [text];
  splitUnitCache.set(key, result);
  return result;
};

/**
 * 量出同一個 native grapheme 裡，每個肉眼可見 code point 真正新增的墨水中心。
 * 例如「*ੈ」在系統排版裡是一個 grapheme，但 * 與 ੈ 必須各自播放動畫；逐步
 * 繪製 prefix，再比較新增的 alpha，就能保留 ੈ 原本相對於 * 的精確位置。
 */
const measureClusterPartCenters = (
  cluster: string,
  parts: string[],
  family: string,
  size: number,
): Array<{ x: number; y: number } | null> => {
  if (typeof document === 'undefined' || parts.length < 2) return parts.map(() => null);
  try {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    let scanSize = Math.max(16, size * dpr);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return parts.map(() => null);
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    let width = Math.max(scanSize, ctx.measureText(cluster).width);
    if (width + scanSize * 8 > MAX_SCAN_SIDE) {
      scanSize *= MAX_SCAN_SIDE / (width + scanSize * 8);
      ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
      width = Math.max(scanSize, ctx.measureText(cluster).width);
    }
    const ratio = scanSize / size;
    const pad = scanSize * 4;
    canvas.width = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(width + pad * 2)));
    canvas.height = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(scanSize * 8)));
    const ax = pad, ay = canvas.height / 2;
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    let prefix = '';
    let previous = new Uint8Array(canvas.width * canvas.height);
    const result: Array<{ x: number; y: number } | null> = [];
    parts.forEach(part => {
      prefix += part;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillText(prefix, ax, ay);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const current = new Uint8Array(previous.length);
      let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
      for (let i = 0; i < current.length; i++) {
        const alpha = rgba[i * 4 + 3];
        current[i] = alpha;
        /* 只追蹤新增加的墨水；既有字形因 shaping 產生的一點 AA 變化不應
           把中心拉回主字。 */
        if (alpha > previous[i] + 24) {
          const x = i % canvas.width, y = Math.floor(i / canvas.width);
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      result.push(right >= left ? {
        x: ((left + right + 1) / 2 - ax) / ratio,
        y: ((top + bottom + 1) / 2 - ay) / ratio,
      } : null);
      previous = current;
    });
    canvas.width = canvas.height = 0;
    return result;
  } catch { return parts.map(() => null); }
};

/**
 * 唯一的符號版面來源。靜止、外框、泡泡與縮放 II 全部讀這一份資料：
 * 只掃描一次完整原生字串取得外框，再用整串 prefix advance 建立動畫切片。
 * 小單位不另外排字或掃描，因此首次新增與手勢幀都不會被同步量測拖慢。
 */
export const measureSymbolUnitLayout = (
  text: string,
  family: string,
  fontSize: number,
): SymbolUnitLayout => {
  const size = Math.max(8, Math.round(fontSize * 1000) / 1000);
  const key = `${family}|${text}|${size}`;
  const hit = unitLayoutCache.get(key);
  if (hit) return hit;

  /* 一次完整字串 alpha 掃描就是外框的唯一來源。上一版在首次新增時又為
     每個小單位各掃一次，長符號會同步建立幾十張 Canvas，正是點擊延遲與
     第一段拖曳掉幀的主因；那些結果現已不參與任何正式繪製。 */
  const originalClusters = splitSymbolUnits(text, family, size);
  const advance = measureSymbolAdvance(text, family, size);
  const ink = measureSymbolInkAtSize(text, family, size);
  const staticUnits = [text];
  const staticCenters = [0];
  const staticUnitInks = [ink];

  /* 動畫只需要完整 native shaping 中每個 grapheme 的水平切片，不需要把
     grapheme 另外 rasterize。 */
  const units: string[] = [];
  const centers: number[] = [];
  const unitClusters: number[] = [];
  const unitLefts: number[] = [];
  const unitRights: number[] = [];
  let nativeSpans = originalClusters.map((_cluster, i) => ({
    left: ((i / Math.max(1, originalClusters.length)) - .5) * advance,
    right: (((i + 1) / Math.max(1, originalClusters.length)) - .5) * advance,
  }));
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `400 ${size}px ${fontStack(family)}`;
      const total = ctx.measureText(text).width;
      nativeSpans = originalClusters.map((_cluster, i) => ({
        left: -total / 2 + ctx.measureText(originalClusters.slice(0, i).join('')).width,
        right: -total / 2 + ctx.measureText(originalClusters.slice(0, i + 1).join('')).width,
      }));
    }
  } catch { /* 等分范围仍可安全绘制 */ }
  const safeSlices = findSafeSymbolSlices(text, family, size, nativeSpans);
  const unitPivots: number[] = [];
  const unitPivotsY: number[] = [];
  const unitOrigins: number[] = [];
  const unitOriginsY: number[] = [];
  const unitBaseScaleX: number[] = [];
  const unitBaseScaleY: number[] = [];
  const unitBeatIndices: number[] = [];
  const unitUseSlice: boolean[] = [];
  let unitMetricCtx: CanvasRenderingContext2D | null = null;
  try {
    unitMetricCtx = document.createElement('canvas').getContext('2d');
    if (unitMetricCtx) unitMetricCtx.font = `400 ${size}px ${fontStack(family)}`;
  } catch { /* 退回 prefix 起點 */ }
  let consumedBeats = 0;
  originalClusters.forEach((cluster, clusterIndex) => {
    const coveredBeats = Math.max(1, splitSymbolTimingUnits(cluster).length);
    const origin = (nativeSpans[clusterIndex].left + nativeSpans[clusterIndex].right) / 2;
    const pivot = safeSlices.pivots[clusterIndex];
    let pivotY = 0;
    if (unitMetricCtx) {
      const metrics = unitMetricCtx.measureText(cluster);
      pivotY = ((Number(metrics.actualBoundingBoxDescent) || 0)
        - (Number(metrics.actualBoundingBoxAscent) || 0)) / 2;
    }
    units.push(cluster);
    centers.push(pivot);
    unitClusters.push(clusterIndex);
    unitLefts.push(safeSlices.lefts[clusterIndex]);
    unitRights.push(safeSlices.rights[clusterIndex]);
    unitPivots.push(pivot);
    unitPivotsY.push(pivotY);
    /* 原生中心 anchor 與原生 baseline 原樣保留；動畫只改這個單位的 scale。 */
    unitOrigins.push(origin);
    unitOriginsY.push(0);
    unitBaseScaleX.push(1);
    unitBaseScaleY.push(1);
    /* 若多個 code point 必須共用同一個安全排版 run，就沿用第一顆原始小單位
       的節拍；不能取平均而把整組延後，否則泡泡與縮放 II 會明顯變慢。 */
    unitBeatIndices.push(consumedBeats);
    consumedBeats += coveredBeats;
    unitUseSlice.push(false);
  });
  /* 少數 fallback 字體在分段繪製時 bearing 會略有不同。保留全部獨立動畫
     單元，再只對整組做一次中心與外框校準；不再為了位置穩定把整串退化成
     一個動畫單元。 */
  if (!compositionKeepsNativeShape(text, originalClusters, family, size)) {
    const composed = measureStandaloneCompositionCenter(
      text, units, unitOrigins, unitOriginsY, family, size);
    if (composed && composed.w > .01 && composed.h > .01) {
      const targetX = ink.cx * size, targetY = ink.cy * size;
      const sx = Math.max(.5, Math.min(2, ink.w * size / composed.w));
      const sy = Math.max(.5, Math.min(2, ink.h * size / composed.h));
      for (let i = 0; i < units.length; i++) {
        const oldPivotX = unitPivots[i], oldPivotY = unitPivotsY[i];
        const nextPivotX = targetX + (oldPivotX - composed.x) * sx;
        const nextPivotY = targetY + (oldPivotY - composed.y) * sy;
        unitOrigins[i] = nextPivotX + unitOrigins[i] - oldPivotX;
        unitOriginsY[i] = nextPivotY + unitOriginsY[i] - oldPivotY;
        centers[i] = nextPivotX;
        unitPivots[i] = nextPivotX;
        unitPivotsY[i] = nextPivotY;
        unitLefts[i] = targetX + (unitLefts[i] - composed.x) * sx;
        unitRights[i] = targetX + (unitRights[i] - composed.x) * sx;
        unitBaseScaleX[i] = sx;
        unitBaseScaleY[i] = sy;
      }
    }
  }
  /* 動畫不用矩形 clip；每個通過像素驗證的完整 run 都直接繪製。 */
  const out = {
    units, centers, unitClusters, unitLefts, unitRights,
    unitPivots, unitPivotsY, unitOrigins, unitOriginsY,
    unitBaseScaleX, unitBaseScaleY, unitBeatIndices,
    beatCount: Math.max(1, countSymbolAnimationBeats(text)), unitUseSlice,
    staticUnits, staticCenters, staticUnitInks,
    advance, ink,
  };
  unitLayoutCache.set(key, out);
  return out;
};

/**
 * 縮放 II 的單位倍率。每顆完整字素都有不同的相位與速度，但在常駐動畫
 * 接手的第一幀全部精確從 1 開始；短 attack 讓差異平滑長出，不會瞬移。
 */
export const symbolBreatheScale = (
  index: number,
  time: number,
  amp: number,
  speed: number,
) => {
  const t = Math.max(0, time);
  const attackP = Math.min(1, t / .22);
  const attack = attackP * attackP * (3 - 2 * attackP);
  const phase = (index * 2.399963229728653) % (Math.PI * 2);
  const rate = .84 + ((index * 37) % 11) / 10 * .32;
  const wave = Math.sin(t * 1.5 * Math.max(.05, speed) * rate + phase);
  return 1 + wave * Math.max(0, amp) / 100 * .18 * attack;
};

/** 完整包住墨水並在四邊保留一致安全距離。 */
export const symbolBox = (text: string, family: string, size: number, gap = 4) => {
  const ink = measureSymbolInkAtSize(text, family, size);
  return { w: Math.max(6, ink.w * size + gap * 2), h: Math.max(6, ink.h * size + gap * 2) };
};
