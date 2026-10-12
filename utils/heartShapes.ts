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

/* ── 放射狀的膠囊：「虛線星芒」與「載入中圓圈」 ─────────────────────────
   座標在 -1..1 的單位圓裡，每一個膠囊是一圈多邊形（兩端是半圓）。
   圖形（shapePathD）與圖案（drawShapePath）都從這裡取點，所以兩邊長得一樣。 */
type Pt = [number, number];
const capsule = (theta: number, r0: number, r1: number, hw: number): Pt[] => {
  const c = Math.cos(theta), s = Math.sin(theta), pts: Pt[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) { const t = theta - Math.PI / 2 + Math.PI * i / N; pts.push([c * r1 + Math.cos(t) * hw, s * r1 + Math.sin(t) * hw]); }
  for (let i = 0; i <= N; i++) { const t = theta + Math.PI / 2 + Math.PI * i / N; pts.push([c * r0 + Math.cos(t) * hw, s * r0 + Math.sin(t) * hw]); }
  return pts;
};
/** 虛線星芒（像圖案的 ✳︎，但每一根是三段虛線）：8 根 × 3 段 */
const BURST_DASH: Pt[][] = (() => {
  const hw = 0.075, out: Pt[][] = [];
  for (let i = 0; i < 8; i++) {
    const th = -Math.PI / 2 + i * Math.PI / 4;
    for (const [a, b] of [[0.24, 0.38], [0.53, 0.66], [0.81, 1 - hw]] as const) out.push(capsule(th, a, b, hw));
  }
  return out;
})();
/** 載入中的圓圈（像 iPhone 的轉圈圈）：12 根圓頭短棒，從 12 點鐘方向開始順時針排 */
const SPINNER: Pt[][] = (() => {
  const hw = 0.085, out: Pt[][] = [];
  for (let i = 0; i < 12; i++) out.push(capsule(-Math.PI / 2 + i * Math.PI / 6, 0.5, 1 - hw, hw));
  return out;
})();
export const RADIAL_KINDS = new Set(['burst-dash', 'spinner']);
export const radialParts = (kind: string): Pt[][] => kind === 'spinner' ? SPINNER : BURST_DASH;
/** 轉圈圈每一根的濃淡：12 點鐘最淡，順時針一路變深，11 點鐘最深 */
export const spinnerAlpha = (i: number) => 0.22 + 0.78 * i / 11;
/** 某一根膠囊的 SVG 路徑（放進 cx,cy 為中心、半徑 rx,ry 的橢圓） */
export const radialPartD = (part: Pt[], cx: number, cy: number, rx: number, ry: number) =>
  'M ' + part.map(p => `${Math.round((cx + p[0] * rx) * 1000) / 1000} ${Math.round((cy + p[1] * ry) * 1000) / 1000}`).join(' L ') + ' Z';
export const radialD = (kind: string, cx: number, cy: number, rx: number, ry: number) =>
  radialParts(kind).map(p => radialPartD(p, cx, cy, rx, ry)).join(' ');
export const traceRadial = (ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number, r: number) => {
  for (const part of radialParts(kind)) {
    ctx.moveTo(cx + part[0][0] * r, cy + part[0][1] * r);
    for (const p of part.slice(1)) ctx.lineTo(cx + p[0] * r, cy + p[1] * r);
    ctx.closePath();
  }
};
