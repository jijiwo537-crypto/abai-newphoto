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

const STORE = 'abai-order-tool-fancy-motion-v1';
type Saved = { add: string[]; del: string[]; names: Record<string, string> };
const load = (): Saved => {
  try { const v = JSON.parse(localStorage.getItem(STORE) || 'null'); if (v && Array.isArray(v.add) && Array.isArray(v.del)) return { add: v.add, del: v.del, names: v.names || {} }; } catch { /* */ }
  return { add: [], del: [], names: {} };
};
const save = (s: Saved) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* */ } };

const KIND_NAMES: Record<string, string> = {
  'fancy-halo': '光環', 'fancy-concentric': '同心圓', 'fancy-spiral': '螺旋', 'fancy-ring': '環形', 'fancy-swirl3': '三臂漩渦',
  'fancy-radial': '放射', 'fancy-grid': '方形平均', 'fancy-polka': '點點紋理', 'fancy-boxrandom': '方形隨機',
  'fancy-wand': '魔法棒', 'fancy-mobile': '吊飾', 'fancy-constellation': '星座',
};
const KIND_ORDER = ['fancy-halo', 'fancy-concentric', 'fancy-spiral', 'fancy-ring', 'fancy-swirl3', 'fancy-radial',
  'fancy-grid', 'fancy-polka', 'fancy-boxrandom', 'fancy-wand', 'fancy-mobile', 'fancy-constellation'].filter(k => (FANCY_KINDS as readonly string[]).includes(k));

/* ───────── 每一顆的樣子 ───────── */
type U = { dx: number; dy: number; s: number; rot: number; a: number };
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
  { id: 'fx-in-seq', name: '依序點亮', kind: 'entry', fresh: true, desc: '照排列的順序一顆接一顆彈出來，每顆帶一點回彈',
    unit: (i, c, p) => { const q = local(p, c.rank[i] / Math.max(1, c.stars.length) * 0.72, 0.28); return { ...ID, s: backOut(q), a: clamp(q * 3) }; } },
  { id: 'fx-in-burst', name: '中心綻放', kind: 'entry', fresh: true, desc: '全部從中心飛出去，離中心越遠的越晚到、邊飛邊轉',
    unit: (i, c, p) => {
      const st = c.stars[i], d = Math.hypot(st.x - c.cx, st.y - c.cy) / c.maxD, q = cubic(local(p, d * 0.35, 0.65));
      return { dx: (c.cx - st.x) * (1 - q), dy: (c.cy - st.y) * (1 - q), s: 0.3 + 0.7 * q, rot: (1 - q) * 2.4, a: clamp(q * 2.5) };
    } },
  { id: 'fx-in-gather', name: '星塵聚合', kind: 'entry', fresh: true, desc: '從四面八方散落的位置慢慢收攏、歸位',
    unit: (i, c, p) => {
      const ang = hash(i) * Math.PI * 2, dist = (0.45 + hash(i + 9) * 0.5) * Math.max(c.w, c.h), q = smooth(local(p, hash(i + 3) * 0.25, 0.75));
      return { dx: Math.cos(ang) * dist * (1 - q), dy: Math.sin(ang) * dist * (1 - q), s: 1, rot: (1 - q) * (hash(i + 5) - 0.5) * 6, a: clamp(q * 1.6) };
    } },
  { id: 'fx-in-sweep', name: '掃光顯現', kind: 'entry', fresh: true, desc: '一道光從左上掃到右下，掃到的星星先亮一下再縮回原本大小',
    unit: (i, c, p) => {
      const st = c.stars[i], k = (st.x / c.w + st.y / c.h) / 2, q = local(p, k * 0.75, 0.25);
      const s = q <= 0 ? 0 : q < 0.55 ? 1.45 * cubic(q / 0.55) : 1.45 - 0.45 * smooth((q - 0.55) / 0.45);
      return { ...ID, s, a: clamp(q * 4) };
    } },
  { id: 'fx-in-rain', name: '星雨落下', kind: 'entry', fresh: true, desc: '每顆從上方落下、著地彈一下，左到右錯開',
    unit: (i, c, p) => {
      const st = c.stars[i], q = local(p, (st.x / c.w) * 0.45 + hash(i) * 0.15, 0.4);
      const fall = q < 0.7 ? 1 - Math.pow(q / 0.7, 2) : 0, b = q >= 0.7 ? Math.sin((q - 0.7) / 0.3 * Math.PI) * 0.08 : 0;
      return { dx: 0, dy: -(fall * (st.y + c.h * 0.4)) - b * c.h, s: 1, rot: 0, a: clamp(q * 5) };
    } },
  { id: 'fx-in-twirl', name: '旋轉綻開', kind: 'entry', fresh: true, desc: '每顆在自己的位置從小轉一圈開出來，隨機錯開',
    unit: (i, c, p) => { const q = local(p, hash(i) * 0.55, 0.45), e = backOut(q); return { ...ID, s: e, rot: (1 - cubic(q)) * Math.PI * 2, a: clamp(q * 3) }; } },
];
/* ───────── 新設計：常駐 ───────── */
const IDLES: Anim[] = [
  { id: 'fx-idle-twinkle', name: '星光閃爍', kind: 'idle', fresh: true, desc: '每顆各自隨機地忽明忽暗、微微縮放，像真的星星',
    unit: (i, _c, _p, t) => { const w = Math.pow((Math.sin(t * (1.6 + hash(i) * 1.8) + hash(i + 7) * 6.28) + 1) / 2, 3); return { ...ID, s: 1 - w * 0.28, a: 1 - w * 0.65 }; } },
  { id: 'fx-idle-ripple', name: '漣漪', kind: 'idle', fresh: true, desc: '一圈一圈從中心往外擴散，經過的星星放大一下',
    unit: (i, c, _p, t) => { const st = c.stars[i], d = Math.hypot(st.x - c.cx, st.y - c.cy) / c.maxD; const w = Math.pow(Math.max(0, Math.cos((d * 1.6 - t * 0.9) * Math.PI * 2)), 6); return { ...ID, s: 1 + w * 0.32 }; } },
  { id: 'fx-idle-shimmer', name: '流光', kind: 'idle', fresh: true, desc: '一道斜斜的光帶反覆掃過，掃到的星星變大變亮',
    unit: (i, c, _p, t) => { const st = c.stars[i], k = (st.x / c.w + st.y / c.h) / 2, ph = ((t * 0.42) % 1.6) - 0.3; const w = Math.exp(-Math.pow((k - ph) / 0.09, 2)); return { ...ID, s: 1 + w * 0.35, rot: w * 0.5, a: 0.72 + w * 0.28 }; } },
  { id: 'fx-idle-spin', name: '各自自轉', kind: 'idle', fresh: true, desc: '每顆在原地自轉，大小不同轉速不同、方向也不一樣',
    unit: (i, _c, _p, t) => ({ ...ID, rot: t * (0.6 + hash(i) * 1.1) * (hash(i + 2) > 0.5 ? 1 : -1) }) },
  { id: 'fx-idle-drift', name: '星群漂浮', kind: 'idle', fresh: true, desc: '每顆各自輕輕繞小圈，大的動得多、小的動得少，有前後層次',
    unit: (i, c, _p, t) => { const st = c.stars[i], amp = st.r * 0.55, w = t * (0.8 + hash(i) * 0.5) + hash(i + 4) * 6.28; return { ...ID, dx: Math.cos(w) * amp, dy: Math.sin(w * 1.3) * amp }; } },
  { id: 'fx-idle-chase', name: '跑馬燈', kind: 'idle', fresh: true, desc: '一個亮點照排列順序一直往前跑，像跑馬燈',
    unit: (i, c, _p, t) => { const n = c.stars.length, pos = (t * Math.max(4, n * 0.35)) % n; let d = Math.abs(c.rank[i] - pos); d = Math.min(d, n - d); const w = Math.exp(-d * d / 3); return { ...ID, s: 1 + w * 0.3, a: 0.45 + w * 0.55 }; } },
  { id: 'fx-idle-sway', name: '輕輕擺盪', kind: 'idle', fresh: true, desc: '每顆像掛著一樣左右擺，彼此錯開（吊飾最適合）',
    unit: (i, c, _p, t) => { const st = c.stars[i], len = Math.max(st.y, c.h * 0.25), ang = Math.sin(t * 1.6 + hash(i) * 6.28) * 0.12; return { ...ID, dx: Math.sin(ang) * len, dy: (Math.cos(ang) - 1) * len, rot: ang }; } },
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
  const addE = ENTRIES.filter(a => s.add.includes(a.id)), addI = IDLES.filter(a => s.add.includes(a.id));
  const delE = OLDS.filter(a => a.kind === 'entry' && s.del.includes(a.id)), delI = OLDS.filter(a => a.kind === 'idle' && s.del.includes(a.id));
  if (addE.length) out.push('花式排列：要加入的進場動畫', addE.map(nm).join(', '));
  if (addI.length) out.push('花式排列：要加入的常駐動畫', addI.map(nm).join(', '));
  if (delE.length) out.push('花式排列：要刪除的原有進場動畫', delE.map(nm).join(', '));
  if (delI.length) out.push('花式排列：要刪除的原有常駐動畫', delI.map(nm).join(', '));
  const renamed = OLDS.filter(a => !s.del.includes(a.id) && s.names[a.id] && s.names[a.id] !== a.name);
  if (renamed.length) out.push('花式排列：原有動畫改名', renamed.map(a => `${a.name}（${a.id}）→ ${s.names[a.id]}`).join(', '));
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
    ctx.fill(new Path2D(fancyStarD(st.x + u.dx, st.y + u.dy + wy(st.x), st.r * u.s, st.rot + u.rot)));
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
  const checked = a.fresh ? sv.add.includes(a.id) : sv.del.includes(a.id);
  const toggle = () => {
    const key = a.fresh ? 'add' : 'del', list = sv[key];
    setSv({ ...sv, [key]: checked ? list.filter(x => x !== a.id) : [...list, a.id] });
  };
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
  const sec = (title: string, list: Anim[]) => (
    <section className="mt-5">
      <div className="text-[11px] font-bold text-white/50 tracking-widest mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-2">{list.map(a => <Card key={a.id} a={a} kind={kind} sv={sv} setSv={setSv} clock={clock} />)}</div>
    </section>
  );
  return (
    <div>
      <div className="text-[12px] text-white/60 leading-relaxed">
        綠色「加入」＝新設計、想放進 App；紅色「刪除」＝App 原本就有、花式排列不要。名字點一下就能改。上面選一種花式排列看效果。
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {KIND_ORDER.map(k => (
          <button key={k} onClick={() => setKind(k)} className={`px-2.5 h-8 rounded-full text-[12px] font-bold ${k === kind ? 'bg-white text-black' : 'bg-white/10 text-white/70'}`}>{KIND_NAMES[k] || k}</button>
        ))}
      </div>
      {sec('進場・新設計（一顆一顆分開動）', ENTRIES)}
      {sec('進場・App 原本就有', OLDS.filter(a => a.kind === 'entry'))}
      {sec('常駐・新設計（一顆一顆分開動）', IDLES)}
      {sec('常駐・App 原本就有', OLDS.filter(a => a.kind === 'idle'))}
    </div>
  );
}
