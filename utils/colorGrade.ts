/* 調色輪（Color Grading）：陰影／中間調／亮部／全域 四個色輪，加上混合與平衡。
 *
 * 對標 Lightroom 的「顏色分級」與 DaVinci Resolve 的色輪，做法：
 *  · 全部在 Oklab 裡算 —— 感知均勻的色彩空間，同樣的「飽和度」在每個色相看起來一樣強，
 *    調色只動色度（a,b）與明度（L），不會像在 RGB 裡加減那樣把亮度一起拉偏。
 *  · 色輪上看到的顏色就是會染上的顏色：色輪的色相先換成那個顏色在 Oklab 裡的方向。
 *  · 三個區域的權重是平滑、加起來等於 1 的曲線（Bernstein 形狀）：
 *    陰影＝(1−L)^p、亮部＝L^p、中間調＝其餘。「混合」改變 p（區域重疊多寬），
 *    「平衡」把分界往亮或往暗推（L 先做 gamma）。不會有斷層或色帶。
 *  · 染色超出 sRGB 色域時，保留明度、只收回色度（二分搜尋），亮部不會變成死白或爆色。
 *  · 純黑會保留一點（陰影染色在最深處淡出），不會讓整張照片的黑色泛色。
 *
 * CPU（utils/photoPixelCore，烤進 32³ 主查色表）與 GPU（utils/lutGpu 著色器）用同一組
 * 預先算好的數字（makeGrade），兩邊結果一致。 */

export type GradeWheel = { h: number; s: number; l: number };   // h: 0~360, s: 0~100, l: -100~100
export type ColorGrade = { sh: GradeWheel; mid: GradeWheel; hi: GradeWheel; global: GradeWheel; blend: number; balance: number };

export const GRADE_ZONES = ['sh', 'mid', 'hi', 'global'] as const;
export type GradeZone = typeof GRADE_ZONES[number];

const W0 = (): GradeWheel => ({ h: 0, s: 0, l: 0 });
export const DEFAULT_GRADE: ColorGrade = { sh: W0(), mid: W0(), hi: W0(), global: W0(), blend: 50, balance: 0 };

export const isGradeIdentity = (g: ColorGrade | undefined | null): boolean =>
  !g || GRADE_ZONES.every(z => !g[z] || (g[z].s === 0 && g[z].l === 0));

/** 每個區域滿格（飽和度 100）時在 Oklab 加上的色度 */
const MAX_CHROMA: Record<GradeZone, number> = { sh: 0.085, mid: 0.075, hi: 0.07, global: 0.06 };
/** 明度滑桿滿格時的強度 */
const MAX_LUM = 0.42;

/* ── sRGB ⇄ Oklab ─────────────────────────────────────────────── */
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
function linToLab(r: number, g: number, b: number, o: Float64Array) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  o[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  o[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
}
function labToLin(L: number, a: number, b: number, o: Float64Array) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  o[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  o[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  o[2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
}

/** 色輪上某個色相（跟色輪畫的一樣：HSV 色相）在 Oklab 裡的單位方向 */
export function hueDirection(h: number): [number, number] {
  const hp = (((h % 360) + 360) % 360) / 60, x = 1 - Math.abs((hp % 2) - 1);
  const [r, g, b] = hp < 1 ? [1, x, 0] : hp < 2 ? [x, 1, 0] : hp < 3 ? [0, 1, x] : hp < 4 ? [0, x, 1] : hp < 5 ? [x, 0, 1] : [1, 0, x];
  const o = new Float64Array(3);
  linToLab(toLin(r), toLin(g), toLin(b), o);
  const n = Math.hypot(o[1], o[2]) || 1;
  return [o[1] / n, o[2] / n];
}

/** 預先算好的調色數字（CPU 與 GPU 共用）。沒有調任何東西時是 null。 */
export type GradeFast = { off: Float32Array; lum: Float32Array; p: number; gamma: number };
export function makeGrade(g: ColorGrade | undefined | null): GradeFast | null {
  if (isGradeIdentity(g)) return null;
  const off = new Float32Array(8), lum = new Float32Array(4);
  GRADE_ZONES.forEach((z, i) => {
    const w = g![z] || W0();
    const [da, db] = hueDirection(w.h);
    const c = (Math.max(0, Math.min(100, w.s)) / 100) * MAX_CHROMA[z];
    off[i * 2] = da * c; off[i * 2 + 1] = db * c;
    lum[i] = (Math.max(-100, Math.min(100, w.l)) / 100) * MAX_LUM;
  });
  const k = Math.max(0, Math.min(100, g!.blend ?? 50)) / 100;
  const p = 3.4 + (1.25 - 3.4) * k;               // 混合 0 → 區域窄；100 → 大量重疊
  const gamma = Math.pow(2, -(Math.max(-100, Math.min(100, g!.balance ?? 0)) / 100) * 1.1);
  return { off, lum, p, gamma };
}

const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lab = new Float64Array(3), lin = new Float64Array(3);

/** 套用到一個 0~255 的 RGB（就地改寫 c）。 */
export function applyGrade(G: GradeFast, c: Float32Array | number[]) {
  linToLab(toLin(c[0] / 255), toLin(c[1] / 255), toLin(c[2] / 255), lab);
  let L = lab[0];
  const a0 = lab[1], b0 = lab[2];
  const Lc = Math.min(1, Math.max(0, L));
  const Lb = Math.pow(Lc, G.gamma);
  const wS = Math.pow(1 - Lb, G.p), wH = Math.pow(Lb, G.p), wM = Math.max(0, 1 - wS - wH);
  // 陰影的染色在最深的黑淡出（保留乾淨的黑），亮部在純白附近稍收（避免死白泛色）
  const sProt = 0.35 + 0.65 * sstep(0.0, 0.22, Lc), hProt = 1 - 0.35 * sstep(0.9, 1.0, Lc);
  const ws = wS * sProt, wh = wH * hProt;
  const da = G.off[0] * ws + G.off[2] * wM + G.off[4] * wh + G.off[6];
  const db = G.off[1] * ws + G.off[3] * wM + G.off[5] * wh + G.off[7];
  // 明度：往上推時壓向白、往下拉時壓向黑，平滑不截斷
  const dl = G.lum[0] * wS + G.lum[1] * wM + G.lum[2] * wH + G.lum[3];
  L = dl >= 0 ? L + dl * (1 - L) : L + dl * L;
  // 色域：保留明度，色度從 1 往回收到剛好落在 sRGB 內
  let a = a0 + da, b = b0 + db;
  labToLin(L, a, b, lin);
  if (lin[0] < 0 || lin[0] > 1 || lin[1] < 0 || lin[1] > 1 || lin[2] < 0 || lin[2] > 1) {
    let lo = 0, hi = 1;
    for (let it = 0; it < 7; it++) {
      const t = (lo + hi) / 2;
      labToLin(L, a * t, b * t, lin);
      if (lin[0] < 0 || lin[0] > 1 || lin[1] < 0 || lin[1] > 1 || lin[2] < 0 || lin[2] > 1) hi = t; else lo = t;
    }
    a *= lo; b *= lo;
    labToLin(L, a, b, lin);
  }
  for (let i = 0; i < 3; i++) { const v = toSrgb(Math.min(1, Math.max(0, lin[i]))) * 255; c[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
}

/** GPU 版（GLSL ES 3.0），數字由 makeGrade 傳進來 */
export const GRADE_GLSL = `
uniform bool uHasGrade;
uniform vec2 uGradeOff[4];
uniform vec4 uGradeLum;
uniform float uGradeP;
uniform float uGradeGamma;
vec3 gLin(vec3 v){return mix(v/12.92,pow((v+.055)/1.055,vec3(2.4)),step(vec3(.04045),v));}
vec3 gSrgb(vec3 v){return mix(v*12.92,1.055*pow(max(v,0.),vec3(1./2.4))-.055,step(vec3(.0031308),v));}
vec3 gToLab(vec3 c){
  vec3 lms=vec3(dot(c,vec3(.4122214708,.5363325363,.0514459929)),dot(c,vec3(.2119034982,.6806995451,.1073969566)),dot(c,vec3(.0883024619,.2817188376,.6299787005)));
  lms=sign(lms)*pow(abs(lms),vec3(1./3.));
  return vec3(dot(lms,vec3(.2104542553,.7936177850,-.0040720468)),dot(lms,vec3(1.9779984951,-2.4285922050,.4505937099)),dot(lms,vec3(.0259040371,.7827717662,-.8086757660)));
}
vec3 gToLin(vec3 o){
  vec3 lms=vec3(o.x+.3963377774*o.y+.2158037573*o.z,o.x-.1055613458*o.y-.0638541728*o.z,o.x-.0894841775*o.y-1.2914855480*o.z);
  lms=lms*lms*lms;
  return vec3(dot(lms,vec3(4.0767416621,-3.3077115913,.2309699292)),dot(lms,vec3(-1.2684380046,2.6097574011,-.3413193965)),dot(lms,vec3(-.0041960863,-.7034186147,1.7076147010)));
}
bool gOut(vec3 v){return any(lessThan(v,vec3(0.)))||any(greaterThan(v,vec3(1.)));}
vec3 colourGrade(vec3 c){
  if(!uHasGrade)return c;
  vec3 o=gToLab(gLin(c));
  float L=o.x,Lc=clamp(L,0.,1.),Lb=pow(Lc,uGradeGamma);
  float wS=pow(1.-Lb,uGradeP),wH=pow(Lb,uGradeP),wM=max(0.,1.-wS-wH);
  float ws=wS*(.35+.65*smoothstep(0.,.22,Lc)),wh=wH*(1.-.35*smoothstep(.9,1.,Lc));
  vec2 d=uGradeOff[0]*ws+uGradeOff[1]*wM+uGradeOff[2]*wh+uGradeOff[3];
  float dl=uGradeLum.x*wS+uGradeLum.y*wM+uGradeLum.z*wH+uGradeLum.w;
  L=dl>=0.?L+dl*(1.-L):L+dl*L;
  vec2 ab=o.yz+d;
  vec3 lin=gToLin(vec3(L,ab));
  if(gOut(lin)){
    float lo=0.,hi=1.;
    for(int i=0;i<7;i++){float t=(lo+hi)*.5;if(gOut(gToLin(vec3(L,ab*t))))hi=t;else lo=t;}
    lin=gToLin(vec3(L,ab*lo));
  }
  return clamp(gSrgb(clamp(lin,0.,1.)),0.,1.);
}`;
