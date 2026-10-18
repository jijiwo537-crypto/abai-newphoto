/* 調色工具共用的色彩運算（CPU 與 GLSL 兩份，數字完全一樣）。
 * 增益、曝光一律在線性光裡算（sRGB 解碼後），是物理上的「乘光量」。 */

export const KR = 0.2126, KG = 0.7152, KB = 0.0722;
export const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
export const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export const COMMON_GLSL = `
vec3 gLin(vec3 v){v=clamp(v,0.,1.);return mix(v/12.92,pow((v+.055)/1.055,vec3(2.4)),step(vec3(.04045),v));}
vec3 gSrgb(vec3 v){v=max(v,0.);return mix(v*12.92,1.055*pow(v,vec3(1./2.4))-.055,step(vec3(.0031308),v));}
float gLuma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
`;
