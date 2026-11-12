/* 跨頁拼圖：貼齊的邊「真的沒有縫」。
 *
 * 對齊線吸住之後，兩張照片的邊（或照片與頁面邊緣）在資料上是完全相等的。可是畫到螢幕或成品上時，
 * 那條邊常常落在一個像素的中間：兩邊各自只蓋住那個像素的一部分，底下頁面的白色就從中間透出來 ——
 * 看起來就是一條細縫；預覽放大縮小時落點一直在變，縫就忽有忽無、像在抖。
 *
 * 規則（預覽、IG 預覽、成品都用這一套）：
 *   ‧ 照片貼著另一張照片：「下面那張」把那條邊往外多延伸一點點，藏在「上面那張」底下。
 *     上面那張是不透明的、整片蓋住它，所以看不到任何重疊，也不會有縫。上面那張不動。
 *   ‧ 照片貼著頁面邊緣：往外延伸，頁面的邊緣把多出來的切掉。
 * 延伸的是照片最外面那一排像素（不是放大照片），照片內容、位置、大小、吸附結果全部不變。
 *
 * 只處理「方方正正、不透明」的照片：沒有旋轉、沒有圓角／羽化／形狀／描邊、不透明度 100%。
 * 其他的東西邊緣本來就不是一刀切齊的直線，不適用。 */

export interface SeamItem {
  id: string;
  x: number; y: number; width: number; height: number; scale: number;
  rotation?: number; opacity?: number;
  text?: unknown; shape?: unknown;
  imgRadius?: number; feather?: number; imgShape?: unknown; imgStrokeWidth?: number;
}

/** [左, 右, 上, 下] 哪幾邊要往外延伸 */
export type SeamEdges = [boolean, boolean, boolean, boolean];

const TOL = 1e-3;

export const isSeamRaster = (o: SeamItem) =>
  o.text === undefined && !o.shape && !o.imgRadius && !o.feather && !o.imgShape && !o.imgStrokeWidth
  && ((o.rotation || 0) % 360 === 0) && (o.opacity ?? 100) >= 100 && o.scale > 0;

const rectOf = (o: SeamItem) => {
  const cx = o.x + o.width / 2, cy = o.y + o.height / 2;
  const hw = o.width * o.scale / 2, hh = o.height * o.scale / 2;
  return { L: cx - hw, R: cx + hw, T: cy - hh, B: cy + hh };
};

/**
 * 每張照片哪幾邊要往外延伸。items 的順序就是疊放順序（後面的蓋在前面上）。
 * page：頁寬、頁高、頁數 —— 給了才判斷「貼頁面邊緣」；不給只判斷照片與照片。
 */
export function photoSeamEdges(items: SeamItem[], page?: { width: number; height: number; count: number }): Map<string, SeamEdges> {
  const out = new Map<string, SeamEdges>();
  const rects = items.map(o => (isSeamRaster(o) ? rectOf(o) : null));
  const onPageX = (x: number) => {
    if (!page || !(page.width > 0)) return false;
    const k = Math.round(x / page.width);
    return k >= 0 && k <= page.count && Math.abs(x - k * page.width) <= TOL;
  };
  items.forEach((o, i) => {
    const r = rects[i];
    if (!r) return;
    const e: SeamEdges = [false, false, false, false];
    if (page) {
      e[0] = onPageX(r.L); e[1] = onPageX(r.R);
      e[2] = Math.abs(r.T) <= TOL; e[3] = Math.abs(r.B - page.height) <= TOL;
    }
    /* 只看蓋在自己上面的（索引比較大的）照片 */
    for (let j = i + 1; j < items.length; j++) {
      const q = rects[j];
      if (!q) continue;
      const vOverlap = Math.min(r.B, q.B) - Math.max(r.T, q.T) > TOL;
      const hOverlap = Math.min(r.R, q.R) - Math.max(r.L, q.L) > TOL;
      if (vOverlap && Math.abs(q.R - r.L) <= TOL) e[0] = true;
      if (vOverlap && Math.abs(q.L - r.R) <= TOL) e[1] = true;
      if (hOverlap && Math.abs(q.B - r.T) <= TOL) e[2] = true;
      if (hOverlap && Math.abs(q.T - r.B) <= TOL) e[3] = true;
    }
    if (e.some(Boolean)) out.set(o.id, e);
  });
  return out;
}

/**
 * 在 2D 畫布上把照片最外面那一排像素往外延伸 pad（照片本地座標；照片佔 -w/2..w/2、-h/2..h/2）。
 * 先畫延伸、再畫照片本體，本體蓋在上面，所以照片裡面一個像素都不變。
 */
export function drawSeamBleed(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, edges: SeamEdges, pad: number) {
  if (!(pad > 0)) return;
  const sw = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width || 0;
  const sh = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height || 0;
  if (!sw || !sh) return;
  const l = -w / 2, t = -h / 2;
  const padL = edges[0] ? pad : 0, padR = edges[1] ? pad : 0;
  if (edges[0]) ctx.drawImage(src, 0, 0, 1, sh, l - pad, t, pad + 1e-3, h);
  if (edges[1]) ctx.drawImage(src, sw - 1, 0, 1, sh, l + w - 1e-3, t, pad + 1e-3, h);
  if (edges[2]) ctx.drawImage(src, 0, 0, sw, 1, l - padL, t - pad, w + padL + padR, pad + 1e-3);
  if (edges[3]) ctx.drawImage(src, 0, sh - 1, sw, 1, l - padL, t + h - 1e-3, w + padL + padR, pad + 1e-3);
}
