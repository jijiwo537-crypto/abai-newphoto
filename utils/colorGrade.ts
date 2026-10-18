/* 調色階段（接在 HSL 之後）：把達芬奇那幾個調色板接成一條，存在 params.grade 裡。
 *
 *   HDR 色輪 → 一級色輪（暗部／中灰／亮部／偏移、Log 色輪）→ 色相／亮度／飽和度曲線
 *   → 色彩切片 → 色彩扭曲器 → 限定器（只在選到的範圍內再調一次）
 *
 * 順序跟 Resolve 一個節點裡各調色板的固定順序一致。每一個都是「逐像素、只看顏色」的運算，
 * 所以 CPU 可以整條烤進主查色表（utils/photoPixelCore），GPU 用同一組預先算好的數字
 * 在著色器裡逐像素算（utils/lutGpu），兩邊結果一致。各工具的數學在 utils/grade/ 底下。 */

import { freshWheels, isWheelsIdentity, makeWheels, applyWheels, WHEELS_GLSL, bindWheels, WHEEL_IDS, type Wheels, type WheelsFast } from './grade/wheels';
import { freshHueCurves, isHueCurvesIdentity, makeHueCurves, applyHueCurves, HUE_CURVES_GLSL, bindHueCurves, HUE_CURVE_IDS, type HueCurves, type HueCurvesFast } from './grade/hueCurves';
import { freshHdr, isHdrIdentity, makeHdr, applyHdr, HDR_GLSL, bindHdr, HDR_IDS, type Hdr, type HdrFast } from './grade/hdr';
import { freshSlice, isSliceIdentity, makeSlice, applySlice, SLICE_GLSL, bindSlice, SLICES, type Slice, type SliceFast } from './grade/slice';
import { freshWarp, isWarpIdentity, makeWarp, applyWarp, WARP_GLSL, bindWarp, FH, FS, FY, type Warp, type WarpFast } from './grade/warper';
import { freshQual, isQualCorrNeutral, makeQual, applyQual, qualCorrect, QUAL_GLSL, bindQual, type Qual, type QualFast, type QualView } from './grade/qualifier';
export { qualKey, qualBlend } from './grade/qualifier';
import { COMMON_GLSL } from './grade/common';

export * from './grade/wheels';

export type ColorGrade = Wheels & {
  hdr: Hdr;
  hc: HueCurves;
  slice: Slice;
  warp: Warp;
  qual: Qual;
  /** 只在按住「顯示範圍」時才有（色彩切片看哪一片、限定器的檢視方式），不會存進作品 */
  view?: { slice?: number; qual?: QualView };
};

export const freshGrade = (): ColorGrade => ({ ...freshWheels(), hdr: freshHdr(), hc: freshHueCurves(), slice: freshSlice(), warp: freshWarp(), qual: freshQual() });

const num = (v: any, d: number) => (Number.isFinite(v) ? v : d);
/** 補齊缺的欄位（舊作品、或舊版調色輪留下的格式） */
export function normGrade(g: any): ColorGrade {
  const out = freshGrade();
  if (!g || typeof g !== 'object') return out;
  for (const id of WHEEL_IDS) {
    const w = g[id];
    if (w && typeof w === 'object') for (const c of ['y', 'r', 'g', 'b'] as const) out[id][c] = num(w[c], out[id][c]);
  }
  if (g.hc && typeof g.hc === 'object') for (const id of HUE_CURVE_IDS) if (Array.isArray(g.hc[id])) out.hc[id] = g.hc[id].filter((p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (g.hdr && typeof g.hdr === 'object') for (const id of HDR_IDS) if (g.hdr[id]) out.hdr[id] = { ...out.hdr[id], ...g.hdr[id] } as any;
  if (g.slice && typeof g.slice === 'object') {
    out.slice = { ...out.slice, ...g.slice, vec: { ...out.slice.vec } };
    for (const s of SLICES) if (g.slice.vec?.[s.id]) out.slice.vec[s.id] = { ...out.slice.vec[s.id], ...g.slice.vec[s.id] };
  }
  if (g.warp && typeof g.warp === 'object') out.warp = { ...out.warp, ...g.warp };
  if (g.qual && typeof g.qual === 'object') out.qual = { ...out.qual, ...g.qual };
  if (g.view) out.view = g.view;
  return out;
}

export type GradeTool = 'wheels' | 'hdr' | 'curves' | 'slice' | 'warper' | 'qualifier';
const GRADE_TOOLS: GradeTool[] = ['wheels', 'hdr', 'curves', 'slice', 'warper', 'qualifier'];
export const isGradeToolIdentity = (g0: any, tool: GradeTool): boolean => {
  if (!g0) return true;
  const g = normGrade(g0);
  switch (tool) {
    case 'wheels': return isWheelsIdentity(g);
    case 'hdr': return isHdrIdentity(g.hdr);
    case 'curves': return isHueCurvesIdentity(g.hc);
    case 'slice': return isSliceIdentity(g.slice);
    case 'warper': return isWarpIdentity(g.warp);
    case 'qualifier': return isQualCorrNeutral(g.qual);
  }
};
export const isGradeIdentity = (g0: any): boolean =>
  !g0 || (GRADE_TOOLS.every(t => isGradeToolIdentity(g0, t)) && !(g0.view && ((g0.view.slice ?? -1) >= 0 || g0.view.qual)));

/** 預先算好的數字（CPU 與 GPU 共用）。沒有調任何東西時是 null。 */
export type GradeFast = {
  hdr: HdrFast | null;
  wheels: WheelsFast | null;
  hc: HueCurvesFast | null;
  slice: SliceFast | null;
  warp: WarpFast | null;
  qual: QualFast | null;
  /** GPU 的兩張表（第 8、9 號貼圖單元） */
  curveTab: Float32Array | null;
  warpTab: Float32Array | null;
  warpDims: [number, number] | null;
};
export function makeGrade(g0: any): GradeFast | null {
  if (isGradeIdentity(g0)) return null;
  const g = normGrade(g0);
  const hc = makeHueCurves(g.hc), warp = makeWarp(g.warp);
  return {
    hdr: makeHdr(g.hdr), wheels: makeWheels(g), hc,
    slice: makeSlice(g.slice, g.view?.slice ?? -1), warp, qual: makeQual(g.qual, g.view?.qual ?? 0),
    curveTab: hc?.tab ?? null, warpTab: warp?.tab ?? null, warpDims: warp ? [FH, FS + FY] : null,
  };
}

const x = [0, 0, 0], o = [0, 0, 0];
/** 套用到一個 0~255 的 RGB（就地改寫 c）。orig：這個像素的原始顏色（0~255），限定器用。
 *  qualMode：0 照常；1 不做限定器；2 限定器的調整「全部套用」（不看鍵）。
 *  CPU 的查色表用 1 與 2 各烤一張，再逐像素用精確的鍵混合 —— 鍵的邊緣是銳利的，
 *  直接烤進 32³ 的表會被內插糊掉。 */
export function applyGrade(G: GradeFast, c: Float32Array | number[], orig?: ArrayLike<number>, qualMode: 0 | 1 | 2 = 0) {
  x[0] = c[0] / 255; x[1] = c[1] / 255; x[2] = c[2] / 255;
  if (G.hdr) applyHdr(G.hdr, x);
  if (G.wheels) applyWheels(G.wheels, x);
  if (G.hc) applyHueCurves(G.hc, x);
  if (G.slice) applySlice(G.slice, x);
  if (G.warp) applyWarp(G.warp, x);
  if (G.qual && qualMode === 2) qualCorrect(G.qual, x);
  else if (G.qual && qualMode === 0) {
    if (orig) { o[0] = orig[0] / 255; o[1] = orig[1] / 255; o[2] = orig[2] / 255; } else { o[0] = x[0]; o[1] = x[1]; o[2] = x[2]; }
    applyQual(G.qual, x, o);
  }
  for (let i = 0; i < 3; i++) { const v = x[i] * 255; c[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
}

/** GPU 版（GLSL ES 3.0） */
export const GRADE_GLSL = `
uniform bool uHasGrade;
${COMMON_GLSL}
${HDR_GLSL}
${WHEELS_GLSL}
${HUE_CURVES_GLSL}
${SLICE_GLSL}
${WARP_GLSL}
${QUAL_GLSL}
vec3 colourGrade(vec3 c,vec3 src){
  if(!uHasGrade)return c;
  c=clamp(hdrWheels(c),0.,1.);
  c=wheels(c);
  c=clamp(hueCurves(c),0.,1.);
  c=clamp(colourSlice(c),0.,1.);
  c=clamp(colourWarp(c),0.,1.);
  c=colourQual(c,src);
  return clamp(c,0.,1.);
}`;

/** 把 makeGrade 的結果送進著色器（兩張表由 utils/lutGpu 自己上傳） */
export function bindGradeUniforms(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, G: GradeFast | null) {
  gl.uniform1i(u('uHasGrade'), G ? 1 : 0);
  if (!G) return;
  bindHdr(gl, u, G.hdr);
  bindWheels(gl, u, G.wheels);
  bindHueCurves(gl, u, G.hc);
  bindSlice(gl, u, G.slice);
  bindWarp(gl, u, G.warp);
  bindQual(gl, u, G.qual);
}

export { HDR_ZONES, HDR_IDS, HDR_EDGE, isHdrWheelNeutral, type Hdr, type HdrWheel, type HdrZone, type HdrZoneId } from './grade/hdr';
export { SLICES, SLICE_SPEC, isSliceVecNeutral, type Slice, type SliceId, type SliceVec } from './grade/slice';
export type { Warp, WarpPt } from './grade/warper';
export { QUAL_SPEC, isQualRangeDefault, pickQual, type Qual, type QualView } from './grade/qualifier';
