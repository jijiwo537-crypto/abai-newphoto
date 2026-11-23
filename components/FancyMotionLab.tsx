/* 測試網站：花式排列的動畫實驗室。
   花式排列是很多顆星星組成的，所以除了 App 原本「整組一起動」的動畫，
   這裡另外設計「一顆一顆分開動、有層次」的進場與常駐動畫。
   ‧ 新設計的：勾「加入」＝想放進 App
   ‧ App 原本就有的：勾「刪除」＝花式排列不要這個
   ‧ 每一個都可以改名
   結果存在這台裝置（localStorage），「複製順序」時一起帶出去（見 fancyMotionReport）。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FANCY_KINDS, fancyGeometry, fancyRatio, fancyStarD, fancyPathD, fancyAlphaMask, paintWithFancyMask, type FancyStar, type FancyLine } from '../utils/fancyShapes';
import { objectMotionFrame } from '../utils/objectMotion';
import { idleDefaults } from '../utils/animationDefaults';

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

import { ENTRIES, IDLES, ID, ctxOf, clamp, ENTRY_DUR, HOLD, GAP, FANCY_MOTION_CFG, fancyMotionLists, fancyMotionTag, fancyEntryDur, isFancyMotion, type Anim, type Ctx, type U } from '../utils/fancyMotion';
/* ───────── App 原本就有的（花式排列現在吃的那一組） ───────── */
const OLD_ENTRY: [string, string][] = [['pop', '果凍'], ['fade', '淡入'], ['rise', '升起'], ['drop', '落下'], ['spin', '旋轉'], ['flip', '翻轉'], ['spring', '流星']];
const OLD_IDLE: [string, string][] = [['float', '漂浮'], ['grid-wave', '波浪'], ['breathe', '縮放'], ['spin', '旋轉'], ['wobble', '搖擺'], ['orbit', '繞圈'], ['jitter', '抖動']];
const OLDS: Anim[] = [
  ...OLD_ENTRY.map(([id, name]) => ({ id: `in:${id}`, name, kind: 'entry' as const, fresh: false, desc: 'App 原本就有（整組一起動）', group: id })),
  ...OLD_IDLE.map(([id, name]) => ({ id: `idle:${id}`, name, kind: 'idle' as const, fresh: false, desc: 'App 原本就有（整組一起動）', group: id })),
];
export const FANCY_MOTION_ALL: Anim[] = [...OLDS.filter(a => a.kind === 'entry'), ...ENTRIES, ...OLDS.filter(a => a.kind === 'idle'), ...IDLES];

/** 「複製順序」要帶出去的那幾行 */
/* ───────── 按鈕順序（照正式版的樣子：一排四個，長按拖曳） ───────── */
const ORDER_STORE = 'abai-order-tool-fancy-btn-order-v1';
type BtnOrder = Record<string, { in?: string[]; idle?: string[] }>;
const loadOrder = (): BtnOrder => { try { return JSON.parse(localStorage.getItem(ORDER_STORE) || '{}') || {}; } catch { return {}; } };
const saveOrder = (o: BtnOrder) => { try { localStorage.setItem(ORDER_STORE, JSON.stringify(o)); } catch { /* */ } };
const APP_IN = [['none', '無'], ['pop', '果凍'], ['fade', '淡入'], ['rise', '升起'], ['drop', '落下'], ['spin', '旋轉'], ['flip', '翻轉'], ['spring', '流星']].map(([id, name]) => ({ id, name }));
const APP_IDLE = [['none', '靜止'], ['float', '漂浮'], ['grid-wave', '波浪'], ['breathe', '縮放'], ['spin', '旋轉'], ['wobble', '搖擺'], ['orbit', '繞圈'], ['jitter', '抖動']].map(([id, name]) => ({ id, name }));
/** 正式版這一種貼圖的按鈕（名字、l／ll 都跟 App 一樣），套上排過的順序 */
const appButtons = (k: string, phase: 'in' | 'idle', ord: BtnOrder) => {
  const l = fancyMotionLists(k, APP_IN, APP_IDLE, (id, name) => ({ id, name }))!;
  const list = phase === 'in' ? l.kinds : l.idleKinds, saved = ord[k]?.[phase] || [];
  const rank = (id: string) => { const i = saved.indexOf(id); return i < 0 ? 1e3 + list.findIndex(x => x.id === id) : i; };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
};
export const fancyMotionReport = (): string[] => {
  const s = load(), out: string[] = [];
  const ord = loadOrder();
  for (const k of KIND_ORDER) for (const ph of ['in', 'idle'] as const) if (ord[k]?.[ph]?.length) {
    out.push(`花式排列・${KIND_NAMES[k]}（${k}）${ph === 'in' ? '進場' : '常駐'}按鈕順序`, appButtons(k, ph, ord).map(b => `${b.name}（${b.id}）`).join(', '));
  }
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
  const cl = findClashes(s);
  if (cl.length) out.push('⚠ 動畫名稱重複（同一個貼圖、同一類裡同名）', cl.map(c => `${KIND_NAMES[c.kind]}・${c.phase === 'entry' ? '進場' : '常駐'}「${c.name}」`).join(', '));
  return out;
};
export const fancyMotionChanged = () => fancyMotionReport().length > 0;
export const fancyMotionReset = () => { try { localStorage.removeItem(STORE); localStorage.removeItem(ORDER_STORE); } catch { /* */ } };

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

/* ───────── 改名工具 ─────────
   ‧ 進場、常駐分開兩張表；每一列是一個動畫：新名字、原名、代號、哪些貼圖有用到
   ‧ 可以勾好幾個一起改成同一個名字；點「同名」的按鈕會把同名的全部勾起來
   ‧ 檢查重複：同一個貼圖、同一類（進場／常駐）裡面，兩個動畫不能叫同一個名字（「無」「靜止」也算） */
const APP_CFG_INCLUDED = (k: string, a: Anim): boolean => {
  const c = FANCY_MOTION_CFG[k]; if (!c) return !a.fresh;
  const raw = a.id.replace(/^in:|^idle:/, '');
  if (a.fresh) return (a.kind === 'entry' ? c.addIn : c.addIdle).includes(a.id);
  return !(a.kind === 'entry' ? c.delIn : c.delIdle).includes(raw);
};
/** 這個貼圖有沒有這個動畫：測試網站裡有勾過這個貼圖就照勾的，沒勾過就照 App 現在的 */
const kindHas = (sv: Saved, k: string, a: Anim) => sv.kinds[k] ? included(pickOf(sv, k), a) : APP_CFG_INCLUDED(k, a);
const nameOf = (sv: Saved, a: Anim) => (sv.names[a.id] ?? a.name).trim();
type Clash = { kind: string; phase: 'entry' | 'idle'; name: string; ids: string[] };
const findClashes = (sv: Saved): Clash[] => {
  const out: Clash[] = [];
  for (const k of KIND_ORDER) for (const phase of ['entry', 'idle'] as const) {
    const by = new Map<string, string[]>();
    by.set(phase === 'entry' ? '無' : '靜止', [phase === 'entry' ? 'none' : 'none']);
    for (const a of FANCY_MOTION_ALL) if (a.kind === phase && kindHas(sv, k, a)) {
      const n = nameOf(sv, a); by.set(n, [...(by.get(n) || []), a.id]);
    }
    by.forEach((ids, name) => { if (ids.length > 1) out.push({ kind: k, phase, name, ids }); });
  }
  return out;
};
export const fancyMotionClashes = () => findClashes(load());

const RenameTool: React.FC<{ sv: Saved; setSv: (s: Saved) => void }> = ({ sv, setSv }) => {
  const [sel, setSel] = useState<string[]>([]);
  const [batch, setBatch] = useState('');
  const [q, setQ] = useState('');
  const clashes = findClashes(sv);
  const clashIds = new Set(clashes.flatMap(c => c.ids));
  const setName = (ids: string[], n: string) => {
    const names = { ...sv.names };
    for (const id of ids) { const a = FANCY_MOTION_ALL.find(x => x.id === id)!; if (n.trim() === '' || n === a.name) delete names[id]; else names[id] = n; }
    setSv({ ...sv, names });
  };
  const table = (phase: 'entry' | 'idle', title: string) => {
    const list = FANCY_MOTION_ALL.filter(a => a.kind === phase && (!q || nameOf(sv, a).includes(q) || a.name.includes(q) || a.id.includes(q)));
    // 同一類裡同名的（不管哪個貼圖）：方便一次勾起來改
    const groups = new Map<string, string[]>();
    FANCY_MOTION_ALL.filter(a => a.kind === phase).forEach(a => { const n = nameOf(sv, a); groups.set(n, [...(groups.get(n) || []), a.id]); });
    const same = [...groups].filter(([, ids]) => ids.length > 1);
    return (
      <section className="mt-5">
        <div className="text-[11px] font-bold text-white/50 tracking-widest mb-2">{title}（{list.length}）</div>
        {same.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5 items-center text-[11px]">
          <span className="text-white/45">同名的：</span>
          {same.map(([n, ids]) => <button key={n} onClick={() => setSel(s0 => [...new Set([...s0, ...ids])])} className="px-2 h-7 rounded-md bg-[#f2c86b]/15 text-[#f2c86b] border border-[#f2c86b]/30">「{n}」×{ids.length} 全選</button>)}
        </div>}
        <div className="rounded-[10px] border border-white/10 overflow-hidden">
          {list.map(a => {
            const on = sel.includes(a.id), bad = clashIds.has(a.id), used = KIND_ORDER.filter(k => kindHas(sv, k, a));
            return (
              <div key={a.id} className={`flex items-start gap-2 px-2.5 py-2 border-b border-white/5 last:border-0 ${bad ? 'bg-[#e57a7a]/10' : on ? 'bg-white/[0.06]' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => setSel(s0 => on ? s0.filter(x => x !== a.id) : [...s0, a.id])} className="w-4 h-4 mt-2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <input value={sv.names[a.id] ?? a.name} onChange={e => setName([a.id], e.target.value)}
                      className={`w-28 bg-black/40 border rounded px-2 h-8 text-[13px] text-white select-text ${bad ? 'border-[#e57a7a]' : 'border-white/10'}`} style={{ WebkitUserSelect: 'text' }} />
                    <span className="text-[11px] text-white/40 truncate">原名 {a.name}・{a.id}{a.fresh ? '・新設計' : ''}</span>
                    {sv.names[a.id] !== undefined && <button onClick={() => setName([a.id], a.name)} className="ml-auto shrink-0 px-2 h-7 rounded bg-white/10 text-[11px]">還原</button>}
                  </div>
                  <div className="mt-1 text-[10px] text-white/35 leading-snug">{used.length ? '用在：' + used.map(k => KIND_NAMES[k]).join('、') : '目前沒有貼圖用到'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };
  return (
    <div>
      {/* 重複檢查 */}
      <div className={`mt-4 rounded-[10px] border p-3 text-[12px] ${clashes.length ? 'border-[#e57a7a]/50 bg-[#e57a7a]/10' : 'border-[#9fd3a8]/40 bg-[#9fd3a8]/10'}`}>
        {clashes.length === 0 ? <b className="text-[#9fd3a8]">✓ 沒有重複：每一個貼圖的進場、常駐裡，名字都不一樣</b> : <>
          <b className="text-[#e57a7a]">有 {clashes.length} 個重複（同一個貼圖、同一類裡兩個動畫同名）</b>
          <div className="mt-1.5 space-y-1">{clashes.map((c, i) => (
            <div key={i} className="text-white/75">{KIND_NAMES[c.kind]}・{c.phase === 'entry' ? '進場' : '常駐'}：「{c.name}」＝{c.ids.map(id => id === 'none' ? (c.phase === 'entry' ? '無' : '靜止') : `${FANCY_MOTION_ALL.find(x => x.id === id)?.name}（${id}）`).join('、')}</div>
          ))}</div>
        </>}
      </div>
      {/* 一起改 */}
      <div className="sticky top-0 z-10 mt-3 rounded-[10px] border border-white/10 bg-[#111] p-2.5 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-white/60">已勾 {sel.length} 個</span>
        <input value={batch} onChange={e => setBatch(e.target.value)} placeholder="新名字" className="w-28 bg-black/40 border border-white/10 rounded px-2 h-8 text-[13px] select-text" style={{ WebkitUserSelect: 'text' }} />
        <button disabled={!sel.length || !batch.trim()} onClick={() => { setName(sel, batch.trim()); setSel([]); setBatch(''); }} className="px-3 h-8 rounded bg-white text-black font-bold disabled:opacity-30">全部改成這個</button>
        <button disabled={!sel.length} onClick={() => setName(sel, '')} className="px-3 h-8 rounded bg-white/10 disabled:opacity-30">還原原名</button>
        <button disabled={!sel.length} onClick={() => setSel([])} className="px-3 h-8 rounded bg-white/10 disabled:opacity-30">取消勾選</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋名字／代號" className="ml-auto w-32 bg-black/40 border border-white/10 rounded px-2 h-8 text-[13px] select-text" style={{ WebkitUserSelect: 'text' }} />
      </div>
      {table('entry', '進場動畫')}
      {table('idle', '常駐動畫')}
    </div>
  );
};

/* 按鈕順序頁的預覽：用 App 正式的畫法（整組動畫＋每顆星星的動畫字串＋透明度遮罩），不是測試網站自己的簡化版 */
const AppPreview: React.FC<{ kind: string; ph: 'in' | 'idle'; id: string }> = ({ kind, ph, id }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext('2d')!, S = 220, dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = S * dpr; cv.height = S * dpr;
    const ratio = fancyRatio(kind), w = ratio > 1 ? S * 0.62 / ratio : S * 0.62, h = w * ratio;
    const d = idleDefaults(ph === 'idle' ? id : 'none', { shape: true });
    const cfg = ph === 'in' ? { in: id, idle: 'none', delay: 0.3, dur: 0.63, amp: 50, speed: 0.84 }
      : { in: 'none', idle: id, delay: 0, dur: 0.63, amp: d.amp, speed: d.speed };
    const loop = ph === 'in' ? 0.3 + (isFancyMotion(id) ? fancyEntryDur(0.63) : 0.63) + 1.2 : 1e9;
    let raf = 0; const t0 = performance.now();
    const draw = () => {
      const time = ((performance.now() - t0) / 1000) % loop;
      const f = objectMotionFrame(cfg as any, time, 0), tag = fancyMotionTag(cfg as any, time);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.translate(S / 2 + f.dx * w, S / 2 + f.dy * h); g.rotate(f.rot * Math.PI / 180); g.scale(f.k * (f.fx ?? 1), f.k);
      g.globalAlpha = Math.max(0, Math.min(1, f.a));
      const k = 'fancy-' + kind.replace('fancy-', '') + (tag ? '!' + tag : '');
      const body = (c: CanvasRenderingContext2D, kk: string) => { c.fillStyle = '#fff'; c.fill(new Path2D(fancyPathD(kk, w, h))); };
      const m = tag ? fancyAlphaMask(k, w, h) : null;
      if (m) paintWithFancyMask(g, m, w, h, -w / 2, -h / 2, w, h, c => { c.translate(-w / 2, -h / 2); body(c, k + '|m'); });
      else { g.translate(-w / 2, -h / 2); body(g, k); }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kind, ph, id]);
  return <canvas ref={ref} style={{ width: 220, height: 220, display: 'block', margin: '0 auto', background: '#111', borderRadius: 10 }} />;
};

const OrderTool: React.FC<{ onChange?: () => void }> = ({ onChange }) => {
  const [preview, setPreview] = useState<{ ph: 'in' | 'idle'; id: string } | null>(null);
  const [kind, setKind] = useState(KIND_ORDER[0]);
  const [ord, setOrd0] = useState<BtnOrder>(loadOrder);
  const setOrd = (o: BtnOrder) => { setOrd0(o); saveOrder(o); onChange?.(); };
  useEffect(() => { const f = () => setOrd0(loadOrder()); window.addEventListener('abai-fancy-motion-reset', f); return () => window.removeEventListener('abai-fancy-motion-reset', f); }, []);
  /* 長按 0.3 秒浮起來，拖到哪一格就插到哪一格（跟其他排序頁同一種操作） */
  const [drag, setDrag] = useState<{ ph: 'in' | 'idle'; id: string; x: number; y: number } | null>(null);
  const hold = useRef<{ t: number; ph: 'in' | 'idle'; id: string; pid: number; fired: boolean } | null>(null);
  const down = (e: React.PointerEvent, ph: 'in' | 'idle', id: string) => {
    const x = e.clientX, y = e.clientY, pid = e.pointerId, el = e.currentTarget as HTMLElement;
    const t = window.setTimeout(() => { if (hold.current) hold.current.fired = true; try { el.setPointerCapture(pid); } catch { /* */ } setDrag({ ph, id, x, y }); try { navigator.vibrate?.(10); } catch { /* */ } }, 300);
    hold.current = { t, ph, id, pid, fired: false };
  };
  const cancel = () => { if (hold.current) clearTimeout(hold.current.t); hold.current = null; };
  const move = (e: React.PointerEvent) => {
    if (!drag) { if (hold.current) cancel(); return; }
    setDrag({ ...drag, x: e.clientX, y: e.clientY });
    const over = (document.elementsFromPoint(e.clientX, e.clientY).find(n => (n as HTMLElement).dataset?.btn && (n as HTMLElement).dataset?.ph === drag.ph) as HTMLElement | undefined)?.dataset.btn;
    if (!over || over === drag.id) return;
    const ids = appButtons(kind, drag.ph, ord).map(b => b.id), from = ids.indexOf(drag.id), to = ids.indexOf(over);
    ids.splice(from, 1); ids.splice(to, 0, drag.id);
    setOrd({ ...ord, [kind]: { ...(ord[kind] || {}), [drag.ph]: ids } });
  };
  // 沒有長按（點一下）＝預覽這個動畫
  const up = () => { const h = hold.current; if (h && !h.fired && !drag) setPreview({ ph: h.ph, id: h.id }); cancel(); setDrag(null); };
  const grid = (ph: 'in' | 'idle', title: string) => {
    const list = appButtons(kind, ph, ord);
    return (
      <section className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-[#666] tracking-widest">{title}</p>
          {ord[kind]?.[ph] && <button onClick={() => { const q = { ...(ord[kind] || {}) }; delete q[ph]; setOrd({ ...ord, [kind]: q }); }} className="px-2 h-7 rounded bg-white/10 text-[11px]">回到預設順序</button>}
        </div>
        {/* 跟正式版的動畫頁同一個樣子：一排四個 */}
        <div className="grid grid-cols-4 gap-2">
          {list.map(b => {
            const lifted = drag?.ph === ph && drag.id === b.id;
            return <button key={b.id} data-btn={b.id} data-ph={ph}
              onPointerDown={e => down(e, ph, b.id)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onContextMenu={e => e.preventDefault()}
              className={`h-9 rounded-[8px] border text-[10px] font-bold tracking-wider transition-all touch-none ${lifted ? 'opacity-30 border-white' : preview?.ph === ph && preview.id === b.id ? 'bg-[#222] text-white border-white' : 'border-[#1a1a1a] text-[#aaa] bg-[#0b0b0b]'}`}>{b.name}</button>;
          })}
        </div>
      </section>
    );
  };
  const draggedName = drag ? appButtons(kind, drag.ph, ord).find(b => b.id === drag.id)?.name : '';
  return (
    <div>
      <div className="text-[12px] text-white/60 leading-relaxed">按鈕的名字和多少個，都跟正式版這一種貼圖的動畫頁一模一樣。點一下按鈕看動畫；長按一顆浮起來，拖到想要的位置放開。每一種貼圖各自排。</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {KIND_ORDER.map(k => (
          <button key={k} onClick={() => setKind(k)} className={`px-2.5 h-8 rounded-full text-[12px] font-bold ${k === kind ? 'bg-white text-black' : 'bg-white/10 text-white/70'}`}>{KIND_NAMES[k]}{ord[k]?.in || ord[k]?.idle ? ' •' : ''}</button>
        ))}
      </div>
      {/* 點一下按鈕就在這裡播（跟 App 一樣的畫法）；進場會一直重播 */}
      <div className="sticky top-0 z-10 mt-3 bg-black/90 py-2">
        {preview ? <AppPreview key={kind + preview.ph + preview.id} kind={kind} ph={preview.ph} id={preview.id} />
          : <div className="h-[220px] max-w-[220px] mx-auto rounded-[10px] bg-[#111] flex items-center justify-center text-[12px] text-white/40">點一下按鈕看動畫</div>}
      </div>
      <div className="mt-2 max-w-md mx-auto rounded-[12px] border border-white/10 bg-black p-3">
        {grid('in', '進場動畫')}
        {grid('idle', '常駐動畫')}
      </div>
      {drag && <div className="fixed z-50 pointer-events-none h-9 px-4 rounded-[8px] border border-white bg-[#222] text-white text-[11px] font-bold flex items-center shadow-[0_8px_24px_rgba(0,0,0,.6)]"
        style={{ left: drag.x, top: drag.y, transform: 'translate(-50%,-60%) scale(1.08)' }}>{draggedName}</div>}
    </div>
  );
};

export function FancyMotionLab({ onChange }: { onChange?: () => void }) {
  const [mode, setMode] = useState<'pick' | 'rename' | 'order'>('pick');
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
  const modeBar = (
    <div className="flex gap-1.5 mb-3">
      {([['pick', '預覽・勾選'], ['rename', '改名工具'], ['order', '按鈕順序']] as const).map(([m, t]) => (
        <button key={m} onClick={() => setMode(m)} className={`px-3 h-8 rounded-full text-[12px] font-bold ${mode === m ? 'bg-white text-black' : 'bg-white/10 text-white/70'}`}>{t}</button>
      ))}
    </div>
  );
  if (mode === 'rename') return <div>{modeBar}<RenameTool sv={sv} setSv={setSv} /></div>;
  if (mode === 'order') return <div>{modeBar}<OrderTool onChange={onChange} /></div>;
  return (
    <div>
      {modeBar}
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
