/* 陰影／亮部的「局部」版本（編輯 → 調節的陰影、亮部）。
 *
 * 以前陰影／亮部是一條全圖共用的曲線：每個像素只看自己有多亮。拉高陰影時，
 * 暗部裡原本的明暗起伏會一起被壓平，畫面變灰、變扁。
 * 專業軟體的做法是看「這一帶」有多亮：先求一張保邊的低解析亮度底圖（base），
 * 由底圖決定這一帶要提亮／壓暗多少（一個平滑的增益場），再把增益乘回原本的像素。
 * 增益在一帶之內幾乎一樣，所以那一帶的細節、紋理、立體感原封不動地保留下來。
 *
 * · 底圖：亮度縮到長邊 256，用自引導濾波（guided filter）平滑 —— 平坦處很平，
 *   遇到明顯的明暗交界就停下來，交界兩側不會互相影響（不會有光暈）。
 * · 放大回原尺寸時再看一次像素自己的亮度（聯合雙邊上取樣），交界處每個像素
 *   只取跟自己同一側的底圖，邊緣不會發光、不會有黑邊。
 * · 增益表：用跟全圖同一支色調公式（曝光、亮度、對比都算進去）先算「這一帶的亮度
 *   會被陰影／亮部推到哪裡」，再換算成線性光裡的倍率。1025 格，拖滑桿時只重算這張小表。
 *
 * GPU（utils/lutGpu）跟 CPU（utils/photoPixelCore）用的是這裡同一套數字與公式。 */
import { makeToneStage, applyToneStage, shDelta, srgbToLinear, linearToSrgb, type ToneParams } from './photoToneMath';

export const LOCAL_BASE_MAX = 256;
export const LOCAL_GAIN_SIZE = 1024;
/** 上取樣時「跟自己同一側」的寬容度（編碼後的亮度單位） */
export const LOCAL_RANGE_SIGMA = 0.12;
const LR = 0.2126, LG = 0.7152, LB = 0.0722;

export type LocalBase = { data: Float32Array; w: number; h: number;
  /** CPU 用：放大到原尺寸、看過每個像素自己亮度的底圖（0…65535）。只跟來源有關，
      拖滑桿時不用重算；算過一次就留著（只留預覽那種尺寸，太大的不留）。 */
  field?: { w: number; h: number; v: Uint16Array; done: boolean } };

/** 一張圖的保邊亮度底圖（0…1，編碼後的亮度），每張來源只需要算一次 */
export function buildLocalBase(src: Uint8ClampedArray | Uint8Array, w: number, h: number): LocalBase {
  const k = Math.min(1, LOCAL_BASE_MAX / Math.max(w, h));
  const bw = Math.max(1, Math.round(w * k)), bh = Math.max(1, Math.round(h * k)), n = bw * bh;
  const sum = new Float32Array(n), cnt = new Float32Array(n);
  const sx = bw / w, sy = bh / h;
  for (let y = 0; y < h; y++) {
    const row = Math.min(bh - 1, (y * sy) | 0) * bw;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      const j = row + Math.min(bw - 1, (x * sx) | 0);
      sum[j] += LR * src[i] + LG * src[i + 1] + LB * src[i + 2]; cnt[j]++;
    }
  }
  const I = new Float32Array(n);
  for (let j = 0; j < n; j++) I[j] = cnt[j] ? sum[j] / cnt[j] / 255 : 0;
  return { data: guided(I, bw, bh, Math.max(2, Math.round(Math.max(bw, bh) / 20)), 0.01), w: bw, h: bh };
}

/** 方框平均（積分圖，O(n)），邊界自動縮小視窗 */
function box(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = 0; x < w; x++) { acc += src[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + acc; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** 自引導濾波（He et al.）：平坦處平滑、明暗交界保留 */
function guided(I: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h, II = new Float32Array(n);
  for (let j = 0; j < n; j++) II[j] = I[j] * I[j];
  const mI = box(I, w, h, r), mII = box(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let j = 0; j < n; j++) { const v = mII[j] - mI[j] * mI[j]; a[j] = v / (v + eps); b[j] = mI[j] - a[j] * mI[j]; }
  const ma = box(a, w, h, r), mb = box(b, w, h, r), q = new Float32Array(n);
  for (let j = 0; j < n; j++) q[j] = ma[j] * I[j] + mb[j];
  return q;
}

/** 增益表：這一帶的底圖亮度（未調整，0…1）→ 線性光裡要乘的倍率。
 *  跟全圖一樣先算曝光／亮度／對比（不含陰影／亮部），再把陰影／亮部套在那一帶的亮度上。 */
export function makeLocalGain(p: ToneParams): Float32Array {
  const s = (p.shadows || 0) / 100, hh = (p.highlights || 0) / 100;
  const stage = makeToneStage(p, undefined, true), c = new Float32Array(3);
  const N = LOCAL_GAIN_SIZE, M = 4096;
  // 灰階經過整條色調後的亮度（單調，反查用）
  const T = new Float32Array(M + 1);
  let prev = 0;
  for (let i = 0; i <= M; i++) {
    const v = (i / M) * 255; applyToneStage(stage, v, v, v, c);
    const y = (LR * c[0] + LG * c[1] + LB * c[2]) / 255;
    prev = i ? Math.max(prev, y) : y; T[i] = prev;
  }
  const at = (v: number) => { const f = v * M, i = Math.min(M - 1, f | 0); return T[i] + (T[i + 1] - T[i]) * (f - i); };
  const inv = (t: number) => {
    if (t <= T[0]) return 0; if (t >= T[M]) return 1;
    let lo = 0, hi = M;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] < t) lo = mid; else hi = mid; }
    const d = T[hi] - T[lo]; return (lo + (d > 1e-9 ? (t - T[lo]) / d : 0)) / M;
  };
  const gain = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const v = i / N, bt = at(v);
    let t = bt; if (s) t += shDelta(t, s, 0); if (hh) t += shDelta(t, 0, hh);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const v2 = inv(t), l0 = srgbToLinear(v), l1 = srgbToLinear(v2);
    // 極暗處用一小段線性斜率，避免除以接近 0 的數
    const g = l0 > 1e-4 ? l1 / l0 : (l1 + 1e-4) / (l0 + 1e-4);
    gain[i] = g < 0.2 ? 0.2 : g > 6 ? 6 : g;
  }
  return gain;
}

/** 底圖放大到像素位置（u、v 是像素中心 0…1；Y 是像素自己的編碼亮度）。
 *  雙線性四點，再依「跟自己亮度差多少」加權：交界處只取同一側。GLSL 版在 lutGpu。 */
export function sampleLocalBase(base: LocalBase, u: number, v: number, Y: number): number {
  const { data, w, h } = base;
  const fx = u * w - 0.5, fy = v * h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const xa = x0 < 0 ? 0 : x0 > w - 1 ? w - 1 : x0, xb = x0 + 1 < 0 ? 0 : x0 + 1 > w - 1 ? w - 1 : x0 + 1;
  const ya = y0 < 0 ? 0 : y0 > h - 1 ? h - 1 : y0, yb = y0 + 1 < 0 ? 0 : y0 + 1 > h - 1 ? h - 1 : y0 + 1;
  const b00 = data[ya * w + xa], b10 = data[ya * w + xb], b01 = data[yb * w + xa], b11 = data[yb * w + xb];
  const k = 1 / (LOCAL_RANGE_SIGMA * LOCAL_RANGE_SIGMA);
  const r00 = 1 / (1 + (Y - b00) * (Y - b00) * k), r10 = 1 / (1 + (Y - b10) * (Y - b10) * k);
  const r01 = 1 / (1 + (Y - b01) * (Y - b01) * k), r11 = 1 / (1 + (Y - b11) * (Y - b11) * k);
  const w00 = (1 - tx) * (1 - ty) * r00, w10 = tx * (1 - ty) * r10, w01 = (1 - tx) * ty * r01, w11 = tx * ty * r11;
  const ws = w00 + w10 + w01 + w11;
  return ws > 1e-6 ? (w00 * b00 + w10 * b10 + w01 * b01 + w11 * b11) / ws : (b00 + b10 + b01 + b11) * 0.25;
}

/** 亮部保護：提亮時，像素本身已經很亮（暗處裡的燈、反光、很飽和的藍）就少提一點，
 *  而且任何一個色版都不會被推過頂 —— 不會爆白、也不會把顏色推偏。
 *  M：三個色版裡最亮的那個（編碼後 0…1），mLin：它的線性值。 */
export const protectBright = (g: number, M: number, mLin: number) => {
  if (g <= 1) return g;
  const t = M <= 0.75 ? 0 : M >= 1 ? 1 : (M - 0.75) / 0.25;
  g = 1 + (g - 1) * (1 - t * t * (3 - 2 * t));
  const cap = mLin > 1e-6 ? 1 / mLin : g;
  return g < cap ? g : cap < 1 ? 1 : cap;
};

const LIN8 = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
const PROTECT = Float32Array.from({ length: 256 }, (_, m) => { const M = m / 255, t = M <= 0.75 ? 0 : M >= 1 ? 1 : (M - 0.75) / 0.25; return 1 - t * t * (3 - 2 * t); });
const CAP = Float32Array.from({ length: 256 }, (_, m) => LIN8[m] > 1e-6 ? 1 / LIN8[m] : 1e9);
const ENC_N = 4096;
const ENC = Float32Array.from({ length: ENC_N + 1 }, (_, i) => linearToSrgb(i / ENC_N) * 255);
/** 範圍權重 1/(1+(d/σ)²) 查表（d 以 1/1024 為一格） */
const RW_N = 1024;
const RW = Float32Array.from({ length: RW_N + 1 }, (_, i) => { const d = i / RW_N; return 1 / (1 + (d * d) / (LOCAL_RANGE_SIGMA * LOCAL_RANGE_SIGMA)); });
/** CPU：一個像素（0…255 整數）套上局部陰影／亮部，寫回 0…255 浮點。
 *  跟 sampleLocalBase／GLSL 同一套算式，座標與權重先查好表，一個像素只剩幾次乘加。 */
export function makeLocalApplier(base: LocalBase, gain: Float32Array, w: number, h: number) {
  const N = gain.length - 1, { data, w: bw, h: bh } = base;
  const xa = new Int32Array(w), xb = new Int32Array(w), tx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const f = ((x + 0.5) / w) * bw - 0.5, x0 = Math.floor(f);
    xa[x] = Math.min(bw - 1, Math.max(0, x0)); xb[x] = Math.min(bw - 1, Math.max(0, x0 + 1)); tx[x] = f - x0;
  }
  const ya = new Int32Array(h), yb = new Int32Array(h), ty = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const f = ((y + 0.5) / h) * bh - 0.5, y0 = Math.floor(f);
    ya[y] = Math.min(bh - 1, Math.max(0, y0)) * bw; yb[y] = Math.min(bh - 1, Math.max(0, y0 + 1)) * bw; ty[y] = f - y0;
  }
  const rw = (d: number) => RW[(d < 0 ? -d : d) >= 1 ? RW_N : ((d < 0 ? -d : d) * RW_N) | 0];
  if (!base.field || base.field.w !== w || base.field.h !== h) base.field = w * h <= 4_200_000 ? { w, h, v: new Uint16Array(w * h), done: false } : undefined;
  const fd = base.field, cached = !!fd && fd.done, fv = fd ? fd.v : null;
  /** 一整列：src 從 i0 開始的 w 個 RGBA 像素 → out（w×3 個 0…255 浮點） */
  return (y: number, src: Uint8ClampedArray | Uint8Array, i0: number, out: Float32Array) => {
    const ra = ya[y], rb = yb[y], fy = ty[y], row = y * w;
    for (let x = 0, i = i0, o = 0; x < w; x++, i += 4, o += 3) {
      const r = src[i], g = src[i + 1], b = src[i + 2];
      let B: number;
      if (cached) B = fv![row + x] * (1 / 65535);
      else {
        const Y = (LR * r + LG * g + LB * b) * (1 / 255);
        const ca = xa[x], cb = xb[x], fx = tx[x];
        const b00 = data[ra + ca], b10 = data[ra + cb], b01 = data[rb + ca], b11 = data[rb + cb];
        const w00 = (1 - fx) * (1 - fy) * rw(Y - b00), w10 = fx * (1 - fy) * rw(Y - b10), w01 = (1 - fx) * fy * rw(Y - b01), w11 = fx * fy * rw(Y - b11);
        const ws = w00 + w10 + w01 + w11;
        B = ws > 1e-6 ? (w00 * b00 + w10 * b10 + w01 * b01 + w11 * b11) / ws : (b00 + b10 + b01 + b11) * 0.25;
        B = B < 0 ? 0 : B > 1 ? 1 : B;
        if (fv) fv[row + x] = (B * 65535 + 0.5) | 0;
      }
      const f = B * N, j = f < N ? f | 0 : N - 1;
      let k = gain[j] + (gain[j + 1] - gain[j]) * (f - j);
      if (k > 1) {   // = protectBright，兩張 256 格的小表
        const m = r > g ? (r > b ? r : b) : (g > b ? g : b);
        k = 1 + (k - 1) * PROTECT[m]; const c = CAP[m]; if (k > c) k = c < 1 ? 1 : c;
      }
      let l = LIN8[r] * k; out[o] = l <= 0 ? 0 : l >= 1 ? 255 : ENC[(l * ENC_N + 0.5) | 0];
      l = LIN8[g] * k; out[o + 1] = l <= 0 ? 0 : l >= 1 ? 255 : ENC[(l * ENC_N + 0.5) | 0];
      l = LIN8[b] * k; out[o + 2] = l <= 0 ? 0 : l >= 1 ? 255 : ENC[(l * ENC_N + 0.5) | 0];
    }
    if (fd && !cached && y === h - 1) fd.done = true;
  };
}
