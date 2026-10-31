/* 依臉的點畫出「只有皮膚」的遮罩（主執行緒、背景執行緒共用）。
 * 臉的外輪廓整塊，挖掉眼睛（含睫毛一圈）、眉毛、嘴唇、鼻孔；整張再做柔邊（半徑跟著臉的大小）。 */

const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
/** 鼻孔（兩邊鼻翼下緣）附近 */
const NOSTRILS = [98, 327];

/** 遮罩長邊（像素） */
export const MASK_LONG = 256;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type MaskBufs = { a: Float32Array | null; t: Float32Array | null };

export function maskSize(vw: number, vh: number): [number, number] {
  return vw >= vh
    ? [MASK_LONG, Math.max(16, Math.round(MASK_LONG * vh / vw))]
    : [Math.max(16, Math.round(MASK_LONG * vw / vh)), MASK_LONG];
}

/** 嘴唇內緣（張嘴時要挖掉，口紅不會塗到牙齒） */
const INNER_LIPS = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
/** 瘦臉用的控制點：鼻尖、左下頰、左下顎角、右下頰、右下顎角、下巴、左右臉寬 */
export const SLIM_IDX = [4, 132, 172, 361, 397, 152, 234, 454];

/** 畫遮罩到 g（大小 mw×mh）：
 *  R＝皮膚（磨皮範圍）、G＝腮紅（蘋果肌）、B＝嘴唇（口紅範圍）。三個各自柔邊、半徑不同。
 *  回傳最大那張臉佔畫面寬的比例、所有臉的外框（比例座標，含一圈餘裕）、瘦臉控制點 */
export function drawSkinMask(g: Ctx, mw: number, mh: number, faces: number[][], vw: number, vh: number, bufs: MaskBufs) {
  g.globalCompositeOperation = 'source-over';
  let frac = 0, faceWmax = 0;
  const clear = () => { g.fillStyle = '#000'; g.fillRect(0, 0, mw, mh); };
  const each = (fn: (P: (k: number) => [number, number], path: (idx: number[]) => void, poly: (idx: number[], fill: string, grow?: number) => void, faceW: number) => void) => {
    for (const f of faces) {
      const P = (k: number): [number, number] => [f[k * 2] * mw, f[k * 2 + 1] * mh];
      const path = (idx: number[]) => { g.beginPath(); idx.forEach((k, i) => { const [x, y] = P(k); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
      const poly = (idx: number[], fill: string, grow = 0) => {
        path(idx);
        g.fillStyle = fill; g.fill();
        if (grow > 0) { g.lineWidth = grow; g.strokeStyle = fill; g.lineJoin = 'round'; g.stroke(); }
      };
      const [ax, ay] = P(234), [bx, by] = P(454);
      fn(P, path, poly, Math.hypot(ax - bx, ay - by) || mw * 0.3);
    }
  };
  const grab = () => g.getImageData(0, 0, mw, mh).data;

  // R：皮膚
  clear();
  each((P, path, poly, faceW) => {
    faceWmax = Math.max(faceWmax, faceW);
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
  });
  for (const f of faces) frac = Math.max(frac, Math.hypot((f[234 * 2] - f[454 * 2]) * vw, (f[234 * 2 + 1] - f[454 * 2 + 1]) * vh) / vw);
  if (!faces.length) { clear(); return { frac, box: [0, 0, 1, 1] as [number, number, number, number], pts: [] as number[] }; }
  const skin = grab();

  // G：腮紅 —— 蘋果肌位置（臉頰點 50／280 往外上方一點），斜向太陽穴的橢圓
  clear();
  each((P, _path, _poly, faceW) => {
    const nose = P(4);
    for (const [k, side] of [[50, -1], [280, 1]] as const) {
      const [cx, cy] = P(k);
      const x = cx + (cx - nose[0]) * 0.12, y = cy - faceW * 0.02;
      g.fillStyle = '#fff'; g.beginPath();
      g.ellipse(x, y, faceW * 0.15, faceW * 0.095, side * -0.35, 0, Math.PI * 2); g.fill();
    }
  });
  const blush = grab();

  // B：嘴唇 —— 外輪廓填滿、挖掉內緣（張嘴露出的牙齒、口腔）
  clear();
  each((_P, _path, poly) => { poly(LIPS, '#fff'); poly(INNER_LIPS, '#000'); });
  const lips = grab();

  // 柔邊：皮膚跟腮紅半徑大（自然漸層），嘴唇半徑小（唇線要清楚，但不鋸齒）
  const out = g.createImageData(mw, mh), d = out.data, n = mw * mh;
  const ch = (src: Uint8ClampedArray, r: number, o: number) => {
    if (!bufs.a || bufs.a.length !== n) { bufs.a = new Float32Array(n); bufs.t = new Float32Array(n); }
    const a = bufs.a, t = bufs.t!;
    for (let i = 0; i < n; i++) a[i] = src[i * 4];
    if (r >= 1) boxBlur3(a, t, mw, mh, r);
    for (let i = 0; i < n; i++) d[i * 4 + o] = a[i];
  };
  ch(skin, Math.round(faceWmax * 0.045 / 1.7), 0);
  ch(blush, Math.round(faceWmax * 0.06 / 1.7), 1);
  ch(lips, Math.max(1, Math.round(faceWmax * 0.008)), 2);
  for (let i = 0; i < n; i++) d[i * 4 + 3] = 255;
  g.putImageData(out, 0, 0);

  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const f of faces) for (let i = 0; i < f.length; i += 2) { const x = f[i], y = f[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const mx = (x1 - x0) * 0.12 + 0.01, my = (y1 - y0) * 0.12 + 0.01;
  const box: [number, number, number, number] = [Math.max(0, x0 - mx), Math.max(0, y0 - my), Math.min(1, x1 + mx), Math.min(1, y1 + my)];
  const pts: number[] = [];
  for (const f of faces) for (const k of SLIM_IDX) pts.push(f[k * 2], f[k * 2 + 1]);
  return { frac, box, pts };
}

/** 三趟方塊模糊（≈ 高斯），結果留在 a */
function boxBlur3(a: Float32Array, t: Float32Array, w: number, h: number, r: number) {
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
}
