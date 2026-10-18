/* HDR 色輪（DaVinci Resolve 的 HDR 調色板）。
 *
 * 六個區域，由暗到亮：黑色 Black、暗部 Dark、陰影 Shadow、亮部 Light、高光 Highlight、
 * 鏡面高光 Specular，再加一個全域 Global。每個色輪：色彩平衡（X/Y 拖點）、曝光（檔）、飽和度。
 * 每個區域有自己的「範圍」（以中灰 18% 為 0 的曝光檔數）與「柔化」（邊界過渡寬度，檔）。
 *
 * 跟 Resolve 一樣：
 *  · 區域用場景線性光的曝光檔數來分：ev = log2(Y_linear / 0.18)。
 *    暗區域＝ev 低於範圍的部分（1 − smoothstep），亮區域＝ev 高於範圍的部分（smoothstep），
 *    柔化就是 smoothstep 的寬度。區域彼此重疊、效果疊加（陰影與亮部在中灰附近重疊約 1.5 檔）。
 *  · 所有調整都是線性光裡的增益（乘光量）：曝光＝2^檔，色彩平衡＝各通道不同的檔數
 *    （零亮度的色差方向，推顏色不會讓畫面變亮變暗）。
 *  · 區域的權重用「進來時」的亮度算，所以先調哪個都一樣；全域在區域之後。
 *  · 增益完超過 1 的顏色，保持色相等比例收回（不會因為某個通道先爆掉而偏色）。
 *
 * 範圍預設值：Resolve 的預設是給場景線性 HDR 素材的（Specular 在 +4 檔左右），照片是
 * 顯示參照的 sRGB，白色只在中灰上 +2.47 檔，照搬的話高光、鏡面高光幾乎碰不到。
 * 所以照研究資料換算成 SDR 的範圍：黑 −3.5、暗 −2.0、陰影 +0.75、亮 −0.75、高光 +1.5、鏡面 +2.2，
 * 柔化都是 0.75 檔。 */

import { KR, KG, KB, toLin, toSrgb, sstep } from './common';

export type HdrZoneId = 'black' | 'dark' | 'shadow' | 'light' | 'highlight' | 'specular';
export type HdrWheel = { x: number; y: number; exp: number; sat: number };
export type HdrZone = HdrWheel & { range: number; falloff: number };
export type Hdr = Record<HdrZoneId, HdrZone> & { global: HdrWheel };
export const HDR_ZONES: { id: HdrZoneId; label: string; dark: boolean; range: number }[] = [
  { id: 'black', label: '黑色', dark: true, range: -3.5 },
  { id: 'dark', label: '暗部', dark: true, range: -2.0 },
  { id: 'shadow', label: '陰影', dark: true, range: 0.75 },
  { id: 'light', label: '亮部', dark: false, range: -0.75 },
  { id: 'highlight', label: '高光', dark: false, range: 1.5 },
  { id: 'specular', label: '鏡面高光', dark: false, range: 2.2 },
];
export const HDR_FALLOFF = 0.75;
export const HDR_IDS = [...HDR_ZONES.map(z => z.id), 'global'] as (HdrZoneId | 'global')[];
/** 色彩平衡拖到邊緣時的色差（Cb/Cr 單位，換成各通道約 ±1 檔） */
export const HDR_EDGE = 0.6;

export const freshHdr = (): Hdr => ({
  ...(Object.fromEntries(HDR_ZONES.map(z => [z.id, { x: 0, y: 0, exp: 0, sat: 1, range: z.range, falloff: HDR_FALLOFF }])) as Record<HdrZoneId, HdrZone>),
  global: { x: 0, y: 0, exp: 0, sat: 1 },
});
const EPS = 1e-6;
export const isHdrWheelNeutral = (w: HdrWheel | undefined) => !w || (Math.abs(w.x) < EPS && Math.abs(w.y) < EPS && Math.abs(w.exp) < EPS && Math.abs(w.sat - 1) < EPS);
export const isHdrIdentity = (h: Partial<Hdr> | undefined | null) => !h || HDR_IDS.every(id => isHdrWheelNeutral(h[id] as HdrWheel));

/** 色彩平衡 (x, y) → 三個通道的檔數（零亮度方向） */
function balanceStops(x: number, y: number): [number, number, number] {
  const cb = x * HDR_EDGE, cr = y * HDR_EDGE;
  const r = 1.5748 * cr, b = 1.8556 * cb, g = -(KR * r + KB * b) / KG;
  return [r, g, b];
}

export type HdrFast = {
  /** 每個區域：range、falloff、暗(1)/亮(0)、r g b 檔數、飽和度、作用中(1/0) */
  z: Float32Array;   // 6 × 8
  g: Float32Array;   // 全域：r g b 檔數、飽和度
};
export function makeHdr(h: Partial<Hdr> | undefined | null): HdrFast | null {
  if (isHdrIdentity(h)) return null;
  const z = new Float32Array(6 * 8);
  HDR_ZONES.forEach((d, i) => {
    const w = h![d.id] as HdrZone;
    const [r, g, b] = balanceStops(w.x, w.y);
    z.set([w.range, Math.max(0, w.falloff), d.dark ? 1 : 0, r + w.exp, g + w.exp, b + w.exp, w.sat, isHdrWheelNeutral(w) ? 0 : 1], i * 8);
  });
  const gw = h!.global as HdrWheel;
  const [r, g, b] = balanceStops(gw.x, gw.y);
  return { z, g: Float32Array.from([r + gw.exp, g + gw.exp, b + gw.exp, gw.sat]) };
}

/** 區域權重：暗區域＝ev 在範圍以下，亮區域＝ev 在範圍以上，柔化＝過渡寬度（檔） */
export function zoneWeight(ev: number, range: number, falloff: number, dark: boolean) {
  const t = falloff < 1e-3 ? (ev >= range ? 1 : 0) : sstep(range - falloff / 2, range + falloff / 2, ev);
  return dark ? 1 - t : t;
}
export const evOf = (Ylin: number) => Math.log2(Math.max(Ylin, 1 / 4096) / 0.18);

const L = [0, 0, 0];
export function applyHdr(F: HdrFast, c: number[]) {
  for (let i = 0; i < 3; i++) L[i] = toLin(Math.min(1, Math.max(0, c[i])));
  const ev = evOf(KR * L[0] + KG * L[1] + KB * L[2]);
  let gr = 0, gg = 0, gb = 0, S = 1;
  for (let i = 0; i < 6; i++) {
    const o = i * 8;
    if (!F.z[o + 7]) continue;
    const w = zoneWeight(ev, F.z[o], F.z[o + 1], F.z[o + 2] > 0.5);
    gr += w * F.z[o + 3]; gg += w * F.z[o + 4]; gb += w * F.z[o + 5];
    S *= 1 + (F.z[o + 6] - 1) * w;
  }
  L[0] *= Math.pow(2, gr); L[1] *= Math.pow(2, gg); L[2] *= Math.pow(2, gb);
  let Y = KR * L[0] + KG * L[1] + KB * L[2];
  for (let i = 0; i < 3; i++) L[i] = Math.max(0, Y + S * (L[i] - Y));
  // 全域
  L[0] *= Math.pow(2, F.g[0]); L[1] *= Math.pow(2, F.g[1]); L[2] *= Math.pow(2, F.g[2]);
  Y = KR * L[0] + KG * L[1] + KB * L[2];
  for (let i = 0; i < 3; i++) L[i] = Math.max(0, Y + F.g[3] * (L[i] - Y));
  // 超過 1 的時候等比例收回，色相不變
  const m = Math.max(L[0], L[1], L[2]);
  const k = m > 1 ? 1 / m : 1;
  for (let i = 0; i < 3; i++) c[i] = toSrgb(L[i] * k);
}

export const HDR_GLSL = `
uniform bool uHasHdr;
uniform vec4 uHdrZ[12];   // 每個區域兩格：(range, falloff, dark, r) (g, b, sat, on)
uniform vec4 uHdrG;
float hdrW(float ev,float range,float fo,bool dark){
  float t=fo<1e-3?step(range,ev):smoothstep(range-fo*.5,range+fo*.5,ev);
  return dark?1.-t:t;
}
vec3 hdrWheels(vec3 c){
  if(!uHasHdr)return c;
  vec3 L=gLin(c);
  float ev=log2(max(gLuma(L),1./4096.)/.18);
  vec3 G=vec3(0.);float S=1.;
  for(int i=0;i<6;i++){
    vec4 A=uHdrZ[i*2],B=uHdrZ[i*2+1];
    if(B.w<.5)continue;
    float w=hdrW(ev,A.x,max(A.y,0.),A.z>.5);
    G+=w*vec3(A.w,B.x,B.y);
    S*=1.+(B.z-1.)*w;
  }
  L*=exp2(G);
  float Y=gLuma(L);
  L=max(Y+S*(L-Y),0.);
  L*=exp2(uHdrG.xyz);
  Y=gLuma(L);
  L=max(Y+uHdrG.w*(L-Y),0.);
  float m=max(L.r,max(L.g,L.b));
  if(m>1.)L/=m;
  return gSrgb(L);
}`;

export function bindHdr(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, F: HdrFast | null) {
  gl.uniform1i(u('uHasHdr'), F ? 1 : 0);
  if (!F) return;
  gl.uniform4fv(u('uHdrZ[0]'), F.z);
  gl.uniform4fv(u('uHdrG'), F.g);
}
