/* 編輯頁的「曲線」「HSL」操作介面，抽出來給 RAW 沖洗共用 —— 長相、手感跟編輯頁的同名工具一模一樣：
 *  ‧ 曲線：左邊一排通道點（RGB、紅、綠、藍）＋重置鍵；240×240 的 4×4 白色格線，
 *    點曲線附近加節點、拖節點改形狀、同一個節點點兩下刪掉（兩端不能刪）。座標 0～255。
 *  ‧ HSL：一排八個色點（空心＝沒選、實心＝選中，改過的下面有一個點），下面三根滑桿（色相、飽和度、明度）。
 * 只負責介面；數值怎麼套到照片上由使用的那一頁決定。 */
import React, { useEffect, useRef, useState } from 'react';
import { haptic } from '../utils/haptics';
import { boundedCurvePath } from '../utils/editorCurveGeometry';
import { SLIDER_DOUBLE_TAP_EVENT } from '../utils/sliderTouch';
import { LiveRange } from './LiveRange';

export type CurvePt = { x: number; y: number };
export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';
export type CurveSet = Record<CurveChannel, CurvePt[]>;
export const LINEAR_CURVES = (): CurveSet => ({
  rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], r: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  g: [{ x: 0, y: 0 }, { x: 255, y: 255 }], b: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
});
export const isLinearCurve = (p: CurvePt[]) => p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 255 && p[1].y === 255;

/* 跟編輯頁同一條樣條（單調三次 Hermite） */
export function splineY(x: number, points: CurvePt[]): number {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = pts.length;
  if (n === 2) {
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[1].x) return pts[1].y;
    return pts[0].y + (x - pts[0].x) / (pts[1].x - pts[0].x) * (pts[1].y - pts[0].y);
  }
  const dx: number[] = [], ms: number[] = [], c1s: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].x - pts[i].x; ms[i] = (pts[i + 1].y - pts[i].y) / dx[i]; }
  c1s[0] = ms[0];
  for (let i = 0; i < n - 2; i++) {
    const m = ms[i], mNext = ms[i + 1];
    c1s.push(m * mNext <= 0 ? 0 : 3 * (dx[i] + dx[i + 1]) / ((dx[i] + 2 * dx[i + 1]) / m + (dx[i + 1] + 2 * dx[i]) / mNext));
  }
  c1s.push(ms[ms.length - 1]);
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[n - 1].x) return pts[n - 1].y;
  let k = 0; while (x > pts[k + 1].x) k++;
  const t = (x - pts[k].x) / dx[k], t2 = t * t, t3 = t2 * t;
  return pts[k].y * (2 * t3 - 3 * t2 + 1) + dx[k] * c1s[k] * (t3 - 2 * t2 + t) + pts[k + 1].y * (-2 * t3 + 3 * t2) + dx[k] * c1s[k + 1] * (t3 - t2);
}
export const curveLut = (p: CurvePt[]) => Float32Array.from({ length: 256 }, (_, i) => Math.max(0, Math.min(255, splineY(i, p))) / 255);

const CURVE_CSS = `
.ech-dot { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; box-sizing: border-box; background: currentColor; transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1); }
.ech-dot.active { transform: scale(1.1); }
.ech-pt { fill: #fff; cursor: pointer; filter: drop-shadow(0 0 4px rgba(255,255,255,0.6)); transition: filter 0.2s; }
.ech-pt.active { filter: drop-shadow(0 0 12px #fff); }
`;
const CHANNEL_COLOR: Record<CurveChannel, string> = { rgb: '#fff', r: '#ef4444', g: '#22c55e', b: '#3b82f6' };

/** 曲線（跟編輯頁同一個介面）。onChange(curves, final)：拖的時候 final=false，放手 true */
export const CurvesPad: React.FC<{
  curves: CurveSet; onChange: (c: CurveSet, final: boolean) => void; onStart?: () => void;
}> = ({ curves, onChange, onStart }) => {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const [drag, setDrag] = useState(-1);
  const svgRef = useRef<SVGSVGElement>(null);
  const curvesRef = useRef(curves); curvesRef.current = curves;
  const touchAt = useRef(0), tapAt = useRef(0), tapIdx = useRef(-1), createdIdx = useRef(-1), createdAt = useRef(0);
  const ghost = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e) { touchAt.current = e.timeStamp; return false; }
    return e.timeStamp - touchAt.current < 800;
  };
  const pos = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(200, Math.round((cx - r.left) * (200 / r.width)))), y: Math.max(0, Math.min(200, Math.round(200 - (cy - r.top) * (200 / r.height)))) };
  };
  const set = (pts: CurvePt[], final: boolean) => onChange({ ...curvesRef.current, [channel]: pts }, final);

  /* 拖節點：手指移到格子外面也跟著走 */
  useEffect(() => {
    if (drag < 0) return;
    const move = (cx: number, cy: number) => {
      let { x, y } = pos(cx, cy);
      const pts = [...curvesRef.current[channel]];
      const x255 = x / 200 * 255;
      if (drag > 0 && x255 <= pts[drag - 1].x) x = pts[drag - 1].x / 255 * 200 + 1;
      if (drag < pts.length - 1 && x255 >= pts[drag + 1].x) x = pts[drag + 1].x / 255 * 200 - 1;
      pts[drag] = { x: x / 200 * 255, y: y / 200 * 255 };
      set(pts, false);
    };
    const tm = (e: TouchEvent) => { if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY); };
    const mm = (e: MouseEvent) => move(e.clientX, e.clientY);
    const end = () => { setDrag(-1); onChange(curvesRef.current, true); };
    window.addEventListener('touchmove', tm, { passive: true }); window.addEventListener('mousemove', mm);
    window.addEventListener('touchend', end); window.addEventListener('mouseup', end); window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchmove', tm); window.removeEventListener('mousemove', mm);
      window.removeEventListener('touchend', end); window.removeEventListener('mouseup', end); window.removeEventListener('touchcancel', end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, channel]);

  const tapPoint = (e: React.MouseEvent | React.TouchEvent, idx: number) => {
    e.stopPropagation();
    if (ghost(e)) return;
    const now = e.timeStamp;
    const recent = createdIdx.current === idx && now - createdAt.current < 350;
    if (!recent && tapIdx.current === idx && now - tapAt.current < 300) {
      const pts = [...curvesRef.current[channel]];
      if (pts.length > 2 && idx > 0 && idx < pts.length - 1) { onStart?.(); pts.splice(idx, 1); haptic('detentMajor'); set(pts, true); }
      tapAt.current = 0; tapIdx.current = -1;
    } else {
      tapAt.current = now; tapIdx.current = idx;
      onStart?.(); setDrag(idx);
    }
  };
  const tapBg = (e: React.MouseEvent | React.TouchEvent) => {
    if (ghost(e)) return;
    const cx = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const { x, y } = pos(cx, cy);
    const x255 = x / 200 * 255, y255 = y / 200 * 255;
    const pts = curvesRef.current[channel];
    let best = -1, min = 32;
    pts.forEach((p, i) => { const d = Math.hypot(p.x - x255, p.y - y255); if (d < min) { min = d; best = i; } });
    if (best !== -1) { tapPoint(e, best); return; }
    const cyv = splineY(x255, pts);
    if (Math.abs(y255 - cyv) < 32 && !pts.some(p => Math.abs(p.x - x255) < 12)) {
      onStart?.();
      const next = [...pts, { x: x255, y: cyv }].sort((a, b) => a.x - b.x);
      const ni = next.findIndex(p => p.x === x255);
      set(next, false);
      createdIdx.current = ni; createdAt.current = e.timeStamp;
      setDrag(ni);
    }
  };
  const color = CHANNEL_COLOR[channel];
  return (
    <div className="relative" onPointerDown={e => e.stopPropagation()}>
      <style>{CURVE_CSS}</style>
      <div className="absolute right-full top-0 h-[242px] flex flex-col justify-center items-center gap-4 pr-3">
        {(['rgb', 'r', 'g', 'b'] as const).map(ch => (
          <div key={ch} onClick={() => { haptic('tick'); setChannel(ch); }} className={`ech-dot ${channel === ch ? 'active' : ''}`} style={{ color: { rgb: '#ffffff', r: '#ff3b30', g: '#4cd964', b: '#007aff' }[ch] }} />
        ))}
        <button onClick={() => { onStart?.(); onChange(LINEAR_CURVES(), true); }} className="w-[26px] h-[26px] shrink-0 flex items-center justify-center bg-transparent text-white active:scale-90 transition-transform" title="重置全部">
          <svg viewBox="0 0 32 32" className="w-full h-full block" fill="none">
            <path d="M26 16a10 10 0 1 1-3.1-7.25" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M23.4 4.88L24.8 10.1L19.58 11.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="relative w-[240px] h-[240px] bg-transparent border border-white shrink-0 touch-none rounded-sm" onMouseDown={tapBg} onTouchStart={tapBg}>
        <svg ref={svgRef} viewBox="0 0 200 200" className="absolute top-[-1px] left-[-1px] w-[240px] h-[240px] overflow-visible cursor-crosshair">
          <defs><clipPath id="ech-clip"><rect width="200" height="200" /></clipPath></defs>
          <g stroke="#fff" strokeWidth="1" shapeRendering="crispEdges">
            {[50, 100, 150].map(v => (
              <React.Fragment key={v}>
                <line x1={v} y1="0" x2={v} y2="200" style={{ vectorEffect: 'non-scaling-stroke' }} />
                <line x1="0" y1={v} x2="200" y2={v} style={{ vectorEffect: 'non-scaling-stroke' }} />
              </React.Fragment>
            ))}
          </g>
          <path d={boundedCurvePath(curves[channel], splineY)} clipPath="url(#ech-clip)" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ vectorEffect: 'non-scaling-stroke' }} />
          {curves[channel].map((p, i) => (
            <circle key={i} cx={p.x / 255 * 200} cy={200 - p.y / 255 * 200} r={window.innerWidth < 768 ? 6 : 4}
              className={`ech-pt ${drag === i ? 'active' : ''}`} style={{ fill: color }}
              onMouseDown={e => tapPoint(e, i)} onTouchStart={e => tapPoint(e, i)} />
          ))}
        </svg>
      </div>
    </div>
  );
};

/* ── HSL ─────────────────────────────────────────────────────────── */
export const HSL_SWATCHES = [
  { id: 'red', label: '紅', swatch: '#ff3b30' }, { id: 'orange', label: '橙', swatch: '#ff9500' },
  { id: 'yellow', label: '黃', swatch: '#ffd60a' }, { id: 'green', label: '綠', swatch: '#34c759' },
  { id: 'aqua', label: '青', swatch: '#32ade6' }, { id: 'blue', label: '藍', swatch: '#0a84ff' },
  { id: 'purple', label: '紫', swatch: '#af52de' }, { id: 'magenta', label: '洋紅', swatch: '#ff2d70' },
] as const;
export type HslBand = { h: number; s: number; l: number };
/** HSL 面板的高度（跟編輯頁一樣） */
export const HSL_PANEL_H = 221;

/** 跟編輯頁 FastSlider（compact）同一個樣子的滑桿：名稱｜數值，下面一條；雙擊名稱、雙擊白點都回到 0 */
export const CompactSlider: React.FC<{ label: string; value: number; min?: number; max?: number; step?: number; dflt?: number; fmt?: (v: number) => string;
  /** 軌道換成色彩漸層（白平衡） */ track?: string;
  onStart: () => void; onValue: (v: number) => void; onCommit: () => void; onReset: () => void; }> = ({ label, value, min = -100, max = 100, step = 1, fmt, track, onStart, onValue, onCommit, onReset }) => {
  const box = useRef<HTMLDivElement>(null);
  const resetRef = useRef(onReset); resetRef.current = onReset;
  useEffect(() => {
    const el = box.current; if (!el) return;
    const h = () => { resetRef.current(); haptic('detentMajor'); };
    el.addEventListener(SLIDER_DOUBLE_TAP_EVENT, h);
    return () => el.removeEventListener(SLIDER_DOUBLE_TAP_EVENT, h);
  }, []);
  return (
    <div className="w-full">
      <div className="flex justify-between items-center cursor-pointer select-none leading-none" onDoubleClick={() => { resetRef.current(); haptic('detentMajor'); }} title="雙擊重置">
        <span className="font-black text-white/40 uppercase pointer-events-none text-[10px] tracking-[0.2em]">{label}</span>
        <span className="font-sans tabular-nums font-bold bg-white/10 rounded text-xs px-2 py-0.5">{fmt ? fmt(value) : Math.round(value)}</span>
      </div>
      <div ref={box} className="relative">
        {track && <div aria-hidden className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full opacity-80 pointer-events-none" style={{ background: track }} />}
        <LiveRange ariaLabel={label} min={min} max={max} step={step} value={value} height={30} className={`custom-range compact ${track ? 'raw-track-colored' : ''}`}
          onPointerDown={onStart} onValue={onValue} onCommit={onCommit} />
      </div>
    </div>
  );
};

/** HSL（跟編輯頁同一個介面）。值 -100～100 */
export const HslPanel: React.FC<{
  value: HslBand[]; onStart: () => void; onChange: (v: HslBand[]) => void; onCommit: () => void;
}> = ({ value, onStart, onChange, onCommit }) => {
  const [band, setBand] = useState(0);
  const valRef = useRef(value); valRef.current = value;
  const put = (k: keyof HslBand, v: number) => onChange(valRef.current.map((b, i) => (i === band ? { ...b, [k]: v } : b)));
  return (
    <div className="w-full flex flex-col px-8 pt-2 pb-2" style={{ height: HSL_PANEL_H }}>
      <div className="w-[calc(100%+4rem)] -mx-8 px-1 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 w-max mx-auto py-1.5">
          {HSL_SWATCHES.map((b, i) => {
            const on = band === i, v = value[i];
            const touched = v && (v.h !== 0 || v.s !== 0 || v.l !== 0);
            return (
              <button key={b.id} onClick={() => { haptic('tick'); setBand(i); }} title={b.label} className="shrink-0 flex flex-col items-center gap-1 group">
                <span className="block w-8 h-8 rounded-full transition-colors" style={{ border: `4px solid ${b.swatch}`, background: on ? b.swatch : 'transparent' }} />
                <span className={`w-1.5 h-1.5 rounded-full bg-white transition-opacity ${touched ? 'opacity-100' : 'opacity-0'}`} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 flex flex-col justify-around">
        {([['h', '色相'], ['s', '飽和度'], ['l', '明度']] as const).map(([k, label]) => (
          <CompactSlider key={`${band}-${k}`} label={label} value={value[band]?.[k] ?? 0}
            onStart={onStart} onValue={v => put(k, Math.abs(v) < 2 ? 0 : v)} onCommit={onCommit}
            onReset={() => { onStart(); put(k, 0); onCommit(); }} />
        ))}
      </div>
    </div>
  );
};
