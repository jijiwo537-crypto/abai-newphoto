/* 色彩扭曲器（DaVinci Resolve 的 Color Warper）：兩張網格。
 *
 * 色相－飽和度（極座標網格）
 *  · 一圈一圈是飽和度（環），一條一條是色相（欄），第一條欄對齊紅色向量。
 *  · 中心點與最外圈鎖住（灰色永遠是灰色、色域邊界不會被拉出去）—— 跟 Resolve 一樣。
 *  · 拖一個點＝把「那個顏色」搬到新的位置；點與點之間用 Catmull-Rom（色相方向循環、
 *    飽和度方向穿過中心）平滑內插，所以周圍的顏色會被一起柔和地帶過去，
 *    一直到最近的鎖住點為止。每個點另外有亮度（檔，線性光增益）。
 *  · 位移存成平面上的向量 (Δa, Δb)，a＝s·cosθ、b＝s·sinθ，s 是 0..1 的飽和度（÷色域邊界）。
 *    每個點的位移限制在格子寬度的 0.45 倍內，網格不會翻折。
 *
 * 色度－亮度（直角網格）
 *  · 橫軸：沿某條色軸（預設是膚色線 123°，也就是橙－青軸）的帶正負號色度；縱軸：亮度。
 *  · 拖點左右＝在那個亮度、那段色度上往色軸的某一端偏色；上下＝改那裡的亮度。四邊鎖住。
 *
 * 兩張網格都先在 CPU 用樣條算成一張細表（色相 96 × 飽和度 33、色度 96 × 亮度 24），
 * CPU 與 GPU 都從同一張表雙線性取值，兩邊結果一致；拖曳中只重算這張小表。 */

import { KR, KG, KB, toLin, toSrgb, sstep, maxChroma, fromYcc, VEC_ANGLE, deg } from './common';

export type WarpPt = { da: number; db: number; dl: number };
export type Warp = {
  nh: number; ns: number;                 // 色相欄數、飽和度環數
  hs: Record<string, WarpPt>;             // "欄,環" → 位移
  hsPins: string[];
  nx: number; ny: number; axis: number;   // 色度－亮度網格、色軸角度（度）
  cl: Record<string, { dx: number; dl: number }>;
  clPins: string[];
};
export const WARP_HUE_RES = [6, 8, 12, 16, 24];
export const WARP_SAT_RES = [4, 6, 8];
export const freshWarp = (): Warp => ({ nh: 12, ns: 6, hs: {}, hsPins: [], nx: 8, ny: 8, axis: VEC_ANGLE.skin, cl: {}, clPins: [] });
const EPS = 1e-6;
export const isWarpIdentity = (w: Partial<Warp> | undefined | null) => !w
  || (Object.values(w.hs || {}).every(p => Math.abs(p.da) < EPS && Math.abs(p.db) < EPS && Math.abs(p.dl) < EPS)
    && Object.values(w.cl || {}).every(p => Math.abs(p.dx) < EPS && Math.abs(p.dl) < EPS));

export const THETA0 = VEC_ANGLE.r;
export const FH = 96, FS = 33, FX = 96, FY = 24;
/** 欄 j 的色相角（度） */
export const colAngle = (nh: number, j: number) => THETA0 + (360 * j) / nh;
/** 網格點原本的位置（a, b） */
export function hsHome(nh: number, ns: number, j: number, k: number): [number, number] {
  const a = deg(colAngle(nh, j)), s = k / ns;
  return [s * Math.cos(a), s * Math.sin(a)];
}
/** 這個點能不能動：中心與最外圈鎖住 */
export const hsLocked = (ns: number, k: number) => k <= 0 || k >= ns;
export const clLocked = (nx: number, ny: number, i: number, j: number) => i <= 0 || j <= 0 || i >= nx || j >= ny;

/** Catmull-Rom 權重 */
function crw(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

/** 把網格點的位移算成細表（RGBA：色相－飽和度在前 FS 列，色度－亮度在後 FY 列） */
export function buildWarpTable(w: Warp): Float32Array {
  const T = new Float32Array(FH * (FS + FY) * 4);
  const nh = w.nh, ns = w.ns;
  const hsAt = (j: number, k: number): WarpPt => {
    if (k < 0) { j += nh / 2; k = -k; }             // 穿過中心：對面那一欄的同一環
    if (k === 0 || k >= ns) return { da: 0, db: 0, dl: 0 };
    j = ((j % nh) + nh) % nh;
    return w.hs[`${Math.round(j)},${k}`] || { da: 0, db: 0, dl: 0 };
  };
  for (let fy = 0; fy < FS; fy++) {
    const v = (fy / (FS - 1)) * ns, k0 = Math.floor(Math.min(v, ns - 1e-9)), tv = v - k0;
    const wv = crw(tv);
    for (let fx = 0; fx < FH; fx++) {
      const uu = (fx / FH) * nh, j0 = Math.floor(uu), tu = uu - j0;
      const wu = crw(tu);
      let da = 0, db = 0, dl = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const p = hsAt(j0 - 1 + a, k0 - 1 + b), ww = wu[a] * wv[b];
        if (ww === 0) continue;
        da += p.da * ww; db += p.db * ww; dl += p.dl * ww;
      }
      const o = (fy * FH + fx) * 4;
      T[o] = da; T[o + 1] = db; T[o + 2] = dl;
    }
  }
  const nx = w.nx, ny = w.ny;
  const clAt = (i: number, j: number) => {
    if (i <= 0 || j <= 0 || i >= nx || j >= ny) return { dx: 0, dl: 0 };
    return w.cl[`${i},${j}`] || { dx: 0, dl: 0 };
  };
  for (let fy = 0; fy < FY; fy++) {
    const v = (fy / (FY - 1)) * ny, j0 = Math.floor(Math.min(v, ny - 1e-9)), wv = crw(v - j0);
    for (let fx = 0; fx < FX; fx++) {
      const uu = (fx / (FX - 1)) * nx, i0 = Math.floor(Math.min(uu, nx - 1e-9)), wu = crw(uu - i0);
      let dx = 0, dl = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const p = clAt(i0 - 1 + a, j0 - 1 + b), ww = wu[a] * wv[b];
        dx += p.dx * ww; dl += p.dl * ww;
      }
      const o = ((FS + fy) * FX + fx) * 4;
      T[o] = dx; T[o + 1] = dl;
    }
  }
  return T;
}

export type WarpFast = { tab: Float32Array; axis: number; hasCl: boolean };
export function makeWarp(w: Partial<Warp> | undefined | null): WarpFast | null {
  if (isWarpIdentity(w)) return null;
  const ww = w as Warp;
  return { tab: buildWarpTable(ww), axis: deg(ww.axis), hasCl: Object.values(ww.cl || {}).some(p => Math.abs(p.dx) > EPS || Math.abs(p.dl) > EPS) };
}

/** 從細表雙線性取值（色相方向循環） */
function hsSample(T: Float32Array, u: number, v: number, out: number[]) {
  let x = (u - Math.floor(u)) * FH; const x0 = Math.floor(x); x -= x0; const x1 = (x0 + 1) % FH;
  let y = Math.min(1, Math.max(0, v)) * (FS - 1); const y0 = Math.min(FS - 2, Math.floor(y)); y -= y0;
  for (let c = 0; c < 3; c++) {
    const a = T[(y0 * FH + x0) * 4 + c], b = T[(y0 * FH + x1) * 4 + c], d = T[((y0 + 1) * FH + x0) * 4 + c], e = T[((y0 + 1) * FH + x1) * 4 + c];
    out[c] = (a + (b - a) * x) * (1 - y) + (d + (e - d) * x) * y;
  }
}
function clSample(T: Float32Array, u: number, v: number, out: number[]) {
  let x = Math.min(1, Math.max(0, u)) * (FX - 1); const x0 = Math.min(FX - 2, Math.floor(x)); x -= x0;
  let y = Math.min(1, Math.max(0, v)) * (FY - 1); const y0 = Math.min(FY - 2, Math.floor(y)); y -= y0;
  for (let c = 0; c < 2; c++) {
    const r = (FS + y0) * FX;
    const a = T[(r + x0) * 4 + c], b = T[(r + x0 + 1) * 4 + c], d = T[(r + FX + x0) * 4 + c], e = T[(r + FX + x0 + 1) * 4 + c];
    out[c] = (a + (b - a) * x) * (1 - y) + (d + (e - d) * x) * y;
  }
}

const D = [0, 0, 0];
export function applyWarp(F: WarpFast, c: number[]) {
  let Y = KR * c[0] + KG * c[1] + KB * c[2];
  const Yc = Math.min(1, Math.max(0, Y));
  const cb = (c[2] - Y) / 1.8556, cr = (c[0] - Y) / 1.5748;
  const C = Math.hypot(cb, cr), ang = Math.atan2(cr, cb);
  const ca = C > 1e-6 ? cb / C : 1, sa = C > 1e-6 ? cr / C : 0;
  const s = Math.min(1, C / maxChroma(Yc, ca, sa));
  let a = s * ca, b = s * sa;
  // 色相－飽和度
  const u = (ang - deg(THETA0)) / (Math.PI * 2);
  hsSample(F.tab, u, s, D);
  a += D[0]; b += D[1];
  let gain = D[2];
  // 色度－亮度
  if (F.hasCl) {
    const ax = Math.cos(F.axis), ay = Math.sin(F.axis);
    const x = a * ax + b * ay;
    clSample(F.tab, (x + 1) / 2, Yc, D);
    a += D[0] * ax; b += D[0] * ay;
    Y += D[1] * 0.25;
  }
  const s2 = Math.min(1, Math.hypot(a, b));
  const a2 = Math.atan2(b, a);
  const Y2 = Math.min(1, Math.max(0, Y));
  const C2 = s2 * maxChroma(Y2, Math.cos(a2), Math.sin(a2));
  fromYcc(Y2, Math.cos(a2) * C2, Math.sin(a2) * C2, c);
  if (gain !== 0) {
    gain *= sstep(0, 0.05, C);
    const k = Math.pow(2, gain);
    for (let i = 0; i < 3; i++) c[i] = toSrgb(Math.min(1, toLin(Math.min(1, Math.max(0, c[i]))) * k));
  }
}

export const WARP_GLSL = `
uniform bool uHasWarp;
uniform bool uWarpCl;
uniform vec2 uWarpAxis;
uniform sampler2D uGWarp;
vec4 wpFetch(int x,int y){return texelFetch(uGWarp,ivec2(x,y),0);}
vec3 wpHs(float u,float v){
  float x=fract(u)*${FH}.;int x0=int(floor(x));x-=float(x0);int x1=(x0+1)%${FH};x0=x0%${FH};
  float y=clamp(v,0.,1.)*${FS - 1}.;int y0=min(${FS - 2},int(floor(y)));y-=float(y0);
  vec3 a=wpFetch(x0,y0).rgb,b=wpFetch(x1,y0).rgb,d=wpFetch(x0,y0+1).rgb,e=wpFetch(x1,y0+1).rgb;
  return mix(mix(a,b,x),mix(d,e,x),y);
}
vec2 wpCl(float u,float v){
  float x=clamp(u,0.,1.)*${FX - 1}.;int x0=min(${FX - 2},int(floor(x)));x-=float(x0);
  float y=clamp(v,0.,1.)*${FY - 1}.;int y0=min(${FY - 2},int(floor(y)));y-=float(y0);
  int r=${FS};
  vec2 a=wpFetch(x0,r+y0).rg,b=wpFetch(x0+1,r+y0).rg,d=wpFetch(x0,r+y0+1).rg,e=wpFetch(x0+1,r+y0+1).rg;
  return mix(mix(a,b,x),mix(d,e,x),y);
}
vec3 colourWarp(vec3 c){
  if(!uHasWarp)return c;
  float Y=gLuma(c),Yc=clamp(Y,0.,1.);
  vec2 cc=vec2((c.b-Y)/1.8556,(c.r-Y)/1.5748);
  float C=length(cc),ang=atan(cc.y,cc.x);
  float ca=C>1e-6?cc.x/C:1.,sa=C>1e-6?cc.y/C:0.;
  float s=min(1.,C/gMaxC(Yc,ca,sa));
  vec2 ab=s*vec2(ca,sa);
  vec3 d=wpHs((ang-${deg(THETA0).toFixed(8)})/6.28318530718,s);
  ab+=d.xy;
  float gain=d.z;
  if(uWarpCl){
    float x=dot(ab,uWarpAxis);
    vec2 e=wpCl((x+1.)*.5,Yc);
    ab+=e.x*uWarpAxis;
    Y+=e.y*.25;
  }
  float s2=min(1.,length(ab)),a2=atan(ab.y,ab.x);
  float Y2=clamp(Y,0.,1.);
  vec2 dir=vec2(cos(a2),sin(a2));
  vec3 o=gFromYcc(Y2,dir*s2*gMaxC(Y2,dir.x,dir.y));
  if(gain!=0.)o=gSrgb(min(gLin(o)*exp2(gain*smoothstep(0.,.05,C)),1.));
  return o;
}`;

export function bindWarp(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, F: WarpFast | null) {
  gl.uniform1i(u('uHasWarp'), F ? 1 : 0);
  if (!F) return;
  gl.uniform1i(u('uWarpCl'), F.hasCl ? 1 : 0);
  gl.uniform2f(u('uWarpAxis'), Math.cos(F.axis), Math.sin(F.axis));
}
