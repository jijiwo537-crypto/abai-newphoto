/**
 * 仿色（Colour Transfer）
 *
 * 四種業界常用的演算法，全部在瀏覽器本機算，不上傳任何照片：
 *
 *   reinhard  Reinhard et al. 2001《Color Transfer between Images》
 *             在 Lab 空間把三個通道的平均值與標準差對齊。最經典，穩，
 *             但三個通道各算各的，遇到通道之間高度相關的畫面會偏掉。
 *
 *   mkl       Pitié & Kokaram 2007《The Linear Monge-Kantorovitch Colour Mapping》
 *             把兩張圖的顏色都看成 3D 高斯分布，求「搬運成本最小」的線性映射
 *             （閉合解，會同時對齊平均值與整個共變異數矩陣）。
 *             通道相關性有被考慮進去，所以色偏比 Reinhard 準得多。
 *
 *   （另外有一版在 CIELAB 做的 MKL —— buildMKLLab —— 不列在選項裡，
 *     它的角色是直方圖法的「沒數據時退回去的平滑版本」。）
 *
 * （另外實作過 Pitié 2005 的 N 維分布轉移 IDT，量測後拿掉了 —— 見 PR 說明：
 *   它的映射太不平滑，輸入動 0.02 輸出就跳 0.2 以上，畫面會出現色塊。）
 *
 *   hist      各通道獨立的直方圖匹配（Lab）。這就是「單純把直方圖相似化」，
 *             放在這裡當對照組 —— 它常常會把畫面拉爆，正好凸顯上面三個的差別。
 *
 * 算完之後統一烘成一顆 3D LUT 再套用：
 *   - 經驗分布本身有雜訊，烘成 LUT 等於做了一次平滑，不會出現色塊
 *   - 套用時只是三線性插值，全解析度也很快
 *   - 強度、膚色保護都可以在同一個地方處理
 */

// ---------------------------------------------------------------------------
// 色彩空間
// ---------------------------------------------------------------------------
const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const WHITE = { x: 0.95047, y: 1.0, z: 1.08883 }; // D65

export function rgbToLab(r: number, g: number, b: number, out: number[]): void {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / WHITE.x;
  const y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) / WHITE.y;
  const z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / WHITE.z;
  const f = (t: number) => (t > 0.008856451679 ? Math.cbrt(t) : t * 7.787037037 + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
}

function labToRgb(L: number, a: number, bb: number, out: number[]): void {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const fi = (t: number) => (t > 0.20689655172 ? t * t * t : (t - 16 / 116) / 7.787037037);
  const x = fi(fx) * WHITE.x, y = fi(fy) * WHITE.y, z = fi(fz) * WHITE.z;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  out[0] = Math.min(1, Math.max(0, linearToSrgb(Math.max(0, R))));
  out[1] = Math.min(1, Math.max(0, linearToSrgb(Math.max(0, G))));
  out[2] = Math.min(1, Math.max(0, linearToSrgb(Math.max(0, B))));
}

/**
 * Lab → sRGB，超出色域時「等比例收彩度」而不是逐通道硬夾。
 *
 * 為什麼一定要這樣做
 * ─────────────────────────────────────────────────────────────
 * labToRgb 原本是把 R、G、B 各自夾回 0～1。那是硬性截斷，會造成兩件事：
 *   ① 三個通道被夾的程度不一樣 → 色相跟著歪掉（紅的被夾成橘的）
 *   ② 一旦某個通道貼到 255 就再也不動 → 一整片區域被壓成同一個值，
 *      相鄰的漸層被壓平，邊界上就出現一條「硬變」
 * 強度拉到 200 時，紅色區域因為有保護、彩度被抬回去，最容易整片衝出色域 ——
 * 那正是主人看到的「紅色邊緣有明顯硬變」。
 *
 * 改成：亮度與色相完全不動，只把彩度收到色域裡面。
 * 而且不是收到剛好貼著邊界（那還是會壓平），而是過了膝點之後用指數曲線
 * 慢慢逼近邊界 —— 這條曲線處處單調、斜率永遠大於 0，
 * 所以再亮的顏色之間也還留著差距，不會有色彩斷層。
 */
const GAMUT_EPS = 1e-4;
/** 膝點：低於邊界的這個比例完全不壓（照原樣輸出），高於才開始收 */
const GAMUT_KNEE = 0.82;

/** (L, a, b) 這個顏色在 sRGB 裡面嗎（只看線性 RGB，不必做 gamma） */
function labInGamut(L: number, a: number, b: number): boolean {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const fi = (t: number) => (t > 0.20689655172 ? t * t * t : (t - 16 / 116) / 7.787037037);
  const x = fi(fx) * WHITE.x, y = fi(fy) * WHITE.y, z = fi(fz) * WHITE.z;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return R >= -GAMUT_EPS && R <= 1 + GAMUT_EPS
      && G >= -GAMUT_EPS && G <= 1 + GAMUT_EPS
      && B >= -GAMUT_EPS && B <= 1 + GAMUT_EPS;
}

export function labToRgbSoft(L: number, a: number, b: number, out: number[]): void {
  const Lc = Math.min(100, Math.max(0, L));
  const c = Math.hypot(a, b);
  if (c < 1e-6) { labToRgb(Lc, a, b, out); return; }

  /* 這個亮度、這個色相下，彩度最多能到多少（二分找邊界）。
     大部分像素本來就在色域裡而且離邊界還遠，先擋掉就不用算：
     GAMUT_C 是「各色相的最大彩度」，連一半都不到的顏色不可能貼到邊。 */
  const inNow = labInGamut(Lc, a, b);
  if (inNow && c < 0.5 * gamutChroma(a, b)) { labToRgb(Lc, a, b, out); return; }

  let lo = 0, hi = inNow ? Math.max(1, c) / c : 1;   // hi 是「倍率」，1 = 現在這個彩度
  if (inNow) {
    // 已經在色域裡：往外找邊界（最多找到 4 倍，夠遠了）
    lo = 1; hi = 4;
    for (let k = 0; k < 7; k++) {
      const m = (lo + hi) / 2;
      if (labInGamut(Lc, a * m, b * m)) lo = m; else hi = m;
    }
  } else {
    lo = 0; hi = 1;
    for (let k = 0; k < 8; k++) {
      const m = (lo + hi) / 2;
      if (labInGamut(Lc, a * m, b * m)) lo = m; else hi = m;
    }
  }
  const cMax = c * lo;
  if (cMax <= 1e-6) { labToRgb(Lc, 0, 0, out); return; }

  // 膝點以下原封不動；以上用指數逼近邊界，永遠到不了、也永遠不會壓平
  const x = c / cMax;
  let cOut = c;
  if (x > GAMUT_KNEE) {
    const t = (x - GAMUT_KNEE) / (1 - GAMUT_KNEE);
    cOut = cMax * (GAMUT_KNEE + (1 - GAMUT_KNEE) * (1 - Math.exp(-t)));
  }
  const k2 = cOut / c;
  labToRgb(Lc, a * k2, b * k2, out);
}

// ---------------------------------------------------------------------------
// 3x3 對稱矩陣的特徵分解（Jacobi）—— MKL 需要開根號與反開根號
// ---------------------------------------------------------------------------
type M3 = Float64Array; // row-major 9

function jacobiEigen(a: M3): { val: number[]; vec: M3 } {
  const A = Float64Array.from(a);
  const V = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += A[p * 3 + q] * A[p * 3 + q];
    if (off < 1e-22) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = A[p * 3 + q];
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (A[q * 3 + q] - A[p * 3 + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = A[k * 3 + p], akq = A[k * 3 + q];
          A[k * 3 + p] = c * akp - s * akq;
          A[k * 3 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = A[p * 3 + k], aqk = A[q * 3 + k];
          A[p * 3 + k] = c * apk - s * aqk;
          A[q * 3 + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k * 3 + p], vkq = V[k * 3 + q];
          V[k * 3 + p] = c * vkp - s * vkq;
          V[k * 3 + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { val: [A[0], A[4], A[8]], vec: V };
}

const mul3 = (a: M3, b: M3): M3 => {
  const o = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
    o[i * 3 + j] = s;
  }
  return o;
};
const transpose3 = (a: M3): M3 => new Float64Array([a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]);

/** 對稱半正定矩陣的 f(Σ)：把特徵值各自套 f 再組回去 */
function symPow(a: M3, f: (v: number) => number): M3 {
  const { val, vec } = jacobiEigen(a);
  const d = new Float64Array([f(Math.max(val[0], 1e-12)), 0, 0, 0, f(Math.max(val[1], 1e-12)), 0, 0, 0, f(Math.max(val[2], 1e-12))]);
  return mul3(mul3(vec, d), transpose3(vec));
}

// ---------------------------------------------------------------------------
// 取樣：統計只用縮圖算就夠，全解析度沒有必要
// ---------------------------------------------------------------------------
export type Samples = { r: Float64Array; g: Float64Array; b: Float64Array; n: number };

export function sampleRgb(data: Uint8ClampedArray, maxSamples = 60000): Samples {
  const total = data.length / 4;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const n = Math.floor(total / step);
  const r = new Float64Array(n), g = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0, k = 0; k < n; k++, i += step) {
    const p = i * 4;
    r[k] = data[p] / 255; g[k] = data[p + 1] / 255; b[k] = data[p + 2] / 255;
  }
  return { r, g, b, n };
}

const meanCov = (s: Samples) => {
  const m = [0, 0, 0];
  for (let i = 0; i < s.n; i++) { m[0] += s.r[i]; m[1] += s.g[i]; m[2] += s.b[i]; }
  m[0] /= s.n; m[1] /= s.n; m[2] /= s.n;
  const c = new Float64Array(9);
  for (let i = 0; i < s.n; i++) {
    const d = [s.r[i] - m[0], s.g[i] - m[1], s.b[i] - m[2]];
    for (let a = 0; a < 3; a++) for (let b2 = 0; b2 < 3; b2++) c[a * 3 + b2] += d[a] * d[b2];
  }
  for (let i = 0; i < 9; i++) c[i] /= s.n;
  // 一點點對角補強，避免退化（例如整張純色）時求逆爆掉
  c[0] += 1e-6; c[4] += 1e-6; c[8] += 1e-6;
  return { m, c };
};

// ---------------------------------------------------------------------------
// 演算法
// ---------------------------------------------------------------------------
export type Rgb = [number, number, number];
export type TransferFn = (rgb: Rgb, out: Rgb) => void;

/** Reinhard 2001：Lab 三通道各自對齊平均值與標準差 */
export function buildReinhard(src: Samples, ref: Samples): TransferFn {
  const stat = (s: Samples) => {
    const lab: number[] = [0, 0, 0];
    const m = [0, 0, 0], v = [0, 0, 0];
    const L = new Float64Array(s.n), A = new Float64Array(s.n), B = new Float64Array(s.n);
    for (let i = 0; i < s.n; i++) {
      rgbToLab(s.r[i], s.g[i], s.b[i], lab);
      L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
      m[0] += lab[0]; m[1] += lab[1]; m[2] += lab[2];
    }
    m[0] /= s.n; m[1] /= s.n; m[2] /= s.n;
    for (let i = 0; i < s.n; i++) {
      v[0] += (L[i] - m[0]) ** 2; v[1] += (A[i] - m[1]) ** 2; v[2] += (B[i] - m[2]) ** 2;
    }
    return { m, sd: [Math.sqrt(v[0] / s.n) + 1e-6, Math.sqrt(v[1] / s.n) + 1e-6, Math.sqrt(v[2] / s.n) + 1e-6] };
  };
  const a = stat(src), b = stat(ref);
  const lab: number[] = [0, 0, 0], rgb: number[] = [0, 0, 0];
  return (p, out) => {
    rgbToLab(p[0], p[1], p[2], lab);
    const L = (lab[0] - a.m[0]) * (b.sd[0] / a.sd[0]) + b.m[0];
    const A = (lab[1] - a.m[1]) * (b.sd[1] / a.sd[1]) + b.m[1];
    const B = (lab[2] - a.m[2]) * (b.sd[2] / a.sd[2]) + b.m[2];
    labToRgb(L, A, B, rgb);
    out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2];
  };
}

/**
 * MKL：T = Σs^-1/2 (Σs^1/2 Σt Σs^1/2)^1/2 Σs^-1/2
 * 兩個高斯分布之間搬運成本最小的線性映射（Pitié & Kokaram 2007）
 */
export function buildMKL(src: Samples, ref: Samples): TransferFn {
  const A = meanCov(src), B = meanCov(ref);
  const s12 = symPow(A.c, Math.sqrt);
  const sInv = symPow(A.c, (v) => 1 / Math.sqrt(v));
  const mid = symPow(mul3(mul3(s12, B.c), s12), Math.sqrt);
  const T = mul3(mul3(sInv, mid), sInv);
  return (p, out) => {
    const d0 = p[0] - A.m[0], d1 = p[1] - A.m[1], d2 = p[2] - A.m[2];
    out[0] = Math.min(1, Math.max(0, T[0] * d0 + T[1] * d1 + T[2] * d2 + B.m[0]));
    out[1] = Math.min(1, Math.max(0, T[3] * d0 + T[4] * d1 + T[5] * d2 + B.m[1]));
    out[2] = Math.min(1, Math.max(0, T[6] * d0 + T[7] * d1 + T[8] * d2 + B.m[2]));
  };
}

/**
 * 一維分布對齊：把 from 的累積分布對到 to 的，做成查表。
 *
 * 分格數刻意不高，而且做完要抹平：經驗累積分布本身是階梯狀的，
 * 直接拿來用的話，輸入動一點點、輸出就跳一大截（實測輸入動 0.02，
 * 輸出平均跳 0.14、最多 0.46）。這種曲線疊個幾輪之後，畫面上就是色塊與斷階，
 * 也塞不進任何 LUT。抹平之後才是一條可以用的曲線。
 */
function build1DMap(from: Float64Array, to: Float64Array, bins = 96) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < from.length; i++) { if (from[i] < lo) lo = from[i]; if (from[i] > hi) hi = from[i]; }
  let tlo = Infinity, thi = -Infinity;
  for (let i = 0; i < to.length; i++) { if (to[i] < tlo) tlo = to[i]; if (to[i] > thi) thi = to[i]; }
  if (!(hi > lo)) hi = lo + 1e-6;
  if (!(thi > tlo)) thi = tlo + 1e-6;
  const hf = new Float64Array(bins), ht = new Float64Array(bins);
  for (let i = 0; i < from.length; i++) hf[Math.min(bins - 1, Math.max(0, ((from[i] - lo) / (hi - lo) * bins) | 0))]++;
  for (let i = 0; i < to.length; i++) ht[Math.min(bins - 1, Math.max(0, ((to[i] - tlo) / (thi - tlo) * bins) | 0))]++;
  for (let i = 1; i < bins; i++) { hf[i] += hf[i - 1]; ht[i] += ht[i - 1]; }
  for (let i = 0; i < bins; i++) { hf[i] /= hf[bins - 1] || 1; ht[i] /= ht[bins - 1] || 1; }
  // 對每個來源 bin 找出目標分布裡累積機率相同的位置
  const map = new Float64Array(bins);
  let j = 0;
  for (let i = 0; i < bins; i++) {
    while (j < bins - 1 && ht[j] < hf[i]) j++;
    map[i] = tlo + ((j + 0.5) / bins) * (thi - tlo);
  }
  // 抹平：五格的移動平均跑三輪，把階梯磨成曲線
  const tmp = new Float64Array(bins);
  for (let pass = 0; pass < 3; pass++) {
    tmp.set(map);
    for (let i = 0; i < bins; i++) {
      let acc = 0, cnt = 0;
      for (let d = -2; d <= 2; d++) {
        const k = i + d;
        if (k < 0 || k >= bins) continue;
        acc += tmp[k]; cnt++;
      }
      map[i] = acc / cnt;
    }
  }
  // 抹平可能讓曲線出現小回頭，補回單調（不然反差會怪）
  for (let i = 1; i < bins; i++) if (map[i] < map[i - 1]) map[i] = map[i - 1];
  return { lo, hi, map, bins };
}
/**
 * 範圍外要「延伸」而不是「亂長」。
 * 烘 LUT 時會去問整個 RGB 立方體的角落，那些顏色原圖裡根本沒有，
 * 落在取樣範圍外。以前直接平移，疊了幾輪之後就飛掉（IDT 整個壞掉就是這個原因）。
 * 現在延伸的量會被限制在目標範圍附近，不會愈跑愈遠。
 */
const apply1D = (m: ReturnType<typeof build1DMap>, v: number): number => {
  const t = ((v - m.lo) / (m.hi - m.lo)) * m.bins;
  const tlo = m.map[0], thi = m.map[m.bins - 1];
  const pad = 0.15 * Math.max(1e-6, Math.abs(thi - tlo));
  const clampOut = (x: number) => Math.min(Math.max(tlo, thi) + pad, Math.max(Math.min(tlo, thi) - pad, x));
  if (t <= 0) return clampOut(tlo + (v - m.lo));
  if (t >= m.bins - 1) return clampOut(thi + (v - m.hi));
  const i = t | 0, f = t - i;
  return m.map[i] * (1 - f) + m.map[i + 1] * f;
};

/**
 * MKL 但在 Lab 空間做。
 * RGB 版對「數值」最準，Lab 版對「看起來」比較順 —— 亮度與色度是分開的軸，
 * 膚色不容易被拉歪，人像通常這個比較好看。
 */
export function buildMKLLab(src: Samples, ref: Samples): TransferFn {
  const toLabSamples = (s2: Samples): Samples => {
    const lab: number[] = [0, 0, 0];
    const r = new Float64Array(s2.n), g = new Float64Array(s2.n), b = new Float64Array(s2.n);
    for (let i = 0; i < s2.n; i++) { rgbToLab(s2.r[i], s2.g[i], s2.b[i], lab); r[i] = lab[0]; g[i] = lab[1]; b[i] = lab[2]; }
    return { r, g, b, n: s2.n };
  };
  const A = meanCov(toLabSamples(src)), B = meanCov(toLabSamples(ref));
  const s12 = symPow(A.c, Math.sqrt);
  const sInv = symPow(A.c, (v) => 1 / Math.sqrt(v));
  const T = mul3(mul3(sInv, symPow(mul3(mul3(s12, B.c), s12), Math.sqrt)), sInv);
  const lab: number[] = [0, 0, 0], rgb: number[] = [0, 0, 0];
  return (p, out) => {
    rgbToLab(p[0], p[1], p[2], lab);
    const d0 = lab[0] - A.m[0], d1 = lab[1] - A.m[1], d2 = lab[2] - A.m[2];
    labToRgb(
      T[0] * d0 + T[1] * d1 + T[2] * d2 + B.m[0],
      T[3] * d0 + T[4] * d1 + T[5] * d2 + B.m[1],
      T[6] * d0 + T[7] * d1 + T[8] * d2 + B.m[2],
      rgb,
    );
    out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2];
  };
}

/** 對照組：Lab 三通道各自做直方圖匹配（「單純把直方圖相似化」就是這個） */
export function buildHistogram(src: Samples, ref: Samples): TransferFn {
  const toLab = (s: Samples) => {
    const lab: number[] = [0, 0, 0];
    const L = new Float64Array(s.n), A = new Float64Array(s.n), B = new Float64Array(s.n);
    for (let i = 0; i < s.n; i++) { rgbToLab(s.r[i], s.g[i], s.b[i], lab); L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2]; }
    return [L, A, B];
  };
  const a = toLab(src), b = toLab(ref);
  const maps = [build1DMap(a[0], b[0]), build1DMap(a[1], b[1]), build1DMap(a[2], b[2])];
  const lab: number[] = [0, 0, 0], rgb: number[] = [0, 0, 0];
  return (p, out) => {
    rgbToLab(p[0], p[1], p[2], lab);
    labToRgb(apply1D(maps[0], lab[0]), apply1D(maps[1], lab[1]), apply1D(maps[2], lab[2]), rgb);
    out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2];
  };
}

export const METHODS = ['mkl', 'reinhard', 'hist'] as const;
export type Method = typeof METHODS[number];
export const METHOD_LABEL: Record<Method, string> = {
  mkl: '標準',
  reinhard: '經典',
  hist: '直方圖對齊',
};
export const METHOD_ICON: Record<Method, string> = {
  // 三顆要一眼分得出來：漸層方塊／散布點／長條圖
  mkl: 'gradient',
  reinhard: 'scatter_plot',
  hist: 'bar_chart',
};


/**
 * 這個方法需不需要「有數據才信任」的正則化？
 * mkl / mklLab / reinhard 都是封閉解，整個色彩空間都定義得好好的，直接烘就準。
 * 只有直方圖是從經驗分布學來的，沒數據的地方會亂猜，才需要退回平滑的版本。
 */
export const NEEDS_REGULARISING: Record<Method, boolean> = {
  mkl: false, reinhard: false, hist: true,
};

export function buildTransfer(method: Method, src: Samples, ref: Samples): TransferFn {
  if (method === 'mkl') return buildMKL(src, ref);
  if (method === 'reinhard') return buildReinhard(src, ref);
  return buildHistogram(src, ref);
}

// ---------------------------------------------------------------------------
// 烘成 3D LUT
// ---------------------------------------------------------------------------
export type Lut3D = { size: number; data: Float32Array };

export function bakeLut(fn: TransferFn, size = 25): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  const p: Rgb = [0, 0, 0], o: Rgb = [0, 0, 0];
  let k = 0;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        p[0] = ri / (size - 1); p[1] = gi / (size - 1); p[2] = bi / (size - 1);
        fn(p, o);
        data[k++] = o[0]; data[k++] = o[1]; data[k++] = o[2];
      }
    }
  }
  return { size, data };
}

/**
 * 有數據的地方才信任它 —— 這一步是整個仿色能不能用的關鍵。
 *
 * 一張照片的顏色只佔了 RGB 立方體裡很薄的一層，立方體大部分角落是這張照片
 * 根本沒有的顏色。像 IDT、直方圖這種「從分布學出來的」映射，在沒有數據的地方
 * 等於是亂猜；偏偏烘 LUT 會把整個立方體都問過一遍，插值時再把那些亂猜的值
 * 混進真正的像素裡 —— 實測 IDT 直接套的結果是對的，一經過 LUT 就整個垮掉。
 *
 * 所以這裡先算一張「原圖的顏色密度」，密度高的格子用學出來的映射，
 * 密度低的格子平滑地退回 MKL（線性、全域、到哪都不會亂）。最後再輕輕糊一次，
 * 把殘留的雜訊抹平。
 */
/** 依方法選擇要不要正則化，外面只要呼叫這一個 */
export function bakeFor(method: Method, src: Samples, ref: Samples, size = 25): Lut3D {
  const fn = buildTransfer(method, src, ref);
  if (!NEEDS_REGULARISING[method]) return bakeLut(fn, size);
  return bakeLutRegularised(fn, buildMKLLab(src, ref), src, size);
}

export function bakeLutRegularised(
  fn: TransferFn,
  fallback: TransferFn,
  src: Samples,
  size = 25,
): Lut3D {
  const N = size, m = N - 1;
  const dens = new Float32Array(N * N * N);
  // 把每個取樣點用三線性權重灑進格子裡
  for (let i = 0; i < src.n; i++) {
    const x = Math.min(m, Math.max(0, src.r[i] * m));
    const y = Math.min(m, Math.max(0, src.g[i] * m));
    const z = Math.min(m, Math.max(0, src.b[i] * m));
    const x0 = Math.min(m - 1, x | 0), y0 = Math.min(m - 1, y | 0), z0 = Math.min(m - 1, z | 0);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      dens[((z0 + dz) * N + (y0 + dy)) * N + (x0 + dx)] += w;
    }
  }
  // 糊開兩輪，讓「有數據」的區域稍微向外延伸一點，邊界才不會是硬的
  const tmp = new Float32Array(dens.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let axis = 0; axis < 3; axis++) {
      tmp.set(dens);
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i0 = (z * N + y) * N + x;
        let a2 = 0, c = 0;
        for (let d = -1; d <= 1; d++) {
          const xx = axis === 0 ? x + d : x, yy = axis === 1 ? y + d : y, zz = axis === 2 ? z + d : z;
          if (xx < 0 || yy < 0 || zz < 0 || xx >= N || yy >= N || zz >= N) continue;
          a2 += tmp[(zz * N + yy) * N + xx]; c++;
        }
        dens[i0] = a2 / c;
      }
    }
  }
  let maxD = 0;
  for (let i = 0; i < dens.length; i++) if (dens[i] > maxD) maxD = dens[i];
  const thr = Math.max(1e-9, maxD * 0.0015);

  const data = new Float32Array(N * N * N * 3);
  const p: Rgb = [0, 0, 0], o: Rgb = [0, 0, 0], f: Rgb = [0, 0, 0];
  for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
    p[0] = ri / m; p[1] = gi / m; p[2] = bi / m;
    fn(p, o);
    fallback(p, f);
    const d = dens[(bi * N + gi) * N + ri];
    // 平滑過渡：密度越低越靠向 fallback
    const t = d / (d + thr);
    const w = t * t * (3 - 2 * t);
    const k2 = ((bi * N + gi) * N + ri) * 3;
    data[k2] = f[0] + (o[0] - f[0]) * w;
    data[k2 + 1] = f[1] + (o[1] - f[1]) * w;
    data[k2 + 2] = f[2] + (o[2] - f[2]) * w;
  }
  // 最後輕輕糊一次，抹掉經驗分布帶進來的雜訊
  const sm = new Float32Array(data.length);
  sm.set(data);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    for (let c = 0; c < 3; c++) {
      let a2 = 0, cnt = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, zz = z + dz;
        if (xx < 0 || yy < 0 || zz < 0 || xx >= N || yy >= N || zz >= N) continue;
        a2 += sm[((zz * N + yy) * N + xx) * 3 + c]; cnt++;
      }
      data[((z * N + y) * N + x) * 3 + c] = a2 / cnt;
    }
  }
  return { size: N, data };
}

function sampleLut(lut: Lut3D, r: number, g: number, b: number, out: Rgb): void {
  const N = lut.size, m = N - 1;
  const x = Math.min(m, Math.max(0, r * m)), y = Math.min(m, Math.max(0, g * m)), z = Math.min(m, Math.max(0, b * m));
  const x0 = Math.min(m - 1, x | 0), y0 = Math.min(m - 1, y | 0), z0 = Math.min(m - 1, z | 0);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const at = (xi: number, yi: number, zi: number, c: number) => lut.data[((zi * N + yi) * N + xi) * 3 + c];
  for (let c = 0; c < 3; c++) {
    const c00 = at(x0, y0, z0, c) * (1 - fx) + at(x0 + 1, y0, z0, c) * fx;
    const c10 = at(x0, y0 + 1, z0, c) * (1 - fx) + at(x0 + 1, y0 + 1, z0, c) * fx;
    const c01 = at(x0, y0, z0 + 1, c) * (1 - fx) + at(x0 + 1, y0, z0 + 1, c) * fx;
    const c11 = at(x0, y0 + 1, z0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, z0 + 1, c) * fx;
    out[c] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  }
}

// ---------------------------------------------------------------------------
// 膚色保護
// ---------------------------------------------------------------------------
/**
 * 在 YCbCr 的 Cb/Cr 平面上放兩個高斯：一個給膚色、一個給唇色，取比較像的那一個。
 * 嘴唇比皮膚紅、彩度也高，用同一個高斯罩不住；分開放才不會調完之後嘴唇變色。
 *
 * 回傳 0～1 的連續值而不是硬邊界 —— 硬邊界會在臉與嘴唇的邊緣留下一圈色差。
 * 太暗、太亮的像素本來就判不準，另外用亮度把權重收掉。
 */
export function skinProbability(r: number, g: number, b: number): number {
  const R = r * 255, G = g * 255, B = b * 255;
  const Y = 0.299 * R + 0.587 * G + 0.114 * B;
  const Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
  const Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
  const gauss = (mCb: number, mCr: number, vCb: number, vCr: number, cov: number) => {
    const dCb = Cb - mCb, dCr = Cr - mCr;
    const det = vCb * vCr - cov * cov;
    return Math.exp(-0.5 * (vCr * dCb * dCb - 2 * cov * dCb * dCr + vCb * dCr * dCr) / det);
  };
  // 膚色：涵蓋各種膚色，不是只有淺膚
  const skin = gauss(110.0, 152.0, 210.0, 130.0, -70.0);
  // 唇色：Cr 更高、Cb 更低，範圍收緊一點免得把磚牆之類的一起吃進來
  const lip = gauss(108.0, 172.0, 90.0, 150.0, -40.0);
  const ly = Y / 255;
  const gate = Math.min(1, Math.max(0, (ly - 0.08) / 0.12)) * Math.min(1, Math.max(0, (0.98 - ly) / 0.10));
  return Math.min(1, Math.max(0, Math.max(skin, lip) * gate));
}

// ---------------------------------------------------------------------------
// 套用
// ---------------------------------------------------------------------------
export type ApplyOptions = {
  /** 0～1，整體強度 */
  strength: number;
  /** 0～1，膚色保護：越高，膚色的色相／彩度越保留原本的 */
  skinProtect: number;
  /** 保留原圖亮度，只換顏色 */
  preserveLuminance?: boolean;
  /**
   * 防斷層用的空間保護遮罩（utils/protectMask 算好的）。
   * 給了就用遮罩上的權重，沒給就退回原本「只看這一顆像素的顏色」的判斷 ——
   * 兩條路的其餘計算完全一樣，所以不給遮罩時結果跟以前一位元不差。
   */
  protect?: ProtectLike | null;
  /** 有 protect 時必填：data 的寬（要換算 x / y 才取樣得到遮罩） */
  width?: number;
};

/** 只取 applyLut 需要的欄位，免得 colorTransfer 反過來相依 protectMask */
export type ProtectLike = {
  w: number;
  h: number;
  skin: Float32Array;
  red: Float32Array;
};

/**
 * 飽和度的天花板。這是「上限」不是「打折」：沒有超過的顏色一個位元都不動，
 * 只有超過的才等比例拉回來（a、b 一起縮，所以色相不變，只是變淡）。
 *
 * 三個數字各管一件事，缺一不可 —— 這是實際拿照片量出來的：
 *
 *  MAX_SAT_ROOM  一顆原本近乎無彩的像素，最多可以被染到多濃。
 *                量過的照片裡，正常的色調偏移會把中性色推到彩度 15～25，
 *                所以 30 剛好在正常範圍之上；設 14 會把整片灰牆的正常上色
 *                誤判成過飽和（有張照片被誤傷了 49% 的像素）。
 *
 *  MAX_SAT_RATIO 一顆像素最多可以是自己原本彩度的幾倍。
 *                量出來「整張一起變濃」這種正常結果，倍數大約落在 2.0 以下；
 *                真的爆掉的個案是 2.5～7.3。所以門檻壓在 2.5 這個空隙上，
 *                正常的仿色完全不受影響。
 *
 *  MAX_SAT_FRACTION  不管原本多濃，都不准被「推」超過「這個色相在 sRGB 裡
 *                    最濃能到多濃」的幾成。單靠倍數擋不住嘴唇那種本來就有
 *                    顏色、又被推成螢光的情況（彩度 114）。
 *
 *                    這裡刻意不用固定的數字。各色相在 sRGB 能到的最高彩度
 *                    差很多（青 44、紅 105、藍 134），所以同一個絕對值
 *                    對不同顏色鬆緊完全不同 —— 上限訂 85 的話，紅色可以到
 *                    滿格的 81%、橙色 99%（等於沒限制），洋紅卻只有 74%。
 *                    紅色因此看起來比洋紅濃得多。改成「一律最多到該色相的
 *                    74% 滿格」，鬆緊才對所有顏色一致。
 *
 * 最後再取 max(原本彩度, …)，確保這道保護永遠只會擋「變更濃」，
 * 不會反過來把本來就很濃的顏色弄淡。
 */
export const MAX_SAT_RATIO = 2.5;
export const MIN_SAT_ROOM = 30;
export const MAX_SAT_FRACTION = 0.74;

/**
 * sRGB 每個色相能到的最高彩度，每 10 度一格（離線算好的：色域最外圈就在
 * RGB 立方體「一個通道 0、一個通道 255」的那六條稜上，見 scratchpad/gamut.mjs）。
 * 最低 43.9（藍青之間）、最高 133.8（藍）。
 */
export const GAMUT_C = [
  86.5, 85.5, 89.8, 98.2, 104.6, 97.3, 88.2, 83.7, 84.3,
  89.6, 97.0, 99.6, 106.1, 118.1, 119.8, 97.2, 79.4, 67.3,
  59.2, 53.8, 50.5, 46.8, 44.5, 43.9, 45.5, 48.5, 53.5,
  61.3, 73.6, 93.5, 127.8, 133.8, 121.6, 116.1, 103.1, 92.2,
];

/** 這個色相在 sRGB 裡最濃能到多濃（查表 + 線性內插） */
export function gamutChroma(a: number, b: number): number {
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  const x = h / 10;
  const i0 = Math.floor(x) % 36;
  const w = x - Math.floor(x);
  return GAMUT_C[i0] * (1 - w) + GAMUT_C[(i0 + 1) % 36] * w;
}

/** 算出這顆像素的彩度上限。a、b 是「套色之後」的，因為要限的是它 */
export function satCeiling(chromaIn: number, a: number, b: number): number {
  const cap = gamutChroma(a, b) * MAX_SAT_FRACTION;
  return Math.max(chromaIn, Math.min(chromaIn * MAX_SAT_RATIO, cap), MIN_SAT_ROOM);
}

/* ---------------------------------------------------------------------------
   紅色的兩道額外限制

   紅色是最容易出事的顏色：稍微降一點彩度就整個變濁，稍微往洋紅偏一點就
   從「紅」變成「桃紅」，兩者都很顯眼。所以另外給它兩條規矩：

     一、要降彩度可以，但最多只能降到原本的 RED_MIN_SAT。
     二、色相要往洋紅偏可以，但偏的程度打 (1 - RED_HUE_DAMP) 折。

   關鍵在於這兩條**不能只套在「是紅色」的像素上**。用一個硬邊界去分
   「紅／不紅」，邊界兩側的像素會被完全不同地處理，紅橘漸層上就會出現
   一條看得見的接縫。所以改用一個連續的權重：離純紅越遠影響越小，
   在 RED_SPAN 度之外剛好歸零，而且是用升餘弦 —— 邊緣的斜率也是 0，
   接得上就不會有斷層。

   另外灰色的色相是雜訊（彩度接近 0 時 atan2 會亂跳），所以彩度低的時候
   權重也要淡出，不然一片灰牆上會冒出隨機的紅色斑點。                    */

/** Lab 裡 sRGB 純紅的色相角 */
export const RED_HUE = 40;
/** 離純紅這麼多度之內算「完全是紅」，這一段拿滿保護 */
export const RED_CORE = 15;
/** 再往外到這裡權重才歸零，中間用升餘弦接 —— 兩個接點的斜率都是 0，不會有接縫 */
export const RED_SPAN = 38;
/** 紅色的彩度最多只能被降到原本的幾成 */
export const RED_MIN_SAT = 0.90;
/** 紅色往洋紅偏的程度要打幾折 */
export const RED_HUE_DAMP = 0.30;
/** 彩度低到這個以下就當作沒有可信的色相 */
export const HUE_GATE_C = 10;
/** 色相「往洋紅偏」的判斷要在這麼大的角度內平滑接起來（弧度，約 6 度） */
export const HUE_SOFT = (Math.PI * 6) / 180;   // 6 度 ＝ 0.10472
/** 平滑 max 的圓角大小（Lab 彩度單位）—— 只影響轉折附近，別處完全一樣 */
export const SOFT_MAX_K = 1.5;

/** 0～1 的平滑階梯（兩端斜率都是 0） */
export function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * 平滑版的 max。
 * 一般的 max 在兩條線交會的地方是一個尖角：值接得上，但斜率突然改變。
 * 影像上只要那個尖角落在一片漸層裡，就會看到一條「折線」——
 * 強度拉大時更明顯。這一版把尖角換成半徑 k 的圓角，處處可微。
 */
export function softMax(a: number, b: number, k: number): number {
  if (k <= 0) return Math.max(a, b);
  const d = a - b;
  return 0.5 * (a + b + Math.sqrt(d * d + k * k)) - k / 2;
}

/** 這顆像素有多「紅」（0～1，連續、邊緣平滑） */
export function redWeight(a: number, b: number): number {
  const c = Math.hypot(a, b);
  if (c <= 0) return 0;
  let d = Math.atan2(b, a) * (180 / Math.PI) - RED_HUE;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  d = Math.abs(d);
  if (d >= RED_SPAN) return 0;
  const w = d <= RED_CORE ? 1 : 0.5 * (1 + Math.cos(Math.PI * (d - RED_CORE) / (RED_SPAN - RED_CORE)));
  const t = Math.min(1, c / HUE_GATE_C);
  return w * t * t * (3 - 2 * t);
}

/** 雙線性取樣，讓縮圖尺寸的保護遮罩對得回任何解析度 */
export function sampleMaskAt(
  m: Float32Array, mw: number, mh: number, u: number, v: number,
): number {
  const x = u * mw - 0.5, y = v * mh - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const cx = (i: number) => (i < 0 ? 0 : i > mw - 1 ? mw - 1 : i);
  const cy = (j: number) => (j < 0 ? 0 : j > mh - 1 ? mh - 1 : j);
  const r0 = cy(y0) * mw, r1 = cy(y0 + 1) * mw;
  const c0 = cx(x0), c1 = cx(x0 + 1);
  const a = m[r0 + c0] + (m[r0 + c1] - m[r0 + c0]) * fx;
  const b = m[r1 + c0] + (m[r1 + c1] - m[r1 + c0]) * fx;
  return a + (b - a) * fy;
}

/**
 * 膚色保護刻意只鎖「顏色」不鎖「亮度」：
 * 臉還是要跟著整體的明暗走，不然人會像貼上去的。
 */
export function applyLut(
  data: Uint8ClampedArray,
  lut: Lut3D,
  opt: ApplyOptions,
): void {
  const out: Rgb = [0, 0, 0];
  const labIn: number[] = [0, 0, 0], labOut: number[] = [0, 0, 0], rgb: number[] = [0, 0, 0];
  /* 強度上限放到 2（介面上的 200）。
     最後那一步是線性內插 src + (res - src) * s —— s 超過 1 就是「往參考圖的
     方向再多走一段」，也就是外插。原本夾在 1，滑桿推過 100 完全沒反應。
     寫進 Uint8ClampedArray 時本來就會夾回 0～255；GPU 那條走的是同一個 mix，
     兩邊結果一致。 */
  const s = Math.min(2, Math.max(0, opt.strength));
  const sp = Math.min(1, Math.max(0, opt.skinProtect));
  /* 防斷層遮罩：算的時候用的是縮圖（遮罩本來就很平滑），這裡雙線性取樣回來。
     遮罩裡的權重已經做過補洞與羽化，所以臉上那塊偏青的皮膚也一起受保護，
     交界不再是一條硬邊。沒有遮罩的話下面兩行就退回原本的逐像素判斷。 */
  const pm = opt.protect || null;
  const iw = opt.width || 0;
  const useMask = !!pm && iw > 0 && pm.w > 0 && pm.h > 0;
  const ih = useMask ? Math.max(1, Math.round(data.length / 4 / iw)) : 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    let mSkin = 0, mRed = -1;
    if (useMask) {
      const k = i >> 2;
      const u = ((k % iw) + 0.5) / iw, v = (((k / iw) | 0) + 0.5) / ih;
      mSkin = sampleMaskAt(pm!.skin, pm!.w, pm!.h, u, v);
      mRed = sampleMaskAt(pm!.red, pm!.w, pm!.h, u, v);
    }
    sampleLut(lut, r, g, b, out);
    let R = out[0], G = out[1], B = out[2];
    // 天花板一定要在 Lab 算，所以這一段不再是可選的
    {
      rgbToLab(r, g, b, labIn);
      rgbToLab(R, G, B, labOut);
      let L = labOut[0], A = labOut[1], BB = labOut[2];
      if (opt.preserveLuminance) L = labIn[0];
      if (sp > 0) {
        const w = 1 - sp * (useMask ? mSkin : skinProbability(r, g, b));
        A = labIn[1] + (A - labIn[1]) * w;
        BB = labIn[2] + (BB - labIn[2]) * w;
      }
      // 紅色的兩道限制。權重用「原圖」的色相算 —— 原圖的色相在畫面上是
      // 連續變化的，這樣權重才會跟著連續變化，不會有接縫
      const cIn = Math.hypot(labIn[1], labIn[2]);
      const rw = mRed >= 0 ? mRed : redWeight(labIn[1], labIn[2]);
      if (rw > 0) {
        // 一、往洋紅偏的部分打折（洋紅在紅的「下面」，所以差值是負的那一邊）
        const cNow = Math.hypot(A, BB);
        if (cNow > 1e-6 && cIn > 1e-6) {
          const hIn = Math.atan2(labIn[2], labIn[1]);
          let d = Math.atan2(BB, A) - hIn;
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          /* 以前是 if (d < 0) 才打折 —— 那是一刀切：d 從 +0.001 變成 -0.001，
             處理方式整個換一套。值本身雖然接得上，但斜率是斷的，
             強度拉到 200 會把這個轉折放大兩倍，畫面上就看得到一條硬邊。
             改成用一小段角度平滑地把「要不要打折」接起來（d 在 0 到 -HUE_SOFT
             之間慢慢生效），處處連續、斜率也連續。 */
          const gate = smoothstep01(-d / HUE_SOFT);
          const h2 = hIn + d * (1 - RED_HUE_DAMP * rw * gate);
          A = Math.cos(h2) * cNow; BB = Math.sin(h2) * cNow;
        }
        /* 二、彩度最多只能降到原本的 RED_MIN_SAT。
           要注意這裡是把「有擋」與「沒擋」兩個結果依權重混合，不是去調門檻本身 ——
           拿權重去乘門檻的話，權重再小門檻都還是接近原本的彩度，於是權重 0.001 的
           像素也會被整個拉回去，紅色範圍的邊界上就會出現一條很明顯的接縫
           （量到過 27 個 Lab 單位的跳動）。 */
        const want = Math.hypot(A, BB);
        /* 以前這裡是 Math.max —— 值連續但轉折處斜率是斷的，強度放大之後
           在「剛好開始被托住」的那條線上會看到一道硬邊。
           改用平滑版的 max（雙曲線接角），差別只在轉折附近幾個 Lab 單位，
           其餘完全一樣。 */
        const held = softMax(want, cIn * RED_MIN_SAT, SOFT_MAX_K);
        const cFinal = want + (held - want) * rw;
        if (cFinal > want) {
          if (want > 1e-3) { const k = cFinal / want; A *= k; BB *= k; }
          else if (cIn > 1e-6) { const k = cFinal / cIn; A = labIn[1] * k; BB = labIn[2] * k; }
        }
      }
      // 飽和度天花板：超過上限的才拉回來，沒超過的不動。
      // 放在最後，所以上面拉高的部分也一樣受它管
      const cOut = Math.hypot(A, BB);
      const lim = satCeiling(cIn, A, BB);
      if (cOut > lim && cOut > 1e-6) { const k = lim / cOut; A *= k; BB *= k; }

      /* 強度改成「在 Lab 裡混合」，而不是算完 RGB 再混。
         以前是先把結果夾進 sRGB、再用 RGB 做 src + (res - src) * s，
         強度超過 1 時等於把「已經被夾過的值」再往外拉，最後又被
         Uint8ClampedArray 夾一次 —— 兩次硬夾疊在一起，紅色那種本來就貼著
         色域邊緣的顏色會整片壓平，邊界就出現硬變。
         現在整條路上只在最後做一次「收彩度」的柔性壓縮。 */
      const Lf = labIn[0] + (L - labIn[0]) * s;
      const Af = labIn[1] + (A - labIn[1]) * s;
      const Bf = labIn[2] + (BB - labIn[2]) * s;
      labToRgbSoft(Lf, Af, Bf, rgb);
      R = rgb[0]; G = rgb[1]; B = rgb[2];
    }
    data[i] = R * 255;
    data[i + 1] = G * 255;
    data[i + 2] = B * 255;
  }
}
