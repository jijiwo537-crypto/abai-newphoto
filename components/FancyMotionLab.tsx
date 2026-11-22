/* 測試網站：花式排列的動畫實驗室。
   花式排列是很多顆星星組成的，所以除了 App 原本「整組一起動」的動畫，
   這裡另外設計「一顆一顆分開動、有層次」的進場與常駐動畫。
   ‧ 新設計的：勾「加入」＝想放進 App
   ‧ App 原本就有的：勾「刪除」＝花式排列不要這個
   ‧ 每一個都可以改名
   結果存在這台裝置（localStorage），「複製順序」時一起帶出去（見 fancyMotionReport）。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FANCY_KINDS, fancyGeometry, fancyRatio, fancyStarD, type FancyStar, type FancyLine } from '../utils/fancyShapes';
import { objectMotionFrame } from '../utils/objectMotion';

/* 每一種花式排列各自一份：加入／刪除／預設 都分開選。名字是共用的（同一個動畫在每一種都叫同一個名字） */
const STORE = 'abai-order-tool-fancy-motion-v2';
type Pick = { add: string[]; del: string[]; defIn?: string; defIdle?: string; orderIn?: string[]; orderIdle?: string[] };
type Saved = { kinds: Record<string, Pick>; names: Record<string, string> };
const EMPTY: Pick = { add: [], del: [] };
const load = (): Saved => {
  try { const v = JSON.parse(localStorage.getItem(STORE) || 'null'); if (v && v.kinds) return { kinds: v.kinds, names: v.names || {} }; } catch { /* */ }
  return { kinds: {}, names: {} };
};
const save = (s: Saved) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* */ } };
try { localStorage.removeItem('abai-order-tool-fancy-motion-v1'); } catch { /* */ }
const pickOf = (s: Saved, k: string): Pick => ({ ...EMPTY, ...(s.kinds[k] || {}) });
/** 這個動畫在這一種花式排列裡有沒有（新設計的要勾加入、原有的沒勾刪除） */
const included = (pk: Pick, a: Anim) => a.fresh ? pk.add.includes(a.id) : !pk.del.includes(a.id);
/** 這一種花式排列面板上的按鈕順序（只算有的那些）：排過的照排的，沒排過的照「原有在前、新設計在後」接在後面 */
const buttonOrder = (pk: Pick, phase: 'entry' | 'idle'): Anim[] => {
  const all = [...OLDS, ...ENTRIES, ...IDLES].filter(a => a.kind === phase && included(pk, a));
  const saved = (phase === 'entry' ? pk.orderIn : pk.orderIdle) || [];
  const rank = (a: Anim) => { const i = saved.indexOf(a.id); return i < 0 ? 1e3 + all.indexOf(a) : i; };
  return all.sort((x, y) => rank(x) - rank(y));
};

const KIND_NAMES: Record<string, string> = {
  'fancy-halo': '光環', 'fancy-concentric': '同心圓', 'fancy-spiral': '螺旋', 'fancy-ring': '環形', 'fancy-swirl3': '三臂漩渦',
  'fancy-radial': '放射', 'fancy-grid': '方形平均', 'fancy-polka': '點點紋理', 'fancy-boxrandom': '方形隨機',
  'fancy-wand': '魔法棒', 'fancy-mobile': '吊飾', 'fancy-constellation': '星座',
};
const KIND_ORDER = ['fancy-halo', 'fancy-concentric', 'fancy-spiral', 'fancy-ring', 'fancy-swirl3', 'fancy-radial',
  'fancy-grid', 'fancy-polka', 'fancy-boxrandom', 'fancy-wand', 'fancy-mobile', 'fancy-constellation'].filter(k => (FANCY_KINDS as readonly string[]).includes(k));

/* ───────── 每一顆的樣子 ───────── */
type U = { dx: number; dy: number; s: number; rot: number; a: number; sx?: number };
const ID: U = { dx: 0, dy: 0, s: 1, rot: 0, a: 1 };
type Ctx = { stars: FancyStar[]; w: number; h: number; cx: number; cy: number; maxD: number; order: number[]; rank: number[] };
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const cubic = (p: number) => 1 - Math.pow(1 - clamp(p), 3);
const smooth = (p: number) => { p = clamp(p); return p * p * (3 - 2 * p); };
const backOut = (p: number) => { p = clamp(p); const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** 每顆在 0～1 的總進度裡，從 start 開始、花 span 長度跑完自己的那一段 */
const local = (p: number, start: number, span: number) => clamp((p - start) / Math.max(1e-6, span));

type Anim = { id: string; name: string; kind: 'entry' | 'idle'; fresh: boolean; desc: string;
  /** 新設計的：每一顆各自的樣子 */
  unit?: (i: number, c: Ctx, p: number, t: number) => U;
  /** App 原本就有的：整組一起動（照 App 的 objectMotionFrame） */
  group?: string };

const ENTRY_DUR = 1.8, HOLD = 1.3, GAP = 0.35;

/* ───────── 新設計：進場 ───────── */
const ENTRIES: Anim[] = [
  { id: 'fx-in-seq', name: '點亮', kind: 'entry', fresh: true, desc: '照排列的順序一顆接一顆彈出來，每顆帶一點回彈',
    unit: (i, c, p) => { const q = local(p, c.rank[i] / Math.max(1, c.stars.length) * 0.72, 0.28); return { ...ID, s: backOut(q), a: clamp(q * 3) }; } },
  { id: 'fx-in-burst', name: '綻放', kind: 'entry', fresh: true, desc: '全部從中心飛出去，離中心越遠的越晚到、邊飛邊轉',
    unit: (i, c, p) => {
      const st = c.stars[i], d = Math.hypot(st.x - c.cx, st.y - c.cy) / c.maxD, q = cubic(local(p, d * 0.35, 0.65));
      return { dx: (c.cx - st.x) * (1 - q), dy: (c.cy - st.y) * (1 - q), s: 0.3 + 0.7 * q, rot: (1 - q) * 2.4, a: clamp(q * 2.5) };
    } },
  { id: 'fx-in-gather', name: '聚合', kind: 'entry', fresh: true, desc: '從四面八方散落的位置慢慢收攏、歸位',
    unit: (i, c, p) => {
      const ang = hash(i) * Math.PI * 2, dist = (0.45 + hash(i + 9) * 0.5) * Math.max(c.w, c.h), q = smooth(local(p, hash(i + 3) * 0.25, 0.75));
      return { dx: Math.cos(ang) * dist * (1 - q), dy: Math.sin(ang) * dist * (1 - q), s: 1, rot: (1 - q) * (hash(i + 5) - 0.5) * 6, a: clamp(q * 1.6) };
    } },
  { id: 'fx-in-sweep', name: '掃光', kind: 'entry', fresh: true, desc: '一道光從左上掃到右下，掃到的星星先亮一下再縮回原本大小',
    unit: (i, c, p) => {
      const st = c.stars[i], k = (st.x / c.w + st.y / c.h) / 2, q = local(p, k * 0.75, 0.25);
      const s = q <= 0 ? 0 : q < 0.55 ? 1.45 * cubic(q / 0.55) : 1.45 - 0.45 * smooth((q - 0.55) / 0.45);
      return { ...ID, s, a: clamp(q * 4) };
    } },
  { id: 'fx-in-rain', name: '星雨', kind: 'entry', fresh: true, desc: '每顆從上方落下、著地彈一下，左到右錯開',
    unit: (i, c, p) => {
      const st = c.stars[i], q = local(p, (st.x / c.w) * 0.45 + hash(i) * 0.15, 0.4);
      const fall = q < 0.7 ? 1 - Math.pow(q / 0.7, 2) : 0, b = q >= 0.7 ? Math.sin((q - 0.7) / 0.3 * Math.PI) * 0.08 : 0;
      return { dx: 0, dy: -(fall * (st.y + c.h * 0.4)) - b * c.h, s: 1, rot: 0, a: clamp(q * 5) };
    } },
  { id: 'fx-in-twirl', name: '旋開', kind: 'entry', fresh: true, desc: '每顆在自己的位置從小轉一圈開出來，隨機錯開',
    unit: (i, c, p) => { const q = local(p, hash(i) * 0.55, 0.45), e = backOut(q); return { ...ID, s: e, rot: (1 - cubic(q)) * Math.PI * 2, a: clamp(q * 3) }; } },
  { id: 'fx-in-vortex', name: '漩渦', kind: 'entry', fresh: true, desc: '每顆從中心沿著螺旋轉出去、一圈半後剛好落到自己的位置',
    unit: (i, c, p) => {
      const st = c.stars[i], q = cubic(local(p, c.rank[i] / Math.max(1, c.stars.length) * 0.45, 0.55));
      const R0 = Math.hypot(st.x - c.cx, st.y - c.cy), A0 = Math.atan2(st.y - c.cy, st.x - c.cx), ang = A0 - (1 - q) * Math.PI * 3, rr = R0 * q;
      return { dx: c.cx + Math.cos(ang) * rr - st.x, dy: c.cy + Math.sin(ang) * rr - st.y, s: 0.4 + 0.6 * q, rot: (1 - q) * 3, a: clamp(q * 2.5) };
    } },
  { id: 'fx-in-flip', name: '翻牌', kind: 'entry', fresh: true, desc: '像翻牌一樣，一顆接一顆從側面翻正，由左上翻到右下',
    unit: (i, c, p) => {
      const st = c.stars[i], k = (st.x / c.w + st.y / c.h) / 2, q = local(p, k * 0.6, 0.4);
      return { ...ID, sx: q <= 0 ? 0 : Math.max(0.04, Math.abs(Math.cos((1 - smooth(q)) * Math.PI))), s: 0.85 + 0.15 * smooth(q), a: q <= 0 ? 0 : q < 0.5 ? 0.55 : 1 };
    } },
];
/* ───────── 新設計：常駐 ───────── */
const IDLES: Anim[] = [
  { id: 'fx-idle-twinkle', name: '閃爍', kind: 'idle', fresh: true, desc: '每顆各自隨機地忽明忽暗、微微縮放，像真的星星',
    unit: (i, _c, _p, t) => { const w = Math.pow((Math.sin(t * (1.6 + hash(i) * 1.8) + hash(i + 7) * 6.28) + 1) / 2, 3); return { ...ID, s: 1 - w * 0.28, a: 1 - w * 0.65 }; } },
  { id: 'fx-idle-ripple', name: '漣漪', kind: 'idle', fresh: true, desc: '一圈一圈從中心往外擴散，經過的星星放大一下',
    unit: (i, c, _p, t) => { const st = c.stars[i], d = Math.hypot(st.x - c.cx, st.y - c.cy) / c.maxD; const w = Math.pow(Math.max(0, Math.cos((d * 1.6 - t * 0.9) * Math.PI * 2)), 6); return { ...ID, s: 1 + w * 0.32 }; } },
  { id: 'fx-idle-shimmer', name: '流光', kind: 'idle', fresh: true, desc: '一道斜斜的光帶反覆掃過，掃到的星星變大變亮',
    unit: (i, c, _p, t) => { const st = c.stars[i], k = (st.x / c.w + st.y / c.h) / 2, ph = ((t * 0.42) % 1.6) - 0.3; const w = Math.exp(-Math.pow((k - ph) / 0.09, 2)); return { ...ID, s: 1 + w * 0.35, rot: w * 0.5, a: 0.72 + w * 0.28 }; } },
  { id: 'fx-idle-spin', name: '自轉', kind: 'idle', fresh: true, desc: '每顆在原地自轉，大小不同轉速不同、方向也不一樣',
    unit: (i, _c, _p, t) => ({ ...ID, rot: t * (0.6 + hash(i) * 1.1) * (hash(i + 2) > 0.5 ? 1 : -1) }) },
  { id: 'fx-idle-drift', name: '浮游', kind: 'idle', fresh: true, desc: '每顆各自輕輕繞小圈，大的動得多、小的動得少，有前後層次',
    unit: (i, c, _p, t) => { const st = c.stars[i], amp = st.r * 0.55, w = t * (0.8 + hash(i) * 0.5) + hash(i + 4) * 6.28; return { ...ID, dx: Math.cos(w) * amp, dy: Math.sin(w * 1.3) * amp }; } },
  { id: 'fx-idle-chase', name: '跑燈', kind: 'idle', fresh: true, desc: '一個亮點照排列順序一直往前跑，像跑馬燈',
    unit: (i, c, _p, t) => { const n = c.stars.length, pos = (t * Math.max(4, n * 0.35)) % n; let d = Math.abs(c.rank[i] - pos); d = Math.min(d, n - d); const w = Math.exp(-d * d / 3); return { ...ID, s: 1 + w * 0.3, a: 0.45 + w * 0.55 }; } },
  { id: 'fx-idle-sway', name: '擺盪', kind: 'idle', fresh: true, desc: '每顆像掛著一樣左右擺，彼此錯開（吊飾最適合）',
    unit: (i, c, _p, t) => { const st = c.stars[i], len = Math.max(st.y, c.h * 0.25), ang = Math.sin(t * 1.6 + hash(i) * 6.28) * 0.12; return { ...ID, dx: Math.sin(ang) * len, dy: (Math.cos(ang) - 1) * len, rot: ang }; } },
  { id: 'fx-idle-wave', name: '起伏', kind: 'idle', fresh: true, desc: '星星的大小像波浪一樣從左往右一波一波推過去，位置不動',
    unit: (i, c, _p, t) => { const st = c.stars[i]; return { ...ID, s: 1 + Math.sin((st.x / c.w) * Math.PI * 2 - t * 2.4) * 0.22 }; } },
  { id: 'fx-idle-firefly', name: '螢光', kind: 'idle', fresh: true, desc: '平常是暗暗的，每顆不定時突然亮起來一下再慢慢暗回去，像螢火蟲',
    unit: (i, _c, _p, t) => {
      const per = 2.6 + hash(i) * 2.2, q = ((t + hash(i + 11) * per) % per) / per;
      const w = q < 0.08 ? q / 0.08 : Math.exp(-(q - 0.08) * 7);
      return { ...ID, s: 0.88 + w * 0.3, a: 0.4 + w * 0.6 };
    } },
];
/* ───────── App 原本就有的（花式排列現在吃的那一組） ───────── */
const OLD_ENTRY: [string, string][] = [['pop', '果凍'], ['fade', '淡入'], ['rise', '升起'], ['drop', '落下'], ['spin', '旋轉'], ['flip', '翻轉'], ['spring', '流星']];
const OLD_IDLE: [string, string][] = [['float', '漂浮'], ['grid-wave', '波浪'], ['breathe', '縮放'], ['spin', '旋轉'], ['wobble', '搖擺'], ['orbit', '繞圈'], ['jitter', '抖動']];
const OLDS: Anim[] = [
  ...OLD_ENTRY.map(([id, name]) => ({ id: `in:${id}`, name, kind: 'entry' as const, fresh: false, desc: 'App 原本就有（整組一起動）', group: id })),
  ...OLD_IDLE.map(([id, name]) => ({ id: `idle:${id}`, name, kind: 'idle' as const, fresh: false, desc: 'App 原本就有（整組一起動）', group: id })),
];
export const FANCY_MOTION_ALL: Anim[] = [...OLDS.filter(a => a.kind === 'entry'), ...ENTRIES, ...OLDS.filter(a => a.kind === 'idle'), ...IDLES];

/** 「複製順序」要帶出去的那幾行 */
export const fancyMotionReport = (): string[] => {
  const s = load(), out: string[] = [];
  const nm = (a: Anim) => s.names[a.id] && s.names[a.id] !== a.name ? `${s.names[a.id]}（原名 ${a.name}，${a.id}）` : `${a.name}（${a.id}）`;
  const byId = new Map(FANCY_MOTION_ALL.map(a => [a.id, a]));
  const defName = (id?: string) => !id ? '' : id === 'none' ? '無' : byId.get(id) ? nm(byId.get(id)!) : id;
  for (const k of KIND_ORDER) {
    const pk = pickOf(s, k), parts: string[] = [];
    const addE = ENTRIES.filter(a => pk.add.includes(a.id)), addI = IDLES.filter(a => pk.add.includes(a.id));
    const delE = OLDS.filter(a => a.kind === 'entry' && pk.del.includes(a.id)), delI = OLDS.filter(a => a.kind === 'idle' && pk.del.includes(a.id));
    if (addE.length) parts.push('加入進場：' + addE.map(nm).join(', '));
    if (addI.length) parts.push('加入常駐：' + addI.map(nm).join(', '));
    if (delE.length) parts.push('刪除原有進場：' + delE.map(nm).join(', '));
    if (delI.length) parts.push('刪除原有常駐：' + delI.map(nm).join(', '));
    if (pk.defIn) parts.push('預設進場：' + defName(pk.defIn));
    if (pk.defIdle) parts.push('預設常駐：' + defName(pk.defIdle));
    if (pk.orderIn?.length) parts.push('進場按鈕順序：' + buttonOrder(pk, 'entry').map(nm).join(', '));
    if (pk.orderIdle?.length) parts.push('常駐按鈕順序：' + buttonOrder(pk, 'idle').map(nm).join(', '));
    if (parts.length) out.push(`花式排列・${KIND_NAMES[k]}（${k}）的動畫`, ...parts);
  }
  const renamed = FANCY_MOTION_ALL.filter(a => s.names[a.id] && s.names[a.id] !== a.name);
  if (renamed.length) out.push('花式排列動畫改名', renamed.map(a => `${a.name}（${a.id}）→ ${s.names[a.id]}`).join(', '));
  return out;
};
export const fancyMotionChanged = () => fancyMotionReport().length > 0;
export const fancyMotionReset = () => { try { localStorage.removeItem(STORE); } catch { /* */ } };

/* ───────── 畫一格 ───────── */
function paint(ctx: CanvasRenderingContext2D, W: number, H: number, geo: { stars: FancyStar[]; lines: FancyLine[] }, c: Ctx, a: Anim, time: number, ox: number, oy: number) {
  ctx.clearRect(0, 0, W, H);
  ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#FFFFFF';
  const cyc = ENTRY_DUR + HOLD + GAP;
  let us: U[];
  let g = ID, gfx = 1, wave: number | undefined;
  if (a.kind === 'entry') {
    const tt = time % cyc, p = clamp((tt - GAP) / ENTRY_DUR);
    if (a.unit) us = c.stars.map((_, i) => tt < GAP ? { ...ID, a: 0 } : a.unit!(i, c, p, 0));
    else {
      const f = objectMotionFrame({ in: a.group!, idle: 'none', delay: GAP, dur: 0.63 * 1.4 }, tt);
      g = { dx: f.dx * c.h * 0.5, dy: f.dy * c.h * 0.5, s: f.k, rot: f.rot * Math.PI / 180, a: f.a }; gfx = f.fx ?? 1; us = c.stars.map(() => ID);
    }
  } else {
    if (a.unit) us = c.stars.map((_, i) => a.unit!(i, c, 1, time));
    else {
      const f = objectMotionFrame({ in: 'none', idle: a.group!, delay: 0, dur: .01, amp: 50, speed: 0.84 }, time + 1);
      g = { dx: f.dx * c.h * 0.5, dy: f.dy * c.h * 0.5, s: f.k, rot: f.rot * Math.PI / 180, a: f.a }; wave = f.gridWave; us = c.stars.map(() => ID);
    }
  }
  // 整組（App 原本的動畫）
  ctx.translate(c.cx + g.dx, c.cy + g.dy); ctx.rotate(g.rot); ctx.scale(g.s * gfx, g.s); ctx.translate(-c.cx, -c.cy);
  ctx.globalAlpha = clamp(g.a);
  const wy = (x: number) => wave === undefined ? 0 : Math.sin((x / c.w - wave) * Math.PI * 2) * c.h * 0.05;
  // 線：兩端如果貼著某顆星星，就跟著那顆動
  const near = (x: number, y: number) => { let b = -1, bd = 1e9; c.stars.forEach((s, i) => { const d = Math.hypot(s.x - x, s.y - y) - s.r * 2.2; if (d < bd) { bd = d; b = i; } }); return bd <= 0 ? b : -1; };
  for (const l of geo.lines) {
    const ia = near(l.x1, l.y1), ib = near(l.x2, l.y2), A = ia >= 0 ? us[ia] : null, B = ib >= 0 ? us[ib] : null;
    const al = Math.min(A ? A.a : 1, B ? B.a : 1, (A || B) ? 1 : (us.reduce((m, u) => m + u.a, 0) / Math.max(1, us.length)));
    ctx.globalAlpha = clamp(g.a) * clamp(al); ctx.lineWidth = l.w;
    ctx.beginPath(); ctx.moveTo(l.x1 + (A?.dx || 0), l.y1 + (A?.dy || 0) + wy(l.x1)); ctx.lineTo(l.x2 + (B?.dx || 0), l.y2 + (B?.dy || 0) + wy(l.x2)); ctx.stroke();
  }
  c.stars.forEach((st, i) => {
    const u = us[i]; if (u.a <= 0.001 || u.s <= 0.001) return;
    ctx.globalAlpha = clamp(g.a) * clamp(u.a);
    if (u.sx !== undefined && u.sx !== 1) {   // 翻面：只有水平方向縮
      const X = st.x + u.dx, Y = st.y + u.dy + wy(st.x);
      ctx.save(); ctx.translate(X, Y); ctx.scale(u.sx, 1); ctx.fill(new Path2D(fancyStarD(0, 0, st.r * u.s, st.rot + u.rot))); ctx.restore();
    } else ctx.fill(new Path2D(fancyStarD(st.x + u.dx, st.y + u.dy + wy(st.x), st.r * u.s, st.rot + u.rot)));
  });
  ctx.restore();
}

const ctxOf = (stars: FancyStar[], w: number, h: number): Ctx => {
  const cx = w / 2, cy = h / 2, maxD = Math.max(1, ...stars.map(s => Math.hypot(s.x - cx, s.y - cy)));
  // 排列順序：照星星原本的順序（大部分排列就是沿著路徑排的）
  const order = stars.map((_, i) => i), rank = order.slice();
  return { stars, w, h, cx, cy, maxD, order, rank };
};

const Card: React.FC<{ a: Anim; kind: string; sv: Saved; setSv: (s: Saved) => void; clock: React.MutableRefObject<number> }> = ({ a, kind, sv, setSv, clock }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const S = 150, dpr = Math.min(2, window.devicePixelRatio || 1);
  const box = useMemo(() => {
    const ratio = fancyRatio(kind), w = ratio > 1 ? S * 0.8 / ratio : S * 0.8, h = w * ratio;
    const geo = fancyGeometry(kind, w, h);
    return { w, h, geo, c: ctxOf(geo.stars, w, h) };
  }, [kind]);
  useEffect(() => {
    let raf = 0; const cv = ref.current; if (!cv) return;
    const g = cv.getContext('2d')!;
    const loop = () => { g.setTransform(dpr, 0, 0, dpr, 0, 0); paint(g, S, S, box.geo, box.c, a, clock.current, (S - box.w) / 2, (S - box.h) / 2); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [box, a, dpr, clock]);
  const pk = pickOf(sv, kind), dk = a.kind === 'entry' ? 'defIn' : 'defIdle';
  const checked = a.fresh ? pk.add.includes(a.id) : pk.del.includes(a.id);
  const setPk = (q: Pick) => setSv({ ...sv, kinds: { ...sv.kinds, [kind]: q } });
  const toggle = () => {
    const key = a.fresh ? 'add' : 'del', list = pk[key];
    const next: Pick = { ...pk, [key]: checked ? list.filter(x => x !== a.id) : [...list, a.id] };
    if (!included(next, a) && next[dk] === a.id) delete next[dk];   // 拿掉的動畫不能當預設
    setPk(next);
  };
  const isDef = pk[dk] === a.id, canDef = included(pk, a);
  const name = sv.names[a.id] ?? a.name;
  return (
    <div className={`rounded-[10px] border p-2 ${checked ? (a.fresh ? 'border-[#9fd3a8] bg-[#9fd3a8]/10' : 'border-[#e57a7a] bg-[#e57a7a]/10') : 'border-white/10 bg-white/[0.03]'}`}>
      <canvas ref={ref} width={S * dpr} height={S * dpr} style={{ width: '100%', aspectRatio: '1', display: 'block', background: '#111', borderRadius: 6 }} />
      <input value={name} onChange={e => setSv({ ...sv, names: { ...sv.names, [a.id]: e.target.value } })}
        className="mt-2 w-full bg-black/40 border border-white/10 rounded px-2 h-8 text-[13px] text-white select-text" style={{ WebkitUserSelect: 'text' }} />
      <div className="mt-1 text-[10px] text-white/40 leading-snug min-h-[28px]">{a.desc}</div>
      <label className="mt-1 flex items-center gap-2 text-[12px] font-bold">
        <input type="checkbox" checked={checked} onChange={toggle} className="w-4 h-4" />
        <span className={a.fresh ? 'text-[#9fd3a8]' : 'text-[#e57a7a]'}>{a.fresh ? '加入' : '刪除'}</span>
      </label>
      <label className={`mt-1 flex items-center gap-2 text-[12px] font-bold ${canDef ? '' : 'opacity-30'}`}>
        <input type="radio" disabled={!canDef} checked={isDef} onChange={() => setPk({ ...pk, [dk]: a.id })} className="w-4 h-4" />
        <span className="text-[#f2c86b]">設為預設</span>
      </label>
    </div>
  );
};

export function FancyMotionLab({ onChange }: { onChange?: () => void }) {
  const [kind, setKind] = useState(KIND_ORDER[0]);
  const [sv, setSv0] = useState<Saved>(load);
  const setSv = (s: Saved) => { setSv0(s); save(s); onChange?.(); };
  useEffect(() => { const f = () => setSv0(load()); window.addEventListener('abai-fancy-motion-reset', f); return () => window.removeEventListener('abai-fancy-motion-reset', f); }, []);
  const clock = useRef(0);
  useEffect(() => { let raf = 0; const t0 = performance.now(); const f = () => { clock.current = (performance.now() - t0) / 1000; raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf); }, []);
  const pk = pickOf(sv, kind);
  const setPk = (q: Pick) => setSv({ ...sv, kinds: { ...sv.kinds, [kind]: q } });
  const defRow = (dk: 'defIn' | 'defIdle', label: string) => {
    const id = pk[dk], a = FANCY_MOTION_ALL.find(x => x.id === id);
    return <div className="flex items-center justify-between text-[12px] mt-1">
      <span className="text-white/60">{label}：<b className="text-[#f2c86b]">{!id ? '（沒選，照 App 現在的）' : id === 'none' ? (dk === 'defIn' ? '無' : '靜止') : (sv.names[id] ?? a?.name ?? id)}</b></span>
      <span className="flex gap-1.5">
        <button onClick={() => setPk({ ...pk, [dk]: 'none' })} className="px-2 h-7 rounded bg-white/10 text-[11px]">設成{dk === 'defIn' ? '無' : '靜止'}</button>
        {id && <button onClick={() => { const q = { ...pk }; delete q[dk]; setPk(q); }} className="px-2 h-7 rounded bg-white/10 text-[11px]">清除</button>}
      </span>
    </div>;
  };
  /* 按鈕順序：照 App 面板上的樣子排成一排，點一顆選中，再按 ◀ ▶ 移動 */
  const [selBtn, setSelBtn] = useState<string | null>(null);
  const orderRow = (phase: 'entry' | 'idle', label: string) => {
    const list = buttonOrder(pk, phase), key = phase === 'entry' ? 'orderIn' : 'orderIdle';
    const move = (d: number) => {
      const ids = list.map(a => a.id), i = selBtn ? ids.indexOf(selBtn) : -1, j = i + d;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]]; setPk({ ...pk, [key]: ids });
    };
    const selHere = !!selBtn && list.some(a => a.id === selBtn);
    return <div className="mt-3">
      <div className="flex items-center justify-between text-[12px] text-white/60">
        <span>{label}（點一顆選中，再按箭頭移動）</span>
        <span className="flex gap-1.5">
          <button disabled={!selHere} onClick={() => move(-1)} className="w-8 h-7 rounded bg-white/10 disabled:opacity-25">◀</button>
          <button disabled={!selHere} onClick={() => move(1)} className="w-8 h-7 rounded bg-white/10 disabled:opacity-25">▶</button>
          {(pk as any)[key]?.length ? <button onClick={() => { const q = { ...pk }; delete (q as any)[key]; setPk(q); }} className="px-2 h-7 rounded bg-white/10 text-[11px]">重排</button> : null}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="px-2.5 h-8 leading-8 rounded-md text-[12px] bg-white/5 text-white/35">{phase === 'entry' ? '無' : '靜止'}</span>
        {list.map(a => (
          <button key={a.id} onClick={() => setSelBtn(selBtn === a.id ? null : a.id)}
            className={`px-2.5 h-8 rounded-md text-[12px] font-bold border ${selBtn === a.id ? 'bg-white text-black border-white' : a.fresh ? 'border-[#9fd3a8]/50 text-[#cfe9d4]' : 'border-white/15 text-white/80'}`}>
            {sv.names[a.id] ?? a.name}{(phase === 'entry' ? pk.defIn : pk.defIdle) === a.id ? ' ★' : ''}
          </button>
        ))}
      </div>
    </div>;
  };
  const sec = (title: string, list: Anim[]) => (
    <section className="mt-5">
      <div className="text-[11px] font-bold text-white/50 tracking-widest mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-2">{list.map(a => <Card key={a.id} a={a} kind={kind} sv={sv} setSv={setSv} clock={clock} />)}</div>
    </section>
  );
  return (
    <div>
      <div className="text-[12px] text-white/60 leading-relaxed">
        先在上面選一種花式排列，下面的勾選只算這一種（每一種各自分開）。綠色「加入」＝新設計、想放進 App；紅色「刪除」＝App 原本就有、這一種不要；黃色「設為預設」＝新增這一種時預設套用。名字點一下就能改（所有種類共用同一個名字）。
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {KIND_ORDER.map(k => (
          <button key={k} onClick={() => setKind(k)} className={`px-2.5 h-8 rounded-full text-[12px] font-bold ${k === kind ? 'bg-white text-black' : 'bg-white/10 text-white/70'}`}>{KIND_NAMES[k] || k}{(() => { const q = pickOf(sv, k); return q.add.length || q.del.length || q.defIn || q.defIdle ? ' •' : ''; })()}</button>
        ))}
      </div>
      <div className="mt-4 rounded-[10px] border border-white/10 bg-white/[0.03] p-3">
        <div className="text-[12px] font-bold">{KIND_NAMES[kind]} 的設定（每一種各自分開）</div>
        {defRow('defIn', '預設進場')}
        {defRow('defIdle', '預設常駐')}
        {orderRow('entry', '進場按鈕順序')}
        {orderRow('idle', '常駐按鈕順序')}
      </div>
      {sec('進場・新設計（一顆一顆分開動）', ENTRIES)}
      {sec('進場・App 原本就有', OLDS.filter(a => a.kind === 'entry'))}
      {sec('常駐・新設計（一顆一顆分開動）', IDLES)}
      {sec('常駐・App 原本就有', OLDS.filter(a => a.kind === 'idle'))}
    </div>
  );
}
