/* 仿 iOS 液態玻璃＋果凍效果的按鈕（網頁版，跟著捲動完全同步）。
   ‧ 玻璃：半透明＋背景模糊與飽和、上緣亮邊、斜向高光；按住時有一塊高光跟著手指走。
   ‧ 果凍：彈簧物理（不是固定的動畫曲線）。按下去輕輕鼓起；按住往旁邊拖，按鈕被手指往那個方向
     拉長、另一個方向變窄；放開回彈，會帶一點晃動。手指往上下滑（捲動頁面）時自動放開，不會卡住捲動。
   只動 transform 與一個 CSS 變數，不觸發版面重排；動畫用 requestAnimationFrame，停下來就不再跑。 */
import React, { useEffect, useRef } from 'react';

type Spring = { v: number; x: number; t: number };
const K = 420, D = 22;           // 彈簧硬度、阻尼（數值越大越硬、越快停）

export const GlassJelly: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { radius?: number }> = ({ radius = 13, className = '', style, children, ...rest }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const st = useRef({ sx: { v: 0, x: 1, t: 1 } as Spring, sy: { v: 0, x: 1, t: 1 } as Spring, tx: { v: 0, x: 0, t: 0 } as Spring, ty: { v: 0, x: 0, t: 0 } as Spring,
    raf: 0, last: 0, down: false, cx: 0, cy: 0, w: 1, h: 1, startX: 0, startY: 0 });

  const step = (now: number) => {
    const s = st.current, el = ref.current; if (!el) return;
    const dt = Math.min(0.032, (now - (s.last || now)) / 1000 || 0.016); s.last = now;
    let moving = false;
    for (const sp of [s.sx, s.sy, s.tx, s.ty]) {
      const a = -K * (sp.x - sp.t) - D * sp.v;
      sp.v += a * dt; sp.x += sp.v * dt;
      if (Math.abs(sp.v) > 1e-4 || Math.abs(sp.x - sp.t) > 1e-4) moving = true; else { sp.x = sp.t; sp.v = 0; }
    }
    el.style.transform = `translate(${s.tx.x}px, ${s.ty.x}px) scale(${s.sx.x}, ${s.sy.x})`;
    s.raf = moving ? requestAnimationFrame(step) : 0;
    if (!moving) s.last = 0;
  };
  const kick = () => { const s = st.current; if (!s.raf) { s.last = 0; s.raf = requestAnimationFrame(step); } };
  useEffect(() => () => cancelAnimationFrame(st.current.raf), []);

  const setLight = (x: number, y: number, on: boolean) => {
    const el = ref.current; if (!el) return;
    el.style.setProperty('--gx', `${x}px`); el.style.setProperty('--gy', `${y}px`); el.style.setProperty('--gl', on ? '1' : '0');
  };
  const press = (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect(), s = st.current;
    s.down = true; s.cx = r.left + r.width / 2; s.cy = r.top + r.height / 2; s.w = r.width; s.h = r.height; s.startX = e.clientX; s.startY = e.clientY;
    s.sx.t = 1.06; s.sy.t = 1.06; kick();
    setLight(e.clientX - r.left, e.clientY - r.top, true);
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current; if (!s.down) return;
    // 手指主要往上下滑＝在捲動頁面：放開，不跟手
    if (Math.abs(e.clientY - s.startY) > 14 && Math.abs(e.clientY - s.startY) > Math.abs(e.clientX - s.startX) * 1.2) { release(); return; }
    const dx = e.clientX - s.cx, dy = e.clientY - s.cy;
    const nx = Math.max(-1.6, Math.min(1.6, dx / (s.w / 2))), ny = Math.max(-1.6, Math.min(1.6, dy / (s.h / 2)));
    // 往手指的方向拉：位移＋該方向拉長、另一方向變窄（體積感）
    s.tx.t = nx * s.w * 0.06; s.ty.t = ny * s.h * 0.06;
    s.sx.t = 1.06 + Math.abs(nx) * 0.07 - Math.abs(ny) * 0.03;
    s.sy.t = 1.06 + Math.abs(ny) * 0.07 - Math.abs(nx) * 0.03;
    kick();
    const r = ref.current!.getBoundingClientRect();
    setLight(e.clientX - r.left, e.clientY - r.top, true);
  };
  const release = () => {
    const s = st.current; if (!s.down) return; s.down = false;
    s.sx.t = 1; s.sy.t = 1; s.tx.t = 0; s.ty.t = 0;
    // 放開時給一點反向速度：回彈會晃一下
    s.sx.v -= 0.6; s.sy.v += 0.4;
    kick(); setLight(0, 0, false);
  };

  return (
    <button
      ref={ref}
      {...rest}
      onPointerDown={e => { press(e); rest.onPointerDown?.(e); }}
      onPointerMove={e => { move(e); rest.onPointerMove?.(e); }}
      onPointerUp={e => { release(); rest.onPointerUp?.(e); }}
      onPointerCancel={e => { release(); rest.onPointerCancel?.(e); }}
      onPointerLeave={e => { release(); rest.onPointerLeave?.(e); }}
      className={`relative isolate overflow-hidden ${className}`}
      style={{
        borderRadius: radius,
        background: 'rgba(255,255,255,.075)',
        backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        // 玻璃邊：上緣亮、整圈細白、下緣一點點反光
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.32), inset 0 -1px 0 rgba(255,255,255,.07), inset 0 0 0 1px rgba(255,255,255,.11), 0 8px 24px rgba(0,0,0,.35)',
        transformOrigin: '50% 50%', willChange: 'transform', touchAction: 'pan-y',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {/* 斜向高光（固定） */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ borderRadius: 'inherit',
        background: 'linear-gradient(140deg, rgba(255,255,255,.20) 0%, rgba(255,255,255,.04) 34%, rgba(255,255,255,0) 55%, rgba(255,255,255,.05) 100%)' }} />
      {/* 跟著手指走的高光（按住時才亮） */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 transition-opacity duration-200" style={{ borderRadius: 'inherit', opacity: 'var(--gl, 0)' as any,
        background: 'radial-gradient(90px 70px at var(--gx, 50%) var(--gy, 50%), rgba(255,255,255,.28), rgba(255,255,255,0) 70%)' }} />
      {children}
    </button>
  );
};
