import { fancyMotionUnitsTag, ctxOf as motionCtxOf } from './fancyMotion';
/* 「花式排列」分類：很多個小單位（預設星星）排成一個整體的貼圖。
   每一種都在一個設計框（DW×DH）裡算出每一顆的位置、大小，吊飾與星座另外有細線，
   最後合成「一條路徑」——所以填色、描邊、發光、紋理、動畫、四邊拉伸都直接沿用一般圖形的那一套，
   創意拼圖與跨頁拼圖共用。隨機的那幾種用固定種子，每次畫出來都一樣。 */

type Unit = { x: number; y: number; r: number; rot?: number };
type Line = { x1: number; y1: number; x2: number; y2: number; w: number };
type Design = { dw: number; dh: number; units: Unit[]; lines?: Line[] };

export const FANCY_KINDS = [
  'fancy-radial', 'fancy-ring', 'fancy-spiral', 'fancy-halo', 'fancy-mobile', 'fancy-swirl3',
  'fancy-grid', 'fancy-polka', 'fancy-boxrandom', 'fancy-concentric', 'fancy-constellation', 'fancy-wand',
] as const;
/** 從選單拿掉的舊排列：已經放在作品裡的照樣畫得出來 */
const FANCY_LEGACY = ['fancy-heart', 'fancy-wave', 'fancy-scatter', 'fancy-arch', 'fancy-starstar', 'fancy-crescent', 'fancy-flower', 'fancy-galaxy', 'fancy-meteor', 'fancy-sparkle'];
/** kind 可以帶隨機種子：'fancy-mobile@123'（吊飾的「隨機排列」，見 scoreKindOf） */
const baseOf = (k: string) => k.split('!')[0].split('@')[0];   // '!' 後面是動畫進度（見 utils/fancyMotion）
export const isFancyKind = (k?: string) => !!k && k.startsWith('fancy-') && ((FANCY_KINDS as readonly string[]).includes(baseOf(k)) || FANCY_LEGACY.includes(baseOf(k)));
/** 可以按「隨機排列」的花式排列 */
export const fancyCanRandom = (k?: string) => !!k && (baseOf(k) === 'fancy-mobile' || baseOf(k) === 'fancy-boxrandom' || baseOf(k) === 'fancy-wand');
/** 可以調「數量」「間距」的花式排列 */
export const fancyHasParams = (k?: string) => !!k && ['fancy-grid', 'fancy-polka', 'fancy-boxrandom', 'fancy-wand'].includes(baseOf(k));
/** 選中框固定是整個貼圖框（不貼著星星量）：隨機或調數量間距時星星位置一直變，框不能跟著變 */
export const fancyFixedFrame = (k?: string) => fancyCanRandom(k) || fancyHasParams(k);
/** 數量、間距的預設值與範圍（滑桿 UI 值） */
export const FANCY_PARAM: Record<string, { count: [number, number, number]; gap: number }> = {
  'fancy-grid': { count: [2, 10, 5], gap: 54 },        // 每排幾顆
  'fancy-polka': { count: [2, 10, 6], gap: 52 },       // 幾排
  'fancy-boxrandom': { count: [5, 60, 30], gap: 35 },
  'fancy-wand': { count: [0, 100, 70], gap: 1 },       // 0＝14 顆、100＝42 顆（gap 不用，填 1 讓打包後不會是 0）  // 總共幾顆
};
/** 數量、間距、隨機種子打包成一個數字（畫圖時接在 kind 後面，見 scoreKindOf） */
/* 方形隨機另外還有「隨機大小」「大小」兩個值：用第二種打包格式（加 2e15 當記號），
   舊格式（沒有這兩個值）的作品照舊畫，不會變 */
const V2 = 2e15;
export const FANCY_SIZE_DEFAULT = 20, FANCY_JIT_DEFAULT = 0;
/** 「隨機大小」滑桿的預設值：魔法棒的 50＝原本的大小差異（0＝大小一致、100＝差異加倍）；其他照舊 0 */
export const fancyJitDefault = (kind?: string) => kind && kind.split('@')[0] === 'fancy-wand' ? 50 : FANCY_JIT_DEFAULT;
/** 有「隨機大小」滑桿的花式排列（要用第二種打包格式存它） */
export const fancyHasJit = (kind?: string) => !!kind && ['fancy-boxrandom', 'fancy-wand'].includes(kind.split('@')[0]);
export const fancyPack = (seed: number, count: number, gap: number, extra?: { jit: number; size: number }) => extra
  ? V2 + (Math.max(0, Math.floor(seed)) % 1e6) * 1e9 + Math.round(extra.size) * 1e6 + Math.round(count) * 1000 + Math.round(extra.jit)
  : (Math.max(0, Math.floor(seed)) % 1e6) * 1e6 + Math.round(count) * 1000 + Math.round(gap);
const unpack = (kind: string, v: number): { seed: number; count: number; gap: number; v2?: boolean; jit?: number; size?: number } => {
  const def = FANCY_PARAM[kind];
  if (def && v >= V2) {
    const w = v - V2;
    return { seed: Math.floor(w / 1e9), size: Math.floor(w / 1e6) % 1000, count: Math.floor(w / 1000) % 1000, jit: w % 1000, gap: def.gap, v2: true };
  }
  if (!v || !def) return { seed: v, count: def?.count[2] ?? 0, gap: def?.gap ?? 0, v2: !v };
  const count = Math.floor(v / 1000) % 1000, gap = v % 1000;
  // 舊版「隨機排列」存的是單純的亂數種子（沒有打包數量、間距）：照舊當種子用，數量間距用預設
  if (count < def.count[0] || count > def.count[1] || gap > 100) return { seed: v, count: kind === 'fancy-boxrandom' ? 20 : def.count[2], gap: def.gap };   // 舊作品：方形隨機當時預設 20 顆
  return { seed: Math.floor(v / 1e6), count, gap };
};

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
/** 沿一條折線（封閉）等距離取 n 個點 */
const evenOnPoly = (pts: [number, number][], n: number, offset = 0): [number, number][] => {
  const segs = pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as const);
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])), L = lens.reduce((x, y) => x + y, 0);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let d = ((i + offset) / n) * L, k = 0;
    while (k < segs.length - 1 && d > lens[k]) { d -= lens[k]; k++; }
    const [a, b] = segs[k], t = lens[k] ? d / lens[k] : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
};
/** 魔法棒的預設排列（沒按過隨機時、面板按鈕的圖示）：試了多組、挑分布最均勻、開頭最乾淨的一組 */
const WAND_DEFAULT_SEED = 101;
const designs: Record<string, (seed: number) => Design> = {
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
    /* 沿橢圓等距離排，而且左右對稱（左右兩端各剛好一顆、上下正中間各一顆）：
       以前起點偏了四分之一格，左右兩邊排得不一樣，看起來歪歪的。
       前面（下）大、後面（上）小，大小照前後深度平滑過渡 —— 有透視感 */
    const units: Unit[] = evenOnCurve(t => [50 + Math.cos(t) * rx, cy + Math.sin(t) * ry], 16, 0)
      .map(({ p, t }) => ({ x: p[0], y: p[1], r: 1.9 + ((Math.sin(t) + 1) / 2) * 3.8 }));
    return { dw: 100, dh: 44, units };
  },
  /* 5 吊飾：隨機高度、彼此不在同一條垂直線上，每顆一條細線吊到最上面 */
  'fancy-mobile': (seed) => {
    const R = rng(seed || 7), units: Unit[] = [], lines: Line[] = [];
    const n = 7, slot = 100 / n;
    for (let i = 0; i < n; i++) {
      const r = 3.8 + R() * 2.8, x = slot * (i + 0.5) + (R() - 0.5) * (slot - r * 2.2) * 0.6;
      const y = 30 + R() * 62;
      units.push({ x, y, r });
      lines.push({ x1: x, y1: 0, x2: x, y2: y, w: 0.5 });   // 線一路連到星星中心
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
    // 一顆大彗星：頭在左下，三條尾巴往右上拖、微微往外散開；越往尾端越小、間距越大
    const hx = 20, hy = 80, units: Unit[] = [{ x: hx, y: hy, r: 8 }];
    const dir = -Math.PI / 4;                                    // 往右上
    const ux = Math.cos(dir), uy = Math.sin(dir), px = -uy, py = ux;   // 前進方向、側向
    for (const [side, len, size] of [[-1, 0.92, 0.85], [0, 1.08, 1], [1, 0.92, 0.85]] as const) {
      let d = side ? 14 : 13;
      for (let j = 0; j < 7; j++) {
        const spread = side * (2.5 + d * 0.2 + (d / 70) ** 2 * 6);   // 從頭後面就分開，越往後散得越開（微彎）
        units.push({ x: hx + ux * d * len + px * spread, y: hy + uy * d * len + py * spread, r: Math.max(1, 4.2 * size * Math.pow(0.8, j)) });
        d += 7.5 + j * 1.5;
      }
    }
    units.push({ x: 9, y: 74, r: 1.5 }, { x: 27, y: 93, r: 1.3 }, { x: 8, y: 91, r: 1.1 });   // 頭旁邊的小火花
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
  /* 星中星：小星星沿著一顆大星星的輪廓排，五個尖角那顆比較大 */
  'fancy-starstar': () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) { const t = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? 0.44 : 1; pts.push([50 + Math.cos(t) * 46 * k, 53 + Math.sin(t) * 46 * k]); }
    const tips = pts.filter((_, i) => i % 2 === 0);
    // 40 顆＝每條邊 4 顆，剛好有一顆落在每個尖角與內凹角（不會兩顆擠在角旁邊）
    const units: Unit[] = evenOnPoly(pts, 40).map(([x, y]) => {
      const nearTip = tips.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 1);
      return { x, y, r: nearTip ? 4.6 : 2.7 };
    });
    return { dw: 100, dh: 100, units };
  },
  /* 月牙：彎月輪廓，中間粗的地方星星大、兩端尖的地方小 */
  'fancy-crescent': () => {
    const units: Unit[] = [];
    const cx = 46, cy = 50, R = 44, ix = 64, iR = 36;   // 外圓、往右偏的內圓
    // 外弧：開口朝右（兩個交點之間）
    const meet = Math.acos((R * R - iR * iR + (ix - cx) ** 2) / (2 * R * (ix - cx)));   // 兩圓交點對外圓圓心的角度
    const n1 = 17;
    for (let i = 0; i < n1; i++) { const a = meet + (i + 0.5) / n1 * (Math.PI * 2 - meet * 2), th = Math.sin((i + 0.5) / n1 * Math.PI);
      units.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, r: 1.6 + th * 3.6 }); }
    // 內弧（內圓在外圓裡面的那一段）
    const meetI = Math.PI - Math.acos((iR * iR - R * R + (ix - cx) ** 2) / (2 * iR * (ix - cx)));
    const n2 = 11;
    for (let i = 0; i < n2; i++) { const a = Math.PI - meetI + (i + 0.5) / n2 * meetI * 2, th = Math.sin((i + 0.5) / n2 * Math.PI);
      units.push({ x: ix + Math.cos(a) * iR, y: cy + Math.sin(a) * iR, r: 1.3 + th * 1.8 }); }
    return { dw: 100, dh: 100, units };
  },
  /* 花瓣：六片花瓣的曲線，花瓣尖端大、靠中心小，正中間一顆 */
  'fancy-flower': () => {
    const pt = (t: number): [number, number] => { const r = 44 * Math.abs(Math.cos(3 * t)); return [50 + Math.cos(t) * r, 50 + Math.sin(t) * r]; };
    const units: Unit[] = evenOnCurve(pt, 42, 0.5).map(({ p }) => {
      const d = Math.hypot(p[0] - 50, p[1] - 50);
      return d < 15 ? null : { x: p[0], y: p[1], r: 1.4 + (d / 44) * 3.4 };
    }).filter(Boolean) as Unit[];
    units.push({ x: 50, y: 50, r: 5.2 });
    return { dw: 100, dh: 100, units };
  },
  /* 銀河：兩條旋臂從中心旋出，越外越大；周圍點綴小星星 */
  'fancy-galaxy': () => {
    const R = rng(41), units: Unit[] = [{ x: 50, y: 50, r: 6 }];
    for (const arm of [0, Math.PI]) {
      for (let i = 0; i < 12; i++) {
        const t = (i + 1) / 12, a = arm + t * Math.PI * 1.35, d = 7 + t * 38;
        units.push({ x: 50 + Math.cos(a) * d, y: 50 + Math.sin(a) * d * 0.82, r: 1.4 + t * 3.3 });
        if (i % 2 === 1) { const off = (R() - 0.5) * 9, a2 = a + (R() - 0.5) * 0.35; units.push({ x: 50 + Math.cos(a2) * (d + off), y: 50 + Math.sin(a2) * (d + off) * 0.82, r: 0.9 + R() * 1.1 }); }
      }
    }
    return { dw: 100, dh: 100, units };
  },
  /* 三臂漩渦：三條旋臂從中心轉出去，越外越大 */
  'fancy-swirl3': () => {
    const units: Unit[] = [{ x: 50, y: 50, r: 4.5 }];
    for (let arm = 0; arm < 3; arm++) for (let i = 1; i <= 9; i++) {
      const t = i / 9, a = arm * Math.PI * 2 / 3 + t * Math.PI * 1.15, d = 6 + t * 39;
      units.push({ x: 50 + Math.cos(a) * d, y: 50 + Math.sin(a) * d, r: 1.6 + t * 4 });
    }
    return { dw: 100, dh: 100, units };
  },
  /* 方形平均排列：5×5 整齊排，大小一樣 */
  'fancy-grid': (v) => {
    const { count: n, gap } = unpack('fancy-grid', v), cell = 100 / n, r = cell * 0.5 * (1 - gap / 100);
    const units: Unit[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) units.push({ x: cell * (i + 0.5), y: cell * (j + 0.5), r: Math.max(0.4, r) });
    return { dw: 100, dh: 100, units };
  },
  /* 方形隨機排列：方形裡隨機分布、大小不一、互不重疊（「隨機排列」換一組） */
  'fancy-boxrandom': (v) => {
    const { seed, count, gap, v2, jit = FANCY_JIT_DEFAULT, size = FANCY_SIZE_DEFAULT } = unpack('fancy-boxrandom', v);
    if (v2) {
      /* 新版：「最佳候選」取點 —— 每顆都從幾個候選位置裡挑離其他星星、離邊最遠的，
         分布比較平均、四個角也有星星，不會一團一團、缺角。
         隨機大小 0＝全部一樣大；大小 50＝原本大小 */
      const R = rng(seed || 9001), units: Unit[] = [];   // 預設（圖標）用 9001 這一組
      const cell = 100 / Math.sqrt(Math.max(1, count)), base = cell * 0.24, m = base * 1.2;
      /* 先沿著四條邊排一圈（四個角各一顆、每條邊平均分），看得出是正方形；
         邊上的星星只沿著邊稍微錯開一點，不會離開那條邊 */
      const per = Math.max(2, Math.round(Math.sqrt(count) * 0.8)), lo = m, hi = 100 - m, step = (hi - lo) / (per - 1);
      const edge: [number, number][] = [];
      if (!seed) for (let k = 0; k < per - 1; k++) {   // 有隨機種子時不碰亂數，結果跟以前一樣
        const a = lo + step * k, jit = k === 0 ? 0 : (R() - 0.5) * step * 0.3;
        edge.push([a + jit, lo], [hi, a + jit], [100 - a - jit, hi], [lo, 100 - a - jit]);
      }
      const sizeOf = () => base * (1 + (R() * 2 - 1) * 0.65 * Math.min(100, jit) / 100) * Math.pow(2, (size - 50) / 40);
      // 只有預設（圖標、第一次加進來、還沒按過隨機排列）才先排四邊；按過「隨機排列」的照原本的方式
      if (!seed) for (const [x, y] of edge.slice(0, count)) units.push({ x, y, r: sizeOf() });
      for (let i = units.length; i < count; i++) {
        let best: [number, number] = [50, 50], bestD = -1;
        for (let c = 0; c < 30; c++) {
          const pad = seed ? 0 : cell * 0.55, x = m + pad + R() * (100 - m * 2 - pad * 2), y = m + pad + R() * (100 - m * 2 - pad * 2);
          let d = Math.min(x - m, 100 - m - x, y - m, 100 - m - y) * 2 + cell * 0.5;
          for (const u of units) d = Math.min(d, Math.hypot(u.x - x, u.y - y));
          if (d > bestD) { bestD = d; best = [x, y]; }
        }
        units.push({ x: best[0], y: best[1], r: sizeOf() });
      }
      return { dw: 100, dh: 100, units };
    }
    const R = rng(seed || 11), units: Unit[] = [], far = 1 + gap / 100;   // 間距：星星之間至少隔幾倍半徑
    const scale = Math.min(1, Math.sqrt(20 / Math.max(1, count)));          // 顆數多時星星跟著變小，才排得進去
    let guard = 0;
    while (units.length < count && guard++ < 8000) {
      const r = (2 + R() * 3.6) * scale, x = r + R() * (100 - r * 2), y = r + R() * (100 - r * 2);
      if (units.every(u => Math.hypot(u.x - x, u.y - y) > (u.r + r) * far)) units.push({ x, y, r });
    }
    return { dw: 100, dh: 100, units };
  },
  /* 點點紋理排法：跟紋理裡的點點一樣，一排一排交錯半格（波卡圓點），大小一樣 */
  'fancy-polka': (v) => {
    const { count: rows, gap } = unpack('fancy-polka', v), cell = 100 / rows, r = cell * 0.5 * (1 - gap / 100);
    const units: Unit[] = [];
    for (let j = 0; j < rows; j++) {
      const odd = j % 2 === 1, n = odd ? rows - 1 : rows;
      for (let i = 0; i < n; i++) units.push({ x: cell * (i + 0.5) + (odd ? cell / 2 : 0), y: cell * (j + 0.5), r: Math.max(0.4, r) });
    }
    return { dw: 100, dh: 100, units };
  },
  /* 十字閃光：中心一顆大星，上下左右四條長光芒、斜角四條短光芒，越外越小 */
  'fancy-sparkle': () => {
    const units: Unit[] = [{ x: 50, y: 50, r: 7 }];
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; [13, 22, 30, 37, 43].forEach((d, j) => units.push({ x: 50 + Math.cos(a) * d, y: 50 + Math.sin(a) * d, r: 4.6 - j * 0.8 })); }
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; [12, 19, 25].forEach((d, j) => units.push({ x: 50 + Math.cos(a) * d, y: 50 + Math.sin(a) * d, r: 3 - j * 0.7 })); }
    return { dw: 100, dh: 100, units };
  },
  /* 魔法棒：在固定的方框裡，從左上到右下散落星星，左上少、越往右下越多、散開的範圍越大 */
  'fancy-wand': (v) => {
    /* 先排出完整的 42 顆，數量調少時照「從左上到右下」的順序平均挑掉 ——
       剩下的還是從頭到尾一整條（頭尾一定留），越往右下越密的樣子也不變。
       滑桿 0～100：0＝14 顆（再少就看不出形狀），100＝42 顆 */
    /* 隨機排列：有種子就用種子排（星星的位置、大小都換一組，從左上到右下、越往右下越多越散的樣子不變）。
       沒有種子＝預設那一組（WAND_DEFAULT_SEED，面板上的按鈕圖示也是這一組） */
    const { seed, count, jit = 50 } = unpack('fancy-wand', v);
    const jk = Math.max(0, Math.min(100, jit)) / 50;   // 隨機大小：1＝原本的差異
    const R = rng(seed || WAND_DEFAULT_SEED), units: (Unit & { t: number; big?: boolean })[] = [];
    const total = Math.round(14 + 28 * Math.max(0, Math.min(100, count)) / 100);
    /* 最左上一定是單獨一顆（之後的星星離它有一段距離才開始），從它開始一路往右下散開 */
    units.push({ x: 5, y: 5, r: 1.35, t: 0 });
    /* 分層排：把「從左上到右下」切成 41 段，每一段各放一顆（段內位置隨機）——
       密度照 t 的平方根分配（越往右下越密），但每一段一定有星星，不會有一大塊空著。
       側向的偏移左右交錯、再加一點隨機，兩側也不會整片空掉 */
    const N = 41;
    for (let i = 0; i < N; i++) {
      let placed = false;
      for (let tries = 0; tries < 60 && !placed; tries++) {
        const t = Math.pow((i + 0.15 + R() * 0.7) / N, 0.68);   // 越往右下越密；開頭不留一大段空白
        const spread = 1.5 + t * 19;
        const along = 9 + t * 86 + (R() - 0.5) * 2;
        const side = ((i % 2 ? 1 : -1) * (0.25 + R() * 0.75)) * spread;
        const x = along + side * 0.7071, y = along - side * 0.7071;
        /* 大小：亂數用法跟原本一樣（位置不變），只是差異的幅度照「隨機大小」縮放 */
        const range = 1.4 + t * 2.6, mid = 0.9 + range / 2;
        let r = Math.max(0.6, mid + (R() - 0.5) * range * jk);
        /* 大的星星不要擠在一起：附近（12 以內）已經有大星星的話，這一顆改成小的 */
        const big = (k: number, tt: number) => k > 0.9 + (1.4 + tt * 2.6) * 0.72;
        if (big(r, t) && units.some(u => u.big && Math.hypot(u.x - x, u.y - y) < 12)) r = Math.max(0.6, mid - range * 0.22 * Math.max(0.5, jk));
        if (x < r || y < r || x > 100 - r || y > 100 - r) continue;
        if (units.every(u => Math.hypot(u.x - x, u.y - y) > (u.r + r) * 1.25)) { units.push({ x, y, r, t: x + y, big: big(r, t) }); placed = true; }
      }
    }
    const sorted = [...units].sort((a, b) => a.t - b.t), n = sorted.length, k = Math.min(n, total);
    const keep = k >= n ? sorted : Array.from({ length: k }, (_, i) => sorted[Math.round(i * (n - 1) / Math.max(1, k - 1))]);
    return { dw: 100, dh: 100, units: keep.map(({ x, y, r }) => ({ x, y, r })) };
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
const designOf = (kind: string) => { let d = cache.get(kind); if (!d) { const [b, sd] = kind.split('@'); d = designs[b](Number(sd) || 0); cache.set(kind, d); if (cache.size > 300) cache.clear(); } return d; };

/** 高度佔寬度的比例（新增時照這個比例） */
export const fancyRatio = (kind: string) => { const d = designOf(kind); return d.dh / d.dw; };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** 整個排列的路徑（w×h 的框）。小單位維持自己的比例（不會被拉成扁的），排列位置跟著框伸縮 */
/* 方形平均、點點紋理：跟網格一樣 —— 等比例縮放時整組一起放大縮小；四邊擠壓（基準不變）時星星大小不變、顆數變多變少。
   gbw/gbh＝「基準」大小（等比例縮放會跟著變，四邊擠壓時不變），星星大小照基準算，顆數照實際寬高排 */
const latticeDesign = (kind: string, w: number, h: number, gbw: number, gbh: number): Design => {
  const b = kind.split('@')[0], { count } = unpack(b, Number(kind.split('@')[1]) || 0);
  const cell = Math.min(gbw, gbh) / Math.max(1, count), r = cell * 0.5 * (1 - (b === 'fancy-polka' ? 0.52 : 0.54));
  /* 間距固定＝一格（跟網格一樣），放得下幾格就排幾格、整組置中。
     不把間距撐開去填滿 —— 拖的時候星星不會每一格都被重新拉開，不會抖 */
  const cols = Math.max(1, Math.floor(w / cell + 1e-6)), rows = Math.max(1, Math.floor(h / cell + 1e-6));
  const ox = (w - cols * cell) / 2, oy = (h - rows * cell) / 2, units: Unit[] = [];
  for (let j = 0; j < rows; j++) {
    const odd = b === 'fancy-polka' && j % 2 === 1, n = odd ? cols - 1 : cols;
    for (let i = 0; i < n; i++) units.push({ x: ox + cell * (i + 0.5) + (odd ? cell / 2 : 0), y: oy + cell * (j + 0.5), r });
  }
  return { dw: w, dh: h, units };
};
/** 四邊擠壓時框的大小一格一格跳（一格＝一顆星的位置）：方形平均、點點紋理、吊飾（左右）。
    框剛好是整數格，星星就不會在拖的時候一直滑來滑去（抖），只會在邊上多一顆、少一顆 */
export const fancyStretchSize = (kind: string | undefined, size: number, bw: number, bh: number, horizontal: boolean) => {
  const b = (kind || '').split('@')[0];
  let cell = 0;
  if (b === 'fancy-grid' || b === 'fancy-polka') cell = Math.min(bw, bh) / Math.max(1, unpack(b, Number((kind || '').split('@')[1]) || 0).count);
  else if (b === 'fancy-mobile' && horizontal) cell = bw / 7;
  if (!(cell > 0)) return size;
  return Math.max(cell, Math.round(size / cell) * cell);
};
/* 拖拉擠壓時同一個尺寸會被要好幾次（畫本體、描邊、發光…）：結果記起來，不重算 */
const pathMemo = new Map<string, string>();
export const fancyPathD = (kind: string, w: number, h: number, gbw = w, gbh = h) => {
  const key = kind + '|' + w + '|' + h + '|' + gbw + '|' + gbh, hit = pathMemo.get(key);
  if (hit !== undefined) return hit;
  const v = fancyPathD0(kind, w, h, gbw, gbh);
  pathMemo.set(key, v); if (pathMemo.size > 64) pathMemo.delete(pathMemo.keys().next().value!);
  return v;
};
/* 吊飾：左右拉寬時多掛幾串（每串的寬度、星星大小照沒擠壓過的框），不是把間距拉開。
   沒擠壓時（寬＝基準）剛好 7 串，跟原本一模一樣 */
const mobileDesign = (kind: string, w: number, h: number, gbw: number, gbh: number): Design => {
  const sc = Math.min(gbw, gbh) / 100, slot = gbw / 7;
  const n = Math.max(1, Math.floor(w / slot + 1e-6)), ox = (w - n * slot) / 2;
  const R = rng(Number(kind.split('@')[1]) || 7), units: Unit[] = [], lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const r = (3.8 + R() * 2.8) * sc, x = ox + slot * (i + 0.5) + (R() - 0.5) * (slot - r * 2.2) * 0.6;
    const y = (30 + R() * 62) / 100 * h;
    units.push({ x, y, r });
    lines.push({ x1: x, y1: 0, x2: x, y2: y, w: 0.5 * sc });   // 線一路連到星星中心
  }
  return { dw: w, dh: h, units, lines };
};
/** 每一顆星星、每一條線換算成實際像素（給「一顆一顆分開動」的動畫用；畫成路徑也是吃這一份） */
export type FancyStar = { x: number; y: number; r: number; rot: number };
export type FancyLine = { x1: number; y1: number; x2: number; y2: number; w: number };
export const fancyGeometry = (kind: string, w: number, h: number, gbw = w, gbh = h): { stars: FancyStar[]; lines: FancyLine[] } => {
  if (!isFancyKind(kind) || !(w > 0) || !(h > 0)) return { stars: [], lines: [] };
  const mobile = kind.split('@')[0] === 'fancy-mobile', lattice = mobile || ['fancy-grid', 'fancy-polka'].includes(kind.split('@')[0]);
  const d = mobile ? mobileDesign(kind, w, h, Math.max(1, gbw), Math.max(1, gbh))
    : lattice ? latticeDesign(kind, w, h, Math.max(1, gbw), Math.max(1, gbh)) : designOf(kind), sx = w / d.dw, sy = h / d.dh, s = lattice ? 1 : Math.min(sx, sy);
  return {
    stars: d.units.map(u => ({ x: u.x * sx, y: u.y * sy, r: u.r * s, rot: u.rot || 0 })),
    lines: (d.lines || []).map(l => ({ x1: l.x1 * sx, y1: l.y1 * sy, x2: l.x2 * sx, y2: l.y2 * sy, w: Math.max(0.35, l.w * s) })),
  };
};
/** 一顆五角星的路徑字串（內圈 0.42） */
export const fancyStarD = (cx: number, cy: number, R: number, rot = 0) => {
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    const t = -Math.PI / 2 + rot + i * Math.PI / 5, k = i % 2 ? 0.42 : 1;
    out.push(`${i ? 'L' : 'M'} ${r3(cx + Math.cos(t) * R * k)} ${r3(cy + Math.sin(t) * R * k)}`);
  }
  return out.join(' ') + ' Z';
};
/** 多邊形照 0～w、0～h 的框裁切（Sutherland–Hodgman） */
const clipRect = (pts: [number, number][], w: number, h: number, topOnly = false): [number, number][] => {
  const edge = (P: [number, number][], inside: (p: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => {
    const out: [number, number][] = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    return out;
  };
  const lerpX = (a: [number, number], b: [number, number], x: number): [number, number] => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1e-9)];
  const lerpY = (a: [number, number], b: [number, number], y: number): [number, number] => [a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1e-9), y];
  // 吊飾（topOnly）：只切掉框上面（還沒掉下來的）；左右、下面超出去的照畫
  let P = edge(pts, p => p[1] >= 0, (a, b) => lerpY(a, b, 0));
  if (topOnly) return P;
  if (P.length) P = edge(P, p => p[0] >= 0, (a, b) => lerpX(a, b, 0));
  if (P.length) P = edge(P, p => p[0] <= w, (a, b) => lerpX(a, b, w));
  if (P.length) P = edge(P, p => p[1] <= h, (a, b) => lerpY(a, b, h));
  return P;
};
/* ───────── 透明度遮罩 ─────────
   星星各自變淡的最好做法：貼圖照平常完整畫「一次」（本體、描邊、發光全部），
   再蓋一張「每一點的透明度＝離它最近的那顆星星的透明度」的小遮罩（destination-in）。
   遮罩只有 40 格寬，放大時瀏覽器會平滑內插，所以星星之間的發光也是平順過渡。
   透明度是連續的（不分層、不會一格一格跳），而且一格只畫一次，不會因為分層重畫好幾次而卡。 */
const maskMemo = new Map<string, { c: HTMLCanvasElement; pad: number } | null>();
export const fancyMaskPad = (w: number, h: number) => Math.max(w, h) * 0.4 + 8;
/** 回傳遮罩畫布（涵蓋路徑座標 -pad～w+pad、-pad～h+pad），沒有星星在變淡就回 null（照平常畫）。
    w、h 用物件本身的大小就好（遮罩是照比例放大縮小的） */
export const fancyAlphaMask = (kind0: string, w: number, h: number, gbw = w, gbh = h): { c: HTMLCanvasElement; pad: number } | null => {
  if (typeof document === 'undefined' || !(w > 0) || !(h > 0)) return null;
  const key = kind0 + '|' + Math.round(w) + '|' + Math.round(h) + '|' + Math.round(gbw) + '|' + Math.round(gbh);
  if (maskMemo.has(key)) return maskMemo.get(key)!;
  const [kind, tag] = kind0.split('!');
  let out: { c: HTMLCanvasElement; pad: number } | null = null;
  if (tag) {
    const { stars } = fancyGeometry(kind, w, h, gbw, gbh);
    const us = fancyMotionUnitsTag(tag.split('|')[0], motionCtxOf(stars, w, h, kind));
    if (us && us.some(u => u.a < 0.995)) {
      const pad = fancyMaskPad(w, h), W = w + pad * 2, H = h + pad * 2;
      const N = 40, cw = W >= H ? N : Math.max(8, Math.round(N * W / H)), ch = H >= W ? N : Math.max(8, Math.round(N * H / W));
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d');
      if (g) {
        const img = g.createImageData(cw, ch), px = img.data;
        const P = stars.map((st, i) => [st.x + us[i].dx, st.y + us[i].dy, st.r * Math.max(0.2, us[i].s), Math.max(0, Math.min(1, us[i].a))]);
        for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
          const x = -pad + (i + 0.5) / cw * W, y = -pad + (j + 0.5) / ch * H;
          let best = 1e18, a = 1;
          for (const q of P) {
            const dx = q[0] - x, dy = q[1] - y, lo = best + q[2];
            if (lo > 0 && dx * dx + dy * dy >= lo * lo) continue;   // 一定比目前最近的遠，不用開根號
            const d = Math.sqrt(dx * dx + dy * dy) - q[2]; if (d < best) { best = d; a = q[3]; }
          }
          const o = (j * cw + i) * 4; px[o] = px[o + 1] = px[o + 2] = 255; px[o + 3] = Math.round(a * 255);
        }
        g.putImageData(img, 0, 0);
        out = { c, pad };
      }
    }
  }
  maskMemo.set(key, out); if (maskMemo.size > 48) maskMemo.delete(maskMemo.keys().next().value!);
  return out;
};
/** 在一張獨立的畫布上（裡面只有這個貼圖）蓋上遮罩：ctx 目前的座標要是路徑座標（左上角＝0,0、大小 dw×dh） */
export const applyFancyMask = (ctx: CanvasRenderingContext2D, m: { c: HTMLCanvasElement; pad: number }, w: number, h: number, dw: number, dh: number) => {
  const kx = dw / w, ky = dh / h;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = 1;
  // 遮罩本來就是柔和的漸層：一般的雙線性內插就夠了（'high' 在大面積放大時很花時間）
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(m.c, -m.pad * kx, -m.pad * ky, (w + m.pad * 2) * kx, (h + m.pad * 2) * ky);
  ctx.restore();
};
/** 畫在一般畫布上（底下已經有別的東西）：先畫到暫存畫布、蓋遮罩、再貼回來。
    ox、oy＝路徑左上角在 ctx 目前座標裡的位置；dw、dh＝路徑在 ctx 座標裡的大小 */
let maskScratch: HTMLCanvasElement | null = null;
export const paintWithFancyMask = (ctx: CanvasRenderingContext2D, m: { c: HTMLCanvasElement; pad: number }, w: number, h: number,
  ox: number, oy: number, dw: number, dh: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const kx = dw / w, ky = dh / h, px = m.pad * kx, py = m.pad * ky;
  const T = ctx.getTransform(), sc = Math.max(0.01, Math.sqrt(Math.abs(T.a * T.d - T.b * T.c)));
  const BW = dw + px * 2, BH = dh + py * 2;
  let k = sc; const MAXPX = 2_400_000;
  if (BW * BH * k * k > MAXPX) k = Math.sqrt(MAXPX / (BW * BH));   // 很大的時候降一點解析度，不會吃光記憶體
  const cw = Math.max(1, Math.ceil(BW * k)), ch = Math.max(1, Math.ceil(BH * k));
  const c = maskScratch ??= document.createElement('canvas');
  if (c.width < cw || c.height < ch) { c.width = Math.max(c.width, cw); c.height = Math.max(c.height, ch); }
  const g = c.getContext('2d'); if (!g) { draw(ctx); return; }
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch);
  g.setTransform(k, 0, 0, k, (px - ox) * k, (py - oy) * k);
  draw(g);
  g.setTransform(k, 0, 0, k, (px - ox) * k + ox * k, (py - oy) * k + oy * k);
  applyFancyMask(g, m, w, h, dw, dh);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, cw, ch, ox - px, oy - py, BW, BH);
  ctx.restore();
};
/** 透明度分成 8 層（0.125、0.25 … 1） */
const alphaLevel = (a: number) => Math.max(1, Math.min(8, Math.round(a * 8))) / 8;
/** 這一格有哪些透明度層（全部都是不透明就回 null，照平常畫一次就好）。
    kind 是帶動畫進度的那一串（'fancy-halo!fx-idle-twinkle:1.2345'） */
export const fancyAlphaLevels = (kind0: string, w: number, h: number, gbw = w, gbh = h): number[] | null => {
  const [kind, tag] = kind0.split('!'); if (!tag || !(w > 0) || !(h > 0)) return null;
  const { stars } = fancyGeometry(kind, w, h, gbw, gbh);
  const us = fancyMotionUnitsTag(tag.split('|')[0], motionCtxOf(stars, w, h, kind));
  if (!us) return null;
  const set = new Set<number>();
  for (const u of us) if (u.a > 0.02 && u.s > 0.005) set.add(alphaLevel(u.a));
  if (!set.size || (set.size === 1 && set.has(1))) return null;
  set.add(1);   // 線（沒有貼著星星的那一端）永遠在不透明那一層
  return [...set].sort((a, b) => a - b);
};
const fancyPathD0 = (kind0: string, w: number, h: number, gbw: number, gbh: number) => {
  const [kind, tag] = kind0.split('!');
  const { stars, lines: lines0 } = fancyGeometry(kind, w, h, gbw, gbh);
  let lines = lines0, out: string[];
  /* 一顆一顆分開動的動畫：照進度搬每顆星星；透明度換成大小（一條路徑只有一個顏色），完全透明就不畫 */
  const aid = (tag || '').split(':')[0], lv = (tag || '').split('|')[1];   // '|' 後面是畫法（m＝遮罩）
  const us = tag ? fancyMotionUnitsTag(tag.split('|')[0], motionCtxOf(stars, w, h, kind)) : null;
  /* '|透明度層'：畫的那一端把星星照透明度分層，一層一層用自己的透明度畫（見 fancyAlphaLevels）。
     這一次只畫屬於這一層的星星，大小照原本的；沒有分層的地方（舊的畫法）才把「變淡」換成「變小」 */
  const masked = lv === 'm', layer = lv && !masked ? Number(lv) : undefined, isMobile = kind.split('@')[0] === 'fancy-mobile', clipBox = aid === 'fx-in-rain' || isMobile;   // 吊飾：上面（框外）的一律不畫
  if (us) {
    out = [];
    stars.forEach((st, i) => {
      const u = us[i]; if (!u || u.a <= 0.02 || u.s <= 0.005) return;
      if (layer !== undefined && alphaLevel(u.a) !== layer) return;
      const R = st.r * u.s * (layer === undefined && !masked && u.a < 1 ? 0.3 + 0.7 * u.a : 1), X = st.x + u.dx, Y = st.y + u.dy;
      const sx = u.sx ?? 1;
      let pts: [number, number][] = [];
      for (let k = 0; k < 10; k++) {
        const t = -Math.PI / 2 + st.rot + u.rot + k * Math.PI / 5, m = k % 2 ? 0.42 : 1;
        pts.push([X + Math.cos(t) * R * m * sx, Y + Math.sin(t) * R * m]);
      }
      // 星雨：還在框外（上面）的部分不畫 —— 照框把星星切掉
      if (clipBox) { pts = clipRect(pts, w, h, isMobile); if (pts.length < 3) return; }
      out.push(pts.map(([x, y], k) => `${k ? 'L' : 'M'} ${r3(x)} ${r3(y)}`).join(' ') + ' Z');
    });
    // 線：兩端貼著哪顆星星就跟著那顆動；那顆還沒出現（很淡）就先不畫
    const near = (x: number, y: number) => { let b = -1, bd = 1e9; stars.forEach((st, i) => { const d = Math.hypot(st.x - x, st.y - y) - st.r * 2.2; if (d < bd) { bd = d; b = i; } }); return bd <= 0 ? b : -1; };
    lines = [];
    for (const l of lines0) {
      const ia = near(l.x1, l.y1), ib = near(l.x2, l.y2), A = ia >= 0 ? us[ia] : null, B = ib >= 0 ? us[ib] : null;
      if (layer !== undefined) { if (alphaLevel(Math.min(A ? A.a : 1, B ? B.a : 1)) !== layer) continue; }
      else if (!masked && ((A && A.a < 0.5) || (B && B.a < 0.5))) continue;
      else if (masked && ((A && A.a <= 0.02) || (B && B.a <= 0.02))) continue;
      const L = { ...l, x1: l.x1 + (A?.dx || 0), y1: l.y1 + (A?.dy || 0), x2: l.x2 + (B?.dx || 0), y2: l.y2 + (B?.dy || 0) };
      // 吊飾翻牌：線從上往下長出來（下端貼著的那顆星星決定長了多少）
      if (B && B.line !== undefined && B.line < 1) {
        if (B.line <= 0.001) continue;
        L.x2 = L.x1 + (L.x2 - L.x1) * B.line; L.y2 = L.y1 + (L.y2 - L.y1) * B.line;
      }
      if (clipBox) {   // 星雨：線也只畫框裡面那一段
        if (Math.max(L.y1, L.y2) <= 0) continue;
        L.y1 = Math.max(0, isMobile ? L.y1 : Math.min(h, L.y1)); L.y2 = Math.max(0, isMobile ? L.y2 : Math.min(h, L.y2));   // 吊飾：下面超出去的不裁
      }
      lines.push(L);
    }
  } else out = stars.map(u => fancyStarD(u.x, u.y, u.r, u.rot));
  for (const l of lines) {
    const { x1, y1, x2, y2 } = l;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, hw = l.w / 2;
    const nx = -(y2 - y1) / len * hw, ny = (x2 - x1) / len * hw;
    // 繞行方向要跟星星一樣（順時針），線跟星星重疊的地方才不會被挖空
    out.push(`M ${r3(x1 - nx)} ${r3(y1 - ny)} L ${r3(x2 - nx)} ${r3(y2 - ny)} L ${r3(x2 + nx)} ${r3(y2 + ny)} L ${r3(x1 + nx)} ${r3(y1 + ny)} Z`);
  }
  return out.join(' ');
};
