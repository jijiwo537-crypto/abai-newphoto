/* 色彩切片（DaVinci Resolve 19 的 ColorSlice）。
 *
 * 照向量示波器的六個向量（紅、黃、綠、青、藍、洋紅）把色輪切成六片，再加一片膚色。
 *  · 每一片：中心（把這片的位置沿色輪挪動）、色相（這片顏色轉多少）、飽和度、密度。
 *  · 全域：密度、密度深度、飽和度、飽和度平衡、飽和度深度。
 *
 * 做法（Blackmagic 沒公開數學，以下是照官方描述與研究資料的實作）：
 *  1. 切片之間用 smoothstep 在相鄰兩個中心之間內插：任何色相的權重加起來都是 1，
 *     而且全部歸零時是完全不變。膚色片夾在紅與黃之間，所以靠紅那側比較窄（官方說的「重疊區」）。
 *     色相在灰色上沒有意義，所以切片的作用乘上灰色保護 n(c)。
 *  2. 色相：在 Cb/Cr 平面旋轉，亮度 Y′ 不變。
 *  3. 減色飽和度（Subtractive Saturation）：在線性光裡算。N＝最大通道、ρ＝各通道÷N，
 *     out ＝ N·ρ^S —— 飽和度提高時是「另外兩個通道往下掉」，像染料，越飽和越深、絕不會變亮。
 *     灰色 ρ＝1，不受影響。飽和度平衡在「保持最大通道（純減色）」與「保持亮度（加色）」之間混合。
 *     飽和度深度讓這個效果在亮處淡出。（同 thatcherfreeman 的 Subtractive Saturation DCTL）
 *  4. 密度：越飽和的顏色在線性光裡壓越多光（2^−1.5·D·s^1.5 檔），像底片的染料密度；
 *     密度深度控制亮處受不受影響。灰色（s＝0）完全不動。 */

import { KR, KG, KB, toLin, toSrgb, sstep, fromYcc, VEC_ANGLE } from './common';

export type SliceId = 'r' | 'skin' | 'y' | 'g' | 'c' | 'b' | 'm';
export type SliceVec = { center: number; hue: number; sat: number; den: number };
export type Slice = { vec: Record<SliceId, SliceVec>; density: number; depth: number; sat: number; balance: number; satDepth: number };

/** 依色環順序（洋紅 50° 起） */
export const SLICES: { id: SliceId; label: string; base: number; centerMax: number }[] = [
  { id: 'r', label: '紅', base: VEC_ANGLE.r, centerMax: 30 },
  { id: 'skin', label: '膚色', base: VEC_ANGLE.skin, centerMax: 20 },
  { id: 'y', label: '黃', base: VEC_ANGLE.y, centerMax: 30 },
  { id: 'g', label: '綠', base: VEC_ANGLE.g, centerMax: 30 },
  { id: 'c', label: '青', base: VEC_ANGLE.c, centerMax: 30 },
  { id: 'b', label: '藍', base: VEC_ANGLE.b, centerMax: 30 },
  { id: 'm', label: '洋紅', base: VEC_ANGLE.m, centerMax: 30 },
];
export const SLICE_SPEC = {
  center: { def: 0, min: -30, max: 30, digits: 1, span: 30 },
  hue: { def: 0, min: -60, max: 60, digits: 1, span: 60 },
  sat: { def: 1, min: 0, max: 2, digits: 2, span: 1 },
  den: { def: 0, min: -1, max: 1, digits: 2, span: 1 },
  density: { def: 0, min: -1, max: 1, digits: 2, span: 1 },
  depth: { def: 0.5, min: 0, max: 1, digits: 2, span: 1 },
  gsat: { def: 1, min: 0, max: 2, digits: 2, span: 1 },
  balance: { def: 0.5, min: 0, max: 1, digits: 2, span: 1 },
  satDepth: { def: 0.5, min: 0, max: 1, digits: 2, span: 1 },
};
export const freshSlice = (): Slice => ({
  vec: Object.fromEntries(SLICES.map(s => [s.id, { center: 0, hue: 0, sat: 1, den: 0 }])) as Record<SliceId, SliceVec>,
  density: 0, depth: 0.5, sat: 1, balance: 0.5, satDepth: 0.5,
});
const EPS = 1e-6;
export const isSliceVecNeutral = (v: SliceVec | undefined) => !v || (Math.abs(v.hue) < EPS && Math.abs(v.sat - 1) < EPS && Math.abs(v.den) < EPS);
export const isSliceIdentity = (s: Partial<Slice> | undefined | null) =>
  !s || (!!s.vec ? SLICES.every(d => isSliceVecNeutral(s.vec![d.id])) : true) && Math.abs((s.density ?? 0)) < EPS && Math.abs((s.sat ?? 1) - 1) < EPS;

export type SliceFast = {
  /** 7 片依角度排好：中心角（弧度，遞增、跨 2π 循環）、色相（弧度）、飽和度、密度、原本的索引 */
  c: Float32Array; p: Float32Array; // p: 7 × 4（hue, sat, den, idx）
  g: Float32Array;                  // density, depth, sat, balance, satDepth
  /** 只看某一片的範圍（-1 ＝ 不看）。只在按住「顯示範圍」時才會有，不會存進作品 */
  hl: number;
};
export function makeSlice(s: Partial<Slice> | undefined | null, hl = -1): SliceFast | null {
  if (isSliceIdentity(s) && hl < 0) return null;
  const v = s!.vec!;
  const items = SLICES.map((d, i) => ({ a: d.base + Math.max(-d.centerMax, Math.min(d.centerMax, v[d.id].center)), i, d }));
  items.sort((p, q) => p.a - q.a);
  // 中心不能交錯也不能重疊：至少隔 2°
  for (let k = 1; k < items.length; k++) if (items[k].a - items[k - 1].a < 2) { const m = (items[k].a + items[k - 1].a) / 2; items[k - 1].a = m - 1; items[k].a = m + 1; }
  const c = new Float32Array(7), p = new Float32Array(28);
  items.forEach((it, k) => {
    const vv = v[it.d.id];
    c[k] = (it.a * Math.PI) / 180;
    p.set([(vv.hue * Math.PI) / 180, vv.sat, vv.den, it.i], k * 4);
  });
  return { c, p, g: Float32Array.from([s!.density ?? 0, s!.depth ?? 0.5, s!.sat ?? 1, s!.balance ?? 0.5, s!.satDepth ?? 0.5]), hl };
}

/** 這個角度落在哪兩片之間、靠後那片的權重 u（兩片權重 1−u、u） */
function locate(F: SliceFast, ang: number): [number, number, number] {
  const c = F.c, TWO = Math.PI * 2;
  let a = ang;
  while (a < c[0]) a += TWO;
  while (a >= c[0] + TWO) a -= TWO;
  let k = 6;
  for (let i = 0; i < 6; i++) if (a < c[i + 1]) { k = i; break; }
  const a0 = c[k], a1 = k === 6 ? c[0] + TWO : c[k + 1];
  const t = (a - a0) / (a1 - a0), u = t * t * (3 - 2 * t);
  return [k, k === 6 ? 0 : k + 1, u];
}

const L = [0, 0, 0];
export function applySlice(F: SliceFast, c: number[]) {
  const Y = KR * c[0] + KG * c[1] + KB * c[2];
  const cb = (c[2] - Y) / 1.8556, cr = (c[0] - Y) / 1.5748;
  const C = Math.hypot(cb, cr), n = sstep(0, 0.05, C);
  const ang = Math.atan2(cr, cb);
  const [ka, kb, u] = locate(F, ang);
  const P = F.p, A = ka * 4, B = kb * 4;
  if (F.hl >= 0) {
    // 只顯示某一片影響的範圍：範圍外變灰
    const w = ((P[A + 3] === F.hl ? 1 - u : 0) + (P[B + 3] === F.hl ? u : 0)) * n;
    for (let i = 0; i < 3; i++) c[i] = Y + (c[i] - Y) * w;
    return;
  }
  const hue = (P[A] * (1 - u) + P[B] * u) * n;
  const sS = 1 + ((P[A + 1] * (1 - u) + P[B + 1] * u) - 1) * n;
  const dS = (P[A + 2] * (1 - u) + P[B + 2] * u) * n;
  // 2）色相
  if (hue !== 0) { const a2 = ang + hue; fromYcc(Y, Math.cos(a2) * C, Math.sin(a2) * C, c); }
  for (let i = 0; i < 3; i++) L[i] = toLin(Math.min(1, Math.max(0, c[i])));
  const [gDen, depth, gSat, bal, sDepth] = F.g as unknown as number[];
  const Yl = KR * L[0] + KG * L[1] + KB * L[2];
  // 3）減色飽和度
  const S = gSat * sS;
  const N = Math.max(L[0], L[1], L[2]);
  if (N > 1e-6 && Math.abs(S - 1) > 1e-6) {
    const Se = Math.max(0, 1 + (S - 1) * (1 + (1 - Math.sqrt(Yl) - 1) * sDepth));
    const sub = [0, 0, 0];
    for (let i = 0; i < 3; i++) sub[i] = N * Math.pow(L[i] / N, Se);
    const Ys = KR * sub[0] + KG * sub[1] + KB * sub[2];
    const k = Ys > 1e-6 ? Yl / Ys : 1;
    for (let i = 0; i < 3; i++) L[i] = sub[i] * k + (sub[i] - sub[i] * k) * bal;
    const m = Math.max(L[0], L[1], L[2]);
    if (m > 1) for (let i = 0; i < 3; i++) L[i] /= m;
  }
  // 4）密度
  const D = gDen + dS;
  if (D !== 0) {
    const N2 = Math.max(L[0], L[1], L[2]);
    if (N2 > 1e-6) {
      const s = 1 - Math.min(L[0], L[1], L[2]) / N2;
      const Y2 = KR * L[0] + KG * L[1] + KB * L[2];
      const wd = 1 + ((1 - sstep(0.2, 1, Y2)) - 1) * (1 - depth);
      const k = Math.pow(2, -1.5 * D * Math.pow(s, 1.5) * wd);
      for (let i = 0; i < 3; i++) L[i] = Math.min(1, L[i] * k);
    }
  }
  for (let i = 0; i < 3; i++) c[i] = toSrgb(L[i]);
}

export const SLICE_GLSL = `
uniform bool uHasSlice;
uniform float uSlC[7];
uniform vec4 uSlP[7];
uniform float uSlG[5];
uniform float uSlHl;
vec3 colourSlice(vec3 c){
  if(!uHasSlice)return c;
  float Y=gLuma(c);
  vec2 cc=vec2((c.b-Y)/1.8556,(c.r-Y)/1.5748);
  float C=length(cc),n=smoothstep(0.,.05,C),ang=atan(cc.y,cc.x);
  float a=ang;
  for(int i=0;i<3;i++){if(a<uSlC[0])a+=6.28318530718;}
  for(int i=0;i<3;i++){if(a>=uSlC[0]+6.28318530718)a-=6.28318530718;}
  int k=6;
  for(int i=0;i<6;i++){if(a<uSlC[i+1]){k=i;break;}}
  int kb=k==6?0:k+1;
  float a0=uSlC[k],a1=k==6?uSlC[0]+6.28318530718:uSlC[k+1];
  float t=(a-a0)/(a1-a0),u=t*t*(3.-2.*t);
  vec4 PA=uSlP[k],PB=uSlP[kb];
  if(uSlHl>=0.){
    float w=((abs(PA.w-uSlHl)<.5?1.-u:0.)+(abs(PB.w-uSlHl)<.5?u:0.))*n;
    return Y+(c-Y)*w;
  }
  float hue=mix(PA.x,PB.x,u)*n;
  float sS=1.+(mix(PA.y,PB.y,u)-1.)*n;
  float dS=mix(PA.z,PB.z,u)*n;
  if(hue!=0.){float a2=ang+hue;c=gFromYcc(Y,vec2(cos(a2),sin(a2))*C);}
  vec3 L=gLin(c);
  float Yl=gLuma(L);
  float S=uSlG[2]*sS;
  float N=max(L.r,max(L.g,L.b));
  if(N>1e-6&&abs(S-1.)>1e-6){
    float Se=max(0.,1.+(S-1.)*(1.+(1.-sqrt(Yl)-1.)*uSlG[4]));
    vec3 sub=N*pow(L/N,vec3(Se));
    float Ys=gLuma(sub);
    float kk=Ys>1e-6?Yl/Ys:1.;
    L=sub*kk+(sub-sub*kk)*uSlG[3];
    float m=max(L.r,max(L.g,L.b));
    if(m>1.)L/=m;
  }
  float D=uSlG[0]+dS;
  if(D!=0.){
    float N2=max(L.r,max(L.g,L.b));
    if(N2>1e-6){
      float s=1.-min(L.r,min(L.g,L.b))/N2;
      float wd=1.+((1.-smoothstep(.2,1.,gLuma(L)))-1.)*(1.-uSlG[1]);
      L=min(L*exp2(-1.5*D*pow(s,1.5)*wd),1.);
    }
  }
  return gSrgb(L);
}`;

export function bindSlice(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, F: SliceFast | null) {
  gl.uniform1i(u('uHasSlice'), F ? 1 : 0);
  if (!F) return;
  gl.uniform1fv(u('uSlC[0]'), F.c);
  gl.uniform4fv(u('uSlP[0]'), F.p);
  gl.uniform1fv(u('uSlG[0]'), F.g);
  gl.uniform1f(u('uSlHl'), F.hl);
}
