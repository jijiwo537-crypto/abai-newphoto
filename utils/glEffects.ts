/**
 * 特效的 GLSL 後製階段。
 *
 * 編輯器原本那條管線（processPixels + applyComplexEffects）是 canvas2D／CPU 的，
 * 這一層接在它「最後面」跑：把 2D 畫布當貼圖丟進 WebGL，一層一層算完再畫回去。
 * 因此原有的效果一行都不用動，新的特效也同時吃得到預覽與導出（同一支函式）。
 *
 * 每個特效可以有好幾趟 pass：
 *   uTex = 上一趟的輸出（第一趟＝本層輸入）
 *   uSrc = 本層的原始輸入（合成時用）
 * 全部算完之後再用該特效的「強度」與本層輸入做一次插值。
 *
 * 時間軸：這是照片編輯器，輸出必須可重現，所以不餵真的時鐘 ——
 * 會動的那幾個（VHS、故障類）改用各自的「變化」參數當種子，
 * 同樣的參數永遠得到同一張圖。
 */

/**
 * 解析度基準。
 *
 * 預覽在「拖曳中」是畫在 ≤900px 的低解析度代理上、放開手是完整預覽尺寸、
 * 導出又是原圖尺寸。如果位移量直接用「一個像素」（1/w）當單位，同一個
 * 「長度 30」在這三種尺寸下會覆蓋到不同比例的畫面 —— 那就是拖曳中與放開手
 * 效果不一樣的原因，導出也會跟預覽對不起來。
 *
 * 所以 uTexel 不送真的texel，而是送「基準像素」：以 REF 為寬度基準的等比距離。
 * 這樣不管實際畫在多大的畫布上，同一組參數都得到同一個結果。
 * uRefRes 同理，給那些拿解析度當像素格線用的效果（VHS 雜訊／掃描線、CRT 光罩）。
 */
const REF = 1000;

/* ---------- 共用工具（著色器端） ---------- */
const GLSL_HEADER = `precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uSrc;
uniform vec2  uRes;
uniform vec2  uTexel;   // 基準像素（與實際解析度無關）
uniform vec2  uRefRes;  // 基準解析度，只給需要像素格線的效果用
uniform vec2  uDir;
uniform float uTime;

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

vec3 rgb2yiq(vec3 c){
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)),
              dot(c, vec3(0.596, -0.274, -0.322)),
              dot(c, vec3(0.211, -0.523, 0.312)));
}
vec3 yiq2rgb(vec3 c){
  return vec3(c.x + 0.956 * c.y + 0.621 * c.z,
              c.x - 0.272 * c.y - 0.647 * c.z,
              c.x - 1.106 * c.y + 1.703 * c.z);
}
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 5; i++){ v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}
vec3 blendScreen(vec3 b, vec3 s){ return 1.0 - (1.0 - b) * (1.0 - s); }
`;

const VS = `attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** 最後把算出來的結果與本層輸入按強度插值 */
const BLEND_FS = `precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uSrc;
uniform float uAmount;
void main(){
  vec3 a = texture2D(uSrc, vUv).rgb;
  vec3 b = texture2D(uTex, vUv).rgb;
  gl_FragColor = vec4(mix(a, b, uAmount), 1.0);
}`;

export interface FxParamDef {
  /** 同時是 EditorParams 的鍵值 */
  id: string;
  label: string;
  icon: string;
  min: number;
  max: number;
  step?: number;
  def: number;
  /** 送進著色器時的換算：滑桿值 → uniform 值 */
  scale?: number;
  /**
   * 不給使用者調整：介面上不出現這根滑桿，值永遠就是 def。
   * 著色器那邊完全不用改（uniform 照樣送），只是它不再會變動。
   */
  hidden?: boolean;
}

interface FxPass {
  body: string;
  /** 可分離卷積的方向 */
  dir?: [number, number];
}

export interface FxDef {
  /** 特效本身的「強度」鍵值，也是工具列按鈕的 id */
  id: string;
  label: string;
  icon: string;
  /** 打開這個特效時要用的強度（清單裡點下去就套這個值）。沒寫就是 100 */
  onAmount?: number;
  /** 除了強度以外的參數 */
  params: FxParamDef[];
  /**
   * 最外層那根滑桿改調這個參數，而不是「強度」。
   *
   * 用在「強度沒有意義」的特效上 —— 例如馬賽克：把馬賽克調到 50% 強度
   * 只是把原圖疊回來一半，看起來像沒對焦，真正有意義的只有格數。
   * 設了這個之後，卡片點下去強度一律是 100，使用者只會看到那一根滑桿；
   * 要關掉就點特效列最前面的「無」。
   */
  rootParam?: string;
  passes: FxPass[];
}

const amount = (id: string, def = 0): FxParamDef =>
  ({ id, label: '強度', icon: 'percent', min: 0, max: 100, def });

/* ================================================================
   特效清單。順序：模糊動態 → 光學 → 復古質感 → 故障 → 圖形化
   ================================================================ */
export const FX_DEFS: FxDef[] = [
  {
    id: 'fxMotion', label: '動態模糊', icon: 'speed',
    onAmount: 40,
    params: [
      { id: 'fxMotionAngle', label: '角度', icon: 'explore', min: 0, max: 360, def: 0 , hidden: true },
      { id: 'fxMotionLength', label: '長度', icon: 'straighten', min: 0, max: 80, def: 20 },
    ],
    passes: [{
      body: `
  const int K = 20;
  vec2 d = vec2(cos(radians(fxMotionAngle)), sin(radians(fxMotionAngle))) * uTexel * fxMotionLength;
  vec3 s = vec3(0.0);
  for(int i = -K; i <= K; i++){ s += texture2D(uTex, uv + d * (float(i)/float(K))).rgb; }
  return vec4(s / float(2*K+1), 1.0);`,
    }],
  },
  {
    id: 'fxZoom', label: '放射模糊', icon: 'zoom_out_map',
    onAmount: 100,
    params: [
      { id: 'fxZoomStrength', label: '強弱', icon: 'speed', min: 0, max: 100, def: 10, scale: 0.0035 , hidden: true },
      { id: 'fxZoomCx', label: '中心 X', icon: 'swap_horiz', min: 0, max: 100, def: 50, scale: 0.01 , hidden: true },
      { id: 'fxZoomCy', label: '中心 Y', icon: 'swap_vert', min: 0, max: 100, def: 50, scale: 0.01 , hidden: true },
    ],
    passes: [{
      body: `
  const int K = 28;
  vec2 c = vec2(fxZoomCx, fxZoomCy);
  vec2 d = (c - uv) * fxZoomStrength;
  vec3 s = vec3(0.0); float w = 0.0;
  for(int i = 0; i < K; i++){
    float t = float(i) / float(K-1);
    float wi = 1.0 - t * 0.5;
    s += texture2D(uTex, uv + d * t).rgb * wi;
    w += wi;
  }
  return vec4(s / w, 1.0);`,
    }],
  },
  {
    id: 'fxSpin', label: '旋轉模糊', icon: 'autorenew',
    onAmount: 40,
    params: [
      { id: 'fxSpinAngle', label: '角度', icon: 'explore', min: 0, max: 60, def: 10 },
      { id: 'fxSpinCx', label: '中心 X', icon: 'swap_horiz', min: 0, max: 100, def: 50, scale: 0.01 , hidden: true },
      { id: 'fxSpinCy', label: '中心 Y', icon: 'swap_vert', min: 0, max: 100, def: 50, scale: 0.01 , hidden: true },
    ],
    passes: [{
      body: `
  const int K = 24;
  vec2 c  = vec2(fxSpinCx, fxSpinCy);
  vec2 ar = vec2(uRes.x / uRes.y, 1.0);
  vec2 p  = (uv - c) * ar;
  vec3 s = vec3(0.0);
  for(int i = 0; i < K; i++){
    float a = radians(fxSpinAngle) * (float(i)/float(K-1) - 0.5);
    s += texture2D(uTex, c + (rot(a) * p) / ar).rgb;
  }
  return vec4(s / float(K), 1.0);`,
    }],
  },
  {
    id: 'fxAnamorphic', label: '變形光斑', icon: 'highlight',
    onAmount: 80,
    params: [
      { id: 'fxAnaThresh', label: '範圍', icon: 'exposure', min: 0, max: 100, def: 60, scale: 0.01 },
      { id: 'fxAnaLength', label: '長度', icon: 'straighten', min: 0, max: 400, def: 150 },
      { id: 'fxAnaHue', label: '色相', icon: 'format_color_fill', min: 0, max: 360, def: 215 },
    ],
    passes: [
      { body: `
  vec3 c = texture2D(uTex, uv).rgb;
  return vec4(c * smoothstep(fxAnaThresh, fxAnaThresh + 0.18, luma(c)), 1.0);` },
      { body: `
  const int K = 40;
  vec3 s = vec3(0.0); float w = 0.0;
  for(int i = -K; i <= K; i++){
    float fi = float(i) / float(K);
    float g = exp(-abs(fi) * 3.0);
    s += texture2D(uTex, uv + vec2(fi * fxAnaLength * uTexel.x, 0.0)).rgb * g;
    w += g;
  }
  return vec4(s / w, 1.0);` },
      { body: `
  float h = fxAnaHue / 360.0;
  vec3 tint = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  vec3 base = texture2D(uSrc, uv).rgb;
  return vec4(base + texture2D(uTex, uv).rgb * tint, 1.0);` },
    ],
  },
  {
    /* Y2K 霓虹光暈：抓高光 → 兩趟高斯模糊 → 用兩個色相調出來的雙色霓虹 screen 回原圖。
       強度（卡片本身那一根）就是混合量，其餘只留門檻與兩個色相；
       光暈半徑與飽和度沿用原設定（36 基準像素 / 1.25），寫死在著色器裡。 */
    id: 'fxY2k', label: '霓虹', icon: 'looks',
    onAmount: 100,
    params: [
      { id: 'fxY2kThresh', label: '範圍', icon: 'exposure', min: 0, max: 100, def: 55, scale: 0.01 },
      { id: 'fxY2kHueA', label: '色相 A', icon: 'format_color_fill', min: 0, max: 360, def: 190 },
      { id: 'fxY2kHueB', label: '色相 B', icon: 'gradient', min: 0, max: 360, def: 313 },
    ],
    passes: [
      // 1）只留比門檻亮的部分
      { body: `
  vec3 c = texture2D(uTex, uv).rgb;
  return vec4(c * smoothstep(fxY2kThresh, fxY2kThresh + 0.22, luma(c)), 1.0);` },
      // 2）水平模糊
      { dir: [1, 0], body: `
  const int K = 14;
  float sigma = 36.0 * 0.5;
  vec3 acc = vec3(0.0); float tw = 0.0;
  for(int i = -K; i <= K; i++){
    float fi = float(i);
    float w = exp(-(fi * fi) / (2.0 * sigma * sigma));
    acc += texture2D(uTex, uv + uDir * uTexel * fi * (36.0 / float(K))).rgb * w;
    tw += w;
  }
  return vec4(acc / tw, 1.0);` },
      // 3）垂直模糊
      { dir: [0, 1], body: `
  const int K = 14;
  float sigma = 36.0 * 0.5;
  vec3 acc = vec3(0.0); float tw = 0.0;
  for(int i = -K; i <= K; i++){
    float fi = float(i);
    float w = exp(-(fi * fi) / (2.0 * sigma * sigma));
    acc += texture2D(uTex, uv + uDir * uTexel * fi * (36.0 / float(K))).rgb * w;
    tw += w;
  }
  return vec4(acc / tw, 1.0);` },
      // 4）雙色霓虹疊回原圖
      { body: `
  vec3 base = texture2D(uSrc, uv).rgb;
  vec3 glow = texture2D(uTex, uv).rgb;
  float ha = fxY2kHueA / 360.0;
  float hb = fxY2kHueB / 360.0;
  // 色相 → RGB（飽和度 0.52、亮度 1.0，跟原本的 #7be7ff / #ff7be0 同一個調子）
  vec3 ca = mix(vec3(1.0), clamp(abs(mod(ha * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0), 0.52);
  vec3 cb = mix(vec3(1.0), clamp(abs(mod(hb * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0), 0.52);
  // 依畫面位置在兩色之間漸變，做出雙色霓虹
  vec3 tint = mix(ca, cb, smoothstep(0.2, 0.8, uv.x * 0.6 + uv.y * 0.4));
  vec3 c = blendScreen(base, glow * tint);
  c = mix(vec3(luma(c)), c, 1.25);
  return vec4(clamp(c, 0.0, 1.0), 1.0);` },
    ],
  },
  {
    id: 'fxPearl', label: '珍珠光澤', icon: 'auto_awesome',
    onAmount: 100,
    params: [
      { id: 'fxPearlFreq', label: '位移', icon: 'waves', min: 0, max: 20, def: 10 },
      { id: 'fxPearlPhase', label: '相位', icon: 'explore', min: 0, max: 360, def: 0, scale: 0.01745 , hidden: true },
      { id: 'fxPearlGate', label: '範圍', icon: 'exposure', min: 0, max: 100, def: 45, scale: 0.01 },
      { id: 'fxPearlSpatial', label: '空間變化', icon: 'scatter_plot', min: 0, max: 10, def: 2 , hidden: true },
    ],
    passes: [{
      body: `
  vec3 c = texture2D(uTex, uv).rgb;
  float l = luma(c);
  float t = l * fxPearlFreq + (uv.x + uv.y) * fxPearlSpatial + fxPearlPhase;
  vec3 iri = 0.5 + 0.5 * cos(vec3(t, t + 2.094, t + 4.189));
  float gate = smoothstep(fxPearlGate, fxPearlGate + 0.3, l);
  return vec4(clamp(blendScreen(c, iri * gate * 0.5), 0.0, 1.0), 1.0);`,
    }],
  },
  {
    id: 'fxAberration', label: '色差', icon: 'lens_blur',
    onAmount: 100,
    params: [
      { id: 'fxAbStrength', label: '強弱', icon: 'speed', min: 0, max: 40, def: 6 , hidden: true },
      { id: 'fxAbFalloff', label: '徑向指數', icon: 'trending_up', min: 0, max: 4, def: 2, step: 0.1 , hidden: true },
    ],
    passes: [{
      body: `
  const int N = 8;
  vec2 d = uv - 0.5;
  float k = fxAbStrength * 0.012 * pow(length(d), fxAbFalloff);
  vec3 sum = vec3(0.0), wsum = vec3(0.0);
  for(int i = 0; i < N; i++){
    float t = float(i) / float(N - 1);
    vec3 w = vec3(exp(-pow(t * 2.2, 2.0)),
                  exp(-pow((t - 0.5) * 2.2, 2.0)),
                  exp(-pow((t - 1.0) * 2.2, 2.0)));
    sum  += texture2D(uTex, uv - d * k * (t - 0.5) * 2.0).rgb * w;
    wsum += w;
  }
  return vec4(clamp(sum / max(wsum, 1e-4), 0.0, 1.0), 1.0);`,
    }],
  },
  {
    id: 'fxRgbShift', label: '色散', icon: 'filter_b_and_w',
    onAmount: 100,
    params: [
      { id: 'fxRgbAmount', label: '位移', icon: 'straighten', min: 0, max: 40, def: 8 },
      { id: 'fxRgbAngle', label: '方向', icon: 'explore', min: 0, max: 360, def: 0 },
    ],
    passes: [{
      body: `
  vec2 o = vec2(cos(radians(fxRgbAngle)), sin(radians(fxRgbAngle))) * fxRgbAmount * uTexel;
  return vec4(texture2D(uTex, uv + o).r,
              texture2D(uTex, uv).g,
              texture2D(uTex, uv - o).b, 1.0);`,
    }],
  },
  {
    id: 'fxMist', label: '亮角', icon: 'filter_drama',
    onAmount: 100,
    params: [
      { id: 'fxMistRange', label: '範圍', icon: 'adjust', min: 0, max: 100, def: 50, scale: 0.01 },
      { id: 'fxMistFeather', label: '柔和度', icon: 'blur_short', min: 0, max: 100, def: 55, scale: 0.01 , hidden: true },
      { id: 'fxMistWarm', label: '暖度', icon: 'wb_twilight', min: -100, max: 100, def: 0, scale: 0.01 , hidden: true },
    ],
    passes: [{
      // 跟暗角同一套：半徑做的徑向遮罩。差別在暗角是往黑色乘下去，
      // 這裡是往白色 screen 上去 —— 邊緣就變成霧白而不是壓黑。
      body: `
  vec3 c = texture2D(uTex, uv).rgb;
  float r = length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0)) * 1.42;
  float inner = fxMistRange;
  float outer = inner + max(fxMistFeather, 0.02);
  float m = smoothstep(inner, outer, r);
  vec3 mist = vec3(1.0) + vec3(0.06, 0.0, -0.06) * fxMistWarm;
  return vec4(clamp(mix(c, blendScreen(c, mist), m), 0.0, 1.0), 1.0);`,
    }],
  },
  {
    // 跟亮角同一套徑向遮罩，只是往黑色壓下去。原本特效列那顆單滑桿的
    // 暗角換成這個，參數跟亮角對齊（範圍／柔和度），再多一個形狀。
    id: 'fxVignette', label: '暗角', icon: 'vignette',
    onAmount: 100,
    params: [
      { id: 'fxVigRange', label: '範圍', icon: 'adjust', min: 0, max: 100, def: 50, scale: 0.01 },
      { id: 'fxVigFeather', label: '柔和度', icon: 'blur_short', min: 0, max: 100, def: 60, scale: 0.01 , hidden: true },
      { id: 'fxVigShape', label: '形狀', icon: 'category', min: 0, max: 100, def: 0, scale: 0.01 },
    ],
    passes: [{
      body: `
  vec3 c = texture2D(uTex, uv).rgb;
  vec2 d = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  // 形狀 0 = 圓形（歐氏距離）、100 = 方形（切比雪夫距離）
  float r = mix(length(d), max(abs(d.x), abs(d.y)), fxVigShape) * 1.42;
  float m = smoothstep(fxVigRange, fxVigRange + max(fxVigFeather, 0.02), r);
  return vec4(c * (1.0 - m), 1.0);`,
    }],
  },
  {
    id: 'fxBlocks', label: '區塊錯位', icon: 'dashboard',
    onAmount: 100,
    params: [
      { id: 'fxBlocksSize', label: '密度', icon: 'apps', min: 4, max: 80, def: 15 },
      { id: 'fxBlocksDensity', label: '比例', icon: 'broken_image', min: 0, max: 100, def: 22, scale: 0.01 },
      { id: 'fxBlocksAmount', label: '位移', icon: 'straighten', min: 0, max: 50, def: 9, scale: 0.01 },
      { id: 'fxBlocksColor', label: '錯誤', icon: 'format_paint', min: 0, max: 100, def: 40, scale: 0.01 },
      { id: 'fxBlocksSeed', label: '變化', icon: 'casino', min: 0, max: 100, def: 30 },
    ],
    passes: [{
      body: `
  float t = floor(fxBlocksSeed);
  vec2 grid = vec2(fxBlocksSize, fxBlocksSize * uRes.y / uRes.x);
  vec2 cell = floor(uv * grid);
  float broken = step(1.0 - fxBlocksDensity, hash21(cell + t * 1.37));
  vec2 off = (hash22(cell + t * 3.11) - 0.5) * fxBlocksAmount * broken;
  off.y *= 0.35;
  vec3 c = texture2D(uTex, fract(uv + off)).rgb;
  float ce = step(1.0 - fxBlocksColor * fxBlocksDensity, hash21(cell + t * 7.7));
  c = mix(c, c.gbr, ce);
  c = mix(c, 1.0 - c, step(0.985, hash21(cell + t * 5.3)) * fxBlocksColor);
  return vec4(c, 1.0);`,
    }],
  },
  {
    id: 'fxSlice', label: '掃描切片', icon: 'view_stream',
    onAmount: 100,
    params: [
      { id: 'fxSliceCount', label: '數量', icon: 'apps', min: 5, max: 120, def: 40 },
      { id: 'fxSliceAmount', label: '位移', icon: 'straighten', min: 0, max: 40, def: 6, scale: 0.01 },
      { id: 'fxSliceDensity', label: '發生比例', icon: 'pie_chart', min: 0, max: 100, def: 35, scale: 0.01 , hidden: true },
      { id: 'fxSliceRgb', label: '通道分離', icon: 'call_split', min: 0, max: 100, def: 15, scale: 0.01 , hidden: true },
      { id: 'fxSliceSeed', label: '變化', icon: 'casino', min: 0, max: 100, def: 40 },
    ],
    passes: [{
      body: `
  float t = floor(fxSliceSeed);
  float row = floor(uv.y * fxSliceCount);
  float on = step(1.0 - fxSliceDensity, hash21(vec2(row, t)));
  float sh = (hash21(vec2(row * 2.3, t)) - 0.5) * fxSliceAmount * on;
  vec2 p = vec2(fract(uv.x + sh), uv.y);
  float d = sh * fxSliceRgb;
  return vec4(texture2D(uTex, vec2(fract(p.x + d), p.y)).r,
              texture2D(uTex, p).g,
              texture2D(uTex, vec2(fract(p.x - d), p.y)).b, 1.0);`,
    }],
  },
  {
    id: 'fxVhs', label: 'VHS', icon: 'videocam',
    onAmount: 100,
    params: [
      { id: 'fxVhsChroma', label: '色度糊化', icon: 'lens', min: 0, max: 20, def: 0 , hidden: true },
      { id: 'fxVhsShift', label: '色度偏移', icon: 'swap_horiz', min: 0, max: 20, def: 0 , hidden: true },
      { id: 'fxVhsJitter', label: '抖動', icon: 'vibration', min: 0, max: 100, def: 35, scale: 0.01 },
      { id: 'fxVhsNoise', label: '雜訊', icon: 'graphic_eq', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
      { id: 'fxVhsScan', label: '掃描線', icon: 'view_day', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
      { id: 'fxVhsSeed', label: '變化', icon: 'casino', min: 0, max: 100, def: 20 },
    ],
    passes: [{
      body: `
  float t = fxVhsSeed;
  float band  = floor(uv.y * 90.0);
  float trig  = step(0.86, hash21(vec2(band * 1.7, floor(t * 0.6))));
  float jit   = (hash21(vec2(band, floor(t * 2.0))) - 0.5) * trig * fxVhsJitter * 0.08;
  float wob   = sin(uv.y * 11.0 + t * 0.2) * 0.0016;
  vec2 p = uv + vec2(jit + wob, 0.0);
  vec3 y = rgb2yiq(texture2D(uTex, p).rgb);
  vec2 cs = vec2(uTexel.x * fxVhsChroma, 0.0);
  vec3 ca = rgb2yiq(texture2D(uTex, p - cs * 2.0 + vec2(uTexel.x * fxVhsShift, 0.0)).rgb);
  vec3 cb = rgb2yiq(texture2D(uTex, p).rgb);
  vec3 cc = rgb2yiq(texture2D(uTex, p + cs * 2.0 - vec2(uTexel.x * fxVhsShift, 0.0)).rgb);
  vec3 c = yiq2rgb(vec3(y.x, (ca.y + cb.y + cc.y) / 3.0, (ca.z + cb.z + cc.z) / 3.0));
  float n = hash21(uv * uRefRes * 0.7 + t * 9.1);
  float bandNoise = step(0.92, hash21(vec2(band * 0.3, floor(t * 0.3))));
  c += (n - 0.5) * fxVhsNoise * (0.35 + bandNoise * 1.4);
  c *= 1.0 - fxVhsScan * 0.35 * (0.5 + 0.5 * sin(uv.y * uRefRes.y * 3.14159));
  return vec4(clamp(c, 0.0, 1.0), 1.0);`,
    }],
  },
  {
    id: 'fxCrt', label: '螢幕', icon: 'tv',
    onAmount: 100,
    params: [
      { id: 'fxCrtMask', label: '光罩', icon: 'grid_on', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
      { id: 'fxCrtScan', label: '掃描線', icon: 'view_day', min: 0, max: 100, def: 50, scale: 0.01 },
      { id: 'fxCrtScanSize', label: '掃描密度', icon: 'density_medium', min: 0, max: 1200, def: 520 , hidden: true },
      { id: 'fxCrtGlow', label: '磷光暈', icon: 'brightness_7', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
      { id: 'fxCrtVig', label: '玻璃暗角', icon: 'circle', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
    ],
    passes: [{
      body: `
  /* 不做曲面變形：以前這裡會把 uv 往外拱成球面，再用 inside 把拱出畫面的部分切黑。
     曲率就算設 0，uv → cc → p 這一趟浮點來回也會讓最邊緣那一排落在 0/1 之外，
     於是邊上就多出一圈黑，看起來就是「畫面被拱成曲面」。整段拿掉，p 直接就是 uv。 */
  vec2 p = uv;
  vec3 c = texture2D(uTex, p).rgb;
  vec3 g = (texture2D(uTex, clamp(p + vec2(uTexel.x * 2.0, 0.0), 0.0, 1.0)).rgb
          + texture2D(uTex, clamp(p - vec2(uTexel.x * 2.0, 0.0), 0.0, 1.0)).rgb) * 0.5;
  c = mix(c, max(c, g), fxCrtGlow);
  float sub = mod(floor(p.x * uRefRes.x), 3.0);
  vec3 mask = vec3(sub < 0.5 ? 1.0 : 0.45, (sub > 0.5 && sub < 1.5) ? 1.0 : 0.45, sub > 1.5 ? 1.0 : 0.45);
  c *= mix(vec3(1.0), mask * 1.35, fxCrtMask);
  c *= 1.0 - fxCrtScan * 0.5 * (0.5 + 0.5 * sin(p.y * fxCrtScanSize * 3.14159));
  float r = length((p - 0.5) * vec2(uRes.x / uRes.y, 1.0));
  c *= 1.0 - smoothstep(0.3, 0.95, r) * fxCrtVig;
  return vec4(clamp(c, 0.0, 1.0), 1.0);`,
    }],
  },
  {
    id: 'fxMosaic', label: '馬賽克', icon: 'grid_view',
    onAmount: 100,
    /* 馬賽克只留「格數」一根，而且放在最外層 —— 點卡片不再進細項頁。
       hidden 是給細項頁看的：三根都藏起來，細項頁就沒東西可放、不會被打開；
       格數改由 rootParam 直接放到最外層那根滑桿上。 */
    rootParam: 'fxMosaicBlocks',
    params: [
      { id: 'fxMosaicBlocks', label: '格數', icon: 'apps', min: 5, max: 200, def: 70, hidden: true },
      { id: 'fxMosaicShape', label: '形狀', icon: 'category', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
      { id: 'fxMosaicGap', label: '間隙', icon: 'space_bar', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
    ],
    passes: [{
      body: `
  float n = floor(fxMosaicBlocks + 0.5);
  vec2 grid = n * vec2(1.0, uRes.y / uRes.x);
  vec2 cell = floor(uv * grid);
  vec2 f = fract(uv * grid) - 0.5;
  vec3 c = texture2D(uTex, (cell + 0.5) / grid).rgb;
  float m = mix(step(max(abs(f.x), abs(f.y)), 0.5 - fxMosaicGap * 0.5),
                1.0 - smoothstep(0.42 - fxMosaicGap * 0.4, 0.5 - fxMosaicGap * 0.4, length(f)), fxMosaicShape);
  return vec4(c * m, 1.0);`,
    }],
  },
  {
    id: 'fxCrystal', label: '結晶化', icon: 'diamond',
    onAmount: 100,
    params: [
      { id: 'fxCrystalCells', label: '密度', icon: 'apps', min: 5, max: 150, def: 80 },
      { id: 'fxCrystalJitter', label: '不規則', icon: 'shuffle', min: 0, max: 100, def: 90, scale: 0.01 },
      { id: 'fxCrystalEdge', label: '胞壁寬', icon: 'border_style', min: 0, max: 20, def: 0, scale: 0.01 , hidden: true },
      { id: 'fxCrystalDark', label: '胞壁深', icon: 'nights_stay', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
    ],
    passes: [{
      body: `
  vec2 grid = fxCrystalCells * vec2(1.0, uRes.y / uRes.x);
  vec2 g = floor(uv * grid), f = fract(uv * grid);
  float d1 = 8.0, d2 = 8.0; vec2 best = vec2(0.0);
  for(int y = -1; y <= 1; y++){
    for(int x = -1; x <= 1; x++){
      vec2 o = vec2(float(x), float(y));
      vec2 pp = o + mix(vec2(0.5), hash22(g + o), fxCrystalJitter);
      float d = length(pp - f);
      if(d < d1){ d2 = d1; d1 = d; best = g + pp; }
      else if(d < d2){ d2 = d; }
    }
  }
  vec3 c = texture2D(uTex, clamp(best / grid, 0.0, 1.0)).rgb;
  float wall = smoothstep(0.0, max(fxCrystalEdge, 1e-3), d2 - d1);
  return vec4(c * mix(1.0 - fxCrystalDark, 1.0, wall), 1.0);`,
    }],
  },
  {
    id: 'fxGlass', label: '玻璃磚', icon: 'window',
    onAmount: 100,
    params: [
      { id: 'fxGlassBlocks', label: '格數', icon: 'apps', min: 4, max: 60, def: 22 },
      { id: 'fxGlassRefract', label: '折射', icon: 'lens', min: 0, max: 100, def: 100, scale: 0.01 },
      { id: 'fxGlassBevel', label: '邊緣反光', icon: 'brightness_7', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
      { id: 'fxGlassRound', label: '圓弧度', icon: 'rounded_corner', min: 0, max: 100, def: 0, scale: 0.01 , hidden: true },
    ],
    passes: [{
      body: `
  vec2 grid = vec2(fxGlassBlocks, floor(fxGlassBlocks * uRes.y / uRes.x));
  vec2 f = fract(uv * grid) - 0.5;
  vec2 n = f * mix(2.0, smoothstep(0.0, 0.5, length(f)) / max(length(f), 1e-3) * 0.7, fxGlassRound);
  vec2 p = uv - n * fxGlassRefract * 0.06;
  vec3 c = texture2D(uTex, clamp(p, 0.0, 1.0)).rgb;
  c += smoothstep(0.34, 0.5, max(abs(f.x), abs(f.y))) * fxGlassBevel * 0.35;
  return vec4(clamp(c, 0.0, 1.0), 1.0);`,
    }],
  },
  {
    id: 'fxSharpen', label: '銳化', icon: 'deblur',
    params: [
      { id: 'fxSharpenSpread', label: '取樣距離', icon: 'straighten', min: 0, max: 6, def: 1, step: 0.5 , hidden: true },
    ],
    passes: [{
      body: `
  vec2 t = uTexel * fxSharpenSpread;
  vec3 c = texture2D(uTex, uv).rgb;
  vec3 n = texture2D(uTex, uv + vec2( t.x, 0.0)).rgb
         + texture2D(uTex, uv + vec2(-t.x, 0.0)).rgb
         + texture2D(uTex, uv + vec2(0.0,  t.y)).rgb
         + texture2D(uTex, uv + vec2(0.0, -t.y)).rgb;
  return vec4(clamp(c * 5.0 - n, 0.0, 1.0), 1.0);`,
    }],
  },
];

/** 全部（強度 + 各自的參數）的預設值，給 DEFAULT_PARAMS 用 */
export const FX_DEFAULTS: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const d of FX_DEFS) {
    out[d.id] = 0;                       // 強度預設 0 ＝ 沒開
    for (const p of d.params) out[p.id] = p.def;
  }
  return out;
})();

/** 這個特效的強度是不是 0（0 就整層跳過，不花任何時間） */
export const fxActive = (params: any, d: FxDef): boolean => (params?.[d.id] || 0) > 0;

/** 有沒有任何一個新特效開著 */
export function hasActiveFx(params: any): boolean {
  for (const d of FX_DEFS) if (fxActive(params, d)) return true;
  return false;
}

/* ================================================================
   WebGL 端
   ================================================================ */

interface Pool {
  w: number; h: number;
  src: WebGLTexture;
  texs: WebGLTexture[];
  fb: WebGLFramebuffer;
}

interface Ctx {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  quad: WebGLBuffer;
  progs: Map<string, WebGLProgram>;
  maxTex: number;
  /* 貼圖與 framebuffer 留著重複用。每一幀重新配置／釋放是拖曳一開始
     會卡住的主因之一（配置 4 張全尺寸貼圖不便宜），尺寸沒變就不要動它。 */
  pool: Pool | null;
}

let ctxCache: Ctx | null = null;
let ctxFailed = false;

function getCtx(): Ctx | null {
  if (ctxFailed) return null;
  if (ctxCache) return ctxCache;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true })
      || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) { ctxFailed = true; return null; }
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    ctxCache = { gl, canvas, quad, progs: new Map(), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), pool: null };
    return ctxCache;
  } catch {
    ctxFailed = true;
    return null;
  }
}

function compile(c: Ctx, key: string, fs: string): WebGLProgram | null {
  const hit = c.progs.get(key);
  if (hit) return hit;
  const { gl } = c;
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[glEffects] shader compile failed:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const v = mk(gl.VERTEX_SHADER, VS);
  const f = mk(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn('[glEffects] link failed:', gl.getProgramInfoLog(p));
    return null;
  }
  c.progs.set(key, p);
  return p;
}

/** 一趟 pass 的完整片段著色器：共用工具 + 這個特效的 uniform + effect() */
function passSource(d: FxDef, pass: FxPass): string {
  const uniforms = d.params.map(p => `uniform float ${p.id};`).join('\n');
  return `${GLSL_HEADER}\n${uniforms}\nvec4 effect(vec2 uv){${pass.body}\n}\nvoid main(){ gl_FragColor = effect(vUv); }`;
}

function makeTex(gl: WebGLRenderingContext, w: number, h: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function getPool(c: Ctx, w: number, h: number): Pool {
  const { gl } = c;
  if (c.pool && c.pool.w === w && c.pool.h === h) return c.pool;
  if (c.pool) {
    gl.deleteFramebuffer(c.pool.fb);
    gl.deleteTexture(c.pool.src);
    for (const t of c.pool.texs) gl.deleteTexture(t);
  }
  c.pool = {
    w, h,
    src: makeTex(gl, w, h),
    texs: [makeTex(gl, w, h), makeTex(gl, w, h), makeTex(gl, w, h)],
    fb: gl.createFramebuffer()!,
  };
  return c.pool;
}

/**
 * 先把某個特效的著色器編好。
 * 第一次拖滑桿才編譯＋連結會卡一下，所以展開某個特效的參數列時就先叫這支。
 */
export function warmFx(fxId: string): void {
  const d = FX_DEFS.find(x => x.id === fxId);
  if (!d) return;
  const c = getCtx();
  if (!c) return;
  try {
    compile(c, '__copy', `${GLSL_HEADER}\nvoid main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }`);
    compile(c, '__blend', BLEND_FS);
    d.passes.forEach((pass, i) => compile(c, `${d.id}#${i}`, passSource(d, pass)));
  } catch { /* 預熱失敗就算了，真的要用的時候還會再編一次 */ }
}

/**
 * 把 2D 畫布上的內容跑過所有開著的新特效，再畫回同一張畫布。
 * 沒有任何特效開著、或這台裝置拿不到 WebGL，就原封不動什麼都不做。
 */
export function applyGlEffects(
  ctx2d: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: any,
): void {
  const active = FX_DEFS.filter(d => fxActive(params, d));
  if (!active.length || w < 2 || h < 2) return;

  const c = getCtx();
  if (!c) return;
  const { gl } = c;
  // 超過這台裝置的貼圖上限就放棄（導出超大圖時可能發生），不要畫出壞掉的結果
  if (w > c.maxTex || h > c.maxTex) return;

  c.canvas.width = w;
  c.canvas.height = h;
  gl.viewport(0, 0, w, h);

  // 貼圖與 framebuffer 都是重複使用的，尺寸沒變就不重配
  const pool = getPool(c, w, h);
  const { src: srcTex, texs, fb } = pool;

  // 來源：把 2D 畫布上傳進來源貼圖
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx2d.canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

  const cleanup = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); };

  gl.bindBuffer(gl.ARRAY_BUFFER, c.quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  const drawTo = (target: WebGLTexture | null) => {
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const bind = (prog: WebGLProgram, texMain: WebGLTexture, texSrc: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texMain);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texSrc);
    gl.uniform1i(gl.getUniformLocation(prog, 'uSrc'), 1);
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), w, h);
    // 基準像素：橫向 1/REF，縱向換算成同樣的實際距離
    gl.uniform2f(gl.getUniformLocation(prog, 'uTexel'), 1 / REF, (w / h) / REF);
    gl.uniform2f(gl.getUniformLocation(prog, 'uRefRes'), REF, REF * h / w);
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), 0);
  };

  try {
    // 目前的畫面放在 texs[0]
    const copy = compile(c, '__copy', `${GLSL_HEADER}\nvoid main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }`);
    if (!copy) { cleanup(); return; }
    gl.useProgram(copy);
    bind(copy, srcTex, srcTex);
    drawTo(texs[0]);

    let cur = 0;   // 目前畫面所在的 index
    for (const d of active) {
      const layerIn = cur;                       // 本層輸入（uSrc）
      let from = cur;
      for (let i = 0; i < d.passes.length; i++) {
        const pass = d.passes[i];
        const prog = compile(c, `${d.id}#${i}`, passSource(d, pass));
        if (!prog) { cleanup(); return; }
        // 目標不能是 layerIn，也不能是來源
        let to = 0;
        while (to === from || to === layerIn) to++;
        gl.useProgram(prog);
        bind(prog, texs[from], texs[layerIn]);
        gl.uniform2f(gl.getUniformLocation(prog, 'uDir'), pass.dir ? pass.dir[0] : 1, pass.dir ? pass.dir[1] : 0);
        for (const p of d.params) {
          const raw = params[p.id];
          const v = (typeof raw === 'number' ? raw : p.def) * (p.scale ?? 1);
          gl.uniform1f(gl.getUniformLocation(prog, p.id), v);
        }
        drawTo(texs[to]);
        from = to;
      }
      // 跟本層輸入按強度插值
      const blend = compile(c, '__blend', BLEND_FS);
      if (!blend) { cleanup(); return; }
      let to = 0;
      while (to === from || to === layerIn) to++;
      gl.useProgram(blend);
      bind(blend, texs[from], texs[layerIn]);
      gl.uniform1f(gl.getUniformLocation(blend, 'uAmount'), Math.max(0, Math.min(1, (params[d.id] || 0) / 100)));
      drawTo(texs[to]);
      cur = to;
    }

    // 畫到預設 framebuffer，再貼回 2D 畫布
    gl.useProgram(copy);
    bind(copy, texs[cur], texs[cur]);
    drawTo(null);
    gl.flush();

    ctx2d.save();
    ctx2d.globalCompositeOperation = 'copy';
    ctx2d.globalAlpha = 1;
    ctx2d.drawImage(c.canvas, 0, 0, w, h);
    ctx2d.restore();
  } catch (e) {
    console.warn('[glEffects] failed:', e);
  } finally {
    cleanup();
  }
}
