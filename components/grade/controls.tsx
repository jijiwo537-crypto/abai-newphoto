import React, { useRef } from 'react';
import { wheelColour } from '../../utils/colorGrade';

/* 調色面板共用的小元件：拖曳（含雙擊）、重置圖示、色環。 */

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const fmt = (v: number, d: number) => { const s = v.toFixed(d); return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s; };

/** 向量示波器方向的色環（CSS conic 從 12 點鐘順時針；色輪角度從 3 點鐘逆時針） */
export const RING = `conic-gradient(${Array.from({ length: 37 }, (_, i) => `${wheelColour(90 - i * 10)} ${i * 10}deg`).join(',')})`;
/** 同一圈色環，但把「saturate(.8)＋72% 不透明疊在 #111 上」直接算進顏色裡：
 *  畫面一樣，瀏覽器卻不用為每個色輪多開一層濾鏡／半透明圖層（進場動畫時每一格都要重畫） */
const soften = (c: string) => {
  const [r, g, b] = (c.match(/\d+/g) || []).map(Number); const s = 0.8, bg = 17, a = 0.72;
  const R = (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b;
  const G = (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b;
  const B = (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b;
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, v)) * a + bg * (1 - a));
  return `rgb(${f(R)},${f(G)},${f(B)})`;
};
export const RING_FLAT = `conic-gradient(${Array.from({ length: 37 }, (_, i) => `${soften(wheelColour(90 - i * 10))} ${i * 10}deg`).join(',')})`;
/** 色環每 10° 一個色標（CSS 角度：12 點鐘起、順時針），已經是 RING_FLAT 的顏色 */
export const RING_STOPS: [number, number, number][] = Array.from({ length: 37 }, (_, i) =>
  (soften(wheelColour(90 - i * 10)).match(/\d+/g) || []).map(Number) as [number, number, number]);

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
