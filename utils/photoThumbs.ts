import { useCallback, useEffect, useRef, useState } from 'react';

/* 相機膠卷用的小 JPEG 縮圖。快門預覽和相簿格子如果直接用 <img src={原圖}> 顯示每張 1200 萬像素的照片，
   每張都會以全尺寸解碼（iPhone 上約 50MB 像素），只為了填一個 56px 的方塊；拍幾張加上拍照暫存，
   iOS 就會關掉網頁（白畫面後重新載入）。縮圖一張一張做一次，原圖只有在編輯器打開時才解碼 */
export const THUMB_EDGE = 360;

const encode = (canvas: HTMLCanvasElement) => new Promise<string | null>(resolve => {
  try { canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.82); }
  catch { resolve(null); }
});

/** 記憶體裡已經有的畫布做縮圖（不用另外解碼） */
export const thumbFromCanvas = async (source: CanvasImageSource, w: number, h: number) => {
  if (!w || !h) return null;
  const k = Math.min(1, THUMB_EDGE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d', { alpha: false });
  if (!g) return null;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, c.width, c.height);
  const url = await encode(c);
  c.width = c.height = 1;
  return url;
};

const thumbFromUrl = (src: string) => new Promise<string | null>(resolve => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = async () => {
    const url = await thumbFromCanvas(img, img.naturalWidth, img.naturalHeight);
    img.removeAttribute('src');
    resolve(url);
  };
  img.onerror = () => resolve(null);
  img.src = src;
});

/** 每張照片都有 thumbs[src]；缺的依序產生 */
export function usePhotoThumbs(photos: string[]) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const ref = useRef(thumbs); ref.current = thumbs;
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
    (Object.entries(ref.current) as [string, string][]).forEach(([k, u]) => { if (u !== k) URL.revokeObjectURL(u); });
  }, []);
  const seed = useCallback((src: string, thumb: string | null) => {
    if (thumb) setThumbs(t => ({ ...t, [src]: thumb }));
  }, []);
  useEffect(() => {
    // 丟掉已經不在的照片的縮圖
    const keep = new Set(photos);
    const stale = Object.keys(ref.current).filter(k => !keep.has(k));
    if (stale.length) {
      stale.forEach(k => { if (ref.current[k] !== k) URL.revokeObjectURL(ref.current[k]); });
      setThumbs(t => { const n = { ...t }; stale.forEach(k => delete n[k]); return n; });
    }
    if (busy.current) return;
    const next = photos.find(p => !ref.current[p]);
    if (!next) return;
    busy.current = true;
    void thumbFromUrl(next).then(url => {
      busy.current = false;
      if (!alive.current) { if (url) URL.revokeObjectURL(url); return; }
      // 失敗時把照片本身記成縮圖，才不會一直重試
      setThumbs(t => ({ ...t, [next]: url ?? next }));
    });
  }, [photos, thumbs]);
  return { thumbs, seed };
}
