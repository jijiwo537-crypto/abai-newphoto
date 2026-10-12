/* 「模糊」圖形：星星、圓角星星、愛心、圓形、十字星、方形的整顆高斯模糊版。
 *
 * 不是羽化：羽化是把邊緣往內變透明，圖形看起來會縮小一圈；
 * 這裡是像整張拍糊那樣，邊緣同時往外暈開、往內變淡，一半透明的地方剛好落在原本的邊上，
 * 所以看起來大小不變。
 *
 * 畫法：在一張小畫布上用三次盒狀模糊（≈ 高斯）糊一次再拉大貼上（見 drawBlurredShape）。
 * 不用 ctx.filter = 'blur()'：iPhone 的 Safari 對它支援不穩。 */
export const BLUR_SHAPE_KINDS = new Set(['blur-star', 'blur-star-rounded', 'blur-heart', 'blur-circle', 'blur-cross-star', 'blur-square']);
export const isBlurShape = (kind?: string) => !!kind && BLUR_SHAPE_KINDS.has(kind);
/** 模糊滑桿的預設值（畫面上的 0～100） */
export const BLUR_SHAPE_DEFAULT = 10;

/** 模糊半徑（圖形自己的座標單位）。
 *  滑桿看起來是 0～100，實際對應舊版滑桿的 5～20（0 ＝ 一點點糊，100 ＝ 短邊的 6%）。 */
export const blurShapeRadius = (w: number, h: number, value?: number) =>
  Math.min(Math.abs(w), Math.abs(h)) * 0.3 * (5 + 0.15 * Math.max(0, Math.min(100, value ?? BLUR_SHAPE_DEFAULT))) / 100;

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

const boxBlur = (src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) => {
  const len = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 4 : w * 4, inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * 4 : l * 4;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[base + Math.min(len - 1, Math.max(0, i)) * step + c];
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = acc * inv;
        acc += src[base + Math.min(len - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c];
      }
    }
  }
};
const blurCanvas = (c: HTMLCanvasElement, sigma: number) => {
  const g = c.getContext('2d')!, img = g.getImageData(0, 0, c.width, c.height), d = img.data, n = d.length;
  let a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i += 4) { const al = d[i + 3] / 255; a[i] = d[i] * al; a[i + 1] = d[i + 1] * al; a[i + 2] = d[i + 2] * al; a[i + 3] = d[i + 3]; }
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  for (let p = 0; p < 3; p++) { boxBlur(a, b, c.width, c.height, r, true); boxBlur(b, a, c.width, c.height, r, false); }
  for (let i = 0; i < n; i += 4) { const al = a[i + 3]; const m = al > 0 ? 255 / al : 0; d[i] = a[i] * m; d[i + 1] = a[i + 1] * m; d[i + 2] = a[i + 2] * m; d[i + 3] = al; }
  g.putImageData(img, 0, 0);
};
/* 放大不卡：模糊後的圖形本來就沒有銳利細節，所以只在一張固定大小的小畫布上糊一次
   （長邊最多 512px），之後不管畫面放多大，都只是把這張圖拉大貼上去 —— 每一格的成本固定。
   以前是每畫一次就用陰影即時模糊，放很大時模糊半徑跟著變成幾百像素，手機每格都要重算。
   快取鍵是「圖形、寬高比、顏色、模糊值」，拖曳、縮放都直接命中。 */
const blurredCache = new Map<string, { canvas: HTMLCanvasElement; img?: ImageBitmap; pad: number; scale: number }>();
export const drawBlurredShape = (
  ctx: CanvasRenderingContext2D, kind: string, w: number, h: number, color: string, value: number | undefined,
  pathD: (k: string, w: number, h: number) => string,
) => {
  const aw = Math.abs(w), ah = Math.abs(h);
  if (aw < 0.5 || ah < 0.5) return;
  const aspect = Math.round(aw / ah * 100) / 100;
  const v = Math.max(0, Math.min(100, value ?? BLUR_SHAPE_DEFAULT));
  const key = `${kind}|${aspect}|${color}|${Math.round(v * 10) / 10}`;
  let hit = blurredCache.get(key);
  if (!hit) {
    // 光柵：短邊至少 160px、長邊最多 512px
    const L = Math.min(512, Math.max(160, 160 * Math.max(aspect, 1 / aspect)));
    const rw = aspect >= 1 ? L : L * aspect, rh = aspect >= 1 ? L / aspect : L;
    const radius = blurShapeRadius(rw, rh, v);
    const pad = Math.ceil(radius * 3) + 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(rw) + pad * 2; canvas.height = Math.ceil(rh) + pad * 2;
    const g = canvas.getContext('2d')!;
    g.translate(pad, pad);
    g.fillStyle = color;
    g.fill(new Path2D(pathD(kind, rw, rh)));
    blurCanvas(canvas, radius);
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
