import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clamp, fmt, RING_STOPS, useDrag, ResetIcon, type Ev } from './grade/controls';
import {
  WHEEL_SPEC, rgbToWheel, wheelToRgb, isWheelNeutral, freshWheels, normGrade, freshGrade,
  HDR_ZONES, isHdrWheelNeutral,
  type ColorGrade, type WheelId, type YRGB, type HdrWheel, type HdrZone, type HdrZoneId,
} from '../utils/colorGrade';

/* 色輪面板：照 DaVinci Resolve 桌面版的色輪調色板。
 *
 *   面板上方懸空的一列：模式（Log／一級調色／HDR）、HDR 的頁碼、重置（只重置目前這一種）
 *   每個色輪：名稱、色輪（顏色）、主轉盤（左右拖）、亮度（或曝光）的數值、
 *            一級／Log：R G B 三個通道的數值；HDR：飽和度／範圍／柔化
 *   HDR 有七個色輪，分兩頁，左右滑動換頁（也可以點頁碼）。
 *
 * 色輪只管「顏色」（往哪個色偏、偏多少），不會改變亮度；亮度一律由底下的主轉盤調。
 * R G B 數字就是色輪推出來的結果：哪個通道被加、哪個被減（跟 Resolve 一樣，可以左右拖微調）。
 * 所有數字都「按住左右拖」來改、點兩下回預設。拖曳中只重畫這個面板（本地 state），
 * 每一步交給 onChange 寫進編輯器的 paramsRef，放手才 onCommit（寫進 state 與復原紀錄）。 */

/** HSL 與色輪面板共用的高度（模式那一列在面板裡面，兩個工具的圖片縮放一樣） */
export const COLOUR_PANEL_H = 221;

type Mode = 'wheels' | 'log' | 'hdr';
/* 預設是 Log：陰影／中間調／高光各管一段，最接近 Lightroom 的三個色輪，也最直覺 */
let lastMode: Mode = 'log';
let lastHdrPage = 0;

const CH_COLOUR: Record<string, string> = { r: '#ff6b6b', g: '#5fd47a', b: '#6b9bff' };

/* 盤面上不會動的部分（色環、深色盤面、外框、十字線）先畫成一張點陣圖，每個尺寸只畫一次。
   以前用 conic／radial 漸層＋box-shadow，每個色輪都要瀏覽器即時光柵化，
   進色輪那一格四個一起畫，手機上就是「卡一下才出來」。點陣圖只要貼上去。 */
const discCache = new Map<string, string>();
const decoded: HTMLImageElement[] = [];
const discUrl = (D: number) => {
  const dpr = Math.min(3, Math.max(1, Math.round((typeof window !== 'undefined' && window.devicePixelRatio) || 1)));
  const key = `${D}@${dpr}`;
  let u = discCache.get(key);
  if (u) return u;
  const c = document.createElement('canvas');
  c.width = c.height = D * dpr;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const cx = D / 2, R = D / 2;
  // 色環：外緣 R-1.5，內緣被盤面蓋住；每 1° 一小塊，顏色照 10° 色標內插
  for (let d = 0; d < 360; d++) {
    const i = Math.floor(d / 10), t = (d % 10) / 10, A = RING_STOPS[i], B = RING_STOPS[i + 1];
    g.fillStyle = `rgb(${A.map((v, k) => Math.round(v + (B[k] - v) * t)).join(',')})`;
    const a0 = (d - 90 - 0.6) * Math.PI / 180, a1 = (d + 1 - 90 + 0.6) * Math.PI / 180;
    g.beginPath(); g.arc(cx, cx, R - 1.5, a0, a1); g.arc(cx, cx, R - 6, a1, a0, true); g.closePath(); g.fill();
  }
  // 盤面（含 1px 深色外框）
  const r = R - 5;
  g.beginPath(); g.arc(cx, cx, r + 1, 0, Math.PI * 2); g.fillStyle = '#050505'; g.fill();
  const gx = cx, gy = cx - r + r * 2 * 0.42, far = Math.hypot(r, r + Math.abs(gy - cx));
  const grad = g.createRadialGradient(gx, gy, 0, gx, gy, far);
  grad.addColorStop(0, '#262626'); grad.addColorStop(0.55, '#1b1b1b'); grad.addColorStop(1, '#141414');
  g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fillStyle = grad; g.fill();
  // 內側上緣一點點亮、下緣一點點暗（原本 box-shadow 的 inset）
  g.save(); g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.clip();
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.arc(cx, cx + 0.5, r - 0.5, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
  g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.arc(cx, cx - 1, r - 1, Math.PI * 0.1, Math.PI * 0.9); g.stroke();
  g.restore();
  // 十字線（不透明的灰，交叉處不會疊亮）
  g.strokeStyle = '#323232'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx, 9); g.lineTo(cx, D - 9); g.moveTo(9, cx); g.lineTo(D - 9, cx); g.stroke();
  u = c.toDataURL('image/png');
  discCache.set(key, u);
  // 先解碼好：第一次貼上去的那一格就不用等瀏覽器解 PNG
  const im = new Image(); im.src = u; im.decode?.().catch(() => {}); decoded.push(im);
  return u;
};

/* 編輯器一載入就在空檔把這支螢幕寬度會用到的盤面先畫好，第一次進色輪就不用現畫 */
if (typeof window !== 'undefined') {
  const warm = () => { try { const w = Math.min(window.innerWidth, 480); discUrl(Math.round(Math.min(82, (w - 12) / 4 - 12))); jogUrl(); } catch { /* 之後用到再畫 */ } };
  const ric = (window as any).requestIdleCallback as ((f: () => void, o?: any) => void) | undefined;
  if (ric) ric(warm, { timeout: 2000 }); else setTimeout(warm, 800);
}

/** 色輪盤面（向量示波器方向的細色環、深色盤面、十字線、調整點）。不會動的部分是一張點陣圖（見 discUrl） */
const WheelDisc: React.FC<{ D: number; px: number; py: number; drag: ReturnType<typeof useDrag>; id: string }> = ({ D, px, py, drag, id }) => (
  <div {...drag} data-grade-wheel={id} className="relative shrink-0 rounded-full touch-none select-none"
    style={{ width: D, height: D, backgroundImage: `url(${discUrl(D)})`, backgroundSize: '100% 100%' }}>
    <svg className="absolute inset-0 pointer-events-none" width={D} height={D}>
      {(px || py) ? <line x1={D / 2} y1={D / 2} x2={D / 2 + px} y2={D / 2 + py} stroke="#8a8a8a" strokeWidth="1" /> : null}
      <circle cx={D / 2 + px} cy={D / 2 + py} r={4.4} fill="#141414" stroke="#fff" strokeWidth="1.5" />
      <circle cx={D / 2 + px} cy={D / 2 + py} r={0.9} fill="#fff" />
    </svg>
  </div>
);

/* 轉盤的刻紋是一張 6px 寬的小點陣圖（2 倍解析度畫，手機上線條才銳利），左右拖只是挪背景位置。
   刻紋用不透明的灰色畫在圖裡：不會跟別的線疊在一起變白，也沒有陰影、反光那些假立體。 */
let jogTile = '';
const jogUrl = () => {
  if (jogTile) return jogTile;
  const c = document.createElement('canvas'); c.width = 12; c.height = 12;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5c5c5c'; g.fillRect(0, 0, 2, 12);
  return (jogTile = c.toDataURL('image/png'));
};

/** 主轉盤（jog wheel）：左右拖。一條平的軌道、一排等距刻紋、中間一根白色指針，兩端刻紋淡出 */
const Jog: React.FC<{ W: number; drag: ReturnType<typeof useDrag>; x: number; id: string }> = ({ W, drag, x, id }) => (
  <div {...drag} data-grade-jog={id} className="relative mt-[5px] rounded-full overflow-hidden touch-none select-none cursor-ew-resize"
    style={{ width: W, height: 12, background: '#1c1c1c' }}>
    <div aria-hidden className="absolute inset-x-0 top-[3px] bottom-[3px]" style={{
      background: `url(${jogUrl()}) ${x}px 0 / 6px 100% repeat-x`,
      WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 24%, #000 76%, transparent)',
      maskImage: 'linear-gradient(90deg, transparent, #000 24%, #000 76%, transparent)',
    }} />
    <div aria-hidden className="absolute left-1/2 top-[2px] bottom-[2px] w-[2px] -ml-px rounded-full bg-white" />
  </div>
);

const UnitHead: React.FC<{ label: string; D: number }> = ({ label, D }) => (
  <div className="flex items-center justify-center h-[16px]" style={{ width: D }}>
    <span className="text-[11px] leading-none text-white/75 whitespace-nowrap">{label}</span>
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
      {label && <span className="text-[8.5px] leading-[11px] text-white/35 whitespace-nowrap">{label}</span>}
      <span className="text-[9.5px] leading-[12px] tabular-nums" style={{ color: changed ? color : 'rgba(255,255,255,.4)' }}>{fmt(v, digits)}</span>
    </span>
  );
};

/** 主轉盤底下那一行：亮度（或曝光）的數值，獨立一行 */
const Level: React.FC<{ label: string; v: number; def: number; digits: number }> = ({ label, v, def, digits }) => (
  <span className="mt-[4px] text-[10px] leading-[13px] whitespace-nowrap tabular-nums" style={{ color: Math.abs(v - def) > 5e-4 ? '#fff' : 'rgba(255,255,255,.45)' }}>
    {label} {fmt(v, digits)}
  </span>
);

/** 一級／Log 的色輪單元 */
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
  /* 主轉盤：有 Y 的（暗部／中灰／亮部）改 Y；沒有的（偏移、Log）三個通道一起改 */
  const level = s.hasY ? w.y : (w.r + w.g + w.b) / 3;
  const [jogX, setJogX] = useState(0);
  const jog = useDrag({
    onStart, onEnd,
    onMove: dx => {
      setJogX(x => x + dx);
      const dv = dx * s.jog;
      onChange(s.hasY ? { ...w, y: clamp(w.y + dv, s.min, s.max) }
        : { ...w, r: clamp(w.r + dv, s.min, s.max), g: clamp(w.g + dv, s.min, s.max), b: clamp(w.b + dv, s.min, s.max) });
    },
    onDouble: () => {
      onStart();
      if (s.hasY) onChange({ ...w, y: s.neutral });
      else { const m = level - s.neutral; onChange({ ...w, r: w.r - m, g: w.g - m, b: w.b - m }); }
      onEnd();
    },
  });
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center" data-grade-unit={id}>
      <UnitHead label={label} D={D} />
      <div className="mt-[4px]"><WheelDisc D={D} px={px} py={py} drag={wheel} id={id} /></div>
      <Jog W={D - 8} drag={jog} x={jogX} id={id} />
      <Level label="亮度" v={level} def={s.neutral} digits={s.digits} />
      <div className="flex justify-center gap-[3px] mt-[2px]" style={{ width: D + 6 }}>
        {(['r', 'g', 'b'] as const).map(c => <Num key={c} v={w[c]} color={CH_COLOUR[c]} def={s.neutral} step={s.jog * 0.5} min={s.min} max={s.max} digits={s.neutral >= 10 ? 1 : s.digits}
          onStart={onStart} onEnd={onEnd} onChange={v => onChange({ ...w, [c]: v })} />)}
      </div>
    </div>
  );
};

/** HDR 色輪單元：跟一級一樣的色輪與主轉盤（主轉盤＝曝光），底下是飽和度／範圍／柔化 */
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
  const [jogX, setJogX] = useState(0);
  const jog = useDrag({
    onStart, onEnd,
    onMove: dx => { setJogX(x => x + dx); onChange({ ...w, exp: clamp(w.exp + dx * 0.01, -4, 4) }); },
    onDouble: () => { onStart(); onChange({ ...w, exp: 0 }); onEnd(); },
  });
  const zone = 'range' in w;
  const n = (k: string, lab: string, d: number, step: number, min: number, max: number) => (
    <Num key={k} label={lab} v={(w as any)[k]} color="#fff" def={d} step={step} min={min} max={max} digits={2}
      onStart={onStart} onEnd={onEnd} onChange={v => onChange({ ...w, [k]: v })} />
  );
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center" data-grade-unit={id}>
      <UnitHead label={label} D={D} />
      <div className="mt-[4px]"><WheelDisc D={D} px={px} py={py} drag={wheel} id={`hdr-${id}`} /></div>
      <Jog W={D - 8} drag={jog} x={jogX} id={`hdr-${id}`} />
      <Level label="曝光" v={w.exp} def={0} digits={2} />
      <div className="flex justify-center gap-[2px] mt-[2px]" style={{ width: D + 4 }}>
        {n('sat', '飽和', 1, 0.005, 0, 2)}
        {zone && n('range', '範圍', (def as HdrZone).range, 0.01, -8, 8)}
        {zone && n('falloff', '柔化', (def as HdrZone).falloff, 0.005, 0, 4)}
      </div>
    </div>
  );
};

const PRIMARY_UNITS: [WheelId, string][] = [['lift', '暗部'], ['gamma', '中灰'], ['gain', '亮部'], ['offset', '偏移']];
const LOG_UNITS: [WheelId, string][] = [['logSh', '陰影'], ['logMid', '中間調'], ['logHi', '高光'], ['offset', '偏移']];
const MODES: [Mode, string][] = [['log', 'Log'], ['wheels', '一級調色'], ['hdr', 'HDR']];
const HDR_PAGES: (HdrZoneId | 'global')[][] = [['black', 'dark', 'shadow', 'light'], ['highlight', 'specular', 'global']];

export const PrimariesPanel = React.memo(function PrimariesPanel({ grade, width, onStart, onChange, onCommit }: {
  grade: ColorGrade | undefined; width: number;
  onStart: () => void; onChange: (g: ColorGrade) => void; onCommit: () => void;
}) {
  const [mode, setModeS] = useState<Mode>(((lastMode as string) === 'bars' ? 'wheels' : lastMode));
  const setMode = (m: Mode) => { lastMode = m; setModeS(m); };
  const [page, setPageS] = useState(lastHdrPage);
  const [g, setG] = useState(() => normGrade(grade));
  const gRef = useRef(g);
  const dragging = useRef(false);
  /* 外面改的（復原／重做）才同步進來；自己拖曳中不理 */
  useEffect(() => { if (!dragging.current) { const n = normGrade(grade); gRef.current = n; setG(n); } }, [grade]);

  /* HDR 兩頁：橫向捲動＋吸附，左右滑換頁；頁碼跟著捲動位置走，點頁碼也能換頁 */
  const pager = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = pager.current;
    if (mode === 'hdr' && el) el.scrollLeft = lastHdrPage * el.clientWidth;
  }, [mode]);
  const onPagerScroll = () => {
    const el = pager.current; if (!el || !el.clientWidth) return;
    const p = Math.round(el.scrollLeft / el.clientWidth);
    if (p !== lastHdrPage) { lastHdrPage = p; setPageS(p); }
  };
  const goPage = (p: number) => { const el = pager.current; if (el) el.scrollTo({ left: p * el.clientWidth, behavior: 'smooth' }); };

  const ev: Ev = {
    onStart: () => { dragging.current = true; onStart(); },
    onEnd: () => { dragging.current = false; onCommit(); },
  };
  const push = (ng: ColorGrade) => { gRef.current = ng; setG(ng); onChange(ng); };
  const setWheel = (id: WheelId, w: YRGB) => push({ ...gRef.current, [id]: w });
  const setHdr = (id: HdrZoneId | 'global', w: any) => push({ ...gRef.current, hdr: { ...gRef.current.hdr, [id]: w } });
  /* 重置：只重置目前這一種（偏移是一級與 Log 共用的，兩邊重置都會歸零） */
  const resetMode = () => {
    const f = freshWheels(), cur = gRef.current;
    ev.onStart();
    if (mode === 'hdr') push({ ...cur, hdr: freshGrade().hdr });
    else if (mode === 'log') push({ ...cur, logSh: f.logSh, logMid: f.logMid, logHi: f.logHi, offset: f.offset });
    else push({ ...cur, lift: f.lift, gamma: f.gamma, gain: f.gain, offset: f.offset });
    ev.onEnd();
  };
  const modeTouched = mode === 'hdr' ? HDR_ZONES.some(z => !isHdrWheelNeutral(g.hdr[z.id])) || !isHdrWheelNeutral(g.hdr.global)
    : (mode === 'log' ? (['logSh', 'logMid', 'logHi', 'offset'] as WheelId[]) : (['lift', 'gamma', 'gain', 'offset'] as WheelId[])).some(id => !isWheelNeutral(g[id], id));

  const unitW = (width - 12) / 4;
  const D = Math.round(Math.min(82, unitW - 12));
  const fresh = freshGrade().hdr;
  return (
    <div className="w-full h-full flex flex-col pt-[8px] pb-[6px]" data-primaries-panel>
      {/* 模式那一列：按下去就切換，不等放手 */}
      <div className="flex items-center h-[28px] px-[12px] gap-[6px]" data-grade-modes>
        {MODES.map(([m, l]) => (
          <button key={m} onPointerDown={e => { e.preventDefault(); setMode(m); }} data-grade-mode={m}
            className={`px-[12px] h-[28px] rounded-[8px] text-[12px] font-medium tracking-wide whitespace-nowrap border ${mode === m ? 'bg-white text-black border-white' : 'bg-white/[0.06] text-white/75 border-white/10'}`}>{l}</button>
        ))}
        <div className="flex-1" />
        {mode === 'hdr' && (
          <div className="flex items-center h-[28px]" data-hdr-page>
            {[0, 1].map(p => (
              <button key={p} onClick={() => goPage(p)} data-hdr-page-btn={p} className="w-[16px] h-[24px] flex items-center justify-center" aria-label={`第 ${p + 1} 頁`}>
                <span className={`block w-[6px] h-[6px] rounded-full ${page === p ? 'bg-white' : 'bg-white/30'}`} />
              </button>
            ))}
          </div>
        )}
        <button onClick={resetMode} data-grade-reset className="w-[34px] h-[28px] flex items-center justify-center active:scale-90 transition-transform duration-150" aria-label="重置目前的色輪">
          <ResetIcon on={modeTouched} size={16} />
        </button>
      </div>
      <div className="mt-[10px]">
        {mode !== 'hdr' ? (
          <div className="flex px-[6px]">
            {(mode === 'log' ? LOG_UNITS : PRIMARY_UNITS).map(([id, l]) => (
              <WheelUnit key={`${mode}-${id}`} id={id} label={l} w={g[id]} D={D} onChange={w => setWheel(id, w)} {...ev} />
            ))}
          </div>
        ) : (
          <div ref={pager} onScroll={onPagerScroll} data-hdr-pager
            className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory overscroll-x-contain">
            {HDR_PAGES.map((ids, pi) => (
              <div key={pi} className="w-full shrink-0 snap-start flex px-[6px]">
                {ids.map(id => {
                  const z = HDR_ZONES.find(q => q.id === id);
                  return <HdrUnit key={id} id={id} label={z ? z.label : '全域'} w={g.hdr[id]} def={fresh[id]} D={D} onChange={w => setHdr(id, w)} {...ev} />;
                })}
                {ids.length < 4 && <div className="flex-1 min-w-0" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
