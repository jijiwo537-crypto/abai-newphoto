/**
 * 背景紋理：點點／星星／愛心。
 *
 * 參數與網格跟「創意拼圖」的遮罩紋理完全一樣（5~20 大小、40~140 間距、
 * 交錯三角網格），只有兩點不同：
 *   ① 這裡鋪在一整張矩形的頁面背景上，邊緣直接讓畫布裁掉就好。
 *   ② 尺寸基準是「頁面寬 1000px」——經典拼圖每頁尺寸與預覽倍率都不同，
 *      用寬度換算，預覽跟匯出才會是同一張圖。
 */

/** 尺寸換算的基準寬度 */
const REF_W = 1000;

/**
 * 一顆紋理圖案。三種都以 (cx, cy) 為中心、r 為「點點的半徑」。
 * 星星與愛心會畫得比 r 大一些 —— 同樣半徑下它們的面積只有圓的三分之一
 * 到一半，不放大看起來會比點點小很多。
 */
export const patternGlyph = (
  c: CanvasRenderingContext2D,
  kind: string,
  cx: number, cy: number, r: number,
) => {
  c.beginPath();
  if (kind === 'star') {
    const R = r * 1.38;
    for (let k = 0; k < 10; k++) {
      const rad = k % 2 === 0 ? R : R * 0.45;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      if (k === 0) c.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      else c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    c.closePath();
  } else if (kind === 'heart') {
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

/** 把紋理鋪滿 (0,0)~(w,h)。type 是 'none' 就什麼都不做。 */
export const paintPattern = (
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  o: PatternOpts,
) => {
  if (!o || o.type === 'none' || w <= 0 || h <= 0) return;
  const s = w / REF_W;
  const r = ((5 + (o.size ?? 50) / 100 * 15) * s) / 2;
  const dgap = (40 + (o.gap ?? 20)) * s;
  if (r <= 0.05 || dgap <= 0.5) return;

  const dx = dgap;
  const dy = dgap * Math.sqrt(3) / 2;   // 交錯三角網格的列高
  const rangeX = Math.ceil(w / dx) + 2;
  const rangeY = Math.ceil(h / dy) + 2;
  const pad = r * 1.5;                  // 星星／愛心畫得比 r 大，剔除範圍放寬

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
