/* 照片的讀取與高品質縮小，創意拼圖（photoTiers）和跨頁拼圖（previewCopies）共用。
 * 縮出來的檔案維持廣色域；有透明的存 PNG，其餘存高品質 JPEG。 */
import { get2dWide } from './colorSpace';

export const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => rej(new Error('image load failed'));
  im.src = src;
});

/** 把 im 縮成 w×h，回傳已解碼好的圖與它的網址（用完要 revokeObjectURL）。做不出來回傳 null */
export async function resampleImage(im: CanvasImageSource, w: number, h: number, alpha: boolean, quality: number): Promise<{ img: HTMLImageElement; url: string } | null> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  try {
    const g = get2dWide(c);
    if (!g) return null;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, w, h);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, alpha ? 'image/png' : 'image/jpeg', alpha ? undefined : quality));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    try { await img.decode?.(); } catch { /* 解碼延後也沒關係 */ }
    return { img, url };
  } finally { c.width = c.height = 0; }
}

/** 長邊縮到 long 時的寬高 */
export const fitLong = (w: number, h: number, long: number) => {
  const k = long / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
};
