/**
 * 影片的 GPU 預覽層。
 *
 * 這一支存在的理由，用一個數字說完
 * ─────────────────────────────────────────────────────────────
 * 把一段 1080p 影片的一格貼進 2D 畫布（`drawImage(video, …)`），
 * 在手機等級的 CPU 上要 **20.9 毫秒**。一秒 30 格＝626 毫秒，
 * 也就是說光是「把影片搬進畫布」就已經吃掉六成的時間，
 * 拼圖本身還一筆都還沒畫。實測過所有替代寫法，沒有一條躲得掉：
 *     drawImage(影片 → 小尺寸)          20.9 ms
 *     drawImage(影片 → 原尺寸)          20.1 ms   ← 縮放不是瓶頸
 *     createImageBitmap(縮到小尺寸)      20.4 ms
 *     來源先降成 540p 再貼               12.9 ms   ← 連轉檔都救不了
 *     WebGL 材質上傳＋畫               **4.9 ms**  ← 只有這條
 * 差別在於前四條都要把 YUV 影格解回 RGB **搬到 CPU 記憶體**，
 * 而 WebGL 是把同一張影格交給顯示卡，轉換由硬體順手做掉。
 *
 * 所以這一層的規則只有一條：**影片的像素不准進 CPU**。
 * 影格上成材質、查一次色表、畫在自己的畫布上，而這張畫布直接就是
 * 畫面上看到的元素 —— 不回讀、不 drawImage 到別的地方
 * （實測回貼一次要 104 毫秒，一回讀就前功盡棄）。
 *
 * 顏色從哪裡來
 * ─────────────────────────────────────────────────────────────
 * 濾鏡與調節整條鏈由 photoFx.bakePhotoFxLut 烤成一顆 33³ 查色表，
 * 那一支呼叫的仍然是原本的 CPU 管線（processPixels）。
 * 所以影片跟照片套同一顆濾鏡，出來的顏色是同一個，這裡沒有第二套顏色公式。
 * 表只在「換濾鏡／動滑桿」時重烤，跟影格數完全無關。
 *
 * 形狀（圓角／外形／羽化）
 * ─────────────────────────────────────────────────────────────
 * 用第二張材質當遮罩，資料來源是既有的 makeShapeMask —— 跟畫布那條路
 * 同一支產生器，所以邊緣、羽化的衰減曲線一模一樣。遮罩只有在形狀參數或
 * 尺寸變了才重傳，一樣跟影格數無關。
 *
 * 安全性
 * ─────────────────────────────────────────────────────────────
 * · 沒有 WebGL2、或拿到的是軟體模擬的 GL → create() 回 null，呼叫端走原本那條路
 * · iOS 記憶體吃緊會收走 GL 上下文 → 標記 lost，呼叫端退回原本那條路
 */

import { FX_DEFS, fxActive, fxPassSource, FX_BLEND_FS, FX_VS, FX_REF, type FxDef } from './glEffects';
import { activeCpuFx, CPU_FX_DEFAULTS, type CpuFxDef } from './videoFxCpu';

/* ── 特效（那一整排「朦朧／動態模糊／VHS／馬賽克…」）─────────────────
   這些不是顏色，是「看鄰居的像素」的效果，塞不進一顆查色表 ——
   所以以前套在影片上完全沒有反應（面板照樣長出來，只是不會動）。

   做法：影格上了材質、查完色表之後，**不要直接畫到畫面上**，先畫到一張
   離屏材質，然後照 utils/glEffects 那一份把每一個特效的著色器一趟一趟跑過去
   （ping-pong 兩張材質輪流當來源與目標），最後一趟才連同形狀遮罩畫到畫面上。
   著色器原始碼是**跟照片那條路同一份**（fxPassSource），所以同一個特效、
   同一組參數，影片與照片跑出來是同一個結果。

   全程都在同一個 WebGL 上下文裡，沒有任何一次把畫面讀回 CPU。 */

/** 特效那幾支是 GLSL ES 1.00 寫的（照片那條路是 WebGL1）。
    WebGL2 的上下文接受不寫 #version 的舊版著色器，所以可以直接沿用。 */
const FX_VERT = FX_VS;

/** 最後一趟：把跑完特效的結果套上形狀遮罩、預乘 alpha，畫到畫面上。
    ⚠ 遮罩要翻 y —— 特效那幾支用的頂點著色器不翻轉，跟下面 VERT 相反。 */
const FX_OUT_FS = `precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uMaskF;
uniform float uHasMaskF;
void main(){
  vec3 c = texture2D(uTex, vUv).rgb;
  float a = 1.0;
  if (uHasMaskF > 0.5) a = texture2D(uMaskF, vec2(vUv.x, 1.0 - vUv.y)).a;
  gl_FragColor = vec4(c * a, a);
}`;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  /* 上下顛倒：WebGL 材質原點在左下，畫布在左上。
     影片影格與遮罩畫布都是「第一列＝最上面」，所以兩張用同一組座標。 */
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D uImage;
uniform sampler3D uLut;
uniform sampler2D uMask;
/* 邊界修正：查色表的頭尾格點落在格心上，直接用 0～1 取樣兩端會各少半格。
   scale/offset 把座標壓進 [半格, 1-半格]，跟 CPU 版的格點對法一致。 */
uniform float uScale;
uniform float uOffset;
uniform bool uHasLut;
uniform bool uHasMask;
/* 影片在框裡的裁切（構圖）。xy＝左上角、zw＝寬高，都是 0～1 的比例。 */
uniform vec4 uCrop;
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 uv = uCrop.xy + vUv * uCrop.zw;
  vec4 src = texture(uImage, uv);
  vec3 c = src.rgb;
  if (uHasLut) {
    c = clamp(c, 0.0, 1.0) * uScale + uOffset;
    c = texture(uLut, c).rgb;
  }
  float a = src.a;
  if (uHasMask) a *= texture(uMask, vUv).a;
  /* 預乘：畫布是 premultipliedAlpha:false，但瀏覽器合成這張畫布時
     期待的是「已經乘好」的資料，不乘的話羽化的邊會透出一圈亮邊。 */
  fragColor = vec4(c * a, a);
}`;

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
  return sh;
};

export type Crop = { x: number; y: number; w: number; h: number };
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

export class VideoGl {
  /** 直接掛到畫面上的那張畫布。**不要**把它 drawImage 到別的地方（見檔頭）。 */
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private imgTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private lutSize = 0;
  private hasLut = false;
  private hasMask = false;
  private maskKey = '';
  private crop: Crop = FULL;
  /* ── 特效鏈用的東西（沒有特效時全部不會被建立） ── */
  private fxDefs: FxDef[] = [];
  /** 柔光／光暈／漏光／噪點／朦朧／暗角 —— 這幾支原本只有 CPU 版（見 videoFxCpu） */
  private cpuFx: CpuFxDef[] = [];
  private noiseTex: WebGLTexture | null = null;
  private noiseSize = 1;
  private fxParams: any = null;
  private fbo: WebGLFramebuffer | null = null;
  private fxTex: WebGLTexture[] = [];
  private fxW = 0;
  private fxH = 0;
  private fxProgs = new Map<string, WebGLProgram>();
  /** 上下文被系統收走時變 true，呼叫端看到就退回原本那條路 */
  lost = false;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext,
                      prog: WebGLProgram, imgTex: WebGLTexture,
                      lutTex: WebGLTexture, maskTex: WebGLTexture) {
    this.canvas = canvas; this.gl = gl; this.prog = prog;
    this.imgTex = imgTex; this.lutTex = lutTex; this.maskTex = maskTex;
    for (const n of ['uScale', 'uOffset', 'uHasLut', 'uHasMask', 'uCrop']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = true; });
  }

  static create(): VideoGl | null {
    if (typeof document === 'undefined') return null;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', {
        alpha: true, premultipliedAlpha: false, antialias: false,
        depth: false, stencil: false,
        /* 影片是一直在動的，保留上一格沒有意義，關掉可以少一次複製 */
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;
      if (!gl) return null;

      /* 軟體模擬的 GL 要擋掉（跟 lutGpu 同一條判斷）。
         我一開始拿掉了這一條，理由是「同一台純軟體的機器上，WebGL 上傳＋畫
         只要 4.9ms，而 drawImage 進 2D 畫布要 20.7ms」—— 那個數字是真的，
         但量的是**只有一次貼圖取樣的空著色器**。換成真正要用的那支
         （每個像素還要在 33³ 查色表裡做一次三線性內插）之後再量，
         整格的時間變成 102ms，其中 76% 是 SwiftShader 在 CPU 上跑光柵化。
         也就是說：沒有真的顯示卡時，這條路比原本還慢。
         有顯示卡時那一段是硬體免費做的，所以擋掉軟體、其餘照走。 */
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
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);

      // 一個蓋滿畫面的大三角形，比兩個三角形的方塊少一次頂點處理
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      const mk2d = (unit: number, name: string) => {
        const t = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(prog, name), unit);
        return t;
      };
      const imgTex = mk2d(0, 'uImage');
      const maskTex = mk2d(2, 'uMask');

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
      return new VideoGl(canvas, gl, prog, imgTex, lutTex, maskTex);
    } catch {
      return null;
    }
  }

  /** 換一顆烤好的查色表（換濾鏡／動滑桿走這裡）。傳 null＝原色直通。 */
  setLut(lut: { tex: Uint8Array; size: number } | null): void {
    if (this.lost) return;
    const gl = this.gl;
    if (!lut) { this.hasLut = false; return; }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    const { tex, size } = lut;
    if (size !== this.lutSize) {
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, tex);
      this.lutSize = size;
    } else {
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, size, size, size, gl.RGBA, gl.UNSIGNED_BYTE, tex);
    }
    gl.useProgram(this.prog);
    gl.uniform1f(this.u.uScale, (size - 1) / size);   // 半格內縮，跟 CPU 版一致
    gl.uniform1f(this.u.uOffset, 0.5 / size);
    this.hasLut = true;
  }

  /**
   * 換形狀遮罩。key 是「這張遮罩的身分」——一樣就不重傳，
   * 所以播放中每一格都呼叫也不會有成本。傳 null＝沒有形狀。
   */
  setMask(mask: CanvasImageSource | null, key: string): void {
    if (this.lost) return;
    if (!mask) { this.hasMask = false; this.maskKey = ''; return; }
    if (key === this.maskKey && this.hasMask) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask as any);
    } catch { this.hasMask = false; this.maskKey = ''; return; }
    this.hasMask = true;
    this.maskKey = key;
  }

  /** 構圖（裁切）：影片只取這一塊。全部都是 0～1 的比例。 */
  setCrop(c: Crop | null): void {
    this.crop = c || FULL;
  }

  /**
   * 這一層要跑哪些特效。參數就是圖層身上那包 fx（跟照片那條路同一包），
   * 所以同一個特效、同一組數值，兩邊跑的是同一支著色器、同一個結果。
   * 傳 null 或沒有任何特效開著 → 完全走原本那條單趟的路，成本一模一樣。
   */
  /**
   * @param noisePattern 噪點那張圖樣（呼叫端從 photoFx 的 getNoisePattern 拿）。
   *        這裡刻意不自己 import photoFx —— 那支會連進整個編輯頁的像素管線，
   *        而這一層要保持「只碰 GL」。
   */
  setFx(params: any, noisePattern?: HTMLCanvasElement | null): void {
    this.fxParams = params || null;
    this.fxDefs = params ? FX_DEFS.filter(d => fxActive(params, d)) : [];
    this.cpuFx = activeCpuFx(params);
    if (this.cpuFx.some(d => d.id === 'colorNoise')) this.ensureNoise(noisePattern || null);
  }

  /** 噪點那張圖樣（跟 CPU 版同一張），第一次要用到才上材質 */
  private ensureNoise(pattern: HTMLCanvasElement | null): boolean {
    if (this.noiseTex) return true;
    if (!pattern) return false;
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) return false;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pattern);
    } catch { return false; }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.noiseTex = t;
    this.noiseSize = pattern.width || 1;
    return true;
  }

  /** 跑完一個 CPU 系特效，回傳結果在哪一張材質 */
  private runCpuFx(d: CpuFxDef, T: WebGLTexture[], layerIn: number, W: number, H: number): number {
    const gl = this.gl;
    const S = Math.max(W, H) / 1080;
    const fx = this.fxParams || {};
    const rad = d.radius(fx, W, H, S);
    let from = layerIn;
    for (let i = 0; i < d.passes.length; i++) {
      const ps = d.passes[i];
      const prog = this.fxProg(`cpu:${d.id}#${i}`, ps.fs);
      if (!prog) return layerIn;
      let to = 0;
      while (to === from || to === layerIn) to++;
      gl.useProgram(prog);
      /* uTex＝上一趟；uSrc＝這一層的輸入（合成時要用的「原圖」） */
      this.fxBind(prog, T[ps.fromSrc ? layerIn : from], T[layerIn], W, H);
      gl.uniform1f(gl.getUniformLocation(prog, 'uS'), S);
      if (ps.blur) {
        gl.uniform2f(gl.getUniformLocation(prog, 'uDir'), ps.blur[0], ps.blur[1]);
        gl.uniform1f(gl.getUniformLocation(prog, 'uRad'), rad);
      }
      for (const u of d.uniforms) {
        const raw = fx[u];
        const v = typeof raw === 'number' ? raw : (CPU_FX_DEFAULTS[u] ?? 0);
        gl.uniform1f(gl.getUniformLocation(prog, u), v);
      }
      if (d.id === 'colorNoise' && this.noiseTex) {
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
        gl.uniform1i(gl.getUniformLocation(prog, 'uNoise'), 5);
        gl.uniform1f(gl.getUniformLocation(prog, 'uNoiseSize'), this.noiseSize);
      }
      this.fxDrawTo(T[to]);
      from = to;
    }
    return from;
  }

  /** 編一支特效著色器（編過就留著，拖滑桿時不會重編） */
  private fxProg(key: string, fsSrc: string): WebGLProgram | null {
    const hit = this.fxProgs.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const vs = compile(gl, gl.VERTEX_SHADER, FX_VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram()!;
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    this.fxProgs.set(key, p);
    return p;
  }

  /** ping-pong 用的三張離屏材質，尺寸變了才重配 */
  private fxPool(W: number, H: number): boolean {
    const gl = this.gl;
    if (this.fbo && this.fxW === W && this.fxH === H && this.fxTex.length === 3) return true;
    for (const t of this.fxTex) gl.deleteTexture(t);
    this.fxTex = [];
    if (!this.fbo) this.fbo = gl.createFramebuffer();
    if (!this.fbo) return false;
    for (let i = 0; i < 3; i++) {
      const t = gl.createTexture();
      if (!t) return false;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.fxTex.push(t);
    }
    this.fxW = W; this.fxH = H;
    return true;
  }

  /** 把 uTex / uSrc 綁到 3、4 號材質單位（0～2 給影格、色表、遮罩用著） */
  private fxBind(prog: WebGLProgram, main: WebGLTexture, src: WebGLTexture, W: number, H: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, main);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(prog, 'uSrc'), 4);
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), W, H);
    /* 基準像素：跟照片那條路同一條算式，所以同一組參數在不同尺寸下
       看到的效果一樣（不會「預覽比較小就比較弱」）。 */
    gl.uniform2f(gl.getUniformLocation(prog, 'uTexel'), 1 / FX_REF, (W / H) / FX_REF);
    gl.uniform2f(gl.getUniformLocation(prog, 'uRefRes'), FX_REF, FX_REF * H / W);
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), 0);
  }

  private fxDrawTo(target: WebGLTexture | null): void {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * 畫一格。w / h 是**畫面上真正的實體像素**——畫布就開這麼大，
   * 一個多的像素都不算（1080p 顯示在 300px 寬的框裡時差 36 倍）。
   * @returns 有沒有真的畫出來；false 代表呼叫端該退回原本那條路
   */
  drawFrame(video: HTMLVideoElement, w: number, h: number): boolean {
    if (this.lost) return false;
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return false;
    const gl = this.gl;
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      /* 這一行就是整支的重點：影格直接進顯示卡，YUV→RGB 由硬體做，
         主執行緒一個像素都沒碰到。 */
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      if (this.canvas.width !== W || this.canvas.height !== H) {
        this.canvas.width = W; this.canvas.height = H;
      }
      const c = this.crop;
      const useFx = (this.fxDefs.length > 0 || this.cpuFx.length > 0) && this.fxPool(W, H);
      gl.useProgram(this.prog);
      gl.uniform1i(this.u.uHasLut, this.hasLut ? 1 : 0);
      /* 有特效時，遮罩留到最後一趟才套 —— 先套的話特效會去抹到
         被遮掉的透明區域，邊緣就髒了。照片那條路也是最後才裁形狀。 */
      gl.uniform1i(this.u.uHasMask, (!useFx && this.hasMask) ? 1 : 0);
      gl.uniform4f(this.u.uCrop, c.x, c.y, c.w, c.h);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);

      if (!useFx) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return true;
      }

      /* ── 特效鏈 ─────────────────────────────────────────────
         ① 影格＋裁切＋查色表 → texs[0]
         ② 每一個特效跑完自己的幾趟，再跟「這一層的輸入」按強度插值
         ③ 最後一趟套上形狀遮罩、預乘 alpha，畫到畫面上 */
      const T = this.fxTex;
      this.fxDrawTo(T[0]);

      let cur = 0;
      /* ① 先跑「原本只有 CPU 版」那幾支（噪點／朦朧／柔光／漏光／光暈／暗角），
            順序跟 applyPhotoFx 裡一模一樣，然後才輪到 glEffects 那批 —— 
            跟照片、跟匯出走的是同一個順序。 */
      for (const d of this.cpuFx) {
        cur = this.runCpuFx(d, T, cur, W, H);
      }
      for (const d of this.fxDefs) {
        const layerIn = cur;
        let from = cur;
        for (let i = 0; i < d.passes.length; i++) {
          const pass = d.passes[i];
          const prog = this.fxProg(`${d.id}#${i}`, fxPassSource(d, pass));
          if (!prog) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
          let to = 0;
          while (to === from || to === layerIn) to++;
          gl.useProgram(prog);
          this.fxBind(prog, T[from], T[layerIn], W, H);
          gl.uniform2f(gl.getUniformLocation(prog, 'uDir'),
            pass.dir ? pass.dir[0] : 1, pass.dir ? pass.dir[1] : 0);
          for (const pp of d.params) {
            const raw = this.fxParams ? this.fxParams[pp.id] : undefined;
            const v = (typeof raw === 'number' ? raw : pp.def) * (pp.scale ?? 1);
            gl.uniform1f(gl.getUniformLocation(prog, pp.id), v);
          }
          this.fxDrawTo(T[to]);
          from = to;
        }
        const blend = this.fxProg('__blend', FX_BLEND_FS);
        if (!blend) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
        let to = 0;
        while (to === from || to === layerIn) to++;
        gl.useProgram(blend);
        this.fxBind(blend, T[from], T[layerIn], W, H);
        const amt = Math.max(0, Math.min(1, ((this.fxParams?.[d.id]) || 0) / 100));
        gl.uniform1f(gl.getUniformLocation(blend, 'uAmount'), amt);
        this.fxDrawTo(T[to]);
        cur = to;
      }

      const out = this.fxProg('__out', FX_OUT_FS);
      if (!out) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
      gl.useProgram(out);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, T[cur]);
      gl.uniform1i(gl.getUniformLocation(out, 'uTex'), 3);
      gl.uniform1i(gl.getUniformLocation(out, 'uMaskF'), 2);
      gl.uniform1f(gl.getUniformLocation(out, 'uHasMaskF'), this.hasMask ? 1 : 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    try {
      const gl = this.gl;
      for (const t of this.fxTex) gl.deleteTexture(t);
      this.fxTex = [];
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      this.fbo = null;
      for (const p of this.fxProgs.values()) gl.deleteProgram(p);
      this.fxProgs.clear();
      if (this.noiseTex) gl.deleteTexture(this.noiseTex);
      this.noiseTex = null;
    } catch { /* 收不掉算了 */ }
    try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* 收不掉算了 */ }
  }
}

/**
 * 這台裝置到底能不能用這條路 —— 問一次就好，答案存起來。
 * create() 有成本（編著色器），所以呼叫端要先問這個再決定要不要開。
 */
let supported: boolean | null = null;
export const videoGlSupported = (): boolean => {
  if (supported === null) {
    const probe = VideoGl.create();
    supported = !!probe;
    probe?.dispose();
  }
  return supported;
};
