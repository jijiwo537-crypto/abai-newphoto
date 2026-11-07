/* 點陣文字：照片轉成可以複製貼上的點字圖案（演算法見 utils/dotArt）
   版面跟美顏同一套：上面成品（黑底白點、即時更新、可以用手指畫點／擦點），
   預覽下緣懸空放換照片、線稿／陰影、反轉；下面一塊滑桿和一排工具；右上角複製、儲存成圖片。 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Copy, Check, Plus } from 'lucide-react';
import { Icon } from './Icon';
import { Glyph } from './Glyph';
import { SaveButton } from './SaveButton';
import { BusySpinner } from './BusySpinner';
import { ExportActionLift } from './ExportActionLift';
import { useStandaloneToolViewport, standaloneToolViewportCSS } from '../utils/useStandaloneToolViewport';
import { DOT_ART_DEFAULTS, DOT_ART_SHADE_THRESHOLD, DotArtSession, prepareDotArtImage, warmLineArtModel, type DotArtFrame, type DotArtSettings, curveT, CURVE_N } from '../utils/dotArt';

type Kind = 'line' | 'shade';
type ToolId = 'width' | 'threshold' | 'lines' | 'spacing' | 'glow' | 'draw' | 'erase';
interface ToolDef { id: ToolId; label: string; glyph: React.ReactNode; min: number; max: number }
/* 數量＝橫向幾個字（越多點越多、越細）；輪廓＝照片裡的輪廓線描出多少；間距＝點幾個一組排。
   圖示沿用其他功能的同名工具：數量＝特效的「數量」、間距＝多格拼圖描邊的「間距」、明暗＝調節的亮度、
   筆刷＝人像修容、擦除＝遮色片的擦除；輪廓用空心星星；發光＝一顆亮點加兩圈光暈 */
const TOOLS: ToolDef[] = [
  { id: 'width', label: '數量', glyph: <Icon name="apps" className="text-xl" />, min: 0, max: 100 },
  { id: 'threshold', label: '明暗', glyph: <Icon name="light_mode" className="text-xl" />, min: 0, max: 100 },
  { id: 'lines', label: '輪廓', glyph: <Icon name="star_outline" className="text-xl" />, min: 0, max: 20 },
  { id: 'spacing', label: '間距', glyph: <Glyph k="gap" size={20} />, min: 1, max: 8 },
  { id: 'glow', label: '發光', glyph: <Icon name="dot_glow" className="text-xl" />, min: 0, max: 100 },
  { id: 'draw', label: '筆刷', glyph: <Icon name="brush" className="text-xl" />, min: 1, max: 8 },
  { id: 'erase', label: '擦除', glyph: <Glyph k="erase" size={20} />, min: 1, max: 8 },
];
/** 數量滑桿看起來是 0～100，實際是 20～100 個字（0 → 20 字、100 → 100 字） */
const WIDTH_MIN = 20, WIDTH_MAX = 100;
const widthOf = (v: number) => Math.round(WIDTH_MIN + (WIDTH_MAX - WIDTH_MIN) * Math.round(v) / 100);
const sliderOfWidth = (w: number) => (w - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN) * 100;
/** 滑桿是連續的（拖起來不會一格一格），算圖時才取到該有的刻度 */
const snap = (id: ToolId, v: number) => (id === 'threshold' ? Math.round(v * 1000) / 1000 : Math.round(v));

/* 明暗滑桿：算法照網站（門檻值 0.01～0.99），但滑桿位置改成「點亮的點有多少」平均分布。
   照網站原本的刻度，偏暗或偏亮的照片有一大段滑桿完全沒變化（點全滿／全空），看起來像沒反應；
   現在依這張照片算出的對照表換算，滑桿每一段都會改變點的多寡。預設值還是網站的 0.80（結果一模一樣）。 */
/** 對照表 → 滑桿刻度：每一段的寬度＝一半看點的多寡變了多少、一半平均分給「有變化的範圍」；
    頭尾整段都是全滿或全空（怎麼調都一樣）的部分寬度是 0。回傳每個取樣點在滑桿上的位置（0～1） */
const scaleOf = (c: Float32Array): Float64Array | null => {
  const N = c.length, first = c[0], last = c[N - 1];
  if (Math.abs(first - last) < 1e-4) return null;
  let a = 0, b = N - 1;
  while (a < N - 1 && Math.abs(c[a + 1] - first) < 1e-6) a++;   // 開頭不會變的那一段
  while (b > 0 && Math.abs(c[b - 1] - last) < 1e-6) b--;         // 結尾不會變的那一段
  const total = Math.abs(last - first), segs = Math.max(1, b - a), w = new Float64Array(N);
  for (let k = 1; k < N; k++) {
    const active = k > a && k <= b;
    w[k] = w[k - 1] + (active ? 0.5 * Math.abs(c[k] - c[k - 1]) / total + 0.5 / segs : 0);
  }
  const end = w[N - 1] || 1;
  for (let k = 0; k < N; k++) w[k] /= end;
  return w;
};
/** 明暗值 → 滑桿位置（0～100） */
const posOfT = (c: Float32Array | null, t: number) => {
  const w = c && scaleOf(c);
  if (!w) return (t - 0.01) / 0.98 * 100;
  const x = Math.max(0, Math.min(CURVE_N - 1, (t - 0.01) / 0.98 * (CURVE_N - 1))), i = Math.min(CURVE_N - 2, Math.floor(x)), f = x - i;
  return (w[i] * (1 - f) + w[i + 1] * f) * 100;
};
/** 滑桿位置（0～100）→ 明暗值 */
const tOfPos = (c: Float32Array | null, p: number) => {
  const w = c && scaleOf(c), q = p / 100;
  if (!w) return 0.01 + 0.98 * q;
  for (let k = 1; k < CURVE_N; k++) if (w[k] >= q && w[k] > w[k - 1]) {
    const f = (q - w[k - 1]) / (w[k] - w[k - 1]);
    return curveT(k - 1) + (curveT(k) - curveT(k - 1)) * Math.max(0, Math.min(1, f));
  }
  return q <= 0 ? 0.01 : 0.99;
};

/* 點字 ⇄ 點陣：每格 8 個位元對應的位置 [欄, 列] */
const POS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];
const BIT_AT = [[0, 3], [1, 4], [2, 5], [6, 7]];   // [列][欄] → 位元

/* 點的排法照參考網站實際顯示的樣子量出來：一個字寬 1、高 1.532；點是方的，邊長 0.19 個字寬。
   點會「幾個一組」排：組內靠近、組與組之間空多一點（網站是橫向 2 個一組、直向 4 個一組）。
   組數可以調；組內：組間的距離比固定（橫向 9.5:14、直向 8:12，都是從網站量的），平均點距不變，
   所以整張大小、比例不會因為調間距而改變。 */
const CH = 1.532, DOT = 0.19;
/** 預覽下緣懸空那一排（換照片／線稿陰影／反轉）佔的高度：點陣畫在它上面，手指畫點時不會被按鈕擋到 */
const BOTTOM_ROW = 68;
const RX = 9.5 / 14, RY = 8 / 12;
/** 一個方向上每個點的中心位置（以字寬／字高為單位）。n＝點數、cells＝格數、per＝每格幾點、g＝幾點一組、phase＝分組起點 */
const axis = (n: number, cells: number, per: number, g: number, r: number, phase: number) => {
  const p = 1 / per, sIn = g * p / (g - 1 + 1 / r), extra = sIn / r - sIn, pos = new Float64Array(n);
  for (let i = 0; i < n; i++) pos[i] = i * sIn + Math.floor((i + phase) / g) * extra - Math.floor(phase / g) * extra;
  const off = (cells - (n > 1 ? pos[n - 1] : 0)) / 2;
  for (let i = 0; i < n; i++) pos[i] += off;
  return { pos, minStep: g > 1 ? sIn : p };
};
/* 橫向的組以「字和字的交界」為中心（網站 2 個一組時是相鄰兩個字的欄靠在一起）；直向的組對齊每個字 */
const layoutFor = (W: number, H: number, gx: number, gy: number) => ({
  x: axis(W, W / 2, 2, gx, RX, Math.floor(gx / 2)),
  y: axis(H, H / 4, 4, gy, RY, 0),
});
type Layout = ReturnType<typeof layoutFor>;
/** 手指位置（字寬／字高為單位）→ 連續的點座標（點中心在 i＋0.5），點距不平均也對得準 */
const toAxis = (u: number, pos: Float64Array) => {
  const n = pos.length; if (n < 2) return 0.5;
  let lo = 0, hi = n - 1;
  if (u <= pos[0]) return 0.5 + (u - pos[0]) / (pos[1] - pos[0]);
  if (u >= pos[n - 1]) return n - 0.5 + (u - pos[n - 1]) / (pos[n - 1] - pos[n - 2]);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pos[m] <= u) lo = m; else hi = m; }
  return lo + 0.5 + (u - pos[lo]) / (pos[hi] - pos[lo]);
};

/** 整張照片的點陣（W＝字數×2、H＝列數×4），1＝有點 */
interface Bits { W: number; H: number; d: Uint8Array }
const textToBits = (f: DotArtFrame, invert: boolean): Bits => {
  const W = f.cols * 2, H = f.rows * 4, d = new Uint8Array(W * H);
  const lines = f.text.split('\n'), cols = Math.max(0, ...lines.map(l => l.length));
  for (let y = 0; y < lines.length; y++) {
    const l = lines[y];
    for (let x = 0; x < cols; x++) {
      let code = x < l.length ? l.charCodeAt(x) - 0x2800 : 0;
      if (code < 0 || code > 0xff) code = 0;
      if (invert) code ^= 0xff;   // 反轉只翻成品的範圍（跟網站一樣，四周收掉的空白不翻）
      if (!code) continue;
      for (let k = 0; k < 8; k++) if (code & (1 << k)) d[((f.top + y) * 4 + POS[k][1]) * W + (f.left + x) * 2 + POS[k][0]] = 1;
    }
  }
  return { W, H, d };
};
/** 點陣 → 點字文字（收掉四周空白）；全空白回傳 null */
const bitsToText = (b: Bits): { text: string; x0: number; y0: number; cols: number; rows: number } | null => {
  const C = b.W / 2, R = b.H / 4, codes = new Uint8Array(C * R);
  let x0 = C, x1 = -1, y0 = R, y1 = -1;
  for (let y = 0; y < b.H; y++) for (let x = 0; x < b.W; x++) if (b.d[y * b.W + x]) {
    const cx = x >> 1, cy = y >> 2;
    codes[cy * C + cx] |= 1 << BIT_AT[y & 3][x & 1];
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
  }
  if (x1 < 0) return null;
  const rows: string[] = [];
  for (let y = y0; y <= y1; y++) {
    let s = '';
    for (let x = x0; x <= x1; x++) s += String.fromCharCode(0x2800 + codes[y * C + x]);
    rows.push(s);
  }
  return { text: rows.join('\n'), x0, y0, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
};
/** 把點陣畫上去（ox, oy 是畫布上原點的位置、cw/ch 是一個字的寬高） */
const drawDots = (g: CanvasRenderingContext2D, b: Bits, L: Layout, cw: number, ch: number, ox: number, oy: number, x0 = 0, y0 = 0, x1 = b.W, y1 = b.H) => {
  const sz = Math.max(0.6, cw * DOT), h = sz / 2, px = L.x.pos, py = L.y.pos;
  for (let y = y0; y < y1; y++) {
    const row = y * b.W, cy = oy + py[y] * ch - h;
    for (let x = x0; x < x1; x++) if (b.d[row + x]) g.rect(ox + px[x] * cw - h, cy, sz, sz);
  }
};

/* ── 發光：把白點縮小再放大疊起來（一層一層對半縮、再一層一層放大加回去），就是柔和的光暈 ──
   全部用畫布的 drawImage 做（顯示卡算），不逐點算，所以拖滑桿、畫點都不會卡。
   光暈大小跟著「一個字多寬」走：預覽、存成圖片兩邊大小不同，光暈看起來的比例一樣。
   滑桿只改光暈那一層的透明度（不用重算），所以拖起來跟一般滑桿一樣順。 */
type GlowPool = HTMLCanvasElement[];
const GLOW_GAIN = 2;   // 光暈本身先放大幾倍（點很細，平均下來很淡）
const glowLayer = (src: HTMLCanvasElement, cwPx: number, pool: GlowPool) => {
  const K = Math.max(1, Math.round(Math.log2(Math.max(2, 2 * cwPx)))), k0 = Math.max(1, K - 3), unit = 2 ** K;
  const pad = Math.ceil(3 * cwPx / unit) * unit;
  const W0 = Math.ceil((src.width + 2 * pad) / unit) * unit, H0 = Math.ceil((src.height + 2 * pad) / unit) * unit;
  const lv = (k: number) => {
    const c = pool[k] || (pool[k] = document.createElement('canvas')), w = W0 >> k, h = H0 >> k;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else c.getContext('2d')!.clearRect(0, 0, w, h);
    const g = c.getContext('2d')!; g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.imageSmoothingEnabled = true;
    return c;
  };
  ctxOf(lv(1)).drawImage(src, pad / 2, pad / 2, src.width / 2, src.height / 2);
  for (let k = 2; k <= K; k++) ctxOf(lv(k)).drawImage(pool[k - 1], 0, 0, W0 >> k, H0 >> k);
  for (let k = K - 1; k >= k0; k--) { const g = ctxOf(pool[k]); g.globalCompositeOperation = 'lighter'; g.drawImage(pool[k + 1], 0, 0, W0 >> k, H0 >> k); }
  const out = pool[k0], g = ctxOf(out);
  g.globalCompositeOperation = 'lighter';
  for (let i = 1; i < GLOW_GAIN; i++) g.drawImage(out, 0, 0);
  g.globalCompositeOperation = 'source-over';
  return { c: out, pad, scale: 2 ** k0, W0, H0 };
};
const ctxOf = (c: HTMLCanvasElement) => c.getContext('2d')!;

/** 一筆畫改到哪些點：位置、改之前、改之後（復原／重做只記差異，不用每筆存一整張） */
interface Step { key: string; idx: number[]; before: number[]; after: number[] }

export function DotArtStudio({ onClose, initialFiles }: { onClose: () => void; initialFiles: File[] }) {
  const viewport = useStandaloneToolViewport();
  const [kind, setKind] = useState<Kind>('line');
  /* 兩種各記各的明暗：線稿 0.80、陰影 0.65（陰影要亮一點才看得出層次） */
  const [raw, setRaw] = useState<Record<Kind, DotArtSettings>>({
    line: { ...DOT_ART_DEFAULTS, width: sliderOfWidth(DOT_ART_DEFAULTS.width) },
    shade: { ...DOT_ART_DEFAULTS, width: sliderOfWidth(DOT_ART_DEFAULTS.width), threshold: DOT_ART_SHADE_THRESHOLD },
  });
  /* 間距：橫向、直向各幾個點一組（只改點的排法，不改點字內容） */
  const [gap, setGap] = useState({ x: 2, y: 4 });
  const gx = Math.round(gap.x), gy = Math.round(gap.y);
  const [brush, setBrush] = useState(2);
  /* 發光：0＝不發光（預設），只影響畫面與存成的圖片，複製的點字文字不受影響 */
  const [glow, setGlow] = useState(0);
  const glowOn = glow > 0.5;
  const glowOnRef = useRef(glowOn); glowOnRef.current = glowOn;
  const [tool, setTool] = useState<ToolId>('width');
  const [frame, setFrame] = useState<DotArtFrame | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelReady, setModelReady] = useState(false);
  const [rendered, setRendered] = useState(false);   // 完整的點陣算出第一張了沒
  const [photo, setPhoto] = useState<string>('');
  /* 網站是白底黑點（點＝暗的地方）。這裡是黑底白點，要看起來一樣就要反轉（點＝亮的地方、暗的地方是空的） */
  const [inverted, setInverted] = useState(true);
  const [copied, setCopied] = useState(false);
  const session = useRef<DotArtSession | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /* ── 手畫的點：跟著「線稿／陰影＋數量」存（同一個點陣大小），調明暗、輪廓時畫過的點都還在 ── */
  const edits = useRef(new Map<string, Uint8Array>());   // 每個點：1＝點亮、2＝擦掉、0＝照算出來的
  const undoStack = useRef<Step[]>([]);
  const redoStack = useRef<Step[]>([]);
  const [histTick, setHistTick] = useState(0);

  const busy = useRef(false), shown = useRef('');
  const open = useCallback(async (file: File) => {
    setStatus('loading'); setFrame(null); setModelReady(false); setRendered(false);
    edits.current.clear(); undoStack.current = []; redoStack.current = []; setHistTick(t => t + 1);
    curves.current.clear(); thrPos.current = null;
    try {
      const c = await prepareDotArtImage(file);
      setPhoto(c.toDataURL('image/jpeg', 0.8));
      const s = new DotArtSession(c);
      s.onCurve = (key, curve) => { if (session.current === s) { curves.current.set(key, curve); setCurveTick(t => t + 1); } };
      session.current = s; shown.current = '';
      setStatus('ready');   // 先出「不疊線」的版本，線稿模型在背景跑
      // 線稿模型跑完才開始出點陣（不先出暫時的版本）；模型失敗就直接出「不疊線」的版本，不會一直轉圈
      s.prepare().then(() => { if (session.current === s) { shown.current = ''; setModelReady(true); } })
        .catch(e => { console.error('dot art model', e); if (session.current === s) setModelReady(true); });
    } catch (e) { console.error('dot art', e); setStatus('error'); }
  }, []);
  useEffect(() => { warmLineArtModel(); if (initialFiles[0]) open(initialFiles[0]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* 即時重算：同一時間只算一張，拖動中來的新值等這張算完直接算最新的（中間的跳過） */
  const settings: DotArtSettings = {
    width: widthOf(raw[kind].width), threshold: snap('threshold', raw[kind].threshold),
    lines: snap('lines', raw[kind].lines), thicken: DOT_ART_DEFAULTS.thicken,
  };
  const want = `${kind}|${settings.width}|${settings.threshold}|${settings.lines}|${modelReady}`;
  const otherKind: Kind = kind === 'line' ? 'shade' : 'line';
  const otherSettings: DotArtSettings = {
    width: widthOf(raw[otherKind].width), threshold: snap('threshold', raw[otherKind].threshold),
    lines: snap('lines', raw[otherKind].lines), thicken: DOT_ART_DEFAULTS.thicken,
  };
  const wantRef = useRef({ key: want, kind, settings, otherKind, otherSettings });
  wantRef.current = { key: want, kind, settings, otherKind, otherSettings };
  const [editKey, setEditKey] = useState('');
  /** 明暗對照表：每個「線稿／陰影＋輪廓」一份（換照片時清掉） */
  const curves = useRef(new Map<string, Float32Array>());
  const [, setCurveTick] = useState(0);
  /** 拖明暗時滑桿停在手指的位置（不從換算回來的值反推，免得滑桿抖） */
  const thrPos = useRef<{ key: string; t: number; p: number } | null>(null);
  const pump = useCallback(async () => {
    const s = session.current;
    if (!s || busy.current) return;
    busy.current = true;
    try {
      while (shown.current !== wantRef.current.key) {
        const job = wantRef.current;
        const r = await s.renderWithCurve(job.kind, job.settings);
        if (session.current !== s) return;
        shown.current = job.key;
        setFrame(r.frame); setEditKey(`${job.kind}|${job.settings.width}`); setRendered(true);
        await new Promise(r => requestAnimationFrame(() => r(null)));
      }
    } finally { busy.current = false; }
    /* 停下來 0.4 秒後，先把另一種（線稿／陰影）照它目前的設定算好：切過去時直接拿現成的 */
    clearTimeout(prewarmTimer.current);
    prewarmTimer.current = window.setTimeout(async () => {
      const s2 = session.current, j = wantRef.current;
      if (!s2 || s2 !== s || busy.current || shown.current !== j.key) return;
      busy.current = true;
      try { await s2.renderWithCurve(j.otherKind, j.otherSettings, true); } catch { /* 只是預先算，失敗就等真的切過去再算 */ }
      finally { busy.current = false; }
      if (session.current === s2 && shown.current !== wantRef.current.key) pumpRef.current();
    }, 400);
  }, []);
  const prewarmTimer = useRef(0);
  const pumpRef = useRef(pump); pumpRef.current = pump;
  useEffect(() => () => clearTimeout(prewarmTimer.current), []);
  /* 切線稿／陰影：先讓按鈕亮起來（畫面先更新一次），再開始算，按下去不會頓一下 */
  const lastKind = useRef(kind);
  useEffect(() => {
    if (!(status === 'ready' && modelReady)) return;
    if (lastKind.current === kind) { pump(); return; }
    lastKind.current = kind;
    let t = 0;
    const r = requestAnimationFrame(() => { t = window.setTimeout(pump, 0); });
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [want, status, modelReady, pump]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* 算出來的點陣（含反轉）＋手畫的點＝畫面上的點陣 */
  const baseBits = useMemo(() => (frame ? textToBits(frame, inverted) : null), [frame, inverted]);
  const bits = useMemo(() => {
    if (!baseBits) return null;
    const m = edits.current.get(editKey);
    if (!m || m.length !== baseBits.d.length) return { ...baseBits, d: baseBits.d.slice() };
    const d = baseBits.d.slice();
    for (let i = 0; i < d.length; i++) if (m[i]) d[i] = m[i] === 1 ? 1 : 0;
    return { W: baseBits.W, H: baseBits.H, d };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseBits, editKey, histTick]);
  const bitsRef = useRef(bits); bitsRef.current = bits;
  const out = useMemo(() => (bits ? bitsToText(bits) : null), [bits]);
  const finalText = out?.text ?? null;

  /* 成品直接畫點（不靠字型），任何裝置看起來都一樣。
     框固定是「整張照片的點陣」那麼大，拖滑桿時畫面不會跳、不會變比例 */
  const box = useRef<HTMLDivElement>(null), cvs = useRef<HTMLCanvasElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const b = box.current; if (!b) return;
    const upd = () => setBoxSize({ w: b.clientWidth, h: b.clientHeight });
    upd(); const ro = new ResizeObserver(upd); ro.observe(b); return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => (bits ? layoutFor(bits.W, bits.H, gx, gy) : null), [bits?.W, bits?.H, gx, gy]);   // eslint-disable-line react-hooks/exhaustive-deps
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const geom = useRef({ cw: 1, ch: CH, C: 0, R: 0, dpr: 1 });
  /* 發光那一層：放在點的後面，大小比點陣多出一圈（光暈會超出最外面的點） */
  const glowCvs = useRef<HTMLCanvasElement>(null), glowPool = useRef<GlowPool>([]);
  const paintGlow = useCallback(() => {
    const c = cvs.current, o = glowCvs.current;
    if (!c || !o) return;
    if (!glowOnRef.current || !c.width || !c.height) { if (o.width) { o.width = o.height = 0; } return; }
    const { cw, dpr } = geom.current, L = glowLayer(c, cw * dpr, glowPool.current);
    if (o.width !== L.c.width || o.height !== L.c.height) { o.width = L.c.width; o.height = L.c.height; }
    const g = ctxOf(o); g.clearRect(0, 0, o.width, o.height); g.drawImage(L.c, 0, 0);
    o.style.left = `${-L.pad / dpr}px`; o.style.top = `${-L.pad / dpr}px`;
    o.style.width = `${L.W0 / dpr}px`; o.style.height = `${L.H0 / dpr}px`;
  }, []);
  const paint = useCallback((b: Bits | null, L: Layout | null) => {
    const c = cvs.current; if (!c) return;
    if (!b || !L || !boxSize.w || !boxSize.h) { c.width = c.height = 0; return; }
    const C = b.W / 2, R = b.H / 4;
    const cw = Math.min((boxSize.w - 32) / C, (boxSize.h - 16 - BOTTOM_ROW) / (R * CH)), ch = cw * CH;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    geom.current = { cw, ch, C, R, dpr };
    const W = C * cw, H = R * ch;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.beginPath();
    drawDots(g, b, L, cw, ch, 0, 0);
    g.fill();
    paintGlow();
  }, [boxSize, paintGlow]);
  useLayoutEffect(() => { paint(bits, layout); }, [bits, layout, paint]);
  /* 發光從 0 拉起來時才建那一層（之後拖滑桿只改透明度）；拉回 0 就放掉 */
  useLayoutEffect(() => { paintGlow(); if (!glowOn) glowPool.current.forEach(c => { c.width = c.height = 0; }); }, [glowOn, paintGlow]);
  useEffect(() => () => { glowPool.current.forEach(c => { c.width = c.height = 0; }); }, []);

  /* ── 畫筆：只改點陣、只重畫改到的格子（每一下都重排整張字、重畫整張，在手機上會卡到分頁被關掉） ── */
  const drawing = tool === 'draw' || tool === 'erase';
  const stroke = useRef<{ last: [number, number] | null; changed: Map<number, number>; dirty: Set<number>; raf: number } | null>(null);
  const flush = () => {
    const s = stroke.current, c = cvs.current, b = bitsRef.current, L = layoutRef.current;
    if (!s || !c || !b || !L) return;
    s.raf = 0;
    const { cw, ch, dpr } = geom.current;
    /* 只擦、只畫改到的點：擦的範圍比點大一點（含反鋸齒的邊），但碰不到隔壁的點 */
    const sz = Math.max(0.6, cw * DOT), room = Math.min(L.x.minStep * cw, L.y.minStep * ch) - sz;
    const h = sz / 2 + Math.max(0, Math.min(1.5 / dpr + 0.5, room * 0.45));
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#fff'; g.beginPath();
    s.dirty.forEach(i => {
      const x = i % b.W, y = (i - x) / b.W, cx = L.x.pos[x] * cw, cy = L.y.pos[y] * ch;
      g.clearRect(cx - h, cy - h, 2 * h, 2 * h);
      if (b.d[i]) g.rect(cx - sz / 2, cy - sz / 2, sz, sz);
    });
    g.fill(); s.dirty.clear();
    paintGlow();
  };
  const dab = (px: number, py: number) => {
    const s = stroke.current, b = bitsRef.current;
    if (!s || !b) return;
    let m = edits.current.get(editKey);
    if (!m || m.length !== b.d.length) { m = new Uint8Array(b.d.length); edits.current.set(editKey, m); }
    const rad = Math.max(0.5, Math.round(brush) - 0.5), v = tool === 'draw' ? 1 : 2;
    for (let y = Math.floor(py - rad); y <= Math.ceil(py + rad); y++) for (let x = Math.floor(px - rad); x <= Math.ceil(px + rad); x++) {
      if (x < 0 || y < 0 || x >= b.W || y >= b.H) continue;
      if (Math.hypot(x + 0.5 - px, y + 0.5 - py) > rad) continue;
      const i = y * b.W + x;
      if (m[i] === v) continue;
      if (!s.changed.has(i)) s.changed.set(i, m[i]);
      m[i] = v; b.d[i] = v === 1 ? 1 : 0;
      s.dirty.add(i);
    }
  };
  const toDot = (ev: React.PointerEvent): [number, number] => {
    const r = cvs.current!.getBoundingClientRect(), gm = geom.current, L = layoutRef.current;
    if (!L) return [NaN, NaN];
    return [toAxis((ev.clientX - r.left) / gm.cw, L.x.pos), toAxis((ev.clientY - r.top) / gm.ch, L.y.pos)];
  };
  const onMove = (ev: React.PointerEvent) => {
    const s = stroke.current; if (!s) return;
    const [x, y] = toDot(ev);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (s.last) {   // 兩次事件之間補點，快速劃過也是連續的線
      const [lx, ly] = s.last, n = Math.min(400, Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / 0.5)));
      for (let i = 1; i <= n; i++) dab(lx + (x - lx) * i / n, ly + (y - ly) * i / n);
    } else dab(x, y);
    s.last = [x, y];
    if (s.dirty.size && !s.raf) s.raf = requestAnimationFrame(flush);
  };
  const onDown = (ev: React.PointerEvent) => {
    if (!drawing || !bits || stroke.current) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    stroke.current = { last: null, changed: new Map(), dirty: new Set(), raf: 0 };
    onMove(ev);
  };
  const onUp = () => {
    const s = stroke.current; if (!s) return;
    if (s.raf) cancelAnimationFrame(s.raf);
    flush(); stroke.current = null;
    if (s.changed.size) {
      const m = edits.current.get(editKey)!, idx = [...s.changed.keys()];
      undoStack.current.push({ key: editKey, idx, before: idx.map(i => s.changed.get(i)!), after: idx.map(i => m[i]) });
      if (undoStack.current.length > 300) undoStack.current.shift();
      redoStack.current = [];
    }
    setHistTick(t => t + 1);
  };
  const travel = (from: typeof undoStack, to: typeof undoStack, redo: boolean) => {
    const step = from.current.pop(); if (!step) return;
    const m = edits.current.get(step.key);
    if (m) step.idx.forEach((i, j) => { m[i] = redo ? step.after[j] : step.before[j]; });
    to.current.push(step);
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

  /* ── 儲存成圖片：同樣的點、同樣的排法，畫成高解析 PNG（無損） ── */
  const [exportUrl, setExportUrl] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);
  const save = async () => {
    const b = bits, o = out, L = layout;
    if (!b || !o || !L || saving) return;
    setSaving(true);
    try {
      // 只存有點的範圍（跟複製的文字同一塊），四周各留一個字寬的黑邊（有發光時留三個字寬，光暈才不會被切掉）
      const x0 = o.x0 * 2, x1 = (o.x0 + o.cols) * 2, y0 = o.y0 * 4, y1 = (o.y0 + o.rows) * 4;
      const spanX = L.x.pos[x1 - 1] - L.x.pos[x0], spanY = L.y.pos[y1 - 1] - L.y.pos[y0];
      const M = glowOn ? 3 : 1;
      const cw = Math.max(4, Math.min(32, 4096 / (spanX + 2 * M), 4096 / (spanY * CH + 2 * M))), ch = cw * CH;
      const c = document.createElement('canvas');
      c.width = Math.round(spanX * cw + 2 * M * cw); c.height = Math.round(spanY * ch + 2 * M * cw);
      /* 點先畫在透明的一層（發光要從這層算），再疊到黑底上：黑底 → 光暈 → 點 */
      const dots = document.createElement('canvas'); dots.width = c.width; dots.height = c.height;
      const gd = dots.getContext('2d')!;
      gd.fillStyle = '#fff'; gd.beginPath();
      drawDots(gd, b, L, cw, ch, M * cw - L.x.pos[x0] * cw, M * cw - L.y.pos[y0] * ch, x0, y0, x1, y1);
      gd.fill();
      const g = c.getContext('2d')!;
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      if (glowOn) {
        const pool: GlowPool = [], G = glowLayer(dots, cw, pool);
        g.globalAlpha = Math.min(1, glow / 100); g.imageSmoothingEnabled = true;
        g.drawImage(G.c, -G.pad, -G.pad, G.W0, G.H0);
        g.globalAlpha = 1;
        pool.forEach(x => { x.width = x.height = 0; });
      }
      g.drawImage(dots, 0, 0); dots.width = dots.height = 0;
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
      c.width = c.height = 0;
      if (blob) setExportUrl(URL.createObjectURL(blob));
    } finally { setSaving(false); }
  };

  const cur = TOOLS.find(t => t.id === tool) || TOOLS[0];
  const isBrush = cur.id === 'draw' || cur.id === 'erase';
  const curveKey = `${kind}|${settings.lines}|${settings.width}`, curve = curves.current.get(curveKey) ?? null;
  const thrNow = raw[kind].threshold;
  const thrSlider = thrPos.current && thrPos.current.key === curveKey && thrPos.current.t === thrNow ? thrPos.current.p : posOfT(curve, thrNow);
  const value = isBrush ? brush : cur.id === 'spacing' ? 0 : cur.id === 'glow' ? glow : cur.id === 'threshold' ? thrSlider : raw[kind][cur.id as keyof DotArtSettings];
  const setValue = (v: number) => {
    if (isBrush) setBrush(v);
    else if (cur.id === 'glow') setGlow(v);
    else if (cur.id === 'threshold') {
      const t = Math.max(0.01, Math.min(0.99, snap('threshold', tOfPos(curve, v))));
      thrPos.current = { key: curveKey, t, p: v };
      setRaw(r => ({ ...r, [kind]: { ...r[kind], threshold: t } }));
    }
    else setRaw(r => ({ ...r, [kind]: { ...r[kind], [cur.id]: v } }));
  };
  /* 一列滑桿：名稱｜滑桿｜數值（跟美顏同一款） */
  const sliderRow = (label: string, min: number, max: number, v: number, shown: string, set: (v: number) => void) => (
    <div className="flex items-center gap-3 h-6" key={label}>
      <span className="text-[10px] font-bold tracking-[0.15em] text-white/40 w-12 shrink-0">{label}</span>
      <div className="slider-wrap flex-1" style={{ height: 16 }}>
        <input type="range" aria-label={label} min={min} max={max} step="any" value={v}
          onChange={e => set(Number(e.target.value))} className="premium-slider w-full" />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-white/80 w-8 text-right shrink-0">{shown}</span>
    </div>
  );

  return (
    <div ref={viewport.ref} data-dot-art-studio
      className={`safe-top relative w-full h-[100dvh] bg-[#080808] z-[60] flex flex-col font-sans text-white overflow-hidden select-none ${viewport.standalone ? 'standalone-tool-viewport' : ''}`}>
      <style>{standaloneToolViewportCSS}</style>
      <header className="h-14 relative flex items-center justify-between px-4 shrink-0 bg-black/40 backdrop-blur-xl z-20">
        <div className="w-28">
          <button aria-label="返回" onClick={onClose} className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90"><ChevronLeft size={22} /></button>
        </div>
        <div className="flex items-center gap-4" data-hist={histTick}>
          <button aria-label="復原" title="復原" onClick={() => travel(undoStack, redoStack, false)} disabled={!undoStack.current.length}
            className={`p-2 transition-all ${undoStack.current.length ? 'opacity-100 active:scale-90' : 'opacity-20 pointer-events-none'}`}><Icon name="undo" className="text-xl" /></button>
          <button aria-label="重做" title="重做" onClick={() => travel(redoStack, undoStack, true)} disabled={!redoStack.current.length}
            className={`p-2 transition-all ${redoStack.current.length ? 'opacity-100 active:scale-90' : 'opacity-20 pointer-events-none'}`}><Icon name="redo" className="text-xl" /></button>
        </div>
        <div className="w-28 flex items-center justify-end gap-1 shrink-0">
          {/* 複製文字：只有圖示，按下後換成打勾 */}
          <button aria-label={copied ? '已複製' : '複製'} onClick={copy} disabled={!finalText}
            className="p-2 text-white active:scale-90 transition-transform disabled:opacity-30">
            {copied ? <Check size={19} strokeWidth={2.4} /> : <Copy size={19} strokeWidth={2} />}
          </button>
          <button onClick={save} disabled={!finalText}
            className="bg-white text-black px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg active:scale-95 transition-transform whitespace-nowrap disabled:opacity-30">
            儲存
          </button>
        </div>
      </header>
      <input ref={input} hidden type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />

      {/* 成品：黑底白點；筆刷／擦除時手指直接在上面畫 */}
      <div ref={box} className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-black" style={{ paddingBottom: BOTTOM_ROW - 16 }}>
        {status === 'error' && <p className="absolute text-[12px] text-white/60">無法處理這張照片</p>}
        <div className={`relative ${status === 'ready' && rendered && bits ? '' : 'hidden'}`}>
          <canvas ref={glowCvs} data-dot-art-glow aria-hidden className="absolute pointer-events-none"
            style={{ opacity: Math.min(1, glow / 100), display: glowOn ? 'block' : 'none' }} />
          <canvas ref={cvs} data-dot-art-canvas className="relative block"
            style={{ touchAction: drawing ? 'none' : 'auto' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>
        {rendered && finalText && <pre data-dot-art-text hidden>{finalText}</pre>}
        {status === 'ready' && rendered && !frame && <p className="absolute text-[12px] text-white/50">畫面全空白，調一下明暗</p>}
        {/* 生成中：只有正中間一個轉圈（跟仿色同一款），完整的點陣出來之前不顯示任何點 */}
        {(status === 'loading' || (status === 'ready' && !rendered)) && (
          <div data-dot-art-refining className="absolute inset-0 flex items-center justify-center pointer-events-none" role="status" aria-label="生成中">
            <BusySpinner text={status === 'ready' && modelReady ? '正在生成點陣圖' : '正在偵測輪廓'} />
          </div>
        )}
        {/* 左下：目前的照片，點一下換一張；右下：反轉 */}
        <button aria-label="換一張照片" onClick={() => input.current?.click()}
          className="absolute left-4 bottom-3 w-11 h-11 rounded-xl overflow-hidden bg-white/10 active:scale-95">
          {photo && <img src={photo} alt="" className="w-full h-full object-cover" />}
          <span className="absolute right-0.5 bottom-0.5 w-4 h-4 rounded-full bg-white text-black flex items-center justify-center"><Plus size={11} strokeWidth={3} /></span>
        </button>
        {/* 反轉：跟創意拼圖的隨機圖案鍵同一款，只有圖示 */}
        <button aria-label="反轉" aria-pressed={inverted} onClick={() => setInverted(v => !v)}
          className="absolute right-2 bottom-1 p-3 bg-transparent border-0 text-white active:scale-90 transition-transform flex items-center justify-center select-none"
          style={{ filter: 'drop-shadow(0 1px 0.5px rgba(0,0,0,.5))' }}>
          <Glyph k="invert" size={24} />
        </button>
        {/* 線稿／陰影：懸空在預覽下緣中間，跟左下的照片同一排 */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 h-11 flex items-center gap-2">
          {(['line', 'shade'] as const).map(k => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`px-3.5 py-1 rounded-full text-[11px] shrink-0 border transition-all active:scale-95 ${kind === k ? 'bg-white text-black border-white font-bold' : 'bg-black/40 text-white/60 border-white/15 backdrop-blur-md'}`}>
              {k === 'line' ? '線稿' : '陰影'}
            </button>
          ))}
        </div>
      </div>

      {/* 滑桿區：只放滑桿（間距有橫向、直向兩根），高度固定，切工具時圖片不會跳 */}
      <div className="h-[84px] shrink-0 border-t border-white/[0.06] px-5 flex flex-col justify-center gap-3" data-dot-art-controls>
        {cur.id === 'spacing' ? (<>
          {sliderRow('橫向', 1, 8, gap.x, String(gx), v => setGap(g => ({ ...g, x: v })))}
          {sliderRow('直向', 1, 8, gap.y, String(gy), v => setGap(g => ({ ...g, y: v })))}
        </>) : sliderRow(isBrush ? '筆刷' : cur.label, cur.min, cur.max, value,
          String(Math.round(value)), setValue)}
      </div>

      {/* 工具列：跟美顏同一款（64px 按鈕列＋12px 底部距離） */}
      <div className="border-t border-white/10 bg-black shrink-0" data-dot-art-toolbar>
        <div className="flex h-16 pb-3 box-content">
          {TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${cur.id === t.id ? 'text-white' : 'text-white/20'}`}>
              <span className="h-5 flex items-center justify-center">{t.glyph}</span>
              <span className="text-[9px] font-black uppercase tracking-[0.15em]">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 儲存預覽：跟藝術效果同一套（存到相簿／繼續編輯） */}
      {exportUrl && (
        <div data-export-screen className="absolute inset-0 z-[110] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label="儲存預覽">
          <ExportActionLift />
          <header className="h-14 shrink-0 px-5 flex items-center bg-black/40 backdrop-blur-xl">
            <button aria-label="返回" onClick={() => setExportUrl('')} className="p-2 -ml-2 text-[#888]"><ChevronLeft size={22} /></button>
          </header>
          <div data-export-media className="flex-1 min-h-0 flex items-center justify-center p-6">
            <img className="allow-callout max-w-[80vw] max-h-[60vh] object-contain rounded" style={{ boxShadow: '0 0 0 1px #ffffff1a' }} src={exportUrl} alt="匯出預覽" />
          </div>
          <footer data-export-actions className="flex flex-col gap-3 px-6 pt-2 pb-6">
            <SaveButton urls={[exportUrl]} />
            <div className="flex gap-4">
              <button onClick={() => setExportUrl('')} className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-sm font-bold">繼續編輯</button>
              <button onClick={() => { setExportUrl(''); input.current?.click(); }} className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-sm font-bold">換一張照片</button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}
