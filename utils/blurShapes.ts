/* 「模糊」圖形：星星、圓角星星、愛心、圓形、十字星、方形的整顆高斯模糊版。
 *
 * 不是羽化：羽化是把邊緣往內變透明，圖形看起來會縮小一圈；
 * 這裡是像整張拍糊那樣，邊緣同時往外暈開、往內變淡，一半透明的地方剛好落在原本的邊上，
 * 所以看起來大小不變。
 *
 * 畫法用陰影：把圖形畫到畫布外面很遠的地方，只讓它的陰影（shadowBlur）落回原位。
 * iPhone 的 Safari 對 ctx.filter = 'blur()' 支援不穩，陰影模糊則是每一台都一樣。 */
export const BLUR_SHAPE_KINDS = new Set(['blur-star', 'blur-star-rounded', 'blur-heart', 'blur-circle', 'blur-cross-star', 'blur-square']);
export const isBlurShape = (kind?: string) => !!kind && BLUR_SHAPE_KINDS.has(kind);
/** 模糊滑桿的預設值（0～100） */
export const BLUR_SHAPE_DEFAULT = 20;

/** 模糊半徑（圖形自己的座標單位）。100 ＝ 短邊的 30%。 */
export const blurShapeRadius = (w: number, h: number, value?: number) =>
  Math.min(Math.abs(w), Math.abs(h)) * 0.3 * Math.max(0, Math.min(100, value ?? BLUR_SHAPE_DEFAULT)) / 100;

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

/** 用陰影畫出模糊的實心圖形。radius 是圖形座標；會換算成目前縮放下的實際像素。 */
export const fillBlurredPath = (ctx: CanvasRenderingContext2D, path: Path2D, color: string, radius: number) => {
  if (radius <= 0.01) { ctx.fillStyle = color; ctx.fill(path); return; }
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const off = 20000 + Math.abs(m.e);
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e + off, m.f);
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * k * 2;   // shadowBlur ≈ 2σ
  ctx.shadowOffsetX = -off;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
};
