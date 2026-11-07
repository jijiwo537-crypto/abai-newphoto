/**
 * 大小跟著實際的格點間距，不是間距滑桿或畫面縮放。半徑、間距、單位要在同一套邏輯座標裡。
 * 外接圓的範圍也蓋得住愛心和星星，鄰居之間留 4% 的空隙
 */
export function spacedTextureRadius(radius: number, pitch: number, unit: number, width: number, height: number, kind: string) {
  if (!(radius > 0 && pitch > 0 && unit > 0)) return 0;
  const available = Math.min(pitch, width, height);
  const growth = 1 + Math.max(0, Math.min(1, (available / unit - 40) / 100));
  const extent = kind === 'star' ? 1.38 : kind === 'heart' ? 1.22 : 1;
  return Math.min(radius * growth, available * .48 / extent);
}
export const maskTextureGapFromUi = (value: number) => -10 + Math.max(0, Math.min(100, value)) * 1.1;
export const maskTextureGapToUi = (value: number) => Math.round(Math.max(0, Math.min(100, (value + 10) / 1.1)));
