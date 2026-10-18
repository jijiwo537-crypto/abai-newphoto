/* 色相／亮度／飽和度曲線（DaVinci Resolve 曲線調色板的後六種）：
 *
 *   色相對色相  Hue vs Hue   某個色相轉到別的色相（±180°）
 *   色相對飽和  Hue vs Sat   某個色相的飽和度 ×0～×2
 *   色相對亮度  Hue vs Lum   某個色相的曝光 ±2 檔
 *   亮度對飽和  Lum vs Sat   依亮度調飽和度 ×0～×2（例如把暗部、高光的顏色收乾淨）
 *   飽和對飽和  Sat vs Sat   依原本的飽和度調飽和度 ×0～×2（只推低飽和、壓住已經很鮮的）
 *   飽和對亮度  Sat vs Lum   依飽和度調曝光 ±2 檔（例如鮮豔的顏色壓暗，像底片的密度）
 *
 * 曲線的 y：0.5 是不變（畫面中間那條水平線）。內插用單調三次 Hermite（Fritsch–Carlson），
 * 色相軸頭尾相接。
 *
 * 色彩模型見 ./common：色相＝向量示波器角度（x=0 是紅，往右依序黃、綠、青、藍、洋紅），
 * 飽和度＝c ÷ 色域邊界，亮度＝Y′。
 *   · 調色相、飽和度時 Y′ 不變，不會順便變亮變暗；超出色域時保留亮度與色相、只收回色差。
 *   · 調亮度是在線性光裡對三個通道乘同一個增益（＝改曝光），色度完全不變、不會變髒；
 *     作用量乘上飽和度，灰色不受影響（同 thatcherfreeman 的 Smooth Tetra DCTL 的做法）。
 *   · 色相類曲線乘上灰色保護 n(c)：灰牆、白紙不會冒色斑。
 *   · 色相對色相、飽和對飽和限制斜率：曲線拉得再誇張，顏色也不會「翻轉」交錯。 */

import { sampleCurve, tableAt, type CurvePt } from './spline';
import { KR, KG, KB, toLin, toSrgb, sstep, maxChroma, fromYcc, scopeColour, deg, VEC_ANGLE } from './common';

export type HueCurveId = 'hh' | 'hs' | 'hl' | 'ls' | 'ss' | 'sl';
export type HueCurves = Record<HueCurveId, CurvePt[]>;
export const HUE_CURVE_IDS: HueCurveId[] = ['hh', 'hs', 'hl', 'ls', 'ss', 'sl'];
/** x 軸是色相（循環）的那三條 */
export const isHueAxis = (id: HueCurveId) => id === 'hh' || id === 'hs' || id === 'hl';
export const freshHueCurves = (): HueCurves => ({ hh: [], hs: [], hl: [], ls: [], ss: [], sl: [] });

const TAB_N = 256;
const EPS = 1e-4;
export const isCurveFlat = (pts: CurvePt[] | undefined) => !pts || pts.every(p => Math.abs(p.y - 0.5) < EPS);
export const isHueCurvesIdentity = (h: Partial<HueCurves> | undefined | null) => !h || HUE_CURVE_IDS.every(id => isCurveFlat(h[id]));

/** 曲線的 y（0..1）→ 實際作用量（度／倍數／檔） */
export const curveToAmount = (id: HueCurveId, y: number) => id === 'hh' ? (y - 0.5) * 360 : id === 'hl' || id === 'sl' ? (y - 0.5) * 4 : y * 2;
export const curveAmountLabel = (id: HueCurveId, y: number) => {
  const v = curveToAmount(id, y);
  if (id === 'hh') return `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;
  if (id === 'hl' || id === 'sl') return `${v >= 0 ? '+' : ''}${v.toFixed(2)} 檔`;
  return `×${v.toFixed(2)}`;
};

/** 色相軸 x=0 的角度＝紅色向量 */
export const RED_ANGLE = deg(VEC_ANGLE.r);
/** 曲線背景用：某個色相 x 的顯示色 */
export const hueAxisColour = (x: number) => scopeColour(VEC_ANGLE.r + x * 360);

export type HueCurvesFast = { tab: Float32Array; on: Uint8Array };

/** 六條曲線各取樣 256 格，排成一張 256×6 的表（GPU 也直接用這張） */
export function makeHueCurves(h: Partial<HueCurves> | undefined | null): HueCurvesFast | null {
  if (isHueCurvesIdentity(h)) return null;
  const tab = new Float32Array(TAB_N * 6), on = new Uint8Array(6);
  HUE_CURVE_IDS.forEach((id, row) => {
    const pts = h![id] || [];
    const flat = isCurveFlat(pts);
    on[row] = flat ? 0 : 1;
    const t = flat ? new Float32Array(TAB_N).fill(0.5) : sampleCurve(pts, TAB_N, isHueAxis(id), 0.5);
    for (let i = 0; i < TAB_N; i++) tab[row * TAB_N + i] = Math.min(1, Math.max(0, t[i]));
  });
  /* 不能翻轉：色相對色相要 θ + Δθ(θ) 單調（dθ′/dθ ≥ 0.05）。y 的 1 單位＝一整圈，x 每格 1/256 圈 */
  if (on[0]) {
    const minD = -0.95 / TAB_N;
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < TAB_N; i++) {
      const j = (i + 1) % TAB_N;
      if (tab[j] - tab[i] < minD) tab[j] = tab[i] + minD;
    }
  }
  /* 飽和對飽和：s·M(s) 要單調（飽和的顏色調完不能比原本較淡的還淡） */
  if (on[4]) {
    const o = 4 * TAB_N;
    let prev = 0;
    for (let i = 1; i < TAB_N; i++) {
      const sIn = i / (TAB_N - 1);
      if (sIn * tab[o + i] * 2 < prev) tab[o + i] = prev / (2 * sIn);
      prev = Math.max(prev, sIn * tab[o + i] * 2);
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
  const ang = Math.atan2(cr, cb);
  const ca = C > 1e-6 ? cb / C : 1, sa = C > 1e-6 ? cr / C : 0;
  let hx = (ang - RED_ANGLE) / (Math.PI * 2); hx -= Math.floor(hx);
  const Yc = Math.min(1, Math.max(0, Y));
  const sat = Math.min(1, C / maxChroma(Yc, ca, sa));
  const gate = sstep(0, 0.05, C);
  const at = (row: number, x: number, periodic: boolean) => tableAt(T, row * TAB_N, TAB_N, x, periodic);
  let dh = 0, sg = 1, ev = 0;
  if (on[0]) dh = (at(0, hx, true) - 0.5) * 2 * Math.PI * gate;
  if (on[1]) sg *= 1 + (at(1, hx, true) * 2 - 1) * gate;
  if (on[2]) ev += (at(2, hx, true) - 0.5) * 4 * sat * gate;
  if (on[3]) sg *= at(3, Yc, false) * 2;
  if (on[4]) sg *= at(4, sat, false) * 2;
  if (on[5]) ev += (at(5, sat, false) - 0.5) * 4 * sat;
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
uniform vec4 uHCOn0; // hh hs hl ls
uniform vec2 uHCOn1; // ss sl
uniform sampler2D uGCurves;
float hcAt(int row,float x,bool periodic){
  float f;int i,j;
  if(periodic){f=fract(x)*256.;i=int(floor(f));f-=float(i);j=(i+1)%256;i=i%256;}
  else{f=clamp(x,0.,1.)*255.;i=min(254,int(floor(f)));f-=float(i);j=i+1;}
  return mix(texelFetch(uGCurves,ivec2(i,row),0).r,texelFetch(uGCurves,ivec2(j,row),0).r,f);
}
vec3 hueCurves(vec3 c){
  if(!uHasHC)return c;
  float Y=gLuma(c);
  vec2 cc=vec2((c.b-Y)/1.8556,(c.r-Y)/1.5748);
  float C=length(cc),ang=atan(cc.y,cc.x);
  float ca=C>1e-6?cc.x/C:1.,sa=C>1e-6?cc.y/C:0.;
  float hx=fract((ang-${RED_ANGLE.toFixed(8)})/6.28318530718);
  float Yc=clamp(Y,0.,1.);
  float sat=min(1.,C/gMaxC(Yc,ca,sa));
  float gate=smoothstep(0.,.05,C);
  float dh=0.,sg=1.,ev=0.;
  if(uHCOn0.x>.5)dh=(hcAt(0,hx,true)-.5)*6.28318530718*gate;
  if(uHCOn0.y>.5)sg*=1.+(hcAt(1,hx,true)*2.-1.)*gate;
  if(uHCOn0.z>.5)ev+=(hcAt(2,hx,true)-.5)*4.*sat*gate;
  if(uHCOn0.w>.5)sg*=hcAt(3,Yc,false)*2.;
  if(uHCOn1.x>.5)sg*=hcAt(4,sat,false)*2.;
  if(uHCOn1.y>.5)ev+=(hcAt(5,sat,false)-.5)*4.*sat;
  float a2=ang+dh;vec2 dir=vec2(cos(a2),sin(a2));
  float C2=min(C*max(0.,sg),gMaxC(Yc,dir.x,dir.y));
  vec3 o=gFromYcc(Y,dir*C2);
  if(ev!=0.)o=gSrgb(min(gLin(o)*exp2(ev),1.));
  return o;
}`;

export function bindHueCurves(gl: WebGL2RenderingContext, u: (n: string) => WebGLUniformLocation | null, F: HueCurvesFast | null) {
  gl.uniform1i(u('uHasHC'), F ? 1 : 0);
  if (!F) return;
  gl.uniform4f(u('uHCOn0'), F.on[0], F.on[1], F.on[2], F.on[3]);
  gl.uniform2f(u('uHCOn1'), F.on[4], F.on[5]);
}
