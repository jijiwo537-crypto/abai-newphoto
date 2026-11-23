import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { LiveRange } from './LiveRange';
import { Icon } from './Icon';
import { haptic } from '../utils/haptics';
import { punchThrough } from '../utils/nativePreview';
import { developRaw, rawEditor, rawEditorExport, rawEditorSnapshot, type RawEditParams, type RawLook } from '../utils/nativeCamera';

/* ── RAW 沖洗（底片模式拍的 RAW）────────────────────────────────────────
 * 版面跟編輯頁一樣：上面 ‹｜復原、重做｜「完成 ⋯」；大圖；一條滑桿（名稱、數值）；一排圓形工具；最下面分頁。
 * 分頁：光線、白平衡、色彩、細節、曲線。
 * 沖洗本身在原生端（ios/App/App/ABAIRawDevelop.swift）：場景線性 16 位元浮點、局部階調、Oklab 色彩、
 * 白平衡照 DNG 規格在相機原生色彩空間裡做（色溫 K、色調），最後才用保住色相的曲線印出來。
 * 原生預覽疊在網頁中間那塊透明的位置底下，拖滑桿每一格都即時重畫。
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

type Tab = 'light' | 'wb' | 'color' | 'detail' | 'curve';
type Channel = 'rgb' | 'r' | 'g' | 'b';
type Pt = [number, number];
interface State {
  exposure: number;
  /** 白平衡：色溫（K）、色調（綠 − ↔ ＋ 洋紅）。0 K＝還不知道拍攝當下的值（等原生回報） */
  kelvin: number; tint: number;
  contrast: number; highlights: number; shadows: number; whites: number; blacks: number; clarity: number;
  vibrance: number; saturation: number;
  hsl: number[];   // 8 × [h, s, l]，-100～100
  sharpen: number; lumaNR: number; colorNR: number;
  curves: Record<Channel, Pt[]>;
}
const LINE: Pt[] = [[0, 0], [1, 1]];
const fresh = (ev: number, wb: { temp: number; tint: number } | null): State => ({
  exposure: ev, kelvin: wb?.temp ?? 0, tint: wb?.tint ?? 0,
  contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, vibrance: 0, saturation: 0,
  hsl: Array(24).fill(0), sharpen: 0, lumaNR: 0, colorNR: 0, curves: { rgb: LINE, r: LINE, g: LINE, b: LINE },
});

const BANDS = [
  ['紅', '#ff3b30'], ['橙', '#ff9500'], ['黃', '#ffd60a'], ['綠', '#34c759'],
  ['青', '#5ac8fa'], ['藍', '#0a5cff'], ['紫', '#af52de'], ['洋紅', '#ff2d92'],
] as const;

/* 色溫滑桿在 mired（1,000,000 ÷ K）上等距：人眼對色溫的感覺是均勻的（2000K→3000K 跟 6000K→9000K 差不多大）。
   往右＝K 變大＝畫面變暖（跟 Lightroom 一樣：設定的是「光源」，光源越冷，補償後畫面越暖） */
const K_MIN = 2000, K_MAX = 50000;
const kToPos = (k: number) => -1e6 / Math.max(K_MIN, Math.min(K_MAX, k));
const posToK = (p: number) => Math.round(-1e6 / p / 10) * 10;

type ToolDef = { id: string; label: string; icon: string };
const TOOLS: Record<Exclude<Tab, 'curve'>, ToolDef[]> = {
  light: [
    { id: 'exposure', label: '曝光', icon: 'brightness_6' }, { id: 'contrast', label: '對比', icon: 'contrast' },
    { id: 'highlights', label: '高光', icon: 'tone_highlights' }, { id: 'shadows', label: '陰影', icon: 'tone_shadows' },
    { id: 'whites', label: '白色', icon: 'tone_whites' }, { id: 'blacks', label: '黑色', icon: 'tone_blacks' },
    { id: 'clarity', label: '清晰度', icon: 'tonality' },
  ],
  wb: [{ id: 'kelvin', label: '色溫', icon: 'device_thermostat' }, { id: 'tint', label: '色調', icon: 'colorize' }],
  color: [
    { id: 'vibrance', label: '自然飽和度', icon: 'color_lens' }, { id: 'saturation', label: '飽和度', icon: 'palette' },
    ...BANDS.map(([name], i) => ({ id: `band${i}`, label: name, icon: '' })),
  ],
  detail: [
    { id: 'sharpen', label: '銳化', icon: 'change_history' }, { id: 'lumaNR', label: '明度降噪', icon: 'blur_on' },
    { id: 'colorNR', label: '色彩降噪', icon: 'invert_colors' },
  ],
};
const TAB_TITLES: Record<Tab, string> = { light: '光線', wb: '白平衡', color: '色彩', detail: '細節', curve: '曲線' };
const DEFAULT_TOOL: Record<Tab, string> = { light: 'exposure', wb: 'kelvin', color: 'vibrance', detail: 'sharpen', curve: '' };

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
  const [tab, setTab] = useState<Tab>('light');
  const [tool, setTool] = useState('exposure');
  const [channel, setChannel] = useState<Channel>('rgb');
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
      exposure: s.exposure,
      temperature: s.kelvin || undefined, tint: s.kelvin ? s.tint : undefined,
      contrast: s.contrast / 100, highlights: s.highlights / 100, shadows: s.shadows / 100, whites: s.whites / 100, blacks: s.blacks / 100,
      clarity: s.clarity / 100, vibrance: s.vibrance / 100, saturation: s.saturation / 100,
      sharpen: s.sharpen / 100, lumaNR: s.lumaNR / 100, colorNR: s.colorNR / 100,
      hsl: s.hsl.map(v => v / 100), curve,
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
      /* 先讓整頁完成入場；原生 Metal 預覽依最後位置建立，入場時以原照片銜接。 */
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
  const set = (patch: Partial<State>) => { setSt(s => { const n = { ...s, ...patch }; stRef.current = n; return n; }); push(false); };
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

  /* ── 目前這顆工具的滑桿定義 ── */
  type Slider = { label: string; value: number; min: number; max: number; step: number; dflt: number; fmt: (v: number) => string; set: (v: number) => void;
    /** 軌道顏色（白平衡：藍→黃、綠→洋紅） */ track?: string };
  const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`;
  const band = tool.startsWith('band') ? Number(tool.slice(4)) : -1;
  const [hslPart, setHslPart] = useState<0 | 1 | 2>(1);
  const sliderOf = (id: string): Slider | null => {
    const num = (k: keyof State, label: string, dflt = 0): Slider => ({ label, value: st[k] as number, min: -100, max: 100, step: 1, dflt, fmt: signed, set: v => set({ [k]: v } as Partial<State>) });
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
      case 'contrast': return num('contrast', '對比');
      case 'highlights': return num('highlights', '高光');
      case 'shadows': return num('shadows', '陰影');
      case 'whites': return num('whites', '白色');
      case 'blacks': return num('blacks', '黑色');
      case 'clarity': return num('clarity', '清晰度');
      case 'vibrance': return num('vibrance', '自然飽和度');
      case 'saturation': return num('saturation', '飽和度');
      case 'sharpen': return num('sharpen', '銳化');
      case 'lumaNR': return num('lumaNR', '明度降噪');
      case 'colorNR': return num('colorNR', '色彩降噪');
    }
    if (band >= 0) {
      const idx = band * 3 + hslPart;
      const [name, color] = BANDS[band];
      const label = `${name}・${['色相', '飽和度', '明度'][hslPart]}`;
      const track = hslPart === 0 ? `linear-gradient(90deg, ${BANDS[(band + 7) % 8][1]}, ${color} 50%, ${BANDS[(band + 1) % 8][1]})`
        : hslPart === 1 ? `linear-gradient(90deg, #777, ${color})` : `linear-gradient(90deg, #111, ${color} 50%, #fff)`;
      return { label, value: st.hsl[idx], min: -100, max: 100, step: 1, dflt: 0, fmt: signed, track,
        set: v => { const hsl = [...stRef.current.hsl]; hsl[idx] = v; set({ hsl }); } };
    }
    return null;
  };
  const cur = sliderOf(tool);
  const isChanged = (id: string) => {
    const s = sliderOf(id);
    if (id.startsWith('band')) { const b = Number(id.slice(4)); return st.hsl.slice(b * 3, b * 3 + 3).some(Boolean); }
    return !!s && Math.abs(s.value - s.dflt) > s.step / 2 + (id === 'kelvin' ? 0.5 : 0);
  };
  const tabChanged = useMemo(() => ({
    light: TOOLS.light.some(t => isChanged(t.id)),
    wb: !!asShot.current && (st.kelvin !== asShot.current.temp || st.tint !== asShot.current.tint),
    color: TOOLS.color.some(t => isChanged(t.id)),
    detail: TOOLS.detail.some(t => isChanged(t.id)),
    curve: !(['rgb', 'r', 'g', 'b'] as const).every(c => isLine(st.curves[c])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [st]);

  /* 按住大圖：看原本的樣子（放開回來） */
  const compare = (on: boolean) => { comparing.current = on; setComparingOn(on); push(true); };

  const pickTab = (t: Tab) => { if (t === tab) return; haptic('tick'); setTab(t); setTool(DEFAULT_TOOL[t]); };

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

      {/* 大圖（App 裡這一塊是透明的，底下是原生即時預覽）。按住看原本的樣子 */}
      <div ref={stage} className="flex-1 min-h-0 relative bg-[#080808]"
        onPointerDown={() => { setMenu(false); compare(true); }} onPointerUp={() => compare(false)} onPointerCancel={() => compare(false)} onPointerLeave={() => comparing.current && compare(false)}>
        {mode !== 'native' && (still || webUrl || previewSrc) && <img src={still || webUrl || previewSrc} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain" />}
        {comparingOn && <span className="absolute left-1/2 top-3 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/55 text-[10px] font-black tracking-[0.2em] text-white/90 pointer-events-none">原始</span>}
      </div>

      <div className={`shrink-0 transition-opacity ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
        {tab === 'curve' ? (
          <div className="bg-[#111] px-6 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <CurveEditor channel={channel} onChannel={setChannel} pts={st.curves[channel]}
              onBegin={touch}
              onChange={pts => set({ curves: { ...stRef.current.curves, [channel]: pts } })}
              onCommit={commit} />
          </div>
        ) : (
          <>
            {/* 滑桿（跟編輯頁一樣）：名稱｜數值，下面一條。雙擊名稱回預設 */}
            <div className="bg-[#111] px-8 h-20 flex flex-col justify-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {cur && (
                <div className="w-full">
                  <div className="flex justify-between items-center cursor-pointer select-none mb-1 translate-y-2" title="雙擊重置"
                    onDoubleClick={() => { touch(); cur.set(cur.dflt); commit(); haptic('tick'); }}>
                    <span className="font-black text-white/40 uppercase text-[10px] tracking-[0.2em]">{cur.label}</span>
                    <span className="flex items-center gap-2">
                      {band >= 0 && (
                        <span className="flex rounded bg-white/5 p-0.5">
                          {(['色相', '飽和', '明度'] as const).map((n, i) => (
                            <button key={n} onClick={() => { haptic('tick'); setHslPart(i as 0 | 1 | 2); }}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${hslPart === i ? 'bg-white/15 text-white' : 'text-white/40'}`}>{n}</button>
                          ))}
                        </span>
                      )}
                      <span className="font-sans tabular-nums font-bold bg-white/10 rounded text-xs px-2 py-0.5">{cur.fmt(cur.value)}</span>
                    </span>
                  </div>
                  <div className="relative">
                    {cur.track && <div aria-hidden className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full opacity-80 pointer-events-none" style={{ background: cur.track }} />}
                    <LiveRange ariaLabel={cur.label} min={cur.min} max={cur.max} step={cur.step} value={cur.value} height={40}
                      className={`custom-range ${cur.track ? 'raw-track-colored' : ''}`}
                      onPointerDown={touch} onValue={x => { touch(); cur.set(x); }} onCommit={commit} />
                  </div>
                </div>
              )}
            </div>
            {/* 工具：一排圓形按鈕（跟編輯頁一樣），選中的是白底黑字；調過的下面亮一個點 */}
            <div className="flex items-center px-4 overflow-x-auto no-scrollbar gap-2 bg-[#080808] h-24">
              {TOOLS[tab].map(t => {
                const on = tool === t.id, changed = isChanged(t.id);
                const bi = t.id.startsWith('band') ? Number(t.id.slice(4)) : -1;
                return (
                  <button key={t.id} onClick={() => { if (!on) { haptic('tick'); setTool(t.id); } }} className="flex flex-col items-center gap-1 shrink-0 w-16">
                    {bi >= 0 ? (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${on ? 'scale-110' : ''}`}
                        style={{ background: on ? BANDS[bi][1] : 'rgba(255,255,255,0.05)', boxShadow: on ? 'none' : `inset 0 0 0 2.5px ${BANDS[bi][1]}` }} />
                    ) : (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${on ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40'}`}>
                        <Icon name={t.icon} className="text-lg" fill={on} />
                      </div>
                    )}
                    <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${on ? 'text-white' : 'text-white/20'}`}>{t.label}</span>
                    <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${changed ? 'bg-white/70' : 'bg-transparent'}`} />
                  </button>
                );
              })}
            </div>
          </>
        )}
        {/* 分頁（跟編輯頁的下方分頁列一樣） */}
        <div className="flex border-t border-white/10 bg-black px-3" style={{ height: 44, paddingBottom: 'max(env(safe-area-inset-bottom), 12px)', boxSizing: 'content-box' }}>
          {(['light', 'wb', 'color', 'detail', 'curve'] as const).map(t => (
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
