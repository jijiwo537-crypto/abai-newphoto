/** A photo region is one scene surface, not a stack of floating objects.
 * Coordinates are continuous and shared by painting and swapping. Originals are
 * drawn directly at the requested preview/export scale; no composite thumbnail
 * is substituted while zooming. */
export const CREATIVE_PHOTO_LIMIT = 9;
export const PHOTO_SWAP_HOLD_MS = 304;
export type PhotoArrangement = 'grid' | 'horizontal' | 'vertical' | 'feature';
export type RegionPhoto = { src: string; width: number; height: number };
export type PhotoRegion = { photos: RegionPhoto[]; arrangement: PhotoArrangement; landscape: boolean };
export type PhotoRect = { x: number; y: number; w: number; h: number };

export function photoRegionRects(count: number, arrangement: PhotoArrangement = 'grid'): PhotoRect[] {
  const n = Math.min(CREATIVE_PHOTO_LIMIT, Math.max(0, Math.floor(count)));
  if (!n) return [];
  if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (arrangement === 'horizontal' || arrangement === 'vertical') {
    return Array.from({ length: n }, (_, i) => arrangement === 'horizontal'
      ? { x: i / n, y: 0, w: (i + 1) / n - i / n, h: 1 }
      : { x: 0, y: i / n, w: 1, h: (i + 1) / n - i / n });
  }
  if (arrangement === 'feature') {
    const tail = photoRegionRects(n - 1, 'grid');
    return [{ x: 0, y: 0, w: .6, h: 1 }, ...tail.map(r => ({ x: .6 + r.x * .4, y: r.y, w: r.w * .4, h: r.h }))];
  }
  const rows = Math.ceil(Math.sqrt(n));
  // Balance the final row; there are no blank cells when importing 5/7/8 photos.
  const perRow = Math.floor(n / rows), extra = n % rows;
  return Array.from({ length: rows }, (_, row) => {
    const cols = perRow + (row < extra ? 1 : 0);
    return Array.from({ length: cols }, (_, col) => ({
      x: col / cols, y: row / rows,
      w: (col + 1) / cols - col / cols, h: (row + 1) / rows - row / rows,
    }));
  }).flat();
}

export function photoRegionHit(rects: PhotoRect[], x: number, y: number): number {
  if (x < 0 || y < 0 || x > 1 || y > 1) return -1;
  return rects.findIndex(r => x >= r.x && y >= r.y && x < r.x + r.w + 1e-10 && y < r.y + r.h + 1e-10);
}

export function swapRegionPhotos(region: PhotoRegion, a: number, b: number): PhotoRegion {
  if (a === b || a < 0 || b < 0 || a >= region.photos.length || b >= region.photos.length) return region;
  const photos = [...region.photos];
  [photos[a], photos[b]] = [photos[b], photos[a]];
  return { ...region, photos };
}

export function paintPhotoRegion(ctx: CanvasRenderingContext2D, region: PhotoRegion,
  decoded: Map<string, HTMLImageElement>, x: number, y: number, w: number, h: number) {
  const rects = photoRegionRects(region.photos.length, region.arrangement);
  const previousComposite = ctx.globalCompositeOperation;
  // A multi-image draw must not use `copy` per cell (it erases previous cells).
  if (previousComposite === 'copy') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }
  rects.forEach((r, i) => {
    const photo = region.photos[i], img = decoded.get(photo.src);
    if (!img) return;
    const dx = x + r.x * w, dy = y + r.y * h, dw = r.w * w, dh = r.h * h;
    const cover = Math.max(dw / photo.width, dh / photo.height);
    const sw = dw / cover, sh = dh / cover;
    ctx.drawImage(img, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, dx, dy, dw, dh);
  });
  ctx.globalCompositeOperation = previousComposite;
}
