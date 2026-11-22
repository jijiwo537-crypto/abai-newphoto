/* 「花式排列」分類：很多個小單位（預設星星）排成一個整體的貼圖。
   每一種都在一個設計框（DW×DH）裡算出每一顆的位置、大小，吊飾與星座另外有細線，
   最後合成「一條路徑」——所以填色、描邊、發光、紋理、動畫、四邊拉伸都直接沿用一般圖形的那一套，
   創意拼圖與跨頁拼圖共用。隨機的那幾種用固定種子，每次畫出來都一樣。 */

type Unit = { x: number; y: number; r: number; rot?: number };
type Line = { x1: number; y1: number; x2: number; y2: number; w: number };
type Design = { dw: number; dh: number; units: Unit[]; lines?: Line[] };

export const FANCY_KINDS = [
  'fancy-radial', 'fancy-ring', 'fancy-spiral', 'fancy-halo', 'fancy-mobile', 'fancy-heart',
  'fancy-meteor', 'fancy-wave', 'fancy-scatter', 'fancy-concentric', 'fancy-constellation', 'fancy-arch',
] as const;
export const isFancyKind = (k?: string) => !!k && k.startsWith('fancy-') && (FANCY_KINDS as readonly string[]).includes(k);

const rng = (seed: number) => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

/** 沿一條封閉曲線 pt(0..2π) 等距離取 n 個點（照參數平均取的話，彎得急的地方會擠成一團） */
const evenOnCurve = (pt: (t: number) => [number, number], n: number, offset = 0): { p: [number, number]; t: number }[] => {
  const M = 2000, acc: number[] = [0]; let prev = pt(0);
  for (let i = 1; i <= M; i++) { const q = pt(i / M * Math.PI * 2); acc.push(acc[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1])); prev = q; }
  const out: { p: [number, number]; t: number }[] = [], L = acc[M];
  for (let i = 0; i < n; i++) {
    const target = ((i + offset) / n) * L; let j = 0; while (j < M && acc[j] < target) j++;
    const t = j / M * Math.PI * 2; out.push({ p: pt(t), t });
  }
  return out;
};
const designs: Record<string, () => Design> = {
  /* 1 放射：從中心往外 10 條，越外面越大 */
  'fancy-radial': () => {
    const units: Unit[] = [];
    const rays = 10, steps = [9, 16, 24, 33, 44];
    for (let i = 0; i < rays; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / rays;
      steps.forEach((d, j) => units.push({ x: 50 + Math.cos(a) * d, y: 50 + Math.sin(a) * d, r: 2.2 + j * 1.25 }));
    }
    return { dw: 100, dh: 100, units };
  },
  /* 2 環形：一圈，大小交錯 */
  'fancy-ring': () => {
    const n = 16, units: Unit[] = [];
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / n; units.push({ x: 50 + Math.cos(a) * 41, y: 50 + Math.sin(a) * 41, r: i % 2 ? 2.9 : 5.6 }); }
    return { dw: 100, dh: 100, units };
  },
  /* 3 螺旋：從中心捲出去，越外面越大 */
  'fancy-spiral': () => {
    const n = 30, units: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), a = -Math.PI / 2 + t * Math.PI * 2 * 2.3, d = 3 + t * 42;
      units.push({ x: 50 + Math.cos(a) * d, y: 50 + Math.sin(a) * d, r: 1 + t * 5.6 });
    }
    return { dw: 100, dh: 100, units };
  },
  /* 4 光環：有透視的橢圓，後半圈（上面）比較小 */
  'fancy-halo': () => {
    const cy = 22, rx = 44, ry = 13;
    // 沿橢圓等距離排（照角度平均取的話，左右兩端會擠在一起）；後半圈（上面）比較小
    const units = evenOnCurve(t => [50 + Math.cos(t) * rx, cy + Math.sin(t) * ry], 16, 0.25)
      .map(({ p, t }) => ({ x: p[0], y: p[1], r: 2.1 + ((Math.sin(t) + 1) / 2) * 3.8 }));
    return { dw: 100, dh: 44, units };
  },
  /* 5 吊飾：隨機高度、彼此不在同一條垂直線上，每顆一條細線吊到最上面 */
  'fancy-mobile': () => {
    const R = rng(7), units: Unit[] = [], lines: Line[] = [];
    const n = 7, slot = 100 / n;
    for (let i = 0; i < n; i++) {
      const r = 3.8 + R() * 2.8, x = slot * (i + 0.5) + (R() - 0.5) * (slot - r * 2.2) * 0.6;
      const y = 30 + R() * 62;
      units.push({ x, y, r });
      lines.push({ x1: x, y1: 0, x2: x, y2: y - r * 0.95, w: 0.5 });
    }
    return { dw: 100, dh: 100, units, lines };
  },
  /* 6 心形排列：沿著愛心的輪廓 */
  'fancy-heart': () => {
    // 等距離排，而且剛好一顆在上面的凹口、一顆在下面的尖端（不會兩顆擠在一起）
    const pt = (t: number): [number, number] => [50 + 16 * Math.sin(t) ** 3 * 2.65, 47 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 2.65];
    return { dw: 100, dh: 100, units: evenOnCurve(pt, 22).map(({ p }, i) => ({ x: p[0], y: p[1], r: i % 2 ? 2.8 : 3.9 })) };
  },
  /* 7 流星雨：三串斜斜往左下，前端大、尾巴越來越小 */
  'fancy-meteor': () => {
    const units: Unit[] = [];
    const heads: [number, number, number][] = [[22, 50, 6.2], [48, 82, 5.2], [60, 34, 4.4]];
    for (const [hx, hy, hr] of heads) {
      for (let j = 0; j < 7; j++) {
        const d = j * (hr * 1.55 + 1.2 - j * 0.12);
        units.push({ x: hx + d * 0.74, y: hy - d * 0.67, r: Math.max(0.8, hr * (1 - j * 0.13)) });
      }
    }
    return { dw: 100, dh: 100, units };
  },
  /* 8 波浪：沿著波浪排，波峰波谷大、中間小 */
  'fancy-wave': () => {
    const n = 13, units: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), ph = t * Math.PI * 3;
      units.push({ x: 4 + t * 92, y: 20 + Math.sin(ph) * 13, r: 1.9 + Math.abs(Math.sin(ph)) * 2.6 });
    }
    return { dw: 100, dh: 40, units };
  },
  /* 9 灑落：從上面灑下來，上密下疏、大小隨機 */
  'fancy-scatter': () => {
    const R = rng(23), units: Unit[] = [];
    let guard = 0;
    while (units.length < 30 && guard++ < 3000) {
      const y = 4 + Math.pow(R(), 1.7) * 92, r = 1.3 + R() * 3.6 * (0.6 + y / 230), x = 4 + R() * 92;
      if (units.every(u => Math.hypot(u.x - x, u.y - y) > (u.r + r) * 1.25)) units.push({ x, y, r });
    }
    return { dw: 100, dh: 100, units };
  },
  /* 10 同心圓：三圈，外圈的比較大 */
  'fancy-concentric': () => {
    const units: Unit[] = [];
    ([[13, 8, 2.1], [28, 14, 3.1], [44, 20, 4.2]] as const).forEach(([d, n, r], ring) => {
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i + (ring % 2) * 0.5) * Math.PI * 2 / n; units.push({ x: 50 + Math.cos(a) * d, y: 50 + Math.sin(a) * d, r }); }
    });
    return { dw: 100, dh: 100, units };
  },
  /* 11 星座連線：幾顆不規則分布，用細線連起來（線不碰到星星） */
  'fancy-constellation': () => {
    const units: Unit[] = [
      { x: 10, y: 30, r: 4.2 }, { x: 28, y: 22, r: 3 }, { x: 44, y: 36, r: 3.6 }, { x: 60, y: 30, r: 5.4 },
      { x: 70, y: 52, r: 3.2 }, { x: 88, y: 58, r: 4.6 }, { x: 80, y: 80, r: 3.4 }, { x: 58, y: 74, r: 2.8 },
    ];
    const links: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 4]];
    const lines: Line[] = links.map(([a, b]) => {
      const A = units[a], B = units[b], d = Math.hypot(B.x - A.x, B.y - A.y), ux = (B.x - A.x) / d, uy = (B.y - A.y) / d;
      return { x1: A.x + ux * A.r * 1.35, y1: A.y + uy * A.r * 1.35, x2: B.x - ux * B.r * 1.35, y2: B.y - uy * B.r * 1.35, w: 0.45 };
    });
    return { dw: 100, dh: 100, units, lines };
  },
  /* 12 花環：半圓弧，兩端小、中間大（拱門） */
  'fancy-arch': () => {
    const n = 15, units: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), a = Math.PI + t * Math.PI;
      units.push({ x: 50 + Math.cos(a) * 44, y: 52 + Math.sin(a) * 44, r: 2.2 + Math.sin(t * Math.PI) * 3.8 });
    }
    return { dw: 100, dh: 56, units };
  },
};

const cache = new Map<string, Design>();
const designOf = (kind: string) => { let d = cache.get(kind); if (!d) { d = designs[kind](); cache.set(kind, d); } return d; };

/** 高度佔寬度的比例（新增時照這個比例） */
export const fancyRatio = (kind: string) => { const d = designOf(kind); return d.dh / d.dw; };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** 整個排列的路徑（w×h 的框）。小單位維持自己的比例（不會被拉成扁的），排列位置跟著框伸縮 */
export const fancyPathD = (kind: string, w: number, h: number) => {
  if (!isFancyKind(kind) || !(w > 0) || !(h > 0)) return '';
  const d = designOf(kind), sx = w / d.dw, sy = h / d.dh, s = Math.min(sx, sy);
  const out: string[] = [];
  for (const u of d.units) {
    const cx = u.x * sx, cy = u.y * sy, R = u.r * s, inner = 0.42;
    for (let i = 0; i < 10; i++) {
      const t = -Math.PI / 2 + (u.rot || 0) + i * Math.PI / 5, k = i % 2 ? inner : 1;
      out.push(`${i ? 'L' : 'M'} ${r3(cx + Math.cos(t) * R * k)} ${r3(cy + Math.sin(t) * R * k)}`);
    }
    out.push('Z');
  }
  for (const l of d.lines || []) {
    const x1 = l.x1 * sx, y1 = l.y1 * sy, x2 = l.x2 * sx, y2 = l.y2 * sy;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, hw = Math.max(0.35, l.w * s) / 2;
    const nx = -(y2 - y1) / len * hw, ny = (x2 - x1) / len * hw;
    // 繞行方向要跟星星一樣（順時針），線跟星星重疊的地方才不會被挖空
    out.push(`M ${r3(x1 - nx)} ${r3(y1 - ny)} L ${r3(x2 - nx)} ${r3(y2 - ny)} L ${r3(x2 + nx)} ${r3(y2 + ny)} L ${r3(x1 + nx)} ${r3(y1 + ny)} Z`);
  }
  return out.join(' ');
};
