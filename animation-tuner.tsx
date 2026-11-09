/* animation-tuner.html：調整「動畫預設值」的工具。
   左邊選目標與動畫、右邊拖滑桿，中間是真正的創意拼圖（iframe，sandbox：不存草稿）即時播放。
   預設值、滑桿刻度、動畫清單、數值換算都直接呼叫 App 裡同一份程式
   （motionPickPatch／motionUi／motionFromUi／motionKindLists），效果與數字跟 App 完全一樣。
   調好後按「複製」，把文字貼給 Claude，就會照這些數字改進 App。 */
import './styles.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  CollageTool, MO_DEFAULT, PATTERN_MO_DEFAULT, motionFromUi, motionKindLists, motionPickPatch, motionTargetCtxOf, motionUi,
  type MoCfg, type MotionTargetCtx,
} from './components/CollageTool';
import { FRAME_SCATTER } from './utils/frameShapes';

type Field = 'delay' | 'inSpeed' | 'amp' | 'speed';
type Phase = 'in' | 'idle';
const FIELD_NAME: Record<Field, string> = { delay: '起始', inSpeed: '速度', amp: '幅度', speed: '速度' };
/* 只有速度、沒有幅度滑桿的常駐動畫（跟 App 面板一致） */
const NO_AMP = new Set(['lab-P-L02', 'lab-T-L04']);
const STORE = 'abai-animation-tuner-v4';

/* ── 示範物件 ───────────────────────────────────────────────────────── */
const holesGrid = () => {
  const out: any[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push({ id: `h${r}${c}`, x: 170 + c * 280, y: 170 + r * 280 });
  return out;
};
const T = { rot: 0, opacity: 100 };
type Scene = { key: string; label: string; target: string; chip?: string; obj?: any; state: () => any };
const SCENES: Scene[] = ([
  { key: 'pattern', label: '圖案', target: 'shape', state: () => ({ holeCount: 9, holeType: 'star', holeSize: 40, holes: holesGrid(), objects: [] }) },
  { key: 'text', label: '文字', target: 'tx', chip: 'ABAI動畫', obj: { id: 'tx', type: 'text', text: 'ABAI動畫', color: '#FFFFFF', x: 150, y: 420, w: 700, h: 160, size: 120, ...T } },
  { key: 'symbol', label: '符號', target: 'sy', chip: '符號', obj: { id: 'sy', type: 'text', text: '⋆.˚✮⋆˚.⋆', sym: '⋆.˚✮⋆˚.⋆', color: '#FFFFFF', x: 150, y: 420, w: 700, h: 160, size: 120, ...T } },
  { key: 'image', label: '圖片', target: 'im', chip: '圖片', obj: { id: 'im', type: 'image', src: '', x: 300, y: 300, w: 400, h: 400, ...T } },
  { key: 'shape', label: '圖形', target: 'sh', chip: '圖形', obj: { id: 'sh', type: 'shape', kind: 'circle', filled: true, color: '#DCE7DB', x: 330, y: 330, w: 340, h: 340, lineW: 6, ...T } },
  { key: 'grid', label: '網格圖形', target: 'gr', chip: '圖形', obj: { id: 'gr', type: 'shape', kind: 'grid-cross', filled: false, color: '#DCE7DB', x: 200, y: 250, w: 600, h: 500, lineW: 6, ...T } },
  { key: 'line', label: '線條', target: 'ln', chip: '圖形', obj: { id: 'ln', type: 'shape', kind: 'wave', filled: false, color: '#DCE7DB', x: 150, y: 450, w: 700, h: 100, lineW: 6, ...T } },
  { key: 'glint', label: '星芒', target: 'gl', chip: '圖形', obj: { id: 'gl', type: 'shape', kind: 'hole', hole: 'sb-cross-thin', filled: true, color: '#FFFFFF', x: 300, y: 300, w: 400, h: 400, lineW: 6, ...T } },
  { key: 'scatter', label: '散落邊框', target: 'sc', chip: '圖形', obj: { id: 'sc', type: 'shape', kind: FRAME_SCATTER, filled: true, color: '#DCE7DB', x: 100, y: 100, w: 800, h: 800, lineW: 6, ...T } },
] as (Omit<Scene, 'state'> & { state?: () => any })[]).map(s => s.obj ? { ...s, state: () => ({ holeCount: 0, objects: [{ ...s.obj, mo: { ...MO_DEFAULT, in: 'none', idle: 'none' } }] }) } : s as Scene);
const ctxOf = (s: Scene): MotionTargetCtx => motionTargetCtxOf(s.obj || null);

const sampleCanvas = (a: string, b: string, c: string) => {
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 1200;
  const g = cv.getContext('2d')!;
  const lg = g.createLinearGradient(0, 0, 1200, 1200);
  lg.addColorStop(0, a); lg.addColorStop(.5, b); lg.addColorStop(1, c);
  g.fillStyle = lg; g.fillRect(0, 0, 1200, 1200);
  for (const [x, y, r, col] of [[300, 360, 240, '#ffffff44'], [880, 820, 320, '#1d2b4a55'], [420, 980, 180, '#e8735a55']] as const) {
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return cv;
};
const toFile = (cv: HTMLCanvasElement, name: string) => new Promise<File>(r => cv.toBlob(b => r(new File([b!], name, { type: 'image/jpeg' })), 'image/jpeg', .9));

/* ── 嵌在中間的預覽（?embed=場景）：整頁就是 App 的創意拼圖 ─────────── */
function Embed({ scene }: { scene: Scene }) {
  const [base, setBase] = useState<File | null>(null);
  const [imgSrc, setImgSrc] = useState('');
  const [tuner, setTuner] = useState<{ target: string; mo: Partial<MoCfg>; hold?: number; replay?: number } | null>(null);
  useEffect(() => {
    void toFile(sampleCanvas('#f4a6a0', '#f7d9a8', '#8fb9d8'), 'sample.jpg').then(setBase);
    void toFile(sampleCanvas('#2b5876', '#4e4376', '#f3904f'), 'object.jpg').then(f => setImgSrc(URL.createObjectURL(f)));
    const onMsg = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === 'tuner-mo') setTuner(e.data.payload); };
    window.addEventListener('message', onMsg);
    window.parent?.postMessage({ type: 'tuner-ready' }, location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const initialState = useMemo(() => {
    const st = scene.state();
    st.objects = st.objects.map((o: any) => o.type === 'image' ? { ...o, src: imgSrc } : o);
    return { layout: 'image-full', canvasRatio: '1:1', ...st };
  }, [scene, imgSrc]);
  /* 開好之後切到「動畫」分頁並選中示範物件，畫面跟在 App 裡調動畫時一樣 */
  useEffect(() => {
    if (!base || !imgSrc) return;
    let stop = false, tries = 0;
    const step = () => {
      if (stop || ++tries > 200) return;
      const tab = document.querySelector<HTMLButtonElement>('[data-creative-tab="motion"]');
      if (!tab) { setTimeout(step, 100); return; }
      if (!tab.dataset.tunerClicked) { tab.dataset.tunerClicked = '1'; tab.click(); }
      if (!scene.chip) return;
      const chip = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === scene.chip);
      if (chip) chip.click(); else setTimeout(step, 100);
    };
    const t = setTimeout(step, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [base, imgSrc, scene]);
  if (!base || !imgSrc) return null;
  return <CollageTool sandbox initialFile={base} initialState={initialState} tunerMotion={tuner} onHome={() => {}} onImportNew={() => {}} />;
}

/* ── 主頁 ───────────────────────────────────────────────────────────── */
type Range = [number, number];
type Edit = Partial<Record<Field, number>> & { range?: Partial<Record<Field, Range>> };
type Edits = Record<string, Edit>;
const loadEdits = (): Edits => { try { const v = JSON.parse(localStorage.getItem(STORE) || '{}'); return v && typeof v === 'object' ? v as Edits : {}; } catch { return {}; } };
const keyOf = (scene: string, phase: Phase, id: string) => `${scene}|${phase}|${id}`;

/* ── 滑桿 0～100 與實際數值 ──────────────────────────────────────────
   沒改範圍時一律用 App 自己的換算（motionUi／motionFromUi）；改了範圍才用這裡的對應：
   進場速度（動畫時長）跟 App 一樣是等比刻度，其他都是線性。 */
const UNIT: Record<Field, string> = { delay: '秒', inSpeed: '秒', amp: '', speed: '倍' };
const actualOf = (f: Field, c: MoCfg) => f === 'delay' ? c.delay : f === 'inSpeed' ? c.dur : f === 'amp' ? c.amp : c.speed;
const patchOf = (f: Field, v: number): Partial<MoCfg> => f === 'delay' ? { delay: v } : f === 'inSpeed' ? { dur: v } : f === 'amp' ? { amp: v } : { speed: v };
const mapUi = (f: Field, u: number, [lo, hi]: Range) => f === 'inSpeed' && lo > 0 && hi > 0 ? lo * Math.pow(hi / lo, u / 100) : lo + (hi - lo) * u / 100;
const invUi = (f: Field, v: number, [lo, hi]: Range) => {
  const t = f === 'inSpeed' && lo > 0 && hi > 0 && v > 0 ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / ((hi - lo) || 1);
  return Math.round(Math.max(0, Math.min(1, isFinite(t) ? t : 0)) * 100);
};
const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
type FieldState = { ui: number; defUi: number; appDefUi: number; range: Range; appRange: Range; defActual: number; actual: number; custom: boolean };

/** 某目標、某進場＋某常駐、套上修改後，實際寫進 App 的設定，以及每個滑桿的狀態 */
function computeCfg(scene: Scene, inId: string, idleId: string, edits: Edits) {
  const c = ctxOf(scene);
  const start: MoCfg = c.pattern ? PATTERN_MO_DEFAULT : MO_DEFAULT;
  const fields: Partial<Record<Field, FieldState>> = {};
  const apply = (cfg: MoCfg, f: Field, e: Edit): MoCfg => {
    const appUi = (motionUi(cfg, c) as any)[f] as number;
    const appRange: Range = [actualOf(f, { ...cfg, ...motionFromUi(f, 0, cfg, c) } as MoCfg), actualOf(f, { ...cfg, ...motionFromUi(f, 100, cfg, c) } as MoCfg)];
    const custom = e.range?.[f];
    const range = custom || appRange;
    const defActual = actualOf(f, cfg);
    const defUi = custom ? invUi(f, defActual, range) : appUi;
    const ui = e[f] ?? defUi;
    // 滑桿沒動過＝保留預設的實際數值（只改範圍時，預設位置取整不能讓實際值跟著偏掉）
    const next = e[f] === undefined ? cfg
      : { ...cfg, ...(custom ? patchOf(f, mapUi(f, ui, range)) : motionFromUi(f, ui, cfg, c)) } as MoCfg;
    fields[f] = { ui, defUi, appDefUi: appUi, range, appRange, defActual, actual: actualOf(f, next), custom: !!custom };
    return next;
  };
  let cfg: MoCfg = { ...start, ...motionPickPatch({ in: inId }, c, 'pop') } as MoCfg;
  const ein = inId !== 'none' ? edits[keyOf(scene.key, 'in', inId)] || {} : {};
  for (const f of ['delay', 'inSpeed'] as Field[]) cfg = apply(cfg, f, ein);
  cfg = { ...cfg, ...motionPickPatch({ idle: idleId }, c, cfg.in) } as MoCfg;
  const eid = idleId !== 'none' ? edits[keyOf(scene.key, 'idle', idleId)] || {} : {};
  for (const f of ['amp', 'speed'] as Field[]) cfg = apply(cfg, f, eid);
  return { cfg, fields: fields as Record<Field, FieldState> };
}

/** 自己做的滑桿：只認手指／滑鼠的拖動與點按，數值不會因為重新繪製或切換動畫而被瀏覽器改動。
    整條 44px 高都可以按，按到哪裡就跳到哪裡、接著拖；不會被頁面捲動搶走。 */
function DragSlider({ value, def, onChange, onCommit }: { value: number; def: number; onChange: (v: number) => void; onCommit?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const last = useRef(value);
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * 100);
  };
  const move = (clientX: number) => { const v = at(clientX); if (v !== last.current) { last.current = v; onChange(v); } };
  useEffect(() => { last.current = value; }, [value]);
  return (
    <div ref={ref} role="slider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} tabIndex={0}
      className="relative h-11 cursor-pointer select-none outline-none" style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
      onPointerDown={e => { e.preventDefault(); drag.current = e.pointerId; ref.current!.setPointerCapture(e.pointerId); move(e.clientX); }}
      onPointerMove={e => { if (drag.current === e.pointerId) move(e.clientX); }}
      onPointerUp={e => { if (drag.current === e.pointerId) { drag.current = null; onCommit?.(); } }}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={e => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
        if (d) { e.preventDefault(); onChange(Math.max(0, Math.min(100, value + d * (e.shiftKey ? 5 : 1)))); onCommit?.(); }
      }}>
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[4px] rounded-full bg-white/15" />
      <div className="absolute left-0 top-1/2 -translate-y-1/2 h-[4px] rounded-full bg-white/70" style={{ width: `${value}%` }} />
      {/* 預設值的位置 */}
      <div className="absolute top-1/2 -translate-y-1/2 w-[2px] h-4 rounded bg-white/40" style={{ left: `calc(${def}% - 1px)` }} />
      <div className="absolute top-1/2 w-6 h-6 -mt-3 -ml-3 rounded-full bg-white shadow-[0_1px_6px_rgba(0,0,0,.6)]" style={{ left: `${value}%` }} />
    </div>
  );
}

function NumberBox({ value, unit, onCommit }: { value: number; unit: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => { setText(fmt(value)); }, [value]);
  const done = () => { const v = Number(text); if (isFinite(v)) onCommit(v); else setText(fmt(value)); };
  return (
    <span className="inline-flex items-center gap-1">
      <input inputMode="decimal" value={text} onChange={e => setText(e.target.value)} onBlur={done}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-[72px] h-8 px-2 rounded-[8px] bg-white/[.08] border border-white/10 text-[13px] text-white tabular-nums outline-none focus:border-white/40" />
      {unit && <span className="text-[11px] text-white/45">{unit}</span>}
    </span>
  );
}

function SliderRow({ label, field, st, onChange, onRange, onCommit }: {
  label: string; field: Field; st: FieldState; onChange: (v: number) => void; onRange: (r: Range | null) => void; onCommit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const changed = st.ui !== st.defUi || st.custom;
  const unit = UNIT[field];
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[13px] text-white/80">{label}</span>
        <span className="flex items-baseline gap-3 tabular-nums">
          <span className="text-[11px] text-white/35">預設 {st.defUi}</span>
          <span className={`text-[18px] font-bold min-w-[2.5ch] text-right ${st.ui !== st.defUi ? 'text-[#ff9b80]' : 'text-white'}`}>{st.ui}</span>
        </span>
      </div>
      <DragSlider value={st.ui} def={st.defUi} onChange={onChange} onCommit={onCommit} />
      <div className="flex justify-between text-[10px] text-white/35 tabular-nums -mt-1 mb-1">
        <span>0 = {fmt(st.range[0])}{unit}</span>
        <span>實際 {fmt(st.actual)}{unit}</span>
        <span>100 = {fmt(st.range[1])}{unit}</span>
      </div>
      <div className="flex justify-between items-center mt-1 gap-2">
        <div className="flex gap-1">
          {[-5, -1, 1, 5].map(d => (
            <button key={d} onClick={() => { onChange(Math.max(0, Math.min(100, st.ui + d))); onCommit?.(); }}
              className="h-8 min-w-10 px-2 rounded-[8px] bg-white/[.06] text-[12px] text-white/70 tabular-nums active:bg-white/15">{d > 0 ? `+${d}` : d}</button>
          ))}
        </div>
        <div className="flex gap-1">
          <button onClick={() => setOpen(o => !o)}
            className={`h-8 px-3 whitespace-nowrap rounded-[8px] text-[12px] ${open || st.custom ? 'bg-white/15 text-white' : 'bg-white/[.06] text-white/70'}`}>範圍{st.custom ? ' ●' : ''}</button>
          <button disabled={st.ui === st.defUi} onClick={() => { onChange(st.defUi); onCommit?.(); }}
            className={`h-8 px-3 rounded-[8px] text-[12px] ${st.ui !== st.defUi ? 'bg-white/10 text-white' : 'text-white/20'}`}>回到預設</button>
        </div>
      </div>
      {open && (
        <div className="mt-2 rounded-[10px] bg-black/40 border border-white/10 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-white/70">滑桿 0 的值{field === 'inSpeed' ? '（最慢，動畫時長）' : '（最小）'}</span>
            <NumberBox value={st.range[0]} unit={unit} onCommit={v => { onRange([v, st.range[1]]); onCommit?.(); }} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-white/70">滑桿 100 的值{field === 'inSpeed' ? '（最快，動畫時長）' : '（最大）'}</span>
            <NumberBox value={st.range[1]} unit={unit} onCommit={v => { onRange([st.range[0], v]); onCommit?.(); }} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/35">App 目前：{fmt(st.appRange[0])}～{fmt(st.appRange[1])}{unit}</span>
            <button disabled={!st.custom} onClick={() => { onRange(null); onCommit?.(); }}
              className={`h-7 px-3 rounded-[7px] text-[12px] ${st.custom ? 'bg-white/10 text-white' : 'text-white/20'}`}>範圍回到 App 原本</button>
          </div>
          <p className="text-[11px] text-white/35 leading-relaxed">改範圍時，預設的實際數值不變（{fmt(st.defActual)}{unit}），所以預設在滑桿上的位置會跟著移動。</p>
        </div>
      )}
    </div>
  );
}

function Main() {
  const [sceneKey, setSceneKey] = useState('text');
  const scene = SCENES.find(s => s.key === sceneKey)!;
  const [sel, setSel] = useState<Record<string, { in: string; idle: string }>>({});
  const cur = sel[sceneKey] || { in: 'none', idle: 'none' };
  const [edits, setEdits] = useState<Edits>(() => loadEdits());
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(edits)); } catch { /* 私密模式 */ } }, [edits]);
  const [hold, setHold] = useState(1);
  const [replay, setReplay] = useState(0);
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const ctx = ctxOf(scene);
  const { kinds, idleKinds } = useMemo(() => motionKindLists(ctx), [sceneKey]);
  const { cfg, fields } = computeCfg(scene, cur.in, cur.idle, edits);

  /* 把目前的設定送進中間的預覽 */
  const send = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'tuner-mo', payload: { target: scene.target, mo: cfg, hold, replay } }, location.origin);
  }, [scene.target, JSON.stringify(cfg), hold, replay]);
  useEffect(() => { send(); }, [send]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === 'tuner-ready') send(); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [send]);
  /* 手機尺寸的預覽框，依可用空間等比縮放 */
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const fit = () => { const r = el.getBoundingClientRect(); setScale(Math.max(.3, Math.min(1, r.width / 390, r.height / 844))); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);

  const pick = (phase: Phase, id: string) => {
    setSel(s => ({ ...s, [sceneKey]: { ...cur, [phase]: id } }));
    if (phase === 'in') setReplay(r => r + 1);
  };
  /* 一個動畫的修改：滑桿位置（跟預設一樣就不記）與範圍（跟 App 一樣就不記）。全部回到原樣就整筆刪掉。 */
  const updateEdit = (phase: Phase, id: string, fn: (e: Edit) => Edit) => setEdits(all => {
    const k = keyOf(sceneKey, phase, id);
    const next = fn({ ...(all[k] || {}), range: { ...(all[k]?.range || {}) } });
    if (next.range && !Object.keys(next.range).length) delete next.range;
    const out = { ...all };
    if (Object.keys(next).length) out[k] = next; else delete out[k];
    return out;
  });
  const setField = (phase: Phase, id: string, f: Field, v: number) => updateEdit(phase, id, e => {
    const st = fields[f];
    if (v === st.defUi) delete e[f]; else e[f] = v;
    return e;
  });
  const setRange = (phase: Phase, id: string, f: Field, r: Range | null) => updateEdit(phase, id, e => {
    const st = fields[f];
    const same = !r || (Math.abs(r[0] - st.appRange[0]) < 1e-6 && Math.abs(r[1] - st.appRange[1]) < 1e-6);
    if (same) delete e.range![f]; else e.range![f] = r!;
    delete e[f];   // 範圍一改，滑桿位置重新以「預設的實際值」為準，避免數字對不上
    return e;
  });
  const modified = (phase: Phase, id: string) => !!edits[keyOf(sceneKey, phase, id)];

  /* 修改清單：每一項顯示「預設 → 新值」（預設照該動畫單獨被選時的數字算） */
  const list = useMemo(() => (Object.entries(edits) as [string, Edit][]).map(([k, v]) => {
    const [sk, phase, id] = k.split('|') as [string, Phase, string];
    const sc = SCENES.find(s => s.key === sk); if (!sc) return null;
    const c = ctxOf(sc), lists = motionKindLists(c);
    const name = (phase === 'in' ? lists.kinds : lists.idleKinds).find(x => x.id === id)?.name || id;
    const r = computeCfg(sc, phase === 'in' ? id : 'none', phase === 'idle' ? id : 'none', { [k]: v });
    const fs: Field[] = phase === 'in' ? ['delay', 'inSpeed'] : ['amp', 'speed'];
    const parts = fs.filter(f => v[f] !== undefined || v.range?.[f]).map(f => {
      const st = r.fields[f], u = UNIT[f], seg: string[] = [];
      if (st.custom) seg.push(`範圍（滑桿 0～100）${fmt(st.appRange[0])}～${fmt(st.appRange[1])}${u} → ${fmt(st.range[0])}～${fmt(st.range[1])}${u}`);
      if (v[f] !== undefined) seg.push(`預設 ${st.appDefUi}（${fmt(st.defActual)}${u}）→ ${st.ui}（${fmt(st.actual)}${u}）`);
      else seg.push(`預設實際值不變（${fmt(st.defActual)}${u}），在新範圍的滑桿上約是 ${st.ui}`);
      return `${FIELD_NAME[f]}：${seg.join('；')}`;
    });
    return { k, target: sc.label, phase, id, name, text: parts.join('｜') };
  }).filter(Boolean) as { k: string; target: string; phase: Phase; id: string; name: string; text: string }[], [edits]);
  const copyText = ['請把以下動畫的預設值與滑桿範圍改成這樣（滑桿數字為創意拼圖動畫面板上的 0～100，括號內是實際數值）：',
    ...list.map(r => `- ${r.target}｜${r.phase === 'in' ? '進場' : '常駐'}｜${r.name}（${r.id}）：${r.text}`)].join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(copyText); }
    catch { const ta = document.createElement('textarea'); ta.value = copyText; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const kindButton = (phase: Phase, k: { id: string; name: string }) => {
    const on = (phase === 'in' ? cur.in : cur.idle) === k.id;
    return (
      <button key={k.id} onClick={() => pick(phase, k.id)}
        className={`relative h-9 px-2 rounded-[9px] border text-[12px] font-bold ${on ? 'bg-white text-black border-white' : 'border-white/12 text-white/70 hover:bg-white/[.06]'}`}>
        {k.name}
        {k.id !== 'none' && modified(phase, k.id) && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#ff7a59]" />}
      </button>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-black text-white" style={{ fontFamily: 'system-ui, -apple-system, "PingFang TC", sans-serif' }}>
      <header className="sticky top-0 z-10 bg-black/90 backdrop-blur border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-bold">動畫預設值調整</div>
            <div className="text-[11px] text-white/40 truncate">選目標 → 選動畫 → 拖滑桿，中間即時預覽（跟 App 同一套程式）</div>
          </div>
          <button disabled={!list.length} onClick={copy}
            className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-bold ${list.length ? 'bg-white text-black' : 'bg-white/10 text-white/30'}`}>
            {copied ? '已複製' : `複製修改內容${list.length ? `（${list.length}）` : ''}`}
          </button>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto p-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_360px]">
        {/* 左：目標與動畫 */}
        <section className="order-1 space-y-4">
          <div>
            <p className="text-[11px] font-bold text-white/40 tracking-widest mb-2">目標</p>
            <div className="flex flex-wrap gap-1.5">
              {SCENES.map(s => (
                <button key={s.key} onClick={() => setSceneKey(s.key)}
                  className={`h-8 px-3 rounded-full border text-[12px] font-bold ${s.key === sceneKey ? 'bg-white text-black border-white' : 'border-white/15 text-white/70'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold text-white/40 tracking-widest mb-2">進場動畫</p>
            <div className="grid grid-cols-4 gap-1.5">{kinds.map(k => kindButton('in', k))}</div>
          </div>
          <div>
            <p className="text-[11px] font-bold text-white/40 tracking-widest mb-2">常駐動畫</p>
            <div className="grid grid-cols-4 gap-1.5">{idleKinds.map(k => kindButton('idle', k))}</div>
          </div>
          <p className="text-[11px] text-white/35">橘點＝這個動畫已經改過。</p>
        </section>

        {/* 中：預覽 */}
        <section className="order-2 flex flex-col items-center">
          <div ref={boxRef} className="w-full h-[62dvh] lg:h-[calc(100dvh-140px)] flex items-start justify-center">
            <div style={{ width: 390 * scale, height: 844 * scale }} className="rounded-[28px] overflow-hidden border border-white/15 bg-black shrink-0">
              <iframe ref={frameRef} key={sceneKey} title="預覽" src={`./animation-tuner.html?embed=${sceneKey}`}
                style={{ width: 390, height: 844, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }} />
            </div>
          </div>
          <p className="text-[11px] text-white/35 mt-2">預覽只能看、不能點（參數請在旁邊調）</p>
          <div className="w-full max-w-[420px] mt-2 flex items-center gap-3">
            <button onClick={() => setReplay(r => r + 1)} className="h-9 px-4 rounded-full bg-white/10 text-[13px] font-bold">重播</button>
            <span className="text-[12px] text-white/50 shrink-0">循環間隔 {hold} 秒</span>
            <div className="flex-1"><DragSlider value={Math.round(hold * 10)} def={10} onChange={v => setHold(Math.round(v / 5) / 2)} /></div>
          </div>
        </section>

        {/* 右：參數 */}
        <section className="order-3 space-y-4">
          <div className="rounded-[14px] bg-white/[.04] border border-white/10 px-4 py-2">
            <p className="text-[12px] font-bold pt-2">進場：{kinds.find(k => k.id === cur.in)?.name || '無'}</p>
            {cur.in === 'none' ? <p className="text-[12px] text-white/35 py-3">左邊選一個進場動畫。</p> : <>
              <SliderRow label="起始" field="delay" st={fields.delay} onChange={v => setField('in', cur.in, 'delay', v)} onRange={r => setRange('in', cur.in, 'delay', r)} onCommit={() => setReplay(r => r + 1)} />
              <SliderRow label="速度" field="inSpeed" st={fields.inSpeed} onChange={v => setField('in', cur.in, 'inSpeed', v)} onRange={r => setRange('in', cur.in, 'inSpeed', r)} onCommit={() => setReplay(r => r + 1)} />
            </>}
          </div>
          <div className="rounded-[14px] bg-white/[.04] border border-white/10 px-4 py-2">
            <p className="text-[12px] font-bold pt-2">常駐：{idleKinds.find(k => k.id === cur.idle)?.name || '無'}</p>
            {cur.idle === 'none' ? <p className="text-[12px] text-white/35 py-3">左邊選一個常駐動畫。</p> : <>
              {!NO_AMP.has(cur.idle) && <SliderRow label="幅度" field="amp" st={fields.amp} onChange={v => setField('idle', cur.idle, 'amp', v)} onRange={r => setRange('idle', cur.idle, 'amp', r)} />}
              <SliderRow label="速度" field="speed" st={fields.speed} onChange={v => setField('idle', cur.idle, 'speed', v)} onRange={r => setRange('idle', cur.idle, 'speed', r)} />
            </>}
          </div>
          <div className="rounded-[14px] bg-white/[.04] border border-white/10 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] font-bold">要修改的預設值（{list.length}）</p>
              {list.length > 0 && <button onClick={() => { if (confirm('清掉全部修改？')) setEdits({}); }} className="text-[11px] text-white/40">全部清除</button>}
            </div>
            {list.length === 0 ? <p className="text-[12px] text-white/35">還沒有。拖任一個滑桿，跟預設不同就會列在這裡。</p> : (
              <div className="divide-y divide-white/5">
                {list.map(r => (
                  <div key={r.k} className="flex items-start gap-2 py-2">
                    <button className="flex-1 min-w-0 text-left" onClick={() => { const sk = r.k.split('|')[0]; setSceneKey(sk); setSel(s => ({ ...s, [sk]: { ...(s[sk] || { in: 'none', idle: 'none' }), [r.phase]: r.id } })); }}>
                      <div className="text-[12px] font-bold">{r.target}｜{r.phase === 'in' ? '進場' : '常駐'}｜{r.name}</div>
                      <div className="text-[12px] text-[#ff9b80] tabular-nums">{r.text}</div>
                    </button>
                    <button aria-label="刪除這一項" onClick={() => setEdits(e => { const n = { ...e }; delete n[r.k]; return n; })} className="w-7 h-7 rounded-full text-white/40">×</button>
                  </div>
                ))}
              </div>
            )}
            {list.length > 0 && <pre className="mt-2 text-[11px] text-white/40 whitespace-pre-wrap break-words">{copyText}</pre>}
          </div>
        </section>
      </div>
    </div>
  );
}

const embed = new URLSearchParams(location.search).get('embed');
const embedScene = embed ? SCENES.find(s => s.key === embed) : null;
ReactDOM.createRoot(document.getElementById('root')!).render(embedScene ? <Embed scene={embedScene} /> : <Main />);
