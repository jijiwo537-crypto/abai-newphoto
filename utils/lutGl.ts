/**
 * 用 GPU 套 3D LUT。
 *
 * 原本每動一次滑桿、每換一次做法，都要在主執行緒把整張預覽的每個像素重算一遍
 * （查表 + 兩次 Lab 轉換），1400px 的圖大概要 100ms 以上 —— 拖滑桿當然卡。
 *
 * 交給 GPU 之後：
 *   - 圖片上傳一次
 *   - 三顆 LUT 各自上傳成一張 3D 貼圖，換做法只是換綁哪一張，不用重算
 *   - 強度、保護強度是 uniform，動滑桿只是改兩個浮點數再畫一次
 * 每次更新就只剩一個 draw call。
 *
 * 另外 3D 貼圖開 LINEAR 之後，三線性插值是硬體免費做掉的，
 * 跟 CPU 版的 sampleLut 算的是同一件事。
 *
 * 沒有 WebGL2 就回傳 null，外面自動退回 CPU 版本。
 */

import {
  MAX_SAT_RATIO, MIN_SAT_ROOM, MAX_SAT_FRACTION, GAMUT_C,
  RED_HUE, RED_CORE, RED_SPAN, RED_MIN_SAT, RED_HUE_DAMP, HUE_GATE_C,
  HUE_SOFT, SOFT_MAX_K,
} from './colorTransfer';

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D uImage;
uniform sampler3D uLut;
/* 防斷層的保護遮罩：R ＝ 膚色保護、G ＝ 紅色權重。已經在 CPU 上做完
   補洞與羽化，所以它看得到鄰居 —— 臉上那塊偏青的皮膚也一起受保護。
   uHasMask 是 0 的時候整條路退回原本的逐像素判斷，結果跟以前一模一樣。 */
uniform sampler2D uProtectMap;
uniform float uHasMask;
uniform float uStrength;
uniform float uProtect;
uniform float uLutScale;
uniform float uLutOffset;
uniform float uMaxSat;
uniform float uSatRoom;
uniform float uSatFrac;
uniform float uRedMinSat;
uniform float uRedDamp;
in vec2 vUv;
out vec4 fragColor;

const float PI = 3.14159265359;
const vec3 WHITE = vec3(0.95047, 1.0, 1.08883);
const float GAMUT[36] = float[36](${GAMUT_C.map((v) => v.toFixed(1)).join(', ')});

float toLinear(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float toSrgb(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }

/* 這顆像素有多「紅」（0～1）。升餘弦，邊緣斜率也是 0，所以接得上不會有斷層；
   彩度低的時候淡出，因為灰色的色相是雜訊。 */
float redWeight(vec2 ab) {
  float c = length(ab);
  if (c <= 0.0) return 0.0;
  float d = degrees(atan(ab.y, ab.x)) - ${RED_HUE.toFixed(1)};
  if (d > 180.0) d -= 360.0;
  if (d < -180.0) d += 360.0;
  d = abs(d);
  if (d >= ${RED_SPAN.toFixed(1)}) return 0.0;
  float w = d <= ${RED_CORE.toFixed(1)} ? 1.0
    : 0.5 * (1.0 + cos(PI * (d - ${RED_CORE.toFixed(1)}) / ${(RED_SPAN - RED_CORE).toFixed(1)}));
  float t = min(1.0, c / ${HUE_GATE_C.toFixed(1)});
  return w * t * t * (3.0 - 2.0 * t);
}

/* 這個色相在 sRGB 裡最濃能到多濃。表跟 CPU 版是同一份（從 GAMUT_C 注入進來的） */
// 兩個都從 CPU 版的常數注入，兩邊不會各走各的
const float HUE_SOFT = ${HUE_SOFT.toFixed(6)};      // 6 度
const float SOFT_MAX_K = ${SOFT_MAX_K.toFixed(2)};      // 平滑 max 的圓角（Lab 彩度單位）

/** 平滑版的 max：把尖角換成半徑 k 的圓角，處處可微 */
float softMax(float a, float b, float k) {
  float d = a - b;
  return 0.5 * (a + b + sqrt(d * d + k * k)) - 0.5 * k;
}

float gamutChroma(vec2 ab) {
  float h = degrees(atan(ab.y, ab.x));
  if (h < 0.0) h += 360.0;
  float x = h / 10.0;
  int i0 = int(floor(x)) % 36;
  float w = x - floor(x);
  return mix(GAMUT[i0], GAMUT[(i0 + 1) % 36], w);
}

vec3 rgb2lab(vec3 c) {
  vec3 lin = vec3(toLinear(c.r), toLinear(c.g), toLinear(c.b));
  vec3 xyz = vec3(
    dot(lin, vec3(0.4124564, 0.3575761, 0.1804375)),
    dot(lin, vec3(0.2126729, 0.7151522, 0.0721750)),
    dot(lin, vec3(0.0193339, 0.1191920, 0.9503041))
  ) / WHITE;
  vec3 f = mix(xyz * 7.787037037 + 16.0 / 116.0, pow(max(xyz, 1e-6), vec3(1.0 / 3.0)),
               step(vec3(0.008856451679), xyz));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}

vec3 lab2rgb(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  vec3 f = vec3(fy + lab.y / 500.0, fy, fy - lab.z / 200.0);
  vec3 t = vec3(greaterThan(f, vec3(0.20689655172)));
  vec3 xyz = mix((f - 16.0 / 116.0) / 7.787037037, f * f * f, t) * WHITE;
  vec3 lin = vec3(
    dot(xyz, vec3(3.2404542, -1.5371385, -0.4985314)),
    dot(xyz, vec3(-0.9692660, 1.8760108, 0.0415560)),
    dot(xyz, vec3(0.0556434, -0.2040259, 1.0572252))
  );
  lin = max(lin, 0.0);
  return clamp(vec3(toSrgb(lin.r), toSrgb(lin.g), toSrgb(lin.b)), 0.0, 1.0);
}

/* 膚色與唇色：在 Cb/Cr 平面上各放一個高斯，取比較像的那一個。
   回傳連續值而不是硬邊界，臉與嘴唇的邊緣才不會留下一圈色差。 */
float protectProb(vec3 c) {
  vec3 v = c * 255.0;
  float Y  = dot(v, vec3(0.299, 0.587, 0.114));
  float Cb = 128.0 + dot(v, vec3(-0.168736, -0.331264, 0.5));
  float Cr = 128.0 + dot(v, vec3(0.5, -0.418688, -0.081312));

  float dCbS = Cb - 110.0, dCrS = Cr - 152.0;
  float detS = 210.0 * 130.0 - 70.0 * 70.0;
  float mdS = (130.0 * dCbS * dCbS + 2.0 * 70.0 * dCbS * dCrS + 210.0 * dCrS * dCrS) / detS;
  float skin = exp(-0.5 * mdS);

  float dCbL = Cb - 108.0, dCrL = Cr - 172.0;
  float detL = 90.0 * 150.0 - 40.0 * 40.0;
  float mdL = (150.0 * dCbL * dCbL + 2.0 * 40.0 * dCbL * dCrL + 90.0 * dCrL * dCrL) / detL;
  float lip = exp(-0.5 * mdL);

  float ly = Y / 255.0;
  float gate = clamp((ly - 0.08) / 0.12, 0.0, 1.0) * clamp((0.98 - ly) / 0.10, 0.0, 1.0);
  return clamp(max(skin, lip) * gate, 0.0, 1.0);
}

/* 柔性色域壓縮 —— 跟 CPU 版 labToRgbSoft() 完全同一套。
   逐通道硬夾會歪色相、又會把一整片壓成同一個值（邊界就出現硬變）。
   這裡亮度與色相都不動，只把彩度收進色域，而且過了膝點才用指數慢慢逼近邊界，
   斜率永遠大於 0，所以顏色之間永遠留著差距，不會有斷層。 */
bool labInGamut(float L, vec2 ab) {
  float fy = (L + 16.0) / 116.0;
  float fx = fy + ab.x / 500.0;
  float fz = fy - ab.y / 200.0;
  vec3 f = vec3(fx, fy, fz);
  vec3 xyz = mix((f - 16.0 / 116.0) / 7.787037037, f * f * f, step(vec3(0.20689655172), f)) * WHITE;
  float R = dot(xyz, vec3(3.2404542, -1.5371385, -0.4985314));
  float G = dot(xyz, vec3(-0.9692660, 1.8760108, 0.0415560));
  float B = dot(xyz, vec3(0.0556434, -0.2040259, 1.0572252));
  float e = 1e-4;
  return R >= -e && R <= 1.0 + e && G >= -e && G <= 1.0 + e && B >= -e && B <= 1.0 + e;
}

vec3 lab2rgbSoft(float L, vec2 ab) {
  float Lc = clamp(L, 0.0, 100.0);
  float c = length(ab);
  if (c < 1e-6) return lab2rgb(vec3(Lc, ab));
  bool inNow = labInGamut(Lc, ab);
  float lo, hi;
  if (inNow) { lo = 1.0; hi = 4.0; } else { lo = 0.0; hi = 1.0; }
  for (int k = 0; k < 8; k++) {
    float m = 0.5 * (lo + hi);
    if (labInGamut(Lc, ab * m)) lo = m; else hi = m;
  }
  float cMax = c * lo;
  if (cMax <= 1e-6) return lab2rgb(vec3(Lc, vec2(0.0)));
  float knee = 0.82;
  float x = c / cMax;
  float cOut = c;
  if (x > knee) {
    float t = (x - knee) / (1.0 - knee);
    cOut = cMax * (knee + (1.0 - knee) * (1.0 - exp(-t)));
  }
  return lab2rgb(vec3(Lc, ab * (cOut / c)));
}

void main() {
  vec3 src = texture(uImage, vUv).rgb;
  vec3 mapped = texture(uLut, src * uLutScale + uLutOffset).rgb;
  vec3 labIn = rgb2lab(src);
  vec3 labOut = rgb2lab(mapped);
  vec2 pm = texture(uProtectMap, vUv).rg;
  float skinW = uHasMask > 0.5 ? pm.r : protectProb(src);
  float w = 1.0 - uProtect * skinW;
  // 亮度一律用原圖的（只換顏色不動明暗），色度依保護程度混合
  vec2 ab = mix(labIn.yz, labOut.yz, w);
  float cIn = length(labIn.yz);

  /* 紅色的兩道限制，跟 CPU 版一模一樣。權重用原圖的色相算，
     這樣它在畫面上是連續變化的，紅橘漸層才不會出現接縫。 */
  float rw = uHasMask > 0.5 ? pm.g : redWeight(labIn.yz);
  if (rw > 0.0) {
    float cNow = length(ab);
    if (cNow > 1e-6 && cIn > 1e-6) {
      float hIn = atan(labIn.z, labIn.y);
      float d = atan(ab.y, ab.x) - hIn;
      if (d > PI) d -= 2.0 * PI;
      if (d < -PI) d += 2.0 * PI;
      /* 往洋紅偏的那一邊（負的）打折。
         以前是 if (d < 0.0) 一刀切 —— 值接得上但斜率是斷的，強度放大之後
         畫面上會看到一條硬邊。改成在一小段角度內平滑接起來。 */
      float gate = smoothstep(0.0, 1.0, clamp(-d / HUE_SOFT, 0.0, 1.0));
      float h2 = hIn + d * (1.0 - uRedDamp * rw * gate);
      ab = vec2(cos(h2), sin(h2)) * cNow;
    }
    /* 彩度最多只能降到原本的 uRedMinSat。跟 CPU 版一樣，是把「有擋」與「沒擋」
       兩個結果依權重混合，不是拿權重去乘門檻 —— 後者會在紅色範圍的邊界留下接縫。 */
    float want = length(ab);
    // 平滑版的 max（圓角），避免轉折處出現折線 —— 跟 CPU 版同一條式子
    float held = softMax(want, cIn * uRedMinSat, SOFT_MAX_K);
    float cFinal = mix(want, held, rw);
    if (cFinal > want) {
      if (want > 1e-3) ab *= cFinal / want;
      else if (cIn > 1e-6) ab = labIn.yz * (cFinal / cIn);
    }
  }

  /* 飽和度天花板，跟 CPU 版 satCeiling() 完全同一條式子：
     超過上限的才等比例拉回來（色相不變），沒超過的一個位元都不動。
     放在最後，所以上面拉高的部分也一樣受它管。 */
  float cOut = length(ab);
  float cap = gamutChroma(ab) * uSatFrac;
  float lim = max(cIn, max(min(cIn * uMaxSat, cap), uSatRoom));
  if (cOut > lim && cOut > 1e-6) ab *= lim / cOut;
  /* 強度在 Lab 裡混合，最後只做一次柔性色域壓縮 —— 跟 CPU 版同一條路。
     以前是先把結果夾進 sRGB、再用 RGB 做 mix，強度超過 1 時會把已經夾過的值
     再往外拉、最後又被畫面緩衝區夾一次；兩次硬夾疊起來就把紅色那種
     本來就貼著色域邊緣的區域整片壓平，邊界出現硬變。 */
  vec3 labF = vec3(labIn.x, mix(labIn.yz, ab, uStrength));
  fragColor = vec4(lab2rgbSoft(labF.x, labF.yz), 1.0);
}`;

export type GlLut = { size: number; data: Float32Array };

export class LutRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private imgTex: WebGLTexture;
  private maskTex: WebGLTexture | null = null;
  private luts = new Map<string, WebGLTexture>();
  private uni: Record<string, WebGLUniformLocation | null> = {};
  private lutSize = 0;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, prog: WebGLProgram, imgTex: WebGLTexture) {
    this.canvas = canvas; this.gl = gl; this.prog = prog; this.imgTex = imgTex;
    for (const n of ['uImage', 'uLut', 'uProtectMap', 'uHasMask', 'uStrength', 'uProtect', 'uLutScale', 'uLutOffset', 'uMaxSat', 'uSatRoom', 'uSatFrac', 'uRedMinSat', 'uRedDamp']) {
      this.uni[n] = gl.getUniformLocation(prog, n);
    }
  }

  static create(): LutRenderer | null {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
      if (!gl) return null;
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const imgTex = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return new LutRenderer(canvas, gl, prog, imgTex);
    } catch {
      return null;
    }
  }

  /** 上傳要處理的圖（換圖才需要重來一次） */
  setImage(source: TexImageSource, w: number, h: number): void {
    const gl = this.gl;
    this.canvas.width = w; this.canvas.height = h;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as any);
    gl.viewport(0, 0, w, h);
  }

  /**
   * 上傳防斷層的保護遮罩（R ＝ 膚色保護、G ＝ 紅色權重）。
   * 遮罩是用縮圖算的，貼圖本來就會雙線性放大回來 —— 遮罩很平滑，這樣就夠了。
   * 翻轉設定跟 setImage 一樣，兩張貼圖才對得起來。
   */
  setProtectMap(rgba: Uint8Array, w: number, h: number): void {
    const gl = this.gl;
    if (!this.maskTex) this.maskTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(this.maskTex); this.maskTex = null; }
  }

  /** 沒有遮罩就回到原本的逐像素判斷 */
  clearProtectMap(): void {
    if (!this.maskTex) return;
    this.gl.deleteTexture(this.maskTex);
    this.maskTex = null;
  }

  /** 一顆 LUT 上傳成一張 3D 貼圖，之後換做法只是換綁 */
  setLut(key: string, lut: GlLut): void {
    const gl = this.gl;
    const N = lut.size;
    this.lutSize = N;
    let tex = this.luts.get(key);
    if (!tex) { tex = gl.createTexture()!; this.luts.set(key, tex); }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    // 用 8-bit 就夠，而且到處都支援；float 貼圖在部分手機上要額外的擴充
    const bytes = new Uint8Array(N * N * N * 4);
    for (let i = 0, k = 0; i < N * N * N; i++) {
      bytes[k++] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3])) * 255);
      bytes[k++] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 1])) * 255);
      bytes[k++] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 2])) * 255);
      bytes[k++] = 255;
    }
    // WebGL2 的 3D 貼圖一定要用「有標尺寸」的內部格式（RGBA8）。
    // 寫成 gl.RGBA 不會丟例外，但貼圖是空的 —— 查表全部讀成黑色，
    // 畫面會變成一張去飽和的灰圖，而且三種做法看起來一模一樣。
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    if (gl.getError() !== gl.NO_ERROR) { this.luts.delete(key); gl.deleteTexture(tex); throw new Error('lut3d'); }
  }

  hasLut(key: string): boolean { return this.luts.has(key); }

  /** 畫一張。換做法、動滑桿都只走這裡，成本就是一個 draw call。 */
  draw(key: string, strength: number, protect: number): boolean {
    const gl = this.gl;
    const tex = this.luts.get(key);
    if (!tex || !this.lutSize) return false;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.uniform1i(this.uni.uImage!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.uniform1i(this.uni.uLut!, 1);
    /* 沒有遮罩的時候也一定要綁一張貼圖到 uProtectMap ——
       取樣一個沒綁東西的 sampler2D 在某些驅動上是未定義行為。
       綁原圖那張、然後用 uHasMask = 0 把它整條路關掉最省事。 */
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex || this.imgTex);
    gl.uniform1i(this.uni.uProtectMap!, 2);
    gl.uniform1f(this.uni.uHasMask!, this.maskTex ? 1 : 0);
    gl.uniform1f(this.uni.uStrength!, strength);
    gl.uniform1f(this.uni.uProtect!, protect);
    // 貼圖座標要對到格子中心，才跟 CPU 版的三線性插值算同一件事
    gl.uniform1f(this.uni.uLutScale!, (this.lutSize - 1) / this.lutSize);
    gl.uniform1f(this.uni.uLutOffset!, 0.5 / this.lutSize);
    gl.uniform1f(this.uni.uMaxSat!, MAX_SAT_RATIO);
    gl.uniform1f(this.uni.uSatRoom!, MIN_SAT_ROOM);
    gl.uniform1f(this.uni.uSatFrac!, MAX_SAT_FRACTION);
    gl.uniform1f(this.uni.uRedMinSat!, RED_MIN_SAT);
    gl.uniform1f(this.uni.uRedDamp!, RED_HUE_DAMP);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** 這台機器最大能吃多大的貼圖（存檔時要先確認全解析度塞得下） */
  maxTexture(): number { return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number; }

  /**
   * 存檔用：另外開一台只為這一次算圖的算圖器，用全解析度畫一次再讀回來。
   * 不動到正在顯示的那一台（不然畫面會閃一下）。
   */
  static renderOnce(
    source: TexImageSource, w: number, h: number,
    lut: GlLut, strength: number, protect: number,
    mask?: { rgba: Uint8Array; w: number; h: number } | null,
  ): HTMLCanvasElement | null {
    const r = LutRenderer.create();
    if (!r) return null;
    try {
      if (w > r.maxTexture() || h > r.maxTexture()) { r.dispose(); return null; }
      r.setImage(source, w, h);
      if (mask) r.setProtectMap(mask.rgba, mask.w, mask.h);
      r.setLut('one', lut);
      if (!r.draw('one', strength, protect)) { r.dispose(); return null; }
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      out.getContext('2d')!.drawImage(r.canvas, 0, 0);
      r.dispose();
      return out;
    } catch {
      try { r.dispose(); } catch { /* noop */ }
      return null;
    }
  }

  dispose(): void {
    const gl = this.gl;
    this.luts.forEach(t => gl.deleteTexture(t));
    this.luts.clear();
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    this.maskTex = null;
    gl.deleteTexture(this.imgTex);
    gl.deleteProgram(this.prog);
  }
}
