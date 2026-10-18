import React, { useRef } from 'react';
import { wheelColour } from '../../utils/colorGrade';

/* 調色面板共用的小元件：拖曳（含雙擊）、重置圖示、色環。 */

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const fmt = (v: number, d: number) => { const s = v.toFixed(d); return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s; };

/** 向量示波器方向的色環（CSS conic 從 12 點鐘順時針；色輪角度從 3 點鐘逆時針） */
export const RING = `conic-gradient(${Array.from({ length: 37 }, (_, i) => `${wheelColour(90 - i * 10)} ${i * 10}deg`).join(',')})`;

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

/* 重置圖示：線用不透明的顏色畫，透明度加在整個 svg 上 —— 整個圖先合成再變淡，
   弧線與箭頭交會的地方不會疊出比較白的點。 */
export const ResetIcon = ({ on, size = 11 }: { on: boolean; size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="#e6e6e6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    style={{ opacity: on ? 1 : 0.45 }}>
    <path d="M3.2 6.2A5 5 0 1 1 3 9.6" /><path d="M3 2.6v3.8h3.8" />
  </svg>
);
