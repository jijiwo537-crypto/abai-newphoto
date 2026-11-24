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
uniform float uGain, uExpo, uHi, uSh;
uniform bool uWbOn;
uniform mat3 uWb, uToSrgb;
const vec3 W = vec3(0.2289746, 0.6917385, 0.0792869);
float srgbOetf(float v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
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
  vec3 sr = clamp(uToSrgb * c, 0.0, 1.0);                        // ⑤ 線性 P3 → sRGB
  outColor = vec4(srgbOetf(sr.r), srgbOetf(sr.g), srgbOetf(sr.b), 1.0);
}`;

/** 一張 RAW 的 GPU 沖洗器：建立時把線性資料傳上 GPU，之後每一格 render() 直接出 sRGB 8 位元像素 */
export class RawGpu {
  readonly w: number; readonly h: number;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private lin: WebGLTexture; private base: WebGLTexture;
  private fbs = new Map<string, { fb: WebGLFramebuffer; tex: WebGLTexture }>();
  private u: Record<string, WebGLUniformLocation | null> = {};
  private asShot: [number, number];
  private lost = false;

  /** 建不起來（沒有 WebGL2、資料不對）丟例外，呼叫端改走原生出像素那條 */
  constructor(lin: Uint16Array, w: number, h: number, base: Uint16Array, bw: number, bh: number, asShot: [number, number]) {
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
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('raw-gpu: link');
    this.prog = prog;
    for (const n of ['uLin', 'uBase', 'uGain', 'uExpo', 'uHi', 'uSh', 'uWbOn', 'uWb', 'uToSrgb']) this.u[n] = gl.getUniformLocation(prog, n);
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
    if (gl.getError() !== gl.NO_ERROR) throw new Error('raw-gpu: upload');
  }

  get ok() { return !this.lost && !this.gl.isContextLost(); }

  /** 照這組參數沖一張 W×H 的 sRGB 8 位元像素（RGBA，由上往下）。失敗回 null */
  render(p: RawGpuParams, W = this.w, H = this.h): Uint8ClampedArray | null {
    if (!this.ok) return null;
    const gl = this.gl;
    const key = `${W}x${H}`;
    let t = this.fbs.get(key);
    if (!t) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
      t = { fb, tex }; this.fbs.set(key, t);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.lin); gl.uniform1i(this.u.uLin, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.base); gl.uniform1i(this.u.uBase, 1);
    gl.uniform1f(this.u.uGain, Math.pow(2, p.exposure));
    gl.uniform1f(this.u.uExpo, p.exposure);
    gl.uniform1f(this.u.uHi, p.highlights);
    gl.uniform1f(this.u.uSh, p.shadows);
    const wb = rawWbMatrix(p, this.asShot);
    gl.uniform1i(this.u.uWbOn, wb ? 1 : 0);
    /* GLSL 的 mat3 是行優先：傳列優先的資料要轉置 */
    gl.uniformMatrix3fv(this.u.uWb, true, new Float32Array(wb ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]));
    gl.uniformMatrix3fv(this.u.uToSrgb, true, new Float32Array(P3_TO_SRGB));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    /* 讀回來：framebuffer 的第 0 列對應貼圖的第 0 列（＝資料的第一列，最上面），所以讀出來就是由上往下 */
    const out = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return gl.getError() === gl.NO_ERROR ? new Uint8ClampedArray(out.buffer) : null;
  }

  dispose() {
    const gl = this.gl;
    for (const { fb, tex } of this.fbs.values()) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); }
    this.fbs.clear();
    gl.deleteTexture(this.lin); gl.deleteTexture(this.base); gl.deleteProgram(this.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
