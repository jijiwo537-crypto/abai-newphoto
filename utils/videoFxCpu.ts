/**
 * 「柔光／光暈／漏光／噪點／朦朧／暗角」這幾個特效的 GPU 版本。
 *
 * 為什麼要另外一份
 * ─────────────────────────────────────────────────────────────
 * 特效那一整排裡，後面十七個（動態模糊、VHS、馬賽克…）本來就是 GLSL 寫的
 * （見 utils/glEffects），影片那條路直接沿用同一份著色器就好。
 * 但最前面這幾個不是 —— 它們是用 2D 畫布的混色模式（screen／overlay／multiply）
 * ＋ 堆疊模糊在 CPU 上做的（見 utils/photoFx 的 applyPhotoFx）。
 * 影片不能走那條路：光是把一格 1080p 貼進 2D 畫布就要 20.9 毫秒。
 *
 * 所以這裡把那幾支改寫成著色器，跑在影片同一個 GL 上下文裡。
 *
 * 數值怎麼對齊
 * ─────────────────────────────────────────────────────────────
 * 每一支的門檻、係數、混色公式都照 applyPhotoFx 逐行抄過來（註解裡標了對應的
 * 那一段），所以顏色與濃淡是同一條算式。唯一「像而不是同一個」的地方是模糊：
 * CPU 那邊用的是堆疊模糊，這裡用可分離高斯（σ＝半徑/2，兩者的標準對應關係）。
 * 差別只出現在很柔的光暈邊緣，實測預覽與成品的直方圖距離跟「完全沒有特效」
 * 的基準線同一個量級。
 *
 * 座標
 * ─────────────────────────────────────────────────────────────
 * 這幾支的頂點著色器不翻轉 y（跟 glEffects 那批一致），而畫布的座標是 y 往下，
 * 所以凡是用到「畫布座標」的地方一律用 P＝vec2(vUv.x, 1−vUv.y)×uRes。
 */

/** 共用的前置：跟 glEffects 那批一樣的介面（uTex＝上一趟、uSrc＝這一層的輸入） */
const HEAD = `precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uSrc;
uniform vec2 uRes;
/** 長邊 / 1080 —— applyPhotoFx 裡的 scale，所有半徑都以它為單位 */
uniform float uS;
/** 畫布座標（y 往下），跟 2D 畫布那邊一致 */
vec2 canvasPos() { return vec2(vUv.x, 1.0 - vUv.y) * uRes; }
float luma255(vec3 c) { return c.r * 255.0 * 0.299 + c.g * 255.0 * 0.587 + c.b * 255.0 * 0.114; }
vec3 screenB(vec3 b, vec3 s) { return 1.0 - (1.0 - b) * (1.0 - s); }
vec3 overlayB(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
}
/* hsl → rgb，跟 utils 那支 hslToRgb 同一條公式 */
float h2r(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0 / 2.0) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(float h, float s, float l) {
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(h2r(p, q, h + 1.0 / 3.0), h2r(p, q, h), h2r(p, q, h - 1.0 / 3.0));
}
`;

/** 可分離高斯的一趟。uDir 決定方向，uRad 是半徑（像素）。 */
const BLUR_PASS = `${HEAD}
uniform vec2 uDir;
uniform float uRad;
void main() {
  float sigma = max(0.0001, uRad * 0.5);
  vec2 step1 = uDir * (sigma * 0.5) / uRes;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  /* 九抽樣的高斯：間距取 σ/2，涵蓋 ±2σ（權重 98% 以上都在裡面） */
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    float w = exp(-0.5 * (fi * 0.5) * (fi * 0.5));
    sum += texture2D(uTex, vUv + step1 * fi) * w;
    wsum += w;
  }
  gl_FragColor = sum / wsum;
}`;

/** 只是把上一趟原封不動抄過來（要拿 uSrc 當輸入時用） */
const COPY_SRC = `${HEAD}
void main() { gl_FragColor = vec4(texture2D(uSrc, vUv).rgb, 1.0); }`;

export interface CpuFxPass {
  fs: string;
  /** 這一趟要送的額外 uniform（除了 uRes / uS / uDir / uRad） */
  uniforms?: string[];
  /** 這一趟是模糊：dir 是方向 */
  blur?: [number, number];
  /** 讀 uSrc 而不是上一趟（第一趟通常要這個） */
  fromSrc?: boolean;
}

export interface CpuFxDef {
  id: string;
  /** 這一層開著嗎（值＞0） */
  key: string;
  /** 半徑（輸出像素）；沒有模糊就回 0 */
  radius: (fx: any, W: number, H: number, S: number) => number;
  uniforms: string[];
  passes: CpuFxPass[];
}

const on = (fx: any, k: string) => (Number(fx?.[k]) || 0) > 0;

/* ── 噪點（applyPhotoFx：globalAlpha=(colorNoise/100)*0.63、overlay）──────
   圖樣本身另外用 uNoise 這張材質給進來，重複鋪、一個圖樣像素＝S 個畫面像素，
   跟 CPU 那邊 ctx.scale(scale, scale) 之後鋪 pattern 完全一樣。 */
const NOISE_FS = `${HEAD}
uniform sampler2D uNoise;
uniform float uNoiseSize;
uniform float colorNoise;
void main() {
  vec3 base = texture2D(uSrc, vUv).rgb;
  vec2 P = canvasPos();
  vec3 n = texture2D(uNoise, P / (uNoiseSize * uS)).rgb;
  float a = clamp((colorNoise / 100.0) * 0.63, 0.0, 1.0);
  gl_FragColor = vec4(mix(base, overlayB(base, n), a), 1.0);
}`;

/* ── 朦朧（applyPhotoFx：模糊過的自己用 globalAlpha=(blur/240)*1.5 疊回去）── */
const BLUR_MIX_FS = `${HEAD}
uniform float blur;
void main() {
  vec3 base = texture2D(uSrc, vUv).rgb;
  vec3 bl = texture2D(uTex, vUv).rgb;
  float a = clamp((blur / 240.0) * 1.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(base, bl, a), 1.0);
}`;

/* ── 柔光：先挑出亮部（門檻以上，alpha=(lum-門檻)*5）──────────────────── */
const SOFT_MASK_FS = `${HEAD}
uniform float softThreshold;
uniform float softColor;
void main() {
  vec3 c = texture2D(uSrc, vUv).rgb;
  float lum = luma255(c);
  float th = (softThreshold / 100.0) * 255.0;
  vec3 col = softColor > 0.0 ? hsl2rgb(softColor / 100.0, 1.0, 0.5) : c;
  float a = clamp((lum - th) * 5.0 / 255.0, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);   // 預乘：模糊時顏色不會被透明處拉黑
}`;
const SOFT_MIX_FS = `${HEAD}
uniform float soft;
uniform float softColor;
void main() {
  vec3 base = texture2D(uSrc, vUv).rgb;
  vec4 g = texture2D(uTex, vUv);
  vec3 gc = g.a > 0.001 ? g.rgb / g.a : vec3(0.0);
  float ga = clamp((soft / 100.0) * (softColor > 0.0 ? 3.0 : 1.5), 0.0, 1.0);
  gl_FragColor = vec4(mix(base, screenB(base, gc), clamp(g.a * ga, 0.0, 1.0)), 1.0);
}`;

/* ── 光暈：亮部（門檻 160）暈開之後只染在暗部旁邊 ────────────────────── */
const FRINGE_MASK_FS = `${HEAD}
void main() {
  vec3 c = texture2D(uSrc, vUv).rgb;
  float lum = luma255(c);
  float a = 0.0;
  if (lum > 160.0) a = pow((lum - 160.0) / 95.0, 1.5);
  gl_FragColor = vec4(vec3(a), a);   // 白色、預乘
}`;
const FRINGE_MIX_FS = `${HEAD}
uniform float fringeIntensity;
uniform float fringeFeather;
uniform float fringeHue;
void main() {
  vec3 base = texture2D(uSrc, vUv).rgb;
  float alpha = texture2D(uTex, vUv).a;
  vec3 outc = base;
  if (alpha > 0.005) {
    float lum = luma255(base);
    float falloff = 1.0 + ((100.0 - fringeFeather) / 100.0) * 4.0;
    float darkMask = pow(max(0.0, 255.0 - lum) / 255.0, falloff);
    float strength = min(1.0, alpha * darkMask * ((fringeIntensity / 50.0) * 3.0));
    if (strength > 0.001) {
      vec3 fc = hsl2rgb(fringeHue / 360.0, 0.8, 0.35) * strength;
      outc = screenB(base, fc);
    }
  }
  gl_FragColor = vec4(outc, 1.0);
}`;

/* ── 漏光：斜向線性漸層用 screen 疊上去（沒有模糊，跟 CPU 版逐點相同）── */
const LEAK_FS = `${HEAD}
uniform float leakOpacity;
uniform float leakAngle;
uniform float leakHue;
void main() {
  vec3 base = texture2D(uSrc, vUv).rgb;
  vec2 P = canvasPos();
  vec2 c = uRes * 0.5;
  float rad = (leakAngle - 180.0) * 0.0174532925;
  vec2 d = vec2(cos(rad), sin(rad));
  float r = max(uRes.x, uRes.y) * 1.5;
  /* p0 = c + d*r、p1 = c − d*r，t 是投影在 p0→p1 上的比例 */
  float t = clamp((r - dot(P - c, d)) / (2.0 * r), 0.0, 1.0);
  /* 色標只到 0.5 就歸零，之後保持 0 */
  float a = (leakOpacity / 100.0) * clamp(1.0 - t * 2.0, 0.0, 1.0);
  vec3 lc = hsl2rgb(leakHue / 360.0, 1.0, 0.5);
  gl_FragColor = vec4(mix(base, screenB(base, lc), a), 1.0);
}`;

/* ── 暗角：放射狀漸層用 multiply 壓上去（黑色，所以就是把亮度乘下去）── */
const VIGNETTE_FS = `${HEAD}
uniform float vignette;
void main() {
  vec3 base = texture2D(uSrc, vUv).rgb;
  vec2 P = canvasPos();
  vec2 c = uRes * 0.5;
  float r0 = uRes.x / 3.0;
  float r1 = max(uRes.x, uRes.y);
  float a = clamp((length(P - c) - r0) / max(1.0, r1 - r0), 0.0, 1.0);
  float s = vignette / 100.0;
  float ga = min(1.0, s * 0.8);
  vec3 outc = base * (1.0 - a * ga);
  /* 很強的時候 CPU 那邊會再疊一次（strength > 1.25） */
  if (s > 1.25) {
    float ga2 = min(1.0, (s - 1.25) * 0.8);
    outc = outc * (1.0 - a * ga2);
  }
  gl_FragColor = vec4(outc, 1.0);
}`;

/**
 * 順序跟 applyPhotoFx 裡一模一樣：噪點 → 朦朧 → 柔光 → 漏光 → 光暈 → 暗角，
 * 然後才輪到 glEffects 那批（呼叫端負責）。
 */
export const CPU_FX: CpuFxDef[] = [
  {
    id: 'colorNoise', key: 'colorNoise',
    radius: () => 0,
    uniforms: ['colorNoise'],
    passes: [{ fs: NOISE_FS, fromSrc: true }],
  },
  {
    id: 'blur', key: 'blur',
    /* applyPhotoFx：fastBlur 半徑 (blur/6)*scale*procScale*1.5，
       算在 procScale 的小圖上再放大回來 → 對輸出而言就是 (blur/6)*scale*1.5 */
    radius: (fx, _W, _H, S) => ((Number(fx.blur) || 0) / 6) * S * 1.5,
    uniforms: ['blur'],
    passes: [
      { fs: COPY_SRC, fromSrc: true },
      { fs: BLUR_PASS, blur: [1, 0] },
      { fs: BLUR_PASS, blur: [0, 1] },
      { fs: BLUR_MIX_FS },
    ],
  },
  {
    id: 'soft', key: 'soft',
    radius: (fx, _W, _H, S) => ((Number(fx.softRadius ?? 100)) / 100) * 80 * S,
    uniforms: ['soft', 'softThreshold', 'softRadius', 'softColor'],
    passes: [
      { fs: SOFT_MASK_FS, fromSrc: true },
      { fs: BLUR_PASS, blur: [1, 0] },
      { fs: BLUR_PASS, blur: [0, 1] },
      { fs: SOFT_MIX_FS },
    ],
  },
  {
    id: 'lightLeak', key: 'leakOpacity',
    radius: () => 0,
    uniforms: ['leakOpacity', 'leakAngle', 'leakHue'],
    passes: [{ fs: LEAK_FS, fromSrc: true }],
  },
  {
    id: 'halation', key: 'fringeIntensity',
    /* applyPhotoFx：maxBlur = hw*0.08*0.8553125，hw 是 procScale 之後的寬，
       乘上 (fringeSize/100)；換算回輸出就是 W*0.08*0.8553125*(size/100) */
    radius: (fx, W) => Math.max(1, W * 0.08 * 0.8553125 * ((Number(fx.fringeSize ?? 10)) / 100)),
    uniforms: ['fringeIntensity', 'fringeSize', 'fringeFeather', 'fringeHue'],
    passes: [
      { fs: FRINGE_MASK_FS, fromSrc: true },
      { fs: BLUR_PASS, blur: [1, 0] },
      { fs: BLUR_PASS, blur: [0, 1] },
      { fs: FRINGE_MIX_FS },
    ],
  },
  {
    id: 'vignette', key: 'vignette',
    radius: () => 0,
    uniforms: ['vignette'],
    passes: [{ fs: VIGNETTE_FS, fromSrc: true }],
  },
];

/** 這包 fx 有哪幾個 CPU 系特效開著（順序照 CPU_FX） */
export const activeCpuFx = (fx: any): CpuFxDef[] =>
  (fx ? CPU_FX.filter(d => on(fx, d.key)) : []);

/** 這幾支的預設值，著色器沒拿到就用它（跟 photoFx 的預設一致） */
export const CPU_FX_DEFAULTS: Record<string, number> = {
  colorNoise: 0, blur: 0, soft: 0, softThreshold: 70, softRadius: 100, softColor: 0,
  leakOpacity: 0, leakAngle: 45, leakHue: 15,
  fringeIntensity: 0, fringeSize: 10, fringeFeather: 100, fringeHue: 8,
  vignette: 0,
};
