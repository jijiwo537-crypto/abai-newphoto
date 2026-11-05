import { canvasToUrl, revokeUrl, revokeUrlsLater } from '../utils/blobUrl';
import { safeSize } from '../utils/exportLimits';
import { fullResFromProcessed, originalAt } from '../utils/fullResExport';
/** 讀出畫布像素（GPU 畫布先複製到一般畫布再讀） */
const readPixels = (c: HTMLCanvasElement): Uint8ClampedArray | null => {
  try {
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const g = t.getContext('2d', { willReadFrequently: true })!; g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data; t.width = t.height = 0; return d;
  } catch { return null; }
};
import { addExport } from '../utils/exportHistory';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { saveDraft } from '../utils/toolDraft';
import type { ExitChoice } from '../types';
import { ChevronLeft } from 'lucide-react';
import { Icon } from './Icon';
import { SaveButton } from './SaveButton';
import { BusySpinner } from './BusySpinner';
import { ExportActionLift } from './ExportActionLift';
import { canExportHeic, exportHeic } from '../utils/heicExport';
import { PREMIUM_GLASS } from '../utils/premiumGlass';
import {useStandaloneToolViewport,standaloneToolViewportCSS} from '../utils/useStandaloneToolViewport';
import { StuckEscape } from './StuckEscape';
import { useAlignPad, ALIGN_FILL_CSS, useOriginalImage, drawOriginalInto, centerViewToShared, sharedToCenterView, type AlignRect, type StudioViewApi } from './studioAlign';
import {
  METHODS, METHOD_LABEL, Method,
  sampleRgb, bakeFor, applyLut, Lut3D,
} from '../utils/colorTransfer';
import { LutRenderer } from '../utils/lutGl';
import { useStudioGeo } from './studioGeo';
import type { GeoParams } from '../utils/compose';
import type { StudioResult } from './BeautyStudio';
import { packWeight, buildHueProtectFrom } from '../utils/protectMask';
import { buildSkinMap, skinWeight, withoutSkin, type SkinMap } from '../utils/skinProtect';
import { aiColorMatchLut, warmAiColorMatch, cancelAiColorMatch, type AiEngine } from '../utils/aiColorMatch';
import { sampleMaskAt } from '../utils/colorTransfer';
import { useMatchRefs, addMatchRefs, removeMatchRef } from '../utils/matchRefs';
/** 仿色做法：統計法三種＋AI（CAP-VSTNet 學成 LUT，見 utils/aiColorMatch） */
type Pick = Method | 'cap';
const PICK_LABEL = (m: Pick) => (m === 'cap' ? '專業' : METHOD_LABEL[m]);
const AI_ENGINE: Partial<Record<Pick, AiEngine>> = { cap: 'cap' };
const isAi = (m: Pick) => !!AI_ENGINE[m];
const warmFor = (m: Pick) => { const e = AI_ENGINE[m]; if (e) warmAiColorMatch(e); };
/** 強度上限：標準等統計法 100；專業可以推到 150（比參考圖再更進一步） */
const maxFor = (m: Pick) => (m === 'cap' ? 150 : 100);

interface Props {
  /** 要調色的照片 */
  imageSrc: string;
  /** 嵌在編輯器裡：照片目前的構圖（畫面照構圖顯示，見 studioGeo） */
  geo?: GeoParams | null;
  onCancel: (keepDraft?: boolean) => void;
  onRequestExit?: () => Promise<ExitChoice>;
  onHome: () => void;
  /** 換一張要調色的照片 */
  onImportNew: () => void;
  /** （舊的）交給外面開檔案選擇器：現在參考圖庫在工具自己裡面（見 utils/matchRefs），這個不再用 */
  onPickReference?: () => void;
  /** 外面指定的參考圖（從歷史紀錄點回來時） */
  referenceSrc?: string | null;
  referenceLoading?: boolean;
  /** 從首頁的歷史紀錄點回來時，把當時的參數餵回來 */
  initialState?: any;
  onSendToEditor?: (dataUrl: string) => void;
  /** 嵌在「編輯」的「仿色」分頁裡：不佔整個畫面、不導出，上面一列換成「取消／完成」，
      編輯器切分頁時呼叫 commitRef 拿成品（還沒選參考圖就是 null） */
  embedded?: {
    commitRef: React.MutableRefObject<(() => StudioResult | null) | null>;
    onDone: (res: StudioResult | null) => void;
    onCancel: () => void;
    onSave?: () => void;
    onMore?: () => void;
    onBack?: () => void;
    getOriginalSrc?: () => string | null;
    viewApi?: React.MutableRefObject<Record<string, StudioViewApi | undefined>>;
  };
  /** 嵌在編輯器裡：編輯器預覽圖在螢幕上的框，照片擺在一模一樣的位置 */
  align?: AlignRect | null;
  /** 嵌在編輯器裡：照片第一次真的畫到畫面上了（見 BeautyStudio 的同名參數） */
  onPainted?: () => void;
}

/* iPhone 的照片選擇器關掉之後 Safari 偶爾會把整頁捲一點點（照片是照量好的螢幕位置擺的，一捲就錯位）：捲回原位 */
const fixPageScroll = () => {
  const fix = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    const se = document.scrollingElement as HTMLElement | null;
    if (se && (se.scrollTop || se.scrollLeft)) { se.scrollTop = 0; se.scrollLeft = 0; }
  };
  fix(); requestAnimationFrame(fix); setTimeout(fix, 350);
};

const PREVIEW_MAX = 1400;
const STAT_MAX = 900;   // 統計用的縮圖，再大也不會更準

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const im = new Image();
  if (!src.startsWith('blob:') && !src.startsWith('data:')) im.crossOrigin = 'anonymous';
  im.onload = () => res(im);
  im.onerror = rej;
  im.src = src;
});

const toImageData = (img: HTMLImageElement, max: number): ImageData => {
  const s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
};

export const ColorMatchStudio: React.FC<Props> = ({
  imageSrc, onCancel, onHome, onImportNew, referenceSrc: referenceProp = null, onSendToEditor,
  initialState, onRequestExit, referenceLoading: referenceLoadingProp=false, embedded, align, onPainted, geo,
}) => {
  /* 參考圖庫：很多張、隨時切換、可刪除，離開或換照片都還在（見 utils/matchRefs） */
  const refs = useMatchRefs();
  const [referenceSrc, setReferenceSrc] = useState<string | null>(referenceProp);
  useEffect(() => { if (referenceProp) setReferenceSrc(referenceProp); }, [referenceProp]);
  const [refAdding, setRefAdding] = useState(false);
  const referenceLoading = referenceLoadingProp || refAdding;
  const refInputRef = useRef<HTMLInputElement>(null);
  const onRefFiles = async (files: File[]) => {
    if (!files.length) return;
    setRefAdding(true);
    try { const added = await addMatchRefs(files); if (added[0]) setReferenceSrc(added[0].url); }
    finally { setRefAdding(false); }
  };
  const deleteRef = (id: string, url: string) => {
    removeMatchRef(id);
    if (referenceSrc === url) setReferenceSrc(null);
  };
  const [srcImg, setSrcImg] = useState<HTMLImageElement | null>(null);
  const sg = useStudioGeo(embedded ? geo : null, srcImg ? srcImg.naturalWidth || srcImg.width : 0, srcImg ? srcImg.naturalHeight || srcImg.height : 0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [refImg, setRefImg] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState<ImageData | null>(null);
  const [luts, setLuts] = useState<Record<string, Lut3D> | null>(null);
  const [busy, setBusy] = useState(false);
  /** 正在算的是專業（AI）那一種：加載文字不一樣 */
  const [aiBusy, setAiBusy] = useState(false);
  const [picked, setPicked] = useState<Pick>('mkl');
  const pickedRef = useRef<Pick>('mkl'); pickedRef.current = picked;
  /** AI 模式：亮度也跟著換 */
  const keepL = isAi(picked) ? 0 : 1;
  /** SA-LUT：第二顆 LUT 與情境圖（逐點混合） */
  const [aiError, setAiError] = useState('');
  const [strength, setStrength] = useState(100);
  const strengthInputRef = useRef<HTMLInputElement>(null);
  const strengthTextRef = useRef<HTMLSpanElement>(null);
  const liveStrengthRef = useRef<{ v: number; raf: number; timer: number }>({ v: -1, raf: 0, timer: 0 });
  const paintRef = useRef<(s?: number) => void>(() => {});
  /** 拖滑桿的每一格：數字直接改、下一格畫面 GPU 重畫一次（一格最多一次） */
  const liveStrength = (v: number) => {
    const L = liveStrengthRef.current;
    L.v = v;
    if (strengthTextRef.current) strengthTextRef.current.textContent = String(v);
    if (!L.raf) L.raf = requestAnimationFrame(() => { L.raf = 0; paintRef.current(L.v); });
    window.clearTimeout(L.timer);
    L.timer = window.setTimeout(commitStrength, 250);   // 停下來一下也存（放手的事件偶爾會漏）
  };
  const commitStrength = () => {
    const L = liveStrengthRef.current;
    window.clearTimeout(L.timer);
    if (L.v >= 0) { const v = L.v; L.v = -1; setStrength(v); }
  };
  // 狀態從別的地方改了（換做法、還原紀錄）：滑桿跟數字跟上
  useEffect(() => {
    const el = strengthInputRef.current;
    if (el && Number(el.value) !== strength && liveStrengthRef.current.v < 0) el.value = String(strength);
    if (strengthTextRef.current && liveStrengthRef.current.v < 0) strengthTextRef.current.textContent = String(strength);
  }, [strength]);
  useEffect(() => { const m = maxFor(picked); setStrength(v => Math.min(v, m)); }, [picked]);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [finalPreview, setFinalPreview] = useState<string | null>(null);
  const finalPreviewRef = useRef<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'jpg' | 'png' | 'heic'>('png');
  const [formatOpen, setFormatOpen] = useState(false);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    if (!formatOpen) return;
    const outside = (e: PointerEvent) => {
      if (!formatMenuRef.current?.contains(e.target as Node)) setFormatOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setFormatOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [formatOpen]);
  /* 成品是 blob 網址：換新的之前先回收，離開時也要回收 */
  const finalUrlRef = useRef<string | null>(null);
  const putFinal = useCallback((u: string) => {
    revokeUrl(finalUrlRef.current);
    finalUrlRef.current = u;
    setFinalUrl(u);
  }, []);
  /* 離開時晚一點再回收：導出紀錄的縮圖與分享用的檔案都是非同步去讀這個
     網址的，按下儲存後馬上離開的話會來不及讀完。 */
  // 計時器在 utils/blobUrl 裡跑：寫在這裡的話會抓住整個元件（所有像素），離開後 15 秒都放不掉
  useEffect(() => () => revokeUrlsLater([finalUrlRef.current, finalPreviewRef.current], 15000), []);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /* GPU 版：圖片與三顆 LUT 各上傳一次，之後換做法＝換綁貼圖、動滑桿＝改 uniform，
     每次更新就只有一個 draw call。沒有 WebGL2 就退回 CPU 版。 */
  const glRef = useRef<LutRenderer | null>(null);
  const glWeightRef = useRef<unknown>(null);
  /* 膚色保護（見 utils/skinProtect）：找到臉、學這個人的膚色，算出一張「皮膚圖」。
     原圖的皮膚圖跟參考圖無關，換參考圖不用重算；沒有臉就是全 0（完全不保護）。 */
  const skinRef = useRef<{ img: HTMLImageElement; map: SkinMap; hue: { w: number; h: number; weight: Float32Array } | null } | null>(null);
  const weightRef = useRef<{ w: number; h: number; weight: Float32Array } | null>(null);
  /** 套用時的保護權重（沒有就 null） */
  const useWeight = useCallback(() => weightRef.current, []);
  const glReadyRef = useRef(false);
  /** 用 state 是為了讓備援畫布真的被藏起來（ref 改了不會重繪） */
  const [glReady, setGlReady] = useState(false);
  /* GPU 只負責算，畫面上看到的永遠是同一張一般畫布（canvasRef）：GPU 算完直接複製過去。
     以前是把 GPU 畫布本身掛上去顯示 —— iPhone 的 Safari 擺 WebGL 畫布的位置跟一般畫布差零點幾個像素，
     導入參考圖（換成 GPU 畫布顯示）之後，前後對比、切換分頁時照片就看得出在動。 */
  const present = () => {
    const gl = glRef.current, cvs = canvasRef.current;
    if (!gl || !cvs) return;
    if (cvs.width !== gl.canvas.width || cvs.height !== gl.canvas.height) { cvs.width = gl.canvas.width; cvs.height = gl.canvas.height; }
    const g = cvs.getContext('2d');
    if (g) { g.clearRect(0, 0, cvs.width, cvs.height); g.drawImage(gl.canvas, 0, 0); }
  };
  /** CPU 版才需要：算好的結果先留著，前後對比才切得動 */
  const processedRef = useRef<ImageData | null>(null);

  /* ---- 預覽縮放 ------------------------------------------------------------
     跟創意拼圖一樣自己實作雙指縮放：react-zoom-pan-pinch 靠 touch 事件，
     跟畫布上的 pointer 事件會互搶。這裡沒有筆刷，所以規則很單純 ——
     兩指縮放，放大之後單指拖曳平移。前後對比那顆按鈕不算在內。          */
  const zoomRef = useRef<HTMLDivElement>(null);
  const [viewT, setViewT] = useState({ k: 1, tx: 0, ty: 0 });
  const viewTRef = useRef(viewT);
  viewTRef.current = viewT;
  const ptsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ d0: number; k0: number; cx: number; cy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const stageBox = () => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };
  const applyView = useCallback((k: number, tx: number, ty: number) => {
    const c = stageBox();
    const kk = Math.max(0.5, Math.min(8, k));
    // 限制平移範圍，免得把圖拖出畫面找不回來
    const mx = Math.max(0, (kk - 1) * c.w * 0.5);
    const my = Math.max(0, (kk - 1) * c.h * 0.5);
    setViewT({ k: kk, tx: Math.max(-mx, Math.min(mx, tx)), ty: Math.max(-my, Math.min(my, ty)) });
  }, []);
  // A reference changes color, not the original photograph's framing.
  useEffect(() => { setViewT({ k: 1, tx: 0, ty: 0 }); }, [imageSrc]);

  const onStageDown = (e: React.PointerEvent) => {
    // 前後對比那顆按鈕自己有事情要做，不要被當成縮放
    if ((e.target as HTMLElement).closest('[data-cm-compare],[data-cm-float]')) return;   // 懸空的按鈕也不算
    ptsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 抓不到指標就算了，別讓它把後面設定縮放狀態的程式碼一起中斷掉
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 沒抓到也無所謂 */ }
    const pts = [...ptsRef.current.values()];
    if (pts.length >= 2) {
      panRef.current = null;
      const c = stageBox(), v = viewTRef.current;
      const mx = (pts[0].x + pts[1].x) / 2 - c.x;
      const my = (pts[0].y + pts[1].y) / 2 - c.y;
      pinchRef.current = {
        d0: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        k0: v.k, cx: (mx - v.tx) / v.k, cy: (my - v.ty) / v.k,
      };
    } else if (viewTRef.current.k > 1) {
      const v = viewTRef.current;
      panRef.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty };
    }
  };
  const onStageMove = (e: React.PointerEvent) => {
    if (!ptsRef.current.has(e.pointerId)) return;
    ptsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptsRef.current.values()];
    const pin = pinchRef.current;
    if (pin && pts.length >= 2) {
      const c = stageBox();
      const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      const k = Math.max(0.5, Math.min(8, pin.k0 * (dist / pin.d0)));
      const mx = (pts[0].x + pts[1].x) / 2 - c.x;
      const my = (pts[0].y + pts[1].y) / 2 - c.y;
      applyView(k, mx - pin.cx * k, my - pin.cy * k);
      return;
    }
    const pan = panRef.current;
    if (pan) applyView(viewTRef.current.k, pan.tx + (e.clientX - pan.x), pan.ty + (e.clientY - pan.y));
  };
  const onStageUp = (e: React.PointerEvent) => {
    ptsRef.current.delete(e.pointerId);
    if (ptsRef.current.size < 2) pinchRef.current = null;
    if (ptsRef.current.size === 0) panRef.current = null;
  };

  useEffect(() => {
    const gl = LutRenderer.create();
    glRef.current = gl;
    // GPU 畫布不放進畫面（見 present）
    return () => { gl?.dispose(); glRef.current = null; };
  }, []);

  useEffect(() => { let active=true; loadImage(imageSrc).then(image=>{if(active){skinRef.current=null;weightRef.current=null;setSrcImg(image);}}).catch(() => {});return()=>{active=false;}; }, [imageSrc]);
  useEffect(() => {
    if (!referenceSrc) { setRefImg(null); return; }
    /* 算過的參考圖：不等圖片解碼，這一下就換上它的顏色（解碼完的那一次會直接命中快取，不會再算） */
    const hit = lutCacheRef.current.src === srcImg ? lutCacheRef.current.map.get(new URL(referenceSrc, location.href).href) : undefined;
    if (hit) { setLuts(hit); setBusy(false); }
    let active=true;loadImage(referenceSrc).then(image=>{if(active)setRefImg(image);}).catch(() => {});
    return()=>{active=false;};
  }, [referenceSrc]);

  // 兩張都到齊 → 找臉、學膚色，再把每種方法各烘一顆 LUT（等久一點沒關係，要算對）
  /* 算過的參考圖：每張參考圖各留一組 LUT（標準三種＋專業那顆），切回去直接拿來用、不用重算。
     一組約 1.7MB，最多留 12 組（約 20MB），再多就丟最久沒用的那組；換了要調色的照片就整個清掉 */
  const lutCacheRef = useRef<{ src: HTMLImageElement | null; map: Map<string, Record<string, Lut3D>> }>({ src: null, map: new Map() });
  const curRefKeyRef = useRef('');
  const cacheLuts = (key: string, l: Record<string, Lut3D>) => {
    const c = lutCacheRef.current.map;
    c.delete(key); c.set(key, l);
    while (c.size > 12) c.delete(c.keys().next().value as string);
  };
  useEffect(() => {
    if (!srcImg || !refImg) { setLuts(null); return; }
    let cancelled = false;
    if (lutCacheRef.current.src !== srcImg) lutCacheRef.current = { src: srcImg, map: new Map() };
    const refKey = refImg.src;
    curRefKeyRef.current = refKey;
    const hit = lutCacheRef.current.map.get(refKey);
    if (hit && preview && skinRef.current?.img === srcImg) {
      cacheLuts(refKey, hit);   // 移到最新
      setBusy(false);
      setLuts(hit);
      if (!isAi(pickedRef.current)) setPicked('mkl');
      return;
    }
    setBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const t0 = performance.now();
        const sw = srcImg.naturalWidth || srcImg.width, sh = srcImg.naturalHeight || srcImg.height;
        const rw = refImg.naturalWidth || refImg.width, rh = refImg.naturalHeight || refImg.height;
        if (skinRef.current?.img !== srcImg) skinRef.current = { img: srcImg, map: await buildSkinMap(srcImg, sw, sh), hue: buildHueProtectFrom(srcImg, sw, sh) };
        if (cancelled) return;
        const sMap = skinRef.current.map;
        const rMap = await buildSkinMap(refImg, rw, rh);
        if (cancelled) return;
        /* 保護權重＝紅色（色相）保護 ∪ 找臉的膚色保護，取大的那一個。
           紅色保護跟以前一樣一直都在：沒有它的話紅色、橘色會被拉得太飽和（實測整體彩度高出一倍） */
        const hue = skinRef.current.hue;
        let weight: Float32Array | null = hue ? hue.weight : null;
        if (sMap.faces) {
          const sw2 = skinWeight(sMap);
          if (weight && weight.length === sw2.length) { const m = new Float32Array(sw2.length); for (let i = 0; i < m.length; i++) m[i] = Math.max(weight[i], sw2[i]); weight = m; }
          else weight = sw2;
        }
        weightRef.current = weight ? { w: sMap.w, h: sMap.h, weight } : null;
        try { (window as any).__cmSkin = { faces: sMap.faces, refFaces: rMap.faces, ms: Math.round(performance.now() - t0) }; } catch { /* noop */ }
        /* 統計用縮圖的每一顆像素都算進去，但兩張都先拿掉皮膚：皮膚另外保護，
           「顏色怎麼對應」只從其他地方學 —— 參考圖裡的人臉不會把原圖的天空、衣服拉成膚色，
           原圖的大片皮膚也不會把對應整個帶偏。 */
        const sData = toImageData(srcImg, STAT_MAX), rData = toImageData(refImg, STAT_MAX);
        const sStat = sampleRgb(withoutSkin(sData.data, sData.width, sData.height, sMap), Infinity);
        const rStat = sampleRgb(withoutSkin(rData.data, rData.width, rData.height, rMap), Infinity);
        const out: Record<string, Lut3D> = {};
        // 33³ 跟調校台同一個尺寸；比 25³ 多 2.3 倍格點，漸層更平順，也才對得起來
        for (const m of METHODS) out[m] = bakeFor(m, sStat, rStat, 33);
        if (cancelled) return;
        if (previewSrcRef.current !== srcImg) { previewSrcRef.current = srcImg; setPreview(toImageData(srcImg, PREVIEW_MAX)); }
        cacheLuts(refKey, out);
        setLuts(out);
        if (!isAi(pickedRef.current)) setPicked('mkl');   // 選了 AI 的話換參考圖照樣用 AI（下面那段會自己重算）
      } catch (e) { console.error('color match', e); }
      finally {
        if (!cancelled) setBusy(false);
      }
    }, 30);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [srcImg, refImg]);   // eslint-disable-line react-hooks/exhaustive-deps
  const previewSrcRef = useRef<HTMLImageElement | null>(null);

  /* AI 模式（AI 寫實＝CAP-VSTNet）：第一次選到才算（要下載模型、算十幾秒）。
     算好的 LUT 跟其他做法放在一起；AI 跑完背景執行緒就關掉，記憶體立刻還回去（見 aiColorMatch） */
  const aiFor = useRef<object | null>(null);
  useEffect(() => {
    const engine = AI_ENGINE[picked];
    if (!engine || !srcImg || !refImg || !luts || luts[picked] || aiFor.current === luts) return;
    const key = picked;
    aiFor.current = luts;
    let cancelled = false, done = false;
    setBusy(true); setAiBusy(true); setAiError('');
    const map = skinRef.current?.img === srcImg ? skinRef.current.map : null;
    const skin = map && map.faces ? (u: number, v: number) => sampleMaskAt(map.skin, map.w, map.h, u, v) : undefined;
    aiColorMatchLut(srcImg, srcImg.naturalWidth || srcImg.width, srcImg.naturalHeight || srcImg.height,
      refImg, refImg.naturalWidth || refImg.width, refImg.naturalHeight || refImg.height, skin, engine)
      .then(lut => {
        if (cancelled) return;
        setLuts(l => {
          if (!l) return l;
          const n = { ...l, [key]: lut };
          if (curRefKeyRef.current && lutCacheRef.current.map.has(curRefKeyRef.current)) cacheLuts(curRefKeyRef.current, n);
          return n;
        });
      })
      .catch(e => { if (cancelled) return; console.error('ai color match', e); setAiError('AI 仿色失敗，請再試一次'); setPicked('mkl'); })
      .finally(() => { done = true; if (!cancelled) { setBusy(false); setAiBusy(false); } aiFor.current = null; });
    return () => { cancelled = true; aiFor.current = null; if (!done) { cancelAiColorMatch(); setBusy(false); setAiBusy(false); } };
  }, [picked, srcImg, refImg, luts]);

  const glImageRef = useRef<ImageData | null>(null);
  const glLutRef = useRef<Map<string, Lut3D>>(new Map());
  // 圖片與 LUT 上傳到 GPU（各只做一次）
  useLayoutEffect(() => {
    const gl = glRef.current;
    if (!gl || !preview || !luts) return;
    try {
      // 照片只在換照片時上傳一次；換參考圖只換 LUT（切參考圖才會是立刻的）
      if (glImageRef.current !== preview) { gl.setImage(preview as unknown as TexImageSource, preview.width, preview.height); glImageRef.current = preview; }
      for (const m of Object.keys(luts)) if (glLutRef.current.get(m) !== luts[m]) { gl.setLut(m, luts[m]); glLutRef.current.set(m, luts[m]); }
      glWeightRef.current = null;
      const pw=useWeight();
      if(pw){gl.setProtectMap(packWeight(pw.weight),pw.w,pw.h);glWeightRef.current=weightRef.current;}
      else gl.clearProtectMap();
      // Upload, draw, and reveal atomically before the browser presents a frame.
      glReadyRef.current = gl.draw(luts[picked] ? picked : 'mkl',strength/100,0,luts[picked] ? keepL : 1);
    } catch { glReadyRef.current = false; }
    if (glReadyRef.current) present();
    setGlReady(glReadyRef.current);
  }, [preview, luts]);

  // 目前這組設定畫到畫布上
  const paint = useCallback((strengthOverride?: number) => {
    if (!preview) return;
    const st = (strengthOverride ?? strength) / 100;
    const pw = useWeight();
    const gl = glRef.current;
    if (gl && glReadyRef.current && luts?.[picked]) {
      // 權重換了才重傳貼圖（拉滑桿時整張圖只有一次乘加 + 一次上傳，幾毫秒）
      if (pw && glWeightRef.current !== weightRef.current) {
        gl.setProtectMap(packWeight(pw.weight), pw.w, pw.h);
        glWeightRef.current = weightRef.current;
      } else if (!pw) {
        gl.clearProtectMap();
        glWeightRef.current = null;
      }
      if (gl.draw(picked, st, 0, keepL)) { present(); return; }
    }
    // 退回 CPU
    const cvs = canvasRef.current;
    if (!cvs) return;
    if (cvs.width !== preview.width || cvs.height !== preview.height) {
      cvs.width = preview.width; cvs.height = preview.height;
    }
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const lut = luts?.[picked];
    if (!lut) { processedRef.current = null; ctx.putImageData(preview, 0, 0); return; }
    const copy = new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height);
    applyLut(copy.data, lut, {
      strength: st, skinProtect: 0, preserveLuminance: keepL === 1,
      protect: pw, width: preview.width,
    });
    processedRef.current = copy;
    ctx.putImageData(copy, 0, 0);
  }, [preview, luts, picked, strength, useWeight, keepL]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* 前後對比：GPU 版就是把強度當 0 再畫一次（一樣只有一個 draw call）；
     CPU 版把事先算好的兩份直接貼上去。兩條路都不經過 React 狀態，按下去才不會慢半拍。 */
  /* 嵌在編輯器裡：按住看的是照片最原始的樣子（跟其他分頁的前後對比同一張），蓋一張畫布在照片上 */
  const originalRef = useOriginalImage(embedded?.getOriginalSrc?.() ?? null);
  const showSide = (original: boolean) => {
    const im = originalRef.current, cvs = canvasRef.current;
    /* 嵌在編輯器裡：原圖直接畫在「正在顯示的那張畫布」上 —— 同一個元素、同一個位置。
       以前是另外蓋一張畫布，位置用 offsetLeft／offsetTop（整數像素）算，照片在 102.5 時就差半個像素，
       按下跟放開看得出照片在跳 */
    if (embedded && im && cvs && ready) {
      if (original) {
        const g = cvs.getContext('2d');
        if (g) { g.clearRect(0, 0, cvs.width, cvs.height); drawOriginalInto(g, im, cvs.width, cvs.height); }
        return;
      }
      if (glRef.current && glReadyRef.current) { paint(); return; }
      if (processedRef.current) { cvs.getContext('2d')?.putImageData(processedRef.current, 0, 0); return; }
      paint(); return;
    }
    if (glRef.current && glReadyRef.current) { paint(original ? 0 : undefined); return; }
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !preview) return;
    const img = original ? preview : processedRef.current;
    if (img) ctx.putImageData(img, 0, 0);
  };

  paintRef.current = paint;
  useLayoutEffect(() => { paint(); }, [paint]);

  // 導出畫面蓋上來的時候，把 GPU 畫布也收起來。它已經被不透明的浮層擋住了，
  // 但收起來才不會有任何機會露出第二張圖。


  /* ── 歷史紀錄 ────────────────────────────────────────────────────
     跟其他工具同一套：儲存時記一筆，沒儲存直接離開也記一筆。 */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !initialState) return;
    restoredRef.current = true;
    const st = initialState;
    if (st.picked) setPicked(st.picked);
    if (st.strength !== undefined) setStrength(Math.max(0,Math.min(maxFor(st.picked || 'mkl'),st.strength)));
  }, [initialState]);

  /** 現在這一組設定。參考圖也一起存 —— 少了它就重算不出同一組顏色。 */
  const matchState = () => ({ picked, strength, referenceSrc });

  /** 用目前這組設定把任一張圖算成指定大小（GPU 一次畫完；沒有 WebGL2 才走 CPU） */
  const renderAt = (img: HTMLImageElement, w: number, h: number): HTMLCanvasElement | null => {
    if (!luts) return null;
    const pw = useWeight();
    const gpu = LutRenderer.renderOnce(
      img, w, h, luts[picked], strength / 100, 0,
      pw ? { rgba: packWeight(pw.weight), w: pw.w, h: pw.h } : null, keepL,
    );
    if (gpu) return gpu;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h);
    applyLut(d.data, luts[picked], {
      strength: strength / 100, skinProtect: 0, preserveLuminance: keepL === 1,
      protect: useWeight(), width: w,
    });
    x.putImageData(d, 0, 0);
    return c;
  };
  /** 全解析度跑一張出來（儲存與記錄用的是同一條路） */
  const renderResult = useCallback(async (): Promise<string | null> => {
    if (!srcImg || !luts) return null;
    const full = safeSize(srcImg.naturalWidth || srcImg.width, srcImg.naturalHeight || srcImg.height);
    const c = renderAt(srcImg, full.w, full.h);
    if (!c) return null;
    // 超過手機畫布上限的大照片：在上限內算，再用導向上採樣做出原尺寸（見 utils/fullResExport）
    if (full.k < 1) {
      const P = readPixels(c), D = originalAt(srcImg, full.w, full.h);
      const u = P && await fullResFromProcessed(srcImg, P, D, full.w, full.h, 'image/png');
      if (u) return u;
    }
    return canvasToUrl(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcImg, luts, picked, strength]);

  /* 嵌在編輯器裡：馬上交出預覽尺寸的成品（GPU 一次畫完），原尺寸那張留到存檔才算 */
  const sessionIdRef = useRef(`match-${Math.random().toString(36).slice(2)}`);
  const committedSigRef = useRef('');
  const takeResult = (): StudioResult | null => {
    if (!referenceSrc || !srcImg || !luts) return null;
    /* 工具交出去之後不會重開：設定沒變過就不用再換一次照片 */
    const sig = JSON.stringify({ picked, strength, referenceSrc });
    if (sig === committedSigRef.current) return null;
    const W = srcImg.naturalWidth || srcImg.width, H = srcImg.naturalHeight || srcImg.height;
    const k = Math.min(1, 2048 / Math.max(W, H));
    const out = renderAt(srcImg, Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)));
    if (!out) return null;
    // GPU 畫布換下一張就沒了：先複製成一般畫布
    const preview = document.createElement('canvas');
    preview.width = out.width; preview.height = out.height;
    preview.getContext('2d')!.drawImage(out, 0, 0);
    const render = renderAt;
    committedSigRef.current = sig;
    return {
      preview,
      session: sessionIdRef.current,
      bake: (src: string) => new Promise<string | null>(res => {
        const im = new Image();
        if (!src.startsWith('blob:') && !src.startsWith('data:')) im.crossOrigin = 'anonymous';
        im.onload = async () => {
          const z = safeSize(im.naturalWidth, im.naturalHeight); const c = render(im, z.w, z.h);
          if (!c) { res(null); return; }
          if (z.k < 1) {
            const P = readPixels(c), D = originalAt(im, z.w, z.h);
            const u = P && await fullResFromProcessed(im, P, D, z.w, z.h, 'image/png').catch(() => null);
            if (u) { res(u); return; }
          }
          canvasToUrl(c).then(res, () => res(null));
        };
        im.onerror = () => res(null);
        im.src = src;
      }),
    };
  };
  if (embedded) embedded.commitRef.current = takeResult;
  const onPaintedRef = useRef(onPainted); onPaintedRef.current = onPainted;
  useEffect(() => () => { if (embedded) embedded.commitRef.current = null; }, []);
  const finishEmbedded = () => { if (embedded) embedded.onDone(takeResult()); };
  /* 跟編輯器共用預覽縮放：切過來的那一下直接跳到同一個大小（不補間，不然會看到它滑過去） */
  const [viewJump, setViewJump] = useState(false);
  if (embedded?.viewApi) embedded.viewApi.current.match = {
    get: () => { const v = viewTRef.current; const c = stageBox(); return centerViewToShared(v.k, v.tx, v.ty, c); },
    set: (sv) => {
      const c = stageBox(); const v = sharedToCenterView(sv, c);
      setViewJump(true); applyView(v.k, v.tx, v.ty);
      requestAnimationFrame(() => requestAnimationFrame(() => setViewJump(false)));
    },
  };

  const recordedRef = useRef('');
  const record = useCallback(async (outUrl?: string) => {
    if (!srcImg || !luts || !referenceSrc) return;   // 還沒挑參考圖＝什麼都還沒做
    const sig = JSON.stringify({ picked, strength, referenceSrc });
    if (recordedRef.current === sig) return;
    recordedRef.current = sig;
    let url = outUrl || null;
    const mine = !outUrl;
    try {
      if (!url) url = await renderResult();
      if (!url) return;
      await addExport('match', url, imageSrc, { picked, strength, referenceSrc });
    } catch { /* 記錄失敗不能影響離開 */ }
    finally { if (mine && url) revokeUrl(url); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcImg, luts, referenceSrc, picked, strength, imageSrc, renderResult]);

  const exitPending=useRef(false);
  const leave = async () => {
    if(exitPending.current)return;exitPending.current=true;
    try{
      if(!referenceSrc){onCancel();return;}
      const choice=onRequestExit?await onRequestExit():'discard';
      if(choice==='cancel')return;
      if(choice==='save'){await saveDraft('match',imageSrc,matchState());await record();}
      onCancel(choice==='save');
    }finally{exitPending.current=false;}
  };

  const saveCanvas = async (canvas: HTMLCanvasElement) => {
    /* 超過手機畫布上限的大照片：這張是上限內算的，用導向上採樣做出原尺寸檔案（見 utils/fullResExport）；
       預覽與歷史紀錄用上限內那張就夠 */
    if (srcImg && safeSize(srcImg.naturalWidth || srcImg.width, srcImg.naturalHeight || srcImg.height).k < 1 && exportFormat !== 'heic') {
      const P = readPixels(canvas), D = originalAt(srcImg, canvas.width, canvas.height);
      const big = P ? await fullResFromProcessed(srcImg, P, D, canvas.width, canvas.height, exportFormat === 'jpg' ? 'image/jpeg' : 'image/png') : null;
      if (big) {
        const previewUrl = await canvasToUrl(canvas);
        revokeUrl(finalPreviewRef.current);
        finalPreviewRef.current = previewUrl;
        setFinalPreview(previewUrl);
        putFinal(big);
        await record(previewUrl);
        return;
      }
    }
    // History and browser previews remain lossless PNG; the shared file uses the chosen encoder.
    const previewUrl = await canvasToUrl(canvas);
    if (!previewUrl) throw new Error('Unable to encode preview');
    let fileUrl = previewUrl;
    try {
      if (exportFormat === 'heic') fileUrl = await exportHeic(canvas);
      else if (exportFormat === 'jpg') fileUrl = await canvasToUrl(canvas, 'image/jpeg', 1);
      if (!fileUrl) throw new Error('Unable to encode export');
    } catch (error) { revokeUrl(previewUrl); throw error; }
    revokeUrl(finalPreviewRef.current);
    finalPreviewRef.current = previewUrl;
    setFinalPreview(previewUrl);
    putFinal(fileUrl);
    await record(previewUrl);
  };

  const handleSave = () => {
    if (!srcImg || !luts || saving) return;
    setFormatOpen(false);
    setSaveError('');
    const savingStarted = performance.now();
    const finishSaving = () => window.setTimeout(
      () => setSaving(false),
      Math.max(0, 450 - (performance.now() - savingStarted)),
    );
    setSaving(true);
    // 手機上成品面積有上限（見 utils/exportLimits），48MP 照片才不會閃退
    const { w, h } = safeSize(srcImg.naturalWidth || srcImg.width, srcImg.naturalHeight || srcImg.height);
    // GPU 一次畫完，全解析度也是瞬間 —— 按下去就直接進導出畫面，不用等
    const pw = useWeight();
    const gpu = LutRenderer.renderOnce(
      srcImg, w, h, luts[picked], strength / 100, 0,
      pw ? { rgba: packWeight(pw.weight), w: pw.w, h: pw.h } : null, keepL,
    );
    if (gpu) {
      saveCanvas(gpu)
        .catch(() => setSaveError('儲存失敗，請再試一次'))
        .finally(finishSaving);
      return;
    }   // 一樣無損，只是用 blob 網址
    // 沒有 WebGL2（或圖太大塞不進貼圖）才退回 CPU
    window.setTimeout(async () => {
      try {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true })!;
        x.drawImage(srcImg, 0, 0);
        const d = x.getImageData(0, 0, w, h);
        applyLut(d.data, luts[picked], {
          strength: strength / 100, skinProtect: 0, preserveLuminance: keepL === 1,
          protect: useWeight(), width: w,
        });
        x.putImageData(d, 0, 0);
        await saveCanvas(c);
      } catch { setSaveError('儲存失敗，請再試一次'); }
      finally { finishSaving(); }
    }, 30);
  };

  const ready = !!(srcImg && refImg && luts);
  const geoReady = !sg.gh || !!sg.wrapStyle?.transform;
  useEffect(() => { if (ready && geoReady) onPaintedRef.current?.(); }, [ready, geoReady]);
  /* 佔位原圖解好了：有構圖的話等構圖那層量好尺寸才回報（不然翻過來那一格是空的） */
  const placeholderDecodedRef = useRef(false);
  const geoReadyRef = useRef(geoReady); geoReadyRef.current = geoReady;
  const placeholderPainted = () => { placeholderDecodedRef.current = true; if (geoReadyRef.current) onPaintedRef.current?.(); };
  /* 還沒有參考圖時的畫面：把已經解碼好的原圖縮成預覽尺寸畫進畫布，不再放一張原尺寸的 <img>。
     iPhone 上 4800 萬像素的 <img> 會先回報「解好了」、真正畫上去卻晚一拍 —— 第一次進仿色就閃一下黑。
     畫布的像素是現成的，畫好的下一格（兩次 rAF 確認已經上畫面）才回報，編輯器的預覽才讓開。 */
  const [phShown, setPhShown] = useState(false);
  useLayoutEffect(() => {
    if (ready || !srcImg) { setPhShown(false); return; }
    const cvs = canvasRef.current;
    if (!cvs) return;
    const W0 = srcImg.naturalWidth || srcImg.width, H0 = srcImg.naturalHeight || srcImg.height;
    const k = Math.min(1, PREVIEW_MAX / Math.max(W0, H0));
    const w = Math.max(1, Math.round(W0 * k)), h = Math.max(1, Math.round(H0 * k));
    if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
    const g = cvs.getContext('2d');
    if (!g) return;
    g.imageSmoothingQuality = 'high';
    g.drawImage(srcImg, 0, 0, w, h);
    setPhShown(true);
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(placeholderPainted); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcImg, ready]);
  useEffect(() => { if (geoReady && placeholderDecodedRef.current) onPaintedRef.current?.(); }, [geoReady]);

  const viewport=useStandaloneToolViewport();
  const srcAspect = srcImg ? (srcImg.naturalWidth || srcImg.width) / Math.max(1, srcImg.naturalHeight || srcImg.height) : (align ? align.width / align.height : null);
  const fitPad = useAlignPad(embedded ? align : null, stageRef, srcAspect);
  return (
    <div ref={embedded ? undefined : viewport.ref} data-match-embedded={embedded ? '1' : undefined}
      className={embedded ? 'absolute inset-0 bg-[#080808] flex flex-col text-white overflow-hidden'
        : `safe-top relative w-full h-[100dvh] bg-[#080808] flex flex-col text-white ${viewport.standalone?'standalone-tool-viewport':''}`}>
      {/* 滑桿樣式跟編輯器一模一樣 —— 那邊是寫在自己的 style 區塊裡，
          只有編輯器掛著的時候才存在，所以這裡要自己帶一份。 */}
      <style>{`
        ${standaloneToolViewportCSS}
        ${ALIGN_FILL_CSS}
        .custom-range {
          -webkit-appearance: none; width: calc(100% + 64px); height: 40px;
          background: rgba(0,0,0,0); outline: none; margin: 0 -32px; padding: 0;
          touch-action: none; -webkit-tap-highlight-color: rgba(0,0,0,0);
        }
        .custom-range:focus { outline: none; }
        .custom-range::-webkit-slider-runnable-track {
          width: 100%; height: 2px;
          background: linear-gradient(to right, rgba(0,0,0,0) 32px, #333 32px, #333 calc(100% - 32px), rgba(0,0,0,0) calc(100% - 32px));
          border-radius: 2px; cursor: pointer;
        }
        .custom-range::-webkit-slider-thumb {
          -webkit-appearance: none; height: 64px; width: 64px;
          background-color: rgba(0,0,0,0);
          background-image: radial-gradient(circle at center, #ffffff 0, #ffffff 7.5px, rgba(255,255,255,0) 8px, rgba(255,255,255,0) 100%);
          border: none; outline: none; cursor: pointer; margin-top: -31px;
          transition: transform 0.1s; box-shadow: none;
        }
        .custom-range::-webkit-slider-thumb:active { transform: scale(1.15); }
        .custom-range::-moz-range-track {
          width: 100%; height: 2px;
          background: linear-gradient(to right, rgba(0,0,0,0) 32px, #333 32px, #333 calc(100% - 32px), rgba(0,0,0,0) calc(100% - 32px));
          border-radius: 2px; cursor: pointer;
        }
        .custom-range::-moz-range-thumb {
          height: 64px; width: 64px; background-color: rgba(0,0,0,0);
          background-image: radial-gradient(circle at center, #ffffff 0, #ffffff 7.5px, rgba(255,255,255,0) 8px, rgba(255,255,255,0) 100%);
          border: none; outline: none; cursor: pointer; transition: transform 0.1s; box-shadow: none;
        }
        .custom-range::-moz-range-thumb:active { transform: scale(1.15); }
        /* 並排的兩根（跟編輯器特效細項同一款）：不外擴、拇指盒收小，圓點才走得到兩端 */
        .custom-range.dense { height: 26px; width: 100%; margin: 0; }
        .custom-range.dense::-webkit-slider-runnable-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-moz-range-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-webkit-slider-thumb { height: 26px; width: 18px; margin-top: -12px; }
        .custom-range.dense::-moz-range-thumb { height: 26px; width: 18px; }
      `}</style>
      {embedded ? (
      <header className="relative h-14 flex items-center justify-between px-4 shrink-0 bg-black/40 z-[81]">
        {/* 跟編輯器其他分頁同一顆：返回（離開編輯） */}
        <button onClick={embedded.onBack || embedded.onCancel} data-embedded-back aria-label="返回" className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90">
          <ChevronLeft size={22} />
        </button>
        {/* 跟編輯器其他分頁同一顆：儲存＋匯出選項（三個點） */}
        <div className="h-8 flex items-center bg-white text-black rounded-full overflow-hidden">
          <button onClick={() => { if (!saving) (embedded.onSave || finishEmbedded)(); }} data-embedded-done className="px-4 py-1.5 text-[11px] font-black whitespace-nowrap">儲存</button>
          <span aria-hidden="true" className="w-px h-4 bg-black/20" />
          <button aria-label="匯出選項" onClick={embedded.onMore} className="h-8 px-2 flex items-center"><Icon name="more_horiz" className="text-xl" /></button>
        </div>
      </header>
      ) : (
      <header className={`relative h-14 flex items-center justify-between px-4 shrink-0 bg-black/40 ${formatOpen?'':'backdrop-blur-xl'} z-[81]`}>
        {/* 退出鍵跟經典拼圖同一顆：左箭頭、同樣的顏色與按壓回饋 */}
        <button onClick={leave} className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90">
          <ChevronLeft size={22} />
        </button>
        <div ref={formatMenuRef}>
          <div className="flex items-center rounded-full bg-white text-black overflow-hidden h-8">
            <button onClick={handleSave} disabled={!ready} className="h-8 px-4 text-[11px] font-black tracking-wider disabled:opacity-40 active:scale-95">儲存</button>
            <span className="h-4 w-px bg-black/20" />
            <button aria-label="匯出選項" aria-expanded={formatOpen} onClick={() => setFormatOpen(v => !v)} className="h-8 px-2 flex items-center active:opacity-60"><Icon name="more_horiz" className="text-xl" /></button>
          </div>
          {formatOpen && <div role="dialog" aria-label="匯出格式" className="absolute top-full left-4 right-4 mt-2 rounded-xl border border-white/15 p-3 shadow-xl" style={PREMIUM_GLASS}>
            <p className="text-xs text-white/60 mb-3">匯出格式</p>
            <div className="flex gap-2">{(['jpg','png','heic'] as const).map(format => <button key={format} aria-pressed={exportFormat === format} disabled={format === 'heic' && !canExportHeic()} onClick={() => setExportFormat(format)} className={`flex-1 h-9 rounded-lg border text-xs uppercase disabled:text-white/30 ${exportFormat === format ? 'bg-white text-black border-white' : 'bg-[#303034] border-white/15 text-white/90'}`}>{format.toUpperCase()}</button>)}</div>
          </div>}
        </div>
      </header>
      )}

      {/* 預覽。版面從頭到尾長一樣 —— 還沒選參考圖時就先放原圖，
          不要等兩張都到齊才長出東西，不然畫面會整個跳一次。
          GPU 版的畫布是程式自己掛進 stage 的，下面那個是沒有 WebGL2 時的備援。 */}
      <div
        ref={stageRef}
        data-color-match-stage
        className="flex-1 min-h-0 relative overflow-hidden touch-none"
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={onStageUp}
        onWheel={(e) => {
          // 桌機沒有兩指，用滾輪當縮放
          const c = stageBox(), v = viewTRef.current;
          const k = Math.max(0.5, Math.min(8, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
          const ax = e.clientX - c.x, ay = e.clientY - c.y;
          applyView(k, ax - ((ax - v.tx) / v.k) * k, ay - ((ay - v.ty) / v.k) * k);
        }}
      >
        {/* 縮放層。內距與置中原封不動搬進來，1 倍時的版面跟以前一模一樣 */}
        <div
          ref={zoomRef}
          data-color-match-zoom
          className={`absolute inset-0 flex items-center justify-center ${fitPad ? 'studio-fit' : 'p-4'}`}
          style={{
            ...fitPad,
            transform: `translate(${viewT.tx}px, ${viewT.ty}px) scale(${viewT.k})`,
            transition: pinchRef.current || panRef.current || viewJump ? 'none' : 'transform 90ms linear',
          }}
        >
          {/* 有構圖：外框只露出構圖後的範圍，裡面那層套構圖矩陣（見 studioGeo）；沒有構圖時兩層都是 display:contents */}
          <div ref={sg.boxRef} className={sg.gh ? 'relative flex items-center justify-center max-w-full max-h-full overflow-hidden rounded-sm shadow-2xl' : ''}
            style={sg.gh ? { aspectRatio: sg.ratio } : { display: 'contents' }}>
          {sg.gh && <img src={sg.sizer} alt="" aria-hidden="true" draggable={false} className="block max-w-full max-h-full invisible" />}
          <div ref={wrapRef} data-studio-geo={sg.gh ? 'on' : 'off'} style={sg.gh ? sg.wrapStyle : { display: 'contents' }}>
          <canvas
            ref={canvasRef}
            className={`${sg.gh ? 'block w-full h-full' : 'max-w-full max-h-full object-contain rounded-sm shadow-2xl'} ${ready || phShown ? '' : 'hidden'}`}
          />
          </div>
          </div>
        </div>
        {(busy || referenceLoading) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/55 transition-opacity" role="status" aria-label={aiBusy ? 'AI仿色中' : '仿色中'}>
            {/* 標準：一句「仿色中…」；專業（AI 要算十幾秒）：三句輪流，讓人知道它在做什麼 */}
            {aiBusy ? <BusySpinner text="AI仿色中" texts={['AI仿色中', '分析光影與色調中', '重建色彩層次中']} /> : <BusySpinner text="仿色中" />}
          </div>
        )}
        {/* 仿色做法：懸空在預覽下緣、靠左（跟點陣的線稿／陰影同一款，不加外框），滑桿那一列就整列給強度 */}
        <div role="group" aria-label="仿色方法" data-cm-float className={`absolute bottom-3 ${embedded ? 'left-3' : 'left-[68px]'} h-11 flex items-center gap-2 z-[5] transition-opacity ${ready && !busy ? '' : 'opacity-30 pointer-events-none'}`}>
          {((embedded ? ['mkl', 'cap'] : [...METHODS, 'cap']) as Pick[]).map(m => (
            <button key={m} onClick={() => { warmFor(m); setPicked(m); }} data-cm-method={m} aria-pressed={picked === m}
              className={`px-3.5 py-1 rounded-full text-[11px] shrink-0 whitespace-nowrap transition-all active:scale-95 ${picked === m ? 'bg-white text-black font-bold' : 'bg-black/40 text-white/60 backdrop-blur-md'}`}>
              {PICK_LABEL(m)}
            </button>
          ))}
        </div>
        {/* 獨立的仿色：左下角換要調色的那張（跟點陣換照片同一款） */}
        {!embedded && (
          <button onClick={onImportNew} data-cm-replace-src data-cm-float aria-label="替換原始圖片"
            className="absolute left-3 bottom-3 w-11 h-11 rounded-lg overflow-hidden border border-white/30 z-[5] active:scale-95 transition-transform">
            <img src={imageSrc} alt="" className="w-full h-full object-cover" />
          </button>
        )}
        {ready && (
          <button
            data-cm-compare
            onPointerDown={(e) => {
              e.preventDefault();
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 沒抓到也無所謂 */ }
              showSide(true);
            }}
            onPointerUp={() => showSide(false)}
            onPointerCancel={() => showSide(false)}
            className="absolute bottom-3 right-3 p-3 text-white/40 select-none touch-none transition-transform active:scale-90 active:text-white"
            title="按住看原圖"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              <path d="M12 6H4.5C3.67157 6 3 6.67157 3 7.5V16.5C3 17.3284 3.67157 18 4.5 18H12" stroke="white" strokeWidth="1.5" />
              <line x1="12" y1="3" x2="12" y2="21" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M12 6H19.5C20.3284 6 21 6.67157 21 7.5V16.5C21 17.3284 20.3284 18 19.5 18H12" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        )}
      </div>

      {/* 下面這塊跟濾鏡同一個版面（總高 11rem，嵌在編輯器裡時預覽大小不會跳）：
           上面 5rem 是強度滑桿，下面 6rem 是一排參考圖 —— 最左邊那格是新增，其他每一格是一張參考圖，
           點一下就換成仿那一張；選中的那張右上角有刪除。 */}
      <section className={`color-match-panel flex flex-col shrink-0 min-h-0 bg-[#111] border-t border-white/5 ${embedded ? '' : 'pb-6'}`} style={{height: embedded ? 'calc(11rem - 1px)' : 'calc(11rem + 24px)'}}>
        {/* 跟編輯器、人像一樣：5rem＋6rem 按比例擠掉多出來的那一點，分隔線與滑桿的位置三頁完全一樣 */}
        <div style={{ flex: '0 1 5rem' }} className={`min-h-0 px-8 flex flex-col justify-center border-b border-white/5 transition-opacity ${ready && !busy ? '' : 'opacity-30 pointer-events-none'}`}>
          <div className="flex justify-between items-center select-none mb-1 translate-y-2">
            <span className="font-black text-white/40 uppercase text-[10px] tracking-[0.2em]">強度</span>
            <span ref={strengthTextRef} className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2.5 py-0.5 rounded">{strength}</span>
          </div>
          <div className="slider-wrap relative h-12 flex items-center justify-center touch-none">
            {/* 跟濾鏡的強度滑桿同一個做法：拖的時候不經過 React，每一格直接叫 GPU 重畫一次、數字直接改；
                放手（或停下來一下）才把值存回狀態。整個仿色畫面不會每一格重新 render 一次 */}
            <input ref={strengthInputRef} type="range" min={0} max={maxFor(picked)} defaultValue={Math.min(strength, maxFor(picked))}
              data-cm-slider="強度"
              onInput={(e) => liveStrength(Number((e.target as HTMLInputElement).value))}
              onPointerUp={() => commitStrength()} onTouchEnd={() => commitStrength()} onKeyUp={() => commitStrength()}
              className="custom-range" />
          </div>
        </div>
        <div data-cm-refs style={{ flex: '0 1 6rem' }} className="min-h-0 flex items-center px-4 overflow-x-auto no-scrollbar gap-2 bg-[#080808]">
          <button onClick={() => refInputRef.current?.click()} disabled={referenceLoading} data-cm-pickref aria-label="新增參考圖片"
            className="flex flex-col items-center shrink-0 w-[64px] active:scale-95 transition-transform">
            <div className="relative w-full h-[76px] rounded-lg bg-[#1a1a1a] flex flex-col items-center justify-center gap-1 text-white/50">
              {refAdding ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Icon name="add_photo_alternate" className="text-2xl" />}
              <span className="text-[8px] font-black tracking-widest">新增</span>
            </div>
          </button>
          {refs.map(r => {
            const on = referenceSrc === r.url;
            return (
              <div key={r.id} className="relative shrink-0 w-[64px] h-[76px]">
                <button onClick={() => { if (!on) setReferenceSrc(r.url); }} data-cm-ref={r.id} aria-pressed={on} aria-label="參考圖片"
                  className="block w-full h-full rounded-lg overflow-hidden bg-[#1a1a1a] active:scale-95 transition-transform">
                  <img src={r.url} alt="" draggable={false} className="w-full h-full object-cover" />
                  {on && <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />}
                </button>
                {on && <button onClick={() => deleteRef(r.id, r.url)} data-cm-delref aria-label="刪除這張參考圖"
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center active:scale-90">
                  <Icon name="close" className="text-[13px]" />
                </button>}
              </div>
            );
          })}
        </div>
        <input ref={refInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { const f = [...(e.target.files || [])]; e.target.value = ''; fixPageScroll(); onRefFiles(f); }} />
      </section>
      {aiError && <div role="alert" className="absolute top-16 left-4 right-4 z-[82] rounded-xl bg-black/90 p-3 text-sm" onClick={() => setAiError('')}>{aiError}</div>}
      {saveError && <div role="alert" className="absolute top-16 left-4 right-4 z-[82] rounded-xl bg-black/90 p-3 text-sm">{saveError}</div>}

      {/* 導出畫面蓋在上面就好，不要換一棵樹 ——
          GPU 的畫布是程式自己掛進 stage 的，換樹時 React 會把那個節點拿去重用，
          畫布就跟著跑到導出畫面上，看起來就是「出現兩張圖」。 */}
      {finalUrl && (
        <div data-export-screen className="absolute inset-0 z-[110] bg-black flex flex-col animate-in fade-in duration-500">
        <ExportActionLift />
        <header className="h-14 flex items-center px-5 shrink-0 bg-black/40 backdrop-blur-xl">
          <button onClick={() => setFinalUrl(null)} className="p-2 -ml-2 text-[#888] hover:text-white active:scale-90 transition-colors">
            <ChevronLeft size={22} />
          </button>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <div data-export-media className="relative shadow-2xl rounded overflow-hidden max-h-[62vh]">
            <img src={finalPreview || finalUrl} alt="仿色結果" className="max-w-full max-h-[62vh] object-contain allow-callout" />
            <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded" />
          </div>
        </div>
        <div data-export-actions className="flex flex-col gap-3 px-6 pb-8">
          <SaveButton urls={[finalUrl]} />
          {/* 「繼續調整」與「接著調色」併成最下面同一排 */}
          <div className="flex gap-3">
            <button
              onClick={() => setFinalUrl(null)}
              className="flex-1 h-12 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase active:scale-95 transition-all text-xs"
            >
              繼續調整
            </button>
            {onSendToEditor && (
              <button
                onClick={() => onSendToEditor(finalPreview || finalUrl)}
                className="flex-1 h-12 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase active:scale-95 transition-all text-xs"
              >
                接著調色
              </button>
            )}
          </div>
        </div>
      </div>

      )}

      {saving && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6" />
          <p className="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white">{embedded ? '套用中' : '儲存中'}</p>
          <StuckEscape onEscape={() => setSaving(false)} />
        </div>
      )}
    </div>
  );
};
