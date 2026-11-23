import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { LiveRange } from './LiveRange';
import { Icon } from './Icon';
import { CurvesPad, HslPanel, HSL_PANEL_H, LINEAR_CURVES, curveLut, isLinearCurve, type CurveSet, type HslBand } from './EditorCurvesHsl';
import { haptic } from '../utils/haptics';
import { SLIDER_DOUBLE_TAP_EVENT } from '../utils/sliderTouch';
import { punchThrough } from '../utils/nativePreview';
import { developRaw, rawEditor, rawEditorExport, rawEditorSnapshot, type RawEditParams, type RawLook } from '../utils/nativeCamera';

/* ── RAW 沖洗（底片模式拍的 RAW）────────────────────────────────────────
 * 只做 RAW 才做得好的那幾項：曝光、白平衡（色溫 K、色調）、高光、陰影，加上曲線、HSL。
 * 版面跟編輯頁一樣：上面 ‹｜復原、重做｜「完成 ⋯」；大圖；一條滑桿（名稱、數值）；一排圓形工具；最下面分頁。
 * 曲線、HSL 直接用編輯頁同名工具的介面（components/EditorCurvesHsl）。
 * 滑桿：雙擊名稱、雙擊白點都回到預設值。
 * 沖洗本身在原生端（ios/App/App/ABAIRawDevelop.swift），原生預覽疊在網頁中間那塊透明的位置底下，拖滑桿每一格都即時重畫。
 * 網頁版（沒有原生沖洗）：只有曝光、白平衡，放手才沖。 */

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

type Tab = 'light' | 'wb' | 'curve' | 'hsl';
interface State {
  exposure: number;
  /** 白平衡：色溫（K）、色調（綠 − ↔ ＋ 洋紅）。0 K＝還不知道拍攝當下的值（等原生回報） */
  kelvin: number; tint: number;
  highlights: number; shadows: number;
  curves: CurveSet;
  hsl: HslBand[];
}
const ZERO_HSL = (): HslBand[] => Array.from({ length: 8 }, () => ({ h: 0, s: 0, l: 0 }));
const fresh = (ev: number, wb: { temp: number; tint: number } | null): State => ({
  exposure: ev, kelvin: wb?.temp ?? 0, tint: wb?.tint ?? 0, highlights: 0, shadows: 0, curves: LINEAR_CURVES(), hsl: ZERO_HSL(),
});

/* 色溫滑桿在 mired（1,000,000 ÷ K）上等距：人眼對色溫的感覺是均勻的。
   往右＝K 變大＝畫面變暖（跟 Lightroom 一樣：設定的是「光源」，光源越冷，補償後畫面越暖） */
const K_MIN = 2000, K_MAX = 50000;
const kToPos = (k: number) => -1e6 / Math.max(K_MIN, Math.min(K_MAX, k));
const posToK = (p: number) => Math.round(-1e6 / p / 10) * 10;

type ToolDef = { id: 'exposure' | 'highlights' | 'shadows' | 'kelvin' | 'tint'; label: string; icon: string };
const TOOLS: Record<'light' | 'wb', ToolDef[]> = {
  light: [
    { id: 'exposure', label: '曝光', icon: 'brightness_6' },
    { id: 'highlights', label: '高光', icon: 'tone_highlights' }, { id: 'shadows', label: '陰影', icon: 'tone_shadows' },
  ],
  wb: [{ id: 'kelvin', label: '色溫', icon: 'device_thermostat' }, { id: 'tint', label: '色調', icon: 'colorize' }],
};
const TAB_TITLES: Record<Tab, string> = { light: '光線', wb: '白平衡', curve: '曲線', hsl: 'HSL' };

export const RawDevelopSheet: React.FC<RawDevelopSheetProps> = ({ rawPath, previewSrc, leaving = false, protectEV, look, onCancel, onDone, developer = developRaw }) => {
  const [tab, setTab] = useState<Tab>('light');
  const [tool, setTool] = useState<ToolDef['id']>('exposure');
  const asShot = useRef<{ temp: number; tint: number } | null>(null);
  const [st, setSt] = useState<State>(() => fresh(protectEV, null));
  const stRef = useRef(st); stRef.current = st;
  const history = useRef<State[]>([]);
  const future = useRef<State[]>([]);
  const [, bumpHist] = useState(0);
  /** closed：原生預覽已經換成定格圖、關掉了（退場中） */
  const [mode, setMode] = useState<'native' | 'web' | 'pending' | 'closed'>('pending');
  const [busy, setBusy] = useState(false);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [menu, setMenu] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const comparing = useRef(false);
  const [comparingOn, setComparingOn] = useState(false);
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

  /* 拍攝當下的白平衡回來了：還沒動過的話，色溫、色調就停在它上面（歷史紀錄裡的也補上） */
  const gotAsShot = (temp: number, tint: number) => {
    if (asShot.current) return;
    asShot.current = { temp: temp || 5500, tint: tint || 0 };
    const fix = (s: State) => (s.kelvin ? s : { ...s, kelvin: asShot.current!.temp, tint: asShot.current!.tint });
    history.current = history.current.map(fix);
    const n = fix(stRef.current); stRef.current = n; setSt(n);
  };

  /* 退場：原生預覽先換成網頁上的定格圖、把後面的相簿放回來，再整頁往下滑走 */
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
    let curve: number[] | null = null;
    if (!(['rgb', 'r', 'g', 'b'] as const).every(c => isLinearCurve(s.curves[c]))) {
      const master = curveLut(s.curves.rgb), ch = [curveLut(s.curves.r), curveLut(s.curves.g), curveLut(s.curves.b)];
      curve = new Array(768);
      for (let i = 0; i < 256; i++) {
        const x = master[i] * 255, i0 = Math.floor(x), i1 = Math.min(255, i0 + 1), f = x - i0;
        for (let c = 0; c < 3; c++) curve[i * 3 + c] = ch[c][i0] * (1 - f) + ch[c][i1] * f;
      }
    }
    return {
      exposure: s.exposure,
      temperature: s.kelvin || undefined, tint: s.kelvin ? s.tint : undefined,
      contrast: 0, highlights: s.highlights / 100, shadows: s.shadows / 100, whites: 0, blacks: 0,
      clarity: 0, vibrance: 0, saturation: 0, sharpen: 0, lumaNR: 0, colorNR: 0,
      hsl: s.hsl.flatMap(b => [b.h / 100, b.s / 100, b.l / 100]), curve,
    };
  };
  const original = () => fresh(protectEV, asShot.current);
  const sendRaf = useRef(0);
  const push = (final: boolean) => {
    if (mode !== 'native') return;
    const go = () => { sendRaf.current = 0; void rawEditor().then(p => p?.updateEditor({ params: toParams(comparing.current ? original() : stRef.current), final })); };
    if (final) { if (sendRaf.current) cancelAnimationFrame(sendRaf.current); go(); }
    else if (!sendRaf.current) sendRaf.current = requestAnimationFrame(go);
  };

  /* ── 開原生沖洗：預覽疊在中間那塊（網頁那塊挖成透明） ── */
  useLayoutEffect(() => {
    let alive = true, restore: (() => void) | null = null, ro: ResizeObserver | null = null;
    const el = stage.current;
    void (async () => {
      await new Promise(resolve => window.setTimeout(resolve, 400));
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
        gotAsShot(info.asShotTemperature, info.asShotTint);
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

  /* ── 網頁版：只有曝光、白平衡，放手才沖 ── */
  const webRun = useRef(0);
  const webDevelop = async (s: State) => {
    const id = ++webRun.current;
    const r = await developer(rawPath, { exposure: s.exposure, temperature: s.kelvin || undefined, tint: s.kelvin ? s.tint : undefined }, look, true);
    if (id !== webRun.current || !r) return;
    if (r.asShotTemperature) gotAsShot(r.asShotTemperature, r.asShotTint ?? 0);
    setWebUrl(old => { if (old) URL.revokeObjectURL(old); return r.url; });
  };
  useEffect(() => { if (mode === 'web') void webDevelop(st); /* 第一張 */ }, [mode]);

  /* ── 改值、復原、重做 ── */
  const set = (patch: Partial<State>) => { const n = { ...stRef.current, ...patch }; stRef.current = n; setSt(n); push(false); };
  const begin = useRef<State | null>(null);
  const commit = () => {
    if (begin.current) { history.current.push(begin.current); future.current = []; begin.current = null; bumpHist(n => n + 1); }
    push(true);
    if (mode === 'web') void webDevelop(stRef.current);
  };
  const touch = () => { if (!begin.current) begin.current = stRef.current; };
  const jump = (to: State) => { stRef.current = to; setSt(to); bumpHist(n => n + 1); requestAnimationFrame(() => { push(true); if (mode === 'web') void webDevelop(to); }); };
  const undo = () => { const prev = history.current.pop(); if (!prev) return; haptic('tick'); future.current.push(stRef.current); jump(prev); };
  const redo = () => { const next = future.current.pop(); if (!next) return; haptic('tick'); history.current.push(stRef.current); jump(next); };
  const resetAll = () => {
    setMenu(false);
    if (!window.confirm('把所有調整回到拍攝當下？')) return;
    history.current.push(stRef.current); future.current = [];
    jump(original());
  };
  const finish = async () => {
    if (busy) return;
    setBusy(true); haptic('press');
    const s = stRef.current;
    const url = mode === 'native'
      ? await rawEditorExport(toParams(s))
      : (await developer(rawPath, { exposure: s.exposure, temperature: s.kelvin || undefined, tint: s.kelvin ? s.tint : undefined }, look, false))?.url ?? null;
    if (url) { exitingRef.current = true; onDone(url); } else setBusy(false);
  };

  /* ── 目前這顆工具的滑桿 ── */
  type Slider = { label: string; value: number; min: number; max: number; step: number; dflt: number; fmt: (v: number) => string; set: (v: number) => void; track?: string };
  const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`;
  const sliderOf = (id: ToolDef['id']): Slider => {
    switch (id) {
      case 'exposure': return { label: '曝光', value: st.exposure, min: -5, max: 5, step: 0.01, dflt: protectEV,
        fmt: v => `${v > 0.004 ? '+' : v < -0.004 ? '−' : ''}${Math.abs(v).toFixed(2)} EV`, set: v => set({ exposure: v }) };
      case 'kelvin': {
        const k = st.kelvin || asShot.current?.temp || 5500;
        return { label: '色溫', value: kToPos(k), min: kToPos(K_MIN), max: kToPos(K_MAX), step: 0.1, dflt: kToPos(asShot.current?.temp ?? 5500),
          fmt: v => `${posToK(v).toLocaleString()} K`, set: v => set({ kelvin: posToK(v) }),
          track: 'linear-gradient(90deg, #3b7bff, #cfd8e6 45%, #ffd25a)' };
      }
      case 'tint': return { label: '色調', value: st.tint, min: -150, max: 150, step: 1, dflt: asShot.current?.tint ?? 0, fmt: signed,
        set: v => set({ tint: v }), track: 'linear-gradient(90deg, #36c25a, #d6d6d6 50%, #e04ad8)' };
      case 'highlights': return { label: '高光', value: st.highlights, min: -100, max: 100, step: 1, dflt: 0, fmt: signed, set: v => set({ highlights: v }) };
      case 'shadows': return { label: '陰影', value: st.shadows, min: -100, max: 100, step: 1, dflt: 0, fmt: signed, set: v => set({ shadows: v }) };
    }
  };
  const cur = sliderOf(tool);
  const curRef = useRef(cur); curRef.current = cur;
  const resetCur = () => { const c = curRef.current; touch(); c.set(c.dflt); commit(); haptic('detentMajor'); };
  /* 雙擊白點：回到預設值（utils/sliderTouch 偵測到之後送到那根滑桿上） */
  const sliderBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sliderBox.current; if (!el) return;
    const h = () => resetCur();
    el.addEventListener(SLIDER_DOUBLE_TAP_EVENT, h);
    return () => el.removeEventListener(SLIDER_DOUBLE_TAP_EVENT, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const isChanged = (id: ToolDef['id']) => { const s = sliderOf(id); return Math.abs(s.value - s.dflt) > s.step / 2 + (id === 'kelvin' ? 0.5 : 0); };
  const tabChanged = useMemo(() => ({
    light: TOOLS.light.some(t => isChanged(t.id)),
    wb: !!asShot.current && (st.kelvin !== asShot.current.temp || st.tint !== asShot.current.tint),
    curve: !(['rgb', 'r', 'g', 'b'] as const).every(c => isLinearCurve(st.curves[c])),
    hsl: st.hsl.some(b => b.h || b.s || b.l),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [st]);

  /* 按住大圖：看原本的樣子（放開回來） */
  const compare = (on: boolean) => { comparing.current = on; setComparingOn(on); push(true); };
  const pickTab = (t: Tab) => {
    if (t === tab) return;
    haptic('tick'); setTab(t);
    if (t === 'light') setTool('exposure'); else if (t === 'wb') setTool('kelvin');
  };

  return (
    <div data-raw-develop
      className={`fixed inset-0 z-[300] flex flex-col text-white select-none font-sans transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${mode === 'native' ? '' : 'bg-[#080808]'} ${leaving || !entered ? 'translate-y-full' : 'translate-y-0'}`}
      style={{ willChange: 'transform' }}>
      {/* 上方（跟編輯頁一樣）：‹｜復原、重做｜白色「完成 ⋯」 */}
      <div className="shrink-0 bg-[#080808]" style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
        <div className="relative h-12 px-4 flex items-center justify-between">
          <button aria-label="返回" onClick={() => void exit()} className="p-2 -ml-2 text-[#aaa] active:scale-90 transition-transform">
            <ChevronLeft size={22} />
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-6">
            <button aria-label="復原" onClick={undo} disabled={!history.current.length} className="p-1 text-white disabled:text-white/25 active:scale-90 transition-transform">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
            </button>
            <button aria-label="重做" onClick={redo} disabled={!future.current.length} className="p-1 text-white disabled:text-white/25 active:scale-90 transition-transform">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
            </button>
          </div>
          <div className="relative h-8 flex items-center bg-white text-black rounded-full overflow-visible">
            <button onClick={() => void finish()} disabled={mode === 'pending' || busy} className="px-4 py-1.5 text-[11px] font-black whitespace-nowrap disabled:opacity-40">
              {busy ? '沖洗中…' : '完成'}
            </button>
            <span aria-hidden className="w-px h-4 bg-black/20" />
            <button aria-label="更多" onClick={() => setMenu(v => !v)} className="h-8 px-2 flex items-center"><Icon name="more_horiz" className="text-xl" /></button>
            {menu && (
              <div className="absolute right-0 top-10 z-10 w-44 rounded-2xl bg-[#1c1c1e] border border-white/10 shadow-2xl overflow-hidden text-white animate-in fade-in zoom-in-95 duration-150">
                <button onClick={resetAll} className="w-full px-4 py-3 text-left text-[13px] active:bg-white/10">全部回到拍攝當下</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 大圖（App 裡這一塊是透明的，底下是原生即時預覽）。按住看原本的樣子。曲線跟編輯頁一樣疊在大圖下半部 */}
      <div ref={stage} className="flex-1 min-h-0 relative bg-[#080808]"
        onPointerDown={() => { setMenu(false); compare(true); }} onPointerUp={() => compare(false)} onPointerCancel={() => compare(false)} onPointerLeave={() => comparing.current && compare(false)}>
        {mode !== 'native' && (still || webUrl || previewSrc) && <img src={still || webUrl || previewSrc} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain" />}
        {comparingOn && <span className="absolute left-1/2 top-3 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/55 text-[10px] font-black tracking-[0.2em] text-white/90 pointer-events-none">原始</span>}
        {tab === 'curve' && (
          <div className="absolute left-0 right-0 z-40 flex items-end justify-center pointer-events-none" style={{ bottom: 12, height: 250 }}>
            <div className="pointer-events-auto translate-x-[19px]">
              <CurvesPad curves={st.curves} onStart={touch}
                onChange={(c, final) => { set({ curves: c }); if (final) commit(); }} />
            </div>
          </div>
        )}
      </div>

      <div className={`shrink-0 transition-opacity ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
        {tab === 'hsl' ? (
          <div className="bg-[#111] border-t border-white/5" style={{ height: HSL_PANEL_H }}>
            <HslPanel value={st.hsl} onStart={touch} onChange={hsl => set({ hsl })} onCommit={commit} />
          </div>
        ) : tab === 'curve' ? (
          <div className="bg-[#111] border-t border-white/5" style={{ height: 0 }} />
        ) : (
          <>
            {/* 滑桿（跟編輯頁一樣）：名稱｜數值，下面一條。雙擊名稱、雙擊白點都回到預設值 */}
            <div className="bg-[#111] px-8 h-20 flex flex-col justify-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="w-full">
                <div className="flex justify-between items-center cursor-pointer select-none mb-1 translate-y-2" title="雙擊重置" onDoubleClick={resetCur}>
                  <span className="font-black text-white/40 uppercase text-[10px] tracking-[0.2em]">{cur.label}</span>
                  <span className="font-sans tabular-nums font-bold bg-white/10 rounded text-xs px-2 py-0.5">{cur.fmt(cur.value)}</span>
                </div>
                <div ref={sliderBox} className="relative">
                  {cur.track && <div aria-hidden className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full opacity-80 pointer-events-none" style={{ background: cur.track }} />}
                  <LiveRange ariaLabel={cur.label} min={cur.min} max={cur.max} step={cur.step} value={cur.value} height={40}
                    className={`custom-range ${cur.track ? 'raw-track-colored' : ''}`}
                    onPointerDown={touch} onValue={x => { touch(); cur.set(x); }} onCommit={commit} />
                </div>
              </div>
            </div>
            {/* 工具：一排圓形按鈕（跟編輯頁一樣），選中的是白底黑字；調過的下面亮一個點 */}
            <div className="flex items-center justify-center px-4 overflow-x-auto no-scrollbar gap-2 bg-[#080808] h-24">
              {TOOLS[tab].map(t => {
                const on = tool === t.id;
                return (
                  <button key={t.id} onClick={() => { if (!on) { haptic('tick'); setTool(t.id); } }} className="flex flex-col items-center gap-1 shrink-0 w-16">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${on ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40'}`}>
                      <Icon name={t.icon} className="text-lg" fill={on} />
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${on ? 'text-white' : 'text-white/20'}`}>{t.label}</span>
                    <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${isChanged(t.id) ? 'bg-white/70' : 'bg-transparent'}`} />
                  </button>
                );
              })}
            </div>
          </>
        )}
        {/* 分頁（跟編輯頁的下方分頁列一樣） */}
        <div className="flex border-t border-white/10 bg-black px-3" style={{ height: 44, paddingBottom: 'max(env(safe-area-inset-bottom), 12px)', boxSizing: 'content-box' }}>
          {(['light', 'wb', 'curve', 'hsl'] as const).map(t => (
            <button key={t} onClick={() => pickTab(t)} className={`relative h-full flex items-center justify-center flex-1 ${tab === t ? 'text-white' : 'text-white/50'}`}>
              <span className="text-[12.5px] font-normal tracking-[0.04em] whitespace-nowrap">{TAB_TITLES[t]}</span>
              {tabChanged[t] && tab !== t && <span aria-hidden className="absolute top-2.5 right-[calc(50%-22px)] w-1 h-1 rounded-full bg-white/60" />}
              <span aria-hidden className={`absolute left-1/2 bottom-[4px] -ml-[9px] w-[18px] h-[2px] rounded-full bg-white transition-[opacity,transform] duration-200 ${tab === t ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
