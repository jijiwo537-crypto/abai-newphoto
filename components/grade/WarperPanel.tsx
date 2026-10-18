import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Scrub, ResetIcon, Chip, clamp, type Ev } from './controls';
import { normGrade, freshGrade, type ColorGrade, type Warp } from '../../utils/colorGrade';
import { buildWarpTable, colAngle, hsHome, hsLocked, clLocked, WARP_HUE_RES, WARP_SAT_RES, FH, FS } from '../../utils/grade/warper';
import { scopeColour, VEC_ANGLE } from '../../utils/grade/common';

/* 色彩扭曲器面板（DaVinci Resolve 的 Color Warper）。
 *
 *   左：網格。色相－飽和度是極座標網格（底色就是那個位置的顏色，方向跟向量示波器一樣），
 *       色度－亮度是直角網格（橫軸沿色軸的色度、縱軸亮度）。
 *       點一個點選取、拖曳搬移；點兩下把那個點放回原位；點空白取消選取。
 *       中心與外圈（直角網格是四邊）鎖住，灰色永遠是灰色。
 *   右：網格切換、解析度（換解析度時已經做的調整會內插到新網格上，跟 Resolve 一樣）、
 *       選取點的數值（色相、飽和度、亮度）、釘選（被釘住的點不會被旁邊的拖動帶走）、
 *       自動鎖定（拖一個點時，幾格內的點跟著柔和移動，再外面的不動）、重置。 */

type Mode = 'hs' | 'cl';
let lastMode: Mode = 'hs';
let lastLock = 1;

const M_MAX = 205;
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export const WarperPanel = React.memo(function WarperPanel({ grade, width, onStart, onChange, onCommit }: {
  grade: ColorGrade | undefined; width: number;
  onStart: () => void; onChange: (g: ColorGrade) => void; onCommit: () => void;
}) {
  const [mode, setModeS] = useState<Mode>(lastMode);
  const setMode = (m: Mode) => { lastMode = m; setModeS(m); setSel(null); };
  const [lock, setLockS] = useState(lastLock);
  const setLock = (n: number) => { lastLock = n; setLockS(n); };
  const [g, setG] = useState(() => normGrade(grade));
  const gRef = useRef(g);
  const dragging = useRef(false);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { if (!dragging.current) { const n = normGrade(grade); gRef.current = n; setG(n); } }, [grade]);
  const ev: Ev = { onStart: () => { dragging.current = true; onStart(); }, onEnd: () => { dragging.current = false; onCommit(); } };
  const pushWarp = (w: Warp) => { const ng = { ...gRef.current, warp: w }; gRef.current = ng; setG(ng); onChange(ng); };
  const W = g.warp;
  const M = Math.min(M_MAX, Math.round(width * 0.5));
  const C = M / 2, Rm = M / 2 - 9;

  /* ── 色相－飽和度網格 ── */
  const hsPos = (w: Warp, j: number, k: number): [number, number] => {
    const [a, b] = hsHome(w.nh, w.ns, j, k), d = w.hs[`${j},${k}`];
    return [a + (d?.da || 0), b + (d?.db || 0)];
  };
  const toScreen = (a: number, b: number): [number, number] => [C + a * Rm, C - b * Rm];
  /* ── 色度－亮度網格 ── */
  const clPos = (w: Warp, i: number, j: number): [number, number] => {
    const d = w.cl[`${i},${j}`];
    return [(i / w.nx) * 2 - 1 + (d?.dx || 0), j / w.ny + (d?.dl || 0) * 0.25];
  };
  const clScreen = (x: number, y: number): [number, number] => [9 + ((x + 1) / 2) * (M - 18), M - 9 - y * (M - 18)];

  /** 拖曳一個點：選取點走 δ，自動鎖定範圍內的點依距離柔和地跟著走，釘住的不動 */
  const moveHs = (key: string, da: number, db: number, dl: number) => {
    const w = gRef.current.warp, [j0, k0] = key.split(',').map(Number);
    const hs = { ...w.hs };
    const lim = 0.45 / w.ns;
    const R = lock;
    for (let k = 1; k < w.ns; k++) for (let j = 0; j < w.nh; j++) {
      const dj = Math.min(Math.abs(j - j0), w.nh - Math.abs(j - j0)), d = Math.max(dj, Math.abs(k - k0));
      const kk = `${j},${k}`;
      if (kk !== key && (d > R || w.hsPins.includes(kk))) continue;
      const f = kk === key ? 1 : 1 - smooth(d / (R + 1));
      if (f <= 0) continue;
      const p = hs[kk] || { da: 0, db: 0, dl: 0 };
      let na = p.da + da * f, nb = p.db + db * f;
      const m = Math.hypot(na, nb); if (m > lim) { na *= lim / m; nb *= lim / m; }
      hs[kk] = { da: na, db: nb, dl: clamp(p.dl + dl * f, -2, 2) };
    }
    pushWarp({ ...w, hs });
  };
  const moveCl = (key: string, dx: number, dl: number) => {
    const w = gRef.current.warp, [i0, j0] = key.split(',').map(Number);
    const cl = { ...w.cl };
    const limX = 0.45 * (2 / w.nx), limL = (0.45 / w.ny) / 0.25;
    for (let i = 1; i < w.nx; i++) for (let j = 1; j < w.ny; j++) {
      const d = Math.max(Math.abs(i - i0), Math.abs(j - j0)), kk = `${i},${j}`;
      if (kk !== key && (d > lock || w.clPins.includes(kk))) continue;
      const f = kk === key ? 1 : 1 - smooth(d / (lock + 1));
      if (f <= 0) continue;
      const p = cl[kk] || { dx: 0, dl: 0 };
      cl[kk] = { dx: clamp(p.dx + dx * f, -limX, limX), dl: clamp(p.dl + dl * f, -limL, limL) };
    }
    pushWarp({ ...w, cl });
  };

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ key: string; pid: number } | null>(null);
  const lastTap = useRef({ t: 0, key: '' });
  const local = (e: React.PointerEvent) => { const r = svgRef.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hit = (x: number, y: number): string | null => {
    let best: string | null = null, bd = 15 * 15;
    const w = gRef.current.warp;
    if (mode === 'hs') {
      for (let k = 1; k < w.ns; k++) for (let j = 0; j < w.nh; j++) {
        const [sx, sy] = toScreen(...hsPos(w, j, k)), d = (sx - x) ** 2 + (sy - y) ** 2;
        if (d < bd) { bd = d; best = `${j},${k}`; }
      }
    } else {
      for (let i = 1; i < w.nx; i++) for (let j = 1; j < w.ny; j++) {
        const [sx, sy] = clScreen(...clPos(w, i, j)), d = (sx - x) ** 2 + (sy - y) ** 2;
        if (d < bd) { bd = d; best = `${i},${j}`; }
      }
    }
    return best;
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const [x, y] = local(e), key = hit(x, y);
    if (!key) { setSel(null); return; }
    const now = performance.now();
    if (lastTap.current.key === key && now - lastTap.current.t < 300) {
      lastTap.current = { t: 0, key: '' };
      const w = gRef.current.warp;
      ev.onStart();
      if (mode === 'hs') { const hs = { ...w.hs }; delete hs[key]; pushWarp({ ...w, hs }); }
      else { const cl = { ...w.cl }; delete cl[key]; pushWarp({ ...w, cl }); }
      ev.onEnd();
      return;
    }
    lastTap.current = { t: now, key };
    setSel(key);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { key, pid: e.pointerId };
    ev.onStart();
  };
  const last = useRef<[number, number]>([0, 0]);
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pid !== e.pointerId) return;
    const p = [e.clientX, e.clientY] as [number, number];
    if (!last.current[0] && !last.current[1]) { last.current = p; return; }
    const dx = (p[0] - last.current[0]) * 0.6, dy = (p[1] - last.current[1]) * 0.6;
    last.current = p;
    if (mode === 'hs') moveHs(d.key, dx / Rm, -dy / Rm, 0);
    else moveCl(d.key, (dx / (M - 18)) * 2, (-dy / (M - 18)) / 0.25);
  };
  const up = (e: React.PointerEvent) => {
    if (drag.current?.pid !== e.pointerId) return;
    drag.current = null; last.current = [0, 0];
    ev.onEnd();
  };

  /* 換解析度：在舊網格的位移場上取新格點的值（跟 Resolve 一樣，已做的調整會內插過去） */
  const setRes = (nh: number, ns: number) => {
    const w = gRef.current.warp;
    if (nh === w.nh && ns === w.ns) return;
    const T = buildWarpTable(w), hs: Warp['hs'] = {};
    for (let k = 1; k < ns; k++) for (let j = 0; j < nh; j++) {
      const u = (j / nh) * FH, v = (k / ns) * (FS - 1);
      const x0 = Math.floor(u) % FH, x1 = (x0 + 1) % FH, fx = u - Math.floor(u), y0 = Math.min(FS - 2, Math.floor(v)), fy = v - y0;
      const at = (x: number, y: number, c: number) => T[(y * FH + x) * 4 + c];
      const val = (c: number) => (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x1, y0 + 1, c) * fx) * fy;
      const da = val(0), db = val(1), dl = val(2);
      if (Math.abs(da) > 1e-5 || Math.abs(db) > 1e-5 || Math.abs(dl) > 1e-5) hs[`${j},${k}`] = { da, db, dl };
    }
    ev.onStart(); pushWarp({ ...w, nh, ns, hs, hsPins: [] }); ev.onEnd();
    setSel(null);
  };

  /* 選取點的數值 */
  const selInfo = useMemo(() => {
    if (!sel) return null;
    const [p, q] = sel.split(',').map(Number);
    if (mode === 'hs') {
      const [ha, hb] = hsHome(W.nh, W.ns, p, q), [a, b] = hsPos(W, p, q);
      let dh = ((Math.atan2(b, a) - Math.atan2(hb, ha)) * 180) / Math.PI; dh = ((dh + 540) % 360) - 180;
      return { hue: dh, sat: Math.hypot(a, b) / Math.hypot(ha, hb), lum: W.hs[sel]?.dl || 0 };
    }
    const d = W.cl[sel];
    return { chroma: d?.dx || 0, lum: (d?.dl || 0) * 0.25 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, W, mode]);
  const setSelField = (k: 'hue' | 'sat' | 'lum' | 'chroma', v: number) => {
    if (!sel) return;
    const w = gRef.current.warp, [p, q] = sel.split(',').map(Number);
    if (mode === 'hs') {
      const [ha, hb] = hsHome(w.nh, w.ns, p, q), cur = w.hs[sel] || { da: 0, db: 0, dl: 0 };
      if (k === 'lum') { pushWarp({ ...w, hs: { ...w.hs, [sel]: { ...cur, dl: v } } }); return; }
      const [a, b] = [ha + cur.da, hb + cur.db];
      let ang = Math.atan2(b, a), mag = Math.hypot(a, b);
      const home = Math.atan2(hb, ha), hm = Math.hypot(ha, hb);
      if (k === 'hue') ang = home + (v * Math.PI) / 180; else mag = hm * v;
      let da = Math.cos(ang) * mag - ha, db = Math.sin(ang) * mag - hb;
      const lim = 0.45 / w.ns, m = Math.hypot(da, db); if (m > lim) { da *= lim / m; db *= lim / m; }
      pushWarp({ ...w, hs: { ...w.hs, [sel]: { ...cur, da, db } } });
    } else {
      const cur = w.cl[sel] || { dx: 0, dl: 0 };
      pushWarp({ ...w, cl: { ...w.cl, [sel]: k === 'chroma' ? { ...cur, dx: v } : { ...cur, dl: v / 0.25 } } });
    }
  };
  const pinned = sel ? (mode === 'hs' ? W.hsPins : W.clPins).includes(sel) : false;
  const togglePin = () => {
    if (!sel) return;
    const w = gRef.current.warp, list = mode === 'hs' ? w.hsPins : w.clPins;
    const next = list.includes(sel) ? list.filter(x => x !== sel) : [...list, sel];
    ev.onStart(); pushWarp(mode === 'hs' ? { ...w, hsPins: next } : { ...w, clPins: next }); ev.onEnd();
  };
  const reset = () => {
    const w = gRef.current.warp, f = freshGrade().warp;
    ev.onStart();
    pushWarp(mode === 'hs' ? { ...w, hs: {}, hsPins: [] } : { ...w, cl: {}, clPins: [], axis: f.axis });
    ev.onEnd(); setSel(null);
  };

  /* ── 畫網格 ── */
  const hsBg = `radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128,0) 100%), conic-gradient(${Array.from({ length: 37 }, (_, i) => `${scopeColour(90 - i * 10, 0.3)} ${i * 10}deg`).join(',')})`;
  const axisCol = scopeColour(W.axis, 0.25), oppCol = scopeColour(W.axis + 180, 0.25);
  const clBg = `linear-gradient(0deg, rgba(0,0,0,.85), rgba(0,0,0,0) 50%, rgba(255,255,255,.75)), linear-gradient(90deg, ${oppCol}, #808080, ${axisCol})`;
  const lines: string[] = [], dots: { x: number; y: number; key: string; locked: boolean }[] = [];
  if (mode === 'hs') {
    for (let k = 1; k <= W.ns; k++) {
      let d = '';
      for (let j = 0; j <= W.nh; j++) { const [x, y] = toScreen(...hsPos(W, j % W.nh, k)); d += `${j ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }
      lines.push(d);
    }
    for (let j = 0; j < W.nh; j++) {
      let d = `M${C} ${C}`;
      for (let k = 1; k <= W.ns; k++) { const [x, y] = toScreen(...hsPos(W, j, k)); d += `L${x.toFixed(1)} ${y.toFixed(1)}`; }
      lines.push(d);
    }
    for (let k = 1; k <= W.ns; k++) for (let j = 0; j < W.nh; j++) { const [x, y] = toScreen(...hsPos(W, j, k)); dots.push({ x, y, key: `${j},${k}`, locked: hsLocked(W.ns, k) }); }
    dots.push({ x: C, y: C, key: 'c', locked: true });
  } else {
    for (let j = 0; j <= W.ny; j++) { let d = ''; for (let i = 0; i <= W.nx; i++) { const [x, y] = clScreen(...clPos(W, i, j)); d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; } lines.push(d); }
    for (let i = 0; i <= W.nx; i++) { let d = ''; for (let j = 0; j <= W.ny; j++) { const [x, y] = clScreen(...clPos(W, i, j)); d += `${j ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; } lines.push(d); }
    for (let i = 0; i <= W.nx; i++) for (let j = 0; j <= W.ny; j++) { const [x, y] = clScreen(...clPos(W, i, j)); dots.push({ x, y, key: `${i},${j}`, locked: clLocked(W.nx, W.ny, i, j) }); }
  }
  const pins = mode === 'hs' ? W.hsPins : W.clPins;
  const cyc = (list: number[], v: number) => list[(list.indexOf(v) + 1) % list.length];
  const fs = (label: string, value: number, spec: { def: number; min: number; max: number; digits: number; span: number }, k: 'hue' | 'sat' | 'lum' | 'chroma') => (
    <Scrub key={k} label={label} value={value} spec={spec} onChange={v => setSelField(k, v)} {...ev} />
  );
  return (
    <div className="w-full h-full flex items-center gap-3 px-3 py-[8px]" data-warper-panel>
      <div className="relative shrink-0" style={{ width: M, height: M }}>
        <div className={`absolute inset-[9px] ${mode === 'hs' ? 'rounded-full' : 'rounded-[3px]'}`} style={{ background: mode === 'hs' ? hsBg : clBg, opacity: 0.55 }} />
        <svg ref={svgRef} width={M} height={M} className="absolute inset-0 touch-none select-none" data-warper-mesh={mode}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {mode === 'cl' && <line x1={C} y1={9} x2={C} y2={M - 9} stroke="rgba(255,255,255,.25)" strokeDasharray="3 3" />}
          {lines.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="0.9" />)}
          {dots.map(p => {
            const isSel = p.key === sel, isPin = pins.includes(p.key);
            return <circle key={p.key} cx={p.x} cy={p.y} r={isSel ? 5 : p.locked ? 2 : 3.4}
              fill={isSel ? '#fff' : p.locked ? 'rgba(255,255,255,.45)' : isPin ? '#000' : 'rgba(255,255,255,.9)'}
              stroke={isPin ? '#fff' : isSel ? '#000' : 'none'} strokeWidth={isPin ? 1.6 : 1} />;
          })}
        </svg>
      </div>
      <div className="flex-1 min-w-0 h-full flex flex-col justify-between">
        <div className="flex gap-[5px]">
          <Chip on={mode === 'hs'} onClick={() => setMode('hs')} data-warper-mode="hs" dot={Object.keys(W.hs).length > 0}>色相飽和</Chip>
          <Chip on={mode === 'cl'} onClick={() => setMode('cl')} data-warper-mode="cl" dot={Object.keys(W.cl).length > 0}>色度亮度</Chip>
        </div>
        {mode === 'hs' ? (
          <div className="flex gap-[5px]">
            <Chip on={false} onClick={() => setRes(cyc(WARP_HUE_RES, W.nh), W.ns)} data-warper-res="h">色相 {W.nh}</Chip>
            <Chip on={false} onClick={() => setRes(W.nh, cyc(WARP_SAT_RES, W.ns))} data-warper-res="s">飽和 {W.ns}</Chip>
          </div>
        ) : (
          <div className="flex">
            <Scrub label="色軸" value={W.axis} spec={{ def: VEC_ANGLE.skin, min: 0, max: 360, digits: 0, span: 180 }}
              onChange={v => pushWarp({ ...gRef.current.warp, axis: v })} {...ev} />
          </div>
        )}
        <div className="flex gap-[4px] min-h-[34px]">
          {selInfo ? (mode === 'hs' ? <>
            {fs('色相°', selInfo.hue!, { def: 0, min: -60, max: 60, digits: 1, span: 40 }, 'hue')}
            {fs('飽和×', selInfo.sat!, { def: 1, min: 0.3, max: 2, digits: 2, span: 0.8 }, 'sat')}
            {fs('亮度檔', selInfo.lum, { def: 0, min: -2, max: 2, digits: 2, span: 1.5 }, 'lum')}
          </> : <>
            {fs('色度', selInfo.chroma!, { def: 0, min: -0.25, max: 0.25, digits: 3, span: 0.2 }, 'chroma')}
            {fs('亮度', selInfo.lum, { def: 0, min: -0.06, max: 0.06, digits: 3, span: 0.05 }, 'lum')}
          </>) : <span className="text-[10.5px] leading-[14px] text-white/40">點網格上的點選取，拖曳搬移顏色；點兩下放回原位</span>}
        </div>
        <div className="flex gap-[5px] items-center">
          <Chip on={pinned} onClick={togglePin} data-warper-pin>{pinned ? '已釘選' : '釘選'}</Chip>
          <Chip on={false} onClick={() => setLock((lock + 1) % 4)} data-warper-lock>自動鎖定 {lock}</Chip>
          <button onClick={reset} className="w-[24px] h-[24px] flex items-center justify-center" aria-label="重置"><ResetIcon on /></button>
        </div>
      </div>
    </div>
  );
});

export { colAngle };
