/* 新圖形分類「邊框」的第一種：霧白邊框。
   跟照片特效「亮角」同一個樣子（往白色 screen 上去 → 邊緣變成霧白），
   但亮角只有四個角，這個是四個角加四個邊都有，中間是透明的。
   顏色跟著圖形的顏色走（預設白），所以畫的是「顏色 × 霧的濃度」。

   霧的濃度＝「離中間那塊圓角矩形有多遠」：從框邊往內一段（範圍）慢慢淡掉，
   中間透明的那一塊是圓角的（角的半徑剛好等於霧的寬度）。

   畫法：不逐像素算 —— 拆成九宮格，四條邊是線性漸層、四個角是放射漸層，
   各自只畫在自己那一格，接起來剛好是同一個距離場，沒有接縫。
   每一格都是畫布原生的漸層，變形、移動、縮放時每一格都直接畫，不用重做遮罩。 */
export const MIST_FRAME_KIND = 'mist-frame';
export const isMistFrame = (kind?: string) => kind === MIST_FRAME_KIND;

/** 面板「範圍」0～100 → 霧從框邊往內延伸多少（框短邊的比例）。預設 50 ≈ 0.33 */
export const MIST_RANGE_DEFAULT = 50;
const bandOf = (range = MIST_RANGE_DEFAULT) => .06 + Math.max(0, Math.min(100, range)) / 100 * .54;

const rgbOf = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};
/** 漸層的色標：照 smoothstep 取 9 點，霧的邊緣才不會有一圈硬邊 */
const STOPS = Array.from({ length: 9 }, (_, i) => i / 8);
const addStops = (g: CanvasGradient, rgb: number[], outward: boolean) => {
  for (const t of STOPS) {
    const m = t * t * (3 - 2 * t);
    g.addColorStop(outward ? t : 1 - t, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${m.toFixed(4)})`);
  }
};

/** 在 W×H 像素的畫布上直接畫霧（W、H、分界都是整數像素，九宮格接起來才不會有細縫）。
   band 用「框短邊的比例」傳進來，跟畫布實際大小無關。 */
const drawMistPx = (ctx: CanvasRenderingContext2D, W: number, H: number, bandFrac: number, color: string) => {
  const rgb = rgbOf(color);
  const band = Math.max(1, Math.min(W, H) * bandFrac);
  // 中間透明那塊（不含圓角）的左上、右下，對齊到整數像素
  const x0 = Math.round(Math.min(W / 2, band)), x1 = Math.round(Math.max(W / 2, W - band));
  const y0 = Math.round(Math.min(H / 2, band)), y1 = Math.round(Math.max(H / 2, H - band));
  const rect = (x: number, y: number, rw: number, rh: number, fill: CanvasGradient) => {
    if (rw <= 0 || rh <= 0) return;
    ctx.fillStyle = fill; ctx.fillRect(x, y, rw, rh);
  };
  const lin = (ax: number, ay: number, bx: number, by: number) => {
    const g = ctx.createLinearGradient(ax, ay, bx, by); addStops(g, rgb, true); return g;
  };
  const rad = (cx: number, cy: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, band); addStops(g, rgb, true); return g;
  };
  ctx.save();
  // 四條邊（往外越白）
  rect(x0, 0, x1 - x0, y0, lin(0, y0, 0, y0 - band));
  rect(x0, y1, x1 - x0, H - y1, lin(0, y1, 0, y1 + band));
  rect(0, y0, x0, y1 - y0, lin(x0, 0, x0 - band, 0));
  rect(x1, y0, W - x1, y1 - y0, lin(x1, 0, x1 + band, 0));
  // 四個角：圍著中間那塊的圓角，所以透明區是圓角矩形；超出 band 的地方漸層最後一格就是滿的
  rect(0, 0, x0, y0, rad(x0, y0));
  rect(x1, 0, W - x1, y0, rad(x1, y0));
  rect(0, y1, x0, H - y1, rad(x0, y1));
  rect(x1, y1, W - x1, H - y1, rad(x1, y1));
  ctx.restore();
};

/* 沒有紋理時：霧畫在一張小畫布上（長邊 384px），再平滑放大貼上去 ——
   整片都是柔和的漸層，放大看不出差別；每一格重畫也只是八塊漸層，不用快取。 */
let smallSurface: HTMLCanvasElement | null = null;
const drawMist = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string, range?: number) => {
  const L = 384, ar = w / h;
  const W = Math.max(4, Math.round(ar >= 1 ? L : L * ar)), H = Math.max(4, Math.round(ar >= 1 ? L / ar : L));
  const cv = smallSurface ??= document.createElement('canvas');
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const g = cv.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  drawMistPx(g, W, H, bandOf(range), color);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = 'high';
  ctx.drawImage(cv, 0, 0, W, H, 0, 0, w, h);
  ctx.restore();
};

let texSurface: HTMLCanvasElement | null = null;
/**
 * 在 (0,0)～(w,h) 這個框裡畫霧白邊框。
 * texture：要疊紋理時傳進來（收到的是暫存畫布、跟框一樣大的路徑），紋理只會出現在有霧的地方。
 */
export const paintMistFrame = (
  ctx: CanvasRenderingContext2D, w: number, h: number, color = '#FFFFFF', range?: number,
  texture?: (tc: CanvasRenderingContext2D, bodyPath: Path2D) => void,
) => {
  if (!(w > 0) || !(h > 0)) return;
  if (!texture) { drawMist(ctx, w, h, color, range); return; }
  /* 有紋理：先在暫存畫布上畫霧，再用 source-atop 把紋理疊上去（只留在霧上、跟著霧的濃淡），
     最後整張貼回來。暫存畫布照實際像素開，貼回來才不會糊。 */
  const m = ctx.getTransform();
  const k = Math.max(.25, Math.min(4, Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))));
  const W = Math.max(1, Math.min(4096, Math.ceil(w * k))), H = Math.max(1, Math.min(4096, Math.ceil(h * k)));
  const cv = texSurface ??= document.createElement('canvas');
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const g = cv.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  drawMistPx(g, W, H, bandOf(range), color);
  g.setTransform(W / w, 0, 0, H / h, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const body = new Path2D(); body.rect(0, 0, w, h);
  texture(g, body);
  g.globalCompositeOperation = 'source-over';
  g.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(cv, 0, 0, W, H, 0, 0, w, h);
};
