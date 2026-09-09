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
 * 泡泡與縮放 II 的最小單位必須是「完整字素」，不能是 UTF-16 code unit/code point。
 * Intl.Segmenter 會把代理對、附加記號與變體選擇符留在同一顆字素內，因此既不會
 * 把符號拆壞，也不會因整串含一個附加記號就讓整顆符號完全失去逐顆動畫。
 */
export const splitSymbolUnits = (text: string): string[] => {
  if (!text) return [];

  /* Intl.Segmenter 的 grapheme 規則適合游標移動，卻不適合這裡的視覺動畫：
     它會把一個主字與旁邊數顆可見附加點／星／弧線合成一顆 grapheme，
     於是肉眼看到五顆，泡泡與縮放 II 卻只播放兩三組。動畫改以 code point
     為基礎；只有變體選擇符與 ZWJ 序列仍黏回主字，避免拆壞真正的單一字形。 */
  const raw: string[] = [];
  for (const ch of Array.from(text)) {
    const variation = /[\ufe00-\ufe0f]/u.test(ch);
    const joiner = ch === "\u200d";
    const continuesJoiner = raw.length > 0 && raw[raw.length - 1].endsWith("\u200d");
    if (raw.length && (variation || joiner || continuesJoiner)) raw[raw.length - 1] += ch;
    else raw.push(ch);
  }

  /* 空白與格式控制沒有自己的墨水，也不能佔動畫節拍；留在前一單位內只負責
     保持原本間距。附加符號本身不再併回主字，因此每顆可見裝飾都有獨立節奏。 */
  const invisible = /^[\s\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/u;
  const out: string[] = [];
  let leading = '';
  for (const part of raw) {
    if (invisible.test(part)) {
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
  const originalClusters = splitSymbolClusters(text);
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
  originalClusters.forEach((cluster, clusterIndex) => {
    units.push(cluster);
    centers.push((nativeSpans[clusterIndex].left + nativeSpans[clusterIndex].right) / 2);
    unitClusters.push(clusterIndex);
    unitLefts.push(nativeSpans[clusterIndex].left);
    unitRights.push(nativeSpans[clusterIndex].right);
  });

  const out = {
    units, centers, unitClusters, unitLefts, unitRights,
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
