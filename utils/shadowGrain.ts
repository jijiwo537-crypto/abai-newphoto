/* 噪點：暗部最明顯、越亮越淡，但亮部還是留一點（不會完全沒有）。
 *
 * 以前是用 overlay 把雜訊圖樣疊上去 —— overlay 在中間調最強、暗部跟亮部都幾乎沒有，
 * 跟真實的雜訊相反。真實感光元件的雜訊（以及 Lightroom、DaVinci 那類依明暗分配顆粒的做法）：
 * 暗部訊號弱、雜訊最顯眼；越亮越被訊號蓋過，但高光仍然看得到一點細顆粒。
 *
 * 這裡的幅度 ≈ (1 − b) + C·b：純黑 1、純白 C（約三分之一）、中間調跟以前 overlay 差不多。
 * 雜訊 n 拆成「變亮」u、「變暗」v 兩半，各用兩種混合：
 *   (1 − b) 那一份：screen（b + (1 − b)·u）、color-burn（b − (1 − b)·v）
 *   C·b 那一份    ：color-dodge（b·(1 + C·u)）、multiply（b·(1 − C·v)）
 * 2D 畫布四次 drawImage（GPU 合成，不用逐像素），著色器用同一條式子（SHADOW_GRAIN_GLSL），預覽跟存出來一樣。 */

/** 亮部還留多少（純白相對純黑的比例） */
const C = 0.35;
/** 整體幅度：讓中間調的強度跟以前的 overlay 一樣 */
const K = 1.5;

const cache = new WeakMap<HTMLCanvasElement, { sig: string; layers: HTMLCanvasElement[] }>();

/** 從整張雜訊層（noiseLayerFor 鋪好的）做出四張混合用的圖層；同一張、同尺寸就沿用 */
export function shadowGrainLayers(noise: HTMLCanvasElement) {
  const sig = `${noise.width}x${noise.height}|${noise.dataset.pattern || ''}`;
  const hit = cache.get(noise);
  if (hit && hit.sig === sig) return hit.layers;
  const w = noise.width, h = noise.height;
  const src = noise.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const layers = hit?.layers || [0, 1, 2, 3].map(() => document.createElement('canvas'));
  const imgs = layers.map(() => new ImageData(w, h));
  const [s, b, dg, m] = imgs.map(i => i.data);
  for (let i = 0; i < src.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const d = src[i + k] / 255 - 0.5;
      const u = K * Math.max(d, 0), v = K * Math.max(-d, 0);
      s[i + k] = Math.round(255 * u);                       // screen
      b[i + k] = Math.round(255 / (1 + v));                 // color-burn：1 − (1 − b)(1 + v)
      const x = C * u; dg[i + k] = Math.round(255 * x / (1 + x));   // color-dodge：b / (1 − s) ＝ b(1 + x)
      m[i + k] = Math.round(255 * (1 - C * v));             // multiply
    }
    s[i + 3] = b[i + 3] = dg[i + 3] = m[i + 3] = 255;
  }
  layers.forEach((c, j) => { c.width = w; c.height = h; c.getContext('2d')!.putImageData(imgs[j], 0, 0); });
  cache.set(noise, { sig, layers });
  return layers;
}

const OPS: GlobalCompositeOperation[] = ['screen', 'color-burn', 'color-dodge', 'multiply'];
/** 把噪點疊到 ctx 上（alpha＝濃度；跟以前 overlay 的 globalAlpha 同一個刻度） */
export function drawShadowGrain(ctx: CanvasRenderingContext2D, noise: HTMLCanvasElement, alpha: number, w: number, h: number) {
  const layers = shadowGrainLayers(noise);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  layers.forEach((l, j) => { ctx.globalCompositeOperation = OPS[j]; ctx.drawImage(l, 0, 0, w, h); });
  ctx.restore();
}

/** 著色器版（b：底圖，n：雜訊值 0–1，a：濃度），跟上面四次合成一模一樣 */
export const SHADOW_GRAIN_GLSL = `vec3 shadowGrain(vec3 b,vec3 n,float a){
  vec3 d=n-.5;vec3 u=${K.toFixed(2)}*max(d,0.);vec3 v=${K.toFixed(2)}*max(-d,0.);
  b=mix(b,b+(1.-b)*u,a);
  b=mix(b,max(b-(1.-b)*v,0.),a);
  b=mix(b,min(b*(1.+${C.toFixed(2)}*u),1.),a);
  b=mix(b,b*(1.-${C.toFixed(2)}*v),a);
  return b;}`;
