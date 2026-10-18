import React, { useEffect, useRef, useState } from 'react';
import {
  WHEEL_SPEC, SCALAR_SPEC, normGrade, rgbToWheel, wheelToRgb, wheelColour, isWheelNeutral, freshGrade,
  type ColorGrade, type WheelId, type ScalarId, type ScalarSpec, type YRGB,
} from '../utils/colorGrade';

/* 一級調色面板：照 DaVinci Resolve 桌面版的「一級校色」調色板排。
 *
 *   上：模式（一級校色輪／一級校色條／Log 色輪）＋全部重置
 *   第一列參數：色溫、色調、對比度、軸心、中間調細節
 *   四個色輪（或色條）：標題＋重置鍵、色輪、主轉盤、Y R G B 數值
 *   第二列參數：色彩增強、陰影、高光、飽和度、色相、亮度混合
 *               （Log 模式換成低範圍、高範圍）
 *
 * 所有欄位都跟 Resolve 一樣「按住左右拖」來改，點兩下回到預設值。
 * 色輪是相對拖曳（不會跳到手指底下），乘 0.6 方便細調。
 * 拖曳中只重畫這個面板（本地 state），每一步交給 onChange 寫進編輯器的 paramsRef，
 * 放手才 onCommit（寫進 state 與復原紀錄）。 */

export const MID_DETAIL_SPEC: ScalarSpec = { def: 0, min: -100, max: 100, digits: 2, span: 100 };
/** 面板高度：跟 HSL 面板一樣，切換時圖片位置完全不動 */
export const COLOUR_PANEL_H = 221;

type Mode = 'wheels' | 'bars' | 'log';
let lastMode: Mode = 'wheels';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const roundTo = (v: number, d: number) => { const k = 10 ** d; return Math.round(v * k) / k; };
const fmt = (v: number, d: number) => { const s = v.toFixed(d); return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s; };

/** 向量示波器方向的色環（CSS conic 從 12 點鐘順時針；色輪角度從 3 點鐘逆時針） */
const RING = `conic-gradient(${Array.from({ length: 37 }, (_, i) => `${wheelColour(90 - i * 10)} ${i * 10}deg`).join(',')})`;
const CH_COLOUR: Record<string, string> = { y: '#d8d8d8', r: '#ff6b6b', g: '#5fd47a', b: '#6b9bff' };

/** 拖曳＋雙擊。用 pointer capture，手指拖出元素外也照樣跟著 */
function useDrag(opts: { onStart?: () => void; onMove: (dx: number, dy: number) => void; onEnd?: () => void; onDouble?: () => void }) {
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

type Ev = { onStart: () => void; onEnd: () => void };

/** Resolve 式的數值欄位：上面標題、下面數字，左右拖改值、點兩下回預設 */
const Scrub: React.FC<Ev & { label: string; value: number; spec: ScalarSpec; onChange: (v: number) => void }> = ({ label, value, spec, onChange, onStart, onEnd }) => {
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

const ResetIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
    style={{ color: on ? '#e6e6e6' : 'rgba(255,255,255,.18)' }}>
    <path d="M3.2 6.2A5 5 0 1 1 3 9.6" /><path d="M3 2.6v3.8h3.8" />
  </svg>
);

/** 一個色輪（或色條）單元：標題、色輪、主轉盤、數值 */
const WheelUnit: React.FC<Ev & {
  id: WheelId; label: string; en: string; w: YRGB; D: number; bars: boolean; onChange: (w: YRGB) => void;
}> = ({ id, label, en, w, D, bars, onChange, onStart, onEnd }) => {
  const s = WHEEL_SPEC[id];
  const chans = (s.hasY ? ['y', 'r', 'g', 'b'] : ['r', 'g', 'b']) as (keyof YRGB)[];
  const R = D / 2 - 9;
  const [cb, cr] = rgbToWheel(w, s.neutral);
  let px = (cb / s.edge) * R, py = (-cr / s.edge) * R;
  { const r = Math.hypot(px, py); if (r > R) { px *= R / r; py *= R / r; } }
  const pos = useRef({ x: 0, y: 0 });
  const wheel = useDrag({
    onStart: () => { pos.current = { x: px, y: py }; onStart(); },
    onMove: (dx, dy) => {
      const p = pos.current; p.x += dx * 0.6; p.y += dy * 0.6;
      const r = Math.hypot(p.x, p.y); if (r > R) { p.x *= R / r; p.y *= R / r; }
      onChange(wheelToRgb(w, s.neutral, (p.x / R) * s.edge, (-p.y / R) * s.edge));
    },
    onEnd,
    onDouble: () => { onStart(); onChange(wheelToRgb(w, s.neutral, 0, 0)); onEnd(); },
  });
  /* 主轉盤：有 Y 的（暗部／中灰／亮部）改 Y；沒有的（偏移、Log）三個通道一起改 */
  const [jogX, setJogX] = useState(0);
  const master = (dv: number): YRGB => s.hasY
    ? { ...w, y: clamp(w.y + dv, s.min, s.max) }
    : { ...w, r: clamp(w.r + dv, s.min, s.max), g: clamp(w.g + dv, s.min, s.max), b: clamp(w.b + dv, s.min, s.max) };
  const jog = useDrag({
    onStart, onEnd,
    onMove: dx => { setJogX(x => x + dx); onChange(master(dx * s.jog)); },
    onDouble: () => {
      onStart();
      if (s.hasY) onChange({ ...w, y: s.neutral });
      else { const m = (w.r + w.g + w.b) / 3 - s.neutral; onChange({ ...w, r: w.r - m, g: w.g - m, b: w.b - m }); }
      onEnd();
    },
  });
  const neutral = isWheelNeutral({ [id]: w } as any, id);
  const reset = () => { onStart(); onChange({ y: s.neutral, r: s.neutral, g: s.neutral, b: s.neutral }); onEnd(); };
  /* 色條：顯示範圍（中性值上下各多少），拖曳是上下 */
  const span = id === 'gain' ? 1 : id === 'offset' ? 25 : 0.5;
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center" data-grade-unit={id}>
      {/* 標題置中、重置鍵貼在自己這一格的右上角（跟 Resolve 一樣） */}
      <div className="relative w-full flex items-center justify-center h-[13px]" style={{ width: D }}>
        <span className="text-[9.5px] leading-none text-white/70 whitespace-nowrap">{label}<span className="ml-[3px] text-white/30 text-[8px]">{en}</span></span>
        <button onClick={reset} className="absolute -right-[3px] top-1/2 -translate-y-1/2 p-[3px]" aria-label={`重置${label}`}><ResetIcon on={!neutral} /></button>
      </div>
      {!bars ? (
        <div {...wheel} data-grade-wheel={id} className="relative shrink-0 rounded-full touch-none select-none mt-[2px]" style={{ width: D, height: D }}>
          {/* 外圈：細細一圈向量示波器方向的色環 */}
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            background: RING, opacity: 0.72, filter: 'saturate(.8)',
            WebkitMaskImage: `radial-gradient(circle, transparent ${D / 2 - 4}px, #000 ${D / 2 - 3.5}px, #000 ${D / 2 - 1.5}px, transparent ${D / 2 - 1}px)`,
            maskImage: `radial-gradient(circle, transparent ${D / 2 - 4}px, #000 ${D / 2 - 3.5}px, #000 ${D / 2 - 1.5}px, transparent ${D / 2 - 1}px)`,
          }} />
          {/* 盤面 */}
          <div className="absolute rounded-full pointer-events-none" style={{
            inset: 5, background: 'radial-gradient(circle at 50% 42%, #2e2e2e 0%, #222 55%, #191919 100%)',
            boxShadow: '0 0 0 1px #050505, inset 0 1px 1px rgba(255,255,255,.05), inset 0 -2px 4px rgba(0,0,0,.45)',
          }} />
          <svg className="absolute inset-0 pointer-events-none" width={D} height={D}>
            <g stroke="rgba(255,255,255,.09)" strokeWidth="1">
              <line x1={D / 2} y1={9} x2={D / 2} y2={D - 9} /><line x1={9} y1={D / 2} x2={D - 9} y2={D / 2} />
            </g>
            <circle cx={D / 2} cy={D / 2} r={R * 0.5} fill="none" stroke="rgba(255,255,255,.05)" />
            {(px || py) ? <line x1={D / 2} y1={D / 2} x2={D / 2 + px} y2={D / 2 + py} stroke="rgba(255,255,255,.35)" strokeWidth="1" /> : null}
            <circle cx={D / 2 + px} cy={D / 2 + py} r={4.2} fill="rgba(0,0,0,.35)" stroke="#fff" strokeWidth="1.4" />
            <circle cx={D / 2 + px} cy={D / 2 + py} r={0.9} fill="#fff" />
          </svg>
        </div>
      ) : (
        <div className="flex items-end justify-center gap-[5px] mt-[2px]" style={{ height: D }}>
          {chans.map(c => <Bar key={c} c={c} v={w[c]} s={s} span={span} H={D - 6} onStart={onStart} onEnd={onEnd}
            onChange={v => onChange({ ...w, [c]: v })} />)}
        </div>
      )}
      {/* 主轉盤（jog wheel）：左右拖 */}
      <div {...jog} data-grade-jog={id} className="mt-[3px] rounded-[3px] touch-none select-none cursor-ew-resize border border-black/70"
        style={{
          width: D - 6, height: 9,
          background: `repeating-linear-gradient(90deg, #3a3a3a 0 1px, #232323 1px 4px) ${jogX}px 0 / auto, #232323`,
          boxShadow: 'inset 0 2px 3px rgba(0,0,0,.55), inset 0 -1px 0 rgba(255,255,255,.04)',
          WebkitMaskImage: 'linear-gradient(90deg, rgba(0,0,0,.35), #000 25%, #000 75%, rgba(0,0,0,.35))',
        }} />
      <div className="w-full flex justify-center gap-[1px] mt-[2px] h-[11px]">
        {chans.map(c => <Num key={c} c={c} v={w[c]} s={s} onStart={onStart} onEnd={onEnd} onChange={v => onChange({ ...w, [c]: v })} />)}
      </div>
    </div>
  );
}

/** 色輪底下的單一數值（Y／R／G／B），左右拖微調、點兩下回中性值 */
const Num: React.FC<Ev & { c: string; v: number; s: typeof WHEEL_SPEC[WheelId]; onChange: (v: number) => void }> = ({ c, v, s, onChange, onStart, onEnd }) => {
  const acc = useRef(v);
  const drag = useDrag({
    onStart: () => { acc.current = v; onStart(); },
    onMove: dx => { acc.current = clamp(acc.current + dx * s.jog * 0.5, s.min, s.max); onChange(acc.current); },
    onEnd,
    onDouble: () => { onStart(); onChange(s.neutral); onEnd(); },
  });
  return (
    <span {...drag} className="flex-1 min-w-0 text-center text-[8px] leading-[11px] tabular-nums tracking-[-0.2px] touch-none select-none cursor-ew-resize"
      style={{ color: Math.abs(v - s.neutral) > 5e-3 ? CH_COLOUR[c] : 'rgba(255,255,255,.4)' }}>{fmt(v, s.digits)}</span>
  );
}

/** 色條模式的一根：中性值在中間，往上加往下減，上下拖 */
const Bar: React.FC<Ev & { c: string; v: number; s: typeof WHEEL_SPEC[WheelId]; span: number; H: number; onChange: (v: number) => void }> = ({ c, v, s, span, H, onChange, onStart, onEnd }) => {
  const acc = useRef(v);
  const drag = useDrag({
    onStart: () => { acc.current = v; onStart(); },
    onMove: (_dx, dy) => { acc.current = clamp(acc.current - dy * (span / (H / 2)), s.min, s.max); onChange(acc.current); },
    onEnd,
    onDouble: () => { onStart(); onChange(s.neutral); onEnd(); },
  });
  const t = clamp((v - s.neutral) / span, -1, 1) * (H / 2 - 1);
  return (
    <div {...drag} className="relative touch-none select-none cursor-ns-resize rounded-[2px]" data-grade-bar={c}
      style={{ width: 11, height: H, background: '#1b1b1b', boxShadow: '0 0 0 1px #050505, inset 0 1px 2px rgba(0,0,0,.6)' }}>
      <div className="absolute left-0 right-0" style={{ top: H / 2 - 0.5, height: 1, background: 'rgba(255,255,255,.18)' }} />
      <div className="absolute left-[2px] right-[2px] rounded-[1px]" style={{
        top: t >= 0 ? H / 2 - t : H / 2, height: Math.abs(t), background: CH_COLOUR[c], opacity: 0.85,
      }} />
      <div className="absolute left-[-2px] right-[-2px] h-[3px] rounded-[1px] bg-white" style={{ top: H / 2 - t - 1.5 }} />
    </div>
  );
}

const PRIMARY_UNITS: [WheelId, string, string][] = [['lift', '暗部', 'Lift'], ['gamma', '中灰', 'Gamma'], ['gain', '亮部', 'Gain'], ['offset', '偏移', 'Offset']];
const LOG_UNITS: [WheelId, string, string][] = [['logSh', '陰影', 'Shadow'], ['logMid', '中間調', 'Midtone'], ['logHi', '高光', 'Highlight'], ['offset', '偏移', 'Offset']];
const TOP_ROW: [ScalarId | 'md', string][] = [['temp', '色溫'], ['tint', '色調'], ['contrast', '對比度'], ['pivot', '軸心'], ['md', '中間調細節']];
const BOTTOM_ROW: [ScalarId, string][] = [['colorBoost', '色彩增強'], ['shadows', '陰影'], ['highlights', '高光'], ['sat', '飽和度'], ['hue', '色相'], ['lumMix', '亮度混合']];
const LOG_BOTTOM_ROW: [ScalarId, string][] = [['lowRange', '低範圍'], ['highRange', '高範圍'], ['colorBoost', '色彩增強'], ['sat', '飽和度'], ['hue', '色相'], ['lumMix', '亮度混合']];
const MODES: [Mode, string][] = [['wheels', '一級校色輪'], ['bars', '一級校色條'], ['log', 'Log 色輪']];

export const PrimariesPanel = React.memo(function PrimariesPanel({ grade, midDetail, width, onStart, onChange, onCommit }: {
  grade: ColorGrade | undefined; midDetail: number; width: number;
  onStart: () => void; onChange: (g: ColorGrade, midDetail: number) => void; onCommit: () => void;
}) {
  const [mode, setModeS] = useState<Mode>(lastMode);
  const setMode = (m: Mode) => { lastMode = m; setModeS(m); };
  const [g, setG] = useState(() => normGrade(grade));
  const [md, setMd] = useState(midDetail);
  const gRef = useRef(g), mdRef = useRef(md);
  const dragging = useRef(false);
  /* 外面改的（復原／重做／全部重置）才同步進來；自己拖曳中不理 */
  useEffect(() => { if (!dragging.current) { const n = normGrade(grade); gRef.current = n; setG(n); } }, [grade]);
  useEffect(() => { if (!dragging.current) { mdRef.current = midDetail; setMd(midDetail); } }, [midDetail]);

  const ev: Ev = {
    onStart: () => { dragging.current = true; onStart(); },
    onEnd: () => { dragging.current = false; onCommit(); },
  };
  const push = (ng: ColorGrade, nmd = mdRef.current) => { gRef.current = ng; mdRef.current = nmd; setG(ng); setMd(nmd); onChange(ng, nmd); };
  const setWheel = (id: WheelId, w: YRGB) => push({ ...gRef.current, [id]: w });
  const setScalar = (id: ScalarId | 'md', v: number) => id === 'md' ? push(gRef.current, v) : push({ ...gRef.current, [id]: v });
  const resetAll = () => { ev.onStart(); push(freshGrade(), 0); ev.onEnd(); };

  const units = mode === 'log' ? LOG_UNITS : PRIMARY_UNITS;
  const unitW = (width - 16) / 4;
  const D = Math.round(Math.min(80, unitW - 10));
  const bottom = mode === 'log' ? LOG_BOTTOM_ROW : BOTTOM_ROW;
  const scalar = (id: ScalarId | 'md', label: string) => (
    <Scrub key={id} label={label} value={id === 'md' ? md : g[id]} spec={id === 'md' ? MID_DETAIL_SPEC : SCALAR_SPEC[id]}
      onChange={v => setScalar(id, v)} {...ev} />
  );
  return (
    <div className="w-full h-full flex flex-col justify-between px-2 pt-[6px] pb-[6px]" data-primaries-panel>
      <div className="flex items-center h-[20px]">
        <div className="flex rounded-[4px] bg-[#1a1a1a] border border-black/70 p-[1px]">
          {MODES.map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} data-grade-mode={m}
              className={`px-[7px] h-[16px] rounded-[3px] text-[9.5px] leading-none whitespace-nowrap ${mode === m ? 'bg-[#3a3a3a] text-white' : 'text-white/45'}`}>{l}</button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={resetAll} className="flex items-center gap-[3px] text-[9.5px] text-white/55 px-1 h-[18px]" aria-label="全部重置">
          <ResetIcon on /> 全部重置
        </button>
      </div>
      <div className="flex gap-[3px]">{TOP_ROW.map(([id, l]) => scalar(id, l))}</div>
      <div className="flex">
        {units.map(([id, l, en]) => (
          <WheelUnit key={`${mode}-${id}`} id={id} label={l} en={en} w={g[id]} D={D} bars={mode === 'bars'}
            onChange={w => setWheel(id, w)} {...ev} />
        ))}
      </div>
      <div className="flex gap-[3px]">{bottom.map(([id, l]) => scalar(id, l))}</div>
    </div>
  );
});
