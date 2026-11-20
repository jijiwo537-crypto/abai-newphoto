import { paintGlow } from '../utils/glowSprite';

/**
 * 線條圖形的柔光：交給共用的高品質光暈圖（utils/glowSprite）。
 * 光暈圖上的模糊半徑固定是一組小數字，放大不會出現像素感、縮放也不會抖；
 * 銳利的線條本身每次都在目前場景裡用向量畫。blurs 是本地座標的半徑。
 */
export function paintCachedClassicGlow(ctx: CanvasRenderingContext2D, path: Path2D,
  key: string, width: number, height: number, lineWidth: number, dash: number[],
  color: string, blurs: number[]) {
  const m = ctx.getTransform();
  const dev = Math.max(1e-4, Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)));
  ctx.save();
  ctx.lineWidth = lineWidth; ctx.lineCap = 'butt'; ctx.setLineDash(dash);
  paintGlow(ctx, { x: 0, y: 0, w: width, h: height }, blurs.map(b => b * dev), color, g => {
    g.strokeStyle = color; g.stroke(path);
  }, `cg|${key}|${lineWidth}|${dash.join(',')}`);
  ctx.restore();
  return true;
}
