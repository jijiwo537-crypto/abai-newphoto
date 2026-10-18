import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sampleCurve, type CurvePt } from '../../utils/grade/spline';
import { isHueAxis, hueAxisColour, curveAmountLabel, type HueCurveId } from '../../utils/grade/hueCurves';

/* 色相／亮度／飽和度曲線的編輯框（跟 RGB 曲線同一個 240×240 的白色格線框）。
 *
 *   · 中間那條虛線是「不變」。點空白處＝在曲線上加一個點並可直接拖。
 *   · 拖點：左右改輸入、上下改量。點兩下刪掉那個點。
 *   · 底下那條色帶（色相／亮度／飽和度）點一下：跟達芬奇一樣，
 *     在最近的那個向量（紅黃綠青藍洋紅）加一個點，兩旁再各加一個固定點，
 *     只拉中間那個就只會動到那一段顏色。
 *   · 色相軸是循環的：最左邊跟最右邊是同一個紅色，曲線頭尾相接。 */

const BOX = 240, STRIP = 14;
const VECTORS = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];

export const HueCurveBox: React.FC<{
  id: HueCurveId; pts: CurvePt[];
  onStart: () => void; onChange: (pts: CurvePt[]) => void; onCommit: () => void;
}> = ({ id, pts: ptsProp, onStart, onChange, onCommit }) => {
  const periodic = isHueAxis(id);
  const [pts, setPts] = useState<CurvePt[]>(ptsProp);
  const [sel, setSel] = useState(-1);
  const drag = useRef<{ i: number; pid: number } | null>(null);
  const lastTap = useRef({ t: 0, i: -1 });
  const ptsRef = useRef(pts);
  useEffect(() => { if (!drag.current) { ptsRef.current = ptsProp; setPts(ptsProp); } }, [ptsProp]);
  useEffect(() => { setSel(-1); }, [id]);
  const push = (p: CurvePt[]) => { ptsRef.current = p; setPts(p); onChange(p); };

  const N = 120;
  const tab = useMemo(() => sampleCurve(pts.length ? pts : [{ x: 0.5, y: 0.5 }], N, periodic, 0.5), [pts, periodic]);
  const yAt = (x: number) => {
    const f = periodic ? (x - Math.floor(x)) * N : Math.min(1, Math.max(0, x)) * (N - 1);
    const i = Math.floor(f), t = f - i;
    const a = tab[periodic ? i % N : Math.min(N - 1, i)], b = tab[periodic ? (i + 1) % N : Math.min(N - 1, i + 1)];
    return a + (b - a) * t;
  };
  const H = BOX - STRIP;
  const path = useMemo(() => {
    let d = '';
    for (let j = 0; j <= 96; j++) { const x = j / 96; d += `${j ? 'L' : 'M'}${(x * BOX).toFixed(1)} ${((1 - yAt(x)) * H).toFixed(1)}`; }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const local = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * BOX, y: (e.clientY - r.top) / r.height * BOX };
  };
  const hitPoint = (x: number, y: number) => {
    let best = -1, bd = 22 * 22;
    pts.forEach((p, i) => { const dx = p.x * BOX - x, dy = (1 - p.y) * H - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const sorted = (p: CurvePt[]) => [...p].sort((a, b) => a.x - b.x);

  const down = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const { x, y } = local(e);
    // 色帶：在最近的向量加三個點
    if (y > H) {
      const xv = x / BOX;
      let v = 0, bd = 9;
      const cand = periodic ? VECTORS : [0, 0.2, 0.4, 0.6, 0.8, 1];
      for (const c of cand) { const d = Math.min(Math.abs(c - xv), periodic ? 1 - Math.abs(c - xv) : 9); if (d < bd) { bd = d; v = c; } }
      const w = periodic ? 1 / 12 : 0.1;
      const add = [v - w, v, v + w].map(q => periodic ? q - Math.floor(q) : Math.min(1, Math.max(0, q)));
      const cur = ptsRef.current.filter(p => !add.some(q => Math.abs(p.x - q) < 0.01));
      const next = sorted([...cur, ...add.map(q => ({ x: q, y: yAt(q) }))]);
      onStart(); push(next); onCommit();
      setSel(next.findIndex(p => Math.abs(p.x - v) < 1e-6));
      return;
    }
    let i = hitPoint(x, y);
    const now = performance.now();
    if (i >= 0 && lastTap.current.i === i && now - lastTap.current.t < 300) {
      lastTap.current = { t: 0, i: -1 };
      onStart(); push(ptsRef.current.filter((_, k) => k !== i)); onCommit(); setSel(-1);
      return;
    }
    onStart();
    if (i < 0) {
      const p = { x: Math.min(1, Math.max(0, x / BOX)), y: yAt(x / BOX) };
      const next = sorted([...ptsRef.current, p]);
      i = next.indexOf(p);
      push(next);
    }
    lastTap.current = { t: now, i };
    setSel(i);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { i, pid: e.pointerId };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pid !== e.pointerId) return;
    const { x, y } = local(e);
    const cur = ptsRef.current, i = d.i;
    const lo = i > 0 ? cur[i - 1].x + 0.004 : 0, hi = i < cur.length - 1 ? cur[i + 1].x - 0.004 : 1;
    const nx = Math.min(hi, Math.max(lo, x / BOX));
    let ny = 1 - y / H; ny = Math.min(1, Math.max(0, ny));
    // 靠近中線時吸附，方便拉回「不變」
    if (Math.abs(ny - 0.5) < 0.012) ny = 0.5;
    const next = cur.map((p, k) => k === i ? { x: nx, y: ny } : p);
    push(next);
  };
  const up = (e: React.PointerEvent) => { if (drag.current?.pid !== e.pointerId) return; drag.current = null; onCommit(); };

  const stripBg = periodic
    ? `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, k) => hueAxisColour(k / 12)).join(',')})`
    : id === 'ls' ? 'linear-gradient(90deg, #000, #fff)'
    : `linear-gradient(90deg, #808080, ${hueAxisColour(0)})`;
  const selPt = sel >= 0 ? pts[sel] : null;
  return (
    <div className="relative shrink-0 touch-none select-none border border-white rounded-sm" style={{ width: BOX, height: BOX }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-hue-curve={id}>
      <svg className="absolute inset-0 overflow-visible pointer-events-none" width={BOX} height={BOX}>
        <g stroke="#fff" strokeWidth="1" shapeRendering="crispEdges">
          {[1, 2, 3].map(k => <line key={`v${k}`} x1={(k * BOX) / 4} y1={0} x2={(k * BOX) / 4} y2={H} />)}
          {[1, 3].map(k => <line key={`h${k}`} x1={0} y1={(k * H) / 4} x2={BOX} y2={(k * H) / 4} />)}
        </g>
        <line x1={0} y1={H / 2} x2={BOX} y2={H / 2} stroke="#fff" strokeWidth="1" strokeDasharray="4 3" opacity={0.9} />
        <path d={path} fill="none" stroke="#ffd34d" strokeWidth="1.8" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x * BOX} cy={(1 - p.y) * H} r={i === sel ? 6.5 : 5.5}
            fill={i === sel ? '#ffd34d' : '#111'} stroke="#ffd34d" strokeWidth="1.8" />
        ))}
      </svg>
      <div className="absolute left-0 right-0 bottom-0 pointer-events-none" style={{ height: STRIP, background: stripBg, borderTop: '1px solid #fff' }}>
        {(periodic ? VECTORS : []).map(v => <span key={v} className="absolute top-1/2 w-[5px] h-[5px] -ml-[2.5px] -mt-[2.5px] rounded-full bg-white/90 border border-black/50" style={{ left: `${v * 100}%` }} />)}
      </div>
      {selPt && (
        <div className="absolute left-1 top-1 px-1.5 py-[1px] rounded bg-black/70 text-[10px] text-white tabular-nums pointer-events-none">
          {curveAmountLabel(id, selPt.y)}
        </div>
      )}
    </div>
  );
};
