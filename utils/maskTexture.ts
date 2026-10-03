import { patternGlyph } from './pattern';

/** Compress individual glyphs, never their centres or the texture spacing. */
export function maskTextureScale(value = 50) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50));
  return { x: v > 50 ? 1 - (v - 50) * .018 : 1,
    y: v < 50 ? .1 + v * .018 : 1 };
}

/** Edge glyphs stay present; only the portion outside the mask is clipped. */
export function paintMaskTexture(ctx: CanvasRenderingContext2D, type: string,
  width: number, height: number, radius: number, gap: number, squash = 50) {
  if (!(width > 0 && height > 0 && radius > 0 && gap > 0)) return;
  const {x, y} = maskTextureScale(squash);
  const dy = gap * Math.sqrt(3) / 2;
  // Stars/hearts extend beyond the nominal circle radius; use a conservative
  // intersection bound so a partially visible tip can never be culled.
  const rx = radius * x * 2, ry = radius * y * 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  const rows = Math.ceil(height / dy) + 2;
  const cols = Math.ceil(width / gap) + 2;
  for (let j = -rows; j <= rows; j++) {
    const py = height / 2 + j * dy;
    if (py + ry < 0 || py - ry > height) continue;
    const shift = Math.abs(j) % 2 ? gap / 2 : 0;
    for (let i = -cols; i <= cols; i++) {
      const px = width / 2 + i * gap + shift;
      if (px + rx < 0 || px - rx > width) continue;
      ctx.save(); ctx.translate(px, py); ctx.scale(x, y);
      patternGlyph(ctx, type, 0, 0, radius);
      ctx.restore();
    }
  }
  ctx.restore();
}
