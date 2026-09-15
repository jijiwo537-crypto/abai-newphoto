import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { ArrowLeft, ChevronLeft, Download, Plus, Trash2, RotateCw, Sliders, SlidersHorizontal, LayoutGrid, Sparkles, Asterisk, MoveUp, MoveDown, Check, RefreshCw, Maximize2, Move, Smartphone, Image as ImageIcon, Crop, Palette, Magnet, Type, Bold, Italic, Copy, GalleryHorizontal, ChevronRight, Heart, Circle, Square, Star, Hexagon, Blocks, MessageCircle, Bookmark, Volume2, VolumeX, Shapes, Film, Play, Pause } from 'lucide-react';
import { Icon } from './Icon';
import { FONTS, FONT_CATEGORIES, FONT_SAMPLE, FontCategory, DEFAULT_FONT, SYMBOL_FONT, ensureFont, ensureItalic, knownItalic, fontCssLoaded, waitForFont, fontStack } from '../utils/fonts';
import { PhotoFx, ADJUST_KEYS, applyPhotoFx, hasPhotoFx, loadLut, getLoadedLut, bakePhotoFxLut, lutDefaultAmount, colorKeyOf, getNoisePattern } from '../utils/photoFx';
import { get2dWide } from '../utils/colorSpace';
import { FX_DEFS, warmFx } from '../utils/glEffects';
import { saveDraft, loadDraft, clearDraft, hasDraft } from '../utils/collageDraft';
import { addExport } from '../utils/exportHistory';
// 匯出成品一律走這一支（內建 toBlob 的看門狗，見那個檔案的說明）
import { canvasToUrl } from '../utils/blobUrl';
import { SYMBOLS } from '../utils/symbols';
import {
  measureSymbolInk, measureSymbolInkAtSize, measureSymbolStickerInk, measureSymbolAdvance, clearSymbolInkCache,
  symbolTextPresentation, rasterizeSymbolAnimationLayers, symbolBreatheScale, countSymbolAnimationBeats,
} from '../utils/symbolGeometry';
/* 從「圖案」借過來的那批圖形：清單、按鈕小圖、算圖全部跟創意拼圖共用同一份 */
import {
  GLYPH_HOLES, GLYPH_BTN, holeImgRatio, getHoleImg, isImageHole, drawHoleShape, holeOverflow, glowAmount,
  texOf, paintStripes,
  HoleShapeItem, HOLE_ITEM_CROSS, HOLE_ITEM_CROSS_O, HOLE_ITEMS_EXTRA, paintTex,
} from '../utils/holeShapes';
import { SHAPE_IMAGES } from '../utils/shapeImages';
import { paintPattern, PatternOpts, TEX_OPTIONS, TEX_SWATCHES, STRIPE_DIRS, stripeBand, STRIPE_A, STRIPE_B,
  STRIPE_N_DEFAULT, STRIPE_N_MAX, isGridTex } from '../utils/pattern';
import { ComposeStudio } from './ComposeStudio';
import { StuckEscape } from './StuckEscape';
import { VIDEO_ACCEPT, loadVideoEl, isVideoEl } from '../utils/videoSource';
import { VideoGl } from '../utils/videoGl';
import { normalizeImageFiles } from '../utils/imageLoader';
import { RAW_ACCEPT as RAW_ACCEPT_IMG } from '../utils/fileTypes';
import { IgPreview } from './IgPreview';
import { SaveButton } from './SaveButton';
import type { ExitChoice } from '../types';
import { DEFAULT_GEO, GeoParams, composeCanvas, isGeoIdentity, geoFrameCanvas, geoCssBox } from '../utils/compose';
import {
  ObjectMotionConfig, ObjectMotionFrame, CLASSIC_OBJECT_MOTION_DEFAULT, OBJECT_IN_KINDS,
  SYMBOL_OBJECT_IN_KINDS, OBJECT_IDLE_KINDS, classicObjectMotionOf, objectMotionFrame,
  motionDurationFromUi, motionUiFromDuration,
} from '../utils/objectMotion';
import { preferredVideoFrameRate } from '../utils/videoFrameRate';

import { pushHistory as pushHistoryEntry } from '../utils/history';

const ReplayIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8.25 6.75H4.2V2.7 M4.45 6.55A8 8 0 1 1 4 14" />
  </svg>
);

/* 圖片呼吸的實際參數是幅度 50～100、速度 70～250；面板仍顯示 0～100。 */
const imageBreathAmpToUi = (amp: number) => Math.round(Math.max(0, Math.min(100, (amp - 50) * 2)));
const imageBreathAmpFromUi = (ui: number) => 50 + Math.max(0, Math.min(100, ui)) * .5;
const imageBreathSpeedToUi = (speed: number) => Math.round(Math.max(0, Math.min(100, (speed * 100 - 70) / 1.8)));
const imageBreathSpeedFromUi = (ui: number) => (70 + Math.max(0, Math.min(100, ui)) * 1.8) / 100;

/* 經典拼圖動畫頁原先直接使用了創意拼圖檔案內的區域元件；那個元件沒有
   export，桌面開發環境有時直到點進動畫才報錯，iPhone WebKit 則會直接把
   整個 React 畫面清成黑色。這裡保留同款外觀，但讓經典拼圖自己持有元件。 */
const CompactSlider = ({ label, value, min, max, onChange, step = 'any', decimals = 0, fixedDecimals = false, onCommit, disabled = false }: any) => {
  const queued = useRef<number | null>(null);
  const raf = useRef(0);
  const push = (next: number) => {
    queued.current = next;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (queued.current !== null) onChange(queued.current);
      queued.current = null;
    });
  };
  const finish = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (queued.current !== null) onChange(queued.current);
    queued.current = null;
    onCommit?.();
  };
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    queued.current = null;
  }, []);
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
  const requestedMax = Number.isFinite(Number(max)) ? Number(max) : 100;
  const safeMax = Math.max(safeMin, requestedMax);
  const numericValue = Number(value);
  const safeValue = Math.max(safeMin, Math.min(safeMax, Number.isFinite(numericValue) ? numericValue : safeMin));
  return (
    <div className={`flex flex-col ${disabled ? 'opacity-45' : ''}`}>
      <div className="flex justify-between text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
        <span>{label}</span>
        <span className="text-white font-sans tabular-nums">
          {decimals > 0
            ? (fixedDecimals ? safeValue.toFixed(decimals) : safeValue.toFixed(decimals).replace(/\.?0+$/, '') || '0')
            : Math.round(safeValue)}
        </span>
      </div>
      <div className="slider-wrap" style={{ height: 16 }}>
        <input
          type="range" min={safeMin} max={safeMax} step={step} value={safeValue}
          disabled={disabled}
          onChange={e => push(Number(e.target.value))}
          onPointerUp={finish} onTouchEnd={finish} onKeyUp={finish}
          onPointerDown={e => e.stopPropagation()}
          className="premium-slider w-full"
        />
      </div>
    </div>
  );
};

type PreparedSymbolPlacement = {
  fontSize: number;
  w: number;
  h: number;
};
const classicSymbolPlacementCache = new Map<string, PreparedSymbolPlacement>();

const prepareClassicSymbolPlacement = (text: string, pageWidth: number): PreparedSymbolPlacement => {
  const pw = Math.max(1, Math.round(pageWidth * 100) / 100);
  const key = `${SYMBOL_FONT}|${pw}|${text}`;
  const cached = classicSymbolPlacementCache.get(key);
  if (cached) return cached;

  const M = 100;
  const w100 = measureSymbolAdvance(text, SYMBOL_FONT, M);
  const fontSize = Math.max(12, Math.min(72, Math.round((pw * 0.7) * M / w100)));
  /* 新增時直接量「最後真正畫到畫布上的符號貼圖」。Mobile Safari 對部分
     VS15／fallback 字形的原生文字量測不同；若外框量 raw text、動畫畫貼圖，
     一進動畫頁就必然會偏移。 */
  const ink = measureSymbolStickerInk(text, SYMBOL_FONT);
  const value = {
    fontSize,
    w: Math.max(6, ink.w * fontSize + 8),
    h: Math.max(6, ink.h * fontSize + 8),
  };
  classicSymbolPlacementCache.set(key, value);
  return value;
};

/* 符號頁不能在打開後才開始下載字體。模組載入時就在背景把清單會用到的
   字形預熱；使用者點進頁面時，按鈕與新增物件便直接使用最終字身。 */
let symbolFontDidSettle = typeof document === 'undefined';
export const symbolFontReady: Promise<void> = typeof document === 'undefined'
  ? Promise.resolve()
  : ensureFont(SYMBOL_FONT)
      .then(async () => {
        try {
          await document.fonts?.load(`400 32px "${SYMBOL_FONT}"`, SYMBOLS.join(''));
          await document.fonts?.ready;
          /* FontFaceSet ready 只代表字體檔可用，不代表 WebKit 已完成所有 fallback
             glyph 的 shaping。先在畫面外排一次完整符號表，再等兩個 layout frame；
             使用者點進選單時每顆按鈕便直接是最終字身與最終位置。 */
          const warm = document.createElement('span');
          warm.textContent = SYMBOLS.join('\n');
          Object.assign(warm.style, {
            position: 'fixed', left: '-100000px', top: '-100000px',
            visibility: 'hidden', whiteSpace: 'pre', fontFamily: fontStack(SYMBOL_FONT),
            fontSize: '32px', lineHeight: '1.9', contain: 'layout paint style',
          });
          document.body.appendChild(warm);
          warm.getBoundingClientRect();
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          warm.getBoundingClientRect();
          warm.remove();
        } catch { /* 離線時穩定使用系統 fallback */ }
        clearSymbolInkCache();
        classicSymbolPlacementCache.clear();
      })
      .catch(() => {})
      .then(() => { symbolFontDidSettle = true; });
interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageCell {
  id: string;
  url: string;
  file: File;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  /** 圖片透明度，0～100；舊專案未設定時視為 100。 */
  opacity?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  /** 濾鏡／調節／特效。跟浮動圖片用同一組資料與同一支算圖 */
  fx?: PhotoFx;
  /** 這一格自己的圓角（%）。有設的話就蓋掉佈局那根共用的圓角滑桿 */
  imgRadius?: number;
}

/** 是不是影片檔（用 MIME 或副檔名判斷都可以） */
const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|ogv|3gp)$/i.test(f.name);

/** 影片的原始尺寸：等 metadata 進來就有 videoWidth / videoHeight */
/**
 * 影片的尺寸，順便烤一張「第一格」。
 *
 * 那張第一格是給濾鏡／特效卡片牆用的：卡片是拿一條網址塞進 <img> 去重畫縮圖的，
 * 而 <img src="blob:…mp4"> 永遠載不出來 —— 所以以前影片圖層的卡片牆整面是空的，
 * 使用者根本看不到每個濾鏡長什麼樣（「影片大部分東西不能調整」的一部分）。
 * 烤一張 PNG 當卡片的來源，卡片就跟圖片圖層長得一模一樣。
 * 真正畫到畫面上的仍然是影片本人，這張只給卡片看。
 */
const getVideoDimensions = (url: string): Promise<{ width: number; height: number; poster?: string }> => {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    (v as any).playsInline = true;
    let done = false;
    const finish = (poster?: string) => {
      if (done) return; done = true;
      resolve({ width: v.videoWidth || 800, height: v.videoHeight || 600, poster });
      try { v.removeAttribute('src'); v.load(); } catch { /* 收不掉算了 */ }
    };
    const bake = () => {
      try {
        const w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) return finish();
        const k = Math.min(1, 480 / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k));
        c.height = Math.max(1, Math.round(h * k));
        const g = c.getContext('2d');
        if (!g) return finish();
        g.drawImage(v, 0, 0, c.width, c.height);
        finish(c.toDataURL('image/jpeg', 0.86));
      } catch { finish(); }
    };
    v.onloadeddata = bake;
    v.onerror = () => finish();
    // 第一格一直等不到也不能卡住匯入
    setTimeout(() => finish(), 4000);
    v.src = url;
  });
};

/**
 * 預覽用的影片元素：跟照片一樣一個網址共用一個元素，
 * 這樣重畫、匯出都拿到同一個播放中的影片（不會各自播各自的）。
 */
const previewVideos = new Map<string, HTMLVideoElement>();
export const getPreviewVideo = (src: string) => {
  let v = previewVideos.get(src);
  if (!v) {
    v = document.createElement('video');
    v.src = src;
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    (v as any).disablePictureInPicture = true;
    v.play().catch(() => { /* 使用者還沒互動就先不播 */ });
    previewVideos.set(src, v);
  }
  return v;
};

const getImageDimensions = (url: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    };
    img.onerror = () => {
      resolve({ width: 800, height: 600 });
    };
    img.src = url;
  });
};

const EMPTY_CELLS: ImageCell[] = [];

/** 佈局最小縮放：再小就很難點得到 */
const MIN_LAYOUT_SCALE = 0.4;
/* 浮動照片、影片、圖形、符號與文字共用同一個最小倍率。0.1 會把 160px
   的預設物件壓到約 16px，任何螢幕都只剩幾顆實體像素，不可能保留細節。 */
const MIN_FLOATING_SCALE = 0.2;
const MIN_FLOATING_IMAGE_SCALE = MIN_FLOATING_SCALE * 2;
const floatingScaleFloor = (item: Partial<FloatingImage> | null | undefined) =>
  item && item.text === undefined && !item.shape
    ? MIN_FLOATING_IMAGE_SCALE
    : MIN_FLOATING_SCALE;

/** 新增佈局時預設佔頁面七分滿 */
const NEW_LAYOUT_SCALE = 0.7;

let layoutSeq = 0;
const makeLayout = (templateIndex: number, count: number, gap = 0, radius = 0) => ({
  id: `layout-${Date.now()}-${layoutSeq++}`,
  templateIndex,
  images: Array.from({ length: count }).map((_, i) => ({
    id: `empty-${Date.now()}-${layoutSeq}-${i}`,
    url: '', file: undefined, zoom: 1.0, offsetX: 0, offsetY: 0, rotation: 0,
  })),
  t: { x: 0, y: 0, scale: NEW_LAYOUT_SCALE },
  z: 0,
  gap,
  radius,
});

const RATIOS = [
  { id: '1:1', name: '1:1' },
  { id: '3:4', name: '3:4' },
  { id: '2:3', name: '2:3' },
  { id: '9:16', name: '9:16' },
  { id: '4:5', name: '4:5' },
];

/* ── 佈局自己的比例 ──────────────────────────────────────────────────
   每個佈局可以有自己的長寬比（跟整頁的「版型比例」是兩回事）。沒設就跟頁面
   一樣，所以舊檔案讀進來畫面完全不變。
   設了就把那個比例「contain」進頁面裡並置中，再乘上佈局自己的縮放。
   預覽、IG 預覽、匯出、拖曳吸附四條路全部呼叫這一支，幾何不可能對不上。 */
const layoutBox = (
  lay: { ratio?: string; landscape?: boolean } | null | undefined,
  pageW: number, pageH: number,
) => {
  const id = lay?.ratio;
  if (!id) return { w: pageW, h: pageH };
  const parts = String(id).split(':').map(Number);
  let rw = parts[0], rh = parts[1];
  if (!(rw > 0 && rh > 0)) return { w: pageW, h: pageH };
  if (lay?.landscape) { const t = rw; rw = rh; rh = t; }
  const fit = Math.min(pageW / rw, pageH / rh);
  return { w: rw * fit, h: rh * fit };
};

const TEMPLATE_MAP: Record<number, { name: string; rects: CellRect[] }[]> = {
  1: [
    {
      name: '滿版',
      rects: [{ x: 0, y: 0, w: 1, h: 1 }]
    }
  ],
  2: [
    {
      name: '上下對分',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 1, h: 0.5 }
      ]
    },
    {
      name: '左右對分',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 1 }
      ]
    },
    {
      name: '黃金左分割',
      rects: [
        { x: 0, y: 0, w: 0.618, h: 1 },
        { x: 0.618, y: 0, w: 0.382, h: 1 }
      ]
    },
    {
      name: '黃金右分割',
      rects: [
        { x: 0, y: 0, w: 0.382, h: 1 },
        { x: 0.382, y: 0, w: 0.618, h: 1 }
      ]
    }
  ],
  3: [
    {
      name: '上大下雙',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '下大上雙',
      rects: [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '左大右雙',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '右大左雙',
      rects: [
        { x: 0.5, y: 0, w: 0.5, h: 1 },
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '三直欄',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 1 },
        { x: 0.3333, y: 0, w: 0.3334, h: 1 },
        { x: 0.6667, y: 0, w: 0.3333, h: 1 }
      ]
    },
    {
      name: '三橫欄',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.3333 },
        { x: 0, y: 0.3333, w: 1, h: 0.3334 },
        { x: 0, y: 0.6667, w: 1, h: 0.3333 }
      ]
    }
  ],
  4: [
    {
      name: '四格棋盤',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: '左大右疊',
      rects: [
        { x: 0, y: 0, w: 0.6667, h: 1 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: '右大左疊',
      rects: [
        { x: 0.3333, y: 0, w: 0.6667, h: 1 },
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: '一大三小',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.6667 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: '三小一大',
      rects: [
        { x: 0, y: 0.3333, w: 1, h: 0.6667 },
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 }
      ]
    }
  ],
  5: [
    {
      name: '左二右三',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0.5, y: 0.6667, w: 0.5, h: 0.3333 }
      ]
    },
    {
      name: '左三右二',
      rects: [
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0, y: 0, w: 0.5, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.5, h: 0.3333 }
      ]
    },
    {
      name: '一上四下',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: '一下四上',
      rects: [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: '五橫欄',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.2 },
        { x: 0, y: 0.2, w: 1, h: 0.2 },
        { x: 0, y: 0.4, w: 1, h: 0.2 },
        { x: 0, y: 0.6, w: 1, h: 0.2 },
        { x: 0, y: 0.8, w: 1, h: 0.2 }
      ]
    }
  ],
  6: [
    {
      name: '兩列三欄',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 0.5 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.5 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.5 },
        { x: 0, y: 0.5, w: 0.3333, h: 0.5 },
        { x: 0.3333, y: 0.5, w: 0.3334, h: 0.5 },
        { x: 0.6667, y: 0.5, w: 0.3333, h: 0.5 }
      ]
    },
    {
      name: '三列二欄',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0.5, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0.6667, w: 0.5, h: 0.3333 }
      ]
    },
    {
      name: '一大五小',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.2, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.4, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.6, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.8, y: 0.5, w: 0.2, h: 0.5 }
      ]
    },
    {
      name: '五小一大',
      rects: [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 0.2, h: 0.5 },
        { x: 0.2, y: 0, w: 0.2, h: 0.5 },
        { x: 0.4, y: 0, w: 0.2, h: 0.5 },
        { x: 0.6, y: 0, w: 0.2, h: 0.5 },
        { x: 0.8, y: 0, w: 0.2, h: 0.5 }
      ]
    },
    {
      name: '大角拼貼',
      rects: [
        { x: 0, y: 0, w: 0.6667, h: 0.6667 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    }
  ],
  7: [
    {
      name: '三上四下',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 0.5 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.5 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: '四上三下',
      rects: [
        { x: 0, y: 0, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0, w: 0.25, h: 0.5 },
        { x: 0, y: 0.5, w: 0.3333, h: 0.5 },
        { x: 0.3333, y: 0.5, w: 0.3334, h: 0.5 },
        { x: 0.6667, y: 0.5, w: 0.3333, h: 0.5 }
      ]
    },
    {
      name: '大左六小',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.6667 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.25, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.5, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.75, y: 0.6667, w: 0.25, h: 0.3333 }
      ]
    }
  ],
  8: [
    {
      name: '四直兩列',
      rects: [
        { x: 0, y: 0, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0, w: 0.25, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: '兩大六小',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0, y: 0.75, w: 0.5, h: 0.25 },
        { x: 0.5, y: 0.75, w: 0.5, h: 0.25 }
      ]
    }
  ],
  9: [
    {
      name: '九格棋盤',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0.3333, y: 0.3333, w: 0.3334, h: 0.3334 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: '錯位九宮',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0.3333, y: 0.3333, w: 0.3334, h: 0.3334 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.25, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.5, y: 0.6667, w: 0.25, h: 0.3333 },
        { x: 0.75, y: 0.6667, w: 0.25, h: 0.3333 }
      ]
    }
  ],
  10: [
    {
      name: '2x5 網格',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0, w: 0.5, h: 0.2 },
        { x: 0, y: 0.2, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0.2, w: 0.5, h: 0.2 },
        { x: 0, y: 0.4, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0.4, w: 0.5, h: 0.2 },
        { x: 0, y: 0.6, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0.6, w: 0.5, h: 0.2 },
        { x: 0, y: 0.8, w: 0.5, h: 0.2 },
        { x: 0.5, y: 0.8, w: 0.5, h: 0.2 }
      ]
    },
    {
      name: '5x2 網格',
      rects: [
        { x: 0, y: 0, w: 0.2, h: 0.5 },
        { x: 0.2, y: 0, w: 0.2, h: 0.5 },
        { x: 0.4, y: 0, w: 0.2, h: 0.5 },
        { x: 0.6, y: 0, w: 0.2, h: 0.5 },
        { x: 0.8, y: 0, w: 0.2, h: 0.5 },
        { x: 0, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.2, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.4, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.6, y: 0.5, w: 0.2, h: 0.5 },
        { x: 0.8, y: 0.5, w: 0.2, h: 0.5 }
      ]
    },
    {
      name: '3-4-3 交錯',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.25, h: 0.3334 },
        { x: 0.25, y: 0.3333, w: 0.25, h: 0.3334 },
        { x: 0.5, y: 0.3333, w: 0.25, h: 0.3334 },
        { x: 0.75, y: 0.3333, w: 0.25, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    }
  ]
};

// --- HSV and HEX helpers for embedded color picker ---
const hsvToHex = (h: number, s: number, v: number) => {
  s /= 100; v /= 100;
  let f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`.toUpperCase();
};

const hexToHsv = (hex: string) => {
  if (!hex || hex.length < 7) return { h: 0, s: 0, v: 100 };
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, v = max;
  let d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) h = 0;
  else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
};

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  onClose: () => void;
  /** 換掉預設的那一排色票。條紋的兩個顏色用的就是遮罩那一組（全 App 同一份）。 */
  colors?: string[];
  /** 有給的話，最上面會多一列「這個節點 ＋ 色號」，色票那一排就整排讓出來給色票 */
  headerLeft?: React.ReactNode;
}

/** 文字圖層的編輯面板：內容、字體、顏色、字距、粗體、邊緣發光。 */
/** 長按多久才算「要拖去交換」。150ms 太容易誤觸，拉長到 250ms。 */
/* 圖片交換需要明確長按；250ms 很容易在準備第二根手指縮放時誤觸。 */
const LONG_PRESS_MS = 380;


/**
 * 色票最前面那顆「自訂顏色」。外觀跟美顏那顆一致：
 * 彩虹環 ＋ 深色圓心 ＋ 滴管圖標，點下去開系統調色盤。
 */
const CustomColorButton: React.FC<{
  value: string;
  onPick: (c: string) => void;
  size?: number;
}> = ({ value, onPick, size = 32 }) => (
  <label
    title="自訂顏色"
    aria-label="自訂顏色"
    className="rounded-full shrink-0 relative cursor-pointer ring-1 ring-white/40 flex items-center justify-center overflow-hidden active:scale-90 transition-transform"
    style={{
      width: size, height: size,
      background: 'conic-gradient(#f43,#fa3,#fd3,#3d6,#3cf,#63f,#f3a,#f43)',
    }}
  >
    <span className="absolute inset-[5px] rounded-full bg-[#080808] flex items-center justify-center">
      <Icon name="colorize" className="text-[13px] text-white" />
    </span>
    <input
      type="color"
      value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
      onChange={e => onPick(e.target.value.toUpperCase())}
      aria-label="自訂顏色"
      className="absolute inset-0 opacity-0 cursor-pointer"
    />
  </label>
);

/**
 * 「逐帧合成」時傳給畫圖那一支的加速用具（只有錄影與 IG 預覽會傳）。
 *
 * 匯出一張照片是一次性的，所以那條路可以慢慢算到 2400 像素；
 * 但影片是**一秒要算三十次**的，用同一組數字就等於每一格都重做一次
 * 「整張圖的濾鏡＋一張新的離屏畫布＋一次遮罩模糊」——
 * 實測那正是「導出的影片幀率超低」與「套了形狀的影片在 IG 預覽裡不會動」。
 *
 *   k     ：合成畫布相對於頁面座標的倍率。所有中間畫布只算到「這一格
 *           真的會被看到的大小」，畫回去的尺寸一個像素都沒變。
 *   cache ：這一輪逐帧共用的暫存（遮罩、離屏畫布），不用每格重配。
 */
type LiveDraw = { k: number; cache: Map<string, any> };

/** IG 預覽用的「活的一頁」：一張一直在重畫的畫布，收掉時要 stop() */
type LivePage = { canvas: HTMLCanvasElement; stop: () => void } | null;

/* 「圖片調整」的工具清單：id / 名稱 / Material 圖標 / 範圍 / 預設值，跟「編輯」同一組 */
const TUNE_TOOLS: [string, string, string, number, number, number][] = [
  ['brightness', '亮度', 'light_mode', -100, 100, 0],
  ['exposure', '曝光', 'brightness_6', -100, 100, 0],
  ['contrast', '對比', 'contrast', -100, 100, 0],
  ['highlights', '高光', 'wb_sunny', -100, 100, 0],
  ['shadows', '陰影', 'brightness_low', -100, 100, 0],
  ['temp', '色溫', 'device_thermostat', -100, 100, 0],
  ['tint', '色調', 'colorize', -100, 100, 0],
  ['sat', '飽和度', 'palette', -100, 100, 0],
  ['vib', '自然飽和度', 'color_lens', -100, 100, 0],
  ['opacity', '透明度', 'opacity', 0, 100, 100],
];

/* 特效清單跟「編輯」完全一致（順序、名稱、圖標、預設強度都是同一份），
   後面 16 顆直接從 FX_DEFS 長出來，不再自己維護第二份表。
   銳化在編輯那邊是「調節」的最後一顆，拼圖這裡的調節沒有它，所以也不列。 */
const FX_ROOT_TOOLS: [string, string, string][] = [
  ['softLight', '柔光', 'blur_on'],
  ['halation', '光暈', 'flare'],
  ['lightLeak', '漏光', 'leak_add'],
  ['colorNoise', '噪點', 'grain'],
  ['blur', '朦朧', 'blur_linear'],
  ...FX_DEFS.filter(d => d.id !== 'fxSharpen').map(d => [d.id, d.label, d.icon] as [string, string, string]),
];

/** 卡片 → 外層那根「強度」滑桿實際調的參數（柔光／光暈／漏光的強度不是卡片 id 本身） */
const FX_AMOUNT: Record<string, string> = {
  softLight: 'soft', halation: 'fringeIntensity', lightLeak: 'leakOpacity',
};
const fxAmountId = (id: string) => FX_AMOUNT[id] || id;

/** 點下卡片時要套的強度，跟編輯同一組 */
const FX_ON_AMOUNT: Record<string, number> = {
  softLight: 100, halation: 100, lightLeak: 100, colorNoise: 40, blur: 40,
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, d.onAmount ?? 100])),
};

/* 「每一顆卡片自己的參數鍵」改由下面的 FX_CARD_KEYS 提供 ——
   它連細項（門檻／擴散／色相…）都算進去，原本這裡只列強度。 */
/** 所有特效的強度鍵，歸零時用 */
const FX_ALL_AMOUNTS = ['soft', 'fringeIntensity', 'leakOpacity', 'colorNoise', 'blur', 'vignette',
  ...FX_DEFS.map(d => d.id)];

/** 最外層那根滑桿要改調哪一個參數（沒設就是調「強度」）。
    來源是 FX_DEFS 裡的 rootParam —— 兩個工具讀同一份，不會各自走味。 */
const FX_ROOT_PARAM: Record<string, { id: string; label: string; min: number; max: number; def: number }> =
  Object.fromEntries(
    FX_DEFS.filter(d => d.rootParam).map(d => {
      const p = d.params.find(x => x.id === d.rootParam)!;
      return [d.id, { id: p.id, label: p.label, min: p.min, max: p.max, def: p.def }];
    }),
  );

/** 這一顆卡片的細項滑桿（第一根是強度，hidden 的不出現），跟編輯同一套 */
const FX_DETAIL: Record<string, [string, string, number, number, number][]> = {
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, [
    [d.id, '強度', 0, 100, 0] as [string, string, number, number, number],
    ...d.params.filter(p => !p.hidden).map(p =>
      [p.id, p.label, p.min, p.max, p.def] as [string, string, number, number, number]),
  ]])),
};

const FX_SUB_TOOLS: Record<string, [string, string, string, number, number, number][]> = {
  softLight: [
    ['soft', '強度', 'blur_on', 0, 100, 0],
    ['softThreshold', '範圍', 'tonality', 0, 95, 70],
    ['softRadius', '擴散', 'flare', 20, 100, 100],
    ['softColor', '色相', 'palette', 0, 100, 0],
  ],
  halation: [
    ['fringeIntensity', '強度', 'flare', 0, 100, 0],
    ['fringeSize', '擴散', 'blur_on', 0, 100, 10],
    ['fringeFeather', '範圍', 'tonality', 0, 100, 100],
    ['fringeHue', '色相', 'palette', 0, 360, 8],
  ],
  lightLeak: [
    ['leakOpacity', '強度', 'opacity', 0, 100, 0],
    ['leakAngle', '角度', 'rotate_right', 0, 360, 45],
    ['leakHue', '色相', 'palette', 0, 360, 15],
  ],
};

/** 一張特效卡片「連細項在內」的所有參數鍵（第一個一定是強度） */
const FX_CARD_KEYS: Record<string, string[]> = Object.fromEntries(
  FX_ROOT_TOOLS.map(([id]) => [
    id,
    FX_DETAIL[id] ? FX_DETAIL[id].map(t => t[0])
      : (FX_SUB_TOOLS[id] ? FX_SUB_TOOLS[id].map(t => t[0]) : [fxAmountId(id)]),
  ]),
);

/**
 * 所有特效參數的預設值 —— 強度歸零，細項回到出廠值。
 *
 * 跟「編輯」那邊是同一份（見 ImageEditor 的 EFFECT_ALL_KEYS／resetAllEffectParams，
 * 數字也就是 DEFAULT_PARAMS 裡的那些：柔光門檻 70、擴散 100、光暈擴散 10、
 * 羽化 100、色相 8、漏光角度 45、色相 15…）。
 *
 * 以前點特效卡片只把「別顆的強度」歸零，細項一律留著 —— 於是先在柔光的細項
 * 面板把門檻拉到 20，再去點別顆、回頭再點柔光，門檻還是 20；同一顆特效打開
 * 兩次得到不一樣的結果，跟編輯頁也對不起來。
 */
const FX_PARAM_DEFAULTS: Record<string, number> = {
  ...Object.fromEntries(FX_ALL_AMOUNTS.map(k => [k, 0])),
  ...Object.fromEntries(FX_ROOT_TOOLS.flatMap(([id]) => (
    FX_DETAIL[id] ? FX_DETAIL[id].map(t => [t[0], t[4]] as [string, number])
      : (FX_SUB_TOOLS[id] || []).map(t => [t[0], t[5]] as [string, number])
  ))),
};

/** 形狀分頁的工具（拼圖獨有，取代編輯裡的遮色片）。
    描邊與發光跟柔光一樣是兩段式：點進去才有粗細／顏色。 */
const SHAPE_TOOLS: [string, string, string, number, number, number][] = [
  /* 外形。點進去是一排形狀可以選（圓形／星型／愛心），不是滑桿。 */
  ['imgShape', '形狀', 'interests', 0, 0, 0],
  ['imgRadius', '圓角', 'rounded_corner', 0, 50, 0],
  /* 羽化一根滑桿就夠：0＝硬邊，100＝從邊緣一路羽化到圖片中心。 */
  ['feather', '羽化', 'gradient', 0, 100, 0],
  ['stroke', '描邊', 'border_style', 0, 0, 0],
  ['glow', '發光', 'light_mode', 0, 0, 0],
];

/* 「形狀」進來之後**不預先選任何一顆**。
   以前是固定停在圓角上，所以一進造型頁圓角就亮著、下面還多出一根滑桿 ——
   看起來像已經選好了，但使用者其實還沒挑。現在跟其他分頁一樣：
   全部都是暗的，點下去才亮、才長出那一根滑桿。 */

/** 描邊／發光點進去之後的子工具：粗細用滑桿、顏色用色票 */
const SHAPE_SUB_TOOLS: Record<string, [string, string, string, number, number, number][]> = {
  stroke: [
    ['imgStrokeWidth', '粗細', 'line_weight', 0, 100, 0],
    /* 虛線：0＝實線，往上拉是「一段有多長」（以線寬為單位），
       所以線越粗、虛線的節奏就跟著等比例放大，不會粗線配細碎的點。 */
    ['imgStrokeDash', '虛線', 'line_style', 0, 100, 0],
    ['imgStrokeGap', '間距', 'open_in_full', 0, 100, 0],
    ['imgStrokeColor', '顏色', 'palette', 0, 0, 0],
  ],
  glow: [
    ['imgGlow', '強度', 'light_mode', 0, 20, 0],
    ['imgGlowColor', '顏色', 'palette', 0, 0, 0],
  ],
};

const FX_DIRECT_RANGE: Record<string, [number, number]> = {
  blur: [0, 100], colorNoise: [0, 100], vignette: [0, 200],
};

/* 發光專用色票：跟創意拼圖的圖案發光同一組（那邊是本體，這裡照抄同一套算法）。
   基準色 #9BD4C3 轉成 HSL 之後「只改色相」（飽和度與亮度完全不動），
   每 360/14 度取一顆、照色相排成一圈漸層；第一顆固定是純白。 */
const GLOW_BASE = '#9BD4C3';
const glowHslToHex = (h: number, sat: number, l: number) => {
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const hp = ((((h % 360) + 360) % 360)) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`.toUpperCase();
};
/**
 * 色票的骨架：以 #9BD4C3 為基準，只轉色相（飽和度不動），
 * 每 360/14 度取一顆。**不排序** —— 直接從基準色的色相往前繞一圈，
 * 所以第一顆就是 #9BD4C3 本人，後面照色相順著滑過去、繞回原點，
 * 看起來還是一條連續的漸層。
 */
const GLOW_RAMP = (() => {
  const r = parseInt(GLOW_BASE.slice(1, 3), 16) / 255;
  const g = parseInt(GLOW_BASE.slice(3, 5), 16) / 255;
  const b = parseInt(GLOW_BASE.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h0 = 0;
  if (d !== 0) {
    h0 = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  }
  const step = 360 / 14;
  const hues: number[] = [];
  for (let i = 0; i < 14; i++) hues.push((((h0 + i * step) % 360) + 360) % 360);
  return { hues, sat, l };
})();

/** 名稱裡有「發光」的功能用這一組：亮度就是基準色本身的亮度 */
export const GLOW_COLORS = ['#FFFFFF', ...GLOW_RAMP.hues.map(h => glowHslToHex(h, GLOW_RAMP.sat, GLOW_RAMP.l))];

/**
 * 其他借用同一組色票的功能（文字、描邊、圖形、底色…）用這一組：
 * 色相與飽和度完全照舊，只把**明度**（HSV 的 V）從基準色的 83 提到 90 ——
 * 只亮一點點，還是同一條漸層。
 */
const GLOW_BASE_HSV = hexToHsv(GLOW_BASE);
export const SOFT_COLORS =
  ['#FFFFFF', ...GLOW_RAMP.hues.map(h => hsvToHex(h, GLOW_BASE_HSV.s, 90))];

/**
 * 文字顏色／文字描邊用的色票。
 * 就是上面那組淡的，只在最前面多墊一顆純黑 ——
 * 有黑色的色票，黑色一律排在純白前面。
 */
const TEXT_COLORS = ['#000000', ...SOFT_COLORS];

/**
 * 色票列：第一顆固定是自訂顏色（開系統調色盤），後面才是預設色。
 *
 * 這一段本來寫在 ImageAdjustPanel 裡面。圖形圖層的顏色要「跟發光的完全一樣」，
 * 所以整段原封不動搬到模組層共用 —— **一行邏輯都沒有改**，
 * 發光、描邊、圖形三個地方看到的就是同一個東西。
 */
export const swatchStrip = (
  value: string | undefined, colors: string[], onPick: (c: string) => void, big = false,
) => (
  <div className={`flex items-center overflow-x-auto no-scrollbar min-w-0 px-0.5 py-0.5 ${big ? 'gap-2 w-full' : 'gap-1.5'}`}>
    <CustomColorButton value={value || '#FFFFFF'} onPick={onPick} size={big ? 32 : 24} />
    {colors.map(c => (
      <button
        key={c}
        onClick={() => onPick(c)}
        title={c}
        className={`shrink-0 rounded-[7px] transition-all active:scale-90 ${big ? 'w-8 h-8' : 'w-6 h-6'} ${
          (value || '#FFFFFF').toUpperCase() === c ? 'border-2 border-white' : 'border border-white/20'
        }`}
        style={{ backgroundColor: c }}
      />
    ))}
  </div>
);

/**
 * 顏色的「獨立調整頁」。
 * 兩段式的顏色欄（點一下在下面攤開色票）改成：點下去整個面板換成這一頁，
 * 上面一顆返回，下面是排好幾列的色票 —— 跟創意拼圖的紋理顏色同一種操作。
 */
export const ColorPickerPage: React.FC<{
  value: string;
  colors?: string[];
  onPick: (c: string) => void;
  onBack: () => void;
}> = ({ value, colors, onPick, onBack }) => {
  /* 進來時把外面那個捲動容器捲回最上面 ——
     不然會沿用上一頁捲到哪就停在哪，一進顏色頁看到的是中間某一段。 */
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let el = rootRef.current?.parentElement as HTMLElement | null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) { el.scrollTop = 0; break; }
      el = el.parentElement;
    }
  }, []);
  return (
  <div ref={rootRef} className="animate-in fade-in duration-200 pt-1 pb-24">
    <div className="h-[38px] flex items-center gap-1">
      <button
        onClick={onBack}
        aria-label="返回"
        title="返回"
        className="flex items-center gap-1 px-2 h-7 -ml-1 rounded-[4px] text-[10px] font-bold text-[#888] hover:text-white hover:bg-white/[0.06] transition-colors"
      >
        <ChevronLeft size={14} />
        <span>返回</span>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-[9px] font-mono text-white/40">{(value || '').toUpperCase()}</span>
        <div className="w-6 h-5 rounded-[4px] shadow-inner border border-white/10" style={{ backgroundColor: value }} />
      </div>
    </div>
    {/* 色票只排一排（排不下就橫向捲），下面接色相／飽和度／明度 ——
        跟紋理顏色那一頁是同一顆元件、同一種操作。
        外面包一層高度 auto 的盒子：挑色器的根是 h-full，直接放會撐滿整格。 */}
    <div>
      <ColorPickerEmbedded color={value || '#FFFFFF'} onChange={onPick} onClose={onBack} />
    </div>
  </div>
  );
};

/* ── 新增圖形 ────────────────────────────────────────────────────────────
   圖形圖層跟照片、文字一樣都是 floatingImages 裡的一員（位置、縮放、旋轉、
   圖層順序、複製、刪除全部沿用同一套），只是內容換成一條路徑。

   路徑只寫一份、回傳 SVG 的 d 字串：
     預覽 →  <svg><path d={...} />
     匯出 →  new Path2D(同一條 d)
   兩邊吃的是同一條字串，所以畫布上看到的跟存下來的不可能長得不一樣。

   而且是「照外框 w×h 直接畫」，不是先畫正方形再拉伸 ——
   拉成長方形時描邊的粗細才不會跟著被拉扁。 */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** SVG 预览用的纹理字形；尺寸与 utils/pattern.ts 的 canvas patternGlyph 完全相同。 */
const textureGlyphD = (kind: 'star' | 'heart', cx: number, cy: number, r: number) => {
  const P = (x: number, y: number) => `${r3(x)} ${r3(y)}`;
  if (kind === 'star') {
    const R = r * 1.38;
    const pts: string[] = [];
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 === 0 ? R : R * 0.45;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      pts.push(`${k === 0 ? 'M' : 'L'} ${P(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)}`);
    }
    return `${pts.join(' ')} Z`;
  }
  const s = r * 1.22;
  return `M ${P(cx, cy + s * 0.85)} `
    + `C ${P(cx - s * 1.5, cy - s * 0.2)} ${P(cx - s * 0.55, cy - s * 1.15)} ${P(cx, cy - s * 0.4)} `
    + `C ${P(cx + s * 0.55, cy - s * 1.15)} ${P(cx + s * 1.5, cy - s * 0.2)} ${P(cx, cy + s * 0.85)} Z`;
};

export const shapePathD = (
  kind: string, w: number, h: number,
  gridBaseW = w, gridBaseH = h,
  gridDotRadius = Math.min(gridBaseW, gridBaseH) / 160 * 2.325,
): string => {
  const a = w / 2, b = h / 2, cx = a, cy = b;
  /* gridBaseW/H 會跟著「等比例縮放」一起變，但四邊擠壓時保持不動。
     因此縮放只會把整張網格等比放大；只有變形才會增加重複單位。 */
  const gbw = Math.max(1, gridBaseW), gbh = Math.max(1, gridBaseH);
  const P = (x: number, y: number) => `${r3(x)} ${r3(y)}`;
  const poly = (pts: [number, number][]) =>
    `M ${P(pts[0][0], pts[0][1])} ${pts.slice(1).map(p => `L ${P(p[0], p[1])}`).join(' ')} Z`;
  /** 正 n 邊形，start 是第一個頂點的角度 */
  const reg = (n: number, start: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const t = start + (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(t) * a, cy + Math.sin(t) * b]);
    }
    return poly(pts);
  };
  switch (kind) {
    case 'circle':
      // 兩段半橢圓弧接成一圈（單一 A 指令畫不了整圈）
      return `M ${P(0, cy)} A ${r3(a)} ${r3(b)} 0 1 1 ${P(w, cy)} A ${r3(a)} ${r3(b)} 0 1 1 ${P(0, cy)} Z`;
    case 'square':
    case 'square-star-dual':
    case 'square-heart-dual':
    case 'square-star-cutout':
    case 'square-heart-cutout':
      return poly([[0, 0], [w, 0], [w, h], [0, h]]);
    case 'rounded': {
      const r = Math.min(a, b) * 0.28;
      return `M ${P(r, 0)} L ${P(w - r, 0)} Q ${P(w, 0)} ${P(w, r)} `
        + `L ${P(w, h - r)} Q ${P(w, h)} ${P(w - r, h)} `
        + `L ${P(r, h)} Q ${P(0, h)} ${P(0, h - r)} `
        + `L ${P(0, r)} Q ${P(0, 0)} ${P(r, 0)} Z`;
    }
    case 'triangle': {
      // 四边挤压必须真正改变路径本身；三角形直接占满当前 w×h，
      // 不能再强制维持正三角形后只在变大的外框里重新置中。
      return poly([[w / 2, 0], [w, h], [0, h]]);
    }
    case 'diamond':
      return poly([[cx, 0], [w, cy], [cx, h], [0, cy]]);
    /* 窄菱形：一樣的四個角，只是左右往內收 —— 直立、細長的那種 */
    case 'diamond-n':
      return poly([[cx, 0], [cx + w * 0.28, cy], [cx, h], [cx - w * 0.28, cy]]);
    case 'pentagon': return reg(5, -Math.PI / 2);
    case 'hexagon': return reg(6, -Math.PI / 2);
    case 'star':
    case 'star-double': {
      const n = 5, inner = 0.42;
      const pts: [number, number][] = [];
      for (let i = 0; i < n * 2; i++) {
        const t = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
        const k = i % 2 ? inner : 1;
        pts.push([cx + Math.cos(t) * a * k, cy + Math.sin(t) * b * k]);
      }
      return poly(pts);
    }
    case 'star8': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 16; i++) {
        const t = -Math.PI / 2 + (i / 16) * Math.PI * 2;
        const k = i % 2 ? 0.46 : 1;
        pts.push([cx + Math.cos(t) * a * k, cy + Math.sin(t) * b * k]);
      }
      return poly(pts);
    }
    case 'cloud-oval': {
      // 八瓣橢圓雲：以完全對稱的週期函數建立八個相同圓頂，
      // 谷底刻意加深，讓每一個凸起在小尺寸按鈕上也清楚可辨。
      const n = 96;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const radius = 0.76 + 0.24 * Math.cos(8 * t);
        pts.push([cx + Math.cos(t) * a * radius, cy + Math.sin(t) * b * radius]);
      }
      const mid = (p0: [number, number], p1: [number, number]) =>
        [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2] as [number, number];
      const first = mid(pts[pts.length - 1], pts[0]);
      let d = `M ${P(first[0], first[1])}`;
      for (let i = 0; i < n; i++) {
        const next = mid(pts[i], pts[(i + 1) % n]);
        d += ` Q ${P(pts[i][0], pts[i][1])} ${P(next[0], next[1])}`;
      }
      return d + ' Z';
    }
    case 'heart':
    case 'heart-double':
      return `M ${P(cx, cy - b * 0.25)} `
        + `C ${P(cx + a * 0.6, cy - b)} ${P(cx + a * 1.3, cy - b * 0.1)} ${P(cx, cy + b * 0.9)} `
        + `C ${P(cx - a * 1.3, cy - b * 0.1)} ${P(cx - a * 0.6, cy - b)} ${P(cx, cy - b * 0.25)} Z`;
    /* 橢圓：跟圓形同一條路徑 —— 框不是正方形時它自然就是橢圓 */
    case 'ellipse':
      return `M ${P(0, cy)} A ${r3(a)} ${r3(b)} 0 1 1 ${P(w, cy)} A ${r3(a)} ${r3(b)} 0 1 1 ${P(0, cy)} Z`;
    /* 雲朵：平底、上面三個高低不同的圓駝峰。
       控制點是照著畫好的雲量出來的比例（0~1），所以框拉成什麼比例，
       雲就跟著等比例變形，兩邊也剛好貼齊框（0 與 1）。 */
    case 'cloud': {
      const C = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
        `C ${P(x1 * w, y1 * h)} ${P(x2 * w, y2 * h)} ${P(x3 * w, y3 * h)}`;
      return `M ${P(0.196 * w, h)} `
        + `${C(0.065, 1, 0, 0.857, 0, 0.714)} `
        + `${C(0, 0.554, 0.076, 0.429, 0.174, 0.429)} `
        + `${C(0.196, 0.179, 0.326, 0, 0.478, 0)} `
        + `${C(0.630, 0, 0.761, 0.179, 0.783, 0.429)} `
        + `${C(0.913, 0.429, 1, 0.571, 1, 0.732)} `
        + `${C(1, 0.875, 0.924, 1, 0.826, 1)} Z`;
    }
    /* 對話框：橢圓本體，左下角伸出一支尾巴。
       本體佔上面 80%，剩下的 20% 留給尾巴，所以整條路徑剛好塞滿外框。 */
    case 'bubble': {
      const bb = h * 0.80;                        // 橢圓本體的高度
      const bx = w / 2, by = bb / 2;              // 本體的中心
      const ra = w / 2, rb = bb / 2;              // 本體的兩個半徑
      /** 本體上角度 t（度，順時針、0 是最右邊）的那一點 */
      const E = (t: number) => {
        const rad = t * Math.PI / 180;
        return P(bx + ra * Math.cos(rad), by + rb * Math.sin(rad));
      };
      /** 沿著本體從現在的位置畫到角度 t（large＝要不要走大的那一段弧） */
      const A = (t: number, large: 0 | 1) => `A ${r3(ra)} ${r3(rb)} 0 ${large} 1 ${E(t)}`;
      // 尾巴接在本體左下（115°～137°）—— 接口窄、尖端更靠左，斜得比較明顯
      return `M ${E(0)} ${A(115, 0)} L ${P(w * 0.04, h)} L ${E(137)} ${A(360, 1)} Z`;
    }
    case 'grid-h': {
      const stepY = gbh / 6; // 原密度的一半：初始六條
      let d = '';
      for (let y = stepY / 2; y < h; y += stepY) d += `M 0 ${r3(y)} L ${r3(w)} ${r3(y)} `;
      // 壓得比一個週期更窄時仍保留正中央一條，不會縮到完全消失。
      return d || `M 0 ${r3(h / 2)} L ${r3(w)} ${r3(h / 2)}`;
    }
    case 'grid-cross': {
      const stepX = gbw / 6, stepY = gbh / 6;
      let hd = '', vd = '';
      for (let y = stepY / 2; y < h; y += stepY) hd += `M 0 ${r3(y)} L ${r3(w)} ${r3(y)} `;
      for (let x = stepX / 2; x < w; x += stepX) vd += `M ${r3(x)} 0 L ${r3(x)} ${r3(h)} `;
      return (hd || `M 0 ${r3(h / 2)} L ${r3(w)} ${r3(h / 2)} `)
        + (vd || `M ${r3(w / 2)} 0 L ${r3(w / 2)} ${r3(h)}`);
    }
    case 'grid-frame': {
      /* 初始 6×6。每次以完整格數重新等分，
         所以四邊永遠剛好封口，不會在右側或底部留下比較窄的小格。 */
      const cols = Math.max(1, Math.round((w / gbw) * 6));
      const rows = Math.max(1, Math.round((h / gbh) * 6));
      let d = `M 0 0 H ${r3(w)} V ${r3(h)} H 0 Z `;
      for (let col = 1; col < cols; col++) {
        const x = w * col / cols; d += `M ${r3(x)} 0 L ${r3(x)} ${r3(h)} `;
      }
      for (let row = 1; row < rows; row++) {
        const y = h * row / rows; d += `M 0 ${r3(y)} L ${r3(w)} ${r3(y)} `;
      }
      return d;
    }
    case 'grid-dots':
    case 'grid-dots-fade': {
      /* 初始固定 8×8。縮放時 w 與 base 同比例變化，數量維持 8×8；
         單邊變形只改 w/h，才會自然增加或減少行列。 */
      const stepX = gbw / 8, stepY = gbh / 8;
      const cols = Math.max(1, Math.floor(w / stepX));
      const rows = Math.max(1, Math.floor(h / stepY));
      let d = '';
      for (let row = 0; row < rows; row++) {
        const y = rows === 1 ? h / 2 : (row + 0.5) * stepY;
        for (let col = 0; col < cols; col++) {
          const x = cols === 1 ? w / 2 : (col + 0.5) * stepX;
          const fade = kind === 'grid-dots-fade' ? (1 - 0.68 * (x / Math.max(1, w))) : 1;
          const rr = gridDotRadius * fade;
          d += `M ${r3(x - rr)} ${r3(y)} A ${r3(rr)} ${r3(rr)} 0 1 0 ${r3(x + rr)} ${r3(y)} A ${r3(rr)} ${r3(rr)} 0 1 0 ${r3(x - rr)} ${r3(y)} Z `;
        }
      }
      return d;
    }
    case 'grid-diag': {
      /* 預設斜線數量加倍；變形才在兩端增減完整線段。 */
      const step = Math.max(gbw, gbh) / 4;
      let d = '';
      for (let q = -h; q <= w; q += step) {
        const x1 = Math.max(0, q), y1 = Math.max(0, -q);
        const x2 = Math.min(w, q + h), y2 = Math.min(h, w - q);
        if (Math.hypot(x2 - x1, y2 - y1) > 0.5) {
          d += `M ${r3(x1)} ${r3(y1)} L ${r3(x2)} ${r3(y2)} `;
        }
      }
      if (d) return d;
      const q = (w - h) / 2;
      return `M ${r3(Math.max(0, q))} ${r3(Math.max(0, -q))} L ${r3(Math.min(w, q + h))} ${r3(Math.min(h, w - q))}`;
    }
    case 'wave': {
      // 波長跟高度綁定；只增加寬度時會加入完整波峰，而不是把既有波形拉扁。
      const amp = h * 0.42;
      const count = Math.max(1, Math.round(w / Math.max(1, h * 1.2)));
      const step = w / count;
      let d = `M ${P(0, cy - amp)}`;
      for (let i = 0; i < count; i++) {
        const x = i * step;
        d += ` C ${P(x + step * 0.25, cy - amp)} ${P(x + step * 0.25, cy + amp)} ${P(x + step * 0.5, cy + amp)}`;
        d += ` C ${P(x + step * 0.75, cy + amp)} ${P(x + step * 0.75, cy - amp)} ${P(x + step, cy - amp)}`;
      }
      return d;
    }
    case 'lightning-wave': {
      // 稜角波浪同樣以完整週期增減；每一個週期保持固定的閃電折角比例。
      const count = Math.max(1, Math.round(w / Math.max(1, h * 0.9)));
      const step = w / count;
      // 每一段的水平距離與垂直距離相同，兩條 ±45° 線相交時正好是 90°。
      const amp = Math.min(h * 0.44, step / 4);
      let d = `M ${P(0, cy - amp)}`;
      for (let i = 0; i < count; i++) {
        const x = i * step;
        d += ` L ${P(x + step * 0.5, cy + amp)} L ${P(x + step, cy - amp)}`;
      }
      return d;
    }
    case 'bubble-mirror': {
      const bb = h * 0.80, bx = w / 2, by = bb / 2, ra = w / 2, rb = bb / 2;
      const E = (t: number) => {
        const rad = t * Math.PI / 180;
        return P(w - (bx + ra * Math.cos(rad)), by + rb * Math.sin(rad));
      };
      const A = (t: number, large: 0 | 1) => `A ${r3(ra)} ${r3(rb)} 0 ${large} 0 ${E(t)}`;
      return `M ${E(0)} ${A(115, 0)} L ${P(w * 0.96, h)} L ${E(137)} ${A(360, 1)} Z`;
    }
    case 'line':
      return `M ${P(0, cy)} L ${P(w, cy)}`;
    default:
      return poly([[0, 0], [w, 0], [w, h], [0, h]]);
  }
};

/**
 * 圖形的線寬。基準是「外框長邊的 1/160」，所以同一個粗細值在大圖形與
 * 小圖形上看起來一樣粗，縮放時也跟著等比例走。
 */
export const shapeLineWidth = (lineW: number | undefined, w: number, h: number) =>
  Math.max(0.4, (lineW ?? 6) * (Math.max(w, h) / 160));

/**
 * 圖形的發光：三段模糊疊起來（跟文字、圖片的發光同一套做法），
 * 顏色就用圖形自己的顏色。半徑跟著圖形大小走，放大縮小時觀感一致。
 */
export const shapeGlowBlurs = (w: number, h: number) =>
  [1, 2, 3].map(k => Math.max(w, h) * 0.045 * k);

/** 新增圖形時的預設值。線條比較細長，所以粗細與大小另外給。 */
export const SPECIAL_LINE_KINDS = new Set(['line', 'wave', 'lightning-wave']);
export const GRID_SHAPE_KINDS = new Set([
  'grid-h', 'grid-cross', 'grid-frame', 'grid-dots', 'grid-dots-fade', 'grid-diag',
]);
export const GRID_DOT_KINDS = new Set(['grid-dots', 'grid-dots-fade']);
export const DUAL_COLOR_SHAPE_KINDS = new Set(['square-star-dual', 'square-heart-dual']);
export const CUTOUT_SHAPE_KINDS = new Set(['square-star-cutout', 'square-heart-cutout']);
export const DOUBLE_CONTOUR_SHAPE_KINDS = new Set(['heart-double', 'star-double']);
export const COMPOSITE_SHAPE_KINDS = new Set([
  ...DUAL_COLOR_SHAPE_KINDS, ...CUTOUT_SHAPE_KINDS, ...DOUBLE_CONTOUR_SHAPE_KINDS,
]);
export const SHAPE_DEFAULT_LINEW = (kind: string) =>
  (kind === 'wave' || kind === 'lightning-wave') ? 2.5 : (kind === 'line' ? 4 : 6);
/** 生成時佔頁面短邊的比例。線條保持原本的長度，其餘一律減半。 */
export const SHAPE_DEFAULT_RATIO = (kind: string) =>
  (kind === 'wave' || kind === 'lightning-wave') ? 0.576 : (kind === 'line' ? 0.24 : 0.15);
/** 新圖形的預設顏色。 */
export const SHAPE_DEFAULT_COLOR = '#DCE7DB';

/** 四邊擠壓白名單：實心前 11 顆、邊框前 16 顆。 */
const STRETCH_SOLID_KINDS = new Set([
  'circle', 'square', 'rounded', 'triangle', 'diamond', 'diamond-n',
  'pentagon', 'hexagon', 'star', 'heart',
  'square-star-dual', 'square-heart-dual', 'square-star-cutout', 'square-heart-cutout',
  'heart-double', 'star-double',
]);
const STRETCH_OUTLINE_KINDS = new Set([
  'circle', 'square', 'rounded', 'triangle', 'diamond', 'diamond-n',
  'pentagon', 'hexagon', 'star', 'star8', 'heart', 'ellipse',
]);
export const shapeSupportsStretch = (shape: string | undefined, filled: boolean | undefined, holeType?: string) => {
  if (!shape || shape === 'line') return false;
  if (shape === 'wave' || shape === 'lightning-wave' || GRID_SHAPE_KINDS.has(shape)) return true;
  if (shape === 'hole') return false;
  return filled ? STRETCH_SOLID_KINDS.has(shape) : STRETCH_OUTLINE_KINDS.has(shape);
};
/** 羽化只开放给前十个基础实心路径图形；第十一个实心十字星不支持。 */
export const shapeSupportsFeather = (_shape: string | undefined, _filled: boolean | undefined, _holeType?: string) => false;
export const shapeFeatherBlur = (w: number, h: number, value?: number) =>
  Math.max(0, Math.min(w, h) * (Math.max(0, Math.min(100, value || 0)) / 100) * 0.03);

/** 将实心图形先画到独立画布，再用内缩模糊 alpha 遮罩合成。
 * 与图片边缘羽化一样，改变的是边缘透明度，而不是给硬边图形加一层视觉 blur。 */
export const drawFeatheredShapeBody = (
  target: CanvasRenderingContext2D,
  kind: string, w: number, h: number, _feather: number | undefined,
  color: string,
  paintTexture?: (ctx: CanvasRenderingContext2D, path: Path2D) => void,
  innerColor = '#FFFFFF',
) => {
  if (drawCompositeShapeBody(target, kind, w, h, color, innerColor, paintTexture)) return;
  // 圖形羽化已移除；保留同一個繪製入口以相容既有草稿資料。
  const path = new Path2D(shapePathD(kind, w, h));
  target.fillStyle = color;
  target.fill(path);
  paintTexture?.(target, path);
};

/** 「新增圖形」清單。rot 是按鈕與圖形都要轉的角度，ratio 是高度佔寬度的比例 */
export type ShapeItem = { id: string; kind: string; filled: boolean; rot?: number; ratio?: number; glyphRatio?: number };
export const ADD_SHAPE_ITEMS: ShapeItem[] = [
  // 實心
  { id: 'circle-f', kind: 'circle', filled: true },
  { id: 'square-f', kind: 'square', filled: true },
  { id: 'rounded-f', kind: 'rounded', filled: true },
  { id: 'triangle-f', kind: 'triangle', filled: true },
  { id: 'diamond-f', kind: 'diamond', filled: true },
  { id: 'diamond-n-f', kind: 'diamond-n', filled: true },
  { id: 'pentagon-f', kind: 'pentagon', filled: true },
  { id: 'hexagon-f', kind: 'hexagon', filled: true },
  { id: 'star-f', kind: 'star', filled: true },
  { id: 'heart-f', kind: 'heart', filled: true },
  /* 最後一排複合實心圖形。前兩顆是雙色實心、接著兩顆挖空，最後兩顆
     是原本愛心／星星外面再加一圈同形細線。 */
  { id: 'square-star-dual-f', kind: 'square-star-dual', filled: true },
  { id: 'square-heart-dual-f', kind: 'square-heart-dual', filled: true },
  { id: 'square-star-cutout-f', kind: 'square-star-cutout', filled: true },
  { id: 'square-heart-cutout-f', kind: 'square-heart-cutout', filled: true },
  { id: 'heart-double-f', kind: 'heart-double', filled: true },
  { id: 'star-double-f', kind: 'star-double', filled: true },
  // 細框
  { id: 'circle-o', kind: 'circle', filled: false },
  { id: 'square-o', kind: 'square', filled: false },
  { id: 'rounded-o', kind: 'rounded', filled: false },
  { id: 'triangle-o', kind: 'triangle', filled: false },
  { id: 'diamond-o', kind: 'diamond', filled: false },
  { id: 'pentagon-o', kind: 'pentagon', filled: false },
  { id: 'hexagon-o', kind: 'hexagon', filled: false },
  { id: 'star-o', kind: 'star', filled: false },
  { id: 'star8-o', kind: 'star8', filled: false },
  { id: 'star8-oval-o', kind: 'star8', filled: false, ratio: 0.62 },
  { id: 'heart-o', kind: 'heart', filled: false },
  { id: 'diamond-n-o', kind: 'diamond-n', filled: false },
  { id: 'ellipse-o', kind: 'ellipse', filled: false, ratio: 0.68 },
  { id: 'cloud-oval-o', kind: 'cloud-oval', filled: false, ratio: 0.68 },
  { id: 'cloud-o', kind: 'cloud', filled: false, ratio: 0.62 },
  { id: 'bubble-o', kind: 'bubble', filled: false, ratio: 0.82 },
  { id: 'bubble-mirror-o', kind: 'bubble-mirror', filled: false, ratio: 0.82 },
  // 線條
  { id: 'line-h', kind: 'line', filled: false, rot: 0, ratio: 0.08 },
  { id: 'line-v', kind: 'line', filled: false, rot: 90, ratio: 0.08 },
  { id: 'line-d1', kind: 'line', filled: false, rot: -45, ratio: 0.08 },
  { id: 'line-d2', kind: 'line', filled: false, rot: 45, ratio: 0.08 },
  { id: 'line-wave', kind: 'wave', filled: false, rot: 90, ratio: 0.1417, glyphRatio: 0.17 },
  { id: 'line-lightning-wave', kind: 'lightning-wave', filled: false, rot: 90, ratio: 0.1417, glyphRatio: 0.17 },
  // 網格：線／點的尺寸固定；改變外框只會增減重複單位
  { id: 'grid-horizontal', kind: 'grid-h', filled: false },
  { id: 'grid-cross', kind: 'grid-cross', filled: false },
  { id: 'grid-frame', kind: 'grid-frame', filled: false },
  { id: 'grid-dots', kind: 'grid-dots', filled: true },
  { id: 'grid-dots-fade', kind: 'grid-dots-fade', filled: true },
  { id: 'grid-diagonal', kind: 'grid-diag', filled: false },
];

/**
 * 每一種圖形「實際畫出來的內容」在 0~1 的框裡佔哪一塊 [x, y, w, h]。
 *
 * 有些圖形本來就不會塞滿整個外框（五邊形與星形下面空一截、六邊形左右空、
 * 愛心四周都空），所以按鈕上的小圖如果直接照外框畫，看起來就是偏一邊。
 * 這張表是拿真正的路徑量出來的（路徑是固定的常數，量一次就好），
 * 按鈕靠它把圖案縮到剛好、擺到正中間。
 */
export const SHAPE_FIT: Record<string, [number, number, number, number]> = {
  circle: [0, 0, 1, 1],
  square: [0, 0, 1, 1],
  rounded: [0, 0, 1, 1],
  triangle: [0, 0, 1, 1],
  diamond: [0, 0, 1, 1],
  'diamond-n': [0.22, 0, 0.56, 1],
  pentagon: [0.0245, 0, 0.9511, 0.9045],
  hexagon: [0.067, 0, 0.866, 1],
  star: [0.0245, 0, 0.9511, 0.9045],
  heart: [0.1324, 0.2362, 0.7352, 0.7138],
  ellipse: [0, 0, 1, 1],
  cloud: [0, 0, 1, 1],
  bubble: [0, 0, 1, 1],
  'bubble-mirror': [0, 0, 1, 1],
  star8: [0, 0, 1, 1],
  'cloud-oval': [0, 0, 1, 1],
  line: [0, 0.5, 1, 0],
  wave: [0, 0.08, 1, 0.84],
  'lightning-wave': [0, 0.06, 1, 0.88],
  'grid-h': [0, 0, 1, 1],
  'grid-cross': [0, 0, 1, 1],
  'grid-frame': [0, 0, 1, 1],
  'grid-dots': [0, 0, 1, 1],
  'grid-dots-fade': [0, 0, 1, 1],
  'grid-diag': [0, 0, 1, 1],
  'square-star-dual': [0, 0, 1, 1],
  'square-heart-dual': [0, 0, 1, 1],
  'square-star-cutout': [0, 0, 1, 1],
  'square-heart-cutout': [0, 0, 1, 1],
  'heart-double': [0, 0, 1, 1],
  'star-double': [0, 0, 1, 1],
};

const compositeInnerKind = (kind: string): 'star' | 'heart' | null =>
  kind.includes('star') ? 'star' : kind.includes('heart') ? 'heart' : null;

/** 把既有愛心／星星的「實際墨水」置中並縮進指定比例，完全沿用原路徑。 */
export const insetShapePath = (
  kind: 'star' | 'heart', w: number, h: number, inkFraction: number,
) => {
  const srcSize = 100;
  const fit = SHAPE_FIT[kind];
  const sx = (w * inkFraction) / (fit[2] * srcSize);
  const sy = (h * inkFraction) / (fit[3] * srcSize);
  const inkCx = (fit[0] + fit[2] / 2) * srcSize;
  const inkCy = (fit[1] + fit[3] / 2) * srcSize;
  const matrix = new DOMMatrix([sx, 0, 0, sy, w / 2 - inkCx * sx, h / 2 - inkCy * sy]);
  const out = new Path2D();
  out.addPath(new Path2D(shapePathD(kind, srcSize, srcSize)), matrix);
  return out;
};

/**
 * 六顆複合圖形的本體。回傳 true 代表已完成繪製：
 * - 雙色款：紋理只鋪外方形，再以純色內層完整蓋住。
 * - 挖空款：真正清除 alpha，不是假裝塗成背景色。
 * - 雙輪廓款：內層仍是原本實心路徑，外圈只是一條同形細線。
 */
export const drawCompositeShapeBody = (
  target: CanvasRenderingContext2D,
  kind: string, w: number, h: number,
  color: string, innerColor = '#FFFFFF',
  paintTexture?: (ctx: CanvasRenderingContext2D, path: Path2D) => void,
) => {
  if (!COMPOSITE_SHAPE_KINDS.has(kind)) return false;
  const innerKind = compositeInnerKind(kind)!;
  if (DUAL_COLOR_SHAPE_KINDS.has(kind) || CUTOUT_SHAPE_KINDS.has(kind)) {
    const outer = new Path2D(shapePathD('square', w, h));
    const inner = insetShapePath(innerKind, w, h, 0.64);
    target.fillStyle = color;
    if (DUAL_COLOR_SHAPE_KINDS.has(kind)) {
      target.fill(outer);
      paintTexture?.(target, outer);
      target.fillStyle = innerColor;
      target.fill(inner);
    } else {
      const punched = new Path2D();
      punched.addPath(outer);
      punched.addPath(inner);
      target.fill(punched, 'evenodd');
      if (paintTexture) {
        target.save();
        target.clip(punched, 'evenodd');
        paintTexture(target, outer);
        target.restore();
      }
    }
    return true;
  }
  const body = insetShapePath(innerKind, w, h, 0.72);
  const ring = insetShapePath(innerKind, w, h, 0.96);
  target.fillStyle = color;
  target.fill(body);
  paintTexture?.(target, body);
  target.save();
  target.strokeStyle = color;
  target.lineWidth = Math.max(1, Math.min(w, h) * 0.024);
  target.lineJoin = 'round';
  target.stroke(ring);
  target.restore();
  return true;
};

/** 個別圖案的加大倍率。星形是實心面積最少的一個，稍微放大一點才看得清楚。
    1.1 ＝ 長邊從 20px 變成 22px。 */
const GLYPH_ZOOM: Record<string, number> = { star: 1.1, star8: 1.22, 'cloud-oval': 1.3 };

/**
 * 「新增圖形」按鈕上的小圖。
 *
 * 刻意不用圖示字型：專案裡的 Material Symbols 是**子集**（只打包了有用到的字），
 * pentagon、hexagon、favorite、horizontal_rule 這幾個根本不在裡面 ——
 * 用了就會直接把英文字印在按鈕上，還會撐爆格子蓋到隔壁那顆。
 * 改成用 shapePathD 自己畫：按鈕上看到的形狀、實心／細框、角度，
 * 就是按下去之後真的會加進畫面的那一個，一模一樣。
 *
 * 畫法：先照外框畫一次，再用 SHAPE_FIT 把「真正有畫到的那一塊」
 * 縮放並平移到 24×24 的正中央 —— 所以每一顆按鈕的圖案都在正中心。
 */
export const ShapeGlyph: React.FC<{ item: ShapeItem; size?: number }> = ({ item, size = 20 }) => {
  const maskId = React.useId().replace(/:/g, '');
  const isLine = item.kind === 'line';
  const isGridGlyph = GRID_SHAPE_KINDS.has(item.kind);
  /* viewBox 與圖案的框一樣大 —— 每一顆圖案的長邊都剛好等於 size（預設 20px），
     所以不管哪一種形狀，看起來都一樣大。 */
  const VB = 24;
  const BOX = VB;
  if (COMPOSITE_SHAPE_KINDS.has(item.kind)) {
    const innerKind = compositeInnerKind(item.kind)!;
    const fit = SHAPE_FIT[innerKind];
    const tf = (fraction: number) => {
      const sx = (VB * fraction) / (fit[2] * 100);
      const sy = (VB * fraction) / (fit[3] * 100);
      const cx = (fit[0] + fit[2] / 2) * 100;
      const cy = (fit[1] + fit[3] / 2) * 100;
      return `matrix(${r3(sx)} 0 0 ${r3(sy)} ${r3(VB / 2 - cx * sx)} ${r3(VB / 2 - cy * sy)})`;
    };
    const innerD = shapePathD(innerKind, 100, 100);
    if (DUAL_COLOR_SHAPE_KINDS.has(item.kind)) return (
      <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} aria-hidden>
        <rect width={VB} height={VB} fill="currentColor" />
        <path d={innerD} transform={tf(0.64)} fill="#fff" />
      </svg>
    );
    if (CUTOUT_SHAPE_KINDS.has(item.kind)) return (
      <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} aria-hidden>
        <defs><mask id={maskId}><rect width={VB} height={VB} fill="#fff" /><path d={innerD} transform={tf(0.64)} fill="#000" /></mask></defs>
        <rect width={VB} height={VB} fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    );
    return (
      <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} style={{ overflow: 'visible' }} aria-hidden>
        <path d={innerD} transform={tf(0.72)} fill="currentColor" />
        <path d={innerD} transform={tf(0.96)} fill="none" stroke="currentColor"
          strokeWidth={0.58} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    );
  }
  /* 有指定比例的（3:4、2:3… 那種邊框、橢圓）要照比例畫，
     不然按鈕上會全部變成正方形、看不出差別。 */
  const ratio = isLine ? 0 : ((item as any).glyphRatio ?? (item as any).ratio ?? 0);
  const bw = BOX;
  const bh = isLine ? 0 : (ratio ? BOX * ratio : BOX);
  const src = shapePathD(item.kind, bw, bh);
  const solid = item.filled && (!isLine || GRID_DOT_KINDS.has(item.kind));

  const fit = SHAPE_FIT[item.kind] || [0, 0, 1, 1];
  // 內容的實際大小（線條的高度是 0，縮放只看寬度）
  const cw = fit[2] * bw, ch = fit[3] * bh;
  const k = (GLYPH_ZOOM[item.kind] || 1)
    * Math.min(cw > 0 ? BOX / cw : Infinity, ch > 0 ? BOX / ch : Infinity);
  // 先把內容的中心搬到原點、放大、再搬到 viewBox 的正中央
  const ccx = (fit[0] + fit[2] / 2) * bw;
  // 線條的路徑高度是 0（畫在 y=0 那一條），所以它的內容中心 y 就是 0
  const ccy = isLine ? 0 : (fit[1] + fit[3] / 2) * bh;
  /* 順序有講究：先把內容中心搬到原點 → 轉角度 → 縮放 → 搬到 viewBox 正中央。
     （SVG 的 transform 是由左往右套用到座標系上，所以寫起來剛好是反過來的。）
     轉角度要在「搬到原點之後」，不然斜線會繞著自己的端點轉，就歪掉了。 */
  const tf = `translate(${r3(VB / 2)} ${r3(VB / 2)}) scale(${r3(k)})`
    + (item.rot ? ` rotate(${item.rot})` : '')
    + ` translate(${r3(-ccx)} ${r3(-ccy)})`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} style={{ overflow: 'visible' }} aria-hidden>
      <g transform={tf}>
        <path
          d={src}
          fill={solid ? 'currentColor' : 'none'}
          stroke={solid ? 'none' : 'currentColor'}
          strokeWidth={(isGridGlyph ? 1.5 : (isLine ? 1.9 : 1.6)) / k}
          strokeLinecap="butt"
          strokeLinejoin={isLine ? 'round' : 'miter'}
        />
      </g>
    </svg>
  );
};

/**
 * iOS 的 range 在手指移動時可能一秒送出上百筆事件。受控 input 會等 React
 * 畫完整個預覽後才把圓點推到新位置，因此圖形愈複雜，滑桿本人反而愈卡。
 * 這顆讓瀏覽器原生滑塊先即時移動，預覽更新則合併成每個螢幕幀最後一筆；
 * 放手時一定同步送出最終值，不會漏掉最後一格。
 */
export const SmoothRange: React.FC<{
  value: number;
  min: number;
  max: number;
  step?: number;
  onValue: (value: number) => void;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, min, max, step = 1, onValue, className = '', style }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const pendingRef = useRef(value);
  const rafRef = useRef(0);
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;

  useLayoutEffect(() => {
    if (!draggingRef.current && inputRef.current) inputRef.current.value = String(value);
  }, [value]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const queue = (next: number) => {
    pendingRef.current = next;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      onValueRef.current(pendingRef.current);
    });
  };
  const finish = () => {
    draggingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const next = Number(inputRef.current?.value ?? pendingRef.current);
    pendingRef.current = next;
    onValueRef.current(next);
  };
  return (
    <input
      ref={inputRef}
      type="range"
      min={min} max={max} step={step}
      defaultValue={value}
      onPointerDown={() => { draggingRef.current = true; }}
      onInput={e => queue(Number((e.currentTarget as HTMLInputElement).value))}
      onPointerUp={finish}
      onPointerCancel={finish}
      onBlur={() => { if (draggingRef.current) finish(); }}
      className={className}
      style={style}
    />
  );
};

/* 「圖案」那幾顆借過來的圖形，按鈕上的小圖跟創意拼圖用同一份 —— 
   兩個工具的清單長得一樣，點下去加出來的也是同一顆。 */
/* --- 自製十字星圖標 ---
   同一條路徑兩種畫法：filled 就填滿、不填就描邊。
   （「新增圖形」實心那一排的第 11 顆是實心版，邊框那排是描邊版。） */
export const CrossStarIcon = ({ size = 20, strokeWidth = 1.5, filled = false }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke={filled ? 'none' : 'currentColor'}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="M12 2 Q12 12 2 12 Q12 12 12 22 Q12 12 22 12 Q12 12 12 2 Z" />
  </svg>
);

// --- 自製單線旋渦圖標 ---
export const VortexIcon = ({ size = 20, strokeWidth = 2.2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
    <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5 8.5 8.5 0 0 1-8.5 8.5 7.5 7.5 0 0 1-7.5-7.5 6.5 6.5 0 0 1 6.5-6.5 5.5 5.5 0 0 1 5.5 5.5 4.5 4.5 0 0 1-4.5 4.5 3.5 3.5 0 0 1-3.5-3.5 2.5 2.5 0 0 1 2.5-2.5 1.5 1.5 0 0 1 1.5 1.5" />
  </svg>
);

/** 一顆「圖案」的小圖（形狀分頁的選單與『新增圖形』清單共用同一份）。 */
/* 實心版的十字星是「凹進去」的四角星，同樣 18px 畫出來的墨水比旁邊那些
   圖示少很多、看起來小一號 —— 所以實心版單獨放大到 28px。 */
export const HoleGlyph: React.FC<{ s: string; filled?: boolean }> = ({ s, filled }) => (
  <>
    {s === 'circle' ? <Circle size={18} /> : s === 'square' ? <Square size={18} /> : s === 'cross-star' ? <CrossStarIcon size={filled ? 28 : 22} filled={filled} /> : s === 'heart' ? <Heart size={18} /> : s === 'star' ? <Star size={18} /> : s === 'love' ? <span className="text-xs font-black font-mono tracking-tighter leading-none">&lt;3</span> : s === 'love3' ? <span className="text-[10px] font-black font-mono tracking-tighter leading-none">&lt;333</span> : s === 'vortex' ? <VortexIcon size={18} /> : s === 'random-num' ? <span className="text-sm font-bold font-sans leading-none tracking-tight">(9)</span> : SHAPE_IMAGES[s] ? (
                        /* 去背的圖：拿它當遮罩、底色用 currentColor，
                           顏色就跟旁邊那些圖示走同一條規則 ——
                           沒選中時是暗的（#555），選中才變白。
                           （原本是用 filter 硬染成白色，所以永遠亮著。） */
                        <span
                          aria-hidden
                          style={{
                            display: 'block',
                            width: s === 'abai' ? 29 : 26,
                            height: (s === 'abai' ? 29 : 26) / holeImgRatio(s),
                            backgroundColor: 'currentColor',
                            WebkitMaskImage: `url(${SHAPE_IMAGES[s]})`,
                            maskImage: `url(${SHAPE_IMAGES[s]})`,
                            WebkitMaskSize: 'contain',
                            maskSize: 'contain',
                            WebkitMaskRepeat: 'no-repeat',
                            maskRepeat: 'no-repeat',
                            WebkitMaskPosition: 'center',
                            maskPosition: 'center',
                          }}
                        />
                      ) : GLYPH_HOLES[s] ? (
                        <span
                          className="font-bold font-sans leading-none inline-block whitespace-nowrap"
                          style={{
                            fontSize: `${GLYPH_BTN[s]?.size ?? 18}px`,
                            transform: (GLYPH_BTN[s]?.dx || GLYPH_BTN[s]?.dy)
                              ? `translate(${GLYPH_BTN[s]?.dx ?? 0}px, ${GLYPH_BTN[s]?.dy ?? 0}px)`
                              : undefined,
                          }}
                        >
                          {GLYPH_HOLES[s]}
                        </span>
                      ) : <Type size={18} />}
  </>
);

const FontCard: React.FC<{
  font: { name: string; label: string; category: FontCategory };
  active: boolean;
  onPick: () => void;
}> = ({ font, active, onPick }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    // 捲到才載入，否則一次要抓上百個 CJK 字體
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => { if (visible) ensureFont(font.name); }, [visible, font.name]);

  return (
    <button
      ref={ref}
      onClick={onPick}
      title={font.label}
      className={`flex flex-col items-center justify-center gap-1 h-[62px] px-1.5 rounded-xl border transition-all ${
        active ? 'bg-white/10 border-white' : 'bg-white/[0.03] border-white/10 hover:border-white/25'
      }`}
    >
      {/* 行高不能用 leading-none：那樣行盒只有 19px，可是不少字體（尤其是中日韓）
          的字身高度超過 1 個 em —— truncate 帶著 overflow:hidden，超出去的部分
          就被切掉了，看起來就是範例字上面被蓋住一截。
          放到 1.6 em 讓任何字體都放得下；卡片是 62px 高、內容加起來 48px，還有餘裕。 */}
      <span
        className="text-[19px] leading-[1.6] text-white truncate max-w-full"
        style={{ fontFamily: visible ? fontStack(font.name) : undefined }}
      >
        {FONT_SAMPLE[font.category]}
      </span>
      <span className="text-[9px] font-bold tracking-wider text-white/40 truncate max-w-full">{font.label}</span>
    </button>
  );
};

/* ── 新增符號 ──────────────────────────────────────────────────────────
   符號說到底就是一段文字，所以加進畫面之後就是一個文字圖層：一樣可以拖、
   可以縮放旋轉、可以點兩下直接在畫布上改字。差別只在可以調的東西比較少
   （顏色、大小、發光），那是 TextEditorPanel 的 symbol 模式在管。 */

/**
 * 一顆符號按鈕上的圖。
 *
 * 有些符號特別長（最長的接近一百個字），照原本的字級畫一定會戳出按鈕，
 * 所以量完真正需要的寬度之後，整串等比縮小塞進去。縮的是「畫出來的大小」
 * （transform），不是字級 —— 排版、組合附加符號（疊在前一個字上面的小點、
 * 小星星）的位置都不會跑掉，而且看到的一定是完整的一整串，不會被裁掉、
 * 也不會變成「…」。字型晚一點才載好時寬度會變，所以 fonts.ready 之後
 * 再量一次；按鈕本身寬度變了（轉向）也用 ResizeObserver 重量。
 */
export const SymbolGlyph: React.FC<{ text: string; base?: number }> = ({ text, base = 15 }) => {
  /* 不再為清單中的每一顆建立 state、ResizeObserver 與 fonts.ready 回呼。
     那套做法會讓幾百顆按鈕先用 fallback 畫一遍，再同時換字體與縮放一次，
     正是進頁面時「整片符號抖一下」與點擊延遲的來源。Canvas advance 是同步、
     有快取的純量測；第一次繪製前就已經得到最終尺寸。 */
  const displayText = symbolTextPresentation(text);
  const naturalWidth = measureSymbolAdvance(displayText, SYMBOL_FONT, base);
  const fontSize = base * Math.min(1, 252 / Math.max(1, naturalWidth));
  return (
    <span
      className="inline-flex max-w-full items-center justify-center whitespace-pre text-center"
      style={{
        flexShrink: 0,
        fontFamily: fontStack(SYMBOL_FONT),
        fontSize,
        lineHeight: 1.9,
        minHeight: base * 1.9,
        overflow: 'visible',
        /* 少數碼位在 iOS 沒有單色字身時仍會退回 Color Emoji；選單統一
           轉成白色輪廓，和新增到畫布後的可改色符號一致。 */
        filter: 'grayscale(1) brightness(0) invert(1)',
      }}
    >
      {text === "\u22b9 \u08ea \u02d6\u0359\u0358\u0361\u2605" ? (() => {
        const [before, after] = displayText.split("\u08ea");
        return <>{before}<span style={{ display: 'inline-block', transform: 'translateX(-0.08em)' }}>{"\u08ea"}</span>{after}</>;
      })() : displayText}
    </span>
  );
};
/**
 * 「新增符號」那一頁：上面一顆返回，下面一長串符號，點一下就加到版面正中間。
 * 一排只放一顆 —— 長的符號要一整排的寬度才擺得完整。
 * 跟「新增圖形」一樣，點完留在這一頁、不跳去編輯，可以連著加好幾顆。
 */
export const SymbolPicker: React.FC<{
  onBack: () => void;
  onPick: (s: string) => void;
  /** 創意拼圖用：目前要交給畫筆連續生成的符號。 */
  selected?: string | null;
  /** 在手指放下、click 觸發以前先把這一顆的精確外框算進快取。 */
  onPrepare?: (s: string) => void;
}> = ({ onBack, onPick, onPrepare, selected = null }) => {
  /* 全部選項一次建立，使用者第一次滑到底時不會再遇到分批載入或空按鈕。
     不在背景逐顆掃 alpha；那會與 iPhone 的捲動、拖曳競爭主執行緒。 */
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onPrepareRef = useRef(onPrepare);
  onPrepareRef.current = onPrepare;
  /* Mobile Safari 會先用 fallback 字體畫第一幀，再於正式字體完成後整片換字。
     按鈕尺寸照常立即建立，但字形只在預熱完成後一次顯示，避免看見錯誤字身
     跳到正確位置。通常模組載入時的預熱早已完成，所以不會增加進頁延遲。 */
  const [symbolFaceReady, setSymbolFaceReady] = useState(symbolFontDidSettle);
  useLayoutEffect(() => {
    if (symbolFontDidSettle) { setSymbolFaceReady(true); return; }
    let alive = true;
    symbolFontReady.then(() => { if (alive) setSymbolFaceReady(true); });
    return () => { alive = false; };
  }, []);
  const symbolButtons = useMemo(() => SYMBOLS.map((symbol, index) => (
    <button
      key={index}
      onPointerDown={() => onPrepareRef.current?.(symbol)}
      onClick={() => { onPickRef.current(symbol); }}
      aria-label={symbol}
      aria-pressed={selected === symbol}
      className={`min-h-11 px-3 py-1 max-w-full overflow-visible rounded-[10px] bg-white/5 border ${selected === symbol ? 'border-white' : 'border-white/10 hover:border-white/30'} hover:bg-white/10 active:scale-[0.98] transition-[border-color,background-color,transform] inline-flex items-center justify-center text-white/85`}
    >
      <span style={{ opacity: symbolFaceReady ? 1 : 0 }}>
        <SymbolGlyph text={symbol} />
      </span>
    </button>
  )), [selected, symbolFaceReady]);

  return (
    <div className="pt-1">
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onBack}
          aria-label="返回"
          title="返回"
          className="shrink-0 w-9 h-9 -ml-2 flex items-center justify-center text-white/60 hover:text-white active:scale-90 transition-[color,transform]"
        >
          <Icon name="arrow_back" className="text-[20px]" />
        </button>
        <span className="text-[10px] font-bold text-[#888] uppercase tracking-widest">新增符號</span>
      </div>
      {/* 一次渲染完整清單，避免往下滑到一半才等待下一批。 */}
      <div className="flex flex-wrap gap-1.5 pb-4">
        {symbolButtons}
      </div>
    </div>
  );
};

/**
 * 空格提示必须属于它所在的布局图层。
 *
 * 提示直接留在布局 wrapper 内，因此会和格子一起参与 59/60/61… 的交错层级：
 * 在它上面的照片、文字、图形或符号会自然盖住它，不再由 document.body 上的
 * 全画面 Portal 无条件压在最前面。
 *
 * 加号与文字仍以萤幕像素为基准：外层预览缩放时，用反向倍率抵销；当格子本身
 * 小于提示的自然尺寸时再等比缩小。更新只写合成 transform，不重新排版字体。
 */
const LayoutEmptyPromptLayer: React.FC<{
  cells: { x: number; y: number; w: number; h: number }[];
  hidden?: boolean;
}> = ({ cells, hidden = false }) => {
  const layerRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const layer = layerRef.current;
    const scaledColumn = layer?.closest('[data-grid-pages-column]') as HTMLElement | null;
    if (!layer || !scaledColumn) return;

    const columnWidth = scaledColumn.offsetWidth;
    const screenWidth = scaledColumn.getBoundingClientRect().width;
    const previewScale = columnWidth > 0 ? screenWidth / columnWidth : 1;
    const k = Math.max(0.0001, previewScale);
    const points = layer.querySelectorAll<HTMLElement>('[data-layout-empty-prompt-anchor]');

    points.forEach(point => {
      const prompt = point.querySelector<HTMLElement>('[data-layout-empty-prompt]');
      if (!prompt) return;
      const cellScreenW = point.offsetWidth * k;
      const cellScreenH = point.offsetHeight * k;
      const fit = Math.max(0.18, Math.min(1, cellScreenW / 92, cellScreenH / 60));
      const ui = fit / k;

      /* 不再把一份 9px 字与 16px SVG 先点阵化、再用 transform 放大抵销
         预览缩放；那会让 WebKit 沿用低解析度合成贴图，预览越小越模糊。
         直接把 DOM 的实际字号与 SVG 版面建立在需要的解析度，再由外层预览
         缩回萤幕尺寸。最终视觉大小相同，但每一帧都从向量／字体轮廓栅格化。 */
      prompt.style.width = `${76 * ui}px`;
      prompt.style.height = `${44 * ui}px`;
      prompt.style.transform = 'translate3d(-50%, -50%, 0)';
      const plus = prompt.querySelector<SVGElement>('[data-layout-empty-plus]');
      if (plus) {
        plus.style.width = `${16 * ui}px`;
        plus.style.height = `${16 * ui}px`;
        plus.style.top = `${3 * ui}px`;
      }
      const label = prompt.querySelector<HTMLElement>('[data-layout-empty-label]');
      if (label) {
        label.style.top = `${28.5 * ui}px`;
        label.style.fontSize = `${9 * ui}px`;
        label.style.letterSpacing = `${1.2 * ui}px`;
      }
    });
  }, []);

  useLayoutEffect(() => {
    if (hidden) return;
    const layer = layerRef.current;
    const scaledColumn = layer?.closest('[data-grid-pages-column]') as HTMLElement | null;
    if (!layer || !scaledColumn) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; place(); });
    };
    place();
    scaledColumn.addEventListener('abai-preview-transform', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scaledColumn.removeEventListener('abai-preview-transform', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [cells, hidden, place]);

  return (
    <div
      ref={layerRef}
      data-layout-empty-prompts="1"
      aria-hidden
      className="absolute inset-0 pointer-events-none z-[6]"
      style={{ visibility: hidden ? 'hidden' : 'visible' }}
    >
      {cells.map((cell, idx) => (
        <i
          key={idx}
          data-layout-empty-prompt-anchor="1"
          className="absolute block pointer-events-none"
          style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h }}
        >
          <span
            data-layout-empty-prompt="1"
            className="absolute left-1/2 top-1/2 block text-white/20 not-italic"
            style={{ transformOrigin: 'center center', textRendering: 'geometricPrecision' }}
          >
            <svg
              data-layout-empty-plus="1"
              width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden
              className="absolute left-1/2 -translate-x-1/2"
              shapeRendering="geometricPrecision"
            >
              <path d="M1 8H15M8 1V15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span
              data-layout-empty-label="1"
              className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-bold leading-none"
              style={{ fontFamily: fontStack(DEFAULT_FONT), textRendering: 'geometricPrecision' }}
            >
              選擇相片
            </span>
          </span>
        </i>
      ))}
    </div>
  );
};

/**
 * 兩段式的顏色欄：平常只是一列（標題＋色號＋一小塊顏色），
 * 點一下才把色票攤開來 —— 這樣它可以跟滑桿並排，不會把版面撐開。
 * 兩個拼圖工具的描邊／發光／點點顏色都用這一顆，長相與操作完全一致。
 */
export const ColorPick: React.FC<{
  label: string;
  value: string;
  colors?: string[];
  onPick: (c: string) => void;
  /** 有給就不再原地攤開色票，改成叫呼叫端切到獨立的顏色頁 */
  onOpen?: () => void;
  /** 只留最右邊那一顆色塊：不畫外框、不寫「顏色」、也不寫色號。
      跟滑桿並排時就是這一種 —— 左邊那個標題（發光／描邊）已經說明了它是誰的顏色，
      色號沒有人會去讀，而那張卡片本來吃掉了一半的寬度，滑桿只剩一半可以拖。 */
  compact?: boolean;
}> = ({ label, value, colors, onPick, onOpen, compact }) => {
  const [open, setOpen] = useState(false);
  if (compact) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => (onOpen ? onOpen() : setOpen(o => !o))}
        /* 垂直位置交給外層那一列的 items-center：色塊會自己對齊
           「標題那一行 ＋ 軌道」整塊的垂直中心，不必寫死任何位移，
           標題換行或滑桿高度改了也不會跑掉。 */
        className="shrink-0 w-8 h-6 rounded-[4px] border border-white/10 shadow-inner hover:border-white/40 transition-colors"
        style={{ backgroundColor: value }}
      />
    );
  }
  return (
    <div className="space-y-1.5">
      <div
        className="h-[38px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[8px] cursor-pointer hover:bg-[#151515] transition-colors"
        onClick={() => (onOpen ? onOpen() : setOpen(o => !o))}
      >
        <span className="text-[10px] font-bold text-[#888] shrink-0">{label}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-mono text-white/40">{(value || '').toUpperCase()}</span>
          <div className="w-5 h-4 rounded-[4px] shadow-inner border border-white/10" style={{ backgroundColor: value }} />
        </div>
      </div>
      {open && !onOpen && (
        <div className="animate-in fade-in duration-150">
          {swatchStrip(value, colors || SOFT_COLORS, c => onPick(c), true)}
        </div>
      )}
    </div>
  );
};

export const TextEditorPanel: React.FC<{
  layer: FloatingImage;
  onChange: (patch: Partial<FloatingImage>) => void;
  /** 有給的話，描邊／發光的顏色就改成「點一下開調色盤」那種一列（跟連線顏色一樣） */
  onPickColor?: (which: 'stroke' | 'glow') => void;
  /** 這一層是「符號」：可以調的東西比一般文字少，只留顏色、大小、發光 */
  symbol?: boolean;
  /** 滑桿正在連續拖動；經典拼圖用它暫停昂貴的最終快照編碼。 */
  onTuningChange?: (active: boolean) => void;
}> = ({ layer, onChange, onPickColor, symbol, onTuningChange }) => {
  const [sub, setSub] = useState<'style' | 'font'>('style');
  /* 顏色改成「點進去有一頁」：這裡存的是那一頁要調哪個顏色。 */
  const [colorPage, setColorPage] = useState<
    { value: string; colors?: string[]; onPick: (c: string) => void } | null
  >(null);
  const [cat, setCat] = useState<FontCategory>('zh');

  const list = FONTS.filter(f => f.category === cat);

  /* 這個字體有沒有真正的斜體？沒有的話就不給斜體鈕（瀏覽器會自己歪一個
     假斜體出來，那個不好看也不是這個字體本來的樣子）。答案問到之前先當成
     沒有，才不會閃一下又消失。換字體時如果新的字體沒有斜體，順手把已經
     打開的斜體關掉，不然會留下一個看不到開關的假斜體。 */
  const family = layer.fontFamily || DEFAULT_FONT;
  const [hasItalic, setHasItalic] = useState(() => knownItalic(family) === true);
  useEffect(() => {
    let alive = true;
    setHasItalic(knownItalic(family) === true);
    ensureItalic(family).then(ok => {
      if (!alive) return;
      setHasItalic(ok);
      if (!ok && layer.italic) onChange({ italic: false });
    });
    return () => { alive = false; };
  }, [family]);

  /** 可以點開調色盤的那一列（樣式跟創意拼圖的「連線顏色」逐項相同） */
  const colorRow = (label: string, value: string, onOpen: () => void) => (
    <div
      className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px] cursor-pointer hover:bg-[#151515] transition-colors"
      onClick={onOpen}
    >
      <span className="text-[10px] font-bold text-[#888]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-white/40">{value}</span>
        <div className="w-6 h-5 rounded-[4px] shadow-inner border border-white/10" style={{ backgroundColor: value }} />
      </div>
    </div>
  );

  const swatchRow = (value: string | undefined, onPick: (c: string) => void, colors = TEXT_COLORS) => (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-0.5 py-0.5">
      {/* 第一顆固定是自訂顏色 */}
      <CustomColorButton value={value || '#FFFFFF'} onPick={onPick} />
      {colors.map(c => (
        <button
          key={c}
          onClick={() => onPick(c)}
          title={c}
          className={`shrink-0 w-8 h-8 rounded-[7px] transition-all active:scale-90 ${
            (value || '').toUpperCase() === c ? 'border-2 border-white' : 'border border-white/20'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );

  /* step 可以是小數：給邊緣發光那種「格數要多、拖起來才不會一格一格跳」的滑桿用。
     小數的時候要用 parseFloat（parseInt 會把 0.1 讀成 0），顯示也要跟著補到
     對應的小數位，不然 2.5 會顯示成 2.5000000000000004。 */
  const slider = (
    label: string, value: number, min: number, max: number,
    onVal: (v: number) => void, suffix = '', step = 1,
  ) => {
    const digits = step < 1 ? String(step).split('.')[1].length : 0;
    return (
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-bold text-white/70">{label}</span>
          <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded text-white">{value.toFixed(digits)}{suffix}</span>
        </div>
        <div className="slider-wrap" style={{ height: 16 }}>
          <SmoothRange
            min={min} max={max} step={step} value={value}
            onValue={v => onVal(digits ? v : Math.round(v))}
            className="premium-slider w-full"
          />
        </div>
      </div>
    );
  };

  return (
    <div
      className="max-w-md mx-auto h-full flex flex-row animate-in fade-in duration-300"
      onPointerDownCapture={e => {
        if ((e.target as HTMLElement).matches?.('input[type="range"]')) onTuningChange?.(true);
      }}
      onPointerUpCapture={() => onTuningChange?.(false)}
      onPointerCancelCapture={() => onTuningChange?.(false)}
    >
      {/* 左側細長分頁列，跟「新增佈局」同一種版型：只有圖示、
          沒有中間那條分隔線，選中也不畫指示條。
          符號沒有「換字體」這件事（字體換了那些符號也還是靠系統字型畫的），
          所以符號模式整條分頁列都不出現，只留樣式那一頁。 */}
      {!symbol && <div className="flex flex-col shrink-0 w-11 -mt-4 -mb-4 -ml-4 border-r border-white/10 select-none">
        {/* 跟「新增佈局」完全同款：上面挑內容（字體）、下面調參數（樣式），
            圖標同一組、中間同一條分隔線 */}
        <button
          onClick={() => setSub('font')}
          title="字體"
          aria-label="字體"
          className={`w-full flex-1 flex items-center justify-center transition-all ${sub === 'font' ? 'text-white' : 'text-[#5a5a5a]'}`}
        >
          <Type size={18} className={`transition-transform ${sub === 'font' ? 'scale-110' : ''}`} />
        </button>
        <div className="w-full h-[1px] bg-white/10 shrink-0" />
        <button
          onClick={() => setSub('style')}
          title="樣式"
          aria-label="樣式"
          className={`w-full flex-1 flex items-center justify-center transition-all ${sub === 'style' ? 'text-