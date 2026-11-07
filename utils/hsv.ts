/* 調色盤用的 HSV ↔ HEX（h 0～360，s、v 0～100）。兩個拼圖的取色器共用 */
export const hsvToHex = (h: number, s: number, v: number) => {
  s /= 100; v /= 100;
  const f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`.toUpperCase();
};

export const hexToHsv = (hex: string) => {
  if (!hex || hex.length < 7) return { h: 0, s: 0, v: 100 };
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(max * 100) };
};
