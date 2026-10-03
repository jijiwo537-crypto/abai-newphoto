/** Ink bounds in scene units, independent of preview zoom and pointer rate.
 * A rotated ink rectangle is conservatively enclosed, so even its corners
 * cannot touch another stamp. Manual transforms do not use this constraint. */
export type StampBounds = { x: number; y: number; w: number; h: number; size: number };
export function stampBounds(x: number, y: number, w: number, h: number, angle: number, size: number): StampBounds {
  const a = angle * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { x, y, w: w * c + h * s, h: w * s + h * c, size: Math.max(size, w, h) };
}
export function stampsHaveSafeGap(a: StampBounds, b: StampBounds): boolean {
  const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
  const dy = Math.max(0, Math.abs(a.y - b.y) - (a.h + b.h) / 2);
  return Math.hypot(dx, dy) + 1e-8 >= Math.max(a.size, b.size) / 2;
}
/** Only consecutive ink in this stroke controls cadence. Existing artwork is
 * never a placement veto. The previous centre interval is reduced by 20%. */
export function brushStepReached(a: StampBounds, b: StampBounds): boolean {
  const dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y),d=Math.hypot(dx,dy);
  if(!d)return false;
  const ux=dx/d,uy=dy/d;
  const interval=((a.w+b.w)*ux/2+(a.h+b.h)*uy/2+Math.max(a.size,b.size)/2)*.8;
  return d+1e-8>=interval;
}
