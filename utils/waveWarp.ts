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
/* 拿不到 WebGL（iPhone 同時開太多 GPU 畫布時，系統會收回舊的）不代表之後都拿不到：
   隔一段時間再試，不要從此一直走退路。 */
let glRetryAt = 0;
let glMaxTex = 4096;

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
    glMaxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
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
  if (glState === undefined || (glState === null && performance.now() > glRetryAt)) {
    glState = initGL();
    if (!glState) glRetryAt = performance.now() + 1500;
  }
  const st = glState;
  const srcW = (src as any).width, srcH = (src as any).height;
  // 來源或輸出超過 GPU 能處理的尺寸：上傳會失敗、畫出空白 —— 走下面的精確退路
  const fits = Math.max(srcW, srcH, W, H) <= glMaxTex && !(globalThis as any).__waveCPU;
  if (st && fits && !st.gl.isContextLost()) {
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
    if (gl.getError() === gl.NO_ERROR && !gl.isContextLost()) return { canvas, padY };
    // GPU 這一次沒畫成（記憶體不足、內容遺失…）：同一格改用下面的精確退路，不交出空白
  }
  /* 退路：在 CPU 上逐像素做跟 GPU 完全一樣的取樣（每個輸出像素往上下兩個來源像素按比例混合、預乘 alpha）。
     舊的退路是「每個像素一條直條、各自往上下挪一點點再 drawImage」——
     iPhone 畫圖片時會把位置對齊到整數像素，零點幾像素的位移被吃掉，彎的邊就變成一階一階的鋸齒
     （預覽走 GPU 看不到，匯出時 GPU 畫布被系統收回才會走到這裡，所以「成品才有」）。 */
  const c = fallbackCanvas || (fallbackCanvas = document.createElement('canvas'));
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  // 來源那一塊讀成像素（不是 2D 畫布的來源先畫進暫存）
  let sd: Uint8ClampedArray;
  try {
    let sg = (src as any).getContext?.('2d') as CanvasRenderingContext2D | null | undefined;
    let ox = sx, oy = sy;
    if (!sg) {
      const t = document.createElement('canvas'); t.width = W; t.height = Hs;
      sg = t.getContext('2d')!; sg.drawImage(src as any, sx, sy, W, Hs, 0, 0, W, Hs); ox = 0; oy = 0;
    }
    sd = sg.getImageData(ox, oy, W, Hs).data;
  } catch { return null; }
  const out = g.createImageData(W, H), od = out.data;
  const end = Math.min(W, Math.ceil(revealW));
  for (let x = 0; x < end; x++) {
    const dy = amp * Math.sin(Math.PI * 2 * ((x + .5) * freq + off));
    for (let y = 0; y < H; y++) {
      // 跟著色器一樣：取樣點 (x+.5, y+.5−padY−dy)，換成來源的「列」座標（像素中心 = k+.5）
      const fy = y + .5 - padY - dy;
      if (fy < 0 || fy > Hs) continue;
      const ry = Math.min(Hs - .5, Math.max(.5, fy)) - .5;
      const y0 = Math.floor(ry), t = ry - y0, y1 = Math.min(Hs - 1, y0 + 1);
      const i0 = (y0 * W + x) * 4, i1 = (y1 * W + x) * 4;
      const a0 = sd[i0 + 3] * (1 - t), a1 = sd[i1 + 3] * t, a = a0 + a1;
      if (a <= 0) continue;
      const o = (y * W + x) * 4;
      od[o] = (sd[i0] * a0 + sd[i1] * a1) / a;
      od[o + 1] = (sd[i0 + 1] * a0 + sd[i1 + 1] * a1) / a;
      od[o + 2] = (sd[i0 + 2] * a0 + sd[i1 + 2] * a1) / a;
      od[o + 3] = a;
    }
  }
  g.putImageData(out, 0, 0);
  return { canvas: c, padY };
}

/* 畫筆進場：把線條路徑本身截到 x ≤ tipX（只認 M、L、C；C 先攤平成短直線）。
   用截好的路徑去畫本體、描邊與發光，發光就不會被一刀切掉。 */
export function revealPathD(d: string, tipX: number): string {
  const tok = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const out: string[] = [];
  let i = 0, cmd = '', px = 0, py = 0, open = false;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const num = () => Number(tok[i++]);
  const seg = (x: number, y: number) => {
    if (px <= tipX && x <= tipX) { if (!open) { out.push(`M ${r(px)} ${r(py)}`); open = true; } out.push(`L ${r(x)} ${r(y)}`); }
    else if (px <= tipX || x <= tipX) {
      const t = (tipX - px) / ((x - px) || 1e-9), cx = tipX, cy = py + (y - py) * t;
      if (px <= tipX) { if (!open) out.push(`M ${r(px)} ${r(py)}`); out.push(`L ${r(cx)} ${r(cy)}`); open = false; }
      else { out.push(`M ${r(cx)} ${r(cy)}`, `L ${r(x)} ${r(y)}`); open = true; }
    } else open = false;
    px = x; py = y;
  };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === 'Z') { open = false; continue; }
    if (cmd === 'M') { px = num(); py = num(); open = false; cmd = 'L'; continue; }
    if (cmd === 'L') { seg(num(), num()); continue; }
    if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num(), x0 = px, y0 = py;
      for (let k = 1; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        seg(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
      }
      continue;
    }
    i++;
  }
  return out.join(' ');
}
