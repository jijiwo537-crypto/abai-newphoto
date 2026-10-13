/* 「模糊」圖形：星星、圓角星星、愛心、圓形、十字星、方形的整顆高斯模糊版。
 *
 * 不是羽化：羽化是把邊緣往內變透明，圖形看起來會縮小一圈；
 * 這裡是像整張拍糊那樣，邊緣同時往外暈開、往內變淡，一半透明的地方剛好落在原本的邊上，
 * 所以看起來大小不變。
 *
 * 畫法：在一張小畫布上用三次盒狀模糊（≈ 高斯）糊一次再拉大貼上（見 drawBlurredShape）。
 * 不用 ctx.filter = 'blur()'：iPhone 的 Safari 對它支援不穩。 */
export const BLUR_SHAPE_KINDS = new Set(['blur-star', 'blur-star-rounded', 'blur-heart', 'blur-circle', 'blur-cross-star', 'blur-square', 'blur-sparkle4']);
export const isBlurShape = (kind?: string) => !!kind && BLUR_SHAPE_KINDS.has(kind);
/** 模糊滑桿的預設值（畫面上的 0～100）。圖案裡借來的模糊圖案也照這個值畫。 */
export const BLUR_SHAPE_DEFAULT = 50;
/** 每種模糊圖形自己的預設模糊值：模糊圓形預設糊到最滿（100），其他照 BLUR_SHAPE_DEFAULT。 */
/** 按鈕小圖與「圖案」裡模糊圖形的模糊程度：兩個星星、兩個十字星照滑桿 20 的樣子，
 *  其他（愛心、圓形）照預設。圖形本身的預設值不受影響（blurShapeDefault）。 */
const BLUR_LOOK_20 = new Set(['blur-star', 'blur-star-rounded', 'blur-cross-star', 'blur-sparkle4']);
export const blurLookValue = (kind?: string) => kind && BLUR_LOOK_20.has(kind) ? 20 : BLUR_SHAPE_DEFAULT;
export const blurShapeDefault = (kind?: string) => kind === 'blur-circle' ? 100 : BLUR_SHAPE_DEFAULT;

/** 模糊半徑（圖形自己的座標單位）。
 *  滑桿看起來是 0～100，實際對應最早那版滑桿的 5～23（＝改範圍之前那根滑桿的 0～120）：
 *  0 ＝ 一點點糊，100 ＝ 短邊的 6.9%。 */
export const blurShapeRadius = (w: number, h: number, value?: number) =>
  Math.min(Math.abs(w), Math.abs(h)) * 0.3 * (5 + 0.18 * Math.max(0, Math.min(100, value ?? BLUR_SHAPE_DEFAULT))) / 100;

/** 模糊之前那顆清楚的圖形長怎樣 —— 跟原本那顆實心圖形同一條路徑 */
export const blurShapeBaseD = (kind: string, w: number, h: number, pathD: (k: string, w: number, h: number) => string) => {
  const base = kind.slice('blur-'.length);
  if (base === 'cross-star') {
    // 跟「十字星」圖案一樣：直線四角星，內圈半徑 0.25
    const cx = w / 2, cy = h / 2, pts: string[] = [];
    for (let i = 0; i < 8; i++) {
      const t = -Math.PI / 2 + i * Math.PI / 4, k = i % 2 ? 0.25 : 1;
      pts.push(`${Math.round((cx + Math.cos(t) * cx * k) * 1000) / 1000} ${Math.round((cy + Math.sin(t) * cy * k) * 1000) / 1000}`);
    }
    return `M ${pts.join(' L ')} Z`;
  }
  return pathD(base, w, h);
};

/* 只糊透明度：模糊圖形整顆只有一個顏色，RGB 不用算，最後整張補上顏色就好（比四個通道一起糊快 4 倍）。 */
const boxBlurA = (src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) => {
  const len = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 1 : w, inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[base + Math.min(len - 1, Math.max(0, i)) * step];
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = acc * inv;
      acc += src[base + Math.min(len - 1, i + r + 1) * step] - src[base + Math.max(0, i - r) * step];
    }
  }
};
const blurAlpha = (c: HTMLCanvasElement, r: number, color: string) => {
  const g = c.getContext('2d')!, img = g.getImageData(0, 0, c.width, c.height), d = img.data, n = c.width * c.height;
  let a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3];
  for (let p = 0; p < 3; p++) { boxBlurA(a, b, c.width, c.height, r, true); boxBlurA(b, a, c.width, c.height, r, false); }
  for (let i = 0; i < n; i++) { d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; d[i * 4 + 3] = a[i]; }
  g.putImageData(img, 0, 0);
  // 透明度糊好了，再整張染成圖形的顏色
  g.setTransform(1, 0, 0, 1, 0, 0);   // source-in 會清掉蓋不到的地方，一定要整張蓋滿
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
};
/* 拖滑桿不會一格一格跳：盒狀模糊的半徑只能是整數像素，以前光柵大小固定、半徑跟著滑桿變，
   半徑一取整數，糊的程度就一階一階地跳。現在反過來 —— 盒狀半徑固定（BOX_R 像素），
   改成讓「光柵有多大」跟著模糊值連續變化：糊得越多，光柵越小（也越快算）。 */
const BOX_R = 5, BOX_SIGMA = Math.sqrt(BOX_R * (BOX_R + 1));   // 三次盒狀模糊 ≈ 這個 σ 的高斯
const blurredCache = new Map<string, { canvas: HTMLCanvasElement; img?: ImageBitmap; pad: number; scale: number }>();
export const drawBlurredShape = (
  ctx: CanvasRenderingContext2D, kind: string, w: number, h: number, color: string, value: number | undefined,
  pathD: (k: string, w: number, h: number) => string,
) => {
  const aw = Math.abs(w), ah = Math.abs(h);
  if (aw < 0.5 || ah < 0.5) return;
  const aspect = Math.round(aw / ah * 100) / 100;
  const v = Math.max(0, Math.min(100, value ?? blurShapeDefault(kind)));
  const key = `${kind}|${aspect}|${color}|${Math.round(v * 10) / 10}`;
  let hit = blurredCache.get(key);
  if (!hit) {
    // 光柵大小跟著模糊值連續變化（見上面 BOX_R 的說明），長邊最多 768px
    let short = BOX_SIGMA / Math.max(1e-6, blurShapeRadius(1, 1, v));
    short = Math.min(short, 768 / Math.max(aspect, 1 / aspect));
    const rw = aspect >= 1 ? short * aspect : short, rh = aspect >= 1 ? short : short / aspect;
    const radius = blurShapeRadius(rw, rh, v);
    const r = Math.max(1, Math.round((Math.sqrt(4 * radius * radius + 1) - 1) / 2));
    const pad = Math.ceil(radius * 3) + 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(rw + pad * 2); canvas.height = Math.ceil(rh + pad * 2);
    const g = canvas.getContext('2d')!;
    g.translate(pad, pad);
    g.fillStyle = '#000';
    g.fill(new Path2D(pathD(kind, rw, rh)));
    blurAlpha(canvas, r, color);
    const entry: { canvas: HTMLCanvasElement; img?: ImageBitmap; pad: number; scale: number } = { canvas, pad, scale: rw };
    hit = entry;
    blurredCache.set(key, entry);
    // 轉成 ImageBitmap 讓它留在顯示卡上，之後每格貼圖不用再從記憶體搬一次
    if (typeof createImageBitmap === 'function') void createImageBitmap(canvas).then(bm => { entry.img = bm; }).catch(() => {});
    if (blurredCache.size > 48) { const old = blurredCache.keys().next().value!; blurredCache.get(old)?.img?.close(); blurredCache.delete(old); }
  }
  const k = aw / hit.scale;   // 光柵像素 → 圖形座標
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(hit.img ?? hit.canvas, -hit.pad * k, -hit.pad * k, hit.canvas.width * k, hit.canvas.height * k);
  ctx.imageSmoothingEnabled = prev;
};
