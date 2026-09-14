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

import { pushHistory as pushHistoryEntry } from '../utils/history';

const ReplayIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8.25 6.75H4.2V2.7 M4.45 6.55A8 8 0 1 1 4 14" />
  </svg>
);

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
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  return (
    <div className={`flex flex-col ${disabled ? 'opacity-45' : ''}`}>
      <div className="flex justify-between text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
        <span>{label}</span>
        <span className="text-white font-sans tabular-nums">
          {decimals > 0
            ? (fixedDecimals ? Number(value).toFixed(decimals) : Number(value).toFixed(decimals).replace(/\.?0+$/, '') || '0')
            : Math.round(value)}
        </span>
      </div>
      <div className="slider-wrap" style={{ height: 16 }}>
        <input
          type="range" min={min} max={max} step={step} value={value}
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
export const symbolFontReady: Promise<void> = typeof document === 'undefined'
  ? Promise.resolve()
  : ensureFont(SYMBOL_FONT)
      .then(async () => {
        try {
          await document.fonts?.load(`400 32px "${SYMBOL_FONT}"`, SYMBOLS.join(''));
          await document.fonts?.ready;
        } catch { /* 離線時穩定使用系統 fallback */ }
        clearSymbolInkCache();
        classicSymbolPlacementCache.clear();
      })
      .catch(() => {});
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
    case 'star': {
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
) => {
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
  const isLine = item.kind === 'line';
  const isGridGlyph = GRID_SHAPE_KINDS.has(item.kind);
  /* viewBox 與圖案的框一樣大 —— 每一顆圖案的長邊都剛好等於 size（預設 20px），
     所以不管哪一種形狀，看起來都一樣大。 */
  const VB = 24;
  const BOX = VB;
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
  const symbolButtons = useMemo(() => SYMBOLS.map((symbol, index) => (
    <button
      key={index}
      onPointerDown={() => onPrepareRef.current?.(symbol)}
      onClick={() => { onPickRef.current(symbol); }}
      aria-label={symbol}
      aria-pressed={selected === symbol}
      className={`min-h-11 px-3 py-1 max-w-full overflow-visible rounded-[10px] bg-white/5 border ${selected === symbol ? 'border-white' : 'border-white/10 hover:border-white/30'} hover:bg-white/10 active:scale-[0.98] transition-[border-color,background-color,transform] inline-flex items-center justify-center text-white/85`}
    >
      <SymbolGlyph text={symbol} />
    </button>
  )), [selected]);

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
}> = ({ layer, onChange, onPickColor, symbol }) => {
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
          <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={e => onVal(digits ? parseFloat(e.target.value) : parseInt(e.target.value))}
            className="premium-slider w-full"
          />
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-md mx-auto h-full flex flex-row animate-in fade-in duration-300">
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
          className={`w-full flex-1 flex items-center justify-center transition-all ${sub === 'style' ? 'text-white' : 'text-[#5a5a5a]'}`}
        >
          <Sliders size={18} className={`transition-transform ${sub === 'style' ? 'scale-110' : ''}`} />
        </button>
      </div>}

      <div className={`flex-1 no-scrollbar h-full overflow-y-auto overflow-x-hidden pr-2 ${symbol ? 'pl-2' : 'pl-3'}`}>
        {colorPage && (
          <ColorPickerPage
            value={colorPage.value}
            colors={colorPage.colors}
            onPick={colorPage.onPick}
            onBack={() => setColorPage(null)}
          />
        )}
        {!colorPage && sub === 'font' && !symbol && (
          <div className="space-y-2.5 pt-1 pb-1">
            <div className="flex items-center gap-1 bg-white/[0.06] rounded-full p-0.5">
              {FONT_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className={`flex-1 h-7 rounded-full text-[11px] font-bold tracking-widest transition-all ${
                    cat === c.id ? 'bg-white text-black' : 'text-white/60'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {list.map(f => (
                <FontCard
                  key={f.name + f.category}
                  font={f}
                  active={(layer.fontFamily || DEFAULT_FONT) === f.name}
                  onPick={() => onChange({ fontFamily: f.name })}
                />
              ))}
            </div>
          </div>
        )}

        {!colorPage && (sub === 'style' || symbol) && (
          /* 底部留一段：捲到底時最後一根滑桿不要貼著邊（原本 pb-24，減半） */
          <div className="space-y-3.5 pt-1 pb-12">
            {/* 文字內容一律直接在畫布上打（選中之後再點一次那段字），
                所以這裡不放輸入框。符號也是一樣的改法。 */}
            {/* 最上面就是這個物件自己的顏色，色票直接攤開 ——
                上面不再放「顏色」那行標題（它就在最頂端，不用再標一次）。 */}
            {swatchRow(layer.color, c => onChange({ color: c }))}

            {symbol ? (
              /* 符號到這裡就結束了：粗體／斜體／字距／描邊對符號沒有意義
                 （那些是靠系統字型畫出來的，加粗、加斜、拆字距都只會歪掉），
                 所以只留一根發光跟發光顏色。 */
              <>
                {/* 滑桿與顏色並排；顏色是兩段式的（點一下才攤開色票），
                    所以不會有「拉到 1 的瞬間欄位冒出來閃一下」。 */}
                <div className="flex items-center gap-3 px-2">
                  <div className="flex-1 min-w-0">
                    {slider('發光', Math.round(Math.min(100, ((layer.glow || 0) / 12) * 100)), 0, 100,
                      v => onChange({ glow: (v / 100) * 12 }), '', 1)}
                  </div>
                  <ColorPick compact label="顏色" value={layer.glowColor || '#FFFFFF'} colors={GLOW_COLORS}
                    onPick={c => onChange({ glowColor: c })}
                    onOpen={() => onPickColor ? onPickColor('glow') : setColorPage({
                      value: layer.glowColor || '#FFFFFF', colors: GLOW_COLORS,
                      onPick: c => onChange({ glowColor: c }),
                    })} />
                </div>
              </>
            ) : (
            <>
            {/* 粗體與斜體同一排。這個字體沒有真斜體時只留粗體，
                粗體就自己撐滿整排 —— 跟沒有斜體鈕之前長得一樣。
                但**現在這段字已經是斜體**的話一定要把鈕留著，
                不然換到沒有真斜體的字體時，那個斜體就變成關不掉的了。 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onChange({ bold: !layer.bold })}
                className={`flex-1 h-9 rounded-xl border flex items-center justify-center gap-2 text-[12px] font-bold tracking-widest transition-all ${
                  layer.bold ? 'bg-white text-black border-white' : 'bg-white/[0.04] text-white/70 border-white/15'
                }`}
              >
                <Bold size={14} />粗體
              </button>
              {(hasItalic || layer.italic) && (
                <button
                  onClick={() => onChange({ italic: !layer.italic })}
                  className={`flex-1 h-9 rounded-xl border flex items-center justify-center gap-2 text-[12px] font-bold tracking-widest transition-all ${
                    layer.italic ? 'bg-white text-black border-white' : 'bg-white/[0.04] text-white/70 border-white/15'
                  }`}
                >
                  <Italic size={14} />斜體
                </button>
              )}
            </div>
            {/* 字級與字距同一排（粗體／斜體排在它們上面）。
                符號沒有這兩根 —— 它的大小直接在畫布上捏。 */}
            {/* 字級的滑桿拿掉了：大小直接在畫布上捏，這裡只留字距 */}
            <div className="grid grid-cols-1 gap-3">
              {slider('字距', layer.letterSpacing || 0, -10, 40, v => onChange({ letterSpacing: v }), 'px')}
            </div>
            {/* 描邊、發光各自跟自己的顏色並排（顏色是兩段式的，點一下才攤開色票）。
                描邊 0～2px，一樣分 50 格（每格 0.04px）：最小那一格只有 0.04px，
                從 0 拉出來時是慢慢浮現，不會一下就跳出一圈明顯的邊。
                顏色欄一直都在，所以不會有「從 0 拉到 1 的瞬間欄位冒出來閃一下」。 */}
            <div className="flex items-center gap-3 px-2">
              <div className="flex-1 min-w-0">
                {slider('描邊', layer.strokeWidth || 0, 0, 2, v => onChange({ strokeWidth: v }), 'px', 0.04)}
              </div>
              <ColorPick compact label="顏色" value={layer.strokeColor || '#000000'}
                onPick={c => onChange({ strokeColor: c })}
                onOpen={() => onPickColor ? onPickColor('stroke') : setColorPage({
                  value: layer.strokeColor || '#000000',
                  onPick: c => onChange({ strokeColor: c }),
                })} />
            </div>
            <div className="flex items-center gap-3 px-2">
              <div className="flex-1 min-w-0">
                {slider('發光', Math.round(Math.min(100, ((layer.glow || 0) / 12) * 100)), 0, 100,
                      v => onChange({ glow: (v / 100) * 12 }), '', 1)}
              </div>
              <ColorPick compact label="顏色" value={layer.glowColor || '#FFFFFF'} colors={GLOW_COLORS}
                onPick={c => onChange({ glowColor: c })}
                onOpen={() => onPickColor ? onPickColor('glow') : setColorPage({
                  value: layer.glowColor || '#FFFFFF', colors: GLOW_COLORS,
                  onPick: c => onChange({ glowColor: c }),
                })} />
            </div>
            </>
            )}


          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 圖形圖層的參數面板（顏色／粗細／虛線）。
 *
 * 顏色用的是 swatchStrip ＋ SOFT_COLORS —— 跟「文字顏色」「描邊顏色」
 * 同一個元件、同一組色，不是另外設計一套。
 * 實心的圖形沒有框，所以粗細與虛線只在細框／線條的時候才出現。
 */
export const ShapeEditorPanel: React.FC<{
  layer: FloatingImage;
  onChange: (patch: Partial<FloatingImage>) => void;
}> = ({ layer, onChange }) => {
  const isLine = SPECIAL_LINE_KINDS.has(layer.shape || '');
  const isGridShape = GRID_SHAPE_KINDS.has(layer.shape || '');
  const hasOutline = (!layer.shapeFilled || isLine) && !isGridShape;
  const canFeather = shapeSupportsFeather(layer.shape, layer.shapeFilled, layer.holeType);
  /* 顏色改成「點進去有一頁」（跟文字那一頁同一顆元件） */
  const [colorPage, setColorPage] = useState<
    { value: string; colors?: string[]; onPick: (c: string) => void } | null
  >(null);

  const slider = (label: string, value: number, min: number, max: number, onVal: (v: number) => void) => (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[11px] font-bold text-white/70">{label}</span>
        <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded text-white">{value}</span>
      </div>
      <div className="slider-wrap" style={{ height: 16 }}>
        <input
          type="range" min={min} max={max} step={1} value={value}
          onChange={e => onVal(parseInt(e.target.value))}
          className="premium-slider w-full"
        />
      </div>
    </div>
  );

  return (
    <div className="max-w-md mx-auto h-full animate-in fade-in duration-300">
      <div className="h-full overflow-y-auto overflow-x-hidden no-scrollbar px-2">
        {colorPage && (
          <ColorPickerPage
            value={colorPage.value}
            colors={colorPage.colors}
            onPick={colorPage.onPick}
            onBack={() => setColorPage(null)}
          />
        )}
        {!colorPage && (
        /* 底部留一段：捲到最底時最後一根滑桿不會貼著邊 */
        <div className="flex flex-col gap-3.5 pt-1 pb-14">
          {/* 最上面就是圖形自己的顏色，色票直接攤開（不再放「顏色」標題）。
              換圖形顏色時發光也一起換成同一個色 —— 發光本來就是圖形自己的光暈。
              反過來不成立：單獨挑發光的顏色時，圖形的顏色不會被動到。 */}
          {swatchStrip(layer.color, SOFT_COLORS, c => onChange({ color: c, shapeGlowColor: c }), true)}
          {isLine && (
            <div className="px-2">
              {slider('粗細', Math.round((layer.shapeLineW ?? 6) * 10), 1, 100,
                v => onChange({ shapeLineW: v / 10 }))}
            </div>
          )}
          {/* 發光、描邊各自跟自己的顏色並排；顏色是兩段式的（點一下才攤開色票） */}
          <div className="flex items-center gap-3 px-2 order-1 w-full">
            <div className="flex-1 min-w-0">
              {slider('發光', Math.round(glowAmount(layer.shapeGlow as any) * 100), 0, 100,
                v => onChange({ shapeGlow: v } as any))}
            </div>
            <ColorPick compact label="顏色" value={layer.shapeGlowColor || layer.color || SHAPE_DEFAULT_COLOR}
              colors={GLOW_COLORS} onPick={c => onChange({ shapeGlowColor: c })}
              onOpen={() => setColorPage({
                value: layer.shapeGlowColor || layer.color || SHAPE_DEFAULT_COLOR, colors: GLOW_COLORS,
                onPick: c => onChange({ shapeGlowColor: c }),
              })} />
          </div>
          <div className="flex items-center gap-3 px-2 order-2 w-full">
            <div className="flex-1 min-w-0">
              {slider('描邊', Math.round(Math.min(4, layer.shapeStrokeW ?? 0) * 25), 0, 100,
                v => onChange({ shapeStrokeW: v / 25 }))}
            </div>
            <ColorPick compact label="顏色" value={layer.shapeStrokeColor || '#000000'}
              onPick={c => onChange({ shapeStrokeColor: c })}
              onOpen={() => setColorPage({
                value: layer.shapeStrokeColor || '#000000',
                onPick: c => onChange({ shapeStrokeColor: c }),
              })} />
          </div>
          {/* 紋理整組收在同一格：種類、顏色、滑桿全部在同一個框裡
              （跟「背景紋理」那一格同一種排法）。顏色常駐，關著也能先挑好。
              點點是一個顏色＋大小／間距；條紋是兩個顏色＋粗細／方向。 */}
          {!isLine && (() => {
            const tex = texOf({ tex: layer.shapeTex, dots: layer.shapeDots });
            return (
          <div className="bg-[#111] border border-[#222] rounded-[6px] overflow-hidden order-3 w-full">
            <div className="h-[47px] flex items-center justify-between px-3">
              <span className="text-[10px] font-bold text-[#888]">紋理</span>
              <div className="flex items-center gap-2">
                <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                  {TEX_OPTIONS.map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => onChange({ shapeTex: id, shapeDots: id === 'dot' })}
                      className={`px-2 h-6 text-[10px] font-bold rounded-[2px] transition-all ${
                        tex === id ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* 條紋有兩個顏色，所以放兩塊色票；點點只有一塊 */}
                {tex === 'stripe' ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setColorPage({
                        value: layer.shapeStripeA || layer.color || SHAPE_DEFAULT_COLOR, colors: TEX_SWATCHES,
                        onPick: c => onChange({ shapeStripeA: c }),
                      })}
                      title="條紋顏色一"
                      className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                      style={{ backgroundColor: layer.shapeStripeA || layer.color || SHAPE_DEFAULT_COLOR }}
                    />
                    <button
                      onClick={() => setColorPage({
                        value: layer.shapeStripeB || '#FFFFFF', colors: TEX_SWATCHES,
                        onPick: c => onChange({ shapeStripeB: c }),
                      })}
                      title="條紋顏色二"
                      className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                      style={{ backgroundColor: layer.shapeStripeB || '#FFFFFF' }}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setColorPage({
                      value: layer.shapeDotColor || '#FFFFFF', colors: TEX_SWATCHES,
                      onPick: c => onChange({ shapeDotColor: c }),
                    })}
                    title="紋理顏色"
                    className="w-8 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                    style={{ backgroundColor: layer.shapeDotColor || '#FFFFFF' }}
                  />
                )}
              </div>
            </div>
            {tex === 'stripe' ? (
              /* 條紋沒有間距可以調（一條接著一條），只有條數。
                 右邊那一格放直式／橫式，跟滑桿並排。
                 左右各留 8px：滑桿本人比外框寬 14px（見 styles.css 的 .slider-wrap），
                 不留的話畫出來的線會比自己那一欄長、伸進隔壁的間隙。 */
              <div className="grid grid-cols-2 gap-x-7 gap-y-4 px-3 pt-2 pb-3 border-t border-[#1c1c1c] items-end">
                <div className="px-2">
                  {slider('數量', layer.shapeStripeN ?? STRIPE_N_DEFAULT, 0, STRIPE_N_MAX, v => onChange({ shapeStripeN: v }))}
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-white/70">方向</span>
                  <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                    {STRIPE_DIRS.map(([d, label]) => (
                      <button
                        key={d}
                        onClick={() => onChange({ shapeStripeDir: d })}
                        className={`flex-1 h-6 text-[10px] font-bold rounded-[2px] transition-all ${
                          (layer.shapeStripeDir === 'h' ? 'h' : 'v') === d ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-7 gap-y-4 px-3 pt-2 pb-3 border-t border-[#1c1c1c]">
                {slider('大小', layer.shapeDotSize ?? 50, 0, 100, v => onChange({ shapeDotSize: v }))}
                {slider('間距', layer.shapeDotGap ?? 20, 0, 100, v => onChange({ shapeDotGap: v }))}
              </div>
            )}
          </div>
            );
          })()}
          <div className="px-2 order-4 w-full">
            {slider('透明度', layer.opacity ?? 100, 0, 100, v => onChange({ opacity: v }))}
          </div>
          {canFeather && (
            <div className="px-2 order-5 w-full">
              {slider('羽化', layer.shapeFeather || 0, 0, 100, v => onChange({ shapeFeather: v }))}
            </div>
          )}
          {/* 粗細與虛線只有細框／線條才有，放在最後面 */}
          {hasOutline && (!isLine || layer.shape === 'line') && (
            <div className="order-6 flex flex-col gap-3.5">
              {!isLine && slider('粗細', Math.round((layer.shapeLineW ?? 6) * 10), 1, 100,
                v => onChange({ shapeLineW: v / 10 }))}
              {slider('虛線', layer.shapeDash || 0, 0, 100, v => onChange({ shapeDash: v }))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

/**
 * 圖片調整面板。
 *
 * 這一段原本寫死在 GridLayoutTool 裡面，創意拼圖要用同一套介面就只能複製一份，
 * 兩邊遲早會走鐘。所以整段原封不動搬出來變成共用元件 ——
 * **裡面一行邏輯都沒有改**，經典拼圖只是改成把原本的區域變數當 props 傳進來。
 *
 * 為什麼 props 這麼多：那些 UI 狀態（現在停在哪個子分頁、選了哪張特效卡…）
 * 本來就住在各自的工具裡，留在外面才不會影響經典拼圖現有的行為。
 */
export type ImageAdjustPanelProps = {
  img: any;
  set: (patch: any) => void;
  lutList: { id: string; name: string; url: string }[];
  loadingLut: string | null;
  setLoadingLut: (v: any) => void;
  lutRevision: number;
  setLutRevision: (v: any) => void;
  adjustSub: 'shape' | 'tune' | 'filter' | 'effect';
  setAdjustSub: (v: any) => void;
  effectCard: string | null;
  setEffectCard: (v: any) => void;
  effectDetail: boolean;
  setEffectDetail: (v: any) => void;
  shapeMenu: string;
  setShapeMenu: (v: any) => void;
  shapeTool: string;
  setShapeTool: (v: any) => void;
  tuneTool: string;
  setTuneTool: (v: any) => void;
  setTuningEdge: (v: any) => void;
  openComposeFor: (id: string) => void;
  /** 構圖介面正開著（圖標要亮起來） */
  composeOpen?: boolean;
  /** 在構圖介面時切到別的分類：先把當下的構圖套用掉再切 */
  onLeaveCompose?: () => void;
  /* 開著的時候：切到「調節」「形狀」不預先選好第一個工具 —— 滑桿要等
     真的點下某顆工具鈕才出現，而且是帶動畫出現的。經典拼圖不傳這個，
     維持原本「一切過去滑桿就在那」的手感。 */
  deferSlider?: boolean;
  /** 回報「這一格有沒有滑桿在上面那一段」——創意拼圖用它決定工具欄要不要長高 */
  onSliderOpenChange?: (open: boolean) => void;
  /** 佈局裡的格子沒有「形狀」那一組，傳 true 就把它藏起來 */
  hideShape?: boolean;
  /** 影片物件沒有「構圖」——構圖是把裁切的結果烤成一張圖，烤完就不是影片了 */
  hideCompose?: boolean;
  /** 滑桿排成一排：名稱、軌道、數值全部同一列，上面不再有一排字 */
  inlineSlider?: boolean;
};

export const ImageAdjustPanel: React.FC<ImageAdjustPanelProps> = ({
  img, set, lutList, loadingLut, setLoadingLut, lutRevision, setLutRevision,
  adjustSub, setAdjustSub, effectCard, setEffectCard, effectDetail, setEffectDetail,
  shapeMenu, setShapeMenu, shapeTool, setShapeTool, tuneTool, setTuneTool,
  setTuningEdge, openComposeFor, composeOpen, onLeaveCompose, hideShape, hideCompose, deferSlider, onSliderOpenChange, inlineSlider,
}) => {
const fx = img.fx || {};
const setFx = (patch: Partial<PhotoFx>) => set({ fx: { ...fx, ...patch } });
const fxVal = (key: string, dflt: number) => (fx as any)[key] ?? dflt;
/* 卡片牆的縮圖來源。
   影片不能直接用 img.src —— 卡片是把網址塞進 <img> 重畫的，
   而 <img src="blob:…mp4"> 永遠載不出來，整面卡片會是空的。
   匯入時已經烤了一張第一格（poster），拿它當來源，卡片就跟圖片長得一樣。
   （創意拼圖是在外面就把 src 換成 poster 了，所以那邊照樣走 img.src。） */
const cardSrc = (img.isVideo && img.poster) ? img.poster : img.src;

/* ── 兩段式的那幾顆（形狀／描邊／發光）按下去要立刻有反應 ──────────────
 *
 * 同一排裡，圓角與羽化點下去會變白 —— 因為它們只是把下面的滑桿換掉，
 * 按鈕本人還留在原位。形狀／描邊／發光是「兩段式」的：點下去整排會被
 * 子選單換掉，那顆按鈕根本來不及被畫成選中的樣子。
 *
 * 本來的做法是「先亮 150ms 再換頁」，但那 150ms 在手上就是「按了沒馬上進去」。
 * 改成換頁完全不延遲，回饋交給 CSS 的 :active —— 手指一碰按鈕就變白
 * （比 click 還早，因為 :active 在按下的當下就套用），放開時頁面已經換好了。
 * 兩件事同時成立：立刻進分頁，而且按下去看得到它亮。 */

/* 點特效卡片＝只留這一顆（其他整組歸零）；
   長按＝疊在現在這些上面，好幾個同時生效（再長按一次就關掉那一顆）。 */
const pickEffect = (id: string) => {
  if (FX_DETAIL[id]) warmFx(id);      // 先把著色器編好，第一次拖才不會卡
  setEffectCard(id);
  setEffectDetail(false);
  const amountId = fxAmountId(id);
  const on = fxVal(amountId, 0) !== 0;
  /* 打開一顆特效＝從頭來過：所有特效的參數**連細項一起**打回預設，
     再把這一顆的強度設成預設值 —— 跟編輯頁一模一樣
     （見 ImageEditor 的 handleEffectToolSelect）。
     已經亮著的那一顆再點一次只是要開細項面板，它自己那幾根維持現況。 */
  const patch: any = { ...FX_PARAM_DEFAULTS };
  if (on) for (const k of (FX_CARD_KEYS[id] || [amountId])) delete patch[k];
  else patch[amountId] = FX_ON_AMOUNT[id] ?? 100;
  setFx(patch);
};

/* 長按 450ms＝疊加，並把接著那一次 click 吃掉 */

/* 佈局裡的格子沒有「形狀」——羽化／發光／描邊都會長到格子外面，
   而格子是被裁切的，畫出來會被切掉；圓角則已經有佈局那根共用滑桿。 */
const CATS = ([
  ['filter', 'palette', '濾鏡'],
  ['tune', 'tune', '調節'],
  ['effect', 'magic_button', '特效'],
  ['shape', 'shapes', '造型'],
  // 構圖圖標跟「編輯」那邊用同一顆（crop）
  ['compose', 'crop', '構圖'],
] as const).filter(c => !(hideShape && c[0] === 'shape') && !(hideCompose && c[0] === 'compose'));

// 編輯同款的圓形工具鈕
/* icon 傳字串＝用圖示字型那一顆；傳一個元素＝直接畫那個元素。
   形狀那幾顆走後者：圖示字型是**子集化過的**（只包含專案已經用到的那些），
   隨手加一個新名字它並不在字型裡，畫面上就會直接顯示成那串英文字。
   形狀本來就有現成的向量路徑，畫出來還比圖示更清楚。 */
const toolBtn = (id: string, label: string, icon: string | React.ReactNode, active: boolean, adjusted: boolean, onClick: () => void) => (
  <button key={id} onClick={onClick} className="flex flex-col items-center gap-1 shrink-0 group w-16">
    {/* 按下去的回饋：只是稍微放大一點點，別的都不動。
        以前是「放大到跟選中一樣大（1.10）＋ 150ms 的 transition-all」——
        那一圈是 40px，1.10 等於上下各長 2px，而且是慢慢脹上去的；
        下面又緊接著文字，往下長的那 2px 被文字擋著、往上那 2px 是空的，
        看起來就變成「圖標往上跑了一下」。
        現在只長 1.05（上下各 1px）、而且 90ms 就到位，
        是「按到了」的一下，不是一段會被眼睛追著看的位移。
        底色與顏色維持原本的 150ms，跟大小分開跑，才不會又混在一起。 */}
    <div
      style={{
        transitionProperty: 'transform, background-color, color',
        transitionDuration: '90ms, 150ms, 150ms',
        transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
      }}
      className={`w-10 h-10 rounded-full flex items-center justify-center ${active ? 'bg-white text-black scale-110' : 'bg-white/5 text-white group-hover:bg-white/10 group-active:scale-105'}`}
    >
      {/* 未選中時讓整顆圖標一次合成後再降低透明度；若 SVG 內有線條交會，
          不會因每段半透明描邊重複混色而在交界處變白。 */}
      <span className={`flex items-center justify-center transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'}`}>
        {typeof icon === 'string' ? <Icon name={icon} className="text-lg" fill={active} /> : icon}
      </span>
    </div>
    <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${active ? 'text-white' : 'text-white/20'}`}>{label}</span>
    <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${adjusted ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
  </button>
);

// 編輯同款的滑桿（label 在左、數字在右、track 一樣是 custom-range）
// 上面那一行（名稱＋數值）往下挪一點，不要貼著上面的細線。
// hideChrome：拖這根滑桿的期間把圖片的選取框整組收起來（形狀分頁用）
const editorSlider = (
  label: string, value: number, min: number, max: number,
  onVal: (v: number) => void,
  swatches?: React.ReactNode,
  hideChrome = false,
  /* 一格多大。預設 1；羽化這種「低段位差一點就差很多」的用 0.5 才調得準。 */
  step = 1,
) => {
  const input = (cls: string) => (
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={e => onVal(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
      onPointerDown={hideChrome ? () => setTuningEdge(true) : undefined}
      onPointerUp={hideChrome ? () => setTuningEdge(false) : undefined}
      onPointerCancel={hideChrome ? () => setTuningEdge(false) : undefined}
      onLostPointerCapture={hideChrome ? () => setTuningEdge(false) : undefined}
      className={cls}
    />
  );
  /* 排成一排：名稱在左、軌道在中間、數值在右，上面那一排字整個拿掉。
     軌道用 dense 那一版 —— 原本那版刻意往左右各溢出 32px（讓圓點可以滑到
     邊緣外），排成一排時會壓到兩邊的字。 */
  if (inlineSlider) return (
    <div className="w-full flex items-center gap-3">
      <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] pointer-events-none shrink-0">{label}</span>
      {swatches}
      <div className="relative flex-1 min-w-0 h-11 flex items-center touch-none">
        {input('custom-range dense')}
      </div>
      <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded shrink-0 text-center min-w-[2.6rem]">{step < 1 ? value.toFixed(1) : value}</span>
    </div>
  );
  return (
    <div className="w-full pt-1.5">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] pointer-events-none shrink-0">{label}</span>
        {swatches}
        <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded shrink-0">{value}</span>
      </div>
      <div className="relative h-11 flex items-center justify-center touch-none">
        {input('custom-range')}
      </div>
    </div>
  );
};


/* 特效細項的排法跟「編輯」一致：剛好兩根上下各一行；
   奇數根時「強度」自己站一行，其餘兩兩一排。 */
const fxDetailOpen = adjustSub === 'effect' && effectDetail && !!effectCard;
const fxRows = (() => {
  const tools = (FX_DETAIL[effectCard] || (FX_SUB_TOOLS[effectCard] || []).map(
    ([k, l, , mn, mx, d]) => [k, l, mn, mx, d] as [string, string, number, number, number]));
  if (!tools.length) return [] as [string, string, number, number, number][][];
  if (tools.length === 2) return [[tools[0]], [tools[1]]];
  const out: [string, string, number, number, number][][] = [];
  const solo = tools.length % 2 === 1;
  if (solo) out.push([tools[0]]);
  const rest = tools.slice(solo ? 1 : 0);
  for (let i = 0; i < rest.length; i += 2) out.push(rest.slice(i, i + 2));
  return out;
})();
const fxRowH = fxRows.length ? Math.min(52, Math.floor(172 / fxRows.length)) : 52;

// 目前這一段要放什麼
const sliderArea = (() => {
  if (adjustSub === 'filter') {
    if (!fx.lut || fx.lut === 'none') return null;
    return editorSlider('強度', fx.lutAmount ?? 100, 0, 100, v => setFx({ lutAmount: v }));
  }
  if (adjustSub === 'tune') {
    const t = TUNE_TOOLS.find(x => x[0] === tuneTool) || (deferSlider ? null : TUNE_TOOLS[0]);
    if (!t) return null;
    const isOpacity = t[0] === 'opacity';
    return editorSlider(
      '', isOpacity ? (img.opacity ?? 100) : fxVal(t[0], t[5]), t[3], t[4],
      v => isOpacity ? set({ opacity: v }) : setFx({ [t[0]]: v }),
    );
  }
  if (adjustSub === 'effect') {
    // 細項是另外一整區（並排滑桿），不走這一根
    if (effectDetail) return null;
    if (!effectCard) return null;
    /* 有些特效的「強度」沒有意義（馬賽克調到一半只是把原圖疊回來），
       那種就在 FX_DEFS 裡設了 rootParam：最外層這根直接調它指定的參數。 */
    const rootP = FX_ROOT_PARAM[effectCard];
    if (rootP) {
      return editorSlider(
        rootP.label, fxVal(rootP.id, rootP.def), rootP.min, rootP.max,
        v => setFx({ [rootP.id]: v }),
      );
    }
    // 其餘一律只有一根「強度」，跟編輯一樣
    const amountId = fxAmountId(effectCard);
    return editorSlider('強度', fxVal(amountId, 0), 0, 100, v => setFx({ [amountId]: v }));
  }
  if (adjustSub === 'shape') {
    const sub = SHAPE_SUB_TOOLS[shapeMenu];
    const subTool = sub?.find(t => t[0] === shapeTool);
    if (subTool) {
      // 描邊色跟發光色用同一組色票
      if (subTool[0] === 'imgStrokeColor') return swatchStrip(img.imgStrokeColor, SOFT_COLORS, c => set({ imgStrokeColor: c }), true);
      if (subTool[0] === 'imgGlowColor') return swatchStrip(img.imgGlowColor, GLOW_COLORS, c => set({ imgGlowColor: c }), true);
      const k = subTool[0] as 'imgStrokeWidth' | 'imgGlow' | 'imgStrokeDash' | 'imgStrokeGap';
      // 形狀的滑桿都會動到圖片邊緣，拖的時候把選取框收起來。
      // 羽化的「範圍」是佔短邊的百分比，只有 50 段太粗，改成 0.5 一格。
      const preciseStroke = k === 'imgStrokeWidth' || k === 'imgStrokeGap';
      return editorSlider(
        subTool[1], preciseStroke ? (((img[k] as number) || 0) * 10) : ((img[k] as number) || 0),
        subTool[3], subTool[4],
        v => set({ [k]: preciseStroke ? v / 10 : v }), undefined, true,
      );
    }
    // 形狀那一頁沒有滑桿，上面那一段就留白
    if (shapeMenu === 'imgShape') return null;
    const t = SHAPE_TOOLS.find(x => x[0] === shapeTool);
    if (t && (t[0] === 'imgRadius' || t[0] === 'feather')) {
      const key = t[0] as 'imgRadius' | 'feather';
      // 羽化一格 0.5，低段位才調得準
      return editorSlider(
        t[1], (img[key] as number) || 0, t[3], t[4],
        v => set({ [key]: v }), undefined, true, key === 'feather' ? 0.5 : 1,
      );
    }
    return null;
  }
  return null;
})();

const sliderShown = fxDetailOpen || !!sliderArea;
useEffect(() => { onSliderOpenChange?.(sliderShown); }, [sliderShown, onSliderOpenChange]);

return (
  <div className="h-full flex flex-col justify-end">
    {/* 1. 滑桿（跟編輯一樣的 5rem、px-8、底下一條細線）。
           特效細項時把下面工具列那 6rem 借過來（它同時收成 0），
           兩段加起來還是 5rem + 6rem —— 預覽圖的大小完全不變。 */}
    <div
      className={`flex flex-col justify-center shrink-0 overflow-hidden bg-[#111] ${fxDetailOpen ? 'px-4' : 'px-8'}`}
      style={{ height: fxDetailOpen ? '11rem' : '5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      {fxDetailOpen ? (
        <div className="w-full h-full flex items-center gap-3">
          <button
            onClick={() => setEffectDetail(false)}
            aria-label="返回特效"
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-white"
          >
            <Icon name="arrow_back" className="text-xl" />
          </button>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {fxRows.map((row, ri) => (
              <div key={ri} className="flex items-center gap-4" style={{ height: fxRowH }}>
                {row.map(([key, label, mn, mx, dflt]) => (
                  <div key={key} className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.12em] truncate pointer-events-none">{label}</span>
                      <span className="text-[10px] leading-none font-sans tabular-nums font-bold bg-white/10 px-1.5 py-[4px] rounded shrink-0">{Math.round(fxVal(key, dflt))}</span>
                    </div>
                    <div className="relative h-[26px] flex items-center justify-center touch-none">
                      <input
                        type="range" min={mn} max={mx} step="1"
                        value={fxVal(key, dflt)}
                        onChange={e => setFx({ [key]: parseInt(e.target.value) })}
                        className="custom-range dense"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (deferSlider && sliderArea ? (
        /* key 一變就重播一次：每點一顆工具鈕，滑桿都是「從下面浮上來」 */
        <div key={`${adjustSub}|${tuneTool}|${shapeTool}|${effectCard}|${fx.lut || ''}`}
             className="w-full animate-in fade-in slide-in-from-bottom-2 duration-200">
          {sliderArea}
        </div>
      ) : sliderArea)}
    </div>

    {/* 2. 工具列（6rem、px-4、gap-2、深一階的底色） */}
    <div className="flex items-center px-4 overflow-x-auto no-scrollbar gap-2 bg-[#080808] shrink-0"
         style={{ height: fxDetailOpen ? '0px' : '6rem', opacity: fxDetailOpen ? 0 : 1 }}>
      {/* 濾鏡卡片：外觀跟「編輯」完全一樣 —— 縮圖是這張照片套上這顆濾鏡的樣子，
          名稱壓在下緣，選中的那顆是內描邊的白框（不佔版面、不會位移）。 */}
      {adjustSub === 'filter' && lutList.map((l, li) => {
        const active = (fx.lut || 'none') === l.id;
        return (
          <button
            key={l.id}
            data-lut-card={l.id}
            onClick={async () => {
              if (active) return;
              // eager：使用者正在等這一顆，不排隊（背景預載那一支才要等空檔）
              if (l.url) { setLoadingLut(l.id); await loadLut(l.id, l.url, true); setLoadingLut(null); }
              /* 強度用跟編輯頁同一份預設值（F3 是 70、F12 是 50…）——
                 以前這裡一律 100，同一顆濾鏡在拼圖裡就比編輯頁濃。 */
              setFx({ lut: l.id, lutAmount: lutDefaultAmount(l.id) });
              setLutRevision(n => n + 1);
            }}
            className="flex flex-col items-center gap-2 shrink-0 group w-[64px]"
          >
            <div className="relative w-full h-[76px] rounded-lg bg-[#111] overflow-hidden">
              <div className="absolute inset-0 bg-[#1a1a1a]" />
              <CardThumb src={cardSrc} delay={li * 24}
                         cacheKey={`${cardSrc}|lut:${l.id}|${lutRevision}`}
                         fx={{ lut: l.id, lutAmount: lutDefaultAmount(l.id) }} />
              {loadingLut === l.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 h-[16px] bg-[#0b0b0b]/90 flex items-center justify-center pb-[2px]">
                <span className={`text-[8px] font-black uppercase tracking-widest leading-none ${active ? 'text-white' : 'text-white/60'}`}>
                  {l.url ? l.name : '原始'}
                </span>
              </div>
              {active && <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />}
            </div>
          </button>
        );
      })}

      {adjustSub === 'tune' && TUNE_TOOLS.map(([id, label, icon, , , dflt]) =>
        toolBtn(id, label, icon, tuneTool === id,
          id === 'opacity' ? (img.opacity ?? 100) !== 100 : fxVal(id, dflt) !== dflt,
          () => setTuneTool(id))
      )}

      {/* 特效卡片：跟「編輯」同一份清單、同一種卡片外觀。
          縮圖是這個特效的預設效果，選中的那顆右上角會多一顆編輯鍵（有細項才有）。 */}
      {adjustSub === 'effect' && FX_ROOT_TOOLS.map(([id, label], fi) => {
        const amountId = fxAmountId(id);
        const on = fxVal(amountId, 0) !== 0;
        const detail = FX_DETAIL[id] || FX_SUB_TOOLS[id];
        const hasDetail = !!detail && detail.length > 1;
        return (
          <button
            key={id}
            data-fx-card={id}
            onClick={() => pickEffect(id)}
            className="flex flex-col items-center gap-2 shrink-0 group w-[64px]"
          >
            <div className="relative w-full h-[76px] rounded-lg bg-[#111] overflow-hidden">
              <div className="absolute inset-0 bg-[#1a1a1a]" />
              <CardThumb src={cardSrc} delay={fi * 24}
                         cacheKey={`${cardSrc}|fx:${id}`}
                         fx={{ [fxAmountId(id)]: FX_ON_AMOUNT[id] ?? 100 } as PhotoFx} />
              <div className="absolute inset-x-0 bottom-0 h-[16px] bg-[#0b0b0b]/90 flex items-center justify-center pb-[2px]">
                <span className={`text-[8px] font-black uppercase tracking-widest leading-none whitespace-nowrap ${on ? 'text-white' : 'text-white/60'}`}>
                  {label}
                </span>
              </div>
              {/* 白框＝這個特效正在生效；只是選到但沒開的不畫 */}
              {on && <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />}
              {on && hasDetail && (
                // 卡片本身就是一顆 button，裡面不能再放 button，所以用 span
                <span
                  role="button"
                  aria-label="調整細項"
                  onClick={e => { e.stopPropagation(); setEffectDetail(true); }}
                  onPointerDown={e => e.stopPropagation()}
                  style={{ position: 'absolute', top: 3, right: 3, width: 22, height: 22 }}
                  className="rounded-full flex items-center justify-center bg-black/55 border border-white/25 text-white active:scale-90 transition-transform"
                >
                  <Icon name="tune" className="text-[13px]" />
                </span>
              )}
            </div>
          </button>
        );
      })}

      {adjustSub === 'shape' && (shapeMenu === 'root'
        ? SHAPE_TOOLS.map(([id, label, icon, , , dflt]) => {
            // 「形狀」也是點進去一頁，只是那一頁放的是形狀不是滑桿
            const isShapePick = id === 'imgShape';
            const isSub = !!SHAPE_SUB_TOOLS[id] || isShapePick;
            // 只看粗細／強度，顏色不算：值是 0 的時候畫面上根本沒有效果，
            // 按鈕下方就不該有白點
            const adjusted = isShapePick
              ? isImgShaped(img.imgShape)
              : SHAPE_SUB_TOOLS[id]
                ? SHAPE_SUB_TOOLS[id].some(([k, , , , , d]) =>
                    !k.endsWith('Color') && (((img as any)[k]) || 0) !== d)
                : (((img as any)[id]) || 0) !== dflt;
            /* 「形狀」直接共用下方「造型」分頁的 shapes 圖標，
               兩個入口使用完全相同的視覺語言。 */
            const glyph = isShapePick ? 'shapes' : icon;
            /* 兩段式的那幾顆（形狀／描邊／發光）點下去整排會被子選單換掉，
               所以按下去的回饋交給 CSS 的 :active（見上面 toolBtn），
               換頁本身一點延遲都沒有。退回上一層時，剛剛進去的那一顆會留在
               亮著的狀態（見下面返回鍵）。 */
            return toolBtn(id, label, glyph, shapeTool === id, adjusted, () => {
              if (isShapePick) {
                setShapeMenu('imgShape');
                setShapeTool('imgShape');
              } else if (isSub) {
                setShapeMenu(id as any);
                setShapeTool(SHAPE_SUB_TOOLS[id][0][0]);
              } else {
                setShapeTool(id);
              }
            });
          })
        : (
          <div className="flex items-center gap-4 animate-in slide-in-from-right duration-300">
            <button
              /* 退回上一層時，剛剛進去的那一顆要留在亮著的狀態
                 （shapeMenu 存的就是它的 id：imgShape／stroke／glow）。
                 原本一律跳回圓角，所以從形狀退出來亮的是圓角，
                 看起來就像「剛剛按的那一顆根本沒被選過」。
                 這三顆在根選單沒有自己的滑桿，所以上面那一段照樣留白。 */
              onClick={() => { setShapeMenu('root'); setShapeTool(shapeMenu); }}
              className="flex flex-col items-center justify-center gap-2 shrink-0 group w-12"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all text-white">
                <Icon name="arrow_back" className="text-xl" />
              </div>
            </button>
            <div className="w-[1px] h-8 bg-white/10 mx-2" />
            {shapeMenu === 'imgShape'
              /* 形狀那一頁：按下去直接換外形。再按一次同一顆就回到方形，
                 不然選了愛心就沒有路可以退回去了。 */
              ? IMG_SHAPES.map(({ id, label, glyph }) => {
                  const cur = img.imgShape || 'rect';
                  return toolBtn(id, label,
                    // 空心版：跟「形狀」那顆圖標同一種語言。
                    // 尺寸比其他工具鈕小兩成（19→15）—— 方形／圓形／星型／愛心
                    // 都是滿版的實心輪廓，跟那些留白多的線條圖示放在一起會顯得太胖。
                    <ShapeGlyph item={{ id, kind: glyph, filled: false }} size={15} />,
                    cur === id, false, () => {
                    const next = cur === id ? 'rect' : id;
                    /* 換形狀時把位移歸零 —— 上一個形狀拖到的位置換到新形狀上
                       通常不是使用者要的，從正中間開始比較好調。 */
                    set({ imgShape: next, imgShapeX: 0, imgShapeY: 0, imgShapeZoom: 1 });
                  });
                })
              : SHAPE_SUB_TOOLS[shapeMenu].map(([id, label, icon, , , dflt]) => {
                  const cur = (img as any)[id];
                  const adjusted = id.endsWith('Color')
                    ? !!cur && cur.toUpperCase() !== '#FFFFFF'
                    : (cur || 0) !== dflt;
                  const glyph = id === 'imgStrokeGap' ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"
                        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : icon;
                  return toolBtn(id, label, glyph, shapeTool === id, adjusted, () => setShapeTool(id));
                })}
          </div>
        ))}
    </div>

    {/* 3. 分類列：跟編輯一樣的 h-16、上方細線、黑底、底部安全區空隙 */}
    <div className="flex h-16 border-t border-white/10 bg-black pb-[calc(env(safe-area-inset-bottom,0px)+12px)] box-content shrink-0">
      {CATS.map(([id, icon, label]) => (
        <button
          key={id}
          onClick={() => {
            if (id === 'compose') { openComposeFor(img.id); return; }
            /* 從構圖切到別的分類：先把當下裁切的結果確認掉再切過去 ——
               不然構圖介面會一直蓋在上面，看起來就只是「圖標亮了但沒反應」。 */
            if (composeOpen) onLeaveCompose?.();
            setAdjustSub(id as any);
            // 跟編輯一樣：切分類就把該分類的第一個工具選起來
            if (id === 'tune') setTuneTool(deferSlider ? '' : TUNE_TOOLS[0][0]);
            if (id === 'shape') { setShapeMenu('root'); setShapeTool(''); }
            if (id === 'effect') { setEffectCard(''); setEffectDetail(false); }
          }}
          /* 構圖開著的時候，亮的是「構圖」那一顆（它不佔用 adjustSub） */
          className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${
            (composeOpen ? id === 'compose' : adjustSub === id) ? 'text-white' : 'text-white/20'
          }`}
        >
          <Icon name={icon} className="text-xl" fill={composeOpen ? id === 'compose' : adjustSub === id} />
          <span className="text-[9px] font-black uppercase tracking-[0.2em]">{label}</span>
        </button>
      ))}
    </div>
  </div>
);
};

/** 預覽用的紋理層。跟匯出走同一支 paintPattern，看到什麼就是存出來什麼。 */
const PatternLayer: React.FC<{ w: number; h: number; opts: PatternOpts }> = ({ w, h, opts }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const raw = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const dpr = Math.min(raw, 2000 / Math.max(1, Math.max(w, h)));   // 長邊封頂，避免幾十 MB 的畫布
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, pw, ph);
    if (opts.type === 'none') return;
    g.save(); g.scale(dpr, dpr); paintPattern(g, w, h, opts); g.restore();
    /* ⚠ 條紋那四個參數一定要進來。
       少了它們，改數量／方向／兩個顏色時這一層根本不會重畫 ——
       但匯出走的是同一支 paintPattern、吃的是當下的值，
       於是「預覽看到的」跟「存出來的」會不一樣。 */
  }, [w, h, opts.type, opts.color, opts.size, opts.gap,
      opts.stripeN, opts.stripeDir, opts.stripeA, opts.stripeB]);
  if (opts.type === 'none' || w <= 0 || h <= 0) return null;
  return <canvas ref={ref} className="absolute inset-0 pointer-events-none" style={{ width: w, height: h }} />;
};

const ColorPickerEmbedded: React.FC<ColorPickerProps> = ({ color, onChange, onClose, headerLeft, colors }) => {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexInput, setHexInput] = useState(color);

  useEffect(() => { 
    setHexInput((prev) => {
      if (color.toUpperCase() !== prev.toUpperCase()) {
        setHsv(hexToHsv(color));
        return color.toUpperCase();
      }
      return prev;
    });
  }, [color]);

  const handleHsvChange = (key: string, val: string) => {
    const newHsv = { ...hsv, [key]: Number(val) };
    setHsv(newHsv as any);
    const newHex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    setHexInput(newHex);
    onChange(newHex);
  };

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase();
    if (val.length > 0 && !val.startsWith('#')) val = '#' + val;
    setHexInput(val);
    
    if (/^#[0-9A-F]{6}$/i.test(val)) {
      setHsv(hexToHsv(val));
      onChange(val);
    }
  };

  // 跟發光同一條漸層，明度提到 90%；第一顆是純白
  const PRESETS = colors || SOFT_COLORS;

  /* 色號欄。沒有頂列時跟色票並排（原本的樣子）；
     有頂列時搬上去跟返回鍵平行，色票就能佔滿整排。 */
  const hexBox = (
    <input
      type="text"
      value={hexInput}
      onChange={handleHexInputChange}
      maxLength={7}
      aria-label="色號"
      className="shrink-0 h-8 w-[86px] bg-[#1A1A1A] border border-[#333] rounded-[7px] px-2 text-white font-mono text-xs outline-none focus:border-white/50"
    />
  );

  return (
    <div className="h-full flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
      {headerLeft && (
        <div className="h-[38px] flex items-center gap-1 px-0.5 shrink-0">
          {headerLeft}
          <div className="ml-auto">{hexBox}</div>
        </div>
      )}
      <div className="flex items-center gap-2 mb-3">
        {/* 韓系拼貼常用色：一點就換。
            內距是留給選取外框的，否則第一顆與外框上緣會被捲動容器裁掉。 */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0 px-0.5 py-0.5">
          {/* 第一顆固定是自訂顏色 */}
          <CustomColorButton
            value={/^#[0-9A-F]{6}$/i.test(hexInput) ? hexInput : color}
            onPick={c => { setHsv(hexToHsv(c)); setHexInput(c.toUpperCase()); onChange(c); }}
          />
          {PRESETS.map(c => {
            const active = c.toUpperCase() === (color || '').toUpperCase();
            return (
              <button
                key={c}
                onClick={() => { setHsv(hexToHsv(c)); setHexInput(c.toUpperCase()); onChange(c); }}
                title={c}
                className={`shrink-0 w-8 h-8 rounded-[7px] transition-all active:scale-90 ${
                  active ? 'border-2 border-white' : 'border border-white/20'
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
        {!headerLeft && hexBox}
      </div>
      
      <div className="flex-1 flex flex-col space-y-3">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
              <span>色相</span>
              <span className="text-white/40">{Math.round(hsv.h)}°</span>
            </div>
            <div className="slider-wrap" style={{ height: 6 }}><input type="range" min="0" max="360" value={hsv.h} onInput={e => handleHsvChange('h', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ ['--bar' as any]: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }} /></div>
          </div>
          <div className="grid grid-cols-2 gap-x-7 gap-y-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>飽和度</span>
                <span className="text-white/40">{Math.round(hsv.s)}%</span>
              </div>
              <div className="slider-wrap" style={{ height: 6 }}><input type="range" min="0" max="100" value={hsv.s} onInput={e => handleHsvChange('s', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ ['--bar' as any]: `linear-gradient(to right, #808080, ${hsvToHex(hsv.h, 100, 100)})` }} /></div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>明度</span>
                <span className="text-white/40">{Math.round(hsv.v)}%</span>
              </div>
              <div className="slider-wrap" style={{ height: 6 }}><input type="range" min="0" max="100" value={hsv.v} onInput={e => handleHsvChange('v', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ ['--bar' as any]: `linear-gradient(to right, #000, ${hsvToHex(hsv.h, hsv.s, 100)})` }} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface AlignmentGuideline {
  type: 'vertical' | 'horizontal';
  coord: number;
  /** 橫線只畫在這一頁的左右範圍內（內容座標）。沒填就畫滿整排（舊行為）。 */
  x0?: number;
  x1?: number;
}

/* ── 圓角 + 羽化遮罩 ────────────────────────────────────────────────
   線性漸層做的羽化在四個角會淡得比較快，看起來很廉價。這裡改成修圖軟體
   的做法：先把圓角矩形畫成遮罩，再對 alpha 做三次盒狀模糊（≈高斯），
   淡出就會沿著形狀輪廓等距展開，圓角也一起變柔。
   預覽與匯出共用同一支，兩邊才會長得一模一樣。                          */

/**
 * 圓角半徑：百分比一律吃「短邊」，四個角都是正圓弧。
 *
 * 以前是水平吃寬、垂直吃高（＝CSS 的 border-radius: N%），角變成橢圓：
 * 直立的格子 rx 很小、ry 很大，上下那條邊才走一點點就急轉彎，看起來
 * 就是「邊上突然多一個角」。正圓角走的是四分之一圓，接到直邊的曲率
 * 變化平順，也才是修圖軟體的做法。
 */
export const cornerR = (pct: number, w: number, h: number) => (pct / 100) * Math.min(w, h);

/** 圓角矩形路徑（rx/ry 可不同，但呼叫端一律傳同一個值 → 正圓角）。 */
export const roundRectPath = (
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, rx: number, ry: number,
) => {
  rx = Math.max(0, Math.min(rx, w / 2));
  ry = Math.max(0, Math.min(ry, h / 2));
  g.beginPath();
  if (rx < 0.5 || ry < 0.5) { g.rect(x, y, w, h); return; }
  const Q = Math.PI / 2;
  g.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI + Q);
  g.lineTo(x + w - rx, y);
  g.ellipse(x + w - rx, y + ry, rx, ry, 0, -Q, 0);
  g.lineTo(x + w, y + h - ry);
  g.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Q);
  g.lineTo(x + rx, y + h);
  g.ellipse(x + rx, y + h - ry, rx, ry, 0, Q, Math.PI);
  g.closePath();
};

/* ── 圖片的外形（形狀）───────────────────────────────────────────────
 *
 * 圖片本來只有「方形＋圓角」一種外形。這一組讓它可以換成圓形、星型、愛心。
 *
 * 路徑直接借用「新增圖形」那一份（shapePathD）—— 兩邊畫出來的圓形、星星、
 * 愛心因此是同一顆，不會出現「圖形的星星跟圖片的星星長得不一樣」。
 *
 * 最要緊的一條規矩：**沒設形狀時，這幾支的行為要跟以前一模一樣。**
 * 所有既有的圖片都沒有 imgShape，一律走 isImgShaped() 為 false 的那條路，
 * 也就是原本的 roundRectPath／drawImage，一個像素都不會變。
 */

/** 圖片可以選的外形。'rect' ＝ 原本的方形（還是可以再套圓角）。 */
export const IMG_SHAPES: { id: string; label: string; glyph: string }[] = [
  // glyph ＝ 按鈕上要畫哪一顆（用 shapePathD 的向量，不靠圖示字型）
  { id: 'rect', label: '方形', glyph: 'square' },
  { id: 'circle', label: '圓形', glyph: 'circle' },
  { id: 'star', label: '星型', glyph: 'star' },
  { id: 'heart', label: '愛心', glyph: 'heart' },
];

/**
 * 「形狀」那一顆的圖標。
 *
 * 固定長這樣，不跟著目前選的形狀變 —— 分類鈕要一直是同一張臉，
 * 變來變去反而認不出來（要知道現在選了哪一個，點進去那一排就看得到）。
 * 一個方框疊一個圓，是「形狀」最好認的畫法；空心跟裡面那排一致。
 */
export const ImgShapeIcon: React.FC<{ size?: number }> = ({ size = 19 }) => (
  /* 方形、圓形與三角形用清楚的留白分隔，直覺表達「選擇形狀」。
     三個封閉輪廓合併成一次 SVG 描邊，透明狀態也不會在接點疊白。 */
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.35}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3.5 3.5h6.25v6.25H3.5z M20.5 6.625a3.125 3.125 0 1 1-6.25 0 3.125 3.125 0 1 1 6.25 0 M3.5 20.5h7l-3.5-6z" />
  </svg>
);

export const isImgShaped = (kind?: string) => !!kind && kind !== 'rect';

/**
 * 形狀要畫在框裡的哪一塊。
 *
 * 用「短邊的正方形、擺正中央」——因為圓形、星星、愛心本來就是 1:1 的
 * （ADD_SHAPE_ITEMS 裡它們都沒有 ratio）。直接照框的長寬去畫的話，
 * 4:3 的照片會把圓形壓成橢圓、星星拉歪，那不是使用者要的「正的圖案」。
 */
export const imgShapeBox = (w: number, h: number) => {
  const s = Math.min(w, h);
  return { x: (w - s) / 2, y: (h - s) / 2, s };
};

/**
 * 形狀要畫多大、畫在哪裡。
 *
 * 只把形狀塞進正方形是不夠的：愛心的路徑只佔它外框的 73%、上面還空著
 * 四分之一（見 SHAPE_FIT）—— 照原樣畫，愛心就會比圓形、星星小一圈，
 * 頂部一大片空白。所以先照 SHAPE_FIT 把「真正有畫到的那一塊」放大到剛好
 * 填滿正方形（取寬、高兩個倍率裡小的那個，才不會有一邊爆出去），
 * 再把墨水的中心對到正方形的中心。
 *
 * 回傳 S ＝ 要餵給 shapePathD 的外框邊長，tx／ty ＝ 路徑要平移到哪裡。
 * 刻意回傳「平移量」而不是直接 ctx.scale：一 scale 連線寬都會跟著放大，
 * 描邊就會變粗。shapePathD 本來就是照傳進去的尺寸等比產生的，
 * 直接餵一個大一點的外框最乾淨。
 */
export const imgShapeXform = (kind: string, w: number, h: number) => {
  const b = imgShapeBox(w, h);
  const f = SHAPE_FIT[kind] || [0, 0, 1, 1];
  const k = Math.min(f[2] > 0 ? 1 / f[2] : 1, f[3] > 0 ? 1 / f[3] : 1);
  const S = b.s * k;
  return {
    S, b,
    tx: b.x + b.s / 2 - (f[0] + f[2] / 2) * S,
    ty: b.y + b.s / 2 - (f[1] + f[3] / 2) * S,
    /** 放大之後墨水實際的寬高（選取框照這個畫） */
    iw: f[2] * S, ih: f[3] * S,
  };
};

/**
 * 鋪好圖片的外框路徑，然後跑 run()。
 *
 * 沒有形狀 → 照舊把圓角矩形鋪在畫布上，run() 收到 undefined，
 *            呼叫端就跟以前一樣用 fill()／stroke()。
 * 有形狀   → 把畫布原點搬到 (x,y)，run() 收到一個 Path2D，
 *            呼叫端改用 fill(p)／stroke(p)。跑完會把畫布狀態還原。
 *
 * 之所以用「搬原點」而不是把路徑本身平移：Path2D 的矩陣參數在各家瀏覽器
 * 的支援度沒有 translate() 那麼一致，而這個 App 是要進 WKWebView 的。
 */
export const withImgOutline = (
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  kind: string | undefined, rx: number, ry: number,
  run: (p?: Path2D) => void,
) => {
  if (!isImgShaped(kind)) { roundRectPath(g, x, y, w, h, rx, ry); run(); return; }
  /* 正方形、擺中央、而且墨水放大到填滿它（見 imgShapeXform）。
     描邊那一次傳進來的框比填色那一次大 lw（四邊各 lw/2），兩者因此同心、
     邊距剛好 lw/2 —— 線就會貼著形狀的邊描。 */
  const t = imgShapeXform(kind!, w, h);
  g.save();
  g.translate(x + t.tx, y + t.ty);
  try { run(new Path2D(shapePathD(kind!, t.S, t.S))); } finally { g.restore(); }
};

/**
 * 形狀真正「有畫到」的那一塊，回傳的是在原本那個 w×h 框裡的位置與大小。
 *
 * 選取框照這個畫，就會剛好把看得見的圖案包住 —— 愛心上面那片空白、
 * 星星底下那條，都不會被框進去。沒有形狀時回傳整個框，跟以前一模一樣。
 * 用的是跟按鈕小圖同一份 SHAPE_FIT，所以框與圖案永遠對得上。
 */
export const imgShapeInk = (kind: string | undefined, w: number, h: number) => {
  if (!isImgShaped(kind)) return { x: 0, y: 0, w, h };
  /* 形狀已經被放大到填滿那個正方形（見 imgShapeXform），所以正方形就是
     「一定框得住、而且不會多留空白」的那個框。
     這裡刻意**不**再用 SHAPE_FIT 去縮得更緊 —— 那份表是給按鈕小圖用的近似值，
     拿來當選取框時，誤差會變成「圖案凸出框外」，那比稍微鬆一點難看得多。
     經典拼圖的外框用的也是這個正方形，兩邊因此完全一致。 */
  const b = imgShapeBox(w, h);
  return { x: b.x, y: b.y, w: b.s, h: b.s };
};

/** 這個點落在圖片「看得見的那一塊」裡面嗎？（形狀之外的角落不算） */
let hitCtx: CanvasRenderingContext2D | null = null;
export const isPointInImgShape = (
  kind: string | undefined, w: number, h: number, lx: number, ly: number,
): boolean => {
  if (w <= 0 || h <= 0) return false;
  if (!isImgShaped(kind)) return lx >= 0 && lx <= w && ly >= 0 && ly <= h;
  if (!hitCtx) {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    hitCtx = c.getContext('2d');
  }
  if (!hitCtx) return lx >= 0 && lx <= w && ly >= 0 && ly <= h;
  const t = imgShapeXform(kind!, w, h);
  try {
    return hitCtx.isPointInPath(new Path2D(shapePathD(kind!, t.S, t.S)), lx - t.tx, ly - t.ty);
  } catch {
    return lx >= 0 && lx <= w && ly >= 0 && ly <= h;
  }
};

/** 圖片在形狀裡最多能放到幾倍（跟佈局的格子同一個上限） */
export const IMG_SHAPE_MAX_ZOOM = 5;

export const clampImgZoom = (z: any) =>
  Math.max(1, Math.min(IMG_SHAPE_MAX_ZOOM, Number(z) || 1));

/**
 * 圖片在形狀裡還能往各方向挪多遠（單位跟 w／h 一樣，回傳的是半徑）。
 *
 * 看得見的只有中間那個正方形，所以只要「圖片蓋得住那個正方形」就不會露出空隙：
 *   橫向可拖 = (圖片寬 × 倍率 − 正方形邊長) / 2
 * 因此橫的照片在倍率 1 時就已經可以左右拖了（寬比正方形寬），
 * 上下要拖則得先放大一點 —— 跟佈局裡調整格子內照片是同一種手感。
 */
/**
 * 兩指放大／縮小時，位移要怎麼跟著變，才會像是「以形狀的中心為基準」在縮放。
 *
 * imgShapeX／Y 存的是「佔可拖範圍的幾成」。可拖範圍會隨倍率一起變大，
 * 所以倍率一動、同樣的比例換算出來的實際位移就變了 —— 畫面上看起來就是
 * 一邊放大一邊往旁邊滑，基準點跑掉。
 *
 * 要讓形狀中心底下的那一個點固定不動，實際位移必須跟倍率成正比
 * （位移 / 圖片寬度 不變）。所以這裡先還原成實際位移、乘上倍率的變化，
 * 再換算回新的比例，最後夾回範圍內。
 */
export const zoomAboutShapeCenter = (
  w: number, h: number, z0: number, z1: number, x0: any, y0: any,
) => {
  const a = imgShapePan(w, h, z0), b = imgShapePan(w, h, z1);
  const cl = (v: number) => Math.max(-1, Math.min(1, v));
  const k = (Number(z0) || 1) > 0 ? (z1 / (Number(z0) || 1)) : 1;
  const offX = (Number(x0) || 0) * a.rx * k;
  const offY = (Number(y0) || 0) * a.ry * k;
  return {
    x: b.rx > 0.5 ? cl(offX / b.rx) : 0,
    y: b.ry > 0.5 ? cl(offY / b.ry) : 0,
  };
};

export const imgShapePan = (w: number, h: number, zoom: any) => {
  const b = imgShapeBox(w, h);
  const z = clampImgZoom(zoom);
  return { rx: Math.max(0, (w * z - b.s) / 2), ry: Math.max(0, (h * z - b.s) / 2) };
};

/**
 * 把圖片畫進外框裡。
 *
 * **預設不放大**（imgShapeZoom 沒設就是 1）—— 選了形狀之後圖片的大小、
 * 看到的範圍都跟原本一模一樣，只是被裁成那個形狀而已。要放大是使用者
 * 自己兩指捏出來的，不是我們偷偷幫他放大。
 *
 * 倍率 1、沒有位移時，這一行等同於原本的 drawImage(base, x, y, w, h)。
 */
export const drawImgBase = (
  g: CanvasRenderingContext2D, base: CanvasImageSource,
  x: number, y: number, w: number, h: number, o: any,
) => {
  if (!isImgShaped(o?.imgShape)) { g.drawImage(base, x, y, w, h); return; }
  const z = clampImgZoom(o.imgShapeZoom);
  const dw = w * z, dh = h * z;
  const { rx, ry } = imgShapePan(w, h, z);
  const cl = (v: any) => Math.max(-1, Math.min(1, Number(v) || 0));
  g.drawImage(
    base,
    x + (w - dw) / 2 + cl(o.imgShapeX) * rx,
    y + (h - dh) / 2 + cl(o.imgShapeY) * ry,
    dw, dh,
  );
};

/** 單次盒狀模糊（滑動視窗，邊界夾住）。三次疊起來就很接近高斯。 */
const boxBlurH = (src: Float32Array, dst: Float32Array, w: number, h: number, r: number) => {
  const norm = 1 / (r * 2 + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
};

const boxBlurV = (src: Float32Array, dst: Float32Array, w: number, h: number, r: number) => {
  const norm = 1 / (r * 2 + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
};

/**
 * 產生一張遮罩（白色、alpha 就是可見度）。
 * radiusPct 是圓角，佔短邊的百分比 0~50。
 *
 * featherPct（0~100）＝ 羽化要從圖片邊緣往中心走多遠：
 *    0 ＝ 不羽化，邊緣是硬的
 *   50 ＝ 淡出帶佔短邊的四分之一（邊緣走到「邊緣與中心的正中間」）
 *  100 ＝ 淡出帶一路走到圖片中心，整張圖都在漸層裡
 * 不管調多少，最外緣一定是完全透明、帶子的內側一定是完全不透明。
 */
export const makeShapeMask = (
  w: number, h: number, radiusPct: number, featherPct: number,
  /** 圖片的外形。沒給就是原本的圓角矩形 */
  kind?: string,
) => {
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(w));
  c.height = Math.max(4, Math.round(h));
  const g = c.getContext('2d')!;
  const fp = Math.max(0, Math.min(100, featherPct));
  const rp = Math.max(0, Math.min(50, radiusPct));
  /* 淡出帶要多寬。
     以「短邊的一半」當滿分：fp = 100 時帶寬就是短邊的一半，
     也就是從邊緣一路淡到圖片中心。

     模糊是三次盒狀模糊：半徑 r 疊三次會把一條硬邊抹開到 ±3r，
     所以帶寬 = 2 × 3r；形狀再往內縮 3r，最外緣才會剛好收斂到 0。
     反推就是 r = 帶寬 / 6。 */
  const half = Math.min(c.width, c.height) / 2;
  /* 滑桿的數字＝「淡出帶從邊緣往內走多少」，直接對應、不加任何曲線：
       10  → 走到「邊緣到中心」的 10%
       50  → 走一半
       100 → 一路走到中心
     這樣滑桿上看到的數字就是實際的效果，調起來心裡有底。 */
  const bandW = (fp / 100) * half;
  const r = fp > 0 ? Math.max(1, Math.round(bandW / 6)) : 0;
  // 讓出 3r（+1 是因為離散的盒狀模糊在邊界還會留一點點）
  const inset = r > 0 ? r * 3 + 1 : 0;
  g.fillStyle = '#fff';
  const R = Math.max(0, cornerR(rp, c.width, c.height) - inset);
  withImgOutline(
    g, inset, inset, c.width - inset * 2, c.height - inset * 2, kind, R, R,
    p => { p ? g.fill(p) : g.fill(); },
  );

  if (r >= 1) {
    const px = g.getImageData(0, 0, c.width, c.height);
    const n = c.width * c.height;
    let a = new Float32Array(n);
    let b = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = px.data[i * 4 + 3];
    for (let pass = 0; pass < 3; pass++) {
      boxBlurH(a, b, c.width, c.height, r); [a, b] = [b, a];
      boxBlurV(a, b, c.width, c.height, r); [a, b] = [b, a];
    }
    for (let i = 0; i < n; i++) {
      // RGB 全部填白，這樣不管遮罩被當成 alpha 還是亮度都成立
      px.data[i * 4] = 255; px.data[i * 4 + 1] = 255; px.data[i * 4 + 2] = 255;
      px.data[i * 4 + 3] = a[i];
    }
    g.putImageData(px, 0, 0);
  }
  return c;
};

/** 新增文字時的預設內容；點進去打字會自動清掉，沒打東西再放回來 */
const TEXT_PLACEHOLDER = '輸入文字';

/**
 * 把顏色往黑色壓一點，做出「不透明」的接縫顏色。
 * 排頁面時接縫一定要不透明：半透明的話，底下的深色工作區會從次像素的縫裡
 * 透出來，透多少完全看那條縫剛好落在像素格的哪個位置 —— 每條的深淺就不一樣。
 */
const shadeHex = (hex: string | undefined, amount: number) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || '').trim());
  if (!m) return hex || '#ffffff';
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};

/** 工作區的底色。一般模式下頁與頁之間露出來的就是它。 */
const WORKSPACE_BG = '#070707';
/**
 * 頁與頁之間那條分隔線。
 *
 * 一般模式是 1px 的 bg-black/15，而它底下是工作區的深色 —— 所以看到的其實是
 * 一條**深色**細線（#070707 再壓深 15%），不是灰線。
 *
 * 排頁面時跟著整排一起等比例縮小（1px → 0.4px），只有顏色改成「不透明」的
 * 同一個深色：半透明的話，相鄰兩頁各自做次像素抗鋸齒，底下透出來多少會看
 * 那條縫剛好落在像素格的哪 —— 每條深淺就不一樣了。不透明之後，不管落在哪
 * 一格，畫出來的墨水量都固定是「0.4px × 這個深色」。
 */
const PAGE_SEAM_INK = 0.15;

/** 發光的單位模糊：跟文字一樣是 (強度/20) × 14，再疊 ×1、×2、×3 三層 */
export const GLOW_BLUR_UNIT = 14;
/** 三層裡最寬的那層是 1.5 個單位，散到 3.2σ 就看不見了 → 單位的 4.8 倍 */
export const GLOW_EXTENT = 4.8;

/** erfc 近似（Abramowitz & Stegun 7.1.26，誤差 < 1.5e-7），只用在 x ≥ 0 */
const erfc = (x: number) => {
  const t = 1 / (1 + 0.3275911 * x);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741
    + t * (-1.453152027 + t * 1.061405429))));
  return y * Math.exp(-x * x);
};

/**
 * 光暈：跟文字的發光同一套 —— 同一個形狀疊三層陰影，
 * 模糊半徑是「單位 ×1、×2、×3」，所以貼著邊很亮、往外拖一條長長的淡尾巴。
 *
 * 文字是直接讓 canvas 畫三次 shadow。但對一張矩形照片這樣做，
 * 四個角只會被兩個方向各照到一半，濃度天生是邊的一半（角落的光比較少）。
 * 所以這裡改成：先算每一格「離輪廓多遠」，再用三層高斯疊起來的亮度公式
 * 1 − Π(1 − erfc(d/σ√2)/2) 去換算（canvas 的 shadowBlur b 相當於 σ = b/2）。
 * 直邊上算出來的濃淡跟文字那三層一模一樣，而距離跟方向無關，
 * 四個角就自然跟邊一樣濃。
 */
export const makeGlowCanvas = (
  shape: CanvasImageSource,
  w: number, h: number,
  sx: number, sy: number, sw: number, sh: number,
  blurPx: number,
  color: string,
) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return c;
  g.drawImage(shape, sx, sy, sw, sh);

  const W = c.width, H = c.height;
  const px = g.getImageData(0, 0, W, H);
  const n = W * H;
  const unit = Math.max(0.5, blurPx);
  // 三層的 σ：shadowBlur = unit × k，而 shadowBlur b 相當於 σ = b/2
  const sigma = [1, 2, 3].map(k => (unit * k) / 2);
  const extent = unit * GLOW_EXTENT;

  // 距離場（兩次掃描的 chamfer 近似）：圖片裡面是 0，外面是離輪廓的距離
  const FAR = extent + 2;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = px.data[i * 4 + 3] >= 128 ? 0 : FAR;
  const D1 = 1, D2 = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + D1);
      if (y > 0) {
        v = Math.min(v, d[i - W] + D1);
        if (x > 0) v = Math.min(v, d[i - W - 1] + D2);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + D2);
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[i + 1] + D1);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + D1);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + D2);
        if (x > 0) v = Math.min(v, d[i + W - 1] + D2);
      }
      d[i] = v;
    }
  }

  // 距離 → 亮度：三層高斯疊起來（跟文字疊三層 shadow 的結果相同）。
  // 每 0.5px 建一次查表，省掉每個像素算三次 erfc。
  const STEP = 0.5;
  const lutN = Math.ceil(extent / STEP) + 2;
  const lut = new Float32Array(lutN);
  for (let i = 0; i < lutN; i++) {
    let keep = 1;
    for (const s of sigma) keep *= 1 - 0.5 * erfc((i * STEP) / (s * Math.SQRT2));
    lut[i] = 255 * (1 - keep);
  }
  let a = new Float32Array(n);
  let b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = d[i] / STEP;
    const j = t | 0;
    a[i] = j >= lutN - 1 ? 0 : lut[j] + (lut[j + 1] - lut[j]) * (t - j);
  }
  // 距離是一格一格算出來的，補一次小模糊把 chamfer 的稜角磨平
  const r = Math.max(1, Math.round(sigma[0] * 0.6));
  for (let pass = 0; pass < 2; pass++) {
    boxBlurH(a, b, W, H, r); [a, b] = [b, a];
    boxBlurV(a, b, W, H, r); [a, b] = [b, a];
  }

  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.replace('#', '#'));
  const cr = m ? parseInt(m[1], 16) : 255;
  const cg = m ? parseInt(m[2], 16) : 255;
  const cb = m ? parseInt(m[3], 16) : 255;
  for (let i = 0; i < n; i++) {
    px.data[i * 4] = cr;
    px.data[i * 4 + 1] = cg;
    px.data[i * 4 + 2] = cb;
    px.data[i * 4 + 3] = a[i];
  }
  g.putImageData(px, 0, 0);
  return c;
};

/**
 * 預覽用的遮罩。只依「長寬比 + 圓角 + 羽化」快取，縮放圖片時不用重算；
 * 遮罩本來就是平滑的，拉伸貼上看不出差別。
 */
const maskCanvasCache = new Map<string, HTMLCanvasElement>();
const previewMask = (aspect: number, radiusPct: number, featherPct: number, kind?: string) => {
  const key = `${aspect.toFixed(2)}|${radiusPct}|${featherPct}|${kind || ''}`;
  const hit = maskCanvasCache.get(key);
  if (hit) return hit;
  /* 有羽化的遮罩用比較小的邊長。
     這一張的成本幾乎全在「模糊」那一步，而模糊是隨面積成長的 ——
     實測 400×267 要 13.6 毫秒、240×160 只要 4.2 毫秒（PNG 編碼本身
     只有 0.6 毫秒，因為這張圖就是一片平滑的漸層、壓完才 4KB）。
     拖羽化滑桿時每換一個數字就要做一次，那 13.6 毫秒正是「很卡」。
     羽化本來就是一片平滑的過渡，放大貼上看不出任何差別；
     沒有羽化的（純外形／圓角）邊緣是硬的，維持 400 不動。
     ⚠ 匯出走的是另一條全解析度的路（makeShapeMask），成品一個像素都沒變。 */
  const MAX = featherPct > 0 ? 240 : 400;
  const w = aspect >= 1 ? MAX : Math.max(16, Math.round(MAX * aspect));
  const h = aspect >= 1 ? Math.max(16, Math.round(MAX / aspect)) : MAX;
  const c = makeShapeMask(w, h, radiusPct, featherPct, kind);
  if (maskCanvasCache.size > 60) maskCanvasCache.clear();
  maskCanvasCache.set(key, c);
  return c;
};

/**
 * 一個圖層「看得到的那一塊形狀」，換成 CSS 講得出來的東西。
 *
 * 單純圓角 → border-radius。值就是 cornerR（(比例/100)×短邊），跟匯出一模一樣，
 *   而且合成器直接畫，**不用解碼任何圖** —— 拖圓角滑桿因此不會閃。
 * 羽化或非矩形的外形 → 遮罩圖，來源是跟匯出同一支 makeShapeMask。
 *
 * 影片圖層與「拖曳互換時那層變暗」用的是這同一支，所以暗下去的形狀
 * 一定跟圖層現在的形狀一致。
 */
const maskUrlCache = new Map<string, string>();
const shapeParts = (image: any, boxW: number, boxH: number) => {
  const kind = image?.imgShape as string | undefined;
  const radiusPct = image?.imgRadius || 0;
  const featherPct = image?.feather || 0;
  const needMaskImg = !!(featherPct || isImgShaped(kind));
  if (!needMaskImg) {
    return {
      needMaskImg: false,
      cssRadius: radiusPct > 0 && boxW && boxH ? `${cornerR(radiusPct, boxW, boxH)}px` : undefined,
      maskUrl: '',
    };
  }
  if (!boxW || !boxH) return { needMaskImg: true, cssRadius: undefined, maskUrl: '' };
  /* 網址照「長寬比＋圓角＋羽化＋外形」快取：兩邊拿到的是同一個字串，
     瀏覽器也就只解碼一次。 */
  /* 圓角與羽化吸到 2% 的格子上。
     拖羽化滑桿時每一格都是一個新數字，而每一個新數字都要重新編一張 PNG
     （toDataURL）再解碼一次 —— 實測拖曳中掉到 40 格。吸到 2% 之後，
     整段 0→100 最多只會編 50 張，而且來回拖時全部命中快取。
     1% 的差別肉眼看不出來，**匯出用的仍然是原始數值**，成品一點都沒變。 */
  const q = (v: number) => Math.round(v / 2) * 2;
  const ar = boxW / boxH;
  const qr = q(radiusPct), qf = q(featherPct);
  const key = `${ar.toFixed(2)}|${qr}|${qf}|${kind || ''}`;
  let url = maskUrlCache.get(key);
  if (!url) {
    url = buildMaskUrl(ar, qr, qf, kind);
    /* 慢慢拖的時候，下一個值幾乎一定是現在這個 ±2。
       趁空檔先把左右各兩格做好放進快取，手指移過去就完全不用再做一張 ——
       實測一張要 4~14 毫秒，那正是「拖起來一頓一頓」的來源。 */
    if (featherPct > 0) warmMasks(ar, qr, qf, kind);
  }
  return { needMaskImg: true, cssRadius: undefined, maskUrl: url };
};

/** 做一張遮罩網址（失敗就回空字串，呼叫端會當成「這一格先不套遮罩」） */
const buildMaskUrl = (ar: number, radiusPct: number, featherPct: number, kind?: string): string => {
  const key = `${ar.toFixed(2)}|${radiusPct}|${featherPct}|${kind || ''}`;
  const hit = maskUrlCache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try { url = previewMask(ar, radiusPct, featherPct, kind).toDataURL('image/png'); }
  catch { url = ''; }
  if (maskUrlCache.size > 80) maskUrlCache.clear();
  maskUrlCache.set(key, url);
  return url;
};

/* 預熱：把「現在這個羽化值的左右各兩格」在空檔時先做好。
   一次只做一張，而且是在 requestIdleCallback 裡做 —— 有別的事要忙就讓開，
   絕對不會跟畫面搶時間。 */
const maskWarmQueue: [number, number, number, string | undefined][] = [];
let maskWarmScheduled = false;
const runMaskWarm = () => {
  maskWarmScheduled = false;
  const job = maskWarmQueue.shift();
  if (job) {
    const [ar, r, f, k] = job;
    const u = buildMaskUrl(ar, r, f, k);
    // 順手解碼好，真的換上去時就不用再等
    if (u) { try { const im = new Image(); im.src = u; } catch { /* ignore */ } }
  }
  if (maskWarmQueue.length) scheduleMaskWarm();
};
const scheduleMaskWarm = () => {
  if (maskWarmScheduled || typeof window === 'undefined') return;
  maskWarmScheduled = true;
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') ric(runMaskWarm, { timeout: 300 });
  else window.setTimeout(runMaskWarm, 60);
};
const warmMasks = (ar: number, radiusPct: number, featherPct: number, kind?: string) => {
  for (const d of [2, -2, 4, -4]) {
    const f = featherPct + d;
    if (f < 0 || f > 100) continue;
    const key = `${ar.toFixed(2)}|${radiusPct}|${f}|${kind || ''}`;
    if (maskUrlCache.has(key)) continue;
    if (maskWarmQueue.some(j => j[0] === ar && j[1] === radiusPct && j[2] === f && j[3] === kind)) continue;
    maskWarmQueue.push([ar, radiusPct, f, kind]);
  }
  if (maskWarmQueue.length > 12) maskWarmQueue.splice(0, maskWarmQueue.length - 12);
  scheduleMaskWarm();
};

/* ── 濾鏡／特效按鈕的縮圖 ────────────────────────────────────────────
   跟「編輯」那邊同一個做法：直接畫在 canvas 上（不轉 data URL，
   省掉 PNG 編碼與解碼那一段，按鈕才會馬上有圖）。
   算好的留在模組層，換分頁、換圖層都不用重算。 */
const CARD_W = 64, CARD_H = 76;
/** 縮圖用的實際像素密度，2～3 之間 —— 太低會糊，太高只是白算 */
const CARD_DPR = Math.max(2, Math.min(3, Math.round(typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2)));
const cardThumbCache = new Map<string, HTMLCanvasElement>();

/** 這一格縮圖：把來源縮成卡片大小之後才套效果，所以很快 */
const makeCardThumb = (img: HTMLImageElement, fx: PhotoFx): HTMLCanvasElement | null => {
  if (!img.naturalWidth) return null;
  const w = CARD_W * CARD_DPR, h = CARD_H * CARD_DPR;
  // 先等比例填滿卡片（object-cover），再把效果套在這張小圖上
  const cut = document.createElement('canvas');
  cut.width = w; cut.height = h;
  const cctx = cut.getContext('2d')!;
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  cctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return applyPhotoFx(cut, w, h, fx);
};

/** 濾鏡／特效卡片上的那張縮圖。算好之前先畫底圖，不會有空洞。 */
const CardThumb: React.FC<{ src: string; cacheKey: string; fx: PhotoFx; delay?: number }> = ({ src, cacheKey, fx, delay = 0 }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let dead = false;
    const paint = () => {
      const cvs = ref.current;
      if (dead || !cvs) return;
      let thumb = cardThumbCache.get(cacheKey);
      if (!thumb) {
        const img = getPreviewImg(src);
        if (!img.complete || !img.naturalWidth) {
          const ready = () => { if (!dead) paint(); };
          img.addEventListener('load', ready, { once: true });
          if (img.decode) img.decode().then(ready).catch(() => {});
          return;
        }
        const made = makeCardThumb(img, fx);
        if (!made || !made.width || !made.height) return;
        if (cardThumbCache.size > 200) cardThumbCache.clear();
        cardThumbCache.set(cacheKey, made);
        thumb = made;
      }
      if (dead || !ref.current) return;
      cvs.width = thumb.width; cvs.height = thumb.height;
      const ctx = cvs.getContext('2d')!;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(thumb, 0, 0);
      ctx.restore();
    };
    // 一次算 20 幾張會卡住主執行緒，錯開一點點就順了
    const t = setTimeout(paint, delay);
    return () => { dead = true; clearTimeout(t); };
  }, [src, cacheKey, delay]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full object-cover" />;
};

/** 預覽重畫時要馬上有圖可以畫，所以原圖載過一次就留著。 */
const previewImgCache = new Map<string, HTMLImageElement>();
/**
 * 佈局格子的照片。沒有套濾鏡就是原本那張 <img>（完全不變）；
 * 套了就換成 canvas，用跟浮動圖片同一支 applyPhotoFx 算，
 * 外層的裁切、縮放、位移邏輯都不動。
 */
const CellFxImage: React.FC<{
  url: string;
  fx: PhotoFx;
  style: React.CSSProperties;
  lutRevision: number;
  boxW: number;
  boxH: number;
}> = ({ url, fx, style, lutRevision, boxW, boxH }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = getPreviewImg(url);
    const draw = () => {
      if (!img.naturalWidth) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // 算到「畫面上真的有幾個實體像素」，套了濾鏡才不會變糊
      const MAX = Math.min(1600, Math.max(640, Math.round(Math.max(boxW, boxH) * dpr)));
      const ar = img.naturalWidth / img.naturalHeight;
      const w = ar >= 1 ? MAX : Math.max(16, Math.round(MAX * ar));
      const h = ar >= 1 ? Math.max(16, Math.round(MAX / ar)) : MAX;
      const out = applyPhotoFx(img, w, h, fx);
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, w, h);
      g.drawImage(out, 0, 0, w, h);
    };
    if (img.complete && img.naturalWidth) { draw(); return; }
    img.addEventListener('load', draw);
    return () => img.removeEventListener('load', draw);
  }, [url, fx, lutRevision, boxW, boxH]);
  return <canvas ref={ref} style={style} />;
};

const getPreviewImg = (src: string) => {
  let el = previewImgCache.get(src);
  if (!el) {
    el = new Image();
    el.src = src;
    if (previewImgCache.size > 60) previewImgCache.clear();
    previewImgCache.set(src, el);
  }
  return el;
};

interface FloatingImage {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  /** 圖片／圖形透明度，0～100；舊專案未設定時視為 100。 */
  opacity?: number;
  /** 有 text 就是文字圖層。位置、縮放、旋轉、圖層順序全部沿用圖片那一套。 */
  text?: string;
  /**
   * 有值就代表這一層是「符號」而不是一般文字，內容是加進來時挑的那一顆。
   * 兩個用途：① 面板要換成符號那一組（顏色、大小、發光）；
   * ② 在畫布上把字全部刪光時，放回去的是這顆符號本身，
   *    而不是文字用的「輸入文字」。
   */
  sym?: string;
  fontFamily?: string;
  /** 未縮放狀態下的字級（px），實際大小再乘上 scale */
  fontSize?: number;
  /** 四邊擠壓文字時的原始排版盒；字級不變，只改兩軸幾何比例。 */
  textStretchBaseW?: number;
  textStretchBaseH?: number;
  color?: string;
  bold?: boolean;
  /** 斜體。只有該字體真的有斜體字身時才會被打開 */
  italic?: boolean;
  /** 字距（px，未縮放） */
  letterSpacing?: number;
  /** 邊緣發光強度 0~20，0 = 關閉 */
  glow?: number;
  glowColor?: string;
  /** 文字描邊寬度（px，未縮放），0 = 不描邊 */
  strokeWidth?: number;
  strokeColor?: string;
  /** 以下是「圖片調整」分頁的參數，只有圖片圖層會用到 */
  /** 圓角，佔短邊的百分比 0~50（50 = 橢圓） */
  imgRadius?: number;
  /* ── 圖片外形（形狀）──────────────────────────────────────────
     沒有這個欄位＝原本的方形（配上面那根圓角滑桿），行為完全不變。
     設成 circle／star／heart 就改用「新增圖形」那份路徑去裁，
     描邊與發光也會跟著同一條路徑走。 */
  imgShape?: string;
  /** 圖片在形狀裡的位移，-1~1（0＝置中）。只有選了形狀才用得到 */
  imgShapeX?: number;
  imgShapeY?: number;
  /** 圖片在形狀裡的放大倍率，1~5（1＝原大小，也是預設） */
  imgShapeZoom?: number;
  /** 邊緣羽化，佔短邊的百分比 0~50 */
  feather?: number;
  /** 圖片邊緣發光強度 0~20 */
  /** 這一層是影片（預覽用 <video> 播、匯出取當下那一格） */
  isVideo?: boolean;
  imgGlow?: number;
  imgGlowColor?: string;
  /** 濾鏡與調節，跟「編輯」共用同一套像素管線 */
  fx?: PhotoFx;
  /** 圖片描邊（相框線）寬度 px（未縮放）與顏色 */
  imgStrokeWidth?: number;
  imgStrokeColor?: string;
  /** 描邊的虛線長度（0＝實線，1~100 是「一段有幾倍線寬」的比例） */
  imgStrokeDash?: number;
  /** 描邊與圖片輪廓之間的距離 px（未縮放），介面以 0～100 對應 0～10。 */
  imgStrokeGap?: number;
  /** 構圖（裁切／旋轉／翻轉）：baked 之前的原圖與參數，重開構圖時從這裡接續 */
  origSrc?: string;
  geo?: GeoParams;
  /* ── 圖形圖層（新增圖形）─────────────────────────────────────────
     有 shape 就是圖形層：沒有照片、沒有文字，內容就是一條路徑。
     顏色沿用上面的 color（跟文字同一個欄位，色票也是同一組）。 */
  shape?: string;
  /** 新增面板中的來源項目；舊草稿仍可由 shape／filled／holeType 判斷 */
  shapeItemId?: string;
  /** 實心（填色）還是細框（只描邊） */
  shapeFilled?: boolean;
  /** shape === 'hole' 時，真正要畫哪一顆圖案（跟創意拼圖同一份清單） */
  holeType?: string;
  /** 線寬，1 個單位 = 外框長邊的 1/160（滑桿顯示成 1~100，存進來是 ÷10） */
  shapeLineW?: number;
  /** 新增／首次挤压时的线宽基准，挤压只改变轮廓比例、不改变笔画粗细 */
  shapeLineBase?: number;
  /** 点点／星星／爱心纹理的原始坐标系；挤压时整层随宽高变形 */
  shapeTextureBaseW?: number;
  shapeTextureBaseH?: number;
  /** 描邊的虛線長度（0＝實線，1~100 是「一段有幾倍線寬」的比例，跟圖片描邊同一套） */
  shapeDash?: number;
  /** 圖形發光強度 0~100（0＝關）。舊資料存的是 true／false，glowAmount 會相容 */
  shapeGlow?: number | boolean;
  /** 圖形發光的顏色。沒設就用圖形自己的顏色 */
  shapeGlowColor?: string;
  /** 实心基础图形的边缘羽化 0～100。 */
  shapeFeather?: number;
  /** 發光顏色是不是已經給過預設值了（只在第一次打開發光時帶入圖層自己的顏色） */
  glowInit?: boolean;
  /** 圖形的外描邊寬度（跟粗細同一種刻度：存 0~10，滑桿顯示 0~100），0＝不描邊 */
  shapeStrokeW?: number;
  /** 外描邊的顏色，預設黑 */
  shapeStrokeColor?: string;
  /* 圖形上的「點點」。跟創意拼圖那邊同一組參數、同一套網格，
     所以兩個工具調同樣的值，看到的密度與大小是一樣的。 */
  shapeDots?: boolean;
  /** 點點大小 0~100（預設 50） */
  shapeDotSize?: number;
  /** 點點間距 0~100（預設 20） */
  shapeDotGap?: number;
  /** 點點顏色（預設白） */
  shapeDotColor?: string;
  /** 紋理種類：'none' | 'dot' | 'stripe'。沒給就照舊看 shapeDots。 */
  shapeTex?: string;
  /** 條紋粗細 0~100（預設 50） */
  shapeStripeN?: number;
  /** 條紋方向：'h' 橫式（預設）／'v' 直式 */
  shapeStripeDir?: string;
  /** 條紋的兩個顏色 */
  shapeStripeA?: string;
  shapeStripeB?: string;
  /** 經典與創意拼圖共用同一組進場／常駐動畫參數。 */
  mo?: ObjectMotionConfig;
}

type ClassicBrushKind = 'normal' | 'pencil' | 'crayon' | 'dash' | 'highlight';
type ClassicBrushPoint = { x: number; y: number };
interface ClassicBrushStroke {
  id: string;
  kind: ClassicBrushKind;
  points: ClassicBrushPoint[];
  color: string;
  width: number;
  hardness: number;
  z: number;
}

/**
 * 圖形上「點點」的網格參數。預覽（SVG pattern）與匯出（canvas）吃同一支，
 * 兩邊才不可能對不起來；創意拼圖那邊也是同一組式子。
 *   dsz  = (5 + 大小/100 × 15) × 單位
 *   dgap = (40 + 間距) × 單位          單位 = 長邊 / 600
 * 網格是交錯的三角格：偶數列不位移、奇數列往右半格，列距 = 間距 × √3/2。
 */
export const shapeDotGrid = (w: number, h: number, l: {
  shapeDotSize?: number; shapeDotGap?: number; shapeDotColor?: string;
}) => {
  const unit = Math.max(w, h) / 600;
  const dsz = (5 + ((l.shapeDotSize ?? 50) / 100) * 15) * unit;
  const dgap = (40 + (l.shapeDotGap ?? 20)) * unit;
  return { r: dsz / 2, dx: dgap, dy: dgap * Math.sqrt(3) / 2, color: l.shapeDotColor || '#FFFFFF' };
};

/** 匯出時把點點畫上去（原點在圖形中心）。呼叫端負責先剪裁在圖形裡面。 */
export const drawShapeDotsCanvas = (
  c: CanvasRenderingContext2D, w: number, h: number, l: any,
) => {
  const { r, dx, dy, color } = shapeDotGrid(w, h, l);
  c.fillStyle = color;
  const rx = Math.ceil(w / dx) + 2, ry = Math.ceil(h / dy) + 2;
  for (let j = -ry; j <= ry; j++) {
    const shiftX = Math.abs(j) % 2 === 1 ? dx / 2 : 0;
    for (let i = -rx; i <= rx; i++) {
      c.beginPath();
      c.arc(i * dx + shiftX, j * dy, r, 0, Math.PI * 2);
      c.fill();
    }
  }
};

type SwapSource = { kind: 'cell'; idx: number; src: string } | { kind: 'floating'; id: string; src: string };
type SwapTarget = { kind: 'cell'; idx: number; layoutId?: string } | { kind: 'floating'; id: string };

interface FloatingImageComponentProps {
  image: FloatingImage;
  isSelected: boolean;
  /** 第二段選取：選中的是「形狀」而不是整張圖片（外框改成貼著形狀、角球收起來） */
  shapeSelected?: boolean;
  /** 滑鼠按在這張圖上（觸控走畫布層級那條，不會叫這支）。座標交給外面判斷在不在形狀裡 */
  onShapeTap?: (clientX: number, clientY: number) => void;
  onSelect: () => void;
  onChange: (updated: Partial<FloatingImage>) => void;
  onDelete: () => void;
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  /** 畫布目前真正套用的縮放倍率（使用者雙指縮放預覽用的那個）。
      手指走的是螢幕像素、物件的座標是未縮放的內容單位，兩者要靠它換算。 */
  canvasKRef?: React.RefObject<number>;
  /** 已提交的預覽倍率；只用來在縮放手勢結束後重建高清 Canvas backing store。 */
  canvasScale?: number;
  hasActiveGuidelines?: boolean;
  onDragStart?: () => void;
  onDragMove?: (rawX: number, rawY: number) => void;
  onDragEnd?: () => void;
  onScaleStart?: () => void;
  onScaleMove?: (
    newX: number,
    newY: number,
    newScale: number,
    corner?: 'tl' | 'tr' | 'bl' | 'br',
    pivotContainerX?: number,
    pivotContainerY?: number,
    K_x?: number,
    K_y?: number,
    oppositeLocalX?: number,
    oppositeLocalY?: number
  ) => void;
  /** 四邊擠壓的候選幾何；外層負責吸附並回寫，固定對邊的基準一併傳出。 */
  onStretchMove?: (
    next: Partial<FloatingImage>,
    side: 't' | 'r' | 'b' | 'l',
    base: { x: number; y: number; width: number; height: number; rotationRad: number }
  ) => void;
  onScaleEnd?: () => void;
  isSwapTarget?: boolean;
  isSwapSource?: boolean;
  stackIndex?: number;
  onLayerAction?: (action: 'up' | 'down' | 'delete' | 'copy' | 'edit') => void;
  canLayerUp?: boolean;
  canLayerDown?: boolean;
  /** 下方空間不夠時把工具列翻到物件上方 */
  toolbarAbove?: boolean;
  /** 文字圖層自動貼合寬度時的上限（未縮放像素） */
  maxTextWidth?: number;
  /** 固定向量畫布需要的頁面高度（與 maxTextWidth 同為內容座標）。 */
  canvasHeight?: number;
  /** 直接在畫布上打字：選中後再點一次就進入這個狀態 */
  isTextEditing?: boolean;
  onTextEditEnd?: () => void;
  /** 雙指縮放／旋轉進行中：工具列先收起來 */
  hideToolbar?: boolean;
  /** 文字／符號／圖形正在雙指縮放：改用固定畫布、逐幀重畫內容。 */
  gestureRendering?: boolean;
  /** 正在拖形狀的滑桿：選取框、四角圓球、工具列全部收起來，邊緣的效果才看得清楚 */
  hideChrome?: boolean;
  /** 濾鏡載完會 +1，用來讓已經套用濾鏡的圖層重畫 */
  lutRevision?: number;
  /** 沒有選取任何東西時交回 pan-x，橫向捲動就由瀏覽器處理，手感跟空白處一致 */
  touchMode?: 'none' | 'pan-x';
  /**
   * 排頁面拖曳中，這一層要跟著自己那一頁一起移動（順便跟著那一頁整組縮小）。
   * live = 正在被手指拖的那一頁（不加動畫），其餘是讓開的頁面（200ms 滑過去）。
   */
  dragShift?: { tx: number; ty: number; s: number; live: boolean } | null;
  onSwapTouchStart?: (e: React.TouchEvent) => void;
  onSwapTouchMove?: (e: React.TouchEvent) => void;
  onSwapTouchEnd?: (e: React.TouchEvent) => void;
  /**
   * 選取框、四角圓球、工具列要改掛到這一層去畫。
   * 這一層是「頁面容器的兄弟」，不在那個 overflow-hidden 底下，
   * 所以物件被拖出畫布邊緣時，框跟按鈕不會被邊緣的黑色切掉 ——
   * 但物件本身仍然留在原本會被裁切的那一層，超出畫布的部分照樣看不到。
   * 拿不到這一層時就退回原本的畫法（掛在自己身上），行為完全不變。
   */
  chromeLayer?: HTMLElement | null;
  /** 動畫頁當下這一格；選中框不吃這個變形，避免跟著動畫跳動。 */
  motionFrame?: ObjectMotionFrame | null;
  /** 動畫頁只允許點選目標，不允許移動、縮放、旋轉或換位。 */
  motionPickOnly?: boolean;
  /** 切換動畫目標時短暫顯示的虛線提示框。 */
  motionTargetFlash?: number | null;
  /** 經典動畫頁暫停時，同步暫停可見的影片節點。 */
  videoPaused?: boolean;
}

let globalDragPointerId: number | null = null;

/* ── 影片的描邊與發光 ────────────────────────────────────────────────
   這兩樣**完全不需要影片的畫素**：
     描邊 —— 沿著形狀的輪廓描一圈線，只跟形狀有關；
     發光 —— 光暈只看「輪廓外面多遠」，makeGlowCanvas 讀的也只有 alpha。
   所以兩張都可以在「形狀／粗細／顏色」變動時各算一次就留著，
   之後每一格影格都不用再碰它們 —— 逐格成本是 0。

   為什麼不能像照片那樣直接畫進那張 2D 形狀畫布：那條路的第一個動作是
   drawImage(影片來源)，1080p 一次 20.9 毫秒；套了濾鏡的話來源還是 GPU 畫布，
   一次 104 毫秒（等於把畫面從顯示卡讀回 CPU）。這裡改成「影片照舊交給
   瀏覽器合成，描邊與發光是兩張靜態畫布疊在它前後」，
   算式（withImgOutline／makeGlowCanvas）跟照片與匯出用的是同一份。 */
const videoDeco = (
  image: any, boxW: number, boxH: number, dpr: number,
): { glow: HTMLCanvasElement | null; stroke: HTMLCanvasElement | null; pad: number } => {
  const empty = { glow: null, stroke: null, pad: 0 };
  if (!boxW || !boxH) return empty;
  /* 版面已經縮放過的地方（IG 預覽、頁面縮圖）傳進來的 boxW 是縮過的，
     所以粗細與光暈也要跟著同一個倍率，不然縮圖上的線會比較粗。 */
  const kk = (image.width && image.scale) ? boxW / (image.width * image.scale) : 1;
  const sc = (image.scale || 1) * kk;
  const strokeW = (image.imgStrokeWidth || 0) * sc;
  const glowAmt = image.imgGlow || 0;
  if (!strokeW && !glowAmt) return empty;
  const pad = Math.round(((glowAmt ? Math.ceil(GLOW_BLUR_UNIT * GLOW_EXTENT) : 0)
    + (image.imgStrokeWidth ? 20 : 0)) * sc);
  const W = Math.max(1, Math.round((boxW + pad * 2) * dpr));
  const H = Math.max(1, Math.round((boxH + pad * 2) * dpr));
  const iw = Math.max(1, Math.round(boxW * dpr));
  const ih = Math.max(1, Math.round(boxH * dpr));
  const lw = strokeW * dpr;
  const strokeGap = (image.imgStrokeGap || 0) * sc * dpr;
  const sw = iw + (lw + strokeGap) * 2, sh = ih + (lw + strokeGap) * 2;
  const ox = (W - sw) / 2, oy = (H - sh) / 2;
  const kind = image.imgShape as string | undefined;
  const dashV = image.imgStrokeDash || 0;

  /** 描邊那一圈（照片那條路是畫在 lw/2 的框上，線整條長在圖片外面） */
  const paintStroke = (g: CanvasRenderingContext2D, dx: number, dy: number) => {
    if (lw <= 0) return;
    const rp = image.imgRadius || 0;
    const sr = rp ? cornerR(rp, iw, ih) + strokeGap + lw / 2 : 0;
    g.save();
    g.translate(dx, dy);
    withImgOutline(g, lw / 2, lw / 2, iw + strokeGap * 2 + lw, ih + strokeGap * 2 + lw, kind, sr, sr, p => {
      g.lineWidth = lw;
      g.lineJoin = 'miter';
      g.miterLimit = 4;
      if (dashV > 0) {
        const seg = lw * (0.6 + (dashV / 100) * 4);
        g.setLineDash([seg, seg * 0.85]);
        g.lineCap = 'butt';
      } else {
        g.setLineDash([]);
      }
      g.strokeStyle = image.imgStrokeColor || '#FFFFFF';
      p ? g.stroke(p) : g.stroke();
      g.setLineDash([]);
    });
    g.restore();
  };

  /* ① 描邊：只有線，疊在影片前面 */
  let stroke: HTMLCanvasElement | null = null;
  if (lw > 0) {
    stroke = document.createElement('canvas');
    stroke.width = W; stroke.height = H;
    const g = stroke.getContext('2d');
    if (g) paintStroke(g, ox, oy); else stroke = null;
  }

  /* ② 發光：先做一張「形狀＋描邊」的剪影（只有 alpha 有用），
        再交給跟照片、匯出同一支 makeGlowCanvas。光暈疊在影片後面。 */
  let glow: HTMLCanvasElement | null = null;
  if (glowAmt) {
    const sil = document.createElement('canvas');
    sil.width = Math.max(1, Math.round(sw));
    sil.height = Math.max(1, Math.round(sh));
    const sg = sil.getContext('2d');
    if (sg) {
      sg.fillStyle = '#fff';
      sg.fillRect(lw, lw, iw, ih);
      if (image.feather || image.imgRadius || isImgShaped(kind)) {
        sg.globalCompositeOperation = 'destination-in';
        if (image.feather) {
          sg.drawImage(previewMask(boxW / boxH, image.imgRadius || 0, image.feather, kind), lw, lw, iw, ih);
        } else {
          const R = cornerR(image.imgRadius || 0, iw, ih);
          withImgOutline(sg, lw, lw, iw, ih, kind, R, R, p => {
            sg.fillStyle = '#fff';
            p ? sg.fill(p) : sg.fill();
          });
        }
        sg.globalCompositeOperation = 'source-over';
      }
      paintStroke(sg, 0, 0);
      const gk = Math.min(1, 420 / Math.max(W, H));
      glow = makeGlowCanvas(
        sil, W * gk, H * gk, ox * gk, oy * gk, sw * gk, sh * gk,
        (glowAmt / 20) * GLOW_BLUR_UNIT * sc * dpr * gk,
        image.imgGlowColor || '#FFFFFF',
      );
    }
  }
  return { glow, stroke, pad };
};

/** 把一張算好的裝飾畫布擺到「比影片框大 pad 一圈」的位置 */
const DecoCanvas: React.FC<{ cv: HTMLCanvasElement; pad: number; w: number; h: number }> = ({ cv, pad, w, h }) => {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.display = 'block';
    el.appendChild(cv);
    return () => { try { el.removeChild(cv); } catch { /* 已經不在了 */ } };
  }, [cv]);
  return (
    <div
      ref={host}
      style={{
        position: 'absolute', left: `${-pad}px`, top: `${-pad}px`,
        width: `${w + pad * 2}px`, height: `${h + pad * 2}px`, pointerEvents: 'none',
      }}
    />
  );
};

/**
 * 影片圖層的畫面。
 *
 * 沒有裁切過就是原本那一行 <video> —— 一個像素都沒動。
 * 裁切／轉角度／翻轉過的話，就把構圖那組參數換成一個 CSS 的 matrix()
 * 套在 <video> 上，外層再用 overflow:hidden 把框外的部分切掉。
 * 用的是跟匯出完全同一個矩陣（utils/compose 的 geoAffine），
 * 所以「預覽看到的」與「匯出畫出來的」不可能對不起來。
 *
 * 刻意**不**把影片逐格畫進 canvas：那樣每一格都要 drawImage 一次整張，
 * 手機會燙；交給瀏覽器自己合成則幾乎不花 CPU，而且維持原生解析度。
 */
const VideoLayer: React.FC<{
  image: any; boxW: number; boxH: number;
  /** 外層的版面樣式（位置／大小）。裁切過的時候會套在那個 overflow:hidden 的框上。 */
  style?: React.CSSProperties;
  /** 套了效果時，這個 <video> 只當 GPU 的來源 —— 讓外面拿得到它，不要再開第二份解碼 */
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /** 第一格解出來了 */
  onReady?: () => void;
  /** 成品已經改由上面那張 canvas 顯示了，這一層就讓開（但**不能**卸載，卸載＝停止解碼） */
  hidden?: boolean;
  /**
   * 套了濾鏡／調節時，畫面上顯示的不是 <video> 本人，而是這張 GPU 畫布。
   * 它跟 <video> **套完全一樣的版面與變換** —— 裁切、旋轉、翻轉那一整套
   * 幾何完全沿用下面既有的那份（geoCssBox），一行都沒有另外算，
   * 所以「有沒有套濾鏡」不可能讓影片跑位。
   */
  glCanvas?: HTMLCanvasElement | null;
  /** 動畫頁暫停時，真正顯示在畫面上的這個節點也必須停住。 */
  paused?: boolean;
}> = ({ image, boxW, boxH, style, videoRef, onReady, hidden, glCanvas, paused = false }) => {
  const ref = useRef<HTMLVideoElement>(null);
  /* ── 形狀（圓角／外形／羽化）──────────────────────────────────────
     用 CSS 遮罩，來源是 previewMask —— **跟圖片那條路、跟匯出用的是同一支
     makeShapeMask**，所以邊緣與羽化的衰減曲線一模一樣，不是另外做一套。
     為什麼用 CSS 而不是畫在 canvas 上：影片的成品是交給瀏覽器合成的，
     一旦為了套形狀而把它畫進 2D 畫布，就等於把畫面從顯示卡讀回 CPU
     （實測一次 104 毫秒）。CSS 遮罩是合成器做的，不用回讀，而且
     **沒套濾鏡的影片也一樣有效**（那條路根本沒有 GPU 畫布）。 */
  const shapeKind = image.imgShape as string | undefined;
  const radiusPct = image.imgRadius || 0;
  const featherPct = image.feather || 0;
  /* 形狀怎麼表達交給 shapeParts —— 「拖曳互換時那層變暗」用的是同一支，
     所以暗下去的形狀跟影片現在的形狀一定一樣。
     單純圓角走 border-radius：不用解碼任何圖，拖滑桿就不會閃。 */
  const { cssRadius, maskUrl } = useMemo(
    () => shapeParts(image, boxW, boxH),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxW, boxH, radiusPct, featherPct, shapeKind],
  );
  /* 遮罩圖要**解碼完才換上去**。直接換的話，瀏覽器在解碼那幾十毫秒裡
     手上沒有遮罩可用，那一層就整個不見 —— 拖滑桿時就是一直閃。
     解碼中先沿用上一張；第一次還沒有上一張，那就維持「完全沒有遮罩」
     （也就是原本的方框），不會消失。 */
  const [liveMask, setLiveMask] = useState('');
  const liveMaskRef = useRef('');
  liveMaskRef.current = liveMask;
  useEffect(() => {
    if (!maskUrl) { setLiveMask(''); return; }
    let alive = true;
    /* 再壓一層 40ms 的合併：拖羽化滑桿時一秒會來六十個新數字，
       每一個都去編一張 PNG 再解碼，畫面就一路卡著。

       ⚠ **第一次**不進這個合併（手上還沒有任何遮罩可以頂著）。
       原本不分第一次：拉下羽化之後要等 40 毫秒＋解碼才會有遮罩，而這段時間
       滑桿已經被拖到十幾了 —— 邊緣是「先完全不變，然後一次跳成很柔」，
       那一下看起來就是畫面閃了一下。第一張立刻做，之後才需要合併。 */
    const wait = liveMaskRef.current ? 40 : 0;
    const t = window.setTimeout(() => {
      const im = new Image();
      const done = () => { if (alive) setLiveMask(maskUrl); };
      /* decode() 比 onload 保險：onload 只保證「載進來了」，
         真正畫上去之前還要解一次碼 —— WebKit 在那一小段裡拿不到遮罩內容，
         整層會被當成「遮罩全黑」而不見。decode() 是解完才回來。 */
      im.src = maskUrl;
      if (typeof (im as any).decode === 'function') (im as any).decode().then(done, done);
      else { im.onload = done; im.onerror = done; }
    }, wait);
    return () => { alive = false; window.clearTimeout(t); };
  }, [maskUrl]);
  const maskCss: React.CSSProperties = liveMask
    ? {
      WebkitMaskImage: `url(${liveMask})`, maskImage: `url(${liveMask})`,
      WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
      WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    }
    : {};
  /* 同一個元素同時交給裡面的 ref 與外面的 videoRef */
  const setRef = (el: HTMLVideoElement | null) => {
    (ref as any).current = el;
    if (videoRef) videoRef.current = el;
  };
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (paused) video.pause();
    else video.play().catch(() => { /* 等待下一次使用者互動 */ });
  }, [paused, image.src]);
  /* ── 圖片在形狀裡的位置與縮放（imgShapeX／Y／Zoom）──────────────────
     照片那條路是 drawImgBase 在畫的時候套上去的；影片沒有經過那一支，
     所以以前「套了形狀之後怎麼拖都不會動」。這裡用完全同一條算式，
     只是換成 CSS：先開一個「形狀視窗」把影片按那個位置與大小擺好，
     外面那層再用形狀遮罩切出來。倍率 1、沒位移時，這個視窗剛好等於整個框。 */
  const shaped = isImgShaped(shapeKind);
  const shapeZoom = shaped ? clampImgZoom((image as any).imgShapeZoom) : 1;
  const innerW = boxW * shapeZoom;
  const innerH = boxH * shapeZoom;
  const shapeOff = (() => {
    if (!shaped) return { left: 0, top: 0 };
    const { rx, ry } = imgShapePan(boxW, boxH, shapeZoom);
    const cl = (v: any) => Math.max(-1, Math.min(1, Number(v) || 0));
    return {
      left: (boxW - innerW) / 2 + cl((image as any).imgShapeX) * rx,
      top: (boxH - innerH) / 2 + cl((image as any).imgShapeY) * ry,
    };
  })();

  const geo: GeoParams | undefined = image.geo;
  const cropped = !!geo && !isGeoIdentity(geo);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !cropped) return;
    const on = () => { if (v.videoWidth) setNat({ w: v.videoWidth, h: v.videoHeight }); };
    on();
    v.addEventListener('loadedmetadata', on);
    return () => v.removeEventListener('loadedmetadata', on);
  }, [cropped, image.src]);
  /* 這裡是 fill 不是 contain：匯出是 drawImage(src, x, y, w, h)，直接把圖填滿
     整個框、不留信箱邊。預覽如果用 contain，只要圖層框的長寬比跟原圖差一點點
     （匯入時取整就會差），四周就會多出零點幾 px 的空白 —— 貼齊畫布邊緣時那就
     是一條白縫，而匯出沒有。用 fill 才跟匯出一致。 */
  /* ⚠ 影片與 GPU 畫布是**疊在一起**的兩層，所以兩個都要絕對定位。
     以前影片「讓開」時會被改成 position:absolute，畫布才會回到左上角；
     現在讓開只動透明度、影片一直在原位，要是還照文件流排，
     畫布就會被擠到影片正下方（實測整整低了一個圖層的高度）。 */
  const plain: React.CSSProperties = style
    ? { ...style, objectFit: 'fill', pointerEvents: 'none' }
    : { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' };
  const box = cropped && nat && innerW > 0 && innerH > 0
    ? geoCssBox(nat.w, nat.h, geo!, innerW, innerH)
    : null;
  /* 讓開只在「GPU 那張畫布真的在場」時才成立。
     以前只看 hidden（＝glLive），而把濾鏡按回「原始」的那一格，
     glCanvas 已經變成 null、glLive 卻還是 true —— 影片被藏起來、
     畫布又不在，畫面就空了（實測連續空白 120 毫秒）。 */
  const stepAside = !!hidden && !!glCanvas;
  /* ⚠ 讓開＝**什麼都不做**：影片一直在原位、一直是不透明的，
     只是被上面那張不透明的 GPU 畫布整片蓋住。

     為什麼可以這樣：這條路從來不把形狀遮罩交給 WebGL（videoGl 的 setMask
     一次都沒被呼叫過），形狀與羽化是套在**外面那一層**的 CSS 遮罩上的，
     影片與畫布一起被裁 —— 所以畫布必定是整片不透明的，底下的影片
     一個像素都露不出來。
     這樣做的好處是：萬一哪一格畫布是空的（著色器剛換、材質剛配好、
     軟體合成偶爾漏一格），看到的會是**底下那格影片**，而不是頁面的底色。
     那正是「第一次套特效會黑一下」的最後一個來源。

     （再往前一版是把影片縮成 1×1 想省合成成本。那會讓合成器手上留著
       「1 像素的那一層」再放大到整個框，換回來的那一格畫面就被拉得很扁 ——
       也就是「濾鏡切回原始時影片突然變扁」；尺寸一變也是一次版面變動，
       影片那一層要重新配置，中間會空一格。所以現在連大小都不動。） */
  const vid = (
    <video
      ref={setRef}
      src={image.src}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      onLoadedData={onReady}
      style={box
        ? {
          position: 'absolute', left: 0, top: 0,
          width: `${box.width}px`, height: `${box.height}px`,
          /* Tailwind 的 preflight 給 img/video 掛了 max-width:100%，
             那會把「來源原始寬度」直接夾成外框那麼寬 —— 變換算得再對，
             畫出來的還是錯的（實測 480px 被夾成 160px）。這裡要明講不要夾。 */
          maxWidth: 'none', maxHeight: 'none',
          transformOrigin: '0 0', transform: box.transform,
          pointerEvents: 'none',
        }
        : plain}
    />
  );
  /* GPU 畫布：跟上面那個 <video> 套同一份 style。
     ⚠ 它是 WebGL 畫布，**絕對不能**被 drawImage 到 2D 畫布上 ——
     那會強迫把畫面從顯示卡讀回 CPU，實測一次 104 毫秒，整個優勢就沒了。
     所以這裡是「直接掛在畫面上讓瀏覽器合成」，中間沒有任何一次回讀。 */
  /* ⚠ 畫布在「還沒畫出任何東西」之前是**看不見**的。
     它一被掛上去就是蓋在影片上面的一層，而剛建立的 WebGL 畫布是
     300×150 的空緩衝區（實測：掛上去 33 毫秒之後才第一次畫）——
     那 33 毫秒它蓋著影片、自己又什麼都沒有，就是「第一次套濾鏡／套特效時
     閃黑一下」。畫出第一格（glLive）之後才顯形，中間完全看不到破綻。
     反過來也一樣：哪一格畫不出來（著色器還在編、材質還沒配好）就自動退回
     看不見，底下那個 <video> 立刻接手，不會露出背景。 */
  const glHost = glCanvas ? (
    <GlCanvasHost
      canvas={glCanvas}
      style={box
        ? {
          position: 'absolute', left: 0, top: 0,
          width: `${box.width}px`, height: `${box.height}px`,
          maxWidth: 'none', maxHeight: 'none',
          transformOrigin: '0 0', transform: box.transform,
          pointerEvents: 'none',
          opacity: stepAside ? 1 : 0,
        }
        : { ...plain, opacity: stepAside ? 1 : 0 }}
    />
  ) : null;

  const innerRaw = glHost ? <>{vid}{glHost}</> : vid;
  /* 形狀視窗。沒有形狀時（shaped=false）它剛好等於整個框，
     等同於以前直接放 inner，一個像素都沒有變。 */
  const inner = (
    <div
      style={{
        position: 'absolute',
        left: `${shapeOff.left}px`, top: `${shapeOff.top}px`,
        width: `${innerW}px`, height: `${innerH}px`,
        pointerEvents: 'none',
      }}
    >
      {innerRaw}
    </div>
  );

  /* 描邊與發光。兩張都只跟形狀有關，所以只在那幾個值變動時才重算 ——
     影格再怎麼跑都不會碰到它們。 */
  const deco = useMemo(
    () => videoDeco(image, boxW, boxH, Math.min(2, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxW, boxH, image.imgStrokeWidth, image.imgStrokeColor, image.imgStrokeDash, image.imgStrokeGap,
      image.imgGlow, image.imgGlowColor, image.imgRadius, image.feather, image.imgShape,
      image.scale, image.width, image.height],
  );

  /* ⚠ 這裡**只有一種回傳結構**，而且不管有沒有形狀／描邊／發光都一樣。
     以前是依情況回傳三種不同深度的樹（裸 <video>／包一層／包兩層）——
     只要在這幾種之間切換，React 就會把 <video> 拆掉重建，
     而重建一個 <video> 等於重新載入：畫面會空一下、播放也從頭來。
     那正是「調整影片時它一直短暫消失」的其中一個來源。
     結構固定之後，切換效果只是換樣式，<video> 從頭到尾是同一個節點。

     外層只負責定位；中間那層才是原本那個 overflow:hidden ＋ 遮罩的盒子；
     發光在影片底下、描邊在影片上面（跟匯出的疊法一致）。
     光暈與描邊會長到框外面，所以它們**不能**放進中間那層。 */
  return (
    <div
      style={style
        ? { ...style, pointerEvents: 'none' }
        : { position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {deco.glow ? <DecoCanvas cv={deco.glow} pad={deco.pad} w={boxW} h={boxH} /> : null}
      {/* 遮罩那張圖也掛一份在畫面上（1px、看不見）。
          上面雖然已經等 decode() 解完才換上去，但解好的那張只活在一個區域變數裡，
          回收之後 CSS 再要就得重解一次 —— 重解的那一小段 WebKit 會把整層當成
          「遮罩是空的」而不見，也就是羽化偶爾閃一下。掛著就一直是解好的狀態。 */}
      {liveMask ? (
        <img src={liveMask} alt="" aria-hidden="true"
             style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      ) : null}
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
          /* 裁切過就要切掉框外的部分；單純圓角用 border-radius ＋ overflow 夾住，
             不必動用圖片遮罩（見上面 cssRadius 的說明）。 */
          /* 套了形狀又放大時，多出來的部分也在這裡切掉（遮罩本來就會擋，
             這一行是保險，免得放大很多倍時蓋到隔壁圖層）。 */
          overflow: (box || cssRadius || shaped) ? 'hidden' : undefined,
          borderRadius: cssRadius,
          pointerEvents: 'none',
          ...maskCss,
        }}
      >
        {inner}
      </div>
      {deco.stroke ? <DecoCanvas cv={deco.stroke} pad={deco.pad} w={boxW} h={boxH} /> : null}
    </div>
  );
};

/**
 * 影片的顏色鏈（濾鏡／調節）交給 GPU。
 *
 * 每來一格新影格就上一次材質、查一次烤好的 33³ 色表、畫在自己的畫布上，
 * 那張畫布**直接掛在版面上讓瀏覽器合成** —— 全程沒有任何一次回讀。
 *
 * 用 requestVideoFrameCallback 而不是 rAF：它是「真的有新影格才叫我」，
 * 所以 25fps 的素材就畫 25 次，不會為了同一格畫兩遍。
 * 舊 Safari 沒有這支就退回 rAF，行為一樣，只是會多畫幾次。
 *
 * （這一段本來直接寫在 FloatingImageComponent 裡面，內容一行都沒有改，
 *   只是拉出來變成一支具名的 hook，讀起來清楚一點。）
 */
const useVideoFxGl = (
  videoRef: React.MutableRefObject<HTMLVideoElement | null>,
  fx: any, lutRevision: number, boxW: number, boxH: number, dpr: number,
  want: boolean,
) => {
  const glRef = useRef<VideoGl | null>(null);
  const glFxKeyRef = useRef('');
  /** 特效那一串自己的鍵（跟顏色分開） */
  const glFxOnlyKeyRef = useRef('');
  /** 上一次換數值的時間 —— 手停下來之後才補完整的那顆表 */
  const fxChangedAtRef = useRef(0);
  /** 現在手上這顆是不是「拖曳用的粗表」 */
  const fxCoarseRef = useRef(false);
  const glLiveRef = useRef(false);
  /** 連續畫成功幾格了 —— 要滿三格才讓畫布顯形（見下面的說明） */
  const glReadyRef = useRef(0);
  const [glDead, setGlDead] = useState(false);
  const [glLive, setGlLive] = useState(false);
  const [glCanvas, setGlCanvas] = useState<HTMLCanvasElement | null>(null);
  const on = want && !glDead;
  /* fx 是個物件，每次 render 都是新的一份 —— 直接放進相依陣列的話，
     這支 effect 每一次 render 都會被拆掉重建，而重建會立刻再跑一次 step()。
     拖滑桿時 React 一秒 render 六十次，於是烤表也跟著變成一秒六十次。
     改成只認「內容有沒有變」的字串，值本身用 ref 拿最新的。 */
  const fxKey = JSON.stringify(fx || null);
  const fxRef = useRef(fx);
  fxRef.current = fx;
  /* 效果被清光時把旗子放掉：下次再套效果，底下的 <video> 要能先頂著，
     不然會有一格空白。 */
  if (!want && glLiveRef.current) glLiveRef.current = false;
  /* 這一層收掉時把 GL 上下文一起收掉。不收的話每個影片圖層都佔著一個，
     瀏覽器對同時存在的 WebGL 上下文數量是有上限的（超過就整批被收走）。 */
  useEffect(() => () => { glRef.current?.dispose(); glRef.current = null; }, []);
  useEffect(() => {
    if (!on) {
      glReadyRef.current = 0;
      if (glLiveRef.current) { glLiveRef.current = false; setGlLive(false); }
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    let gl = glRef.current;
    if (!gl) {
      gl = VideoGl.create();
      if (!gl) { setGlDead(true); return; }
      glRef.current = gl;
      glFxKeyRef.current = '';
      setGlCanvas(gl.canvas);
    }
    let live = true;
    let handle = 0;
    const anyV = v as any;
    const useRvfc = typeof anyV.requestVideoFrameCallback === 'function';
    const step = () => {
      if (!live || !gl) return;
      if (gl.lost) { setGlDead(true); return; }
      /* ── 查色表只在「換濾鏡／動滑桿」時重烤，跟影格數無關 ──────────────
         但「動滑桿」時每一格都會換一次數值，而烤一顆 33³ 的表在手機等級的
         CPU 上要 8～11 毫秒（強度不是 100 時要烤兩顆，×2）——
         一秒 30 格就吃掉三分之一條主執行緒，那正是「影片的調整滑桿很卡」。

         改成兩段：手指在動的時候烤 17³（只要十分之一的成本，肉眼看不出差別），
         停下來 180 毫秒之後再補一顆完整的 33³。
         所以「拖的時候順、放手之後精準」，而匯出永遠走的是另一條完整的路。 */
      const cur = fxRef.current;
      /* ⚠ 只認「顏色」那幾個欄位。以前是整包 fx 當鍵，所以拖特效強度、圓角、
         羽化這些跟顏色無關的滑桿時，每一格也會重烤一顆表（白花 8～11 毫秒）。 */
      const key = `${colorKeyOf(cur)}|${lutRevision}`;
      const now = performance.now();
      if (key !== glFxKeyRef.current) {
        glFxKeyRef.current = key;
        fxChangedAtRef.current = now;
        fxCoarseRef.current = true;
        gl.setLut(bakePhotoFxLut(cur, 17));
        /* 特效（朦朧／動態模糊／VHS／馬賽克…）：它們不是顏色，塞不進查色表，
           所以另外交給 videoGl 的特效鏈跑（跟照片同一份著色器）。 */
      }
      /* 特效那一串跟顏色是兩回事，各自認自己的鍵 */
      const fk = JSON.stringify(cur || null);
      if (fk !== glFxOnlyKeyRef.current) {
        glFxOnlyKeyRef.current = fk;
        gl.setFx(cur, getNoisePattern());
      }
      if (fxCoarseRef.current && now - fxChangedAtRef.current > 180) {
        fxCoarseRef.current = false;
        gl.setLut(bakePhotoFxLut(cur, 33));
      }
      /* 畫出來的大小＝畫面上真正的實體像素。裁切過的話，版面是把「整格」
         放大之後再用 overflow 切，所以這裡要照那個放大後的尺寸開。
         幾何完全交給 VideoLayer 既有的那份 CSS（geoCssBox），這裡只管像素。 */
      /* ⚠ 尺寸**只能**問「這張畫布真正被擺在哪個框裡」。
         以前量不到就退回 boxW/boxH（圖層框）—— 但裁切過的圖層，那兩個數字
         跟畫布實際被拉伸到的大小長寬比是不一樣的，畫出來就被壓扁。
         而「量不到」是真的會發生：把濾鏡切回原始時這張畫布會被拔下來，
         下次再套濾鏡的那一格它還沒被掛回去，parentElement 就是 null。
         現在改成量不到就這一格不畫（底下的 <video> 還在頂著，畫面照常）。 */
      const el = gl.canvas.parentElement;
      const cw = el ? el.clientWidth : 0;
      const ch = el ? el.clientHeight : 0;
      if (cw > 0 && ch > 0) {
        const w = Math.max(1, Math.round(cw * dpr));
        const h = Math.max(1, Math.round(ch * dpr));
        /* 「畫出來了沒」要**每一格**都跟著走，不是只認第一次成功。
           特效剛打開的那幾格著色器還在編、材質還沒配好，drawFrame 會回 false
           而畫布是被清空的 —— 這時候一定要讓底下的 <video> 回來頂著，
           不然那一格看到的是背景色（黑底就是閃黑）。

           ⚠ 「顯形」還要多等兩格。畫布是新長出來的一層，合成器第一次
           把它排進畫面時那一格是黑的（實測：第一次套特效必定黑一格，
           第二次以後完全不會 —— 因為那時候這一層早就在了）。
           讓它先在**看不見**的狀態下被畫上兩三格，合成器把這一層準備好之後
           才顯形，那一格黑就發生在沒人看得到的時候。
           反過來一失敗就立刻收回去，不必等。 */
        const ok = gl.drawFrame(v, w, h);
        if (!ok) {
          glReadyRef.current = 0;
          if (glLiveRef.current) { glLiveRef.current = false; setGlLive(false); }
        } else {
          if (glReadyRef.current < 3) glReadyRef.current++;
          const show = glReadyRef.current >= 3;
          if (show !== glLiveRef.current) { glLiveRef.current = show; setGlLive(show); }
        }
        handle = useRvfc ? anyV.requestVideoFrameCallback(step) : requestAnimationFrame(step);
        return;
      }
      /* 還沒掛上去：用 rAF 再問一次（不能用 rVFC —— 影片停著就永遠等不到下一格） */
      handle = requestAnimationFrame(step);
    };
    step();
    return () => {
      live = false;
      try {
        if (useRvfc) anyV.cancelVideoFrameCallback?.(handle);
        else cancelAnimationFrame(handle);
      } catch { /* 收不掉就算了 */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, fxKey, lutRevision, boxW, boxH, dpr, videoRef]);
  return { glCanvas: on ? glCanvas : null, glLive, glDead };
};

/** 把一張「不是 React 生的」畫布掛進版面裡，樣式照給。 */
const GlCanvasHost: React.FC<{ canvas: HTMLCanvasElement; style: React.CSSProperties }> = ({ canvas, style }) => {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = host.current;
    if (!h) return;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    h.appendChild(canvas);
    return () => { try { h.removeChild(canvas); } catch { /* 已經不在了 */ } };
  }, [canvas]);
  return <div ref={host} style={style} />;
};

const FloatingImageComponent: React.FC<FloatingImageComponentProps> = ({
  image,
  isSelected,
  shapeSelected,
  onShapeTap,
  onSelect,
  onChange,
  onDelete,
  pagesContainerRef,
  canvasKRef,
  canvasScale = 1,
  hasActiveGuidelines = false,
  onDragStart,
  onDragMove,
  onDragEnd,
  onScaleStart,
  onScaleMove,
  onStretchMove,
  onScaleEnd,
  isSwapTarget = false,
  isSwapSource = false,
  stackIndex = 0,
  onLayerAction,
  canLayerUp = true,
  canLayerDown = true,
  toolbarAbove,
  maxTextWidth,
  canvasHeight,
  isTextEditing = false,
  onTextEditEnd,
  hideToolbar = false,
  gestureRendering = false,
  hideChrome = false,
  lutRevision = 0,
  touchMode = 'none',
  dragShift = null,
  onSwapTouchStart,
  onSwapTouchMove,
  onSwapTouchEnd,
  chromeLayer = null,
  motionFrame = null,
  motionPickOnly = false,
  motionTargetFlash = null,
  videoPaused = false,
}) => {
  const imageRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isScaling, setIsScaling] = useState(false);
  
  const dragStart = useRef<{ pointerId: number; startX: number; startY: number; imgX: number; imgY: number } | null>(null);
  const rotateStart = useRef<{ pointerId: number; startAngle: number; imgRotation: number } | null>(null);
  const scaleStart = useRef<{
    pointerId: number;
    corner: 'tl' | 'tr' | 'bl' | 'br';
    pivotX: number;
    pivotY: number;
    dragLocalX: