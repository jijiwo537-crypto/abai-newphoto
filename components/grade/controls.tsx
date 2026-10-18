import React, { useRef } from 'react';
import { wheelColour } from '../../utils/colorGrade';

/* 調色面板共用的小元件：拖曳、數值欄位、重置圖示。
 * 全部跟 DaVinci Resolve 一樣「按住左右拖」改值、點兩下回預設。 */

export type FieldSpec = { def: number; min: number; max: number; digits: number; span: number };

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const roundTo = (v: number, d: number) => { const k = 10 ** d; return Math.round(v * k) / k; };
export const fmt = (v: number, d: number) => { const s = v.toFixed(d); return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s; };

/** 向量示波器方向的色環（CSS conic 從 12 點鐘順時針；色輪角度從 3 點鐘逆時針） */
export const RING = `conic-gradient(${Array.from({ length: 37 }, (_, i) => `${wheelColour(90 - i * 10)} ${i * 10}deg`).join(',')})`;
export const CH_COLOUR: Record<string, string> = { y: '#d8d8d8', r: '#ff6b6b', g: '#5fd47a', b: '#6b9bff' };

/** 拖曳＋雙擊。用 pointer capture，手指拖出元素外也照樣跟著 */
export function useDrag(opts: { onStart?: () => void; onMove: (dx: number, dy: number) => void; onEnd?: () => void; onDouble?: () => void }) {
  const st = useRef<{ id: number; x: number; y: number } | null>(null);
  const last = useRef(0);
  const o = useRef(opts); o.current = opts;
  const end = (e: React.PointerEvent) => { if (st.current?.id !== e.pointerId) return; st.current = null; o.current.onEnd?.(); };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      const now = performance.now();
      if (o.current.onDouble && now - last.current < 300) { last.current = 0; o.current.onDouble(); return; }
      last.current = now;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      st.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      o.current.onStart?.();
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = st.current; if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y; s.x = e.clientX; s.y = e.clientY;
      if (dx || dy) o.current.onMove(dx, dy);
    },
    onPointerUp: end, onPointerCancel: end,
  };
}

export type Ev = { onStart: () => void; onEnd: () => void };

/** Resolve 式的數值欄位：上面標題、下面數字，左右拖改值、點兩下回預設 */
export const Scrub: React.FC<Ev & { label: string; value: number; spec: FieldSpec; onChange: (v: number) => void }> = ({ label, value, spec, onChange, onStart, onEnd }) => {
  const acc = useRef(value);
  const drag = useDrag({
    onStart: () => { acc.current = value; onStart(); },
    onMove: dx => { acc.current = clamp(acc.current + (dx * spec.span) / 300, spec.min, spec.max); onChange(roundTo(acc.current, spec.digits)); },
    onEnd,
    onDouble: () => { onStart(); onChange(spec.def); onEnd(); },
  });
  const changed = Math.abs(value - spec.def) > 1e-9;
  return (
    <div {...drag} className="flex-1 min-w-0 flex flex-col items-center touch-none select-none cursor-ew-resize" data-grade-field={label}>
      <span className="text-[9px] leading-[11px] text-white/45 whitespace-nowrap">{label}</span>
      <span className="mt-[2px] w-full max-w-[64px] h-[16px] rounded-[3px] bg-[#1d1d1d] border border-black/60 text-[10.5px] leading-[14px] text-center tabular-nums"
        style={{ color: changed ? '#f2f2f2' : '#8d8d8d', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.03)' }}>
        {fmt(value, spec.digits)}
      </span>
    </div>
  );
}

export const ResetIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
    style={{ color: on ? '#e6e6e6' : 'rgba(255,255,255,.18)' }}>
    <path d="M3.2 6.2A5 5 0 1 1 3 9.6" /><path d="M3 2.6v3.8h3.8" />
  </svg>
);


/** 細長的滑桿列：左邊名稱、中間軌道（有中性值刻度）、右邊數值。拖軌道改值、點兩下回預設。 */
export const GSlider: React.FC<Ev & { label: string; value: number; spec: FieldSpec; onChange: (v: number) => void; unit?: string; accent?: string }> = ({ label, value, spec, onChange, onStart, onEnd, unit = '', accent = '#fff' }) => {
  const track = useRef<HTMLDivElement>(null);
  const acc = useRef(value);
  const drag = useDrag({
    onStart: () => { acc.current = value; onStart(); },
    onMove: dx => {
      const w = track.current?.clientWidth || 200;
      acc.current = clamp(acc.current + (dx / w) * (spec.max - spec.min), spec.min, spec.max);
      onChange(roundTo(acc.current, spec.digits));
    },
    onEnd,
    onDouble: () => { onStart(); onChange(spec.def); onEnd(); },
  });
  const t = (clamp(value, spec.min, spec.max) - spec.min) / (spec.max - spec.min);
  const t0 = (clamp(spec.def, spec.min, spec.max) - spec.min) / (spec.max - spec.min);
  const changed = Math.abs(value - spec.def) > 1e-9;
  return (
    <div {...drag} className="flex items-center gap-2 h-[28px] touch-none select-none cursor-ew-resize" data-grade-field={label}>
      <span className="w-[52px] shrink-0 text-[10.5px] text-white/60 whitespace-nowrap">{label}</span>
      <div ref={track} className="relative flex-1 h-[16px]">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/15" />
        <div className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full" style={{ left: `${Math.min(t, t0) * 100}%`, width: `${Math.abs(t - t0) * 100}%`, background: accent, opacity: 0.85 }} />
        <div className="absolute top-1/2 w-[1px] h-[8px] -translate-y-1/2 bg-white/35" style={{ left: `${t0 * 100}%` }} />
        <div className="absolute top-1/2 w-[14px] h-[14px] -ml-[7px] -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `${t * 100}%` }} />
      </div>
      <span className="w-[46px] shrink-0 text-right text-[10.5px] tabular-nums" style={{ color: changed ? '#fff' : 'rgba(255,255,255,.45)' }}>{fmt(value, spec.digits)}{unit}</span>
    </div>
  );
};

/** 小的切換鍵（分頁、開關） */
export const Chip: React.FC<{ on: boolean; onClick?: () => void; children: React.ReactNode; title?: string; dot?: boolean; [k: string]: any }> = ({ on, onClick, children, dot, ...rest }) => (
  <button onClick={onClick} {...rest}
    className={`relative shrink-0 px-[9px] h-[24px] rounded-[6px] text-[11px] leading-none whitespace-nowrap border ${on ? 'bg-white text-black border-white' : 'bg-[#1b1b1b] text-white/70 border-white/10'}`}>
    {children}
    {dot && <span className={`absolute -right-[2px] -top-[2px] w-[6px] h-[6px] rounded-full ${on ? 'bg-black border border-white' : 'bg-white'}`} />}
  </button>
);
