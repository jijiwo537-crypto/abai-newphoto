/* 限定器（DaVinci Resolve 的 HSL Qualifier）：用色相、飽和度、亮度選出一塊顏色，
 * 只在那塊範圍裡再調一次。
 *
 *  · 色相：中心、寬度、柔化、對稱（柔化在左右兩側怎麼分）。0..100 的刻度＝0..360°，中心循環。
 *  · 飽和度、亮度：低、高、低柔化、高柔化。三個都可以各自關掉（關掉＝那一項不限制）。
 *  · 鍵（選取程度）＝色相 × 飽和度 × 亮度，各自是兩側平滑的梯形窗；灰色像素的色相是雜訊，
 *    所以飽和度窗包含 0 的時候，色相窗在低飽和處淡出成「全選」，灰牆不會閃爍進出。
 *  · 黑色裁切／白色裁切：鍵的色階（把半透明的地方推乾淨）；反轉：選取以外的地方。
 *  · 選取範圍用「原圖」的顏色算（跟 Resolve 一樣是節點的輸入），所以前面怎麼調，選到的地方都不會跑掉。
 *  · 範圍內的調整：色相、飽和度、曝光（檔）、色溫、色調，結果用鍵混回去：out = mix(in, 調整後, 鍵)。
 *
 * 滴管（在畫面上點一下取樣）：5×5 取樣，色相中心＝以飽和度加權的圓周平均，寬度＝涵蓋範圍＋2°，
 * 柔化＝寬度的 1/4（至少 3°）；飽和度、亮度＝最小～最大 ±0.02、柔化 0.05。
 * 「＋」把範圍擴大到也包含新取樣，「－」把最近的邊界收到剛好排除新取樣。
 *
 * 遮罩精修（模糊、侵蝕膨脹、降噪）要看周圍像素，不能烤進查色表，這一版沒有。 */

import { KR, KG, KB, toLin, toSrgb, sstep, maxChroma, fromYcc } from './common';

export type Qual = {
  hc: number; hw: number; hs: number; hsym: number;          // 色相：中心°、寬度°、柔化°、對稱 0..100
  slo: number; shi: number; sls: number; shs: number;         // 飽和度 0..100
  llo: number; lhi: number; lls: number; lhs: number;         // 亮度 0..100
  useH: boolean; useS: boolean; useL: boolean;
  invert: boolean; bclip: number; wclip: number;              // 0..100
  hue: number; sat: number; exp: number; temp: number; tint: number;   // 範圍內的調整
};
export const freshQual = (): Qual => ({
  hc: 0, hw: 360, hs: 0, hsym: 50,
  slo: 0, shi: 100, sls: 0, shs: 0,
  llo: 0, lhi: 100, lls: 0, lhs: 0,
  useH: true, useS: true, useL: true,
  invert: false, bclip: 0, wclip: 100,
  hue: 0, sat: 1, exp: 0, temp: 0, tint: 0,
});
export const QUAL_SPEC = {
  hue: { def: 0, min: -180, max: 180, digits: 1, span: 90 },
  sat: { def: 1, min: 0, max: 2, digits: 2, span: 1 },
  exp: { def: 0, min: -3, max: 3, digits: 2, span: 2 },
  temp: { def: 0, min: -100, max: 100, digits: 0, span: 100 },
  tint: { def: 0, min: -100, max: 100, digits: 0, span: 100 },
};
const EPS = 1e-6;
export const isQualCorrNeutral = (q: Partial<Qual> | undefined | null) => !q
  || (Math.abs(q.hue ?? 0) < EPS && Math.abs((q.sat ?? 1) - 1) < EPS && Math.abs(q.exp ?? 0) < EPS && Math.abs(q.temp ?? 0) < EPS && Math.abs(q.tint ?? 0) < EPS);
/** 選取範圍有沒有被動過（有選範圍但還沒調整時，畫面不變，但工具列要顯示「調過」） */
export const isQualRangeDefault = (q: Partial<Qual> | undefined | null) => {
  if (!q) return true;
  const f = freshQual() as any;
  return (['hc', 'hw', 'hs', 'hsym', 'slo', 'shi', 'sls', 'shs', 'llo', 'lhi', 'lls', 'lhs', 'useH', 'useS', 'useL', 'invert', 'bclip', 'wclip'] as const).every(k => (q as any)[k] === f[k]);
};

/** 0 ＝ 一般；1 ＝ 顯示範圍（範圍外變灰）；2 ＝ 黑白遮罩 */
export type QualView = 0 | 1 | 2;

export type QualFast = { k: Float32Array; corr: Float32Array; view: number };
const WB = (temp: number, tint: number) => {
  // 簡單的線性光增益：色溫往暖＝紅多藍少，色調往洋紅＝綠少；再把亮度拉回來
  const r = Math.pow(2, temp * 0.006), b = Math.pow(2, -temp * 0.006), g = Math.pow(2, -tint * 0.005);
  const y = KR * r + KG * g + KB * b;
  return [r / y, g / y, b / y];
};
export function makeQual(q: Partial<Qual> | undefined | null, view: QualView = 0): QualFast | null {
  if (isQualCorrNeutral(q) && !view) return null;
  const Q = { ...freshQual(), ...q };
  const k = Float32Array.from([
    (Q.hc * Math.PI) / 180, (Math.min(360, Q.hw) / 2) * Math.PI / 180, (Q.hs * Math.PI) / 180, Q.hsym / 100,
    Q.slo / 100, Q.shi / 100, Q.sls / 100, Q.shs / 100,
    Q.llo / 100, Q.lhi / 100, Q.lls / 100, Q.lhs / 100,
    Q.useH && Q.hw < 360 ? 1 : 0, Q.useS ? 1 : 0, Q.useL ? 1 : 0, Q.invert ? 1 : 0,
    Q.bclip / 100, Q.wclip / 100,
  ]);
  const [wr, wg, wb] = WB(Q.temp, Q.tint);
  return { k, corr: Float32Array.from([(Q.hue * Math.PI) / 180, Q.sat, Math.pow(2, Q.exp), wr, wg, wb]), view };
}

/** 梯形窗：低～高之間是 1，兩側用 smoothstep 過渡（柔化為 0 時是硬邊） */
function win(x: number, lo: number, hi: number, ls: number, hs: number) {
  const a = lo <= 0 ? 1 : ls < 1e-4 ? (x >= lo ? 1 : 0) : sstep(lo - ls, lo, x);
  const b = hi >= 1 ? 1 : hs < 1e-4 ? (x <= hi ? 1 : 0) : 1 - sstep(hi, hi + hs, x);
  return a * b;
}
/** 這個原始顏色（0..1）被選到多少（0..1） */
export function qualKey(K: Float32Array, r: number, g: number, b: number) {
  const Y = KR * r + KG * g + KB * b;
  const cb = (b - Y) / 1.8556, cr = (r - Y) / 1.5748, C = Math.hypot(cb, cr);
  const Yc = Math.min(1, Math.max(0, Y));
  const s = C > 1e-6 ? Math.min(1, C / maxChroma(Yc, cb / C, cr / C)) : 0;
  let kH = 1;
  if (K[12]) {
    let d = Math.atan2(cr, cb) - K[0];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const half = K[1], soft = K[2], side = soft * 2 * (d < 0 ? 1 - K[3] : K[3]);
    const ad = Math.abs(d);
    kH = ad <= half ? 1 : side < 1e-4 ? 0 : 1 - sstep(half, half + side, ad);
    if (K[4] - K[6] <= 0.001) kH = 1 + (kH - 1) * sstep(0, 0.05, s);
  }
  const kS = K[13] ? win(s, K[4], K[5], K[6], K[7]) : 1;
  const kL = K[14] ? win(Yc, K[8], K[9], K[10], K[11]) : 1;
  let k = kH * kS * kL;
  k = Math.min(1, Math.max(0, (k - K[16]) / Math.max(1e-4, K[17] - K[16])));
  return K[15] ? 1 - k : k;
}

const L = [0, 0, 0], O = [0, 0, 0];
/** 範圍內的調整（不看鍵）：結果寫進 c（0..1） */
export function qualCorrect(F: QualFast, c: number[]) {
  const [hue, sat, gain, wr, wg, wb] = F.corr as unknown as number[];
  // 曝光與色溫色調：線性光增益
  L[0] = toLin(Math.min(1, Math.max(0, c[0]))) * gain * wr;
  L[1] = toLin(Math.min(1, Math.max(0, c[1]))) * gain * wg;
  L[2] = toLin(Math.min(1, Math.max(0, c[2]))) * gain * wb;
  const m = Math.max(L[0], L[1], L[2]);
  for (let i = 0; i < 3; i++) c[i] = toSrgb(m > 1 ? L[i] / m : L[i]);
  // 色相與飽和度：Cb/Cr 平面，亮度不變，超出色域就收回色差
  const Y = KR * c[0] + KG * c[1] + KB * c[2], Yc = Math.min(1, Math.max(0, Y));
  const cb = (c[2] - Y) / 1.8556, cr = (c[0] - Y) / 1.5748, C = Math.hypot(cb, cr);
  if (C > 1e-6 && (hue !== 0 || sat !== 1)) {
    const a = Math.atan2(cr, cb) + hue, ca = Math.cos(a), sa = Math.sin(a);
    const C2 = Math.min(C * sat, maxChroma(Yc, ca, sa));
    fromYcc(Y, ca * C2, sa * C2, c);
  }
}
/** 用鍵把「沒調」與「調過」混起來：a＝沒調、b＝調過（0..1），k＝鍵。結果寫進 out */
export function qualBlend(view: number, k: number, a: ArrayLike<number>, b: ArrayLike<number>, out: number[]) {
  if (view === 2) { out[0] = out[1] = out[2] = k; return; }
  const Y0 = (KR * a[0] + KG * a[1] + KB * a[2]) * 0.85;
  for (let i = 0; i < 3; i++) {
    const c1 = view === 1 ? Y0 + (a[i] - Y0) * k : a[i];
    out[i] = c1 + (b[i] - c1) * k;
  }
}
/** c：目前的顏色（0..1，就地改寫）；o：這個像素的原始顏色（0..1） */
export function applyQual(F: QualFast, c: number[], o: ArrayLike<number>) {
  const k = qualKey(F.k, o[0], o[1], o[2]);
  O[0] = c[0]; O[1] = c[1]; O[2] = c[2];
  if (k > 0) qualCorrect(F, O);
  qualBlend(F.view, k, c.slice(), O, c);
}

export const QUAL_GLSL = `
uniform bool uHasQual;
uniform vec4 uQK4[5];
uniform vec4 uQC4[2];
uniform float uQView;
float qWin(float x,float lo,float hi,float ls,float hs){
  float a=lo<=0.?1.:ls<1e-4?step(lo,x):smoothstep(lo-ls,lo,x);
  float b=hi>=1.?1.:hs<1e-4?step(x,hi):1.-smoothstep(hi,hi+hs,x);
  return a*b;
}
float qK(int i){return uQK4[i/4][i%4];}
float qC(int i){return uQC4[i/4][i%4];}
float qualKey(vec3 o){
  float Y=gLuma(o),Yc=clamp(Y,0.,1.);
  vec2 cc=vec2((o.b-Y)/1.8556,(o.r-Y)/1.5748);float C=length(cc);
  float s=C>1e-6?min(1.,C/gMaxC(Yc,cc.x/C,cc.y/C)):0.;
  float kH=1.;
  if(qK(12)>.5){
    float d=atan(cc.y,cc.x)-qK(0);d=atan(sin(d),cos(d));
    float half_=qK(1),side=qK(2)*2.*(d<0.?1.-qK(3):qK(3)),ad=abs(d);
    kH=ad<=half_?1.:side<1e-4?0.:1.-smoothstep(half_,half_+side,ad);
    if(qK(4)-qK(6)<=.001)kH=1.+(kH-1.)*smoothstep(0.,.05,s);
  }
  float kS=qK(13)>.5?qWin(s,qK(4),qK(5),qK(6),qK(7)):1.;
  float kL=qK(14)>.5?qWin(Yc,qK(8),qK(9),qK(10),qK(11)):1.;
  float k=clamp((kH*kS*kL-qK(16))/max(1e-4,qK(17)-qK(16)),0.,1.);
  return qK(15)>.5?1.-k:k;
}
vec3 qualCorrect(vec3 c){
  vec3 L=gLin(c)*qC(2)*vec3(qC(3),qC(4),qC(5));
  float m=max(L.r,max(L.g,L.b));
  vec3 O=gSrgb(m>1.?L/m:L);
  float Y=gLuma(O),Yc=clamp(Y,0.,1.);
  vec2 cc=vec2((O.b-Y)/1.8556,(O.r-Y)/1.5748);float C=length(cc);
  if(C>1e-6&&(qC(0)!=0.||qC(1)!=1.)){
    float a=atan(cc.y,cc.x)+qC(0);vec2 dir=vec2(cos(a),sin(a));
    O=gFromYcc(Y,dir*min(C*qC(1),gMaxC(Yc,dir.x,dir.y)));
  }
  return O;
}
vec3 colourQual(vec3 c,vec3 src){
  if(!uHasQual)return c;
  float k=qualKey(src);
  if(uQView>1.5)return vec3(k);
  vec3 O=k>0.?qualCorrect(c):c;
  float Y0=gLuma(c)*.85;
  vec3 c1=uQView>.5?Y0+(c-Y0)*k:c;
  return mix(c1,O,k);
}`;

export function bindQual(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, F: QualFast | null) {
  gl.uniform1i(u('uHasQual'), F ? 1 : 0);
  if (!F) return;
  const k = new Float32Array(20); k.set(F.k);
  const c = new Float32Array(8); c.set(F.corr);
  gl.uniform4fv(u('uQK4[0]'), k);
  gl.uniform4fv(u('uQC4[0]'), c);
  gl.uniform1f(u('uQView'), F.view);
}

/* ── 滴管 ─────────────────────────────────────────────── */
type Sample = { h: number; s: number; l: number };
const sampleOf = (r: number, g: number, b: number): Sample => {
  const Y = KR * r + KG * g + KB * b, cb = (b - Y) / 1.8556, cr = (r - Y) / 1.5748, C = Math.hypot(cb, cr);
  const Yc = Math.min(1, Math.max(0, Y));
  const s = C > 1e-6 ? Math.min(1, C / maxChroma(Yc, cb / C, cr / C)) : 0;
  let h = (Math.atan2(cr, cb) * 180) / Math.PI; if (h < 0) h += 360;
  return { h, s, l: Yc };
};
const wrap = (d: number) => ((d + 540) % 360) - 180;
/** px：取樣到的原始顏色（0..1 RGB 陣列）。mode：取代／加入／排除 */
export function pickQual(q: Qual, px: number[][], mode: 'set' | 'add' | 'sub'): Qual {
  const S = px.map(p => sampleOf(p[0], p[1], p[2]));
  if (!S.length) return q;
  const out = { ...q };
  const sMin = Math.min(...S.map(x => x.s)), sMax = Math.max(...S.map(x => x.s));
  const lMin = Math.min(...S.map(x => x.l)), lMax = Math.max(...S.map(x => x.l));
  // 以飽和度加權的圓周平均
  let sx = 0, sy = 0;
  for (const x of S) { const w = x.s + 1e-3; sx += Math.cos((x.h * Math.PI) / 180) * w; sy += Math.sin((x.h * Math.PI) / 180) * w; }
  const mean = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const spread = Math.max(...S.map(x => Math.abs(wrap(x.h - mean))));
  if (mode === 'set') {
    out.hc = mean; out.hw = Math.min(360, 2 * spread + 4); out.hs = Math.max(3, out.hw / 4); out.hsym = 50;
    out.slo = Math.max(0, (sMin - 0.02) * 100); out.shi = Math.min(100, (sMax + 0.02) * 100); out.sls = 5; out.shs = 5;
    out.llo = Math.max(0, (lMin - 0.02) * 100); out.lhi = Math.min(100, (lMax + 0.02) * 100); out.lls = 5; out.lhs = 5;
    // 取樣很接近灰色時色相不可靠：不限制色相
    out.useH = sMax > 0.04; out.useS = true; out.useL = true;
    return out;
  }
  if (mode === 'add') {
    // 色相：涵蓋原本的弧與新的取樣的最小弧
    const lo0 = q.hc - q.hw / 2, hi0 = q.hc + q.hw / 2;
    let lo = lo0, hi = hi0;
    for (const x of S) {
      const d = wrap(x.h - q.hc);
      if (d < lo - q.hc) lo = q.hc + d - 2;
      if (d > hi - q.hc) hi = q.hc + d + 2;
    }
    out.hw = Math.min(360, hi - lo); out.hc = (((lo + hi) / 2) % 360 + 360) % 360;
    out.slo = Math.min(q.slo, Math.max(0, (sMin - 0.02) * 100)); out.shi = Math.max(q.shi, Math.min(100, (sMax + 0.02) * 100));
    out.llo = Math.min(q.llo, Math.max(0, (lMin - 0.02) * 100)); out.lhi = Math.max(q.lhi, Math.min(100, (lMax + 0.02) * 100));
    return out;
  }
  // 排除：在「代價最小」的那一維把最近的邊界收到剛好排除
  const cand: { cost: number; apply: () => void }[] = [];
  {
    const d = S.map(x => wrap(x.h - q.hc));
    const inside = d.filter(v => Math.abs(v) <= q.hw / 2);
    if (inside.length && q.useH && q.hw < 360) {
      const right = Math.min(...inside.filter(v => v >= 0).concat([q.hw / 2]));
      const left = Math.max(...inside.filter(v => v < 0).concat([-q.hw / 2]));
      const cutR = q.hw / 2 - right, cutL = left + q.hw / 2;
      if (cutR <= cutL) cand.push({ cost: cutR / Math.max(1, q.hw), apply: () => { const hi = q.hc + right - 2, lo = q.hc - q.hw / 2; out.hw = Math.max(1, hi - lo); out.hc = ((lo + hi) / 2 + 360) % 360; } });
      else cand.push({ cost: cutL / Math.max(1, q.hw), apply: () => { const lo = q.hc + left + 2, hi = q.hc + q.hw / 2; out.hw = Math.max(1, hi - lo); out.hc = ((lo + hi) / 2 + 360) % 360; } });
    }
  }
  const range = (lo: number, hi: number, vmin: number, vmax: number, set: (lo: number, hi: number) => void) => {
    const span = Math.max(1e-3, hi - lo);
    if (vmax * 100 > lo && vmin * 100 < hi) {
      cand.push({ cost: (hi - vmin * 100 + 2) / span, apply: () => set(lo, Math.max(lo + 1, vmin * 100 - 2)) });
      cand.push({ cost: (vmax * 100 + 2 - lo) / span, apply: () => set(Math.min(hi - 1, vmax * 100 + 2), hi) });
    }
  };
  range(q.slo, q.shi, sMin, sMax, (lo, hi) => { out.slo = lo; out.shi = hi; out.useS = true; });
  range(q.llo, q.lhi, lMin, lMax, (lo, hi) => { out.llo = lo; out.lhi = hi; out.useL = true; });
  cand.sort((a, b) => a.cost - b.cost);
  cand[0]?.apply();
  return out;
}
