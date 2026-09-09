import { fontStack } from './fonts';

export type SymbolInk = { w: number; h: number; cx: number; cy: number };
export type SymbolUnitLayout = {
  /** 動畫用的可見小單元；附加點、星、弧線可以各自取得時間相位。 */
  units: string[];
  centers: number[];
  unitInks: SymbolInk[];
  /** 每个动画单元继承自哪一个稳定 grapheme，只用于辨认原生叠合关系。 */
  unitClusters: number[];
  /** 靜止顯示與外框沿用瀏覽器原生字素排版，不受動畫拆分影響。 */
  staticUnits: string[];
  staticCenters: number[];
  staticUnitInks: SymbolInk[];
  /** 只影響實際繪製、不參與外框幾何的精準微調；單位是 canvas px。 */
  drawOffsetsX: number[];
  drawOffsetsY: number[];
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
 * 先用整串 prefix advance 決定每個安全字素的位置，再掃描每個單位真正的 alpha
 * 墨水，最後把聯集中心校到 (0,0)。之後任何頁面都不再重新排一次符號。
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

  /* 先完全照修改前的 grapheme 逻辑排静止版。动画拆成多少小单元，
     都不能反过来改变这一组中心、总宽度或选中框。 */
  let staticUnits = splitSymbolClusters(text);
  const originalClusters = staticUnits.slice();
  const needsNativeTiming = text.includes("\u0a48");
  let advance = measureSymbolAdvance(text, family, size);
  let staticCenters = staticUnits.map((_unit, i) =>
    ((i + .5) / Math.max(1, staticUnits.length) - .5) * advance);
  let staticAdvances = staticUnits.map(() => advance / Math.max(1, staticUnits.length));
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `400 ${size}px ${fontStack(family)}`;
      staticAdvances = staticUnits.map(unit => Math.max(.01, ctx.measureText(unit).width));
      advance = Math.max(.1, staticAdvances.reduce((sum, value) => sum + value, 0));
      let cursor = -advance / 2;
      staticCenters = staticAdvances.map(value => {
        const center = cursor + value / 2;
        cursor += value;
        return center;
      });
    }
  } catch { /* 均匀中心仍可用 */ }

  let staticUnitInks = staticUnits.map(unit => measureSymbolInkAtSize(unit, family, size));
  const minVisibleGap = Math.max(.35, size * .006);
  for (let i = 1; i < staticCenters.length; i++) {
    const prev = staticUnitInks[i - 1], cur = staticUnitInks[i];
    const previousRight = staticCenters[i - 1] + prev.cx * size + prev.w * size / 2;
    const currentLeft = staticCenters[i] + cur.cx * size - cur.w * size / 2;
    if (currentLeft < previousRight + minVisibleGap) {
      staticCenters[i] += previousRight + minVisibleGap - currentLeft;
    }
  }

  const clusterBounds = (xs: number[]) => {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    staticUnitInks.forEach((ink, i) => {
      const cx = xs[i] + ink.cx * size, cy = ink.cy * size;
      left = Math.min(left, cx - ink.w * size / 2);
      right = Math.max(right, cx + ink.w * size / 2);
      top = Math.min(top, cy - ink.h * size / 2);
      bottom = Math.max(bottom, cy + ink.h * size / 2);
    });
    if (!Number.isFinite(left)) return { left: 0, right: 1, top: 0, bottom: 1 };
    return { left, right, top, bottom };
  };
  const first = clusterBounds(staticCenters);
  const shiftX = -(first.left + first.right) / 2;
  staticCenters = staticCenters.map(x => x + shiftX);
  const final = clusterBounds(staticCenters);
  let ink: SymbolInk = {
    w: Math.max(.01, final.right - final.left) / size,
    h: Math.max(.01, final.bottom - final.top) / size,
    cx: (final.left + final.right) / 2 / size,
    cy: (final.top + final.bottom) / 2 / size,
  };

  /* 含 ੈ 的符号需要把组合记号拆成独立节拍，但静止外观必须直接使用
     整串原生 shaping，才能保持 iPhone 上 ‧ 与 ₊ 的大小、间距和位置。 */
  if (needsNativeTiming) {
    staticUnits = [text];
    staticCenters = [0];
    staticUnitInks = [measureSymbolInkAtSize(text, family, size)];
    ink = staticUnitInks[0];
  }

  /* 一般符号继续沿用已验证的完整 grapheme 动画；只有含 ੈ 的结构
     才分开可见 code point 的时间，同时共用所属 grapheme 的原生锚点。 */
  const units: string[] = [];
  const centers: number[] = [];
  const unitClusters: number[] = [];
  originalClusters.forEach((cluster, clusterIndex) => {
    const parts = needsNativeTiming ? splitSymbolUnits(cluster) : [cluster];
    parts.forEach(part => {
      units.push(part);
      centers.push(needsNativeTiming
        ? (() => {
            try {
              const ctx = document.createElement('canvas').getContext('2d');
              if (ctx) {
                ctx.font = `400 ${size}px ${fontStack(family)}`;
                const beforeText = originalClusters.slice(0, clusterIndex).join('');
                const throughText = originalClusters.slice(0, clusterIndex + 1).join('');
                const before = ctx.measureText(beforeText).width;
                const after = ctx.measureText(throughText).width;
                const total = ctx.measureText(text).width;
                return -total / 2 + (before + after) / 2;
              }
            } catch {}
            return ((clusterIndex + .5) / originalClusters.length - .5) * advance;
          })()
        : staticCenters[clusterIndex]);
      unitClusters.push(clusterIndex);
    });
  });
  const unitInks = units.map(unit => measureSymbolInkAtSize(unit, family, size));

  /* 独立绘制 combining mark 后，它的 standalone alpha 中心可能和整串
     native shaping 不同。先把动画单元的墨水联集校回静止整串的真实中心；
     只消除进入动画页的整体跳位，不改变各单元之间的原生位置。 */
  let animLeft = Infinity, animRight = -Infinity, animTop = Infinity, animBottom = -Infinity;
  unitInks.forEach((unitInk, i) => {
    const ux = centers[i] + unitInk.cx * size;
    const uy = unitInk.cy * size;
    animLeft = Math.min(animLeft, ux - unitInk.w * size / 2);
    animRight = Math.max(animRight, ux + unitInk.w * size / 2);
    animTop = Math.min(animTop, uy - unitInk.h * size / 2);
    animBottom = Math.max(animBottom, uy + unitInk.h * size / 2);
  });
  const correctionX = Number.isFinite(animLeft)
    ? ink.cx * size - (animLeft + animRight) / 2 : 0;
  const correctionY = Number.isFinite(animTop)
    ? ink.cy * size - (animTop + animBottom) / 2 : 0;
  const drawOffsetsX = units.map(() => correctionX);
  const drawOffsetsY = units.map(() => correctionY);

  const seventhSymbol = "\u22b9 \u08ea \u02d6\u0359\u0358\u0361\u2605";
  if (text === seventhSymbol) {
    const dotIndex = units.findIndex(unit => unit.includes("\u08ea"));
    if (dotIndex >= 0) drawOffsetsX[dotIndex] -= size * 0.08;
  }

  const out = {
    units, centers, unitInks, unitClusters,
    staticUnits, staticCenters, staticUnitInks,
    drawOffsetsX, drawOffsetsY, advance, ink,
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
