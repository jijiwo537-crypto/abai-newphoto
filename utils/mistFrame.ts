/* 新圖形分類「邊框」的第一種：霧白邊框。
   跟照片特效「亮角」同一個樣子（往白色 screen 上去 → 邊緣變成霧白），
   但亮角只有四個角，這個是四個角加四個邊都有，中間是透明的。
   顏色跟著圖形的顏色走（預設白），所以畫的是「顏色 × 霧的濃度」。

   霧的濃度：從框邊往內一段（框短邊的 BAND 倍）慢慢淡掉。
   兩個方向用 4 次方的「軟」最大值合起來 —— 邊上是 1，角落比邊更早滿，
   跟亮角一樣角落最白，而且邊跟角之間沒有接縫。 */
export const MIST_FRAME_KIND = 'mist-frame';
export const isMistFrame = (kind?: string) => kind === MIST_FRAME_KIND;

/** 霧從框邊往內延伸多少（框短邊的比例） */
const BAND = 0.32;
const cache = new Map<string, HTMLCanvasElement>();

/** w×h 的霧白邊框遮罩（已經上好顏色）。解析度不用高：整片都是平滑的漸層，放大也看不出來 */
const mistCanvas = (w: number, h: number, color: string): HTMLCanvasElement => {
  const ar = Math.max(.05, Math.min(20, w / Math.max(1e-6, h)));
  const arKey = Math.round(ar * 50) / 50;
  const key = `${arKey}|${color}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const L = 320;
  const W = arKey >= 1 ? L : Math.max(8, Math.round(L * arKey));
  const H = arKey >= 1 ? Math.max(8, Math.round(L / arKey)) : L;
  const band = Math.min(W, H) * BAND;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const ey = Math.max(0, band - Math.min(y + .5, H - y - .5)) / band;
    for (let x = 0; x < W; x++) {
      const ex = Math.max(0, band - Math.min(x + .5, W - x - .5)) / band;
      if (ex <= 0 && ey <= 0) continue;
      const r = Math.min(1, Math.pow(ex ** 4 + ey ** 4, .25));
      const m = r * r * (3 - 2 * r);
      d[(y * W + x) * 4 + 3] = Math.round(m * 255);
    }
  }
  g.putImageData(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  cache.set(key, cv);
  while (cache.size > 16) {
    const old = cache.keys().next().value as string;
    const c = cache.get(old); cache.delete(old);
    if (c) c.width = c.height = 1;
  }
  return cv;
};

/** 在 (0,0)～(w,h) 這個框裡畫霧白邊框 */
export const paintMistFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, color = '#FFFFFF') => {
  if (!(w > 0) || !(h > 0)) return;
  const cv = mistCanvas(w, h, color);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = 'high';
  ctx.drawImage(cv, 0, 0, w, h);
  ctx.restore();
};
