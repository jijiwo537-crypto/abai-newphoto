/** Size follows the actual lattice pitch, not the spacing slider or viewport zoom.
 * Radius/pitch/unit must be in the same logical coordinates. The circumscribed
 * bound covers hearts and stars too, leaving 4% clearance between neighbours. */
export function spacedTextureRadius(radius: number, pitch: number, unit: number, width: number, height: number, kind: string) {
  if (!(radius > 0 && pitch > 0 && unit > 0)) return 0;
  const available = Math.min(pitch, width, height);
  const growth = 1 + Math.max(0, Math.min(1, (available / unit - 40) / 100));
  const extent = kind === 'star' ? 1.38 : kind === 'heart' ? 1.22 : 1;
  return Math.min(radius * growth, available * .48 / extent);
}
export const maskTextureGapFromUi = (value: number) => -10 + Math.max(0, Math.min(100, value)) * 1.1;
export const maskTextureGapToUi = (value: number) => Math.max(0, Math.min(100, (value + 10) / 1.1));
