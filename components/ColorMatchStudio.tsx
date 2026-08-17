import { canvasToUrl, revokeUrl } from '../utils/blobUrl';
import { addExport } from '../utils/exportHistory';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Icon } from './Icon';
import { SaveButton } from './SaveButton';
import {
  METHODS, METHOD_LABEL, Method,
  sampleRgb, bakeFor, applyLut, Lut3D,
} from '../utils/colorTransfer';
import { LutRenderer } from '../utils/lutGl';
import { buildProtectMapsFrom, resolveWeight, packWeight, ProtectMaps } from '../utils/protectMask';

interface Props {
  /** 要調色的照片 */
  imageSrc: string;
  onCancel: () => void;
  onHome: () => void;
  /** 換一張要調色的照片 */
  onImportNew: () => void;
  /** 選參考風格的照片（交給外面開檔案選擇器） */
  onPickReference: () => void;
  /** 外面選好的參考圖 */
  referenceSrc: string | null;
  /** 從首頁的歷史紀錄點回來時，把當時的參數餵回來 */
  initialState?: any;
  onSendToEditor?: (dataUrl: string) => void;
}

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
  imageSrc, onCancel, onHome, onImportNew, onPickReference, referenceSrc, onSendToEditor,
  initialState,
}) => {
  const [srcImg, setSrcImg] = useState<HTMLImageElement | null>(null);
  const [refImg, setRefImg] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState<ImageData | null>(null);
  const [luts, setLuts] = useState<Record<string, Lut3D> | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Method>('mkl');
  const [strength, setStrength] = useState(100);
  /* 膚色保護預設 90：仿色最容易出事的就是把人臉一起換掉，
     保護開高一點，膚色留住、其他顏色照樣跟著參考圖走。 */
  const [skin, setSkin] = useState(0);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  /* 成品是 blob 網址：換新的之前先回收，離開時也要回收 */
  const finalUrlRef = useRef<string | null>(null);
  const putFinal = useCallback((u: string) => {
    revokeUrl(finalUrlRef.current);
    finalUrlRef.current = u;
    setFinalUrl(u);
  }, []);
  /* 離開時晚一點再回收：導出紀錄的縮圖與分享用的檔案都是非同步去讀這個
     網址的，按下儲存後馬上離開的話會來不及讀完。 */
  useEffect(() => () => { const keep = finalUrlRef.current; setTimeout(() => revokeUrl(keep as any), 15000); }, []);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /* GPU 版：圖片與三顆 LUT 各上傳一次，之後換做法＝換綁貼圖、動滑桿＝改 uniform，
     每次更新就只有一個 draw call。沒有 WebGL2 就退回 CPU 版。 */
  const glRef = useRef<LutRenderer | null>(null);
  const glWeightRef = useRef<unknown>(null);
  /* 防斷層的保護遮罩。
     合併（膚色 ∪ 色相）必須發生在補洞與羽化「之前」—— 順序跟調校台一致。
     可是這樣遮罩就跟膚色保護滑桿綁在一起了，所以一張圖烤好 SKIN_LAYERS 層，
     拉滑桿時只在相鄰兩層之間內插（整張圖幾毫秒），零延遲又不失準。 */
  const maskRef = useRef<ProtectMaps | null>(null);
  const weightRef = useRef<{ w: number; h: number; weight: Float32Array } | null>(null);
  const weightForRef = useRef(-1);
  /** 解出這個膚色保護值下的權重（沒變就沿用，不重算） */
  const useWeight = useCallback((sp: number) => {
    const m = maskRef.current;
    if (!m) { weightRef.current = null; return null; }
    if (weightForRef.current !== sp || !weightRef.current) {
      weightRef.current = { w: m.w, h: m.h, weight: resolveWeight(m, sp) };
      weightForRef.current = sp;
    }
    return weightRef.current;
  }, []);
  const glReadyRef = useRef(false);
  /** 用 state 是為了讓備援畫布真的被藏起來（ref 改了不會重繪） */
  const [glReady, setGlReady] = useState(false);
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
    const kk = Math.max(1, Math.min(8, k));
    // 限制平移範圍，免得把圖拖出畫面找不回來
    const mx = Math.max(0, (kk - 1) * c.w * 0.5);
    const my = Math.max(0, (kk - 1) * c.h * 0.5);
    setViewT({ k: kk, tx: Math.max(-mx, Math.min(mx, tx)), ty: Math.max(-my, Math.min(my, ty)) });
  }, []);
  // 換圖、換參考圖就把縮放歸零
  useEffect(() => { setViewT({ k: 1, tx: 0, ty: 0 }); }, [imageSrc, referenceSrc]);

  const onStageDown = (e: React.PointerEvent) => {
    // 前後對比那顆按鈕自己有事情要做，不要被當成縮放
    if ((e.target as HTMLElement).closest('[data-cm-compare]')) return;
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
      const k = Math.max(1, Math.min(8, pin.k0 * (dist / pin.d0)));
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
    if (gl && zoomRef.current) {
      // 先藏起來。它是直接掛進畫面裡的，還沒畫東西之前如果留在版面裡，
      // 會跟佔位用的原圖擠在同一排 —— 原圖就被推到旁邊去了（量到偏了 150px）。
      gl.canvas.className = 'max-w-full max-h-full object-contain rounded-sm shadow-2xl hidden';
      zoomRef.current.appendChild(gl.canvas);
    }
    return () => { gl?.canvas.remove(); gl?.dispose(); glRef.current = null; };
  }, []);

  useEffect(() => { maskRef.current = null; weightRef.current = null; weightForRef.current = -1; loadImage(imageSrc).then(setSrcImg).catch(() => {}); }, [imageSrc]);
  useEffect(() => {
    if (!referenceSrc) { setRefImg(null); return; }
    loadImage(referenceSrc).then(setRefImg).catch(() => {});
  }, [referenceSrc]);

  // 兩張都到齊 → 把四種方法各烘一顆 LUT
  useEffect(() => {
    if (!srcImg || !refImg) { setLuts(null); return; }
    let cancelled = false;
    setBusy(true);
    const t = window.setTimeout(() => {
      try {
        maskRef.current = buildProtectMapsFrom(
          srcImg, srcImg.naturalWidth || srcImg.width, srcImg.naturalHeight || srcImg.height,
        );
        weightRef.current = null; weightForRef.current = -1;
        /* 統計用縮圖的每一顆像素都算進去（STAT_MAX 之下最多 900×675 ≈ 60 萬顆，
           算 3×3 共變異數只要十幾毫秒）。抽樣再怎麼聰明都不如全部都看 ——
           而且這樣才跟調校台的預覽區用同一份統計。 */
        const sStat = sampleRgb(toImageData(srcImg, STAT_MAX).data, Infinity);
        const rStat = sampleRgb(toImageData(refImg, STAT_MAX).data, Infinity);
        const out: Record<string, Lut3D> = {};
        // 33³ 跟調校台同一個尺寸；比 25³ 多 2.3 倍格點，漸層更平順，也才對得起來
        for (const m of METHODS) out[m] = bakeFor(m, sStat, rStat, 33);
        if (cancelled) return;
        setPreview(toImageData(srcImg, PREVIEW_MAX));
        setLuts(out);
        setPicked('mkl');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 30);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [srcImg, refImg]);

  // 圖片與 LUT 上傳到 GPU（各只做一次）
  useEffect(() => {
    const gl = glRef.current;
    glReadyRef.current = false;
    glWeightRef.current = null;
    setGlReady(false);
    if (gl) gl.canvas.classList.add('hidden');
    if (!gl || !preview || !luts) return;
    try {
      gl.setImage(preview as unknown as TexImageSource, preview.width, preview.height);
      for (const m of METHODS) gl.setLut(m, luts[m]);
      glReadyRef.current = true;
    } catch { glReadyRef.current = false; }
    gl.canvas.classList.toggle('hidden', !glReadyRef.current);
    setGlReady(glReadyRef.current);
  }, [preview, luts]);

  // 目前這組設定畫到畫布上
  const paint = useCallback((strengthOverride?: number) => {
    if (!preview) return;
    const st = (strengthOverride ?? strength) / 100;
    const pw = useWeight(skin / 100);
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
      if (gl.draw(picked, st, skin / 100)) return;
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
      strength: st, skinProtect: skin / 100, preserveLuminance: true,
      protect: pw, width: preview.width,
    });
    processedRef.current = copy;
    ctx.putImageData(copy, 0, 0);
  }, [preview, luts, picked, strength, skin, useWeight]);

  /* 前後對比：GPU 版就是把強度當 0 再畫一次（一樣只有一個 draw call）；
     CPU 版把事先算好的兩份直接貼上去。兩條路都不經過 React 狀態，按下去才不會慢半拍。 */
  const showSide = (original: boolean) => {
    if (glRef.current && glReadyRef.current) { paint(original ? 0 : undefined); return; }
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !preview) return;
    const img = original ? preview : processedRef.current;
    if (img) ctx.putImageData(img, 0, 0);
  };

  useEffect(() => { paint(); }, [paint]);

  // 導出畫面蓋上來的時候，把 GPU 畫布也收起來。它已經被不透明的浮層擋住了，
  // 但收起來才不會有任何機會露出第二張圖。
  useEffect(() => {
    const gl = glRef.current;
    if (gl) gl.canvas.classList.toggle('hidden', !!finalUrl || !glReadyRef.current);
  }, [finalUrl, glReady]);

  /* ── 歷史紀錄 ────────────────────────────────────────────────────
     跟其他工具同一套：儲存時記一筆，沒儲存直接離開也記一筆。 */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !initialState) return;
    restoredRef.current = true;
    const st = initialState;
    if (st.picked) setPicked(st.picked);
    if (st.strength !== undefined) setStrength(st.strength);
    if (st.skin !== undefined) setSkin(st.skin);
  }, [initialState]);

  /** 現在這一組設定。參考圖也一起存 —— 少了它就重算不出同一組顏色。 */
  const matchState = () => ({ picked, strength, skin, referenceSrc });

  /** 全解析度跑一張出來（儲存與記錄用的是同一條路） */
  const renderResult = useCallback(async (): Promise<string | null> => {
    if (!srcImg || !luts) return null;
    const w = srcImg.naturalWidth || srcImg.width, h = srcImg.naturalHeight || srcImg.height;
    const pw = useWeight(skin / 100);
    const gpu = LutRenderer.renderOnce(
      srcImg, w, h, luts[picked], strength / 100, skin / 100,
      pw ? { rgba: packWeight(pw.weight), w: pw.w, h: pw.h } : null,
    );
    if (gpu) return canvasToUrl(gpu);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(srcImg, 0, 0);
    const d = x.getImageData(0, 0, w, h);
    applyLut(d.data, luts[picked], {
      strength: strength / 100, skinProtect: skin / 100, preserveLuminance: true,
      protect: useWeight(skin / 100), width: w,
    });
    x.putImageData(d, 0, 0);
    return canvasToUrl(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcImg, luts, picked, strength, skin]);

  const recordedRef = useRef('');
  const record = useCallback(async (outUrl?: string) => {
    if (!srcImg || !luts || !referenceSrc) return;   // 還沒挑參考圖＝什麼都還沒做
    const sig = JSON.stringify({ picked, strength, skin, referenceSrc });
    if (recordedRef.current === sig) return;
    recordedRef.current = sig;
    let url = outUrl || null;
    const mine = !outUrl;
    try {
      if (!url) url = await renderResult();
      if (!url) return;
      await addExport('match', url, imageSrc, { picked, strength, skin, referenceSrc });
    } catch { /* 記錄失敗不能影響離開 */ }
    finally { if (mine && url) revokeUrl(url); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcImg, luts, referenceSrc, picked, strength, skin, imageSrc, renderResult]);

  const leave = () => { record(); onCancel(); };

  const handleSave = () => {
    if (!srcImg || !luts) return;
    const w = srcImg.naturalWidth || srcImg.width, h = srcImg.naturalHeight || srcImg.height;
    // GPU 一次畫完，全解析度也是瞬間 —— 按下去就直接進導出畫面，不用等
    const pw = useWeight(skin / 100);
    const gpu = LutRenderer.renderOnce(
      srcImg, w, h, luts[picked], strength / 100, skin / 100,
      pw ? { rgba: packWeight(pw.weight), w: pw.w, h: pw.h } : null,
    );
    if (gpu) { canvasToUrl(gpu).then(u => { putFinal(u); record(u); }); return; }   // 一樣無損，只是用 blob 網址
    // 沒有 WebGL2（或圖太大塞不進貼圖）才退回 CPU
    setSaving(true);
    window.setTimeout(() => {
      try {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true })!;
        x.drawImage(srcImg, 0, 0);
        const d = x.getImageData(0, 0, w, h);
        applyLut(d.data, luts[picked], {
          strength: strength / 100, skinProtect: skin / 100, preserveLuminance: true,
          protect: useWeight(skin / 100), width: w,
        });
        x.putImageData(d, 0, 0);
        canvasToUrl(c).then(u => { putFinal(u); record(u); });
      } finally { setSaving(false); }
    }, 30);
  };

  const ready = !!(srcImg && refImg && luts);

  return (
    <div className="safe-top absolute inset-0 bg-[#080808] flex flex-col text-white">
      {/* 滑桿樣式跟編輯器一模一樣 —— 那邊是寫在自己的 style 區塊裡，
          只有編輯器掛著的時候才存在，所以這裡要自己帶一份。 */}
      <style>{`
        .custom-range {
          -webkit-appearance: none; width: calc(100% + 64px); height: 60px;
          background: rgba(0,0,0,0); outline: none; margin: -10px -32px; padding: 0;
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
      `}</style>
      <header className="h-14 flex items-center justify-between px-4 shrink-0 bg-black/40 backdrop-blur-xl z-20">
        {/* 退出鍵跟經典拼圖同一顆：左箭頭、同樣的顏色與按壓回饋 */}
        <button onClick={leave} className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90">
          <ChevronLeft size={22} />
        </button>
        <button
          onClick={handleSave}
          disabled={!ready || saving}
          className={`px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-transform ${ready && !saving ? 'bg-white text-black active:scale-95' : 'bg-white/15 text-white/40'}`}
        >
          儲存
        </button>
      </header>

      {/* 預覽。版面從頭到尾長一樣 —— 還沒選參考圖時就先放原圖，
          不要等兩張都到齊才長出東西，不然畫面會整個跳一次。
          GPU 版的畫布是程式自己掛進 stage 的，下面那個是沒有 WebGL2 時的備援。 */}
      <div
        ref={stageRef}
        className="flex-1 min-h-0 relative overflow-hidden touch-none"
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={onStageUp}
        onWheel={(e) => {
          // 桌機沒有兩指，用滾輪當縮放
          const c = stageBox(), v = viewTRef.current;
          const k = Math.max(1, Math.min(8, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
          const ax = e.clientX - c.x, ay = e.clientY - c.y;
          applyView(k, ax - ((ax - v.tx) / v.k) * k, ay - ((ay - v.ty) / v.k) * k);
        }}
      >
        {/* 縮放層。內距與置中原封不動搬進來，1 倍時的版面跟以前一模一樣 */}
        <div
          ref={zoomRef}
          className="absolute inset-0 flex items-center justify-center p-4"
          style={{
            transform: `translate(${viewT.tx}px, ${viewT.ty}px) scale(${viewT.k})`,
            transition: pinchRef.current || panRef.current ? 'none' : 'transform 90ms linear',
          }}
        >
          <canvas
            ref={canvasRef}
            className={`max-w-full max-h-full object-contain rounded-sm shadow-2xl ${ready && !glReady ? '' : 'hidden'}`}
          />
          {!ready && (
            <img src={imageSrc} alt="" className="max-w-full max-h-full object-contain rounded-sm shadow-2xl" />
          )}
        </div>
        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/45 pointer-events-none">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <span className="text-[10px] font-black tracking-[0.25em] text-white/85">分析色彩中</span>
          </div>
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

      {/* 參考圖那一列。
           還沒選參考圖時就只有「導入參考圖片」一顆，佔滿整列（跟以前一樣）；
           選過之後右邊讓出位子給「替換原始圖片」—— 導入那顆縮短，
           空出來的地方剛好放第二顆，兩顆等寬。 */}
      {/* pt-3 跟 pb-3 對稱：上面緊貼著預覽區看起來像黏住了 */}
      <div className="px-4 pt-3 pb-3 shrink-0 flex items-stretch gap-2">
        <button
          onClick={onPickReference}
          data-cm-pickref
          className={`${referenceSrc ? 'flex-1 min-w-0' : 'w-full'} h-14 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center gap-3 px-3 active:scale-[0.99] transition-transform`}
        >
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#1a1a1a] flex items-center justify-center shrink-0">
            {referenceSrc
              ? <img src={referenceSrc} alt="" className="w-full h-full object-cover" />
              : <Icon name="add_photo_alternate" className="text-xl text-white/40" />}
          </div>
          <span className="flex-1 min-w-0 text-left text-[10px] font-black uppercase tracking-[0.2em] text-white/60 truncate">導入參考圖片</span>
          {!referenceSrc && <Icon name="chevron_right" className="text-xl text-white/30 shrink-0" />}
        </button>
        {referenceSrc && (
          <button
            onClick={onImportNew}
            data-cm-replace-src
            className="flex-1 min-w-0 h-14 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center gap-3 px-3 active:scale-[0.99] transition-transform"
          >
            {/* 方塊裡放的是「現在正在調色的那張原圖」，跟左邊那顆放參考圖是同一個道理 ——
                一眼就看得出來這顆是換哪一張。 */}
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#1a1a1a] flex items-center justify-center shrink-0">
              <img src={imageSrc} alt="" className="w-full h-full object-cover" />
            </div>
            <span className="flex-1 min-w-0 text-left text-[10px] font-black uppercase tracking-[0.2em] text-white/60 truncate">替換原始圖片</span>
          </button>
        )}
      </div>

      {/* 滑桿：樣式與佈局比照編輯器。一直都在，還沒算好就變淡、不能點，版面才不會跳 */}
      <div className={`px-8 shrink-0 border-t border-white/5 transition-opacity ${ready ? '' : 'opacity-30 pointer-events-none'}`}>
        <div>
          {/* 強度可以推到 200（100 以上＝比參考圖再更進一步），預設維持 100；
              膚色保護維持 0～100。 */}
          {([['強度', strength, setStrength, 200], ['膚色保護', skin, setSkin, 100]] as const).map(([label, val, set, max]) => (
            <div key={label} className="pt-2">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">{label}</span>
                <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded">{val}</span>
              </div>
              <div className="relative h-10 flex items-center justify-center touch-none">
                <input
                  type="range" min={0} max={max} value={val}
                  data-cm-slider={label}
                  onChange={(e) => set(Number(e.target.value))}
                  className="custom-range"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 做法：文字按鈕，比照編輯器的工具列 */}
      <div className={`h-24 flex items-center justify-center px-4 gap-2 shrink-0 bg-[#080808] border-t border-white/5 overflow-x-auto no-scrollbar transition-opacity ${ready ? '' : 'opacity-30 pointer-events-none'}`}>
          {METHODS.map(m => (
            <button
              key={m}
              onClick={() => setPicked(m)}
              data-cm-method={m}
              className={`flex-1 basis-0 min-w-0 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                picked === m ? 'bg-white text-black' : 'bg-white/5 text-white/40'
              }`}
            >
              <span className="text-[11px] font-black tracking-wider whitespace-nowrap">
                {METHOD_LABEL[m]}
              </span>
            </button>
          ))}
      </div>

      {/* 導出畫面蓋在上面就好，不要換一棵樹 ——
          GPU 的畫布是程式自己掛進 stage 的，換樹時 React 會把那個節點拿去重用，
          畫布就跟著跑到導出畫面上，看起來就是「出現兩張圖」。 */}
      {finalUrl && (
        <div className="absolute inset-0 z-[110] bg-black flex flex-col animate-in fade-in duration-500">
        <header className="h-14 flex items-center px-5 shrink-0 bg-black/40 backdrop-blur-xl">
          <button onClick={() => setFinalUrl(null)} className="p-2 -ml-2 text-[#888] hover:text-white active:scale-90 transition-colors">
            <ChevronLeft size={22} />
          </button>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="relative shadow-2xl rounded overflow-hidden max-h-[62vh]">
            <img src={finalUrl} alt="仿色結果" className="max-w-full max-h-[62vh] object-contain allow-callout" />
            <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded" />
          </div>
        </div>
        <div className="flex flex-col gap-3 px-6 pb-8">
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
                onClick={() => onSendToEditor(finalUrl)}
                className="flex-1 h-12 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase active:scale-95 transition-all text-xs"
              >
                接著調色
              </button>
            )}
          </div>
        </div>
      </div>

      )}
    </div>
  );
};
