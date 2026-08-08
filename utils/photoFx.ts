/**
 * 經典拼圖裡的照片調整。
 *
 * 直接沿用「編輯」那一套像素管線（processPixels ＋ 同一批 LUT 濾鏡），
 * 兩邊調同一個數值就會得到同一個結果，不會有兩套色彩邏輯。
 * 這裡只取需要的部分：調節（不含曲線）＋濾鏡＋柔光＋模糊。
 */
import {
  processPixels,
  generateBaseCorrectionLut,
  generateCurveLut,
  fastBlur,
  hslToRgb,
  generateNoisePattern,
  DEFAULT_PARAMS,
  type EditorParams,
} from '../components/ImageEditor';
import { applyGlEffects, hasActiveFx } from './glEffects';
import { bakeColorLut, bakedToTexture } from './lutBake';
import { LutGpu } from './lutGpu';
import { loadCachedLut, saveCachedLut } from './lutStore';

/* 拼圖這邊共用一個 GPU 實例。undefined＝還沒試過，null＝這台裝置沒有 WebGL2。 */
let gpuInst: LutGpu | null | undefined;
const getGpu = (): LutGpu | null => {
  if (gpuInst === undefined) {
    try { gpuInst = LutGpu.create(); } catch { gpuInst = null; }
  }
  return gpuInst && !gpuInst.lost ? gpuInst : null;
};

/**
 * 用 GPU 把顏色鏈畫到 ctx 上。成功回 true，失敗回 false 讓呼叫端走 CPU。
 * 濾鏡強度用畫布的 globalAlpha 疊 —— 跟 CPU 版的線性混合是同一件事。
 */
const gpuColorChain = (
  ctx: CanvasRenderingContext2D, src: Uint8ClampedArray, w: number, h: number,
  p: EditorParams, lut: { data: Uint8ClampedArray; size: number } | null,
  amount: number, baseLut: Uint8Array,
): boolean => {
  const g = getGpu();
  if (!g || !g.fits(w, h)) return false;
  try {
    if (!g.setSource(src, w, h)) return false;
    const paint = (film: Uint8ClampedArray | null, filmSize: number): HTMLCanvasElement | null => {
      const baked = bakeColorLut(
        (a, d, ww, hh) => processPixels(a, d, ww, hh, p, film, filmSize, baseLut, null, false, IDENTITY_CURVE_LUTS),
        65,
      );
      if (!g.setLut(bakedToTexture(baked), 65)) return null;
      const drawn = g.draw();
      if (!drawn) return null;
      // GPU 的畫布會被下一次 draw 蓋掉，所以先拓到自己的畫布上
      const keep = document.createElement('canvas');
      keep.width = w; keep.height = h;
      keep.getContext('2d')!.drawImage(drawn, 0, 0);
      return keep;
    };
    const needBlend = !!lut && amount < 1;
    const plain = needBlend ? paint(null, 0) : null;
    if (needBlend && !plain) return false;
    const top = paint(lut ? lut.data : null, lut ? lut.size : 0);
    if (!top) return false;
    ctx.clearRect(0, 0, w, h);
    if (plain) ctx.drawImage(plain, 0, 0);
    ctx.save();
    if (plain) ctx.globalAlpha = amount;
    ctx.drawImage(top, 0, 0);
    ctx.restore();
    return true;
  } catch {
    return false;
  }
};

/** 圖層上存的參數，全部都是可選的，沒動過就不存 */
export interface PhotoFx {
  /** 濾鏡（LUT）id，'none' 或未設定＝原始 */
  lut?: string;
  /** 濾鏡強度 0~100，預設 100 */
  lutAmount?: number;
  brightness?: number;
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  temp?: number;
  tint?: number;
  sat?: number;
  vib?: number;
  /** 柔光 0~100 */
  soft?: number;
  /** 柔光只作用在比這個亮度更亮的地方 0~95，預設 70 */
  softThreshold?: number;
  /** 柔光擴散 20~100，預設 100 */
  softRadius?: number;
  /** 柔光色相 0~100，0 = 不染色 */
  softColor?: number;
  /** 模糊 0~100 */
  blur?: number;
  /** 光暈強度 0~100 */
  fringeIntensity?: number;
  /** 光暈擴散 0~100，預設 10 */
  fringeSize?: number;
  /** 光暈範圍 0~100，預設 100 */
  fringeFeather?: number;
  /** 光暈色相 0~360，預設 8 */
  fringeHue?: number;
  /** 漏光強度 0~100 */
  leakOpacity?: number;
  /** 漏光角度 0~360，預設 45 */
  leakAngle?: number;
  /** 漏光色相 0~360，預設 15 */
  leakHue?: number;
  /** 噪點 0~100 */
  colorNoise?: number;
  /** 暗角 0~200 */
  vignette?: number;
  /* GLSL 特效（動態模糊、色散、螢幕……）的強度與細項參數。
     鍵名跟 utils/glEffects.ts 的 FX_DEFS 完全一致，沒帶到的參數在著色器那邊
     自己會退回預設值，所以這裡照樣是「沒動過就不存」。 */
  [k: `fx${string}`]: number | undefined;
}

export const ADJUST_KEYS = [
  ['brightness', '亮度'],
  ['exposure', '曝光'],
  ['contrast', '對比'],
  ['highlights', '高光'],
  ['shadows', '陰影'],
  ['temp', '色溫'],
  ['tint', '色調'],
  ['sat', '飽和度'],
  ['vib', '自然飽和度'],
] as const;

/** 有沒有動過任何一項；沒動過就完全不用跑管線 */
export const hasPhotoFx = (fx?: PhotoFx) => {
  if (!fx) return false;
  if (fx.lut && fx.lut !== 'none') return true;
  if (fx.soft || fx.blur || fx.colorNoise || fx.vignette || fx.leakOpacity || fx.fringeIntensity) return true;
  if (hasActiveFx(fx)) return true;
  return ADJUST_KEYS.some(([k]) => !!fx[k]);
};

/* ── LUT 載入 ───────────────────────────────────────────────────────
   跟編輯那邊同一種格式：8×8 排列的方塊圖，解出來是 size³ 的查色表。 */
type LutData = { data: Uint8ClampedArray; size: number };
const lutCache = new Map<string, LutData>();
const lutPending = new Map<string, Promise<LutData | null>>();

export function getLoadedLut(id?: string): LutData | null {
  if (!id || id === 'none') return null;
  return lutCache.get(id) || null;
}

export function loadLut(id: string, url: string): Promise<LutData | null> {
  if (!url || id === 'none') return Promise.resolve(null);
  const hit = lutCache.get(id);
  if (hit) return Promise.resolve(hit);
  const pending = lutPending.get(id);
  if (pending) return pending;

  const task = (async (): Promise<LutData | null> => {
    // 先問本機：以前解過的表直接讀回來，不用下載也不用重新解碼
    const cached = await loadCachedLut(id, url);
    if (cached) { lutCache.set(id, cached); return cached; }
    return new Promise<LutData | null>(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = img.width === img.height ? img.width / 8 : 64;
        const size2 = size * size;
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, img.width, img.height).data;
        const data = new Uint8ClampedArray(size * size * size * 3);
        for (let b = 0; b < size; b++) {
          for (let g = 0; g < size; g++) {
            for (let r = 0; r < size; r++) {
              const blockX = (b % 8) * size;
              const blockY = ((b / 8) | 0) * size;
              const pxIdx = ((blockY + g) * img.width + (blockX + r)) * 4;
              const lutIdx = (b * size2 + g * size + r) * 3;
              data[lutIdx] = px[pxIdx];
              data[lutIdx + 1] = px[pxIdx + 1];
              data[lutIdx + 2] = px[pxIdx + 2];
            }
          }
        }
        const out = { data, size };
        lutCache.set(id, out);
        saveCachedLut(id, url, data, size);
        resolve(out);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
    });
  })();
  lutPending.set(id, task);
  return task;
}

/* ── 套用 ──────────────────────────────────────────────────────────── */

const IDENTITY_CURVE_LUTS = {
  rgb: generateCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }] as any),
  r: generateCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }] as any),
  g: generateCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }] as any),
  b: generateCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }] as any),
};

const toParams = (fx: PhotoFx): EditorParams => ({
  ...DEFAULT_PARAMS,
  brightness: fx.brightness || 0,
  exposure: fx.exposure || 0,
  contrast: fx.contrast || 0,
  highlights: fx.highlights || 0,
  shadows: fx.shadows || 0,
  temp: fx.temp || 0,
  tint: fx.tint || 0,
  sat: fx.sat || 0,
  vib: fx.vib || 0,
  lutAmount: fx.lutAmount ?? 100,
});

/**
 * 把調整套到來源圖上，回傳一張畫好的 canvas。
 * w / h 是要輸出的像素大小（呼叫端自己決定預覽用小張、匯出用大張）。
 */
export function applyPhotoFx(
  source: CanvasImageSource,
  w: number,
  h: number,
  fx: PhotoFx,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  if (!hasPhotoFx(fx)) return out;

  const p = toParams(fx);
  const lut = getLoadedLut(fx.lut);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const src = new Uint8ClampedArray(img.data);
  const dest = img.data;

  const baseLut = new Uint8Array(256);
  generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, baseLut);
  const amount = (fx.lutAmount ?? 100) / 100;

  /* ── 先試 GPU ─────────────────────────────────────────────────────
     跟編輯功能同一套：整條顏色鏈是純粹的 RGB→RGB，先用**現有的 processPixels
     本身**在 65³ 個格點上算一次烤成查色表，再讓 GPU 一個 draw call 查完整張圖。
     顏色公式一行都沒重寫，兩邊仍然是同一套色彩邏輯。

     這裡完全不需要把像素讀回來 —— 後面的噪點、模糊、柔光全部是在畫布上合成的，
     沒有人要 dest 那份陣列。所以拼圖這條路比編輯還乾淨。

     失敗（沒 WebGL2、上下文被收走、圖超過貼圖上限）就原封不動走下面的 CPU。 */
  if (gpuColorChain(ctx, src, out.width, out.height, p, lut, amount, baseLut)) {
    // GPU 已經把顏色畫上去了，下面的 CPU 路徑整段跳過
  } else {
  processPixels(
    src, dest, out.width, out.height, p,
    lut ? lut.data : null, lut ? lut.size : 0,
    baseLut, null, false, IDENTITY_CURVE_LUTS,
  );

  // 濾鏡強度：跟原本沒上濾鏡的結果混合
  if (lut && amount < 1) {
    const plain = new Uint8ClampedArray(src.length);
    processPixels(
      src, plain, out.width, out.height, p,
      null, 0, baseLut, null, false, IDENTITY_CURVE_LUTS,
    );
    const inv = 1 - amount;
    for (let i = 0; i < dest.length; i += 4) {
      dest[i] = plain[i] * inv + dest[i] * amount;
      dest[i + 1] = plain[i + 1] * inv + dest[i + 1] * amount;
      dest[i + 2] = plain[i + 2] * inv + dest[i + 2] * amount;
    }
  }
  ctx.putImageData(img, 0, 0);
  }

  // 特效的半徑是以 1080 長邊為基準，換算到目前這張的大小
  const scale = Math.max(out.width, out.height) / 1080;
  const W = out.width, H = out.height;

  // 噪點：彩色雜訊圖樣用 overlay 疊上去（跟編輯同一張圖樣、同一個濃度）
  if (fx.colorNoise) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = (fx.colorNoise / 100) * 0.63;
    const pat = ctx.createPattern(getNoisePattern(), 'repeat');
    if (pat) {
      ctx.scale(scale, scale);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W / scale, H / scale);
    }
    ctx.restore();
  }

  // 模糊
  if (fx.blur) {
    ctx.save();
    ctx.globalAlpha = (fx.blur / 240) * 1.5;
    const procScale = Math.min(1, 800 / Math.max(W, H));
    const tw = Math.max(1, (W * procScale) | 0);
    const th = Math.max(1, (H * procScale) | 0);
    const temp = document.createElement('canvas');
    temp.width = tw; temp.height = th;
    const tCtx = temp.getContext('2d', { willReadFrequently: true })!;
    tCtx.drawImage(out, 0, 0, tw, th);
    const tData = tCtx.getImageData(0, 0, tw, th);
    fastBlur(tData, tw, th, (fx.blur / 6) * scale * procScale * 1.5, null);
    tCtx.putImageData(tData, 0, 0);
    ctx.drawImage(temp, 0, 0, W, H);
    ctx.restore();
  }

  // 柔光：把亮部挑出來模糊之後用 screen 疊回去（含擴散與色相，跟編輯同款）
  if (fx.soft) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const softColor = fx.softColor ?? 0;
    ctx.globalAlpha = (fx.soft / 100) * (softColor > 0 ? 3.0 : 1.5);
    const procScale = Math.min(1, 800 / Math.max(W, H));
    const mw = Math.max(1, (W * procScale) | 0);
    const mh = Math.max(1, (H * procScale) | 0);
    const mask = document.createElement('canvas');
    mask.width = mw; mask.height = mh;
    const mCtx = mask.getContext('2d', { willReadFrequently: true })!;
    mCtx.drawImage(out, 0, 0, mw, mh);
    const cur = mCtx.getImageData(0, 0, mw, mh).data;
    const glow = mCtx.createImageData(mw, mh);
    const gd = glow.data;
    const threshold = ((fx.softThreshold ?? DEFAULT_PARAMS.softThreshold) / 100) * 255;
    let r_c = 0, g_c = 0, b_c = 0;
    if (softColor > 0) {
      const [tr, tg, tb] = hslToRgb(softColor / 100, 1.0, 0.5);
      r_c = tr; g_c = tg; b_c = tb;
    }
    for (let i = 0; i < cur.length; i += 4) {
      const lum = 0.299 * cur[i] + 0.587 * cur[i + 1] + 0.114 * cur[i + 2];
      gd[i] = softColor > 0 ? r_c : cur[i];
      gd[i + 1] = softColor > 0 ? g_c : cur[i + 1];
      gd[i + 2] = softColor > 0 ? b_c : cur[i + 2];
      const diff = lum - threshold;
      gd[i + 3] = diff > 0 ? Math.min(255, diff * 5) : 0;
    }
    fastBlur(glow, mw, mh, ((fx.softRadius ?? 100) / 100) * 80 * scale * procScale, null);
    mCtx.putImageData(glow, 0, 0);
    ctx.drawImage(mask, 0, 0, W, H);
    ctx.restore();
  }

  // 漏光：斜向的彩色漸層用 screen 疊上去
  if (fx.leakOpacity) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const angle = fx.leakAngle ?? 45;
    const hue = fx.leakHue ?? 15;
    const rad = (angle - 180) * (Math.PI / 180);
    const r = Math.max(W, H) * 1.5;
    const cx = W / 2, cy = H / 2;
    const grad = ctx.createLinearGradient(
      cx + Math.cos(rad) * r, cy + Math.sin(rad) * r,
      cx - Math.cos(rad) * r, cy - Math.sin(rad) * r,
    );
    const [lr, lg, lb] = hslToRgb(hue / 360, 1.0, 0.5);
    grad.addColorStop(0, `rgba(${lr},${lg},${lb},${fx.leakOpacity / 100})`);
    grad.addColorStop(0.5, `rgba(${lr},${lg},${lb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // 光暈：亮部暈開後只染在暗部旁邊，跟編輯同一套演算法
  if (fx.fringeIntensity) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const procScale = Math.min(1, 800 / Math.max(W, H));
    const hw = Math.max(1, (W * procScale) | 0);
    const hh = Math.max(1, (H * procScale) | 0);
    const hCanvas = document.createElement('canvas');
    hCanvas.width = hw; hCanvas.height = hh;
    const hCtx = hCanvas.getContext('2d', { willReadFrequently: true })!;
    hCtx.drawImage(out, 0, 0, hw, hh);
    const srcData = hCtx.getImageData(0, 0, hw, hh).data;
    const len = srcData.length;
    const highData = new Uint8ClampedArray(len);
    const threshold = 160;
    for (let i = 0; i < len; i += 4) {
      const luma = srcData[i] * 0.299 + srcData[i + 1] * 0.587 + srcData[i + 2] * 0.114;
      if (luma > threshold) {
        const intensity = Math.pow((luma - threshold) / (255 - threshold), 1.5);
        highData[i] = 255; highData[i + 1] = 255; highData[i + 2] = 255;
        highData[i + 3] = intensity * 255;
      }
    }
    const highImgData = new ImageData(highData, hw, hh);
    const maxBlur = hw * 0.08 * 0.8553125;
    fastBlur(highImgData, hw, hh, Math.max(1, maxBlur * ((fx.fringeSize ?? 10) / 100)), null);
    const glowImgData = new ImageData(new Uint8ClampedArray(len), hw, hh);
    const glowPixels = glowImgData.data;
    const blurred = highImgData.data;
    const [fR, fG, fB] = hslToRgb((fx.fringeHue ?? 8) / 360, 0.8, 0.35);
    const globalIntensity = (fx.fringeIntensity / 50) * 3.0;
    const falloffCurve = 1.0 + ((100 - (fx.fringeFeather ?? 100)) / 100) * 4.0;
    for (let i = 0; i < len; i += 4) {
      const alpha = blurred[i + 3] / 255;
      if (alpha > 0.005) {
        const luma = srcData[i] * 0.299 + srcData[i + 1] * 0.587 + srcData[i + 2] * 0.114;
        const darkMask = Math.pow(Math.max(0, 255 - luma) / 255, falloffCurve);
        const strength = Math.min(1.0, alpha * darkMask * globalIntensity);
        if (strength > 0.001) {
          glowPixels[i] = fR * strength;
          glowPixels[i + 1] = fG * strength;
          glowPixels[i + 2] = fB * strength;
          glowPixels[i + 3] = 255;
        }
      }
    }
    hCtx.putImageData(glowImgData, 0, 0);
    ctx.drawImage(hCanvas, 0, 0, W, H);
    ctx.restore();
  }

  // 暗角：放射狀漸層用 multiply 壓上去
  if (fx.vignette) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const v = document.createElement('canvas');
    v.width = W; v.height = H;
    const vCtx = v.getContext('2d')!;
    const grad = vCtx.createRadialGradient(W / 2, H / 2, W / 3, W / 2, H / 2, Math.max(W, H));
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1.0)');
    vCtx.fillStyle = grad;
    vCtx.fillRect(0, 0, W, H);
    const strength = fx.vignette / 100;
    ctx.globalAlpha = Math.min(1.0, strength * 0.8);
    ctx.drawImage(v, 0, 0, W, H);
    if (strength > 1.25) {
      ctx.globalAlpha = Math.min(1.0, (strength - 1.25) * 0.8);
      ctx.drawImage(v, 0, 0, W, H);
    }
    ctx.restore();
  }

  /* GLSL 特效接在整條管線的最後面，跟「編輯」那邊同一個順序、同一支函式，
     所以兩邊調同一個特效會得到同一張圖。全部都是 0 就整段跳過。 */
  if (hasActiveFx(fx)) applyGlEffects(ctx, W, H, fx);

  return out;
}

/** 噪點圖樣只做一次就重複用 */
let noisePattern: HTMLCanvasElement | null = null;
function getNoisePattern() {
  if (!noisePattern) noisePattern = generateNoisePattern('color');
  return noisePattern;
}
