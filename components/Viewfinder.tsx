
import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react';

/** 拍照時可以即時看到的特效，跟編輯頁同款、數值都是 0–100 */
export interface ViewfinderFx {
  soft: number;   // 柔光：亮部挑出來模糊之後用濾色疊回去
  blur: number;   // 朦朧：模糊過的自己淡淡蓋一層
}

export const FX_ZERO: ViewfinderFx = { soft: 0, blur: 0 };

interface ViewfinderProps {
  video: HTMLVideoElement | null;
  lutUrl: string;
  exposure: number;
  kelvin: number;
  isUserFacing: boolean;
  fx?: ViewfinderFx;
  /** 硬體變焦不夠時補上的數位變焦，1 = 不放大 */
  digitalZoom?: number;
  onClick?: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
}

const VS_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0, 1);
    v_texCoord = a_texCoord;
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_video;
uniform sampler2D u_lut;
uniform bool u_useLut;
uniform float u_exposure;
uniform float u_kelvin;
uniform bool u_isUserFacing;
uniform float u_zoom;
in vec2 v_texCoord;
out vec4 outColor;

vec3 applyKelvin(vec3 rgb, float kelvin) {
    float temp = (kelvin - 5000.0) / 5000.0;
    return rgb + vec3(temp * 0.0975, 0.0, -temp * 0.0975);
}

void main() {
    vec2 tc = v_texCoord;
    if (u_isUserFacing) tc.x = 1.0 - tc.x;
    // 數位變焦：從中心往內裁一塊再放大（硬體變焦做不到的倍率才會用到）
    tc = (tc - 0.5) / max(u_zoom, 0.0001) + 0.5;

    vec4 source = texture(u_video, tc);
    vec3 rgb = source.rgb;

    // Manual Adjustments
    rgb *= pow(2.0, u_exposure);
    rgb = applyKelvin(rgb, u_kelvin);

    rgb = clamp(rgb, 0.0, 1.0);

    if (u_useLut) {
        float size = 64.0;
        float b = rgb.b * (size - 1.0);

        float z1 = floor(b);
        float z2 = ceil(b);

        vec2 q1;
        q1.y = floor(z1 / 8.0);
        q1.x = z1 - (q1.y * 8.0);

        vec2 q2;
        q2.y = floor(z2 / 8.0);
        q2.x = z2 - (q2.y * 8.0);

        vec2 p1;
        p1.x = (q1.x * size + 0.5 + rgb.r * (size - 1.0)) / 512.0;
        p1.y = (q1.y * size + 0.5 + rgb.g * (size - 1.0)) / 512.0;

        vec2 p2;
        p2.x = (q2.x * size + 0.5 + rgb.r * (size - 1.0)) / 512.0;
        p2.y = (q2.y * size + 0.5 + rgb.g * (size - 1.0)) / 512.0;

        vec3 c1 = texture(u_lut, p1).rgb;
        vec3 c2 = texture(u_lut, p2).rgb;

        rgb = mix(c1, c2, fract(b));
    }

    outColor = vec4(rgb, 1.0);
}
`;

/* 可分離的高斯模糊：橫一趟、直一趟。用線性取樣的九抽樣權重，
   一次只碰五個紋素就等於九抽樣的品質，手機上跑得動 60fps。 */
const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_step;      // 一個紋素的大小 × 方向
uniform float u_radius;   // 幾個紋素
in vec2 v_texCoord;
out vec4 outColor;

const float O1 = 1.3846153846;
const float O2 = 3.2307692308;
const float W0 = 0.2270270270;
const float W1 = 0.3162162162;
const float W2 = 0.0702702703;

void main() {
    vec2 d1 = u_step * O1 * u_radius;
    vec2 d2 = u_step * O2 * u_radius;
    vec3 c = texture(u_tex, v_texCoord).rgb * W0;
    c += texture(u_tex, v_texCoord + d1).rgb * W1;
    c += texture(u_tex, v_texCoord - d1).rgb * W1;
    c += texture(u_tex, v_texCoord + d2).rgb * W2;
    c += texture(u_tex, v_texCoord - d2).rgb * W2;
    outColor = vec4(c, 1.0);
}
`;

/* 合成：把清晰的那張跟模糊的那張疊起來。
   三種效果共用同一條模糊鏈，所以三個一起開也只多一次合成。 */
const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_blur;
uniform float u_soft;    // 0–1
uniform float u_blurAmt; // 0–1
in vec2 v_texCoord;
out vec4 outColor;

void main() {
    /* 離屏畫布的原點在左下、螢幕在左上，所以讀回來要把 Y 翻回去，
       不然套上特效整張會上下顛倒。 */
    vec2 tc = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
    vec3 base = texture(u_scene, tc).rgb;
    vec3 bl   = texture(u_blur,  tc).rgb;

    /* 朦朧：跟編輯頁同一組係數 —— 模糊過的自己用 0.625 的不透明度蓋上去 */
    vec3 c = mix(base, bl, u_blurAmt * 0.625);

    /* 柔光：亮部挑出來（門檻 0.70、超出的部分 ×5 當強度）用濾色疊回去，
       疊加量是強度 ×1.5，跟編輯頁的柔光同一組係數。 */
    if (u_soft > 0.0) {
        float lum = dot(bl, vec3(0.299, 0.587, 0.114));
        float mask = clamp((lum - 0.70) * 5.0, 0.0, 1.0);
        vec3 glow = bl * mask * clamp(u_soft * 1.5, 0.0, 1.0);
        c = 1.0 - (1.0 - c) * (1.0 - clamp(glow, 0.0, 1.0));
    }

    outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/** 模糊在 1/4 邊長上算：肉眼看不出差別，但快 16 倍 */
const BLUR_DIV = 4;

export const Viewfinder = forwardRef(({ video, lutUrl, exposure, kelvin, isUserFacing, fx, digitalZoom, onClick }: ViewfinderProps, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const blurProgRef = useRef<WebGLProgram | null>(null);
  const compProgRef = useRef<WebGLProgram | null>(null);
  const videoTexRef = useRef<WebGLTexture | null>(null);
  const lutTexRef = useRef<WebGLTexture | null>(null);
  const [lutLoaded, setLutLoaded] = useState(false);

  /** 場景（調整＋濾鏡之後）與兩張乒乓用的模糊暫存 */
  const rtRef = useRef<{
    w: number; h: number; bw: number; bh: number;
    scene: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    ping: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
    pong: { fb: WebGLFramebuffer; tex: WebGLTexture } | null;
  }>({ w: 0, h: 0, bw: 0, bh: 0, scene: null, ping: null, pong: null });

  /* 滑桿是每一幀都可能在動的，放進 effect 依賴會不停重建 render loop。
     用 ref 讓迴圈每一幀讀最新值，迴圈本身只建立一次。 */
  const fxRef = useRef<ViewfinderFx>(fx || FX_ZERO);
  fxRef.current = fx || FX_ZERO;
  const zoomRef = useRef(1);
  zoomRef.current = digitalZoom && digitalZoom > 0 ? digitalZoom : 1;
  /* 讓「拍全解析度靜態照」也能走同一條管線 —— 一模一樣的著色器、
     一模一樣的參數，所以拍出來跟畫面上看到的完全一致。 */
  const drawRef = useRef<((src: TexImageSource, w: number, h: number, out: HTMLCanvasElement | null) => void) | null>(null);
  /* 曝光／色溫／濾鏡也一律走 ref。以前它們在 render loop 的依賴裡，
     滑桿每動一格（色溫是 50K 一格）就把整個迴圈拆掉重建一次，
     拉起來就是一頓一頓的。現在迴圈只建立一次，每一幀讀最新值。 */
  const paramRef = useRef({ exposure, kelvin, isUserFacing });
  paramRef.current = { exposure, kelvin, isUserFacing };

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    /** 把一張全解析度的靜態影像走完同一條管線，回傳畫好的畫布 */
    renderStill: (src: TexImageSource, w: number, h: number): HTMLCanvasElement | null => {
      if (!drawRef.current || !w || !h) return null;
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      drawRef.current(src, w, h, out);
      return out;
    },
  }));

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
    if (!gl) return;
    glRef.current = gl;

    const createShader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const link = (fs: string) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, createShader(gl.VERTEX_SHADER, VS_SOURCE));
      gl.attachShader(p, createShader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      return p;
    };

    const prog = link(FS_SOURCE);
    progRef.current = prog;
    blurProgRef.current = link(FS_BLUR);
    compProgRef.current = link(FS_COMPOSITE);

    const pos = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const uvs = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    /* 三個程式的屬性位置各自獨立，所以每個都要各自綁一次。
       綁在同一個 VAO 上，換程式的時候不用重綁。 */
    const bind = (p: WebGLProgram) => {
      gl.useProgram(p);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const aPos = gl.getAttribLocation(p, 'a_position');
      if (aPos >= 0) { gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0); }
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      const aUv = gl.getAttribLocation(p, 'a_texCoord');
      if (aUv >= 0) { gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0); }
    };
    // 三個程式的屬性位置都是 0/1，所以綁一次就好；保險起見全部走一遍
    bind(prog); bind(blurProgRef.current); bind(compProgRef.current);

    videoTexRef.current = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexRef.current);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return () => {
      const rt = rtRef.current;
      for (const t of [rt.scene, rt.ping, rt.pong]) {
        if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
      }
      rtRef.current = { w: 0, h: 0, bw: 0, bh: 0, scene: null, ping: null, pong: null };
      gl.deleteProgram(prog);
      if (blurProgRef.current) gl.deleteProgram(blurProgRef.current);
      if (compProgRef.current) gl.deleteProgram(compProgRef.current);
      gl.deleteTexture(videoTexRef.current);
    };
  }, []);

  // Render Loop
  useEffect(() => {
    if (!glRef.current || !progRef.current) return;

    let rafId: number;
    const gl = glRef.current;
    const prog = progRef.current;

    const makeTarget = (w: number, h: number) => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fb, tex };
    };

    /** 只有真的要用特效時才配置這些暫存，沒開特效完全走原本那條路 */
    const ensureTargets = (w: number, h: number) => {
      const rt = rtRef.current;
      const bw = Math.max(1, Math.floor(w / BLUR_DIV));
      const bh = Math.max(1, Math.floor(h / BLUR_DIV));
      if (rt.scene && rt.w === w && rt.h === h) return rt;
      for (const t of [rt.scene, rt.ping, rt.pong]) {
        if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
      }
      const next = { w, h, bw, bh, scene: makeTarget(w, h), ping: makeTarget(bw, bh), pong: makeTarget(bw, bh) };
      rtRef.current = next;
      return next;
    };

    /* 一幀的完整畫法。預覽跟「拍全解析度靜態照」共用這一段，
       所以拍下來的顏色、特效跟畫面上看到的一定一致。 */
    const draw = (source: TexImageSource, W: number, H: number) => {
      const f = fxRef.current;
      const soft = (f.soft || 0) / 100, blurAmt = (f.blur || 0) / 100;
      const anyFx = soft > 0 || blurAmt > 0;
      const rt = anyFx ? ensureTargets(W, H) : null;

      // ---- 第一趟：影像 → 曝光／色溫／濾鏡 ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, anyFx ? rt!.scene!.fb : null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(prog);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexRef.current);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as any);
      gl.uniform1i(gl.getUniformLocation(prog, 'u_video'), 0);

      const useLut = !!lutTexRef.current;
      gl.uniform1i(gl.getUniformLocation(prog, 'u_useLut'), useLut ? 1 : 0);
      const pr = paramRef.current;
      gl.uniform1f(gl.getUniformLocation(prog, 'u_exposure'), pr.exposure);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_kelvin'), pr.kelvin);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_zoom'), zoomRef.current);
      gl.uniform1i(gl.getUniformLocation(prog, 'u_isUserFacing'), pr.isUserFacing ? 1 : 0);

      if (useLut) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTexRef.current);
        gl.uniform1i(gl.getUniformLocation(prog, 'u_lut'), 1);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!anyFx) return;

      const bp = blurProgRef.current!, cp = compProgRef.current!;
      const { bw, bh, scene, ping, pong } = rt!;

      /* 三種效果吃的模糊程度不一樣，取最大的那個；
         半徑跟著強度長，弱的時候只是輕輕柔化。 */
      const strength = Math.max(blurAmt * 1.0, soft * 0.55);
      const radius = 0.6 + strength * 3.2;
      const passes = strength > 0.55 ? 2 : 1;

      gl.useProgram(bp);
      gl.uniform1f(gl.getUniformLocation(bp, 'u_radius'), radius);
      gl.viewport(0, 0, bw, bh);

      let srcTex: WebGLTexture = scene!.tex;
      for (let i = 0; i < passes; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, ping!.fb);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform1i(gl.getUniformLocation(bp, 'u_tex'), 0);
        gl.uniform2f(gl.getUniformLocation(bp, 'u_step'), 1 / bw, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.bindFramebuffer(gl.FRAMEBUFFER, pong!.fb);
        gl.bindTexture(gl.TEXTURE_2D, ping!.tex);
        gl.uniform2f(gl.getUniformLocation(bp, 'u_step'), 0, 1 / bh);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        srcTex = pong!.tex;
      }

      // ---- 最後一趟：清晰 + 模糊 合成到畫面 ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(cp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene!.tex);
      gl.uniform1i(gl.getUniformLocation(cp, 'u_scene'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(gl.getUniformLocation(cp, 'u_blur'), 1);
      gl.uniform1f(gl.getUniformLocation(cp, 'u_soft'), soft);
      gl.uniform1f(gl.getUniformLocation(cp, 'u_blurAmt'), blurAmt);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    /* 全解析度靜態照：暫時把畫布撐到照片的尺寸畫一次，複製走再還原。
       下一幀 tick 會把畫布尺寸設回影像的大小。 */
    drawRef.current = (src, w, h, out) => {
      const cv = canvasRef.current;
      if (!cv || !out) return;
      const ow = cv.width, oh = cv.height;
      cv.width = w; cv.height = h;
      draw(src, w, h);
      out.getContext('2d')!.drawImage(cv, 0, 0);
      cv.width = ow; cv.height = oh;
    };

    const tick = () => {
      if (video && video.readyState >= 2) {
        if (canvasRef.current && (canvasRef.current.width !== video.videoWidth)) {
          canvasRef.current.width = video.videoWidth;
          canvasRef.current.height = video.videoHeight;
        }
        draw(video, gl.canvas.width, gl.canvas.height);
      }
      rafId = requestAnimationFrame(tick);
    };

    tick();
    return () => { cancelAnimationFrame(rafId); drawRef.current = null; };
  }, [video]);

  // Handle LUT Loading
  /* 換濾鏡時會閃一下白（其實是閃「沒有濾鏡的原樣」），原因是一按下去就把
     現在這顆清掉，等新的圖檔載完中間那幾幀等於沒有濾鏡。
     改成：新的載好了才換過去，中間畫面維持前一顆。
     而且每顆只解碼一次，之後來回切換都是瞬間的。 */
  const lutCacheRef = useRef<Map<string, WebGLTexture>>(new Map());
  useEffect(() => {
    if (!glRef.current) return;
    if (!lutUrl) {                       // 「原始」要立刻生效，不能延遲
      lutTexRef.current = null;
      setLutLoaded(false);
      return;
    }

    const cached = lutCacheRef.current.get(lutUrl);
    if (cached) { lutTexRef.current = cached; setLutLoaded(true); return; }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const gl = glRef.current;
      if (!gl || cancelled) return;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      if (tex) lutCacheRef.current.set(lutUrl, tex);
      lutTexRef.current = tex;
      setLutLoaded(true);
    };
    img.src = lutUrl;
    return () => { cancelled = true; };
  }, [lutUrl]);

  return (
    <div className="w-full h-full relative" onClick={onClick}>
        <canvas ref={canvasRef} className="w-full h-full object-cover block" />
    </div>
  );
});
