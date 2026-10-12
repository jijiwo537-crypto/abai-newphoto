/* 愛心與六角星的外形 —— 圖形（shapePathD）與圖案（drawShapePath）共用同一份座標，
   按鈕上的小圖也是拿這裡畫的，所以「按鈕長怎樣、生成出來就長怎樣」。
   座標都在單位框 0..1 裡（x 向右、y 向下），每一段是一條三次貝茲 [c1x,c1y,c2x,c2y,x,y]。 */
type Seg = [number, number, number, number, number, number];
export type UnitShape = { start: [number, number]; segs: Seg[]; aspect: number };

/** 主人提供的愛心圖：圓潤的兩瓣、淺淺的凹口、尖底。寬:高 ≈ 1.074 */
export const HEART_MAIN: UnitShape = {
  aspect: 1.074,
  start: [0.5, 0.16],
  segs: [
    [0.56, 0.05, 0.64, 0, 0.74, 0],
    [0.89, 0, 1, 0.12, 1, 0.29],
    [1, 0.48, 0.72, 0.78, 0.5, 1],
    [0.28, 0.78, 0, 0.48, 0, 0.29],
    [0, 0.12, 0.11, 0, 0.26, 0],
    [0.36, 0, 0.44, 0.05, 0.5, 0.16],
  ],
};

/** 以前圖案按鈕上那顆愛心（lucide 的 Heart 圖示）的外形。寬:高 ≈ 1.11 */
const L = (x: number, y: number): [number, number] => [(x - 2) / 20, (y - 3) / 18];
const c = (a: number, b: number, d: number, e: number, f: number, g: number): Seg => [...L(a, b), ...L(d, e), ...L(f, g)] as Seg;
export const HEART_ICON: UnitShape = {
  aspect: 20 / 18,
  start: L(19, 14),
  segs: [
    c(20.49, 12.54, 22, 10.79, 22, 8.5),
    c(22, 5.462, 19.538, 3, 16.5, 3),
    c(14.74, 3, 13.5, 3.5, 12, 5),
    c(10.5, 3.5, 9.26, 3, 7.5, 3),
    c(4.462, 3, 2, 5.462, 2, 8.5),
    c(2, 10.8, 3.5, 12.55, 5, 14),
    c(5, 14, 12, 21, 12, 21),
    c(12, 21, 19, 14, 19, 14),
  ],
};

/** 把單位外形放進 (x, y, w, h) 這個框。stretch：撐滿整個框（圖形會跟著四邊擠壓變形）；
    否則保持原本的寬高比、置中（圖案）。 */
const fit = (s: UnitShape, x: number, y: number, w: number, h: number, stretch = false) => {
  let fw = w, fh = stretch ? h : w / s.aspect;
  if (!stretch && fh > h) { fh = h; fw = h * s.aspect; }
  const ox = x + (w - fw) / 2, oy = y + (h - fh) / 2;
  return (u: number, v: number): [number, number] => [ox + u * fw, oy + v * fh];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** SVG 路徑字串（給 shapePathD／按鈕小圖） */
export const unitShapeD = (s: UnitShape, x: number, y: number, w: number, h: number, stretch = false) => {
  const m = fit(s, x, y, w, h, stretch), P = (u: number, v: number) => m(u, v).map(r3).join(' ');
  return `M ${P(...s.start)} ` + s.segs.map(g => `C ${P(g[0], g[1])} ${P(g[2], g[3])} ${P(g[4], g[5])}`).join(' ') + ' Z';
};
/** 直接畫在 canvas 目前的路徑上（給 drawShapePath） */
export const traceUnitShape = (ctx: CanvasRenderingContext2D, s: UnitShape, x: number, y: number, w: number, h: number) => {
  const m = fit(s, x, y, w, h);
  ctx.moveTo(...m(...s.start));
  for (const g of s.segs) ctx.bezierCurveTo(...m(g[0], g[1]), ...m(g[2], g[3]), ...m(g[4], g[5]));
};
/** 六角星：12 個頂點，尖角朝上。內圈半徑 0.45（比兩個正三角形疊起來的 1/√3 小），尖角比較細、比較尖 */
export const hexStarPoints = (cx: number, cy: number, rx: number, ry: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const t = -Math.PI / 2 + i * Math.PI / 6, k = i % 2 ? 0.45 : 1;
    pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k]);
  }
  return pts;
};
