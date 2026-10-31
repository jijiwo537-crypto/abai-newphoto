import { canvasToUrl, revokeUrl, revokeUrlsLater } from '../utils/blobUrl';
import { StuckEscape } from './StuckEscape';
import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { addExport } from '../utils/exportHistory';
import { Icon } from './Icon';
import { useAlignPad, ALIGN_FILL_CSS, paintedWhenDecoded, useOriginalImage, drawOriginalInto, centerViewToShared, sharedToCenterView, type AlignRect, type StudioViewApi } from './studioAlign';
import { ChevronLeft } from 'lucide-react';
import { SaveButton } from './SaveButton';
import { ExportActionLift } from './ExportActionLift';
import {useStandaloneToolViewport,standaloneToolViewportCSS} from '../utils/useStandaloneToolViewport';
import type { ExitChoice } from '../types';
import {
  Rect, LiquifyMode, LiquifyField,
  BRUSH_REF_WIDTH, DEFAULT_BRUSH, BRUSH_RANGE, LIP_PRESETS, LIQUIFY_SCALE,
  healAt, healRect, wrinkleDab,
  createLiquifyField, liquifyDab, sampleLiquify, warpRegion, recomputeLiquifyMax,
  hexToRgb, stampAlpha, makeupComposite,
  releaseBuffers,
} from '../utils/beauty/engine';
import { inpaintImage, inpaintCrop, cropFor } from '../utils/beauty/inpaint';
import { findHealSource, fallbackHealSource, sideHealSource, applyHeal, strokeContours, healField, fieldAlpha, fieldBounds, fieldMaskRGBA, type HealMode, type HealRect, type HealField } from '../utils/beauty/heal';
import { safeScale } from '../utils/exportLimits';
import { fullResFromProcessed } from '../utils/fullResExport';
import { StrokeLayer, STROKE_INNER, wrinkleStrength, smoothStrength, smoothInvalidate, type StrokeKind } from '../utils/beauty/strokeFilter';

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
/** 預覽最小可以縮到幾倍（跟編輯器一樣可以縮小，不是只能放大） */
const VIEW_K_MIN = 0.5;
/** 鬆手後筆刷圈停留的時間 */
const RING_FLASH_MS = 217;

type BeautyTool = 'blemish' | 'clone' | 'patch' | 'wrinkle' | 'smooth' | 'liquify' | 'makeup';

interface ToolDef { id: BeautyTool; label: string; icon: string; }
const BEAUTY_TOOLS: ToolDef[] = [
  { id: 'blemish', label: '去痘', icon: 'healing' },
  { id: 'wrinkle', label: '去皺', icon: 'waves' },
  { id: 'smooth',  label: '磨皮', icon: 'skin_smooth' },
  { id: 'liquify', label: '液化', icon: 'gesture' },
  { id: 'makeup',  label: '修容', icon: 'brush' },
  /* 修補（仿製）：塗抹要修的地方，自動挑一塊最像的來源原封不動複製過來；
     放開後兩個框（目標 A、來源 B）都可以拖 */
  { id: 'clone',   label: '修補', icon: 'patch_heal' },
  /* 刪除：塗掉不要的東西（痣、雜物、路人、電線…），放開自動用周圍的質感重建（內容感知填補） */
  { id: 'patch',   label: '刪除', icon: 'erase_spot' },
];

// 液化的預設。豐胸與大眼都是膨脹，只是預設的筆刷與力度不同。
type LqPreset = 'slim' | 'chest' | 'eye' | 'pucker' | 'restore';
const LIQUIFY_PRESETS: {
  id: LqPreset; label: string; mode: LiquifyMode; brush?: number; force?: number;
}[] = [
  { id: 'slim',    label: '瘦身', mode: 'push',    brush: 150, force: 10 },
  { id: 'chest',   label: '豐胸', mode: 'bloat',   brush: 100, force: 40 },
  { id: 'eye',     label: '大眼', mode: 'bloat',   brush: 40,  force: 20 },
  { id: 'pucker',  label: '收縮', mode: 'pucker',  brush: 100, force: 40 },
  { id: 'restore', label: '還原', mode: 'restore', brush: 100, force: 40 },
];

// 每一筆操作都記錄下來，輸出時在全解析度依序重播。
// 座標一律存工作解析度的像素值，重播時乘上縮放比即可。
type Op =
  | { k: 'heal'; x: number; y: number; r: number }
  | { k: 'wrinkle'; pts: number[]; r: number; amount: number }   // 舊版去皺（每點疊一次），只為了讀得回以前的草稿
  | { k: 'stroke'; kind: StrokeKind; pts: number[]; r: number; strength: number }
  | { k: 'makeup'; pts: number[]; r: number; strength: number; rgb: [number, number, number] }
  | { k: 'liquify'; pts: number[]; r: number; force: number; mode: LiquifyMode }
  /** 刪除：筆觸路徑（工作解析度）＋亂數種子；重播時同一組輸入一定算出同一個結果 */
  | { k: 'patch'; pts: number[]; r: number; seed: number }
  /** 修補：筆觸路徑＋來源位移（目標點拿 p + (dx, dy) 的像素）＋修復／仿製 */
  | CloneOp;
/** hard：邊緣硬度（100 − 羽化）；opacity：0–1。舊的草稿沒有這兩個欄位，用預設值 */
type CloneOp = { k: 'clone'; pts: number[]; r: number; dx: number; dy: number; mode: HealMode; hard?: number; opacity?: number;
  /** 來源相對目標放大幾倍（s），以目標中心 (x, y) 為準。沒放大縮小過就沒有這個欄位 */
  sc?: { s: number; x: number; y: number } };

/* 修補筆的邊緣：比刪除柔一點，接縫更不明顯 */
const CLONE_HARDNESS = 55;
/** 筆觸外框的中心與半寬、半高（含筆刷半徑）：框的縮放以它為中心 */
const healBox = (pts: number[], r: number) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < pts.length; j += 2) { x0 = Math.min(x0, pts[j]); x1 = Math.max(x1, pts[j]); y0 = Math.min(y0, pts[j + 1]); y1 = Math.max(y1, pts[j + 1]); }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2 + r, hh: (y1 - y0) / 2 + r };
};
/** 修補框縮放的範圍 */
const HEAL_S_MIN = 0.3, HEAL_S_MAX = 4;

/* 修補筆的邊緣硬度：中心大部分整塊換掉，只留窄窄一圈柔邊銜接 */
const PATCH_HARDNESS = 70;
/* 修補在工作解析度算好的那一塊先留著（跟著那一筆操作走，不進草稿）：
   復原／重做時從原圖重播，不必每一筆都重算一次（大範圍一筆要幾百毫秒）。
   原尺寸輸出時照樣在原尺寸重算，畫質不受工作解析度限制。 */
const patchCache = new WeakMap<object, { rect: Rect; rgba: Uint8ClampedArray }>();
/** 修補筆觸蓋到的覆蓋率場與範圍 */
function patchAlpha(alpha: Float32Array, W: number, H: number, pts: number[], R: number, hardness = PATCH_HARDNESS): Rect | null {
  let u: Rect | null = null;
  for (let j = 0; j < pts.length; j += 2) {
    const r = stampAlpha(alpha, W, H, pts[j], pts[j + 1], R, hardness, 1);
    if (r) u = unionRect(u, r);
  }
  return u;
}
function writeRect(dst: Uint8ClampedArray, W: number, rect: Rect, rgba: Uint8ClampedArray) {
  for (let y = 0; y < rect.h; y++) dst.set(rgba.subarray(y * rect.w * 4, (y + 1) * rect.w * 4), ((rect.y + y) * W + rect.x) * 4);
}

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
  onCancel: (keepDraft?: boolean) => void;
  onHome: (keepDraft?: boolean) => void;
  onRequestExit?: () => Promise<ExitChoice>;
  onImportNew: () => void;
  onSendToEditor: (dataUrl: string) => void;
  /** 接續上次：把存下來的操作記錄餵回來（跳出應用再回來用的） */
  initialState?: { ops?: any[] } | null;
  /** 嵌在「編輯」的「人像」分頁裡：不佔整個畫面、不存草稿、不導出，
      上面一列換成「取消／復原／完成」，編輯器切分頁時呼叫 commitRef 拿成品 */
  embedded?: {
    commitRef: React.MutableRefObject<(() => StudioResult | null) | null>;
    onDone: (res: StudioResult | null) => void;
    onCancel: () => void;
    /** 右上角的「儲存」與三個點：跟編輯器其他分頁同一顆（交給編輯器存檔、開匯出選項） */
    onSave?: () => void;
    onMore?: () => void;
    /** 左上角的返回：跟編輯器其他分頁一樣離開編輯 */
    onBack?: () => void;
    /** 前後對比要看的那張：這張照片最原始的樣子（編輯器給；沒有就用工具拿到的那張） */
    getOriginalSrc?: () => string | null;
    /** 跟編輯器共用預覽縮放（見 studioAlign 的 StudioView） */
    viewApi?: React.MutableRefObject<Record<string, StudioViewApi | undefined>>;
  };
  /** 嵌在編輯器裡：編輯器預覽圖在螢幕上的框，照片擺在一模一樣的位置 */
  align?: AlignRect | null;
}

/** 嵌在編輯器裡的工具交回去的成品：preview 是工作解析度、馬上就能換上的那張；
    bake 是存檔時才跑的原尺寸版本（拿原尺寸的來源圖重播同一組操作） */
export type StudioResult = { preview: HTMLCanvasElement; bake: (fullSrc: string) => Promise<string | null>; session?: string };

/** 把一組美顏操作重播在任一張圖上（sessionW 是當初操作時的工作寬度，座標照比例換算） */
export async function renderBeautyOn(src: string, ops: Op[], count: number, sessionW: number): Promise<string | null> {
  const img = await new Promise<HTMLImageElement | null>((res) => {
    const im = new Image();
    if (!src.startsWith('blob:') && !src.startsWith('data:')) im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
  if (!img) return null;
  const sc = Math.min(1, EXPORT_MAX / Math.max(img.width, img.height)) * safeScale(img.width, img.height);
  const FW = Math.max(2, Math.round(img.width * sc));
  const FH = Math.max(2, Math.round(img.height * sc));
  const c = document.createElement('canvas');
  c.width = FW; c.height = FH;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, FW, FH);
  const base = ctx.getImageData(0, 0, FW, FH);
  // 超過手機畫布上限的大照片：先在上限內算，最後用導向上採樣做出原尺寸（見 utils/fullResExport）
  const big = safeScale(img.width, img.height) < 1;
  const orig = big ? base.data.slice() : null;
  const field = createLiquifyField(FW, FH);
  replayOps(ops, count, base, field, FW, FH, FW / sessionW);
  if (field.max > 0) {
    const out = ctx.createImageData(FW, FH);
    warpRegion(base, FW, FH, field, out, { x: 0, y: 0, w: FW, h: FH });
    ctx.putImageData(out, 0, 0);
  } else ctx.putImageData(base, 0, 0);
  if (orig) {
    const P = ctx.getImageData(0, 0, FW, FH).data; c.width = c.height = 0;
    const u = await fullResFromProcessed(img, P, orig, FW, FH, 'image/png');
    if (u) return u;
  }
  const url = await canvasToUrl(c);
  c.width = c.height = 0;
  return url;
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
    } else if (op.k === 'stroke') {
      const L = new StrokeLayer(base.data, W, H, op.kind, op.r * k, null);
      for (let j = 0; j < op.pts.length; j += 2) L.stamp(op.pts[j] * k, op.pts[j + 1] * k, op.r * k, op.strength, STROKE_INNER[op.kind]);
    } else if (op.k === 'patch') {
      const hit = k === 1 ? patchCache.get(op) : undefined;
      if (hit) { writeRect(base.data, W, hit.rect, hit.rgba); continue; }
      if (!alpha) alpha = new Float32Array(W * H); else alpha.fill(0);
      const pts = op.pts.map(v => v * k);
      const u = patchAlpha(alpha, W, H, pts, op.r * k);
      if (!u) continue;
      const res = inpaintImage(base.data, W, H, alpha, u, op.seed);
      if (res) { writeRect(base.data, W, res.rect, res.rgba); if (k === 1) patchCache.set(op, res); }
    } else if (op.k === 'clone') {
      if (!alpha) alpha = new Float32Array(W * H); else alpha.fill(0);
      const f = healField(op.pts.map(v => v * k), op.r * k, W, H);
      const rect = f && fieldAlpha(alpha, W, H, f, op.hard ?? CLONE_HARDNESS);
      if (rect) applyHeal(base.data, base.data, W, H, alpha, rect, op.dx * k, op.dy * k, op.mode || 'clone', op.opacity ?? 1,
        op.sc ? { s: op.sc.s, x: op.sc.x * k, y: op.sc.y * k } : undefined);
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
  imageSrc, onCancel, onHome, onRequestExit, onImportNew, onSendToEditor, initialState, embedded, align, onPainted,
}) => {
  const initialOpsCountRef = useRef(Array.isArray(initialState?.ops) ? initialState!.ops!.length : 0);
  const [tool, setTool] = useState<BeautyTool>('blemish');
  const [brush, setBrush] = useState<Record<string, number>>({ ...DEFAULT_BRUSH });
  // 力度分工具記錄。共用一個值的話，液化套用預設會連帶改掉去皺的力度。
  const [forceMap, setForceMap] = useState<Record<string, number>>({ wrinkle: 30, smooth: 60, liquify: 10 });
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
  /* UI 顯示值是實際值的兩倍；25 對應使用者看到的預設 50。 */
  const [intensity, setIntensity] = useState(25);
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
  // 計時器在 utils/blobUrl 裡跑：寫在這裡的話會抓住整個元件（所有像素），離開後 15 秒都放不掉
  useEffect(() => () => revokeUrlsLater([finalUrlRef.current], 15000), []);
  const [showOriginal, setShowOriginal] = useState(false);

  const viewRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<Session | null>(null);
  /** 嵌在編輯器裡：這一次掛上來的代號，跟最後一次交出去時做到哪一步（見 takeResult） */
  const sessionIdRef = useRef(`beauty-${Math.random().toString(36).slice(2)}`);
  const committedSigRef = useRef('');
  const warpBufRef = useRef<ImageData | null>(null);

  // 指標事件處理器需要最新參數但不該因參數變動而重建，用 ref 鏡射
  /** 修補的模式：修復（明暗顏色跟著周圍）／仿製（原封不動） */
  /* 修補只有一種（修復）：搬來源的紋理、明暗顏色跟著周圍走。羽化＝邊緣多柔；透明度＝蓋上去多少 */
  const [healFeather, setHealFeather] = useState(45);
  const [healOpacity, setHealOpacity] = useState(100);
  const cfg = useRef({ tool, brush, force, lqMode, makeupColor, intensity, healFeather, healOpacity });
  cfg.current = { tool, brush, force, lqMode, makeupColor, intensity, healFeather, healOpacity };

  // 去皺與修容都以「整筆」為單位：下筆前存一份像素，結束時才記一次歷史。
  // 這樣每一個筆刷點就不必各自做兩次 ImageData 快照，快速拖動才不會卡。
  const strokeSrcRef = useRef<Uint8ClampedArray | null>(null);
  const strokeAlphaRef = useRef<Float32Array | null>(null);
  /** 去皺／磨皮這一筆的引擎（見 utils/beauty/strokeFilter） */
  const strokeLayerRef = useRef<{ layer: StrokeLayer; kind: StrokeKind; R: number; strength: number } | null>(null);
  /** 磨皮的目標層跨筆共用（跟筆刷大小無關），像素被改到的地方才作廢；選到磨皮時閒置先算好 */
  const smoothTargetsRef = useRef(new Map<number, Uint8ClampedArray>());
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
    const kk = clamp(k, VIEW_K_MIN, 6);
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
    // 修補的筆刷大小固定（60），不給調
    const size = cfg.current.tool === 'clone' ? DEFAULT_BRUSH.clone : (cfg.current.brush[cfg.current.tool] || 20);
    return Math.max(3, size * (s.W / BRUSH_REF_WIDTH));
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
    if (!bufImg || bufImg.width < w || bufImg.height < h) {
      bufImg = ctx.createImageData(Math.max(w,bufImg?.width||0), Math.max(h,bufImg?.height||0));
      warpBufRef.current = bufImg;
    }
    warpRegion(s.base, s.W, s.H, s.lq, bufImg, { x: x0, y: y0, w, h });
    ctx.putImageData(bufImg, x0, y0, 0, 0, w, h);
  }, []);

  const renderPixelRect = useCallback((r: Rect) => {
    const s = sessionRef.current!;
    if(cfg.current.tool==='liquify'){render(r);return;}
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
      if (!cur || embedded) return;
      saveToolDraft('beauty', first ? imageSrc : null, { ops: cur.ops.slice(0, cur.opsApplied) });
    }, 1000);
  }, [imageSrc, embedded]);
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
    // 像素被改到的地方，磨皮先算好的目標層就不能再用了
    if (op.k === 'heal') smoothInvalidate(smoothTargetsRef.current, s.W, s.H, healRect(op.x, op.y, op.r));
    else if (op.k !== 'liquify' && op.pts.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = 0; j < op.pts.length; j += 2) { x0 = Math.min(x0, op.pts[j]); x1 = Math.max(x1, op.pts[j]); y0 = Math.min(y0, op.pts[j + 1]); y1 = Math.max(y1, op.pts[j + 1]); }
      smoothInvalidate(smoothTargetsRef.current, s.W, s.H, { x: Math.floor(x0 - op.r - 2), y: Math.floor(y0 - op.r - 2), w: Math.ceil(x1 - x0 + op.r * 2 + 4), h: Math.ceil(y1 - y0 + op.r * 2 + 4) });
    }
    s.ops.length = s.opsApplied;   // 撤銷後又有新動作，就把被撤銷的部分丟掉
    s.ops.push(op);
    s.opsApplied++;
    syncHist();
  }, [syncHist]);

  const undo = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.opsApplied <= 0 || patchBusyRef.current) return;
    endHealEdit();
    s.opsApplied--;
    smoothTargetsRef.current.clear();
    rebuild();
    syncHist();
  }, [rebuild, syncHist]);

  const redo = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.opsApplied >= s.ops.length || patchBusyRef.current) return;
    endHealEdit();
    s.opsApplied++;
    smoothTargetsRef.current.clear();
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

  /* ── 修補：放開後這一處還可以調 ────────────────────────────
     src／alpha 直接借用筆刷的暫存區（這一筆之前的整張圖、這一筆的覆蓋率），不另外複製；
     再點一次「修補」、換工具、復原／重做、離開人像，就定下來（暫存區要被蓋掉了）。
     field：這一筆的距離場（以最初的筆觸算，之後整塊平移、縮放都是查表）；
     c：筆觸外框中心；目標 A 的中心＝c＋(ox, oy)、大小 sA 倍；來源 B 的中心＝A 的中心＋(dx, dy)、大小 sB 倍 */
  type HealState = {
    op: CloneOp; src: Uint8ClampedArray; alpha: Float32Array; field: HealField;
    pts0: number[]; r0: number; c: { x: number; y: number; hw: number; hh: number };
    ox: number; oy: number; sA: number; sB: number; rect: HealRect; out: Rect;
    /** 拖動／縮放時交給 GPU 預覽用：這一筆之前的整張圖（畫布）、覆蓋率圖（跟著羽化） */
    srcCv?: HTMLCanvasElement; maskCv?: HTMLCanvasElement; maskHard?: number;
  };
  const healRef = useRef<HealState | null>(null);
  /** 這一處的筆觸（原始位置、原始大小）：框的輪廓只在畫完那一下算一次，之後移動縮放都只改 transform */
  const [healEdit, setHealEdit] = useState<{ pts: number[]; r: number } | null>(null);
  /** 選中的是哪一個框（只有選中的那個可以移動、縮放）。預設選中來源（虛線）；
      點 A、B 以外的地方＝都不選（這時候雙指就是縮放預覽） */
  type HealSel = 'src' | 'dst' | null;
  const [healSel, setHealSelState] = useState<HealSel>('src');
  const healSelRef = useRef<HealSel>('src');
  const setHealSel = (k: HealSel) => { healSelRef.current = k; setHealSelState(k); };
  /** 每改一次這一處就加一（交給編輯器時用來判斷有沒有變） */
  const healRevRef = useRef(0);
  /** 把現在的擺法寫回記錄（重播、存檔、交給編輯器用的是記錄） */
  const syncHealOp = (h: HealState) => {
    const { c, sA, sB } = h;
    const ax = c.x + h.ox, ay = c.y + h.oy;
    h.op.pts = h.pts0.map((v, i) => i % 2 ? ay + (v - c.y) * sA : ax + (v - c.x) * sA);
    h.op.r = h.r0 * sA;
    const ks = sB / sA;
    if (Math.abs(ks - 1) > 1e-4) h.op.sc = { s: ks, x: ax, y: ay }; else delete h.op.sc;
  };
  const endHealEdit = useCallback(() => {
    const h = healRef.current;
    if (!h) return;
    healGestRef.current = null;
    finishHealJobRef.current();
    const pending = !!healRafRef.current;
    if (healRafRef.current) { cancelAnimationFrame(healRafRef.current); healRafRef.current = 0; }
    if (healGpuLiveRef.current || pending) reapplyHealRef.current();
    stopHealGpu();
    syncHealOp(h);
    healRef.current = null;
    setHealEdit(null);
    setHealSel('src');
    setHealMoving(false);
    saveBeautyDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveBeautyDraft]);
  useEffect(() => { if (tool !== 'clone') endHealEdit(); }, [tool, endHealEdit]);
  /** 點工具列的「修補」：已經在修補裡、手上有一處的話，把它定下來，可以開始修下一處 */
  const pickTool = (id: BeautyTool) => {
    if (id === 'clone' && tool === 'clone' && healRef.current) { endHealEdit(); return; }
    setTool(id);
  };
  /* 外框輪廓（跟著筆觸形狀的一條線）：這一處畫完時算一次 */
  const healContour = React.useMemo(() => {
    if (!healEdit) return '';
    const lines = strokeContours(healEdit.pts, healEdit.r, Math.max(0.75, healEdit.r / 14));
    return lines.map(l => 'M' + l.map((v, i) => (i % 2 ? ' ' : i ? ' L' : '') + v.toFixed(1)).join('') + 'Z').join(' ');
  }, [healEdit]);
  /* 兩個框放在縮放層外面：照片布在舞台上的位置算成一個矩陣，A、B 各自再套自己的位置與大小。
     線寬不跟著縮放（non-scaling-stroke）；虛線的長度跟著「預覽倍率 × 框的大小」一起變，
     所以放大縮小預覽、放大縮小框，虛線的數量都不會變 */
  const healRootRef = useRef<SVGGElement | null>(null);
  const healSrcGRef = useRef<SVGGElement | null>(null);
  const healDstGRef = useRef<SVGGElement | null>(null);
  const healSrcPathRef = useRef<SVGPathElement | null>(null);
  const paintHealBoxes = () => {
    const g = healRootRef.current, v = viewRef.current, st = stageRef.current, s = sessionRef.current, h = healRef.current;
    if (!g || !v || !st || !s || !h) return;
    const vr = v.getBoundingClientRect(), sr = st.getBoundingClientRect();
    g.setAttribute('transform', `matrix(${vr.width / s.W} 0 0 ${vr.height / s.H} ${vr.left - sr.left} ${vr.top - sr.top})`);
    const ax = h.c.x + h.ox, ay = h.c.y + h.oy, bx = ax + h.op.dx, by = ay + h.op.dy;
    healDstGRef.current?.setAttribute('transform', `translate(${ax} ${ay}) scale(${h.sA}) translate(${-h.c.x} ${-h.c.y})`);
    healSrcGRef.current?.setAttribute('transform', `translate(${bx} ${by}) scale(${h.sB}) translate(${-h.c.x} ${-h.c.y})`);
    const k = viewTRef.current.k * h.sB;
    healSrcPathRef.current?.setAttribute('stroke-dasharray', `${(4 * k).toFixed(2)} ${(3 * k).toFixed(2)}`);
  };
  /** 照片（沒縮放時）上緣離舞台頂端多遠：提示要放在照片上緣往下一點 */
  const [imgTop, setImgTop] = useState(0);
  useLayoutEffect(() => {
    paintHealBoxes();
    const v = viewRef.current, w = v?.parentElement;
    if (v && w) { const t = w.offsetTop + v.offsetTop; if (Math.abs(t - imgTop) > 0.5) setImgTop(t); }
  });

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
      // Only field cells inside this brush changed. Expanding twice by the
      // accumulated displacement redrew most of the image on every move.
      const e = Math.ceil(R + 2 * LIQUIFY_SCALE + 2);
      return { x: p.x - e, y: p.y - e, w: e * 2, h: e * 2 };
    }

    const [bx, by] = toBase(p.x, p.y);

    if (c.tool === 'patch' || c.tool === 'clone') {
      /* 塗的時候先蓋一層半透明的顏色（跟 Lightroom 修復筆同一種提示），放開才真的處理。
         刪除是紅色，修補是白色，一眼分得出現在是哪一支筆 */
      const src = strokeSrcRef.current, alpha = strokeAlphaRef.current;
      if (!src || !alpha) return null;
      // 修補：畫的時候白色色塊就照現在的羽化顯示邊緣（放開後的結果也是這個羽化）
      const r = stampAlpha(alpha, s.W, s.H, bx, by, R, c.tool === 'clone' ? 100 - c.healFeather : PATCH_HARDNESS, 1);
      if (!r) return null;
      const d = s.base.data;
      const [tr, tg, tb, ta] = c.tool === 'clone' ? [255, 255, 255, 0.45] : [255, 70, 70, 0.5];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * s.W + x, a = alpha[i] * ta, o = i * 4;
        if (a <= 0) continue;
        d[o] = src[o] + (tr - src[o]) * a; d[o + 1] = src[o + 1] + (tg - src[o + 1]) * a; d[o + 2] = src[o + 2] + (tb - src[o + 2]) * a;
      }
      strokePtsRef.current.push(bx, by);
      strokeUnionRef.current = unionRect(strokeUnionRef.current, r);
      return r;
    }

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

    // 去皺、磨皮：只畫覆蓋遮罩，混合成目標層（每一點的成本跟筆刷大小無關，也不會越塗越重）
    const L = strokeLayerRef.current;
    if (!L) return null;
    const pr = L.layer.stamp(bx, by, L.R, L.strength, STROKE_INNER[L.kind]);
    if (!pr) return null;
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
    } else if ((c.tool === 'wrinkle' || c.tool === 'smooth' || c.tool === 'makeup' || c.tool === 'patch' || c.tool === 'clone') && strokeUnionRef.current && strokeSrcRef.current) {
      const r = strokeUnionRef.current;
      restore(r, snapFrom(strokeSrcRef.current, r));
      renderPixelRect(r);
    }
    lqBeforeRef.current = null;
    strokeLayerRef.current = null;
    strokeUnionRef.current = null;
    strokePtsRef.current = [];
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    drawRing(null);
  }, [drawRing, render, renderPixelRect, restore, snapFrom]);

  /** 掛在整個舞台上：照片外面的黑色區域也收得到（修補框的拖曳縮放、雙指縮放預覽）；畫筆只在照片上下筆 */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!sessionRef.current || isLoading || saveState !== 'idle') return;
    const onPhoto = e.target === viewRef.current;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 修補還在算：先不接新的筆（雙指縮放照樣可以）
    if (patchBusyRef.current && pointersRef.current.size < 2) return;

    /* 修補放開後：單指在畫布任何地方拖＝移動選中的框，雙指＝縮放（＋移動）選中的框，點一下框＝選它 */
    if (cfg.current.tool === 'clone' && healRef.current && (healSelRef.current || pointersRef.current.size < 2)) {
      try { (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId); } catch (err) { /* noop */ }
      beginHealGesture();
      drawRing(null);
      e.preventDefault();
      return;
    }
    // 都沒選的時候第二根手指：照常縮放預覽（剛剛那根手指只是在等看是不是點一下）
    if (cfg.current.tool === 'clone' && healRef.current) healGestRef.current = null;

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
    if (!onPhoto) return;   // 黑色區域：只等看是不是雙指，不下筆

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
      // 新的一筆開始：上一筆修補的「可拖曳來源」就結束了（它用的暫存區馬上要被這一筆蓋掉）
      endHealEdit();
      ensureStrokeBuffers(cfg.current.tool === 'makeup' || cfg.current.tool === 'patch' || cfg.current.tool === 'clone');
      const t = cfg.current.tool;
      if (t === 'wrinkle' || t === 'smooth') {
        const R = brushRadius();
        strokeLayerRef.current = {
          layer: new StrokeLayer(s.base.data, s.W, s.H, t, R, strokeSrcRef.current, t === 'smooth' ? smoothTargetsRef.current : undefined),
          kind: t, R, strength: t === 'wrinkle' ? wrinkleStrength(cfg.current.force) : smoothStrength(cfg.current.force),
        };
      }
    }
    const d = downRef.current;
    const r = dab(d ? { x: d.x, y: d.y } : p, 0, 0);
    if (r) renderPixelRect(r);
  }, [dab, ensureStrokeBuffers, renderPixelRect, brushRadius, endHealEdit]);

  const handleMove = (e: PointerEvent) => {
    if (!sessionRef.current || isLoading) return;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (healGestRef.current) { moveHealGesture(e); e.preventDefault(); return; }

    // 雙指：縮放 + 平移，完全不碰筆刷
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const pin = pinchRef.current;
      const c = stageCenter();
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const k = clamp(pin.k0 * (d / pin.d0), VIEW_K_MIN, 6);
      const mx = (a.x + b.x) / 2 - c.x;
      const my = (a.y + b.y) / 2 - c.y;
      applyView(k, mx - pin.cx * k, my - pin.cy * k);
      e.preventDefault();
      return;
    }

    if (gestureLockRef.current) return;
    if (paintingRef.current && e.pointerId !== strokePointerRef.current) return;

    const p = localPoint(e);
    // 修補放開後在調框（不是畫筆）：滑鼠移過去不顯示筆刷圈
    if (!paintingRef.current) { if (e.pointerType === 'mouse' && !(cfg.current.tool === 'clone' && healRef.current)) drawRing(p); return; }

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
  const upHealGestureRef = useRef<(e: PointerEvent) => void>(() => {});

  /* ── 修補 ─────────────────────────────────────────────
     放開手指：從「這一筆之前」的像素切出工作範圍，丟到背景執行緒補洞（不會卡畫面），
     回來後整塊寫回（紅色提示一起被蓋掉）、記成一步。算的時候不接新的筆。 */
  const [patchBusy, setPatchBusy] = useState(false);
  const patchBusyRef = useRef(false);
  const patchWorkerRef = useRef<Worker | null | undefined>(undefined);
  const patchJobRef = useRef(0);
  useEffect(() => () => { patchWorkerRef.current?.terminate(); patchWorkerRef.current = null; }, []);
  const runPatch = useCallback((pts: number[], R: number, union: Rect, src: Uint8ClampedArray, strokeAlpha: Float32Array) => {
    const s = sessionRef.current;
    if (!s) return;
    const seed = (Math.random() * 0x7fffffff) | 0;
    const crop = cropFor(src, s.W, s.H, strokeAlpha, union);
    const id = ++patchJobRef.current;
    patchBusyRef.current = true; setPatchBusy(true);
    const done = (rgba: Uint8ClampedArray | null) => {
      if (id !== patchJobRef.current || sessionRef.current !== s) return;
      patchBusyRef.current = false; setPatchBusy(false);
      if (!rgba) {
        // 周圍完全找不到可用的質感（例如整張都被塗滿）：把紅色提示收掉，什麼都不改
        restore(union, snapFrom(src, union)); renderPixelRect(union); return;
      }
      writeRect(s.base.data, s.W, crop.rect, rgba);
      const op: Op = { k: 'patch', pts, r: R, seed };
      patchCache.set(op, { rect: crop.rect, rgba });
      pushOp(op);
      renderPixelRect(crop.rect);
    };
    if (patchWorkerRef.current === undefined) {
      try { patchWorkerRef.current = new Worker(new URL('../utils/beauty/inpaint.worker.ts', import.meta.url), { type: 'module' }); }
      catch { patchWorkerRef.current = null; }
    }
    const w = patchWorkerRef.current;
    if (w) {
      const onMsg = (e: MessageEvent) => { if (e.data?.id !== id) return; w.removeEventListener('message', onMsg); done(e.data.rgba); };
      w.addEventListener('message', onMsg);
      w.onerror = () => { patchWorkerRef.current = null; setTimeout(() => done(inpaintCrop(crop.rgba, crop.rect.w, crop.rect.h, crop.alpha, seed)), 0); };
      w.postMessage({ id, rgba: crop.rgba, w: crop.rect.w, h: crop.rect.h, alpha: crop.alpha, seed }, [crop.rgba.buffer, crop.alpha.buffer]);
    } else {
      // 沒有 Worker 的環境：讓紅色提示先畫出來，下一個空檔再在主執行緒算
      setTimeout(() => done(inpaintCrop(crop.rgba, crop.rect.w, crop.rect.h, crop.alpha, seed)), 30);
    }
  }, [pushOp, renderPixelRect, restore, snapFrom]);

  /* ── 修補（仿製）─────────────────────────────────────────
     放開手指：自動找一塊最像的來源（比的是範圍外那一圈，見 utils/beauty/heal），原封不動複製過來，記成一步。
     之後畫面上留著兩個框：目標（實線，A）與來源（虛線，B），選中哪一個就可以在畫布任何地方拖它、雙指縮放它。
     覆蓋率用距離場算（一次），之後移動、縮放、調羽化都只是查表重寫，一點都不卡。 */
  const runClone = useCallback((pts: number[], R: number, union: Rect, src: Uint8ClampedArray, alpha: Float32Array) => {
    const s = sessionRef.current;
    if (!s) return;
    restore(union, snapFrom(src, union));          // 先把白色提示收掉
    for (let y = union.y; y < union.y + union.h; y++) alpha.fill(0, y * s.W + union.x, y * s.W + union.x + union.w);
    const field = healField(pts, R, s.W, s.H);
    const hard = 100 - cfg.current.healFeather;
    const rect = field && fieldAlpha(alpha, s.W, s.H, field, hard);
    if (!field || !rect) { renderPixelRect(union); return; }
    // 自動找不到（範圍太大、貼著邊）也一定給一塊來源，框照樣出來，不會畫完沒反應
    // 先放在 A 的左邊或右邊（左右平行、靠得近）；兩邊都放不下才自動往遠一點找
    const found = sideHealSource(src, s.W, s.H, alpha, rect) || findHealSource(src, s.W, s.H, alpha, rect) || fallbackHealSource(rect, s.W, s.H);
    const op: CloneOp = { k: 'clone', pts, r: R, dx: found.dx, dy: found.dy, mode: 'clone', hard, opacity: cfg.current.healOpacity / 100 };
    const out = applyHeal(src, s.base.data, s.W, s.H, alpha, rect, op.dx, op.dy, 'clone', op.opacity) || rect;
    pushOp(op);
    renderPixelRect(unionRect(union, out));
    const bx = healBox(pts, R);
    healRef.current = { op, src, alpha, field, pts0: pts.slice(), r0: R, c: { x: bx.cx, y: bx.cy, hw: bx.hw, hh: bx.hh }, ox: 0, oy: 0, sA: 1, sB: 1, rect, out };
    healRevRef.current++;
    setHealSel('src');
    setHealEdit({ pts, r: R });
    // 拖動時 GPU 預覽要用的來源畫布：趁閒置先做好，第一次拖才不會頓一下
    const hNow = healRef.current;
    const ric = (window as any).requestIdleCallback as ((f: () => void, o?: any) => number) | undefined;
    const warm = () => { if (healRef.current === hNow && hNow) ensureHealSrcCanvas(hNow); };
    if (ric) ric(warm, { timeout: 400 }); else window.setTimeout(warm, 60);
  }, [pushOp, renderPixelRect, restore, snapFrom]);
  /** 重新套一次這一處修補：上一次改過的範圍先還原成修補前，覆蓋率照現在的羽化／位置／大小重寫，再蓋一次 */
  const reapplyHeal = useCallback(() => {
    finishHealJobRef.current();
    const h = healRef.current, s = sessionRef.current;
    if (!h || !s) return;
    const prev = h.out;
    for (let y = prev.y; y < prev.y + prev.h; y++) {
      const o = (y * s.W + prev.x) * 4;
      s.base.data.set(h.src.subarray(o, o + prev.w * 4), o);
      h.alpha.fill(0, y * s.W + prev.x, y * s.W + prev.x + prev.w);
    }
    healRevRef.current++;
    const rect = fieldAlpha(h.alpha, s.W, s.H, h.field, h.op.hard ?? CLONE_HARDNESS, { ox: h.ox, oy: h.oy, s: h.sA, cx: h.c.x, cy: h.c.y });
    if (!rect) { h.out = { x: prev.x, y: prev.y, w: 0, h: 0 }; renderPixelRect(prev); return; }
    h.rect = rect;
    const ks = h.sB / h.sA;
    const out = applyHeal(h.src, s.base.data, s.W, s.H, h.alpha, rect, h.op.dx, h.op.dy, 'clone', h.op.opacity ?? 1,
      Math.abs(ks - 1) > 1e-4 ? { s: ks, x: h.c.x + h.ox, y: h.c.y + h.oy } : undefined) || rect;
    h.out = out;
    renderPixelRect(unionRect(prev, out));
  }, [renderPixelRect]);
  const reapplyHealRef = useRef(reapplyHeal); reapplyHealRef.current = reapplyHeal;
  /** 一格只重算一次：滑桿、拖動一秒送上百個事件，全部併成下一幀那一次 */
  const healRafRef = useRef(0);
  const scheduleHeal = () => {
    if (!healRafRef.current) healRafRef.current = requestAnimationFrame(() => {
      healRafRef.current = 0;
      // 手指還在動（疊層開著、不是放手後在分格算）才走 GPU；其他（拉羽化…）照正式的算
      if (healGpuLiveRef.current && !healJobRef.current) drawHealGpu(); else reapplyHealRef.current();
    });
  };

  /* ── 拖動／縮放框的時候：交給 GPU 畫 ─────────────────────────────
     框放大之後，每一格都用 CPU 重算整塊（取樣、羽化、寫回、上傳）會跟不上手指。
     手指在動的這段時間改成：照片先還原成沒修補的樣子，修補那一塊用一張疊在上面的畫布，
     以「覆蓋率圖」當遮罩、把來源圖縮放平移貼上去 —— 兩次 drawImage，GPU 做，跟框多大無關。
     手指放開才用 CPU 照原尺寸正式算一次（跟存檔一模一樣），同一格換掉疊層。
     有液化的話照片是變形過的，疊層對不上，就照舊用 CPU。 */
  const healPrevRef = useRef<HTMLCanvasElement>(null);
  const healTmpRef = useRef<HTMLCanvasElement | null>(null);
  const healGpuLiveRef = useRef(false);
  const ensureHealSrcCanvas = (h: HealState) => {
    const s = sessionRef.current;
    if (h.srcCv || !s) return;
    const c = document.createElement('canvas');
    c.width = s.W; c.height = s.H;
    c.getContext('2d')!.putImageData(new ImageData(h.src, s.W, s.H), 0, 0);
    h.srcCv = c;
  };
  const startHealGpu = (): boolean => {
    finishHealJobRef.current();
    const h = healRef.current, s = sessionRef.current, ov = healPrevRef.current, v = viewRef.current;
    if (!h || !s || !ov || !v || s.lq.max > 0 || showOriginal) return false;
    if (healGpuLiveRef.current) return true;
    ensureHealSrcCanvas(h);
    const hard = h.op.hard ?? CLONE_HARDNESS;
    if (!h.maskCv || h.maskHard !== hard) {
      const m = h.maskCv || document.createElement('canvas');
      m.width = h.field.w; m.height = h.field.h;
      m.getContext('2d')!.putImageData(new ImageData(fieldMaskRGBA(h.field, hard), h.field.w, h.field.h), 0, 0);
      h.maskCv = m; h.maskHard = hard;
    }
    if (ov.width !== s.W || ov.height !== s.H) { ov.width = s.W; ov.height = s.H; }
    // 疊層蓋在照片畫布同一個位置、同一個大小
    ov.style.left = v.offsetLeft + 'px'; ov.style.top = v.offsetTop + 'px';
    ov.style.width = v.offsetWidth + 'px'; ov.style.height = v.offsetHeight + 'px';
    // 照片還原成沒修補的樣子（只動修補那一塊）：像素直接搬，畫面用 GPU 從來源畫布貼回去（不用整塊 putImageData）
    const prev = h.out;
    for (let y = prev.y; y < prev.y + prev.h; y++) {
      const o = (y * s.W + prev.x) * 4;
      s.base.data.set(h.src.subarray(o, o + prev.w * 4), o);
    }
    if (prev.w > 0 && prev.h > 0 && h.srcCv) {
      // 來源畫布是不透明的：一般疊上去就好（不能用 copy —— copy 會把這一塊以外整張清掉）
      const vc = v.getContext('2d')!;
      vc.drawImage(h.srcCv, prev.x, prev.y, prev.w, prev.h, prev.x, prev.y, prev.w, prev.h);
    }
    healGpuLiveRef.current = true;
    ov.style.display = 'block';
    drawHealGpu();
    return true;
  };
  const drawHealGpu = () => {
    const h = healRef.current, ov = healPrevRef.current;
    if (!h || !ov || !h.srcCv || !h.maskCv) return;
    const ctx = ov.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ov.width, ov.height);
    const f = h.field, sA = h.sA, ks = h.sB / h.sA;
    const ax = h.c.x + h.ox, ay = h.c.y + h.oy, bx = ax + h.op.dx, by = ay + h.op.dy;
    // 目標範圍（照片座標）
    const x0 = Math.floor(ax + (f.x - h.c.x) * sA), y0 = Math.floor(ay + (f.y - h.c.y) * sA);
    const w = Math.ceil(f.w * sA) + 2, hh = Math.ceil(f.h * sA) + 2;
    let t = healTmpRef.current;
    if (!t) t = healTmpRef.current = document.createElement('canvas');
    if (t.width < w || t.height < hh) { t.width = Math.max(w, t.width); t.height = Math.max(hh, t.height); }
    const g = t.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(h.maskCv, ax + (f.x - h.c.x) * sA - x0, ay + (f.y - h.c.y) * sA - y0, f.w * sA, f.h * sA);
    // 來源：目標點 p 拿 B 中心 +（p − A 中心）× ks 的像素
    g.globalCompositeOperation = 'source-in';
    g.setTransform(1 / ks, 0, 0, 1 / ks, ax - bx / ks - x0, ay - by / ks - y0);
    g.drawImage(h.srcCv, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = h.op.opacity ?? 1;
    ctx.drawImage(t, 0, 0, w, hh, x0, y0, w, hh);
    ctx.globalAlpha = 1;
  };
  /* 放手後的正式結果：框放大很多倍時整塊一次算要上百毫秒（手指一放就頓一下）。
     改成分好幾格、每格只算幾毫秒（GPU 疊層照樣蓋在上面，看起來就是放手那一刻的樣子），
     算完那一格才把疊層收掉。中途又有任何動作（再拖、拉羽化、離開）就先一口氣把剩下的算完。 */
  const healJobRef = useRef<{ rect: HealRect; prev: Rect; y: number; ks: number; raf: number } | null>(null);
  const stepHealJob = (budget: number) => {
    const j = healJobRef.current, h = healRef.current, s = sessionRef.current;
    if (!j || !h || !s) { healJobRef.current = null; return; }
    const t0 = performance.now();
    const xf = { ox: h.ox, oy: h.oy, s: h.sA, cx: h.c.x, cy: h.c.y };
    const sc = Math.abs(j.ks - 1) > 1e-4 ? { s: j.ks, x: h.c.x + h.ox, y: h.c.y + h.oy } : undefined;
    const end = j.rect.y + j.rect.h;
    while (j.y < end && performance.now() - t0 < budget) {
      const y1 = Math.min(end, j.y + 24);
      fieldAlpha(h.alpha, s.W, s.H, h.field, h.op.hard ?? CLONE_HARDNESS, xf, [j.y, y1]);
      applyHeal(h.src, s.base.data, s.W, s.H, h.alpha, { x: j.rect.x, y: j.y, w: j.rect.w, h: y1 - j.y }, h.op.dx, h.op.dy, 'clone', h.op.opacity ?? 1, sc);
      // 一段一段畫上照片（疊層還蓋著，看不出來），最後就不用一次貼一大塊
      render({ x: j.rect.x, y: j.y, w: j.rect.w, h: y1 - j.y });
      /* 這幾列照片上已經是正式結果：疊層同一段馬上擦掉。不擦的話疊層會再蓋一次在正式結果上，
         羽化那一圈被疊兩次變硬，算完收掉疊層時又變回來 —— 就是放手那一下「羽化抖一下」 */
      healPrevRef.current?.getContext('2d')!.clearRect(j.rect.x - 2, j.y, j.rect.w + 4, y1 - j.y);
      j.y = y1;
    }
    if (j.y < end) { j.raf = requestAnimationFrame(() => stepHealJob(7)); return; }
    healJobRef.current = null;
    stopHealGpu();
  };
  const finishHealJobRef = useRef(() => {});
  finishHealJobRef.current = () => {
    const j = healJobRef.current;
    if (!j) return;
    cancelAnimationFrame(j.raf);
    stepHealJob(Infinity);
  };
  /** 放手：GPU 疊層開著的話分格算正式結果，不然就直接算 */
  const commitHealGesture = () => {
    const h = healRef.current, s = sessionRef.current;
    if (!h || !s) return;
    if (!healGpuLiveRef.current) { reapplyHeal(); return; }
    finishHealJobRef.current();
    const prev = h.out;
    for (let y = prev.y; y < prev.y + prev.h; y++) {
      const o = (y * s.W + prev.x) * 4;
      s.base.data.set(h.src.subarray(o, o + prev.w * 4), o);
      h.alpha.fill(0, y * s.W + prev.x, y * s.W + prev.x + prev.w);
    }
    healRevRef.current++;
    const rect = fieldBounds(s.W, s.H, h.field, { ox: h.ox, oy: h.oy, s: h.sA, cx: h.c.x, cy: h.c.y });
    if (!rect) { h.out = { x: prev.x, y: prev.y, w: 0, h: 0 }; renderPixelRect(prev); stopHealGpu(); return; }
    h.rect = rect; h.out = rect;
    healJobRef.current = { rect, prev, y: rect.y, ks: h.sB / h.sA, raf: 0 };
    stepHealJob(7);
  };
  /** 正式結果已經畫進照片之後才收掉疊層（同一格，不會閃） */
  const stopHealGpu = () => {
    if (!healGpuLiveRef.current) return;
    healGpuLiveRef.current = false;
    const ov = healPrevRef.current;
    if (ov) { ov.getContext('2d')!.clearRect(0, 0, ov.width, ov.height); ov.style.display = 'none'; }
  };
  /** 羽化／透明度：有一處正在修補時直接改它（邊拉邊看），沒有的話就是下一筆的設定 */
  const setHealFeatherLive = (v: number) => {
    setHealFeather(v);
    const h = healRef.current;
    if (h) { h.op.hard = 100 - v; scheduleHeal(); }
  };
  const setHealOpacityLive = (v: number) => {
    setHealOpacity(v);
    const h = healRef.current;
    if (h) { h.op.opacity = v / 100; scheduleHeal(); }
  };

  /* ── 移動／縮放 A（目標）、B（來源）─────────────────────────
     只動選中的那一個。A 動的時候來源留在原地（位移反向變）；B 動就是換來源。
     框直接改屬性（不經過 React），像素下一格才重算。 */
  type HealGest = {
    mode: 'pending' | 'drag' | 'pinch' | 'locked'; id: number;
    x0: number; y0: number;          // 單指：按下的螢幕座標；雙指：兩指中心
    d0: number;                      // 雙指一開始的距離
    ax: number; ay: number; bx: number; by: number; sA: number; sB: number;   // 開始時 A、B 的中心與大小
  };
  const healGestRef = useRef<HealGest | null>(null);
  /** 移動、縮放 A 的時候，實線暫時收起來（才看得清楚底下蓋上去的樣子） */
  const [healMoving, setHealMoving] = useState(false);
  /** 一個螢幕像素＝幾個工作像素 */
  const workPerScreen = () => {
    const s = sessionRef.current, v = viewRef.current;
    return s && v ? s.W / Math.max(1, v.getBoundingClientRect().width) : 1;
  };
  const healSnap = (h: HealState) => {
    const ax = h.c.x + h.ox, ay = h.c.y + h.oy;
    return { ax, ay, bx: ax + h.op.dx, by: ay + h.op.dy, sA: h.sA, sB: h.sB };
  };
  const beginHealGesture = () => {
    const h = healRef.current;
    if (!h) return;
    const pts = [...pointersRef.current.entries()];
    const cur = healGestRef.current;
    if (pts.length >= 2) {
      // 第二根手指：從現在的位置開始縮放（第一根手指已經拖過的部分保留）
      const [[, a], [, b]] = pts;
      healGestRef.current = { mode: 'pinch', id: -1, x0: (a.x + b.x) / 2, y0: (a.y + b.y) / 2, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), ...healSnap(h) };
      setHealMoving(healSelRef.current === 'dst');
      startHealGpu();
      return;
    }
    if (cur && cur.mode === 'locked') return;
    const [id, p] = pts[0];
    healGestRef.current = { mode: 'pending', id, x0: p.x, y0: p.y, d0: 1, ...healSnap(h) };
  };
  /** 把 A／B 擺到 (cx, cy)、大小 sc：框留在照片裡（框比照片大就置中） */
  const fitCenter = (h: HealState, cx: number, cy: number, sc: number) => {
    const s = sessionRef.current!;
    const hw = h.c.hw * sc, hh = h.c.hh * sc;
    return {
      x: hw * 2 >= s.W ? s.W / 2 : clamp(cx, hw, s.W - hw),
      y: hh * 2 >= s.H ? s.H / 2 : clamp(cy, hh, s.H - hh),
    };
  };
  const placeHeal = (g: HealGest, mx: number, my: number, f: number) => {
    const h = healRef.current;
    if (!h || !healSelRef.current) return;
    if (healSelRef.current === 'src') {
      const sB = clamp(g.sB * f, HEAL_S_MIN, HEAL_S_MAX);
      const b = fitCenter(h, g.bx + mx, g.by + my, sB);
      const ax = h.c.x + h.ox, ay = h.c.y + h.oy;
      const dx = sB === h.sA ? Math.round(b.x - ax) : b.x - ax, dy = sB === h.sA ? Math.round(b.y - ay) : b.y - ay;
      if (dx === h.op.dx && dy === h.op.dy && sB === h.sB) return;
      h.op.dx = dx; h.op.dy = dy; h.sB = sB;
    } else {
      const sA = clamp(g.sA * f, HEAL_S_MIN, HEAL_S_MAX);
      const a = fitCenter(h, g.ax + mx, g.ay + my, sA);
      // 平移維持整數像素（沒縮放時走最快、最清楚的那條路）
      const ox = Math.round(a.x - h.c.x), oy = Math.round(a.y - h.c.y);
      if (ox === h.ox && oy === h.oy && sA === h.sA) return;
      h.ox = ox; h.oy = oy; h.sA = sA;
      // 來源留在原地
      const ax = h.c.x + ox, ay = h.c.y + oy;
      h.op.dx = h.sB === sA ? Math.round(g.bx - ax) : g.bx - ax;
      h.op.dy = h.sB === sA ? Math.round(g.by - ay) : g.by - ay;
    }
    paintHealBoxes();
    scheduleHeal();
  };
  const moveHealGesture = (e: PointerEvent) => {
    const g = healGestRef.current;
    if (!g || g.mode === 'locked') return;
    const k = workPerScreen();
    if (g.mode === 'pinch') {
      const pts = [...pointersRef.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      placeHeal(g, ((a.x + b.x) / 2 - g.x0) * k, ((a.y + b.y) / 2 - g.y0) * k, d / g.d0);
      return;
    }
    if (e.pointerId !== g.id) return;
    if (g.mode === 'pending') {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_START_PX) return;
      if (!healSelRef.current) return;   // 都沒選：單指拖曳不動任何東西
      g.mode = 'drag';
      setHealMoving(healSelRef.current === 'dst');
      startHealGpu();
    }
    placeHeal(g, (e.clientX - g.x0) * k, (e.clientY - g.y0) * k, 1);
  };
  /** (x, y)（工作像素）按在哪一個框上（筆觸外擴一點點，手指比較好抓）。兩個都中的話，換成另一個 */
  const hitHeal = (x: number, y: number): 'src' | 'dst' | null => {
    const h = healRef.current;
    if (!h) return null;
    const reach0 = h.r0 + Math.max(h.r0 * 0.25, 12 * workPerScreen());
    const near = (cx: number, cy: number, sc: number) => {
      // 換回原始筆觸的座標再比
      const qx = h.c.x + (x - cx) / sc, qy = h.c.y + (y - cy) / sc, reach = reach0 / Math.min(1, sc);
      for (let j = 0; j < h.pts0.length; j += 2) if (Math.hypot(qx - h.pts0[j], qy - h.pts0[j + 1]) <= reach) return true;
      return false;
    };
    const sn = healSnap(h);
    const inSrc = near(sn.bx, sn.by, h.sB), inDst = near(sn.ax, sn.ay, h.sA);
    if (inSrc && inDst) return healSelRef.current === 'src' ? 'dst' : 'src';
    return inSrc ? 'src' : inDst ? 'dst' : null;
  };
  /** 手指離開：拖完／縮放完就把位置定下來；只是點一下的話，點到哪個框就選哪個 */
  const upHealGesture = (e: PointerEvent) => {
    const g = healGestRef.current, h = healRef.current;
    if (!g) return;
    const left = pointersRef.current.size;
    if (g.mode === 'pending' && e.pointerId === g.id) {
      healGestRef.current = null;
      const s = sessionRef.current, v = viewRef.current;
      if (h && s && v) {
        const r = v.getBoundingClientRect();
        const [bx, by] = toBase((e.clientX - r.left) * (s.W / r.width), (e.clientY - r.top) * (s.H / r.height));
        // 點到框＝選它；點到 A、B 以外的地方＝取消選取
        const kind = hitHeal(bx, by);
        if (kind !== healSelRef.current) setHealSel(kind);
      }
      return;
    }
    if (g.mode === 'pinch' && left >= 2) return;
    if (g.mode === 'drag' && e.pointerId !== g.id) return;
    // 縮放完還有一根手指留著：等全部離開，不要變成拖曳
    healGestRef.current = left > 0 ? { ...g, mode: 'locked' } : null;
    setHealMoving(false);
    if (h) {
      if (healRafRef.current) { cancelAnimationFrame(healRafRef.current); healRafRef.current = 0; }
      commitHealGesture();
      syncHealOp(h);
      saveBeautyDraft();
    }
  };
  upHealGestureRef.current = upHealGesture;

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
          const e = Math.ceil(R + 2 * LIQUIFY_SCALE + 2);
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
    } else if (c.tool === 'patch' && strokePtsRef.current.length && strokeUnionRef.current && strokeSrcRef.current && strokeAlphaRef.current) {
      runPatch(strokePtsRef.current.slice(), R, strokeUnionRef.current, strokeSrcRef.current, strokeAlphaRef.current);
    } else if (c.tool === 'clone' && strokePtsRef.current.length && strokeUnionRef.current && strokeSrcRef.current && strokeAlphaRef.current) {
      runClone(strokePtsRef.current.slice(), R, strokeUnionRef.current, strokeSrcRef.current, strokeAlphaRef.current);
    } else if (strokePtsRef.current.length) {
      const L = strokeLayerRef.current;
      if (c.tool === 'makeup') pushOp({ k: 'makeup', pts: strokePtsRef.current.slice(), r: R, strength: c.intensity / 100, rgb: hexToRgb(c.makeupColor) });
      else if (L) pushOp({ k: 'stroke', kind: L.kind, pts: strokePtsRef.current.slice(), r: L.R, strength: L.strength });
    }
    strokeLayerRef.current = null;

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
  }, [beginStroke, brushRadius, dab, drawRing, isTapOnly, pushOp, render, renderPixelRect, toBase, runPatch, runClone]);

  useEffect(() => {
    const move = (e: PointerEvent) => handleMoveRef.current(e);
    const up = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      // 所有手指都離開才解鎖，否則放開一根手指會馬上變成畫筆
      if (pointersRef.current.size === 0) gestureLockRef.current = false;
      if (healGestRef.current) { upHealGestureRef.current(e); return; }
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
  /* 嵌在編輯器裡：按住看的是照片最原始的樣子（跟濾鏡、調節那些分頁的前後對比同一張），
     不是人像拿到的那張（它可能已經套過仿色、合併過、其他人像修改） */
  const originalRef = useOriginalImage(embedded?.getOriginalSrc?.() ?? null);
  useEffect(() => {
    const s = sessionRef.current, cv = viewRef.current;
    if (!s || !cv || isLoading) return;
    if (showOriginal) {
      const g = cv.getContext('2d')!, im = originalRef.current;
      if (embedded && im) drawOriginalInto(g, im, cv.width, cv.height);
      else g.putImageData(s.orig, 0, 0);
    }
    else render();
  }, [showOriginal, isLoading, render]);

  /* 上一次「存進歷史紀錄」時做到第幾步。
     按過儲存之後直接離開，不該又用預覽再蓋一筆一模一樣的。 */
  const recordedOpsRef = useRef(-1);

  /** 離開美顏時，如果動過但沒有儲存，也記一筆到歷史紀錄。
      縮圖直接用畫面上的預覽（已經是顯示解析度，很小很安全）——
      跟「修圖」那邊的做法完全一樣。 */
  const recordProgress = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.opsApplied <= 0) return;                 // 一筆都沒動過
    if (recordedOpsRef.current === s.opsApplied) return; // 這個狀態剛剛已經記過了
    const cv = viewRef.current;
    if (!cv || !cv.width || !cv.height) return;
    try {
      // 畫面上可能正按著「看原圖」，那張是原圖不是成品 —— 先用同一支 render 重畫回來
      if (showOriginal) render();
      recordedOpsRef.current = s.opsApplied;
      await addExport('beauty', cv.toDataURL('image/png'), imageSrc, { ops: s.ops.slice(0, s.opsApplied) });
    } catch { /* 記錄失敗不能影響離開 */ }
  }, [imageSrc, showOriginal, render]);

  const requestLeave = useCallback(async () => {
    const currentOps = sessionRef.current?.opsApplied ?? 0;
    if (currentOps === initialOpsCountRef.current) {
      onCancel(Boolean(initialState));
      return;
    }
    const choice = onRequestExit ? await onRequestExit() : 'discard';
    if (choice === 'cancel') return;
    if (choice === 'save') {
      const s = sessionRef.current;
      if (s) await saveToolDraft('beauty', imageSrc, { ops: s.ops.slice(0, s.opsApplied) });
      await recordProgress();
    }
    onCancel(choice === 'save');
  }, [initialState, onRequestExit, onCancel, imageSrc, recordProgress]);

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

    // 手機上成品面積有上限（見 utils/exportLimits）：48MP 照片原尺寸重播會讓記憶體爆掉閃退
    const sc = Math.min(1, EXPORT_MAX / Math.max(img.width, img.height)) * safeScale(img.width, img.height);
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
    // 超過手機畫布上限的大照片：先在上限內算，最後用導向上採樣做出原尺寸（見 utils/fullResExport）
    const big = safeScale(img.width, img.height) < 1;
    const orig = big ? base.data.slice() : null;

    const field = createLiquifyField(FW, FH);
    replayOps(s.ops, s.opsApplied, base, field, FW, FH, k);

    if (field.max > 0) {
      const out = ctx.createImageData(FW, FH);
      warpRegion(base, FW, FH, field, out, { x: 0, y: 0, w: FW, h: FH });
      ctx.putImageData(out, 0, 0);
    } else {
      ctx.putImageData(base, 0, 0);
    }
    if (orig) {
      const P = ctx.getImageData(0, 0, FW, FH).data; c.width = c.height = 0;
      const u = await fullResFromProcessed(img, P, orig, FW, FH, 'image/png');
      if (u) return u;
    }
    return canvasToUrl(c);
  }, [imageSrc]);

  /* 嵌在編輯器裡：切分頁或按「完成」時，馬上交出工作解析度的成品（同步，不用等），
     原尺寸那張留到存檔才算。沒動過就是 null，不換照片。 */
  const takeResult = (): StudioResult | null => {
    const s = sessionRef.current;
    if (!s) return null;
    // 修補調到一半就離開（切去別的分頁、按儲存）＝把這一處定下來，跟按「修補」收尾一樣
    if (healRef.current) { endHealEdit(); render(); }
    /* 交出去之後工具不會重開（照片就是它自己畫出來的那張），所以要記得交到哪一步：
       沒再動過就回 null，切分頁時不會白白重換一次照片 */
    const sig = `${s.ops.length}:${s.opsApplied}:${healRevRef.current}`;
    if (sig === committedSigRef.current) return null;
    if (s.opsApplied <= 0 && committedSigRef.current === '') return null;
    committedSigRef.current = sig;
    const c = document.createElement('canvas');
    c.width = s.W; c.height = s.H;
    const g = c.getContext('2d')!;
    const view = viewRef.current;
    if (view && view.width === s.W && view.height === s.H && !showOriginal && !paintingRef.current) {
      // 畫面上那張就是成品（同一個解析度）：直接複製，不用再整張重算液化
      g.drawImage(view, 0, 0);
    } else if (s.lq.max > 0) {
      const out = g.createImageData(s.W, s.H);
      warpRegion(s.base, s.W, s.H, s.lq, out, { x: 0, y: 0, w: s.W, h: s.H });
      g.putImageData(out, 0, 0);
    } else g.putImageData(s.base, 0, 0);
    const ops = s.ops.slice(0, s.opsApplied), W = s.W;
    return { preview: c, session: sessionIdRef.current, bake: (src: string) => renderBeautyOn(src, ops, ops.length, W) };
  };
  if (embedded) embedded.commitRef.current = takeResult;
  if (embedded?.viewApi) embedded.viewApi.current.beauty = {
    get: () => { const v = viewTRef.current; return centerViewToShared(v.k, v.tx, v.ty, stageCenter()); },
    set: (sv) => { const v = sharedToCenterView(sv, stageCenter()); applyView(v.k, v.tx, v.ty); },
  };
  const onPaintedRef = useRef(onPainted); onPaintedRef.current = onPainted;
  useEffect(() => { if (!isLoading) onPaintedRef.current?.(); }, [isLoading]);
  useEffect(() => () => { if (embedded) embedded.commitRef.current = null; }, []);
  const finishEmbedded = () => { if (embedded) embedded.onDone(takeResult()); };

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
        if (cur) recordedOpsRef.current = cur.opsApplied;
        addExport('beauty', url, imageSrc, cur ? { ops: cur.ops.slice(0, cur.opsApplied) } : null);
      }
      else setSaveState('idle');
    }, 40);
  };


  const sliderRow = (label: string, value: number, min: number, max: number, onChange: (v: number) => void) => (
    <div className="flex items-center gap-3 h-6">
      <span className="text-[10px] font-bold tracking-[0.15em] text-white/40 w-12 shrink-0">{label}</span>
      <div className="slider-wrap flex-1" style={{height:22}}>
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
      </div>
      <span className="text-[11px] font-mono tabular-nums text-white/80 w-8 text-right shrink-0">{value}</span>
    </div>
  );

  /* 選到磨皮：趁閒置把整張的目標層一塊一塊先算好，第一筆下去就不用等（從畫面中間往外算） */
  useEffect(() => {
    if (tool !== 'smooth' || isLoading) return;
    const s = sessionRef.current; if (!s) return;
    const probe = new StrokeLayer(s.base.data, s.W, s.H, 'smooth', 0, null, smoothTargetsRef.current);
    const nx = probe.tilesX, ny = probe.tilesY, cx = (nx - 1) / 2, cy = (ny - 1) / 2;
    const order: [number, number][] = [];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) order.push([x, y]);
    order.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    let i = 0, id = 0, stop = false;
    const ric = (window as any).requestIdleCallback as ((f: (d: { timeRemaining: () => number }) => void) => number) | undefined;
    const step = (d?: { timeRemaining: () => number }) => {
      if (stop) return;
      const until = performance.now() + Math.min(8, d ? Math.max(2, d.timeRemaining()) : 6);
      const cur = sessionRef.current; if (!cur) return;
      // 每次都拿現在的像素（復原／重做會整張換掉）
      const warm = new StrokeLayer(cur.base.data, cur.W, cur.H, 'smooth', 0, null, smoothTargetsRef.current);
      // 正在畫的時候不搶（筆刷自己會算需要的那幾塊）
      while (i < order.length && performance.now() < until && !paintingRef.current) { warm.warmTile(order[i][0], order[i][1]); i++; }
      if (i < order.length) id = ric ? ric(step) : window.setTimeout(step, 16);
    };
    id = ric ? ric(step) : window.setTimeout(step, 16);
    return () => { stop = true; if (ric) (window as any).cancelIdleCallback?.(id); else clearTimeout(id); };
  }, [tool, isLoading, canUndo, canRedo]);

  const viewport=useStandaloneToolViewport();
  /* 還在解析（ratio 還沒有）的那一下先相信編輯器給的框：放的是同一張照片 */
  const ratioNum = ratio ? (() => { const [a, b] = ratio.split('/').map(Number); return a > 0 && b > 0 ? a / b : null; })() : (align ? align.width / align.height : null);
  const fitPad = useAlignPad(embedded ? align : null, stageRef, ratioNum);
  return (
    <div ref={embedded ? undefined : viewport.ref} data-beauty-embedded={embedded ? '1' : undefined}
      className={embedded ? 'absolute inset-0 bg-[#080808] flex flex-col font-sans text-white overflow-hidden beauty-root'
        : `safe-top relative w-full h-[100dvh] bg-[#080808] z-[60] flex flex-col font-sans text-white overflow-hidden beauty-root ${viewport.standalone?'standalone-tool-viewport':''}`}>
      <style>{`
        ${standaloneToolViewportCSS}
        ${ALIGN_FILL_CSS}
        .beauty-root {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
        }
        .beauty-swatch{position:relative;overflow:visible;-webkit-tap-highlight-color:transparent}
        .beauty-swatch-outline{position:absolute;left:-2px;top:-2px;width:32px;height:32px;overflow:visible;pointer-events:none}
        .beauty-root .allow-callout {
            -webkit-touch-callout: default !important;
            -webkit-user-select: auto !important;
            user-select: auto !important;
            pointer-events: auto !important;
        }
        .beauty-range {
            --thumb-w: 16px;
            -webkit-appearance: none;
            appearance: none;
            /* 33px ＋ 上下各 -5.5px：看起來還是 22px 高，觸控範圍變 1.5 倍 */
            height: 22px;
            background: transparent;
            cursor: pointer;
        }
        .slider-wrap > input.beauty-range { height:22px; margin:-11px 0 0; }
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

      {saveState === 'idle' && isLoading && !embedded && (
        <div className="absolute inset-0 z-[120] flex items-center justify-center bg-[#080808]/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4 text-white">
            <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
            <p className="text-[10px] font-black tracking-[0.2em] uppercase animate-pulse opacity-70">解析中...</p>
          </div>
        </div>
      )}

      {saveState === 'success' && finalImage && (
        <div data-export-screen className="absolute inset-0 z-[110] bg-black flex flex-col animate-in fade-in duration-500">
          <ExportActionLift />
          <header className="h-14 flex items-center px-5 shrink-0 z-20 bg-black/40 backdrop-blur-xl">
            <button
              onClick={() => { recordProgress(); onHome(); }}
              className="p-2 -ml-2 text-[#888] hover:text-white transition-colors active:scale-90"
            >
              <Icon name="chevron_left" className="text-2xl" />
            </button>
          </header>
          <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
            <div data-export-media className="relative shadow-2xl rounded overflow-hidden max-h-[52vh] max-w-full mb-4">
              <img src={finalImage} alt="美顏結果" className="max-w-full max-h-[52vh] object-contain allow-callout relative z-10" />
              <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded"></div>
            </div>
          </div>
          <div data-export-actions className="flex flex-col gap-3 px-6 pb-8">
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

      {saveState !== 'success' && embedded && (
        <header className="h-14 relative flex items-center justify-between px-4 shrink-0 bg-black/40 z-20">
          <div className="w-24">
            {/* 跟編輯器其他分頁同一顆：返回（離開編輯） */}
            <button onClick={embedded.onBack || embedded.onCancel} data-embedded-back aria-label="返回" className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90">
              <ChevronLeft size={22} />
            </button>
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4">
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
          {/* 跟編輯器其他分頁同一顆：儲存＋匯出選項（三個點） */}
          <div className="flex justify-end items-center shrink-0">
            <div className="h-8 flex items-center bg-white text-black rounded-full overflow-hidden">
              <button onClick={embedded.onSave || finishEmbedded} data-embedded-done className="px-4 py-1.5 text-[11px] font-black whitespace-nowrap">儲存</button>
              <span aria-hidden="true" className="w-px h-4 bg-black/20" />
              <button aria-label="匯出選項" onClick={embedded.onMore} className="h-8 px-2 flex items-center"><Icon name="more_horiz" className="text-xl" /></button>
            </div>
          </div>
        </header>
      )}
      {saveState !== 'success' && !embedded && (
        <header className="h-14 relative flex items-center justify-between px-4 shrink-0 bg-black/40 backdrop-blur-xl z-20">
          <div className="w-24">
            {/* 退出鍵跟經典拼圖同一顆：左箭頭、同樣的顏色與按壓回饋 */}
            <button onClick={requestLeave} className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90">
              <ChevronLeft size={22} />
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
        onPointerDown={(e) => {
          // 舞台上的按鈕（前後對比、色票、液化模式）自己處理
          if ((e.target as HTMLElement).closest('button, label, input')) return;
          onPointerDown(e);
        }}
        className="flex-1 relative bg-[#080808] min-h-0 overflow-hidden"
        style={{ touchAction: 'none' }}
        onWheel={(e) => {
          const c = stageCenter();
          const v = viewTRef.current;
          const k = clamp(v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18), VIEW_K_MIN, 6);
          const ax = e.clientX - c.x, ay = e.clientY - c.y;
          const cx = (ax - v.tx) / v.k, cy = (ay - v.ty) / v.k;
          applyView(k, ax - cx * k, ay - cy * k);
        }}
      >
        <div
          className={`absolute inset-0 flex items-center justify-center ${fitPad ? 'studio-fit' : 'p-4'}`}
          style={{ transform: `translate(${viewT.tx}px, ${viewT.ty}px) scale(${viewT.k})`, ...fitPad }}
        >
          <div
            className="relative flex items-center justify-center max-w-full max-h-full"
            style={{ aspectRatio: ratio, touchAction: 'none' }}
          >
            {/* 拖動／縮放修補框時的 GPU 預覽（見 startHealGpu） */}
            <canvas ref={healPrevRef} data-heal-preview className="absolute pointer-events-none rounded-sm" style={{ display: 'none', zIndex: 1 }} />
            <canvas
              ref={viewRef}
              className="beauty-paint max-w-full max-h-full object-contain rounded-sm block"
              style={{ touchAction: 'none' }}
              onPointerLeave={(e) => {
                // 只有滑鼠移出去才收掉筆刷圈。觸控在 pointerup 之後會緊接著送出
                // pointerleave，先前會把鬆手那一下的閃現整個吃掉。
                if (e.pointerType === 'mouse' && !paintingRef.current) drawRing(null);
              }}
            />
          </div>
        </div>




        {/* 修補的兩個框：A（目標）實線、B（來源）虛線，都是一條細白線，兩個都可以拖。
            畫在縮放層外面（不跟著 CSS 縮放一起被放大），任何倍率下線條都一樣細、一樣清楚 ——
            以前放在縮放層裡，放大時整層是當成一張圖被拉大的，線就糊了。 */}
        {tool === 'clone' && healEdit && sessionRef.current && !showOriginal && (
          <svg data-heal-overlay className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-[5]">
            <g ref={healRootRef}>
              {/* 選中的全亮，沒選中的淡一點（50%）；都沒選時兩個都淡 */}
              <g ref={healDstGRef} data-heal-box="dst" data-selected={healSel === 'dst' ? '1' : '0'} style={{ opacity: healMoving ? 0 : healSel === 'dst' ? 1 : 0.5, transition: 'opacity 140ms ease' }}>
                <path d={healContour} fill="none" stroke="#fff" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </g>
              <g ref={healSrcGRef} data-heal-box="src" data-selected={healSel === 'src' ? '1' : '0'} style={{ opacity: healSel === 'src' ? 1 : 0.5, transition: 'opacity 140ms ease' }}>
                <path ref={healSrcPathRef} d={healContour} fill="none" stroke="#fff" strokeWidth={1.25} strokeDasharray="4 3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </g>
            </g>
          </svg>
        )}
        {/* 嵌在編輯器裡、還在解析的那一下：先放同一張照片，不要露出一塊黑 */}
        {embedded && isLoading && (
          <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${fitPad ? 'studio-fit' : 'p-4'}`} style={fitPad || undefined}>
            <img src={imageSrc} alt="" className="max-w-full max-h-full object-contain rounded-sm" draggable={false}
              ref={el => paintedWhenDecoded(el, () => onPaintedRef.current?.())} onLoad={e => paintedWhenDecoded(e.currentTarget, () => onPaintedRef.current?.())} />
          </div>
        )}
        {/* 修補的提示：跟遮色片的提示同一款，放在照片上緣往下一點 */}
        <div data-beauty-heal-tip={tool === 'clone' && !healEdit ? 'on' : 'off'}
          className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[12px] text-white/90 whitespace-nowrap"
          style={{ top: Math.round(imgTop + 16), opacity: tool === 'clone' && !healEdit && !sizingBrush && !patchBusy ? 1 : 0, transition: 'opacity 180ms ease' }}>
          塗抹要修補的地方
        </div>
        {/* 刪除計算中：預覽上緣一顆小膠囊（不擋住畫面，算完自己消失） */}
        <div data-beauty-patch-busy={patchBusy ? 'on' : 'off'}
          className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[12px] text-white/90 whitespace-nowrap"
          style={{ top: Math.round(imgTop + 16), opacity: patchBusy ? 1 : 0, transition: 'opacity 180ms ease' }}>
          <span className="w-3 h-3 rounded-full border-2 border-white/25 border-t-white animate-spin" />刪除中
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

        {/* 嵌在編輯器裡：修容的色票浮在預覽下緣，跟前後對比鍵同一排（不佔下面的工具列） */}
        {embedded && tool === 'makeup' && (
          <div data-beauty-swatches className="absolute left-3 right-[60px] bottom-[14px] z-20 flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1 px-0.5"
            style={{ WebkitMaskImage: 'linear-gradient(90deg,#000 calc(100% - 22px),transparent)', maskImage: 'linear-gradient(90deg,#000 calc(100% - 22px),transparent)' }}>
            <label title="自選顏色" className="w-7 h-7 rounded-full shrink-0 relative cursor-pointer flex items-center justify-center overflow-hidden"
              style={{ background: 'conic-gradient(#f43,#fa3,#fd3,#3d6,#3cf,#63f,#f3a,#f43)' }}>
              <span className="absolute inset-[5px] rounded-full bg-[#080808] flex items-center justify-center"><Icon name="colorize" className="text-[13px] text-white" /></span>
              <input type="color" value={makeupColor} onChange={e => setMakeupColor(e.target.value)} aria-label="自選顏色" className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
            {LIP_PRESETS.map(c => (
              <button key={c.hex} onClick={() => setMakeupColor(c.hex)} title={c.name} aria-label={c.name}
                className="beauty-swatch w-7 h-7 rounded-full shrink-0 transition-transform active:scale-90" style={{ backgroundColor: c.hex }}>
                {makeupColor.toLowerCase() === c.hex.toLowerCase() && <svg className="beauty-swatch-outline" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" stroke="white" strokeWidth="2" /></svg>}
              </button>
            ))}
          </div>
        )}
        {/* 嵌在編輯器裡：液化的五種模式也浮在預覽下緣（跟修容的色票同一個位置），不跟工具擠在同一排 */}
        {embedded && tool === 'liquify' && (
          <div data-beauty-lq-modes className="absolute left-3 right-[60px] bottom-[14px] z-20 flex items-center gap-2 overflow-x-auto no-scrollbar py-1 px-0.5"
            style={{ WebkitMaskImage: 'linear-gradient(90deg,#000 calc(100% - 22px),transparent)', maskImage: 'linear-gradient(90deg,#000 calc(100% - 22px),transparent)' }}>
            {LIQUIFY_PRESETS.map(m => (
              <button key={m.id}
                onClick={() => {
                  setLqPreset(m.id);
                  if (m.brush !== undefined) setBrush(b => ({ ...b, liquify: m.brush! }));
                  if (m.force !== undefined) setForceMap(f => ({ ...f, liquify: m.force! }));
                }}
                className={`h-7 px-3 rounded-full text-[11px] shrink-0 transition-colors active:scale-95 ${lqPreset === m.id ? 'bg-white text-black font-bold' : 'bg-black/45 backdrop-blur-sm text-white/80'}`}>
                {m.label}
              </button>
            ))}
          </div>
        )}
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

      {embedded ? (() => {
        /* 嵌在編輯器裡：跟「調節」完全同一套欄位（滑桿欄 5rem ＋ 工具欄 6rem、同樣的底色與按鈕），
           預覽區因此跟編輯器一樣大，兩邊切換時圖片不會動。 */
        const sliders: [string, number, number, number, (v: number) => void][] =
          tool === 'blemish' ? [['筆刷', brush.blemish, BRUSH_RANGE.blemish[0], BRUSH_RANGE.blemish[1], v => setBrush(b => ({ ...b, blemish: v }))]]
          : tool === 'patch' ? [['筆刷', brush.patch, BRUSH_RANGE.patch[0], BRUSH_RANGE.patch[1], v => setBrush(b => ({ ...b, patch: v }))]]
          : tool === 'clone' ? [['羽化', healFeather, 0, 100, setHealFeatherLive], ['透明度', healOpacity, 0, 100, setHealOpacityLive]]
          : tool === 'wrinkle' ? [['筆刷', brush.wrinkle, BRUSH_RANGE.wrinkle[0], BRUSH_RANGE.wrinkle[1], v => setBrush(b => ({ ...b, wrinkle: v }))], ['力度', force, 10, 100, setForce]]
          : tool === 'smooth' ? [['筆刷', brush.smooth, BRUSH_RANGE.smooth[0], BRUSH_RANGE.smooth[1], v => setBrush(b => ({ ...b, smooth: v }))], ['力度', force, 10, 100, setForce]]
          : tool === 'liquify' ? [['筆刷', brush.liquify, BRUSH_RANGE.liquify[0], BRUSH_RANGE.liquify[1], v => setBrush(b => ({ ...b, liquify: v }))], ['力度', force, 10, 100, setForce]]
          : [['筆刷', brush.makeup, BRUSH_RANGE.makeup[0], BRUSH_RANGE.makeup[1], v => setBrush(b => ({ ...b, makeup: v }))], ['濃度', Math.round(intensity * 2), 0, 100, v => setIntensity(v / 2)]];
        const two = sliders.length > 1;
        const three = sliders.length > 2;
        return (
          /* 上緣那條分隔線跟編輯器同一條：底色同樣是 #111（白 5% 疊在 #111 上才是同一個亮度，疊在 #080808 上會淡一截、看起來特別細），
             高度少 1px —— 外框底邊讓開了分頁列的那 1px，不扣掉的話整欄會高 1px、線的位置對不上 */
          <div data-beauty-controls className="shrink-0 flex flex-col border-t border-white/5 bg-[#111]" style={{ height: 'calc(11rem - 1px)' }}>
            <div className={`h-[5rem] shrink-0 bg-[#111] border-b border-white/5 ${three ? 'px-4 grid grid-cols-3 gap-3 items-center' : two ? 'px-5 grid grid-cols-2 gap-5 items-center' : 'px-8 flex flex-col justify-center'}`}>
              {sliders.map(([label, value, min, max, set]) => (
                <div key={`${tool}-${label}`} className="w-full min-w-0">
                  {/* 兩根並排時文字對齊滑軌的起點（細滑軌兩端各留 9px），不要貼在最左邊 */}
                  <div className={`flex justify-between items-center mb-1 ${two ? 'px-2.5' : 'px-1'}`}>
                    <span className={`font-black text-white/40 uppercase ${two ? 'text-[9px] tracking-[0.12em]' : 'text-[10px] tracking-[0.2em]'}`}>{label}</span>
                    <span className={`font-sans tabular-nums font-bold bg-white/10 rounded ${two ? 'text-[10px] leading-none px-1.5 py-[4px]' : 'text-xs px-2 py-0.5'}`}>{value}</span>
                  </div>
                  <div className={`slider-wrap relative flex items-center justify-center touch-none ${two ? 'h-[26px]' : 'h-[30px]'}`}>
                    <input type="range" min={min} max={max} value={value} aria-label={label}
                      onChange={ev => set(Number(ev.target.value))}
                      onPointerDown={label === '筆刷' ? () => setSizingBrush(true) : undefined}
                      onPointerUp={label === '筆刷' ? () => setSizingBrush(false) : undefined}
                      onPointerCancel={label === '筆刷' ? () => setSizingBrush(false) : undefined}
                      onBlur={label === '筆刷' ? () => setSizingBrush(false) : undefined}
                      style={two ? { left: 0, width: '100%', height: 26, margin: '-13px 0 0', touchAction: 'none', ['--thumb-w' as any]: '18px' } : undefined}
                      className={two ? 'custom-range dense' : 'custom-range compact'} />
                  </div>
                </div>
              ))}
            </div>
            <div data-beauty-toolbar className="flex-1 min-h-0 bg-[#080808] flex items-center px-4 gap-2 overflow-x-auto no-scrollbar">
              {BEAUTY_TOOLS.map(t => (
                <button key={t.id} onClick={() => pickTool(t.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${tool === t.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40'}`}>
                    <Icon name={t.icon} className="text-lg" fill={tool === t.id} />
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${tool === t.id ? 'text-white' : 'text-white/20'}`}>{t.label}</span>
                  <div className="w-1 h-1 rounded-full mt-0.5 bg-transparent" />
                </button>
              ))}
            </div>
          </div>
        );
      })() : (<>
      {/* 參數區固定高度：切換工具時圖片不會跳動，滑桿位置也永遠對齊。
          額外控制列即使沒有內容也保留空間，四個工具的滑桿才會落在同一個位置。 */}
      <div className="h-[144px] shrink-0 border-t border-white/[0.06] py-3 flex flex-col" data-beauty-controls>
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
                  className={`beauty-swatch w-7 h-7 rounded-full shrink-0 transition-transform active:scale-90 ${
                    makeupColor.toLowerCase() === c.hex.toLowerCase()
                      ? 'beauty-swatch-selected'
                      : ''
                  }`}
                  style={{ backgroundColor: c.hex }}
                >
                  {makeupColor.toLowerCase()===c.hex.toLowerCase()&&<svg className="beauty-swatch-outline" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="none" stroke="white" strokeWidth="2"/></svg>}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="flex-1 flex flex-col justify-center gap-3 px-5">
        {tool === 'blemish' &&
          sliderRow('筆刷', brush.blemish, BRUSH_RANGE.blemish[0], BRUSH_RANGE.blemish[1], (v) => setBrush(b => ({ ...b, blemish: v })))}
        {tool === 'patch' &&
          sliderRow('筆刷', brush.patch, BRUSH_RANGE.patch[0], BRUSH_RANGE.patch[1], (v) => setBrush(b => ({ ...b, patch: v })))}
        {tool === 'clone' && (
          <>
            {sliderRow('羽化', healFeather, 0, 100, setHealFeatherLive)}
            {sliderRow('透明度', healOpacity, 0, 100, setHealOpacityLive)}
          </>
        )}
        {tool === 'wrinkle' && (
          <>
            {sliderRow('筆刷', brush.wrinkle, BRUSH_RANGE.wrinkle[0], BRUSH_RANGE.wrinkle[1], (v) => setBrush(b => ({ ...b, wrinkle: v })))}
            {sliderRow('力度', force, 10, 100, setForce)}
          </>
        )}
        {tool === 'smooth' && (
          <>
            {sliderRow('筆刷', brush.smooth, BRUSH_RANGE.smooth[0], BRUSH_RANGE.smooth[1], (v) => setBrush(b => ({ ...b, smooth: v })))}
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
            {/* 介面維持 0～100 的細緻刻度，實際筆刷濃度限制在原本的 0～50。 */}
            {sliderRow('濃度', Math.round(intensity * 2), 0, 100, (v) => setIntensity(v / 2))}
          </>
        )}
        </div>
      </div>

      {/* 與獨立編輯器共用 64px 按鈕列及 12px 底部距離，
          分隔線下移後，圖標和文字不會被下緣裁切。 */}
      <div className="border-t border-white/10 bg-black shrink-0" data-beauty-toolbar>
      <div className="flex h-16 pb-3 box-content">
        {BEAUTY_TOOLS.map(t => (
          <button
            key={t.id}
            onClick={() => pickTool(t.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${tool === t.id ? 'text-white' : 'text-white/20'}`}
          >
            <Icon name={t.icon} className="text-xl" fill={tool === t.id} />
            <span className="text-[9px] font-black uppercase tracking-[0.15em]">{t.label}</span>
          </button>
        ))}
      </div>
      </div>

      </>)}

      {saveState === 'processing' && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white">{embedded ? '套用中' : '儲存中'}</p>
          {/* 這一層蓋住返回鍵，所以一定要有出口（見 StuckEscape） */}
          <StuckEscape onEscape={() => setSaveState('idle')} />
        </div>
      )}
    </div>
  );
};
