/** 很暗（黑色、接近黑）的顏色：放在黑色介面上看不到邊，色票／顏色方塊改用白色細框 */
export const isDarkSwatch = (c?: string) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c || '').trim());
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 40;
};
/** 沒選中時的邊框 class：暗色用白色細框，其他照舊 */
export const swatchEdge = (c: string | undefined, normal: string) => isDarkSwatch(c) ? 'border border-white' : normal;
