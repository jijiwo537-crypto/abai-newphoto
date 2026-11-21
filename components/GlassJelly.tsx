/* 仿 iOS 液態玻璃＋果凍按鈕（網頁版）。
   ‧ 折射：Safari 的 SVG 位移濾鏡不吃位移圖片，所以自己算——外層 <GlassScene paint={...}> 把背景畫進一張畫布，
     每顆按鈕用自己的小畫布逐點取樣：中間直接透出背後，越靠圓角邊緣越往外取樣，把外圈畫面彎進邊框
     （iOS 玻璃邊緣那種透鏡折射），再略加飽和。按鈕變形時跟著重算，所以拉長時折射也跟著拉。
   ‧ 外觀：不鋪灰底（真的透明），靠一圈依角度明暗不同的細亮邊＋極淡的內光呈現玻璃厚度。
   ‧ 手感：彈簧物理（約 iOS 預設 response .35s、damping .6）。按下鼓起、整顆變亮；拖曳時朝手指方向
     拉長並維持體積（另一邊變窄），位移有橡皮筋阻力；放開帶晃動回彈。上下滑＝捲動，自動放開。
   動畫只在有動時跑；靜止時不耗電。 */
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

type Spring = { v: number; x: number; t: number };
const K = 330, D = 22;

type SceneImg = { data: Uint8ClampedArray; W: number; H: number; dpr: number };
const SceneCtx = createContext<{ ref: React.RefObject<HTMLDivElement | null>; img: SceneImg | null; ver: number } | null>(null);

/* 玻璃按鈕的「背景舞台」：paint 把背景畫進畫布（同時顯示在最底層），裡面的玻璃按鈕拿它來折射。 */
export function GlassScene({ paint, className = '', style, children }: { paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<SceneImg | null>(null);
  const [ver, setVer] = useState(0);
  useEffect(() => {
    const el = ref.current, cv = cvRef.current; if (!el || !cv) return;
    let last = '';
    const draw = () => {
      const w = el.offsetWidth, h = el.offsetHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      const k = `${w}x${h}`; if (!w || !h) return;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const ctx = cv.getContext('2d', { willReadFrequently: true })!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, w, h);
      setImg({ data: ctx.getImageData(0, 0, cv.width, cv.height).data, W: cv.width, H: cv.height, dpr });
      if (k !== last) { last = k; setVer(v => v + 1); }
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(el);
    return () => ro.disconnect();
  }, [paint]);
  return (
    <SceneCtx.Provider value={{ ref, img, ver }}>
      <div ref={ref} className={`relative ${className}`} style={style}>
        <canvas ref={cvRef} aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" />
        <div className="relative">{children}</div>
      </div>
    </SceneCtx.Provider>
  );
}

/* 圓角矩形透鏡：每個像素往外法線方向取樣的距離比例（0＝不彎），以及方向。 */
function lensField(w: number, h: number, r: number, bezel: number) {
  const n = w * h, mag = new Float32Array(n), dx = new Float32Array(n), dy = new Float32Array(n);
  const hw = w / 2, hh = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x + 0.5 - hw, py = y + 0.5 - hh;
    const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
    let sd: number, nx: number, ny: number;
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; sd = l - r; nx = qx / l; ny = qy / l; }
    else if (qx > qy) { sd = qx - r; nx = 1; ny = 0; } else { sd = qy - r; nx = 0; ny = 1; }
    const i = y * w + x;
    if (sd < 0 && -sd < bezel) { const t = 1 - (-sd) / bezel; mag[i] = t * t * (3 - 2 * t) * Math.sqrt(t); }
    dx[i] = nx * (Math.sign(px) || 1); dy[i] = ny * (Math.sign(py) || 1);
  }
  return { mag, dx, dy };
}

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { radius?: number; tint?: string; press?: number };

export const GlassJelly: React.FC<Props> = ({ radius = 13, tint, press: pressAmt = 1, className = '', style, children, ...rest }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<{ key: string; f: ReturnType<typeof lensField> } | null>(null);
  const scene = useContext(SceneCtx);
  const [geo, setGeo] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const geoRef = useRef(geo); geoRef.current = geo;
  const imgRef = useRef(scene?.img ?? null); imgRef.current = scene?.img ?? null;
  const st = useRef({ sx: { v: 0, x: 1, t: 1 } as Spring, sy: { v: 0, x: 1, t: 1 } as Spring, tx: { v: 0, x: 0, t: 0 } as Spring, ty: { v: 0, x: 0, t: 0 } as Spring,
    lit: { v: 0, x: 0, t: 0 } as Spring, raf: 0, last: 0, down: false, cx: 0, cy: 0, w: 1, h: 1, startX: 0, startY: 0 });

  // 量自己在舞台裡的位置（只在靜止時量，transform 不影響 offsetWidth）
  useLayoutEffect(() => {
    const el = ref.current, sc = scene?.ref.current; if (!el || !sc) return;
    const measure = () => {
      const a = sc.getBoundingClientRect(), b = el.getBoundingClientRect();
      const s = st.current; if (s.raf) return;
      setGeo({ x: Math.round(b.left - a.left), y: Math.round(b.top - a.top), w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [scene?.ver]);

  /* 把背後畫面經透鏡畫進按鈕的小畫布。tx/ty/sx/sy＝目前果凍變形，用來把每個點換回舞台上的真實位置。 */
  const paintLens = () => {
    const cv = cvRef.current, el = ref.current, sc = scene?.ref.current, im = imgRef.current, s = st.current; if (!cv || !el || !sc || !im) return;
    // 在舞台裡的位置：用 offset 一路加到舞台（不受果凍 transform 影響），每次畫都重算，版面變了也對得上
    let ox = 0, oy = 0, n: HTMLElement | null = el;
    while (n && n !== sc) { ox += n.offsetLeft; oy += n.offsetTop; const p = n.offsetParent as HTMLElement | null; if (p && p !== sc && !sc.contains(p)) { const a = sc.getBoundingClientRect(), b = p.getBoundingClientRect(); ox += b.left - a.left; oy += b.top - a.top; break; } n = p; }
    const g = { x: ox, y: oy, w: el.offsetWidth, h: el.offsetHeight }; if (!g.w || !g.h) return;
    const k = im.dpr, w = Math.max(1, Math.round(g.w * k)), h = Math.max(1, Math.round(g.h * k));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const rr = Math.min(radius, g.h / 2, g.w / 2) * k, bezel = Math.min(18, Math.min(g.w, g.h) * 0.32) * k;
    const key = `${w}x${h}|${rr}|${bezel}`;
    if (fieldRef.current?.key !== key) fieldRef.current = { key, f: lensField(w, h, rr, bezel) };
    const { mag, dx, dy } = fieldRef.current.f;
    const ctx = cv.getContext('2d')!; const out = ctx.createImageData(w, h); const o = out.data, src = im.data, SW = im.W, SH = im.H;
    const DISP = 18 * k;
    const cx = (g.x + g.w / 2) * k, cy = (g.y + g.h / 2) * k, hw = w / 2, hh = h / 2;
    const sx = s.sx.x, sy = s.sy.x, tx = s.tx.x * k, ty = s.ty.x * k;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, m = mag[i] * DISP;
      // 按鈕上這一點在舞台上的位置（含果凍變形），再往外法線方向偏移
      let fx = cx + tx + (x + 0.5 - hw) * sx + dx[i] * m * sx - 0.5;
      let fy = cy + ty + (y + 0.5 - hh) * sy + dy[i] * m * sy - 0.5;
      if (fx < 0) fx = 0; else if (fx > SW - 1.001) fx = SW - 1.001;
      if (fy < 0) fy = 0; else if (fy > SH - 1.001) fy = SH - 1.001;
      const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
      const p00 = (y0 * SW + x0) * 4, p10 = p00 + 4, p01 = p00 + SW * 4, p11 = p01 + 4;
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      let r = src[p00] * w00 + src[p10] * w10 + src[p01] * w01 + src[p11] * w11;
      let gg = src[p00 + 1] * w00 + src[p10 + 1] * w10 + src[p01 + 1] * w01 + src[p11 + 1] * w11;
      let b = src[p00 + 2] * w00 + src[p10 + 2] * w10 + src[p01 + 2] * w01 + src[p11 + 2] * w11;
      // 略加飽和＋邊緣一點點提亮（玻璃把光聚起來）
      const l = 0.299 * r + 0.587 * gg + 0.114 * b, sat = 1.3, lift = 1 + mag[i] * 0.12;
      r = (l + (r - l) * sat) * lift; gg = (l + (gg - l) * sat) * lift; b = (l + (b - l) * sat) * lift;
      const q = i * 4; o[q] = r; o[q + 1] = gg; o[q + 2] = b; o[q + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  };
  useEffect(() => { paintLens(); });

  const step = (now: number) => {
    const s = st.current, el = ref.current; if (!el) return;
    const dt = Math.min(0.032, (now - (s.last || now)) / 1000 || 0.016); s.last = now;
    let moving = false;
    for (const sp of [s.sx, s.sy, s.tx, s.ty, s.lit]) {
      const a = -K * (sp.x - sp.t) - D * sp.v;
      sp.v += a * dt; sp.x += sp.v * dt;
      if (Math.abs(sp.v) > 1e-4 || Math.abs(sp.x - sp.t) > 1e-4) moving = true; else { sp.x = sp.t; sp.v = 0; }
    }
    el.style.transform = `translate(${s.tx.x}px, ${s.ty.x}px) scale(${s.sx.x}, ${s.sy.x})`;
    el.style.setProperty('--gl', String(Math.max(0, Math.min(1, s.lit.x))));
    paintLens();
    s.raf = moving ? requestAnimationFrame(step) : 0;
    if (!moving) s.last = 0;
  };
  const kick = () => { const s = st.current; if (!s.raf) { s.last = 0; s.raf = requestAnimationFrame(step); } };
  useEffect(() => () => cancelAnimationFrame(st.current.raf), []);

  const grow = () => { const s = st.current; return 1 + Math.min(0.12, 9 / Math.max(40, Math.min(s.w, s.h * 2))) * pressAmt; };
  const setLight = (x: number, y: number) => { const el = ref.current; if (!el) return; el.style.setProperty('--gx', `${x}px`); el.style.setProperty('--gy', `${y}px`); };
  const press = (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect(), s = st.current;
    s.down = true; s.cx = r.left + r.width / 2; s.cy = r.top + r.height / 2; s.w = el.offsetWidth; s.h = el.offsetHeight; s.startX = e.clientX; s.startY = e.clientY;
    const g = grow(); s.sx.t = g; s.sy.t = g; s.lit.t = 1; kick();
    setLight(e.clientX - r.left, e.clientY - r.top);
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current; if (!s.down) return;
    if (Math.abs(e.clientY - s.startY) > 14 && Math.abs(e.clientY - s.startY) > Math.abs(e.clientX - s.startX) * 1.2) { release(); return; }
    const dx = e.clientX - s.cx, dy = e.clientY - s.cy;
    // 橡皮筋：越拉越緊
    const rb = (v: number, lim: number) => lim * v / (lim + Math.abs(v));
    s.tx.t = rb(dx, 50) * 0.3; s.ty.t = rb(dy, 34) * 0.3;
    const g = grow();
    const kx = Math.abs(rb(dx, 120)) / Math.max(60, s.w) * 0.45, ky = Math.abs(rb(dy, 80)) / Math.max(40, s.h) * 0.45;
    const k = kx - ky;   // >0 橫向拉長
    s.sx.t = g * (1 + k); s.sy.t = g / (1 + k);
    kick();
    const r = ref.current!.getBoundingClientRect(); setLight(e.clientX - r.left, e.clientY - r.top);
  };
  const release = () => {
    const s = st.current; if (!s.down) return; s.down = false;
    s.sx.t = 1; s.sy.t = 1; s.tx.t = 0; s.ty.t = 0; s.lit.t = 0;
    s.sx.v -= 0.5; s.sy.v += 0.35;
    kick();
  };

  const lens = !!(scene && geo && geo.w > 0);

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
        background: 'transparent',
        boxShadow: '0 10px 28px rgba(0,0,0,.28), 0 1px 2px rgba(0,0,0,.25)',
        transformOrigin: '50% 50%', willChange: 'transform', touchAction: 'pan-y',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {lens && <canvas ref={cvRef} aria-hidden className="pointer-events-none absolute inset-0 w-full h-full -z-20" style={{ borderRadius: 'inherit' }} />}
      {tint && <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ borderRadius: 'inherit', background: tint }} />}
      {/* 玻璃厚度：極淡內光（邊緣一圈微亮，中間透明） */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ borderRadius: 'inherit',
        boxShadow: 'inset 0 0 14px rgba(255,255,255,.07), inset 0 0 2px rgba(255,255,255,.10)' }} />
      {/* 鏡面亮邊：左上與右下亮、兩側暗，像光打在玻璃厚邊上 */}
      <span aria-hidden className="pointer-events-none absolute inset-0" style={{ borderRadius: 'inherit', padding: 1.25,
        background: 'linear-gradient(135deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,.22) 22%, rgba(255,255,255,.05) 45%, rgba(255,255,255,.05) 58%, rgba(255,255,255,.28) 82%, rgba(255,255,255,.6) 100%)',
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor',
        mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)' } as React.CSSProperties} />
      {/* 按住：整顆微亮＋手指處一團光 */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ borderRadius: 'inherit', opacity: 'var(--gl, 0)' as any,
        background: 'radial-gradient(110px 80px at var(--gx, 50%) var(--gy, 50%), rgba(255,255,255,.22), rgba(255,255,255,.06) 60%, rgba(255,255,255,.04))' }} />
      {children}
    </button>
  );
};
