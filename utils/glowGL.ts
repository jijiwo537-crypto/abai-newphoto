/* 文字發光（GPU 版）：
   ‧ 字的形狀（快取的文字點陣）上傳成貼圖一次（同一張點陣只傳一次）。
   ‧ 三層光各自在「剛好夠用」的小解析度上做高斯模糊（兩趟分離式，σ 固定 6 像素）——
     拉發光滑桿時只重做這一步，GPU 上不到 1 毫秒。
   ‧ 每一格畫面：在螢幕解析度上，用雙三次（B-spline）取樣把三層光放大合成 ——
     放大多少倍都是平滑曲線（雙線性放大會看到一格一格的折角），再加一點點抖色，不會有一圈圈的色帶。
     字的位置照「字的透明度」挖掉（跟 2D 版同一套規則），最後貼回主畫布。
   任何一步不行（沒有 WebGL2、內容遺失）就回傳 false，呼叫端改用 2D 版。 */

type Layer = { tex: WebGLTexture; w: number; h: number; wv: number; lx: number; ly: number };
type GlowLayers = { layers: Layer[]; bytes: number };

let gl: WebGL2RenderingContext | null = null, cv: HTMLCanvasElement | null = null, broken = false;
let blurProg: WebGLProgram | null = null, compProg: WebGLProgram | null = null;
let fbo: WebGLFramebuffer | null = null, tmpTex: WebGLTexture | null = null, tmpW = 0, tmpH = 0;
const maskTex = new WeakMap<HTMLCanvasElement, { tex: WebGLTexture; gen: number }>();
const maskList: { canvas: HTMLCanvasElement; tex: WebGLTexture }[] = [];
const layerCache = new Map<string, GlowLayers>();
let ctxGen = 0;

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
// 分離式高斯：dir＝(1,0) 橫向（從字的貼圖取樣）或 (0,1) 直向（從橫向結果取樣）
const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D src; uniform bool fromMask;
uniform vec2 dir; uniform vec2 outSize;
uniform vec4 layerRect;  // 這層光在字座標的 x,y 與每單位像素數 wv（zw 不用）
uniform vec4 maskRect;   // 字貼圖在字座標的 x,y,w,h
uniform float maskLod;
uniform float sigma;
out vec4 o;
float tap(vec2 px){
  if (fromMask) {
    vec2 t = layerRect.xy + px / layerRect.z;
    vec2 uv = (t - maskRect.xy) / maskRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
    return textureLod(src, uv, maskLod).a;
  }
  return texture(src, px / outSize).r;
}
void main(){
  vec2 px = gl_FragCoord.xy;
  float r = ceil(sigma * 3.0), sum = 0.0, wsum = 0.0;
  for (float i = -24.0; i <= 24.0; i += 1.0) {
    if (abs(i) > r) continue;
    float w = exp(-0.5 * i * i / (sigma * sigma));
    sum += w * tap(px + dir * i); wsum += w;
  }
  o = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;
const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D L0; uniform sampler2D L1; uniform sampler2D L2; uniform sampler2D mask;
uniform vec4 R0; uniform vec4 R1; uniform vec4 R2;   // 各層：x,y（字座標）、wv、未用
uniform vec2 S0; uniform vec2 S1; uniform vec2 S2;   // 各層貼圖大小
uniform int nLayers;
uniform mat3 inv;          // 螢幕像素 → 字座標
uniform vec2 origin;       // 這塊區域左上角的螢幕像素位置
uniform float outH;        // 畫布高（翻轉 y 用）
uniform vec4 maskRect; uniform float maskLod;
uniform vec3 color; uniform float knockK; uniform float knockInner;
out vec4 o;
vec4 cubic(float v){ vec4 n = vec4(1.0,2.0,3.0,4.0) - v; vec4 s = n*n*n; float x = s.x; float y = s.y - 4.0*s.x; float z = s.z - 4.0*s.y + 6.0*s.x; return vec4(x, y, z, 6.0 - x - y - z) / 6.0; }
float bicubic(sampler2D t, vec2 size, vec2 p){
  p -= 0.5; vec2 f = fract(p); p -= f;
  vec4 xc = cubic(f.x), yc = cubic(f.y);
  vec4 c = p.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
  float a = texture(t, off.xz).r, b = texture(t, off.yz).r, cc = texture(t, off.xw).r, d = texture(t, off.yw).r;
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(d, cc, sx), mix(b, a, sx), sy);
}
float layerA(sampler2D t, vec2 size, vec4 r, vec2 tp){ return clamp(bicubic(t, size, (tp - r.xy) * r.z), 0.0, 1.0); }
void main(){
  vec2 dev = vec2(origin.x + gl_FragCoord.x, origin.y + (outH - gl_FragCoord.y));
  vec2 tp = (inv * vec3(dev, 1.0)).xy;
  float keep = 1.0 - layerA(L0, S0, R0, tp);
  if (nLayers > 1) keep *= 1.0 - layerA(L1, S1, R1, tp);
  if (nLayers > 2) keep *= 1.0 - layerA(L2, S2, R2, tp);
  float a = 1.0 - keep;
  vec2 uv = (tp - maskRect.xy) / maskRect.zw;
  float c = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : textureLod(mask, uv, maskLod).a;
  a *= (1.0 - knockK * c) * (1.0 - knockInner * c * c * c * c);
  // 抖色：±半階，八位元的漸層不會出現一圈一圈
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  a = clamp(a + n / 255.0, 0.0, 1.0);
  o = vec4(color * a, a);
}`;

function compile(g: WebGL2RenderingContext, vs: string, fs: string) {
  const mk = (t: number, src: string) => { const s = g.createShader(t)!; g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || 'shader'); return s; };
  const p = g.createProgram()!; g.attachShader(p, mk(g.VERTEX_SHADER, vs)); g.attachShader(p, mk(g.FRAGMENT_SHADER, fs));
  g.bindAttribLocation(p, 0, 'p'); g.linkProgram(p);
  if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) || 'link');
  return p;
}

function init(): WebGL2RenderingContext | null {
  if (gl && !gl.isContextLost()) return gl;
  if (broken || typeof document === 'undefined') return null;
  try {
    cv = cv || document.createElement('canvas');
    cv.width = cv.height = 1;
    const g = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!g) { broken = true; return null; }
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; ctxGen++; layerCache.clear(); maskList.length = 0; });
    blurProg = compile(g, VS, BLUR_FS); compProg = compile(g, VS, COMP_FS);
    const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    fbo = g.createFramebuffer(); tmpTex = null; tmpW = tmpH = 0;
    gl = g; ctxGen++;
    return g;
  } catch { broken = true; return null; }
}

function newTex(g: WebGL2RenderingContext, w: number, h: number) {
  const t = g.createTexture()!; g.bindTexture(g.TEXTURE_2D, t);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  return t;
}

function maskFor(g: WebGL2RenderingContext, canvas: HTMLCanvasElement): WebGLTexture | null {
  const hit = maskTex.get(canvas);
  if (hit && hit.gen === ctxGen) return hit.tex;
  const max = g.getParameter(g.MAX_TEXTURE_SIZE) as number;
  if (canvas.width > max || canvas.height > max) return null;
  const t = g.createTexture()!; g.bindTexture(g.TEXTURE_2D, t);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, canvas);
  g.generateMipmap(g.TEXTURE_2D);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  maskTex.set(canvas, { tex: t, gen: ctxGen });
  maskList.push({ canvas, tex: t });
  // 字的點陣快取會淘汰（寬度設成 1）：對應的貼圖也收掉；最多留 24 張
  for (let i = maskList.length - 1; i >= 0; i--) if (maskList[i].canvas.width <= 1 || maskList.length > 24 && i === 0) { g.deleteTexture(maskList[i].tex); maskTex.delete(maskList[i].canvas); maskList.splice(i, 1); }
  return t;
}

export type GlowJob = {
  ctx: CanvasRenderingContext2D;
  mask: HTMLCanvasElement; maskX: number; maskY: number; maskW: number; maskH: number;   // 字座標
  x: number; y: number;               // 繪製原點（字座標）
  sigmas: number[];                    // 各層高斯 σ（字座標單位）
  color: string; textAlpha: number; key: string;
};

const parseColor = (() => {
  let c2: CanvasRenderingContext2D | null = null; const memo = new Map<string, [number, number, number]>();
  return (s: string): [number, number, number] => {
    const m = memo.get(s); if (m) return m;
    c2 = c2 || document.createElement('canvas').getContext('2d')!;
    c2.fillStyle = '#000'; c2.fillStyle = s; const v = String(c2.fillStyle);
    let r = 1, g = 1, b = 1;
    if (v[0] === '#') { r = parseInt(v.slice(1, 3), 16) / 255; g = parseInt(v.slice(3, 5), 16) / 255; b = parseInt(v.slice(5, 7), 16) / 255; }
    else { const n = v.match(/[\d.]+/g); if (n) { r = +n[0] / 255; g = +n[1] / 255; b = +n[2] / 255; } }
    const out: [number, number, number] = [r, g, b]; memo.set(s, out); if (memo.size > 200) memo.clear(); return out;
  };
})();

/* 保險：實際量合成一次要多久（含貼回主畫布）。這台裝置的 GPU 路徑如果平均超過 10 毫秒，就整段改回 2D 版 */
let ema = 0, samples = 0;
/** GPU 畫一段字的發光到 job.ctx（目前矩陣、目前透明度）。成功回 true */
export function drawGlowGL(job: GlowJob): boolean {
  if (broken) return false;
  const t0 = performance.now();
  const ok = drawGlowGLInner(job);
  if (ok) {
    const dt = performance.now() - t0;
    samples++; ema = samples === 1 ? dt : ema * 0.8 + dt * 0.2;
    if (samples > 6 && ema > 10) broken = true;
  }
  return ok;
}
function drawGlowGLInner(job: GlowJob): boolean {
  const g = init(); if (!g || !cv || !blurProg || !compProg) return false;
  const { ctx } = job;
  const m = ctx.getTransform();
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); if (!(k > 0)) return false;
  const mt = maskFor(g, job.mask); if (!mt) return false;
  const lvMask = job.mask.width / job.maskW;     // 字貼圖：每單位幾像素

  // ── 各層光（字座標裡的模糊；只跟字、發光大小有關，縮放、移動都重用）
  const SIG = 6;
  const pad = Math.max(...job.sigmas) * 3.4 + 2 / lvMask;
  const lw = job.maskW + pad * 2, lh = job.maskH + pad * 2;
  let gl3 = layerCache.get(job.key);
  if (!gl3) {
    const layers: Layer[] = []; let bytes = 0;
    g.useProgram(blurProg);
    const U = (n: string) => g.getUniformLocation(blurProg!, n);
    for (const sg of job.sigmas) {
      const wv = Math.min(SIG / Math.max(1e-4, sg), 4096 / Math.max(lw, lh));
      const w = Math.max(2, Math.ceil(lw * wv)), h = Math.max(2, Math.ceil(lh * wv));
      const lx = job.maskX - pad, ly = job.maskY - pad;
      if (tmpW < w || tmpH < h) { if (tmpTex) g.deleteTexture(tmpTex); tmpW = Math.max(tmpW, w); tmpH = Math.max(tmpH, h); tmpTex = newTex(g, tmpW, tmpH); }
      const tex = newTex(g, w, h);
      const sigPx = Math.max(0.5, sg * wv);
      const lod = Math.max(0, Math.log2(lvMask / wv));
      // 橫向：字貼圖 → tmp
      g.bindFramebuffer(g.FRAMEBUFFER, fbo); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tmpTex, 0);
      g.viewport(0, 0, w, h);
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, mt);
      g.uniform1i(U('src'), 0); g.uniform1i(U('fromMask'), 1); g.uniform2f(U('dir'), 1, 0);
      g.uniform2f(U('outSize'), tmpW, tmpH);
      // 片元座標 y 由下往上：這裡直接把「字座標 y」也當成由下往上的方向用（上下對稱的模糊，最後合成時一起翻）
      g.uniform4f(U('layerRect'), lx, ly, wv, 0); g.uniform4f(U('maskRect'), job.maskX, job.maskY, job.maskW, job.maskH);
      g.uniform1f(U('maskLod'), lod); g.uniform1f(U('sigma'), Math.min(sigPx, 8));
      g.drawArrays(g.TRIANGLES, 0, 3);
      // 直向：tmp → 這層
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
      g.bindTexture(g.TEXTURE_2D, tmpTex); g.uniform1i(U('fromMask'), 0); g.uniform2f(U('dir'), 0, 1);
      g.drawArrays(g.TRIANGLES, 0, 3);
      layers.push({ tex, w, h, wv, lx, ly }); bytes += w * h * 4;
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    gl3 = { layers, bytes };
    layerCache.set(job.key, gl3);
    while (layerCache.size > 32) { const k0 = layerCache.keys().next().value!; for (const l of layerCache.get(k0)!.layers) g.deleteTexture(l.tex); layerCache.delete(k0); }
  } else { layerCache.delete(job.key); layerCache.set(job.key, gl3); }

  // ── 合成：只算光會出現的那一塊螢幕
  const xs = [job.x + job.maskX - pad, job.x + job.maskX - pad + lw], ys = [job.y + job.maskY - pad, job.y + job.maskY - pad + lh];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const px of xs) for (const py of ys) {
    const dx = m.a * px + m.c * py + m.e, dy = m.b * px + m.d * py + m.f;
    x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
  }
  const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0));
  const bw = Math.min(ctx.canvas.width, Math.ceil(x1)) - bx, bh = Math.min(ctx.canvas.height, Math.ceil(y1)) - by;
  if (bw <= 0 || bh <= 0) return true;
  if (bw > 8192 || bh > 8192) return false;
  if (cv.width < bw || cv.height < bh) { cv.width = Math.max(cv.width, bw); cv.height = Math.max(cv.height, bh); }
  g.bindFramebuffer(g.FRAMEBUFFER, null);
  g.viewport(0, cv.height - bh, bw, bh);
  g.disable(g.BLEND); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
  g.useProgram(compProg);
  const U = (n: string) => g.getUniformLocation(compProg!, n);
  // 螢幕 → 字座標（再減去繪製原點）
  const det = m.a * m.d - m.b * m.c;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  const ie = -(ia * m.e + ic * m.f) - job.x, iff = -(ib * m.e + id * m.f) - job.y;
  g.uniformMatrix3fv(U('inv'), false, [ia, ib, 0, ic, id, 0, ie, iff, 1]);
  g.uniform2f(U('origin'), bx, by); g.uniform1f(U('outH'), cv.height);
  const L = gl3.layers;
  // 模糊那兩趟的 y 是由下往上存的：取樣時把字座標的 y 翻過來
  const names: [string, string, string][] = [['L0', 'R0', 'S0'], ['L1', 'R1', 'S1'], ['L2', 'R2', 'S2']];
  L.slice(0, 3).forEach((l, i) => {
    g.activeTexture(g.TEXTURE1 + i); g.bindTexture(g.TEXTURE_2D, l.tex); g.uniform1i(U(names[i][0]), 1 + i);
    g.uniform4f(U(names[i][1]), l.lx, l.ly, l.wv, 0); g.uniform2f(U(names[i][2]), l.w, l.h);
  });
  for (let i = L.length; i < 3; i++) { g.activeTexture(g.TEXTURE1 + i); g.bindTexture(g.TEXTURE_2D, L[0].tex); g.uniform1i(U(names[i][0]), 1 + i); }
  g.uniform1i(U('nLayers'), Math.min(3, L.length));
  g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, mt); g.uniform1i(U('mask'), 0);
  g.uniform4f(U('maskRect'), job.maskX, job.maskY, job.maskW, job.maskH);
  g.uniform1f(U('maskLod'), Math.max(0, Math.log2(lvMask / k)));
  const [r, gg, b] = parseColor(job.color); g.uniform3f(U('color'), r, gg, b);
  const ta = Math.max(0, Math.min(1, job.textAlpha));
  g.uniform1f(U('knockK'), ta < 0.999 ? 2 * (1 - ta) / (2 - ta) : 0);
  g.uniform1f(U('knockInner'), ta < 0.999 ? 1 : 0);
  g.drawArrays(g.TRIANGLES, 0, 3);
  ctx.save();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cv, 0, 0, bw, bh, bx, by, bw, bh);
  ctx.restore();
  return true;
}
