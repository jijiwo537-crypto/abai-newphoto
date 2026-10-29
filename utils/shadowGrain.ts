/* 噪點：暗部清楚、亮部淡、最亮的地方沒有。
 *
 * 以前是用 overlay 把雜訊圖樣疊上去 —— overlay 在中間調最強、暗部跟亮部都弱，
 * 跟真實的感光元件雜訊（以及 Lightroom、DaVinci 那類「依明暗分配顆粒」的做法）剛好相反：
 * 真實雜訊在暗部最明顯，越亮越被訊號蓋過，到高光幾乎看不到。
 *
 * 做法：雜訊 n 拆成「變亮」與「變暗」兩半，
 *   變亮：screen    → b + (1 − b)·u       （u = 2·max(n − ½, 0)）
 *   變暗：color-burn → b − (1 − b)·2·max(½ − n, 0)（圖層值取 1 / (1 + 2·max(½ − n, 0))，剛好是這個式子）
 * 兩種的幅度都正比於 (1 − b)：純黑最強、中間調跟以前 overlay 一樣、純白完全沒有。
 * 2D 畫布用 screen／color-burn 兩次 drawImage（GPU 合成，不用逐像素），
 * GPU 著色器用同一條式子（SHADOW_GRAIN_GLSL），預覽跟存出來一模一樣。 */

const cache = new WeakMap<HTMLCanvasElement, { sig: string; up: HTMLCanvasElement; down: HTMLCanvasElement }>();

/** 從整張雜訊層（noiseLayerFor 鋪好的）做出「變亮」「變暗」兩張圖層；同一張、同尺寸就沿用 */
export function shadowGrainLayers(noise: HTMLCanvasElement) {
  const sig = `${noise.width}x${noise.height}|${noise.dataset.pattern || ''}`;
  const hit = cache.get(noise);
  if (hit && hit.sig === sig) return hit;
  const w = noise.width, h = noise.height;
  const src = noise.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const up = hit?.up || document.createElement('canvas'), down = hit?.down || document.createElement('canvas');
  up.width = down.width = w; up.height = down.height = h;
  const U = new ImageData(w, h), Dn = new ImageData(w, h), u = U.data, d = Dn.data;
  for (let i = 0; i < src.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = src[i + k] / 255 - 0.5;
      u[i + k] = v > 0 ? Math.round(510 * v) : 0;
      d[i + k] = v < 0 ? Math.round(255 / (1 - 2 * v)) : 255;
    }
    u[i + 3] = d[i + 3] = 255;
  }
  up.getContext('2d')!.putImageData(U, 0, 0);
  down.getContext('2d')!.putImageData(Dn, 0, 0);
  const out = { sig, up, down };
  cache.set(noise, out);
  return out;
}

/** 把噪點疊到 ctx 上（alpha＝濃度；跟以前 overlay 的 globalAlpha 同一個刻度） */
export function drawShadowGrain(ctx: CanvasRenderingContext2D, noise: HTMLCanvasElement, alpha: number, w: number, h: number) {
  const { up, down } = shadowGrainLayers(noise);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(up, 0, 0, w, h);
  ctx.globalCompositeOperation = 'color-burn';
  ctx.drawImage(down, 0, 0, w, h);
  ctx.restore();
}

/** 著色器版（b：底圖，n：雜訊值 0–1，a：濃度），跟上面兩次合成一模一樣 */
export const SHADOW_GRAIN_GLSL = `vec3 shadowGrain(vec3 b,vec3 n,float a){
  vec3 d=n-.5;
  b=mix(b,b+(1.-b)*2.*max(d,0.),a);
  b=mix(b,max(b-(1.-b)*2.*max(-d,0.),0.),a);
  return b;}`;
