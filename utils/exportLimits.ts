/* 存檔尺寸的安全上限。
 *
 * iPhone／iPad 的 Safari 單張畫布最多約 1677 萬像素（4096×4096）；超過時畫布直接是空的，
 * 而且同時還要好幾份同尺寸的像素緩衝（原圖、結果、暫存），整頁記憶體一爆就閃退重新載入。
 * 48MP 的 iPhone 照片（8064×6048≈4900 萬像素）一按儲存就會碰到。
 * 手機上把成品等比縮到 1600 萬像素以內（12MP 以下的照片完全不受影響）；電腦不限。 */
export const MOBILE_MAX_PIXELS = 16_000_000;
/* 手機上「算效果」的工作尺寸。存檔時調色、特效要同時開好幾張同尺寸的 GPU 貼圖與畫布
   （來源、三張工作貼圖、輸出、調色、成品…），1200～1600 萬像素時加起來 400～600MB，
   iPhone 的 Safari 一個分頁撐不住，就算只套一個特效也會崩潰。
   效果改在 800 萬像素以內算（記憶體約減半），成品再用導向上採樣套回原尺寸（見 utils/fullResExport），
   存出來仍然是原尺寸。不能走原尺寸套回的地方（HEIC、拼圖、藝術）用 MOBILE_MAX_PIXELS。 */
export const MOBILE_WORK_PIXELS = 8_000_000;

export const isMobileDevice = () => typeof navigator !== 'undefined' && (
  /iP(hone|ad|od)|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** 這個尺寸要縮多少倍才安全（1＝不用縮） */
export function safeScale(w: number, h: number, maxPixels = MOBILE_WORK_PIXELS): number {
  // 測試用：window.__testMaxPixels 可以在電腦上模擬手機的上限
  const t = typeof window !== 'undefined' ? (window as any).__testMaxPixels : 0;
  if (t > 0) return w * h > t ? Math.sqrt(t / (w * h)) : 1;
  if (!isMobileDevice() || w * h <= maxPixels) return 1;
  return Math.sqrt(maxPixels / (w * h));
}

/** 等比縮到安全尺寸內 */
export function safeSize(w: number, h: number, maxPixels = MOBILE_WORK_PIXELS): { w: number; h: number; k: number } {
  const k = safeScale(w, h, maxPixels);
  return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)), k };
}

/** 圖片太大時先縮成安全尺寸的新圖片（不太大就原封不動回傳） */
export async function safeImage(im: HTMLImageElement, maxPixels = MOBILE_MAX_PIXELS): Promise<HTMLImageElement> {
  const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height;
  const { w, h, k } = safeSize(W, H, maxPixels);
  if (k >= 1) return im;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, w, h);
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.95));
  c.width = c.height = 0;
  if (!blob) return im;
  const out = new Image();
  await new Promise<void>(r => { out.onload = () => r(); out.onerror = () => r(); out.src = URL.createObjectURL(blob); });
  return out.naturalWidth ? out : im;
}
