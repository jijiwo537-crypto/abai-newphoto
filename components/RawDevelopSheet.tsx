import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LiveRange } from './LiveRange';
import { haptic } from '../utils/haptics';
import { punchThrough } from '../utils/nativePreview';
import { developRaw, rawEditor, rawEditorExport, rawEditorSnapshot, type RawEditParams, type RawLook } from '../utils/nativeCamera';

/* ── RAW 沖洗（底片模式拍的 RAW）────────────────────────────────────────
 * 版面照專業沖洗 App：上面大圖；一排工具圖示（光線、色彩、曲線、HSL）；兩欄粗滑桿；最下面 ✕、復原、名稱、⋯、✓。
 * 沖洗本身在原生端（ios/App/App/ABAIRawDevelop.swift）：整條都在場景線性、16 位元浮點上做，
 * 曝光是在 RAW 的線性資料上重新曝光、白平衡在相機原生色彩空間裡做 —— 寬容度、色彩都保得住。
 * 原生預覽疊在網頁中間那塊透明的位置底下，拖滑桿每一格都即時重畫。
 * 網頁版（沒有原生沖洗）：只有曝光、色溫，放手才沖。 */

export interface RawDevelopSheetProps {
  rawPath: string;
  previewSrc?: string;
  leaving?: boolean;
  /** 拍的時候少曝光了幾格（曝光的預設值就是把它沖回來） */
  protectEV: number;
  /** 拍照當下的樣子（濾鏡、特效、裁切、日期） */
  look: RawLook | null;
  onCancel: () => void;
  /** 沖好了：原尺寸的成品 */
  onDone: (url: string) => void;
  /** 測試頁用：換掉網頁版的解碼 */
  developer?: typeof developRaw;
}

type Tool = 'light' | 'color' | 'curve' | 'hsl';
type Channel = 'rgb' | 'r' | 'g' | 'b';
type Pt = [number, number];
interface State {
  exposure: number;
  /** 滑桿值 -100～100（色溫在 mired 上對稱：往冷、往暖一樣多） */
  temp: number; tint: number;
  contrast: number; highlights: number; shadows: number; whites: number; blacks: number;
  vibrance: number; saturation: number;
  hsl: number[];   // 8 × [h, s, l]，-100～100
  curves: Record<Channel, Pt[]>;
}
const LINE: Pt[] = [[0, 0], [1, 1]];
const fresh = (ev: number): State => ({
  exposure: ev, temp: 0, tint: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0,
  hsl: Array(24).fill(0), curves: { rgb: LINE, r: LINE, g: LINE, b: LINE },
});

const BANDS = [
  ['紅', '#ff3b30'], ['橙', '#ff9500'], ['黃', '#ffd60a'], ['綠', '#34c759'],
  ['青', '#5ac8fa'], ['藍', '#0a5cff'], ['紫', '#af52de'], ['洋紅', '#ff2d92'],
] as const;

/* 單調三次插值（Fritsch–Carlson）：曲線不會過衝、不會有奇怪的波浪 */
function curveTable(pts: Pt[]): Float32Array {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const n = p.length, out = new Float32Array(256);
  const dx = p.slice(1).map((q, i) => q[0] - p[i][0]), dy = p.slice(1).map((q, i) => q[1] - p[i][1]);
  const m = dx.map((d, i) => dy[i] / Math.max(1e-6, d));
  const t = p.map((_, i) => i === 0 ? m[0] : i === n - 1 ? m[n - 2] : (m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  for (let j = 0; j < 256; j++) {
    const x = j / 255;
    let i = 0; while (i < n - 2 && x > p[i + 1][0]) i++;
    if (x <= p[0][0]) { out[j] = p[0][1]; continue; }
    if (x >= p[n - 1][0]) { out[j] = p[n - 1][1]; continue; }
    const h = dx[i], s = (x - p[i][0]) / h, s2 = s * s, s3 = s2 * s;
    out[j] = Math.min(1, Math.max(0, (2 * s3 - 3 * s2 + 1) * p[i][1] + (s3 - 2 * s2 + s) * h * t[i] + (-2 * s3 + 3 * s2) * p[i + 1][1] + (s3 - s2) * h * t[i + 1]));
  }
  return out;
}
const isLine = (pts: Pt[]) => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;

export const RawDevelopSheet: React.FC<RawDevelopSheetProps> = ({ rawPath, previewSrc, leaving = false, protectEV, look, onCancel, onDone, developer = developRaw }) => {
  const [tool, setTool] = useState<Tool>('light');
  const [band, setBand] = useState(0);
  const [channel, setChannel] = useState<Channel>('rgb');
  const [st, setSt] = useState<State>(() => fresh(protectEV));
  const stRef = useRef(st); stRef.current = st;
  const history = useRef<State[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  /** closed：原生預覽已經換成定格圖、關掉了（退場中） */
  const [mode, setMode] = useState<'native' | 'web' | 'pending' | 'closed'>('pending');
  const asShot = useRef({ temp: 5500, tint: 0 });
  const [busy, setBusy] = useState(false);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const comparing = useRef(false);
  const leavingRef = useRef(leaving); leavingRef.current = leaving;
  const exitingRef = useRef(false);
  const restoreRef = useRef<(() => void) | null>(null);
  /** 退場時蓋在大圖位置的定格圖（原生預覽最後一格） */
  const [still, setStill] = useState<string | null>(null);
  useEffect(() => () => { if (still) URL.revokeObjectURL(still); }, [still]);

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setEntered(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, []);
  /* 退場：原生預覽先換成網頁上的定格圖、把後面的相簿放回來，再整頁往下滑走。
     不這樣做的話，滑走時後面露出的是還開著的相機畫面，原生預覽也不會跟著網頁一起動。 */
  const exit = async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    haptic('tick');
    if (mode === 'native') {
      const url = await rawEditorSnapshot();
      if (url) { const im = new Image(); im.src = url; await im.decode().catch(() => {}); setStill(url); }
      setMode('closed');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      restoreRef.current?.(); restoreRef.current = null;
      void rawEditor().then(p => p?.closeEditor()).catch(() => {});
    }
    onCancel();
  };

  /* ── 參數 → 原生 ── */
  const toParams = (s: State): RawEditParams => {
    /* 色溫：在 mired（1,000,000 ÷ K）上對稱，±100 ＝ ±150 mired —— 往冷、往暖一樣多，跟專業沖洗軟體一樣 */
    const m0 = 1e6 / Math.max(1500, asShot.current.temp);
    const k = 1e6 / Math.max(20, m0 - s.temp * 1.5);
    const tables = (['r', 'g', 'b'] as const).map(c => curveTable(s.curves[c]));
    const master = curveTable(s.curves.rgb);
    const flat = (['rgb', 'r', 'g', 'b'] as const).every(c => isLine(s.curves[c]));
    let curve: number[] | null = null;
    if (!flat) {
      curve = new Array(768);
      for (let i = 0; i < 256; i++) {
        const v = master[i];
        for (let c = 0; c < 3; c++) {
          const x = v * 255, i0 = Math.floor(x), i1 = Math.min(255, i0 + 1), f = x - i0;
          curve[i * 3 + c] = tables[c][i0] * (1 - f) + tables[c][i1] * f;
        }
      }
    }
    return {
      exposure: s.exposure, temperature: k, tint: asShot.current.tint + s.tint,
      contrast: s.contrast / 100, highlights: s.highlights / 100, shadows: s.shadows / 100, whites: s.whites / 100, blacks: s.blacks / 100,
      vibrance: s.vibrance / 100, saturation: s.saturation / 100,
      hsl: s.hsl.map(v => v / 100), curve,
    };
  };
  const sendRaf = useRef(0);
  const push = (final: boolean) => {
    if (mode !== 'native') return;
    const go = () => { sendRaf.current = 0; void rawEditor().then(p => p?.updateEditor({ params: toParams(comparing.current ? fresh(protectEV) : stRef.current), final })); };
    if (final) { if (sendRaf.current) cancelAnimationFrame(sendRaf.current); go(); }
    else if (!sendRaf.current) sendRaf.current = requestAnimationFrame(go);
  };

  /* ── 開原生沖洗：預覽疊在中間那塊（網頁那塊挖成透明） ── */
  useLayoutEffect(() => {
    let alive = true, restore: (() => void) | null = null, ro: ResizeObserver | null = null;
    const el = stage.current;
    void (async () => {
      /* 先讓整頁完成入場；原生 Metal 預覽依最後位置建立，入場時以原照片銜接。 */
      await new Promise(resolve => window.setTimeout(resolve, 375));
      if (!alive || leavingRef.current) return;
      const p = await rawEditor();
      if (!alive || !el) return;
      if (!p) { setMode('web'); return; }
      const r = el.getBoundingClientRect();
      try {
        /* 第一格的參數：色溫、色調不給＝照拍攝當下。原生畫好第一格才回來 */
        const first = { ...toParams(stRef.current) } as Partial<RawEditParams>;
        delete first.temperature; delete first.tint;
        const info = await p.openEditor({ path: rawPath, x: r.left, y: r.top, w: r.width, h: r.height, look, params: first });
        if (!alive || leavingRef.current || exitingRef.current) { void p.closeEditor(); return; }
        asShot.current = { temp: info.asShotTemperature || 5500, tint: info.asShotTint || 0 };
        /* 等第一格真的上到螢幕再挖空，切換那一下不會閃 */
        await new Promise(res => window.setTimeout(res, 34));
        if (!alive || leavingRef.current || exitingRef.current) { void p.closeEditor(); return; }
        /* 底下整個 App（相機、相簿、掛在 body 上的大圖）先藏起來：不然它們的黑底會蓋住原生的預覽 */
        const under = Array.from(document.body.children).filter((n): n is HTMLElement =>
          n instanceof HTMLElement && !n.contains(el) && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE');
        restore = punchThrough(el, under);
        restoreRef.current = restore;
        ro = new ResizeObserver(() => { const b = el.getBoundingClientRect(); void p.setEditorRect({ x: b.left, y: b.top, w: b.width, h: b.height }); });
        ro.observe(el);
        setMode('native');
      } catch { if (alive) setMode('web'); }
    })();
    return () => { alive = false; ro?.disconnect(); restore?.(); void rawEditor().then(p => p?.closeEditor()).catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (mode === 'native') push(true); /* 第一張 */ }, [mode]);

  /* ── 網頁版：只有曝光、色溫，放手才沖 ── */
  const webRun = useRef(0);
  const webDevelop = async (s: State) => {
    const id = ++webRun.current;
    const m0 = 1e6 / Math.max(1500, asShot.current.temp);
    const r = await developer(rawPath, { exposure: s.exposure, temperature: 1e6 / Math.max(20, m0 - s.temp * 1.5), tint: asShot.current.tint + s.tint }, look, true);
    if (id !== webRun.current || !r) return;
    if (r.asShotTemperature && asShot.current.temp === 5500) asShot.current = { temp: r.asShotTemperature, tint: r.asShotTint ?? 0 };
    setWebUrl(old => { if (old) URL.revokeObjectURL(old); return r.url; });
  };
  useEffect(() => { if (mode === 'web') void webDevelop(st); /* 第一張 */ }, [mode]);

  /* ── 改值 ── */
  const set = (patch: Partial<State>) => { setSt(s => { const n = { ...s, ...patch }; stRef.current = n; return n; }); push(false); };
  const begin = useRef<State | null>(null);
  const commit = () => {
    if (begin.current) { history.current.push(begin.current); begin.current = null; setCanUndo(true); }
    push(true);
    if (mode === 'web') void webDevelop(stRef.current);
  };
  const touch = () => { if (!begin.current) begin.current = stRef.current; };
  const undo = () => {
    const prev = history.current.pop(); if (!prev) return;
    haptic('tick'); stRef.current = prev; setSt(prev); setCanUndo(history.current.length > 0);
    requestAnimationFrame(() => { push(true); if (mode === 'web') void webDevelop(prev); });
  };
  const resetAll = () => {
    if (!window.confirm('把所有調整回到預設？')) return;
    history.current.push(stRef.current); setCanUndo(true);
    const f = fresh(protectEV); stRef.current = f; setSt(f);
    requestAnimationFrame(() => { push(true); if (mode === 'web') void webDevelop(f); });
  };
  const finish = async () => {
    if (busy) return;
    setBusy(true); haptic('press');
    const url = mode === 'native'
      ? await rawEditorExport(toParams(stRef.current))
      : (await developer(rawPath, { exposure: stRef.current.exposure, temperature: 1e6 / Math.max(20, 1e6 / Math.max(1500, asShot.current.temp) - stRef.current.temp * 1.5), tint: asShot.current.tint + stRef.current.tint }, look, false))?.url ?? null;
    if (url) { exitingRef.current = true; onDone(url); } else setBusy(false);
  };

  /* ── 滑桿（兩欄、粗的）── */
  /* ── 一列滑桿：名稱｜細軌道（從預設值往兩邊填色）｜數值。雙擊名稱回預設 ── */
  const row = (key: string, label: string, v: number, min: number, max: number, fmt: (v: number) => string, dflt: number, step: number,
    onValue: (x: number) => void) => {
    const z = (dflt - min) / (max - min), p = (v - min) / (max - min);
    const on = Math.abs(v - dflt) > step / 2;
    return (
      <div key={key} className="flex items-center gap-3 h-[40px]">
        <button type="button" className={`w-[74px] shrink-0 text-left text-[14px] transition-colors ${on ? 'text-white' : 'text-white/60'}`}
          onDoubleClick={() => { touch(); onValue(dflt); commit(); }}>{label}</button>
        <div className="relative flex-1 h-[30px]">
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/[0.14] pointer-events-none" />
          <div className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white pointer-events-none"
            style={{ left: `${Math.min(z, p) * 100}%`, width: `${Math.abs(p - z) * 100}%` }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-[2px] h-[9px] -ml-px rounded-full bg-white/35 pointer-events-none" style={{ left: `${z * 100}%` }} />
          <LiveRange ariaLabel={label} min={min} max={max} step={step} value={v} height={30} wrapClassName="!absolute inset-0 !overflow-visible"
            className="raw2-slider w-full" onPointerDown={touch} onValue={x => { touch(); onValue(x); }} onCommit={commit} />
        </div>
        <span className={`w-[42px] shrink-0 text-right text-[13px] tabular-nums transition-colors ${on ? 'text-white' : 'text-white/40'}`}>{fmt(v)}</span>
      </div>
    );
  };
  const slider = (label: string, key: keyof State, min: number, max: number, fmt: (v: number) => string, dflt: number, step = 1) =>
    row(String(key), label, st[key] as number, min, max, fmt, dflt, step, x => set({ [key]: x } as Partial<State>));
  const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`;
  const ev = (v: number) => `${v > 0.049 ? '+' : v < -0.049 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
  const hslSlider = (label: string, i: number) => {
    const idx = band * 3 + i;
    return row(`hsl${i}`, label, st.hsl[idx], -100, 100, signed, 0, 1, x => { const hsl = [...stRef.current.hsl]; hsl[idx] = x; set({ hsl }); });
  };

  const changed = useMemo(() => ({
    light: st.exposure !== protectEV || !!(st.contrast || st.highlights || st.shadows || st.whites || st.blacks),
    color: !!(st.temp || st.tint || st.vibrance || st.saturation),
    curve: !(['rgb', 'r', 'g', 'b'] as const).every(c => isLine(st.curves[c])),
    hsl: st.hsl.some(Boolean),
  }), [st, protectEV]);
  const TITLES: Record<Tool, string> = { light: '光線', color: '色彩', curve: '曲線', hsl: 'HSL' };

  /* 按住大圖：看原本的樣子（放開回來） */
  const compare = (on: boolean) => { comparing.current = on; push(true); };

  const iconBtn = 'w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30';
  return (
    <div data-raw-develop
      className={`fixed inset-0 z-[300] flex flex-col text-white select-none transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${mode === 'native' ? '' : 'bg-black'} ${leaving || !entered ? 'translate-y-full' : 'translate-y-0'}`}
      style={{ willChange: 'transform' }}>
      {/* 上方：✕｜復原、全部重設｜✓ */}
      <div className="shrink-0 bg-black" style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
        <div className="h-[52px] px-4 flex items-center justify-between">
          <button aria-label="取消" onClick={() => void exit()} className={`${iconBtn} bg-white/[0.12]`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <div className="flex items-center gap-1">
            <button aria-label="復原" onClick={undo} disabled={!canUndo} className={iconBtn}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4.5 9.5 9 5" /><path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11" /></svg>
            </button>
            <span className="px-2 text-[12px] font-bold tracking-[0.18em] text-white/55">RAW</span>
            <button aria-label="全部重設" onClick={resetAll} disabled={!history.current.length && !Object.values(changed).some(Boolean)} className={iconBtn}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v3.7h3.7" /></svg>
            </button>
          </div>
          <button aria-label="完成" onClick={() => void finish()} disabled={mode === 'pending' || busy} className={`${iconBtn} bg-white`}>
            {busy
              ? <span className="w-4 h-4 rounded-full border-2 border-black/25 border-t-black animate-spin" />
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
          </button>
        </div>
      </div>

      {/* 大圖（App 裡這一塊是透明的，底下是原生即時預覽）。按住看原本的樣子 */}
      <div ref={stage} className="flex-1 min-h-0 relative bg-black"
        onPointerDown={() => compare(true)} onPointerUp={() => compare(false)} onPointerCancel={() => compare(false)} onPointerLeave={() => comparing.current && compare(false)}>
        {mode !== 'native' && (still || webUrl || previewSrc) && <img src={still || webUrl || previewSrc} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain" />}
      </div>

      <div className={`shrink-0 bg-black transition-opacity ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* 分頁：圖示＋字，選中的是白色 */}
        <div className="flex items-stretch justify-around px-4 pt-3 pb-1">
          {(['light', 'color', 'curve', 'hsl'] as const).map(t => (
            <button key={t} aria-label={TITLES[t]} onClick={() => { if (tool !== t) { haptic('tick'); setTool(t); } }}
              className={`relative flex flex-col items-center gap-1 w-16 py-1 transition-opacity duration-200 ${tool === t ? 'opacity-100' : 'opacity-40'}`}>
              <ToolIcon tool={t} />
              <span className="text-[11px] font-medium tracking-[0.06em]">{TITLES[t]}</span>
              <span aria-hidden className={`absolute top-0 right-3 w-[5px] h-[5px] rounded-full bg-[#ffb340] transition-opacity ${changed[t] ? 'opacity-100' : 'opacity-0'}`} />
            </button>
          ))}
        </div>
        <div className="mx-5 h-px bg-white/[0.08]" />

        <div className="px-5 pt-2 h-[262px] overflow-y-auto no-scrollbar">
          {tool === 'light' && (
            <>
              {slider('曝光', 'exposure', -5, 5, ev, protectEV, 0.05)}
              {slider('對比', 'contrast', -100, 100, signed, 0)}
              {slider('高光', 'highlights', -100, 100, signed, 0)}
              {slider('陰影', 'shadows', -100, 100, signed, 0)}
              {slider('白色', 'whites', -100, 100, signed, 0)}
              {slider('黑色', 'blacks', -100, 100, signed, 0)}
            </>
          )}
          {tool === 'color' && (
            <>
              {slider('色溫', 'temp', -100, 100, signed, 0)}
              {slider('色調', 'tint', -100, 100, signed, 0)}
              {slider('自然飽和', 'vibrance', -100, 100, signed, 0)}
              {slider('飽和度', 'saturation', -100, 100, signed, 0)}
            </>
          )}
          {tool === 'hsl' && (
            <>
              <div className="flex items-center justify-between py-3">
                {BANDS.map(([name, color], i) => (
                  <button key={name} aria-label={name} onClick={() => { haptic('tick'); setBand(i); }}
                    className="w-[30px] h-[30px] rounded-full flex items-center justify-center transition-transform duration-200 active:scale-90"
                    style={{ background: color, transform: band === i ? 'scale(1)' : 'scale(.72)', boxShadow: band === i ? '0 0 0 2px #000, 0 0 0 3.5px #fff' : 'none' }}>
                    {st.hsl.slice(i * 3, i * 3 + 3).some(Boolean) && band !== i && <span className="w-1.5 h-1.5 rounded-full bg-black/60" />}
                  </button>
                ))}
              </div>
              {hslSlider('色相', 0)}
              {hslSlider('飽和度', 1)}
              {hslSlider('明度', 2)}
            </>
          )}
          {tool === 'curve' && (
            <div className="pt-2">
              <CurveEditor channel={channel} onChannel={setChannel} pts={st.curves[channel]}
                onBegin={touch}
                onChange={pts => set({ curves: { ...stRef.current.curves, [channel]: pts } })}
                onCommit={commit} />
            </div>
          )}
        </div>
        <div style={{ height: 'max(env(safe-area-inset-bottom), 12px)' }} />
      </div>
    </div>
  );
};

const ToolIcon: React.FC<{ tool: Tool }> = ({ tool }) => {
  const c = { fill: 'none', stroke: '#fff', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (tool === 'light') return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...c}><circle cx="12" cy="12" r="3.6" fill="#fff" stroke="none" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></svg>);
  if (tool === 'color') return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...c}><path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" /><circle cx="12" cy="17.5" r="1.6" fill="#fff" stroke="none" /><path d="M12 9v7" /></svg>);
  if (tool === 'curve') return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...c}><path d="M4 4v16h16" /><path d="M6.5 18c3-0.5 4.5-3 6-6.5S16 6 19.5 5.5" /></svg>);
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...c}><path d="M4 7h16M7 12h10M10 17h4" /></svg>);
};

/* ── 曲線 ──────────────────────────────────────────────────────────────
 * 點一下空白處加一個點、拖點改形狀、雙擊點刪掉（兩端的點只能上下動）。RGB＝總曲線，紅綠藍各自一條 */
const CurveEditor: React.FC<{
  channel: Channel; onChannel: (c: Channel) => void; pts: Pt[];
  onBegin: () => void; onChange: (pts: Pt[]) => void; onCommit: () => void;
}> = ({ channel, onChannel, pts, onBegin, onChange, onCommit }) => {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; id: number } | null>(null);
  const lastTap = useRef<{ i: number; t: number } | null>(null);
  const color = channel === 'r' ? '#ff453a' : channel === 'g' ? '#32d74b' : channel === 'b' ? '#0a84ff' : '#ffffff';
  const table = useMemo(() => curveTable(pts), [pts]);
  const W = 100, path = Array.from({ length: 65 }, (_, j) => { const x = j / 64; return `${j ? 'L' : 'M'}${x * W},${(1 - table[Math.round(x * 255)]) * W}`; }).join('');
  const at = (e: React.PointerEvent): Pt => {
    const r = box.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const down = (e: React.PointerEvent) => {
    e.stopPropagation();
    const [x, y] = at(e);
    const r = box.current!.getBoundingClientRect();
    let hit = pts.findIndex(p => Math.hypot((p[0] - x) * r.width, (p[1] - y) * r.height) < 22);
    onBegin();
    if (hit >= 0) {
      const now = performance.now();
      if (lastTap.current && lastTap.current.i === hit && now - lastTap.current.t < 320 && hit > 0 && hit < pts.length - 1) {
        lastTap.current = null; haptic('detentMajor');
        onChange(pts.filter((_, i) => i !== hit)); onCommit(); return;
      }
      lastTap.current = { i: hit, t: now };
    } else {
      const sorted = [...pts, [x, y] as Pt].sort((a, b) => a[0] - b[0]);
      hit = sorted.findIndex(p => p[0] === x && p[1] === y);
      haptic('tick');
      onChange(sorted);
    }
    drag.current = { i: hit, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    let [x, y] = at(e);
    const n = [...pts];
    if (d.i === 0) x = 0; else if (d.i === n.length - 1) x = 1;
    else x = Math.min(n[d.i + 1][0] - 0.02, Math.max(n[d.i - 1][0] + 0.02, x));
    n[d.i] = [x, y];
    onChange(n);
  };
  const up = (e: React.PointerEvent) => { if (drag.current?.id === e.pointerId) { drag.current = null; onCommit(); } };
  return (
    <div className="flex gap-4 items-start">
      <div ref={box} className="relative flex-1 aspect-[1.6] max-h-[188px] rounded-[14px] bg-white/[0.06] touch-none"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <svg viewBox={`0 0 ${W} ${W}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
          {[25, 50, 75].map(g => <g key={g}><line x1={g} y1="0" x2={g} y2={W} stroke="rgba(255,255,255,0.08)" vectorEffect="non-scaling-stroke" /><line x1="0" y1={g} x2={W} y2={g} stroke="rgba(255,255,255,0.08)" vectorEffect="non-scaling-stroke" /></g>)}
          <line x1="0" y1={W} x2={W} y2="0" stroke="rgba(255,255,255,0.12)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {pts.map((p, i) => (
          <span key={i} className="absolute w-[14px] h-[14px] -ml-[7px] -mt-[7px] rounded-full border-2 pointer-events-none"
            style={{ left: `${p[0] * 100}%`, top: `${(1 - p[1]) * 100}%`, borderColor: color, background: '#000' }} />
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {(['rgb', 'r', 'g', 'b'] as const).map(c => {
          const col = c === 'r' ? '#ff453a' : c === 'g' ? '#32d74b' : c === 'b' ? '#0a84ff' : '#fff';
          return (
            <button key={c} aria-label={c.toUpperCase()} onClick={() => { haptic('tick'); onChannel(c); }}
              className="w-[38px] h-[38px] rounded-full flex items-center justify-center text-[11px] font-bold transition-transform active:scale-90"
              style={channel === c ? { background: col, color: c === 'rgb' ? '#000' : '#fff' } : { boxShadow: `inset 0 0 0 2.5px ${col}`, color: col }}>
              {c === 'rgb' ? 'RGB' : c.toUpperCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
};
