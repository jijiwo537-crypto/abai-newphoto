/* 點陣文字：照片轉成可以複製貼上的點字圖案（演算法見 utils/dotArt）
   介面跟編輯器同一套：上面是成品（黑底白點、即時更新），下面一根滑桿＋一排工具。 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, Copy, Check, Sun, PenLine, Maximize2, Bold, Contrast, ImagePlus } from 'lucide-react';
import { DOT_ART_DEFAULTS, DOT_ART_SHADE_THRESHOLD, DotArtSession, invertDotArt, prepareDotArtImage, warmLineArtModel, type DotArtSettings } from '../utils/dotArt';

type Kind = 'line' | 'shade';
type ToolId = 'width' | 'threshold' | 'lines' | 'thicken';
const TOOLS: { id: ToolId; label: string; icon: React.ReactNode; min: number; max: number; decimals?: boolean }[] = [
  { id: 'width', label: '大小', icon: <Maximize2 size={18} strokeWidth={1.8} />, min: 1, max: 200 },
  { id: 'threshold', label: '明暗', icon: <Sun size={18} strokeWidth={1.8} />, min: 0.01, max: 0.99, decimals: true },
  { id: 'lines', label: '線條', icon: <PenLine size={18} strokeWidth={1.8} />, min: 0, max: 20 },
  { id: 'thicken', label: '粗細', icon: <Bold size={18} strokeWidth={1.8} />, min: 0, max: 10 },
];
/** 滑桿是連續的（拖起來不會一格一格），算圖時才取到該有的刻度 */
const snap = (id: ToolId, v: number) => (id === 'threshold' ? Math.round(v * 100) / 100 : Math.round(v));

export function DotArtStudio({ onClose, initialFiles }: { onClose: () => void; initialFiles: File[] }) {
  const [kind, setKind] = useState<Kind>('line');
  /* 兩種各記各的明暗：線稿 0.80、陰影 0.65（陰影要亮一點才看得出層次） */
  const [raw, setRaw] = useState<Record<Kind, DotArtSettings>>({
    line: { ...DOT_ART_DEFAULTS },
    shade: { ...DOT_ART_DEFAULTS, threshold: DOT_ART_SHADE_THRESHOLD },
  });
  const [tool, setTool] = useState<ToolId>('width');
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [photo, setPhoto] = useState<string>('');
  /* 預設反轉：照片亮的地方是白點，在黑底上看起來就是原本的照片 */
  const [inverted, setInverted] = useState(true);
  const [copied, setCopied] = useState(false);
  const session = useRef<DotArtSession | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const open = useCallback(async (file: File) => {
    setStatus('loading'); setText(null);
    try {
      const c = await prepareDotArtImage(file);
      setPhoto(c.toDataURL('image/jpeg', 0.8));
      const s = new DotArtSession(c);
      session.current = s;
      await s.prepare();
      if (session.current === s) setStatus('ready');
    } catch (e) { console.error('dot art', e); setStatus('error'); }
  }, []);
  useEffect(() => { warmLineArtModel(); if (initialFiles[0]) open(initialFiles[0]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* 即時重算：同一時間只算一張，拖動中來的新值等這張算完直接算最新的（中間的跳過） */
  const settings: DotArtSettings = {
    width: snap('width', raw[kind].width), threshold: snap('threshold', raw[kind].threshold),
    lines: snap('lines', raw[kind].lines), thicken: snap('thicken', raw[kind].thicken),
  };
  const want = `${kind}|${settings.width}|${settings.threshold}|${settings.lines}|${settings.thicken}`;
  const wantRef = useRef({ key: want, kind, settings }); wantRef.current = { key: want, kind, settings };
  const busy = useRef(false), shown = useRef('');
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
        setText(t);
        await new Promise(r => requestAnimationFrame(() => r(null)));
      }
    } finally { busy.current = false; }
  }, []);
  useEffect(() => { if (status === 'ready') pump(); }, [want, status, pump]);
  useEffect(() => { shown.current = ''; }, [photo]);

  /* 成品直接畫點（不靠字型）：每格 2×4 個點，點距相同、圓點，任何裝置看起來都一樣 */
  const box = useRef<HTMLDivElement>(null), cvs = useRef<HTMLCanvasElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const b = box.current; if (!b) return;
    const upd = () => setBoxSize({ w: b.clientWidth, h: b.clientHeight });
    upd(); const ro = new ResizeObserver(upd); ro.observe(b); return () => ro.disconnect();
  }, []);
  const shownText = text && inverted ? invertDotArt(text) : text;
  useLayoutEffect(() => {
    const c = cvs.current; if (!c) return;
    const lines = shownText ? shownText.split('\n') : [];
    const cols = Math.max(0, ...lines.map(l => l.length)), rows = lines.length;
    if (!cols || !rows || !boxSize.w || !boxSize.h) { c.width = c.height = 0; return; }
    const dotsW = cols * 2, dotsH = rows * 4;
    const pitch = Math.min((boxSize.w - 32) / dotsW, (boxSize.h - 32) / dotsH);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = dotsW * pitch, H = dotsH * pitch;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff';
    const r = Math.max(0.35, pitch * 0.36);
    // 點字的 8 個位元對應的位置：[欄, 列]
    const POS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];
    g.beginPath();
    for (let y = 0; y < rows; y++) {
      const l = lines[y];
      for (let x = 0; x < l.length; x++) {
        const code = l.charCodeAt(x) - 0x2800;
        if (code <= 0 || code > 0xff) continue;
        for (let k = 0; k < 8; k++) if (code & (1 << k)) {
          const cx = (x * 2 + POS[k][0] + 0.5) * pitch, cy = (y * 4 + POS[k][1] + 0.5) * pitch;
          g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
    }
    g.fill();
  }, [shownText, boxSize]);
  const copy = async () => {
    if (!shownText) return;
    try { await navigator.clipboard.writeText(shownText); }
    catch {
      const t = document.createElement('textarea'); t.value = shownText; t.style.position = 'fixed'; t.style.top = '0';
      document.body.appendChild(t); t.focus(); t.select(); try { document.execCommand('copy'); } catch { /* 無法複製 */ } t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const tools = TOOLS.filter(t => kind === 'line' || t.id !== 'thicken');
  const cur = tools.find(t => t.id === tool) || tools[0];
  const value = raw[kind][cur.id];
  const setValue = (v: number) => setRaw(r => ({ ...r, [kind]: { ...r[kind], [cur.id]: v } }));
  const pct = ((value - cur.min) / (cur.max - cur.min)) * 100;

  return (
    <div data-dot-art-studio className="fixed inset-0 z-[60] bg-black text-white flex flex-col select-none" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="h-14 shrink-0 flex items-center justify-between px-4">
        <button aria-label="返回" onClick={onClose} className="p-2 -ml-2 text-[#aaa] active:scale-90"><ChevronLeft size={22} /></button>
        <button aria-label="換一張照片" onClick={() => input.current?.click()} className="p-2 text-white/70 active:scale-90"><ImagePlus size={20} strokeWidth={1.8} /></button>
        <button onClick={copy} disabled={!shownText} className="h-8 px-4 rounded-full bg-white text-black text-[11px] font-black flex items-center gap-1.5 disabled:opacity-30">
          {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2.2} />}{copied ? '已複製' : '複製'}
        </button>
      </header>
      <input ref={input} hidden type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />

      {/* 成品：黑底白點 */}
      <div ref={box} className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {status !== 'ready' && photo && <img src={photo} alt="" className="absolute max-w-[calc(100%-32px)] max-h-[calc(100%-32px)] object-contain opacity-30" />}
        {status === 'loading' && <div className="absolute w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />}
        {status === 'error' && <p className="absolute text-[12px] text-white/60">無法處理這張照片</p>}
        {/* 看到的就是複製出去的樣子（深色模式下貼上就是白點、黑底） */}
        <canvas ref={cvs} data-dot-art-canvas className={status === 'ready' && shownText ? '' : 'hidden'} />
        {shownText && <pre data-dot-art-text hidden>{shownText}</pre>}
        {status === 'ready' && text === null && <p className="absolute text-[12px] text-white/50">畫面全空白，調一下明暗</p>}
        <button aria-label="反轉" aria-pressed={inverted} onClick={() => setInverted(v => !v)}
          className={`absolute right-4 bottom-3 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-md ${inverted ? 'bg-white text-black' : 'bg-white/10 text-white/80'}`}>
          <Contrast size={17} strokeWidth={1.9} />
        </button>
      </div>

      {/* 線稿／陰影 */}
      <div className="shrink-0 flex justify-center gap-2 pt-3">
        {(['line', 'shade'] as const).map(k => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`h-8 px-5 rounded-full text-[11px] font-black tracking-[0.08em] transition-colors ${kind === k ? 'bg-white text-black' : 'bg-white/[0.06] text-white/60'}`}>
            {k === 'line' ? '線稿' : '陰影'}
          </button>
        ))}
      </div>

      {/* 滑桿（連續、跟手） */}
      <div className="shrink-0 px-6 pt-4 pb-2">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[11px] font-bold text-white/60">{cur.label}</span>
          <span className="text-[10px] leading-none tabular-nums font-bold bg-white/10 px-1.5 py-[4px] rounded">{cur.decimals ? snap(cur.id, value).toFixed(2) : snap(cur.id, value)}</span>
        </div>
        <div className="slider-wrap w-full" style={{ height: 16 }}>
          <input type="range" aria-label={cur.label} min={cur.min} max={cur.max} step="any" value={value}
            onChange={e => setValue(Number(e.target.value))} className="premium-slider w-full"
            style={{ ['--fill' as any]: `${pct}%` }} />
        </div>
      </div>

      {/* 工具 */}
      <div className="shrink-0 flex justify-center gap-7 pt-2" style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}>
        {tools.map(t => (
          <button key={t.id} onClick={() => setTool(t.id)} className="flex flex-col items-center gap-1.5">
            <span className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${cur.id === t.id ? 'bg-white text-black' : 'bg-white/[0.06] text-white/60'}`}>{t.icon}</span>
            <span className={`text-[10px] font-bold ${cur.id === t.id ? 'text-white' : 'text-white/40'}`}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
