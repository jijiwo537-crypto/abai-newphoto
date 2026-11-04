/* 點陣文字：照片轉成可以複製貼上的點字圖案（演算法見 utils/dotArt）
   上面是成品（黑底白點、即時更新、可以用手指畫點／擦點），下面一根滑桿＋一排工具。 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, Copy, Check, Plus } from 'lucide-react';
import { Icon } from './Icon';
import { Glyph } from './Glyph';
import { DOT_ART_DEFAULTS, DOT_ART_SHADE_THRESHOLD, DotArtSession, invertDotArt, prepareDotArtImage, warmLineArtModel, type DotArtFrame, type DotArtSettings } from '../utils/dotArt';

type Kind = 'line' | 'shade';
type ToolId = 'width' | 'threshold' | 'lines' | 'thicken' | 'draw' | 'erase';
interface ToolDef { id: ToolId; label: string; glyph: React.ReactNode; min: number; max: number; decimals?: boolean }
/* 圖示沿用其他功能的同名工具：大小、擦除＝遮色片筆刷；筆刷＝人像修容；明暗＝調節的亮度 */
const TOOLS: ToolDef[] = [
  { id: 'width', label: '大小', glyph: <Glyph k="size" />, min: 1, max: 200 },
  { id: 'threshold', label: '明暗', glyph: <Icon name="light_mode" className="text-[20px]" />, min: 0.01, max: 0.99, decimals: true },
  { id: 'lines', label: '線條', glyph: <Glyph k="lines" />, min: 0, max: 20 },
  { id: 'thicken', label: '粗細', glyph: <Glyph k="weight" />, min: 0, max: 10 },
  { id: 'draw', label: '筆刷', glyph: <Icon name="brush" className="text-[20px]" />, min: 1, max: 8 },
  { id: 'erase', label: '擦除', glyph: <Glyph k="erase" />, min: 1, max: 8 },
];
/** 滑桿是連續的（拖起來不會一格一格），算圖時才取到該有的刻度 */
const snap = (id: ToolId, v: number) => (id === 'threshold' ? Math.round(v * 100) / 100 : Math.round(v));

/* 點字 ⇄ 點陣：每格 8 個位元對應的位置 [欄, 列] */
const POS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];
const BIT_AT = [[0, 3], [1, 4], [2, 5], [6, 7]];   // [列][欄] → 位元
/** 手畫的點：1＝點亮、2＝擦掉（0＝照算出來的） */
interface Edit { cols: number; rows: number; marks: Uint8Array }
const applyEdit = (text: string, e: Edit | undefined) => {
  if (!e) return text;
  const lines = text.split('\n');
  if (lines.length !== e.rows || Math.max(...lines.map(l => l.length)) !== e.cols) return text;
  const W = e.cols * 2;
  return lines.map((l, y) => Array.from(l, (ch, x) => {
    let code = ch.charCodeAt(0) - 0x2800;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) {
      const m = e.marks[(y * 4 + r) * W + x * 2 + k];
      if (m === 1) code |= 1 << BIT_AT[r][k]; else if (m === 2) code &= ~(1 << BIT_AT[r][k]);
    }
    return String.fromCharCode(0x2800 + code);
  }).join('')).join('\n');
};

export function DotArtStudio({ onClose, initialFiles }: { onClose: () => void; initialFiles: File[] }) {
  const [kind, setKind] = useState<Kind>('line');
  /* 兩種各記各的明暗：線稿 0.80、陰影 0.65（陰影要亮一點才看得出層次） */
  const [raw, setRaw] = useState<Record<Kind, DotArtSettings>>({
    line: { ...DOT_ART_DEFAULTS },
    shade: { ...DOT_ART_DEFAULTS, threshold: DOT_ART_SHADE_THRESHOLD },
  });
  const [brush, setBrush] = useState(2);
  const [tool, setTool] = useState<ToolId>('width');
  const [frame, setFrame] = useState<DotArtFrame | null>(null);
  const text = frame?.text ?? null;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelReady, setModelReady] = useState(false);
  const [photo, setPhoto] = useState<string>('');
  const [inverted, setInverted] = useState(true);   // 預設反轉：照片亮的地方是白點，黑底上看起來就是原本的照片
  const [copied, setCopied] = useState(false);
  const session = useRef<DotArtSession | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /* ── 手畫的點：跟著「這一組設定」存（換回同一組設定，畫過的點還在） ── */
  const edits = useRef(new Map<string, Edit>());
  const undoStack = useRef<{ key: string; before: Edit | undefined }[]>([]);
  const redoStack = useRef<{ key: string; before: Edit | undefined }[]>([]);
  const [histTick, setHistTick] = useState(0);

  const busy = useRef(false), shown = useRef('');
  const open = useCallback(async (file: File) => {
    setStatus('loading'); setFrame(null); setModelReady(false);
    edits.current.clear(); undoStack.current = []; redoStack.current = []; setHistTick(t => t + 1);
    try {
      const c = await prepareDotArtImage(file);
      setPhoto(c.toDataURL('image/jpeg', 0.8));
      const s = new DotArtSession(c);
      session.current = s; shown.current = '';
      setStatus('ready');   // 先出「不疊線」的版本，線稿模型在背景跑
      s.prepare().then(() => { if (session.current === s) { shown.current = ''; setModelReady(true); } })
        .catch(e => { console.error('dot art model', e); });
    } catch (e) { console.error('dot art', e); setStatus('error'); }
  }, []);
  useEffect(() => { warmLineArtModel(); if (initialFiles[0]) open(initialFiles[0]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* 即時重算：同一時間只算一張，拖動中來的新值等這張算完直接算最新的（中間的跳過） */
  const settings: DotArtSettings = {
    width: snap('width', raw[kind].width), threshold: snap('threshold', raw[kind].threshold),
    lines: snap('lines', raw[kind].lines), thicken: snap('thicken', raw[kind].thicken),
  };
  const want = `${kind}|${settings.width}|${settings.threshold}|${settings.lines}|${settings.thicken}|${modelReady}`;
  const wantRef = useRef({ key: want, kind, settings }); wantRef.current = { key: want, kind, settings };
  const [textKey, setTextKey] = useState('');
  const pump = useCallback(async () => {
    const s = session.current;
    if (!s || busy.current) return;
    busy.current = true;
    try {
      while (shown.current !== wantRef.current.key) {
        const job = wantRef.current;
        const t = await s.render(job.kind, job.settings);
        if (session.current !== s) return;
        shown.current = job.key;
        setFrame(t); setTextKey(job.key);
        await new Promise(r => requestAnimationFrame(() => r(null)));
      }
    } finally { busy.current = false; }
  }, []);
  useEffect(() => { if (status === 'ready') pump(); }, [want, status, pump]);

  const base = text && inverted ? invertDotArt(text) : text;
  const finalText = base ? applyEdit(base, edits.current.get(textKey)) : base;
  void histTick;

  /* 成品直接畫點（不靠字型）：每格 2×4 個點，點距相同、圓點，任何裝置看起來都一樣 */
  const box = useRef<HTMLDivElement>(null), cvs = useRef<HTMLCanvasElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const b = box.current; if (!b) return;
    const upd = () => setBoxSize({ w: b.clientWidth, h: b.clientHeight });
    upd(); const ro = new ResizeObserver(upd); ro.observe(b); return () => ro.disconnect();
  }, []);
  /* 框固定是「整張照片的點陣」那麼大（收掉的空白邊也算進去），成品畫在它該在的位置：
     拖明暗、線條時四周空白多一格少一格，畫面也不會跳、不會變比例 */
  const geom = useRef({ pitch: 1, cols: 0, rows: 0, ox: 0, oy: 0 });
  const paint = useCallback((t: string | null, f: DotArtFrame | null) => {
    const c = cvs.current; if (!c) return;
    const lines = t ? t.split('\n') : [];
    const cols = Math.max(0, ...lines.map(l => l.length)), rows = lines.length;
    if (!f || !cols || !rows || !boxSize.w || !boxSize.h) { c.width = c.height = 0; return; }
    const pitch = Math.min((boxSize.w - 32) / (f.cols * 2), (boxSize.h - 32) / (f.rows * 4));
    geom.current = { pitch, cols, rows, ox: f.left * 2 * pitch, oy: f.top * 4 * pitch };
    const dpr = Math.min(3, window.devicePixelRatio || 1), W = f.cols * 2 * pitch, H = f.rows * 4 * pitch;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff';
    const r = Math.max(0.35, pitch * 0.36), x0 = f.left * 2, y0 = f.top * 4;
    g.beginPath();
    for (let y = 0; y < rows; y++) {
      const l = lines[y];
      for (let x = 0; x < l.length; x++) {
        const code = l.charCodeAt(x) - 0x2800;
        if (code <= 0 || code > 0xff) continue;
        for (let k = 0; k < 8; k++) if (code & (1 << k)) {
          const cx = (x0 + x * 2 + POS[k][0] + 0.5) * pitch, cy = (y0 + y * 4 + POS[k][1] + 0.5) * pitch;
          g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
    }
    g.fill();
  }, [boxSize]);
  useLayoutEffect(() => { paint(finalText, frame); }, [finalText, frame, paint]);

  const drawing = tool === 'draw' || tool === 'erase';
  const stroke = useRef<{ last: [number, number] | null } | null>(null);
  const dab = (px: number, py: number) => {
    const { cols, rows } = geom.current;
    if (!cols) return;
    let e = edits.current.get(textKey);
    if (!e || e.cols !== cols || e.rows !== rows) { e = { cols, rows, marks: new Uint8Array(cols * 2 * rows * 4) }; edits.current.set(textKey, e); }
    const W = cols * 2, H = rows * 4, rad = Math.round(brush) - 0.5, v = tool === 'draw' ? 1 : 2;
    for (let y = Math.floor(py - rad); y <= Math.ceil(py + rad); y++) for (let x = Math.floor(px - rad); x <= Math.ceil(px + rad); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= Math.max(0.5, rad)) e.marks[y * W + x] = v;
    }
  };
  const toDot = (ev: React.PointerEvent): [number, number] => {
    const r = cvs.current!.getBoundingClientRect(), p = geom.current.pitch;
    return [(ev.clientX - r.left - geom.current.ox) / p, (ev.clientY - r.top - geom.current.oy) / p];
  };
  const onMove = (ev: React.PointerEvent) => {
    const s = stroke.current; if (!s) return;
    const [x, y] = toDot(ev);
    if (s.last) {   // 兩次事件之間補點，快速劃過也是連續的線
      const [lx, ly] = s.last, n = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / 0.5));
      for (let i = 1; i <= n; i++) dab(lx + (x - lx) * i / n, ly + (y - ly) * i / n);
    } else dab(x, y);
    s.last = [x, y];
    paint(base ? applyEdit(base, edits.current.get(textKey)) : base, frame);
  };
  const onDown = (ev: React.PointerEvent) => {
    if (!drawing || !finalText) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const prev = edits.current.get(textKey);
    undoStack.current.push({ key: textKey, before: prev && { ...prev, marks: prev.marks.slice() } });
    redoStack.current = [];
    stroke.current = { last: null };
    onMove(ev);
  };
  const onUp = () => { if (stroke.current) { stroke.current = null; setHistTick(t => t + 1); } };
  const travel = (from: typeof undoStack, to: typeof undoStack) => {
    const step = from.current.pop(); if (!step) return;
    const cur = edits.current.get(step.key);
    to.current.push({ key: step.key, before: cur && { ...cur, marks: cur.marks.slice() } });
    if (step.before) edits.current.set(step.key, step.before); else edits.current.delete(step.key);
    setHistTick(t => t + 1);
  };

  const copy = async () => {
    if (!finalText) return;
    try { await navigator.clipboard.writeText(finalText); }
    catch {
      const t = document.createElement('textarea'); t.value = finalText; t.style.position = 'fixed'; t.style.top = '0';
      document.body.appendChild(t); t.focus(); t.select(); try { document.execCommand('copy'); } catch { /* 無法複製 */ } t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const tools = TOOLS.filter(t => kind === 'line' || t.id !== 'thicken');
  const cur = tools.find(t => t.id === tool) || tools[0];
  const isBrush = cur.id === 'draw' || cur.id === 'erase';
  const value = isBrush ? brush : raw[kind][cur.id as keyof DotArtSettings];
  const setValue = (v: number) => {
    if (isBrush) setBrush(v);
    else setRaw(r => ({ ...r, [kind]: { ...r[kind], [cur.id]: v } }));
  };
  /* 底部工具列跟美顏同一款：平的圖示＋字，選中的是白色 */
  const toolBtn = (t: ToolDef) => {
    const on = cur.id === t.id;
    return (
      <button key={t.id} onClick={() => setTool(t.id)}
        className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${on ? 'text-white' : 'text-white/20'}`}>
        <span className="h-6 flex items-center justify-center">{t.glyph}</span>
        <span className="text-[9px] font-black uppercase tracking-[0.15em]">{t.label}</span>
      </button>
    );
  };

  return (
    <div data-dot-art-studio className="fixed inset-0 z-[60] bg-black text-white flex flex-col select-none" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="h-14 shrink-0 relative flex items-center justify-between px-4">
        <button aria-label="返回" onClick={onClose} className="p-2 -ml-2 text-[#aaa] active:scale-90"><ChevronLeft size={22} /></button>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4" data-hist={histTick}>
          <button aria-label="復原" onClick={() => travel(undoStack, redoStack)} disabled={!undoStack.current.length} className={`p-2 ${undoStack.current.length ? '' : 'opacity-20'}`}><Icon name="undo" className="text-xl" /></button>
          <button aria-label="重做" onClick={() => travel(redoStack, undoStack)} disabled={!redoStack.current.length} className={`p-2 ${redoStack.current.length ? '' : 'opacity-20'}`}><Icon name="redo" className="text-xl" /></button>
        </div>
        <button onClick={copy} disabled={!finalText} className="h-8 px-4 rounded-full bg-white text-black text-[11px] font-black flex items-center gap-1.5 disabled:opacity-30">
          {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2.2} />}{copied ? '已複製' : '複製'}
        </button>
      </header>
      <input ref={input} hidden type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />

      {/* 成品：黑底白點；筆刷／擦除時手指直接在上面畫 */}
      <div ref={box} className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {status === 'loading' && <div className="absolute w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />}
        {status === 'error' && <p className="absolute text-[12px] text-white/60">無法處理這張照片</p>}
        <canvas ref={cvs} data-dot-art-canvas className={status === 'ready' && finalText ? '' : 'hidden'}
          style={{ touchAction: drawing ? 'none' : 'auto' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        {finalText && <pre data-dot-art-text hidden>{finalText}</pre>}
        {status === 'ready' && text === null && <p className="absolute text-[12px] text-white/50">畫面全空白，調一下明暗</p>}
        {status === 'ready' && !modelReady && (
          <div data-dot-art-refining className="absolute top-14 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md flex items-center gap-2 text-[11px] text-white/80">
            <span className="w-3 h-3 rounded-full border-2 border-white/25 border-t-white animate-spin" />線條描繪中
          </div>
        )}
        {/* 左下：目前的照片，點一下換一張；右下：反轉 */}
        <button aria-label="換一張照片" onClick={() => input.current?.click()}
          className="absolute left-4 bottom-3 w-11 h-11 rounded-xl overflow-hidden border border-white/15 bg-white/10 active:scale-95">
          {photo && <img src={photo} alt="" className="w-full h-full object-cover" />}
          <span className="absolute right-0.5 bottom-0.5 w-4 h-4 rounded-full bg-white text-black flex items-center justify-center"><Plus size={11} strokeWidth={3} /></span>
        </button>
        {/* 反轉：跟創意拼圖的隨機圖案鍵同一款，只有圖示（影子貼著圖示，不是一團霧） */}
        <button aria-label="反轉" aria-pressed={inverted} onClick={() => setInverted(v => !v)}
          className="absolute right-2 bottom-1 p-3 bg-transparent border-0 text-white active:scale-90 transition-transform flex items-center justify-center select-none"
          style={{ filter: 'drop-shadow(0 1px 0.5px rgba(0,0,0,.5))' }}>
          <Glyph k="invert" size={24} />
        </button>
        {/* 線稿／陰影：浮在預覽上緣 */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-2">
          {(['line', 'shade'] as const).map(k => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`px-3.5 py-1 rounded-full text-[11px] shrink-0 border transition-all active:scale-95 ${kind === k ? 'bg-white text-black border-white font-bold' : 'bg-black/40 text-white/60 border-white/15 backdrop-blur-md'}`}>
              {k === 'line' ? '線稿' : '陰影'}
            </button>
          ))}
        </div>
      </div>

      {/* 滑桿：一列（名稱｜滑桿｜數值），跟美顏同一款 */}
      <div className="shrink-0 border-t border-white/10 h-[72px] flex items-center px-5">
        <div className="flex items-center gap-3 h-6 w-full">
          <span className="text-[10px] font-bold tracking-[0.15em] text-white/40 w-14 shrink-0">{isBrush ? '筆刷大小' : cur.label}</span>
          <div className="slider-wrap flex-1" style={{ height: 16 }}>
            <input type="range" aria-label={cur.label} min={cur.min} max={cur.max} step="any" value={value}
              onChange={e => setValue(Number(e.target.value))} className="premium-slider w-full" />
          </div>
          <span className="text-[11px] font-mono tabular-nums text-white/80 w-9 text-right shrink-0">{cur.decimals ? snap(cur.id, value).toFixed(2) : snap(cur.id, value)}</span>
        </div>
      </div>

      {/* 工具列：跟美顏同一個高度（64px＋底部 12px） */}
      <div className="border-t border-white/10 bg-black shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex h-16 pb-3 box-content">{tools.map(toolBtn)}</div>
      </div>
    </div>
  );
}
