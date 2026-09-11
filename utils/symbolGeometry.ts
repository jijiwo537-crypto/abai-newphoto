import { fontStack } from './fonts';
import { SYMBOLS } from './symbols';

/* iOS 對部分星星、愛心、天體等碼位會優先選 Apple Color Emoji。符號在
   產品裡是可改色的單色裝飾，不是 Emoji；為每個 pictograph 明確補上
   text-presentation selector。原始專案資料不變，只在量測／繪製時使用。 */
const pictograph = /\p{Extended_Pictographic}/u;
export const symbolTextPresentation = (text: string) => {
  /* 長裝飾字串需維持原始 advance；Safari 對大量 VS15 的 fallback 寬度會
     失真。長字串由下方 alpha 染色保證單色，不插入任何新碼位。 */
  if (isIOSProblemLongSymbol(text)) return text;
  const points = Array.from(text);
  let out = '';
  for (let i = 0; i < points.length; i++) {
    const ch = points[i];
    out += ch;
    if (pictograph.test(ch) && points[i + 1] !== '\ufe0e' && points[i + 1] !== '\ufe0f') out += '\ufe0e';
  }
  return out;
};

/* 清單從第 124 顆開始就是橫向長裝飾字串。Mobile Safari 對這批字串會依
   fallback 字體與當下字級偶發截掉右半、或回報過大的 advance；若只保護
   最後 12 顆，前面的長符號仍會出現框太短／太寬。用固定內容白名單，而
   不是會隨裝置字體改變的寬度門檻，確保前 123 顆原本正常的短符號不變。 */
const IOS_PROBLEM_LONG_SYMBOLS = new Set(SYMBOLS.slice(123));
export const isIOSProblemLongSymbol = (text: string) => IOS_PROBLEM_LONG_SYMBOLS.has(text);

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
const fastInkCache = new Map<string, SymbolInk>();
const sizedCache = new Map<string, SymbolInk>();
const advanceCache = new Map<string, number>();
const unitLayoutCache = new Map<string, SymbolUnitLayout>();
const splitUnitCache = new Map<string, string[]>();
const longRunCache = new Map<string, { runs: string[]; advances: number[]; total: number }>();
export const SYMBOL_STICKER_FONT_PX = 64;
/**
 * 短符號多留一級解析度，放大後仍保持銳利；長裝飾符號維持 64px，避免
 * iPhone 為超寬 Canvas 配置過多記憶體。兩者都只在建立貼圖時排版一次。
 */
export const symbolStickerFontPx = (text: string) =>
  isIOSProblemLongSymbol(text) ? SYMBOL_STICKER_FONT_PX : 96;
export type SymbolStickerRaster = {
  canvas: HTMLCanvasElement;
  fontPx: number;
  x: number; y: number; w: number; h: number;
  inkCenterX: number; inkCenterY: number;
};
const stickerCache = new Map<string, SymbolStickerRaster>();
const MAX_STICKER_CACHE = 32;
const tintCache = new Map<string, [number, number, number]>();
const tintRgb = (color: string): [number, number, number] => {
  const hit = tintCache.get(color); if (hit) return hit;
  let rgb: [number, number, number] = [255, 255, 255];
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (ctx) {
      ctx.fillStyle = color || '#fff'; ctx.fillRect(0, 0, 1, 1);
      const p = ctx.getImageData(0, 0, 1, 1).data; rgb = [p[0], p[1], p[2]];
    }
    canvas.width = canvas.height = 0;
  } catch { /* 白色是安全備援。 */ }
  tintCache.set(color, rgb); return rgb;
};
const forceMonochrome = (data: Uint8ClampedArray, color: string) => {
  const [r, g, b] = tintRgb(color);
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
};
export const symbolStickerOversample = (text: string) => {
  const iosCanvas = typeof navigator !== 'undefined' && (
    /iP(?:hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
  return iosCanvas && isIOSProblemLongSymbol(text) ? 2 : 3;
};
/* 符號選單一次要量完整份清單。每顆都建立一張 Canvas 會讓 iPhone 在點進
   選單時停住數百毫秒；量寬只需要一個 2D context，整個模組共用即可。 */
let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;
const sharedMeasureContext = () => {
  if (measureCtx || typeof document === 'undefined') return measureCtx;
  measureCanvas = document.createElement('canvas');
  measureCtx = measureCanvas.getContext('2d');
  return measureCtx;
};

/** 字體剛下載完成時丟掉 fallback 的量測結果。 */
export const clearSymbolInkCache = () => {
  cache.clear();
  fastInkCache.clear();
  sizedCache.clear();
  advanceCache.clear();
  unitLayoutCache.clear();
  splitUnitCache.clear();
  longRunCache.clear();
  tintCache.clear();
  stickerCache.forEach(sticker => { sticker.canvas.width = sticker.canvas.height = 0; });
  stickerCache.clear();
  if (typeof rasterLayerCache !== 'undefined') {
    rasterLayerCache.forEach(pack => {
      pack.layers.forEach(layer => { layer.canvas.width = layer.canvas.height = 0; });
      pack.fullCanvas.width = pack.fullCanvas.height = 0;
    });
    rasterLayerCache.clear();
  }
};
/* 只由 symbolFontReady 在符號字體本身完成時清一次。不能監聽全域
   document.fonts.ready：使用者新增一般文字、下載另一款字體時，會把正在
   使用的符號貼圖清掉並重新 shaping，造成符號與外框關係突然改變。 */

const fallbackInk = (text: string): SymbolInk => ({
  w: Math.max(.3, Array.from(text).length * .5),
  h: 1.2,
  cx: 0,
  cy: 0,
});

/**
 * iPhone 長符號專用的真實墨水量測。字級固定為 32px，並以完整 grapheme
 * 分段畫進同一張低高度 Canvas；因此不會建立巨大點陣，也不會把右半段漏掉。
 * 回傳值仍是字級 1 的幾何，新增、靜止、動畫與選中框可共用同一份結果。
 */
export const measureLongSymbolInk = (text: string, family: string): SymbolInk => {
  const key = `${family}|${text}`;
  const hit = fastInkCache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return fallbackInk(text);
  let out = fallbackInk(text);
  try {
    const px = 32;
    const probe = sharedMeasureContext();
    if (!probe) return out;
    probe.font = `400 ${px}px ${fontStack(family)}`;
    const runLayout = longSymbolPaintRuns(text, family);
    const advance = Math.max(px * .25, runLayout.total * px / REF);
    const padX = px * 1.5, padY = px;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(advance + padX * 2));
    canvas.height = px * 3;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (ctx) {
      ctx.font = `400 ${px}px ${fontStack(family)}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      let x = padX;
      for (let i = 0; i < runLayout.runs.length; i++) {
        const run = runLayout.runs[i];
        ctx.fillText(run, x, canvas.height / 2);
        x += runLayout.advances[i] * px / REF;
      }
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let l = canvas.width, r = -1, t = canvas.height, b = -1;
      for (let p = 0; p < canvas.width * canvas.height; p++) if (pixels[p * 4 + 3]) {
        const xx = p % canvas.width, yy = Math.floor(p / canvas.width);
        l = Math.min(l, xx); r = Math.max(r, xx); t = Math.min(t, yy); b = Math.max(b, yy);
      }
      if (r >= l) {
        const anchorX = padX + advance / 2, anchorY = canvas.height / 2;
        out = {
          w: (r - l + 1) / px, h: (b - t + 1) / px,
          cx: ((l + r + 1) / 2 - anchorX) / px,
          cy: ((t + b + 1) / 2 - anchorY) / px,
        };
      }
    }
    canvas.width = canvas.height = 0;
  } catch { /* 沿用穩定 fallback。 */ }
  fastInkCache.set(key, out);
  return out;
};

/**
 * 符號不是可編輯文字：把完整原生排版固定成一張高解析度「貼圖」。靜止、
 * 雙指縮放、文字物件增刪與選取框都只縮放這張圖，不再要求 Safari 在每個
 * 字級重新 shaping。回傳座標以 256px 的邏輯字級為單位，canvas 本身保留
 * 固定基準字級的邏輯單位，canvas 本身保留最高 3× 的實體像素；長符號會
 * 自動降低倍率以避開 iOS Canvas 寬度上限。
 */
export const rasterizeSymbolSticker = (
  text: string,
  family: string,
  mode: 'fill' | 'stroke' = 'fill',
  color = '#fff',
  logicalStrokeWidth = 0,
): SymbolStickerRaster | null => {
  if (typeof document === 'undefined' || !text) return null;
  const renderText = symbolTextPresentation(text);
  const px = symbolStickerFontPx(text);
  const stroke = Math.max(0, logicalStrokeWidth);
  const key = `${text}|${family}|${mode}|${color}|${stroke.toFixed(3)}`;
  const hit = stickerCache.get(key);
  if (hit) {
    /* LRU：多物件畫布不會因為總數稍多於上限，就每一幀從頭重建所有貼圖。 */
    stickerCache.delete(key); stickerCache.set(key, hit);
    return hit;
  }
  try {
    const probe = sharedMeasureContext();
    if (!probe) return null;
    probe.font = `400 ${px}px ${fontStack(family)}`;
    const iosCanvas = /iP(?:hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const longIOS = iosCanvas && isIOSProblemLongSymbol(text);
    const runs = longIOS ? longSymbolPaintRuns(renderText, family) : null;
    const advance = Math.max(px * .25,
      runs ? runs.total * px / REF : probe.measureText(renderText).width);
    const pad = Math.ceil(px * .72 + stroke * 2);
    const logicalW = Math.ceil(advance + pad * 2);
    const logicalH = Math.ceil(px * 2.45 + pad * 2);
    const oversample = Math.max(1, Math.min(symbolStickerOversample(text),
      16000 / Math.max(logicalW, logicalH)));
    const width = Math.max(1, Math.min(MAX_RASTER_SIDE, Math.ceil(logicalW * oversample)));
    const height = Math.max(1, Math.min(MAX_RASTER_SIDE, Math.ceil(logicalH * oversample)));
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    const ctx = source.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return null;
    ctx.setTransform(oversample, 0, 0, oversample, 0, 0);
    ctx.font = `400 ${px}px ${fontStack(family)}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color || '#fff'; ctx.strokeStyle = color || '#fff';
    ctx.lineWidth = stroke; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    const left = pad, middle = logicalH / 2;
    const paint = (value: string, x: number) => mode === 'stroke'
      ? ctx.strokeText(value, x, middle) : ctx.fillText(value, x, middle);
    if (runs) {
      let x = left;
      for (let i = 0; i < runs.runs.length; i++) {
        paint(runs.runs[i], x);
        x += runs.advances[i] * px / REF;
      }
    } else paint(renderText, left);
    const image = ctx.getImageData(0, 0, width, height);
    /* Apple Color Emoji 即使遇到 VS15，在少數只有彩色字身的碼位仍會忽略
       fillStyle。保留它的 alpha 輪廓，但把 RGB 強制染成使用者指定顏色。 */
    forceMonochrome(image.data, color || '#fff');
    ctx.putImageData(image, 0, 0);
    let l = width, r = -1, t = height, b = -1;
    for (let p = 0; p < width * height; p++) if (image.data[p * 4 + 3]) {
      const x = p % width, y = Math.floor(p / width);
      l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
    }
    if (r < l) { source.width = source.height = 0; return null; }
    const crop = document.createElement('canvas');
    crop.width = r - l + 1; crop.height = b - t + 1;
    crop.getContext('2d')?.drawImage(source, l, t, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const anchorX = (left + advance / 2) * oversample;
    const anchorY = middle * oversample;
    const inv = 1 / oversample;
    const out = {
      canvas: crop,
      fontPx: px,
      x: (l - anchorX) * inv, y: (t - anchorY) * inv,
      w: crop.width * inv, h: crop.height * inv,
      inkCenterX: ((l + r + 1) / 2 - anchorX) * inv,
      inkCenterY: ((t + b + 1) / 2 - anchorY) * inv,
    };
    source.width = source.height = 0;
    stickerCache.set(key, out);
    while (stickerCache.size > MAX_STICKER_CACHE) {
      const first = stickerCache.keys().next().value as string | undefined;
      if (!first) break;
      const old = stickerCache.get(first);
      if (old) old.canvas.width = old.canvas.height = 0;
      stickerCache.delete(first);
    }
    return out;
  } catch { return null; }
};

export const measureSymbolStickerInk = (text: string, family: string): SymbolInk => {
  const sticker = rasterizeSymbolSticker(text, family);
  if (!sticker) return isIOSProblemLongSymbol(text)
    ? measureLongSymbolInk(text, family) : measureSymbolInk(text, family);
  return {
    w: sticker.w / sticker.fontPx,
    h: sticker.h / sticker.fontPx,
    cx: sticker.inkCenterX / sticker.fontPx,
    cy: sticker.inkCenterY / sticker.fontPx,
  };
};

/**
 * 直接掃描字形 alpha。一般符號沿用已驗證的 3072 Canvas；超寬符號不能建立
 * 巨型 Canvas（真機 Safari 會因記憶體壓力黑屏），也不能橫向切片（anchor
 * 落在片外時 WebKit 會漏畫）。超寬時直接使用同一個 native shaping 回傳的
 * actualBoundingBox*，它涵蓋整串左右端且完全不配置像素緩衝區。
 */
const scanInk = (text: string, family: string, requestedSize: number): SymbolInk | null => {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return null;

    const scanSize = Math.max(8, requestedSize);
    ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
    const advance = Math.max(scanSize, ctx.measureText(text).width);
    const desiredWidth = advance + scanSize * 8;
    /* 一般符號完全沿用原本已驗證的單張 Canvas 路徑。上一版把所有符號都
       切片量測，連本來正常的短符號中心也受到 WebKit tile 取整影響。只有
       真正超過安全邊長的長符號才走下面的分片路徑。 */
    const iosCanvas = /iP(?:hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const overlyLongFallbackRun = iosCanvas && isIOSProblemLongSymbol(text);
    if (desiredWidth <= MAX_SCAN_SIDE && !overlyLongFallbackRun) {
      const padX = Math.min(scanSize * 4, Math.max(2, (MAX_SCAN_SIDE - advance) / 2));
      const padY = Math.min(scanSize * 4, MAX_SCAN_SIDE / 2);
      canvas.width = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(advance + padX * 2)));
      canvas.height = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(Math.max(scanSize * 2, padY * 2))));
      ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      const ax = canvas.width / 2, ay = canvas.height / 2;
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
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          if (data[(y * canvas.width + x) * 4 + 3] > 0) {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y);
            x1 = Math.max(x1, x); y1 = Math.max(y1, y);
          }
        }
        if (x1 >= x0 && y1 >= y0) {
          left = x0 - ax; right = x1 + 1 - ax;
          top = y0 - ay; bottom = y1 + 1 - ay;
        }
      } catch { /* iOS 拒絕讀取時沿用真正墨水 TextMetrics。 */ }
      canvas.width = canvas.height = 0;
      return {
        w: Math.max(.01, right - left) / scanSize,
        h: Math.max(.01, bottom - top) / scanSize,
        cx: (left + right) / 2 / scanSize,
        cy: (top + bottom) / 2 / scanSize,
      };
    }
    if (overlyLongFallbackRun) {
      /* Mobile Safari 對超長 fallback 字串的 actualBoundingBoxLeft/Right 只會
         回報其中一段，這正是長符號只被框住左／右半邊的根因。advance 則是
         完整 shaping 後的總寬；長字串專用分支以它為對稱水平邊界，既不配置
         巨型 Canvas，也不會讓錯誤的墨水中心把靜止或動畫內容推向一側。 */
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const metrics = ctx.measureText(text);
      const metricLeft = Number(metrics.actualBoundingBoxLeft) || 0;
      const metricRight = Number(metrics.actualBoundingBoxRight) || 0;
      const metricTop = Number(metrics.actualBoundingBoxAscent) || 0;
      const metricBottom = Number(metrics.actualBoundingBoxDescent) || 0;
      const left = -advance / 2;
      const right = advance / 2;
      const top = metricTop > 0 ? -metricTop : -scanSize * .75;
      const bottom = metricBottom > 0 ? metricBottom : scanSize * .45;
      canvas.width = canvas.height = 0;
      return {
        w: Math.max(.01, right - left) / scanSize,
        h: Math.max(.01, bottom - top) / scanSize,
        cx: (left + right) / 2 / scanSize,
        cy: (top + bottom) / 2 / scanSize,
      };
    }

    /* 非白名單符號完全回到原本的分片量測，不能因字串較寬就套用新中心。 */
    const padX = scanSize * 4;
    const totalWidth = Math.max(1, Math.ceil(advance + padX * 2));
    const scanHeight = Math.max(1, Math.min(MAX_SCAN_SIDE, Math.ceil(scanSize * 6)));
    const anchorX = totalWidth / 2, anchorY = scanHeight / 2;
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
    const tileSide = Math.min(1536, MAX_SCAN_SIDE);
    let x0 = totalWidth, y0 = scanHeight, x1 = -1, y1 = -1;
    let scannedInk = false;
    try {
      for (let tileX = 0; tileX < totalWidth; tileX += tileSide) {
        const tileWidth = Math.min(tileSide, totalWidth - tileX);
        canvas.width = tileWidth; canvas.height = scanHeight;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, tileWidth, scanHeight);
        ctx.font = `400 ${scanSize}px ${fontStack(family)}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        ctx.fillText(text, anchorX - tileX, anchorY);
        const data = ctx.getImageData(0, 0, tileWidth, scanHeight).data;
        for (let p = 0; p < tileWidth * scanHeight; p++) if (data[p * 4 + 3] > 0) {
          const x = p % tileWidth, y = Math.floor(p / tileWidth);
          x0 = Math.min(x0, tileX + x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, tileX + x); y1 = Math.max(y1, y); scannedInk = true;
        }
      }
      if (scannedInk) {
        left = x0 - anchorX; right = x1 + 1 - anchorX;
        top = y0 - anchorY; bottom = y1 + 1 - anchorY;
      }
    } catch { /* 沿用 TextMetrics 備援。 */ }
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
    const ctx = sharedMeasureContext();
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
    /* 中點下方的組合記號在視覺上屬於同一顆裝飾；若拆成三層各自縮放，
       第四排第二個符號會在泡泡／縮放 II 中散開。只收這個已確認結構，
       `*ੈ` 等產品指定要分開播放的組合完全不受影響。 */
    const middleDotMark = raw.length > 0 && /\p{Mark}/u.test(ch)
      && raw[raw.length - 1].startsWith('\u00b7');
    if (raw.length && (variation || joiner || continuesJoiner || middleDotMark)) raw[raw.length - 1] += ch;
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

/** 長符號靜止、量框與動畫共同使用的分段與寬度；固定在 100px 量一次。 */
export const longSymbolPaintRuns = (text: string, family: string) => {
  const key = `${family}|${text}`;
  const hit = longRunCache.get(key);
  if (hit) return hit;
  const clusters = splitSymbolClusters(text);
  const runs: string[] = [];
  for (let i = 0; i < clusters.length; i += 8) runs.push(clusters.slice(i, i + 8).join(''));
  const advances = runs.map(run => measureSymbolAdvance(run, family, REF));
  const out = { runs, advances, total: advances.reduce((sum, value) => sum + value, 0) };
  longRunCache.set(key, out);
  return out;
};

export const countSymbolAnimationBeats = (text: string) =>
  text ? splitSymbolTimingUnits(text).length : 0;

export type SymbolRasterLayer = {
  canvas: HTMLCanvasElement;
  x: number; y: number;
  pivotX: number; pivotY: number;
  w: number; h: number;
};

export type SymbolRasterLayers = {
  layers: SymbolRasterLayer[];
  fullCanvas: HTMLCanvasElement;
  fullSX: number;
  fullSY: number;
  fullSW: number;
  fullSH: number;
  fullX: number;
  fullY: number;
  fullW: number;
  fullH: number;
  beatCount: number;
  /** 完整離屏字串的實際墨水中心，相對於文字 advance 中心。 */
  inkCenterX: number;
  inkCenterY: number;
  inkWidth: number;
  inkHeight: number;
};
const rasterLayerCache = new Map<string, SymbolRasterLayers>();
const MAX_RASTER_LAYER_CACHE = 64;
/* 最長的裝飾符號在 iPhone Retina 仍要以原生物理解析度分層；8192 會把
   少數長字串左右同時裁掉。這些 raster 高度很小，16384×約 200 的實際
   面積仍遠低於一般照片 Canvas，不能因單邊上限誤判成大型畫布。 */
const MAX_RASTER_SIDE = 16384;

/**
 * 從同一份完整原生字串 raster 中分出動畫層。不能把 unit 各自 fillText：
 * combining mark 與 fallback 字體會重新排字，造成動畫時字距和位置改變。
 * 這裡用逐步 prefix 的 alpha 增量辨認每個成品像素屬於哪個小單位；倍率 1
 * 時所有層的聯集就是原生完整字串，動畫只改各層自己的 transform。
 */
export const rasterizeSymbolAnimationLayers = (
  text: string,
  family: string,
  logicalFontPx: number,
  mode: 'fill' | 'stroke',
  color: string,
  logicalStrokeWidth = 0,
  outputScale = 1,
): SymbolRasterLayers | null => {
  if (typeof document === 'undefined' || !text) return null;
  const renderText = symbolTextPresentation(text);
  const units = splitSymbolTimingUnits(renderText);
  if (!units.length) return null;
  const px = Math.max(8, logicalFontPx);
  /* 縮放 II 會持續改變每個小單位的目的尺寸；3× 貼圖在放大的 Retina
     預覽仍可能被往上採樣，邊緣 alpha 便會逐幀游動。短符號允許到 6×，
     實際尺寸仍會被下方 16000px 單邊限制夾住，長符號不會無限配置。 */
  const wantedScale = Math.max(1, Math.min(6, outputScale));
  const key = `${text}|${family}|${px.toFixed(3)}|${mode}|${color}|${logicalStrokeWidth.toFixed(3)}|${wantedScale.toFixed(3)}`;
  const hit = rasterLayerCache.get(key);
  if (hit) return hit;
  try {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return null;
    probe.font = `400 ${px}px ${fontStack(family)}`;
    const iosCanvas = /iP(?:hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const longIOS = iosCanvas && isIOSProblemLongSymbol(text);
    const fullRuns = longIOS ? longSymbolPaintRuns(renderText, family) : null;
    const logicalAdvance = Math.max(px * .25,
      fullRuns ? fullRuns.total * px / REF : probe.measureText(renderText).width);
    const strokePx = Math.max(0, logicalStrokeWidth);
    /* 動畫只需要貼圖真正有墨水的區域。舊版用 6.7em 高、完整 advance 寬的
       巨型 Canvas 跑每個 prefix；固定高解析度後長符號會浪費數十 MB，甚至
       被 iOS 清掉。以同一張貼圖的真實邊界建立緊實工作區，再留安全邊界。 */
    const stickerInk = measureSymbolStickerInk(text, family);
    const inkW = Math.max(px * .05, stickerInk.w * px);
    const inkH = Math.max(px * .05, stickerInk.h * px);
    const inkLeft = stickerInk.cx * px - inkW / 2;
    const inkTop = stickerInk.cy * px - inkH / 2;
    const margin = Math.ceil(Math.max(6, strokePx * 2 + 5));
    const logicalWidth = Math.ceil(inkW + margin * 2);
    const logicalHeight = Math.ceil(inkH + margin * 2);
    /* 按目的 Canvas 的實際 transform 建立一樣多的實體像素；drawImage 時除回
       同一倍率，因此不是把低解析度圖放大，也不是額外超取樣後再縮小。 */
    const oversample = Math.max(1, Math.min(wantedScale,
      16000 / Math.max(logicalWidth, logicalHeight)));
    /* Retina 解析度只能放大 backing store／transform，不能直接把 font-size
       乘上 DPR。後者會讓 WebKit 重新做 fallback、hinting 與 combining-mark
       shaping，長符號的字距和小單位位置就會跟正式畫面不同。 */
    const width = Math.max(1, Math.min(MAX_RASTER_SIDE, Math.ceil(logicalWidth * oversample)));
    const height = Math.max(1, Math.min(MAX_RASTER_SIDE, Math.ceil(logicalHeight * oversample)));
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    const g = source.getContext('2d', { willReadFrequently: true } as any);
    if (!g) return null;
    const anchorX = (margin - inkLeft) * oversample;
    const anchorY = (margin - inkTop) * oversample;
    const textLeft = anchorX / oversample - logicalAdvance / 2;
    const setup = () => {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, width, height);
      g.setTransform(oversample, 0, 0, oversample, 0, 0);
      g.font = `400 ${px}px ${fontStack(family)}`;
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = color || '#fff'; g.strokeStyle = color || '#fff';
      g.lineWidth = strokePx; g.lineJoin = 'round'; g.miterLimit = 2;
    };
    const paintRun = (value: string, x: number) => mode === 'stroke'
      ? g.strokeText(value, x, anchorY / oversample)
      : g.fillText(value, x, anchorY / oversample);
    const paint = (value: string) => {
      if (!longIOS) { paintRun(value, textLeft); return; }
      /* Mobile Safari 會在一次 fillText 含太多 fallback glyph 時從字串中段
         才開始畫。每 8 個完整 grapheme 作一段，位置用同一字型的 prefix
         advance 累加；combining mark 不會被拆開，也不影響正常短符號。 */
      let x = textLeft;
      const valueRuns = longSymbolPaintRuns(value, family);
      for (let i = 0; i < valueRuns.runs.length; i++) {
        const run = valueRuns.runs[i];
        paintRun(run, x);
        x += valueRuns.advances[i] * px / REF;
      }
    };
    setup(); paint(renderText);
    const final = g.getImageData(0, 0, width, height);
    forceMonochrome(final.data, color || '#fff');
    const pixelCount = width * height;
    const owner = new Uint16Array(pixelCount); owner.fill(65535);
    let previous = new Uint8Array(pixelCount);
    const centres = new Array<number>(units.length).fill(anchorX);
    const fd = final.data;
    if (longIOS) {
      /* 長貼圖不能為八十多個單元各重畫／讀回一張數百萬像素 Canvas；那會
         讓手機進動畫頁停住。完整貼圖只讀一次，再在每個原生 prefix 邊界
         附近尋找墨水最少的直欄，所有片段拼回 1 倍時仍是同一張貼圖。 */
      const boundaries: number[] = [];
      let prefix = '';
      for (let i = 0; i < units.length - 1; i++) {
        prefix += units[i];
        const prefixAdvance = longSymbolPaintRuns(prefix, family).total * px / REF;
        const nominal = Math.round((textLeft + prefixAdvance) * oversample);
        const radius = Math.max(2, Math.round(px * oversample * .18));
        let best = Math.max(0, Math.min(width - 1, nominal)), bestInk = Infinity;
        for (let x = Math.max(0, nominal - radius); x <= Math.min(width - 1, nominal + radius); x++) {
          let ink = 0;
          for (let y = 0; y < height; y++) if (fd[(y * width + x) * 4 + 3] > 8) ink++;
          if (ink < bestInk || (ink === bestInk && Math.abs(x - nominal) < Math.abs(best - nominal))) {
            best = x; bestInk = ink;
          }
        }
        boundaries.push(best);
      }
      for (let i = 1; i < boundaries.length; i++) boundaries[i] = Math.max(boundaries[i], boundaries[i - 1] + 1);
      const sums = units.map(() => ({ x: 0, mass: 0 }));
      for (let p = 0; p < pixelCount; p++) {
        const a = fd[p * 4 + 3]; if (!a) continue;
        const x = p % width;
        let lo = 0, hi = boundaries.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (x >= boundaries[mid]) lo = mid + 1; else hi = mid;
        }
        const ui = lo;
        owner[p] = Math.min(units.length - 1, ui);
        sums[ui].x += x * a; sums[ui].mass += a;
      }
      for (let i = 0; i < units.length; i++) centres[i] = sums[i].mass
        ? sums[i].x / sums[i].mass
        : (i ? boundaries[Math.min(i - 1, boundaries.length - 1)] : anchorX);
    } else {
      let prefix = '';
      for (let ui = 0; ui < units.length; ui++) {
        prefix += units[ui]; setup(); paint(prefix);
        const rgba = g.getImageData(0, 0, width, height).data;
        const current = new Uint8Array(pixelCount);
        let sumX = 0, mass = 0;
        for (let p = 0; p < pixelCount; p++) {
          const a = rgba[p * 4 + 3]; current[p] = a;
          const delta = Math.max(0, a - previous[p]);
          /* 像素一旦由某個 prefix 首次畫出，就固定屬於該單元。不能讓後面的
             combining mark 以較大的 alpha 增量把前一顆符號的交疊像素搶走；
             否則兩顆倍率不同時，前一顆會像被切掉幾刀。 */
          if (delta && owner[p] === 65535) owner[p] = ui;
          if (delta) { sumX += (p % width) * delta; mass += delta; }
        }
        centres[ui] = mass ? sumX / mass : (textLeft + probe.measureText(prefix).width) * oversample;
        previous = current;
      }
    /* prefix 比對在「兩個字形真的碰在一起」的位置可能把同一條筆畫切成
       不同 owner。下面以連通的成品墨水辨認這種交疊，只修補不會吃掉
       後一單元本體的區塊；彼此獨立的點、弧線與裝飾仍各自保留。 */
    for (let p = 0; p < pixelCount; p++) {
      if (!fd[p * 4 + 3] || owner[p] !== 65535) continue;
      const xx = p % width;
      let nearest = Infinity, nearestUnit = 0;
      for (let i = 0; i < centres.length; i++) {
        const d = Math.abs(xx - centres[i]);
        if (d < nearest) { nearest = d; nearestUnit = i; }
      }
      owner[p] = nearestUnit;
    }
    const visited = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    const masses = new Float64Array(units.length);
    const totalMasses = new Float64Array(units.length);
    for (let p = 0; p < pixelCount; p++) {
      const a = fd[p * 4 + 3];
      if (a) totalMasses[owner[p]] += a;
    }
    for (let start = 0; start < pixelCount; start++) {
      if (visited[start] || !fd[start * 4 + 3]) continue;
      masses.fill(0);
      let head = 0, tail = 0;
      queue[tail++] = start; visited[start] = 1;
      while (head < tail) {
        const p = queue[head++], a = fd[p * 4 + 3];
        masses[owner[p]] += a;
        const x = p % width;
        let n: number;
        if (x > 0) { n = p - 1; if (!visited[n] && fd[n * 4 + 3]) { visited[n] = 1; queue[tail++] = n; } }
        if (x + 1 < width) { n = p + 1; if (!visited[n] && fd[n * 4 + 3]) { visited[n] = 1; queue[tail++] = n; } }
        if (p >= width) { n = p - width; if (!visited[n] && fd[n * 4 + 3]) { visited[n] = 1; queue[tail++] = n; } }
        if (p + width < pixelCount) { n = p + width; if (!visited[n] && fd[n * 4 + 3]) { visited[n] = 1; queue[tail++] = n; } }
        if (x > 0 && p >= width) { n = p - width - 1; if (!visited[n] && fd[n * 4 + 3]) { visited[n] = 1; queue[tail++] = n; } }
        if (x + 1 < width && p >= width) { n = p - width + 1; if (!visited[n] && fd[n * 4 + 3]) { visited[n] = 1; queue[tail++] = n; } }
        if (x > 0 && p + width < pixelCount) { n = p + width - 1; if (!visited[n] && fd[n * 4 + 3]) { visited[n] = 1; queue[tail++] = n; } }
        if (x + 1 < width && p + width < pixelCount) { n = p + width + 1; if (!visited[n] && fd[n * 4 + 3]) { visited[n] = 1; queue[tail++] = n; } }
      }
      /* 若後置附加記號碰到前一顆，而且它在別處仍保有自己的主要筆畫，
         這塊交疊筆畫就完整留給較早的基底字形。反之若後一單元全部都在
         這個連通區內，不能整塊吞掉，否則會製造空動畫層與節奏停頓。 */
      let earliest = 0;
      while (earliest + 1 < masses.length && masses[earliest] === 0) earliest++;
      let mayRepair = false, wouldEraseUnit = false;
      for (let i = earliest + 1; i < masses.length; i++) {
        if (!masses[i]) continue;
        mayRepair = true;
        const remaining = totalMasses[i] - masses[i];
        if (remaining < Math.max(255, totalMasses[i] * .18)) wouldEraseUnit = true;
      }
      if (mayRepair && !wouldEraseUnit) {
        for (let i = 0; i < tail; i++) owner[queue[i]] = earliest;
      }
    }
    }
    const bounds = units.map(() => ({ l: width, r: -1, t: height, b: -1, sx: 0, sy: 0, mass: 0 }));
    let fullL = width, fullR = -1, fullT = height, fullB = -1;
    for (let p = 0; p < pixelCount; p++) {
      const a = fd[p * 4 + 3]; if (!a) continue;
      const xx = p % width, yy = Math.floor(p / width);
      fullL = Math.min(fullL, xx); fullR = Math.max(fullR, xx);
      fullT = Math.min(fullT, yy); fullB = Math.max(fullB, yy);
      const ui = owner[p];
      const b = bounds[ui];
      b.l = Math.min(b.l, xx); b.r = Math.max(b.r, xx);
      b.t = Math.min(b.t, yy); b.b = Math.max(b.b, yy);
      b.sx += xx * a; b.sy += yy * a; b.mass += a;
    }
    if (fullR < fullL) return null;
    /* 所有裁片都保留原生 fillText 的同一個 baseline anchor，不能改用掃描後
       的像素外框中心；後者每個字級會有半像素 hinting 差，切換動畫就會跳。 */
    const fullCx = anchorX, fullCy = anchorY;
    const inv = 1 / oversample;
    const layers = bounds.map((b, ui): SymbolRasterLayer => {
      if (b.r < b.l) {
        const empty = document.createElement('canvas'); empty.width = empty.height = 1;
        return { canvas: empty, x: 0, y: 0, pivotX: 0, pivotY: 0, w: inv, h: inv };
      }
      const l = Math.max(0, b.l - 2), r = Math.min(width - 1, b.r + 2);
      const t = Math.max(0, b.t - 2), bb = Math.min(height - 1, b.b + 2);
      const cw = r - l + 1, ch = bb - t + 1;
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const cg = cv.getContext('2d');
      if (cg) {
        const image = cg.createImageData(cw, ch);
        for (let yy = t; yy <= bb; yy++) for (let xx = l; xx <= r; xx++) {
          const srcP = yy * width + xx;
          if (owner[srcP] !== ui) continue;
          const si = srcP * 4, di = ((yy - t) * cw + xx - l) * 4;
          image.data[di] = fd[si]; image.data[di + 1] = fd[si + 1];
          image.data[di + 2] = fd[si + 2]; image.data[di + 3] = fd[si + 3];
        }
        cg.putImageData(image, 0, 0);
      }
      return {
        canvas: cv, x: (l - fullCx) * inv, y: (t - fullCy) * inv,
        pivotX: ((b.mass ? b.sx / b.mass : centres[ui]) - fullCx) * inv,
        pivotY: ((b.mass ? b.sy / b.mass : fullCy) - fullCy) * inv,
        w: cw * inv, h: ch * inv,
      };
    });
    const out = {
      layers,
      fullCanvas: source,
      fullSX: fullL,
      fullSY: fullT,
      fullSW: fullR - fullL + 1,
      fullSH: fullB - fullT + 1,
      fullX: (fullL - anchorX) * inv,
      fullY: (fullT - anchorY) * inv,
      fullW: (fullR - fullL + 1) * inv,
      fullH: (fullB - fullT + 1) * inv,
      beatCount: units.length,
      inkCenterX: ((fullL + fullR + 1) / 2 - anchorX) * inv,
      inkCenterY: ((fullT + fullB + 1) / 2 - anchorY) * inv,
      inkWidth: (fullR - fullL + 1) * inv,
      inkHeight: (fullB - fullT + 1) * inv,
    };
    rasterLayerCache.set(key, out);
    while (rasterLayerCache.size > MAX_RASTER_LAYER_CACHE) {
      const first = rasterLayerCache.keys().next().value as string | undefined;
      if (!first) break;
      const evicted = rasterLayerCache.get(first);
      evicted?.layers.forEach(layer => { layer.canvas.width = layer.canvas.height = 0; });
      if (evicted) evicted.fullCanvas.width = evicted.fullCanvas.height = 0;
      rasterLayerCache.delete(first);
    }
    return out;
  } catch { return null; }
};

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
  /* 泡泡／縮放 II 的產品單位是畫面上每一個小符號，不是 Unicode 的
     grapheme cluster。像 `*ੈ` 雖然會被 Intl.Segmenter 視為一顆字素，肉眼
     卻明確是星號與弧線兩個單位；若在這裡為了 native shaping 把它們合併，
     動畫就只剩整組同步。變體選擇符與 ZWJ 仍由 timing splitter 留在前一顆，
     所以真正不可拆的 emoji 不會被拆壞。 */
  const timingUnits = splitSymbolTimingUnits(text);
  let result = timingUnits;
  /* iOS / WebKit 能原樣分開繪製目前清單中的全部 168 組符號。少數缺少
     對應字形的桌面瀏覽器會把單獨的 combining mark 畫成方框或虛線圓；
     只有確認分段後已經不是同一個外觀時才退回安全 grapheme，避免動畫時
     符號突然換形。這個保護不會在 iPhone 上合併任何單位。 */
  const iosWebKit = typeof navigator !== 'undefined'
    && /Safari\//.test(navigator.userAgent)
    && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
  if (!iosWebKit && !compositionKeepsNativeShape(text, timingUnits, family, size)) {
    const raw = splitSymbolClusters(text);
    const safe: string[] = [];
    for (const cluster of raw) {
      if (safe.length && !pairKeepsNativeShape(safe[safe.length - 1], cluster, family, size)) {
        safe[safe.length - 1] += cluster;
      } else safe.push(cluster);
    }
    result = safe.length ? safe : [text];
  }
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
  /* 動畫節拍就是實際繪圖單位，兩者不可再用不同陣列。 */
  const originalClusters = splitSymbolUnits(text, family, size);
  const advance = measureSymbolAdvance(text, family, size);
  const ink = isIOSProblemLongSymbol(text)
    ? measureLongSymbolInk(text, family)
    : measureSymbolInkAtSize(text, family, size);
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
 * 縮放 II 的單位倍率。最多使用三條節奏時間線，相鄰單元永遠不會落在
 * 同一條；超過三顆時以 1→2→3 循環，避免看起來被群組，又不會產生
 * 幾十種互相打架的頻率。接手第一幀仍精確從 1 開始。
 */
export const symbolBreatheScale = (
  index: number,
  time: number,
  amp: number,
  speed: number,
) => {
  const t = Math.max(0, time);
  const timeline = ((index % 3) + 3) % 3;
  /* 三條時間線改用同一條連續呼吸曲線，只錯開起跑時間。舊版同時用了
     不同頻率與 120° 相位，手機掉一幀時相鄰單位會往相反方向跨過較大的
     距離，看起來像每顆都在抖。現在每條線都由 1 倍、零速度平順起步，
     仍維持相鄰單位不同步，但不再產生拍頻或第一幀抽動。 */
  const angularRate = 1.5 * Math.max(.05, speed);
  /* 只錯開 140ms，而不是錯開三分之一週期。這能讓三組很快都開始呼吸，
     同時避免慢速設定下第三組等兩秒以上才動、看起來像動畫壞掉。 */
  const localT = t - timeline * .14;
  if (localT <= 0) return 1;
  const attackP = Math.min(1, localT / .28);
  const attack = attackP * attackP * attackP * (attackP * (attackP * 6 - 15) + 10);
  const wave = Math.sin(localT * angularRate);
  return 1 + wave * Math.max(0, amp) / 100 * .18 * attack;
};

/** 完整包住墨水並在四邊保留一致安全距離。 */
export const symbolBox = (text: string, family: string, size: number, gap = 4) => {
  const ink = isIOSProblemLongSymbol(text)
    ? measureLongSymbolInk(text, family)
    : measureSymbolInkAtSize(text, family, size);
  return { w: Math.max(6, ink.w * size + gap * 2), h: Math.max(6, ink.h * size + gap * 2) };
};
