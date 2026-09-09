import { fontStack } from './fonts';

export type SymbolInk = { w: number; h: number; cx: number; cy: number };
export type SymbolUnitLayout = {
  units: string[];
  /** 每個字素的固定排版中心；單位是 canvas px。 */
  centers: number[];
  /** 每個字素自己的可見墨水，動畫以它的中心作為縮放支點。 */
  unitInks: SymbolInk[];
  /** 只影響實際繪製、不參與外框幾何的精準微調；單位是 canvas px。 */
  drawOffsetsX: number[];
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
  const units = splitSymbolUnits(text);
  let advance = measureSymbolAdvance(text, family, size);
  let centers = units.map((_u, i) => ((i + .5) / Math.max(1, units.length) - .5) * advance);
  let unitAdvances = units.map(() => advance / Math.max(1, units.length));

  /* 沒有空白隔開的 combining mark 視覺上仍附著在前一顆主字，
     但動畫節奏必須獨立。它不另佔 advance，中心沿用主字；有空白隔開的 mark
     則是清單作者刻意放置的獨立小單元，照正常順序排版。 */
  const markOnly = (unit: string) =>
    /^\p{Mark}+[\s\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]*$/u.test(unit);
  const attachedTo = units.map(() => -1);

  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `400 ${size}px ${fontStack(family)}`;
      unitAdvances = units.map(unit => Math.max(.01, ctx.measureText(unit).width));
      for (let i = 1; i < units.length; i++) {
        if (markOnly(units[i]) && !/[\s\u200b\u200e\u200f]$/u.test(units[i - 1])) {
          attachedTo[i] = attachedTo[i - 1] >= 0 ? attachedTo[i - 1] : i - 1;
        }
      }
      advance = Math.max(.1, unitAdvances.reduce((sum, value, i) =>
        sum + (attachedTo[i] >= 0 ? 0 : value), 0));
      let cursor = -advance / 2;
      centers = units.map((_unit, i) => {
        if (attachedTo[i] >= 0) return centers[attachedTo[i]];
        const center = cursor + unitAdvances[i] / 2;
        cursor += unitAdvances[i];
        return center;
      });
    }
  } catch { /* 均勻錨點仍可用 */ }

  const unitInks = units.map(unit => measureSymbolInkAtSize(unit, family, size));

  /* 獨立小單元不得互相壓住；附著在同一主字上的可見 marks 刻意允許共用中心，
     才能保持原符號造型，同時由泡泡／縮放 II 分別取得不同時間相位。 */
  const minVisibleGap = Math.max(.35, size * .006);
  for (let i = 1; i < centers.length; i++) {
    if (attachedTo[i] >= 0) {
      centers[i] = centers[attachedTo[i]];
      continue;
    }
    let previousRight = -Infinity;
    for (let j = 0; j < i; j++) {
      const prev = unitInks[j];
      previousRight = Math.max(previousRight,
        centers[j] + prev.cx * size + prev.w * size / 2);
    }
    const cur = unitInks[i];
    const currentLeft = centers[i] + cur.cx * size - cur.w * size / 2;
    if (currentLeft < previousRight + minVisibleGap) {
      const delta = previousRight + minVisibleGap - currentLeft;
      centers[i] += delta;
      for (let j = i + 1; j < centers.length; j++) {
        if (attachedTo[j] === i) centers[j] += delta;
      }
    }
  }

  const bounds = (xs: number[]) => {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    unitInks.forEach((ink, i) => {
      const cx = xs[i] + ink.cx * size;
      const cy = ink.cy * size;
      left = Math.min(left, cx - ink.w * size / 2);
      right = Math.max(right, cx + ink.w * size / 2);
      top = Math.min(top, cy - ink.h * size / 2);
      bottom = Math.max(bottom, cy + ink.h * size / 2);
    });
    if (!Number.isFinite(left)) return { left: 0, right: 1, top: 0, bottom: 1 };
    return { left, right, top, bottom };
  };

  /* 固定校正一次，此後所有幀只改單位 scale，不再重算中心。 */
  const first = bounds(centers);
  const shiftX = -(first.left + first.right) / 2;
  centers = centers.map(x => x + shiftX);
  const final = bounds(centers);
  const ink: SymbolInk = {
    w: Math.max(.01, final.right - final.left) / size,
    h: Math.max(.01, final.bottom - final.top) / size,
    cx: (final.left + final.right) / 2 / size,
    cy: (final.top + final.bottom) / 2 / size,
  };
  /* 第七顆符號裡，U+08EA 是弧線左側那顆獨立小點。只移動它的
     繪製位置，不把位移算進 ink：符號本體更舒服，但既有選中框尺寸與位置不變。 */
  const seventhSymbol = "\u22b9 \u08ea \u02d6\u0359\u0358\u0361\u2605";
  const drawOffsetsX = units.map(() => 0);
  if (text === seventhSymbol) {
    const dotIndex = units.findIndex(unit => unit.includes("\u08ea"));
    if (dotIndex >= 0) drawOffsetsX[dotIndex] = -size * 0.08;
  }

  const out = { units, centers, unitInks, drawOffsetsX, advance, ink };
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
