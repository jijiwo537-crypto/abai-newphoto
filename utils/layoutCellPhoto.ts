/**
 * 跨頁拼圖格子裡照片的唯一一套構圖規則。
 * 所有預覽路線（GPU 畫布、2D 特效畫布、內嵌 SVG、DOM 格子）和存檔都呼叫它，畫面上看到的就是存出來的。
 * frameW/frameH：格子的格位，也就是 rect.w × 面積，含分到的間距（照片置中在格子上，間距只負責裁切）。
 * 位移是同一個格位的比例。1.02 的出血蓋住反鋸齒的裁切邊；用乘的，任何縮放比例都一樣
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
