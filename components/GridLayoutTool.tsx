Warning: truncated output (original token count: 226897)
Total output lines: 17180

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { classicTextureSizeFromUi, classicTextureSizeToUi } from '../utils/classicTextureSize';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { useKeyboardRecovery } from '../utils/useKeyboardRecovery';
import { KeyboardSafeInput } from './KeyboardSafeInput';
import {CollageExportOptions} from './CollageExportOptions';
import {collageVideoMime,type CollageVideoFormat} from '../utils/collageVideoFormat';
import {exportHeic} from '../utils/heicExport';
import { idleDefaults } from '../utils/animationDefaults';
import { ArrowLeft, ChevronLeft, Download, Plus, Trash2, RotateCw, Sliders, SlidersHorizontal, LayoutGrid, Sparkles, Asterisk, MoveUp, MoveDown, Check, RefreshCw, Maximize2, Move, Smartphone, Image as ImageIcon, Crop, Palette, Magnet, Type, Bold, Italic, Copy, GalleryHorizontal, ChevronRight, Heart, Circle, Square, Star, Hexagon, Blocks, MessageCircle, Bookmark, Volume2, VolumeX, Shapes, Film, Play, Pause } from 'lucide-react';
import { Icon } from './Icon';
import { ClassicVectorScene, sceneRectBounds, unionSceneBounds, type SceneBounds } from './ClassicVectorScene';
import {MASK_SHAPE_ITEMS,isBackdropMask,maskGeometry,maskDefaults,drawBackdropMask} from '../utils/backdropMasks';
import {BackdropMaskControls} from './BackdropMaskControls';
import { paintCachedClassicGlow } from './ClassicGlowCache';
import { settledSortSeams } from '../utils/sortSeams';
import { swapFloatingMedia } from '../utils/swapFloatingMedia.mjs';
import { SeamlessLayout, SeamlessAmountSlider } from './SeamlessLayout';
import {LayoutPhotoSurface} from './LayoutPhotoSurface';
import {subscribeCellPhoto,updateCellPhoto} from '../utils/liveCellPhoto';
import { ExportActionLift } from './ExportActionLift';
import { renderSeamlessLayout } from '../utils/seamlessLayout';
import { TEMPLATE_MAP } from '../utils/layoutTemplates';
import {SOLID_PLUS_PATH,emptyCellSeparators} from '../utils/photoCellChrome';
import { FONTS, FONT_CATEGORIES, FONT_SAMPLE, FontCategory, DEFAULT_FONT, SYMBOL_FONT, ensureFont, ensureItalic, knownItalic, fontCssLoaded, waitForFont, fontStack, prepareFontSample, warmTextFonts } from '../utils/fonts';
import { PhotoFx, ADJUST_KEYS, applyPhotoFx, releasePhotoFxSurface, hasPhotoFx, loadLut, getLoadedLut, bakePhotoFxLut, lutDefaultAmount, colorKeyOf, getNoisePattern } from '../utils/photoFx';
import {awaitPhotoIdle,deferHeavyWork,holdPhotoInteraction} from '../utils/photoInteractionIdle';
import { get2dWide } from '../utils/colorSpace';
import { FX_DEFS, warmFx } from '../utils/glEffects';
import {DEFAULT_COLORS,SHAPE_COLORS,STROKE_COLORS,TEXT_COLORS as NEW_TEXT_COLORS} from '../utils/colorPalettes.js';
import {effectControlValue,effectStoredValue,effectControlMin,effectControlStep} from '../utils/effectControlValues';
import {effectPreset} from '../utils/effectPresets';
import {effectDetailIcon} from '../utils/effectDetailIcons';
import { orderEffectCards } from '../utils/effectDisplayOrder';
import { saveDraft, loadDraft, clearDraft, hasDraft } from '../utils/collageDraft';
import { CLASSIC_COORDINATE_VERSION, joinLegacyPages } from '../utils/classicPageCoordinates';
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
import { maskTextureSquashFromUi, maskTextureSquashToUi } from '../utils/maskTexture';
import { PatternLayer } from './PatternLayer';
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
  /* 經典拼圖新符號的視覺尺寸改為原本的一半。字級與墨水框一起等比縮小，
     不能只縮外框，否則新增後第一幀符號仍會撐出框外。 */
  const fontSize = Math.max(6, Math.min(36, Math.round((pw * 0.35) * M / w100)));
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
  squareOverlay?: boolean;
}

// Keep inset photos genuinely square, including portrait/landscape layouts.
const resolveLayoutRect = (rect: CellRect, width: number, height: number, size = 80): CellRect => {
  if (!rect.squareOverlay) return rect;
  const side = Math.min(width, height) * .256 * (.5 + Math.max(50, Math.min(100, size)) / 100);
  const w = side / width, h = side / height;
  return {...rect, x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h};
};
const isInsetLayout = (layout: {images: unknown[]; templateIndex: number} | null | undefined) =>
  !!layout && !!TEMPLATE_MAP[layout.images.length]?.[layout.templateIndex]?.rects.some(rect => rect.squareOverlay);

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
const pendingVideoPosters = new Map<string, Promise<string | undefined>>();
const getVideoDimensions = (url: string): Promise<{ width: number; height: number; poster?: string; posterReady: Promise<string | undefined> }> => {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    (v as any).playsInline = true;
    let done = false;
    let resolvePoster: (value?: string) => void;
    const posterReady = new Promise<string | undefined>(r => { resolvePoster = r; });
    pendingVideoPosters.set(url, posterReady);
    const dimensions = () => ({ width: v.videoWidth || 800, height: v.videoHeight || 600, posterReady });
    // Metadata is sufficient to place the layer; decoding its thumbnail must
    // not hold the import queue (especially on iOS with large HEVC files).
    v.onloadedmetadata = () => resolve(dimensions());
    const finish = (poster?: string) => {
      if (done) return; done = true;
      clearTimeout(timeout);
      resolve({ ...dimensions(), poster });
      resolvePoster(poster);
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
    const timeout = setTimeout(() => finish(), 4000);
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
   每個佈局保留自己的長寬比。舊檔案未設比例時，先保持讀入時的樣子；
   使用者第一次改整頁比例前，會把這個原始比例寫回各佈局。
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

// The shared catalog preserves existing template indexes and saved projects.

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
const LONG_PRESS_MS = 304;


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
const FX_ROOT_TOOLS: [string, string, string][] = orderEffectCards<[string, string, string]>([
  ['softLight', '柔光', 'blur_on'],
  ['halation', '光暈', 'flare'],
  ['lightLeak', '漏光', 'leak_add'],
  ['colorNoise', '噪點', 'grain'],
  ['blur', '朦朧', 'blur_linear'],
  ...FX_DEFS.filter(d => d.id !== 'fxSharpen').map(d => [d.id, d.label, d.icon] as [string, string, string]),
], item => item[0]);

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
    ['softThreshold', '範圍', 'tonality', 0, 100, 80],
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
export const FX_PARAM_DEFAULTS: Record<string, number> = {
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
export const GLOW_COLORS = [...DEFAULT_COLORS];

/**
 * 其他借用同一組色票的功能（文字、描邊、圖形、底色…）用這一組：
 * 色相與飽和度完全照舊，只把**明度**（HSV 的 V）從基準色的 83 提到 90 ——
 * 只亮一點點，還是同一條漸層。
 */
const GLOW_BASE_HSV = hexToHsv(GLOW_BASE);
export const SOFT_COLORS = [...SHAPE_COLORS];

/**
 * 文字顏色／文字描邊用的色票。
 * 就是上面那組淡的，只在最前面多墊一顆純黑 ——
 * 有黑色的色票，黑色一律排在純白前面。
 */
const TEXT_COLORS = [...NEW_TEXT_COLORS];

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
  <div ref={rootRef} data-fixed-color-page className="h-full overflow-hidden animate-in fade-in duration-200 pt-1 pb-1">
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
    </div>
    {/* 色票只排一排（排不下就橫向捲），下面接色相／飽和度／明度 ——
        跟紋理顏色那一頁是同一顆元件、同一種操作。
        外面包一層高度 auto 的盒子：挑色器的根是 h-full，直接放會撐滿整格。 */}
    <div>
      <ColorPickerEmbedded color={value || '#FFFFFF'} colors={colors} onChange={onPick} onClose={onBack} />
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

/** Affine squeezing sharpens corners. A fixed miter limit bevels them halfway
 * through a gesture; scale its allowance by the deformation's condition number.
 * This changes joins only, not the object's path, size or snapping geometry. */
export const shapeMiterLimit = (w: number, h: number, base = 4) =>
  base * Math.max(1, Math.max(Math.abs(w), Math.abs(h)) / Math.max(0.001, Math.min(Math.abs(w), Math.abs(h))));

export const shapePathD = (
  kind: string, w: number, h: number,
  gridBaseW = w, gridBaseH = h,
  gridDotRadius = Math.min(gridBaseW, gridBaseH) / 160 * 2.325,
  ringReveal = 1,
): string => {
  if(kind.startsWith('mask-'))kind=kind.includes('circle')||kind.includes('feather')?'circle':'square';
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
    case 'star-rounded': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const t = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const k = i % 2 ? 0.42 : 1;
        pts.push([cx + Math.cos(t) * a * k, cy + Math.sin(t) * b * k]);
      }
      /* 只磨圓向外凸出的五個尖角；凹進去的五個轉折仍直接穿過原始頂點，
         因此保持銳利，不會變成十個角都圓的軟星星。 */
      const cut = 0.38;
      const toward = (from: [number, number], to: [number, number]) =>
        [from[0] + (to[0] - from[0]) * cut, from[1] + (to[1] - from[1]) * cut] as [number, number];
      const first = toward(pts[0], pts[pts.length - 1]);
      let d = `M ${P(first[0], first[1])}`;
      for (let i = 0; i < pts.length; i += 2) {
        const tip = pts[i];
        const inner = pts[(i + 1) % pts.length];
        const nextTip = pts[(i + 2) % pts.length];
        const afterTip = toward(tip, inner);
        const beforeNextTip = toward(nextTip, inner);
        d += ` Q ${P(tip[0], tip[1])} ${P(afterTip[0], afterTip[1])}`;
        d += ` L ${P(inner[0], inner[1])} L ${P(beforeNextTip[0], beforeNextTip[1])}`;
      }
      return `${d} Z`;
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
    case 'grid-dots-staggered':
    case 'grid-dots-fade-diagonal':
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
          const x = cols === 1 ? w / 2 : (col + 0.5 + (kind === 'grid-dots-staggered' && row % 2 ? .5 : 0)) * stepX;
          if (x + gridDotRadius > w) continue;
          const fade = kind === 'grid-dots-fade' ? (1 - 0.68 * (x / Math.max(1, w)))
            : kind === 'grid-dots-fade-diagonal' ? 1 - .68 * ((x / Math.max(1, w) + y / Math.max(1, h)) / 2) : 1;
          const rr = gridDotRadius * fade;
          d += `M ${r3(x - rr)} ${r3(y)} A ${r3(rr)} ${r3(rr)} 0 1 0 ${r3(x + rr)} ${r3(y)} A ${r3(rr)} ${r3(rr)} 0 1 0 ${r3(x - rr)} ${r3(y)} Z `;
        }
      }
      return d;
    }
    case 'grid-diag-cross':
    case 'grid-diag': {
      /* 預設斜線數量加倍；變形才在兩端增減完整線段。 */
      const step = Math.max(gbw, gbh) / 4;
      let d = '';
      for (let q = -h; q <= w; q += step) {
        const x1 = Math.max(0, q), y1 = Math.max(0, -q);
        const x2 = Math.min(w, q + h), y2 = Math.min(h, w - q);
        if (Math.hypot(x2 - x1, y2 - y1) > 0.5) {
          d += `M ${r3(x1)} ${r3(y1)} L ${r3(x2)} ${r3(y2)} `;
          if (kind === 'grid-diag-cross') d += `M ${r3(w-x1)} ${r3(y1)} L ${r3(w-x2)} ${r3(y2)} `;
        }
      }
      if (d) return d;
      const q = (w - h) / 2;
      return `M ${r3(Math.max(0, q))} ${r3(Math.max(0, -q))} L ${r3(Math.min(w, q + h))} ${r3(Math.min(h, w - q))}`;
    }
    case 'grid-plus': {
      const sx = gbw / 6, sy = gbh / 6, arm = Math.min(sx, sy) * .36;
      let d = '';
      for (let y = sy / 2; y < h; y += sy) for (let x = sx / 2; x < w; x += sx) {
        d += `M ${P(Math.max(0,x-arm),y)} H ${r3(Math.min(w,x+arm))} M ${P(x,Math.max(0,y-arm))} V ${r3(Math.min(h,y+arm))} `;
      }
      return d;
    }
    case 'grid-orbits': {
      const step = Math.min(gbw,gbh) / 12;
      // A ring is a complete unit. Stretching reveals additional complete rings,
      // never the clipped arcs of a circle larger than the available short side.
      const count = Math.max(1, Math.floor(Math.min(w,h) / 2 / step));
      let d = '';
      for (let i = 0; i < count; i++) {
        if (i >= Math.ceil(Math.max(0, Math.min(1, ringReveal)) * count)) continue;
        const r = Math.min(Math.min(w,h)/2, step * (i + 1));
        const angles = [0, Math.PI, Math.PI * 2];
        if (w / 2 < r) { const a = Math.acos(w / 2 / r); angles.push(a, Math.PI-a, Math.PI+a, 2*Math.PI-a); }
        if (h / 2 < r) { const a = Math.asin(h / 2 / r); angles.push(a, Math.PI-a, Math.PI+a, 2*Math.PI-a); }
        angles.sort((a,b)=>a-b);
        for (let j=1;j<angles.length;j++) {
          const a=angles[j-1], b=angles[j], m=(a+b)/2;
          if (Math.abs(r*Math.cos(m))>w/2+.001 || Math.abs(r*Math.sin(m))>h/2+.001) continue;
          d += `M ${P(cx+r*Math.cos(a),cy+r*Math.sin(a))} A ${r3(r)} ${r3(r)} 0 0 1 ${P(cx+r*Math.cos(b),cy+r*Math.sin(b))} `;
        }
      }
      return d;
    }
    case 'grid-chevron': {
      const sx = gbw / 4, sy = gbh / 6;
      let d = '';
      for (let y = sy/2; y < h; y += sy) {
        d += `M 0 ${r3(y)} `;
        for (let x = 0; x < w; x += sx) {
          d += `L ${P(Math.min(w,x+sx/2),Math.min(h,y+sy*.3))} L ${P(Math.min(w,x+sx),y)} `;
        }
      }
      return d;
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
  'grid-dots-staggered', 'grid-dots-fade-diagonal', 'grid-diag-cross', 'grid-plus', 'grid-orbits', 'grid-chevron',
]);
export const GRID_DOT_KINDS = new Set(['grid-dots', 'grid-dots-fade', 'grid-dots-staggered', 'grid-dots-fade-diagonal']);
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
/** 雙色方形的外層略深，白色內圖案在新增後與小按鈕上都能一眼辨認。 */
export const shapeDefaultColorFor = (kind: string) =>
  DUAL_COLOR_SHAPE_KINDS.has(kind) ? '#C4D1C6' : SHAPE_DEFAULT_COLOR;

/** 四邊擠壓白名單：實心前 11 顆、邊框前 16 顆。 */
const STRETCH_SOLID_KINDS = new Set([
  'circle', 'square', 'rounded', 'triangle', 'diamond', 'diamond-n',
  'pentagon', 'hexagon', 'star', 'star-rounded', 'heart',
  'square-star-dual', 'square-heart-dual', 'square-star-cutout', 'square-heart-cutout',
  'heart-double', 'star-double',
]);
const STRETCH_OUTLINE_KINDS = new Set([
  'circle', 'square', 'rounded', 'triangle', 'diamond', 'diamond-n',
  'pentagon', 'hexagon', 'star', 'star8', 'heart', 'ellipse',
]);
export const shapeSupportsStretch = (shape: string | undefined, filled: boolean | undefined, holeType?: string) => {
  if(isBackdropMask(shape))return true;
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
  compositeStyle: { innerSize?: number; outlineWidth?: number } = {},
) => {
  if (drawCompositeShapeBody(target, kind, w, h, color, innerColor, paintTexture, compositeStyle)) return;
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
  { id: 'star-rounded-f', kind: 'star-rounded', filled: true },
  { id: 'star-double-f', kind: 'star-double', filled: true },
  { id: 'heart-f', kind: 'heart', filled: true },
  /* 最後一排複合實心圖形。前兩顆是雙色實心、接著兩顆挖空，最後兩顆
     是原本愛心／星星外面再加一圈同形細線。 */
  { id: 'square-star-dual-f', kind: 'square-star-dual', filled: true },
  { id: 'square-heart-dual-f', kind: 'square-heart-dual', filled: true },
  { id: 'square-star-cutout-f', kind: 'square-star-cutout', filled: true },
  { id: 'square-heart-cutout-f', kind: 'square-heart-cutout', filled: true },
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
  { id: 'grid-dots-staggered', kind: 'grid-dots-staggered', filled: true },
  { id: 'grid-dots', kind: 'grid-dots', filled: true },
  { id: 'grid-dots-fade', kind: 'grid-dots-fade', filled: true },
  { id: 'grid-dots-fade-diagonal', kind: 'grid-dots-fade-diagonal', filled: true },
  { id: 'grid-diagonal', kind: 'grid-diag', filled: false },
  { id: 'grid-diag-cross', kind: 'grid-diag-cross', filled: false },
  { id: 'grid-plus', kind: 'grid-plus', filled: false },
  { id: 'grid-orbits', kind: 'grid-orbits', filled: false },
  { id: 'grid-chevron', kind: 'grid-chevron', filled: false },
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
  'star-rounded': [0.0245, 0, 0.9511, 0.9045],
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
  kind: 'star' | 'heart', w: number, h: number, inkFraction: number, offsetYFraction = 0,
) => {
  const srcSize = 100;
  const fit = SHAPE_FIT[kind];
  const sx = (w * inkFraction) / (fit[2] * srcSize);
  const sy = (h * inkFraction) / (fit[3] * srcSize);
  const inkCx = (fit[0] + fit[2] / 2) * srcSize;
  const inkCy = (fit[1] + fit[3] / 2) * srcSize;
  const matrix = new DOMMatrix([sx, 0, 0, sy, w / 2 - inkCx * sx, h / 2 - inkCy * sy + h * offsetYFraction]);
  const out = new Path2D();
  out.addPath(new Path2D(shapePathD(kind, srcSize, srcSize)), matrix);
  return out;
};

/** 與 insetShapePath 完全同一組幾何，供預覽的 SVG 直接使用。 */
const insetShapeSvgTransform = (
  kind: 'star' | 'heart', w: number, h: number, inkFraction: number, offsetYFraction = 0,
) => {
  const fit = SHAPE_FIT[kind];
  const sx = (w * inkFraction) / (fit[2] * 100);
  const sy = (h * inkFraction) / (fit[3] * 100);
  const inkCx = (fit[0] + fit[2] / 2) * 100;
  const inkCy = (fit[1] + fit[3] / 2) * 100;
  return `matrix(${r3(sx)} 0 0 ${r3(sy)} ${r3(w / 2 - inkCx * sx)} ${r3(h / 2 - inkCy * sy + h * offsetYFraction)})`;
};

/**
 * 六顆複合圖形的本體。回傳 true 代表已完成繪製：
 * - 雙色款：紋理只鋪外方形，再以純色內層完整蓋住。
 * - 挖空款：真正清除 alpha，不是假裝塗成背景色。
 * - 雙輪廓款：內層仍是原本實心路徑，外圈只是一條同形細線。
 */
export const compositeOutlineInk = (kind: string, w: number, h: number, amount = 0) => {
  if (kind !== 'star-double') return null;
  const fit = SHAPE_FIT.star;
  const pts = Array.from({length:10}, (_,i) => {
    const t=-Math.PI/2+i*Math.PI/5, r=i%2?.42:1;
    return {x:w/2+((.5+Math.cos(t)*.5*r)-(fit[0]+fit[2]/2))*w*.93/fit[2],
      y:h/2+((.5+Math.sin(t)*.5*r)-(fit[1]+fit[3]/2))*h*.93/fit[3]};
  });
  const half=Math.max(1,Math.min(w,h)*.024)*(.5+2*Math.max(0,Math.min(100,amount))/100);
  const corners=pts.flatMap((p,i)=>{
    const a=pts[(i+9)%10], b=pts[(i+1)%10];
    const al=Math.hypot(p.x-a.x,p.y-a.y), bl=Math.hypot(b.x-p.x,b.y-p.y);
    const n1={x:-(p.y-a.y)/al,y:(p.x-a.x)/al}, n2={x:-(b.y-p.y)/bl,y:(b.x-p.x)/bl};
    const den=1+n1.x*n2.x+n1.y*n2.y;
    const dx=(n1.x+n2.x)*half/den,dy=(n1.y+n2.y)*half/den;
    return [{x:p.x+dx,y:p.y+dy},{x:p.x-dx,y:p.y-dy}];
  });
  const x=Math.min(...corners.map(p=>p.x)), y=Math.min(...corners.map(p=>p.y));
  return {x,y,w:Math.max(...corners.map(p=>p.x))-x,h:Math.max(...corners.map(p=>p.y))-y};
};

export const drawCompositeShapeBody = (
  target: CanvasRenderingContext2D,
  kind: string, w: number, h: number,
  color: string, innerColor = '#FFFFFF',
  paintTexture?: (ctx: CanvasRenderingContext2D, path: Path2D) => void,
  style: { innerSize?: number; outlineWidth?: number } = {},
) => {
  if (!COMPOSITE_SHAPE_KINDS.has(kind)) return false;
  const innerKind = compositeInnerKind(kind)!;
  if (DUAL_COLOR_SHAPE_KINDS.has(kind) || CUTOUT_SHAPE_KINDS.has(kind)) {
    const outer = new Path2D(shapePathD('square', w, h));
    /* insetShapePath 以實際墨水邊界（不是字框）置中，因此愛心尖底與頂部
       到方形的距離會精確相等。 */
    /* 愛心的視覺重心比幾何外接框稍高；只在方形複合款往下補 1%，
       讓上下看起來的留白一致，星星與所有其他圖形完全不動。 */
    const inner = insetShapePath(innerKind, w, h, Math.max(.1, Math.min(.9, (style.innerSize ?? 64) / 100)), innerKind === 'heart' ? 0.01 : 0);
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
  /* 外圈維持原本大小，只縮小內層本體，兩者不再由同一條粗描邊切割；
     因此間距會確實加大，外圈尺寸與按鈕整體大小完全不變。 */
  const body = insetShapePath(innerKind, w, h, 0.44, innerKind === 'star' ? 0.018 : 0);
  const ring = insetShapePath(innerKind, w, h, 0.93);
  target.fillStyle = color;
  target.fill(body);
  paintTexture?.(target, body);
  target.save();
  target.strokeStyle = color;
  target.lineWidth = Math.max(1, Math.min(w, h) * 0.024);
  target.lineJoin = innerKind === 'star' ? 'miter' : 'round';
  target.lineCap = innerKind === 'star' ? 'butt' : 'round';
  target.miterLimit = shapeMiterLimit(w, h, 12);
  target.stroke(ring);
  const extra = Math.max(0, Math.min(100, style.outlineWidth || 0)) / 100 * target.lineWidth * 2;
  if (extra > 0) {
    // Preserve the original inner edge; add ink only outside the ring centreline.
    const outside = new Path2D();
    const allowance = target.lineWidth * target.miterLimit + extra * 2 * target.miterLimit;
    outside.rect(-allowance, -allowance, w + allowance * 2, h + allowance * 2);
    outside.addPath(ring);
    target.clip(outside, 'evenodd');
    target.lineWidth += extra * 2;
    target.stroke(ring);
  }
  target.restore();
  return true;
};

/** 複合圖形的描邊路徑；讓描邊跟真正可見的每一層輪廓一致。 */
export const strokeCompositeShape = (
  target: CanvasRenderingContext2D, kind: string, w: number, h: number,
  innerSize = 64,
) => {
  if (!COMPOSITE_SHAPE_KINDS.has(kind)) return false;
  const innerKind = compositeInnerKind(kind)!;
  if (DUAL_COLOR_SHAPE_KINDS.has(kind) || CUTOUT_SHAPE_KINDS.has(kind)) {
    target.stroke(new Path2D(shapePathD('square', w, h)));
    /* 挖空款的孔洞也是實際邊緣；雙色款的內層不是外描邊，不額外套黑框。 */
    if (CUTOUT_SHAPE_KINDS.has(kind)) target.stroke(insetShapePath(innerKind, w, h, Math.max(.1, Math.min(.9, innerSize / 100)), innerKind === 'heart' ? .01 : 0));
    return true;
  }
  target.stroke(insetShapePath(innerKind, w, h, 0.44, innerKind === 'star' ? 0.018 : 0));
  target.stroke(insetShapePath(innerKind, w, h, 0.93));
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
  if(isBackdropMask(item.kind))return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <defs><clipPath id={`material-${maskId}`}>{maskGeometry(item.kind)==='circle'?<circle cx="12" cy="12" r="10"/>:<rect x="2" y="2" width="20" height="20"/>}</clipPath><linearGradient id={`heat-${maskId}`} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#2d0e7c"/><stop offset=".5" stopColor="#ff5519"/><stop offset="1" stopColor="#ffde42"/></linearGradient></defs>
    <g clipPath={`url(#material-${maskId})`}>
      {item.kind==='mask-mosaic'||item.kind==='mask-bricks'?Array.from({length:25},(_,i)=><rect key={i} x={2+i%5*4} y={2+Math.floor(i/5)*4} width={item.kind==='mask-bricks'?3.2:4} height={item.kind==='mask-bricks'?3.2:4} fill="currentColor" opacity={.2+(i*7%11)/14}/> ):<>
      <rect x="2" y="2" width="20" height="20" fill="currentColor" opacity=".18"/>
      {item.kind==='mask-negative'||item.kind==='mask-monochrome'?<path d={item.kind==='mask-monochrome'?'M2 22L22 2V22Z':'M12 2H22V22H12Z'} fill="currentColor"/>:item.kind==='mask-thermal'?<rect x="2" y="2" width="20" height="20" fill={`url(#heat-${maskId})`}/>:<>{[5,9,13,17].map((y,i)=><path key={y} d={`M2 ${y}H22`} stroke="currentColor" strokeWidth="2" opacity={item.kind==='mask-frost-feather'?.25+i*.1:.5}/>)}</>}
      </>}
    </g><path d={maskGeometry(item.kind)==='circle'?'M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12':'M2 2H22V22H2Z'} fill="none" stroke="currentColor" strokeWidth=".8" opacity={item.kind==='mask-frost-feather'?.4:1}/>
  </svg>;
  const isLine = item.kind === 'line';
  const isGridGlyph = GRID_SHAPE_KINDS.has(item.kind);
  /* viewBox 與圖案的框一樣大 —— 每一顆圖案的長邊都剛好等於 size（預設 20px），
     所以不管哪一種形狀，看起來都一樣大。 */
  const VB = 24;
  const BOX = VB;
  if (COMPOSITE_SHAPE_KINDS.has(item.kind)) {
    const innerKind = compositeInnerKind(item.kind)!;
    const fit = SHAPE_FIT[innerKind];
    const tf = (fraction: number, offsetYFraction = 0) => {
      const sx = (VB * fraction) / (fit[2] * 100);
      const sy = (VB * fraction) / (fit[3] * 100);
      const cx = (fit[0] + fit[2] / 2) * 100;
      const cy = (fit[1] + fit[3] / 2) * 100;
      return `matrix(${r3(sx)} 0 0 ${r3(sy)} ${r3(VB / 2 - cx * sx)} ${r3(VB / 2 - cy * sy + VB * offsetYFraction)})`;
    };
    const innerD = shapePathD(innerKind, 100, 100);
    if (DUAL_COLOR_SHAPE_KINDS.has(item.kind)) return (
      <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} aria-hidden>
        <rect width={VB} height={VB} fill="#C4D1C6" />
        <path d={innerD} transform={tf(0.64, innerKind === 'heart' ? 0.01 : 0)} fill="#fff" />
      </svg>
    );
    if (CUTOUT_SHAPE_KINDS.has(item.kind)) return (
      <svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} aria-hidden>
        <defs><mask id={maskId}><rect width={VB} height={VB} fill="#fff" /><path d={innerD} transform={tf(0.64, innerKind === 'heart' ? 0.01 : 0)} fill="#000" /></mask></defs>
        <rect width={VB} height={VB} fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    );
    return (
      <svg width={size} height={size} viewBox={`-1 -1 ${VB + 2} ${VB + 2}`}
        style={{ overflow: 'visible', display: 'block' }} aria-hidden>
        <path d={innerD} transform={tf(0.52, innerKind === 'star' ? 0.018 : 0)} fill="currentColor" />
        <path d={innerD} transform={tf(0.93)} fill="none" stroke="currentColor"
          strokeWidth={0.58} vectorEffect="non-scaling-stroke"
          strokeLinejoin={innerKind === 'star' ? 'miter' : 'round'}
          strokeLinecap={innerKind === 'star' ? 'butt' : 'round'} />
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
          strokeWidth={(item.kind === 'grid-plus' ? .7 : isGridGlyph ? 1.5 : (isLine ? 1.9 : 1.6)) / k}
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
  onInteractionChange?: (active: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, min, max, step = 1, onValue, onInteractionChange, className = '', style }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const pendingRef = useRef(value);
  const rafRef = useRef(0);
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;
  const onInteractionRef = useRef(onInteractionChange);
  onInteractionRef.current = onInteractionChange;

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
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    // Parent pointer-up capture may re-render the old controlled value before
    // this handler runs. Commit the last actual input sample, not that DOM value.
    const next = pendingRef.current;
    pendingRef.current = next;
    onValueRef.current(next);
    // Finish the draft only after its final input sample has been delivered.
    if (wasDragging) onInteractionRef.current?.(false);
  };
  return (
    <input
      ref={inputRef}
      type="range"
      min={min} max={max} step={step}
      defaultValue={value}
      onPointerDown={() => {
        if (!draggingRef.current) onInteractionRef.current?.(true);
        draggingRef.current = true;
        pendingRef.current = Number(inputRef.current?.value ?? value);
      }}
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
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    prepareFontSample(font).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [font.name]);

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
        style={{ fontFamily: fontStack(font.name), visibility: ready ? 'visible' : 'hidden' }}
      >
        {FONT_SAMPLE[font.category]}
      </span>
      <span className="text-[9px] leading-[10px] h-5 flex items-center justify-center text-center font-bold text-white/40 max-w-full break-words">{font.label}</span>
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
 * 提示使用同一个 SVG 世界坐标，和格子一起连续缩放。字体不逐帧重排，
 * 也没有第二个反向缩放层，避免 WebKit 的两套取整规则互相拉扯。
 */
const LayoutEmptyPromptLayer: React.FC<{
  cells: { x: number; y: number; w: number; h: number }[];
  width:number;
  height:number;
  hidden?: boolean;
}> = ({ cells, width, height, hidden = false }) => (
  <svg data-layout-empty-prompts="1" aria-hidden
    viewBox={`0 0 ${width} ${height}`}
    className="absolute inset-0 w-full h-full pointer-events-none z-[6]"
    style={{visibility:hidden?'hidden':'visible'}}>
    {cells.map((cell,idx)=>{
      const fit=Math.max(.18,Math.min(1,cell.w/92,cell.h/60));
      return <g key={idx} data-layout-empty-prompt="1"
        transform={`translate(${cell.x+cell.w/2} ${cell.y+cell.h/2}) scale(${fit})`}
        fill="white" opacity=".2">
        <path data-layout-empty-plus="1" d={SOLID_PLUS_PATH} transform="translate(-8 -19)"/>
        <text data-layout-empty-label="1" x="0" y="12" textAnchor="middle"
          fontSize="8" fontWeight="700" fontFamily={fontStack(DEFAULT_FONT)}>選擇相片</text>
      </g>;
    })}
  </svg>
);

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
}> = ({ layer: committedLayer, onChange: commitChange, onPickColor, symbol, onTuningChange }) => {
  const [layer, setLayer] = useState(committedLayer);
  const tuningRef = useRef(false);
  useEffect(() => {
    if (!tuningRef.current) setLayer(committedLayer);
  }, [committedLayer]);
  const onChange = useCallback((patch: Partial<FloatingImage>) => {
    setLayer(prev => ({ ...prev, ...patch }));
    commitChange(patch);
  }, [commitChange]);
  const setTuning = (active: boolean) => {
    tuningRef.current = active;
    onTuningChange?.(active);
  };
  const [sub, setSub] = useState<'style' | 'font'>('style');
  useEffect(() => {
    if (!symbol) return warmTextFonts(layer.text || '');
  }, [symbol, layer.text]);
  const fontPickVersion = useRef(0);
  useEffect(() => () => { fontPickVersion.current++; }, [layer.id]);
  const pickFont = async (name: string) => {
    const version = ++fontPickVersion.current;
    await ensureFont(name);
    if (layer.italic) await ensureItalic(name);
    await document.fonts.load(`${layer.italic ? 'italic ' : ''}${layer.bold ? 700 : 400} 40px "${name}"`, layer.text || ' ');
    if (version === fontPickVersion.current) onChange({ fontFamily: name });
  };
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
        <div className="w-6 h-5 rounded-[4px] shadow-inner border border-white/10" style={{ backgroundColor: value }} />
      </div>
    </div>
  );

  const swatchRow = (value: string | undefined, onPick: (c: string) => void, colors = symbol ? DEFAULT_COLORS : TEXT_COLORS) => (
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
      data-text-editor="1" className="max-w-md mx-auto h-full flex flex-row animate-in fade-in duration-300"
      onPointerDownCapture={e => {
        if ((e.target as HTMLElement).matches?.('input[type="range"]')) setTuning(true);
      }}
      onPointerUpCapture={() => setTuning(false)}
      onPointerCancelCapture={(…176897 tokens truncated…
                                         拆掉時整層一起消失，不會有殘影留在別人的圖層上。 */
                                      /* 靜止選中 UI 不建立點陣合成層，否則再被整個預覽
                                         放大時，框、控制點和藥丸都會拿低解析貼圖硬拉。
                                         只有頁面真的在拖曳時才短暫使用 transform。 */
                                      transform: mvChrome
                                        ? `translateX(${mvChrome.dx}px)${liftedChrome ? ` scale(${mvChrome.s})` : ''}`
                                        : undefined,
                                      willChange: mvChrome?.live ? 'transform' : undefined,
                                      backfaceVisibility: mvChrome ? 'hidden' : undefined,
                                    }}
                                  >
                                    {/* 裡面這層＝佈局自己的框。尺寸跟真正那個 wrapper 一模一樣，
                                        而且同樣掛著 data-layout-wrapper／data-layout-id ——
                                        拖角球是用 closest('[data-layout-wrapper]') 的中心當支點的，
                                        少了這兩個屬性就會抓不到支點、縮放整組失效。 */}
                                    <div
                                      data-layout-wrapper={pageIdx}
                                      data-layout-id={layout.id}
                                      className="absolute pointer-events-none"
                                      style={{
                                        left: `${lLeft}px`,
                                        top: `${lTop}px`,
                                        width: `${lw}px`,
                                        height: `${lh}px`,
                                        // 佈局轉了角度時，這層也要一起轉，
                                        // 不然選取框、角球、按鈕列會留在原地不跟著轉。
                                        ...((layout.t?.rot || 0) !== 0
                                          ? {
                                              transform: `rotate(${layout.t!.rot}deg)`,
                                              transformOrigin: 'center center',
                                            }
                                          : null),
                                      }}
                                    >
                                      {layoutChrome}
                                    </div>
                                  </div>,
                                  chromeLayer,
                                );
                              })()}
                              </div>
                              );
                            })}

                          </div>
                        </React.Fragment>
                      );
                    })}

                     {floatingImages.map((fImg, fIdx) => (
                      <FloatingImageComponent
                        key={fImg.id}
                        scene={vectorScene}
                        sceneMotionFrame={sceneMotionFrame}
                        image={fImg}
                        // Vector ink animates in the scene. Its invisible hit
                        // wrapper must keep the stable logical object bounds.
                        motionFrame={needsDomMotion(fImg)
                          ? frameForItem(fImg, fIdx, motionTime)
                          : null}
                        motionPickOnly={activeTab === 'motion'}
                        motionTargetFlash={activeTab === 'motion' && motionFlash?.id === fImg.id ? motionFlash.nonce : null}
                        videoPaused={activeTab === 'motion' && !motionPlaying}
                        isSelected={activeTab !== 'motion' && selectedFloatingId === fImg.id}
                        shapeSelected={shapeSelId === fImg.id}
                        onShapeTap={(cx, cy) => {
                          if (!isImgShaped((fImg as any).imgShape)) return;
                          const inside = hitFloatingShape(fImg, cx, cy);
                          // 已選中又點在圖案裡面 → 進第二段；點在圖案外面 → 退回第一段
                          if (inside && selectedFloatingId === fImg.id) setShapeSelId(fImg.id);
                          else if (!inside) setShapeSelId(null);
                          // 點在形狀外面但還在圖片身上：退回「選中圖片」，選取本身留著
                        }}
                        hasActiveGuidelines={activeGuidelines.length > 0}
                        stackIndex={fIdx}
                        // 選取框那一組改畫在不會被裁切的那一層
                        chromeLayer={chromeLayer}
                        touchMode={activeTab === 'motion' ? 'pan-x' : 'none'}
                        hideToolbar={pinchFloatingId === fImg.id || (selectionDragging && selectedFloatingId === fImg.id)}
                        hideChrome={(tuningEdge || selectionDragging || pinchFloatingId === fImg.id) && selectedFloatingId === fImg.id}
                        /* 一般圖形、文字、符號在手勢前中後都使用同一份 SVG，
                           不再切換 PNG 快照。只有必須用 Canvas 畫的借用圖案保留
                           手勢旗標；它也不會影響一般向量物件的幾何或選中框。 */
                        gestureRendering={pinchFloatingId === fImg.id && (!!fImg.shape || fImg.text !== undefined)}
                        liveTuning={vectorTuningId === fImg.id}
                        // 排頁面拖曳時，圖層要跟著自己那一頁一起移動
                        dragShift={floatingDragShift(fImg)}
                        sortPage={pagesMode || (pagesVisual && !!sortOriginalIndices.current) ? (() => {
                          const index = sortingPageOf(fImg, previewW, pages.length);
                          return { index, width: previewW, height: previewH, totalWidth: pages.length * previewW,
                            clipLeft: 0, clipContents: pageDragIdx !== null || !!dragSettle };
                        })() : null}
                        lutRevision={lutRevision}
                        toolbarAbove={(() => {
                          // 旋轉之後外接框會變高，要用轉過的高度判斷下面還有沒有位置
                          const rad = (fImg.rotation * Math.PI) / 180;
                          const halfSpan = (fImg.width * fImg.scale * Math.abs(Math.sin(rad))
                            + fImg.height * fImg.scale * Math.abs(Math.cos(rad))) / 2;
                          const cy = fImg.y + fImg.height / 2;
                          const crossedLowerThird = cy > previewH * (2 / 3);
                          const aboveFits = cy - halfSpan - 52 >= 0;
                          return crossedLowerThird && aboveFits;
                        })()}
                        maxTextWidth={previewW}
                        canvasHeight={previewH}
                        isTextEditing={inlineEditId === fImg.id}
                        onTextEditEnd={() => setInlineEditId(prev => (prev === fImg.id ? null : prev))}
                        // 圖層上下是所有物件共用一條清單（照片、文字、佈局都算），
                        // 圖片才爬得到佈局上面
                        canLayerDown={stackPos('float', fImg.id) > 0}
                        canLayerUp={stackPos('float', fImg.id) < layerStack.length - 1}
                        onLayerAction={(action) => {
                          if (action === 'delete') {
                            setFloatingImages(prev => prev.filter(f => f.id !== fImg.id));
                            setSelectedFloatingId(null);
                            return;
                          }
                          if (action === 'edit') {
                            // 圖片與文字都進同一個「編輯」分頁，只是裡面長得不一樣
                            if (fImg.text !== undefined) {
                              setEditingTextId(fImg.id);
                              setInlineEditId(null);
                            }
                            setObjectEditorRevision(v=>v+1); setActiveTab('adjust');
                            return;
                          }
                          if (action === 'copy') {
                            handleDuplicateFloating(fImg.id);
                            return;
                          }
                          moveInStack('float', fImg.id, action === 'up' ? 1 : -1);
                        }}
                        isSwapTarget={swapOver?.kind === 'floating' && swapOver.id === fImg.id}
                        isSwapSource={floatDragSrc !== null && floatSwapRef.current?.id === fImg.id}
                        onSwapTouchStart={handleFloatSwapTouchStart(fImg)}
                        onSwapTouchMove={handleFloatSwapTouchMove}
                        onSwapTouchEnd={handleFloatSwapTouchEnd}
                        onSelect={() => {
                          if (activeTab === 'motion') {
                            if (!fImg.isVideo) chooseMotionTarget(fImg.id);
                            return;
                          }
                          setSelectedFloatingId(fImg.id); setSelectedLayoutId(null); setSelectedIndex(null);
                        }}
                        onChange={(updated) => {
                          setFloatingImages(prev => prev.map(item => item.id === fImg.id ? { ...item, ...updated } : item));
                        }}
                        onDelete={() => {
                          setFloatingImages(prev => prev.filter(item => item.id !== fImg.id));
                          if (selectedFloatingId === fImg.id) setSelectedFloatingId(null);
                        }}
                        pagesContainerRef={pagesContainerRef}
                        canvasKRef={kRef}
                        canvasScale={pagesScale}
                        onDragStart={() => {}}
                        onDragMove={(rawX, rawY) => {
                          const { snappedX, snappedY, fitScale, guidelines } = applySnapping(
                            fImg.id,
                            rawX,
                            rawY,
                            fImg.width,
                            fImg.height,
                            fImg.scale,
                            undefined,
                            fImg.rotation || 0,
                          );
                          queueInteraction(() => {
                            setActiveGuidelines(guidelines);
                            setFloatingImages(prev => prev.map(item => item.id === fImg.id
                              ? { ...item, x: snappedX, y: snappedY, ...(fitScale ? { scale: fitScale } : {}) }
                              : item));
                          });
                        }}
                        onDragEnd={() => {
                          flushInteractionNow();
                          setActiveGuidelines([]);
                        }}
                        onScaleStart={() => {}}
                        onScaleMove={(
                          newX,
                          newY,
                          newScale,
                          corner,
                          pivotContainerX,
                          pivotContainerY,
                          K_x,
                          K_y,
                          oppositeLocalX,
                          oppositeLocalY
                        ) => {
                          let finalScale = newScale;
                          let finalGuidelines: AlignmentGuideline[] = [];

                          if (
                            corner &&
                            pivotContainerX !== undefined &&
                            pivotContainerY !== undefined &&
                            K_x !== undefined &&
                            K_y !== undefined &&
                            oppositeLocalX !== undefined &&
                            oppositeLocalY !== undefined
                          ) {
                            const pageRects = getAllPageRects();
                            /* 4px 是兩套拼圖統一的手機吸附範圍。座標在內容空間，
                               所以要除掉預覽倍率；固定支點公式仍在下面，沒有搬整張圖。 */
                            const SNAP_THRESHOLD = 4 / Math.max(0.001, kRef.current || 1);
                            
                            // Unsnapped position of the dragged corner
                            const rawCornerX = pivotContainerX + newScale * K_x;
                            const rawCornerY = pivotContainerY + newScale * K_y;

                            let minDiffX = SNAP_THRESHOLD;
                            let bestScaleX = newScale;
                            let bestGuidelineX: number | null = null;
                            let isPageBoundarySnapX = false;

                            let minDiffY = SNAP_THRESHOLD;
                            let bestScaleY = newScale;
                            let bestGuidelineY: number | null = null;
                            let isPageBoundarySnapY = false;

                            if (enableSnapping) {
                              pageRects.forEach(pageRect => {
                                // Vertical guidelines (left, right)
                              // Left edge
                              const diffLeft = rawCornerX - pageRect.left;
                              if (Math.abs(diffLeft) < SNAP_THRESHOLD && Math.abs(diffLeft) < Math.abs(minDiffX)) {
                                if (Math.abs(K_x) > 1e-5) {
                                  const s = (pageRect.left - pivotContainerX) / K_x;
                                  if (s > 0) {
                                    minDiffX = diffLeft;
                                    bestScaleX = s;
                                    bestGuidelineX = pageRect.left;
                                    isPageBoundarySnapX = true;
                                  }
                                }
                              }

                              // Right edge
                              const diffRight = rawCornerX - pageRect.right;
                              if (Math.abs(diffRight) < SNAP_THRESHOLD && Math.abs(diffRight) < Math.abs(minDiffX)) {
                                if (Math.abs(K_x) > 1e-5) {
                                  const s = (pageRect.right - pivotContainerX) / K_x;
                                  if (s > 0) {
                                    minDiffX = diffRight;
                                    bestScaleX = s;
                                    bestGuidelineX = pageRect.right;
                                    isPageBoundarySnapX = true;
                                  }
                                }
                              }

                              // Horizontal guidelines (top, bottom)
                              // Top edge
                              const diffTop = rawCornerY - pageRect.top;
                              if (Math.abs(diffTop) < SNAP_THRESHOLD && Math.abs(diffTop) < Math.abs(minDiffY)) {
                                if (Math.abs(K_y) > 1e-5) {
                                  const s = (pageRect.top - pivotContainerY) / K_y;
                                  if (s > 0) {
                                    minDiffY = diffTop;
                                    bestScaleY = s;
                                    bestGuidelineY = pageRect.top;
                                    isPageBoundarySnapY = true;
                                  }
                                }
                              }

                              // Bottom edge
                              const diffBottom = rawCornerY - pageRect.bottom;
                              if (Math.abs(diffBottom) < SNAP_THRESHOLD && Math.abs(diffBottom) < Math.abs(minDiffY)) {
                                if (Math.abs(K_y) > 1e-5) {
                                  const s = (pageRect.bottom - pivotContainerY) / K_y;
                                  if (s > 0) {
                                    minDiffY = diffBottom;
                                    bestScaleY = s;
                                    bestGuidelineY = pageRect.bottom;
                                    isPageBoundarySnapY = true;
                                  }
                                }
                              }
                            });
                            } // End of first enableSnapping

                            // Image-to-image edge snapping when scaling
                            if (enableSnapping) {
                              floatingImages.forEach(other => {
                                if (other.id === fImg.id) return; // Skip self

                                const otherW = other.width * other.scale;
                                const otherH = other.height * other.scale;
                              const otherCenterX = other.x + other.width / 2;
                              const otherCenterY = other.y + other.height / 2;
                              const otherLeft = otherCenterX - otherW / 2;
                              const otherRight = otherCenterX + otherW / 2;
                              const otherTop = otherCenterY - otherH / 2;
                              const otherBottom = otherCenterY + otherH / 2;

                              // Check vertical alignment with otherLeft
                              // If current corner is 'tr' or 'br' (Right edge), we align our Right edge to otherLeft.
                              // To bleed, we want to align to otherLeft + 1. Otherwise, no bleed (just otherLeft).
                              const targetLeft = (corner === 'tr' || corner === 'br') ? (otherLeft + 1) : otherLeft;
                              const diffLeft = rawCornerX - targetLeft;
                              if (Math.abs(diffLeft) < SNAP_THRESHOLD && Math.abs(diffLeft) < Math.abs(minDiffX)) {
                                if (Math.abs(K_x) > 1e-5) {
                                  const s = (targetLeft - pivotContainerX) / K_x;
                                  if (s > 0) {
                                    minDiffX = diffLeft;
                                    bestScaleX = s;
                                    bestGuidelineX = otherLeft;
                                    isPageBoundarySnapX = false; // prefer image snapping
                                  }
                                }
                              }

                              // Check vertical alignment with otherRight
                              // If current corner is 'tl' or 'bl' (Left edge), we align our Left edge to otherRight.
                              // To bleed, we want to align to otherRight - 1. Otherwise, no bleed (just otherRight).
                              const targetRight = (corner === 'tl' || corner === 'bl') ? (otherRight - 1) : otherRight;
                              const diffRight = rawCornerX - targetRight;
                              if (Math.abs(diffRight) < SNAP_THRESHOLD && Math.abs(diffRight) < Math.abs(minDiffX)) {
                                if (Math.abs(K_x) > 1e-5) {
                                  const s = (targetRight - pivotContainerX) / K_x;
                                  if (s > 0) {
                                    minDiffX = diffRight;
                                    bestScaleX = s;
                                    bestGuidelineX = otherRight;
                                    isPageBoundarySnapX = false; // prefer image snapping
                                  }
                                }
                              }

                              // Check horizontal alignment with otherTop
                              // If current corner is 'bl' or 'br' (Bottom edge), we align our Bottom edge to otherTop.
                              // To bleed, we want to align to otherTop + 1. Otherwise, no bleed (just otherTop).
                              const targetTop = (corner === 'bl' || corner === 'br') ? (otherTop + 1) : otherTop;
                              const diffTop = rawCornerY - targetTop;
                              if (Math.abs(diffTop) < SNAP_THRESHOLD && Math.abs(diffTop) < Math.abs(minDiffY)) {
                                if (Math.abs(K_y) > 1e-5) {
                                  const s = (targetTop - pivotContainerY) / K_y;
                                  if (s > 0) {
                                    minDiffY = diffTop;
                                    bestScaleY = s;
                                    bestGuidelineY = otherTop;
                                    isPageBoundarySnapY = false; // prefer image snapping
                                  }
                                }
                              }

                              // Check horizontal alignment with otherBottom
                              // If current corner is 'tl' or 'tr' (Top edge), we align our Top edge to otherBottom.
                              // To bleed, we want to align to otherBottom - 1. Otherwise, no bleed (just otherBottom).
                              const targetBottom = (corner === 'tl' || corner === 'tr') ? (otherBottom - 1) : otherBottom;
                              const diffBottom = rawCornerY - targetBottom;
                              if (Math.abs(diffBottom) < SNAP_THRESHOLD && Math.abs(diffBottom) < Math.abs(minDiffY)) {
                                if (Math.abs(K_y) > 1e-5) {
                                  const s = (targetBottom - pivotContainerY) / K_y;
                                  if (s > 0) {
                                    minDiffY = diffBottom;
                                    bestScaleY = s;
                                    bestGuidelineY = otherBottom;
                                    isPageBoundarySnapY = false; // prefer image snapping
                                  }
                                }
                              }
                            });
                            } // End of if (enableSnapping)

                            // Choose the stronger snap (the one with smaller diff)
                            const snapX = bestGuidelineX !== null;
                            const snapY = bestGuidelineY !== null;

                            if (snapX && snapY) {
                              /* 兩個軸都吸附得到時取「比較大」的倍率（＝覆蓋，而不是縮進去）。
                                 圖層框的長寬比跟頁面通常會差零點幾 px（匯入時取整造成），
                                 取小的那個等於留一條白縫在另一邊；取大的只是多蓋出去
                                 零點幾 px，而頁面本來就會裁掉超出的部分，所以四邊都不露白。
                                 這也是「由外而內沒縫、由內而外有縫」的成因 —— 以前是看
                                 哪一軸比較近就聽誰的，方向不同結果就不同。 */
                              if (bestScaleX >= bestScaleY) {
                                finalScale = bestScaleX;
                                finalGuidelines = [{ type: 'vertical', coord: bestGuidelineX! }];
                              } else {
                                finalScale = bestScaleY;
                                finalGuidelines = [{ type: 'horizontal', coord: bestGuidelineY! }];
                              }
                              /* 再多蓋出去半個像素。剛好貼齊時邊緣會落在非整數的像素上，
                                 抗鋸齒會把最外面那一列混成半透明，看起來就是一條髮絲白邊。
                                 頁面本身會裁掉超出的部分，所以多這半個像素完全看不到，
                                 卻能保證四邊都不露白。 */
                              /* 不再多蓋出去：使用者要的是「剛好貼齊」，
                                 多蓋的那一點在右邊／下面會看得出來凸出去。 */
                            } else if (snapX) {
                              finalScale = bestScaleX;
                              finalGuidelines = [{ type: 'vertical', coord: bestGuidelineX! }];
                            } else if (snapY) {
                              finalScale = bestScaleY;
                              finalGuidelines = [{ type: 'horizontal', coord: bestGuidelineY! }];
                            }

                            // 吸附候選也不能繞過共用最小倍率。
                            finalScale = Math.max(floatingScaleFloor(fImg), finalScale);
                            // Calculate the final (newX, newY) based on finalScale to keep pivot fixed
                            const R = (fImg.rotation * Math.PI) / 180;
                            const oppositeOffsetRotX = oppositeLocalX * Math.cos(R) - oppositeLocalY * Math.sin(R);
                            const oppositeOffsetRotY = oppositeLocalX * Math.sin(R) + oppositeLocalY * Math.cos(R);

                            const newCx = pivotContainerX - finalScale * oppositeOffsetRotX;
                            const newCy = pivotContainerY - finalScale * oppositeOffsetRotY;

                            const finalX = newCx - fImg.width / 2;
                            const finalY = newCy - fImg.height / 2;

                            const nextGuidelines = dedupeGuidelines(finalGuidelines, fImg.x + fImg.width / 2);
                            queueInteraction(() => {
                              setActiveGuidelines(nextGuidelines);
                              setFloatingImages(prev => prev.map(item => item.id === fImg.id
                                ? { ...item, x: finalX, y: finalY, scale: finalScale }
                                : item));
                            });
                          } else {
                            queueInteraction(() => setFloatingImages(prev => prev.map(item => item.id === fImg.id
                              ? { ...item, x: newX, y: newY, scale: newScale }
                              : item)));
                          }
                        }}
                        onStretchMove={(rawNext, side, base) => {
                          const horizontal = side === 'l' || side === 'r';
                          const oldCx = base.x + base.width / 2;
                          const oldCy = base.y + base.height / 2;
                          const geometryAt = (size: number) => {
                            if (horizontal) {
                              const width = Math.max(24, size);
                              const shift = (width - base.width) / 2 * (side === 'r' ? 1 : -1);
                              const cx = oldCx + shift * Math.cos(base.rotationRad);
                              const cy = oldCy + shift * Math.sin(base.rotationRad);
                              return { width, height: base.height, x: cx - width / 2, y: cy - base.height / 2 };
                            }
                            const height = Math.max(24, size);
                            const shift = (height - base.height) / 2 * (side === 'b' ? 1 : -1);
                            const cx = oldCx - shift * Math.sin(base.rotationRad);
                            const cy = oldCy + shift * Math.cos(base.rotationRad);
                            return { width: base.width, height, x: cx - base.width / 2, y: cy - height / 2 };
                          };
                          let next = rawNext as { x: number; y: number; width: number; height: number };
                          let nextGuidelines: AlignmentGuideline[] = [];
                          if (enableSnapping) {
                            const bounds = (g: typeof next) => {
                              const ext = rotExtent(g.width * fImg.scale, g.height * fImg.scale, fImg.rotation || 0);
                              const cx = g.x + g.width / 2, cy = g.y + g.height / 2;
                              return { l: cx - ext.bw / 2, r: cx + ext.bw / 2, t: cy - ext.bh / 2, b: cy + ext.bh / 2 };
                            };
                            const q = horizontal ? next.width : next.height;
                            const b0 = bounds(next), b1 = bounds(geometryAt(q + 1));
                            const moving = [
                              { axis: 'x' as const, at: b0.l, dv: b1.l - b0.l },
                              { axis: 'x' as const, at: b0.r, dv: b1.r - b0.r },
                              { axis: 'y' as const, at: b0.t, dv: b1.t - b0.t },
                              { axis: 'y' as const, at: b0.b, dv: b1.b - b0.b },
                            ].filter(v => Math.abs(v.dv) > 1e-5)
                              .sort((a, b) => Math.abs(b.dv) - Math.abs(a.dv))[0];
                            if (moving) {
                              /* 擠壓只認頁面的最外框，不跟其他物件互吸。多頁時每一頁
                                 都是自己的畫布，因此取目前物件附近頁面的四邊。 */
                              const nearby = getAllPageRects();
                              const lines = moving.axis === 'x'
                                ? nearby.flatMap(p => [p.left, p.right])
                                : nearby.flatMap(p => [p.top, p.bottom]);
                              const threshold = 4 / Math.max(0.001, kRef.current || 1);
                              const line = lines.slice().sort((a, b) => Math.abs(a - moving.at) - Math.abs(b - moving.at))[0];
                              if (line !== undefined && Math.abs(line - moving.at) < threshold) {
                                const snapQ = q + (line - moving.at) / moving.dv;
                                if (snapQ >= 24) {
                                  next = geometryAt(snapQ);
                                  nextGuidelines = [{ type: moving.axis === 'x' ? 'vertical' : 'horizontal', coord: line }];
                                }
                              }
                            }
                          }
                          queueInteraction(() => {
                            setActiveGuidelines(nextGuidelines);
                            setFloatingImages(prev => prev.map(item => item.id === fImg.id
                              ? { ...item, ...next }
                              : item));
                          });
                        }}
                        onScaleEnd={() => {
                          flushInteractionNow();
                          setActiveGuidelines([]);
                        }}
                      />
                    ))}

                    {/* 畫筆是獨立向量圖層：一筆一個 path，因此可以選取、復原、
                        儲存與輸出；整張 SVG 橫跨全部頁面，筆畫不會在頁縫被截斷。 */}
                    {brushStrokes.map(s => (
                      <svg key={s.id}
                        className="absolute left-0 top-0 pointer-events-none overflow-visible"
                        width={pages.length * previewW} height={previewH}
                        viewBox={`0 0 ${pages.length * previewW} ${previewH}`}
                        style={{ zIndex: 60 + s.z * 2 }}>
                        <defs>
                          <filter id={`classic-crayon-${s.id}`} x="-20%" y="-20%" width="140%" height="140%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="8" result="noise" />
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.55" />
                          </filter>
                          <filter id={`classic-highlight-${s.id}`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.15" /></filter>
                          <filter id={`classic-soft-${s.id}`} x="-30%" y="-30%" width="160%" height="160%">
                            <feGaussianBlur stdDeviation={Math.max(0, (100 - s.hardness) / 100 * s.width * .12)} />
                          </filter>
                        </defs>
                        <path data-brush-id={s.id} d={brushPath(s)} fill="none"
                          stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round"
                          strokeDasharray={s.kind === 'dash' ? `${Math.max(4, s.width * 1.4)} ${Math.max(3, s.width)}` : undefined}
                          opacity={s.kind === 'highlight' ? .36 : s.kind === 'pencil' ? .82 : 1}
                          filter={s.kind === 'crayon' ? `url(#classic-crayon-${s.id})` : s.kind === 'highlight' ? `url(#classic-highlight-${s.id})` : s.kind === 'normal' && s.hardness < 96 ? `url(#classic-soft-${s.id})` : undefined}
                        />
                      </svg>
                    ))}

                    {/*
                      唯一的頁面分割線層。它位於圖片／影片／佈局／文字／符號／
                      圖形／筆畫之上，選中框專用 chromeLayer 之下。一般狀態與
                      對齊狀態都沿用同一個 1px 螢幕線寬，避免跨過物件時因不同
                      合成表面取樣而看成另一條較細的線。
                    */}
                    {/* Seam ink is painted once by the screen-density scene. */}

                    {selectedBrushId && (() => {
                      const stroke = brushStrokes.find(s => s.id === selectedBrushId);
                      if (!stroke) return null;
                      const b = brushBounds(stroke);
                      return (
                        <div data-brush-id={stroke.id} className="absolute pointer-events-none border border-dashed border-white/95"
                          style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 500001,
                            boxShadow: '0 1px 3px rgba(0,0,0,.42)' }}>
                          <div
                            className="absolute left-1/2 top-full mt-2 -translate-x-1/2 h-9 px-1 rounded-full bg-white text-black flex items-center pointer-events-auto"
                            style={{ boxShadow: `0 ${3 / Math.max(0.0001, kRef.current)}px ${10 / Math.max(0.0001, kRef.current)}px rgba(0,0,0,0.22)` }}
                          >
                            <button className="w-8 h-8 rounded-full flex items-center justify-center" title="下移一層"
                              onClick={() => setBrushStrokes(v => v.map(x => x.id===stroke.id ? {...x,z:Math.max(0,x.z-1)} : x))}><MoveDown size={14}/></button>
                            <button className="w-8 h-8 rounded-full flex items-center justify-center" title="上移一層"
                              onClick={() => setBrushStrokes(v => v.map(x => x.id===stroke.id ? {...x,z:Math.min(layerStack.length+v.length,x.z+1)} : x))}><MoveUp size={14}/></button>
                            <button className="w-8 h-8 rounded-full flex items-center justify-center" title="刪除"
                              onClick={() => { setBrushStrokes(v=>v.filter(x=>x.id!==stroke.id)); setSelectedBrushId(null); }}><Trash2 size={14}/></button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 選取一張圖之後原本會蓋上一層 touch-action:none 的全畫布拖曳層，
                        「從任何地方都能拖」的代價是畫布完全不能左右滑。已移除 ——
                        要移動圖片直接拖那張圖即可，點空白處仍然是取消選取。 */}

                    {/* Alignment guides share the screen-density scene; no scaled DOM duplicate. */}
                  </div>

                </div>
                {/*
                  螢幕解析度外框層。刻意放在 pagesCol（transform: scale）外面、
                  stripShell 裡面：物件內容仍由單一矩陣平順縮放，操作 UI 則用
                  CSS zoom 直接以最後尺寸排版，不會把低倍率框線與圖示點陣放大。
                  座標仍是同一套未縮放頁面座標，所以不需要維護第二份幾何。
                */}
                <div
                  ref={setChromeLayerNode}
                  className="absolute pointer-events-none"
                  style={{
                    // Hide selection ink in the very first sorting frame. The
                    // effect that clears selection runs later; a page-filling
                    // photo's white selection stroke must not flash around the
                    // page while the content starts its transition.
                    // Descendants explicitly set visibility:visible, which
                    // overrides an inherited hidden value. Remove this entire
                    // UI paint subtree during the mode transition instead.
                    display: pagesMode || pagesVisual ? 'none' : undefined,
                    left: stripSubpixelXRef.current,
                    top: 0,
                    width: `${pages.length * previewW}px`,
                    height: `${previewH}px`,
                    zoom: pagesScale,
                    zIndex: 500000,
                  } as React.CSSProperties}
                />
                </div>

                {/* Plus Button to add more pages (Maximum 25 pages total, i.e., addedPagesCount < 24) */}
                {addedPagesCount < 24 && (
                  <button
                    ref={addPageBtnRef}
                    data-classic-add-page="1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddedPagesCount(prev => prev + 1);
                    }}
                    className="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/25 flex items-center justify-center text-white ml-3 cursor-pointer shadow-lg"
                    title="新增一頁"
                  >
                    <Plus size={20} />
                  </button>
                )}

                {/*
                  右邊的留白：剛好留到「最後一頁停在正中間」為止，多一分就會捲過頭
                  看到一大片黑。左邊的 margin 不算進捲動範圍，所以右邊要補一份
                  一樣的 stripOffset，再扣掉加號按鈕（ml-3 + 40）已經佔掉的部分。
                  寬度跟外殼一樣由 applyStripGeometry 每一帧寫。
                */}
                <div ref={stripPadRef} className="flex-shrink-0" />
              </div>
            );
          })()}
        </div>

        {/* 與創意拼圖同款播放列：從工具列下方滑入，預覽同時平順縮小讓位。 */}
        {motionBarMounted && (
          <div
            ref={motionBarRef}
            data-classic-motion-time={motionTime.toFixed(3)}
            className="absolute left-3 right-3 bottom-3 z-40 flex items-center gap-2 rounded-2xl bg-black/55 backdrop-blur-md border border-white/10 px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            style={{
              opacity: motionBarIn ? 1 : 0,
              transform: motionBarIn ? 'translateY(0)' : 'translateY(130px)',
              transition: 'transform 420ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 420ms cubic-bezier(0.22, 0.61, 0.36, 1)',
              pointerEvents: motionBarIn ? 'auto' : 'none',
            }}
            onPointerDown={e => e.stopPropagation()}
          >
            <button
              onClick={() => setMotionPlaying(v => !v)}
              data-classic-motion-play="1"
              title={motionPlaying ? '暫停' : '播放'}
              className={`h-9 w-11 shrink-0 rounded-[8px] border flex items-center justify-center transition-all active:scale-90 ${
                motionPlaying ? 'bg-transparent text-white border-white' : 'bg-white text-black border-white'
              }`}
            >
              {motionPlaying
                ? <Pause size={15} fill="currentColor" strokeWidth={0} />
                : <Play size={15} fill="currentColor" strokeWidth={0} />}
            </button>
            <button
              onClick={replayMotion}
              data-classic-motion-replay="1"
              title="從頭播"
              className="h-9 w-11 shrink-0 rounded-[8px] border border-white/15 text-white/70 hover:bg-white/10 hover:text-white flex items-center justify-center transition-all active:scale-90"
            >
              <ReplayIcon size={15} />
            </button>
            <div className="flex-1 min-w-0">
              <CompactSlider
                label="循環間隔"
                value={pageVideoItems.length ? Number(pageVideoDuration.toFixed(1)) : Math.round(motionHold)}
                min={0} max={pageVideoItems.length ? Math.max(1, Math.ceil(pageVideoDuration)) : 20}
                step={pageVideoItems.length ? .1 : 1}
                decimals={pageVideoItems.length ? 1 : 0}
                fixedDecimals={pageVideoItems.length > 0}
                disabled={pageVideoItems.length > 0}
                onChange={(v: number) => { if (!pageVideoItems.length) setMotionHold(v); }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Tabbed Controller */}
      {/* 高度所有分頁都一樣：切到圖片編輯時畫布不會突然變小。
          下限是編輯那組操作欄的實際高度（分頁列＋80＋96＋77），
          螢幕夠高就用 36dvh。 */}
      <footer
        className="bg-[#0a0a0a] border-t border-[#1a1a1a] flex flex-col z-[50] no-select shrink-0 transition-transform duration-300 ease-out"
        data-classic-controller
        style={{ height: 'max(36dvh, 310px)', visibility: igPreview ? 'hidden' : undefined }}
      >
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Tabs list */}
          <div className="flex px-4 pt-1 border-b border-[#1a1a1a] shrink-0 overflow-x-auto overflow-y-hidden touch-pan-x no-scrollbar">
            {['ratio', 'pages', 'add', 'adjust', 'color', 'motion'].map(id => {
              let iconEl = null;
              let titleText = '';
              if (id === 'ratio') {
                iconEl = <Crop size={18} />;
                titleText = '版型比例';
              } else if (id === 'add') {
                iconEl = <Plus size={18} />;
                titleText = '新增內容';
              } else if (id === 'adjust') {
                iconEl = <SlidersHorizontal size={18} />;
                titleText = '編輯';
              } else if (id === 'pages') {
                iconEl = <GalleryHorizontal size={18} />;
                titleText = '頁面順序';
              } else if (id === 'color') {
                iconEl = <Palette size={18} />;
                titleText = '背景顏色';
              } else if (id === 'motion') {
                iconEl = <Film size={16} />;
                titleText = '動畫';
              }

              const isActive = activeTab === id || (id === 'add' && activeTab === 'layout');

              return (
                <button 
                  key={id} 
                  onClick={() => {
                    if (id !== activeTab) stopPreviewForModeChange();
                    setActiveTab(id as any);
                    /* 已經點進「新增符號／新增圖形」的時候再點一次加號，
                       就回到新增的主頁 —— 不必特地去按左上角的返回鍵。 */
                    if (id === 'add') setAddSub('root');
                    if (id === 'color') setColorPickerActive(true);
                  }} 
                  className={`flex-1 min-w-[70px] py-4 border-b-2 transition-colors duration-150 flex flex-col items-center justify-center gap-1 ${
                    isActive ? 'text-white border-white' : 'text-[#444] border-transparent hover:text-[#777]'
                  }`}
                  title={titleText}
                >
                  {iconEl}
                </button>
              );
            })}
          </div>

          {/* Tabs Content */}
          <div className={`flex-1 min-h-0 no-scrollbar ${imageEditMode ? '' : textEditMode ? 'px-4 py-0' : 'p-4 pb-4'} ${['ratio', 'color', 'layout', 'adjust', 'pages'].includes(activeTab) ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}>

            {activeTab === 'motion' && (() => {
              const target = motionItems.find(f => f.id === motionTargetId) || null;
              const targetIsImage = !!target && target.text === undefined && !target.shape;
              const rawCfg = classicObjectMotionOf(target?.mo);
              const cfg = targetIsImage && rawCfg.idle === 'spin'
                ? { ...rawCfg, idle: 'image-breathe' }
                : rawCfg;
              const patchMotion = (d: Partial<ObjectMotionConfig>) => {
                if (!target) return;
                setFloatingImages(v => v.map(f => f.id === target.id ? { ...f, mo: { ...cfg, ...d } } : f));
              };
              const isGridTarget = !!target?.shape && GRID_SHAPE_KINDS.has(target.shape);
              const isSpecialLineTarget = !!target?.shape && SPECIAL_LINE_KINDS.has(target.shape);
              const isTextTarget = target?.text !== undefined && !target.sym;
              const baseIntro = OBJECT_IN_KINDS.filter(([id]) => id !== 'bounce');
              const introKinds = target?.sym
                ? SYMBOL_OBJECT_IN_KINDS.filter(([id]) => id !== 'bounce')
                : isGridTarget
                  ? baseIntro.map(([id, name]) => id === 'spin' && target.shape === 'grid-orbits' ? ['signal', '信號'] as const : id === 'spring' ? ['grid-wave', '波浪'] as const : [id, name] as const)
                  : isSpecialLineTarget
                    ? [...baseIntro.filter(([id]) => id !== 'spring'), ['draw', '畫筆'] as const]
                    : baseIntro;
              const baseIdle = OBJECT_IDLE_KINDS
                .filter(([id]) => id !== 'symbol-breathe2')
                .map(([id, name]) => id === 'breathe' ? [id, '縮放'] as const : [id, name] as const);
              const idleKinds = target?.sym
                ? baseIdle.filter(([id]) => id !== 'grid-wave').flatMap(([id, name]) =>
                    id === 'breathe' ? [[id, '縮放I'] as const, ['symbol-breathe2', '縮放II'] as const] : [[id, name] as const])
                : isTextTarget
                  ? baseIdle.filter(([id]) => id !== 'spin').flatMap(([id, name]) =>
                      id === 'breathe' ? [[id, '縮放'] as const, ['symbol-breathe2', '縮放II'] as const] : [[id, name] as const])
                  : targetIsImage
                    ? baseIdle.map(([id, name]) => id === 'spin' ? ['image-breathe', '呼吸'] as const : [id, name] as const)
                    : baseIdle.map(([id, name]) => id === 'spin' && target?.shape === 'grid-orbits' ? ['signal', '信號'] as const : [id, name] as const);
              const pickIntro = (id: string) => {
                patchMotion(id === 'bubble' ? { in: id, dur: motionDurationFromUi(80) } : { in: id });
                replayMotion();
              };
              const pickIdle = (id: string) => {
                patchMotion({ idle: id, ...idleDefaults(id, { symbol: !!target.sym, text: isTextTarget, image: targetIsImage, shape: !!target.shape, grid: isGridTarget, line: isSpecialLineTarget }) });
                replayMotion();
              };
              const chip = (on: boolean) => `px-3 h-8 shrink-0 rounded-[8px] border text-[11px] font-bold tracking-wider transition-all flex items-center gap-1.5 ${on ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`;
              const cell = (on: boolean) => `h-9 rounded-[8px] border text-[10px] font-bold tracking-wider transition-all ${on ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`;
              return (
                <div className="max-w-md mx-auto pb-5 animate-in fade-in duration-300">
                  <div data-classic-motion-targets="1" className="flex gap-2 overflow-x-auto no-scrollbar [&::-webkit-scrollbar]:hidden pb-1">
                      {motionItems.map((f) => {
                        const media = motionItems.filter(x => x.text === undefined && !x.shape);
                        const shapes = motionItems.filter(x => !!x.shape);
                        return (
                        <button key={f.id} onClick={() => chooseMotionTarget(f.id)}
                          className={chip(motionTargetId === f.id)}>
                          <span>{f.sym ? '符號' : f.text !== undefined ? '文字' : f.shape
                            ? `圖形${shapes.length > 1 ? shapes.findIndex(x => x.id === f.id) + 1 : ''}`
                            : `圖片${media.length > 1 ? media.findIndex(x => x.id === f.id) + 1 : ''}`}</span>
                        </button>
                      );})}
                  </div>
                  {!target ? <p data-no-motion-items="1" className="text-[11px] text-white/40 text-center pt-8">沒有可編輯項目</p> : <>
                    <p className="text-[10px] font-bold text-[#666] uppercase tracking-widest mb-2 mt-4">進場動畫</p>
                    <div className="grid grid-cols-4 gap-2">{introKinds.map(([id,name]) => <button key={id} className={cell(cfg.in===id)} onClick={()=>pickIntro(id)}>{name}</button>)}</div>
                    <div className="grid grid-cols-2 gap-x-7 gap-y-4 mt-3">
                      <CompactSlider label="起始" value={Number(cfg.delay.toFixed(1))} min={0} max={3} step={.1} decimals={1} fixedDecimals onCommit={replayMotion} onChange={(v:number)=>patchMotion({delay:v})}/>
                      <CompactSlider label="速度"
                        value={cfg.in === 'bubble' && target.sym
                          ? Math.round((motionUiFromDuration(cfg.dur) - 50) * 2)
                          : motionUiFromDuration(cfg.dur)}
                        min={0} max={100} step={1} onCommit={replayMotion}
                        onChange={(v:number)=>patchMotion({dur:motionDurationFromUi(cfg.in === 'bubble' && target.sym ? 50 + v / 2 : v)})}/>
                    </div>
                    <p className="text-[10px] font-bold text-[#666] tracking-widest mb-2 mt-4">常駐動畫</p>
                    <div className="grid grid-cols-4 gap-2">{idleKinds.map(([id,name]) => <button key={id} className={cell(cfg.idle===id)} onClick={()=>pickIdle(id)}>{name}</button>)}</div>
                    {cfg.idle !== 'none' && <div className="grid grid-cols-2 gap-x-7 gap-y-4 mt-3">
                      <CompactSlider key={`${target.id}-${cfg.idle}-amp`} label="幅度"
                        value={cfg.idle === 'image-breathe' && targetIsImage ? imageBreathAmpToUi(cfg.amp) : cfg.amp}
                        min={0} max={100} step={1} onCommit={replayMotion}
                        onChange={(v:number)=>patchMotion({amp:cfg.idle === 'image-breathe' && targetIsImage ? imageBreathAmpFromUi(v) : v})}/>
                      <CompactSlider key={`${target.id}-${cfg.idle}-speed`} label="速度"
                        value={cfg.idle === 'image-breathe' && targetIsImage
                          ? imageBreathSpeedToUi(cfg.speed)
                          : cfg.idle === 'symbol-breathe2' && (target.sym || isTextTarget)
                          ? Math.round(Math.max(0, Math.min(100, (cfg.speed * 100 - 70) / 1.1)))
                          : cfg.idle === 'grid-wave' && !target.shape && !isGridTarget
                            ? Math.round(Math.max(0, Math.min(100, (cfg.speed * 100 - 100) / 1.5)))
                            : cfg.idle === 'grid-wave' ? Math.round(Math.max(0, Math.min(100, (cfg.speed - .2) / 1.8 * 100)))
                            : Math.round(cfg.speed*100)}
                        min={cfg.idle === 'image-breathe' && targetIsImage || cfg.idle === 'symbol-breathe2' && (target.sym || isTextTarget) || cfg.idle === 'grid-wave' ? 0 : 20}
                        max={cfg.idle === 'image-breathe' && targetIsImage || cfg.idle === 'symbol-breathe2' && (target.sym || isTextTarget) || cfg.idle === 'grid-wave' ? 100 : 180}
                        step={1} onCommit={replayMotion}
                        onChange={(v:number)=>patchMotion({speed: cfg.idle === 'image-breathe' && targetIsImage
                          ? imageBreathSpeedFromUi(v)
                          : cfg.idle === 'symbol-breathe2' && (target.sym || isTextTarget) ? (70 + v * 1.1) / 100
                          : cfg.idle === 'grid-wave' && !target.shape && !isGridTarget ? (100 + v * 1.5) / 100 : cfg.idle === 'grid-wave' ? .2 + v * .018 : v/100})}/>
                    </div>}
                  </>}
                </div>
              );
            })()}

            {activeTab === 'adjust' && !layoutEditMode && (() => {
              /* 佈局裡的格子也走同一套面板：把格子包成跟浮動圖片一樣的形狀，
                 面板本身完全不用改，寫回去的時候再導到格子上。 */
              const selCell = selectedFloatingId ? null
                : (selectedIndex !== null && selectedLayoutId
                    ? (activePage.layouts.find(l => l.id === selectedLayoutId)?.images[selectedIndex] || null)
                    : null);
              const layer = floatingImages.find(f => f.id === selectedFloatingId)
                || (selCell && selCell.url
                    ? ({ id: selCell.id, src: selCell.url, fx: selCell.fx } as unknown as FloatingImage)
                    : undefined);
              // 什麼都沒選：只給提示
              if (!layer) return (
                // 置中之後再稍微往上一點（pb 讓可用高度變矮，等於整段往上挪 12px）
                <div className="h-full flex items-center justify-center pb-6">
                  <p className="text-[11px] text-white/40 text-center">請選中要編輯的物件</p>
                </div>
              );

              // 選到文字：走文字那一套面板（同一個分頁、不同介面）。
              // 符號走同一顆面板的精簡模式（顏色、大小、發光）。
              if (layer.text !== undefined) {
                return (
                  <TextEditorPanel
                    key={`text-editor-${layer.id}-${objectEditorRevision}`}
                    layer={layer}
                    symbol={!!layer.sym}
                    onChange={patch => patchTextLayer(layer.id, withGlowInit(layer, patch))}
                    onTuningChange={active => handleVectorTuning(layer.id, active)}
                  />
                );
              }

              // 選到圖形：顏色／粗細／虛線
              if (layer.shape) {
                return (
                  <ShapeEditorPanel
                    key={`shape-editor-${layer.id}-${objectEditorRevision}`}
                    layer={layer}
                    onChange={patch => patchTextLayer(layer.id, withGlowInit(layer, patch))}
                    onTuningChange={active => handleVectorTuning(layer.id, active)}
                  />
                );
              }

              /* ── 選到圖片：跟「編輯」完全一樣的三段式操作欄 ───────────────
                 上：一根滑桿（5rem）／中：工具列（6rem）／下：分類列（h-16＋底部空隙） */
              const img = layer;
              const set = (patch: Partial<FloatingImage>) => {
                if (selCell) {
                  // 只有格子真的有的欄位才寫回去，其餘忽略
                  const cellPatch: Partial<ImageCell> = {};
                  if ('fx' in patch) cellPatch.fx = (patch as any).fx;
                  if (!Object.keys(cellPatch).length) return;
                  if(cellPatch.fx){pendingCellFx.current.set(selCell.id,cellPatch.fx);updateCellPhoto(selCell.id,cellPatch.fx);}
                  return;
                }
                setFloatingImages(prev => prev.map(f => (f.id === img.id ? { ...f, ...patch } : f)));
              };
              return (
                <ImageAdjustPanel
                  img={img} set={set} lutList={lutList}
                  loadingLut={loadingLut} setLoadingLut={setLoadingLut}
                  lutRevision={lutRevision} setLutRevision={setLutRevision}
                  adjustSub={adjustSub} setAdjustSub={setAdjustSub}
                  effectCard={effectCard} setEffectCard={setEffectCard}
                  effectDetail={effectDetail} setEffectDetail={setEffectDetail}
                  shapeMenu={shapeMenu} setShapeMenu={setShapeMenu}
                  shapeTool={shapeTool} setShapeTool={setShapeTool}
                  tuneTool={tuneTool} setTuneTool={setTuneTool}
                  setTuningEdge={setTuningEdge} openComposeFor={openComposeFor}
                  composeOpen={!!composeState} onLeaveCompose={applyComposeToLayer}
                  hideShape={!!selCell}
                  isolateFxUpdates={!!selCell}
                  onAdjustmentCommit={selCell?commitCellFx:undefined}
                />
              );
            })()}

            {activeTab === 'add' && (
              <div className="max-w-md mx-auto space-y-4 animate-in fade-in duration-300">
                {addSub === 'symbol' ? (
                  <SymbolPicker
                        onBack={() => setAddSub('root')}
                        onPrepare={(symbol) => { prepareAddSymbolLayer(symbol); }}
                        onPick={handleAddSymbolLayer}
                      />
                ) : addSub === 'root' ? (
                  /* 六顆分兩排，各三顆。
                     第一排是「這一頁要放什麼進來」（佈局／圖片／影片），
                     第二排是「這個 App 自己生的東西」（文字／符號／圖形）——
                     跟創意拼圖那邊的分法一致。
                     全部擠在同一排的話每顆只剩七十幾寬，字都快貼到邊了。
                     兩排都用同一個 max-w，所以每顆按鈕一樣大。

                     key 是必要的：兩個分頁的最外層都是 <div>，沒有 key 的話
                     React 會把它們當成同一顆、只換 className —— 於是清單那邊的
                     <button> 被留下來直接變成這一頁的按鈕，而按鈕上掛著
                     transition-all，就從「返回鍵那個大小」一路補間到正常大小。
                     那就是返回時看到的抖動。給了 key 就是整片換掉，不會補間。 */
                  <div key="add-root" className="flex flex-col gap-1.5 mt-6">
                  <div className="flex justify-center gap-1.5">
                  <button
                    onClick={() => {
                      setActiveTab('layout');
                    }}
                    className="flex flex-col items-center justify-center py-4 px-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    <Icon name="grid_view" className="text-[24px] text-white/80" />
                    <span className="text-[11px] font-bold tracking-widest text-white/90 whitespace-nowrap">新增佈局</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center py-4 px-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    <Icon name="add_photo_alternate" className="text-[24px] text-white/80" />
                    <span className="text-[11px] font-bold tracking-widest text-white/90 whitespace-nowrap">匯入圖片</span>
                  </button>
                  {/* 影片：圖示用 lucide 的 Film，跟創意拼圖那顆同一個 */}
                  <button
                    onClick={() => vidInputRef.current?.click()}
                    className="flex flex-col items-center justify-center py-4 px-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    <Film size={24} strokeWidth={1.5} className="text-white opacity-80" />
                    <span className="text-[11px] font-bold tracking-widest text-white/90 whitespace-nowrap">匯入影片</span>
                  </button>
                  </div>
                  <div className="flex justify-center gap-1.5">
                  <button
                    onClick={() => handleAddTextLayer()}
                    className="flex flex-col items-center justify-center py-4 px-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    {/* 跟文字編輯面板裡「字體」那一顆同一個圖示。
                        線寬調細對齊旁邊兩顆 Material 圖標；透明度改成掛在整個
                        圖示上（opacity-80）而不是筆畫顏色上（text-white/80）——
                        半透明的筆畫在交疊處會疊出更亮的一塊，看起來就是發白。 */}
                    <Type size={24} strokeWidth={1.5} className="text-white opacity-80" />
                    <span className="text-[11px] font-bold tracking-widest text-white/90 whitespace-nowrap">新增文字</span>
                  </button>
                  {/* 新增符號：內容之後再補，先把位置與外觀定下來 */}
                  <button
                    onClick={() => setAddSub('symbol')}
                    className="flex flex-col items-center justify-center py-4 px-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    {/* 圖示不能用 Material 的 emoji_symbols：專案裡那份是**子集**，
                        只打包了真的有用到的 73 顆，emoji_symbols 不在裡面 ——
                        用了會直接把「emoji_symbols」這串英文字印在按鈕上、
                        還會撐爆格子蓋到隔壁兩顆。改用跟旁邊「新增文字」「新增圖形」
                        同一套的 lucide 線條圖示。 */}
                    <span className="text-white opacity-80 h-6 flex items-center" data-add-symbol-icon="vortex" style={{transform:'translateX(-1.125px)'}}><VortexIcon size={18} /></span>
                    <span className="text-[11px] font-bold tracking-widest text-white/90 whitespace-nowrap">新增符號</span>
                  </button>
                  <button
                    onClick={() => setAddSub('shape')}
                    className="flex flex-col items-center justify-center py-4 px-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                  >
                    <Blocks size={24} strokeWidth={1.5} className="text-white opacity-80 translate-x-px" />
                    <span className="text-[11px] font-bold tracking-widest text-white/90 whitespace-nowrap">新增圖形</span>
                  </button>
                  </div>
                  </div>
                ) : (
                  /* 點進「新增圖形」才看得到的圖案清單。
                     三排：實心、細框、線條，點一下就加到這一頁的正中間 ——
                     不會跳去編輯頁，所以可以連著加好幾個。
                     （key 的理由見上面那一頁） */
                  <div key="add-shape" className="pt-1">
                    <div className="flex items-center gap-2 mb-3">
                      {/* 跟登入／帳號頁那顆同款：只有一個箭頭，沒有底下的圓 */}
                      <button
                        onClick={() => setAddSub('root')}
                        aria-label="返回"
                        title="返回"
                        className="shrink-0 w-9 h-9 -ml-2 flex items-center justify-center text-white/60 hover:text-white active:scale-90 transition-[color,transform]"
                      >
                        <Icon name="arrow_back" className="text-[20px]" />
                      </button>
                      <span className="text-[10px] font-bold text-[#888] uppercase tracking-widest">新增圖形</span>
                    </div>
                    {(() => {
                      /* 清單跟創意拼圖同一份：實心那排把十字星插在倒數第二，
                         後面接上從圖案借過來的那幾顆；邊框那排接空心版的十字星。
                         再用 moveTo 把兩排排成同樣的順序（愛心第 9、十字星第 11）。 */
                      const ins = (arr: any[], item: any) => {
                        const n = arr.slice();
                        n.splice(Math.max(0, n.length - 1), 0, item);
                        return n;
                      };
                      /** 把 id 是這個的那一顆搬到第 m 個位置（從 1 算起）。用 id 找而不是用
                          位置找 —— 清單中間再插新圖形時才不會位移到別顆身上。 */
                      const moveTo = (arr: any[], id: string, m: number) => {
                        const i = arr.findIndex(z => z.id === id);
                        if (i < 0) return arr;
                        const n = arr.slice();
                        const [x] = n.splice(i, 1);
                        n.splice(Math.max(0, m - 1), 0, x);
                        return n;
                      };
                      /* 外圈星星是使用者指定的第二排星星序列之一，不跟其餘
                         複合圖形一起搬到清單尾端。舊草稿中的外圈愛心仍可讀取，
                         但新增清單已移除。 */
                      const compositeItems = ADD_SHAPE_ITEMS.filter(i => i.filled
                        && COMPOSITE_SHAPE_KINDS.has(i.kind) && i.kind !== 'star-double');
                      const ordinarySolid = moveTo(
                        ins(ADD_SHAPE_ITEMS.filter(i => i.filled
                          && (!COMPOSITE_SHAPE_KINDS.has(i.kind) || i.kind === 'star-double')), HOLE_ITEM_CROSS),
                        'heart-f', 9);
                      /* 四顆方形複合圖形固定放在第三排前四格（第 13–16 顆）。
                         借用圖案的額外項目排在它們後面，之後新增項目也不會再
                         把這四顆推到清單尾端。 */
                      const solidList = [
                        ...ordinarySolid.slice(0, 12),
                        ...compositeItems,
                        ...ordinarySolid.slice(12),
                        ...HOLE_ITEMS_EXTRA,
                      ];
                      /* 邊框那排的順序跟實心那排對齊：第 6 顆窄菱形、第 9 顆愛心、
                         第 11 顆十字星，後面才接新加的橢圓／各種比例的框／雲朵／對話框。 */
                      const lineList = moveTo(moveTo(moveTo(moveTo(
                        [...ADD_SHAPE_ITEMS.filter(i => !i.filled && !SPECIAL_LINE_KINDS.has(i.kind)), HOLE_ITEM_CROSS_O],
                        'diamond-n-o', 6), 'heart-o', 9), 'cloud-oval-o', 13), 'hole-cross-star-o', 14);
                      return ([
                        ['實心', solidList.filter(i => !GRID_SHAPE_KINDS.has(i.kind))],
                        ['邊框', lineList.filter(i => !GRID_SHAPE_KINDS.has(i.kind))],
                        ['線條', ADD_SHAPE_ITEMS.filter(i => SPECIAL_LINE_KINDS.has(i.kind))],
                        ['網格', ADD_SHAPE_ITEMS.filter(i => GRID_SHAPE_KINDS.has(i.kind))],
                        ['遮罩', MASK_SHAPE_ITEMS],
                      ] as const);
                    })().map(([label, list]) => (
                      <div key={label} className="mb-3">
                        <div className="text-[9px] font-bold text-[#666] mb-1.5 tracking-widest">{label}</div>
                        <div className="grid grid-cols-6 gap-2">
                          {list.map(it => (
                            <button
                              key={it.id}
                              onClick={() => handleAddShapeLayer(it)}
                              aria-label={'label' in it ? String(it.label) : it.id}
                              title={'label' in it ? String(it.label) : it.id}
                              className="h-11 rounded-[10px] bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center text-white/85"
                            >
                              {(it as any).hole
                                ? <HoleGlyph s={(it as any).hole} filled={(it as any).filled} />
                                : <ShapeGlyph item={it as any} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(activeTab === 'layout' || layoutEditMode) && (
              <div data-layout-panel="1" className="w-full min-w-0 mx-auto h-full flex flex-row animate-in fade-in duration-300">
                <div
                  key={activeTab === 'layout' ? 'layout-create' : `layout-edit-${selectedLayoutId}`}
                  className={`w-full min-w-0 flex-1 h-full ${activeTab === 'layout' ? 'overflow-y-auto overflow-x-hidden no-scrollbar' : 'overflow-hidden'}`}
                  data-layout-editor={layoutEditMode ? 'true' : undefined}
                  style={{ overscrollBehavior: 'none' }}
                >
                  {activeTab === 'layout' ? (
                    allTemplatesFlattened.length > 0 ? (
                      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 pb-10">
                        {allTemplatesFlattened.map(({ count, idx, tmpl }) => {
                          return (
                            <button
                              key={`${count}-${idx}-${tmpl.name}`}
                              onClick={() => {
                                handleAddLayoutToPage(activePageIndex, idx, count);
                              }}
                              className="p-1.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all text-center aspect-square bg-white/[0.02] border-white/5 hover:border-white/15 hover:bg-white/[0.04] opacity-90"
                              title={`${count}張: ${tmpl.name}`}
                            >
                              <svg viewBox="0 0 100 100" className="w-full h-full text-white/60">
                                {tmpl.rects.map((rect, rIdx) => (
                                  <rect
                                    key={rIdx}
                                    x={rect.x * 100 + 4}
                                    y={rect.y * 100 + 4}
                                    width={rect.w * 100 - 8}
                                    height={rect.h * 100 - 8}
                                    rx={4}
                                    fill="currentColor"
                                    fillOpacity="0.1"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    className="opacity-80"
                                  />
                                ))}
                              </svg>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-white/40 text-center py-4">
                        請先新增格子以選擇格局。
                      </div>
                    )
                  ) : !selectedLayoutId ? (
                    /* 沒選中佈局就不知道要調哪一個，滑桿整組不顯示 */
                    <div className="h-full flex items-center justify-center px-4">
                      <p className="text-[11px] font-bold tracking-[0.15em] text-white/40 text-center">
                        先點擊一下要調整的佈局
                      </p>
                    </div>
                  ) : (
                    /* Adjustment sliders - top aligned, smooth and stable without layout jitter */
                    <div className="w-full min-w-0 space-y-4">
                      {/* 這個佈局自己的比例。跟最左邊那一頁的「版型比例」是兩回事：
                          那邊調的是整張頁面，這裡只調選中的這一個佈局。
                          按鍵樣式跟那一頁同一套；直式／橫式不再包一層底色格子，
                          改成跟上面同一種 grid（同樣的 gap），
                          所以兩顆的左右外緣剛好對齊上面那排比例鍵。
                          佈局比例始終獨立保存，不跟著整頁比例一起改。 */}
                      <div className="space-y-1.5">
                        {/* 這一排只放名稱。右邊本來會再寫一次目前的比例，
                            但下面那五顆按鈕自己就會反白標示，寫兩次是重複的。 */}
                        <div className="grid grid-cols-5 gap-1.5">
                          {RATIOS.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => {
                                if (selectedIndex !== null) setSelectedIndex(null);
                                patchLayoutShape({ ratio: item.id });
                              }}
                              className={`p-1 py-3 rounded-xl border text-center transition-all flex items-center justify-center ${
                                (layoutRatio || selectedRatio) === item.id
                                  ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                                  : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                              }`}
                            >
                              <div className="text-xs font-mono tracking-wider">
                                {item.id === '1:1'
                                  ? '1:1'
                                    : (activeLayout?.ratio ? layoutLandscape : isLandscape)
                                    ? `${item.id.split(':')[1]}:${item.id.split(':')[0]}`
                                    : item.name}
                              </div>
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => { if (selectedIndex !== null) setSelectedIndex(null); patchLayoutShape({ landscape: false }); }}
                            className={`py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                              !(activeLayout?.ratio ? layoutLandscape : isLandscape)
                                ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                                : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                            }`}
                          >
                            <Smartphone size={14} className="rotate-0 shrink-0" />
                            <span>直式</span>
                          </button>
                          <button
                            onClick={() => { if (selectedIndex !== null) setSelectedIndex(null); patchLayoutShape({ landscape: true }); }}
                            className={`py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                              (activeLayout?.ratio ? layoutLandscape : isLandscape)
                                ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                                : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                            }`}
                          >
                            <Smartphone size={14} className="rotate-90 shrink-0" />
                            <span>橫式</span>
                          </button>
                        </div>
                      </div>

                      {/* Gap slider */}
                      {isInsetLayout(activeLayout) ? <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-bold text-white/70"><span>大小</span><span className="font-mono text-white">{Math.round((Math.max(50, activeLayout?.overlaySize ?? 80) - 50) * 2)}</span></div>
                        <input aria-label="大小" type="range" min="0" max="100" step="1" value={(Math.max(50, activeLayout?.overlaySize ?? 80) - 50) * 2}
                          className="premium-slider w-full" onChange={e => patchActiveLayout(l => ({...l, overlaySize: 50 + Number(e.target.value) / 2}))} />
                      </div> : <>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-[11px] font-bold text-white/70">
                          <span>無縫拼圖</span>
                          <button role="switch" aria-label="無縫拼圖" aria-checked={!!activeLayout?.seamless}
                            onClick={() => patchActiveLayout(l => ({...l, seamless: !l.seamless, seamlessAmount: l.seamlessAmount ?? 0}))}
                            className={`w-10 h-6 rounded-full p-1 transition-colors ${activeLayout?.seamless ? 'bg-white' : 'bg-white/20'}`}>
                            <span className={`block w-4 h-4 rounded-full transition-transform ${activeLayout?.seamless ? 'translate-x-4 bg-black' : 'bg-white'}`} />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-5">
                        {activeLayout?.seamless && <SeamlessAmountSlider key={activeLayout.id} previewId={activeLayout.id} value={activeLayout.seamlessAmount??0}
                          onCommit={value=>patchActiveLayout(l=>({...l,seamlessAmount:value}))}/>}
                      {!activeLayout?.seamless && <>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-bold text-white/70">
                          <span>間距</span>
                          <span className="font-mono text-white">{gap}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="25"
                          step="1"
                          value={gap}
                          onChange={(e) => {
                            if (selectedIndex !== null) setSelectedIndex(null);
                            setGap(parseInt(e.target.value));
                          }}
                          className="premium-slider w-full"
                        />
                      </div>

                      {/* Radius slider */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-bold text-white/70">
                          <span>圓角</span>
                          <span className="font-mono text-white">{radius}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="30"
                          step="1"
                          value={radius}
                          onChange={(e) => {
                            if (selectedIndex !== null) setSelectedIndex(null);
                            setRadius(parseInt(e.target.value));
                          }}
                          className="premium-slider w-full"
                        />
                      </div>
                      </>}
                      </div>
                      </>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'ratio' && (
              <div data-page-ratio-panel="1" className="w-full min-w-0 mx-auto space-y-1.5 animate-in fade-in duration-300">
                <div className="grid grid-cols-5 gap-1.5">
                  {RATIOS.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => changePageShape(item.id)}
                      className={`p-1 py-3 rounded-xl border text-center transition-all flex items-center justify-center ${
                        selectedRatio === item.id
                          ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                          : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-mono tracking-wider">
                        {(() => {
                          if (item.id === '1:1') return '1:1';
                          if (isLandscape) {
                            const [w, h] = item.id.split(':');
                            return `${h}:${w}`;
                          }
                          return item.name;
                        })()}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => changePageShape(selectedRatio, false)}
                    className={`py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      !isLandscape
                        ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                        : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                    }`}
                  >
                    <Smartphone size={14} className="rotate-0 shrink-0" />
                    <span>直式</span>
                  </button>
                  <button
                    onClick={() => changePageShape(selectedRatio, true)}
                    className={`py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      isLandscape
                        ? 'bg-white border-white text-black font-extrabold shadow-[0_4px_16px_rgba(255,255,255,0.15)]'
                        : 'bg-white/[0.02] border-white/5 hover:border-white/15 text-white/70 hover:text-white'
                    }`}
                  >
                    <Smartphone size={14} className="rotate-90 shrink-0" />
                    <span>橫式</span>
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'color' && (colorSub === 'stripeA' || colorSub === 'stripeB') && (
              /* 條紋的兩個顏色：跟紋理顏色同一頁、同一組色票 */
              <div className="max-w-md mx-auto animate-in fade-in duration-200 h-full overflow-hidden no-scrollbar">
                <div>
                  <ColorPickerEmbedded
                    color={colorSub === 'stripeA' ? stripeA : stripeB}
                    colors={TEX_SWATCHES}
                    onChange={(c: string) => patchPattern(colorSub === 'stripeA' ? { stripeA: c } : { stripeB: c })}
                    onClose={() => setColorSub('bg')}
                    headerLeft={
                      <button
                        onClick={() => setColorSub('bg')}
                        className="flex items-center gap-1 px-2 h-7 rounded-[4px] text-[10px] font-bold text-[#888] hover:text-white hover:bg-[#1a1a1a] transition-colors"
                      >
                        <ChevronLeft size={14} />
                        <span>返回</span>
                      </button>
                    }
                  />
                </div>
              </div>
            )}

            {activeTab === 'color' && colorSub === 'pattern' && (
              /* 紋理專屬的調色頁：從紋理那一排的色塊點進來，跟創意拼圖一樣。
                 挑色器本身用的是跟底色完全同一顆元件。 */
              <div ref={colorTabRef} className="max-w-md mx-auto animate-in fade-in duration-200 h-full overflow-hidden no-scrollbar">
                {/* 返回鍵交給挑色器放在頂列，色號跟它平行 ——
                    色票那一排就整排都是色票，不會被色號擠掉一大截。 */}
                <div>
                  <ColorPickerEmbedded
                    color={patternColor}
                    colors={TEX_SWATCHES}
                    onChange={setPatternColor}
                    onClose={() => setColorSub('bg')}
                    headerLeft={
                      <button
                        onClick={() => setColorSub('bg')}
                        className="flex items-center gap-1 px-2 h-7 rounded-[4px] text-[10px] font-bold text-[#888] hover:text-white hover:bg-[#1a1a1a] transition-colors"
                      >
                        <ChevronLeft size={14} />
                        <span>返回</span>
                      </button>
                    }
                  />
                </div>
                <div className="h-2" />
              </div>
            )}

            {activeTab === 'color' && colorSub === 'bg' && (
              /* 工具欄維持共用高度；套用紋理才讓此頁捲動，不縮小預覽。 */
              <div ref={colorTabRef} data-classic-background-panel data-texture-active={patternType !== 'none'} className={`max-w-md mx-auto animate-in fade-in duration-300 h-full no-scrollbar ${patternType !== 'none' ? 'overflow-y-auto overflow-x-hidden overscroll-contain' : 'overflow-hidden'}`}>
                {/* 外面包一層高度 auto 的盒子：ColorPickerEmbedded 的根是 h-full，
                     直接放在這個「有固定高度」的捲動格裡會整個撐滿，把下面的紋理
                     推到很遠。包一層之後 100% 會解析成 auto，它就只佔自己需要的高度。 */}
                <div>
                  <ColorPickerEmbedded
                    color={bgColor}
                    onChange={setBgColor}
                    onClose={() => setActiveTab('layout')}
                  />
                </div>
                {/* 紋理整組收在同一格裡：選項、顏色、兩根滑桿都在同一個框內。
                    mt-5 是為了跟上面的底色挑色器拉開一點距離。 */}
                <div className="mt-2">
                  <div className="bg-[#111] border border-[#222] rounded-[6px] overflow-hidden">
                    <div className="h-[47px] flex items-center justify-between px-3">
                      <span className="text-[10px] font-bold text-[#888]">紋理</span>
                      {/* 顏色跟紋理選項同一排：點色塊才進紋理專屬的調色頁 */}
                      <div className="flex items-center gap-2">
                        <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                          {TEX_OPTIONS.map(([t, label]) => (
                            <button key={t} onClick={() => setPatternType(t)}
                              className={`px-2 h-6 text-[10px] font-bold rounded-[2px] transition-all ${patternType === t ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                        {/* 顏色格常駐：關閉時也看得到（可以先挑好顏色再打開），
                            而且切換時這一列的寬度不會變，就不會閃一下。
                            條紋有兩個顏色，所以放兩塊小的。 */}
                        {patternType === 'stripe' ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setColorSub('stripeA')}
                              title="條紋顏色一"
                              className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                              style={{ backgroundColor: stripeA }}
                            />
                            <button
                              onClick={() => setColorSub('stripeB')}
                              title="條紋顏色二"
                              className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                              style={{ backgroundColor: stripeB }}
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => setColorSub('pattern')}
                            title="紋理顏色"
                            className="w-8 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                            style={{ backgroundColor: patternColor }}
                          />
                        )}
                      </div>
                    </div>
                    {patternType === 'stripe' ? (
                      /* 條紋沒有間距（一條接著一條），只有條數；右邊那一格是方向。
                         滑桿左右各留 8px，畫出來的線才會收在自己那一欄裡。 */
                      <div className="grid grid-cols-2 gap-x-7 gap-y-4 px-3 pt-2 pb-3 border-t border-[#1c1c1c] items-end">
                        <div className="px-2">
                          {patternSlider('數量', stripeN, (v: number) => patchPattern({ stripeN: v }), STRIPE_N_MAX)}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] font-bold text-[#666] tracking-tighter uppercase">方向</span>
                          <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                            {STRIPE_DIRS.map(([d, label]) => (
                              <button key={d} onClick={() => patchPattern({ stripeDir: d })}
                                className={`flex-1 h-6 text-[10px] font-bold rounded-[2px] transition-all ${stripeDir === d ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : patternType !== 'none' && (
                      <div className="grid grid-cols-2 gap-x-7 gap-y-4 px-3 pt-2 pb-3 border-t border-[#1c1c1c]">
                        {patternSlider('大小', patternSize, setPatternSize)}
                        {patternSlider('間距', patternGap, setPatternGap)}
                        <div className="col-span-2">{patternSlider('壓扁', maskTextureSquashToUi(patternOpts.squash ?? 50), (v: number) => patchPattern({ squash: maskTextureSquashFromUi(v) }))}</div>
                      </div>
                    )}
                  </div>
                  <div data-classic-texture-bottom-space className={patternType !== 'none' ? 'h-[44px]' : 'h-2'} />
                </div>
              </div>
            )}


          </div>
        </div>
      </footer>

      {/* 頁面順序模式：每一頁正下方的握把與刪除鍵（貼在畫面上，不受畫布裁切影響） */}
      {pagesMode && pages.map((pg, ctlIdx) => {
        const dragging = pageDragIdx === ctlIdx;
        const ctl = { id: pg.id, idx: ctlIdx };
        // 拖曳的位移走 React、跟頁面內容同一次 render 寫出來：
        // 按鈕跟頁面才會「完完全全綁在一起」，不會一快一慢
        const shift = (() => {
          if (pageDragIdx !== null) {
            const off = pageDragOffset(ctl.idx);
            return { x: off.x * pagesScale, live: off.live, scale: off.live ? PAGE_DRAG_SCALE : 1 };
          }
          if (dragSettle && ctl.idx === dragSettle.page) {
            return { x: dragSettle.x * pagesScale, live: true, scale: dragSettle.s };
          }
          return null;
        })();
        return (
          <div
            key={`page-ctl-${ctl.id}`}
            ref={(el) => {
              if (el) pageCtlRefs.current.set(ctl.id, el);
              else pageCtlRefs.current.delete(ctl.id);
            }}
            // 外層位置每一帧由 rAF 貼著頁框寫（捲動、進出模式的動畫）
            className="absolute left-0 top-0 z-[46]"
            style={{ visibility: 'hidden' }}
          >
            <div
              className="flex items-center gap-1.5"
              style={{
                transform: shift
                  ? `translate(${shift.x}px, ${(shift.scale - 1) * pagesScale * previewH / 2}px)`
                  : undefined,
                transition: pagesMode ? 'none' : undefined,
              }}
            >
            <div
              title="拖曳調整順序"
              data-page-id={ctl.id}
              onPointerDown={(e) => handlePageDragStart(e, ctl.idx)}
              className={`w-9 h-[22px] rounded-full flex flex-col items-center justify-center gap-[3px] touch-none cursor-grab active:cursor-grabbing transition-colors shadow-lg ${
                dragging ? 'bg-white' : 'bg-white/15 hover:bg-white/25'
              }`}
            >
              <span className={`block w-4 h-[1.5px] rounded-full ${dragging ? 'bg-black' : 'bg-white/80'}`} />
              <span className={`block w-4 h-[1.5px] rounded-full ${dragging ? 'bg-black' : 'bg-white/80'}`} />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeletePage(ctl.idx); }}
              disabled={pages.length <= 1}
              title={`刪除第 ${ctl.idx + 1} 頁`}
              className="w-[22px] h-[22px] rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-all active:scale-90 disabled:opacity-25 shadow-lg"
            >
              <Trash2 size={11} />
            </button>
            </div>
          </div>
        );
      })}

      {/* IG 貼文預覽：照著 IG 動態上的版位做一次（滿版、不圓角），看發出去長怎樣 */}
      {/* IG 貼文預覽：整組抽到 components/IgPreview.tsx，兩個拼圖工具共用同一份 */}
      {igPreview && (
        <IgPreview
          shots={igShots}
          kinds={igKinds}
          canvases={igCanvases}
          frame={{ w: previewW, h: previewH }}
          pageCount={pages.length}
          faces={igFaces}
          hasVideo={igPageHasVideo}
          supported={igPreviewSupported}
          onClose={() => setIgPreview(false)}
        />
      )}

      {/* Thumbnail following the finger while a free-standing image is long-press dragged */}
      {(floatDragPreloadSrc || floatDragSrc) && (
        <div
          id="float-drag-thumbnail"
          className="fixed pointer-events-none z-[9999] border-2 border-white overflow-hidden bg-transparent flex items-center justify-center will-change-transform"
          style={{
            left: 0,
            top: 0,
            width: `${Math.round(80 * (0.65 + 0.35 * Math.min(1, kRef.current || 1)))}px`,
            height: `${Math.round(80 * (0.65 + 0.35 * Math.min(1, kRef.current || 1)))}px`,
            transform: (() => {
              const p = dragThumbPoint(floatSwapRef.current?.startX || 0, floatSwapRef.current?.startY || 0);
              return `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%) scale(1.1) rotate(4deg)`;
            })(),
            borderRadius: '8px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.34)',
            opacity: floatDragSrc && floatThumbReady === floatDragSrc ? 1 : 0,
          }}
        >
          <img src={floatDragPreloadSrc || floatDragSrc || ''} decoding="sync" onLoad={e => decodeDragThumb(e.currentTarget, setFloatThumbReady)} alt="dragging" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Floating cell thumbnail following user's finger on mobile - Square design */}
      {cellDragPreview && (
        <div
          id="mobile-drag-floating-thumbnail"
          className="fixed pointer-events-none z-[9999] border-2 border-white overflow-hidden bg-transparent flex items-center justify-center will-change-transform"
          style={{
            left: 0,
            top: 0,
            width: `${Math.round(80 * (0.65 + 0.35 * Math.min(1, kRef.current || 1)))}px`,
            height: `${Math.round(80 * (0.65 + 0.35 * Math.min(1, kRef.current || 1)))}px`,
            transform: (() => {
              const p = dragThumbPoint(touchDragState.current?.startX || 0, touchDragState.current?.startY || 0);
              return `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%) scale(1.1) rotate(4deg)`;
            })(),
            borderRadius: '8px', // Square design
            boxShadow: '0 4px 14px rgba(0,0,0,0.34)',
            opacity: touchDraggedIndex !== null && cellThumbReady === cellDragPreview.src ? 1 : 0,
          }}
        >
          <img
            src={cellDragPreview.src}
            decoding="sync"
            onLoad={e => decodeDragThumb(e.currentTarget, setCellThumbReady)}
            alt="dragging"
            className="w-full h-full object-cover"
            style={{
              transform: `rotate(${cellDragPreview.rotation}deg)`
            }}
          />
        </div>
      )}
    </div>
  );
};
