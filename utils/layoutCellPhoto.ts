/**
 * The ONE framing rule for a photo inside a multi-page layout cell.
 *
 * Every preview path (GPU surface, 2D effect surface, inset SVG, DOM cells)
 * and the export call this, so what is on screen is what is saved.
 *
 * frameW/frameH: the cell's slot, i.e. rect.w × area including its share of
 * the gutter (the photo is centred on the cell and the gutter only clips it).
 * Offsets are fractions of that same slot. The 1.02 bleed covers antialiased
 * clip edges; it is multiplicative so every zoom keeps the same proportion.
 */
export const CELL_COVER_BLEED = 1.02;

export type CellFraming = { zoom?: number; offsetX?: number; offsetY?: number; rotation?: number };

export const cellTurned = (rotation = 0) => rotation % 180 !== 0;

export function cellPhotoPlacement(frameW: number, frameH: number, imgW: number, imgH: number, cell: CellFraming) {
  const rotation = cell.rotation || 0;
  const turn = cellTurned(rotation);
  const dw = Math.max(1e-6, turn ? imgH : imgW), dh = Math.max(1e-6, turn ? imgW : imgH);
  return {
    scale: Math.max(frameW / dw, frameH / dh) * CELL_COVER_BLEED * (cell.zoom || 1),
    dx: (cell.offsetX || 0) * frameW,
    dy: (cell.offsetY || 0) * frameH,
    rotation,
    angle: rotation * Math.PI / 180,
  };
}
