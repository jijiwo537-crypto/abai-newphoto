/* Global tone & white balance for the photo pipeline (editor, gradient mask,
 * collage photo effects): one implementation, used everywhere.
 *
 * Order, as in raw processors:
 *   white balance (linear light, von Kries in Bradford LMS)
 *   → exposure (linear light, ±4 EV) with a highlight shoulder
 *   → sRGB encode
 *   → tone curve: brightness (mid-tone gamma), contrast (S-curve about
 *     mid-grey), shadows / highlights (band-limited, black and white fixed)
 *   → saturation (around luminance; −100 is exact monochrome)
 * Every stage is identity at 0 and keeps 0→0 and 1→1 (no lifted blacks,
 * no greyed whites, no hard clipping inside the range).
 *
 * Kept on purpose from the previous behaviour (product decision):
 *   shadows +  → darker shadows, −  → lifted shadows
 *   tint    +  → greener
 */

export type ToneParams = {
  exposure: number; brightness: number; contrast: number;
  shadows: number; highlights: number; temp: number; tint: number; sat: number;
};

const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
export const srgbToLinear = (v: number) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
export const linearToSrgb = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

/** Slider (−100…100) → EV. Finer near 0: ±25 ≈ ±0.55 EV, ±50 ≈ ±1.4 EV, ±100 = ±4 EV. */
export const exposureEv = (v: number) => { const t = Math.max(-1, Math.min(1, v / 100)); return 4 * t * (0.4 + 0.6 * Math.abs(t)); };

/* ── white balance ─────────────────────────────────────────────────────── */
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
/** Planckian locus (Kim et al. cubic), 1667–25000 K → CIE xy. */
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
/** Linear-sRGB 3×3 that adapts the assumed scene white to D65.
 *  temp + → warmer, tint + → greener (kept), both ±100. Luminance of white kept. */
export const whiteBalanceMatrix = (temp: number, tint: number): number[] | null => {
  if (!temp && !tint) return null;
  // Assumed illuminant: a cooler (higher K) one makes the correction warmer.
  const mired = Math.max(40, D65_MIRED - (temp / 100) * 45);
  const k = 1e6 / mired;
  const [x0, y0] = planckXy(k), [x1, y1] = planckXy(k * 1.01);
  // Unit normal to the locus in xy, pointing towards green (+y side).
  let nx = -(y1 - y0), ny = x1 - x0; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl; if (ny < 0) { nx = -nx; ny = -ny; }
  // A magenta-leaning assumed illuminant makes the correction greener.
  const off = -(tint / 100) * 0.015;
  const sx = x0 + nx * off, sy = y0 + ny * off;
  const srcXYZ = [sx / sy, 1, (1 - sx - sy) / sy];
  const dstXYZ = [0.95047, 1, 1.08883];
  const sL = apply3(BRADFORD, srcXYZ[0], srcXYZ[1], srcXYZ[2]), dL = apply3(BRADFORD, dstXYZ[0], dstXYZ[1], dstXYZ[2]);
  const gain = [dL[0] / sL[0], 0, 0, 0, dL[1] / sL[1], 0, 0, 0, dL[2] / sL[2]];
  let m = mul(XYZ_TO_SRGB, mul(BRADFORD_INV, mul(gain, mul(BRADFORD, SRGB_TO_XYZ))));
  // Keep the luminance of white: only the colour of the light changes.
  const w = apply3(m, 1, 1, 1), yw = 0.2126 * w[0] + 0.7152 * w[1] + 0.0722 * w[2];
  m = m.map(v => v / yw);
  return m;
};

/* ── tone curve (sRGB-encoded domain, per channel) ─────────────────────── */
const TONE_SIZE = 1024;
const PIVOT = 0.46;                 // encoded 18% grey
/** Highlight shoulder after exposure: identity below the knee, maps the
 *  brightest input (2^EV) smoothly onto 1 with slope continuity. */
const KNEE = 0.55;
const shoulder = (x: number, peak: number) => {
  if (peak <= 1 || x <= KNEE) return x;
  const a = (peak - 1) / (1 - KNEE), t = (x - KNEE) / (peak - KNEE);
  return KNEE + (1 - KNEE) * Math.min(1, ((1 + a) * t) / (1 + a * t));
};
const SH_GAIN = 0.85;               // < 1 keeps the curve monotonic
const shadowBand = (x: number) => x * (1 - x) ** 3 / 0.10546875;     // peak 1 at x = 0.25
const highlightBand = (x: number) => x ** 3 * (1 - x) / 0.10546875;  // peak 1 at x = 0.75

export type ToneStage = {
  /** encoded (0…1) → encoded, per channel; null when identity */
  tone: Float32Array | null;
  ev: number; peak: number;
  wb: number[] | null;
  sat: number;
};
/** reuseTone: a tone table already built for the same brightness /
 *  contrast / shadows / highlights (skips rebuilding it). */
export const makeToneStage = (p: ToneParams, reuseTone?: Float32Array | null): ToneStage => {
  const ev = exposureEv(p.exposure || 0), wb = whiteBalanceMatrix(p.temp || 0, p.tint || 0);
  // Brightest linear value white can reach after WB and exposure: the shoulder
  // rolls it into 1 instead of clipping a channel.
  const wbPeak = wb ? Math.max(wb[0] + wb[1] + wb[2], wb[3] + wb[4] + wb[5], wb[6] + wb[7] + wb[8]) : 1;
  const peak = wbPeak * Math.pow(2, ev);
  const b = (p.brightness || 0) / 100, c = (p.contrast || 0) / 100;
  const s = (p.shadows || 0) / 100, h = (p.highlights || 0) / 100;
  let tone: Float32Array | null = null;
  if (reuseTone !== undefined) tone = reuseTone;
  else if (b || c || s || h) {
    tone = new Float32Array(TONE_SIZE + 1);
    const gamma = Math.pow(2, -b * 0.8);              // brightness: mid-tone gamma
    const g = Math.pow(2, c * (c > 0 ? 0.9 : 0.6));   // contrast: S-curve steepness at the pivot
    for (let i = 0; i <= TONE_SIZE; i++) {
      let x = i / TONE_SIZE;
      if (b) x = Math.pow(x, gamma);
      if (c) x = x < PIVOT ? PIVOT * Math.pow(x / PIVOT, g) : 1 - (1 - PIVOT) * Math.pow((1 - x) / (1 - PIVOT), g);
      // Shadows: + darkens, − lifts (kept). Highlights: + brightens, − recovers.
      if (s) x -= s * SH_GAIN * 0.105 * shadowBand(x);
      if (h) x += h * SH_GAIN * 0.105 * highlightBand(x);
      tone[i] = clamp01(x);
    }
  }
  const sv = (p.sat || 0) / 100;
  return { tone, ev, peak, wb, sat: sv < 0 ? 1 + sv : 1 + 0.8 * sv };
};
export const toneStageIsIdentity = (t: ToneStage) => !t.tone && !t.ev && !t.wb;

const lookup = (t: Float32Array, x: number) => {
  const f = clamp01(x) * TONE_SIZE, i = f | 0;
  return i >= TONE_SIZE ? t[TONE_SIZE] : t[i] + (t[i + 1] - t[i]) * (f - i);
};

/** White balance, exposure and tone for one colour (0…255 sRGB floats);
 *  writes into out[0..2]. Saturation is separate (it runs after curves). */
export const applyToneStage = (t: ToneStage, r: number, g: number, b: number, out: Float32Array | number[]) => {
  let x = r / 255, y = g / 255, z = b / 255;
  if (t.wb || t.ev) {
    x = srgbToLinear(x); y = srgbToLinear(y); z = srgbToLinear(z);
    if (t.wb) { const m = t.wb; const a = m[0] * x + m[1] * y + m[2] * z, bb = m[3] * x + m[4] * y + m[5] * z, cc = m[6] * x + m[7] * y + m[8] * z; x = a; y = bb; z = cc; }
    if (t.ev) { const k = Math.pow(2, t.ev); x *= k; y *= k; z *= k; }
    x = shoulder(Math.max(0, x), t.peak); y = shoulder(Math.max(0, y), t.peak); z = shoulder(Math.max(0, z), t.peak);
    x = linearToSrgb(clamp01(x)); y = linearToSrgb(clamp01(y)); z = linearToSrgb(clamp01(z));
  }
  if (t.tone) { x = lookup(t.tone, x); y = lookup(t.tone, y); z = lookup(t.tone, z); }
  out[0] = clamp01(x) * 255; out[1] = clamp01(y) * 255; out[2] = clamp01(z) * 255;
};

/** Saturation around luminance (0…255 floats, in place). k = ToneStage.sat:
 *  0 is exact monochrome; chroma is shrunk (not clipped) to stay in gamut. */
export const applySaturation = (k: number, c: Float32Array | number[]) => {
  if (k === 1) return;
  const x = c[0], y = c[1], z = c[2], l = 0.2126 * x + 0.7152 * y + 0.0722 * z;
  if (k > 1) {
    // Largest k that keeps every channel inside 0…255.
    let d = x - l; if (d > 0 && d * k > 255 - l) k = (255 - l) / d; else if (d < 0 && d * k < -l) k = l / -d;
    d = y - l; if (d > 0 && d * k > 255 - l) k = (255 - l) / d; else if (d < 0 && d * k < -l) k = l / -d;
    d = z - l; if (d > 0 && d * k > 255 - l) k = (255 - l) / d; else if (d < 0 && d * k < -l) k = l / -d;
  }
  c[0] = l + (x - l) * k; c[1] = l + (y - l) * k; c[2] = l + (z - l) * k;
};

/** Table-driven version of applyToneStage for loops (no pow per colour).
 *  Input 0…255 (fractional allowed); matches applyToneStage to ~0.01. */
const LIN_SIZE = 4096;
let LIN: Float32Array | null = null;
export const makeToneFast = (t: ToneStage) => {
  if (!LIN) { LIN = new Float32Array(LIN_SIZE + 1); for (let i = 0; i <= LIN_SIZE; i++) LIN[i] = srgbToLinear(i / LIN_SIZE); }
  const lin = LIN;
  const toLin = (v: number) => { const f = (v < 0 ? 0 : v > 255 ? 255 : v) * (LIN_SIZE / 255), i = f | 0; return i >= LIN_SIZE ? lin[LIN_SIZE] : lin[i] + (lin[i + 1] - lin[i]) * (f - i); };
  const N = 2048, maxIn = Math.max(1, t.peak), k = t.ev ? Math.pow(2, t.ev) : 1;
  // linear (after WB and exposure) → shoulder → encode → tone curve, in 0…255
  const out = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    // Square-root spacing: more samples in the shadows of linear light.
    const v = (i / N) ** 2 * maxIn;
    let e = linearToSrgb(clamp01(shoulder(v, t.peak)));
    if (t.tone) e = lookup(t.tone, e);
    out[i] = e * 255;
  }
  const m = t.wb;
  const at = (v: number) => { if (v <= 0) return out[0]; const f = Math.sqrt(v / maxIn) * N; if (f >= N) return out[N]; const i = f | 0; return out[i] + (out[i + 1] - out[i]) * (f - i); };
  /** r,g,b: 0…255; writes 0…255 floats to c. */
  const apply = (r: number, g: number, b: number, c: Float32Array | number[]) => {
    let x = toLin(r), y = toLin(g), z = toLin(b);
    if (m) { const a = m[0] * x + m[1] * y + m[2] * z, bb = m[3] * x + m[4] * y + m[5] * z, cc = m[6] * x + m[7] * y + m[8] * z; x = a; y = bb; z = cc; }
    c[0] = at(x * k); c[1] = at(y * k); c[2] = at(z * k);
  };
  /** Pieces for callers that precompute per-channel values themselves:
   *  toLinear (sRGB 0…255 → linear), encode (linear after WB → 0…255,
   *  exposure included), wb (matrix or null). */
  return Object.assign(apply, { toLinear: toLin, encode: (v: number) => at(v * k), wb: m });
};
