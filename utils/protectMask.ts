/**
 * 仿色的保護遮罩 —— 以及它的「自動防斷層」。
 *
 * 原本的保護權重只看單一像素的顏色：這顆像素有多像膚色、有多紅。
 * 問題是這樣的判斷完全不看鄰居。一張臉上如果有一塊偏青的皮膚，
 * 它在色彩空間裡離膚色很遠，權重直接掉到 0，可是它四周全是被保護的皮膚 ——
 * 交界處就是一條硬邊，也就是主人看到的「嚴重斷層」。
 *
 * 這裡把權重先變成一張「圖」，再對這張圖做兩件事：
 *
 *   一、補洞（灰階形態學閉運算 ＝ 先膨脹再侵蝕）
 *       膨脹讓四周的高權重淹過中間那塊破洞，侵蝕再把外輪廓縮回原位。
 *       比 2×半徑 小的洞會被整個填滿，而整體的外邊界幾乎不動 ——
 *       只補洞，不擴張保護範圍。半徑要比那塊斑本身大，不然完全沒有作用
 *       （閉運算的性質：填得掉就整塊填掉，填不掉就原樣不動）。
 *
 *   二、羽化（Guided Filter，He / Sun / Tang 2010）
 *       用原圖的亮度當導引，把剩下的邊界做邊緣感知的平滑：
 *       亮度平坦的地方（同一張臉上）大幅抹平，亮度有真正邊緣的地方
 *       （臉與背景之間）保持銳利。
 *
 * 兩件事動到的都是「遮罩」而不是「顏色」，所以影像細節一點都不會糊。
 *
 * 兩個運算都是正齊次的（close(s·f) = s·close(f)、guided(I, s·p) = s·guided(I, p)），
 * 所以膚色保護滑桿的倍率可以留到最後再乘 —— 拉滑桿不必重算遮罩。
 *
 * 遮罩本身很平滑，用縮圖算完再取樣回去，肉眼看不出差別，卻讓全解析度
 * 導出從「秒級」變成「一次性的幾十毫秒」。這就是 Fast Guided Filter
 * （He & Sun 2015）在做的事。
 */
import { skinProbability, hueProtect } from './colorTransfer';

/* sRGB → 線性只有 256 種可能的輸入（來源是 8-bit），先建表就不用逐像素跑 pow()。
   數值跟 colorTransfer 裡那條完全一樣，只是查表。一張 1024×768 的圖
   等於省掉 236 萬次 pow —— 建遮罩的時間因此掉了一半以上。 */
const LIN8 = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();
const WHITE_X = 0.95047, WHITE_Z = 1.08883;
const labF = (t: number) => (t > 0.008856451679 ? Math.cbrt(t) : t * 7.787037037 + 16 / 116);

/** 補洞半徑，佔短邊的比例 */
export const DEBAND_FILL = 0.10;
/** 羽化強度：0 ＝ 完全不羽化（回到舊行為），1 ＝ 全額 */
export const DEBAND_AMOUNT = 1.0;
/** 羽化半徑，佔短邊的比例 */
export const DEBAND_RADIUS = 0.04;
/** 導引濾波的正規化項：越大越平滑，越小越貼著亮度邊緣 */
const DEBAND_EPS = 0.0025;
/** 遮罩用的解析度上限。跟調校台的預覽同一個尺寸，兩邊的濾波才看到同樣的細節 */
export const MASK_MAX_EDGE = 640;
/**
 * 膚色保護滑桿要烤幾層。
 *
 * 合併必須發生在防斷層「之前」（調校台就是這樣做的）：
 *   w = min(1, max(膚色滑桿 × 膚色機率, 色相保護))，然後才補洞、才羽化。
 * 可是這樣一來遮罩就跟滑桿綁在一起了，拉滑桿得整張重算 —— 太慢。
 *
 * 所以沿用調校台對付保護權重的同一招：把滑桿 0 → 1 平均烤成幾層，
 * 每次拉滑桿只在相鄰兩層之間做一次線性內插（整張圖幾毫秒）。
 * 一次性成本換來滑桿零延遲，而且順序是對的。
 */
export const SKIN_LAYERS = 9;

export type ProtectMaps = {
  w: number;
  h: number;
  /** 膚色保護 0 → 1 各一層，每一層都是「合併後才防斷層」的最終權重 */
  layers: Float32Array[];
};

/* ── 一維滑動極值：單調佇列，攤提 O(1)，跟半徑多大無關 ────────────── */
function morphPass(
  src: Float32Array, w: number, h: number, r: number,
  out: Float32Array, isMax: boolean,
): Float32Array {
  const tmp = new Float32Array(w * h);
  const q = new Int32Array(Math.max(w, h) + 2);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let head = 0, tail = 0;
    for (let i = 0; i < w + r; i++) {
      const ii = i < w ? i : w - 1, v = src[o + ii];
      while (tail > head && (isMax ? src[o + q[tail - 1]] <= v : src[o + q[tail - 1]] >= v)) tail--;
      q[tail++] = ii;
      const c = i - r;
      if (c >= 0) { while (q[head] < c - r) head++; tmp[o + c] = src[o + q[head]]; }
    }
  }
  for (let x = 0; x < w; x++) {
    let head = 0, tail = 0;
    for (let i = 0; i < h + r; i++) {
      const ii = i < h ? i : h - 1, v = tmp[ii * w + x];
      while (tail > head && (isMax ? tmp[q[tail - 1] * w + x] <= v : tmp[q[tail - 1] * w + x] >= v)) tail--;
      q[tail++] = ii;
      const c = i - r;
      if (c >= 0) { while (q[head] < c - r) head++; out[c * w + x] = tmp[q[head] * w + x]; }
    }
  }
  return out;
}

/** 閉運算：先膨脹（洞被四周淹掉）再侵蝕（外輪廓縮回原位） */
function morphClose(src: Float32Array, w: number, h: number, r: number, out: Float32Array): Float32Array {
  const t = new Float32Array(w * h);
  morphPass(src, w, h, r, t, true);
  morphPass(t, w, h, r, out, false);
  return out;
}

/** 盒狀濾波，用滑動和做，所以跟半徑無關地快 */
function boxBlur(src: Float32Array, w: number, h: number, r: number, out: Float32Array): Float32Array {
  const tmp = new Float32Array(w * h);
  const win = 2 * r + 1;
  const cx = (x: number) => (x < 0 ? 0 : x > w - 1 ? w - 1 : x);
  const cy = (y: number) => (y < 0 ? 0 : y > h - 1 ? h - 1 : y);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[o + cx(x)];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = sum / win;
      sum -= src[o + cx(x - r)];
      sum += src[o + cx(x + r + 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[cy(y) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      sum -= tmp[cy(y - r) * w + x];
      sum += tmp[cy(y + r + 1) * w + x];
    }
  }
  return out;
}

/** 導引濾波：用 I（亮度）當導引，把 p（遮罩）做邊緣感知的平滑 */
function guidedFilter(
  I: Float32Array, p: Float32Array, w: number, h: number,
  r: number, eps: number, out: Float32Array,
): Float32Array {
  const n = w * h;
  const mI = boxBlur(I, w, h, r, new Float32Array(n));
  const mP = boxBlur(p, w, h, r, new Float32Array(n));
  const II = new Float32Array(n), IP = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * p[i]; }
  const mII = boxBlur(II, w, h, r, new Float32Array(n));
  const mIP = boxBlur(IP, w, h, r, new Float32Array(n));
  const A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    A[i] = (mIP[i] - mI[i] * mP[i]) / (mII[i] - mI[i] * mI[i] + eps);
    B[i] = mP[i] - A[i] * mI[i];
  }
  const mA = boxBlur(A, w, h, r, new Float32Array(n));
  const mB = boxBlur(B, w, h, r, new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const v = mA[i] * I[i] + mB[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

/** 補洞 ＋ 羽化，就地換掉 m */
function deband(m: Float32Array, luma: Float32Array, w: number, h: number): Float32Array {
  const short = Math.min(w, h);
  const n = w * h;
  /* 整張幾乎沒有這種顏色（例如畫面裡根本沒有紅色）的話，濾波前後都是 0，
     直接跳過 —— 省掉十幾趟全畫面的掃描。 */
  let peak = 0;
  for (let i = 0; i < n; i++) if (m[i] > peak) { peak = m[i]; if (peak > 0.02) break; }
  if (peak <= 0.02) return m;
  let cur = m;
  const fillR = Math.round(short * DEBAND_FILL);
  if (fillR > 0) cur = morphClose(cur, w, h, fillR, new Float32Array(n));
  if (DEBAND_AMOUNT > 0) {
    const r = Math.max(1, Math.round(short * DEBAND_RADIUS));
    const sm = guidedFilter(luma, cur, w, h, r, DEBAND_EPS, new Float32Array(n));
    if (DEBAND_AMOUNT >= 1) return sm;
    for (let i = 0; i < n; i++) sm[i] = cur[i] + (sm[i] - cur[i]) * DEBAND_AMOUNT;
    return sm;
  }
  return cur;
}

/**
 * 從一張圖算出保護權重。
 * 傳進來的可以是縮圖 —— 遮罩很平滑，用縮圖算的結果取樣回全解析度看不出差別。
 *
 * 順序很重要：**先合併、再防斷層**。反過來（各自防斷層再合併）在膚色與色相
 * 兩塊互相接壤的地方會偏掉（量到最大 84 階），因為 close/guided 都不跟 max 交換。
 */
export function buildProtectMaps(data: Uint8ClampedArray, w: number, h: number): ProtectMaps {
  const n = w * h;
  const skin = new Float32Array(n);
  const hue = new Float32Array(n);
  const luma = new Float32Array(n);
  for (let p = 0, k = 0; k < n; p += 4, k++) {
    const r8 = data[p], g8 = data[p + 1], b8 = data[p + 2];
    const r = r8 / 255, g = g8 / 255, b = b8 / 255;
    luma[k] = 0.299 * r + 0.587 * g + 0.114 * b;
    skin[k] = skinProbability(r, g, b);
    // 只需要 a*b*（色相與彩度），L* 這裡用不到，所以不算
    const R = LIN8[r8], G = LIN8[g8], B = LIN8[b8];
    const fx = labF((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / WHITE_X);
    const fy = labF(0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
    const fz = labF((0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / WHITE_Z);
    hue[k] = hueProtect(500 * (fx - fy), 200 * (fy - fz));
  }
  const layers: Float32Array[] = [];
  for (let i = 0; i < SKIN_LAYERS; i++) {
    const sp = i / (SKIN_LAYERS - 1);
    const merged = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = sp * skin[k], b = hue[k];
      merged[k] = Math.min(1, a > b ? a : b);
    }
    layers.push(deband(merged, luma, w, h));
  }
  return { w, h, layers };
}

/**
 * 把某個膚色保護值下的權重解出來（在相鄰兩層之間線性內插）。
 * 整張圖只有一次乘加，拉滑桿幾毫秒就好。
 */
export function resolveWeight(m: ProtectMaps, skinProtect: number): Float32Array {
  const n = m.w * m.h;
  const sp = Math.min(1, Math.max(0, skinProtect));
  const seg = sp * (m.layers.length - 1);
  const li = Math.min(m.layers.length - 2, seg | 0);
  const f = seg - li;
  const A = m.layers[li], B = m.layers[li + 1];
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = A[k] + (B[k] - A[k]) * f;
  return out;
}

/** 遮罩用的縮圖尺寸（保持長寬比，長邊最多 MASK_MAX_EDGE） */
export function maskSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, MASK_MAX_EDGE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** 從任何可以畫進 canvas 的來源建遮罩（會自己縮到 MASK_MAX_EDGE） */
export function buildProtectMapsFrom(
  src: CanvasImageSource, w: number, h: number,
): ProtectMaps | null {
  const size = maskSize(w, h);
  const c = document.createElement('canvas');
  c.width = size.w; c.height = size.h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, size.w, size.h);
  return buildProtectMaps(g.getImageData(0, 0, size.w, size.h).data, size.w, size.h);
}

/** 打包成 GPU 的 RGBA8 貼圖：R ＝ 已經解好的保護權重 */
export function packWeight(weight: Float32Array): Uint8Array {
  const n = weight.length;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = Math.round(weight[i] * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

