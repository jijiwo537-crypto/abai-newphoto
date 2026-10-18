/* 調色階段（接在 HSL 之後），存在 params.grade 裡：
 *
 *   HDR 色輪 → 一級色輪（暗部／中灰／亮部／偏移、Log 色輪）
 *
 * 順序跟 Resolve 一個節點裡各調色板的固定順序一致。每一個都是「逐像素、只看顏色」的運算，
 * 所以 CPU 可以整條烤進主查色表（utils/photoPixelCore），GPU 用同一組預先算好的數字
 * 在著色器裡逐像素算（utils/lutGpu），兩邊結果一致。各工具的數學在 utils/grade/ 底下。 */

import { freshWheels, isWheelsIdentity, makeWheels, applyWheels, WHEELS_GLSL, bindWheels, WHEEL_IDS, type Wheels, type WheelsFast } from './grade/wheels';
import { freshHdr, isHdrIdentity, makeHdr, applyHdr, HDR_GLSL, bindHdr, HDR_IDS, type Hdr, type HdrFast } from './grade/hdr';
import { COMMON_GLSL } from './grade/common';

export * from './grade/wheels';

export type ColorGrade = Wheels & {
  hdr: Hdr;
};

export const freshGrade = (): ColorGrade => ({ ...freshWheels(), hdr: freshHdr() });

const num = (v: any, d: number) => (Number.isFinite(v) ? v : d);
/** 補齊缺的欄位（舊作品、或舊版留下的格式；不認得的欄位直接丟掉） */
export function normGrade(g: any): ColorGrade {
  const out = freshGrade();
  if (!g || typeof g !== 'object') return out;
  for (const id of WHEEL_IDS) {
    const w = g[id];
    if (w && typeof w === 'object') for (const c of ['y', 'r', 'g', 'b'] as const) out[id][c] = num(w[c], out[id][c]);
  }
  if (g.hdr && typeof g.hdr === 'object') for (const id of HDR_IDS) if (g.hdr[id]) out.hdr[id] = { ...out.hdr[id], ...g.hdr[id] } as any;
  return out;
}

export type GradeTool = 'wheels' | 'hdr';
const GRADE_TOOLS: GradeTool[] = ['wheels', 'hdr'];
export const isGradeToolIdentity = (g0: any, tool: GradeTool): boolean => {
  if (!g0) return true;
  const g = normGrade(g0);
  switch (tool) {
    case 'wheels': return isWheelsIdentity(g);
    case 'hdr': return isHdrIdentity(g.hdr);
  }
};
export const isGradeIdentity = (g0: any): boolean => !g0 || GRADE_TOOLS.every(t => isGradeToolIdentity(g0, t));

/** 預先算好的數字（CPU 與 GPU 共用）。沒有調任何東西時是 null。 */
export type GradeFast = {
  hdr: HdrFast | null;
  wheels: WheelsFast | null;
};
export function makeGrade(g0: any): GradeFast | null {
  if (isGradeIdentity(g0)) return null;
  const g = normGrade(g0);
  return { hdr: makeHdr(g.hdr), wheels: makeWheels(g) };
}

const x = [0, 0, 0];
/** 套用到一個 0~255 的 RGB（就地改寫 c） */
export function applyGrade(G: GradeFast, c: Float32Array | number[]) {
  x[0] = c[0] / 255; x[1] = c[1] / 255; x[2] = c[2] / 255;
  if (G.hdr) applyHdr(G.hdr, x);
  if (G.wheels) applyWheels(G.wheels, x);
  for (let i = 0; i < 3; i++) { const v = x[i] * 255; c[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
}

/** GPU 版（GLSL ES 3.0） */
export const GRADE_GLSL = `
uniform bool uHasGrade;
${COMMON_GLSL}
${HDR_GLSL}
${WHEELS_GLSL}
vec3 colourGrade(vec3 c){
  if(!uHasGrade)return c;
  c=clamp(hdrWheels(c),0.,1.);
  c=wheels(c);
  return clamp(c,0.,1.);
}`;

/** 把 makeGrade 的結果送進著色器 */
export function bindGradeUniforms(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, G: GradeFast | null) {
  gl.uniform1i(u('uHasGrade'), G ? 1 : 0);
  if (!G) return;
  bindHdr(gl, u, G.hdr);
  bindWheels(gl, u, G.wheels);
}

export { HDR_ZONES, HDR_IDS, HDR_EDGE, isHdrWheelNeutral, type Hdr, type HdrWheel, type HdrZone, type HdrZoneId } from './grade/hdr';
