/* 紋理的顏色跟著物件本身的顏色走（沒有手動選過紋理顏色時）：
   ‧ 點點／星星／愛心這類紋理：物件顏色的明度（HSB 的 B）≥ 50 → 明度減半；< 50 → 明度 +50。
     例：A8A8E6（明度 90）→ 545473（明度 45）。
   ‧ 條紋、格紋：第一個顏色＝物件本身的顏色。 */

const parse = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** 點點類紋理的顏色 */
export const texDotColorFor = (color: string): string => {
  const c = parse(color); if (!c) return color;
  const [r, g, b] = c, v = Math.max(r, g, b) / 255;
  if (v >= 0.5) return toHex(r * 0.5, g * 0.5, b * 0.5);
  const target = Math.min(1, v + 0.5);
  if (v <= 0) { const t = target * 255; return toHex(t, t, t); }
  const k = target / v;
  return toHex(r * k, g * k, b * k);
};
/** 條紋、格紋的第一個顏色 */
export const texStripeColorFor = (color: string): string => (parse(color) ? toHex(...parse(color)!) : color);
