/** Backing-store density for a preview surface. Never allocate the whole enlarged
 * object's area at the device's full pixel ratio: iOS WebKit can terminate the app. */
export function previewSurfaceDpr(width: number, height: number, preferredDpr: number): number {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const preferred = Math.max(0.01, Number.isFinite(preferredDpr) ? preferredDpr : 1);
  return Math.min(preferred, 4096 / Math.max(w, h), Math.sqrt(8_000_000 / (w * h)));
}

/** Keep effect texture sizes stable over a continuous pinch or corner drag. */
export function previewEffectLongEdge(wantedPixels: number): number {
  const wanted = Math.max(0, Number.isFinite(wantedPixels) ? wantedPixels : 0);
  return wanted > 2048 ? 3072 : Math.max(1080, Math.min(2048, Math.ceil(wanted / 256) * 256));
}
