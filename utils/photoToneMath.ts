/* 照片流程的整體色調和白平衡（編輯器、漸層遮罩、拼圖的照片特效）都用這一份實作。
   順序跟 RAW 處理軟體一樣：
   白平衡（線性光，Bradford LMS 的 von Kries）→ 曝光（線性光，±4 EV，帶亮部肩部）→ sRGB 編碼 →
   色調曲線：亮度（中間調 gamma）、對比（以中灰為中心的 S 曲線）、陰影／亮部（限定頻段，
   黑白兩端不動）、白色／黑色（Lightroom 式的端點，軟性限制）→
   飽和度（以亮度為中心；−100 是完全的單色）
   保留色相（Adobe DNG 的「RGB tone」做法）：曝光肩部和色調曲線套在最大和最小的通道上，
   中間的通道維持它在兩者之間的相對位置。逐通道套曲線會讓色相跑掉（對比 +100 讓膚色往黃偏 13.6°，
   曝光 +60 讓橘色偏 39°）；這樣做每個顏色的色相都不變，而且處處連續（不產生新的邊，所以不會有色階斷層）。
   每個階段在 0 時都不改變，而且 0→0、1→1（黑不會變灰、白不會變灰，範圍內也不硬切）。
   產品決定刻意保留的行為：陰影 + 讓陰影更暗、− 讓陰影變亮；色調 + 偏綠 */

export type ToneParams = {
  exposure: number; brightness: number; contrast: number;
  shadows: number; highlights: number; temp: number; tint: number; sat: number;
  /** Lightroom 白色色階／黑色色階（−100…100），沒給就是 0 */
  whites?: number; blacks?: number;
};

/**
 * 對一個顏色就地套用單調曲線 f 並保留色相（DNG 參考的「RGB tone」）：f 套在最大和最小的通道上，
 * 中間的通道用內插，讓 (mid−min)/(max−min)（也就是色相）不變。灰色（三個通道相同）剛好得到 f。
 * 對 r、g、b 都是連續的
 */
export const hueTone = (f: (v: number) => number, c: Float32Array | Float64Array | number[]) => {
  const r = c[0], g = c[1], b = c[2];
  if (r >= g) {
    if (g >= b) { const hi = f(r), lo = f(b); c[0] = hi; c[2] = lo; c[1] = r > b ? lo + (hi - lo) * (g - b) / (r - b) : hi; }
    else if (r >= b) { const hi = f(r), lo = f(g); c[0] = hi; c[1] = lo; c[2] = r > g ? lo + (hi - lo) * (b - g) / (r - g) : hi; }
    else { const hi = f(b), lo = f(g); c[2] = hi; c[1] = lo; c[0] = b > g ? lo + (hi - lo) * (r - g) / (b - g) : hi; }
  } else {
    if (r >= b) { const hi = f(g), lo = f(b); c[1] = hi; c[2] = lo; c[0] = g > b ? lo + (hi - lo) * (r - b) / (g - b) : hi; }
    else if (g >= b) { const hi = f(g), lo = f(r); c[1] = hi; c[0] = lo; c[2] = g > r ? lo + (hi - lo) * (b - r) / (g - r) : hi; }
    else { const hi = f(b), lo = f(r); c[2] = hi; c[0] = lo; c[1] = b > r ? lo + (hi - lo) * (g - r) / (b - r) : hi; }
  }
};

/* ── 自然飽和度（膚色保護）────────────────────────────────────────────
   Lightroom 的自然飽和度會刻意少加膚色。這裡用平滑的窗（smoothstep，沒有任何硬邊）
   量「這個顏色像不像膚色」：色相落在偏紅橘一帶（HSV 約 −12°～55°，5°～38° 完全算）、
   飽和度中等（太灰或太艷的都不算）、而且不是接近黑。像膚色的部分加的量只剩 30%。
   權重是平滑連續的，所以漸層、膚色與背景的交界都不會出現色塊或斷層。 */
const sstep = (a: number, b: number, x: number) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
export const SKIN_PROTECT = 0.7;
/** 0…1：這個顏色（0…255）有多像膚色 */
export const skinWeight = (r: number, g: number, b: number) => {
  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const ch = mx - mn;
  if (mx <= 0 || ch <= 0) return 0;
  const s = ch / mx;
  let h = mx === r ? 60 * ((g - b) / ch) : mx === g ? 60 * ((b - r) / ch + 2) : 60 * ((r - g) / ch + 4);
  if (h > 180) h -= 360;                       // 洋紅那一側算成負角度，跟紅色連續
  const hueW = sstep(-12, 5, h) * (1 - sstep(38, 55, h));
  const satW = sstep(0.06, 0.15, s) * (1 - sstep(0.6, 0.85, s));
  return hueW * satW * sstep(0.03, 0.1, mx / 255);
};
/** 自然飽和度的倍率（繞著平均值放大色度）。r,g,b：0…255；vib：滑桿 /200（遮色片會再乘 2.5）。
 *  正值：越不飽和加越多、像膚色的少加；負值照舊。 */
export const vibranceGain = (vib: number, r: number, g: number, b: number) => {
  if (!vib) return 1;
  if (vib < 0) return Math.max(0, 1 + vib);   // 遮色片的倍率可以超過 1：不能反轉成補色
  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const s = mx === 0 ? 0 : (mx - mn) / mx;
  return 1 + vib * (1 - s * s) * (1 - SKIN_PROTECT * skinWeight(r, g, b));
};

const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
export const srgbToLinear = (v: number) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
export const linearToSrgb = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

/** 滑桿（−100…100）→ EV。越靠近 0 越細：±25 ≈ ±0.55 EV、±50 ≈ ±1.4 EV、±100 = ±4 EV */
export const exposureEv = (v: number) => { const t = Math.max(-1, Math.min(1, v / 100)); return 4 * t * (0.4 + 0.6 * Math.abs(t)); };

/* 白平衡 */
const BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];
const SRGB_TO_XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
const XYZ_TO_SRGB = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252];
const mul = (a: number[], b: number[]) => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const apply3 = (m: number[], x: number, y: number, z: number) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
/** 普朗克軌跡（Kim 等人的三次式），1667～25000 K → CIE xy */
const planckXy = (t: number) => {
  t = Math.max(1667, Math.min(25000, t));
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.179910
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.240390;
  const y = t <= 2222 ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : t <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
    : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
};
const D65_MIRED = 1e6 / 6504;
/**
 * 把假設的場景白點調到 D65 的線性 sRGB 3×3 矩陣。色溫 + 變暖、色調 + 偏綠（保留原本的方向），
 * 兩者都是 ±100；白色的亮度不變
 */
export const whiteBalanceMatrix = (temp: number, tint: number): number[] | null => {
  if (!temp && !tint) return null;
  // 假設的光源：越冷（K 越高），修正就越暖
  const mired = Math.max(40, D65_MIRED - (temp / 100) * 45);
  const k = 1e6 / mired;
  const [x0, y0] = planckXy(k), [x1, y1] = planckXy(k * 1.01);
  // 軌跡在 xy 上的單位法向量，指向綠色（+y 那一側）
  let nx = -(y1 - y0), ny = x1 - x0; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl; if (ny < 0) { nx = -nx; ny = -ny; }
  // 假設的光源偏洋紅，修正就偏綠
  const off = -(tint / 100) * 0.015;
  const sx = x0 + nx * off, sy = y0 + ny * off;
  const srcXYZ = [sx / sy, 1, (1 - sx - sy) / sy];
  const dstXYZ = [0.95047, 1, 1.08883];
  const sL = apply3(BRADFORD, srcXYZ[0], srcXYZ[1], srcXYZ[2]), dL = apply3(BRADFORD, dstXYZ[0], dstXYZ[1], dstXYZ[2]);
  const gain = [dL[0] / sL[0], 0, 0, 0, dL[1] / sL[1], 0, 0, 0, dL[2] / sL[2]];
  let m = mul(XYZ_TO_SRGB, mul(BRADFORD_INV, mul(gain, mul(BRADFORD, SRGB_TO_XYZ))));
  // 白色的亮度不變，只改光的顏色
  const w = apply3(m, 1, 1, 1), yw = 0.2126 * w[0] + 0.7152 * w[1] + 0.0722 * w[2];
  m = m.map(v => v / yw);
  return m;
};

/* 色調曲線（在 sRGB 編碼後的範圍，逐通道） */
const TONE_SIZE = 1024;
const PIVOT = 0.46;                 // 編碼後的 18% 灰
/**
 * 曝光後的亮部肩部：轉折點以下不變，最亮的輸入（2^EV）平滑地對到 1，斜率連續
 */
const KNEE = 0.55;
/** 把 [knee, peak] 平滑地對到 [knee, 1]（轉折點斜率為 1，單調） */
const softTop = (x: number, knee: number, peak: number) => {
  if (peak <= 1 || x <= knee) return x;
  const a = (peak - 1) / (1 - knee), t = (x - knee) / (peak - knee);
  return knee + (1 - knee) * Math.min(1, ((1 + a) * t) / (1 + a * t));
};
const shoulder = (x: number, peak: number) => softTop(x, KNEE, peak);
/* 白色／黑色色階的幅度（編碼值）：白 +100 把最亮的那一段往上推 0.25 再柔和地收進 1
   （不硬切成一片死白）；白 −100 把白點壓到 0.9。黑 −100 把最暗的一段往下壓 0.25
   再柔和地收到 0；黑 +100 把黑點抬到 0.1。整條曲線單調、斜率連續。 */
const WHITES_UP = 0.25, WHITES_DOWN = 0.1, BLACKS_DOWN = 0.25, BLACKS_UP = 0.1;
const endPoints = (x: number, w: number, k: number) => {
  if (w) {
    x += w * (w > 0 ? WHITES_UP : WHITES_DOWN) * x * x * x * x;
    if (w > 0) x = softTop(x, 0.85, 1 + w * WHITES_UP);
  }
  if (k) {
    const u = 1 - x;
    x += k * (k > 0 ? BLACKS_UP : BLACKS_DOWN) * u * u * u * u;
    if (k < 0) x = 1 - softTop(1 - x, 0.85, 1 - k * BLACKS_DOWN);
  }
  return x;
};
const SH_GAIN = 0.85;               // < 1 曲線才會單調
const shadowBand = (x: number) => x * (1 - x) ** 3 / 0.10546875;     // 在 x = 0.25 時最大值為 1
const highlightBand = (x: number) => x ** 3 * (1 - x) / 0.10546875;  // 在 x = 0.75 時最大值為 1

export type ToneStage = {
  /** 編碼值（0…1）→ 編碼值，逐通道；不改變時回傳 null */
  tone: Float32Array | null;
  ev: number; peak: number;
  wb: number[] | null;
  sat: number;
};
/**
 * reuseTone：同樣亮度、對比、陰影、亮部已經做好的色調表（不用重做）
 */
/**
 * 陰影／亮部對一個編碼值造成的變化（整體曲線逐通道加上它；utils/localTone 把它套在局部的基底上）
 */
export const shDelta = (x: number, s: number, h: number) =>
  (s ? -s * SH_GAIN * 0.105 * shadowBand(x) : 0) + (h ? h * SH_GAIN * 0.105 * highlightBand(x) : 0);
/**
 * noSH：色調表裡不含陰影／亮部（改成在局部套，見 utils/localTone）
 */
export const makeToneStage = (p: ToneParams, reuseTone?: Float32Array | null, noSH = false): ToneStage => {
  const ev = exposureEv(p.exposure || 0), wb = whiteBalanceMatrix(p.temp || 0, p.tint || 0);
  // 白平衡和曝光之後白色能到的最大線性值：由肩部收進 1，不會切掉某個通道
  const wbPeak = wb ? Math.max(wb[0] + wb[1] + wb[2], wb[3] + wb[4] + wb[5], wb[6] + wb[7] + wb[8]) : 1;
  const peak = wbPeak * Math.pow(2, ev);
  const b = (p.brightness || 0) / 100, c = (p.contrast || 0) / 100;
  const s = noSH ? 0 : (p.shadows || 0) / 100, h = noSH ? 0 : (p.highlights || 0) / 100;
  const wh = (p.whites || 0) / 100, bk = -(p.blacks || 0) / 100; // 黑色：滑桿往右＝黑的更深、往左＝變淡（跟 Lightroom 相反，照主人的手感）
  let tone: Float32Array | null = null;
  if (reuseTone !== undefined) tone = reuseTone;
  else if (b || c || s || h || wh || bk) {
    tone = new Float32Array(TONE_SIZE + 1);
    const gamma = Math.pow(2, -b * 0.8);              // 亮度：中間調 gamma
    const g = Math.pow(2, c * (c > 0 ? 0.9 : 0.6));   // 對比：支點的 S 曲線陡度
    for (let i = 0; i <= TONE_SIZE; i++) {
      let x = i / TONE_SIZE;
      if (b) x = Math.pow(x, gamma);
      if (c) x = x < PIVOT ? PIVOT * Math.pow(x / PIVOT, g) : 1 - (1 - PIVOT) * Math.pow((1 - x) / (1 - PIVOT), g);
      // 陰影：+ 變暗、− 變亮（保留原本的方向）。亮部：+ 變亮、− 救回細節
      if (s) x += shDelta(x, s, 0);
      if (h) x += shDelta(x, 0, h);
      if (wh || bk) x = endPoints(x, wh, bk);
      tone[i] = clamp01(x);
    }
  }
  const sv = (p.sat || 0) / 100;
  return { tone, ev, peak, wb, sat: sv < 0 ? 1 + sv : 1 + 0.8 * sv };
};
export const toneStageIsIdentity = (t: ToneStage) => !t.tone && !t.ev && !t.wb;

export const lookup = (t: Float32Array, x: number) => {
  const f = clamp01(x) * TONE_SIZE, i = f | 0;
  return i >= TONE_SIZE ? t[TONE_SIZE] : t[i] + (t[i + 1] - t[i]) * (f - i);
};

/**
 * 一個顏色的白平衡、曝光和色調（0…255 的 sRGB 浮點數），寫進 out[0..2]。飽和度另外算（在曲線之後）
 */
export const applyToneStage = (t: ToneStage, r: number, g: number, b: number, out: Float32Array | number[]) => {
  let x = r / 255, y = g / 255, z = b / 255;
  if (t.wb || t.ev) {
    x = srgbToLinear(x); y = srgbToLinear(y); z = srgbToLinear(z);
    if (t.wb) { const m = t.wb; const a = m[0] * x + m[1] * y + m[2] * z, bb = m[3] * x + m[4] * y + m[5] * z, cc = m[6] * x + m[7] * y + m[8] * z; x = a; y = bb; z = cc; }
    if (t.ev) { const k = Math.pow(2, t.ev); x *= k; y *= k; z *= k; }
    const v = HT; v[0] = Math.max(0, x); v[1] = Math.max(0, y); v[2] = Math.max(0, z);
    if (t.peak > 1) { const pk = t.peak; hueTone(q => shoulder(q, pk), v); }
    x = linearToSrgb(clamp01(v[0])); y = linearToSrgb(clamp01(v[1])); z = linearToSrgb(clamp01(v[2]));
  }
  if (t.tone) { const v = HT, tt = t.tone; v[0] = clamp01(x); v[1] = clamp01(y); v[2] = clamp01(z); hueTone(q => lookup(tt, q), v); x = v[0]; y = v[1]; z = v[2]; }
  out[0] = clamp01(x) * 255; out[1] = clamp01(y) * 255; out[2] = clamp01(z) * 255;
};
const HT = new Float64Array(3);

/**
 * 以亮度為中心調飽和度（0…255 浮點數，就地修改）。k = ToneStage.sat：0 是完全的單色；
 * 彩度用縮的（不切掉），保持在色域內
 */
export const applySaturation = (k: number, c: Float32Array | number[]) => {
  if (k === 1) return;
  const x = c[0], y = c[1], z = c[2], l = 0.2126 * x + 0.7152 * y + 0.0722 * z;
  if (k > 1) {
    // 讓每個通道都留在 0…255 內的最大 k
    let d = x - l; if (d > 0 && d * k > 255 - l) k = (255 - l) / d; else if (d < 0 && d * k < -l) k = l / -d;
    d = y - l; if (d > 0 && d * k > 255 - l) k = (255 - l) / d; else if (d < 0 && d * k < -l) k = l / -d;
    d = z - l; if (d > 0 && d * k > 255 - l) k = (255 - l) / d; else if (d < 0 && d * k < -l) k = l / -d;
  }
  c[0] = l + (x - l) * k; c[1] = l + (y - l) * k; c[2] = l + (z - l) * k;
};

/**
 * 給迴圈用的查表版 applyToneStage（每個顏色不必算 pow）。輸入 0…255（可以有小數），
 * 跟 applyToneStage 的差距約 0.01
 */
const LIN_SIZE = 4096;
let LIN: Float32Array | null = null;
export const makeToneFast = (t: ToneStage) => {
  if (!LIN) { LIN = new Float32Array(LIN_SIZE + 1); for (let i = 0; i <= LIN_SIZE; i++) LIN[i] = srgbToLinear(i / LIN_SIZE); }
  const lin = LIN;
  const toLin = (v: number) => { const f = (v < 0 ? 0 : v > 255 ? 255 : v) * (LIN_SIZE / 255), i = f | 0; return i >= LIN_SIZE ? lin[LIN_SIZE] : lin[i] + (lin[i + 1] - lin[i]) * (f - i); };
  const N = 2048, maxIn = Math.max(1, t.peak), k = t.ev ? Math.pow(2, t.ev) : 1;
  // 三個保留色相的階段，各是一張表：線性（白平衡和曝光之後）→ 肩部（線性）→ 編碼 → 色調曲線。
  // 肩部和色調要經過 hueTone（最大／最小通道），所以各自一張表；編碼是逐通道的
  const sh = new Float32Array(N + 1), enc = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    // 用平方根的間距：線性光的陰影部分取樣比較密
    sh[i] = clamp01(shoulder((i / N) ** 2 * maxIn, t.peak));
    enc[i] = linearToSrgb((i / N) ** 2);
  }
  const shAt = (v: number) => { if (v <= 0) return sh[0]; const f = Math.sqrt(v / maxIn) * N; if (f >= N) return sh[N]; const i = f | 0; return sh[i] + (sh[i + 1] - sh[i]) * (f - i); };
  const encAt = (v: number) => { if (v <= 0) return 0; const f = Math.sqrt(v) * N; if (f >= N) return enc[N]; const i = f | 0; return enc[i] + (enc[i + 1] - enc[i]) * (f - i); };
  const tone = t.tone, hasSh = t.peak > 1;
  const toneAt = tone ? (v: number) => lookup(tone, v) : null;
  const m = t.wb;
  const v3 = new Float64Array(3);
  /** r、g、b：0…255；把 0…255 的浮點數寫進 c */
  const apply = (r: number, g: number, b: number, c: Float32Array | number[]) => {
    let x = toLin(r), y = toLin(g), z = toLin(b);
    if (m) { const a = m[0] * x + m[1] * y + m[2] * z, bb = m[3] * x + m[4] * y + m[5] * z, cc = m[6] * x + m[7] * y + m[8] * z; x = a; y = bb; z = cc; }
    v3[0] = x * k; v3[1] = y * k; v3[2] = z * k;
    if (hasSh) hueTone(shAt, v3);
    v3[0] = encAt(clamp01(v3[0])); v3[1] = encAt(clamp01(v3[1])); v3[2] = encAt(clamp01(v3[2]));
    if (toneAt) hueTone(toneAt, v3);
    c[0] = v3[0] * 255; c[1] = v3[1] * 255; c[2] = v3[2] * 255;
  };
  /**
   * 給自己預先算線性網格的呼叫端用的 toLinear（sRGB 0…255 → 線性）和 wb（矩陣或 null），之後呼叫 applyLinear
   */
  const applyLinear = (x: number, y: number, z: number, c: Float32Array | number[]) => {
    v3[0] = x * k; v3[1] = y * k; v3[2] = z * k;
    if (hasSh) hueTone(shAt, v3);
    v3[0] = encAt(clamp01(v3[0])); v3[1] = encAt(clamp01(v3[1])); v3[2] = encAt(clamp01(v3[2]));
    if (toneAt) hueTone(toneAt, v3);
    c[0] = v3[0] * 255; c[1] = v3[1] * 255; c[2] = v3[2] * 255;
  };
  return Object.assign(apply, { toLinear: toLin, applyLinear, wb: m });
};
