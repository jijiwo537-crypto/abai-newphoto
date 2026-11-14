/* 去背圖的描邊：沿著「看得到的圖案外緣」描，不是沿著方框。
 *
 * 做法（形態學膨脹）：
 *   1. 把畫布上已經畫好的圖（帶透明）做成一張純色剪影
 *   2. 剪影往四面八方各平移「間距＋線寬」畫好幾次 → 外擴後的形狀
 *      （外圈、中圈、內圈三層，細線條的地方中間才不會破洞）
 *   3. 有間距的話，再把「只外擴間距」的那一份挖掉 → 跟圖之間留空
 *   4. 用 destination-over 墊在圖的後面
 * 為了拖滑桿時順，膨脹在長邊最多 768px 的小張上做，再放大貼回來
 * （描邊本身是一片純色，放大看不出差別）。 */

const scratch: { sil?: HTMLCanvasElement; out?: HTMLCanvasElement; hole?: HTMLCanvasElement } = {};
const sized = (key: keyof typeof scratch, w: number, h: number) => {
  const c = scratch[key] || (scratch[key] = document.createElement('canvas'));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  return { c, g };
};

/** 把 src 往外膨脹 r 像素畫到 g 上（src 已經是剪影） */
function dilate(g: CanvasRenderingContext2D, src: HTMLCanvasElement, r: number) {
  g.drawImage(src, 0, 0);
  if (r <= 0.01) return;
  for (const f of [1, 0.66, 0.33]) {
    const rr = r * f;
    if (rr < 0.35) continue;
    const n = Math.max(12, Math.min(56, Math.ceil((Math.PI * 2 * rr) / 1.1)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.drawImage(src, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
}

/**
 * ctx：已經畫好圖（帶透明）的那張畫布；描邊會墊在圖的後面。
 * lw：線寬，gap：跟圖之間的間距（都是 ctx 的像素）。
 */
export function strokeAlphaContour(ctx: CanvasRenderingContext2D, lw: number, gap: number, color: string) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (!(lw > 0) || W < 2 || H < 2) return;
  const k = Math.min(1, 768 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const sil = sized('sil', w, h);
  sil.g.imageSmoothingEnabled = true;
  sil.g.drawImage(ctx.canvas, 0, 0, w, h);
  sil.g.globalCompositeOperation = 'source-in';
  sil.g.fillStyle = color;
  sil.g.fillRect(0, 0, w, h);
  sil.g.globalCompositeOperation = 'source-over';

  const out = sized('out', w, h);
  dilate(out.g, sil.c, (gap + lw) * k);
  if (gap > 0) {
    const hole = sized('hole', w, h);
    dilate(hole.g, sil.c, gap * k);
    out.g.globalCompositeOperation = 'destination-out';
    out.g.drawImage(hole.c, 0, 0);
    out.g.globalCompositeOperation = 'source-over';
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-over';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(out.c, 0, 0, W, H);
  ctx.restore();
}
