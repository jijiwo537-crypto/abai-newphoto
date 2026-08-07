import { canvasToUrl, revokeUrl } from '../utils/blobUrl';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { addExport } from '../utils/exportHistory';
import { Icon } from './Icon';
import { SaveButton } from './SaveButton';
import {
  Rect, LiquifyMode, LiquifyField,
  BRUSH_REF_WIDTH, DEFAULT_BRUSH, BRUSH_RANGE, LIP_PRESETS,
  healAt, healRect, wrinkleDab, wrinkleRect,
  createLiquifyField, liquifyDab, sampleLiquify, warpRegion, recomputeLiquifyMax,
  hexToRgb, stampAlpha, makeupComposite,
  releaseBuffers,
} from '../utils/beauty/engine';

// 互動時的運算解析度。全解析度即時運算會爆手機記憶體，所以要縮，
// 但固定 1280 在高 DPI 手機上會被放大顯示、預覽看起來就糊。
// 改成跟著螢幕實際需要的像素走（上限 2048），低密度裝置也不會多付代價。
const WORK_MAX = (() => {
  if (typeof window === 'undefined') return 1280;
  const dpr = window.devicePixelRatio || 1;
  const longest = Math.max(window.screen?.width || 0, window.screen?.height || 0, 640);
  return Math.min(2048, Math.max(1280, Math.round(longest * dpr)));
})();
// 輸出解析度。每一筆操作都有記錄，存檔時會在這個解析度重新跑一次，
// 所以畫質不受上面那個互動解析度限制。
// 匯出用原始解析度。上限只是 canvas 的實務安全值，一般照片碰不到。
const EXPORT_MAX = 8192;

// 「快速單點」的判定門檻。距離用畫面像素計算，才不會受縮放倍率影響。
const TAP_MS = 300;
const TAP_PX = 12;

// 修容筆的邊緣硬度。只保留很小的實心核心，其餘一路羽化到邊緣，
// 讓筆觸邊界非常柔和、不會出現看得見的圓形輪廓。
const MAKEUP_HARDNESS = 12;

// 手指要移動超過這個距離（畫面像素）才真的開始畫。
// 雙指縮放時第一根手指總是會先落下，沒有這道門檻就會先畫下一筆、也會閃出筆刷圈。
const DRAG_START_PX = 5;
/** 鬆手後筆刷圈停留的時間 */
const RING_FLASH_MS = 217;

type BeautyTool = 'blemish' | 'wrinkle' | 'liquify' | 'makeup';

interface ToolDef { id: BeautyTool; label: string; icon: string; }
const BEAUTY_TOOLS: ToolDef[] = [
  { id: 'blemish', label: '去痘', icon: 'healing' },
  { id: 'wrinkle', label: '去皺', icon: 'waves' },
  { id: 'liquify', label: '液化', icon: 'gesture' },
  { id: 'makeup',  label: '修容', icon: 'brush' },
];

// 液化的預設。豐胸與大眼都是膨脹，只是預設的筆刷與力度不同。
type LqPreset = 'slim' | 'chest' | 'eye' | 'pucker' | 'restore';
const LIQUIFY_PRESETS: {
  id: LqPreset; label: string; mode: LiquifyMode; brush?: number; force?: number;
}[] = [
  { id: 'slim',    label: '瘦身', mode: 'push',    brush: 100, force: 10 },
  { id: 'chest',   label: '豐胸', mode: 'bloat',   brush: 100, force: 40 },
  { id: 'eye',     label: '大眼', mode: 'bloat',   brush: 40,  force: 20 },
  { id: 'pucker',  label: '收縮', mode: 'pucker',  brush: 100, force: 40 },
  { id: 'restore', label: '還原', mode: 'restore', brush: 100, force: 40 },
];

// 每一筆操作都記錄下來，輸出時在全解析度依序重播。
// 座標一律存工作解析度的像素值，重播時乘上縮放比即可。
type Op =
  | { k: 'heal'; x: number; y: number; r: number }
  | { k: 'wrinkle'; pts: number[]; r: number; amount: number }
  | { k: 'makeup'; pts: number[]; r: number; strength: number; rgb: [number, number, number] }
  | { k: 'liquify'; pts: number[]; r: number; force: number; mode: LiquifyMode };

interface Session {
  W: number; H: number;
  orig: ImageData;
  base: ImageData;
  lq: LiquifyField;
  ops: Op[];
  opsApplied: number;
}

interface BeautyStudioProps {
  imageSrc: string;
  onCancel: () => void;
  onHome: () => void;
  onImportNew: () => void;
  onSendToEditor: (dataUrl: string) => void;
  /** 接續上次：把存下來的操作記錄餵回來（跳出應用再回來用的） */
  initialState?: { ops?: any[] } | null;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * 依序重播操作記錄。撤銷／重做用 k=1 在工作解析度重建，
 * 存檔則用 k>1 在原圖解析度重跑一次，兩者共用同一份邏輯。
 */
function replayOps(
  ops: Op[], count: number, base: ImageData, field: LiquifyField,
  W: number, H: number, k: number,
) {
  let alpha: Float32Array | null = null;
  for (let i = 0; i < count; i++) {
    const op = ops[i];
    if (op.k === 'heal') {
      healAt(base, W, H, op.x * k, op.y * k, op.r * k);
    } else if (op.k === 'wrinkle') {
      for (let j = 0; j < op.pts.length; j += 2) {
        wrinkleDab(base, W, H, op.pts[j] * k, op.pts[j + 1] * k, op.r * k, op.amount);
      }
    } else if (op.k === 'liquify') {
      for (let j = 0; j < op.pts.length; j += 4) {
        liquifyDab(field, op.pts[j] * k, op.pts[j + 1] * k, op.pts[j + 2] * k, op.pts[j + 3] * k,
          op.r * k, op.force, op.mode);
      }
    } else {
      if (!alpha) alpha = new Float32Array(W * H); else alpha.fill(0);
      let u: Rect | null = null;
      for (let j = 0; j < op.pts.length; j += 2) {
        const r = stampAlpha(alpha, W, H, op.pts[j] * k, op.pts[j + 1] * k, op.r * k, MAKEUP_HARDNESS, op.strength);
        if (r) u = unionRect(u, r);
      }
      if (u) makeupComposite(new Uint8ClampedArray(base.data), base.data, W, u, alpha, op.rgb);
    }
  }
}

const unionRect = (a: Rect | null, b: Rect): Rect => {
  if (!a) return { ...b };
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const BeautyStudio: React.FC<BeautyStudioProps> = ({
  imageSrc, onCancel, onHome, onImportNew, onSendToEditor, initialState,
}) => {
  const [tool, setTool] = useState<BeautyTool>('blemish');
  const [brush, setBrush] = useState<Record<string, number>>({ ...DEFAULT_BRUSH });
  // 力度分工具記錄。共用一個值的話，液化套用預設會連帶改掉去皺的力度。
  const [forceMap, setForceMap] = useState<Record<string, number>>({ wrinkle: 70, liquify: 10 });
  const force = forceMap[tool] ?? 70;
  const setForce = (v: number) => setForceMap(m => ({ ...m, [tool]: v }));
  const [lqPreset, setLqPreset] = useState<LqPreset>('slim');
  const lqMode: LiquifyMode = (LIQUIFY_PRESETS.find(x => x.id === lqPreset) || LIQUIFY_PRESETS[0]).mode;
  // 拖曳筆刷滑桿時，在預覽中央顯示實際大小的筆刷圈
  const [sizingBrush, setSizingBrush] = useState(false);
  // 筆刷圈改用 DOM 元素而不是畫在 canvas 上，才不會有鋸齒
  const [ringPos, setRingPos] = useState<{ x: number; y: number } | null>(null);
  const [makeupColor, setMakeupColor] = useState<string>(LIP_PRESETS[0].hex);
  // 往右拖 = 效果更強，所以是濃度而不是透明度（先前方向相反，拖右反而變淡）
  const [intensity, setIntensity] = useState(30);
  const [isLoading, setIsLoading] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [ratio, setRatio] = useState<string | undefined>(undefined);
  const [saveState, setSaveState] = useState<'idle' | 'processing' | 'success'>('idle');
  const [finalImage, setFinalImage] = useState<string | null>(null);
  /* 成品是 blob 網址：重新導出時先回收上一張，離開時也要回收 */
  const finalUrlRef = useRef<string | null>(null);
  /* 離開時晚一點再回收：導出紀錄的縮圖與分享用的檔案都是非同步去讀這個
     網址的，按下儲存後馬上離開的話會來不及讀完。 */
  useEffect(() => () => { const keep = finalUrlRef.current; setTimeout(() => revokeUrl(keep as any), 15000); }, []);
  const [showOriginal, setShowOriginal] = useState(false);

  const viewRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const warpBufRef = useRef<ImageData | null>(null);

  // 指標事件處理器需要最新參數但不該因參數變動而重建，用 ref 鏡射
  const cfg = useRef({ tool, brush, force, lqMode, makeupColor, intensity });
  cfg.current = { tool, brush, force, lqMode, makeupColor, intensity };

  // 去皺與修容都以「整筆」為單位：下筆前存一份像素，結束時才記一次歷史。
  // 這樣每一個筆刷點就不必各自做兩次 ImageData 快照，快速拖動才不會卡。
  const strokeSrcRef = useRef<Uint8ClampedArray | null>(null);
  const strokeAlphaRef = useRef<Float32Array | null>(null);
  const strokeUnionRef = useRef<Rect | null>(null);
  const strokePtsRef = useRef<number[]>([]);

  const paintingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  /** 筆觸最後的螢幕座標。鬆手時的筆刷圈要停在這裡，不是回到起點。 */
  const lastClientRef = useRef<{ cx: number; cy: number } | null>(null);
  const downRef = useRef<{ t: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const movedRef = useRef(0);
  const startedRef = useRef(false);   // 是否已確認為單指操作、真的開筆了
  const lqBeforeRef = useRef<Float32Array | null>(null);
  const ringTimerRef = useRef<number | null>(null);
  // 路徑平滑用：上一個原始取樣點與上一個中點
  const pathPrevRef = useRef<{ x: number; y: number } | null>(null);
  const pathMidRef = useRef<{ x: number; y: number } | null>(null);

  // 多指觸控時不能觸發筆刷，否則使用者想縮放平移卻被畫了一筆
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const strokePointerRef = useRef<number | null>(null);
  // 手勢鎖：雙指縮放期間與結束後，直到所有手指離開為止都不接受筆刷
  const gestureLockRef = useRef(false);

  // 自行實作雙指縮放平移。原本用 react-zoom-pan-pinch，但它靠 touch 事件、
  // 筆刷靠 pointer 事件，兩者會互搶，導致雙指縮放時反而畫下一筆。
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewT, setViewT] = useState({ k: 1, tx: 0, ty: 0 });
  const viewTRef = useRef(viewT);
  viewTRef.current = viewT;
  const pinchRef = useRef<{ d0: number; k0: number; cx: number; cy: number } | null>(null);

  const stageCenter = () => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0, w: 1, h: 1 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };

  const applyView = useCallback((k: number, tx: number, ty: number) => {
    const c = stageCenter();
    const kk = clamp(k, 1, 6);
    // 限制平移範圍，避免把圖拖到畫面外找不回來
    const mx = Math.max(0, (kk - 1) * c.w * 0.5);
    const my = Math.max(0, (kk - 1) * c.h * 0.5);
    setViewT({ k: kk, tx: clamp(tx, -mx, mx), ty: clamp(ty, -my, my) });
  }, []);

  const isTapOnly = useCallback(() => {
    const c = cfg.current;
    return c.tool === 'blemish' || (c.tool === 'liquify' && (c.lqMode === 'bloat' || c.lqMode === 'pucker'));
  }, []);

  const brushRadius = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return 10;
    return Math.max(3, (cfg.current.brush[cfg.current.tool] || 20) * (s.W / BRUSH_REF_WIDTH));
  }, []);

  const render = useCallback((rect?: Rect | null) => {
    const s = sessionRef.current;
    const cv = viewRef.current;
    if (!s || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let x0 = 0, y0 = 0, x1 = s.W, y1 = s.H;
    if (rect) {
      x0 = clamp(Math.floor(rect.x), 0, s.W); y0 = clamp(Math.floor(rect.y), 0, s.H);
      x1 = clamp(Math.ceil(rect.x + rect.w), 0, s.W); y1 = clamp(Math.ceil(rect.y + rect.h), 0, s.H);
    }
    const w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return;

    if (s.lq.max === 0) { ctx.putImageData(s.base, 0, 0, x0, y0, w, h); return; }
    let bufImg = warpBufRef.current;
    if (!bufImg || bufImg.width !== w || bufImg.height !== h) {
      bufImg = ctx.createImageData(w, h);
      warpBufRef.current = bufImg;
    }
    warpRegion(s.base, s.W, s.H, s.lq, bufImg, { x: x0, y: y0, w, h });
    ctx.putImageData(bufImg, x0, y0);
  }, []);

  const renderPixelRect = useCallback((r: Rect) => {
    const s = sessionRef.current!;
    const e = Math.ceil(s.lq.max) + 2;
    render({ x: r.x - e, y: r.y - e, w: r.w + e * 2, h: r.h + e * 2 });
  }, [render]);

  // ---------------------------------------------------------------
  // 歷史紀錄：以操作記錄重播實作
  //
  // 原本存的是像素快照，為了控制記憶體只能保留最近 24 筆，超過就把最舊的
  // 丟掉 —— 結果就是操作一多就再也回不到最初的狀態。改成從原圖重播操作
  // 記錄後，歷史長度不再受限，撤銷到底一定回得到原圖，也不佔任何記憶體。
  // ---------------------------------------------------------------
  const snapFrom = useCallback((src: Uint8ClampedArray, r: Rect): ImageData => {
    const s = sessionRef.current!;
    const out = new ImageData(r.w, r.h);
    for (let y = 0; y < r.h; y++) {
      const si = ((r.y + y) * s.W + r.x) * 4, di = y * r.w * 4;
      for (let x = 0; x < r.w * 4; x++) out.data[di + x] = src[si + x];
    }
    return out;
  }, []);

  const restore = useCallback((r: Rect, id: ImageData) => {
    const s = sessionRef.current!;
    const d = s.base.data;
    for (let y = 0; y < r.h; y++) {
      const di = ((r.y + y) * s.W + r.x) * 4, si = y * r.w * 4;
      for (let x = 0; x < r.w * 4; x++) d[di + x] = id.data[si + x];
    }
  }, []);

  // ---- 跳出應用再回來還在 ----
  // 美顏本來就把每一筆操作記錄下來（輸出時在原圖解析度重播），
  // 所以草稿只要存「原圖 + 操作記錄」，回來重播一次就完全接得回去。
  const draftSrcSavedRef = useRef<string | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveBeautyDraft = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      const first = draftSrcSavedRef.current !== imageSrc;
      draftSrcSavedRef.current = imageSrc;
      const cur = sessionRef.current;
      if (!cur) return;
      saveToolDraft('beauty', first ? imageSrc : null, { ops: cur.ops.slice(0, cur.opsApplied) });
    }, 1000);
  }, [imageSrc]);
  useEffect(() => () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); }, []);

  const syncHist = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    setCanUndo(s.opsApplied > 0);
    setCanRedo(s.opsApplied < s.ops.length);
    saveBeautyDraft();
  }, [saveBeautyDraft]);

  /** 從原圖重跑前 opsApplied 筆操作，重建目前狀態 */
  const rebuild = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    s.base.data.set(s.orig.data);
    s.lq.data.fill(0);
    s.lq.max = 0;
    replayOps(s.ops, s.opsApplied, s.base, s.lq, s.W, s.H, 1);
    render();
  }, [render]);

  const pushOp = useCallback((op: Op) => {
    const s = sessionRef.current!;
    s.ops.length = s.opsApplied;   // 撤銷後又有新動作，就把被撤銷的部分丟掉
    s.ops.push(op);
    s.opsApplied++;
    syncHist();
  }, [syncHist]);

  const undo = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.opsApplied <= 0) return;
    s.opsApplied--;
    rebuild();
    syncHist();
  }, [rebuild, syncHist]);

  const redo = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.opsApplied >= s.ops.length) return;
    s.opsApplied++;
    rebuild();
    syncHist();
  }, [rebuild, syncHist]);

  // ---------------------------------------------------------------
  // 載入
  // ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const sc = Math.min(1, WORK_MAX / Math.max(img.width, img.height));
      const W = Math.max(2, Math.round(img.width * sc));
      const H = Math.max(2, Math.round(img.height * sc));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, W, H);
      const orig = cx.getImageData(0, 0, W, H);

      sessionRef.current = {
        W, H, orig,
        base: new ImageData(new Uint8ClampedArray(orig.data), W, H),
        lq: createLiquifyField(W, H),
        ops: [], opsApplied: 0,
      };

      const view = viewRef.current;
      if (view) { view.width = W; view.height = H; }
      setRatio(`${W}/${H}`);
      setIsLoading(false);
      // 接續上次：操作記錄放回去，從原圖重跑一次就回到上次的樣子
      const saved = initialState?.ops;
      if (Array.isArray(saved) && saved.length) {
        const s2 = sessionRef.current;
        s2.ops = saved as any;
        s2.opsApplied = saved.length;
        replayOps(s2.ops, s2.opsApplied, s2.base, s2.lq, s2.W, s2.H, 1);
        setCanUndo(true);
        setCanRedo(false);
      }
      // 還沒動任何筆刷也要先存一份：跳出去再回來至少照片還在
      saveBeautyDraft();
      requestAnimationFrame(() => render());
    };
    img.onerror = () => { if (!cancelled) setIsLoading(false); };
    img.src = imageSrc;
    return () => { cancelled = true; releaseBuffers(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc]);

  // ---------------------------------------------------------------
  // 疊層：筆刷外框（只清掉上一格的範圍）與放大鏡
  // ---------------------------------------------------------------
  /** 筆刷圈半徑（畫面像素）。用 DOM 元素繪製，任何縮放倍率下都不會有鋸齒。 */
  const ringScreenR = useCallback(() => {
    const s = sessionRef.current, cv = viewRef.current;
    if (!s || !cv) return 0;
    const r = cv.getBoundingClientRect();
    return brushRadius() * (r.width / s.W);
  }, [brushRadius]);

  const drawRing = useCallback((p: { cx: number; cy: number } | null) => {
    setRingPos(p ? { x: p.cx, y: p.cy } : null);
  }, []);

  // ---------------------------------------------------------------
  // 筆觸
  // ---------------------------------------------------------------
  const toBase = useCallback((x: number, y: number): [number, number] => {
    const s = sessionRef.current!;
    if (s.lq.max === 0) return [x, y];
    const o: [number, number] = [0, 0];
    sampleLiquify(s.lq, x, y, o);
    return [x + o[0], y + o[1]];
  }, []);

  const ensureStrokeBuffers = useCallback((needAlpha: boolean) => {
    const s = sessionRef.current!;
    const n = s.W * s.H;
    if (!strokeSrcRef.current || strokeSrcRef.current.length !== n * 4) {
      strokeSrcRef.current = new Uint8ClampedArray(n * 4);
      strokeAlphaRef.current = new Float32Array(n);
    }
    strokeSrcRef.current.set(s.base.data);
    if (needAlpha) strokeAlphaRef.current!.fill(0);
    strokeUnionRef.current = null;
    strokePtsRef.current = [];
  }, []);

  /** 套用一個筆刷點；回傳需要重畫的範圍（由呼叫端彙整後一次重繪） */
  const dab = useCallback((p: { x: number; y: number }, dx: number, dy: number): Rect | null => {
    const s = sessionRef.current;
    if (!s) return null;
    const c = cfg.current;
    const R = brushRadius();

    if (c.tool === 'liquify') {
      liquifyDab(s.lq, p.x, p.y, dx, dy, R, c.force / 100 * 0.9, c.lqMode);
      strokePtsRef.current.push(p.x, p.y, dx, dy);
      const e = Math.ceil(R * 1.3 + s.lq.max + 6);
      return { x: p.x - e, y: p.y - e, w: e * 2, h: e * 2 };
    }

    const [bx, by] = toBase(p.x, p.y);

    if (c.tool === 'makeup') {
      const src = strokeSrcRef.current, alpha = strokeAlphaRef.current;
      if (!src || !alpha) return null;
      const strength = c.intensity / 100;
      const r = stampAlpha(alpha, s.W, s.H, bx, by, R, MAKEUP_HARDNESS, strength);
      if (!r) return null;
      makeupComposite(src, s.base.data, s.W, r, alpha, hexToRgb(c.makeupColor));
      strokePtsRef.current.push(bx, by);
      strokeUnionRef.current = unionRect(strokeUnionRef.current, r);
      return r;
    }

    // 去皺
    const pr = wrinkleRect(s.W, s.H, bx, by, R);
    if (!pr) return null;
    wrinkleDab(s.base, s.W, s.H, bx, by, R, c.force / 100 * 0.55);
    strokePtsRef.current.push(bx, by);
    strokeUnionRef.current = unionRect(strokeUnionRef.current, pr);
    return pr;
  }, [brushRadius, toBase]);

  const localPoint = (e: React.PointerEvent) => {
    const view = viewRef.current!;
    const s = sessionRef.current!;
    const r = view.getBoundingClientRect();   // 已含縮放變形，座標換算自動正確
    return {
      x: (e.clientX - r.left) * (s.W / r.width),
      y: (e.clientY - r.top) * (s.H / r.height),
      cx: e.clientX, cy: e.clientY,
    };
  };

  /** 第二根手指落下 → 使用者想縮放平移，把已經畫下去的部分還原 */
  const cancelStroke = useCallback(() => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    strokePointerRef.current = null;
    const s = sessionRef.current;
    if (!s) return;
    const c = cfg.current;

    if (c.tool === 'liquify' && lqBeforeRef.current) {
      s.lq.data.set(lqBeforeRef.current);
      recomputeLiquifyMax(s.lq);
      render();
    } else if ((c.tool === 'wrinkle' || c.tool === 'makeup') && strokeUnionRef.current && strokeSrcRef.current) {
      const r = strokeUnionRef.current;
      restore(r, snapFrom(strokeSrcRef.current, r));
      renderPixelRect(r);
    }
    lqBeforeRef.current = null;
    strokeUnionRef.current = null;
    strokePtsRef.current = [];
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    drawRing(null);
  }, [drawRing, render, renderPixelRect, restore, snapFrom]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!sessionRef.current || isLoading || saveState !== 'idle') return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size >= 2) {
      // 第二根手指落下 → 進入縮放手勢，把已經畫下去的部分還原
      cancelStroke();
      gestureLockRef.current = true;
      const [a, b] = [...pointersRef.current.values()];
      const c = stageCenter();
      pinchRef.current = {
        d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        k0: viewTRef.current.k,
        // 記錄雙指中心在「內容座標」的位置，縮放時以它為錨點
        cx: ((a.x + b.x) / 2 - c.x - viewTRef.current.tx) / viewTRef.current.k,
        cy: ((a.y + b.y) / 2 - c.y - viewTRef.current.ty) / viewTRef.current.k,
      };
      return;
    }
    if (gestureLockRef.current) return;

    // 指標可能已經失效（手勢中斷、合成事件），失敗不該中斷整個筆觸
    try { (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId); } catch (err) { /* noop */ }
    strokePointerRef.current = e.pointerId;
    paintingRef.current = true;
    const p = localPoint(e);
    lastPtRef.current = p;
    movedRef.current = 0;
    downRef.current = { t: performance.now(), cx: e.clientX, cy: e.clientY, x: p.x, y: p.y };
    lastClientRef.current = { cx: e.clientX, cy: e.clientY };
    // 按下時不顯示筆刷圈也不動像素。雙指縮放的第一根手指一定會先落下，
    // 這時候冒出圈或畫下去都是誤觸。要等確認是單指拖曳（超過門檻），
    // 或是單指放開的瞬間，才顯示。
    startedRef.current = false;
    pathPrevRef.current = null;
    pathMidRef.current = null;
    e.preventDefault();
  };

  /** 確認是單指操作後才真正開筆 */
  const beginStroke = useCallback((p: { x: number; y: number }) => {
    const s = sessionRef.current;
    if (!s || startedRef.current) return;
    startedRef.current = true;
    if (cfg.current.tool === 'liquify') {
      lqBeforeRef.current = s.lq.data.slice();
      strokePtsRef.current = [];
    } else {
      ensureStrokeBuffers(cfg.current.tool === 'makeup');
    }
    const d = downRef.current;
    const r = dab(d ? { x: d.x, y: d.y } : p, 0, 0);
    if (r) renderPixelRect(r);
  }, [dab, ensureStrokeBuffers, renderPixelRect]);

  const handleMove = (e: PointerEvent) => {
    if (!sessionRef.current || isLoading) return;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // 雙指：縮放 + 平移，完全不碰筆刷
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const pin = pinchRef.current;
      const c = stageCenter();
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const k = clamp(pin.k0 * (d / pin.d0), 1, 6);
      const mx = (a.x + b.x) / 2 - c.x;
      const my = (a.y + b.y) / 2 - c.y;
      applyView(k, mx - pin.cx * k, my - pin.cy * k);
      e.preventDefault();
      return;
    }

    if (gestureLockRef.current) return;
    if (paintingRef.current && e.pointerId !== strokePointerRef.current) return;

    const p = localPoint(e);
    if (!paintingRef.current) { if (e.pointerType === 'mouse') drawRing(p); return; }

    // 瀏覽器每幀會把多個原始觸控取樣合併成一個事件，取回全部才畫得順
    const raw = typeof (e as any).getCoalescedEvents === 'function'
      ? ((e as any).getCoalescedEvents() as PointerEvent[]) : [];
    const pts = raw.length ? raw.map(r => localPoint(r as any)) : [p];

    const d = downRef.current;
    if (d) movedRef.current = Math.max(movedRef.current, Math.hypot(e.clientX - d.cx, e.clientY - d.cy));

    // 還沒超過拖曳門檻就什麼都不做，避免雙指縮放的第一根手指誤觸
    if (movedRef.current < DRAG_START_PX) { e.preventDefault(); return; }

    if (!isTapOnly()) {
      if (!startedRef.current) beginStroke(p);
      // 逐點以二次貝茲銜接（中點為錨、原始點為控制點）。直接線性連線的話，
      // 畫弧線會變成一段段折線，轉折處看起來就是鋸齒。
      const R = brushRadius();
      const step = Math.max(1.2, R * (cfg.current.tool === 'liquify' ? 0.18 : 0.22));
      let dirty: Rect | null = null;
      for (const raw of pts) {
        const prev = pathPrevRef.current;
        if (!prev) { pathPrevRef.current = raw; pathMidRef.current = raw; continue; }
        const mid = { x: (prev.x + raw.x) / 2, y: (prev.y + raw.y) / 2 };
        const from = pathMidRef.current || prev;
        const approx = Math.hypot(prev.x - from.x, prev.y - from.y) + Math.hypot(mid.x - prev.x, mid.y - prev.y);
        const n = clamp(Math.ceil(approx / step), 1, 96);
        let prevQ = from;
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          const q = {
            x: u * u * from.x + 2 * u * t * prev.x + t * t * mid.x,
            y: u * u * from.y + 2 * u * t * prev.y + t * t * mid.y,
          };
          const r = dab(q, q.x - prevQ.x, q.y - prevQ.y);
          if (r) dirty = unionRect(dirty, r);
          prevQ = q;
        }
        pathPrevRef.current = raw;
        pathMidRef.current = mid;
      }
      if (dirty) renderPixelRect(dirty);
      lastPtRef.current = p;
    }
    lastClientRef.current = { cx: p.cx, cy: p.cy };
    if (startedRef.current) drawRing(p);
    e.preventDefault();
  };

  // 用 ref 轉接，window 監聽器才不必隨著每次 render 重新掛載
  const handleMoveRef = useRef(handleMove);
  handleMoveRef.current = handleMove;

  const finishStroke = useCallback(() => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    strokePointerRef.current = null;
    const s = sessionRef.current;
    if (!s) return;
    const c = cfg.current;
    const d = downRef.current;
    const R = brushRadius();

    if (isTapOnly()) {
      const quick = d && (performance.now() - d.t) <= TAP_MS && movedRef.current <= TAP_PX;
      if (quick && d) {
        if (c.tool === 'blemish') {
          const [bx, by] = toBase(d.x, d.y);
          const pr = healRect(bx, by, R);
          if (pr.x >= 0 && pr.y >= 0 && pr.x + pr.w <= s.W && pr.y + pr.h <= s.H) {
            if (healAt(s.base, s.W, s.H, bx, by, R)) {
              pushOp({ k: 'heal', x: bx, y: by, r: R });
              renderPixelRect(pr);
            }
          }
        } else {
          const f = c.force / 100 * 0.9;
          liquifyDab(s.lq, d.x, d.y, 0, 0, R, f, c.lqMode);
          const e = Math.ceil(R * 1.3 + s.lq.max + 6);
          render({ x: d.x - e, y: d.y - e, w: e * 2, h: e * 2 });
          pushOp({ k: 'liquify', pts: [d.x, d.y, 0, 0], r: R, force: f, mode: c.lqMode });
        }
      }
    } else if (!startedRef.current && d) {
      // 沒有拖曳、只是點一下：去皺與修容仍應該在該點作用一次
      beginStroke({ x: d.x, y: d.y });
    }

    // 中點平滑會讓筆觸停在最後一段的中點，收筆時要把剩下那半段補完，
    // 否則手指抬起處會少畫一截。
    if (!isTapOnly() && startedRef.current && pathPrevRef.current && pathMidRef.current) {
      const from = pathMidRef.current, to = pathPrevRef.current;
      const step = Math.max(1.2, R * (c.tool === 'liquify' ? 0.18 : 0.22));
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      const n = clamp(Math.ceil(len / step), 1, 96);
      let dirty: Rect | null = null;
      let prevQ = from;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const q = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        const r = dab(q, q.x - prevQ.x, q.y - prevQ.y);
        if (r) dirty = unionRect(dirty, r);
        prevQ = q;
      }
      if (dirty) renderPixelRect(dirty);
    }
    pathPrevRef.current = null;
    pathMidRef.current = null;

    if (c.tool === 'liquify' && !isTapOnly()) {
      if (strokePtsRef.current.length) {
        pushOp({ k: 'liquify', pts: strokePtsRef.current.slice(), r: R, force: c.force / 100 * 0.9, mode: c.lqMode });
      }
      lqBeforeRef.current = null;
    } else if (strokePtsRef.current.length) {
      pushOp(c.tool === 'makeup'
        ? { k: 'makeup', pts: strokePtsRef.current.slice(), r: R, strength: c.intensity / 100, rgb: hexToRgb(c.makeupColor) }
        : { k: 'wrinkle', pts: strokePtsRef.current.slice(), r: R, amount: c.force / 100 * 0.55 });
    }

    strokeUnionRef.current = null;
    strokePtsRef.current = [];
    // 鬆手的瞬間讓筆刷圈顯示一下，使用者才看得到自己剛剛作用的範圍與大小。
    // 雙指縮放走的是 cancelStroke，不會經過這裡，所以不會誤閃。
    //
    // 點擊與拖曳要分開處理：點擊時圈就停在點下去的位置；拖曳時必須停在
    // 收筆處，先前一律用按下的座標，圈才會整個彈回起點。
    // 只有「點一下」才需要閃現筆刷圈告訴使用者作用範圍；拖曳的話使用者
    // 全程都看得到圈跟著手指走，鬆手就該直接收掉。
    const wasTap = !!d && (performance.now() - d.t) <= TAP_MS && movedRef.current <= TAP_PX;
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    if (wasTap && d) {
      drawRing({ cx: d.cx, cy: d.cy });
      ringTimerRef.current = window.setTimeout(() => drawRing(null), RING_FLASH_MS);
    } else {
      drawRing(null);
    }
    downRef.current = null;
    lastClientRef.current = null;
  }, [beginStroke, brushRadius, dab, drawRing, isTapOnly, pushOp, render, renderPixelRect, toBase]);

  useEffect(() => {
    const move = (e: PointerEvent) => handleMoveRef.current(e);
    const up = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      // 所有手指都離開才解鎖，否則放開一根手指會馬上變成畫筆
      if (pointersRef.current.size === 0) gestureLockRef.current = false;
      if (strokePointerRef.current === null) return;
      if (e.pointerId === strokePointerRef.current) finishStroke();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [finishStroke]);

  // ---------------------------------------------------------------
  // 原圖對比
  // ---------------------------------------------------------------
  useEffect(() => {
    const s = sessionRef.current, cv = viewRef.current;
    if (!s || !cv || isLoading) return;
    if (showOriginal) cv.getContext('2d')!.putImageData(s.orig, 0, 0);
    else render();
  }, [showOriginal, isLoading, render]);

  // ---------------------------------------------------------------
  // 全解析度輸出：把記錄下來的每一筆操作，在原圖解析度重跑一次
  // ---------------------------------------------------------------
  const exportFullRes = useCallback(async (): Promise<string | null> => {
    const s = sessionRef.current;
    const cv = viewRef.current;
    if (!s || !cv) return null;

    const img = await new Promise<HTMLImageElement | null>((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = imageSrc;
    });
    // 讀不到原圖就退回工作解析度，至少不會失敗
    if (!img) return canvasToUrl(cv);

    const sc = Math.min(1, EXPORT_MAX / Math.max(img.width, img.height));
    const FW = Math.max(2, Math.round(img.width * sc));
    const FH = Math.max(2, Math.round(img.height * sc));
    if (FW <= s.W) return canvasToUrl(cv);   // 原圖本來就不大

    const c = document.createElement('canvas');
    c.width = FW; c.height = FH;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, FW, FH);
    const base = ctx.getImageData(0, 0, FW, FH);
    const k = FW / s.W;

    const field = createLiquifyField(FW, FH);
    replayOps(s.ops, s.opsApplied, base, field, FW, FH, k);

    if (field.max > 0) {
      const out = ctx.createImageData(FW, FH);
      warpRegion(base, FW, FH, field, out, { x: 0, y: 0, w: FW, h: FH });
      ctx.putImageData(out, 0, 0);
    } else {
      ctx.putImageData(base, 0, 0);
    }
    return canvasToUrl(c);
  }, [imageSrc]);

  const handleSave = () => {
    if (!sessionRef.current) return;
    setShowOriginal(false);
    setSaveState('processing');
    setTimeout(async () => {
      const url = await exportFullRes();
      if (url) {
        revokeUrl(finalUrlRef.current);
        finalUrlRef.current = url;
        setFinalImage(url);
        setSaveState('success');
        // 首頁的「最近輸出」：記下成品縮圖＋這張圖導出當下的原圖與筆觸
        const cur = sessionRef.current;
        addExport('beauty', url, imageSrc, cur ? { ops: cur.ops.slice(0, cur.opsApplied) } : null);
      }
      else setSaveState('idle');
    }, 40);
  };


  const sliderRow = (label: string, value: number, min: number, max: number, onChange: (v: number) => void) => (
    <div className="flex items-center gap-3 h-6">
      <span className="text-[10px] font-bold tracking-[0.15em] text-white/40 w-12 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(ev) => onChange(Number(ev.target.value))}
        onPointerDown={label === '筆刷' ? () => setSizingBrush(true) : undefined}
        onPointerUp={label === '筆刷' ? () => setSizingBrush(false) : undefined}
        onPointerCancel={label === '筆刷' ? () => setSizingBrush(false) : undefined}
        onBlur={label === '筆刷' ? () => setSizingBrush(false) : undefined}
        aria-label={label}
        className="flex-1 beauty-range"
      />
      <span className="text-[11px] font-mono tabular-nums text-white/80 w-8 text-right shrink-0">{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-[#080808] z-[60] flex flex-col animate-in slide-in-from-right duration-300 font-sans text-white overflow-hidden beauty-root">
      <style>{`
        .beauty-root {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
        }
        .beauty-root .allow-callout {
            -webkit-touch-callout: default !important;
            -webkit-user-select: auto !important;
            user-select: auto !important;
            pointer-events: auto !important;
        }
        .beauty-range {
            -webkit-appearance: none;
            appearance: none;
            height: 22px;
            background: transparent;
            cursor: pointer;
        }
        .beauty-range::-webkit-slider-runnable-track {
            height: 2px; background: rgba(255,255,255,.2); border-radius: 2px;
        }
        .beauty-range::-moz-range-track {
            height: 2px; background: rgba(255,255,255,.2); border-radius: 2px;
        }
        .beauty-range::-webkit-slider-thumb {
            -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
            background: #fff; margin-top: -7px; box-shadow: 0 1px 5px rgba(0,0,0,.6);
        }
        .beauty-range::-moz-range-thumb {
            width: 16px; height: 16px; border: 0; border-radius: 50%; background: #fff;
        }
      `}</style>

      {isLoading && (
        <div className="absolute inset-0 z-[120] flex items-center justify-center bg-[#080808]/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4 text-white">
            <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
            <p className="text-[10px] font-black tracking-[0.2em] uppercase animate-pulse opacity-70">解析中...</p>
          </div>
        </div>
      )}

      {saveState === 'success' && finalImage && (
        <div className="absolute inset-0 z-[110] bg-black flex flex-col animate-in fade-in duration-500">
          <header className="h-14 flex items-center px-5 shrink-0 z-20 bg-black/40 backdrop-blur-xl">
            <button
              onClick={() => onHome()}
              className="p-2 -ml-2 text-[#888] hover:text-white transition-colors active:scale-90"
            >
              <Icon name="chevron_left" className="text-2xl" />
            </button>
          </header>
          <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
            <div className="relative shadow-2xl overflow-hidden max-h-[52vh] max-w-full mb-4">
              <img src={finalImage} alt="美顏結果" className="max-w-full max-h-[52vh] object-contain allow-callout relative z-10" />
              <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10"></div>
            </div>
          </div>
          <div className="flex flex-col gap-3 px-6 pb-8">
            <SaveButton urls={finalImage ? [finalImage] : []} />
            <button
              onClick={() => onSendToEditor(finalImage)}
              className="h-12 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-xs"
            >
              接著調色
            </button>
            <div className="flex gap-3">
            <button
              onClick={() => setSaveState('idle')}
              className="flex-1 h-12 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-xs"
            >
              繼續編輯
            </button>
            <button
              onClick={() => onImportNew()}
              className="flex-1 h-12 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-xs"
            >
              修下一張
            </button>
            </div>
          </div>
        </div>
      )}

      {saveState !== 'success' && (
        <header className="h-14 relative flex items-center justify-between px-4 shrink-0 bg-black/40 backdrop-blur-xl z-20">
          <div className="w-24">
            <button onClick={onCancel} className="p-2 -ml-2 text-white/40 hover:text-white transition-colors">
              <Icon name="close" className="text-2xl" />
            </button>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={undo} disabled={!canUndo}
              className={`p-2 transition-all ${!canUndo ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}
              title="復原">
              <Icon name="undo" className="text-xl" />
            </button>
            <button onClick={redo} disabled={!canRedo}
              className={`p-2 transition-all ${!canRedo ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}
              title="重做">
              <Icon name="redo" className="text-xl" />
            </button>
          </div>
          <div className="w-24 flex justify-end shrink-0">
            <button onClick={handleSave}
              className="bg-white text-black px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg active:scale-95 transition-transform whitespace-nowrap">
              儲存
            </button>
          </div>
        </header>
      )}

      {/* 畫布。單指在畫布上是繪製，雙指縮放平移。 */}
      <div
        ref={stageRef}
        className="flex-1 relative bg-[#080808] min-h-0 overflow-hidden"
        style={{ touchAction: 'none' }}
        onWheel={(e) => {
          const c = stageCenter();
          const v = viewTRef.current;
          const k = clamp(v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1, 6);
          const ax = e.clientX - c.x, ay = e.clientY - c.y;
          const cx = (ax - v.tx) / v.k, cy = (ay - v.ty) / v.k;
          applyView(k, ax - cx * k, ay - cy * k);
        }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center p-4"
          style={{ transform: `translate(${viewT.tx}px, ${viewT.ty}px) scale(${viewT.k})` }}
        >
          <div
            className="relative flex items-center justify-center max-w-full max-h-full"
            style={{ aspectRatio: ratio, touchAction: 'none' }}
          >
            <canvas
              ref={viewRef}
              className="beauty-paint max-w-full max-h-full object-contain rounded-sm block"
              style={{ touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerLeave={(e) => {
                // 只有滑鼠移出去才收掉筆刷圈。觸控在 pointerup 之後會緊接著送出
                // pointerleave，先前會把鬆手那一下的閃現整個吃掉。
                if (e.pointerType === 'mouse' && !paintingRef.current) drawRing(null);
              }}
            />
          </div>
        </div>




        {/* 筆刷圈。用 DOM 畫，任何縮放倍率下邊緣都是平滑的，不會有鋸齒。
            調整筆刷大小時固定顯示在預覽中央，即時呈現實際大小。 */}
        {(ringPos || sizingBrush) ? (
          <div
            data-brush-ring="1"
            className="absolute pointer-events-none z-20 rounded-full border-2 border-white"
            style={(() => {
              const R = ringScreenR();
              const st = stageRef.current?.getBoundingClientRect();
              let cx: number, cy: number;
              // 放大／平移之後圖片中心可能已經跑到畫面外，所以對齊的是
              // 「看得到的預覽區」正中央，不管怎麼縮放都一定看得到。
              if (sizingBrush && st) { cx = st.width / 2; cy = st.height / 2; }
              else if (ringPos && st) { cx = ringPos.x - st.left; cy = ringPos.y - st.top; }
              else { cx = -9999; cy = -9999; }
              return { left: cx - R, top: cy - R, width: R * 2, height: R * 2 };
            })()}
          />
        ) : null}

        <button
          onPointerDown={(e) => { e.preventDefault(); setShowOriginal(true); }}
          onPointerUp={(e) => {
            try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
            setShowOriginal(false);
          }}
          onPointerCancel={() => setShowOriginal(false)}
          className={`absolute bottom-2 right-2 p-3 flex items-center justify-center select-none touch-none transition-all active:scale-90 z-20 ${showOriginal ? 'text-white' : 'text-white/40'}`}
          title="按住看原圖"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            <path d="M12 6H4.5C3.67157 6 3 6.67157 3 7.5V16.5C3 17.3284 3.67157 18 4.5 18H12" stroke="white" strokeWidth="1.5" />
            <line x1="12" y1="3" x2="12" y2="21" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12 6H19.5C20.3284 6 21 6.67157 21 7.5V16.5C21 17.3284 20.3284 18 19.5 18H12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>

      {/* 參數區固定高度：切換工具時圖片不會跳動，滑桿位置也永遠對齊。
          額外控制列即使沒有內容也保留空間，四個工具的滑桿才會落在同一個位置。 */}
      <div className="h-[124px] shrink-0 border-t border-white/[0.06] py-3 flex flex-col">
        <div className="h-8 shrink-0 flex items-center gap-2 overflow-x-auto overflow-y-hidden no-scrollbar px-5">
          {tool === 'liquify' && LIQUIFY_PRESETS.map(m => (
            <button
              key={m.id}
              onClick={() => {
                setLqPreset(m.id);
                if (m.brush !== undefined) setBrush(b => ({ ...b, liquify: m.brush! }));
                if (m.force !== undefined) setForceMap(f => ({ ...f, liquify: m.force! }));
              }}
              className={`px-3.5 py-1 rounded-full text-[11px] shrink-0 border transition-all active:scale-95 ${
                lqPreset === m.id
                  ? 'bg-white text-black border-white font-bold'
                  : 'bg-white/5 text-white/60 border-white/15'
              }`}
            >
              {m.label}
            </button>
          ))}
          {tool === 'makeup' && (
            <>
              <label
                title="自選顏色"
                className="w-7 h-7 rounded-full shrink-0 relative cursor-pointer ring-1 ring-white/40 flex items-center justify-center overflow-hidden active:scale-90 transition-transform"
                style={{ background: 'conic-gradient(#f43,#fa3,#fd3,#3d6,#3cf,#63f,#f3a,#f43)' }}
              >
                <span className="absolute inset-[5px] rounded-full bg-[#080808] flex items-center justify-center">
                  <Icon name="colorize" className="text-[13px] text-white" />
                </span>
                <input
                  type="color"
                  value={makeupColor}
                  onChange={(e) => setMakeupColor(e.target.value)}
                  aria-label="自選顏色"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
              {LIP_PRESETS.map(c => (
                <button
                  key={c.hex}
                  onClick={() => setMakeupColor(c.hex)}
                  title={c.name}
                  aria-label={c.name}
                  className={`w-7 h-7 rounded-full shrink-0 transition-all active:scale-90 ${
                    makeupColor.toLowerCase() === c.hex.toLowerCase()
                      ? 'ring-2 ring-white'
                      : ''
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </>
          )}
        </div>

        <div className="flex-1 flex flex-col justify-center gap-3 px-5">
        {tool === 'blemish' &&
          sliderRow('筆刷', brush.blemish, BRUSH_RANGE.blemish[0], BRUSH_RANGE.blemish[1], (v) => setBrush(b => ({ ...b, blemish: v })))}
        {tool === 'wrinkle' && (
          <>
            {sliderRow('筆刷', brush.wrinkle, BRUSH_RANGE.wrinkle[0], BRUSH_RANGE.wrinkle[1], (v) => setBrush(b => ({ ...b, wrinkle: v })))}
            {sliderRow('力度', force, 10, 100, setForce)}
          </>
        )}
        {tool === 'liquify' && (
          <>
            {sliderRow('筆刷', brush.liquify, BRUSH_RANGE.liquify[0], BRUSH_RANGE.liquify[1], (v) => setBrush(b => ({ ...b, liquify: v })))}
            {sliderRow('力度', force, 10, 100, setForce)}
          </>
        )}
        {tool === 'makeup' && (
          <>
            {sliderRow('筆刷', brush.makeup, BRUSH_RANGE.makeup[0], BRUSH_RANGE.makeup[1], (v) => setBrush(b => ({ ...b, makeup: v })))}
            {sliderRow('濃度', intensity, 5, 100, setIntensity)}
          </>
        )}
        </div>
      </div>

      {/* 工具列。底部多留一點空間，避開 iPhone 的 home indicator */}
      <div className="border-t border-white/10 bg-black shrink-0 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
      <div className="flex h-16">
        {BEAUTY_TOOLS.map(t => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${tool === t.id ? 'text-white' : 'text-white/20'}`}
          >
            <Icon name={t.icon} className="text-xl" fill={tool === t.id} />
            <span className="text-[9px] font-black uppercase tracking-[0.15em]">{t.label}</span>
          </button>
        ))}
      </div>
      </div>

      {saveState === 'processing' && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white">處理中</p>
          <p className="text-[10px] text-white/40 mt-3 uppercase tracking-widest font-bold">全解析度重新渲染</p>
        </div>
      )}
    </div>
  );
};
