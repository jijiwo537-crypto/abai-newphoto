/* 一級調色色輪（DaVinci Resolve「一級校色輪／一級校色條／Log 色輪」）。
 *
 *  · 暗部 Lift／中灰 Gamma／亮部 Gain／偏移 Offset：Y R G B 數值跟 Resolve 同單位同預設
 *    （0.00／0.00／1.00／25.00）。主轉盤改 Y，只動亮度（YRGB，等於 Resolve 預設的 Lum Mix 100）。
 *  · Log 色輪：陰影／中間調／高光，依亮度分三區各自偏移（分界用 Resolve 的預設 Low Range 0.333、
 *    High Range 0.550，兩側平滑過渡）。偏移跟一級共用。
 *
 * 色輪方向＝向量示波器方向（Rec.709 Cb／Cr）：往哪個顏色推，R G B 就照那個方向改，
 * 而且是「零亮度」的色差 —— 推顏色不會讓畫面變亮變暗。 */

export type YRGB = { y: number; r: number; g: number; b: number };
export type WheelId = 'lift' | 'gamma' | 'gain' | 'offset' | 'logSh' | 'logMid' | 'logHi';
export type Wheels = Record<WheelId, YRGB>;

/** 每個色輪：中性值、數字範圍、色輪推到邊緣時的色差（Cb/Cr 單位）、主轉盤每像素的量 */
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
export const WHEEL_IDS = Object.keys(WHEEL_SPEC) as WheelId[];
const W = (n: number): YRGB => ({ y: n, r: n, g: n, b: n });
export const freshWheels = (): Wheels => Object.fromEntries(WHEEL_IDS.map(id => [id, W(WHEEL_SPEC[id].neutral)])) as Wheels;

const EPS = 1e-6;
export const isWheelNeutral = (w: YRGB | undefined, id: WheelId) => {
  if (!w) return true;
  const s = WHEEL_SPEC[id];
  return (['r', 'g', 'b'] as const).every(c => Math.abs(w[c] - s.neutral) < EPS) && (!s.hasY || Math.abs(w.y - s.neutral) < EPS);
};
export const isWheelsIdentity = (g: Partial<Wheels>) => WHEEL_IDS.every(id => isWheelNeutral(g[id], id));

/* ── 色輪 ⇄ R G B（Rec.709 的 Cb／Cr，零亮度色差） ─────────────── */
const KR = 0.2126, KG = 0.7152, KB = 0.0722;
export function rgbToWheel(w: YRGB, neutral: number): [number, number] {
  const r = w.r - neutral, g = w.g - neutral, b = w.b - neutral;
  const y = KR * r + KG * g + KB * b;
  return [(b - y) / 1.8556, (r - y) / 1.5748];
}
/** 把色輪位置 (Cb, Cr) 寫回 R G B，保留三個通道共同的亮度部分 */
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
  const r = y + 1.5748 * cr, b = y + 1.8556 * cb, g = (y - KR * r - KB * b) / KG;
  const m = Math.max(r, g, b), n = Math.min(r, g, b);
  const s = (v: number) => Math.round(255 * Math.min(1, Math.max(0, (v - n) / (m - n || 1) * 0.85 + 0.12)));
  return `rgb(${s(r)},${s(g)},${s(b)})`;
}

export type WheelsFast = { off: Float32Array; L: Float32Array; E: Float32Array; K: Float32Array; m: Float32Array; logS: Float32Array; logM: Float32Array; logH: Float32Array };
const gExp = (v: number) => Math.pow(2, -1.5 * v);
export const LOW_RANGE = 0.333, HIGH_RANGE = 0.55;

export function makeWheels(g: Wheels): WheelsFast | null {
  if (isWheelsIdentity(g)) return null;
  const f3 = (fn: (c: 'r' | 'g' | 'b') => number) => Float32Array.from((['r', 'g', 'b'] as const).map(fn));
  return {
    off: f3(c => (g.offset[c] - 25) * 0.01),
    L: f3(c => g.lift[c]), E: f3(c => gExp(g.gamma[c])), K: f3(c => g.gain[c]),
    m: Float32Array.from([g.lift.y, gExp(g.gamma.y), g.gain.y]),
    logS: f3(c => g.logSh[c]), logM: f3(c => g.logMid[c]), logH: f3(c => g.logHi[c]),
  };
}

const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const prim = (x: number, L: number, E: number, K: number) => Math.pow(Math.max((x + L * (1 - x)) * K, 0), E);

/** 0..1 RGB，就地改寫 */
export function applyWheels(G: WheelsFast, x: number[]) {
  for (let i = 0; i < 3; i++) x[i] = prim(x[i] + G.off[i], G.L[i], G.E[i], G.K[i]);
  // 主轉盤（Y）：只改亮度
  const y0 = KR * x[0] + KG * x[1] + KB * x[2], dy = prim(y0, G.m[0], G.m[1], G.m[2]) - y0;
  for (let i = 0; i < 3; i++) x[i] += dy;
  const Y = KR * x[0] + KG * x[1] + KB * x[2];
  const wS = 1 - sstep(LOW_RANGE - 0.12, LOW_RANGE + 0.12, Y), wH = sstep(HIGH_RANGE - 0.12, HIGH_RANGE + 0.12, Y), wM = Math.max(0, 1 - wS - wH);
  for (let i = 0; i < 3; i++) x[i] = Math.min(1, Math.max(0, x[i] + G.logS[i] * wS + G.logM[i] * wM + G.logH[i] * wH));
}

export const WHEELS_GLSL = `
uniform bool uHasWheels;
uniform vec3 uGOff, uGL, uGE, uGK, uGM, uGLS, uGLM, uGLH;
vec3 gPrim(vec3 x,vec3 L,vec3 E,vec3 K){return pow(max((x+L*(1.-x))*K,0.),E);}
vec3 wheels(vec3 c){
  if(!uHasWheels)return c;
  vec3 x=gPrim(c+uGOff,uGL,uGE,uGK);
  float y0=dot(x,vec3(.2126,.7152,.0722));
  x+=pow(max((y0+uGM.x*(1.-y0))*uGM.z,0.),uGM.y)-y0;
  float Y=dot(x,vec3(.2126,.7152,.0722));
  float wS=1.-smoothstep(${(LOW_RANGE - 0.12).toFixed(3)},${(LOW_RANGE + 0.12).toFixed(3)},Y),wH=smoothstep(${(HIGH_RANGE - 0.12).toFixed(3)},${(HIGH_RANGE + 0.12).toFixed(3)},Y),wM=max(0.,1.-wS-wH);
  return clamp(x+uGLS*wS+uGLM*wM+uGLH*wH,0.,1.);
}`;

export function bindWheels(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, G: WheelsFast | null) {
  gl.uniform1i(u('uHasWheels'), G ? 1 : 0);
  if (!G) return;
  gl.uniform3fv(u('uGOff'), G.off); gl.uniform3fv(u('uGL'), G.L); gl.uniform3fv(u('uGE'), G.E); gl.uniform3fv(u('uGK'), G.K);
  gl.uniform3fv(u('uGM'), G.m); gl.uniform3fv(u('uGLS'), G.logS); gl.uniform3fv(u('uGLM'), G.logM); gl.uniform3fv(u('uGLH'), G.logH);
}
