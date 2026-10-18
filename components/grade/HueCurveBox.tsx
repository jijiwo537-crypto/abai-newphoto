import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sampleCurve, type CurvePt } from '../../utils/grade/spline';
import { hueAxisColour, curveAmountLabel, type HueCurveId } from '../../utils/grade/hueCurves';

/* 色相曲線的編輯框 —— 外觀跟 RGB 曲線完全一樣（240×240、白色 4×4 格線、白色曲線、同一種點）。
 *
 *   · 橫軸是顏色（左邊紅，往右黃、綠、青、藍、洋紅，最右邊回到紅）；
 *     每個點用它所在位置的顏色填色，看點就知道在調哪個顏色。
 *   · 中間那條橫線是「不變」。點空白處＝在曲線上加一個點，可以直接拖。
 *     第一次加點時，兩旁會自動各放一個不動的點（跟達芬奇一樣），只會調到那一段顏色。
 *   · 拖點：左右換顏色、上下改量。點兩下刪掉那個點。 */

const BOX = 240, VB = 200;
const ANCHOR = 1 / 12;

export const HueCurveBox: React.FC<{
  id: HueCurveId; pts: CurvePt[];
  onStart: () => void; onChange: (pts: CurvePt[]) => void; onCommit: () => void;
}> = ({ id, pts: ptsProp, onStart, onChange, onCommit }) => {
  const [pts, setPts] = useState<CurvePt[]>(ptsProp);
  const [sel, setSel] = useState(-1);
  const drag = useRef<{ i: number; pid: number } | null>(null);
  const lastTap = useRef({ t: 0, i: -1 });
  const ptsRef = useRef(pts);
  useEffect(() => { if (!drag.current) { ptsRef.current = ptsProp; setPts(ptsProp); } }, [ptsProp]);
  useEffect(() => { setSel(-1); }, [id]);
  const push = (p: CurvePt[]) => { ptsRef.current = p; setPts(p); onChange(p); };

  const N = 192;
  const tab = useMemo(() => sampleCurve(pts.length ? pts : [{ x: 0.5, y: 0.5 }], N, true, 0.5), [pts]);
  const yAt = (x: number) => {
    const f = (x - Math.floor(x)) * N, i = Math.floor(f), t = f - i;
    return tab[i % N] + (tab[(i + 1) % N] - tab[i % N]) * t;
  };
  const path = useMemo(() => {
    let d = '';
    for (let j = 0; j <= 120; j++) { const x = j / 120; d += `${j ? 'L' : 'M'}${(x * VB).toFixed(2)} ${((1 - yAt(x)) * VB).toFixed(2)}`; }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const local = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const hitPoint = (x: number, y: number) => {
    let best = -1, bd = (22 / BOX) ** 2;
    ptsRef.current.forEach((p, i) => { const dx = p.x - x, dy = 1 - p.y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const sorted = (p: CurvePt[]) => [...p].sort((a, b) => a.x - b.x);
  const wrap = (v: number) => v - Math.floor(v);

  const down = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const { x, y } = local(e);
    let i = hitPoint(x, y);
    const now = performance.now();
    if (i >= 0 && lastTap.current.i === i && now - lastTap.current.t < 300) {
      lastTap.current = { t: 0, i: -1 };
      onStart(); push(ptsRef.current.filter((_, k) => k !== i)); onCommit(); setSel(-1);
      return;
    }
    onStart();
    if (i < 0) {
      const nx = Math.min(1, Math.max(0, x));
      const p = { x: nx, y: yAt(nx) };
      const add = ptsRef.current.length ? [p] : [p, { x: wrap(nx - ANCHOR), y: 0.5 }, { x: wrap(nx + ANCHOR), y: 0.5 }];
      const next = sorted([...ptsRef.current, ...add]);
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
    let ny = Math.min(1, Math.max(0, 1 - y));
    if (Math.abs(ny - 0.5) < 0.012) ny = 0.5;   // 靠近中線時吸附，方便拉回「不變」
    push(cur.map((p, k) => k === i ? { x: Math.min(hi, Math.max(lo, x)), y: ny } : p));
  };
  const up = (e: React.PointerEvent) => { if (drag.current?.pid !== e.pointerId) return; drag.current = null; onCommit(); };

  const selPt = sel >= 0 ? pts[sel] : null;
  return (
    <div className="relative w-[240px] h-[240px] bg-transparent border border-white shrink-0 touch-none rounded-sm"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-hue-curve={id}>
      <svg viewBox={`0 0 ${VB} ${VB}`} className="absolute top-[-1px] left-[-1px] w-[240px] h-[240px] overflow-visible pointer-events-none">
        <defs><clipPath id={`hcclip-${id}`}><rect width={VB} height={VB} /></clipPath></defs>
        <g stroke="#fff" strokeWidth="1" shapeRendering="crispEdges">
          {[50, 100, 150].map(v => (
            <React.Fragment key={v}>
              <line x1={v} y1="0" x2={v} y2={VB} style={{ vectorEffect: 'non-scaling-stroke' }} />
              <line x1="0" y1={v} x2={VB} y2={v} style={{ vectorEffect: 'non-scaling-stroke' }} />
            </React.Fragment>
          ))}
        </g>
        <path d={path} clipPath={`url(#hcclip-${id})`} fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ vectorEffect: 'non-scaling-stroke' }} />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x * VB} cy={(1 - p.y) * VB} r={6}
            className={`curve-point ${i === sel ? 'active' : ''}`}
            style={{ fill: hueAxisColour(p.x), stroke: '#fff', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' }} />
        ))}
      </svg>
      {selPt && (
        <div className="absolute left-1 top-1 px-1.5 py-[1px] rounded bg-black/60 text-[10px] text-white tabular-nums pointer-events-none">
          {curveAmountLabel(id, selPt.y)}
        </div>
      )}
    </div>
  );
};
