/* 文字的陰影與背景（創意拼圖、跨頁拼圖的預覽與匯出共用同一支）。
   數值都跟字級等比：字放大縮小，陰影、背景跟著一起縮放。
   陰影：強度 0～100（0＝沒有陰影）、模糊 0～100、距離 0～100、角度 0～360°（0°＝往右，順時針）。
   背景：開／關、顏色；圓角色塊包住每一行字。 */
export type TextDeco = {
  shadowAmt?: number; shadowColor?: string; shadowBlur?: number; shadowDist?: number; shadowAngle?: number;
  bgOn?: boolean; bgColor?: string;
};
export const TEXT_SHADOW_DEFAULTS = { shadowColor: '#000000', shadowBlur: 30, shadowDist: 25, shadowAngle: 45 };
export const TEXT_BG_DEFAULT = '#000000';
const rgba = (hex: string, a: number) => {
  const h = hex.replace('#', ''), f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const n = parseInt(f, 16) || 0;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
};
/** 背景色塊：在目前的字型、字距下量每一行，畫一塊圓角矩形（置中在 cx、從 startY 那一行開始） */
export const paintTextBg = (ctx: CanvasRenderingContext2D, o: TextDeco, lines: string[], size: number, lineH: number, startY: number, cx = 0) => {
  if (!o.bgOn) return;
  const w = Math.max(...lines.map(l => ctx.measureText(l || ' ').width), size * .5);
  const padX = size * .38, padY = size * .2, h = (lines.length - 1) * lineH + size * 1.12;
  const x = cx - w / 2 - padX, y = startY - size * .56 - padY, W = w + padX * 2, H = h + padY * 2, r = Math.min(size * .26, H / 2);
  ctx.save();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  ctx.fillStyle = o.bgColor || TEXT_BG_DEFAULT;
  ctx.beginPath();
  if ((ctx as any).roundRect) (ctx as any).roundRect(x, y, W, H, r); else ctx.rect(x, y, W, H);
  ctx.fill();
  ctx.restore();
};
/** 陰影：用填色的字形投一次影子（字本身之後會再正常畫在上面）。
    canvas 的陰影位移、模糊是螢幕像素，不吃變換矩陣，所以照目前矩陣的倍率換算；
    方向固定在畫面上（像同一盞燈），字旋轉時影子方向不跟著轉。 */
export const paintTextShadow = (ctx: CanvasRenderingContext2D, o: TextDeco, size: number, drawFill: () => void) => {
  const amt = Math.max(0, Math.min(100, o.shadowAmt || 0)) / 100;
  if (amt <= 0) return;
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const dist = (o.shadowDist ?? TEXT_SHADOW_DEFAULTS.shadowDist) / 100 * size * .3 * k;
  const ang = (o.shadowAngle ?? TEXT_SHADOW_DEFAULTS.shadowAngle) * Math.PI / 180;
  ctx.save();
  ctx.shadowColor = rgba(o.shadowColor || TEXT_SHADOW_DEFAULTS.shadowColor, amt);
  ctx.shadowBlur = (o.shadowBlur ?? TEXT_SHADOW_DEFAULTS.shadowBlur) / 100 * size * .45 * k;
  // 字本身畫在很遠的地方，只讓影子位移回來：影子不會被字的半透明邊緣蓋出一圈雜色
  const far = 100000;
  ctx.shadowOffsetX = Math.cos(ang) * dist + far * m.a; ctx.shadowOffsetY = Math.sin(ang) * dist + far * m.b;
  ctx.translate(-far, 0);
  drawFill();
  ctx.restore();
};
