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
// åŒ¯å‡ºæˆå“ä¸€å¾‹èµ°é€™ä¸€æ”¯ï¼ˆå…§å»º toBlob çš„çœ‹é–€ç‹—ï¼Œè¦‹é‚£å€‹æª”æ¡ˆçš„èªªæ˜Žï¼‰
import { canvasToUrl } from '../utils/blobUrl';
import { SYMBOLS } from '../utils/symbols';
import {
  measureSymbolInk, measureSymbolInkAtSize, measureSymbolStickerInk, measureSymbolAdvance, clearSymbolInkCache,
  symbolTextPresentation, rasterizeSymbolAnimationLayers, symbolBreatheScale, countSymbolAnimationBeats,
} from '../utils/symbolGeometry';
/* å¾žã€Œåœ–æ¡ˆã€å€ŸéŽä¾†çš„é‚£æ‰¹åœ–å½¢ï¼šæ¸…å–®ã€æŒ‰éˆ•å°åœ–ã€ç®—åœ–å…¨éƒ¨è·Ÿå‰µæ„æ‹¼åœ–å…±ç”¨åŒä¸€ä»½ */
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

/* ç¶“å…¸æ‹¼åœ–å‹•ç•«é åŽŸå…ˆç›´æŽ¥ä½¿ç”¨äº†å‰µæ„æ‹¼åœ–æª”æ¡ˆå…§çš„å€åŸŸå…ƒä»¶ï¼›é‚£å€‹å…ƒä»¶æ²’æœ‰
   exportï¼Œæ¡Œé¢é–‹ç™¼ç’°å¢ƒæœ‰æ™‚ç›´åˆ°é»žé€²å‹•ç•«æ‰å ±éŒ¯ï¼ŒiPhone WebKit å‰‡æœƒç›´æŽ¥æŠŠ
   æ•´å€‹ React ç•«é¢æ¸…æˆé»‘è‰²ã€‚é€™è£¡ä¿ç•™åŒæ¬¾å¤–è§€ï¼Œä½†è®“ç¶“å…¸æ‹¼åœ–è‡ªå·±æŒæœ‰å…ƒä»¶ã€‚ */
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
  /* æ–°å¢žæ™‚ç›´æŽ¥é‡ã€Œæœ€å¾ŒçœŸæ­£ç•«åˆ°ç•«å¸ƒä¸Šçš„ç¬¦è™Ÿè²¼åœ–ã€ã€‚Mobile Safari å°éƒ¨åˆ†
     VS15ï¼fallback å­—å½¢çš„åŽŸç”Ÿæ–‡å­—é‡æ¸¬ä¸åŒï¼›è‹¥å¤–æ¡†é‡ raw textã€å‹•ç•«ç•«è²¼åœ–ï¼Œ
     ä¸€é€²å‹•ç•«é å°±å¿…ç„¶æœƒåç§»ã€‚ */
  const ink = measureSymbolStickerInk(text, SYMBOL_FONT);
  const value = {
    fontSize,
    w: Math.max(6, ink.w * fontSize + 8),
    h: Math.max(6, ink.h * fontSize + 8),
  };
  classicSymbolPlacementCache.set(key, value);
  return value;
};

/* ç¬¦è™Ÿé ä¸èƒ½åœ¨æ‰“é–‹å¾Œæ‰é–‹å§‹ä¸‹è¼‰å­—é«”ã€‚æ¨¡çµ„è¼‰å…¥æ™‚å°±åœ¨èƒŒæ™¯æŠŠæ¸…å–®æœƒç”¨åˆ°çš„
   å­—å½¢é ç†±ï¼›ä½¿ç”¨è€…é»žé€²é é¢æ™‚ï¼ŒæŒ‰éˆ•èˆ‡æ–°å¢žç‰©ä»¶ä¾¿ç›´æŽ¥ä½¿ç”¨æœ€çµ‚å­—èº«ã€‚ */
export const symbolFontReady: Promise<void> = typeof document === 'undefined'
  ? Promise.resolve()
  : ensureFont(SYMBOL_FONT)
      .then(async () => {
        try {
          await document.fonts?.load(`400 32px "${SYMBOL_FONT}"`, SYMBOLS.join(''));
          await document.fonts?.ready;
        } catch { /* é›¢ç·šæ™‚ç©©å®šä½¿ç”¨ç³»çµ± fallback */ }
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
  /** åœ–ç‰‡é€æ˜Žåº¦ï¼Œ0ï½ž100ï¼›èˆŠå°ˆæ¡ˆæœªè¨­å®šæ™‚è¦–ç‚º 100ã€‚ */
  opacity?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  /** æ¿¾é¡ï¼èª¿ç¯€ï¼ç‰¹æ•ˆã€‚è·Ÿæµ®å‹•åœ–ç‰‡ç”¨åŒä¸€çµ„è³‡æ–™èˆ‡åŒä¸€æ”¯ç®—åœ– */
  fx?: PhotoFx;
  /** é€™ä¸€æ ¼è‡ªå·±çš„åœ“è§’ï¼ˆ%ï¼‰ã€‚æœ‰è¨­çš„è©±å°±è“‹æŽ‰ä½ˆå±€é‚£æ ¹å…±ç”¨çš„åœ“è§’æ»‘æ¡¿ */
  imgRadius?: number;
}

/** æ˜¯ä¸æ˜¯å½±ç‰‡æª”ï¼ˆç”¨ MIME æˆ–å‰¯æª”ååˆ¤æ–·éƒ½å¯ä»¥ï¼‰ */
const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|ogv|3gp)$/i.test(f.name);

/** å½±ç‰‡çš„åŽŸå§‹å°ºå¯¸ï¼šç­‰ metadata é€²ä¾†å°±æœ‰ videoWidth / videoHeight */
/**
 * å½±ç‰‡çš„å°ºå¯¸ï¼Œé †ä¾¿çƒ¤ä¸€å¼µã€Œç¬¬ä¸€æ ¼ã€ã€‚
 *
 * é‚£å¼µç¬¬ä¸€æ ¼æ˜¯çµ¦æ¿¾é¡ï¼ç‰¹æ•ˆå¡ç‰‡ç‰†ç”¨çš„ï¼šå¡ç‰‡æ˜¯æ‹¿ä¸€æ¢ç¶²å€å¡žé€² <img> åŽ»é‡ç•«ç¸®åœ–çš„ï¼Œ
 * è€Œ <img src="blob:â€¦mp4"> æ°¸é è¼‰ä¸å‡ºä¾† â€”â€” æ‰€ä»¥ä»¥å‰å½±ç‰‡åœ–å±¤çš„å¡ç‰‡ç‰†æ•´é¢æ˜¯ç©ºçš„ï¼Œ
 * ä½¿ç”¨è€…æ ¹æœ¬çœ‹ä¸åˆ°æ¯å€‹æ¿¾é¡é•·ä»€éº¼æ¨£ï¼ˆã€Œå½±ç‰‡å¤§éƒ¨åˆ†æ±è¥¿ä¸èƒ½èª¿æ•´ã€çš„ä¸€éƒ¨åˆ†ï¼‰ã€‚
 * çƒ¤ä¸€å¼µ PNG ç•¶å¡ç‰‡çš„ä¾†æºï¼Œå¡ç‰‡å°±è·Ÿåœ–ç‰‡åœ–å±¤é•·å¾—ä¸€æ¨¡ä¸€æ¨£ã€‚
 * çœŸæ­£ç•«åˆ°ç•«é¢ä¸Šçš„ä»ç„¶æ˜¯å½±ç‰‡æœ¬äººï¼Œé€™å¼µåªçµ¦å¡ç‰‡çœ‹ã€‚
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
      try { v.removeAttribute('src'); v.load(); } catch { /* æ”¶ä¸æŽ‰ç®—äº† */ }
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
    // ç¬¬ä¸€æ ¼ä¸€ç›´ç­‰ä¸åˆ°ä¹Ÿä¸èƒ½å¡ä½åŒ¯å…¥
    setTimeout(() => finish(), 4000);
    v.src = url;
  });
};

/**
 * é è¦½ç”¨çš„å½±ç‰‡å…ƒç´ ï¼šè·Ÿç…§ç‰‡ä¸€æ¨£ä¸€å€‹ç¶²å€å…±ç”¨ä¸€å€‹å…ƒç´ ï¼Œ
 * é€™æ¨£é‡ç•«ã€åŒ¯å‡ºéƒ½æ‹¿åˆ°åŒä¸€å€‹æ’­æ”¾ä¸­çš„å½±ç‰‡ï¼ˆä¸æœƒå„è‡ªæ’­å„è‡ªçš„ï¼‰ã€‚
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
    v.play().catch(() => { /* ä½¿ç”¨è€…é‚„æ²’äº’å‹•å°±å…ˆä¸æ’­ */ });
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

/** ä½ˆå±€æœ€å°ç¸®æ”¾ï¼šå†å°å°±å¾ˆé›£é»žå¾—åˆ° */
const MIN_LAYOUT_SCALE = 0.4;

/** æ–°å¢žä½ˆå±€æ™‚é è¨­ä½”é é¢ä¸ƒåˆ†æ»¿ */
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

/* â”€â”€ ä½ˆå±€è‡ªå·±çš„æ¯”ä¾‹ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   æ¯å€‹ä½ˆå±€å¯ä»¥æœ‰è‡ªå·±çš„é•·å¯¬æ¯”ï¼ˆè·Ÿæ•´é çš„ã€Œç‰ˆåž‹æ¯”ä¾‹ã€æ˜¯å…©å›žäº‹ï¼‰ã€‚æ²’è¨­å°±è·Ÿé é¢
   ä¸€æ¨£ï¼Œæ‰€ä»¥èˆŠæª”æ¡ˆè®€é€²ä¾†ç•«é¢å®Œå…¨ä¸è®Šã€‚
   è¨­äº†å°±æŠŠé‚£å€‹æ¯”ä¾‹ã€Œcontainã€é€²é é¢è£¡ä¸¦ç½®ä¸­ï¼Œå†ä¹˜ä¸Šä½ˆå±€è‡ªå·±çš„ç¸®æ”¾ã€‚
   é è¦½ã€IG é è¦½ã€åŒ¯å‡ºã€æ‹–æ›³å¸é™„å››æ¢è·¯å…¨éƒ¨å‘¼å«é€™ä¸€æ”¯ï¼Œå¹¾ä½•ä¸å¯èƒ½å°ä¸ä¸Šã€‚ */
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
      name: 'æ»¿ç‰ˆ',
      rects: [{ x: 0, y: 0, w: 1, h: 1 }]
    }
  ],
  2: [
    {
      name: 'ä¸Šä¸‹å°åˆ†',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 1, h: 0.5 }
      ]
    },
    {
      name: 'å·¦å³å°åˆ†',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 1 }
      ]
    },
    {
      name: 'é»ƒé‡‘å·¦åˆ†å‰²',
      rects: [
        { x: 0, y: 0, w: 0.618, h: 1 },
        { x: 0.618, y: 0, w: 0.382, h: 1 }
      ]
    },
    {
      name: 'é»ƒé‡‘å³åˆ†å‰²',
      rects: [
        { x: 0, y: 0, w: 0.382, h: 1 },
        { x: 0.382, y: 0, w: 0.618, h: 1 }
      ]
    }
  ],
  3: [
    {
      name: 'ä¸Šå¤§ä¸‹é›™',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: 'ä¸‹å¤§ä¸Šé›™',
      rects: [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: 'å·¦å¤§å³é›™',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: 'å³å¤§å·¦é›™',
      rects: [
        { x: 0.5, y: 0, w: 0.5, h: 1 },
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: 'ä¸‰ç›´æ¬„',
      rects: [
        { x: 0, y: 0, w: 0.3333, h: 1 },
        { x: 0.3333, y: 0, w: 0.3334, h: 1 },
        { x: 0.6667, y: 0, w: 0.3333, h: 1 }
      ]
    },
    {
      name: 'ä¸‰æ©«æ¬„',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.3333 },
        { x: 0, y: 0.3333, w: 1, h: 0.3334 },
        { x: 0, y: 0.6667, w: 1, h: 0.3333 }
      ]
    }
  ],
  4: [
    {
      name: 'å››æ ¼æ£‹ç›¤',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
      ]
    },
    {
      name: 'å·¦å¤§å³ç–Š',
      rects: [
        { x: 0, y: 0, w: 0.6667, h: 1 },
        { x: 0.6667, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: 'å³å¤§å·¦ç–Š',
      rects: [
        { x: 0.3333, y: 0, w: 0.6667, h: 1 },
        { x: 0, y: 0, w: 0.3333, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.3333, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: 'ä¸€å¤§ä¸‰å°',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.6667 },
        { x: 0, y: 0.6667, w: 0.3333, h: 0.3333 },
        { x: 0.3333, y: 0.6667, w: 0.3334, h: 0.3333 },
        { x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333 }
      ]
    },
    {
      name: 'ä¸‰å°ä¸€å¤§',
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
      name: 'å·¦äºŒå³ä¸‰',
      rects: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.3333 },
        { x: 0.5, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0.5, y: 0.6667, w: 0.5, h: 0.3333 }
      ]
    },
    {
      name: 'å·¦ä¸‰å³äºŒ',
      rects: [
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0, y: 0, w: 0.5, h: 0.3333 },
        { x: 0, y: 0.3333, w: 0.5, h: 0.3334 },
        { x: 0, y: 0.6667, w: 0.5, h: 0.3333 }
      ]
    },
    {
      name: 'ä¸€ä¸Šå››ä¸‹',
      rects: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: 'ä¸€ä¸‹å››ä¸Š',
      rects: [
        { x: 0, y: 0.5, w: 1, h: 0.5 },
        { x: 0, y: 0, w: 0.25, h: 0.5 },
        { x: 0.25, y: 0, w: 0.25, h: 0.5 },
        { x: 0.5, y: 0, w: 0.25, h: 0.5 },
        { x: 0.75, y: 0, w: 0.25, h: 0.5 }
      ]
    },
    {
      name: 'äº”æ©«æ¬„',
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
      name: 'å…©åˆ—ä¸‰æ¬„',
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
      name: 'ä¸‰åˆ—äºŒæ¬„',
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
      name: 'ä¸€å¤§äº”å°',
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
      name: 'äº”å°ä¸€å¤§',
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
      name: 'å¤§è§’æ‹¼è²¼',
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
      name: 'ä¸‰ä¸Šå››ä¸‹',
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
      name: 'å››ä¸Šä¸‰ä¸‹',
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
      name: 'å¤§å·¦å…­å°',
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
      name: 'å››ç›´å…©åˆ—',
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
      name: 'å…©å¤§å…­å°',
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
      name: 'ä¹æ ¼æ£‹ç›¤',
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
      name: 'éŒ¯ä½ä¹å®®',
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
      name: '2x5 ç¶²æ ¼',
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
      name: '5x2 ç¶²æ ¼',
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
      name: '3-4-3 äº¤éŒ¯',
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
  /** æ›æŽ‰é è¨­çš„é‚£ä¸€æŽ’è‰²ç¥¨ã€‚æ¢ç´‹çš„å…©å€‹é¡è‰²ç”¨çš„å°±æ˜¯é®ç½©é‚£ä¸€çµ„ï¼ˆå…¨ App åŒä¸€ä»½ï¼‰ã€‚ */
  colors?: string[];
  /** æœ‰çµ¦çš„è©±ï¼Œæœ€ä¸Šé¢æœƒå¤šä¸€åˆ—ã€Œé€™å€‹ç¯€é»ž ï¼‹ è‰²è™Ÿã€ï¼Œè‰²ç¥¨é‚£ä¸€æŽ’å°±æ•´æŽ’è®“å‡ºä¾†çµ¦è‰²ç¥¨ */
  headerLeft?: React.ReactNode;
}

/** æ–‡å­—åœ–å±¤çš„ç·¨è¼¯é¢æ¿ï¼šå…§å®¹ã€å­—é«”ã€é¡è‰²ã€å­—è·ã€ç²—é«”ã€é‚Šç·£ç™¼å…‰ã€‚ */
/** é•·æŒ‰å¤šä¹…æ‰ç®—ã€Œè¦æ‹–åŽ»äº¤æ›ã€ã€‚150ms å¤ªå®¹æ˜“èª¤è§¸ï¼Œæ‹‰é•·åˆ° 250msã€‚ */
/* åœ–ç‰‡äº¤æ›éœ€è¦æ˜Žç¢ºé•·æŒ‰ï¼›250ms å¾ˆå®¹æ˜“åœ¨æº–å‚™ç¬¬äºŒæ ¹æ‰‹æŒ‡ç¸®æ”¾æ™‚èª¤è§¸ã€‚ */
const LONG_PRESS_MS = 380;


/**
 * è‰²ç¥¨æœ€å‰é¢é‚£é¡†ã€Œè‡ªè¨‚é¡è‰²ã€ã€‚å¤–è§€è·Ÿç¾Žé¡é‚£é¡†ä¸€è‡´ï¼š
 * å½©è™¹ç’° ï¼‹ æ·±è‰²åœ“å¿ƒ ï¼‹ æ»´ç®¡åœ–æ¨™ï¼Œé»žä¸‹åŽ»é–‹ç³»çµ±èª¿è‰²ç›¤ã€‚
 */
const CustomColorButton: React.FC<{
  value: string;
  onPick: (c: string) => void;
  size?: number;
}> = ({ value, onPick, size = 32 }) => (
  <label
    title="è‡ªè¨‚é¡è‰²"
    aria-label="è‡ªè¨‚é¡è‰²"
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
      aria-label="è‡ªè¨‚é¡è‰²"
      className="absolute inset-0 opacity-0 cursor-pointer"
    />
  </label>
);

/**
 * ã€Œé€å¸§åˆæˆã€æ™‚å‚³çµ¦ç•«åœ–é‚£ä¸€æ”¯çš„åŠ é€Ÿç”¨å…·ï¼ˆåªæœ‰éŒ„å½±èˆ‡ IG é è¦½æœƒå‚³ï¼‰ã€‚
 *
 * åŒ¯å‡ºä¸€å¼µç…§ç‰‡æ˜¯ä¸€æ¬¡æ€§çš„ï¼Œæ‰€ä»¥é‚£æ¢è·¯å¯ä»¥æ…¢æ…¢ç®—åˆ° 2400 åƒç´ ï¼›
 * ä½†å½±ç‰‡æ˜¯**ä¸€ç§’è¦ç®—ä¸‰åæ¬¡**çš„ï¼Œç”¨åŒä¸€çµ„æ•¸å­—å°±ç­‰æ–¼æ¯ä¸€æ ¼éƒ½é‡åšä¸€æ¬¡
 * ã€Œæ•´å¼µåœ–çš„æ¿¾é¡ï¼‹ä¸€å¼µæ–°çš„é›¢å±ç•«å¸ƒï¼‹ä¸€æ¬¡é®ç½©æ¨¡ç³Šã€â€”â€”
 * å¯¦æ¸¬é‚£æ­£æ˜¯ã€Œå°Žå‡ºçš„å½±ç‰‡å¹€çŽ‡è¶…ä½Žã€èˆ‡ã€Œå¥—äº†å½¢ç‹€çš„å½±ç‰‡åœ¨ IG é è¦½è£¡ä¸æœƒå‹•ã€ã€‚
 *
 *   k     ï¼šåˆæˆç•«å¸ƒç›¸å°æ–¼é é¢åº§æ¨™çš„å€çŽ‡ã€‚æ‰€æœ‰ä¸­é–“ç•«å¸ƒåªç®—åˆ°ã€Œé€™ä¸€æ ¼
 *           çœŸçš„æœƒè¢«çœ‹åˆ°çš„å¤§å°ã€ï¼Œç•«å›žåŽ»çš„å°ºå¯¸ä¸€å€‹åƒç´ éƒ½æ²’è®Šã€‚
 *   cache ï¼šé€™ä¸€è¼ªé€å¸§å…±ç”¨çš„æš«å­˜ï¼ˆé®ç½©ã€é›¢å±ç•«å¸ƒï¼‰ï¼Œä¸ç”¨æ¯æ ¼é‡é…ã€‚
 */
type LiveDraw = { k: number; cache: Map<string, any> };

/** IG é è¦½ç”¨çš„ã€Œæ´»çš„ä¸€é ã€ï¼šä¸€å¼µä¸€ç›´åœ¨é‡ç•«çš„ç•«å¸ƒï¼Œæ”¶æŽ‰æ™‚è¦ stop() */
type LivePage = { canvas: HTMLCanvasElement; stop: () => void } | null;

/* ã€Œåœ–ç‰‡èª¿æ•´ã€çš„å·¥å…·æ¸…å–®ï¼šid / åç¨± / Material åœ–æ¨™ / ç¯„åœ / é è¨­å€¼ï¼Œè·Ÿã€Œç·¨è¼¯ã€åŒä¸€çµ„ */
const TUNE_TOOLS: [string, string, string, number, number, number][] = [
  ['brightness', 'äº®åº¦', 'light_mode', -100, 100, 0],
  ['exposure', 'æ›å…‰', 'brightness_6', -100, 100, 0],
  ['contrast', 'å°æ¯”', 'contrast', -100, 100, 0],
  ['highlights', 'é«˜å…‰', 'wb_sunny', -100, 100, 0],
  ['shadows', 'é™°å½±', 'brightness_low', -100, 100, 0],
  ['temp', 'è‰²æº«', 'device_thermostat', -100, 100, 0],
  ['tint', 'è‰²èª¿', 'colorize', -100, 100, 0],
  ['sat', 'é£½å’Œåº¦', 'palette', -100, 100, 0],
  ['vib', 'è‡ªç„¶é£½å’Œåº¦', 'color_lens', -100, 100, 0],
  ['opacity', 'é€æ˜Žåº¦', 'opacity', 0, 100, 100],
];

/* ç‰¹æ•ˆæ¸…å–®è·Ÿã€Œç·¨è¼¯ã€å®Œå…¨ä¸€è‡´ï¼ˆé †åºã€åç¨±ã€åœ–æ¨™ã€é è¨­å¼·åº¦éƒ½æ˜¯åŒä¸€ä»½ï¼‰ï¼Œ
   å¾Œé¢ 16 é¡†ç›´æŽ¥å¾ž FX_DEFS é•·å‡ºä¾†ï¼Œä¸å†è‡ªå·±ç¶­è­·ç¬¬äºŒä»½è¡¨ã€‚
   éŠ³åŒ–åœ¨ç·¨è¼¯é‚£é‚Šæ˜¯ã€Œèª¿ç¯€ã€çš„æœ€å¾Œä¸€é¡†ï¼Œæ‹¼åœ–é€™è£¡çš„èª¿ç¯€æ²’æœ‰å®ƒï¼Œæ‰€ä»¥ä¹Ÿä¸åˆ—ã€‚ */
const FX_ROOT_TOOLS: [string, string, string][] = [
  ['softLight', 'æŸ”å…‰', 'blur_on'],
  ['halation', 'å…‰æšˆ', 'flare'],
  ['lightLeak', 'æ¼å…‰', 'leak_add'],
  ['colorNoise', 'å™ªé»ž', 'grain'],
  ['blur', 'æœ¦æœ§', 'blur_linear'],
  ...FX_DEFS.filter(d => d.id !== 'fxSharpen').map(d => [d.id, d.label, d.icon] as [string, string, string]),
];

/** å¡ç‰‡ â†’ å¤–å±¤é‚£æ ¹ã€Œå¼·åº¦ã€æ»‘æ¡¿å¯¦éš›èª¿çš„åƒæ•¸ï¼ˆæŸ”å…‰ï¼å…‰æšˆï¼æ¼å…‰çš„å¼·åº¦ä¸æ˜¯å¡ç‰‡ id æœ¬èº«ï¼‰ */
const FX_AMOUNT: Record<string, string> = {
  softLight: 'soft', halation: 'fringeIntensity', lightLeak: 'leakOpacity',
};
const fxAmountId = (id: string) => FX_AMOUNT[id] || id;

/** é»žä¸‹å¡ç‰‡æ™‚è¦å¥—çš„å¼·åº¦ï¼Œè·Ÿç·¨è¼¯åŒä¸€çµ„ */
const FX_ON_AMOUNT: Record<string, number> = {
  softLight: 100, halation: 100, lightLeak: 100, colorNoise: 40, blur: 40,
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, d.onAmount ?? 100])),
};

/* ã€Œæ¯ä¸€é¡†å¡ç‰‡è‡ªå·±çš„åƒæ•¸éµã€æ”¹ç”±ä¸‹é¢çš„ FX_CARD_KEYS æä¾› â€”â€”
   å®ƒé€£ç´°é …ï¼ˆé–€æª»ï¼æ“´æ•£ï¼è‰²ç›¸â€¦ï¼‰éƒ½ç®—é€²åŽ»ï¼ŒåŽŸæœ¬é€™è£¡åªåˆ—å¼·åº¦ã€‚ */
/** æ‰€æœ‰ç‰¹æ•ˆçš„å¼·åº¦éµï¼Œæ­¸é›¶æ™‚ç”¨ */
const FX_ALL_AMOUNTS = ['soft', 'fringeIntensity', 'leakOpacity', 'colorNoise', 'blur', 'vignette',
  ...FX_DEFS.map(d => d.id)];

/** æœ€å¤–å±¤é‚£æ ¹æ»‘æ¡¿è¦æ”¹èª¿å“ªä¸€å€‹åƒæ•¸ï¼ˆæ²’è¨­å°±æ˜¯èª¿ã€Œå¼·åº¦ã€ï¼‰ã€‚
    ä¾†æºæ˜¯ FX_DEFS è£¡çš„ rootParam â€”â€” å…©å€‹å·¥å…·è®€åŒä¸€ä»½ï¼Œä¸æœƒå„è‡ªèµ°å‘³ã€‚ */
const FX_ROOT_PARAM: Record<string, { id: string; label: string; min: number; max: number; def: number }> =
  Object.fromEntries(
    FX_DEFS.filter(d => d.rootParam).map(d => {
      const p = d.params.find(x => x.id === d.rootParam)!;
      return [d.id, { id: p.id, label: p.label, min: p.min, max: p.max, def: p.def }];
    }),
  );

/** é€™ä¸€é¡†å¡ç‰‡çš„ç´°é …æ»‘æ¡¿ï¼ˆç¬¬ä¸€æ ¹æ˜¯å¼·åº¦ï¼Œhidden çš„ä¸å‡ºç¾ï¼‰ï¼Œè·Ÿç·¨è¼¯åŒä¸€å¥— */
const FX_DETAIL: Record<string, [string, string, number, number, number][]> = {
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, [
    [d.id, 'å¼·åº¦', 0, 100, 0] as [string, string, number, number, number],
    ...d.params.filter(p => !p.hidden).map(p =>
      [p.id, p.label, p.min, p.max, p.def] as [string, string, number, number, number]),
  ]])),
};

const FX_SUB_TOOLS: Record<string, [string, string, string, number, number, number][]> = {
  softLight: [
    ['soft', 'å¼·åº¦', 'blur_on', 0, 100, 0],
    ['softThreshold', 'ç¯„åœ', 'tonality', 0, 95, 70],
    ['softRadius', 'æ“´æ•£', 'flare', 20, 100, 100],
    ['softColor', 'è‰²ç›¸', 'palette', 0, 100, 0],
  ],
  halation: [
    ['fringeIntensity', 'å¼·åº¦', 'flare', 0, 100, 0],
    ['fringeSize', 'æ“´æ•£', 'blur_on', 0, 100, 10],
    ['fringeFeather', 'ç¯„åœ', 'tonality', 0, 100, 100],
    ['fringeHue', 'è‰²ç›¸', 'palette', 0, 360, 8],
  ],
  lightLeak: [
    ['leakOpacity', 'å¼·åº¦', 'opacity', 0, 100, 0],
    ['leakAngle', 'è§’åº¦', 'rotate_right', 0, 360, 45],
    ['leakHue', 'è‰²ç›¸', 'palette', 0, 360, 15],
  ],
};

/** ä¸€å¼µç‰¹æ•ˆå¡ç‰‡ã€Œé€£ç´°é …åœ¨å…§ã€çš„æ‰€æœ‰åƒæ•¸éµï¼ˆç¬¬ä¸€å€‹ä¸€å®šæ˜¯å¼·åº¦ï¼‰ */
const FX_CARD_KEYS: Record<string, string[]> = Object.fromEntries(
  FX_ROOT_TOOLS.map(([id]) => [
    id,
    FX_DETAIL[id] ? FX_DETAIL[id].map(t => t[0])
      : (FX_SUB_TOOLS[id] ? FX_SUB_TOOLS[id].map(t => t[0]) : [fxAmountId(id)]),
  ]),
);

/**
 * æ‰€æœ‰ç‰¹æ•ˆåƒæ•¸çš„é è¨­å€¼ â€”â€” å¼·åº¦æ­¸é›¶ï¼Œç´°é …å›žåˆ°å‡ºå» å€¼ã€‚
 *
 * è·Ÿã€Œç·¨è¼¯ã€é‚£é‚Šæ˜¯åŒä¸€ä»½ï¼ˆè¦‹ ImageEditor çš„ EFFECT_ALL_KEYSï¼resetAllEffectParamsï¼Œ
 * æ•¸å­—ä¹Ÿå°±æ˜¯ DEFAULT_PARAMS è£¡çš„é‚£äº›ï¼šæŸ”å…‰é–€æª» 70ã€æ“´æ•£ 100ã€å…‰æšˆæ“´æ•£ 10ã€
 * ç¾½åŒ– 100ã€è‰²ç›¸ 8ã€æ¼å…‰è§’åº¦ 45ã€è‰²ç›¸ 15â€¦ï¼‰ã€‚
 *
 * ä»¥å‰é»žç‰¹æ•ˆå¡ç‰‡åªæŠŠã€Œåˆ¥é¡†çš„å¼·åº¦ã€æ­¸é›¶ï¼Œç´°é …ä¸€å¾‹ç•™è‘— â€”â€” æ–¼æ˜¯å…ˆåœ¨æŸ”å…‰çš„ç´°é …
 * é¢æ¿æŠŠé–€æª»æ‹‰åˆ° 20ï¼Œå†åŽ»é»žåˆ¥é¡†ã€å›žé ­å†é»žæŸ”å…‰ï¼Œé–€æª»é‚„æ˜¯ 20ï¼›åŒä¸€é¡†ç‰¹æ•ˆæ‰“é–‹
 * å…©æ¬¡å¾—åˆ°ä¸ä¸€æ¨£çš„çµæžœï¼Œè·Ÿç·¨è¼¯é ä¹Ÿå°ä¸èµ·ä¾†ã€‚
 */
const FX_PARAM_DEFAULTS: Record<string, number> = {
  ...Object.fromEntries(FX_ALL_AMOUNTS.map(k => [k, 0])),
  ...Object.fromEntries(FX_ROOT_TOOLS.flatMap(([id]) => (
    FX_DETAIL[id] ? FX_DETAIL[id].map(t => [t[0], t[4]] as [string, number])
      : (FX_SUB_TOOLS[id] || []).map(t => [t[0], t[5]] as [string, number])
  ))),
};

/** å½¢ç‹€åˆ†é çš„å·¥å…·ï¼ˆæ‹¼åœ–ç¨æœ‰ï¼Œå–ä»£ç·¨è¼¯è£¡çš„é®è‰²ç‰‡ï¼‰ã€‚
    æé‚Šèˆ‡ç™¼å…‰è·ŸæŸ”å…‰ä¸€æ¨£æ˜¯å…©æ®µå¼ï¼šé»žé€²åŽ»æ‰æœ‰ç²—ç´°ï¼é¡è‰²ã€‚ */
const SHAPE_TOOLS: [string, string, string, number, number, number][] = [
  /* å¤–å½¢ã€‚é»žé€²åŽ»æ˜¯ä¸€æŽ’å½¢ç‹€å¯ä»¥é¸ï¼ˆåœ“å½¢ï¼æ˜Ÿåž‹ï¼æ„›å¿ƒï¼‰ï¼Œä¸æ˜¯æ»‘æ¡¿ã€‚ */
  ['imgShape', 'å½¢ç‹€', 'interests', 0, 0, 0],
  ['imgRadius', 'åœ“è§’', 'rounded_corner', 0, 50, 0],
  /* ç¾½åŒ–ä¸€æ ¹æ»‘æ¡¿å°±å¤ ï¼š0ï¼ç¡¬é‚Šï¼Œ100ï¼å¾žé‚Šç·£ä¸€è·¯ç¾½åŒ–åˆ°åœ–ç‰‡ä¸­å¿ƒã€‚ */
  ['feather', 'ç¾½åŒ–', 'gradient', 0, 100, 0],
  ['stroke', 'æé‚Š', 'border_style', 0, 0, 0],
  ['glow', 'ç™¼å…‰', 'light_mode', 0, 0, 0],
];

/* ã€Œå½¢ç‹€ã€é€²ä¾†ä¹‹å¾Œ**ä¸é å…ˆé¸ä»»ä½•ä¸€é¡†**ã€‚
   ä»¥å‰æ˜¯å›ºå®šåœåœ¨åœ“è§’ä¸Šï¼Œæ‰€ä»¥ä¸€é€²é€ åž‹é åœ“è§’å°±äº®è‘—ã€ä¸‹é¢é‚„å¤šå‡ºä¸€æ ¹æ»‘æ¡¿ â€”â€”
   çœ‹èµ·ä¾†åƒå·²ç¶“é¸å¥½äº†ï¼Œä½†ä½¿ç”¨è€…å…¶å¯¦é‚„æ²’æŒ‘ã€‚ç¾åœ¨è·Ÿå…¶ä»–åˆ†é ä¸€æ¨£ï¼š
   å…¨éƒ¨éƒ½æ˜¯æš—çš„ï¼Œé»žä¸‹åŽ»æ‰äº®ã€æ‰é•·å‡ºé‚£ä¸€æ ¹æ»‘æ¡¿ã€‚ */

/** æé‚Šï¼ç™¼å…‰é»žé€²åŽ»ä¹‹å¾Œçš„å­å·¥å…·ï¼šç²—ç´°ç”¨æ»‘æ¡¿ã€é¡è‰²ç”¨è‰²ç¥¨ */
const SHAPE_SUB_TOOLS: Record<string, [string, string, string, number, number, number][]> = {
  stroke: [
    ['imgStrokeWidth', 'ç²—ç´°', 'line_weight', 0, 100, 0],
    /* è™›ç·šï¼š0ï¼å¯¦ç·šï¼Œå¾€ä¸Šæ‹‰æ˜¯ã€Œä¸€æ®µæœ‰å¤šé•·ã€ï¼ˆä»¥ç·šå¯¬ç‚ºå–®ä½ï¼‰ï¼Œ
       æ‰€ä»¥ç·šè¶Šç²—ã€è™›ç·šçš„ç¯€å¥å°±è·Ÿè‘—ç­‰æ¯”ä¾‹æ”¾å¤§ï¼Œä¸æœƒç²—ç·šé…ç´°ç¢Žçš„é»žã€‚ */
    ['imgStrokeDash', 'è™›ç·š', 'line_style', 0, 100, 0],
    ['imgStrokeGap', 'é–“è·', 'open_in_full', 0, 100, 0],
    ['imgStrokeColor', 'é¡è‰²', 'palette', 0, 0, 0],
  ],
  glow: [
    ['imgGlow', 'å¼·åº¦', 'light_mode', 0, 20, 0],
    ['imgGlowColor', 'é¡è‰²', 'palette', 0, 0, 0],
  ],
};

const FX_DIRECT_RANGE: Record<string, [number, number]> = {
  blur: [0, 100], colorNoise: [0, 100], vignette: [0, 200],
};

/* ç™¼å…‰å°ˆç”¨è‰²ç¥¨ï¼šè·Ÿå‰µæ„æ‹¼åœ–çš„åœ–æ¡ˆç™¼å…‰åŒä¸€çµ„ï¼ˆé‚£é‚Šæ˜¯æœ¬é«”ï¼Œé€™è£¡ç…§æŠ„åŒä¸€å¥—ç®—æ³•ï¼‰ã€‚
   åŸºæº–è‰² #9BD4C3 è½‰æˆ HSL ä¹‹å¾Œã€Œåªæ”¹è‰²ç›¸ã€ï¼ˆé£½å’Œåº¦èˆ‡äº®åº¦å®Œå…¨ä¸å‹•ï¼‰ï¼Œ
   æ¯ 360/14 åº¦å–ä¸€é¡†ã€ç…§è‰²ç›¸æŽ’æˆä¸€åœˆæ¼¸å±¤ï¼›ç¬¬ä¸€é¡†å›ºå®šæ˜¯ç´”ç™½ã€‚ */
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
 * è‰²ç¥¨çš„éª¨æž¶ï¼šä»¥ #9BD4C3 ç‚ºåŸºæº–ï¼Œåªè½‰è‰²ç›¸ï¼ˆé£½å’Œåº¦ä¸å‹•ï¼‰ï¼Œ
 * æ¯ 360/14 åº¦å–ä¸€é¡†ã€‚**ä¸æŽ’åº** â€”â€” ç›´æŽ¥å¾žåŸºæº–è‰²çš„è‰²ç›¸å¾€å‰ç¹žä¸€åœˆï¼Œ
 * æ‰€ä»¥ç¬¬ä¸€é¡†å°±æ˜¯ #9BD4C3 æœ¬äººï¼Œå¾Œé¢ç…§è‰²ç›¸é †è‘—æ»‘éŽåŽ»ã€ç¹žå›žåŽŸé»žï¼Œ
 * çœ‹èµ·ä¾†é‚„æ˜¯ä¸€æ¢é€£çºŒçš„æ¼¸å±¤ã€‚
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

/** åç¨±è£¡æœ‰ã€Œç™¼å…‰ã€çš„åŠŸèƒ½ç”¨é€™ä¸€çµ„ï¼šäº®åº¦å°±æ˜¯åŸºæº–è‰²æœ¬èº«çš„äº®åº¦ */
export const GLOW_COLORS = ['#FFFFFF', ...GLOW_RAMP.hues.map(h => glowHslToHex(h, GLOW_RAMP.sat, GLOW_RAMP.l))];

/**
 * å…¶ä»–å€Ÿç”¨åŒä¸€çµ„è‰²ç¥¨çš„åŠŸèƒ½ï¼ˆæ–‡å­—ã€æé‚Šã€åœ–å½¢ã€åº•è‰²â€¦ï¼‰ç”¨é€™ä¸€çµ„ï¼š
 * è‰²ç›¸èˆ‡é£½å’Œåº¦å®Œå…¨ç…§èˆŠï¼ŒåªæŠŠ**æ˜Žåº¦**ï¼ˆHSV çš„ Vï¼‰å¾žåŸºæº–è‰²çš„ 83 æåˆ° 90 â€”â€”
 * åªäº®ä¸€é»žé»žï¼Œé‚„æ˜¯åŒä¸€æ¢æ¼¸å±¤ã€‚
 */
const GLOW_BASE_HSV = hexToHsv(GLOW_BASE);
export const SOFT_COLORS =
  ['#FFFFFF', ...GLOW_RAMP.hues.map(h => hsvToHex(h, GLOW_BASE_HSV.s, 90))];

/**
 * æ–‡å­—é¡è‰²ï¼æ–‡å­—æé‚Šç”¨çš„è‰²ç¥¨ã€‚
 * å°±æ˜¯ä¸Šé¢é‚£çµ„æ·¡çš„ï¼Œåªåœ¨æœ€å‰é¢å¤šå¢Šä¸€é¡†ç´”é»‘ â€”â€”
 * æœ‰é»‘è‰²çš„è‰²ç¥¨ï¼Œé»‘è‰²ä¸€å¾‹æŽ’åœ¨ç´”ç™½å‰é¢ã€‚
 */
const TEXT_COLORS = ['#000000', ...SOFT_COLORS];

/**
 * è‰²ç¥¨åˆ—ï¼šç¬¬ä¸€é¡†å›ºå®šæ˜¯è‡ªè¨‚é¡è‰²ï¼ˆé–‹ç³»çµ±èª¿è‰²ç›¤ï¼‰ï¼Œå¾Œé¢æ‰æ˜¯é è¨­è‰²ã€‚
 *
 * é€™ä¸€æ®µæœ¬ä¾†å¯«åœ¨ ImageAdjustPanel è£¡é¢ã€‚åœ–å½¢åœ–å±¤çš„é¡è‰²è¦ã€Œè·Ÿç™¼å…‰çš„å®Œå…¨ä¸€æ¨£ã€ï¼Œ
 * æ‰€ä»¥æ•´æ®µåŽŸå°ä¸å‹•æ¬åˆ°æ¨¡çµ„å±¤å…±ç”¨ â€”â€” **ä¸€è¡Œé‚è¼¯éƒ½æ²’æœ‰æ”¹**ï¼Œ
 * ç™¼å…‰ã€æé‚Šã€åœ–å½¢ä¸‰å€‹åœ°æ–¹çœ‹åˆ°çš„å°±æ˜¯åŒä¸€å€‹æ±è¥¿ã€‚
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
 * é¡è‰²çš„ã€Œç¨ç«‹èª¿æ•´é ã€ã€‚
 * å…©æ®µå¼çš„é¡è‰²æ¬„ï¼ˆé»žä¸€ä¸‹åœ¨ä¸‹é¢æ”¤é–‹è‰²ç¥¨ï¼‰æ”¹æˆï¼šé»žä¸‹åŽ»æ•´å€‹é¢æ¿æ›æˆé€™ä¸€é ï¼Œ
 * ä¸Šé¢ä¸€é¡†è¿”å›žï¼Œä¸‹é¢æ˜¯æŽ’å¥½å¹¾åˆ—çš„è‰²ç¥¨ â€”â€” è·Ÿå‰µæ„æ‹¼åœ–çš„ç´‹ç†é¡è‰²åŒä¸€ç¨®æ“ä½œã€‚
 */
export const ColorPickerPage: React.FC<{
  value: string;
  colors?: string[];
  onPick: (c: string) => void;
  onBack: () => void;
}> = ({ value, colors, onPick, onBack }) => {
  /* é€²ä¾†æ™‚æŠŠå¤–é¢é‚£å€‹æ²å‹•å®¹å™¨æ²å›žæœ€ä¸Šé¢ â€”â€”
     ä¸ç„¶æœƒæ²¿ç”¨ä¸Šä¸€é æ²åˆ°å“ªå°±åœåœ¨å“ªï¼Œä¸€é€²é¡è‰²é çœ‹åˆ°çš„æ˜¯ä¸­é–“æŸä¸€æ®µã€‚ */
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
        aria-label="è¿”å›ž"
        title="è¿”å›ž"
        className="flex items-center gap-1 px-2 h-7 -ml-1 rounded-[4px] text-[10px] font-bold text-[#888] hover:text-white hover:bg-white/[0.06] transition-colors"
      >
        <ChevronLeft size={14} />
        <span>è¿”å›ž</span>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-[9px] font-mono text-white/40">{(value || '').toUpperCase()}</span>
        <div className="w-6 h-5 rounded-[4px] shadow-inner border border-white/10" style={{ backgroundColor: value }} />
      </div>
    </div>
    {/* è‰²ç¥¨åªæŽ’ä¸€æŽ’ï¼ˆæŽ’ä¸ä¸‹å°±æ©«å‘æ²ï¼‰ï¼Œä¸‹é¢æŽ¥è‰²ç›¸ï¼é£½å’Œåº¦ï¼æ˜Žåº¦ â€”â€”
        è·Ÿç´‹ç†é¡è‰²é‚£ä¸€é æ˜¯åŒä¸€é¡†å…ƒä»¶ã€åŒä¸€ç¨®æ“ä½œã€‚
        å¤–é¢åŒ…ä¸€å±¤é«˜åº¦ auto çš„ç›’å­ï¼šæŒ‘è‰²å™¨çš„æ ¹æ˜¯ h-fullï¼Œç›´æŽ¥æ”¾æœƒæ’æ»¿æ•´æ ¼ã€‚ */}
    <div>
      <ColorPickerEmbedded color={value || '#FFFFFF'} onChange={onPick} onClose={onBack} />
    </div>
  </div>
  );
};

/* â”€â”€ æ–°å¢žåœ–å½¢ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   åœ–å½¢åœ–å±¤è·Ÿç…§ç‰‡ã€æ–‡å­—ä¸€æ¨£éƒ½æ˜¯ floatingImages è£¡çš„ä¸€å“¡ï¼ˆä½ç½®ã€ç¸®æ”¾ã€æ—‹è½‰ã€
   åœ–å±¤é †åºã€è¤‡è£½ã€åˆªé™¤å…¨éƒ¨æ²¿ç”¨åŒä¸€å¥—ï¼‰ï¼Œåªæ˜¯å…§å®¹æ›æˆä¸€æ¢è·¯å¾‘ã€‚

   è·¯å¾‘åªå¯«ä¸€ä»½ã€å›žå‚³ SVG çš„ d å­—ä¸²ï¼š
     é è¦½ â†’  <svg><path d={...} />
     åŒ¯å‡º â†’  new Path2D(åŒä¸€æ¢ d)
   å…©é‚Šåƒçš„æ˜¯åŒä¸€æ¢å­—ä¸²ï¼Œæ‰€ä»¥ç•«å¸ƒä¸Šçœ‹åˆ°çš„è·Ÿå­˜ä¸‹ä¾†çš„ä¸å¯èƒ½é•·å¾—ä¸ä¸€æ¨£ã€‚

   è€Œä¸”æ˜¯ã€Œç…§å¤–æ¡† wÃ—h ç›´æŽ¥ç•«ã€ï¼Œä¸æ˜¯å…ˆç•«æ­£æ–¹å½¢å†æ‹‰ä¼¸ â€”â€”
   æ‹‰æˆé•·æ–¹å½¢æ™‚æé‚Šçš„ç²—ç´°æ‰ä¸æœƒè·Ÿè‘—è¢«æ‹‰æ‰ã€‚ */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** SVG é¢„è§ˆç”¨çš„çº¹ç†å­—å½¢ï¼›å°ºå¯¸ä¸Ž utils/pattern.ts çš„ canvas patternGlyph å®Œå…¨ç›¸åŒã€‚ */
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
  /* gridBaseW/H æœƒè·Ÿè‘—ã€Œç­‰æ¯”ä¾‹ç¸®æ”¾ã€ä¸€èµ·è®Šï¼Œä½†å››é‚Šæ“ å£“æ™‚ä¿æŒä¸å‹•ã€‚
     å› æ­¤ç¸®æ”¾åªæœƒæŠŠæ•´å¼µç¶²æ ¼ç­‰æ¯”æ”¾å¤§ï¼›åªæœ‰è®Šå½¢æ‰æœƒå¢žåŠ é‡è¤‡å–®ä½ã€‚ */
  const gbw = Math.max(1, gridBaseW), gbh = Math.max(1, gridBaseH);
  const P = (x: number, y: number) => `${r3(x)} ${r3(y)}`;
  const poly = (pts: [number, number][]) =>
    `M ${P(pts[0][0], pts[0][1])} ${pts.slice(1).map(p => `L ${P(p[0], p[1])}`).join(' ')} Z`;
  /** æ­£ n é‚Šå½¢ï¼Œstart æ˜¯ç¬¬ä¸€å€‹é ‚é»žçš„è§’åº¦ */
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
      // å…©æ®µåŠæ©¢åœ“å¼§æŽ¥æˆä¸€åœˆï¼ˆå–®ä¸€ A æŒ‡ä»¤ç•«ä¸äº†æ•´åœˆï¼‰
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
      // å››è¾¹æŒ¤åŽ‹å¿…é¡»çœŸæ­£æ”¹å˜è·¯å¾„æœ¬èº«ï¼›ä¸‰è§’å½¢ç›´æŽ¥å æ»¡å½“å‰ wÃ—hï¼Œ
      // ä¸èƒ½å†å¼ºåˆ¶ç»´æŒæ­£ä¸‰è§’å½¢åŽåªåœ¨å˜å¤§çš„å¤–æ¡†é‡Œé‡æ–°ç½®ä¸­ã€‚
      return poly([[w / 2, 0], [w, h], [0, h]]);
    }
    case 'diamond':
      return poly([[cx, 0], [w, cy], [cx, h], [0, cy]]);
    /* çª„è±å½¢ï¼šä¸€æ¨£çš„å››å€‹è§’ï¼Œåªæ˜¯å·¦å³å¾€å…§æ”¶ â€”â€” ç›´ç«‹ã€ç´°é•·çš„é‚£ç¨® */
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
      // å…«ç“£æ©¢åœ“é›²ï¼šä»¥å®Œå…¨å°ç¨±çš„é€±æœŸå‡½æ•¸å»ºç«‹å…«å€‹ç›¸åŒåœ“é ‚ï¼Œ
      // è°·åº•åˆ»æ„åŠ æ·±ï¼Œè®“æ¯ä¸€å€‹å‡¸èµ·åœ¨å°å°ºå¯¸æŒ‰éˆ•ä¸Šä¹Ÿæ¸…æ¥šå¯è¾¨ã€‚
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
    /* æ©¢åœ“ï¼šè·Ÿåœ“å½¢åŒä¸€æ¢è·¯å¾‘ â€”â€” æ¡†ä¸æ˜¯æ­£æ–¹å½¢æ™‚å®ƒè‡ªç„¶å°±æ˜¯æ©¢åœ“ */
    case 'ellipse':
      return `M ${P(0, cy)} A ${r3(a)} ${r3(b)} 0 1 1 ${P(w, cy)} A ${r3(a)} ${r3(b)} 0 1 1 ${P(0, cy)} Z`;
    /* é›²æœµï¼šå¹³åº•ã€ä¸Šé¢ä¸‰å€‹é«˜ä½Žä¸åŒçš„åœ“é§å³°ã€‚
       æŽ§åˆ¶é»žæ˜¯ç…§è‘—ç•«å¥½çš„é›²é‡å‡ºä¾†çš„æ¯”ä¾‹ï¼ˆ0~1ï¼‰ï¼Œæ‰€ä»¥æ¡†æ‹‰æˆä»€éº¼æ¯”ä¾‹ï¼Œ
       é›²å°±è·Ÿè‘—ç­‰æ¯”ä¾‹è®Šå½¢ï¼Œå…©é‚Šä¹Ÿå‰›å¥½è²¼é½Šæ¡†ï¼ˆ0 èˆ‡ 1ï¼‰ã€‚ */
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
    /* å°è©±æ¡†ï¼šæ©¢åœ“æœ¬é«”ï¼Œå·¦ä¸‹è§’ä¼¸å‡ºä¸€æ”¯å°¾å·´ã€‚
       æœ¬é«”ä½”ä¸Šé¢ 80%ï¼Œå‰©ä¸‹çš„ 20% ç•™çµ¦å°¾å·´ï¼Œæ‰€ä»¥æ•´æ¢è·¯å¾‘å‰›å¥½å¡žæ»¿å¤–æ¡†ã€‚ */
    case 'bubble': {
      const bb = h * 0.80;                        // æ©¢åœ“æœ¬é«”çš„é«˜åº¦
      const bx = w / 2, by = bb / 2;              // æœ¬é«”çš„ä¸­å¿ƒ
      const ra = w / 2, rb = bb / 2;              // æœ¬é«”çš„å…©å€‹åŠå¾‘
      /** æœ¬é«”ä¸Šè§’åº¦ tï¼ˆåº¦ï¼Œé †æ™‚é‡ã€0 æ˜¯æœ€å³é‚Šï¼‰çš„é‚£ä¸€é»ž */
      const E = (t: number) => {
        const rad = t * Math.PI / 180;
        return P(bx + ra * Math.cos(rad), by + rb * Math.sin(rad));
      };
      /** æ²¿è‘—æœ¬é«”å¾žç¾åœ¨çš„ä½ç½®ç•«åˆ°è§’åº¦ tï¼ˆlargeï¼è¦ä¸è¦èµ°å¤§çš„é‚£ä¸€æ®µå¼§ï¼‰ */
      const A = (t: number, large: 0 | 1) => `A ${r3(ra)} ${r3(rb)} 0 ${large} 1 ${E(t)}`;
      // å°¾å·´æŽ¥åœ¨æœ¬é«”å·¦ä¸‹ï¼ˆ115Â°ï½ž137Â°ï¼‰â€”â€” æŽ¥å£çª„ã€å°–ç«¯æ›´é å·¦ï¼Œæ–œå¾—æ¯”è¼ƒæ˜Žé¡¯
      return `M ${E(0)} ${A(115, 0)} L ${P(w * 0.04, h)} L ${E(137)} ${A(360, 1)} Z`;
    }
    case 'grid-h': {
      const stepY = gbh / 6; // åŽŸå¯†åº¦çš„ä¸€åŠï¼šåˆå§‹å…­æ¢
      let d = '';
      for (let y = stepY / 2; y < h; y += stepY) d += `M 0 ${r3(y)} L ${r3(w)} ${r3(y)} `;
      // å£“å¾—æ¯”ä¸€å€‹é€±æœŸæ›´çª„æ™‚ä»ä¿ç•™æ­£ä¸­å¤®ä¸€æ¢ï¼Œä¸æœƒç¸®åˆ°å®Œå…¨æ¶ˆå¤±ã€‚
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
      /* åˆå§‹ 6Ã—6ã€‚æ¯æ¬¡ä»¥å®Œæ•´æ ¼æ•¸é‡æ–°ç­‰åˆ†ï¼Œ
         æ‰€ä»¥å››é‚Šæ°¸é å‰›å¥½å°å£ï¼Œä¸æœƒåœ¨å³å´æˆ–åº•éƒ¨ç•™ä¸‹æ¯”è¼ƒçª„çš„å°æ ¼ã€‚ */
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
      /* åˆå§‹å›ºå®š 8Ã—8ã€‚ç¸®æ”¾æ™‚ w èˆ‡ base åŒæ¯”ä¾‹è®ŠåŒ–ï¼Œæ•¸é‡ç¶­æŒ 8Ã—8ï¼›
         å–®é‚Šè®Šå½¢åªæ”¹ w/hï¼Œæ‰æœƒè‡ªç„¶å¢žåŠ æˆ–æ¸›å°‘è¡Œåˆ—ã€‚ */
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
      /* é è¨­æ–œç·šæ•¸é‡åŠ å€ï¼›è®Šå½¢æ‰åœ¨å…©ç«¯å¢žæ¸›å®Œæ•´ç·šæ®µã€‚ */
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
      // æ³¢é•·è·Ÿé«˜åº¦ç¶å®šï¼›åªå¢žåŠ å¯¬åº¦æ™‚æœƒåŠ å…¥å®Œæ•´æ³¢å³°ï¼Œè€Œä¸æ˜¯æŠŠæ—¢æœ‰æ³¢å½¢æ‹‰æ‰ã€‚
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
      // ç¨œè§’æ³¢æµªåŒæ¨£ä»¥å®Œæ•´é€±æœŸå¢žæ¸›ï¼›æ¯ä¸€å€‹é€±æœŸä¿æŒå›ºå®šçš„é–ƒé›»æŠ˜è§’æ¯”ä¾‹ã€‚
      const count = Math.max(1, Math.round(w / Math.max(1, h * 0.9)));
      const step = w / count;
      // æ¯ä¸€æ®µçš„æ°´å¹³è·é›¢èˆ‡åž‚ç›´è·é›¢ç›¸åŒï¼Œå…©æ¢ Â±45Â° ç·šç›¸äº¤æ™‚æ­£å¥½æ˜¯ 90Â°ã€‚
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
 * åœ–å½¢çš„ç·šå¯¬ã€‚åŸºæº–æ˜¯ã€Œå¤–æ¡†é•·é‚Šçš„ 1/160ã€ï¼Œæ‰€ä»¥åŒä¸€å€‹ç²—ç´°å€¼åœ¨å¤§åœ–å½¢èˆ‡
 * å°åœ–å½¢ä¸Šçœ‹èµ·ä¾†ä¸€æ¨£ç²—ï¼Œç¸®æ”¾æ™‚ä¹Ÿè·Ÿè‘—ç­‰æ¯”ä¾‹èµ°ã€‚
 */
export const shapeLineWidth = (lineW: number | undefined, w: number, h: number) =>
  Math.max(0.4, (lineW ?? 6) * (Math.max(w, h) / 160));

/**
 * åœ–å½¢çš„ç™¼å…‰ï¼šä¸‰æ®µæ¨¡ç³Šç–Šèµ·ä¾†ï¼ˆè·Ÿæ–‡å­—ã€åœ–ç‰‡çš„ç™¼å…‰åŒä¸€å¥—åšæ³•ï¼‰ï¼Œ
 * é¡è‰²å°±ç”¨åœ–å½¢è‡ªå·±çš„é¡è‰²ã€‚åŠå¾‘è·Ÿè‘—åœ–å½¢å¤§å°èµ°ï¼Œæ”¾å¤§ç¸®å°æ™‚è§€æ„Ÿä¸€è‡´ã€‚
 */
export const shapeGlowBlurs = (w: number, h: number) =>
  [1, 2, 3].map(k => Math.max(w, h) * 0.045 * k);

/** æ–°å¢žåœ–å½¢æ™‚çš„é è¨­å€¼ã€‚ç·šæ¢æ¯”è¼ƒç´°é•·ï¼Œæ‰€ä»¥ç²—ç´°èˆ‡å¤§å°å¦å¤–çµ¦ã€‚ */
export const SPECIAL_LINE_KINDS = new Set(['line', 'wave', 'lightning-wave']);
export const GRID_SHAPE_KINDS = new Set([
  'grid-h', 'grid-cross', 'grid-frame', 'grid-dots', 'grid-dots-fade', 'grid-diag',
]);
export const GRID_DOT_KINDS = new Set(['grid-dots', 'grid-dots-fade']);
export const SHAPE_DEFAULT_LINEW = (kind: string) =>
  (kind === 'wave' || kind === 'lightning-wave') ? 2.5 : (kind === 'line' ? 4 : 6);
/** ç”Ÿæˆæ™‚ä½”é é¢çŸ­é‚Šçš„æ¯”ä¾‹ã€‚ç·šæ¢ä¿æŒåŽŸæœ¬çš„é•·åº¦ï¼Œå…¶é¤˜ä¸€å¾‹æ¸›åŠã€‚ */
export const SHAPE_DEFAULT_RATIO = (kind: string) =>
  (kind === 'wave' || kind === 'lightning-wave') ? 0.576 : (kind === 'line' ? 0.24 : 0.15);
/** æ–°åœ–å½¢çš„é è¨­é¡è‰²ã€‚ */
export const SHAPE_DEFAULT_COLOR = '#DCE7DB';

/** å››é‚Šæ“ å£“ç™½åå–®ï¼šå¯¦å¿ƒå‰ 11 é¡†ã€é‚Šæ¡†å‰ 16 é¡†ã€‚ */
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
/** ç¾½åŒ–åªå¼€æ”¾ç»™å‰åä¸ªåŸºç¡€å®žå¿ƒè·¯å¾„å›¾å½¢ï¼›ç¬¬åä¸€ä¸ªå®žå¿ƒåå­—æ˜Ÿä¸æ”¯æŒã€‚ */
export const shapeSupportsFeather = (_shape: string | undefined, _filled: boolean | undefined, _holeType?: string) => false;
export const shapeFeatherBlur = (w: number, h: number, value?: number) =>
  Math.max(0, Math.min(w, h) * (Math.max(0, Math.min(100, value || 0)) / 100) * 0.03);

/** å°†å®žå¿ƒå›¾å½¢å…ˆç”»åˆ°ç‹¬ç«‹ç”»å¸ƒï¼Œå†ç”¨å†…ç¼©æ¨¡ç³Š alpha é®ç½©åˆæˆã€‚
 * ä¸Žå›¾ç‰‡è¾¹ç¼˜ç¾½åŒ–ä¸€æ ·ï¼Œæ”¹å˜çš„æ˜¯è¾¹ç¼˜é€æ˜Žåº¦ï¼Œè€Œä¸æ˜¯ç»™ç¡¬è¾¹å›¾å½¢åŠ ä¸€å±‚è§†è§‰ blurã€‚ */
export const drawFeatheredShapeBody = (
  target: CanvasRenderingContext2D,
  kind: string, w: number, h: number, _feather: number | undefined,
  color: string,
  paintTexture?: (ctx: CanvasRenderingContext2D, path: Path2D) => void,
) => {
  // åœ–å½¢ç¾½åŒ–å·²ç§»é™¤ï¼›ä¿ç•™åŒä¸€å€‹ç¹ªè£½å…¥å£ä»¥ç›¸å®¹æ—¢æœ‰è‰ç¨¿è³‡æ–™ã€‚
  const path = new Path2D(shapePathD(kind, w, h));
  target.fillStyle = color;
  target.fill(path);
  paintTexture?.(target, path);
};

/** ã€Œæ–°å¢žåœ–å½¢ã€æ¸…å–®ã€‚rot æ˜¯æŒ‰éˆ•èˆ‡åœ–å½¢éƒ½è¦è½‰çš„è§’åº¦ï¼Œratio æ˜¯é«˜åº¦ä½”å¯¬åº¦çš„æ¯”ä¾‹ */
export type ShapeItem = { id: string; kind: string; filled: boolean; rot?: number; ratio?: number; glyphRatio?: number };
export const ADD_SHAPE_ITEMS: ShapeItem[] = [
  // å¯¦å¿ƒ
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
  // ç´°æ¡†
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
  // ç·šæ¢
  { id: 'line-h', kind: 'line', filled: false, rot: 0, ratio: 0.08 },
  { id: 'line-v', kind: 'line', filled: false, rot: 90, ratio: 0.08 },
  { id: 'line-d1', kind: 'line', filled: false, rot: -45, ratio: 0.08 },
  { id: 'line-d2', kind: 'line', filled: false, rot: 45, ratio: 0.08 },
  { id: 'line-wave', kind: 'wave', filled: false, rot: 90, ratio: 0.1417, glyphRatio: 0.17 },
  { id: 'line-lightning-wave', kind: 'lightning-wave', filled: false, rot: 90, ratio: 0.1417, glyphRatio: 0.17 },
  // ç¶²æ ¼ï¼šç·šï¼é»žçš„å°ºå¯¸å›ºå®šï¼›æ”¹è®Šå¤–æ¡†åªæœƒå¢žæ¸›é‡è¤‡å–®ä½
  { id: 'grid-horizontal', kind: 'grid-h', filled: false },
  { id: 'grid-cross', kind: 'grid-cross', filled: false },
  { id: 'grid-frame', kind: 'grid-frame', filled: false },
  { id: 'grid-dots', kind: 'grid-dots', filled: true },
  { id: 'grid-dots-fade', kind: 'grid-dots-fade', filled: true },
  { id: 'grid-diagonal', kind: 'grid-diag', filled: false },
];

/**
 * æ¯ä¸€ç¨®åœ–å½¢ã€Œå¯¦éš›ç•«å‡ºä¾†çš„å…§å®¹ã€åœ¨ 0~1 çš„æ¡†è£¡ä½”å“ªä¸€å¡Š [x, y, w, h]ã€‚
 *
 * æœ‰äº›åœ–å½¢æœ¬ä¾†å°±ä¸æœƒå¡žæ»¿æ•´å€‹å¤–æ¡†ï¼ˆäº”é‚Šå½¢èˆ‡æ˜Ÿå½¢ä¸‹é¢ç©ºä¸€æˆªã€å…­é‚Šå½¢å·¦å³ç©ºã€
 * æ„›å¿ƒå››å‘¨éƒ½ç©ºï¼‰ï¼Œæ‰€ä»¥æŒ‰éˆ•ä¸Šçš„å°åœ–å¦‚æžœç›´æŽ¥ç…§å¤–æ¡†ç•«ï¼Œçœ‹èµ·ä¾†å°±æ˜¯åä¸€é‚Šã€‚
 * é€™å¼µè¡¨æ˜¯æ‹¿çœŸæ­£çš„è·¯å¾‘é‡å‡ºä¾†çš„ï¼ˆè·¯å¾‘æ˜¯å›ºå®šçš„å¸¸æ•¸ï¼Œé‡ä¸€æ¬¡å°±å¥½ï¼‰ï¼Œ
 * æŒ‰éˆ•é å®ƒæŠŠåœ–æ¡ˆç¸®åˆ°å‰›å¥½ã€æ“ºåˆ°æ­£ä¸­é–“ã€‚
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

/** å€‹åˆ¥åœ–æ¡ˆçš„åŠ å¤§å€çŽ‡ã€‚æ˜Ÿå½¢æ˜¯å¯¦å¿ƒé¢ç©æœ€å°‘çš„ä¸€å€‹ï¼Œç¨å¾®æ”¾å¤§ä¸€é»žæ‰çœ‹å¾—æ¸…æ¥šã€‚
    1.1 ï¼ é•·é‚Šå¾ž 20px è®Šæˆ 22pxã€‚ */
const GLYPH_ZOOM: Record<string, number> = { star: 1.1, star8: 1.22, 'cloud-oval': 1.3 };

/**
 * ã€Œæ–°å¢žåœ–å½¢ã€æŒ‰éˆ•ä¸Šçš„å°åœ–ã€‚
 *
 * åˆ»æ„ä¸ç”¨åœ–ç¤ºå­—åž‹ï¼šå°ˆæ¡ˆè£¡çš„ Material Symbols æ˜¯**å­é›†**ï¼ˆåªæ‰“åŒ…äº†æœ‰ç”¨åˆ°çš„å­—ï¼‰ï¼Œ
 * pentagonã€hexagonã€favoriteã€horizontal_rule é€™å¹¾å€‹æ ¹æœ¬ä¸åœ¨è£¡é¢ â€”â€”
 * ç”¨äº†å°±æœƒç›´æŽ¥æŠŠè‹±æ–‡å­—å°åœ¨æŒ‰éˆ•ä¸Šï¼Œé‚„æœƒæ’çˆ†æ ¼å­è“‹åˆ°éš”å£é‚£é¡†ã€‚
 * æ”¹æˆç”¨ shapePathD è‡ªå·±ç•«ï¼šæŒ‰éˆ•ä¸Šçœ‹åˆ°çš„å½¢ç‹€ã€å¯¦å¿ƒï¼ç´°æ¡†ã€è§’åº¦ï¼Œ
 * å°±æ˜¯æŒ‰ä¸‹åŽ»ä¹‹å¾ŒçœŸçš„æœƒåŠ é€²ç•«é¢çš„é‚£ä¸€å€‹ï¼Œä¸€æ¨¡ä¸€æ¨£ã€‚
 *
 * ç•«æ³•ï¼šå…ˆç…§å¤–æ¡†ç•«ä¸€æ¬¡ï¼Œå†ç”¨ SHAPE_FIT æŠŠã€ŒçœŸæ­£æœ‰ç•«åˆ°çš„é‚£ä¸€å¡Šã€
 * ç¸®æ”¾ä¸¦å¹³ç§»åˆ° 24Ã—24 çš„æ­£ä¸­å¤® â€”â€” æ‰€ä»¥æ¯ä¸€é¡†æŒ‰éˆ•çš„åœ–æ¡ˆéƒ½åœ¨æ­£ä¸­å¿ƒã€‚
 */
export const ShapeGlyph: React.FC<{ item: ShapeItem; size?: number }> = ({ item, size = 20 }) => {
  const isLine = item.kind === 'line';
  const isGridGlyph = GRID_SHAPE_KINDS.has(item.kind);
  /* viewBox èˆ‡åœ–æ¡ˆçš„æ¡†ä¸€æ¨£å¤§ â€”â€” æ¯ä¸€é¡†åœ–æ¡ˆçš„é•·é‚Šéƒ½å‰›å¥½ç­‰æ–¼ sizeï¼ˆé è¨­ 20pxï¼‰ï¼Œ
     æ‰€ä»¥ä¸ç®¡å“ªä¸€ç¨®å½¢ç‹€ï¼Œçœ‹èµ·ä¾†éƒ½ä¸€æ¨£å¤§ã€‚ */
  const VB = 24;
  const BOX = VB;
  /* æœ‰æŒ‡å®šæ¯”ä¾‹çš„ï¼ˆ3:4ã€2:3â€¦ é‚£ç¨®é‚Šæ¡†ã€æ©¢åœ“ï¼‰è¦ç…§æ¯”ä¾‹ç•«ï¼Œ
     ä¸ç„¶æŒ‰éˆ•ä¸Šæœƒå…¨éƒ¨è®Šæˆæ­£æ–¹å½¢ã€çœ‹ä¸å‡ºå·®åˆ¥ã€‚ */
  const ratio = isLine ? 0 : ((item as any).glyphRatio ?? (item as any).ratio ?? 0);
  const bw = BOX;
  const bh = isLine ? 0 : (ratio ? BOX * ratio : BOX);
  const src = shapePathD(item.kind, bw, bh);
  const solid = item.filled && (!isLine || GRID_DOT_KINDS.has(item.kind));

  const fit = SHAPE_FIT[item.kind] || [0, 0, 1, 1];
  // å…§å®¹çš„å¯¦éš›å¤§å°ï¼ˆç·šæ¢çš„é«˜åº¦æ˜¯ 0ï¼Œç¸®æ”¾åªçœ‹å¯¬åº¦ï¼‰
  const cw = fit[2] * bw, ch = fit[3] * bh;
  const k = (GLYPH_ZOOM[item.kind] || 1)
    * Math.min(cw > 0 ? BOX / cw : Infinity, ch > 0 ? BOX / ch : Infinity);
  // å…ˆæŠŠå…§å®¹çš„ä¸­å¿ƒæ¬åˆ°åŽŸé»žã€æ”¾å¤§ã€å†æ¬åˆ° viewBox çš„æ­£ä¸­å¤®
  const ccx = (fit[0] + fit[2] / 2) * bw;
  // ç·šæ¢çš„è·¯å¾‘é«˜åº¦æ˜¯ 0ï¼ˆç•«åœ¨ y=0 é‚£ä¸€æ¢ï¼‰ï¼Œæ‰€ä»¥å®ƒçš„å…§å®¹ä¸­å¿ƒ y å°±æ˜¯ 0
  const ccy = isLine ? 0 : (fit[1] + fit[3] / 2) * bh;
  /* é †åºæœ‰è¬›ç©¶ï¼šå…ˆæŠŠå…§å®¹ä¸­å¿ƒæ¬åˆ°åŽŸé»ž â†’ è½‰è§’åº¦ â†’ ç¸®æ”¾ â†’ æ¬åˆ° viewBox æ­£ä¸­å¤®ã€‚
     ï¼ˆSVG çš„ transform æ˜¯ç”±å·¦å¾€å³å¥—ç”¨åˆ°åº§æ¨™ç³»ä¸Šï¼Œæ‰€ä»¥å¯«èµ·ä¾†å‰›å¥½æ˜¯åéŽä¾†çš„ã€‚ï¼‰
     è½‰è§’åº¦è¦åœ¨ã€Œæ¬åˆ°åŽŸé»žä¹‹å¾Œã€ï¼Œä¸ç„¶æ–œç·šæœƒç¹žè‘—è‡ªå·±çš„ç«¯é»žè½‰ï¼Œå°±æ­ªæŽ‰äº†ã€‚ */
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

/* ã€Œåœ–æ¡ˆã€é‚£å¹¾é¡†å€ŸéŽä¾†çš„åœ–å½¢ï¼ŒæŒ‰éˆ•ä¸Šçš„å°åœ–è·Ÿå‰µæ„æ‹¼åœ–ç”¨åŒä¸€ä»½ â€”â€” 
   å…©å€‹å·¥å…·çš„æ¸…å–®é•·å¾—ä¸€æ¨£ï¼Œé»žä¸‹åŽ»åŠ å‡ºä¾†çš„ä¹Ÿæ˜¯åŒä¸€é¡†ã€‚ */
/* --- è‡ªè£½åå­—æ˜Ÿåœ–æ¨™ ---
   åŒä¸€æ¢è·¯å¾‘å…©ç¨®ç•«æ³•ï¼šfilled å°±å¡«æ»¿ã€ä¸å¡«å°±æé‚Šã€‚
   ï¼ˆã€Œæ–°å¢žåœ–å½¢ã€å¯¦å¿ƒé‚£ä¸€æŽ’çš„ç¬¬ 11 é¡†æ˜¯å¯¦å¿ƒç‰ˆï¼Œé‚Šæ¡†é‚£æŽ’æ˜¯æé‚Šç‰ˆã€‚ï¼‰ */
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

// --- è‡ªè£½å–®ç·šæ—‹æ¸¦åœ–æ¨™ ---
export const VortexIcon = ({ size = 20, strokeWidth = 2.2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
    <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5 8.5 8.5 0 0 1-8.5 8.5 7.5 7.5 0 0 1-7.5-7.5 6.5 6.5 0 0 1 6.5-6.5 5.5 5.5 0 0 1 5.5 5.5 4.5 4.5 0 0 1-4.5 4.5 3.5 3.5 0 0 1-3.5-3.5 2.5 2.5 0 0 1 2.5-2.5 1.5 1.5 0 0 1 1.5 1.5" />
  </svg>
);

/** ä¸€é¡†ã€Œåœ–æ¡ˆã€çš„å°åœ–ï¼ˆå½¢ç‹€åˆ†é çš„é¸å–®èˆ‡ã€Žæ–°å¢žåœ–å½¢ã€æ¸…å–®å…±ç”¨åŒä¸€ä»½ï¼‰ã€‚ */
/* å¯¦å¿ƒç‰ˆçš„åå­—æ˜Ÿæ˜¯ã€Œå‡¹é€²åŽ»ã€çš„å››è§’æ˜Ÿï¼ŒåŒæ¨£ 18px ç•«å‡ºä¾†çš„å¢¨æ°´æ¯”æ—é‚Šé‚£äº›
   åœ–ç¤ºå°‘å¾ˆå¤šã€çœ‹èµ·ä¾†å°ä¸€è™Ÿ â€”â€” æ‰€ä»¥å¯¦å¿ƒç‰ˆå–®ç¨æ”¾å¤§åˆ° 28pxã€‚ */
export const HoleGlyph: React.FC<{ s: string; filled?: boolean }> = ({ s, filled }) => (
  <>
    {s === 'circle' ? <Circle size={18} /> : s === 'square' ? <Square size={18} /> : s === 'cross-star' ? <CrossStarIcon size={filled ? 28 : 22} filled={filled} /> : s === 'heart' ? <Heart size={18} /> : s === 'star' ? <Star size={18} /> : s === 'love' ? <span className="text-xs font-black font-mono tracking-tighter leading-none">&lt;3</span> : s === 'love3' ? <span className="text-[10px] font-black font-mono tracking-tighter leading-none">&lt;333</span> : s === 'vortex' ? <VortexIcon size={18} /> : s === 'random-num' ? <span className="text-sm font-bold font-sans leading-none tracking-tight">(9)</span> : SHAPE_IMAGES[s] ? (
                        /* åŽ»èƒŒçš„åœ–ï¼šæ‹¿å®ƒç•¶é®ç½©ã€åº•è‰²ç”¨ currentColorï¼Œ
                           é¡è‰²å°±è·Ÿæ—é‚Šé‚£äº›åœ–ç¤ºèµ°åŒä¸€æ¢è¦å‰‡ â€”â€”
                           æ²’é¸ä¸­æ™‚æ˜¯æš—çš„ï¼ˆ#555ï¼‰ï¼Œé¸ä¸­æ‰è®Šç™½ã€‚
                           ï¼ˆåŽŸæœ¬æ˜¯ç”¨ filter ç¡¬æŸ“æˆç™½è‰²ï¼Œæ‰€ä»¥æ°¸é äº®è‘—ã€‚ï¼‰ */
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
    // æ²åˆ°æ‰è¼‰å…¥ï¼Œå¦å‰‡ä¸€æ¬¡è¦æŠ“ä¸Šç™¾å€‹ CJK å­—é«”
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
      {/* è¡Œé«˜ä¸èƒ½ç”¨ leading-noneï¼šé‚£æ¨£è¡Œç›’åªæœ‰ 19pxï¼Œå¯æ˜¯ä¸å°‘å­—é«”ï¼ˆå°¤å…¶æ˜¯ä¸­æ—¥éŸ“ï¼‰
          çš„å­—èº«é«˜åº¦è¶…éŽ 1 å€‹ em â€”â€” truncate å¸¶è‘— overflow:hiddenï¼Œè¶…å‡ºåŽ»çš„éƒ¨åˆ†
          å°±è¢«åˆ‡æŽ‰äº†ï¼Œçœ‹èµ·ä¾†å°±æ˜¯ç¯„ä¾‹å­—ä¸Šé¢è¢«è“‹ä½ä¸€æˆªã€‚
          æ”¾åˆ° 1.6 em è®“ä»»ä½•å­—é«”éƒ½æ”¾å¾—ä¸‹ï¼›å¡ç‰‡æ˜¯ 62px é«˜ã€å…§å®¹åŠ èµ·ä¾† 48pxï¼Œé‚„æœ‰é¤˜è£•ã€‚ */}
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

/* â”€â”€ æ–°å¢žç¬¦è™Ÿ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   ç¬¦è™Ÿèªªåˆ°åº•å°±æ˜¯ä¸€æ®µæ–‡å­—ï¼Œæ‰€ä»¥åŠ é€²ç•«é¢ä¹‹å¾Œå°±æ˜¯ä¸€å€‹æ–‡å­—åœ–å±¤ï¼šä¸€æ¨£å¯ä»¥æ‹–ã€
   å¯ä»¥ç¸®æ”¾æ—‹è½‰ã€å¯ä»¥é»žå…©ä¸‹ç›´æŽ¥åœ¨ç•«å¸ƒä¸Šæ”¹å­—ã€‚å·®åˆ¥åªåœ¨å¯ä»¥èª¿çš„æ±è¥¿æ¯”è¼ƒå°‘
   ï¼ˆé¡è‰²ã€å¤§å°ã€ç™¼å…‰ï¼‰ï¼Œé‚£æ˜¯ TextEditorPanel çš„ symbol æ¨¡å¼åœ¨ç®¡ã€‚ */

/**
 * ä¸€é¡†ç¬¦è™ŸæŒ‰éˆ•ä¸Šçš„åœ–ã€‚
 *
 * æœ‰äº›ç¬¦è™Ÿç‰¹åˆ¥é•·ï¼ˆæœ€é•·çš„æŽ¥è¿‘ä¸€ç™¾å€‹å­—ï¼‰ï¼Œç…§åŽŸæœ¬çš„å­—ç´šç•«ä¸€å®šæœƒæˆ³å‡ºæŒ‰éˆ•ï¼Œ
 * æ‰€ä»¥é‡å®ŒçœŸæ­£éœ€è¦çš„å¯¬åº¦ä¹‹å¾Œï¼Œæ•´ä¸²ç­‰æ¯”ç¸®å°å¡žé€²åŽ»ã€‚ç¸®çš„æ˜¯ã€Œç•«å‡ºä¾†çš„å¤§å°ã€
 * ï¼ˆtransformï¼‰ï¼Œä¸æ˜¯å­—ç´š â€”â€” æŽ’ç‰ˆã€çµ„åˆé™„åŠ ç¬¦è™Ÿï¼ˆç–Šåœ¨å‰ä¸€å€‹å­—ä¸Šé¢çš„å°é»žã€
 * å°æ˜Ÿæ˜Ÿï¼‰çš„ä½ç½®éƒ½ä¸æœƒè·‘æŽ‰ï¼Œè€Œä¸”çœ‹åˆ°çš„ä¸€å®šæ˜¯å®Œæ•´çš„ä¸€æ•´ä¸²ï¼Œä¸æœƒè¢«è£æŽ‰ã€
 * ä¹Ÿä¸æœƒè®Šæˆã€Œâ€¦ã€ã€‚å­—åž‹æ™šä¸€é»žæ‰è¼‰å¥½æ™‚å¯¬åº¦æœƒè®Šï¼Œæ‰€ä»¥ fonts.ready ä¹‹å¾Œ
 * å†é‡ä¸€æ¬¡ï¼›æŒ‰éˆ•æœ¬èº«å¯¬åº¦è®Šäº†ï¼ˆè½‰å‘ï¼‰ä¹Ÿç”¨ ResizeObserver é‡é‡ã€‚
 */
export const SymbolGlyph: React.FC<{ text: string; base?: number }> = ({ text, base = 15 }) => {
  /* ä¸å†ç‚ºæ¸…å–®ä¸­çš„æ¯ä¸€é¡†å»ºç«‹ stateã€ResizeObserver èˆ‡ fonts.ready å›žå‘¼ã€‚
     é‚£å¥—åšæ³•æœƒè®“å¹¾ç™¾é¡†æŒ‰éˆ•å…ˆç”¨ fallback ç•«ä¸€éï¼Œå†åŒæ™‚æ›å­—é«”èˆ‡ç¸®æ”¾ä¸€æ¬¡ï¼Œ
     æ­£æ˜¯é€²é é¢æ™‚ã€Œæ•´ç‰‡ç¬¦è™ŸæŠ–ä¸€ä¸‹ã€èˆ‡é»žæ“Šå»¶é²çš„ä¾†æºã€‚Canvas advance æ˜¯åŒæ­¥ã€
     æœ‰å¿«å–çš„ç´”é‡æ¸¬ï¼›ç¬¬ä¸€æ¬¡ç¹ªè£½å‰å°±å·²ç¶“å¾—åˆ°æœ€çµ‚å°ºå¯¸ã€‚ */
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
        /* å°‘æ•¸ç¢¼ä½åœ¨ iOS æ²’æœ‰å–®è‰²å­—èº«æ™‚ä»æœƒé€€å›ž Color Emojiï¼›é¸å–®çµ±ä¸€
           è½‰æˆç™½è‰²è¼ªå»“ï¼Œå’Œæ–°å¢žåˆ°ç•«å¸ƒå¾Œçš„å¯æ”¹è‰²ç¬¦è™Ÿä¸€è‡´ã€‚ */
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
 * ã€Œæ–°å¢žç¬¦è™Ÿã€é‚£ä¸€é ï¼šä¸Šé¢ä¸€é¡†è¿”å›žï¼Œä¸‹é¢ä¸€é•·ä¸²ç¬¦è™Ÿï¼Œé»žä¸€ä¸‹å°±åŠ åˆ°ç‰ˆé¢æ­£ä¸­é–“ã€‚
 * ä¸€æŽ’åªæ”¾ä¸€é¡† â€”â€” é•·çš„ç¬¦è™Ÿè¦ä¸€æ•´æŽ’çš„å¯¬åº¦æ‰æ“ºå¾—å®Œæ•´ã€‚
 * è·Ÿã€Œæ–°å¢žåœ–å½¢ã€ä¸€æ¨£ï¼Œé»žå®Œç•™åœ¨é€™ä¸€é ã€ä¸è·³åŽ»ç·¨è¼¯ï¼Œå¯ä»¥é€£è‘—åŠ å¥½å¹¾é¡†ã€‚
 */
export const SymbolPicker: React.FC<{
  onBack: () => void;
  onPick: (s: string) => void;
  /** å‰µæ„æ‹¼åœ–ç”¨ï¼šç›®å‰è¦äº¤çµ¦ç•«ç­†é€£çºŒç”Ÿæˆçš„ç¬¦è™Ÿã€‚ */
  selected?: string | null;
  /** åœ¨æ‰‹æŒ‡æ”¾ä¸‹ã€click è§¸ç™¼ä»¥å‰å…ˆæŠŠé€™ä¸€é¡†çš„ç²¾ç¢ºå¤–æ¡†ç®—é€²å¿«å–ã€‚ */
  onPrepare?: (s: string) => void;
}> = ({ onBack, onPick, onPrepare, selected = null }) => {
  /* å…¨éƒ¨é¸é …ä¸€æ¬¡å»ºç«‹ï¼Œä½¿ç”¨è€…ç¬¬ä¸€æ¬¡æ»‘åˆ°åº•æ™‚ä¸æœƒå†é‡åˆ°åˆ†æ‰¹è¼‰å…¥æˆ–ç©ºæŒ‰éˆ•ã€‚
     ä¸åœ¨èƒŒæ™¯é€é¡†æŽƒ alphaï¼›é‚£æœƒèˆ‡ iPhone çš„æ²å‹•ã€æ‹–æ›³ç«¶çˆ­ä¸»åŸ·è¡Œç·’ã€‚ */
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
          aria-label="è¿”å›ž"
          title="è¿”å›ž"
          className="shrink-0 w-9 h-9 -ml-2 flex items-center justify-center text-white/60 hover:text-white active:scale-90 transition-[color,transform]"
        >
          <Icon name="arrow_back" className="text-[20px]" />
        </button>
        <span className="text-[10px] font-bold text-[#888] uppercase tracking-widest">æ–°å¢žç¬¦è™Ÿ</span>
      </div>
      {/* ä¸€æ¬¡æ¸²æŸ“å®Œæ•´æ¸…å–®ï¼Œé¿å…å¾€ä¸‹æ»‘åˆ°ä¸€åŠæ‰ç­‰å¾…ä¸‹ä¸€æ‰¹ã€‚ */}
      <div className="flex flex-wrap gap-1.5 pb-4">
        {symbolButtons}
      </div>
    </div>
  );
};

/**
 * ç©ºæ ¼æç¤ºå¿…é¡»å±žäºŽå®ƒæ‰€åœ¨çš„å¸ƒå±€å›¾å±‚ã€‚
 *
 * æç¤ºç›´æŽ¥ç•™åœ¨å¸ƒå±€ wrapper å†…ï¼Œå› æ­¤ä¼šå’Œæ ¼å­ä¸€èµ·å‚ä¸Ž 59/60/61â€¦ çš„äº¤é”™å±‚çº§ï¼š
 * åœ¨å®ƒä¸Šé¢çš„ç…§ç‰‡ã€æ–‡å­—ã€å›¾å½¢æˆ–ç¬¦å·ä¼šè‡ªç„¶ç›–ä½å®ƒï¼Œä¸å†ç”± document.body ä¸Šçš„
 * å…¨ç”»é¢ Portal æ— æ¡ä»¶åŽ‹åœ¨æœ€å‰é¢ã€‚
 *
 * åŠ å·ä¸Žæ–‡å­—ä»ä»¥è¤å¹•åƒç´ ä¸ºåŸºå‡†ï¼šå¤–å±‚é¢„è§ˆç¼©æ”¾æ—¶ï¼Œç”¨åå‘å€çŽ‡æŠµé”€ï¼›å½“æ ¼å­æœ¬èº«
 * å°äºŽæç¤ºçš„è‡ªç„¶å°ºå¯¸æ—¶å†ç­‰æ¯”ç¼©å°ã€‚æ›´æ–°åªå†™åˆæˆ transformï¼Œä¸é‡æ–°æŽ’ç‰ˆå­—ä½“ã€‚
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

      /* ä¸å†æŠŠä¸€ä»½ 9px å­—ä¸Ž 16px SVG å…ˆç‚¹é˜µåŒ–ã€å†ç”¨ transform æ”¾å¤§æŠµé”€
         é¢„è§ˆç¼©æ”¾ï¼›é‚£ä¼šè®© WebKit æ²¿ç”¨ä½Žè§£æžåº¦åˆæˆè´´å›¾ï¼Œé¢„è§ˆè¶Šå°è¶Šæ¨¡ç³Šã€‚
         ç›´æŽ¥æŠŠ DOM çš„å®žé™…å­—å·ä¸Ž SVG ç‰ˆé¢å»ºç«‹åœ¨éœ€è¦çš„è§£æžåº¦ï¼Œå†ç”±å¤–å±‚é¢„è§ˆ
         ç¼©å›žè¤å¹•å°ºå¯¸ã€‚æœ€ç»ˆè§†è§‰å¤§å°ç›¸åŒï¼Œä½†æ¯ä¸€å¸§éƒ½ä»Žå‘é‡ï¼å­—ä½“è½®å»“æ …æ ¼åŒ–ã€‚ */
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
              é¸æ“‡ç›¸ç‰‡
            </span>
          </span>
        </i>
      ))}
    </div>
  );
};

/**
 * å…©æ®µå¼çš„é¡è‰²æ¬„ï¼šå¹³å¸¸åªæ˜¯ä¸€åˆ—ï¼ˆæ¨™é¡Œï¼‹è‰²è™Ÿï¼‹ä¸€å°å¡Šé¡è‰²ï¼‰ï¼Œ
 * é»žä¸€ä¸‹æ‰æŠŠè‰²ç¥¨æ”¤é–‹ä¾† â€”â€” é€™æ¨£å®ƒå¯ä»¥è·Ÿæ»‘æ¡¿ä¸¦æŽ’ï¼Œä¸æœƒæŠŠç‰ˆé¢æ’é–‹ã€‚
 * å…©å€‹æ‹¼åœ–å·¥å…·çš„æé‚Šï¼ç™¼å…‰ï¼é»žé»žé¡è‰²éƒ½ç”¨é€™ä¸€é¡†ï¼Œé•·ç›¸èˆ‡æ“ä½œå®Œå…¨ä¸€è‡´ã€‚
 */
export const ColorPick: React.FC<{
  label: string;
  value: string;
  colors?: string[];
  onPick: (c: string) => void;
  /** æœ‰çµ¦å°±ä¸å†åŽŸåœ°æ”¤é–‹è‰²ç¥¨ï¼Œæ”¹æˆå«å‘¼å«ç«¯åˆ‡åˆ°ç¨ç«‹çš„é¡è‰²é  */
  onOpen?: () => void;
  /** åªç•™æœ€å³é‚Šé‚£ä¸€é¡†è‰²å¡Šï¼šä¸ç•«å¤–æ¡†ã€ä¸å¯«ã€Œé¡è‰²ã€ã€ä¹Ÿä¸å¯«è‰²è™Ÿã€‚
      è·Ÿæ»‘æ¡¿ä¸¦æŽ’æ™‚å°±æ˜¯é€™ä¸€ç¨® â€”â€” å·¦é‚Šé‚£å€‹æ¨™é¡Œï¼ˆç™¼å…‰ï¼æé‚Šï¼‰å·²ç¶“èªªæ˜Žäº†å®ƒæ˜¯èª°çš„é¡è‰²ï¼Œ
      è‰²è™Ÿæ²’æœ‰äººæœƒåŽ»è®€ï¼Œè€Œé‚£å¼µå¡ç‰‡æœ¬ä¾†åƒæŽ‰äº†ä¸€åŠçš„å¯¬åº¦ï¼Œæ»‘æ¡¿åªå‰©ä¸€åŠå¯ä»¥æ‹–ã€‚ */
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
        /* åž‚ç›´ä½ç½®äº¤çµ¦å¤–å±¤é‚£ä¸€åˆ—çš„ items-centerï¼šè‰²å¡Šæœƒè‡ªå·±å°é½Š
           ã€Œæ¨™é¡Œé‚£ä¸€è¡Œ ï¼‹ è»Œé“ã€æ•´å¡Šçš„åž‚ç›´ä¸­å¿ƒï¼Œä¸å¿…å¯«æ­»ä»»ä½•ä½ç§»ï¼Œ
           æ¨™é¡Œæ›è¡Œæˆ–æ»‘æ¡¿é«˜åº¦æ”¹äº†ä¹Ÿä¸æœƒè·‘æŽ‰ã€‚ */
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
  /** æœ‰çµ¦çš„è©±ï¼Œæé‚Šï¼ç™¼å…‰çš„é¡è‰²å°±æ”¹æˆã€Œé»žä¸€ä¸‹é–‹èª¿è‰²ç›¤ã€é‚£ç¨®ä¸€åˆ—ï¼ˆè·Ÿé€£ç·šé¡è‰²ä¸€æ¨£ï¼‰ */
  onPickColor?: (which: 'stroke' | 'glow') => void;
  /** é€™ä¸€å±¤æ˜¯ã€Œç¬¦è™Ÿã€ï¼šå¯ä»¥èª¿çš„æ±è¥¿æ¯”ä¸€èˆ¬æ–‡å­—å°‘ï¼Œåªç•™é¡è‰²ã€å¤§å°ã€ç™¼å…‰ */
  symbol?: boolean;
}> = ({ layer, onChange, onPickColor, symbol }) => {
  const [sub, setSub] = useState<'style' | 'font'>('style');
  /* é¡è‰²æ”¹æˆã€Œé»žé€²åŽ»æœ‰ä¸€é ã€ï¼šé€™è£¡å­˜çš„æ˜¯é‚£ä¸€é è¦èª¿å“ªå€‹é¡è‰²ã€‚ */
  const [colorPage, setColorPage] = useState<
    { value: string; colors?: string[]; onPick: (c: string) => void } | null
  >(null);
  const [cat, setCat] = useState<FontCategory>('zh');

  const list = FONTS.filter(f => f.category === cat);

  /* é€™å€‹å­—é«”æœ‰æ²’æœ‰çœŸæ­£çš„æ–œé«”ï¼Ÿæ²’æœ‰çš„è©±å°±ä¸çµ¦æ–œé«”éˆ•ï¼ˆç€è¦½å™¨æœƒè‡ªå·±æ­ªä¸€å€‹
     å‡æ–œé«”å‡ºä¾†ï¼Œé‚£å€‹ä¸å¥½çœ‹ä¹Ÿä¸æ˜¯é€™å€‹å­—é«”æœ¬ä¾†çš„æ¨£å­ï¼‰ã€‚ç­”æ¡ˆå•åˆ°ä¹‹å‰å…ˆç•¶æˆ
     æ²’æœ‰ï¼Œæ‰ä¸æœƒé–ƒä¸€ä¸‹åˆæ¶ˆå¤±ã€‚æ›å­—é«”æ™‚å¦‚æžœæ–°çš„å­—é«”æ²’æœ‰æ–œé«”ï¼Œé †æ‰‹æŠŠå·²ç¶“
     æ‰“é–‹çš„æ–œé«”é—œæŽ‰ï¼Œä¸ç„¶æœƒç•™ä¸‹ä¸€å€‹çœ‹ä¸åˆ°é–‹é—œçš„å‡æ–œé«”ã€‚ */
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

  /** å¯ä»¥é»žé–‹èª¿è‰²ç›¤çš„é‚£ä¸€åˆ—ï¼ˆæ¨£å¼è·Ÿå‰µæ„æ‹¼åœ–çš„ã€Œé€£ç·šé¡è‰²ã€é€é …ç›¸åŒï¼‰ */
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
      {/* ç¬¬ä¸€é¡†å›ºå®šæ˜¯è‡ªè¨‚é¡è‰² */}
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

  /* step å¯ä»¥æ˜¯å°æ•¸ï¼šçµ¦é‚Šç·£ç™¼å…‰é‚£ç¨®ã€Œæ ¼æ•¸è¦å¤šã€æ‹–èµ·ä¾†æ‰ä¸æœƒä¸€æ ¼ä¸€æ ¼è·³ã€çš„æ»‘æ¡¿ç”¨ã€‚
     å°æ•¸çš„æ™‚å€™è¦ç”¨ parseFloatï¼ˆparseInt æœƒæŠŠ 0.1 è®€æˆ 0ï¼‰ï¼Œé¡¯ç¤ºä¹Ÿè¦è·Ÿè‘—è£œåˆ°
     å°æ‡‰çš„å°æ•¸ä½ï¼Œä¸ç„¶ 2.5 æœƒé¡¯ç¤ºæˆ 2.5000000000000004ã€‚ */
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
      {/* å·¦å´ç´°é•·åˆ†é åˆ—ï¼Œè·Ÿã€Œæ–°å¢žä½ˆå±€ã€åŒä¸€ç¨®ç‰ˆåž‹ï¼šåªæœ‰åœ–ç¤ºã€
          æ²’æœ‰ä¸­é–“é‚£æ¢åˆ†éš”ç·šï¼Œé¸ä¸­ä¹Ÿä¸ç•«æŒ‡ç¤ºæ¢ã€‚
          ç¬¦è™Ÿæ²’æœ‰ã€Œæ›å­—é«”ã€é€™ä»¶äº‹ï¼ˆå­—é«”æ›äº†é‚£äº›ç¬¦è™Ÿä¹Ÿé‚„æ˜¯é ç³»çµ±å­—åž‹ç•«çš„ï¼‰ï¼Œ
          æ‰€ä»¥ç¬¦è™Ÿæ¨¡å¼æ•´æ¢åˆ†é åˆ—éƒ½ä¸å‡ºç¾ï¼Œåªç•™æ¨£å¼é‚£ä¸€é ã€‚ */}
      {!symbol && <div className="flex flex-col shrink-0 w-11 -mt-4 -mb-4 -ml-4 border-r border-white/10 select-none">
        {/* è·Ÿã€Œæ–°å¢žä½ˆå±€ã€å®Œå…¨åŒæ¬¾ï¼šä¸Šé¢æŒ‘å…§å®¹ï¼ˆå­—é«”ï¼‰ã€ä¸‹é¢èª¿åƒæ•¸ï¼ˆæ¨£å¼ï¼‰ï¼Œ
            åœ–æ¨™åŒä¸€çµ„ã€ä¸­é–“åŒä¸€æ¢åˆ†éš”ç·š */}
        <button
          onClick={() => setSub('font')}
          title="å­—é«”"
          aria-label="å­—é«”"
          className={`w-full flex-1 flex items-center justify-center transition-all ${sub === 'font' ? 'text-white' : 'text-[#5a5a5a]'}`}
        >
          <Type size={18} className={`transition-transform ${sub === 'font' ? 'scale-110' : ''}`} />
        </button>
        <div className="w-full h-[1px] bg-white/10 shrink-0" />
        <button
          onClick={() => setSub('style')}
          title="æ¨£å¼"
          aria-label="æ¨£å¼"
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
          /* åº•éƒ¨ç•™ä¸€æ®µï¼šæ²åˆ°åº•æ™‚æœ€å¾Œä¸€æ ¹æ»‘æ¡¿ä¸è¦è²¼è‘—é‚Šï¼ˆåŽŸæœ¬ pb-24ï¼Œæ¸›åŠï¼‰ */
          <div className="space-y-3.5 pt-1 pb-12">
            {/* æ–‡å­—å…§å®¹ä¸€å¾‹ç›´æŽ¥åœ¨ç•«å¸ƒä¸Šæ‰“ï¼ˆé¸ä¸­ä¹‹å¾Œå†é»žä¸€æ¬¡é‚£æ®µå­—ï¼‰ï¼Œ
                æ‰€ä»¥é€™è£¡ä¸æ”¾è¼¸å…¥æ¡†ã€‚ç¬¦è™Ÿä¹Ÿæ˜¯ä¸€æ¨£çš„æ”¹æ³•ã€‚ */}
            {/* æœ€ä¸Šé¢å°±æ˜¯é€™å€‹ç‰©ä»¶è‡ªå·±çš„é¡è‰²ï¼Œè‰²ç¥¨ç›´æŽ¥æ”¤é–‹ â€”â€”
                ä¸Šé¢ä¸å†æ”¾ã€Œé¡è‰²ã€é‚£è¡Œæ¨™é¡Œï¼ˆå®ƒå°±åœ¨æœ€é ‚ç«¯ï¼Œä¸ç”¨å†æ¨™ä¸€æ¬¡ï¼‰ã€‚ */}
            {swatchRow(layer.color, c => onChange({ color: c }))}

            {symbol ? (
              /* ç¬¦è™Ÿåˆ°é€™è£¡å°±çµæŸäº†ï¼šç²—é«”ï¼æ–œé«”ï¼å­—è·ï¼æé‚Šå°ç¬¦è™Ÿæ²’æœ‰æ„ç¾©
                 ï¼ˆé‚£äº›æ˜¯é ç³»çµ±å­—åž‹ç•«å‡ºä¾†çš„ï¼ŒåŠ ç²—ã€åŠ æ–œã€æ‹†å­—è·éƒ½åªæœƒæ­ªæŽ‰ï¼‰ï¼Œ
                 æ‰€ä»¥åªç•™ä¸€æ ¹ç™¼å…‰è·Ÿç™¼å…‰é¡è‰²ã€‚ */
              <>
                {/* æ»‘æ¡¿èˆ‡é¡è‰²ä¸¦æŽ’ï¼›é¡è‰²æ˜¯å…©æ®µå¼çš„ï¼ˆé»žä¸€ä¸‹æ‰æ”¤é–‹è‰²ç¥¨ï¼‰ï¼Œ
                    æ‰€ä»¥ä¸æœƒæœ‰ã€Œæ‹‰åˆ° 1 çš„çž¬é–“æ¬„ä½å†’å‡ºä¾†é–ƒä¸€ä¸‹ã€ã€‚ */}
                <div className="flex items-center gap-3 px-2">
                  <div className="flex-1 min-w-0">
                    {slider('ç™¼å…‰', Math.round(Math.min(100, ((layer.glow || 0) / 12) * 100)), 0, 100,
                      v => onChange({ glow: (v / 100) * 12 }), '', 1)}
                  </div>
                  <ColorPick compact label="é¡è‰²" value={layer.glowColor || '#FFFFFF'} colors={GLOW_COLORS}
                    onPick={c => onChange({ glowColor: c })}
                    onOpen={() => onPickColor ? onPickColor('glow') : setColorPage({
                      value: layer.glowColor || '#FFFFFF', colors: GLOW_COLORS,
                      onPick: c => onChange({ glowColor: c }),
                    })} />
                </div>
              </>
            ) : (
            <>
            {/* ç²—é«”èˆ‡æ–œé«”åŒä¸€æŽ’ã€‚é€™å€‹å­—é«”æ²’æœ‰çœŸæ–œé«”æ™‚åªç•™ç²—é«”ï¼Œ
                ç²—é«”å°±è‡ªå·±æ’æ»¿æ•´æŽ’ â€”â€” è·Ÿæ²’æœ‰æ–œé«”éˆ•ä¹‹å‰é•·å¾—ä¸€æ¨£ã€‚
                ä½†**ç¾åœ¨é€™æ®µå­—å·²ç¶“æ˜¯æ–œé«”**çš„è©±ä¸€å®šè¦æŠŠéˆ•ç•™è‘—ï¼Œ
                ä¸ç„¶æ›åˆ°æ²’æœ‰çœŸæ–œé«”çš„å­—é«”æ™‚ï¼Œé‚£å€‹æ–œé«”å°±è®Šæˆé—œä¸æŽ‰çš„äº†ã€‚ */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onChange({ bold: !layer.bold })}
                className={`flex-1 h-9 rounded-xl border flex items-center justify-center gap-2 text-[12px] font-bold tracking-widest transition-all ${
                  layer.bold ? 'bg-white text-black border-white' : 'bg-white/[0.04] text-white/70 border-white/15'
                }`}
              >
                <Bold size={14} />ç²—é«”
              </button>
              {(hasItalic || layer.italic) && (
                <button
                  onClick={() => onChange({ italic: !layer.italic })}
                  className={`flex-1 h-9 rounded-xl border flex items-center justify-center gap-2 text-[12px] font-bold tracking-widest transition-all ${
                    layer.italic ? 'bg-white text-black border-white' : 'bg-white/[0.04] text-white/70 border-white/15'
                  }`}
                >
                  <Italic size={14} />æ–œé«”
                </button>
              )}
            </div>
            {/* å­—ç´šèˆ‡å­—è·åŒä¸€æŽ’ï¼ˆç²—é«”ï¼æ–œé«”æŽ’åœ¨å®ƒå€‘ä¸Šé¢ï¼‰ã€‚
                ç¬¦è™Ÿæ²’æœ‰é€™å…©æ ¹ â€”â€” å®ƒçš„å¤§å°ç›´æŽ¥åœ¨ç•«å¸ƒä¸Šæã€‚ */}
            {/* å­—ç´šçš„æ»‘æ¡¿æ‹¿æŽ‰äº†ï¼šå¤§å°ç›´æŽ¥åœ¨ç•«å¸ƒä¸Šæï¼Œé€™è£¡åªç•™å­—è· */}
            <div className="grid grid-cols-1 gap-3">
              {slider('å­—è·', layer.letterSpacing || 0, -10, 40, v => onChange({ letterSpacing: v }), 'px')}
            </div>
            {/* æé‚Šã€ç™¼å…‰å„è‡ªè·Ÿè‡ªå·±çš„é¡è‰²ä¸¦æŽ’ï¼ˆé¡è‰²æ˜¯å…©æ®µå¼çš„ï¼Œé»žä¸€ä¸‹æ‰æ”¤é–‹è‰²ç¥¨ï¼‰ã€‚
                æé‚Š 0ï½ž2pxï¼Œä¸€æ¨£åˆ† 50 æ ¼ï¼ˆæ¯æ ¼ 0.04pxï¼‰ï¼šæœ€å°é‚£ä¸€æ ¼åªæœ‰ 0.04pxï¼Œ
                å¾ž 0 æ‹‰å‡ºä¾†æ™‚æ˜¯æ…¢æ…¢æµ®ç¾ï¼Œä¸æœƒä¸€ä¸‹å°±è·³å‡ºä¸€åœˆæ˜Žé¡¯çš„é‚Šã€‚
                é¡è‰²æ¬„ä¸€ç›´éƒ½åœ¨ï¼Œæ‰€ä»¥ä¸æœƒæœ‰ã€Œå¾ž 0 æ‹‰åˆ° 1 çš„çž¬é–“æ¬„ä½å†’å‡ºä¾†é–ƒä¸€ä¸‹ã€ã€‚ */}
            <div className="flex items-center gap-3 px-2">
              <div className="flex-1 min-w-0">
                {slider('æé‚Š', layer.strokeWidth || 0, 0, 2, v => onChange({ strokeWidth: v }), 'px', 0.04)}
              </div>
              <ColorPick compact label="é¡è‰²" value={layer.strokeColor || '#000000'}
                onPick={c => onChange({ strokeColor: c })}
                onOpen={() => onPickColor ? onPickColor('stroke') : setColorPage({
                  value: layer.strokeColor || '#000000',
                  onPick: c => onChange({ strokeColor: c }),
                })} />
            </div>
            <div className="flex items-center gap-3 px-2">
              <div className="flex-1 min-w-0">
                {slider('ç™¼å…‰', Math.round(Math.min(100, ((layer.glow || 0) / 12) * 100)), 0, 100,
                      v => onChange({ glow: (v / 100) * 12 }), '', 1)}
              </div>
              <ColorPick compact label="é¡è‰²" value={layer.glowColor || '#FFFFFF'} colors={GLOW_COLORS}
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
 * åœ–å½¢åœ–å±¤çš„åƒæ•¸é¢æ¿ï¼ˆé¡è‰²ï¼ç²—ç´°ï¼è™›ç·šï¼‰ã€‚
 *
 * é¡è‰²ç”¨çš„æ˜¯ swatchStrip ï¼‹ SOFT_COLORS â€”â€” è·Ÿã€Œæ–‡å­—é¡è‰²ã€ã€Œæé‚Šé¡è‰²ã€
 * åŒä¸€å€‹å…ƒä»¶ã€åŒä¸€çµ„è‰²ï¼Œä¸æ˜¯å¦å¤–è¨­è¨ˆä¸€å¥—ã€‚
 * å¯¦å¿ƒçš„åœ–å½¢æ²’æœ‰æ¡†ï¼Œæ‰€ä»¥ç²—ç´°èˆ‡è™›ç·šåªåœ¨ç´°æ¡†ï¼ç·šæ¢çš„æ™‚å€™æ‰å‡ºç¾ã€‚
 */
export const ShapeEditorPanel: React.FC<{
  layer: FloatingImage;
  onChange: (patch: Partial<FloatingImage>) => void;
}> = ({ layer, onChange }) => {
  const isLine = SPECIAL_LINE_KINDS.has(layer.shape || '');
  const isGridShape = GRID_SHAPE_KINDS.has(layer.shape || '');
  const hasOutline = (!layer.shapeFilled || isLine) && !isGridShape;
  const canFeather = shapeSupportsFeather(layer.shape, layer.shapeFilled, layer.holeType);
  /* é¡è‰²æ”¹æˆã€Œé»žé€²åŽ»æœ‰ä¸€é ã€ï¼ˆè·Ÿæ–‡å­—é‚£ä¸€é åŒä¸€é¡†å…ƒä»¶ï¼‰ */
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
        /* åº•éƒ¨ç•™ä¸€æ®µï¼šæ²åˆ°æœ€åº•æ™‚æœ€å¾Œä¸€æ ¹æ»‘æ¡¿ä¸æœƒè²¼è‘—é‚Š */
        <div className="flex flex-col gap-3.5 pt-1 pb-14">
          {/* æœ€ä¸Šé¢å°±æ˜¯åœ–å½¢è‡ªå·±çš„é¡è‰²ï¼Œè‰²ç¥¨ç›´æŽ¥æ”¤é–‹ï¼ˆä¸å†æ”¾ã€Œé¡è‰²ã€æ¨™é¡Œï¼‰ã€‚
              æ›åœ–å½¢é¡è‰²æ™‚ç™¼å…‰ä¹Ÿä¸€èµ·æ›æˆåŒä¸€å€‹è‰² â€”â€” ç™¼å…‰æœ¬ä¾†å°±æ˜¯åœ–å½¢è‡ªå·±çš„å…‰æšˆã€‚
              åéŽä¾†ä¸æˆç«‹ï¼šå–®ç¨æŒ‘ç™¼å…‰çš„é¡è‰²æ™‚ï¼Œåœ–å½¢çš„é¡è‰²ä¸æœƒè¢«å‹•åˆ°ã€‚ */}
          {swatchStrip(layer.color, SOFT_COLORS, c => onChange({ color: c, shapeGlowColor: c }), true)}
          {isLine && (
            <div className="px-2">
              {slider('ç²—ç´°', Math.round((layer.shapeLineW ?? 6) * 10), 1, 100,
                v => onChange({ shapeLineW: v / 10 }))}
            </div>
          )}
          {/* ç™¼å…‰ã€æé‚Šå„è‡ªè·Ÿè‡ªå·±çš„é¡è‰²ä¸¦æŽ’ï¼›é¡è‰²æ˜¯å…©æ®µå¼çš„ï¼ˆé»žä¸€ä¸‹æ‰æ”¤é–‹è‰²ç¥¨ï¼‰ */}
          <div className="flex items-center gap-3 px-2 order-1 w-full">
            <div className="flex-1 min-w-0">
              {slider('ç™¼å…‰', Math.round(glowAmount(layer.shapeGlow as any) * 100), 0, 100,
                v => onChange({ shapeGlow: v } as any))}
            </div>
            <ColorPick compact label="é¡è‰²" value={layer.shapeGlowColor || layer.color || SHAPE_DEFAULT_COLOR}
              colors={GLOW_COLORS} onPick={c => onChange({ shapeGlowColor: c })}
              onOpen={() => setColorPage({
                value: layer.shapeGlowColor || layer.color || SHAPE_DEFAULT_COLOR, colors: GLOW_COLORS,
                onPick: c => onChange({ shapeGlowColor: c }),
              })} />
          </div>
          <div className="flex items-center gap-3 px-2 order-2 w-full">
            <div className="flex-1 min-w-0">
              {slider('æé‚Š', Math.round(Math.min(4, layer.shapeStrokeW ?? 0) * 25), 0, 100,
                v => onChange({ shapeStrokeW: v / 25 }))}
            </div>
            <ColorPick compact label="é¡è‰²" value={layer.shapeStrokeColor || '#000000'}
              onPick={c => onChange({ shapeStrokeColor: c })}
              onOpen={() => setColorPage({
                value: layer.shapeStrokeColor || '#000000',
                onPick: c => onChange({ shapeStrokeColor: c }),
              })} />
          </div>
          {/* ç´‹ç†æ•´çµ„æ”¶åœ¨åŒä¸€æ ¼ï¼šç¨®é¡žã€é¡è‰²ã€æ»‘æ¡¿å…¨éƒ¨åœ¨åŒä¸€å€‹æ¡†è£¡
              ï¼ˆè·Ÿã€ŒèƒŒæ™¯ç´‹ç†ã€é‚£ä¸€æ ¼åŒä¸€ç¨®æŽ’æ³•ï¼‰ã€‚é¡è‰²å¸¸é§ï¼Œé—œè‘—ä¹Ÿèƒ½å…ˆæŒ‘å¥½ã€‚
              é»žé»žæ˜¯ä¸€å€‹é¡è‰²ï¼‹å¤§å°ï¼é–“è·ï¼›æ¢ç´‹æ˜¯å…©å€‹é¡è‰²ï¼‹ç²—ç´°ï¼æ–¹å‘ã€‚ */}
          {!isLine && (() => {
            const tex = texOf({ tex: layer.shapeTex, dots: layer.shapeDots });
            return (
          <div className="bg-[#111] border border-[#222] rounded-[6px] overflow-hidden order-3 w-full">
            <div className="h-[47px] flex items-center justify-between px-3">
              <span className="text-[10px] font-bold text-[#888]">ç´‹ç†</span>
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
                {/* æ¢ç´‹æœ‰å…©å€‹é¡è‰²ï¼Œæ‰€ä»¥æ”¾å…©å¡Šè‰²ç¥¨ï¼›é»žé»žåªæœ‰ä¸€å¡Š */}
                {tex === 'stripe' ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setColorPage({
                        value: layer.shapeStripeA || layer.color || SHAPE_DEFAULT_COLOR, colors: TEX_SWATCHES,
                        onPick: c => onChange({ shapeStripeA: c }),
                      })}
                      title="æ¢ç´‹é¡è‰²ä¸€"
                      className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                      style={{ backgroundColor: layer.shapeStripeA || layer.color || SHAPE_DEFAULT_COLOR }}
                    />
                    <button
                      onClick={() => setColorPage({
                        value: layer.shapeStripeB || '#FFFFFF', colors: TEX_SWATCHES,
                        onPick: c => onChange({ shapeStripeB: c }),
                      })}
                      title="æ¢ç´‹é¡è‰²äºŒ"
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
                    title="ç´‹ç†é¡è‰²"
                    className="w-8 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                    style={{ backgroundColor: layer.shapeDotColor || '#FFFFFF' }}
                  />
                )}
              </div>
            </div>
            {tex === 'stripe' ? (
              /* æ¢ç´‹æ²’æœ‰é–“è·å¯ä»¥èª¿ï¼ˆä¸€æ¢æŽ¥è‘—ä¸€æ¢ï¼‰ï¼Œåªæœ‰æ¢æ•¸ã€‚
                 å³é‚Šé‚£ä¸€æ ¼æ”¾ç›´å¼ï¼æ©«å¼ï¼Œè·Ÿæ»‘æ¡¿ä¸¦æŽ’ã€‚
                 å·¦å³å„ç•™ 8pxï¼šæ»‘æ¡¿æœ¬äººæ¯”å¤–æ¡†å¯¬ 14pxï¼ˆè¦‹ styles.css çš„ .slider-wrapï¼‰ï¼Œ
                 ä¸ç•™çš„è©±ç•«å‡ºä¾†çš„ç·šæœƒæ¯”è‡ªå·±é‚£ä¸€æ¬„é•·ã€ä¼¸é€²éš”å£çš„é–“éš™ã€‚ */
              <div className="grid grid-cols-2 gap-x-7 gap-y-4 px-3 pt-2 pb-3 border-t border-[#1c1c1c] items-end">
                <div className="px-2">
                  {slider('æ•¸é‡', layer.shapeStripeN ?? STRIPE_N_DEFAULT, 0, STRIPE_N_MAX, v => onChange({ shapeStripeN: v }))}
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-white/70">æ–¹å‘</span>
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
                {slider('å¤§å°', layer.shapeDotSize ?? 50, 0, 100, v => onChange({ shapeDotSize: v }))}
                {slider('é–“è·', layer.shapeDotGap ?? 20, 0, 100, v => onChange({ shapeDotGap: v }))}
              </div>
            )}
          </div>
            );
          })()}
          <div className="px-2 order-4 w-full">
            {slider('é€æ˜Žåº¦', layer.opacity ?? 100, 0, 100, v => onChange({ opacity: v }))}
          </div>
          {canFeather && (
            <div className="px-2 order-5 w-full">
              {slider('ç¾½åŒ–', layer.shapeFeather || 0, 0, 100, v => onChange({ shapeFeather: v }))}
            </div>
          )}
          {/* ç²—ç´°èˆ‡è™›ç·šåªæœ‰ç´°æ¡†ï¼ç·šæ¢æ‰æœ‰ï¼Œæ”¾åœ¨æœ€å¾Œé¢ */}
          {hasOutline && (!isLine || layer.shape === 'line') && (
            <div className="order-6 flex flex-col gap-3.5">
              {!isLine && slider('ç²—ç´°', Math.round((layer.shapeLineW ?? 6) * 10), 1, 100,
                v => onChange({ shapeLineW: v / 10 }))}
              {slider('è™›ç·š', layer.shapeDash || 0, 0, 100, v => onChange({ shapeDash: v }))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

/**
 * åœ–ç‰‡èª¿æ•´é¢æ¿ã€‚
 *
 * é€™ä¸€æ®µåŽŸæœ¬å¯«æ­»åœ¨ GridLayoutTool è£¡é¢ï¼Œå‰µæ„æ‹¼åœ–è¦ç”¨åŒä¸€å¥—ä»‹é¢å°±åªèƒ½è¤‡è£½ä¸€ä»½ï¼Œ
 * å…©é‚Šé²æ—©æœƒèµ°é˜ã€‚æ‰€ä»¥æ•´æ®µåŽŸå°ä¸å‹•æ¬å‡ºä¾†è®Šæˆå…±ç”¨å…ƒä»¶ â€”â€”
 * **è£¡é¢ä¸€è¡Œé‚è¼¯éƒ½æ²’æœ‰æ”¹**ï¼Œç¶“å…¸æ‹¼åœ–åªæ˜¯æ”¹æˆæŠŠåŽŸæœ¬çš„å€åŸŸè®Šæ•¸ç•¶ props å‚³é€²ä¾†ã€‚
 *
 * ç‚ºä»€éº¼ props é€™éº¼å¤šï¼šé‚£äº› UI ç‹€æ…‹ï¼ˆç¾åœ¨åœåœ¨å“ªå€‹å­åˆ†é ã€é¸äº†å“ªå¼µç‰¹æ•ˆå¡â€¦ï¼‰
 * æœ¬ä¾†å°±ä½åœ¨å„è‡ªçš„å·¥å…·è£¡ï¼Œç•™åœ¨å¤–é¢æ‰ä¸æœƒå½±éŸ¿ç¶“å…¸æ‹¼åœ–ç¾æœ‰çš„è¡Œç‚ºã€‚
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
  /** æ§‹åœ–ä»‹é¢æ­£é–‹è‘—ï¼ˆåœ–æ¨™è¦äº®èµ·ä¾†ï¼‰ */
  composeOpen?: boolean;
  /** åœ¨æ§‹åœ–ä»‹é¢æ™‚åˆ‡åˆ°åˆ¥çš„åˆ†é¡žï¼šå…ˆæŠŠç•¶ä¸‹çš„æ§‹åœ–å¥—ç”¨æŽ‰å†åˆ‡ */
  onLeaveCompose?: () => void;
  /* é–‹è‘—çš„æ™‚å€™ï¼šåˆ‡åˆ°ã€Œèª¿ç¯€ã€ã€Œå½¢ç‹€ã€ä¸é å…ˆé¸å¥½ç¬¬ä¸€å€‹å·¥å…· â€”â€” æ»‘æ¡¿è¦ç­‰
     çœŸçš„é»žä¸‹æŸé¡†å·¥å…·éˆ•æ‰å‡ºç¾ï¼Œè€Œä¸”æ˜¯å¸¶å‹•ç•«å‡ºç¾çš„ã€‚ç¶“å…¸æ‹¼åœ–ä¸å‚³é€™å€‹ï¼Œ
     ç¶­æŒåŽŸæœ¬ã€Œä¸€åˆ‡éŽåŽ»æ»‘æ¡¿å°±åœ¨é‚£ã€çš„æ‰‹æ„Ÿã€‚ */
  deferSlider?: boolean;
  /** å›žå ±ã€Œé€™ä¸€æ ¼æœ‰æ²’æœ‰æ»‘æ¡¿åœ¨ä¸Šé¢é‚£ä¸€æ®µã€â€”â€”å‰µæ„æ‹¼åœ–ç”¨å®ƒæ±ºå®šå·¥å…·æ¬„è¦ä¸è¦é•·é«˜ */
  onSliderOpenChange?: (open: boolean) => void;
  /** ä½ˆå±€è£¡çš„æ ¼å­æ²’æœ‰ã€Œå½¢ç‹€ã€é‚£ä¸€çµ„ï¼Œå‚³ true å°±æŠŠå®ƒè—èµ·ä¾† */
  hideShape?: boolean;
  /** å½±ç‰‡ç‰©ä»¶æ²’æœ‰ã€Œæ§‹åœ–ã€â€”â€”æ§‹åœ–æ˜¯æŠŠè£åˆ‡çš„çµæžœçƒ¤æˆä¸€å¼µåœ–ï¼Œçƒ¤å®Œå°±ä¸æ˜¯å½±ç‰‡äº† */
  hideCompose?: boolean;
  /** æ»‘æ¡¿æŽ’æˆä¸€æŽ’ï¼šåç¨±ã€è»Œé“ã€æ•¸å€¼å…¨éƒ¨åŒä¸€åˆ—ï¼Œä¸Šé¢ä¸å†æœ‰ä¸€æŽ’å­— */
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
/* å¡ç‰‡ç‰†çš„ç¸®åœ–ä¾†æºã€‚
   å½±ç‰‡ä¸èƒ½ç›´æŽ¥ç”¨ img.src â€”â€” å¡ç‰‡æ˜¯æŠŠç¶²å€å¡žé€² <img> é‡ç•«çš„ï¼Œ
   è€Œ <img src="blob:â€¦mp4"> æ°¸é è¼‰ä¸å‡ºä¾†ï¼Œæ•´é¢å¡ç‰‡æœƒæ˜¯ç©ºçš„ã€‚
   åŒ¯å…¥æ™‚å·²ç¶“çƒ¤äº†ä¸€å¼µç¬¬ä¸€æ ¼ï¼ˆposterï¼‰ï¼Œæ‹¿å®ƒç•¶ä¾†æºï¼Œå¡ç‰‡å°±è·Ÿåœ–ç‰‡é•·å¾—ä¸€æ¨£ã€‚
   ï¼ˆå‰µæ„æ‹¼åœ–æ˜¯åœ¨å¤–é¢å°±æŠŠ src æ›æˆ poster äº†ï¼Œæ‰€ä»¥é‚£é‚Šç…§æ¨£èµ° img.srcã€‚ï¼‰ */
const cardSrc = (img.isVideo && img.poster) ? img.poster : img.src;

/* â”€â”€ å…©æ®µå¼çš„é‚£å¹¾é¡†ï¼ˆå½¢ç‹€ï¼æé‚Šï¼ç™¼å…‰ï¼‰æŒ‰ä¸‹åŽ»è¦ç«‹åˆ»æœ‰åæ‡‰ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * åŒä¸€æŽ’è£¡ï¼Œåœ“è§’èˆ‡ç¾½åŒ–é»žä¸‹åŽ»æœƒè®Šç™½ â€”â€” å› ç‚ºå®ƒå€‘åªæ˜¯æŠŠä¸‹é¢çš„æ»‘æ¡¿æ›æŽ‰ï¼Œ
 * æŒ‰éˆ•æœ¬äººé‚„ç•™åœ¨åŽŸä½ã€‚å½¢ç‹€ï¼æé‚Šï¼ç™¼å…‰æ˜¯ã€Œå…©æ®µå¼ã€çš„ï¼šé»žä¸‹åŽ»æ•´æŽ’æœƒè¢«
 * å­é¸å–®æ›æŽ‰ï¼Œé‚£é¡†æŒ‰éˆ•æ ¹æœ¬ä¾†ä¸åŠè¢«ç•«æˆé¸ä¸­çš„æ¨£å­ã€‚
 *
 * æœ¬ä¾†çš„åšæ³•æ˜¯ã€Œå…ˆäº® 150ms å†æ›é ã€ï¼Œä½†é‚£ 150ms åœ¨æ‰‹ä¸Šå°±æ˜¯ã€ŒæŒ‰äº†æ²’é¦¬ä¸Šé€²åŽ»ã€ã€‚
 * æ”¹æˆæ›é å®Œå…¨ä¸å»¶é²ï¼Œå›žé¥‹äº¤çµ¦ CSS çš„ :active â€”â€” æ‰‹æŒ‡ä¸€ç¢°æŒ‰éˆ•å°±è®Šç™½
 * ï¼ˆæ¯” click é‚„æ—©ï¼Œå› ç‚º :active åœ¨æŒ‰ä¸‹çš„ç•¶ä¸‹å°±å¥—ç”¨ï¼‰ï¼Œæ”¾é–‹æ™‚é é¢å·²ç¶“æ›å¥½äº†ã€‚
 * å…©ä»¶äº‹åŒæ™‚æˆç«‹ï¼šç«‹åˆ»é€²åˆ†é ï¼Œè€Œä¸”æŒ‰ä¸‹åŽ»çœ‹å¾—åˆ°å®ƒäº®ã€‚ */

/* é»žç‰¹æ•ˆå¡ç‰‡ï¼åªç•™é€™ä¸€é¡†ï¼ˆå…¶ä»–æ•´çµ„æ­¸é›¶ï¼‰ï¼›
   é•·æŒ‰ï¼ç–Šåœ¨ç¾åœ¨é€™äº›ä¸Šé¢ï¼Œå¥½å¹¾å€‹åŒæ™‚ç”Ÿæ•ˆï¼ˆå†é•·æŒ‰ä¸€æ¬¡å°±é—œæŽ‰é‚£ä¸€é¡†ï¼‰ã€‚ */
const pickEffect = (id: string) => {
  if (FX_DETAIL[id]) warmFx(id);      // å…ˆæŠŠè‘—è‰²å™¨ç·¨å¥½ï¼Œç¬¬ä¸€æ¬¡æ‹–æ‰ä¸æœƒå¡
  setEffectCard(id);
  setEffectDetail(false);
  const amountId = fxAmountId(id);
  const on = fxVal(amountId, 0) !== 0;
  /* æ‰“é–‹ä¸€é¡†ç‰¹æ•ˆï¼å¾žé ­ä¾†éŽï¼šæ‰€æœ‰ç‰¹æ•ˆçš„åƒæ•¸**é€£ç´°é …ä¸€èµ·**æ‰“å›žé è¨­ï¼Œ
     å†æŠŠé€™ä¸€é¡†çš„å¼·åº¦è¨­æˆé è¨­å€¼ â€”â€” è·Ÿç·¨è¼¯é ä¸€æ¨¡ä¸€æ¨£
     ï¼ˆè¦‹ ImageEditor çš„ handleEffectToolSelectï¼‰ã€‚
     å·²ç¶“äº®è‘—çš„é‚£ä¸€é¡†å†é»žä¸€æ¬¡åªæ˜¯è¦é–‹ç´°é …é¢æ¿ï¼Œå®ƒè‡ªå·±é‚£å¹¾æ ¹ç¶­æŒç¾æ³ã€‚ */
  const patch: any = { ...FX_PARAM_DEFAULTS };
  if (on) for (const k of (FX_CARD_KEYS[id] || [amountId])) delete patch[k];
  else patch[amountId] = FX_ON_AMOUNT[id] ?? 100;
  setFx(patch);
};

/* é•·æŒ‰ 450msï¼ç–ŠåŠ ï¼Œä¸¦æŠŠæŽ¥è‘—é‚£ä¸€æ¬¡ click åƒæŽ‰ */

/* ä½ˆå±€è£¡çš„æ ¼å­æ²’æœ‰ã€Œå½¢ç‹€ã€â€”â€”ç¾½åŒ–ï¼ç™¼å…‰ï¼æé‚Šéƒ½æœƒé•·åˆ°æ ¼å­å¤–é¢ï¼Œ
   è€Œæ ¼å­æ˜¯è¢«è£åˆ‡çš„ï¼Œç•«å‡ºä¾†æœƒè¢«åˆ‡æŽ‰ï¼›åœ“è§’å‰‡å·²ç¶“æœ‰ä½ˆå±€é‚£æ ¹å…±ç”¨æ»‘æ¡¿ã€‚ */
const CATS = ([
  ['filter', 'palette', 'æ¿¾é¡'],
  ['tune', 'tune', 'èª¿ç¯€'],
  ['effect', 'magic_button', 'ç‰¹æ•ˆ'],
  ['shape', 'shapes', 'é€ åž‹'],
  // æ§‹åœ–åœ–æ¨™è·Ÿã€Œç·¨è¼¯ã€é‚£é‚Šç”¨åŒä¸€é¡†ï¼ˆcropï¼‰
  ['compose', 'crop', 'æ§‹åœ–'],
] as const).filter(c => !(hideShape && c[0] === 'shape') && !(hideCompose && c[0] === 'compose'));

// ç·¨è¼¯åŒæ¬¾çš„åœ“å½¢å·¥å…·éˆ•
/* icon å‚³å­—ä¸²ï¼ç”¨åœ–ç¤ºå­—åž‹é‚£ä¸€é¡†ï¼›å‚³ä¸€å€‹å…ƒç´ ï¼ç›´æŽ¥ç•«é‚£å€‹å…ƒç´ ã€‚
   å½¢ç‹€é‚£å¹¾é¡†èµ°å¾Œè€…ï¼šåœ–ç¤ºå­—åž‹æ˜¯**å­é›†åŒ–éŽçš„**ï¼ˆåªåŒ…å«å°ˆæ¡ˆå·²ç¶“ç”¨åˆ°çš„é‚£äº›ï¼‰ï¼Œ
   éš¨æ‰‹åŠ ä¸€å€‹æ–°åå­—å®ƒä¸¦ä¸åœ¨å­—åž‹è£¡ï¼Œç•«é¢ä¸Šå°±æœƒç›´æŽ¥é¡¯ç¤ºæˆé‚£ä¸²è‹±æ–‡å­—ã€‚
   å½¢ç‹€æœ¬ä¾†å°±æœ‰ç¾æˆçš„å‘é‡è·¯å¾‘ï¼Œç•«å‡ºä¾†é‚„æ¯”åœ–ç¤ºæ›´æ¸…æ¥šã€‚ */
const toolBtn = (id: string, label: string, icon: string | React.ReactNode, active: boolean, adjusted: boolean, onClick: () => void) => (
  <button key={id} onClick={onClick} className="flex flex-col items-center gap-1 shrink-0 group w-16">
    {/* æŒ‰ä¸‹åŽ»çš„å›žé¥‹ï¼šåªæ˜¯ç¨å¾®æ”¾å¤§ä¸€é»žé»žï¼Œåˆ¥çš„éƒ½ä¸å‹•ã€‚
        ä»¥å‰æ˜¯ã€Œæ”¾å¤§åˆ°è·Ÿé¸ä¸­ä¸€æ¨£å¤§ï¼ˆ1.10ï¼‰ï¼‹ 150ms çš„ transition-allã€â€”â€”
        é‚£ä¸€åœˆæ˜¯ 40pxï¼Œ1.10 ç­‰æ–¼ä¸Šä¸‹å„é•· 2pxï¼Œè€Œä¸”æ˜¯æ…¢æ…¢è„¹ä¸ŠåŽ»çš„ï¼›
        ä¸‹é¢åˆç·ŠæŽ¥è‘—æ–‡å­—ï¼Œå¾€ä¸‹é•·çš„é‚£ 2px è¢«æ–‡å­—æ“‹è‘—ã€å¾€ä¸Šé‚£ 2px æ˜¯ç©ºçš„ï¼Œ
        çœ‹èµ·ä¾†å°±è®Šæˆã€Œåœ–æ¨™å¾€ä¸Šè·‘äº†ä¸€ä¸‹ã€ã€‚
        ç¾åœ¨åªé•· 1.05ï¼ˆä¸Šä¸‹å„ 1pxï¼‰ã€è€Œä¸” 90ms å°±åˆ°ä½ï¼Œ
        æ˜¯ã€ŒæŒ‰åˆ°äº†ã€çš„ä¸€ä¸‹ï¼Œä¸æ˜¯ä¸€æ®µæœƒè¢«çœ¼ç›è¿½è‘—çœ‹çš„ä½ç§»ã€‚
        åº•è‰²èˆ‡é¡è‰²ç¶­æŒåŽŸæœ¬çš„ 150msï¼Œè·Ÿå¤§å°åˆ†é–‹è·‘ï¼Œæ‰ä¸æœƒåˆæ··åœ¨ä¸€èµ·ã€‚ */}
    <div
      style={{
        transitionProperty: 'transform, background-color, color',
        transitionDuration: '90ms, 150ms, 150ms',
        transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
      }}
      className={`w-10 h-10 rounded-full flex items-center justify-center ${active ? 'bg-white text-black scale-110' : 'bg-white/5 text-white group-hover:bg-white/10 group-active:scale-105'}`}
    >
      {/* æœªé¸ä¸­æ™‚è®“æ•´é¡†åœ–æ¨™ä¸€æ¬¡åˆæˆå¾Œå†é™ä½Žé€æ˜Žåº¦ï¼›è‹¥ SVG å…§æœ‰ç·šæ¢äº¤æœƒï¼Œ
          ä¸æœƒå› æ¯æ®µåŠé€æ˜Žæé‚Šé‡è¤‡æ··è‰²è€Œåœ¨äº¤ç•Œè™•è®Šç™½ã€‚ */}
      <span className={`flex items-center justify-center transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'}`}>
        {typeof icon === 'string' ? <Icon name={icon} className="text-lg" fill={active} /> : icon}
      </span>
    </div>
    <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${active ? 'text-white' : 'text-white/20'}`}>{label}</span>
    <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${adjusted ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
  </button>
);

// ç·¨è¼¯åŒæ¬¾çš„æ»‘æ¡¿ï¼ˆlabel åœ¨å·¦ã€æ•¸å­—åœ¨å³ã€track ä¸€æ¨£æ˜¯ custom-rangeï¼‰
// ä¸Šé¢é‚£ä¸€è¡Œï¼ˆåç¨±ï¼‹æ•¸å€¼ï¼‰å¾€ä¸‹æŒªä¸€é»žï¼Œä¸è¦è²¼è‘—ä¸Šé¢çš„ç´°ç·šã€‚
// hideChromeï¼šæ‹–é€™æ ¹æ»‘æ¡¿çš„æœŸé–“æŠŠåœ–ç‰‡çš„é¸å–æ¡†æ•´çµ„æ”¶èµ·ä¾†ï¼ˆå½¢ç‹€åˆ†é ç”¨ï¼‰
const editorSlider = (
  label: string, value: number, min: number, max: number,
  onVal: (v: number) => void,
  swatches?: React.ReactNode,
  hideChrome = false,
  /* ä¸€æ ¼å¤šå¤§ã€‚é è¨­ 1ï¼›ç¾½åŒ–é€™ç¨®ã€Œä½Žæ®µä½å·®ä¸€é»žå°±å·®å¾ˆå¤šã€çš„ç”¨ 0.5 æ‰èª¿å¾—æº–ã€‚ */
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
  /* æŽ’æˆä¸€æŽ’ï¼šåç¨±åœ¨å·¦ã€è»Œé“åœ¨ä¸­é–“ã€æ•¸å€¼åœ¨å³ï¼Œä¸Šé¢é‚£ä¸€æŽ’å­—æ•´å€‹æ‹¿æŽ‰ã€‚
     è»Œé“ç”¨ dense é‚£ä¸€ç‰ˆ â€”â€” åŽŸæœ¬é‚£ç‰ˆåˆ»æ„å¾€å·¦å³å„æº¢å‡º 32pxï¼ˆè®“åœ“é»žå¯ä»¥æ»‘åˆ°
     é‚Šç·£å¤–ï¼‰ï¼ŒæŽ’æˆä¸€æŽ’æ™‚æœƒå£“åˆ°å…©é‚Šçš„å­—ã€‚ */
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


/* ç‰¹æ•ˆç´°é …çš„æŽ’æ³•è·Ÿã€Œç·¨è¼¯ã€ä¸€è‡´ï¼šå‰›å¥½å…©æ ¹ä¸Šä¸‹å„ä¸€è¡Œï¼›
   å¥‡æ•¸æ ¹æ™‚ã€Œå¼·åº¦ã€è‡ªå·±ç«™ä¸€è¡Œï¼Œå…¶é¤˜å…©å…©ä¸€æŽ’ã€‚ */
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

// ç›®å‰é€™ä¸€æ®µè¦æ”¾ä»€éº¼
const sliderArea = (() => {
  if (adjustSub === 'filter') {
    if (!fx.lut || fx.lut === 'none') return null;
    return editorSlider('å¼·åº¦', fx.lutAmount ?? 100, 0, 100, v => setFx({ lutAmount: v }));
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
    // ç´°é …æ˜¯å¦å¤–ä¸€æ•´å€ï¼ˆä¸¦æŽ’æ»‘æ¡¿ï¼‰ï¼Œä¸èµ°é€™ä¸€æ ¹
    if (effectDetail) return null;
    if (!effectCard) return null;
    /* æœ‰äº›ç‰¹æ•ˆçš„ã€Œå¼·åº¦ã€æ²’æœ‰æ„ç¾©ï¼ˆé¦¬è³½å…‹èª¿åˆ°ä¸€åŠåªæ˜¯æŠŠåŽŸåœ–ç–Šå›žä¾†ï¼‰ï¼Œ
       é‚£ç¨®å°±åœ¨ FX_DEFS è£¡è¨­äº† rootParamï¼šæœ€å¤–å±¤é€™æ ¹ç›´æŽ¥èª¿å®ƒæŒ‡å®šçš„åƒæ•¸ã€‚ */
    const rootP = FX_ROOT_PARAM[effectCard];
    if (rootP) {
      return editorSlider(
        rootP.label, fxVal(rootP.id, rootP.def), rootP.min, rootP.max,
        v => setFx({ [rootP.id]: v }),
      );
    }
    // å…¶é¤˜ä¸€å¾‹åªæœ‰ä¸€æ ¹ã€Œå¼·åº¦ã€ï¼Œè·Ÿç·¨è¼¯ä¸€æ¨£
    const amountId = fxAmountId(effectCard);
    return editorSlider('å¼·åº¦', fxVal(amountId, 0), 0, 100, v => setFx({ [amountId]: v }));
  }
  if (adjustSub === 'shape') {
    const sub = SHAPE_SUB_TOOLS[shapeMenu];
    const subTool = sub?.find(t => t[0] === shapeTool);
    if (subTool) {
      // æé‚Šè‰²è·Ÿç™¼å…‰è‰²ç”¨åŒä¸€çµ„è‰²ç¥¨
      if (subTool[0] === 'imgStrokeColor') return swatchStrip(img.imgStrokeColor, SOFT_COLORS, c => set({ imgStrokeColor: c }), true);
      if (subTool[0] === 'imgGlowColor') return swatchStrip(img.imgGlowColor, GLOW_COLORS, c => set({ imgGlowColor: c }), true);
      const k = subTool[0] as 'imgStrokeWidth' | 'imgGlow' | 'imgStrokeDash' | 'imgStrokeGap';
      // å½¢ç‹€çš„æ»‘æ¡¿éƒ½æœƒå‹•åˆ°åœ–ç‰‡é‚Šç·£ï¼Œæ‹–çš„æ™‚å€™æŠŠé¸å–æ¡†æ”¶èµ·ä¾†ã€‚
      // ç¾½åŒ–çš„ã€Œç¯„åœã€æ˜¯ä½”çŸ­é‚Šçš„ç™¾åˆ†æ¯”ï¼Œåªæœ‰ 50 æ®µå¤ªç²—ï¼Œæ”¹æˆ 0.5 ä¸€æ ¼ã€‚
      const preciseStroke = k === 'imgStrokeWidth' || k === 'imgStrokeGap';
      return editorSlider(
        subTool[1], preciseStroke ? (((img[k] as number) || 0) * 10) : ((img[k] as number) || 0),
        subTool[3], subTool[4],
        v => set({ [k]: preciseStroke ? v / 10 : v }), undefined, true,
      );
    }
    // å½¢ç‹€é‚£ä¸€é æ²’æœ‰æ»‘æ¡¿ï¼Œä¸Šé¢é‚£ä¸€æ®µå°±ç•™ç™½
    if (shapeMenu === 'imgShape') return null;
    const t = SHAPE_TOOLS.find(x => x[0] === shapeTool);
    if (t && (t[0] === 'imgRadius' || t[0] === 'feather')) {
      const key = t[0] as 'imgRadius' | 'feather';
      // ç¾½åŒ–ä¸€æ ¼ 0.5ï¼Œä½Žæ®µä½æ‰èª¿å¾—æº–
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
    {/* 1. æ»‘æ¡¿ï¼ˆè·Ÿç·¨è¼¯ä¸€æ¨£çš„ 5remã€px-8ã€åº•ä¸‹ä¸€æ¢ç´°ç·šï¼‰ã€‚
           ç‰¹æ•ˆç´°é …æ™‚æŠŠä¸‹é¢å·¥å…·åˆ—é‚£ 6rem å€ŸéŽä¾†ï¼ˆå®ƒåŒæ™‚æ”¶æˆ 0ï¼‰ï¼Œ
           å…©æ®µåŠ èµ·ä¾†é‚„æ˜¯ 5rem + 6rem â€”â€” é è¦½åœ–çš„å¤§å°å®Œå…¨ä¸è®Šã€‚ */}
    <div
      className={`flex flex-col justify-center shrink-0 overflow-hidden bg-[#111] ${fxDetailOpen ? 'px-4' : 'px-8'}`}
      style={{ height: fxDetailOpen ? '11rem' : '5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      {fxDetailOpen ? (
        <div className="w-full h-full flex items-center gap-3">
          <button
            onClick={() => setEffectDetail(false)}
            aria-label="è¿”å›žç‰¹æ•ˆ"
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
        /* key ä¸€è®Šå°±é‡æ’­ä¸€æ¬¡ï¼šæ¯é»žä¸€é¡†å·¥å…·éˆ•ï¼Œæ»‘æ¡¿éƒ½æ˜¯ã€Œå¾žä¸‹é¢æµ®ä¸Šä¾†ã€ */
        <div key={`${adjustSub}|${tuneTool}|${shapeTool}|${effectCard}|${fx.lut || ''}`}
             className="w-full animate-in fade-in slide-in-from-bottom-2 duration-200">
          {sliderArea}
        </div>
      ) : sliderArea)}
    </div>

    {/* 2. å·¥å…·åˆ—ï¼ˆ6remã€px-4ã€gap-2ã€æ·±ä¸€éšŽçš„åº•è‰²ï¼‰ */}
    <div className="flex items-center px-4 overflow-x-auto no-scrollbar gap-2 bg-[#080808] shrink-0"
         style={{ height: fxDetailOpen ? '0px' : '6rem', opacity: fxDetailOpen ? 0 : 1 }}>
      {/* æ¿¾é¡å¡ç‰‡ï¼šå¤–è§€è·Ÿã€Œç·¨è¼¯ã€å®Œå…¨ä¸€æ¨£ â€”â€” ç¸®åœ–æ˜¯é€™å¼µç…§ç‰‡å¥—ä¸Šé€™é¡†æ¿¾é¡çš„æ¨£å­ï¼Œ
          åç¨±å£“åœ¨ä¸‹ç·£ï¼Œé¸ä¸­çš„é‚£é¡†æ˜¯å…§æé‚Šçš„ç™½æ¡†ï¼ˆä¸ä½”ç‰ˆé¢ã€ä¸æœƒä½ç§»ï¼‰ã€‚ */}
      {adjustSub === 'filter' && lutList.map((l, li) => {
        const active = (fx.lut || 'none') === l.id;
        return (
          <button
            key={l.id}
            data-lut-card={l.id}
            onClick={async () => {
              if (active) return;
              // eagerï¼šä½¿ç”¨è€…æ­£åœ¨ç­‰é€™ä¸€é¡†ï¼Œä¸æŽ’éšŠï¼ˆèƒŒæ™¯é è¼‰é‚£ä¸€æ”¯æ‰è¦ç­‰ç©ºæª”ï¼‰
              if (l.url) { setLoadingLut(l.id); await loadLut(l.id, l.url, true); setLoadingLut(null); }
              /* å¼·åº¦ç”¨è·Ÿç·¨è¼¯é åŒä¸€ä»½é è¨­å€¼ï¼ˆF3 æ˜¯ 70ã€F12 æ˜¯ 50â€¦ï¼‰â€”â€”
                 ä»¥å‰é€™è£¡ä¸€å¾‹ 100ï¼ŒåŒä¸€é¡†æ¿¾é¡åœ¨æ‹¼åœ–è£¡å°±æ¯”ç·¨è¼¯é æ¿ƒã€‚ */
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
                  {l.url ? l.name : 'åŽŸå§‹'}
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

      {/* ç‰¹æ•ˆå¡ç‰‡ï¼šè·Ÿã€Œç·¨è¼¯ã€åŒä¸€ä»½æ¸…å–®ã€åŒä¸€ç¨®å¡ç‰‡å¤–è§€ã€‚
          ç¸®åœ–æ˜¯é€™å€‹ç‰¹æ•ˆçš„é è¨­æ•ˆæžœï¼Œé¸ä¸­çš„é‚£é¡†å³ä¸Šè§’æœƒå¤šä¸€é¡†ç·¨è¼¯éµï¼ˆæœ‰ç´°é …æ‰æœ‰ï¼‰ã€‚ */}
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
              {/* ç™½æ¡†ï¼é€™å€‹ç‰¹æ•ˆæ­£åœ¨ç”Ÿæ•ˆï¼›åªæ˜¯é¸åˆ°ä½†æ²’é–‹çš„ä¸ç•« */}
              {on && <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />}
              {on && hasDetail && (
                // å¡ç‰‡æœ¬èº«å°±æ˜¯ä¸€é¡† buttonï¼Œè£¡é¢ä¸èƒ½å†æ”¾ buttonï¼Œæ‰€ä»¥ç”¨ span
                <span
                  role="button"
                  aria-label="èª¿æ•´ç´°é …"
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
            // ã€Œå½¢ç‹€ã€ä¹Ÿæ˜¯é»žé€²åŽ»ä¸€é ï¼Œåªæ˜¯é‚£ä¸€é æ”¾çš„æ˜¯å½¢ç‹€ä¸æ˜¯æ»‘æ¡¿
            const isShapePick = id === 'imgShape';
            const isSub = !!SHAPE_SUB_TOOLS[id] || isShapePick;
            // åªçœ‹ç²—ç´°ï¼å¼·åº¦ï¼Œé¡è‰²ä¸ç®—ï¼šå€¼æ˜¯ 0 çš„æ™‚å€™ç•«é¢ä¸Šæ ¹æœ¬æ²’æœ‰æ•ˆæžœï¼Œ
            // æŒ‰éˆ•ä¸‹æ–¹å°±ä¸è©²æœ‰ç™½é»ž
            const adjusted = isShapePick
              ? isImgShaped(img.imgShape)
              : SHAPE_SUB_TOOLS[id]
                ? SHAPE_SUB_TOOLS[id].some(([k, , , , , d]) =>
                    !k.endsWith('Color') && (((img as any)[k]) || 0) !== d)
                : (((img as any)[id]) || 0) !== dflt;
            /* ã€Œå½¢ç‹€ã€ç›´æŽ¥å…±ç”¨ä¸‹æ–¹ã€Œé€ åž‹ã€åˆ†é çš„ shapes åœ–æ¨™ï¼Œ
               å…©å€‹å…¥å£ä½¿ç”¨å®Œå…¨ç›¸åŒçš„è¦–è¦ºèªžè¨€ã€‚ */
            const glyph = isShapePick ? 'shapes' : icon;
            /* å…©æ®µå¼çš„é‚£å¹¾é¡†ï¼ˆå½¢ç‹€ï¼æé‚Šï¼ç™¼å…‰ï¼‰é»žä¸‹åŽ»æ•´æŽ’æœƒè¢«å­é¸å–®æ›æŽ‰ï¼Œ
               æ‰€ä»¥æŒ‰ä¸‹åŽ»çš„å›žé¥‹äº¤çµ¦ CSS çš„ :activeï¼ˆè¦‹ä¸Šé¢ toolBtnï¼‰ï¼Œ
               æ›é æœ¬èº«ä¸€é»žå»¶é²éƒ½æ²’æœ‰ã€‚é€€å›žä¸Šä¸€å±¤æ™‚ï¼Œå‰›å‰›é€²åŽ»çš„é‚£ä¸€é¡†æœƒç•™åœ¨
               äº®è‘—çš„ç‹€æ…‹ï¼ˆè¦‹ä¸‹é¢è¿”å›žéµï¼‰ã€‚ */
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
              /* é€€å›žä¸Šä¸€å±¤æ™‚ï¼Œå‰›å‰›é€²åŽ»çš„é‚£ä¸€é¡†è¦ç•™åœ¨äº®è‘—çš„ç‹€æ…‹
                 ï¼ˆshapeMenu å­˜çš„å°±æ˜¯å®ƒçš„ idï¼šimgShapeï¼strokeï¼glowï¼‰ã€‚
                 åŽŸæœ¬ä¸€å¾‹è·³å›žåœ“è§’ï¼Œæ‰€ä»¥å¾žå½¢ç‹€é€€å‡ºä¾†äº®çš„æ˜¯åœ“è§’ï¼Œ
                 çœ‹èµ·ä¾†å°±åƒã€Œå‰›å‰›æŒ‰çš„é‚£ä¸€é¡†æ ¹æœ¬æ²’è¢«é¸éŽã€ã€‚
                 é€™ä¸‰é¡†åœ¨æ ¹é¸å–®æ²’æœ‰è‡ªå·±çš„æ»‘æ¡¿ï¼Œæ‰€ä»¥ä¸Šé¢é‚£ä¸€æ®µç…§æ¨£ç•™ç™½ã€‚ */
              onClick={() => { setShapeMenu('root'); setShapeTool(shapeMenu); }}
              className="flex flex-col items-center justify-center gap-2 shrink-0 group w-12"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all text-white">
                <Icon name="arrow_back" className="text-xl" />
              </div>
            </button>
            <div className="w-[1px] h-8 bg-white/10 mx-2" />
            {shapeMenu === 'imgShape'
              /* å½¢ç‹€é‚£ä¸€é ï¼šæŒ‰ä¸‹åŽ»ç›´æŽ¥æ›å¤–å½¢ã€‚å†æŒ‰ä¸€æ¬¡åŒä¸€é¡†å°±å›žåˆ°æ–¹å½¢ï¼Œ
                 ä¸ç„¶é¸äº†æ„›å¿ƒå°±æ²’æœ‰è·¯å¯ä»¥é€€å›žåŽ»äº†ã€‚ */
              ? IMG_SHAPES.map(({ id, label, glyph }) => {
                  const cur = img.imgShape || 'rect';
                  return toolBtn(id, label,
                    // ç©ºå¿ƒç‰ˆï¼šè·Ÿã€Œå½¢ç‹€ã€é‚£é¡†åœ–æ¨™åŒä¸€ç¨®èªžè¨€ã€‚
                    // å°ºå¯¸æ¯”å…¶ä»–å·¥å…·éˆ•å°å…©æˆï¼ˆ19â†’15ï¼‰â€”â€” æ–¹å½¢ï¼åœ“å½¢ï¼æ˜Ÿåž‹ï¼æ„›å¿ƒ
                    // éƒ½æ˜¯æ»¿ç‰ˆçš„å¯¦å¿ƒè¼ªå»“ï¼Œè·Ÿé‚£äº›ç•™ç™½å¤šçš„ç·šæ¢åœ–ç¤ºæ”¾åœ¨ä¸€èµ·æœƒé¡¯å¾—å¤ªèƒ–ã€‚
                    <ShapeGlyph item={{ id, kind: glyph, filled: false }} size={15} />,
                    cur === id, false, () => {
                    const next = cur === id ? 'rect' : id;
                    /* æ›å½¢ç‹€æ™‚æŠŠä½ç§»æ­¸é›¶ â€”â€” ä¸Šä¸€å€‹å½¢ç‹€æ‹–åˆ°çš„ä½ç½®æ›åˆ°æ–°å½¢ç‹€ä¸Š
                       é€šå¸¸ä¸æ˜¯ä½¿ç”¨è€…è¦çš„ï¼Œå¾žæ­£ä¸­é–“é–‹å§‹æ¯”è¼ƒå¥½èª¿ã€‚ */
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

    {/* 3. åˆ†é¡žåˆ—ï¼šè·Ÿç·¨è¼¯ä¸€æ¨£çš„ h-16ã€ä¸Šæ–¹ç´°ç·šã€é»‘åº•ã€åº•éƒ¨å®‰å…¨å€ç©ºéš™ */}
    <div className="flex h-16 border-t border-white/10 bg-black pb-[calc(env(safe-area-inset-bottom,0px)+12px)] box-content shrink-0">
      {CATS.map(([id, icon, label]) => (
        <button
          key={id}
          onClick={() => {
            if (id === 'compose') { openComposeFor(img.id); return; }
            /* å¾žæ§‹åœ–åˆ‡åˆ°åˆ¥çš„åˆ†é¡žï¼šå…ˆæŠŠç•¶ä¸‹è£åˆ‡çš„çµæžœç¢ºèªæŽ‰å†åˆ‡éŽåŽ» â€”â€”
               ä¸ç„¶æ§‹åœ–ä»‹é¢æœƒä¸€ç›´è“‹åœ¨ä¸Šé¢ï¼Œçœ‹èµ·ä¾†å°±åªæ˜¯ã€Œåœ–æ¨™äº®äº†ä½†æ²’åæ‡‰ã€ã€‚ */
            if (composeOpen) onLeaveCompose?.();
            setAdjustSub(id as any);
            // è·Ÿç·¨è¼¯ä¸€æ¨£ï¼šåˆ‡åˆ†é¡žå°±æŠŠè©²åˆ†é¡žçš„ç¬¬ä¸€å€‹å·¥å…·é¸èµ·ä¾†
            if (id === 'tune') setTuneTool(deferSlider ? '' : TUNE_TOOLS[0][0]);
            if (id === 'shape') { setShapeMenu('root'); setShapeTool(''); }
            if (id === 'effect') { setEffectCard(''); setEffectDetail(false); }
          }}
          /* æ§‹åœ–é–‹è‘—çš„æ™‚å€™ï¼Œäº®çš„æ˜¯ã€Œæ§‹åœ–ã€é‚£ä¸€é¡†ï¼ˆå®ƒä¸ä½”ç”¨ adjustSubï¼‰ */
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

/** é è¦½ç”¨çš„ç´‹ç†å±¤ã€‚è·ŸåŒ¯å‡ºèµ°åŒä¸€æ”¯ paintPatternï¼Œçœ‹åˆ°ä»€éº¼å°±æ˜¯å­˜å‡ºä¾†ä»€éº¼ã€‚ */
const PatternLayer: React.FC<{ w: number; h: number; opts: PatternOpts }> = ({ w, h, opts }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const raw = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const dpr = Math.min(raw, 2000 / Math.max(1, Math.max(w, h)));   // é•·é‚Šå°é ‚ï¼Œé¿å…å¹¾å MB çš„ç•«å¸ƒ
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, pw, ph);
    if (opts.type === 'none') return;
    g.save(); g.scale(dpr, dpr); paintPattern(g, w, h, opts); g.restore();
    /* âš  æ¢ç´‹é‚£å››å€‹åƒæ•¸ä¸€å®šè¦é€²ä¾†ã€‚
       å°‘äº†å®ƒå€‘ï¼Œæ”¹æ•¸é‡ï¼æ–¹å‘ï¼å…©å€‹é¡è‰²æ™‚é€™ä¸€å±¤æ ¹æœ¬ä¸æœƒé‡ç•« â€”â€”
       ä½†åŒ¯å‡ºèµ°çš„æ˜¯åŒä¸€æ”¯ paintPatternã€åƒçš„æ˜¯ç•¶ä¸‹çš„å€¼ï¼Œ
       æ–¼æ˜¯ã€Œé è¦½çœ‹åˆ°çš„ã€è·Ÿã€Œå­˜å‡ºä¾†çš„ã€æœƒä¸ä¸€æ¨£ã€‚ */
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

  // è·Ÿç™¼å…‰åŒä¸€æ¢æ¼¸å±¤ï¼Œæ˜Žåº¦æåˆ° 90%ï¼›ç¬¬ä¸€é¡†æ˜¯ç´”ç™½
  const PRESETS = colors || SOFT_COLORS;

  /* è‰²è™Ÿæ¬„ã€‚æ²’æœ‰é ‚åˆ—æ™‚è·Ÿè‰²ç¥¨ä¸¦æŽ’ï¼ˆåŽŸæœ¬çš„æ¨£å­ï¼‰ï¼›
     æœ‰é ‚åˆ—æ™‚æ¬ä¸ŠåŽ»è·Ÿè¿”å›žéµå¹³è¡Œï¼Œè‰²ç¥¨å°±èƒ½ä½”æ»¿æ•´æŽ’ã€‚ */
  const hexBox = (
    <input
      type="text"
      value={hexInput}
      onChange={handleHexInputChange}
      maxLength={7}
      aria-label="è‰²è™Ÿ"
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
        {/* éŸ“ç³»æ‹¼è²¼å¸¸ç”¨è‰²ï¼šä¸€é»žå°±æ›ã€‚
            å…§è·æ˜¯ç•™çµ¦é¸å–å¤–æ¡†çš„ï¼Œå¦å‰‡ç¬¬ä¸€é¡†èˆ‡å¤–æ¡†ä¸Šç·£æœƒè¢«æ²å‹•å®¹å™¨è£æŽ‰ã€‚ */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0 px-0.5 py-0.5">
          {/* ç¬¬ä¸€é¡†å›ºå®šæ˜¯è‡ªè¨‚é¡è‰² */}
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
              <span>è‰²ç›¸</span>
              <span className="text-white/40">{Math.round(hsv.h)}Â°</span>
            </div>
            <div className="slider-wrap" style={{ height: 6 }}><input type="range" min="0" max="360" value={hsv.h} onInput={e => handleHsvChange('h', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ ['--bar' as any]: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }} /></div>
          </div>
          <div className="grid grid-cols-2 gap-x-7 gap-y-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>é£½å’Œåº¦</span>
                <span className="text-white/40">{Math.round(hsv.s)}%</span>
              </div>
              <div className="slider-wrap" style={{ height: 6 }}><input type="range" min="0" max="100" value={hsv.s} onInput={e => handleHsvChange('s', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ ['--bar' as any]: `linear-gradient(to right, #808080, ${hsvToHex(hsv.h, 100, 100)})` }} /></div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>æ˜Žåº¦</span>
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
  /** æ©«ç·šåªç•«åœ¨é€™ä¸€é çš„å·¦å³ç¯„åœå…§ï¼ˆå…§å®¹åº§æ¨™ï¼‰ã€‚æ²’å¡«å°±ç•«æ»¿æ•´æŽ’ï¼ˆèˆŠè¡Œç‚ºï¼‰ã€‚ */
  x0?: number;
  x1?: number;
}

/* â”€â”€ åœ“è§’ + ç¾½åŒ–é®ç½© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   ç·šæ€§æ¼¸å±¤åšçš„ç¾½åŒ–åœ¨å››å€‹è§’æœƒæ·¡å¾—æ¯”è¼ƒå¿«ï¼Œçœ‹èµ·ä¾†å¾ˆå»‰åƒ¹ã€‚é€™è£¡æ”¹æˆä¿®åœ–è»Ÿé«”
   çš„åšæ³•ï¼šå…ˆæŠŠåœ“è§’çŸ©å½¢ç•«æˆé®ç½©ï¼Œå†å° alpha åšä¸‰æ¬¡ç›’ç‹€æ¨¡ç³Šï¼ˆâ‰ˆé«˜æ–¯ï¼‰ï¼Œ
   æ·¡å‡ºå°±æœƒæ²¿è‘—å½¢ç‹€è¼ªå»“ç­‰è·å±•é–‹ï¼Œåœ“è§’ä¹Ÿä¸€èµ·è®ŠæŸ”ã€‚
   é è¦½èˆ‡åŒ¯å‡ºå…±ç”¨åŒä¸€æ”¯ï¼Œå…©é‚Šæ‰æœƒé•·å¾—ä¸€æ¨¡ä¸€æ¨£ã€‚                          */

/**
 * åœ“è§’åŠå¾‘ï¼šç™¾åˆ†æ¯”ä¸€å¾‹åƒã€ŒçŸ­é‚Šã€ï¼Œå››å€‹è§’éƒ½æ˜¯æ­£åœ“å¼§ã€‚
 *
 * ä»¥å‰æ˜¯æ°´å¹³åƒå¯¬ã€åž‚ç›´åƒé«˜ï¼ˆï¼CSS çš„ border-radius: N%ï¼‰ï¼Œè§’è®Šæˆæ©¢åœ“ï¼š
 * ç›´ç«‹çš„æ ¼å­ rx å¾ˆå°ã€ry å¾ˆå¤§ï¼Œä¸Šä¸‹é‚£æ¢é‚Šæ‰èµ°ä¸€é»žé»žå°±æ€¥è½‰å½Žï¼Œçœ‹èµ·ä¾†
 * å°±æ˜¯ã€Œé‚Šä¸Šçªç„¶å¤šä¸€å€‹è§’ã€ã€‚æ­£åœ“è§’èµ°çš„æ˜¯å››åˆ†ä¹‹ä¸€åœ“ï¼ŒæŽ¥åˆ°ç›´é‚Šçš„æ›²çŽ‡
 * è®ŠåŒ–å¹³é †ï¼Œä¹Ÿæ‰æ˜¯ä¿®åœ–è»Ÿé«”çš„åšæ³•ã€‚
 */
export const cornerR = (pct: number, w: number, h: number) => (pct / 100) * Math.min(w, h);

/** åœ“è§’çŸ©å½¢è·¯å¾‘ï¼ˆrx/ry å¯ä¸åŒï¼Œä½†å‘¼å«ç«¯ä¸€å¾‹å‚³åŒä¸€å€‹å€¼ â†’ æ­£åœ“è§’ï¼‰ã€‚ */
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

/* â”€â”€ åœ–ç‰‡çš„å¤–å½¢ï¼ˆå½¢ç‹€ï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * åœ–ç‰‡æœ¬ä¾†åªæœ‰ã€Œæ–¹å½¢ï¼‹åœ“è§’ã€ä¸€ç¨®å¤–å½¢ã€‚é€™ä¸€çµ„è®“å®ƒå¯ä»¥æ›æˆåœ“å½¢ã€æ˜Ÿåž‹ã€æ„›å¿ƒã€‚
 *
 * è·¯å¾‘ç›´æŽ¥å€Ÿç”¨ã€Œæ–°å¢žåœ–å½¢ã€é‚£ä¸€ä»½ï¼ˆshapePathDï¼‰â€”â€” å…©é‚Šç•«å‡ºä¾†çš„åœ“å½¢ã€æ˜Ÿæ˜Ÿã€
 * æ„›å¿ƒå› æ­¤æ˜¯åŒä¸€é¡†ï¼Œä¸æœƒå‡ºç¾ã€Œåœ–å½¢çš„æ˜Ÿæ˜Ÿè·Ÿåœ–ç‰‡çš„æ˜Ÿæ˜Ÿé•·å¾—ä¸ä¸€æ¨£ã€ã€‚
 *
 * æœ€è¦ç·Šçš„ä¸€æ¢è¦çŸ©ï¼š**æ²’è¨­å½¢ç‹€æ™‚ï¼Œé€™å¹¾æ”¯çš„è¡Œç‚ºè¦è·Ÿä»¥å‰ä¸€æ¨¡ä¸€æ¨£ã€‚**
 * æ‰€æœ‰æ—¢æœ‰çš„åœ–ç‰‡éƒ½æ²’æœ‰ imgShapeï¼Œä¸€å¾‹èµ° isImgShaped() ç‚º false çš„é‚£æ¢è·¯ï¼Œ
 * ä¹Ÿå°±æ˜¯åŽŸæœ¬çš„ roundRectPathï¼drawImageï¼Œä¸€å€‹åƒç´ éƒ½ä¸æœƒè®Šã€‚
 */

/** åœ–ç‰‡å¯ä»¥é¸çš„å¤–å½¢ã€‚'rect' ï¼ åŽŸæœ¬çš„æ–¹å½¢ï¼ˆé‚„æ˜¯å¯ä»¥å†å¥—åœ“è§’ï¼‰ã€‚ */
export const IMG_SHAPES: { id: string; label: string; glyph: string }[] = [
  // glyph ï¼ æŒ‰éˆ•ä¸Šè¦ç•«å“ªä¸€é¡†ï¼ˆç”¨ shapePathD çš„å‘é‡ï¼Œä¸é åœ–ç¤ºå­—åž‹ï¼‰
  { id: 'rect', label: 'æ–¹å½¢', glyph: 'square' },
  { id: 'circle', label: 'åœ“å½¢', glyph: 'circle' },
  { id: 'star', label: 'æ˜Ÿåž‹', glyph: 'star' },
  { id: 'heart', label: 'æ„›å¿ƒ', glyph: 'heart' },
];

/**
 * ã€Œå½¢ç‹€ã€é‚£ä¸€é¡†çš„åœ–æ¨™ã€‚
 *
 * å›ºå®šé•·é€™æ¨£ï¼Œä¸è·Ÿè‘—ç›®å‰é¸çš„å½¢ç‹€è®Š â€”â€” åˆ†é¡žéˆ•è¦ä¸€ç›´æ˜¯åŒä¸€å¼µè‡‰ï¼Œ
 * è®Šä¾†è®ŠåŽ»åè€Œèªä¸å‡ºä¾†ï¼ˆè¦çŸ¥é“ç¾åœ¨é¸äº†å“ªä¸€å€‹ï¼Œé»žé€²åŽ»é‚£ä¸€æŽ’å°±çœ‹å¾—åˆ°ï¼‰ã€‚
 * ä¸€å€‹æ–¹æ¡†ç–Šä¸€å€‹åœ“ï¼Œæ˜¯ã€Œå½¢ç‹€ã€æœ€å¥½èªçš„ç•«æ³•ï¼›ç©ºå¿ƒè·Ÿè£¡é¢é‚£æŽ’ä¸€è‡´ã€‚
 */
export const ImgShapeIcon: React.FC<{ size?: number }> = ({ size = 19 }) => (
  /* æ–¹å½¢ã€åœ“å½¢èˆ‡ä¸‰è§’å½¢ç”¨æ¸…æ¥šçš„ç•™ç™½åˆ†éš”ï¼Œç›´è¦ºè¡¨é”ã€Œé¸æ“‡å½¢ç‹€ã€ã€‚
     ä¸‰å€‹å°é–‰è¼ªå»“åˆä½µæˆä¸€æ¬¡ SVG æé‚Šï¼Œé€æ˜Žç‹€æ…‹ä¹Ÿä¸æœƒåœ¨æŽ¥é»žç–Šç™½ã€‚ */
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.35}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3.5 3.5h6.25v6.25H3.5z M20.5 6.625a3.125 3.125 0 1 1-6.25 0 3.125 3.125 0 1 1 6.25 0 M3.5 20.5h7l-3.5-6z" />
  </svg>
);

export const isImgShaped = (kind?: string) => !!kind && kind !== 'rect';

/**
 * å½¢ç‹€è¦ç•«åœ¨æ¡†è£¡çš„å“ªä¸€å¡Šã€‚
 *
 * ç”¨ã€ŒçŸ­é‚Šçš„æ­£æ–¹å½¢ã€æ“ºæ­£ä¸­å¤®ã€â€”â€”å› ç‚ºåœ“å½¢ã€æ˜Ÿæ˜Ÿã€æ„›å¿ƒæœ¬ä¾†å°±æ˜¯ 1:1 çš„
 * ï¼ˆADD_SHAPE_ITEMS è£¡å®ƒå€‘éƒ½æ²’æœ‰ ratioï¼‰ã€‚ç›´æŽ¥ç…§æ¡†çš„é•·å¯¬åŽ»ç•«çš„è©±ï¼Œ
 * 4:3 çš„ç…§ç‰‡æœƒæŠŠåœ“å½¢å£“æˆæ©¢åœ“ã€æ˜Ÿæ˜Ÿæ‹‰æ­ªï¼Œé‚£ä¸æ˜¯ä½¿ç”¨è€…è¦çš„ã€Œæ­£çš„åœ–æ¡ˆã€ã€‚
 */
export const imgShapeBox = (w: number, h: number) => {
  const s = Math.min(w, h);
  return { x: (w - s) / 2, y: (h - s) / 2, s };
};

/**
 * å½¢ç‹€è¦ç•«å¤šå¤§ã€ç•«åœ¨å“ªè£¡ã€‚
 *
 * åªæŠŠå½¢ç‹€å¡žé€²æ­£æ–¹å½¢æ˜¯ä¸å¤ çš„ï¼šæ„›å¿ƒçš„è·¯å¾‘åªä½”å®ƒå¤–æ¡†çš„ 73%ã€ä¸Šé¢é‚„ç©ºè‘—
 * å››åˆ†ä¹‹ä¸€ï¼ˆè¦‹ SHAPE_FITï¼‰â€”â€” ç…§åŽŸæ¨£ç•«ï¼Œæ„›å¿ƒå°±æœƒæ¯”åœ“å½¢ã€æ˜Ÿæ˜Ÿå°ä¸€åœˆï¼Œ
 * é ‚éƒ¨ä¸€å¤§ç‰‡ç©ºç™½ã€‚æ‰€ä»¥å…ˆç…§ SHAPE_FIT æŠŠã€ŒçœŸæ­£æœ‰ç•«åˆ°çš„é‚£ä¸€å¡Šã€æ”¾å¤§åˆ°å‰›å¥½
 * å¡«æ»¿æ­£æ–¹å½¢ï¼ˆå–å¯¬ã€é«˜å…©å€‹å€çŽ‡è£¡å°çš„é‚£å€‹ï¼Œæ‰ä¸æœƒæœ‰ä¸€é‚Šçˆ†å‡ºåŽ»ï¼‰ï¼Œ
 * å†æŠŠå¢¨æ°´çš„ä¸­å¿ƒå°åˆ°æ­£æ–¹å½¢çš„ä¸­å¿ƒã€‚
 *
 * å›žå‚³ S ï¼ è¦é¤µçµ¦ shapePathD çš„å¤–æ¡†é‚Šé•·ï¼Œtxï¼ty ï¼ è·¯å¾‘è¦å¹³ç§»åˆ°å“ªè£¡ã€‚
 * åˆ»æ„å›žå‚³ã€Œå¹³ç§»é‡ã€è€Œä¸æ˜¯ç›´æŽ¥ ctx.scaleï¼šä¸€ scale é€£ç·šå¯¬éƒ½æœƒè·Ÿè‘—æ”¾å¤§ï¼Œ
 * æé‚Šå°±æœƒè®Šç²—ã€‚shapePathD æœ¬ä¾†å°±æ˜¯ç…§å‚³é€²åŽ»çš„å°ºå¯¸ç­‰æ¯”ç”¢ç”Ÿçš„ï¼Œ
 * ç›´æŽ¥é¤µä¸€å€‹å¤§ä¸€é»žçš„å¤–æ¡†æœ€ä¹¾æ·¨ã€‚
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
    /** æ”¾å¤§ä¹‹å¾Œå¢¨æ°´å¯¦éš›çš„å¯¬é«˜ï¼ˆé¸å–æ¡†ç…§é€™å€‹ç•«ï¼‰ */
    iw: f[2] * S, ih: f[3] * S,
  };
};

/**
 * é‹ªå¥½åœ–ç‰‡çš„å¤–æ¡†è·¯å¾‘ï¼Œç„¶å¾Œè·‘ run()ã€‚
 *
 * æ²’æœ‰å½¢ç‹€ â†’ ç…§èˆŠæŠŠåœ“è§’çŸ©å½¢é‹ªåœ¨ç•«å¸ƒä¸Šï¼Œrun() æ”¶åˆ° undefinedï¼Œ
 *            å‘¼å«ç«¯å°±è·Ÿä»¥å‰ä¸€æ¨£ç”¨ fill()ï¼stroke()ã€‚
 * æœ‰å½¢ç‹€   â†’ æŠŠç•«å¸ƒåŽŸé»žæ¬åˆ° (x,y)ï¼Œrun() æ”¶åˆ°ä¸€å€‹ Path2Dï¼Œ
 *            å‘¼å«ç«¯æ”¹ç”¨ fill(p)ï¼stroke(p)ã€‚è·‘å®ŒæœƒæŠŠç•«å¸ƒç‹€æ…‹é‚„åŽŸã€‚
 *
 * ä¹‹æ‰€ä»¥ç”¨ã€Œæ¬åŽŸé»žã€è€Œä¸æ˜¯æŠŠè·¯å¾‘æœ¬èº«å¹³ç§»ï¼šPath2D çš„çŸ©é™£åƒæ•¸åœ¨å„å®¶ç€è¦½å™¨
 * çš„æ”¯æ´åº¦æ²’æœ‰ translate() é‚£éº¼ä¸€è‡´ï¼Œè€Œé€™å€‹ App æ˜¯è¦é€² WKWebView çš„ã€‚
 */
export const withImgOutline = (
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  kind: string | undefined, rx: number, ry: number,
  run: (p?: Path2D) => void,
) => {
  if (!isImgShaped(kind)) { roundRectPath(g, x, y, w, h, rx, ry); run(); return; }
  /* æ­£æ–¹å½¢ã€æ“ºä¸­å¤®ã€è€Œä¸”å¢¨æ°´æ”¾å¤§åˆ°å¡«æ»¿å®ƒï¼ˆè¦‹ imgShapeXformï¼‰ã€‚
     æé‚Šé‚£ä¸€æ¬¡å‚³é€²ä¾†çš„æ¡†æ¯”å¡«è‰²é‚£ä¸€æ¬¡å¤§ lwï¼ˆå››é‚Šå„ lw/2ï¼‰ï¼Œå…©è€…å› æ­¤åŒå¿ƒã€
     é‚Šè·å‰›å¥½ lw/2 â€”â€” ç·šå°±æœƒè²¼è‘—å½¢ç‹€çš„é‚Šæã€‚ */
  const t = imgShapeXform(kind!, w, h);
  g.save();
  g.translate(x + t.tx, y + t.ty);
  try { run(new Path2D(shapePathD(kind!, t.S, t.S))); } finally { g.restore(); }
};

/**
 * å½¢ç‹€çœŸæ­£ã€Œæœ‰ç•«åˆ°ã€çš„é‚£ä¸€å¡Šï¼Œå›žå‚³çš„æ˜¯åœ¨åŽŸæœ¬é‚£å€‹ wÃ—h æ¡†è£¡çš„ä½ç½®èˆ‡å¤§å°ã€‚
 *
 * é¸å–æ¡†ç…§é€™å€‹ç•«ï¼Œå°±æœƒå‰›å¥½æŠŠçœ‹å¾—è¦‹çš„åœ–æ¡ˆåŒ…ä½ â€”â€” æ„›å¿ƒä¸Šé¢é‚£ç‰‡ç©ºç™½ã€
 * æ˜Ÿæ˜Ÿåº•ä¸‹é‚£æ¢ï¼Œéƒ½ä¸æœƒè¢«æ¡†é€²åŽ»ã€‚æ²’æœ‰å½¢ç‹€æ™‚å›žå‚³æ•´å€‹æ¡†ï¼Œè·Ÿä»¥å‰ä¸€æ¨¡ä¸€æ¨£ã€‚
 * ç”¨çš„æ˜¯è·ŸæŒ‰éˆ•å°åœ–åŒä¸€ä»½ SHAPE_FITï¼Œæ‰€ä»¥æ¡†èˆ‡åœ–æ¡ˆæ°¸é å°å¾—ä¸Šã€‚
 */
export const imgShapeInk = (kind: string | undefined, w: number, h: number) => {
  if (!isImgShaped(kind)) return { x: 0, y: 0, w, h };
  /* å½¢ç‹€å·²ç¶“è¢«æ”¾å¤§åˆ°å¡«æ»¿é‚£å€‹æ­£æ–¹å½¢ï¼ˆè¦‹ imgShapeXformï¼‰ï¼Œæ‰€ä»¥æ­£æ–¹å½¢å°±æ˜¯
     ã€Œä¸€å®šæ¡†å¾—ä½ã€è€Œä¸”ä¸æœƒå¤šç•™ç©ºç™½ã€çš„é‚£å€‹æ¡†ã€‚
     é€™è£¡åˆ»æ„**ä¸**å†ç”¨ SHAPE_FIT åŽ»ç¸®å¾—æ›´ç·Š â€”â€” é‚£ä»½è¡¨æ˜¯çµ¦æŒ‰éˆ•å°åœ–ç”¨çš„è¿‘ä¼¼å€¼ï¼Œ
     æ‹¿ä¾†ç•¶é¸å–æ¡†æ™‚ï¼Œèª¤å·®æœƒè®Šæˆã€Œåœ–æ¡ˆå‡¸å‡ºæ¡†å¤–ã€ï¼Œé‚£æ¯”ç¨å¾®é¬†ä¸€é»žé›£çœ‹å¾—å¤šã€‚
     ç¶“å…¸æ‹¼åœ–çš„å¤–æ¡†ç”¨çš„ä¹Ÿæ˜¯é€™å€‹æ­£æ–¹å½¢ï¼Œå…©é‚Šå› æ­¤å®Œå…¨ä¸€è‡´ã€‚ */
  const b = imgShapeBox(w, h);
  return { x: b.x, y: b.y, w: b.s, h: b.s };
};

/** é€™å€‹é»žè½åœ¨åœ–ç‰‡ã€Œçœ‹å¾—è¦‹çš„é‚£ä¸€å¡Šã€è£¡é¢å—Žï¼Ÿï¼ˆå½¢ç‹€ä¹‹å¤–çš„è§’è½ä¸ç®—ï¼‰ */
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

/** åœ–ç‰‡åœ¨å½¢ç‹€è£¡æœ€å¤šèƒ½æ”¾åˆ°å¹¾å€ï¼ˆè·Ÿä½ˆå±€çš„æ ¼å­åŒä¸€å€‹ä¸Šé™ï¼‰ */
export const IMG_SHAPE_MAX_ZOOM = 5;

export const clampImgZoom = (z: any) =>
  Math.max(1, Math.min(IMG_SHAPE_MAX_ZOOM, Number(z) || 1));

/**
 * åœ–ç‰‡åœ¨å½¢ç‹€è£¡é‚„èƒ½å¾€å„æ–¹å‘æŒªå¤šé ï¼ˆå–®ä½è·Ÿ wï¼h ä¸€æ¨£ï¼Œå›žå‚³çš„æ˜¯åŠå¾‘ï¼‰ã€‚
 *
 * çœ‹å¾—è¦‹çš„åªæœ‰ä¸­é–“é‚£å€‹æ­£æ–¹å½¢ï¼Œæ‰€ä»¥åªè¦ã€Œåœ–ç‰‡è“‹å¾—ä½é‚£å€‹æ­£æ–¹å½¢ã€å°±ä¸æœƒéœ²å‡ºç©ºéš™ï¼š
 *   æ©«å‘å¯æ‹– = (åœ–ç‰‡å¯¬ Ã— å€çŽ‡ âˆ’ æ­£æ–¹å½¢é‚Šé•·) / 2
 * å› æ­¤æ©«çš„ç…§ç‰‡åœ¨å€çŽ‡ 1 æ™‚å°±å·²ç¶“å¯ä»¥å·¦å³æ‹–äº†ï¼ˆå¯¬æ¯”æ­£æ–¹å½¢å¯¬ï¼‰ï¼Œ
 * ä¸Šä¸‹è¦æ‹–å‰‡å¾—å…ˆæ”¾å¤§ä¸€é»ž â€”â€” è·Ÿä½ˆå±€è£¡èª¿æ•´æ ¼å­å…§ç…§ç‰‡æ˜¯åŒä¸€ç¨®æ‰‹æ„Ÿã€‚
 */
/**
 * å…©æŒ‡æ”¾å¤§ï¼ç¸®å°æ™‚ï¼Œä½ç§»è¦æ€Žéº¼è·Ÿè‘—è®Šï¼Œæ‰æœƒåƒæ˜¯ã€Œä»¥å½¢ç‹€çš„ä¸­å¿ƒç‚ºåŸºæº–ã€åœ¨ç¸®æ”¾ã€‚
 *
 * imgShapeXï¼Y å­˜çš„æ˜¯ã€Œä½”å¯æ‹–ç¯„åœçš„å¹¾æˆã€ã€‚å¯æ‹–ç¯„åœæœƒéš¨å€çŽ‡ä¸€èµ·è®Šå¤§ï¼Œ
 * æ‰€ä»¥å€çŽ‡ä¸€å‹•ã€åŒæ¨£çš„æ¯”ä¾‹æ›ç®—å‡ºä¾†çš„å¯¦éš›ä½ç§»å°±è®Šäº† â€”â€” ç•«é¢ä¸Šçœ‹èµ·ä¾†å°±æ˜¯
 * ä¸€é‚Šæ”¾å¤§ä¸€é‚Šå¾€æ—é‚Šæ»‘ï¼ŒåŸºæº–é»žè·‘æŽ‰ã€‚
 *
 * è¦è®“å½¢ç‹€ä¸­å¿ƒåº•ä¸‹çš„é‚£ä¸€å€‹é»žå›ºå®šä¸å‹•ï¼Œå¯¦éš›ä½ç§»å¿…é ˆè·Ÿå€çŽ‡æˆæ­£æ¯”
 * ï¼ˆä½ç§» / åœ–ç‰‡å¯¬åº¦ ä¸è®Šï¼‰ã€‚æ‰€ä»¥é€™è£¡å…ˆé‚„åŽŸæˆå¯¦éš›ä½ç§»ã€ä¹˜ä¸Šå€çŽ‡çš„è®ŠåŒ–ï¼Œ
 * å†æ›ç®—å›žæ–°çš„æ¯”ä¾‹ï¼Œæœ€å¾Œå¤¾å›žç¯„åœå…§ã€‚
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
 * æŠŠåœ–ç‰‡ç•«é€²å¤–æ¡†è£¡ã€‚
 *
 * **é è¨­ä¸æ”¾å¤§**ï¼ˆimgShapeZoom æ²’è¨­å°±æ˜¯ 1ï¼‰â€”â€” é¸äº†å½¢ç‹€ä¹‹å¾Œåœ–ç‰‡çš„å¤§å°ã€
 * çœ‹åˆ°çš„ç¯„åœéƒ½è·ŸåŽŸæœ¬ä¸€æ¨¡ä¸€æ¨£ï¼Œåªæ˜¯è¢«è£æˆé‚£å€‹å½¢ç‹€è€Œå·²ã€‚è¦æ”¾å¤§æ˜¯ä½¿ç”¨è€…
 * è‡ªå·±å…©æŒ‡æå‡ºä¾†çš„ï¼Œä¸æ˜¯æˆ‘å€‘å·å·å¹«ä»–æ”¾å¤§ã€‚
 *
 * å€çŽ‡ 1ã€æ²’æœ‰ä½ç§»æ™‚ï¼Œé€™ä¸€è¡Œç­‰åŒæ–¼åŽŸæœ¬çš„ drawImage(base, x, y, w, h)ã€‚
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

/** å–®æ¬¡ç›’ç‹€æ¨¡ç³Šï¼ˆæ»‘å‹•è¦–çª—ï¼Œé‚Šç•Œå¤¾ä½ï¼‰ã€‚ä¸‰æ¬¡ç–Šèµ·ä¾†å°±å¾ˆæŽ¥è¿‘é«˜æ–¯ã€‚ */
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
 * ç”¢ç”Ÿä¸€å¼µé®ç½©ï¼ˆç™½è‰²ã€alpha å°±æ˜¯å¯è¦‹åº¦ï¼‰ã€‚
 * radiusPct æ˜¯åœ“è§’ï¼Œä½”çŸ­é‚Šçš„ç™¾åˆ†æ¯” 0~50ã€‚
 *
 * featherPctï¼ˆ0~100ï¼‰ï¼ ç¾½åŒ–è¦å¾žåœ–ç‰‡é‚Šç·£å¾€ä¸­å¿ƒèµ°å¤šé ï¼š
 *    0 ï¼ ä¸ç¾½åŒ–ï¼Œé‚Šç·£æ˜¯ç¡¬çš„
 *   50 ï¼ æ·¡å‡ºå¸¶ä½”çŸ­é‚Šçš„å››åˆ†ä¹‹ä¸€ï¼ˆé‚Šç·£èµ°åˆ°ã€Œé‚Šç·£èˆ‡ä¸­å¿ƒçš„æ­£ä¸­é–“ã€ï¼‰
 *  100 ï¼ æ·¡å‡ºå¸¶ä¸€è·¯èµ°åˆ°åœ–ç‰‡ä¸­å¿ƒï¼Œæ•´å¼µåœ–éƒ½åœ¨æ¼¸å±¤è£¡
 * ä¸ç®¡èª¿å¤šå°‘ï¼Œæœ€å¤–ç·£ä¸€å®šæ˜¯å®Œå…¨é€æ˜Žã€å¸¶å­çš„å…§å´ä¸€å®šæ˜¯å®Œå…¨ä¸é€æ˜Žã€‚
 */
export const makeShapeMask = (
  w: number, h: number, radiusPct: number, featherPct: number,
  /** åœ–ç‰‡çš„å¤–å½¢ã€‚æ²’çµ¦å°±æ˜¯åŽŸæœ¬çš„åœ“è§’çŸ©å½¢ */
  kind?: string,
) => {
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(w));
  c.height = Math.max(4, Math.round(h));
  const g = c.getContext('2d')!;
  const fp = Math.max(0, Math.min(100, featherPct));
  const rp = Math.max(0, Math.min(50, radiusPct));
  /* æ·¡å‡ºå¸¶è¦å¤šå¯¬ã€‚
     ä»¥ã€ŒçŸ­é‚Šçš„ä¸€åŠã€ç•¶æ»¿åˆ†ï¼šfp = 100 æ™‚å¸¶å¯¬å°±æ˜¯çŸ­é‚Šçš„ä¸€åŠï¼Œ
     ä¹Ÿå°±æ˜¯å¾žé‚Šç·£ä¸€è·¯æ·¡åˆ°åœ–ç‰‡ä¸­å¿ƒã€‚

     æ¨¡ç³Šæ˜¯ä¸‰æ¬¡ç›’ç‹€æ¨¡ç³Šï¼šåŠå¾‘ r ç–Šä¸‰æ¬¡æœƒæŠŠä¸€æ¢ç¡¬é‚ŠæŠ¹é–‹åˆ° Â±3rï¼Œ
     æ‰€ä»¥å¸¶å¯¬ = 2 Ã— 3rï¼›å½¢ç‹€å†å¾€å…§ç¸® 3rï¼Œæœ€å¤–ç·£æ‰æœƒå‰›å¥½æ”¶æ–‚åˆ° 0ã€‚
     åæŽ¨å°±æ˜¯ r = å¸¶å¯¬ / 6ã€‚ */
  const half = Math.min(c.width, c.height) / 2;
  /* æ»‘æ¡¿çš„æ•¸å­—ï¼ã€Œæ·¡å‡ºå¸¶å¾žé‚Šç·£å¾€å…§èµ°å¤šå°‘ã€ï¼Œç›´æŽ¥å°æ‡‰ã€ä¸åŠ ä»»ä½•æ›²ç·šï¼š
       10  â†’ èµ°åˆ°ã€Œé‚Šç·£åˆ°ä¸­å¿ƒã€çš„ 10%
       50  â†’ èµ°ä¸€åŠ
       100 â†’ ä¸€è·¯èµ°åˆ°ä¸­å¿ƒ
     é€™æ¨£æ»‘æ¡¿ä¸Šçœ‹åˆ°çš„æ•¸å­—å°±æ˜¯å¯¦éš›çš„æ•ˆæžœï¼Œèª¿èµ·ä¾†å¿ƒè£¡æœ‰åº•ã€‚ */
  const bandW = (fp / 100) * half;
  const r = fp > 0 ? Math.max(1, Math.round(bandW / 6)) : 0;
  // è®“å‡º 3rï¼ˆ+1 æ˜¯å› ç‚ºé›¢æ•£çš„ç›’ç‹€æ¨¡ç³Šåœ¨é‚Šç•Œé‚„æœƒç•™ä¸€é»žé»žï¼‰
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
      // RGB å…¨éƒ¨å¡«ç™½ï¼Œé€™æ¨£ä¸ç®¡é®ç½©è¢«ç•¶æˆ alpha é‚„æ˜¯äº®åº¦éƒ½æˆç«‹
      px.data[i * 4] = 255; px.data[i * 4 + 1] = 255; px.data[i * 4 + 2] = 255;
      px.data[i * 4 + 3] = a[i];
    }
    g.putImageData(px, 0, 0);
  }
  return c;
};

/** æ–°å¢žæ–‡å­—æ™‚çš„é è¨­å…§å®¹ï¼›é»žé€²åŽ»æ‰“å­—æœƒè‡ªå‹•æ¸…æŽ‰ï¼Œæ²’æ‰“æ±è¥¿å†æ”¾å›žä¾† */
const TEXT_PLACEHOLDER = 'è¼¸å…¥æ–‡å­—';

/**
 * æŠŠé¡è‰²å¾€é»‘è‰²å£“ä¸€é»žï¼Œåšå‡ºã€Œä¸é€æ˜Žã€çš„æŽ¥ç¸«é¡è‰²ã€‚
 * æŽ’é é¢æ™‚æŽ¥ç¸«ä¸€å®šè¦ä¸é€æ˜Žï¼šåŠé€æ˜Žçš„è©±ï¼Œåº•ä¸‹çš„æ·±è‰²å·¥ä½œå€æœƒå¾žæ¬¡åƒç´ çš„ç¸«è£¡
 * é€å‡ºä¾†ï¼Œé€å¤šå°‘å®Œå…¨çœ‹é‚£æ¢ç¸«å‰›å¥½è½åœ¨åƒç´ æ ¼çš„å“ªå€‹ä½ç½® â€”â€” æ¯æ¢çš„æ·±æ·ºå°±ä¸ä¸€æ¨£ã€‚
 */
const shadeHex = (hex: string | undefined, amount: number) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || '').trim());
  if (!m) return hex || '#ffffff';
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};

/** å·¥ä½œå€çš„åº•è‰²ã€‚ä¸€èˆ¬æ¨¡å¼ä¸‹é èˆ‡é ä¹‹é–“éœ²å‡ºä¾†çš„å°±æ˜¯å®ƒã€‚ */
const WORKSPACE_BG = '#070707';
/**
 * é èˆ‡é ä¹‹é–“é‚£æ¢åˆ†éš”ç·šã€‚
 *
 * ä¸€èˆ¬æ¨¡å¼æ˜¯ 1px çš„ bg-black/15ï¼Œè€Œå®ƒåº•ä¸‹æ˜¯å·¥ä½œå€çš„æ·±è‰² â€”â€” æ‰€ä»¥çœ‹åˆ°çš„å…¶å¯¦æ˜¯
 * ä¸€æ¢**æ·±è‰²**ç´°ç·šï¼ˆ#070707 å†å£“æ·± 15%ï¼‰ï¼Œä¸æ˜¯ç°ç·šã€‚
 *
 * æŽ’é é¢æ™‚è·Ÿè‘—æ•´æŽ’ä¸€èµ·ç­‰æ¯”ä¾‹ç¸®å°ï¼ˆ1px â†’ 0.4pxï¼‰ï¼Œåªæœ‰é¡è‰²æ”¹æˆã€Œä¸é€æ˜Žã€çš„
 * åŒä¸€å€‹æ·±è‰²ï¼šåŠé€æ˜Žçš„è©±ï¼Œç›¸é„°å…©é å„è‡ªåšæ¬¡åƒç´ æŠ—é‹¸é½’ï¼Œåº•ä¸‹é€å‡ºä¾†å¤šå°‘æœƒçœ‹
 * é‚£æ¢ç¸«å‰›å¥½è½åœ¨åƒç´ æ ¼çš„å“ª â€”â€” æ¯æ¢æ·±æ·ºå°±ä¸ä¸€æ¨£äº†ã€‚ä¸é€æ˜Žä¹‹å¾Œï¼Œä¸ç®¡è½åœ¨å“ª
 * ä¸€æ ¼ï¼Œç•«å‡ºä¾†çš„å¢¨æ°´é‡éƒ½å›ºå®šæ˜¯ã€Œ0.4px Ã— é€™å€‹æ·±è‰²ã€ã€‚
 */
const PAGE_SEAM_INK = 0.15;

/** ç™¼å…‰çš„å–®ä½æ¨¡ç³Šï¼šè·Ÿæ–‡å­—ä¸€æ¨£æ˜¯ (å¼·åº¦/20) Ã— 14ï¼Œå†ç–Š Ã—1ã€Ã—2ã€Ã—3 ä¸‰å±¤ */
export const GLOW_BLUR_UNIT = 14;
/** ä¸‰å±¤è£¡æœ€å¯¬çš„é‚£å±¤æ˜¯ 1.5 å€‹å–®ä½ï¼Œæ•£åˆ° 3.2Ïƒ å°±çœ‹ä¸è¦‹äº† â†’ å–®ä½çš„ 4.8 å€ */
export const GLOW_EXTENT = 4.8;

/** erfc è¿‘ä¼¼ï¼ˆAbramowitz & Stegun 7.1.26ï¼Œèª¤å·® < 1.5e-7ï¼‰ï¼Œåªç”¨åœ¨ x â‰¥ 0 */
const erfc = (x: number) => {
  const t = 1 / (1 + 0.3275911 * x);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741
    + t * (-1.453152027 + t * 1.061405429))));
  return y * Math.exp(-x * x);
};

/**
 * å…‰æšˆï¼šè·Ÿæ–‡å­—çš„ç™¼å…‰åŒä¸€å¥— â€”â€” åŒä¸€å€‹å½¢ç‹€ç–Šä¸‰å±¤é™°å½±ï¼Œ
 * æ¨¡ç³ŠåŠå¾‘æ˜¯ã€Œå–®ä½ Ã—1ã€Ã—2ã€Ã—3ã€ï¼Œæ‰€ä»¥è²¼è‘—é‚Šå¾ˆäº®ã€å¾€å¤–æ‹–ä¸€æ¢é•·é•·çš„æ·¡å°¾å·´ã€‚
 *
 * æ–‡å­—æ˜¯ç›´æŽ¥è®“ canvas ç•«ä¸‰æ¬¡ shadowã€‚ä½†å°ä¸€å¼µçŸ©å½¢ç…§ç‰‡é€™æ¨£åšï¼Œ
 * å››å€‹è§’åªæœƒè¢«å…©å€‹æ–¹å‘å„ç…§åˆ°ä¸€åŠï¼Œæ¿ƒåº¦å¤©ç”Ÿæ˜¯é‚Šçš„ä¸€åŠï¼ˆè§’è½çš„å…‰æ¯”è¼ƒå°‘ï¼‰ã€‚
 * æ‰€ä»¥é€™è£¡æ”¹æˆï¼šå…ˆç®—æ¯ä¸€æ ¼ã€Œé›¢è¼ªå»“å¤šé ã€ï¼Œå†ç”¨ä¸‰å±¤é«˜æ–¯ç–Šèµ·ä¾†çš„äº®åº¦å…¬å¼
 * 1 âˆ’ Î (1 âˆ’ erfc(d/Ïƒâˆš2)/2) åŽ»æ›ç®—ï¼ˆcanvas çš„ shadowBlur b ç›¸ç•¶æ–¼ Ïƒ = b/2ï¼‰ã€‚
 * ç›´é‚Šä¸Šç®—å‡ºä¾†çš„æ¿ƒæ·¡è·Ÿæ–‡å­—é‚£ä¸‰å±¤ä¸€æ¨¡ä¸€æ¨£ï¼Œè€Œè·é›¢è·Ÿæ–¹å‘ç„¡é—œï¼Œ
 * å››å€‹è§’å°±è‡ªç„¶è·Ÿé‚Šä¸€æ¨£æ¿ƒã€‚
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
  // ä¸‰å±¤çš„ Ïƒï¼šshadowBlur = unit Ã— kï¼Œè€Œ shadowBlur b ç›¸ç•¶æ–¼ Ïƒ = b/2
  const sigma = [1, 2, 3].map(k => (unit * k) / 2);
  const extent = unit * GLOW_EXTENT;

  // è·é›¢å ´ï¼ˆå…©æ¬¡æŽƒæçš„ chamfer è¿‘ä¼¼ï¼‰ï¼šåœ–ç‰‡è£¡é¢æ˜¯ 0ï¼Œå¤–é¢æ˜¯é›¢è¼ªå»“çš„è·é›¢
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

  // è·é›¢ â†’ äº®åº¦ï¼šä¸‰å±¤é«˜æ–¯ç–Šèµ·ä¾†ï¼ˆè·Ÿæ–‡å­—ç–Šä¸‰å±¤ shadow çš„çµæžœç›¸åŒï¼‰ã€‚
  // æ¯ 0.5px å»ºä¸€æ¬¡æŸ¥è¡¨ï¼ŒçœæŽ‰æ¯å€‹åƒç´ ç®—ä¸‰æ¬¡ erfcã€‚
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
  // è·é›¢æ˜¯ä¸€æ ¼ä¸€æ ¼ç®—å‡ºä¾†çš„ï¼Œè£œä¸€æ¬¡å°æ¨¡ç³ŠæŠŠ chamfer çš„ç¨œè§’ç£¨å¹³
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
 * é è¦½ç”¨çš„é®ç½©ã€‚åªä¾ã€Œé•·å¯¬æ¯” + åœ“è§’ + ç¾½åŒ–ã€å¿«å–ï¼Œç¸®æ”¾åœ–ç‰‡æ™‚ä¸ç”¨é‡ç®—ï¼›
 * é®ç½©æœ¬ä¾†å°±æ˜¯å¹³æ»‘çš„ï¼Œæ‹‰ä¼¸è²¼ä¸Šçœ‹ä¸å‡ºå·®åˆ¥ã€‚
 */
const maskCanvasCache = new Map<string, HTMLCanvasElement>();
const previewMask = (aspect: number, radiusPct: number, featherPct: number, kind?: string) => {
  const key = `${aspect.toFixed(2)}|${radiusPct}|${featherPct}|${kind || ''}`;
  const hit = maskCanvasCache.get(key);
  if (hit) return hit;
  /* æœ‰ç¾½åŒ–çš„é®ç½©ç”¨æ¯”è¼ƒå°çš„é‚Šé•·ã€‚
     é€™ä¸€å¼µçš„æˆæœ¬å¹¾ä¹Žå…¨åœ¨ã€Œæ¨¡ç³Šã€é‚£ä¸€æ­¥ï¼Œè€Œæ¨¡ç³Šæ˜¯éš¨é¢ç©æˆé•·çš„ â€”â€”
     å¯¦æ¸¬ 400Ã—267 è¦ 13.6 æ¯«ç§’ã€240Ã—160 åªè¦ 4.2 æ¯«ç§’ï¼ˆPNG ç·¨ç¢¼æœ¬èº«
     åªæœ‰ 0.6 æ¯«ç§’ï¼Œå› ç‚ºé€™å¼µåœ–å°±æ˜¯ä¸€ç‰‡å¹³æ»‘çš„æ¼¸å±¤ã€å£“å®Œæ‰ 4KBï¼‰ã€‚
     æ‹–ç¾½åŒ–æ»‘æ¡¿æ™‚æ¯æ›ä¸€å€‹æ•¸å­—å°±è¦åšä¸€æ¬¡ï¼Œé‚£ 13.6 æ¯«ç§’æ­£æ˜¯ã€Œå¾ˆå¡ã€ã€‚
     ç¾½åŒ–æœ¬ä¾†å°±æ˜¯ä¸€ç‰‡å¹³æ»‘çš„éŽæ¸¡ï¼Œæ”¾å¤§è²¼ä¸Šçœ‹ä¸å‡ºä»»ä½•å·®åˆ¥ï¼›
     æ²’æœ‰ç¾½åŒ–çš„ï¼ˆç´”å¤–å½¢ï¼åœ“è§’ï¼‰é‚Šç·£æ˜¯ç¡¬çš„ï¼Œç¶­æŒ 400 ä¸å‹•ã€‚
     âš  åŒ¯å‡ºèµ°çš„æ˜¯å¦ä¸€æ¢å…¨è§£æžåº¦çš„è·¯ï¼ˆmakeShapeMaskï¼‰ï¼Œæˆå“ä¸€å€‹åƒç´ éƒ½æ²’è®Šã€‚ */
  const MAX = featherPct > 0 ? 240 : 400;
  const w = aspect >= 1 ? MAX : Math.max(16, Math.round(MAX * aspect));
  const h = aspect >= 1 ? Math.max(16, Math.round(MAX / aspect)) : MAX;
  const c = makeShapeMask(w, h, radiusPct, featherPct, kind);
  if (maskCanvasCache.size > 60) maskCanvasCache.clear();
  maskCanvasCache.set(key, c);
  return c;
};

/**
 * ä¸€å€‹åœ–å±¤ã€Œçœ‹å¾—åˆ°çš„é‚£ä¸€å¡Šå½¢ç‹€ã€ï¼Œæ›æˆ CSS è¬›å¾—å‡ºä¾†çš„æ±è¥¿ã€‚
 *
 * å–®ç´”åœ“è§’ â†’ border-radiusã€‚å€¼å°±æ˜¯ cornerRï¼ˆ(æ¯”ä¾‹/100)Ã—çŸ­é‚Šï¼‰ï¼Œè·ŸåŒ¯å‡ºä¸€æ¨¡ä¸€æ¨£ï¼Œ
 *   è€Œä¸”åˆæˆå™¨ç›´æŽ¥ç•«ï¼Œ**ä¸ç”¨è§£ç¢¼ä»»ä½•åœ–** â€”â€” æ‹–åœ“è§’æ»‘æ¡¿å› æ­¤ä¸æœƒé–ƒã€‚
 * ç¾½åŒ–æˆ–éžçŸ©å½¢çš„å¤–å½¢ â†’ é®ç½©åœ–ï¼Œä¾†æºæ˜¯è·ŸåŒ¯å‡ºåŒä¸€æ”¯ makeShapeMaskã€‚
 *
 * å½±ç‰‡åœ–å±¤èˆ‡ã€Œæ‹–æ›³äº’æ›æ™‚é‚£å±¤è®Šæš—ã€ç”¨çš„æ˜¯é€™åŒä¸€æ”¯ï¼Œæ‰€ä»¥æš—ä¸‹åŽ»çš„å½¢ç‹€
 * ä¸€å®šè·Ÿåœ–å±¤ç¾åœ¨çš„å½¢ç‹€ä¸€è‡´ã€‚
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
  /* ç¶²å€ç…§ã€Œé•·å¯¬æ¯”ï¼‹åœ“è§’ï¼‹ç¾½åŒ–ï¼‹å¤–å½¢ã€å¿«å–ï¼šå…©é‚Šæ‹¿åˆ°çš„æ˜¯åŒä¸€å€‹å­—ä¸²ï¼Œ
     ç€è¦½å™¨ä¹Ÿå°±åªè§£ç¢¼ä¸€æ¬¡ã€‚ */
  /* åœ“è§’èˆ‡ç¾½åŒ–å¸åˆ° 2% çš„æ ¼å­ä¸Šã€‚
     æ‹–ç¾½åŒ–æ»‘æ¡¿æ™‚æ¯ä¸€æ ¼éƒ½æ˜¯ä¸€å€‹æ–°æ•¸å­—ï¼Œè€Œæ¯ä¸€å€‹æ–°æ•¸å­—éƒ½è¦é‡æ–°ç·¨ä¸€å¼µ PNG
     ï¼ˆtoDataURLï¼‰å†è§£ç¢¼ä¸€æ¬¡ â€”â€” å¯¦æ¸¬æ‹–æ›³ä¸­æŽ‰åˆ° 40 æ ¼ã€‚å¸åˆ° 2% ä¹‹å¾Œï¼Œ
     æ•´æ®µ 0â†’100 æœ€å¤šåªæœƒç·¨ 50 å¼µï¼Œè€Œä¸”ä¾†å›žæ‹–æ™‚å…¨éƒ¨å‘½ä¸­å¿«å–ã€‚
     1% çš„å·®åˆ¥è‚‰çœ¼çœ‹ä¸å‡ºä¾†ï¼Œ**åŒ¯å‡ºç”¨çš„ä»ç„¶æ˜¯åŽŸå§‹æ•¸å€¼**ï¼Œæˆå“ä¸€é»žéƒ½æ²’è®Šã€‚ */
  const q = (v: number) => Math.round(v / 2) * 2;
  const ar = boxW / boxH;
  const qr = q(radiusPct), qf = q(featherPct);
  const key = `${ar.toFixed(2)}|${qr}|${qf}|${kind || ''}`;
  let url = maskUrlCache.get(key);
  if (!url) {
    url = buildMaskUrl(ar, qr, qf, kind);
    /* æ…¢æ…¢æ‹–çš„æ™‚å€™ï¼Œä¸‹ä¸€å€‹å€¼å¹¾ä¹Žä¸€å®šæ˜¯ç¾åœ¨é€™å€‹ Â±2ã€‚
       è¶ç©ºæª”å…ˆæŠŠå·¦å³å„å…©æ ¼åšå¥½æ”¾é€²å¿«å–ï¼Œæ‰‹æŒ‡ç§»éŽåŽ»å°±å®Œå…¨ä¸ç”¨å†åšä¸€å¼µ â€”â€”
       å¯¦æ¸¬ä¸€å¼µè¦ 4~14 æ¯«ç§’ï¼Œé‚£æ­£æ˜¯ã€Œæ‹–èµ·ä¾†ä¸€é “ä¸€é “ã€çš„ä¾†æºã€‚ */
    if (featherPct > 0) warmMasks(ar, qr, qf, kind);
  }
  return { needMaskImg: true, cssRadius: undefined, maskUrl: url };
};

/** åšä¸€å¼µé®ç½©ç¶²å€ï¼ˆå¤±æ•—å°±å›žç©ºå­—ä¸²ï¼Œå‘¼å«ç«¯æœƒç•¶æˆã€Œé€™ä¸€æ ¼å…ˆä¸å¥—é®ç½©ã€ï¼‰ */
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

/* é ç†±ï¼šæŠŠã€Œç¾åœ¨é€™å€‹ç¾½åŒ–å€¼çš„å·¦å³å„å…©æ ¼ã€åœ¨ç©ºæª”æ™‚å…ˆåšå¥½ã€‚
   ä¸€æ¬¡åªåšä¸€å¼µï¼Œè€Œä¸”æ˜¯åœ¨ requestIdleCallback è£¡åš â€”â€” æœ‰åˆ¥çš„äº‹è¦å¿™å°±è®“é–‹ï¼Œ
   çµ•å°ä¸æœƒè·Ÿç•«é¢æ¶æ™‚é–“ã€‚ */
const maskWarmQueue: [number, number, number, string | undefined][] = [];
let maskWarmScheduled = false;
const runMaskWarm = () => {
  maskWarmScheduled = false;
  const job = maskWarmQueue.shift();
  if (job) {
    const [ar, r, f, k] = job;
    const u = buildMaskUrl(ar, r, f, k);
    // é †æ‰‹è§£ç¢¼å¥½ï¼ŒçœŸçš„æ›ä¸ŠåŽ»æ™‚å°±ä¸ç”¨å†ç­‰
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

/* â”€â”€ æ¿¾é¡ï¼ç‰¹æ•ˆæŒ‰éˆ•çš„ç¸®åœ– â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   è·Ÿã€Œç·¨è¼¯ã€é‚£é‚ŠåŒä¸€å€‹åšæ³•ï¼šç›´æŽ¥ç•«åœ¨ canvas ä¸Šï¼ˆä¸è½‰ data URLï¼Œ
   çœæŽ‰ PNG ç·¨ç¢¼èˆ‡è§£ç¢¼é‚£ä¸€æ®µï¼ŒæŒ‰éˆ•æ‰æœƒé¦¬ä¸Šæœ‰åœ–ï¼‰ã€‚
   ç®—å¥½çš„ç•™åœ¨æ¨¡çµ„å±¤ï¼Œæ›åˆ†é ã€æ›åœ–å±¤éƒ½ä¸ç”¨é‡ç®—ã€‚ */
const CARD_W = 64, CARD_H = 76;
/** ç¸®åœ–ç”¨çš„å¯¦éš›åƒç´ å¯†åº¦ï¼Œ2ï½ž3 ä¹‹é–“ â€”â€” å¤ªä½Žæœƒç³Šï¼Œå¤ªé«˜åªæ˜¯ç™½ç®— */
const CARD_DPR = Math.max(2, Math.min(3, Math.round(typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2)));
const cardThumbCache = new Map<string, HTMLCanvasElement>();

/** é€™ä¸€æ ¼ç¸®åœ–ï¼šæŠŠä¾†æºç¸®æˆå¡ç‰‡å¤§å°ä¹‹å¾Œæ‰å¥—æ•ˆæžœï¼Œæ‰€ä»¥å¾ˆå¿« */
const makeCardThumb = (img: HTMLImageElement, fx: PhotoFx): HTMLCanvasElement | null => {
  if (!img.naturalWidth) return null;
  const w = CARD_W * CARD_DPR, h = CARD_H * CARD_DPR;
  // å…ˆç­‰æ¯”ä¾‹å¡«æ»¿å¡ç‰‡ï¼ˆobject-coverï¼‰ï¼Œå†æŠŠæ•ˆæžœå¥—åœ¨é€™å¼µå°åœ–ä¸Š
  const cut = document.createElement('canvas');
  cut.width = w; cut.height = h;
  const cctx = cut.getContext('2d')!;
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  cctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return applyPhotoFx(cut, w, h, fx);
};

/** æ¿¾é¡ï¼ç‰¹æ•ˆå¡ç‰‡ä¸Šçš„é‚£å¼µç¸®åœ–ã€‚ç®—å¥½ä¹‹å‰å…ˆç•«åº•åœ–ï¼Œä¸æœƒæœ‰ç©ºæ´žã€‚ */
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
    // ä¸€æ¬¡ç®— 20 å¹¾å¼µæœƒå¡ä½ä¸»åŸ·è¡Œç·’ï¼ŒéŒ¯é–‹ä¸€é»žé»žå°±é †äº†
    const t = setTimeout(paint, delay);
    return () => { dead = true; clearTimeout(t); };
  }, [src, cacheKey, delay]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full object-cover" />;
};

/** é è¦½é‡ç•«æ™‚è¦é¦¬ä¸Šæœ‰åœ–å¯ä»¥ç•«ï¼Œæ‰€ä»¥åŽŸåœ–è¼‰éŽä¸€æ¬¡å°±ç•™è‘—ã€‚ */
const previewImgCache = new Map<string, HTMLImageElement>();
/**
 * ä½ˆå±€æ ¼å­çš„ç…§ç‰‡ã€‚æ²’æœ‰å¥—æ¿¾é¡å°±æ˜¯åŽŸæœ¬é‚£å¼µ <img>ï¼ˆå®Œå…¨ä¸è®Šï¼‰ï¼›
 * å¥—äº†å°±æ›æˆ canvasï¼Œç”¨è·Ÿæµ®å‹•åœ–ç‰‡åŒä¸€æ”¯ applyPhotoFx ç®—ï¼Œ
 * å¤–å±¤çš„è£åˆ‡ã€ç¸®æ”¾ã€ä½ç§»é‚è¼¯éƒ½ä¸å‹•ã€‚
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
      // ç®—åˆ°ã€Œç•«é¢ä¸ŠçœŸçš„æœ‰å¹¾å€‹å¯¦é«”åƒç´ ã€ï¼Œå¥—äº†æ¿¾é¡æ‰ä¸æœƒè®Šç³Š
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
  /** åœ–ç‰‡ï¼åœ–å½¢é€æ˜Žåº¦ï¼Œ0ï½ž100ï¼›èˆŠå°ˆæ¡ˆæœªè¨­å®šæ™‚è¦–ç‚º 100ã€‚ */
  opacity?: number;
  /** æœ‰ text å°±æ˜¯æ–‡å­—åœ–å±¤ã€‚ä½ç½®ã€ç¸®æ”¾ã€æ—‹è½‰ã€åœ–å±¤é †åºå…¨éƒ¨æ²¿ç”¨åœ–ç‰‡é‚£ä¸€å¥—ã€‚ */
  text?: string;
  /**
   * æœ‰å€¼å°±ä»£è¡¨é€™ä¸€å±¤æ˜¯ã€Œç¬¦è™Ÿã€è€Œä¸æ˜¯ä¸€èˆ¬æ–‡å­—ï¼Œå…§å®¹æ˜¯åŠ é€²ä¾†æ™‚æŒ‘çš„é‚£ä¸€é¡†ã€‚
   * å…©å€‹ç”¨é€”ï¼šâ‘  é¢æ¿è¦æ›æˆç¬¦è™Ÿé‚£ä¸€çµ„ï¼ˆé¡è‰²ã€å¤§å°ã€ç™¼å…‰ï¼‰ï¼›
   * â‘¡ åœ¨ç•«å¸ƒä¸ŠæŠŠå­—å…¨éƒ¨åˆªå…‰æ™‚ï¼Œæ”¾å›žåŽ»çš„æ˜¯é€™é¡†ç¬¦è™Ÿæœ¬èº«ï¼Œ
   *    è€Œä¸æ˜¯æ–‡å­—ç”¨çš„ã€Œè¼¸å…¥æ–‡å­—ã€ã€‚
   */
  sym?: string;
  fontFamily?: string;
  /** æœªç¸®æ”¾ç‹€æ…‹ä¸‹çš„å­—ç´šï¼ˆpxï¼‰ï¼Œå¯¦éš›å¤§å°å†ä¹˜ä¸Š scale */
  fontSize?: number;
  /** å››é‚Šæ“ å£“æ–‡å­—æ™‚çš„åŽŸå§‹æŽ’ç‰ˆç›’ï¼›å­—ç´šä¸è®Šï¼Œåªæ”¹å…©è»¸å¹¾ä½•æ¯”ä¾‹ã€‚ */
  textStretchBaseW?: number;
  textStretchBaseH?: number;
  color?: string;
  bold?: boolean;
  /** æ–œé«”ã€‚åªæœ‰è©²å­—é«”çœŸçš„æœ‰æ–œé«”å­—èº«æ™‚æ‰æœƒè¢«æ‰“é–‹ */
  italic?: boolean;
  /** å­—è·ï¼ˆpxï¼Œæœªç¸®æ”¾ï¼‰ */
  letterSpacing?: number;
  /** é‚Šç·£ç™¼å…‰å¼·åº¦ 0~20ï¼Œ0 = é—œé–‰ */
  glow?: number;
  glowColor?: string;
  /** æ–‡å­—æé‚Šå¯¬åº¦ï¼ˆpxï¼Œæœªç¸®æ”¾ï¼‰ï¼Œ0 = ä¸æé‚Š */
  strokeWidth?: number;
  strokeColor?: string;
  /** ä»¥ä¸‹æ˜¯ã€Œåœ–ç‰‡èª¿æ•´ã€åˆ†é çš„åƒæ•¸ï¼Œåªæœ‰åœ–ç‰‡åœ–å±¤æœƒç”¨åˆ° */
  /** åœ“è§’ï¼Œä½”çŸ­é‚Šçš„ç™¾åˆ†æ¯” 0~50ï¼ˆ50 = æ©¢åœ“ï¼‰ */
  imgRadius?: number;
  /* â”€â”€ åœ–ç‰‡å¤–å½¢ï¼ˆå½¢ç‹€ï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     æ²’æœ‰é€™å€‹æ¬„ä½ï¼åŽŸæœ¬çš„æ–¹å½¢ï¼ˆé…ä¸Šé¢é‚£æ ¹åœ“è§’æ»‘æ¡¿ï¼‰ï¼Œè¡Œç‚ºå®Œå…¨ä¸è®Šã€‚
     è¨­æˆ circleï¼starï¼heart å°±æ”¹ç”¨ã€Œæ–°å¢žåœ–å½¢ã€é‚£ä»½è·¯å¾‘åŽ»è£ï¼Œ
     æé‚Šèˆ‡ç™¼å…‰ä¹Ÿæœƒè·Ÿè‘—åŒä¸€æ¢è·¯å¾‘èµ°ã€‚ */
  imgShape?: string;
  /** åœ–ç‰‡åœ¨å½¢ç‹€è£¡çš„ä½ç§»ï¼Œ-1~1ï¼ˆ0ï¼ç½®ä¸­ï¼‰ã€‚åªæœ‰é¸äº†å½¢ç‹€æ‰ç”¨å¾—åˆ° */
  imgShapeX?: number;
  imgShapeY?: number;
  /** åœ–ç‰‡åœ¨å½¢ç‹€è£¡çš„æ”¾å¤§å€çŽ‡ï¼Œ1~5ï¼ˆ1ï¼åŽŸå¤§å°ï¼Œä¹Ÿæ˜¯é è¨­ï¼‰ */
  imgShapeZoom?: number;
  /** é‚Šç·£ç¾½åŒ–ï¼Œä½”çŸ­é‚Šçš„ç™¾åˆ†æ¯” 0~50 */
  feather?: number;
  /** åœ–ç‰‡é‚Šç·£ç™¼å…‰å¼·åº¦ 0~20 */
  /** é€™ä¸€å±¤æ˜¯å½±ç‰‡ï¼ˆé è¦½ç”¨ <video> æ’­ã€åŒ¯å‡ºå–ç•¶ä¸‹é‚£ä¸€æ ¼ï¼‰ */
  isVideo?: boolean;
  imgGlow?: number;
  imgGlowColor?: string;
  /** æ¿¾é¡èˆ‡èª¿ç¯€ï¼Œè·Ÿã€Œç·¨è¼¯ã€å…±ç”¨åŒä¸€å¥—åƒç´ ç®¡ç·š */
  fx?: PhotoFx;
  /** åœ–ç‰‡æé‚Šï¼ˆç›¸æ¡†ç·šï¼‰å¯¬åº¦ pxï¼ˆæœªç¸®æ”¾ï¼‰èˆ‡é¡è‰² */
  imgStrokeWidth?: number;
  imgStrokeColor?: string;
  /** æé‚Šçš„è™›ç·šé•·åº¦ï¼ˆ0ï¼å¯¦ç·šï¼Œ1~100 æ˜¯ã€Œä¸€æ®µæœ‰å¹¾å€ç·šå¯¬ã€çš„æ¯”ä¾‹ï¼‰ */
  imgStrokeDash?: number;
  /** æé‚Šèˆ‡åœ–ç‰‡è¼ªå»“ä¹‹é–“çš„è·é›¢ pxï¼ˆæœªç¸®æ”¾ï¼‰ï¼Œä»‹é¢ä»¥ 0ï½ž100 å°æ‡‰ 0ï½ž10ã€‚ */
  imgStrokeGap?: number;
  /** æ§‹åœ–ï¼ˆè£åˆ‡ï¼æ—‹è½‰ï¼ç¿»è½‰ï¼‰ï¼šbaked ä¹‹å‰çš„åŽŸåœ–èˆ‡åƒæ•¸ï¼Œé‡é–‹æ§‹åœ–æ™‚å¾žé€™è£¡æŽ¥çºŒ */
  origSrc?: string;
  geo?: GeoParams;
  /* â”€â”€ åœ–å½¢åœ–å±¤ï¼ˆæ–°å¢žåœ–å½¢ï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     æœ‰ shape å°±æ˜¯åœ–å½¢å±¤ï¼šæ²’æœ‰ç…§ç‰‡ã€æ²’æœ‰æ–‡å­—ï¼Œå…§å®¹å°±æ˜¯ä¸€æ¢è·¯å¾‘ã€‚
     é¡è‰²æ²¿ç”¨ä¸Šé¢çš„ colorï¼ˆè·Ÿæ–‡å­—åŒä¸€å€‹æ¬„ä½ï¼Œè‰²ç¥¨ä¹Ÿæ˜¯åŒä¸€çµ„ï¼‰ã€‚ */
  shape?: string;
  /** æ–°å¢žé¢æ¿ä¸­çš„ä¾†æºé …ç›®ï¼›èˆŠè‰ç¨¿ä»å¯ç”± shapeï¼filledï¼holeType åˆ¤æ–· */
  shapeItemId?: string;
  /** å¯¦å¿ƒï¼ˆå¡«è‰²ï¼‰é‚„æ˜¯ç´°æ¡†ï¼ˆåªæé‚Šï¼‰ */
  shapeFilled?: boolean;
  /** shape === 'hole' æ™‚ï¼ŒçœŸæ­£è¦ç•«å“ªä¸€é¡†åœ–æ¡ˆï¼ˆè·Ÿå‰µæ„æ‹¼åœ–åŒä¸€ä»½æ¸…å–®ï¼‰ */
  holeType?: string;
  /** ç·šå¯¬ï¼Œ1 å€‹å–®ä½ = å¤–æ¡†é•·é‚Šçš„ 1/160ï¼ˆæ»‘æ¡¿é¡¯ç¤ºæˆ 1~100ï¼Œå­˜é€²ä¾†æ˜¯ Ã·10ï¼‰ */
  shapeLineW?: number;
  /** æ–°å¢žï¼é¦–æ¬¡æŒ¤åŽ‹æ—¶çš„çº¿å®½åŸºå‡†ï¼ŒæŒ¤åŽ‹åªæ”¹å˜è½®å»“æ¯”ä¾‹ã€ä¸æ”¹å˜ç¬”ç”»ç²—ç»† */
  shapeLineBase?: number;
  /** ç‚¹ç‚¹ï¼æ˜Ÿæ˜Ÿï¼çˆ±å¿ƒçº¹ç†çš„åŽŸå§‹åæ ‡ç³»ï¼›æŒ¤åŽ‹æ—¶æ•´å±‚éšå®½é«˜å˜å½¢ */
  shapeTextureBaseW?: number;
  shapeTextureBaseH?: number;
  /** æé‚Šçš„è™›ç·šé•·åº¦ï¼ˆ0ï¼å¯¦ç·šï¼Œ1~100 æ˜¯ã€Œä¸€æ®µæœ‰å¹¾å€ç·šå¯¬ã€çš„æ¯”ä¾‹ï¼Œè·Ÿåœ–ç‰‡æé‚ŠåŒä¸€å¥—ï¼‰ */
  shapeDash?: number;
  /** åœ–å½¢ç™¼å…‰å¼·åº¦ 0~100ï¼ˆ0ï¼é—œï¼‰ã€‚èˆŠè³‡æ–™å­˜çš„æ˜¯ trueï¼falseï¼ŒglowAmount æœƒç›¸å®¹ */
  shapeGlow?: number | boolean;
  /** åœ–å½¢ç™¼å…‰çš„é¡è‰²ã€‚æ²’è¨­å°±ç”¨åœ–å½¢è‡ªå·±çš„é¡è‰² */
  shapeGlowColor?: string;
  /** å®žå¿ƒåŸºç¡€å›¾å½¢çš„è¾¹ç¼˜ç¾½åŒ– 0ï½ž100ã€‚ */
  shapeFeather?: number;
  /** ç™¼å…‰é¡è‰²æ˜¯ä¸æ˜¯å·²ç¶“çµ¦éŽé è¨­å€¼äº†ï¼ˆåªåœ¨ç¬¬ä¸€æ¬¡æ‰“é–‹ç™¼å…‰æ™‚å¸¶å…¥åœ–å±¤è‡ªå·±çš„é¡è‰²ï¼‰ */
  glowInit?: boolean;
  /** åœ–å½¢çš„å¤–æé‚Šå¯¬åº¦ï¼ˆè·Ÿç²—ç´°åŒä¸€ç¨®åˆ»åº¦ï¼šå­˜ 0~10ï¼Œæ»‘æ¡¿é¡¯ç¤º 0~100ï¼‰ï¼Œ0ï¼ä¸æé‚Š */
  shapeStrokeW?: number;
  /** å¤–æé‚Šçš„é¡è‰²ï¼Œé è¨­é»‘ */
  shapeStrokeColor?: string;
  /* åœ–å½¢ä¸Šçš„ã€Œé»žé»žã€ã€‚è·Ÿå‰µæ„æ‹¼åœ–é‚£é‚ŠåŒä¸€çµ„åƒæ•¸ã€åŒä¸€å¥—ç¶²æ ¼ï¼Œ
     æ‰€ä»¥å…©å€‹å·¥å…·èª¿åŒæ¨£çš„å€¼ï¼Œçœ‹åˆ°çš„å¯†åº¦èˆ‡å¤§å°æ˜¯ä¸€æ¨£çš„ã€‚ */
  shapeDots?: boolean;
  /** é»žé»žå¤§å° 0~100ï¼ˆé è¨­ 50ï¼‰ */
  shapeDotSize?: number;
  /** é»žé»žé–“è· 0~100ï¼ˆé è¨­ 20ï¼‰ */
  shapeDotGap?: number;
  /** é»žé»žé¡è‰²ï¼ˆé è¨­ç™½ï¼‰ */
  shapeDotColor?: string;
  /** ç´‹ç†ç¨®é¡žï¼š'none' | 'dot' | 'stripe'ã€‚æ²’çµ¦å°±ç…§èˆŠçœ‹ shapeDotsã€‚ */
  shapeTex?: string;
  /** æ¢ç´‹ç²—ç´° 0~100ï¼ˆé è¨­ 50ï¼‰ */
  shapeStripeN?: number;
  /** æ¢ç´‹æ–¹å‘ï¼š'h' æ©«å¼ï¼ˆé è¨­ï¼‰ï¼'v' ç›´å¼ */
  shapeStripeDir?: string;
  /** æ¢ç´‹çš„å…©å€‹é¡è‰² */
  shapeStripeA?: string;
  shapeStripeB?: string;
  /** ç¶“å…¸èˆ‡å‰µæ„æ‹¼åœ–å…±ç”¨åŒä¸€çµ„é€²å ´ï¼å¸¸é§å‹•ç•«åƒæ•¸ã€‚ */
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
 * åœ–å½¢ä¸Šã€Œé»žé»žã€çš„ç¶²æ ¼åƒæ•¸ã€‚é è¦½ï¼ˆSVG patternï¼‰èˆ‡åŒ¯å‡ºï¼ˆcanvasï¼‰åƒåŒä¸€æ”¯ï¼Œ
 * å…©é‚Šæ‰ä¸å¯èƒ½å°ä¸èµ·ä¾†ï¼›å‰µæ„æ‹¼åœ–é‚£é‚Šä¹Ÿæ˜¯åŒä¸€çµ„å¼å­ã€‚
 *   dsz  = (5 + å¤§å°/100 Ã— 15) Ã— å–®ä½
 *   dgap = (40 + é–“è·) Ã— å–®ä½          å–®ä½ = é•·é‚Š / 600
 * ç¶²æ ¼æ˜¯äº¤éŒ¯çš„ä¸‰è§’æ ¼ï¼šå¶æ•¸åˆ—ä¸ä½ç§»ã€å¥‡æ•¸åˆ—å¾€å³åŠæ ¼ï¼Œåˆ—è· = é–“è· Ã— âˆš3/2ã€‚
 */
export const shapeDotGrid = (w: number, h: number, l: {
  shapeDotSize?: number; shapeDotGap?: number; shapeDotColor?: string;
}) => {
  const unit = Math.max(w, h) / 600;
  const dsz = (5 + ((l.shapeDotSize ?? 50) / 100) * 15) * unit;
  const dgap = (40 + (l.shapeDotGap ?? 20)) * unit;
  return { r: dsz / 2, dx: dgap, dy: dgap * Math.sqrt(3) / 2, color: l.shapeDotColor || '#FFFFFF' };
};

/** åŒ¯å‡ºæ™‚æŠŠé»žé»žç•«ä¸ŠåŽ»ï¼ˆåŽŸé»žåœ¨åœ–å½¢ä¸­å¿ƒï¼‰ã€‚å‘¼å«ç«¯è² è²¬å…ˆå‰ªè£åœ¨åœ–å½¢è£¡é¢ã€‚ */
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
  /** ç¬¬äºŒæ®µé¸å–ï¼šé¸ä¸­çš„æ˜¯ã€Œå½¢ç‹€ã€è€Œä¸æ˜¯æ•´å¼µåœ–ç‰‡ï¼ˆå¤–æ¡†æ”¹æˆè²¼è‘—å½¢ç‹€ã€è§’çƒæ”¶èµ·ä¾†ï¼‰ */
  shapeSelected?: boolean;
  /** æ»‘é¼ æŒ‰åœ¨é€™å¼µåœ–ä¸Šï¼ˆè§¸æŽ§èµ°ç•«å¸ƒå±¤ç´šé‚£æ¢ï¼Œä¸æœƒå«é€™æ”¯ï¼‰ã€‚åº§æ¨™äº¤çµ¦å¤–é¢åˆ¤æ–·åœ¨ä¸åœ¨å½¢ç‹€è£¡ */
  onShapeTap?: (clientX: number, clientY: number) => void;
  onSelect: () => void;
  onChange: (updated: Partial<FloatingImage>) => void;
  onDelete: () => void;
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  /** ç•«å¸ƒç›®å‰çœŸæ­£å¥—ç”¨çš„ç¸®æ”¾å€çŽ‡ï¼ˆä½¿ç”¨è€…é›™æŒ‡ç¸®æ”¾é è¦½ç”¨çš„é‚£å€‹ï¼‰ã€‚
      æ‰‹æŒ‡èµ°çš„æ˜¯èž¢å¹•åƒç´ ã€ç‰©ä»¶çš„åº§æ¨™æ˜¯æœªç¸®æ”¾çš„å…§å®¹å–®ä½ï¼Œå…©è€…è¦é å®ƒæ›ç®—ã€‚ */
  canvasKRef?: React.RefObject<number>;
  /** å·²æäº¤çš„é è¦½å€çŽ‡ï¼›åªç”¨ä¾†åœ¨ç¸®æ”¾æ‰‹å‹¢çµæŸå¾Œé‡å»ºé«˜æ¸… Canvas backing storeã€‚ */
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
  onScaleEnd?: () => void;
  isSwapTarget?: boolean;
  isSwapSource?: boolean;
  stackIndex?: number;
  onLayerAction?: (action: 'up' | 'down' | 'delete' | 'copy' | 'edit') => void;
  canLayerUp?: boolean;
  canLayerDown?: boolean;
  /** ä¸‹æ–¹ç©ºé–“ä¸å¤ æ™‚æŠŠå·¥å…·åˆ—ç¿»åˆ°ç‰©ä»¶ä¸Šæ–¹ */
  toolbarAbove?: boolean;
  /** æ–‡å­—åœ–å±¤è‡ªå‹•è²¼åˆå¯¬åº¦æ™‚çš„ä¸Šé™ï¼ˆæœªç¸®æ”¾åƒç´ ï¼‰ */
  maxTextWidth?: number;
  /** å›ºå®šå‘é‡ç•«å¸ƒéœ€è¦çš„é é¢é«˜åº¦ï¼ˆèˆ‡ maxTextWidth åŒç‚ºå…§å®¹åº§æ¨™ï¼‰ã€‚ */
  canvasHeight?: number;
  /** ç›´æŽ¥åœ¨ç•«å¸ƒä¸Šæ‰“å­—ï¼šé¸ä¸­å¾Œå†é»žä¸€æ¬¡å°±é€²å…¥é€™å€‹ç‹€æ…‹ */
  isTextEditing?: boolean;
  onTextEditEnd?: () => void;
  /** é›™æŒ‡ç¸®æ”¾ï¼æ—‹è½‰é€²è¡Œä¸­ï¼šå·¥å…·åˆ—å…ˆæ”¶èµ·ä¾† */
  hideToolbar?: boolean;
  /** æ–‡å­—ï¼ç¬¦è™Ÿï¼åœ–å½¢æ­£åœ¨é›™æŒ‡ç¸®æ”¾ï¼šæ”¹ç”¨å›ºå®šç•«å¸ƒã€é€å¹€é‡ç•«å…§å®¹ã€‚ */
  gestureRendering?: boolean;
  /** æ­£åœ¨æ‹–å½¢ç‹€çš„æ»‘æ¡¿ï¼šé¸å–æ¡†ã€å››è§’åœ“çƒã€å·¥å…·åˆ—å…¨éƒ¨æ”¶èµ·ä¾†ï¼Œé‚Šç·£çš„æ•ˆæžœæ‰çœ‹å¾—æ¸…æ¥š */
  hideChrome?: boolean;
  /** æ¿¾é¡è¼‰å®Œæœƒ +1ï¼Œç”¨ä¾†è®“å·²ç¶“å¥—ç”¨æ¿¾é¡çš„åœ–å±¤é‡ç•« */
  lutRevision?: number;
  /** æ²’æœ‰é¸å–ä»»ä½•æ±è¥¿æ™‚äº¤å›ž pan-xï¼Œæ©«å‘æ²å‹•å°±ç”±ç€è¦½å™¨è™•ç†ï¼Œæ‰‹æ„Ÿè·Ÿç©ºç™½è™•ä¸€è‡´ */
  touchMode?: 'none' | 'pan-x';
  /**
   * æŽ’é é¢æ‹–æ›³ä¸­ï¼Œé€™ä¸€å±¤è¦è·Ÿè‘—è‡ªå·±é‚£ä¸€é ä¸€èµ·ç§»å‹•ï¼ˆé †ä¾¿è·Ÿè‘—é‚£ä¸€é æ•´çµ„ç¸®å°ï¼‰ã€‚
   * live = æ­£åœ¨è¢«æ‰‹æŒ‡æ‹–çš„é‚£ä¸€é ï¼ˆä¸åŠ å‹•ç•«ï¼‰ï¼Œå…¶é¤˜æ˜¯è®“é–‹çš„é é¢ï¼ˆ200ms æ»‘éŽåŽ»ï¼‰ã€‚
   */
  dragShift?: { tx: number; ty: number; s: number; live: boolean } | null;
  onSwapTouchStart?: (e: React.TouchEvent) => void;
  onSwapTouchMove?: (e: React.TouchEvent) => void;
  onSwapTouchEnd?: (e: React.TouchEvent) => void;
  /**
   * é¸å–æ¡†ã€å››è§’åœ“çƒã€å·¥å…·åˆ—è¦æ”¹æŽ›åˆ°é€™ä¸€å±¤åŽ»ç•«ã€‚
   * é€™ä¸€å±¤æ˜¯ã€Œé é¢å®¹å™¨çš„å…„å¼Ÿã€ï¼Œä¸åœ¨é‚£å€‹ overflow-hidden åº•ä¸‹ï¼Œ
   * æ‰€ä»¥ç‰©ä»¶è¢«æ‹–å‡ºç•«å¸ƒé‚Šç·£æ™‚ï¼Œæ¡†è·ŸæŒ‰éˆ•ä¸æœƒè¢«é‚Šç·£çš„é»‘è‰²åˆ‡æŽ‰ â€”â€”
   * ä½†ç‰©ä»¶æœ¬èº«ä»ç„¶ç•™åœ¨åŽŸæœ¬æœƒè¢«è£åˆ‡çš„é‚£ä¸€å±¤ï¼Œè¶…å‡ºç•«å¸ƒçš„éƒ¨åˆ†ç…§æ¨£çœ‹ä¸åˆ°ã€‚
   * æ‹¿ä¸åˆ°é€™ä¸€å±¤æ™‚å°±é€€å›žåŽŸæœ¬çš„ç•«æ³•ï¼ˆæŽ›åœ¨è‡ªå·±èº«ä¸Šï¼‰ï¼Œè¡Œç‚ºå®Œå…¨ä¸è®Šã€‚
   */
  chromeLayer?: HTMLElement | null;
  /** å‹•ç•«é ç•¶ä¸‹é€™ä¸€æ ¼ï¼›é¸ä¸­æ¡†ä¸åƒé€™å€‹è®Šå½¢ï¼Œé¿å…è·Ÿè‘—å‹•ç•«è·³å‹•ã€‚ */
  motionFrame?: ObjectMotionFrame | null;
  /** å‹•ç•«é åªå…è¨±é»žé¸ç›®æ¨™ï¼Œä¸å…è¨±ç§»å‹•ã€ç¸®æ”¾ã€æ—‹è½‰æˆ–æ›ä½ã€‚ */
  motionPickOnly?: boolean;
  /** åˆ‡æ›å‹•ç•«ç›®æ¨™æ™‚çŸ­æš«é¡¯ç¤ºçš„è™›ç·šæç¤ºæ¡†ã€‚ */
  motionTargetFlash?: number | null;
  /** ç¶“å…¸å‹•ç•«é æš«åœæ™‚ï¼ŒåŒæ­¥æš«åœå¯è¦‹çš„å½±ç‰‡ç¯€é»žã€‚ */
  videoPaused?: boolean;
}

let globalDragPointerId: number | null = null;

/* â”€â”€ å½±ç‰‡çš„æé‚Šèˆ‡ç™¼å…‰ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   é€™å…©æ¨£**å®Œå…¨ä¸éœ€è¦å½±ç‰‡çš„ç•«ç´ **ï¼š
     æé‚Š â€”â€” æ²¿è‘—å½¢ç‹€çš„è¼ªå»“æä¸€åœˆç·šï¼Œåªè·Ÿå½¢ç‹€æœ‰é—œï¼›
     ç™¼å…‰ â€”â€” å…‰æšˆåªçœ‹ã€Œè¼ªå»“å¤–é¢å¤šé ã€ï¼ŒmakeGlowCanvas è®€çš„ä¹Ÿåªæœ‰ alphaã€‚
   æ‰€ä»¥å…©å¼µéƒ½å¯ä»¥åœ¨ã€Œå½¢ç‹€ï¼ç²—ç´°ï¼é¡è‰²ã€è®Šå‹•æ™‚å„ç®—ä¸€æ¬¡å°±ç•™è‘—ï¼Œ
   ä¹‹å¾Œæ¯ä¸€æ ¼å½±æ ¼éƒ½ä¸ç”¨å†ç¢°å®ƒå€‘ â€”â€” é€æ ¼æˆæœ¬æ˜¯ 0ã€‚

   ç‚ºä»€éº¼ä¸èƒ½åƒç…§ç‰‡é‚£æ¨£ç›´æŽ¥ç•«é€²é‚£å¼µ 2D å½¢ç‹€ç•«å¸ƒï¼šé‚£æ¢è·¯çš„ç¬¬ä¸€å€‹å‹•ä½œæ˜¯
   drawImage(å½±ç‰‡ä¾†æº)ï¼Œ1080p ä¸€æ¬¡ 20.9 æ¯«ç§’ï¼›å¥—äº†æ¿¾é¡çš„è©±ä¾†æºé‚„æ˜¯ GPU ç•«å¸ƒï¼Œ
   ä¸€æ¬¡ 104 æ¯«ç§’ï¼ˆç­‰æ–¼æŠŠç•«é¢å¾žé¡¯ç¤ºå¡è®€å›ž CPUï¼‰ã€‚é€™è£¡æ”¹æˆã€Œå½±ç‰‡ç…§èˆŠäº¤çµ¦
   ç€è¦½å™¨åˆæˆï¼Œæé‚Šèˆ‡ç™¼å…‰æ˜¯å…©å¼µéœæ…‹ç•«å¸ƒç–Šåœ¨å®ƒå‰å¾Œã€ï¼Œ
   ç®—å¼ï¼ˆwithImgOutlineï¼makeGlowCanvasï¼‰è·Ÿç…§ç‰‡èˆ‡åŒ¯å‡ºç”¨çš„æ˜¯åŒä¸€ä»½ã€‚ */
const videoDeco = (
  image: any, boxW: number, boxH: number, dpr: number,
): { glow: HTMLCanvasElement | null; stroke: HTMLCanvasElement | null; pad: number } => {
  const empty = { glow: null, stroke: null, pad: 0 };
  if (!boxW || !boxH) return empty;
  /* ç‰ˆé¢å·²ç¶“ç¸®æ”¾éŽçš„åœ°æ–¹ï¼ˆIG é è¦½ã€é é¢ç¸®åœ–ï¼‰å‚³é€²ä¾†çš„ boxW æ˜¯ç¸®éŽçš„ï¼Œ
     æ‰€ä»¥ç²—ç´°èˆ‡å…‰æšˆä¹Ÿè¦è·Ÿè‘—åŒä¸€å€‹å€çŽ‡ï¼Œä¸ç„¶ç¸®åœ–ä¸Šçš„ç·šæœƒæ¯”è¼ƒç²—ã€‚ */
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

  /** æé‚Šé‚£ä¸€åœˆï¼ˆç…§ç‰‡é‚£æ¢è·¯æ˜¯ç•«åœ¨ lw/2 çš„æ¡†ä¸Šï¼Œç·šæ•´æ¢é•·åœ¨åœ–ç‰‡å¤–é¢ï¼‰ */
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

  /* â‘  æé‚Šï¼šåªæœ‰ç·šï¼Œç–Šåœ¨å½±ç‰‡å‰é¢ */
  let stroke: HTMLCanvasElement | null = null;
  if (lw > 0) {
    stroke = document.createElement('canvas');
    stroke.width = W; stroke.height = H;
    const g = stroke.getContext('2d');
    if (g) paintStroke(g, ox, oy); else stroke = null;
  }

  /* â‘¡ ç™¼å…‰ï¼šå…ˆåšä¸€å¼µã€Œå½¢ç‹€ï¼‹æé‚Šã€çš„å‰ªå½±ï¼ˆåªæœ‰ alpha æœ‰ç”¨ï¼‰ï¼Œ
        å†äº¤çµ¦è·Ÿç…§ç‰‡ã€åŒ¯å‡ºåŒä¸€æ”¯ makeGlowCanvasã€‚å…‰æšˆç–Šåœ¨å½±ç‰‡å¾Œé¢ã€‚ */
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

/** æŠŠä¸€å¼µç®—å¥½çš„è£é£¾ç•«å¸ƒæ“ºåˆ°ã€Œæ¯”å½±ç‰‡æ¡†å¤§ pad ä¸€åœˆã€çš„ä½ç½® */
const DecoCanvas: React.FC<{ cv: HTMLCanvasElement; pad: number; w: number; h: number }> = ({ cv, pad, w, h }) => {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.display = 'block';
    el.appendChild(cv);
    return () => { try { el.removeChild(cv); } catch { /* å·²ç¶“ä¸åœ¨äº† */ } };
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
 * å½±ç‰‡åœ–å±¤çš„ç•«é¢ã€‚
 *
 * æ²’æœ‰è£åˆ‡éŽå°±æ˜¯åŽŸæœ¬é‚£ä¸€è¡Œ <video> â€”â€” ä¸€å€‹åƒç´ éƒ½æ²’å‹•ã€‚
 * è£åˆ‡ï¼è½‰è§’åº¦ï¼ç¿»è½‰éŽçš„è©±ï¼Œå°±æŠŠæ§‹åœ–é‚£çµ„åƒæ•¸æ›æˆä¸€å€‹ CSS çš„ matrix()
 * å¥—åœ¨ <video> ä¸Šï¼Œå¤–å±¤å†ç”¨ overflow:hidden æŠŠæ¡†å¤–çš„éƒ¨åˆ†åˆ‡æŽ‰ã€‚
 * ç”¨çš„æ˜¯è·ŸåŒ¯å‡ºå®Œå…¨åŒä¸€å€‹çŸ©é™£ï¼ˆutils/compose çš„ geoAffineï¼‰ï¼Œ
 * æ‰€ä»¥ã€Œé è¦½çœ‹åˆ°çš„ã€èˆ‡ã€ŒåŒ¯å‡ºç•«å‡ºä¾†çš„ã€ä¸å¯èƒ½å°ä¸èµ·ä¾†ã€‚
 *
 * åˆ»æ„**ä¸**æŠŠå½±ç‰‡é€æ ¼ç•«é€² canvasï¼šé‚£æ¨£æ¯ä¸€æ ¼éƒ½è¦ drawImage ä¸€æ¬¡æ•´å¼µï¼Œ
 * æ‰‹æ©Ÿæœƒç‡™ï¼›äº¤çµ¦ç€è¦½å™¨è‡ªå·±åˆæˆå‰‡å¹¾ä¹Žä¸èŠ± CPUï¼Œè€Œä¸”ç¶­æŒåŽŸç”Ÿè§£æžåº¦ã€‚
 */
const VideoLayer: React.FC<{
  image: any; boxW: number; boxH: number;
  /** å¤–å±¤çš„ç‰ˆé¢æ¨£å¼ï¼ˆä½ç½®ï¼å¤§å°ï¼‰ã€‚è£åˆ‡éŽçš„æ™‚å€™æœƒå¥—åœ¨é‚£å€‹ overflow:hidden çš„æ¡†ä¸Šã€‚ */
  style?: React.CSSProperties;
  /** å¥—äº†æ•ˆæžœæ™‚ï¼Œé€™å€‹ <video> åªç•¶ GPU çš„ä¾†æº â€”â€” è®“å¤–é¢æ‹¿å¾—åˆ°å®ƒï¼Œä¸è¦å†é–‹ç¬¬äºŒä»½è§£ç¢¼ */
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /** ç¬¬ä¸€æ ¼è§£å‡ºä¾†äº† */
  onReady?: () => void;
  /** æˆå“å·²ç¶“æ”¹ç”±ä¸Šé¢é‚£å¼µ canvas é¡¯ç¤ºäº†ï¼Œé€™ä¸€å±¤å°±è®“é–‹ï¼ˆä½†**ä¸èƒ½**å¸è¼‰ï¼Œå¸è¼‰ï¼åœæ­¢è§£ç¢¼ï¼‰ */
  hidden?: boolean;
  /**
   * å¥—äº†æ¿¾é¡ï¼èª¿ç¯€æ™‚ï¼Œç•«é¢ä¸Šé¡¯ç¤ºçš„ä¸æ˜¯ <video> æœ¬äººï¼Œè€Œæ˜¯é€™å¼µ GPU ç•«å¸ƒã€‚
   * å®ƒè·Ÿ <video> **å¥—å®Œå…¨ä¸€æ¨£çš„ç‰ˆé¢èˆ‡è®Šæ›** â€”â€” è£åˆ‡ã€æ—‹è½‰ã€ç¿»è½‰é‚£ä¸€æ•´å¥—
   * å¹¾ä½•å®Œå…¨æ²¿ç”¨ä¸‹é¢æ—¢æœ‰çš„é‚£ä»½ï¼ˆgeoCssBoxï¼‰ï¼Œä¸€è¡Œéƒ½æ²’æœ‰å¦å¤–ç®—ï¼Œ
   * æ‰€ä»¥ã€Œæœ‰æ²’æœ‰å¥—æ¿¾é¡ã€ä¸å¯èƒ½è®“å½±ç‰‡è·‘ä½ã€‚
   */
  glCanvas?: HTMLCanvasElement | null;
  /** å‹•ç•«é æš«åœæ™‚ï¼ŒçœŸæ­£é¡¯ç¤ºåœ¨ç•«é¢ä¸Šçš„é€™å€‹ç¯€é»žä¹Ÿå¿…é ˆåœä½ã€‚ */
  paused?: boolean;
}> = ({ image, boxW, boxH, style, videoRef, onReady, hidden, glCanvas, paused = false }) => {
  const ref = useRef<HTMLVideoElement>(null);
  /* â”€â”€ å½¢ç‹€ï¼ˆåœ“è§’ï¼å¤–å½¢ï¼ç¾½åŒ–ï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     ç”¨ CSS é®ç½©ï¼Œä¾†æºæ˜¯ previewMask â€”â€” **è·Ÿåœ–ç‰‡é‚£æ¢è·¯ã€è·ŸåŒ¯å‡ºç”¨çš„æ˜¯åŒä¸€æ”¯
     makeShapeMask**ï¼Œæ‰€ä»¥é‚Šç·£èˆ‡ç¾½åŒ–çš„è¡°æ¸›æ›²ç·šä¸€æ¨¡ä¸€æ¨£ï¼Œä¸æ˜¯å¦å¤–åšä¸€å¥—ã€‚
     ç‚ºä»€éº¼ç”¨ CSS è€Œä¸æ˜¯ç•«åœ¨ canvas ä¸Šï¼šå½±ç‰‡çš„æˆå“æ˜¯äº¤çµ¦ç€è¦½å™¨åˆæˆçš„ï¼Œ
     ä¸€æ—¦ç‚ºäº†å¥—å½¢ç‹€è€ŒæŠŠå®ƒç•«é€² 2D ç•«å¸ƒï¼Œå°±ç­‰æ–¼æŠŠç•«é¢å¾žé¡¯ç¤ºå¡è®€å›ž CPU
     ï¼ˆå¯¦æ¸¬ä¸€æ¬¡ 104 æ¯«ç§’ï¼‰ã€‚CSS é®ç½©æ˜¯åˆæˆå™¨åšçš„ï¼Œä¸ç”¨å›žè®€ï¼Œè€Œä¸”
     **æ²’å¥—æ¿¾é¡çš„å½±ç‰‡ä¹Ÿä¸€æ¨£æœ‰æ•ˆ**ï¼ˆé‚£æ¢è·¯æ ¹æœ¬æ²’æœ‰ GPU ç•«å¸ƒï¼‰ã€‚ */
  const shapeKind = image.imgShape as string | undefined;
  const radiusPct = image.imgRadius || 0;
  const featherPct = image.feather || 0;
  /* å½¢ç‹€æ€Žéº¼è¡¨é”äº¤çµ¦ shapeParts â€”â€” ã€Œæ‹–æ›³äº’æ›æ™‚é‚£å±¤è®Šæš—ã€ç”¨çš„æ˜¯åŒä¸€æ”¯ï¼Œ
     æ‰€ä»¥æš—ä¸‹åŽ»çš„å½¢ç‹€è·Ÿå½±ç‰‡ç¾åœ¨çš„å½¢ç‹€ä¸€å®šä¸€æ¨£ã€‚
     å–®ç´”åœ“è§’èµ° border-radiusï¼šä¸ç”¨è§£ç¢¼ä»»ä½•åœ–ï¼Œæ‹–æ»‘æ¡¿å°±ä¸æœƒé–ƒã€‚ */
  const { cssRadius, maskUrl } = useMemo(
    () => shapeParts(image, boxW, boxH),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxW, boxH, radiusPct, featherPct, shapeKind],
  );
  /* é®ç½©åœ–è¦**è§£ç¢¼å®Œæ‰æ›ä¸ŠåŽ»**ã€‚ç›´æŽ¥æ›çš„è©±ï¼Œç€è¦½å™¨åœ¨è§£ç¢¼é‚£å¹¾åæ¯«ç§’è£¡
     æ‰‹ä¸Šæ²’æœ‰é®ç½©å¯ç”¨ï¼Œé‚£ä¸€å±¤å°±æ•´å€‹ä¸è¦‹ â€”â€” æ‹–æ»‘æ¡¿æ™‚å°±æ˜¯ä¸€ç›´é–ƒã€‚
     è§£ç¢¼ä¸­å…ˆæ²¿ç”¨ä¸Šä¸€å¼µï¼›ç¬¬ä¸€æ¬¡é‚„æ²’æœ‰ä¸Šä¸€å¼µï¼Œé‚£å°±ç¶­æŒã€Œå®Œå…¨æ²’æœ‰é®ç½©ã€
     ï¼ˆä¹Ÿå°±æ˜¯åŽŸæœ¬çš„æ–¹æ¡†ï¼‰ï¼Œä¸æœƒæ¶ˆå¤±ã€‚ */
  const [liveMask, setLiveMask] = useState('');
  const liveMaskRef = useRef('');
  liveMaskRef.current = liveMask;
  useEffect(() => {
    if (!maskUrl) { setLiveMask(''); return; }
    let alive = true;
    /* å†å£“ä¸€å±¤ 40ms çš„åˆä½µï¼šæ‹–ç¾½åŒ–æ»‘æ¡¿æ™‚ä¸€ç§’æœƒä¾†å…­åå€‹æ–°æ•¸å­—ï¼Œ
       æ¯ä¸€å€‹éƒ½åŽ»ç·¨ä¸€å¼µ PNG å†è§£ç¢¼ï¼Œç•«é¢å°±ä¸€è·¯å¡è‘—ã€‚

       âš  **ç¬¬ä¸€æ¬¡**ä¸é€²é€™å€‹åˆä½µï¼ˆæ‰‹ä¸Šé‚„æ²’æœ‰ä»»ä½•é®ç½©å¯ä»¥é ‚è‘—ï¼‰ã€‚
       åŽŸæœ¬ä¸åˆ†ç¬¬ä¸€æ¬¡ï¼šæ‹‰ä¸‹ç¾½åŒ–ä¹‹å¾Œè¦ç­‰ 40 æ¯«ç§’ï¼‹è§£ç¢¼æ‰æœƒæœ‰é®ç½©ï¼Œè€Œé€™æ®µæ™‚é–“
       æ»‘æ¡¿å·²ç¶“è¢«æ‹–åˆ°åå¹¾äº† â€”â€” é‚Šç·£æ˜¯ã€Œå…ˆå®Œå…¨ä¸è®Šï¼Œç„¶å¾Œä¸€æ¬¡è·³æˆå¾ˆæŸ”ã€ï¼Œ
       é‚£ä¸€ä¸‹çœ‹èµ·ä¾†å°±æ˜¯ç•«é¢é–ƒäº†ä¸€ä¸‹ã€‚ç¬¬ä¸€å¼µç«‹åˆ»åšï¼Œä¹‹å¾Œæ‰éœ€è¦åˆä½µã€‚ */
    const wait = liveMaskRef.current ? 40 : 0;
    const t = window.setTimeout(() => {
      const im = new Image();
      const done = () => { if (alive) setLiveMask(maskUrl); };
      /* decode() æ¯” onload ä¿éšªï¼šonload åªä¿è­‰ã€Œè¼‰é€²ä¾†äº†ã€ï¼Œ
         çœŸæ­£ç•«ä¸ŠåŽ»ä¹‹å‰é‚„è¦è§£ä¸€æ¬¡ç¢¼ â€”â€” WebKit åœ¨é‚£ä¸€å°æ®µè£¡æ‹¿ä¸åˆ°é®ç½©å…§å®¹ï¼Œ
         æ•´å±¤æœƒè¢«ç•¶æˆã€Œé®ç½©å…¨é»‘ã€è€Œä¸è¦‹ã€‚decode() æ˜¯è§£å®Œæ‰å›žä¾†ã€‚ */
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
  /* åŒä¸€å€‹å…ƒç´ åŒæ™‚äº¤çµ¦è£¡é¢çš„ ref èˆ‡å¤–é¢çš„ videoRef */
  const setRef = (el: HTMLVideoElement | null) => {
    (ref as any).current = el;
    if (videoRef) videoRef.current = el;
  };
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (paused) video.pause();
    else video.play().catch(() => { /* ç­‰å¾…ä¸‹ä¸€æ¬¡ä½¿ç”¨è€…äº’å‹• */ });
  }, [paused, image.src]);
  /* â”€â”€ åœ–ç‰‡åœ¨å½¢ç‹€è£¡çš„ä½ç½®èˆ‡ç¸®æ”¾ï¼ˆimgShapeXï¼Yï¼Zoomï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     ç…§ç‰‡é‚£æ¢è·¯æ˜¯ drawImgBase åœ¨ç•«çš„æ™‚å€™å¥—ä¸ŠåŽ»çš„ï¼›å½±ç‰‡æ²’æœ‰ç¶“éŽé‚£ä¸€æ”¯ï¼Œ
     æ‰€ä»¥ä»¥å‰ã€Œå¥—äº†å½¢ç‹€ä¹‹å¾Œæ€Žéº¼æ‹–éƒ½ä¸æœƒå‹•ã€ã€‚é€™è£¡ç”¨å®Œå…¨åŒä¸€æ¢ç®—å¼ï¼Œ
     åªæ˜¯æ›æˆ CSSï¼šå…ˆé–‹ä¸€å€‹ã€Œå½¢ç‹€è¦–çª—ã€æŠŠå½±ç‰‡æŒ‰é‚£å€‹ä½ç½®èˆ‡å¤§å°æ“ºå¥½ï¼Œ
     å¤–é¢é‚£å±¤å†ç”¨å½¢ç‹€é®ç½©åˆ‡å‡ºä¾†ã€‚å€çŽ‡ 1ã€æ²’ä½ç§»æ™‚ï¼Œé€™å€‹è¦–çª—å‰›å¥½ç­‰æ–¼æ•´å€‹æ¡†ã€‚ */
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
  /* é€™è£¡æ˜¯ fill ä¸æ˜¯ containï¼šåŒ¯å‡ºæ˜¯ drawImage(src, x, y, w, h)ï¼Œç›´æŽ¥æŠŠåœ–å¡«æ»¿
     æ•´å€‹æ¡†ã€ä¸ç•™ä¿¡ç®±é‚Šã€‚é è¦½å¦‚æžœç”¨ containï¼Œåªè¦åœ–å±¤æ¡†çš„é•·å¯¬æ¯”è·ŸåŽŸåœ–å·®ä¸€é»žé»ž
     ï¼ˆåŒ¯å…¥æ™‚å–æ•´å°±æœƒå·®ï¼‰ï¼Œå››å‘¨å°±æœƒå¤šå‡ºé›¶é»žå¹¾ px çš„ç©ºç™½ â€”â€” è²¼é½Šç•«å¸ƒé‚Šç·£æ™‚é‚£å°±
     æ˜¯ä¸€æ¢ç™½ç¸«ï¼Œè€ŒåŒ¯å‡ºæ²’æœ‰ã€‚ç”¨ fill æ‰è·ŸåŒ¯å‡ºä¸€è‡´ã€‚ */
  /* âš  å½±ç‰‡èˆ‡ GPU ç•«å¸ƒæ˜¯**ç–Šåœ¨ä¸€èµ·**çš„å…©å±¤ï¼Œæ‰€ä»¥å…©å€‹éƒ½è¦çµ•å°å®šä½ã€‚
     ä»¥å‰å½±ç‰‡ã€Œè®“é–‹ã€æ™‚æœƒè¢«æ”¹æˆ position:absoluteï¼Œç•«å¸ƒæ‰æœƒå›žåˆ°å·¦ä¸Šè§’ï¼›
     ç¾åœ¨è®“é–‹åªå‹•é€æ˜Žåº¦ã€å½±ç‰‡ä¸€ç›´åœ¨åŽŸä½ï¼Œè¦æ˜¯é‚„ç…§æ–‡ä»¶æµæŽ’ï¼Œ
     ç•«å¸ƒå°±æœƒè¢«æ“ åˆ°å½±ç‰‡æ­£ä¸‹æ–¹ï¼ˆå¯¦æ¸¬æ•´æ•´ä½Žäº†ä¸€å€‹åœ–å±¤çš„é«˜åº¦ï¼‰ã€‚ */
  const plain: React.CSSProperties = style
    ? { ...style, objectFit: 'fill', pointerEvents: 'none' }
    : { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' };
  const box = cropped && nat && innerW > 0 && innerH > 0
    ? geoCssBox(nat.w, nat.h, geo!, innerW, innerH)
    : null;
  /* è®“é–‹åªåœ¨ã€ŒGPU é‚£å¼µç•«å¸ƒçœŸçš„åœ¨å ´ã€æ™‚æ‰æˆç«‹ã€‚
     ä»¥å‰åªçœ‹ hiddenï¼ˆï¼glLiveï¼‰ï¼Œè€ŒæŠŠæ¿¾é¡æŒ‰å›žã€ŒåŽŸå§‹ã€çš„é‚£ä¸€æ ¼ï¼Œ
     glCanvas å·²ç¶“è®Šæˆ nullã€glLive å»é‚„æ˜¯ true â€”â€” å½±ç‰‡è¢«è—èµ·ä¾†ã€
     ç•«å¸ƒåˆä¸åœ¨ï¼Œç•«é¢å°±ç©ºäº†ï¼ˆå¯¦æ¸¬é€£çºŒç©ºç™½ 120 æ¯«ç§’ï¼‰ã€‚ */
  const stepAside = !!hidden && !!glCanvas;
  /* âš  è®“é–‹ï¼**ä»€éº¼éƒ½ä¸åš**ï¼šå½±ç‰‡ä¸€ç›´åœ¨åŽŸä½ã€ä¸€ç›´æ˜¯ä¸é€æ˜Žçš„ï¼Œ
     åªæ˜¯è¢«ä¸Šé¢é‚£å¼µä¸é€æ˜Žçš„ GPU ç•«å¸ƒæ•´ç‰‡è“‹ä½ã€‚

     ç‚ºä»€éº¼å¯ä»¥é€™æ¨£ï¼šé€™æ¢è·¯å¾žä¾†ä¸æŠŠå½¢ç‹€é®ç½©äº¤çµ¦ WebGLï¼ˆvideoGl çš„ setMask
     ä¸€æ¬¡éƒ½æ²’è¢«å‘¼å«éŽï¼‰ï¼Œå½¢ç‹€èˆ‡ç¾½åŒ–æ˜¯å¥—åœ¨**å¤–é¢é‚£ä¸€å±¤**çš„ CSS é®ç½©ä¸Šçš„ï¼Œ
     å½±ç‰‡èˆ‡ç•«å¸ƒä¸€èµ·è¢«è£ â€”â€” æ‰€ä»¥ç•«å¸ƒå¿…å®šæ˜¯æ•´ç‰‡ä¸é€æ˜Žçš„ï¼Œåº•ä¸‹çš„å½±ç‰‡
     ä¸€å€‹åƒç´ éƒ½éœ²ä¸å‡ºä¾†ã€‚
     é€™æ¨£åšçš„å¥½è™•æ˜¯ï¼šè¬ä¸€å“ªä¸€æ ¼ç•«å¸ƒæ˜¯ç©ºçš„ï¼ˆè‘—è‰²å™¨å‰›æ›ã€æè³ªå‰›é…å¥½ã€
     è»Ÿé«”åˆæˆå¶çˆ¾æ¼ä¸€æ ¼ï¼‰ï¼Œçœ‹åˆ°çš„æœƒæ˜¯**åº•ä¸‹é‚£æ ¼å½±ç‰‡**ï¼Œè€Œä¸æ˜¯é é¢çš„åº•è‰²ã€‚
     é‚£æ­£æ˜¯ã€Œç¬¬ä¸€æ¬¡å¥—ç‰¹æ•ˆæœƒé»‘ä¸€ä¸‹ã€çš„æœ€å¾Œä¸€å€‹ä¾†æºã€‚

     ï¼ˆå†å¾€å‰ä¸€ç‰ˆæ˜¯æŠŠå½±ç‰‡ç¸®æˆ 1Ã—1 æƒ³çœåˆæˆæˆæœ¬ã€‚é‚£æœƒè®“åˆæˆå™¨æ‰‹ä¸Šç•™è‘—
       ã€Œ1 åƒç´ çš„é‚£ä¸€å±¤ã€å†æ”¾å¤§åˆ°æ•´å€‹æ¡†ï¼Œæ›å›žä¾†çš„é‚£ä¸€æ ¼ç•«é¢å°±è¢«æ‹‰å¾—å¾ˆæ‰ â€”â€”
       ä¹Ÿå°±æ˜¯ã€Œæ¿¾é¡åˆ‡å›žåŽŸå§‹æ™‚å½±ç‰‡çªç„¶è®Šæ‰ã€ï¼›å°ºå¯¸ä¸€è®Šä¹Ÿæ˜¯ä¸€æ¬¡ç‰ˆé¢è®Šå‹•ï¼Œ
       å½±ç‰‡é‚£ä¸€å±¤è¦é‡æ–°é…ç½®ï¼Œä¸­é–“æœƒç©ºä¸€æ ¼ã€‚æ‰€ä»¥ç¾åœ¨é€£å¤§å°éƒ½ä¸å‹•ã€‚ï¼‰ */
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
          /* Tailwind çš„ preflight çµ¦ img/video æŽ›äº† max-width:100%ï¼Œ
             é‚£æœƒæŠŠã€Œä¾†æºåŽŸå§‹å¯¬åº¦ã€ç›´æŽ¥å¤¾æˆå¤–æ¡†é‚£éº¼å¯¬ â€”â€” è®Šæ›ç®—å¾—å†å°ï¼Œ
             ç•«å‡ºä¾†çš„é‚„æ˜¯éŒ¯çš„ï¼ˆå¯¦æ¸¬ 480px è¢«å¤¾æˆ 160pxï¼‰ã€‚é€™è£¡è¦æ˜Žè¬›ä¸è¦å¤¾ã€‚ */
          maxWidth: 'none', maxHeight: 'none',
          transformOrigin: '0 0', transform: box.transform,
          pointerEvents: 'none',
        }
        : plain}
    />
  );
  /* GPU ç•«å¸ƒï¼šè·Ÿä¸Šé¢é‚£å€‹ <video> å¥—åŒä¸€ä»½ styleã€‚
     âš  å®ƒæ˜¯ WebGL ç•«å¸ƒï¼Œ**çµ•å°ä¸èƒ½**è¢« drawImage åˆ° 2D ç•«å¸ƒä¸Š â€”â€”
     é‚£æœƒå¼·è¿«æŠŠç•«é¢å¾žé¡¯ç¤ºå¡è®€å›ž CPUï¼Œå¯¦æ¸¬ä¸€æ¬¡ 104 æ¯«ç§’ï¼Œæ•´å€‹å„ªå‹¢å°±æ²’äº†ã€‚
     æ‰€ä»¥é€™è£¡æ˜¯ã€Œç›´æŽ¥æŽ›åœ¨ç•«é¢ä¸Šè®“ç€è¦½å™¨åˆæˆã€ï¼Œä¸­é–“æ²’æœ‰ä»»ä½•ä¸€æ¬¡å›žè®€ã€‚ */
  /* âš  ç•«å¸ƒåœ¨ã€Œé‚„æ²’ç•«å‡ºä»»ä½•æ±è¥¿ã€ä¹‹å‰æ˜¯**çœ‹ä¸è¦‹**çš„ã€‚
     å®ƒä¸€è¢«æŽ›ä¸ŠåŽ»å°±æ˜¯è“‹åœ¨å½±ç‰‡ä¸Šé¢çš„ä¸€å±¤ï¼Œè€Œå‰›å»ºç«‹çš„ WebGL ç•«å¸ƒæ˜¯
     300Ã—150 çš„ç©ºç·©è¡å€ï¼ˆå¯¦æ¸¬ï¼šæŽ›ä¸ŠåŽ» 33 æ¯«ç§’ä¹‹å¾Œæ‰ç¬¬ä¸€æ¬¡ç•«ï¼‰â€”â€”
     é‚£ 33 æ¯«ç§’å®ƒè“‹è‘—å½±ç‰‡ã€è‡ªå·±åˆä»€éº¼éƒ½æ²’æœ‰ï¼Œå°±æ˜¯ã€Œç¬¬ä¸€æ¬¡å¥—æ¿¾é¡ï¼å¥—ç‰¹æ•ˆæ™‚
     é–ƒé»‘ä¸€ä¸‹ã€ã€‚ç•«å‡ºç¬¬ä¸€æ ¼ï¼ˆglLiveï¼‰ä¹‹å¾Œæ‰é¡¯å½¢ï¼Œä¸­é–“å®Œå…¨çœ‹ä¸åˆ°ç ´ç¶»ã€‚
     åéŽä¾†ä¹Ÿä¸€æ¨£ï¼šå“ªä¸€æ ¼ç•«ä¸å‡ºä¾†ï¼ˆè‘—è‰²å™¨é‚„åœ¨ç·¨ã€æè³ªé‚„æ²’é…å¥½ï¼‰å°±è‡ªå‹•é€€å›ž
     çœ‹ä¸è¦‹ï¼Œåº•ä¸‹é‚£å€‹ <video> ç«‹åˆ»æŽ¥æ‰‹ï¼Œä¸æœƒéœ²å‡ºèƒŒæ™¯ã€‚ */
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
  /* å½¢ç‹€è¦–çª—ã€‚æ²’æœ‰å½¢ç‹€æ™‚ï¼ˆshaped=falseï¼‰å®ƒå‰›å¥½ç­‰æ–¼æ•´å€‹æ¡†ï¼Œ
     ç­‰åŒæ–¼ä»¥å‰ç›´æŽ¥æ”¾ innerï¼Œä¸€å€‹åƒç´ éƒ½æ²’æœ‰è®Šã€‚ */
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

  /* æé‚Šèˆ‡ç™¼å…‰ã€‚å…©å¼µéƒ½åªè·Ÿå½¢ç‹€æœ‰é—œï¼Œæ‰€ä»¥åªåœ¨é‚£å¹¾å€‹å€¼è®Šå‹•æ™‚æ‰é‡ç®— â€”â€”
     å½±æ ¼å†æ€Žéº¼è·‘éƒ½ä¸æœƒç¢°åˆ°å®ƒå€‘ã€‚ */
  const deco = useMemo(
    () => videoDeco(image, boxW, boxH, Math.min(2, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxW, boxH, image.imgStrokeWidth, image.imgStrokeColor, image.imgStrokeDash, image.imgStrokeGap,
      image.imgGlow, image.imgGlowColor, image.imgRadius, image.feather, image.imgShape,
      image.scale, image.width, image.height],
  );

  /* âš  é€™è£¡**åªæœ‰ä¸€ç¨®å›žå‚³çµæ§‹**ï¼Œè€Œä¸”ä¸ç®¡æœ‰æ²’æœ‰å½¢ç‹€ï¼æé‚Šï¼ç™¼å…‰éƒ½ä¸€æ¨£ã€‚
     ä»¥å‰æ˜¯ä¾æƒ…æ³å›žå‚³ä¸‰ç¨®ä¸åŒæ·±åº¦çš„æ¨¹ï¼ˆè£¸ <video>ï¼åŒ…ä¸€å±¤ï¼åŒ…å…©å±¤ï¼‰â€”â€”
     åªè¦åœ¨é€™å¹¾ç¨®ä¹‹é–“åˆ‡æ›ï¼ŒReact å°±æœƒæŠŠ <video> æ‹†æŽ‰é‡å»ºï¼Œ
     è€Œé‡å»ºä¸€å€‹ <video> ç­‰æ–¼é‡æ–°è¼‰å…¥ï¼šç•«é¢æœƒç©ºä¸€ä¸‹ã€æ’­æ”¾ä¹Ÿå¾žé ­ä¾†ã€‚
     é‚£æ­£æ˜¯ã€Œèª¿æ•´å½±ç‰‡æ™‚å®ƒä¸€ç›´çŸ­æš«æ¶ˆå¤±ã€çš„å…¶ä¸­ä¸€å€‹ä¾†æºã€‚
     çµæ§‹å›ºå®šä¹‹å¾Œï¼Œåˆ‡æ›æ•ˆæžœåªæ˜¯æ›æ¨£å¼ï¼Œ<video> å¾žé ­åˆ°å°¾æ˜¯åŒä¸€å€‹ç¯€é»žã€‚

     å¤–å±¤åªè² è²¬å®šä½ï¼›ä¸­é–“é‚£å±¤æ‰æ˜¯åŽŸæœ¬é‚£å€‹ overflow:hidden ï¼‹ é®ç½©çš„ç›’å­ï¼›
     ç™¼å…‰åœ¨å½±ç‰‡åº•ä¸‹ã€æé‚Šåœ¨å½±ç‰‡ä¸Šé¢ï¼ˆè·ŸåŒ¯å‡ºçš„ç–Šæ³•ä¸€è‡´ï¼‰ã€‚
     å…‰æšˆèˆ‡æé‚Šæœƒé•·åˆ°æ¡†å¤–é¢ï¼Œæ‰€ä»¥å®ƒå€‘**ä¸èƒ½**æ”¾é€²ä¸­é–“é‚£å±¤ã€‚ */
  return (
    <div
      style={style
        ? { ...style, pointerEvents: 'none' }
        : { position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {deco.glow ? <DecoCanvas cv={deco.glow} pad={deco.pad} w={boxW} h={boxH} /> : null}
      {/* é®ç½©é‚£å¼µåœ–ä¹ŸæŽ›ä¸€ä»½åœ¨ç•«é¢ä¸Šï¼ˆ1pxã€çœ‹ä¸è¦‹ï¼‰ã€‚
          ä¸Šé¢é›–ç„¶å·²ç¶“ç­‰ decode() è§£å®Œæ‰æ›ä¸ŠåŽ»ï¼Œä½†è§£å¥½çš„é‚£å¼µåªæ´»åœ¨ä¸€å€‹å€åŸŸè®Šæ•¸è£¡ï¼Œ
          å›žæ”¶ä¹‹å¾Œ CSS å†è¦å°±å¾—é‡è§£ä¸€æ¬¡ â€”â€” é‡è§£çš„é‚£ä¸€å°æ®µ WebKit æœƒæŠŠæ•´å±¤ç•¶æˆ
          ã€Œé®ç½©æ˜¯ç©ºçš„ã€è€Œä¸è¦‹ï¼Œä¹Ÿå°±æ˜¯ç¾½åŒ–å¶çˆ¾é–ƒä¸€ä¸‹ã€‚æŽ›è‘—å°±ä¸€ç›´æ˜¯è§£å¥½çš„ç‹€æ…‹ã€‚ */}
      {liveMask ? (
        <img src={liveMask} alt="" aria-hidden="true"
             style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      ) : null}
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
          /* è£åˆ‡éŽå°±è¦åˆ‡æŽ‰æ¡†å¤–çš„éƒ¨åˆ†ï¼›å–®ç´”åœ“è§’ç”¨ border-radius ï¼‹ overflow å¤¾ä½ï¼Œ
             ä¸å¿…å‹•ç”¨åœ–ç‰‡é®ç½©ï¼ˆè¦‹ä¸Šé¢ cssRadius çš„èªªæ˜Žï¼‰ã€‚ */
          /* å¥—äº†å½¢ç‹€åˆæ”¾å¤§æ™‚ï¼Œå¤šå‡ºä¾†çš„éƒ¨åˆ†ä¹Ÿåœ¨é€™è£¡åˆ‡æŽ‰ï¼ˆé®ç½©æœ¬ä¾†å°±æœƒæ“‹ï¼Œ
             é€™ä¸€è¡Œæ˜¯ä¿éšªï¼Œå…å¾—æ”¾å¤§å¾ˆå¤šå€æ™‚è“‹åˆ°éš”å£åœ–å±¤ï¼‰ã€‚ */
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
 * å½±ç‰‡çš„é¡è‰²éˆï¼ˆæ¿¾é¡ï¼èª¿ç¯€ï¼‰äº¤çµ¦ GPUã€‚
 *
 * æ¯ä¾†ä¸€æ ¼æ–°å½±æ ¼å°±ä¸Šä¸€æ¬¡æè³ªã€æŸ¥ä¸€æ¬¡çƒ¤å¥½çš„ 33Â³ è‰²è¡¨ã€ç•«åœ¨è‡ªå·±çš„ç•«å¸ƒä¸Šï¼Œ
 * é‚£å¼µç•«å¸ƒ**ç›´æŽ¥æŽ›åœ¨ç‰ˆé¢ä¸Šè®“ç€è¦½å™¨åˆæˆ** â€”â€” å…¨ç¨‹æ²’æœ‰ä»»ä½•ä¸€æ¬¡å›žè®€ã€‚
 *
 * ç”¨ requestVideoFrameCallback è€Œä¸æ˜¯ rAFï¼šå®ƒæ˜¯ã€ŒçœŸçš„æœ‰æ–°å½±æ ¼æ‰å«æˆ‘ã€ï¼Œ
 * æ‰€ä»¥ 25fps çš„ç´ æå°±ç•« 25 æ¬¡ï¼Œä¸æœƒç‚ºäº†åŒä¸€æ ¼ç•«å…©éã€‚
 * èˆŠ Safari æ²’æœ‰é€™æ”¯å°±é€€å›ž rAFï¼Œè¡Œç‚ºä¸€æ¨£ï¼Œåªæ˜¯æœƒå¤šç•«å¹¾æ¬¡ã€‚
 *
 * ï¼ˆé€™ä¸€æ®µæœ¬ä¾†ç›´æŽ¥å¯«åœ¨ FloatingImageComponent è£¡é¢ï¼Œå…§å®¹ä¸€è¡Œéƒ½æ²’æœ‰æ”¹ï¼Œ
 *   åªæ˜¯æ‹‰å‡ºä¾†è®Šæˆä¸€æ”¯å…·åçš„ hookï¼Œè®€èµ·ä¾†æ¸…æ¥šä¸€é»žã€‚ï¼‰
 */
const useVideoFxGl = (
  videoRef: React.MutableRefObject<HTMLVideoElement | null>,
  fx: any, lutRevision: number, boxW: number, boxH: number, dpr: number,
  want: boolean,
) => {
  const glRef = useRef<VideoGl | null>(null);
  const glFxKeyRef = useRef('');
  /** ç‰¹æ•ˆé‚£ä¸€ä¸²è‡ªå·±çš„éµï¼ˆè·Ÿé¡è‰²åˆ†é–‹ï¼‰ */
  const glFxOnlyKeyRef = useRef('');
  /** ä¸Šä¸€æ¬¡æ›æ•¸å€¼çš„æ™‚é–“ â€”â€” æ‰‹åœä¸‹ä¾†ä¹‹å¾Œæ‰è£œå®Œæ•´çš„é‚£é¡†è¡¨ */
  const fxChangedAtRef = useRef(0);
  /** ç¾åœ¨æ‰‹ä¸Šé€™é¡†æ˜¯ä¸æ˜¯ã€Œæ‹–æ›³ç”¨çš„ç²—è¡¨ã€ */
  const fxCoarseRef = useRef(false);
  const glLiveRef = useRef(false);
  /** é€£çºŒç•«æˆåŠŸå¹¾æ ¼äº† â€”â€” è¦æ»¿ä¸‰æ ¼æ‰è®“ç•«å¸ƒé¡¯å½¢ï¼ˆè¦‹ä¸‹é¢çš„èªªæ˜Žï¼‰ */
  const glReadyRef = useRef(0);
  const [glDead, setGlDead] = useState(false);
  const [glLive, setGlLive] = useState(false);
  const [glCanvas, setGlCanvas] = useState<HTMLCanvasElement | null>(null);
  const on = want && !glDead;
  /* fx æ˜¯å€‹ç‰©ä»¶ï¼Œæ¯æ¬¡ render éƒ½æ˜¯æ–°çš„ä¸€ä»½ â€”â€” ç›´æŽ¥æ”¾é€²ç›¸ä¾é™£åˆ—çš„è©±ï¼Œ
     é€™æ”¯ effect æ¯ä¸€æ¬¡ render éƒ½æœƒè¢«æ‹†æŽ‰é‡å»ºï¼Œè€Œé‡å»ºæœƒç«‹åˆ»å†è·‘ä¸€æ¬¡ step()ã€‚
     æ‹–æ»‘æ¡¿æ™‚ React ä¸€ç§’ render å…­åæ¬¡ï¼Œæ–¼æ˜¯çƒ¤è¡¨ä¹Ÿè·Ÿè‘—è®Šæˆä¸€ç§’å…­åæ¬¡ã€‚
     æ”¹æˆåªèªã€Œå…§å®¹æœ‰æ²’æœ‰è®Šã€çš„å­—ä¸²ï¼Œå€¼æœ¬èº«ç”¨ ref æ‹¿æœ€æ–°çš„ã€‚ */
  const fxKey = JSON.stringify(fx || null);
  const fxRef = useRef(fx);
  fxRef.current = fx;
  /* æ•ˆæžœè¢«æ¸…å…‰æ™‚æŠŠæ——å­æ”¾æŽ‰ï¼šä¸‹æ¬¡å†å¥—æ•ˆæžœï¼Œåº•ä¸‹çš„ <video> è¦èƒ½å…ˆé ‚è‘—ï¼Œ
     ä¸ç„¶æœƒæœ‰ä¸€æ ¼ç©ºç™½ã€‚ */
  if (!want && glLiveRef.current) glLiveRef.current = false;
  /* é€™ä¸€å±¤æ”¶æŽ‰æ™‚æŠŠ GL ä¸Šä¸‹æ–‡ä¸€èµ·æ”¶æŽ‰ã€‚ä¸æ”¶çš„è©±æ¯å€‹å½±ç‰‡åœ–å±¤éƒ½ä½”è‘—ä¸€å€‹ï¼Œ
     ç€è¦½å™¨å°åŒæ™‚å­˜åœ¨çš„ WebGL ä¸Šä¸‹æ–‡æ•¸é‡æ˜¯æœ‰ä¸Šé™çš„ï¼ˆè¶…éŽå°±æ•´æ‰¹è¢«æ”¶èµ°ï¼‰ã€‚ */
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
      /* â”€â”€ æŸ¥è‰²è¡¨åªåœ¨ã€Œæ›æ¿¾é¡ï¼å‹•æ»‘æ¡¿ã€æ™‚é‡çƒ¤ï¼Œè·Ÿå½±æ ¼æ•¸ç„¡é—œ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
         ä½†ã€Œå‹•æ»‘æ¡¿ã€æ™‚æ¯ä¸€æ ¼éƒ½æœƒæ›ä¸€æ¬¡æ•¸å€¼ï¼Œè€Œçƒ¤ä¸€é¡† 33Â³ çš„è¡¨åœ¨æ‰‹æ©Ÿç­‰ç´šçš„
         CPU ä¸Šè¦ 8ï½ž11 æ¯«ç§’ï¼ˆå¼·åº¦ä¸æ˜¯ 100 æ™‚è¦çƒ¤å…©é¡†ï¼ŒÃ—2ï¼‰â€”â€”
         ä¸€ç§’ 30 æ ¼å°±åƒæŽ‰ä¸‰åˆ†ä¹‹ä¸€æ¢ä¸»åŸ·è¡Œç·’ï¼Œé‚£æ­£æ˜¯ã€Œå½±ç‰‡çš„èª¿æ•´æ»‘æ¡¿å¾ˆå¡ã€ã€‚

         æ”¹æˆå…©æ®µï¼šæ‰‹æŒ‡åœ¨å‹•çš„æ™‚å€™çƒ¤ 17Â³ï¼ˆåªè¦ååˆ†ä¹‹ä¸€çš„æˆæœ¬ï¼Œè‚‰çœ¼çœ‹ä¸å‡ºå·®åˆ¥ï¼‰ï¼Œ
         åœä¸‹ä¾† 180 æ¯«ç§’ä¹‹å¾Œå†è£œä¸€é¡†å®Œæ•´çš„ 33Â³ã€‚
         æ‰€ä»¥ã€Œæ‹–çš„æ™‚å€™é †ã€æ”¾æ‰‹ä¹‹å¾Œç²¾æº–ã€ï¼Œè€ŒåŒ¯å‡ºæ°¸é èµ°çš„æ˜¯å¦ä¸€æ¢å®Œæ•´çš„è·¯ã€‚ */
      const cur = fxRef.current;
      /* âš  åªèªã€Œé¡è‰²ã€é‚£å¹¾å€‹æ¬„ä½ã€‚ä»¥å‰æ˜¯æ•´åŒ… fx ç•¶éµï¼Œæ‰€ä»¥æ‹–ç‰¹æ•ˆå¼·åº¦ã€åœ“è§’ã€
         ç¾½åŒ–é€™äº›è·Ÿé¡è‰²ç„¡é—œçš„æ»‘æ¡¿æ™‚ï¼Œæ¯ä¸€æ ¼ä¹Ÿæœƒé‡çƒ¤ä¸€é¡†è¡¨ï¼ˆç™½èŠ± 8ï½ž11 æ¯«ç§’ï¼‰ã€‚ */
      const key = `${colorKeyOf(cur)}|${lutRevision}`;
      const now = performance.now();
      if (key !== glFxKeyRef.current) {
        glFxKeyRef.current = key;
        fxChangedAtRef.current = now;
        fxCoarseRef.current = true;
        gl.setLut(bakePhotoFxLut(cur, 17));
        /* ç‰¹æ•ˆï¼ˆæœ¦æœ§ï¼å‹•æ…‹æ¨¡ç³Šï¼VHSï¼é¦¬è³½å…‹â€¦ï¼‰ï¼šå®ƒå€‘ä¸æ˜¯é¡è‰²ï¼Œå¡žä¸é€²æŸ¥è‰²è¡¨ï¼Œ
           æ‰€ä»¥å¦å¤–äº¤çµ¦ videoGl çš„ç‰¹æ•ˆéˆè·‘ï¼ˆè·Ÿç…§ç‰‡åŒä¸€ä»½è‘—è‰²å™¨ï¼‰ã€‚ */
      }
      /* ç‰¹æ•ˆé‚£ä¸€ä¸²è·Ÿé¡è‰²æ˜¯å…©å›žäº‹ï¼Œå„è‡ªèªè‡ªå·±çš„éµ */
      const fk = JSON.stringify(cur || null);
      if (fk !== glFxOnlyKeyRef.current) {
        glFxOnlyKeyRef.current = fk;
        gl.setFx(cur, getNoisePattern());
      }
      if (fxCoarseRef.current && now - fxChangedAtRef.current > 180) {
        fxCoarseRef.current = false;
        gl.setLut(bakePhotoFxLut(cur, 33));
      }
      /* ç•«å‡ºä¾†çš„å¤§å°ï¼ç•«é¢ä¸ŠçœŸæ­£çš„å¯¦é«”åƒç´ ã€‚è£åˆ‡éŽçš„è©±ï¼Œç‰ˆé¢æ˜¯æŠŠã€Œæ•´æ ¼ã€
         æ”¾å¤§ä¹‹å¾Œå†ç”¨ overflow åˆ‡ï¼Œæ‰€ä»¥é€™è£¡è¦ç…§é‚£å€‹æ”¾å¤§å¾Œçš„å°ºå¯¸é–‹ã€‚
         å¹¾ä½•å®Œå…¨äº¤çµ¦ VideoLayer æ—¢æœ‰çš„é‚£ä»½ CSSï¼ˆgeoCssBoxï¼‰ï¼Œé€™è£¡åªç®¡åƒç´ ã€‚ */
      /* âš  å°ºå¯¸**åªèƒ½**å•ã€Œé€™å¼µç•«å¸ƒçœŸæ­£è¢«æ“ºåœ¨å“ªå€‹æ¡†è£¡ã€ã€‚
         ä»¥å‰é‡ä¸åˆ°å°±é€€å›ž boxW/boxHï¼ˆåœ–å±¤æ¡†ï¼‰â€”â€” ä½†è£åˆ‡éŽçš„åœ–å±¤ï¼Œé‚£å…©å€‹æ•¸å­—
         è·Ÿç•«å¸ƒå¯¦éš›è¢«æ‹‰ä¼¸åˆ°çš„å¤§å°é•·å¯¬æ¯”æ˜¯ä¸ä¸€æ¨£çš„ï¼Œç•«å‡ºä¾†å°±è¢«å£“æ‰ã€‚
         è€Œã€Œé‡ä¸åˆ°ã€æ˜¯çœŸçš„æœƒç™¼ç”Ÿï¼šæŠŠæ¿¾é¡åˆ‡å›žåŽŸå§‹æ™‚é€™å¼µç•«å¸ƒæœƒè¢«æ‹”ä¸‹ä¾†ï¼Œ
         ä¸‹æ¬¡å†å¥—æ¿¾é¡çš„é‚£ä¸€æ ¼å®ƒé‚„æ²’è¢«æŽ›å›žåŽ»ï¼ŒparentElement å°±æ˜¯ nullã€‚
         ç¾åœ¨æ”¹æˆé‡ä¸åˆ°å°±é€™ä¸€æ ¼ä¸ç•«ï¼ˆåº•ä¸‹çš„ <video> é‚„åœ¨é ‚è‘—ï¼Œç•«é¢ç…§å¸¸ï¼‰ã€‚ */
      const el = gl.canvas.parentElement;
      const cw = el ? el.clientWidth : 0;
      const ch = el ? el.clientHeight : 0;
      if (cw > 0 && ch > 0) {
        const w = Math.max(1, Math.round(cw * dpr));
        const h = Math.max(1, Math.round(ch * dpr));
        /* ã€Œç•«å‡ºä¾†äº†æ²’ã€è¦**æ¯ä¸€æ ¼**éƒ½è·Ÿè‘—èµ°ï¼Œä¸æ˜¯åªèªç¬¬ä¸€æ¬¡æˆåŠŸã€‚
           ç‰¹æ•ˆå‰›æ‰“é–‹çš„é‚£å¹¾æ ¼è‘—è‰²å™¨é‚„åœ¨ç·¨ã€æè³ªé‚„æ²’é…å¥½ï¼ŒdrawFrame æœƒå›ž false
           è€Œç•«å¸ƒæ˜¯è¢«æ¸…ç©ºçš„ â€”â€” é€™æ™‚å€™ä¸€å®šè¦è®“åº•ä¸‹çš„ <video> å›žä¾†é ‚è‘—ï¼Œ
           ä¸ç„¶é‚£ä¸€æ ¼çœ‹åˆ°çš„æ˜¯èƒŒæ™¯è‰²ï¼ˆé»‘åº•å°±æ˜¯é–ƒé»‘ï¼‰ã€‚

           âš  ã€Œé¡¯å½¢ã€é‚„è¦å¤šç­‰å…©æ ¼ã€‚ç•«å¸ƒæ˜¯æ–°é•·å‡ºä¾†çš„ä¸€å±¤ï¼Œåˆæˆå™¨ç¬¬ä¸€æ¬¡
           æŠŠå®ƒæŽ’é€²ç•«é¢æ™‚é‚£ä¸€æ ¼æ˜¯é»‘çš„ï¼ˆå¯¦æ¸¬ï¼šç¬¬ä¸€æ¬¡å¥—ç‰¹æ•ˆå¿…å®šé»‘ä¸€æ ¼ï¼Œ
           ç¬¬äºŒæ¬¡ä»¥å¾Œå®Œå…¨ä¸æœƒ â€”â€” å› ç‚ºé‚£æ™‚å€™é€™ä¸€å±¤æ—©å°±åœ¨äº†ï¼‰ã€‚
           è®“å®ƒå…ˆåœ¨**çœ‹ä¸è¦‹**çš„ç‹€æ…‹ä¸‹è¢«ç•«ä¸Šå…©ä¸‰æ ¼ï¼Œåˆæˆå™¨æŠŠé€™ä¸€å±¤æº–å‚™å¥½ä¹‹å¾Œ
           æ‰é¡¯å½¢ï¼Œé‚£ä¸€æ ¼é»‘å°±ç™¼ç”Ÿåœ¨æ²’äººçœ‹å¾—åˆ°çš„æ™‚å€™ã€‚
           åéŽä¾†ä¸€å¤±æ•—å°±ç«‹åˆ»æ”¶å›žåŽ»ï¼Œä¸å¿…ç­‰ã€‚ */
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
      /* é‚„æ²’æŽ›ä¸ŠåŽ»ï¼šç”¨ rAF å†å•ä¸€æ¬¡ï¼ˆä¸èƒ½ç”¨ rVFC â€”â€” å½±ç‰‡åœè‘—å°±æ°¸é ç­‰ä¸åˆ°ä¸‹ä¸€æ ¼ï¼‰ */
      handle = requestAnimationFrame(step);
    };
    step();
    return () => {
      live = false;
      try {
        if (useRvfc) anyV.cancelVideoFrameCallback?.(handle);
        else cancelAnimationFrame(handle);
      } catch { /* æ”¶ä¸æŽ‰å°±ç®—äº† */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, fxKey, lutRevision, boxW, boxH, dpr, videoRef]);
  return { glCanvas: on ? glCanvas : null, glLive, glDead };
};

/** æŠŠä¸€å¼µã€Œä¸æ˜¯ React ç”Ÿçš„ã€ç•«å¸ƒæŽ›é€²ç‰ˆé¢è£¡ï¼Œæ¨£å¼ç…§çµ¦ã€‚ */
const GlCanvasHost: React.FC<{ canvas: HTMLCanvasElement; style: React.CSSProperties }> = ({ canvas, style }) => {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const h = host.current;
    if (!h) return;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    h.appendChild(canvas);
    return () => { try { h.removeChild(canvas); } catch { /* å·²ç¶“ä¸åœ¨äº† */ } };
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
    dragLocalX: number;
    dragLocalY: number;
    oppositeLocalX: number;
    oppositeLocalY: number;
    rotationRad: number;
  } | null>(null);
  const stretchStart = useRef<{
    pointerId: number; side: 't' | 'r' | 'b' | 'l'; startX: number; startY: number;
    width: number; height: number; x: number; y: number; rotationRad: number;
  } | null>(null);

  /* iOS å¶å°”ä¼šæŠŠæœ€åŽä¸€ä¸ª pointerup/touchend é€åˆ°è¢«é‡æ–°åˆæˆåŽçš„ç¥–å…ˆï¼Œè€Œä¸æ˜¯
     èµ·æ‰‹çš„ç‰©ä»¶èŠ‚ç‚¹ã€‚å±€éƒ¨ isDragging/isScaling è‹¥å› æ­¤å¡ä½ï¼Œå¤–æ¡†å’Œè¯ä¸¸å°±æ°¸è¿œ
     è¿‡ä¸äº†æ˜¾ç¤ºæ¡ä»¶ã€‚å’Œåˆ›æ„æ‹¼å›¾ä¸€æ ·åŠ å…¨åŸŸå…œåº•ï¼›å»¶åŽä¸€æ ¼è®©æ­£å¸¸çš„å±€éƒ¨æ”¶å°¾å…ˆè·‘ã€‚ */
  useEffect(() => {
    /* ç›‘å¬å™¨å¿…é¡»åœ¨æ‰‹åŠ¿å¼€å§‹å‰å°±å­˜åœ¨ã€‚è‹¥ç­‰ isDragging/isScaling render åŽæ‰æŒ‚ï¼Œ
       æžå¿«çš„æŒ‰ä¸‹ï¼æ”¾å¼€å¯èƒ½å·²é”™è¿‡ pointerupï¼Œé€‰ä¸­æ¡†ä¾¿ä¼šä¸€ç›´éšè—ã€‚ */
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        dragStart.current = null;
        rotateStart.current = null;
        scaleStart.current = null;
        stretchStart.current = null;
        setIsDragging(false);
        setIsScaling(false);
      }, 0);
    };
    const finishTouch = (e: TouchEvent) => { if (e.touches.length === 0) finish(); };
    const finishVisibility = () => { if (document.visibilityState !== 'visible') finish(); };
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('touchend', finishTouch, true);
    window.addEventListener('touchcancel', finishTouch, true);
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', finishVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('touchend', finishTouch, true);
      window.removeEventListener('touchcancel', finishTouch, true);
      window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', finishVisibility);
    };
  }, []);

  /** ç•«å¸ƒç¸®æ”¾å€çŽ‡ï¼›æ²’å‚³å°±æ˜¯ 1ï¼ˆï¼è·Ÿä»¥å‰ä¸€æ¨¡ä¸€æ¨£ï¼‰ */
  const canvasK = () => (canvasKRef?.current || 1);

  const getClientCenter = () => {
    if (!pagesContainerRef.current) return { x: 0, y: 0 };
    const containerRect = pagesContainerRef.current.getBoundingClientRect();
    // å®¹å™¨çš„ rect æ˜¯èž¢å¹•åº§æ¨™ï¼Œç‰©ä»¶çš„ xï¼y æ˜¯å…§å®¹åº§æ¨™ â€”â€” è¦å…ˆä¹˜ä¸Šå€çŽ‡æ‰å°å¾—èµ·ä¾†
    const k = canvasK();
    const cx = containerRect.left + (image.x + (image.width * image.scale) / 2) * k;
    const cy = containerRect.top + (image.y + (image.height * image.scale) / 2) * k;
    return { x: cx, y: cy };
  };

  const touchStart = useRef<{ x: number, y: number, time: number, pointerId: number } | null>(null);

  // æ–‡å­—åœ–å±¤çš„æ¡†è·Ÿè‘—å…§å®¹è²¼åˆï¼Œé¸å–æ¡†æ‰ä¸æœƒé›¢å­—å¤ªé 
  const textRef = useRef<HTMLDivElement>(null);
  const textInnerRef = useRef<HTMLSpanElement>(null);
  const textMeasureRef = useRef<HTMLSpanElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  /* è¼¸å…¥æ¡†æ˜¯ã€Œæ‰‹æŒ‡æ”¾é–‹ã€é‚£ä¸€åˆ»æ‰æ‰“é–‹çš„ï¼Œè€Œç€è¦½å™¨åœ¨ touchend ä¹‹å¾Œé‚„æœƒè£œé€
     ä¸€è¼ªæ»‘é¼ äº‹ä»¶ï¼ˆmousedown/clickï¼‰åˆ°ç•«å¸ƒä¸Š â€”â€” é‚£ä¸€ä¸‹æœƒæŠŠç„¦é»žå¾žå‰›å†’å‡ºä¾†çš„
     è¼¸å…¥æ¡†æ¶èµ°ï¼Œçœ‹èµ·ä¾†å°±æ˜¯éµç›¤é–ƒä¸€ä¸‹åˆæ”¶æŽ‰ã€å­—ä¹Ÿæ‰“ä¸é€²åŽ»ã€‚
     è¨˜ä¸‹æ‰“é–‹çš„æ™‚é–“ï¼ŒåŒä¸€ä¸‹æ‰‹å‹¢é€ æˆçš„å¤±ç„¦å°±ä¸ç®—æ•¸ï¼ˆè¦‹ä¸‹é¢ textarea çš„ onBlurï¼‰ã€‚ */
  const textOpenAt = useRef(0);

  // é€²å…¥ç•«å¸ƒä¸Šæ‰“å­—æ™‚æŠŠæ¸¸æ¨™ç§»åˆ°æœ€å¾Œé¢ï¼Œä¸¦å«å‡ºåŽŸç”Ÿéµç›¤ã€‚
  // å…§å®¹é‚„æ˜¯é è¨­çš„ã€Œè¼¸å…¥æ–‡å­—ã€å°±å…ˆæ¸…ç©º â€”â€” ä½¿ç”¨è€…ä¸ç”¨è‡ªå·±ä¸€å€‹å­—ä¸€å€‹å­—åˆªã€‚
  useEffect(() => {
    if (!isTextEditing) return;
    textOpenAt.current = performance.now();
    if (image.text === TEXT_PLACEHOLDER) onChange({ text: '' });
    const el = textAreaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const n = el.value.length;
    try { el.setSelectionRange(n, n); } catch {}
  }, [isTextEditing]);

  // æ‰“å®Œä»€éº¼éƒ½æ²’ç•™å°±æŠŠé è¨­å­—æ”¾å›žåŽ»ï¼Œåœ–å±¤æ‰ä¸æœƒè®Šæˆçœ‹ä¸è¦‹çš„ç©ºæ¡†ã€‚
  // ç¬¦è™Ÿæ”¾å›žåŽ»çš„æ˜¯é‚£é¡†ç¬¦è™Ÿæœ¬èº« â€”â€” åˆªéŽé ­äº†ä¹Ÿé‚„æ•‘å¾—å›žä¾†ã€‚
  const prevTextEditing = useRef(isTextEditing);
  useEffect(() => {
    if (prevTextEditing.current && !isTextEditing && image.text === '') {
      onChange({ text: image.sym || TEXT_PLACEHOLDER });
    }
    prevTextEditing.current = isTextEditing;
  }, [isTextEditing, image.text]);
  // é‡æ¸¬ç”¨çš„æ˜¯å¦ä¸€å€‹ã€Œæ°¸é  1 å€å¤§ã€çš„éš±è— spanï¼Œè·Ÿ scale å®Œå…¨è„«é‰¤ã€‚
  //
  // è€Œä¸”åªæœ‰ã€ŒçœŸçš„æœƒæ”¹è®ŠæŽ’ç‰ˆçš„æ±è¥¿ã€è®Šäº†æ‰é‡ï¼šä»¥å‰ onChange æ˜¯è¡Œå…§ç®­é ­å‡½å¼ï¼Œ
  // æ¯æ¬¡ render éƒ½æ˜¯æ–°çš„åƒè€ƒï¼Œæåˆçš„æ¯ä¸€æ ¼éƒ½æœƒè·‘é€²ä¾†å¼·åˆ¶åŒæ­¥ reflow
  // ï¼ˆoffsetWidth/offsetHeightï¼‰ï¼Œæ‰‹æ©Ÿä¸Šå°±æ˜¯ä¸€é‚Šç¸®æ”¾ä¸€é‚ŠæŠ–ã€‚
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dimsRef = useRef({ w: image.width, h: image.height });
  dimsRef.current = { w: image.width, h: image.height };

  /* é€™è£¡ä¸€å®šè¦ç”¨ useLayoutEffectï¼Œä¸èƒ½ç”¨ useEffectã€‚
     useEffect æ˜¯ã€Œç•«å®Œæ‰è·‘ã€ï¼šæ”¹å­—ç´šé‚£ä¸€å¹€æœƒå…ˆç”¨ã€Žæ–°å­—ç´š + èˆŠå¯¬é«˜ã€ç•«å‡ºä¾†ï¼Œ
     ä¸‹ä¸€å¹€é‡åˆ°æ–°å¯¬é«˜æ‰ä¿®æ­£ â€”â€” æ‹‰æ»‘æ¡¿æ™‚æ¯ä¸€æ ¼éƒ½é–ƒä¸€ä¸‹ï¼Œå°±æ˜¯é€™å€‹ä¸€å¹€è½å·®ã€‚
     useLayoutEffect åœ¨ç€è¦½å™¨ç•«ä¹‹å‰å°±é‡å®Œä¸¦æ”¹å¥½ï¼ŒéŒ¯çš„é‚£ä¸€å¹€æ ¹æœ¬ä¸æœƒä¸Šç•«é¢ã€‚ */
  useLayoutEffect(() => {
    if (image.text === undefined) return;
    if (image.sym) {
      let alive = true;
      const fam = (image.sym ? SYMBOL_FONT : (image.fontFamily || DEFAULT_FONT));
      /* ä¸Žåˆ›æ„æ‹¼å›¾å®Œå…¨åŒæºï¼šæ–°å¢žã€æ˜¾ç¤ºã€å‘½ä¸­å’Œé€‰ä¸­æ¡†éƒ½ä½¿ç”¨ symbolBox /
         measureSymbolInkã€‚ä»¥å‰è¿™é‡Œåˆç”¨ SVG getBBox è¦†ç›–ä¸€æ¬¡å°ºå¯¸ï¼Œç­‰äºŽåŒä¸€ä¸ª
         ç¬¦å·åŒæ—¶æ‹¥æœ‰ Canvas ä¸Ž SVG ä¸¤å¥—è¾¹ç•Œï¼Œæ”¾å¤§åŽæ¡†å¿…ç„¶é€æ¸å¯¹ä¸ä¸Šã€‚ */
      ensureFont(fam).then(() => {
        if (!alive) return;
        /* æ–°å¢žç¬¦è™Ÿæ™‚å·²åœ¨çœŸæ­£å­—é«”è¼‰å…¥å¾Œé‡éŽåŒä¸€å€‹å­—ç´šï¼›æ²¿ç”¨è©²å¿«å–ï¼Œ
           ä¸åœ¨é¦–æ¬¡é¡¯ç¤ºï¼æ‹–å‹•å‰é‡æ–°æŽƒææ•´å¼µ alpha ç•«å¸ƒã€‚æ­·å²è³‡æ–™è‹¥å°šæœª
           æœ‰å¿«å–ï¼Œé€™è£¡ä»æœƒæ­£å¸¸é‡ä¸€æ¬¡ã€‚ */
        const size = image.fontSize || 40;
        const ink = measureSymbolStickerInk(image.text || image.sym!, fam);
        const bounds = { w: Math.max(6, ink.w * size + 8), h: Math.max(6, ink.h * size + 8) };
        const patch: Partial<FloatingImage> = {};
        const nw = bounds.w, nh = bounds.h;
        if (Math.abs(nw - dimsRef.current.w) > 0.1) {
          patch.width = nw;
          patch.x = image.x + (dimsRef.current.w - nw) / 2;
        }
        if (Math.abs(nh - dimsRef.current.h) > 0.1) {
          patch.height = nh;
          patch.y = image.y + (dimsRef.current.h - nh) / 2;
        }
        if (patch.width !== undefined || patch.height !== undefined) onChangeRef.current(patch);
      });
      return () => { alive = false; };
    }
    const el = textMeasureRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const patch: Partial<FloatingImage> = {};
      if (Math.abs(w - dimsRef.current.w) > 1) patch.width = Math.round(w);
      if (Math.abs(h - dimsRef.current.h) > 1) patch.height = Math.round(h);
      if (patch.width !== undefined || patch.height !== undefined) onChangeRef.current(patch);
    };
    /* æ›å­—é«”ï¼æ›æ–œé«”æœƒæŠ–ä¸€ä¸‹ï¼Œæ˜¯å› ç‚ºæ–°çš„å­—èº«é‚„æ²’ä¸‹è¼‰å®Œã€‚é€™æ™‚å€™é‡åˆ°çš„æ˜¯
       é€€å›žå­—é«”çš„å¯¬é«˜ï¼Œå…ˆæŠŠæ¡†æ”¹æˆé‚£å€‹å°ºå¯¸ã€ç­‰å­—èº«åˆ°äº†å†æ”¹å›žä¾† â€”â€” ä½¿ç”¨è€…çœ‹åˆ°
       çš„å°±æ˜¯ã€Œè·³ä¸€æ¬¡åˆè·³å›žä¾†ã€ã€‚
       æ‰€ä»¥ï¼šå­—èº«å·²ç¶“åœ¨æ‰‹ä¸Šæ‰ç«‹åˆ»é‡ï¼›é‚„æ²’åœ¨çš„è©±é€™ä¸€è¼ªå…ˆä¸å‹•æ¡†ï¼Œç­‰çœŸçš„è¼‰å¥½
       å†é‡ä¸€æ¬¡ï¼Œæ¡†å°±åªæœƒè®Šä¸€æ¬¡ã€‚ */
    const fam = (image.sym ? SYMBOL_FONT : (image.fontFamily || DEFAULT_FONT));
    const spec = `${image.italic ? 'italic ' : ''}${image.bold ? 700 : 400} ${(image.fontSize || 40)}px "${fam}"`;
    const fontsApi = typeof document !== 'undefined' ? document.fonts : undefined;
    // CSS é‚„æ²’åˆ°çš„æ™‚å€™ @font-face é‚„ä¸å­˜åœ¨ï¼Œcheck æœƒæ‹¿åˆ°ã€Œå¯ä»¥ã€çš„å‡ç­”æ¡ˆï¼Œ
    // æ‰€ä»¥è¦å…ˆç¢ºèª CSS çœŸçš„ä¸‹è¼‰å®Œäº†æ‰ä¿¡å®ƒã€‚
    /* æ–œé«”é‚„è¦å¤šç¢ºèªä¸€ä»¶äº‹ï¼šæ–œé«”çš„ CSS ä¹Ÿå›žä¾†äº†æ²’ã€‚CSS é‚„æ²’åˆ°çš„æ™‚å€™
       æ–œé«”çš„ @font-face æ ¹æœ¬ä¸å­˜åœ¨ï¼Œcheck æœƒé…åˆ°ç³»çµ±çš„å‡æ–œé«”ç„¶å¾Œå›žã€Œå¯ä»¥ã€ï¼Œ
       é‡åˆ°çš„å°±æ˜¯å‡æ–œé«”çš„å¯¬é«˜ã€‚ */
    const italicSettled = !image.italic || knownItalic(fam) !== undefined;
    const ready = !fontsApi || (fontCssLoaded(fam) && italicSettled && fontsApi.check(spec));
    if (ready) { measure(); return; }

    let alive = true;
    const done = () => { if (alive) measure(); };
    Promise.all([ensureFont(fam), image.italic ? ensureItalic(fam) : Promise.resolve()])
      .then(() => fontsApi!.load(spec))
      .then(done, done);
    // çœŸçš„è¼‰ä¸åˆ°ï¼ˆé›¢ç·šã€å®¶æ—åæ‰“éŒ¯ï¼‰å°±åˆ¥è®“æ¡†æ°¸é åœåœ¨èˆŠå°ºå¯¸
    const t = setTimeout(done, 3000);
    return () => { alive = false; clearTimeout(t); };
  }, [image.text, image.sym, image.fontFamily, image.fontSize, image.bold, image.italic, image.letterSpacing, image.strokeWidth, maxTextWidth]);

  /* åœ“è§’ï¼ç¾½åŒ–ï¼ç™¼å…‰éƒ½è‡ªå·±ç•«åœ¨ canvas ä¸Šï¼Œé è¦½èˆ‡åŒ¯å‡ºèµ°åŒä¸€å¥—é‚è¼¯ */
  const shapeCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveImageCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveImageScratchRef = useRef<HTMLCanvasElement | null>(null);
  /* å…©å€‹ dpr æ˜¯ä¸åŒçš„æ±è¥¿ï¼Œä¹‹å‰æ··ç”¨æ˜¯éŒ¯çš„ï¼š
       geoDpr â€”â€” èž¢å¹•ã€ŒçœŸæ­£ã€çš„å¯¦é«”åƒç´ å¯†åº¦ã€‚ç‰ˆé¢ç›’è¦å¸åˆ°å®ƒçš„æ ¼ç·šä¸Šæ‰å«å°é½Šï¼›
                 iPhone å¸¸è¦‹æ˜¯ 3ï¼Œä¹‹å‰æ‹¿è¢«ä¸Šé™ç åˆ° 2 çš„é‚£å€‹åŽ»å¸ç­‰æ–¼å¸åˆ°åŠæ ¼ï¼Œ
                 åœ¨ 3 å€èž¢å¹•ä¸Šæ ¹æœ¬æ²’å°é½Šï¼Œç¸®æ”¾æ™‚ç…§æ¨£æ²¿è·¯ç•™æ®˜å½±ã€‚
       shapeDpr â€”â€” åªæ±ºå®š canvas å…§éƒ¨è¦é–‹å¹¾å€‹åƒç´ ï¼ˆä¸Šé™ 2 æ˜¯è¨˜æ†¶é«”è€ƒé‡ï¼‰ã€‚ */
  const geoDpr = Math.min(4, Math.max(1, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
  // é è¦½æ”¾å¤§å¾Œä¹ŸæŒ‰å¯¦éš›èž¢å¹•åƒç´ é‡ç•«ï¼Œè€Œä¸æ˜¯æŠŠåŽŸæœ¬çš„ä½Žè§£æžç•«å¸ƒç¡¬æ‹‰å¤§ã€‚
  const shapeDpr = Math.min(4, geoDpr * Math.max(1, canvasK()));
  /** æŠŠé•·åº¦å¸åˆ°æ•´æ•¸å€‹å¯¦é«”åƒç´ ï¼ˆè¦‹ wrapGeo çš„èªªæ˜Žï¼‰ */
  const snapPx = (v: number) => Math.round(v * geoDpr) / geoDpr;
  /** å¸åˆ°ã€Œå¶æ•¸å€‹ã€å¯¦é«”åƒç´  â€”â€” é€™æ¨£ä¸€åŠä¹Ÿé‚„è½åœ¨æ ¼ç·šä¸Šï¼ˆè¦‹ wrapGeoï¼‰ */
  const snapPx2 = (v: number) => (Math.round((v * geoDpr) / 2) * 2) / geoDpr;
  /** é‡ç•«æ”¶æ–‚æˆä¸€å¹€ä¸€æ¬¡ç”¨çš„ */
  const rafRef = useRef(0);
  const drawnSrcRef = useRef<string | null>(null);
  /* ç‰©ä»¶æœ¬é«”ã€é¸ä¸­æ¡†ã€æŽ§åˆ¶é»žå¿…é ˆå…±ç”¨åŒä¸€çµ„ã€Œå¯¦é«”åƒç´ å°é½Šå¾Œã€å°ºå¯¸ã€‚
     ä»¥å‰æœ¬é«”å¤–æ®¼ä½¿ç”¨ snapPx2ï¼Œä½† SVGï¼æ–‡å­—èˆ‡ frameRect ä»ç”¨æœªå–æ•´å°ºå¯¸ï¼›
     ç¼©æ”¾ç»è¿‡åŠåƒç´ è¾¹ç•Œæ—¶ï¼Œä¸¤è¾¹ä¼šåœ¨ä¸åŒå¸§è¿›ä½ï¼Œçœ‹èµ·æ¥å°±æ˜¯å›¾å½¢åœ¨æ¡†å†…æŠ–åŠ¨ã€‚ */
  // å››è¾¹æŒ¤åŽ‹æœŸé—´ä¸èƒ½é€å¸§å–æ•´ï¼šå–æ•´ç‚¹ä¼šè®©æœ¬åº”å›ºå®šçš„å¯¹è¾¹åœ¨ä¸¤ä¸ªå®žä½“åƒç´ é—´è·³ã€‚
  // æ”¾æ‰‹åŽå†æ¢å¤åƒç´ å¯¹é½ï¼Œé™æ­¢ç”»é¢ä»ä¿æŒé”åˆ©ã€‚
  const stretching = !!stretchStart.current;
  /* äº’å‹•ä¸­çµ•ä¸èƒ½é€å¹€è·¨è¶Šå¯¦é«”åƒç´ å–æ•´é»žï¼šç¸®æ”¾ã€æ—‹è½‰æˆ–æ‹–æ›³æ™‚è‹¥æ¯ä¸€æ ¼éƒ½
     Math.roundï¼Œç‰©ä»¶ä¸­å¿ƒæœƒåœ¨ç›¸é„°åƒç´ é–“è·³ã€‚æ‰‹å‹¢æœŸé–“ä¿ç•™é€£çºŒå¹¾ä½•ï¼Œæ”¾æ‰‹å¾Œæ‰
     ä¸€æ¬¡å¸å›žå¯¦é«”åƒç´ æ ¼ï¼Œå…¼é¡§æ“ä½œç©©å®šèˆ‡éœæ­¢æ¸…æ™°åº¦ã€‚ */
  const liveGeometry = stretching || isScaling || isDragging || hideChrome;
  const boxW = liveGeometry ? image.width * image.scale : snapPx2(image.width * image.scale);
  const boxH = liveGeometry ? image.height * image.scale : snapPx2(image.height * image.scale);
  const renderScale = Math.max(
    boxW / Math.max(1, image.width),
    boxH / Math.max(1, image.height),
  );
  const textRenderScale = liveGeometry ? image.scale : 1;
  const textMetricScale = liveGeometry ? 1 : image.scale;
  // ç™¼å…‰èˆ‡æé‚Šéƒ½æœƒè¶…å‡ºæ¡†ï¼Œcanvas è¦ç•™é‚Šã€‚
  // ç•™é‚Šå›ºå®šç”¨ã€Œæœ€å¤§å¼·åº¦ã€ç®—ï¼šæ‹–ç™¼å…‰æ»‘æ¡¿æ™‚é‚Šç•Œå°±ä¸æœƒæ¯ä¸€æ ¼éƒ½è®Šï¼Œ
  // ä¸ç„¶ canvas çš„ä½ç½®èˆ‡å¤§å°ä¸€ç›´é‡ç®—ï¼Œåœ–çœ‹èµ·ä¾†å°±æ˜¯åœ¨æŠ–ã€‚
  // ç™¼å…‰ç•™çš„æ˜¯ã€Œæœ€å¤§å¼·åº¦çš„å…‰æ•£åˆ°å“ªè£¡ã€ï¼Œç•™å°‘äº†é è¦½çš„å…‰æœƒè¢« canvas é‚Šç•Œ
  // åˆ‡æŽ‰ä¸€å€‹ç›´è§’ï¼Œè·ŸåŒ¯å‡ºä¹Ÿå°ä¸èµ·ä¾†ã€‚
  const glowPad = Math.round(
    ((image.imgGlow ? Math.ceil(GLOW_BLUR_UNIT * GLOW_EXTENT) : 0)
      + (image.imgStrokeWidth ? 20 : 0)) * image.scale,
  );
  /* é•·æŒ‰æ‹–æ›³äº’æ›æ™‚ã€Œè®Šæš—çš„é‚£ä¸€å¡Šã€è¦ç…§åœ–å±¤ç¾åœ¨çš„å½¢ç‹€èµ° */
  const dimShape = useMemo(
    () => shapeParts(image, boxW, boxH),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxW, boxH, image.imgRadius, image.feather, image.imgShape],
  );
  // åŽŸåœ–å…ˆåœ¨èƒŒæ™¯è§£å¥½ï¼Œç¬¬ä¸€æ¬¡åˆ‡åˆ° canvas æ‰ä¸æœƒæœ‰ä¸€æ ¼ç©ºç™½ï¼ˆçœ‹èµ·ä¾†å°±æ˜¯é–ƒä¸€ä¸‹ï¼‰
  const [shapeImgReady, setShapeImgReady] = useState(false);
  useEffect(() => {
    if (image.text !== undefined || image.isVideo || !image.src) return;
    const el = getPreviewImg(image.src);
    if (el.complete && el.naturalWidth) { setShapeImgReady(true); return; }
    setShapeImgReady(false);
    const on = () => setShapeImgReady(true);
    el.addEventListener('load', on);
    return () => el.removeEventListener('load', on);
  }, [image.src, image.text]);

  /* â”€â”€ å½±ç‰‡ä¹Ÿè¦èƒ½èª¿ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     ä»¥å‰é€™è£¡æŠŠå½±ç‰‡æ•´å€‹æŽ’é™¤åœ¨ canvas é‚£æ¢è·¯ä¹‹å¤–ï¼Œæ‰€ä»¥æ¿¾é¡ã€åœ“è§’ã€ç¾½åŒ–ã€
     æé‚Šã€ç™¼å…‰åœ¨å½±ç‰‡ä¸Š**å…¨éƒ¨æŒ‰äº†æ²’åæ‡‰**ï¼ˆé¢æ¿ç…§æ¨£é•·å‡ºä¾†ï¼Œåªæ˜¯ä¸æœƒå‹•ï¼‰ã€‚
     åŽŸå› ä¸æ˜¯æ‡¶å¾—åšï¼Œæ˜¯é‚£æ¢è·¯çš„ç¬¬ä¸€å€‹å‹•ä½œ `drawImage(ä¾†æº, â€¦)` å°å½±ç‰‡å¤ªè²´ï¼š
     ä¸€æ®µ 1080p çš„ç‰‡å­ï¼Œå…‰é€™ä¸€ä¸‹åœ¨æ‰‹æ©Ÿç­‰ç´šçš„ CPU ä¸Šå°±è¦ 20.9 æ¯«ç§’ï¼Œ
     ä¸€ç§’ 30 æ ¼æ ¹æœ¬ç•«ä¸å®Œã€‚

     ç¾åœ¨æ”¹æˆï¼šå½±ç‰‡çš„å½±æ ¼å…ˆç”± utils/videoGl ä¸Šåˆ° GPUï¼ˆ1.0 æ¯«ç§’ï¼Œè€Œä¸”ä¸ä½”
     ä¸»åŸ·è¡Œç·’ï¼‰ï¼Œé¡è‰²éˆç”¨çƒ¤å¥½çš„ 33Â³ æŸ¥è‰²è¡¨åœ¨è‘—è‰²å™¨è£¡æŸ¥å®Œï¼Œ
     å†æŠŠ**é‚£å¼µå·²ç¶“æ˜¯ RGB çš„å°ç•«å¸ƒ**é¤µé€²åŽŸæœ¬é€™æ¢è·¯ã€‚
     æ–¼æ˜¯åœ“è§’ï¼ç¾½åŒ–ï¼æé‚Šï¼ç™¼å…‰é‚£ä¸€æ•´æ®µç¨‹å¼ç¢¼ä¸€è¡Œéƒ½ä¸ç”¨æ”¹ï¼Œ
     ç…§ç‰‡è·Ÿå½±ç‰‡èµ°çš„æ˜¯åŒä¸€ä»½ï¼Œé•·ç›¸ä¸å¯èƒ½ä¸ä¸€æ¨£ã€‚ */
  const isVid = !!image.isVideo;
  /** é€™ä¸€å±¤çš„ <video>ã€‚æœ‰ fxï¼å½¢ç‹€æ™‚å®ƒä¸ä¸Šç•«é¢ï¼Œåªç•¶ GPU çš„ä¾†æºã€‚ */
  const glVideoRef = useRef<HTMLVideoElement | null>(null);
  const [vidReady, setVidReady] = useState(false);
  /** æ§‹åœ–è£åˆ‡å¾Œé‚£ä¸€å¼µï¼ˆé‡è¤‡ä½¿ç”¨ï¼Œä¸è¦æ¯æ ¼é–‹ä¸€å¼µæ–°çš„ï¼‰ */
  const glGeoRef = useRef<HTMLCanvasElement | null>(null);
  /* GPU é‚£æ¢è·¯æ•´æ®µæ¬åˆ° useVideoFxGl äº†ï¼Œå…§å®¹ä¸€è¡Œéƒ½æ²’æœ‰æ”¹ã€‚ */
  const { glCanvas, glLive, glDead } = useVideoFxGl(
    glVideoRef, image.fx, lutRevision, boxW, boxH, shapeDpr,
    !!image.isVideo && vidReady && hasPhotoFx(image.fx),
  );

  // ä¸€æ—¦ç”¨éŽ canvas å°±ä¸€ç›´ç”¨ä¸‹åŽ»ã€‚
  // ä¸ç„¶æŠŠæ»‘æ¡¿æ‹‰å›ž 0 çš„é‚£ä¸€æ ¼æœƒå¾ž canvas æ›æˆ <img>ï¼Œæ–°çš„ <img> é‚„æ²’ç•«ä¸Šä¾†ï¼Œ
  // åœ–ç‰‡å°±æœƒæ•´å¼µé–ƒæŽ‰ä¸€ä¸‹ã€‚å€¼å…¨æ˜¯ 0 çš„æ™‚å€™ canvas ç•«çš„å°±æ˜¯åŽŸåœ–ï¼Œçœ‹èµ·ä¾†ä¸€æ¨£ã€‚
  const usedCanvasRef = useRef(false);
  /** é€™ä¸€å±¤èº«ä¸Šæœ‰æ²’æœ‰ã€Œéœ€è¦ canvas æ‰ç•«å¾—å‡ºä¾†ã€çš„æ±è¥¿ */
  const hasShapeWork = !!(image.feather || image.imgRadius || image.imgGlow || image.imgStrokeWidth
    || isImgShaped(image.imgShape) || hasPhotoFx(image.fx));
  /** å½±ç‰‡è¦ä¸è¦èµ° GPUï¼šæœ‰é¡è‰²èª¿æ•´å°±è¦ï¼ˆå½¢ç‹€é‚£å¹¾é …å¦å¤–è™•ç†ï¼Œè¦‹ä¸‹é¢ï¼‰ */
  const videoWantsGl = isVid && !glDead && vidReady && hasPhotoFx(image.fx);
  const wantsShapeCanvas = image.text === undefined && !isVid && shapeImgReady && hasShapeWork;
  if (wantsShapeCanvas) usedCanvasRef.current = true;
  /* âš  å½±ç‰‡**ä¸èµ°**é€™æ¢ 2D å½¢ç‹€ç•«å¸ƒã€‚
     ä¸€é–‹å§‹æˆ‘è®“å®ƒèµ°äº†ï¼Œçµæžœæ¯æ ¼ 104 æ¯«ç§’ â€”â€” å› ç‚ºé‚£æ¢è·¯æœƒ drawImage(GPU ç•«å¸ƒ)ï¼Œ
     è€Œé‚£ä¸€ä¸‹ç­‰æ–¼æŠŠæ•´å¼µç•«é¢å¾žé¡¯ç¤ºå¡è®€å›ž CPUï¼ˆå¯¦æ¸¬å°±æ˜¯ 104 æ¯«ç§’ï¼Œ
     è·Ÿ videoGl æª”é ­å¯«çš„å®Œå…¨ä¸€è‡´ï¼‰ã€‚å½±ç‰‡çš„æˆå“ç›´æŽ¥è®“ç€è¦½å™¨åˆæˆï¼Œä¸ç¶“éŽ 2Dã€‚ */
  const needsShapeCanvas = image.text === undefined && !isVid && shapeImgReady && usedCanvasRef.current;

  /* æ¿¾é¡ï¼èª¿ç¯€ç®—ä¸€æ¬¡å°±ç•™è‘—ã€‚å›ºå®šç”¨é•·é‚Šç®—ï¼Œæåˆæ™‚å°ºå¯¸ä¸€ç›´è®Šä¹Ÿä¸æœƒé‡ç®—ã€‚

     ä»¥å‰æ‹–æ»‘æ¡¿æ™‚æœƒå…ˆé™åˆ° 380 é•·é‚Šç®—ä¸€å¼µã€Œå¿«çš„ã€ï¼Œæ‰‹åœä¸‹ä¾†å†è£œç®—å…¨å°ºå¯¸ã€‚
     é‚£æ­£æ˜¯ä¸»äººèªªçš„ã€Œæ‹–å‹•æ»‘æ¡¿æ™‚åœ–ç‰‡æœƒæœ‰åƒç´ æ„Ÿã€â€”â€” 380 æ¯”ç•«é¢ä¸ŠçœŸæ­£çš„å¯¦é«”åƒç´ 
     å°‘äº†ä¸€å¤§æˆªï¼Œæ‹–çš„éŽç¨‹ä¸­çœ‹åˆ°çš„å°±æ˜¯æ”¾å¤§çš„ç³Šåœ–ã€‚

     ç¾åœ¨é¡è‰²éˆå¯ä»¥äº¤çµ¦ GPUï¼ˆçƒ¤ 33Â³ çš„è¡¨ 2.2ms ï¼‹ ä¸€å€‹ draw callï¼‰ï¼Œ
     å…¨å°ºå¯¸æœ¬ä¾†å°±è·‘å¾—å‹•ï¼Œæ‰€ä»¥æ‹–æ›³ä¸­èˆ‡éœæ­¢æ™‚**ç”¨åŒä¸€å€‹å°ºå¯¸**ï¼š
     ç•«é¢ä¸Šæœ‰å¹¾å€‹å¯¦é«”åƒç´ å°±ç®—å¹¾å€‹ã€‚æ‹–æ›³ä¸­çœ‹åˆ°çš„å°±æ˜¯æœ€çµ‚é‚£ä¸€å¼µã€‚ */
  /* æ­£å¼é‚£ä¸€å¼µè¦ç®—åˆ°ã€Œç•«é¢ä¸ŠçœŸçš„æœ‰å¹¾å€‹å¯¦é«”åƒç´ ã€ã€‚
     ä»¥å‰å›ºå®š 720ï¼Œæ¯”å¯¦éš›é¡¯ç¤ºçš„åƒç´ å°‘ä¸€å¤§æˆªï¼Œæ‰€ä»¥ä¸€å¥—ä¸Šæ¿¾é¡æˆ–ç‰¹æ•ˆï¼Œ
     ç…§ç‰‡å°±æ˜Žé¡¯è®Šç³Šã€‚ä¸Šé™ 1400 æ˜¯ç‚ºäº†ä¸è®“è¶…å¤§æ ¼å­æŠŠä¸€æ¬¡é‡ç®—æ‹–å¤ªä¹…ã€‚ */
  const fxFullMax = () => {
    const dpr = Math.min(2, typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);
    return Math.min(1400, Math.max(720, Math.round(Math.max(boxW, boxH) * dpr)));
  };
  const fxCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const fxFastRef = useRef(false);
  /** ä¸Šä¸€æ¬¡ fx è®Šå‹•çš„æ™‚é–“ï¼Œç”¨ä¾†åˆ†è¾¨ã€Œé»žä¸€ä¸‹ã€èˆ‡ã€Œæ‹–æ»‘æ¡¿ã€ */
  const fxLastChangeRef = useRef(0);
  const fxIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fxKeyRef = useRef<string | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { if (fxIdleRef.current) clearTimeout(fxIdleRef.current); }, []);

  const fxSourceFor = (img: HTMLImageElement) => {
    if (!hasPhotoFx(image.fx)) return img as CanvasImageSource;
    const MAX = fxFullMax();
    const key = `${image.src}|${JSON.stringify(image.fx)}|${lutRevision}|${MAX}`;
    const hit = fxCacheRef.current;
    if (hit && hit.key === key) return hit.canvas;
    const aspect = (image.width || 1) / (image.height || 1);
    const fw = aspect >= 1 ? MAX : Math.max(16, Math.round(MAX * aspect));
    const fh = aspect >= 1 ? Math.max(16, Math.round(MAX / aspect)) : MAX;
    const canvas = applyPhotoFx(img, fw, fh, image.fx!);
    fxCacheRef.current = { key, canvas };
    return canvas;
  };

  /* ä¸€èˆ¬åœ–ç‰‡çš„æ³¢æµªä¹Ÿä¸èƒ½é æ ¹ç¯€é»ž translate å‡è£ã€‚åªæœ‰æ³¢æµªæ’­æ”¾æœŸé–“æ‰å»ºç«‹
     é€™å¼µå±€éƒ¨ Canvasï¼›åŽŸåœ–ã€æ¿¾é¡ä¾†æºèˆ‡å¤–æ¡†å¹¾ä½•éƒ½ä¸æ”¹ï¼ŒçµæŸå¾Œç«‹åˆ»å›žåŽŸæœ¬çš„
     <img> è·¯å¾‘ã€‚ */
  const plainImageWave = image.text === undefined && !image.shape && !image.isVideo
    && !needsShapeCanvas && motionFrame?.gridWave !== undefined
    && (motionFrame.waveMix ?? 1) > 1e-5;
  const waveImagePad = plainImageWave
    ? Math.ceil(Math.min(10, boxH * .065) * Math.max(.15, (image.mo?.amp ?? 50) / 100) + 2)
    : 0;
  useLayoutEffect(() => {
    if (!plainImageWave) return;
    const canvas = waveImageCanvasRef.current;
    if (!canvas) return;
    const img = getPreviewImg(image.src);
    let alive = true;
    const draw = () => {
      if (!alive || !img.naturalWidth) return;
      const dpr = Math.max(2, Math.min(4, geoDpr * Math.max(1, canvasK())));
      const W = Math.max(1, Math.round(boxW * dpr));
      const pad = waveImagePad * dpr;
      const bodyH = Math.max(1, Math.round(boxH * dpr));
      const H = Math.max(1, Math.round(bodyH + pad * 2));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      const scratch = waveImageScratchRef.current || document.createElement('canvas');
      waveImageScratchRef.current = scratch;
      if (scratch.width !== W) scratch.width = W;
      if (scratch.height !== H) scratch.height = H;
      const sg = scratch.getContext('2d');
      const ctx = canvas.getContext('2d');
      if (!sg || !ctx) return;
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, W, H);
      sg.imageSmoothingEnabled = true;
      sg.imageSmoothingQuality = 'high';
      sg.drawImage(fxSourceFor(img), 0, pad, W, bodyH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const reveal = motionFrame?.gridReveal === undefined
        ? 1 : Math.max(0, Math.min(1, motionFrame.gridReveal));
      const shownW = W * reveal;
      const amp = Math.min(10 * dpr, bodyH * .065)
        * Math.max(.15, (image.mo?.amp ?? 50) / 100) * (motionFrame?.waveMix ?? 1);
      const phase = motionFrame?.gridWave ?? 0;
      const segments = Math.max(32, Math.min(128, Math.ceil(shownW / 8)));
      const sw = shownW / segments;
      for (let i = 0; i < segments; i++) {
        const x = i * sw;
        const x1 = i + 1 === segments ? shownW : x + sw;
        const dy0 = Math.sin((x / Math.max(1, W) - phase) * Math.PI * 2) * amp;
        const dy1 = Math.sin((x1 / Math.max(1, W) - phase) * Math.PI * 2) * amp;
        const slope = (dy1 - dy0) / Math.max(.001, x1 - x);
        ctx.save();
        ctx.beginPath(); ctx.rect(x - .5, 0, x1 - x + 1, H); ctx.clip();
        ctx.transform(1, slope, 0, 1, 0, dy0 - slope * x);
        ctx.drawImage(scratch, x - 1, 0, x1 - x + 2, H, x - 1, 0, x1 - x + 2, H);
        ctx.restore();
      }
    };
    if (img.complete && img.naturalWidth) draw();
    else img.addEventListener('load', draw, { once: true });
    return () => { alive = false; img.removeEventListener('load', draw); };
  }, [plainImageWave, image.src, image.fx, lutRevision, boxW, boxH, waveImagePad,
      motionFrame?.gridWave, motionFrame?.gridReveal, motionFrame?.waveMix, image.mo?.amp]);

  useLayoutEffect(() => {
    if (!needsShapeCanvas) return;
    const c = shapeCanvasRef.current;
    if (!c) return;
    const img = getPreviewImg(image.src);
    const draw = () => {
      if (!img.naturalWidth) return;
      const dpr = shapeDpr;
      // ç”¨ã€Œç‰ˆé¢ç›’å¸éŽä¹‹å¾Œã€çš„å°ºå¯¸åŽ»æŽ¨å…§éƒ¨åƒç´ ï¼Œå…©é‚Šæ‰æœƒå‰›å¥½æ•´æ•¸å€
      const W = Math.max(1, Math.round(snapPx(boxW + glowPad * 2) * dpr));
      const H = Math.max(1, Math.round(snapPx(boxH + glowPad * 2) * dpr));
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, W, H);

      const iw = Math.max(1, Math.round(boxW * dpr));
      const ih = Math.max(1, Math.round(boxH * dpr));
      // æé‚Šæ˜¯å¾€å¤–é•·çš„ï¼Œæ‰€ä»¥å½¢ç‹€é‚£ä¸€å¼µè¦æ¯”æ¡†å¤§ lw ä¸€åœˆ
      const lw = (image.imgStrokeWidth || 0) * image.scale * dpr;
      const strokeGap = (image.imgStrokeGap || 0) * image.scale * dpr;
      const strokeExtent = lw + strokeGap;
      const sw = iw + strokeExtent * 2;
      const sh = ih + strokeExtent * 2;
      const ox = (W - sw) / 2;
      const oy = (H - sh) / 2;

      const base = fxSourceFor(img);
      let shaped: CanvasImageSource = base;
      let drawW = iw, drawH = ih, drawX = (W - iw) / 2, drawY = (H - ih) / 2;
      const kind = image.imgShape;
      if (image.feather || image.imgRadius || image.imgStrokeWidth || isImgShaped(kind)) {
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(sw));
        off.height = Math.max(1, Math.round(sh));
        const oc = off.getContext('2d');
        if (!oc) return;
        // åœ–ç‰‡ç•«åœ¨ä¸­é–“ï¼Œå››å‘¨ç•™çµ¦æé‚Š
        drawImgBase(oc, base, strokeExtent, strokeExtent, iw, ih, image);
        if (image.feather || image.imgRadius || isImgShaped(kind)) {
          oc.globalCompositeOperation = 'destination-in';
          if (image.feather) {
            // æœ‰ç¾½åŒ–æ‰éœ€è¦é‚£å¼µæ¨¡ç³ŠéŽçš„é®ç½©ï¼›é‚Šæœ¬ä¾†å°±æ˜¯ç³Šçš„ï¼Œç¸®æ”¾è²¼å›žä¾†çœ‹ä¸å‡ºå·®åˆ¥
            const m = previewMask(boxW / boxH, image.imgRadius || 0, image.feather, kind);
            oc.drawImage(m, strokeExtent, strokeExtent, iw, ih);
          } else {
            /* åªæœ‰åœ“è§’ã€æ²’æœ‰ç¾½åŒ–ï¼šä»¥å‰ä¹Ÿèµ°é‚£å¼µ 400px çš„é®ç½©å†æ‹‰å¤§ï¼Œ
               ç¡¬é‚Šè¢«æ”¾å¤§å°±è®ŠæˆéšŽæ¢¯ç‹€çš„é‹¸é½’ã€‚æ”¹æˆç›´æŽ¥åœ¨é€™å¼µç•«å¸ƒä¸Šå¡«è·¯å¾‘ â€”â€”
               åŽŸç”Ÿè§£æžåº¦ã€ç€è¦½å™¨è‡ªå·±æŠ—é‹¸é½’ï¼Œé‚Šç·£æ‰æœƒä¹¾æ·¨ã€‚ */
            const R = cornerR(image.imgRadius || 0, iw, ih);
            withImgOutline(oc, strokeExtent, strokeExtent, iw, ih, kind, R, R, p => {
              oc.fillStyle = '#fff';
              p ? oc.fill(p) : oc.fill();
            });
          }
          oc.globalCompositeOperation = 'source-over';
        }
        // æé‚Šï¼ˆç›¸æ¡†ç·šï¼‰ï¼šæ•´æ¢ç·šéƒ½é•·åœ¨åœ–ç‰‡å¤–é¢ï¼Œå…§ç·£å‰›å¥½è²¼è‘—åœ–ç‰‡çš„é‚Šã€‚
        // åœ–ç‰‡æ²’æœ‰åœ“è§’å°±ææˆç›´è§’ï¼ˆmiterï¼‰ï¼Œä¸è¦è‡ªå·±å¤šåŠ ä¸€å€‹åœ“è§’å‡ºä¾†ã€‚
        if (lw > 0) {
          const rp = image.imgRadius || 0;
          const sr = rp ? cornerR(rp, iw, ih) + strokeGap + lw / 2 : 0;
          withImgOutline(oc, lw / 2, lw / 2, iw + strokeGap * 2 + lw, ih + strokeGap * 2 + lw, kind, sr, sr, p => {
          oc.lineWidth = lw;
          oc.lineJoin = 'miter';
          oc.miterLimit = 4;
          /* è™›ç·šã€‚ä¸€æ®µçš„é•·åº¦ç”¨ç·šå¯¬ç•¶å–®ä½ï¼ˆ0.6~4.6 å€ï¼‰ï¼Œç©ºéš™æ˜¯å®ƒçš„ 0.85 å€ï¼Œ
             æ‰€ä»¥ä¸ç®¡é è¦½ã€ç¸®åœ–é‚„æ˜¯åŒ¯å‡ºï¼Œçœ‹åˆ°çš„ç¯€å¥éƒ½ä¸€æ¨£ã€‚ */
          const dashV = image.imgStrokeDash || 0;
          if (dashV > 0) {
            const seg = lw * (0.6 + (dashV / 100) * 4);
            oc.setLineDash([seg, seg * 0.85]);
            oc.lineCap = 'butt';
          } else {
            oc.setLineDash([]);
          }
          oc.strokeStyle = image.imgStrokeColor || '#FFFFFF';
          p ? oc.stroke(p) : oc.stroke();
          oc.setLineDash([]);
          });
        }
        shaped = off;
        drawW = off.width; drawH = off.height; drawX = ox; drawY = oy;
      }

      // ç™¼å…‰ï¼šè·Ÿæ–‡å­—åŒä¸€çµ„æ¨¡ç³ŠåŠå¾‘ï¼ˆ(å¼·åº¦/20)Ã—14 çš„ Ã—1ã€Ã—2ã€Ã—3 ä¸‰å±¤ï¼‰ã€‚
      // å…‰æšˆæœ¬èº«å¾ˆå¹³æ»‘ï¼Œæ‰€ä»¥ç®—åœ¨æœ‰ä¸Šé™çš„å°å¼µä¸Šå†æ”¾å¤§è²¼å›žä¾†ï¼Œ
      // ç•™é‚Šè®Šå¤§ä¹Ÿä¸æœƒè®“æ‹–æ»‘æ¡¿è®Šæ…¢ï¼ˆè·ŸåŒ¯å‡ºåŒä¸€æ‹›ï¼‰ã€‚
      if (image.imgGlow) {
        const gk = Math.min(1, 420 / Math.max(W, H));
        const glow = makeGlowCanvas(
          shaped, W * gk, H * gk, drawX * gk, drawY * gk, drawW * gk, drawH * gk,
          (image.imgGlow / 20) * GLOW_BLUR_UNIT * image.scale * dpr * gk,
          image.imgGlowColor || '#FFFFFF',
        );
        g.drawImage(glow, 0, 0, W, H);
      }
      g.drawImage(shaped, drawX, drawY, drawW, drawH);
    };
    drawRef.current = draw;
    /* ä½Žè§£æžåº¦é‚£å¼µåªçµ¦ã€Œé€£çºŒåœ¨å‹•ã€çš„æƒ…æ³ç”¨ï¼ˆæ‹–æ»‘æ¡¿ï¼‰ã€‚
       ä»¥å‰åªè¦ fx å€¼ä¸€è®Šå°±å…ˆç•« 380 çš„ã€220ms å¾Œå†æ›æˆæ­£å¼çš„ â€”â€”
       æ‰€ä»¥ã€Œé»žä¸€ä¸‹æ¿¾é¡ã€ä¹Ÿæœƒå…ˆå‡ºç¾ä¸€å¼µç³Šçš„ã€å†è·³æˆæ¸…æ¥šçš„ï¼Œçœ‹èµ·ä¾†å°±æ˜¯é–ƒä¸€ä¸‹ã€‚
       æ”¹æˆçœ‹è·é›¢ä¸Šä¸€æ¬¡è®Šå‹•å¤šä¹…ï¼šé»žä¸€ä¸‹ï¼ˆå–®ä¸€æ¬¡è®Šå‹•ï¼‰ç›´æŽ¥ç•«æ­£å¼çš„ï¼Œä¸é–ƒï¼›
       æ‹–æ»‘æ¡¿ï¼ˆé€£çºŒè®Šå‹•ï¼‰æ‰èµ°å¿«çš„é‚£æ¢ï¼Œç¶­æŒåŽŸæœ¬çš„æµæš¢åº¦ã€‚ */
    const fxKey = `${JSON.stringify(image.fx)}|${lutRevision}`;
    if (fxKeyRef.current !== null && fxKeyRef.current !== fxKey && hasPhotoFx(image.fx)) {
      const now = Date.now();
      const streaming = now - fxLastChangeRef.current < 260;
      fxLastChangeRef.current = now;
      if (streaming) {
        fxFastRef.current = true;
        if (fxIdleRef.current) clearTimeout(fxIdleRef.current);
        fxIdleRef.current = setTimeout(() => {
          fxIdleRef.current = null;
          fxFastRef.current = false;
          drawRef.current?.();
        }, 220);
      }
    }
    fxKeyRef.current = fxKey;

    if (img.complete && img.naturalWidth) {
      // æ‹–æ»‘æ¡¿æ™‚ä¸€æ ¼æœƒé€å¥½å¹¾å€‹ inputï¼Œæ¯ä¸€å€‹éƒ½é‡ç®—å°±æœƒä¸€é “ä¸€é “ã€‚
      // æ”¶æ–‚æˆã€Œæœ€å¤šä¸€å¹€ç•«ä¸€æ¬¡ã€åªç•«æœ€å¾Œé‚£å€‹å€¼ã€ï¼šç•«é¢ç…§æ¨£å³æ™‚ï¼Œå·¥ä½œé‡å°‘å¾ˆå¤šã€‚
      // ç¬¬ä¸€æ¬¡ï¼ˆæˆ–æ›åœ–ï¼‰åŒæ­¥ç•«ï¼Œä¸ç„¶æœƒç©ºä¸€æ ¼ã€‚
      if (drawnSrcRef.current !== image.src) {
        drawnSrcRef.current = image.src;
        draw();
      } else {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
      }
      return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
    }
    img.addEventListener('load', draw);
    return () => img.removeEventListener('load', draw);
  }, [
    needsShapeCanvas, image.src, image.feather, image.imgRadius,
    image.imgGlow, image.imgGlowColor, image.imgStrokeWidth, image.imgStrokeColor, image.imgStrokeDash, image.imgStrokeGap,
    image.scale, boxW, boxH, glowPad,
    image.fx, lutRevision,
    image.imgShape, image.imgShapeX, image.imgShapeY, image.imgShapeZoom,
  ]);

  const handleBodyPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      // è§¸æŽ§çš„é¸å–ä¸€å¾‹äº¤çµ¦ç•«å¸ƒå±¤ç´šçµ±ä¸€è™•ç†ï¼ˆä¿è­‰åŒæ™‚åªæœ‰ä¸€å€‹é¸å–ç›®æ¨™ï¼‰ï¼Œ
      // é€™è£¡ä¸æ””æˆªã€ä¹Ÿä¸åšé¸å–ã€‚
      return;
    }

    e.stopPropagation();
    /* å½¢ç‹€çš„ç¬¬äºŒæ®µé¸å–ï¼ˆæ»‘é¼ ï¼‰ï¼šåº§æ¨™äº¤çµ¦å¤–é¢åˆ¤æ–·åœ¨ä¸åœ¨å½¢ç‹€è£¡é¢ â€”â€”
       è§¸æŽ§æ˜¯èµ°ç•«å¸ƒå±¤ç´šçš„ applyTapSelectionï¼Œé‚£æ¢è·¯å·²ç¶“è‡ªå·±è™•ç†éŽäº†ã€‚ */
    onShapeTap?.(e.clientX, e.clientY);
    onSelect();
    
    // Forbid moving two images at the same time
    if (globalDragPointerId !== null && globalDragPointerId !== e.pointerId) {
      return;
    }

    globalDragPointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      imgX: image.x,
      imgY: image.y,
    };
    setIsDragging(true);
    onDragStart?.();
  };

  const handleBodyPointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) {
      if (dragStart.current && globalDragPointerId === dragStart.current.pointerId) {
        globalDragPointerId = null;
      }
      dragStart.current = null;
      setIsDragging(false);
      onDragEnd?.();
      return;
    }
    if (dragStart.current && dragStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      // æ‰‹æŒ‡èµ°çš„æ˜¯èž¢å¹•åƒç´ ï¼Œç‰©ä»¶çš„åº§æ¨™æ˜¯å…§å®¹å–®ä½ï¼šé™¤ä»¥å€çŽ‡ï¼Œ
      // æ‰‹æŒ‡ç§»å¤šå°‘ç•«é¢ä¸Šçš„ç‰©ä»¶å°±èµ°å¤šå°‘ï¼ˆç¸®å°æ™‚æ‰ä¸æœƒè¦ºå¾—ã€Œæ‹–èµ·ä¾†å¾ˆæ…¢ã€ï¼‰
      const k = canvasK();
      const dx = (e.clientX - dragStart.current.startX) / k;
      const dy = (e.clientY - dragStart.current.startY) / k;
      const rawX = dragStart.current.imgX + dx;
      const rawY = dragStart.current.imgY + dy;
      if (onDragMove) {
        onDragMove(rawX, rawY);
      } else {
        onChange({
          x: rawX,
          y: rawY,
        });
      }
    }
  };

  const handleBodyPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;

    if (dragStart.current && dragStart.current.pointerId === e.pointerId) {
      if (globalDragPointerId === e.pointerId) {
        globalDragPointerId = null;
      }
      e.stopPropagation();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      dragStart.current = null;
      setIsDragging(false);
      onDragEnd?.();
    }
  };

  const handleRotatePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const center = getClientCenter();
    const currentAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    
    rotateStart.current = {
      pointerId: e.pointerId,
      startAngle: currentAngle,
      imgRotation: image.rotation,
    };
  };

  const handleRotatePointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) {
      rotateStart.current = null;
      return;
    }
    if (rotateStart.current && rotateStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      const center = getClientCenter();
      const currentAngle = Math.atan2(e.clientY - center.y, e.clientX - center.x);
      const angleDiff = currentAngle - rotateStart.current.startAngle;
      const degDiff = (angleDiff * 180) / Math.PI;
      onChange({
        rotation: (rotateStart.current.imgRotation + degDiff + 360) % 360,
      });
    }
  };

  const handleRotatePointerUp = (e: React.PointerEvent) => {
    if (rotateStart.current && rotateStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      rotateStart.current = null;
    }
  };

  const handleScalePointerDown = (e: React.PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // æ‹‰è§’è½ç¸®æ”¾æ™‚å·¥å…·åˆ—ä¹Ÿå…ˆæ”¶èµ·ä¾†ï¼Œä¸ç„¶æ¡†ä¸€é•·ä¸€ç¸®å®ƒå°±æœƒä¸Šä¸‹æ›é‚Š
    setIsScaling(true);

    if (!pagesContainerRef.current) return;
    const containerRect = pagesContainerRef.current.getBoundingClientRect();

    const R = (image.rotation * Math.PI) / 180;
    /* é¸äº†å½¢ç‹€çš„ç…§ç‰‡ï¼Œè§’çƒæ˜¯ååœ¨ã€Œå½¢ç‹€é‚£å€‹æ­£æ–¹å½¢ã€çš„å››è§’ä¸Šï¼ˆè¦‹ chromeBoxï¼‰ï¼Œ
       æ‰€ä»¥é€™è£¡çš„åŠå¯¬åŠé«˜è¦ç”¨åŒä¸€å€‹æ¡†ï¼Œä¸ç„¶ä¸€æŠ“ä¸‹åŽ»æ¯”ä¾‹å°±å°ä¸ä¸Šã€åœ–æœƒè·³ä¸€ä¸‹ã€‚
       é‚£å€‹æ­£æ–¹å½¢è·Ÿåœ–ç‰‡æ¡†åŒå¿ƒï¼Œæ‰€ä»¥ä¸‹é¢çš„ä¸­å¿ƒé»žèˆ‡ newX/newY éƒ½ä¸å¿…æ”¹ã€‚ */
    const half = isImgShaped((image as any).imgShape)
      ? imgShapeBox(image.width, image.height).s / 2
      : 0;
    const halfW = half || image.width / 2;
    const halfH = half || image.height / 2;

    let dragLocalX = 0;
    let dragLocalY = 0;
    let oppositeLocalX = 0;
    let oppositeLocalY = 0;

    switch (corner) {
      case 'tl':
        dragLocalX = -halfW;
        dragLocalY = -halfH;
        oppositeLocalX = halfW;
        oppositeLocalY = halfH;
        break;
      case 'tr':
        dragLocalX = halfW;
        dragLocalY = -halfH;
        oppositeLocalX = -halfW;
        oppositeLocalY = halfH;
        break;
      case 'bl':
        dragLocalX = -halfW;
        dragLocalY = halfH;
        oppositeLocalX = halfW;
        oppositeLocalY = -halfH;
        break;
      case 'br':
        dragLocalX = halfW;
        dragLocalY = halfH;
        oppositeLocalX = -halfW;
        oppositeLocalY = -halfH;
        break;
    }

    const currentCx = image.x + halfW;
    const currentCy = image.y + halfH;

    const pivotX = currentCx + image.scale * (oppositeLocalX * Math.cos(R) - oppositeLocalY * Math.sin(R));
    const pivotY = currentCy + image.scale * (oppositeLocalX * Math.sin(R) + oppositeLocalY * Math.cos(R));

    // pivot æ˜¯å…§å®¹åº§æ¨™ï¼Œè¦æ›ç®—æˆèž¢å¹•åº§æ¨™æ‰èƒ½è·Ÿ e.clientX æ¯”
    const kDown = canvasK();
    scaleStart.current = {
      pointerId: e.pointerId,
      corner,
      pivotX: containerRect.left + pivotX * kDown,
      pivotY: containerRect.top + pivotY * kDown,
      dragLocalX,
      dragLocalY,
      oppositeLocalX,
      oppositeLocalY,
      rotationRad: R,
    };
    onScaleStart?.();
  };

  const handleScalePointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) {
      scaleStart.current = null;
      onScaleEnd?.();
      return;
    }
    if (scaleStart.current && scaleStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      if (!pagesContainerRef.current) return;
      const containerRect = pagesContainerRef.current.getBoundingClientRect();

      const {
        pivotX,
        pivotY,
        dragLocalX,
        dragLocalY,
        oppositeLocalX,
        oppositeLocalY,
        rotationRad: R,
      } = scaleStart.current;

      // å¾ž pivot åˆ°æ‰‹æŒ‡çš„ä½ç§»æ˜¯èž¢å¹•åƒç´ ï¼Œé™¤å›žå…§å®¹å–®ä½æ‰èƒ½è·Ÿ L_local ç›¸æ¯”
      const kMove = canvasK();
      const v_px = (e.clientX - pivotX) / kMove;
      const v_py = (e.clientY - pivotY) / kMove;

      const dx_local = dragLocalX - oppositeLocalX;
      const dy_local = dragLocalY - oppositeLocalY;
      const L_local = Math.hypot(dx_local, dy_local);

      if (L_local <= 0) return;

      const dx_rot = dx_local * Math.cos(R) - dy_local * Math.sin(R);
      const dy_rot = dx_local * Math.sin(R) + dy_local * Math.cos(R);

      const u_x = dx_rot / L_local;
      const u_y = dy_rot / L_local;

      const L_projected = v_px * u_x + v_py * u_y;

      const newScale = Math.max(0.1, Math.min(10, L_projected / L_local));

      const oppositeOffsetRotX = oppositeLocalX * Math.cos(R) - oppositeLocalY * Math.sin(R);
      const oppositeOffsetRotY = oppositeLocalX * Math.sin(R) + oppositeLocalY * Math.cos(R);

      const pivotContainerX = (pivotX - containerRect.left) / kMove;
      const pivotContainerY = (pivotY - containerRect.top) / kMove;

      const newCx = pivotContainerX - newScale * oppositeOffsetRotX;
      const newCy = pivotContainerY - newScale * oppositeOffsetRotY;

      const newX = newCx - image.width / 2;
      const newY = newCy - image.height / 2;

      const dx = dragLocalX - oppositeLocalX;
      const dy = dragLocalY - oppositeLocalY;
      const K_x = dx * Math.cos(R) - dy * Math.sin(R);
      const K_y = dx * Math.sin(R) + dy * Math.cos(R);

      if (onScaleMove) {
        onScaleMove(
          newX,
          newY,
          newScale,
          scaleStart.current.corner,
          pivotContainerX,
          pivotContainerY,
          K_x,
          K_y,
          oppositeLocalX,
          oppositeLocalY
        );
      } else {
        onChange({
          scale: newScale,
          x: newX,
          y: newY,
        });
      }
    }
  };

  const handleScalePointerUp = (e: React.PointerEvent) => {
    setIsScaling(false);
    if (scaleStart.current && scaleStart.current.pointerId === e.pointerId) {
      e.stopPropagation();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      scaleStart.current = null;
      onScaleEnd?.();
    }
  };

  const handleStretchPointerDown = (e: React.PointerEvent, side: 't' | 'r' | 'b' | 'l') => {
    e.stopPropagation(); e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = null;
    stretchStart.current = { pointerId: e.pointerId, side, startX: e.clientX, startY: e.clientY,
      width: image.width, height: image.height, x: image.x, y: image.y,
      rotationRad: image.rotation * Math.PI / 180 };
    if (image.shape && !image.shapeLineBase) onChange({ shapeLineBase: Math.max(image.width, image.height) });
    if (image.shape && (!image.shapeTextureBaseW || !image.shapeTextureBaseH)) {
      onChange({ shapeTextureBaseW: image.width, shapeTextureBaseH: image.height });
    }
    if (image.text !== undefined && !image.sym && (!image.textStretchBaseW || !image.textStretchBaseH)) {
      onChange({ textStretchBaseW: image.width, textStretchBaseH: image.height });
    }
    setIsScaling(true); onScaleStart?.();
  };
  const handleStretchPointerMove = (e: React.PointerEvent) => {
    const d = stretchStart.current; if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const k = canvasK() * Math.max(0.01, image.scale || 1);
    const sx = (e.clientX - d.startX) / k, sy = (e.clientY - d.startY) / k;
    const lx = sx * Math.cos(d.rotationRad) + sy * Math.sin(d.rotationRad);
    const ly = -sx * Math.sin(d.rotationRad) + sy * Math.cos(d.rotationRad);
    const horizontal = d.side === 'l' || d.side === 'r';
    const signed = horizontal ? (d.side === 'r' ? lx : -lx) : (d.side === 'b' ? ly : -ly);
    const oldCx = d.x + d.width / 2, oldCy = d.y + d.height / 2;
    if (horizontal) {
      const width = Math.max(24, d.width + signed);
      /* x/y å„²å­˜çš„æ˜¯æœªç¸®æ”¾ç‰©ä»¶ç›’çš„å·¦ä¸Šè§’ï¼›pointer ä½ç§»åœ¨ä¸Šé¢ä¹Ÿå·²ç¶“é™¤éŽ
         image.scaleã€‚é€™è£¡è‹¥å†ä¹˜ä¸€æ¬¡ scaleï¼Œå›ºå®šçš„å°é‚Šä¾¿æœƒåœ¨æ“ å£“æ™‚è¢«æŽ¨èµ°ï¼Œ
         è€Œä¸”å€çŽ‡æ„ˆå¤§åå¾—æ„ˆé ã€‚ä¸­å¿ƒåªç§»å‹•åŸºç¤Žå°ºå¯¸å·®çš„ä¸€åŠï¼Œé¡¯ç¤ºã€æ¡†èˆ‡æ–‡å­—
         å°±æœƒæ°¸é å…±ç”¨åŒä¸€å€‹å›ºå®šå°é‚Šã€‚ */
      const shift = (width - d.width) / 2 * (d.side === 'r' ? 1 : -1);
      const cx = oldCx + shift * Math.cos(d.rotationRad), cy = oldCy + shift * Math.sin(d.rotationRad);
      const next = { width, height: d.height, x: cx - width / 2, y: cy - d.height / 2 };
      onChange(next);
    } else {
      const height = Math.max(24, d.height + signed);
      const shift = (height - d.height) / 2 * (d.side === 'b' ? 1 : -1);
      const cx = oldCx - shift * Math.sin(d.rotationRad), cy = oldCy + shift * Math.cos(d.rotationRad);
      const next = { width: d.width, height, x: cx - d.width / 2, y: cy - height / 2 };
      onChange(next);
    }
  };
  const handleStretchPointerUp = (e: React.PointerEvent) => {
    if (stretchStart.current?.pointerId !== e.pointerId) return;
    e.stopPropagation(); try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    stretchStart.current = null; setIsScaling(false); onScaleEnd?.();
  };

  /* å¤–æ¡†çš„å¹¾ä½•ï¼šé¸å–æ¡†é‚£ä¸€çµ„è¦æ¬åˆ°å¦ä¸€å±¤åŽ»ç•«ï¼ˆè¦‹ chromeLayerï¼‰ï¼Œ
     æ¬éŽåŽ»ä¹‹å¾Œå¿…é ˆè½åœ¨å®Œå…¨ä¸€æ¨£çš„ä½ç½®ï¼Œæ‰€ä»¥ä½ç½®ï¼å¤§å°ï¼æ—‹è½‰æŠ½æˆåŒä¸€ä»½ï¼Œ
     å…©é‚Šå…±ç”¨ â€”â€” ä¸æ˜¯å„ç®—ä¸€æ¬¡ï¼Œæ‰ä¸æœƒæœ‰ä»»ä½•ä¸€æ ¼çš„åå·®ã€‚ */
  const wrapGeo: React.CSSProperties = {
    position: 'absolute',
    // å¤§å°ç›´æŽ¥å¯«é€²ç‰ˆé¢è€Œä¸æ˜¯é  transform: scale()ã€‚ç”¨ scale æ”¾å¤§æ™‚ç€è¦½å™¨æœƒæ²¿ç”¨
    // åŽŸå°ºå¯¸çš„é»žé™£å¿«å–å†æ‹‰å¤§ï¼Œæ”¾å¤§å¾Œå°±ç³ŠæŽ‰ï¼›æ”¹æˆå¯¦éš›å°ºå¯¸æ‰æœƒç”¨åŽŸåœ–é‡æ–°å–æ¨£ã€‚
    // å¹¾ä½•å®Œå…¨ç­‰åƒ¹ï¼šscale ä»¥ä¸­å¿ƒç‚ºåŽŸé»žï¼Œæ‰€ä»¥å·¦ä¸Šè§’æ˜¯ x + (w - w*s)/2ã€‚
    /* ç‰ˆé¢ç›’ä¸€å¾‹å¸åˆ°ã€Œæ•´æ•¸å€‹å¯¦é«”åƒç´ ã€ã€‚
       é€™ä¸€å±¤å› ç‚ºæœ‰ transform è€Œè¢«æå‡æˆåˆæˆå±¤ï¼Œåˆæˆå±¤çš„æ¡†æ¯ä¸€æ ¼éƒ½åœ¨è®Šã€è€Œä¸”
       è½åœ¨å°æ•¸ä½ç½®æ™‚ï¼Œç€è¦½å™¨ç®—ã€Œè¦é‡ç•«å“ªä¸€å¡Šã€æ˜¯å¾€å…§å–æ•´ã€å¯¦éš›ç•«å‡ºä¾†çš„ç¯„åœ
       å»æ˜¯å¾€å¤–å–æ•´ â€”â€” ä¸­é–“å·®çš„é‚£ä¸€åˆ—æ°¸é ä¸æœƒè¢«é‡ç•«ï¼Œç¸®æ”¾æ™‚å°±æ²¿è·¯ç•™ä¸‹ä¸€æ¢
       ä¸€åƒç´ çš„æ®˜å½±ï¼ˆç…§ç‰‡æ˜¯æ·±è‰²ã€é é¢æ˜¯ç™½çš„ï¼Œçœ‹èµ·ä¾†å°±æ˜¯ä¸€æ ¹æ ¹é»‘ç·šï¼‰ã€‚
       å¸åˆ°æ•´æ•¸ä¹‹å¾Œå…©é‚Šå°é½Šï¼Œæ®˜å½±å°±æ²’æœ‰å¯ä»¥èº²çš„åœ°æ–¹ã€‚ */
    /* ä½ç½®è¦ç”¨ã€Œä¸­å¿ƒã€æŽ¨å›žä¾†ï¼Œä¸èƒ½ä½ç½®èˆ‡å¤§å°å„å¸å„çš„ã€‚
       ç¸®æ”¾æ™‚ä¸­å¿ƒé»žå…¶å¯¦æ˜¯ä¸å‹•çš„ï¼ˆx + (w - wÂ·s)/2 + wÂ·s/2 æ†ç­‰æ–¼ x + w/2ï¼‰ï¼Œ
       ä½†å·¦ä¸Šè§’èˆ‡å¯¬é«˜åˆ†åˆ¥å¸åˆ°æ ¼ç·šä¹‹å¾Œï¼Œå…©å€‹èª¤å·®ä¸åŒæ­¥ â€”â€” ä¸­å¿ƒå°±æœƒä¸€è·¯ä¸Šä¸‹ã€
       å·¦å³ä¾†å›žæŠ–ï¼ˆæ¨¡æ“¬ä¸€è¶Ÿ 1â†’3 å€ï¼šåž‚ç›´ä¾†å›ž 341 æ¬¡ï¼‰ã€‚
       æ”¹æˆï¼šå¯¬é«˜å…ˆå¸åˆ°ã€Œå¶æ•¸å€‹ã€å¯¦é«”åƒç´ ï¼ˆä¸€åŠä¹Ÿé‚„åœ¨æ ¼ç·šä¸Šï¼‰ï¼Œå†ç”±å›ºå®šçš„
       ä¸­å¿ƒé»žæŽ¨å‡ºå·¦ä¸Šè§’ã€‚é€™æ¨£ä¸­å¿ƒä¸å†éš¨ç¸®æ”¾è·³å‹•ï¼ˆä¾†å›ž 0 æ¬¡ï¼‰ï¼Œå››å€‹é‚Šä¹Ÿä»ç„¶
       éƒ½è½åœ¨æ•´æ•¸å¯¦é«”åƒç´ ä¸Šï¼Œæ®˜å½±çš„é˜²æ²»æ²’æœ‰è®Šã€‚ */
    ...(() => {
      const cx = image.x + image.width / 2;
      const cy = image.y + image.height / 2;
      const w = boxW;
      const h = boxH;
      return {
        left: `${liveGeometry ? cx - w / 2 : snapPx(cx - w / 2)}px`,
        top: `${liveGeometry ? cy - h / 2 : snapPx(cy - h / 2)}px`,
        width: `${w}px`,
        height: `${h}px`,
      };
    })(),
    transformOrigin: 'center center',
    // æŽ’é é¢æ‹–æ›³ä¸­è¦è·Ÿè‘—è‡ªå·±é‚£ä¸€é ä¸€èµ·èµ°ï¼ˆå¹³ç§»ï¼‹ç¾¤çµ„ç¸®æ”¾ï¼‰ï¼Œæœ€å¾Œæ‰æ˜¯è‡ªå·±çš„æ—‹è½‰
    /* é€™è£¡ã€Œä¸€å®šè¦ã€ä¿ç•™ transformï¼ˆå³ä½¿æ—‹è½‰æ˜¯ 0ï¼‰ã€‚
       æœ‰ transform æ™‚ Chrome æœƒæŠŠé€™ä¸€å±¤æå‡æˆåˆæˆå±¤ï¼Œç¹ªè£½ä½ç½®å¸é™„åˆ°æ•´æ•¸
       åƒç´ ï¼Œé‚Šç·£æ˜¯å¯¦å¿ƒçš„ï¼›æ‹¿æŽ‰ä¹‹å¾Œæ”¹æˆæ¬¡åƒç´ ç¹ªè£½ï¼Œè²¼é½Šç•«å¸ƒé‚Šç·£æ™‚é‚Šç·£æœƒè¢«
       æŠ—é‹¸é½’æŠ¹æˆåŠé€æ˜Žçš„ä¸€æ¢ï¼Œçœ‹èµ·ä¾†å°±åƒæ²’å°é½Š â€”â€” è€ŒåŒ¯å‡ºæ˜¯ç›´æŽ¥ç”¨åº§æ¨™ç•«åœ¨
       canvas ä¸Šã€ä¸å—å½±éŸ¿ï¼Œæ–¼æ˜¯è®Šæˆã€ŒåŒ¯å‡ºæ˜¯å°çš„ã€é è¦½æœ‰èª¤å·®ã€ã€‚ */
    /* åªæœ‰ã€ŒçœŸçš„éœ€è¦ã€æ‰çµ¦ transformã€‚
       æœ‰ transform é€™ä¸€å±¤å°±æœƒè¢«æå‡æˆåˆæˆå±¤ï¼›åˆæˆå±¤çš„æ¡†åœ¨ç¸®æ”¾æ™‚æ¯ä¸€æ ¼éƒ½åœ¨è®Šï¼Œ
       å®ƒè®“å‡ºä¾†çš„é‚£ä¸€æ¢èˆŠå€åŸŸç€è¦½å™¨å¸¸å¸¸ä¸æœƒé‡ç•« â€”â€” é‚£å°±æ˜¯ç¸®å°åœ–ç‰‡æ™‚é‚Šç·£æ²¿è·¯
       ç•™ä¸‹ä¸€æ ¹æ ¹ç·šçš„æˆå› ã€‚æ²’æœ‰æ—‹è½‰ã€ä¹Ÿæ²’æœ‰æŽ’é é¢çš„ç¾¤çµ„ä½ç§»æ™‚å°±ä¸ç•™ transformï¼Œ
       æ”¹èµ°ä¸€èˆ¬ç¹ªè£½ï¼Œè®“å‡ºä¾†çš„å€åŸŸä¸€å®šæœƒè¢«é‡ç•«ã€‚
       ï¼ˆåŽŸæœ¬ç•™è‘—å®ƒæ˜¯ç‚ºäº†è®“é‚Šç·£å¸åˆ°æ•´æ•¸åƒç´ ï¼Œé‚£ä»¶äº‹ç¾åœ¨ç”± snapPx ç”¨ã€ŒçœŸæ­£çš„ã€
       å¯¦é«”åƒç´ å¯†åº¦åšæŽ‰äº†ï¼Œä¸å¿…å†é åˆæˆå±¤ã€‚ï¼‰ */
    transform: (motionFrame || dragShift || (image.rotation % 360) !== 0)
      ? `${dragShift ? `translate(${dragShift.tx}px, ${dragShift.ty}px) scale(${dragShift.s}) ` : ''}${motionFrame ? `translate3d(${motionFrame.dx * boxW}px, ${motionFrame.dy * boxH}px, 0) scale(${motionFrame.k * (motionFrame.fx ?? 1)}, ${motionFrame.k}) ` : ''}rotate(${image.rotation + (motionFrame?.rot || 0)}deg)`
      : undefined,
    /* éŽå ´ä¸€å®šè¦è·Ÿé é¢å®¹å™¨é‚£é‚Šã€Œä¸€æ¨¡ä¸€æ¨£ã€ï¼ˆ220msã€åŒä¸€æ¢æ›²ç·šï¼‰ã€‚
       ä»¥å‰é€™è£¡æ˜¯ 200ms ease-outã€é‚£é‚Šæ˜¯ 220ms cubic-bezier(0.2,0,0,1)ï¼š
       å…©è€…åŒæ™‚èµ·è·‘å»èµ°ä¸åŒçš„é€Ÿåº¦ã€ä¹Ÿä¸åŒæ™‚åˆ°ï¼ŒæŽ’é é¢æ™‚å°±æœƒçœ‹åˆ°åœ–å±¤è·Ÿé é¢
       åˆ†å®¶ â€”â€” é‚£å°±æ˜¯ã€Œåœ–ç‰‡è·Ÿé é¢æ²’æœ‰å®Œå…¨åŒæ­¥ã€çš„å¦ä¸€åŠã€‚ */
    transition: dragShift ? (dragShift.live ? 'none' : 'transform 220ms cubic-bezier(0.2,0,0,1)') : undefined,
  };

  /* åœ–å½¢æœ¬é«”ç”¨å›ºå®š backing store + scale() æ‰ä¸æœƒé‡å»ºç•«å¸ƒï¼›æ“ä½œ UI ä¸èƒ½è·Ÿè‘—
     scaleï¼Œå¦å‰‡é¸ä¸­æ¡†ã€æŽ§åˆ¶æ¢èˆ‡ç™½è‰²è—¥ä¸¸éƒ½æœƒä¸€èµ·è®Šç²—è®Šå¤§ã€‚å¤–æ¡†å› æ­¤ä½¿ç”¨ç­‰åƒ¹çš„
     å·²ç¸®æ”¾å¹¾ä½•ï¼Œå°ºå¯¸è·Ÿåœ–å½¢å®Œå…¨é‡åˆï¼Œä½† UI è‡ªå·±ç¶­æŒèž¢å¹•ä¸Šçš„å›ºå®šå¤§å°ã€‚ */
  const chromeWrapGeo: React.CSSProperties = image.shape ? (() => {
    const cx = image.x + image.width / 2;
    const cy = image.y + image.height / 2;
    const w = boxW;
    const h = boxH;
    return {
      position: 'absolute',
      left: `${liveGeometry ? cx - w / 2 : snapPx(cx - w / 2)}px`,
      top: `${liveGeometry ? cy - h / 2 : snapPx(cy - h / 2)}px`,
      width: `${w}px`, height: `${h}px`,
      transformOrigin: 'center center',
      transform: (dragShift || (image.rotation % 360) !== 0)
        ? `${dragShift ? `translate(${dragShift.tx}px, ${dragShift.ty}px) scale(${dragShift.s}) ` : ''}rotate(${image.rotation}deg)`
        : undefined,
      transition: dragShift ? (dragShift.live ? 'none' : 'transform 220ms cubic-bezier(0.2,0,0,1)') : undefined,
    };
  })() : wrapGeo;

  /* é¸å–æ¡†ã€å››è§’åœ“çƒã€å·¥å…·åˆ— â€”â€” çµ±ç¨±ã€Œå¤–æ¡†ã€ã€‚
     é€™ä¸€æ•´çµ„æœƒè¢«æ¬åˆ° chromeLayer é‚£ä¸€å±¤åŽ»ç•«ï¼ˆé‚£ä¸€å±¤ä¸åœ¨ overflow-hidden åº•ä¸‹ï¼‰ï¼Œ
     æ‰€ä»¥ç‰©ä»¶è¢«æ‹–å‡ºç•«å¸ƒæ™‚ï¼Œæ¡†è·ŸæŒ‰éˆ•ä¸æœƒè¢«é‚Šç·£çš„é»‘è‰²åˆ‡æŽ‰ã€‚
     åªæœ‰ç‰©ä»¶æœ¬èº«é‚„ç•™åœ¨æœƒè¢«è£åˆ‡çš„é‚£ä¸€å±¤ã€‚ */
  /* åœ–å½¢åœ–å±¤çš„æé‚Šåƒæ•¸ã€‚å…¨éƒ¨ç”¨ã€Œæ²’æœ‰ç¸®æ”¾å‰ã€çš„å°ºå¯¸ç®— â€”â€”
     SVG çš„ viewBox ä¹Ÿæ˜¯é‚£å€‹å°ºå¯¸ï¼Œç¸®æ”¾äº¤çµ¦å¤–æ¡†ï¼Œå…©è»¸å€çŽ‡ä¸€æ¨£ã€‚
     â”€â”€ ç·šä¸€å¾‹å†é™¤ä»¥ scale â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     viewBox è£¡çš„ 1 å–®ä½ç•«åœ¨ç•«é¢ä¸Šå°±æ˜¯ scaleï¼Œæ‰€ä»¥ä¸é™¤çš„è©±ã€ŒæŠŠåœ–å½¢æ‹‰å¤§ã€
     é€£æ¡†ç·šä¹Ÿè·Ÿè‘—è®Šç²—ï¼Œæ‹‰åˆ°ä¸‰å€å°±è®Šæˆä¸‰å€ç²—çš„æ¡†ã€‚åœ–å½¢çš„ width/height æ˜¯
     æ–°å¢žæ™‚å°±å®šä¸‹ä¾†çš„ã€ä¹‹å¾Œç¸®æ”¾åªå‹• scaleï¼Œé™¤æŽ‰å®ƒä¹‹å¾Œä¸è«–æ‹‰å¤šå¤§å¤šå°ï¼Œ
     æ¡†ç·šã€è™›ç·šçš„ç¯€å¥ã€å¤–æé‚Šçœ‹èµ·ä¾†éƒ½æ˜¯åŒä¸€å€‹ç²—ç´°ã€‚ */
  const shapeStroke = (() => {
    if (!image.shape) return null;
    const s = renderScale;
    const lineBase = image.shapeLineBase || Math.max(image.width, image.height);
    const lw = GRID_SHAPE_KINDS.has(image.shape)
      ? 1.5 / s
      : Math.max(0.4, (image.shapeLineW ?? 6) * (lineBase / 160)) / s;
    const dash = image.shapeDash || 0;
    const seg = lw * (0.6 + (dash / 100) * 4);
    return {
      lw,
      /** å¤–æé‚Šçš„å¯¬åº¦ï¼ˆå–®é‚Šï¼‰ã€‚è·Ÿæ¡†ç·šåŒä¸€å€‹é“ç†ï¼Œä¹Ÿè¦é™¤æŽ‰ scale */
      outer: Math.min(4, Math.max(0, image.shapeStrokeW || 0)) * (lineBase / 160) / s,
      dashArray: dash > 0 ? `${r3(seg)} ${r3(seg * 0.85)}` : undefined,
      // ä¸€å¾‹å¹³é ­ï¼šç·šæ¢çš„å…©ç«¯è¦æ˜¯åˆ‡é½Šçš„ï¼Œä¸è¦åœ“è§’
      cap: 'butt' as const,
      join: (image.shape === 'line' ? 'round' : 'miter') as 'round' | 'miter',
    };
  })();

  /* å€Ÿä¾†çš„åœ–æ¡ˆï¼šç•«çš„åƒæ•¸èˆ‡ã€Œå®ƒæœƒè¶…å‡ºå¤–æ¡†å¤šå°‘ã€ã€‚
     å…©å€‹åœ°æ–¹è¦ç”¨åˆ°ï¼ˆç•«å¸ƒçš„åƒç´ å°ºå¯¸ã€ç•«å¸ƒåœ¨ç‰ˆé¢ä¸Šçš„ä½ç½®ï¼‰ï¼Œ
     æ‰€ä»¥ç®—åœ¨é€™è£¡ã€å…©é‚ŠåƒåŒä¸€ä»½ã€‚ */
  const holeOpts = image.shape === 'hole' ? {
    hole: image.holeType || 'circle', filled: image.shapeFilled,
    color: image.color || SHAPE_DEFAULT_COLOR,
    lineW: image.shapeLineW, glow: image.shapeGlow as any,
    glowColor: image.shapeGlowColor, strokeW: image.shapeStrokeW,
    strokeColor: image.shapeStrokeColor,
    dots: image.shapeDots, dotSize: image.shapeDotSize,
    dotGap: image.shapeDotGap, dotColor: image.shapeDotColor,
    tex: image.shapeTex, stripeN: image.shapeStripeN, stripeDir: image.shapeStripeDir,
    stripeA: image.shapeStripeA || image.color || SHAPE_DEFAULT_COLOR,
    stripeB: image.shapeStripeB || '#FFFFFF',
    id: image.id,
    /* ç·šå¯¬çš„å–®ä½åˆ»æ„ä¸å« scaleï¼šä¸ç„¶ã€ŒæŠŠåœ–æ¡ˆæ‹‰å¤§ã€æ¡†ç·šä¹Ÿè·Ÿè‘—è®Šç²—ã€‚
       è·Ÿ SVG é‚£äº›åœ–å½¢é™¤ä»¥ scale æ˜¯åŒä¸€æ¢è¦å‰‡ã€‚ */
    lineUnit: Math.max(image.width, image.height) / 160 / renderScale,
  } : null;
  /* è¶…å‡ºé‡è·Ÿå°ºå¯¸æˆæ­£æ¯”ï¼Œæ‰€ä»¥ç”¨ã€Œæ²’æœ‰ç¸®æ”¾å‰ã€çš„æ¡†ç®—ä¸€æ¬¡å°±å¥½ï¼Œ
     è¦æ›åˆ°ç•«å¸ƒçš„åƒç´ åªè¦å†ä¹˜ä¸Š scaleÃ—dprã€‚
     ï¼ˆæ¡†æœ‰ä¸€é‚Šæ˜¯ 0 çš„è©±å¾Œé¢çš„ç™¾åˆ†æ¯”æœƒè®Šæˆ NaNï¼Œæ‰€ä»¥å…ˆæ“‹æŽ‰ã€‚ï¼‰ */
  const holeOv = (holeOpts && image.width > 0 && image.height > 0)
    ? holeOverflow(holeOpts, image.width, image.height, shapeGlowBlurs(image.width, image.height))
    : { x: 0, y: 0 };

  /* â”€â”€ ç¶“å…¸æ‹¼åœ–çš„å‘é‡ç‰©ä»¶æ”¹ç”¨ Canvas é è¦½ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     å‰µæ„æ‹¼åœ–ä¹‹æ‰€ä»¥ç§»å‹•ã€ç¸®æ”¾æ™‚ä¸æŠ–ä¹Ÿä¸ç•™æ®˜å½±ï¼Œé—œéµä¸æ˜¯å¤šåŠ ä¸€å±¤ CSSï¼Œ
     è€Œæ˜¯æ¯ä¸€å¹€éƒ½åœ¨åŒä¸€å¼µ canvas ä¸Šå…ˆ clearRectã€å†ç”¨åŒä¸€çµ„ä¸­å¿ƒåº§æ¨™é‡ç•«ã€‚
     ç¶“å…¸æ‹¼åœ–åŽŸæœ¬å»è®“åœ–å½¢èµ° SVGã€æ–‡å­—èµ° DOM è¡Œç›’ã€ç¬¦è™Ÿåˆèµ°å¦ä¸€å¼µ SVGï¼›
     ä¸‰ç¨®å¼•æ“Žçš„å°æ•¸å–æ•´èˆ‡å¤±æ•ˆç¯„åœä¸åŒï¼Œä»»ä½•å¤–å±¤ç¸®æ”¾éƒ½å¯èƒ½äº’ç›¸éŒ¯ä¸€æ ¼ã€‚

     é€™è£¡æŠŠåœ–å½¢ï¼ç¬¦è™Ÿï¼æ–‡å­—çš„ã€Œå¯è¦‹æœ¬é«”ã€å…¨éƒ¨æ”¶æ–‚åˆ° Canvasã€‚åŽŸæœ¬çš„ DOM
     ä»ç•™è‘—åšç²¾ç¢ºå­—å½¢é‡æ¸¬èˆ‡æ–‡å­—è¼¸å…¥ï¼Œä½†å¹³å¸¸ä¸å†é¡¯ç¤ºã€‚ç¹ªåœ–åƒæ•¸æ²¿ç”¨åŒ¯å‡º
     çš„åŒä¸€å¥— pathã€ç´‹ç†ã€æé‚Šèˆ‡å­—é«”åº¦é‡ï¼Œæ‰€ä»¥é è¦½èˆ‡æˆå“ä¹Ÿæœƒä¸€è‡´ã€‚ */
  const vectorCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorWaveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isCanvasVector = !!image.shape || image.text !== undefined;
  const usesUnitMotion = image.text !== undefined && (
    motionFrame?.seq !== undefined
    || (image.mo?.idle === 'symbol-breathe2' && motionFrame?.idleT !== undefined)
    || motionFrame?.gridWave !== undefined
  );
  /* å¤–å±¤åªè² è²¬å›ºå®šç‰©ä»¶ä¸­å¿ƒï¼›çœŸæ­£é…ç½®åƒç´ çš„å…§å±¤åªåŒ…ä½å¢¨æ°´ã€‚
     ä¸Šä¸€ç‰ˆæ¯å€‹ç‰©ä»¶éƒ½é–‹ä¸€å¼µæœ€é«˜ 3072Â² çš„ã€Œæ•´é é€æ˜Žç•«å¸ƒã€ï¼ŒiOS/Safari å¾ˆå¿«
     å°±æœƒè¶…éŽ Canvas è¨˜æ†¶é«”é¡åº¦ï¼Œå¾Œå»ºç«‹çš„ç•«å¸ƒæœƒè¢«æ¸…ç©ºï¼Œçœ‹èµ·ä¾†å°±æ˜¯ç‰©ä»¶å¶ç™¼
     æ¶ˆå¤±ã€‚å‰µæ„æ‹¼åœ–åªæœ‰ä¸€å¼µä¸»ç•«å¸ƒï¼Œä¸æœƒæµªè²»é€™äº›é€æ˜Žåƒç´ ï¼›ç¶“å…¸æ‹¼åœ–åœ¨ä¿ç•™
     DOM åœ–å±¤é †åºçš„å‰æä¸‹ï¼Œä¹Ÿåªé…ç½®å¯¦éš›å…§å®¹ç¯„åœã€‚ */
  const vectorPad = (() => {
    if (image.shape === 'hole') {
      return {
        x: Math.max(3, holeOv.x * boxW / Math.max(1, image.width)),
        y: Math.max(3, holeOv.y * boxH / Math.max(1, image.height)),
      };
    }
    const glow = image.shape
      ? Math.max(...shapeGlowBlurs(image.width, image.height), 0) * image.scale * glowAmount(image.shapeGlow as any)
      : Math.min(12, image.glow || 0) / 20 * 42 * image.scale;
    const stroke = image.shape
      ? Math.min(4, Math.max(0, image.shapeStrokeW || 0))
          * (image.shapeLineBase || Math.max(image.width, image.height)) / 160
      : (image.strokeWidth || 0) * 2 * image.scale;
    const p = Math.ceil(Math.max(3, glow * 1.5, stroke) + 3);
    /* æ³¡æ³¡ï¼ç¸®æ”¾ II æœƒè®“å–®ä¸€å°å–®ä½æš«æ™‚è¶…å‡ºéœæ­¢å¢¨æ°´å¤–æ¡†ï¼›Canvas ç•™ç™½è‹¥åª
       æŒ‰æé‚Šè¨ˆç®—ï¼Œæœ€å¤–å´å–®ä½æ”¾å¤§æ™‚æœƒè¢«åˆ‡æŽ‰ã€‚åªæ“´é€æ˜Žå·¥ä½œå€ï¼Œä¸æ”¹ç‰©ä»¶ç›’ã€
       é¸ä¸­æ¡†æˆ–ä¸­å¿ƒï¼Œå› æ­¤åŽŸæœ¬æ­£å¸¸çš„ç¬¦è™Ÿä¸æœƒè¢«æŽ¨ç§»ã€‚ */
    const unitMotionPad = image.sym && usesUnitMotion
      ? Math.ceil((image.fontSize || 40) * (image.scale || 1) * .3)
      : 0;
    return { x: p + unitMotionPad, y: p + unitMotionPad };
  })();
  const vectorSurfaceW = Math.max(256, (maxTextWidth || image.width || 1) * 2);
  const vectorSurfaceH = Math.max(256, (canvasHeight || image.height || 1) * 2);
  /* WebKit æœƒæŠŠ translate(-50%) çš„ã€ŒåŠå€‹å¥‡æ•¸å¯¦é«”åƒç´ ã€äº¤æ›¿å¾€å…©å´å–æ•´ï¼Œ
     å³ä½¿è³‡æ–™ä¸­å¿ƒå®Œå…¨ä¸å‹•ï¼Œç•«é¢ä»æœƒä¾†å›žç´„ 0.16pxã€‚å…§å±¤å¯¬é«˜å›ºå®šå¸åˆ°å¶æ•¸å€‹
     è£ç½®åƒç´ å¾Œï¼Œä¸€åŠä»è½åœ¨åŒä¸€æ¢åƒç´ æ ¼ç·šä¸Šï¼Œä¸­å¿ƒä¸å†éš¨å°ºå¯¸è®ŠåŒ–æ¼‚ç§»ã€‚ */
  /* èˆŠè‰ç¨¿è£¡çš„é•·ç¬¦è™Ÿå¯èƒ½ä»ä¿å­˜è‘—æ—©æœŸç®—å¾—éŽå°çš„ width/heightã€‚
     å¯è¦‹ Canvas èˆ‡é¸ä¸­æ¡†éƒ½ä»¥ç›®å‰çœŸæ­£å¢¨æ°´ç¯„åœç‚ºä¸‹é™ï¼Œå³åŠé‚Šä¸æœƒå…ˆè¢«å…§å±¤
     Canvas è£æŽ‰ï¼›ç‰©ä»¶ä¸­å¿ƒèˆ‡æ—¢æœ‰ä½ç½®è³‡æ–™å®Œå…¨ä¸è®Šã€‚ */
  const symbolVectorInk = image.sym ? (() => {
    const size = image.fontSize || 40;
    const ink = measureSymbolStickerInk(image.text || image.sym!, (image.sym ? SYMBOL_FONT : (image.fontFamily || DEFAULT_FONT)));
    return { w: ink.w * size * (image.scale || 1), h: ink.h * size * (image.scale || 1) };
  })() : null;
  const vectorInkW = Math.max(1, boxW, symbolVectorInk?.w || 0) + vectorPad.x * 2;
  const vectorInkH = Math.max(1, boxH, symbolVectorInk?.h || 0) + vectorPad.y * 2;
  const vectorRotRad = (image.rotation * Math.PI) / 180;
  /* ç•«å¸ƒæœ¬èº«ä¸æ—‹è½‰ã€å…§å®¹åœ¨è£¡é¢æ—‹è½‰ï¼Œå› æ­¤è¦é…ç½®æ—‹è½‰å¾Œçš„å¤–æŽ¥çŸ©å½¢ï¼›å¦å‰‡çª„é•·
     æ–‡å­—æˆ–åœ–å½¢è½‰åˆ° 45Â° æ™‚å››å€‹è§’æœƒè¢« Canvas é‚Šç•Œåˆ‡æŽ‰ï¼Œçœ‹èµ·ä¾†åƒå¶ç™¼æ¶ˆå¤±ã€‚ */
  const vectorContentW = snapPx2(Math.max(1,
    vectorInkW * Math.abs(Math.cos(vectorRotRad)) + vectorInkH * Math.abs(Math.sin(vectorRotRad))));
  const vectorContentH = snapPx2(Math.max(1,
    vectorInkW * Math.abs(Math.sin(vectorRotRad)) + vectorInkH * Math.abs(Math.cos(vectorRotRad))));
  /* å‰µæ„æ‹¼åœ–ç¸®æ”¾ç‰©ä»¶æ™‚ï¼Œç‰©ä»¶æ˜¯åœ¨ä¸€å¼µå°ºå¯¸å›ºå®šçš„ä¸» Canvas è£¡é‡ç•«ï¼›ç¶“å…¸æ‹¼åœ–
     ä»¥å‰å»è®“æ¯é¡†ç‰©ä»¶è‡ªå·±çš„ Canvas è·Ÿè‘—å…§å®¹æ¯å¹€æ”¹å°ºå¯¸ã€‚Safari æ¯æ¬¡é‡è¨­
     canvas.width/height éƒ½æœƒéŠ·æ¯€å†å»ºç«‹ backing storeï¼Œä¸­å¿ƒèˆ‡é‚Šç·£çš„å–æ•´ä¹Ÿæœƒ
     é‡æ–°é–‹å§‹ï¼Œè‚‰çœ¼çœ‹åˆ°çš„å°±æ˜¯æŠ–å‹•ã€‚æ‰‹å‹¢é–‹å§‹æ™‚åªæ“´ä¸€æ¬¡å·¥ä½œç•«å¸ƒï¼Œä¹‹å¾Œåª clear
     èˆ‡é‡ç•«å…§å®¹ï¼›æ”¾æ‰‹æ‰ç¸®å›žå…§å®¹ç¯„åœã€‚ */
  const gestureCanvasLock = useRef<{ w: number; h: number } | null>(null);
  if (gestureRendering && !gestureCanvasLock.current) {
    gestureCanvasLock.current = {
      w: snapPx2(Math.min(vectorSurfaceW, Math.max(256, vectorContentW * 3))),
      h: snapPx2(Math.min(vectorSurfaceH, Math.max(256, vectorContentH * 3))),
    };
  } else if (!gestureRendering && gestureCanvasLock.current) {
    gestureCanvasLock.current = null;
  }
  const vectorCssW = gestureCanvasLock.current?.w ?? vectorContentW;
  const vectorCssH = gestureCanvasLock.current?.h ?? vectorContentH;
  const vectorGlyphRef = useRef<SVGTextElement>(null);
  const [vectorGlyphCorrection, setVectorGlyphCorrection] = useState({ x: 0, y: 0 });
  /* ä¸çŒœä¸åŒå¼•æ“Žçš„ baselineï¼šç›´æŽ¥è¯»å–æœ€ç»ˆè´Ÿè´£æ˜¾ç¤ºçš„ SVG å­—å½¢èŒƒå›´ï¼Œå†æŠŠå®ƒçš„
     å®žé™…ä¸­å¿ƒæ ¡å›žç‰©ä»¶ä¸­å¿ƒã€‚getBBox æ˜¯æœªå¥—å¤–å±‚ scale çš„å›ºå®šå‘é‡åº§æ ‡ï¼Œæ‰€ä»¥åªéœ€
     åœ¨æ–‡å­—å†…å®¹æˆ–å­—ä½“æ ·å¼æ”¹å˜æ—¶é‡ä¸€æ¬¡ï¼Œç¼©æ”¾æœŸé—´å®Œå…¨ä¸ä¼šè§¦å‘å¸ƒå±€æˆ–é‡æ–°æ ¡æ­£ã€‚ */
  useLayoutEffect(() => {
    if (image.text === undefined) return;
    let alive = true;
    let raf = 0;
    let passes = 0;
    const centerGlyph = () => {
      if (!alive) return;
      const node = vectorGlyphRef.current;
      if (!node) return;
      const b = node.getBBox();
      const ex = b.x + b.width / 2;
      const ey = b.y + b.height / 2;
      if (Math.abs(ex) < 0.01 && Math.abs(ey) < 0.01) return;
      setVectorGlyphCorrection(prev => ({ x: prev.x - ex, y: prev.y - ey }));
      /* å­—ä½“é¦–æ¬¡è¿›å…¥ SVG æ—¶ï¼ŒWebKit å¶å°”ä¼šåœ¨ä¸‹ä¸€æ¬¡ layout æ‰æ¢æŽ‰ fallbackã€‚
         è¿žç»­æ ¡éªŒè‡³å¤šä¸‰å¸§åªå‘ç”Ÿåœ¨æ–°å¢žï¼æ¢å­—ä½“ä¹‹åŽï¼Œä¸å‚ä¸Žä»»ä½•ç¼©æ”¾æ‰‹åŠ¿ã€‚ */
      if (++passes < 3) raf = requestAnimationFrame(centerGlyph);
    };
    waitForFont((image.sym ? SYMBOL_FONT : (image.fontFamily || DEFAULT_FONT)), image.bold ? 700 : 400, !!image.italic)
      .then(() => { if (alive) raf = requestAnimationFrame(centerGlyph); });
    return () => { alive = false; if (raf) cancelAnimationFrame(raf); };
  }, [image.text, image.sym, image.fontFamily, image.fontSize, image.bold, image.italic,
      image.letterSpacing, image.strokeWidth]);
  const [holeAssetRevision, setHoleAssetRevision] = useState(0);
  useEffect(() => {
    if (image.shape !== 'hole' || !image.holeType || !isImageHole(image.holeType)) return;
    const asset = getHoleImg(image.holeType);
    if (!asset || (asset.complete && asset.naturalWidth)) return;
    let alive = true;
    const ready = () => { if (alive) setHoleAssetRevision(v => v + 1); };
    asset.addEventListener('load', ready, { once: true });
    asset.addEventListener('error', ready, { once: true });
    return () => {
      alive = false;
      asset.removeEventListener('load', ready);
      asset.removeEventListener('error', ready);
    };
  }, [image.shape, image.holeType]);

  useLayoutEffect(() => {
    /* ä¸€èˆ¬æ–‡å­—ç¶­æŒ SVGï¼›ç¬¦è™Ÿåˆ™ä¸Žåˆ›æ„æ‹¼å›¾ä¸€æ ·èµ° Canvas çš„åŒä¸€å¥—å¢¨æ°´æµ‹é‡ä¸Ž
       fillTextã€‚è¿™æ ·é¢„è§ˆç¼©æ”¾åªæ˜¯åœ¨ç§»åŠ¨ä¸€å¼ é¢„å…ˆè¶…å–æ ·çš„ç´§å‡‘ä½å›¾ï¼Œä¸ä¼šæ¯ä¸€å¸§
       è®© WebKit é‡å»ºå¤§åž‹å¤åˆ Unicode SVGï¼Œè§£å†³æœ‰ç¬¦å·æ—¶çš„æ˜Žæ˜¾æŽ‰å¸§ã€‚ */
    if (!isCanvasVector || (image.text !== undefined && !image.sym && !usesUnitMotion)) return;
    const canvas = vectorCanvasRef.current;
    if (!canvas) return;
    let alive = true;
    let raf = 0;
    const draw = () => {
      if (!alive) return;
      /* è·Ÿå‰µæ„æ‹¼åœ–ä¸€æ¨£ä»¥ã€Œç•«é¢å¯¦é«”åƒç´ ï¼‹è¶…å–æ¨£ã€æ±ºå®šè§£æžåº¦ã€‚åªé…ç½®å¢¨æ°´ç¯„åœï¼Œ
         å› æ­¤å¯ä»¥åœ¨åŒæ¨£è¨˜æ†¶é«”å…§ä¿ç•™æ›´é«˜å¯†åº¦ï¼ŒåŒæ™‚é¿é–‹ Safari å›žæ”¶ç•«å¸ƒã€‚ */
      /* æ‰‹å‹¢ä¸­éŽ–å®šåŒä¸€å¡Š Canvasï¼Œåƒ…æ¸…é™¤ä¸¦é‡ç•«å…§å®¹ï¼Œé¿å…æ¯å¹€æ”¹è®Š backing
         store å°ºå¯¸é€ æˆæŠ–å‹•èˆ‡æ®˜å½±ï¼›æ”¾æ‰‹å¾Œå†ä»¥å®Œæ•´å¯†åº¦ç²¾ç¹ªä¸€æ¬¡ã€‚ */
      const dpr = Math.max(2, geoDpr * Math.max(1, canvasScale) * (gestureRendering ? 1.5 : 3));
      const cssW = vectorCssW;
      const cssH = vectorCssH;
      /* å°ºå¯¸ä¸Šé™èˆ‡é¢ç©ä¸Šé™è¦åŒæ™‚å®ˆä½ï¼šæ‰‹å‹¢æœŸé–“ä»¥ 4MP ç¶­æŒæ¯å¹€æµæš¢ï¼Œéœæ­¢æ™‚
         å›žåˆ° 8MPï¼›çª„é•·æ–‡å­—ä¹Ÿä¸æœƒåªå› é•·é‚Šè¼ƒé•·å°±éŽæ—©å¤±åŽ» Retina å¯†åº¦ã€‚ */
      const backingScale = Math.min(
        dpr,
        4096 / Math.max(cssW, cssH),
        Math.sqrt((gestureRendering ? 4_194_304 : 8_388_608) / Math.max(1, cssW * cssH)),
      );
      const W = Math.max(1, Math.ceil(cssW * backingScale));
      const H = Math.max(1, Math.ceil(cssH * backingScale));
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      /* ç¶“å…¸æ‹¼åœ–çš„æ³¢æµªèˆ‡å‰µæ„æ‹¼åœ–å…±ç”¨åŒä¸€ç¨®åšæ³•ï¼šæœ¬é«”å…ˆå®Œæ•´ç•«å¥½ï¼Œå†æŠŠ
         æˆå“åˆ†æˆé€£çºŒæ–œçŽ‡çš„å°ç›´ç‰‡ã€‚é€™å€‹æ”¶å°¾å‡½å¼åªæ”¹åƒç´ ï¼Œä¸å‹•ç‰©ä»¶æ ¹ç¯€é»žã€
         å¤–æ¡†æˆ–ä¸­å¿ƒåº§æ¨™ï¼Œå› æ­¤ä¸å¯èƒ½é€€åŒ–æˆæ•´é¡†ä¸Šä¸‹æ¼‚ç§»ã€‚ */
      const applyVectorWave = () => {
        const phase = motionFrame?.gridWave;
        const mix = motionFrame?.waveMix ?? 1;
        if (phase === undefined || mix <= 1e-5) return;
        const scratch = vectorWaveCanvasRef.current || document.createElement('canvas');
        vectorWaveCanvasRef.current = scratch;
        if (scratch.width !== W) scratch.width = W;
        if (scratch.height !== H) scratch.height = H;
        const sg = scratch.getContext('2d');
        if (!sg) return;
        sg.setTransform(1, 0, 0, 1, 0, 0);
        sg.clearRect(0, 0, W, H);
        sg.drawImage(canvas, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const reveal = motionFrame?.gridReveal === undefined
          ? 1 : Math.max(0, Math.min(1, motionFrame.gridReveal));
        const shownW = W * reveal;
        const span = Math.max(1, boxW * backingScale);
        const left = W / 2 - span / 2;
        const amp = Math.min(10 * backingScale, boxH * backingScale * .065)
          * Math.max(.15, (image.mo?.amp ?? 50) / 100) * mix;
        const segments = Math.max(32, Math.min(128, Math.ceil(shownW / 8)));
        const sw = shownW / segments;
        for (let i = 0; i < segments; i++) {
          const x = i * sw;
          const x1 = i + 1 === segments ? shownW : x + sw;
          const dy0 = Math.sin(((x - left) / span - phase) * Math.PI * 2) * amp;
          const dy1 = Math.sin(((x1 - left) / span - phase) * Math.PI * 2) * amp;
          const slope = (dy1 - dy0) / Math.max(.001, x1 - x);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - .5, -amp - 2, x1 - x + 1, H + amp * 2 + 4);
          ctx.clip();
          ctx.transform(1, slope, 0, 1, 0, dy0 - slope * x);
          ctx.drawImage(scratch, x - 1, 0, x1 - x + 2, H, x - 1, 0, x1 - x + 2, H);
          ctx.restore();
        }
      };
      ctx.save();
      ctx.translate(cssW / 2, cssH / 2);
      ctx.rotate((image.rotation * Math.PI) / 180);

      if (image.shape === 'hole') {
        /* å­—ç¬¦ï¼åŽ»èƒŒåœ–ç‰‡åž‹åœ–å½¢æœƒåœ¨ drawHoleShape è£¡å…ˆç•«åˆ°æš«å­˜ Canvasã€‚
           å¤–å±¤ CTM ä¸æœƒå‚³é€²é‚£å¼µæš«å­˜ Canvasï¼›ä»¥å‰å› æ­¤å…ˆç”Ÿæˆä½Žè§£æžå­—ï¼Œå†æ•´å¼µ
           æ”¾å¤§ backingScale å€ï¼Œæ–‡å­—åž‹åœ–å½¢ç¸®å°æ™‚å°±ç³Šã€‚é€™ä¸€æ”¯æ”¹ç”¨å¯¦é«”åƒç´ 
           åº§æ¨™ç›´æŽ¥ç•«ï¼Œæš«å­˜ Canvas ä¹Ÿæœƒå¾—åˆ°ç›¸åŒçš„é«˜è§£æžåº¦ã€‚ */
        ctx.restore();
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(cssW / 2 * backingScale, cssH / 2 * backingScale);
        ctx.rotate((image.rotation * Math.PI) / 180);
        const holeFeather = shapeSupportsFeather(image.shape, image.shapeFilled, image.holeType)
          ? shapeFeatherBlur(boxW, boxH, image.shapeFeather) * backingScale : 0;
        if (holeFeather > 0) ctx.filter = `blur(${holeFeather}px)`;
        drawHoleShape(ctx, {
          ...holeOpts!,
          lineUnit: Math.max(image.width, image.height) / 160 * backingScale,
        }, boxW * backingScale, boxH * backingScale,
        shapeGlowBlurs(image.width, image.height)
          .map(r => r * image.scale * glowAmount(image.shapeGlow as any) * backingScale));
        ctx.restore();
        applyVectorWave();
        return;
      }

      if (image.shape) {
        ctx.translate(-boxW / 2, -boxH / 2);
        const path = new Path2D(shapePathD(
          image.shape, boxW, boxH,
          (image.shapeTextureBaseW || image.width) * renderScale,
          (image.shapeTextureBaseH || image.height) * renderScale,
          ((image.shapeLineBase || Math.max(image.width, image.height)) / 160) * 2.325
            * Math.pow(Math.max(0.01, renderScale), 0.35),
        ));
        const color = image.color || SHAPE_DEFAULT_COLOR;
        const solid = !!image.shapeFilled && image.shape !== 'line';
        const lineBase = image.shapeLineBase || Math.max(image.width, image.height);
        const lw = GRID_SHAPE_KINDS.has(image.shape)
          ? 1.5
          : Math.max(0.4, (image.shapeLineW ?? 6) * (lineBase / 160));
        const outer = Math.min(4, Math.max(0, image.shapeStrokeW || 0)) * (lineBase / 160);
        ctx.lineJoin = image.shape === 'line' ? 'round' : 'miter';
        ctx.lineCap = 'butt';
        ctx.miterLimit = 4;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        const dash = image.shapeDash || 0;
        ctx.setLineDash(dash > 0 ? [lw * (0.6 + dash / 100 * 4), lw * (0.6 + dash / 100 * 4) * 0.85] : []);
        const gAmt = glowAmount(image.shapeGlow as any);
        if (gAmt > 0) {
          ctx.save();
          ctx.shadowColor = image.shapeGlowColor || color;
          for (const r of shapeGlowBlurs(image.width, image.height)) {
            // shadowBlur ä¸åƒç›®å‰çš„ CTMï¼›è£œä¸Š backingScaleï¼Œç¸®å›ž CSS å°ºå¯¸å¾Œæ‰æ˜¯æ­£ç¢ºå¼·åº¦ã€‚
            ctx.shadowBlur = r * image.scale * gAmt * backingScale;
            solid ? ctx.fill(path) : ctx.stroke(path);
          }
          ctx.restore();
        }
        if (outer > 0) {
          ctx.save();
          ctx.setLineDash([]);
          ctx.strokeStyle = image.shapeStrokeColor || '#000000';
          ctx.lineWidth = (solid ? 0 : lw) + outer * 2;
          ctx.stroke(path);
          ctx.restore();
        }
        const tx = texOf({ tex: image.shapeTex, dots: image.shapeDots });
        if (solid) {
          if (GRID_DOT_KINDS.has(image.shape)) {
            /* é»žé™£å¿…é ˆä½¿ç”¨ä¸Šé¢å·²å¸¶å…¥å›ºå®š baseï¼å›ºå®šåŠå¾‘çš„ pathã€‚
               ä¸€èˆ¬å¯¦å¿ƒå‡½å¼æœƒç”¨ç•¶å‰å¯¬é«˜é‡å»ºè·¯å¾‘ï¼ŒæœƒæŠŠé»žè·é‡æ–°å¹³å‡ä¸¦æ”¾å¤§é»žå¾‘ã€‚ */
            ctx.fill(path);
          } else drawFeatheredShapeBody(ctx, image.shape, boxW, boxH, image.shapeFeather, color, (tc, bodyPath) => {
            if (tx === 'none') return;
            tc.save(); tc.clip(bodyPath); tc.translate(boxW / 2, boxH / 2);
            if (tx === 'dot' || tx === 'star' || tx === 'heart') paintTex(tc, boxW, boxH, boxW, boxH, {
              tex: tx, dotSize: image.shapeDotSize, dotGap: image.shapeDotGap, dotColor: image.shapeDotColor,
              textureBaseW: (image.shapeTextureBaseW || image.width) * image.scale,
              textureBaseH: (image.shapeTextureBaseH || image.height) * image.scale,
            });
            else paintStripes(tc, boxW, boxH, boxW, boxH, image.shapeStripeN ?? STRIPE_N_DEFAULT,
              image.shapeStripeDir === 'h' ? 'h' : 'v', image.shapeStripeA || color, image.shapeStripeB || '#FFFFFF');
            tc.restore();
          });
        } else {
          ctx.stroke(path);
        }
        ctx.restore();
        applyVectorWave();
        return;
      }

      const family = (image.sym ? SYMBOL_FONT : (image.fontFamily || DEFAULT_FONT));
      const size = image.fontSize || 40;
      const spacing = image.letterSpacing || 0;
      /* Safari æœƒä¾æ¯ä¸€å€‹ font-size é‡æ–° hint å­—å½¢ã€å†å„è‡ªå–æ•´ baselineã€‚ä¹‹å‰
         æåˆçš„æ¯ä¸€å¹€éƒ½æ”¹ font-sizeï¼Œç•«å¸ƒä¸­å¿ƒé›–ç„¶å›ºå®šï¼ŒçœŸæ­£çš„æ–‡å­—å¢¨æ°´ä¸­å¿ƒå»
         æœƒåœ¨ç›¸é„°åƒç´ é–“è·³ï¼›ç¬¦è™Ÿçš„è¤‡åˆå­—å½¢å°¤å…¶æ˜Žé¡¯ã€‚å›ºå®šåŸºç¤Žå­—ç´šèˆ‡å­—å½¢åº¦é‡ï¼Œ
         å°‡é€£çºŒå€çŽ‡åªå¥—åœ¨ Canvas çŸ©é™£ä¸Šï¼Œèˆ‡å‰µæ„æ‹¼åœ–åœ¨å›ºå®šä¸»ç•«å¸ƒè£¡è®Šæ›ç‰©ä»¶
         åº§æ¨™çš„çµæ§‹ç›¸åŒï¼Œä¹Ÿä¸æœƒè§¸ç™¼ DOMï¼å­—åž‹å¼•æ“Žé‡æ–°æŽ’ç‰ˆã€‚ */
      const textStretchX = !image.sym ? image.width / Math.max(1, image.textStretchBaseW || image.width) : 1;
      const textStretchY = !image.sym ? image.height / Math.max(1, image.textStretchBaseH || image.height) : 1;
      ctx.scale(image.scale * textStretchX, image.scale * textStretchY);
      ctx.font = `${image.italic ? 'italic ' : ''}${image.bold ? 700 : 400} ${size}px ${fontStack(family)}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      (ctx as any).letterSpacing = `${spacing}px`;
      const lines = (image.text || '').split('\n');
      const lineH = size * 1.12;
      const startY = -((lines.length - 1) * lineH) / 2;
      const ink = image.sym ? measureSymbolStickerInk(image.text || image.sym, family) : null;
      const dx = ink ? -ink.cx * size : 0;
      const dy = ink ? -ink.cy * size : 0;
      const unitMotionFrame = usesUnitMotion && lines.length === 1 ? motionFrame : null;
      const drawAnimatedUnits = (stroke = false) => {
        if (!unitMotionFrame && !image.sym) {
          lines.forEach((line, i) => stroke
            ? ctx.strokeText(line, dx, startY + i * lineH + dy)
            : ctx.fillText(line, dx, startY + i * lineH + dy));
          return;
        }
        const raster = rasterizeSymbolAnimationLayers(
          image.text || '', family, size, stroke ? 'stroke' : 'fill',
          stroke ? (image.strokeColor || '#000000') : (image.color || '#FFFFFF'),
          stroke ? (image.strokeWidth || 0) * 2 : 0,
          Math.max(2.5, Math.min(7, backingScale * Math.max(1, image.scale))),
          image.sym ? undefined : {
            plainText: true,
            fontWeight: image.bold ? 700 : 400,
            fontStyle: image.italic ? 'italic' : 'normal',
            letterSpacing: spacing,
          },
        );
        if (!raster) {
          lines.forEach((line, i) => stroke
            ? ctx.strokeText(line, dx, startY + i * lineH + dy)
            : ctx.fillText(line, dx, startY + i * lineH + dy));
          return;
        }
        /* ç¬¦è™Ÿéœæ­¢æ™‚ä¹Ÿç•«å‹•ç•«æ‰€ä½¿ç”¨çš„åŒä¸€å¼µå®Œæ•´ rasterï¼Œè€Œä¸æ˜¯åˆ‡å›ž raw
           fillTextã€‚é€™æ˜¯æ¶ˆé™¤ iPhone ä¸Šã€Œå‰›ç”Ÿæˆæ­£å¸¸ã€é€²å‹•ç•«å°±æ•´ä¸²åç§»ã€çš„
           é—œéµï¼šéœæ­¢ã€æ³¡æ³¡ã€ç¸®æ”¾ II ç¾åœ¨å…±ç”¨åŒä¸€å€‹ anchor èˆ‡åŒä¸€æ‰¹åƒç´ ã€‚ */
        if (!unitMotionFrame) {
          ctx.drawImage(raster.fullCanvas,
            raster.fullSX, raster.fullSY, raster.fullSW, raster.fullSH,
            dx + raster.fullX, dy + raster.fullY, raster.fullW, raster.fullH);
          return;
        }
        const count = raster.layers.length;
        const bubbleSpan = 1 + Math.max(0, count - 1) * .2;
        const seq = unitMotionFrame.seq;
        raster.layers.forEach((layer, index) => {
          const q = seq === undefined ? 1 : Math.max(0, Math.min(1, seq * bubbleSpan - index * .2));
          if (seq !== undefined && q <= .001) return;
          const backQ = (() => {
            const c1 = 1.70158, c3 = c1 + 1, z = q - 1;
            return 1 + c3 * z * z * z + c1 * z * z;
          })();
          const scale = image.mo?.idle === 'symbol-breathe2' && unitMotionFrame.idleT !== undefined
            ? 1 + (symbolBreatheScale(index, unitMotionFrame.idleT, image.mo.amp, image.mo.speed) - 1)
                * (unitMotionFrame.waveMix ?? 1)
            : backQ;
          ctx.save();
          if (seq !== undefined) ctx.globalAlpha *= Math.min(1, q * 3);
          /* æ¯å±¤åªç¹žè‡ªå·±å›ºå®šçš„å¢¨æ°´é‡å¿ƒç¸®æ”¾ï¼›å®Œæ•´å­—ä¸²çš„ dx/dy æ°¸é ä¸è®Šï¼Œ
             å› æ­¤å‹•ç•«èˆ‡éœæ­¢å…±ç”¨åŒä¸€å€‹ä¸­å¿ƒï¼Œä¸æœƒå‘å·¦æ¼‚ç§»æˆ–é‡æŽ’çµ„åˆå­—ã€‚ */
          ctx.translate(dx + layer.pivotX, dy + layer.pivotY);
          ctx.scale(scale, scale);
          ctx.drawImage(layer.canvas,
            layer.x - layer.pivotX, layer.y - layer.pivotY,
            layer.w, layer.h);
          ctx.restore();
        });
      };
      const fill = () => drawAnimatedUnits(false);
      ctx.fillStyle = image.color || '#FFFFFF';
      if (image.glow) {
        ctx.shadowColor = image.glowColor || '#FFFFFF';
        for (const k of [1, 2, 3]) {
          // shadowBlur ä¸åƒç›®å‰çš„ CTMï¼›é«˜è§£æž backing store å¿…é ˆæ‰‹å‹•æ›æˆå¯¦é«”åƒç´ ã€‚
          ctx.shadowBlur = (Math.min(12, image.glow) / 20) * 14 * k * image.scale * backingScale;
          fill();
        }
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      }
      if (image.strokeWidth) {
        // lineWidth æœƒè·Ÿè‘—ç›®å‰çš„ CTM ä¸€èµ·ç¸®æ”¾ï¼Œé€™è£¡ç¶­æŒåŸºç¤Žå€¼å³å¯ã€‚
        ctx.lineWidth = image.strokeWidth * 2;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = image.strokeColor || '#000000';
        drawAnimatedUnits(true);
      }
      fill();
      ctx.restore();
      applyVectorWave();
    };
    draw();
    /* å­—é«”å®Œæˆå¾Œè£œç•«åªéœ€è¦ç”¨åœ¨éœæ­¢ç‹€æ…‹ã€‚æ‰‹å‹¢ä¸­æ¯æ¬¡ state æ›´æ–°å·²ç¶“ç”±ä¸Šé¢çš„
       layout effect åŒæ­¥ç•«éŽï¼›è‹¥æ¯ä¸€å¹€åˆæŽ’ä¸€å€‹ font promise + RAFï¼Œæ–‡å­—ï¼ç¬¦è™Ÿ
       æœƒæ¯”åœ–å½¢å¤šç•«è¿‘ä¸€å€ï¼Œåœ¨ iPhone ä¸ŠæŽ‰å¹€å¾Œä¾¿åƒæ˜¯ä»åœ¨æŠ–å‹•ã€‚ */
    if (image.text !== undefined && !gestureRendering) {
      waitForFont((image.sym ? SYMBOL_FONT : (image.fontFamily || DEFAULT_FONT)), image.bold ? 700 : 400, !!image.italic)
        .then(() => { if (alive) raf = requestAnimationFrame(draw); });
    }
    return () => { alive = false; if (raf) cancelAnimationFrame(raf); };
  }, [
    isCanvasVector, usesUnitMotion, boxW, boxH, vectorPad.x, vectorPad.y, vectorCssW, vectorCssH,
    image.shape, image.holeType, image.shapeFilled, image.shapeLineW, image.shapeDash,
    image.shapeGlow, image.shapeGlowColor, image.shapeStrokeW, image.shapeStrokeColor,
    image.shapeTex, image.shapeDots, image.shapeDotSize, image.shapeDotGap, image.shapeDotColor,
    image.shapeStripeN, image.shapeStripeDir, image.shapeStripeA, image.shapeStripeB,
    image.shapeTextureBaseW, image.shapeTextureBaseH, image.color,
    image.text, image.sym, image.fontFamily, image.fontSize, image.bold, image.italic,
    image.letterSpacing, image.strokeWidth, image.strokeColor, image.glow, image.glowColor,
    image.scale, image.rotation, image.mo, canvasScale, gestureRendering, holeAssetRevision,
    motionFrame?.seq, motionFrame?.idleT, motionFrame?.waveMix,
    motionFrame?.gridWave, motionFrame?.gridReveal,
  ]);

  /* æ“ä½œ UI æŽ›åœ¨æ•´é çš„ç¸®æ”¾å®¹å™¨è£¡ï¼Œä½†è¦–è¦ºå°ºå¯¸å¿…é ˆç¶­æŒèž¢å¹• pxã€‚
     é¸å–å¾Œä¸€å®šæœƒé‡æ–° renderï¼Œæ‰€ä»¥é€™è£¡è®€åˆ°çš„æ˜¯ç•¶ä¸‹çœŸæ­£çš„é è¦½å€çŽ‡ã€‚ */
  const previewK = Math.max(0.0001, canvasK());
  const previewInv = 1 / previewK;

  const chrome = (
    <>
    {/* å°é½Šç·šäº®èµ·ä¾†çš„æ™‚å€™ï¼Œå·¥å…·åˆ—å…ˆæ”¶èµ·ä¾† â€”â€” é‚£ä¸€åˆ»ä½¿ç”¨è€…åœ¨çœ‹çš„æ˜¯ã€Œæœ‰æ²’æœ‰å°é½Šã€ï¼Œ
        ç™½è‰²çš„æŒ‰éˆ•å£“åœ¨ç™½è‰²çš„å°é½Šç·šä¸Šæœƒçœ‹ä¸æ¸…æ¥šã€‚æ”¾é–‹æ‰‹ï¼ˆç·šæ¶ˆå¤±ï¼‰å°±è‡ªå·±å›žä¾†ã€‚ */}
    {isSelected && onLayerAction && !hideToolbar && !hideChrome && !isDragging && !isScaling && !hasActiveGuidelines && (() => {
      // è½‰éŽè§’åº¦ä¹‹å¾Œè¦æ“ºåœ¨ã€Œç•«é¢ä¸Šæœ€é ä¸‹ã€çš„é‚£ä¸€å´ï¼šå…ˆç®—æ—‹è½‰å¾Œå¤–æŽ¥æ¡†çš„åŠé«˜ï¼Œ
      // å†æŠŠå·¥å…·åˆ—æ²¿è‘—ç•«é¢çš„ Y è»¸æŽ¨å‡ºåŽ»ï¼ˆç”¨å€åŸŸåº§æ¨™è¡¨ç¤ºï¼Œå› ç‚ºé€™å±¤è·Ÿè‘—æ¡†ä¸€èµ·è½‰ï¼‰ã€‚
      const rad = (image.rotation * Math.PI) / 180;
      /* å¥—äº†å½¢ç‹€çš„åœ–ç‰‡ï¼å½±ç‰‡ï¼Œç™½æ¡†èˆ‡å››é¡†è§’çƒå·²ç¶“ç¸®åˆ°ã€Œå½¢ç‹€é‚£å€‹æ­£æ–¹å½¢ã€äº†
         ï¼ˆè¦‹ä¸‹é¢çš„ chromeBoxï¼‰â€”â€” é€™ä¸€æŽ’ç™½è‰²è—¥ä¸¸ä¹Ÿè¦è·Ÿè‘—ç¸®ï¼Œä¸ç„¶å®ƒé‚„åœåœ¨
         åŽŸæœ¬é‚£å€‹é•·æ–¹å½¢çš„ä¸‹é¢ã€‚ç›´å¼çš„åœ–å±¤å·®è·æœ€æ˜Žé¡¯ï¼šæ­£æ–¹å½¢çš„ä¸‹ç·£æ¯”é•·æ–¹å½¢
         çš„ä¸‹ç·£é«˜å‡º (é«˜-å¯¬)/2ï¼Œè—¥ä¸¸å°±æœƒé é åœ°æŽ‰åœ¨å½¢ç‹€åº•ä¸‹ä¸€å¤§æˆªã€‚
         æ­£æ–¹å½¢è·ŸåŽŸæœ¬çš„æ¡†æ˜¯åŒå¿ƒçš„ï¼Œæ‰€ä»¥åªè¦æ›æŽ‰ã€ŒåŠå¯¬åŠé«˜ã€å°±å¥½ï¼Œ
         æ²’æœ‰å½¢ç‹€æ™‚ spanW/spanH å°±æ˜¯åŽŸæœ¬çš„ boxW/boxHï¼Œä¸€å€‹åƒç´ éƒ½ä¸æœƒå‹•ã€‚ */
      const shapeSide = (!image.shape && image.text === undefined
        && isImgShaped((image as any).imgShape) && image.width > 0)
        ? imgShapeBox(image.width, image.height).s * (boxW / image.width)
        : 0;
      const spanW = shapeSide || boxW;
      const spanH = shapeSide || boxH;
      const halfSpan =
        (spanW * Math.abs(Math.sin(rad)) + spanH * Math.abs(Math.cos(rad))) / 2;
      const dir = toolbarAbove ? -1 : 1;
      // ç‰©ä»¶åŠå¾‘æ˜¯å…§å®¹åº§æ¨™ï¼›æ¡†å¤–çš„ 26px é–“è·å‰‡æ˜¯èž¢å¹•åº§æ¨™ï¼Œè¦é™¤æŽ‰é è¦½å€çŽ‡ã€‚
      const d = dir * (halfSpan + 26 * previewInv);
      return (
      <div
        className="absolute left-1/2 top-1/2 flex items-center gap-0.5 bg-white rounded-full p-0.5 shadow-xl pointer-events-auto z-50"
        style={{
          transform: `translate(-50%, -50%) translate(${d * Math.sin(rad)}px, ${d * Math.cos(rad)}px) rotate(${-image.rotation}deg)`,
          gap: 2 * previewInv,
          padding: 2 * previewInv,
          boxShadow: `0 ${10 * previewInv}px ${24 * previewInv}px rgba(0,0,0,0.35)`,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (canLayerDown) onLayerAction('down'); }}
          disabled={!canLayerDown}
          title="ä¸‹ç§»ä¸€å±¤"
          style={{ width: 28 * previewInv, height: 28 * previewInv }}
          className={`rounded-full flex items-center justify-center ${canLayerDown ? 'text-black hover:bg-black/10' : 'text-black/25 cursor-default'}`}
        >
          <MoveDown size={14 * previewInv} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); if (canLayerUp) onLayerAction('up'); }}
          disabled={!canLayerUp}
          title="ä¸Šç§»ä¸€å±¤"
          style={{ width: 28 * previewInv, height: 28 * previewInv }}
          className={`rounded-full flex items-center justify-center ${canLayerUp ? 'text-black hover:bg-black/10' : 'text-black/25 cursor-default'}`}
        >
          <MoveUp size={14 * previewInv} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onLayerAction('copy'); }}
          title="è¤‡è£½"
          style={{ width: 28 * previewInv, height: 28 * previewInv }}
          className="rounded-full hover:bg-black/10 flex items-center justify-center text-black"
        >
          <Copy size={14 * previewInv} />
        </button>
        {/* ç·¨è¼¯éµï¼šæ–‡å­—èˆ‡åœ–ç‰‡éƒ½ç”¨åŒä¸€é¡†ï¼ˆè·Ÿä½ˆå±€é‚£é¡†åŒæ¬¾ï¼‰ */}
        <button
          onClick={(e) => { e.stopPropagation(); onLayerAction('edit'); }}
          title={image.text !== undefined ? 'ç·¨è¼¯æ–‡å­—' : image.shape ? 'åœ–å½¢èª¿æ•´' : 'åœ–ç‰‡èª¿æ•´'}
          style={{ width: 28 * previewInv, height: 28 * previewInv }}
          className="rounded-full hover:bg-black/10 flex items-center justify-center text-black"
        >
          <Sliders size={14 * previewInv} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onLayerAction('delete'); }} title="åˆªé™¤" style={{ width: 28 * previewInv, height: 28 * previewInv }}
          className="rounded-full hover:bg-black/10 flex items-center justify-center text-black">
          <Trash2 size={14 * previewInv} />
        </button>
      </div>
      );
    })()}

    {/* é¸å–æ¡†èˆ‡å››è§’åœ“çƒï¼šä¸ç”¨ã€ŒæŽ›è¼‰ï¼å¸è¼‰ã€åˆ‡æ›ï¼Œæ”¹æˆä¸€ç›´åœ¨ã€ç”¨ visibility é–‹é—œã€‚
        å¸è¼‰æ™‚ç€è¦½å™¨å¶çˆ¾ä¸æœƒé‡ç¹ªé‚£ä¸€å±¤ï¼ˆå°¤å…¶æ˜¯æœ‰ transform çš„åœ–å±¤ï¼‰ï¼Œ
        ç•«é¢ä¸Šå°±æœƒç•™ä¸‹å·²ç¶“å–æ¶ˆé¸å–çš„æ¡†èˆ‡åœ“çƒã€‚ */}
    {(() => {
      // å°é½Šç·šäº®èµ·ä¾†æ™‚ï¼Œé¸å–æ¡†èˆ‡å››è§’åœ“çƒä¹Ÿä¸€èµ·è®“ä½ï¼ˆè·Ÿå·¥å…·åˆ—åŒä¸€å€‹ç†ç”±ï¼‰
      const showChrome = isSelected && !hideChrome && !isDragging && !isScaling && !hasActiveGuidelines;
      /* â”€â”€ ç¸®æ”¾æ™‚é™°å½±æœƒç•™ä¸‹æ®˜å½±ï¼Œä½†**ä¸èƒ½**ç”¨ overflow:hidden è§£ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
         å•é¡Œæœ¬èº«ï¼šç™½è‰²é¸å–æ¡†å¸¶ä¸€åœˆ 4px çš„æ·±è‰²å¤–é™°å½±ã€å››é¡†åœ“çƒä¹Ÿå„å¸¶ä¸€åœˆï¼Œ
         é‚£äº›éƒ½ç•«åœ¨ã€Œæ¡†çš„å¤–é¢ã€ã€‚æ¡†åœ¨ç¸®æ”¾æ™‚æ¯ä¸€æ ¼éƒ½åœ¨ç¸®ï¼Œç€è¦½å™¨ç®—è¦é‡ç•«å“ªä¸€å¡Š
         æ™‚åªçœ‹æ¡†ã€ä¸çœ‹é™°å½±å¤šå‡ºåŽ»çš„é‚£ä¸€åœˆï¼ŒèˆŠé™°å½±å°±æ²’è¢«æ“¦æŽ‰ï¼Œä¸€æ ¼ç•™ä¸€æ¢ã€‚

         æˆ‘ä¸Šä¸€ç‰ˆæ˜¯æŠŠé€™ä¸€å±¤ overflow:hidden è£æŽ‰ã€‚é‚£ç¢ºå¯¦æ²’æœ‰æ®˜å½±äº†ï¼Œä½†ä¹ŸæŠŠ
         ã€Œæœ¬ä¾†å°±è©²éœ²åœ¨æ¡†å¤–é¢çš„æ±è¥¿ã€ä¸€èµ·è£æŽ‰ï¼š
           â‘  é¸å–æ¡†çš„å¤–é™°å½±æ•´å€‹ä¸è¦‹ï¼ˆæ‰€ä»¥æ‰è¢«è¿«æ”¹æˆ insetï¼Œçœ‹èµ·ä¾†å®Œå…¨ä¸ä¸€æ¨£ï¼‰
           â‘¡ å››é¡†åœ“çƒæ˜¯ç”¨ translate(-50%,-50%) æŽ›åœ¨å››å€‹è§’ä¸Šçš„ï¼Œå››åˆ†ä¹‹ä¸‰åœ¨æ¡†å¤–
              â€”â€” è¢«è£æˆå››åˆ†ä¹‹ä¸€åœ“ï¼Œåœ–å±¤çœ‹èµ·ä¾†å°±å¾ˆæ€ªã€‚
         é€™æ­£æ˜¯ä¸»äººèªªçš„ã€Œé¸ä¸­æ¡†çš„åœ–å±¤å¾ˆå¥‡æ€ªã€å½±å­ä¹Ÿä¸è¦‹äº†ã€ã€‚

         æ”¹æˆæ­£ç¢ºçš„åšæ³•ï¼šæŠŠé€™ä¸€å±¤**å‡æˆè‡ªå·±çš„åˆæˆå±¤**ï¼ˆtranslateZ(0) ï¼‹
         will-changeï¼‰ã€‚æ•´å±¤è‡ªå·±é‡ç•«ï¼Œé™°å½±å¤šå‡ºåŽ»çš„é‚£ä¸€åœˆä¹Ÿåœ¨é€™ä¸€å±¤è£¡ï¼Œ
         ç¸®æ”¾æ™‚æœƒæ•´å±¤ä¸€èµ·æ›´æ–°ï¼Œæ®˜å½±åŒæ¨£ä¸æœƒç•™ â€”â€” è€Œä¸”ä»€éº¼éƒ½ä¸å¿…è£ã€‚ */
      /* åœ–ç‰‡ä»¥å¤–çš„æ±è¥¿ï¼ˆåœ–å½¢ã€æ–‡å­—ï¼‰ç”¨å¦ä¸€ç¨®æ¡†ï¼šè·Ÿå‰µæ„æ‹¼åœ–åŒæ¬¾çš„ç™½è‰²è™›ç·šï¼Œ
         è€Œä¸”**ä¸ç•«**å››å€‹è§’çš„åœ“çƒ â€”â€” é‚£å…©ç¨®æœ¬ä¾†å°±æ˜¯å…©æŒ‡ç¸®æ”¾ï¼Œåœ“çƒåªæ˜¯æ“‹è·¯ã€‚
         åœ–ç‰‡ç¶­æŒåŽŸæœ¬çš„å¯¦ç·šæ¡†ï¼‹å››é¡†åœ“çƒï¼ˆè¦é å®ƒå€‘æ‹‰æ¯”ä¾‹ï¼‰ã€‚ */
      const isPhoto = !image.shape && image.text === undefined;
      const kNow = previewK;
      /* è™›ç·šæ¡†è¦çœŸçš„æŠŠåœ–å½¢ã€Œæ¡†ä½ã€ï¼šåœ–å½¢ç•«å‡ºä¾†çš„å¢¨æ°´å¸¸å¸¸é•·åœ¨å¤–æ¡†å¤–é¢ â€”â€”
         æ¡†ç·šæ˜¯é¨Žåœ¨è·¯å¾‘ä¸Šçš„ï¼ˆä¸€åŠåœ¨æ¡†å¤–ï¼‰ï¼Œå¤–æé‚Šå†å¾€å¤–ä¸€åœˆï¼Œ
         å€Ÿä¾†çš„åœ–æ¡ˆæ›´èª‡å¼µï¼ˆ`<333` çš„å¢¨æ°´æœ‰å¤–æ¡†çš„ 2.9 å€å¯¬ï¼‰ã€‚
         æ‰€ä»¥æ¡†è¦å¾€å¤–æŽ¨åˆ°å¢¨æ°´å¤–é¢ï¼Œå†ç•™ 2px çš„ç©ºéš™ï¼Œæ‰ä¸æœƒå£“åœ¨åœ–å½¢èº«ä¸Šã€‚
         æŽ¨çš„æ˜¯ã€Œçœ‹å¾—åˆ°çš„æ¡†ã€è€Œå·²ï¼Œç‰©ä»¶æœ¬èº«çš„å¤§å°ã€æ‹–æ›³çš„ç¯„åœéƒ½æ²’æœ‰è®Šã€‚ */
  const framePad = (() => {
        const sc = image.scale || 1;
        // èž¢å¹•ä¸Šå›ºå®šç•™ 2px çš„ç©ºéš™ï¼ˆé™¤æŽ‰é è¦½å€çŽ‡ï¼‰
        const gap = 2 / kNow;
        if (image.shape === 'hole') {
          /* å€Ÿä¾†çš„åœ–æ¡ˆï¼šæ‹¿ç•«é è¦½æ™‚åŒä¸€æ”¯ç®—ã€Œæœƒè¶…å‡ºå¤šå°‘ã€ï¼Œä½†æŠŠç™¼å…‰é—œæŽ‰ â€”â€”
             ç™¼å…‰æ˜¯æ•£é–‹çš„å…‰æšˆï¼Œæ¡†ä¸éœ€è¦é€£å…‰ä¸€èµ·æ¡†é€²åŽ»ã€‚ */
          const ov = holeOpts
            ? holeOverflow({ ...holeOpts, glow: 0 }, image.width, image.height, [])
            : { x: 0, y: 0 };
          return { x: ov.x * sc + gap, y: ov.y * sc + gap };
        }
        if (!image.shape || !shapeStroke) return { x: gap, y: gap };
        // shapeStroke æ˜¯ viewBox å–®ä½ï¼Œä¹˜å›ž scale æ‰æ˜¯å¤–æ¡†é‚£ä¸€å±¤çš„ px
        const lwPx = shapeStroke.lw * sc;
        const outPx = shapeStroke.outer * sc;
        const half = (image.shapeFilled && image.shape !== 'line') ? 0 : lwPx / 2;
        const pad = half + outPx + gap;
        return { x: pad, y: pad };
      })();
      const starTopGap = (image.shape === 'star' || (image.shape === 'hole' && image.holeType === 'cross-star'))
        ? 3 / kNow : 0;
      const frameInk = image.shape && image.shape !== 'hole'
        ? (SHAPE_FIT[image.shape] || [0, 0, 1, 1])
        : null;
      /* è·Ÿå‰µæ„æ‹¼åœ–çš„ objectSelectionInk å®Œå…¨ç›¸åŒï¼šä½¿ç”¨å…±ç”¨çš„ symInkã€å­—å·ã€
         æè¾¹å’Œå›ºå®š 2 ä¸ªå±å¹•åƒç´ ç•™ç™½ï¼Œä¸å†æ‹¿å‚¨å­˜ç”¨çš„ width/height å¤–ç›’åŠ æ¡†ã€‚ */
      const symbolFrame = image.sym ? (() => {
        const ink = measureSymbolStickerInk(
          image.text || image.sym!, (image.sym ? SYMBOL_FONT : (image.fontFamily || DEFAULT_FONT)),
        );
        const size = image.fontSize || 40;
        const sc = image.scale || 1;
        /* ä¸Ž CollageTool.objectSelectionInk é€é¡¹ç›¸åŒã€‚ç¬¦å·æœ¬ä½“ä¹Ÿå·²æ”¹å›žåŒä¸€æ”¯
           Canvas measureSymbolInk ç»˜åˆ¶ï¼Œå› æ­¤è¿™é‡Œä¸å†æ··å…¥ä»»ä½• SVG åº¦é‡ã€‚ */
        const inkW = ink.w * size * sc;
        const inkH = ink.h * size * sc;
        const edge = 2 / kNow + (image.strokeWidth || 0) * (size / 40) * sc;
        return {
          left: (boxW - inkW) / 2 - edge,
          top: (boxH - inkH) / 2 - edge,
          width: inkW + edge * 2,
          height: inkH + edge * 2,
        };
      })() : null;
      // ä¾çœŸæ­£æœ‰å¢¨æ°´çš„ç¯„åœç•«æ¡†ï¼Œå››å‘¨ç•™ç›¸åŒè·é›¢ï¼›æ˜Ÿå½¢é¡å¤–è·é›¢ä¹Ÿä¸Šä¸‹å°ç¨±ã€‚
      const frameRect = symbolFrame || (frameInk ? {
        left: boxW * frameInk[0] - framePad.x - starTopGap,
        top: boxH * frameInk[1] - framePad.y - starTopGap,
        width: boxW * frameInk[2] + framePad.x * 2 + starTopGap * 2,
        // ç·šæ¢é«˜åº¦ç‚º 0ï¼›å¤šè£œçš„ 1px åªæœƒé•·åœ¨æ¡†ä¸‹å´ï¼Œè¦–è¦ºä¸Šåè€Œä¸ç½®ä¸­ã€‚
        height: (image.shape === 'line' ? 0 : Math.max(1, boxH * frameInk[3])) + framePad.y * 2 + starTopGap * 2,
      } : {
        left: -framePad.x - starTopGap,
        top: -framePad.y - starTopGap,
        width: boxW + framePad.x * 2 + starTopGap * 2,
        height: boxH + framePad.y * 2 + starTopGap * 2,
      });
      /** ä¸€é¡†è§’çƒã€‚çœ‹å¾—è¦‹çš„ç™½é»žæ¯”è§¸æŽ§ç¯„åœå° 20%ï¼ˆ14 â†’ 11.2ï¼‰ï¼Œ
       *  å¤–é¢é‚£å±¤ç¶­æŒ 14Ã—14ã€è€Œä¸”äº‹ä»¶é‚„æ˜¯æŽ›åœ¨å®ƒèº«ä¸Šï¼Œæ‰€ä»¥æ‰‹æ„Ÿä¸€é»žéƒ½æ²’è®Šã€‚ */
      const cornerDot = (
        corner: 'tl' | 'tr' | 'bl' | 'br',
        pos: string, tx: string, cur: string,
      ) => (
        <div
          key={corner}
          className={`absolute ${pos} ${cur} z-50 pointer-events-auto touch-none`}
          style={{ width: 14 * previewInv, height: 14 * previewInv, transform: tx }}
          onPointerDown={(e) => handleScalePointerDown(e, corner)}
          onPointerMove={handleScalePointerMove}
          onPointerUp={handleScalePointerUp}
          onPointerCancel={handleScalePointerUp}
          title="ç¸®æ”¾"
        >
          <div
            className="absolute rounded-full bg-white"
            style={{
              left: 1.4 * previewInv, top: 1.4 * previewInv,
              right: 1.4 * previewInv, bottom: 1.4 * previewInv,
              boxShadow: `0 ${2 * previewInv}px ${5 * previewInv}px rgba(0,0,0,0.5)`,
            }}
          />
        </div>
      );
      /* é¸äº†å½¢ç‹€çš„ç…§ç‰‡ï¼šæ•´çµ„å¤–æ¡†ï¼ˆç™½æ¡†ï¼‹å››é¡†è§’çƒï¼‰ç¸®åˆ°å½¢ç‹€çœŸæ­£ä½”çš„é‚£ä¸€å¡Šã€‚
         å½¢ç‹€æ˜¯ã€ŒçŸ­é‚Šçš„æ­£æ–¹å½¢ã€æ“ºæ­£ä¸­å¤®ã€ï¼Œæ‰€ä»¥é€™å€‹æ¡†è·ŸåŽŸæœ¬çš„æ¡†æ˜¯**åŒå¿ƒ**çš„ â€”â€”
         è§’çƒç¸®æ”¾é‚£ä¸€å¥—æ˜¯ä»¥ä¸­å¿ƒèˆ‡åŠå¯¬åŠé«˜åœ¨ç®—çš„ï¼Œä¸­å¿ƒæ²’è®Šã€åªæœ‰åŠå¯¬åŠé«˜è®Šå°ï¼Œ
         æ‰€ä»¥æ‹‰è§’è½çš„æ‰‹æ„Ÿèˆ‡çµæžœå®Œå…¨ä¸æœƒè·‘æŽ‰ï¼ˆè¦‹ handleScalePointerDownï¼‰ã€‚ */
      const chromeBox = (() => {
        if (!isPhoto || !isImgShaped((image as any).imgShape)) return null;
        const b = imgShapeBox(image.width, image.height);
        return {
          left: `${r3((b.x / image.width) * 100)}%`,
          top: `${r3((b.y / image.height) * 100)}%`,
          width: `${r3((b.s / image.width) * 100)}%`,
          height: `${r3((b.s / image.height) * 100)}%`,
        };
      })();
      /* é€²åˆ°ã€Œé¸ä¸­å½¢ç‹€ã€ï¼šæ–¹æ¡†èˆ‡å››é¡†è§’çƒéƒ½æ”¶èµ·ä¾†ï¼Œæ”¹æˆæ²¿è‘—å½¢ç‹€æä¸€åœˆã€‚
         é‚£å€‹æ­£æ–¹å½¢è·Ÿåœ–ç‰‡æ¡†åŒå¿ƒï¼Œæ‰€ä»¥ç›´æŽ¥ç•«åœ¨ chromeBox é€™ä¸€æ ¼è£¡å°±å°é½Šäº†ã€‚ */
      const shapeOutline = shapeSelected && isImgShaped((image as any).imgShape) ? (() => {
        /* chromeBox å·²ç¶“æŠŠé€™ä¸€å±¤ç¸®åˆ°ã€Œå½¢ç‹€é‚£å€‹æ­£æ–¹å½¢ã€äº†ï¼Œæ‰€ä»¥ viewBox å°±ç”¨ b.sï¼Œ
           è·¯å¾‘å†ç…§ imgShapeXform å¹³ç§»éŽåŽ» â€”â€” è·Ÿç•«åœ¨ç•«å¸ƒä¸Šçš„é‚£ä¸€ä»½å®Œå…¨å°é½Šã€‚ */
        const t = imgShapeXform((image as any).imgShape, image.width, image.height);
        const d = shapePathD((image as any).imgShape, t.S, t.S);
        return (
          <svg
            className="absolute inset-0 pointer-events-none z-30"
            viewBox={`${r3(t.b.x - t.tx)} ${r3(t.b.y - t.ty)} ${r3(t.b.s)} ${r3(t.b.s)}`}
            preserveAspectRatio="none"
            style={{ overflow: 'visible', filter: `drop-shadow(0 0 ${2 * previewInv}px rgba(0,0,0,0.28))` }}
            aria-hidden
          >
            <path
              d={d} fill="none" stroke="#ffffff"
              /* ç·šå¯¬èˆ‡è™›ç·šç¯€å¥è·Ÿå‰µæ„æ‹¼åœ–é‚£æ¢ä¸€è‡´ï¼›é™¤æŽ‰é è¦½å€çŽ‡èˆ‡ç‰©ä»¶ç¸®æ”¾ï¼Œ
                 æ”¾å¤§ä¹‹å¾Œç·šæ‰ä¸æœƒè·Ÿè‘—è®Šç²—ã€‚viewBox çš„å–®ä½ï¼æœªç¸®æ”¾çš„å…§å®¹å–®ä½ã€‚ */
              strokeWidth={r3(1.05 / (kNow * (image.scale || 1)))}
              vectorEffect="none"
            />
          </svg>
        );
      })() : null;
      return (
      <div
        className={chromeBox ? 'absolute pointer-events-none' : 'absolute inset-0 pointer-events-none'}
        style={{
          ...(chromeBox || null),
          visibility: showChrome ? 'visible' : 'hidden',
          opacity: showChrome ? 1 : 0,
          transform: 'translateZ(0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      >
        {shapeOutline ? shapeOutline : isPhoto ? (
          /* Active border matching layout styleï¼ˆæ·±è‰²é‚£ä¸€åœˆæ˜¯å¾€å¤–ç•«çš„ï¼Œè·ŸåŽŸæœ¬ä¸€æ¨£ï¼‰ */
          <div
            className="absolute pointer-events-none z-30 border-solid border-white/95"
            style={{
              inset: -previewInv,
              borderWidth: 0.75 * previewInv,
              boxShadow: `0 0 ${4 * previewInv}px rgba(0,0,0,0.3)`,
            }}
          />
        ) : (
          /* è™›ç·šæ¡†ï¼šæ•¸å€¼è·Ÿå‰µæ„æ‹¼åœ–é‚£æ¢ strokeRect ä¸€æ¨¡ä¸€æ¨£ï¼ˆ1.6px å¯¬ã€6.7/6.7 çš„ç¯€å¥ï¼‰ã€‚
             é™¤æŽ‰é è¦½çš„å€çŽ‡ k â€”â€” æ”¾å¤§é è¦½æ™‚æ¡†ä¸æœƒè·Ÿè‘—è®Šç²—ï¼Œè·Ÿé‚£é‚Šçš„ uiPx åŒä¸€å€‹é“ç†ã€‚
             ç·šæ˜¯ç•«åœ¨é‚Šç•Œä¸Šçš„ï¼ˆä¸€åŠé•·åœ¨å¤–é¢ï¼‰ï¼Œæ‰€ä»¥è¦ overflow: visibleã€‚ */
          <svg
            data-classic-selection-frame={image.id}
            className="absolute pointer-events-none z-30"
            style={{
              left: frameRect.left, top: frameRect.top,
              width: frameRect.width, height: frameRect.height,
              overflow: 'visible',
              filter: `drop-shadow(0 0 ${2 * previewInv}px rgba(0,0,0,0.28))`,
            }}
            aria-hidden
          >
            <rect
              x="0" y="0" width="100%" height="100%"
              fill="none" stroke="#ffffff"
              strokeWidth={r3((image.sym ? 0.5 : image.shape === 'line' ? 0.55 : image.shape ? 1.05 : 0.75) / kNow)}
            />
          </svg>
        )}

        {/* Four Corner scale dotsï¼ˆåªæœ‰åœ–ç‰‡æ‰æœ‰ï¼›é¸ä¸­å½¢ç‹€æ™‚æ•´çµ„æ”¶èµ·ä¾†ï¼‰ */}
        {isPhoto && !shapeOutline && cornerDot('tl', 'top-0 left-0', 'translate(-50%, -50%)', 'cursor-nwse-resize')}
        {isPhoto && !shapeOutline && cornerDot('tr', 'top-0 right-0', 'translate(50%, -50%)', 'cursor-nesw-resize')}
        {isPhoto && !shapeOutline && cornerDot('bl', 'bottom-0 left-0', 'translate(-50%, 50%)', 'cursor-nesw-resize')}
        {isPhoto && !shapeOutline && cornerDot('br', 'bottom-0 right-0', 'translate(50%, 50%)', 'cursor-nwse-resize')}

        {((image.shape
          ? shapeSupportsStretch(image.shape, image.shapeFilled, image.holeType)
          : image.text === undefined || !image.sym)
          && !image.isVideo && !shapeOutline) && ([
          ['t', 'top-0 left-1/2', 'translate(-50%, -50%)', 'w-6 h-2 cursor-ns-resize'],
          ['r', 'right-0 top-1/2', 'translate(50%, -50%)', 'w-2 h-6 cursor-ew-resize'],
          ['b', 'bottom-0 left-1/2', 'translate(-50%, 50%)', 'w-6 h-2 cursor-ns-resize'],
          ['l', 'left-0 top-1/2', 'translate(-50%, -50%)', 'w-2 h-6 cursor-ew-resize'],
        ] as const).map(([side, pos, tx, size]) => {
          // åœ–å½¢çš„é¸å–æ¡†ä¾å¯è¦‹å¢¨æ°´ç¸®éŽï¼ŒæŽ§åˆ¶é»žä¹Ÿå¿…é ˆä½¿ç”¨åŒä¸€å€‹ frameRectï¼Œ
          // æ‰æœƒç¢ºå¯¦è½åœ¨å››é‚Šä¸­å¤®è€Œä¸æ˜¯åœåœ¨ç‰©ä»¶åŽŸå§‹æ–¹æ¡†ä¸Šã€‚
          const preciseHandle = !!image.shape || (image.text !== undefined && !image.sym);
          const shapeHandleStyle = preciseHandle ? {
            left: side === 'l' ? frameRect.left : side === 'r' ? frameRect.left + frameRect.width : frameRect.left + frameRect.width / 2,
            top: side === 't' ? frameRect.top : side === 'b' ? frameRect.top + frameRect.height : frameRect.top + frameRect.height / 2,
          } : undefined;
          // åœ–å½¢å››é‚Šå·²ç¶“ç›´æŽ¥çµ¦ã€Œæ¡†ç·šä¸Šçš„ä¸­å¿ƒåº§æ¨™ã€ï¼Œå››å€‹æ–¹å‘éƒ½åªéœ€æŠŠ
          // è§¸æŽ§ç›’è‡ªèº«çš„ä¸­å¿ƒæ¬å›žè©²åº§æ¨™ã€‚èˆŠçš„å³ï¼ä¸‹ +50% æ˜¯æ­é… right/bottom
          // å®šä½ä½¿ç”¨çš„ï¼Œç•™åœ¨ç²¾ç¢ºåº§æ¨™æ¨¡å¼æœƒå¤šæŽ¨å‡ºåŠå€‹è§¸æŽ§ç›’ã€‚
          const handleTransform = preciseHandle ? 'translate(-50%, -50%)' : tx;
          const horizontalHandle = side === 't' || side === 'b';
          return (
          <div key={side} data-stretch-handle className={`absolute ${preciseHandle ? '' : pos} z-50 pointer-events-auto touch-none flex items-center justify-center`}
            style={{
              width: (horizontalHandle ? 24 : 8) * previewInv,
              height: (horizontalHandle ? 8 : 24) * previewInv,
              transform: handleTransform,
              ...shapeHandleStyle,
            }} onPointerDown={(e) => handleStretchPointerDown(e, side)}
            onPointerMove={handleStretchPointerMove} onPointerUp={handleStretchPointerUp} onPointerCancel={handleStretchPointerUp}>
            {image.shape || (image.text !== undefined && !image.sym) ? (
              <span className="rounded-full block bg-white" style={{
                width: 5 * previewInv, height: 5 * previewInv,
                boxShadow: `0 ${previewInv}px ${3 * previewInv}px rgba(0,0,0,0.5)`,
              }} />
            ) : (
              <span className="block bg-white" style={{
                width: (horizontalHandle ? 16 : 4) * previewInv,
                height: (horizontalHandle ? 4 : 16) * previewInv,
                boxShadow: `0 ${2 * previewInv}px ${5 * previewInv}px rgba(0,0,0,0.5)`,
              }} />
            )}
          </div>
          );
        })}

      </div>
      );
    })()}
    </>
  );



  return (
    <>
    {isCanvasVector && pagesContainerRef.current && createPortal(
      <div
        data-vector-surface={image.id}
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          /* å¯è¦‹å‘é‡èˆ‡æœ¬é«”ï¼é¸ä¸­æ¡†å…±ç”¨å®Œå…¨ç›¸åŒçš„å¤–ç›’ã€‚èˆŠç‰ˆå¦å¤–å»ºç«‹ä¸€å€‹
             vectorSurfaceW å¤§ç›’å†ç”¨ translate3d æŽ¨åˆ°ç‰©ä»¶ä¸­å¿ƒï¼›WebKit åœ¨ native
             zoom ä¸‹ä¼šåˆ†åˆ«å–æ•´ absolute box å’Œ transform translationï¼Œè¿žç»­ç¼©æ”¾æ—¶
             ä¸¤ä¸ªå–æ•´ç›¸ä½ä¸åŒï¼Œç¬¦å·ä¾¿ä¼šç›¸å¯¹é¡µé¢å·¦å³ä¹±åŠ¨ã€‚çŽ°åœ¨åªä¿ç•™ä¸€å¥—
             left/top/width/heightï¼Œå†…éƒ¨çš„å¤§ SVG ä»ä»¥ä¸­å¿ƒå‘å¤–å»¶ä¼¸ï¼Œä¸ä¼šè¢«è£åˆ‡ã€‚ */
          left: wrapGeo.left,
          top: wrapGeo.top,
          width: `${boxW}px`,
          height: `${boxH}px`,
          zIndex: (dragShift?.live ? 1000 : 60) + stackIndex * 2,
          opacity: (image.text !== undefined && isTextEditing ? 0 : 1) * ((image.opacity ?? 100) / 100) * (motionFrame?.a ?? 1),
          transformOrigin: 'center center',
          transform: [
            dragShift ? `translate3d(${dragShift.tx}px, ${dragShift.ty}px, 0) scale(${dragShift.s})` : '',
            motionFrame ? `translate3d(${motionFrame.dx * boxW}px, ${motionFrame.dy * boxH}px, 0) scale(${motionFrame.k * (motionFrame.fx ?? 1)}, ${motionFrame.k}) rotate(${motionFrame.rot}deg)` : '',
          ].filter(Boolean).join(' ') || undefined,
          transition: dragShift
            ? (dragShift.live ? 'none' : 'transform 220ms cubic-bezier(0.2,0,0,1)')
            : undefined,
          /* åœ¨ç¬¬ä¸€æ¬¡æ‹–å‹•å‰å°±å»ºç«‹åˆæˆå±¤ï¼Œé¿å…é¦–å€‹ pointermove æ‰ä¸Šå‚³
             åœ–ç‰‡ï¼ç¬¦è™Ÿè²¼åœ–åˆ° GPU è€Œæ¼æŽ‰ä¸€å¹€ã€‚ */
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      >
        {image.text !== undefined && !image.sym && !usesUnitMotion ? (() => {
          /* å›ºå®šå­—ç´šã€å­—è·èˆ‡å­—å½¢åº¦é‡ï¼Œåªè®“ SVG çš„é€£çºŒçŸ©é™£è² è²¬ç¸®æ”¾ã€‚SVG æœƒåœ¨
             ç•¶ä¸‹é¡¯ç¤ºå€çŽ‡ç›´æŽ¥é‡å»ºå‘é‡è¼ªå»“ï¼Œä¸åƒç¨ç«‹ Canvas å…ˆè®Šé»žé™£å†è¢«é é¢
             zoom ä¸€æ¬¡ï¼›æ–‡å­—å’Œè¤‡åˆ Unicode ç¬¦è™Ÿå› æ­¤å…±ç”¨åŒä¸€å€‹ç©©å®šä¸­å¿ƒã€‚ */
          const family = (image.sym ? SYMBOL_FONT : (image.fontFamily || DEFAULT_FONT));
          const size = image.fontSize || 40;
          const lines = (image.text || '').split('\n');
          const lineH = size * 1.12;
          const startY = -((lines.length - 1) * lineH) / 2;
          const dx = vectorGlyphCorrection.x;
          const dy = vectorGlyphCorrection.y;
          const glowId = `vector-text-glow-${String(image.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          const glowUnit = Math.min(12, image.glow || 0) / 20 * 14;
          return (
            <svg
              data-vector-text={image.id}
              viewBox={`0 0 ${vectorCssW} ${vectorCssH}`}
              preserveAspectRatio="none"
              style={{
                position: 'absolute', left: '50%', top: '50%',
                width: `${vectorCssW}px`, height: `${vectorCssH}px`,
                transform: 'translate3d(-50%, -50%, 0)',
                overflow: 'visible', pointerEvents: 'none',
              }}
              aria-hidden
            >
              {image.glow ? (
                <defs>
                  <filter id={glowId} x={-vectorCssW} y={-vectorCssH}
                    width={vectorCssW * 3} height={vectorCssH * 3}
                    filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                    <feGaussianBlur in="SourceAlpha" stdDeviation={glowUnit} result="blur1" />
                    <feGaussianBlur in="SourceAlpha" stdDeviation={glowUnit * 2} result="blur2" />
                    <feGaussianBlur in="SourceAlpha" stdDeviation={glowUnit * 3} result="blur3" />
                    <feFlood floodColor={image.glowColor || '#FFFFFF'} result="glowColor" />
                    <feComposite in="glowColor" in2="blur1" operator="in" result="glow1" />
                    <feComposite in="glowColor" in2="blur2" operator="in" result="glow2" />
                    <feComposite in="glowColor" in2="blur3" operator="in" result="glow3" />
                    <feMerge>
                      <feMergeNode in="glow3" /><feMergeNode in="glow2" />
                      <feMergeNode in="glow1" /><feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
              ) : null}
              <g transform={`translate(${vectorCssW / 2} ${vectorCssH / 2}) rotate(${image.rotation}) scale(${image.scale * (image.width / Math.max(1, image.textStretchBaseW || image.width))} ${image.scale * (image.height / Math.max(1, image.textStretchBaseH || image.height))})`}>
                <text
                  ref={vectorGlyphRef}
                  data-vector-glyph={image.id}
                  x={dx}
                  y={startY + dy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily={fontStack(family)}
                  fontSize={size}
                  fontWeight={image.bold ? 700 : 400}
                  fontStyle={image.italic ? 'italic' : 'normal'}
                  letterSpacing={image.letterSpacing || 0}
                  fill={image.color || '#FFFFFF'}
                  stroke={image.strokeWidth ? (image.strokeColor || '#000000') : 'none'}
                  strokeWidth={image.strokeWidth ? image.strokeWidth * 2 : 0}
                  paintOrder="stroke fill"
                  filter={image.glow ? `url(#${glowId})` : undefined}
                  style={{ textRendering: 'geometricPrecision' }}
                >
                  {image.sym || lines.length === 1
                    ? image.text
                    : lines.map((line, i) => (
                        <tspan key={i} x={dx} y={startY + i * lineH + dy}>{line || ' '}</tspan>
                      ))}
                </text>
              </g>
            </svg>
          );
        })() : (
          <canvas
            ref={vectorCanvasRef}
            data-vector-canvas={image.id}
            style={{
              position: 'absolute', left: '50%', top: '50%',
              width: `${vectorCssW}px`,
              height: `${vectorCssH}px`,
              transform: 'translate3d(-50%, -50%, 0)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>,
      pagesContainerRef.current,
    )}
    <div
      ref={imageRef}
      data-floating-id={image.id}
      className="floating-image-wrapper group/floating"
      style={{
        ...wrapGeo,
        // è¦ç–Šåœ¨é¸å–æ™‚å‡ºç¾çš„é€æ˜Žæ‹–æ›³å±¤ï¼ˆz-40ï¼‰ä¹‹ä¸Šï¼Œç›´æŽ¥ç¢°åœ–ç‰‡æ‰æ‹–å¾—å‹•
        // ä¸€èˆ¬åœ–ç‰‡ç”¨å¶æ•¸å±¤ï¼Œä½ˆå±€ç”¨å¥‡æ•¸å±¤ï¼Œå…©è€…æ‰èƒ½äº’ç›¸ç©¿æ’
        // è¢«æ‹–çš„é‚£ä¸€é æ•´çµ„ï¼ˆé é¢ 900ã€ä¸Šé¢çš„æ±è¥¿ 1000+ï¼‰è¦è“‹éŽå…¶ä»–é 
        zIndex: (dragShift?.live ? 1000 : 60) + stackIndex * 2,
        touchAction: touchMode,
        opacity: (isCanvasVector ? 1 : (image.opacity ?? 100) / 100) * (motionFrame?.a ?? 1),
        /* åœ–ç‰‡åŒæ¨£é å…ˆå»ºç«‹ç§»å‹•ç”¨åˆæˆå±¤ï¼›ç¬¬ä¸€æ¬¡æ‹–å‹•ä¸å†è‡¨æ™‚å‡å±¤ã€‚ */
        willChange: 'transform',
        backfaceVisibility: 'hidden',
      }}
      onTouchStart={motionPickOnly ? undefined : onSwapTouchStart}
      onTouchMove={motionPickOnly ? undefined : onSwapTouchMove}
      onTouchEnd={motionPickOnly ? undefined : onSwapTouchEnd}
      onTouchCancel={motionPickOnly ? undefined : onSwapTouchEnd}
    >
      {isCanvasVector && image.shape ? null : image.shape === 'hole' ? (
        /* å¾žã€Œåœ–æ¡ˆã€å€ŸéŽä¾†çš„é‚£å¹¾é¡†ï¼šå®ƒå€‘ä¸æ˜¯ SVG è·¯å¾‘ï¼ˆæœ‰çš„æ˜¯ç³»çµ±å­—åž‹çš„å­—ã€
           æœ‰çš„æ˜¯åŽ»èƒŒ PNGï¼‰ï¼Œæ‰€ä»¥é è¦½ç›´æŽ¥ç•«åœ¨ canvas ä¸Šã€ç”¨çš„å°±æ˜¯åŒ¯å‡ºé‚£ä¸€æ”¯
           drawHoleShape â€”â€” é è¦½è·Ÿæˆå“æ˜¯åŒä¸€æ®µç¨‹å¼ç¢¼ç•«çš„ï¼Œä¸å¯èƒ½å°ä¸èµ·ä¾†ã€‚
           ç•«å¸ƒé–‹ dpr å€å†ç”¨ CSS ç¸®å›žåŽ»ï¼Œæ”¾å¤§æ™‚é‚Šç·£æ‰ä¸æœƒç³Šã€‚ */
        <canvas
          ref={el => {
            if (!el) return;
            // åªåœ¨è·¨éŽæ•´æ•¸å€çŽ‡æ™‚æé«˜ backing storeï¼Œå…¼é¡§æ¸…æ™°åº¦èˆ‡é€£çºŒç¸®æ”¾æ•ˆèƒ½ã€‚
            const dpr = Math.min(8, (window.devicePixelRatio || 1) * Math.max(1, canvasK()));
            // å¤–æ¡†ç¾åœ¨ç›´æŽ¥ä½¿ç”¨æ”¾å¤§å¾Œçš„å¯¦éš›å°ºå¯¸ï¼›backing store ä¹Ÿè·Ÿè‘—ä½¿ç”¨åŒä¸€å°ºå¯¸ï¼Œ
            // ä¸å†æŠŠä¸€å¼µè¼ƒå°çš„é»žé™£ canvas äº¤çµ¦ CSS æ‹‰å¤§ã€‚
            const bw = Math.max(1, boxW * dpr);
            const bh = Math.max(1, boxH * dpr);
            const blurs = shapeGlowBlurs(bw, bh);
            /* äº¤çµ¦ drawHoleShape çš„æ˜¯ç•«å¸ƒåƒç´ ï¼Œç·šå¯¬çš„å–®ä½ä¹Ÿè¦æ›åˆ°åŒä¸€å€‹åº§æ¨™ç³»
               ï¼ˆholeOpts è£¡é‚£å€‹æ˜¯å…§å®¹å–®ä½ï¼Œå…©é‚Šéƒ½æ˜¯ã€Œé•·é‚Š/160 å†é™¤æŽ‰ scaleã€ï¼‰ã€‚ */
            const opts = { ...holeOpts!, lineUnit: Math.max(bw, bh) / 160 / renderScale };
            /* ç•«å¸ƒè¦æ¯”å¤–æ¡†å¤§ä¸€åœˆï¼šå¥½å¹¾ç¨®åœ–æ¡ˆçš„å¢¨æ°´æœ¬ä¾†å°±æ¯”æ¡†å¤§
               ï¼ˆ`<333` æœ‰ 2.9 å€å¯¬ï¼‰ï¼Œæé‚Šèˆ‡ç™¼å…‰ä¹Ÿé•·åœ¨æ¡†å¤–é¢ â€”â€”
               ç•«å¸ƒåªé–‹å¤–æ¡†é‚£éº¼å¤§çš„è©±ï¼Œè¶…å‡ºåŽ»çš„å…¨éƒ¨è¢«åˆ‡æŽ‰ã€‚
               æ’é–‹çš„æ˜¯ç•«å¸ƒï¼Œç•«çš„å…§å®¹ä¸€å€‹åƒç´ éƒ½æ²’å‹•ï¼ˆåŽŸé»žé‚„æ˜¯æ¡†å¿ƒã€
               äº¤çµ¦ drawHoleShape çš„é‚„æ˜¯åŽŸæœ¬çš„å¤–æ¡†ï¼‰ã€‚ */
            const w = Math.max(1, Math.round(bw + holeOv.x * (boxW / Math.max(1, image.width)) * dpr * 2));
            const h = Math.max(1, Math.round(bh + holeOv.y * (boxH / Math.max(1, image.height)) * dpr * 2));
            if (el.width !== w) el.width = w;
            if (el.height !== h) el.height = h;
            const c = el.getContext('2d');
            if (!c) return;
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.clearRect(0, 0, w, h);
            c.translate(w / 2, h / 2);
            drawHoleShape(c, opts, bw, bh, blurs);
          }}
          key={`${image.holeType}|${image.color}|${image.shapeFilled}|${image.shapeLineW}|${image.shapeGlow}|${image.shapeGlowColor}|${image.shapeStrokeW}|${image.shapeStrokeColor}|${image.shapeDots}|${image.shapeDotSize}|${image.shapeDotGap}|${image.shapeDotColor}|${image.shapeTex}|${image.shapeStripeN}|${image.shapeStripeDir}|${image.shapeStripeA}|${image.shapeStripeB}|${Math.round(image.width)}|${Math.round(image.height)}`}
          style={{
            /* ç”¨ç™¾åˆ†æ¯”è€Œä¸æ˜¯ pxï¼šå¤–æ¡†çš„å¯¬é«˜æœƒè¢«å¸åˆ°æ•´æ•¸å¯¦é«”åƒç´ ï¼ˆè¦‹ wrapGeoï¼‰ï¼Œ
               ç™¾åˆ†æ¯”æ‰æœƒè·Ÿè‘—ä¸€èµ·å¸ï¼Œç•«å¸ƒçš„ä¸­å¿ƒæ‰ä¸æœƒè·Ÿå¤–æ¡†çš„ä¸­å¿ƒå·®åŠå€‹åƒç´ ã€‚ */
            position: 'absolute',
            left: `${-holeOv.x / image.width * 100}%`,
            top: `${-holeOv.y / image.height * 100}%`,
            width: `${(1 + 2 * holeOv.x / image.width) * 100}%`,
            height: `${(1 + 2 * holeOv.y / image.height) * 100}%`,
            pointerEvents: 'none',
            visibility: 'hidden',
          }}
        />
      ) : image.shape ? (
        /* åœ–å½¢åœ–å±¤ã€‚é è¦½æ˜¯ SVGã€åŒ¯å‡ºæ˜¯ Path2Dï¼Œåƒçš„æ˜¯åŒä¸€æ¢ d å­—ä¸²ã€‚
           viewBox ç”¨ã€Œæ²’æœ‰ç¸®æ”¾å‰ã€çš„å°ºå¯¸ï¼Œå¤–æ¡†æ˜¯ widthÃ—scale â€”â€”
           å…©è»¸çš„å€çŽ‡ä¸€æ¨£ï¼Œæ‰€ä»¥æé‚Šæ˜¯ç­‰æ¯”ä¾‹æ”¾å¤§ã€ä¸æœƒè¢«æ‹‰æ‰ã€‚
           overflow: visible æ˜¯å› ç‚ºæé‚Šæœ‰ä¸€åŠé•·åœ¨æ¡†å¤–é¢ï¼Œä¸æ”¾è¡Œå°±æœƒè¢«åˆ‡æŽ‰ã€‚ */
        <svg
          viewBox={`0 0 ${image.width} ${image.height}`}
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            /* SVG æ¯ä¸€å¹€ç›´æŽ¥æŒ‰ç›®å‰é¡¯ç¤ºå°ºå¯¸é‡ç•«å‘é‡è¼ªå»“ï¼Œä¸ç¸®æ”¾èˆŠçš„é»žé™£å¿«å–ï¼›
               æ‰€ä»¥æ‰‹æŒ‡é‚„æ²’æ”¾é–‹æ™‚ä¹Ÿå’Œæœ€çµ‚ç•«é¢ä¸€æ¨£æ¸…æ¥šã€‚ */
            left: 0, top: 0, width: '100%', height: '100%',
            transform: undefined,
            transformOrigin: 'center center',
            overflow: 'visible', pointerEvents: 'none',
            /* ç™¼å…‰ï¼šä¸‰æ®µ drop-shadow ç–Šèµ·ä¾†ï¼Œè·Ÿæ–‡å­—ï¼åœ–ç‰‡çš„å…‰åŒä¸€å¥—æ¿ƒæ·¡ã€‚
               åŠå¾‘å¯«åœ¨ã€Œæ²’æœ‰ç¸®æ”¾å‰ã€çš„åº§æ¨™ç³»ä¸Šï¼Œå¤–æ¡†æ”¾å¤§æ™‚å…‰æœƒè·Ÿè‘—ä¸€èµ·æ”¾å¤§ã€‚ */
            filter: glowAmount(image.shapeGlow as any) > 0
              ? shapeGlowBlurs(image.width, image.height)
                  .map(r => `drop-shadow(0 0 ${r3(r * image.scale * glowAmount(image.shapeGlow as any))}px ${image.shapeGlowColor || image.color || SHAPE_DEFAULT_COLOR})`)
                  .join(' ')
              : undefined,
            /* æœ‰ç™¼å…‰æ™‚æŠŠé€™ä¸€å±¤æŽ¨ä¸Šè‡ªå·±çš„åˆæˆå±¤ã€‚
               drop-shadow çš„å…‰æœƒé•·åˆ°åœ–å½¢æ¡†å¤–é¢ï¼Œè€Œ WebKit åœ¨å…ƒç´ è¢«æ‹–å‹•ï¼ç¸®æ”¾æ™‚
               åªæœƒé‡ç•«ã€Œæ¡†ä»¥å…§ã€é‚£ä¸€å¡Š â€”â€” æ¡†å¤–é‚£åœˆå…‰å°±ç•™åœ¨åŽŸåœ°è®Šæˆæ®˜å½±
               ï¼ˆæ‹–ä¸€æ¬¡ç•™ä¸€é“ï¼Œçœ‹èµ·ä¾†åƒä¸€è·¯æ‹‰å‡ºä¾†çš„å½±å­ï¼‰ã€‚
               è‡ªå·±ä¸€å±¤ä¹‹å¾Œæ•´å±¤ä¸€èµ·é‡ç•«ï¼Œå°±ä¸æœƒæœ‰æ®˜ç•™ã€‚ */
            willChange: glowAmount(image.shapeGlow as any) > 0 ? 'filter' : undefined,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            isolation: 'isolate',
            visibility: 'hidden',
          }}
        >
          {/* é»žé»žï¼šç”¨ä¸€å¡Š pattern ç–Šåœ¨åœ–å½¢ä¸Šï¼Œç¯„åœå°±æ˜¯åœ–å½¢çš„å¡«è‰²å€åŸŸ â€”â€”
              è·ŸåŒ¯å‡ºé‚£é‚Šã€Œå‰ªè£åœ¨åœ–å½¢è£¡é¢å†é‹ªé»žé»žã€æ˜¯åŒä¸€å¡Šå€åŸŸã€‚
              tile æ˜¯äº¤éŒ¯ä¸‰è§’æ ¼çš„ä¸€å€‹é€±æœŸï¼ˆå¯¬ dxã€é«˜ 2dyï¼Œè£¡é¢å…©é¡†ï¼‰ï¼Œ
              patternTransform æŠŠ tile çš„åŽŸé»žç§»åˆ°åœ–å½¢æ­£ä¸­å¿ƒï¼Œæ‰€ä»¥æ­£ä¸­å¤®
              ä¸€å®šæœ‰ä¸€é¡†é»ž â€”â€” é€™æ¨£æ‰è·Ÿ canvas é‚£é‚Šé€é¡†å°å¾—èµ·ä¾†ã€‚
              å››å€‹è§’ä¸Šçš„é»žè¦å„è£œä¸€é¡†ï¼Œä¸ç„¶æœƒè¢« tile çš„é‚Šç•Œåˆ‡æŽ‰ã€‚ */}
          {/* å¤–æé‚Šï¼šç•«åœ¨æœ¬é«”ã€Œåº•ä¸‹ã€ã€å¯¬åº¦åŠ å€ â€”â€” æœ¬é«”æœƒè“‹ä½å…§åŠé‚Šï¼Œ
              ç•™åœ¨å¤–é¢çš„å°±æ˜¯ä¹¾æ·¨çš„ä¸€åœˆå¤–æé‚Šï¼ˆè·Ÿæ–‡å­—çš„æé‚ŠåŒä¸€ç¨®åšæ³•ï¼‰ã€‚
              è™›ç·šåªå±¬æ–¼æœ¬é«”ï¼Œæé‚Šé‚£ä¸€åœˆä¸€å¾‹æ˜¯å¯¦ç·šã€‚ */}
          {!!image.shapeStrokeW && (
            <path
              d={shapePathD(
                image.shape, image.width, image.height,
                image.shapeTextureBaseW || image.width,
                image.shapeTextureBaseH || image.height,
                ((image.shapeLineBase || Math.max(image.width, image.height)) / 160) * 2.325
                  / Math.pow(Math.max(0.01, renderScale), 0.65),
              )}
              fill="none"
              stroke={image.shapeStrokeColor || '#000000'}
              strokeWidth={((image.shapeFilled && image.shape !== 'line') ? 0 : (shapeStroke?.lw || 0))
                + (shapeStroke?.outer || 0) * 2}
              strokeLinejoin="round"
              strokeLinecap="butt"
            />
          )}
          <path
            d={shapePathD(
                image.shape, image.width, image.height,
                image.shapeTextureBaseW || image.width,
                image.shapeTextureBaseH || image.height,
                ((image.shapeLineBase || Math.max(image.width, image.height)) / 160) * 2.325
                  / Math.pow(Math.max(0.01, renderScale), 0.65),
              )}
            fill={image.shapeFilled && image.shape !== 'line' ? (image.color || SHAPE_DEFAULT_COLOR) : 'none'}
            stroke={image.shapeFilled && image.shape !== 'line' ? 'none' : (image.color || SHAPE_DEFAULT_COLOR)}
            strokeWidth={shapeStroke?.lw}
            strokeDasharray={shapeStroke?.dashArray}
            strokeLinecap={shapeStroke?.cap}
            strokeLinejoin={shapeStroke?.join}
          />
          {/* é»žé»žï¼šç–Šåœ¨åœ–å½¢ä¸Šé¢çš„ä¸€å¡Š patternï¼Œç¯„åœå°±æ˜¯åœ–å½¢çš„å¡«è‰²å€åŸŸ â€”â€”
              è·ŸåŒ¯å‡ºé‚£é‚Šã€Œå‰ªè£åœ¨åœ–å½¢è£¡é¢å†é‹ªé»žé»žã€æ˜¯åŒä¸€å¡Šå€åŸŸã€‚
              tile æ˜¯äº¤éŒ¯ä¸‰è§’æ ¼çš„ä¸€å€‹é€±æœŸï¼ˆå¯¬ dxã€é«˜ 2dyï¼Œè£¡é¢å…©é¡†ï¼‰ï¼Œ
              patternTransform æŠŠ tile çš„åŽŸé»žç§»åˆ°åœ–å½¢æ­£ä¸­å¿ƒï¼Œæ‰€ä»¥æ­£ä¸­å¤®
              ä¸€å®šæœ‰ä¸€é¡†é»ž â€”â€” é€™æ¨£æ‰è·Ÿ canvas é‚£é‚Šé€é¡†å°å¾—èµ·ä¾†ã€‚
              å››å€‹è§’ä¸Šçš„é»žè¦å„è£œä¸€é¡†ï¼Œä¸ç„¶æœƒè¢« tile çš„é‚Šç•Œåˆ‡æŽ‰ã€‚ */}
          {isGridTex(texOf({ tex: image.shapeTex, dots: image.shapeDots })) && (() => {
            const tex = texOf({ tex: image.shapeTex, dots: image.shapeDots }) as 'dot' | 'star' | 'heart';
            const baseW = image.shapeTextureBaseW || image.width;
            const baseH = image.shapeTextureBaseH || image.height;
            const { r, dx, dy, color } = shapeDotGrid(baseW, baseH, image);
            const id = `sgrid-${tex}-${image.id}`;
            const glyphs: [number, number][] = [[0, 0], [dx, 0], [0, dy * 2], [dx, dy * 2], [dx / 2, dy]];
            return (
              <>
                <defs>
                  <pattern
                    id={id} patternUnits="userSpaceOnUse"
                    width={r3(dx)} height={r3(dy * 2)}
                    patternTransform={`translate(${r3(image.width / 2)} ${r3(image.height / 2)})`}
                  >
                    {glyphs.map(([cx, cy], i) => tex === 'dot'
                      ? <circle key={i} cx={r3(cx)} cy={r3(cy)} r={r3(r)} fill={color} />
                      : <g key={i} transform={`translate(${r3(cx)} ${r3(cy)})`}>
                          <path d={textureGlyphD(tex, 0, 0, r)} fill={color} />
                        </g>)}
                  </pattern>
                </defs>
                <path
                  d={shapePathD(
                image.shape, image.width, image.height,
                image.shapeTextureBaseW || image.width,
                image.shapeTextureBaseH || image.height,
                ((image.shapeLineBase || Math.max(image.width, image.height)) / 160) * 2.325
                  / Math.pow(Math.max(0.01, renderScale), 0.65),
              )}
                  fill={`url(#${id})`}
                  stroke="none"
                />
              </>
            );
          })()}
          {/* æ¢ç´‹ï¼šä¸€æ¨£æ˜¯ç–Šåœ¨åœ–å½¢å¡«è‰²å€ä¸Šçš„ patternã€‚
              ä¸€å€‹é€±æœŸæ˜¯ã€Œå…©æ¢ã€ï¼ˆå„ä¸€å€‹é¡è‰²ï¼‰ï¼ŒpatternTransform æŠŠåŽŸé»žç§»åˆ°
              åœ–å½¢æ­£ä¸­å¿ƒ â€”â€” è·Ÿ canvas é‚£æ”¯ paintStripes çš„èµ·ç®—é»žä¸€è‡´ï¼Œ
              æ‰€ä»¥é è¦½è·ŸåŒ¯å‡ºå‡ºä¾†çš„æ¢ç´‹ä½ç½®å®Œå…¨å°å¾—ä¸Šã€‚ */}
          {texOf({ tex: image.shapeTex, dots: image.shapeDots }) === 'stripe' && (() => {
            const vert = image.shapeStripeDir !== 'h';   // é è¨­ç›´å¼
            const span = vert ? image.width : image.height;
            /* æ¢æ•¸å°±æ˜¯æ»‘æ¡¿çš„å€¼ â€”â€” è·Ÿ canvas é‚£æ”¯ paintStripes åŒä¸€æ”¯ stripeBandï¼Œ
               æ‰€ä»¥é è¦½è·ŸåŒ¯å‡ºçš„æ¢æ•¸èˆ‡å¯¬åº¦å®Œå…¨ä¸€æ¨£ï¼Œé ­å°¾ä¹Ÿéƒ½æ˜¯å®Œæ•´çš„ä¸€æ¢ã€‚ */
            const { band } = stripeBand(span, image.shapeStripeN ?? STRIPE_N_DEFAULT);
            const a = image.shapeStripeA || image.color || SHAPE_DEFAULT_COLOR;
            const b = image.shapeStripeB || '#FFFFFF';
            const id = `sstripe-${image.id}`;
            return (
              <>
                <defs>
                  <pattern
                    id={id} patternUnits="userSpaceOnUse"
                    width={r3(vert ? band * 2 : band)} height={r3(vert ? band : band * 2)}
                  >
                    <rect x="0" y="0" width={r3(band)} height={r3(band)} fill={a} />
                    <rect
                      x={r3(vert ? band : 0)} y={r3(vert ? 0 : band)}
                      width={r3(band)} height={r3(band)}
                      fill={b} />
                  </pattern>
                </defs>
                <path
                  d={shapePathD(
                image.shape, image.width, image.height,
                image.shapeTextureBaseW || image.width,
                image.shapeTextureBaseH || image.height,
                ((image.shapeLineBase || Math.max(image.width, image.height)) / 160) * 2.325
                  / Math.pow(Math.max(0.01, renderScale), 0.65),
              )}
                  fill={`url(#${id})`}
                  stroke="none"
                />
              </>
            );
          })()}
        </svg>
      ) : image.sym ? null : image.text !== undefined ? (
        <div
          ref={textRef}
          style={{
            /* â”€â”€ ç¸®æ”¾æ™‚çš„ä¸Šä¸‹æŠ–å‹•ï¼šè·Ÿå‰µæ„æ‹¼åœ–ç”¨åŒä¸€å¥—åšæ³• â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
               å‰µæ„æ‹¼åœ–çš„æ–‡å­—æ˜¯ç•«åœ¨ canvas ä¸Šçš„ï¼šå­—ç´šç›´æŽ¥ä¹˜ä¸Šå€çŽ‡
               ï¼ˆctx.font = size Ã— sï¼‰ã€textBaseline = 'middle'ã€ç•«åœ¨ (0,0)ã€‚
               é—œéµæ˜¯ canvas çš„å­—å½¢åº¦é‡æ˜¯ã€Œé€£çºŒçš„æµ®é»žæ•¸ã€ï¼Œå­—å°±æ°¸é å°ç¨±æŽ›åœ¨
               ä¸­å¿ƒé»žä¸Šï¼Œå€çŽ‡å†æ€Žéº¼è®Šéƒ½ä¸æœƒè·³ã€‚

               DOM é€™é‚Šåšä¸åˆ°åŒä¸€ä»¶äº‹ï¼šå­—ç´šä¸€è®Šï¼Œç€è¦½å™¨å°±è¦é‡æŽ’ä¸€æ¬¡è¡Œç›’ï¼Œè€Œ
               ascentï¼descent æ˜¯ã€Œæ¯å€‹å­—ç´šå„è‡ªå–æ•´ã€å‡ºä¾†çš„ï¼Œè¡Œç›’é«˜åº¦å»æ˜¯
               å­—ç´š Ã— 1.12 é€£çºŒè®ŠåŒ– â€”â€” å…©è€…ç›¸æ¸›å‡ºä¾†çš„åŠè¡Œè·ï¼ˆhalf-leadingï¼‰
               å°±æ˜¯ä¸€æ¢é‹¸é½’ï¼Œå­—å› æ­¤ä¸€è·¯å¾€ä¸‹çˆ¬ã€ç„¶å¾Œå½ˆå›žåŽ»ã€‚ä¸Šä¸€ç‰ˆæŠŠé€™ä¸€å±¤æ”¹æŽ›
               åœ¨æ¡†å¿ƒï¼Œåªè§£æŽ‰äº†ã€Œæ¡†ã€é‚£ä¸€åŠï¼Œå­—å½¢åº¦é‡å–æ•´é€™ä¸€åŠé‚„åœ¨ã€‚

               æ‰€ä»¥æ”¹æˆè·Ÿ canvas å®Œå…¨åŒæ§‹çš„åšæ³•ï¼šé€™ä¸€å±¤æ°¸é ç”¨ã€Œä¸€å€å¤§ã€çš„å­—ç´š
               æŽ’ç‰ˆï¼ˆåº¦é‡å¾žé ­åˆ°å°¾åªç®—ä¸€æ¬¡ã€ä¸æœƒé‡æ–°å–æ•´ï¼‰ï¼Œç¸®æ”¾äº¤çµ¦ transform
               çš„ scale åŽ»åš â€”â€” ç­‰åŒ canvas é€£çºŒç¸®æ”¾å­—å½¢è¼ªå»“ã€‚
               å­—ç´šã€å­—è·ã€æé‚Šã€ç™¼å…‰åœ¨é€™è£¡ä¸€å¾‹ç”¨åŽŸå€¼ï¼Œå€çŽ‡çµ±ä¸€ç”± scale å¸¶ã€‚ */
            position: 'absolute', left: '50%', top: '50%',
            transform: isTextEditing ? `translate3d(-50%, -50%, 0) scale(${textRenderScale})` : 'none',
            transformOrigin: 'center center',
            /* ç¸®æ”¾æ™‚çš„æ®˜å½±ï¼šé€™ä¸€å±¤åªæœ‰ transform åœ¨è®Šï¼Œå¯æ˜¯å®ƒè£¡é¢æ˜¯**æ–‡å­—**
               ï¼ˆé‚„å¯èƒ½å¸¶ text-shadow çš„ç™¼å…‰ï¼‰ï¼Œç€è¦½å™¨æŠŠå®ƒç•¶ä¸€èˆ¬å…§å®¹é‡ç•«æ™‚ï¼Œ
               ä¸Šä¸€æ ¼ç•«éŽçš„åœ°æ–¹ä¸ä¸€å®šæœƒè¢«æ¸…ä¹¾æ·¨ â€”â€” åœ¨æ‰‹æ©Ÿä¸Šçœ‹èµ·ä¾†å°±æ˜¯ä¸€è·¯
               ç•™ä¸‹ä¸€ä¸²æ„ˆä¾†æ„ˆå°çš„æ®˜å½±ã€‚æŠŠå®ƒå‡æˆè‡ªå·±çš„åˆæˆå±¤ï¼ˆtranslateZ ï¼‹
               will-changeï¼‰ï¼Œç¸®æ”¾å°±åªæ˜¯ã€ŒæŠŠåŒä¸€å¼µè²¼åœ–æ‹‰å¤§ç¸®å°ã€ï¼Œ
               ä¸æœƒå†æœ‰æ²’æ¸…æŽ‰çš„èˆŠåƒç´ ã€‚ */
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            // å…§å®¹ç›’ã€å­—ç´šå’Œå­—è·æ°¸é ç¶­æŒä¸€å€ï¼›åªè®Šä¸Šé¢çš„ transformï¼Œç€è¦½å™¨ä¾¿ä¸æœƒ
            // æ¯ä¸€å¹€é‡æ–°è¨ˆç®—å­—é«” ascent/descentï¼Œæ–‡å­—èˆ‡ç¬¦è™Ÿä¸­å¿ƒä¹Ÿä¸æœƒè·³å‹•ã€‚
            width: `${image.width * (isTextEditing ? textMetricScale : 1)}px`, height: `${image.height * (isTextEditing ? textMetricScale : 1)}px`,
            pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: fontStack(image.fontFamily),
            fontSize: `${(image.fontSize || 40) * (isTextEditing ? textMetricScale : 1)}px`,
            lineHeight: 1.12,
            fontWeight: image.bold ? 700 : 400,
            fontStyle: image.italic ? 'italic' : 'normal',
            // å€çŽ‡ç”±å¤–å±¤çš„ scale å¸¶ï¼Œé€™è£¡ä¸€å¾‹ç”¨åŽŸå€¼ï¼ˆè¦‹ä¸Šé¢çš„èªªæ˜Žï¼‰
            letterSpacing: `${(image.letterSpacing || 0) * (isTextEditing ? textMetricScale : 1)}px`,
            color: image.color || '#FFFFFF',
            // åªæœ‰ä½¿ç”¨è€…è‡ªå·±æŒ‰çš„æ›è¡Œæ‰æ›è¡Œï¼Œä¸è‡ªå‹•æ–·è¡Œ
            whiteSpace: 'pre',
            wordBreak: 'normal',
            overflowWrap: 'normal',
            textAlign: 'center',
            // æé‚Šï¼šåªæå­—çš„å¤–åœè¼ªå»“ã€‚-webkit-text-stroke æ˜¯æ²¿è‘—è¼ªå»“ä¸­ç·šæï¼Œ
            // ä¸€åŠæœƒåƒé€²å­—èº«ï¼Œçœ‹èµ·ä¾†åƒæ¯ä¸€ç­†éƒ½è¢«æäº†ä¸€åœˆã€‚æ”¹æˆ paint-order
            // æŠŠæé‚Šç•«åœ¨å¡«è‰²ã€Œä¸‹é¢ã€ã€å¯¬åº¦åŠ å€ â€”â€” å­—èº«è“‹ä½å…§åŠé‚Šï¼Œ
            // å‰©ä¸‹çš„å°±æ˜¯ç´”å¤–æé‚Šã€‚
            WebkitTextStrokeWidth: image.strokeWidth ? `${image.strokeWidth * 2 * (isTextEditing ? textMetricScale : 1)}px` : undefined,
            WebkitTextStrokeColor: image.strokeWidth ? (image.strokeColor || '#000000') : undefined,
            // æ²’æœ‰æé‚Šæ™‚ä¸è¦ç•™è‘— paint-orderã€‚
            paintOrder: image.strokeWidth ? 'stroke fill' : undefined,
            /* ç™¼å…‰ä¸ç•«åœ¨é€™ä¸€å±¤ã€‚text-shadow çš„è¼ªå»“æ˜¯ã€Œå¡«è‰²ï¼‹æé‚Šã€åˆèµ·ä¾†çš„å½¢ç‹€ï¼Œ
               æ‰€ä»¥ä¸€æ—¦åŠ äº†æé‚Šï¼Œå…‰å°±æ²¿è‘—æé‚Šçš„å¤–ç·£æ•£é–‹ â€”â€” çœ‹èµ·ä¾†å°±æ˜¯æé‚Šçªç„¶
               è®Šç²—ä¸€å¤§åœˆã€‚åŒ¯å‡ºé‚£é‚Šæ˜¯ã€Œå…ˆç”¨å¡«è‰²çš„å½¢ç‹€ç•«å…‰ã€å†ç•«æé‚Šã€æœ€å¾Œå¡«è‰²ã€ï¼Œ
               å…©é‚Šå°ä¸èµ·ä¾†ã€‚æ”¹æˆä¸‹é¢å¦å¤–ç–Šä¸€å±¤åªæœ‰å…‰çš„æ–‡å­—ï¼Œè·ŸåŒ¯å‡ºåŒä¸€å¥—é †åºã€‚ */
            textShadow: 'none',
            boxSizing: 'border-box',
            /* éžç·¨è¼¯ç‹€æ…‹ç”±ä¸Šé¢çš„ Canvas é¡¯ç¤ºï¼›é€™å±¤åªä¿ç•™é‡æ¸¬èˆ‡ textareaã€‚ */
            opacity: isTextEditing ? 1 : 0,
          }}
        >
          {/* ç™¼å…‰å±¤ï¼šç–Šåœ¨ä¸»å±¤åº•ä¸‹ï¼Œåªè² è²¬ç™¼å…‰ã€‚ç™¼å…‰è·Ÿæé‚Šæ˜¯å…©ä»¶ç¨ç«‹çš„äº‹ â€”â€”
              é€™ä¸€å±¤æŠŠæé‚Šæ˜Žç¢ºæ­¸é›¶ï¼ˆ-webkit-text-stroke æœƒå¾žå¤–å±¤ç¹¼æ‰¿ä¸‹ä¾†ï¼Œ
              ä¸æ­¸é›¶çš„è©±é€™ä¸€å±¤ä¹Ÿæœƒè¢«æåˆ°ï¼‰ï¼Œæ‰€ä»¥å…‰æ°¸é åªå¾žã€Œå­—èº«æœ¬ä¾†çš„è¼ªå»“ã€
              æ•£å‡ºåŽ»ï¼Œæé‚Šç²—ç´°å®Œå…¨ä¸åƒèˆ‡è¨ˆç®—ï¼šåªèª¿ç™¼å…‰è·ŸåŒæ™‚é–‹æé‚Šï¼Œçœ‹åˆ°çš„
              å…‰ä¸€æ¨¡ä¸€æ¨£ã€‚

              ç”¨ text-shadowã€è€Œä¸”åªç”¨ã€Œä¸€å±¤ã€ï¼Œæ˜¯åˆ»æ„çš„ï¼š
              â‘  text-shadow æ˜¯æ–‡å­—å¢¨è·¡çš„ä¸€éƒ¨åˆ†ï¼Œä¸æœƒå»ºç«‹åˆæˆå±¤ã€ä¸æœƒæœ‰
                 filter çš„æ¿¾é¡å€åŸŸï¼Œæ‰€ä»¥ä¸æœƒåœ¨å…‰æšˆå¤–åœè¢«è£å‡ºä¸€æ¢ç¡¬é‚Šï¼›
              â‘¡ ç–Šå¤šå±¤æœƒè®“å­—ç·£çš„æŠ—é‹¸é½’åƒç´ é‡è¤‡åˆæˆï¼ˆ0.5 ç–Šä¸‰æ¬¡è®Š 0.875ï¼‰ï¼Œ
                 åœ¨æŸ”å’Œçš„å…‰æšˆä¸Šå°±æµ®å‡ºä¸€åœˆæ˜Žé¡¯çš„åˆ†å‰²ç·šã€‚
              ä¸‰æ®µæ¨¡ç³ŠåŠå¾‘å¯«åœ¨åŒä¸€å€‹ text-shadow è£¡ï¼Œæ¿ƒåº¦è·ŸåŽŸæœ¬ä¸€æ¨£ï¼Œ
              ä½†æ•´å±¤åªç•«ä¸€æ¬¡ï¼Œé‚Šç·£ä¹¾æ·¨ã€‚ */}
          {!!image.glow && (
            <span
              aria-hidden
              style={{
                position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transform: image.sym ? `translate(${renderedSymbolShift.x}px, ${renderedSymbolShift.y}px)` : undefined,
                pointerEvents: 'none', whiteSpace: 'pre', textAlign: 'center',
                color: image.color || '#FFFFFF',
                // é€™ä¸€å±¤çµ•å°ä¸æé‚Šï¼Œå…‰æ‰ä¸æœƒç®—åˆ°æé‚Šçš„éƒ¨åˆ†
                WebkitTextStrokeWidth: 0,
                paintOrder: 'normal',
                textShadow: [1, 2, 3]
                  .map(k => `0 0 ${(image.glow! / 20) * 14 * k * textMetricScale}px ${image.glowColor || '#FFFFFF'}`)
                  .join(', '),
                // è·Ÿåœ–å½¢çš„ç™¼å…‰åŒä¸€å€‹ç†ç”±ï¼šå…‰é•·åœ¨æ¡†å¤–é¢ï¼Œä¸è‡ªå·±ä¸€å±¤å°±æœƒæ‹–å‡ºæ®˜å½±
                willChange: 'transform',
                visibility: isTextEditing ? 'hidden' : undefined,
              }}
            >
              {image.text}
            </span>
          )}

          <span
            ref={textInnerRef}
            style={{
              display: 'inline-block',
              // ä¸»å±¤è¦è“‹åœ¨ç™¼å…‰å±¤ä¸Šé¢
              position: 'relative', zIndex: 1,
              transform: image.sym ? `translate(${renderedSymbolShift.x}px, ${renderedSymbolShift.y}px)` : undefined,
              // width: max-content æ‰èƒ½ä¸å—å¤–æ¡†å¯¬åº¦é™åˆ¶åœ°é‡åˆ°çœŸæ­£éœ€è¦çš„å¯¬åº¦ï¼Œ
              // å¦å‰‡æ¡†è¢«ç¸®åˆ°ä¸Šä¸€æ¬¡çš„å¯¬åº¦ä¹‹å¾Œï¼Œæ–‡å­—å°±æœƒä¸€ç›´å¡åœ¨é‚£å€‹å¯¬åº¦æ›è¡Œ
              width: 'max-content',
              // å¤–å±¤æ˜¯ flexï¼Œä¸æ“‹ä½æ”¶ç¸®çš„è©±é€™å€‹ span æœƒè¢«å£“å›žå¤–æ¡†å¯¬åº¦è€Œææ—©æ›è¡Œ
              flexShrink: 0,
              // ä¸è¨­å¯¬åº¦ä¸Šé™ï¼šæ–‡å­—åªåœ¨ä½¿ç”¨è€…è‡ªå·±æ›è¡Œçš„åœ°æ–¹æ–·ï¼Œ
              // æœ‰ä¸Šé™çš„è©± pre æœƒç›´æŽ¥è¢«è£æŽ‰è€Œä¸æ˜¯æ›è¡Œã€‚
              whiteSpace: 'pre',
              // æ‰“å­—æ™‚å­—é‚„æ˜¯ç”±é€™å€‹ span æ’å‡ºç‰ˆé¢ï¼ˆæ¡†æ‰æœƒè·Ÿè‘—é•·ï¼‰ï¼Œ
              // åªæ˜¯è®“ä½çµ¦ä¸Šé¢é‚£å±¤çœŸæ­£åœ¨æ”¶éµç›¤è¼¸å…¥çš„ textarea
              visibility: isTextEditing ? 'hidden' : undefined,
            }}
          >
            {image.text}
          </span>

          {/* é‡æ¸¬å°ˆç”¨ï¼šæ°¸é  1 å€å¤§ã€ä¸åƒèˆ‡ç‰ˆé¢ï¼Œæ¡†çš„å¯¬é«˜åªçœ‹å®ƒ */}
          <span
            ref={textMeasureRef}
            aria-hidden
            style={{
              position: 'absolute', left: 0, top: 0,
              visibility: 'hidden', pointerEvents: 'none',
              display: 'inline-block', width: 'max-content',
              whiteSpace: 'pre', wordBreak: 'normal', overflowWrap: 'normal',
              fontFamily: fontStack(image.fontFamily),
              fontSize: `${image.fontSize || 40}px`,
              fontWeight: image.bold ? 700 : 400,
              fontStyle: image.italic ? 'italic' : 'normal',
              letterSpacing: `${image.letterSpacing || 0}px`,
              lineHeight: 1.12,
            }}
          >
            {/* å…§å®¹æ˜¯ç©ºçš„ï¼ˆå‰›é»žé€²åŽ»æ‰“å­—ã€é è¨­å­—è¢«æ¸…æŽ‰ï¼‰å°±æ‹¿é è¨­é‚£å››å€‹å­—ä¾†é‡ï¼Œ
                æ¡†æ‰æœƒç¶­æŒåŽŸæœ¬çš„å¤§å°ï¼Œç­‰çœŸçš„æ‰“äº†å­—å†ç…§æ‰“çš„å…§å®¹é‡ã€‚
                ç¬¦è™Ÿå‰‡æ˜¯æ‹¿è‡ªå·±é‚£é¡†ä¾†é‡ã€‚ */}
            {image.text === '' ? (image.sym || TEXT_PLACEHOLDER) : image.text}
          </span>

          {/* ç›´æŽ¥åœ¨ç•«å¸ƒä¸Šæ‰“å­—ï¼šç–Šä¸€å±¤ä¸€æ¨¡ä¸€æ¨£æŽ’ç‰ˆçš„ textareaï¼Œ
              åŽŸç”Ÿéµç›¤èˆ‡æ¸¸æ¨™éƒ½äº¤çµ¦å®ƒï¼Œå…§å®¹ä»ç„¶å³æ™‚å¯«å›žåœ–å±¤ */}
          {isTextEditing && (
            <textarea
              ref={textAreaRef}
              value={image.text}
              // é—œæŽ‰è»Ÿæ›è¡Œï¼Œæ‰“å­—æ™‚çœ‹åˆ°çš„æ–·è¡Œæ‰è·Ÿæ”¶å·¥å¾Œä¸€æ¨£
              wrap="off"
              onChange={e => onChange({ text: e.target.value })}
              onBlur={e => {
                /* å‰›æ‰“é–‹çš„é‚£ä¸€çž¬é–“è¢«æ¶èµ°ç„¦é»žçš„ï¼Œæ˜¯åŒä¸€ä¸‹æ‰‹å‹¢è£œé€çš„æ»‘é¼ äº‹ä»¶ï¼Œ
                   ä¸æ˜¯ä½¿ç”¨è€…çœŸçš„é»žåŽ»åˆ¥çš„åœ°æ–¹ â€”â€” æŠŠç„¦é»žæ¶å›žä¾†å°±å¥½ã€‚ */
                if (performance.now() - textOpenAt.current < 500) {
                  const el = e.currentTarget;
                  requestAnimationFrame(() => { try { el.focus({ preventScroll: true }); } catch {} });
                  return;
                }
                onTextEditEnd?.();
              }}
              onPointerDown={e => e.stopPropagation()}
              // å–®æŒ‡æ˜¯åœ¨ç·¨è¼¯æ–‡å­—ï¼Œä¸è¦è¢«ç•«å¸ƒæ¶èµ°ï¼›å…©æŒ‡å‰‡è®“ç•«å¸ƒæŽ¥æ‰‹ï¼Œ
              // é€™æ¨£æ‰“å­—ä¸­ä¹Ÿé‚„èƒ½ç›´æŽ¥ç¸®æ”¾ï¼æ—‹è½‰
              onTouchStart={e => { if (e.touches.length < 2) e.stopPropagation(); }}
              onTouchMove={e => { if (e.touches.length < 2) e.stopPropagation(); }}
              style={{
                position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
                margin: 0, padding: 0, border: 'none', outline: 'none', resize: 'none',
                background: 'transparent', overflow: 'hidden', pointerEvents: 'auto',
                font: 'inherit', fontFamily: 'inherit', fontSize: 'inherit',
                fontWeight: 'inherit', letterSpacing: 'inherit', lineHeight: 'inherit',
                color: 'inherit', textAlign: 'center', whiteSpace: 'pre',
                caretColor: image.color || '#FFFFFF',
                zIndex: 45,
              }}
            />
          )}
        </div>
      ) : needsShapeCanvas ? (
        // åœ“è§’ï¼ç¾½åŒ–ï¼ç™¼å…‰éƒ½ç•«åœ¨ canvas ä¸Šã€‚ç”¨ CSS é®ç½©çš„è©±æ¯å‹•ä¸€æ ¼æ»‘æ¡¿å°±è¦
        // é‡æ–°è§£ç¢¼ä¸€å¼µé®ç½©åœ–ï¼Œç•«é¢æœƒä¸€é–ƒä¸€é–ƒï¼›canvas æ˜¯åŒä¸€æ ¼ç•«å®Œæ‰é€å‡ºï¼Œä¸æœƒé–ƒã€‚
        // ç™¼å…‰ä¹Ÿæ‰èƒ½è·Ÿæ–‡å­—ä¸€æ¨£ã€ŒåŒä¸€å€‹ä¾†æºç–Šä¸‰å±¤ã€ï¼Œè€Œä¸æ˜¯ä¸€å±¤é™°å½±å†å¥—ä¸€å±¤ã€‚
        <canvas
          ref={shapeCanvasRef}
          style={{
            position: 'absolute',
            left: `${-glowPad}px`,
            top: `${-glowPad}px`,
            /* ç‰ˆé¢å°ºå¯¸è¦å°é½Šå¯¦é«”åƒç´ æ ¼ç·šã€‚
               å…§éƒ¨ç•«å¸ƒæ˜¯ round((boxW+2pad)Ã—dpr) å€‹åƒç´ ï¼Œä½† CSS é€™è£¡æœ¬ä¾†å¯«çš„æ˜¯
               æ²’æœ‰æ¨å…¥çš„æµ®é»žå¯¬é«˜ â€”â€” å…©è€…å°ä¸ä¸Šæ™‚ç€è¦½å™¨æœƒç”¨éžæ•´æ•¸å€çŽ‡é‡å–æ¨£ï¼Œ
               æœ€å¤–é¢é‚£ä¸€åˆ—å°±è·Ÿå¤–é¢çš„é€æ˜Žæ··åœ¨ä¸€èµ·ï¼Œç¸®æ”¾çš„éŽç¨‹ä¸­æ²¿è·¯ç•™ä¸‹ä¸€æ¢
               å¿½éš±å¿½ç¾çš„ç´°ç·šã€‚æ”¹æˆç”¨ã€ŒåŒä¸€å€‹æ¨å…¥çµæžœ Ã· dprã€ï¼Œå€çŽ‡å‰›å¥½æ˜¯ 1:1ã€‚ */
            width: `${snapPx(boxW + glowPad * 2)}px`,
            height: `${snapPx(boxH + glowPad * 2)}px`,
            pointerEvents: 'none',
          }}
        />
      ) : plainImageWave ? (
        <canvas
          ref={waveImageCanvasRef}
          data-classic-wave-canvas={image.id}
          style={{
            position: 'absolute', left: 0, top: `${-waveImagePad}px`,
            width: '100%', height: `${boxH + waveImagePad * 2}px`,
            pointerEvents: 'none',
          }}
        />
      ) : image.isVideo ? (
        /* å½±ç‰‡ä¸€å¾‹èµ°é€™ä¸€å±¤ã€‚
           æ²’å¥—æ¿¾é¡æ™‚å®ƒå°±æ˜¯åŽŸæœ¬é‚£å€‹ <video>ï¼ˆåŽŸç”Ÿè§£æžåº¦ã€å®Œå…¨ä¸ä½”ä¸»åŸ·è¡Œç·’ï¼Œ
           é€™æ¢è·¯æœ¬ä¾†å°±æ²’å•é¡Œï¼‰ï¼›å¥—äº†æ¿¾é¡å°±å¤šæŽ›ä¸€å¼µ GPU ç•«å¸ƒè“‹åœ¨ä¸Šé¢ï¼Œ
           **ç‰ˆé¢èˆ‡è®Šæ›å…©è€…å…±ç”¨åŒä¸€ä»½**ï¼Œæ‰€ä»¥å¥—ä¸å¥—æ¿¾é¡éƒ½ä¸æœƒè·‘ä½ã€‚ */
        <VideoLayer
          image={image}
          boxW={boxW}
          boxH={boxH}
          videoRef={glVideoRef}
          onReady={() => setVidReady(true)}
          hidden={glLive}
          glCanvas={videoWantsGl ? glCanvas : null}
          paused={videoPaused}
        />
      ) : (
        <img
          src={image.src}
          alt="floating-item"
          style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
        />
      )}

      {/* æ‹–æ›³ä¾†æºèˆ‡æ‹–æ”¾ç›®æ¨™éƒ½åªæ˜¯è®Šæš—ï¼Œä¸ç”¨åŠé€æ˜Žä¹Ÿä¸åŠ ç™½æ¡†ã€‚
          è®Šæš—çš„é‚£ä¸€å¡Šè¦è·Ÿåœ–å±¤ç¾åœ¨çš„å½¢ç‹€ä¸€æ¨£ â€”â€” åœ“è§’ã€ç¾½åŒ–ã€æ„›å¿ƒã€æ˜Ÿæ˜Ÿâ€¦
          éƒ½è·Ÿè‘—èµ°ï¼ˆä»¥å‰ä¸ç®¡å½¢ç‹€æ€Žéº¼æ”¹ï¼Œæš—ä¸‹åŽ»çš„æ°¸é æ˜¯ä¸€å€‹æ–¹å¡Šï¼‰ã€‚
          ç”¨çš„æ˜¯è·Ÿå½±ç‰‡åœ–å±¤åŒä¸€æ”¯ shapePartsï¼Œæ‰€ä»¥å…©é‚Šä¸å¯èƒ½é•·å¾—ä¸ä¸€æ¨£ã€‚ */}
      {(isSwapTarget || isSwapSource) && (
        <div
          data-dim-overlay="1"
          className="absolute inset-0 pointer-events-none z-40"
          style={{
            backgroundColor: isSwapTarget ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.3)',
            borderRadius: dimShape.cssRadius,
            ...(dimShape.maskUrl ? {
              WebkitMaskImage: `url(${dimShape.maskUrl})`, maskImage: `url(${dimShape.maskUrl})`,
              WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
              WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
            } : null),
          }}
        />
      )}

      {motionTargetFlash && (
        <div
          key={`motion-flash-${image.id}-${motionTargetFlash}`}
          data-motion-target-flash={image.id}
          className="absolute pointer-events-none"
          style={{
            inset: `${-4 / previewK}px`,
            border: `${1 / previewK}px dashed rgba(255,255,255,.95)`,
            borderRadius: `${4 / previewK}px`,
            animation: 'classic-motion-target-flash 850ms ease-out both',
            zIndex: 100,
          }}
        />
      )}
      
      <div
        className={`absolute inset-0 ${motionPickOnly ? 'cursor-pointer' : 'cursor-move'}`}
        onPointerDown={motionPickOnly ? (e) => { e.stopPropagation(); onSelect(); } : handleBodyPointerDown}
        onPointerMove={motionPickOnly ? undefined : handleBodyPointerMove}
        onPointerUp={motionPickOnly ? undefined : handleBodyPointerUp}
        onPointerCancel={motionPickOnly ? undefined : handleBodyPointerUp}
      />

      {/* æ‹¿ä¸åˆ°å¤–æ¡†å±¤æ™‚å°±ç…§åŽŸæœ¬çš„æ–¹å¼æŽ›åœ¨è‡ªå·±èº«ä¸Šï¼Œè¡Œç‚ºå®Œå…¨ä¸è®Š */}
      {!chromeLayer && !image.shape && chrome}
    </div>

      {chromeLayer && createPortal(
        <div
          data-floating-id={image.id}
          className="floating-image-chrome"
          style={{
            ...chromeWrapGeo,
            /* é€™ä¸€å±¤åªæ˜¯å¤–æ¡†çš„å®¹å™¨ï¼Œæœ¬èº«ä¸æŽ¥æ‰‹å‹¢ï¼š
               åªæœ‰åœ“çƒèˆ‡å·¥å…·åˆ—è‡ªå·±é–‹ pointer-eventsï¼Œå…¶é¤˜ä¸€å¾‹ç©¿é€ä¸‹åŽ»ï¼Œ
               é»žåœ¨æ¡†è£¡é¢æ™‚ä»ç„¶æ˜¯æ‰“åˆ°åº•ä¸‹é‚£å€‹ç‰©ä»¶ï¼ˆæ‹–æ›³æ‰‹æ„Ÿå®Œå…¨ä¸è®Šï¼‰ã€‚ */
            pointerEvents: 'none',
            /* å¤–æ¡†æ°¸é ç•«åœ¨æœ€ä¸Šé¢ã€‚é é¢å®¹å™¨æ²’æœ‰è‡ªæˆå †ç–Šç’°å¢ƒï¼ˆposition: relativeã€
               z-index: autoï¼‰ï¼Œæ‰€ä»¥è£¡é¢é‚£äº› 60ï½ž1000+ çš„åœ–å±¤æ˜¯è·Ÿé€™ä¸€å±¤å¹³èµ·å¹³ååœ°
               æ¯”å¤§å°çš„ â€”â€” è¦å£“éŽå®ƒå€‘å°±å¾—æ¯”æœ€å¤§çš„é‚£å€‹é‚„é«˜ã€‚ */
            zIndex: 100000 + stackIndex * 2,
          }}
        >
          {chrome}
        </div>,
        chromeLayer,
      )}
    </>
  );
};

interface GridLayoutToolProps {
  /** å¾žæ­·å²ç´€éŒ„é»žé–‹ä¾†çš„é‚£ä¸€ç­†çš„ keyã€‚å†è¨˜ä¸€æ¬¡çš„æ™‚å€™æ²¿ç”¨å®ƒï¼æ›´æ–°åŒä¸€ç­† */
  histKey?: string | null;
  onHome: () => void;
  onRequestExit?: () => Promise<ExitChoice>;
  onImportNew?: () => void;
  initialFiles?: File[];
  /** å¾žé¦–é çš„æ­·å²ç´€éŒ„é»žå›žä¾†æ™‚ï¼ŒæŠŠé‚£ä¸€ä»½ç‰ˆé¢é¤µå›žä¾†ï¼ˆå„ªå…ˆæ–¼è‡ªå‹•å­˜æª”çš„è‰ç¨¿ï¼‰ */
  initialState?: any;
  /** æ¿¾é¡æ¸…å–®ï¼Œè·Ÿã€Œç·¨è¼¯ã€ç”¨çš„æ˜¯åŒä¸€ä»½ */
  lutList?: { id: string; name: string; url: string }[];
}

export const GridLayoutTool: React.FC<GridLayoutToolProps> = ({ histKey, onHome, onRequestExit, onImportNew, initialFiles, initialState, lutList = [] }) => {
  const openedFromDraftRef = useRef(!initialState && !(initialFiles && initialFiles.length) && hasDraft());
  /** ä¸€é ä¸Šå¯ä»¥æ”¾å¤šå€‹ä½ˆå±€ï¼Œæ¯å€‹ä½ˆå±€éƒ½æ˜¯ä¸€å€‹ç¨ç«‹ç‰©ä»¶ï¼ˆè·Ÿä¸€èˆ¬åœ–ç‰‡ä¸€æ¨£ï¼‰ã€‚ */
  interface LayoutItem {
    id: string;
    templateIndex: number;
    images: ImageCell[];
    /** ä½ˆå±€åœ¨é é¢ä¸Šçš„ä½ç§»èˆ‡ç¸®æ”¾ã€‚æ–°å¢žæ™‚é è¨­ä½”é é¢ä¸ƒåˆ†æ»¿ã€‚ */
    t: { x: number; y: number; scale: number; rot?: number };
    /** åœ–å±¤å †ç–Šä½ç½®ï¼š0 = åœ¨æ‰€æœ‰ä¸€èˆ¬åœ–ç‰‡ä¸‹æ–¹ï¼ŒN = åœ¨å…¨éƒ¨ä¸Šæ–¹ã€‚ */
    z: number;
    /** é€™å€‹ä½ˆå±€è‡ªå·±çš„é•·å¯¬æ¯”ï¼ˆ'3:4' ä¹‹é¡žï¼‰ã€‚æ²’è¨­å°±è·Ÿæ•´é ä¸€æ¨£ã€‚ */
    ratio?: string;
    /** é€™å€‹ä½ˆå±€è‡ªå·±çš„æ¯”ä¾‹æ˜¯ä¸æ˜¯æ©«éŽä¾† */
    landscape?: boolean;
    /** é–“è·èˆ‡åœ“è§’éƒ½æ˜¯å„ä½ˆå±€è‡ªå·±çš„è¨­å®šï¼Œèª¿æ•´ä¸æœƒå½±éŸ¿ä¹‹å¾Œæ–°å¢žçš„ä½ˆå±€ã€‚ */
    gap: number;
    radius: number;
  }

  interface PageConfig {
    id: string;
    bgColor: string;
    layouts: LayoutItem[];
    /** é€™ä¸€é çš„èƒŒæ™¯ç´‹ç†ã€‚æ²’è¨­éŽå°±æ˜¯ã€Œç„¡ã€ï¼Œæ‰€ä»¥èˆŠä½œå“è®€å›žä¾†ä¹Ÿä¸æœƒæœ‰æ±è¥¿å†’å‡ºä¾† */
    pattern?: PatternOpts;
    /** æ¯é è‡ªå·±çš„å‹•ç•«å¾ªç’°åœç•™ç§’æ•¸ã€‚ */
    motionHold?: number;
  }
  /** è®€æŸä¸€é çš„ç´‹ç†è¨­å®šï¼ˆæ²’è¨­éŽå°±çµ¦é è¨­å€¼ï¼‰ */
  const pagePattern = (p?: { pattern?: PatternOpts }): PatternOpts =>
    p?.pattern || { type: 'none', color: '#A8DDE6', size: 50, gap: 20 };

  const [pages, setPages] = useState<PageConfig[]>(() => [
    { id: 'page-1', bgColor: '#ffffff', layouts: [] }
  ]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [floatingImages, setFloatingImages] = useState<FloatingImage[]>([]);
  const [selectedFloatingId, setSelectedFloatingId] = useState<string | null>(null);
  const [brushStrokes, setBrushStrokes] = useState<ClassicBrushStroke[]>([]);
  const [selectedBrushId, setSelectedBrushId] = useState<string | null>(null);
  const [brushKind, setBrushKind] = useState<ClassicBrushKind>('normal');
  const [brushColor, setBrushColor] = useState('#FFFFFF');
  const [brushWidth, setBrushWidth] = useState(12);
  const [brushHardness, setBrushHardness] = useState(80);
  const [brushEraser, setBrushEraser] = useState(false);
  const [brushSizing, setBrushSizing] = useState(false);
  const brushLiveRef = useRef<{ pointerId: number; stroke: ClassicBrushStroke } | null>(null);
  const [motionPlaying, setMotionPlaying] = useState(true);
  const [motionTime, setMotionTime] = useState(0);
  const [motionRunSeq, setMotionRunSeq] = useState(0);
  const motionClockRef = useRef(0);
  const [motionTargetId, setMotionTargetId] = useState<string | null>(null);
  const [motionFlash, setMotionFlash] = useState<{ id: string; nonce: number } | null>(null);
  const motionFlashTimerRef = useRef<number | null>(null);
  /** æ‰‹æŒ‡æ­£åœ¨ç§»åŠ¨ä»»ä¸€å·²é€‰ç‰©ä»¶ï¼›æœŸé—´ç»Ÿä¸€éšè—é€‰ä¸­æ¡†ä¸Žç™½è‰²è¯ä¸¸ */
  const [selectionDragging, setSelectionDragging] = useState(false);
  /* iPhone çš„è§¸æŽ§äº‹ä»¶é »çŽ‡å¯èƒ½é«˜æ–¼èž¢å¹•æ›´æ–°çŽ‡ã€‚æŠŠåŒä¸€ç•«é¢å¹€å…§çš„ä¸­é–“ç‹€æ…‹å…¨éƒ¨
     ä¸Ÿæ£„ï¼Œåªæäº¤æœ€æ–°å¹¾ä½•ï¼Œé¿å… React ä¾åºç•«å‡ºå·²éŽæœŸå€çŽ‡é€ æˆç¸®æ”¾å¾€è¿”æŠ–å‹•ã€‚ */
  const interactionRafRef = useRef<number | null>(null);
  const interactionPendingRef = useRef<(() => void) | null>(null);
  const flushInteraction = useCallback(() => {
    interactionRafRef.current = null;
    const job = interactionPendingRef.current;
    interactionPendingRef.current = null;
    job?.();
  }, []);
  const queueInteraction = useCallback((job: () => void) => {
    interactionPendingRef.current = job;
    if (interactionRafRef.current == null) interactionRafRef.current = requestAnimationFrame(flushInteraction);
  }, [flushInteraction]);
  const flushInteractionNow = useCallback(() => {
    if (interactionRafRef.current != null) cancelAnimationFrame(interactionRafRef.current);
    flushInteraction();
  }, [flushInteraction]);
  useEffect(() => () => {
    if (interactionRafRef.current != null) cancelAnimationFrame(interactionRafRef.current);
  }, []);
  const [activeGuidelines, setActiveGuidelines] = useState<AlignmentGuideline[]>([]);
  const [enableSnapping, setEnableSnapping] = useState(true);
  /** ä¸Šæ–¹é‚£é¡†ä¸‰å€‹é»žçš„é¸å–® */
  const [moreOpen, setMoreOpen] = useState(false);
  /* ä¸‰å€‹é»žçš„é¸å–®ï¼šé»žç•«é¢ä¸Šä»»ä½•å…¶ä»–åœ°æ–¹éƒ½è¦æ”¶èµ·ä¾†ã€‚
     é¸å–®è‡ªå·±é‚£å¡Š fixed inset-0 çš„é®ç½©ä¸å¤ ç”¨ â€”â€” å®ƒè¢«é—œåœ¨é ‚æ¬„è£¡é¢ï¼Œè€Œé ‚æ¬„æœ‰
     backdrop-blurï¼Œå¸¶ backdrop-filter çš„ç¥–å…ˆæœƒè®Šæˆ fixed çš„ã€ŒåŒ…å«å¡Šã€ï¼Œ
     æ‰€ä»¥é‚£ç‰‡é®ç½©å…¶å¯¦åªè“‹ä½é ‚æ¬„é‚£ä¸€æ¢ï¼Œé»žç•«å¸ƒæ˜¯é»žä¸åˆ°å®ƒçš„ã€‚
     æ”¹æˆé–‹è‘—çš„æ™‚å€™åœ¨ document ä¸Šè½ä¸€æ¬¡æŒ‰ä¸‹ï¼šåªè¦ä¸æ˜¯æŒ‰åœ¨é¸å–®è‡ªå·±èº«ä¸Šå°±é—œæŽ‰
     ï¼ˆç”¨æ•ç²éšŽæ®µï¼Œä¸­é€”æœ‰äººæ“‹æŽ‰å†’æ³¡ä¹Ÿç…§æ¨£æ”¶å¾—èµ·ä¾†ï¼‰ã€‚ */
  const moreWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (ev: Event) => {
      const el = moreWrapRef.current;
      if (el && ev.target instanceof Node && el.contains(ev.target)) return;
      setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [moreOpen]);
  /** IG è²¼æ–‡é è¦½ */
  const [igPreview, setIgPreview] = useState(false);

  const workspacePointerDown = useRef<{ x: number, y: number, time: number, onBlank?: boolean, movesObject?: boolean } | null>(null);
  /** é€™å€‹ä½ç½®æ˜¯ç©ºç™½å—Žï¼ˆä¸æ˜¯åœ–å±¤ã€ä¸æ˜¯æ ¼å­ã€ä¹Ÿä¸æ˜¯ä½ˆå±€ï¼‰ */
  const isBlankTarget = (t: Element | null) =>
    !t || (!t.closest('[data-floating-id]') && !t.closest('[data-brush-id]') && !t.closest('[data-cell-id]') && !t.closest('[data-layout-wrapper]'));
  const globalFloatingTouchState = useRef<{
    startX: number;
    startY: number;
    startImgX: number;
    startImgY: number;
    startDist?: number;
    startScale?: number;
    isDragging: boolean;
    isPinching: boolean;
  } | null>(null);

  const getPageRect = (pageIdx: number) => {
    if (!pagesContainerRef.current) return null;
    const activePageEl = document.getElementById(pageIdx === 0 ? "grid-preview-container" : `grid-preview-container-${pageIdx}`);
    if (!activePageEl) {
      return {
        left: 0,
        right: previewW,
        top: 0,
        bottom: previewH,
        centerX: previewW / 2,
        centerY: previewH / 2,
        width: previewW,
        height: previewH,
      };
    }
    const containerRect = pagesContainerRef.current.getBoundingClientRect();
    const pageRect = activePageEl.getBoundingClientRect();

    /* getBoundingClientRect é‡åˆ°çš„æ˜¯ã€Œèž¢å¹•ä¸Šçš„å¤§å°ã€ï¼Œå·²ç¶“ä¹˜éŽç•«å¸ƒç¸®æ”¾å€çŽ‡ï¼›
       ä½†åœ–ç‰‡ã€æ–‡å­—çš„ xï¼yï¼å¯¬é«˜å…¨éƒ½æ˜¯ã€Œæœªç¸®æ”¾çš„å…§å®¹åº§æ¨™ã€ã€‚
       å…©é‚Šç›´æŽ¥æ··åœ¨ä¸€èµ·ç®—ï¼Œåªè¦ä½¿ç”¨è€…ç¸®æ”¾éŽç•«å¸ƒï¼Œå°é½Šç·šå°±æœƒè½åœ¨éŒ¯çš„ä½ç½®ã€
       å¸é™„ä¹Ÿæœƒå¸åˆ°éŒ¯çš„åœ°æ–¹ â€”â€” æ‰€ä»¥é€™è£¡å…ˆé™¤å›žå…§å®¹åº§æ¨™ã€‚ */
    const k = kRef.current || 1;
    const left = (pageRect.left - containerRect.left) / k;
    const top = (pageRect.top - containerRect.top) / k;
    const width = pageRect.width / k;
    const height = pageRect.height / k;
    
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      centerX: left + width / 2,
      centerY: top + height / 2,
      width,
      height,
    };
  };

  const getActivePageRect = () => getPageRect(activePageIndex);

  /** ç›´æŽ¥ä»¥æ­¤åˆ»èž¢å¹•ä¸­å¤®åˆ¤æ–·æœ€è¿‘é é¢ï¼Œä¸ä¾è³´ onScroll å°šæœªæäº¤çš„ stateã€‚ */
  const getClosestPageRect = () => {
    const viewport = containerRef.current?.getBoundingClientRect();
    if (!viewport) return getActivePageRect();
    const vx = viewport.left + viewport.width / 2;
    let best: ReturnType<typeof getPageRect> = null;
    let bestDistance = Infinity;
    pages.forEach((_, idx) => {
      const el = document.getElementById(idx === 0 ? 'grid-preview-container' : `grid-preview-container-${idx}`);
      const screen = el?.getBoundingClientRect();
      if (!screen) return;
      const d = Math.abs(screen.left + screen.width / 2 - vx);
      if (d < bestDistance) { bestDistance = d; best = getPageRect(idx); }
    });
    return best || getActivePageRect();
  };

  const getAllPageRects = () => {
    if (!pagesContainerRef.current) return [];
    const containerRect = pagesContainerRef.current.getBoundingClientRect();
    // åŒ getPageRectï¼šé‡åˆ°çš„æ˜¯èž¢å¹•å°ºå¯¸ï¼Œè¦é™¤å›žå…§å®¹åº§æ¨™æ‰èƒ½è·Ÿåœ–ç‰‡çš„ xï¼y æ¯”
    const k = kRef.current || 1;

    return pages.map((page, pageIdx) => {
      const pageEl = document.getElementById(pageIdx === 0 ? "grid-preview-container" : `grid-preview-container-${pageIdx}`);
      if (!pageEl) {
        const left = pageIdx * (previewW + 1);
        return {
          left,
          top: 0,
          right: left + previewW,
          bottom: previewH,
          centerX: left + previewW / 2,
          centerY: previewH / 2,
          width: previewW,
          height: previewH,
          pageIdx,
        };
      }
      const pageRect = pageEl.getBoundingClientRect();
      const left = (pageRect.left - containerRect.left) / k;
      const top = (pageRect.top - containerRect.top) / k;
      const width = pageRect.width / k;
      const height = pageRect.height / k;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        centerX: left + width / 2,
        centerY: top + height / 2,
        width,
        height,
        pageIdx,
      };
    });
  };

  /**
   * åªå›žå‚³ã€Œç‰©ä»¶ç›®å‰æ‰€åœ¨çš„é‚£ä¸€é ã€çš„é‚Šç•Œã€‚
   *
   * ç›¸é„°å…©é ä¸­é–“ç•™äº† 1px çš„åˆ†éš”ï¼ˆstride = previewW + 1ï¼‰ï¼Œæ‰€ä»¥ä¸Šä¸€é çš„å³ç·£å’Œ
   * ä¸‹ä¸€é çš„å·¦ç·£æ˜¯å…©å€‹ç›¸å·® 1px çš„ç¨ç«‹å¸é™„é»ž â€”â€” æ‹–éŽåŽ»æ™‚æœƒäº®ä¸€æ¬¡ã€å†å¾€å‰ 1px
   * åˆäº®ä¸€æ¬¡ï¼Œçœ‹èµ·ä¾†å°±åƒåŒä¸€æ¢é‚Šè§¸ç™¼äº†å…©æ¬¡ã€‚æ”¹æˆåªè·Ÿè‡ªå·±é€™ä¸€é å°é½Šä¹‹å¾Œï¼Œ
   * ä¸€æ¢é‚Šå°±åªæœ‰ä¸€å€‹å¸é™„ä½ç½®ã€‚
   * ä¸­å¿ƒé»žä¸åœ¨ä»»ä½•ä¸€é ä¸Šï¼ˆä¾‹å¦‚æ‹–åˆ°é é¢å¤–çš„ç©ºç™½è™•ï¼‰æ™‚é€€å›žå…¨éƒ¨ï¼Œè¡Œç‚ºè·Ÿä»¥å‰ä¸€æ¨£ã€‚
   */
  const pageRectsNear = (rects: ReturnType<typeof getAllPageRects>, centerX: number) => {
    const own = rects.filter(r => centerX >= r.left - 0.5 && centerX <= r.right + 0.5);
    return own.length ? own : rects;
  };

  /**
   * é èˆ‡é ä¹‹é–“é‚£æ¢åˆ†å‰²ç·šçš„ xï¼ˆå…§å®¹åº§æ¨™ï¼‰ã€‚
   * ç‰©ä»¶çš„ã€Œä¸­å¿ƒã€å¯ä»¥å°åˆ°å®ƒ â€”â€” è·¨é æ“ºæ”¾æ™‚è¦çš„å°±æ˜¯ã€Œæ­£å¥½é¨Žåœ¨æŽ¥ç¸«ä¸Šã€ã€‚
   */
  const seamXs = () => {
    const rs = getAllPageRects();
    const out: number[] = [];
    for (let i = 0; i < rs.length - 1; i++) out.push((rs[i].right + rs[i + 1].left) / 2);
    return out;
  };

  /**
   * åŒä¸€æ¢ç·šåªç•™ä¸€ä»½ï¼ˆå¸é™„æŒ‘åˆ°çš„é‚£æ¢å¯èƒ½è·Ÿä¸‹é¢é‡æ–°æŽƒå‡ºä¾†çš„é‡è¤‡ï¼‰ã€‚
   * å‚³äº† centerX å°±é †ä¾¿æŠŠã€Œæ©«ç·šåªç•«åœ¨é€™ä¸€é ã€çš„å·¦å³ç¯„åœè£œä¸Š â€”â€”
   * æ°´å¹³çš„å°é½Šç·šæ˜¯å°é½Šã€Œé€™å€‹ç‰©ä»¶æ‰€åœ¨çš„é‚£ä¸€é ã€ï¼Œè·¨åˆ°éš”å£é åŽ»æ²’æœ‰æ„ç¾©ã€‚
   * ç›´ç·šä¸é™åˆ¶ï¼šå®ƒæœ¬ä¾†å°±åªæœ‰ä¸€é é‚£éº¼å¯¬ã€‚
   */
  const dedupeGuidelines = (list: AlignmentGuideline[], centerX?: number) => {
    const pr = centerX == null ? null : (pageRectsNear(getAllPageRects(), centerX)[0] || null);
    const seen = new Set<string>();
    return list.filter(g => {
      const k = `${g.type}|${Math.round(g.coord * 10)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map(g => (g.type === 'horizontal' && pr && g.x0 == null)
      ? { ...g, x0: pr.left, x1: pr.right }
      : g);
  };

  /**
   * åœ¨æŒ‡å®šä½ç½®ä¸Šï¼Œåˆ—å‡ºã€Œç¾åœ¨çœŸçš„å°é½Šåˆ°ã€çš„ç•«å¸ƒè¼”åŠ©ç·šï¼š
   * åž‚ç›´ä¸­ç·šã€æ°´å¹³ä¸­ç·šã€ä»¥åŠç•«å¸ƒçš„å››å€‹é‚Šç•Œã€‚
   * å¸é™„æ™‚é‚Šç•Œæœƒåˆ»æ„å¤–æº¢ 1px é˜²æ­¢æ¬¡åƒç´ ç¸«ï¼Œæ‰€ä»¥é‚Šç•Œçš„å®¹è¨±å€¼æ”¾å¯¬ä¸€é»žã€‚
   */
  /** æ—‹è½‰ä¹‹å¾ŒçœŸæ­£ä½”çš„æ¡†ï¼ˆå¤–æŽ¥çŸ©å½¢ï¼‰ã€‚0/180 åº¦å°±æ˜¯åŽŸæœ¬çš„å¯¬é«˜ï¼Œ90 åº¦æœƒå°èª¿ã€‚ */
  const rotExtent = (w: number, h: number, rot: number) => {
    const r = ((rot || 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
    return { bw: w * c + h * sn, bh: w * sn + h * c };
  };

  /** è‡ªç”±å›¾ç‰‡æ‹–åŠ¨æ—¶ä¸å¯è¿›å…¥å›¾å½¢å›¾å±‚çš„å ç”¨èŒƒå›´ã€‚é€‰ä¸­æ¡†ä½¿ç”¨æ—‹è½¬åŽçš„å¤–æŽ¥çŸ©å½¢ï¼Œ
      ä¸Žç”»é¢ä¸ŠçœŸæ­£çœ‹è§çš„èŒƒå›´ä¸€è‡´ï¼›è¾¹ç¼˜åˆšå¥½ç›¸è´´ä¸ç®—é‡å ã€‚ */
  const floatingBoundsAt = (f: FloatingImage, x = f.x, y = f.y) => {
    const ext = rotExtent(f.width * (f.scale || 1), f.height * (f.scale || 1), f.rotation || 0);
    const cx = x + f.width / 2, cy = y + f.height / 2;
    return { left: cx - ext.bw / 2, right: cx + ext.bw / 2, top: cy - ext.bh / 2, bottom: cy + ext.bh / 2 };
  };
  const imageWouldOverlapShape = (moving: FloatingImage, x: number, y: number) => {
    if (moving.shape || moving.text !== undefined) return false;
    const a = floatingBoundsAt(moving, x, y);
    return floatingImages.some(f => {
      if (f.id === moving.id || !f.shape) return false;
      const b = floatingBoundsAt(f);
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
  };

  const pageGuidelinesAt = (
    x: number, y: number, imgWidth: number, imgHeight: number, scale: number, edgeOnly = false, rot = 0,
  ): AlignmentGuideline[] => {
    const out: AlignmentGuideline[] = [];
    // è½‰éŽçš„åœ–è¦ç”¨å¤–æŽ¥çŸ©å½¢åŽ»æ¯”ï¼Œä¸ç„¶ç·šæœƒäº®åœ¨é›¢é‚Šç·£åŠå€‹èº«å­çš„åœ°æ–¹
    const { bw: scaledW, bh: scaledH } = rotExtent(imgWidth * scale, imgHeight * scale, rot);
    const cx = x + imgWidth / 2;
    const cy = y + imgHeight / 2;
    const left = cx - scaledW / 2, right = cx + scaledW / 2;
    const top = cy - scaledH / 2, bottom = cy + scaledH / 2;
    const EPS_C = 0.75;   // ä¸­ç·šæ˜¯ç²¾æº–å¸é™„
    /* è²¼é½Šæ˜¯ã€Œå‰›å¥½å°é½Šã€ä¸å¤–æº¢ã€ï¼Œå®¹å·®åªç•™çµ¦æ¬¡åƒç´ æ¨å…¥ã€‚
       è¶…éŽå°±ä»£è¡¨çœŸçš„æœ‰ç¸«ï¼ˆæˆ–çœŸçš„è¶…å‡ºåŽ»ï¼‰ï¼Œé‚£å°±ä¸è©²ç•«ç·š â€”â€” ä¸ç„¶æœƒå‡ºç¾
       ã€Œç·šäº®äº†ã€åœ–å»æ²’çœŸçš„è²¼ä¸ŠåŽ»ã€çš„è½å·®ã€‚ */
    const EPS_E = 0.6;
    pageRectsNear(getAllPageRects(), cx).forEach(pr => {
      if (!edgeOnly && Math.abs(cx - pr.centerX) < EPS_C) out.push({ type: 'vertical', coord: pr.centerX });
      if (Math.abs(left - pr.left) < EPS_E) out.push({ type: 'vertical', coord: pr.left });
      if (Math.abs(right - pr.right) < EPS_E) out.push({ type: 'vertical', coord: pr.right });
      if (!edgeOnly && Math.abs(cy - pr.centerY) < EPS_C) out.push({ type: 'horizontal', coord: pr.centerY });
      if (Math.abs(top - pr.top) < EPS_E) out.push({ type: 'horizontal', coord: pr.top });
      if (Math.abs(bottom - pr.bottom) < EPS_E) out.push({ type: 'horizontal', coord: pr.bottom });
    });
    // ä¸­å¿ƒé¨Žåœ¨é èˆ‡é çš„åˆ†å‰²ç·šä¸Šæ™‚ï¼Œä¹Ÿäº®ä¸€æ¢ç·š
    if (!edgeOnly) seamXs().forEach(sx => {
      if (Math.abs(cx - sx) < EPS_C) out.push({ type: 'vertical', coord: sx });
    });
    return out;
  };

  const applySnapping = (
    imgId: string,
    rawX: number,
    rawY: number,
    imgWidth: number,
    imgHeight: number,
    imgScale: number,
    edgeOnly?: boolean,
    rot = 0
  ) => {
    if (!enableSnapping) {
      return { snappedX: rawX, snappedY: rawY, fitScale: undefined, guidelines: [] };
    }
    // åªè·Ÿè‡ªå·±æ‰€åœ¨çš„é‚£ä¸€é å°é½Šï¼šéš”å£é çš„é‚Šç•Œåªå·® 1pxï¼Œå…©å€‹éƒ½ç•™è‘—æœƒè®“åŒä¸€æ¢é‚Š
    // å‡ºç¾å…©å€‹å¸é™„ä½ç½®ï¼ˆæ‹–éŽåŽ»äº®ä¸€æ¬¡ã€å†å¾€å‰ 1px åˆäº®ä¸€æ¬¡ï¼‰
    const pageRects = pageRectsNear(getAllPageRects(), rawX + imgWidth / 2);
    if (pageRects.length === 0) {
      return { snappedX: rawX, snappedY: rawY, fitScale: undefined, guidelines: [] };
    }

    /* ç¶“å…¸ï¼å‰µæ„æ‹¼åœ–å…±ç”¨ 8 å€‹èž¢å¹•åƒç´ çš„å¸é™„è·é›¢ã€‚æ›ç®—å›žå…§å®¹åº§æ¨™ï¼Œ
       é è¦½ç„¡è«–æ”¾å¤§æˆ–ç¸®å°ï¼Œå¸é™„æ‰‹æ„Ÿéƒ½ä¿æŒä¸€è‡´ã€‚ */
    const SNAP_THRESHOLD = 4 / Math.max(0.0001, kRef.current || 1);
    const ownPageRectsForFit = pageRects;
    // è½‰éŽçš„åœ–ä¸€å¾‹ç”¨å¤–æŽ¥çŸ©å½¢åˆ¤å®šï¼ˆè·Ÿå‰µæ„æ‹¼åœ–åŒä¸€å¥—ï¼‰
    const { bw: scaledW, bh: scaledH } = rotExtent(imgWidth * imgScale, imgHeight * imgScale, rot);

    // Center coordinates for raw input
    const rawCenterX = rawX + imgWidth / 2;
    const rawCenterY = rawY + imgHeight / 2;

    // Edges for raw input
    const rawLeft = rawCenterX - scaledW / 2;
    const rawRight = rawCenterX + scaledW / 2;
    const rawTop = rawCenterY - scaledH / 2;
    const rawBottom = rawCenterY + scaledH / 2;

    let snappedX = rawX;
    let snappedY = rawY;
    let fitScale: number | undefined;
    const guidelines: AlignmentGuideline[] = [];

    // 1. Vertical snapping (determines snappedX)
    let minDiffX = Infinity;
    let bestSnapX = rawX;
    let bestGuidelineX: number | null = null;

    // Check ALL pages' boundaries (centerX, left edge, right edge)
    pageRects.forEach(pageRect => {
      // Page centerX (only if not edgeOnly)
      if (!edgeOnly) {
        const diffCenterX = rawCenterX - pageRect.centerX;
        if (Math.abs(diffCenterX) < SNAP_THRESHOLD && Math.abs(diffCenterX) < Math.abs(minDiffX)) {
          minDiffX = diffCenterX;
          bestSnapX = pageRect.centerX - imgWidth / 2;
          bestGuidelineX = pageRect.centerX;
        }
      }

      // Page left edge
      const diffLeft = rawLeft - pageRect.left;
      if (Math.abs(diffLeft) < SNAP_THRESHOLD && Math.abs(diffLeft) < Math.abs(minDiffX)) {
        minDiffX = diffLeft;
        /* å¾€å¤–å¤šåŠå€‹åƒç´ ï¼šå‰›å¥½è²¼é½Šæ™‚é‚Šç·£è½åœ¨éžæ•´æ•¸åƒç´ ä¸Šï¼ŒæŠ—é‹¸é½’æœƒè®“æœ€å¤–é¢
           é‚£ä¸€åˆ—éœ²å‡ºåº•ä¸‹çš„é é¢ç™½è‰²ï¼Œçœ‹èµ·ä¾†å°±æ˜¯ä¸€æ¢é«®çµ²ç™½ç¸«ã€‚åŠå€‹åƒç´ è‚‰çœ¼çœ‹ä¸
           å‡ºä¾†ï¼Œä¹Ÿä¸æœƒåƒåŽŸæœ¬çš„ 1px é‚£æ¨£æº¢åˆ°éš”å£é ã€‚ */
        bestSnapX = pageRect.left - imgWidth / 2 + scaledW / 2;
        bestGuidelineX = pageRect.left;
      }

      // Page right edge
      const diffRight = rawRight - pageRect.right;
      if (Math.abs(diffRight) < SNAP_THRESHOLD && Math.abs(diffRight) < Math.abs(minDiffX)) {
        minDiffX = diffRight;
        bestSnapX = pageRect.right - imgWidth / 2 - scaledW / 2;
        bestGuidelineX = pageRect.right;
      }
    });

    /* ç‰©ä»¶çš„ä¸­å¿ƒä¹Ÿèƒ½å¸åˆ°ã€Œé èˆ‡é ä¹‹é–“é‚£æ¢åˆ†å‰²ç·šã€â€”â€”
       è·¨é æ“ºä¸€å€‹ç‰©ä»¶æ™‚ï¼Œæƒ³è¦çš„å°±æ˜¯æ­£å¥½é¨Žåœ¨æŽ¥ç¸«ä¸Šã€‚
       åªåœ¨ä¸­å¿ƒå°é½Šæ¨¡å¼ä¸‹é–‹æ”¾ï¼ˆedgeOnly çš„æ‰‹å‹¢æ˜¯åœ¨èª¿å¤§å°ï¼Œä¸è©²è¢«æ‹‰èµ°ï¼‰ã€‚ */
    if (!edgeOnly) {
      seamXs().forEach(sx => {
        const diffSeam = rawCenterX - sx;
        if (Math.abs(diffSeam) < SNAP_THRESHOLD && Math.abs(diffSeam) < Math.abs(minDiffX)) {
          minDiffX = diffSeam;
          bestSnapX = sx - imgWidth / 2;
          bestGuidelineX = sx;
        }
      });
    }

    // Image-to-image vertical edge snapping
    if (!edgeOnly) floatingImages.forEach(other => {
      if (other.id === imgId) return;

      const otherW = rotExtent(other.width * other.scale, other.height * other.scale, other.rotation || 0).bw;
      const otherCenterX = other.x + other.width / 2;
      const otherLeft = otherCenterX - otherW / 2;
      const otherRight = otherCenterX + otherW / 2;

      // Center-to-center alignment
      const diffCCX = rawCenterX - otherCenterX;
      if (Math.abs(diffCCX) < SNAP_THRESHOLD && Math.abs(diffCCX) < Math.abs(minDiffX)) {
        minDiffX = diffCCX;
        bestSnapX = otherCenterX - imgWidth / 2;
        bestGuidelineX = otherCenterX;
      }

      // Current Left edge with other Left edge
      const diffLL = rawLeft - otherLeft;
      if (Math.abs(diffLL) < SNAP_THRESHOLD && Math.abs(diffLL) < Math.abs(minDiffX)) {
        minDiffX = diffLL;
        bestSnapX = otherLeft - imgWidth / 2 + scaledW / 2;
        bestGuidelineX = otherLeft;
      }
      // Current Left edge with other Right edge
      const diffLR = rawLeft - otherRight;
      if (Math.abs(diffLR) < SNAP_THRESHOLD && Math.abs(diffLR) < Math.abs(minDiffX)) {
        minDiffX = diffLR;
        bestSnapX = otherRight - imgWidth / 2 + scaledW / 2;
        bestGuidelineX = otherRight;
      }
      // Current Right edge with other Left edge
      const diffRL = rawRight - otherLeft;
      if (Math.abs(diffRL) < SNAP_THRESHOLD && Math.abs(diffRL) < Math.abs(minDiffX)) {
        minDiffX = diffRL;
        bestSnapX = otherLeft - imgWidth / 2 - scaledW / 2;
        bestGuidelineX = otherLeft;
      }
      // Current Right edge with other Right edge
      const diffRR = rawRight - otherRight;
      if (Math.abs(diffRR) < SNAP_THRESHOLD && Math.abs(diffRR) < Math.abs(minDiffX)) {
        minDiffX = diffRR;
        bestSnapX = otherRight - imgWidth / 2 - scaledW / 2;
        bestGuidelineX = otherRight;
      }
    });

    if (bestGuidelineX !== null) {
      snappedX = bestSnapX;
      /* â”€â”€ å°é½Šç·šä¸€å®šè¦è·Ÿå¸é™„å¾Œçš„é‚Šç·£é‡åˆ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
         é‚Šç·£è½åœ¨éžæ•´æ•¸çš„å¯¦é«”åƒç´ æ™‚ï¼Œç€è¦½å™¨æœƒæŠŠæœ€å¤–é¢é‚£ä¸€åˆ—è·Ÿåº•ä¸‹çš„é é¢ç™½è‰²
         æ··åœ¨ä¸€èµ·ï¼Œçœ‹èµ·ä¾†å°±æ˜¯ä¸€æ¢é«®çµ²ç™½ç·šï¼ˆåªæœ‰é è¦½æœƒï¼ŒåŒ¯å‡ºæ˜¯ç•«åœ¨ canvas ä¸Šï¼‰ï¼Œ
         æ‰€ä»¥å¸é™„å®Œé‚„è¦æŠŠé‚Šç·£æŒªåˆ°å¯¦é«”åƒç´ æ ¼ç·šä¸Šã€‚

         ä»¥å‰åªæŒªç‰©ä»¶ã€å°é½Šç·šç•™åœ¨åŽŸè™•ï¼Œæ–¼æ˜¯ã€Œç·šäº®äº†ï¼Œå¯æ˜¯æ±è¥¿æ²’æœ‰å‰›å¥½è²¼ä¸ŠåŽ»ã€ï¼›
         è€Œä¸”æ˜¯å¾€å¤–æ¨å…¥ï¼Œæœ€å¤šå·®ä¸€æ•´å€‹å¯¦é«”åƒç´ ã€‚ç¾åœ¨æ”¹æˆå°±è¿‘æ¨å…¥ï¼ˆæœ€å¤šå·®åŠå€‹ï¼‰ï¼Œ
         è€Œä¸”**æŠŠå°é½Šç·šä¸€èµ·æŒªéŽåŽ»** â€”â€” ç·šç•«åœ¨å“ªè£¡ï¼Œé‚Šç·£å°±åœ¨å“ªè£¡ï¼Œ
         çœ‹åˆ°çš„æ˜¯ 100% é‡åˆã€‚ */
      const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const leftEdge = snappedX + imgWidth / 2 - scaledW / 2;
      const rightEdge = leftEdge + scaledW;
      let gx: number = bestGuidelineX;
      if (Math.abs(leftEdge - gx) < 0.51) {
        const q = Math.round(leftEdge * dpr) / dpr;
        snappedX += q - leftEdge; gx = q;
      } else if (Math.abs(rightEdge - gx) < 0.51) {
        const q = Math.round(rightEdge * dpr) / dpr;
        snappedX += q - rightEdge; gx = q;
      }
      /* DOM åˆæˆçš„é€æ˜Žé‚Šåœ¨ Safari æœƒæ··å…¥ä¸€å°æ¢åº•è‰²ï¼›è¼¸å‡º canvas æ²’æœ‰é€™å±¤
         æŠ—é‹¸é½’ï¼Œæ‰€ä»¥æ‰æœƒå‡ºç¾ã€Œè¼¸å‡ºç„¡ç¸«ã€é è¦½æœ‰é«®çµ²ç¸«ã€ã€‚åªåœ¨çœŸæ­£è²¼é é¢
         å¤–ç·£æ™‚å‘è£åˆ‡å€å¤šè“‹ 0.35 å€‹èž¢å¹•åƒç´ ï¼Œå…§éƒ¨ç‰©ä»¶äº’ç›¸å°é½Šå®Œå…¨ä¸å‹•ã€‚ */
      const bleed = .35 / Math.max(.0001, kRef.current || 1);
      const isPageLeft = pageRects.some(pr => Math.abs(pr.left - bestGuidelineX!) < .51);
      const isPageRight = pageRects.some(pr => Math.abs(pr.right - bestGuidelineX!) < .51);
      if (isPageLeft && Math.abs(leftEdge - bestGuidelineX!) < .8) snappedX -= bleed;
      else if (isPageRight && Math.abs(rightEdge - bestGuidelineX!) < .8) snappedX += bleed;
      guidelines.push({ type: 'vertical', coord: gx });
    }
    /* åœ–å±¤æ¯”é é¢ã€Œå¹¾ä¹Žä¸€æ¨£å¯¬ã€æ™‚ï¼Œå·¦ç·£è²¼é½Šèˆ‡å³ç·£è²¼é½Šæ˜¯å…©å€‹ç›¸å·®é›¶é»žå¹¾ px çš„ä½ç½®ï¼Œ
       å¾žå“ªä¸€é‚Šé éŽåŽ»å°±å¸åˆ°å“ªä¸€å€‹ â€”â€” é‚£å°±æ˜¯ã€Œç”±å¤–è€Œå…§æ²’ç¸«ã€ç”±å…§è€Œå¤–æœ‰ç¸«ã€ã€‚
       é€™ç¨®æƒ…æ³ç›´æŽ¥æŠŠåœ–æ“ºæˆã€Œå…©é‚Šéƒ½ä¸éœ²ç™½ã€ï¼šä»¥è¼ƒå¯¬çš„é‚£ä¸€å´ç‚ºæº–ç½®ä¸­å°é½Šã€‚ */
    ownPageRectsForFit.forEach(pr => {
      const w = pr.right - pr.left;
      if (Math.abs(scaledW - w) < 2 && Math.abs((snappedX + imgWidth / 2) - pr.centerX) < 4) {
        snappedX = pr.centerX - imgWidth / 2;
        const bleed = .35 / Math.max(.0001, kRef.current || 1);
        fitScale = Math.max(fitScale || imgScale, imgScale * (w + bleed * 2) / Math.max(.001, scaledW));
      }
    });
    /* åœ–å±¤å·²ç¶“ã€Œå¹¾ä¹Žå‰›å¥½ç­‰æ–¼æ•´é ã€æ™‚ï¼Œå…‰æŠŠä½ç½®å°æº–é‚„ä¸å¤  â€”â€” åªè¦æ¯”é é¢çª„é›¶é»žå¹¾
       pxï¼Œç½®ä¸­ä¹‹å¾Œå…©å´å„ç•™ 0.25pxï¼ŒæŠ—é‹¸é½’å°±æœƒæŠŠé‚£æ¢ç¸«é¡¯ç¤ºå‡ºä¾†ã€‚é€™è£¡é †ä¾¿å›žå ±ä¸€å€‹
       ã€Œç¢ºå¯¦è¦†è“‹æ•´é å†å¤šåŠå€‹åƒç´ ã€çš„å€çŽ‡ï¼Œè®“æ‹–æ›³ä¹Ÿèƒ½æŠŠæœ€å¾Œé‚£ä¸€é»žè£œèµ·ä¾†ã€‚
       é é¢æœ¬ä¾†å°±æœƒè£æŽ‰è¶…å‡ºçš„éƒ¨åˆ†ï¼Œæ‰€ä»¥å¤šè“‹çš„å®Œå…¨çœ‹ä¸åˆ°ã€‚ */
    // 2. Horizontal snapping (determines snappedY)
    let minDiffY = Infinity;
    let bestSnapY = rawY;
    let bestGuidelineY: number | null = null;

    // Check ALL pages' boundaries (centerY, top edge, bottom edge)
    pageRects.forEach(pageRect => {
      // Page centerY (only if not edgeOnly)
      if (!edgeOnly) {
        const diffCenterY = rawCenterY - pageRect.centerY;
        if (Math.abs(diffCenterY) < SNAP_THRESHOLD && Math.abs(diffCenterY) < Math.abs(minDiffY)) {
          minDiffY = diffCenterY;
          bestSnapY = pageRect.centerY - imgHeight / 2;
          bestGuidelineY = pageRect.centerY;
        }
      }

      // Page top edge
      const diffTop = rawTop - pageRect.top;
      if (Math.abs(diffTop) < SNAP_THRESHOLD && Math.abs(diffTop) < Math.abs(minDiffY)) {
        minDiffY = diffTop;
        // Bleed 1px outwards (top) to prevent subpixel edge gap in browser preview
        bestSnapY = pageRect.top - imgHeight / 2 + scaledH / 2;
        bestGuidelineY = pageRect.top;
      }

      // Page bottom edge
      const diffBottom = rawBottom - pageRect.bottom;
      if (Math.abs(diffBottom) < SNAP_THRESHOLD && Math.abs(diffBottom) < Math.abs(minDiffY)) {
        minDiffY = diffBottom;
        // Bleed 1px outwards (bottom) to prevent subpixel edge gap in browser preview
        bestSnapY = pageRect.bottom - imgHeight / 2 - scaledH / 2;
        bestGuidelineY = pageRect.bottom;
      }
    });

    // Image-to-image horizontal edge snapping
    if (!edgeOnly) floatingImages.forEach(other => {
      if (other.id === imgId) return;

      const otherH = rotExtent(other.width * other.scale, other.height * other.scale, other.rotation || 0).bh;
      const otherCenterY = other.y + other.height / 2;
      const otherTop = otherCenterY - otherH / 2;
      const otherBottom = otherCenterY + otherH / 2;

      // Center-to-center alignment
      const diffCCY = rawCenterY - otherCenterY;
      if (Math.abs(diffCCY) < SNAP_THRESHOLD && Math.abs(diffCCY) < Math.abs(minDiffY)) {
        minDiffY = diffCCY;
        bestSnapY = otherCenterY - imgHeight / 2;
        bestGuidelineY = otherCenterY;
      }

      // Current Top edge with other Top edge
      const diffTT = rawTop - otherTop;
      if (Math.abs(diffTT) < SNAP_THRESHOLD && Math.abs(diffTT) < Math.abs(minDiffY)) {
        minDiffY = diffTT;
        bestSnapY = otherTop - imgHeight / 2 + scaledH / 2;
        bestGuidelineY = otherTop;
      }
      // Current Top edge with other Bottom edge
      const diffTB = rawTop - otherBottom;
      if (Math.abs(diffTB) < SNAP_THRESHOLD && Math.abs(diffTB) < Math.abs(minDiffY)) {
        minDiffY = diffTB;
        bestSnapY = otherBottom - imgHeight / 2 + scaledH / 2;
        bestGuidelineY = otherBottom;
      }
      // Current Bottom edge with other Top edge
      const diffBT = rawBottom - otherTop;
      if (Math.abs(diffBT) < SNAP_THRESHOLD && Math.abs(diffBT) < Math.abs(minDiffY)) {
        minDiffY = diffBT;
        bestSnapY = otherTop - imgHeight / 2 - scaledH / 2;
        bestGuidelineY = otherTop;
      }
      // Current Bottom edge with other Bottom edge
      const diffBB = rawBottom - otherBottom;
      if (Math.abs(diffBB) < SNAP_THRESHOLD && Math.abs(diffBB) < Math.abs(minDiffY)) {
        minDiffY = diffBB;
        bestSnapY = otherBottom - imgHeight / 2 - scaledH / 2;
        bestGuidelineY = otherBottom;
      }
    });

    if (bestGuidelineY !== null) {
      snappedY = bestSnapY;
      // è·Ÿä¸Šé¢ X é‚£ä¸€æ®µå®Œå…¨åŒä¸€å¥—ï¼ˆèªªæ˜Žè¦‹é‚£è£¡ï¼‰
      const dprY = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const topEdge = snappedY + imgHeight / 2 - scaledH / 2;
      const bottomEdge = topEdge + scaledH;
      let gy: number = bestGuidelineY;
      if (Math.abs(topEdge - gy) < 0.51) {
        const q = Math.round(topEdge * dprY) / dprY;
        snappedY += q - topEdge; gy = q;
      } else if (Math.abs(bottomEdge - gy) < 0.51) {
        const q = Math.round(bottomEdge * dprY) / dprY;
        snappedY += q - bottomEdge; gy = q;
      }
      const bleed = .35 / Math.max(.0001, kRef.current || 1);
      const isPageTop = pageRects.some(pr => Math.abs(pr.top - bestGuidelineY!) < .51);
      const isPageBottom = pageRects.some(pr => Math.abs(pr.bottom - bestGuidelineY!) < .51);
      if (isPageTop && Math.abs(topEdge - bestGuidelineY!) < .8) snappedY -= bleed;
      else if (isPageBottom && Math.abs(bottomEdge - bestGuidelineY!) < .8) snappedY += bleed;
      guidelines.push({ type: 'horizontal', coord: gy });
    }
    ownPageRectsForFit.forEach(pr => {
      const h = pr.bottom - pr.top;
      if (Math.abs(scaledH - h) < 2 && Math.abs((snappedY + imgHeight / 2) - pr.centerY) < 4) {
        snappedY = pr.centerY - imgHeight / 2;
        const bleed = .35 / Math.max(.0001, kRef.current || 1);
        fitScale = Math.max(fitScale || imgScale, imgScale * (h + bleed * 2) / Math.max(.001, scaledH));
      }
    });


    /* è²¼é½ŠåªæœƒæŒ‘ã€Œæœ€è¿‘çš„é‚£ä¸€æ¢ã€ä¾†å¸é™„ï¼Œä½†ç•«é¢ä¸Šè©²é¡¯ç¤ºçš„æ˜¯ã€Œç¾åœ¨åŒæ™‚å°é½Šçš„æ¯ä¸€æ¢ã€ï¼š
       ä¾‹å¦‚å‰›å¥½å¡åœ¨ç•«å¸ƒæ­£ä¸­å¤®æ™‚ï¼Œåž‚ç›´ä¸­ç·šèˆ‡æ°´å¹³ä¸­ç·šè¦ä¸€èµ·äº®èµ·ä¾†ï¼›è²¼é½Šå·¦é‚Šç•Œæ™‚ï¼Œ
       å¦‚æžœé«˜åº¦ä¹Ÿå‰›å¥½è·Ÿç•«å¸ƒåŒé«˜ï¼Œä¸Šä¸‹å…©æ¢é‚Šç•Œç·šä¹Ÿè¦ä¸€èµ·é¡¯ç¤ºã€‚
       é€™è£¡åœ¨ã€Œå·²ç¶“å¸é™„å®Œçš„ä½ç½®ã€ä¸ŠæŠŠç•«å¸ƒçš„ä¸­ç·šèˆ‡å››å€‹é‚Šç•Œé‡æ–°å°ä¸€æ¬¡ï¼Œå…¨éƒ¨ç¬¦åˆçš„
       éƒ½åŠ é€²åŽ»ã€‚è·Ÿå…¶ä»–ç‰©ä»¶çš„å°é½Šç·šä¸åˆ—å…¥ï¼ˆé‚£æ˜¯å¦ä¸€å›žäº‹ï¼Œç¶­æŒåŽŸæœ¬åªé¡¯ç¤ºå¸é™„åˆ°çš„é‚£ä¸€æ¢ï¼‰ã€‚ */
    guidelines.push(...pageGuidelinesAt(snappedX, snappedY, imgWidth, imgHeight, imgScale, edgeOnly, rot));

    return { snappedX, snappedY, fitScale, guidelines: dedupeGuidelines(guidelines, snappedX + imgWidth / 2) };
  };

  const [draggedFloatingIndex, setDraggedFloatingIndex] = useState<number | null>(null);

  const handleReorder = (fromIndex: number, toIndex: number) => {
    setFloatingImages(prev => {
      const result = [...prev];
      if (fromIndex < 0 || fromIndex >= result.length || toIndex < 0 || toIndex >= result.length) {
        return prev;
      }
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);
      return result;
    });
  };
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  /**
   * ã€Œå¤–æ¡†å±¤ã€ã€‚
   *
   * é é¢å®¹å™¨ï¼ˆpagesContainerRefï¼‰æ˜¯é–‹ overflow-hidden çš„ â€”â€” é‚£æ¢è£åˆ‡ç·šå°±æ˜¯ä½¿ç”¨è€…
   * çœ‹åˆ°çš„ã€Œç•«å¸ƒé‚Šç·£çš„é»‘ã€ã€‚ç‰©ä»¶è¢«æ‹–å‡ºåŽ»çš„éƒ¨åˆ†æœ¬ä¾†å°±è©²è¢«åˆ‡æŽ‰ï¼Œä½†é¸å–æ¡†ã€å››å€‹è§’çš„
   * åœ“çƒã€ä¸Šé¢é‚£æŽ’æŒ‰éˆ•ä¸è©²ä¸€èµ·è¢«åˆ‡ï¼šæ±è¥¿ä¸€è¶…å‡ºç•«å¸ƒå°±æŠ“ä¸åˆ°è§’ï¼Œä¹ŸæŒ‰ä¸åˆ°åˆªé™¤ã€‚
   *
   * æ‰€ä»¥å¤–æ¡†æ”¹æŽ›åœ¨é€™ä¸€å±¤ã€‚å®ƒæ˜¯é é¢å®¹å™¨çš„ã€Œå…„å¼Ÿã€ï¼ˆåŒä¸€å€‹çˆ¶å±¤ã€åŒæ¨£çš„åº§æ¨™åŽŸé»žã€
   * åŒæ¨£çš„ç¸®æ”¾èˆ‡ä½ç§»ï¼‰ï¼Œåªæ˜¯ä¸åœ¨é‚£å€‹ overflow-hidden åº•ä¸‹ â€”â€”
   * æ–¼æ˜¯ä½ç½®åˆ†æ¯«ä¸å·®ï¼Œå»ä¸æœƒè¢«è£åˆ‡ã€‚
   *
   * ç”¨ state è€Œä¸æ˜¯ refï¼šè¦ç­‰é€™å€‹ DOM ç¯€é»žçœŸçš„æŽ›ä¸ŠåŽ»ï¼Œå­å±¤æ‰èƒ½ createPortal éŽåŽ»ã€‚
   * ref ä¸æœƒè§¸ç™¼é‡æ–°æ¸²æŸ“ï¼Œç¬¬ä¸€æ¬¡æ¸²æŸ“æ™‚å­å±¤æ‹¿åˆ°çš„é‚„æ˜¯ nullã€‚
   */
  const [chromeLayer, setChromeLayer] = useState<HTMLDivElement | null>(null);

  // Workspace-wide interaction for selected floating images
  const wsDragStart = useRef<{
    startX: number;
    startY: number;
    imgX: number;
    imgY: number;
    pointerId: number;
    hasMoved: boolean;
  } | null>(null);

  const wsPinchStart = useRef<{
    startDist: number;
    imgScale: number;
  } | null>(null);

  const handleWorkspacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest?.('[data-stretch-handle]')) return;
    if (!selectedFloatingId) return;
    const selectedImg = floatingImages.find(img => img.id === selectedFloatingId);
    if (!selectedImg) return;

    e.currentTarget.setPointerCapture(e.pointerId);

    wsDragStart.current = {
      startX: e.clientX,
      startY: e.clientY,
      imgX: selectedImg.x,
      imgY: selectedImg.y,
      pointerId: e.pointerId,
      hasMoved: false,
    };
  };

  const handleWorkspacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedFloatingId || !wsDragStart.current || wsDragStart.current.pointerId !== e.pointerId) return;

    if (e.buttons === 0) {
      wsDragStart.current = null;
      setActiveGuidelines([]);
      return;
    }

    if (wsPinchStart.current) return;

    const dx = e.clientX - wsDragStart.current.startX;
    const dy = e.clientY - wsDragStart.current.startY;

    if (Math.hypot(dx, dy) > 3) {
      wsDragStart.current.hasMoved = true;
    }

    const selectedImg = floatingImages.find(img => img.id === selectedFloatingId);
    if (!selectedImg) return;

    const rawX = wsDragStart.current.imgX + dx;
    const rawY = wsDragStart.current.imgY + dy;

    const { snappedX, snappedY, guidelines } = applySnapping(
      selectedImg.id,
      rawX,
      rawY,
      selectedImg.width,
      selectedImg.height,
      selectedImg.scale,
      undefined,
      selectedImg.rotation || 0,
    );

    setActiveGuidelines(guidelines);

    setFloatingImages(prev => prev.map(img => {
      if (img.id === selectedFloatingId) {
        return {
          ...img,
          x: snappedX,
          y: snappedY,
        };
      }
      return img;
    }));
  };

  const handleWorkspacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!wsDragStart.current || wsDragStart.current.pointerId !== e.pointerId) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (!wsDragStart.current.hasMoved) {
      setSelectedFloatingId(null);
    }

    wsDragStart.current = null;
    setActiveGuidelines([]);
  };

  const handleWorkspaceWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!selectedFloatingId) return;
    if (e.ctrlKey) {
      e.preventDefault();
      const selectedImg = floatingImages.find(img => img.id === selectedFloatingId);
      if (!selectedImg) return;

      const factor = 1 - e.deltaY * 0.01;
      const newScale = Math.max(0.1, Math.min(10.0, selectedImg.scale * factor));

      setFloatingImages(prev => prev.map(img => {
        if (img.id === selectedFloatingId) {
          return {
            ...img,
            scale: newScale,
          };
        }
        return img;
      }));
    }
  };

  // Keyboard listener to delete selected floating image on Delete/Backspace keypress
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedFloatingId && (e.key === 'Delete' || e.key === 'Backspace')) {
        const activeEl = document.activeElement;
        if (
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.getAttribute('contenteditable') === 'true')
        ) {
          return;
        }
        setFloatingImages(prev => prev.filter(img => img.id !== selectedFloatingId));
        setSelectedFloatingId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFloatingId]);

  /** æ­£åœ¨ç·¨è¼¯çš„æ–‡å­—åœ–å±¤ idï¼Œnull ä»£è¡¨æ²’æœ‰æ‰“é–‹æ–‡å­—é¢æ¿ */
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  /** æ­£åœ¨ç•«å¸ƒä¸Šç›´æŽ¥æ‰“å­—çš„æ–‡å­—åœ–å±¤ */
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  /** æ­£åœ¨è¢«é›™æŒ‡ç¸®æ”¾ï¼æ—‹è½‰çš„åœ–å±¤ï¼šé€™æ®µæœŸé–“å·¥å…·åˆ—å…ˆæ”¶èµ·ä¾† */
  const [pinchFloatingId, setPinchFloatingId] = useState<string | null>(null);
  /** ã€Œåœ–ç‰‡èª¿æ•´ã€çš„å­åˆ†é  */
  const [adjustSub, setAdjustSub] = useState<'shape' | 'tune' | 'filter' | 'effect'>('filter');
  /** èª¿ç¯€åˆ†é ç›®å‰é¸ä¸­çš„å·¥å…· */
  const [tuneTool, setTuneTool] = useState('brightness');
  /** å½¢ç‹€åˆ†é ç›®å‰é¸ä¸­çš„å·¥å…· */
  /* ä¸€é–‹å§‹ä¸é¸ä»»ä½•ä¸€é¡†é€ åž‹å·¥å…·ï¼ˆè¦‹ CATS é‚£é‚Šçš„èªªæ˜Žï¼‰ï¼šé€²é€ åž‹é æ™‚å…¨éƒ¨æ˜¯æš—çš„ */
  const [shapeTool, setShapeTool] = useState('');
  /** å½¢ç‹€åˆ†é ï¼šroot æ˜¯ç¸½è¦½ï¼Œå…¶é¤˜æ˜¯å½¢ç‹€ï¼æé‚Šï¼ç™¼å…‰çš„å­é¸å–® */
  const [shapeMenu, setShapeMenu] = useState<'root' | 'stroke' | 'glow' | 'imgShape'>('root');
  /* â”€â”€ å½¢ç‹€çš„ç¬¬äºŒæ®µé¸å– â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     é¸ä¸­åœ–ç‰‡ä¹‹å¾Œå†é»žä¸€æ¬¡åœ–ç‰‡ï¼Œæ‰é€²åˆ°ã€Œé¸ä¸­å½¢ç‹€ã€ï¼š
       Â· å¤–æ¡†æ”¹æˆæ²¿è‘—å½¢ç‹€æä¸€åœˆï¼Œæ–¹æ¡†èˆ‡å››é¡†è§’çƒæ”¶èµ·ä¾†
       Â· åœ¨åœ–æ¡ˆè£¡é¢æ‹–æ›³ ï¼ èª¿æ•´åœ–ç‰‡åœ¨å½¢ç‹€è£¡çš„ä½ç½®
       Â· å…©æŒ‡æ ï¼ èª¿æ•´åœ–ç‰‡åœ¨å½¢ç‹€è£¡çš„å¤§å°
       Â· é»žåˆ°å½¢ç‹€å¤–é¢å°±é€€å›žã€Œåªé¸ä¸­åœ–ç‰‡ã€
     ref æ˜¯çµ¦æ‰‹å‹¢é‚£å¹¾æ”¯ç”¨çš„ â€”â€” å®ƒå€‘ä¸æœƒè·Ÿè‘— state é‡æ–°ç¶å®šã€‚ */
  const [shapeSelId, setShapeSelId] = useState<string | null>(null);
  const shapeSelRef = useRef<string | null>(null);
  /** å‰›å‰›å› ç‚ºã€Œæ‰‹æŒ‡æŒ‰åœ¨å½¢ç‹€å¤–é¢ã€è€Œé€€æŽ‰çš„é‚£ä¸€é¡†ã€‚ç¬¬äºŒæ ¹æ‰‹æŒ‡è·Ÿä¸Šæ™‚è¦å¾©åŽŸã€‚ */
  const shapeSelUndoRef = useRef<string | null>(null);
  useEffect(() => { shapeSelRef.current = shapeSelId; }, [shapeSelId]);
  // å–æ¶ˆé¸å–ã€æˆ–æ›é¸åˆ¥å¼µåœ– â†’ å½¢ç‹€é¸å–ä¸€èµ·æ”¶æŽ‰
  useEffect(() => {
    if (shapeSelId && shapeSelId !== selectedFloatingId) setShapeSelId(null);
  }, [selectedFloatingId, shapeSelId]);
  /** æ­£åœ¨æ‹–å½¢ç‹€çš„æ»‘æ¡¿ï¼šåœ–ç‰‡çš„é¸å–æ¡†å…ˆæ•´çµ„æ”¶èµ·ä¾† */
  const [tuningEdge, setTuningEdge] = useState(false);
  /** ç‰¹æ•ˆåˆ†é ï¼šé¸ä¸­å“ªä¸€å¼µå¡ç‰‡ï¼Œä»¥åŠç´°é …æœ‰æ²’æœ‰å±•é–‹ï¼ˆè·Ÿã€Œç·¨è¼¯ã€åŒä¸€ç¨®æ“ä½œï¼‰ */
  const [effectCard, setEffectCard] = useState('');
  const [effectDetail, setEffectDetail] = useState(false);
  /** æ­£åœ¨ä¸‹è¼‰çš„æ¿¾é¡ï¼šé‚£å¼µå¡ç‰‡ä¸Šè¦æœ‰è½‰åœˆå‹•ç•« */
  const [loadingLut, setLoadingLut] = useState<string | null>(null);

  /* æ›ä¸€å¼µåœ–å±¤å°±æŠŠç‰¹æ•ˆçš„é¸å–æ”¶ä¹¾æ·¨ â€”â€” ä¸ç„¶ç´°é …é¢æ¿é‚„é–‹è‘—ä¸Šä¸€å¼µé¸çš„é‚£é¡†ï¼Œ
     æ»‘æ¡¿å»å·²ç¶“æŽ¥åˆ°æ–°é€™å¼µçš„åƒæ•¸ä¸Šäº†ã€‚ */
  useEffect(() => { setEffectCard(''); setEffectDetail(false); }, [selectedFloatingId]);
  /** æ§‹åœ–ä¸­çš„åœ–å±¤ï¼šè·Ÿã€Œç·¨è¼¯ã€å…±ç”¨åŒä¸€å€‹ ComposeStudio */
  const [composeState, setComposeState] = useState<{
    id: string;
    img: HTMLImageElement | HTMLVideoElement;
    geo: GeoParams;
    vid?: boolean;
    cell?: { layoutId: string; index: number };
  } | null>(null);

  const openComposeFor = (id: string) => {
    const layer = floatingImages.find(f => f.id === id);
    /* å¸ƒå±€å°æ ¼ä¸æ˜¯ floatingImages å›¾å±‚ã€‚ç¼–è¾‘é¢æ¿ä¼šä¸ºå®ƒå»ºç«‹ä¸€ä¸ªä¸´æ—¶ layerï¼Œ
       ä»¥å‰è¿™é‡Œåˆåªå›žå¤´æ‰¾ floatingImagesï¼Œæ‰€ä»¥ç‚¹å‡»â€œæž„å›¾â€å¿…å®šç›´æŽ¥ returnã€‚
       çŽ°åœ¨æ˜Žç¡®è®°å½•æ ¼å­æ‰€å±žå¸ƒå±€ä¸Žç´¢å¼•ï¼Œå¥—ç”¨æ—¶å†å‡†ç¡®å†™å›žè¯¥æ ¼ã€‚ */
    if (!layer) {
      if (selectedIndex === null || !selectedLayoutId) return;
      const layoutHit = pages.flatMap(p => p.layouts).find(l => l.id === selectedLayoutId);
      const cell = layoutHit?.images[selectedIndex];
      if (!cell?.url) return;
      const el = new Image();
      el.onload = () => setComposeState({
        id: cell.id,
        img: el,
        geo: DEFAULT_GEO,
        cell: { layoutId: selectedLayoutId, index: selectedIndex },
      });
      el.src = cell.url;
      return;
    }
    /* â”€â”€ å½±ç‰‡èµ°å¦ä¸€æ¢ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
       ä»¥å‰é€™è£¡ä¸ç®¡ä¸‰ä¸ƒäºŒåä¸€éƒ½é–‹ä¸€å¼µ <img> åŽ»è®€é‚£æ¢ç¶²å€ã€‚å½±ç‰‡çš„ç¶²å€
       <img> æ˜¯è®€ä¸åˆ°çš„ â†’ onload æ°¸é ä¸æœƒä¾† â†’ æ§‹åœ–ä»‹é¢æ ¹æœ¬æ‰“ä¸é–‹ï¼›
       å°±ç®—ç¡¬æ‰“é–‹ï¼Œå¥—ç”¨æ™‚åˆæœƒæŠŠ src æ›æˆçƒ¤å¥½çš„ PNGï¼Œè€Œåœ–å±¤é‚„æ¨™è‘— isVideoï¼Œ
       æ–¼æ˜¯ <video src="â€¦png"> æ’­ä¸å‡ºä»»ä½•æ±è¥¿ â€”â€” é‚£å°±æ˜¯ã€Œè£åˆ‡å¾Œå½±ç‰‡ç›´æŽ¥æ¶ˆå¤±ã€ã€‚
       æ”¹æˆï¼šæ‹¿ä¸€å€‹çœŸçš„ <video> çµ¦æ§‹åœ–ä»‹é¢ç”¨ï¼Œå¥—ç”¨æ™‚åªç•™ä¸‹ geoã€ä¸çƒ¤åœ–ã€‚ */
    if (layer.isVideo) {
      loadVideoEl(layer.origSrc || layer.src)
        .then(v => {
          try { v.pause(); } catch { /* åœä¸äº†ä¹Ÿæ²’é—œä¿‚ */ }
          setComposeState({ id, img: v, geo: layer.geo || DEFAULT_GEO, vid: true });
        })
        .catch(() => { /* è®€ä¸åˆ°å°±ç•¶ä½œæ²’æŒ‰ */ });
      return;
    }
    const el = new Image();
    el.onload = () => setComposeState({ id, img: el, geo: layer.geo || DEFAULT_GEO });
    // baked éŽå°±å¾žåŽŸåœ–æŽ¥çºŒï¼Œåƒæ•¸é‚„åŽŸæˆä¸Šæ¬¡çš„æ¨£å­
    el.src = layer.origSrc || layer.src;
  };

  const applyComposeToLayer = () => {
    const st = composeState;
    if (!st) return;
    /* å¸ƒå±€æ ¼å­çš„æž„å›¾ç›´æŽ¥çƒ¤å›žè¯¥æ ¼ï¼›ä¸ç»è¿‡ floatingImagesï¼Œä¹Ÿä¸ä¼šè¯¯å†™å½“å‰é¡µ
       ä¸Šå¦ä¸€ä¸ªåŒç´¢å¼•çš„å¸ƒå±€ã€‚ */
    if (st.cell) {
      const sw = (st.img as any).naturalWidth || st.img.width;
      const sh = (st.img as any).naturalHeight || st.img.height;
      if (isGeoIdentity(st.geo)) { setComposeState(null); return; }
      const baked = composeCanvas(st.img, sw, sh, st.geo, 2400);
      baked.toBlob(blob => {
        if (!blob) { setComposeState(null); return; }
        const url = URL.createObjectURL(blob);
        setPages(prev => prev.mapëÞ½é¼­zÊ&ŠÛ^uµ=Ù•É±…åI•™Ì€ôÕÍ•I•˜¡¹•Ü5…ÀñÍÑÉ¥¹œ°!Q51¥Ù±•µ•¹Ðø ¤¤ì(€½¹ÍÐ•µ‰•‘‘•‘M•…µÍI•˜€ôÕÍ•I•˜¡™…±Í”¤ì(€½¹ÍÐ•µ‰•‘‘•‘M•…µÌ€ôÁ…•É…%‘à€„ôô¹Õ±°(€€€ñðÍ•±•Ñ•‘±½…Ñ¥¹%€„ôô¹Õ±°ñðÍ•±•Ñ•‘	ÉÕÍ¡%€„ôô¹Õ±°(€€€ñðÍ•±•Ñ•‘%¹‘•à€„ôô¹Õ±°ñðÍ•±•Ñ•‘1…å½ÕÑ%€„ôô¹Õ±°ì(€•µ‰•‘‘•‘M•…µÍI•˜¹ÕÉÉ•¹Ð€ô•µ‰•‘‘•‘M•…µÌì(€€¼¨¨ƒ¦‚¦v‹š:Ÿ–"Û¦6×¢"žV¯–â–ÇžR£žj–ºk’ö7š‚ç¾òo’â7¢÷’öÿžR Ù¥•ÝÁ½ÉÐµ™¥á•“¾ò3–B›–&ž?¢š÷–f (€€€€€ƒžâ»šRû¾ò=¥=LÙ¥ÍÕ…±Y¥•ÝÁ½ÉÐƒšRç¢º+šf–§¢šr¢B÷–r£’â7–B3–êŸš¢gžÎïŽ€¨¼(€½¹ÍÐÉ¥‘I½½ÑI•˜€ôÕÍ•I•˜ñ!Q51¥Ù±•µ•¹Ðø¡¹Õ±°¤ì(€½¹ÍÐÁ…•Í½±I•˜€ôÕÍ•I•˜ñ!Q51¥Ù±•µ•¹Ðø¡¹Õ±°¤ì(€€¼¨¨ƒšVÓš:K¦‚¦v‹žj–’[šºó¾ò#–Âë–¾ã¾òwžâ»šRû–ú3žrš¶’öSžj–’Ÿ–Â?¾ò'¢"–>Ï¦
+žjžVgžfô€¨¼(€½¹ÍÐÍÑÉ¥ÁM¡•±±I•˜€ôÕÍ•I•˜ñ!Q51¥Ù±•µ•¹Ðø¡¹Õ±°¤ì(€½¹ÍÐÍÑÉ¥ÁA…‘I•˜€ôÕÍ•I•˜ñ!Q51¥Ù±•µ•¹Ðø¡¹Õ±°¤ì(€½¹ÍÐ…‘‘A…•	Ñ¹I•˜€ôÕÍ•I•˜ñ!Q51	ÕÑÑ½¹±•µ•¹Ðø¡¹Õ±°¤ì(€€¼¨¨(€€€¨ƒžâ»šRû¢"Ž3¢Žs–n{žâ»šRû¦ƒš"Cžj’ö7žžïŽ7–þ¦‚#šb¿–B3’â–âŸžº_–ë’úžj–B3’â–/–óŽ(€€€¨ƒ’æ/–&7žâ»šRû’ê“žÖ˜MLÑÉ…¹Í¥Ñ¥½»Ž’ö7žžï¢«–ÞÇš¾?’â–âŸ¢Žs¾ò3–§¦
+–Þ»’â–âœƒŠSŠP(€€€¨ƒ’ö7žžï¦?–>#¢Þš6Ë–.W’ö7žö»š"Cš¶š¾S¾ò#–>¿’î—–"Ã’âžfû–’hÁã¾ò'¾ò3¦Ë–ë¦g–/š¢‡–ò?–ÂÇšrš*[Ž(€€€¨ƒš&’î—–.WžV¯¢«–ÞÇ¢ÞG¾òkš¾?’â–âŸžº_–è¯¾ò3žâ»šRû¢"’ö7žžï’â¢Öß–¾¯¦Ë–B3’â–,ÑÉ…¹Í™½É·Ž(€€€¨¼(€€¼¨¨ƒžâ»šRû–.WžV¯¦
šÊKžÖCšv–&7¾ò3¢š[¢šë’â+’î7žÛžVÛ’ös–r£š:K¦‚¦v‹¾ò#š:—žâ¯Ž–’[š†Ž¦fÃ–öÇ¾ò$€¨¼(€½¹ÍÐmÁ…•ÍY¥ÍÕ…°°Í•ÑA…•ÍY¥ÍÕ…±t€ôÕÍ•MÑ…Ñ”¡™…±Í”¤ì(€½¹ÍÐÁ…•ÍY¥ÍÕ…±Q¥µ•ÉI•˜€ôÕÍ•I•˜ À¤ì(€½¹ÍÐ­I•˜€ôÕÍ•I•˜ Ä¤ì(€€¼¨¨ÍÉ½±±1•™Ðƒ–r ]•‰-¥Ðƒ–>«šr¢B÷–r£¦n‹šV–?žÒƒ¾òo’þwžVg’â7¢ÚÏ’â–?žÒƒžj–ÂûšVã¾ò3žR£žÒS–æÏžžï¢Žs–n{Ž(€€€€€ƒ¦g¢Þ–&×š?š.ó–r[žjÙ¥•ÝP¹Ñàƒ’âš¢¾ò3–>«¢Êƒ¢Ê³’ö7žö»¾ò3’â7–>¢"žâ»šRû¢"–'š~×–2[Ž€¨¼(€½¹ÍÐÍÑÉ¥ÁMÕ‰Á¥á•±aI•˜€ôÕÍ•I•˜ À¤ì(€½¹ÍÐ­¹¥µI•˜€ôÕÍ•I•˜ñì(€€€™É½´è¹Õµ‰•ÈìÑ¼è¹Õµ‰•ÈìÐÀè¹Õµ‰•Èì™É½µQ½Àè¹Õµ‰•ÈìÑ½Q½Àè¹Õµ‰•Èì(€ôð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐÍÑÉ¥ÁQ½ÁI•˜€ôÕÍ•I•˜ À¤ì(€½¹ÍÐÁ±ÕÍ5½Ñ¥½¹QÉ…¹Í¥Ñ¥½¹I•˜€ôÕÍ•I•˜ñì(€€€­¥¹è€•¹Ñ•Èœð€•á¥Ðœì™É½´è¹Õµ‰•ÈìÑ¼è¹Õµ‰•Èì(€ôð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐ±…ÍÑ5½Ñ¥½¹5½‘•I•˜€ôÕÍ•I•˜¡…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ¤ì(€½¹ÍÐµ½Ñ¥½¹5½‘•I•˜€ôÕÍ•I•˜¡…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ¤ì(€µ½Ñ¥½¹5½‘•I•˜¹ÕÉÉ•¹Ð€ô…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œì(€€¼¨¨ƒ–.WžV¯šr¦ZOžæ{¢F_–N«’â¦‚žâ»šRû¾ò#–ÂÇšb¿–.WžV¯¦Z/–ž/šf–s–r£žV¯¦v‹š¶’â·¦ZOžj¦
’â¦‚¾ò$€¨¼(€½¹ÍÐ­¹¡½ÉI•˜€ôÕÍ•I•˜ À¤ì(€½¹ÍÐÁÉ•ÙA…•ÍM…±•I•˜€ôÕÍ•I•˜¡Á…•ÍM…±”¤ì(€½¹ÍÐ½¹Ñ…¥¹•É]I•˜€ôÕÍ•I•˜ À¤ì(€½¹ÍÐÁ±ÕÍY¥Í¥‰±•I•˜€ôÕÍ•I•˜¡ÑÉÕ”¤ì(€Á±ÕÍY¥Í¥‰±•I•˜¹ÕÉÉ•¹Ð€ôÁ…•Ì¹±•¹Ñ €´€Ä€ð€ÈÐì((€€¼¨¨(€€€¨ƒšVÓš:K¦‚¦v‹–r£žâ»šRû–7ž:¬ƒ’æ/’â/¢¦Ëšr'žjž&#¦v‹Ž¨«–Âë–¾ãŽžVgžf÷Žš6Ë–.W’ö7žö»–£¦£žRÄ¬ƒžº_–ë’ú¨«¾ò0(€€€¨ƒ–.WžV¯š¾?’â–âŸ¦7žº_’âš²„ƒŠSŠPƒ¦gš¢žâ»šRûžj¦;ž¢/’â·ž&#¦v‹šr³¢ê¯šÂã¦ƒšb¿–Â7žj¾ò0(€€€¨ƒ’â7šr–?’î—–&7¦
š¢Ž3–’[šºóžj–’Ÿ–Â?–J3’ö7žö»žz³¦ZOš>oš"CšZÃžjŽ–>«šr'žâ»šRû–r£š‹š‹¢ÞGŽ7¾ò0(€€€¨ƒ’â¦Ë–:ïšVÓš:K–ÂÇ–#žz³žžï’âžfû–’hÁàƒ–7žâ»–Â?Ž(€€€¨¼(€½¹ÍÐ…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä€ôÕÍ•…±±‰…¬ ¡¬è¹Õµ‰•È°±¥Ù•QÉ…¹Í™½É´€ô™…±Í”¤€ôøì(€€€½¹ÍÐ¸€ô5…Ñ ¹µ…à Ä°Á…•Í½Õ¹ÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€½¹ÍÐÁÜ€ôÁÉ•Ù¥•Ý]I•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐÜ€ô½¹Ñ…¥¹•É]I•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐÍ¡•±°€ôÍÑÉ¥ÁM¡•±±I•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐ½°€ôÁ…•Í½±I•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐÁ…€ôÍÑÉ¥ÁA…‘I•˜¹ÕÉÉ•¹Ðì(€€€€¼¼ƒ¢Þ|ÍÑÉ¥Á=™™Í•Ðƒ–B3’âšŠw–ò?–¶C¾ò3’ö¦‚–¾³–>[¢¨É•˜ƒŠSŠPƒ¦gšR¿šb¼ÕÍ•…±±‰…¬¡mt§¾ò0(€€€€¼¼ƒžnÓš:—žR£–’[¦v‹žjÍÑÉ¥Á=™™Í•Ðƒšr’âžnÓšÊÿžR£ž²³’âš²„É•¹‘•Èƒ¦
šf–gžj¦‚–¾°(€€€½¹ÍÐ´€ô5…Ñ ¹µ…à ÄØ°€¡Ü€´ÁÜ€¨¬¤€¼€È¤ì(€€€¥˜€¡Í¡•±°¤ì(€€€€€Í¡•±°¹ÍÑå±”¹µ…É¥¹1•™Ð€ô€‘íµõÁá€ì(€€€€€Í¡•±°¹ÍÑå±”¹µ…É¥¹Q½À€ô€‘íÍÑÉ¥ÁQ½ÁI•˜¹ÕÉÉ•¹ÑõÁá€ì(€€€€€Í¡•±°¹ÍÑå±”¹Ý¥‘Ñ €ô€‘ì¡¸€¨ÁÜ€¬€¡¸€´€Ä¤¤€¨­õÁá€ì(€€€€€Í¡•±°¹ÍÑå±”¹¡•¥¡Ð€ô€‘íÁÉ•Ù¥•Ý!I•˜¹ÕÉÉ•¹Ð€¨­õÁá€ì(€€€ô(€€€€¼¼ƒ–>Ï¦
+–&o––÷žVg–"ÃŽ3šr–ú3’â¦‚–s–r£š¶’â·¦ZOŽ7ž
ëš¶‹¾òo–*ƒ¢fš2'¦"W–ÞËžÚO’öSš:$µ°´Ì€¬€ÐÀ(€€€¥˜€¡Á…¤Á…¹ÍÑå±”¹Ý¥‘Ñ €ô€‘í5…Ñ ¹µ…à À°´€´€¡Á±ÕÍY¥Í¥‰±•I•˜¹ÕÉÉ•¹Ð€ü€ÔÈ€è€À¤¥õÁá€ì(€€€¥˜€¡½°¤ì(€€€€€€¼¨M…™…É¤ƒ’â+’â7¢÷–r£š&/–.‹¦Z/–ž/¾ò?žÖCšvšfšZðé½½´ƒ¢"ÑÉ…¹Í™½É´ƒ’æ/¦ZO–"š>oŽ(€€€€€€€€ÑÉ…¹Í™½É´ƒšr–#š*+šVÓ¦‚–'š~×–2[š"C¢Êó–r[–7–>7¢š–>[š¢¾òo¦‚¦v‹’â+žjžÒÃ–¶_Ž–r[–ö‹¢"ž²›¢f|(€€€€€€€€ƒ–6Ï’öÿ’â·–þ–êŸš¢g–º3–£’â7–.W¾ò3¦
+žÞ’î7šr–?–r£–Þ›–>Ïš*[Ž–&×š?š.ó–r[’âžnÓšRçžV¯–âžj–¾›¦jl(€€€€€€€€ƒ¦†¿ž’ë–Âë–¾ãŽ’â7–k¢Êó–r[žâ»šRû¾òo¦g¢Ž‡žR£–:žR|é½½´ƒ–k–B3’â’îÛ’ê/¾ò3šVÓšº×š&/–.‹–>«’þwžVd(€€€€€€€€ƒ’â––_–êŸš¢g¢"–'š~×–2[šZç–ò?Ž€¨¼(€€€€€½¹ÍÐ¹…Ñ¥Ù•i½½´€ôÑåÁ•½˜ML€„ôô€Õ¹‘•™¥¹•œ€˜˜ML¹ÍÕÁÁ½ÉÑÌü¸ é½½´œ°€œÈœ¤ì(€€€€€½°¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä œ´µÁÉ•Ù¥•ÜµÍ…±”œ°MÑÉ¥¹œ¡¬¤¤ì(€€€€€€¼¨MYƒžj¹½¸µÍ…±¥¹œµÍÑÉ½­”ƒ–r ]•‰-¥Ð¹…Ñ¥Ù”é½½´ƒ’â/’î7’òk¢Š¬é½½´ƒšRû–’ŸŽ(€€€€€€€€ƒš¾?–âŸš*+–â–Æš‚óžêÿžj––ºçžêÿ–º÷–>7–BG¦f“š:$¯¾ò3šržî#¢B÷–"Ã–Æ?–æWšÂã¢þsšb¼€ÅÁãŽ€¨¼(€€€€€½°¹ÍÑå±”¹Í•ÑAÉ½Á•ÉÑä œ´µ±…å½ÕÐµÉ¥µÍÑÉ½­”œ°€‘ìÄ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°¬¥õÁá€¤ì(€€€€€¥˜€¡¹…Ñ¥Ù•i½½´¤ì(€€€€€€€€¡½°¹ÍÑå±”…Ì…¹ä¤¹é½½´€ôMÑÉ¥¹œ¡¬¤ì(€€€€€€€½¹ÍÐÍÕˆ€ôÍÑÉ¥ÁMÕ‰Á¥á•±aI•˜¹ÕÉÉ•¹Ðì(€€€€€€€½°¹ÍÑå±”¹ÑÉ…¹Í™½É´€ô5…Ñ ¹…‰Ì¡ÍÕˆ¤€ø€À¸ÀÀÀÄ€üÑÉ…¹Í±…Ñ”Í ‘íÍÕ‰õÁà°€À°€À¥€€è€œœì(€€€€€€€½°¹ÍÑå±”¹Ý¥±±¡…¹”€ô€œœì(€€€€€ô•±Í”ì(€€€€€€€€¡½°¹ÍÑå±”…Ì…¹ä¤¹é½½´€ô€œœì(€€€€€€€½°¹ÍÑå±”¹ÑÉ…¹Í™½É´€ô¬€ôôô€Ä€ü€œœ€èÍ…±” ‘í­ô¥€ì(€€€€€€€½°¹ÍÑå±”¹ÑÉ…¹Í™½Éµ=É¥¥¸€ô€œÀ€Àœì(€€€€€€€½°¹ÍÑå±”¹Ý¥±±¡…¹”€ô±¥Ù•QÉ…¹Í™½É´€ü€ÑÉ…¹Í™½É´œ€è€œœì(€€€€€ô(€€€€€€¼¨ƒ–në–ºk–r£¢B“–æW–vCš‚–Æžjž¦ëš‚óš>Cž’ëšRÛ–"Ã¦kž~—–B;š&7¦?’â·–þž
çŽ(€€€€€€€€ƒ’ê/’îÛ–>«š:K’â’â¨É¾ò3’â7–r£š&/–*ÿ–’žB––B3š¶—¢¾ï–>[ž&#¦v‹Ž€¨¼(€€€€€½°¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡¹•ÜÙ•¹Ð …‰…¤µÁÉ•Ù¥•ÜµÑÉ…¹Í™½É´œ¤¤ì(€€€ô(€ô°mt¤ì((€€¼¼ƒ¢š–r£Ž3š*+ž&#¦v‹¢Êóš"Cžn»š¢g–7ž:Ž7¦
–,ÕÍ•1…å½ÕÑ™™•Ðƒ’æ/–&7–#š*+–.WžV¯š:K––÷¾ò0(€€¼¼ƒ’â7žÛž&#¦v‹šr–#’âš¶—¢ÞÏ–"Ãžn»š¢g–ó¾ò3–.WžV¯–ÂÇšVÓšº×¢Š¯¢ÞÏ¦;’ê(€ÕÍ•1…å½ÕÑ™™•Ð  ¤€ôøì(€€€½¹ÍÐÁÉ•Ø€ôÁÉ•ÙA…•ÍM…±•I•˜¹ÕÉÉ•¹Ðì(€€€ÁÉ•ÙA…•ÍM…±•I•˜¹ÕÉÉ•¹Ð€ôÁ…•ÍM…±”ì(€€€½¹ÍÐ¹½Ý5½Ñ¥½¸€ô…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œì(€€€¥˜€¡¹½Ý5½Ñ¥½¸€„ôô±…ÍÑ5½Ñ¥½¹5½‘•I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€Á±ÕÍ5½Ñ¥½¹QÉ…¹Í¥Ñ¥½¹I•˜¹ÕÉÉ•¹Ð€ôì(€€€€€€€­¥¹è¹½Ý5½Ñ¥½¸€ü€•¹Ñ•Èœ€è€•á¥Ðœ°™É½´è­I•˜¹ÕÉÉ•¹Ð°Ñ¼èÁ…•ÍM…±”°(€€€€€ôì(€€€€€±…ÍÑ5½Ñ¥½¹5½‘•I•˜¹ÕÉÉ•¹Ð€ô¹½Ý5½Ñ¥½¸ì(€€€ô(€€€€¼¨ƒ–Þ—’ös–6–në–ºk’öÿžR Ñ½Àƒ–Â7¦ö+¾òo’â¢"³¦‚¦v‹žj–zžnÓžö»’â·šRçžRÇ–B3’âšŠtÉƒ–æû’öW–.WžV¬(€€€€€€ƒžº_–ëŽ¢"+ž&#–r£¦–ë–.WžV¯¦‚žjž²³’â–æžnÓš:—š*(™±•àƒ–úx¥Ñ•µÌµÍÑ…ÉÐƒ–"š"@(€€€€€€¥Ñ•µÌµ•¹Ñ•Ë¾ò3žV¯¦v‹šr–#–ú’â/¢ÞÏ¾ò3–7’â¦
+šRû–’Ÿ’â¦
+–ú–n{¢ÖÃŽ€¨¼(€€€€¼¨ƒ’â¢"³š¢‡–ò?šÂã¦ƒ’î—–Þ—’ös–6žj–zžnÓ’â·–þžâ»šRûŽ¦g¢Ž‡’â7¢÷š*+¢Êƒ–ó–’ûš"@€Ã¾òh(€€€€€€ƒšRû–’Ÿ–"Ã¦®cšZó–Þ—’ös–6šf¾ò3–’ûš"@€Àƒšrš*+’â+žÞ¦cš¶ï¾ò3¢š[¢šë’â+–ÂÇ’â7šb¿’â·–þšRû–’ŸŽ€¨¼(€€€½¹ÍÐÑ…É•ÑQ½À€ô¹½Ý5½Ñ¥½¸€ü€À€è(€€€€€€¡½¹Ñ…¥¹•ÉM¥é”¹¡•¥¡Ð€´ÁÉ•Ù¥•Ý!I•˜¹ÕÉÉ•¹Ð€¨Á…•ÍM…±”¤€¼€Èì(€€€¥˜€¡5…Ñ ¹…‰Ì¡­I•˜¹ÕÉÉ•¹Ð€´Á…•ÍM…±”¤€ð€À¸ÀÀÀÄ(€€€€€€€€˜˜5…Ñ ¹…‰Ì¡ÍÑÉ¥ÁQ½ÁI•˜¹ÕÉÉ•¹Ð€´Ñ…É•ÑQ½À¤€ð€¸ÀÄ¤ì(€€€€€€¼¨ƒš&/–.‹žÖCšvžjÍ•ÑUÍ•Éi½½´ƒšr¢ºLI•…Ðƒ–4½µµ¥Ðƒ’âš²‡Ž	M…™…É¤ƒ–r£¦
š²„½µµ¥Ð(€€€€€€€€ƒšrš*+š&/–.‹šr¦ZOžnÓš:—–¾¯–—žj¢Ê€µ…É¥¸µÑ½Àƒšâš"@€Ã¾òmÉ•˜ƒ’î7šb¿š¶žŠë–ó¾ò3¢"+¦
?¢ò¼(€€€€€€€€ƒ–6ï–nƒš¶“š>Cš^¤É•ÑÕÉ»¾ò3žV¯–â’úÿžz³¦ZO¢ÞÏ–n{¦‚¦£–º'–£¢Þw¦n‹Ž–6Ï’öÿšVã–óžnã–B3’æ¢šš*((€€€€€€€€ƒ–æû’öW¦7šZÃ¢Êó–nx=7¾ò3¦²š&/–&7–ú3š&7šršb¿–º3–£–B3’â–æ’ö7žö»Ž€¨¼(€€€€€­I•˜¹ÕÉÉ•¹Ð€ôÁ…•ÍM…±”ì(€€€€€ÍÑÉ¥ÁQ½ÁI•˜¹ÕÉÉ•¹Ð€ôÑ…É•ÑQ½Àì(€€€€€…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡Á…•ÍM…±”°™…±Í”¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€€¼¨ƒ¢¢c’â/–.WžV¯¦Z/–ž/šfŽ3žV¯¦v‹š¶’â·–’»–Â7–"Ãžj¦
–/–Ÿ–ºç–êŸš¢gŽ7¾ò#šr«žâ»šRû–Z»’ö7¾ò'¾ò0(€€€€€€ƒšVÓšº×–.WžV¯¦÷š*+–B3’â–/–êŸš¢gšNë–n{š¶’â·–’¸ƒŠSŠPƒ’æ–ÂÇšb¿–:–rÃžâ»šRûŽ(€€€€€€ƒ’î—–&7¢¢cžjšb¿Ž3šrš:—¢þG’â·–’»žj¦
’â¦‚Ž7–7š*+¦
’â¦‚šNë–"Ãš¶’â·¦ZO¾òk–>«¢š’â·–þ(€€€€€€ƒ’â7šb¿–&o––÷¢B÷–r£š~C’â¦‚š¶’â·–’»¾ò3ž²³’â–âŸ–ÂÇšr¢Š¯ž†³š.'¦;–:ï¾ò3¦
–ÂÇšb¿Ž3’â¦Z/–ž/–ÂÇ¢ÞÏŽ7Ž€¨¼(€€€½¹ÍÐ•°€ô½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€¥˜€¡•°€˜˜½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ €ø€À¤ì(€€€€€­¹¡½ÉI•˜¹ÕÉÉ•¹Ð€ô(€€€€€€€€¡•°¹ÍÉ½±±1•™Ð€¬½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ €¼€È€´ÍÑÉ¥Á=™™Í•Ð¡½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ °ÁÉ•Ø¤¤€¼€¡ÁÉ•Øñð€Ä¤ì(€€€ô•±Í”ì(€€€€€­¹¡½ÉI•˜¹ÕÉÉ•¹Ð€ô€Àì(€€€ô(€€€­¹¥µI•˜¹ÕÉÉ•¹Ð€ôì(€€€€€™É½´è­I•˜¹ÕÉÉ•¹Ð°Ñ¼èÁ…•ÍM…±”°ÐÀèÁ•É™½Éµ…¹”¹¹½Ü ¤°(€€€€€™É½µQ½ÀèÍÑÉ¥ÁQ½ÁI•˜¹ÕÉÉ•¹Ð°Ñ½Q½ÀèÑ…É•ÑQ½À°(€€€ôì(€€€€¼¼ƒžâ»šRû–.WžV¯¦
–r£¢ÞGžjšf–g¾ò3žÚ·š2š:K¦‚¦v‹žjš¢–¶C¾ò#š:—žâ¯Ž–’[š†Ž¦fÃ–öÇ¦÷–#’â7¢š–n{’ú¾ò'¾ò0(€€€€¼¼ƒ’â7žÛ¦–ëžjžz³¦ZOšr–#¦Z’âš:KžÞkšŠw–7žâ»–n{–:ì(€€€Í•ÑA…•ÍY¥ÍÕ…°¡ÑÉÕ”¤ì(€€€Ý¥¹‘½Ü¹±•…ÉQ¥µ•½ÕÐ¡Á…•ÍY¥ÍÕ…±Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì(€€€Á…•ÍY¥ÍÕ…±Q¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ôÝ¥¹‘½Ü¹Í•ÑQ¥µ•½ÕÐ  ¤€ôøÍ•ÑA…•ÍY¥ÍÕ…°¡Á…•Í5½‘•I•˜¹ÕÉÉ•¹Ð¤°€ÌÐÀ¤ì(€ô°mÁ…•ÍM…±”°…Ñ¥Ù•Q…‰t¤ì((€€¼¨¨(€€€¨ƒš*+š>‡š*+¾ò?–"«¦f“¦6×¾ò?–*ƒ¢f¢Êó–"Ãžn»–&7žjš6Ë–.W’ö7žö»’â+Ž(€€€¨ƒ¦f“’êš¾?’â–âŸ¢ÞG’âš²‡¾ò3š&/–.Wš6Ë¦‚šfŽ3–¾¯–º0ÍÉ½±±1•™Ðƒž®/–"ïŽ7’æ¢š–7¢ÞG’âš²„ƒŠSŠP(€€€¨ƒ¦‚¦v‹šb¿¢Š¬ÍÉ½±±1•™ÐƒžnÓš:—–âÛ¢F_¢ÖÃžj¾ò3š2'¦"Wšb¼ÑÉ…¹Í™½É·¾ò0(€€€¨ƒ–§¢’â7–r£–B3’â–âŸ–¾¯–ÂÇšr–Þ»’â–âŸ¾ò3žr/¢Öß’ú–ÂÇšb¿š2'¦"W¢Þ’â7’â+¦‚¦v‹Ž(€€€¨¼(€½¹ÍÐÁ½Í¥Ñ¥½¹A…•Ñ±Ì€ôÕÍ•…±±‰…¬  ¤€ôøì(€€€½¹ÍÐ¬€ô­I•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐ½¹Ð€ô½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐ½°€ôÁ…•Í½±I•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …½¹Ðñð€…½°¤É•ÑÕÉ¸ì(€€€½¹ÍÐÉŒ€ô½¹Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€½¹ÍÐÉ½½ÑI•Ð€ôÉ¥‘I½½ÑI•˜¹ÕÉÉ•¹Ðü¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€½¹ÍÐÉ½½Ñ1•™Ð€ôÉ½½ÑI•Ðü¹±•™Ðñð€Àì(€€€½¹ÍÐÉ½½ÑQ½À€ôÉ½½ÑI•Ðü¹Ñ½Àñð€Àì(€€€½¹ÍÐ½±I•Ð€ô½°¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€½¹ÍÐ´€ôÁ…ÉÍ•±½…Ð ¡½°¹Á…É•¹Ñ±•µ•¹Ð…Ì!Q51±•µ•¹Ð¤¹ÍÑå±”¹µ…É¥¹1•™Ð¤ñð€Àì(€€€½¹ÍÐÍÑÉ¥‘”€ôÁÉ•Ù¥•Ý]I•˜¹ÕÉÉ•¹Ð€¬€Äì(€€€€¼¼ƒ¦g¢Ž‡š.ÿ–"Ãžjšb¿Ž3¦
’â¦‚šÊK¢Š¯š.[¢ÖÃšfŽ7¢¦Ë–r£žj’ö7žö»Ž(€€€€¼¼ƒ’â7–:ï¦?¦‚š†šr³¢ê¯¾òk¦‚š†š.[šnÏšfšr¢Š¯žžï¢ÖÃŽ¦
šršRû–’Ÿ¾ò3¦?–ºšrš*+’ö7žžïžº_–§š²‡Ž(€€€½¹ÍÐ±•™ÐÀ€ôÉŒ¹±•™Ð€´½¹Ð¹ÍÉ½±±1•™Ð€¬´ì(€€€½¹ÍÐ‰½ÑÑ½´€ô½±I•Ð¹Ñ½À€¬¬€¨ÁÉ•Ù¥•Ý!I•˜¹ÕÉÉ•¹Ðì(€€€Á…•Ñ±I•™Ì¹ÕÉÉ•¹Ð¹™½É…  ¡¹½‘”°¥¤€ôøì(€€€€€½¹ÍÐ¤€ôÁ…•ÍI•˜¹ÕÉÉ•¹Ð¹™¥¹‘%¹‘•à¡Áœ€ôøÁœ¹¥€ôôô¥¤ì(€€€€€¥˜€¡¤€ð€À¤É•ÑÕÉ¸ì(€€€€€¹½‘”¹ÍÑå±”¹ÑÉ…¹Í™½É´€ô(€€€€€€€€¼¨ƒ’â;’â“’â«žÃ¢&Ëš2'¦J»–öóš¶“žj…À´Ä¸Ôƒ–º3–£žnã–B3¾òk¦†×¦v‹’â/žòc–"Ãš2'¦J»’æšb¼€ÙÁãŽ€¨¼(€€€€€€€ÑÉ…¹Í±…Ñ”Í ‘í±•™ÐÀ€¬¬€¨€¡¤€¨ÍÑÉ¥‘”€¬ÁÉ•Ù¥•Ý]I•˜¹ÕÉÉ•¹Ð€¼€È¤€´É½½Ñ1•™ÑõÁà°€‘í‰½ÑÑ½´€¬€Ø€´É½½ÑQ½ÁõÁà°€À¤ÑÉ…¹Í±…Ñ•` ´ÔÀ”¥€ì(€€€€€¹½‘”¹ÍÑå±”¹Ù¥Í¥‰¥±¥Ñä€ô€Ù¥Í¥‰±”œì(€€€ô¤ì(€€€€¼¨ƒ–"–&ËžÞkšRû–r£žâ»šRû–ºç–f£–’[¾ò3’î—žr–¾›¢z‹–æT€ÅÁàƒžæ«¢Ž÷Ž¢.—žVg–r ½°ƒ¢Ž‡–7žR£–>7–BD(€€€€€€Ý¥‘Ñ ƒš*×¦*Üé½½·¾ò1]•‰-¥Ðƒ’î7šr–r£žnã¦Ã–æ–k’â7–B3žjš²‡–?žÒƒ–>[šVÓ¾ò3¢š[¢šë’â+–ÂÇšr(€€€€€€ƒ–þ÷žÊ_–þ÷žÒÃžRk¢Ï¦Z–.WŽ¦g–Æ“–>«¢þ÷¢æ“š:—žâ¯’â·–þ¢"¦‚¦v‹–¾›¦jo¦®c–ê›Ž€¨¼(€€€Í•…µ=Ù•É±…åI•™Ì¹ÕÉÉ•¹Ð¹™½É…  ¡¹½‘”°¥¤€ôøì(€€€€€½¹ÍÐ¤€ôÁ…•ÍI•˜¹ÕÉÉ•¹Ð¹™¥¹‘%¹‘•à¡Áœ€ôøÁœ¹¥€ôôô¥¤ì(€€€€€¥˜€¡¤€ðô€À¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐÍ•…µ•¹Ñ•È€ô½±I•Ð¹±•™Ð€¬¬€¨€¡¤€¨ÍÑÉ¥‘”€´€À¸Ô¤ì(€€€€€¹½‘”¹ÍÑå±”¹ÑÉ…¹Í™½É´€ô(€€€€€€€ÑÉ…¹Í±…Ñ”Í ‘íÍ•…µ•¹Ñ•È€´É½½Ñ1•™Ð€´€À¸ÕõÁà°€‘í½±I•Ð¹Ñ½À€´É½½ÑQ½À€´€À¸ÕõÁà°€À¥€ì(€€€€€¹½‘”¹ÍÑå±”¹¡•¥¡Ð€ô€‘í½±I•Ð¹¡•¥¡Ð€¬€ÅõÁá€ì(€€€€€¹½‘”¹ÍÑå±”¹Ù¥Í¥‰¥±¥Ñä€ô•µ‰•‘‘•‘M•…µÍI•˜¹ÕÉÉ•¹Ð€ü€¡¥‘‘•¸œ€è€Ù¥Í¥‰±”œì(€€€ô¤ì(€€€€¼¼ƒŽ3šZÃ–Š{’â¦‚Ž7¢Êó–r£šr–ú3’â¦‚–:šr³žj’ö7žö»š^¦
(ƒŠSŠPƒžR£žº_žj¾ò3š&7’â7šr¢Š¯š.[šnÏ’â·žj(€€€€¼¼ƒšr–ú3’â¦‚š.[¢F_¢ÞG¾ò#žr/¢Öß’ú–?¢Þ¦
’â¦‚¦î?–r£’â¢Öß¾ò$(€€€½¹ÍÐÁ±ÕÌ€ô…‘‘A…•	Ñ¹I•˜¹ÕÉÉ•¹Ðì(€€€¥˜€¡Á±ÕÌ¤ì(€€€€€½¹ÍÐÑÉ…¹Í¥Ñ¥½¸€ôÁ±ÕÍ5½Ñ¥½¹QÉ…¹Í¥Ñ¥½¹I•˜¹ÕÉÉ•¹Ðì(€€€€€±•Ð…±Á¡„€ôµ½Ñ¥½¹5½‘•I•˜¹ÕÉÉ•¹Ð€ü€À€è€Äì(€€€€€¥˜€¡ÑÉ…¹Í¥Ñ¥½¸€˜˜­¹¥µI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€½¹ÍÐÍÁ…¸€ôÑÉ…¹Í¥Ñ¥½¸¹Ñ¼€´ÑÉ…¹Í¥Ñ¥½¸¹™É½´ì(€€€€€€€½¹ÍÐÁÉ½É•ÍÌ€ô5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Ä°(€€€€€€€€€5…Ñ ¹…‰Ì¡ÍÁ…¸¤€ð€Å”´Ô€ü€Ä€è€¡¬€´ÑÉ…¹Í¥Ñ¥½¸¹™É½´¤€¼ÍÁ…¸¤¤ì(€€€€€€€…±Á¡„€ôÑÉ…¹Í¥Ñ¥½¸¹­¥¹€ôôô€•¹Ñ•Èœ€ü€Ä€´ÁÉ½É•ÍÌ€èÁÉ½É•ÍÌì(€€€€€ô(€€€€€½¹ÍÐ…¹¥µ…Ñ•]¥Ñ¡AÉ•Ù¥•Ü€ô€„…ÑÉ…¹Í¥Ñ¥½¸ñðµ½Ñ¥½¹5½‘•I•˜¹ÕÉÉ•¹Ðì(€€€€€½¹ÍÐÁ±ÕÍM…±”€ô…¹¥µ…Ñ•]¥Ñ¡AÉ•Ù¥•Ü€ü¬€è€Äì(€€€€€€¼¨`ƒ–º3–£’ê“¦
™±•àƒž&#¦v‹¾òk–*ƒ¢fšÂã¦ƒ¢«žÛš:—–r£šr–ú3’â¦‚–>Ï–Ó¾ò3’â7–7šZó’â¢"³š¢‡–ò<(€€€€€€€€ƒ–>›–’[žº_’âžÖ¢z‹–æW–êŸš¢gŽ–’[šºó–¾³–ê›šr³’ú–ÂÇ¦C–æ¢Þ¢F\¬ƒšRç¢º+¾ò3–nƒš¶“¦Ë¦–.WžV¯šf(€€€€€€€€ƒ–º’î7šr–æÏ¦‚¢Þ¢F_šr–ú3’â¦‚žžï–.W¾òo¦g¢Ž‡–>«¢Žs’â+–zžnÓžö»’â·¢"ž¶'š¾S’ú/žâ»šRûŽ€¨¼(€€€€€½¹ÍÐÁ…É•¹Ð€ôÁ±ÕÌ¹½™™Í•ÑA…É•¹Ð…Ì!Q51±•µ•¹Ðð¹Õ±°ì(€€€€€½¹ÍÐÁ…É•¹ÑI•Ð€ôÁ…É•¹Ðü¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€€¥˜€¡Á…É•¹ÑI•Ð¤ì(€€€€€€€½¹ÍÐ‰…Í•ä€ôÁ…É•¹ÑI•Ð¹Ñ½À€¬Á±ÕÌ¹½™™Í•ÑQ½À€¬Á±ÕÌ¹½™™Í•Ñ!•¥¡Ð€¼€Èì(€€€€€€€½¹ÍÐÝ…¹Ñä€ô½±I•Ð¹Ñ½À€¬¬€¨ÁÉ•Ù¥•Ý!I•˜¹ÕÉÉ•¹Ð€¼€Èì(€€€€€€€Á±ÕÌ¹ÍÑå±”¹ÑÉ…¹Í™½É´€ôÑÉ…¹Í±…Ñ”Í À°€‘íÝ…¹Ñä€´‰…Í•åõÁà°€À¤Í…±” ‘íÁ±ÕÍM…±•ô¥€ì(€€€€€ô(€€€€€Á±ÕÌ¹ÍÑå±”¹½Á…¥Ñä€ô€‘í…±Á¡…õ€ì(€€€€€Á±ÕÌ¹ÍÑå±”¹Á½¥¹Ñ•ÉÙ•¹ÑÌ€ô…±Á¡„€ø€¸äà€ü€…ÕÑ¼œ€è€¹½¹”œì(€€€€€Á±ÕÌ¹ÍÑå±”¹Ù¥Í¥‰¥±¥Ñä€ô€Ù¥Í¥‰±”œì(€€€€€Á±ÕÌ¹ÍÑå±”¹ÑÉ…¹Í¥Ñ¥½¸€ô€¹½¹”œì(€€€ô(€ô°mt¤ì((€€¼¨ƒ¦'’â·¾ò?–>[šÚ#¦'’â·’â;š.[¢Öß¾ò?šRû’â/¦†×¦v‹š^Û¾ò3ž®/–6Ï–r£–’[–Æ–në–ºkžêÿ–J3––Æžêÿ’æ/¦^Ó’ê“šŽKŽ€¨¼(€ÕÍ•1…å½ÕÑ™™•Ð  ¤€ôøì(€€€Á½Í¥Ñ¥½¹A…•Ñ±Ì ¤ì(€ô°m•µ‰•‘‘•‘M•…µÌ°Á½Í¥Ñ¥½¹A…•Ñ±Ít¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€±•ÐÉ…˜€ô€Àì(€€€½¹ÍÐÑ¥¬€ô€ ¤€ôøì(€€€€€½¹ÍÐ…¹¥´€ô­¹¥µI•˜¹ÕÉÉ•¹Ðì(€€€€€¥˜€¡…¹¥´¤ì(€€€€€€€½¹ÍÐÐ€ô5…Ñ ¹µ¥¸ Ä°€¡Á•É™½Éµ…¹”¹¹½Ü ¤€´…¹¥´¹ÐÀ¤€¼€ÌÀÀ¤ì(€€€€€€€½¹ÍÐ•…Í•€ô€Ä€´5…Ñ ¹Á½Ü Ä€´Ð°€Ì¤ì(€€€€€€€­I•˜¹ÕÉÉ•¹Ð€ô…¹¥´¹™É½´€¬€¡…¹¥´¹Ñ¼€´…¹¥´¹™É½´¤€¨•…Í•ì(€€€€€€€ÍÑÉ¥ÁQ½ÁI•˜¹ÕÉÉ•¹Ð€ô…¹¥´¹™É½µQ½À€¬€¡…¹¥´¹Ñ½Q½À€´…¹¥´¹™É½µQ½À¤€¨•…Í•ì(€€€€€€€¥˜€¡Ð€øô€Ä¤ì(€€€€€€€€€­I•˜¹ÕÉÉ•¹Ð€ô…¹¥´¹Ñ¼ì(€€€€€€€€€­¹¥µI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€€€Á±ÕÍ5½Ñ¥½¹QÉ…¹Í¥Ñ¥½¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€ô(€€€€€ô(€€€€€½¹ÍÐ¬€ô­I•˜¹ÕÉÉ•¹Ðì(€€€€€€¼¼ƒž&#¦v‹¾ò#–’[šºó–Âë–¾ãŽ–Þ›–>ÏžVgžf÷Žžâ»šRû¾ò'–£¦£žRÇ¦g’â–âŸžj¬ƒžº_–ë’ú¾ò0(€€€€€€¼¼ƒš6Ë–.W–æû’öWšÂã¦ƒ¢Þžr/–"Ãžj–’Ÿ–Â?’â¢Ó¾òkš6È€ÅÁàƒžV¯¦v‹–ÂÇ¢ÖÀ€ÅÁà(€€€€€…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡¬°€„……¹¥´¤ì(€€€€€¥˜€¡…¹¥´¤ì(€€€€€€€€¼¼ƒ–#–¾¯–º3–Âë–¾ã¾ò!ÍÉ½±±]¥‘Ñ ƒš&7šb¿–Â7žj¾ò'–7–¾¯š6Ë–.W’ö7žö»¾ò0(€€€€€€€€¼¼ƒ¢ºOŽ3–.WžV¯¦Z/–ž/šf–s–r£’â·¦ZOžj¦
’â¦‚Ž7šVÓšº×¦÷–ú–r£š¶’â·¦ZL(€€€€€€€½¹ÍÐ½¹Ð€ô½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€€€€€½¹ÍÐÜ€ô½¹Ñ…¥¹•É]I•˜¹ÕÉÉ•¹Ðì(€€€€€€€¥˜€¡½¹Ð€˜˜Ü€ø€À¤ì(€€€€€€€€€€¼¼ƒ–B3š¢žR É•˜ƒž&#žj¦‚–¾³¾ò#¦g–/¢þÓ–r#’â7¢Þ¢F_š¾?š²„É•¹‘•Èƒ¦7š:o¾ò$(€€€€€€€€€½¹ÍÐÁÜ€ôÁÉ•Ù¥•Ý]I•˜¹ÕÉÉ•¹Ðì(€€€€€€€€€½¹ÍÐ´€ô5…Ñ ¹µ…à ÄØ°€¡Ü€´ÁÜ€¨¬¤€¼€È¤ì(€€€€€€€€€€¼¼­¹¡½ÉI•˜ƒ–¶cžjšb¿Ž3–Ÿ–ºç–êŸš¢gŽ7¾ò3’æc’â+žVÛ’â/–7ž:–ÂÇšb¿–ºž>û–r£žj’ö7žö¸(€€€€€€€€€½¹ÍÐ‘•Í¥É•€ô5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ (€€€€€€€€€€€5…Ñ ¹µ…à À°½¹Ð¹ÍÉ½±±]¥‘Ñ €´½¹Ð¹±¥•¹Ñ]¥‘Ñ ¤°(€€€€€€€€€€€´€¬­¹¡½ÉI•˜¹ÕÉÉ•¹Ð€¨¬€´Ü€¼€È°(€€€€€€€€€€¤¤ì(€€€€€€€€€½¹Ð¹ÍÉ½±±1•™Ð€ô‘•Í¥É•ì(€€€€€€€€€€¼¨ƒ¦Ë¾ò?–ë–.WžV¯¦‚’æ¢Žs–nx]•‰-¥ÐÍÉ½±±1•™Ðƒžjš²‡–?žÒƒ–>[šVÓ¢ª“–Þ»Ž’æ/–&7–>«šr$(€€€€€€€€€€€€ƒš&/–.‹žâ»šRû–k¦g’îÛ’ê/¾ò3š&’î—¦–ëšf¦‚¦v‹šRû–’Ÿžjš¾?–æšr–Þ›–>Ï¢ÞÏžÒ€ÅÁãŽ€¨¼(€€€€€€€€€½¹ÍÐ…ÑÕ…°€ô½¹Ð¹ÍÉ½±±1•™Ðì(€€€€€€€€€ÍÑÉ¥ÁMÕ‰Á¥á•±aI•˜¹ÕÉÉ•¹Ð€ô€¡…ÑÕ…°€´‘•Í¥É•¤€¼5…Ñ ¹µ…à ¸ÀÀÀÄ°¬¤ì(€€€€€€€€€½¹ÍÐ½°€ôÁ…•Í½±I•˜¹ÕÉÉ•¹Ðì(€€€€€€€€€¥˜€¡½°¤ì(€€€€€€€€€€€½¹ÍÐÍÕˆ€ôÍÑÉ¥ÁMÕ‰Á¥á•±aI•˜¹ÕÉÉ•¹Ðì(€€€€€€€€€€€½°¹ÍÑå±”¹ÑÉ…¹Í™½É´€ô5…Ñ ¹…‰Ì¡ÍÕˆ¤€ø€¸ÀÀÀÄ€üÑÉ…¹Í±…Ñ”Í ‘íÍÕ‰õÁà°€À°€À¥€€è€œœì(€€€€€€€€€ô(€€€€€€€ô(€€€€€ô(€€€€€€¼¼ƒ–’[–Æ“¾ò#¢Êó–r£¦‚š†š¶’â/šZç¾ò'žRÇ¦g¢Ž‡š¾?’â–âŸ–ºk’ö4ƒŠSŠPƒ¦‚š†–r£š:K¦‚¦v‹šfšb¿’â7–.Wžj¾ò0(€€€€€€¼¼ƒš&’î—¦g–Æ“–>«¢Þš6Ë–.W¢"š¢‡–ò?–.WžV¯šr'¦^sŽš.[šnÏžj’ö7žžïšRû–r£Ž3–Ÿ–Æ“Ž7ŽžRÄI•…Ð(€€€€€€¼¼ƒ¢Þ–Ÿ–ºçžR£–B3’âš²„É•¹‘•Èƒ–¾¯–ë’ú¾ò3–§¦
+šÂã¦ƒ–B3’â–âŸŽ¦–ê›’â7–>¿¢÷’â7’âš¢Ž(€€€€€Á½Í¥Ñ¥½¹A…•Ñ±Ì ¤ì(€€€€€€¼¼ƒ¦n‹¦Z/¦g–/š¢‡–ò?–ú3¦
¢š–7¢ÞG–"Ã–.WžV¯žÖCšv¾ò3’ö7žžïš&7šr'švÇ¢–ÿ¢Žp(€€€€€€¼¨ƒ–:šr³šb¿–¾¯š¶ïžj¬€ôôô€Ç¾òošr'’ê’öÿžR£¢žâ»šRû’æ/–ú3¾ò3žn»š¢g–ó’â7’â–ºkšb¼€Ç¾ò0(€€€€€€€€ƒšRçš"CŽ3šÊKšr'–.WžV¯Ž¢3’âS–ÞËžÚO–"Ã¦Sžn»š¢g–7ž:Ž7–ÂÇšRÛ–Þ—¾ò3’â7šr’âžnÓž¦ë¢ö'Ž€¨¼(€€€€€¥˜€ …Á…•Í5½‘”€˜˜€…­¹¥µI•˜¹ÕÉÉ•¹Ð€˜˜5…Ñ ¹…‰Ì¡¬€´Á…•ÍM…±”¤€ð€À¸ÀÀÀÄ¤É•ÑÕÉ¸ì(€€€€€É…˜€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡Ñ¥¬¤ì(€€€ôì(€€€É…˜€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡Ñ¥¬¤ì(€€€É•ÑÕÉ¸€ ¤€ôø…¹•±¹¥µ…Ñ¥½¹É…µ”¡É…˜¤ì(€ô°mÁ…•Í5½‘”°Á…•ÍM…±”°Á½Í¥Ñ¥½¹A…•Ñ±Ì°…ÁÁ±åMÑÉ¥Á•½µ•ÑÉåt¤ì((€€¼¼ƒ¦Ë–"Ãšþû¦>‡–"¦‚š&7–r£¢3šf¿š*+šþû¦>‡’â–/’â–/¢ò'¦Ë’ú¾ò3¢ò'––÷’â–/–ÂÇ¦7žV¯’âš²„(€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€¡…Ñ¥Ù•Q…ˆ€„ôô€…‘©ÕÍÐœñð…‘©ÕÍÑMÕˆ€„ôô€™¥±Ñ•Èœ¤É•ÑÕÉ¸ì(€€€±•Ð…±¥Ù”€ôÑÉÕ”ì(€€€€¡…Íå¹Œ€ ¤€ôøì(€€€€€™½È€¡½¹ÍÐ°½˜±ÕÑ1¥ÍÐ¤ì(€€€€€€€¥˜€ ……±¥Ù”¤É•ÑÕÉ¸ì(€€€€€€€¥˜€ …°¹ÕÉ°ñð•Ñ1½…‘•‘1ÕÐ¡°¹¥¤¤½¹Ñ¥¹Õ”ì(€€€€€€€…Ý…¥Ð±½…‘1ÕÐ¡°¹¥°°¹ÕÉ°¤ì(€€€€€€€¥˜€ ……±¥Ù”¤É•ÑÕÉ¸ì(€€€€€€€Í•Ñ1ÕÑI•Ù¥Í¥½¸¡¸€ôø¸€¬€Ä¤ì(€€€€€ô(€€€ô¤ ¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì…±¥Ù”€ô™…±Í”ìôì(€ô°m…Ñ¥Ù•Q…ˆ°…‘©ÕÍÑMÕˆ°±ÕÑ1¥ÍÑt¤ì((€½¹ÍÐm±…å½ÕÑMÕ‰Q…ˆ°Í•Ñ1…å½ÕÑMÕ‰Q…‰t€ôÕÍ•MÑ…Ñ”ð±…å½ÕÐœð€…‘©ÕÍÐœø ±…å½ÕÐœ¤ì(€€¼¨¨ƒŽ3šZÃ–Š{Ž7–"¦‚¾òiÉ½½Ó¾òw’â'¦†–’Ÿš2'¦"W¾ò1Í¡…Á—¾òw¦î{¦ËŽ3šZÃ–Š{–r[–ö‹Ž7’æ/–ú3žj–r[š†#šâ–Z¸€¨¼(€½¹ÍÐm…‘‘MÕˆ°Í•Ñ‘‘MÕ‰t€ôÕÍ•MÑ…Ñ”ðÉ½½Ðœð€Í¡…Á”œð€Íåµ‰½°œø É½½Ðœ¤ì(€€¼¨ƒ¦n‹¦Z/Ž3šZÃ–Š{Ž7–"¦‚–ÂÇ–n{–"Ãšr–’[–Æ“¾òk’â/š²‡–7¦Ë’úžr/–"Ãžjšb¿¦
–æû¦†–’Ÿš2'¦"W¾ò0(€€€€ƒ¢3’â7šb¿’â+š²‡–s–r£žj–r[–ö‹¾ò?ž²›¢fšâ–Z»Ž€¨¼(€ÕÍ•™™•Ð  ¤€ôøì¥˜€¡…Ñ¥Ù•Q…ˆ€„ôô€…‘œ¤Í•Ñ‘‘MÕˆ É½½Ðœ¤ìô°m…Ñ¥Ù•Q…‰t¤ì(€€¼¼ƒ¦n‹¦Z/Ž3šZÃ–Š{Ž7–"¦‚–ÂÇ¦–n{–’Ÿš2'¦"W¦
’â–Æ“¾ò3’â/š²‡¦Ë’ú’â7šr–s–r£–r[š†#šâ–Z¸(€ÕÍ•™™•Ð  ¤€ôøì¥˜€¡…Ñ¥Ù•Q…ˆ€„ôô€…‘œ¤Í•Ñ‘‘MÕˆ É½½Ðœ¤ìô°m…Ñ¥Ù•Q…‰t¤ì(€½¹ÍÐm½±½ÉA¥­•ÉÑ¥Ù”°Í•Ñ½±½ÉA¥­•ÉÑ¥Ù•t€ôÕÍ•MÑ…Ñ”¡™…±Í”¤ì(€€¼¨¨ƒžÞ£¢ò¿¦‚¦ã–"Ãžjšb¿–r[ž&¾ò#’â7šb¿šZ–¶_¾ò'ŠSŠPƒ¦gšfšVÓ–/–Þ—–ßš²¢šš>oš"C¢ÞŽ3žÞ£¢ò¿Ž7’âš¢žj’â'šº×–ò<€¨¼(€€¼¨ƒ¦g–/š^_š¢gš:Ÿ–"Û–’[š†¢š’â7¢š–7–2’â–ÆÀ´ÓŽžÞ£¢ò¿–r[ž&žj¦
––_’î/¦v‹¢«–ÞÇ–ÂÇš*+¦
+žV3žº_––÷’ê¾ò0(€€€€ƒ–’k–2’â–ÆÁ…‘‘¥¹œƒ–ÂÇšršVÓ–/žâ»’â–r#Ž’ö7žö»’æ¢Þ¢F_–<ƒŠSŠPƒ’ö#–Æ¢Ž‡žjš‚ó–¶C¢ÖÃžjšb¿–B3’â––\(€€€€ƒ’î/¦v‹¾ò3š&’î—’æ¢šžº_¦Ë’ú¾ò3’â7žÛ–>«šr'š‚ó–¶C¦
¦
+šržâ»–Â?¢ÞG’ö7Ž€¨¼(€½¹ÍÐ¥µ…•‘¥Ñ5½‘”€ô…Ñ¥Ù•Q…ˆ€ôôô€…‘©ÕÍÐœ(€€€€˜˜€ „…™±½…Ñ¥¹%µ…•Ì¹™¥¹¡˜€ôø˜¹¥€ôôôÍ•±•Ñ•‘±½…Ñ¥¹%€˜˜˜¹Ñ•áÐ€ôôôÕ¹‘•™¥¹•€˜˜€…˜¹Í¡…Á”¤(€€€€€€€ñð€ …Í•±•Ñ•‘±½…Ñ¥¹%€˜˜Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°€˜˜Í•±•Ñ•‘1…å½ÕÑ%€„ôô¹Õ±°¤¤ì((€½¹ÍÐm¡¥ÍÑ½ÉåMÑ…Ñ”°Í•Ñ!¥ÍÑ½ÉåMÑ…Ñ•t€ôÕÍ•MÑ…Ñ”ñì(€€€¡¥ÍÑ½ÉäèìÁ…•ÌèA…•½¹™¥mtì™±½…Ñ¥¹%µ…•Ìè±½…Ñ¥¹%µ…•mtì‰ÉÕÍ¡MÑÉ½­•Ìè±…ÍÍ¥	ÉÕÍ¡MÑÉ½­•mtìÍ•±•Ñ•‘I…Ñ¥¼èÍÑÉ¥¹œì¥Í1…¹‘Í…Á”è‰½½±•…¸õmtì(€€€¥¹‘•àè¹Õµ‰•Èì(€ôø¡ì(€€€¡¥ÍÑ½Éäèmt°(€€€¥¹‘•àè€´Ä(€ô¤ì(€½¹ÍÐ¥ÍU¹‘½¥¹œ€ôÕÍ•I•˜¡™…±Í”¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€¡¥ÍU¹‘½¥¹œ¹ÕÉÉ•¹Ð¤ì(€€€€€¥ÍU¹‘½¥¹œ¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐÑ¥µ•È€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€Í•Ñ!¥ÍÑ½ÉåMÑ…Ñ”¡ÁÉ•Ø€ôøì(€€€€€€€½¹ÍÐÍÑ…Ñ•Q½M…Ù”€ôìÁ…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á”ôì(€€€€€€€€(€€€€€€€¥˜€¡ÁÉ•Ø¹¥¹‘•à€ôôô€´Ä¤ì(€€€€€€€€€É•ÑÕÉ¸ì¡¥ÍÑ½ÉäèmÍÑ…Ñ•Q½M…Ù•t°¥¹‘•àè€Àôì(€€€€€€€ô((€€€€€€€½¹ÍÐÕÉÉ•¹Ð€ôÁÉ•Ø¹¡¥ÍÑ½ÉåmÁÉ•Ø¹¥¹‘•átì(€€€€€€€¥˜€¡ÕÉÉ•¹Ð€˜˜)M=8¹ÍÑÉ¥¹¥™ä¡ÕÉÉ•¹Ð¤€ôôô)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ•Q½M…Ù”¤¤ì(€€€€€€€€€É•ÑÕÉ¸ÁÉ•Øì(€€€€€€€ô((€€€€€€€€¼¨ƒ’î—–&7–>«žVd€ÌÀƒš‚ó¾ò3žÞ£’æ’â¦î{–ÂÇ¦’â7–n{šr–"wžjš¢–¶C’êŽ(€€€€€€€€€€ƒšRçžR£–ÇžR£žjÁÕÍ¡!¥ÍÑ½Éå¹ÑÉç¾òkžVg–"À€ÔÀÀƒš‚ó¾ò3¢3’âSž²°€Àƒš‚óšÂã¦ƒžVg¢F_Ž(€€€€€€€€€€ƒ’âš‚ó–>«šb¿–>šVãžjšÞëš.ß¢Êw¾ò#–r[ž&šb¿–ÇžR£–>žŸ¾ò'¾ò3š&’î—šRû–¾³’â7šr–B¢¢cšÛ¦®SŽ€¨¼(€€€€€€€É•ÑÕÉ¸ÁÕÍ¡!¥ÍÑ½Éå¹ÑÉä¡ÁÉ•Ø¹¡¥ÍÑ½Éä°ÁÉ•Ø¹¥¹‘•à°ÍÑ…Ñ•Q½M…Ù”¤ì(€€€€€ô¤ì(€€€ô°€ÌÀÀ¤ì((€€€É•ÑÕÉ¸€ ¤€ôø±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•È¤ì(€ô°mÁ…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á•t¤ì((€½¹ÍÐÕ¹‘¼€ô€ ¤€ôøì(€€€¥˜€¡¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€ø€À¤ì(€€€€€¥ÍU¹‘½¥¹œ¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€½¹ÍÐÁÉ•Ù%¹‘•à€ô¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€´€Äì(€€€€€½¹ÍÐÍÑ…Ñ”€ô¡¥ÍÑ½ÉåMÑ…Ñ”¹¡¥ÍÑ½ÉåmÁÉ•Ù%¹‘•átì(€€€€€Í•ÑA…•Ì¡ÍÑ…Ñ”¹Á…•Ì¤ì(€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÍÑ…Ñ”¹™±½…Ñ¥¹%µ…•Ì¤ì(€€€€€Í•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡ÍÑ…Ñ”¹‰ÉÕÍ¡MÑÉ½­•Ìñðmt¤ì(€€€€€Í•ÑM•±•Ñ•‘I…Ñ¥¼¡ÍÑ…Ñ”¹Í•±•Ñ•‘I…Ñ¥¼¤ì(€€€€€Í•Ñ%Í1…¹‘Í…Á”¡ÍÑ…Ñ”¹¥Í1…¹‘Í…Á”¤ì(€€€€€Í•Ñ!¥ÍÑ½ÉåMÑ…Ñ”¡ÁÉ•Ø€ôø€¡ì€¸¸¹ÁÉ•Ø°¥¹‘•àèÁÉ•Ù%¹‘•àô¤¤ì(€€€ô(€ôì((€½¹ÍÐÉ•‘¼€ô€ ¤€ôøì(€€€¥˜€¡¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€ð¡¥ÍÑ½ÉåMÑ…Ñ”¹¡¥ÍÑ½Éä¹±•¹Ñ €´€Ä¤ì(€€€€€¥ÍU¹‘½¥¹œ¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€½¹ÍÐ¹•áÑ%¹‘•à€ô¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€¬€Äì(€€€€€½¹ÍÐÍÑ…Ñ”€ô¡¥ÍÑ½ÉåMÑ…Ñ”¹¡¥ÍÑ½Éåm¹•áÑ%¹‘•átì(€€€€€Í•ÑA…•Ì¡ÍÑ…Ñ”¹Á…•Ì¤ì(€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÍÑ…Ñ”¹™±½…Ñ¥¹%µ…•Ì¤ì(€€€€€Í•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡ÍÑ…Ñ”¹‰ÉÕÍ¡MÑÉ½­•Ìñðmt¤ì(€€€€€Í•ÑM•±•Ñ•‘I…Ñ¥¼¡ÍÑ…Ñ”¹Í•±•Ñ•‘I…Ñ¥¼¤ì(€€€€€Í•Ñ%Í1…¹‘Í…Á”¡ÍÑ…Ñ”¹¥Í1…¹‘Í…Á”¤ì(€€€€€Í•Ñ!¥ÍÑ½ÉåMÑ…Ñ”¡ÁÉ•Ø€ôø€¡ì€¸¸¹ÁÉ•Ø°¥¹‘•àè¹•áÑ%¹‘•àô¤¤ì(€€€ô(€ôì((€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€¡…Ñ¥Ù•Q…ˆ€„ôô€½±½Èœ¤ì(€€€€€Í•Ñ½±½ÉA¥­•ÉÑ¥Ù”¡™…±Í”¤ì(€€€€€€¼¼ƒ¦n‹¦Z/¦†?¢&Ë–"¦‚–ÂÇ–n{–"Ã–êW¢&Ë¦
’â¦‚¾ò3’â/š²‡¦Ë’ú’â7šr–s–r£žÒ/žB¢ªÿ¢&Ë¦‚(€€€€€Í•Ñ½±½ÉMÕˆ ‰œœ¤ì(€€€ô(€€€€(€€€¥˜€¡…Ñ¥Ù•Q…ˆ€ôôô€±…å½ÕÐœ¤ì(€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€½¹ÍÐ•°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% …Ñ¥Ù”µ±…å½ÕÐµ‰ÕÑÑ½¸œ¤ì(€€€€€€€¥˜€¡•°¤ì(€€€€€€€€€•°¹ÍÉ½±±%¹Ñ½Y¥•Ü¡ì‰•¡…Ù¥½Èè€Íµ½½Ñ œ°‰±½¬è€¹•…É•ÍÐœô¤ì(€€€€€€€ô(€€€€€ô°€ÔÀ¤ì(€€€ô(€ô°m…Ñ¥Ù•Q…‰t¤ì((€½¹ÍÐmÍ±½ÑQ½UÁ±½…°Í•ÑM±½ÑQ½UÁ±½…‘t€ôÕÍ•MÑ…Ñ”ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì(€€¼¨¨ƒ–ºç–f£¦
šÊK¦?–"Ã’æ/–&7žR£žjšb¿¦‚C¢¢·–ó¾ò3–#’â7¢šžV¯–ë’ú¾ò3’â7žÛ¦?–"Ãžjžz³¦ZOšr¢ÞÏ’â’â,€¨¼(€½¹ÍÐm½¹Ñ…¥¹•É5•…ÍÕÉ•°Í•Ñ½¹Ñ…¥¹•É5•…ÍÕÉ•‘t€ôÕÍ•MÑ…Ñ”¡™…±Í”¤ì(€½¹ÍÐm…±±½ÝM¥¹±•1…å½ÕÐ°Í•Ñ±±½ÝM¥¹±•1…å½ÕÑt€ôÕÍ•MÑ…Ñ”¡™…±Í”¤ì(€½¹ÍÐm±…å½ÕÑM½ÉÑ	…Í”°Í•Ñ1…å½ÕÑM½ÉÑ	…Í•t€ôÕÍ•MÑ…Ñ”  ¤€ôø€Ð¤ì(€½¹ÍÐ¥Í1…å½ÕÑ¡…¹•I•˜€ôÕÍ•I•˜¡™…±Í”¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€¡¥Í1…å½ÕÑ¡…¹•I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€¥Í1…å½ÕÑ¡…¹•I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€ô•±Í”ì(€€€€€Í•Ñ1…å½ÕÑM½ÉÑ	…Í”¡¥µ…•Ì¹±•¹Ñ ¤ì(€€€ô(€ô°m¥µ…•Ì¹±•¹Ñ¡t¤ì((€€¼¼É…œ…¹‘É½ÀÑ¼ÍÝ…ÀÍÑ…Ñ•Ì(€½¹ÍÐm‘É…•‘%¹‘•à°Í•ÑÉ…•‘%¹‘•át€ôÕÍ•MÑ…Ñ”ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐm‘É…=Ù•É%¹‘•à°Í•ÑÉ…=Ù•É%¹‘•át€ôÕÍ•MÑ…Ñ”ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐm¡½Ù•É•‘MÝ…ÁQ…É•Ñ%¹‘•à°Í•Ñ!½Ù•É•‘MÝ…ÁQ…É•Ñ%¹‘•át€ôÕÍ•MÑ…Ñ”ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐm…Ñ¥Ù•½±±¥Í¥½¹Ì°Í•ÑÑ¥Ù•½±±¥Í¥½¹Ít€ôÕÍ•MÑ…Ñ”ñì(€€€±•™Ðè‰½½±•…¸ì(€€€É¥¡Ðè‰½½±•…¸ì(€€€Ñ½Àè‰½½±•…¸ì(€€€‰½ÑÑ½´è‰½½±•…¸ì(€ôø¡ì±•™Ðè™…±Í”°É¥¡Ðè™…±Í”°Ñ½Àè™…±Í”°‰½ÑÑ½´è™…±Í”ô¤ì((€€¼¼5½‰¥±”Q½Õ MÑ…Ñ•Ì(€½¹ÍÐmÑ½Õ¡É…•‘%¹‘•à°Í•ÑQ½Õ¡É…•‘%¹‘•át€ôÕÍ•MÑ…Ñ”ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐmÑ½Õ¡É…=Ù•É%¹‘•à°Í•ÑQ½Õ¡É…=Ù•É%¹‘•át€ôÕÍ•MÑ…Ñ”ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì((€½¹ÍÐÑ½Õ¡É…MÑ…Ñ”€ôÕÍ•I•˜ñì(€€€ÍÑ…ÉÑ`è¹Õµ‰•Èì(€€€ÍÑ…ÉÑdè¹Õµ‰•Èì(€€€ÕÉÉ•¹Ñ%¹‘•àè¹Õµ‰•Èì(€€€¡…Í5½Ù•è‰½½±•…¸ì(€ôð¹Õ±°ø¡¹Õ±°¤ì((€½¹ÍÐÑ½Õ¡i½½µMÑ…Ñ”€ôÕÍ•I•˜ñì(€€€ÍÑ…ÉÑ¥ÍÐè¹Õµ‰•Èì(€€€ÍÑ…ÉÑi½½´è¹Õµ‰•Èì(€ôð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐÝ…Íi½½µ¥¹I•˜€ôÕÍ•I•˜ñ‰½½±•…¸ø¡™…±Í”¤ì((€½¹ÍÐÑ½Õ¡É…=Ù•É%¹‘•áI•˜€ôÕÍ•I•˜ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐÑ½Õ¡A½ÍI•˜€ôÕÍ•I•˜ñìàè¹Õµ‰•Èìäè¹Õµ‰•Èôð¹Õ±°ø¡¹Õ±°¤ì((€€¼¼1½¹œÁÉ•ÍÌÉ•™Ì™½Èµ½‰¥±”Ñ½Õ ‘É…œµÑ¼µÍÝ…À(€½¹ÍÐ±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜€ôÕÍ•I•˜ñ9½‘•)L¹Q¥µ•½ÕÐð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐ¥Í1½¹AÉ•ÍÍ•‘I•˜€ôÕÍ•I•˜ñ‰½½±•…¸ø¡™…±Í”¤ì(€½¹ÍÐÑ½Õ¡MÑ…ÉÑA½ÍI•˜€ôÕÍ•I•˜ñìàè¹Õµ‰•Èìäè¹Õµ‰•Èôð¹Õ±°ø¡¹Õ±°¤ì(€€¼¨¨ƒ¦Vÿš2'š"Cž®/–&7š2žî·¢ºÃ–öWš&/š2žr–º{’ö7žö»¾ò3žò§–nû–ëž:Ãš^Ûš&7’òkš¶––÷’î—š&/š2’âë’â·–þŽ€¨¼(€½¹ÍÐÁ•¹‘¥¹1½¹AÉ•ÍÍA½ÍI•˜€ôÕÍ•I•˜ñìàè¹Õµ‰•Èìäè¹Õµ‰•Èôð¹Õ±°ø¡¹Õ±°¤ì(€€¼¼•±±Ì­••ÀÑ½Õ µ…Ñ¥½¸é¹½¹”Í¼±½¹œµÁÉ•ÍÌÉ•½É‘•É¥¹œ…¸½Ý¸Ñ¡”•ÍÑÕÉ”°Ý¡¥ …±Í¼(€€¼¼­¥±±•Ñ¡”¹…Ñ¥Ù”¡½É¥é½¹Ñ…°ÍÉ½±°•Ù•ÉåÝ¡•É”„Á¡½Ñ¼½Ù•ÉÌÑ¡”…¹Ù…Ì¸]¡¥±”¹¼(€€¼¼±½¹œµÁÉ•ÍÌ¥Ì¥¸™±¥¡ÐÝ”‘É¥Ù”Ñ¡…ÐÍÉ½±°½ÕÉÍ•±Ù•Ì™É½´Ñ¡”É…ÜÑ½Õ ‘•±Ñ„¸(€½¹ÍÐ•±±MÝ¥Á•I•˜€ôÕÍ•I•˜ñì±…ÍÑ`è¹Õµ‰•Èì…Ñ¥Ù”è‰½½±•…¸ôð¹Õ±°ø¡¹Õ±°¤ì((€€¼¼1½¹œµÁÉ•ÍÌÍÝ…ÁÁ¥¹œ™½È™É•”µÍÑ…¹‘¥¹œ¥µ…•Ì°…¹Ñ¡”Í¡…É•‘É½ÀµÑ…É•Ð¡¥¡±¥¡Ð(€€¼¼ÕÍ•‰ä‰½Ñ Ñ¡”•±°‘É…œ…¹Ñ¡¥Ì½¹”¸(€½¹ÍÐ™±½…ÑMÝ…ÁI•˜€ôÕÍ•I•˜ñì(€€€¥èÍÑÉ¥¹œìÍÉŒèÍÑÉ¥¹œìÍÑ…ÉÑ`è¹Õµ‰•ÈìÍÑ…ÉÑdè¹Õµ‰•Èì(€€€±…ÍÑ`è¹Õµ‰•Èì±…ÍÑdè¹Õµ‰•ÈìÍÝ¥Á¥¹œè‰½½±•…¸ì‘É…¥¹œè‰½½±•…¸ì(€ôð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐ™±½…ÑMÝ…ÁQ¥µ•ÉI•˜€ôÕÍ•I•˜ñI•ÑÕÉ¹QåÁ”ñÑåÁ•½˜Í•ÑQ¥µ•½ÕÐøð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐÍÝ…Á=Ù•ÉI•˜€ôÕÍ•I•˜ñMÝ…ÁQ…É•Ðð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐmÍÝ…Á=Ù•È°Í•ÑMÝ…Á=Ù•Ét€ôÕÍ•MÑ…Ñ”ñMÝ…ÁQ…É•Ðð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐm™±½…ÑÉ…MÉŒ°Í•Ñ±½…ÑÉ…MÉt€ôÕÍ•MÑ…Ñ”ñÍÑÉ¥¹œð¹Õ±°ø¡¹Õ±°¤ì(€ÕÍ•™™•Ð  ¤€ôø€ ¤€ôøì¥˜€¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤±•…ÉQ¥µ•½ÕÐ¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ìô°mt¤ì((€½¹ÍÐÍ•ÑMÝ…Á=Ù•ÉQ…É•Ð€ô€¡ÐèMÝ…ÁQ…É•Ðð¹Õ±°¤€ôøì(€€€½¹ÍÐ„€ôÍÝ…Á=Ù•ÉI•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐÍ…µ”€ô„€˜˜Ð€˜˜„¹­¥¹€ôôôÐ¹­¥¹€˜˜(€€€€€€¡„¹­¥¹€ôôô€•±°œ(€€€€€€€€ü„¹¥‘à€ôôô€¡Ð…Ì…¹ä¤¹¥‘à€˜˜„¹±…å½ÕÑ%€ôôô€¡Ð…Ì…¹ä¤¹±…å½ÕÑ%(€€€€€€€€è„¹¥€ôôô€¡Ð…Ì…¹ä¤¹¥¤ì(€€€¥˜€¡Í…µ”¤É•ÑÕÉ¸ì(€€€ÍÝ…Á=Ù•ÉI•˜¹ÕÉÉ•¹Ð€ôÐì(€€€Í•ÑMÝ…Á=Ù•È¡Ð¤ì(€ôì(€½¹ÍÐÁ½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜€ôÕÍ•I•˜ñìàè¹Õµ‰•Èìäè¹Õµ‰•Èôð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐ‘É…=É5½Ù•=ÕÉÉ•‘I•˜€ôÕÍ•I•˜ñ‰½½±•…¸ø¡™…±Í”¤ì((€€¼¼A½¥¹Ñ•ÈÍÑ…Ñ”™½È‘É…¥¹œÑ¼Á…¸Ñ¡”¥µ…”¥¹Í¥‘”Ñ¡”Í•±•Ñ••±°(€½¹ÍÐÁ½¥¹Ñ•ÉMÑ…Ñ”€ôÕÍ•I•˜¡ì(€€€¥ÍÉ…¥¹½¹Ñ•¹Ðè™…±Í”°(€€€€¼¼ƒ–>«¢ª7ž²³’âš‚çš&/š2¾òkž²³’ê3š‚ç¢B÷’â/–ÂÇšb¿¢šžâ»šRû¾ò3’â7šb¿¢š–æÏžžì(€€€Á½¥¹Ñ•É%è€´Ä°(€€€ÍÑ…ÉÑ`è€À°(€€€ÍÑ…ÉÑdè€À°(€€€ÍÑ…ÉÑ=™™Í•Ñ`è€À°(€€€ÍÑ…ÉÑ=™™Í•Ñdè€À°(€€€•±±%‘àè€´Ä(€ô¤ì((€½¹ÍÐ™¥±•%¹ÁÕÑI•˜€ôÕÍ•I•˜ñ!Q51%¹ÁÕÑ±•µ•¹Ðø¡¹Õ±°¤ì(€€¼¨ƒ–öÇž&–>›–’[’â¦†ƒŠSŠPƒ’â–,…•ÁÐƒ–B3šf–¾¯–r[ž&¢"–öÇž&žj¢¦Ç¾ò3žnãžÂÿ¦
’â¦‚šr–§ž¢»šÞß–r (€€€€ƒ’â¢Öß¾ò3š&û¢Öß’ú–>7¢3š‹Ž¢ÖÃžjšb¿–B3’âšR¼¡…¹‘±•¥±•¡…¹—¾ò3¢†3ž
ë–º3–£’âš¢Ž€¨¼(€½¹ÍÐÙ¥‘%¹ÁÕÑI•˜€ôÕÍ•I•˜ñ!Q51%¹ÁÕÑ±•µ•¹Ðø¡¹Õ±°¤ì(€½¹ÍÐÉ•Á±…•%¹ÁÕÑI•˜€ôÕÍ•I•˜ñ!Q51%¹ÁÕÑ±•µ•¹Ðø¡¹Õ±°¤ì(€½¹ÍÐ½¹Ñ…¥¹•ÉI•˜€ôÕÍ•I•˜ñ!Q51¥Ù±•µ•¹Ðø¡¹Õ±°¤ì((€€¼¼5•…ÍÕÉ”½¹Ñ…¥¹•ÈÍ¥é”‘å¹…µ¥…±±ä(€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€ …½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€½¹ÍÐ½‰Í•ÉÙ•È€ô¹•ÜI•Í¥é•=‰Í•ÉÙ•È ¡•¹ÑÉ¥•Ì¤€ôøì(€€€€€™½È€¡½¹ÍÐ•¹ÑÉä½˜•¹ÑÉ¥•Ì¤ì(€€€€€€€½¹ÍÐìÝ¥‘Ñ °¡•¥¡Ðô€ô•¹ÑÉä¹½¹Ñ•¹ÑI•Ðì(€€€€€€€¥˜€¡Ý¥‘Ñ €ø€À€˜˜¡•¥¡Ð€ø€À¤ì(€€€€€€€€€Í•Ñ½¹Ñ…¥¹•ÉM¥é”¡ìÝ¥‘Ñ °¡•¥¡Ðô¤ì(€€€€€€€€€Í•Ñ½¹Ñ…¥¹•É5•…ÍÕÉ•¡ÑÉÕ”¤ì(€€€€€€€ô(€€€€€ô(€€€ô¤ì(€€€½‰Í•ÉÙ•È¹½‰Í•ÉÙ”¡½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ð¤ì(€€€É•ÑÕÉ¸€ ¤€ôø½‰Í•ÉÙ•È¹‘¥Í½¹¹•Ð ¤ì(€ô°mt¤ì((€€¼¼ÕÑ½µ…Ñ¥…±±ä±…µÀ¥µ…”½™™Í•ÑÌÝ¡•¸±…å½ÕÐ°É…Ñ¥¼°…À°½ÈÁÉ•Ù¥•Ü‘¥µ•¹Í¥½¹Ì¡…¹”Ñ¼ÁÉ•Ù•¹ÐÍ¡¥™Ñ¥¹œ…¹•µÁÑäÍÁ…•Ì(€½¹ÍÐ¥µ…•ÍMÑ…Ñ•-•ä€ô¥µ…•Ì¹µ…À¡¥µœ€ôø€‘í¥µœ¹é½½´ñð€Åô´‘í¥µœ¹É½Ñ…Ñ¥½¸ñð€Áô´‘í¥µœ¹ÕÉ°ñð€œõ€¤¹©½¥¸ œ°œ¤ì((€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€¡¥µ…•Ì¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸ì(€€€½¹ÍÐÑ•µÁ±…Ñ•Ì€ôQ5A1Q}5Am¥µ…•Ì¹±•¹Ñ¡tñðmtì(€€€½¹ÍÐ…Ñ¥Ù•QµÁ°€ôÑ•µÁ±…Ñ•ÍmÑ•µÁ±…Ñ•%¹‘•átñðÑ•µÁ±…Ñ•ÍlÁtì(€€€¥˜€ ……Ñ¥Ù•QµÁ°¤É•ÑÕÉ¸ì(€(€€€½¹ÍÐìÝ¥‘Ñ èÁÉ•Ù¥•Ý\°¡•¥¡ÐèÁÉ•Ù¥•Ý ô€ô•ÑI…Ñ¥½¥µ•¹Í¥½¹Ì ¤ì(€(€€€±•Ð¡…Í¡…¹•Ì€ô™…±Í”ì(€€€½¹ÍÐ±…µÁ•€ô¥µ…•Ì¹µ…À ¡•±°°¥‘à¤€ôøì(€€€€€¥˜€ …•±°ñð€…•±°¹ÕÉ°¤É•ÑÕÉ¸•±°ì(€€€€€½¹ÍÐÉ•Ð€ô…Ñ¥Ù•QµÁ°¹É•ÑÍm¥‘átì(€€€€€¥˜€ …É•Ð¤É•ÑÕÉ¸•±°ì(€(€€€€€½¹ÍÐ•±±]¥‘Ñ €ôÉ•Ð¹Ü€¨ÁÉ•Ù¥•Ý\ì(€€€€€½¹ÍÐ•±±!•¥¡Ð€ôÉ•Ð¹ €¨ÁÉ•Ù¥•Ý ì(€€€€€¥˜€¡•±±]¥‘Ñ €ðô€Àñð•±±!•¥¡Ð€ðô€À¤É•ÑÕÉ¸•±°ì(€(€€€€€½¹ÍÐÝ}¥µœ€ô•±°¹¹…ÑÕÉ…±]¥‘Ñ ñð€àÀÀì(€€€€€½¹ÍÐ¡}¥µœ€ô•±°¹¹…ÑÕÉ…±!•¥¡Ðñð€ØÀÀì(€€€€€½¹ÍÐ¥ÌäÁ½ÈÈÜÀ€ô€¡•±°¹É½Ñ…Ñ¥½¸€”€ÄàÀ¤€„ôô€Àì(€€€€€½¹ÍÐ‘É…Ý\€ô¥ÌäÁ½ÈÈÜÀ€ü¡}¥µœ€èÝ}¥µœì(€€€€€½¹ÍÐ‘É…Ý €ô¥ÌäÁ½ÈÈÜÀ€üÝ}¥µœ€è¡}¥µœì(€(€€€€€½¹ÍÐÍ…±•`€ô•±±]¥‘Ñ €¼‘É…Ý\ì(€€€€€½¹ÍÐÍ…±•d€ô•±±!•¥¡Ð€¼‘É…Ý ì(€€€€€½¹ÍÐ½Ù•ÉM…±”€ô5…Ñ ¹µ…à¡Í…±•`°Í…±•d¤ì(€€€€€½¹ÍÐ™¥¹…±M…±”€ô½Ù•ÉM…±”€¨€¡•±°¹é½½´ñð€Ä¤ì(€(€€€€€½¹ÍÐÉ½Ñ…Ñ•‘%µ\€ô¥ÌäÁ½ÈÈÜÀ€ü€¡¡}¥µœ€¨™¥¹…±M…±”¤€è€¡Ý}¥µœ€¨™¥¹…±M…±”¤ì(€€€€€½¹ÍÐÉ½Ñ…Ñ•‘%µ €ô¥ÌäÁ½ÈÈÜÀ€ü€¡Ý}¥µœ€¨™¥¹…±M…±”¤€è€¡¡}¥µœ€¨™¥¹…±M…±”¤ì(€(€€€€€½¹ÍÐµ…áM¡¥™Ñ`€ô5…Ñ ¹µ…à À°€¡É½Ñ…Ñ•‘%µ\€´•±±]¥‘Ñ ¤€¼€È¤€¼•±±]¥‘Ñ ì(€€€€€½¹ÍÐµ…áM¡¥™Ñd€ô5…Ñ ¹µ…à À°€¡É½Ñ…Ñ•‘%µ €´•±±!•¥¡Ð¤€¼€È¤€¼•±±!•¥¡Ðì(€(€€€€€½¹ÍÐ¹•Ý=™™Í•Ñ`€ô5…Ñ ¹µ…à µµ…áM¡¥™Ñ`°5…Ñ ¹µ¥¸¡µ…áM¡¥™Ñ`°•±°¹½™™Í•Ñ`¤¤ì(€€€€€½¹ÍÐ¹•Ý=™™Í•Ñd€ô5…Ñ ¹µ…à µµ…áM¡¥™Ñd°5…Ñ ¹µ¥¸¡µ…áM¡¥™Ñd°•±°¹½™™Í•Ñd¤¤ì(€(€€€€€¥˜€¡5…Ñ ¹…‰Ì¡¹•Ý=™™Í•Ñ`€´•±°¹½™™Í•Ñ`¤€ø€À¸ÀÀÄñð5…Ñ ¹…‰Ì¡¹•Ý=™™Í•Ñd€´•±°¹½™™Í•Ñd¤€ø€À¸ÀÀÄ¤ì(€€€€€€€¡…Í¡…¹•Ì€ôÑÉÕ”ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€¸¸¹•±°°(€€€€€€€€€½™™Í•Ñ`è¹•Ý=™™Í•Ñ`°(€€€€€€€€€½™™Í•Ñdè¹•Ý=™™Í•Ñd(€€€€€€€ôì(€€€€€ô(€€€€€É•ÑÕÉ¸•±°ì(€€€ô¤ì(€(€€€¥˜€¡¡…Í¡…¹•Ì¤ì(€€€€€Í•Ñ%µ…•Ì¡±…µÁ•¤ì(€€€ô(€ô°mÑ•µÁ±…Ñ•%¹‘•à°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á”°…À°½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ °½¹Ñ…¥¹•ÉM¥é”¹¡•¥¡Ð°¥µ…•Ì¹±•¹Ñ °¥µ…•ÍMÑ…Ñ•-•åt¤ì((€½¹ÍÐ‰ÉÕÍ¡A½¥¹Ð€ô€¡±¥•¹Ñ`è¹Õµ‰•È°±¥•¹Ñdè¹Õµ‰•È¤è±…ÍÍ¥	ÉÕÍ¡A½¥¹Ðð¹Õ±°€ôøì(€€€½¹ÍÐÉ½½Ð€ôÁ…•Í½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …É½½Ð¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÈ€ôÉ½½Ð¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€½¹ÍÐÑ½Ñ…±\€ôÁ…•Ì¹±•¹Ñ €¨ÁÉ•Ù¥•Ý\€¬5…Ñ ¹µ…à À°Á…•Ì¹±•¹Ñ €´€Ä¤ì(€€€½¹ÍÐ­à€ôÈ¹Ý¥‘Ñ €¼5…Ñ ¹µ…à Ä°Ñ½Ñ…±\¤ì(€€€½¹ÍÐ­ä€ôÈ¹¡•¥¡Ð€¼5…Ñ ¹µ…à Ä°ÁÉ•Ù¥•Ý ¤ì(€€€½¹ÍÐÀ€ôìàè€¡±¥•¹Ñ`€´È¹±•™Ð¤€¼5…Ñ ¹µ…à ¸ÀÀÀÄ°­à¤°äè€¡±¥•¹Ñd€´È¹Ñ½À¤€¼5…Ñ ¹µ…à ¸ÀÀÀÄ°­ä¤ôì(€€€É•ÑÕÉ¸À¹à€øô€À€˜˜À¹à€ðôÑ½Ñ…±\€˜˜À¹ä€øô€À€˜˜À¹ä€ðôÁÉ•Ù¥•Ý €üÀ€è¹Õ±°ì(€ôì(€½¹ÍÐ‰ÉÕÍ¡	½Õ¹‘Ì€ô€¡Ìè±…ÍÍ¥	ÉÕÍ¡MÑÉ½­”¤€ôøì(€€€½¹ÍÐáÌ€ôÌ¹Á½¥¹ÑÌ¹µ…À¡À€ôøÀ¹à¤°åÌ€ôÌ¹Á½¥¹ÑÌ¹µ…À¡À€ôøÀ¹ä¤°Á…€ôÌ¹Ý¥‘Ñ €¼€È€¬€Ôì(€€€É•ÑÕÉ¸ì(€€€€€àè5…Ñ ¹µ¥¸ ¸¸¹áÌ¤€´Á…°äè5…Ñ ¹µ¥¸ ¸¸¹åÌ¤€´Á…°(€€€€€Üè5…Ñ ¹µ…à Ä°5…Ñ ¹µ…à ¸¸¹áÌ¤€´5…Ñ ¹µ¥¸ ¸¸¹áÌ¤€¬Á…€¨€È¤°(€€€€€ è5…Ñ ¹µ…à Ä°5…Ñ ¹µ…à ¸¸¹åÌ¤€´5…Ñ ¹µ¥¸ ¸¸¹åÌ¤€¬Á…€¨€È¤°(€€€ôì(€ôì(€½¹ÍÐ•É…Í•	ÉÕÍ¡Ð€ô€¡Àè±…ÍÍ¥	ÉÕÍ¡A½¥¹Ð¤€ôøì(€€€½¹ÍÐÉ…‘¥ÕÌ€ô5…Ñ ¹µ…à à°‰ÉÕÍ¡]¥‘Ñ €¼€È¤ì(€€€Í•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹™±…Ñ5…À¡Ì€ôøì(€€€€€½¹ÍÐ¡¥Ð€ôÉ…‘¥ÕÌ€¬Ì¹Ý¥‘Ñ €¼€Èì(€€€€€½¹ÍÐÉ½ÕÁÌè±…ÍÍ¥	ÉÕÍ¡A½¥¹Ñmumt€ômtì(€€€€€±•ÐÉ½ÕÀè±…ÍÍ¥	ÉÕÍ¡A½¥¹Ñmt€ômtì(€€€€€Ì¹Á½¥¹ÑÌ¹™½É… ¡Ä€ôøì(€€€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡Ä¹à€´À¹à°Ä¹ä€´À¹ä¤€ðô¡¥Ð¤ì(€€€€€€€€€¥˜€¡É½ÕÀ¹±•¹Ñ ¤É½ÕÁÌ¹ÁÕÍ ¡É½ÕÀ¤ì(€€€€€€€€€É½ÕÀ€ômtì(€€€€€€€ô•±Í”É½ÕÀ¹ÁÕÍ ¡Ä¤ì(€€€€€ô¤ì(€€€€€¥˜€¡É½ÕÀ¹±•¹Ñ ¤É½ÕÁÌ¹ÁÕÍ ¡É½ÕÀ¤ì(€€€€€¥˜€¡É½ÕÁÌ¹±•¹Ñ €ôôô€Ä€˜˜É½ÕÁÍlÁt¹±•¹Ñ €ôôôÌ¹Á½¥¹ÑÌ¹±•¹Ñ ¤É•ÑÕÉ¸mÍtì(€€€€€€¼¨ƒš¦‡žj»šN›–>«–"š:'žŠÃ–"Ãžj¢Þ¿šº×¾ò3’â7šr–nƒž
ëšN›–"Ã’â–Â?¦î{–ÂÇ–"«¦f“šVÓžÖž¶žV¯Ž€¨¼(€€€€€É•ÑÕÉ¸É½ÕÁÌ¹µ…À ¡Á½¥¹ÑÌ°¥¹‘•à¤€ôø€¡ì(€€€€€€€€¸¸¹Ì°Á½¥¹ÑÌ°(€€€€€€€¥è¥¹‘•à€ôôô€À€üÌ¹¥€è€‘íÌ¹¥‘ôµÕÐ´‘í…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ÌØ¥ô´‘í¥¹‘•áõ€°(€€€€€ô¤¤ì(€€€ô¤¤ì(€ôì(€½¹ÍÐ‰ÉÕÍ¡ÑA½¥¹Ð€ô€¡Àè±…ÍÍ¥	ÉÕÍ¡A½¥¹Ð¤€ôøì(€€€½¹ÍÐÍ•µ•¹Ñ¥ÍÑ…¹”€ô€¡Äè±…ÍÍ¥	ÉÕÍ¡A½¥¹Ð°„è±…ÍÍ¥	ÉÕÍ¡A½¥¹Ð°ˆè±…ÍÍ¥	ÉÕÍ¡A½¥¹Ð¤€ôøì(€€€€€½¹ÍÐÙà€ôˆ¹à€´„¹à°Ùä€ôˆ¹ä€´„¹äì(€€€€€½¹ÍÐÙØ€ôÙà€¨Ùà€¬Ùä€¨Ùäì(€€€€€½¹ÍÐÐ€ôÙØ€ðô€Å”´Ø€ü€À€è5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Ä°€ ¡Ä¹à€´„¹à¤€¨Ùà€¬€¡Ä¹ä€´„¹ä¤€¨Ùä¤€¼ÙØ¤¤ì(€€€€€É•ÑÕÉ¸5…Ñ ¹¡åÁ½Ð¡Ä¹à€´€¡„¹à€¬Ùà€¨Ð¤°Ä¹ä€´€¡„¹ä€¬Ùä€¨Ð¤¤ì(€€€ôì(€€€É•ÑÕÉ¸l¸¸¹‰ÉÕÍ¡MÑÉ½­•Ít¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹è€´„¹è¤¹™¥¹¡Ì€ôøì(€€€€€½¹ÍÐ¡¥Ð€ô5…Ñ ¹µ…à à°Ì¹Ý¥‘Ñ €¼€È€¬€Ô¤ì(€€€€€¥˜€¡Ì¹Á½¥¹ÑÌ¹±•¹Ñ €ôôô€Ä¤É•ÑÕÉ¸5…Ñ ¹¡åÁ½Ð¡À¹à€´Ì¹Á½¥¹ÑÍlÁt¹à°À¹ä€´Ì¹Á½¥¹ÑÍlÁt¹ä¤€ðô¡¥Ðì(€€€€€™½È€¡±•Ð¤€ô€Äì¤€ðÌ¹Á½¥¹ÑÌ¹±•¹Ñ ì¤¬¬¤¥˜€¡Í•µ•¹Ñ¥ÍÑ…¹”¡À°Ì¹Á½¥¹ÑÍm¤€´€Åt°Ì¹Á½¥¹ÑÍm¥t¤€ðô¡¥Ð¤É•ÑÕÉ¸ÑÉÕ”ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô¤ñð¹Õ±°ì(€ôì(€½¹ÍÐ¡…¹‘±•	ÉÕÍ¡A½¥¹Ñ•É½Ý¸€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ð¤€ôøì(€€€¥˜€¡…Ñ¥Ù•Q…ˆ€„ôô€‰ÉÕÍ œ¤É•ÑÕÉ¸ì(€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€½¹ÍÐÀ€ô‰ÉÕÍ¡A½¥¹Ð¡”¹±¥•¹Ñ`°”¹±¥•¹Ñd¤ì(€€€¥˜€ …À¤É•ÑÕÉ¸ì(€€€ÑÉäì€¡”¹ÕÉÉ•¹ÑQ…É•Ð…Ì!Q51±•µ•¹Ð¤¹Í•ÑA½¥¹Ñ•É…ÁÑÕÉ”¡”¹Á½¥¹Ñ•É%¤ìô…Ñ ì€¼¨¥=Lµ…ä‘•±¥¹”€¨¼ô(€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ìÍ•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ìÍ•ÑM•±•Ñ•‘1…å½ÕÑ%¡¹Õ±°¤ìÍ•ÑM•±•Ñ•‘	ÉÕÍ¡%¡¹Õ±°¤ì(€€€¥˜€¡‰ÉÕÍ¡É…Í•È¤ì•É…Í•	ÉÕÍ¡Ð¡À¤ì‰ÉÕÍ¡1¥Ù•I•˜¹ÕÉÉ•¹Ð€ôìÁ½¥¹Ñ•É%è”¹Á½¥¹Ñ•É%°ÍÑÉ½­”èì¥è€•É…Í•Èœ°­¥¹è‰ÉÕÍ¡-¥¹°Á½¥¹ÑÌèmÁt°½±½Èè€œŒÀÀÀœ°Ý¥‘Ñ è‰ÉÕÍ¡]¥‘Ñ °¡…É‘¹•ÍÌè‰ÉÕÍ¡!…É‘¹•ÍÌ°èè€ÀôôìÉ•ÑÕÉ¸ìô(€€€€¼¨ƒ¦î{–r£š^‹šr'ž¶žV¯’â+¾òw¦ã–>[¾òo¦î{ž¦ëžf÷¢fWš&7¦Z/–ž/šZÃžj’âž¶Ž¦g¢ºOš¾?š²‡¦²š&/–ö‹š"Cžj(€€€€€€Á…Ñ ƒ¦÷šb¿žrš¶–>¿–7š²‡¦ã–>[Ž¢ªÿšVÓ–r[–Æ“š"[–"«¦f“žjž&§’îÛŽ€¨¼(€€€½¹ÍÐ¡¥Ð€ô‰ÉÕÍ¡ÑA½¥¹Ð¡À¤ì(€€€¥˜€¡¡¥Ð¤ìÍ•ÑM•±•Ñ•‘	ÉÕÍ¡%¡¡¥Ð¹¥¤ìÉ•ÑÕÉ¸ìô(€€€½¹ÍÐÍÑÉ½­”è±…ÍÍ¥	ÉÕÍ¡MÑÉ½­”€ôì(€€€€€¥è‰ÉÕÍ ´‘í…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ÌØ¥ô´‘í5…Ñ ¹É…¹‘½´ ¤¹Ñ½MÑÉ¥¹œ ÌØ¤¹Í±¥” È°€Ü¥õ€°(€€€€€­¥¹è‰ÉÕÍ¡-¥¹°Á½¥¹ÑÌèmÁt°½±½Èè‰ÉÕÍ¡½±½È°Ý¥‘Ñ è‰ÉÕÍ¡]¥‘Ñ °(€€€€€¡…É‘¹•ÍÌè‰ÉÕÍ¡!…É‘¹•ÍÌ°èè±…å•ÉMÑ…¬¹±•¹Ñ €¬‰ÉÕÍ¡MÑÉ½­•Ì¹±•¹Ñ °(€€€ôì(€€€‰ÉÕÍ¡1¥Ù•I•˜¹ÕÉÉ•¹Ð€ôìÁ½¥¹Ñ•É%è”¹Á½¥¹Ñ•É%°ÍÑÉ½­”ôì(€€€Í•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡ÁÉ•Ø€ôøl¸¸¹ÁÉ•Ø°ÍÑÉ½­•t¤ì(€ôì(€½¹ÍÐ¡…¹‘±•	ÉÕÍ¡A½¥¹Ñ•É5½Ù”€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ð¤€ôøì(€€€½¹ÍÐ±¥Ù”€ô‰ÉÕÍ¡1¥Ù•I•˜¹ÕÉÉ•¹Ðì(€€€¥˜€¡…Ñ¥Ù•Q…ˆ€„ôô€‰ÉÕÍ œñð€…±¥Ù”ñð±¥Ù”¹Á½¥¹Ñ•É%€„ôô”¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€½¹ÍÐÀ€ô‰ÉÕÍ¡A½¥¹Ð¡”¹±¥•¹Ñ`°”¹±¥•¹Ñd¤ì(€€€¥˜€ …À¤É•ÑÕÉ¸ì(€€€½¹ÍÐ±…ÍÐ€ô±¥Ù”¹ÍÑÉ½­”¹Á½¥¹ÑÍm±¥Ù”¹ÍÑÉ½­”¹Á½¥¹ÑÌ¹±•¹Ñ €´€Åtì(€€€¥˜€¡±…ÍÐ€˜˜5…Ñ ¹¡åÁ½Ð¡À¹à€´±…ÍÐ¹à°À¹ä€´±…ÍÐ¹ä¤€ð5…Ñ ¹µ…à Ä¸È°‰ÉÕÍ¡]¥‘Ñ €¨€¸Àà¤¤É•ÑÕÉ¸ì(€€€¥˜€¡‰ÉÕÍ¡É…Í•È¤ì•É…Í•	ÉÕÍ¡Ð¡À¤ì±¥Ù”¹ÍÑÉ½­”¹Á½¥¹ÑÌ¹ÁÕÍ ¡À¤ìÉ•ÑÕÉ¸ìô(€€€±¥Ù”¹ÍÑÉ½­”€ôì€¸¸¹±¥Ù”¹ÍÑÉ½­”°Á½¥¹ÑÌèl¸¸¹±¥Ù”¹ÍÑÉ½­”¹Á½¥¹ÑÌ°Átôì(€€€½¹ÍÐ¹•áÐ€ô±¥Ù”¹ÍÑÉ½­”ì(€€€Í•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡Ì€ôøÌ¹¥€ôôô¹•áÐ¹¥€ü¹•áÐ€èÌ¤¤ì(€ôì(€½¹ÍÐ¡…¹‘±•	ÉÕÍ¡A½¥¹Ñ•ÉUÀ€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ð¤€ôøì(€€€½¹ÍÐ±¥Ù”€ô‰ÉÕÍ¡1¥Ù•I•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …±¥Ù”ñð±¥Ù”¹Á½¥¹Ñ•É%€„ôô”¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€‰ÉÕÍ¡1¥Ù•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€¥˜€ …‰ÉÕÍ¡É…Í•È€˜˜±¥Ù”¹ÍÑÉ½­”¹Á½¥¹ÑÌ¹±•¹Ñ ¤Í•ÑM•±•Ñ•‘	ÉÕÍ¡%¡±¥Ù”¹ÍÑÉ½­”¹¥¤ì(€ôì((€½¹ÍÐ‰ÉÕÍ¡A…Ñ €ô€¡Ìè±…ÍÍ¥	ÉÕÍ¡MÑÉ½­”¤€ôøì(€€€¥˜€ …Ì¹Á½¥¹ÑÌ¹±•¹Ñ ¤É•ÑÕÉ¸€œœì(€€€¥˜€¡Ì¹Á½¥¹ÑÌ¹±•¹Ñ €ôôô€Ä¤É•ÑÕÉ¸4€‘íÌ¹Á½¥¹ÑÍlÁt¹áô€‘íÌ¹Á½¥¹ÑÍlÁt¹åô°€¸ÀÄ€¸ÀÅ€ì(€€€±•Ð€ô4€‘íÌ¹Á½¥¹ÑÍlÁt¹áô€‘íÌ¹Á½¥¹ÑÍlÁt¹åõ€ì(€€€™½È€¡±•Ð¤€ô€Äì¤€ðÌ¹Á½¥¹ÑÌ¹±•¹Ñ €´€Äì¤¬¬¤ì(€€€€€½¹ÍÐÀ€ôÌ¹Á½¥¹ÑÍm¥t°¸€ôÌ¹Á½¥¹ÑÍm¤€¬€Åtì(€€€€€€¬ô€D€‘íÀ¹áô€‘íÀ¹åô€‘ì¡À¹à€¬¸¹à¤€¼€Éô€‘ì¡À¹ä€¬¸¹ä¤€¼€Éõ€ì(€€€ô(€€€½¹ÍÐè€ôÌ¹Á½¥¹ÑÍmÌ¹Á½¥¹ÑÌ¹±•¹Ñ €´€Åtì(€€€É•ÑÕÉ¸€‘í‘ô0€‘íè¹áô€‘íè¹åõ€ì(€ôì((€€¼¨€´´´ƒš>oš¾S’ú/šf¾ò3šÖ»–.Wž&§’îÛ¢š¢Þ¢F_¦‚¦v‹’â¢Ößžâ»šRø€´´´(€€€€ƒ–r[ž&¾ò?šZ–¶_¦g’êošÖ»–.Wž&§’îÛžjà½äƒšb¿Ž3–ú{¦‚¦v‹–Þ›’â+¢žKžº_¢ÖßžjžÖW–Â7–?žÒƒŽ7¾ò0(€€€€ƒ¢3’ö#–Æ¾ò#š‚ó–¶C¾ò'šb¿’î—¦‚¦v‹’â·–þž
ë–~ëšê[žj–?žžï¦?Žš&’î—š>o¦‚¦v‹š¾S’ú/žjšf–g¾ò0(€€€€ƒš‚ó–¶Cšr¢«–ÞÇ–ú–r£’â·¦ZO¾ò3šÖ»–.Wž&§’îÛ–6ï–:–rÃ’â7–.TƒŠSŠPƒ¦‚¦v‹’â¢º+žªš"[¢º+ž~»¾ò0(€€€€ƒ–:šr³¦vƒ¦
+žjž&§’îÛ–ÂÇ¢ÞG–"Ã¦‚¦v‹–’[¦v‹Ž¢Š¯¢Žš:'¾ò#’â+šZçžjž&§’îÛšr–âã’â·š.o¾ò'Ž((€€€€ƒ¦g¢Ž‡–r£¦‚¦v‹–Âë–¾ãžržj¢º+’êžj¦
’â–"ï¾ò3š*+š¾?–/šÖ»–.Wž&§’îÛš2'š¾S’ú/¦7šZÃšNë’âš²‡¾òh(€€€€€€ƒ
Üƒ’â·–þ¦î{¾òk’útãŽäƒ–§–/šZç–BG–B¢«žjžâ»šRûš¾S’ú/žžï–.TƒŠHƒžnã–Â7’ö7žö»’â7¢º((€€€€€€ƒ
Üƒ–’Ÿ–Â?¾òk¦‚¦v‹¢º+–Â?žjšf–g’æc’â+–§–/š¾S’ú/’â·Ž3¢ò–Â?Ž7žj¦
–,ƒŠHƒž¶'š¾Sžâ»šRû¾ò0(€€€€€€€€€€€€€€ƒ–r[’â7šr¢Š¯–ŽOš&¾ò3¢3’âS–:šr³–r£š†–Ÿžj’â–ºk¦
–r£š†–œ((€€€€ƒŠRŠR ƒ–’Ÿ–Â?¦
’â¦‚ž
ë’î¦êó¢š–"–§ž¢¸ƒŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠR (€€€€ƒ’î—–&7’â7žº‡¢º+–’Ÿ¢º+–Â?¦÷–>Xµ¥»¾ò3¦
šb¼¨«’â7–>¿¦¨«žj¾òh(€€€€ƒžnÓ–ò<ƒŠHƒš¦¯–ò?šf€¡Íà°Íä¤€ô€ Ä°€À¸ÔØ§¾ò3–>Xµ¥¸ƒžâ»š"@€À¸ÔÛ¾òl(€€€€ƒ–"–n{’ú€ Ä°€Ä¸ÜÜ¤ƒ–>Xµ¥¸ƒ–6ïšb¼€ÄƒŠSŠPƒšÊKšr'¦
–:Žš&’î—–>«¢š’ú–n{–"–æûš²‡¾ò0(€€€€ƒž&§’îÛ–ÂÇ’â¢Þ¿žâ»’â/–:ï¾ò#–¾›šâ°€ÔÙÁàƒŠH€ÌÈƒŠH€ÄàƒŠH€ÄÀƒŠH€àƒŠH€ØƒŠH€Ó¾ò'Ž(€€€€ƒšRçš"CŽ3¦‚¦v‹¢º+–Â?–>Xµ¥»Ž¢º+–’Ÿ–>Xµ…ãŽ7¾òk¢º+–Â?žjšZç–BG¢Þ’î—–&7’âš¢‡’âš¢Œ(€€€€ƒ¾ò#’â7šršr'švÇ¢–ÿ¢Š¯¢Žš:'¾ò'¾ò3¢º+–’ŸžjšZç–BG–&o––÷šb¿–ºžj–>7¦/žº_¾ò3’ú–n{–"–ÂÇ–:–rÃ’â7–.WŽ(€€€€ƒ¦v‹ž¦7–&o––÷šÊK¢º+žj¦
ž¢»¾ò#’ú/–š¦Vß–¾³’êKš>o¾ò'¢ÖÃ–æû’öW–æÏ–v¾òtÇ¾ò3–B3š¢šb¿–Â7ž¢ÇžjŽ€¨¼(€½¹ÍÐÁ…•É…µ•I•˜€ôÕÍ•I•˜ñìÜè¹Õµ‰•Èì è¹Õµ‰•Èôð¹Õ±°ø¡¹Õ±°¤ì(€ÕÍ•1…å½ÕÑ™™•Ð  ¤€ôøì(€€€½¹ÍÐÁÉ•Ø€ôÁ…•É…µ•I•˜¹ÕÉÉ•¹Ðì(€€€Á…•É…µ•I•˜¹ÕÉÉ•¹Ð€ôìÜèÁÉ•Ù¥•Ý\° èÁÉ•Ù¥•Ý ôì(€€€¥˜€ …ÁÉ•ØñðÁÉ•Ø¹Ü€ðô€ÀñðÁÉ•Ø¹ €ðô€ÀñðÁÉ•Ù¥•Ý\€ðô€ÀñðÁÉ•Ù¥•Ý €ðô€À¤É•ÑÕÉ¸ì(€€€€¼¼ƒ–>«šr'žržj¢º+’êš&7–.W¾ò À¸ÕÁàƒ’î—–ŸžVÛ’ösšÊK¢º+¾ò3¦ÿ–7¦?šâ³¢ª“–Þ»’âžnÓ¢žãžfó¾ò$(€€€¥˜€¡5…Ñ ¹…‰Ì¡ÁÉ•Ø¹Ü€´ÁÉ•Ù¥•Ý\¤€ð€À¸Ô€˜˜5…Ñ ¹…‰Ì¡ÁÉ•Ø¹ €´ÁÉ•Ù¥•Ý ¤€ð€À¸Ô¤É•ÑÕÉ¸ì(€€€½¹ÍÐÍà€ôÁÉ•Ù¥•Ý\€¼ÁÉ•Ø¹Üì(€€€½¹ÍÐÍä€ôÁÉ•Ù¥•Ý €¼ÁÉ•Ø¹ ì(€€€½¹ÍÐ…É•„€ôÍà€¨Íäì(€€€½¹ÍÐÌ€ô5…Ñ ¹…‰Ì¡5…Ñ ¹±½œ¡…É•„¤¤€ð€Å”´Ø(€€€€€€ü5…Ñ ¹ÍÅÉÐ¡…É•„¤€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦v‹ž¦7šÊK¢º+¾òk–§¦
+’êKš>o¾ò3’â7žâ»šRø(€€€€€€è€¡…É•„€ð€Ä€ü5…Ñ ¹µ¥¸¡Íà°Íä¤€è5…Ñ ¹µ…à¡Íà°Íä¤¤ì(€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡±¥ÍÐ€ôø±¥ÍÐ¹±•¹Ñ €ôôô€À€ü±¥ÍÐ€è±¥ÍÐ¹µ…À¡˜€ôøì(€€€€€€¼¨ƒž&#¦v‹žnKžj’â·–þ–ÂÇšb¼à€¬Ý¥‘Ñ ¼Ë¾ò!Í…±”ƒšb¿’î—’â·–þž
ë–:¦î{šRû–’Ÿžj¾ò0(€€€€€€€€ƒ¢š,ÝÉ…Á•¿¾ò'¾ò3š&’î—šB³’â·–þŽ–7š*+–Þ›’â+¢žKš:£–n{–:ï–ÂÇ–Â7’êŽ€¨¼(€€€€€½¹ÍÐà€ô€¡˜¹à€¬˜¹Ý¥‘Ñ €¼€È¤€¨Íàì(€€€€€½¹ÍÐä€ô€¡˜¹ä€¬˜¹¡•¥¡Ð€¼€È¤€¨Íäì(€€€€€É•ÑÕÉ¸ì€¸¸¹˜°Í…±”è˜¹Í…±”€¨Ì°àèà€´˜¹Ý¥‘Ñ €¼€È°äèä€´˜¹¡•¥¡Ð€¼€Èôì(€€€ô¤¤ì(€ô°mÁÉ•Ù¥•Ý\°ÁÉ•Ù¥•Ý!t¤ì((€€¼¨¨ƒ¦‚¦v‹¦‚–ê?š¢‡–ò?žâ»–Â?žj–7ž:¾òk¦¢Ã–ë’â/¦v‹¦
–§¦†š2'¦"Wžj¦®c–ê˜€¨¼(€€¼¨¨Éƒ¢þÓ–r#¢Ž‡¢šžR£–"Ãžj¦‚–¾³¾ò#’â7šÏ¢ºO¢þÓ–r#¢Þ¢F_š¾?š²„É•¹‘•Èƒ¦7š:o¾ò$€¨¼(€½¹ÍÐÁÉ•Ù¥•Ý]I•˜€ôÕÍ•I•˜¡ÁÉ•Ù¥•Ý\¤ì(€ÁÉ•Ù¥•Ý]I•˜¹ÕÉÉ•¹Ð€ôÁÉ•Ù¥•Ý\ì(€½¹ÍÐÁÉ•Ù¥•Ý!I•˜€ôÕÍ•I•˜¡ÁÉ•Ù¥•Ý ¤ì(€ÁÉ•Ù¥•Ý!I•˜¹ÕÉÉ•¹Ð€ôÁÉ•Ù¥•Ý ì(€½¹Ñ…¥¹•É]I•˜¹ÕÉÉ•¹Ð€ô½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ ì(€€¼¨¨(€€€¨ƒšÊKšr'žâ»šRû–.WžV¯–r£¢ÞGžjšf–g¾ò3šVÓš:Kžjž&#¦v‹–ÂÇšb¿žn»š¢g–7ž:¢¦Ëšr'žjš¢–¶CŽ(€€€¨ƒ¾ò#š>o¦‚šVãŽš>ož&#–z/š¾S’ú/Ž¢š[žª_–’Ÿ–Â?šRç¢º+¦÷¢ÖÃ¦g¢Ž‡¾òo–.WžV¯šr¦ZO’ê“žÖ˜Éƒš¾?’â–âŸ–¾¯Ž¾ò$(€€€¨¼(€ÕÍ•1…å½ÕÑ™™•Ð  ¤€ôøì(€€€¥˜€¡­¹¥µI•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€€¼¼ƒš&/š2¦
–r£žV¯–â’â+š6?–B#šf¾ò3–7ž:žRÇš&/–.‹š¾?’â–âŸžnÓš:—–¾¯¾ò3¦g¢Ž‡’â7¢šš>Kš&,(€€€¥˜€¡…¹Ù…Íi½½µI•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€­I•˜¹ÕÉÉ•¹Ð€ôÁ…•ÍM…±”ì(€€€€¼¨ƒšRû–’Ÿ–ú3¦®c–ê›¢Ú¦;–Þ—’ös–6šfÑ…É•Ðƒšršb¿¢Êƒ–ó¾ò3¦gš¶šb¿’þwš2’â·–þžâ»šRûš&¦ržj(€€€€€€ƒ’â+žžï¦?Ž’â7¢÷–’ûš"@€Ã¾ò3–B›–&ÍÑ…Ñ”ƒš>C’ê“–ú3–>#šrš*+žV¯–â–òß–"Û¢Êó–n{¦‚¦£Ž€¨¼(€€€ÍÑÉ¥ÁQ½ÁI•˜¹ÕÉÉ•¹Ð€ôµ½Ñ¥½¹5½‘•I•˜¹ÕÉÉ•¹Ð€ü€À€è(€€€€€€¡½¹Ñ…¥¹•ÉM¥é”¹¡•¥¡Ð€´ÁÉ•Ù¥•Ý €¨Á…•ÍM…±”¤€¼€Èì(€€€…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡Á…•ÍM…±”¤ì(€€€€¼¨ƒ¦š[š²‡¦?–"Ãžrš¶žV¯–â–Âë–¾ãšf¾ò3–æû’öWšržRÇ¦‚C¢¢·–ó–7šnÓšZÃ’âš²‡¾òo–*ƒ¢f’æ–þ¦‚#–r (€€€€€€ƒ–B3’â¢ò¨±…å½ÕÐƒ–ú3¦7šZÃ–ºk’ö7¾ò3’â7¢÷šÊÿžR£ž²³’âš²‡¦?šâ³žVg’â/žjdƒ’ö7žžïŽ€¨¼(€€€½¹ÍÐÉ…˜€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡Á½Í¥Ñ¥½¹A…•Ñ±Ì¤ì(€€€É•ÑÕÉ¸€ ¤€ôø…¹•±¹¥µ…Ñ¥½¹É…µ”¡É…˜¤ì(€ô°mÁ…•ÍM…±”°Á…•Ì¹±•¹Ñ °ÁÉ•Ù¥•Ý\°ÁÉ•Ù¥•Ý °½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ °½¹Ñ…¥¹•ÉM¥é”¹¡•¥¡Ð°…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä°Á½Í¥Ñ¥½¹A…•Ñ±Ít¤ì(€€¼¨¨ƒš‚ó–¶C–r£žV¯¦v‹’â+žj–¾›¦jo–’Ÿ–Â?šr’æc’â+šVÓžÖ’ö#–Æžjžâ»šRû¾òoš*+¢z‹–æW’ö7žžïš>ožº_š"Cš‚ó–Ÿ–?žžïšf¢š¢Þ¢F_’æcŽ€¨¼(€½¹ÍÐ±…å½ÕÑM…±”€ô…Ñ¥Ù•1…å½ÕÐü¹Ðü¹Í…±”€üü€Äì((€€¼¼A½¥¹Ñ•È•Ù•¹Ð¡…¹‘±•ÉÌ™½ÈÁ…¹¹¥¹œÑ¡”¥µ…”¥¹Í¥‘”Ñ¡”Í•±•Ñ••±°(€½¹ÍÐ¡…¹‘±•½¹Ñ•¹ÑA½¥¹Ñ•É½Ý¸€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ðñ!Q51¥Ù±•µ•¹Ðø°¥‘àè¹Õµ‰•È¤€ôøì(€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€„ôô¥‘à¤É•ÑÕÉ¸ì(€€€¥˜€¡¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€€¼¼ƒž²³’ê3š‚çš&/š2¢B÷’â/¾òw¢š¦ngš2žâ»šRû’ê¾òkš*+–æÏžžïšRÛš:'¾ò3’â7žÛ–§š‚çš&/š2žjžžï–.T(€€€€¼¼ƒšr¢ò«šÖ¢Š¯š.ÿ’úžVÛ–æÏžžï¦?¾ò3žŸž&–ÂÇ–r£–§š‚çš&/š2’æ/¦ZO’ê¢ÞÌ(€€€¥˜€¡Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð¤ì(€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð€ô™…±Í”ì(€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹•±±%‘à€ô€´Äì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€”¹ÕÉÉ•¹ÑQ…É•Ð¹Í•ÑA½¥¹Ñ•É…ÁÑÕÉ”¡”¹Á½¥¹Ñ•É%¤ì((€€€€¼¼I•Í•Ðµ½Ù”™±…œ™½È½¹Ñ•¹ÐÁ…¹¹¥¹œ(€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð€ôìàè”¹±¥•¹Ñ`°äè”¹±¥•¹Ñdôì((€€€½¹ÍÐ•±°€ô¥µ…•Ím¥‘átì(€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð€ôì(€€€€€¥ÍÉ…¥¹½¹Ñ•¹ÐèÑÉÕ”°(€€€€€Á½¥¹Ñ•É%è”¹Á½¥¹Ñ•É%°(€€€€€ÍÑ…ÉÑ`è”¹±¥•¹Ñ`°(€€€€€ÍÑ…ÉÑdè”¹±¥•¹Ñd°(€€€€€ÍÑ…ÉÑ=™™Í•Ñ`è•±°€ü•±°¹½™™Í•Ñ`€è€À°(€€€€€ÍÑ…ÉÑ=™™Í•Ñdè•±°€ü•±°¹½™™Í•Ñd€è€À°(€€€€€•±±%‘àè¥‘à(€€€ôì(€ôì((€½¹ÍÐ¡…¹‘±•½¹Ñ•¹ÑA½¥¹Ñ•É5½Ù”€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ðñ!Q51¥Ù±•µ•¹Ðø¤€ôøì(€€€¥˜€ …Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð¤É•ÑÕÉ¸ì(€€€€¼¼ƒ–"—žjš&/š2¾ò#š"[žâ»šRû’â·–K–ë’úžj’ê/’îÛ¾ò'’â7žº_¾òk–æÏžžï–>«¢Þ¢F_žVÛ–"wš2'’â/žj¦
’âš‚ä(€€€¥˜€¡”¹Á½¥¹Ñ•É%€„ôôÁ½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€¥˜€¡ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ðü¹µ½‘”€ôôô€Á¥¹ œ¤ì(€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð€ô™…±Í”ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð€ô™…±Í”ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì((€€€€¼¼¡•¬‘¥ÍÑ…¹”™½È±¥¬…¹•±±…Ñ¥½¸(€€€¥˜€¡Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€½¹ÍÐ‘à€ô”¹±¥•¹Ñ`€´Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹àì(€€€€€½¹ÍÐ‘ä€ô”¹±¥•¹Ñd€´Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹äì(€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ø€à¤ì(€€€€€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€ô(€€€ô((€€€½¹ÍÐìÍÑ…ÉÑ`°ÍÑ…ÉÑd°ÍÑ…ÉÑ=™™Í•Ñ`°ÍÑ…ÉÑ=™™Í•Ñd°•±±%‘àô€ôÁ½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ðì(€€€¥˜€¡•±±%‘à€ôôô€´Ä¤É•ÑÕÉ¸ì((€€€€¼¼ƒš‚ó–¶Cžj–¾³¦®cšb¿–Ÿ–ºç–Z»’ö7¾ò!ÁÉ•Ù¥•Ý_¾ò=ÁÉ•Ù¥•Ý#¾ò'¾ò3š&/š2šb¿¢z‹–æW–?žÒ€ƒŠSŠPƒ–#¦f“–n{–:ì(€€€½¹ÍÐ­Œ€ô­I•˜¹ÕÉÉ•¹Ðñð€Äì(€€€½¹ÍÐ‘à€ô€¡”¹±¥•¹Ñ`€´ÍÑ…ÉÑ`¤€¼­Œì(€€€½¹ÍÐ‘ä€ô€¡”¹±¥•¹Ñd€´ÍÑ…ÉÑd¤€¼­Œì((€€€½¹ÍÐÑ•µÁ±…Ñ•Ì€ôQ5A1Q}5Am¥µ…•Ì¹±•¹Ñ¡tñðmtì(€€€½¹ÍÐ…Ñ¥Ù•QµÁ°€ôÑ•µÁ±…Ñ•ÍmÑ•µÁ±…Ñ•%¹‘•átñðÑ•µÁ±…Ñ•ÍlÁtì(€€€¥˜€ ……Ñ¥Ù•QµÁ°¤É•ÑÕÉ¸ì((€€€½¹ÍÐÉ•Ð€ô…Ñ¥Ù•QµÁ°¹É•ÑÍm•±±%‘átì(€€€¥˜€ …É•Ð¤É•ÑÕÉ¸ì((€€€½¹ÍÐ•±±]¥‘Ñ €ôÉ•Ð¹Ü€¨ÁÉ•Ù¥•Ý\€¨±…å½ÕÑM…±”ì(€€€½¹ÍÐ•±±!•¥¡Ð€ôÉ•Ð¹ €¨ÁÉ•Ù¥•Ý €¨±…å½ÕÑM…±”ì((€€€¥˜€¡•±±]¥‘Ñ €ø€À€˜˜•±±!•¥¡Ð€ø€À¤ì(€€€€€½¹ÍÐ•±°€ô¥µ…•Ím•±±%‘átì(€€€€€½¹ÍÐÝ}¥µœ€ô•±°¹¹…ÑÕÉ…±]¥‘Ñ ñð€àÀÀì(€€€€€½¹ÍÐ¡}¥µœ€ô•±°¹¹…ÑÕÉ…±!•¥¡Ðñð€ØÀÀì((€€€€€½¹ÍÐ¥ÌäÁ½ÈÈÜÀ€ô€¡•±°¹É½Ñ…Ñ¥½¸€”€ÄàÀ¤€„ôô€Àì(€€€€€½¹ÍÐ‘É…Ý\€ô¥ÌäÁ½ÈÈÜÀ€ü¡}¥µœ€èÝ}¥µœì(€€€€€½¹ÍÐ‘É…Ý €ô¥ÌäÁ½ÈÈÜÀ€üÝ}¥µœ€è¡}¥µœì((€€€€€½¹ÍÐÍ…±•`€ô•±±]¥‘Ñ €¼‘É…Ý\ì(€€€€€½¹ÍÐÍ…±•d€ô•±±!•¥¡Ð€¼‘É…Ý ì(€€€€€½¹ÍÐ½Ù•ÉM…±”€ô5…Ñ ¹µ…à¡Í…±•`°Í…±•d¤ì(€€€€€½¹ÍÐ™¥¹…±M…±”€ô½Ù•ÉM…±”€¨•±°¹é½½´ì((€€€€€½¹ÍÐÉ½Ñ…Ñ•‘%µ\€ô¥ÌäÁ½ÈÈÜÀ€ü€¡¡}¥µœ€¨™¥¹…±M…±”¤€è€¡Ý}¥µœ€¨™¥¹…±M…±”¤ì(€€€€€½¹ÍÐÉ½Ñ…Ñ•‘%µ €ô¥ÌäÁ½ÈÈÜÀ€ü€¡Ý}¥µœ€¨™¥¹…±M…±”¤€è€¡¡}¥µœ€¨™¥¹…±M…±”¤ì((€€€€€½¹ÍÐµ…áM¡¥™Ñ`€ô5…Ñ ¹µ…à À°€¡É½Ñ…Ñ•‘%µ\€´•±±]¥‘Ñ ¤€¼€È¤€¼•±±]¥‘Ñ ì(€€€€€½¹ÍÐµ…áM¡¥™Ñd€ô5…Ñ ¹µ…à À°€¡É½Ñ…Ñ•‘%µ €´•±±!•¥¡Ð¤€¼€È¤€¼•±±!•¥¡Ðì((€€€€€½¹ÍÐ…±Õ±…Ñ•‘=™™Í•Ñ`€ôÍÑ…ÉÑ=™™Í•Ñ`€¬€¡‘à€¼•±±]¥‘Ñ ¤ì(€€€€€½¹ÍÐ…±Õ±…Ñ•‘=™™Í•Ñd€ôÍÑ…ÉÑ=™™Í•Ñd€¬€¡‘ä€¼•±±!•¥¡Ð¤ì((€€€€€±•Ð¹•Ý=™™Í•Ñ`€ô…±Õ±…Ñ•‘=™™Í•Ñ`ì(€€€€€±•Ð¹•Ý=™™Í•Ñd€ô…±Õ±…Ñ•‘=™™Í•Ñdì((€€€€€½¹ÍÐÍ¹…ÁQ¡É•Í¡½±€ô€À¸ÀÄÔì€¼¼M¹…ÁÁ¥¹œÑ¡É•Í¡½±((€€€€€€¼¼M¹…À€˜½±±¥Í¥½¸‘•Ñ•Ñ¥½¸™½È`(€€€€€¥˜€¡µ…áM¡¥™Ñ`€ø€À¤ì(€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡…±Õ±…Ñ•‘=™™Í•Ñ`€´µ…áM¡¥™Ñ`¤€ðôÍ¹…ÁQ¡É•Í¡½±¤ì(€€€€€€€€€¹•Ý=™™Í•Ñ`€ôµ…áM¡¥™Ñ`ì(€€€€€€€ô•±Í”¥˜€¡5…Ñ ¹…‰Ì¡…±Õ±…Ñ•‘=™™Í•Ñ`€´€ µµ…áM¡¥™Ñ`¤¤€ðôÍ¹…ÁQ¡É•Í¡½±¤ì(€€€€€€€€€¹•Ý=™™Í•Ñ`€ô€µµ…áM¡¥™Ñ`ì(€€€€€€€ô(€€€€€ô((€€€€€€¼¼M¹…À€˜½±±¥Í¥½¸‘•Ñ•Ñ¥½¸™½Èd(€€€€€¥˜€¡µ…áM¡¥™Ñd€ø€À¤ì(€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡…±Õ±…Ñ•‘=™™Í•Ñd€´µ…áM¡¥™Ñd¤€ðôÍ¹…ÁQ¡É•Í¡½±¤ì(€€€€€€€€€¹•Ý=™™Í•Ñd€ôµ…áM¡¥™Ñdì(€€€€€€€ô•±Í”¥˜€¡5…Ñ ¹…‰Ì¡…±Õ±…Ñ•‘=™™Í•Ñd€´€ µµ…áM¡¥™Ñd¤¤€ðôÍ¹…ÁQ¡É•Í¡½±¤ì(€€€€€€€€€¹•Ý=™™Í•Ñd€ô€µµ…áM¡¥™Ñdì(€€€€€€€ô(€€€€€ô((€€€€€€¼¼MÑÉ¥Ñ±ä±…µÀÑ¼ÁÉ•Ù•¹ÐÍ¡½Ý¥¹œ•µÁÑä‰±…¬…É•…Ì(€€€€€¹•Ý=™™Í•Ñ`€ô5…Ñ ¹µ…à µµ…áM¡¥™Ñ`°5…Ñ ¹µ¥¸¡µ…áM¡¥™Ñ`°¹•Ý=™™Í•Ñ`¤¤ì(€€€€€¹•Ý=™™Í•Ñd€ô5…Ñ ¹µ…à µµ…áM¡¥™Ñd°5…Ñ ¹µ¥¸¡µ…áM¡¥™Ñd°¹•Ý=™™Í•Ñd¤¤ì((€€€€€€¼¼•Ñ•Éµ¥¹”…Ñ¥Ù”½±±¥Í¥½¹Ì‰…Í•½¸™¥¹…°±…µÁ•Á½Í¥Ñ¥½¹Ì(€€€€€½¹ÍÐ½±±¥Í¥½¹5…É¥¸€ô€À¸ÀÀÄì(€€€€€½¹ÍÐ±•™Ñ½±±¥‘¥¹œ€ôµ…áM¡¥™Ñ`€ø€À€˜˜5…Ñ ¹…‰Ì¡¹•Ý=™™Í•Ñ`€´µ…áM¡¥™Ñ`¤€ðô½±±¥Í¥½¹5…É¥¸ì(€€€€€½¹ÍÐÉ¥¡Ñ½±±¥‘¥¹œ€ôµ…áM¡¥™Ñ`€ø€À€˜˜5…Ñ ¹…‰Ì¡¹•Ý=™™Í•Ñ`€´€ µµ…áM¡¥™Ñ`¤¤€ðô½±±¥Í¥½¹5…É¥¸ì(€€€€€½¹ÍÐÑ½Á½±±¥‘¥¹œ€ôµ…áM¡¥™Ñd€ø€À€˜˜5…Ñ ¹…‰Ì¡¹•Ý=™™Í•Ñd€´µ…áM¡¥™Ñd¤€ðô½±±¥Í¥½¹5…É¥¸ì(€€€€€½¹ÍÐ‰½ÑÑ½µ½±±¥‘¥¹œ€ôµ…áM¡¥™Ñd€ø€À€˜˜5…Ñ ¹…‰Ì¡¹•Ý=™™Í•Ñd€´€ µµ…áM¡¥™Ñd¤¤€ðô½±±¥Í¥½¹5…É¥¸ì((€€€€€Í•ÑÑ¥Ù•½±±¥Í¥½¹Ì¡ì(€€€€€€€±•™Ðè±•™Ñ½±±¥‘¥¹œ°(€€€€€€€É¥¡ÐèÉ¥¡Ñ½±±¥‘¥¹œ°(€€€€€€€Ñ½ÀèÑ½Á½±±¥‘¥¹œ°(€€€€€€€‰½ÑÑ½´è‰½ÑÑ½µ½±±¥‘¥¹œ(€€€€€ô¤ì((€€€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡¥µœ°¤¤€ôøì(€€€€€€€¥˜€¡¤€„ôô•±±%‘à¤É•ÑÕÉ¸¥µœì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€¸¸¹¥µœ°(€€€€€€€€€½™™Í•Ñ`è¹•Ý=™™Í•Ñ`°(€€€€€€€€€½™™Í•Ñdè¹•Ý=™™Í•Ñd(€€€€€€€ôì(€€€€€ô¤¤ì(€€€ô(€ôì((€½¹ÍÐ¡…¹‘±•½¹Ñ•¹ÑA½¥¹Ñ•ÉUÀ€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ðñ!Q51¥Ù±•µ•¹Ðø¤€ôøì(€€€¥˜€¡Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð¤ì(€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð€ô™…±Í”ì(€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹•±±%‘à€ô€´Äì(€€€€€Í•ÑÑ¥Ù•½±±¥Í¥½¹Ì¡ì±•™Ðè™…±Í”°É¥¡Ðè™…±Í”°Ñ½Àè™…±Í”°‰½ÑÑ½´è™…±Í”ô¤ì(€€€ô(€ôì((€€¼¼!Q50ÔÉ…œ…¹É½À¡…¹‘±•ÉÌ™½ÈÍÝ…ÁÁ¥¹œ¥µ…•Ì(€½¹ÍÐ¡…¹‘±•É…MÑ…ÉÐ€ô€¡”èI•…Ð¹É…Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø°¥‘àè¹Õµ‰•È¤€ôøì(€€€¥˜€¡Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð¤ì(€€€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€€¼¼M•Ð‘É…œ¥µ…”Ñ¼µ…Ñ Ñ¡”½É¥¥¹…°…ÍÁ•ÐÉ…Ñ¥¼Ý¥Ñ ¹¼É½Õ¹‘•½É¹•ÉÌ(€€€½¹ÍÐ¥µœ€ô”¹ÕÉÉ•¹ÑQ…É•Ð¹ÅÕ•ÉåM•±•Ñ½È ¥µœœ¤ì(€€€¥˜€¡¥µœ¤ì(€€€€€½¹ÍÐ½¹Ñ…¥¹•È€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ‘¥Øœ¤ì(€€€€€½¹ÍÐÝ}¹…Ð€ô¥µ…•Ím¥‘átü¹¹…ÑÕÉ…±]¥‘Ñ ñð¥µœ¹¹…ÑÕÉ…±]¥‘Ñ ñð€àÀÀì(€€€€€½¹ÍÐ¡}¹…Ð€ô¥µ…•Ím¥‘átü¹¹…ÑÕÉ…±!•¥¡Ðñð¥µœ¹¹…ÑÕÉ…±!•¥¡Ðñð€ØÀÀì(€€€€€½¹ÍÐ…ÍÁ•Ð€ôÝ}¹…Ð€¼¡}¹…Ðì((€€€€€€¼¼	…Í”Í¥é”½˜€ÈÀÁÁà½¸Ñ¡”±…É•ÈÍ¥‘”(€€€€€±•Ð‘É…\€ô€ÈÀÀì(€€€€€±•Ð‘É… €ô€ÈÀÀì(€€€€€¥˜€¡…ÍÁ•Ð€øô€Ä¤ì(€€€€€€€‘É…\€ô€ÈÀÀì(€€€€€€€‘É… €ô5…Ñ ¹É½Õ¹ ÈÀÀ€¼…ÍÁ•Ð¤ì(€€€€€ô•±Í”ì(€€€€€€€‘É…\€ô5…Ñ ¹É½Õ¹ ÈÀÀ€¨…ÍÁ•Ð¤ì(€€€€€€€‘É… €ô€ÈÀÀì(€€€€€ô((€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹Ý¥‘Ñ €ô€‘í‘É…]õÁá€ì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹¡•¥¡Ð€ô€‘í‘É…!õÁá€ì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹Á½Í¥Ñ¥½¸€ô€™¥á•œì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹Ñ½À€ô€œ´ÈÀÀÁÁàœì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹±•™Ð€ô€œ´ÈÀÀÁÁàœì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹é%¹‘•à€ô€œ´ääääœì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹‰½É‘•ÉI…‘¥ÕÌ€ô€œÁÁàœì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹½Ù•É™±½Ü€ô€¡¥‘‘•¸œì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹‰½É‘•È€ô€¹½¹”œì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹‰…­É½Õ¹‘½±½È€ô€œŒÀÀÀÀÀÀœì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹‰½áM¡…‘½Ü€ô€œÀ€ÄÉÁà€ÌÁÁàÉ‰„ À°À°À°À¸Ø¤œì(€€€€€½¹Ñ…¥¹•È¹ÍÑå±”¹Á½¥¹Ñ•ÉÙ•¹ÑÌ€ô€¹½¹”œì((€€€€€½¹ÍÐ±½¹•%µœ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ¥µœœ¤ì(€€€€€±½¹•%µœ¹ÍÉŒ€ô¥µ…•Ím¥‘átü¹ÕÉ°ñð¥µœ¹ÍÉŒì(€€€€€±½¹•%µœ¹ÍÑå±”¹Ý¥‘Ñ €ô€œÄÀÀ”œì(€€€€€±½¹•%µœ¹ÍÑå±”¹¡•¥¡Ð€ô€œÄÀÀ”œì(€€€€€±½¹•%µœ¹ÍÑå±”¹µ…á]¥‘Ñ €ô€¹½¹”œì(€€€€€±½¹•%µœ¹ÍÑå±”¹µ…á!•¥¡Ð€ô€¹½¹”œì(€€€€€±½¹•%µœ¹ÍÑå±”¹½‰©•Ñ¥Ð€ô€½Ù•Èœì(€€€€€±½¹•%µœ¹ÍÑå±”¹‰½É‘•ÉI…‘¥ÕÌ€ô€œÁÁàœì(€€€€€±½¹•%µœ¹ÍÑå±”¹ÑÉ…¹Í™½É´€ôÉ½Ñ…Ñ” ‘í¥µ…•Ím¥‘átü¹É½Ñ…Ñ¥½¸ñð€Áõ‘•œ¥€ì((€€€€€½¹Ñ…¥¹•È¹…ÁÁ•¹‘¡¥±¡±½¹•%µœ¤ì(€€€€€‘½Õµ•¹Ð¹‰½‘ä¹…ÁÁ•¹‘¡¥±¡½¹Ñ…¥¹•È¤ì(€€€€€”¹‘…Ñ…QÉ…¹Í™•È¹Í•ÑÉ…%µ…”¡½¹Ñ…¥¹•È°‘É…\€¼€È°‘É… €¼€È¤ì((€€€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€¥˜€¡½¹Ñ…¥¹•È¹Á…É•¹Ñ9½‘”¤ì(€€€€€€€€€½¹Ñ…¥¹•È¹Á…É•¹Ñ9½‘”¹É•µ½Ù•¡¥±¡½¹Ñ…¥¹•È¤ì(€€€€€€€ô(€€€€€ô°€À¤ì(€€€ô((€€€€¼¼]É…À¥¸Í•ÑQ¥µ•½ÕÐÍ¼Ñ¡”‰É½ÝÍ•È™¥¹¥Í¡•Ì…ÁÑÕÉ¥¹œÑ¡”‘É…œ¥µ…”‰•™½É”Ý”¡¥‘”Ñ¡”Í½ÕÉ”•±°Ì¥µ…”(€€€Í•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€Í•ÑÉ…•‘%¹‘•à¡¥‘à¤ì(€€€ô°€À¤ì((€€€”¹‘…Ñ…QÉ…¹Í™•È¹•™™•Ñ±±½Ý•€ô€µ½Ù”œì(€ôì((€½¹ÍÐ¡…¹‘±•É…=Ù•È€ô€¡”èI•…Ð¹É…Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø°¥‘àè¹Õµ‰•È¤€ôøì(€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€¥˜€¡‘É…•‘%¹‘•à€ôôô¹Õ±°ñð‘É…•‘%¹‘•à€ôôô¥‘à¤É•ÑÕÉ¸ì(€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôô‘É…•‘%¹‘•à¤É•ÑÕÉ¸ì(€€€Í•ÑÉ…=Ù•É%¹‘•à¡¥‘à¤ì(€ôì((€½¹ÍÐ¡…¹‘±•É…1•…Ù”€ô€ ¤€ôøì(€€€Í•ÑÉ…=Ù•É%¹‘•à¡¹Õ±°¤ì(€ôì((€½¹ÍÐ¡…¹‘±•É½À€ô€¡”èI•…Ð¹É…Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø°¥‘àè¹Õµ‰•È¤€ôøì(€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€¥˜€¡‘É…•‘%¹‘•à€ôôô¹Õ±°ñð‘É…•‘%¹‘•à€ôôô¥‘à¤É•ÑÕÉ¸ì(€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôô‘É…•‘%¹‘•à¤É•ÑÕÉ¸ì((€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€½¹ÍÐ½Áä€ôl¸¸¹ÁÉ•Ùtì(€€€€€½¹ÍÐÑ•µÀ€ôì€¸¸¹½Áåm‘É…•‘%¹‘•átôì(€€€€€€¼¼™Ñ•ÈÍÝ…ÁÁ¥¹œ°‰½Ñ ¥µ…•ÌµÕÍÐ‰•½µ”™Õ±±ä™¥±±¥¹œ½½ÕÁå¥¹œÑ¡”•±°€¡é½½´€ô€Ä¸À°½™™Í•Ñ`€ô€À°½™™Í•Ñd€ô€À¤(€€€€€½Áåm‘É…•‘%¹‘•át€ôì(€€€€€€€€¸¸¹½Áåm¥‘át°(€€€€€€€é½½´è€Ä¸À°(€€€€€€€½™™Í•Ñ`è€À°(€€€€€€€½™™Í•Ñdè€À(€€€€€ôì(€€€€€½Áåm¥‘át€ôì(€€€€€€€€¸¸¹Ñ•µÀ°(€€€€€€€é½½´è€Ä¸À°(€€€€€€€½™™Í•Ñ`è€À°(€€€€€€€½™™Í•Ñdè€À(€€€€€ôì(€€€€€É•ÑÕÉ¸½Áäì(€€€ô¤ì((€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôô‘É…•‘%¹‘•à¤ì(€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¥‘à¤ì(€€€ô•±Í”¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôô¥‘à¤ì(€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡‘É…•‘%¹‘•à¤ì(€€€ô((€€€Í•ÑÉ…•‘%¹‘•à¡¹Õ±°¤ì(€€€Í•ÑÉ…=Ù•É%¹‘•à¡¹Õ±°¤ì(€ôì((€½¹ÍÐ¡…¹‘±•É…¹€ô€ ¤€ôøì(€€€Í•ÑÉ…•‘%¹‘•à¡¹Õ±°¤ì(€€€Í•ÑÉ…=Ù•É%¹‘•à¡¹Õ±°¤ì(€ôì((€€¼¨¨ƒ–§šº×–ò?¦ã–>[¾òk–#¦ãšVÓžÖ’ö#–Æ¾ò3–ÞËžÚO¦ã’â·–B3’â–/’ö#–Æšf–7¦î{š&7¦ã–"Ã¢Ž‡¦v‹žjš‚ó–¶CŽ€¨¼(€½¹ÍÐÍ•±•Ñ•±±=É1…å½ÕÐ€ô€¡±…å½ÕÑ%èÍÑÉ¥¹œ°¥‘àè¹Õµ‰•È¤€ôøì(€€€€¼¼ƒ–§šº×–ò?¾òkž²³’âš²‡¦î{–#¦ãšVÓžÖ’ö#–Æ¾ò3–ÞËžÚO¦ã’â·–B3’â–/’ö#–Æšf–7¦î{š&7¦ã–"Ã¢Ž‡¦v‹žjš‚ó–¶CŽ(€€€¥˜€¡Í•±•Ñ•‘1…å½ÕÑ%€„ôô±…å½ÕÑ%¤ì(€€€€€Í•ÑM•±•Ñ•‘1…å½ÕÑ%¡±…å½ÕÑ%¤ì(€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¥‘à¤ì(€€€€¼¼ƒž¦ëš‚ó–¶C¢Š¯¦ã–"Ã–ÂÇžnÓš:—¦Z/¦ã–r[¾ò#¢žãš:Ÿžj–B#š"@±¥¬ƒšr¢Š¯¦bË¦7¢’š¦–"ÛšN/š:'¾ò3¦g¢Ž‡¢š¢«–ÞÇ¦Z/¾ò$(€€€½¹ÍÐ±…ä€ôÁ…•Ì¹™±…Ñ5…À¡À€ôøÀ¹±…å½ÕÑÌ¤¹™¥¹¡°€ôø°¹¥€ôôô±…å½ÕÑ%¤ì(€€€¥˜€¡±…ä€˜˜€…±…ä¹¥µ…•Ím¥‘átü¹ÕÉ°¤ì(€€€€€Í•ÑM±½ÑQ½UÁ±½…¡¥‘à¤ì(€€€€€É•Á±…•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ðü¹±¥¬ ¤ì(€€€ô(€ôì((€½¹ÍÐ¡…¹‘±••±±Q½Õ¡MÑ…ÉÐ€ô€¡”èI•…Ð¹Q½Õ¡Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø°¥‘àè¹Õµ‰•È°±…å½ÕÑ%èÍÑÉ¥¹œ¤€ôøì(€€€½¹ÍÐ¥ÍM•±•Ñ•€ôÍ•±•Ñ•‘%¹‘•à€ôôô¥‘àì((€€€€¼¼I•Í•ÐÑ½Õ µ½Ù•µ•¹ÐÑÉ…­¥¹œ(€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì((€€€€¼¼±•…È…¹ä•á¥ÍÑ¥¹œ±½¹œµÁÉ•ÍÌÑ¥µ•È(€€€¥˜€¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€±•…ÉQ¥µ•½ÕÐ¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€ô(€€€¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì((€€€€¼¼ƒ–ÞËžÚO¦ã’â·–"—žjšvÇ¢–ÿšf¾ò3¦g’âš&/–.‹–Æ³šZóŽ3žV¯–â–Æ“žÒkš&/–.‹Ž7¾ò#žžï–.T¿žâ»šRû¦ã’â·ž&§’îÛ¾ò'¾ò0(€€€€¼¼ƒ’â7¢š–r£¦g¢Ž‡–7–V–.W¦Vßš2'’ê“š>oš"[š‚ó–Ÿžâ»šRûŽ(€€€¥˜€¡Í•±•Ñ•‘±½…Ñ¥¹%¤É•ÑÕÉ¸ì(€€€€¼¼ƒ–"—žj’ö#–Æ¢Š¯¦ã–>[šf¾ò3š&/–.‹–Æ³šZó¦
–/’ö#–Æ (€€€¥˜€¡Í•±•Ñ•‘1…å½ÕÑ%€„ôô¹Õ±°€˜˜Í•±•Ñ•‘1…å½ÕÑ%€„ôô±…å½ÕÑ%¤É•ÑÕÉ¸ì(€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°€˜˜Í•±•Ñ•‘%¹‘•à€„ôô¥‘à¤É•ÑÕÉ¸ì(€€€€¼¼ƒ¢¢ï¾òk¦g–/’ö#–ÆšVÓžÖ¢Š¯¦ã–>[šf’î7žÛ–¢¢Ç–ú’â/¢ÖÀƒŠSŠPƒž~·š.[šnÏšršB³šVÓžÖ’ö#–Æ¾ò0(€€€€¼¼€€€€ƒ’ö¦Vßš2$€ÄÔÁµÌƒ’æ/–ú3–ÂÇ–"š>oš"CŽ3š.[šnÏ’ê“š>o¦g’âš‚óžjžŸž&Ž7Ž((€€€¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€È¤ì(€€€€€€¼¨ƒž²³’ê3š‚çš&/š2’î¢†£žò§šRû¾ò3’â7¢ºë¦Vÿš2'¢º‡š^Ûšb¿–B›–"k––÷–ÞËžî?š"Cž®/¾ò3¦÷ž®/–"ï–º3šVÓ–>[šÚ (€€€€€€€€ƒ–nûž&’ê“š6‹ž*Ûš¾ò3’â7¢÷–>«šâÑ¥µ•Èƒ–6Óš*+–ÞËžî?žRï–ëžjžò§–nûžVg–r£žRï¦v‹’â+Ž€¨¼(€€€€€Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€Á•¹‘¥¹1½¹AÉ•ÍÍA½ÍI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€Í•ÑQ½Õ¡É…•‘%¹‘•à¡¹Õ±°¤ì(€€€€€Í•ÑQ½Õ¡É…=Ù•É%¹‘•à¡¹Õ±°¤ì(€€€€€Í•ÑMÝ…Á=Ù•ÉQ…É•Ð¡¹Õ±°¤ì(€€€€€€¼¼ƒšVÓžÖ’ö#–Æ¢Š¯¦ã–>[šf¾ò3¦ngš2šb¿¢šžâ»šRûŽ3šVÓžÖŽ7¾òoš&/š2–&o––÷¢B÷–r£š~C’âš‚ó’â+¦vˆ(€€€€€€¼¼ƒ’â7’î¢†£¢šžâ»¦
’âš‚ó¢Ž‡žjžŸž&¾ò3¦g¢Ž‡žnÓš:—¢ºOžÖ›’ö#–Æ¢«–ÞÇžj¢fWžB–f (€€€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôô¹Õ±°¤ì(€€€€€€€Ñ½Õ¡i½½µMÑ…Ñ”¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€Ý…Íi½½µ¥¹I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€¼¼A¥¹ µÑ¼µé½½´ÍÑ…ÉÐ(€€€€€½¹ÍÐ‘¥ÍÐ€ô5…Ñ ¹¡åÁ½Ð (€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`°(€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd(€€€€€€¤ì(€€€€€Ñ½Õ¡i½½µMÑ…Ñ”¹ÕÉÉ•¹Ð€ôì(€€€€€€€ÍÑ…ÉÑ¥ÍÐè‘¥ÍÐ°(€€€€€€€ÍÑ…ÉÑi½½´è¥µ…•Ím¥‘átü¹é½½´ñð€Ä¸À°(€€€€€ôì(€€€€€€¼¼…¹•°Á½¥¹Ñ•ÈÁ…¹¹¥¹œ(€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð€ô™…±Í”ì(€€€ô•±Í”¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €ôôô€Ä¤ì(€€€€€Ý…Íi½½µ¥¹I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€€¼¼AÉ•Ù•¹Ð‘É…¥¹œ•µÁÑä•±±Ì(€€€€€½¹ÍÐÑ¡¥Í1…å½ÕÐ€ôÁ…•Ì¹™±…Ñ5…À¡À€ôøÀ¹±…å½ÕÑÌ¤¹™¥¹¡°€ôø°¹¥€ôôô±…å½ÕÑ%¤ì(€€€€€¥˜€ …Ñ¡¥Í1…å½ÕÐü¹¥µ…•Ím¥‘átü¹ÕÉ°¤ì(€€€€€€€€¼¼ƒž¦ëš‚ó–¶CšÊKšr'¦Vßš2'’ê“š>o¾ò3’ö’î7¢š¢¢c¢Öß¦î{¾ò3šîG–.Wšfš&7–"“šZß–ú_–ë¦gšb¿š.[šnÏ¢3’â7šb¿¦î{šN((€€€€€€€Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð€ôìàè”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`°äè”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñdôì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô((€€€€€½¹ÍÐÑ½Õ €ô”¹Ñ½Õ¡•ÍlÁtì(€€€€€Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð€ôìàèÑ½Õ ¹±¥•¹Ñ`°äèÑ½Õ ¹±¥•¹Ñdôì(€€€€€Á•¹‘¥¹1½¹AÉ•ÍÍA½ÍI•˜¹ÕÉÉ•¹Ð€ôìàèÑ½Õ ¹±¥•¹Ñ`°äèÑ½Õ ¹±¥•¹Ñdôì(€€€€€•±±MÝ¥Á•I•˜¹ÕÉÉ•¹Ð€ôì±…ÍÑ`èÑ½Õ ¹±¥•¹Ñ`°…Ñ¥Ù”è™…±Í”ôì((€€€€€€¼¨ƒ¦Vßš2'¦ZšªïŽ–:šr°€ÄÔÁµÌƒ–’«ž~·¾ò3š&/š2ž¢7–ú»–s’â’â/–ÂÇ¢Š¯–"“–ºkš"CŽ3¢šš.[–:ï’ê“š>oŽ7¾ò0(€€€€€€€€ƒšîG–.W¢"¦î{¦ã¦÷–ú#–ºçšbO¢ª“¢žãŽÈÔÁµÌƒšb¿š.[šnÏš:K–ê?–âã¢š/žjš&/š¾òk¦
šb¿ž®/–6Ï¾ò0(€€€€€€€€ƒ’ö–ÞËžÚO¦;’êŽ3š&/š2–&ošRû’â+–:ï¦
’âžz³¦ZOŽ7Ž€¨¼(€€€€€±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€½¹ÍÐÁ½¥¹Ð€ôÁ•¹‘¥¹1½¹AÉ•ÍÍA½ÍI•˜¹ÕÉÉ•¹ÐñðìàèÑ½Õ ¹±¥•¹Ñ`°äèÑ½Õ ¹±¥•¹Ñdôì(€€€€€€€¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì((€€€€€€€€¼¼¹ÍÕÉ”Á½¥¹Ñ•È½¹Ñ•¹Ð‘É…¥¹œ¥Ì™Õ±±ä‘¥Í…‰±•Ý¡•¸±½¹œµÁÉ•ÍÌÑÉ¥•ÉÌ(€€€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð€ô™…±Í”ì(€€€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹•±±%‘à€ô€´Äì(€€€€€€€€¼¼ƒ¦Vßš2'’ê“š>o–.w¦;Ž3šB³–.WšVÓžÖ’ö#–ÆŽ7¢"žV¯–âš6Ë–.T(€€€€€€€±…å½ÕÑ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€ÍÑ½Á%¹•ÉÑ¥„ ¤ì(€€€€€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì((€€€€€€€€¼¼Y¥‰É…Ñ”Ñ¼¥Ù”Á¡åÍ¥…°™••‘‰…¬Ñ¼Ñ¡”ÕÍ•È€¡¥˜ÍÕÁÁ½ÉÑ•¤(€€€€€€€¥˜€¡¹…Ù¥…Ñ½È¹Ù¥‰É…Ñ”¤ì(€€€€€€€€€¹…Ù¥…Ñ½È¹Ù¥‰É…Ñ” ÐÀ¤ì(€€€€€€€ô((€€€€€€€€¼¼%¹¥Ñ¥…±¥é”ÕÍÑ½´Ñ½Õ ‘É…œÍÑ…Ñ”(€€€€€€€Ñ½Õ¡A½ÍI•˜¹ÕÉÉ•¹Ð€ôÁ½¥¹Ðì(€€€€€€€Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð€ôì(€€€€€€€€€ÍÑ…ÉÑ`èÁ½¥¹Ð¹à°(€€€€€€€€€ÍÑ…ÉÑdèÁ½¥¹Ð¹ä°(€€€€€€€€€ÕÉÉ•¹Ñ%¹‘•àè¥‘à°(€€€€€€€€€¡…Í5½Ù•èÑÉÕ”°€¼¼MÑ…ÉÑ•Ý¥Ñ ±½¹œµÁÉ•ÍÌ°µ…É¬…Ìµ½Ù•Í¼Ñ¡”™±½…Ñ¥¹œÁÉ•Ù¥•ÜÍ¡½ÝÌÕÀ„(€€€€€€€ôì((€€€€€€€Í•ÑQ½Õ¡É…•‘%¹‘•à¡¥‘à¤ì(€€€€€ô°1=9}AIMM}5L¤ì(€€€ô(€ôì((€½¹ÍÐ¡…¹‘±••±±Q½Õ¡5½Ù”€ô€¡”èI•…Ð¹Q½Õ¡Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø°¥‘àè¹Õµ‰•È°±…å½ÕÑ%èÍÑÉ¥¹œ¤€ôøì(€€€½¹ÍÐ¥ÍM•±•Ñ•€ôÍ•±•Ñ•‘%¹‘•à€ôôô¥‘àì((€€€¥˜€¡Ñ½Õ¡i½½µMÑ…Ñ”¹ÕÉÉ•¹Ð€˜˜”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€È¤ì(€€€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€½¹ÍÐÕÉÉ•¹Ñ¥ÍÐ€ô5…Ñ ¹¡åÁ½Ð (€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`°(€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd(€€€€€€¤ì(€€€€€½¹ÍÐ™…Ñ½È€ôÕÉÉ•¹Ñ¥ÍÐ€¼Ñ½Õ¡i½½µMÑ…Ñ”¹ÕÉÉ•¹Ð¹ÍÑ…ÉÑ¥ÍÐì(€€€€€±•Ð¹•Ýi½½´€ôÑ½Õ¡i½½µMÑ…Ñ”¹ÕÉÉ•¹Ð¹ÍÑ…ÉÑi½½´€¨™…Ñ½Èì(€€€€€¹•Ýi½½´€ô5…Ñ ¹µ…à Ä¸À°5…Ñ ¹µ¥¸ Ô¸À°¹•Ýi½½´¤¤ì((€€€€€€¼¼…±Õ±…Ñ”…¹±…µÀ½™™Í•ÑÌÍ¥µÕ±Ñ…¹•½ÕÍ±ä¥¹Í¥‘”Ñ¡”ÍÑ…Ñ”Í•ÑÑ•È(€€€€€€¼¼Ñ¼½µÁ±•Ñ•±äÁÉ•Ù•¹Ð…¹ä™É…µ”™É½´Í¡½Ý¥¹œ•µÁÑäÍÁ…”‰½É‘•ÉÌ(€€€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡•±°°¤¤€ôøì(€€€€€€€¥˜€¡¤€„ôô¥‘à¤É•ÑÕÉ¸•±°ì((€€€€€€€½¹ÍÐÑ•µÁ±…Ñ•Ì€ôQ5A1Q}5AmÁÉ•Ø¹±•¹Ñ¡tñðmtì(€€€€€€€½¹ÍÐ…Ñ¥Ù•QµÁ°€ôÑ•µÁ±…Ñ•ÍmÑ•µÁ±…Ñ•%¹‘•átñðÑ•µÁ±…Ñ•ÍlÁtì(€€€€€€€½¹ÍÐÉ•Ð€ô…Ñ¥Ù•QµÁ°ü¹É•ÑÍm¥tì(€€€€€€€¥˜€ …É•Ð¤É•ÑÕÉ¸ì€¸¸¹•±°°é½½´è¹•Ýi½½´ôì((€€€€€€€½¹ÍÐ•±±]¥‘Ñ €ôÉ•Ð¹Ü€¨ÁÉ•Ù¥•Ý\ì(€€€€€€€½¹ÍÐ•±±!•¥¡Ð€ôÉ•Ð¹ €¨ÁÉ•Ù¥•Ý ì(€€€€€€€¥˜€¡•±±]¥‘Ñ €ðô€Àñð•±±!•¥¡Ð€ðô€À¤É•ÑÕÉ¸ì€¸¸¹•±°°é½½´è¹•Ýi½½´ôì((€€€€€€€½¹ÍÐÝ}¥µœ€ô•±°¹¹…ÑÕÉ…±]¥‘Ñ ñð€àÀÀì(€€€€€€€½¹ÍÐ¡}¥µœ€ô•±°¹¹…ÑÕÉ…±!•¥¡Ðñð€ØÀÀì(€€€€€€€½¹ÍÐ¥ÌäÁ½ÈÈÜÀ€ô€¡•±°¹É½Ñ…Ñ¥½¸€”€ÄàÀ¤€„ôô€Àì(€€€€€€€½¹ÍÐ‘É…Ý\€ô¥ÌäÁ½ÈÈÜÀ€ü¡}¥µœ€èÝ}¥µœì(€€€€€€€½¹ÍÐ‘É…Ý €ô¥ÌäÁ½ÈÈÜÀ€üÝ}¥µœ€è¡}¥µœì((€€€€€€€½¹ÍÐÍ…±•`€ô•±±]¥‘Ñ €¼‘É…Ý\ì(€€€€€€€½¹ÍÐÍ…±•d€ô•±±!•¥¡Ð€¼‘É…Ý ì(€€€€€€€½¹ÍÐ½Ù•ÉM…±”€ô5…Ñ ¹µ…à¡Í…±•`°Í…±•d¤ì(€€€€€€€½¹ÍÐ™¥¹…±M…±”€ô½Ù•ÉM…±”€¨¹•Ýi½½´ì((€€€€€€€½¹ÍÐÉ½Ñ…Ñ•‘%µ\€ô¥ÌäÁ½ÈÈÜÀ€ü€¡¡}¥µœ€¨™¥¹…±M…±”¤€è€¡Ý}¥µœ€¨™¥¹…±M…±”¤ì(€€€€€€€½¹ÍÐÉ½Ñ…Ñ•‘%µ €ô¥ÌäÁ½ÈÈÜÀ€ü€¡Ý}¥µœ€¨™¥¹…±M…±”¤€è€¡¡}¥µœ€¨™¥¹…±M…±”¤ì((€€€€€€€½¹ÍÐµ…áM¡¥™Ñ`€ô5…Ñ ¹µ…à À°€¡É½Ñ…Ñ•‘%µ\€´•±±]¥‘Ñ ¤€¼€È¤€¼•±±]¥‘Ñ ì(€€€€€€€½¹ÍÐµ…áM¡¥™Ñd€ô5…Ñ ¹µ…à À°€¡É½Ñ…Ñ•‘%µ €´•±±!•¥¡Ð¤€¼€È¤€¼•±±!•¥¡Ðì((€€€€€€€½¹ÍÐ¹•Ý=™™Í•Ñ`€ô5…Ñ ¹µ…à µµ…áM¡¥™Ñ`°5…Ñ ¹µ¥¸¡µ…áM¡¥™Ñ`°•±°¹½™™Í•Ñ`¤¤ì(€€€€€€€½¹ÍÐ¹•Ý=™™Í•Ñd€ô5…Ñ ¹µ…à µµ…áM¡¥™Ñd°5…Ñ ¹µ¥¸¡µ…áM¡¥™Ñd°•±°¹½™™Í•Ñd¤¤ì((€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€¸¸¹•±°°(€€€€€€€€€é½½´è¹•Ýi½½´°(€€€€€€€€€½™™Í•Ñ`è¹•Ý=™™Í•Ñ`°(€€€€€€€€€½™™Í•Ñdè¹•Ý=™™Í•Ñd(€€€€€€€ôì(€€€€€ô¤¤ì(€€€ô•±Í”¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €ôôô€Ä¤ì(€€€€€¥˜€¡Ý…Íi½½µ¥¹I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€¼¼AÉ•Ù•¹Ð‘É…œ‰•¡…Ù¥½È¥˜Ý”Ý•É”©ÕÍÐé½½µ¥¹œ…¹½¹”™¥¹•È¥ÌÍÑ¥±°‘½Ý¸(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€½¹ÍÐÑ½Õ €ô”¹Ñ½Õ¡•ÍlÁtì(€€€€€Á•¹‘¥¹1½¹AÉ•ÍÍA½ÍI•˜¹ÕÉÉ•¹Ð€ôìàèÑ½Õ ¹±¥•¹Ñ`°äèÑ½Õ ¹±¥•¹Ñdôì(€€€€€€(€€€€€¥˜€¡Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€½¹ÍÐ‘à€ôÑ½Õ ¹±¥•¹Ñ`€´Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹àì(€€€€€€€½¹ÍÐ‘ä€ôÑ½Õ ¹±¥•¹Ñd€´Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹äì(€€€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ø€à¤ì(€€€€€€€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€€€ô(€€€€€ô((€€€€€€¼¼%˜±½¹œÁÉ•ÍÌ¡…Ì¹½ÐÑÉ¥•É•å•Ð°¡•¬¥˜™¥¹•Èµ½Ù•Ñ½¼™…ÈÑ¼…¹•°(€€€€€¥˜€ …¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€¥˜€¡Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€½¹ÍÐ‘à€ôÑ½Õ ¹±¥•¹Ñ`€´Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹àì(€€€€€€€€€½¹ÍÐ‘ä€ôÑ½Õ ¹±¥•¹Ñd€´Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹äì(€€€€€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ø€ÄÀ¤ì(€€€€€€€€€€€€¼¼…¹•°±½¹œÁÉ•ÍÌÑ¥µ•½ÕÐ(€€€€€€€€€€€¥˜€¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€±•…ÉQ¥µ•½ÕÐ¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€ô(€€€€€€€É•ÑÕÉ¸ì€¼¼M­¥À‘É…¥¹œ‰•¡…Ù¥½ÈÕ¹Ñ¥°±½¹œÁÉ•ÍÍ•(€€€€€ô((€€€€€¥˜€¡Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¤ì(€€€€€€€€¼¼AÉ•Ù•¹Ð‘•™…Õ±ÐÍÉ••¸ÍÉ½±±¥¹œ‘ÕÉ¥¹œµ½‰¥±”Ñ½Õ ‘É…Ì(€€€€€€€¥˜€¡”¹…¹•±…‰±”¤ì(€€€€€€€€€”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€€€ô((€€€€€€€½¹ÍÐ™±½…Ñ¥¹°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% µ½‰¥±”µ‘É…œµ™±½…Ñ¥¹œµÑ¡Õµ‰¹…¥°œ¤ì(€€€€€€€¥˜€¡™±½…Ñ¥¹°¤ì(€€€€€€€€€™±½…Ñ¥¹°¹ÍÑå±”¹ÑÉ…¹Í™½É´€ôÑÉ…¹Í±…Ñ”Í ‘íÑ½Õ ¹±¥•¹ÑaõÁà°€‘íÑ½Õ ¹±¥•¹ÑeõÁà°€À¤ÑÉ…¹Í±…Ñ” ´ÔÀ”°€´ÔÀ”¤Í…±” Ä¸ÄÔ¤É½Ñ…Ñ” Ñ‘•œ¥€ì(€€€€€€€ô((€€€€€€€½¹ÍÐ‘à€ôÑ½Õ ¹±¥•¹Ñ`€´Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¹ÍÑ…ÉÑ`ì(€€€€€€€½¹ÍÐ‘ä€ôÑ½Õ ¹±¥•¹Ñd€´Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¹ÍÑ…ÉÑdì((€€€€€€€Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¹¡…Í5½Ù•€ôÑÉÕ”ì(€€€€€€€€(€€€€€€€½¹ÍÐ¡½Ù•É•‘%‘à€ô•Ñ•±±%¹‘•áÉ½µA½¥¹Ð¡Ñ½Õ ¹±¥•¹Ñ`°Ñ½Õ ¹±¥•¹Ñd¤ì(€€€€€€€¥˜€¡¡½Ù•É•‘%‘à€„ôôÑ½Õ¡É…=Ù•É%¹‘•áI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€Ñ½Õ¡É…=Ù•É%¹‘•áI•˜¹ÕÉÉ•¹Ð€ô¡½Ù•É•‘%‘àì(€€€€€€€€€Í•ÑQ½Õ¡É…=Ù•É%¹‘•à¡¡½Ù•É•‘%‘à¤ì(€€€€€€€ô(€€€€€€€€¼¼•±°…¸…±Í¼‰”‘É½ÁÁ•½¹Ñ¼„™É•”µÍÑ…¹‘¥¹œ¥µ…”¸(€€€€€€€½¹ÍÐÍÝ…ÁQ…É•Ð€ô•ÑMÝ…ÁQ…É•ÑÉ½µA½¥¹Ð¡Ñ½Õ ¹±¥•¹Ñ`°Ñ½Õ ¹±¥•¹Ñd¤ì(€€€€€€€Í•ÑMÝ…Á=Ù•ÉQ…É•Ð¡ÍÝ…ÁQ…É•Ð€˜˜ÍÝ…ÁQ…É•Ð¹­¥¹€ôôô€™±½…Ñ¥¹œœ€üÍÝ…ÁQ…É•Ð€è¹Õ±°¤ì(€€€€€ô(€€€ô(€ôì((€½¹ÍÐ¡…¹‘±••±±Q½Õ¡¹€ô€¡”èI•…Ð¹Q½Õ¡Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø°¥‘àè¹Õµ‰•È°±…å½ÕÑ%èÍÑÉ¥¹œ¤€ôøì(€€€¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €ôôô€À¤ì(€€€€€Ý…Íi½½µ¥¹I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€ô((€€€€¼¼±•…È…¹ä…Ñ¥Ù”±½¹œµÁÉ•ÍÌÑ¥µ•È(€€€¥˜€¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€±•…ÉQ¥µ•½ÕÐ¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€ô((€€€¥˜€¡Ñ½Õ¡i½½µMÑ…Ñ”¹ÕÉÉ•¹Ð¤ì(€€€€€Ñ½Õ¡i½½µMÑ…Ñ”¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€ô((€€€¥˜€¡Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¤ì(€€€€€¥˜€¡¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð€˜˜Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¹¡…Í5½Ù•¤ì(€€€€€€€€¼¼A•É™½É´Q½Õ MÝ…À(€€€€€€€½¹ÍÐÑ…É•Ñ=Ù•É%¹‘•à€ôÑ½Õ¡É…=Ù•É%¹‘•áI•˜¹ÕÉÉ•¹Ðì(€€€€€€€½¹ÍÐ™±½…ÑQ…É•Ð€ôÍÝ…Á=Ù•ÉI•˜¹ÕÉÉ•¹Ðì(€€€€€€€½¹ÍÐ™É½µ%‘à€ôÑ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¹ÕÉÉ•¹Ñ%¹‘•àì((€€€€€€€¥˜€¡™±½…ÑQ…É•Ð€˜˜™±½…ÑQ…É•Ð¹­¥¹€ôôô€™±½…Ñ¥¹œœ¤ì(€€€€€€€€€Ù½¥…ÁÁ±åMÝ…À¡ì­¥¹è€•±°œ°¥‘àè™É½µ%‘à°ÍÉŒè¥µ…•Ím™É½µ%‘átü¹ÕÉ°ñð€œœô°™±½…ÑQ…É•Ð¤ì(€€€€€€€ô•±Í”¥˜€¡Ñ…É•Ñ=Ù•É%¹‘•à€„ôô¹Õ±°€˜˜Ñ…É•Ñ=Ù•É%¹‘•à€„ôô™É½µ%‘à¤ì(€€€€€€€€€½¹ÍÐÑ½%‘à€ôÑ…É•Ñ=Ù•É%¹‘•àì((€€€€€€€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€€€€€€€½¹ÍÐ½Áä€ôl¸¸¹ÁÉ•Ùtì(€€€€€€€€€€€½¹ÍÐÑ•µÀ€ôì€¸¸¹½Áåm™É½µ%‘átôì(€€€€€€€€€€€½Áåm™É½µ%‘át€ôì(€€€€€€€€€€€€€€¸¸¹½ÁåmÑ½%‘át°(€€€€€€€€€€€€€é½½´è€Ä¸À°(€€€€€€€€€€€€€½™™Í•Ñ`è€À°(€€€€€€€€€€€€€½™™Í•Ñdè€À(€€€€€€€€€€€ôì(€€€€€€€€€€€½ÁåmÑ½%‘át€ôì(€€€€€€€€€€€€€€¸¸¹Ñ•µÀ°(€€€€€€€€€€€€€é½½´è€Ä¸À°(€€€€€€€€€€€€€½™™Í•Ñ`è€À°(€€€€€€€€€€€€€½™™Í•Ñdè€À(€€€€€€€€€€€ôì(€€€€€€€€€€€É•ÑÕÉ¸½Áäì(€€€€€€€€€ô¤ì((€€€€€€€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôô™É½µ%‘à¤ì(€€€€€€€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡Ñ½%‘à¤ì(€€€€€€€€€ô•±Í”¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôôÑ½%‘à¤ì(€€€€€€€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡™É½µ%‘à¤ì(€€€€€€€€€ô(€€€€€€€ô(€€€€€ô•±Í”ì(€€€€€€€€¼¼M¥µÁ±”Ñ½Õ Ñ…À€´Í•±•ÐÑ¡”•±°€¡½¹±ä¥˜Ý”‘¥‘¸Ðµ½Ù”½‘É…œ¤(€€€€€€€¥˜€ …‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€Í•±•Ñ•±±=É1…å½ÕÐ¡±…å½ÕÑ%°¥‘à¤ì(€€€€€€€ô(€€€€€ô((€€€€€Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€Ñ½Õ¡É…=Ù•É%¹‘•áI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€Í•ÑQ½Õ¡É…•‘%¹‘•à¡¹Õ±°¤ì(€€€€€Í•ÑQ½Õ¡É…=Ù•É%¹‘•à¡¹Õ±°¤ì(€€€€€Í•ÑMÝ…Á=Ù•ÉQ…É•Ð¡¹Õ±°¤ì(€€€€€Ñ½Õ¡A½ÍI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€ô•±Í”ì(€€€€€€¼¼I•Õ±…ÈÑ½Õ É•±•…Í”Ý¥Ñ¡½ÕÐÍÑ…ÉÑ¥¹œ‘É…œÍÑ…Ñ”(€€€€€¥˜€ …¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð€˜˜€…‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€Í•±•Ñ•±±=É1…å½ÕÐ¡±…å½ÕÑ%°¥‘à¤ì(€€€€€ô(€€€ô((€€€¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€Ñ½Õ¡MÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€Á•¹‘¥¹1½¹AÉ•ÍÍA½ÍI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€•±±MÝ¥Á•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€Ñ½Õ¡!…¹‘±•‘ÑI•˜¹ÕÉÉ•¹Ð€ô…Ñ”¹¹½Ü ¤ì(€ôì((€€¼¼±•…¹ÕÀ±½¹œÁÉ•ÍÌÑ¥µ•È½¸Õ¹µ½Õ¹Ð(€ÕÍ•™™•Ð  ¤€ôøì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€¥˜€¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€±•…ÉQ¥µ•½ÕÐ¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€ô(€€€ôì(€ô°mt¤ì((€€¼¨¨ƒ¦gš&ç–2¿–—žj–r[–>«šRû’âš²‡¾ò#ž¶'ž&#¦v‹¦?––÷’æ/–ú3š&7šRû¾ò3¢š/’â/¦v‹¾ò$€¨¼(€½¹ÍÐ¥¹¥Ñ¥…±A±…•‘I•˜€ôÕÍ•I•˜¡™…±Í”¤ì((€€¼¼%¹¥Ñ¥…±¥é”Ý¥Ñ ¥¹¥Ñ¥…±¥±•Ì¥˜ÁÉ½Ù¥‘•(€ÕÍ•™™•Ð  ¤€ôøì(€€€€¼¨ƒ’â–ºk¢šž¶'žV¯–â¦?––÷š&7šRûŽ(€€€€€€ƒ¦gšR¿’î—–&7–>«š:o–r m¥¹¥Ñ¥…±¥±•Ítƒ’â+¾ò3ž²³’âš²‡–~ß¢†3šf½¹Ñ…¥¹•ÉM¥é”ƒ¦
šb¼€ÀƒŠSŠP(€€€€€€ÁÉ•Ù¥•Ý\½ÁÉ•Ù¥•Ý ƒ¦
šf–gšb¿’þw–êWžj€ÄÔÃ\ÈÀÃ¾ò3¢3’â7šb¿žrš¶žj¦‚¦v‹–’Ÿ–Â?Ž(€€€€€€ƒšZóšb¿Ž3žö»’â·Ž7šb¿žœ€ÄÔÃ\ÈÀÀƒžº_žj¾ò3š>ožº_–"Ãžržj¦‚¦v‹’â+–ÂÇ¢º+š"C–?–Þ›’â+’â–’Ÿ–†+Ž(€€€€€€ƒšRçš"Cž¶$½¹Ñ…¥¹•É5•…ÍÕÉ•ƒ’æ/–ú3š&7šRû¾ò3ž²³’â–ò×š&7šržržj–r£š¶’â·–’»Ž€¨¼(€€€¥˜€ …½¹Ñ…¥¹•É5•…ÍÕÉ•¤É•ÑÕÉ¸ì(€€€¥˜€¡¥¹¥Ñ¥…±A±…•‘I•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€¥˜€¡¥¹¥Ñ¥…±¥±•Ì€˜˜¥¹¥Ñ¥…±¥±•Ì¹±•¹Ñ €ø€À¤ì(€€€€€¥¹¥Ñ¥…±A±…•‘I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€½¹ÍÐ™¥±•ÍQ½1½…€ô¥¹¥Ñ¥…±¥±•Ì¹Í±¥” À°€ÈÔ¤ì(€€€€€½¹ÍÐ±½…‘%¹¥Ñ¥…°€ô…Íå¹Œ€ ¤€ôøì(€€€€€€€½¹ÍÐ™%µÌè±½…Ñ¥¹%µ…•mt€ômtì(€€€€€€€™½È€¡±•Ð¥‘à€ô€Àì¥‘à€ð™¥±•ÍQ½1½…¹±•¹Ñ ì¥‘à¬¬¤ì(€€€€€€€€€½¹ÍÐ˜€ô™¥±•ÍQ½1½…‘m¥‘átì(€€€€€€€€€½¹ÍÐÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡˜¤ì(€€€€€€€€€½¹ÍÐÙ¥‘•¼€ô¥ÍY¥‘•½¥±”¡˜¤ì(€€€€€€€€€½¹ÍÐ‘¥µÌ€ôÙ¥‘•¼€ü…Ý…¥Ð•ÑY¥‘•½¥µ•¹Í¥½¹Ì¡ÕÉ°¤€è…Ý…¥Ð•Ñ%µ…•¥µ•¹Í¥½¹Ì¡ÕÉ°¤ì((€€€€€€€€€½¹ÍÐ…ÍÁ•Ð€ô‘¥µÌ¹Ý¥‘Ñ €¼‘¥µÌ¹¡•¥¡Ðì((€€€€€€€€€€¼¨ƒ¢º–r[šb¿¦v{–B3š¶—žj¾ò3’â·¦SžV¯¦v‹–>¿¢÷–>#¦?’ê’âš²‡¾ò#š^/¢ö'Ž¦6×žn“šRÛ¢Öß’úŠ›¾ò'¾ò0(€€€€€€€€€€€€ƒš&’î—š¾?’â–ò×¦÷žVÛ–‚Óš.ÿšršZÃžj¦‚¦v‹–Âë–¾ã¾ò3’â7¢šžR£¦Z'–2¢Ž‡¦
’î÷Ž€¨¼(€€€€€€€€€½¹ÍÐÁÉ•Ù¥•Ý\€ôÁÉ•Ù¥•Ý]I•˜¹ÕÉÉ•¹Ðì(€€€€€€€€€½¹ÍÐÁÉ•Ù¥•Ý €ôÁÉ•Ù¥•Ý!I•˜¹ÕÉÉ•¹Ðì((€€€€€€€€€½¹ÍÐµ…É¥¸€ô€ÄÈì€¼¼½µ™½ÉÑ…‰±”µ…É¥¸™É½´‰½Õ¹‘…É¥•Ì(€€€€€€€€€½¹ÍÐµ…á±±½Ý•‘\€ô5…Ñ ¹µ…à ÄÀ°ÁÉ•Ù¥•Ý\€´€È€¨µ…É¥¸¤ì(€€€€€€€€€½¹ÍÐµ…á±±½Ý•‘ €ô5…Ñ ¹µ…à ÄÀ°ÁÉ•Ù¥•Ý €´€È€¨µ…É¥¸¤ì((€€€€€€€€€±•Ð¥¹¥Ñ¥…±]¥‘Ñ €ô€ÄØÀì(€€€€€€€€€±•Ð¥¹¥Ñ¥…±!•¥¡Ð€ô€ÄØÀì(€€€€€€€€€€(€€€€€€€€€¥˜€¡…ÍÁ•Ð€ø€Ä¤ì(€€€€€€€€€€€¥¹¥Ñ¥…±!•¥¡Ð€ô¥¹¥Ñ¥…±]¥‘Ñ €¼…ÍÁ•Ðì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€¥¹¥Ñ¥…±]¥‘Ñ €ô¥¹¥Ñ¥…±!•¥¡Ð€¨…ÍÁ•Ðì(€€€€€€€€€ô(€€€€€€€€€€(€€€€€€€€€¥˜€¡¥¹¥Ñ¥…±]¥‘Ñ €øµ…á±±½Ý•‘\¤ì(€€€€€€€€€€€¥¹¥Ñ¥…±]¥‘Ñ €ôµ…á±±½Ý•‘\ì(€€€€€€€€€€€¥¹¥Ñ¥…±!•¥¡Ð€ô¥¹¥Ñ¥…±]¥‘Ñ €¼…ÍÁ•Ðì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡¥¹¥Ñ¥…±!•¥¡Ð€øµ…á±±½Ý•‘ ¤ì(€€€€€€€€€€€¥¹¥Ñ¥…±!•¥¡Ð€ôµ…á±±½Ý•‘ ì(€€€€€€€€€€€¥¹¥Ñ¥…±]¥‘Ñ €ô¥¹¥Ñ¥…±!•¥¡Ð€¨…ÍÁ•Ðì(€€€€€€€€€ô(€€€€€€€€€€(€€€€€€€€€½¹ÍÐ‰…Í•`€ô€¡ÁÉ•Ù¥•Ý\€´¥¹¥Ñ¥…±]¥‘Ñ ¤€¼€Èì(€€€€€€€€€½¹ÍÐ‰…Í•d€ô€¡ÁÉ•Ù¥•Ý €´¥¹¥Ñ¥…±!•¥¡Ð¤€¼€Èì(€€€€€€€€€€(€€€€€€€€€½¹ÍÐµ¥¹`€ôµ…É¥¸ì(€€€€€€€€€½¹ÍÐµ…á`€ô5…Ñ ¹µ…à¡µ…É¥¸°ÁÉ•Ù¥•Ý\€´µ…É¥¸€´¥¹¥Ñ¥…±]¥‘Ñ ¤ì(€€€€€€€€€½¹ÍÐµ¥¹d€ôµ…É¥¸ì(€€€€€€€€€½¹ÍÐµ…ád€ô5…Ñ ¹µ…à¡µ…É¥¸°ÁÉ•Ù¥•Ý €´µ…É¥¸€´¥¹¥Ñ¥…±!•¥¡Ð¤ì(€€€€€€€€€€(€€€€€€€€€½¹ÍÐµ…á=™™Í•Ñ`€ô5…Ñ ¹µ…à À°µ…á`€´‰…Í•`¤ì(€€€€€€€€€½¹ÍÐµ…á=™™Í•Ñd€ô5…Ñ ¹µ…à À°µ…ád€´‰…Í•d¤ì(€€€€€€€€€€(€€€€€€€€€±•Ð½™™Í•ÑMÑ•À€ô€ÄØì(€€€€€€€€€¥˜€¡™¥±•ÍQ½1½…¹±•¹Ñ €ø€Ä¤ì(€€€€€€€€€€€½¹ÍÐµ…á9••‘•‘MÑ•Á`€ôµ…á=™™Í•Ñ`€¼€¡™¥±•ÍQ½1½…¹±•¹Ñ €´€Ä¤ì(€€€€€€€€€€€½¹ÍÐµ…á9••‘•‘MÑ•Ád€ôµ…á=™™Í•Ñd€¼€¡™¥±•ÍQ½1½…¹±•¹Ñ €´€Ä¤ì(€€€€€€€€€€€½™™Í•ÑMÑ•À€ô5…Ñ ¹µ¥¸ ÄØ°µ…á9••‘•‘MÑ•Á`°µ…á9••‘•‘MÑ•Ád¤ì(€€€€€€€€€ô(€€€€€€€€€€(€€€€€€€€€€¼¨ƒž²³’â–ò×šÂã¦ƒšb¿š¶’â·–’»¾ò!¥‘à€ÀƒŠHƒ’ö7žžì€Ã¾ò'¾ò3–Û¦’c’úw–ê?–ú–>Ï’â/¦2¿¦Z/Ž(€€€€€€€€€€€€ƒ–’û¦
+žV3šfž&ç–"—¢ºOž²³’â–ò×–7–’øƒŠSŠPƒ–r[–7–’Ÿ’æ’â7šr¢Ú–ë¾ò#’â+¦v‹–ÞËžÚO–#žâ»–"À(€€€€€€€€€€€€µ…á±±½Ý•‘\½ ƒ’ê¾ò'¾ò3–’û’ê–>7¢3šr–r£š–×ž®¿š¾S’ú/’â/š*+–ºš:£¦n‹’â·–þŽ€¨¼(€€€€€€€€€±•Ðà€ô‰…Í•`€¬€¡¥‘à€¨½™™Í•ÑMÑ•À¤ì(€€€€€€€€€±•Ðä€ô‰…Í•d€¬€¡¥‘à€¨½™™Í•ÑMÑ•À¤ì((€€€€€€€€€¥˜€¡¥‘à€ø€À¤ì(€€€€€€€€€€€€¼¼±…µÀÑ¼ÍÑ…äÍÑÉ¥Ñ±ä¥¹Í¥‘”Ñ¡”µ…É¥¸(€€€€€€€€€€€à€ô5…Ñ ¹µ…à¡µ¥¹`°5…Ñ ¹µ¥¸¡à°µ…á`¤¤ì(€€€€€€€€€€€ä€ô5…Ñ ¹µ…à¡µ¥¹d°5…Ñ ¹µ¥¸¡ä°µ…ád¤¤ì(€€€€€€€€€ô((€€€€€€€€€™%µÌ¹ÁÕÍ ¡ì(€€€€€€€€€€€¥è5…Ñ ¹É…¹‘½´ ¤¹Ñ½MÑÉ¥¹œ ÌØ¤¹ÍÕ‰ÍÑÉ¥¹œ È°€ä¤°(€€€€€€€€€€€ÍÉŒèÕÉ°°(€€€€€€€€€€€à°(€€€€€€€€€€€ä°(€€€€€€€€€€€Ý¥‘Ñ è¥¹¥Ñ¥…±]¥‘Ñ °(€€€€€€€€€€€¡•¥¡Ðè¥¹¥Ñ¥…±!•¥¡Ð°(€€€€€€€€€€€Í…±”è€Ä¸À°(€€€€€€€€€€€É½Ñ…Ñ¥½¸è€À°(€€€€€€€€€€€€¸¸¸¡Ù¥‘•¼€üì¥ÍY¥‘•¼èÑÉÕ”°Á½ÍÑ•Èè€¡‘¥µÌ…Ì…¹ä¤¹Á½ÍÑ•Èô€èíô¤°(€€€€€€€€€ô¤ì(€€€€€€€ô(€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡™%µÌ¤ì(€€€€€ôì(€€€€€±½…‘%¹¥Ñ¥…° ¤ì(€€€ô(€ô°m¥¹¥Ñ¥…±¥±•Ì°½¹Ñ…¥¹•É5•…ÍÕÉ•‘t¤ì((€€¼¨ƒšRÛ–Âû–Z»ž6£’âšR¿¾òk’â+¦v‹¦
šR¿ž>û–r£šr–nƒž
è½¹Ñ…¥¹•É5•…ÍÕÉ•ƒ¢º+–.W¢3¦7¢ÞG¾ò0(€€€€ƒšâž¦ëžj–.W’ös¢ššb¿¦
žVg–r£¢Ž‡¦v‹¾ò3¦?––÷–Âë–¾ãžj¦
’â–"ï–ÂÇšrš*+–&ošRû––÷žj–r[–£¦£šâš:'Ž€¨¼(€ÕÍ•™™•Ð  ¤€ôøì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€€¼¼±•…¹ÕÀUI1Ì½¸Õ¹µ½Õ¹Ð(€€€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€€€ÁÉ•Ø¹™½É… ¡¥µœ€ôøì(€€€€€€€€€€¼¨É•Ù½­”€¨¼(€€€€€€€ô¤ì(€€€€€€€É•ÑÕÉ¸mtì(€€€€€ô¤ì(€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€€€ÁÉ•Ø¹™½É… ¡¥µœ€ôøì(€€€€€€€€€€¼¨É•Ù½­”€¨¼(€€€€€€€ô¤ì(€€€€€€€É•ÑÕÉ¸mtì(€€€€€ô¤ì(€€€ôì(€ô°mt¤ì((€€¼¨ƒŠRŠR ƒ¢«–.W–¶cšªPƒŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠR (€€€€ƒžŸž&šRø%¹‘•á•‘Žž&#¦v‹šRø)M=;Ž–âÛ¢F_šZÃžŸž&¦Ë’ú–ÂÇšb¿–£šZÃžj’â’î÷¾ò0(€€€€ƒ¦7šZÃšVÓžB¾ò#šÊKšr'–âÛžŸž&¾ò'š&7šrš*+’â+š²‡žjš:—–n{’úŽ€¨¼(€€¼¼ƒžR ÍÑ…Ñ”ƒ¢3’â7šb¼É•›¾òkš^_š¢gžþï¢Öß’úžjšf–g¢š¢ºO–¶cšªSžj•™™•Ðƒ–7¢ÞG’âš²‡¾ò0(€€¼¼ƒ’â7žÛŽ3¦Ë’ú–ÂÇšÊK–7–.W¦;Ž7žj¦
’â’î÷šršò?–¶`(€½¹ÍÐm‘É…™ÑI•…‘ä°Í•ÑÉ…™ÑI•…‘åt€ôÕÍ•MÑ…Ñ”¡™…±Í”¤ì(€ÕÍ•™™•Ð  ¤€ôøì(€€€±•Ð…±¥Ù”€ôÑÉÕ”ì(€€€€¡…Íå¹Œ€ ¤€ôøì(€€€€€€¼¨ƒ–ú{¦š[¦‚žjš¶ß–>ËžÒ¦2¦î{–n{’ú¾òkžnÓš:—––_¦
’â’î÷¾ò3’â7¢šžB¢«–.W–¶cšªSžj¢6'ž¢ÿŽ€¨¼(€€€€€¥˜€¡¥¹¥Ñ¥…±MÑ…Ñ”€˜˜ÉÉ…ä¹¥ÍÉÉ…ä¡¥¹¥Ñ¥…±MÑ…Ñ”¹Á…•Ì¤¤ì(€€€€€€€…Ý…¥Ð±•…ÉÉ…™Ð ¤ì(€€€€€€€¥˜€ ……±¥Ù”¤É•ÑÕÉ¸ì(€€€€€€€Í•ÑA…•Ì¡¥¹¥Ñ¥…±MÑ…Ñ”¹Á…•Ì¤ì(€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡¥¹¥Ñ¥…±MÑ…Ñ”¹™±½…Ñ¥¹%µ…•Ìñðmt¤ì(€€€€€€€Í•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡¥¹¥Ñ¥…±MÑ…Ñ”¹‰ÉÕÍ¡MÑÉ½­•Ìñðmt¤ì(€€€€€€€¥˜€¡¥¹¥Ñ¥…±MÑ…Ñ”¹Í•±•Ñ•‘I…Ñ¥¼¤Í•ÑM•±•Ñ•‘I…Ñ¥¼¡¥¹¥Ñ¥…±MÑ…Ñ”¹Í•±•Ñ•‘I…Ñ¥¼¤ì(€€€€€€€¥˜€¡¥¹¥Ñ¥…±MÑ…Ñ”¹¥Í1…¹‘Í…Á”€„ôôÕ¹‘•™¥¹•¤Í•Ñ%Í1…¹‘Í…Á”¡¥¹¥Ñ¥…±MÑ…Ñ”¹¥Í1…¹‘Í…Á”¤ì(€€€€€€€Í•ÑÑ¥Ù•A…•%¹‘•à À¤ì(€€€€€€€Í•ÑÉ…™ÑI•…‘ä¡ÑÉÕ”¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€¥˜€¡¥¹¥Ñ¥…±¥±•Ì€˜˜¥¹¥Ñ¥…±¥±•Ì¹±•¹Ñ €ø€À¤ì(€€€€€€€…Ý…¥Ð±•…ÉÉ…™Ð ¤ì(€€€€€€€¥˜€¡…±¥Ù”¤Í•ÑÉ…™ÑI•…‘ä¡ÑÉÕ”¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€¥˜€ …¡…ÍÉ…™Ð ¤¤ìÍ•ÑÉ…™ÑI•…‘ä¡ÑÉÕ”¤ìÉ•ÑÕÉ¸ìô(€€€€€½¹ÍÐ‘É…™Ð€ô…Ý…¥Ð±½…‘É…™Ð ¤ì(€€€€€¥˜€ ……±¥Ù”¤É•ÑÕÉ¸ì(€€€€€¥˜€¡‘É…™Ð¤ì(€€€€€€€Í•ÑA…•Ì¡‘É…™Ð¹Á…•Ì¤ì(€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡‘É…™Ð¹™±½…Ñ¥¹%µ…•Ì¤ì(€€€€€€€Í•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡‘É…™Ð¹‰ÉÕÍ¡MÑÉ½­•Ìñðmt¤ì(€€€€€€€Í•ÑM•±•Ñ•‘I…Ñ¥¼¡‘É…™Ð¹Í•±•Ñ•‘I…Ñ¥¼¤ì(€€€€€€€Í•Ñ%Í1…¹‘Í…Á”¡‘É…™Ð¹¥Í1…¹‘Í…Á”¤ì(€€€€€€€Í•ÑÑ¥Ù•A…•%¹‘•à À¤ì(€€€€€ô(€€€€€Í•ÑÉ…™ÑI•…‘ä¡ÑÉÕ”¤ì(€€€ô¤ ¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì…±¥Ù”€ô™…±Í”ìôì(€ô°m¥¹¥Ñ¥…±¥±•Ì°¥¹¥Ñ¥…±MÑ…Ñ•t¤ì((€€¼¨¨ƒ¦n‹¦Z/š.ó–r[¾òw¦g’â’î÷žÖCšv’ê¾òk–#¦^sš:'¢«–.W–¶cšªS–7š*+¢6'ž¢ÿšRÛš:'¾ò0(€€€€€ƒ’â7žÛ–&oš:K¦j+žj¦
š²‡–¶cšªSšr–r£šâš:'’æ/–ú3–>#–¾¯–n{–:ïŽ€¨¼(€½¹ÍÐ±•™ÑI•˜€ôÕÍ•I•˜¡™…±Í”¤ì((€€¼¨ƒŠRŠR ƒš¶ß–>ËžÒ¦2ƒŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠR (€€€€ƒ’â’î÷š.ó–r[šb¿––÷–æû–ò×žŸž&š.ó¢Öß’úžj¾ò3šÊKšr'Ž3¦
’â–ò×–:–r[Ž7ŠSŠP(€€€€ƒš&’î—žR£’â–/¦Z/–Þ—–ßšfžR‹žRžj¥ƒžVÛ¢¶c–"—¾ò3–B3’â’î÷’â7žº‡¢¢c–æûš²‡¦÷–>«žVgšršZÃžj’âž¶Ž€¨¼(€½¹ÍÐ¡¥ÍÑ-•åI•˜€ôÕÍ•I•˜¡±…å½ÕÐ´‘í…Ñ”¹¹½Ü ¤¹Ñ½MÑÉ¥¹œ ÌØ¥ô´‘í5…Ñ ¹É…¹‘½´ ¤¹Ñ½MÑÉ¥¹œ ÌØ¤¹Í±¥” È°€à¥õ€¤ì(€½¹ÍÐÉ•½É‘•‘I•˜€ôÕÍ•I•˜ œœ¤ì(€½¹ÍÐ•á¥Ñ	…Í•±¥¹•I•˜€ôÕÍ•I•˜ œœ¤ì(€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€ …‘É…™ÑI•…‘äñð•á¥Ñ	…Í•±¥¹•I•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€½¹ÍÐÐ€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€•á¥Ñ	…Í•±¥¹•I•˜¹ÕÉÉ•¹Ð€ô)M=8¹ÍÑÉ¥¹¥™ä¡ìÁ…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á”ô¤ì(€€€ô°€ÔÀÀ¤ì(€€€É•ÑÕÉ¸€ ¤€ôø±•…ÉQ¥µ•½ÕÐ¡Ð¤ì(€ô°m‘É…™ÑI•…‘ä°Á…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á•t¤ì(€½¹ÍÐÉ•½É‘AÉ½É•ÍÌ€ô…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐ•µÁÑä€ô™±½…Ñ¥¹%µ…•Ì¹±•¹Ñ €ôôô€À€˜˜‰ÉÕÍ¡MÑÉ½­•Ì¹±•¹Ñ €ôôô€À€˜˜Á…•Ì¹•Ù•Éä¡À€ôøÀ¹±…å½ÕÑÌ¹±•¹Ñ €ôôô€À¤ì(€€€¥˜€¡•µÁÑä¤É•ÑÕÉ¸ì(€€€½¹ÍÐÍÑ…Ñ”€ôìÁ…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á”ôì(€€€½¹ÍÐÍ¥œ€ô)M=8¹ÍÑÉ¥¹¥™ä¡ÍÑ…Ñ”¤ì(€€€¥˜€¡É•½É‘•‘I•˜¹ÕÉÉ•¹Ð€ôôôÍ¥œ¤É•ÑÕÉ¸ì(€€€É•½É‘•‘I•˜¹ÕÉÉ•¹Ð€ôÍ¥œì(€€€ÑÉäì(€€€€€€¼¨ƒž&#¦v‹šb¼=4ƒžV¯žj¾ò3šÊKšr'ž>ûš"CžjžV¯–â–>¿’î—š"¨ƒŠSŠPƒžR£–Â;–ë¦
’âšR¿¦vs¦vs–rÃž“’â–ò×–Â?žjŽ(€€€€€€€€ÍÑ¥±±=¹±ç¾òkš¶ß–>ËžÒ¦2žjžâ»–r[–>«¢š’â–ò×–r[¾ò3’â7–þž
ë–º¦2’âšVÓšº×–öÇž&Ž€¨¼(€€€€€½¹ÍÐÈ€ô…Ý…¥Ð¡…¹‘±•áÁ½ÉÐ¡ìÍ¥±•¹ÐèÑÉÕ”°ÁÉ•Ù¥•Ý]¥‘Ñ è€ÐàÀ°ÍÑ¥±±=¹±äèÑÉÕ”ô¤ì(€€€€€½¹ÍÐÕÉ°€ôÈ€˜˜€ÕÉ±Ìœ¥¸È€üÈ¹ÕÉ±ÍlÁt€è¹Õ±°ì(€€€€€¥˜€ …ÕÉ°¤É•ÑÕÉ¸ì(€€€€€€¼¨ƒ–:–r[¦
’âš‚óšRûžjšb¿Ž3š.ó––÷žjš"C–NŽ7¾òkžrš¶¦
–:žR£žjšb¼ÍÑ…Ñ—¾ò#¢Ž‡¦v‹š¾?’â–ò×žŸž&(€€€€€€€€ƒ¦÷šr¢Š¬•áÁ½ÉÑ!¥ÍÑ½ÉäƒšRÛš"C¦f’îÛ¾ò'Ž€¨¼(€€€€€…Ý…¥Ð…‘‘áÁ½ÉÐ ±…å½ÕÐœ°ÕÉ°°ÕÉ°°ÍÑ…Ñ”°¡¥ÍÑ-•äñð¡¥ÍÑ-•åI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€UI0¹É•Ù½­•=‰©•ÑUI0¡ÕÉ°¤ì(€€€ô…Ñ ì€¼¨ƒ¢¢c¦2–’ÇšV_’â7¢÷–öÇ¦~ÿ¦n‹¦Z,€¨¼ô(€ôì((€€¼¨¨(€€€¨ƒ¦n‹¦Z/š.ó–r[¾òw¦g’â’î÷žÖCšv’êŽ(€€€¨(€€€¨ƒŠj€€¨«’â7ž¶'š¶ß–>ËžÒ¦2–k–º0¨«Ž’î—–&7¦g¢Ž‡šb¼…Ý…¥ÐÉ•½É‘AÉ½É•ÍÌ ¥€ƒš&4½¹!½µ” §¾ò0(€€€¨ƒ¢0É•½É‘AÉ½É•ÍÌƒ¢šš*+šVÓ–ò×š.ó–r[¦7ž“’âš²„ƒŠSŠPƒš2'’â/¢þS–n{¦6×’æ/–ú3¢š’æûž¶'––÷–æûžžK¾ò0(€€€¨ƒžV¯¦v‹–º3–£šÊKšr'–>7š'Ž(€€€¨(€€€¨ƒž>û–r£šRçš"C¾òk–#š*+ž“žâ»–r[¦
’îÛ’ê/Ž3žfó–.WŽ7¾ò#–º–&7¦v‹¦
šº×šb¿–B3š¶—žj¾ò3¢Ú–’îÛ¦
–r£šf¢ÞGš:'¾ò'¾ò0(€€€¨ƒžÛ–ú0¨«ž®/–"ì¨«–n{’âï¦‚¾òo–&§’â/žj¦£–"–r£¢3šf¿¢«–ÞÇ¢ÞG–º3–7–¾¯¦Ëš¶ß–>ËŽ(€€€¨ƒ¦gš¢–k–º'–£žj–:–nƒšb¼¡…¹‘±•áÁ½ÉÐƒ–>«’úw¢ÎÓ¾òh(€€€¨€€ƒŠœƒ¦Z'–2¢Ž‡žjÁ…•Ì€¼™±½…Ñ¥¹%µ…•Ï¾ò#–ó¾ò3–’îÛšRÛš:'’æ¦
–r£¾ò$(€€€¨€€ƒŠœƒš¾?’â–Æ“žj‰±½ˆƒžÚË–v¾ò#šÊKšr'’êë–r£–6ã¢ò'šf–n{šRÛ–º–G¾ò$(€€€¨€€ƒŠœƒ¢«–ÞÇ¦Z/žj¦n‹–Æ?žV¯–â(€€€¨ƒ–£¦÷’â7¦r¢š¦g¦†–’îÛ¦
š:o–r£žV¯¦v‹’â+Ž–¾›šâ³¾òkš2'’â/–:ì€ÄáµÏŽ’âï¦‚€ÄàÙµÌƒ–ÂÇ–ë’ú¾ò0(€€€¨ƒžâ»–r[–r €Ä¸ÈƒžžK–ú3š&7–r£¢3šf¿ž“¾ò3–º3–£’â7šN/¢Þ¿Ž(€€€¨¼(€½¹ÍÐ±•…Ù¥¹I•˜€ôÕÍ•I•˜¡™…±Í”¤ì(€½¹ÍÐ¡…¹‘±•1•…Ù”€ô…Íå¹Œ€ ¤€ôøì(€€€¥˜€¡±•…Ù¥¹I•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€½¹ÍÐÍ¥œ€ô)M=8¹ÍÑÉ¥¹¥™ä¡ìÁ…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á”ô¤ì(€€€¥˜€¡•á¥Ñ	…Í•±¥¹•I•˜¹ÕÉÉ•¹Ð€˜˜Í¥œ€ôôô•á¥Ñ	…Í•±¥¹•I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€±•…Ù¥¹I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€±•™ÑI•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€¥˜€ …½Á•¹•‘É½µÉ…™ÑI•˜¹ÕÉÉ•¹Ð€˜˜€…¥¹¥Ñ¥…±MÑ…Ñ”¤…Ý…¥Ð±•…ÉÉ…™Ð ¤ì(€€€€€½¹!½µ” ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐ¡½¥”€ô½¹I•ÅÕ•ÍÑá¥Ð€ü…Ý…¥Ð½¹I•ÅÕ•ÍÑá¥Ð ¤€è€‘¥Í…Éœì(€€€¥˜€¡¡½¥”€ôôô€…¹•°œ¤É•ÑÕÉ¸ì(€€€±•…Ù¥¹I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€±•™ÑI•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€¥˜€¡¡½¥”€ôôô€Í…Ù”œ¤ì(€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€€€É•½É‘AÉ½É•ÍÌ ¤°(€€€€€€€Í…Ù•É…™Ð¡ìÁ…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á”ô¤°(€€€€€t¤ì(€€€ô•±Í”ì(€€€€€…Ý…¥Ð±•…ÉÉ…™Ð ¤ì(€€€ô(€€€½¹!½µ” ¤ì(€ôì((€½¹ÍÐ±…Ñ•ÍÑÉ…™ÑI•˜€ôÕÍ•I•˜¡ìÁ…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á”ô¤ì(€±…Ñ•ÍÑÉ…™ÑI•˜¹ÕÉÉ•¹Ð€ôìÁ…•Ì°™±½…Ñ¥¹%µ…•Ì°‰ÉÕÍ¡MÑÉ½­•Ì°Í•±•Ñ•‘I…Ñ¥¼°¥Í1…¹‘Í…Á”ôì(€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€ …‘É…™ÑI•…‘ä¤É•ÑÕÉ¸ì(€€€½¹ÍÐÑ¥µ•È€ôÝ¥¹‘½Ü¹Í•Ñ%¹Ñ•ÉÙ…°  ¤€ôøì(€€€€€¥˜€¡±•™ÑI•˜¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ±…Ñ•ÍÐ€ô±…Ñ•ÍÑÉ…™ÑI•˜¹ÕÉÉ•¹Ðì(€€€€€½¹ÍÐ•µÁÑä€ô±…Ñ•ÍÐ¹™±½…Ñ¥¹%µ…•Ì¹±•¹Ñ €ôôô€À€˜˜±…Ñ•ÍÐ¹‰ÉÕÍ¡MÑÉ½­•Ì¹±•¹Ñ €ôôô€À(€€€€€€€€˜˜±…Ñ•ÍÐ¹Á…•Ì¹•Ù•Éä¡À€ôøÀ¹±…å½ÕÑÌ¹±•¹Ñ €ôôô€À¤ì(€€€€€¥˜€ …•µÁÑä¤Í…Ù•É…™Ð¡±…Ñ•ÍÐ¤ì(€€€ô°€ÄÀÀÀ¤ì(€€€É•ÑÕÉ¸€ ¤€ôøÝ¥¹‘½Ü¹±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤ì(€ô°m‘É…™ÑI•…‘åt¤ì((€€¼¼]¡•¸¥µ…”½Õ¹Ð¡…¹•Ì°É•Í•ÐÍ•±•Ñ•¥¹‘•à¥˜½ÕÐ½˜‰½Õ¹‘Ì°…¹±…µÀÑ•µÁ±…Ñ•%¹‘•à(€ÕÍ•™™•Ð  ¤€ôøì(€€€½¹ÍÐÑ•µÁ±…Ñ•Ì€ôQ5A1Q}5Am¥µ…•Ì¹±•¹Ñ¡tñðmtì(€€€¥˜€¡Ñ•µÁ±…Ñ•%¹‘•à€øôÑ•µÁ±…Ñ•Ì¹±•¹Ñ ¤ì(€€€€€Í•ÑQ•µÁ±…Ñ•%¹‘•à À¤ì(€€€ô(€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°€˜˜Í•±•Ñ•‘%¹‘•à€øô¥µ…•Ì¹±•¹Ñ ¤ì(€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€ô(€ô°m¥µ…•Ì¹±•¹Ñ °Ñ•µÁ±…Ñ•%¹‘•à°Í•±•Ñ•‘%¹‘•át¤ì((€½¹ÍÐ¡…¹‘±•¥±•¡…¹”€ô…Íå¹Œ€¡”èI•…Ð¹¡…¹•Ù•¹Ðñ!Q51%¹ÁÕÑ±•µ•¹Ðø°…ÁÁ•¹€ô™…±Í”¤€ôøì(€€€½¹ÍÐÁ¥­•€ôÉÉ…ä¹™É½´¡”¹Ñ…É•Ð¹™¥±•Ìñðmt¤ì(€€€¥˜€¡Á¥­•¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸ì(€€€€¼¨I_¾ò=!%¾ò=Q%ƒ–#¢žš"C’â¢"°)A¾ò#–öÇž&¢"’â¢"°)Aƒ–:š¢šRû¢†3¾ò'ŠSŠP(€€€€€€ƒ’â7¢žžj¢¦Ä€ñ¥µœøƒ¢ò'’â7–ë’ú¾ò3–r[–Æ“šršb¿ž¦ëžjŽ€¨¼(€€€½¹ÍÐ™¥±•Ì€ô…Ý…¥Ð¹½Éµ…±¥é•%µ…•¥±•Ì¡Á¥­•…Ì¥±•mt¤ì(€€€¥˜€¡™¥±•Ì¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸ì((€€€½¹ÍÐ¹•Ý±½…Ñ¥¹%µ…•Ìè±½…Ñ¥¹%µ…•mt€ômtì(€€€™½È€¡±•Ð¥‘à€ô€Àì¥‘à€ð™¥±•Ì¹±•¹Ñ ì¥‘à¬¬¤ì(€€€€€½¹ÍÐ˜€ô™¥±•Ím¥‘átì(€€€€€½¹ÍÐÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡˜¤ì(€€€€€½¹ÍÐÙ¥‘•¼€ô¥ÍY¥‘•½¥±”¡˜…Ì¥±”¤ì(€€€€€½¹ÍÐ‘¥µÌ€ôÙ¥‘•¼€ü…Ý…¥Ð•ÑY¥‘•½¥µ•¹Í¥½¹Ì¡ÕÉ°¤€è…Ý…¥Ð•Ñ%µ…•¥µ•¹Í¥½¹Ì¡ÕÉ°¤ì(€€€€€€(€€€€€½¹ÍÐ…ÍÁ•Ð€ô‘¥µÌ¹Ý¥‘Ñ €¼‘¥µÌ¹¡•¥¡Ðì((€€€€€€¼¼ƒ¢º–r[šb¿¦v{–B3š¶—žj¾ò3’â·¦SžV¯¦v‹–>¿¢÷–>#¦?¦;’âš²‡¾ò3š&’î—žVÛ–‚Óš.ÿšršZÃžj¦‚¦v‹–Âë–¾à(€€€€€½¹ÍÐÁÉ•Ù¥•Ý\€ôÁÉ•Ù¥•Ý]I•˜¹ÕÉÉ•¹Ðì(€€€€€½¹ÍÐÁÉ•Ù¥•Ý €ôÁÉ•Ù¥•Ý!I•˜¹ÕÉÉ•¹Ðì((€€€€€½¹ÍÐµ…É¥¸€ô€ÄÈì€¼¼½µ™½ÉÑ…‰±”µ…É¥¸™É½´‰½Õ¹‘…É¥•Ì(€€€€€½¹ÍÐµ…á±±½Ý•‘\€ô5…Ñ ¹µ…à ÄÀ°ÁÉ•Ù¥•Ý\€´€È€¨µ…É¥¸¤ì(€€€€€½¹ÍÐµ…á±±½Ý•‘ €ô5…Ñ ¹µ…à ÄÀ°ÁÉ•Ù¥•Ý €´€È€¨µ…É¥¸¤ì(€€€€€€(€€€€€±•Ð¥¹¥Ñ¥…±]¥‘Ñ €ô€ÄØÀì(€€€€€±•Ð¥¹¥Ñ¥…±!•¥¡Ð€ô€ÄØÀì(€€€€€€(€€€€€¥˜€¡…ÍÁ•Ð€ø€Ä¤ì(€€€€€€€¥¹¥Ñ¥…±!•¥¡Ð€ô¥¹¥Ñ¥…±]¥‘Ñ €¼…ÍÁ•Ðì(€€€€€ô•±Í”ì(€€€€€€€¥¹¥Ñ¥…±]¥‘Ñ €ô¥¹¥Ñ¥…±!•¥¡Ð€¨…ÍÁ•Ðì(€€€€€ô(€€€€€€(€€€€€¥˜€¡¥¹¥Ñ¥…±]¥‘Ñ €øµ…á±±½Ý•‘\¤ì(€€€€€€€¥¹¥Ñ¥…±]¥‘Ñ €ôµ…á±±½Ý•‘\ì(€€€€€€€¥¹¥Ñ¥…±!•¥¡Ð€ô¥¹¥Ñ¥…±]¥‘Ñ €¼…ÍÁ•Ðì(€€€€€ô(€€€€€¥˜€¡¥¹¥Ñ¥…±!•¥¡Ð€øµ…á±±½Ý•‘ ¤ì(€€€€€€€¥¹¥Ñ¥…±!•¥¡Ð€ôµ…á±±½Ý•‘ ì(€€€€€€€¥¹¥Ñ¥…±]¥‘Ñ €ô¥¹¥Ñ¥…±!•¥¡Ð€¨…ÍÁ•Ðì(€€€€€ô(€€€€€€(€€€€€½¹ÍÐ‰…Í•`€ô…Ñ¥Ù•A…•%¹‘•à€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¤€¬€¡ÁÉ•Ù¥•Ý\€´¥¹¥Ñ¥…±]¥‘Ñ ¤€¼€Èì(€€€€€½¹ÍÐ‰…Í•d€ô€¡ÁÉ•Ù¥•Ý €´¥¹¥Ñ¥…±!•¥¡Ð¤€¼€Èì(€€€€€€(€€€€€½¹ÍÐµ¥¹`€ô…Ñ¥Ù•A…•%¹‘•à€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¤€¬µ…É¥¸ì(€€€€€½¹ÍÐµ…á`€ô5…Ñ ¹µ…à¡µ¥¹`°…Ñ¥Ù•A…•%¹‘•à€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¤€¬ÁÉ•Ù¥•Ý\€´µ…É¥¸€´¥¹¥Ñ¥…±]¥‘Ñ ¤ì(€€€€€½¹ÍÐµ¥¹d€ôµ…É¥¸ì(€€€€€½¹ÍÐµ…ád€ô5…Ñ ¹µ…à¡µ…É¥¸°ÁÉ•Ù¥•Ý €´µ…É¥¸€´¥¹¥Ñ¥…±!•¥¡Ð¤ì(€€€€€€(€€€€€½¹ÍÐµ…á=™™Í•Ñ`€ô5…Ñ ¹µ…à À°µ…á`€´‰…Í•`¤ì(€€€€€½¹ÍÐµ…á=™™Í•Ñd€ô5…Ñ ¹µ…à À°µ…ád€´‰…Í•d¤ì(€€€€€€(€€€€€±•Ð½™™Í•ÑMÑ•À€ô€ÄØì(€€€€€¥˜€¡™¥±•Ì¹±•¹Ñ €ø€Ä¤ì(€€€€€€€½¹ÍÐµ…á9••‘•‘MÑ•Á`€ôµ…á=™™Í•Ñ`€¼€¡™¥±•Ì¹±•¹Ñ €´€Ä¤ì(€€€€€€€½¹ÍÐµ…á9••‘•‘MÑ•Ád€ôµ…á=™™Í•Ñd€¼€¡™¥±•Ì¹±•¹Ñ €´€Ä¤ì(€€€€€€€½™™Í•ÑMÑ•À€ô5…Ñ ¹µ¥¸ ÄØ°µ…á9••‘•‘MÑ•Á`°µ…á9••‘•‘MÑ•Ád¤ì(€€€€€ô(€€€€€€(€€€€€±•Ðà€ô‰…Í•`€¬€¡¥‘à€¨½™™Í•ÑMÑ•À¤ì(€€€€€±•Ðä€ô‰…Í•d€¬€¡¥‘à€¨½™™Í•ÑMÑ•À¤ì(€€€€€€(€€€€€€¼¼±…µÀÑ¼ÍÑ…äÍÑÉ¥Ñ±ä¥¹Í¥‘”Ñ¡”µ…É¥¸™½ÈÑ¡”…Ñ¥Ù”Á…”(€€€€€à€ô5…Ñ ¹µ…à¡µ¥¹`°5…Ñ ¹µ¥¸¡à°µ…á`¤¤ì(€€€€€ä€ô5…Ñ ¹µ…à¡µ¥¹d°5…Ñ ¹µ¥¸¡ä°µ…ád¤¤ì(€€€€€€(€€€€€¹•Ý±½…Ñ¥¹%µ…•Ì¹ÁÕÍ ¡ì(€€€€€€€¥è5…Ñ ¹É…¹‘½´ ¤¹Ñ½MÑÉ¥¹œ ÌØ¤¹ÍÕ‰ÍÑÉ¥¹œ È°€ä¤°(€€€€€€€ÍÉŒèÕÉ°°(€€€€€€€à°(€€€€€€€ä°(€€€€€€€Ý¥‘Ñ è¥¹¥Ñ¥…±]¥‘Ñ °(€€€€€€€¡•¥¡Ðè¥¹¥Ñ¥…±!•¥¡Ð°(€€€€€€€Í…±”è€Ä¸À°(€€€€€€€É½Ñ…Ñ¥½¸è€À°(€€€€€€€€¸¸¸¡Ù¥‘•¼€üì¥ÍY¥‘•¼èÑÉÕ”°Á½ÍÑ•Èè€¡‘¥µÌ…Ì…¹ä¤¹Á½ÍÑ•Èô€èíô¤°(€€€€€ô¤ì(€€€ô((€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøl¸¸¹ÁÉ•Ø°€¸¸¹¹•Ý±½…Ñ¥¹%µ…•Ít¤ì(€€€¥˜€¡™¥±•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ð¤™¥±•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ð¹Ù…±Õ”€ô€œœì(€ôì((€½¹ÍÐ¡…¹‘±•I•Á±…•¥±•¡…¹”€ô…Íå¹Œ€¡”èI•…Ð¹¡…¹•Ù•¹Ðñ!Q51%¹ÁÕÑ±•µ•¹Ðø¤€ôøì(€€€½¹ÍÐ™¥±•Ì€ôÉÉ…ä¹™É½´¡”¹Ñ…É•Ð¹™¥±•Ìñðmt¤ì(€€€¥˜€¡™¥±•Ì¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸ì((€€€½¹ÍÐÑ…É•Ñ%‘à€ôÍ±½ÑQ½UÁ±½…€„ôô¹Õ±°€üÍ±½ÑQ½UÁ±½…€èÍ•±•Ñ•‘%¹‘•àì((€€€½¹ÍÐ±½…‘AÉ½µ¥Í•Ì€ô™¥±•Ì¹µ…À¡…Íå¹Œ€¡™¥±”¤€ôøì(€€€€€½¹ÍÐÕÉ°€ôUI0¹É•…Ñ•=‰©•ÑUI0¡™¥±”¤ì(€€€€€½¹ÍÐ‘¥µÌ€ô…Ý…¥Ð•Ñ%µ…•¥µ•¹Í¥½¹Ì¡ÕÉ°¤ì(€€€€€É•ÑÕÉ¸ì™¥±”°ÕÉ°°‘¥µÌôì(€€€ô¤ì((€€€½¹ÍÐ±½…‘•‘¥±•Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡±½…‘AÉ½µ¥Í•Ì¤ì((€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€½¹ÍÐÕÁ‘…Ñ•€ôl¸¸¹ÁÉ•Ùtì(€€€€€±•Ð™¥±•%‘à€ô€Àì((€€€€€¥˜€¡Ñ…É•Ñ%‘à€„ôô¹Õ±°€˜˜™¥±•%‘à€ð±½…‘•‘¥±•Ì¹±•¹Ñ ¤ì(€€€€€€€½¹ÍÐì™¥±”°ÕÉ°°‘¥µÌô€ô±½…‘•‘¥±•Ím™¥±•%‘à¬­tì(€€€€€€€½¹ÍÐÕÉÉ•¹Ñ•±°€ôÕÁ‘…Ñ•‘mÑ…É•Ñ%‘átì(€€€€€€€¥˜€¡ÕÉÉ•¹Ñ•±°€˜˜ÕÉÉ•¹Ñ•±°¹ÕÉ°¤ì(€€€€€€€€€€¼¨É•Ù½­”€¨¼(€€€€€€€ô(€€€€€€€ÕÁ‘…Ñ•‘mÑ…É•Ñ%‘át€ôì(€€€€€€€€€€¸¸¹ÕÉÉ•¹Ñ•±°°(€€€€€€€€€¥èÕÉÉ•¹Ñ•±°ü¹¥ñð5…Ñ ¹É…¹‘½´ ¤¹Ñ½MÑÉ¥¹œ ÌØ¤¹ÍÕ‰ÍÑÉ¥¹œ È°€ä¤°(€€€€€€€€€ÕÉ°èÕÉ°°(€€€€€€€€€™¥±”è™¥±”°(€€€€€€€€€é½½´è€Ä¸À°(€€€€€€€€€½™™Í•Ñ`è€À°(€€€€€€€€€½™™Í•Ñdè€À°(€€€€€€€€€É½Ñ…Ñ¥½¸è€À°(€€€€€€€€€¹…ÑÕÉ…±]¥‘Ñ è‘¥µÌ¹Ý¥‘Ñ °(€€€€€€€€€¹…ÑÕÉ…±!•¥¡Ðè‘¥µÌ¹¡•¥¡Ð°(€€€€€€€ôì(€€€€€ô((€€€€€™½È€¡±•Ð¤€ô€Àì¤€ðÕÁ‘…Ñ•¹±•¹Ñ €˜˜™¥±•%‘à€ð±½…‘•‘¥±•Ì¹±•¹Ñ ì¤¬¬¤ì(€€€€€€€¥˜€¡ÕÁ‘…Ñ•‘m¥t¹ÕÉ°€ôôô€œœ¤ì(€€€€€€€€€½¹ÍÐì™¥±”°ÕÉ°°‘¥µÌô€ô±½…‘•‘¥±•Ím™¥±•%‘à¬­tì(€€€€€€€€€ÕÁ‘…Ñ•‘m¥t€ôì(€€€€€€€€€€€€¸¸¹ÕÁ‘…Ñ•‘m¥t°(€€€€€€€€€€€¥èÕÁ‘…Ñ•‘m¥t¹¥ñð5…Ñ ¹É…¹‘½´ ¤¹Ñ½MÑÉ¥¹œ ÌØ¤¹ÍÕ‰ÍÑÉ¥¹œ È°€ä¤°(€€€€€€€€€€€ÕÉ°èÕÉ°°(€€€€€€€€€€€™¥±”è™¥±”°(€€€€€€€€€€€é½½´è€Ä¸À°(€€€€€€€€€€€½™™Í•Ñ`è€À°(€€€€€€€€€€€½™™Í•Ñdè€À°(€€€€€€€€€€€É½Ñ…Ñ¥½¸è€À°(€€€€€€€€€€€¹…ÑÕÉ…±]¥‘Ñ è‘¥µÌ¹Ý¥‘Ñ °(€€€€€€€€€€€¹…ÑÕÉ…±!•¥¡Ðè‘¥µÌ¹¡•¥¡Ð°(€€€€€€€€€ôì(€€€€€€€ô(€€€€€ô((€€€€€É•ÑÕÉ¸ÕÁ‘…Ñ•ì(€€€ô¤ì((€€€Í•ÑM±½ÑQ½UÁ±½…¡¹Õ±°¤ì(€€€¥˜€¡É•Á±…•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ð¤É•Á±…•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ð¹Ù…±Õ”€ô€œœì(€ôì(€½¹ÍÐ¡…¹‘±•I•µ½Ù•%µ…”€ô€¡¥¹‘•àè¹Õµ‰•È¤€ôøì(€€€½¹ÍÐ•±°€ô¥µ…•Ím¥¹‘•átì(€€€€¼¨É•Ù½­”€¨¼(€€€½¹ÍÐÕÁ‘…Ñ•€ô¥µ…•Ì¹™¥±Ñ•È ¡|°¥‘à¤€ôø¥‘à€„ôô¥¹‘•à¤ì(€€€Í•Ñ%µ…•Ì¡ÕÁ‘…Ñ•¤ì(€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€ôì((€½¹ÍÐ¡…¹‘±••±•Ñ••±±%µ…”€ô€¡¥¹‘•àè¹Õµ‰•È¤€ôøì(€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡¥µœ°¥‘à¤€ôøì(€€€€€¥˜€¡¥‘à€„ôô¥¹‘•à¤É•ÑÕÉ¸¥µœì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹¥µœ°(€€€€€€€ÕÉ°è€œœ°(€€€€€€€é½½´è€Ä¸À°(€€€€€€€½™™Í•Ñ`è€À°(€€€€€€€½™™Í•Ñdè€À°(€€€€€€€É½Ñ…Ñ¥½¸è€À(€€€€€ôì(€€€ô¤¤ì(€ôì((€½¹ÍÐ¡…¹‘±•I•Í•Ñ•±±%µ…”€ô€¡¥¹‘•àè¹Õµ‰•È¤€ôøì(€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡¥µœ°¥‘à¤€ôøì(€€€€€¥˜€¡¥‘à€„ôô¥¹‘•à¤É•ÑÕÉ¸¥µœì(€€€€€É•ÑÕÉ¸ì(€€€€€€€€¸¸¹¥µœ°(€€€€€€€é½½´è€Ä¸À°(€€€€€€€½™™Í•Ñ`è€À°(€€€€€€€½™™Í•Ñdè€À°(€€€€€€€É½Ñ…Ñ¥½¸è€À(€€€€€ôì(€€€ô¤¤ì(€ôì((€½¹ÍÐ•Ñ•±±%¹‘•áÉ½µA½¥¹Ð€ô€¡±¥•¹Ñ`è¹Õµ‰•È°±¥•¹Ñdè¹Õµ‰•È¤è¹Õµ‰•Èð¹Õ±°€ôøì(€€€½¹ÍÐ•±•´€ô‘½Õµ•¹Ð¹•±•µ•¹ÑÉ½µA½¥¹Ð¡±¥•¹Ñ`°±¥•¹Ñd¤ì(€€€¥˜€ …•±•´¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ•±±±•´€ô•±•´¹±½Í•ÍÐ m‘…Ñ„µ•±°µ¥‘tœ¤ì(€€€€¼¼ƒ’â¦‚’â+–>¿¢÷šr'–’k–/’ö#–Æ¾ò3–>«šr'Ž3š¶–r£žÞ£¢ò¿žj¦
–/Ž7žjš‚ó–¶Cš&7žº_šVà(€€€¥˜€¡•±±±•´€˜˜•±±±•´¹±½Í•ÍÐ¡m‘…Ñ„µ±…å½ÕÐµ¥ôˆ‘íÍ•±•Ñ•‘1…å½ÕÑ%‘ô‰u€¤¤ì(€€€€€½¹ÍÐ¥‘ÑÑÈ€ô•±±±•´¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ•±°µ¥œ¤ì(€€€€€¥˜€¡¥‘ÑÑÈ€„ôô¹Õ±°¤ì(€€€€€€€É•ÑÕÉ¸Á…ÉÍ•%¹Ð¡¥‘ÑÑÈ°€ÄÀ¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸¹Õ±°ì(€ôì((€€¼¼±½¹œµÁÉ•ÍÌ‘É…œ…¸ÍÑ…ÉÐ™É½´„±…å½ÕÐ•±°½È™É½´„™É•”µÍÑ…¹‘¥¹œ¥µ…”°…¹…¸(€€¼¼±…¹½¸•¥Ñ¡•È­¥¹°Í¼‘É½ÀÑ…É•ÑÌ…É”É•Í½±Ù•™½È‰½Ñ ¸MÑ¥­•ÉÌÍ¥Ð…‰½Ù”Ñ¡”(€€¼¼•±±Ì°Í¼Ý¡¥¡•Ù•È¥Ì½¸Ñ½À…ÐÑ¡…ÐÁ½¥¹ÐÝ¥¹Ì¸(€½¹ÍÐ•ÑMÝ…ÁQ…É•ÑÉ½µA½¥¹Ð€ô€¡±¥•¹Ñ`è¹Õµ‰•È°±¥•¹Ñdè¹Õµ‰•È¤èMÝ…ÁQ…É•Ðð¹Õ±°€ôøì(€€€½¹ÍÐ•±•´€ô‘½Õµ•¹Ð¹•±•µ•¹ÑÉ½µA½¥¹Ð¡±¥•¹Ñ`°±¥•¹Ñd¤ì(€€€¥˜€ …•±•´¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ™°€ô•±•´¹±½Í•ÍÐ m‘…Ñ„µ™±½…Ñ¥¹œµ¥‘tœ¤ì(€€€¥˜€¡™°¤ì(€€€€€½¹ÍÐ¥€ô™°¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ™±½…Ñ¥¹œµ¥œ¤ì(€€€€€€¼¨ƒ–>«šr'žrš¶žj¢«žRÇ–nûž&¢÷š"C’âë’ê“š6‹žn»š‚Ž(€€€€€€€€ƒ–nû–ö‹’â;šZ–¶_¦÷’â7š:—šRÛš.[–—¾òkžî?¢þ–nû–ö‹š^Û’â7¦®c’ê»Ž’â7¦'’â·¾ò3’æ’â7¢ž›–>G’îï’öW’ê“š6‹–>7¦š#Ž€¨¼(€€€€€½¹ÍÐÑ…É•Ð€ô¥€ü™±½…Ñ¥¹%µ…•Ì¹™¥¹¡˜€ôø˜¹¥€ôôô¥¤€è¹Õ±°ì(€€€€€¥˜€¡¥€˜˜Ñ…É•Ð€˜˜€…Ñ…É•Ð¹Í¡…Á”€˜˜Ñ…É•Ð¹Ñ•áÐ€ôôôÕ¹‘•™¥¹•¤É•ÑÕÉ¸ì­¥¹è€™±½…Ñ¥¹œœ°¥ôì(€€€€€¥˜€¡¥¤É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€½¹ÍÐ°€ô•±•´¹±½Í•ÍÐ m‘…Ñ„µ•±°µ¥‘tœ¤ì(€€€¥˜€¡°¤ì(€€€€€€¼¼ƒš.[šRû’â7¦r¢š–#¦ã’â·’ö#–Æ¾ò3’îï’öW’ö#–Æžjš‚ó–¶C¦÷–>¿’î—š:—šRØ(€€€€€½¹ÍÐ¥‘ÑÑÈ€ô°¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ•±°µ¥œ¤ì(€€€€€½¹ÍÐ±…å°€ô°¹±½Í•ÍÐ m‘…Ñ„µ±…å½ÕÐµ¥‘tœ¤ì(€€€€€¥˜€¡¥‘ÑÑÈ€„ôô¹Õ±°¤ì(€€€€€€€É•ÑÕÉ¸ì­¥¹è€•±°œ°¥‘àèÁ…ÉÍ•%¹Ð¡¥‘ÑÑÈ°€ÄÀ¤°±…å½ÕÑ%è±…å°ü¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ±…å½ÕÐµ¥œ¤ñðÕ¹‘•™¥¹•ôì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸¹Õ±°ì(€ôì((€€¼¼MÝ…ÁÁ¥¹œ„Á¥ÑÕÉ”¥¹Ñ¼„™É•”µÍÑ…¹‘¥¹œ™É…µ”¡…ÌÑ¼É”µ‘•É¥Ù”Ñ¡”™É…µ”Ì‰½à™É½´Ñ¡”(€€¼¼¥¹½µ¥¹œ…ÍÁ•ÐÉ…Ñ¥¼°½Ñ¡•ÉÝ¥Í”Ñ¡”Á¥ÑÕÉ”Ý½Õ±‰”ÍÑÉ•Ñ¡•¸Q¡”™É…µ”Ì±½¹•ÍÐ(€€¼¼Í¥‘”°¥ÑÌÁ½Í¥Ñ¥½¸…¹¥ÑÌÉ½Ñ…Ñ¥½¸…É”ÁÉ•Í•ÉÙ•¸(€½¹ÍÐÉ•™É…µ•±½…Ñ¥¹œ€ô€¡‰½àèìÝ¥‘Ñ è¹Õµ‰•Èì¡•¥¡Ðè¹Õµ‰•Èô°ÕÉ°èÍÑÉ¥¹œ¤èAÉ½µ¥Í”ñìÝ¥‘Ñ è¹Õµ‰•Èì¡•¥¡Ðè¹Õµ‰•Èôø€ôø(€€€¹•ÜAÉ½µ¥Í”¡É•Í½±Ù”€ôøì(€€€€€½¹ÍÐ±½¹•ÍÐ€ô5…Ñ ¹µ…à¡‰½à¹Ý¥‘Ñ °‰½à¹¡•¥¡Ð¤ì(€€€€€½¹ÍÐ¥µœ€ô¹•Ü%µ…” ¤ì(€€€€€¥µœ¹½¹±½…€ô€ ¤€ôøì(€€€€€€€½¹ÍÐ…ÍÁ•Ð€ô¥µœ¹¹…ÑÕÉ…±]¥‘Ñ €¼5…Ñ ¹µ…à Ä°¥µœ¹¹…ÑÕÉ…±!•¥¡Ð¤ì(€€€€€€€É•Í½±Ù”¡…ÍÁ•Ð€øô€Ä(€€€€€€€€€€üìÝ¥‘Ñ è±½¹•ÍÐ°¡•¥¡Ðè±½¹•ÍÐ€¼…ÍÁ•Ðô(€€€€€€€€€€èìÝ¥‘Ñ è±½¹•ÍÐ€¨…ÍÁ•Ð°¡•¥¡Ðè±½¹•ÍÐô¤ì(€€€€€ôì(€€€€€¥µœ¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•Í½±Ù”¡ìÝ¥‘Ñ è‰½à¹Ý¥‘Ñ °¡•¥¡Ðè‰½à¹¡•¥¡Ðô¤ì(€€€€€¥µœ¹ÍÉŒ€ôÕÉ°ì(€€€ô¤ì((€½¹ÍÐ…ÁÁ±åMÝ…À€ô…Íå¹Œ€¡Í½ÕÉ”èMÝ…ÁM½ÕÉ”°Ñ…É•ÐèMÝ…ÁQ…É•Ð¤€ôøì(€€€¥˜€¡Í½ÕÉ”¹­¥¹€ôôô€•±°œ€˜˜Ñ…É•Ð¹­¥¹€ôôô€•±°œ¤ì(€€€€€¥˜€¡Í½ÕÉ”¹¥‘à€ôôôÑ…É•Ð¹¥‘à¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ™É½µ%‘à€ôÍ½ÕÉ”¹¥‘à°Ñ½%‘à€ôÑ…É•Ð¹¥‘àì(€€€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€€€½¹ÍÐ½Áä€ôl¸¸¹ÁÉ•Ùtì(€€€€€€€½¹ÍÐÑ•µÀ€ôì€¸¸¹½Áåm™É½µ%‘átôì(€€€€€€€½Áåm™É½µ%‘át€ôì€¸¸¹½ÁåmÑ½%‘át°é½½´è€Ä¸À°½™™Í•Ñ`è€À°½™™Í•Ñdè€Àôì(€€€€€€€½ÁåmÑ½%‘át€ôì€¸¸¹Ñ•µÀ°é½½´è€Ä¸À°½™™Í•Ñ`è€À°½™™Í•Ñdè€Àôì(€€€€€€€É•ÑÕÉ¸½Áäì(€€€€€ô¤ì(€€€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôô™É½µ%‘à¤Í•ÑM•±•Ñ•‘%¹‘•à¡Ñ½%‘à¤ì(€€€€€•±Í”¥˜€¡Í•±•Ñ•‘%¹‘•à€ôôôÑ½%‘à¤Í•ÑM•±•Ñ•‘%¹‘•à¡™É½µ%‘à¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€¥˜€¡Í½ÕÉ”¹­¥¹€ôôô€™±½…Ñ¥¹œœ€˜˜Ñ…É•Ð¹­¥¹€ôôô€™±½…Ñ¥¹œœ¤ì(€€€€€¥˜€¡Í½ÕÉ”¹¥€ôôôÑ…É•Ð¹¥¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ„€ô™±½…Ñ¥¹%µ…•Ì¹™¥¹¡˜€ôø˜¹¥€ôôôÍ½ÕÉ”¹¥¤ì(€€€€€½¹ÍÐˆ€ô™±½…Ñ¥¹%µ…•Ì¹™¥¹¡˜€ôø˜¹¥€ôôôÑ…É•Ð¹¥¤ì(€€€€€¥˜€ …„ñð€…ˆ¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐm‰½á°‰½á	t€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡l(€€€€€€€É•™É…µ•±½…Ñ¥¹œ¡„°ˆ¹ÍÉŒ¤°(€€€€€€€É•™É…µ•±½…Ñ¥¹œ¡ˆ°„¹ÍÉŒ¤°(€€€€€t¤ì(€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡˜€ôøì(€€€€€€€¥˜€¡˜¹¥€ôôô„¹¥¤É•ÑÕÉ¸ì€¸¸¹˜°ÍÉŒèˆ¹ÍÉŒ°€¸¸¹‰½áôì(€€€€€€€¥˜€¡˜¹¥€ôôôˆ¹¥¤É•ÑÕÉ¸ì€¸¸¹˜°ÍÉŒè„¹ÍÉŒ°€¸¸¹‰½áôì(€€€€€€€É•ÑÕÉ¸˜ì(€€€€€ô¤¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€€¼¼5¥á•è½¹”Í¥‘”¥Ì„±…å½ÕÐ•±°°Ñ¡”½Ñ¡•È„™É•”µÍÑ…¹‘¥¹œ¥µ…”¸(€€€½¹ÍÐ•±±%‘à€ôÍ½ÕÉ”¹­¥¹€ôôô€•±°œ€üÍ½ÕÉ”¹¥‘à€è€¡Ñ…É•Ð…Ìì­¥¹è€•±°œì¥‘àè¹Õµ‰•Èô¤¹¥‘àì(€€€½¹ÍÐ™±½…Ñ%€ôÍ½ÕÉ”¹­¥¹€ôôô€™±½…Ñ¥¹œœ€üÍ½ÕÉ”¹¥€è€¡Ñ…É•Ð…Ìì­¥¹è€™±½…Ñ¥¹œœì¥èÍÑÉ¥¹œô¤¹¥ì(€€€€¼¼ƒžn»š¢gš‚ó–¶C–>¿¢÷–Æ³šZóŽ3šÊKšr'¢Š¯¦ã’â·žj’ö#–ÆŽ7¾ò3š&’î—¢šš2–B7šb¿–N«’â–/’ö#–Æ (€€€½¹ÍÐÑ…É•Ñ1…å½ÕÑ%€ôÑ…É•Ð¹­¥¹€ôôô€•±°œ€üÑ…É•Ð¹±…å½ÕÑ%€èÕ¹‘•™¥¹•ì(€€€½¹ÍÐÑ…É•Ñ1…å½ÕÐ€ôÑ…É•Ñ1…å½ÕÑ%(€€€€€€üÁ…•Ì¹™±…Ñ5…À¡À€ôøÀ¹±…å½ÕÑÌ¤¹™¥¹¡°€ôø°¹¥€ôôôÑ…É•Ñ1…å½ÕÑ%¤(€€€€€€è…Ñ¥Ù•1…å½ÕÐì(€€€½¹ÍÐÍ•Ñ•±±Ì€ô€¡™¸è€¡¥µÌè%µ…••±±mt¤€ôø%µ…••±±mt¤€ôøì(€€€€€¥˜€ …Ñ…É•Ñ1…å½ÕÑ%¤ìÍ•Ñ%µ…•Ì¡™¸¤ìÉ•ÑÕÉ¸ìô(€€€€€Í•ÑA…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡À€ôøÀ¹±…å½ÕÑÌ¹Í½µ”¡°€ôø°¹¥€ôôôÑ…É•Ñ1…å½ÕÑ%¤(€€€€€€€€üì€¸¸¹À°±…å½ÕÑÌèÀ¹±…å½ÕÑÌ¹µ…À¡°€ôø°¹¥€ôôôÑ…É•Ñ1…å½ÕÑ%€üì€¸¸¹°°¥µ…•Ìè™¸¡°¹¥µ…•Ì¤ô€è°¤ô(€€€€€€€€èÀ¤¤ì(€€€ôì(€€€½¹ÍÐ•±±%µ…•Ì€ôÑ…É•Ñ1…å½ÕÐü¹¥µ…•Ì€üü¥µ…•Ìì(€€€½¹ÍÐ•±°€ô•±±%µ…•Ím•±±%‘átì(€€€½¹ÍÐ™±½…Ð€ô™±½…Ñ¥¹%µ…•Ì¹™¥¹¡˜€ôø˜¹¥€ôôô™±½…Ñ%¤ì(€€€¥˜€ …•±°ñð€…™±½…Ð¤É•ÑÕÉ¸ì(€€€€¼¼ƒš‚ó–¶C–þ¦‚#š.ÿ–"ÃšZÃ–r[žj–:–ž/¦Vß–¾³¾ò3–B›–&½Ù•ÈƒšržR£’â+’â–ò×–r[žjš¾S’ú/žº_¾ò3žV¯¦v‹–ÂÇ¢Š¯š.'š&’ê(€€€½¹ÍÐ¥¹½µ¥¹œ€ô…Ý…¥Ð•Ñ%µ…•¥µ•¹Í¥½¹Ì¡™±½…Ð¹ÍÉŒ¤ì((€€€¥˜€ …•±°¹ÕÉ°¤ì(€€€€€€¼¼ƒž¦ëš‚ó–¶CšÊKšr'švÇ¢–ÿ–>¿’î—š>o¾ò3ž¶'šZóš*+–r[ž&šB³¦Ë–:ï¾ò3¢«žRÇ–r[–Æ“–ÂÇš¶“šÚ#–’Ä(€€€€€Í•Ñ•±±Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡Œ°¤¤€ôø¤€ôôô•±±%‘à(€€€€€€€€üì€¸¸¹Œ°ÕÉ°è™±½…Ð¹ÍÉŒ°™¥±”èÕ¹‘•™¥¹•°é½½´è€Ä¸À°½™™Í•Ñ`è€À°½™™Í•Ñdè€À°É½Ñ…Ñ¥½¸è€À°(€€€€€€€€€€€¹…ÑÕÉ…±]¥‘Ñ è¥¹½µ¥¹œ¹Ý¥‘Ñ °¹…ÑÕÉ…±!•¥¡Ðè¥¹½µ¥¹œ¹¡•¥¡Ðô(€€€€€€€€èŒ¤¤ì(€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹™¥±Ñ•È¡˜€ôø˜¹¥€„ôô™±½…Ñ%¤¤ì(€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐ‰½à€ô…Ý…¥ÐÉ•™É…µ•±½…Ñ¥¹œ¡™±½…Ð°•±°¹ÕÉ°¤ì(€€€Í•Ñ•±±Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡Œ°¤¤€ôø¤€ôôô•±±%‘à(€€€€€€üì€¸¸¹Œ°ÕÉ°è™±½…Ð¹ÍÉŒ°™¥±”èÕ¹‘•™¥¹•°é½½´è€Ä¸À°½™™Í•Ñ`è€À°½™™Í•Ñdè€À°(€€€€€€€€€¹…ÑÕÉ…±]¥‘Ñ è¥¹½µ¥¹œ¹Ý¥‘Ñ °¹…ÑÕÉ…±!•¥¡Ðè¥¹½µ¥¹œ¹¡•¥¡Ðô(€€€€€€èŒ¤¤ì(€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡˜€ôø˜¹¥€ôôô™±½…Ñ%€üì€¸¸¹˜°ÍÉŒè•±°¹ÕÉ°°€¸¸¹‰½àô€è˜¤¤ì(€ôì((€½¹ÍÐ¡…¹‘±•±½…ÑMÝ…ÁQ½Õ¡MÑ…ÉÐ€ô€¡™%µœè±½…Ñ¥¹%µ…”¤€ôø€¡”èI•…Ð¹Q½Õ¡Ù•¹Ð¤€ôøì(€€€€¼¼ƒšZ–¶_¢"–r[–ö‹–r[–Æ“šÊKšr'žŸž&¾ò3’â7–>¢"¦Vßš2'’ê“š>l(€€€¥˜€¡™%µœ¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•ñð™%µœ¹Í¡…Á”¤É•ÑÕÉ¸ì(€€€¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €„ôô€Ä¤ì(€€€€€¥˜€¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì±•…ÉQ¥µ•½ÕÐ¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ìô(€€€€€Í•Ñ±½…ÑÉ…MÉŒ¡¹Õ±°¤ì(€€€€€Í•ÑMÝ…Á=Ù•ÉQ…É•Ð¡¹Õ±°¤ì(€€€€€™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐÐ€ô”¹Ñ½Õ¡•ÍlÁtì(€€€™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ð€ôì(€€€€€¥è™%µœ¹¥°ÍÉŒè™%µœ¹ÍÉŒ°(€€€€€ÍÑ…ÉÑ`èÐ¹±¥•¹Ñ`°ÍÑ…ÉÑdèÐ¹±¥•¹Ñd°±…ÍÑ`èÐ¹±¥•¹Ñ`°±…ÍÑdèÐ¹±¥•¹Ñd°(€€€€€ÍÝ¥Á¥¹œè™…±Í”°‘É…¥¹œè™…±Í”°(€€€ôì(€€€¥˜€¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤±•…ÉQ¥µ•½ÕÐ¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì(€€€™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ôÍ•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€½¹ÍÐÌ€ô™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ðì(€€€€€¥˜€ …ÌñðÌ¹ÍÝ¥Á¥¹œ¤É•ÑÕÉ¸ì(€€€€€€¼¼ƒ’öÿžR£¢º‡š^ÛžîOšv¢þg’â–"ïžjžr–º{¢ž›ž
ç¾ò3’â7šÊÿžR£–"kš2'’â/š^Û–>¿¢÷–ÞËšr'šòžžïžjš^Ÿ–vCš‚Ž(€€€€€Ì¹ÍÑ…ÉÑ`€ôÌ¹±…ÍÑ`ì(€€€€€Ì¹ÍÑ…ÉÑd€ôÌ¹±…ÍÑdì(€€€€€Ì¹‘É…¥¹œ€ôÑÉÕ”ì(€€€€€€¼¼ÍÝ…À‘É…œÝ¥¹Ì½Ù•ÈÑ¡”™É•”µµ½Ù”‘É…œÑ¡”…¹Ù…Ì¡…¹‘±•ÈÝ½Õ±½Ñ¡•ÉÝ¥Í”ÉÕ¸¸(€€€€€±½‰…±±½…Ñ¥¹Q½Õ¡MÑ…Ñ”¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€¼¼ƒ’æ¢šš*+žV¯–âžjš6Ë–.W¾ò?ž&§’îÛš&/–.‹’â¢Öß–>[šÚ#¾ò3¦Vßš2'š.[šnÏšf¦‚¦v‹’â7¢¦Ë¢Þ¢F_šîD(€€€€€ÍÑ½Á%¹•ÉÑ¥„ ¤ì(€€€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤ì(€€€€€¥˜€¡¹…Ù¥…Ñ½È¹Ù¥‰É…Ñ”¤¹…Ù¥…Ñ½È¹Ù¥‰É…Ñ” ÐÀ¤ì(€€€€€Í•Ñ±½…ÑÉ…MÉŒ¡Ì¹ÍÉŒ¤ì(€€€ô°1=9}AIMM}5L¤ì(€ôì((€½¹ÍÐ¡…¹‘±•±½…ÑMÝ…ÁQ½Õ¡5½Ù”€ô€¡”èI•…Ð¹Q½Õ¡Ù•¹Ð¤€ôøì(€€€½¹ÍÐÌ€ô™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …Ìñð”¹Ñ½Õ¡•Ì¹±•¹Ñ €„ôô€Ä¤É•ÑÕÉ¸ì(€€€½¹ÍÐÐ€ô”¹Ñ½Õ¡•ÍlÁtì(€€€Ì¹±…ÍÑ`€ôÐ¹±¥•¹Ñ`ì(€€€Ì¹±…ÍÑd€ôÐ¹±¥•¹Ñdì((€€€¥˜€¡Ì¹‘É…¥¹œ¤ì(€€€€€€¼¼ƒšN/–:žRš6Ë–.Wžjšb¿¦
–/¦vxÁ…ÍÍ¥Ù”ƒžj‘½Õµ•¹Ðƒžn¢÷–f£¾ò!I•…Ðƒ¦g–Æ“šb¼Á…ÍÍ¥Ù”ƒžj¾ò$(€€€€€½¹ÍÐ•°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ™±½…Ðµ‘É…œµÑ¡Õµ‰¹…¥°œ¤ì(€€€€€¥˜€¡•°¤•°¹ÍÑå±”¹ÑÉ…¹Í™½É´€ôÑÉ…¹Í±…Ñ”Í ‘íÐ¹±¥•¹ÑaõÁà°€‘íÐ¹±¥•¹ÑeõÁà°€À¤ÑÉ…¹Í±…Ñ” ´ÔÀ”°€´ÔÀ”¤Í…±” Ä¸Ä¤É½Ñ…Ñ” Ñ‘•œ¥€ì(€€€€€½¹ÍÐÑ…É•Ð€ô•ÑMÝ…ÁQ…É•ÑÉ½µA½¥¹Ð¡Ð¹±¥•¹Ñ`°Ð¹±¥•¹Ñd¤ì(€€€€€Í•ÑMÝ…Á=Ù•ÉQ…É•Ð¡Ñ…É•Ð€˜˜€„¡Ñ…É•Ð¹­¥¹€ôôô€™±½…Ñ¥¹œœ€˜˜Ñ…É•Ð¹¥€ôôôÌ¹¥¤€üÑ…É•Ð€è¹Õ±°¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐ‘à€ôÐ¹±¥•¹Ñ`€´Ì¹ÍÑ…ÉÑ`ì(€€€½¹ÍÐ‘ä€ôÐ¹±¥•¹Ñd€´Ì¹ÍÑ…ÉÑdì(€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ø€ÄÀ¤ì(€€€€€¥˜€¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì±•…ÉQ¥µ•½ÕÐ¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ìô(€€€ô(€ôì((€½¹ÍÐ¡…¹‘±•±½…ÑMÝ…ÁQ½Õ¡¹€ô€ ¤€ôøì(€€€¥˜€¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì±•…ÉQ¥µ•½ÕÐ¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ìô(€€€½¹ÍÐÌ€ô™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ðì(€€€™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€¥˜€ …Ì¤É•ÑÕÉ¸ì(€€€¥˜€¡Ì¹‘É…¥¹œ¤ì(€€€€€½¹ÍÐÑ…É•Ð€ôÍÝ…Á=Ù•ÉI•˜¹ÕÉÉ•¹Ðì(€€€€€Í•ÑMÝ…Á=Ù•ÉQ…É•Ð¡¹Õ±°¤ì(€€€€€Í•Ñ±½…ÑÉ…MÉŒ¡¹Õ±°¤ì(€€€€€¥˜€¡Ñ…É•Ð€˜˜€„¡Ñ…É•Ð¹­¥¹€ôôô€™±½…Ñ¥¹œœ€˜˜Ñ…É•Ð¹¥€ôôôÌ¹¥¤¤ì(€€€€€€€Ù½¥…ÁÁ±åMÝ…À¡ì­¥¹è€™±½…Ñ¥¹œœ°¥èÌ¹¥°ÍÉŒèÌ¹ÍÉŒô°Ñ…É•Ð¤ì(€€€€€ô(€€€ô(€ôì(((€€¼¼€´´´´´´ƒ’ö#–Æ¢Š¯¦ã–>[šfžjš&/–.‹¾òkš.[šnÏžžï–.WŽ¦ngš2žâ»šRø€´´´´´´(€½¹ÍÐ±…å½ÕÑ•ÍÑÕÉ•I•˜€ôÕÍ•I•˜ñì(€€€µ½‘”è€‘É…œœð€Á¥¹ œì(€€€ÍÑ…ÉÑ`è¹Õµ‰•ÈìÍÑ…ÉÑdè¹Õµ‰•Èì(€€€‰…Í•`è¹Õµ‰•Èì‰…Í•dè¹Õµ‰•Èì‰…Í•M…±”è¹Õµ‰•Èì(€€€ÍÑ…ÉÑ¥ÍÐè¹Õµ‰•Èì(€ôð¹Õ±°ø¡¹Õ±°¤ì((€€¼¨¨(€€€¨ƒ–£¦ã’ö#–Æžjžâ»šRû¾òk–ÂÇšb¿–Z»žÒSš*+šVÓžÖž¶'š¾S’ú/šRû–’Ÿžâ»–Â?¾ò3’ö7žö»’â7–.WŽ(€€€¨(€€€¨ƒ¦g¢Ž‡–"ïš?Ž3š¾?’â–âŸ–ÂÇžnÓš:—–¾¯¦Ëžr–¾›–Âë–¾ãŽ7¾ò3’â7–k¦
ž¢»Ž3š&/–.‹’â·–#žR ÑÉ…¹Í™½É´ƒšJC¢F_Ž(€€€¨ƒšRûš&/š&7š>C’ê“Ž7žjš*+š"ÈƒŠSŠPƒ–>«¢šš>C’ê“¦
’âš¶—–nƒž
ë’îï’öW–:–nƒšÊK¢ÞG–"Ã¾ò#š&/–.‹¢Š¯ž?¢š÷–f£’â·šZßŽ(€€€¨ƒ¦ã–>[ž.š/–&o––÷¢Š¯šâš:'Š›¾ò'¾ò3žV¯¦v‹–ÂÇšršVÓ–/–ö#–n{–:–’Ÿ–Â?ŽšÊKšr'š>C’ê“¦g’âš¶—–ÂÇ’â7šršr'¦gž¢»’ê/Ž(€€€¨¼(€½¹ÍÐÍ…±•1…å½ÕÐ€ô€¡¹•áÐè¹Õµ‰•È°Ñ…É•Ñ%èÍÑÉ¥¹œð¹Õ±°¤€ôøì(€€€Á…Ñ¡1…å½ÕÑP¡ìÍ…±”è5…Ñ ¹µ…à¡5%9}1e=UQ}M1°5…Ñ ¹µ¥¸ Ð°¹•áÐ¤¤ô°Ñ…É•Ñ%¤ì(€ôì((€€¼¨¨(€€€¨ƒ¦ngš2žâ»šRû’ö#–Æ¾òk¢Þ’â¢"³–r[ž&žjš6?–B#–º3–£’âš¢ŒƒŠSŠPƒ¦
+žV3šr–Bã¦f¦‚žÞ¾ò3¢3’âSš*+Ž3ž>û–r£žržj(€€€¨ƒ–Â7¦ö+–"ÃŽ7žjžÞkžV¯–ë’úŽš6?–B#šf’â·–þ’â7–.W¾ò3–>«šr'–no–/¦
+šr¦j£–7ž:žžï–.W¾ò3š&’î—š*+–7ž:¢žš"@(€€€¨ƒŽ3¦gšŠw¦
+–&o––÷¢B÷–r£¦‚žÞ’â+Ž7žj–ó¾ò3šr¢þGžj¦
’â–/–r£¦Zšªï–Ÿ–ÂÇ–Bã¦f¦;–:ïŽ(€€€¨(€€€¨ƒ–no¢žKžjžâ»šRû–rO¦î{–"ïš?’â7––_¦g’âšR¿¾ò#¢š,¡…¹‘±•1…å½ÕÑ½É¹•É5½Ù”ƒžj¢¢ï¢ž¾ò'¾òk’ö#–Æ–r (€€€¨Í…±”€Äƒšf–&o––÷ž¶'šZóšVÓ¦‚¾ò3–no–/¦
+šr–B3šf–Â7¦ö+¾ò3š.'¢žKžjšf–gšr’âžnÓ¢Š¯š.'–nx€ÇŽ(€€€¨ƒš6?–B#šb¿–§š‚çš&/š2Ž’ö7žžï¦?–’Ÿ–ú_–’k¾ò0ÑÁàƒžj¦î?¢F_ž¾–r7š:£–ú_¦;–:ï¾ò3’â7šr–6‡’ö?Ž(€€€¨¼(€½¹ÍÐÍ…±•1…å½ÕÑM¹…ÁÁ•€ô€¡¹•áÐè¹Õµ‰•È°Ñ…É•Ñ%èÍÑÉ¥¹œð¹Õ±°¤€ôøì(€€€±•Ð¹Ì€ô5…Ñ ¹µ…à¡5%9}1e=UQ}M1°5…Ñ ¹µ¥¸ Ð°¹•áÐ¤¤ì(€€€½¹ÍÐÉ•Ð€ô•ÑA…•I•Ð¡Í•±•Ñ•‘1…å½ÕÑA…•%‘à€øô€À€üÍ•±•Ñ•‘1…å½ÕÑA…•%‘à€è…Ñ¥Ù•A…•%¹‘•à¤ì(€€€½¹ÍÐÐ€ô…Ñ¥Ù•1…å½ÕÐü¹Ðì(€€€¥˜€ …É•Ðñð€…Ð¤ìÍ…±•1…å½ÕÐ¡¹Ì°Ñ…É•Ñ%¤ìÉ•ÑÕÉ¸ìô(€€€€¼¨ƒ’ö#–ÆžjŽ3šr«žâ»šRûš†Ž7’â7’â–ºkž¶'šZóšVÓ¦‚ƒŠSŠPƒ–º–>¿’î—šr'¢«–ÞÇžj¦Vß–¾³š¾S¾ò!±…å½ÕÑ	½ã¾ò'¾ò0(€€€€€€ƒ¢3’âSšb¿žö»’â·žjŽ–Bã¦f’â–ºk¢šžR£¦g–/š†žº_¾ò3’â7žÛ¢¢·¦;š¾S’ú/žj’ö#–ÆšržŸ¢F_šVÓ¦‚žj(€€€€€€ƒ¦
+žV3–Bã¾ò3žV¯¦v‹’â+žjš†¢Þ–¾›¦jo¢†3ž
ë–ÂÇ–Â7’â7’â+Ž€¨¼(€€€½¹ÍÐ‰½à€ô±…å½ÕÑ	½à¡…Ñ¥Ù•1…å½ÕÐ°É•Ð¹Ý¥‘Ñ °É•Ð¹¡•¥¡Ð¤ì(€€€½¹ÍÐà€ôÉ•Ð¹±•™Ð€¬€¡É•Ð¹Ý¥‘Ñ €´‰½à¹Ü¤€¼€È€¬Ð¹àì(€€€½¹ÍÐä€ôÉ•Ð¹Ñ½À€¬€¡É•Ð¹¡•¥¡Ð€´‰½à¹ ¤€¼€È€¬Ð¹äì(€€€½¹ÍÐà€ôà€¬‰½à¹Ü€¼€È°ä€ôä€¬‰½à¹ €¼€Èì(€€€€¼¨ƒ’ö#–Æ¢ö'¦;¢žK–ê›’æ/–ú3¾ò3¢Êó¦ö+¢šžr/žjšb¿Ž3¢ö'–º3žrš¶’öSžj¦
–/–’[š†Ž7¾ò0(€€€€€€ƒ¢Þ’â¢"³–r[ž&ŽšZ–¶_–B3’â––_¾ò#¢š,É½ÑáÑ•¹Ó¾ò'ŠSŠPƒ’â7žÛ¢ö$€äÀƒ–ê›šfžÞkšr’ê»–r (€€€€€€ƒ¦n‹¦
+žÞ–6+–/¢ê¯–¶Cžj–rÃšZçŽ–7ž:–Â7–’[š†šb¿žÞkšŸžj¾ò3š&’î—š.ÿŽ3’â–7Ž7žj–’[š†–:ï¢ž–ÂÇ––÷Ž€¨¼(€€€½¹ÍÐ±I½Ð€ôÐ¹É½Ðñð€Àì(€€€½¹ÍÐ•áÐÄ€ôÉ½ÑáÑ•¹Ð¡‰½à¹Ü°‰½à¹ °±I½Ð¤ì(€€€¥˜€¡•¹…‰±•M¹…ÁÁ¥¹œ¤ì(€€€€€½¹ÍÐM9@€ô€Ðì(€€€€€±•Ð‰•ÍÐ€ô%¹™¥¹¥Ñä°‰•ÍÑM…±”€ô¹Ìì(€€€€€Á…•I•ÑÍ9•…È¡•Ñ±±A…•I•ÑÌ ¤°à¤¹™½É… ¡ÁÈ€ôøì(€€€€€€€½¹ÍÐ…¹‘Ìè¹Õµ‰•Émt€ômtì(€€€€€€€¥˜€¡•áÐÄ¹‰Ü€ø€Ä¤ì(€€€€€€€€€…¹‘Ì¹ÁÕÍ   È€¨€¡à€´ÁÈ¹±•™Ð¤¤€¼•áÐÄ¹‰Ü¤ì€€€€¼¼ƒ–Þ›¦
+¢Êó¦ö((€€€€€€€€€…¹‘Ì¹ÁÕÍ   È€¨€¡ÁÈ¹É¥¡Ð€´à¤¤€¼•áÐÄ¹‰Ü¤ì€€€¼¼ƒ–>Ï¦
+¢Êó¦ö((€€€€€€€ô(€€€€€€€¥˜€¡•áÐÄ¹‰ €ø€Ä¤ì(€€€€€€€€€…¹‘Ì¹ÁÕÍ   È€¨€¡ä€´ÁÈ¹Ñ½À¤¤€¼•áÐÄ¹‰ ¤ì€€€€€¼¼ƒ’â+¦
+¢Êó¦ö((€€€€€€€€€…¹‘Ì¹ÁÕÍ   È€¨€¡ÁÈ¹‰½ÑÑ½´€´ä¤¤€¼•áÐÄ¹‰ ¤ì€€¼¼ƒ’â/¦
+¢Êó¦ö((€€€€€€€ô(€€€€€€€…¹‘Ì¹™½É… ¡…¹€ôøì(€€€€€€€€€¥˜€ „¡…¹€ø5%9}1e=UQ}M1¤ñð…¹€ø€Ð¤É•ÑÕÉ¸ì(€€€€€€€€€€¼¼ƒš>ožº_š"CŽ3žV¯¦v‹’â+–Þ»–æû–/–?žÒƒŽ7–7š¾S¦Zšªï¾ò3–7ž:šr³¢ê¯žj–Þ»šÊKšr'š?žú¤(€€€€€€€€€½¹ÍÐÁà€ô5…Ñ ¹…‰Ì¡…¹€´¹Ì¤€¨5…Ñ ¹µ…à¡•áÐÄ¹‰Ü°•áÐÄ¹‰ ¤€¼€Èì(€€€€€€€€€¥˜€¡Áà€ðM9@€˜˜Áà€ð‰•ÍÐ¤ì‰•ÍÐ€ôÁàì‰•ÍÑM…±”€ô…¹ìô(€€€€€€€ô¤ì(€€€€€ô¤ì(€€€€€¥˜€¡‰•ÍÐ€ðM9@¤¹Ì€ô‰•ÍÑM…±”ì(€€€ô(€€€Á…Ñ¡1…å½ÕÑP¡ìÍ…±”è¹Ìô°Ñ…É•Ñ%¤ì(€€€€¼¨ƒ–>«žV¯Ž3¦
+Ž7žjžÞk¾ò!•‘•=¹±ç¾ò'¾òkš6?–B#šf’â·–þ¦î{š‚çšr³’â7šr–.W¾ò3’â·žÞkšr–ú{¦‚·’ê»–"Ã–ÂøƒŠSŠP(€€€€€€ƒ’ö#–ÆšÊKšB³¦;žjšf–gšr³’ú–ÂÇš¶š¶–Â7–r£¦‚¦v‹’â·–þ¾ò3¦
–§šŠwžÞkž¶'šZóšVÓ¢Úš&/–.‹¦÷š:o–r£žV¯¦v‹’â+¾ò0(€€€€€€ƒžr/¢Öß’ú–?–Ž{š:'Žšr¦j£–7ž:žžï–.Wžj–>«šr'–no–/¦
+¾ò3¦
š&7šb¿¦g–/š&/–.‹žrš¶žj–n{¦–/Ž€¨¼(€€€€¼¨ƒ¦g¢Ž‡’â–ºk¢š–
Ï’ö#–Æ¢«–ÞÇžjš†¾ò!‰½ã¾ò'¢Þ¢žK–ê›¾òh(€€€€€€ƒ–
ÏšVÓ¦‚žj–¾³¦®cšr¢ºO’â·–þ¦î{žº_¦2¿¾ò#¢¢·¦;š¾S’ú/žj’ö#–Æš¾SšVÓ¦‚–Â?Ž¢3’âSšb¿žö»’â·žj¾ò'¾ò0(€€€€€€ƒ–ÂG–
Ï¢žK–ê›–&šb¿¢ö'¦;’æ/–ú3žÞkšr’ê»¦2¿’ö7žö»Ž€¨¼(€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡‘•‘ÕÁ•Õ¥‘•±¥¹•Ì¡Á…•Õ¥‘•±¥¹•ÍÐ¡à°ä°‰½à¹Ü°‰½à¹ °¹Ì°ÑÉÕ”°±I½Ð¤°à€¬‰½à¹Ü€¼€È¤¤ì(€ôì((€€¼¨¨(€€€¨ƒšRç’ö#–Æžj’ö7žö»¾ò?–’Ÿ–Â?Ž	Ñ…É•Ñ%ƒžRÇš&/–.‹–r£Ž3¦Z/–ž/žjšf–gŽ7¢¢c’â/’úƒŠSŠP(€€€¨ƒ’â7¢š¦vƒžVÛ’â/žjÍ•±•Ñ•‘1…å½ÕÑ%“¾òkš&/š2šRû¦Z/žjžz³¦ZO¦ã–>[ž.š/–>¿¢÷–ÞËžÚO¢Š¯–"—žj(€€€¨¡…¹‘±•Èƒšâš:'¾ò3¦
š¢¦g’âž¶–ÂÇšr–¾¯’â7¦Ë–:ï¾ò3žr/¢Öß’ú–ÂÇšb¿Ž3žâ»šRû–º3¢«–ÞÇ–ö#–n{–:–’Ÿ–Â?Ž7Ž(€€€¨¼(€½¹ÍÐÁ…Ñ¡1…å½ÕÑP€ô€¡Á…Ñ èA…ÉÑ¥…°ñìàè¹Õµ‰•Èìäè¹Õµ‰•ÈìÍ…±”è¹Õµ‰•ÈìÉ½Ðè¹Õµ‰•Èôø°Ñ…É•Ñ%üèÍÑÉ¥¹œð¹Õ±°¤€ôøì(€€€½¹ÍÐ¥€ôÑ…É•Ñ%€üüÍ•±•Ñ•‘1…å½ÕÑ%ì(€€€¥˜€ …¥¤É•ÑÕÉ¸ì(€€€Í•ÑA…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡À€ôøÀ¹±…å½ÕÑÌ¹Í½µ”¡°€ôø°¹¥€ôôô¥¤€ü€¡ì(€€€€€€¸¸¹À°(€€€€€±…å½ÕÑÌèÀ¹±…å½ÕÑÌ¹µ…À¡°€ôø°¹¥€ôôô¥€üì€¸¸¹°°Ðèì€¸¸¹°¹Ð°€¸¸¹Á…Ñ ôô€è°¤°(€€€ô¤€èÀ¤¤ì(€ôì((€€¼¨¨(€€€¨ƒš¾?–/ž&§’îÛ¾ò#žŸž&ŽšZ–¶_Ž’ö#–Æ¾ò'–ÇžR£–B3’âšŠw–r[–Æ“¦‚–ê?Ž(€€€¨(€€€¨ƒžV¯¦v‹’â+žjèµ¥¹‘•àƒ’â¢"³–r[ž&šb¼€ØÀ€¬€É§Ž’ö#–Æšb¼€Ôä€¬€Éë¾ò3–§¦
+–&o––÷’ê“¦2¼ƒŠSŠP(€€€¨ƒ’æ–ÂÇšb¿Ž3’ö#–ÆžjëŽ7¾òwŽ3–º’â/¦v‹šr'–æû–ò×’â¢"³–r[ž&Ž7Ž¦g¢Ž‡š*+–§¦
+šR“–æÏš"C’âšŠt(€€€¨ƒžRÇ’â/–"Ã’â+žjšâ–Z»¾ò3’â+žžï¾ò?’â/žžï–ÂÇ–>«šb¿¢Þšâ–Z»¢Ž‡žj¦jS–Žš>o’ö7–¶CŽ(€€€¨ƒ’î—–&7–§¦
+–Bš:K–Bžj¾ò#–r[ž&–>«¢Þ–r[ž&š>oŽ’ö#–Æ–>«¢Þ’ö#–Æš>o¾ò'¾ò3–r[ž&šÂã¦ƒž"³’â7–"À(€€€¨ƒšr’â+¦v‹¦
žÖ’ö#–Æ’â+¦v‹¾ò3¦g–ÂÇšb¿Ž3–r[ž&ž‡šÎW¢Ú¦;’ö#–Æžj–r[–Æ“Ž7žj–:–nƒŽ(€€€¨¼(€ÑåÁ”MÑ…­I•˜€ôì­¥¹è€™±½…Ðœð€±…å½ÕÐœì¥èÍÑÉ¥¹œôì(€½¹ÍÐ±…å•ÉMÑ…¬€ôÕÍ•5•µ¼ñMÑ…­I•™mtø  ¤€ôøì(€€€½¹ÍÐ¥Ñ•µÌèì­•äè¹Õµ‰•ÈìÉ•˜èMÑ…­I•˜õmt€ômtì(€€€™±½…Ñ¥¹%µ…•Ì¹™½É…  ¡˜°¤¤€ôø¥Ñ•µÌ¹ÁÕÍ ¡ì­•äè€ØÀ€¬¤€¨€È°É•˜èì­¥¹è€™±½…Ðœ°¥è˜¹¥ôô¤¤ì(€€€Á…•Ì¹™½É… ¡À€ôøÀ¹±…å½ÕÑÌ¹™½É… ¡°€ôø(€€€€€¥Ñ•µÌ¹ÁÕÍ ¡ì­•äè€Ôä€¬€¡°¹è€üü€À¤€¨€È°É•˜èì­¥¹è€±…å½ÕÐœ°¥è°¹¥ôô¤¤¤ì(€€€€¼¼ƒ–B3’â–Æ“žj–§–/’ö#–Æ ­•äƒšržnã–B3¾ò3ž¦§–ºkš:K–ê?šr’þwžVg¦f–"_¦‚–ê?¾òu=4ƒ¦‚–ê?¾òwžV¯¦v‹’â+žj’â+’â,(€€€¥Ñ•µÌ¹Í½ÉÐ ¡„°ˆ¤€ôø„¹­•ä€´ˆ¹­•ä¤ì(€€€É•ÑÕÉ¸¥Ñ•µÌ¹µ…À¡¤€ôø¤¹É•˜¤ì(€ô°m™±½…Ñ¥¹%µ…•Ì°Á…•Ít¤ì((€½¹ÍÐÍÑ…­A½Ì€ô€¡­¥¹èMÑ…­I•™l­¥¹t°¥èÍÑÉ¥¹œð¹Õ±°¤€ôø(€€€¥€ü±…å•ÉMÑ…¬¹™¥¹‘%¹‘•à¡Ì€ôøÌ¹­¥¹€ôôô­¥¹€˜˜Ì¹¥€ôôô¥¤€è€´Äì((€€¼¨¨ƒ–r£–ÇžR£žj–r[–Æ“šâ–Z»¢Ž‡¢Þ’â+¾ò?’â/’â–/ž&§’îÛš>o’ö7–¶C¾ò3–7š>ožº_–n{–B¢«žj¢†£ž’ëšÎT€¨¼(€½¹ÍÐµ½Ù•%¹MÑ…¬€ô€¡­¥¹èMÑ…­I•™l­¥¹t°¥èÍÑÉ¥¹œ°‘¥Èè€Äð€´Ä¤€ôøì(€€€½¹ÍÐ¤€ôÍÑ…­A½Ì¡­¥¹°¥¤ì(€€€½¹ÍÐ¨€ô¤€¬‘¥Èì(€€€¥˜€¡¤€ð€Àñð¨€ð€Àñð¨€øô±…å•ÉMÑ…¬¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€½¹ÍÐ¹•áÐ€ôl¸¸¹±…å•ÉMÑ…­tì(€€€m¹•áÑm¥t°¹•áÑm©ut€ôm¹•áÑm©t°¹•áÑm¥utì((€€€½¹ÍÐ™±½…ÑI…¹¬€ô¹•Ü5…ÀñÍÑÉ¥¹œ°¹Õµ‰•Èø ¤ì(€€€½¹ÍÐ±…å½ÕÑh€ô¹•Ü5…ÀñÍÑÉ¥¹œ°¹Õµ‰•Èø ¤ì(€€€½¹ÍÐ±…å½ÕÑI…¹¬€ô¹•Ü5…ÀñÍÑÉ¥¹œ°¹Õµ‰•Èø ¤ì(€€€±•Ð™±½…ÑÌ€ô€Àì(€€€¹•áÐ¹™½É…  ¡Ì°¬¤€ôøì(€€€€€¥˜€¡Ì¹­¥¹€ôôô€™±½…Ðœ¤™±½…ÑI…¹¬¹Í•Ð¡Ì¹¥°™±½…ÑÌ¬¬¤ì(€€€€€€¼¼ƒ’ö#–Æžjèƒ–ÂÇšb¿Ž3–êW’â/šr'–æû–ò×’â¢"³–r[ž&Ž7¾òo–B0èƒžj’ö#–Æ–7žR£¦f–"_¦‚–ê?–"’â+’â,(€€€€€•±Í”ì±…å½ÕÑh¹Í•Ð¡Ì¹¥°™±½…ÑÌ¤ì±…å½ÕÑI…¹¬¹Í•Ð¡Ì¹¥°¬¤ìô(€€€ô¤ì(€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøl¸¸¹ÁÉ•Ùt¹Í½ÉÐ ¡„°ˆ¤€ôø€¡™±½…ÑI…¹¬¹•Ð¡„¹¥¤€üü€À¤€´€¡™±½…ÑI…¹¬¹•Ð¡ˆ¹¥¤€üü€À¤¤¤ì(€€€Í•ÑA…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡À€ôø€¡ì(€€€€€€¸¸¹À°(€€€€€±…å½ÕÑÌèl¸¸¹À¹±…å½ÕÑÍt(€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø€¡±…å½ÕÑI…¹¬¹•Ð¡„¹¥¤€üü€À¤€´€¡±…å½ÕÑI…¹¬¹•Ð¡ˆ¹¥¤€üü€À¤¤(€€€€€€€€¹µ…À¡°€ôø€¡±…å½ÕÑh¹¡…Ì¡°¹¥¤€üì€¸¸¹°°èè±…å½ÕÑh¹•Ð¡°¹¥¤„ô€è°¤¤°(€€€ô¤¤¤ì(€ôì((€€¼¼ƒ’ö#–Æ–no¢žKžjžâ»šRû–rO¦î{¾òkš.[–N«’â¢žK¾ò3–Â7¢žK–ÂÇ–në–ºk’â7–.W¾ò#¢"’â¢"³–r[ž&žjžâ»šRû¦
?¢ò¿žnã–B3¾ò$(€½¹ÍÐ±…å½ÕÑ½É¹•ÉI•˜€ôÕÍ•I•˜ñì(€€€Á½¥¹Ñ•É%è¹Õµ‰•Èì(€€€€¼¨¨ƒš&/–.‹’â¦Z/–ž/–ÂÇ¢¢c’ö?–r£žâ»–N«’âžÖ¾ò3’æ/–ú3’â7žr/žVÛ’â/žj¦ã–>[ž.š,€¨¼(€€€±…å½ÕÑ%èÍÑÉ¥¹œð¹Õ±°ì(€€€Á¥Ù½Ñ`è¹Õµ‰•ÈìÁ¥Ù½Ñdè¹Õµ‰•Èì(€€€ÍÑ…ÉÑ¥ÍÐè¹Õµ‰•Èì(€€€‰…Í•M…±”è¹Õµ‰•Èì‰…Í•`è¹Õµ‰•Èì‰…Í•dè¹Õµ‰•Èì(€€€½àè¹Õµ‰•Èì½äè¹Õµ‰•Èì(€ôð¹Õ±°ø¡¹Õ±°¤ì((€½¹ÍÐ¡…¹‘±•1…å½ÕÑ½É¹•É½Ý¸€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ð°½É¹•Èè€Ñ°œð€ÑÈœð€‰°œð€‰Èœ¤€ôøì(€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€½¹ÍÐÝÉ…ÁÁ•È€ô€¡”¹ÕÉÉ•¹ÑQ…É•Ð…Ì!Q51±•µ•¹Ð¤¹±½Í•ÍÐ m‘…Ñ„µ±…å½ÕÐµÝÉ…ÁÁ•Étœ¤…Ì!Q51±•µ•¹Ðð¹Õ±°ì(€€€¥˜€ …ÝÉ…ÁÁ•È¤É•ÑÕÉ¸ì(€€€½¹ÍÐÈ€ôÝÉ…ÁÁ•È¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€€¼¼ƒš.[¢žKžB¾òw–Z»žÒSž¶'š¾Sžâ»šRû¾ò3¢Þ–r£ž¦ëžf÷žV¯–â’â+¦ngš2žâ»šRû–º3–£’âš¢¾òh(€€€€¼¼ƒ’î—Ž3’ö#–Æ’â·–þŽ7ž
ë–:¦î{¾ò3–>«žr/š&/š2¦n‹’â·–þ–’k¦ƒ¾ò3’ö7žö»–º3–£’â7–.WŽ(€€€½¹ÍÐÁ¥Ù½Ñ`€ôÈ¹±•™Ð€¬È¹Ý¥‘Ñ €¼€Èì(€€€½¹ÍÐÁ¥Ù½Ñd€ôÈ¹Ñ½À€¬È¹¡•¥¡Ð€¼€Èì(€€€½¹ÍÐ‘¥ÍÐ€ô5…Ñ ¹¡åÁ½Ð¡”¹±¥•¹Ñ`€´Á¥Ù½Ñ`°”¹±¥•¹Ñd€´Á¥Ù½Ñd¤ì(€€€¥˜€¡‘¥ÍÐ€ð€Ä¤É•ÑÕÉ¸ì(€€€½¹ÍÐ‰…Í”€ô…Ñ¥Ù•1…å½ÕÐü¹Ðñðìàè€À°äè€À°Í…±”è€Äôì(€€€ÑÉäì€¡”¹ÕÉÉ•¹ÑQ…É•Ð…Ì!Q51±•µ•¹Ð¤¹Í•ÑA½¥¹Ñ•É…ÁÑÕÉ”¡”¹Á½¥¹Ñ•É%¤ìô…Ñ €¡•ÉÈ¤íô(€€€±…å½ÕÑ½É¹•ÉI•˜¹ÕÉÉ•¹Ð€ôì(€€€€€Á½¥¹Ñ•É%è”¹Á½¥¹Ñ•É%°(€€€€€±…å½ÕÑ%èÝÉ…ÁÁ•È¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ±…å½ÕÐµ¥œ¤ñðÍ•±•Ñ•‘1…å½ÕÑ%°(€€€€€Á¥Ù½Ñ`°Á¥Ù½Ñd°ÍÑ…ÉÑ¥ÍÐè‘¥ÍÐ°(€€€€€‰…Í•M…±”è‰…Í”¹Í…±”ñð€Ä°‰…Í•`è‰…Í”¹à°‰…Í•dè‰…Í”¹ä°(€€€€€½àè€À°½äè€À°(€€€ôì(€ôì((€½¹ÍÐ¡…¹‘±•1…å½ÕÑ½É¹•É5½Ù”€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ð¤€ôøì(€€€½¹ÍÐœ€ô±…å½ÕÑ½É¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …œñðœ¹Á½¥¹Ñ•É%€„ôô”¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€¼¼ƒ–Z»žÒSž¶'š¾S¾òkš&/š2¦n‹’â·–þžj¢Þw¦n‹¢º+–æû–7¾ò3’ö#–Æ–ÂÇ¢º+–æû–7Ž(€€€€¼¼ƒ¾ò#¦g¢Ž‡–"ïš?’â7–kŽ3¢žK–Bã¦f¦‚žÞŽ7ŠSŠPƒ’ö#–Æ–r Í…±”€Äƒšf–&o––÷ž¶'šZóšVÓ¦‚¾ò0(€€€€¼¼€€ƒ–no–/¦
+šr–B3šf–Â7¦ö+¾ò3–Bã¦f–ÂÇšr’âžnÓš*+–Âë–¾ãš.'–nx€Ç¾ò3šRû–’Ÿ–"Ã’â–6+–ÂÇžâ»–n{–:ïŽ¾ò$(€€€½¹ÍÐ‘¥ÍÐ€ô5…Ñ ¹¡åÁ½Ð¡”¹±¥•¹Ñ`€´œ¹Á¥Ù½Ñ`°”¹±¥•¹Ñd€´œ¹Á¥Ù½Ñd¤ì(€€€Í…±•1…å½ÕÐ¡œ¹‰…Í•M…±”€¨€¡‘¥ÍÐ€¼œ¹ÍÑ…ÉÑ¥ÍÐ¤°œ¹±…å½ÕÑ%¤ì(€ôì((€½¹ÍÐ¡…¹‘±•1…å½ÕÑ½É¹•ÉUÀ€ô€¡”èI•…Ð¹A½¥¹Ñ•ÉÙ•¹Ð¤€ôøì(€€€¥˜€ …±…å½ÕÑ½É¹•ÉI•˜¹ÕÉÉ•¹Ðñð±…å½ÕÑ½É¹•ÉI•˜¹ÕÉÉ•¹Ð¹Á½¥¹Ñ•É%€„ôô”¹Á½¥¹Ñ•É%¤É•ÑÕÉ¸ì(€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€ÑÉäì€¡”¹ÕÉÉ•¹ÑQ…É•Ð…Ì!Q51±•µ•¹Ð¤¹É•±•…Í•A½¥¹Ñ•É…ÁÑÕÉ”¡”¹Á½¥¹Ñ•É%¤ìô…Ñ €¡•ÉÈ¤íô(€€€±…å½ÕÑ½É¹•ÉI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤ì(€ôì((€€¼¨¨ƒš&/–.‹¦Z/–ž/šf¢¢c’â/–r£šN7’ös–N«’âžÖ’ö#–Æ¾ò#’â7žr/’æ/–ú3žj¦ã–>[ž.š/¾ò$€¨¼(€½¹ÍÐ±…å½ÕÑ•ÍÑÕÉ•%‘I•˜€ôÕÍ•I•˜ñÍÑÉ¥¹œð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐÝÍ•ÍÑÕÉ•1…å½ÕÑ%‘I•˜€ôÕÍ•I•˜ñÍÑÉ¥¹œð¹Õ±°ø¡¹Õ±°¤ì((€½¹ÍÐ¡…¹‘±•1…å½ÕÑQ½Õ¡MÑ…ÉÐ€ô€¡”èI•…Ð¹Q½Õ¡Ù•¹Ð¤€ôøì(€€€¥˜€ …±…å½ÕÑM•±•Ñ•ñðÍ•±•Ñ•‘%¹‘•à€„ôô¹Õ±°¤É•ÑÕÉ¸ì(€€€±…å½ÕÑ•ÍÑÕÉ•%‘I•˜¹ÕÉÉ•¹Ð€ô€¡”¹ÕÉÉ•¹ÑQ…É•Ð…Ì!Q51±•µ•¹Ð¤(€€€€€€¹±½Í•ÍÐ m‘…Ñ„µ±…å½ÕÐµÝÉ…ÁÁ•Étœ¤ü¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ±…å½ÕÐµ¥œ¤ñðÍ•±•Ñ•‘1…å½ÕÑ%ì(€€€½¹ÍÐÐ€ô”¹Ñ…É•Ð…Ì±•µ•¹Ðì(€€€¥˜€¡Ð¹±½Í•ÍÐ œ¹ÕÉÍ½Èµ¹ÝÍ”µÉ•Í¥é”œ¤ñðÐ¹±½Í•ÍÐ œ¹ÕÉÍ½Èµ¹•ÍÜµÉ•Í¥é”œ¤¤É•ÑÕÉ¸ì(€€€½¹ÍÐ‰…Í”€ô…Ñ¥Ù•1…å½ÕÐü¹Ðñðìàè€À°äè€À°Í…±”è€Äôì(€€€¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€È¤ì(€€€€€½¹ÍÐ€ô5…Ñ ¹¡åÁ½Ð (€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`°(€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd(€€€€€€¤ñð€Äì(€€€€€±…å½ÕÑ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ôì(€€€€€€€µ½‘”è€Á¥¹ œ°(€€€€€€€ÍÑ…ÉÑ`è€¡”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€¬”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`¤€¼€È°(€€€€€€€ÍÑ…ÉÑdè€¡”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€¬”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd¤€¼€È°(€€€€€€€‰…Í•`è‰…Í”¹à°‰…Í•dè‰…Í”¹ä°‰…Í•M…±”è‰…Í”¹Í…±”°ÍÑ…ÉÑ¥ÍÐè°(€€€€€ôì(€€€ô•±Í”ì(€€€€€±…å½ÕÑ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ôì(€€€€€€€µ½‘”è€‘É…œœ°(€€€€€€€ÍÑ…ÉÑ`è”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`°ÍÑ…ÉÑdè”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd°(€€€€€€€‰…Í•`è‰…Í”¹à°‰…Í•dè‰…Í”¹ä°‰…Í•M…±”è‰…Í”¹Í…±”°ÍÑ…ÉÑ¥ÍÐè€Ä°(€€€€€ôì(€€€ô(€ôì((€½¹ÍÐ¡…¹‘±•1…å½ÕÑQ½Õ¡5½Ù”€ô€¡”èI•…Ð¹Q½Õ¡Ù•¹Ð¤€ôøì(€€€¥˜€¡¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹ÐñðÑ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¤ì±…å½ÕÑ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ìÉ•ÑÕÉ¸ìô(€€€½¹ÍÐœ€ô±…å½ÕÑ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …œ¤É•ÑÕÉ¸ì(€€€¥˜€¡œ¹µ½‘”€ôôô€Á¥¹ œ€˜˜”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€È¤ì(€€€€€½¹ÍÐ€ô5…Ñ ¹¡åÁ½Ð (€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`°(€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd(€€€€€€¤ì(€€€€€Í…±•1…å½ÕÑM¹…ÁÁ•¡œ¹‰…Í•M…±”€¨€¡€¼œ¹ÍÑ…ÉÑ¥ÍÐ¤°±…å½ÕÑ•ÍÑÕÉ•%‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€ô•±Í”¥˜€¡œ¹µ½‘”€ôôô€‘É…œœ€˜˜”¹Ñ½Õ¡•Ì¹±•¹Ñ €ôôô€Ä¤ì(€€€€€€¼¼ƒ–B3’â+¾òk¢z‹–æW’ö7žžï¢š–#š>ožº_–n{–Ÿ–ºç–Z»’ö4(€€€€€½¹ÍÐ­€ô­I•˜¹ÕÉÉ•¹Ðñð€Äì(€€€€€µ½Ù•1…å½ÕÑQ¼ (€€€€€€€œ¹‰…Í•`€¬€¡”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´œ¹ÍÑ…ÉÑ`¤€¼­°(€€€€€€€œ¹‰…Í•d€¬€¡”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´œ¹ÍÑ…ÉÑd¤€¼­°(€€€€€€¤ì(€€€ô(€ôì((€½¹ÍÐ¡…¹‘±•1…å½ÕÑQ½Õ¡¹€ô€ ¤€ôøì±…å½ÕÑ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ìÍ•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤ìôì((€€¼¨¨(€€€¨ƒ’ö#–Æ¢Š¯šVÓžÖ¦ã–>[šf–ÂÇž¶'–B3’â–ò×–r[ž&¾ò3žžï–.Wšf–B3š¢¢š–Bã¦f’â›¦†¿ž’ë–Â7¦ö+žÞkŽ(€€€¨ƒ’ö#–Æšr«¢º+–ö‹šf–&o––÷ž¶'šZóšVÓ¦‚¾ò3š&’î—–ºžjŽ3šr«žâ»šRûš†Ž7–ÂÇšb¿¦‚¦v‹šr³¢ê¯Ž(€€€¨¼(€½¹ÍÐµ½Ù•1…å½ÕÑQ¼€ô€¡¹àè¹Õµ‰•È°¹äè¹Õµ‰•È¤€ôøì(€€€½¹ÍÐÍ…±”€ô…Ñ¥Ù•1…å½ÕÐü¹Ðü¹Í…±”€üü€Äì(€€€½¹ÍÐÉ•Ð€ô•ÑA…•I•Ð¡Í•±•Ñ•‘1…å½ÕÑA…•%‘à€øô€À€üÍ•±•Ñ•‘1…å½ÕÑA…•%‘à€è…Ñ¥Ù•A…•%¹‘•à¤ì(€€€¥˜€ …É•Ð¤ìÁ…Ñ¡1…å½ÕÑP¡ìàè¹à°äè¹äô¤ìÉ•ÑÕÉ¸ìô(€€€€¼¼ƒ¢Þ’â+¦v‹–B3’â–/žBžRÇ¾òkžR£’ö#–Æ¢«–ÞÇžjš†¾ò#–>¿¢÷š¾SšVÓ¦‚–Â?Ž¢3’âSšb¿žö»’â·žj¾ò$(€€€½¹ÍÐ‰½à€ô±…å½ÕÑ	½à¡…Ñ¥Ù•1…å½ÕÐ°É•Ð¹Ý¥‘Ñ °É•Ð¹¡•¥¡Ð¤ì(€€€½¹ÍÐìÍ¹…ÁÁ•‘`°Í¹…ÁÁ•‘d°Õ¥‘•±¥¹•Ìô€ô…ÁÁ±åM¹…ÁÁ¥¹œ (€€€€€±…å½ÕÐè‘íÍ•±•Ñ•‘1…å½ÕÑ%‘õ€°(€€€€€É•Ð¹±•™Ð€¬€¡É•Ð¹Ý¥‘Ñ €´‰½à¹Ü¤€¼€È€¬¹à°(€€€€€É•Ð¹Ñ½À€¬€¡É•Ð¹¡•¥¡Ð€´‰½à¹ ¤€¼€È€¬¹ä°(€€€€€‰½à¹Ü°(€€€€€‰½à¹ °(€€€€€Í…±”°(€€€€€Õ¹‘•™¥¹•°(€€€€€€¼¼ƒ¢ö'¦;¢žK–ê›žj’ö#–Æ¾ò3’âš¢žR£¢ö'–º3žj–’[š†–:ïš¾S¾ò#¢Þ’â¢"³–r[ž&ŽšZ–¶_–B3’â––_¾ò$(€€€€€…Ñ¥Ù•1…å½ÕÐü¹Ðü¹É½Ðñð€À°(€€€€¤ì(€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡Õ¥‘•±¥¹•Ì¤ì(€€€€¼¼ƒ–Bã¦f–n{’úžjšb¿Ž3š†žj–Þ›’â+¢žKŽ7¾ò3š&š:'žö»’â·žj¦
’âšº×š&7šb¿’ö#–Æžj’ö7žžï¦<(€€€Á…Ñ¡1…å½ÕÑP¡ì(€€€€€àèÍ¹…ÁÁ•‘`€´É•Ð¹±•™Ð€´€¡É•Ð¹Ý¥‘Ñ €´‰½à¹Ü¤€¼€È°(€€€€€äèÍ¹…ÁÁ•‘d€´É•Ð¹Ñ½À€´€¡É•Ð¹¡•¥¡Ð€´‰½à¹ ¤€¼€È°(€€€ô¤ì(€ôì((€€¼¼ƒ’úwš‚ó–¶C–Âë–¾ãžº_–ëžŸž&–>¿’ö7žžïžjž¾–r7¾ò#–Z»’ö7ž
ëš‚ó–¶C–¾°¿¦®cžjš¾S’ú/¾ò$(€½¹ÍÐ•±±M¡¥™Ñ1¥µ¥ÑÌ€ô€¡¥‘àè¹Õµ‰•È°é½½´è¹Õµ‰•È¤€ôøì(€€€½¹ÍÐÑ•µÁ±…Ñ•Ì€ôQ5A1Q}5Am¥µ…•Ì¹±•¹Ñ¡tñðmtì(€€€½¹ÍÐ…Ñ¥Ù•QµÁ°€ôÑ•µÁ±…Ñ•ÍmÑ•µÁ±…Ñ•%¹‘•átñðÑ•µÁ±…Ñ•ÍlÁtì(€€€½¹ÍÐÉ•Ð€ô…Ñ¥Ù•QµÁ°ü¹É•ÑÍm¥‘átì(€€€½¹ÍÐ•±°€ô¥µ…•Ím¥‘átì(€€€¥˜€ …É•Ðñð€…•±°¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐ•±±]¥‘Ñ €ôÉ•Ð¹Ü€¨ÁÉ•Ù¥•Ý\€¨±…å½ÕÑM…±”ì(€€€½¹ÍÐ•±±!•¥¡Ð€ôÉ•Ð¹ €¨ÁÉ•Ù¥•Ý €¨±…å½ÕÑM…±”ì(€€€¥˜€¡•±±]¥‘Ñ €ðô€Àñð•±±!•¥¡Ð€ðô€À¤É•ÑÕÉ¸¹Õ±°ì(€€€½¹ÍÐÝ}¥µœ€ô•±°¹¹…ÑÕÉ…±]¥‘Ñ ñð€àÀÀì(€€€½¹ÍÐ¡}¥µœ€ô•±°¹¹…ÑÕÉ…±!•¥¡Ðñð€ØÀÀì(€€€½¹ÍÐ¥ÌäÁ½ÈÈÜÀ€ô€¡•±°¹É½Ñ…Ñ¥½¸€”€ÄàÀ¤€„ôô€Àì(€€€½¹ÍÐ‘É…Ý\€ô¥ÌäÁ½ÈÈÜÀ€ü¡}¥µœ€èÝ}¥µœì(€€€½¹ÍÐ‘É…Ý €ô¥ÌäÁ½ÈÈÜÀ€üÝ}¥µœ€è¡}¥µœì(€€€½¹ÍÐ½Ù•ÉM…±”€ô5…Ñ ¹µ…à¡•±±]¥‘Ñ €¼‘É…Ý\°•±±!•¥¡Ð€¼‘É…Ý ¤ì(€€€½¹ÍÐ™¥¹…±M…±”€ô½Ù•ÉM…±”€¨é½½´ì(€€€½¹ÍÐÉ½Ñ…Ñ•‘%µ\€ô€¡¥ÌäÁ½ÈÈÜÀ€ü¡}¥µœ€èÝ}¥µœ¤€¨™¥¹…±M…±”ì(€€€½¹ÍÐÉ½Ñ…Ñ•‘%µ €ô€¡¥ÌäÁ½ÈÈÜÀ€üÝ}¥µœ€è¡}¥µœ¤€¨™¥¹…±M…±”ì(€€€É•ÑÕÉ¸ì(€€€€€•±±]¥‘Ñ °(€€€€€•±±!•¥¡Ð°(€€€€€µ…áM¡¥™Ñ`è5…Ñ ¹µ…à À°€¡É½Ñ…Ñ•‘%µ\€´•±±]¥‘Ñ ¤€¼€È¤€¼•±±]¥‘Ñ °(€€€€€µ…áM¡¥™Ñdè5…Ñ ¹µ…à À°€¡É½Ñ…Ñ•‘%µ €´•±±!•¥¡Ð¤€¼€È¤€¼•±±!•¥¡Ð°(€€€ôì(€ôì((€½¹ÍÐ…ÁÁ±å•±±i½½´€ô€¡¥‘àè¹Õµ‰•È°é½½´è¹Õµ‰•È¤€ôøì(€€€½¹ÍÐ±¥´€ô•±±M¡¥™Ñ1¥µ¥ÑÌ¡¥‘à°é½½´¤ì(€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡•±°°¤¤€ôø¤€„ôô¥‘à€ü•±°€è€¡ì(€€€€€€¸¸¹•±°°(€€€€€é½½´°(€€€€€½™™Í•Ñ`è±¥´€ü5…Ñ ¹µ…à µ±¥´¹µ…áM¡¥™Ñ`°5…Ñ ¹µ¥¸¡±¥´¹µ…áM¡¥™Ñ`°•±°¹½™™Í•Ñ`¤¤€è•±°¹½™™Í•Ñ`°(€€€€€½™™Í•Ñdè±¥´€ü5…Ñ ¹µ…à µ±¥´¹µ…áM¡¥™Ñd°5…Ñ ¹µ¥¸¡±¥´¹µ…áM¡¥™Ñd°•±°¹½™™Í•Ñd¤¤€è•±°¹½™™Í•Ñd°(€€€ô¤¤¤ì(€ôì((€½¹ÍÐ…ÁÁ±å•±±A…¸€ô€¡¥‘àè¹Õµ‰•È°‰…Í•=™™Í•Ñ`è¹Õµ‰•È°‰…Í•=™™Í•Ñdè¹Õµ‰•È°‘àè¹Õµ‰•È°‘äè¹Õµ‰•È¤€ôøì(€€€½¹ÍÐ•±°€ô¥µ…•Ím¥‘átì(€€€¥˜€ …•±°¤É•ÑÕÉ¸ì(€€€½¹ÍÐ±¥´€ô•±±M¡¥™Ñ1¥µ¥ÑÌ¡¥‘à°•±°¹é½½´¤ì(€€€¥˜€ …±¥´¤É•ÑÕÉ¸ì(€€€½¹ÍÐ¹à€ô5…Ñ ¹µ…à µ±¥´¹µ…áM¡¥™Ñ`°5…Ñ ¹µ¥¸¡±¥´¹µ…áM¡¥™Ñ`°‰…Í•=™™Í•Ñ`€¬‘à€¼±¥´¹•±±]¥‘Ñ ¤¤ì(€€€½¹ÍÐ¹ä€ô5…Ñ ¹µ…à µ±¥´¹µ…áM¡¥™Ñd°5…Ñ ¹µ¥¸¡±¥´¹µ…áM¡¥™Ñd°‰…Í•=™™Í•Ñd€¬‘ä€¼±¥´¹•±±!•¥¡Ð¤¤ì(€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡Œ°¤¤€ôø¤€„ôô¥‘à€üŒ€è€¡ì€¸¸¹Œ°½™™Í•Ñ`è¹à°½™™Í•Ñdè¹äô¤¤¤ì(€ôì((€€¼¼€´´´´´´ƒžV¯–â–Æ“žÒkš&/–.ˆ€´´´´´´(€€¼¼€Ä¤ƒšr'¦ã’â·ž&§’îÛšf¾òk–r£žV¯–â’îï’öW–rÃšZçš.[šnÏ¦÷¢÷žžï–.W–ºŽ¦ngš2žâ»šRû¦÷¢÷šRç¢º+–ºžj–’Ÿ–Â?Ž(€€¼¼€È¤ƒšÊK¦ã’â·švÇ¢–ÿšf¾òkš&/–.W–kšÂÓ–æÏš6Ë¦‚¾ò#–B¯ššŸ¾ò'¾ò3¦gš¢¦Vßš2'š.[šnÏ–r[ž&šfš&7’â7šr¢Š¯ž?¢š÷–f (€€¼¼€€€ƒžj–:žRš6Ë–.WšBÛ¢ÖÃš&/–.‹Ž(€½¹ÍÐÝÍ•ÍÑÕÉ•I•˜€ôÕÍ•I•˜ñì(€€€­¥¹è€™±½…Ñ¥¹œœð€•±°œð€±…å½ÕÐœì(€€€™±½…Ñ¥¹%èÍÑÉ¥¹œð¹Õ±°ì(€€€µ½‘”è€‘É…œœð€Á¥¹ œì(€€€ÍÑ…ÉÑ`è¹Õµ‰•ÈìÍÑ…ÉÑdè¹Õµ‰•ÈìÍÑ…ÉÑ¥ÍÐè¹Õµ‰•Èì(€€€€¼¨¨ƒ–§š2¦žÞkžj¢Öß–ž/¢žK–ê›¢"ž&§’îÛžVÛ’â/žj¢žK–ê›¾ò3¦ngš2š^/¢ö'žR €¨¼(€€€ÍÑ…ÉÑ¹±”è¹Õµ‰•Èì‰…Í•I½Ñ…Ñ¥½¸è¹Õµ‰•Èì(€€€€¼¨¨ƒš^/¢ö'žj’â7–.W–6¾òk¢ö'¢Ú¦;¦Zšªïš&7¦Z/–ž/¢ö'¾ò1É½Ñ	¥…Ìƒšb¿¢šš&š:'žj¦
’âšºÔ€¨¼(€€€É½Ñ=¸üè‰½½±•…¸ìÉ½Ñ	¥…Ìüè¹Õµ‰•Èì(€€€€¼¨¨ƒ’ö;¦k–ú3žj¦žê3–7ž:¢"–âÛ¦Ëšî¿žj–Bã¦f–7ž:¾òo¦ÿ–7¢£žV3¦î{–>7¢š–Bã–—¾ò?¢ÞÏ–ëŽ€¨¼(€€€±…ÍÑM…±”üè¹Õµ‰•ÈìÍ¹…ÁM…±”üè¹Õµ‰•Èì(€€€‰…Í•`è¹Õµ‰•Èì‰…Í•dè¹Õµ‰•Èì‰…Í•M…±”è¹Õµ‰•Èì(€€€€¼¨¨ƒšVÓžÖ’ö#–ÆžVÛ’â/žj¢žK–ê›¾ò#’ö#–Æžj¦ngš2š^/¢ö'žR£¾ò$€¨¼(€€€‰…Í•1…å½ÕÑI½Ðè¹Õµ‰•Èì(€€€•±±%‘àè¹Õµ‰•Èì‰…Í•=™™Í•Ñ`è¹Õµ‰•Èì‰…Í•=™™Í•Ñdè¹Õµ‰•Èì‰…Í•i½½´è¹Õµ‰•Èì(€€€‰…Í•M¡…Á•`üè¹Õµ‰•Èì‰…Í•M¡…Á•düè¹Õµ‰•Èì‰…Í•M¡…Á•i½½´üè¹Õµ‰•ÈìÍÑ…ÉÑ%¹M¡…Á”üè‰½½±•…¸ì(€ôð¹Õ±°ø¡¹Õ±°¤ì((€½¹ÍÐÁ…¹I•˜€ôÕÍ•I•˜ñì(€€€ÍÑ…ÉÑ`è¹Õµ‰•ÈìÍÑ…ÉÑMÉ½±°è¹Õµ‰•Èì(€€€±…ÍÑ`è¹Õµ‰•Èì±…ÍÑPè¹Õµ‰•ÈìØè¹Õµ‰•Èì(€ôð¹Õ±°ø¡¹Õ±°¤ì(€½¹ÍÐ¥¹•ÉÑ¥…I•˜€ôÕÍ•I•˜ñ¹Õµ‰•Èð¹Õ±°ø¡¹Õ±°¤ì((€½¹ÍÐÍÑ½Á%¹•ÉÑ¥„€ô€ ¤€ôøì(€€€¥˜€¡¥¹•ÉÑ¥…I•˜¹ÕÉÉ•¹Ð€„ôô¹Õ±°¤ì(€€€€€…¹•±¹¥µ…Ñ¥½¹É…µ”¡¥¹•ÉÑ¥…I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€¥¹•ÉÑ¥…I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€ô(€ôì((€ÕÍ•™™•Ð  ¤€ôø€ ¤€ôøÍÑ½Á%¹•ÉÑ¥„ ¤°mt¤ì((€€¼¨¨(€€€¨ƒš&/–.‹žjš¶ã–Æ³¾òh(€€€¨€€¹½¹”œ€ƒŠSŠPƒ¢¦Ë–žÒƒ¢«–ÞÇ¢fWžB¾ò#žV¯–â’â7š6Ë–.WŽ’æ’â7šB³’îï’öWšvÇ¢–ÿ¾ò$(€€€¨€€™±½…Ñ¥¹œœƒŠSŠPƒžRÇžV¯–â–Æ“žÒkš&/–.‹šB³–.WŽ3¢Š¯¦ã’â·žj¦
–ò×–r[ž&Ž4(€€€¨€€Á…¸œ€€ƒŠSŠPƒ–Æ³šZóžV¯–â¾ò3–Þ›–>Ïš6Ë¦‚(€€€¨ƒ¢š?–&–ÂÇšb¿Ž3š.[–"Ã¢Š¯¦ã’â·žjž&§’îÛ¢ê¯’â+¾òwšN7’ös–º¾ò3š.[–"—žj–rÃšZç¾òwš6Ë¦‚Ž7Ž(€€€¨¼(€€¼¨¨(€€€¨ƒ¢z‹–æW’â+¦g’â¦î{¾ò3¢B÷–r£¦g–ò×šÖ»–.W–r[ž&žj–ö‹ž.¢Ž‡¦v‹–^;¾ò|(€€€¨(€€€¨ƒ¢ö'¦;¢žK–ê›žj–žÒƒ¾ò1‰½Õ¹‘¥¹œÉ•Ðƒšb¿–ºžj–’[š:—ž~§–öˆƒŠSŠPƒ’ö¨«’â·–þ¦î{¦
šb¿–B3’â–,¨«¾ò0(€€€¨ƒš&’î—–ú{’â·–þ–ú–’[¦?Ž–7¢ö'–n{šÊKš^/¢ö'žjšZç–BG¾ò3–ÂÇ¢÷š>ožº_š"C–r[ž&¢«–ÞÇžj–êŸš¢gŽ(€€€¨¼(€½¹ÍÐ¡¥Ñ±½…Ñ¥¹M¡…Á”€ô€¡™%µœè…¹ä°àè¹Õµ‰•È°äè¹Õµ‰•È¤è‰½½±•…¸€ôøì(€€€¥˜€ …™%µœñð€…¥Í%µM¡…Á•¡™%µœ¹¥µM¡…Á”¤¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ•°€ô‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È¡m‘…Ñ„µ™±½…Ñ¥¹œµ¥ôˆ‘í™%µœ¹¥‘ô‰u€¤ì(€€€¥˜€ …•°¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÈ€ô•°¹•Ñ	½Õ¹‘¥¹±¥•¹ÑI•Ð ¤ì(€€€½¹ÍÐ­€ô­I•˜¹ÕÉÉ•¹Ðñð€Äì(€€€½¹ÍÐÍŒ€ô™%µœ¹Í…±”ñð€Äì(€€€½¹ÍÐÉ½Ð€ô€ ¡™%µœ¹É½Ñ…Ñ¥½¸ñð€À¤€¨5…Ñ ¹A$¤€¼€ÄàÀì(€€€½¹ÍÐ…à€ô€¡à€´€¡È¹à€¬È¹Ý¥‘Ñ €¼€È¤¤€¼­ì(€€€½¹ÍÐ…ä€ô€¡ä€´€¡È¹ä€¬È¹¡•¥¡Ð€¼€È¤¤€¼­ì(€€€½¹ÍÐÕà€ô€¡…à€¨5…Ñ ¹½Ì µÉ½Ð¤€´…ä€¨5…Ñ ¹Í¥¸ µÉ½Ð¤¤€¼ÍŒ€¬™%µœ¹Ý¥‘Ñ €¼€Èì(€€€½¹ÍÐÕä€ô€¡…à€¨5…Ñ ¹Í¥¸ µÉ½Ð¤€¬…ä€¨5…Ñ ¹½Ì µÉ½Ð¤¤€¼ÍŒ€¬™%µœ¹¡•¥¡Ð€¼€Èì(€€€É•ÑÕÉ¸¥ÍA½¥¹Ñ%¹%µM¡…Á”¡™%µœ¹¥µM¡…Á”°™%µœ¹Ý¥‘Ñ °™%µœ¹¡•¥¡Ð°Õà°Õä¤ì(€ôì(€€¼¨¨ƒ¦g’â’â/žj¢žãš:Ÿ¦î{–r£’â7–r£–ö‹ž.¢Ž‡¾ò!Ñ½Õ¡ÍÑ…ÉÐƒžº_––÷¾ò3šRû¦Z/šf–"“šZß¢š’â7¢š¦Ë–ö‹ž.¦ã–>[¾ò$€¨¼(€½¹ÍÐÑ…Á%¹M¡…Á•I•˜€ôÕÍ•I•˜¡™…±Í”¤ì(€€¼¨¨ƒ¦g’â’â/š2'–r£–ö‹ž.–’[¦v‹¾ò3šRûš&/šf–ššzs–>«šb¿Ž3¦î{’â’â/Ž7–ÂÇ¢š¦–ëŽ3¦ã’â·–ö‹ž.Ž4€¨¼(€½¹ÍÐÍ¡…Á•á¥ÑA•¹‘¥¹I•˜€ôÕÍ•I•˜ñÍÑÉ¥¹œð¹Õ±°ø¡¹Õ±°¤ì(€€¼¨¨(€€€¨ƒš&/š2šRû¦Z/šfžÖCžº_¦
’îÛ’ê/Ž(€€€¨¥ÍQ…Àƒ¾òtƒ–æû’æ;šÊKžžï–.WŽš.[¦;–ÂÇ’â7¦–ë¾ò#¦
’âšº×š.[šnÏšb¿–r£š2«–.W–ö‹ž.¢Ž‡žj–r[ž&¾ò'Ž(€€€¨¼(€½¹ÍÐÉ•Í½±Ù•M¡…Á•á¥Ð€ô€¡¥ÍQ…Àè‰½½±•…¸¤€ôøì(€€€½¹ÍÐÁ•¹‘¥¹œ€ôÍ¡…Á•á¥ÑA•¹‘¥¹I•˜¹ÕÉÉ•¹Ðì(€€€Í¡…Á•á¥ÑA•¹‘¥¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€¥˜€ …Á•¹‘¥¹œñð€…¥ÍQ…À¤É•ÑÕÉ¸ì(€€€¥˜€¡Í¡…Á•M•±I•˜¹ÕÉÉ•¹Ð€„ôôÁ•¹‘¥¹œ¤É•ÑÕÉ¸ì(€€€Í¡…Á•M•±I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€Í•ÑM¡…Á•M•±%¡¹Õ±°¤ì(€€€©ÕÍÑ1•™ÑM¡…Á•I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€ôì(€€¼¨¨ƒ¦g’â’â/šb¿’â7šb¿Ž3–&o–ú{¦ã’â·–ö‹ž.¦–n{¦ã’â·–r[ž&Ž7ŠSŠSšb¿žj¢¦Ç–ÂÇ’â7¢š–7–>[šÚ#¦ã–>X€¨¼(€½¹ÍÐ©ÕÍÑ1•™ÑM¡…Á•I•˜€ôÕÍ•I•˜¡™…±Í”¤ì((€½¹ÍÐ•ÍÑÕÉ•M½Á”€ô€¡Ñ…É•Ðè±•µ•¹Ðð¹Õ±°¤è€¹½¹”œð€™±½…Ñ¥¹œœð€±…å½ÕÐœð€Á…¸œ€ôøì(€€€¥˜€ …Ñ…É•Ð¤É•ÑÕÉ¸€Á…¸œì(€€€¥˜€¡Ñ…É•Ð¹±½Í•ÍÐ ‰ÕÑÑ½¸œ¤¤É•ÑÕÉ¸€¹½¹”œì(€€€¥˜€¡Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µÍÑÉ•Ñ µ¡…¹‘±•tœ¤¤É•ÑÕÉ¸€¹½¹”œì(€€€¥˜€¡Ñ…É•Ð¹±½Í•ÍÐ œ¹ÕÉÍ½Èµ¹ÝÍ”µÉ•Í¥é”œ¤ñðÑ…É•Ð¹±½Í•ÍÐ œ¹ÕÉÍ½Èµ¹•ÍÜµÉ•Í¥é”œ¤¤É•ÑÕÉ¸€¹½¹”œì((€€€½¹ÍÐ•±±°€ôÑ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ•±°µ¥‘tœ¤ì(€€€¥˜€¡•±±°€˜˜Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°(€€€€€€˜˜9Õµ‰•È¡•±±°¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ•±°µ¥œ¤¤€ôôôÍ•±•Ñ•‘%¹‘•à(€€€€€€˜˜•±±°¹±½Í•ÍÐ¡m‘…Ñ„µ±…å½ÕÐµ¥ôˆ‘íÍ•±•Ñ•‘1…å½ÕÑ%‘ô‰u€¤¤ì(€€€€€€¼¼ƒ–ÞËžÚO¢Š¯¦ã’â·žj¦
’âš‚ó¾òk–r£–º¢ê¯’â+š.[šnÏ¾òw–æÏžžïš‚ó–ŸžŸž&(€€€€€É•ÑÕÉ¸€¹½¹”œì(€€€ô(€€€¥˜€¡±…å½ÕÑM•±•Ñ•€˜˜Í•±•Ñ•‘%¹‘•à€ôôô¹Õ±°¤ì(€€€€€€¼¼ƒšVÓžÖ’ö#–Æ¢Š¯¦ã–>[¾òw–º–ÂÇšb¿ž>û–r£–R¿’â–r£šN7’ösžjž&§’îÛ¾òkžV¯–â’îï’öW–rÃšZçš.[šnÏ¦÷šb¿šB³–º¾ò0(€€€€€€¼¼ƒ–º3–£’â7š6Ë¦‚¾ò#¢šš>o¦‚¢®/–#¦î{ž¦ëžf÷¢fW–>[šÚ#¦ã–>[¾ò'Ž(€€€€€€¼¼ƒ¢B÷–r£’ö#–Æ¢«–ÞÇ¢ê¯’â+šf’ê“žÖ›–º¢«–ÞÇžj¢fWžB–f£¾ò3–Û¦’cžRÇžV¯–â–Æ“žÒkš&/–.‹’î–.{Ž(€€€€€É•ÑÕÉ¸Ñ…É•Ð¹±½Í•ÍÐ¡m‘…Ñ„µ±…å½ÕÐµ¥ôˆ‘íÍ•±•Ñ•‘1…å½ÕÑ%‘ô‰u€¤€ü€¹½¹”œ€è€±…å½ÕÐœì(€€€ô(€€€¥˜€¡Í•±•Ñ•‘±½…Ñ¥¹%¤ì(€€€€€€¼¼ƒ–r[ž&¢Š¯¦ã–>[šf–B3žB¾òkš.[žV¯–â’îï’öW–rÃšZç¦÷šb¿šB³¦g–ò×–rX(€€€€€É•ÑÕÉ¸€™±½…Ñ¥¹œœì(€€€ô(€€€É•ÑÕÉ¸€Á…¸œì(€ôì((€€¼¨¨(€€€¨ƒ¦î{’â’â/žj¦ã–>[’â–ú/¢ÖÃ¦g¢Ž‡¾òk¦ã–>[žn»š¢g–>«šr'’â–/¾ò3–Û¦’c–£¦£šâš:'Ž(€€€¨ƒ¾ò#’æ/–&7–r[ž&¢«–ÞÇ’æšr¦ã–>[¾ò3–§¦
+šBÛ¢F_¢¢´ÍÑ…Ñ—¾ò3–Ûž"ûšr–ëž>û’â+’â–ò×žj–rOžBšÊKšÚ#–’ÇŽ¾ò$(€€€¨¼(€€¼¨¨(€€€¨ƒž²³’âš²‡š*+žfó–'š&O¦Z/šfžj¦‚C¢¢·¦†?¢&ËŽ(€€€¨ƒšZ–¶_¾ò#–B¯ž²›¢f¾ò'’â–ú/žR£žÒSžfôƒŠSŠPƒžf÷–'–r£’îï’öW–êW¢&Ë’â+¦÷––÷žr/¾ò0(€€€¨ƒ’æ’â7šr–nƒž
ë–¶_šr³¢ê¯šb¿šÞÇ¢&Ë¢3žr/¢Öß’úŽ3šÊK¦Z/Ž7Ž(€€€¨ƒ–r[–ö‹’î7žÛšÊÿžR£–r[–ö‹¢«–ÞÇžj¦†?¢&Ë¾ò#¦
’âž¢»šr³’ú–ÂÇšb¿¢š–B3¢&Ëžj–'šj#¾ò'Ž(€€€¨ƒ’â–/–r[–Æ“–>«–k¦g’âš²‡¾ò!±½Ý%¹¥Ó¾ò'¾ò3’æ/–ú3š&/–.Wš2G¦;žj¦†?¢&Ë’â7šr–7¢Š¯¢N/š:'Ž(€€€¨ƒ–r[ž&’â7žº_–r£–œƒŠSŠPƒ–ºžjžfó–'šb¿–>›’âžÖ–>šVã¾ò!¥µ±½ß¾ò'Ž(€€€¨¼(€½¹ÍÐÝ¥Ñ¡±½Ý%¹¥Ð€ô€¡±…å•Èè±½…Ñ¥¹%µ…”°Á…Ñ èA…ÉÑ¥…°ñ±½…Ñ¥¹%µ…”ø¤èA…ÉÑ¥…°ñ±½…Ñ¥¹%µ…”ø€ôøì(€€€¥˜€¡±…å•È¹±½Ý%¹¥Ð¤É•ÑÕÉ¸Á…Ñ ì(€€€¥˜€¡±…å•È¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•€˜˜€¡Á…Ñ …Ì…¹ä¤¹±½Ü€„ôôÕ¹‘•™¥¹•€˜˜€ ¡Á…Ñ …Ì…¹ä¤¹±½Üñð€À¤€ø€À¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹Á…Ñ °±½Ý½±½Èè€œœ°±½Ý%¹¥ÐèÑÉÕ”ô…Ì…¹äì(€€€ô(€€€¥˜€¡±…å•È¹Í¡…Á”€˜˜€¡Á…Ñ …Ì…¹ä¤¹Í¡…Á•±½Ü¤ì(€€€€€É•ÑÕÉ¸ì€¸¸¹Á…Ñ °Í¡…Á•±½Ý½±½Èè±…å•È¹½±½ÈñðM!A}U1Q}=1=H°±½Ý%¹¥ÐèÑÉÕ”ô…Ì…¹äì(€€€ô(€€€É•ÑÕÉ¸Á…Ñ ì(€ôì((€½¹ÍÐ…ÁÁ±åQ…ÁM•±•Ñ¥½¸€ô€¡Ñ…É•Ðè±•µ•¹Ð¤€ôøì(€€€½¹ÍÐ‰ÉÕÍ¡°€ôÑ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ‰ÉÕÍ µ¥‘tœ¤ì(€€€¥˜€¡‰ÉÕÍ¡°¤ì(€€€€€½¹ÍÐ¥€ô‰ÉÕÍ¡°¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ‰ÉÕÍ µ¥œ¤ì(€€€€€¥˜€¡¥¤ì(€€€€€€€Í•ÑM•±•Ñ•‘	ÉÕÍ¡%¡¥¤ì(€€€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ìÍ•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ìÍ•ÑM•±•Ñ•‘1…å½ÕÑ%¡¹Õ±°¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐ™°€ôÑ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ™±½…Ñ¥¹œµ¥‘tœ¤ì(€€€¥˜€¡™°¤ì(€€€€€½¹ÍÐ¥€ô™°¹•ÑÑÑÉ¥‰ÕÑ” ‘…Ñ„µ™±½…Ñ¥¹œµ¥œ¤ì(€€€€€¥˜€¡¥¤ì(€€€€€€€€¼¼ƒ–ÞËžÚO¦ã–>[žjšZ–¶_–r[–Æ“–7¦î{’âš²‡¾òwžnÓš:—–r£žV¯–â’â+š&O–¶_¾ò#’â7šr¢«–ÞÇ¢ÞÏ–"ÃžÞ£¢ò¿¦‚¾ò$(€€€€€€€€¼¨ƒ–>«šr'’â¢"³šZ–¶_–>¿’î—¦î{¦Ë–:ïšRç–¶_¾òož²›¢fžj–Ÿ–ºçšb¿–në–ºkžj¾ò0(€€€€€€€€€€ƒ–7¦î{’âš²‡’â7¦Ë–—žÞ£¢ò¿¾ò#š&’î—’æ’â7šršr'–&«’â/¾ò?¢’¢Ž÷¾ò?¢Êó’â+¾ò'Ž€¨¼(€€€€€€€½¹ÍÐ™°€ô™±½…Ñ¥¹%µ…•Ì¹™¥¹¡˜€ôø˜¹¥€ôôô¥¤ì(€€€€€€€€¼¨ƒ–ÞËžÚO¦ã’â·žj–r[ž&Ž¢3’âS¦g’â’â/¦î{–r£–ö‹ž.¢Ž‡¦vˆƒŠHƒ¦Ë–"ÃŽ3¦ã’â·–ö‹ž.Ž4€¨¼(€€€€€€€¥˜€¡¥€ôôôÍ•±•Ñ•‘±½…Ñ¥¹%€˜˜¥Í%µM¡…Á• ¡™°…Ì…¹ä¤ü¹¥µM¡…Á”¤€˜˜Ñ…Á%¹M¡…Á•I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€Í•ÑM¡…Á•M•±%¡¥¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€¥˜€¡¥€ôôôÍ•±•Ñ•‘±½…Ñ¥¹%€˜˜™°ü¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•€˜˜€…™°ü¹Íå´¤ì(€€€€€€€€€Í•Ñ‘¥Ñ¥¹Q•áÑ%¡¥¤ì(€€€€€€€€€Í•Ñ%¹±¥¹•‘¥Ñ%¡¥¤ì(€€€€€€€ô•±Í”¥˜€¡¥€„ôô¥¹±¥¹•‘¥Ñ%¤ì(€€€€€€€€€Í•Ñ%¹±¥¹•‘¥Ñ%¡¹Õ±°¤ì(€€€€€€€ô(€€€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¥¤ì(€€€€€€€Í•ÑM•±•Ñ•‘	ÉÕÍ¡%¡¹Õ±°¤ì(€€€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€Í•ÑM•±•Ñ•‘1…å½ÕÑ%¡¹Õ±°¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€Í•Ñ%¹±¥¹•‘¥Ñ%¡¹Õ±°¤ì(€€€€¼¨ƒ¦g’â’â/š&7–&o–ú{Ž3¦ã’â·–ö‹ž.Ž7¦–n{Ž3¦ã’â·–r[ž&Ž7¾òk–s–r£¦g’â–Æ“¾ò3’â7¢š–7–ú’â/š:'Ž€¨¼(€€€¥˜€¡©ÕÍÑ1•™ÑM¡…Á•I•˜¹ÕÉÉ•¹Ð¤ì©ÕÍÑ1•™ÑM¡…Á•I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ìÉ•ÑÕÉ¸ìô(€€€¥˜€¡Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ•±°µ¥‘tœ¤¤ì(€€€€€€¼¼ƒš‚ó–¶C¾ò?’ö#–Æžj–§šº×–ò?¦ã–>[žRÄ¡…¹‘±••±±Q½Õ¡¹ƒ¢Êƒ¢Ê³¾ò3¦g¢Ž‡–>«šâš:'–r[ž&(€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€Í•ÑM•±•Ñ•‘1…å½ÕÑ%¡¹Õ±°¤ì(€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ì(€€€Í•ÑM•±•Ñ•‘	ÉÕÍ¡%¡¹Õ±°¤ì(€ôì((€½¹ÍÐ¡…¹‘±•]½É­ÍÁ…•Q½Õ¡MÑ…ÉÐ€ô€¡”èI•…Ð¹Q½Õ¡Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø¤€ôøì(€€€ÍÑ½Á%¹•ÉÑ¥„ ¤ì(€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€¼¨ƒž²³’ê3š‚çš&/š2–>¿¢÷¢B÷–r£–:–nûž&–’[¦v‹¾ò3–nƒš¶“–>«–r£–nûž&¢«–ÞÇžjÑ½Õ¡ÍÑ…ÉÐƒ–>[šÚ#’â7–’Ž(€€€€€€ƒ–r£šVÓ’â«¦Š¢ž#–Æžî’âš"«¢:ß¾òk–>«¢šš"C’âë–>3š2š&/–*ÿ¾ò3’îï’öW–Âkšr«š"Cž®/š"[–ÞËžî?–ëž:Ãžj(€€€€€€ƒ¦Vÿš2'’ê“š6‹žò§–nû¦÷ž®/–"ïšJ“¦R¾ò3–7š*+š&/–*ÿ–º3šVÓ’ê“žîgžò§šRûŽ€¨¼(€€€¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€È¤ì(€€€€€¥˜€¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€±•…ÉQ¥µ•½ÕÐ¡±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€±½¹AÉ•ÍÍQ¥µ•½ÕÑI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€ô(€€€€€¥˜€¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€±•…ÉQ¥µ•½ÕÐ¡™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€™±½…ÑMÝ…ÁQ¥µ•ÉI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€ô(€€€€€½¹ÍÐ¡…‘•±±MÝ…À€ô¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ðñð€„…Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ðì(€€€€€½¹ÍÐ¡…‘±½…ÑMÝ…À€ô€„…™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ðì(€€€€€¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€Ñ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€Á•¹‘¥¹1½¹AÉ•ÍÍA½ÍI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€¥˜€¡¡…‘•±±MÝ…À¤ì(€€€€€€€Í•ÑQ½Õ¡É…•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€Í•ÑQ½Õ¡É…=Ù•É%¹‘•à¡¹Õ±°¤ì(€€€€€ô(€€€€€¥˜€¡¡…‘±½…ÑMÝ…À¤Í•Ñ±½…ÑÉ…MÉŒ¡¹Õ±°¤ì(€€€€€¥˜€¡¡…‘•±±MÝ…Àñð¡…‘±½…ÑMÝ…À¤Í•ÑMÝ…Á=Ù•ÉQ…É•Ð¡¹Õ±°¤ì(€€€ô(€€€¥˜€¡¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹ÐñðÑ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì((€€€€¼¨ƒ–#žº_Ž3¦g’â’â/šb¿’â7šb¿š2'–r£¦ã’â·¦
–ò×–r[žj–ö‹ž.¢Ž‡¦v‹Ž7ŠSŠP(€€€€€€ƒ¦Ë–ëŽ3¦ã’â·–ö‹ž.Ž7¦÷¦vƒ–º¾ò3š&’î—¢š–r •ÍÑÕÉ•M½Á”ƒ–"“šZß’æ/–&7–ÂÇžº_––÷Ž€¨¼(€€€¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €ôôô€Ä¤ì(€€€€€½¹ÍÐÍ•±%µœ€ôÍ•±•Ñ•‘±½…Ñ¥¹%€ü™±½…Ñ¥¹%µ…•Ì¹™¥¹¡˜€ôø˜¹¥€ôôôÍ•±•Ñ•‘±½…Ñ¥¹%¤€è¹Õ±°ì(€€€€€Ñ…Á%¹M¡…Á•I•˜¹ÕÉÉ•¹Ð€ô¡¥Ñ±½…Ñ¥¹M¡…Á”¡Í•±%µœ°”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`°”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd¤ì(€€€€€€¼¨ƒ¦î{–"Ã–ö‹ž.–’[¦vˆƒŠHƒ¦–n{Ž3–>«¦ã’â·–r[ž&Ž7Ž(€€€€€€€€ƒ¦g’â’â/–>«¦’â–Æ“¾ò3’â7¢÷¦‚š&/š*+–r[ž&’æ–>[šÚ#¦ã–>[¾ò3š&’î—¢¢c’â–/š^_š¢gžÖ˜(€€€€€€€€…ÁÁ±åQ…ÁM•±•Ñ¥½¸ƒžr/¾ò#šRû¦Z/šf–ºš&7’â7šrš*(Í•±•Ñ•‘±½…Ñ¥¹%ƒšâš:'¾ò'Ž€¨¼(€€€€€©ÕÍÑ1•™ÑM¡…Á•I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€Í¡…Á•M•±U¹‘½I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€¥˜€¡Í¡…Á•M•±I•˜¹ÕÉÉ•¹Ð€˜˜€…Ñ…Á%¹M¡…Á•I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€¼¨ƒš2'–r£–ö‹ž.–’[¦v‹Ž(€€€€€€€€€€ƒ’î—–&7¦g¢Ž‡–ÂÇžnÓš:—¦–ëŽ3¦ã’â·–ö‹ž.Ž7’êƒŠSŠPƒšZóšb¿Ž3–ú{–ö‹ž.–’[¦v‹š.[Ž7šÂã¦ƒ¢º+š"@(€€€€€€€€€€ƒšB³–.WšVÓ–/–r[–Æ“¾ò3¢3’â7šb¿š2«–.W–r[ž&–r£–ö‹ž.¢Ž‡žj’ö7žö»Ž(€€€€€€€€€€ƒž>û–r£šRçš"C–#¢¢c¢F_¾ò3šRû¦Z/š&/žjšf–g–7žr/¾òh(€€€€€€€€€€€€ƒŠœƒ–>«šb¿¦î{’â’â/¾ò#–æû’æ;šÊKžžï–.W¾ò'ŠHƒš&7žržj¦–ë–:ï¾ò#¢†3ž
ë¢Þ’î—–&7’âš¢¾ò$(€€€€€€€€€€€€ƒŠœƒš.[’ê’âšºÔ€€€€€€€€€€€ƒŠHƒ’â7¦–ë¾ò3šVÓšº×š.[šnÏ¦÷šb¿–r£š2«–.W–ö‹ž.¢Ž‡žj–r[ž&€¨¼(€€€€€€€Í¡…Á•á¥ÑA•¹‘¥¹I•˜¹ÕÉÉ•¹Ð€ôÍ¡…Á•M•±I•˜¹ÕÉÉ•¹Ðì(€€€€€ô(€€€ô((€€€½¹ÍÐÍ½Á”€ô•ÍÑÕÉ•M½Á”¡”¹Ñ…É•Ð…Ì±•µ•¹Ð¤ì(€€€¥˜€¡Í½Á”€ôôô€¹½¹”œ¤É•ÑÕÉ¸ì(€€€½¹ÍÐ•ÍÑÕÉ•±½…Ñ¥¹%€ôÍ•±•Ñ•‘±½…Ñ¥¹%ì((€€€€¼¼ƒ¦ngš2žâ»šRû’â7šr¢Þš6Ë¦‚¢†wžª¾ò3š&’î—’â7žº‡š&/š2¢B÷–r£–N«¢Ž‡¦÷š.ÿ’úžâ»šRû¦ã’â·žjž&§’îØ(€€€½¹ÍÐÑÝ½¥¹•É=¹M•±•Ñ¥½¸€ô”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€È€˜˜€¡Í•±•Ñ•‘±½…Ñ¥¹%ñðÍ•±•Ñ•‘%¹‘•à€„ôô¹Õ±°ñð±…å½ÕÑM•±•Ñ•¤ì(€€€½¹ÍÐ­¥¹è€™±½…Ñ¥¹œœð€•±°œð€±…å½ÕÐœð¹Õ±°€ô(€€€€€Í½Á”€ôôô€™±½…Ñ¥¹œœ€ü€™±½…Ñ¥¹œœ(€€€€€€èÍ½Á”€ôôô€±…å½ÕÐœ€ü€±…å½ÕÐœ(€€€€€€èÑÝ½¥¹•É=¹M•±•Ñ¥½¸€ü€¡Í•±•Ñ•‘±½…Ñ¥¹%€ü€™±½…Ñ¥¹œœ€èÍ•±•Ñ•‘%¹‘•à€„ôô¹Õ±°€ü€•±°œ€è€±…å½ÕÐœ¤(€€€€€€è¹Õ±°ì(€€€¥˜€¡­¥¹¤ì(€€€€€½¹ÍÐÑÝ½¥¹•È€ô”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€Èì(€€€€€€¼¨ƒž²³’âš‚çš&/š2¢B÷–r£–ö‹ž.–’[¦v‹šf¾ò3’â+¦v‹¦
’âšº×–ÞËžÚOš*+Ž3¦ã’â·–ö‹ž.Ž7¦š:'’êƒŠSŠP(€€€€€€€€ƒ’öž²³’ê3š‚çš&/š2¢Þ’â+–ÂÇ’î¢†£¦g–Û–¾›šb¿’â–/žâ»šRûš&/–.‹¾ò3’â7šb¿Ž3¦î{–’[¦v‹¦–ë–:ïŽ7Ž(€€€€€€€€ƒ–ú§–:’æ/–ú3¾ò3–r£–r[ž&–’[¦v‹š6?’æšb¿–r£¢ªÿŽ3–ö‹ž.¢Ž‡¦v‹¦
–ò×–r[Ž7žj–’Ÿ–Â?Ž€¨¼(€€€€€¥˜€¡ÑÝ½¥¹•È€˜˜€…Í¡…Á•M•±I•˜¹ÕÉÉ•¹Ð€˜˜Í¡…Á•M•±U¹‘½I•˜¹ÕÉÉ•¹Ð(€€€€€€€€˜˜Í¡…Á•M•±U¹‘½I•˜¹ÕÉÉ•¹Ð€ôôô•ÍÑÕÉ•±½…Ñ¥¹%¤ì(€€€€€€€Í¡…Á•M•±I•˜¹ÕÉÉ•¹Ð€ôÍ¡…Á•M•±U¹‘½I•˜¹ÕÉÉ•¹Ðì(€€€€€€€Í•ÑM¡…Á•M•±%¡Í¡…Á•M•±U¹‘½I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€©ÕÍÑ1•™ÑM¡…Á•I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€ô(€€€€€¥˜€¡ÑÝ½¥¹•È¤Í¡…Á•M•±U¹‘½I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€½¹ÍÐ‘¥ÍÐ€ôÑÝ½¥¹•È(€€€€€€€€ü5…Ñ ¹¡åÁ½Ð (€€€€€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`°(€€€€€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd(€€€€€€€€€€¤ñð€Ä(€€€€€€€€è€Äì(€€€€€½¹ÍÐà€ôÑÝ½¥¹•È€ü€¡”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€¬”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`¤€¼€È€è”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`ì(€€€€€½¹ÍÐä€ôÑÝ½¥¹•È€ü€¡”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€¬”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd¤€¼€È€è”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñdì(€€€€€½¹ÍÐ…¹œ€ôÑÝ½¥¹•È(€€€€€€€€ü5…Ñ ¹…Ñ…¸È (€€€€€€€€€€€”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd°(€€€€€€€€€€€”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`(€€€€€€€€€€¤€¨€ÄàÀ€¼5…Ñ ¹A$(€€€€€€€€è€Àì((€€€€€½¹ÍÐ™%µœ€ô­¥¹€ôôô€™±½…Ñ¥¹œœ€ü™±½…Ñ¥¹%µ…•Ì¹™¥¹¡¥µœ€ôø¥µœ¹¥€ôôô•ÍÑÕÉ•±½…Ñ¥¹%¤€èÕ¹‘•™¥¹•ì(€€€€€¥˜€¡­¥¹€ôôô€™±½…Ñ¥¹œœ€˜˜€…™%µœ¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ•±°€ô­¥¹€ôôô€•±°œ€˜˜Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°€ü¥µ…•ÍmÍ•±•Ñ•‘%¹‘•át€èÕ¹‘•™¥¹•ì(€€€€€¥˜€¡­¥¹€ôôô€•±°œ€˜˜€…•±°ü¹ÕÉ°¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ±Ð€ô…Ñ¥Ù•1…å½ÕÐü¹Ðñðìàè€À°äè€À°Í…±”è€Äôì((€€€€€€¼¼ƒ¦ngš2šN7’ösšf–#š*+–r[–Æ“–Þ—–ß–"_šRÛ¢Öß’ú¾ò3šRû¦Z/š&7’úwš^/¢ö'–ú3žjšZç–BG¦7šZÃšNè(€€€€€Í•ÑA¥¹¡±½…Ñ¥¹%¡­¥¹€ôôô€™±½…Ñ¥¹œœ€˜˜ÑÝ½¥¹•È€ü•ÍÑÕÉ•±½…Ñ¥¹%€è¹Õ±°¤ì(€€€€€ÝÍ•ÍÑÕÉ•1…å½ÕÑ%‘I•˜¹ÕÉÉ•¹Ð€ôÍ•±•Ñ•‘1…å½ÕÑ%ì(€€€€€ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ôì(€€€€€€€­¥¹°(€€€€€€€™±½…Ñ¥¹%è•ÍÑÕÉ•±½…Ñ¥¹%°(€€€€€€€µ½‘”èÑÝ½¥¹•È€ü€Á¥¹ œ€è€‘É…œœ°(€€€€€€€ÍÑ…ÉÑ`èà°ÍÑ…ÉÑdèä°ÍÑ…ÉÑ¥ÍÐè‘¥ÍÐ°(€€€€€€€ÍÑ…ÉÑ¹±”è…¹œ°(€€€€€€€‰…Í•I½Ñ…Ñ¥½¸è™%µœü¹É½Ñ…Ñ¥½¸€üü€À°(€€€€€€€É½Ñ=¸è™…±Í”°É½Ñ	¥…Ìè€À°€€€¼¼ƒš^/¢ö'žj’â7–.W–6¾òk¢Ú¦;¦Zšªïš&7¦Z/–ž/¢ö$(€€€€€€€‰…Í•`è­¥¹€ôôô€™±½…Ñ¥¹œœ€ü€¡™%µœü¹à€üü€À¤€è±Ð¹à°(€€€€€€€‰…Í•dè­¥¹€ôôô€™±½…Ñ¥¹œœ€ü€¡™%µœü¹ä€üü€À¤€è±Ð¹ä°(€€€€€€€‰…Í•M…±”è­¥¹€ôôô€™±½…Ñ¥¹œœ€ü€¡™%µœü¹Í…±”€üü€Ä¤€è±Ð¹Í…±”°(€€€€€€€±…ÍÑM…±”è­¥¹€ôôô€™±½…Ñ¥¹œœ€ü€¡™%µœü¹Í…±”€üü€Ä¤€è±Ð¹Í…±”°(€€€€€€€‰…Í•1…å½ÕÑI½Ðè±Ð¹É½Ðñð€À°(€€€€€€€•±±%‘àèÍ•±•Ñ•‘%¹‘•à€üü€´Ä°(€€€€€€€‰…Í•=™™Í•Ñ`è•±°ü¹½™™Í•Ñ`€üü€À°(€€€€€€€‰…Í•=™™Í•Ñdè•±°ü¹½™™Í•Ñd€üü€À°(€€€€€€€‰…Í•i½½´è•±°ü¹é½½´€üü€Ä°(€€€€€€€€¼¼ƒŽ3–ö‹ž.Ž7¦
’â¦‚¦Z/¢F_šfš.[šnÏš2«žjšb¿–r[ž&–r£–ö‹ž.¢Ž‡žj’ö7žö»¾ò#¢š,¡…¹‘±•]½É­ÍÁ…•Q½Õ¡5½Ù—¾ò$(€€€€€€€‰…Í•M¡…Á•`è€¡™%µœ…Ì…¹ä¤ü¹¥µM¡…Á•`€üü€À°(€€€€€€€‰…Í•M¡…Á•dè€¡™%µœ…Ì…¹ä¤ü¹¥µM¡…Á•d€üü€À°(€€€€€€€‰…Í•M¡…Á•i½½´è±…µÁ%µi½½´ ¡™%µœ…Ì…¹ä¤ü¹¥µM¡…Á•i½½´¤°(€€€€€€€€¼¨ƒš&/š2šb¿’â7šb¿–ú{Ž3–r[š†#¢Ž‡¦v‹Ž7š2'’â/–:ïžjŽ–ú{–ö‹ž.–’[¦v‹¾ò#šo–þš^¦
+¦
–†+ž¦ëžf÷¾ò$(€€€€€€€€€€ƒš2'’â/–:ï¢šžŸ¢"+šB³–.WšVÓ–/ž&§’îÛ¾ò3š&’î—–r£¦g¢Ž‡–#žº_––÷ŽšVÓšº×š.[šnÏ¦÷žR£–B3’â–/ž¶Sš†#Ž€¨¼(€€€€€€€ÍÑ…ÉÑ%¹M¡…Á”è­¥¹€ôôô€™±½…Ñ¥¹œœ€ü¡¥Ñ±½…Ñ¥¹M¡…Á”¡™%µœ°à°ä¤€è™…±Í”°(€€€€€ôì(€€€€€€¼¼ƒž&§’îÛ¦ngš2žâ»šRûšr¦ZO’æšj¯šfš*+šVÓ¦‚¦:[š"C–B3’â–/–B#š"C–Æ“Ž¦‚¦v‹¢.—’î7’öÿžR ML(€€€€€€¼¼é½½·¾ò3ž&§’îÛ–Âë–¾ãš¾?–æšRç¢º+šf–ÛšZ–¶_¾ò=MYƒ¢"¦ã–>[–æû’öWšr–B¢«–k–Â?šVã–>[šVÓ¾ò0(€€€€€€¼¼ƒ–6Ï’öÿ¢ÎšZgšr³¢ê¯–ú#–æÏšîG¾ò3žV¯¦v‹’â+’î7šr–Þ›–>Ïš*[’â–/–?žÒƒŽ(€€€€€¥˜€¡ÑÝ½¥¹•È¤…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡­I•˜¹ÕÉÉ•¹Ð°ÑÉÕ”¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€€¼¨€´´´ƒ¦ngš2žâ»šRûšVÓ–/¦‚C¢šô€´´´(€€€€€€ƒšŠw’îÛ–ú#–jÓš‚ó¾ò3–nƒž
ë¦g–/š&/–.‹žÖW–Â7’â7¢÷¢Þ–"—žj–.W’ösš&OšzÛ¾òh(€€€€€€€€ƒ
Üƒ’â–ºk¢š–§š‚çš&/š2¾ò#–Z»š2šÂã¦ƒšb¿–Þ›–>Ïš6Ë¦‚¾ò3’â7–>_–öÇ¦~ÿ¾ò$(€€€€€€€€ƒ
Üƒ’î¦êó¦÷šÊK¦ã’â·¾ò#¦ã’â·švÇ¢–ÿšf–§š2šb¿žâ»šRû¦
–/ž&§’îÛ¾ò3’â+¦v‹–ÞËžÚOš:—¢ÖÃ’ê¾ò$(€€€€€€€€ƒ
Üƒ’â7–r£š:K¦‚¦v‹š¢‡–ò?¾ò#¦
–/š¢‡–ò?šr'¢«–ÞÇžj–7ž:¾ò$(€€€€€€€€ƒ
Üƒš&/š2šÊKšr'¢B÷–r£š2'¦"Wš"[¢žKžB’â+¾ò!•ÍÑÕÉ•M½Á”ƒš^§–ÂÇ–nx€¹½¹”œƒšN/š:'’ê¾ò$(€€€€€€ƒ¦Z/–ž/’æ/–&7–#š*+š6Ë¦‚ž.š/šâ’æûšÞ£¾òkž²³’ê3š‚çš&/š2¢B÷’â/šf¡…¹‘±•]½É­ÍÁ…•Q½Õ¡MÑ…ÉÐ(€€€€€€ƒšr¦7¢ÞG’âš²‡¾ò3¦Z/¦‚·–ÞËžÚLÁ…¹I•˜€ô¹Õ±³¾ò3š&’î—’â7–>¿¢÷–B3šf–r£š6Ë¦‚Ž€¨¼(€€€¥˜€ (€€€€€”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€È€˜˜€…Á…•Í5½‘”(€€€€€€˜˜€…Í•±•Ñ•‘±½…Ñ¥¹%€˜˜Í•±•Ñ•‘%¹‘•à€ôôô¹Õ±°€˜˜€…±…å½ÕÑM•±•Ñ•(€€€€€€¼¼ƒ¦‚¦v‹–ÞËžÚO¢Š¯š.[–"Ã’â–6+’ê–ÂÇ’â7š:—š&,ƒŠSŠPƒ¦g’âš²‡š&/–.‹–ú{¦‚·–"Ã–Âû¦÷šb¿š6Ë¦‚(€€€€€€˜˜€…Á…¹5½Ù•‘I•˜¹ÕÉÉ•¹Ð(€€€€¤ì(€€€€€½¹ÍÐ½¹Ð€ô½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€€€½¹ÍÐÜ€ô½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ ì(€€€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€½¹ÍÐ€ô5…Ñ ¹¡åÁ½Ð (€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`°(€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd°(€€€€€€¤ñð€Äì(€€€€€€¼¨ƒ–:–rÃšRû–’Ÿ¾òk¦2£¦î{–në–ºkžR£Ž3¦‚C¢š÷žV¯¦v‹žjš¶’â·–’»Ž7¾ò3’â7šb¿–§š2žj’â·¦îxƒŠSŠP(€€€€€€€€ƒš&/š2¢B÷–r£–N«¢Ž‡¦÷’âš¢¾ò3žV¯¦v‹’â·–’»¦
–/švÇ¢–ÿ–ÂÇ–ú–r£’â·–’»’â7–.WŽ(€€€€€€€€ƒ¢¢c’â/š¶’â·–’»š¶“–"ï–Â7–"Ãžj¦
–/–Ÿ–ºç–êŸš¢g¾ò#šr«žâ»šRû–Z»’ö7¾ò'¾ò3šVÓšº×š&/–.‹¦÷š*+–º(€€€€€€€€ƒšNë–n{š¶’â·–’»Ž(€€€€€€€€ƒ¾ò#’î—–&7¢¢cžjšb¿Ž3¦n‹’â·–þšr¢þGžj¦
’â¦‚Ž7–7š*+¦
’â¦‚šNë–"Ãš¶’â·¦ZLƒŠSŠPƒ–>«¢š(€€€€€€€€ƒ’â·–þ’â7–r£š~C¦‚š¶’â·–’»¾ò3š&/š2’âžŠÃ’â/–:ïž²³’â–âŸ–ÂÇšr¢Š¯š.'¦;–:ïŽ¾ò$€¨¼(€€€€€½¹ÍÐ¬À€ô­I•˜¹ÕÉÉ•¹Ðñð€Äì(€€€€€½¹ÍÐ…¹¡½ÉAà€ôÜ€¼€Èì(€€€€€±•Ð…¹¡½É€ô€Àì(€€€€€¥˜€¡½¹Ð€˜˜Ü€ø€À¤ì(€€€€€€€…¹¡½É€ô€¡½¹Ð¹ÍÉ½±±1•™Ð€¬…¹¡½ÉAà€´ÍÑÉ¥Á=™™Í•Ð¡Ü°¬À¤(€€€€€€€€€€´ÍÑÉ¥ÁMÕ‰Á¥á•±aI•˜¹ÕÉÉ•¹Ð€¨¬À¤€¼¬Àì(€€€€€ô(€€€€€€¼¨ƒ–~ëšê[–7ž:–>[Ž3ž>û–r£žV¯¦v‹’â+žrš¶––_žR£žjŽ7¦
–/¾ò!­I•›¾ò'¾ò3’â7šb¼ÍÑ…Ñ”ƒŠSŠP(€€€€€€€€ƒ¦žê3š6?–§š²‡šf¾ò3ž²³’ê3š²‡’â–ºk¢š–ú{ž²³’âš²‡žjžÖCšzsš:—¢F_žº_Ž€¨¼(€€€€€…¹Ù…Íi½½µI•˜¹ÕÉÉ•¹Ð€ôìÍÑ…ÉÑ¥ÍÐè°‰…Í•i½½´è¬À°…¹¡½É°…¹¡½ÉAà°±…ÍÑi½½´è¬Àôì(€€€€€…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡¬À°ÑÉÕ”¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€€¼¼ƒšÊKšr'š:—žº‡ž&§’îÛš&/–.ˆƒŠHƒšê[–
gš&/–.Wš6Ë¦‚Ž(€€€€¼¼ƒ¾ò#š&/–.‹šÊKšr'¢B÷–r£Ž3–ÞË¦ã’â·žj¦
–/ž&§’îÛŽ7¢ê¯’â+šf–ÂÇ–Æ³šZóžV¯–â¾ò3–>¿’î—–Þ›–>ÏšîG–.WŽ¾ò$(€€€½¹ÍÐ•°€ô½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …•°ñð”¹Ñ½Õ¡•Ì¹±•¹Ñ €„ôô€Ä¤É•ÑÕÉ¸ì(€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ôì(€€€€€ÍÑ…ÉÑ`è”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`°(€€€€€ÍÑ…ÉÑMÉ½±°è•°¹ÍÉ½±±1•™Ð°(€€€€€±…ÍÑ`è”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`°(€€€€€±…ÍÑPèÁ•É™½Éµ…¹”¹¹½Ü ¤°(€€€€€Øè€À°(€€€ôì(€ôì((€½¹ÍÐ¡…¹‘±•]½É­ÍÁ…•Q½Õ¡5½Ù”€ô€¡”èI•…Ð¹Q½Õ¡Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø¤€ôøì(€€€€¼¼ƒ¦Vßš2'š.[šnÏ–r[ž&šf¾ò3’îï’öWš6Ë¦‚€¼ƒž&§’îÛ’ö7žžï¦÷’â7¢¦ËžfóžR|(€€€¥˜€¡¥Í1½¹AÉ•ÍÍ•‘I•˜¹ÕÉÉ•¹ÐñðÑ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ðñð™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ðü¹‘É…¥¹œ¤ì(€€€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€€¼¨ƒžV¯–âžâ»šRûšRû–r£šr–&7¦v‹¾òk–º–r£¢ÞGžjšf–g¾ò3š6Ë¦‚¢"ž&§’îÛš&/–.‹’â–ú/’â7¢fWžB€¨¼(€€€½¹ÍÐè€ô…¹Ù…Íi½½µI•˜¹ÕÉÉ•¹Ðì(€€€¥˜€¡è¤ì(€€€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€¼¨ƒšRû¦Z/’îï’öW’âš‚çš&/š2–ÂÇžÖCšv¦gš²‡žâ»šRû’â›š>C’êƒŠSŠPƒžVg¢F_ž¶$Ñ½Õ¡•¹ƒžj¢¦Ç¾ò0(€€€€€€€€ƒ–&§’â/¦
š‚çš&/š2š:—¢F_šîGšr¢º+š"CŽ3’â¦
+žâ»šRû’â¦
+š6Ë¦‚Ž7¾ò3š¶šb¿¢š¦ÿ–7žjššÎŽ€¨¼(€€€€€¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €ð€È¤ì(€€€€€€€€¼¨ƒž²³’âš‚çš&/š2–#¦n‹¦Z/šf–#žÚ·š2šr–ú3’â–æ¾ò3’â7¢šš>Cš^§š>C’êÍÑ…Ñ—Ž(€€€€€€€€€€¥=Lƒšr–r£Ž3¦
šr'’âš‚çš&/š2š2'¢F_Ž7šf¦7žº\ÍÉ½±±1•™Ó¾ò3¦ƒš"C¦²š&/žz³¦ZO¢ÞG’ö7¾òl(€€€€€€€€€€ƒž¶'–§š‚ç¦÷¦n‹¦Z/–ú3žRÄÑ½Õ¡•¹ƒ’âš²‡–º3š"CšRÛ–ÂûŽ€¨¼(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€½¹ÍÐ€ô5…Ñ ¹¡åÁ½Ð (€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`°(€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd°(€€€€€€¤ñð€Äì(€€€€€½¹ÍÐÉ…Ýh€ô5…Ñ ¹µ…à¡i==5}5%8°5…Ñ ¹µ¥¸¡i==5}5`°è¹‰…Í•i½½´€¨€¡€¼è¹ÍÑ…ÉÑ¥ÍÐ¤¤¤ì(€€€€€€¼¼ƒ¢žãš:Ÿ¢Þw¦n‹šr–r£žnã¦Ã’ê/’îÛ¦ZOš*[–.W¦nÛ¦î{–æû–/–?žÒƒ¾òožnÓš:—š*+š¾?’âž¶–f«¢Ë–¾¯–”é½½´(€€€€€€¼¼ƒšr¢ºOšVÓ–ò×¦‚C¢š÷–>7¢ššRû–’Ÿžâ»–Â?Ž¢òW¦?’ö;¦k–>«šþûš:'¦gž¢»¦®c¦‚ïš*[–.W¾ò3š&/–.‹šZç–BG¢"ž¾–r7’â7¢º+Ž(€€€€€½¹ÍÐè€ô5…Ñ ¹…‰Ì¡É…Ýh€´è¹±…ÍÑi½½´¤€ð€À¸ÀÀÄ(€€€€€€€€üè¹±…ÍÑi½½´(€€€€€€€€èè¹±…ÍÑi½½´€¬€¡É…Ýh€´è¹±…ÍÑi½½´¤€¨€À¸ÜÈì(€€€€€è¹±…ÍÑi½½´€ôèì(€€€€€ÕÍ•Éi½½µI•˜¹ÕÉÉ•¹Ð€ôèì(€€€€€­I•˜¹ÕÉÉ•¹Ð€ôèì(€€€€€€¼¼ƒ–zžnÓšZç–BG’æ¦:[’ö?–Þ—’ös–6’â·–þ¾òo’â7¢÷–>«š‚‡š¶šÂÓ–æÏŽš*+žV¯–â’â+žÞžVg–r£–:¢fWŽ(€€€€€ÍÑÉ¥ÁQ½ÁI•˜¹ÕÉÉ•¹Ð€ô(€€€€€€€€¡½¹Ñ…¥¹•ÉM¥é”¹¡•¥¡Ð€´ÁÉ•Ù¥•Ý!I•˜¹ÕÉÉ•¹Ð€¨è¤€¼€Èì(€€€€€€¼¼ƒ–Âë–¾ã–#–¾¯¾ò!ÍÉ½±±]¥‘Ñ ƒš&7šb¿–Â7žj¾ò'¾ò3–7š*+Ž3š6?’ö?žj¦
–/¦î{Ž7šRû–n{–:’ö4(€€€€€…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡è°ÑÉÕ”¤ì(€€€€€½¹ÍÐ½¹Ð€ô½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€€€½¹ÍÐÜ€ô½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ ì(€€€€€¥˜€¡½¹Ð€˜˜Ü€ø€À¤ì(€€€€€€€€¼¨èƒ¦
ž¶'šZð‰…Í•i½½´ƒšfžº_–ë’ú–ÂÇšb¿¢Ößš&/žjÍÉ½±±1•™Ðƒšr³¢ê¯¾ò0(€€€€€€€€€€ƒš&’î—ž²³’â–âŸ’â7šršr'’îï’öW’ö7žžìƒŠSŠPƒžÒSžÊç–:–rÃšRû–’ŸŽ€¨¼(€€€€€€€½¹ÍÐ‘•Í¥É•€ô5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ (€€€€€€€€€5…Ñ ¹µ…à À°½¹Ð¹ÍÉ½±±]¥‘Ñ €´½¹Ð¹±¥•¹Ñ]¥‘Ñ ¤°(€€€€€€€€€ÍÑÉ¥Á=™™Í•Ð¡Ü°è¤€¬è¹…¹¡½É€¨è€´è¹…¹¡½ÉAà°(€€€€€€€€¤¤ì(€€€€€€€½¹Ð¹ÍÉ½±±1•™Ð€ô‘•Í¥É•ì(€€€€€€€€¼¨M…™…É¤ƒšrš*(ÍÉ½±±1•™Ðƒ–Bã–"Ã¦n‹šV–?žÒƒ¾ò3¢ª“–Þ»šr¦j£–7ž:–r£š¶¢ÊƒšZç–BG–"š>o¾òl(€€€€€€€€€€ƒžÒÃžÞkšŠwžr/¢Öß’ú’úÿšr’ú–n{š*[Žžâ»šRû’î7–º3–£¢ÖÃ–:žR|é½½·¾ò3–>«žR ÑÉ…¹Í±…Ñ”Í(€€€€€€€€€€ƒ¢Žs–n{’â7¢ÚÏ’â–?žÒƒžj–ÂûšVã¾ò3–J3–&×š?š.ó–r[Ž3–¾›¦jo–Âë–¾ã¾ò/žÒS–æÏžžïŽ7žjžÖCšž/’â¢ÓŽ€¨¼(€€€€€€€½¹ÍÐ…ÑÕ…°€ô½¹Ð¹ÍÉ½±±1•™Ðì(€€€€€€€ÍÑÉ¥ÁMÕ‰Á¥á•±aI•˜¹ÕÉÉ•¹Ð€ô€¡…ÑÕ…°€´‘•Í¥É•¤€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°è¤ì(€€€€€€€½¹ÍÐ½°€ôÁ…•Í½±I•˜¹ÕÉÉ•¹Ðì(€€€€€€€¥˜€¡½°¤ì(€€€€€€€€€½¹ÍÐÍÕˆ€ôÍÑÉ¥ÁMÕ‰Á¥á•±aI•˜¹ÕÉÉ•¹Ðì(€€€€€€€€€½°¹ÍÑå±”¹ÑÉ…¹Í™½É´€ô5…Ñ ¹…‰Ì¡ÍÕˆ¤€ø€À¸ÀÀÀÄ€üÑÉ…¹Í±…Ñ”Í ‘íÍÕ‰õÁà°€À°€À¥€€è€œœì(€€€€€€€ô(€€€€€ô(€€€€€Á½Í¥Ñ¥½¹A…•Ñ±Ì ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐœ€ôÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ðì(€€€¥˜€¡œ¤ì(€€€€€½¹ÍÐÑÝ½¥¹•È€ô”¹Ñ½Õ¡•Ì¹±•¹Ñ €øô€Èì(€€€€€¥˜€¡œ¹µ½‘”€ôôô€Á¥¹ œ€˜˜ÑÝ½¥¹•È¤ì(€€€€€€€½¹ÍÐ€ô5…Ñ ¹¡åÁ½Ð (€€€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`°(€€€€€€€€€”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd(€€€€€€€€¤ì(€€€€€€€½¹ÍÐ¬€ô€¼œ¹ÍÑ…ÉÑ¥ÍÐì(€€€€€€€¥˜€¡œ¹­¥¹€ôôô€™±½…Ñ¥¹œœ¤ì(€€€€€€€€€½¹ÍÐÑ…É•Ð€ô™±½…Ñ¥¹%µ…•Ì¹™¥¹¡¥µœ€ôø¥µœ¹¥€ôôôœ¹™±½…Ñ¥¹%¤ì(€€€€€€€€€€¼¨ƒ¦Ë–"ÃŽ3¦ã’â·–ö‹ž.Ž7šf¾ò3–§š2š6?žjšb¼¨«–r[ž&–r£–ö‹ž.¢Ž‡žj–’Ÿ–Â<¨¨ƒŠSŠP(€€€€€€€€€€€€ƒž&§’îÛšr³¢ê¯žj–’Ÿ–Â?¢"¢žK–ê›¦÷’â7–.WŽžâ»–nx€Äƒ–7’î—’â/šÊKš?žú§¾ò#–r[–ÂÇ¢N/’â7šîÿ–ö‹ž.¾ò'¾ò0(€€€€€€€€€€€€ƒš&’î—’â/¦fCšb¼€Ç¾òo–7ž:¢º+–Â?šf’ö7žžï¢š¢Þ¢F_–’û–n{–:ï¾ò3’â7žÛšr¦rË–ëž¦ë¦jgŽ€¨¼(€€€€€€€€€¥˜€¡Ñ…É•Ð€˜˜Í¡…Á•M•±I•˜¹ÕÉÉ•¹Ð€ôôôÑ…É•Ð¹¥€˜˜¥Í%µM¡…Á• ¡Ñ…É•Ð…Ì…¹ä¤¹¥µM¡…Á”¤¤ì(€€€€€€€€€€€½¹ÍÐ¹è€ô±…µÁ%µi½½´ ¡œ¹‰…Í•M¡…Á•i½½´ñð€Ä¤€¨¬¤ì(€€€€€€€€€€€€¼¼ƒ’î—–ö‹ž.žj’â·–þž
ë–~ëšê[šRû–’Ÿ¾òk’ö7žžï¢š¢Þ¢F_–7ž:ž¶'š¾S¢ÖÃ¾ò3’â·–þ–êW’â/¦
’â¦î{š&7’â7šr¢ÞGš:$(€€€€€€€€€€€½¹ÍÐ¸€ôé½½µ‰½ÕÑM¡…Á••¹Ñ•È (€€€€€€€€€€€€€Ñ…É•Ð¹Ý¥‘Ñ °Ñ…É•Ð¹¡•¥¡Ð°œ¹‰…Í•M¡…Á•i½½´ñð€Ä°¹è°œ¹‰…Í•M¡…Á•`°œ¹‰…Í•M¡…Á•d¤ì(€€€€€€€€€€€ÅÕ•Õ•%¹Ñ•É…Ñ¥½¸  ¤€ôøÍ•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡¥µœ€ôø¥µœ¹¥€ôôôœ¹™±½…Ñ¥¹%(€€€€€€€€€€€€€€üì€¸¸¹¥µœ°¥µM¡…Á•i½½´è¹è°¥µM¡…Á•`è¸¹à°¥µM¡…Á•dè¸¹äô€è¥µœ¤¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ô(€€€€€€€€€€¼¼ƒ–r[ž&¢ÞšZ–¶_¦÷–>¿’î—¢ö'¾ò3¦
?¢ò¿¢Þ–&×š?š.ó–r[–B3’â––\(€€€€€€€€€½¹ÍÐ…¹I½Ñ…Ñ”€ôÑÉÕ”ì(€€€€€€€€€±•ÐÉ½Ð€ôÑ…É•Ðü¹É½Ñ…Ñ¥½¸€üü€Àì(€€€€€€€€€±•ÐÍÑÉ…¥¡Ð€ô™…±Í”ì(€€€€€€€€€ì(€€€€€€€€€€€€¼¨ƒš^/¢ö'šr'’âšº×Ž3’â7–.W–6Ž7¾òk–§š2¢ö'’â7–"ÀI=Q}MQIPƒ–ê›–ÂÇžVÛš"CžÒSžâ»šRû¾ò0(€€€€€€€€€€€€€€ƒ’â7žÛ–>«šb¿šÏšRû–’Ÿ’æšr’â7–Â?–þ¢ö'–"ÃŽ¢Ú¦;’æ/–ú3š*+¦Zšªïš&š:'–7¦Z/–ž/¢ö'¾ò0(€€€€€€€€€€€€€€ƒš&’î—’â7šr–r£¢Þ£¦;¦Zšªï¦
’âžz³¦ZO¢ÞÏ’â’â/Ž(€€€€€€€€€€€€€€ƒ¦vƒ¢þD€À¼äÀ¼ÄàÀ¼ÈÜÀƒ–ÂÇ–Bãš¶¾ò3’â›–r£ž&§’îÛ’â·–þš&O–§šŠw¢£šfžÞk¾ò3¢ºO’êëž~—¦Ošb¿š¶žjŽ€¨¼(€€€€€€€€€€€½¹ÍÐI=Q}MQIP€ô€à°I=Q}M9@€ô€Øì(€€€€€€€€€€€½¹ÍÐÝÉ…ÀÄàÀ€ô€¡Øè¹Õµ‰•È¤€ôø€ ¡Ø€¬€ÄàÀ¤€”€ÌØÀ€¬€ÌØÀ¤€”€ÌØÀ€´€ÄàÀì(€€€€€€€€€€€½¹ÍÐ…¹œ€ô5…Ñ ¹…Ñ…¸È (€€€€€€€€€€€€€”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd°(€€€€€€€€€€€€€”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`(€€€€€€€€€€€€¤€¨€ÄàÀ€¼5…Ñ ¹A$ì(€€€€€€€€€€€±•Ð‘I½Ð€ôÝÉ…ÀÄàÀ¡…¹œ€´œ¹ÍÑ…ÉÑ¹±”¤ì(€€€€€€€€€€€¥˜€ …œ¹É½Ñ=¸¤ì(€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘I½Ð¤€ðI=Q}MQIP¤‘I½Ð€ô€Àì(€€€€€€€€€€€€€•±Í”ìœ¹É½Ñ=¸€ôÑÉÕ”ìœ¹É½Ñ	¥…Ì€ô‘I½Ð€ø€À€üI=Q}MQIP€è€µI=Q}MQIPìô(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡œ¹É½Ñ=¸¤‘I½Ð€´ô€¡œ¹É½Ñ	¥…Ìñð€À¤ì(€€€€€€€€€€€É½Ð€ô€ ¡œ¹‰…Í•I½Ñ…Ñ¥½¸€¬‘I½Ð¤€”€ÌØÀ€¬€ÌØÀ¤€”€ÌØÀì(€€€€€€€€€€€½¹ÍÐ¹•…É•ÍÐ€ô€¡5…Ñ ¹É½Õ¹¡É½Ð€¼€äÀ¤€¨€äÀ¤€”€ÌØÀì(€€€€€€€€€€€ÍÑÉ…¥¡Ð€ô5…Ñ ¹…‰Ì¡ÝÉ…ÀÄàÀ¡É½Ð€´¹•…É•ÍÐ¤¤€ðôI=Q}M9@ì(€€€€€€€€€€€¥˜€¡ÍÑÉ…¥¡Ð¤É½Ð€ô¹•…É•ÍÐì(€€€€€€€€€ô(€€€€€€€€€€¼¨ƒ¦ngš2žâ»šRûšf’æ¢š–Bã¦fžV¯–â¦
+žV3’â›¦†¿ž’ë¢òS–*§žÞhƒŠSŠPƒ’î—–&7–>«šr'š.[šnÏ–J3š.'–no¢žH(€€€€€€€€€€€€ƒš&7šr'¾ò3š6?–B#–º3–£šÊKšr'¾ò3–ú#¦nš*+–r[žâ»–"Ã–&o––÷¢Êó¦ö+žV¯–âŽ(€€€€€€€€€€€€ƒ’â·–þ¦î{–r£š6?–B#šf’â7–.W¾ò3š&’î—–>«šr'Ž3–no–/¦
+žV3Ž7šr¦j£–7ž:žžï–.W¾òkš*+–7ž:¢žš"@(€€€€€€€€€€€€ƒŽ3¦gšŠw¦
+–&o––÷¢B÷–r£žV¯–â¦
+žV3’â+Ž7žj–ó¾ò3šr¢þGžj¦
’â–/–r£¦Zšªï–Ÿ–ÂÇ–Bã¦f¦;–:ïŽ€¨¼(€€€€€€€€€½¹ÍÐÉ…ÝM…±”€ô5…Ñ ¹µ…à À¸Ä°œ¹‰…Í•M…±”€¨¬¤ì(€€€€€€€€€€¼¼ƒ¢Þw¦n‹ššâ³šr–r£žnã¦Ã’ê/’îÛ¦ZOš*[–.W¦nÛ¦î{–æøÁã¾òo–&×š?š.ó–r[šb¿’â–æ–>«š:‡šr–ú3’âž¶¾ò0(€€€€€€€€€€¼¼=4ƒž&#–7–*ƒ¢òW¦?’ö;¦k¾ò3¦ÿ–7¦g’êo¦®c¦‚ï¦ns¢¢+žnÓš:—¢º+š"CžnK–¶C–Âë–¾ãŽ(€€€€€€€€€±•Ð¹Ì€ôœ¹±…ÍÑM…±”€ôôôÕ¹‘•™¥¹•ñð5…Ñ ¹…‰Ì¡É…ÝM…±”€´œ¹±…ÍÑM…±”¤€ð€À¸ÀÀÀÔ(€€€€€€€€€€€€ü€¡œ¹±…ÍÑM…±”€üüÉ…ÝM…±”¤(€€€€€€€€€€€€èœ¹±…ÍÑM…±”€¬€¡É…ÝM…±”€´œ¹±…ÍÑM…±”¤€¨€À¸ÜÈì(€€€€€€€€€œ¹±…ÍÑM…±”€ô¹Ìì(€€€€€€€€€½¹ÍÐ¥ÍY•Ñ½É=‰©•Ð€ô€„…Ñ…É•Ð€˜˜€ „…Ñ…É•Ð¹Í¡…Á”ñðÑ…É•Ð¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•¤ì(€€€€€€€€€€¼¼ƒ–r[–ö‹Žž²›¢f¢"šZ–¶_žâ»šRûšf’â7–k¦
+žV3–7ž:–Bã¦fŽ–º–Gžj–Âë–¾ãšr–6ÏšfšRç–¾¯¾ò0(€€€€€€€€€€¼¼ƒ–Bã–—¾ò?¦n‹¦Z/¢£žV3–ó–6Ï’öÿšr'¦Ëšî¿¾ò3’î7šr–ö‹š"C¢
'žró–>¿¢š/žj’âš‚ó¢ÞÏ–.W¾òo–r[ž&’þwžVd(€€€€€€€€€€¼¼ƒ–:šr³žj¢Êó¦
+–Bã¦f¾ò3–BG¦?ž&§’îÛ–&žÚ·š2¦žê3žj’â–Â7’âžâ»šRûŽ(€€€€€€€€€¥˜€¡Ñ…É•Ð€˜˜•¹…‰±•M¹…ÁÁ¥¹œ€˜˜€…¥ÍY•Ñ½É=‰©•Ð¤ì(€€€€€€€€€€€½¹ÍÐM9A}%8€ô€Ì°M9A}=UP€ô€àì(€€€€€€€€€€€½¹ÍÐà€ôÑ…É•Ð¹à€¬Ñ…É•Ð¹Ý¥‘Ñ €¼€Èì(€€€€€€€€€€€½¹ÍÐä€ôÑ…É•Ð¹ä€¬Ñ…É•Ð¹¡•¥¡Ð€¼€Èì(€€€€€€€€€€€±•Ð‰•ÍÐ€ô%¹™¥¹¥Ñä°‰•ÍÑM…±”€ô¹Ìì(€€€€€€€€€€€€¼¼ƒ–7ž:–Bã¦f’æ¢šžR£¢ö'¦;žj–’[š†¾ò3’â7žÛ¢ö$€äÀƒ–ê›’æ/–ú3¢Êó¦ö+žj’ö7žö»šr–Þ»–6+–/¢ê¯–¶@(€€€€€€€€€€€½¹ÍÐ•áÐ€ôÉ½ÑáÑ•¹Ð¡Ñ…É•Ð¹Ý¥‘Ñ °Ñ…É•Ð¹¡•¥¡Ð°É½Ð¤ì(€€€€€€€€€€€Á…•I•ÑÍ9•…È¡•Ñ±±A…•I•ÑÌ ¤°à¤¹™½É… ¡ÁÈ€ôøì(€€€€€€€€€€€€€½¹ÍÐ…¹‘Ìè¹Õµ‰•Émt€ômtì(€€€€€€€€€€€€€¥˜€¡•áÐ¹‰Ü€ø€Ä¤ì(€€€€€€€€€€€€€€€…¹‘Ì¹ÁÕÍ   È€¨€¡à€´ÁÈ¹±•™Ð¤¤€¼•áÐ¹‰Ü¤ì(€€€€€€€€€€€€€€€…¹‘Ì¹ÁÕÍ   È€¨€¡ÁÈ¹É¥¡Ð€´à¤¤€¼•áÐ¹‰Ü¤ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€€€¥˜€¡•áÐ¹‰ €ø€Ä¤ì(€€€€€€€€€€€€€€€…¹‘Ì¹ÁÕÍ   È€¨€¡ä€´ÁÈ¹Ñ½À¤¤€¼•áÐ¹‰ ¤ì€€€€¼¼ƒ’â+¦
+¢Êó¦ö((€€€€€€€€€€€€€€€…¹‘Ì¹ÁÕÍ   È€¨€¡ÁÈ¹‰½ÑÑ½´€´ä¤¤€¼•áÐ¹‰ ¤ì€¼¼ƒ’â/¦
+¢Êó¦ö((€€€€€€€€€€€€€ô(€€€€€€€€€€€€€…¹‘Ì¹™½É… ¡…¹€ôøì(€€€€€€€€€€€€€€€¥˜€ „¡…¹€ø€À¸Ä¤¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€¼¼ƒš>ožº_š"CŽ3žV¯¦v‹’â+–Þ»–æû–/–?žÒƒŽ7–7š¾S¦Zšªï¾ò3–7ž:šr³¢ê¯žj–Þ»šÊKšr'š?žú¤(€€€€€€€€€€€€€€€½¹ÍÐÁà€ô5…Ñ ¹…‰Ì¡…¹€´¹Ì¤€¨5…Ñ ¹µ…à¡•áÐ¹‰Ü°•áÐ¹‰ ¤€¼€Èì(€€€€€€€€€€€€€€€¥˜€¡Áà€ðM9A}%8€˜˜Áà€ð‰•ÍÐ¤ì‰•ÍÐ€ôÁàì‰•ÍÑM…±”€ô…¹ìô(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€¼¨ƒ–Bã’ö?–ú3’öÿžR£¢ú–º÷žjžšï–ò¦^£šžoŽšÊ‡šr'¢þšî{š^Û¾ò3š&/š2žj–ú»–Â?–f«–ŽÃ’òk¢º§–7ž:(€€€€€€€€€€€€€€ƒ–r É…Ü½Í¹…Àƒ’â“’â«–ó’æ/¦^Ó¦C–âŸ–"š6‹¾ò3¢ž¢ž'’â+–ÂÇšb¿–nû–ö‹’â;ž²›–>ßš*[–*£Ž€¨¼(€€€€€€€€€€€¥˜€¡œ¹Í¹…ÁM…±”€„ôôÕ¹‘•™¥¹•¤ì(€€€€€€€€€€€€€½¹ÍÐÁà€ô5…Ñ ¹…‰Ì¡¹Ì€´œ¹Í¹…ÁM…±”¤€¨5…Ñ ¹µ…à¡•áÐ¹‰Ü°•áÐ¹‰ ¤€¼€Èì(€€€€€€€€€€€€€¥˜€¡Áà€ðôM9A}=UP¤¹Ì€ôœ¹Í¹…ÁM…±”ì(€€€€€€€€€€€€€•±Í”œ¹Í¹…ÁM…±”€ôÕ¹‘•™¥¹•ì(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡œ¹Í¹…ÁM…±”€ôôôÕ¹‘•™¥¹•€˜˜‰•ÍÐ€ðM9A}%8¤ì(€€€€€€€€€€€€€œ¹Í¹…ÁM…±”€ô‰•ÍÑM…±”ì(€€€€€€€€€€€€€¹Ì€ô‰•ÍÑM…±”ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€€€±•Ð¹•áÑÕ¥‘•±¥¹•Ìè±¥¹µ•¹ÑÕ¥‘•±¥¹•mtð¹Õ±°€ô¹Õ±°ì(€€€€€€€€€¥˜€¡Ñ…É•Ð¤ì(€€€€€€€€€€€€¼¼ƒ–B3š¢–>«žV¯Ž3¦
+Ž7žjžÞk¾òkš6?–B#šf’â·–þ’â7–.W¾ò3’â·žÞkšršVÓ¢Ú’ê»¢F_¾ò#¢š,Í…±•1…å½ÕÑM¹…ÁÁ•“¾ò$(€€€€€€€€€€€½¹ÍÐÁ…•1¥¹•Ì€ôÁ…•Õ¥‘•±¥¹•ÍÐ¡Ñ…É•Ð¹à°Ñ…É•Ð¹ä°Ñ…É•Ð¹Ý¥‘Ñ °Ñ…É•Ð¹¡•¥¡Ð°¹Ì°ÑÉÕ”°É½Ð¤ì(€€€€€€€€€€€€¼¨ƒ’â·–þžj¦
–§šŠwžÞkšb¿Ž3¢ö'š¶’êŽ7žj–n{¦–/¾ò3–>«šr'žržj–r£¢ö'žjšf–gš&7¢¦Ë–ëž>ûŽ(€€€€€€€€€€€€€€ƒ–:šr³–>«žr,ÍÑÉ…¥¡ÐƒŠSŠPƒšÊK¢ö'¦;žjž&§’îÛ¢žK–ê›šr³’ú–ÂÇšb¼€Ã¾ò3ž¶'šZó’âšVÓ¢Ú|(€€€€€€€€€€€€€€ƒžÒSžâ»šRû¦÷š:o¢F_¦
–§šŠwžÞk¾ò3žr/¢Öß’ú¢:¯–B7–Û–šgŽ–*ƒ’â(œ¹É½Ñ=»¾òh(€€€€€€€€€€€€€€ƒš&/š2žržj¢ö'¢Ú¦;’â7–.W–6š&7žº_–r£¢ö'Ž€¨¼(€€€€€€€€€€€¹•áÑÕ¥‘•±¥¹•Ì€ô‘•‘ÕÁ•Õ¥‘•±¥¹•Ì¡ÍÑÉ…¥¡Ð€˜˜œ¹É½Ñ=¸(€€€€€€€€€€€€€€ül(€€€€€€€€€€€€€€€€€ìÑåÁ”è€Ù•ÉÑ¥…°œ°½½ÉèÑ…É•Ð¹à€¬Ñ…É•Ð¹Ý¥‘Ñ €¼€Èô°(€€€€€€€€€€€€€€€€€ìÑåÁ”è€¡½É¥é½¹Ñ…°œ°½½ÉèÑ…É•Ð¹ä€¬Ñ…É•Ð¹¡•¥¡Ð€¼€Èô°(€€€€€€€€€€€€€€€€€€¸¸¹Á…•1¥¹•Ì°(€€€€€€€€€€€€€€€t(€€€€€€€€€€€€€€èÁ…•1¥¹•Ì°Ñ…É•Ð¹à€¬Ñ…É•Ð¹Ý¥‘Ñ €¼€È¤ì(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐ™¥¹…±9Ì€ô¹Ì°™¥¹…±I½Ð€ôÉ½Ðì(€€€€€€€€€ÅÕ•Õ•%¹Ñ•É…Ñ¥½¸  ¤€ôøì(€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡¥µœ€ôø(€€€€€€€€€€€€€¥µœ¹¥€ôôôœ¹™±½…Ñ¥¹%(€€€€€€€€€€€€€€€€üì€¸¸¹¥µœ°Í…±”è™¥¹…±9Ì°€¸¸¸¡…¹I½Ñ…Ñ”€üìÉ½Ñ…Ñ¥½¸è™¥¹…±I½Ðô€èíô¤ô(€€€€€€€€€€€€€€€€è¥µœ(€€€€€€€€€€€€¤¤ì(€€€€€€€€€€€¥˜€¡¹•áÑÕ¥‘•±¥¹•Ì¤Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡¹•áÑÕ¥‘•±¥¹•Ì¤ì(€€€€€€€€€ô¤ì(€€€€€€€ô•±Í”¥˜€¡œ¹­¥¹€ôôô€±…å½ÕÐœ¤ì(€€€€€€€€€Í…±•1…å½ÕÑM¹…ÁÁ•¡œ¹‰…Í•M…±”€¨¬°ÝÍ•ÍÑÕÉ•1…å½ÕÑ%‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€¼¨ƒšVÓžÖ’ö#–Æžj–§š2š^/¢ö'¾ò3š&/š¢Þ’â¢"³–r[ž&ŽšZ–¶_–B3’â––_¾òh(€€€€€€€€€€€€ƒŠF€ƒ–#šr'’âšº×Ž3’â7–.W–6Ž7ŠSŠS¢ö'’â7–"ÀI=Q}MQIPƒ–ê›–ÂÇžVÛš"CžÒSžâ»šRû¾ò0(€€€€€€€€€€€€€€€ƒ–7–ú_–>«šb¿šÏšRû–’Ÿ–6ï’â7–Â?–þš¶«š:'¾òl(€€€€€€€€€€€€ƒŠF„ƒ¢Ú¦;¦Zšªï’æ/–ú3š*+¦Zšªï¦
’âšº×š&š:'–7¦Z/–ž/¢ö'¾ò3¢Þ£¦;–:ïžjžz³¦ZO’â7šr¢ÞÏ’â’â/¾òl(€€€€€€€€€€€€ƒŠFˆƒ¦vƒ¢þD€À¼äÀ¼ÄàÀ¼ÈÜÀƒ–ÂÇ–Bãš¶Ž€¨¼(€€€€€€€€€ì(€€€€€€€€€€€½¹ÍÐI=Q}MQIP€ô€à°I=Q}M9@€ô€Øì(€€€€€€€€€€€½¹ÍÐÝÉ…ÀÄàÀ€ô€¡Øè¹Õµ‰•È¤€ôø€ ¡Ø€¬€ÄàÀ¤€”€ÌØÀ€¬€ÌØÀ¤€”€ÌØÀ€´€ÄàÀì(€€€€€€€€€€€½¹ÍÐ…¹œÈ€ô5…Ñ ¹…Ñ…¸È (€€€€€€€€€€€€€”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñd€´”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd°(€€€€€€€€€€€€€”¹Ñ½Õ¡•ÍlÅt¹±¥•¹Ñ`€´”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`(€€€€€€€€€€€€¤€¨€ÄàÀ€¼5…Ñ ¹A$ì(€€€€€€€€€€€±•Ð‘I½Ð€ôÝÉ…ÀÄàÀ¡…¹œÈ€´œ¹ÍÑ…ÉÑ¹±”¤ì(€€€€€€€€€€€¥˜€ …œ¹É½Ñ=¸¤ì(€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘I½Ð¤€ðI=Q}MQIP¤‘I½Ð€ô€Àì(€€€€€€€€€€€€€•±Í”ìœ¹É½Ñ=¸€ôÑÉÕ”ìœ¹É½Ñ	¥…Ì€ô‘I½Ð€ø€À€üI=Q}MQIP€è€µI=Q}MQIPìô(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡œ¹É½Ñ=¸¤ì(€€€€€€€€€€€€€‘I½Ð€´ô€¡œ¹É½Ñ	¥…Ìñð€À¤ì(€€€€€€€€€€€€€±•ÐÉ½Ð€ô€ ¡œ¹‰…Í•1…å½ÕÑI½Ð€¬‘I½Ð¤€”€ÌØÀ€¬€ÌØÀ¤€”€ÌØÀì(€€€€€€€€€€€€€½¹ÍÐ¹•…É•ÍÐ€ô€¡5…Ñ ¹É½Õ¹¡É½Ð€¼€äÀ¤€¨€äÀ¤€”€ÌØÀì(€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡ÝÉ…ÀÄàÀ¡É½Ð€´¹•…É•ÍÐ¤¤€ðôI=Q}M9@¤É½Ð€ô¹•…É•ÍÐì(€€€€€€€€€€€€€Á…Ñ¡1…å½ÕÑP¡ìÉ½Ðô°ÝÍ•ÍÑÕÉ•1…å½ÕÑ%‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€ô•±Í”¥˜€¡œ¹­¥¹€ôôô€•±°œ€˜˜œ¹•±±%‘à€øô€À¤ì(€€€€€€€€€…ÁÁ±å•±±i½½´¡œ¹•±±%‘à°5…Ñ ¹µ…à Ä¸À°5…Ñ ¹µ¥¸ Ô¸À°œ¹‰…Í•i½½´€¨¬¤¤¤ì(€€€€€€€ô(€€€€€ô•±Í”¥˜€¡œ¹µ½‘”€ôôô€‘É…œœ€˜˜”¹Ñ½Õ¡•Ì¹±•¹Ñ €ôôô€Ä¤ì(€€€€€€€¥˜€ …Í•±•Ñ¥½¹É…¥¹œ¤Í•ÑM•±•Ñ¥½¹É…¥¹œ¡ÑÉÕ”¤ì(€€€€€€€€¼¼ƒš&/š2šb¿¢z‹–æW–?žÒƒŽž&§’îÛ–êŸš¢gšb¿–Ÿ–ºç–Z»’ö7¾òk¦f“’î—žV¯–â–7ž:¾ò0(€€€€€€€€¼¼ƒžâ»–Â?¦‚C¢š÷šfš.[švÇ¢–ÿš&7’â7šr¢º+–ú_–>#š‹–>#’â7¢Þš&,(€€€€€€€½¹ÍÐ­€ô­I•˜¹ÕÉÉ•¹Ðñð€Äì(€€€€€€€½¹ÍÐ‘à€ô€¡”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`€´œ¹ÍÑ…ÉÑ`¤€¼­ì(€€€€€€€½¹ÍÐ‘ä€ô€¡”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñd€´œ¹ÍÑ…ÉÑd¤€¼­ì(€€€€€€€¥˜€¡œ¹­¥¹€ôôô€™±½…Ñ¥¹œœ¤ì(€€€€€€€€€½¹ÍÐÍ•±•Ñ•‘%µœ€ô™±½…Ñ¥¹%µ…•Ì¹™¥¹¡¥µœ€ôø¥µœ¹¥€ôôôœ¹™±½…Ñ¥¹%¤ì(€€€€€€€€€€¼¨ƒŽ3–ö‹ž.Ž7¦
’â¦‚¦Z/¢F_Ž¦g–ò×–r[šr'–ö‹ž.Ž¢3’âSš&/š2šb¿–ú{–r[š†#¢Ž‡¦v‹š2'’â/–:ïžj¾òh(€€€€€€€€€€€€ƒš.[šnÏšb¿–r£š2«–.WŽ3–r[ž&–r£–ö‹ž.¢Ž‡žj’ö7žö»Ž7¾ò3’â7šb¿šB³–.W–r[ž&šr³¢ê¯Ž(€€€€€€€€€€€€ƒ–ú{–ö‹ž.–’[¦v‹š2'’â/–:ïŽš"[¦^sš:'¦
’â¦‚¾ò3¦÷¦
šb¿–:šr³žjšB³žžïŽ€¨¼(€€€€€€€€€€¼¨ƒŽ3–ö‹ž.Ž7¦
’â¦‚¦Z/¢F_Ž¢3’âS¦g–ò×–r[šr'–ö‹ž. ƒŠHƒ–Z»š2š.[šnÏ’â–ú/šb¿–r£š2«–.T(€€€€€€€€€€€€ƒŽ3–r[ž&–r£–ö‹ž.¢Ž‡žj’ö7žö»Ž7¾ò3’â7žº‡š&/š2šb¿–ú{–ö‹ž.¢Ž‡¦v‹¦
šb¿–’[¦v‹š2'’â/–:ïžjŽ(€€€€€€€€€€€€ƒ¢ššB³–.W–r[–Æ“–ÂÇ¦–ë¦g’â¦‚¾ò#¦î{’â’â/–ö‹ž.–’[¦v‹¾ò'Ž€¨¼(€€€€€€€€€¥˜€¡Í•±•Ñ•‘%µœ€˜˜Í¡…Á•M•±I•˜¹ÕÉÉ•¹Ð€ôôôÍ•±•Ñ•‘%µœ¹¥(€€€€€€€€€€€€€€˜˜¥Í%µM¡…Á• ¡Í•±•Ñ•‘%µœ…Ì…¹ä¤¹¥µM¡…Á”¤¤ì(€€€€€€€€€€€€¼¨ƒ–>¿’î—š.[žjž¾–r7–ÂÇšb¿Ž3–r[š¾Sš†–’Ÿ–ë’úžj¦
’â–r#Ž7¾ò3¦f“’î—–ºš>ožº_š"@€´ÅøÇŽ(€€€€€€€€€€€€€€ƒ–r[ž&¢ö'¦;¢žK–ê›žj¢¦Ç¾ò3š&/š2žjšZç–BG’æ¢š¢Þ¢F_¢ö'–n{–:ï¾ò3’â7žÛšrš¶«¢F_¢ÞGŽ€¨¼(€€€€€€€€€€€½¹ÍÐÉ½Ð€ô€ ¡Í•±•Ñ•‘%µœ¹É½Ñ…Ñ¥½¸ñð€À¤€¨5…Ñ ¹A$¤€¼€ÄàÀì(€€€€€€€€€€€½¹ÍÐ±à€ô‘à€¨5…Ñ ¹½Ì µÉ½Ð¤€´‘ä€¨5…Ñ ¹Í¥¸ µÉ½Ð¤ì(€€€€€€€€€€€½¹ÍÐ±ä€ô‘à€¨5…Ñ ¹Í¥¸ µÉ½Ð¤€¬‘ä€¨5…Ñ ¹½Ì µÉ½Ð¤ì(€€€€€€€€€€€½¹ÍÐÍŒ€ôÍ•±•Ñ•‘%µœ¹Í…±”ñð€Äì(€€€€€€€€€€€€¼¨ƒ–>¿’î—š.[žjž¾–r7¾òw–r[ž&¢N/¦;¦
–/š¶šZç–ö‹’æ/–ú3–’k–ë’úžj¦£–"¾ò#’æc’â+ž&§’îÛšr³¢ê¯žjžâ»šRû¾ò0(€€€€€€€€€€€€€€ƒ–nƒž
ëš&/š2žj’ö7žžï–ÞËžÚOš>ožº_š"C–Ÿ–ºç–Z»’ö7’ê¾ò'Ž–7ž:€Äƒšfš¦¯žjžŸž&šr³’ú–ÂÇ–Þ›–>Ïšr'–ú_š.[Ž€¨¼(€€€€€€€€€€€½¹ÍÐÁ…¸€ô¥µM¡…Á•A…¸¡Í•±•Ñ•‘%µœ¹Ý¥‘Ñ °Í•±•Ñ•‘%µœ¹¡•¥¡Ð°€¡Í•±•Ñ•‘%µœ…Ì…¹ä¤¹¥µM¡…Á•i½½´¤ì(€€€€€€€€€€€½¹ÍÐÉà€ôÁ…¸¹Éà€¨ÍŒ°Éä€ôÁ…¸¹Éä€¨ÍŒì(€€€€€€€€€€€½¹ÍÐ°€ô€¡Øè¹Õµ‰•È¤€ôø5…Ñ ¹µ…à ´Ä°5…Ñ ¹µ¥¸ Ä°Ø¤¤ì(€€€€€€€€€€€½¹ÍÐÁà€ôÉà€ø€À¸Ô€ü° ¡œ¹‰…Í•M¡…Á•`ñð€À¤€¬±à€¼Éà¤€è€¡œ¹‰…Í•M¡…Á•`ñð€À¤ì(€€€€€€€€€€€½¹ÍÐÁä€ôÉä€ø€À¸Ô€ü° ¡œ¹‰…Í•M¡…Á•dñð€À¤€¬±ä€¼Éä¤€è€¡œ¹‰…Í•M¡…Á•dñð€À¤ì(€€€€€€€€€€€ÅÕ•Õ•%¹Ñ•É…Ñ¥½¸  ¤€ôøÍ•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡¥µœ€ôø(€€€€€€€€€€€€€¥µœ¹¥€ôôôœ¹™±½…Ñ¥¹%€üì€¸¸¹¥µœ°¥µM¡…Á•`èÁà°¥µM¡…Á•dèÁäô€è¥µœ¤¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡Í•±•Ñ•‘%µœ¤ì(€€€€€€€€€€€½¹ÍÐìÍ¹…ÁÁ•‘`°Í¹…ÁÁ•‘d°Õ¥‘•±¥¹•Ìô€ô…ÁÁ±åM¹…ÁÁ¥¹œ (€€€€€€€€€€€€€Í•±•Ñ•‘%µœ¹¥°œ¹‰…Í•`€¬‘à°œ¹‰…Í•d€¬‘ä°(€€€€€€€€€€€€€Í•±•Ñ•‘%µœ¹Ý¥‘Ñ °Í•±•Ñ•‘%µœ¹¡•¥¡Ð°Í•±•Ñ•‘%µœ¹Í…±”°(€€€€€€€€€€€€€Õ¹‘•™¥¹•°Í•±•Ñ•‘%µœ¹É½Ñ…Ñ¥½¸ñð€À°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€€¼¨ƒ–nûž&’â7¢÷¢Š¯š.[–"Ã–nû–ö‹ž&§’îÛ’â+ŽžŠÃšJ{š^ÛžîÓš2’â+’â–âŸžj–B#šÎW’ö7žö»¾òl(€€€€€€€€€€€€€€ƒš&/š2žžï–ë–nû–ö‹¢2–nÓ–B;’òkž®/–"ïžîŸžî·¢Þ¦j?¾ò3’â7’òk–6‡š¶ïš"[¢ÞÏ’ö7Ž€¨¼(€€€€€€€€€€€¥˜€¡¥µ…•]½Õ±‘=Ù•É±…ÁM¡…Á”¡Í•±•Ñ•‘%µœ°Í¹…ÁÁ•‘`°Í¹…ÁÁ•‘d¤¤ì(€€€€€€€€€€€€€ÅÕ•Õ•%¹Ñ•É…Ñ¥½¸  ¤€ôøÍ•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤¤ì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€ÅÕ•Õ•%¹Ñ•É…Ñ¥½¸  ¤€ôøì(€€€€€€€€€€€€€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡Õ¥‘•±¥¹•Ì¤ì(€€€€€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡¥µœ€ôø(€€€€€€€€€€€€€€€€€¥µœ¹¥€ôôôœ¹™±½…Ñ¥¹%€üì€¸¸¹¥µœ°àèÍ¹…ÁÁ•‘`°äèÍ¹…ÁÁ•‘dô€è¥µœ(€€€€€€€€€€€€€€€€¤¤ì(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô(€€€€€€€ô•±Í”¥˜€¡œ¹­¥¹€ôôô€±…å½ÕÐœ¤ì(€€€€€€€€€µ½Ù•1…å½ÕÑQ¼¡œ¹‰…Í•`€¬‘à°œ¹‰…Í•d€¬‘ä¤ì(€€€€€€€ô•±Í”¥˜€¡œ¹­¥¹€ôôô€•±°œ€˜˜œ¹•±±%‘à€øô€À¤ì(€€€€€€€€€…ÁÁ±å•±±A…¸¡œ¹•±±%‘à°œ¹‰…Í•=™™Í•Ñ`°œ¹‰…Í•=™™Í•Ñd°‘à°‘ä¤ì(€€€€€€€ô(€€€€€ô(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐÀ€ôÁ…¹I•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐ•°€ô½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …Àñð€…•°ñð”¹Ñ½Õ¡•Ì¹±•¹Ñ €„ôô€Ä¤É•ÑÕÉ¸ì(€€€½¹ÍÐà€ô”¹Ñ½Õ¡•ÍlÁt¹±¥•¹Ñ`ì(€€€½¹ÍÐ¹½Ü€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€€€½¹ÍÐ‘Ð€ô5…Ñ ¹µ…à Ä°¹½Ü€´À¹±…ÍÑP¤ì(€€€€¼¼ƒš6Ë–.WšZç–BG¢"š&/š2žnã–>7¾òo¦–ê›–Z»’ö7ž
èÁà½µÏ¾ò#š6Ë–.W–êŸš¢g¾ò$(€€€À¹Ø€ô€¡À¹±…ÍÑ`€´à¤€¼‘Ðì(€€€À¹±…ÍÑ`€ôàì(€€€À¹±…ÍÑP€ô¹½Üì(€€€€¼¼ƒ–"Ã¦‚·–"Ã–Âû–ÂÇ¦7šZÃš*O’âš²‡¢Öß¦î{Ž’â7žÛš&/š2¦
–>¿’î—žæóžê3–ú–’[šîG–æûžføÁã¾ò!ÍÉ½±±1•™Ð(€€€€¼¼ƒ¢Š¯–’û’ö?ŽžV¯¦v‹’â7–.W¾ò'¾ò3–n{¦‚·šf¢š–#š*+¦
–æûžføÁàƒšîG–n{’úžV¯¦v‹š&7¦Z/–ž/–.W¾ò0(€€€€¼¼ƒš&/š–ÂÇšb¿Ž3šîG–"Ãšr¦
+¦
+–6‡’ö?–>#–ö#’â7–n{’úŽ7Ž(€€€½¹ÍÐµ…à€ô5…Ñ ¹µ…à À°•°¹ÍÉ½±±]¥‘Ñ €´•°¹±¥•¹Ñ]¥‘Ñ ¤ì(€€€±•ÐÑ…É•Ð€ôÀ¹ÍÑ…ÉÑMÉ½±°€´€¡à€´À¹ÍÑ…ÉÑ`¤ì(€€€¥˜€¡Ñ…É•Ð€ð€À¤ìÑ…É•Ð€ô€ÀìÀ¹ÍÑ…ÉÑ`€ôàìÀ¹ÍÑ…ÉÑMÉ½±°€ô€Àìô(€€€•±Í”¥˜€¡Ñ…É•Ð€øµ…à¤ìÑ…É•Ð€ôµ…àìÀ¹ÍÑ…ÉÑ`€ôàìÀ¹ÍÑ…ÉÑMÉ½±°€ôµ…àìô(€€€•°¹ÍÉ½±±1•™Ð€ôÑ…É•Ðì(€€€€¼¼ƒš&/š2žržjš*+¦‚¦v‹–âÛ–.W’ê¾òk¦g’âš²‡š&/–.‹–ú{š¶“–>«¢÷šb¿š6Ë¦‚(€€€Á…¹5½Ù•‘I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€¼¼ƒ¦‚¦v‹šb¼ÍÉ½±±1•™Ðƒ–âÛ¢F_¢ÖÃžj¾ò3š2'¦"Wšb¼ÑÉ…¹Í™½É·¾òk–B3’â–âŸ–¾¯–º3š&7’â7šrš‹–6+š.4(€€€Á½Í¥Ñ¥½¹A…•Ñ±Ì ¤ì(€ôì((€½¹ÍÐ¡…¹‘±•]½É­ÍÁ…•Q½Õ¡¹€ô€¡”üèI•…Ð¹Q½Õ¡Ù•¹Ðñ!Q51¥Ù±•µ•¹Ðø¤€ôøì(€€€€¼¼ƒ¦ngš2žâ»šRû–þ¦‚#ž¶'šr–ú3’âš‚çš&/š2’æ¦n‹¦Z/š&7šRÛ–Âû¾ò3¦ÿ–7’â·¦S¦7š:K¦ƒš"CžV¯¦v‹¢ÞÏ–.WŽ(€€€¥˜€¡…¹Ù…Íi½½µI•˜¹ÕÉÉ•¹Ð€˜˜”€˜˜”¹Ñ½Õ¡•Ì¹±•¹Ñ €ø€À¤É•ÑÕÉ¸ì(€€€™±ÕÍ¡%¹Ñ•É…Ñ¥½¹9½Ü ¤ì(€€€Í•ÑM•±•Ñ¥½¹É…¥¹œ¡™…±Í”¤ì(€€€Í•ÑA¥¹¡±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€¼¼ƒš&/š2–£¦£¦n‹¦Z/’ê¾ò3’â/’âš²‡š&/–.‹š&7¢÷¦7šZÃšÆë–ºkšb¿š6Ë¦‚¦
šb¿žâ»šRø(€€€Á…¹5½Ù•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€¼¨ƒžV¯–âžâ»šRûšRÛ–Âû¾òkš*+š&/–.‹šr¦ZOžnÓš:—–¾¯¦È=4ƒžj–7ž:–B3š¶—–nxÍÑ…Ñ—Ž(€€€€€€ƒš¶“šf­I•˜ƒ–ÞËžÚOž¶'šZóžn»š¢g–ó¾ò3š&’î—’â+¦v‹¦
šR¿žâ»šRû–.WžV¯žj±…å½ÕÐ•™™•Ð(€€€€€€ƒšr–"“–ºkŽ3šÊKšr'¢º+–2[Ž7žnÓš:—¢ÞÏ¦;¾ò3’â7šr–7¢Žs’âšº×–.WžV¯Ž€¨¼(€€€¥˜€¡…¹Ù…Íi½½µI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€…¹Ù…Íi½½µI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡ÕÍ•Éi½½µI•˜¹ÕÉÉ•¹Ð°™…±Í”¤ì(€€€€€Í•ÑUÍ•Éi½½´¡ÕÍ•Éi½½µI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡­I•˜¹ÕÉÉ•¹Ð°™…±Í”¤ì(€€€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤ì(€€€€€Í•ÑÑ¥Ù•½±±¥Í¥½¹Ì¡ì±•™Ðè™…±Í”°É¥¡Ðè™…±Í”°Ñ½Àè™…±Í”°‰½ÑÑ½´è™…±Í”ô¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐÀ€ôÁ…¹I•˜¹ÕÉÉ•¹Ðì(€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€½¹ÍÐ•°€ô½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹Ðì(€€€¥˜€ …Àñð€…•°¤É•ÑÕÉ¸ì(€€€€¼¼ƒššŸšîG¢†3¾ò3¢ºOš&/šš:—¢þG–:žRš6Ë–.T(€€€±•ÐØ€ô5…Ñ ¹µ…à ´Ð°5…Ñ ¹µ¥¸ Ð°À¹Ø¤¤ì(€€€¥˜€¡5…Ñ ¹…‰Ì¡Ø¤€ð€À¸ÀÔ¤É•ÑÕÉ¸ì(€€€±•Ð±…ÍÐ€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€€€½¹ÍÐÍÑ•À€ô€ ¤€ôøì(€€€€€½¹ÍÐ¹½Ü€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€€€€€½¹ÍÐ‘Ð€ô5…Ñ ¹µ¥¸ ÌÈ°¹½Ü€´±…ÍÐ¤ì(€€€€€±…ÍÐ€ô¹½Üì(€€€€€•°¹ÍÉ½±±1•™Ð€¬ôØ€¨‘Ðì(€€€€€Á½Í¥Ñ¥½¹A…•Ñ±Ì ¤ì(€€€€€Ø€¨ô5…Ñ ¹Á½Ü À¸äÔ°‘Ð€¼€ÄØ¤ì(€€€€€¥˜€¡5…Ñ ¹…‰Ì¡Ø¤€ð€À¸ÀÈñð•°¹ÍÉ½±±1•™Ð€ðô€Àñð•°¹ÍÉ½±±1•™Ð€øô•°¹ÍÉ½±±]¥‘Ñ €´•°¹±¥•¹Ñ]¥‘Ñ ¤ì(€€€€€€€¥¹•ÉÑ¥…I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€¥¹•ÉÑ¥…I•˜¹ÕÉÉ•¹Ð€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡ÍÑ•À¤ì(€€€ôì(€€€¥¹•ÉÑ¥…I•˜¹ÕÉÉ•¹Ð€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡ÍÑ•À¤ì(€ôì((€€¼¨I•…Ðƒžj½¹Q½Õ¡¹ƒ–r M…™…É¤ƒ¦7–îë–B#š"C–Æžj–B3’â–âŸ–Û–ÂSšRÛ’â7–"ÃŽžR Ý¥¹‘½Üƒš6W¢:Ü(€€€€ƒšr–B;’âš‚çš&/š2žšï–òžj’ê/’îÛ¾ò3–æÛ–îÛ–B;–"Ãšr³¢ö»’ê/’îÛžîOšv–B;šŽš~—¾òoš¶–âãšRÛ–Âû–ÞËš&Ÿ¢†3š^Û¢þd(€€€€ƒšb¿š^ƒšN7’ös¾ò3šò?š:'š^Û–"gžî’âšâš:'š&šr'’òk¦jC¢^?–’[š†¾ò?¢6¿’âãžjš^_š‚’â;š&/–*ÿ–òWžR£Ž€¨¼(€ÕÍ•™™•Ð  ¤€ôøì(€€€±•ÐÑ¥µ•È€ô€Àì(€€€½¹ÍÐÉ•ÍÑ½É•¡É½µ”€ô€ ¤€ôøì(€€€€€Ý¥¹‘½Ü¹±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•È¤ì(€€€€€Ñ¥µ•È€ôÝ¥¹‘½Ü¹Í•ÑQ¥µ•½ÕÐ  ¤€ôøì(€€€€€€€™±ÕÍ¡%¹Ñ•É…Ñ¥½¹9½Ü ¤ì(€€€€€€€Í•ÑM•±•Ñ¥½¹É…¥¹œ¡™…±Í”¤ì(€€€€€€€Í•ÑA¥¹¡±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤ì(€€€€€€€Í•ÑÑ¥Ù•½±±¥Í¥½¹Ì¡ì±•™Ðè™…±Í”°É¥¡Ðè™…±Í”°Ñ½Àè™…±Í”°‰½ÑÑ½´è™…±Í”ô¤ì(€€€€€€€ÝÍ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€±…å½ÕÑ•ÍÑÕÉ•I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€±…å½ÕÑ•ÍÑÕÉ•%‘I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€ÝÍ•ÍÑÕÉ•1…å½ÕÑ%‘I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€±…å½ÕÑ½É¹•ÉI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹¥ÍÉ…¥¹½¹Ñ•¹Ð€ô™…±Í”ì(€€€€€€€Á½¥¹Ñ•ÉMÑ…Ñ”¹ÕÉÉ•¹Ð¹Á½¥¹Ñ•É%€ô€´Äì(€€€€€€€Á…¹I•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€Á…¹5½Ù•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€€€¥˜€¡…¹Ù…Íi½½µI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€…¹Ù…Íi½½µI•˜¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€€€…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä¡ÕÍ•Éi½½µI•˜¹ÕÉÉ•¹Ð°™…±Í”¤ì(€€€€€€€€€Í•ÑUÍ•Éi½½´¡ÕÍ•Éi½½µI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€ô(€€€€€ô°€À¤ì(€€€ôì(€€€½¹ÍÐ™¥¹¥Í¡Q½Õ €ô€¡”èQ½Õ¡Ù•¹Ð¤€ôøì¥˜€¡”¹Ñ½Õ¡•Ì¹±•¹Ñ €ôôô€À¤É•ÍÑ½É•¡É½µ” ¤ìôì(€€€½¹ÍÐ™¥¹¥Í¡Y¥Í¥‰¥±¥Ñä€ô€ ¤€ôøì¥˜€¡‘½Õµ•¹Ð¹Ù¥Í¥‰¥±¥ÑåMÑ…Ñ”€„ôô€Ù¥Í¥‰±”œ¤É•ÍÑ½É•¡É½µ” ¤ìôì(€€€€¼¨A½¥¹Ñ•ÈÙ•¹ÑÌƒ’â8Q½Õ Ù•¹ÑÌƒ–r£’â7–B0¥=O¾ò=]•‰Y¥•Üƒž&#šr³’â7’â–ºk–B3š^Û¦¢úûŽ(€€€€€€ƒ¢ºÃ–öW’î7š2'žvžjÁ½¥¹Ñ•Ë¾ò3šr–B;’âš‚çžšï–òš^Ûš&7š‹–’7¾ò3¦ÿ–7–>3š2žò§šRû–#šRû–ò’âš‚ç–ÂÇ¦^«š†Ž€¨¼(€€€½¹ÍÐ…Ñ¥Ù•A½¥¹Ñ•ÉÌ€ô¹•ÜM•Ðñ¹Õµ‰•Èø ¤ì(€€€½¹ÍÐÁ½¥¹Ñ•É½Ý¸€ô€¡”èA½¥¹Ñ•ÉÙ•¹Ð¤€ôøì…Ñ¥Ù•A½¥¹Ñ•ÉÌ¹…‘¡”¹Á½¥¹Ñ•É%¤ìôì(€€€½¹ÍÐÁ½¥¹Ñ•É¥¹¥Í €ô€¡”èA½¥¹Ñ•ÉÙ•¹Ð¤€ôøì(€€€€€…Ñ¥Ù•A½¥¹Ñ•ÉÌ¹‘•±•Ñ”¡”¹Á½¥¹Ñ•É%¤ì(€€€€€¥˜€¡…Ñ¥Ù•A½¥¹Ñ•ÉÌ¹Í¥é”€ôôô€À¤É•ÍÑ½É•¡É½µ” ¤ì(€€€ôì(€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Á½¥¹Ñ•É‘½Ý¸œ°Á½¥¹Ñ•É½Ý¸°ÑÉÕ”¤ì(€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Á½¥¹Ñ•ÉÕÀœ°Á½¥¹Ñ•É¥¹¥Í °ÑÉÕ”¤ì(€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Á½¥¹Ñ•É…¹•°œ°Á½¥¹Ñ•É¥¹¥Í °ÑÉÕ”¤ì(€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Ñ½Õ¡•¹œ°™¥¹¥Í¡Q½Õ °ÑÉÕ”¤ì(€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Ñ½Õ¡…¹•°œ°™¥¹¥Í¡Q½Õ °ÑÉÕ”¤ì(€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±ÕÈœ°É•ÍÑ½É•¡É½µ”¤ì(€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Á…•¡¥‘”œ°É•ÍÑ½É•¡É½µ”¤ì(€€€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Ù¥Í¥‰¥±¥Ñå¡…¹”œ°™¥¹¥Í¡Y¥Í¥‰¥±¥Ñä¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€Ý¥¹‘½Ü¹±•…ÉQ¥µ•½ÕÐ¡Ñ¥µ•È¤ì(€€€€€Ý¥¹‘½Ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È Á½¥¹Ñ•É‘½Ý¸œ°Á½¥¹Ñ•É½Ý¸°ÑÉÕ”¤ì(€€€€€Ý¥¹‘½Ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È Á½¥¹Ñ•ÉÕÀœ°Á½¥¹Ñ•É¥¹¥Í °ÑÉÕ”¤ì(€€€€€Ý¥¹‘½Ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È Á½¥¹Ñ•É…¹•°œ°Á½¥¹Ñ•É¥¹¥Í °ÑÉÕ”¤ì(€€€€€Ý¥¹‘½Ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È Ñ½Õ¡•¹œ°™¥¹¥Í¡Q½Õ °ÑÉÕ”¤ì(€€€€€Ý¥¹‘½Ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È Ñ½Õ¡…¹•°œ°™¥¹¥Í¡Q½Õ °ÑÉÕ”¤ì(€€€€€Ý¥¹‘½Ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ‰±ÕÈœ°É•ÍÑ½É•¡É½µ”¤ì(€€€€€Ý¥¹‘½Ü¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È Á…•¡¥‘”œ°É•ÍÑ½É•¡É½µ”¤ì(€€€€€‘½Õµ•¹Ð¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È Ù¥Í¥‰¥±¥Ñå¡…¹”œ°™¥¹¥Í¡Y¥Í¥‰¥±¥Ñä¤ì(€€€ôì(€ô°m…ÁÁ±åMÑÉ¥Á•½µ•ÑÉä°™±ÕÍ¡%¹Ñ•É…Ñ¥½¹9½Ýt¤ì((€½¹ÍÐ¡…¹‘±••±•Ñ•1…å½ÕÐ€ô€ ¤€ôøì(€€€Í•ÑA…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡À€ôøÀ¹±…å½ÕÑÌ¹Í½µ”¡°€ôø°¹¥€ôôôÍ•±•Ñ•‘1…å½ÕÑ%¤(€€€€€€üì€¸¸¹À°±…å½ÕÑÌèÀ¹±…å½ÕÑÌ¹™¥±Ñ•È¡°€ôø°¹¥€„ôôÍ•±•Ñ•‘1…å½ÕÑ%¤ô(€€€€€€èÀ¤¤ì(€€€Í•ÑM•±•Ñ•‘1…å½ÕÑ%¡¹Õ±°¤ì(€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€ôì((€½¹ÍÐ¡…¹‘±•I½Ñ…Ñ•%µ…”€ô€¡¥¹‘•àè¹Õµ‰•È¤€ôøì(€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡¥µœ°¥‘à¤€ôøì(€€€€€¥˜€¡¥‘à€„ôô¥¹‘•à¤É•ÑÕÉ¸¥µœì(€€€€€É•ÑÕÉ¸ì€¸¸¹¥µœ°É½Ñ…Ñ¥½¸è€¡¥µœ¹É½Ñ…Ñ¥½¸€¬€äÀ¤€”€ÌØÀôì(€€€ô¤¤ì(€ôì((€½¹ÍÐ¡…¹‘±•MÝ…Á1•™Ð€ô€¡¥¹‘•àè¹Õµ‰•È¤€ôøì(€€€¥˜€¡¥¹‘•à€ôôô€À¤É•ÑÕÉ¸ì(€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€½¹ÍÐ¹•áÐ€ôl¸¸¹ÁÉ•Ùtì(€€€€€½¹ÍÐÑµÀ€ô¹•áÑm¥¹‘•átì(€€€€€¹•áÑm¥¹‘•át€ô¹•áÑm¥¹‘•à€´€Åtì(€€€€€¹•áÑm¥¹‘•à€´€Åt€ôÑµÀì(€€€€€É•ÑÕÉ¸¹•áÐì(€€€ô¤ì(€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¥¹‘•à€´€Ä¤ì(€ôì((€½¹ÍÐ¡…¹‘±•MÝ…ÁI¥¡Ð€ô€¡¥¹‘•àè¹Õµ‰•È¤€ôøì(€€€¥˜€¡¥¹‘•à€ôôô¥µ…•Ì¹±•¹Ñ €´€Ä¤É•ÑÕÉ¸ì(€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€½¹ÍÐ¹•áÐ€ôl¸¸¹ÁÉ•Ùtì(€€€€€½¹ÍÐÑµÀ€ô¹•áÑm¥¹‘•átì(€€€€€¹•áÑm¥¹‘•át€ô¹•áÑm¥¹‘•à€¬€Åtì(€€€€€¹•áÑm¥¹‘•à€¬€Åt€ôÑµÀì(€€€€€É•ÑÕÉ¸¹•áÐì(€€€ô¤ì(€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¥¹‘•à€¬€Ä¤ì(€ôì((€½¹ÍÐÕÉÉ•¹ÑQ•µÁ±…Ñ•Ì€ôQ5A1Q}5Am¥µ…•Ì¹±•¹Ñ¡tñðmtì(€½¹ÍÐ…Ñ¥Ù•Q•µÁ±…Ñ”€ôÕÉÉ•¹ÑQ•µÁ±…Ñ•ÍmÑ•µÁ±…Ñ•%¹‘•átñðÕÉÉ•¹ÑQ•µÁ±…Ñ•ÍlÁtñðì¹…µ”è€Ÿ¦‚C¢¢´œ°É•ÑÌèmtôì((€½¹ÍÐ…±±Q•µÁ±…Ñ•Í±…ÑÑ•¹•èì½Õ¹Ðè¹Õµ‰•È°¥‘àè¹Õµ‰•È°ÑµÁ°è…¹ä°¥ÍÕÉÉ•¹Ñ½Õ¹Ðè‰½½±•…¸õmt€ômtì(€½¹ÍÐ€ô±…å½ÕÑM½ÉÑ	…Í”ì(€½¹ÍÐ…Ù…¥±…‰±•½Õ¹ÑÌ€ôlÌ°€Ä°€È°€Ð°€Ô°€Ø°€Ü°€à°€ä°€ÄÁt¹™¥±Ñ•È¡Œ€ôøŒ€„ôô€Äñð…±±½ÝM¥¹±•1…å½ÕÐ¤ì(€€(€½¹ÍÐ½É‘•É•‘½Õ¹ÑÌ€ô…Ù…¥±…‰±•½Õ¹ÑÌì((€½É‘•É•‘½Õ¹ÑÌ¹™½É… ¡½Õ¹Ð€ôøì(€€€¥˜€¡Q5A1Q}5Am½Õ¹Ñt¤ì(€€€€€Q5A1Q}5Am½Õ¹Ñt¹™½É…  ¡ÑµÁ°°¥‘à¤€ôøì(€€€€€€€…±±Q•µÁ±…Ñ•Í±…ÑÑ•¹•¹ÁÕÍ ¡ì½Õ¹Ð°¥‘à°ÑµÁ°°¥ÍÕÉÉ•¹Ñ½Õ¹Ðè½Õ¹Ð€ôôô¥µ…•Ì¹±•¹Ñ ô¤ì(€€€€€ô¤ì(€€€ô(€ô¤ì((€€¼¨¨ƒ–2¿–ëšf–B3’â–ò×–r[–>¿¢÷¢šžV¯–r£––÷–æû¦‚’â+¾ò3¢ò'’âš²‡–ÂÇ––÷Ž€¨¼(€½¹ÍÐ•áÁ½ÉÑ%µ…¡”€ôÕÍ•I•˜ñ5…ÀñÍÑÉ¥¹œ°!Q51%µ…•±•µ•¹Ðð¹Õ±°øø¡¹•Ü5…À ¤¤ì(€€¼¨¨(€€€¨ƒ–2¿–ë–öÇž&–r[–Æ“šfžR£žj’úšêC¾òkžnÓš:—š.ÿ¦‚C¢š÷–r£šJ·žj¦
–,Ù¥‘•¼ƒ–žÒƒ¾ò0(€€€¨ƒš&’î—–¶c–ë’úžj–ÂÇšb¿žV¯¦v‹’â+žr/–"Ãžj¦
’âš‚óŽ(€€€¨¼(€½¹ÍÐ±½…‘áÁ½ÉÑY¥‘•¼€ô€¡ÕÉ°èÍÑÉ¥¹œ¤€ôø¹•ÜAÉ½µ¥Í”ñ!Q51Y¥‘•½±•µ•¹Ðð¹Õ±°ø ¡É•Í½±Ù”¤€ôøì(€€€½¹ÍÐØ€ô•ÑAÉ•Ù¥•ÝY¥‘•¼¡ÕÉ°¤ì(€€€¥˜€¡Ø¹É•…‘åMÑ…Ñ”€øô€È¤É•ÑÕÉ¸É•Í½±Ù”¡Ø¤ì(€€€½¹ÍÐ½¸€ô€ ¤€ôøìØ¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ±½…‘•‘‘…Ñ„œ°½¸¤ìÉ•Í½±Ù”¡Ø¹É•…‘åMÑ…Ñ”€øô€È€üØ€è¹Õ±°¤ìôì(€€€Ø¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±½…‘•‘‘…Ñ„œ°½¸¤ì(€€€Í•ÑQ¥µ•½ÕÐ¡½¸°€ÌÀÀÀ¤ì(€ô¤ì((€½¹ÍÐ±½…‘áÁ½ÉÑ%µ…”€ô€¡ÕÉ°èÍÑÉ¥¹œ¤€ôøì(€€€½¹ÍÐ…¡”€ô•áÁ½ÉÑ%µ…¡”¹ÕÉÉ•¹Ðì(€€€¥˜€¡…¡”¹¡…Ì¡ÕÉ°¤¤É•ÑÕÉ¸AÉ½µ¥Í”¹É•Í½±Ù”¡…¡”¹•Ð¡ÕÉ°¤„¤ì(€€€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í”ñ!Q51%µ…•±•µ•¹Ðð¹Õ±°ø ¡É•Í½±Ù”¤€ôøì(€€€€€½¹ÍÐ¤€ô¹•Ü%µ…” ¤ì(€€€€€¤¹½¹±½…€ô€ ¤€ôøì…¡”¹Í•Ð¡ÕÉ°°¤¤ìÉ•Í½±Ù”¡¤¤ìôì(€€€€€¤¹½¹•ÉÉ½È€ô€ ¤€ôøì…¡”¹Í•Ð¡ÕÉ°°¹Õ±°¤ìÉ•Í½±Ù”¡¹Õ±°¤ìôì(€€€€€¤¹ÍÉŒ€ôÕÉ°ì(€€€ô¤ì(€ôì((€€¼¨¨(€€€¨ƒ–2¿–ëšfš*+šZ–¶_–r[–Æ“žV¯’â+–:ïŽ–¶_žÒkŽ–¶_¢ÞwŽ¢†3¦®cŽš>o¢†3¢š?–&¦÷¢Þ¦‚C¢š÷–B3’â––_¾ò0(€€€¨ƒ’ö7žö»š&7šr¢B÷–r£’âš¢žj–rÃšZçŽ(€€€¨¼(€½¹ÍÐ‘É…ÝQ•áÑ1…å•È€ô…Íå¹Œ€ (€€€Ñàè…¹Ù…ÍI•¹‘•É¥¹½¹Ñ•áÐÉ°(€€€™%µœè±½…Ñ¥¹%µ…”°(€€€Í…±•…Ñ½Èè¹Õµ‰•È°(€€€µ½Ñ¥½¹É…µ”üè=‰©•Ñ5½Ñ¥½¹É…µ”ð¹Õ±°°(€€¤€ôøì(€€€½¹ÍÐ™…µ¥±ä€ô™%µœ¹™½¹Ñ…µ¥±äñðU1Q}=9Pì(€€€…Ý…¥ÐÝ…¥Ñ½É½¹Ð¡™…µ¥±ä°™%µœ¹‰½±€ü€ÜÀÀ€è€ÐÀÀ°€„…™%µœ¹¥Ñ…±¥Œ¤ì((€€€½¹ÍÐ…‘©ÕÍÑ•‘`€ô™%µœ¹à€´5…Ñ ¹™±½½È¡™%µœ¹à€¼€¡ÁÉ•Ù¥•Ý\€¬€Ä¤¤ì(€€€½¹ÍÐ™Ü€ô™%µœ¹Ý¥‘Ñ €¨Í…±•…Ñ½Èì(€€€½¹ÍÐ™ €ô™%µœ¹¡•¥¡Ð€¨Í…±•…Ñ½Èì(€€€½¹ÍÐà€ô…‘©ÕÍÑ•‘`€¨Í…±•…Ñ½È€¬™Ü€¼€Èì(€€€½¹ÍÐä€ô™%µœ¹ä€¨Í…±•…Ñ½È€¬™ €¼€Èì(€€€½¹ÍÐÍ¥é”€ô€¡™%µœ¹™½¹ÑM¥é”ñð€ÐÀ¤€¨Í…±•…Ñ½È€¨™%µœ¹Í…±”ì(€€€½¹ÍÐÍÁ…¥¹œ€ô€¡™%µœ¹±•ÑÑ•ÉMÁ…¥¹œñð€À¤€¨Í…±•…Ñ½È€¨™%µœ¹Í…±”ì(€€€Ñà¹Í…Ù” ¤ì(€€€Ñà¹±½‰…±±Á¡„€¨ô€¡™%µœ¹½Á…¥Ñä€üü€ÄÀÀ¤€¼€ÄÀÀì(€€€Ñà¹ÑÉ…¹Í±…Ñ”¡à°ä¤ì(€€€Ñà¹É½Ñ…Ñ” ¡™%µœ¹É½Ñ…Ñ¥½¸€¨5…Ñ ¹A$¤€¼€ÄàÀ¤ì(€€€Ñà¹™½¹Ð€ô€‘í™%µœ¹¥Ñ…±¥Œ€ü€¥Ñ…±¥Œ€œ€è€œô‘í™%µœ¹‰½±€ü€ÜÀÀ€è€ÐÀÁô€‘íÍ¥é•õÁà€‘í™½¹ÑMÑ…¬¡™…µ¥±ä¥õ€ì(€€€Ñà¹Ñ•áÑ±¥¸€ô€•¹Ñ•Èœì(€€€Ñà¹Ñ•áÑ	…Í•±¥¹”€ô€µ¥‘‘±”œì(€€€€¡Ñà…Ì…¹ä¤¹±•ÑÑ•ÉMÁ…¥¹œ€ô€‘íÍÁ…¥¹õÁá€ì((€€€€¼¼ƒ¢"¦‚C¢š÷žnã–B3žjšZß¢†3¾òk–>«–r£’öÿžR£¢¢«–ÞÇš2'žjš>o¢†3¢fWšZß¾ò3’â7–7’úw–¾³–ê›¢«–.Wš>o¢†0(€€€½¹ÍÐ±¥¹•ÌèÍÑÉ¥¹mt€ô€¡™%µœ¹Ñ•áÐñð€œœ¤¹ÍÁ±¥Ð q¸œ¤ì(€€€½¹ÍÐ±¥¹• €ôÍ¥é”€¨€Ä¸ÄÈì(€€€½¹ÍÐÍÑ…ÉÑd€ô€´ ¡±¥¹•Ì¹±•¹Ñ €´€Ä¤€¨±¥¹• ¤€¼€Èì((€€€½¹ÍÐÍåµ%¹¬€ô™%µœ¹Íå´€üµ•…ÍÕÉ•Måµ‰½±%¹¬¡™%µœ¹Ñ•áÐñð™%µœ¹Íå´°™…µ¥±ä¤€è¹Õ±°ì(€€€½¹ÍÐÍåµà€ôÍåµ%¹¬€ü€µÍåµ%¹¬¹à€¨Í¥é”€è€Àì(€€€½¹ÍÐÍåµä€ôÍåµ%¹¬€ü€µÍåµ%¹¬¹ä€¨Í¥é”€è€Àì(€€€½¹ÍÐÕ¹¥Ñ5½Ñ¥½¸€ô™%µœ¹Íå´€˜˜±¥¹•Ì¹±•¹Ñ €ôôô€Ä€˜˜µ½Ñ¥½¹É…µ”(€€€€€€˜˜€¡µ½Ñ¥½¹É…µ”¹Í•Ä€„ôôÕ¹‘•™¥¹•ñð€¡™%µœ¹µ¼ü¹¥‘±”€ôôô€Íåµ‰½°µ‰É•…Ñ¡”Èœ€˜˜µ½Ñ¥½¹É…µ”¹¥‘±•P€„ôôÕ¹‘•™¥¹•¤¤ì(€€€½¹ÍÐ‘É…Ý¹¥µ…Ñ•€ô€¡ÍÑÉ½­”€ô™…±Í”¤€ôøì(€€€€€¥˜€ …Õ¹¥Ñ5½Ñ¥½¸¤ì(€€€€€€€±¥¹•Ì¹™½É…  ¡±¸°¤¤€ôøÍÑÉ½­”(€€€€€€€€€€üÑà¹ÍÑÉ½­•Q•áÐ¡±¸°Íåµà°ÍÑ…ÉÑd€¬¤€¨±¥¹• €¬Íåµä¤(€€€€€€€€€€èÑà¹™¥±±Q•áÐ¡±¸°Íåµà°ÍÑ…ÉÑd€¬¤€¨±¥¹• €¬Íåµä¤¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€½¹ÍÐÉ…ÍÑ•È€ôÉ…ÍÑ•É¥é•Måµ‰½±¹¥µ…Ñ¥½¹1…å•ÉÌ (€€€€€€€™%µœ¹Ñ•áÐñð€œœ°™…µ¥±ä°Í¥é”°ÍÑÉ½­”€ü€ÍÑÉ½­”œ€è€™¥±°œ°(€€€€€€€ÍÑÉ½­”€ü€¡™%µœ¹ÍÑÉ½­•½±½Èñð€œŒÀÀÀÀÀÀœ¤€è€¡™%µœ¹½±½Èñð€œœ¤°(€€€€€€€ÍÑÉ½­”€ü€¡™%µœ¹ÍÑÉ½­•]¥‘Ñ ñð€À¤€¨€È€¨Í…±•…Ñ½È€¨™%µœ¹Í…±”€è€À°(€€€€€€€5…Ñ ¹µ…à È°5…Ñ ¹µ¥¸ Ô°Ý¥¹‘½Ü¹‘•Ù¥•A¥á•±I…Ñ¥¼ñð€Ä¤¤°(€€€€€€¤ì(€€€€€¥˜€ …É…ÍÑ•È¤É•ÑÕÉ¸ì(€€€€€½¹ÍÐ½Õ¹Ð€ôÉ…ÍÑ•È¹±…å•ÉÌ¹±•¹Ñ ì(€€€€€½¹ÍÐ‰Õ‰‰±•MÁ…¸€ô€Ä€¬5…Ñ ¹µ…à À°½Õ¹Ð€´€Ä¤€¨€¸Èì(€€€€€É…ÍÑ•È¹±…å•ÉÌ¹™½É…  ¡±…å•È°¥¹‘•à¤€ôøì(€€€€€€€½¹ÍÐÄ€ôµ½Ñ¥½¹É…µ”ü¹Í•Ä€ôôôÕ¹‘•™¥¹•€ü€Ä(€€€€€€€€€€è5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Ä°µ½Ñ¥½¹É…µ”¹Í•Ä€¨‰Õ‰‰±•MÁ…¸€´¥¹‘•à€¨€¸È¤¤ì(€€€€€€€¥˜€¡µ½Ñ¥½¹É…µ”ü¹Í•Ä€„ôôÕ¹‘•™¥¹•€˜˜Ä€ðô€¸ÀÀÄ¤É•ÑÕÉ¸ì(€€€€€€€½¹ÍÐŒÄ€ô€Ä¸ÜÀÄÔà°ŒÌ€ôŒÄ€¬€Ä°è€ôÄ€´€Äì(€€€€€€€½¹ÍÐÁ½ÁM…±”€ô€Ä€¬ŒÌ€¨è€¨è€¨è€¬ŒÄ€¨è€¨èì(€€€€€€€½¹ÍÐÕ¹¥ÑM…±”€ô™%µœ¹µ¼ü¹¥‘±”€ôôô€Íåµ‰½°µ‰É•…Ñ¡”Èœ€˜˜µ½Ñ¥½¹É…µ”ü¹¥‘±•P€„ôôÕ¹‘•™¥¹•(€€€€€€€€€€ü€Ä€¬€¡Íåµ‰½±	É•…Ñ¡•M…±”¡¥¹‘•à°µ½Ñ¥½¹É…µ”¹¥‘±•P°™%µœ¹µ¼¹…µÀ°™%µœ¹µ¼¹ÍÁ••¤€´€Ä¤(€€€€€€€€€€€€€€¨€¡µ½Ñ¥½¹É…µ”¹Ý…Ù•5¥à€üü€Ä¤(€€€€€€€€€€èÁ½ÁM…±”ì(€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€¥˜€¡µ½Ñ¥½¹É…µ”ü¹Í•Ä€„ôôÕ¹‘•™¥¹•¤Ñà¹±½‰…±±Á¡„€¨ô5…Ñ ¹µ¥¸ Ä°Ä€¨€Ì¤ì(€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ”¡Íåµà€¬±…å•È¹Á¥Ù½Ñ`°Íåµä€¬±…å•È¹Á¥Ù½Ñd¤ì(€€€€€€€Ñà¹Í…±”¡Õ¹¥ÑM…±”°Õ¹¥ÑM…±”¤ì(€€€€€€€Ñà¹‘É…Ý%µ…”¡±…å•È¹…¹Ù…Ì°±…å•È¹à€´±…å•È¹Á¥Ù½Ñ`°±…å•È¹ä€´±…å•È¹Á¥Ù½Ñd°±…å•È¹Ü°±…å•È¹ ¤ì(€€€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€ô¤ì(€€€ôì(€€€½¹ÍÐ‘É…Ý1¥¹•Ì€ô€ ¤€ôø‘É…Ý¹¥µ…Ñ•¡™…±Í”¤ì(€€€¥˜€¡™%µœ¹±½Ü¤ì(€€€€€Ñà¹Í¡…‘½Ý½±½È€ô™%µœ¹±½Ý½±½Èñð€œœì(€€€€€Ñà¹™¥±±MÑå±”€ô™%µœ¹½±½Èñð€œœì(€€€€€€¼¨ƒ–>«žR£–†¯¢&Ëžj–¶_–ö‹š*W–öÇ¾ò3–º3–£’â7žŠÃš>?¦
(ƒŠSŠPƒ¢Þ¦‚C¢š÷žjžfó–'–Æ“’âš¢Ž(€€€€€€€€ƒ¦g¢Ž‡–ššzs– ÍÑÉ½­•Q•áÓ¾ò3–'–ÂÇšr–ú{š>?¦
+žj–’[žÞšV–ë–:ï¾ò3ž¶'šZóš*+š>?¦
((€€€€€€€€ƒžº_¦Ëžfó–'¢Ž‡¾òožfó–'¢"š>?¦
+¢š–B¢«ž6£ž®/¾ò3š&’î—¦g’âšº×’â7š>?¦
+Ž€¨¼(€€€€€€¼¼ƒžZ+’â'–Æ“¾ò3¢Þ¦‚C¢š÷¦
’â–Æ“žj’â'šºÔÑ•áÐµÍ¡…‘½Üƒ–Â7¦ö((€€€€€™½È€¡½¹ÍÐ¬½˜lÄ°€È°€Ít¤ì(€€€€€€€Ñà¹Í¡…‘½Ý	±ÕÈ€ô€¡5…Ñ ¹µ¥¸ ÄÈ°™%µœ¹±½Ü¤€¼€ÈÀ¤€¨€ÄÐ€¨¬€¨Í…±•…Ñ½È€¨™%µœ¹Í…±”ì(€€€€€€€‘É…Ý1¥¹•Ì ¤ì(€€€€€ô(€€€€€Ñà¹Í¡…‘½Ý	±ÕÈ€ô€Àì(€€€€€Ñà¹Í¡…‘½Ý½±½È€ô€ÑÉ…¹ÍÁ…É•¹Ðœì(€€€ô(€€€€¼¼ƒš>?¦
+–#žV¯¾ò#–¾³–ê›–*ƒ–7¾ò'¾ò3–†¯¢&Ë–7¢N/’â+–:ìƒŠSŠPƒ–>«–&§–’[–r7žj’â–r#¾ò0(€€€€¼¼ƒ¢Þ¦‚C¢š÷žjÁ…¥¹Ðµ½É‘•ÈèÍÑÉ½­”™¥±°ƒ–B3’â––_¦
?¢ò¼(€€€¥˜€¡™%µœ¹ÍÑÉ½­•]¥‘Ñ ¤ì(€€€€€Ñà¹±¥¹•]¥‘Ñ €ô™%µœ¹ÍÑÉ½­•]¥‘Ñ €¨€È€¨Í…±•…Ñ½È€¨™%µœ¹Í…±”ì(€€€€€Ñà¹±¥¹•)½¥¸€ô€É½Õ¹œì(€€€€€Ñà¹µ¥Ñ•É1¥µ¥Ð€ô€Èì(€€€€€Ñà¹ÍÑÉ½­•MÑå±”€ô™%µœ¹ÍÑÉ½­•½±½Èñð€œŒÀÀÀÀÀÀœì(€€€€€‘É…Ý¹¥µ…Ñ•¡ÑÉÕ”¤ì(€€€ô(€€€Ñà¹™¥±±MÑå±”€ô™%µœ¹½±½Èñð€œœì(€€€‘É…Ý1¥¹•Ì ¤ì(€€€Ñà¹É•ÍÑ½É” ¤ì(€ôì((€€¼¨¨(€€€¨ƒ–2¿–ëšfš*+–r[–ö‹–r[–Æ“žV¯’â+–:ïŽ(€€€¨ƒ¢Þ¿–úG¢Þ¦‚C¢š÷šb¿–B3’âšR¼Í¡…Á•A…Ñ¡Ž–B3’âšŠtƒ–¶_’âË¾ò3žÞk–¾³’æšb¿–B3’âšR¼Í¡…Á•1¥¹•]¥‘Ñ ƒŠSŠP(€€€¨ƒžV¯–â’â+žr/–"Ãžj¢Þ–¶c’â/’úžj’â7–>¿¢÷¦Vß–ú_’â7’âš¢Ž(€€€¨¼(€½¹ÍÐ‘É…ÝM¡…Á•1…å•È€ô€ (€€€Ñàè…¹Ù…ÍI•¹‘•É¥¹½¹Ñ•áÐÉ°(€€€™%µœè±½…Ñ¥¹%µ…”°(€€€Í…±•…Ñ½Èè¹Õµ‰•È°(€€€…±Á¡…±…ÑÑ•¹•€ô™…±Í”°(€€¤€ôøì(€€€€¼¼ƒš&š:'¦‚C¢š÷¢Ž‡š¾?¦‚’æ/¦ZO¦
Œ€ÅÁàƒžj¦ZO¦jS¾ò#¢Þ–r[ž&–B3’â––_¾ò$(€€€½¹ÍÐ…‘©ÕÍÑ•‘`€ô™%µœ¹à€´5…Ñ ¹™±½½È¡™%µœ¹à€¼€¡ÁÉ•Ù¥•Ý\€¬€Ä¤¤ì(€€€½¹ÍÐ™à€ô…‘©ÕÍÑ•‘`€¨Í…±•…Ñ½Èì(€€€½¹ÍÐ™ä€ô™%µœ¹ä€¨Í…±•…Ñ½Èì(€€€½¹ÍÐ™Ü€ô™%µœ¹Ý¥‘Ñ €¨Í…±•…Ñ½Èì(€€€½¹ÍÐ™ €ô™%µœ¹¡•¥¡Ð€¨Í…±•…Ñ½Èì((€€€€¼¨ƒ–2¿–ë’æ–þ¦‚#¢Þ¦‚C¢š÷’âš¢¾ò3–#š*+šr³¦®SŽžÒ/žBŽ–’[š>?¦
+¢"žfó–'–B#š"Cš"C’â–ò×¾ò0(€€€€€€ƒ–7–Â7žÖCšzs–>«––_’âš²‡¦?šb;–ê›ŽžnÓš:—–r£’âì…¹Ù…Ìƒ’â+¦C–Æ“––\…±Á¡‡¾ò3–6+¦?šb;šf(€€€€€€ƒ¦7žZ+¢fWšr¢º+šÞÇ¾ò3¦
–>¿¢÷¦†¿–ëžfó–'šj¯–¶c–Æ“žjž~§–ö‹¦
+žÞŽ–>«–îëž®/ž&§’îÛ¦f¢þGžj(€€€€€€ƒ–Â?žV¯–â¾ò3¦ÿ–4¥A¡½¹”ƒ–2¿–ë¦®c¢žšzC–r[ž&šf–’k¦7žö»’â–ò×–º3šVÓ–’ŸžV¯–âŽ€¨¼(€€€½¹ÍÐÍ¡…Á•±Á¡„€ô5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Ä°€¡™%µœ¹½Á…¥Ñä€üü€ÄÀÀ¤€¼€ÄÀÀ¤¤ì(€€€¥˜€ ……±Á¡…±…ÑÑ•¹•€˜˜Í¡…Á•±Á¡„€ð€¸äää¤ì(€€€€€½¹ÍÐÍ…±•‘\€ô™Ü€¨5…Ñ ¹µ…à ¸ÀÄ°™%µœ¹Í…±”ñð€Ä¤ì(€€€€€½¹ÍÐÍ…±•‘ €ô™ €¨5…Ñ ¹µ…à ¸ÀÄ°™%µœ¹Í…±”ñð€Ä¤ì(€€€€€½¹ÍÐÉÈ€ô€¡™%µœ¹É½Ñ…Ñ¥½¸ñð€À¤€¨5…Ñ ¹A$€¼€ÄàÀì(€€€€€½¹ÍÐ……‰‰\€ô5…Ñ ¹…‰Ì¡5…Ñ ¹½Ì¡ÉÈ¤¤€¨Í…±•‘\€¬5…Ñ ¹…‰Ì¡5…Ñ ¹Í¥¸¡ÉÈ¤¤€¨Í…±•‘ ì(€€€€€½¹ÍÐ……‰‰ €ô5…Ñ ¹…‰Ì¡5…Ñ ¹Í¥¸¡ÉÈ¤¤€¨Í…±•‘\€¬5…Ñ ¹…‰Ì¡5…Ñ ¹½Ì¡ÉÈ¤¤€¨Í…±•‘ ì(€€€€€½¹ÍÐÁ…€ô5…Ñ ¹µ…à ÈÐ€¨Í…±•…Ñ½È°5…Ñ ¹µ…à¡Í…±•‘\°Í…±•‘ ¤€¨€¸ÜÔ¤ì(€€€€€½¹ÍÐà€ô™à€¬™Ü€¼€È°ä€ô™ä€¬™ €¼€Èì(€€€€€½¹ÍÐ±•™Ð€ô5…Ñ ¹™±½½È¡5…Ñ ¹µ…à À°à€´……‰‰\€¼€È€´Á…¤¤ì(€€€€€½¹ÍÐÑ½À€ô5…Ñ ¹™±½½È¡5…Ñ ¹µ…à À°ä€´……‰‰ €¼€È€´Á…¤¤ì(€€€€€½¹ÍÐÉ¥¡Ð€ô5…Ñ ¹•¥°¡5…Ñ ¹µ¥¸¡Ñà¹…¹Ù…Ì¹Ý¥‘Ñ °à€¬……‰‰\€¼€È€¬Á…¤¤ì(€€€€€½¹ÍÐ‰½ÑÑ½´€ô5…Ñ ¹•¥°¡5…Ñ ¹µ¥¸¡Ñà¹…¹Ù…Ì¹¡•¥¡Ð°ä€¬……‰‰ €¼€È€¬Á…¤¤ì(€€€€€½¹ÍÐÑµÀ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð …¹Ù…Ìœ¤ì(€€€€€ÑµÀ¹Ý¥‘Ñ €ô5…Ñ ¹µ…à Ä°É¥¡Ð€´±•™Ð¤ìÑµÀ¹¡•¥¡Ð€ô5…Ñ ¹µ…à Ä°‰½ÑÑ½´€´Ñ½À¤ì(€€€€€½¹ÍÐÑŒ€ôÑµÀ¹•Ñ½¹Ñ•áÐ œÉœ¤ì(€€€€€¥˜€¡ÑŒ¤ì(€€€€€€€ÑŒ¹ÑÉ…¹Í±…Ñ” µ±•™Ð°€µÑ½À¤ì(€€€€€€€‘É…ÝM¡…Á•1…å•È¡ÑŒ°ì€¸¸¹™%µœ°½Á…¥Ñäè€ÄÀÀô°Í…±•…Ñ½È°ÑÉÕ”¤ì(€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€Ñà¹±½‰…±±Á¡„€¨ôÍ¡…Á•±Á¡„ì(€€€€€€€Ñà¹‘É…Ý%µ…”¡ÑµÀ°±•™Ð°Ñ½À¤ì(€€€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€€€ÑµÀ¹Ý¥‘Ñ €ô€ÄìÑµÀ¹¡•¥¡Ð€ô€Äì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€ô((€€€Ñà¹Í…Ù” ¤ì(€€€Ñà¹±½‰…±±Á¡„€¨ô…±Á¡…±…ÑÑ•¹•€ü€Ä€èÍ¡…Á•±Á¡„ì(€€€€¼¼MLƒžjÍ…±”ƒ’î—šr«žâ»šRûš†žj’â·–þž
ë–:¦î{¾ò3š&’î—–#šB³–"Ã’â·–þ–7žâ»šRû¾ò3šr–ú3š:£–n{–Þ›’â+¢žH(€€€Ñà¹ÑÉ…¹Í±…Ñ”¡™à€¬™Ü€¼€È°™ä€¬™ €¼€È¤ì(€€€Ñà¹É½Ñ…Ñ” ¡™%µœ¹É½Ñ…Ñ¥½¸€¨5…Ñ ¹A$¤€¼€ÄàÀ¤ì(€€€Ñà¹Í…±”¡™%µœ¹Í…±”°™%µœ¹Í…±”¤ì(€€€Ñà¹ÑÉ…¹Í±…Ñ” µ™Ü€¼€È°€µ™ €¼€È¤ì((€€€¥˜€¡™%µœ¹Í¡…Á”€ôôô€¡½±”œ¤ì(€€€€€€¼¨ƒ–’úžj–r[š†#¾òk¢Þ¦‚C¢š÷–B3’âšR¼‘É…Ý!½±•M¡…Á—¾ò3–:¦î{–r£’â·–þ€¨¼(€€€€€Ñà¹Í…Ù” ¤ì(€€€€€Ñà¹ÑÉ…¹Í±…Ñ”¡™Ü€¼€È°™ €¼€È¤ì(€€€€€‘É…Ý!½±•M¡…Á” (€€€€€€€Ñà°(€€€€€€€ì(€€€€€€€€€¡½±”è™%µœ¹¡½±•QåÁ”ñð€¥É±”œ°™¥±±•è™%µœ¹Í¡…Á•¥±±•°(€€€€€€€€€½±½Èè™%µœ¹½±½ÈñðM!A}U1Q}=1=H°(€€€€€€€€€±¥¹•\è™%µœ¹Í¡…Á•1¥¹•\°±½Üè™%µœ¹Í¡…Á•±½Ü…Ì…¹ä°(€€€€€€€€€±½Ý½±½Èè™%µœ¹Í¡…Á•±½Ý½±½È°ÍÑÉ½­•\è™%µœ¹Í¡…Á•MÑÉ½­•\°(€€€€€€€€€ÍÑÉ½­•½±½Èè™%µœ¹Í¡…Á•MÑÉ½­•½±½È°(€€€€€€€€€Ñ•àè™%µœ¹Í¡…Á•Q•à°ÍÑÉ¥Á•8è™%µœ¹Í¡…Á•MÑÉ¥Á•8°ÍÑÉ¥Á•¥Èè™%µœ¹Í¡…Á•MÑÉ¥Á•¥È°(€€€€€€€€€ÍÑÉ¥Á•è™%µœ¹Í¡…Á•MÑÉ¥Á•ñð™%µœ¹½±½ÈñðM!A}U1Q}=1=H°(€€€€€€€€€ÍÑÉ¥Á•è™%µœ¹Í¡…Á•MÑÉ¥Á•ñð€œœ°(€€€€€€€€€‘½ÑÌè™%µœ¹Í¡…Á•½ÑÌ°‘½ÑM¥é”è™%µœ¹Í¡…Á•½ÑM¥é”°(€€€€€€€€€‘½Ñ…Àè™%µœ¹Í¡…Á•½Ñ…À°‘½Ñ½±½Èè™%µœ¹Í¡…Á•½Ñ½±½È°(€€€€€€€€€¥è™%µœ¹¥°(€€€€€€€€€€¼¼ƒžÞk–¾³žj–Z»’ö7’â7–B¬Í…±—¾ò#’â+¦v‹–ÞËžÚLÑà¹Í…±”ƒ¦;’ê¾ò'ŠSŠPƒ¢Þ¦‚C¢š÷–B3’âšŠw¢š?–&(€€€€€€€€€±¥¹•U¹¥Ðè€ ¡™%µœ¹Í¡…Á•1¥¹•	…Í”ñð5…Ñ ¹µ…à¡™%µœ¹Ý¥‘Ñ °™%µœ¹¡•¥¡Ð¤¤€¨Í…±•…Ñ½È¤(€€€€€€€€€€€€¼€ÄØÀ€¼€¡™%µœ¹Í…±”ñð€Ä¤°(€€€€€€€ô°(€€€€€€€™Ü°™ °Í¡…Á•±½Ý	±ÕÉÌ¡™Ü°™ ¤¹µ…À¡È€ôøÈ€¨±½Ýµ½Õ¹Ð¡™%µœ¹Í¡…Á•±½Ü…Ì…¹ä¤¤°(€€€€€€¤ì(€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€½¹ÍÐÁ…Ñ €ô¹•ÜA…Ñ É¡Í¡…Á•A…Ñ¡ (€€€€€™%µœ¹Í¡…Á”„°™Ü°™ °(€€€€€€¡™%µœ¹Í¡…Á•Q•áÑÕÉ•	…Í•\ñð™%µœ¹Ý¥‘Ñ ¤€¨Í…±•…Ñ½È°(€€€€€€¡™%µœ¹Í¡…Á•Q•áÑÕÉ•	…Í• ñð™%µœ¹¡•¥¡Ð¤€¨Í…±•…Ñ½È°(€€€€€€ ¡™%µœ¹Í¡…Á•1¥¹•	…Í”ñð5…Ñ ¹µ…à¡™%µœ¹Ý¥‘Ñ °™%µœ¹¡•¥¡Ð¤¤€¨Í…±•…Ñ½È€¼€ÄØÀ¤€¨€È¸ÌÈÔ(€€€€€€€€¼5…Ñ ¹Á½Ü¡5…Ñ ¹µ…à À¸ÀÄ°™%µœ¹Í…±”ñð€Ä¤°€À¸ØÔ¤°(€€€€¤¤ì(€€€½¹ÍÐ½±½È€ô™%µœ¹½±½ÈñðM!A}U1Q}=1=Hì(€€€½¹ÍÐÍ½±¥€ô™%µœ¹Í¡…Á•¥±±•€˜˜™%µœ¹Í¡…Á”€„ôô€±¥¹”œì(€€€€¼¨ƒžÞk–¾³¢š¦f“š:$Í…±—¾òk’â+¦v‹–ÞËžÚLÑà¹Í…±”¡™%µœ¹Í…±”°€¸¸¸¤ƒ¦;’ê¾ò0(€€€€€€ƒ’â7¦f“žj¢¦ÇŽ3–r[–ö‹š.'–’ŸŽ7¦š†žÞk’æ¢Þ¢F_¢º+žÊ\ƒŠSŠPƒ¢Þ¦‚C¢š÷–B3’âšŠw¢š?–&Ž€¨¼(€€€½¹ÍÐÍM…±”€ô™%µœ¹Í…±”ñð€Äì(€€€½¹ÍÐ•áÁ½ÉÑ1¥¹•	…Í”€ô€¡™%µœ¹Í¡…Á•1¥¹•	…Í”ñð5…Ñ ¹µ…à¡™%µœ¹Ý¥‘Ñ °™%µœ¹¡•¥¡Ð¤¤€¨Í…±•…Ñ½Èì(€€€½¹ÍÐ±Ü€ôI%}M!A}-%9L¹¡…Ì¡™%µœ¹Í¡…Á”„¤(€€€€€€ü€Ä¸Ô€¨Í…±•…Ñ½È€¼ÍM…±”(€€€€€€è5…Ñ ¹µ…à À¸Ð€¨Í…±•…Ñ½È°€¡™%µœ¹Í¡…Á•1¥¹•\€üü€Ø¤€¨€¡•áÁ½ÉÑ1¥¹•	…Í”€¼€ÄØÀ¤¤€¼ÍM…±”ì(€€€¥˜€ …Í½±¥¤ì(€€€€€½¹ÍÐ‘…Í €ô™%µœ¹Í¡…Á•…Í ñð€Àì(€€€€€Ñà¹±¥¹•]¥‘Ñ €ô±Üì(€€€€€Ñà¹±¥¹•)½¥¸€ô™%µœ¹Í¡…Á”€ôôô€±¥¹”œ€ü€É½Õ¹œ€è€µ¥Ñ•Èœì(€€€€€Ñà¹µ¥Ñ•É1¥µ¥Ð€ô€Ðì(€€€€€€¼¼ƒ’â–ú/–æÏ¦‚·¾òkžÞkšŠwžj–§ž®¿¢š–"¦ö((€€€€€Ñà¹±¥¹•…À€ô€‰ÕÑÐœì(€€€€€¥˜€¡‘…Í €ø€À¤ì(€€€€€€€½¹ÍÐÍ•œ€ô±Ü€¨€ À¸Ø€¬€¡‘…Í €¼€ÄÀÀ¤€¨€Ð¤ì(€€€€€€€Ñà¹Í•Ñ1¥¹•…Í ¡mÍ•œ°Í•œ€¨€À¸àÕt¤ì(€€€€€ô•±Í”ì(€€€€€€€Ñà¹Í•Ñ1¥¹•…Í ¡mt¤ì(€€€€€ô(€€€€€Ñà¹ÍÑÉ½­•MÑå±”€ô½±½Èì(€€€ô•±Í”ì(€€€€€Ñà¹™¥±±MÑå±”€ô½±½Èì(€€€ô(€€€€¼¼ƒžfó–'¾òk’â'šº×š¢‡žÎ+žZ+¢Öß’ú¾ò3¢Þ¦‚C¢š÷žj’â'–Æ‘É½ÀµÍ¡…‘½Üƒ–B3’âžÖ–6+–úD(€€€½¹ÍÐµÐ€ô±½Ýµ½Õ¹Ð¡™%µœ¹Í¡…Á•±½Ü…Ì…¹ä¤ì(€€€¥˜€¡µÐ€ø€À¤ì(€€€€€Ñà¹Í…Ù” ¤ì(€€€€€Ñà¹Í¡…‘½Ý½±½È€ô™%µœ¹Í¡…Á•±½Ý½±½Èñð½±½Èì(€€€€€™½È€¡½¹ÍÐÈ½˜Í¡…Á•±½Ý	±ÕÉÌ¡™Ü°™ ¤¤ì(€€€€€€€Ñà¹Í¡…‘½Ý	±ÕÈ€ôÈ€¨µÐì(€€€€€€€¥˜€¡Í½±¥¤Ñà¹™¥±°¡Á…Ñ ¤ì•±Í”Ñà¹ÍÑÉ½­”¡Á…Ñ ¤ì(€€€€€ô(€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€ô(€€€€¼¨ƒ–’[š>?¦
+¾òkžV¯–r£šr³¦®S–êW’â/Ž–¾³–ê›–*ƒ–7¾ò3¢Þ¦‚C¢š÷¦
’âšŠtÁ…Ñ ƒ–B3’â––\€¨¼(€€€½¹ÍÐÍÑÉ½­•\€ô5…Ñ ¹µ¥¸ Ð°5…Ñ ¹µ…à À°™%µœ¹Í¡…Á•MÑÉ½­•\ñð€À¤¤(€€€€€€¨€¡5…Ñ ¹µ…à¡™Ü°™ ¤€¼€ÄØÀ¤€¼ÍM…±”ì(€€€¥˜€¡ÍÑÉ½­•\€ø€À¤ì(€€€€€Ñà¹Í…Ù” ¤ì(€€€€€Ñà¹Í•Ñ1¥¹•…Í ¡mt¤ì(€€€€€Ñà¹±¥¹•)½¥¸€ô€É½Õ¹œì(€€€€€Ñà¹µ¥Ñ•É1¥µ¥Ð€ô€Èì(€€€€€Ñà¹ÍÑÉ½­•MÑå±”€ô™%µœ¹Í¡…Á•MÑÉ½­•½±½Èñð€œŒÀÀÀÀÀÀœì(€€€€€Ñà¹±¥¹•]¥‘Ñ €ô€¡Í½±¥€ü€À€è±Ü¤€¬ÍÑÉ½­•\€¨€Èì(€€€€€Ñà¹ÍÑÉ½­”¡Á…Ñ ¤ì(€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€ô(€€€Ñà¹Í…Ù” ¤ì(€€€½¹ÍÐ™•…Ñ¡•É	±ÕÈ€ôÍ½±¥€üÍ¡…Á••…Ñ¡•É	±ÕÈ¡™Ü°™ °™%µœ¹Í¡…Á••…Ñ¡•È¤€è€Àì(€€€¥˜€¡™•…Ñ¡•É	±ÕÈ€ø€À¤Ñà¹™¥±Ñ•È€ô‰±ÕÈ ‘í™•…Ñ¡•É	±ÕÉõÁà¥€ì(€€€¥˜€¡Í½±¥¤Ñà¹™¥±°¡Á…Ñ ¤ì•±Í”Ñà¹ÍÑÉ½­”¡Á…Ñ ¤ì(€€€€¼¨ƒžÒ/žB¾òk–&«¢Ž–r£–r[–ö‹¢Ž‡¦v‹–7¦.«’â–Æ“¾ò3¢Þ¦‚C¢š÷¦
–†(Á…ÑÑ•É¸ƒšb¿–B3’â–†+–6–~Ž(€€€€€€ƒ–B3’âžÖ–>šVã¾ò3š&’î—¦‚C¢š÷¢Þ–2¿–ë–Â7–ú_¢Öß’úŽ€¨¼(€€€ì(€€€€€½¹ÍÐÑà€ôÑ•á=˜¡ìÑ•àè™%µœ¹Í¡…Á•Q•à°‘½ÑÌè™%µœ¹Í¡…Á•½ÑÌô¤ì(€€€€€¥˜€¡Ñà€„ôô€¹½¹”œ¤ì(€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€Ñà¹±¥À¡Á…Ñ ¤ì(€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ”¡™Ü€¼€È°™ €¼€È¤ì€€€¼¼ƒžÒ/žB¦
–§šR¿¦÷šb¿’î—–r[–ö‹’â·–þž
ë–:¦îx(€€€€€€€¥˜€¡Ñà€ôôô€‘½ÐœñðÑà€ôôô€ÍÑ…ÈœñðÑà€ôôô€¡•…ÉÐœ¤Á…¥¹ÑQ•à¡Ñà°™Ü°™ °™Ü°™ °ì(€€€€€€€€€Ñ•àèÑà°(€€€€€€€€€‘½ÑM¥é”è™%µœ¹Í¡…Á•½ÑM¥é”°‘½Ñ…Àè™%µœ¹Í¡…Á•½Ñ…À°‘½Ñ½±½Èè™%µœ¹Í¡…Á•½Ñ½±½È°(€€€€€€€€€Ñ•áÑÕÉ•	…Í•\è€¡™%µœ¹Í¡…Á•Q•áÑÕÉ•	…Í•\ñð™%µœ¹Ý¥‘Ñ ¤€¨Í…±•…Ñ½È°(€€€€€€€€€Ñ•áÑÕÉ•	…Í• è€¡™%µœ¹Í¡…Á•Q•áÑÕÉ•	…Í• ñð™%µœ¹¡•¥¡Ð¤€¨Í…±•…Ñ½È°(€€€€€€€ô¤ì(€€€€€€€•±Í”Á…¥¹ÑMÑÉ¥Á•Ì¡Ñà°™Ü°™ °™Ü°™ °(€€€€€€€€€™%µœ¹Í¡…Á•MÑÉ¥Á•8€üüMQI%A}9}U1P°™%µœ¹Í¡…Á•MÑÉ¥Á•¥È€ôôô€ œ€ü€ œ€è€Øœ°(€€€€€€€€€™%µœ¹Í¡…Á•MÑÉ¥Á•ñð™%µœ¹½±½ÈñðM!A}U1Q}=1=H°™%µœ¹Í¡…Á•MÑÉ¥Á•ñð€œœ¤ì(€€€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€ô(€€€ô(€€€Ñà¹Í•Ñ1¥¹•…Í ¡mt¤ì(€€€Ñà¹É•ÍÑ½É” ¤ì(€ôì((€€¼¨¨ƒ–2¿–ëšfš*+¢«žRÇ–r[–Æ“žV¯–"Ã¦‚¦v‹–êŸš¢gžÎï’â+¾ò3¦‚–ê?–ÂÇšb¿¦f–"_¦‚–ê?Ž€¨¼(€½¹ÍÐ‘É…Ý±½…Ñ¥¹1…å•ÉÌ€ô…Íå¹Œ€ (€€€Ñàè…¹Ù…ÍI•¹‘•É¥¹½¹Ñ•áÐÉ°(€€€±…å•ÉÌè±½…Ñ¥¹%µ…•mt°(€€€Í…±•…Ñ½Èè¹Õµ‰•È°(€€€±¥Ù”üè1¥Ù•É…Ü°(€€€µ½Ñ¥½¹É…µ”üè=‰©•Ñ5½Ñ¥½¹É…µ”ð¹Õ±°°(€€¤€ôøì(€€€€¼¨ƒ¦C–âŸ–B#š"Cšf¾ò3’â·¦ZOžV¯–â–>«žº_–"ÃŽ3¦g’âš‚óžržjšr¢Š¯žr/–"Ãžj–’Ÿ–Â?Ž7¾ò0(€€€€€€ƒ¢3’âSšVÓ¢ò«–ÇžR£–B3’âš&çžV¯–â¾ò#¢š,1¥Ù•É…Üƒžj¢ª«šb;¾ò'Ž€¨¼(€€€½¹ÍÐÄ€ô±¥Ù”€ü5…Ñ ¹µ…à À¸ÀÈ°5…Ñ ¹µ¥¸ Ä°±¥Ù”¹¬¤¤€è€Äì(€€€½¹ÍÐÍÉ…Ñ €ô€¡­•äèÍÑÉ¥¹œ°Üè¹Õµ‰•È° è¹Õµ‰•È¤è!Q51…¹Ù…Í±•µ•¹Ð€ôøì(€€€€€½¹ÍÐ\€ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡Ü¤¤° €ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡ ¤¤ì(€€€€€¥˜€ …±¥Ù”¤ì½¹ÍÐŒ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð …¹Ù…Ìœ¤ìŒ¹Ý¥‘Ñ €ô\ìŒ¹¡•¥¡Ð€ô ìÉ•ÑÕÉ¸Œìô(€€€€€±•ÐŒ€ô±¥Ù”¹…¡”¹•Ð¡­•ä¤…Ì!Q51…¹Ù…Í±•µ•¹ÐðÕ¹‘•™¥¹•ì(€€€€€¥˜€ …Œ¤ìŒ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð …¹Ù…Ìœ¤ì±¥Ù”¹…¡”¹Í•Ð¡­•ä°Œ¤ìô(€€€€€¥˜€¡Œ¹Ý¥‘Ñ €„ôô\ñðŒ¹¡•¥¡Ð€„ôô ¤ìŒ¹Ý¥‘Ñ €ô\ìŒ¹¡•¥¡Ð€ô ìô(€€€€€•±Í”ì½¹ÍÐœ€ôŒ¹•Ñ½¹Ñ•áÐ œÉœ¤ì¥˜€¡œ¤œ¹±•…ÉI•Ð À°€À°\° ¤ìô(€€€€€É•ÑÕÉ¸Œì(€€€ôì(€€€™½È€¡½¹ÍÐ™%µœ½˜±…å•ÉÌ¤ì(€€€€€½¹ÍÐ™É…µ”€ô™%µœ¹¥ÍY¥‘•¼€ü¹Õ±°€èµ½Ñ¥½¹É…µ”ì(€€€€€€¼¨ƒ–2¿–ë¢"%ƒ–6Ïšf¦‚C¢š÷’æ¢šžV¯žrš¶žjšÎ‹šÖ«Ž	=4ƒ¦‚C¢š÷šb¿š*+ž&§’îÛ–"š"CžnÓšŠw–ú0(€€€€€€€€ƒ–kš¶–ò›’ö7žžï¾òm…¹Ù…Ìƒ¢.—–>«–þ÷žV”É¥‘]…Ù—¾ò1%ƒ¦‚C¢š÷–ÂÇšr–s–r£¦vsš/ž²°€Àƒ–æŽ(€€€€€€€€ƒ–#š*+–Z»’âž&§’îÛ–º3šVÓžV¯¦Ëšr'–º'–£¦
+žV3žj¦n‹–Æ?žV¯–â¾ò3–7žR£žnã–B3–"ž&¦
?¢ò¿¢Êó–n{¾ò0(€€€€€€€€ƒšZ–¶_Ž–r[–ö‹¢"–r[ž&¦÷–ÇžR£¦gšŠw¢Þ¿¾ò3š‚çž¾¦î{–êŸš¢g–º3–£’â7šr¢Š¯šB³–.WŽ€¨¼(€€€€€¥˜€¡™É…µ”ü¹É¥‘]…Ù”€„ôôÕ¹‘•™¥¹•¤ì(€€€€€€€½¹ÍÐ…‘©ÕÍÑ•‘`€ô™%µœ¹à€´5…Ñ ¹™±½½È¡™%µœ¹à€¼€¡ÁÉ•Ù¥•Ý\€¬€Ä¤¤ì(€€€€€€€½¹ÍÐ™Ü€ô™%µœ¹Ý¥‘Ñ €¨Í…±•…Ñ½Èì(€€€€€€€½¹ÍÐ™ €ô™%µœ¹¡•¥¡Ð€¨Í…±•…Ñ½Èì(€€€€€€€½¹ÍÐà€ô…‘©ÕÍÑ•‘`€¨Í…±•…Ñ½È€¬™Ü€¼€Èì(€€€€€€€½¹ÍÐä€ô™%µœ¹ä€¨Í…±•…Ñ½È€¬™ €¼€Èì(€€€€€€€½¹ÍÐÌ€ô5…Ñ ¹µ…à ¸ÀÄ°™%µœ¹Í…±”ñð€Ä¤ì(€€€€€€€½¹ÍÐÉ…€ô€ ¡™%µœ¹É½Ñ…Ñ¥½¸ñð€À¤€¨5…Ñ ¹A$¤€¼€ÄàÀì(€€€€€€€½¹ÍÐ‰Ü€ô5…Ñ ¹…‰Ì¡™Ü€¨Ì€¨5…Ñ ¹½Ì¡É…¤¤€¬5…Ñ ¹…‰Ì¡™ €¨Ì€¨5…Ñ ¹Í¥¸¡É…¤¤ì(€€€€€€€½¹ÍÐ‰ €ô5…Ñ ¹…‰Ì¡™Ü€¨Ì€¨5…Ñ ¹Í¥¸¡É…¤¤€¬5…Ñ ¹…‰Ì¡™ €¨Ì€¨5…Ñ ¹½Ì¡É…¤¤ì(€€€€€€€½¹ÍÐ…µÁ±¥ÑÕ‘”€ô5…Ñ ¹µ…à È€¨Í…±•…Ñ½È°(€€€€€€€€€5…Ñ ¹µ¥¸¡5…Ñ ¹µ…à Ä°‰Ü¤€¨€¸ÀÔÔ°5…Ñ ¹µ…à Ä°‰ ¤€¨€¸ÄÌ¤(€€€€€€€€€€¨5…Ñ ¹µ…à ¸ÄÔ°€¡™%µœ¹µ¼ü¹…µÀ€üü€ÔÀ¤€¼€ÄÀÀ¤€¨€¡™É…µ”¹Ý…Ù•5¥à€üü€Ä¤¤ì(€€€€€€€½¹ÍÐÁ…€ô5…Ñ ¹µ…à ÈÐ€¨Í…±•…Ñ½È°5…Ñ ¹µ…à¡‰Ü°‰ ¤€¨€¸ÈÈ°…µÁ±¥ÑÕ‘”€¨€È€¬€Ð¤ì(€€€€€€€½¹ÍÐ\€ô5…Ñ ¹µ…à È°5…Ñ ¹•¥°¡‰Ü€¬Á…€¨€È¤¤ì(€€€€€€€½¹ÍÐ €ô5…Ñ ¹µ…à È°5…Ñ ¹•¥°¡‰ €¬Á…€¨€È¤¤ì(€€€€€€€½¹ÍÐ½™˜€ôÍÉ…Ñ ¡Ý…Ù”µ½‰©•Ñð‘í™%µœ¹¥‘õ€°\° ¤ì(€€€€€€€½¹ÍÐ½œ€ô•ÐÉ‘]¥‘”¡½™˜¤„ì(€€€€€€€½œ¹±•…ÉI•Ð À°€À°\° ¤ì(€€€€€€€½œ¹Í…Ù” ¤ì(€€€€€€€½œ¹ÑÉ…¹Í±…Ñ”¡\€¼€È€´à° €¼€È€´ä¤ì(€€€€€€€…Ý…¥Ð‘É…Ý±½…Ñ¥¹1…å•ÉÌ¡½œ°m™%µt°Í…±•…Ñ½È°±¥Ù”°¹Õ±°¤ì(€€€€€€€½œ¹É•ÍÑ½É” ¤ì((€€€€€€€½¹ÍÐàÀ€ôà€´\€¼€Èì(€€€€€€€½¹ÍÐäÀ€ôä€´ €¼€Èì(€€€€€€€½¹ÍÐÉ•Ù•…°€ô™É…µ”¹É¥‘I•Ù•…°€ôôôÕ¹‘•™¥¹•€ü€Ä€è5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Ä°™É…µ”¹É¥‘I•Ù•…°¤¤ì(€€€€€€€½¹ÍÐÍ±¥•Ì€ô5…Ñ ¹µ…à ÌÈ°5…Ñ ¹µ¥¸ ÄÈà°5…Ñ ¹•¥°¡\€¼5…Ñ ¹µ…à Ä°€Ô€¨Í…±•…Ñ½È¤¤¤¤ì(€€€€€€€½¹ÍÐÍÜ€ô\€¼Í±¥•Ìì(€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€¥˜€¡É•Ù•…°€ð€Ä¤ì(€€€€€€€€€Ñà¹‰•¥¹A…Ñ  ¤ì(€€€€€€€€€Ñà¹É•Ð¡àÀ°äÀ€´…µÁ±¥ÑÕ‘”€´€È°\€¨É•Ù•…°° €¬…µÁ±¥ÑÕ‘”€¨€È€¬€Ð¤ì(€€€€€€€€€Ñà¹±¥À ¤ì(€€€€€€€ô(€€€€€€€™½È€¡±•Ð¤€ô€Àì¤€ðÍ±¥•Ìì¤¬¬¤ì(€€€€€€€€€½¹ÍÐÍà€ô¤€¨ÍÜì(€€€€€€€€€½¹ÍÐÍ…µÁ±•`€ô€¡Íà€¬ÍÜ€¼€È¤€¼\ì(€€€€€€€€€½¹ÍÐ‘ä€ô5…Ñ ¹Í¥¸¡Í…µÁ±•`€¨5…Ñ ¹A$€¨€È¸È€´™É…µ”¹É¥‘]…Ù”€¨5…Ñ ¹A$€¨€È¤€¨…µÁ±¥ÑÕ‘”ì(€€€€€€€€€Ñà¹‘É…Ý%µ…”¡½™˜°Íà°€À°ÍÜ€¬€¸Ü° °àÀ€¬Íà°äÀ€¬‘ä°ÍÜ€¬€¸Ü° ¤ì(€€€€€€€ô(€€€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€¥˜€¡™É…µ”¤ì(€€€€€€€½¹ÍÐ…‘©ÕÍÑ•‘`€ô™%µœ¹à€´5…Ñ ¹™±½½È¡™%µœ¹à€¼€¡ÁÉ•Ù¥•Ý\€¬€Ä¤¤ì(€€€€€€€½¹ÍÐ™Ü€ô™%µœ¹Ý¥‘Ñ €¨Í…±•…Ñ½Èì(€€€€€€€½¹ÍÐ™ €ô™%µœ¹¡•¥¡Ð€¨Í…±•…Ñ½Èì(€€€€€€€½¹ÍÐà€ô…‘©ÕÍÑ•‘`€¨Í…±•…Ñ½È€¬™Ü€¼€Èì(€€€€€€€½¹ÍÐä€ô™%µœ¹ä€¨Í…±•…Ñ½È€¬™ €¼€Èì(€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€Ñà¹±½‰…±±Á¡„€¨ô™É…µ”¹„ì(€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ”¡à€¬™É…µ”¹‘à€¨™Ü°ä€¬™É…µ”¹‘ä€¨™ ¤ì(€€€€€€€Ñà¹É½Ñ…Ñ” ¡™É…µ”¹É½Ð€¨5…Ñ ¹A$¤€¼€ÄàÀ¤ì(€€€€€€€Ñà¹Í…±”¡™É…µ”¹¬€¨€¡™É…µ”¹™à€üü€Ä¤°™É…µ”¹¬¤ì(€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ” µà°€µä¤ì(€€€€€ô(€€€€€¥˜€¡™%µœ¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•¤ì(€€€€€€€…Ý…¥Ð‘É…ÝQ•áÑ1…å•È¡Ñà°™%µœ°Í…±•…Ñ½È°™É…µ”¤ì(€€€€€€€¥˜€¡™É…µ”¤Ñà¹É•ÍÑ½É” ¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€¥˜€¡™%µœ¹Í¡…Á”¤ì(€€€€€€€‘É…ÝM¡…Á•1…å•È¡Ñà°™%µœ°Í…±•…Ñ½È¤ì(€€€€€€€¥˜€¡™É…µ”¤Ñà¹É•ÍÑ½É” ¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€±•Ð¥µœè…¹ä€ô™%µœ¹¥ÍY¥‘•¼€ü…Ý…¥Ð±½…‘áÁ½ÉÑY¥‘•¼¡™%µœ¹ÍÉŒ¤€è…Ý…¥Ð±½…‘áÁ½ÉÑ%µ…”¡™%µœ¹ÍÉŒ¤ì(€€€€€¥˜€ …¥µœ¤ì¥˜€¡™É…µ”¤Ñà¹É•ÍÑ½É” ¤ì½¹Ñ¥¹Õ”ìô(€€€€€€¼¨ƒ–öÇž&žjšž/–r[šb¿Ž3žVg¢F_–>šVãŽžV¯žjšf–gš&7––_Ž7¾ò#žŸž&šb¿ž“š"C’â–ò×šZÃ–r[¾ò'Ž(€€€€€€€€ƒ¦g¢Ž‡žR£žjšb¿¢Þ¦‚C¢š÷–º3–£–B3’â–/ž~§¦f¾ò3š&’î—–2¿–ë¢ÞžV¯¦v‹’â+žr/–"Ãžj’â¢ÓŽ€¨¼(€€€€€¥˜€¡™%µœ¹¥ÍY¥‘•¼€˜˜™%µœ¹•¼€˜˜€…¥Í•½%‘•¹Ñ¥Ñä¡™%µœ¹•¼¤¤ì(€€€€€€€¥µœ€ô•½É…µ•…¹Ù…Ì¡¥µœ°¥µœ¹Ù¥‘•½]¥‘Ñ ñð¥µœ¹Ý¥‘Ñ °¥µœ¹Ù¥‘•½!•¥¡Ðñð¥µœ¹¡•¥¡Ð°™%µœ¹•¼°€ÈÐÀÀ¤ì(€€€€€ô((€€€€€Ñà¹Í…Ù” ¤ì(€€€€€Ñà¹±½‰…±±Á¡„€¨ô€¡™%µœ¹½Á…¥Ñä€üü€ÄÀÀ¤€¼€ÄÀÀì(€€€€€€¼¼ƒš&š:'¦‚C¢š÷¢Ž‡š¾?¦‚’æ/¦ZO¦
Œ€ÅÁàƒžj¦ZO¦jP(€€€€€½¹ÍÐ…‘©ÕÍÑ•‘`€ô™%µœ¹à€´5…Ñ ¹™±½½È¡™%µœ¹à€¼€¡ÁÉ•Ù¥•Ý\€¬€Ä¤¤ì(€€€€€½¹ÍÐ™à€ô…‘©ÕÍÑ•‘`€¨Í…±•…Ñ½Èì(€€€€€½¹ÍÐ™ä€ô™%µœ¹ä€¨Í…±•…Ñ½Èì(€€€€€½¹ÍÐ™Ü€ô™%µœ¹Ý¥‘Ñ €¨Í…±•…Ñ½Èì(€€€€€½¹ÍÐ™ €ô™%µœ¹¡•¥¡Ð€¨Í…±•…Ñ½Èì((€€€€€€¼¼MLƒžjÍ…±”ƒ’î—šr«žâ»šRûš†žj’â·–þž
ë–:¦îx(€€€€€½¹ÍÐà€ô™à€¬™Ü€¼€Èì(€€€€€½¹ÍÐä€ô™ä€¬™ €¼€Èì((€€€€€Ñà¹ÑÉ…¹Í±…Ñ”¡à°ä¤ì(€€€€€Ñà¹É½Ñ…Ñ” ¡™%µœ¹É½Ñ…Ñ¥½¸€¨5…Ñ ¹A$¤€¼€ÄàÀ¤ì(€€€€€Ñà¹Í…±”¡™%µœ¹Í…±”°™%µœ¹Í…±”¤ì((€€€€€€¼¼ƒšþû¦>‡¾ò?¢ªÿž¾–#––_’â+–:ï¾ò#žR£–2¿–ë¢žšzC–ê›¦7žº_’âš²‡¾ò3’â7šb¿š.ÿ¦‚C¢š÷¦
–ò×–Â?–r[šRû–’Ÿ¾ò$(€€€€€±•ÐÍÉŒè…¹Ù…Í%µ…•M½ÕÉ”€ô¥µœì(€€€€€¥˜€¡¡…ÍA¡½Ñ½à¡™%µœ¹™à¤¤ì(€€€€€€€€¼¨ƒ¦C–âŸ–B#š"Cšf’â+¦fCšRçš"CŽ3¦g–/–r[–Æ“–r£–B#š"CžV¯–â’â+žrš¶’öS–æû–/–?žÒƒŽ7Ž(€€€€€€€€€€ƒ’âšº×–öÇž&šr³’úš¾?’âš‚ó¦÷¢Š¯žº_–"À€ÈÐÀÃ
Ë¾ò ÔÜÀƒ¢B³–?žÒƒ¾ò'–7žâ»–Â?¢Êó’â+¾ò0(€€€€€€€€€€ƒ¢3–º–r£žV¯¦v‹’â+–>¿¢÷–>«’öP€ÌÀÀƒ–?žÒƒ–¾°ƒŠSŠPƒžf÷žº_’ê–·–6–æû–7žj¦?Ž€¨¼(€€€€€€€½¹ÍÐ…À€ô±¥Ù”(€€€€€€€€€€ü5…Ñ ¹µ…à ØÐ°5…Ñ ¹•¥°¡5…Ñ ¹µ…à¡™Ü°™ ¤€¨€¡™%µœ¹Í…±”ñð€Ä¤€¨Ä¤¤(€€€€€€€€€€è€ÈÐÀÀì(€€€€€€€½¹ÍÐ¬€ô5…Ñ ¹µ¥¸ Ä°…À€¼5…Ñ ¹µ…à¡¥µœ¹¹…ÑÕÉ…±]¥‘Ñ ñð™Ü°¥µœ¹¹…ÑÕÉ…±!•¥¡Ðñð™ ¤¤ì(€€€€€€€€¼¨ƒ¦C–âŸ–B#š"Cšfš*+Ž3žV¯–r£–N«–ò×žV¯–â’â+Ž7’æ’â¢Öß’ê“–ë–:ï¾ò!…ÁÁ±åA¡½Ñ½àƒžj½ÕÓ¾ò'Ž(€€€€€€€€€€ƒ’â7žÖ›žj¢¦Ç–ºš¾?’âš‚ó¦÷šr¦Z/’â–ò×šZÃžjžV¯–âƒŠSŠPƒ¦
šR¿¢«–ÞÇžj¢¢ï¢ž–ÂÇ–¾¯’ê¾òh(€€€€€€€€€€ƒŽ3’úšêCšb¿–öÇž&žjšf–g’âžžK¢š¢ÞG–æû–6š²‡¾ò3š¾?š²‡¦Z/’â–ò×–æûžfû¢B³–?žÒƒžjžV¯–â¾ò0(€€€€€€€€€€€€ƒš&/š¦žjžV¯–â¢¢cšÛ¦®S–æûžžK–ÂÇšr¢Š¯žÎïžÖÇšRÛ¢ÖÃ¾ò#¾òw¦Z¦–n{’âïžV¯¦v‹¾ò'Ž7Ž€¨¼(€€€€€€€±•Ð™á=ÕÐè!Q51…¹Ù…Í±•µ•¹ÐðÕ¹‘•™¥¹•ì(€€€€€€€¥˜€¡±¥Ù”¤ì(€€€€€€€€€™á=ÕÐ€ô±¥Ù”¹…¡”¹•Ð ™á=ÕÐœ¤…Ì!Q51…¹Ù…Í±•µ•¹ÐðÕ¹‘•™¥¹•ì(€€€€€€€€€¥˜€ …™á=ÕÐ¤ì™á=ÕÐ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð …¹Ù…Ìœ¤ì±¥Ù”¹…¡”¹Í•Ð ™á=ÕÐœ°™á=ÕÐ¤ìô(€€€€€€€ô(€€€€€€€ÍÉŒ€ô…ÁÁ±åA¡½Ñ½à (€€€€€€€€€¥µœ°(€€€€€€€€€5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹ ¡¥µœ¹¹…ÑÕÉ…±]¥‘Ñ ñð™Ü¤€¨¬¤¤°(€€€€€€€€€5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹ ¡¥µœ¹¹…ÑÕÉ…±!•¥¡Ðñð™ ¤€¨¬¤¤°(€€€€€€€€€™%µœ¹™à„°(€€€€€€€€€™á=ÕÐ€üì½ÕÐè™á=ÕÐô€èÕ¹‘•™¥¹•°(€€€€€€€€¤ì(€€€€€ô((€€€€€€¼¼ƒšr'–rO¢žKŽžú÷–2[š"[š>?¦
+–ÂÇ–#–r£¦n‹–Æ?žV¯–â’â+¢fWžB––÷¾ò3–7šVÓ–ò×¢Êó–n{’úŽ(€€€€€€¼¼ƒ¦n‹–Æ?–Âë–¾ã–B¬™%µœ¹Í…±—¾ò3šRû–’Ÿ¦;žj–r[š&7’â7šr–#žV¯–Â?–ò×–7š.'–’Ÿ¢3¢º+žÎ+Ž(€€€€€€¼¼ƒš>?¦
+–ú–’[¦Vß¾ò3š&’î—¦n‹–Æ?¢šš¾S–r[ž&šr³¢ê¯–’œ±Üƒ’â–r#¾òo¢Êó–n{–:ïšf’æ¢š¢Þ¢F_šRû–’œ(€€€€€½¹ÍÐÍÑÉ½­•1Ü€ô€¡™%µœ¹¥µMÑÉ½­•]¥‘Ñ ñð€À¤€¨Í…±•…Ñ½È€¨™%µœ¹Í…±”ì(€€€€€±•Ð‘É…Ý\€ô™Ü°‘É…Ý €ô™ ì(€€€€€½¹ÍÐ­¥¹€ô™%µœ¹¥µM¡…Á”ì(€€€€€¥˜€¡™%µœ¹¥µI…‘¥ÕÌñð™%µœ¹™•…Ñ¡•Èñð™%µœ¹¥µMÑÉ½­•]¥‘Ñ ñð¥Í%µM¡…Á•¡­¥¹¤¤ì(€€€€€€€½¹ÍÐ¥Ü€ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡™Ü€¨™%µœ¹Í…±”€¨Ä¤¤ì(€€€€€€€½¹ÍÐ¥ €ô5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹¡™ €¨™%µœ¹Í…±”€¨Ä¤¤ì(€€€€€€€½¹ÍÐ±Ü€ôÍÑÉ½­•1Ü€¨™%µœ¹Í…±”€¨Äì(€€€€€€€½¹ÍÐÍÑÉ½­•…À€ô€¡™%µœ¹¥µMÑÉ½­•…Àñð€À¤€¨Í…±•…Ñ½È€¨™%µœ¹Í…±”€¨™%µœ¹Í…±”€¨Äì(€€€€€€€½¹ÍÐÍÑÉ½­•áÑ•¹Ð€ô±Ü€¬ÍÑÉ½­•…Àì(€€€€€€€½¹ÍÐ½™˜€ôÍÉ…Ñ  ½™˜œ°¥Ü€¬ÍÑÉ½­•áÑ•¹Ð€¨€È°¥ €¬ÍÑÉ½­•áÑ•¹Ð€¨€È¤ì(€€€€€€€½¹ÍÐ½Œ€ô•ÐÉ‘]¥‘”¡½™˜¤„ì(€€€€€€€‘É…Ý%µ	…Í”¡½Œ°ÍÉŒ°ÍÑÉ½­•áÑ•¹Ð°ÍÑÉ½­•áÑ•¹Ð°¥Ü°¥ °™%µœ¤ì(€€€€€€€¥˜€¡™%µœ¹¥µI…‘¥ÕÌñð™%µœ¹™•…Ñ¡•Èñð¥Í%µM¡…Á•¡­¥¹¤¤ì(€€€€€€€€€€¼¼ƒ–>«š*+Ž3–r[ž&¦
’â–†+Ž7¢Ž–ö‹ž.¾ò3š>?¦
+žj–6–~’â7¢÷¢Š¯¢Žš:$(€€€€€€€€€½¹ÍÐÍ¡…Á•=¹±ä€ôÍÉ…Ñ  Í¡…Á•=¹±äœ°¥Ü°¥ ¤ì(€€€€€€€€€½¹ÍÐÍŒ€ô•ÐÉ‘]¥‘”¡Í¡…Á•=¹±ä¤„ì(€€€€€€€€€‘É…Ý%µ	…Í”¡ÍŒ°ÍÉŒ°€À°€À°¥Ü°¥ °™%µœ¤ì(€€€€€€€€€ÍŒ¹±½‰…±½µÁ½Í¥Ñ•=Á•É…Ñ¥½¸€ô€‘•ÍÑ¥¹…Ñ¥½¸µ¥¸œì(€€€€€€€€€¥˜€¡™%µœ¹™•…Ñ¡•È¤ì(€€€€€€€€€€€€¼¼ƒ¦»žö§žjš¢‡žÎ+–ú#–BAW¾ò3¢Ú¦;¦g–/¦
+¦Vß–ÂÇ–#žº_–Â?–ò×–7šRû–’Ÿ¢Êó’â+¾òl(€€€€€€€€€€€€¼¼ƒ¦»žö§šr³’ú–ÂÇšb¿–æÏšîGžj¾ò3šRû–’Ÿžr/’â7–ë–Þ»–"”(€€€€€€€€€€€½¹ÍÐ…À€ô€ÄÈÀÀì(€€€€€€€€€€€½¹ÍÐ¬€ô5…Ñ ¹µ¥¸ Ä°…À€¼5…Ñ ¹µ…à¡¥Ü°¥ ¤¤ì(€€€€€€€€€€€€¼¨ƒ¦»žö§–>«¢ÞŽ3–’Ÿ–Â?¾ò/–rO¢žK¾ò/žú÷–2[¾ò/–’[–ö‹Ž7šr'¦^s¾ò3¢Þ–öÇž&šJ·–"Ãž²³–æûš‚óž‡¦^pƒŠSŠP(€€€€€€€€€€€€€€ƒ¦C–âŸ–B#š"Cšfžº_’âš²‡žVg¢F_žR£¾ò3’â7žÛš¾?’âš‚ó¦÷¢š–7–k’âš²‡š¢‡žÎ+Ž€¨¼(€€€€€€€€€€€½¹ÍÐµ¬€ôµ…Í­ð‘í5…Ñ ¹É½Õ¹¡¥Ü€¨¬¥õà‘í5…Ñ ¹É½Õ¹¡¥ €¨¬¥õð‘í™%µœ¹¥µI…‘¥ÕÌñð€Áõð‘í™%µœ¹™•…Ñ¡•Éõð‘í­¥¹ñð€œõ€ì(€€€€€€€€€€€±•Ðµ…Í¬€ô±¥Ù”€ü±¥Ù”¹…¡”¹•Ð¡µ¬¤€è¹Õ±°ì(€€€€€€€€€€€¥˜€ …µ…Í¬¤ì(€€€€€€€€€€€€€µ…Í¬€ôµ…­•M¡…Á•5…Í¬¡¥Ü€¨¬°¥ €¨¬°™%µœ¹¥µI…‘¥ÕÌñð€À°™%µœ¹™•…Ñ¡•È°­¥¹¤ì(€€€€€€€€€€€€€¥˜€¡±¥Ù”¤±¥Ù”¹…¡”¹Í•Ð¡µ¬°µ…Í¬¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€ÍŒ¹‘É…Ý%µ…”¡µ…Í¬°€À°€À°¥Ü°¥ ¤ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€ÍŒ¹™¥±±MÑå±”€ô€œŒÀÀÀœì(€€€€€€€€€€€½¹ÍÐH€ô½É¹•ÉH¡™%µœ¹¥µI…‘¥ÕÌñð€À°¥Ü°¥ ¤ì(€€€€€€€€€€€Ý¥Ñ¡%µ=ÕÑ±¥¹”¡ÍŒ°€À°€À°¥Ü°¥ °­¥¹°H°H°À€ôøìÀ€üÍŒ¹™¥±°¡À¤€èÍŒ¹™¥±° ¤ìô¤ì(€€€€€€€€€ô(€€€€€€€€€ÍŒ¹±½‰…±½µÁ½Í¥Ñ•=Á•É…Ñ¥½¸€ô€Í½ÕÉ”µ½Ù•Èœì(€€€€€€€€€½Œ¹±•…ÉI•Ð À°€À°½™˜¹Ý¥‘Ñ °½™˜¹¡•¥¡Ð¤ì(€€€€€€€€€½Œ¹‘É…Ý%µ…”¡Í¡…Á•=¹±ä°ÍÑÉ½­•áÑ•¹Ð°ÍÑÉ½­•áÑ•¹Ð°¥Ü°¥ ¤ì(€€€€€€€ô(€€€€€€€¥˜€¡±Ü€ø€À¤ì(€€€€€€€€€½¹ÍÐÉÀ€ô™%µœ¹¥µI…‘¥ÕÌñð€Àì(€€€€€€€€€½¹ÍÐÍÈ€ôÉÀ€ü½É¹•ÉH¡ÉÀ°¥Ü°¥ ¤€¬ÍÑÉ½­•…À€¬±Ü€¼€È€è€Àì(€€€€€€€€€Ý¥Ñ¡%µ=ÕÑ±¥¹”¡½Œ°±Ü€¼€È°±Ü€¼€È°¥Ü€¬ÍÑÉ½­•…À€¨€È€¬±Ü°¥ €¬ÍÑÉ½­•…À€¨€È€¬±Ü°­¥¹°ÍÈ°ÍÈ°À€ôøì(€€€€€€€€€½Œ¹±¥¹•]¥‘Ñ €ô±Üì(€€€€€€€€€½Œ¹±¥¹•)½¥¸€ô€µ¥Ñ•Èœì(€€€€€€€€€½Œ¹µ¥Ñ•É1¥µ¥Ð€ô€Ðì(€€€€€€€€€€¼¨ƒ¢fožÞkŽ’âšº×žj¦Vß–ê›žR£žÞk–¾³žVÛ–Z»’ö7¾ò À¸ÙøÐ¸Øƒ–7¾ò'¾ò3ž¦ë¦jgšb¿–ºžj€À¸àÔƒ–7¾ò0(€€€€€€€€€€€€ƒš&’î—’â7žº‡¦‚C¢š÷Žžâ»–r[¦
šb¿–2¿–ë¾ò3žr/–"Ãžjž¾––?¦÷’âš¢Ž€¨¼(€€€€€€€€€½¹ÍÐ‘…Í¡X€ô™%µœ¹¥µMÑÉ½­•…Í ñð€Àì(€€€€€€€€€¥˜€¡‘…Í¡X€ø€À¤ì(€€€€€€€€€€€½¹ÍÐÍ•œ€ô±Ü€¨€ À¸Ø€¬€¡‘…Í¡X€¼€ÄÀÀ¤€¨€Ð¤ì(€€€€€€€€€€€½Œ¹Í•Ñ1¥¹•…Í ¡mÍ•œ°Í•œ€¨€À¸àÕt¤ì(€€€€€€€€€€€½Œ¹±¥¹•…À€ô€‰ÕÑÐœì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€½Œ¹Í•Ñ1¥¹•…Í ¡mt¤ì(€€€€€€€€€ô(€€€€€€€€€½Œ¹ÍÑÉ½­•MÑå±”€ô™%µœ¹¥µMÑÉ½­•½±½Èñð€œœì(€€€€€€€€€À€ü½Œ¹ÍÑÉ½­”¡À¤€è½Œ¹ÍÑÉ½­” ¤ì(€€€€€€€€€½Œ¹Í•Ñ1¥¹•…Í ¡mt¤ì(€€€€€€€€€ô¤ì(€€€€€€€ô(€€€€€€€ÍÉŒ€ô½™˜ì(€€€€€€€½¹ÍÐ•áÁ½ÉÑ…À€ô€¡™%µœ¹¥µMÑÉ½­•…Àñð€À¤€¨Í…±•…Ñ½Èì(€€€€€€€‘É…Ý\€ô™Ü€¬€¡ÍÑÉ½­•1Ü€¬•áÁ½ÉÑ…À¤€¨€Èì(€€€€€€€‘É…Ý €ô™ €¬€¡ÍÑÉ½­•1Ü€¬•áÁ½ÉÑ…À¤€¨€Èì(€€€€€ô((€€€€€€¼¼ƒžfó–'¾òk¢Þ¦‚C¢š÷–B3’âšR¿¾ò#šZ–¶_¦
’â'–Æ“žjšþšÞ‡¾ò'¾ò3–ö‹ž.–>[¢«–ÞËžÚO¢Ž––÷žj¦
’â–ò×Ž(€€€€€€¼¼ƒ–'šj#šr³¢ê¯–ú#–æÏšîG¾ò3š&’î—žº_–r£šr'’â+¦fCžj–Â?–ò×’â+–7šRû–’Ÿ¢Êó–n{–:ï¾ò#žrš:'–’Ÿ–r[žjš"Cšr³¾ò'Ž(€€€€€¥˜€¡™%µœ¹¥µ±½Ü¤ì(€€€€€€€½¹ÍÐ‰±ÕÉU¹¥Ð€ô€¡™%µœ¹¥µ±½Ü€¼€ÈÀ¤€¨1=]}	1UI}U9%P€¨Í…±•…Ñ½Èì(€€€€€€€½¹ÍÐÁ…€ô‰±ÕÉU¹¥Ð€¨1=]}aQ9P€¬€Èì(€€€€€€€½¹ÍÐ™Õ±±\€ô‘É…Ý\€¬Á…€¨€Èì(€€€€€€€½¹ÍÐ™Õ±± €ô‘É…Ý €¬Á…€¨€Èì(€€€€€€€½¹ÍÐ¬€ô5…Ñ ¹µ¥¸ Ä°€¡±¥Ù”€ü5…Ñ ¹µ…à ØÐ°5…Ñ ¹µ…à¡™Õ±±\°™Õ±± ¤€¨Ä¤€è€ÄÈÀÀ¤€¼5…Ñ ¹µ…à¡™Õ±±\°™Õ±± ¤¤ì(€€€€€€€½¹ÍÐ±½Ü€ôµ…­•±½Ý…¹Ù…Ì (€€€€€€€€€ÍÉŒ°™Õ±±\€¨¬°™Õ±± €¨¬°(€€€€€€€€€Á…€¨¬°Á…€¨¬°‘É…Ý\€¨¬°‘É…Ý €¨¬°(€€€€€€€€€‰±ÕÉU¹¥Ð€¨¬°™%µœ¹¥µ±½Ý½±½Èñð€œœ°(€€€€€€€€¤ì(€€€€€€€Ñà¹‘É…Ý%µ…”¡±½Ü°€µ‘É…Ý\€¼€È€´Á…°€µ‘É…Ý €¼€È€´Á…°™Õ±±\°™Õ±± ¤ì(€€€€€ô(€€€€€Ñà¹‘É…Ý%µ…”¡ÍÉŒ°€µ‘É…Ý\€¼€È°€µ‘É…Ý €¼€È°‘É…Ý\°‘É…Ý ¤ì(€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€¥˜€¡™É…µ”¤Ñà¹É•ÍÑ½É” ¤ì(€€€ô(€ôì(((€€¼¨€´´´´%ƒ¢ÊóšZ¦‚C¢šô€´´´´€¨¼(€€¼¨¨(€€€¨ƒžnÓ–ò<€ÈèÌƒ¢"€äèÄØƒš¾P%ƒžjš–×¦fC¾ò Ðè×¾ò'¦
¢ššnÓ¦Vß¾ò1%ƒš‚çšr³–B’â7’â/¾ò0(€€€¨ƒ¦‚C¢š÷–ë’ú’æ’â7šb¿žfóšZ–ú3žjš¢–¶@ƒŠSŠPƒ¦g–§ž¢»š¾S’ú/žnÓš:—’â7žÖ›¦‚C¢š÷¾ò0(€€€¨ƒŽ3šnÓ–’kŽ7¦ã–Z»¢Ž‡¦¦
¦†š2'¦"W¦÷’â7–ëž>û¾ò#’â7žR£¢ÞÏ’îï’öWš>Cž’ë¾ò'Ž(€€€¨ƒš¦¯¦;’úžj€ÌèËŽÄØèäƒ–r %ƒžjš¦¯–ò?ž¾–r7–Ÿ¾ò3žŸ–âã–>¿’î—¦‚C¢š÷Ž(€€€¨¼(€½¹ÍÐ¥AÉ•Ù¥•ÝMÕÁÁ½ÉÑ•€ô€  ¤€ôøì(€€€¥˜€¡ÁÉ•Ù¥•Ý €ðôÁÉ•Ù¥•Ý\¤É•ÑÕÉ¸ÑÉÕ”ì€€€€€€€€€€¼¼ƒš¶šZç–ö‹¢"š¦¯–ò?¦÷šÊK–V?¦†0(€€€½¹ÍÐÈ€ôÁÉ•Ù¥•Ý\€¼ÁÉ•Ù¥•Ý ì(€€€É•ÑÕÉ¸€„ 5…Ñ ¹…‰Ì¡È€´€È€¼€Ì¤€ð€À¸ÀÄñð5…Ñ ¹…‰Ì¡È€´€ä€¼€ÄØ¤€ð€À¸ÀÄ€¤ì(€ô¤ ¤ì(€€¼¨%ƒ¦‚C¢š÷¦†¿ž’ëžj–ÂÇšb¿Ž3–2¿–ëžjš"C–NŽ7šr³’êèƒŠSŠPƒš&O¦Z/šfžR£–B3’âšR¼¡…¹‘±•áÁ½ÉÐ(€€€€ƒžº_’âš²‡¾ò#–ŽO’ö;¢žšzC–ê›Ž’â7–.W’îï’öWžV¯¦v‹ž.š/¾ò'¾ò3¦†¿ž’ë–n{–
Ïžj¦
–æû–ò×–r[Ž(€€€€ƒ’î—–&4%ƒ¦‚C¢š÷šb¿–>›–’[žR =4ƒ¦7žV¯’âš²‡¾ò3–§’î÷ž¢/–ò?žŠóšÂã¦ƒšršr'–Â7’â7’â+žj–rÃšZä(€€€€ƒ¾ò#š¾S’ú/Ž¢Ž–"Ž¢Þ£¦‚Žš²‡–?žÒƒŠ›¾ò'¾ò3šRçš"C–ÇžR£–B3’âšŠwžº‡žÞk–ÂÇ’â7–>¿¢÷’â7’âš¢Ž€¨¼(€½¹ÍÐm¥M¡½ÑÌ°Í•Ñ%M¡½ÑÍt€ôÕÍ•MÑ…Ñ”ñÍÑÉ¥¹mtø¡mt¤ì(€€¼¨¨ƒš¾?’â¦‚žjš"C–Nšb¿–r[¦
šb¿–öÇž&¾ò#–öÇž&¦
–æû¦‚¢ššRø€ñÙ¥‘•¼øƒš&7šr–.W¾ò$€¨¼(€½¹ÍÐm¥-¥¹‘Ì°Í•Ñ%-¥¹‘Ít€ôÕÍ•MÑ…Ñ”ð ¥µ…”œð€Ù¥‘•¼œ¥mtø¡mt¤ì(€€¼¨¨ƒšr'–öÇž&žj¦
–æû¦‚¾òk’â–ò×š2žê3¦7žV¯žjžV¯–â¾ò3žnÓš:—š:o–"À%ƒ¦‚C¢š÷¢Ž„€¨¼(€½¹ÍÐm¥…¹Ù…Í•Ì°Í•Ñ%…¹Ù…Í•Ít€ôÕÍ•MÑ…Ñ”ð¡!Q51…¹Ù…Í±•µ•¹Ðð¹Õ±°¥mtø¡mt¤ì(€½¹ÍÐ¥M¡½ÑÍI•˜€ôÕÍ•I•˜ñÍÑÉ¥¹mtø¡mt¤ì(€½¹ÍÐ¥1¥Ù•I•˜€ôÕÍ•I•˜ñ1¥Ù•A…•mtø¡mt¤ì(€ÕÍ•™™•Ð  ¤€ôøì(€€€¥˜€ …¥AÉ•Ù¥•Ü¤É•ÑÕÉ¸ì(€€€±•Ð…±¥Ù”€ôÑÉÕ”ì(€€€½¹ÍÐÍÑ½Á1¥Ù”€ô€ ¤€ôøì¥1¥Ù•I•˜¹ÕÉÉ•¹Ð¹™½É… ¡°€ôø°€˜˜°¹ÍÑ½À ¤¤ì¥1¥Ù•I•˜¹ÕÉÉ•¹Ð€ômtìôì(€€€€¡…Íå¹Œ€ ¤€ôøì(€€€€€€¼¨ƒ¦g’âžZ+¢Ž‡šr'–öÇž&–^;Žšr'žj¢¦Ç–ÂÇ¢ÖÃŽ3ž>û–‚Ó–B#š"CŽ7¦
šŠw¢Þ¿¾òh(€€€€€€€€ƒšr'–öÇž&žj¦
–æû¦‚’ê“–ë’â–ò×’âžnÓ–r£¦7žV¯žjžV¯–â¾ò3š&O¦Z/žjžVÛ’â/–ÂÇ–r£–.WŽ(€€€€€€€€ƒ’î—–&7šb¿–#–ë¦vsš/–r[Ž¢3šf¿–7žR 5•‘¥…I•½É‘•Èƒ¦2’âšº×žrš¶žj–öÇž&š>o’â+–:ìƒŠSŠP(€€€€€€€€ƒ¦2–öÇšb¿–6Ïšfžj¾ò3–¯žžKžjž&–¶C–ÂÇ¢šž¶'–¯žžK¾ò#Ž3–&o¦Z/–ž/¦÷’â7šr–.WŽ¢šž¶'–ú#’æŽ7¾ò'¾ò0(€€€€€€€€ƒ¢3’âS¦2žjšf–gžÞ£žŠó–f£¢Þ–B#š"CšBØAW¾ò3š:'žjš‚óšb¿žnÓš:—ž“¦ËšªSš†#¢Ž‡žj¾ò#Ž3šJ·¢Öß’ú–ú#–6‡Ž7¾ò'Ž€¨¼(€€€€€€¼¨%ƒ¦‚C¢š÷’â7–>«–öÇž&¢šš2žê3¦7žV¯¾òo¦‚¦v‹’â+–>«¢ššr'žÚO–ãš.ó–r[–.WžV¯¾ò3’æ–þ¦‚#¢ÖÀ(€€€€€€€€ƒ–B3’â–ò×–6Ïšf–B#š"@…¹Ù…ÏŽ–B›–&¦‚C¢š÷š.ÿ–"Ãžj–>«šb¿–.WžV¯ž²°€Àƒ–æ¦vsš,A9Ž€¨¼(€€€€€½¹ÍÐ¹••‘Í1¥Ù•AÉ•Ù¥•Ü€ôÁ…•Ì¹Í½µ” ¡}À°¤¤€ôø¥A…•!…ÍY¥‘•½I•˜¹ÕÉÉ•¹Ð¡¤¤¤ñð…¹å±…ÍÍ¥5½Ñ¥½¸ì(€€€€€½¹ÍÐ½ÁÑÌ€ô¹••‘Í1¥Ù•AÉ•Ù¥•Ü(€€€€€€€€üìÍ¥±•¹ÐèÑÉÕ”…Ì½¹ÍÐ°ÁÉ•Ù¥•Ý]¥‘Ñ è€äÀÀ°±¥Ù”èÑÉÕ”ô(€€€€€€€€èìÍ¥±•¹ÐèÑÉÕ”…Ì½¹ÍÐ°ÁÉ•Ù¥•Ý]¥‘Ñ è€äÀÀ°ÍÑ¥±±=¹±äèÑÉÕ”ôì(€€€€€±•ÐÈ€ô…Ý…¥Ð¡…¹‘±•áÁ½ÉÐ¡½ÁÑÌ¤ì(€€€€€±•ÐÕÉ±Ì€ô€¡È€˜˜€ÕÉ±Ìœ¥¸È¤€üÈ¹ÕÉ±Ì€èmtì(€€€€€€¼¼ƒ–Ûž"ûž²³’âš²‡šržº_’â7–ë’ú¾ò#–r[¦
šÊK¢žžŠó–º3’æ/¦†{¾ò'¾ò3¦jS’â’â/–7¢¦›’âš²„(€€€€€¥˜€ …ÕÉ±Ì¹±•¹Ñ €˜˜…±¥Ù”¤ì(€€€€€€€¥˜€¡È€˜˜€±¥Ù”œ¥¸È€˜˜È¹±¥Ù”¤È¹±¥Ù”¹™½É… ¡°€ôø°€˜˜°¹ÍÑ½À ¤¤ì(€€€€€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í”¡É•Ì€ôøÍ•ÑQ¥µ•½ÕÐ¡É•Ì°€ÐÀÀ¤¤ì(€€€€€€€È€ô…Ý…¥Ð¡…¹‘±•áÁ½ÉÐ¡½ÁÑÌ¤ì(€€€€€€€ÕÉ±Ì€ô€¡È€˜˜€ÕÉ±Ìœ¥¸È¤€üÈ¹ÕÉ±Ì€èmtì(€€€€€ô(€€€€€½¹ÍÐ±¥Ù”€ô€¡È€˜˜€±¥Ù”œ¥¸È€˜˜È¹±¥Ù”¤€üÈ¹±¥Ù”€èmtì(€€€€€¥˜€ ……±¥Ù”ñð€…ÕÉ±Ì¹±•¹Ñ ¤ì(€€€€€€€ÕÉ±Ì¹™½É… ¡Ô€ôøUI0¹É•Ù½­•=‰©•ÑUI0¡Ô¤¤ì(€€€€€€€±¥Ù”¹™½É… ¡°€ôø°€˜˜°¹ÍÑ½À ¤¤ì(€€€€€€€É•ÑÕÉ¸ì€€€¼¼ƒžº_’â7–ë’ú–ÂÇžVg¢F_–
gš>Ó¾ò3’â7¢ššâš"Cž¦ëžfô(€€€€€ô(€€€€€€¼¨ƒ–#š*+š¾?’â–ò×¦÷¢žžŠó–º3–7’ê“žÖ›žV¯¦v‹Ž(€€€€€€€€ƒ’î—–&7šb¿š.ÿ–"ÃžÚË–v–ÂÇž®/–"ìÍ•ÑMÑ…Ñ—¾ò0ñ¥µœøƒ¦
–r£¢žžŠóžj¦
–æûžfûš¾¯žžKžV¯¦v‹’â+šb¿ž¦ëžj¾ò0(€€€€€€€€ƒžr/¢Öß’ú–ÂÇšb¿Ž3¦È%ƒ¦‚C¢š÷šfšVÓž&žf÷Ž7Žž¶'¢žžŠó–º3–7š>o–ÂÇšÊKšr'¦
šº×ž¦ëžª_Ž€¨¼(€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±°¡ÕÉ±Ì¹µ…À¡Ô€ôø¹•ÜAÉ½µ¥Í”ñÙ½¥ø¡É•Ì€ôøì(€€€€€€€½¹ÍÐ¥´€ô¹•Ü%µ…” ¤ì(€€€€€€€¥´¹½¹±½…€ô€ ¤€ôøÉ•Ì ¤ì(€€€€€€€¥´¹½¹•ÉÉ½È€ô€ ¤€ôøÉ•Ì ¤ì(€€€€€€€¥´¹ÍÉŒ€ôÔì(€€€€€ô¤¤¤ì(€€€€€¥˜€ ……±¥Ù”¤ìÕÉ±Ì¹™½É… ¡Ô€ôøUI0¹É•Ù½­•=‰©•ÑUI0¡Ô¤¤ì±¥Ù”¹™½É… ¡°€ôø°€˜˜°¹ÍÑ½À ¤¤ìÉ•ÑÕÉ¸ìô(€€€€€¥M¡½ÑÍI•˜¹ÕÉÉ•¹Ð¹™½É… ¡Ô€ôøUI0¹É•Ù½­•=‰©•ÑUI0¡Ô¤¤ì(€€€€€¥M¡½ÑÍI•˜¹ÕÉÉ•¹Ð€ôÕÉ±Ìì(€€€€€ÍÑ½Á1¥Ù” ¤ì(€€€€€¥1¥Ù•I•˜¹ÕÉÉ•¹Ð€ô±¥Ù”ì(€€€€€Í•Ñ%M¡½ÑÌ¡ÕÉ±Ì¤ì(€€€€€Í•Ñ%-¥¹‘Ì¡ÕÉ±Ì¹µ…À  ¤€ôø€¥µ…”œ…Ì½¹ÍÐ¤¤ì(€€€€€Í•Ñ%…¹Ù…Í•Ì¡ÕÉ±Ì¹µ…À ¡}Ô°¤¤€ôø€¡±¥Ù•m¥t€ü±¥Ù•m¥t„¹…¹Ù…Ì€è¹Õ±°¤¤¤ì(€€€ô¤ ¤ì(€€€É•ÑÕÉ¸€ ¤€ôøì(€€€€€…±¥Ù”€ô™…±Í”ì(€€€€€ÍÑ½Á1¥Ù” ¤ì(€€€€€¥M¡½ÑÍI•˜¹ÕÉÉ•¹Ð¹™½É… ¡Ô€ôøUI0¹É•Ù½­•=‰©•ÑUI0¡Ô¤¤ì(€€€€€¥M¡½ÑÍI•˜¹ÕÉÉ•¹Ð€ômtì(€€€€€Í•Ñ%M¡½ÑÌ¡mt¤ì(€€€€€Í•Ñ%-¥¹‘Ì¡mt¤ì(€€€€€Í•Ñ%…¹Ù…Í•Ì¡mt¤ì(€€€ôì(€ô°m¥AÉ•Ù¥•Ýt¤ì(€€¼¨¨ƒ¦‚·–?¢"Ž3¢ª«¢ºkŽ7¦
š:Kžj–Â?¦‚·–?¾òkžnÓš:—š.ÿš.ó–r[¢Ž‡žjžŸž&’úžR£¾ò3žr/¢Öß’úš&7–?žržj¢ÊóšZ€¨¼(€½¹ÍÐ¥…•Ì€ô€  ¤€ôøì(€€€½¹ÍÐ½ÕÐèÍÑÉ¥¹mt€ômtì(€€€½¹ÍÐÁÕÍ €ô€¡ÌüèÍÑÉ¥¹œ¤€ôøì¥˜€¡Ì€˜˜½ÕÐ¹±•¹Ñ €ð€Ì€˜˜€…½ÕÐ¹¥¹±Õ‘•Ì¡Ì¤¤½ÕÐ¹ÁÕÍ ¡Ì¤ìôì(€€€™±½…Ñ¥¹%µ…•Ì¹™½É… ¡˜€ôøì¥˜€¡˜¹Ñ•áÐ€ôôôÕ¹‘•™¥¹•€˜˜€…˜¹¥ÍY¥‘•¼¤ÁÕÍ ¡˜¹ÍÉŒ¤ìô¤ì(€€€Á…•Ì¹™½É… ¡À€ôøÀ¹±…å½ÕÑÌ¹™½É… ¡°€ôø°¹¥µ…•Ì¹™½É… ¡¥´€ôøÁÕÍ ¡¥´ü¹ÕÉ°¤¤¤¤ì(€€€É•ÑÕÉ¸m½ÕÑlÁtñð€œœ°½ÕÑlÅtñð€œœ°½ÕÑlÉtñð€œtì(€ô¤ ¤ì(€€¼¨¨ƒ¦g’â¦‚šr'šÊKšr'–öÇž&€¨¼(€½¹ÍÐ¥A…•!…ÍY¥‘•¼€ô€¡Á…•%‘àè¹Õµ‰•È¤€ôø(€€€™±½…Ñ¥¹%µ…•Ì¹Í½µ”¡˜€ôø˜¹¥ÍY¥‘•¼€˜˜˜¹ÍÉŒ€˜˜Á…•=™±½…Ñ¥¹œ¡˜°ÁÉ•Ù¥•Ý\€¬€Ä°Á…•Ì¹±•¹Ñ ¤€ôôôÁ…•%‘à¤ì(€€¼¨ƒ’â+¦v‹¦
šR¼%ƒ¦‚C¢š÷žj•™™•Ðƒ–>«–r£Ž3š&O¦Z/¦‚C¢š÷Ž7šf¢ÞG’âš²‡¾ò3žnã’úw¢Ž‡’â7šRø™±½…Ñ¥¹%µ…•Ì(€€€€ƒ¾ò#šRû’êžj¢¦Çš.[’â’â/–r[–Æ“–ÂÇšVÓ–/¦7žº_’âš²‡¾ò'Žš&’î—žR É•˜ƒš.ÿ–"ÃšršZÃžj¦
’â’î÷Ž€¨¼(€½¹ÍÐ¥A…•!…ÍY¥‘•½I•˜€ôÕÍ•I•˜¡¥A…•!…ÍY¥‘•¼¤ì(€¥A…•!…ÍY¥‘•½I•˜¹ÕÉÉ•¹Ð€ô¥A…•!…ÍY¥‘•¼ì((€€¼¨ƒ¦g¢Ž‡šr³’úšr'’âšR¼É•¹‘•É5¥¹¥A…—¾ò#¦–B3–º–Â#žR£žj5¥¹¥M¡…Á•%µ…—¾ò'ŠSŠP(€€€€ƒ¦
šb¿¢"+ž&#Ž1%ƒ¦‚C¢š÷¢«–ÞÇžR =4ƒ¦7žV¯’âš²‡Ž7žVg’â/’úžjŽ	%ƒ¦‚C¢š÷š^§–ÂÇšRçš"@(€€€€ƒžnÓš:—¦†¿ž’ë–2¿–ëš"C–N¾ò#¢š/’â+¦vˆ¥M¡½ÑÏ¾ò'¾ò3¦g’âšVÓšº×–ÞËžÚOšÊKšr'’îï’öW’êë–Fó–>¯¾ò0(€€€€ƒžVg¢F_–>«šr¢ºO’êë’î—ž
è%ƒ¦‚C¢š÷¢ÖÃžjšb¿–ºŽšVÓšº×žžï¦f“Ž€¨¼((€€¼¼áÁ½ÉÐÑ¼…¹Ù…Ì(€€¼¨¨(€€€¨ƒ–2¿–ëŽ(€€€¨Í¥±•¹Ð€ôÑÉÕ”ƒšf’â7–.W’îï’öWžV¯¦v‹ž.š/¾ò3žnÓš:—š*+š¾?’â¦‚žj–r[–n{–
ÌƒŠSŠP(€€€¨%ƒ¦‚C¢š÷–ÂÇšb¿¦vƒ¦g–/¦†¿ž’ëŽ3¢Þ–2¿–ë’âš¢‡’âš¢Ž7žjžV¯¦v‹¾ò#–B3’âšR¿ž¢/–ò?žŠóŽ–B3’âšŠwžº‡žÞk¾ò0(€€€¨ƒ–ºkžú§’â+’â7–>¿¢÷’â7’âš¢¾ò'Ž	ÁÉ•Ù¥•Ý]¥‘Ñ ƒžR£’ú–ŽO’ö;¢žšzC–ê›¾ò3¦‚C¢š÷’â7¦r¢š€ÐÀäÛŽ(€€€¨(€€€¨ÍÑ¥±±=¹±ä€ôÑÉÕ—¾òkšr'–öÇž&žj¦
’â¦‚’æ–ëŽ3’â–ò×–r[Ž7¾ò3’â7–:ï¦2–öÇž&Ž(€€€¨%ƒ¦‚C¢š÷¢"š¶ß–>ËžÒ¦2žâ»–r[¦÷–>«¦r¢š’â–ò×–rXƒŠSŠPƒ’î—–&7¦g–§–/–rÃšZçšrž
ë’ê’â–ò×žâ»–rX(€€€¨ƒ–:ï¦2’âšº×–º3šVÓžj–öÇž&¾ò#–¾›šâ°€àƒžžK¾ò'¾ò3¢0%AÉ•Ù¥•Üƒš.ÿ–"Ã–öÇž&žÚË–všb¿–†{¦È€ñ¥µœû¾ò0(€€€¨ƒžÖCšzs–ÂÇšb¼¨«šr'–öÇž&šf%ƒ¦‚C¢š÷šVÓž&ž¦ëžfô¨«Ž¦n‹¦Z/š.ó–r[’æ¢š–’kž¶'––÷–æûžžKŽ(€€€¨¼(€½¹ÍÐ¡…¹‘±•áÁ½ÉÐ€ô…Íå¹Œ€ (€€€½ÁÑÌüèìÍ¥±•¹Ðüè‰½½±•…¸ìÁÉ•Ù¥•Ý]¥‘Ñ üè¹Õµ‰•ÈìÍÑ¥±±=¹±äüè‰½½±•…¸ì±¥Ù”üè‰½½±•…¸ô°(€€¤èAÉ½µ¥Í”ñìÕÉ±ÌèÍÑÉ¥¹mtì­¥¹‘Ìè€ ¥µ…”œð€Ù¥‘•¼œ¥mtì±¥Ù”üè1¥Ù•A…•mtôðÙ½¥ø€ôøì(€€€¥˜€¡Á…•Ì¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸ì(€€€½¹ÍÐÍ¥±•¹Ð€ô€„…½ÁÑÌü¹Í¥±•¹Ðì(€€€½¹ÍÐÍÑ¥±±=¹±ä€ô€„…½ÁÑÌü¹ÍÑ¥±±=¹±äì(€€€¥˜€ …Í¥±•¹Ð¤Í•ÑáÁ½ÉÑMÑ…Ñ” ÁÉ½•ÍÍ¥¹œœ¤ì(€€€Ù¥‘•½‰½ÉÑI•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€¼¨ƒ¦g’â¢ò«žj¢fžŠóŽ’öÿžR£¢š2'Ž3–>[šÚ#–2¿–ëŽ7šf¢fžŠóšr¢Š¯š:£¢ÖÃ¾ò1…¹•±±• ¤ƒ–ÂÇš"Cž®/Ž(€€€€€€Í¥±•¹Ó¾ò#¢3šf¿¾ò'¦
–æû¢ò«šÂã¦ƒšb¼™…±Í”ƒŠSŠPƒ–º–GšÊKšr'–>[šÚ#¦6×¾ò3’æ’â7¢¦Ë¢Š¯–>[šÚ#Ž€¨¼(€€€½¹ÍÐÉÕ¹%€ôÍ¥±•¹Ð€ü€´Ä€è€¬­•áÁ½ÉÑIÕ¹I•˜¹ÕÉÉ•¹Ðì(€€€½¹ÍÐ…¹•±±•€ô€ ¤€ôø€…Í¥±•¹Ð€˜˜•áÁ½ÉÑIÕ¹I•˜¹ÕÉÉ•¹Ð€„ôôÉÕ¹%ì(€€€€¼¨¨ƒ–ÞËžÚOžR‹–ëžjžÚË–v–r£’â·¦SšRûšŽšf¢ššRÛ–n{–:ï¾ò3’â7žÛ¦
–æû–,‰±½ˆƒšr’âžnÓžVg–r£¢¢cšÛ¦®P€¨¼(€€€½¹ÍÐ‘É½ÁUÉ±Ì€ô€¡±¥ÍÐèÍÑÉ¥¹mt¤€ôøì±¥ÍÐ¹™½É… ¡Ô€ôøìÑÉäìUI0¹É•Ù½­•=‰©•ÑUI0¡Ô¤ìô…Ñ ì€¼¨¥¹½É”€¨¼ôô¤ìôì(€€€€¼¨±¥Ù”€ôÑÉÕ—¾òkšr'–öÇž&žj¦
–æû¦‚’â7¦2–öÇ¾ò3šRçš"C’ê“–ë’â–ò×Ž3’âžnÓ–r£¦7žV¯žjžV¯–âŽ4(€€€€€€ƒ¾ò!%ƒ¦‚C¢š÷žR£¾ò'Ž¦
–æû¦‚žŸš¢’æšr–ë’â–ò×¦vsš/–r[žVÛ–êW¾ò3žV¯–â¦
šÊKš:—’â+šf–#¦‚¢F_Ž€¨¼(€€€½¹ÍÐ±¥Ù”€ô€„…½ÁÑÌü¹±¥Ù”ì(€€€½¹ÍÐ±¥Ù•A…•Ìè1¥Ù•A…•mt€ômtì((€€€ÑÉäì(€€€€€½¹ÍÐ…¹Ù…Ì€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð …¹Ù…Ìœ¤ì(€€€€€€¼¨ƒ–Â;–ë¦>#’â+žjžV¯–âžR ¥ÍÁ±…ä@Ï¾òkžŸž&šr³¢ê¯žj–î¢&Ë–~’â7šr–r£¦g¢Ž‡¢Š¯¢Žš:'Ž(€€€€€€€€ƒ–ÞËžÚO––_¦;ž&çšV#žj¦
’êošb¼ÍIƒžjžV¯–â¾ò3žV¯¦Ë’úšfž?¢š÷–f£šr–k¢&Ë–ö§žº‡žB¢ö'š>o¾ò0(€€€€€€€€ƒžr/¢Öß’ú–º3–£’âš¢ŒƒŠSŠPƒš&’î—ž>ûšr'š"C–Nžjš¢–¶C’â7šr¢º+Ž€¨¼(€€€€€½¹ÍÐÑà€ô•ÐÉ‘]¥‘”¡…¹Ù…Ì¤„ì((€€€€€€¼¼ƒ¢òã–ë–¾³–ê›¢Þ¢F_¦‚¦v‹¢Ž‡šr–’Ÿžj–:–r[¢ÖÃ¾ò3¢3’â7šb¿šÂã¦ƒ–ŽO–r €ÄàÀÃŽ(€€€€€€¼¼ƒ–:šr°€ÐÀÀÁÁàƒžjžŸž&–¶c–ë’ú–>«–&§’â7–"Ã’â–6+žjžÒÃž¾Ž’â+¦f@€ÐÀäØƒšb¿ž
ë’ê¦ÿ–4(€€€€€€¼¼ƒ–’k¦‚šf¦VßšŠwžV¯–â¢Ú¦;ž?¢š÷–f£žj–Z»’â …¹Ù…Ìƒ–Âë–¾ã¦fC–"ÛŽ(€€€€€½¹ÍÐÍ½ÕÉ•]¥‘Ñ¡Ìè¹Õµ‰•Émt€ômtì(€€€€€™½È€¡½¹ÍÐÁœ½˜Á…•Ì¤ì(€€€€€€€™½È€¡½¹ÍÐ±…ä½˜Áœ¹±…å½ÕÑÌ¤ì(€€€€€€€€€½¹ÍÐÑÁ±Ì€ôQ5A1Q}5Am±…ä¹¥µ…•Ì¹±•¹Ñ¡tñðmtì(€€€€€€€€€½¹ÍÐÑÁ°€ôÑÁ±Ím±…ä¹Ñ•µÁ±…Ñ•%¹‘•átñðÑÁ±ÍlÁtì(€€€€€€€€€±…ä¹¥µ…•Ì¹™½É…  ¡Œ°¤¤€ôøì(€€€€€€€€€€€½¹ÍÐÈ€ôÑÁ°ü¹É•ÑÍm¥tì(€€€€€€€€€€€€¼¼ƒš‚ó–¶C–>«’öS¦‚¦v‹žj’â¦£–"¾ò#–7’æc’â+’ö#–Æšr³¢ê¯žjžâ»šRû¾ò'¾ò3š>ožº_–n{šVÓ¦‚¦r¢šžj¢žšzC–ê˜(€€€€€€€€€€€½¹ÍÐ™É…Œ€ô5…Ñ ¹µ…à À¸ÀÔ°€¡Èü¹Ü€üü€Ä¤€¨€¡±…ä¹Ðü¹Í…±”€üü€Ä¤¤ì(€€€€€€€€€€€¥˜€¡Œ¹ÕÉ°€˜˜Œ¹¹…ÑÕÉ…±]¥‘Ñ €˜˜È¤Í½ÕÉ•]¥‘Ñ¡Ì¹ÁÕÍ ¡Œ¹¹…ÑÕÉ…±]¥‘Ñ €¼™É…Œ¤ì(€€€€€€€€€ô¤ì(€€€€€€€ô(€€€€€ô(€€€€€™½È€¡½¹ÍÐ˜½˜™±½…Ñ¥¹%µ…•Ì¤ì(€€€€€€€½¹ÍÐ€ô˜¹¥ÍY¥‘•¼€ü…Ý…¥Ð•ÑY¥‘•½¥µ•¹Í¥½¹Ì¡˜¹ÍÉŒ¤€è…Ý…¥Ð•Ñ%µ…•¥µ•¹Í¥½¹Ì¡˜¹ÍÉŒ¤ì(€€€€€€€€¼¼ƒ–r[–Æ“–r£ž&#¦v‹’â+–>«’öS’â¦£–"–¾³–ê›¾ò3š>ožº_–n{šVÓ¦‚¦r¢šžj¢žšzC–ê˜(€€€€€€€½¹ÍÐ™É…Œ€ô5…Ñ ¹µ…à À¸ÀÔ°€¡˜¹Ý¥‘Ñ €¨˜¹Í…±”¤€¼ÁÉ•Ù¥•Ý\¤ì(€€€€€€€Í½ÕÉ•]¥‘Ñ¡Ì¹ÁÕÍ ¡¹Ý¥‘Ñ €¼™É…Œ¤ì(€€€€€ô(€€€€€½¹ÍÐÝ…¹Ñ•€ôÍ½ÕÉ•]¥‘Ñ¡Ì¹±•¹Ñ €ü5…Ñ ¹µ…à ¸¸¹Í½ÕÉ•]¥‘Ñ¡Ì¤€è€ÄàÀÀì(€€€€€€¼¼ƒš¾?’â¦‚–B¢«¢òã–ë’â–ò×žV¯–â¾ò3š&’î—’â+¦fC’â7–7¢Š¯¦‚šVãžNs–"(€€€€€½¹ÍÐÑ…É•Ñ\€ô½ÁÑÌü¹ÁÉ•Ù¥•Ý]¥‘Ñ (€€€€€€€€ü5…Ñ ¹µ…à ÌÈÀ°5…Ñ ¹É½Õ¹¡½ÁÑÌ¹ÁÉ•Ù¥•Ý]¥‘Ñ ¤¤(€€€€€€€€è5…Ñ ¹µ…à ÄàÀÀ°5…Ñ ¹µ¥¸ ÐÀäØ°5…Ñ ¹É½Õ¹¡Ý…¹Ñ•¤¤¤ì(€€€€€±•ÐÑ…É•Ñ €ôÑ…É•Ñ\ì((€€€€€¥˜€¡Í•±•Ñ•‘I…Ñ¥¼€ôôô€œÄèÄœ¤ì(€€€€€€€Ñ…É•Ñ €ôÑ…É•Ñ\ì(€€€€€ô•±Í”¥˜€¡Í•±•Ñ•‘I…Ñ¥¼€ôôô€œÌèÐœ¤ì(€€€€€€€Ñ…É•Ñ €ô5…Ñ ¹É½Õ¹¡¥Í1…¹‘Í…Á”€üÑ…É•Ñ\€¨€ Ì€¼€Ð¤€èÑ…É•Ñ\€¨€ Ð€¼€Ì¤¤ì(€€€€€ô•±Í”¥˜€¡Í•±•Ñ•‘I…Ñ¥¼€ôôô€œÈèÌœ¤ì(€€€€€€€Ñ…É•Ñ €ô5…Ñ ¹É½Õ¹¡¥Í1…¹‘Í…Á”€üÑ…É•Ñ\€¨€ È€¼€Ì¤€èÑ…É•Ñ\€¨€ Ì€¼€È¤¤ì(€€€€€ô•±Í”¥˜€¡Í•±•Ñ•‘I…Ñ¥¼€ôôô€œäèÄØœ¤ì(€€€€€€€Ñ…É•Ñ €ô5…Ñ ¹É½Õ¹¡¥Í1…¹‘Í…Á”€üÑ…É•Ñ\€¨€ ä€¼€ÄØ¤€èÑ…É•Ñ\€¨€ ÄØ€¼€ä¤¤ì(€€€€€ô•±Í”¥˜€¡Í•±•Ñ•‘I…Ñ¥¼€ôôô€œÐèÔœ¤ì(€€€€€€€Ñ…É•Ñ €ô5…Ñ ¹É½Õ¹¡¥Í1…¹‘Í…Á”€üÑ…É•Ñ\€¨€ Ð€¼€Ô¤€èÑ…É•Ñ\€¨€ Ô€¼€Ð¤¤ì(€€€€€ô((€€€€€½¹ÍÐÍ…±•…Ñ½È€ôÑ…É•Ñ\€¼ÁÉ•Ù¥•Ý\ì(€€€€€€¼¨ƒ¦®c–ê›’â–ºk¢ššb¿Ž3¦‚C¢š÷¦®c–ê˜ƒ\ƒ–B3’â–/žâ»šRû–7ž:Ž7¾ò3’â7¢÷žR£š¾S’ú/–³–ò?–>›–’[žº_Ž(€€€€€€€€ÁÉ•Ù¥•Ý ƒšb¿¦?–ë’úžj–¾›¦jo–?žÒƒ¾ò#–B¯–Â?šVã¾ò'¾ò3¢Þ–³–ò?žº_–ë’úžj–óšr–Þ»–æû–,Áã¾òl(€€€€€€€€ƒ¢3š&šr'ž&§’îÛžj–êŸš¢g¦÷šb¿’æ`Í…±•…Ñ½Èƒš>ožº_¦;–:ïžjƒŠSŠPƒ–§¦
+–Â7’â7’â+žj¢¦Ç¾ò0(€€€€€€€€ƒšNë–r£¦‚¦v‹š¶’â·–’»žj–r[¾ò3–2¿–ë–ú3–ÂÇšr–?¦n‹’â·–þ¾ò#–Þ»–’k–ÂG–ÂÇ–?–’k–ÂGžj’â–6+¾ò'Ž(€€€€€€€€ƒ¦g’æšb¼%ƒ¦‚C¢š÷žr/¢Öß’úŽ3–r[š¾S¢ò¦vƒ¢þG’â/¦v‹Ž7žj–:–nƒ¾ò3–nƒž
ë–º¦†¿ž’ëžj–ÂÇšb¿–2¿–ë–r[Ž€¨¼(€€€€€€¼¨ƒ¦g¢Ž‡¢šžR ™±½½Èƒ’â7¢÷žR É½Õ¹“¾òiÉ½Õ¹ƒšr'’â–6+š¦ž:–ú’â+¦Ë’ö7¾ò3žV¯–â–ÂÇš¾P(€€€€€€€€ƒ–Ÿ–ºç¦®c’ê’â7–"À€ÅÁàƒŠSŠPƒ¦
’â–"_šÊKšr'’îï’öWšvÇ¢–ÿ¢N/–"Ã¾ò3¦rË–ë’úžj–ÂÇšb¿žV¯–â–êW¢&Ë¾ò0(€€€€€€€€ƒ–r %ƒ¦‚C¢š÷¾ò#¦†¿ž’ëžj–ÂÇšb¿¦g–ò×–2¿–ë–r[¾ò'’â/žÞžr/–"Ãžj¦
šŠwžf÷žÞk–ÂÇšb¿–ºŽ(€€€€€€€€ƒ–ú’â/–>[šVÓ’æ/–ú3žV¯–âšÂã¦ƒ’â7šrš¾S–Ÿ–ºç¦®c¾ò3žf÷žÞk’â7–>¿¢÷–ëž>ûŽ€¨¼(€€€€€Ñ…É•Ñ €ô5…Ñ ¹™±½½È¡ÁÉ•Ù¥•Ý €¨Í…±•…Ñ½È¤ì((€€€€€…¹Ù…Ì¹Ý¥‘Ñ €ôÑ…É•Ñ\ì(€€€€€…¹Ù…Ì¹¡•¥¡Ð€ôÑ…É•Ñ ì((€€€€€€¼¼ƒš¾?–/ž&§’îÛ’î7žÛžR£Ž3šVÓšŠw¦‚¦v‹–âÛŽ7žj–êŸš¢g¢¢#žº_¾ò3žV¯žjšf–g–7š*+žV¯–â–æÏžžï–"Ã¢¦Ë¦‚¾ò0(€€€€€€¼¼ƒš&’î—¢Š¯š.[–"Ã¦jS–Ž¦‚žjšvÇ¢–ÿ’âš¢šrš¶žŠëš:—žê3¦;–:ïŽ(€€€€€½¹ÍÐ‘É…ÝA…•1…å½ÕÐ€ô…Íå¹Œ€¡Ñàè…¹Ù…ÍI•¹‘•É¥¹½¹Ñ•áÐÉ°Á…•%‘àè¹Õµ‰•È°±…å½ÕÐè1…å½ÕÑ%Ñ•´¤€ôøì(€€€€€€€½¹ÍÐÁ…•=™™Í•Ñ`€ôÁ…•%‘à€¨Ñ…É•Ñ\ì(€€€€€€€ì(€€€€€€€€€½¹ÍÐ…À€ô±…å½ÕÐ¹…Àì(€€€€€€€€€½¹ÍÐÉ…‘¥ÕÌ€ô±…å½ÕÐ¹É…‘¥ÕÌì(€€€€€€€€€½¹ÍÐ…¹Ù…Í…À€ô…À€¨Í…±•…Ñ½Èì(€€€€€€€€€½¹ÍÐ…¹Ù…ÍI…‘¥ÕÌ€ôÉ…‘¥ÕÌ€¨Í…±•…Ñ½Èì(€€€€€€€€€€¼¼ƒšVÓžÖ’ö#–Æ–>¿¢÷¢Š¯žžï–.Wš"[žâ»šRû¦;¾ò3–2¿–ëšf––_žR£–B3’â–/¢º+–öˆ(€€€€€€€€€½¹ÍÐ±Ð€ô±…å½ÕÐ¹Ðñðìàè€À°äè€À°Í…±”è€Äôì(€€€€€€€€€½¹ÍÐ±ÑM…±”€ô±Ð¹Í…±”ñð€Äì(€€€€€€€€€½¹ÍÐ±ÑI½Ð€ô±Ð¹É½Ðñð€Àì(€€€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€€€¥˜€¡±Ð¹à€„ôô€Àñð±Ð¹ä€„ôô€Àñð±ÑM…±”€„ôô€Äñð±ÑI½Ð€„ôô€À¤ì(€€€€€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ”¡Á…•=™™Í•Ñ`€¬Ñ…É•Ñ\€¼€È€¬±Ð¹à€¨Í…±•…Ñ½È°Ñ…É•Ñ €¼€È€¬±Ð¹ä€¨Í…±•…Ñ½È¤ì(€€€€€€€€€€€€¼¼ƒš^/¢ö'¢"žâ»šRû¦÷’î—’ö#–Æ’â·–þž
ë¢îã¾ò3¢Þ¦‚C¢š÷žjÑÉ…¹Í™½É´µ½É¥¥¸è•¹Ñ•Èƒ’â¢Ð(€€€€€€€€€€€¥˜€¡±ÑI½Ð€„ôô€À¤Ñà¹É½Ñ…Ñ” ¡±ÑI½Ð€¨5…Ñ ¹A$¤€¼€ÄàÀ¤ì(€€€€€€€€€€€Ñà¹Í…±”¡±ÑM…±”°±ÑM…±”¤ì(€€€€€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ” ´¡Á…•=™™Í•Ñ`€¬Ñ…É•Ñ\€¼€È¤°€µÑ…É•Ñ €¼€È¤ì(€€€€€€€€€ô((€€€€€€€€€€¼¼É…Ü±…å½ÕÐ¥µ…•Ì™½ÈÑ¡¥ÌÁ…”„(€€€€€€€€€½¹ÍÐÁ…•Q•µÁ±…Ñ•Ì€ôQ5A1Q}5Am±…å½ÕÐ¹¥µ…•Ì¹±•¹Ñ¡tñðmtì(€€€€€€€€€½¹ÍÐÁ…•Ñ¥Ù•Q•µÁ±…Ñ”€ôÁ…•Q•µÁ±…Ñ•Ím±…å½ÕÐ¹Ñ•µÁ±…Ñ•%¹‘•átñðÁ…•Q•µÁ±…Ñ•ÍlÁtñðì¹…µ”è€Ÿ¦‚C¢¢´œ°É•ÑÌèmtôì((€€€€€€€€€€¼¼1½…¥µ…•Ì™½ÈÑ¡¥ÌÍÁ•¥™¥ŒÁ…”(€€€€€€€€€½¹ÍÐ¥µ…•1½…‘•ÉÌ€ô±…å½ÕÐ¹¥µ…•Ì¹µ…À¡•±°€ôø•±°¹ÕÉ°€ü±½…‘áÁ½ÉÑ%µ…”¡•±°¹ÕÉ°¤€èAÉ½µ¥Í”¹É•Í½±Ù”¡¹Õ±°¤¤ì((€€€€€€€€€½¹ÍÐ±½…‘•‘%µ…•Ì€ô…Ý…¥ÐAÉ½µ¥Í”¹…±°¡¥µ…•1½…‘•ÉÌ¤ì((€€€€€€€€€Á…•Ñ¥Ù•Q•µÁ±…Ñ”¹É•ÑÌ¹™½É…  ¡É•Ð°¥‘à¤€ôøì(€€€€€€€€€€€½¹ÍÐ•±°€ô±…å½ÕÐ¹¥µ…•Ím¥‘átì(€€€€€€€€€€€½¹ÍÐ¥µœ€ô±½…‘•‘%µ…•Ím¥‘átì((€€€€€€€€€€€€¼¼	…Í”•±°½½É‘¥¹…Ñ•ÌÝ¥Ñ Á¥á•°Í¹…ÁÁ¥¹œÑ¼ÁÉ•Ù•¹Ð…ÁÌ€¡Í¡¥™Ñ•‰äÁ…•=™™Í•Ñ`¤(€€€€€€€€€€€€¼¼ƒ¢"¦‚C¢š÷–B3’â––_–æû’öW¾òkšVÓ¦®S–Ÿžâ»–6+–/¦ZO¢Þw¾ò3š‚ó–¶C–7–BžVg–6+–,Á…‘‘¥¹œ(€€€€€€€€€€€½¹ÍÐ¥¹Í•Ð€ô…¹Ù…Í…À€¼€Èì(€€€€€€€€€€€€¼¨ƒ’ö#–Æ–>¿’î—šr'¢«–ÞÇžj¦Vß–¾³š¾S¾ò3š†’â7’â–ºkž¶'šZóšVÓ¦‚ƒŠSŠPƒ¢Þ¦‚C¢š÷–Fó–>¯–B3’âšR¼(€€€€€€€€€€€€€€±…å½ÕÑ	½ã¾ò3¢3’âS’âš¢žö»’â·¾ò3š&’î—–2¿–ë¢ÞžV¯¦v‹’â+¦Vß–ú_’âš¢‡’âš¢Ž€¨¼(€€€€€€€€€€€½¹ÍÐ±‰½à€ô±…å½ÕÑ	½à¡±…å½ÕÐ°Ñ…É•Ñ\°Ñ…É•Ñ ¤ì(€€€€€€€€€€€½¹ÍÐ‰½á`€ôÁ…•=™™Í•Ñ`€¬€¡Ñ…É•Ñ\€´±‰½à¹Ü¤€¼€Èì(€€€€€€€€€€€½¹ÍÐ‰½ád€ô€¡Ñ…É•Ñ €´±‰½à¹ ¤€¼€Èì(€€€€€€€€€€€½¹ÍÐ…É•…\€ô5…Ñ ¹µ…à Ä°±‰½à¹Ü€´¥¹Í•Ð€¨€È¤ì(€€€€€€€€€€€½¹ÍÐ…É•… €ô5…Ñ ¹µ…à Ä°±‰½à¹ €´¥¹Í•Ð€¨€È¤ì(€€€€€€€€€€€½¹ÍÐ±•™ÑAà€ô‰½á`€¬¥¹Í•Ð€¬5…Ñ ¹É½Õ¹¡É•Ð¹à€¨…É•…\¤ì(€€€€€€€€€€€½¹ÍÐÉ¥¡ÑAà€ô‰½á`€¬¥¹Í•Ð€¬5…Ñ ¹É½Õ¹ ¡É•Ð¹à€¬É•Ð¹Ü¤€¨…É•…\¤ì(€€€€€€€€€€€½¹ÍÐÑ½ÁAà€ô‰½ád€¬¥¹Í•Ð€¬5…Ñ ¹É½Õ¹¡É•Ð¹ä€¨…É•… ¤ì(€€€€€€€€€€€½¹ÍÐ‰½ÑÑ½µAà€ô‰½ád€¬¥¹Í•Ð€¬5…Ñ ¹É½Õ¹ ¡É•Ð¹ä€¬É•Ð¹ ¤€¨…É•… ¤ì((€€€€€€€€€€€½¹ÍÐ‰Ü€ôÉ¥¡ÑAà€´±•™ÑAàì(€€€€€€€€€€€½¹ÍÐ‰ €ô‰½ÑÑ½µAà€´Ñ½ÁAàì(€€€€€€€€€€€½¹ÍÐ‰à€ô±•™ÑAàì(€€€€€€€€€€€½¹ÍÐ‰ä€ôÑ½ÁAàì((€€€€€€€€€€€€¼¼ÁÁ±ä…ÀÁ…‘‘¥¹œ(€€€€€€€€€€€½¹ÍÐ¥à€ô‰à€¬…¹Ù…Í…À€¼€Èì(€€€€€€€€€€€½¹ÍÐ¥ä€ô‰ä€¬…¹Ù…Í…À€¼€Èì(€€€€€€€€€€€½¹ÍÐ¥Ü€ô‰Ü€´…¹Ù…Í…Àì(€€€€€€€€€€€½¹ÍÐ¥ €ô‰ €´…¹Ù…Í…Àì((€€€€€€€€€€€¥˜€¡¥Ü€ðô€Àñð¥ €ðô€À¤É•ÑÕÉ¸ì((€€€€€€€€€€€€¼¨ƒ¦g’âš‚ó¢«–ÞÇ¢¢·’ê–rO¢žK–ÂÇ¢N/š:'’ö#–Æ¦
š‚ç–ÇžR£šîGš†ÿ¾ò#¢Þ¦‚C¢š÷–B3’â––_¾ò$€¨¼(€€€€€€€€€€€½¹ÍÐ•±±I…‘¥ÕÌ€ô•±°ü¹¥µI…‘¥ÕÌ(€€€€€€€€€€€€€€ü½É¹•ÉH¡•±°¹¥µI…‘¥ÕÌ°¥Ü°¥ ¤(€€€€€€€€€€€€€€è…¹Ù…ÍI…‘¥ÕÌì((€€€€€€€€€€€€¼¼É…ÜÍ½±¥‰…­É½Õ¹™½ÈÑ¡”•±°Í±½Ð(€€€€€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€€€€€Ñà¹‰•¥¹A…Ñ  ¤ì(€€€€€€€€€€€¥˜€¡Ñà¹É½Õ¹‘I•Ð¤ì(€€€€€€€€€€€€€Ñà¹É½Õ¹‘I•Ð¡¥à°¥ä°¥Ü°¥ °•±±I…‘¥ÕÌ¤ì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€Ñà¹É•Ð¡¥à°¥ä°¥Ü°¥ ¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€Ñà¹™¥±±MÑå±”€ô€œŒÄÈÄÈÄÈœì(€€€€€€€€€€€Ñà¹™¥±° ¤ì(€€€€€€€€€€€Ñà¹É•ÍÑ½É” ¤ì((€€€€€€€€€€€¥˜€ …•±°ñð€…¥µœ¤É•ÑÕÉ¸ì((€€€€€€€€€€€€¼¼É…Ü¥µ…”¥¹Í¥‘”±¥ÁÁ¥¹œÁ…Ñ (€€€€€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€€€€€Ñà¹‰•¥¹A…Ñ  ¤ì(€€€€€€€€€€€¥˜€¡Ñà¹É½Õ¹‘I•Ð¤ì(€€€€€€€€€€€€€Ñà¹É½Õ¹‘I•Ð¡¥à°¥ä°¥Ü°¥ °•±±I…‘¥ÕÌ¤ì(€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€Ñà¹É•Ð¡¥à°¥ä°¥Ü°¥ ¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€Ñà¹±¥À ¤ì(€€€€€€€€€€€Ñà¹±½‰…±±Á¡„€¨ô€¡•±°¹½Á…¥Ñä€üü€ÄÀÀ¤€¼€ÄÀÀì((€€€€€€€€€€€€¼¨ƒ––_’êšþû¦>‡¾ò?¢ªÿž¾¾ò?ž&çšV#–ÂÇ–#žº_–ë¢fWžB¦;žj¦
’â–ò×¾ò3–7žŸ–:šr³žj(€€€€€€€€€€€€€€ƒ¢Ž–"¢"žâ»šRûžV¯’â+–:ìƒŠSŠPƒ¢Þ¦‚C¢š÷žR£žjšb¿–B3’âšR¼…ÁÁ±åA¡½Ñ½ãŽ€¨¼(€€€€€€€€€€€½¹ÍÐÍÉŒè…¹Ù…Í%µ…•M½ÕÉ”€ô¡…ÍA¡½Ñ½à¡•±°¹™à¤(€€€€€€€€€€€€€€ü…ÁÁ±åA¡½Ñ½à (€€€€€€€€€€€€€€€€€¥µœ°(€€€€€€€€€€€€€€€€€5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹ ¡¥µœ¹¹…ÑÕÉ…±]¥‘Ñ ñð¥µœ¹Ý¥‘Ñ ¤¤¤°(€€€€€€€€€€€€€€€€€5…Ñ ¹µ…à Ä°5…Ñ ¹É½Õ¹ ¡¥µœ¹¹…ÑÕÉ…±!•¥¡Ðñð¥µœ¹¡•¥¡Ð¤¤¤°(€€€€€€€€€€€€€€€€€•±°¹™à„°(€€€€€€€€€€€€€€€€¤(€€€€€€€€€€€€€€è¥µœì((€€€€€€€€€€€½¹ÍÐ¥µ\€ô¥µœ¹¹…ÑÕÉ…±]¥‘Ñ ñð¥µœ¹Ý¥‘Ñ ì(€€€€€€€€€€€½¹ÍÐ¥µ €ô¥µœ¹¹…ÑÕÉ…±!•¥¡Ðñð¥µœ¹¡•¥¡Ðì(€€€€€€€€€€€½¹ÍÐ¥ÌäÁ½ÈÈÜÀ€ô€¡•±°¹É½Ñ…Ñ¥½¸€”€ÄàÀ¤€„ôô€Àì((€€€€€€€€€€€½¹ÍÐ‘É…Ý\€ô¥ÌäÁ½ÈÈÜÀ€ü¥µ €è¥µ\ì(€€€€€€€€€€€½¹ÍÐ‘É…Ý €ô¥ÌäÁ½ÈÈÜÀ€ü¥µ\€è¥µ ì((€€€€€€€€€€€½¹ÍÐÍ…±•`€ô¥Ü€¼‘É…Ý\ì(€€€€€€€€€€€½¹ÍÐÍ…±•d€ô¥ €¼‘É…Ý ì(€€€€€€€€€€€€¼¼‘„Ñ¥¹äÍÕ‰Á¥á•°‰±••™…Ñ½ÈÑ¼ÁÉ•Ù•¹ÐÑ¡¥¸…ÁÌ½¸•‘•Ì(€€€€€€€€€€€½¹ÍÐ½Ù•ÉM…±”€ô5…Ñ ¹µ…à¡Í…±•`°Í…±•d¤€¨€Ä¸ÀÄÔ€¬€À¸ÀÀÔì(€€€€€€€€€€€½¹ÍÐ™¥¹…±M…±”€ô½Ù•ÉM…±”€¨•±°¹é½½´ì((€€€€€€€€€€€€¼¼A•É™½É´ÑÉ…¹Í™½Éµ…Ñ¥½¹Ì(€€€€€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ”¡¥à€¬¥Ü€¼€È°¥ä€¬¥ €¼€È¤ì((€€€€€€€€€€€€¼¼ÁÁ±äÕÍ•ÈÍ¡¥™ÑÌ€¡¥¸Õ¹É½Ñ…Ñ•½½É‘¥¹…Ñ”ÍÁ…”Ñ¼µ…Ñ ÁÉ•Ù¥•Ü¤(€€€€€€€€€€€½¹ÍÐÍ¡¥™Ñ`€ô•±°¹½™™Í•Ñ`€¨¥Üì(€€€€€€€€€€€½¹ÍÐÍ¡¥™Ñd€ô•±°¹½™™Í•Ñd€¨¥ ì(€€€€€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ”¡Í¡¥™Ñ`°Í¡¥™Ñd¤ì((€€€€€€€€€€€Ñà¹É½Ñ…Ñ” ¡•±°¹É½Ñ…Ñ¥½¸€¨5…Ñ ¹A$¤€¼€ÄàÀ¤ì((€€€€€€€€€€€€¼¼M…±”…¹‘É…ß¾ò#šVÓžÖ’ö#–Æšb¿’â–/žú“žÖ¾ò3š‚ó–ŸžŸž&¢Þ¢F_’â¢Ößžâ»šRû¾ò$(€€€€€€€€€€€Ñà¹Í…±”¡™¥¹…±M…±”°™¥¹…±M…±”¤ì(€€€€€€€€€€€Ñà¹‘É…Ý%µ…”¡ÍÉŒ°€µ¥µ\€¼€È°€µ¥µ €¼€È°¥µ\°¥µ ¤ì(€€€€€€€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€€€€€ô¤ì(€€€€€€€€€Ñà¹É•ÍÑ½É” ¤ì(€€€€€€€ô(€€€€€ôì((€€€€€€¼¼ƒ’úwžV¯¦v‹’â+žj–r[–Æ“¦‚–ê?–B#š"C¾òk’â¢"³–r[ž&šb¿–ÛšVã–Æ“¾ò3’ö#–Æšb¿––šVã–Æ“¾ò#¢š/¦‚C¢š÷žjé%¹‘•ã¾ò'Ž(€€€€€€¼¼µ¥¹`½µ…á`ƒšb¿ž&§’îÛ–r£Ž3šVÓšŠw¦‚¦v‹–âÛŽ7’â+žjž¾–r7¾ò3žR£’ú¢ÞÏ¦;žV¯’â7–"Ã¦g’â¦‚žjšvÇ¢–ÿŽ(€€€€€½¹ÍÐ‘É…Ý)½‰Ìèì(€€€€€€€èè¹Õµ‰•Èìµ¥¹`è¹Õµ‰•Èìµ…á`è¹Õµ‰•Èì(€€€€€€€¥ÍY¥‘•¼üè‰½½±•…¸ìÍÉŒüèÍÑÉ¥¹œìµ½Ñ¥½¹%Ñ•´üè±½…Ñ¥¹%µ…”ì(€€€€€€€€¼¨±¥Ù”ƒ–>«šr'–öÇž&¦
šŠwŽ3’âžžK¢šžV¯’â'–6š²‡Ž7žj¢Þ¿šr–
Ï¾ò#¢š,1¥Ù•É…ß¾ò$€¨¼(€€€€€€€ÉÕ¸è€¡Œè…¹Ù…ÍI•¹‘•É¥¹½¹Ñ•áÐÉ°±¥Ù”üè1¥Ù•É…Ü°µ½Ñ¥½¹Ðüè¹Õµ‰•È¤€ôøAÉ½µ¥Í”ñÙ½¥øì(€€€€€õmt€ômtì(€€€€€Á…•Ì¹™½É…  ¡Á…”°Á…•%‘à¤€ôøì(€€€€€€€Á…”¹±…å½ÕÑÌ¹™½É… ¡±…ä€ôøì(€€€€€€€€€½¹ÍÐ±Ì€ô±…ä¹Ðü¹Í…±”€üü€Äì(€€€€€€€€€€¼¼ƒ’ö#–Æšr'¢«–ÞÇžjš¾S’ú/šf’öSžjš¦¯–BGž¾–r7šrš¾SšVÓ¦‚žª¾ò3¢šžŸ–º¢«–ÞÇžjš†žº\(€€€€€€€€€½¹ÍÐ±ˆÀ€ô±…å½ÕÑ	½à¡±…ä°Ñ…É•Ñ\°Ñ…É•Ñ ¤ì(€€€€€€€€€€¼¼ƒ¢ö'¦;¢žK–ê›’æ/–ú3’öSžjš¦¯–BGž¾–r7šr¢º+–¾³¾ò3¢šžR£Ž3¢ö'¦;žj–’[š:—š†Ž4(€€€€€€€€€½¹ÍÐ±‰Ü€ôÉ½ÑáÑ•¹Ð¡±ˆÀ¹Ü€¨±Ì°±ˆÀ¹ €¨±Ì°±…ä¹Ðü¹É½Ðñð€À¤¹‰Üì(€€€€€€€€€½¹ÍÐ±•™Ð€ôÁ…•%‘à€¨Ñ…É•Ñ\€¬€¡Ñ…É•Ñ\€´±‰Ü¤€¼€È€¬€¡±…ä¹Ðü¹àñð€À¤€¨Í…±•…Ñ½Èì(€€€€€€€€€‘É…Ý)½‰Ì¹ÁÕÍ ¡ì(€€€€€€€€€€€èè€Ôä€¬€¡±…ä¹è€üü€À¤€¨€È°(€€€€€€€€€€€µ¥¹`è±•™Ð°(€€€€€€€€€€€µ…á`è±•™Ð€¬±‰Ü°(€€€€€€€€€€€ÉÕ¸è€¡Œ¤€ôø‘É…ÝA…•1…å½ÕÐ¡Œ°Á…•%‘à°±…ä¤°(€€€€€€€€€ô¤ì(€€€€€€€ô¤ì(€€€€€ô¤ì(€€€€€™±½…Ñ¥¹%µ…•Ì¹™½É…  ¡™%µœ°¤¤€ôøì(€€€€€€€½¹ÍÐ…‘©ÕÍÑ•‘`€ô™%µœ¹à€´5…Ñ ¹™±½½È¡™%µœ¹à€¼€¡ÁÉ•Ù¥•Ý\€¬€Ä¤¤ì(€€€€€€€½¹ÍÐ™Ü€ô™%µœ¹Ý¥‘Ñ €¨Í…±•…Ñ½Èì(€€€€€€€½¹ÍÐà€ô…‘©ÕÍÑ•‘`€¨Í…±•…Ñ½È€¬™Ü€¼€Èì(€€€€€€€€¼¨(€€€€€€€€€ƒ¢ö'¦;¢žK–ê›’æ/–ú3Ž3–’[š:—š†Ž7žj–6+–¾°ƒŠSŠPƒ¢šžR£–’[š:—Ž;š†Ž?¾ò3’â7¢÷žR£–’[š:—Ž;–rOŽ?Ž(€€€€€€€€€ƒ–’[š:—–rOžj–6+–úGšb¼¡åÁ½Ð£–¾°°ƒ¦®`¤¼Ë¾ò3šîÿž&#žj–r[–Æ“žº_–ë’úšrš¾S–¾›¦jo–¾°€ØÀ”ƒ’î—’â+¾ò0(€€€€€€€€€ƒž¾–r7žnÓš:—–B¦Ë¦jS–Ž¦
’â¦‚ƒŠSŠPƒ–öÇž&š^¦
+¦
’â¦‚–ÂÇšr¢Š¯–"“–ºkš"CŽ3¦g¦‚šr'–öÇž&Ž7¾ò0(€€€€€€€€€ƒžÖCšzsšVÓ¦‚¢Š¯žVÛš"C–öÇž&¢òã–ëŽ(€€€€€€€€¨¼(€€€€€€€½¹ÍÐÉ…€ô€ ¡™%µœ¹É½Ñ…Ñ¥½¸ñð€À¤€¨5…Ñ ¹A$¤€¼€ÄàÀì(€€€€€€€½¹ÍÐ¡…±˜€ô€¡5…Ñ ¹…‰Ì¡™%µœ¹Ý¥‘Ñ €¨5…Ñ ¹½Ì¡É…¤¤€¬5…Ñ ¹…‰Ì¡™%µœ¹¡•¥¡Ð€¨5…Ñ ¹Í¥¸¡É…¤¤¤(€€€€€€€€€€¨™%µœ¹Í…±”€¨Í…±•…Ñ½È€¼€Èì(€€€€€€€‘É…Ý)½‰Ì¹ÁÕÍ ¡ì(€€€€€€€€€èè€ØÀ€¬¤€¨€È°(€€€€€€€€€µ¥¹`èà€´¡…±˜°(€€€€€€€€€µ…á`èà€¬¡…±˜°(€€€€€€€€€¥ÍY¥‘•¼è€„…™%µœ¹¥ÍY¥‘•¼°(€€€€€€€€€ÍÉŒè™%µœ¹ÍÉŒ°(€€€€€€€€€µ½Ñ¥½¹%Ñ•´è™%µœ°(€€€€€€€€€€¼¨ƒ¢Ž–r£¢«–ÞÇ¦
’â¦‚¢Ž‡¦v‹Ž¢Êó¦ö+žV¯–â¦
+žÞšf–r[–Æ“šr–"ïš?–ú–’[–’k¢N/–6+–/–?žÒ€(€€€€€€€€€€€€ƒ¾ò#’â7žÛ¦‚C¢š÷šr¦rË–ë’âšŠwš*_¦.ã¦öKžjžf÷žâ¯¾ò'¾ò3¦‚C¢š÷šr$½Ù•É™±½Üé¡¥‘‘•¸ƒšN/¢F_¾ò0(€€€€€€€€€€€€ƒ’ö–2¿–ëšb¿š*+š&šr'¦‚¦v‹žV¯–r£–B3’â–ò×¦VßžV¯–â’â+ŽšÊKšr'’îï’öW¢Ž–"ƒŠSŠP(€€€€€€€€€€€€ƒ–’k–ë’úžj¦
–6+–/–?žÒƒ–ÂÇ¢ÞG–"Ã¦jS–Ž¦
’â¦‚–:ï’êŽ€¨¼(€€€€€€€€€ÉÕ¸è…Íå¹Œ€¡Œ°±¥Ù”°µ½Ñ¥½¹Ð¤€ôøì(€€€€€€€€€€€€¼¨ƒ¢Ž–"ž¾–r7šb¿Ž3¦g–/–r[–Æ“žrš¶š¦¯¢Þ£–"Ãžjš¾?’â¦‚Ž7¾ò3’â7šb¿–>«šr'’â¦‚ƒŠSŠP(€€€€€€€€€€€€€€ƒ–>«¢Ž’â¦‚žj¢¦Ç¾ò3–"ïš?¢Þ£–r£–§¦‚’â+žjž&§’îÛšr¢Š¯–"š:'’â–6+Ž(€€€€€€€€€€€€€€ƒ–"“šZß¢Þ£¦‚šfžVd€Ä¸ÕÁàƒžj–ºç–Þ»¾òk¢Êó¦ö+¦
+žÞšf–r[–Æ“šr–ú–’[–’k¢N/–6+–/–?žÒ€(€€€€€€€€€€€€€€ƒ¾ò#’â7žÛ¦‚C¢š÷šr¦rË–ëš*_¦.ã¦öKžjžf÷žâ¯¾ò'¾ò3¦
–6+–/–?žÒƒ’â7¢÷¢Š¯žVÛš"CŽ3¢Þ£¦‚Ž7Ž€¨¼(€€€€€€€€€€€½¹ÍÐQ=0€ô€Ä¸Ô€¨Í…±•…Ñ½Èì(€€€€€€€€€€€€¼¨ƒŠj€ƒ–Þ›–>Ï¦
+žV3¢šžR£Ž3’â·–þƒ
Äƒ’â–6+Ž7¾ò3¢3’âSšb¼¨«žâ»šRû¢"š^/¢ö'’æ/–ú0¨«žj¦
–/’â–6(ƒŠSŠP(€€€€€€€€€€€€€€ƒ’æ–ÂÇšb¿’â+¦vˆµ¥¹c¾ò=µ…á`ƒžR£žj–B3’âžÖšVã–¶_Ž((€€€€€€€€€€€€€€ƒ’î—–&7¦g¢Ž‡šb¿Ž3šÊKšr'žâ»šRûšfžj–Þ›¦
+Ž7¾ò/Ž3žâ»šRû–ú3žj–¾³–ê›Ž7Ž	MLƒžjÍ…±”(€€€€€€€€€€€€€€ƒšb¿’î—’â·–þž
ë–:¦î{žj¾ò3š&’î—¦
’âšº×šVÓ–/–ú–>Ï–?’êƒ–¾³\£–7ž:´Ä§ÜË¾òh(€€€€€€€€€€€€€€ƒšRû–’Ÿ¦;žj–r[–Æ“¾ò3¦g¢Ž‡žº_–ë’úžj¦‚žŠó–ÂÇ¢Þ|µ¥¹c¾ò=µ…á`ƒ–Â7’â7¢Öß’úƒŠSŠP(€€€€€€€€€€€€€€ƒš~C’â¦‚¢Š¯–"“–ºkš"CŽ3¦g’â¦‚šr'–öÇž&Ž7¾ò#žœµ¥¹c¾ò=µ…ác¾ò'¾ò3žV¯žjšf–g–6ï¢Š¬(€€€€€€€€€€€€€€ƒ¦g–/¢Ž–"š†šVÓž&–"š:'Ž¦
’â¦‚¦2–ë’ú–ÂÇ–>«–&§¦vsš¶‹žj–êW–r[¾ò0(€€€€€€€€€€€€€€ƒ’æ–ÂÇšb¿Ž3–öÇž&¢Þ£¦‚šfšr'’â¦‚¢º+š"C¦vsš¶‹žjŽ7Ž3––_’ê–ö‹ž.žj–öÇž&–r %ƒ¦‚C¢šô(€€€€€€€€€€€€€€ƒ¢"š"C–N¦÷’â7šr–.WŽ7¾ò#’â¢"³¦‚C¢š÷¢ÖÃžjšb¼=7¾ò3šÊKšr'¦g¦O¢Ž–"¾ò3š&’î—š¶–âã¾ò'Ž€¨¼(€€€€€€€€€€€½¹ÍÐ±à€ôà€´¡…±˜ì(€€€€€€€€€€€½¹ÍÐÉà€ôà€¬¡…±˜ì(€€€€€€€€€€€½¹ÍÐ±…ÍÐ€ô5…Ñ ¹µ…à À°Á…•Ì¹±•¹Ñ €´€Ä¤ì(€€€€€€€€€€€½¹ÍÐÀÀ€ô5…Ñ ¹µ¥¸¡±…ÍÐ°5…Ñ ¹µ…à À°5…Ñ ¹™±½½È ¡±à€¬Q=0¤€¼Ñ…É•Ñ\¤¤¤ì(€€€€€€€€€€€½¹ÍÐÀÄ€ô5…Ñ ¹µ¥¸¡±…ÍÐ°5…Ñ ¹µ…à¡ÀÀ°5…Ñ ¹™±½½È ¡Éà€´Q=0¤€¼Ñ…É•Ñ\¤¤¤ì(€€€€€€€€€€€Œ¹Í…Ù” ¤ì(€€€€€€€€€€€Œ¹‰•¥¹A…Ñ  ¤ì(€€€€€€€€€€€Œ¹É•Ð¡ÀÀ€¨Ñ…É•Ñ\°€À°€¡ÀÄ€´ÀÀ€¬€Ä¤€¨Ñ…É•Ñ\°Ñ…É•Ñ ¤ì(€€€€€€€€€€€Œ¹±¥À ¤ì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€½¹ÍÐ™É…µ”€ôµ½Ñ¥½¹Ð€ôôôÕ¹‘•™¥¹•ñð€…¡…Í½¹™¥ÕÉ•‘5½Ñ¥½¸¡™%µœ¤(€€€€€€€€€€€€€€€€ü¹Õ±°(€€€€€€€€€€€€€€€€è™É…µ•½É%Ñ•´¡™%µœ°¤°µ½Ñ¥½¹Ð¤ì(€€€€€€€€€€€€€…Ý…¥Ð‘É…Ý±½…Ñ¥¹1…å•ÉÌ¡Œ°m™%µt°Í…±•…Ñ½È°±¥Ù”°™É…µ”¤ì(€€€€€€€€€€€ô™¥¹…±±äì(€€€€€€€€€€€€€Œ¹É•ÍÑ½É” ¤ì(€€€€€€€€€€€ô(€€€€€€€€€ô°(€€€€€€€ô¤ì(€€€€€ô¤ì(€€€€€€¼¨ƒžV¯ž¶–B3š¢¢ÖÃ–r[–Æ“–Þ—’ös’ö–"_¾ò3¦‚C¢š÷¢"–2¿–ë–ÇžR£–:–ž/¦î{–"_¾òo’â7–#¦î{¦f–2[¾ò0(€€€€€€€€ƒ–nƒš¶“¢òã–ëšRû–’Ÿ–ú3’î7šb¿¦*Ï–"§žj–BG¦?ž¶žV¯Ž€¨¼(€€€€€‰ÉÕÍ¡MÑÉ½­•Ì¹™½É…  ¡ÍÑÉ½­”°¤¤€ôøì(€€€€€€€¥˜€ …ÍÑÉ½­”¹Á½¥¹ÑÌ¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€€€€€½¹ÍÐ•áÁ½ÉÑA½¥¹Ð€ô€¡Àè±…ÍÍ¥	ÉÕÍ¡A½¥¹Ð¤€ôø€¡ì(€€€€€€€€€àè€¡À¹à€´5…Ñ ¹™±½½È¡À¹à€¼€¡ÁÉ•Ù¥•Ý\€¬€Ä¤¤¤€¨Í…±•…Ñ½È°(€€€€€€€€€äèÀ¹ä€¨Í…±•…Ñ½È°(€€€€€€€ô¤ì(€€€€€€€½¹ÍÐ•À€ôÍÑÉ½­”¹Á½¥¹ÑÌ¹µ…À¡•áÁ½ÉÑA½¥¹Ð¤ì(€€€€€€€½¹ÍÐáÌ€ô•À¹µ…À¡À€ôøÀ¹à¤°Á…€ôÍÑÉ½­”¹Ý¥‘Ñ €¨Í…±•…Ñ½Èì(€€€€€€€‘É…Ý)½‰Ì¹ÁÕÍ ¡ì(€€€€€€€€€èè€ØÀ€¬ÍÑÉ½­”¹è€¨€È°(€€€€€€€€€µ¥¹`è5…Ñ ¹µ¥¸ ¸¸¹áÌ¤€´Á…°(€€€€€€€€€µ…á`è5…Ñ ¹µ…à ¸¸¹áÌ¤€¬Á…°(€€€€€€€€€ÉÕ¸è…Íå¹ŒŒ€ôøì(€€€€€€€€€€€Œ¹Í…Ù” ¤ì(€€€€€€€€€€€Œ¹‰•¥¹A…Ñ  ¤ì(€€€€€€€€€€€Œ¹µ½Ù•Q¼¡•ÁlÁt¹à°•ÁlÁt¹ä¤ì(€€€€€€€€€€€¥˜€¡•À¹±•¹Ñ €ôôô€Ä¤Œ¹±¥¹•Q¼¡•ÁlÁt¹à€¬€¸ÀÄ°•ÁlÁt¹ä€¬€¸ÀÄ¤ì(€€€€€€€€€€€™½È€¡±•Ð¨€ô€Äì¨€ð•À¹±•¹Ñ €´€Äì¨¬¬¤ì(€€€€€€€€€€€€€½¹ÍÐÀ€ô•Ám©t°¸€ô•Ám¨€¬€Åtì(€€€€€€€€€€€€€Œ¹ÅÕ…‘É…Ñ¥ÕÉÙ•Q¼¡À¹à°À¹ä°€¡À¹à€¬¸¹à¤€¼€È°€¡À¹ä€¬¸¹ä¤€¼€È¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡•À¹±•¹Ñ €ø€Ä¤Œ¹±¥¹•Q¼¡•Ám•À¹±•¹Ñ €´€Åt¹à°•Ám•À¹±•¹Ñ €´€Åt¹ä¤ì(€€€€€€€€€€€Œ¹ÍÑÉ½­•MÑå±”€ôÍÑÉ½­”¹½±½Èì(€€€€€€€€€€€Œ¹±¥¹•]¥‘Ñ €ôÍÑÉ½­”¹Ý¥‘Ñ €¨Í…±•…Ñ½Èì(€€€€€€€€€€€Œ¹±¥¹•…À€ô€É½Õ¹œìŒ¹±¥¹•)½¥¸€ô€É½Õ¹œì(€€€€€€€€€€€Œ¹±½‰…±±Á¡„€¨ôÍÑÉ½­”¹­¥¹€ôôô€¡¥¡±¥¡Ðœ€ü€¸ÌØ€èÍÑÉ½­”¹­¥¹€ôôô€Á•¹¥°œ€ü€¸àÈ€è€Äì(€€€€€€€€€€€¥˜€¡ÍÑÉ½­”¹­¥¹€ôôô€‘…Í œ¤Œ¹Í•Ñ1¥¹•…Í ¡m5…Ñ ¹µ…à Ð°ÍÑÉ½­”¹Ý¥‘Ñ €¨€Ä¸Ð¤€¨Í…±•…Ñ½È°5…Ñ ¹µ…à Ì°ÍÑÉ½­”¹Ý¥‘Ñ ¤€¨Í…±•…Ñ½Ét¤ì(€€€€€€€€€€€¥˜€¡ÍÑÉ½­”¹­¥¹€ôôô€¡¥¡±¥¡Ðœ¤ìŒ¹Í¡…‘½Ý½±½È€ôÍÑÉ½­”¹½±½ÈìŒ¹Í¡…‘½Ý	±ÕÈ€ô€È¸Ì€¨Í…±•…Ñ½Èìô(€€€€€€€€€€€¥˜€¡ÍÑÉ½­”¹­¥¹€ôôô€¹½Éµ…°œ€˜˜ÍÑÉ½­”¹¡…É‘¹•ÍÌ€ð€ÄÀÀ¤Œ¹Í¡…‘½Ý	±ÕÈ€ô€ ÄÀÀ€´ÍÑÉ½­”¹¡…É‘¹•ÍÌ¤€¼€ÄÀÀ€¨ÍÑÉ½­”¹Ý¥‘Ñ €¨€¸ÌØ€¨Í…±•…Ñ½Èì(€€€€€€€€€€€Œ¹ÍÑÉ½­” ¤ì(€€€€€€€€€€€Œ¹É•ÍÑ½É” ¤ì(€€€€€€€€€ô°(€€€€€€€ô¤ì(€€€€€ô¤ì(€€€€€‘É…Ý)½‰Ì¹Í½ÉÐ ¡à°ä¤€ôøà¹è€´ä¹è¤ì((€€€€€€¼¨¨(€€€€€€€¨ƒšr'–öÇž&–r[–Æ“žj¦
’â¦‚¢òã–ë–öÇž&Ž(€€€€€€€¨(€€€€€€€¨ƒ¦2–öÇšb¿–6Ïšfžj¾ò#’âžžK¢š’ê“–è€ÌÀƒ–ò×žV¯¦v‹¾ò'¾ò3š&’î—’â7šržR£–2¿–ëžŸž&¦
–,(€€€€€€€¨ƒ–.W¢òH€ÌÀÀÁÁàƒžj¢žšzC–ê›¾ò3¢3šb¿–ŽO–"Ã¦Vß¦
(€ÄÈàÃ¾òo¢3’âS–#š*+Ž3’â7šb¿–öÇž&Ž7žjšvÇ¢–ü(€€€€€€€¨ƒ–BžV¯š"C’â–ò×¦vsš/–êW–r[¾ò#–öÇž&’â/¦v‹’â–ò×Ž’â+¦v‹’â–ò×¾ò'¾ò3š¾?’â–âŸ–>«¢š¢Êó–§–ò×–rX(€€€€€€€¨ƒ¾ò/žV¯–öÇž&¾ò3š&7¢Þ–ú_’â+–6Ïšf¦2–öÇŽ(€€€€€€€¨¼(€€€€€€¼¨ƒ¦g’âš&ç’â–Ç¢š¦2–æû¦‚–öÇž&Žž>û–r£¦2–º3ž²³–æû¦‚ƒŠSŠPƒ¦Ë–ê›šb¿šVÓš&ç’â¢Ößžº_žj¾ò0(€€€€€€€€ƒ’â'¦‚–öÇž&–ÂÇšb¼€ÃŠHÄÀÀƒ¢ÞG’âš²‡¾ò3’â7šb¿š¾?¦‚–B¢ÞG’âš²‡Ž€¨¼(€€€€€±•ÐÙ¥‘Q½Ñ…°€ô€À°Ù¥‘½¹”€ô€Àì(€€€€€€¼¨¨(€€€€€€€¨ƒš*+Ž3¦g’â¦‚¢š¦C–âŸ–B#š"CŽ7¦r¢šžjšvÇ¢–ÿšê[–
g––÷¾òk–öÇž&’â/¦v‹¦
’â–Æ“Ž’â+¦v‹¦
’â–Æ“Ž(€€€€€€€¨ƒ–öÇž&’úšêC¾ò3’î—–>+’âšR¼½µÁ½Í¥Ñ” §Ž(€€€€€€€¨(€€€€€€€¨ƒ¦2–öÇ¾ò#–2¿–ë¾ò'¢"%ƒ¦‚C¢š÷žj–6ÏšfžV¯¦v‹–ÇžR£¦g’â’îôƒŠSŠPƒ–§¦
+žr/–"ÃžjšvÇ¢–ü(€€€€€€€¨ƒšb¿–B3’âšŠwž¢/–ò?žŠóžV¯–ë’úžj¾ò3’â7–>¿¢÷¦Vß–ú_’â7’âš¢Ž(€€€€€€€¨¼(€€€€€½¹ÍÐÁÉ•Á…É•A…•Y¥‘•¼€ô…Íå¹Œ€¡Á…•%‘àè¹Õµ‰•È°Á…•1•™Ðè¹Õµ‰•È¤€ôøì(€€€€€€€½¹ÍÐÁ…•)½‰Ì€ô‘É…Ý)½‰Ì¹™¥±Ñ•È¡¨€ôø(€€€€€€€€€¨¹µ…á`€øÁ…•1•™Ð€¬€À¸Ô€˜˜¨¹µ¥¹`€ðÁ…•1•™Ð€¬Ñ…É•Ñ\€´€À¸Ô¤ì(€€€€€€€½¹ÍÐÙ¥‘•½)½‰Ì€ôÁ…•)½‰Ì¹™¥±Ñ•È¡¨€ôø¨¹¥ÍY¥‘•¼¤ì(€€€€€€€½¹ÍÐ…¹¥µ…Ñ•€ôÁ…•)½‰Ì¹™¥±Ñ•È¡¨€ôø¨¹µ½Ñ¥½¹%Ñ•´€˜˜¡…Í½¹™¥ÕÉ•‘5½Ñ¥½¸¡¨¹µ½Ñ¥½¹%Ñ•´¤¤ì(€€€€€€€½¹ÍÐ¬€ô5…Ñ ¹µ¥¸ Ä°€ÄÈàÀ€¼5…Ñ ¹µ…à¡Ñ…É•Ñ\°Ñ…É•Ñ ¤¤ì(€€€€€€€€¼¼ƒžÞ£žŠó–f£¢ššÆ–ÛšVã¦
+¦VÜ(€€€€€€€½¹ÍÐY\€ô5…Ñ ¹µ…à È°5…Ñ ¹É½Õ¹¡Ñ…É•Ñ\€¨¬€¼€È¤€¨€È¤ì(€€€€€€€½¹ÍÐY €ô5…Ñ ¹µ…à È°5…Ñ ¹É½Õ¹¡Ñ…É•Ñ €¨¬€¼€È¤€¨€È¤ì((€€€€€€€½¹ÍÐÉŒ€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð …¹Ù…Ìœ¤ì(€€€€€€€ÉŒ¹Ý¥‘Ñ €ôY\ìÉŒ¹¡•¥¡Ð€ôY ì(€€€€€€€½¹ÍÐÉœ€ôÉŒ¹•Ñ½¹Ñ•áÐ œÉœ¤„ì((€€€€€€€€¼¼ƒšr'–öÇž&šf–ú«žJÃ¦Vß–ê›–>«¢÷ž¶'šZó–öÇž&¾òožÒS–.WžV¯¦‚–&žR£¢¦Ë¦‚šršfk–º3š"Cžj¦Ë–‚Ó¾ò/–sžVgŽ(€€€€€€€½¹ÍÐÙ¥‘Ì€ôÙ¥‘•½)½‰Ì¹µ…À¡¨€ôø•ÑAÉ•Ù¥•ÝY¥‘•¼¡¨¹ÍÉŒ„¤¤ì(€€€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±°¡Ù¥‘Ì¹µ…À¡Ø€ôø¹•ÜAÉ½µ¥Í”ñÙ½¥ø¡É•Ì€ôøì(€€€€€€€€€¥˜€¡Ø¹É•…‘åMÑ…Ñ”€øô€Ä¤É•ÑÕÉ¸É•Ì ¤ì(€€€€€€€€€½¹ÍÐ½¸€ô€ ¤€ôøìØ¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ±½…‘•‘µ•Ñ…‘…Ñ„œ°½¸¤ìÉ•Ì ¤ìôì(€€€€€€€€€Ø¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±½…‘•‘µ•Ñ…‘…Ñ„œ°½¸¤ì(€€€€€€€€€Í•ÑQ¥µ•½ÕÐ¡½¸°€ÌÀÀÀ¤ì(€€€€€€€ô¤¤¤ì(€€€€€€€½¹ÍÐµ½Ñ¥½¹¹€ô…¹¥µ…Ñ•¹É•‘Õ” ¡•¹°©½ˆ¤€ôøì(€€€€€€€€€½¹ÍÐ™œ€ôÑ¥µ•‘5½Ñ¥½¹½¹™¥œ¡©½ˆ¹µ½Ñ¥½¹%Ñ•´„¤ì(€€€€€€€€€É•ÑÕÉ¸™œ¹¥¸€ôôô€¹½¹”œ€ü•¹€è5…Ñ ¹µ…à¡•¹°™œ¹‘•±…ä€¬5…Ñ ¹µ…à ¸ÀÄ°™œ¹‘ÕÈ¤¤ì(€€€€€€€ô°€Ä¸È¤€¬5…Ñ ¹µ…à À°Á…•ÍmÁ…•%‘átü¹µ½Ñ¥½¹!½±€üü€Ð¤ì(€€€€€€€½¹ÍÐ‘ÕÈ€ôÙ¥‘Ì¹±•¹Ñ (€€€€€€€€€€ü5…Ñ ¹µ¥¸ ÄÔ°5…Ñ ¹µ…à ¸¸¹Ù¥‘Ì¹µ…À¡Ø€ôø€¡¥Í¥¹¥Ñ”¡Ø¹‘ÕÉ…Ñ¥½¸¤€˜˜Ø¹‘ÕÉ…Ñ¥½¸€ø€À€üØ¹‘ÕÉ…Ñ¥½¸€è€Ì¤¤¤¤(€€€€€€€€€€èµ½Ñ¥½¹¹ì(€€€€€€€€¼¨(€€€€€€€€€ƒ–K–n{¦Z/¦‚·¾ò3¢3’âS¢šž¶'–"ÃŽ3žržjšr'žV¯¦v‹–>¿’î—žV¯Ž7¾ò!É•…‘åMÑ…Ñ”ƒŠ&”!Y}UII9Q}Q¾ò'Ž(€€€€€€€€€ƒ–>«ž¶$±½…‘•‘µ•Ñ…‘…Ñ„ƒžj¢¦Ç–>«šr'¦Vß–¾³Ž¦
šÊKšr'’îï’öW’â–âŸ¾ò3žV¯’â+–:ïšb¿ž¦ëžjŽ(€€€€€€€€¨¼(€€€€€€€…Ý…¥ÐAÉ½µ¥Í”¹…±°¡Ù¥‘Ì¹µ…À¡Ø€ôø¹•ÜAÉ½µ¥Í”ñÙ½¥ø¡É•Ì€ôøì(€€€€€€€€€±•ÐÍ•ÑÑ±•€ô™…±Í”ì(€€€€€€€€€½¹ÍÐ™¥¹¥Í €ô€ ¤€ôøì(€€€€€€€€€€€¥˜€¡Í•ÑÑ±•¤É•ÑÕÉ¸ì(€€€€€€€€€€€Í•ÑÑ±•€ôÑÉÕ”ì(€€€€€€€€€€€Ø¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È ±½…‘•‘‘…Ñ„œ°¡•¬¤ì(€€€€€€€€€€€Ø¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È Í••­•œ°¡•¬¤ì(€€€€€€€€€€€Ø¹É•µ½Ù•Ù•¹Ñ1¥ÍÑ•¹•È …¹Á±…äœ°¡•¬¤ì(€€€€€€€€€€€É•Ì ¤ì(€€€€€€€€€ôì(€€€€€€€€€½¹ÍÐ¡•¬€ô€ ¤€ôøì¥˜€¡Ø¹É•…‘åMÑ…Ñ”€øô€È¤™¥¹¥Í  ¤ìôì(€€€€€€€€€Ø¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±½…‘•‘‘…Ñ„œ°¡•¬¤ì(€€€€€€€€€Ø¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È Í••­•œ°¡•¬¤ì(€€€€€€€€€Ø¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È …¹Á±…äœ°¡•¬¤ì(€€€€€€€€€ÑÉäìØ¹ÕÉÉ•¹ÑQ¥µ”€ô€Àìô…Ñ ì€¼¨¥¹½É”€¨¼ô(€€€€€€€€€¡•¬ ¤ì(€€€€€€€€€Í•ÑQ¥µ•½ÕÐ¡™¥¹¥Í °€ÌÀÀÀ¤ì(€€€€€€€ô¤¤¤ì((€€€€€€€€¼¨ƒš¾?š‚ó¦÷¢ÖÃ¢"¦‚C¢š÷žnã–B3žj½‰©•Ñ5½Ñ¥½¹É…µ—¾òo¦vsš/Ž–öÇž&–>+–.WžV¯ž&§’îÛš2'–:šr°(€€€€€€€€€€èƒ¦‚–ê?’â¢Öß–B#š"C¾ò3š&7’â7šr–nƒš.š"C’â+’â/–§–ò×–êW–r[¢3¢ºO–.WžV¯ž&§’îÛž¦ÿ–Æ“Ž€¨¼(€€€€€€€½¹ÍÐ±¥Ù”è1¥Ù•É…Ü€ôì¬èY\€¼Ñ…É•Ñ\°…¡”è¹•Ü5…À ¤ôì(€€€€€€€½¹ÍÐ½µÁ½Í¥Ñ”€ô…Íå¹Œ€¡µ½Ñ¥½¹Ð€ô€À¤€ôøì(€€€€€€€€€Éœ¹±•…ÉI•Ð À°€À°Y\°Y ¤ì(€€€€€€€€€Éœ¹™¥±±MÑå±”€ôÁ…•ÍmÁ…•%‘át¹‰½±½Èñð€œ™™™™™˜œì(€€€€€€€€€Éœ¹™¥±±I•Ð À°€À°Y\°Y ¤ì(€€€€€€€€€Á…¥¹ÑA…ÑÑ•É¸¡Éœ°Y\°Y °Á…•A…ÑÑ•É¸¡Á…•ÍmÁ…•%‘át¤¤ì(€€€€€€€€€Éœ¹Í…Ù” ¤ì(€€€€€€€€€Éœ¹Í…±”¡Y\€¼Ñ…É•Ñ\°Y €¼Ñ…É•Ñ ¤ì(€€€€€€€€€Éœ¹ÑÉ…¹Í±…Ñ” µÁ…•1•™Ð°€À¤ì(€€€€€€€€€™½È€¡½¹ÍÐ©½ˆ½˜Á…•)½‰Ì¤…Ý…¥Ð©½ˆ¹ÉÕ¸¡Éœ°±¥Ù”°µ½Ñ¥½¹Ð¤ì(€€€€€€€€€Éœ¹É•ÍÑ½É” ¤ì(€€€€€€€ôì(€€€€€€€€¼¨(€€€€€€€€€ƒ–#š*+ž²³’â–âŸ–B#š"C’â+–:ï–7¦Z/–ž/¦2Ž	…ÁÑÕÉ•MÑÉ•…´ƒšrš*+Ž3¦Z/–ž/¦2žjžVÛ’â/Ž7žV¯–â’â((€€€€€€€€€ƒžj–Ÿ–ºçžVÛš"Cž²³’â–âœƒŠSŠPƒžV¯–â¦
šb¿ž¦ëžj–ÂÇšr¦2–"Ã’âšº×¦îGžV¯¦v‹¾ò3¢3ž²³’âš²‡–B#š"C–> (€€€€€€€€€ƒž&ç–"—š‹¾ò#¢š¢ò'–—–öÇž&Ž¢žžŠóŽ––_šþû¦>‡¾ò'¾ò3¦îGš:'žj¦
šº×–ÂÇšnÓ¦VßŽ(€€€€€€€€¨¼(€€€€€€€…Ý…¥Ð½µÁ½Í¥Ñ” À¤ì((€€€€€€€É•ÑÕÉ¸ìÉŒ°½µÁ½Í¥Ñ”°‘ÕÈ°Ù¥‘Ìôì(€€€€€ôì((€€€€€½¹ÍÐÉ•½É‘A…•Y¥‘•¼€ô…Íå¹Œ€¡Á…•%‘àè¹Õµ‰•È°Á…•1•™Ðè¹Õµ‰•È¤èAÉ½µ¥Í”ñÍÑÉ¥¹œø€ôøì(€€€€€€€½¹ÍÐìÉŒ°½µÁ½Í¥Ñ”°‘ÕÈ°Ù¥‘Ìô€ô…Ý…¥ÐÁÉ•Á…É•A…•Y¥‘•¼¡Á…•%‘à°Á…•1•™Ð¤ì((€€€€€€€½¹ÍÐµ¥µ”€ôlÙ¥‘•¼½µÀÐí½‘•Ìõ…ÙŒÄœ°€Ù¥‘•¼½Ý•‰´í½‘•ÌõÙÀäœ°€Ù¥‘•¼½Ý•‰´t(€€€€€€€€€€¹™¥¹¡Ð€ôøÑåÁ•½˜5•‘¥…I•½É‘•È€„ôô€Õ¹‘•™¥¹•œ€˜˜5•‘¥…I•½É‘•È¹¥ÍQåÁ•MÕÁÁ½ÉÑ•¡Ð¤¤ñð€œœì(€€€€€€€½¹ÍÐÍÑÉ•…´€ôÉŒ¹…ÁÑÕÉ•MÑÉ•…´ ÌÀ¤ì(€€€€€€€½¹ÍÐÉ•Œ€ô¹•Ü5•‘¥…I•½É‘•È¡ÍÑÉ•…´°µ¥µ”€üìµ¥µ•QåÁ”èµ¥µ”°Ù¥‘•½	¥ÑÍA•ÉM•½¹è€ÄÉ|ÀÀÁ|ÀÀÀô€èÕ¹‘•™¥¹•¤ì(€€€€€€€½¹ÍÐ¡Õ¹­Ìè	±½‰mt€ômtì(€€€€€€€É•Œ¹½¹‘…Ñ……Ù…¥±…‰±”€ô”€ôøì¥˜€¡”¹‘…Ñ„¹Í¥é”¤¡Õ¹­Ì¹ÁÕÍ ¡”¹‘…Ñ„¤ìôì(€€€€€€€½¹ÍÐ‘½¹”€ô¹•ÜAÉ½µ¥Í”ñ	±½ˆø¡É•Ì€ôøìÉ•Œ¹½¹ÍÑ½À€ô€ ¤€ôøÉ•Ì¡¹•Ü	±½ˆ¡¡Õ¹­Ì°ìÑåÁ”èµ¥µ”ñð€Ù¥‘•¼½Ý•‰´œô¤¤ìô¤ì(€€€€€€€É•Œ¹ÍÑ…ÉÐ ¤ì(€€€€€€€€¼¼ƒ¦2–öÇ¦Z/–ž/’æ/–ú3š&7šJ·¾ò3ž²³’â–âŸš&7šr–&o––÷šb¿–öÇž&žjž²°€ÀƒžžH(€€€€€€€Ù¥‘Ì¹™½É… ¡Ø€ôøìÑÉäìØ¹Á±…ä ¤¹…Ñ   ¤€ôøíô¤ìô…Ñ ì€¼¨¥¹½É”€¨¼ôô¤ì((€€€€€€€½¹ÍÐÐÀ€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€€€€€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í”ñÙ½¥ø¡É•Í½±Ù”€ôøì(€€€€€€€€€½¹ÍÐ™É…µ”€ô…Íå¹Œ€ ¤€ôøì(€€€€€€€€€€€½¹ÍÐ•°€ôÁ•É™½Éµ…¹”¹¹½Ü ¤€´ÐÀì(€€€€€€€€€€€…Ý…¥Ð½µÁ½Í¥Ñ”¡•°€¼€ÄÀÀÀ¤ì(€€€€€€€€€€€€¼¼ƒšVÓš&çžj¦Ë–ê›¾òt£–ÞË¦2–º3žj¦‚šVà€¬ƒ¦g’â¦‚¦2–"Ã–æûš"@¤ƒÜƒžâ÷–Ç¢š¦2žj¦‚šVà(€€€€€€€€€€€½¹ÍÐ±½…°€ô5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Ä°•°€¼€¡‘ÕÈ€¨€ÄÀÀÀ¤¤¤ì(€€€€€€€€€€€Í•ÑY¥‘•½AÉ½œ¡5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ Ä°€¡Ù¥‘½¹”€¬±½…°¤€¼5…Ñ ¹µ…à Ä°Ù¥‘Q½Ñ…°¤¤¤¤ì(€€€€€€€€€€€¥˜€¡•°€øô‘ÕÈ€¨€ÄÀÀÀñðÙ¥‘•½‰½ÉÑI•˜¹ÕÉÉ•¹Ðñð…¹•±±• ¤¤É•ÑÕÉ¸É•Í½±Ù” ¤ì(€€€€€€€€€€€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡™É…µ”¤ì(€€€€€€€€€ôì(€€€€€€€€€É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡™É…µ”¤ì(€€€€€€€ô¤ì(€€€€€€€É•Œ¹ÍÑ½À ¤ì(€€€€€€€€¼¨½¹ÍÑ½Àƒ’â7–n{’úžjšf–g¾ò#žÞ£žŠó–f£¢Š¯žÎïžÖÇšRÛ¢ÖÃ–ÂÇšr¦gš¢¾ò'–ÂÇš.ÿš&/’â+–ÞËžÚOšRÛ–"Ãžj(€€€€€€€€€€ƒž&šº×šæ+’âšº×–ë’úƒŠSŠPƒ’â7¢š¢ºOšVÓ–/–2¿–ë–s–r£¦
¢Ž‡Ž€¨¼(€€€€€€€½¹ÍÐ‰±½ˆ€ô…Ý…¥ÐAÉ½µ¥Í”¹É…”¡l(€€€€€€€€€‘½¹”°(€€€€€€€€€¹•ÜAÉ½µ¥Í”ñ	±½ˆø¡É•Ì€ôøÍ•ÑQ¥µ•½ÕÐ (€€€€€€€€€€€€ ¤€ôøÉ•Ì¡¹•Ü	±½ˆ¡¡Õ¹­Ì°ìÑåÁ”èµ¥µ”ñð€Ù¥‘•¼½Ý•‰´œô¤¤°€àÀÀÀ¤¤°(€€€€€€€t¤ì(€€€€€€€Ù¥‘½¹”¬¬ì(€€€€€€€É•ÑÕÉ¸UI0¹É•…Ñ•=‰©•ÑUI0¡‰±½ˆ¤ì(€€€€€ôì((€€€€€€¼¨¨(€€€€€€€¨%ƒ¦‚C¢š÷žR£žjŽ3šÒïžjŽ7¦
’â¦‚¾òk’â7¦2–öÇ¾ò3žnÓš:—š*+¦g’â¦‚š2žê3–B#š"C–"Ã’â–ò×žV¯–â’â+¾ò0(€€€€€€€¨ƒ¦
–ò×žV¯–âš:o–"ÃžV¯¦v‹’â+¢ºOž?¢š÷–f£–B#š"CŽ(€€€€€€€¨(€€€€€€€¨ƒ’î—–&7šb¿–#žR 5•‘¥…I•½É‘•Èƒ¦2’âšº×–7šRûŽ¦2–öÇšb¼¨«–6Ïšf¨«žjƒŠSŠP(€€€€€€€¨ƒ–¯žžKžjž&–¶C–ÂÇ–ú_ž¶'–¯žžKš&7šr¦Z/–ž/–.W¾ò#’âï’êë¢ª«žjŽ3¢šž¶'–ú#’æš&7šJ·Ž7¾ò'¾ò0(€€€€€€€¨ƒ¢3’âS¦2žjšf–gžÞ£žŠó–f£¢Þ–B#š"CšBÛ–B3’â¦†AW¾ò3¦2–ë’úžjšvÇ¢–ÿšr³¢ê¯–ÂÇšb¿š:'š‚óžj(€€€€€€€¨ƒ¾ò#Ž3šJ·¢Öß’ú–ú#–6‡Ž7¾ò'Ž(€€€€€€€¨ƒž>û–r£š&O¦Z/žjžVÛ’â/–ÂÇ–r£–.W¾ò3¢3’âSžV¯¦v‹šb¿–6Ïšf–B#š"Cžj¾ò3’â7šršr'š:'š‚ó¢Š¯ž“¦ËšªSš†#¢Ž‡Ž(€€€€€€€¨¼(€€€€€½¹ÍÐ±¥Ù•A…•…¹Ù…Ì€ô…Íå¹Œ€¡Á…•%‘àè¹Õµ‰•È°Á…•1•™Ðè¹Õµ‰•È¤€ôøì(€€€€€€€½¹ÍÐìÉŒ°½µÁ½Í¥Ñ”°Ù¥‘Ìô€ô…Ý…¥ÐÁÉ•Á…É•A…•Y¥‘•¼¡Á…•%‘à°Á…•1•™Ð¤ì(€€€€€€€Ù¥‘Ì¹™½É… ¡Ø€ôøìÑÉäìØ¹Á±…ä ¤¹…Ñ   ¤€ôøíô¤ìô…Ñ ì€¼¨¥¹½É”€¨¼ôô¤ì(€€€€€€€±•Ð…±¥Ù”€ôÑÉÕ”°‰ÕÍä€ô™…±Í”°É…˜€ô€Àì(€€€€€€€½¹ÍÐÍÑ…ÉÑ•€ôÁ•É™½Éµ…¹”¹¹½Ü ¤ì(€€€€€€€½¹ÍÐÑ¥¬€ô€ ¤€ôøì(€€€€€€€€€¥˜€ ……±¥Ù”¤É•ÑÕÉ¸ì(€€€€€€€€€É…˜€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡Ñ¥¬¤ì(€€€€€€€€€¥˜€¡‰ÕÍä¤É•ÑÕÉ¸ì€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ’â+’âš‚ó¦
šÊKžV¯–º3–ÂÇ¢ÞÏ¦;¾ò3’â7¢š–‚ž¦4(€€€€€€€€€‰ÕÍä€ôÑÉÕ”ì(€€€€€€€€€½µÁ½Í¥Ñ” ¡Á•É™½Éµ…¹”¹¹½Ü ¤€´ÍÑ…ÉÑ•¤€¼€ÄÀÀÀ¤¹…Ñ   ¤€ôøì€¼¨¥¹½É”€¨¼ô¤¹Ñ¡•¸  ¤€ôøì‰ÕÍä€ô™…±Í”ìô¤ì(€€€€€€€ôì(€€€€€€€É…˜€ôÉ•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡Ñ¥¬¤ì(€€€€€€€É•ÑÕÉ¸ì…¹Ù…ÌèÉŒ°ÍÑ½Àè€ ¤€ôøì…±¥Ù”€ô™…±Í”ì…¹•±¹¥µ…Ñ¥½¹É…µ”¡É…˜¤ìôôì(€€€€€ôì((€€€€€€¼¼ƒš¾?¦‚–B¢«¢òã–ë’â–ò×žV¯–â¾òk¢žšzC–ê›’â7–7¢Š¯¦‚šVãžNs–"¾ò3¢Þ£¦‚žjšvÇ¢–ÿ¦vƒ–æÏžžï–êŸš¢gš:—žê3Ž(€€€€€Í•ÑY¥‘•½AÉ½œ¡¹Õ±°¤ì(€€€€€Í•ÑY¥‘•½1…‰•° Ÿš¶–r£–2¿–ëš"C–Nœ¤ì(€€€€€½¹ÍÐÕÉ±ÌèÍÑÉ¥¹mt€ômtì(€€€€€½¹ÍÐ­¥¹‘Ìè€ ¥µ…”œð€Ù¥‘•¼œ¥mt€ômtì(€€€€€€¼¨¨(€€€€€€€¨ƒ¦g’â¦‚’â+¦v‹žržjšr'–öÇž&–^;Ž(€€€€€€€¨ƒžVd€À¸ÕÁàƒžj–ºç–Þ»¾òkšîÿž&#žj–öÇž&–&o––÷–"¦ö+¦‚¦v‹¦
+žV3¾ò3šÖ»¦î{¢ª“–Þ»šr¢ºO¦jS–Ž¦
’â¦‚(€€€€€€€¨ƒ’æžº_Ž3žŠÃ–"Ã’êŽ7¾ò3¦
’â¦‚–ÂÇšr¢Š¯¢ª“–"“š"C–öÇž&¦‚Ž(€€€€€€€¨¼(€€€€€½¹ÍÐY%=}}AL€ô€À¸Ôì(€€€€€½¹ÍÐÁ…•!…ÍY¥‘•¼€ô€¡Á…•%‘àè¹Õµ‰•È¤€ôøì(€€€€€€€½¹ÍÐ±•™Ð€ôÁ…•%‘à€¨Ñ…É•Ñ\ì(€€€€€€€É•ÑÕÉ¸‘É…Ý)½‰Ì¹Í½µ”¡¨€ôø(€€€€€€€€€€¡¨¹¥ÍY¥‘•¼ñð€¡¨¹µ½Ñ¥½¹%Ñ•´€˜˜¡…Í½¹™¥ÕÉ•‘5½Ñ¥½¸¡¨¹µ½Ñ¥½¹%Ñ•´¤¤¤(€€€€€€€€€€˜˜¨¹µ…á`€ø±•™Ð€¬Y%=}}AL€˜˜¨¹µ¥¹`€ð±•™Ð€¬Ñ…É•Ñ\€´Y%=}}AL¤ì(€€€€€ôì(€€€€€€¼¨ƒ–#šVã¦;’â¦7¾òkšr'–æû¦‚šb¿–öÇž&Ž(€€€€€€€€ƒ’â¦‚¦÷šÊKšr$ƒŠHƒ’â7¦†¿ž’ëžfû–"š¾S¾ò#žÒS–r[ž&šr³’ú–ÂÇ–ú#–þ¯¾ò3–>«žVg¢ö'–r#¾ò'¾òl(€€€€€€€€ƒš¾?’â¦‚¦÷šb¿–öÇž&ƒŠHƒšZš†#Ž3š¶–r£–2¿–ë–öÇž&Ž7¾òl(€€€€€€€€ƒšr'–öÇž&’æšr'–r[ž&ƒŠHƒšZš†#Ž3š¶–r£–2¿–ëš"C–NŽ7Ž€¨¼(€€€€€€¼¨±¥Ù”ƒ¦
šŠw¢Þ¿’â7¦2–öÇ¾ò#šRçš"Cž>û–‚Ó–B#š"C¾ò'¾ò3š&’î—’æšÊKšr'Ž3¦2–"Ãž²³–æûš"CŽ7–>¿¢¢ ƒŠSŠPƒžº\€ÃŽ€¨¼(€€€€€½¹ÍÐÙ¥‘•½A…•Ì€ô€¡ÍÑ¥±±=¹±äñð±¥Ù”¤€ü€À€èÁ…•Ì¹É•‘Õ” (€€€€€€€€¡¸°}À°¤¤€ôø¸€¬€¡Á…•!…ÍY¥‘•¼¡¤¤€˜˜ÑåÁ•½˜5•‘¥…I•½É‘•È€„ôô€Õ¹‘•™¥¹•œ€ü€Ä€è€À¤°€À¤ì(€€€€€Ù¥‘Q½Ñ…°€ôÙ¥‘•½A…•Ìì(€€€€€€¼¨ÍÑ¥±±=¹±äƒšfš‚çšr³’â7šr–:ï¦2–öÇž&¾ò3¦
–/¦Ë–ê›žV¯¦v‹–ÂÇ’â7¢÷¢ÞÏ–ë’ú(€€€€€€€€ƒ¾ò#–ºšb¿šVÓž&¢N/’ö?žj’â–Æ“¾ò3¦Z’â’â/–ú#šb;¦†¿¾ò'Ž€¨¼(€€€€€¥˜€¡Ù¥‘•½A…•Ì€ø€À¤ì(€€€€€€€Í•ÑY¥‘•½1…‰•°¡Ù¥‘•½A…•Ì€ôôôÁ…•Ì¹±•¹Ñ €ü€Ÿš¶–r£–2¿–ë–öÇž&œ€è€Ÿš¶–r£–2¿–ëš"C–Nœ¤ì(€€€€€€€Í•ÑY¥‘•½AÉ½œ À¤ì(€€€€€ô((€€€€€€¼¼ƒšr'–öÇž&žj¦
’â¦‚¢òã–ë–öÇž&ŽšÊKšr'–öÇž&žj¦
’â¦‚žŸ¢"+¢òã–ëž‡šB4A9¾ò3–B–ë–Bžj(€€€€€™½È€¡±•ÐÁ…•%‘à€ô€ÀìÁ…•%‘à€ðÁ…•Ì¹±•¹Ñ ìÁ…•%‘à¬¬¤ì(€€€€€€€€¼¼ƒš2'’ê–>[šÚ#–ÂÇ–"—–7–k’â/’â¦‚ƒŠSŠPƒ–’k¦‚šf–&§’â/žjš¾?’â¦‚¦÷¢š–7ž¶'’â¢ò«¦2–öÄ(€€€€€€€¥˜€¡…¹•±±• ¤¤ì‘É½ÁUÉ±Ì¡ÕÉ±Ì¤ì±¥Ù•A…•Ì¹™½É… ¡°€ôø°€˜˜°¹ÍÑ½À ¤¤ìÍ•ÑY¥‘•½AÉ½œ¡¹Õ±°¤ìÉ•ÑÕÉ¸ìô(€€€€€€€½¹ÍÐÁ…•1•™Ð€ôÁ…•%‘à€¨Ñ…É•Ñ\ì(€€€€€€€½¹ÍÐ¡…ÍY¥‘•¼€ôÁ…•!…ÍY¥‘•¼¡Á…•%‘à¤ì(€€€€€€€¥˜€¡¡…ÍY¥‘•¼€˜˜±¥Ù”¤ì(€€€€€€€€€€¼¼ƒž>û–‚Ó–B#š"C¾òkžV¯–âžVgžÖ›–Fó–>¯ž®¿¾ò3¦g’â¦‚–7–ú’â/¢ÖÃ’âš²‡¾ò3–ë’â–ò×¦vsš/–r[žVÛ–êT(€€€€€€€€€ÑÉäì±¥Ù•A…•ÍmÁ…•%‘át€ô…Ý…¥Ð±¥Ù•A…•…¹Ù…Ì¡Á…•%‘à°Á…•1•™Ð¤ìô(€€€€€€€€€…Ñ ì±¥Ù•A…•ÍmÁ…•%‘át€ô¹Õ±°ìô(€€€€€€€ô•±Í”¥˜€¡¡…ÍY¥‘•¼€˜˜€…ÍÑ¥±±=¹±ä€˜˜ÑåÁ•½˜5•‘¥…I•½É‘•È€„ôô€Õ¹‘•™¥¹•œ¤ì(€€€€€€€€€ÕÉ±Ì¹ÁÕÍ ¡…Ý…¥ÐÉ•½É‘A…•Y¥‘•¼¡Á…•%‘à°Á…•1•™Ð¤¤ì(€€€€€€€€€­¥¹‘Ì¹ÁÕÍ  Ù¥‘•¼œ¤ì(€€€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€€€ô(€€€€€€€…¹Ù…Ì¹Ý¥‘Ñ €ôÑ…É•Ñ\ì(€€€€€€€…¹Ù…Ì¹¡•¥¡Ð€ôÑ…É•Ñ ì(€€€€€€€Ñà¹±•…ÉI•Ð À°€À°Ñ…É•Ñ\°Ñ…É•Ñ ¤ì(€€€€€€€Ñà¹™¥±±MÑå±”€ôÁ…•ÍmÁ…•%‘át¹‰½±½Èñð€œ™™™™™˜œì(€€€€€€€Ñà¹™¥±±I•Ð À°€À°Ñ…É•Ñ\°Ñ…É•Ñ ¤ì(€€€€€€€Á…¥¹ÑA…ÑÑ•É¸¡Ñà°Ñ…É•Ñ\°Ñ…É•Ñ °Á…•A…ÑÑ•É¸¡Á…•ÍmÁ…•%‘át¤¤ì€€€¼¼ƒžÒ/žB¢Þ–êW¢&Ëšb¿’âžÖžj¾ò#š¾?¦‚–B¢«¾ò$((€€€€€€€Ñà¹Í…Ù” ¤ì(€€€€€€€Ñà¹ÑÉ…¹Í±…Ñ” µÁ…•1•™Ð°€À¤ì(€€€€€€€™½È€¡½¹ÍÐ©½ˆ½˜‘É…Ý)½‰Ì¤ì(€€€€€€€€€¥˜€¡©½ˆ¹µ…á`€ðôÁ…•1•™Ðñð©½ˆ¹µ¥¹`€øôÁ…•1•™Ð€¬Ñ…É•Ñ\¤½¹Ñ¥¹Õ”ì(€€€€€€€€€…Ý…¥Ð©½ˆ¹ÉÕ¸¡Ñà¤ì(€€€€€€€ô(€€€€€€€Ñà¹É•ÍÑ½É” ¤ì((€€€€€€€€¼¨ƒ’â–ºk¢š¢ÖÀ…¹Ù…ÍQ½UÉ³¾ò3’â7¢÷žnÓš:—–>¬Ñ½	±½‹¾òkžV¯–â–ú#–’Ÿ–>#žŠÃ’â+¢¢cšÛ¦®S–BžÞ+šf¾ò0(€€€€€€€€€€¥=LƒžjÑ½	±½ˆƒšr'š¦šršÂã¦ƒ’â7–n{’ú¾ò#¢š,ÕÑ¥±Ì½‰±½‰UÉ°ƒžjžr/¦Zž._¾ò'ŠSŠP(€€€€€€€€€€ƒ¦
šf–gšVÓ–/–2¿–ë–ÂÇ–s–r£Ž3š¶–r£–2¿–ëš"C–NŽ7¾ò3¢3¦
’â–Æ“¢N/¢F_¢þS–n{¦6×Ž€¨¼(€€€€€€€½¹ÍÐÕÉ°€ô…Ý…¥Ð…¹Ù…ÍQ½UÉ°¡…¹Ù…Ì¤ì(€€€€€€€¥˜€ …ÕÉ°¤Ñ¡É½Ü¹•ÜÉÉ½È 	±½ˆÉ•…Ñ¥½¸™…¥±•œ¤ì(€€€€€€€ÕÉ±Ì¹ÁÕÍ ¡ÕÉ°¤ì(€€€€€€€­¥¹‘Ì¹ÁÕÍ  ¥µ…”œ¤ì(€€€€€ô((€€€€€¥˜€¡ÕÉ±Ì¹±•¹Ñ €ôôô€À¤Ñ¡É½Ü¹•ÜÉÉ½È 	±½ˆÉ•…Ñ¥½¸™…¥±•œ¤ì(€€€€€Í•ÑY¥‘•½AÉ½œ¡¹Õ±°¤ì€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦2–º3’ê¾ò3¦Ë–ê›žV¯¦v‹šRÛš:$(€€€€€¥˜€¡Í¥±•¹Ð¤É•ÑÕÉ¸ìÕÉ±Ì°­¥¹‘Ì°±¥Ù”è±¥Ù”€ü±¥Ù•A…•Ì€èÕ¹‘•™¥¹•ôì(€€€€€€¼¨ƒ’öÿžR£¢–r£¦g’â¢ò«¢ÞG–º3’æ/–&7š2'’êŽ3–>[šÚ#–2¿–ëŽ7¾òkžVg–r£žÞ£¢ò¿¦‚¾ò0(€€€€€€€€ƒš"C–NžnÓš:—’âš:'¾ò#žV¯¦v‹š^§–ÂÇ¦–nx¥‘±”ƒ’ê¾ò3¦g¢Ž‡’â7¢š–7–:ï–.W–º¾ò'Ž€¨¼(€€€€€¥˜€¡…¹•±±• ¤¤ì‘É½ÁUÉ±Ì¡ÕÉ±Ì¤ìÉ•ÑÕÉ¸ìô(€€€€€™¥¹…±%µ…•ÍI•˜¹ÕÉÉ•¹Ð¹™½É… ¡Ô€ôøUI0¹É•Ù½­•=‰©•ÑUI0¡Ô¤¤ì(€€€€€™¥¹…±%µ…•ÍI•˜¹ÕÉÉ•¹Ð€ôÕÉ±Ìì(€€€€€Í•Ñ¥¹…±%µ…•Ì¡ÕÉ±Ì¤ì(€€€€€Í•Ñ¥¹…±-¥¹‘Ì¡­¥¹‘Ì¤ì(€€€€€Í•ÑáÁ½ÉÑMÑ…Ñ” ÍÕ•ÍÌœ¤ì(€€€ô…Ñ €¡•ÉÈ¤ì(€€€€€½¹Í½±”¹•ÉÉ½È¡•ÉÈ¤ì(€€€€€Í•ÑY¥‘•½AÉ½œ¡¹Õ±°¤ì(€€€€€±¥Ù•A…•Ì¹™½É… ¡°€ôø°€˜˜°¹ÍÑ½À ¤¤ì(€€€€€¥˜€¡Í¥±•¹Ð¤É•ÑÕÉ¸ì(€€€€€€¼¼ƒ–>[šÚ#š:'žj¦
’â¢ò«–6+¢Þ¿–Ž{š:'šb¿š¶–âãžj¾ò#’úšêC¢Š¯šRÛ¢ÖÃ¾ò'¾ò3’â7¢š–7–ö#’âš²‡–’ÇšV\(€€€€€¥˜€¡…¹•±±• ¤¤É•ÑÕÉ¸ì(€€€€€…±•ÉÐ Ÿ–¶cšªS–’ÇšV_¾ò3¢®/¦7¢¦˜œ¤ì(€€€€€Í•ÑáÁ½ÉÑMÑ…Ñ” ¥‘±”œ¤ì(€€€ô(€ôì((€É•ÑÕÉ¸€ (€€€€ñ‘¥ØÉ•˜õíÉ¥‘I½½ÑI•™ô±…ÍÍ9…µ”ô‰Í…™”µÑ½À™±•à™±•àµ½°Üµ™Õ±° µÍÉ••¸‰œµ‰±…¬Ñ•áÐµÝ¡¥Ñ”É•±…Ñ¥Ù”™½¹ÐµÍ…¹Ì½Ù•É™±½Üµ¡¥‘‘•¸ˆø(€€€€€€ñÍÑå±”ùí€(€€€€€€€€¼¨ƒ–rOžB¢ÞŽ3’ö#–Æ¢ªÿšVÓŽ7žjšîGš†ÿ’â¢Ó¾òkšÊÿžR£–:žR|Ñ¡Õµˆ€¬…•¹Ðµ½±½Ë¾ò3’â7¢«–ÞÇžV¬€¨¼(€€€€€€€€¼¨ƒ¦†?¢&ËšîGš†ÿ¾òk–n{–"Ã–:šr³¦
’âž& ƒŠSŠPƒšòã–Æ“žV¯–r£–’îÛ’â+Ž–rO¦î{žR£ž?¢š÷–f£–:žRžj(€€€€€€€€€€ƒ¾ò!…•¹Ðµ½±½Èƒžf÷¾ò'¾ò3’æ–ÂÇšb¿’âï’êë¢ª«žjŽ3š¦‹–rOžj¦
–/š¢–¶CŽ7Ž€¨¼(€€€€€€€€¼¨ƒ¢žãš:Ÿž¾–r7žj–kšÎW¾ò#–R¿’â’âž¢»’â7šr–.W–"Ãž&#¦v‹žj¾ò'¾òh(€€€€€€€€€€ƒ–’[¦v‹–2’â–Æ“Ž3¢Þ–:šr³šîGš†ÿ’âš¢¦®cŽ7žjžnK–¶C¾ò3šîGš†ÿšr³’êëšRçš"CžÖW–Â7–ºk’ö7Ž’â+’â/žö»’â·¾òl(€€€€€€€€€€ƒšJC–’Ÿžj¦
’â–r#žR €èé‰•™½É”ƒ¦.«–r£žnK–¶C’â+Ž–§¢¦÷’â7’öS’îï’öWž&#¦v‹ž¦ë¦ZO¾ò0(€€€€€€€€€€ƒš&’î—¦ZO¢ÞwŽ–Â7¦ö+–º3–£’â7¢º+Ž(€€€€€€€€€€ƒžö»’â·žR Ñ½À¯¢Ê€µ…É¥»¾ò3’â7žR ÑÉ…¹Í™½É·¾òiÑÉ…¹Í™½É´ƒšrš*+šîGš†ÿ’â–"Ã¢«–ÞÇžj(€€€€€€€€€€ƒ–B#š"C–Æ“’â+¾ò3š.[–.Wšfžf÷¦î{šr¢Þ¢F_¦ZŽ((€€€€€€€€€€€€€€€€€€ƒž
ë’î¦êóšJC–’Ÿžjšb¼€èé‰•™½É—Ž’â7šb¿šîGš†ÿšr³’êë¾òkšîGš†ÿ’âš^›¢Š¯šJC¦®c¾ò3¦
’âšVÓ–†+¦÷šr–âÛ¢F\(€€€€€€€€€€¡É½µ¥Õ´ƒ–:žRžjŽ3š2'’â/–:ï–ÂÇ¢ÞÏ–"Ãš&/š2žj’ö7žö»Ž7¾ò3¢3’âSšRS’â7š:'¾ò!ÁÉ•Ù•¹Ñ•™…Õ±Ð(€€€€€€€€€€ƒ–Â4É…¹”ƒžjš.[šnÏšÊKšr'’ösžR£¾ò'ŠSŠPƒšÏš2'’â/¦v‹¦
¦†š2'¦"W¾ò3–.W–"Ãžj–6ïšb¿’â+¦v‹¦
š‚çšîGš†ÿŽ(€€€€€€€€€€ƒ¦Vß–r €èé‰•™½É”ƒ’â+–ÂÇšÊKšr'’îï’öW–:žR¢†3ž
ë¢š–Â7š*_¾òkš&/–.‹šRçžRÄÕÑ¥±Ì½Í±¥‘•ÉQ½Õ ¹ÑÌ(€€€€€€€€€€ƒ–"“¢º¾ò3š¦¯–BGžžï–.W¾òwš.[šîGš†ÿ¾ò3šRû¦Z/šfšÊKžžï–.W¾òwš*+¦g’â’â/¢ö'’ê“žÖ›–êW’â/žj–žÒƒŽ€¨¼(€€€€€€€€¹Í±¥‘•ÈµÝÉ…ÀìÁ½Í¥Ñ¥½¸èÉ•±…Ñ¥Ù”ìÑ½Õ µ…Ñ¥½¸èÁ…¸µäìô(€€€€€€€€¼¨Ñ½Õ µ…Ñ¥½¸ƒ’â–ºk¢š–¾¯–r €¹Í±¥‘•ÈµÝÉ…Àƒ’â+Ž’â7¢÷–>«–¾¯–r €èé‰•™½É—¾òh(€€€€€€€€€€ƒ–÷–žÒƒ¢Š¯¦î{–"Ãšf¾ò3ž?¢š÷–f£š~—žjšb¿Ž3žR‹žR–ºžj¦
–/–žÒƒŽ7žjÑ½Õ µ…Ñ¥½¸ƒŠSŠP(€€€€€€€€€€ƒ–¾¯–r €èé‰•™½É”ƒ’â+ž¶'šZóšÊK–¾¯¾ò3š¦¯–BGš.[šnÏšr¢Š¯žVÛš"Cš6Ë–.W¢3’â·¦S¢Š¯šRÛ¢ÖÀ(€€€€€€€€€€ƒ¾ò#š.[–"Ã’â–6+–ÂÇ–s–r£¦
¢Ž‡¾ò'Ž€¨¼(€€€€€€€€¹Í±¥‘•ÈµÝÉ…Àèé‰•™½É”ì½¹Ñ•¹Ðè€œœìÁ½Í¥Ñ¥½¸è…‰Í½±ÕÑ”ì±•™Ðè€´ÝÁàìÉ¥¡Ðè€´ÝÁàìÑ½Àè€ÔÀ”ì¡•¥¡Ðè€ÔÙÁàìµ…É¥¸µÑ½Àè€´ÈáÁàìô(€€€€€€€€¼¨ƒ¦ãšN–f£¦÷–¾¯š"@¥¹ÁÕÐ¹ááã¾ò3ž&çžVÃ–ê›¢Þ’â+¦v‹¦
šŠw’âš¢Ž–>#š:K–r£–ú3¦vˆƒŠSŠP(€€€€€€€€€€ƒ’â7žØµ…É¥¸ƒšr¢Š¯’â+¦v‹žj¦k–&šÒ_š:'¾ò3šîGš†ÿ–ÂÇšršVÓšŠwš:'–"Ã¢î3¦O’â/¦v‹¾ò#žf÷žB–?’â/¾ò'Ž€¨¼(€€€€€€€€¼¨ƒ–Þ›–>Ï–B–’[šNÐ€ÝÁã¾ò#¢î3¦O–§ž®¿–ÞËžÚOžVg’ê–B3š¢–¾³žj¦?šb;¾ò3žr/–"ÃžjžÞk¦Vß–ê›’â7¢º+¾ò$€¨¼(€€€€€€€€¹Í±¥‘•ÈµÝÉ…À€ø¥¹ÁÕÑmÑåÁ”õÉ…¹•tìÁ½Í¥Ñ¥½¸è…‰Í½±ÕÑ”ì±•™Ðè€´ÝÁàìÝ¥‘Ñ è…±Œ ÄÀÀ”€¬€ÄÑÁà¤ìÑ½Àè€ÔÀ”ìÁ½¥¹Ñ•Èµ•Ù•¹ÑÌè¹½¹”ìô(€€€€€€€€¼¨ƒšîGš†ÿšr³’êëžÚ·š2–:šr³žj¦®c–ê›¾òk¢î3¦O¢"žf÷¦î{¦÷šb¿žnã–Â7Ž3žnK–¶Cžj’â·žÞkŽ7žV¯žj¾ò0(€€€€€€€€€€ƒš&’î—¦®c–ê›’â7–öÇ¦~ÿ–’[¢ž¾ò3¢3–º’æ–ÂÇ’â7šr¢N/–"Ã’â+’â/žnã¦Ãžjš2'¦"WŽ€¨¼(€€€€€€€€¹Í±¥‘•ÈµÝÉ…À€ø¥¹ÁÕÐ¹ÁÉ•µ¥Õ´µÍ±¥‘•È°€¹Í±¥‘•ÈµÝÉ…À€ø¥¹ÁÕÐ¹Í±¥´µÍ±¥‘•Èì¡•¥¡Ðè€ÄÙÁàìµ…É¥¸è€´áÁà€À€À€Àìô(€€€€€€€€¹Í±¥‘•ÈµÝÉ…À€ø¥¹ÁÕÐ¹‘•Í¥¹•Èµ½±½ÈµÍ±¥‘•Èì¡•¥¡Ðè€ÄÙÁàìµ…É¥¸è€´áÁà€À€À€Àì±•™Ðè€ÀìÝ¥‘Ñ è€ÄÀÀ”ì‰…­É½Õ¹èÑÉ…¹ÍÁ…É•¹Ð€…¥µÁ½ÉÑ…¹Ðìô((€€€€€€€€¼¨ƒ¦†?¢&ËšîGš†ÿ¾òhÙÁàƒžjšòã–Æ“¢î3¦Lƒ¾ò,ƒ¢«–ÞÇžV¯žjžf÷–rOžBŽ(€€€€€€€€€€ƒ–rOžBžR µ…É¥¸µÑ½Àƒ–Â7¦ö+¢î3¦Oš¶’â·–’»¾ò  Ø´Äà¤¼È€ô€´Û¾ò'¾ò0(€€€€€€€€€€ƒ’â7–7žR£ž?¢š÷–f£–:žR¦
¦†ƒŠSŠPƒ–:žRžj–r£¢«¢¢¢î3¦O¦®c–ê›’â/šr–?’â/¾ò3š.[–.Wšf’æšr¦ZŽ€¨¼(€€€€€€€€¹‘•Í¥¹•Èµ½±½ÈµÍ±¥‘•Èì€´µÑ¡ÕµˆµÜè€ÄÑÁàì€µÝ•‰­¥Ðµ…ÁÁ•…É…¹”è¹½¹”ì…ÁÁ•…É…¹”è¹½¹”ìÝ¥‘Ñ è€ÄÀÀ”ì¡•¥¡Ðè€ÙÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÍÁàì½ÕÑ±¥¹”è¹½¹”ìÑ½Õ µ…Ñ¥½¸èÁ…¸µäìÕÉÍ½ÈèÁ½¥¹Ñ•Èì€µÝ•‰­¥ÐµÑ…Àµ¡¥¡±¥¡Ðµ½±½ÈèÉ‰„ À°À°À°À¤ìô(€€€€€€€€¹‘•Í¥¹•Èµ½±½ÈµÍ±¥‘•ÈèèµÝ•‰­¥ÐµÍ±¥‘•ÈµÉÕ¹¹…‰±”µÑÉ…¬ì¡•¥¡Ðè€ÙÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÍÁàì‰…­É½Õ¹èÙ…È ´µ‰…È°€ŒÌÌÌ¤ìô(€€€€€€€€¹‘•Í¥¹•Èµ½±½ÈµÍ±¥‘•ÈèèµÝ•‰­¥ÐµÍ±¥‘•ÈµÑ¡Õµˆì€µÝ•‰­¥Ðµ…ÁÁ•…É…¹”è¹½¹”ìÝ¥‘Ñ è€ÄÑÁàì¡•¥¡Ðè€ÄÑÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ì‰…­É½Õ¹è€™™˜ì‰½É‘•Èè¹½¹”ìµ…É¥¸µÑ½Àè€´ÑÁàìÕÉÍ½ÈèÁ½¥¹Ñ•Èì‰½àµÍ¡…‘½Üè€À€ÅÁà€ÑÁàÉ‰„ À°À°À°À¸ÐÔ¤ìô(€€€€€€€€¹‘•Í¥¹•Èµ½±½ÈµÍ±¥‘•Èèèµµ½èµÉ…¹”µÑÉ…¬ì¡•¥¡Ðè€ÙÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÍÁàì‰…­É½Õ¹èÙ…È ´µ‰…È°€ŒÌÌÌ¤ìô(€€€€€€€€¹‘•Í¥¹•Èµ½±½ÈµÍ±¥‘•Èèèµµ½èµÉ…¹”µÑ¡ÕµˆìÝ¥‘Ñ è€ÄÑÁàì¡•¥¡Ðè€ÄÑÁàì‰½É‘•Èè€Àì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ì‰…­É½Õ¹è€™™˜ìÕÉÍ½ÈèÁ½¥¹Ñ•Èìô(€€€€€€€€¹¹¼µÍÉ½±±‰…ÈèèµÝ•‰­¥ÐµÍÉ½±±‰…Èì‘¥ÍÁ±…äè¹½¹”ìô(€€€€€€€­•å™É…µ•Ì±…ÍÍ¥Œµµ½Ñ¥½¸µÑ…É•Ðµ™±…Í ì(€€€€€€€€€€À”ì½Á…¥Ñäè€Àìô(€€€€€€€€€€Äà”ì½Á…¥Ñäè€Äìô(€€€€€€€€€€ÜÈ”ì½Á…¥Ñäè€Äìô(€€€€€€€€€€ÄÀÀ”ì½Á…¥Ñäè€Àìô(€€€€€€€ô(€€€€€€€€¼¨ƒ–r[ž&žÞ£¢ò¿¦
’â¦‚žjšîGš†ÿ¾òk¢ÞŽ3žÞ£¢ò¿Ž7žR£–B3’âžÖš¢–ò?¾ò3¦¢î3¦O¢"–rO¦î{¦÷’âš¢Œ€¨¼(€€€€€€€€¹ÕÍÑ½´µÉ…¹”ì(€€€€€€€€€€µÝ•‰­¥Ðµ…ÁÁ•…É…¹”è¹½¹”ì(€€€€€€€€€Ý¥‘Ñ è…±Œ ÄÀÀ”€¬€ØÑÁà¤ì(€€€€€€€€€¡•¥¡Ðè€ÐÁÁàì(€€€€€€€€€‰…­É½Õ¹èÉ‰„ À°À°À°À¤ì(€€€€€€€€€½ÕÑ±¥¹”è¹½¹”ì(€€€€€€€€€µ…É¥¸è€À€´ÌÉÁàì(€€€€€€€€€Á…‘‘¥¹œè€Àì(€€€€€€€€€Ñ½Õ µ…Ñ¥½¸è¹½¹”ì(€€€€€€€€€€µÝ•‰­¥ÐµÑ…Àµ¡¥¡±¥¡Ðµ½±½ÈèÉ‰„ À°À°À°À¤ì(€€€€€€€ô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”é™½ÕÌì½ÕÑ±¥¹”è¹½¹”ìô(€€€€€€€€¼¨ƒž&çšV#žÒÃ¦‚žj’â›š:KšîGš†ÿ¾òk¢ÞŽ3žÞ£¢ò¿Ž7–B3’â’î÷ŽžnK–¶CšRÛ–"À€ÄáÁã¾ò#–&o––÷–2’ö<€ÄÕÁàƒžj–rO¦î{¾ò'¾ò0(€€€€€€€€€€ƒ¢î3¦O’æ–>«žV¬€åÁà¸»–¾°´åÁã¾ò3–rO¦î{š&7¢ÖÃ–ú_–"Ã¦‚·–Âû¾ò#’â›š:KžjšîGš†ÿ’â7¢÷–?’â¢"³šîGš†ÿ¦
š¢–ú–’[šNÓ¾ò'Ž€¨¼(€€€€€€€€¹ÕÍÑ½´µÉ…¹”¹‘•¹Í”ì¡•¥¡Ðè€ÈÙÁàìÝ¥‘Ñ è€ÄÀÀ”ìµ…É¥¸è€Àìô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”¹‘•¹Í”èèµÝ•‰­¥ÐµÍ±¥‘•ÈµÉÕ¹¹…‰±”µÑÉ…¬ì(€€€€€€€€€‰…­É½Õ¹è±¥¹•…ÈµÉ…‘¥•¹Ð¡Ñ¼É¥¡Ð°É‰„ À°À°À°À¤€åÁà°€ŒÌÌÌ€åÁà°€ŒÌÌÌ…±Œ ÄÀÀ”€´€åÁà¤°É‰„ À°À°À°À¤…±Œ ÄÀÀ”€´€åÁà¤¤ì(€€€€€€€ô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”¹‘•¹Í”èèµµ½èµÉ…¹”µÑÉ…¬ì(€€€€€€€€€‰…­É½Õ¹è±¥¹•…ÈµÉ…‘¥•¹Ð¡Ñ¼É¥¡Ð°É‰„ À°À°À°À¤€åÁà°€ŒÌÌÌ€åÁà°€ŒÌÌÌ…±Œ ÄÀÀ”€´€åÁà¤°É‰„ À°À°À°À¤…±Œ ÄÀÀ”€´€åÁà¤¤ì(€€€€€€€ô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”¹‘•¹Í”èèµÝ•‰­¥ÐµÍ±¥‘•ÈµÑ¡Õµˆì¡•¥¡Ðè€ÈÙÁàìÝ¥‘Ñ è€ÄáÁàìµ…É¥¸µÑ½Àè€´ÄÉÁàìô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”¹‘•¹Í”èèµµ½èµÉ…¹”µÑ¡Õµˆì¡•¥¡Ðè€ÈÙÁàìÝ¥‘Ñ è€ÄáÁàìô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”èèµÝ•‰­¥ÐµÍ±¥‘•ÈµÉÕ¹¹…‰±”µÑÉ…¬ì(€€€€€€€€€Ý¥‘Ñ è€ÄÀÀ”ì(€€€€€€€€€¡•¥¡Ðè€ÉÁàì(€€€€€€€€€‰…­É½Õ¹è±¥¹•…ÈµÉ…‘¥•¹Ð¡Ñ¼É¥¡Ð°É‰„ À°À°À°À¤€ÌÉÁà°€ŒÌÌÌ€ÌÉÁà°€ŒÌÌÌ…±Œ ÄÀÀ”€´€ÌÉÁà¤°É‰„ À°À°À°À¤…±Œ ÄÀÀ”€´€ÌÉÁà¤¤ì(€€€€€€€€€‰½É‘•ÈµÉ…‘¥ÕÌè€ÉÁàì(€€€€€€€€€ÕÉÍ½ÈèÁ½¥¹Ñ•Èì(€€€€€€€ô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”èèµÝ•‰­¥ÐµÍ±¥‘•ÈµÑ¡Õµˆì(€€€€€€€€€€µÝ•‰­¥Ðµ…ÁÁ•…É…¹”è¹½¹”ì(€€€€€€€€€¡•¥¡Ðè€ØÑÁàì(€€€€€€€€€Ý¥‘Ñ è€ØÑÁàì(€€€€€€€€€‰…­É½Õ¹µ½±½ÈèÉ‰„ À°À°À°À¤ì(€€€€€€€€€‰…­É½Õ¹µ¥µ…”èÉ…‘¥…°µÉ…‘¥•¹Ð¡¥É±”…Ð•¹Ñ•È°€™™™™™˜€À°€™™™™™˜€Ü¸ÕÁà°É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¤€áÁà°É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¤€ÄÀÀ”¤ì(€€€€€€€€€‰½É‘•Èè¹½¹”ì(€€€€€€€€€½ÕÑ±¥¹”è¹½¹”ì(€€€€€€€€€ÕÉÍ½ÈèÁ½¥¹Ñ•Èì(€€€€€€€€€µ…É¥¸µÑ½Àè€´ÌÅÁàì(€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸èÑÉ…¹Í™½É´€À¸ÅÌì(€€€€€€€€€‰½àµÍ¡…‘½Üè¹½¹”ì(€€€€€€€ô(€€€€€€€€¼¨ƒžÒÃ¢î3¦Lƒ¾ò,ƒ–’Ÿ–rO¦î{¾òk¢î3¦O¢ÞŽ3žÞ£¢ò¿Ž7žjšþû¦>‡šîGš†ÿ’âš¢žÒÃ¾ò3–rO¦î{–>[žV¯¦v‹’â+šr–’Ÿžj¦
’â¦†€¨¼(€€€€€€€€¹Í±¥´µÍ±¥‘•Èì€´µÑ¡ÕµˆµÜè€ÈáÁàì€µÝ•‰­¥Ðµ…ÁÁ•…É…¹”è¹½¹”ì…ÁÁ•…É…¹”è¹½¹”ìÝ¥‘Ñ è€ÄÀÀ”ì¡•¥¡Ðè€ÄÙÁàì‰…­É½Õ¹èÑÉ…¹ÍÁ…É•¹Ðì½ÕÑ±¥¹”è¹½¹”ìÑ½Õ µ…Ñ¥½¸èÁ…¸µäìÕÉÍ½ÈèÁ½¥¹Ñ•Èì€µÝ•‰­¥ÐµÑ…Àµ¡¥¡±¥¡Ðµ½±½ÈèÉ‰„ À°À°À°À¤ìô(€€€€€€€€¹Í±¥´µÍ±¥‘•ÈèèµÝ•‰­¥ÐµÍ±¥‘•ÈµÉÕ¹¹…‰±”µÑÉ…¬ì¡•¥¡Ðè€ÉÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÉÁàì(€€€€€€€€€‰…­É½Õ¹è±¥¹•…ÈµÉ…‘¥•¹Ð¡Ñ¼É¥¡Ð°É‰„ À°À°À°À¤€ÝÁà°€ŒÌÌÌ€ÝÁà°€ŒÌÌÌ…±Œ ÄÀÀ”€´€ÝÁà¤°É‰„ À°À°À°À¤…±Œ ÄÀÀ”€´€ÝÁà¤¤ìô(€€€€€€€€¼¨ƒ–rO¦î{žjš†¾òwžf÷¦î{žj–§–7¾ò ÈáÁã¾ò'¾ò3žf÷¦î{¦
šb¿š¶’â·–’»¦
Œ€ÄÑÁã¾ò3¢†3ž¢/–º3–£’â7¢º(€¨¼(€€€€€€€€¹Í±¥´µÍ±¥‘•ÈèèµÝ•‰­¥ÐµÍ±¥‘•ÈµÑ¡Õµˆì€µÝ•‰­¥Ðµ…ÁÁ•…É…¹”è¹½¹”ìÝ¥‘Ñ è€ÈáÁàì¡•¥¡Ðè€ÄÑÁàì‰½É‘•Èè¹½¹”ìµ…É¥¸µÑ½Àè€´ÙÁàìÕÉÍ½ÈèÁ½¥¹Ñ•Èì(€€€€€€€€€‰…­É½Õ¹èÉ…‘¥…°µÉ…‘¥•¹Ð¡¥É±”…Ð•¹Ñ•È°€™™˜€À°€™™˜€ÝÁà°É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¤€Ü¸ÕÁà°É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¤€ÄÀÀ”¤ìô(€€€€€€€€¹Í±¥´µÍ±¥‘•Èèèµµ½èµÉ…¹”µÑÉ…¬ì¡•¥¡Ðè€ÉÁàì‰…­É½Õ¹è€ŒÌÌÌì‰½É‘•ÈµÉ…‘¥ÕÌè€ÉÁàìô(€€€€€€€€¹Í±¥´µÍ±¥‘•Èèèµµ½èµÉ…¹”µÑ¡ÕµˆìÝ¥‘Ñ è€ÄÑÁàì¡•¥¡Ðè€ÄÑÁàì‰½É‘•Èè€Àì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ì‰…­É½Õ¹è€™™˜ìÕÉÍ½ÈèÁ½¥¹Ñ•Èìô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”èèµÝ•‰­¥ÐµÍ±¥‘•ÈµÑ¡Õµˆé…Ñ¥Ù”ìÑÉ…¹Í™½É´èÍ…±” Ä¸ÄÔ¤ìô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”èèµµ½èµÉ…¹”µÑÉ…¬ì¡•¥¡Ðè€ÉÁàì‰…­É½Õ¹è€ŒÌÌÌì‰½É‘•ÈµÉ…‘¥ÕÌè€ÉÁàìô(€€€€€€€€¹ÕÍÑ½´µÉ…¹”èèµµ½èµÉ…¹”µÑ¡Õµˆì(€€€€€€€€€¡•¥¡Ðè€ÄÕÁàìÝ¥‘Ñ è€ÄÕÁàì‰½É‘•ÈµÉ…‘¥ÕÌè€ÔÀ”ì(€€€€€€€€€‰…­É½Õ¹è€™™˜ì‰½É‘•Èè¹½¹”ìÕÉÍ½ÈèÁ½¥¹Ñ•Èì(€€€€€€€ô(€€€€€€€€¼¨ƒ¢žãš:Ÿ¢Žwžö»’â(€é¡½Ù•Èƒšr–r£¦î{–º3’æ/–ú3šºcžVg¾ò3–Â;¢ÓŽ3¦î{’â’â/’ö#–Æ¾ò3š‚ó–¶C–ÂÇ’ê»¢Öß’úŽ7Ž(€€€€€€€€€€ƒš&’î—š‚ó–¶Cžj¡½Ù•ÈƒšV#šzs–>«–r£žržjšr'šîG¦òƒžj¢Žwžö»’â+–VžR£Ž€¨¼(€€€€€€€€¹•±°µ¡½Ù•ÈìÑÉ…¹Í¥Ñ¥½¸è‰½É‘•Èµ½±½È€¸ÍÌ°‰…­É½Õ¹µ½±½È€¸ÍÌìô(€€€€€€€µ•‘¥„€¡¡½Ù•Èè¡½Ù•È¤…¹€¡Á½¥¹Ñ•Èè™¥¹”¤ì(€€€€€€€€€€¹•±°µ¡½Ù•Èé¡½Ù•Èì‰½É‘•Èµ½±½ÈèÉ‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸Ì¤ì‰…­É½Õ¹µ½±½Èè€ŒÄÄÄÄÄÄìô(€€€€€€€€€€¹É½ÕÀé¡½Ù•È€¹•±°µ¡½Ù•Èµ¥½¸ì½Á…¥Ñäè€¸ØìÑÉ…¹Í™½É´èÍ…±” Ä¸Ä¤ìô(€€€€€€€€€€¹É½ÕÀé¡½Ù•È€¹•±°µ¡½Ù•ÈµÑ•áÐì½±½ÈèÉ‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸Ô¤ìô(€€€€€€€ô(€€€€€€€€¼¨ƒš6Ë–"Ã¦‚¾ò?–êW–ÂÇ–s’ö?¾ò3’â7¢š–7–ö#–n{’ú¾ò!¥=Lƒš¦‡žj»ž¶/¾ò$€¨¼(€€€€€€€€¹¹¼µÍÉ½±±‰…Èì€µµÌµ½Ù•É™±½ÜµÍÑå±”è¹½¹”ìÍÉ½±±‰…ÈµÝ¥‘Ñ è¹½¹”ì½Ù•ÉÍÉ½±°µ‰•¡…Ù¥½Èè¹½¹”ìô(€€€€€€€€¹…±±½Üµ…±±½ÕÐì(€€€€€€€€€€€€µÝ•‰­¥ÐµÑ½Õ µ…±±½ÕÐè‘•™…Õ±Ð€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€€µÝ•‰­¥ÐµÕÍ•ÈµÍ•±•Ðè…ÕÑ¼€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€€µµ½èµÕÍ•ÈµÍ•±•Ðè…ÕÑ¼€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€€µµÌµÕÍ•ÈµÍ•±•Ðè…ÕÑ¼€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€ÕÍ•ÈµÍ•±•Ðè…ÕÑ¼€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€Á½¥¹Ñ•Èµ•Ù•¹ÑÌè…ÕÑ¼€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€Ñ½Õ µ…Ñ¥½¸è…ÕÑ¼€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€ÕÉÍ½ÈèÁ½¥¹Ñ•È€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€èµ¥¹‘•àè€ÄÔÀ€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€€€€€‘¥ÍÁ±…äè‰±½¬€…¥µÁ½ÉÑ…¹Ðì(€€€€€€€ô(€€€€€ôð½ÍÑå±”ø(€€€€€ì¼¨ƒšž/–r[¾òk¢ÞŽ3žÞ£¢ò¿Ž7–B3’â–/’î/¦v‹¾ò3––_žR£–ú0‰…­”ƒ–n{¦g–/–r[–Æ€¨½ô(€€€€€í½µÁ½Í•MÑ…Ñ”€˜˜€ (€€€€€€€€ñ½µÁ½Í•MÑÕ‘¥¼(€€€€€€€€€¥µ…”õí½µÁ½Í•MÑ…Ñ”¹¥µô(€€€€€€€€€€¼¨ƒ–öÇž&’â7žÖ›šŠ¿–ö‹¾ò#¢š,½µÁ½Í•MÑÕ‘¥¼ƒžj¡¥‘•-•åÍÑ½¹—¾ò'¾ò3–Û¦’c–º3–£’âš¢Œ€¨¼(€€€€€€€€€¡¥‘•-•åÍÑ½¹”õì„…½µÁ½Í•MÑ…Ñ”¹Ù¥‘ô(€€€€€€€€€•¼õí½µÁ½Í•MÑ…Ñ”¹•½ô(€€€€€€€€€½¹¡…¹”õíœ€ôøÍ•Ñ½µÁ½Í•MÑ…Ñ”¡ÍÐ€ôø€¡ÍÐ€üì€¸¸¹ÍÐ°•¼èœô€èÍÐ¤¥ô(€€€€€€€€€½¹…¹•°õì ¤€ôøÍ•Ñ½µÁ½Í•MÑ…Ñ”¡¹Õ±°¥ô(€€€€€€€€€½¹ÁÁ±äõí…ÁÁ±å½µÁ½Í•Q½1…å•Éô(€€€€€€€€¼ø(€€€€€€¥ô((€€€€€í•áÁ½ÉÑMÑ…Ñ”€ôôô€ÍÕ•ÍÌœ€˜˜™¥¹…±%µ…•Ì¹±•¹Ñ €ø€À€˜˜€ (€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”¥¹Í•Ð´ÀèµlÄÄÁt‰œµ‰±…¬™±•à™±•àµ½°…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÔÀÀˆø(€€€€€€€€€€ñ¡•…‘•È±…ÍÍ9…µ”ô‰ ´ÄÐ™±•à¥Ñ•µÌµ•¹Ñ•ÈÁà´ÔÍ¡É¥¹¬´Àè´ÈÀ‰œµ‰±…¬¼ÐÀ‰…­‘É½Àµ‰±ÕÈµá°ˆø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸€(€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì¡…¹‘±•1•…Ù” ¤ìõô(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰À´È€µµ°´ÈÑ•áÐµlŒààát¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”ÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌ…Ñ¥Ù”éÍ…±”´äÀˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€€ñ¡•ÙÉ½¹1•™ÐÍ¥é”õìÈÉô€¼ø(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ð½¡•…‘•Èø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à´Ä™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÀ´ØÉ•±…Ñ¥Ù”µ¥¸µ ´Àˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Üµ™Õ±°™±•à´Äµ¥¸µ ´À™±•à¥Ñ•µÌµ•¹Ñ•Èˆø(€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€É•˜õíÉ•ÍÕ±ÑMÑÉ¥ÁI•™ô(€€€€€€€€€€€€€€€€¼¼½Ù•É™±½Üµ…¹¡½Èè¹½¹”ƒš&7’â7šr¢Š¯ž?¢š÷–f£žjš6Ë–.W¦2£–ºkš.'–"Ã–"—¦‚(€€€€€€€€€€€€€€€ÍÑå±”õíì½Ù•É™±½Ý¹¡½Èè€¹½¹”œõô(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Üµ™Õ±°™±•à™±•àµÉ½Ü…À´È½Ù•É™±½Üµàµ…ÕÑ¼¹¼µÍÉ½±±‰…ÈÍ¹…ÀµàÍ¹…Àµµ…¹‘…Ñ½ÉäÁàµmµ…à ÁÁà±…±Œ ÔÀ”´ÐÁÙÜ¤¥tµé™±•àµÝÉ…Àµé©ÕÍÑ¥™äµ•¹Ñ•Èµé½Ù•É™±½ÜµÙ¥Í¥‰±”µéÁà´Àˆ(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€í™¥¹…±%µ…•Ì¹µ…À ¡ÍÉŒ°¤¤€ôø€ (€€€€€€€€€€€€€€€€€€ñ‘¥Ø­•äõíÍÉô±…ÍÍ9…µ”ô‰Í¡É¥¹¬´ÀÍ¹…Àµ•¹Ñ•È™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•Èˆø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É•±…Ñ¥Ù”Í¡…‘½Ü´Éá°É½Õ¹‘•½Ù•É™±½Üµ¡¥‘‘•¸ˆø(€€€€€€€€€€€€€€€€€€€€€í™¥¹…±-¥¹‘Ím¥t€ôôô€Ù¥‘•¼œ€ü€ (€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦g’â¦‚šr'–öÇž&¾ò3š&’î—¢òã–ëžjšb¿–öÇž&(€€€€€€€€€€€€€€€€€€€€€€€€ñÙ¥‘•¼(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÉŒõíÍÉô(€€€€€€€€€€€€€€€€€€€€€€€€€…ÕÑ½A±…ä(€€€€€€€€€€€€€€€€€€€€€€€€€±½½À(€€€€€€€€€€€€€€€€€€€€€€€€€µÕÑ•(€€€€€€€€€€€€€€€€€€€€€€€€€Á±…åÍ%¹±¥¹”(€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–2¿–ëžÖCšzs–>«šb¿Ž3žr/š"C–NŽ7¾ò3’â7¢¦Ëšr'šJ·šRû–f£¦
’â––_š:Ÿ–"Û¦‚(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¾ò#šj¯–sŽ–þ¯¢ö'Ž¦~Ï¦?Ž¥ÉA±…çŠ›¾ò'Žš.ÿš:$½¹ÑÉ½±Ï¾òw–Z»žÒS¢«–.W¢ò«šJ·¾òl(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–7šN/š:'–¶Cš¾7žV¯¦v‹¢"¦Vßš2'¢ÞÏ–ëžj–:žR¦ã–Z»Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÑÉ½±Í1¥ÍÐô‰¹½‘½Ý¹±½…¹½Á±…å‰…­É…Ñ”¹½É•µ½Ñ•Á±…å‰…¬ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€‘¥Í…‰±•A¥ÑÕÉ•%¹A¥ÑÕÉ”(€€€€€€€€€€€€€€€€€€€€€€€€€½¹½¹Ñ•áÑ5•¹Ôõí”€ôø”¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰µ…àµÜµlàÁÙÝtµ…àµ µlÔÉÙ¡tµéµ…àµÜµlÌáÙ¡t½‰©•Ðµ½¹Ñ…¥¸É•±…Ñ¥Ù”è´ÄÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€€€€€€€€€ñ¥µœ(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÉŒõíÍÉô(€€€€€€€€€€€€€€€€€€€€€€€€€…±Ðõí¥¹…°I•ÍÕ±Ð€‘í¤€¬€Åõô(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰µ…àµÜµlàÁÙÝtµ…àµ µlÔÉÙ¡tµéµ…àµÜµlÌáÙ¡t½‰©•Ðµ½¹Ñ…¥¸…±±½Üµ…±±½ÕÐÉ•±…Ñ¥Ù”è´ÄÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”¥¹Í•Ð´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”É¥¹œ´ÄÉ¥¹œµÝ¡¥Ñ”¼ÄÀÉ½Õ¹‘•ˆøð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€ì¼¨ƒ¦‚šVã–në–ºkšRû¦g¢Ž‡¾ò3–>«šr'’â–,ƒŠSŠPƒš†3š¦šb¿š>o¢†3š:K¦Z/žj¾ò3–£¦£žr/–ú_–"Ã–ÂÇ’â7žR£š¢d€¨½ô(€€€€€€€€€€€í™¥¹…±%µ…•Ì¹±•¹Ñ €ø€Ä€˜˜€ (€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ ´ÐµÐ´ÌÍ¡É¥¹¬´Àµé¡¥‘‘•¸ˆø(€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÁÁátÑ•áÐµÝ¡¥Ñ”¼ÐÀ™½¹Ðµ‰½±ÑÉ…­¥¹œµlÀ¸É•µtÑ…‰Õ±…Èµ¹ÕµÌˆø(€€€€€€€€€€€€€€€€€íÉ•ÍÕ±Ñ%‘à€¬€Åô€¼í™¥¹…±%µ…•Ì¹±•¹Ñ¡ô(€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¥ô(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‰œµ‰±…¬™±•à™±•àµ½°…À´ÌÁà´ØÁˆ´ØÁÐ´Èˆø(€€€€€€€€€€€€ñM…Ù•	ÕÑÑ½¸ÕÉ±Ìõí™¥¹…±%µ…•Íô€¼ø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´Ðˆø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ìÍ•ÑáÁ½ÉÑMÑ…Ñ” ¥‘±”œ¤ì±•…É¥¹…±%µ…•Ì ¤ìõô(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à´Ä ´ÄÐÉ½Õ¹‘•µ™Õ±°‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÈÀ‰œµÝ¡¥Ñ”¼ÔÑ•áÐµÝ¡¥Ñ”™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÍÐÕÁÁ•É…Í”¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀ…Ñ¥Ù”éÍ…±”´äÔÑÉ…¹Í¥Ñ¥½¸µ…±°Ñ•áÐµÍ´ˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€ƒžæóžê3žÞ£¢ò¼(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸€(€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì½¹%µÁ½ÉÑ9•Üü¸ ¤ìõô(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à´Ä ´ÄÐÉ½Õ¹‘•µ™Õ±°‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÈÀ‰œµÝ¡¥Ñ”¼ÔÑ•áÐµÝ¡¥Ñ”™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÍÐÕÁÁ•É…Í”¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀ…Ñ¥Ù”éÍ…±”´äÔÑÉ…¹Í¥Ñ¥½¸µ…±°Ñ•áÐµÍ´ˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€ì¼¨ƒŽ3žÖŽ7¢3’â7šb¿Ž3–ò×Ž7¾òkžÚO–ãš.ó–r[’âš²‡–kžjšb¿’âšVÓžZ+¦‚¦v‹¾ò3’â7šb¿’â–òÔ€¨½ô(€€€€€€€€€€€€€ƒš.ó’â/’âžÖ(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€ð½‘¥Øø(€€€€€€¥ô((€€€€€ì¼¨ƒ–2¿–ë’â·žjžV¯¦v‹ŽšVÓš&ç–ÇžR£¦g’â–/¾ò#’â7šb¿š¾?¦‚–B¢ÞÏ’âš²‡¾ò'¾òh(€€€€€€€€€ƒ¢ö'–r#žR£–öÇž&¦
’âš²û¾òošr'–öÇž&š&7¦†¿ž’ëžfû–"š¾S¾ò3žÒS–r[ž&–ÂÇ–>«šr'¢ö'–r#Ž€¨½ô(€€€€€í•áÁ½ÉÑMÑ…Ñ”€ôôô€ÁÉ½•ÍÍ¥¹œœ€˜˜€ (€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™¥á•¥¹Í•Ð´ÀèµlÄÈÁt‰œµ‰±…¬¼äÀ‰…­‘É½Àµ‰±ÕÈµµ™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´Ð…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÌÀÀˆø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ü´ÄÈ ´ÄÈ‰½É‘•È´Ð‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀ‰½É‘•ÈµÐµÝ¡¥Ñ”É½Õ¹‘•µ™Õ±°…¹¥µ…Ñ”µÍÁ¥¸ˆ€¼ø(€€€€€€€€€íÙ¥‘•½AÉ½œ€„ôô¹Õ±°€˜˜€ (€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁátÑÉ…­¥¹œµlÀ¸Í•µtÑ•áÐµÝ¡¥Ñ”¼ØÀÑ…‰Õ±…Èµ¹ÕµÌˆùí5…Ñ ¹É½Õ¹¡Ù¥‘•½AÉ½œ€¨€ÄÀÀ¥ô”ð½ÍÁ…¸ø(€€€€€€€€€€¥ô(€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁátÑ•áÐµÝ¡¥Ñ”¼ÔÀÑÉ…­¥¹œµÝ¥‘•ÍÐˆùíÙ¥‘•½1…‰•±ôð½ÍÁ…¸ø(€€€€€€€€€ì¼¨ƒ–>[šÚ#¦6×Ž’î—–&7šb¿Ž3–6‡’ö?–·žžKš&7¦Vß–ë’úŽ7žj¦
¦†¾ò#¢š,MÑÕ­Í…Á—¾ò'ŠSŠP(€€€€€€€€€€€€€ƒ–º’â–K–ë’ú¾ò3’â+¦v‹žj¢ö'–r#–ÂÇ¢Š¯–ú’â+¦‚’âš"«¾ò3žr/¢Öß’ú–?žV¯¦v‹¢«–ÞÇš*[’ê’â’â/¾òl(€€€€€€€€€€€€€ƒ¢3’âS–¾¯žjšb¿Ž3–>[šÚ#¾ò3–n{–"ÃžÞ£¢ò¿Ž7Žž>û–r£šRçš"C’â¦Z/–ž/–ÂÇ–r£Ž–ÂÇ–¾¯Ž3–>[šÚ#–2¿–ëŽ7Ž((€€€€€€€€€€€€€ƒŠj€ƒ–ºšb¼¨«žÖW–Â7–ºk’ö4¨«š:o–r£š¶’â·–’»’â/šZçžj¾ò3’â7š:K¦Ë’â+¦v‹¦
–/žnÓš:K¢Ž‡Ž(€€€€€€€€€€€€€ƒ’â+’âž&#š"Gš*+–ºžVÛš"CžnÓš:Kžjž²³–no–/–¶§–¶C¾ò!µÐ´ã¾ò'¾ò3–’[–Æ“–>#šb¼(€€€€€€€€€€€€€©ÕÍÑ¥™äµ•¹Ñ•ÈƒŠSŠPƒ–’k¦g’â¦†ž¶'šZóš*+Ž3¢ö'–r#¾ò/šZ–¶_Ž7¦
’âžÖšVÓ–/–ú’â+¦‚’ê(€€€€€€€€€€€€€€ÐÐƒ–?žÒƒŽ–2¿–ë–.WžV¯žj’ö7žö»’â¢º+¾ò3žÞ+š:—¢F_¢ÞÏ–ë’úžjš"C–N¦‚¾ò#–ºžj–r[šb¿žœ(€€€€€€€€€€€€€ƒ¢«–ÞÇ¦
’â–Æ“žö»’â·žjŽ’ö7žö»šÊK–.W¦;¾ò'žr/¢Öß’ú–ÂÇ¢º+š"CŽ3š¾S–&o–&o¦
’â¦‚’ö;Ž7¾ò0(€€€€€€€€€€€€€ƒ’æ–ÂÇšb¿’âï’êë¢ª«žjŽ3–Â;–ëš"CšzsžjžV¯¦v‹–ú’â/’êŽ7Ž(€€€€€€€€€€€€€ƒšRçš"CžÖW–Â7–ºk’ö7’æ/–ú3¾ò3¢ö'–r#¢"šZ–¶_–n{–"ÃŽ3–º3–£šÊKšr'¦g¦†¦6×Ž7šfžj’ö7žö»¾ò0(€€€€€€€€€€€€€ƒ¢3¦g¦†¦6×–r£’â7–r£Ž’î¦êóšf–g–ëž>û¾ò3¦÷’â7šr¢ºO’îï’öWšvÇ¢–ÿ’ö7žžïŽ€¨½ô(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€¼¼ƒ¢fžŠó–ú–&7š:£’âš‚ó¾òw¦
’â¢ò«–2¿–ë’ös–î‹¾ò3¢ÞG–º3’æ’â7šr¢ÞÏ–"Ãš"C–N¦‚(€€€€€€€€€€€€€•áÁ½ÉÑIÕ¹I•˜¹ÕÉÉ•¹Ð¬¬ì(€€€€€€€€€€€€€Ù¥‘•½‰½ÉÑI•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€€€€€€€€€Í•ÑY¥‘•½AÉ½œ¡¹Õ±°¤ì(€€€€€€€€€€€€€Í•ÑáÁ½ÉÑMÑ…Ñ” ¥‘±”œ¤ì(€€€€€€€€€€€õô(€€€€€€€€€€€ÍÑå±”õíìÁ½Í¥Ñ¥½¸è€…‰Í½±ÕÑ”œ°±•™Ðè€œÔÀ”œ°Ñ½Àè€…±Œ ÔÀ”€¬€àÙÁà¤œ°ÑÉ…¹Í™½É´è€ÑÉ…¹Í±…Ñ•` ´ÔÀ”¤œõô(€€€€€€€€€€€±…ÍÍ9…µ”ô‰Áà´Ø ´ÄÀÉ½Õ¹‘•µ™Õ±°‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÈÔÑ•áÐµÝ¡¥Ñ”¼àÀÑ•áÐµlÄÉÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµlÀ¸É•µt…Ñ¥Ù”éÍ…±”´äÔÑÉ…¹Í¥Ñ¥½¸µÑÉ…¹Í™½É´ˆ(€€€€€€€€€€ø(€€€€€€€€€€€ƒ–>[šÚ#–2¿–è(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€ð½‘¥Øø(€€€€€€¥ô((€€€€€ì¼¨Q½À!•…‘•È€¨½ô(€€€€€€ñ¡•…‘•È±…ÍÍ9…µ”ô‰ ´ÄÐ‰½É‘•Èµˆ‰½É‘•ÈµlŒÅ„Å„Å…t™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ‰•ÑÝ••¸Áà´Ðè´ÔÀ‰œµ‰±…¬¼äÀ‰…­‘É½Àµ‰±ÕÈµµˆø(€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€¥˜€¡½µÁ½Í•MÑ…Ñ”¤Í•Ñ½µÁ½Í•MÑ…Ñ”¡¹Õ±°¤ì(€€€€€€€€€€€•±Í”¡…¹‘±•1•…Ù” ¤ì(€€€€€€€€€õô(€€€€€€€€€…É¥„µ±…‰•°õí½µÁ½Í•MÑ…Ñ”€ü€Ÿ¦–ëšž/–r[’â›šRûšŽ¢º+šnÐœ€è€Ÿ¢þS–n{’âï¦‚ô(€€€€€€€€€±…ÍÍ9…µ”ô‰À´È€µµ°´ÈÑ•áÐµl………t¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”ÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌ…Ñ¥Ù”éÍ…±”´äÀˆ(€€€€€€€€ø(€€€€€€€€€€€€ñ¡•ÙÉ½¹1•™ÐÍ¥é”õìÈÉô€¼ø(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€(€€€€€€€€€ì…½µÁ½Í•MÑ…Ñ”€˜˜€ (€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È…À´Èˆø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸€(€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ìÕ¹‘¼ ¤ìõô€(€€€€€€€€€€€€€‘¥Í…‰±•õí¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€ðô€Áô€(€€€€€€€€€€€€€±…ÍÍ9…µ”õíÀ´ÈÑ•áÐµÝ¡¥Ñ”ÑÉ…¹Í¥Ñ¥½¸µ…±°€‘í¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€ðô€À€ü€½Á…¥Ñä´ÈÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”œ€è€½Á…¥Ñä´ÄÀÀ…Ñ¥Ù”éÍ…±”´äÀõô(€€€€€€€€€€€€€Ñ¥Ñ±”ô‹–ú§–:|ˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€€ñ%½¸¹…µ”ô‰Õ¹‘¼ˆ±…ÍÍ9…µ”ô‰Ñ•áÐµá°ˆ€¼ø(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸€(€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ìÉ•‘¼ ¤ìõô€(€€€€€€€€€€€€€‘¥Í…‰±•õí¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€øô¡¥ÍÑ½ÉåMÑ…Ñ”¹¡¥ÍÑ½Éä¹±•¹Ñ €´€Äñð¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€ôôô€´Åô€(€€€€€€€€€€€€€±…ÍÍ9…µ”õíÀ´ÈÑ•áÐµÝ¡¥Ñ”ÑÉ…¹Í¥Ñ¥½¸µ…±°€‘í¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€øô¡¥ÍÑ½ÉåMÑ…Ñ”¹¡¥ÍÑ½Éä¹±•¹Ñ €´€Äñð¡¥ÍÑ½ÉåMÑ…Ñ”¹¥¹‘•à€ôôô€´Ä€ü€½Á…¥Ñä´ÈÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”œ€è€½Á…¥Ñä´ÄÀÀ…Ñ¥Ù”éÍ…±”´äÀõô(€€€€€€€€€€€€€Ñ¥Ñ±”ô‹¦7–hˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€€ñ%½¸¹…µ”ô‰É•‘¼ˆ±…ÍÍ9…µ”ô‰Ñ•áÐµá°ˆ€¼ø(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€(€€€€€€€€€€€ì¼¨ƒ–"–&ËžÞh€¨½ô(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÜµÁà ´Ð‰œµÝ¡¥Ñ”¼ÄÀµà´ÄÍ¡É¥¹¬´Àˆ€¼ø((€€€€€€€€€€€ì¼¨ƒ’â'–/¦î{¾òk¦î{¦Z/š&7šr'Ž3¦‚C¢š÷Ž7¢"Ž3–Â7¦ö+Ž4€¨½ô(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É•±…Ñ¥Ù”ˆÉ•˜õíµ½É•]É…ÁI•™ôø(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ5½É•=Á•¸¡¼€ôø€…¼¥ô(€€€€€€€€€€€€€€€€¼¼ƒš&O¦Z/šf–>«šr'–r[š¢g¢º+’ê»¾ò3’â7žV¯–rO–ö‹–êT(€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÜ´ä ´ä™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌ…Ñ¥Ù”éÍ…±”´äÀ€‘ì(€€€€€€€€€€€€€€€€€µ½É•=Á•¸€ü€Ñ•áÐµÝ¡¥Ñ”œ€è€Ñ•áÐµÝ¡¥Ñ”¼ÜÀœ(€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹šnÓ–’hˆ(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€ñ%½¸¹…µ”ô‰µ½É•}¡½É¥èˆ±…ÍÍ9…µ”ô‰Ñ•áÐµá°ˆ€¼ø(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€íµ½É•=Á•¸€˜˜€ (€€€€€€€€€€€€€€€€ðø(€€€€€€€€€€€€€€€€€ì¼¨ƒ¦î{š^¦
+–ÂÇšRÛ¢Öß’ú€¨½ô(€€€€€€€€€€€€€€€€€ì¼¨ƒ¦g¢Ž‡žj–Æ“šVã–>«¢Þ|¡•…‘•Èƒ¢Ž‡¦v‹žjšvÇ¢–ÿš¾S¾òkšVÓ–/–Þ—’ös–6¢Š¯¦^s–r è´Àƒžj(€€€€€€€€€€€€€€€€€€€€€ƒ–‚žZ+žJÃ–Š¢Ž‡¾ò#¢š/’â/¦v‹–Þ—’ös–6¦
–Æ“žj¢¢ï¢ž¾ò'¾ò3š&’î—¦ã–Z»’â–ºk–r£žV¯–âžj(€€€€€€€€€€€€€€€€€€€€€ƒžŸž&Ž’ö#–Æ’â+¦vˆ€¨½ô(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™¥á•¥¹Í•Ð´ÀèµlØÁtˆ½¹±¥¬õì ¤€ôøÍ•Ñ5½É•=Á•¸¡™…±Í”¥ô€¼ø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”É¥¡Ð´ÀÑ½À´ÄÄèµlØÅtÜ´ÌØÉ½Õ¹‘•´Éá°‰œµlŒÅˆÅˆÅ‰t‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀÍ¡…‘½Ü´Éá°½Ù•É™±½Üµ¡¥‘‘•¸…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸é½½´µ¥¸´äÔ‘ÕÉ…Ñ¥½¸´ÄÔÀˆø(€€€€€€€€€€€€€€€€€€€ì¼¨ƒžnÓ–ò<€ÈèÏŽäèÄØ%ƒ–B’â7’â/¾ò3¦g’â¦†–ÂÇšVÓ–/’â7–ëž>ø€¨½ô(€€€€€€€€€€€€€€€€€€€í¥AÉ•Ù¥•ÝMÕÁÁ½ÉÑ•€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€ðø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøìÍ•Ñ5½É•=Á•¸¡™…±Í”¤ìÍ•Ñ%AÉ•Ù¥•Ü¡ÑÉÕ”¤ìõô(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Üµ™Õ±° ´ÄÄÁà´Ð™±•à¥Ñ•µÌµ•¹Ñ•ÈÑ•áÐµlÄÉÁát™½¹Ðµ‰½±Ñ•áÐµÝ¡¥Ñ”¼äÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌˆ(€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸û¦‚C¢šôð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ µÁà‰œµÝ¡¥Ñ”¼ÄÀˆ€¼ø(€€€€€€€€€€€€€€€€€€€€€€ð¼ø(€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¦g’â–"_–>«šb¿¢ª«šb;¾ò3’â7¢÷¦î{¾òo¢÷¦î{žj–>«šr'–>Ï¦
+¦
¦†¦Z/¦^sŽ(€€€€€€€€€€€€€€€€€€€€€€€ƒ¦Z/¦^s–"–º3¦ã–Z»’æ’â7šRÛ¢Öß’ú¾ò#–âã–âã¢š¦¢F_¦Z/¦Z/¦^s¦^sš¾S–Â7šV#šzs¾ò'Ž€¨½ô(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Üµ™Õ±° ´ÄÄÁà´Ð™±•à¥Ñ•µÌµ•¹Ñ•ÈÑ•áÐµlÄÉÁát™½¹Ðµ‰½±Ñ•áÐµÝ¡¥Ñ”¼äÀˆø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸û–Â7¦ö(ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¦†?¢&Ë¢ÞšN7’ösš²¦
’êoŽ3¦ã’â·Ž7žjš2'¦"W–B3’â––_¾òk¦Z/¾òwžf÷–êW¦îGžB¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦^s¾òw¢Þšr«¦ã’â·žjš2'¦"W’âš¢žjšÞ‡žf÷Žš2'’â/–:ï’â7–k’îï’öW¢º+¢&ËŽ€¨½ô(€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ¹…‰±•M¹…ÁÁ¥¹œ …•¹…‰±•M¹…ÁÁ¥¹œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡•¹…‰±•M¹…ÁÁ¥¹œ¤Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤ì(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€É½±”ô‰ÍÝ¥Ñ ˆ(€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ¡•­•õí•¹…‰±•M¹…ÁÁ¥¹ô(€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”õí•¹…‰±•M¹…ÁÁ¥¹œ€ü€Ÿ¦^s¦Z'–Â7¦ö(œ€è€Ÿ¦Z/–V–Â7¦ö(ô(€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíµ°µ…ÕÑ¼É•±…Ñ¥Ù”Í¡É¥¹¬´ÀÜµlÌáÁát µlÈÉÁátÉ½Õ¹‘•µ™Õ±°ÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌ‘ÕÉ…Ñ¥½¸´ÈÀÀ€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€•¹…‰±•M¹…ÁÁ¥¹œ€ü€‰œµÝ¡¥Ñ”œ€è€‰œµÝ¡¥Ñ”½lÀ¸ÄÑtœ(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí…‰Í½±ÕÑ”Ñ½ÀµlÍÁát±•™ÐµlÍÁátÜ´Ð ´ÐÉ½Õ¹‘•µ™Õ±°ÑÉ…¹Í¥Ñ¥½¸µÑÉ…¹Í™½É´‘ÕÉ…Ñ¥½¸´ÈÀÀ•…Í”µ½ÕÐ€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€•¹…‰±•M¹…ÁÁ¥¹œ€ü€ÑÉ…¹Í±…Ñ”µà´Ð‰œµ‰±…¬œ€è€ÑÉ…¹Í±…Ñ”µà´À‰œµÝ¡¥Ñ”¼ÐÔœ(€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€ð¼ø(€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€ì¡Á…•Ì¹Í½µ”¡À€ôøÀ¹±…å½ÕÑÌ¹Í½µ”¡°€ôø°¹¥µ…•Ì¹Í½µ”¡¥µœ€ôø¥µœ¹ÕÉ°€„ôô€œœ¤¤¤ñð™±½…Ñ¥¹%µ…•Ì¹±•¹Ñ €ø€À¤€˜˜€ (€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôø¡…¹‘±•áÁ½ÉÐ ¥ô(€€€€€€€€€€€€€€€‘¥Í…‰±•õí•áÁ½ÉÑMÑ…Ñ”€ôôô€ÁÉ½•ÍÍ¥¹œô(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰‰œµÝ¡¥Ñ”Ñ•áÐµ‰±…¬Áà´ØÁä´Ä¸ÔÉ½Õ¹‘•µ™Õ±°Ñ•áÐµlÄÅÁát™½¹Ðµ‰±…¬ÕÁÁ•É…Í”ÑÉ…­¥¹œµÝ¥‘•ÈÍ¡…‘½Üµ±œ…Ñ¥Ù”éÍ…±”´äÔÑÉ…¹Í¥Ñ¥½¸µÑÉ…¹Í™½É´Ý¡¥Ñ•ÍÁ…”µ¹½ÝÉ…Àˆ(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€ƒ–Ë–¶`(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€¥ô(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€¥ô(€€€€€€€€ð½¡•…‘•Èø((€€€€€ì¼¨!¥‘‘•¸¥±”%¹ÁÕÑÌ€¨½ô(€€€€€€ñ¥¹ÁÕÐ(€€€€€€€ÑåÁ”ô‰™¥±”ˆ(€€€€€€€É•˜õí™¥±•%¹ÁÕÑI•™ô(€€€€€€€µÕ±Ñ¥Á±”(€€€€€€€…•ÁÐõíI]}AQ}%5ô(€€€€€€€½¹¡…¹”õì¡”¤€ôø¡…¹‘±•¥±•¡…¹”¡”°ÑÉÕ”¥ô(€€€€€€€±…ÍÍ9…µ”ô‰¡¥‘‘•¸ˆ(€€€€€€¼ø(€€€€€€ñ¥¹ÁÕÐ(€€€€€€€ÑåÁ”ô‰™¥±”ˆ(€€€€€€€É•˜õíÙ¥‘%¹ÁÕÑI•™ô(€€€€€€€µÕ±Ñ¥Á±”(€€€€€€€…•ÁÐõíY%=}AQô(€€€€€€€½¹¡…¹”õì¡”¤€ôø¡…¹‘±•¥±•¡…¹”¡”°ÑÉÕ”¥ô(€€€€€€€±…ÍÍ9…µ”ô‰¡¥‘‘•¸ˆ(€€€€€€¼ø(€€€€€€ñ¥¹ÁÕÐ(€€€€€€€ÑåÁ”ô‰™¥±”ˆ(€€€€€€€É•˜õíÉ•Á±…•%¹ÁÕÑI•™ô(€€€€€€€…•ÁÐõíI]}AQ}%5ô(€€€€€€€µÕ±Ñ¥Á±”(€€€€€€€½¹¡…¹”õí¡…¹‘±•I•Á±…•¥±•¡…¹•ô(€€€€€€€±…ÍÍ9…µ”ô‰¡¥‘‘•¸ˆ(€€€€€€¼ø((€€€€€ì¼¨5…¥¸]½É­ÍÁ…”1…å½ÕÐ€¨½ô(€€€€€ì¼¨ƒšVÓ–/–Þ—’ös–6žjž¦ëžf÷¾ò#–B¯¦‚¦v‹’â+’â/žj¦îG–êW¾ò'¦÷¢÷žR£’ú–>[šÚ#¦ã–>[¾òh(€€€€€€€€€ƒ’ö#–ÆšRû–’Ÿšf–æû’æ;¢N/šîÿšVÓ¦‚¾ò3–>«¦vƒ¦‚¦v‹–ŸžjžÒÃ¦Vßž¦ëžf÷–ú#¦n¦î{–"À€¨½ô(€€€€€ì¼¨è´Àƒ¢ºOšVÓ–/–Þ—’ös–6¢«š"C’â–/–‚žZ+žJÃ–Š¾òk¢Ž‡¦v‹žjžŸž&šb¼€ØÃŽØËŽØÓŠ.¿Š.¿¾ò0(€€€€€€€€€ƒ–r[–Æ“’â–’k–ÂÇšrž"³¦8¡•…‘•Èƒžjè´ÔÃ¾ò3š*+’â'–/¦î{–>¯–ë’úžj¦ã–Z»–ŽO–r£–êW’â/Ž(€€€€€€€€€ƒ¦^s¦Ë’ú’æ/–ú3¾ò3žV¯–â’â+žjšvÇ¢–ÿ–7–’k’æ–>«–r£¦g’â–Æ“¢Ž‡¦v‹š:K–&7–ú3Ž€¨½ô(€€€€€€ñ‘¥Ø(€€€€€€€±…ÍÍ9…µ”ô‰™±•à´Ä™±•à™±•àµ½°µé™±•àµÉ½Ü½Ù•É™±½Üµ¡¥‘‘•¸É•±…Ñ¥Ù”è´Àˆ(€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôøì(€€€€€€€€€¥˜€¡…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ¤É•ÑÕÉ¸ì(€€€€€€€€€Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð€ôì(€€€€€€€€€€€àè”¹±¥•¹Ñ`°äè”¹±¥•¹Ñd°Ñ¥µ”è…Ñ”¹¹½Ü ¤°(€€€€€€€€€€€½¹	±…¹¬è¥Í	±…¹­Q…É•Ð¡”¹Ñ…É•Ð…Ì±•µ•¹Ðð¹Õ±°¤°(€€€€€€€€€€€€¼¨ƒšr'švÇ¢–ÿ¢Š¯¦ã’â·šf¾ò3š.[žV¯–â’îï’öW’â¢fW¦÷šb¿–r£šB³¦
–/ž&§’îÛ¾ò#¢š,•ÍÑÕÉ•M½Á—¾ò'Ž(€€€€€€€€€€€€€€ƒ¦
ž¢»š&/–.‹¦²š&/šf’â7¢÷žº_Ž3–r£ž¦ëžf÷¢fWšRû¦Z/¾òw–>[šÚ#¦ã–>[Ž7ŠSŠP(€€€€€€€€€€€€€€ƒ’öÿžR£¢–>«šb¿š*+švÇ¢–ÿš.[–"Ã–"—žj’ö7žö»¾ò3’â7šb¿šÏ–>[šÚ#¦ã–>[Ž€¨¼(€€€€€€€€€€€µ½Ù•Í=‰©•Ðè•ÍÑÕÉ•M½Á”¡”¹Ñ…É•Ð…Ì±•µ•¹Ðð¹Õ±°¤€„ôô€Á…¸œ°(€€€€€€€€€ôì(€€€€€€€õô(€€€€€€€½¹A½¥¹Ñ•ÉUÀõì¡”¤€ôøì(€€€€€€€€€¥˜€¡…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ¤É•ÑÕÉ¸ì(€€€€€€€€€¥˜€ …Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¤É•ÑÕÉ¸ì(€€€€€€€€€½¹ÍÐ‘à€ô”¹±¥•¹Ñ`€´Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¹àì(€€€€€€€€€½¹ÍÐ‘ä€ô”¹±¥•¹Ñd€´Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¹äì(€€€€€€€€€½¹ÍÐÍÑ…ÉÑ	±…¹¬€ôÝ½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¹½¹	±…¹¬ì(€€€€€€€€€½¹ÍÐµ½Ù•‘=‰©•Ð€ôÝ½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¹µ½Ù•Í=‰©•Ðì(€€€€€€€€€Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€€€½¹ÍÐÑ…É•Ð€ô”¹Ñ…É•Ð…Ì±•µ•¹Ðð¹Õ±°ì(€€€€€€€€€€¼¨ƒšRû¦Z/š&/šfš&7žÖCžº_Ž3¢š’â7¢š¦–ë¦ã’â·–ö‹ž.Ž7¾ò#¢š,É•Í½±Ù•M¡…Á•á¥Ó¾ò$€¨¼(€€€€€€€€€É•Í½±Ù•M¡…Á•á¥Ð¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ð€ÄÔ¤ì(€€€€€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€øô€ÄÔ¤ì(€€€€€€€€€€€€¼¼ƒ–ú{ž¦ëžf÷¢fWš2'’â/Ž’æ–r£ž¦ëžf÷¢fWšRû¦Z/¾òw–>[šÚ#¦ã–>[¾ò#š&/š2šîG’ê–’k–ÂG¦÷žº_¾ò'Ž(€€€€€€€€€€€€¼¼ƒ’ö–ššzs¦g’â’â/–Û–¾›šb¿–r£šB³š~C–/¢Š¯¦ã’â·žjž&§’îÛ¾ò3–ÂÇ’â7žº\ƒŠSŠPƒ¦²š&/¢šžÚ·š2¦ã–>[Ž(€€€€€€€€€€€¥˜€¡ÍÑ…ÉÑ	±…¹¬€˜˜€…µ½Ù•‘=‰©•Ð€˜˜¥Í	±…¹­Q…É•Ð¡Ñ…É•Ð¤¤ì(€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘1…å½ÕÑ%¡¹Õ±°¤ì(€€€€€€€€€€€€€Í•Ñ%¹±¥¹•‘¥Ñ%¡¹Õ±°¤ì(€€€€€€€€€€€ô(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ô(€€€€€€€€€¥˜€ …Ñ…É•Ð¤É•ÑÕÉ¸ì(€€€€€€€€€…ÁÁ±åQ…ÁM•±•Ñ¥½¸¡Ñ…É•Ð¤ì(€€€€€€€õô(€€€€€€ø(€€€€€€€ì¼¨1•™Ð½Q½À½±±…”AÉ•Ù¥•ÜÉ•„€¨½ô(€€€€€€€€ñ‘¥Ø€(€€€€€€€€€±…ÍÍ9…µ”õí™±•à´Ä™±•à¥Ñ•µÌµÍÑ…ÉÐ€‘í…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€ü€Ñ½Õ µÁ…¸µàœ€è€Ñ½Õ µ¹½¹”ô©ÕÍÑ¥™äµÍÑ…ÉÐÁä´È‰œµlŒÀÜÀÜÀÝtÉ•±…Ñ¥Ù”½Ù•É™±½Üµàµ…ÕÑ¼½Ù•É™±½Üµäµ¡¥‘‘•¸Í•±•Ðµ¹½¹”¹¼µÍÉ½±±‰…È½Ù•ÉÍÉ½±°µàµ½¹Ñ…¥¹ô(€€€€€€€€€€¼¨ƒš.[¢Ößžj¦†×¦v‹–þ¦†ï’ö7’ê;–Æ?–æW–vCš‚–"–&Ëžêÿ’æ/’â+¾òo–æÏš^Û’â7–îëž®/¦Šw–’[–ÆžêŸŽ€¨¼(€€€€€€€€€ÍÑå±”õíìé%¹‘•àèÁ…•É…%‘à€„ôô¹Õ±°€ü€ÔÀ€èÕ¹‘•™¥¹•õô(€€€€€€€€€É•˜õí½¹Ñ…¥¹•ÉI•™ô(€€€€€€€€€‘…Ñ„µÉ¥µÁÉ•Ù¥•ÜµÙ¥•ÝÁ½ÉÐôˆÄˆ(€€€€€€€€€½¹MÉ½±°õì¡”¤€ôøì(€€€€€€€€€€€¥˜€ …½¹Ñ…¥¹•ÉI•˜¹ÕÉÉ•¹ÐñðÁ…•Ì¹±•¹Ñ €ðô€Ä¤É•ÑÕÉ¸ì(€€€€€€€€€€€½¹ÍÐÍÉ½±±1•™Ð€ô”¹ÕÉÉ•¹ÑQ…É•Ð¹ÍÉ½±±1•™Ðì(€€€€€€€€€€€½¹ÍÐ¥¹¥Ñ¥…±1•™Ñ=™™Í•Ð€ôÍÑÉ¥Á=™™Í•Ð¡½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ °Á…•ÍM…±”¤ì(€€€€€€€€€€€½¹ÍÐ•¹Ñ•È€ôÍÉ½±±1•™Ð€¬½¹Ñ…¥¹•ÉM¥é”¹Ý¥‘Ñ €¼€Èì(€€€€€€€€€€€±•Ð±½Í•ÍÑ%‘à€ô€Àì(€€€€€€€€€€€±•Ðµ¥¹¥ÍÑ…¹”€ô%¹™¥¹¥Ñäì(€€€€€€€€€€€™½È€¡±•Ð¤€ô€Àì¤€ðÁ…•Ì¹±•¹Ñ ì¤¬¬¤ì(€€€€€€€€€€€€€½¹ÍÐÁ…••¹Ñ•È€ô¥¹¥Ñ¥…±1•™Ñ=™™Í•Ð€¬Á…•ÍM…±”€¨€¡¤€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¤€¬ÁÉ•Ù¥•Ý\€¼€È¤ì(€€€€€€€€€€€€€½¹ÍÐ‘¥ÍÑ…¹”€ô5…Ñ ¹…‰Ì¡•¹Ñ•È€´Á…••¹Ñ•È¤ì(€€€€€€€€€€€€€¥˜€¡‘¥ÍÑ…¹”€ðµ¥¹¥ÍÑ…¹”¤ì(€€€€€€€€€€€€€€€µ¥¹¥ÍÑ…¹”€ô‘¥ÍÑ…¹”ì(€€€€€€€€€€€€€€€±½Í•ÍÑ%‘à€ô¤ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€ô(€€€€€€€€€€€¥˜€¡±½Í•ÍÑ%‘à€„ôô…Ñ¥Ù•A…•%¹‘•à¤ì(€€€€€€€€€€€€€Í•ÑÑ¥Ù•A…•%¹‘•à¡±½Í•ÍÑ%‘à¤ì(€€€€€€€€€€€ô(€€€€€€€€€õô(€€€€€€€€€½¹Q½Õ¡MÑ…ÉÐõí…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€üÕ¹‘•™¥¹•€è¡…¹‘±•]½É­ÍÁ…•Q½Õ¡MÑ…ÉÑô(€€€€€€€€€½¹Q½Õ¡5½Ù”õí…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€üÕ¹‘•™¥¹•€è¡…¹‘±•]½É­ÍÁ…•Q½Õ¡5½Ù•ô(€€€€€€€€€½¹Q½Õ¡¹õí…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€üÕ¹‘•™¥¹•€è¡…¹‘±•]½É­ÍÁ…•Q½Õ¡¹‘ô(€€€€€€€€€½¹Q½Õ¡…¹•°õí…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€üÕ¹‘•™¥¹•€è¡…¹‘±•]½É­ÍÁ…•Q½Õ¡¹‘ô(€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôøì(€€€€€€€€€€€¥˜€¡…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ¤É•ÑÕÉ¸ì(€€€€€€€€€€€Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð€ôì(€€€€€€€€€€€€€àè”¹±¥•¹Ñ`°äè”¹±¥•¹Ñd°Ñ¥µ”è…Ñ”¹¹½Ü ¤°(€€€€€€€€€€€€€½¹	±…¹¬è¥Í	±…¹­Q…É•Ð¡”¹Ñ…É•Ð…Ì±•µ•¹Ðð¹Õ±°¤°(€€€€€€€€€€€€€€¼¨ƒšr'švÇ¢–ÿ¢Š¯¦ã’â·žjšf–g¾ò3š.[žV¯–â’îï’öW’â¢fW¦÷šb¿–r£šB³¦
–/ž&§’îÛ¾ò#¢š,•ÍÑÕÉ•M½Á—¾ò'Ž(€€€€€€€€€€€€€€€€ƒ¦
ž¢»š&/–.‹¦²š&/šf–ÂÇ’â7¢÷žº_Ž3–r£ž¦ëžf÷¢fWšRû¦Z/¾òw–>[šÚ#¦ã–>[Ž7ŠSŠP(€€€€€€€€€€€€€€€€ƒ’öÿžR£¢–>«šb¿š*+švÇ¢–ÿš.[–"Ã–"—žj’ö7žö»¾ò3’â7šb¿šÏ–>[šÚ#¦ã–>[Ž€¨¼(€€€€€€€€€€€€€µ½Ù•Í=‰©•Ðè•ÍÑÕÉ•M½Á”¡”¹Ñ…É•Ð…Ì±•µ•¹Ðð¹Õ±°¤€„ôô€Á…¸œ°(€€€€€€€€€€€ôì(€€€€€€€€€õô(€€€€€€€€€½¹A½¥¹Ñ•ÉUÀõì¡”¤€ôøì(€€€€€€€€€€€¥˜€¡…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ¤É•ÑÕÉ¸ì(€€€€€€€€€€€¥˜€¡Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€½¹ÍÐ‘à€ô”¹±¥•¹Ñ`€´Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¹àì(€€€€€€€€€€€€€½¹ÍÐ‘ä€ô”¹±¥•¹Ñd€´Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¹äì(€€€€€€€€€€€€€½¹ÍÐÑ…É•Ð€ô”¹Ñ…É•Ð…Ì±•µ•¹Ðð¹Õ±°ì(€€€€€€€€€€€€€½¹ÍÐ•¹‘=¹	±…¹¬€ô¥Í	±…¹­Q…É•Ð¡Ñ…É•Ð¤ì(€€€€€€€€€€€€€É•Í½±Ù•M¡…Á•á¥Ð¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ð€ÄÔ¤ì(€€€€€€€€€€€€€€¼¼ƒ–>«¢šš&/š2–æû’æ;šÊKžžï–.W–ÂÇžº_Ž3¦î{’â’â/Ž7Ž(€€€€€€€€€€€€€€¼¼ƒ–:šr³¦
¦fC–"Ø€ÌÀÁµÌƒ–Ÿ¾ò3š2'’æ’â¦î{–ÂÇ’â7šr–>[šÚ#¾ò3¦ã–>[š†¢"–no¢žK–rOžBšržVg–r£žV¯¦v‹’â+Ž(€€€€€€€€€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ð€ÄÔ¤ì(€€€€€€€€€€€€€€€¥˜€¡Ñ…É•Ð¤…ÁÁ±åQ…ÁM•±•Ñ¥½¸¡Ñ…É•Ð¤ì(€€€€€€€€€€€€€ô•±Í”¥˜€¡Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¹½¹	±…¹¬€˜˜€…Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð¹µ½Ù•Í=‰©•Ð€˜˜•¹‘=¹	±…¹¬¤ì(€€€€€€€€€€€€€€€€¼¼ƒ–ú{ž¦ëžf÷¢fWš2'’â/Ž’æ–r£ž¦ëžf÷¢fWšRû¦Z/¾òk’â7žº‡š&/š2šîG’ê–’k–ÂG¦÷žº_Ž3–>[šÚ#¦ã–>[Ž7Ž(€€€€€€€€€€€€€€€€¼¼ƒ’â7žÛ–>«šb¿¦î{–ú_š&/š*[’â¦î{¾ò#¢Ú¦8€ÄÕÁã¾ò'–ÂÇ–>[šÚ#’â7š:'¾ò3¦ã–>[š†¢"–no¢žK–rOžBšr’âžnÓžVg¢F_Ž(€€€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘1…å½ÕÑ%¡¹Õ±°¤ì(€€€€€€€€€€€€€€€Í•Ñ%¹±¥¹•‘¥Ñ%¡¹Õ±°¤ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€€€Ý½É­ÍÁ…•A½¥¹Ñ•É½Ý¸¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€€€€€€€ô(€€€€€€€€€õô(€€€€€€€€ø(€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à™±•àµÉ½Ü™±•àµ¹½ÝÉ…À™±•àµÍ¡É¥¹¬´À¥Ñ•µÌµÍÑ…ÉÐ µ™Õ±°ÑÉ…¹Í¥Ñ¥½¸µ½Á…¥Ñä‘ÕÉ…Ñ¥½¸´ÄÔÀˆ(€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€¼¼µ…àµ½¹Ñ•¹Ðƒ¾ò,™±•àµÍ¡É¥¹¬´Ã¾òk¦g’âš:Kžj–¾³–ê›¾òwš&šr'–Â?–¶§–*ƒ¢Öß’úŽ(€€€€€€€€€€€€€€€€€€¼¼ƒ–’[–Æ“šb¼™±•àƒ–ºç–f£¾ò3’â7¦:XÍ¡É¥¹¬ƒžj¢¦Ç¦gš:Kšr¢Š¯–ŽO–n{–ºç–f£–¾³–ê›¾ò0(€€€€€€€€€€€€€€€€€€¼¼ƒ–>Ï¦
+žjžVgžf÷–ÂÇ’â7žº_¦ÈÍÉ½±±]¥‘Ñ£¾ò3šr–ú3’â¦‚šÂã¦ƒš6Ë’â7–"Ãš¶’â·¦ZOŽ(€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€µ…àµ½¹Ñ•¹Ðœ°(€€€€€€€€€€€€€€€€€µ¥¹]¥‘Ñ è€œÄÀÀ”œ°(€€€€€€€€€€€€€€€€€½Á…¥Ñäè½¹Ñ…¥¹•É5•…ÍÕÉ•€ü€Ä€è€À°(€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€ì¼¨ƒ–>«–kžâ»šRû¾ò#’î—–Þ›’â+¢žKž
ë–:¦î{¾ò'ŠSŠPƒ–’[–Æ“–ÞËžÚOšb¿žâ»šRû–ú3žj–Âë–¾ã’ê€¨½ô(€€€€€€€€€€€€€€€ì¼¨(€€€€€€€€€€€€€€€€€ƒ¦g–Æ“žj–Âë–¾ã–ÂÇšb¿Ž3žâ»šRû’æ/–ú3žrš¶’öSžj–’Ÿ–Â?Ž7¾ò3¢Ž‡¦v‹¦
–Æ“š&7–hÍ…±—Ž(€€€€€€€€€€€€€€€€€ƒ¦gš¢š6Ë–.Wž¾–r7¢Þžr/–"Ãžj–’Ÿ–Â?’â¢Ó¾òkš6È€ÅÁàƒžV¯¦v‹–ÂÇ¢ÖÀ€ÅÁã¾ò0(€€€€€€€€€€€€€€€€€ƒ’â7¦r¢šš¾?’â–âŸ–n{¦‚·¢Žs’ö7žžìƒŠSŠPƒ’æ/–&7¦
ž¢»¢ŽsšÎW–r£žrš¦’â+¾ò3š6Ë–.Wšb¼(€€€€€€€€€€€€€€€€€ƒ–B#š"C–~ß¢†3žÞK–r£¢ÞGŽ¢Žs–šb¿’âï–~ß¢†3žÞK–r£¢ÞG¾ò3–Þ»’â–âŸ–ÂÇšrš*[–ú_–ú#šb;¦†¿Ž((€€€€€€€€€€€€€€€€€ƒ–Âë–¾ã¢"–Þ›¦
+žVgžf÷šRçžRÄ…ÁÁ±åMÑÉ¥Á•½µ•ÑÉäƒžnÓš:—–¾¯¾ò#š¾?’â–âŸ’âš²‡¾ò'¾òh(€€€€€€€€€€€€€€€€€ƒ¦Ë–ë¦g–/š¢‡–ò?šf¾ò3ž&#¦v‹¢š¢Þ¢F_žâ»šRû–7ž:’â¢Öß¦žê3¢º+–2[š&7šržÖËšîG¾ò0(€€€€€€€€€€€€€€€€€ƒ’ê“žÖ˜I•…Ðƒ–¾¯žj¢¦Ç–Âë–¾ãšr’âš²‡¢ÞÏ–"Ãžn»š¢g–óŽ–>«šr'žâ»šRû–r£š‹š‹¢ÞGŽ(€€€€€€€€€€€€€€€€¨½ô(€€€€€€€€€€€€€€€€ñ‘¥ØÉ•˜õíÍÑÉ¥ÁM¡•±±I•™ô±…ÍÍ9…µ”ô‰™±•àµÍ¡É¥¹¬´ÀÉ•±…Ñ¥Ù”ˆø(€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€É•˜õíÁ…•Í½±I•™ô(€€€€€€€€€€€€€€€€€‘…Ñ„µÉ¥µÁ…•Ìµ½±Õµ¸ôˆÄˆ(€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à™±•àµ½°¥Ñ•µÌµÍÑ…ÉÐ™±•àµÍ¡É¥¹¬´ÀÉ•±…Ñ¥Ù”ˆ(€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€¼¼ƒ–’[šºóšb¿Ž3žâ»šRû–ú3Ž7žj–Âë–¾ã¾ò3¦g’â–Æ“¢š¢«–ÞÇšJC’ö?Ž3žâ»šRû–&7Ž7žj–Âë–¾ã¾ò0(€€€€€€€€€€€€€€€€€€€€¼¼ƒ’â7žÛšr¢Š¯–’[šºó–ŽO–Â?ŽšVÓš:K¦‚¦v‹–ÂÇš:K’â7¦Z/¾ò#š6Ë–.Wž¾–r7’æšr’â7–’ƒ¾ò$(€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘íÁ…•Ì¹±•¹Ñ €¨ÁÉ•Ù¥•Ý\€¬€¡Á…•Ì¹±•¹Ñ €´€Ä¥õÁá€°(€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘íÁÉ•Ù¥•Ý!õÁá€°(€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½Éµ=É¥¥¸è€±•™ÐÑ½Àœ°(€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦g–/š¢‡–ò?–>«žR£’úš:K¦‚¦v‹¾òk¦‚¦v‹’â+žjšvÇ¢–ÿ’â–ú/’â7¢÷žŠÀ(€€€€€€€€€€€€€€€€€€€€¼¼ƒ¾ò#–Þ›–>ÏšîG–.W’î7žÛ–>¿’î—¾ò3š6Ë–.Wšb¿–’[–Æ“–ºç–f£–r£¢fWžBžj¾ò$(€€€€€€€€€€€€€€€€€€€Á½¥¹Ñ•ÉÙ•¹ÑÌèÁ…•Í5½‘”€ü€¹½¹”œ€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€É•˜õíÁ…•Í½¹Ñ…¥¹•ÉI•™ô(€€€€€€€€€€€€€€€€€€€€¼¼ƒš:K¦‚¦v‹šf’â7¢Ž–"’æ’â7š&O¦fÃ–öÇ¾òk¢Š¯š.[–"Ãšr¦
+¦
+žj¦
’â¦‚š&7’â7šr¢Š¯¦îG¢&Ë¢N/š:$(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí™±•à™±•àµÉ½Ü™±•àµ¹½ÝÉ…ÀÉ•±…Ñ¥Ù”€‘ì(€€€€€€€€€€€€€€€€€€€€€Á…•Í5½‘”ñðÁ…•ÍY¥ÍÕ…°€ü€œœ€è€Í¡…‘½ÜµlÁ|ÈÕÁá|ØÁÁá}É‰„ À°À°À°À¸à¥t½Ù•É™±½Üµ¡¥‘‘•¸œ(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€¼¨ƒš&šr'¦‚¦v‹–Ÿ–ºç–ÇžR£’â–/šb;žŠëžjžæ«¢Ž÷¦
+žV3Ž	M…™…É¤ƒ–Â4½Ù•É™±½ÜéÙ¥Í¥‰±”(€€€€€€€€€€€€€€€€€€€€€€€€ƒžjMY¾ò?šZ–¶_–r£–Âë–¾ãš"[’ö7žö»¦žê3¢º+–.Wšf¾ò3–Ûž"û–>«¦7žV¯šZÃž¾–r7ŽšÊKšr$(€€€€€€€€€€€€€€€€€€€€€€€€ƒšâš:'¢"+ž¾–r7¾ò3šZóšb¿–r[–ö‹¦
+žÞ’â¢Þ¿žVg’â/šºc–öÇ¾òo–B–¶C–Æ“–"–"—–B#š"Cšf’æšr(€€€€€€€€€€€€€€€€€€€€€€€€ƒ–nƒ–Â?šVã–êŸš¢g–>[šVÓ’â7–B3¢3’êKžnãš*[–.WŽš*+šVÓš:K–Ÿ–ºç¢¢·š"C–B3’â–,Á…¥¹Ð(€€€€€€€€€€€€€€€€€€€€€€€€½¹Ñ…¥¹µ•¹Ó¾ò3ž?¢š÷–f£š¾?–æšr’î—¦g–/–º3šVÓ–6–~–’ÇšV#¢"–B#š"CŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€¼¨ƒš:K–ê?š^Û¦†×¦v‹’òkžšï–ò–:šv—žjšVÓš:K¢úçžV3¾ò1Á…¥¹Ð½¹Ñ…¥¹µ•¹Ðƒ’òk–<(€€€€€€€€€€€€€€€€€€€€€€€€ƒ–Þ›–>Ï¦îG¢&Ë¦»žö§’âš‚ßš*+šÖ»¢Ößžj¦†×¦v‹–"š:'¾ò3–nƒš¶“š¶“š¢‡–ò?–þ¦†ï–Ï¦^·¾òl(€€€€€€€€€€€€€€€€€€€€€€€€ƒ’â¢"³žò[¢úG’î7’þwžVdÁ…¥¹Ð½¹Ñ…¥¹µ•¹Ðƒšv—¦ÿ–7’êK–*£šº/–öÇŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€½¹Ñ…¥¸èÁ…•Í5½‘”€ü€¹½¹”œ€è€Á…¥¹Ðœ°(€€€€€€€€€€€€€€€€€€€€€¥Í½±…Ñ¥½¸è€¥Í½±…Ñ”œ°(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€íÁ…•Ì¹µ…À ¡Á…”°Á…•%‘à¤€ôøì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÁÉ•Ù¥•ÝM…±”€ô5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ðñð€Ä¤ì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ•…µÕ¥‘•`€ôÁ…•%‘à€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¤€´€À¸Ôì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥ÍM•…µÕ¥‘•Ñ¥Ù”€ôÁ…•%‘à€ø€À€˜˜…Ñ¥Ù•Õ¥‘•±¥¹•Ì¹Í½µ” (€€€€€€€€€€€€€€€€€€€€€€€Õ¥‘”€ôøÕ¥‘”¹ÑåÁ”€ôôô€Ù•ÉÑ¥…°œ(€€€€€€€€€€€€€€€€€€€€€€€€€€˜˜5…Ñ ¹…‰Ì¡Õ¥‘”¹½½É€´Í•…µÕ¥‘•`¤€ðô€À¸ÜÔ€¼ÁÉ•Ù¥•ÝM…±”(€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€ñI•…Ð¹É…µ•¹Ð­•äõíÁ…”¹¥‘ôø(€€€€€€€€€€€€€€€€€€€€€€€€€íÁ…•%‘à€ø€À€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰ÜµlÅÁát™±•àµÍ¡É¥¹¬´ÀÍ•±˜µÍÑÉ•Ñ Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš:K¦‚¦v‹šfžj–"¦jSžÞk¾òkžÊ_žÒÃ¢Þ¢F_šVÓš:K’â¢Ößž¶'š¾S’ú/žâ»–Â<(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¾ò#’â7–>›–’[¢Žs–n{’ú¾ò'¾ò3¦†?¢&Ë–&žnÓš:—–>[’â¢"³š¢‡–ò?¦
šŠwžÞkžj¦†?¢&È(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¾ò#–Þ—’ös–6–êW¢&Ë–7–ŽOšÞÄ€ÄÔ—¾ò'’â›šRçš"CŽ3’â7¦?šb;Ž7ŠSŠP(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–6+¦?šb;žj¢¦Çžnã¦Ã–§¦‚–B¢«–kš²‡–?žÒƒš*_¦.ã¦öK¾ò3–êW’â/¦?–ë’ú–’k–ÂD(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒžr/¦
šŠwžâ¯¢B÷–r£–?žÒƒš‚óžj–N«¾ò3š¾?šŠwšÞÇšÞë–ÂÇšr’â7’âš¢Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–>›–’[žZ+–r£¦‚¦v‹’â+¦v‹¾ò3’â7žÛ–>Ï¦
+¦
’â¦‚šrš*+–º¢N/š:'–6+šŠwŽ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–"¦jSžÞkšÂã¦ƒ’öÿžR£–B3’â–/’â7¦?šb;–Š£¢&Ë¾òoš.[¦‚¢"–n{–ö#šr¦^Ó’æ|(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ’â7–7’âÓš^Û–>c¦?šb;¾ò3–B›–"g¦
–ƒ–âŸžr/¢Ößšv—–ÂÇ–?¢Š¯¦†×¦v‹žn[’ö?Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ¦g–/šž÷’ö7–>«žÚ·š2š^‹šr'¦‚¦v‹–êŸš¢g’â›¢Žsš"C–>Ï¦‚–êW¢&Ë¾òožrš¶žj(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÅÁàƒ–"–&ËžÞk–r£žâ»šRû–ºç–f£–’[žæ«¢Ž÷¾ò3¦g¢Ž‡’â7¢÷–7šr'š>?¦
+š"[¦fÃ–öÇŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰…­É½Õ¹‘½±½ÈèÁ…”¹‰½±½È°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–º–þ¦†ï¦®c’ê;š.[¢Ößžj¦†×¦v‹’â;¢«žRÇ–nû–ÆŽ–7žR£–B3¢&Ë–6+–?žÒƒ¦bÓ–öÄ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¢šžnX™É…Ñ¥½¹…°é½½´ƒ–r£’â“’úŸ’êŸžRžjš*_¦R¿¦öÿšÖ¢úç¾ò3šržî#–>¨(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒžVg’â/’âšv‡¦Šs¢&Ë’â¢Óžjš:—žòw¾ò3’â7’òk–’k–ëš^¢úç¦
šv‡šÞ‡žêÿŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á½Í¥Ñ¥½¸è€É•±…Ñ¥Ù”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè€¹½¹”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í•µ‰•‘‘•‘M•…µÍI•˜¹ÕÉÉ•¹Ð€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€‘ì´À¸Ô€¼ÁÉ•Ù¥•ÝM…±•õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè…±Œ ÄÀÀ”€¬€‘ìÄ€¼ÁÉ•Ù¥•ÝM…±•õÁà¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘ìÄ€¼ÁÉ•Ù¥•ÝM…±•õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰…­É½Õ¹‘½±½Èè¥ÍM•…µÕ¥‘•Ñ¥Ù”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€Éˆ Ôä€ÄÌÀ€ÈÐØ¤œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€èÍ¡…‘•!•à¡]=I-MA}	°A}M5}%9,¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€é%¹‘•àè€ÈÀÀ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô((€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥õíÁ…•%‘à€ôôô€À€ü€‰É¥µÁÉ•Ù¥•Üµ½¹Ñ…¥¹•Èˆ€èÉ¥µÁÉ•Ù¥•Üµ½¹Ñ…¥¹•È´‘íÁ…•%‘áõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µÁ…”µ¥õíÁ…”¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦g¢Ž‡–"ïš?’â7¢Ž–"’æ’â7¢«š"C–‚žZ+žJÃ–Š¾òk’ö#–Æš&7¢÷¢Š¯š.[–ë¦g’â¦‚Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ’â›–J3’â¢"³–r[ž&’êKžnãž¦ÿš>K–r[–Æ“¾ò#¢Ž–"šRçžRÇšVÓšŠw¦‚¦v‹–ºç–f£¢Êƒ¢Ê³¾ò$(€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰É•±…Ñ¥Ù”™±•àµÍ¡É¥¹¬´ÀÕÉÍ½ÈµÁ½¥¹Ñ•È½Á…¥Ñä´ÄÀÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒš:K¦‚¦v‹š.[šnÏ¾òkšVÓ–ò×¦‚¦v‹¾ò#–B¯¢Ž‡¦v‹žj’ö#–Æ¾ò'’â¢Öß¢Þ¢F_š&/š2¢ÖÃŽ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¢Š¯š.ÿ¢Öß’úžj¦
’â–ò×–ú»–ú»šRû–’Ÿ¾ò/–*ƒ¦fÃ–öÇ¾ò3–Û’î[–ò×–æÏ¦‚¢ºO¦Z/Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¢Þ¦‚¦v‹’â+žj¢«žRÇ–r[–Æ“–ÇžR£–B3’âšR¿¾ò#–B¯šRûš&/–ú3žjšRÛ–Âû¾ò'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–§¦
+š&7šr’â¢Öß–.WŽ’â¢Öß–p(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐµØ€ôÁ…•½¹Ñ•¹ÑM¡¥™Ð¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±¥™Ñ•€ô€„…µØ€˜˜µØ¹Ì€„ôô€Äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘íÁÉ•Ù¥•Ý]õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘íÁÉ•Ù¥•Ý!õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰…­É½Õ¹‘½±½ÈèÁ…”¹‰½±½È°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á½Í¥Ñ¥½¸è€É•±…Ñ¥Ù”œ…Ì½¹ÍÐ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´èµØ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üÑÉ…¹Í±…Ñ•` ‘íµØ¹‘áõÁà¤‘í±¥™Ñ•€ü€Í…±” ‘íµØ¹Íô¥€€è€œõ€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½Éµ=É¥¥¸è€•¹Ñ•È•¹Ñ•Èœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸èµØ€ü€¡µØ¹±¥Ù”€ü€¹½¹”œ€è€ÑÉ…¹Í™½É´€ÈÈÁµÌÕ‰¥Œµ‰•é¥•È À¸È°À°À°Ä¤œ¤€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè±¥™Ñ•€ü€œÀ€ÄáÁà€ÐÁÁàÉ‰„ À°À°À°À¸ÔÔ¤œ€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€é%¹‘•àè±¥™Ñ•€ü€äÀÀ€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”¥¹Í•Ð´ÀˆÍÑå±”õíì‰…­É½Õ¹‘½±½ÈèÁ…”¹‰½±½Èõô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¢3šf¿žÒ/žB¾òkžZ+–r£–êW¢&Ë’â+Žš&šr'–Ÿ–ºç’æ/’â/¾ò3’â7–öÇ¦~ÿ¦î{¦ã¢"š.[šnÌ€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñA…ÑÑ•É¹1…å•ÈÜõíÁÉ•Ù¥•Ý]ô õíÁÉ•Ù¥•Ý!ô½ÁÑÌõíÁ…•A…ÑÑ•É¸¡Á…”¥ô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€íÁ…”¹±…å½ÕÑÌ¹µ…À ¡±…å½ÕÐ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÁ…•Q•µÁ±…Ñ•Ì€ôQ5A1Q}5Am±…å½ÕÐ¹¥µ…•Ì¹±•¹Ñ¡tñðmtì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÁ…•Ñ¥Ù•Q•µÁ±…Ñ”€ôÁ…•Q•µÁ±…Ñ•Ím±…å½ÕÐ¹Ñ•µÁ±…Ñ•%¹‘•átñðÁ…•Q•µÁ±…Ñ•ÍlÁtñðì¹…µ”è€Ÿ¦‚C¢¢´œ°É•ÑÌèmtôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒš6Ë–"Ã–"—¦‚šf’æ¢š’þwš2¦ã–>[ž.š/¾ò3š&7¢÷’â¢Þ¿š*+’ö#–Æš.[¦;–:ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€ôÍ•±•Ñ•‘1…å½ÕÑ%€ôôô±…å½ÕÐ¹¥ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒšVÓžÖ’ö#–Æ¾òw’â–ò×–r[ž&¾òkžâ»šRûšfš&šr'švÇ¢–ÿ¾ò#š‚ó–¶CŽ¦ZO¢ÞwŽ–rO¢žKŽ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒš‚ó–ŸžŸž&¾ò'ž¶'š¾S’ú/’â¢Öß¢º+¾ò3žr/¢Öß’ú–º3–£’âš¢Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¢3’âSšb¿žR£žr–¾›–Âë–¾ã¢3’â7šb¼ÑÉ…¹Í™½É´èÍ…±” §¾ò3šRû–’Ÿš&7’â7šržÎ+Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±Ì€ô±…å½ÕÐ¹Ðü¹Í…±”€üü€Äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±‰½à€ô±…å½ÕÑ	½à¡±…å½ÕÐ°ÁÉ•Ù¥•Ý\°ÁÉ•Ù¥•Ý ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±Ü€ô±‰½à¹Ü€¨±Ìì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ± €ô±‰½à¹ €¨±Ìì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ…À€ô±…å½ÕÐ¹…À€¨±Ìì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ…‘¥ÕÌ€ô±…å½ÕÐ¹É…‘¥ÕÌ€¨±Ìì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±1•™Ð€ô€¡ÁÉ•Ù¥•Ý\€´±Ü¤€¼€È€¬€¡±…å½ÕÐ¹Ðü¹àñð€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±Q½À€ô€¡ÁÉ•Ù¥•Ý €´± ¤€¼€È€¬€¡±…å½ÕÐ¹Ðü¹äñð€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí±…å½ÕÐ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ±…å½ÕÐµÝÉ…ÁÁ•ÈõíÁ…•%‘áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ±…å½ÕÐµ¥õí±…å½ÕÐ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ±…å½ÕÐµèõí±…å½ÕÐ¹è€üü€Áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè€‘í±1•™ÑõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€‘í±Q½ÁõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘í±ÝõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘í±¡õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸è€¹½¹”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€é%¹‘•àè€Ôä€¬€¡±…å½ÕÐ¹è€üü€À¤€¨€È°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨¹…Ñ¥Ù”é½½´ƒ’â7¢÷¢º§š¾?’â«š‚ó–¶C–B¢«š"C’âë–>[šVÓ¾ò?–B#š"C–6W’ö7Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒšVÓ’â«–â–Æ–në–ºk–r£–B3’â’â«–B#š"C–vCš‚žÎï¾ò3žò§šRûš^Ûš‚ó–¶CŽšr³’öO’â8(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–Ç’ê¯¢úçžV3’ös’âë’â–v_žžï–*£¾ò3’â7’òk–B¢«¢ÞÏ–"Ãžnã¦
ï–?žÒƒŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥Í½±…Ñ¥½¸è€¥Í½±…Ñ”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰…­™…•Y¥Í¥‰¥±¥Ñäè€¡¥‘‘•¸œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥±±¡…¹”è€ÑÉ…¹Í™½É´œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á½¥¹Ñ•ÉÙ•¹ÑÌè…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€ü€¹½¹”œ€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–§š2š^/¢ö'¾òkžnÓš:—¢ö'šVÓ–/–’[š†¾ò3¢Ž‡¦v‹žjš‚ó–¶CŽžŸž&Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦ã–>[š†Ž–no–/¢žKŽ¦
š:Kš2'¦"W–£¦£¢Þ¢F_¢ö'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦¦î{šN+–F÷’â·–"“–ºk¦÷šb¿ž?¢š÷–f£¢«–ÞÇžº_žjŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¸¸¸ ¡±…å½ÕÐ¹Ðü¹É½Ðñð€À¤€„ôô€À(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üìÑÉ…¹Í™½É´èÉ½Ñ…Ñ” ‘í±…å½ÕÐ¹Ð„¹É½Ñõ‘•œ¥€°ÑÉ…¹Í™½Éµ=É¥¥¸è€•¹Ñ•È•¹Ñ•Èœô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è¹Õ±°¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡MÑ…ÉÐõí¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€ü¡…¹‘±•1…å½ÕÑQ½Õ¡MÑ…ÉÐ€èÕ¹‘•™¥¹•‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡5½Ù”õí¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€ü¡…¹‘±•1…å½ÕÑQ½Õ¡5½Ù”€èÕ¹‘•™¥¹•‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡¹õí¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€ü¡…¹‘±•1…å½ÕÑQ½Õ¡¹€èÕ¹‘•™¥¹•‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡…¹•°õí¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€ü¡…¹‘±•1…å½ÕÑQ½Õ¡¹€èÕ¹‘•™¥¹•‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±…å½ÕÑQÉ…¹Í¥Ñ¥½¸€ô€¹½¹”œì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥µ…•QÉ…¹Í¥Ñ¥½¸€ô€¹½¹”œì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸Á…•Ñ¥Ù•Q•µÁ±…Ñ”¹É•ÑÌ¹µ…À ¡É•Ð°¥‘à¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ•±°€ô±…å½ÕÐ¹¥µ…•Ím¥‘átì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥ÍM•±•Ñ•€ôÍ•±•Ñ•‘%¹‘•à€ôôô¥‘à€˜˜¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒšVÓžÖ’ö#–Æ¢Š¯¦ã–>[šf¾ò#ž²³’âš²‡¦î{šN+¾ò'¾ò3š‚ó–¶Cšb¿Ž3šVÓ¦®Sžj’â¦£–"Ž7¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ’â7¢¦Ë–7–B¢«–>7žf÷¾ò?žfó’ê¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒšVÓžÖ¦ã–>[šfš‚ó–¶C’â7–B¢«–>7žf÷¾òo’öžržj–r£š.[šnÏ’ê“š>ošf¦
šb¿¢ššr'šRûžö»–n{¦–,(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍÝ…ÁÁ¥¹œ€ôÑ½Õ¡É…•‘%¹‘•à€„ôô¹Õ±°ñð‘É…•‘%¹‘•à€„ôô¹Õ±°ñð™±½…ÑÉ…MÉŒ€„ôô¹Õ±°ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÝ¡½±•1…å½ÕÑM•±•Ñ•€ô¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€˜˜Í•±•Ñ•‘%¹‘•à€ôôô¹Õ±°€˜˜€…ÍÝ…ÁÁ¥¹œì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥ÍÉ…=Ù•È€ô‘É…=Ù•É%¹‘•à€ôôô¥‘à€˜˜¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€˜˜€…Ý¡½±•1…å½ÕÑM•±•Ñ•ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒž&#¦v‹šVÓ¦®S–#–Ÿžâ»–6+–/¦ZO¢Þw¾ò3š‚ó–¶Cšr³¢ê¯–7–BžVg–6+–,Á…‘‘¥¹Ÿ¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦gš¢š‚óžÞk–¾³–ê›¢"šr–’[–r#žVgžf÷’â¢Ó¾ò3¢3’âSžnã¦Ãš‚ó–¶CžÊûšê[žnãš:—ŽžÖW’â7¦7žZ((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¾ò#žnã¦Ã–§š‚óžº_–ë–B3’â–/šÖ»¦î{¦
+žV3¾ò3’î7žÛžÊûšê[žnãš:—¾ò'Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–êŸš¢g–"ïš?’â7–>[šVÓšVã¾òk–>[šVÓžj¢¦Ç¾ò3žâ»šRû’ö#–Æžj¦;ž¢/’â·š¾?’âš‚óšr–r (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ’â7–B3šf¦ZO¦î{¢ÞÌ€ÅÁã¾ò3š‚ó–ŸžjžŸž&žr/¢Öß’ú–ÂÇ–r£’ê–.WŽ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥¹Í•Ð€ô…À€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ…É•…\€ô5…Ñ ¹µ…à Ä°±Ü€´¥¹Í•Ð€¨€È¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ…É•… €ô5…Ñ ¹µ…à Ä°± €´¥¹Í•Ð€¨€È¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±•™ÑAà€ô¥¹Í•Ð€¬É•Ð¹à€¨…É•…\ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ¥¡ÑAà€ô¥¹Í•Ð€¬€¡É•Ð¹à€¬É•Ð¹Ü¤€¨…É•…\ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÑ½ÁAà€ô¥¹Í•Ð€¬É•Ð¹ä€¨…É•… ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‰½ÑÑ½µAà€ô¥¹Í•Ð€¬€¡É•Ð¹ä€¬É•Ð¹ ¤€¨…É•… ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ¦Š¢ž#žò§šRûšr¦^ÓšVÓšŽÔI•…Ðƒš‚G’â7’òk¦C–âŸ¦7žîc¾ò3–’[–Æ¹…Ñ¥Ù”é½½´(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ’òk¢Ò¢Ò¢þ{žî·žò§šRûŽš‚ó–¶C¢.—–#–B¢¨5…Ñ ¹É½Õ¹“¾ò3–7’ê“žîdé½½·¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš¾?’âšv‡¢úç’òk–r£’â7–B3–7ž:¢Þ£¢þ–?žÒƒš‚ó¾òkš‚ó–¶C’òkš*[¾ò3–³–Ç–"–&Ëžêÿ’æ’òh(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–þ÷¦jC–þ÷ž:ÃŽ¢þg¦3¢º§žnã¦
ïš‚óžnÓš:—–Ç’ê¯–B3’âžîšÖ»ž
ç¢úçžV3¾ò3šVÓ–v_–â–Æ–>¨(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–'š‚–2[’âš²‡¾òo¦vgš¶‹’â;š&/–*ÿšr¦^Ó¦÷’â7–7–"š6‹–ƒ’öW¢ž–"gŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ°À€ô±•™ÑAà°ÐÀ€ôÑ½ÁAàì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ•±±]¥‘Ñ €ô5…Ñ ¹µ…à Ä°É¥¡ÑAà€´±•™ÑAà¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ•±±!•¥¡Ð€ô5…Ñ ¹µ…à Ä°‰½ÑÑ½µAà€´Ñ½ÁAà¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ…Ý\€ô5…Ñ ¹µ…à Ä°É¥¡ÑAà€´±•™ÑAà¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ…Ý €ô5…Ñ ¹µ…à Ä°‰½ÑÑ½µAà€´Ñ½ÁAà¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ™¥á`€ô€Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ™¥ád€ô€Àì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ …•±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõíÍ±½Ð´‘í¥‘áõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”‰œµ¹•ÕÑÉ…°´äÀÀ‰½É‘•È‰½É‘•Èµ¹•ÕÑÉ…°´àÀÀ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµ¹•ÕÑÉ…°´ØÀÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè€‘í°ÁõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€‘íÐÁõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘í•±±]¥‘Ñ¡õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘í•±±!•¥¡ÑõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á…‘‘¥¹œè€‘í…À€¼€ÉõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸è±…å½ÕÑQÉ…¹Í¥Ñ¥½¸°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Üµ™Õ±° µ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È‰œµ¹•ÕÑÉ…°´äÔÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€‘íÉ…‘¥ÕÍõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¸¸¸¡É…‘¥ÕÌ€ø€À€üì]•‰­¥Ñ5…Í­%µ…”è€œµÝ•‰­¥ÐµÉ…‘¥…°µÉ…‘¥•¹Ð¡Ý¡¥Ñ”°‰±…¬¤œô€è¹Õ±°¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑM±½ÑQ½UÁ±½…¡¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•Á±…•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ðü¹±¥¬ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°ô‹¦ãšNžnãž&ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰ÜµlÜÙÁát µlÐÑÁátˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼µÁÑäM±½Ð…ÉU$(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡•±°¹ÕÉ°€ôôô€œœ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí•±°¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ•±°µ¥õí¥‘áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð€ôìàè”¹±¥•¹Ñ`°äè”¹±¥•¹Ñdôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É5½Ù”õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘à€ô”¹±¥•¹Ñ`€´Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘ä€ô”¹±¥•¹Ñd€´Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ø€à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¢žãš:Ÿ–ÞËžÚO–r Ñ½Õ¡•¹ƒ¢fWžB¦;’ê¾ò3–"—¢ºO–B#š"C–ë’úžj±¥¬ƒ–7–k’âš²„(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡…Ñ”¹¹½Ü ¤€´Ñ½Õ¡!…¹‘±•‘ÑI•˜¹ÕÉÉ•¹Ð€ð€ØÀÀ¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¢"šr'žŸž&žjš‚ó–¶C’â¢Ó¾òkž²³’âš²‡¦î{šN+–#¦ã’â·šVÓžÖ’ö#–Æ¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–7¦î{’âš²‡š&7¦Ë–"Ã¦g’âš‚ó¾ò#¦Z/–V¦ã–r[¾ò$(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•±•Ñ•±±=É1…å½ÕÐ¡±…å½ÕÐ¹¥°¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹É…=Ù•Èõì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•É…=Ù•È¡”°¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹É…1•…Ù”õí¡…¹‘±•É…1•…Ù•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹É½Àõì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•É½À¡”°¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡MÑ…ÉÐõì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±••±±Q½Õ¡MÑ…ÉÐ¡”°¥‘à°±…å½ÕÐ¹¥¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡5½Ù”õì¡”¤€ôø¡…¹‘±••±±Q½Õ¡5½Ù”¡”°¥‘à°±…å½ÕÐ¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡¹õì¡”¤€ôø¡…¹‘±••±±Q½Õ¡¹¡”°¥‘à°±…å½ÕÐ¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡…¹•°õì¡”¤€ôø¡…¹‘±••±±Q½Õ¡¹¡”°¥‘à°±…å½ÕÐ¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”ÕÉÍ½ÈµÁ½¥¹Ñ•ÈÉ½ÕÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè€‘í°ÁõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€‘íÐÁõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘í•±±]¥‘Ñ¡õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘í•±±!•¥¡ÑõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á…‘‘¥¹œè€‘í…À€¼€ÉõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸è±…å½ÕÑQÉ…¹Í¥Ñ¥½¸°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÜµ™Õ±° µ™Õ±°É•±…Ñ¥Ù”™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÉ½Õ¹‘•µ±œ‰œµlŒÁŒÁŒÁtÑÉ…¹Í¥Ñ¥½¸µm‰…­É½Õ¹µ½±½È±‰½àµÍ¡…‘½Ýt‘ÕÉ…Ñ¥½¸´ÌÀÀ€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍM•±•Ñ•€˜˜€…Í•±•Ñ¥½¹É…¥¹œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰œµlŒÄÐÄÐÄÑtÍ¡…‘½ÜµlÁ|Á|ÄÕÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸ÀÔ¥tœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€¡Ý¡½±•1…å½ÕÑM•±•Ñ•€ü€œœ€è€•±°µ¡½Ù•Èœ¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€‘íÉ…‘¥ÕÍõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒšZÃ–Š{–â–ÆžjÉ…‘¥ÕÌƒšb¼€ÃŽš¶“š^Û–îëž®,]•‰-¥Ðµ…Í¬ƒ–>«’òkš*+š¾?’â¨(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒžnã¦
ïš‚ó–¶Cš.š"Cž.³ž®/–B#š"C–Æ¾ò3¦7žîcš^Û’î;’â·¦^Óšò?–ë¦†×¦v‹žf÷–êW¾òožrš¶Œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒšr'–r¢žKš^Ûš&7¦r¢š¢þg’â«š*_¦R¿¦öÿ¦»žö§Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¸¸¸¡É…‘¥ÕÌ€ø€À€üì]•‰­¥Ñ5…Í­%µ…”è€œµÝ•‰­¥ÐµÉ…‘¥…°µÉ…‘¥•¹Ð¡Ý¡¥Ñ”°‰±…¬¤œô€è¹Õ±°¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑM±½ÑQ½UÁ±½…¡¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•Á±…•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ðü¹±¥¬ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°ô‹¦ãšNžnãž&ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰ÜµlÜÙÁát µlÐÑÁátˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ‘¥´µ½Ù•É±…äôˆÄˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”¥¹Í•Ð´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€‘íÉ…‘¥ÕÍõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒž¦ëš‚ó–¶C’æ¢ššr'š.[šRû–n{¦–/¾ò3’âš¢–>«žR£¢º+’ê»šj_ž’ë¾ò3’â7–*ƒžf÷š†(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰…­É½Õ¹‘½±½Èè€É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸ÄÐ¤œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½Á…¥Ñäè€¡¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€˜˜€…Ý¡½±•1…å½ÕÑM•±•Ñ•€˜˜€¡Ñ½Õ¡É…=Ù•É%¹‘•à€ôôô¥‘àñð¥ÍÉ…=Ù•Èñð¡½Ù•É•‘MÝ…ÁQ…É•Ñ%¹‘•à€ôôô¥‘à¤¤ñð(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡ÍÝ…Á=Ù•Èü¹­¥¹€ôôô€•±°œ€˜˜ÍÝ…Á=Ù•È¹¥‘à€ôôô¥‘à€˜˜ÍÝ…Á=Ù•È¹±…å½ÕÑ%€ôôô±…å½ÕÐ¹¥¤€ü€Ä€è€À°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÝ}¥µœ€ô•±°¹¹…ÑÕÉ…±]¥‘Ñ ñð€àÀÀì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¡}¥µœ€ô•±°¹¹…ÑÕÉ…±!•¥¡Ðñð€ØÀÀì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥ÌäÁ½ÈÈÜÀ€ô€¡•±°¹É½Ñ…Ñ¥½¸€”€ÄàÀ¤€„ôô€Àì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘É…Ý\€ô¥ÌäÁ½ÈÈÜÀ€ü¡}¥µœ€èÝ}¥µœì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘É…Ý €ô¥ÌäÁ½ÈÈÜÀ€üÝ}¥µœ€è¡}¥µœì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒžR£Ž3šÊK–>[šVÓŽ7žjš‚ó–¶C–’Ÿ–Â?žº_¾ò3žŸž&žjžâ»šRûš&7’â7šr¢Þ¢F\(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš‚óžÞk–>[šVÓ’â¢Öß¢ÞÏ¾ò#š†–>[šVÓŽžŸž&¦žê3¾ò3¢š/’â+¦v‹žj¢ª«šb;¾ò'Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ…±•`€ôÉ…Ý\€¼‘É…Ý\ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ…±•d€ôÉ…Ý €¼‘É…Ý ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦bËš¶‹š‚ó–¶C¦
+žÞ¦rË–ëžÒÃžâ¯žjŽ3–J³¦
+Ž7ŽžÒSžÊçžR£’æcžj¾ò3’â7¢÷–7–*ƒ–âãšVàƒŠSŠP(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–*ƒ–âãšVãžj¢¦Çžâ»šRûšfš¾?–ò×žŸž&žnã–Â7š‚ó–¶Cžjš¾S’ú/šr¢Þ¢F_¢º+¾ò3–ÂÇ’â7šb¿ž¶'š¾S’ú/’êŽ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ù•ÉM…±”€ô5…Ñ ¹µ…à¡Í…±•`°Í…±•d¤€¨€Ä¸ÀÈì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ™¥¹…±M…±”€ô½Ù•ÉM…±”€¨•±°¹é½½´ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±…å½ÕÑ\€ôÝ}¥µœì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±…å½ÕÑ €ô¡}¥µœì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒšVÓžÖ’ö#–ÆžR MLÍ…±”ƒžâ»šRûšf¾ò3š‚ó–¶C¢Þ¢F_¢º+–’Ÿ¢º+–Â?šb¿–Â7žj¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ’öš‚ó–ŸžŸž&šr³¢ê¯’â7¢¦Ë¢Þ¢F_žâ¸ƒŠSŠPƒ¦g¢Ž‡–>7–BGš*×¦*ßš:$ÝÉ…ÁÁ•Èƒžjžâ»šRûŽ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍÍM…±”€ô™¥¹…±M…±”ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí•±°¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ•±°µ¥õí¥‘áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð€ôìàè”¹±¥•¹Ñ`°äè”¹±¥•¹Ñdôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É5½Ù”õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘à€ô”¹±¥•¹Ñ`€´Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘ä€ô”¹±¥•¹Ñd€´Á½¥¹Ñ•ÉMÑ…ÉÑA½ÍI•˜¹ÕÉÉ•¹Ð¹äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹¡åÁ½Ð¡‘à°‘ä¤€ø€à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡‘É…=É5½Ù•=ÕÉÉ•‘I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡…Ñ”¹¹½Ü ¤€´Ñ½Õ¡!…¹‘±•‘ÑI•˜¹ÕÉÉ•¹Ð€ð€ØÀÀ¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•±•Ñ•±±=É1…å½ÕÐ¡±…å½ÕÐ¹¥°¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘É……‰±”õíÍ•±•Ñ•‘%¹‘•à€„ôô¥‘àñð€…¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹É…MÑ…ÉÐõì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•É…MÑ…ÉÐ¡”°¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹É…=Ù•Èõì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•É…=Ù•È¡”°¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹É…1•…Ù”õí¡…¹‘±•É…1•…Ù•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹É½Àõì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•É½À¡”°¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹É…¹õí¡…¹‘±•É…¹‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡MÑ…ÉÐõì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±••±±Q½Õ¡MÑ…ÉÐ¡”°¥‘à°±…å½ÕÐ¹¥¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡5½Ù”õì¡”¤€ôø¡…¹‘±••±±Q½Õ¡5½Ù”¡”°¥‘à°±…å½ÕÐ¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡¹õì¡”¤€ôø¡…¹‘±••±±Q½Õ¡¹¡”°¥‘à°±…å½ÕÐ¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡…¹•°õì¡”¤€ôø¡…¹‘±••±±Q½Õ¡¹¡”°¥‘à°±…å½ÕÐ¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”ÕÉÍ½ÈµÉ…ˆ…Ñ¥Ù”éÕÉÍ½ÈµÉ…‰‰¥¹œÍ•±•Ðµ¹½¹”É½ÕÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè€‘í°ÁõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€‘íÐÁõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘í•±±]¥‘Ñ¡õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘í•±±!•¥¡ÑõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á…‘‘¥¹œè€‘í…À€¼€ÉõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸è±…å½ÕÑQÉ…¹Í¥Ñ¥½¸°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€é%¹‘•àè€¡¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€˜˜€¡¥ÍÉ…=Ù•ÈñðÑ½Õ¡É…=Ù•É%¹‘•à€ôôô¥‘àñð¡½Ù•É•‘MÝ…ÁQ…É•Ñ%¹‘•à€ôôô¥‘à¤¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€Ð(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€¡¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€˜˜€¡‘É…•‘%¹‘•à€ôôô¥‘àñðÑ½Õ¡É…•‘%¹‘•à€ôôô¥‘à¤¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€Ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è¥ÍM•±•Ñ•(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€È(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€Ä°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥õí•±°µ½¹Ñ…¥¹•È´‘í¥‘áõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•MÝ¥Ñ¡A…”¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•½¹Ñ•¹ÑA½¥¹Ñ•É½Ý¸¡”°¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É5½Ù”õí¡…¹‘±•½¹Ñ•¹ÑA½¥¹Ñ•É5½Ù•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•ÉUÀõí¡…¹‘±•½¹Ñ•¹ÑA½¥¹Ñ•ÉUÁô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É…¹•°õí¡…¹‘±•½¹Ñ•¹ÑA½¥¹Ñ•ÉUÁô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÉ•±…Ñ¥Ù”Üµ™Õ±° µ™Õ±°½Ù•É™±½Üµ¡¥‘‘•¸€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍM•±•Ñ•€ü€è´ÈÀœ€è€œœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰…­É½Õ¹‘½±½Èè€œŒÄÈÄÈÄÈœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦g’âš‚ó¢«–ÞÇ¢¢·’ê–rO¢žK–ÂÇ¢N/š:'’ö#–Æ¦
š‚ç–ÇžR£šîGš†ü(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè•±°¹¥µI…‘¥ÕÌ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‘í½É¹•ÉH¡•±°¹¥µI…‘¥ÕÌ°•±±]¥‘Ñ °•±±!•¥¡Ð¥õÁá€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‘íÉ…‘¥ÕÍõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Õ¡Ñ¥½¸è€¹½¹”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÁ¡½Ñ½MÑå±”èI•…Ð¹MMAÉ½Á•ÉÑ¥•Ì€ôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á½Í¥Ñ¥½¸è€…‰Í½±ÕÑ”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè€œÔÀ”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€œÔÀ”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘í±…å½ÕÑ]õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘í±…å½ÕÑ!õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ…á]¥‘Ñ è€¹½¹”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ…á!•¥¡Ðè€¹½¹”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½Éµ=É¥¥¸è€•¹Ñ•È•¹Ñ•Èœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ” ´ÔÀ”°€´ÔÀ”¤ÑÉ…¹Í±…Ñ” ‘í•±°¹½™™Í•Ñ`€¨É…Ý\€¬™¥áaõÁà°€‘í•±°¹½™™Í•Ñd€¨É…Ý €¬™¥áeõÁà¤É½Ñ…Ñ” ‘í•±°¹É½Ñ…Ñ¥½¹õ‘•œ¤Í…±” ‘íÍÍM…±•ô¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸è¥µ…•QÉ…¹Í¥Ñ¥½¸°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½Á…¥Ñäè€¡•±°¹½Á…¥Ñä€üü€ÄÀÀ¤€¼€ÄÀÀ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á½¥¹Ñ•ÉÙ•¹ÑÌè€¹½¹”œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸¡…ÍA¡½Ñ½à¡•±°¹™à¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ•±±á%µ…”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÕÉ°õí•±°¹ÕÉ±ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™àõí•±°¹™à…ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíÁ¡½Ñ½MÑå±•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±ÕÑI•Ù¥Í¥½¸õí±ÕÑI•Ù¥Í¥½¹ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½á\õí•±±]¥‘Ñ¡ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½á õí•±±!•¥¡Ñô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€ñ¥µœÍÉŒõí•±°¹ÕÉ±ô…±Ðô‰•±°ˆÍÑå±”õíÁ¡½Ñ½MÑå±•ô€¼øì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨Q¡¥¸Í½±¥½ÕÑ±¥¹”½¸Ñ½À½˜Ñ¡”¥µ…”€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í¥ÍM•±•Ñ•€˜˜€…Í•±•Ñ¥½¹É…¥¹œ€˜˜‘É…•‘%¹‘•à€ôôô¹Õ±°€˜˜Ñ½Õ¡É…•‘%¹‘•à€ôôô¹Õ±°€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”¥¹Í•Ð´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”è´ÌÀ‰½É‘•ÈµÍ½±¥‰½É‘•ÈµÝ¡¥Ñ”¼äÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€‘íÉ…‘¥ÕÍõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•É]¥‘Ñ è€À¸ÜÔ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè€À€À€‘ìÌ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¥õÁàÉ‰„ À°À°À°À¸Èà¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´è€ÑÉ…¹Í±…Ñ•h À¤œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¸¸¸¡É…‘¥ÕÌ€ø€À€üì]•‰­¥Ñ5…Í­%µ…”è€œµÝ•‰­¥ÐµÉ…‘¥…°µÉ…‘¥•¹Ð¡Ý¡¥Ñ”°‰±…¬¤œô€è¹Õ±°¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨É…œ=Ù•È!¥¡±¥¡Ð=Ù•É±…ä€´M¥µÁ±¥™¥•Ý¥Ñ I•…ÐÍÑ…Ñ”€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥Í±½…ÑMÝ…Á=Ù•È€ôÍÝ…Á=Ù•Èü¹­¥¹€ôôô€•±°œ€˜˜ÍÝ…Á=Ù•È¹¥‘à€ôôô¥‘à€˜˜ÍÝ…Á=Ù•È¹±…å½ÕÑ%€ôôô±…å½ÕÐ¹¥ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí…‰Í½±ÕÑ”¥¹Í•Ð´À‰œµ‰±…¬¼ØÀè´ÌÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€˜˜€…Ý¡½±•1…å½ÕÑM•±•Ñ•€˜˜€¡Ñ½Õ¡É…=Ù•É%¹‘•à€ôôô¥‘àñð¥ÍÉ…=Ù•Èñð¡½Ù•É•‘MÝ…ÁQ…É•Ñ%¹‘•à€ôôô¥‘à¤¤ñð¥Í±½…ÑMÝ…Á=Ù•È€ü€‰½É‘•ÈµlÀ¸ÜÕÁát‰½É‘•ÈµÍ½±¥‰½É‘•ÈµÝ¡¥Ñ”¼äÀœ€è€‰½É‘•È´Àœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€‘íÉ…‘¥ÕÍõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½Á…¥Ñäè€¡¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€˜˜€…Ý¡½±•1…å½ÕÑM•±•Ñ•€˜˜€¡¥ÍÉ…=Ù•Èñð¡½Ù•É•‘MÝ…ÁQ…É•Ñ%¹‘•à€ôôô¥‘àñðÑ½Õ¡É…•‘%¹‘•à€ôôô¥‘àñðÑ½Õ¡É…=Ù•É%¹‘•à€ôôô¥‘à¤¤ñð¥Í±½…ÑMÝ…Á=Ù•È€ü€Ä€è€À(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í¥ÍM•±•Ñ•€˜˜€…Í•±•Ñ¥½¹É…¥¹œ€˜˜‘É…•‘%¹‘•à€ôôô¹Õ±°€˜˜Ñ½Õ¡É…•‘%¹‘•à€ôôô¹Õ±°€˜˜€  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–>«š>C¦®`èµ¥¹‘•àƒž‡šÎW¦¦n‹¦‚¦v‹¾ò?–â–Æžj¢Ž–"¢"–‚žZ+žJÃ–ŠŽ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¢^—’âãšRçš:o–"Ãš^‹šr$¡É½µ•1…å•Ë¾ò3–Ÿ–ºç’î7žVg–r£–â–Æ–Ÿ¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–>«šr'’êK–.W–Þ—–ß¢÷–º3šVÓšÖ»–r£žnã¦Ãš‚ó–¶C¢"¦îG¢&Ë¦»žö§’â+šZçŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ•±±Q½½±‰…È€ô€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´Ä¼È™±•à¥Ñ•µÌµ•¹Ñ•ÈèµlÌÀÁt‰œµÝ¡¥Ñ”‰…­‘É½Àµ‰±ÕÈµµÉ½Õ¹‘•µ™Õ±°Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ…ÕÑ¼ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥¹Ø€ô€Ä€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½µµ½¸€ôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…Àè€Ð€¨¥¹Ø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á…‘‘¥¹œè€Ð€¨¥¹Ø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè€À€‘ìÄÀ€¨¥¹ÙõÁà€‘ìÈÐ€¨¥¹ÙõÁàÉ‰„ À°À°À°À¸ÌÔ¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸±Q½À€¬ÐÀ€¬•±±!•¥¡Ð€¬€ÐØ€¨¥¹Ø€øÁÉ•Ù¥•Ý (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üì€¸¸¹½µµ½¸°‰½ÑÑ½´è€œÄÀÀ”œ°µ…É¥¹	½ÑÑ½´è€à€¨¥¹Ø°ÑÉ…¹Í™½É´è€ÑÉ…¹Í±…Ñ” ´ÔÀ”°€À¤œ°ÑÉ…¹Í™½Éµ=É¥¥¸è€‰½ÑÑ½´•¹Ñ•Èœô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€èì€¸¸¹½µµ½¸°Ñ½Àè€œÄÀÀ”œ°µ…É¥¹Q½Àè€à€¨¥¹Ø°ÑÉ…¹Í™½É´è€ÑÉ…¹Í±…Ñ” ´ÔÀ”°€À¤œ°ÑÉ…¹Í™½Éµ=É¥¥¸è€Ñ½À•¹Ñ•Èœôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôø”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡MÑ…ÉÐõì¡”¤€ôø”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±••±•Ñ••±±%µ…”¡¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÝ¥‘Ñ è€ÈØ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤°¡•¥¡Ðè€ÈØ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ñ•áÐµ‰±…¬¡½Ù•ÈéÑ•áÐµ¹•ÕÑÉ…°´ÐÀÀÉ½Õ¹‘•µ™Õ±°ÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•Èˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñQÉ…Í ÈÍ¥é”õìÄÐ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¥ô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑM±½ÑQ½UÁ±½…¡¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•Á±…•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ðü¹±¥¬ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÝ¥‘Ñ è€ÈØ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤°¡•¥¡Ðè€ÈØ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ñ•áÐµ‰±…¬¡½Ù•ÈéÑ•áÐµ¹•ÕÑÉ…°´ÐÀÀÉ½Õ¹‘•µ™Õ±°ÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•Èˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñI•™É•Í¡ÜÍ¥é”õìÄÐ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¥ô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¢ÞšÖ»–.W–r[ž&–B3’â¦†Ž3–r[ž&¢ªÿšVÓŽ7¾ò3¦Ëžjšb¿–B3’â–/žÞ£¢ò¿¦v‹švü€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ìÍ•ÑÑ¥Ù•Q…ˆ …‘©ÕÍÐœ¤ìõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹–r[ž&¢ªÿšVÐˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÝ¥‘Ñ è€ÈØ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤°¡•¥¡Ðè€ÈØ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ñ•áÐµ‰±…¬¡½Ù•ÈéÑ•áÐµ¹•ÕÑÉ…°´ÐÀÀÉ½Õ¹‘•µ™Õ±°ÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•Èˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñM±¥‘•ÉÌÍ¥é”õìÄÐ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¥ô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ …¡É½µ•1…å•È¤É•ÑÕÉ¸•±±Q½½±‰…Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÁ…•5½Ù”€ôÁ…•½¹Ñ•¹ÑM¡¥™Ð¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÁ…•1¥™Ñ•€ô€„…Á…•5½Ù”€˜˜Á…•5½Ù”¹Ì€„ôô€Äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸É•…Ñ•A½ÉÑ…° (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™ÐèÁ…•%‘à€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€À°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ èÁÉ•Ù¥•Ý\°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡ÐèÁÉ•Ù¥•Ý °(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´èÁ…•5½Ù”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üÑÉ…¹Í±…Ñ•` ‘íÁ…•5½Ù”¹‘áõÁà¤‘íÁ…•1¥™Ñ•€ü€Í…±” ‘íÁ…•5½Ù”¹Íô¥€€è€œõ€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½Éµ=É¥¥¸è€•¹Ñ•È•¹Ñ•Èœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸èÁ…•5½Ù”€ü€¡Á…•5½Ù”¹±¥Ù”€ü€¹½¹”œ€è€ÑÉ…¹Í™½É´€ÈÈÁµÌÕ‰¥Œµ‰•é¥•È À¸È°À°À°Ä¤œ¤€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€é%¹‘•àè€ÈÀÀÀÀÀ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè±1•™Ð°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè±Q½À°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è±Ü°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè± °(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´è€¡±…å½ÕÐ¹Ðü¹É½Ðñð€À¤€„ôô€À€üÉ½Ñ…Ñ” ‘í±…å½ÕÐ¹Ð„¹É½Ñõ‘•œ¥€€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½Éµ=É¥¥¸è€•¹Ñ•È•¹Ñ•Èœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì±•™Ðè°À°Ñ½ÀèÐÀ°Ý¥‘Ñ è•±±]¥‘Ñ °¡•¥¡Ðè•±±!•¥¡Ðõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í•±±Q½½±‰…Éô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡É½µ•1…å•È°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒž¦ëš‚ó–¶Cžj–"–&Ëžêÿ¦n’â·–r£–B3’â’â¨MYƒ’â·žîc–"ÛŽ–:šr³š¾?š‚ó–BžRï’â–r (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Í¡•‰½É‘•Ë¾ò3žnã¦
ï¢úç’òk¦7–>ƒš"C’â“’â«ž.³ž®/–B#š"C–Æ¾òm¹…Ñ¥Ù”é½½´(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš^Û’â“–Æ–>[šVÓ’â7–B3’úÿ’òk¦^«žš"[šr'’â–Æšjš^ÛšÚ#–’ÇŽ–6W’â–BG¦?–Æ–Ç’ê¬(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–vCš‚¾ò1¹½¸µÍ…±¥¹œµÍÑÉ½­”ƒ–"g¢º§žêÿ–º÷’â7¦j?¦Š¢ž#šRû–’Ÿžò§–Â?Ž€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í±…å½ÕÐ¹¥µ…•Ì¹Í½µ”¡•±°€ôø€…•±°ñð•±°¹ÕÉ°€ôôô€œœ¤€˜˜€  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ•µÁÑåI•ÑÌ€ôÁ…•Ñ¥Ù•Q•µÁ±…Ñ”¹É•ÑÌ¹™±…Ñ5…À ¡É•Ð°¥‘à¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ•±°€ô±…å½ÕÐ¹¥µ…•Ím¥‘átì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡•±°€˜˜•±°¹ÕÉ°€„ôô€œœ¤É•ÑÕÉ¸mtì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥¹Í•Ð€ô…À€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ…É•…\€ô5…Ñ ¹µ…à Ä°±Ü€´¥¹Í•Ð€¨€È¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ…É•… €ô5…Ñ ¹µ…à Ä°± €´¥¹Í•Ð€¨€È¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐà€ô¥¹Í•Ð€¬É•Ð¹à€¨…É•…\€¬…À€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐä€ô¥¹Í•Ð€¬É•Ð¹ä€¨…É•… €¬…À€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÜ€ô5…Ñ ¹µ…à À°É•Ð¹Ü€¨…É•…\€´…À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ €ô5…Ñ ¹µ…à À°É•Ð¹ €¨…É•… €´…À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸mì¥‘à°à°ä°Ü° õtì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒš&šr'ž~§–ö‹’ös’âë–B3’â’â¨Á…Ñ ƒžj–¶C¢Þ¿–ú’âš²‡š‚š‚ó–2[Ž–6Ï’öÿš¢«žêÿ’â8(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒž®[žêÿ–r£’ê“ž
çžnã¦¾ò3’æ–>«’òkšÞß–B#’âš²„…±Á¡‡¾ò3’â7’òk–>ƒš"CšnÓžf÷žjž
çŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ€ô•µÁÑåI•ÑÌ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¹µ…À¡È€ôø4€‘íÈ¹áô€‘íÈ¹åô €‘íÈ¹ÝôØ€‘íÈ¹¡ô €‘ìµÈ¹Ýôi€¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¹©½¥¸ œ€œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ•±•Ñ•‘µÁÑä€ô•µÁÑåI•ÑÌ¹™¥¹¡È€ôø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€È¹¥‘à€ôôôÍ•±•Ñ•‘%¹‘•à€˜˜¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ðø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÙœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ±…å½ÕÐµÉ¥µ±¥¹•Ìõí±…å½ÕÐ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”¥¹Í•Ð´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”èµlÕtˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ù¥•Ý	½àõí€À€À€‘í±Ýô€‘í±¡õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÁÉ•Í•ÉÙ•ÍÁ•ÑI…Ñ¥¼ô‰¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì½Ù•É™±½Üè€Ù¥Í¥‰±”œõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ¡¥‘‘•¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÁ…Ñ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õí‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥±°ô‰¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑÉ½­”ô‰É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸ÄÀ¤ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÍÑÉ½­•]¥‘Ñ è€Ù…È ´µ±…å½ÕÐµÉ¥µÍÑÉ½­”°€ÅÁà¤œõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€íÍ•±•Ñ•‘µÁÑä€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÉ•Ð(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€àõíÍ•±•Ñ•‘µÁÑä¹áôäõíÍ•±•Ñ•‘µÁÑä¹åô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ õíÍ•±•Ñ•‘µÁÑä¹Ýô¡•¥¡ÐõíÍ•±•Ñ•‘µÁÑä¹¡ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥±°ô‰¹½¹”ˆÍÑÉ½­”ô‰Ý¡¥Ñ”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÍÑÉ½­•]¥‘Ñ è€Ù…È ´µ±…å½ÕÐµÉ¥µÍÑÉ½­”°€ÅÁà¤œõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½ÍÙœø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ1…å½ÕÑµÁÑåAÉ½µÁÑ1…å•È•±±Ìõí•µÁÑåI•ÑÍô¡¥‘‘•¸õíÁ…•Í5½‘”ñðÁ…•ÍY¥ÍÕ…±ô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í¥ÍQ¡¥Í1…å½ÕÑM•±•Ñ•€˜˜Í•±•Ñ•‘%¹‘•à€ôôô¹Õ±°€˜˜€  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘½Ð€ô€…‰Í½±ÕÑ”Ü´Ì¸Ô ´Ì¸ÔÉ½Õ¹‘•µ™Õ±°‰œµÝ¡¥Ñ”Í¡…‘½ÜµlÁ|ÉÁá|ÕÁá}É‰„ À°À°À°À¸Ô¥tèµlØÁtÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ…ÕÑ¼Ñ½Õ µ¹½¹”œì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒšVÓžÖ’ö#–ÆšRû–’Ÿ–"Ã¢Ú–ëžV¯–âšf¾ò3–no–/¢žK¢Þš2'¦"Wšr³’úšr¢Š¯¦‚¦v‹–ºç–f£žj(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½Ù•É™±½Üµ¡¥‘‘•¸ƒ–"š:$ƒŠSŠPƒš*O’â7–"Ã¢žKŽ’æš2'’â7–"Ã–"«¦f“Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¢Þ’â¢"³–r[ž&’âš¢¾òk–’[š†šB³–"Ã’â7šr¢Š¯¢Ž–"žj¦
’â–Æ“–:ïžV¯Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐµÙ¡É½µ”€ôÁ…•½¹Ñ•¹ÑM¡¥™Ð¡Á…•%‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±¥™Ñ•‘¡É½µ”€ô€„…µÙ¡É½µ”€˜˜µÙ¡É½µ”¹Ì€„ôô€Äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±…å½ÕÑU¥%¹Ø€ô€Ä€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ð¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½É¹•È€ô€¡­•äè€Ñ°œð€ÑÈœð€‰°œð€‰Èœ°Á½ÌèÍÑÉ¥¹œ°ÕÉÍ½ÈèÍÑÉ¥¹œ¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí­•åô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí€‘í‘½Ñô€‘íÁ½Íô€‘íÕÉÍ½Éõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€ÄÐ€¨±…å½ÕÑU¥%¹Ø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€ÄÐ€¨±…å½ÕÑU¥%¹Ø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´è€ÑÉ…¹Í±…Ñ” ´ÔÀ”°€´ÔÀ”¤œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè€À€‘ìÈ€¨±…å½ÕÑU¥%¹ÙõÁà€‘ìÔ€¨±…å½ÕÑU¥%¹ÙõÁàÉ‰„ À°À°À°À¸Ô¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôø¡…¹‘±•1…å½ÕÑ½É¹•É½Ý¸¡”°­•ä¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É5½Ù”õí¡…¹‘±•1…å½ÕÑ½É¹•É5½Ù•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•ÉUÀõí¡…¹‘±•1…å½ÕÑ½É¹•ÉUÁô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É…¹•°õí¡…¹‘±•1…å½ÕÑ½É¹•ÉUÁô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±…å½ÕÑ¡É½µ”€ô€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–Â7¦ö+žÞk’ê»¢Öß’úšf¾ò3šVÓžÖ–’[š†¾ò#¦ã–>[š†Ž–no¦†–rOžBŽš2'¦"W–"_¾ò'’â¢Öß¢ºO’ö4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒŠSŠPƒ¢Þ’â¢"³–r[ž&ŽšZ–¶_–B3’â–/¢š?–&¾ò#¢š,Í¡½Ý¡É½µ—¾ò'Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒžR Ù¥Í¥‰¥±¥Ñäƒ¢3’â7šb¿š.š:'¾òkš.š:'žj¢¦Çšr$ÑÉ…¹Í™½É´ƒžj–r[–Æ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–Ûž"û’â7šr¦7žæ«¾ò3žV¯¦v‹’â+šržVg’â/–ÞËžÚO¢¦ËšÚ#–’Çžjš†Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”¥¹Í•Ð´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÙ¥Í¥‰¥±¥Ñäè…Ñ¥Ù•Õ¥‘•±¥¹•Ì¹±•¹Ñ €ø€ÀñðÍ•±•Ñ¥½¹É…¥¹œ€ü€¡¥‘‘•¸œ€è€Ù¥Í¥‰±”œõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¦ã–>[š†¢Þ’â¢"³–r[ž&–B3š²û¾òkžÒÃžf÷žÞh€¬ƒ¦fÃ–öÄ€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”¥¹Í•Ð´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”èµlÔÕt‰½É‘•ÈµÍ½±¥‰½É‘•ÈµÝ¡¥Ñ”¼äÔˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½É‘•É]¥‘Ñ è€À¸ÜÔ€¨±…å½ÕÑU¥%¹Ø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè€À€À€‘ìÐ€¨±…å½ÕÑU¥%¹ÙõÁàÉ‰„ À°À°À°À¸Ì¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í½É¹•È Ñ°œ°€Ñ½À´À±•™Ð´Àœ°€ÕÉÍ½Èµ¹ÝÍ”µÉ•Í¥é”œ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í½É¹•È ÑÈœ°€Ñ½À´À±•™Ðµ™Õ±°œ°€ÕÉÍ½Èµ¹•ÍÜµÉ•Í¥é”œ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í½É¹•È ‰°œ°€Ñ½Àµ™Õ±°±•™Ð´Àœ°€ÕÉÍ½Èµ¹•ÍÜµÉ•Í¥é”œ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í½É¹•È ‰Èœ°€Ñ½Àµ™Õ±°±•™Ðµ™Õ±°œ°€ÕÉÍ½Èµ¹ÝÍ”µÉ•Í¥é”œ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒš2'¦"W–"_¢Þ’â¢"³–r[ž&ŽšZ–¶_–B3’â––_¾òkš:o–r£’â·–þŽšÊÿŽ3žV¯¦v‹žjŽ5dƒ¢îà(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš:£–"Ã¢ö'–º3–’[š:—š†žj–’[¦v‹¾ò3–7–>7–BG¢ö'–n{’úƒŠSŠPƒ’ö#–Æ¢ö'’ê¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš2'¦"W’î7žÛšb¿š¶žj¾ò#–>«šr'¦ã–>[š†¢Þ¢žKžB¢Þ¢F_¢ö'¾ò'Ž€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´Ä¼ÈÑ½À´Ä¼È™±•à¥Ñ•µÌµ•¹Ñ•È…À´À¸Ô‰œµÝ¡¥Ñ”É½Õ¹‘•µ™Õ±°À´À¸ÔÍ¡…‘½Üµá°Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ…ÕÑ¼èµlØÁtˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±É½Ð€ô±…å½ÕÐ¹Ðü¹É½Ðñð€Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ…€ô€¡±É½Ð€¨5…Ñ ¹A$¤€¼€ÄàÀì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¡…±™MÁ…¸€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡±Ü€¨5…Ñ ¹…‰Ì¡5…Ñ ¹Í¥¸¡É…¤¤€¬± €¨5…Ñ ¹…‰Ì¡5…Ñ ¹½Ì¡É…¤¤¤€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐä€ô€¡ÁÉ•Ù¥•Ý €´± ¤€¼€È€¬€¡±…å½ÕÐ¹Ðü¹äñð€À¤€¬± €¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥È€ôä€¬¡…±™MÁ…¸€¬€ÔÈ€øÁÉ•Ù¥•Ý €ü€´Ä€è€Äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ€ô‘¥È€¨€¡¡…±™MÁ…¸€¬€ÈØ€¨±…å½ÕÑU¥%¹Ø¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ” ´ÔÀ”°€´ÔÀ”¤ÑÉ…¹Í±…Ñ” ‘í€¨5…Ñ ¹Í¥¸¡É…¥õÁà°€‘í€¨5…Ñ ¹½Ì¡É…¥õÁà¤É½Ñ…Ñ” ‘ìµ±É½Ñõ‘•œ¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…Àè€È€¨±…å½ÕÑU¥%¹Ø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á…‘‘¥¹œè€È€¨±…å½ÕÑU¥%¹Ø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè€À€‘ìÄÀ€¨±…å½ÕÑU¥%¹ÙõÁà€‘ìÈÐ€¨±…å½ÕÑU¥%¹ÙõÁàÉ‰„ À°À°À°À¸ÌÔ¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôø”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹Q½Õ¡MÑ…ÉÐõì¡”¤€ôø”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ’â+’â/žžï–.W¢ÖÃ¢ÞžŸž&ŽšZ–¶_–B3’âšŠw–r[–Æ“šâ–Z¸€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÁ½Ì€ôÍÑ…­A½Ì ±…å½ÕÐœ°±…å½ÕÐ¹¥¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ…¹½Ý¸€ôÁ½Ì€ø€Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ…¹UÀ€ôÁ½Ì€øô€À€˜˜Á½Ì€ð±…å•ÉMÑ…¬¹±•¹Ñ €´€Äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ðø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì¥˜€¡…¹½Ý¸¤µ½Ù•%¹MÑ…¬ ±…å½ÕÐœ°±…å½ÕÐ¹¥°€´Ä¤ìõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘¥Í…‰±•õì……¹½Ý¹ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹’â/žžï’â–Æˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÝ¥‘Ñ è€Èà€¨±…å½ÕÑU¥%¹Ø°¡•¥¡Ðè€Èà€¨±…å½ÕÑU¥%¹Øõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÉ½Õ¹‘•µ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È€‘í…¹½Ý¸€ü€Ñ•áÐµ‰±…¬¡½Ù•Èé‰œµ‰±…¬¼ÄÀœ€è€Ñ•áÐµ‰±…¬¼ÈÔÕÉÍ½Èµ‘•™…Õ±Ðõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ5½Ù•½Ý¸Í¥é”õìÄÐ€¨±…å½ÕÑU¥%¹Ùô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì¥˜€¡…¹UÀ¤µ½Ù•%¹MÑ…¬ ±…å½ÕÐœ°±…å½ÕÐ¹¥°€Ä¤ìõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘¥Í…‰±•õì……¹UÁô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹’â+žžï’â–Æˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÝ¥‘Ñ è€Èà€¨±…å½ÕÑU¥%¹Ø°¡•¥¡Ðè€Èà€¨±…å½ÕÑU¥%¹Øõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÉ½Õ¹‘•µ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È€‘í…¹UÀ€ü€Ñ•áÐµ‰±…¬¡½Ù•Èé‰œµ‰±…¬¼ÄÀœ€è€Ñ•áÐµ‰±…¬¼ÈÔÕÉÍ½Èµ‘•™…Õ±Ðõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ5½Ù•UÀÍ¥é”õìÄÐ€¨±…å½ÕÑU¥%¹Ùô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ìÍ•ÑÑ¥Ù•Q…ˆ ±…å½ÕÐœ¤ìÍ•Ñ1…å½ÕÑMÕ‰Q…ˆ …‘©ÕÍÐœ¤ìõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹’ö#–Æ¢ªÿšVÐˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìÝ¥‘Ñ è€Èà€¨±…å½ÕÑU¥%¹Ø°¡•¥¡Ðè€Èà€¨±…å½ÕÑU¥%¹Øõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰É½Õ¹‘•µ™Õ±°¡½Ù•Èé‰œµ‰±…¬¼ÄÀ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµ‰±…¬ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñM±¥‘•ÉÌÍ¥é”õìÄÐ€¨±…å½ÕÑU¥%¹Ùô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì¡…¹‘±••±•Ñ•1…å½ÕÐ ¤ìõôÑ¥Ñ±”ô‹–"«¦f“’ö#–Æ ˆÍÑå±”õíìÝ¥‘Ñ è€Èà€¨±…å½ÕÑU¥%¹Ø°¡•¥¡Ðè€Èà€¨±…å½ÕÑU¥%¹Øõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰É½Õ¹‘•µ™Õ±°¡½Ù•Èé‰œµ‰±…¬¼ÄÀ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµ‰±…¬ˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñQÉ…Í ÈÍ¥é”õìÄÐ€¨±…å½ÕÑU¥%¹Ùô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒš.ÿ’â7–"Ã–’[š†–Æ“–ÂÇžŸ–:šr³žjšZç–ò?žV¯–r£’ö#–Æ¢ê¯’â+¾ò3¢†3ž
ë–º3–£’â7¢º((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ …¡É½µ•1…å•È¤É•ÑÕÉ¸±…å½ÕÑ¡É½µ”ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸É•…Ñ•A½ÉÑ…° (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–’[¦v‹¦g–Æ“¾òw¦
’â¦‚¾ò#–B¯š:K¦‚¦v‹šfšVÓ¦‚žj’ö7žžï¢"žâ»šRû¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒžnÓš:—–Fó–>¯–B3’âšR¼Á…•½¹Ñ•¹ÑM¡¥™Ó¾ò3’â7šr¢Þ¦‚¦v‹¢ÖÃšV¾ò$€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè€‘íÁ…•%‘à€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¥õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€À°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘íÁÉ•Ù¥•Ý]õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘íÁÉ•Ù¥•Ý!õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½Éµ=É¥¥¸è€•¹Ñ•È•¹Ñ•Èœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸èµÙ¡É½µ”€ü€¡µÙ¡É½µ”¹±¥Ù”€ü€¹½¹”œ€è€ÑÉ…¹Í™½É´€ÈÈÁµÌÕ‰¥Œµ‰•é¥•È À¸È°À°À°Ä¤œ¤€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€é%¹‘•àè€ÄÀÀÀÀÀ€¬€¡±…å½ÕÐ¹è€üü€À¤€¨€È€¬€Ä°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–>[šÚ#¦ã–>[šf¦g’âšVÓ–Æ“šb¿¢Š¯š.š:'žj¾ò3¢3¢Š¬ÑÉ…¹Í™½É´ƒš>C–6¦;žjžnã¦Ã–r[–Æ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒšr'šf–g’â7šrš*+–º¢ºO–ë’úžj¦
–†+¦7žV¬ƒŠSŠPƒžV¯¦v‹’â+–ÂÇžVg¢F_’â–/–ÞËžÚO’â7–¶c–r£žj(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦ã–>[š†Ž¢ºO¦g’â–Æ“¢«–ÞÇ–ÂÇšb¿’â–/–B#š"C–Æ“¾ò#¢Þ–r[ž&¦
¦
+–B3’âš.o¾ò'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš.š:'šfšVÓ–Æ“’â¢ÖßšÚ#–’Ç¾ò3’â7šršr'šºc–öÇžVg–r£–"—’êëžj–r[–Æ“’â+Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´èl(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µÙ¡É½µ”€üÑÉ…¹Í±…Ñ•` ‘íµÙ¡É½µ”¹‘áõÁà¤‘í±¥™Ñ•‘¡É½µ”€ü€Í…±” ‘íµÙ¡É½µ”¹Íô¥€€è€œõ€€è€œœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í±…Ñ•h À¤œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ œ€œ¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥±±¡…¹”è€ÑÉ…¹Í™½É´œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰…­™…•Y¥Í¥‰¥±¥Ñäè€¡¥‘‘•¸œ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¢Ž‡¦v‹¦g–Æ“¾òw’ö#–Æ¢«–ÞÇžjš†Ž–Âë–¾ã¢Þžrš¶¦
–,ÝÉ…ÁÁ•Èƒ’âš¢‡’âš¢¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¢3’âS–B3š¢š:o¢F\‘…Ñ„µ±…å½ÕÐµÝÉ…ÁÁ•Ë¾ò=‘…Ñ„µ±…å½ÕÐµ¥ƒŠSŠP(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš.[¢žKžBšb¿žR ±½Í•ÍÐ m‘…Ñ„µ±…å½ÕÐµÝÉ…ÁÁ•Étœ¤ƒžj’â·–þžVÛšR¿¦î{žj¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–ÂG’ê¦g–§–/–Æ³šŸ–ÂÇšrš*O’â7–"ÃšR¿¦î{Žžâ»šRûšVÓžÖ–’ÇšV#Ž€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ±…å½ÕÐµÝÉ…ÁÁ•ÈõíÁ…•%‘áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ„µ±…å½ÕÐµ¥õí±…å½ÕÐ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè€‘í±1•™ÑõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½Àè€‘í±Q½ÁõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ è€‘í±ÝõÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè€‘í±¡õÁá€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ’ö#–Æ¢ö'’ê¢žK–ê›šf¾ò3¦g–Æ“’æ¢š’â¢Öß¢ö'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ’â7žÛ¦ã–>[š†Ž¢žKžBŽš2'¦"W–"_šržVg–r£–:–rÃ’â7¢Þ¢F_¢ö'Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¸¸¸ ¡±…å½ÕÐ¹Ðü¹É½Ðñð€À¤€„ôô€À(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´èÉ½Ñ…Ñ” ‘í±…å½ÕÐ¹Ð„¹É½Ñõ‘•œ¥€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í™½Éµ=É¥¥¸è€•¹Ñ•È•¹Ñ•Èœ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è¹Õ±°¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í±…å½ÕÑ¡É½µ•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡É½µ•1…å•È°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¥ô((€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ð½I•…Ð¹É…µ•¹Ðø(€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€ô¥ô((€€€€€€€€€€€€€€€€€€€€í™±½…Ñ¥¹%µ…•Ì¹µ…À ¡™%µœ°™%‘à¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€ñ±½…Ñ¥¹%µ…•½µÁ½¹•¹Ð(€€€€€€€€€€€€€€€€€€€€€€€­•äõí™%µœ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€¥µ…”õí™%µô(€€€€€€€€€€€€€€€€€€€€€€€µ½Ñ¥½¹É…µ”õì…™%µœ¹¥ÍY¥‘•¼€˜˜¡…Í½¹™¥ÕÉ•‘5½Ñ¥½¸¡™%µœ¤(€€€€€€€€€€€€€€€€€€€€€€€€€€ü™É…µ•½É%Ñ•´¡™%µœ°™%‘à°µ½Ñ¥½¹Q¥µ”¤(€€€€€€€€€€€€€€€€€€€€€€€€€€è¹Õ±±ô(€€€€€€€€€€€€€€€€€€€€€€€µ½Ñ¥½¹A¥­=¹±äõí…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸ô(€€€€€€€€€€€€€€€€€€€€€€€µ½Ñ¥½¹Q…É•Ñ±…Í õí…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€˜˜µ½Ñ¥½¹±…Í ü¹¥€ôôô™%µœ¹¥€üµ½Ñ¥½¹±…Í ¹¹½¹”€è¹Õ±±ô(€€€€€€€€€€€€€€€€€€€€€€€Ù¥‘•½A…ÕÍ•õí…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€˜˜€…µ½Ñ¥½¹A±…å¥¹ô(€€€€€€€€€€€€€€€€€€€€€€€¥ÍM•±•Ñ•õí…Ñ¥Ù•Q…ˆ€„ôô€µ½Ñ¥½¸œ€˜˜Í•±•Ñ•‘±½…Ñ¥¹%€ôôô™%µœ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€Í¡…Á•M•±•Ñ•õíÍ¡…Á•M•±%€ôôô™%µœ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€½¹M¡…Á•Q…Àõì¡à°ä¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ …¥Í%µM¡…Á• ¡™%µœ…Ì…¹ä¤¹¥µM¡…Á”¤¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥¹Í¥‘”€ô¡¥Ñ±½…Ñ¥¹M¡…Á”¡™%µœ°à°ä¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–ÞË¦ã’â·–>#¦î{–r£–r[š†#¢Ž‡¦vˆƒŠHƒ¦Ëž²³’ê3šº×¾òo¦î{–r£–r[š†#–’[¦vˆƒŠHƒ¦–n{ž²³’âšºÔ(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡¥¹Í¥‘”€˜˜Í•±•Ñ•‘±½…Ñ¥¹%€ôôô™%µœ¹¥¤Í•ÑM¡…Á•M•±%¡™%µœ¹¥¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€•±Í”¥˜€ …¥¹Í¥‘”¤Í•ÑM¡…Á•M•±%¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦î{–r£–ö‹ž.–’[¦v‹’ö¦
–r£–r[ž&¢ê¯’â+¾òk¦–n{Ž3¦ã’â·–r[ž&Ž7¾ò3¦ã–>[šr³¢ê¯žVg¢F\(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€¡…ÍÑ¥Ù•Õ¥‘•±¥¹•Ìõí…Ñ¥Ù•Õ¥‘•±¥¹•Ì¹±•¹Ñ €ø€Áô(€€€€€€€€€€€€€€€€€€€€€€€ÍÑ…­%¹‘•àõí™%‘áô(€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦ã–>[š†¦
’âžÖšRçžV¯–r£’â7šr¢Š¯¢Ž–"žj¦
’â–Æ(€€€€€€€€€€€€€€€€€€€€€€€¡É½µ•1…å•Èõí¡É½µ•1…å•Éô(€€€€€€€€€€€€€€€€€€€€€€€Ñ½Õ¡5½‘”õí…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€ü€Á…¸µàœ€è€¹½¹”ô(€€€€€€€€€€€€€€€€€€€€€€€¡¥‘•Q½½±‰…ÈõíÁ¥¹¡±½…Ñ¥¹%€ôôô™%µœ¹¥ñð€¡Í•±•Ñ¥½¹É…¥¹œ€˜˜Í•±•Ñ•‘±½…Ñ¥¹%€ôôô™%µœ¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€€€¡¥‘•¡É½µ”õì¡ÑÕ¹¥¹‘”ñðÍ•±•Ñ¥½¹É…¥¹œñðÁ¥¹¡±½…Ñ¥¹%€ôôô™%µœ¹¥¤€˜˜Í•±•Ñ•‘±½…Ñ¥¹%€ôôô™%µœ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€•ÍÑÕÉ•I•¹‘•É¥¹œõíÁ¥¹¡±½…Ñ¥¹%€ôôô™%µœ¹¥€˜˜€ „…™%µœ¹Í¡…Á”ñð™%µœ¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•¥ô(€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒš:K¦‚¦v‹š.[šnÏšf¾ò3–r[–Æ“¢š¢Þ¢F_¢«–ÞÇ¦
’â¦‚’â¢Ößžžï–.T(€€€€€€€€€€€€€€€€€€€€€€€‘É…M¡¥™Ðõí™±½…Ñ¥¹É…M¡¥™Ð¡™%µœ¥ô(€€€€€€€€€€€€€€€€€€€€€€€±ÕÑI•Ù¥Í¥½¸õí±ÕÑI•Ù¥Í¥½¹ô(€€€€€€€€€€€€€€€€€€€€€€€Ñ½½±‰…É‰½Ù”õì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒš^/¢ö'’æ/–ú3–’[š:—š†šr¢º+¦®c¾ò3¢šžR£¢ö'¦;žj¦®c–ê›–"“šZß’â/¦v‹¦
šr'šÊKšr'’ö7žö¸(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ…€ô€¡™%µœ¹É½Ñ…Ñ¥½¸€¨5…Ñ ¹A$¤€¼€ÄàÀì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¡…±™MÁ…¸€ô€¡™%µœ¹Ý¥‘Ñ €¨™%µœ¹Í…±”€¨5…Ñ ¹…‰Ì¡5…Ñ ¹Í¥¸¡É…¤¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¬™%µœ¹¡•¥¡Ð€¨™%µœ¹Í…±”€¨5…Ñ ¹…‰Ì¡5…Ñ ¹½Ì¡É…¤¤¤€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐä€ô™%µœ¹ä€¬™%µœ¹¡•¥¡Ð€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ½ÍÍ•‘1½Ý•ÉQ¡¥É€ôä€øÁÉ•Ù¥•Ý €¨€ È€¼€Ì¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ…‰½Ù•¥ÑÌ€ôä€´¡…±™MÁ…¸€´€ÔÈ€øô€Àì(€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸É½ÍÍ•‘1½Ý•ÉQ¡¥É€˜˜…‰½Ù•¥ÑÌì(€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€€µ…áQ•áÑ]¥‘Ñ õíÁÉ•Ù¥•Ý]ô(€€€€€€€€€€€€€€€€€€€€€€€…¹Ù…Í!•¥¡ÐõíÁÉ•Ù¥•Ý!ô(€€€€€€€€€€€€€€€€€€€€€€€¥ÍQ•áÑ‘¥Ñ¥¹œõí¥¹±¥¹•‘¥Ñ%€ôôô™%µœ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€½¹Q•áÑ‘¥Ñ¹õì ¤€ôøÍ•Ñ%¹±¥¹•‘¥Ñ%¡ÁÉ•Ø€ôø€¡ÁÉ•Ø€ôôô™%µœ¹¥€ü¹Õ±°€èÁÉ•Ø¤¥ô(€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–r[–Æ“’â+’â/šb¿š&šr'ž&§’îÛ–ÇžR£’âšŠwšâ–Z»¾ò#žŸž&ŽšZ–¶_Ž’ö#–Æ¦÷žº_¾ò'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–r[ž&š&7ž"³–ú_–"Ã’ö#–Æ’â+¦vˆ(€€€€€€€€€€€€€€€€€€€€€€€…¹1…å•É½Ý¸õíÍÑ…­A½Ì ™±½…Ðœ°™%µœ¹¥¤€ø€Áô(€€€€€€€€€€€€€€€€€€€€€€€…¹1…å•ÉUÀõíÍÑ…­A½Ì ™±½…Ðœ°™%µœ¹¥¤€ð±…å•ÉMÑ…¬¹±•¹Ñ €´€Åô(€€€€€€€€€€€€€€€€€€€€€€€½¹1…å•ÉÑ¥½¸õì¡…Ñ¥½¸¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡…Ñ¥½¸€ôôô€‘•±•Ñ”œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹™¥±Ñ•È¡˜€ôø˜¹¥€„ôô™%µœ¹¥¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡…Ñ¥½¸€ôôô€•‘¥Ðœ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–r[ž&¢"šZ–¶_¦÷¦Ë–B3’â–/Ž3žÞ£¢ò¿Ž7–"¦‚¾ò3–>«šb¿¢Ž‡¦v‹¦Vß–ú_’â7’âš¢Œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡™%µœ¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ‘¥Ñ¥¹Q•áÑ%¡™%µœ¹¥¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ%¹±¥¹•‘¥Ñ%¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑÑ¥Ù•Q…ˆ …‘©ÕÍÐœ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡…Ñ¥½¸€ôôô€½Áäœ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•ÕÁ±¥…Ñ•±½…Ñ¥¹œ¡™%µœ¹¥¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€µ½Ù•%¹MÑ…¬ ™±½…Ðœ°™%µœ¹¥°…Ñ¥½¸€ôôô€ÕÀœ€ü€Ä€è€´Ä¤ì(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€¥ÍMÝ…ÁQ…É•ÐõíÍÝ…Á=Ù•Èü¹­¥¹€ôôô€™±½…Ñ¥¹œœ€˜˜ÍÝ…Á=Ù•È¹¥€ôôô™%µœ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€¥ÍMÝ…ÁM½ÕÉ”õí™±½…ÑÉ…MÉŒ€„ôô¹Õ±°€˜˜™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ðü¹¥€ôôô™%µœ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€½¹MÝ…ÁQ½Õ¡MÑ…ÉÐõí¡…¹‘±•±½…ÑMÝ…ÁQ½Õ¡MÑ…ÉÐ¡™%µœ¥ô(€€€€€€€€€€€€€€€€€€€€€€€½¹MÝ…ÁQ½Õ¡5½Ù”õí¡…¹‘±•±½…ÑMÝ…ÁQ½Õ¡5½Ù•ô(€€€€€€€€€€€€€€€€€€€€€€€½¹MÝ…ÁQ½Õ¡¹õí¡…¹‘±•±½…ÑMÝ…ÁQ½Õ¡¹‘ô(€€€€€€€€€€€€€€€€€€€€€€€½¹M•±•Ðõì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ …™%µœ¹¥ÍY¥‘•¼¤¡½½Í•5½Ñ¥½¹Q…É•Ð¡™%µœ¹¥¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡™%µœ¹¥¤ìÍ•ÑM•±•Ñ•‘1…å½ÕÑ%¡¹Õ±°¤ìÍ•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡ÕÁ‘…Ñ•¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡¥Ñ•´€ôø¥Ñ•´¹¥€ôôô™%µœ¹¥€üì€¸¸¹¥Ñ•´°€¸¸¹ÕÁ‘…Ñ•ô€è¥Ñ•´¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€½¹•±•Ñ”õì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹™¥±Ñ•È¡¥Ñ•´€ôø¥Ñ•´¹¥€„ôô™%µœ¹¥¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Í•±•Ñ•‘±½…Ñ¥¹%€ôôô™%µœ¹¥¤Í•ÑM•±•Ñ•‘±½…Ñ¥¹%¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€Á…•Í½¹Ñ…¥¹•ÉI•˜õíÁ…•Í½¹Ñ…¥¹•ÉI•™ô(€€€€€€€€€€€€€€€€€€€€€€€…¹Ù…Í-I•˜õí­I•™ô(€€€€€€€€€€€€€€€€€€€€€€€…¹Ù…ÍM…±”õíÁ…•ÍM…±•ô(€€€€€€€€€€€€€€€€€€€€€€€½¹É…MÑ…ÉÐõì ¤€ôøíõô(€€€€€€€€€€€€€€€€€€€€€€€½¹É…5½Ù”õì¡É…Ý`°É…Ýd¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐìÍ¹…ÁÁ•‘`°Í¹…ÁÁ•‘d°™¥ÑM…±”°Õ¥‘•±¥¹•Ìô€ô…ÁÁ±åM¹…ÁÁ¥¹œ (€€€€€€€€€€€€€€€€€€€€€€€€€€€™%µœ¹¥°(€€€€€€€€€€€€€€€€€€€€€€€€€€€É…Ý`°(€€€€€€€€€€€€€€€€€€€€€€€€€€€É…Ýd°(€€€€€€€€€€€€€€€€€€€€€€€€€€€™%µœ¹Ý¥‘Ñ °(€€€€€€€€€€€€€€€€€€€€€€€€€€€™%µœ¹¡•¥¡Ð°(€€€€€€€€€€€€€€€€€€€€€€€€€€€™%µœ¹Í…±”°(€€€€€€€€€€€€€€€€€€€€€€€€€€€Õ¹‘•™¥¹•°(€€€€€€€€€€€€€€€€€€€€€€€€€€€™%µœ¹É½Ñ…Ñ¥½¸ñð€À°(€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€ÅÕ•Õ•%¹Ñ•É…Ñ¥½¸  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡Õ¥‘•±¥¹•Ì¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡¥Ñ•´€ôø¥Ñ•´¹¥€ôôô™%µœ¹¥(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üì€¸¸¹¥Ñ•´°àèÍ¹…ÁÁ•‘`°äèÍ¹…ÁÁ•‘d°€¸¸¸¡™¥ÑM…±”€üìÍ…±”è™¥ÑM…±”ô€èíô¤ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è¥Ñ•´¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€½¹É…¹õì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€™±ÕÍ¡%¹Ñ•É…Ñ¥½¹9½Ü ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤ì(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€½¹M…±•MÑ…ÉÐõì ¤€ôøíõô(€€€€€€€€€€€€€€€€€€€€€€€½¹M…±•5½Ù”õì (€€€€€€€€€€€€€€€€€€€€€€€€€¹•Ý`°(€€€€€€€€€€€€€€€€€€€€€€€€€¹•Ýd°(€€€€€€€€€€€€€€€€€€€€€€€€€¹•ÝM…±”°(€€€€€€€€€€€€€€€€€€€€€€€€€½É¹•È°(€€€€€€€€€€€€€€€€€€€€€€€€€Á¥Ù½Ñ½¹Ñ…¥¹•É`°(€€€€€€€€€€€€€€€€€€€€€€€€€Á¥Ù½Ñ½¹Ñ…¥¹•Éd°(€€€€€€€€€€€€€€€€€€€€€€€€€-}à°(€€€€€€€€€€€€€€€€€€€€€€€€€-}ä°(€€€€€€€€€€€€€€€€€€€€€€€€€½ÁÁ½Í¥Ñ•1½…±`°(€€€€€€€€€€€€€€€€€€€€€€€€€½ÁÁ½Í¥Ñ•1½…±d(€€€€€€€€€€€€€€€€€€€€€€€€¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€±•Ð™¥¹…±M…±”€ô¹•ÝM…±”ì(€€€€€€€€€€€€€€€€€€€€€€€€€±•Ð™¥¹…±Õ¥‘•±¥¹•Ìè±¥¹µ•¹ÑÕ¥‘•±¥¹•mt€ômtì((€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€½É¹•È€˜˜(€€€€€€€€€€€€€€€€€€€€€€€€€€€Á¥Ù½Ñ½¹Ñ…¥¹•É`€„ôôÕ¹‘•™¥¹•€˜˜(€€€€€€€€€€€€€€€€€€€€€€€€€€€Á¥Ù½Ñ½¹Ñ…¥¹•Éd€„ôôÕ¹‘•™¥¹•€˜˜(€€€€€€€€€€€€€€€€€€€€€€€€€€€-}à€„ôôÕ¹‘•™¥¹•€˜˜(€€€€€€€€€€€€€€€€€€€€€€€€€€€-}ä€„ôôÕ¹‘•™¥¹•€˜˜(€€€€€€€€€€€€€€€€€€€€€€€€€€€½ÁÁ½Í¥Ñ•1½…±`€„ôôÕ¹‘•™¥¹•€˜˜(€€€€€€€€€€€€€€€€€€€€€€€€€€€½ÁÁ½Í¥Ñ•1½…±d€„ôôÕ¹‘•™¥¹•(€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÁ…•I•ÑÌ€ôÁ…•I•ÑÍ9•…È (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€•Ñ±±A…•I•ÑÌ ¤°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™%µœ¹à€¬™%µœ¹Ý¥‘Ñ €¼€È°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐM9A}Q!IM!=1€ô€Äì€¼¼ƒ–’[š†–¾›¦jo¢ÊóžÞkš&7–Bã¦f¾òo––ºç¢¢Çš²‡–?žÒƒ¢ª“–Þ¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼U¹Í¹…ÁÁ•Á½Í¥Ñ¥½¸½˜Ñ¡”‘É…•½É¹•È(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ…Ý½É¹•É`€ôÁ¥Ù½Ñ½¹Ñ…¥¹•É`€¬¹•ÝM…±”€¨-}àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ…Ý½É¹•Éd€ôÁ¥Ù½Ñ½¹Ñ…¥¹•Éd€¬¹•ÝM…±”€¨-}äì((€€€€€€€€€€€€€€€€€€€€€€€€€€€±•Ðµ¥¹¥™™`€ôM9A}Q!IM!=1ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€±•Ð‰•ÍÑM…±•`€ô¹•ÝM…±”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€±•Ð‰•ÍÑÕ¥‘•±¥¹•`è¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€±•Ð¥ÍA…•	½Õ¹‘…ÉåM¹…Á`€ô™…±Í”ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€±•Ðµ¥¹¥™™d€ôM9A}Q!IM!=1ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€±•Ð‰•ÍÑM…±•d€ô¹•ÝM…±”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€±•Ð‰•ÍÑÕ¥‘•±¥¹•dè¹Õµ‰•Èð¹Õ±°€ô¹Õ±°ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€±•Ð¥ÍA…•	½Õ¹‘…ÉåM¹…Ád€ô™…±Í”ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡•¹…‰±•M¹…ÁÁ¥¹œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á…•I•ÑÌ¹™½É… ¡Á…•I•Ð€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼Y•ÉÑ¥…°Õ¥‘•±¥¹•Ì€¡±•™Ð°É¥¡Ð¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼1•™Ð•‘”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥™™1•™Ð€ôÉ…Ý½É¹•É`€´Á…•I•Ð¹±•™Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘¥™™1•™Ð¤€ðM9A}Q!IM!=1€˜˜5…Ñ ¹…‰Ì¡‘¥™™1•™Ð¤€ð5…Ñ ¹…‰Ì¡µ¥¹¥™™`¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡-}à¤€ø€Å”´Ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÌ€ô€¡Á…•I•Ð¹±•™Ð€´Á¥Ù½Ñ½¹Ñ…¥¹•É`¤€¼-}àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Ì€ø€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¹¥™™`€ô‘¥™™1•™Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑM…±•`€ôÌì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑÕ¥‘•±¥¹•`€ôÁ…•I•Ð¹±•™Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍA…•	½Õ¹‘…ÉåM¹…Á`€ôÑÉÕ”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼I¥¡Ð•‘”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥™™I¥¡Ð€ôÉ…Ý½É¹•É`€´Á…•I•Ð¹É¥¡Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘¥™™I¥¡Ð¤€ðM9A}Q!IM!=1€˜˜5…Ñ ¹…‰Ì¡‘¥™™I¥¡Ð¤€ð5…Ñ ¹…‰Ì¡µ¥¹¥™™`¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡-}à¤€ø€Å”´Ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÌ€ô€¡Á…•I•Ð¹É¥¡Ð€´Á¥Ù½Ñ½¹Ñ…¥¹•É`¤€¼-}àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Ì€ø€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¹¥™™`€ô‘¥™™I¥¡Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑM…±•`€ôÌì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑÕ¥‘•±¥¹•`€ôÁ…•I•Ð¹É¥¡Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍA…•	½Õ¹‘…ÉåM¹…Á`€ôÑÉÕ”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼!½É¥é½¹Ñ…°Õ¥‘•±¥¹•Ì€¡Ñ½À°‰½ÑÑ½´¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼Q½À•‘”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥™™Q½À€ôÉ…Ý½É¹•Éd€´Á…•I•Ð¹Ñ½Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘¥™™Q½À¤€ðM9A}Q!IM!=1€˜˜5…Ñ ¹…‰Ì¡‘¥™™Q½À¤€ð5…Ñ ¹…‰Ì¡µ¥¹¥™™d¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡-}ä¤€ø€Å”´Ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÌ€ô€¡Á…•I•Ð¹Ñ½À€´Á¥Ù½Ñ½¹Ñ…¥¹•Éd¤€¼-}äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Ì€ø€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¹¥™™d€ô‘¥™™Q½Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑM…±•d€ôÌì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑÕ¥‘•±¥¹•d€ôÁ…•I•Ð¹Ñ½Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍA…•	½Õ¹‘…ÉåM¹…Ád€ôÑÉÕ”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼	½ÑÑ½´•‘”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥™™	½ÑÑ½´€ôÉ…Ý½É¹•Éd€´Á…•I•Ð¹‰½ÑÑ½´ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘¥™™	½ÑÑ½´¤€ðM9A}Q!IM!=1€˜˜5…Ñ ¹…‰Ì¡‘¥™™	½ÑÑ½´¤€ð5…Ñ ¹…‰Ì¡µ¥¹¥™™d¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡-}ä¤€ø€Å”´Ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÌ€ô€¡Á…•I•Ð¹‰½ÑÑ½´€´Á¥Ù½Ñ½¹Ñ…¥¹•Éd¤€¼-}äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Ì€ø€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¹¥™™d€ô‘¥™™	½ÑÑ½´ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑM…±•d€ôÌì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑÕ¥‘•±¥¹•d€ôÁ…•I•Ð¹‰½ÑÑ½´ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍA…•	½Õ¹‘…ÉåM¹…Ád€ôÑÉÕ”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô€¼¼¹½˜™¥ÉÍÐ•¹…‰±•M¹…ÁÁ¥¹œ((€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼%µ…”µÑ¼µ¥µ…”•‘”Í¹…ÁÁ¥¹œÝ¡•¸Í…±¥¹œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡•¹…‰±•M¹…ÁÁ¥¹œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™±½…Ñ¥¹%µ…•Ì¹™½É… ¡½Ñ¡•È€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡½Ñ¡•È¹¥€ôôô™%µœ¹¥¤É•ÑÕÉ¸ì€¼¼M­¥ÀÍ•±˜((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ñ¡•É\€ô½Ñ¡•È¹Ý¥‘Ñ €¨½Ñ¡•È¹Í…±”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ñ¡•É €ô½Ñ¡•È¹¡•¥¡Ð€¨½Ñ¡•È¹Í…±”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ñ¡•É•¹Ñ•É`€ô½Ñ¡•È¹à€¬½Ñ¡•È¹Ý¥‘Ñ €¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ñ¡•É•¹Ñ•Éd€ô½Ñ¡•È¹ä€¬½Ñ¡•È¹¡•¥¡Ð€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ñ¡•É1•™Ð€ô½Ñ¡•É•¹Ñ•É`€´½Ñ¡•É\€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ñ¡•ÉI¥¡Ð€ô½Ñ¡•É•¹Ñ•É`€¬½Ñ¡•É\€¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ñ¡•ÉQ½À€ô½Ñ¡•É•¹Ñ•Éd€´½Ñ¡•É €¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½Ñ¡•É	½ÑÑ½´€ô½Ñ¡•É•¹Ñ•Éd€¬½Ñ¡•É €¼€Èì((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼¡•¬Ù•ÉÑ¥…°…±¥¹µ•¹ÐÝ¥Ñ ½Ñ¡•É1•™Ð(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼%˜ÕÉÉ•¹Ð½É¹•È¥Ì€ÑÈœ½È€‰Èœ€¡I¥¡Ð•‘”¤°Ý”…±¥¸½ÕÈI¥¡Ð•‘”Ñ¼½Ñ¡•É1•™Ð¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼Q¼‰±••°Ý”Ý…¹ÐÑ¼…±¥¸Ñ¼½Ñ¡•É1•™Ð€¬€Ä¸=Ñ¡•ÉÝ¥Í”°¹¼‰±••€¡©ÕÍÐ½Ñ¡•É1•™Ð¤¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÑ…É•Ñ1•™Ð€ô€¡½É¹•È€ôôô€ÑÈœñð½É¹•È€ôôô€‰Èœ¤€ü€¡½Ñ¡•É1•™Ð€¬€Ä¤€è½Ñ¡•É1•™Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥™™1•™Ð€ôÉ…Ý½É¹•É`€´Ñ…É•Ñ1•™Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘¥™™1•™Ð¤€ðM9A}Q!IM!=1€˜˜5…Ñ ¹…‰Ì¡‘¥™™1•™Ð¤€ð5…Ñ ¹…‰Ì¡µ¥¹¥™™`¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡-}à¤€ø€Å”´Ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÌ€ô€¡Ñ…É•Ñ1•™Ð€´Á¥Ù½Ñ½¹Ñ…¥¹•É`¤€¼-}àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Ì€ø€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¹¥™™`€ô‘¥™™1•™Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑM…±•`€ôÌì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑÕ¥‘•±¥¹•`€ô½Ñ¡•É1•™Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍA…•	½Õ¹‘…ÉåM¹…Á`€ô™…±Í”ì€¼¼ÁÉ•™•È¥µ…”Í¹…ÁÁ¥¹œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼¡•¬Ù•ÉÑ¥…°…±¥¹µ•¹ÐÝ¥Ñ ½Ñ¡•ÉI¥¡Ð(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼%˜ÕÉÉ•¹Ð½É¹•È¥Ì€Ñ°œ½È€‰°œ€¡1•™Ð•‘”¤°Ý”…±¥¸½ÕÈ1•™Ð•‘”Ñ¼½Ñ¡•ÉI¥¡Ð¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼Q¼‰±••°Ý”Ý…¹ÐÑ¼…±¥¸Ñ¼½Ñ¡•ÉI¥¡Ð€´€Ä¸=Ñ¡•ÉÝ¥Í”°¹¼‰±••€¡©ÕÍÐ½Ñ¡•ÉI¥¡Ð¤¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÑ…É•ÑI¥¡Ð€ô€¡½É¹•È€ôôô€Ñ°œñð½É¹•È€ôôô€‰°œ¤€ü€¡½Ñ¡•ÉI¥¡Ð€´€Ä¤€è½Ñ¡•ÉI¥¡Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥™™I¥¡Ð€ôÉ…Ý½É¹•É`€´Ñ…É•ÑI¥¡Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘¥™™I¥¡Ð¤€ðM9A}Q!IM!=1€˜˜5…Ñ ¹…‰Ì¡‘¥™™I¥¡Ð¤€ð5…Ñ ¹…‰Ì¡µ¥¹¥™™`¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡-}à¤€ø€Å”´Ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÌ€ô€¡Ñ…É•ÑI¥¡Ð€´Á¥Ù½Ñ½¹Ñ…¥¹•É`¤€¼-}àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Ì€ø€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¹¥™™`€ô‘¥™™I¥¡Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑM…±•`€ôÌì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑÕ¥‘•±¥¹•`€ô½Ñ¡•ÉI¥¡Ðì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍA…•	½Õ¹‘…ÉåM¹…Á`€ô™…±Í”ì€¼¼ÁÉ•™•È¥µ…”Í¹…ÁÁ¥¹œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼¡•¬¡½É¥é½¹Ñ…°…±¥¹µ•¹ÐÝ¥Ñ ½Ñ¡•ÉQ½À(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼%˜ÕÉÉ•¹Ð½É¹•È¥Ì€‰°œ½È€‰Èœ€¡	½ÑÑ½´•‘”¤°Ý”…±¥¸½ÕÈ	½ÑÑ½´•‘”Ñ¼½Ñ¡•ÉQ½À¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼Q¼‰±••°Ý”Ý…¹ÐÑ¼…±¥¸Ñ¼½Ñ¡•ÉQ½À€¬€Ä¸=Ñ¡•ÉÝ¥Í”°¹¼‰±••€¡©ÕÍÐ½Ñ¡•ÉQ½À¤¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÑ…É•ÑQ½À€ô€¡½É¹•È€ôôô€‰°œñð½É¹•È€ôôô€‰Èœ¤€ü€¡½Ñ¡•ÉQ½À€¬€Ä¤€è½Ñ¡•ÉQ½Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥™™Q½À€ôÉ…Ý½É¹•Éd€´Ñ…É•ÑQ½Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘¥™™Q½À¤€ðM9A}Q!IM!=1€˜˜5…Ñ ¹…‰Ì¡‘¥™™Q½À¤€ð5…Ñ ¹…‰Ì¡µ¥¹¥™™d¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡-}ä¤€ø€Å”´Ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÌ€ô€¡Ñ…É•ÑQ½À€´Á¥Ù½Ñ½¹Ñ…¥¹•Éd¤€¼-}äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Ì€ø€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¹¥™™d€ô‘¥™™Q½Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑM…±•d€ôÌì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑÕ¥‘•±¥¹•d€ô½Ñ¡•ÉQ½Àì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍA…•	½Õ¹‘…ÉåM¹…Ád€ô™…±Í”ì€¼¼ÁÉ•™•È¥µ…”Í¹…ÁÁ¥¹œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼¡•¬¡½É¥é½¹Ñ…°…±¥¹µ•¹ÐÝ¥Ñ ½Ñ¡•É	½ÑÑ½´(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼%˜ÕÉÉ•¹Ð½É¹•È¥Ì€Ñ°œ½È€ÑÈœ€¡Q½À•‘”¤°Ý”…±¥¸½ÕÈQ½À•‘”Ñ¼½Ñ¡•É	½ÑÑ½´¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼Q¼‰±••°Ý”Ý…¹ÐÑ¼…±¥¸Ñ¼½Ñ¡•É	½ÑÑ½´€´€Ä¸=Ñ¡•ÉÝ¥Í”°¹¼‰±••€¡©ÕÍÐ½Ñ¡•É	½ÑÑ½´¤¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÑ…É•Ñ	½ÑÑ½´€ô€¡½É¹•È€ôôô€Ñ°œñð½É¹•È€ôôô€ÑÈœ¤€ü€¡½Ñ¡•É	½ÑÑ½´€´€Ä¤€è½Ñ¡•É	½ÑÑ½´ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ‘¥™™	½ÑÑ½´€ôÉ…Ý½É¹•Éd€´Ñ…É•Ñ	½ÑÑ½´ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡‘¥™™	½ÑÑ½´¤€ðM9A}Q!IM!=1€˜˜5…Ñ ¹…‰Ì¡‘¥™™	½ÑÑ½´¤€ð5…Ñ ¹…‰Ì¡µ¥¹¥™™d¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡-}ä¤€ø€Å”´Ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÌ€ô€¡Ñ…É•Ñ	½ÑÑ½´€´Á¥Ù½Ñ½¹Ñ…¥¹•Éd¤€¼-}äì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Ì€ø€À¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¹¥™™d€ô‘¥™™	½ÑÑ½´ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑM…±•d€ôÌì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰•ÍÑÕ¥‘•±¥¹•d€ô½Ñ¡•É	½ÑÑ½´ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍA…•	½Õ¹‘…ÉåM¹…Ád€ô™…±Í”ì€¼¼ÁÉ•™•È¥µ…”Í¹…ÁÁ¥¹œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô€¼¼¹½˜¥˜€¡•¹…‰±•M¹…ÁÁ¥¹œ¤((€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼¡½½Í”Ñ¡”ÍÑÉ½¹•ÈÍ¹…À€¡Ñ¡”½¹”Ý¥Ñ Íµ…±±•È‘¥™˜¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ¹…Á`€ô‰•ÍÑÕ¥‘•±¥¹•`€„ôô¹Õ±°ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ¹…Ád€ô‰•ÍÑÕ¥‘•±¥¹•d€„ôô¹Õ±°ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Í¹…Á`€˜˜Í¹…Ád¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–§–/¢îã¦÷–Bã¦f–ú_–"Ãšf–>[Ž3š¾S¢ò–’ŸŽ7žj–7ž:¾ò#¾òw¢š¢N/¾ò3¢3’â7šb¿žâ»¦Ë–:ï¾ò'Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–r[–Æ“š†žj¦Vß–¾³š¾S¢Þ¦‚¦v‹¦k–âãšr–Þ»¦nÛ¦î{–æøÁã¾ò#–2¿–—šf–>[šVÓ¦ƒš"C¾ò'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–>[–Â?žj¦
–/ž¶'šZóžVg’âšŠwžf÷žâ¯–r£–>›’â¦
+¾òo–>[–’Ÿžj–>«šb¿–’k¢N/–ë–:ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦nÛ¦î{–æøÁã¾ò3¢3¦‚¦v‹šr³’ú–ÂÇšr¢Žš:'¢Ú–ëžj¦£–"¾ò3š&’î—–no¦
+¦÷’â7¦rËžf÷Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦g’æšb¿Ž3žRÇ–’[¢3–ŸšÊKžâ¯ŽžRÇ–Ÿ¢3–’[šr'žâ¯Ž7žjš"C–n€ƒŠSŠPƒ’î—–&7šb¿žr,(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–N«’â¢îãš¾S¢ò¢þG–ÂÇ¢÷¢ªÃžj¾ò3šZç–BG’â7–B3žÖCšzs–ÂÇ’â7–B3Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡‰•ÍÑM…±•`€øô‰•ÍÑM…±•d¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥¹…±M…±”€ô‰•ÍÑM…±•`ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥¹…±Õ¥‘•±¥¹•Ì€ômìÑåÁ”è€Ù•ÉÑ¥…°œ°½½Éè‰•ÍÑÕ¥‘•±¥¹•`„õtì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥¹…±M…±”€ô‰•ÍÑM…±•dì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥¹…±Õ¥‘•±¥¹•Ì€ômìÑåÁ”è€¡½É¥é½¹Ñ…°œ°½½Éè‰•ÍÑÕ¥‘•±¥¹•d„õtì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–7–’k¢N/–ë–:ï–6+–/–?žÒƒŽ–&o––÷¢Êó¦ö+šf¦
+žÞšr¢B÷–r£¦v{šVÓšVãžj–?žÒƒ’â+¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒš*_¦.ã¦öKšrš*+šr–’[¦v‹¦
’â–"_šÞßš"C–6+¦?šb;¾ò3žr/¢Öß’ú–ÂÇšb¿’âšŠw¦®»žÖËžf÷¦
+Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦‚¦v‹šr³¢ê¯šr¢Žš:'¢Ú–ëžj¦£–"¾ò3š&’î—–’k¦g–6+–/–?žÒƒ–º3–£žr/’â7–"Ã¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–6ï¢÷’þw¢¶'–no¦
+¦÷’â7¦rËžf÷Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ’â7–7–’k¢N/–ë–:ï¾òk’öÿžR£¢¢šžjšb¿Ž3–&o––÷¢Êó¦ö+Ž7¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–’k¢N/žj¦
’â¦î{–r£–>Ï¦
+¾ò?’â/¦v‹šržr/–ú_–ë’ú–ã–ë–:ïŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô•±Í”¥˜€¡Í¹…Á`¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥¹…±M…±”€ô‰•ÍÑM…±•`ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥¹…±Õ¥‘•±¥¹•Ì€ômìÑåÁ”è€Ù•ÉÑ¥…°œ°½½Éè‰•ÍÑÕ¥‘•±¥¹•`„õtì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô•±Í”¥˜€¡Í¹…Ád¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥¹…±M…±”€ô‰•ÍÑM…±•dì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥¹…±Õ¥‘•±¥¹•Ì€ômìÑåÁ”è€¡½É¥é½¹Ñ…°œ°½½Éè‰•ÍÑÕ¥‘•±¥¹•d„õtì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼…±Õ±…Ñ”Ñ¡”™¥¹…°€¡¹•Ý`°¹•Ýd¤‰…Í•½¸™¥¹…±M…±”Ñ¼­••ÀÁ¥Ù½Ð™¥á•(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐH€ô€¡™%µœ¹É½Ñ…Ñ¥½¸€¨5…Ñ ¹A$¤€¼€ÄàÀì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½ÁÁ½Í¥Ñ•=™™Í•ÑI½Ñ`€ô½ÁÁ½Í¥Ñ•1½…±`€¨5…Ñ ¹½Ì¡H¤€´½ÁÁ½Í¥Ñ•1½…±d€¨5…Ñ ¹Í¥¸¡H¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ½ÁÁ½Í¥Ñ•=™™Í•ÑI½Ñd€ô½ÁÁ½Í¥Ñ•1½…±`€¨5…Ñ ¹Í¥¸¡H¤€¬½ÁÁ½Í¥Ñ•1½…±d€¨5…Ñ ¹½Ì¡H¤ì((€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•Ýà€ôÁ¥Ù½Ñ½¹Ñ…¥¹•É`€´™¥¹…±M…±”€¨½ÁÁ½Í¥Ñ•=™™Í•ÑI½Ñ`ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•Ýä€ôÁ¥Ù½Ñ½¹Ñ…¥¹•Éd€´™¥¹…±M…±”€¨½ÁÁ½Í¥Ñ•=™™Í•ÑI½Ñdì((€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ™¥¹…±`€ô¹•Ýà€´™%µœ¹Ý¥‘Ñ €¼€Èì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ™¥¹…±d€ô¹•Ýä€´™%µœ¹¡•¥¡Ð€¼€Èì((€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•áÑÕ¥‘•±¥¹•Ì€ô‘•‘ÕÁ•Õ¥‘•±¥¹•Ì¡™¥¹…±Õ¥‘•±¥¹•Ì°™%µœ¹à€¬™%µœ¹Ý¥‘Ñ €¼€È¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÅÕ•Õ•%¹Ñ•É…Ñ¥½¸  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡¹•áÑÕ¥‘•±¥¹•Ì¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡¥Ñ•´€ôø¥Ñ•´¹¥€ôôô™%µœ¹¥(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üì€¸¸¹¥Ñ•´°àè™¥¹…±`°äè™¥¹…±d°Í…±”è™¥¹…±M…±”ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è¥Ñ•´¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÅÕ•Õ•%¹Ñ•É…Ñ¥½¸  ¤€ôøÍ•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡¥Ñ•´€ôø¥Ñ•´¹¥€ôôô™%µœ¹¥(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üì€¸¸¹¥Ñ•´°àè¹•Ý`°äè¹•Ýd°Í…±”è¹•ÝM…±”ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è¥Ñ•´¤¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€½¹M…±•¹õì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€™±ÕÍ¡%¹Ñ•É…Ñ¥½¹9½Ü ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑÑ¥Ù•Õ¥‘•±¥¹•Ì¡mt¤ì(€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€¤¥ô((€€€€€€€€€€€€€€€€€€€ì¼¨ƒžV¯ž¶šb¿ž6£ž®/–BG¦?–r[–Æ“¾òk’âž¶’â–,Á…Ñ£¾ò3–nƒš¶“–>¿’î—¦ã–>[Ž–ú§–:Ž(€€€€€€€€€€€€€€€€€€€€€€€ƒ–Ë–¶c¢"¢òã–ë¾òošVÓ–òÔMYƒš¦¯¢Þ£–£¦£¦‚¦v‹¾ò3ž¶žV¯’â7šr–r£¦‚žâ¯¢Š¯š"«šZßŽ€¨½ô(€€€€€€€€€€€€€€€€€€€í‰ÉÕÍ¡MÑÉ½­•Ì¹µ…À¡Ì€ôø€ (€€€€€€€€€€€€€€€€€€€€€€ñÍÙœ­•äõíÌ¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´ÀÑ½À´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”½Ù•É™±½ÜµÙ¥Í¥‰±”ˆ(€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ õíÁ…•Ì¹±•¹Ñ €¨ÁÉ•Ù¥•Ý\€¬5…Ñ ¹µ…à À°Á…•Ì¹±•¹Ñ €´€Ä¥ô¡•¥¡ÐõíÁÉ•Ù¥•Ý!ô(€€€€€€€€€€€€€€€€€€€€€€€Ù¥•Ý	½àõí€À€À€‘íÁ…•Ì¹±•¹Ñ €¨ÁÉ•Ù¥•Ý\€¬5…Ñ ¹µ…à À°Á…•Ì¹±•¹Ñ €´€Ä¥ô€‘íÁÉ•Ù¥•Ý!õô(€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìé%¹‘•àè€ØÀ€¬Ì¹è€¨€Èõôø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘•™Ìø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ™¥±Ñ•È¥õí±…ÍÍ¥ŒµÉ…å½¸´‘íÌ¹¥‘õôàôˆ´ÈÀ”ˆäôˆ´ÈÀ”ˆÝ¥‘Ñ ôˆÄÐÀ”ˆ¡•¥¡ÐôˆÄÐÀ”ˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ™•QÕÉ‰Õ±•¹”ÑåÁ”ô‰™É…Ñ…±9½¥Í”ˆ‰…Í•É•ÅÕ•¹äôˆÀ¸àÔˆ¹Õµ=Ñ…Ù•ÌôˆÈˆÍ••ôˆàˆÉ•ÍÕ±Ðô‰¹½¥Í”ˆ€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ™•¥ÍÁ±…•µ•¹Ñ5…À¥¸ô‰M½ÕÉ•É…Á¡¥Œˆ¥¸Èô‰¹½¥Í”ˆÍ…±”ôˆÀ¸ÔÔˆ€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½™¥±Ñ•Èø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ™¥±Ñ•È¥õí±…ÍÍ¥Œµ¡¥¡±¥¡Ð´‘íÌ¹¥‘õôàôˆ´ÌÀ”ˆäôˆ´ÌÀ”ˆÝ¥‘Ñ ôˆÄØÀ”ˆ¡•¥¡ÐôˆÄØÀ”ˆøñ™•…ÕÍÍ¥…¹	±ÕÈÍÑ‘•Ù¥…Ñ¥½¸ôˆÄ¸ÄÔˆ€¼øð½™¥±Ñ•Èø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ™¥±Ñ•È¥õí±…ÍÍ¥ŒµÍ½™Ð´‘íÌ¹¥‘õôàôˆ´ÌÀ”ˆäôˆ´ÌÀ”ˆÝ¥‘Ñ ôˆÄØÀ”ˆ¡•¥¡ÐôˆÄØÀ”ˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ™•…ÕÍÍ¥…¹	±ÕÈÍÑ‘•Ù¥…Ñ¥½¸õí5…Ñ ¹µ…à À°€ ÄÀÀ€´Ì¹¡…É‘¹•ÍÌ¤€¼€ÄÀÀ€¨Ì¹Ý¥‘Ñ €¨€¸ÄÈ¥ô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½™¥±Ñ•Èø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘•™Ìø(€€€€€€€€€€€€€€€€€€€€€€€€ñÁ…Ñ ‘…Ñ„µ‰ÉÕÍ µ¥õíÌ¹¥‘ôõí‰ÉÕÍ¡A…Ñ ¡Ì¥ô™¥±°ô‰¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑÉ½­”õíÌ¹½±½ÉôÍÑÉ½­•]¥‘Ñ õíÌ¹Ý¥‘Ñ¡ôÍÑÉ½­•1¥¹•…Àô‰É½Õ¹ˆÍÑÉ½­•1¥¹•©½¥¸ô‰É½Õ¹ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑÉ½­•…Í¡…ÉÉ…äõíÌ¹­¥¹€ôôô€‘…Í œ€ü€‘í5…Ñ ¹µ…à Ð°Ì¹Ý¥‘Ñ €¨€Ä¸Ð¥ô€‘í5…Ñ ¹µ…à Ì°Ì¹Ý¥‘Ñ ¥õ€€èÕ¹‘•™¥¹•‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€½Á…¥ÑäõíÌ¹­¥¹€ôôô€¡¥¡±¥¡Ðœ€ü€¸ÌØ€èÌ¹­¥¹€ôôô€Á•¹¥°œ€ü€¸àÈ€è€Åô(€€€€€€€€€€€€€€€€€€€€€€€€€™¥±Ñ•ÈõíÌ¹­¥¹€ôôô€É…å½¸œ€üÕÉ° ±…ÍÍ¥ŒµÉ…å½¸´‘íÌ¹¥‘ô¥€€èÌ¹­¥¹€ôôô€¡¥¡±¥¡Ðœ€üÕÉ° ±…ÍÍ¥Œµ¡¥¡±¥¡Ð´‘íÌ¹¥‘ô¥€€èÌ¹­¥¹€ôôô€¹½Éµ…°œ€˜˜Ì¹¡…É‘¹•ÍÌ€ð€äØ€üÕÉ° ±…ÍÍ¥ŒµÍ½™Ð´‘íÌ¹¥‘ô¥€€èÕ¹‘•™¥¹•‘ô(€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€ð½ÍÙœø(€€€€€€€€€€€€€€€€€€€€¤¥ô((€€€€€€€€€€€€€€€€€€€íÍ•±•Ñ•‘	ÉÕÍ¡%€˜˜€  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍÑÉ½­”€ô‰ÉÕÍ¡MÑÉ½­•Ì¹™¥¹¡Ì€ôøÌ¹¥€ôôôÍ•±•Ñ•‘	ÉÕÍ¡%¤ì(€€€€€€€€€€€€€€€€€€€€€¥˜€ …ÍÑÉ½­”¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐˆ€ô‰ÉÕÍ¡	½Õ¹‘Ì¡ÍÑÉ½­”¤ì(€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø‘…Ñ„µ‰ÉÕÍ µ¥õíÍÑÉ½­”¹¥‘ô±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”‰½É‘•È‰½É‘•Èµ‘…Í¡•‰½É‘•ÈµÝ¡¥Ñ”¼äÔˆ(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì±•™Ðèˆ¹à°Ñ½Àèˆ¹ä°Ý¥‘Ñ èˆ¹Ü°¡•¥¡Ðèˆ¹ °é%¹‘•àè€ÄÀÀÀÔÀ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€‰½áM¡…‘½Üè€œÀ€ÅÁà€ÍÁàÉ‰„ À°À°À°¸ÐÈ¤œõôø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´Ä¼ÈÑ½Àµ™Õ±°µÐ´È€µÑÉ…¹Í±…Ñ”µà´Ä¼È ´äÁà´ÄÉ½Õ¹‘•µ™Õ±°‰œµÝ¡¥Ñ”Ñ•áÐµ‰±…¬™±•à¥Ñ•µÌµ•¹Ñ•ÈÍ¡…‘½Üµ±œÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ…ÕÑ¼ˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰Ü´à ´àÉ½Õ¹‘•µ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈˆÑ¥Ñ±”ô‹’â/žžï’â–Æˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡Ø€ôøØ¹µ…À¡à€ôøà¹¥ôôõÍÑÉ½­”¹¥€üì¸¸¹à±èé5…Ñ ¹µ…à À±à¹è´Ä¥ô€èà¤¥ôøñ5½Ù•½Ý¸Í¥é”õìÄÑô¼øð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰Ü´à ´àÉ½Õ¹‘•µ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈˆÑ¥Ñ±”ô‹’â+žžï’â–Æˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡Ø€ôøØ¹µ…À¡à€ôøà¹¥ôôõÍÑÉ½­”¹¥€üì¸¸¹à±èé5…Ñ ¹µ¥¸¡±…å•ÉMÑ…¬¹±•¹Ñ ­Ø¹±•¹Ñ ±à¹è¬Ä¥ô€èà¤¥ôøñ5½Ù•UÀÍ¥é”õìÄÑô¼øð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰Ü´à ´àÉ½Õ¹‘•µ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈˆÑ¥Ñ±”ô‹–"«¦fˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøìÍ•Ñ	ÉÕÍ¡MÑÉ½­•Ì¡ØôùØ¹™¥±Ñ•È¡àôùà¹¥„ôõÍÑÉ½­”¹¥¤¤ìÍ•ÑM•±•Ñ•‘	ÉÕÍ¡%¡¹Õ±°¤ìõôøñQÉ…Í ÈÍ¥é”õìÄÑô¼øð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€ô¤ ¥ô((€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¦ã–>[’â–ò×–r[’æ/–ú3–:šr³šr¢N/’â+’â–ÆÑ½Õ µ…Ñ¥½¸é¹½¹”ƒžj–£žV¯–âš.[šnÏ–Æ“¾ò0(€€€€€€€€€€€€€€€€€€€€€€€ƒŽ3–ú{’îï’öW–rÃšZç¦÷¢÷š.[Ž7žj’î–çšb¿žV¯–â–º3–£’â7¢÷–Þ›–>ÏšîGŽ–ÞËžžï¦fƒŠSŠP(€€€€€€€€€€€€€€€€€€€€€€€ƒ¢šžžï–.W–r[ž&žnÓš:—š.[¦
–ò×–r[–6Ï–>¿¾ò3¦î{ž¦ëžf÷¢fW’î7žÛšb¿–>[šÚ#¦ã–>[Ž€¨½ô((€€€€€€€€€€€€€€€€€€€ì¼¨±¥¹µ•¹ÐÕ¥‘•±¥¹•Ì=Ù•É±…ä€¨½ô(€€€€€€€€€€€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÑ½Ñ…±½¹Ñ…¥¹•É]¥‘Ñ €ôÁ…•Ì¹±•¹Ñ €¨ÁÉ•Ù¥•Ý\€¬€¡Á…•Ì¹±•¹Ñ €´€Ä¤€¨€Äì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÑ½Ñ…±½¹Ñ…¥¹•É!•¥¡Ð€ôÁÉ•Ù¥•Ý ì(€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ–Â7¦ö+žÞk–r£žâ»šRû–ºç–f£¢Ž‡¾ò3–nƒš¶“–Û–Ÿ–ºç–êŸš¢gžÊ_žÒÃ¢š¦f“’î—¦‚C¢š÷–7ž:¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€ƒžV¯–"Ã¢z‹–æW’â+š&7šršÂã¦ƒžÚ·š2€ÉÁã¾ò3’â7šr¢Þ¢F_¦‚C¢š÷’â¢Öß¢º+žÊ_¾ò?¢º+žÒÃŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÕ¥‘•Aà€ô€È€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ðñð€Ä¤ì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÕ¥‘•!…±˜€ôÕ¥‘•Aà€¼€Èì((€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸…Ñ¥Ù•Õ¥‘•±¥¹•Ì¹µ…À ¡Õ¥‘•±¥¹”°¥‘à¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ¦†×žòwšr³¢ê¯–ÞËžî?’òk–"š"C¢Nw¢&Ëšv—¢†£ž’ë–Bã¦fŽ¢þg¦3¢.—–7žRï’âšv‡¦kžR (€€€€€€€€€€€€€€€€€€€€€€€€€€€ÉÁàƒ–¾ç¦öCžêÿ¾ò3–ÂÇ’òk–>ƒ–r €ÅÁàƒ–"–&Ëžêÿ’â+¾ò3¢ž¢ž'’â+–ò–âã–>cžÊ_¾òl(€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¢3’âS¢þg–Æèµ¥¹‘•àƒ¢þc’òk–:/¢þ¦'’â·š†Ž¦†×žòw–F÷’â·š^Û–>«’þwžVd(€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦
šv‡–në–ºh€ÅÁàƒžj¢Nw¢&Ë–"–&Ëžêÿ–6Ï–>¿Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Õ¥‘•±¥¹”¹ÑåÁ”€ôôô€Ù•ÉÑ¥…°œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ•…µQ½±•É…¹”€ô€À¸ÜÔ€¼5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ðñð€Ä¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥ÍA…•M•…µÕ¥‘”€ôÁ…•Ì¹Í±¥” Ä¤¹Í½µ” ¡|°Í•…µ%‘à¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ•…µ½½É€ô€¡Í•…µ%‘à€¬€Ä¤€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¤€´€À¸Ôì(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸5…Ñ ¹…‰Ì¡Õ¥‘•±¥¹”¹½½É€´Í•…µ½½É¤€ðôÍ•…µQ½±•É…¹”ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡¥ÍA…•M•…µÕ¥‘”¤É•ÑÕÉ¸¹Õ±°ì(€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€±•Ð±•™ÑMÑå±”€ô€œÀœì(€€€€€€€€€€€€€€€€€€€€€€€±•ÐÑ½ÁMÑå±”€ô€œÀœì(€€€€€€€€€€€€€€€€€€€€€€€±•ÐÝ¥‘Ñ¡MÑå±”€ô€œÄÀÀ”œì(€€€€€€€€€€€€€€€€€€€€€€€±•Ð¡•¥¡ÑMÑå±”€ô€œÄÀÀ”œì((€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ¦
+žV3’â+žjžÞk’â7¢÷šr'’â–6+¢B÷¦È½Ù•É™±½Üƒ¢Ž–"–6¾ò3–B›–&žr/¢Öß’úšrš¾P(€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ’â·¦ZOžÞkžÒÃŽšr–’[–ÓšRçž
ë–º3šVÓ¢Êó–r£žV¯–â–Ÿ¾ò3–Û¦’c’î7¢Þ£–r£–êŸš¢g’â+Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Õ¥‘•±¥¹”¹ÑåÁ”€ôôô€Ù•ÉÑ¥…°œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ¡MÑå±”€ô€‘íÕ¥‘•AáõÁá€ì(€€€€€€€€€€€€€€€€€€€€€€€€€±•™ÑMÑå±”€ô€‘í5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸¡Ñ½Ñ…±½¹Ñ…¥¹•É]¥‘Ñ €´Õ¥‘•Aà°Õ¥‘•±¥¹”¹½½É€´Õ¥‘•!…±˜¤¥õÁá€ì(€€€€€€€€€€€€€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡ÑMÑå±”€ô€‘íÕ¥‘•AáõÁá€ì(€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½ÁMÑå±”€ô€‘í5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸¡Ñ½Ñ…±½¹Ñ…¥¹•É!•¥¡Ð€´Õ¥‘•Aà°Õ¥‘•±¥¹”¹½½É€´Õ¥‘•!…±˜¤¥õÁá€ì(€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒš¦¯žÞk–>«žV¯–r£ž&§’îÛ¢«–ÞÇ¦
’â¦‚¾òk–Â7¦ö+žjšb¿¦g’â¦‚žj’â+’â/žÞ¾ò?’â·žÞk¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¢Þ£–"Ã¦jS–Ž¦‚–:ïšÊKšr'š?žú§¾ò#’æšr¢N/–"Ã–"—¦‚žj–Ÿ–ºç¾ò'Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Õ¥‘•±¥¹”¹àÀ€„ô¹Õ±°€˜˜Õ¥‘•±¥¹”¹àÄ€„ô¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™ÑMÑå±”€ô€‘íÕ¥‘•±¥¹”¹àÁõÁá€ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ¡MÑå±”€ô€‘í5…Ñ ¹µ…à À°Õ¥‘•±¥¹”¹àÄ€´Õ¥‘•±¥¹”¹àÀ¥õÁá€ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí¥‘áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨èƒ¢š¦®c¦;¦‚¢"¦‚’æ/¦ZO¦
šŠw–"–&ËžÞk¾ò ÈÀÃ¾ò'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ’â7žÛ–Â7¦ö+žÞk–ŽO–r£š:—žâ¯’â+šfšr¢Š¯–"–&ËžÞk–"š:'’â–6+Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒžr/¢Öß’úš¾S–Û’î[¦
+žjžÞkžÒÃŽ€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”‰œµ‰±Õ”´ÔÀÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ¦†×¦^Ó–"–&Ëžêÿšb¼€ÈÀÀÀÀÃ¾òo–¾ç¦öCžêÿ–þ¦†ïž¢Ï–ºkžn[–r£–º’â+¦v‹Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€é%¹‘•àè€ÌÀÀÀÀÀ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±•™Ðè±•™ÑMÑå±”°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ½ÀèÑ½ÁMÑå±”°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ èÝ¥‘Ñ¡MÑå±”°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡Ðè¡•¥¡ÑMÑå±”°(€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€€ì¼¨(€€€€€€€€€€€€€€€€€€€ƒ–’[š†–Æ“¾òk¦ã–>[š†Ž–no–/¢žKžj–rOžBŽ¦
š:Kš2'¦"W¦÷žV¯–r£¦g¢Ž‡Ž((€€€€€€€€€€€€€€€€€€€ƒ–º¢Þ’â+¦v‹¦
–/¦‚¦v‹–ºç–f£šb¿––òŽ–ÇžR£–B3’â–/ž"Û–Æ“¾ò3’ö7žö»¢"–’Ÿ–Â?’æ’âš¢‡’âš¢Œ(€€€€€€€€€€€€€€€€€€€ƒ¾ò#ž"Û–Æ“žj–¾³¦®c–ÂÇšb¿šVÓš:K¦‚¦v‹žj–¾³¦®c¾ò'¾ò3š&’î—–êŸš¢g–º3–£’â7žR£š>ožº\ƒŠSŠP(€€€€€€€€€€€€€€€€€€€ƒ–¶C–Æ“–:šr³š;¦êóšNë¾ò3šB³¦;’ú–ÂÇ¦
šb¿šNë–r£–B3’â–/–rÃšZçŽ(€€€€€€€€€€€€€€€€€€€ƒ–Þ»–"—–>«šr'’â–/¾òk¦g’â–Æ“’â7–r ½Ù•É™±½Üµ¡¥‘‘•¸ƒ–êW’â/¾ò0(€€€€€€€€€€€€€€€€€€€ƒš&’î—ž&§’îÛ¢Š¯š.[–ëžV¯–âšf¾ò3š†¢Þš2'¦"W’â7šr¢Š¯¦
+žÞžj¦îG¢&Ë–"š:'Ž((€€€€€€€€€€€€€€€€€€€ƒšr³¢ê¬Á½¥¹Ñ•Èµ•Ù•¹ÑÌè¹½¹—¾ò3–>«šr'–rOžB¢"š2'¦"W¢«–ÞÇ¦Z,ƒŠSŠPƒš†¢Ž‡¦v‹žjž¦ëžf÷¢fT(€€€€€€€€€€€€€€€€€€€ƒ’î7žÛšb¿ž¦ÿ¦?’â/–:ïš&O–"Ã–êW’â/¦
–/ž&§’îÛ¾ò3š.[šnÏš&/š’â¦î{¦÷šÊK¢º+Ž(€€€€€€€€€€€€€€€€€€¨½ô(€€€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€€€É•˜õíÍ•Ñ¡É½µ•1…å•Éô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´ÀÑ½À´ÀÜµ™Õ±° µ™Õ±°Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€€€€€€€€€ÍÑå±”õíìé%¹‘•àè€ÄÀÀÀÀÀõô(€€€€€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€ì¼¨A±ÕÌ	ÕÑÑ½¸Ñ¼…‘µ½É”Á…•Ì€¡5…á¥µÕ´€ÈÔÁ…•ÌÑ½Ñ…°°¤¹”¸°…‘‘•‘A…•Í½Õ¹Ð€ð€ÈÐ¤€¨½ô(€€€€€€€€€€€€€€€í…‘‘•‘A…•Í½Õ¹Ð€ð€ÈÐ€˜˜€ (€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€É•˜õí…‘‘A…•	Ñ¹I•™ô(€€€€€€€€€€€€€€€€€€€‘…Ñ„µ±…ÍÍ¥Œµ…‘µÁ…”ôˆÄˆ(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€Í•Ñ‘‘•‘A…•Í½Õ¹Ð¡ÁÉ•Ø€ôøÁÉ•Ø€¬€Ä¤ì(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•àµÍ¡É¥¹¬´ÀÜ´ÄÀ ´ÄÀÉ½Õ¹‘•µ™Õ±°‰œµÝ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÈÀ‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÈÔ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµÝ¡¥Ñ”µ°´ÌÕÉÍ½ÈµÁ½¥¹Ñ•ÈÍ¡…‘½Üµ±œˆ(€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹šZÃ–Š{’â¦‚ˆ(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñA±ÕÌÍ¥é”õìÈÁô€¼ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€¥ô((€€€€€€€€€€€€€€€ì¼¨(€€€€€€€€€€€€€€€€€ƒ–>Ï¦
+žjžVgžf÷¾òk–&o––÷žVg–"ÃŽ3šr–ú3’â¦‚–s–r£š¶’â·¦ZOŽ7ž
ëš¶‹¾ò3–’k’â–"–ÂÇšrš6Ë¦;¦‚´(€€€€€€€€€€€€€€€€€ƒžr/–"Ã’â–’Ÿž&¦îGŽ–Þ›¦
+žjµ…É¥¸ƒ’â7žº_¦Ëš6Ë–.Wž¾–r7¾ò3š&’î—–>Ï¦
+¢š¢Žs’â’îô(€€€€€€€€€€€€€€€€€ƒ’âš¢žjÍÑÉ¥Á=™™Í•Ó¾ò3–7š&š:'–*ƒ¢fš2'¦"W¾ò!µ°´Ì€¬€ÐÃ¾ò'–ÞËžÚO’öSš:'žj¦£–"Ž(€€€€€€€€€€€€€€€€€ƒ–¾³–ê›¢Þ–’[šºó’âš¢žRÄ…ÁÁ±åMÑÉ¥Á•½µ•ÑÉäƒš¾?’â–âŸ–¾¯Ž(€€€€€€€€€€€€€€€€¨½ô(€€€€€€€€€€€€€€€€ñ‘¥ØÉ•˜õíÍÑÉ¥ÁA…‘I•™ô±…ÍÍ9…µ”ô‰™±•àµÍ¡É¥¹¬´Àˆ€¼ø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¤ì(€€€€€€€€€ô¤ ¥ô(€€€€€€€€ð½‘¥Øø((€€€€€€€ì¼¨ƒ¢"–&×š?š.ó–r[–B3š²ûšJ·šRû–"_¾òk–ú{–Þ—–ß–"_’â/šZçšîG–—¾ò3¦‚C¢š÷–B3šf–æÏ¦‚žâ»–Â?¢ºO’ö7Ž€¨½ô(€€€€€€€íµ½Ñ¥½¹	…É5½Õ¹Ñ•€˜˜€ (€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€‘…Ñ„µ±…ÍÍ¥Œµµ½Ñ¥½¸µÑ¥µ”õíµ½Ñ¥½¹Q¥µ”¹Ñ½¥á• Ì¥ô(€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´ÌÉ¥¡Ð´Ì‰½ÑÑ½´´Ìè´ÐÀ™±•à¥Ñ•µÌµ•¹Ñ•È…À´ÈÉ½Õ¹‘•´Éá°‰œµ‰±…¬¼ÔÔ‰…­‘É½Àµ‰±ÕÈµµ‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀÁà´ÌÁä´ÈÍ¡…‘½ÜµlÁ|áÁá|ÈÑÁá}É‰„ À°À°À°À¸Ô¥tˆ(€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€½Á…¥Ñäèµ½Ñ¥½¹	…É%¸€ü€Ä€è€À°(€€€€€€€€€€€€€ÑÉ…¹Í™½É´èµ½Ñ¥½¹	…É%¸€ü€ÑÉ…¹Í±…Ñ•d À¤œ€è€ÑÉ…¹Í±…Ñ•d ÄÌÁÁà¤œ°(€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸è€ÑÉ…¹Í™½É´€ÐÈÁµÌÕ‰¥Œµ‰•é¥•È À¸ÈÈ°€À¸ØÄ°€À¸ÌØ°€Ä¤°½Á…¥Ñä€ÐÈÁµÌÕ‰¥Œµ‰•é¥•È À¸ÈÈ°€À¸ØÄ°€À¸ÌØ°€Ä¤œ°(€€€€€€€€€€€€€Á½¥¹Ñ•ÉÙ•¹ÑÌèµ½Ñ¥½¹	…É%¸€ü€…ÕÑ¼œ€è€¹½¹”œ°(€€€€€€€€€€€õô(€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õí”€ôø”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¥ô(€€€€€€€€€€ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ5½Ñ¥½¹A±…å¥¹œ¡Ø€ôø€…Ø¥ô(€€€€€€€€€€€€€‘…Ñ„µ±…ÍÍ¥Œµµ½Ñ¥½¸µÁ±…äôˆÄˆ(€€€€€€€€€€€€€Ñ¥Ñ±”õíµ½Ñ¥½¹A±…å¥¹œ€ü€Ÿšj¯–pœ€è€ŸšJ·šRøô(€€€€€€€€€€€€€±…ÍÍ9…µ”õí ´äÜ´ÄÄÍ¡É¥¹¬´ÀÉ½Õ¹‘•µláÁát‰½É‘•È™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°…Ñ¥Ù”éÍ…±”´äÀ€‘ì(€€€€€€€€€€€€€€€µ½Ñ¥½¹A±…å¥¹œ€ü€‰œµÑÉ…¹ÍÁ…É•¹ÐÑ•áÐµÝ¡¥Ñ”‰½É‘•ÈµÝ¡¥Ñ”œ€è€‰œµÝ¡¥Ñ”Ñ•áÐµ‰±…¬‰½É‘•ÈµÝ¡¥Ñ”œ(€€€€€€€€€€€€€õô(€€€€€€€€€€€€ø(€€€€€€€€€€€€€íµ½Ñ¥½¹A±…å¥¹œ(€€€€€€€€€€€€€€€€ü€ñA…ÕÍ”Í¥é”õìÄÕô™¥±°ô‰ÕÉÉ•¹Ñ½±½ÈˆÍÑÉ½­•]¥‘Ñ õìÁô€¼ø(€€€€€€€€€€€€€€€€è€ñA±…äÍ¥é”õìÄÕô™¥±°ô‰ÕÉÉ•¹Ñ½±½ÈˆÍÑÉ½­•]¥‘Ñ õìÁô€¼ùô(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€½¹±¥¬õíÉ•Á±…å5½Ñ¥½¹ô(€€€€€€€€€€€€€‘…Ñ„µ±…ÍÍ¥Œµµ½Ñ¥½¸µÉ•Á±…äôˆÄˆ(€€€€€€€€€€€€€Ñ¥Ñ±”ô‹–ú{¦‚·šJ´ˆ(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰ ´äÜ´ÄÄÍ¡É¥¹¬´ÀÉ½Õ¹‘•µláÁát‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÔÑ•áÐµÝ¡¥Ñ”¼ÜÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀ¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°…Ñ¥Ù”éÍ…±”´äÀˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€€ñI•Á±…å%½¸Í¥é”õìÄÕô€¼ø(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à´Äµ¥¸µÜ´Àˆø(€€€€€€€€€€€€€€ñ½µÁ…ÑM±¥‘•È(€€€€€€€€€€€€€€€±…‰•°ô‹–ú«žJÃ¦ZO¦jPˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÁ…•Y¥‘•½%Ñ•µÌ¹±•¹Ñ €ü9Õµ‰•È¡Á…•Y¥‘•½ÕÉ…Ñ¥½¸¹Ñ½¥á• Ä¤¤€è5…Ñ ¹É½Õ¹¡µ½Ñ¥½¹!½±¥ô(€€€€€€€€€€€€€€€µ¥¸õìÁôµ…àõíÁ…•Y¥‘•½%Ñ•µÌ¹±•¹Ñ €ü5…Ñ ¹µ…à Ä°5…Ñ ¹•¥°¡Á…•Y¥‘•½ÕÉ…Ñ¥½¸¤¤€è€ÈÁô(€€€€€€€€€€€€€€€ÍÑ•ÀõíÁ…•Y¥‘•½%Ñ•µÌ¹±•¹Ñ €ü€¸Ä€è€Åô(€€€€€€€€€€€€€€€‘•¥µ…±ÌõíÁ…•Y¥‘•½%Ñ•µÌ¹±•¹Ñ €ü€Ä€è€Áô(€€€€€€€€€€€€€€€™¥á•‘•¥µ…±ÌõíÁ…•Y¥‘•½%Ñ•µÌ¹±•¹Ñ €ø€Áô(€€€€€€€€€€€€€€€‘¥Í…‰±•õíÁ…•Y¥‘•½%Ñ•µÌ¹±•¹Ñ €ø€Áô(€€€€€€€€€€€€€€€½¹¡…¹”õì¡Øè¹Õµ‰•È¤€ôøì¥˜€ …Á…•Y¥‘•½%Ñ•µÌ¹±•¹Ñ ¤Í•Ñ5½Ñ¥½¹!½±¡Ø¤ìõô(€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€¥ô(€€€€€€ð½‘¥Øø((€€€€€ì¼¨	½ÑÑ½´Q…‰‰•½¹ÑÉ½±±•È€¨½ô(€€€€€ì¼¨ƒ¦®c–ê›š&šr'–"¦‚¦÷’âš¢¾òk–"–"Ã–r[ž&žÞ£¢ò¿šfžV¯–â’â7šržªžÛ¢º+–Â?Ž(€€€€€€€€€ƒ’â/¦fCšb¿žÞ£¢ò¿¦
žÖšN7’ösš²žj–¾›¦jo¦®c–ê›¾ò#–"¦‚–"_¾ò,àÃ¾ò,äÛ¾ò,Üß¾ò'¾ò0(€€€€€€€€€ƒ¢z‹–æW–’ƒ¦®c–ÂÇžR €ÌÙ‘Ù£Ž€¨½ô(€€€€€€ñ™½½Ñ•È(€€€€€€€±…ÍÍ9…µ”ô‰‰œµlŒÁ„Á„Á…t‰½É‘•ÈµÐ‰½É‘•ÈµlŒÅ„Å„Å…t™±•à™±•àµ½°èµlÔÁt¹¼µÍ•±•ÐÍ¡É¥¹¬´ÀÑÉ…¹Í¥Ñ¥½¸µÑÉ…¹Í™½É´‘ÕÉ…Ñ¥½¸´ÌÀÀ•…Í”µ½ÕÐˆ(€€€€€€€ÍÑå±”õíì¡•¥¡Ðè€µ…à ÌÙ‘Ù °€ÌÄÁÁà¤œõô(€€€€€€ø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à´Ä™±•à™±•àµ½° µ™Õ±°½Ù•É™±½Üµ¡¥‘‘•¸ˆø(€€€€€€€€€ì¼¨Q…‰Ì±¥ÍÐ€¨½ô(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•àÁà´ÐÁÐ´Ä‰½É‘•Èµˆ‰½É‘•ÈµlŒÅ„Å„Å…tÍ¡É¥¹¬´À½Ù•É™±½Üµàµ…ÕÑ¼½Ù•É™±½Üµäµ¡¥‘‘•¸Ñ½Õ µÁ…¸µà¹¼µÍÉ½±±‰…Èˆø(€€€€€€€€€€€ílÉ…Ñ¥¼œ°€Á…•Ìœ°€…‘œ°€…‘©ÕÍÐœ°€½±½Èœ°€µ½Ñ¥½¸t¹µ…À¡¥€ôøì(€€€€€€€€€€€€€±•Ð¥½¹°€ô¹Õ±°ì(€€€€€€€€€€€€€±•ÐÑ¥Ñ±•Q•áÐ€ô€œœì(€€€€€€€€€€€€€¥˜€¡¥€ôôô€É…Ñ¥¼œ¤ì(€€€€€€€€€€€€€€€¥½¹°€ô€ñÉ½ÀÍ¥é”õìÄáô€¼øì(€€€€€€€€€€€€€€€Ñ¥Ñ±•Q•áÐ€ô€Ÿž&#–z/š¾S’ú,œì(€€€€€€€€€€€€€ô•±Í”¥˜€¡¥€ôôô€…‘œ¤ì(€€€€€€€€€€€€€€€¥½¹°€ô€ñA±ÕÌÍ¥é”õìÄáô€¼øì(€€€€€€€€€€€€€€€Ñ¥Ñ±•Q•áÐ€ô€ŸšZÃ–Š{–Ÿ–ºäœì(€€€€€€€€€€€€€ô•±Í”¥˜€¡¥€ôôô€…‘©ÕÍÐœ¤ì(€€€€€€€€€€€€€€€¥½¹°€ô€ñM±¥‘•ÉÍ!½É¥é½¹Ñ…°Í¥é”õìÄáô€¼øì(€€€€€€€€€€€€€€€Ñ¥Ñ±•Q•áÐ€ô€ŸžÞ£¢ò¼œì(€€€€€€€€€€€€€ô•±Í”¥˜€¡¥€ôôô€Á…•Ìœ¤ì(€€€€€€€€€€€€€€€¥½¹°€ô€ñ…±±•Éå!½É¥é½¹Ñ…°Í¥é”õìÄáô€¼øì(€€€€€€€€€€€€€€€Ñ¥Ñ±•Q•áÐ€ô€Ÿ¦‚¦v‹¦‚–ê<œì(€€€€€€€€€€€€€ô•±Í”¥˜€¡¥€ôôô€½±½Èœ¤ì(€€€€€€€€€€€€€€€¥½¹°€ô€ñA…±•ÑÑ”Í¥é”õìÄáô€¼øì(€€€€€€€€€€€€€€€Ñ¥Ñ±•Q•áÐ€ô€Ÿ¢3šf¿¦†?¢&Èœì(€€€€€€€€€€€€€ô•±Í”¥˜€¡¥€ôôô€µ½Ñ¥½¸œ¤ì(€€€€€€€€€€€€€€€¥½¹°€ô€ñ¥±´Í¥é”õìÄÙô€¼øì(€€€€€€€€€€€€€€€Ñ¥Ñ±•Q•áÐ€ô€Ÿ–.WžV¬œì(€€€€€€€€€€€€€ô((€€€€€€€€€€€€€½¹ÍÐ¥ÍÑ¥Ù”€ô…Ñ¥Ù•Q…ˆ€ôôô¥ñð€¡¥€ôôô€…‘œ€˜˜…Ñ¥Ù•Q…ˆ€ôôô€±…å½ÕÐœ¤ì((€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸€(€€€€€€€€€€€€€€€€€­•äõí¥‘ô€(€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì(€€€€€€€€€€€€€€€€€€€Í•ÑÑ¥Ù•Q…ˆ¡¥…Ì…¹ä¤ì(€€€€€€€€€€€€€€€€€€€€¼¨ƒ–ÞËžÚO¦î{¦ËŽ3šZÃ–Š{ž²›¢f¾ò?šZÃ–Š{–r[–ö‹Ž7žjšf–g–7¦î{’âš²‡–*ƒ¢f¾ò0(€€€€€€€€€€€€€€€€€€€€€€ƒ–ÂÇ–n{–"ÃšZÃ–Š{žj’âï¦‚ƒŠSŠPƒ’â7–þž&ç–rÃ–:ïš2'–Þ›’â+¢žKžj¢þS–n{¦6×Ž€¨¼(€€€€€€€€€€€€€€€€€€€¥˜€¡¥€ôôô€…‘œ¤Í•Ñ‘‘MÕˆ É½½Ðœ¤ì(€€€€€€€€€€€€€€€€€€€¥˜€¡¥€ôôô€½±½Èœ¤Í•Ñ½±½ÉA¥­•ÉÑ¥Ù”¡ÑÉÕ”¤ì(€€€€€€€€€€€€€€€€€õô€(€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí™±•à´Äµ¥¸µÜµlÜÁÁátÁä´Ð‰½É‘•Èµˆ´ÈÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌ‘ÕÉ…Ñ¥½¸´ÄÔÀ™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´Ä€‘ì(€€€€€€€€€€€€€€€€€€€¥ÍÑ¥Ù”€ü€Ñ•áÐµÝ¡¥Ñ”‰½É‘•ÈµÝ¡¥Ñ”œ€è€Ñ•áÐµlŒÐÐÑt‰½É‘•ÈµÑÉ…¹ÍÁ…É•¹Ð¡½Ù•ÈéÑ•áÐµlŒÜÜÝtœ(€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€Ñ¥Ñ±”õíÑ¥Ñ±•Q•áÑô(€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€í¥½¹±ô(€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€ô¥ô(€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€ì¼¨Q…‰Ì½¹Ñ•¹Ð€¨½ô(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”õí™±•à´Ä¹¼µÍÉ½±±‰…È€‘í¥µ…•‘¥Ñ5½‘”€ü€œœ€è€À´ÐÁˆ´Ðô€‘ílÉ…Ñ¥¼œ°€½±½Èœ°€±…å½ÕÐœ°€…‘©ÕÍÐœ°€Á…•Ìt¹¥¹±Õ‘•Ì¡…Ñ¥Ù•Q…ˆ¤€ü€½Ù•É™±½Üµ¡¥‘‘•¸œ€è€½Ù•É™±½Üµäµ…ÕÑ¼½Ù•É™±½Üµàµ¡¥‘‘•¸õôø((€€€€€€€€€€€í…Ñ¥Ù•Q…ˆ€ôôô€µ½Ñ¥½¸œ€˜˜€  ¤€ôøì(€€€€€€€€€€€€€½¹ÍÐÑ…É•Ð€ôµ½Ñ¥½¹%Ñ•µÌ¹™¥¹¡˜€ôø˜¹¥€ôôôµ½Ñ¥½¹Q…É•Ñ%¤ñð¹Õ±°ì(€€€€€€€€€€€€€½¹ÍÐ™œ€ô±…ÍÍ¥=‰©•Ñ5½Ñ¥½¹=˜¡Ñ…É•Ðü¹µ¼¤ì(€€€€€€€€€€€€€½¹ÍÐÁ…Ñ¡5½Ñ¥½¸€ô€¡èA…ÉÑ¥…°ñ=‰©•Ñ5½Ñ¥½¹½¹™¥œø¤€ôøì(€€€€€€€€€€€€€€€¥˜€ …Ñ…É•Ð¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡Ø€ôøØ¹µ…À¡˜€ôø˜¹¥€ôôôÑ…É•Ð¹¥€üì€¸¸¹˜°µ¼èì€¸¸¹™œ°€¸¸¹ôô€è˜¤¤ì(€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€½¹ÍÐ¥ÍÉ¥‘Q…É•Ð€ô€„…Ñ…É•Ðü¹Í¡…Á”€˜˜I%}M!A}-%9L¹¡…Ì¡Ñ…É•Ð¹Í¡…Á”¤ì(€€€€€€€€€€€€€½¹ÍÐ¥ÍMÁ•¥…±1¥¹•Q…É•Ð€ô€„…Ñ…É•Ðü¹Í¡…Á”€˜˜MA%1}1%9}-%9L¹¡…Ì¡Ñ…É•Ð¹Í¡…Á”¤ì(€€€€€€€€€€€€€½¹ÍÐ¥ÍQ•áÑQ…É•Ð€ôÑ…É•Ðü¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•€˜˜€…Ñ…É•Ð¹Íå´ì(€€€€€€€€€€€€€½¹ÍÐ‰…Í•%¹ÑÉ¼€ô=	)Q}%9}-%9L¹™¥±Ñ•È ¡m¥‘t¤€ôø¥€„ôô€‰½Õ¹”œ¤ì(€€€€€€€€€€€€€½¹ÍÐ¥¹ÑÉ½-¥¹‘Ì€ôÑ…É•Ðü¹Íå´(€€€€€€€€€€€€€€€€üMe5	=1}=	)Q}%9}-%9L¹™¥±Ñ•È ¡m¥‘t¤€ôø¥€„ôô€‰½Õ¹”œ¤(€€€€€€€€€€€€€€€€è¥ÍÉ¥‘Q…É•Ð(€€€€€€€€€€€€€€€€€€ü‰…Í•%¹ÑÉ¼¹µ…À ¡m¥°¹…µ•t¤€ôø¥€ôôô€ÍÁÉ¥¹œœ€ülÉ¥µÝ…Ù”œ°€ŸšÎ‹šÖ¨t…Ì½¹ÍÐ€èm¥°¹…µ•t…Ì½¹ÍÐ¤(€€€€€€€€€€€€€€€€€€è¥ÍMÁ•¥…±1¥¹•Q…É•Ð(€€€€€€€€€€€€€€€€€€€€ül¸¸¹‰…Í•%¹ÑÉ¼¹™¥±Ñ•È ¡m¥‘t¤€ôø¥€„ôô€ÍÁÉ¥¹œœ¤°l‘É…Üœ°€ŸžV¯ž¶t…Ì½¹ÍÑt(€€€€€€€€€€€€€€€€€€€€è‰…Í•%¹ÑÉ¼ì(€€€€€€€€€€€€€½¹ÍÐ‰…Í•%‘±”€ô=	)Q}%1}-%9L(€€€€€€€€€€€€€€€€¹™¥±Ñ•È ¡m¥‘t¤€ôø¥€„ôô€Íåµ‰½°µ‰É•…Ñ¡”Èœ¤(€€€€€€€€€€€€€€€€¹µ…À ¡m¥°¹…µ•t¤€ôø¥€ôôô€‰É•…Ñ¡”œ€üm¥°€Ÿžâ»šRøt…Ì½¹ÍÐ€èm¥°¹…µ•t…Ì½¹ÍÐ¤ì(€€€€€€€€€€€€€½¹ÍÐ¥‘±•-¥¹‘Ì€ôÑ…É•Ðü¹Íå´(€€€€€€€€€€€€€€€€ü‰…Í•%‘±”¹™¥±Ñ•È ¡m¥‘t¤€ôø¥€„ôô€É¥µÝ…Ù”œ¤¹™±…Ñ5…À ¡m¥°¹…µ•t¤€ôø(€€€€€€€€€€€€€€€€€€€¥€ôôô€‰É•…Ñ¡”œ€ümm¥°€Ÿžâ»šRù$t…Ì½¹ÍÐ°lÍåµ‰½°µ‰É•…Ñ¡”Èœ°€Ÿžâ»šRù%$t…Ì½¹ÍÑt€èmm¥°¹…µ•t…Ì½¹ÍÑt¤(€€€€€€€€€€€€€€€€è¥ÍQ•áÑQ…É•Ð(€€€€€€€€€€€€€€€€€€ü‰…Í•%‘±”¹™¥±Ñ•È ¡m¥‘t¤€ôø¥€„ôô€ÍÁ¥¸œ¤¹™±…Ñ5…À ¡m¥°¹…µ•t¤€ôø(€€€€€€€€€€€€€€€€€€€€€¥€ôôô€‰É•…Ñ¡”œ€ümm¥°€Ÿžâ»šRøt…Ì½¹ÍÐ°lÍåµ‰½°µ‰É•…Ñ¡”Èœ°€Ÿžâ»šRù%$t…Ì½¹ÍÑt€èmm¥°¹…µ•t…Ì½¹ÍÑt¤(€€€€€€€€€€€€€€€€€€è‰…Í•%‘±”ì(€€€€€€€€€€€€€½¹ÍÐÁ¥­%¹ÑÉ¼€ô€¡¥èÍÑÉ¥¹œ¤€ôøì(€€€€€€€€€€€€€€€Á…Ñ¡5½Ñ¥½¸¡¥€ôôô€‰Õ‰‰±”œ€üì¥¸è¥°‘ÕÈèµ½Ñ¥½¹ÕÉ…Ñ¥½¹É½µU¤ àÀ¤ô€èì¥¸è¥ô¤ì(€€€€€€€€€€€€€€€É•Á±…å5½Ñ¥½¸ ¤ì(€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€½¹ÍÐÁ¥­%‘±”€ô€¡¥èÍÑÉ¥¹œ¤€ôøì(€€€€€€€€€€€€€€€¥˜€¡¥€ôôô€Íåµ‰½°µ‰É•…Ñ¡”Èœ¤Á…Ñ¡5½Ñ¥½¸¡ì¥‘±”è¥°…µÀè€ØÀ°ÍÁ••è€Ä¸Èô¤ì(€€€€€€€€€€€€€€€•±Í”¥˜€¡¥€ôôô€‰É•…Ñ¡”œ€˜˜Ñ…É•Ð¹Íå´¤Á…Ñ¡5½Ñ¥½¸¡ì¥‘±”è¥°…µÀè€ÌÀô¤ì(€€€€€€€€€€€€€€€•±Í”¥˜€¡¥€ôôô€É¥µÝ…Ù”œ¤Á…Ñ¡5½Ñ¥½¸¡¥ÍÉ¥‘Q…É•Ð(€€€€€€€€€€€€€€€€€€üì¥‘±”è¥°…µÀè€ÔÀ°ÍÁ••è€¸äô(€€€€€€€€€€€€€€€€€€èì¥‘±”è¥°…µÀè€ÌÀ°ÍÁ••è€Ä¸ÜÔô¤ì(€€€€€€€€€€€€€€€•±Í”¥˜€¡¥ÍMÁ•¥…±1¥¹•Q…É•Ð¤Á…Ñ¡5½Ñ¥½¸¡ì¥‘±”è¥°…µÀè€ÈÀô¤ì(€€€€€€€€€€€€€€€•±Í”Á…Ñ¡5½Ñ¥½¸¡ì¥‘±”è¥ô¤ì(€€€€€€€€€€€€€€€É•Á±…å5½Ñ¥½¸ ¤ì(€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€½¹ÍÐ¡¥À€ô€¡½¸è‰½½±•…¸¤€ôøÁà´Ì ´àÍ¡É¥¹¬´ÀÉ½Õ¹‘•µláÁát‰½É‘•ÈÑ•áÐµlÄÅÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°™±•à¥Ñ•µÌµ•¹Ñ•È…À´Ä¸Ô€‘í½¸€ü€‰œµlŒÈÈÉtÑ•áÐµÝ¡¥Ñ”‰½É‘•ÈµÝ¡¥Ñ”Í¡…‘½ÜµlÁ|Á|ÄÕÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸Ä¥tœ€è€‰½É‘•ÈµlŒÅ„Å„Å…tÑ•áÐµlŒÔÔÕt¡½Ù•Èé‰œµlŒÄÄÅt¡½Ù•ÈéÑ•áÐµlŒààátõ€ì(€€€€€€€€€€€€€½¹ÍÐ•±°€ô€¡½¸è‰½½±•…¸¤€ôø ´äÉ½Õ¹‘•µláÁát‰½É‘•ÈÑ•áÐµlÄÁÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°€‘í½¸€ü€‰œµlŒÈÈÉtÑ•áÐµÝ¡¥Ñ”‰½É‘•ÈµÝ¡¥Ñ”Í¡…‘½ÜµlÁ|Á|ÄÕÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸Ä¥tœ€è€‰½É‘•ÈµlŒÅ„Å„Å…tÑ•áÐµlŒÔÔÕt¡½Ù•Èé‰œµlŒÄÄÅt¡½Ù•ÈéÑ•áÐµlŒààátõ€ì(€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ…àµÜµµµàµ…ÕÑ¼Áˆ´Ô…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÌÀÀˆø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø‘…Ñ„µ±…ÍÍ¥Œµµ½Ñ¥½¸µÑ…É•ÑÌôˆÄˆ±…ÍÍ9…µ”ô‰™±•à…À´È½Ù•É™±½Üµàµ…ÕÑ¼¹¼µÍÉ½±±‰…Èl˜èèµÝ•‰­¥ÐµÍÉ½±±‰…Été¡¥‘‘•¸Áˆ´Äˆø(€€€€€€€€€€€€€€€€€€€€€íµ½Ñ¥½¹%Ñ•µÌ¹µ…À ¡˜¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐµ•‘¥„€ôµ½Ñ¥½¹%Ñ•µÌ¹™¥±Ñ•È¡à€ôøà¹Ñ•áÐ€ôôôÕ¹‘•™¥¹•€˜˜€…à¹Í¡…Á”¤ì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ¡…Á•Ì€ôµ½Ñ¥½¹%Ñ•µÌ¹™¥±Ñ•È¡à€ôø€„…à¹Í¡…Á”¤ì(€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸­•äõí˜¹¥‘ô½¹±¥¬õì ¤€ôø¡½½Í•5½Ñ¥½¹Q…É•Ð¡˜¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí¡¥À¡µ½Ñ¥½¹Q…É•Ñ%€ôôô˜¹¥¥ôø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ùí˜¹Íå´€ü€Ÿž²›¢f|œ€è˜¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•€ü€ŸšZ–¶\œ€è˜¹Í¡…Á”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€üƒ–r[–öˆ‘íÍ¡…Á•Ì¹±•¹Ñ €ø€Ä€üÍ¡…Á•Ì¹™¥¹‘%¹‘•à¡à€ôøà¹¥€ôôô˜¹¥¤€¬€Ä€è€œõ€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€èƒ–r[ž&‘íµ•‘¥„¹±•¹Ñ €ø€Ä€üµ•‘¥„¹™¥¹‘%¹‘•à¡à€ôøà¹¥€ôôô˜¹¥¤€¬€Ä€è€œõôð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€¤íô¥ô(€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€ì…Ñ…É•Ð€ü€ñÀ‘…Ñ„µ¹¼µµ½Ñ¥½¸µ¥Ñ•µÌôˆÄˆ±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁátÑ•áÐµÝ¡¥Ñ”¼ÐÀÑ•áÐµ•¹Ñ•ÈÁÐ´àˆûšÊKšr'–>¿žÞ£¢ò¿¦‚žn¸ð½Àø€è€ðø(€€€€€€€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÁÁát™½¹Ðµ‰½±Ñ•áÐµlŒØØÙtÕÁÁ•É…Í”ÑÉ…­¥¹œµÝ¥‘•ÍÐµˆ´ÈµÐ´Ðˆû¦Ë–‚Ó–.WžV¬ð½Àø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´Ð…À´Èˆùí¥¹ÑÉ½-¥¹‘Ì¹µ…À ¡m¥±¹…µ•t¤€ôø€ñ‰ÕÑÑ½¸­•äõí¥‘ô±…ÍÍ9…µ”õí•±°¡™œ¹¥¸ôôõ¥¥ô½¹±¥¬õì ¤ôùÁ¥­%¹ÑÉ¼¡¥¥ôùí¹…µ•ôð½‰ÕÑÑ½¸ø¥ôð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´È…Àµà´Ü…Àµä´ÐµÐ´Ìˆø(€€€€€€€€€€€€€€€€€€€€€€ñ½µÁ…ÑM±¥‘•È±…‰•°ô‹¢Öß–ž,ˆÙ…±Õ”õí9Õµ‰•È¡™œ¹‘•±…ä¹Ñ½¥á• Ä¤¥ôµ¥¸õìÁôµ…àõìÍôÍÑ•Àõì¸Åô‘•¥µ…±ÌõìÅô™¥á•‘•¥µ…±Ì½¹½µµ¥ÐõíÉ•Á±…å5½Ñ¥½¹ô½¹¡…¹”õì¡Øé¹Õµ‰•È¤ôùÁ…Ñ¡5½Ñ¥½¸¡í‘•±…äéÙô¥ô¼ø(€€€€€€€€€€€€€€€€€€€€€€ñ½µÁ…ÑM±¥‘•È±…‰•°ô‹¦–ê˜ˆ(€€€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí™œ¹¥¸€ôôô€‰Õ‰‰±”œ€˜˜Ñ…É•Ð¹Íå´(€€€€€€€€€€€€€€€€€€€€€€€€€€ü5…Ñ ¹É½Õ¹ ¡µ½Ñ¥½¹U¥É½µÕÉ…Ñ¥½¸¡™œ¹‘ÕÈ¤€´€ÔÀ¤€¨€È¤(€€€€€€€€€€€€€€€€€€€€€€€€€€èµ½Ñ¥½¹U¥É½µÕÉ…Ñ¥½¸¡™œ¹‘ÕÈ¥ô(€€€€€€€€€€€€€€€€€€€€€€€µ¥¸õìÁôµ…àõìÄÀÁôÍÑ•ÀõìÅô½¹½µµ¥ÐõíÉ•Á±…å5½Ñ¥½¹ô(€€€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡Øé¹Õµ‰•È¤ôùÁ…Ñ¡5½Ñ¥½¸¡í‘ÕÈéµ½Ñ¥½¹ÕÉ…Ñ¥½¹É½µU¤¡™œ¹¥¸€ôôô€‰Õ‰‰±”œ€˜˜Ñ…É•Ð¹Íå´€ü€ÔÀ€¬Ø€¼€È€èØ¥ô¥ô¼ø(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÁÁát™½¹Ðµ‰½±Ñ•áÐµlŒØØÙtÑÉ…­¥¹œµÝ¥‘•ÍÐµˆ´ÈµÐ´Ðˆû–âã¦žC–.WžV¬ð½Àø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´Ð…À´Èˆùí¥‘±•-¥¹‘Ì¹µ…À ¡m¥±¹…µ•t¤€ôø€ñ‰ÕÑÑ½¸­•äõí¥‘ô±…ÍÍ9…µ”õí•±°¡™œ¹¥‘±”ôôõ¥¥ô½¹±¥¬õì ¤ôùÁ¥­%‘±”¡¥¥ôùí¹…µ•ôð½‰ÕÑÑ½¸ø¥ôð½‘¥Øø(€€€€€€€€€€€€€€€€€€€í™œ¹¥‘±”€„ôô€¹½¹”œ€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´È…Àµà´Ü…Àµä´ÐµÐ´Ìˆø(€€€€€€€€€€€€€€€€€€€€€€ñ½µÁ…ÑM±¥‘•È±…‰•°ô‹–æ–ê˜ˆÙ…±Õ”õí™œ¹…µÁôµ¥¸õìÁôµ…àõìÄÀÁôÍÑ•ÀõìÅô½¹½µµ¥ÐõíÉ•Á±…å5½Ñ¥½¹ô½¹¡…¹”õì¡Øé¹Õµ‰•È¤ôùÁ…Ñ¡5½Ñ¥½¸¡í…µÀéÙô¥ô¼ø(€€€€€€€€€€€€€€€€€€€€€€ñ½µÁ…ÑM±¥‘•È±…‰•°ô‹¦–ê˜ˆ(€€€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí™œ¹¥‘±”€ôôô€Íåµ‰½°µ‰É•…Ñ¡”Èœ€˜˜€¡Ñ…É•Ð¹Íå´ñð¥ÍQ•áÑQ…É•Ð¤(€€€€€€€€€€€€€€€€€€€€€€€€€€ü5…Ñ ¹É½Õ¹¡5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ ÄÀÀ°€¡™œ¹ÍÁ••€¨€ÄÀÀ€´€ÜÀ¤€¼€Ä¸Ä¤¤¤(€€€€€€€€€€€€€€€€€€€€€€€€€€è™œ¹¥‘±”€ôôô€É¥µÝ…Ù”œ€˜˜€…¥ÍÉ¥‘Q…É•Ð(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü5…Ñ ¹É½Õ¹¡5…Ñ ¹µ…à À°5…Ñ ¹µ¥¸ ÄÀÀ°€¡™œ¹ÍÁ••€¨€ÄÀÀ€´€ÄÀÀ¤€¼€Ä¸Ô¤¤¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€è5…Ñ ¹É½Õ¹¡™œ¹ÍÁ••¨ÄÀÀ¥ô(€€€€€€€€€€€€€€€€€€€€€€€µ¥¸õí™œ¹¥‘±”€ôôô€Íåµ‰½°µ‰É•…Ñ¡”Èœ€˜˜€¡Ñ…É•Ð¹Íå´ñð¥ÍQ•áÑQ…É•Ð¤ñð™œ¹¥‘±”€ôôô€É¥µÝ…Ù”œ€˜˜€…¥ÍÉ¥‘Q…É•Ð€ü€À€è€ÈÁô(€€€€€€€€€€€€€€€€€€€€€€€µ…àõí™œ¹¥‘±”€ôôô€Íåµ‰½°µ‰É•…Ñ¡”Èœ€˜˜€¡Ñ…É•Ð¹Íå´ñð¥ÍQ•áÑQ…É•Ð¤ñð™œ¹¥‘±”€ôôô€É¥µÝ…Ù”œ€˜˜€…¥ÍÉ¥‘Q…É•Ð€ü€ÄÀÀ€è€ÄàÁô(€€€€€€€€€€€€€€€€€€€€€€€ÍÑ•ÀõìÅô½¹½µµ¥ÐõíÉ•Á±…å5½Ñ¥½¹ô(€€€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡Øé¹Õµ‰•È¤ôùÁ…Ñ¡5½Ñ¥½¸¡íÍÁ••è™œ¹¥‘±”€ôôô€Íåµ‰½°µ‰É•…Ñ¡”Èœ€˜˜€¡Ñ…É•Ð¹Íå´ñð¥ÍQ•áÑQ…É•Ð¤(€€€€€€€€€€€€€€€€€€€€€€€€€€ü€ ÜÀ€¬Ø€¨€Ä¸Ä¤€¼€ÄÀÀ(€€€€€€€€€€€€€€€€€€€€€€€€€€è™œ¹¥‘±”€ôôô€É¥µÝ…Ù”œ€˜˜€…¥ÍÉ¥‘Q…É•Ð€ü€ ÄÀÀ€¬Ø€¨€Ä¸Ô¤€¼€ÄÀÀ€èØ¼ÄÀÁô¥ô¼ø(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øùô(€€€€€€€€€€€€€€€€€€ð¼ùô(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€ô¤ ¥ô((€€€€€€€€€€€í…Ñ¥Ù•Q…ˆ€ôôô€…‘©ÕÍÐœ€˜˜€  ¤€ôøì(€€€€€€€€€€€€€€¼¨ƒ’ö#–Æ¢Ž‡žjš‚ó–¶C’æ¢ÖÃ–B3’â––_¦v‹švÿ¾òkš*+š‚ó–¶C–2š"C¢ÞšÖ»–.W–r[ž&’âš¢žj–ö‹ž.¾ò0(€€€€€€€€€€€€€€€€ƒ¦v‹švÿšr³¢ê¯–º3–£’â7žR£šRç¾ò3–¾¯–n{–:ïžjšf–g–7–Â;–"Ãš‚ó–¶C’â+Ž€¨¼(€€€€€€€€€€€€€½¹ÍÐÍ•±•±°€ôÍ•±•Ñ•‘±½…Ñ¥¹%€ü¹Õ±°(€€€€€€€€€€€€€€€€è€¡Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°€˜˜Í•±•Ñ•‘1…å½ÕÑ%(€€€€€€€€€€€€€€€€€€€€ü€¡…Ñ¥Ù•A…”¹±…å½ÕÑÌ¹™¥¹¡°€ôø°¹¥€ôôôÍ•±•Ñ•‘1…å½ÕÑ%¤ü¹¥µ…•ÍmÍ•±•Ñ•‘%¹‘•átñð¹Õ±°¤(€€€€€€€€€€€€€€€€€€€€è¹Õ±°¤ì(€€€€€€€€€€€€€½¹ÍÐ±…å•È€ô™±½…Ñ¥¹%µ…•Ì¹™¥¹¡˜€ôø˜¹¥€ôôôÍ•±•Ñ•‘±½…Ñ¥¹%¤(€€€€€€€€€€€€€€€ñð€¡Í•±•±°€˜˜Í•±•±°¹ÕÉ°(€€€€€€€€€€€€€€€€€€€€ü€¡ì¥èÍ•±•±°¹¥°ÍÉŒèÍ•±•±°¹ÕÉ°°™àèÍ•±•±°¹™àô…ÌÕ¹­¹½Ý¸…Ì±½…Ñ¥¹%µ…”¤(€€€€€€€€€€€€€€€€€€€€èÕ¹‘•™¥¹•¤ì(€€€€€€€€€€€€€€¼¼ƒ’î¦êó¦÷šÊK¦ã¾òk–>«žÖ›š>Cž’è(€€€€€€€€€€€€€¥˜€ …±…å•È¤É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€¼¼ƒžö»’â·’æ/–ú3–7ž¢7–ú»–ú’â+’â¦î{¾ò!Áˆƒ¢ºO–>¿žR£¦®c–ê›¢º+ž~»¾ò3ž¶'šZóšVÓšº×–ú’â+š2¨€ÄÉÁã¾ò$(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ µ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÁˆ´Øˆø(€€€€€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁátÑ•áÐµÝ¡¥Ñ”¼ÐÀÑ•áÐµ•¹Ñ•Èˆû¢®/¦ã’â·¢šžÞ£¢ò¿žjž&§’îØð½Àø(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€¤ì((€€€€€€€€€€€€€€¼¼ƒ¦ã–"ÃšZ–¶_¾òk¢ÖÃšZ–¶_¦
’â––_¦v‹švÿ¾ò#–B3’â–/–"¦‚Ž’â7–B3’î/¦v‹¾ò'Ž(€€€€€€€€€€€€€€¼¼ƒž²›¢f¢ÖÃ–B3’â¦†¦v‹švÿžjžÊûžÂ‡š¢‡–ò?¾ò#¦†?¢&ËŽ–’Ÿ–Â?Žžfó–'¾ò'Ž(€€€€€€€€€€€€€¥˜€¡±…å•È¹Ñ•áÐ€„ôôÕ¹‘•™¥¹•¤ì(€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€ñQ•áÑ‘¥Ñ½ÉA…¹•°(€€€€€€€€€€€€€€€€€€€±…å•Èõí±…å•Éô(€€€€€€€€€€€€€€€€€€€Íåµ‰½°õì„…±…å•È¹Íåµô(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õíÁ…Ñ €ôøÁ…Ñ¡Q•áÑ1…å•È¡±…å•È¹¥°Ý¥Ñ¡±½Ý%¹¥Ð¡±…å•È°Á…Ñ ¤¥ô(€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€¼¼ƒ¦ã–"Ã–r[–ö‹¾òk¦†?¢&Ë¾ò?žÊ_žÒÃ¾ò?¢fožÞh(€€€€€€€€€€€€€¥˜€¡±…å•È¹Í¡…Á”¤ì(€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€ñM¡…Á•‘¥Ñ½ÉA…¹•°(€€€€€€€€€€€€€€€€€€€±…å•Èõí±…å•Éô(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õíÁ…Ñ €ôøÁ…Ñ¡Q•áÑ1…å•È¡±…å•È¹¥°Ý¥Ñ¡±½Ý%¹¥Ð¡±…å•È°Á…Ñ ¤¥ô(€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€¼¨ƒŠRŠR ƒ¦ã–"Ã–r[ž&¾òk¢ÞŽ3žÞ£¢ò¿Ž7–º3–£’âš¢žj’â'šº×–ò?šN7’ösš²ƒŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠR (€€€€€€€€€€€€€€€€ƒ’â+¾òk’âš‚çšîGš†ÿ¾ò ÕÉ•·¾ò'¾ò?’â·¾òk–Þ—–ß–"_¾ò ÙÉ•·¾ò'¾ò?’â/¾òk–"¦†{–"_¾ò! ´ÄÛ¾ò/–êW¦£ž¦ë¦jg¾ò$€¨¼(€€€€€€€€€€€€€½¹ÍÐ¥µœ€ô±…å•Èì(€€€€€€€€€€€€€½¹ÍÐÍ•Ð€ô€¡Á…Ñ èA…ÉÑ¥…°ñ±½…Ñ¥¹%µ…”ø¤€ôøì(€€€€€€€€€€€€€€€¥˜€¡Í•±•±°¤ì(€€€€€€€€€€€€€€€€€€¼¼ƒ–>«šr'š‚ó–¶Cžržjšr'žjš²’ö7š&7–¾¯–n{–:ï¾ò3–Û¦’c–þ÷žV”(€€€€€€€€€€€€€€€€€½¹ÍÐ•±±A…Ñ èA…ÉÑ¥…°ñ%µ…••±°ø€ôíôì(€€€€€€€€€€€€€€€€€¥˜€ ™àœ¥¸Á…Ñ ¤•±±A…Ñ ¹™à€ô€¡Á…Ñ …Ì…¹ä¤¹™àì(€€€€€€€€€€€€€€€€€¥˜€ …=‰©•Ð¹­•åÌ¡•±±A…Ñ ¤¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À ¡Œ°¤¤€ôø€¡¤€ôôôÍ•±•Ñ•‘%¹‘•à€üì€¸¸¹Œ°€¸¸¹•±±A…Ñ ô€èŒ¤¤¤ì(€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€Í•Ñ±½…Ñ¥¹%µ…•Ì¡ÁÉ•Ø€ôøÁÉ•Ø¹µ…À¡˜€ôø€¡˜¹¥€ôôô¥µœ¹¥€üì€¸¸¹˜°€¸¸¹Á…Ñ ô€è˜¤¤¤ì(€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€ñ%µ…•‘©ÕÍÑA…¹•°(€€€€€€€€€€€€€€€€€¥µœõí¥µôÍ•ÐõíÍ•Ñô±ÕÑ1¥ÍÐõí±ÕÑ1¥ÍÑô(€€€€€€€€€€€€€€€€€±½…‘¥¹1ÕÐõí±½…‘¥¹1ÕÑôÍ•Ñ1½…‘¥¹1ÕÐõíÍ•Ñ1½…‘¥¹1ÕÑô(€€€€€€€€€€€€€€€€€±ÕÑI•Ù¥Í¥½¸õí±ÕÑI•Ù¥Í¥½¹ôÍ•Ñ1ÕÑI•Ù¥Í¥½¸õíÍ•Ñ1ÕÑI•Ù¥Í¥½¹ô(€€€€€€€€€€€€€€€€€…‘©ÕÍÑMÕˆõí…‘©ÕÍÑMÕ‰ôÍ•Ñ‘©ÕÍÑMÕˆõíÍ•Ñ‘©ÕÍÑMÕ‰ô(€€€€€€€€€€€€€€€€€•™™•Ñ…Éõí•™™•Ñ…É‘ôÍ•Ñ™™•Ñ…ÉõíÍ•Ñ™™•Ñ…É‘ô(€€€€€€€€€€€€€€€€€•™™•Ñ•Ñ…¥°õí•™™•Ñ•Ñ…¥±ôÍ•Ñ™™•Ñ•Ñ…¥°õíÍ•Ñ™™•Ñ•Ñ…¥±ô(€€€€€€€€€€€€€€€€€Í¡…Á•5•¹ÔõíÍ¡…Á•5•¹ÕôÍ•ÑM¡…Á•5•¹ÔõíÍ•ÑM¡…Á•5•¹Õô(€€€€€€€€€€€€€€€€€Í¡…Á•Q½½°õíÍ¡…Á•Q½½±ôÍ•ÑM¡…Á•Q½½°õíÍ•ÑM¡…Á•Q½½±ô(€€€€€€€€€€€€€€€€€ÑÕ¹•Q½½°õíÑÕ¹•Q½½±ôÍ•ÑQÕ¹•Q½½°õíÍ•ÑQÕ¹•Q½½±ô(€€€€€€€€€€€€€€€€€Í•ÑQÕ¹¥¹‘”õíÍ•ÑQÕ¹¥¹‘•ô½Á•¹½µÁ½Í•½Èõí½Á•¹½µÁ½Í•½Éô(€€€€€€€€€€€€€€€€€½µÁ½Í•=Á•¸õì„…½µÁ½Í•MÑ…Ñ•ô½¹1•…Ù•½µÁ½Í”õí…ÁÁ±å½µÁ½Í•Q½1…å•Éô(€€€€€€€€€€€€€€€€€¡¥‘•M¡…Á”õì„…Í•±•±±ô(€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€ô¤ ¥ô((€€€€€€€€€€€í…Ñ¥Ù•Q…ˆ€ôôô€…‘œ€˜˜€ (€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ…àµÜµµµàµ…ÕÑ¼ÍÁ…”µä´Ð…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÌÀÀˆø(€€€€€€€€€€€€€€€í…‘‘MÕˆ€ôôô€Íåµ‰½°œ€ü€ (€€€€€€€€€€€€€€€€€€ñMåµ‰½±A¥­•È(€€€€€€€€€€€€€€€€€€€€€€€½¹	…¬õì ¤€ôøÍ•Ñ‘‘MÕˆ É½½Ðœ¥ô(€€€€€€€€€€€€€€€€€€€€€€€½¹AÉ•Á…É”õì¡Íåµ‰½°¤€ôøìÁÉ•Á…É•‘‘Måµ‰½±1…å•È¡Íåµ‰½°¤ìõô(€€€€€€€€€€€€€€€€€€€€€€€½¹A¥¬õí¡…¹‘±•‘‘Måµ‰½±1…å•Éô(€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€¤€è…‘‘MÕˆ€ôôô€É½½Ðœ€ü€ (€€€€€€€€€€€€€€€€€€¼¨ƒ–·¦†–"–§š:K¾ò3–B’â'¦†Ž(€€€€€€€€€€€€€€€€€€€€ƒž²³’âš:Kšb¿Ž3¦g’â¦‚¢ššRû’î¦êó¦Ë’úŽ7¾ò#’ö#–Æ¾ò?–r[ž&¾ò?–öÇž&¾ò'¾ò0(€€€€€€€€€€€€€€€€€€€€ƒž²³’ê3š:Kšb¿Ž3¦g–,ÁÀƒ¢«–ÞÇžRžjšvÇ¢–ÿŽ7¾ò#šZ–¶_¾ò?ž²›¢f¾ò?–r[–ö‹¾ò'ŠSŠP(€€€€€€€€€€€€€€€€€€€€ƒ¢Þ–&×š?š.ó–r[¦
¦
+žj–"šÎW’â¢ÓŽ(€€€€€€€€€€€€€€€€€€€€ƒ–£¦£šNƒ–r£–B3’âš:Kžj¢¦Çš¾?¦†–>«–&§’â–6–æû–¾³¾ò3–¶_¦÷–þ¯¢Êó–"Ã¦
+’êŽ(€€€€€€€€€€€€€€€€€€€€ƒ–§š:K¦÷žR£–B3’â–,µ…àµß¾ò3š&’î—š¾?¦†š2'¦"W’âš¢–’ŸŽ((€€€€€€€€€€€€€€€€€€€€­•äƒšb¿–þ¢šžj¾òk–§–/–"¦‚žjšr–’[–Æ“¦÷šb¼€ñ‘¥Øû¾ò3šÊKšr$­•äƒžj¢¦Ä(€€€€€€€€€€€€€€€€€€€€I•…Ðƒšrš*+–º–GžVÛš"C–B3’â¦†Ž–>«š>l±…ÍÍ9…µ”ƒŠSŠPƒšZóšb¿šâ–Z»¦
¦
+žj(€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸øƒ¢Š¯žVg’â/’úžnÓš:—¢º+š"C¦g’â¦‚žjš2'¦"W¾ò3¢3š2'¦"W’â+š:o¢F\(€€€€€€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸µ…±³¾ò3–ÂÇ–ú{Ž3¢þS–n{¦6×¦
–/–’Ÿ–Â?Ž7’â¢Þ¿¢Žs¦ZO–"Ãš¶–âã–’Ÿ–Â?Ž(€€€€€€€€€€€€€€€€€€€€ƒ¦
–ÂÇšb¿¢þS–n{šfžr/–"Ãžjš*[–.WŽžÖ›’ê­•äƒ–ÂÇšb¿šVÓž&š>oš:'¾ò3’â7šr¢Žs¦ZOŽ€¨¼(€€€€€€€€€€€€€€€€€€ñ‘¥Ø­•äô‰…‘µÉ½½Ðˆ±…ÍÍ9…µ”ô‰™±•à™±•àµ½°…À´Ä¸ÔµÐ´Øˆø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à©ÕÍÑ¥™äµ•¹Ñ•È…À´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€Í•Ñ1…å½ÕÑMÕ‰Q…ˆ ±…å½ÕÐœ¤ì(€€€€€€€€€€€€€€€€€€€€€Í•ÑÑ¥Ù•Q…ˆ ±…å½ÕÐœ¤ì(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÁä´ÐÁà´Ä‰œµÝ¡¥Ñ”¼Ô‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÌÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀÉ½Õ¹‘•´Éá°ÑÉ…¹Í¥Ñ¥½¸µ…±°…À´È…Ñ¥Ù”éÍ…±”´äÔ™±•à´Äµ…àµÜµlÄÌÁÁátˆ(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñ%½¸¹…µ”ô‰É¥‘}Ù¥•Üˆ±…ÍÍ9…µ”ô‰Ñ•áÐµlÈÑÁátÑ•áÐµÝ¡¥Ñ”¼àÀˆ€¼ø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÍÐÑ•áÐµÝ¡¥Ñ”¼äÀÝ¡¥Ñ•ÍÁ…”µ¹½ÝÉ…ÀˆûšZÃ–Š{’ö#–Æ ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôø™¥±•%¹ÁÕÑI•˜¹ÕÉÉ•¹Ðü¹±¥¬ ¥ô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÁä´ÐÁà´Ä‰œµÝ¡¥Ñ”¼Ô‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÌÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀÉ½Õ¹‘•´Éá°ÑÉ…¹Í¥Ñ¥½¸µ…±°…À´È…Ñ¥Ù”éÍ…±”´äÔ™±•à´Äµ…àµÜµlÄÌÁÁátˆ(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñ%½¸¹…µ”ô‰…‘‘}Á¡½Ñ½}…±Ñ•É¹…Ñ”ˆ±…ÍÍ9…µ”ô‰Ñ•áÐµlÈÑÁátÑ•áÐµÝ¡¥Ñ”¼àÀˆ€¼ø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÍÐÑ•áÐµÝ¡¥Ñ”¼äÀÝ¡¥Ñ•ÍÁ…”µ¹½ÝÉ…Àˆû–2¿–—–r[ž&ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€ì¼¨ƒ–öÇž&¾òk–r[ž’ëžR ±Õ¥‘”ƒžj¥±·¾ò3¢Þ–&×š?š.ó–r[¦
¦†–B3’â–,€¨½ô(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÙ¥‘%¹ÁÕÑI•˜¹ÕÉÉ•¹Ðü¹±¥¬ ¥ô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÁä´ÐÁà´Ä‰œµÝ¡¥Ñ”¼Ô‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÌÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀÉ½Õ¹‘•´Éá°ÑÉ…¹Í¥Ñ¥½¸µ…±°…À´È…Ñ¥Ù”éÍ…±”´äÔ™±•à´Äµ…àµÜµlÄÌÁÁátˆ(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñ¥±´Í¥é”õìÈÑôÍÑÉ½­•]¥‘Ñ õìÄ¸Õô±…ÍÍ9…µ”ô‰Ñ•áÐµÝ¡¥Ñ”½Á…¥Ñä´àÀˆ€¼ø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÍÐÑ•áÐµÝ¡¥Ñ”¼äÀÝ¡¥Ñ•ÍÁ…”µ¹½ÝÉ…Àˆû–2¿–—–öÇž&ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à©ÕÍÑ¥™äµ•¹Ñ•È…À´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôø¡…¹‘±•‘‘Q•áÑ1…å•È ¥ô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÁä´ÐÁà´Ä‰œµÝ¡¥Ñ”¼Ô‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÌÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀÉ½Õ¹‘•´Éá°ÑÉ…¹Í¥Ñ¥½¸µ…±°…À´È…Ñ¥Ù”éÍ…±”´äÔ™±•à´Äµ…àµÜµlÄÌÁÁátˆ(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¢ÞšZ–¶_žÞ£¢ò¿¦v‹švÿ¢Ž‡Ž3–¶_¦®SŽ7¦
’â¦†–B3’â–/–r[ž’ëŽ(€€€€€€€€€€€€€€€€€€€€€€€ƒžÞk–¾³¢ªÿžÒÃ–Â7¦ö+š^¦
+–§¦†5…Ñ•É¥…°ƒ–r[š¢g¾òo¦?šb;–ê›šRçš"Cš:o–r£šVÓ–,(€€€€€€€€€€€€€€€€€€€€€€€ƒ–r[ž’ë’â+¾ò!½Á…¥Ñä´àÃ¾ò'¢3’â7šb¿ž¶žV¯¦†?¢&Ë’â+¾ò!Ñ•áÐµÝ¡¥Ñ”¼àÃ¾ò'ŠSŠP(€€€€€€€€€€€€€€€€€€€€€€€ƒ–6+¦?šb;žjž¶žV¯–r£’ê“žZ+¢fWšržZ+–ëšnÓ’ê»žj’â–†+¾ò3žr/¢Öß’ú–ÂÇšb¿žfóžf÷Ž€¨½ô(€€€€€€€€€€€€€€€€€€€€ñQåÁ”Í¥é”õìÈÑôÍÑÉ½­•]¥‘Ñ õìÄ¸Õô±…ÍÍ9…µ”ô‰Ñ•áÐµÝ¡¥Ñ”½Á…¥Ñä´àÀˆ€¼ø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÍÐÑ•áÐµÝ¡¥Ñ”¼äÀÝ¡¥Ñ•ÍÁ…”µ¹½ÝÉ…ÀˆûšZÃ–Š{šZ–¶\ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€ì¼¨ƒšZÃ–Š{ž²›¢f¾òk–Ÿ–ºç’æ/–ú3–7¢Žs¾ò3–#š*+’ö7žö»¢"–’[¢ž–ºk’â/’ú€¨½ô(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ‘‘MÕˆ Íåµ‰½°œ¥ô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÁä´ÐÁà´Ä‰œµÝ¡¥Ñ”¼Ô‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÌÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀÉ½Õ¹‘•´Éá°ÑÉ…¹Í¥Ñ¥½¸µ…±°…À´È…Ñ¥Ù”éÍ…±”´äÔ™±•à´Äµ…àµÜµlÄÌÁÁátˆ(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€ì¼¨ƒ–r[ž’ë’â7¢÷žR 5…Ñ•É¥…°ƒžj•µ½©¥}Íåµ‰½±Ï¾òk–Â#š†#¢Ž‡¦
’î÷šb¼¨«–¶C¦n¨«¾ò0(€€€€€€€€€€€€€€€€€€€€€€€ƒ–>«š&O–2’êžržjšr'žR£–"Ãžj€ÜÌƒ¦†¾ò1•µ½©¥}Íåµ‰½±Ìƒ’â7–r£¢Ž‡¦vˆƒŠSŠP(€€€€€€€€€€€€€€€€€€€€€€€ƒžR£’êšržnÓš:—š*+Ž1•µ½©¥}Íåµ‰½±ÏŽ7¦g’âË¢.ÇšZ–¶_–6Ã–r£š2'¦"W’â+Ž(€€€€€€€€€€€€€€€€€€€€€€€ƒ¦
šršJCž"š‚ó–¶C¢N/–"Ã¦jS–Ž–§¦†ŽšRçžR£¢Þš^¦
+Ž3šZÃ–Š{šZ–¶_Ž7Ž3šZÃ–Š{–r[–ö‹Ž4(€€€€€€€€€€€€€€€€€€€€€€€ƒ–B3’â––_žj±Õ¥‘”ƒžÞkšŠw–r[ž’ëŽ€¨½ô(€€€€€€€€€€€€€€€€€€€ì¼¨ƒ–r[š¢gžnÓš:—žR£šâ–Z»¢Ž‡žjž²³’êS¦†ž²›¢f¾ò3’âžr/–ÂÇž~—¦O¦g’â¦‚šb¿’î¦êð€¨½ô(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµÝ¡¥Ñ”½Á…¥Ñä´àÀÑ•áÐµlÄÕÁát±•…‘¥¹œµ¹½¹”Ý¡¥Ñ•ÍÁ…”µ¹½ÝÉ…À ´Ø™±•à¥Ñ•µÌµ•¹Ñ•ÈˆùíMe5	=1MlÑuôð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÍÐÑ•áÐµÝ¡¥Ñ”¼äÀÝ¡¥Ñ•ÍÁ…”µ¹½ÝÉ…ÀˆûšZÃ–Š{ž²›¢f|ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ‘‘MÕˆ Í¡…Á”œ¥ô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÁä´ÐÁà´Ä‰œµÝ¡¥Ñ”¼Ô‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÌÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀÉ½Õ¹‘•´Éá°ÑÉ…¹Í¥Ñ¥½¸µ…±°…À´È…Ñ¥Ù”éÍ…±”´äÔ™±•à´Äµ…àµÜµlÄÌÁÁátˆ(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñ	±½­ÌÍ¥é”õìÈÑôÍÑÉ½­•]¥‘Ñ õìÄ¸Õô±…ÍÍ9…µ”ô‰Ñ•áÐµÝ¡¥Ñ”½Á…¥Ñä´àÀÑÉ…¹Í±…Ñ”µàµÁàˆ€¼ø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµÝ¥‘•ÍÐÑ•áÐµÝ¡¥Ñ”¼äÀÝ¡¥Ñ•ÍÁ…”µ¹½ÝÉ…ÀˆûšZÃ–Š{–r[–öˆð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€€€¼¨ƒ¦î{¦ËŽ3šZÃ–Š{–r[–ö‹Ž7š&7žr/–ú_–"Ãžj–r[š†#šâ–Z»Ž(€€€€€€€€€€€€€€€€€€€€ƒ’â'š:K¾òk–¾›–þŽžÒÃš†ŽžÞkšŠw¾ò3¦î{’â’â/–ÂÇ–*ƒ–"Ã¦g’â¦‚žjš¶’â·¦ZLƒŠSŠP(€€€€€€€€€€€€€€€€€€€€ƒ’â7šr¢ÞÏ–:ïžÞ£¢ò¿¦‚¾ò3š&’î—–>¿’î—¦¢F_–*ƒ––÷–æû–/Ž(€€€€€€€€€€€€€€€€€€€€ƒ¾ò!­•äƒžjžBžRÇ¢š/’â+¦v‹¦
’â¦‚¾ò$€¨¼(€€€€€€€€€€€€€€€€€€ñ‘¥Ø­•äô‰…‘µÍ¡…Á”ˆ±…ÍÍ9…µ”ô‰ÁÐ´Äˆø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È…À´Èµˆ´Ìˆø(€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¢Þžfï–—¾ò?–âÏ¢f¦‚¦
¦†–B3š²û¾òk–>«šr'’â–/žº·¦‚·¾ò3šÊKšr'–êW’â/žj–rL€¨½ô(€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ‘‘MÕˆ É½½Ðœ¥ô(€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°ô‹¢þS–nxˆ(€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹¢þS–nxˆ(€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Í¡É¥¹¬´ÀÜ´ä ´ä€µµ°´È™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµÝ¡¥Ñ”¼ØÀ¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”…Ñ¥Ù”éÍ…±”´äÀÑÉ…¹Í¥Ñ¥½¸µm½±½È±ÑÉ…¹Í™½Éµtˆ(€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€ñ%½¸¹…µ”ô‰…ÉÉ½Ý}‰…¬ˆ±…ÍÍ9…µ”ô‰Ñ•áÐµlÈÁÁátˆ€¼ø(€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÁÁát™½¹Ðµ‰½±Ñ•áÐµlŒààátÕÁÁ•É…Í”ÑÉ…­¥¹œµÝ¥‘•ÍÐˆûšZÃ–Š{–r[–öˆð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€¼¨ƒšâ–Z»¢Þ–&×š?š.ó–r[–B3’â’î÷¾òk–¾›–þ¦
š:Kš*+–6–¶_šbš>K–r£–KšVãž²³’ê3¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€ƒ–ú3¦v‹š:—’â+–ú{–r[š†#–¦;’úžj¦
–æû¦†¾òo¦
+š†¦
š:Kš:—ž¦ë–þž&#žj–6–¶_šbŽ(€€€€€€€€€€€€€€€€€€€€€€€€ƒ–7žR µ½Ù•Q¼ƒš*+–§š:Kš:Kš"C–B3š¢žj¦‚–ê?¾ò#šo–þž²°€çŽ–6–¶_šbž²°€ÄÇ¾ò'Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥¹Ì€ô€¡…ÉÈè…¹åmt°¥Ñ•´è…¹ä¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¸€ô…ÉÈ¹Í±¥” ¤ì(€€€€€€€€€€€€€€€€€€€€€€€¸¹ÍÁ±¥”¡5…Ñ ¹µ…à À°¸¹±•¹Ñ €´€Ä¤°€À°¥Ñ•´¤ì(€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸¸ì(€€€€€€€€€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€€€€€€€€€€¼¨¨ƒš*(¥ƒšb¿¦g–/žj¦
’â¦†šB³–"Ãž²°´ƒ–/’ö7žö»¾ò#–úx€Äƒžº_¢Öß¾ò'ŽžR ¥ƒš&û¢3’â7šb¿žR (€€€€€€€€€€€€€€€€€€€€€€€€€ƒ’ö7žö»š&øƒŠSŠPƒšâ–Z»’â·¦ZO–7š>KšZÃ–r[–ö‹šfš&7’â7šr’ö7žžï–"Ã–"—¦†¢ê¯’â+Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐµ½Ù•Q¼€ô€¡…ÉÈè…¹åmt°¥èÍÑÉ¥¹œ°´è¹Õµ‰•È¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¤€ô…ÉÈ¹™¥¹‘%¹‘•à¡è€ôøè¹¥€ôôô¥¤ì(€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡¤€ð€À¤É•ÑÕÉ¸…ÉÈì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¸€ô…ÉÈ¹Í±¥” ¤ì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐmát€ô¸¹ÍÁ±¥”¡¤°€Ä¤ì(€€€€€€€€€€€€€€€€€€€€€€€¸¹ÍÁ±¥”¡5…Ñ ¹µ…à À°´€´€Ä¤°€À°à¤ì(€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸¸ì(€€€€€€€€€€€€€€€€€€€€€ôì(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÍ½±¥‘1¥ÍÐ€ôµ½Ù•Q¼ (€€€€€€€€€€€€€€€€€€€€€€€l¸¸¹¥¹Ì¡}M!A}%Q5L¹™¥±Ñ•È¡¤€ôø¤¹™¥±±•¤°!=1}%Q5}I=ML¤°€¸¸¹!=1}%Q5M}aQIt°(€€€€€€€€€€€€€€€€€€€€€€€€¡•…ÉÐµ˜œ°€ä¤ì(€€€€€€€€€€€€€€€€€€€€€€¼¨ƒ¦
+š†¦
š:Kžj¦‚–ê?¢Þ–¾›–þ¦
š:K–Â7¦ö+¾òkž²°€Øƒ¦†žª¢>Ç–ö‹Žž²°€äƒ¦†šo–þŽ(€€€€€€€€€€€€€€€€€€€€€€€€ƒž²°€ÄÄƒ¦†–6–¶_šb¾ò3–ú3¦v‹š&7š:—šZÃ–*ƒžjš¦‹–rO¾ò?–Bž¢»š¾S’ú/žjš†¾ò?¦nËšr×¾ò?–Â7¢¦Çš†Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±¥¹•1¥ÍÐ€ôµ½Ù•Q¼¡µ½Ù•Q¼¡µ½Ù•Q¼¡µ½Ù•Q¼ (€€€€€€€€€€€€€€€€€€€€€€€l¸¸¹}M!A}%Q5L¹™¥±Ñ•È¡¤€ôø€…¤¹™¥±±•€˜˜€…MA%1}1%9}-%9L¹¡…Ì¡¤¹­¥¹¤¤°!=1}%Q5}I=MM}=t°(€€€€€€€€€€€€€€€€€€€€€€€€‘¥…µ½¹µ¸µ¼œ°€Ø¤°€¡•…ÉÐµ¼œ°€ä¤°€±½Õµ½Ù…°µ¼œ°€ÄÌ¤°€¡½±”µÉ½ÍÌµÍÑ…Èµ¼œ°€ÄÐ¤ì(€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€¡l(€€€€€€€€€€€€€€€€€€€€€€€lŸ–¾›–þœ°Í½±¥‘1¥ÍÐ¹™¥±Ñ•È¡¤€ôø€…I%}M!A}-%9L¹¡…Ì¡¤¹­¥¹¤¥t°(€€€€€€€€€€€€€€€€€€€€€€€lŸ¦
+š†œ°±¥¹•1¥ÍÐ¹™¥±Ñ•È¡¤€ôø€…I%}M!A}-%9L¹¡…Ì¡¤¹­¥¹¤¥t°(€€€€€€€€€€€€€€€€€€€€€€€lŸžÞkšŠtœ°}M!A}%Q5L¹™¥±Ñ•È¡¤€ôøMA%1}1%9}-%9L¹¡…Ì¡¤¹­¥¹¤¥t°(€€€€€€€€€€€€€€€€€€€€€€€lŸžÚËš‚ðœ°}M!A}%Q5L¹™¥±Ñ•È¡¤€ôøI%}M!A}-%9L¹¡…Ì¡¤¹­¥¹¤¥t°(€€€€€€€€€€€€€€€€€€€€€t…Ì½¹ÍÐ¤ì(€€€€€€€€€€€€€€€€€€€ô¤ ¤¹µ…À ¡m±…‰•°°±¥ÍÑt¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø­•äõí±…‰•±ô±…ÍÍ9…µ”ô‰µˆ´Ìˆø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ•áÐµlåÁát™½¹Ðµ‰½±Ñ•áÐµlŒØØÙtµˆ´Ä¸ÔÑÉ…­¥¹œµÝ¥‘•ÍÐˆùí±…‰•±ôð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´Ø…À´Èˆø(€€€€€€€€€€€€€€€€€€€€€€€€€í±¥ÍÐ¹µ…À¡¥Ð€ôø€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí¥Ð¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôø¡…¹‘±•‘‘M¡…Á•1…å•È¡¥Ð¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°õí¥Ð¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰ ´ÄÄÉ½Õ¹‘•µlÄÁÁát‰œµÝ¡¥Ñ”¼Ô‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÌÀ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÄÀ…Ñ¥Ù”éÍ…±”´äÔÑÉ…¹Í¥Ñ¥½¸µ…±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑ•áÐµÝ¡¥Ñ”¼àÔˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¡¥Ð…Ì…¹ä¤¹¡½±”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€ñ!½±•±åÁ Ìõì¡¥Ð…Ì…¹ä¤¹¡½±•ô™¥±±•õì¡¥Ð…Ì…¹ä¤¹™¥±±•‘ô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€ñM¡…Á•±åÁ ¥Ñ•´õí¥Ð…Ì…¹åô€¼ùô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¥ô((€€€€€€€€€€€í…Ñ¥Ù•Q…ˆ€ôôô€±…å½ÕÐœ€˜˜€ (€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ…àµÜµµµàµ…ÕÑ¼ µ™Õ±°™±•à™±•àµÉ½Ü…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÌÀÀˆø(€€€€€€€€€€€€€€€ì¼¨1•™ÐÍ¥‘”è€ÈÍµ…±°¥½¸µ½¹±äÍÕˆµ‰ÕÑÑ½¹ÌÍ•Á…É…Ñ•‰ä„±¥¹”‘¥É•Ñ±ä½¹¹•Ñ•™É½´±•™Ð•‘”Ñ¼É¥¡Ð‰½É‘•È€¨½ô(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à™±•àµ½°Í¡É¥¹¬´ÀÜ´ÄÄ€µµÐ´Ð€µµˆ´Ð€µµ°´Ð‰½É‘•ÈµÈ‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀÍ•±•Ðµ¹½¹”ˆø(€€€€€€€€€€€€€€€€€ì¼¨Q½À¡…±˜è1…å½ÕÐ‰ÕÑÑ½¸€¨½ô(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ1…å½ÕÑMÕ‰Q…ˆ ±…å½ÕÐœ¥ô(€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹’ö#–Æ ˆ(€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°ô‹’ö#–Æ ˆ(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÜµ™Õ±°™±•à´Ä™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°€‘ì(€€€€€€€€€€€€€€€€€€€€€±…å½ÕÑMÕ‰Q…ˆ€ôôô€±…å½ÕÐœ(€€€€€€€€€€€€€€€€€€€€€€€€ü€Ñ•áÐµÝ¡¥Ñ”œ(€€€€€€€€€€€€€€€€€€€€€€€€è€Ñ•áÐµlŒÕ„Õ„Õ…tœ(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñ1…å½ÕÑÉ¥Í¥é”õìÄáô±…ÍÍ9…µ”õíÑÉ…¹Í¥Ñ¥½¸µÑÉ…¹Í™½É´€‘í±…å½ÕÑMÕ‰Q…ˆ€ôôô€±…å½ÕÐœ€ü€Í…±”´ÄÄÀœ€è€œõô€¼ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø((€€€€€€€€€€€€€€€€€ì¼¨¥Ù¥‘•È±¥¹”•á…Ñ±ä¥¸Ñ¡”µ¥‘‘±”½¹¹•Ñ¥¹œ±•™ÐÝ…±°Ñ¼Ù•ÉÑ¥…°‰½É‘•È€¨½ô(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Üµ™Õ±° µlÅÁát‰œµÝ¡¥Ñ”¼ÄÀÍ¡É¥¹¬´Àˆ€¼ø((€€€€€€€€€€€€€€€€€ì¼¨	½ÑÑ½´¡…±˜è‘©ÕÍÐ‰ÕÑÑ½¸€¨½ô(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ1…å½ÕÑMÕ‰Q…ˆ …‘©ÕÍÐœ¥ô(€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹¢ªÿšVÐˆ(€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°ô‹¢ªÿšVÐˆ(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÜµ™Õ±°™±•à´Ä™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°€‘ì(€€€€€€€€€€€€€€€€€€€€€±…å½ÕÑMÕ‰Q…ˆ€ôôô€…‘©ÕÍÐœ(€€€€€€€€€€€€€€€€€€€€€€€€ü€Ñ•áÐµÝ¡¥Ñ”œ(€€€€€€€€€€€€€€€€€€€€€€€€è€Ñ•áÐµlŒÕ„Õ„Õ…tœ(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñM±¥‘•ÉÌÍ¥é”õìÄáô±…ÍÍ9…µ”õíÑÉ…¹Í¥Ñ¥½¸µÑÉ…¹Í™½É´€‘í±…å½ÕÑMÕ‰Q…ˆ€ôôô€…‘©ÕÍÐœ€ü€Í…±”´ÄÄÀœ€è€œõô€¼ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€ì¼¨I¥¡ÐÍ¥‘”½¹Ñ•¹Ð€¨½ô(€€€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à´Ä½Ù•É™±½Üµäµ…ÕÑ¼½Ù•É™±½Üµàµ¡¥‘‘•¸¹¼µÍÉ½±±‰…ÈÁ°´ÌÁÈ´È µ™Õ±°ˆ(€€€€€€€€€€€€€€€€€€¼¨ƒ–"Ã¦‚’ê–7–ú’â+š.'Ž–"Ã–êW’ê–7–ú’â/š.'¦÷’â7¢ššr'¦
’â’â/š¦‡žj»ž¶,(€€€€€€€€€€€€€€€€€€€€ƒ¾ò!½¹Ñ…¥¸ƒ–>«šN/Ž3š*+š6Ë–.W–
ÏžÖ›–’[–Æ“Ž7¾ò3¢«–ÞÇ¦
šb¿šr–ö#¾ò3š&’î—žR ¹½¹—¾ò$€¨¼(€€€€€€€€€€€€€€€€€ÍÑå±”õíì½Ù•ÉÍÉ½±±	•¡…Ù¥½Èè€¹½¹”œõô(€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€í±…å½ÕÑMÕ‰Q…ˆ€ôôô€±…å½ÕÐœ€ü€ (€€€€€€€€€€€€€€€€€€€…±±Q•µÁ±…Ñ•Í±…ÑÑ•¹•¹±•¹Ñ €ø€À€ü€ (€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´ÐÍ´éÉ¥µ½±Ì´Ô…À´ÈÁˆ´ÄÀˆø(€€€€€€€€€€€€€€€€€€€€€€€í…±±Q•µÁ±…Ñ•Í±…ÑÑ•¹•¹µ…À ¡ì½Õ¹Ð°¥‘à°ÑµÁ°°¥ÍÕÉÉ•¹Ñ½Õ¹Ðô¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–>«šr'Ž3žržj¢Š¯¦ã–>[Ž7žj’ö#–Æš&7žº_žn»–&7¦g–/¾òošÊK¦ã’â·–ÂÇ’â–ú/¢š[ž
ëšZÃ–Šx(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ•‘¥Ñ¥¹œ€ôÍ•±•Ñ•‘1…å½ÕÑ%€ü…Ñ¥Ù•A…”¹±…å½ÕÑÌ¹™¥¹¡°€ôø°¹¥€ôôôÍ•±•Ñ•‘1…å½ÕÑ%¤€è¹Õ±°ì(€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¥ÍM•±•Ñ•€ô€„…•‘¥Ñ¥¹œ€˜˜¥ÍÕÉÉ•¹Ñ½Õ¹Ð€˜˜•‘¥Ñ¥¹œ¹Ñ•µÁ±…Ñ•%¹‘•à€ôôô¥‘àì(€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥õí¥ÍM•±•Ñ•€ü€…Ñ¥Ù”µ±…å½ÕÐµ‰ÕÑÑ½¸œ€èÕ¹‘•™¥¹•‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí€‘í½Õ¹Ñô´‘í¥‘áô´‘íÑµÁ°¹¹…µ•õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥Í1…å½ÕÑ¡…¹•I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ–>«šr'Ž3–º3–£šÊK¦ã’â·’ö#–ÆŽ7šfš&7šršZÃ–Š{¾òošr'¦ã’â·–ÂÇšb¿š>oš:'¦
–/’ö#–Æžjž&#–z,(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ …•‘¥Ñ¥¹œ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡…¹‘±•‘‘1…å½ÕÑQ½A…”¡…Ñ¥Ù•A…•%¹‘•à°¥‘à°½Õ¹Ð¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼¼ƒ¦î{–"—žjž&#–z,ƒŠHƒš>oš:'žn»–&7¦ã’â·žj¦g–/’ö#–Æ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡½Õ¹Ð€„ôô¥µ…•Ì¹±•¹Ñ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ%µ…•Ì¡ÁÉ•Ø€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡½Õ¹Ð€øÁÉ•Ø¹±•¹Ñ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•Ý•±±Ì€ôÉÉ…ä¹™É½´¡ì±•¹Ñ è½Õ¹Ð€´ÁÉ•Ø¹±•¹Ñ ô¤¹µ…À ¡|°¤¤€ôø€¡ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥è•µÁÑä´‘í…Ñ”¹¹½Ü ¥ô´‘í¥õ€°(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÕÉ°è€œœ°™¥±”èÕ¹‘•™¥¹•°é½½´è€Ä¸À°½™™Í•Ñ`è€À°½™™Í•Ñdè€À°É½Ñ…Ñ¥½¸è€À(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸l¸¸¹ÁÉ•Ø°€¸¸¹¹•Ý•±±Ítì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ÁÉ•Ø¹Í±¥” À°½Õ¹Ð¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑQ•µÁ±…Ñ•%¹‘•à¡¥‘à¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÀ´Ä¸ÔÉ½Õ¹‘•µá°‰½É‘•È™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´Ä¸ÔÑÉ…¹Í¥Ñ¥½¸µ…±°Ñ•áÐµ•¹Ñ•È…ÍÁ•ÐµÍÅÕ…É”€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ÍM•±•Ñ•(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰œµÝ¡¥Ñ”½lÀ¸ÀÉt‰½É‘•ÈµÝ¡¥Ñ”Í¡…‘½ÜµlÁ|Á|ÄÉÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸ÀÔ¥t½Á…¥Ñä´ÄÀÀœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‰œµÝ¡¥Ñ”½lÀ¸ÀÉt‰½É‘•ÈµÝ¡¥Ñ”¼Ô¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÄÔ¡½Ù•Èé‰œµÝ¡¥Ñ”½lÀ¸ÀÑt€œ€¬€¡¥ÍÕÉÉ•¹Ñ½Õ¹Ð€ü€½Á…¥Ñä´äÀœ€è€½Á…¥Ñä´ÐÀœ¤(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”õí€‘í½Õ¹Ñ÷–òÔè€‘íÑµÁ°¹¹…µ•õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÙœÙ¥•Ý	½àôˆÀ€À€ÄÀÀ€ÄÀÀˆ±…ÍÍ9…µ”ô‰Üµ™Õ±° µ™Õ±°Ñ•áÐµÝ¡¥Ñ”¼ØÀˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€íÑµÁ°¹É•ÑÌ¹µ…À ¡É•Ð°É%‘à¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÉ•Ð(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõíÉ%‘áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€àõíÉ•Ð¹à€¨€ÄÀÀ€¬€Ñô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€äõíÉ•Ð¹ä€¨€ÄÀÀ€¬€Ñô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ý¥‘Ñ õíÉ•Ð¹Ü€¨€ÄÀÀ€´€áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•¥¡ÐõíÉ•Ð¹ €¨€ÄÀÀ€´€áô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÉàõìÑô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥±°ô‰ÕÉÉ•¹Ñ½±½Èˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€™¥±±=Á…¥ÑäôˆÀ¸Äˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑÉ½­”ô‰ÕÉÉ•¹Ñ½±½Èˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑÉ½­•]¥‘Ñ ôˆÐˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰½Á…¥Ñä´àÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½ÍÙœø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€ô¥ô(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ•áÐµáÌÑ•áÐµÝ¡¥Ñ”¼ÐÀÑ•áÐµ•¹Ñ•ÈÁä´Ðˆø(€€€€€€€€€€€€€€€€€€€€€€€ƒ¢®/–#šZÃ–Š{š‚ó–¶C’î—¦ãšNš‚ó–ÆŽ(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€¤(€€€€€€€€€€€€€€€€€€¤€è€…Í•±•Ñ•‘1…å½ÕÑ%€ü€ (€€€€€€€€€€€€€€€€€€€€¼¨ƒšÊK¦ã’â·’ö#–Æ–ÂÇ’â7ž~—¦O¢š¢ªÿ–N«’â–/¾ò3šîGš†ÿšVÓžÖ’â7¦†¿ž’è€¨¼(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ µ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÁà´Ðˆø(€€€€€€€€€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±ÑÉ…­¥¹œµlÀ¸ÄÕ•µtÑ•áÐµÝ¡¥Ñ”¼ÐÀÑ•áÐµ•¹Ñ•Èˆø(€€€€€€€€€€€€€€€€€€€€€€€ƒ–#¦î{šN+’â’â/¢š¢ªÿšVÓžj’ö#–Æ (€€€€€€€€€€€€€€€€€€€€€€ð½Àø(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€€€€€¼¨‘©ÕÍÑµ•¹ÐÍ±¥‘•ÉÌ€´Ñ½À…±¥¹•°Íµ½½Ñ …¹ÍÑ…‰±”Ý¥Ñ¡½ÕÐ±…å½ÕÐ©¥ÑÑ•È€¨¼(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÍÁ…”µä´ÐÁÐ´È¸ÔÁˆ´ÈÐÁà´Äµ…àµÜµáÌˆø(€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¦g–/’ö#–Æ¢«–ÞÇžjš¾S’ú/Ž¢Þšr–Þ›¦
+¦
’â¦‚žjŽ3ž&#–z/š¾S’ú/Ž7šb¿–§–n{’ê/¾òh(€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¦
¦
+¢ªÿžjšb¿šVÓ–ò×¦‚¦v‹¾ò3¦g¢Ž‡–>«¢ªÿ¦ã’â·žj¦g’â–/’ö#–ÆŽ(€€€€€€€€€€€€€€€€€€€€€€€€€ƒš2'¦6×š¢–ò?¢Þ¦
’â¦‚–B3’â––_¾òožnÓ–ò?¾ò?š¦¯–ò?’â7–7–2’â–Æ“–êW¢&Ëš‚ó–¶C¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€ƒšRçš"C¢Þ’â+¦v‹–B3’âž¢¸É¥“¾ò#–B3š¢žj…Ã¾ò'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€ƒš&’î—–§¦†žj–Þ›–>Ï–’[žÞ–&o––÷–Â7¦ö+’â+¦v‹¦
š:Kš¾S’ú/¦6×Ž(€€€€€€€€€€€€€€€€€€€€€€€€€ƒ–7š2'’âš²‡–B3’â¦†š¾S’ú/–ÂÇ–>[šÚ#¾ò3–n{–"ÃŽ3¢Þ¦‚¦v‹’âš¢Ž7Ž€¨½ô(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÍÁ…”µä´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¦g’âš:K–>«šRû–B7ž¢ÇŽ–>Ï¦
+šr³’úšr–7–¾¯’âš²‡žn»–&7žjš¾S’ú/¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ’ö’â/¦v‹¦
’êS¦†š2'¦"W¢«–ÞÇ–ÂÇšr–>7žf÷š¢gž’ë¾ò3–¾¯–§š²‡šb¿¦7¢’žjŽ€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±Ñ•áÐµÝ¡¥Ñ”¼ÜÀˆûš¾S’ú,ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´Ô…À´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€€€€€€€€€íIQ%=L¹µ…À ¡¥Ñ•´¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€­•äõí¥Ñ•´¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°¤Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Á…Ñ¡1…å½ÕÑM¡…Á”¡ìÉ…Ñ¥¼è±…å½ÕÑI…Ñ¥¼€ôôô¥Ñ•´¹¥€üÕ¹‘•™¥¹•€è¥Ñ•´¹¥ô¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÀ´ÄÁä´ÌÉ½Õ¹‘•µá°‰½É‘•ÈÑ•áÐµ•¹Ñ•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…å½ÕÑI…Ñ¥¼€ôôô¥Ñ•´¹¥(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰œµÝ¡¥Ñ”‰½É‘•ÈµÝ¡¥Ñ”Ñ•áÐµ‰±…¬™½¹Ðµ•áÑÉ…‰½±Í¡…‘½ÜµlÁ|ÑÁá|ÄÙÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸ÄÔ¥tœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‰œµÝ¡¥Ñ”½lÀ¸ÀÉt‰½É‘•ÈµÝ¡¥Ñ”¼Ô¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÄÔÑ•áÐµÝ¡¥Ñ”¼ÜÀ¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ•áÐµáÌ™½¹Ðµµ½¹¼ÑÉ…­¥¹œµÝ¥‘•Èˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í¥Ñ•´¹¥€ôôô€œÄèÄœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€œÄèÄœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è±…å½ÕÑ1…¹‘Í…Á”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‘í¥Ñ•´¹¥¹ÍÁ±¥Ð œèœ¥lÅuôè‘í¥Ñ•´¹¥¹ÍÁ±¥Ð œèœ¥lÁuõ€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è¥Ñ•´¹¹…µ•ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´È…À´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì¥˜€¡Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°¤Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ìÁ…Ñ¡1…å½ÕÑM¡…Á”¡ì±…¹‘Í…Á”è™…±Í”ô¤ìõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÁä´È¸ÔÉ½Õ¹‘•µá°‰½É‘•ÈÑ•áÐµáÌ™½¹Ðµ‰½±ÑÉ…¹Í¥Ñ¥½¸µ…±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´È€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…±…å½ÕÑ1…¹‘Í…Á”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰œµÝ¡¥Ñ”‰½É‘•ÈµÝ¡¥Ñ”Ñ•áÐµ‰±…¬™½¹Ðµ•áÑÉ…‰½±Í¡…‘½ÜµlÁ|ÑÁá|ÄÙÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸ÄÔ¥tœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‰œµÝ¡¥Ñ”½lÀ¸ÀÉt‰½É‘•ÈµÝ¡¥Ñ”¼Ô¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÄÔÑ•áÐµÝ¡¥Ñ”¼ÜÀ¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñMµ…ÉÑÁ¡½¹”Í¥é”õìÄÑô±…ÍÍ9…µ”ô‰É½Ñ…Ñ”´ÀÍ¡É¥¹¬´Àˆ€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ûžnÓ–ò<ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì¥˜€¡Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°¤Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ìÁ…Ñ¡1…å½ÕÑM¡…Á”¡ì±…¹‘Í…Á”èÑÉÕ”ô¤ìõô(€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÁä´È¸ÔÉ½Õ¹‘•µá°‰½É‘•ÈÑ•áÐµáÌ™½¹Ðµ‰½±ÑÉ…¹Í¥Ñ¥½¸µ…±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´È€‘ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…å½ÕÑ1…¹‘Í…Á”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰œµÝ¡¥Ñ”‰½É‘•ÈµÝ¡¥Ñ”Ñ•áÐµ‰±…¬™½¹Ðµ•áÑÉ…‰½±Í¡…‘½ÜµlÁ|ÑÁá|ÄÙÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸ÄÔ¥tœ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‰œµÝ¡¥Ñ”½lÀ¸ÀÉt‰½É‘•ÈµÝ¡¥Ñ”¼Ô¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÄÔÑ•áÐµÝ¡¥Ñ”¼ÜÀ¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”œ(€€€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñMµ…ÉÑÁ¡½¹”Í¥é”õìÄÑô±…ÍÍ9…µ”ô‰É½Ñ…Ñ”´äÀÍ¡É¥¹¬´Àˆ€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ûš¦¯–ò<ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€€€€€€ì¼¨…ÀÍ±¥‘•È€¨½ô(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÍÁ…”µä´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à©ÕÍÑ¥™äµ‰•ÑÝ••¸Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±Ñ•áÐµÝ¡¥Ñ”¼ÜÀˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸û¦ZO¢Þtð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰™½¹Ðµµ½¹¼Ñ•áÐµÝ¡¥Ñ”ˆùí…ÁõÁàð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰É…¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¸ôˆÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€µ…àôˆÈÔˆ(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑ•ÀôˆÄˆ(€€€€€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí…Áô(€€€€€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°¤Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ…À¡Á…ÉÍ•%¹Ð¡”¹Ñ…É•Ð¹Ù…±Õ”¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰ÁÉ•µ¥Õ´µÍ±¥‘•ÈÜµ™Õ±°ˆ(€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€€€€€€ì¼¨I…‘¥ÕÌÍ±¥‘•È€¨½ô(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÍÁ…”µä´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à©ÕÍÑ¥™äµ‰•ÑÝ••¸Ñ•áÐµlÄÅÁát™½¹Ðµ‰½±Ñ•áÐµÝ¡¥Ñ”¼ÜÀˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸û–rO¢žHð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰™½¹Ðµµ½¹¼Ñ•áÐµÝ¡¥Ñ”ˆùíÉ…‘¥ÕÍõÁàð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰É…¹”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€µ¥¸ôˆÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€µ…àôˆÌÀˆ(€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑ•ÀôˆÄˆ(€€€€€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õíÉ…‘¥ÕÍô(€€€€€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡”¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Í•±•Ñ•‘%¹‘•à€„ôô¹Õ±°¤Í•ÑM•±•Ñ•‘%¹‘•à¡¹Õ±°¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑI…‘¥ÕÌ¡Á…ÉÍ•%¹Ð¡”¹Ñ…É•Ð¹Ù…±Õ”¤¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰ÁÉ•µ¥Õ´µÍ±¥‘•ÈÜµ™Õ±°ˆ(€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¥ô((€€€€€€€€€€€í…Ñ¥Ù•Q…ˆ€ôôô€É…Ñ¥¼œ€˜˜€ (€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ…àµÜµµµàµ…ÕÑ¼ÍÁ…”µä´Ð…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÌÀÀˆø(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´Ô…À´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€íIQ%=L¹µ…À ¡¥Ñ•´¤€ôø€ (€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€­•äõí¥Ñ•´¹¥‘ô(€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•ÑM•±•Ñ•‘I…Ñ¥¼¡¥Ñ•´¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÀ´ÄÁä´Ì¸ÔÉ½Õ¹‘•µá°‰½É‘•ÈÑ•áÐµ•¹Ñ•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È€‘ì(€€€€€€€€€€€€€€€€€€€€€€€Í•±•Ñ•‘I…Ñ¥¼€ôôô¥Ñ•´¹¥(€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰œµÝ¡¥Ñ”‰½É‘•ÈµÝ¡¥Ñ”Ñ•áÐµ‰±…¬™½¹Ðµ•áÑÉ…‰½±Í¡…‘½ÜµlÁ|ÑÁá|ÄÙÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸ÄÔ¥tœ(€€€€€€€€€€€€€€€€€€€€€€€€€€è€‰œµÝ¡¥Ñ”½lÀ¸ÀÉt‰½É‘•ÈµÝ¡¥Ñ”¼Ô¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÄÔÑ•áÐµÝ¡¥Ñ”¼ÜÀ¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”œ(€€€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ•áÐµáÌ™½¹Ðµµ½¹¼ÑÉ…­¥¹œµÝ¥‘•Èˆø(€€€€€€€€€€€€€€€€€€€€€€€ì  ¤€ôøì(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡¥Ñ•´¹¥€ôôô€œÄèÄœ¤É•ÑÕÉ¸€œÄèÄœì(€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡¥Í1…¹‘Í…Á”¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐmÜ°¡t€ô¥Ñ•´¹¥¹ÍÁ±¥Ð œèœ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€‘í¡ôè‘íÝõ€ì(€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸¥Ñ•´¹¹…µ”ì(€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ‰•ÑÝ••¸‰œµÝ¡¥Ñ”½lÀ¸ÀÉt‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÔÀ´ÄÉ½Õ¹‘•µá°…À´Äˆø(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ%Í1…¹‘Í…Á”¡™…±Í”¥ô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí™±•à´ÄÁä´È¸ÔÉ½Õ¹‘•µ±œÑ•áÐµáÌ™½¹Ðµ‰½±ÑÉ…¹Í¥Ñ¥½¸µ…±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´È€‘ì(€€€€€€€€€€€€€€€€€€€€€€…¥Í1…¹‘Í…Á”(€€€€€€€€€€€€€€€€€€€€€€€€ü€‰œµÝ¡¥Ñ”Ñ•áÐµ‰±…¬™½¹Ðµ•áÑÉ…‰½±Í¡…‘½ÜµlÁ|ÉÁá|áÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸Ä¥tœ(€€€€€€€€€€€€€€€€€€€€€€€€è€Ñ•áÐµÝ¡¥Ñ”¼ÔÀ¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”œ(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñMµ…ÉÑÁ¡½¹”Í¥é”õìÄÑô±…ÍÍ9…µ”ô‰É½Ñ…Ñ”´ÀÍ¡É¥¹¬´Àˆ€¼ø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ûžnÓ–ò<ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ%Í1…¹‘Í…Á”¡ÑÉÕ”¥ô(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí™±•à´ÄÁä´È¸ÔÉ½Õ¹‘•µ±œÑ•áÐµáÌ™½¹Ðµ‰½±ÑÉ…¹Í¥Ñ¥½¸µ…±°™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…À´È€‘ì(€€€€€€€€€€€€€€€€€€€€€¥Í1…¹‘Í…Á”(€€€€€€€€€€€€€€€€€€€€€€€€ü€‰œµÝ¡¥Ñ”Ñ•áÐµ‰±…¬™½¹Ðµ•áÑÉ…‰½±Í¡…‘½ÜµlÁ|ÉÁá|áÁá}É‰„ ÈÔÔ°ÈÔÔ°ÈÔÔ°À¸Ä¥tœ(€€€€€€€€€€€€€€€€€€€€€€€€è€Ñ•áÐµÝ¡¥Ñ”¼ÔÀ¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”œ(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñMµ…ÉÑÁ¡½¹”Í¥é”õìÄÑô±…ÍÍ9…µ”ô‰É½Ñ…Ñ”´äÀÍ¡É¥¹¬´Àˆ€¼ø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ûš¦¯–ò<ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¥ô((€€€€€€€€€€€í…Ñ¥Ù•Q…ˆ€ôôô€½±½Èœ€˜˜€¡½±½ÉMÕˆ€ôôô€ÍÑÉ¥Á•œñð½±½ÉMÕˆ€ôôô€ÍÑÉ¥Á•œ¤€˜˜€ (€€€€€€€€€€€€€€¼¨ƒšŠwžÒ/žj–§–/¦†?¢&Ë¾òk¢ÞžÒ/žB¦†?¢&Ë–B3’â¦‚Ž–B3’âžÖ¢&Ëž– €¨¼(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ…àµÜµµµàµ…ÕÑ¼…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÈÀÀ µ™Õ±°½Ù•É™±½Üµäµ…ÕÑ¼½Ù•É™±½Üµàµ¡¥‘‘•¸¹¼µÍÉ½±±‰…ÈÁˆ´ÄØˆø(€€€€€€€€€€€€€€€€ñ‘¥Øø(€€€€€€€€€€€€€€€€€€ñ½±½ÉA¥­•Éµ‰•‘‘•(€€€€€€€€€€€€€€€€€€€½±½Èõí½±½ÉMÕˆ€ôôô€ÍÑÉ¥Á•œ€üÍÑÉ¥Á•€èÍÑÉ¥Á•	ô(€€€€€€€€€€€€€€€€€€€½±½ÉÌõíQa}M]Q!Mô(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡ŒèÍÑÉ¥¹œ¤€ôøÁ…Ñ¡A…ÑÑ•É¸¡½±½ÉMÕˆ€ôôô€ÍÑÉ¥Á•œ€üìÍÑÉ¥Á•èŒô€èìÍÑÉ¥Á•èŒô¥ô(€€€€€€€€€€€€€€€€€€€½¹±½Í”õì ¤€ôøÍ•Ñ½±½ÉMÕˆ ‰œœ¥ô(€€€€€€€€€€€€€€€€€€€¡•…‘•É1•™Ðõì(€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ½±½ÉMÕˆ ‰œœ¥ô(€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È…À´ÄÁà´È ´ÜÉ½Õ¹‘•µlÑÁátÑ•áÐµlÄÁÁát™½¹Ðµ‰½±Ñ•áÐµlŒààát¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”¡½Ù•Èé‰œµlŒÅ„Å„Å…tÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌˆ(€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€ñ¡•ÙÉ½¹1•™ÐÍ¥é”õìÄÑô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸û¢þS–nxð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¥ô((€€€€€€€€€€€í…Ñ¥Ù•Q…ˆ€ôôô€½±½Èœ€˜˜½±½ÉMÕˆ€ôôô€Á…ÑÑ•É¸œ€˜˜€ (€€€€€€€€€€€€€€¼¨ƒžÒ/žB–Â#–Æ³žj¢ªÿ¢&Ë¦‚¾òk–ú{žÒ/žB¦
’âš:Kžj¢&Ë–†+¦î{¦Ë’ú¾ò3¢Þ–&×š?š.ó–r[’âš¢Ž(€€€€€€€€€€€€€€€€ƒš2G¢&Ë–f£šr³¢ê¯žR£žjšb¿¢Þ–êW¢&Ë–º3–£–B3’â¦†–’îÛŽ€¨¼(€€€€€€€€€€€€€€ñ‘¥ØÉ•˜õí½±½ÉQ…‰I•™ô±…ÍÍ9…µ”ô‰µ…àµÜµµµàµ…ÕÑ¼…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÈÀÀ µ™Õ±°½Ù•É™±½Üµäµ…ÕÑ¼½Ù•É™±½Üµàµ¡¥‘‘•¸¹¼µÍÉ½±±‰…ÈÁˆ´ÄØˆø(€€€€€€€€€€€€€€€ì¼¨ƒ¢þS–n{¦6×’ê“žÖ›š2G¢&Ë–f£šRû–r£¦‚–"_¾ò3¢&Ë¢f¢Þ–º–æÏ¢†0ƒŠSŠP(€€€€€€€€€€€€€€€€€€€ƒ¢&Ëž–£¦
’âš:K–ÂÇšVÓš:K¦÷šb¿¢&Ëž–£¾ò3’â7šr¢Š¯¢&Ë¢fšNƒš:'’â–’Ÿš"«Ž€¨½ô(€€€€€€€€€€€€€€€€ñ‘¥Øø(€€€€€€€€€€€€€€€€€€ñ½±½ÉA¥­•Éµ‰•‘‘•(€€€€€€€€€€€€€€€€€€€½±½ÈõíÁ…ÑÑ•É¹½±½Éô(€€€€€€€€€€€€€€€€€€€½±½ÉÌõíQa}M]Q!Mô(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õíÍ•ÑA…ÑÑ•É¹½±½Éô(€€€€€€€€€€€€€€€€€€€½¹±½Í”õì ¤€ôøÍ•Ñ½±½ÉMÕˆ ‰œœ¥ô(€€€€€€€€€€€€€€€€€€€¡•…‘•É1•™Ðõì(€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ½±½ÉMÕˆ ‰œœ¥ô(€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È…À´ÄÁà´È ´ÜÉ½Õ¹‘•µlÑÁátÑ•áÐµlÄÁÁát™½¹Ðµ‰½±Ñ•áÐµlŒààát¡½Ù•ÈéÑ•áÐµÝ¡¥Ñ”¡½Ù•Èé‰œµlŒÅ„Å„Å…tÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌˆ(€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€ñ¡•ÙÉ½¹1•™ÐÍ¥é”õìÄÑô€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸û¢þS–nxð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ ´Èˆ€¼ø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¥ô((€€€€€€€€€€€í…Ñ¥Ù•Q…ˆ€ôôô€½±½Èœ€˜˜½±½ÉMÕˆ€ôôô€‰œœ€˜˜€ (€€€€€€€€€€€€€€¼¨ƒ’â+¦v‹šb¿–:šr³žj–êW¢&Ëš2G¢&Ë–f£¾ò#’â–/–¶_šÊK–.W¾ò'¾ò3’â/¦v‹žÞ+š:—¢F_¢3šf¿žÒ/žBŽ(€€€€€€€€€€€€€€€€ƒ¦g’â¦‚š¾S–:šr³¦®c¾ò3š&’î—¢«–ÞÇš6ÈƒŠSŠPƒ–’[–Æ“¦
’âš‚óžj½Ù•É™±½Üƒ–B7–Z¸(€€€€€€€€€€€€€€€€ƒšb¿š&šr'–"¦‚–ÇžR£žj¾ò3–º3–£šÊK–.W¾ò3–"—žj–"¦‚’â7–>_–öÇ¦~ÿŽ€¨¼(€€€€€€€€€€€€€€ñ‘¥ØÉ•˜õí½±½ÉQ…‰I•™ô±…ÍÍ9…µ”ô‰µ…àµÜµµµàµ…ÕÑ¼…¹¥µ…Ñ”µ¥¸™…‘”µ¥¸‘ÕÉ…Ñ¥½¸´ÌÀÀ µ™Õ±°½Ù•É™±½Üµäµ…ÕÑ¼½Ù•É™±½Üµàµ¡¥‘‘•¸¹¼µÍÉ½±±‰…ÈÁˆ´ÄØˆø(€€€€€€€€€€€€€€€ì¼¨ƒ–’[¦v‹–2’â–Æ“¦®c–ê˜…ÕÑ¼ƒžjžnK–¶C¾òi½±½ÉA¥­•Éµ‰•‘‘•ƒžjš‚çšb¼ µ™Õ±³¾ò0(€€€€€€€€€€€€€€€€€€€€ƒžnÓš:—šRû–r£¦g–/Ž3šr'–në–ºk¦®c–ê›Ž7žjš6Ë–.Wš‚ó¢Ž‡šršVÓ–/šJCšîÿ¾ò3š*+’â/¦v‹žjžÒ/žB(€€€€€€€€€€€€€€€€€€€€ƒš:£–"Ã–ú#¦ƒŽ–2’â–Æ“’æ/–ú0€ÄÀÀ”ƒšr¢žšzCš"@…ÕÑ¿¾ò3–º–ÂÇ–>«’öS¢«–ÞÇ¦r¢šžj¦®c–ê›Ž€¨½ô(€€€€€€€€€€€€€€€€ñ‘¥Øø(€€€€€€€€€€€€€€€€€€ñ½±½ÉA¥­•Éµ‰•‘‘•(€€€€€€€€€€€€€€€€€€€½±½Èõí‰½±½Éô(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õíÍ•Ñ	½±½Éô(€€€€€€€€€€€€€€€€€€€½¹±½Í”õì ¤€ôøÍ•ÑÑ¥Ù•Q…ˆ ±…å½ÕÐœ¥ô(€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€ì¼¨ƒžÒ/žBšVÓžÖšRÛ–r£–B3’âš‚ó¢Ž‡¾òk¦ã¦‚Ž¦†?¢&ËŽ–§š‚çšîGš†ÿ¦÷–r£–B3’â–/š†–ŸŽ(€€€€€€€€€€€€€€€€€€€µÐ´Ôƒšb¿ž
ë’ê¢Þ’â+¦v‹žj–êW¢&Ëš2G¢&Ë–f£š.'¦Z/’â¦î{¢Þw¦n‹Ž€¨½ô(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µÐ´Ôˆø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‰œµlŒÄÄÅt‰½É‘•È‰½É‘•ÈµlŒÈÈÉtÉ½Õ¹‘•µlÙÁát½Ù•É™±½Üµ¡¥‘‘•¸ˆø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ µlÐÝÁát™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ‰•ÑÝ••¸Áà´Ìˆø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlÄÁÁát™½¹Ðµ‰½±Ñ•áÐµlŒààátˆûžÒ/žBð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¦†?¢&Ë¢ÞžÒ/žB¦ã¦‚–B3’âš:K¾òk¦î{¢&Ë–†+š&7¦ËžÒ/žB–Â#–Æ³žj¢ªÿ¢&Ë¦‚€¨½ô(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È…À´Èˆø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à‰œµlŒÁ„Á„Á…t‰½É‘•È‰½É‘•ÈµlŒÈÈÉtÀ´À¸ÔÉ½Õ¹‘•µlÑÁátˆø(€€€€€€€€€€€€€€€€€€€€€€€€€íQa}=AQ%=9L¹µ…À ¡mÐ°±…‰•±t¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸­•äõíÑô½¹±¥¬õì ¤€ôøÍ•ÑA…ÑÑ•É¹QåÁ”¡Ð¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÁà´È ´ØÑ•áÐµlÄÁÁát™½¹Ðµ‰½±É½Õ¹‘•µlÉÁátÑÉ…¹Í¥Ñ¥½¸µ…±°€‘íÁ…ÑÑ•É¹QåÁ”€ôôôÐ€ü€‰œµlŒÌÌÍtÑ•áÐµÝ¡¥Ñ”Í¡…‘½ÜµÍ´œ€è€Ñ•áÐµlŒÔÔÕt¡½Ù•ÈéÑ•áÐµlŒààátõôø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í±…‰•±ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€ì¼¨ƒ¦†?¢&Ëš‚ó–âã¦žC¾òk¦^s¦Z'šf’æžr/–ú_–"Ã¾ò#–>¿’î—–#š2G––÷¦†?¢&Ë–7š&O¦Z/¾ò'¾ò0(€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¢3’âS–"š>ošf¦g’â–"_žj–¾³–ê›’â7šr¢º+¾ò3–ÂÇ’â7šr¦Z’â’â/Ž(€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒšŠwžÒ/šr'–§–/¦†?¢&Ë¾ò3š&’î—šRû–§–†+–Â?žjŽ€¨½ô(€€€€€€€€€€€€€€€€€€€€€€€íÁ…ÑÑ•É¹QåÁ”€ôôô€ÍÑÉ¥Á”œ€ü€ (€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È…À´Äˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ½±½ÉMÕˆ ÍÑÉ¥Á•œ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹šŠwžÒ/¦†?¢&Ë’â ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ü´Ø ´ØÉ½Õ¹‘•µlÑÁátÍ¡É¥¹¬´À‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀÍ¡…‘½Üµ¥¹¹•È¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÐÀÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì‰…­É½Õ¹‘½±½ÈèÍÑÉ¥Á•õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ½±½ÉMÕˆ ÍÑÉ¥Á•œ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹šŠwžÒ/¦†?¢&Ë’ê0ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ü´Ø ´ØÉ½Õ¹‘•µlÑÁátÍ¡É¥¹¬´À‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀÍ¡…‘½Üµ¥¹¹•È¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÐÀÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì‰…­É½Õ¹‘½±½ÈèÍÑÉ¥Á•õô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ½±½ÉMÕˆ Á…ÑÑ•É¸œ¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹žÒ/žB¦†?¢&Èˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ü´à ´ØÉ½Õ¹‘•µlÑÁátÍ¡É¥¹¬´À‰½É‘•È‰½É‘•ÈµÝ¡¥Ñ”¼ÄÀÍ¡…‘½Üµ¥¹¹•È¡½Ù•Èé‰½É‘•ÈµÝ¡¥Ñ”¼ÐÀÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑå±”õíì‰…­É½Õ¹‘½±½ÈèÁ…ÑÑ•É¹½±½Èõô(€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€íÁ…ÑÑ•É¹QåÁ”€ôôô€ÍÑÉ¥Á”œ€ü€ (€€€€€€€€€€€€€€€€€€€€€€¼¨ƒšŠwžÒ/šÊKšr'¦ZO¢Þw¾ò#’âšŠwš:—¢F_’âšŠw¾ò'¾ò3–>«šr'šŠwšVã¾òo–>Ï¦
+¦
’âš‚óšb¿šZç–BGŽ(€€€€€€€€€€€€€€€€€€€€€€€€ƒšîGš†ÿ–Þ›–>Ï–BžVd€áÁã¾ò3žV¯–ë’úžjžÞkš&7šršRÛ–r£¢«–ÞÇ¦
’âš²¢Ž‡Ž€¨¼(€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´È…Àµà´Ü…Àµä´ÐÁà´ÌÁÐ´ÈÁˆ´Ì‰½É‘•ÈµÐ‰½É‘•ÈµlŒÅŒÅŒÅt¥Ñ•µÌµ•¹ˆø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Áà´Èˆø(€€€€€€€€€€€€€€€€€€€€€€€€€íÁ…ÑÑ•É¹M±¥‘•È ŸšVã¦<œ°ÍÑÉ¥Á•8°€¡Øè¹Õµ‰•È¤€ôøÁ…Ñ¡A…ÑÑ•É¸¡ìÍÑÉ¥Á•8èØô¤°MQI%A}9}5`¥ô(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à™±•àµ½°…À´Ä¸Ôˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áÐµlåÁát™½¹Ðµ‰½±Ñ•áÐµlŒØØÙtÑÉ…­¥¹œµÑ¥¡Ñ•ÈÕÁÁ•É…Í”ˆûšZç–BDð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à‰œµlŒÁ„Á„Á…t‰½É‘•È‰½É‘•ÈµlŒÈÈÉtÀ´À¸ÔÉ½Õ¹‘•µlÑÁátˆø(€€€€€€€€€€€€€€€€€€€€€€€€€€€íMQI%A}%IL¹µ…À ¡m°±…‰•±t¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸­•äõí‘ô½¹±¥¬õì ¤€ôøÁ…Ñ¡A…ÑÑ•É¸¡ìÍÑÉ¥Á•¥Èèô¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí™±•à´Ä ´ØÑ•áÐµlÄÁÁát™½¹Ðµ‰½±É½Õ¹‘•µlÉÁátÑÉ…¹Í¥Ñ¥½¸µ…±°€‘íÍÑÉ¥Á•¥È€ôôô€ü€‰œµlŒÌÌÍtÑ•áÐµÝ¡¥Ñ”Í¡…‘½ÜµÍ´œ€è€Ñ•áÐµlŒÔÔÕt¡½Ù•ÈéÑ•áÐµlŒààátõôø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í±…‰•±ô(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€¤€èÁ…ÑÑ•É¹QåÁ”€„ôô€¹½¹”œ€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É¥É¥µ½±Ì´È…Àµà´Ü…Àµä´ÐÁà´ÌÁÐ´ÈÁˆ´Ì‰½É‘•ÈµÐ‰½É‘•ÈµlŒÅŒÅŒÅtˆø(€€€€€€€€€€€€€€€€€€€€€€€íÁ…ÑÑ•É¹M±¥‘•È Ÿ–’Ÿ–Â<œ°Á…ÑÑ•É¹M¥é”°Í•ÑA…ÑÑ•É¹M¥é”¥ô(€€€€€€€€€€€€€€€€€€€€€€€íÁ…ÑÑ•É¹M±¥‘•È Ÿ¦ZO¢Þtœ°Á…ÑÑ•É¹…À°Í•ÑA…ÑÑ•É¹…À¥ô(€€€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ ´Èˆ€¼ø(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¥ô(((€€€€€€€€€€ð½‘¥Øø(€€€€€€€€ð½‘¥Øø(€€€€€€ð½™½½Ñ•Èø((€€€€€ì¼¨ƒ¦‚¢"¦‚’æ/¦ZOžj–"–&ËžÞk¾òk–"ïš?šRû–r ¹…Ñ¥Ù”é½½´ƒ–ºç–f£–’[¾ò3–në–ºkž
ë¢z‹–æW–?žÒƒŽ(€€€€€€€€€ƒ’ö7žö»¢"¦®c–ê›žRÄÁ½Í¥Ñ¥½¹A…•Ñ±Ìƒ–r£žâ»šRûŽš6Ë–.WŽš:K–ê?žj–B3’â–æšnÓšZÃŽ€¨½ô(€€€€€íÁ…•Ì¹Í±¥” Ä¤¹µ…À ¡Áœ°¥‘à¤€ôøì(€€€€€€€½¹ÍÐÁ…•%‘à€ô¥‘à€¬€Äì(€€€€€€€½¹ÍÐÁÉ•Ù¥•ÝM…±”€ô5…Ñ ¹µ…à À¸ÀÀÀÄ°­I•˜¹ÕÉÉ•¹Ðñð€Ä¤ì(€€€€€€€½¹ÍÐÍ•…µÕ¥‘•`€ôÁ…•%‘à€¨€¡ÁÉ•Ù¥•Ý\€¬€Ä¤€´€À¸Ôì(€€€€€€€½¹ÍÐ…Ñ¥Ù”€ô…Ñ¥Ù•Õ¥‘•±¥¹•Ì¹Í½µ” (€€€€€€€€€Õ¥‘”€ôøÕ¥‘”¹ÑåÁ”€ôôô€Ù•ÉÑ¥…°œ(€€€€€€€€€€€€˜˜5…Ñ ¹…‰Ì¡Õ¥‘”¹½½É€´Í•…µÕ¥‘•`¤€ðô€À¸ÜÔ€¼ÁÉ•Ù¥•ÝM…±”(€€€€€€€€¤ì(€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€­•äõíÍ•…´µ½Ù•É±…ä´‘íÁœ¹¥‘õô(€€€€€€€€€€€É•˜õì¡•°¤€ôøì(€€€€€€€€€€€€€¥˜€¡•°¤Í•…µ=Ù•É±…åI•™Ì¹ÕÉÉ•¹Ð¹Í•Ð¡Áœ¹¥°•°¤ì(€€€€€€€€€€€€€•±Í”Í•…µ=Ù•É±…åI•™Ì¹ÕÉÉ•¹Ð¹‘•±•Ñ”¡Áœ¹¥¤ì(€€€€€€€€€€€õô(€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´ÀÑ½À´ÀÁ½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”ˆ(€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€¼¨ƒ–¾ç¦öC¢ž›–>G–>«š6‹š"C¢Nw¢&Ë¾ò3žÊ_–ê›–ž/žî#’þwš2€ÅÁãŽ€¨¼(€€€€€€€€€€€€€Ý¥‘Ñ è€œÅÁàœ°(€€€€€€€€€€€€€¡•¥¡Ðè€À°(€€€€€€€€€€€€€Ù¥Í¥‰¥±¥Ñäè€¡¥‘‘•¸œ°(€€€€€€€€€€€€€‰…­É½Õ¹‘½±½Èè…Ñ¥Ù”€ü€Éˆ Ôä€ÄÌÀ€ÈÐØ¤œ€èÍ¡…‘•!•à¡]=I-MA}	°A}M5}%9,¤°(€€€€€€€€€€€€€é%¹‘•àè…Ñ¥Ù”€ü€ÌÀÀÀÀÄ€è€ÐÔ°(€€€€€€€€€€€õô(€€€€€€€€€€¼ø(€€€€€€€€¤ì(€€€€€ô¥ô((€€€€€ì¼¨ƒ¦‚¦v‹¦‚–ê?š¢‡–ò?¾òkš¾?’â¦‚š¶’â/šZçžjš>‡š*+¢"–"«¦f“¦6×¾ò#¢Êó–r£žV¯¦v‹’â+¾ò3’â7–>_žV¯–â¢Ž–"–öÇ¦~ÿ¾ò$€¨½ô(€€€€€íÁ…•Í5½‘”€˜˜Á…•Ì¹µ…À ¡Áœ°Ñ±%‘à¤€ôøì(€€€€€€€½¹ÍÐ‘É…¥¹œ€ôÁ…•É…%‘à€ôôôÑ±%‘àì(€€€€€€€½¹ÍÐÑ°€ôì¥èÁœ¹¥°¥‘àèÑ±%‘àôì(€€€€€€€€¼¼ƒš.[šnÏžj’ö7žžï¢ÖÀI•…ÓŽ¢Þ¦‚¦v‹–Ÿ–ºç–B3’âš²„É•¹‘•Èƒ–¾¯–ë’ú¾òh(€€€€€€€€¼¼ƒš2'¦"W¢Þ¦‚¦v‹š&7šrŽ3–º3–º3–£–£žÚ–r£’â¢ÖßŽ7¾ò3’â7šr’â–þ¯’âšˆ(€€€€€€€½¹ÍÐÍ¡¥™Ð€ô€  ¤€ôøì(€€€€€€€€€¥˜€¡Á…•É…%‘à€„ôô¹Õ±°¤ì(€€€€€€€€€€€½¹ÍÐ½™˜€ôÁ…•É…=™™Í•Ð¡Ñ°¹¥‘à¤ì(€€€€€€€€€€€É•ÑÕÉ¸ìàè½™˜¹à€¨Á…•ÍM…±”°±¥Ù”è½™˜¹±¥Ù”°±¥™Ðè½™˜¹±¥Ù”ôì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡‘É…M•ÑÑ±”€˜˜Ñ°¹¥‘à€ôôô‘É…M•ÑÑ±”¹Á…”¤ì(€€€€€€€€€€€É•ÑÕÉ¸ìàè‘É…M•ÑÑ±”¹à€¨Á…•ÍM…±”°±¥Ù”è€…‘É…M•ÑÑ±”¹•…Í”°±¥™Ðè™…±Í”ôì(€€€€€€€€€ô(€€€€€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€€€€€ô¤ ¤ì(€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€­•äõíÁ…”µÑ°´‘íÑ°¹¥‘õô(€€€€€€€€€€€É•˜õì¡•°¤€ôøì(€€€€€€€€€€€€€¥˜€¡•°¤Á…•Ñ±I•™Ì¹ÕÉÉ•¹Ð¹Í•Ð¡Ñ°¹¥°•°¤ì(€€€€€€€€€€€€€•±Í”Á…•Ñ±I•™Ì¹ÕÉÉ•¹Ð¹‘•±•Ñ”¡Ñ°¹¥¤ì(€€€€€€€€€€€õô(€€€€€€€€€€€€¼¼ƒ–’[–Æ“’ö7žö»š¾?’â–âŸžRÄÉƒ¢Êó¢F_¦‚š†–¾¯¾ò#š6Ë–.WŽ¦Ë–ëš¢‡–ò?žj–.WžV¯¾ò$(€€€€€€€€€€€±…ÍÍ9…µ”ô‰…‰Í½±ÕÑ”±•™Ð´ÀÑ½À´ÀèµlÐÙtˆ(€€€€€€€€€€€ÍÑå±”õíìÙ¥Í¥‰¥±¥Ñäè€¡¥‘‘•¸œõô(€€€€€€€€€€ø(€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰™±•à¥Ñ•µÌµ•¹Ñ•È…À´Ä¸Ôˆ(€€€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€€€ÑÉ…¹Í™½É´èÍ¡¥™Ð(€€€€€€€€€€€€€€€€€€üÑÉ…¹Í±…Ñ” ‘íÍ¡¥™Ð¹áõÁà°€‘íÍ¡¥™Ð¹±¥™Ð€ü€¡A}I}M1€´€Ä¤€¨Á…•ÍM…±”€¨ÁÉ•Ù¥•Ý €¼€È€è€ÁõÁà¥€(€€€€€€€€€€€€€€€€€€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€€€ÑÉ…¹Í¥Ñ¥½¸èÍ¡¥™Ð€ü€¡Í¡¥™Ð¹±¥Ù”€ü€¹½¹”œ€è€ÑÉ…¹Í™½É´€ÈÈÁµÌÕ‰¥Œµ‰•é¥•È À¸È°À°À°Ä¤œ¤€èÕ¹‘•™¥¹•°(€€€€€€€€€€€€€õô(€€€€€€€€€€€€ø(€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€Ñ¥Ñ±”ô‹š.[šnÏ¢ªÿšVÓ¦‚–ê<ˆ(€€€€€€€€€€€€€‘…Ñ„µÁ…”µ¥õíÑ°¹¥‘ô(€€€€€€€€€€€€€½¹A½¥¹Ñ•É½Ý¸õì¡”¤€ôø¡…¹‘±•A…•É…MÑ…ÉÐ¡”°Ñ°¹¥‘à¥ô(€€€€€€€€€€€€€±…ÍÍ9…µ”õíÜ´ä µlÈÉÁátÉ½Õ¹‘•µ™Õ±°™±•à™±•àµ½°¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•È…ÀµlÍÁátÑ½Õ µ¹½¹”ÕÉÍ½ÈµÉ…ˆ…Ñ¥Ù”éÕÉÍ½ÈµÉ…‰‰¥¹œÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌÍ¡…‘½Üµ±œ€‘ì(€€€€€€€€€€€€€€€‘É…¥¹œ€ü€‰œµÝ¡¥Ñ”œ€è€‰œµÝ¡¥Ñ”¼ÄÔ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÈÔœ(€€€€€€€€€€€€€õô(€€€€€€€€€€€€ø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õí‰±½¬Ü´Ð µlÄ¸ÕÁátÉ½Õ¹‘•µ™Õ±°€‘í‘É…¥¹œ€ü€‰œµ‰±…¬œ€è€‰œµÝ¡¥Ñ”¼àÀõô€¼ø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õí‰±½¬Ü´Ð µlÄ¸ÕÁátÉ½Õ¹‘•µ™Õ±°€‘í‘É…¥¹œ€ü€‰œµ‰±…¬œ€è€‰œµÝ¡¥Ñ”¼àÀõô€¼ø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€½¹±¥¬õì¡”¤€ôøì”¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¤ì¡…¹‘±••±•Ñ•A…”¡Ñ°¹¥‘à¤ìõô(€€€€€€€€€€€€€‘¥Í…‰±•õíÁ…•Ì¹±•¹Ñ €ðô€Åô(€€€€€€€€€€€€€Ñ¥Ñ±”õíƒ–"«¦f“ž²°€‘íÑ°¹¥‘à€¬€Åôƒ¦‚ô(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰ÜµlÈÉÁát µlÈÉÁátÉ½Õ¹‘•µ™Õ±°‰œµÝ¡¥Ñ”¼ÄÔ¡½Ù•Èé‰œµÝ¡¥Ñ”¼ÈÔÑ•áÐµÝ¡¥Ñ”™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÑÉ…¹Í¥Ñ¥½¸µ…±°…Ñ¥Ù”éÍ…±”´äÀ‘¥Í…‰±•é½Á…¥Ñä´ÈÔÍ¡…‘½Üµ±œˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€€ñQÉ…Í ÈÍ¥é”õìÄÅô€¼ø(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€¤ì(€€€€€ô¥ô((€€€€€ì¼¨%ƒ¢ÊóšZ¦‚C¢š÷¾òkžŸ¢F\%ƒ–.Wš/’â+žjž&#’ö7–k’âš²‡¾ò#šîÿž&#Ž’â7–rO¢žK¾ò'¾ò3žr/žfó–ë–:ï¦Vßš;š¢Œ€¨½ô(€€€€€ì¼¨%ƒ¢ÊóšZ¦‚C¢š÷¾òkšVÓžÖš*÷–"À½µÁ½¹•¹ÑÌ½%AÉ•Ù¥•Ü¹ÑÍã¾ò3–§–/š.ó–r[–Þ—–ß–ÇžR£–B3’â’îô€¨½ô(€€€€€í¥AÉ•Ù¥•Ü€˜˜€ (€€€€€€€€ñ%AÉ•Ù¥•Ü(€€€€€€€€€Í¡½ÑÌõí¥M¡½ÑÍô(€€€€€€€€€­¥¹‘Ìõí¥-¥¹‘Íô(€€€€€€€€€…¹Ù…Í•Ìõí¥…¹Ù…Í•Íô(€€€€€€€€€™É…µ”õíìÜèÁÉ•Ù¥•Ý\° èÁÉ•Ù¥•Ý õô(€€€€€€€€€Á…•½Õ¹ÐõíÁ…•Ì¹±•¹Ñ¡ô(€€€€€€€€€™…•Ìõí¥…•Íô(€€€€€€€€€¡…ÍY¥‘•¼õí¥A…•!…ÍY¥‘•½ô(€€€€€€€€€ÍÕÁÁ½ÉÑ•õí¥AÉ•Ù¥•ÝMÕÁÁ½ÉÑ•‘ô(€€€€€€€€€½¹±½Í”õì ¤€ôøÍ•Ñ%AÉ•Ù¥•Ü¡™…±Í”¥ô(€€€€€€€€¼ø(€€€€€€¥ô((€€€€€ì¼¨Q¡Õµ‰¹…¥°™½±±½Ý¥¹œÑ¡”™¥¹•ÈÝ¡¥±”„™É•”µÍÑ…¹‘¥¹œ¥µ…”¥Ì±½¹œµÁÉ•ÍÌ‘É…•€¨½ô(€€€€€í™±½…ÑÉ…MÉŒ€˜˜€ (€€€€€€€€ñ‘¥Ø(€€€€€€€€€¥ô‰™±½…Ðµ‘É…œµÑ¡Õµ‰¹…¥°ˆ(€€€€€€€€€±…ÍÍ9…µ”ô‰™¥á•Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”èµläääåt‰½É‘•È´È‰½É‘•ÈµÝ¡¥Ñ”¼àÀ½Ù•É™±½Üµ¡¥‘‘•¸‰œµ¹•ÕÑÉ…°´äÀÀ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÝ¥±°µ¡…¹”µÑÉ…¹Í™½É´ˆ(€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€±•™Ðè€À°(€€€€€€€€€€€Ñ½Àè€À°(€€€€€€€€€€€Ý¥‘Ñ è€‘í5…Ñ ¹É½Õ¹ àÀ€¨€ À¸ØÔ€¬€À¸ÌÔ€¨5…Ñ ¹µ¥¸ Ä°­I•˜¹ÕÉÉ•¹Ðñð€Ä¤¤¥õÁá€°(€€€€€€€€€€€¡•¥¡Ðè€‘í5…Ñ ¹É½Õ¹ àÀ€¨€ À¸ØÔ€¬€À¸ÌÔ€¨5…Ñ ¹µ¥¸ Ä°­I•˜¹ÕÉÉ•¹Ðñð€Ä¤¤¥õÁá€°(€€€€€€€€€€€ÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ”Í ‘í™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ðü¹ÍÑ…ÉÑ`ñð€ÁõÁà°€‘í™±½…ÑMÝ…ÁI•˜¹ÕÉÉ•¹Ðü¹ÍÑ…ÉÑdñð€ÁõÁà°€À¤ÑÉ…¹Í±…Ñ” ´ÔÀ”°€´ÔÀ”¤Í…±” Ä¸Ä¤É½Ñ…Ñ” Ñ‘•œ¥€°(€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€œáÁàœ°(€€€€€€€€€€€‰½áM¡…‘½Üè€œÀ€ÑÁà€ÄÑÁàÉ‰„ À°À°À°À¸ÌÐ¤œ°(€€€€€€€€€õô(€€€€€€€€ø(€€€€€€€€€€ñ¥µœÍÉŒõí™±½…ÑÉ…MÉô…±Ðô‰‘É…¥¹œˆ±…ÍÍ9…µ”ô‰Üµ™Õ±° µ™Õ±°½‰©•Ðµ½Ù•Èˆ€¼ø(€€€€€€€€ð½‘¥Øø(€€€€€€¥ô((€€€€€ì¼¨±½…Ñ¥¹œ•±°Ñ¡Õµ‰¹…¥°™½±±½Ý¥¹œÕÍ•ÈÌ™¥¹•È½¸µ½‰¥±”€´MÅÕ…É”‘•Í¥¸€¨½ô(€€€€€íÑ½Õ¡É…•‘%¹‘•à€„ôô¹Õ±°€˜˜¥µ…•ÍmÑ½Õ¡É…•‘%¹‘•átü¹ÕÉ°€˜˜€ (€€€€€€€€ñ‘¥Ø(€€€€€€€€€¥ô‰µ½‰¥±”µ‘É…œµ™±½…Ñ¥¹œµÑ¡Õµ‰¹…¥°ˆ(€€€€€€€€€±…ÍÍ9…µ”ô‰™¥á•Á½¥¹Ñ•Èµ•Ù•¹ÑÌµ¹½¹”èµläääåt‰½É‘•È´È‰½É‘•ÈµÝ¡¥Ñ”¼àÀ½Ù•É™±½Üµ¡¥‘‘•¸‰œµ¹•ÕÑÉ…°´äÀÀ™±•à¥Ñ•µÌµ•¹Ñ•È©ÕÍÑ¥™äµ•¹Ñ•ÈÝ¥±°µ¡…¹”µÑÉ…¹Í™½É´ˆ(€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€±•™Ðè€À°(€€€€€€€€€€€Ñ½Àè€À°(€€€€€€€€€€€Ý¥‘Ñ è€‘í5…Ñ ¹É½Õ¹ àÀ€¨€ À¸ØÔ€¬€À¸ÌÔ€¨5…Ñ ¹µ¥¸ Ä°­I•˜¹ÕÉÉ•¹Ðñð€Ä¤¤¥õÁá€°(€€€€€€€€€€€¡•¥¡Ðè€‘í5…Ñ ¹É½Õ¹ àÀ€¨€ À¸ØÔ€¬€À¸ÌÔ€¨5…Ñ ¹µ¥¸ Ä°­I•˜¹ÕÉÉ•¹Ðñð€Ä¤¤¥õÁá€°(€€€€€€€€€€€ÑÉ…¹Í™½É´èÑÉ…¹Í±…Ñ”Í ‘íÑ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ðü¹ÍÑ…ÉÑ`ñð€ÁõÁà°€‘íÑ½Õ¡É…MÑ…Ñ”¹ÕÉÉ•¹Ðü¹ÍÑ…ÉÑdñð€ÁõÁà°€À¤ÑÉ…¹Í±…Ñ” ´ÔÀ”°€´ÔÀ”¤Í…±” Ä¸Ä¤É½Ñ…Ñ” Ñ‘•œ¥€°(€€€€€€€€€€€‰½É‘•ÉI…‘¥ÕÌè€œáÁàœ°€¼¼MÅÕ…É”‘•Í¥¸(€€€€€€€€€€€‰½áM¡…‘½Üè€œÀ€ÑÁà€ÄÑÁàÉ‰„ À°À°À°À¸ÌÐ¤œ°(€€€€€€€€€õô(€€€€€€€€ø(€€€€€€€€€€ñ¥µœ(€€€€€€€€€€€ÍÉŒõí¥µ…•ÍmÑ½Õ¡É…•‘%¹‘•át¹ÕÉ±ô(€€€€€€€€€€€…±Ðô‰‘É…¥¹œˆ(€€€€€€€€€€€±…ÍÍ9…µ”ô‰Üµ™Õ±° µ™Õ±°½‰©•Ðµ½Ù•Èˆ(€€€€€€€€€€€ÍÑå±”õíì(€€€€€€€€€€€€€ÑÉ…¹Í™½É´èÉ½Ñ…Ñ” ‘í¥µ…•ÍmÑ½Õ¡É…•‘%¹‘•át¹É½Ñ…Ñ¥½¸ñð€Áõ‘•œ¥€(€€€€€€€€€€€õô(€€€€€€€€€€¼ø(€€€€€€€€ð½‘¥Øø(€€€€€€¥ô(€€€€ð½‘¥Øø(€€¤ì)ôì(