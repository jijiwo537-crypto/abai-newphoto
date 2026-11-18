/* 「對話框」分類。路徑撐滿整個框（尾巴、小圓也算在框裡），框拉多大就多大。
   'bubble'（橫橢圓）沿用原本的畫法（GridLayoutTool 的 shapePathD）；
   'bubble-v' 是同一個對話框翻成直的；其他四種在這裡畫。
   每個子路徑都同一個繞行方向，重疊的地方（尾巴接本體）才不會被挖空。 */
type Prim = { t: 'e'; cx: number; cy: number; a: number; b: number }
  | { t: 'rr'; x: number; y: number; w: number; h: number; r: number }
  | { t: 'p'; pts: [number, number][] };
/* 設計稿座標（任意單位），畫的時候量外接框再縮放到 w×h */
const cloudPrims = (cx: number, cy: number, a: number, b: number, n: number): Prim[] => [
  ...Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2; return { t: 'e' as const, cx: cx + Math.cos(t) * a * .78, cy: cy + Math.sin(t) * b * .68, a: a * .32, b: b * .38 }; }),
  { t: 'e', cx, cy, a: a * .8, b: b * .7 },
];
const DESIGNS: Record<string, Prim[]> = {
  // 圓角長方形・左下尾巴
  'bubble-rect': [{ t: 'rr', x: 20, y: 20, w: 160, h: 80, r: 18 }, { t: 'p', pts: [[45, 95], [80, 95], [40, 128]] }],
  // 膠囊形・尾巴
  'bubble-pill': [{ t: 'rr', x: 15, y: 25, w: 170, h: 74, r: 37 }, { t: 'p', pts: [[50, 92], [80, 96], [36, 124]] }],
  // 思考泡泡：大橢圓＋兩個小圓
  'bubble-think': [{ t: 'e', cx: 110, cy: 52, a: 80, b: 42 }, { t: 'e', cx: 48, cy: 104, a: 13, b: 10 }, { t: 'e', cx: 26, cy: 122, a: 7, b: 6 }],
  // 雲朵＋兩個小圓
  'bubble-cloud': [...cloudPrims(110, 55, 78, 42, 9), { t: 'e', cx: 46, cy: 110, a: 11, b: 9 }, { t: 'e', cx: 26, cy: 124, a: 6, b: 5 }],
};
export const BUBBLE_KINDS = ['bubble', 'bubble-v', 'bubble-rect', 'bubble-pill', 'bubble-think', 'bubble-cloud'];
export const isNewBubbleKind = (k?: string) => !!k && k in DESIGNS;
const bbox = (ps: Prim[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of ps) {
    if (p.t === 'e') { add(p.cx - p.a, p.cy - p.b); add(p.cx + p.a, p.cy + p.b); }
    else if (p.t === 'rr') { add(p.x, p.y); add(p.x + p.w, p.y + p.h); }
    else p.pts.forEach(([x, y]) => add(x, y));
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
};
/** 新增時的高÷寬（照設計稿的比例） */
export const bubbleRatio = (kind: string) => {
  if (kind === 'bubble') return 0.6;     // 跟照片裡那顆一樣的比例
  if (kind === 'bubble-v') return 1.9;
  const d = DESIGNS[kind]; if (!d) return 1; const b = bbox(d); return b.h / b.w;
};
export const bubblePathD = (kind: string, w: number, h: number) => {
  const ps = DESIGNS[kind]; if (!ps) return '';
  const b = bbox(ps), sx = w / b.w, sy = h / b.h;
  const X = (x: number) => (x - b.x0) * sx, Y = (y: number) => (y - b.y0) * sy;
  const f = (n: number) => String(Math.round(n * 1000) / 1000);
  let d = '';
  for (const p of ps) {
    if (p.t === 'e') {
      // 順時針：上 → 下（右半）→ 上（左半）
      const cx = X(p.cx), cy = Y(p.cy), a = p.a * sx, bb = p.b * sy;
      d += `M ${f(cx)} ${f(cy - bb)} A ${f(a)} ${f(bb)} 0 1 1 ${f(cx)} ${f(cy + bb)} A ${f(a)} ${f(bb)} 0 1 1 ${f(cx)} ${f(cy - bb)} Z `;
    } else if (p.t === 'rr') {
      // 圓角保持正圓（擠壓時不會變成橢圓角）
      const x = X(p.x), y = Y(p.y), ww = p.w * sx, hh = p.h * sy, r = Math.min(p.r * Math.min(sx, sy), ww / 2, hh / 2);
      d += `M ${f(x + r)} ${f(y)} L ${f(x + ww - r)} ${f(y)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + ww)} ${f(y + r)} L ${f(x + ww)} ${f(y + hh - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + ww - r)} ${f(y + hh)} L ${f(x + r)} ${f(y + hh)} A ${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + hh - r)} L ${f(x)} ${f(y + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z `;
    } else {
      // 多邊形一律轉成順時針
      const q = p.pts.map(([x, y]) => [X(x), Y(y)] as [number, number]);
      let area = 0; q.forEach(([x, y], i) => { const [nx, ny] = q[(i + 1) % q.length]; area += x * ny - nx * y; });
      if (area < 0) q.reverse();
      d += `M ${q.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L ')} Z `;
    }
  }
  return d.trim();
};
