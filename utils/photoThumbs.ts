import { useCallback, useEffect, useRef, useState } from 'react';

/* Small JPEG thumbnails for the camera roll.
 *
 * The shutter preview and the gallery grid used to show every 12MP photo
 * through <img src={fullPhoto}>. Each one is decoded at full size (~50MB of
 * pixels on iPhone) just to fill a 56px square; a handful of shots plus the
 * capture buffers was enough for iOS to kill the page (white screen, then
 * reload). Thumbnails are made once, one photo at a time, and the full photo
 * is only decoded when it is opened in the editor. */
export const THUMB_EDGE = 360;

const encode = (canvas: HTMLCanvasElement) => new Promise<string | null>(resolve => {
  try { canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.82); }
  catch { resolve(null); }
});

/** Thumbnail of a canvas that is already in memory (no extra decode). */
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

/** thumbs[src] for every photo; missing ones are generated sequentially. */
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
    // Drop thumbnails of photos that are gone.
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
      // Record a failure as the photo itself so it is not retried forever.
      setThumbs(t => ({ ...t, [next]: url ?? next }));
    });
  }, [photos, thumbs]);
  return { thumbs, seed };
}
