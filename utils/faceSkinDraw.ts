/* 依臉的點畫出「只有皮膚」的遮罩（主執行緒、背景執行緒共用）。
 * 臉的外輪廓整塊，挖掉眼睛（含睫毛一圈）、眉毛、嘴唇、鼻孔；整張再做柔邊（半徑跟著臉的大小）。 */

export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
export const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
export const RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
export const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
/** 鼻孔（兩邊鼻翼下緣）附近 */
export const NOSTRILS = [98, 327];

/** 遮罩長邊（像素） */
export const MASK_LONG = 256;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type MaskBufs = { a: Float32Array | null; t: Float32Array | null };

export function maskSize(vw: number, vh: number): [number, number] {
  return vw >= vh
    ? [MASK_LONG, Math.max(16, Math.round(MASK_LONG * vh / vw))]
    : [Math.max(16, Math.round(MASK_LONG * vw / vh)), MASK_LONG];
}

/** 畫遮罩到 g（大小 mw×mh）。回傳最大那張臉佔畫面寬的比例、所有臉的外框（比例座標，含一圈餘裕） */
export function drawSkinMask(g: Ctx, mw: number, mh: number, faces: number[][], vw: number, vh: number, bufs: MaskBufs) {
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, mw, mh);
  let frac = 0, blurPx = 2;
  for (const f of faces) {
    const P = (k: number): [number, number] => [f[k * 2] * mw, f[k * 2 + 1] * mh];
    const path = (idx: number[]) => { g.beginPath(); idx.forEach((k, i) => { const [x, y] = P(k); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
    const poly = (idx: number[], fill: string, grow = 0) => {
      path(idx);
      g.fillStyle = fill; g.fill();
      if (grow > 0) { g.lineWidth = grow; g.strokeStyle = fill; g.lineJoin = 'round'; g.stroke(); }
    };
    const [ax, ay] = P(234), [bx, by] = P(454);
    const faceW = Math.hypot(ax - bx, ay - by) || mw * 0.3;
    frac = Math.max(frac, Math.hypot((f[234 * 2] - f[454 * 2]) * vw, (f[234 * 2 + 1] - f[454 * 2 + 1]) * vh) / vw);
    blurPx = Math.max(blurPx, faceW * 0.045);
    // 外輪廓往內收一點：柔邊之後才不會磨到頭髮、背景
    poly(FACE_OVAL, '#fff');
    g.lineWidth = faceW * 0.04; g.strokeStyle = '#000'; g.lineJoin = 'round';
    path(FACE_OVAL); g.stroke();
    poly(LEFT_EYE, '#000', faceW * 0.07);
    poly(RIGHT_EYE, '#000', faceW * 0.07);
    poly(LEFT_BROW, '#000', faceW * 0.045);
    poly(RIGHT_BROW, '#000', faceW * 0.045);
    poly(LIPS, '#000', faceW * 0.045);
    g.fillStyle = '#000';
    for (const k of NOSTRILS) { const [x, y] = P(k); g.beginPath(); g.ellipse(x, y, faceW * 0.045, faceW * 0.035, 0, 0, Math.PI * 2); g.fill(); }
  }
  let box: [number, number, number, number] = [0, 0, 1, 1];
  if (faces.length) {
    // 柔邊：三趟方塊模糊（≈ 高斯），半徑跟著臉的大小
    feather(g, mw, mh, Math.round(blurPx / 1.7), bufs);
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const f of faces) for (let i = 0; i < f.length; i += 2) { const x = f[i], y = f[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const mx = (x1 - x0) * 0.12 + 0.01, my = (y1 - y0) * 0.12 + 0.01;
    box = [Math.max(0, x0 - mx), Math.max(0, y0 - my), Math.min(1, x1 + mx), Math.min(1, y1 + my)];
  }
  return { frac, box };
}

function feather(g: Ctx, w: number, h: number, r: number, bufs: MaskBufs) {
  if (r < 1) return;
  const im = g.getImageData(0, 0, w, h), d = im.data, n = w * h;
  if (!bufs.a || bufs.a.length !== n) { bufs.a = new Float32Array(n); bufs.t = new Float32Array(n); }
  const a = bufs.a, t = bufs.t!;
  for (let i = 0; i < n; i++) a[i] = d[i * 4];
  const pass = (src: Float32Array, dst: Float32Array, horiz: boolean) => {
    const L = horiz ? w : h, M = horiz ? h : w, inv = 1 / (r * 2 + 1);
    for (let m = 0; m < M; m++) {
      const at = (k: number) => src[horiz ? m * w + Math.min(L - 1, Math.max(0, k)) : Math.min(L - 1, Math.max(0, k)) * w + m];
      let s = 0;
      for (let k = -r; k <= r; k++) s += at(k);
      for (let k = 0; k < L; k++) {
        dst[horiz ? m * w + k : k * w + m] = s * inv;
        s += at(k + r + 1) - at(k - r);
      }
    }
  };
  for (let it = 0; it < 3; it++) { pass(a, t, true); pass(t, a, false); }
  for (let i = 0; i < n; i++) { const v = a[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
}
