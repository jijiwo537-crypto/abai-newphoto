/* 一級調色（Primaries）：照 DaVinci Resolve 桌面版「一級調色」面板做的。
 *
 *  · 色輪：Lift（暗部）／Gamma（中間調）／Gain（亮部）／Offset（整體偏移），
 *    每個色輪底下有主轉盤（Y），數字欄位 Y R G B 跟 Resolve 一樣的單位與預設值
 *    （Lift 0.00、Gamma 0.00、Gain 1.00、Offset 25.00）。
 *  · Log 色輪：Shadow／Midtone／Highlight（加上共用的 Offset），用 Low Range／High Range
 *    決定三個區域的分界。
 *  · 參數列：Temp、Tint、Contrast、Pivot、Mid/Detail、Color Boost、Shadows、Highlights、
 *    Saturation、Hue、Lum Mix。（Mid/Detail 要看周圍像素，放在 GLSL 特效層，見 glEffects 的
 *    fxMidDetail；其餘都是逐像素，烤進主查色表。）
 *
 * 色輪的方向跟 Resolve 一樣是向量示波器的方向（Rec.709 的 Cb／Cr 平面）：
 * 往哪個顏色推，R G B 就照那個方向改，而且改的是「零亮度」的色差 —— 推顏色不會順便
 * 讓畫面變亮變暗，亮度交給主轉盤。Lum Mix 決定主轉盤是只改亮度（YRGB，100）
 * 還是三個通道一起改（RGB，0），跟 Resolve 一樣預設 100。
 *
 * CPU（utils/photoPixelCore，烤進 32³ 主查色表）與 GPU（utils/lutGpu 著色器）用同一組
 * 預先算好的數字（makeGrade），兩邊結果一致。 */

export type YRGB = { y: number; r: number; g: number; b: number };
export type ColorGrade = {
  lift: YRGB; gamma: YRGB; gain: YRGB; offset: YRGB;
  logSh: YRGB; logMid: YRGB; logHi: YRGB;
  lowRange: number; highRange: number;
  temp: number; tint: number; contrast: number; pivot: number;
  colorBoost: number; shadows: number; highlights: number;
  sat: number; hue: number; lumMix: number;
};

export type WheelId = 'lift' | 'gamma' | 'gain' | 'offset' | 'logSh' | 'logMid' | 'logHi';
export type ScalarId = 'lowRange' | 'highRange' | 'temp' | 'tint' | 'contrast' | 'pivot' | 'colorBoost' | 'shadows' | 'highlights' | 'sat' | 'hue' | 'lumMix';

/** 每個色輪的規格：中性值、數字範圍、色輪推到邊緣時的色差（Cb/Cr 單位）、主轉盤每像素的量 */
export type WheelSpec = { neutral: number; min: number; max: number; edge: number; jog: number; hasY: boolean; digits: number };
export const WHEEL_SPEC: Record<WheelId, WheelSpec> = {
  lift:   { neutral: 0,  min: -1, max: 1,  edge: 0.06, jog: 0.002, hasY: true,  digits: 2 },
  gamma:  { neutral: 0,  min: -1, max: 1,  edge: 0.06, jog: 0.003, hasY: true,  digits: 2 },
  gain:   { neutral: 1,  min: 0,  max: 4,  edge: 0.15, jog: 0.005, hasY: true,  digits: 2 },
  offset: { neutral: 25, min: 0,  max: 50, edge: 6,    jog: 0.1,   hasY: false, digits: 2 },
  logSh:  { neutral: 0,  min: -1, max: 1,  edge: 0.08, jog: 0.002, hasY: false, digits: 2 },
  logMid: { neutral: 0,  min: -1, max: 1,  edge: 0.08, jog: 0.002, hasY: false, digits: 2 },
  logHi:  { neutral: 0,  min: -1, max: 1,  edge: 0.08, jog: 0.002, hasY: false, digits: 2 },
};

/** 參數列：預設、範圍、顯示小數位、整條拖過去（約 300px）改多少 */
export type ScalarSpec = { def: number; min: number; max: number; digits: number; span: number };
export const SCALAR_SPEC: Record<ScalarId, ScalarSpec> = {
  temp:       { def: 0,     min: -4000, max: 4000, digits: 1, span: 2000 },
  tint:       { def: 0,     min: -100,  max: 100,  digits: 2, span: 100 },
  contrast:   { def: 1,     min: 0,     max: 2,    digits: 3, span: 1 },
  pivot:      { def: 0.435, min: 0,     max: 1,    digits: 3, span: 0.5 },
  colorBoost: { def: 0,     min: -100,  max: 100,  digits: 2, span: 100 },
  shadows:    { def: 0,     min: -100,  max: 100,  digits: 2, span: 100 },
  highlights: { def: 0,     min: -100,  max: 100,  digits: 2, span: 100 },
  sat:        { def: 50,    min: 0,     max: 100,  digits: 2, span: 50 },
  hue:        { def: 50,    min: 0,     max: 100,  digits: 2, span: 50 },
  lumMix:     { def: 100,   min: 0,     max: 100,  digits: 2, span: 100 },
  lowRange:   { def: 0.333, min: 0,     max: 1,    digits: 3, span: 0.5 },
  highRange:  { def: 0.55,  min: 0,     max: 1,    digits: 3, span: 0.5 },
};

const W = (n: number): YRGB => ({ y: n, r: n, g: n, b: n });
export const DEFAULT_GRADE: ColorGrade = {
  lift: W(0), gamma: W(0), gain: W(1), offset: W(25),
  logSh: W(0), logMid: W(0), logHi: W(0),
  ...(Object.fromEntries(Object.entries(SCALAR_SPEC).map(([k, s]) => [k, s.def])) as Record<ScalarId, number>),
};
export const freshGrade = (): ColorGrade => JSON.parse(JSON.stringify(DEFAULT_GRADE));

/** 補齊缺的欄位（舊作品、或第一版調色輪留下的格式） */
export function normGrade(g: Partial<ColorGrade> | undefined | null): ColorGrade {
  const out = freshGrade();
  if (!g) return out;
  for (const k of Object.keys(WHEEL_SPEC) as WheelId[]) {
    const w = (g as any)[k];
    if (w && typeof w === 'object') for (const c of ['y', 'r', 'g', 'b'] as const) if (Number.isFinite(w[c])) out[k][c] = w[c];
  }
  for (const k of Object.keys(SCALAR_SPEC) as ScalarId[]) if (Number.isFinite((g as any)[k])) out[k] = (g as any)[k];
  return out;
}

const EPS = 1e-6;
export const isWheelNeutral = (g: ColorGrade, id: WheelId) => {
  const s = WHEEL_SPEC[id], w = g[id];
  return (['r', 'g', 'b'] as const).every(c => Math.abs(w[c] - s.neutral) < EPS) && (!s.hasY || Math.abs(w.y - s.neutral) < EPS);
};
export const isGradeIdentity = (g0: Partial<ColorGrade> | undefined | null): boolean => {
  if (!g0) return true;
  const g = normGrade(g0);
  return (Object.keys(WHEEL_SPEC) as WheelId[]).every(id => isWheelNeutral(g, id))
    && (['temp', 'tint', 'contrast', 'colorBoost', 'shadows', 'highlights', 'sat', 'hue'] as ScalarId[]).every(k => Math.abs(g[k] - SCALAR_SPEC[k].def) < EPS);
};

/* ── 色輪 ⇄ R G B（Rec.709 的 Cb／Cr，零亮度色差） ─────────────── */
const KR = 0.2126, KG = 0.7152, KB = 0.0722;
/** R G B（相對中性值）→ 色輪上的 (Cb, Cr) */
export function rgbToWheel(w: YRGB, neutral: number): [number, number] {
  const r = w.r - neutral, g = w.g - neutral, b = w.b - neutral;
  const y = KR * r + KG * g + KB * b;
  return [(b - y) / 1.8556, (r - y) / 1.5748];
}
/** 把色輪位置 (Cb, Cr) 寫回 R G B，保留原本三個通道共同的亮度部分 */
export function wheelToRgb(w: YRGB, neutral: number, cb: number, cr: number): YRGB {
  const r0 = w.r - neutral, g0 = w.g - neutral, b0 = w.b - neutral;
  const y = KR * r0 + KG * g0 + KB * b0;
  const r = y + 1.5748 * cr, b = y + 1.8556 * cb;
  const g = (y - KR * r - KB * b) / KG;
  return { y: w.y, r: r + neutral, g: g + neutral, b: b + neutral };
}
/** 色輪外圈某個角度的顯示色（向量示波器方向，角度以 3 點鐘為 0、逆時針） */
export function wheelColour(deg: number): string {
  const a = (deg * Math.PI) / 180, cb = Math.cos(a) * 0.32, cr = Math.sin(a) * 0.32, y = 0.5;
  let r = y + 1.5748 * cr, b = y + 1.8556 * cb, g = (y - KR * r - KB * b) / KG;
  const m = Math.max(r, g, b), n = Math.min(r, g, b);
  // 拉到最飽和、亮度適中的顯示色
  const s = (v: number) => Math.round(255 * Math.min(1, Math.max(0, (v - n) / (m - n || 1) * 0.85 + 0.12)));
  r = s(r); g = s(g); b = s(b);
  return `rgb(${r},${g},${b})`;
}

/* ── 白平衡（Temp／Tint）：Bradford 色適應，相對於 6504K 的普朗克軌跡 ── */
function planckUv(T: number): [number, number] {
  const u = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T);
  const v = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T);
  return [u, v];
}
function whiteXYZ(T: number, duv: number): [number, number, number] {
  const [u0, v0] = planckUv(T), [u1, v1] = planckUv(T + 1);
  let du = u1 - u0, dv = v1 - v0; const n = Math.hypot(du, dv) || 1; du /= n; dv /= n;
  // 軌跡的法線（往上＝偏綠）
  const u = u0 - dv * duv, v = v0 + du * duv;
  const x = (3 * u) / (2 * u - 8 * v + 4), y = (2 * v) / (2 * u - 8 * v + 4);
  return [x / y, 1, (1 - x - y) / y];
}
type M3 = number[];
const mul = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
};
const mv = (m: M3, v: number[]) => [0, 1, 2].map(i => m[i * 3] * v[0] + m[i * 3 + 1] * v[1] + m[i * 3 + 2] * v[2]);
const BRAD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRAD_I = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];
const RGB2XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
const XYZ2RGB = [3.2404542, -1.5371385, -0.4985314, -0.9692660, 1.8760108, 0.0415560, 0.0556434, -0.2040259, 1.0572252];
/** temp>0 → 變暖；tint>0 → 偏洋紅（跟 Resolve 一樣） */
function wbMatrix(temp: number, tint: number): Float32Array | null {
  if (Math.abs(temp) < EPS && Math.abs(tint) < EPS) return null;
  const T = Math.min(15000, Math.max(2000, 6504 + temp));
  const src = mv(BRAD, whiteXYZ(T, tint * 0.0002)), dst = mv(BRAD, whiteXYZ(6504, 0));
  const D = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  return Float32Array.from(mul(XYZ2RGB, mul(BRAD_I, mul(D, mul(BRAD, RGB2XYZ)))));
}

/** 預先算好的數字（CPU 與 GPU 共用）。沒有調任何東西時是 null。 */
export type GradeFast = {
  wb: Float32Array | null;
  off: Float32Array;                                    // Offset（加法）
  cL: Float32Array; cE: Float32Array; cK: Float32Array; // 只有 R G B 的 Lift／Gamma 指數／Gain
  rL: Float32Array; rE: Float32Array; rK: Float32Array; // 加上主轉盤 Y 的（RGB 模式）
  m: Float32Array;                                      // 主轉盤：Lift、Gamma 指數、Gain
  lumMix: number;
  logS: Float32Array; logM: Float32Array; logH: Float32Array; range: Float32Array;
  con: Float32Array;                                    // contrast, pivot
  sh: Float32Array;                                     // shadows, highlights（-1~1）
  hsb: Float32Array;                                    // cos, sin, sat, boost
};
const gExp = (v: number) => Math.pow(2, -1.5 * v);
export function makeGrade(g0: Partial<ColorGrade> | undefined | null): GradeFast | null {
  if (isGradeIdentity(g0)) return null;
  const g = normGrade(g0);
  const ch = ['r', 'g', 'b'] as const;
  const f3 = (fn: (c: 'r' | 'g' | 'b') => number) => Float32Array.from(ch.map(fn));
  const lo = Math.min(g.lowRange, g.highRange), hi = Math.max(g.lowRange, g.highRange);
  const ha = ((g.hue - 50) / 50) * Math.PI;
  return {
    wb: wbMatrix(g.temp, g.tint),
    off: f3(c => (g.offset[c] - 25) * 0.01),
    cL: f3(c => g.lift[c]), cE: f3(c => gExp(g.gamma[c])), cK: f3(c => g.gain[c]),
    rL: f3(c => g.lift[c] + g.lift.y), rE: f3(c => gExp(g.gamma[c] + g.gamma.y)), rK: f3(c => g.gain[c] * g.gain.y),
    m: Float32Array.from([g.lift.y, gExp(g.gamma.y), g.gain.y]),
    lumMix: Math.min(1, Math.max(0, g.lumMix / 100)),
    logS: f3(c => g.logSh[c]), logM: f3(c => g.logMid[c]), logH: f3(c => g.logHi[c]),
    range: Float32Array.from([lo, hi]),
    con: Float32Array.from([Math.max(0.001, g.contrast), Math.min(0.99, Math.max(0.01, g.pivot))]),
    sh: Float32Array.from([g.shadows / 100, g.highlights / 100]),
    hsb: Float32Array.from([Math.cos(ha), Math.sin(ha), g.sat / 50, g.colorBoost / 100]),
  };
}

/* ── 逐像素（CPU） ─────────────────────────────────────────── */
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const luma = (r: number, g: number, b: number) => KR * r + KG * g + KB * b;
const prim = (x: number, L: number, E: number, K: number) => Math.pow(Math.max((x + L * (1 - x)) * K, 0), E);
const conCurve = (x: number, k: number, p: number) => {
  x = Math.min(1, Math.max(0, x));
  return x < p ? p * Math.pow(x / p, k) : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), k);
};
const A = [0, 0, 0], R = [0, 0, 0];

/** 套用到一個 0~255 的 RGB（就地改寫 c）。 */
export function applyGrade(G: GradeFast, c: Float32Array | number[]) {
  let r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  // 1）白平衡（線性光）
  if (G.wb) {
    const lr = toLin(r), lg = toLin(g), lb = toLin(b), m = G.wb;
    r = toSrgb(Math.max(0, m[0] * lr + m[1] * lg + m[2] * lb));
    g = toSrgb(Math.max(0, m[3] * lr + m[4] * lg + m[5] * lb));
    b = toSrgb(Math.max(0, m[6] * lr + m[7] * lg + m[8] * lb));
  }
  // 2）Offset
  const x = [r + G.off[0], g + G.off[1], b + G.off[2]];
  // 3）Lift／Gamma／Gain，主轉盤依 Lum Mix 在 YRGB 與 RGB 之間混合
  for (let i = 0; i < 3; i++) { A[i] = prim(x[i], G.cL[i], G.cE[i], G.cK[i]); R[i] = prim(x[i], G.rL[i], G.rE[i], G.rK[i]); }
  const y0 = luma(A[0], A[1], A[2]), dy = prim(y0, G.m[0], G.m[1], G.m[2]) - y0;
  for (let i = 0; i < 3; i++) x[i] = R[i] + (A[i] + dy - R[i]) * G.lumMix;
  // 4）Log 色輪：依亮度分三區加偏移
  {
    const Y = luma(x[0], x[1], x[2]), lo = G.range[0], hi = G.range[1];
    const wS = 1 - sstep(lo - 0.12, lo + 0.12, Y), wH = sstep(hi - 0.12, hi + 0.12, Y), wM = Math.max(0, 1 - wS - wH);
    for (let i = 0; i < 3; i++) x[i] += G.logS[i] * wS + G.logM[i] * wM + G.logH[i] * wH;
  }
  // 5）Contrast／Pivot
  if (Math.abs(G.con[0] - 1) > EPS) for (let i = 0; i < 3; i++) x[i] = conCurve(x[i], G.con[0], G.con[1]);
  // 6）Shadows／Highlights（只動亮度）
  if (G.sh[0] || G.sh[1]) {
    const Y = Math.min(1, Math.max(0, luma(x[0], x[1], x[2])));
    const Y2 = Y + 0.9 * G.sh[0] * Y * (1 - Y) * (1 - Y) + 0.9 * G.sh[1] * Y * Y * (1 - Y);
    if (Y2 < Y && Y > 1e-5) { const k = Y2 / Y; for (let i = 0; i < 3; i++) x[i] *= k; }
    else for (let i = 0; i < 3; i++) x[i] += Y2 - Y;
  }
  // 7）Hue／Saturation／Color Boost（Cb/Cr 平面，亮度不變）
  {
    const Y = luma(x[0], x[1], x[2]);
    let cb = (x[2] - Y) / 1.8556, cr = (x[0] - Y) / 1.5748;
    const cb2 = cb * G.hsb[0] - cr * G.hsb[1], cr2 = cb * G.hsb[1] + cr * G.hsb[0];
    const C = Math.hypot(cb2, cr2);
    const k = G.hsb[2] * Math.max(0, 1 + G.hsb[3] * 1.2 * (1 - sstep(0.02, 0.25, C)));
    cb = cb2 * k; cr = cr2 * k;
    const rr = Y + 1.5748 * cr, bb = Y + 1.8556 * cb;
    x[0] = rr; x[2] = bb; x[1] = (Y - KR * rr - KB * bb) / KG;
  }
  for (let i = 0; i < 3; i++) { const v = x[i] * 255; c[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
}

/** GPU 版（GLSL ES 3.0），數字由 makeGrade 傳進來 */
export const GRADE_GLSL = `
uniform bool uHasGrade;
uniform bool uGHasWb;
uniform mat3 uGWb;
uniform vec3 uGOff, uGCL, uGCE, uGCK, uGRL, uGRE, uGRK, uGM;
uniform float uGLumMix;
uniform vec3 uGLS, uGLM, uGLH;
uniform vec2 uGRange, uGCon, uGSH;
uniform vec4 uGHsb;
vec3 gLin(vec3 v){return mix(v/12.92,pow((max(v,0.)+.055)/1.055,vec3(2.4)),step(vec3(.04045),v));}
vec3 gSrgb(vec3 v){v=max(v,0.);return mix(v*12.92,1.055*pow(v,vec3(1./2.4))-.055,step(vec3(.0031308),v));}
float gL(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 gPrim(vec3 x,vec3 L,vec3 E,vec3 K){return pow(max((x+L*(1.-x))*K,0.),E);}
float gCon(float x,float k,float p){x=clamp(x,0.,1.);return x<p?p*pow(x/p,k):1.-(1.-p)*pow((1.-x)/(1.-p),k);}
vec3 colourGrade(vec3 c){
  if(!uHasGrade)return c;
  if(uGHasWb)c=gSrgb(uGWb*gLin(c));
  vec3 x=c+uGOff;
  vec3 a=gPrim(x,uGCL,uGCE,uGCK),r=gPrim(x,uGRL,uGRE,uGRK);
  float y0=gL(a);
  float dy=pow(max((y0+uGM.x*(1.-y0))*uGM.z,0.),uGM.y)-y0;
  x=mix(r,a+dy,uGLumMix);
  float Y=gL(x);
  float wS=1.-smoothstep(uGRange.x-.12,uGRange.x+.12,Y),wH=smoothstep(uGRange.y-.12,uGRange.y+.12,Y),wM=max(0.,1.-wS-wH);
  x+=uGLS*wS+uGLM*wM+uGLH*wH;
  if(abs(uGCon.x-1.)>1e-6)x=vec3(gCon(x.r,uGCon.x,uGCon.y),gCon(x.g,uGCon.x,uGCon.y),gCon(x.b,uGCon.x,uGCon.y));
  if(uGSH.x!=0.||uGSH.y!=0.){
    Y=clamp(gL(x),0.,1.);
    float Y2=Y+.9*uGSH.x*Y*(1.-Y)*(1.-Y)+.9*uGSH.y*Y*Y*(1.-Y);
    if(Y2<Y&&Y>1e-5)x*=Y2/Y;else x+=Y2-Y;
  }
  Y=gL(x);
  vec2 cc=vec2((x.b-Y)/1.8556,(x.r-Y)/1.5748);
  cc=vec2(cc.x*uGHsb.x-cc.y*uGHsb.y,cc.x*uGHsb.y+cc.y*uGHsb.x);
  float C=length(cc);
  cc*=uGHsb.z*max(0.,1.+uGHsb.w*1.2*(1.-smoothstep(.02,.25,C)));
  float rr=Y+1.5748*cc.y,bb=Y+1.8556*cc.x;
  return clamp(vec3(rr,(Y-.2126*rr-.0722*bb)/.7152,bb),0.,1.);
}`;

/** 把 makeGrade 的結果送進著色器 */
export function bindGradeUniforms(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, G: GradeFast | null) {
  gl.uniform1i(u('uHasGrade'), G ? 1 : 0);
  if (!G) return;
  gl.uniform1i(u('uGHasWb'), G.wb ? 1 : 0);
  // CPU 的矩陣是列主序（row-major），GLSL 的 mat3 吃行主序，所以要轉置
  if (G.wb) gl.uniformMatrix3fv(u('uGWb'), true, G.wb);
  gl.uniform3fv(u('uGOff'), G.off);
  gl.uniform3fv(u('uGCL'), G.cL); gl.uniform3fv(u('uGCE'), G.cE); gl.uniform3fv(u('uGCK'), G.cK);
  gl.uniform3fv(u('uGRL'), G.rL); gl.uniform3fv(u('uGRE'), G.rE); gl.uniform3fv(u('uGRK'), G.rK);
  gl.uniform3fv(u('uGM'), G.m);
  gl.uniform1f(u('uGLumMix'), G.lumMix);
  gl.uniform3fv(u('uGLS'), G.logS); gl.uniform3fv(u('uGLM'), G.logM); gl.uniform3fv(u('uGLH'), G.logH);
  gl.uniform2fv(u('uGRange'), G.range); gl.uniform2fv(u('uGCon'), G.con); gl.uniform2fv(u('uGSH'), G.sh);
  gl.uniform4fv(u('uGHsb'), G.hsb);
}
