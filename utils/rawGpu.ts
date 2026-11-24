/**
 * RAW 的即時沖洗（網頁 GPU 版）
 *
 * 原生（ios/App/App/ABAIRawDevelop.swift）打開照片時只沖一次，交出「RAW 那一步的線性結果」和「局部亮度底圖」
 * （線性 Display P3、半精度浮點）。之後曝光、色溫、色調、高光、陰影每一格都在這裡用 GPU 照原生 finish() 的
 * 同一套公式算：
 *   ① 曝光：線性光乘 2^EV
 *   ② 白平衡：Bradford 色彩適應矩陣，像素亮度放回原本的值，接近爆白的地方淡出（wbKernel）
 *   ③ 光線：局部亮度底圖決定高光、陰影的作用區（toneKernel）
 *   ④ 顯示轉換：超出色域往同亮度的灰拉、超過白的亮部等比例柔收（viewKernel）
 *   ⑤ 線性 P3 → sRGB 8 位元（跟原生輸出像素時的 createCGImage 一樣）
 * 拖曳中跟放手後是同一條路、同樣的像素；不用每一格都跟原生來回傳整張圖，拖起來跟一般照片一樣順。
 */

export interface RawGpuParams {
  /** 曝光（EV，已含拍攝保護的那幾格） */
  exposure: number;
  /** 使用者設定的色溫（K）、色調；沒設定＝拍攝當下 */
  temperature?: number; tint?: number;
  /** -1～1 */
  highlights: number; shadows: number;
}

type M3 = number[]; // 列優先 3×3
const mul = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const inv = (m: M3): M3 => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det);
};
const P3_TO_XYZ: M3 = [0.4865709, 0.2656677, 0.1982173, 0.2289746, 0.6917385, 0.0792869, 0.0, 0.0451134, 1.0439444];
const BRADFORD: M3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const SRGB_TO_XYZ: M3 = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041];
/** 線性 Display P3 → 線性 sRGB */
const P3_TO_SRGB = mul(inv(SRGB_TO_XYZ), P3_TO_XYZ);
const SRGB_TO_P3 = mul(inv(P3_TO_XYZ), SRGB_TO_XYZ);
/** Float32 → 半精度（四捨五入） */
export function f2h(v: number): number {
  const f = new Float32Array(1), i = new Uint32Array(f.buffer); f[0] = v; const x = i[0];
  const sgn = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sgn; m = (m | 0x800000) >> (1 - e); return sgn | ((m + 0x1000) >> 13); }
  if (e >= 31) return sgn | 0x7c00;
  const r = sgn | (e << 10) | (m >> 13); return (m & 0x1000) ? r + 1 : r;
}

/** 黑體光源在色溫 K 的色度座標 xy（Kim 等人的三次近似）—— 跟原生 planckXY 一樣 */
function planckXY(k: number): [number, number] {
  const T = Math.max(1667, Math.min(25000, k)), t1 = 1e3 / T, t2 = t1 * t1, t3 = t2 * t1;
  const x = T <= 4000 ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t1 + 0.179910
    : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t1 + 0.240390;
  const x2 = x * x, x3 = x2 * x;
  const y = T <= 2222 ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}
/** 色溫＋色調 → 光源 xy —— 跟原生 illuminantXY 一樣（xy 上垂直黑體軌跡、往綠為正，±100 ＝ ±0.015） */
function illuminantXY(k: number, tint: number): [number, number] {
  const a = planckXY(k), b = planckXY(k * 1.01);
  let nx = -(b[1] - a[1]), ny = b[0] - a[0];
  const len = Math.max(1e-12, Math.hypot(nx, ny)); nx /= len; ny /= len;
  if (ny < 0) { nx = -nx; ny = -ny; }
  const d = Math.max(-150, Math.min(150, tint)) / 100 * 0.015;
  return [a[0] + nx * d, a[1] + ny * d];
}
/** 白平衡矩陣（線性 P3 → 線性 P3），列優先；沒調過回 null —— 跟原生 wbMatrix 一樣 */
export function rawWbMatrix(p: RawGpuParams, asShot: [number, number]): M3 | null {
  if (p.temperature == null) return null;
  const k = p.temperature, t = p.tint ?? asShot[1];
  if (Math.abs(k - asShot[0]) < 1 && Math.abs(t - asShot[1]) < 0.05) return null;
  const XYZ = (xy: [number, number]) => [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];
  const ap = (m: M3, v: number[]) => [0, 1, 2].map(r => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
  const src = ap(BRADFORD, XYZ(illuminantXY(k, t))), dst = ap(BRADFORD, XYZ(illuminantXY(asShot[0], asShot[1])));
  const scale: M3 = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  const m = mul(inv(BRADFORD), mul(scale, BRADFORD));
  return mul(inv(P3_TO_XYZ), mul(m, P3_TO_XYZ));
}

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/* 跟原生各個 CIColorKernel 一行一行對應 */
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uLin, uBase;
uniform highp sampler3D uCube;
uniform float uGain, uExpo, uHi, uSh, uLutAmt, uCubeSize;
uniform bool uWbOn, uLutOn, uFxOn, uDither;
uniform mat3 uWb, uToSrgb, uFromSrgb;
const vec3 W = vec3(0.2289746, 0.6917385, 0.0792869);
float srgbOetf(float v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
float srgbEotf(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 oetf3(vec3 c) { return vec3(srgbOetf(c.r), srgbOetf(c.g), srgbOetf(c.b)); }
vec3 eotf3(vec3 c) { return vec3(srgbEotf(c.r), srgbEotf(c.g), srgbEotf(c.b)); }
/* 截成 8 位元前加三角分佈抖色（±1 階，跟編輯器 lutGpu 同一招）：之後再拉對比、曲線也不會出現一圈一圈的色階，
   每個位置的值固定（同一組參數每一格都一樣，拖曳中跟放手後完全相同） */
float dHash(uvec2 q){q=q*uvec2(1597334673u,3812015801u);uint n=(q.x^q.y)*1597334673u;return float(n)*(1./4294967296.);}
vec3 dith(vec3 c){uvec2 q=uvec2(gl_FragCoord.xy);float d=dHash(q)+dHash(q+uvec2(7919u,104729u))-1.;return clamp(c+d/255.,0.,1.);}
void main() {
  vec3 s = texture(uLin, vUv).rgb * uGain;                       // ① 曝光
  if (uWbOn) {                                                   // ② 白平衡（wbKernel）
    vec3 c = max(s, vec3(0.0));
    float y0 = dot(c, W);
    vec3 o = uWb * c;
    float y1 = dot(max(o, vec3(0.0)), W);
    o *= y1 > 1.0e-6 ? clamp(y0 / y1, 0.25, 4.0) : 1.0;
    float hi = smoothstep(0.9, 1.0, max(max(s.r, s.g), s.b));
    s = mix(o, c, hi * hi);
  }
  vec3 c = max(s, vec3(0.0));                                    // ③ 光線（toneKernel）
  float Y = max(dot(c, W), 1.0e-5);
  float e = log2(Y / 0.18);
  float b = texture(uBase, vUv).r;
  float base = e + clamp((b + uExpo) - e, -1.5, 1.5);
  float e2 = e;
  e2 += uHi * 2.5 * smoothstep(-1.0, 2.5, base);
  e2 += uSh * 2.5 * (1.0 - smoothstep(-5.5, -0.5, base));
  c *= (0.18 * exp2(e2)) / Y;
  float l = max(dot(c, W), 0.0);                                 // ④ 顯示轉換（viewKernel）
  float mn = min(min(c.r, c.g), c.b);
  if (mn < 0.0) { float k = l / max(l - mn, 1.0e-6); c = vec3(l) + (c - vec3(l)) * k; }
  float n = max(max(c.r, c.g), c.b);
  const float knee = 0.8;
  if (n > knee) {
    float f = knee + (1.0 - knee) * (1.0 - exp(-(n - knee) / (1.0 - knee)));
    c *= f / n;
    float t = smoothstep(0.9, 1.0, f);
    c = mix(c, vec3(f), t * t * 0.6);
  }
  c = clamp(c, 0.0, 1.0);
  if (uLutOn) {                                                  // ⑥ 拍照時套的濾鏡（原生 applyLook：CIColorCubeWithColorSpace，sRGB 編碼值上查表，再依強度混合）
    vec3 e = oetf3(clamp(uToSrgb * c, 0.0, 1.0));
    vec3 uvw = (e * (uCubeSize - 1.0) + 0.5) / uCubeSize;
    vec3 o = uFromSrgb * eotf3(texture(uCube, uvw).rgb);
    c = mix(c, o, uLutAmt);
  }
  /* 有相機特效：先交出特效要的底（線性 P3 套 sRGB 曲線＝原生 CILinearToSRGBToneCurve），後面 FX_FS 接著做 */
  if (uFxOn) { outColor = vec4(oetf3(c), 1.0); return; }
  vec3 sr = clamp(uToSrgb * c, 0.0, 1.0);                        // ⑤ 線性 P3 → sRGB
  outColor = vec4(uDither ? dith(oetf3(sr)) : oetf3(sr), 1.0);
}`;

/* ── 相機特效（照原生 ios/App/App/ABAICameraFx.swift 的 apply，同一個順序、同一組常數） ── */
/** 縮小取樣（原生是仿射縮放＝雙線性取樣），柔光再加亮部擷取（brightPass） */
const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uSrc; uniform bool uBright;
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  if (uBright) { float l = dot(c, vec3(0.299, 0.587, 0.114)); c *= clamp((l - 0.70) * 5.0, 0.0, 1.0); }
  outColor = vec4(c, 1.0);
}`;
/** 分離式高斯模糊（邊緣延伸＝原生 clampedToExtent） */
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uSrc; uniform vec2 uStep; uniform float uSigma;
void main() {
  int R = int(min(64.0, ceil(uSigma * 3.0)));
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = -64; i <= 64; i++) {
    if (i < -R || i > R) continue;
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    acc += texture(uSrc, vUv + uStep * float(i)).rgb * w; ws += w;
  }
  outColor = vec4(acc / ws, 1.0);
}`;
const FX_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uBaseTex, uBlurTex, uGlowTex;
uniform highp sampler3D uLowCube;
uniform vec2 uSize;
uniform float uBlur, uSoft, uLowfi, uCell, uLowCubeSize, uGrain;
uniform mat3 uToSrgb, uFromSrgb;
float srgbOetf(float v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
float srgbEotf(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 oetf3(vec3 c) { return vec3(srgbOetf(c.r), srgbOetf(c.g), srgbOetf(c.b)); }
vec3 eotf3(vec3 c) { return vec3(srgbEotf(c.r), srgbEotf(c.g), srgbEotf(c.b)); }
/* 截成 8 位元前加三角分佈抖色（±1 階，跟編輯器 lutGpu 同一招）：之後再拉對比、曲線也不會出現一圈一圈的色階，
   每個位置的值固定（同一組參數每一格都一樣，拖曳中跟放手後完全相同） */
float dHash(uvec2 q){q=q*uvec2(1597334673u,3812015801u);uint n=(q.x^q.y)*1597334673u;return float(n)*(1./4294967296.);}
vec3 dith(vec3 c){uvec2 q=uvec2(gl_FragCoord.xy);float d=dHash(q)+dHash(q+uvec2(7919u,104729u))-1.;return clamp(c+d/255.,0.,1.);}
uniform bool uDither;
float abaiHash(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 base = texture(uBaseTex, vUv).rgb;
  vec3 c = base;
  if (uBlur > 0.001) c = mix(c, texture(uBlurTex, vUv).rgb, uBlur * 0.625);                 // 模糊
  if (uLowfi > 0.001) {                                                                    // 低保真：色差（以畫面中心對稱，跟座標朝向無關）
    vec2 p = vUv * uSize, d = vUv - 0.5;
    vec2 sh = d * 0.004 * (0.15 + dot(d, d) * 3.0) * uSize;
    float r = texture(uBaseTex, (p + sh) / uSize).r, bl = texture(uBaseTex, (p - sh) / uSize).b;
    c += (vec3(r, base.g, bl) - base) * uLowfi;
  }
  if (uSoft > 0.001) {                                                                     // 柔光：亮部的光暈以濾色疊上
    vec3 g = clamp(texture(uGlowTex, vUv).rgb * min(1.0, uSoft * 1.5), 0.0, 1.0);
    c = 1.0 - (1.0 - c) * (1.0 - g);
  }
  if (uLowfi > 0.001) {                                                                    // 低保真：色彩表、對比、曝光、顆粒
    vec3 e = oetf3(clamp(uToSrgb * eotf3(c), 0.0, 1.0));
    vec3 lutc = oetf3(uFromSrgb * eotf3(texture(uLowCube, (e * (uLowCubeSize - 1.0) + 0.5) / uLowCubeSize).rgb));
    vec3 c2 = mix(c, lutc, 0.80);
    c2 = ((c2 - 0.5) * (1.0 + 10.0 * 0.004) + 0.5) * exp2(10.0 * 0.008);
    float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
    /* 顆粒的格子用原生的座標（Core Image 的 y 往上）：同一個位置是同一顆 */
    vec2 dc = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
    vec2 cl = floor(dc / uCell);
    float mono = abaiHash(cl + 731.0) - 0.5;
    vec3 n = vec3(abaiHash(cl + 1949.0), abaiHash(cl + 2896.0), abaiHash(cl + 3843.0)) - 0.5;
    c2 += uGrain * 1.6 * (0.55 + 0.45 * (1.0 - lum)) * (mono * 0.55 + n * 0.85) / 255.0;
    c = mix(c, clamp(c2, 0.0, 1.0), uLowfi);
  }
  vec3 sr = clamp(uToSrgb * eotf3(c), 0.0, 1.0);                                          // 回線性 P3 → sRGB 8 位元
  outColor = vec4(uDither ? dith(oetf3(sr)) : oetf3(sr), 1.0);
}`;
export interface RawGpuFx { soft: number; blur: number; lowfi: number; lowfiCube?: { data: Float32Array; size: number } | null }

/** 一張 RAW 的 GPU 沖洗器：建立時把線性資料傳上 GPU，之後每一格 render() 直接出 sRGB 8 位元像素 */
export class RawGpu {
  /** 低保真的顆粒強度（原生 lowfiGrain）；只有測試會改 */
  static grain = 50;
  /** 輸出前的抖色（正式使用一律開；只有逐像素比對的測試會關掉） */
  static dither = true;
  readonly w: number; readonly h: number;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private lin: WebGLTexture; private base: WebGLTexture;
  private cube: WebGLTexture | null = null; private cubeSize = 0; private lutAmt = 0;
  private fbs = new Map<string, { fb: WebGLFramebuffer; tex: WebGLTexture }>();
  private u: Record<string, WebGLUniformLocation | null> = {};
  /* 相機特效 */
  private fx: RawGpuFx | null = null;
  private fxProg: { down: WebGLProgram; blur: WebGLProgram; fx: WebGLProgram } | null = null;
  private lowCube: WebGLTexture | null = null; private lowCubeSize = 0;
  /** 中間的貼圖能不能用半精度浮點（不能就用 8 位元） */
  private floatTargets = false;
  private asShot: [number, number];
  private lost = false;

  /** 建不起來（沒有 WebGL2、資料不對）丟例外，呼叫端改走原生出像素那條 */
  constructor(lin: Uint16Array, w: number, h: number, base: Uint16Array, bw: number, bh: number, asShot: [number, number],
    lut?: { data: Float32Array; size: number; amount: number } | null, fx?: RawGpuFx | null) {
    if (lin.length !== w * h * 4 || base.length !== bw * bh * 4) throw new Error('raw-gpu: size');
    const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
    const gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false });
    if (!gl) throw new Error('raw-gpu: no webgl2');
    cv.addEventListener('webglcontextlost', () => { this.lost = true; });
    this.gl = gl; this.w = w; this.h = h; this.asShot = asShot;
    const sh = (t: number, src: string) => {
      const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('raw-gpu: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const link = (fs: string) => {
      const pr = gl.createProgram()!;
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(pr, 0, 'aPos');
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('raw-gpu: link');
      return pr;
    };
    const prog = link(FS);
    this.prog = prog;
    for (const n of ['uLin', 'uBase', 'uCube', 'uGain', 'uExpo', 'uHi', 'uSh', 'uLutAmt', 'uCubeSize', 'uWbOn', 'uLutOn', 'uFxOn', 'uDither', 'uWb', 'uToSrgb', 'uFromSrgb']) this.u[n] = gl.getUniformLocation(prog, n);
    if (fx && (fx.soft > 0.001 || fx.blur > 0.001 || fx.lowfi > 0.001)) {
      if (fx.lowfi > 0.001 && !(fx.lowfiCube && fx.lowfiCube.size >= 2)) throw new Error('raw-gpu: lowfi cube');
      this.fx = fx;
      this.fxProg = { down: link(DOWN_FS), blur: link(BLUR_FS), fx: link(FX_FS) };
      this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    }
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = (data: Uint16Array, tw: number, th: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tw, th, 0, gl.RGBA, gl.HALF_FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.lin = tex(lin, w, h);
    this.base = tex(base, bw, bh);
    if (lut && lut.size >= 2) {
      /* 3D 貼圖：寬＝紅、高＝綠、深＝藍（跟原生的表一樣紅色變化最快）。半精度浮點才能平滑內插 */
      const hd = new Uint16Array(lut.data.length);
      for (let i = 0; i < hd.length; i++) hd[i] = f2h(lut.data[i]);
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.HALF_FLOAT, hd);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
      this.cube = t; this.cubeSize = lut.size; this.lutAmt = Math.max(0, Math.min(1, lut.amount));
    }
    if (this.fx?.lowfiCube) this.lowCube = this.cube3d(this.fx.lowfiCube.data, this.fx.lowfiCube.size), this.lowCubeSize = this.fx.lowfiCube.size;
    if (gl.getError() !== gl.NO_ERROR) throw new Error('raw-gpu: upload');
  }

  get ok() { return !this.lost && !this.gl.isContextLost(); }

  private cube3d(data: Float32Array, size: number) {
    const gl = this.gl;
    const hd = new Uint16Array(data.length);
    for (let i = 0; i < hd.length; i++) hd[i] = f2h(data[i]);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, size, size, size, 0, gl.RGBA, gl.HALF_FLOAT, hd);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    return t;
  }
  /** 畫圖的目標（貼圖＋framebuffer），同一個名字、尺寸重複用 */
  private target(name: string, W: number, H: number, float: boolean) {
    const gl = this.gl;
    const key = `${name}:${W}x${H}:${float ? 'f' : 'b'}`;
    let t = this.fbs.get(key);
    if (!t) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
      t = { fb, tex }; this.fbs.set(key, t);
    }
    return t;
  }
  /** 用某個程式畫滿某個目標 */
  private pass(prog: WebGLProgram, t: { fb: WebGLFramebuffer }, W: number, H: number, set: (loc: (n: string) => WebGLUniformLocation | null) => void) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    set(n => gl.getUniformLocation(prog, n));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  /** 縮小（可選亮部擷取）→ 高斯模糊（橫、直各一次）：回傳模糊好的小圖 */
  private blurSmall(src: WebGLTexture, sw: number, sh: number, sigma: number, bright: boolean, tag: string) {
    const gl = this.gl, P = this.fxProg!, f = this.floatTargets;
    const a = this.target(`${tag}a`, sw, sh, f), b = this.target(`${tag}b`, sw, sh, f);
    if (!a || !b) return null;
    this.pass(P.down, a, sw, sh, loc => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(loc('uSrc'), 0); gl.uniform1i(loc('uBright'), bright ? 1 : 0); });
    this.pass(P.blur, b, sw, sh, loc => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex); gl.uniform1i(loc('uSrc'), 0); gl.uniform2f(loc('uStep'), 1 / sw, 0); gl.uniform1f(loc('uSigma'), Math.max(0.01, sigma)); });
    this.pass(P.blur, a, sw, sh, loc => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, b.tex); gl.uniform1i(loc('uSrc'), 0); gl.uniform2f(loc('uStep'), 0, 1 / sh); gl.uniform1f(loc('uSigma'), Math.max(0.01, sigma)); });
    return a.tex;
  }

  /** 照這組參數沖一張 W×H 的 sRGB 8 位元像素（RGBA，由上往下）。失敗回 null */
  render(p: RawGpuParams, W = this.w, H = this.h): Uint8ClampedArray | null {
    if (!this.ok) return null;
    const gl = this.gl;
    const fx = this.fx;
    /* 沒有特效：主流程直接畫成品。有特效：主流程先畫「特效要的底」，再接特效 */
    const t = fx ? this.target('base', W, H, this.floatTargets) : this.target('out', W, H, false);
    if (!t) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.uniform1i(this.u.uFxOn, fx ? 1 : 0);
    gl.uniform1i(this.u.uDither, RawGpu.dither ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.lin); gl.uniform1i(this.u.uLin, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.base); gl.uniform1i(this.u.uBase, 1);
    gl.uniform1f(this.u.uGain, Math.pow(2, p.exposure));
    gl.uniform1f(this.u.uExpo, p.exposure);
    gl.uniform1f(this.u.uHi, p.highlights);
    gl.uniform1f(this.u.uSh, p.shadows);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, this.cube); gl.uniform1i(this.u.uCube, 2);
    gl.uniform1i(this.u.uLutOn, this.cube && this.lutAmt > 0 ? 1 : 0);
    gl.uniform1f(this.u.uLutAmt, this.lutAmt);
    gl.uniform1f(this.u.uCubeSize, Math.max(2, this.cubeSize));
    gl.uniformMatrix3fv(this.u.uFromSrgb, true, new Float32Array(SRGB_TO_P3));
    const wb = rawWbMatrix(p, this.asShot);
    gl.uniform1i(this.u.uWbOn, wb ? 1 : 0);
    /* GLSL 的 mat3 是行優先：傳列優先的資料要轉置 */
    gl.uniformMatrix3fv(this.u.uWb, true, new Float32Array(wb ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]));
    gl.uniformMatrix3fv(this.u.uToSrgb, true, new Float32Array(P3_TO_SRGB));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (fx) {
      /* 模糊：縮到寬 360 上模糊（原生同一組換算：半徑 0.6＋強度×3.2，強度高時兩輪），柔光：長邊 176 的亮部光暈 */
      let blurTex: WebGLTexture | null = null, glowTex: WebGLTexture | null = null;
      if (fx.blur > 0.001) {
        const r = 0.6 + fx.blur * 3.2, passes = fx.blur > 0.55 ? 2 : 1, s = Math.min(1, 360 / W);
        const sigma = r * 1.4 * Math.sqrt(passes) / 270 * W * s;
        blurTex = this.blurSmall(t.tex, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)), sigma, false, 'bl');
        if (!blurTex) return null;
      }
      if (fx.soft > 0.001) {
        const s = 176 / Math.max(W, H);
        glowTex = this.blurSmall(t.tex, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)), 4.5, true, 'gl');
        if (!glowTex) return null;
      }
      const o = this.target('out', W, H, false);
      if (!o) return null;
      const P = this.fxProg!;
      this.pass(P.fx, o, W, H, loc => {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(loc('uBaseTex'), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blurTex ?? t.tex); gl.uniform1i(loc('uBlurTex'), 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, glowTex ?? t.tex); gl.uniform1i(loc('uGlowTex'), 2);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_3D, this.lowCube); gl.uniform1i(loc('uLowCube'), 3);
        gl.uniform2f(loc('uSize'), W, H);
        gl.uniform1f(loc('uBlur'), fx.blur); gl.uniform1f(loc('uSoft'), fx.soft); gl.uniform1f(loc('uLowfi'), fx.lowfi);
        /* 顆粒格子的大小：原生 e.width / 1200 × (0.5 + 50 × 0.025) */
        gl.uniform1f(loc('uCell'), W / 1200 * 1.75);
        gl.uniform1f(loc('uLowCubeSize'), Math.max(2, this.lowCubeSize));
        /* 顆粒強度：原生的固定值 50（測試時可以關掉，單獨比對其他步驟） */
        gl.uniform1f(loc('uGrain'), RawGpu.grain);
        gl.uniform1i(loc('uDither'), RawGpu.dither ? 1 : 0);
        gl.uniformMatrix3fv(loc('uToSrgb'), true, new Float32Array(P3_TO_SRGB));
        gl.uniformMatrix3fv(loc('uFromSrgb'), true, new Float32Array(SRGB_TO_P3));
      });
    }
    /* 讀回來：framebuffer 的第 0 列對應貼圖的第 0 列（＝資料的第一列，最上面），所以讀出來就是由上往下 */
    const out = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return gl.getError() === gl.NO_ERROR ? new Uint8ClampedArray(out.buffer) : null;
  }

  dispose() {
    const gl = this.gl;
    for (const { fb, tex } of this.fbs.values()) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); }
    this.fbs.clear();
    gl.deleteTexture(this.lin); gl.deleteTexture(this.base); if (this.cube) gl.deleteTexture(this.cube); if (this.lowCube) gl.deleteTexture(this.lowCube);
    gl.deleteProgram(this.prog); if (this.fxProg) { gl.deleteProgram(this.fxProg.down); gl.deleteProgram(this.fxProg.blur); gl.deleteProgram(this.fxProg.fx); }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
