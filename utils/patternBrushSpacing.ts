/**
 * 場景單位的線條範圍，跟預覽縮放和指標頻率無關。旋轉過的線條矩形用保守的外框包住，
 * 連轉角都碰不到另一個印記。手動變形不受這個限制
 */
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
/**
 * 只有這一筆裡連續的線條決定節奏，現有的作品絕不會否決擺放位置。中心間隔比之前縮短 20%
 */
export function brushStepReached(a: StampBounds, b: StampBounds): boolean {
  const dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y),d=Math.hypot(dx,dy);
  if(!d)return false;
  const ux=dx/d,uy=dy/d;
  const interval=((a.w+b.w)*ux/2+(a.h+b.h)*uy/2+Math.max(a.size,b.size)/2)*.8;
  return d+1e-8>=interval;
}
