/* 波浪動畫的「垂直正弦位移」。
   舊做法是把畫面切成很多直條、每條各自剪下來斜切再貼回去：直條交界的剪裁邊
   有抗鋸齒、又互相重疊半個像素，半透明的地方（模糊圖形、發光、柔邊）就會看到
   一條條接縫，像被切成很多塊。

   這裡改用 GPU 逐像素取樣：輸出的每個像素 (x, y) 直接去讀來源 (x, y − dy(x))，
   dy(x) = amp · sin(2π(x·freq + off))，雙線性內插、預乘 alpha，位移是連續的正弦，
   不存在任何切片。WebGL 用不了的時候退回「每 1 個裝置像素一條、整數對齊、互不
   重疊」的直條，一樣沒有接縫。 */

export type WaveWarpResult = { canvas: HTMLCanvasElement; padY: number };

type GLState = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  tex: WebGLTexture;
  u: Record<string, WebGLUniformLocation | null>;
};

let glState: GLState | null | undefined;

const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const FS = `precision highp float;
varying vec2 v;
uniform sampler2D t;
uniform vec2 srcSize;   // 整張來源的像素大小
uniform vec4 region;    // 來源裡要用的區塊 x, y, w, h
uniform vec2 outSize;   // 輸出像素大小
uniform float padY, amp, freq, off, revealW;
void main(){
  float x = v.x * outSize.x;
  float y = (1. - v.y) * outSize.y;
  if (x > revealW) { gl_FragColor = vec4(0.); return; }
  float dy = amp * sin(6.283185307179586 * (x * freq + off));
  vec2 s = vec2(x, y - padY - dy);
  if (s.y < 0. || s.y > region.w || s.x < 0. || s.x > region.z) { gl_FragColor = vec4(0.); return; }
  // 邊緣半個像素內往內夾，避免讀到區塊外的像素
  vec2 sp = clamp(s, vec2(.5), region.zw - .5) + region.xy;
  gl_FragColor = texture2D(t, sp / srcSize);
}`;

const initGL = (): GLState | null => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const u: GLState['u'] = {};
    for (const n of ['t', 'srcSize', 'region', 'outSize', 'padY', 'amp', 'freq', 'off', 'revealW']) u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(u.t, 0);
    canvas.addEventListener('webglcontextlost', () => { glState = undefined; });
    return { canvas, gl, tex, u };
  } catch { return null; }
};

let fallbackCanvas: HTMLCanvasElement | null = null;

/**
 * 把 src 的 (sx, sy, sw, sh) 區塊套上垂直正弦位移。輸出寬 sw、高 sh + 2·padY，
 * 輸出的 (0, padY) 對應來源的 (sx, sy)。呼叫端把結果畫在 (目的 x, 目的 y − padY)。
 * 輸出畫布是共用的，請在同一個工作裡馬上 drawImage 掉。
 */
export function waveWarp(
  src: HTMLCanvasElement | OffscreenCanvas | ImageBitmap,
  sx: number, sy: number, sw: number, sh: number,
  amp: number, freq: number, off: number, revealW = Infinity,
): WaveWarpResult | null {
  sx = Math.round(sx); sy = Math.round(sy);
  const W = Math.max(1, Math.round(sw)), Hs = Math.max(1, Math.round(sh));
  const padY = Math.ceil(Math.abs(amp)) + 2;
  const H = Hs + padY * 2;
  if (glState === undefined) glState = initGL();
  const st = glState;
  if (st && !st.gl.isContextLost()) {
    const { gl, canvas, u } = st;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    gl.viewport(0, 0, W, H);
    gl.bindTexture(gl.TEXTURE_2D, st.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as any);
    gl.uniform2f(u.srcSize, (src as any).width, (src as any).height);
    gl.uniform4f(u.region, sx, sy, W, Hs);
    gl.uniform2f(u.outSize, W, H);
    gl.uniform1f(u.padY, padY);
    gl.uniform1f(u.amp, amp);
    gl.uniform1f(u.freq, freq);
    gl.uniform1f(u.off, off);
    gl.uniform1f(u.revealW, Math.min(revealW, 1e9));
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return { canvas, padY };
  }
  // 退路：每個像素一條、整數對齊、互不重疊
  const c = fallbackCanvas || (fallbackCanvas = document.createElement('canvas'));
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  const end = Math.min(W, Math.ceil(revealW));
  for (let x = 0; x < end; x++) {
    const dy = amp * Math.sin(Math.PI * 2 * ((x + .5) * freq + off));
    g.drawImage(src as any, sx + x, sy, 1, Hs, x, padY + dy, 1, Hs);
  }
  return { canvas: c, padY };
}
