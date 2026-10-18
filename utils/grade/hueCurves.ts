/* 色相曲線（DaVinci Resolve 曲線調色板的 Hue vs Hue／Sat／Lum，Lightroom 叫「點顏色」）：
 *
 *   色相  某個顏色換成別的顏色（±180°），例如把偏黃的綠葉拉成青綠
 *   飽和  某個顏色的飽和度 ×0～×2，例如只讓藍天更藍、只把膚色收淡
 *   亮度  某個顏色的曝光 ±2 檔，例如只把天空壓暗
 *
 * 三條曲線的橫軸都是「顏色」（色相，左邊紅，往右黃、綠、青、藍、洋紅，最右邊又回到紅），
 * 縱軸是要調多少，中間那條水平線是不變。跟 HSL 是同一件事，但不是固定 8 個色帶：
 * 點可以放在任何顏色上、範圍要多寬就多寬，調得更細。
 *
 * 曲線內插用單調三次 Hermite（Fritsch–Carlson），頭尾相接（紅色接回紅色），不會在點之間甩出波紋。
 * 色彩模型見 ./common：色相＝向量示波器角度，飽和度＝c ÷ 色域邊界，亮度＝Y′。
 *   · 調色相、飽和度時 Y′ 不變，不會順便變亮變暗；超出色域時保留亮度與色相、只收回色差。
 *   · 調亮度是線性光裡三個通道乘同一個增益（＝改曝光），色度不變、不會變髒；
 *     作用量乘上飽和度，灰色不受影響（同 thatcherfreeman 的 Smooth Tetra DCTL 的做法）。
 *   · 全部乘上灰色保護 n(c)：灰牆、白紙不會冒色斑。
 *   · 色相曲線限制斜率：拉得再誇張，顏色也不會「翻轉」交錯。 */

import { sampleCurve, tableAt, type CurvePt } from './spline';
import { KR, KG, KB, toLin, toSrgb, sstep, maxChroma, fromYcc, scopeColour, deg, VEC_ANGLE } from './common';

export type HueCurveId = 'hh' | 'hs' | 'hl';
export type HueCurves = Record<HueCurveId, CurvePt[]>;
export const HUE_CURVE_IDS: HueCurveId[] = ['hh', 'hs', 'hl'];
export const HUE_CURVE_LABEL: Record<HueCurveId, string> = { hh: '色相', hs: '飽和', hl: '亮度' };
export const freshHueCurves = (): HueCurves => ({ hh: [], hs: [], hl: [] });

const TAB_N = 256;
export const HC_ROWS = 3;
const EPS = 1e-4;
export const isCurveFlat = (pts: CurvePt[] | undefined) => !pts || pts.every(p => Math.abs(p.y - 0.5) < EPS);
export const isHueCurvesIdentity = (h: Partial<HueCurves> | undefined | null) => !h || HUE_CURVE_IDS.every(id => isCurveFlat(h[id]));

/** 曲線的 y（0..1）→ 實際作用量（度／倍數／檔） */
export const curveToAmount = (id: HueCurveId, y: number) => id === 'hh' ? (y - 0.5) * 360 : id === 'hl' ? (y - 0.5) * 4 : y * 2;
export const curveAmountLabel = (id: HueCurveId, y: number) => {
  const v = curveToAmount(id, y);
  if (id === 'hh') return `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;
  if (id === 'hl') return `${v >= 0 ? '+' : ''}${v.toFixed(2)} 檔`;
  return `×${v.toFixed(2)}`;
};

/** 橫軸 x=0 的角度＝紅色向量 */
export const RED_ANGLE = deg(VEC_ANGLE.r);
/** 某個 x 的顯示色 */
export const hueAxisColour = (x: number) => scopeColour(VEC_ANGLE.r + x * 360);

export type HueCurvesFast = { tab: Float32Array; on: Uint8Array };

/** 三條曲線各取樣 256 格，排成一張 256×3 的表（GPU 也直接用這張） */
export function makeHueCurves(h: Partial<HueCurves> | undefined | null): HueCurvesFast | null {
  if (isHueCurvesIdentity(h)) return null;
  const tab = new Float32Array(TAB_N * HC_ROWS), on = new Uint8Array(HC_ROWS);
  HUE_CURVE_IDS.forEach((id, row) => {
    const pts = h![id] || [];
    const flat = isCurveFlat(pts);
    on[row] = flat ? 0 : 1;
    const t = flat ? new Float32Array(TAB_N).fill(0.5) : sampleCurve(pts, TAB_N, true, 0.5);
    for (let i = 0; i < TAB_N; i++) tab[row * TAB_N + i] = Math.min(1, Math.max(0, t[i]));
  });
  /* 不能翻轉：θ + Δθ(θ) 要單調（dθ′/dθ ≥ 0.05）。y 的 1 單位＝一整圈，x 每格 1/256 圈 */
  if (on[0]) {
    const minD = -0.95 / TAB_N;
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < TAB_N; i++) {
      const j = (i + 1) % TAB_N;
      if (tab[j] - tab[i] < minD) tab[j] = tab[i] + minD;
    }
  }
  return { tab, on };
}

/** 套用（0..1 RGB，就地改寫） */
export function applyHueCurves(F: HueCurvesFast, c: number[]) {
  const T = F.tab, on = F.on;
  const Y = KR * c[0] + KG * c[1] + KB * c[2];
  const cb = (c[2] - Y) / 1.8556, cr = (c[0] - Y) / 1.5748;
  const C = Math.hypot(cb, cr);
  if (C < 1e-7) return;
  const ang = Math.atan2(cr, cb), ca = cb / C, sa = cr / C;
  let hx = (ang - RED_ANGLE) / (Math.PI * 2); hx -= Math.floor(hx);
  const Yc = Math.min(1, Math.max(0, Y));
  const sat = Math.min(1, C / maxChroma(Yc, ca, sa));
  const gate = sstep(0, 0.05, C);
  const at = (row: number) => tableAt(T, row * TAB_N, TAB_N, hx, true);
  const dh = on[0] ? (at(0) - 0.5) * 2 * Math.PI * gate : 0;
  const sg = on[1] ? 1 + (at(1) * 2 - 1) * gate : 1;
  const ev = on[2] ? (at(2) - 0.5) * 4 * sat * gate : 0;
  const a2 = ang + dh, c2 = Math.cos(a2), s2 = Math.sin(a2);
  const C2 = Math.min(C * Math.max(0, sg), maxChroma(Yc, c2, s2));
  fromYcc(Y, c2 * C2, s2 * C2, c);
  if (ev !== 0) {
    const k = Math.pow(2, ev);
    for (let i = 0; i < 3; i++) c[i] = toSrgb(Math.min(1, toLin(Math.min(1, Math.max(0, c[i]))) * k));
  }
}

export const HUE_CURVES_GLSL = `
uniform bool uHasHC;
uniform vec3 uHCOn;
uniform sampler2D uGCurves;
float hcAt(int row,float x){
  float f=fract(x)*256.;int i=int(floor(f));f-=float(i);
  int j=(i+1)%256;i=i%256;
  return mix(texelFetch(uGCurves,ivec2(i,row),0).r,texelFetch(uGCurves,ivec2(j,row),0).r,f);
}
vec3 hueCurves(vec3 c){
  if(!uHasHC)return c;
  float Y=gLuma(c);
  vec2 cc=vec2((c.b-Y)/1.8556,(c.r-Y)/1.5748);
  float C=length(cc);
  if(C<1e-7)return c;
  float ang=gHue(cc),ca=cc.x/C,sa=cc.y/C;
  float hx=fract((ang-${RED_ANGLE.toFixed(8)})/6.28318530718);
  float Yc=clamp(Y,0.,1.);
  float sat=min(1.,C/gMaxC(Yc,ca,sa));
  float gate=smoothstep(0.,.05,C);
  float dh=uHCOn.x>.5?(hcAt(0,hx)-.5)*6.28318530718*gate:0.;
  float sg=uHCOn.y>.5?1.+(hcAt(1,hx)*2.-1.)*gate:1.;
  float ev=uHCOn.z>.5?(hcAt(2,hx)-.5)*4.*sat*gate:0.;
  float a2=ang+dh;vec2 dir=vec2(cos(a2),sin(a2));
  float C2=min(C*max(0.,sg),gMaxC(Yc,dir.x,dir.y));
  vec3 o=gFromYcc(Y,dir*C2);
  if(ev!=0.)o=gSrgb(min(gLin(o)*exp2(ev),1.));
  return o;
}`;

export function bindHueCurves(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, F: HueCurvesFast | null) {
  gl.uniform1i(u('uHasHC'), F ? 1 : 0);
  if (!F) return;
  gl.uniform3f(u('uHCOn'), F.on[0], F.on[1], F.on[2]);
}
