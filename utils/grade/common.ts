/* 調色工具共用的色彩模型（CPU 與 GLSL 兩份，數字完全一樣）。
 *
 *  · 位置（色相、彩度）一律用 Rec.709 的 Y′CbCr ＝ 向量示波器：
 *      θ = atan2(Cr, Cb)（3 點鐘為 0、逆時針），c = |(Cb, Cr)|。
 *    這樣色輪、色彩切片、扭曲器、限定器、色相曲線看到的「紅色在哪」都一樣，
 *    也跟達芬奇的示波器一致（709 的紅 ≈ 103°、黃 ≈ 175°、綠 ≈ 230°、青 ≈ 283°、藍 ≈ 355°、洋紅 ≈ 50°，
 *    膚色線 ≈ 123°）。
 *  · 增益、曝光、密度、減色飽和度一律在線性光裡算（sRGB 解碼後），是物理上的「乘光量」。
 *  · 飽和度 s ＝ c ÷ 該亮度、該色相下 sRGB 色域邊界的彩度（0..1）。
 *  · 灰色保護：色相在灰色上沒有意義，凡是「看色相」的作用都乘上 n(c)＝smoothstep(0, c0, c)。 */

export const KR = 0.2126, KG = 0.7152, KB = 0.0722;
export const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
export const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export const luma = (r: number, g: number, b: number) => KR * r + KG * g + KB * b;
export const deg = (d: number) => (d * Math.PI) / 180;
/** 向量示波器上各向量的角度（度） */
export const VEC_ANGLE = { r: 102.9, skin: 123, y: 174.8, g: 229.7, c: 282.9, b: 354.8, m: 49.7 };

/** 某個亮度、色相方向上，Cb/Cr 最多能走多遠還留在 sRGB 內 */
export function maxChroma(Y: number, ca: number, sa: number) {
  const dr = 1.5748 * sa, db = 1.8556 * ca, dg = -(KR * 1.5748 * sa + KB * 1.8556 * ca) / KG;
  let t = 4;
  if (dr > 1e-6) t = Math.min(t, (1 - Y) / dr); else if (dr < -1e-6) t = Math.min(t, Y / -dr);
  if (dg > 1e-6) t = Math.min(t, (1 - Y) / dg); else if (dg < -1e-6) t = Math.min(t, Y / -dg);
  if (db > 1e-6) t = Math.min(t, (1 - Y) / db); else if (db < -1e-6) t = Math.min(t, Y / -db);
  return Math.max(t, 1e-4);
}
/** Y、Cb、Cr → RGB（寫進 out） */
export function fromYcc(Y: number, cb: number, cr: number, out: number[]) {
  const r = Y + 1.5748 * cr, b = Y + 1.8556 * cb;
  out[0] = r; out[2] = b; out[1] = (Y - KR * r - KB * b) / KG;
}
/** 示波器角度（度）的顯示色 */
export function scopeColour(angleDeg: number, k = 0.3): string {
  const a = deg(angleDeg), cb = Math.cos(a) * k, cr = Math.sin(a) * k, y = 0.5;
  const r = y + 1.5748 * cr, b = y + 1.8556 * cb, g = (y - KR * r - KB * b) / KG;
  const m = Math.max(r, g, b), n = Math.min(r, g, b);
  const s = (v: number) => Math.round(255 * ((v - n) / (m - n || 1) * 0.8 + 0.15));
  return `rgb(${s(r)},${s(g)},${s(b)})`;
}

export const COMMON_GLSL = `
vec3 gLin(vec3 v){v=clamp(v,0.,1.);return mix(v/12.92,pow((v+.055)/1.055,vec3(2.4)),step(vec3(.04045),v));}
vec3 gSrgb(vec3 v){v=max(v,0.);return mix(v*12.92,1.055*pow(v,vec3(1./2.4))-.055,step(vec3(.0031308),v));}
float gLuma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
float gMaxC(float Y,float ca,float sa){
  vec3 d=vec3(1.5748*sa,-(.2126*1.5748*sa+.0722*1.8556*ca)/.7152,1.8556*ca);
  float t=4.;
  for(int i=0;i<3;i++){if(d[i]>1e-6)t=min(t,(1.-Y)/d[i]);else if(d[i]<-1e-6)t=min(t,Y/-d[i]);}
  return max(t,1e-4);
}
vec3 gFromYcc(float Y,vec2 cc){float r=Y+1.5748*cc.y,b=Y+1.8556*cc.x;return vec3(r,(Y-.2126*r-.0722*b)/.7152,b);}
`;
