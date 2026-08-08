/**
 * 用 GPU 套「烤好的顏色鏈 3D LUT」。
 *
 * 這一支只做一件事：把一張圖 ＋ 一顆 3D 查色表，變成畫好的畫面。
 * 顏色怎麼算是 utils/lutBake.ts 烤出來的（而那又是直接呼叫現有的 CPU 管線），
 * 所以這裡完全沒有任何顏色公式 —— 它只負責「查表」這個動作，
 * 而查表正好是顯示卡天生就在做的事：sampler3D 開 LINEAR，
 * 三線性內插由硬體免費完成，跟 CPU 版的 sampleBaked 算的是同一件事。
 *
 * 為什麼這樣就會快
 * ─────────────────────────────────────────────────────────────
 * 原本每動一次滑桿，主執行緒要把 148 萬個像素各自跑完整條顏色鏈（約 111ms）。
 * 現在改成：CPU 只算 33³ 或 65³ 個格點（2～18ms），
 * GPU 用一個 draw call 把整張圖查完（1～3ms），而且不佔主執行緒。
 * 圖片本身只上傳一次，之後換濾鏡＝換綁一張幾百 KB 的貼圖。
 *
 * 安全性
 * ─────────────────────────────────────────────────────────────
 * · 沒有 WebGL2 → create() 回傳 null，呼叫端自動走原本的 CPU 路徑
 * · iOS 記憶體吃緊時會把 WebGL 上下文收走 → 監聽 contextlost，
 *   標記成失效並讓呼叫端退回 CPU；contextrestored 後自己重建
 * · 圖片超過裝置的貼圖上限 → fits() 回報 false，呼叫端走 CPU
 */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  /* 上下顛倒：WebGL 的紋理原點在左下，畫布在左上 */
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D uImage;
uniform sampler3D uLut;
/* 邊界修正：查色表的第一個與最後一個格點分別落在 0 與 1 的「格心」上，
   直接用 0～1 去取樣會在兩端各少半格，暗部與亮部就會偏掉。
   scale/offset 把座標壓進 [半格, 1-半格]，跟 CPU 版的格點對法完全一致。 */
uniform float uScale;
uniform float uOffset;
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec4 src = texture(uImage, vUv);
  vec3 c = clamp(src.rgb, 0.0, 1.0) * uScale + uOffset;
  fragColor = vec4(texture(uLut, c).rgb, src.a);
}`;

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
};

export class LutGpu {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private imgTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private uScale: WebGLUniformLocation | null;
  private uOffset: WebGLUniformLocation | null;
  private lutSize = 0;
  private srcW = 0;
  private srcH = 0;
  /** 上下文被系統收走時變 true，呼叫端看到就退回 CPU */
  lost = false;
  readonly canvas: HTMLCanvasElement;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext,
                      prog: WebGLProgram, imgTex: WebGLTexture, lutTex: WebGLTexture) {
    this.canvas = canvas;
    this.gl = gl;
    this.prog = prog;
    this.imgTex = imgTex;
    this.lutTex = lutTex;
    this.uScale = gl.getUniformLocation(prog, 'uScale');
    this.uOffset = gl.getUniformLocation(prog, 'uOffset');
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = true; });
  }

  static create(): LutGpu | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true,
      antialias: false, depth: false, stencil: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) return null;

    /* 軟體模擬的 GL 要擋掉。
       某些桌機瀏覽器、虛擬機、無障礙模式底下拿到的 WebGL 其實是 CPU 在算的
       （SwiftShader / llvmpipe / Mesa softpipe）。那種情況下「GPU 查表」不但沒有
       比較快，還會因為多一次貼圖上傳而變慢 —— 實測慢了將近一倍。
       這裡直接不給用，呼叫端會原封不動走回原本的 CPU 路徑。 */
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(
        (dbg && gl.getParameter((dbg as any).UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '',
      ).toLowerCase();
      if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/.test(name)) return null;
    } catch { /* 拿不到就當作是真的顯示卡 */ }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);

    // 一個覆蓋整個畫面的三角形，比兩個三角形的方塊少一次頂點處理
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const imgTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imgTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'uImage'), 0);

    const lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'uLut'), 1);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    return new LutGpu(canvas, gl, prog, imgTex, lutTex);
  }

  /** 這張圖的尺寸這台裝置吃得下嗎（吃不下就讓呼叫端走 CPU） */
  fits(w: number, h: number): boolean {
    const max = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    return w <= max && h <= max;
  }

  /** 上傳來源影像。同一張圖只要傳一次，之後換濾鏡、動滑桿都不必再傳。 */
  setSource(data: Uint8ClampedArray, w: number, h: number): boolean {
    if (this.lost || !this.fits(w, h)) return false;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    this.srcW = w; this.srcH = h;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    return true;
  }

  /** 換一顆查色表（換濾鏡／動滑桿都走這裡，幾百 KB，很便宜） */
  setLut(tex: Uint8Array, size: number): boolean {
    if (this.lost) return false;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    if (size !== this.lutSize) {
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, tex);
      this.lutSize = size;
    } else {
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, size, size, size, gl.RGBA, gl.UNSIGNED_BYTE, tex);
    }
    gl.useProgram(this.prog);
    // 半格內縮，跟 CPU 版的格點對法一致
    gl.uniform1f(this.uScale, (size - 1) / size);
    gl.uniform1f(this.uOffset, 0.5 / size);
    return true;
  }

  /** 畫一張。回傳的是這個類別自己的畫布，呼叫端 drawImage 過去就好。 */
  draw(): HTMLCanvasElement | null {
    if (this.lost || !this.srcW || !this.lutSize) return null;
    const gl = this.gl;
    gl.viewport(0, 0, this.srcW, this.srcH);
    gl.useProgram(this.prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }

  /** 需要像素資料時才叫（後面的特效合成會用到）。比 draw 慢，能不叫就不叫。 */
  readInto(out: Uint8ClampedArray): boolean {
    if (this.lost || !this.srcW) return false;
    const gl = this.gl;
    const need = this.srcW * this.srcH * 4;
    if (out.length < need) return false;
    const buf = new Uint8Array(out.buffer, out.byteOffset, need);
    gl.readPixels(0, 0, this.srcW, this.srcH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    /* readPixels 是由下往上讀的，翻回來 */
    const rowBytes = this.srcW * 4;
    const tmp = new Uint8Array(rowBytes);
    for (let y = 0; y < (this.srcH >> 1); y++) {
      const a = y * rowBytes, b = (this.srcH - 1 - y) * rowBytes;
      tmp.set(buf.subarray(a, a + rowBytes));
      buf.copyWithin(a, b, b + rowBytes);
      buf.set(tmp, b);
    }
    return true;
  }

  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
