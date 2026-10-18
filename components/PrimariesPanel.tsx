import React, { useEffect, useRef, useState } from 'react';
import { clamp, fmt, RING, useDrag, ResetIcon, type Ev } from './grade/controls';
import {
  WHEEL_SPEC, rgbToWheel, wheelToRgb, isWheelNeutral, freshWheels, normGrade, freshGrade,
  HDR_ZONES, isHdrWheelNeutral,
  type ColorGrade, type WheelId, type YRGB, type HdrWheel, type HdrZone, type HdrZoneId,
} from '../utils/colorGrade';

/* 調色輪面板：照 DaVinci Resolve 桌面版的色輪調色板。
 *
 *   上：模式（一級校色輪／Log 色輪／HDR）、HDR 的換頁、重置
 *   一級／Log：四個色輪：名稱＋重置鍵、色輪（顏色）、底下的亮度滑桿（Resolve 的主轉盤）
 *   HDR：七個色輪分兩頁（黑色、暗部、陰影、亮部｜高光、鏡面高光、全域），
 *        每個：色輪（顏色）、曝光滑桿、飽和度／範圍／柔化
 *
 * 色輪只管「顏色」（往哪個色偏、偏多少），不會改變亮度；亮度一律由底下那根滑桿調。
 *
 * 所有數字都跟 Resolve 一樣「按住左右拖」來改，點兩下回到預設值。
 * 色輪是相對拖曳（不會跳到手指底下），乘 0.6 方便細調。
 * 拖曳中只重畫這個面板（本地 state），每一步交給 onChange 寫進編輯器的 paramsRef，
 * 放手才 onCommit（寫進 state 與復原紀錄）。 */

/** 面板高度：跟 HSL 面板一樣，切換時圖片位置完全不動 */
export const COLOUR_PANEL_H = 221;

type Mode = 'wheels' | 'log' | 'hdr';
let lastMode: Mode = 'wheels';
if ((lastMode as string) === 'bars') lastMode = 'wheels';
let lastHdrPage = 0;

/** 色輪盤面（向量示波器方向的細色環、深色盤面、十字線、調整點） */
const WheelDisc: React.FC<{ D: number; px: number; py: number; drag: ReturnType<typeof useDrag>; id: string }> = ({ D, px, py, drag, id }) => (
  <div {...drag} data-grade-wheel={id} className="relative shrink-0 rounded-full touch-none select-none" style={{ width: D, height: D }}>
    <div className="absolute inset-0 rounded-full pointer-events-none" style={{
      background: RING, opacity: 0.72, filter: 'saturate(.8)',
      WebkitMaskImage: `radial-gradient(circle, transparent ${D / 2 - 4}px, #000 ${D / 2 - 3.5}px, #000 ${D / 2 - 1.5}px, transparent ${D / 2 - 1}px)`,
      maskImage: `radial-gradient(circle, transparent ${D / 2 - 4}px, #000 ${D / 2 - 3.5}px, #000 ${D / 2 - 1.5}px, transparent ${D / 2 - 1}px)`,
    }} />
    <div className="absolute rounded-full pointer-events-none" style={{
      inset: 5, background: 'radial-gradient(circle at 50% 42%, #2e2e2e 0%, #222 55%, #191919 100%)',
      boxShadow: '0 0 0 1px #050505, inset 0 1px 1px rgba(255,255,255,.05), inset 0 -2px 4px rgba(0,0,0,.45)',
    }} />
    <svg className="absolute inset-0 pointer-events-none" width={D} height={D}>
      <g stroke="rgba(255,255,255,.09)" strokeWidth="1">
        <line x1={D / 2} y1={9} x2={D / 2} y2={D - 9} /><line x1={9} y1={D / 2} x2={D - 9} y2={D / 2} />
      </g>
      <circle cx={D / 2} cy={D / 2} r={(D / 2 - 9) * 0.5} fill="none" stroke="rgba(255,255,255,.05)" />
      {(px || py) ? <line x1={D / 2} y1={D / 2} x2={D / 2 + px} y2={D / 2 + py} stroke="rgba(255,255,255,.35)" strokeWidth="1" /> : null}
      <circle cx={D / 2 + px} cy={D / 2 + py} r={4.4} fill="rgba(0,0,0,.35)" stroke="#fff" strokeWidth="1.5" />
      <circle cx={D / 2 + px} cy={D / 2 + py} r={0.9} fill="#fff" />
    </svg>
  </div>
);

/** 色輪底下的滑桿（Resolve 的主轉盤）：左右拖、點兩下回預設。相對拖曳，手指按哪裡都不會跳。 */
const WheelSlider: React.FC<Ev & { W: number; value: number; def: number; span: number; step: number; min: number; max: number; digits: number; label: string; id: string; onChange: (v: number) => void }> = ({ W, value, def, span, step, min, max, digits, label, id, onChange, onStart, onEnd }) => {
  const acc = useRef(value);
  const drag = useDrag({
    onStart: () => { acc.current = value; onStart(); },
    onMove: dx => { acc.current = clamp(acc.current + dx * step, min, max); onChange(acc.current); },
    onEnd,
    onDouble: () => { onStart(); onChange(def); onEnd(); },
  });
  const t = clamp((value - def) / span, -1, 1);
  const changed = Math.abs(value - def) > 5e-4;
  return (
    <div {...drag} data-grade-jog={id} className="flex flex-col items-center touch-none select-none cursor-ew-resize mt-[5px]" style={{ width: W }}>
      <div className="relative w-full h-[14px]">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/15" />
        <div className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/80" style={{ left: `${50 + Math.min(0, t) * 50}%`, width: `${Math.abs(t) * 50}%` }} />
        <div className="absolute left-1/2 top-1/2 -translate-y-1/2 w-[1px] h-[7px] bg-white/35" />
        <div className="absolute top-1/2 w-[12px] h-[12px] -ml-[6px] -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `${50 + t * 50}%` }} />
      </div>
      <span className="mt-[3px] text-[10px] leading-none whitespace-nowrap tabular-nums" style={{ color: changed ? '#fff' : 'rgba(255,255,255,.45)' }}>
        {label} {fmt(value, digits)}
      </span>
    </div>
  );
};

const UnitHead: React.FC<{ label: string; neutral: boolean; onReset: () => void; D: number }> = ({ label, neutral, onReset, D }) => (
  <div className="relative flex items-center justify-center h-[16px]" style={{ width: D }}>
    <span className="text-[11px] leading-none text-white/75 whitespace-nowrap">{label}</span>
    <button onClick={onReset} className="absolute -right-[4px] top-1/2 -translate-y-1/2 p-[3px]" aria-label={`重置${label}`}><ResetIcon on={!neutral} /></button>
  </div>
);

/** 拖曳數值（色輪底下的小數字） */
const Num: React.FC<Ev & { v: number; color: string; def: number; step: number; min: number; max: number; digits: number; label?: string; onChange: (v: number) => void }> = ({ v, color, def, step, min, max, digits, label, onChange, onStart, onEnd }) => {
  const acc = useRef(v);
  const drag = useDrag({
    onStart: () => { acc.current = v; onStart(); },
    onMove: dx => { acc.current = clamp(acc.current + dx * step, min, max); onChange(acc.current); },
    onEnd,
    onDouble: () => { onStart(); onChange(def); onEnd(); },
  });
  const changed = Math.abs(v - def) > 5e-3;
  return (
    <span {...drag} className="flex-1 min-w-0 flex flex-col items-center touch-none select-none cursor-ew-resize">
      {label && <span className="text-[8.5px] leading-[10px] text-white/35">{label}</span>}
      <span className="text-[9.5px] leading-[12px] tabular-nums tracking-[-0.2px]" style={{ color: changed ? color : 'rgba(255,255,255,.4)' }}>{fmt(v, digits)}</span>
    </span>
  );
};

/** 一級／Log 的色輪（或色條）單元 */
const WheelUnit: React.FC<Ev & { id: WheelId; label: string; w: YRGB; D: number; onChange: (w: YRGB) => void }> = ({ id, label, w, D, onChange, onStart, onEnd }) => {
  const s = WHEEL_SPEC[id];
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
  /* 亮度：有 Y 的（暗部／中灰／亮部）改 Y；沒有的（偏移、Log）三個通道一起改 */
  const level = s.hasY ? w.y : (w.r + w.g + w.b) / 3;
  const setLevel = (v: number) => {
    if (s.hasY) { onChange({ ...w, y: clamp(v, s.min, s.max) }); return; }
    const d = v - level;
    onChange({ ...w, r: clamp(w.r + d, s.min, s.max), g: clamp(w.g + d, s.min, s.max), b: clamp(w.b + d, s.min, s.max) });
  };
  const reset = () => { onStart(); onChange({ y: s.neutral, r: s.neutral, g: s.neutral, b: s.neutral }); onEnd(); };
  const span = id === 'gain' ? 1 : id === 'offset' ? 25 : 0.5;
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center" data-grade-unit={id}>
      <UnitHead label={label} neutral={isWheelNeutral(w, id)} onReset={reset} D={D} />
      <div className="mt-[4px]"><WheelDisc D={D} px={px} py={py} drag={wheel} id={id} /></div>
      <WheelSlider W={D - 8} value={level} def={s.neutral} span={span} step={s.jog} min={s.min} max={s.max} digits={s.digits} label="亮度" id={id}
        onChange={setLevel} onStart={onStart} onEnd={onEnd} />
    </div>
  );
};

/** HDR 色輪單元：色彩平衡、主轉盤＝曝光、曝光／飽和度、範圍／柔化 */
const HdrUnit: React.FC<Ev & { id: HdrZoneId | 'global'; label: string; w: HdrWheel | HdrZone; def: HdrWheel | HdrZone; D: number; onChange: (w: any) => void }> = ({ id, label, w, def, D, onChange, onStart, onEnd }) => {
  const R = D / 2 - 9;
  let px = w.x * R, py = -w.y * R;
  { const r = Math.hypot(px, py); if (r > R) { px *= R / r; py *= R / r; } }
  const pos = useRef({ x: 0, y: 0 });
  const wheel = useDrag({
    onStart: () => { pos.current = { x: px, y: py }; onStart(); },
    onMove: (dx, dy) => {
      const p = pos.current; p.x += dx * 0.6; p.y += dy * 0.6;
      const r = Math.hypot(p.x, p.y); if (r > R) { p.x *= R / r; p.y *= R / r; }
      onChange({ ...w, x: p.x / R, y: -p.y / R });
    },
    onEnd,
    onDouble: () => { onStart(); onChange({ ...w, x: 0, y: 0 }); onEnd(); },
  });
  const zone = 'range' in w;
  const reset = () => { onStart(); onChange({ ...def }); onEnd(); };
  const neutral = isHdrWheelNeutral(w) && (!zone || ((w as HdrZone).range === (def as HdrZone).range && (w as HdrZone).falloff === (def as HdrZone).falloff));
  const n = (k: string, lab: string, d: number, step: number, min: number, max: number) => (
    <Num key={k} label={lab} v={(w as any)[k]} color="#fff" def={d} step={step} min={min} max={max} digits={2}
      onStart={onStart} onEnd={onEnd} onChange={v => onChange({ ...w, [k]: v })} />
  );
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center" data-grade-unit={id}>
      <UnitHead label={label} neutral={neutral} onReset={reset} D={D} />
      <div className="mt-[3px]"><WheelDisc D={D} px={px} py={py} drag={wheel} id={`hdr-${id}`} /></div>
      <WheelSlider W={D - 6} value={w.exp} def={0} span={2} step={0.01} min={-4} max={4} digits={2} label="曝光" id={`hdr-${id}`}
        onChange={v => onChange({ ...w, exp: v })} onStart={onStart} onEnd={onEnd} />
      <div className="w-full flex justify-center mt-[4px]">
        {n('sat', '飽和度', 1, 0.005, 0, 2)}{zone && n('range', '範圍', (def as HdrZone).range, 0.01, -8, 8)}
      </div>
      {zone && <div className="w-full flex justify-center">{n('falloff', '柔化', (def as HdrZone).falloff, 0.005, 0, 4)}</div>}
    </div>
  );
};

const PRIMARY_UNITS: [WheelId, string][] = [['lift', '暗部'], ['gamma', '中灰'], ['gain', '亮部'], ['offset', '偏移']];
const LOG_UNITS: [WheelId, string][] = [['logSh', '陰影'], ['logMid', '中間調'], ['logHi', '高光'], ['offset', '偏移']];
const MODES: [Mode, string][] = [['wheels', '一級校色輪'], ['log', 'Log 色輪'], ['hdr', 'HDR 色輪']];
const HDR_PAGES: (HdrZoneId | 'global')[][] = [['black', 'dark', 'shadow', 'light'], ['highlight', 'specular', 'global']];

export const PrimariesPanel = React.memo(function PrimariesPanel({ grade, width, onStart, onChange, onCommit }: {
  grade: ColorGrade | undefined; width: number;
  onStart: () => void; onChange: (g: ColorGrade) => void; onCommit: () => void;
}) {
  const [mode, setModeS] = useState<Mode>(lastMode);
  const setMode = (m: Mode) => { lastMode = m; setModeS(m); };
  const [page, setPageS] = useState(lastHdrPage);
  const setPage = (p: number) => { lastHdrPage = p; setPageS(p); };
  const [g, setG] = useState(() => normGrade(grade));
  const gRef = useRef(g);
  const dragging = useRef(false);
  /* 外面改的（復原／重做）才同步進來；自己拖曳中不理 */
  useEffect(() => { if (!dragging.current) { const n = normGrade(grade); gRef.current = n; setG(n); } }, [grade]);

  const ev: Ev = {
    onStart: () => { dragging.current = true; onStart(); },
    onEnd: () => { dragging.current = false; onCommit(); },
  };
  const push = (ng: ColorGrade) => { gRef.current = ng; setG(ng); onChange(ng); };
  const setWheel = (id: WheelId, w: YRGB) => push({ ...gRef.current, [id]: w });
  const setHdr = (id: HdrZoneId | 'global', w: any) => push({ ...gRef.current, hdr: { ...gRef.current.hdr, [id]: w } });
  // 重置這個工具（一級、Log、HDR 全部）
  const resetAll = () => { ev.onStart(); push({ ...gRef.current, ...freshWheels(), hdr: freshGrade().hdr }); ev.onEnd(); };

  const unitW = (width - 12) / 4;
  const D = Math.round(Math.min(84, unitW - 10));
  const hdrD = Math.round(Math.min(72, unitW - 12));
  const fresh = freshGrade().hdr;
  return (
    <div className="w-full h-full flex flex-col px-[6px] pt-[8px] pb-[6px]" data-primaries-panel>
      <div className="flex items-center h-[28px] px-[2px]">
        <div className="flex rounded-[7px] bg-[#1a1a1a] border border-black/70 p-[2px]">
          {MODES.map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} data-grade-mode={m}
              className={`px-[9px] h-[24px] rounded-[5px] text-[11px] leading-none whitespace-nowrap ${mode === m ? 'bg-[#3d3d3d] text-white' : 'text-white/50'}`}>{l}</button>
          ))}
        </div>
        <div className="flex-1" />
        {mode === 'hdr' && (
          <div className="flex items-center" data-hdr-page>
            {[0, 1].map(p => (
              <button key={p} onClick={() => setPage(p)} data-hdr-page-btn={p} className="w-[18px] h-[24px] flex items-center justify-center" aria-label={`第 ${p + 1} 頁`}>
                <span className={`block w-[7px] h-[7px] rounded-full ${page === p ? 'bg-white' : 'bg-white/25'}`} />
              </button>
            ))}
          </div>
        )}
        <button onClick={resetAll} className="w-[28px] h-[28px] flex items-center justify-center" aria-label="全部重置"><ResetIcon on /></button>
      </div>
      <div className="flex-1 flex items-center">
        <div className="w-full flex">
          {mode !== 'hdr' ? (mode === 'log' ? LOG_UNITS : PRIMARY_UNITS).map(([id, l]) => (
            <WheelUnit key={`${mode}-${id}`} id={id} label={l} w={g[id]} D={D} onChange={w => setWheel(id, w)} {...ev} />
          )) : HDR_PAGES[page].map(id => {
            const z = HDR_ZONES.find(q => q.id === id);
            return <HdrUnit key={id} id={id} label={z ? z.label : '全域'} w={g.hdr[id]} def={fresh[id]} D={hdrD} onChange={w => setHdr(id, w)} {...ev} />;
          })}
          {mode === 'hdr' && page === 1 && <div className="flex-1 min-w-0" />}
        </div>
      </div>
    </div>
  );
});
