/**
 * 背景紋理：點點／星星／愛心。
 *
 * 這一套的參數與網格跟「創意拼圖」的遮罩紋理完全一樣（同樣的 5~20 大小、
 * 40~140 間距、同樣的交錯三角網格），差別只有兩點：
 *   ① 這裡是鋪在「一整張矩形的頁面背景」上，所以邊緣直接讓畫布裁掉就好，
 *      不像遮罩那邊要留 pad（遮罩是不規則形狀，貼邊會很難看）。
 *   ② 尺寸的基準改成「頁面寬 1000px」——經典拼圖的頁面尺寸跟預覽倍率
 *      每一頁都不一樣，用寬度去換算，預覽跟匯出看起來才會是同一張圖。
 *
 * 創意拼圖那邊有一份長得一樣的 patternGlyph（在 CollageTool.tsx 裡）。
 * 沒有把它改成 import 這一支，是因為那一頁已經驗過了，不想為了去重動它；
 * 兩邊的數學是逐行相同的，之後要合併隨時可以。
 */

/** 尺寸換算的基準寬度。頁面寬幾 px，就照這個比例縮放點點的大小與間距。 */
const REF_W = 1000;

/**
 * 一顆紋理圖案。三種都以 (cx, cy) 為中心、r 為外接半徑，
 * 所以呼叫端要換形狀完全不用改座標。
 */
export const patternGlyph = (
  c: CanvasRenderingContext2D,
  kind: string,
  cx: number, cy: number, r: number,
) => {
  c.beginPath();
  if (kind === 'star') {
    /* 正五角星：外角在 r、內角在 0.42r，第一個角朝正上方。 */
    const R = r * 1.38;
    for (let k = 0; k < 10; k++) {
      const rad = k % 2 === 0 ? R : R * 0.45;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  } else if (kind === 'heart') {
    /* 愛心：從下面的尖端出發，左右各一條三次貝茲畫出兩個圓弧，
       在正上方收成中間那個凹口。s 取 0.9r 是為了讓它看起來的份量
       跟同樣 r 的圓差不多（心形比圓「胖」），同時仍然收在 r 以內。 */
    const s = r * 1.22;
    c.moveTo(cx, cy + s * 0.85);
    c.bezierCurveTo(cx - s * 1.5, cy - s * 0.2, cx - s * 0.55, cy - s * 1.15, cx, cy - s * 0.4);
    c.bezierCurveTo(cx + s * 0.55, cy - s * 1.15, cx + s * 1.5, cy - s * 0.2, cx, cy + s * 0.85);
    c.closePath();
  } else {
    c.arc(cx, cy, r, 0, Math.PI * 2);
  }
  c.fill();
};

export interface PatternOpts {
  /** 'none' | 'dot' | 'star' | 'heart' */
  type: string;
  color: string;
  /** UI 上的 0~100，對應實際大小 5~20 */
  size: number;
  /** UI 上的 0~100，對應實際間距 40~140 */
  gap: number;
}

/**
 * 把紋理鋪滿 (0,0)~(w,h)。type 是 'none' 就什麼都不做。
 * 網格以中心點對齊，所以換頁面尺寸時圖案不會整片位移。
 */
export const paintPattern = (
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  o: PatternOpts,
) => {
  if (!o || o.type === 'none' || w <= 0 || h <= 0) return;
  const s = w / REF_W;
  const dsz = (5 + (o.size ?? 50) / 100 * 15) * s;
  const dgap = (40 + (o.gap ?? 20)) * s;
  const r = dsz / 2;
  if (r <= 0.05 || dgap <= 0.5) return;

  const dx = dgap;
  const dy = dgap * Math.sqrt(3) / 2;   // 交錯三角網格的列高
  const rangeX = Math.ceil(w / dx) + 2;
  const rangeY = Math.ceil(h / dy) + 2;

  const pad = r * 1.5;   // 星星／愛心畫得比 r 大，剔除範圍要放寬

  ctx.save();
  ctx.fillStyle = o.color || '#FFFFFF';
  for (let j = -rangeY; j <= rangeY; j++) {
    const py = h / 2 + j * dy;
    if (py + pad < 0 || py - pad > h) continue;
    const shiftX = Math.abs(j) % 2 === 1 ? dx / 2 : 0;
    for (let i = -rangeX; i <= rangeX; i++) {
      const px = w / 2 + i * dx + shiftX;
      if (px + pad < 0 || px - pad > w) continue;
      patternGlyph(ctx, o.type, px, py, r);
    }
  }
  ctx.restore();
};
