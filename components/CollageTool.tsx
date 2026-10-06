Warning: truncated output (original token count: 177668)
Total output lines: 11577


import { canvasToUrl, revokeUrl } from '../utils/blobUrl';
import { reframeBasePhoto } from '../utils/reframeBasePhoto';
import {MASK_SHAPE_ITEMS,isBackdropMask,maskDefaults,drawBackdropMask,drawBackdropMaskBatch,disposeBackdropMasks,type BackdropMaskLayer,type BackdropPhotoLayer} from '../utils/backdropMasks';
import {BackdropMaskControls} from './BackdropMaskControls';
import { previewViewport } from '../utils/previewViewport';
import { LinkGlowTiles } from '../utils/linkGlowTiles';
import { useKeyboardRecovery } from '../utils/useKeyboardRecovery';
import { KeyboardSafeInput } from './KeyboardSafeInput';
import {CollageExportOptions} from './CollageExportOptions';
import {collageVideoMime,type CollageVideoFormat} from '../utils/collageVideoFormat';
import { idleDefaults } from '../utils/animationDefaults';
import { get2dWide } from '../utils/colorSpace';
import { CREATIVE_PHOTO_LIMIT, PHOTO_SWAP_HOLD_MS, PHOTO_LAYOUT_COUNTS, regionRects, photoCrop, photoTemplates, quickPhotoTemplateIndices, changePhotoTemplate, photoRegionHit, paintPhotoRegion, drawDimmedPhoto, clearPhotoDimmer, seamlessPhotoBase } from '../utils/creativePhotoLayout';
import { hasActiveFx, type FxScene, type FxPlacement } from '../utils/glEffects';
import { stampBounds, brushStepReached, type StampBounds } from '../utils/patternBrushSpacing';
import { patternEntranceRanks, type PatternDirection } from '../utils/patternEntrance';
import { PREMIUM_GLASS } from '../utils/premiumGlass';
import { exportHeic } from '../utils/heicExport';
import { CreativeSeamless } from '../utils/creativeSeamless';
import { StableSceneTiles, type SceneWindow } from '../utils/stableSceneTiles';
import {drawCoveredPhoto} from '../utils/coveredPhoto';
import { scenePixelEdge } from '../utils/scenePixelGrid';
import {emptyCellSeparators,SOLID_PLUS_PATH} from '../utils/photoCellChrome';
import {creativeSeamlessSliderValue,withCreativeSeamlessAmount,creativePatternCountForLayout} from '../utils/creativePhotoLayout';
import { createPortal, flushSync } from 'react-dom';
import {DEFAULT_COLORS,CREATIVE_MASK_COLORS,STROKE_COLORS,TEXT_COLORS as NEW_TEXT_COLORS} from '../utils/colorPalettes.js';
import type { PhotoRegion } from '../utils/creativePhotoLayout';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { addExport } from '../utils/exportHistory';
import { Download, RefreshCw, Type, Circle, Heart, Star, Square, Shapes, Hexagon, Blocks, Sparkles, Asterisk, Crop, Palette, X, Plus, ChevronLeft, ArrowLeft, Paintbrush, Eraser, MousePointer, Link, Link2Off, SlidersHorizontal, MoveUp, MoveDown, Copy, Sliders, Trash2, Play, Pause, ImageIcon, Film } from 'lucide-react';
import { Icon } from './Icon';
import { SYMBOLS } from '../utils/symbols';
/* 文字編輯面板直接沿用經典拼圖那一顆 —— 用同一份程式碼，
   才是真正的「100% 一樣」（字體卡片牆、字距、粗體、描邊、發光全都在裡面）。 */
import {
  TextEditorPanel, ImageAdjustPanel, FX_PARAM_DEFAULTS,
  /* 圓角／羽化／描邊／發光全部改用經典拼圖那幾支：同一份程式碼，
     連羽化的三次盒狀模糊、發光的距離場都一樣，不會再有兩套外觀。 */
  cornerR, roundRectPath, makeShapeMask, makeGlowCanvas, GLOW_BLUR_UNIT, GLOW_EXTENT,
  /* 圖片外形（形狀）：圓形／星型／愛心也共用同一份路徑與同一支算圖 */
  isImgShaped, withImgOutline, drawImgBase, IMG_SHAPES, isPointInImgShape, imgShapeBox, imgShapeInk, imgShapePan, clampImgZoom, zoomAboutShapeCenter,
  /* 「新增圖形」整套跟經典拼圖共用：同一份清單、同一支路徑、同一顆色票元件，
     兩邊的圖形不可能長得不一樣。 */
  ADD_SHAPE_ITEMS, ShapeGlyph, HoleGlyph, CrossStarIcon, VortexIcon, swatchStrip, ColorPick, SmoothRange, GLOW_COLORS as GLOW_SWATCH_COLORS, SOFT_COLORS,
  /* 「新增符號」也是共用的：同一份符號清單、同一頁按鈕 */
  SymbolPicker, symbolFontReady, compositeOutlineInk,
  shapePathD, shapeMiterLimit, shapeGlowBlurs, shapeFeatherBlur, drawFeatheredShapeBody, strokeCompositeShape, shapeSupportsFeather, SHAPE_DEFAULT_LINEW, SHAPE_DEFAULT_RATIO, SHAPE_DEFAULT_COLOR, shapeDefaultColorFor, SHAPE_FIT, shapeSupportsStretch, SPECIAL_LINE_KINDS, GRID_SHAPE_KINDS, GRID_DOT_KINDS, DUAL_COLOR_SHAPE_KINDS, DOUBLE_CONTOUR_SHAPE_KINDS, COMPOSITE_SHAPE_KINDS,
} from './GridLayoutTool';
/* 真機 iOS 的 Canvas 字形取整與桌面 WebKit 不同；只在動畫 raster 與靜止
   fillText 之間補回同一個實測中心。 */
const ReplayIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  /* 箭頭與圓弧是同一個 path、一次描邊；半透明時交接處不會累加變白。 */
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8.25 6.75H4.2V2.7 M4.45 6.55A8 8 0 1 1 4 14" />
  </svg>
);

import { DEFAULT_FONT, SYMBOL_FONT, ensureFont, fontStack } from '../utils/fonts';
import { normalizeImageFiles } from '../utils/imageLoader';
import { RAW_ACCEPT as RAW_ACCEPT_IMG } from '../utils/fileTypes';
import { SHAPE_IMAGES } from '../utils/shapeImages';
import { countSymbolAnimationBeats, measureSymbolInk, measureSymbolStickerInk, measureSymbolUnitLayout, rasterizeSymbolAnimationLayers, rasterizeSymbolSticker, symbolBreatheScale, symbolStickerFontPx, symbolStickerOversample, symbolBox as sharedSymbolBox, clearSymbolInkCache } from '../utils/symbolGeometry';
/* 「圖案」怎麼畫（路徑、字符、去背圖）整組搬到共用模組去了 ——
   經典拼圖那邊的圖形也吃同一份，兩邊才不會各畫各的。
   這裡只是把它接回來，畫出來的東西跟搬家前一模一樣。 */
import {
  getHoleNumber, GLYPH_HOLES, GLYPH_BTN, getHoleImg, isImageHole, holeImgRatio,
  isTextHole, holeGlyph, glyphFont, glyphInk, drawTextShape as drawTextShapeRaw, drawShapePath, patternPathBounds,
  drawHoleShape, paintDots, paintTex, texOf, glowAmount,
  HoleShapeItem, HOLE_ITEM_CROSS, HOLE_ITEM_CROSS_O, HOLE_ITEMS_EXTRA,
} from '../utils/holeShapes';
const drawTextShape: typeof drawTextShapeRaw = (ctx,type,text,x,y,size,fill,out=false,angle=0) =>
  drawTextShapeRaw(ctx,type,text,x,y,size,fill,out,angle,true);
/* 構圖跟「編輯」「經典拼圖」共用同一個 ComposeStudio */
import { paintPattern, paintStripesRect, TEX_OPTIONS, TEX_SWATCHES, STRIPE_DIRS, STRIPE_A, STRIPE_B, isGridTex,
  STRIPE_N_DEFAULT, STRIPE_N_MAX } from '../utils/pattern';
import { paintMaskTexture, maskTextureSizeFromUi, maskTextureSizeToUi, maskTextureSquashFromUi, maskTextureSquashToUi } from '../utils/maskTexture';
import { spacedTextureRadius, maskTextureGapFromUi, maskTextureGapToUi } from '../utils/textureSpacing';
import { ComposeStudio } from './ComposeStudio';
import { StuckEscape } from './StuckEscape';
/* 影片：包成一個「長得跟 <img> 一樣」的來源，畫布那邊一行都不必改。
   詳細的理由與做法寫在 utils/videoSource.ts 的檔頭。 */
import {
  isVideoFile, isVideoEl, loadVideoEl, releaseVideoEl, videoToken, videoTokenOf,
  videosIn, rewindVideos, playVideos, pauseVideos, longestDuration, videoFrame,
} from '../utils/videoSource';
/* IG 預覽跟經典拼圖共用同一顆元件 —— 同一份程式碼，兩邊不可能有差 */
import { IgPreview } from './IgPreview';
import { DEFAULT_GEO, GeoParams, composeCanvas, isGeoIdentity, geoFrameCanvas } from '../utils/compose';
/* 圖片調整走跟「編輯」「經典拼圖」完全同一條像素管線 —— 同一份程式碼，
   所以濾鏡與調節的效果不可能有差。 */
import { PhotoFx, ADJUST_KEYS, applyPhotoFx, releasePhotoFxSurface, releasePhotoFxReadbacks, compactPhotoFxSurface, supportsResidentPhotoEffects, hasPhotoFx, loadLut, getLoadedLut, deferHeavyWork, warmEditorLuts } from '../utils/photoFx';
import {photoPreviewCapacity} from '../utils/photoPreviewResolution';
import {warmPhotoFxSurface} from '../utils/photoFx';
import {awaitPhotoIdle, holdPhotoInteraction, isPhotoInteractionBusy} from '../utils/photoInteractionIdle';
import {warmLowfiLut} from '../utils/lowfiLut';
import {FX_DEFS} from '../utils/glEffects';
import {PhotoSceneColour,supportsSceneColour} from '../utils/photoSceneColour';
import {PhotoAdjustmentBlend,BLEND_ADJUSTMENTS} from '../utils/photoAdjustmentBlend';
import { SaveButton } from './SaveButton';
import { ExportActionLift } from './ExportActionLift';
import type { ExitChoice } from '../types';

// Keep embedded icon bytes intact, but never reparse a huge base64 CSS mask
// on each first panel layout. These tiny immutable asset URLs live with module.
const patternIconUrls=new Map<string,string>();
const warmedPatternIcons=new Set<string>();
const patternIconUrl=(source:string)=>{
  if(!source.startsWith('data:'))return source;
  let url=patternIconUrls.get(source);if(url)return url;
  const split=source.indexOf(','),header=source.slice(0,split),bytes=atob(source.slice(split+1));
  url=URL.createObjectURL(new Blob([Uint8Array.from(bytes,c=>c.charCodeAt(0))],{type:header.slice(5).split(';')[0]}));
  patternIconUrls.set(source,url);return url;
};

import { pushHistory as pushHistoryEntry } from '../utils/history';
import { preferredVideoFrameRate } from '../utils/videoFrameRate';

/** 四周包圍：遮罩把原圖整圈包起來 */
const AROUND = 'mask-around';
/** 滿版：只有底圖，不繪製遮罩、遮罩圖案或連線。 */
const FULL = 'image-full';
/* 按鈕仍只顯示五種比例；每顆內部各有直式／橫式兩個實際方向。
   16:9 的第一次點擊也依需求是直式 9:16，第二次才是橫式 16:9。 */
const CANVAS_RATIO_BUTTONS = [
  ['1:1', '1:1', '1:1'],
  ['3:4', '3:4', '4:3'],
  ['2:3', '2:3', '3:2'],
  ['4:5', '4:5', '5:4'],
  ['16:9', '9:16', '16:9'],
] as const;
type CanvasRatio = '1:1' | '3:4' | '4:3' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '16:9';
const CANVAS_RATIO_VALUES: Record<CanvasRatio, number> = {
  '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '2:3': 2 / 3, '3:2': 3 / 2,
  '4:5': 4 / 5, '5:4': 5 / 4, '9:16': 9 / 16, '16:9': 16 / 9,
};
const isCanvasRatio = (ratio?: string): ratio is CanvasRatio => !!ratio && ratio in CANVAS_RATIO_VALUES;
const canvasRatioValue = (ratio?: string) => isCanvasRatio(ratio) ? CANVAS_RATIO_VALUES[ratio] : 1;
const ratioButtonActive = (ratio: CanvasRatio, portrait: CanvasRatio, landscape: CanvasRatio) =>
  ratio === portrait || ratio === landscape;

/** 保留原排版中心，以指定比例中央裁切整張成品；內容本身不拉伸。 */
const cropSizeToRatio = (w: number, h: number, ratio?: string) => {
  const r = canvasRatioValue(ratio);
  if (w / Math.max(1, h) > r) return { w: h * r, h };
  return { w, h: w / r };
};
/* ── 四周包圍的「比例」 ────────────────────────────────────────────────
   跟其他排版一致：滑桿上的 1/N 指的都是「遮罩那一塊相對於圖片」。
   四周包圍的遮罩就是圖片周圍那一圈，所以 1/N ＝ 單邊的邊框寬度是圖片的 1/N。

   內部仍然只存一個 maskScale ＝「中間那張照片佔畫布的比例 k」，
   兩者的關係： k = 1 / (1 + 2b)   （b = 邊框 / 圖片）
   b = 0 就是圖片剛好滿版，所以滑桿要比其他排版多一段尾巴走到 0 —— 也就是
   AROUND_STEPS 比別人的 100 長一點。 */
const AROUND_STEPS = 125;
/** b（邊框佔圖片的比例）→ 中間照片佔畫布的比例 */
const aroundK = (b: number) => 1 / (1 + 2 * Math.max(0, b));
/** 中間照片佔畫布的比例 → b */
const aroundB = (k: number) => Math.max(0, (1 / Math.max(0.01, k) - 1) / 2);
/** 四周包圍的預設：邊框是圖片的 1/3（跟以前預設看起來一樣） */
const AROUND_SCALE = aroundK(1 / 3);
/** 四邊那四種排版的預設比例：遮罩佔一半（1/2） */
const DEFAULT_MASK_SCALE = 0.5;
/** 單邊上限（Safari Mobile 安全值） */
const MAX_FINAL_DIM = 4096;
/** 導出畫布的總像素上限。真正把分頁殺掉的是「面積」不是「邊長」 */
const MAX_EXPORT_PIXELS = 20_000_000;
/* 匯出的「底線解析度」（長邊）。
   以前成品最大就是原圖那麼大（finalScale 封頂 1.0）—— 照片小的時候，
   畫在上面的圖案、圖形、文字、連線、紋理就只分到那幾個像素，邊緣自然糊。
   實測（量「從一邊過渡到另一邊要幾個像素」）：
     原圖 900×600  → 成品 900×900   邊緣 2px，第 90 百分位 3px
     原圖 2400×3200 → 成品 3600×3200 邊緣 1px，第 90 百分位 1px（96% 的邊一個像素就過渡完）
   那些東西是用路徑畫的，給多少像素就有多利。所以長邊不足這個數就整張放大上去。
   照片本身不會因此多出細節（它在手機上本來就是被放大來看的），
   但所有邊緣會真正到達「一個像素過渡完」＝ 看不到鋸齒。 */
const EXPORT_MIN_DIM = 3200;
/** IG 預覽裡「貼文與貼文之間」的間距。頭、尾、中間統一都用這個值 */
const IG_GAP = 14;
/** 動態牆最上面與最下面多留的空間：多一點才滑得舒服 */
const IG_EDGE = 48;
/** 動態影片的長邊上限。1440 已經比手機螢幕還細，再高只是白燒編碼時間 */
const MOTION_MAX_DIM = 2160;
/* ── 拼圖裡有影片時的導出上限 ────────────────────────────────────────
   1440 是給「純動畫」訂的：那種畫面全部是路徑畫出來的，1440 已經看不出
   差別。但如果拼圖的底（或某個物件）本身就是一段 1080p／4K 的影片，
   1440 等於把使用者的素材降級 —— 那正是「原始品質導出」要避免的事。
   所以有影片參與時改吃這一組：長邊放到 2160、面積 5M。
   （面積才是真正會爆的那一項：MediaRecorder 一秒要吃 30~60 張，
   4K 那個量級手機的編碼器根本追不上，錄出來會掉格甚至整段失敗。） */
const MOTION_MAX_DIM_VIDEO = 2160;
const MOTION_MAX_PIXELS_VIDEO = 5_000_000;
/** 導出影片最長錄幾秒。素材再長也要有個底，不然一按下去就回不來了 */
const MAX_VIDEO_SECONDS = 60;
/** 影片物件跑效果管線時固定重複使用的那幾張離屏畫布 */
type VidScratch = { geo: HTMLCanvasElement; base: HTMLCanvasElement; cv: HTMLCanvasElement; off: HTMLCanvasElement };
/**
 * 播動畫時「一格」能用掉的像素上限。
 * 靜態時可以放到 56M（反正只烤一次），但動畫一秒要烤 30 次 ——
 * 照那個量級跑，手機的畫布記憶體幾秒內就會被系統回收（閃退回主畫面）。
 * 6M 對應到手機螢幕大約是 2 倍超取樣，正常倍率下完全用得到，
 * 只有「放到很大又同時在播」才會被壓下來。
 */
const MAX_MOTION_PIXELS = 6_000_000;
/**
 * 預覽時「主畫布 + 三張遮罩暫存畫布」加起來的像素預算。
 * 一張畫布是 4 bytes/px，四張加起來就是 ×4 —— 8M 像素等於 128MB，
 * 手機瀏覽器到這個量級就開始被系統回收（就是主人遇到的閃退到主畫面）。
 */
const MAX_PREVIEW_PIXELS = 56_000_000;
/* 超取樣：畫布要比螢幕上的裝置像素細幾倍。
   這是「畫質」唯一的旋鈕，而且從頭到尾只有這一個數字 ——
   下面所有跟倍率有關的計算都引用它，所以任何縮放倍率下的銳利度都一致。 */
const SUPERSAMPLE = 1.8;
/**
 * 「等畫面真的畫出來、而且瀏覽器有空了再做」。
 *
 * 離開工具的那一下要做兩件重活：把整段影片讀進資料庫、收掉解碼器。
 * 它們都不急，但只要跟「切換畫面」搶同一條主執行緒，使用者感覺到的就是
 * 「按了返回，過了好久才跳出去」。requestIdleCallback 就是為這件事存在的：
 * 瀏覽器把該畫的都畫完、真的閒下來才回呼；設 timeout 當保險，
 * 不支援的瀏覽器（Safari 舊版）就退回一個夠晚的 setTimeout。
 */
const whenIdle = (fn: () => void) => {
  const ric = (typeof window !== 'undefined' && (window as any).requestIdleCallback) as
    ((cb: () => void, o?: { timeout: number }) => number) | undefined;
  if (ric) ric(() => fn(), { timeout: 2000 });
  else setTimeout(fn, 300);
};

/**
 * 這張拼圖在某個「畫布倍率」下，主畫布加三張遮罩暫存畫布總共要幾個像素。
 * 記憶體是四張一起算的 —— 只看主畫布會低估三倍，那正是手機被回收的原因。
 */
const previewPixelsAt = (
  layout: string, bw: number, bh: number, maskScale: number, ps: number, maskCanvases: number,
  canvasRatio?: string,
) => {
  const g = layoutGeometry(layout, bw, bh, maskScale, canvasRatio);
  return (g.cw * g.ch + maskCanvases * g.mw * g.mh) * ps * ps;
};

/** 這個排版下遮罩相對原圖的尺寸；四周包圍時遮罩就是整張輸出畫布 */
const maskDims = (layout: string, bw: number, bh: number, maskScale: number) => {
  if (layout === AROUND) {
    /* 四周包圍：遮罩就是整張畫布，而且大小固定＝原圖大小。
       「比例」只縮中間那張照片，完全不動遮罩。

       以前是反過來的 —— 比例愈大就把畫布往外撐（原圖×(1+2×比例)），
       於是拉比例時整張畫布的尺寸每一格都在變：圖案的座標系跟著變（圖案會跑掉）、
       主畫布與遮罩層每一格都要重新配置（滑桿因此只剩 8.5fps）。
       畫布固定之後，這三件事一次解決。 */
    const k = Math.max(0.05, Math.min(1, maskScale));
    return {
      mw: Math.round(bw),
      mh: Math.round(bh),
      padX: Math.round(bw * (1 - k) / 2),
      padY: Math.round(bh * (1 - k) / 2),
    };
  }
  return {
    mw: Math.round(bw * (layout.includes('left') || layout.includes('right') ? maskScale : 1)),
    mh: Math.round(bh * (layout.includes('top') || layout.includes('bottom') ? maskScale : 1)),
    padX: 0,
    padY: 0,
  };
};

/**
 * 版面真正的幾何。比例改的是整張成品，但不是把既有拼圖硬切掉：先決定
 * 成品尺寸，再依「佔比」重新分配照片區與遮罩區。如此 1/2 永遠代表遮罩
 * 在目前比例下仍是照片區的二分之一，切換比例也不會把某一側遮罩裁掉。
 */
const layoutGeometry = (layout: string, bw: number, bh: number, maskScale: number, ratio?: string) => {
  const legacy = maskDims(layout, bw, bh, maskScale);
  const native = layout === 'mask-bottom' || layout === 'mask-top' ? { w: bw, h: bh + legacy.mh }
    : layout === 'mask-right' || layout === 'mask-left' ? { w: bw + legacy.mw, h: bh }
    : layout === AROUND ? { w: legacy.mw, h: legacy.mh }
    : { w: bw, h: bh };
  const size = ratio ? cropSizeToRatio(native.w, native.h, ratio) : native;
  const cw = size.w, ch = size.h;
  if (layout === FULL) {
    return { cw, ch, iw: cw, ih: ch, mw: 0, mh: 0, ix: 0, iy: 0, mx: 0, my: 0, padX: 0, padY: 0 };
  }
  if (layout === AROUND) {
    const k = Math.max(0.05, Math.min(1, maskScale));
    const iw = cw * k, ih = ch * k;
    const padX = (cw - iw) / 2, padY = (ch - ih) / 2;
    return { cw, ch, iw, ih, mw: cw, mh: ch, ix: padX, iy: padY, mx: 0, my: 0, padX, padY };
  }
  const m = Math.max(0.01, maskScale);
  if (layout === 'mask-bottom' || layout === 'mask-top') {
    const iw = cw, ih = ch / (1 + m), mw = cw, mh = ch - ih;
    return layout === 'mask-bottom'
      ? { cw, ch, iw, ih, mw, mh, ix: 0, iy: 0, mx: 0, my: ih, padX: 0, padY: 0 }
      : { cw, ch, iw, ih, mw, mh, ix: 0, iy: mh, mx: 0, my: 0, padX: 0, padY: 0 };
  }
  const iw = cw / (1 + m), ih = ch, mw = cw - iw, mh = ch;
  return layout === 'mask-right'
    ? { cw, ch, iw, ih, mw, mh, ix: 0, iy: 0, mx: iw, my: 0, padX: 0, padY: 0 }
    : { cw, ch, iw, ih, mw, mh, ix: mw, iy: 0, mx: 0, my: 0, padX: 0, padY: 0 };
};

/** 原圖 w×h 在這個排版下拼完之後，整張畫布有多大 */
const collageSizeOf = (layout: string, w: number, h: number, maskScale: number, canvasRatio?: string) => {
  const g = layoutGeometry(layout, w, h, maskScale, canvasRatio);
  return { w: g.cw, h: g.ch };
};

/** 把 id 轉成一個穩定的數字，用來打散順序（同一顆圖案永遠拿同一格，不會閃） */
/** 兩份圖案清單是不是完全一樣（id、位置、所屬側都沒變） */
/* 「畫出來長什麼樣」的指紋：一顆 side:'both' 的圖案跟拆開後的
   image + mask 兩顆畫出來一模一樣，所以要先展開再比。
   對稱鍵按下去只是把同一批圖案換一種存法、畫面完全沒變 ——
   那就不該佔掉一格上一步。 */
const renderKeyOf = (list: any[]) => {
  const out: string[] = [];
  for (const h of list || []) {
    const sides = (h.side || 'both') === 'both' ? ['image', 'mask'] : [h.side];
    for (const sd of sides) out.push(`${sd}|${h.x}|${h.y}|${h.angle ?? ''}|${h.localScale ?? 1}`);
  }
  return out.sort().join(';');
};
const sameHoles = (a: any[], b: any[]) => renderKeyOf(a) === renderKeyOf(b);

/** 物件的指紋。img 是 DOM 元素，不能 JSON —— 用 src 代表它。
    poster（影片的第一格縮圖）只給面板看，跟畫出來長什麼樣無關，一起排除。 */
const objKeyOf = (list: any[]) =>
  (list || []).map(o => JSON.stringify({ ...o, img: undefined, poster: undefined, src: o.src || '' })).join(';');


/* ── 新增圖形 ────────────────────────────────────────────────────── */

/**
 * 「新增圖形」用的路徑。
 * 形狀本體是經典拼圖那支 shapePathD（回傳 SVG 的 d 字串）——
 * 這裡只是把它包成 Path2D 畫在 canvas 上，所以兩個工具的圖形
 * **一定**是同一個形狀，不可能各自走鐘。
 * 路徑的座標是「左上角 (0,0) 到 (w,h)」，呼叫端負責搬到框心。
 */
const shapePathCache = new Map<string, Path2D>();
/** Original contain-fit preview: the same 16px inset on every aspect ratio. */
export const creativePreviewFit = (stageW: number, stageH: number, w: number, h: number) =>
  Math.min(Math.max(1, stageW - 32) / w,
    Math.max(1, stageH - 32) / h);

/** Resolve a custom mask photo in mask-local units, preserving its crop when
 * the layout changes. Legacy drafts keep their original centred cover. */
export const resolveMaskPhotoTransform = (t: any, iw: number, ih: number, fw: number, fh: number) => {
  const cover = Math.max(fw / Math.max(1, iw), fh / Math.max(1, ih));
  if (!t?.frameW || !t?.frameH) {
    const w = iw * cover, h = ih * cover;
    return { x: (fw - w) / 2, y: (fh - h) / 2, w, h, frameW: fw, frameH: fh };
  }
  const k = Math.max(fw / t.frameW, fh / t.frameH);
  const w = t.w * k, h = t.h * k;
  return { x: Math.min(0, Math.max(fw - w, fw / 2 + (t.x - t.frameW / 2) * k)),
    y: Math.min(0, Math.max(fh - h, fh / 2 + (t.y - t.frameH / 2) * k)),
    w, h, frameW: fw, frameH: fh };
};

export const shapePathBox = (
  kind: string, w: number, h: number,
  gridBaseW = w, gridBaseH = h,
  gridDotRadius = Math.min(gridBaseW, gridBaseH) / 160 * 2.325,
  ringReveal = 1,
) => {
  const key = [kind, w, h, gridBaseW, gridBaseH, gridDotRadius, ringReveal].join('|');
  const cached = shapePathCache.get(key);
  if (cached) return cached;
  const path = new Path2D(shapePathD(kind, w, h, gridBaseW, gridBaseH, gridDotRadius, ringReveal));
  shapePathCache.set(key, path);
  if (shapePathCache.size > 128) shapePathCache.delete(shapePathCache.keys().next().value!);
  return path;
};

/* 圖形上的紋理（點點／條紋）已經整組搬到共用模組去了 —— 見 utils/holeShapes.ts
   的 paintTex：兩個拼圖工具吃同一份，畫出來一定一樣。 */

/* ── 符號「真正畫出來的那一塊」 ─────────────────────────────────────
   跟圖案那邊是同一個問題、同一種解法：textAlign:'center' 對的是**前進寬度**、
   textBaseline:'middle' 對的是 **em 方框**，兩個都不是墨水。符號大量用到組合
   附加符號（疊在前一個字上面的小點、小星星）與冷門的 Unicode 區塊，退回系統
   字型之後左右上下的留白常常差很多 —— 框就框不到它、也很難點到。
   字型宣告的度量（actualBoundingBox*）在這些字上一樣不可靠，所以照圖案那邊
   的做法：**直接畫一次、掃一次 alpha**，畫出來的像素不會騙人。
   一種符號只量一次（字級 100），其他尺寸等比換算，量出來的東西拿去做三件事：
     ① 新增時的框大小 ② 畫的時候把墨水中心移到框心 ③ 選取框與命中範圍
   三邊同一份數字，框就一定框得到它。 */
/** 回傳值都以「字級 1」為單位：w/h＝墨水大小，cx/cy＝墨水中心相對於下筆點的位移 */
const symInk = measureSymbolInk;

type CreativeSymbolPlacement = {
  size: number;
  w: number;
  h: number;
};
const creativeSymbolPlacementCache = new Map<string, CreativeSymbolPlacement>();

/* 選擇頁在 pointerdown 階段只預算使用者正在按的那一顆；click 階段直接讀快取，
   避免 iOS 在觸控結束後才掃描整串字形 alpha，造成「點了才過一下新增」的感覺。 */
const prepareCreativeSymbolPlacement = (
  text: string,
  canvasWidth: number,
  canvasHeight: number,
): CreativeSymbolPlacement => {
  const cw = Math.max(1, Math.round(canvasWidth * 100) / 100);
  const ch = Math.max(1, Math.round(canvasHeight * 100) / 100);
  const key = `${SYMBOL_FONT}|${cw}|${ch}|${text}`;
  const cached = creativeSymbolPlacementCache.get(key);
  if (cached) return cached;

  const ink = measureSymbolStickerInk(text, SYMBOL_FONT);
  const short = Math.min(cw, ch);
  const size = Math.max(12, Math.min(160, Math.round(short * 0.12),
    Math.round((cw * 0.7) / Math.max(0.05, ink.w))));
  const canonical = measureSymbolUnitLayout(text, SYMBOL_FONT, 100);
  const value = {
    size,
    w: Math.round(Math.max(6, canonical.ink.w * size + 8)),
    h: Math.round(Math.max(6, canonical.ink.h * size + 8)),
  };
  creativeSymbolPlacementCache.set(key, value);
  return value;
};

/* 若使用者極快進頁、恰好在字體完成前預算，最終字體就緒時丟掉那批 fallback
   幾何；後續點擊仍會以最終字身重新準備，不會保留錯誤外框。 */
symbolFontReady.then(() => creativeSymbolPlacementCache.clear());

/** 依符號的內容與字級算出「剛好包住它」的框（含一點點留白，才好按） */
const symBox = (str: string, fam: string, size: number) => {
  return sharedSymbolBox(str, fam, size);
};

/** 創意拼圖與經典拼圖共用同一份圖形路徑範圍；這裡把它換成物件座標。 */
const objectSelectionInk = (o: any, scale: number, gap: number) => {
  const bw = o.w * scale, bh = o.h * scale;
  if (o.sym) {
    /* 外框使用固定基础字级的规范化几何，再跟物件一起等比缩放。
       缩放期间不可按每一帧的新字级重新扫描 alpha，否则 iOS 会卡顿且框会跳。 */
    const text = o.text || o.sym;
    const fam = o.sym ? SYMBOL_FONT : (o.fontFamily || DEFAULT_FONT);
    const layout = measureSymbolUnitLayout(text, fam, o.sym ? 100 : (o.size || 40));
    /* 新增、靜止、動畫與外框必須讀同一份幾何。長符號若在這裡另外建立
       animation raster 量一次，Mobile Safari 的寬度便會忽長忽短。 */
    const ink = measureSymbolStickerInk(text, fam);
    const stroke = (o.strokeWidth || 0) * (o.size / 40) * scale;
    const edge = gap + stroke;
    const w = ink.w * o.size * scale, h = ink.h * o.size * scale;
    return { x: (bw - w) / 2 - edge, y: (bh - h) / 2 - edge, w: w + edge * 2, h: h + edge * 2 };
  }
  if (o.type === 'shape' && o.kind !== 'hole') {
    const contour = compositeOutlineInk(o.kind, bw, bh, o.outlineWidth);
    if (contour) return { x:contour.x-gap, y:contour.y-gap, w:contour.w+gap*2, h:contour.h+gap*2 };
    const fit = SHAPE_FIT[o.kind] || [0, 0, 1, 1];
    const unit = ((o as any).lineBase || Math.max(o.w, o.h)) * scale / 160;
    // The frame follows the same continuous stroke geometry as the painter.
    // In particular grids use a 1.5-unit base stroke, not a six-unit stroke.
    const line = GRID_SHAPE_KINDS.has(o.kind)
      ? 1.5 * unit * Math.max(1, Math.min(3, (o.lineW ?? 6) / 6))
      : Math.max(.4 * scale, (o.lineW ?? 6) * unit);
    const edge = gap + ((o.filled && o.kind !== 'line') ? 0 : line / 2) + (o.strokeW || 0) * unit;
    return {
      x: bw * fit[0] - edge, y: bh * fit[1] - edge,
      w: Math.max(1, bw * fit[2]) + edge * 2,
      // 線條本身的墨水高度是 0，框高只應由線寬與留白組成；額外塞 1px
      // 會只加在下方，造成線條看起來偏離選中框中心。
      h: (o.kind === 'line' ? 0 : Math.max(1, bh * fit[3])) + edge * 2,
    };
  }
  if (o.type === 'shape') {
    const size = Math.min(bw, bh);
    const ink = isTextHole(o.hole)
      ? (() => { const b = glyphInk(o.hole, holeGlyph(o.hole, o.text || '', o), size); return {x:-b.w/2,y:-b.h/2,w:b.w,h:b.h}; })()
      : patternPathBounds(o.hole, size);
    const unit = ((o as any).lineBase || Math.max(o.w, o.h)) * scale / 160;
    const edge = gap + (o.filled === false ? (o.lineW ?? 6)*unit/2 : 0) + Math.min(4,o.strokeW || 0)*unit;
    return {x:bw/2+ink.x-edge,y:bh/2+ink.y-edge,w:ink.w+2*edge,h:ink.h+2*edge};
  }
  const ink = imgShapeInk(o.imgShape, bw, bh);
  return { x: ink.x - gap, y: ink.y - gap, w: ink.w + gap * 2, h: ink.h + gap * 2 };
};

/**
 * 圖形調整面板裡「點一下打開調色盤」的那一列。
 * 樣式跟連線顏色、文字的描邊／發光顏色逐項相同。
 */
/* 這裡刻意不放 key：兩顆顏色（點點、發光）是同一個父層的兩個相鄰子節點、
   標題又都叫「顏色」，拿 label 當 key 就變成**同一個父層裡兩個一樣的 key** ——
   React 的比對會亂掉：開開關關會愈疊愈多顆，切換的瞬間也會閃一下。
   它們的位置是固定的（左、右），本來就不需要 key。 */
const shapeColorRow = (label: string, value: string, onOpen: () => void) => (
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

/** 圖形調整面板用的滑桿，樣式跟經典拼圖那顆 ShapeEditorPanel 逐項相同 */
const shapeSlider = (label: string, value: number, min: number, max: number, onVal: (v: number) => void) => (
  <div className="space-y-1.5" key={label}>
    <div className="flex justify-between items-center">
      <span className="text-[11px] font-bold text-white/70">{label}</span>
      <span className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2 py-0.5 rounded text-white">{value}</span>
    </div>
    {/* 全 App 的滑桿軌道統一成同一種細度（跟「編輯」的濾鏡滑桿一樣） */}
    <div className="slider-wrap" style={{ height: 16 }}>
      <SmoothRange
        min={min} max={max} step={1} value={value}
        onValue={v => onVal(Math.round(v))}
        className="premium-slider w-full"
        style={{ touchAction: 'pan-y' }}
      />
    </div>
  </div>
);

/* ── 連線 ──────────────────────────────────────────────────────────
   每一種圖案都能連線。以前只開放前六種「單一封閉形狀」，理由是字符類的
   中心點不明確、連起來會像亂畫 —— 但那個中心點的問題已經在 drawTextShape
   裡修掉了（改成對齊字真正的墨水中心），所以字符、數字、漩渦現在也都
   接得準，沒有理由再擋。 */
const LINK_TYPES: string[] = [];
/** 這種圖案支援連線嗎（空陣列＝全部都支援） */
const linkableType = (t: string) => LINK_TYPES.length === 0 || LINK_TYPES.includes(t);

/**
 * 每個圖案連到「離它最近、而且這一對還沒被連過」的那一個。
 * 例如離 B 最近的是 A，但 A 已經連過 B 了，B 就往下找第二近的 ——
 * 所以同一對不會被連兩次，線也不會疊在一起。
 */
/** 點到線段的最短距離。用來判斷一條連線有沒有壓到別的圖案 */
const segDist = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

const linkEdges = (list: any[]): [any, any][] => {
  const used = new Set<string>();
  const out: [any, any][] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const cands = list
      .map((b, j) => ({ b, j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter(c => c.j !== i)
      .sort((u, v) => u.d - v.d);
    for (const c of cands) {
      const key = i < c.j ? `${i}-${c.j}` : `${c.j}-${i}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push([a, c.b]);
      break;
    }
  }
  return out;
};

const hashId = (id: string) => {
  let x = 0;
  for (let i = 0; i < (id || '').length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0;
  return x;
};

/* ── 動態 ──────────────────────────────────────────────────────────
   整套動畫是「純函式」：給一個時間 t，算出每個元素當下的
   縮放、位移、旋轉、透明度。畫布只負責照著畫，所以預覽跟輸出
   一定長得一模一樣，也不需要先錄成影片才看得到。 */

/** 動畫的一格：k=縮放倍率，dx/dy=位移（單位是元素自己的大小），rot=角度，a=透明度 */
/** burst：泡泡破掉的那一圈放射線畫到幾成（0＝沒有、1＝剛破）。只有「泡泡」會用到。 */
export type MoFrame = { k: number; dx: number; dy: number; rot: number; a: number; burst?: number; draw?: number; seq?: number; gridWave?: number; gridReveal?: number; ringReveal?: number; waveMix?: number; idleT?: number };
const FLAT: MoFrame = { k: 1, dx: 0, dy: 0, rot: 0, a: 1 };
const GONE: MoFrame = { k: 0, dx: 0, dy: 0, rot: 0, a: 0 };

const easeOutBack = (p: number) => {
  const c1 = 1.70158, c3 = c1 + 1, q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
};
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOutElastic = (p: number) => {
  if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
};
/** 彈跳落地：標準的四段拋物線 */
const easeOutBounce = (p: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
};

/** 連線的「曲線變速」：同一段時間，線往前長的快慢曲線不一樣 */
export const LINK_EASES: { id: string; name: string; fn: (p: number) => number }[] = [
  { id: 'linear', name: '等速', fn: p => p },
  // 兩頭慢＝中間衝很快、頭尾拖很慢，就是子彈時間那種感覺
  { id: 'ease', name: '子彈時間', fn: easeInOut },
];
export const linkEase = (id: string) => (LINK_EASES.find(e => e.id === id) || LINK_EASES[1]).fn;

/**
 * 進場／離場動畫。第一個是最普通的「淡入」——大部分時候就是要它，
 * 所以放在第一顆，不用每次都往後找。離場用的是同一份清單，只是倒著跑。
 */
export const IN_KINDS: { id: string; name: string }[] = [
  { id: 'none', name: '無' },
  { id: 'pop', name: '果凍' },
  { id: 'fade', name: '淡入' },
  { id: 'rise', name: '升起' },
  { id: 'drop', name: '落下' },
  { id: 'spin', name: '旋轉' },
  { id: 'flip', name: '翻轉' },
  // 這兩個是特別做的：一個會落地彈兩下，一個是從側邊甩進來再晃回正
  { id: 'bounce', name: '彈跳' },
  { id: 'spring', name: '流星' },
];
const LINE_IN_KINDS = [...IN_KINDS.filter(k => k.id !== 'spring'), { id: 'draw', name: '畫筆' }];
const GRID_IN_KINDS = IN_KINDS.map(k => k.id === 'spring' ? { id: 'grid-wave', name: '波浪' } : k);
const SYMBOL_IN_KINDS = IN_KINDS.map(k => k.id === 'fade' ? { id: 'bubble', name: '泡泡' } : k.id === 'spring' ? { id: 'fade', name: '淡入' } : k);

/* 發光用的色票：第一顆是純白，其餘 14 顆是把預設色 #9BD4C3 只轉色相
   （飽和度與亮度完全不動）之後，照色相由小到大排出來的一圈漸層。 */
const GLOW_BASE = '#9BD4C3';
const hslToHex = (h: number, sat: number, l: number) => {
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`.toUpperCase();
};
export const GLOW_SWATCHES: string[] = (() => {
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
  hues.sort((a, b2) => a - b2);                    // 照色相排 → 看起來就是一圈漸層
  return ['#FFFFFF', ...hues.map(h => hslToHex(h, sat, l))];
})();

/* 遮罩用的色票。做法跟發光那組一模一樣：只轉色相、飽和度與亮度完全不動，
   照色相由小到大排成一圈漸層。這裡放兩圈 ——
   淡的那一圈保留以 #D2E8E1 為基準的既有色票，
   深一點的那一圈以 #B8E3D8 為基準，兩種濃淡都給得到。
   第一顆固定純白。 */
const MASK_BASE_LIGHT = '#D2E8E1';
const CREATIVE_MASK_DEFAULT = '#CFE6DE';
const MASK_BASE_DEEP = '#B8E3D8';
/** 把一個顏色拆成 HSL，只換色相繞一圈，回傳 n 顆照色相排好的顏色 */
const hueRing = (baseHex: string, n: number): string[] => {
  const r = parseInt(baseHex.slice(1, 3), 16) / 255;
  const g = parseInt(baseHex.slice(3, 5), 16) / 255;
  const b = parseInt(baseHex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h0 = 0;
  if (d !== 0) {
    h0 = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  }
  const step = 360 / n;
  const hues: number[] = [];
  for (let i = 0; i < n; i++) hues.push((((h0 + i * step) % 360) + 360) % 360);
  hues.sort((a, b2) => a - b2);
  return hues.map(h => hslToHex(h, sat, l));
};
/* 色票整組搬到 utils/pattern.ts 了 —— 遮罩、紋理、條紋的兩個顏色都吃同一份，
   所以全 App 每一個挑顏色的地方看到的色票一模一樣。這裡只是接回來。 */
export const MASK_SWATCHES: string[] = [...CREATIVE_MASK_COLORS];

/* 把任意顏色換成「發光色票裡同色系的那一顆」。
   比的是色相：飽和度與亮度一律用色票自己的（那正是發光看起來乾淨的原因），
   幾乎沒有顏色的（灰、白、黑）就配第一顆純白。 */
export const nearestGlowSwatch = (hex: string): string => {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return GLOW_SWATCHES[0];
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.06) return GLOW_SWATCHES[0];                 // 幾乎無彩度 → 白
  const hueOf = (rr: number, gg2: number, bb: number, mx2: number, d2: number) =>
    (((mx2 === rr ? 60 * (((gg2 - bb) / d2) % 6) : mx2 === gg2 ? 60 * ((bb - rr) / d2 + 2) : 60 * ((rr - gg2) / d2 + 4)) % 360) + 360) % 360;
  const h0 = hueOf(r, g, b, mx, d);
  let best = GLOW_SWATCHES[1], bestD = 1e9;
  for (let i = 1; i < GLOW_SWATCHES.length; i++) {
    const c = GLOW_SWATCHES[i];
    const r2 = parseInt(c.slice(1, 3), 16) / 255, g2 = parseInt(c.slice(3, 5), 16) / 255, b2 = parseInt(c.slice(5, 7), 16) / 255;
    const m2 = Math.max(r2, g2, b2), n2 = Math.min(r2, g2, b2), d2 = m2 - n2;
    if (d2 < 1e-6) continue;
    const h2 = hueOf(r2, g2, b2, m2, d2);
    const dh = Math.min(Math.abs(h0 - h2), 360 - Math.abs(h0 - h2));
    if (dh < bestD) { bestD = dh; best = c; }
  }
  return best;
};

/** 發光自己的常駐動畫（只有常駐，沒有離場） */
/* 排列順序＝畫面上的順序。面板是兩欄，所以每兩個一列：
     靜止 ｜ 閃爍
     呼吸I ｜ 呼吸II      ← 兩顆呼吸並排
     故障I ｜ 故障II      ← 兩顆故障並排 */
/* 發光速度：滑桿上一律顯示 0～100，內部用的是 20～340 的倍率（÷100 才是倍率）。
   刻度是這樣配的：滑桿 50 剛好等於內部 180 —— 也就是呼吸與故障那四款的
   預設效果一點都沒變，只是數字從 100 變成 50，上面還留了一半可以再加快。 */
export const glowSpeedToUi = (v: number) => Math.round((v - 20) / 3.2);
export const glowSpeedFromUi = (u: number) => Math.round(20 + u * 3.2);
/**
 * 符號「縮放 II」的面板固定顯示 0～100，但動畫仍使用原本的速度倍率：
 * UI 0 → 0.70、UI 100 → 1.80。預設的 1.20 因此完全不會被改快或改慢。
 */
export const symbolBreathe2SpeedToUi = (speed: number) =>
  Math.round(Math.max(0, Math.min(100, (speed * 100 - 70) / 1.1)));
export const symbolBreathe2SpeedFromUi = (ui: number) =>
  (70 + Math.max(0, Math.min(100, ui)) * 1.1) / 100;
/** 每一種發光動畫自己的預設速度（內部值；括號是滑桿上看到的數字） */
export const GLOW_SPEED_DEFAULT: Record<string, number> = {
  none: 180,          // (50)
  blink: 84,          // (20)
  breath: 180,        // (50) 效果跟之前完全一樣
  breath2: 180,       // (50)
  twinkle: 180,       // (50)
  glitch: 180,        // (50)
};

export const GLOW_IDLES: { id: string; name: string }[] = [
  { id: 'none', name: '靜止' },
  { id: 'blink', name: '閃爍' },
  { id: 'breath', name: '呼吸I' },
  { id: 'breath2', name: '呼吸II' },
  { id: 'twinkle', name: '呼吸III' },
  { id: 'glitch', name: '故障' },
];

/** 圖片、文字與圖形物件的發光動畫和圖案使用完全相同的完整清單。 */
export const GLOW_IDLES_OBJ: { id: string; name: string }[] = GLOW_IDLES;

/** 虛線描邊的常駐動畫 */
export const DASH_ANIMS: { id: string; name: string }[] = [
  { id: 'none', name: '靜止' },
  { id: 'march', name: '跑馬燈' },
  { id: 'draw', name: '描繪' },
  { id: 'breath', name: '呼吸' },
];

/**
 * 發光在時間 t 的亮度倍率（0～1）。
 *   twinkle（呼吸）：平滑的漸強漸弱，每個元素用自己的相位，所以彼此錯開
 *   blink （閃爍）  ：方波，亮與暗各佔一半；預設速度是「每 0.5 秒暗一次」
 *   glitch（故障）  ：平常全亮，每隔幾秒來一小段高頻閃爍
 * amp 是幅度（0～100，決定最暗會暗到哪裡）、speed 是速度倍率、
 * gain 讓不同對象吃不同強度（圖案的故障比較兇、線比較收斂）。
 */
const glowIdleAmp = (
  kind: string, t: number, phase: number,
  amp: number = 100, speed: number = 1, gain: number = 1,
): number => {
  const A = Math.max(0, Math.min(1, amp / 100));
  const sp = Math.max(0.05, speed);
  if (A <= 0.001) return 1;
  if (kind === 'breath' || kind === 'breath2') {
    /* 呼吸燈的標準做法：exp(sin)。
       為什麼不是三角波、也不是純正弦 —— 眼睛對亮度不是線性的，
       用線性的量去掃，看起來就是「亮很久，然後啪一下掉下去」。
       exp(sin) 在暗的那一端變化很慢、亮的那一端也收得住，
       整條曲線沒有轉折點（無限可微），所以是真的「慢慢亮、慢慢暗」。
       正規化成 0～1：sin 從 -1 走到 1，對應 e^-1 → e^1。
       呼吸I 全部同時；呼吸II 每顆用自己的相位，時機隨機錯開。 */
    const CYCLE = 3.2 / sp;                                  // 一次完整的吸吐
    const off = kind === 'breath2' ? (phase / (Math.PI * 2)) * CYCLE : 0;
    const w = ((((t + off) % CYCLE) + CYCLE) % CYCLE) / CYCLE * Math.PI * 2;
    const E = Math.E, IE = 1 / Math.E;
    const e = (Math.exp(Math.sin(w - Math.PI / 2)) - IE) / (E - IE);   // 0 → 1 → 0
    return 1 - A * (1 - e) * gain;
  }
  if (kind === 'twinkle') {
    // 故障I：正弦，一直在動、不會停 —— 比較像訊號不穩，不是呼吸
    const v = (Math.sin(t * 2.4 * sp + phase) + 1) / 2;
    return 1 - A * (1 - v) * gain;
  }
  if (kind === 'blink') {
    /* 方波：亮一半、暗一半。預設速度（sp=1）時週期 0.5 秒 ——
       也就是每 0.5 秒暗一次，亮 0.25 秒、暗 0.25 秒，兩段一樣長。 */
    const CYCLE = 0.5 / sp;
    const q = ((t % CYCLE) + CYCLE) % CYCLE;
    return q < CYCLE / 2 ? 1 : Math.max(0, 1 - A * gain);
  }
  if (kind === 'glitch') {
    const CYCLE = 3.4 / sp, BURST = 0.45 / sp;
    const q = ((t % CYCLE) + CYCLE) % CYCLE;
    if (q > BURST) return 1;
    // 一段裡面閃四下，收尾回到全亮
    return Math.sin((q / BURST) * Math.PI * 4) > 0 ? 1 : Math.max(0, 1 - A * 0.95 * gain);
  }
  return 1;
};

/** 常駐動畫：進場之後、離場之前一直在動的那一層 */
export const IDLE_KINDS: { id: string; name: string }[] = [
  { id: 'none', name: '靜止' },
  { id: 'float', name: '漂浮' },
  { id: 'grid-wave', name: '波浪' },
  { id: 'breathe', name: '縮放' },
  { id: 'spin', name: '旋轉' },
  { id: 'wobble', name: '搖擺' },
  { id: 'orbit', name: '繞圈' },
  // 特別做的：高頻又不規則的細微抖動，像手持鏡頭
  { id: 'jitter', name: '抖動' },
];
const GRID_IDLE_KINDS = IDLE_KINDS;
/* 圖案是一群遮罩圖案，不再提供位置波浪；改成每顆各自錯開時間的透明度呼吸。 */
const PATTERN_IDLE_KINDS = IDLE_KINDS.map(k =>
  k.id === 'grid-wave' ? { id: 'pattern-breathe', name: '呼吸' } : k
);
/* 圖片的原「旋轉」位置改成和圖案同款的透明度呼吸。 */
const IMAGE_IDLE_KINDS = IDLE_KINDS.map(k =>
  k.id === 'spin' ? { id: 'image-breathe', name: '呼吸' } : k
);
/* 圖案呼吸的面板仍顯示 0～100，但實際有效範圍依設計鎖在：
   幅度 50～100、速度 70～250。 */
const patternBreathAmpToUi = (amp: number) => Math.round(Math.max(0, Math.min(100, (amp - 50) * 2)));
const patternBreathAmpFromUi = (ui: number) => 50 + Math.max(0, Math.min(100, ui)) * 0.5;
const patternBreathSpeedToUi = (speed: number) => Math.round(Math.max(0, Math.min(100, (speed * 100 - 70) / 1.8)));
const patternBreathSpeedFromUi = (ui: number) => (70 + Math.max(0, Math.min(100, ui)) * 1.8) / 100;
const SYMBOL_IDLE_KINDS = IDLE_KINDS.filter(k => k.id !== 'grid-wave').flatMap(k => k.id === 'breathe' ? [{ ...k, name: '縮放I' }, { id: 'symbol-breathe2', name: '縮放II' }] : [k]);
/* 一般文字不再提供旋轉，原位置換成符號同款的縮放 II。 */
const TEXT_IDLE_KINDS = IDLE_KINDS.filter(k => k.id !== 'spin')
  .flatMap(k => k.id === 'breathe' ? [k, { id: 'symbol-breathe2', name: '縮放II' }] : [k]);

/** 進場動畫在進度 p（0～1）時的樣子 */
const inFrame = (kind: string, p: number): MoFrame => {
  if (p <= 0) return GONE;
  if (p >= 1) return FLAT;
  const fade = Math.max(0, Math.min(1, p * 1.6));
  const e = easeOutCubic(p);
  switch (kind) {
    case 'signal': return { ...FLAT, ringReveal: p };
    case 'grid-wave': return { ...FLAT, gridWave: p, gridReveal: easeOutCubic(p) };
    case 'fade':   return { k: 1, dx: 0, dy: 0, rot: 0, a: p };
    case 'rise':   return { k: 1, dx: 0, dy: (1 - e) * 0.9, rot: 0, a: fade };
    case 'drop':   return { k: 1, dx: 0, dy: -(1 - e) * 0.9, rot: 0, a: fade };
    case 'spin':   return { k: e, dx: 0, dy: 0, rot: -(1 - e) * 200, a: fade };
    // 翻轉用「橫向壓扁」模擬（見下面的 inFlipX），不需要真的 3D
    case 'flip':   return { k: 1, dx: 0, dy: 0, rot: 0, a: fade };
    case 'bounce': return { k: 1, dx: 0, dy: -(1 - easeOutBounce(p)) * 1.1, rot: 0, a: Math.min(1, p * 4) };
    case 'spring': { const q = easeOutCubic(Math.min(1, p / 0.62)); const z = Math.max(0, (p - 0.62) / 0.38); const over = z > 0 ? Math.sin(z * Math.PI) * 0.06 : 0; const d = (1 - q) * 1.15; const stretch = (1 - q) * 0.55; return { k: (1 + over) / (1 + stretch), dx: -d, dy: -d * 0.72, rot: -(1 - q) * 28, a: Math.min(1, p * 4), burst: 0 }; }
    case 'draw': return { k: 1, dx: 0, dy: 0, rot: 0, a: 1, draw: e };
    case 'bubble': return { k: 1, dx: 0, dy: 0, rot: 0, a: 1, seq: p };
    case 'none':   return FLAT;
    default:       return { k: easeOutBack(p), dx: 0, dy: 0, rot: 0, a: fade };   // pop
  }
};
/** 橫向要另外縮放的兩種：翻轉是「只壓 X 軸」，彈簧是「跟 Y 軸反著來」 */
const inFlipX = (kind: string, p: number) => {
  if (p <= 0 || p >= 1) return 1;
  if (kind === 'flip') return Math.max(0.02, Math.abs(Math.cos((1 - easeOutCubic(p)) * Math.PI)));
  if (kind === 'spring') { const q = easeOutCubic(Math.min(1, p / 0.62)); return 1 + (1 - q) * 0.55; }
  return 1;
};

/**
 * 常駐動畫在時間 t 的樣子。amp 是幅度（0～100），speed 是快慢倍率。
 * phase 讓每個元素錯開，不然全部一起上下擺會像整片在抖。
 */
const idleFrame = (kind: string, t: number, amp: number, speed: number, phase: number): MoFrame => {
  if (kind === 'none' || amp <= 0) return FLAT;
  const A = amp / 100, w = t * speed + phase;
  switch (kind) {
    case 'float':   return { k: 1, dx: 0, dy: Math.sin(w * 2.0) * A * 0.28, rot: 0, a: 1 };
    case 'sway':    return { k: 1, dx: Math.sin(w * 1.7) * A * 0.28, dy: 0, rot: 0, a: 1 };
    case 'signal': return { ...FLAT, ringReveal: (1 + Math.cos(t * speed * Math.PI / 2)) / 2 };
    case 'grid-wave': return { ...FLAT, gridWave: (t * speed * 0.22 + phase / (Math.PI * 2)) };
    /* 縮放：單純一顆正弦，大…小…大…小，在兩個固定大小之間來回。
       （以前是兩個不同週期的正弦疊起來，所以每一次的最大最小都不一樣 ——
         看起來就是「不規則」，那不是要的。）

       同時要「每個圖案的節奏不一樣，但各自看都是規律的」，
       所以只動兩件事、不動波形：
         · 起點：phase（呼叫端已經依 id 給了各自不同的值）
         · 快慢：由同一個 phase 推出來的 ±17% 倍率
       於是兩顆圖案不會同時最大，但單看任何一顆，都是等速的一大一小。 */
    case 'breathe': {
      const rate = 1 + (((phase * 0.6180339887) % 1) - 0.5) * 0.34;   // 0.83 ~ 1.17
      return { k: 1 + Math.sin(t * speed * 1.9 * rate + phase) * A * 0.44, dx: 0, dy: 0, rot: 0, a: 1 };
    }
    /* 圖片呼吸只改透明度。正弦的亮→暗與暗→亮各佔完全相同的半週期，
       不套 ease、不停頓，因此不會有子彈時間的忽快忽慢。 */
    case 'image-breathe': {
      /* 呼吸第一幀必須承接靜止狀態的全亮，再完整淡到 0。若混入物件的
         隨機 phase，第一個最低點可能在交接尚未完成前就經過，幅度 100
         看起來也只會半透明。從 cos(0)=1 起步便沒有跳幀，也不會漏掉首輪。 */
      const pulse = (Math.cos(t * speed * 1.75) + 1) / 2;
      return { k: 1, dx: 0, dy: 0, rot: 0, a: 1 - A * (1 - pulse) };
    }
    /* 旋轉是「累積量」不是「來回擺」，所以不能吃 phase ——
       phase 最大 6.28，乘上去等於一開場就先轉掉大半圈，
       那正是主人看到的「開頭莫名其妙轉很多圈」。這裡一律從 0 開始轉。 */
    case 'spin':    return { k: 1, dx: 0, dy: 0, rot: t * speed * A * 90, a: 1 };
    case 'wobble':  return { k: 1, dx: 0, dy: 0, rot: Math.sin(w * 2.4) * A * 22, a: 1 };
    case 'orbit':   return { k: 1, dx: Math.cos(w * 1.6) * A * 0.2, dy: Math.sin(w * 1.6) * A * 0.2, rot: 0, a: 1 };
    /* 抖動：三個互為無理數比的高頻正弦疊起來，永遠不會回到同一個位置，
       所以看起來是真的在抖，不是在打拍子。 */
    case 'jitter':  return {
      k: 1,
      dx: (Math.sin(w * 7.3) + Math.sin(w * 11.72)) * A * 0.05,
      dy: (Math.sin(w * 9.13 + 2.1) + Math.sin(w * 13.31)) * A * 0.05,
      rot: (Math.sin(w * 8.7 + 1.3) + Math.sin(w * 15.1)) * A * 2.4,
      a: 1,
    };
    default:        return FLAT;
  }
};

/* ── 速度 ──────────────────────────────────────────────────────
   面板上調的是「速度 0～100」，內部存的還是秒數。
   用指數對應而不是線性：線性的話中段幾乎感覺不到差別，
   而兩端又變化太劇烈。0 → 10 秒、50 → 1.7 秒、100 → 0.3 秒。 */
/* 滑桿還是 0～100，只是最慢端整個往上收：
   以前 0 對應 10 秒，慢到幾乎看不出在動；現在 0 對應 3.49 秒
   （＝舊刻度的 30 那一格），整條滑桿都落在真的有用的區間裡。 */
const SPEED_SLOW = 3.49, SPEED_FAST = 0.3;
export const durFromSpeed = (sp: number) =>
  SPEED_SLOW * Math.pow(SPEED_FAST / SPEED_SLOW, Math.max(0, Math.min(100, sp)) / 100);
export const speedFromDur = (d: number) =>
  Math.max(0, Math.min(100, Math.round(100 * Math.log(Math.max(1e-4, d) / SPEED_SLOW) / Math.log(SPEED_FAST / SPEED_SLOW))));

/** 一個元素的動態設定 */
export type MoCfg = {
  /** 進場 */
  delay: number; dur: number; in: string;
  direction?: PatternDirection;
  /** 常駐 */
  idle: string; amp: number; speed: number;
};
export const MO_DEFAULT: MoCfg = {
  delay: 0, dur: durFromSpeed(70), in: 'pop',
  idle: 'none', amp: 50, speed: 0.9,
};
const GRID_WAVE_DEFAULT = { amp: 50, speed: 0.9 } as const;
/* 非網格物件的波浪滑桿仍映射 100～250 的實際速度；介面 50 對應 175。 */
const NON_GRID_WAVE_DEFAULT = { amp: 30, speed: 1.75 } as const;
export const nonGridWaveSpeedToUi = (speed: number) =>
  Math.round(Math.max(0, Math.min(100, (speed * 100 - 100) / 1.5)));
export const nonGridWaveSpeedFromUi = (ui: number) =>
  (100 + Math.max(0, Math.min(100, ui)) * 1.5) / 100;
export const moOf = (o: any): MoCfg => {
  const cfg = { ...MO_DEFAULT, ...(o && o.mo ? o.mo : null) };
  /* 舊草稿裡的「左右」也真正遷移到網格同款波浪，不只是改顯示名稱。 */
  if (cfg.idle === 'sway') cfg.idle = 'grid-wave';
  /* 符號不提供波浪；舊草稿若曾選過，恢復為靜止，其他物件維持原設定。 */
  if (o?.sym && cfg.idle === 'grid-wave') cfg.idle = 'none';
  /* 圖片原本的旋轉已由透明度呼吸取代；舊專案也直接遷移，不留下選單中
     看不到、但背景仍偷偷旋轉的舊狀態。 */
  if (o?.type === 'image' && cfg.idle === 'spin') cfg.idle = 'image-breathe';
  if (o?.type === 'shape' && GRID_SHAPE_KINDS.has(o.kind) && cfg.in === 'spring') cfg.in = 'grid-wave';
  return cfg;
};

/**
 * 把進場 → 常駐 → 離場疊起來。
 * 交棒處用 0.35 秒淡入接上常駐，不然從進場切到常駐會跳一下。
 */
const composeMo = (cfg: MoCfg, t: number, phase: number): MoFrame & { fx: number } => {
  /* 「無」不是一段看不見的進場動畫：它沒有 delay、也沒有 duration。
     舊版仍先空等 cfg.delay + cfg.dur，使用者就會看到畫面靜止幾秒才開始常駐。 */
  const hasIntro = cfg.in !== 'none';
  const introEnd = hasIntro ? cfg.delay + Math.max(0, cfg.dur) : 0;
  const p = hasIntro
    ? (cfg.dur > 0 ? (t - cfg.delay) / cfg.dur : (t >= cfg.delay ? 1 : 0))
    : 1;
  /* 進場與常駐都選波浪時共用同一條 phase：進場跑完一個完整週期，
     接著直接循環，不會同時疊上兩個波形。 */
  if (cfg.in === 'grid-wave' && cfg.idle === 'grid-wave') {
    /* 進場波浪走到 phase=1 後，常駐波浪必須從同一幀接著走，不能繼續
       沿用進場的 dur。舊寫法直接回傳 p，因此常駐速度永遠被「進場速度」
       綁死，面板上的速度滑桿看似有變、實際畫面卻完全不理它。 */
    const introP = Math.max(0, p);
    if (introP < 1) {
      return { ...FLAT, fx: 1, burst: 0, gridWave: introP, gridReveal: easeOutCubic(introP) };
    }
    const after = Math.max(0, t - introEnd);
    return { ...FLAT, fx: 1, burst: 0, gridWave: 1 + after * cfg.speed * 0.22, waveMix: 1 };
  }
  const f = inFrame(cfg.in, Math.max(0, Math.min(1, p)));
  const fx = inFlipX(cfg.in, Math.max(0, Math.min(1, p)));
  if (p < 1) return { ...f, fx, burst: f.burst || 0 };
  const after = Math.max(0, t - introEnd);
  /* 交棒不再用短促的 420ms smootherstep（中段速度峰值很高，手機上看起來
     就是前 0.x 秒突然加速）。改成 720ms smoothstep：第一格位置與速度都是 0，
     中段不會暴衝，結束時速度也能平順接上完整的常駐曲線。沒有進場時同樣
     從第 0 秒開始漸進，並沒有額外等待。 */
  const attackP = Math.max(0, Math.min(1, after / 0.72));
  const blend = attackP * attackP * (3 - 2 * attackP);
  const g = idleFrame(cfg.idle, after, cfg.amp, cfg.speed, phase);
  return {
    k: 1 + (g.k - 1) * blend,
    dx: g.dx * blend, dy: g.dy * blend, rot: g.rot * blend,
    /* 圖片呼吸本身從 a=1 起步，不需要再套第二層 attack。直接採用其 alpha
       才能讓幅度 100 的第一個低點真正到 0；其他動畫維持既有交接。 */
    a: cfg.idle === 'image-breathe' ? g.a : 1 + (g.a - 1) * blend, fx: 1, burst: 0,
    gridWave: g.gridWave, waveMix: blend, ringReveal: g.ringReveal,
    /* 常駐的本地時間明確交給符號分單位動畫；進場期間不存在，交棒第一幀為 0。 */
    idleT: after,
  };
};

/** 這個元素整段動畫在什麼時候結束（排時間軸用） */
const moEnd = (cfg: MoCfg) => cfg.in === 'none' ? 0 : cfg.delay + cfg.dur;

/** 新增文字時預設放的字。跟經典拼圖同一個字串。 */
const TEXT_PLACEHOLDER = '輸入文字';
// --- 工具：HSV to HEX 轉換 ---
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
  title: string;
  /** 下方那排色票。不給就用預設的韓系色（發光那邊給的是自己那組） */
  swatches?: string[];
}

// --- 下方內嵌選色器元件 (支援手動輸入色號) ---
/** 韓系拼貼常見的柔和底色，與經典拼圖同一組 */
// 跟經典拼圖用同一組色票（相近的顏色排在一起）：
// 白 → 暖白 → 暖灰 → 奶油 → 米 → 粉 → 黃 → 綠／薄荷／淺青 → 藍 → 紫
const KOREAN_PRESETS = [...DEFAULT_COLORS];
const ColorPickerEmbedded: React.FC<ColorPickerProps> = ({ color, onChange, onClose, title, swatches }) => {
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

  const handlePresetClick = (p: string) => {
    setHsv(hexToHsv(p));
    setHexInput(p);
    onChange(p);
  };

  // 前段跟經典拼圖同一組色票（相近的顏色排在一起），後段保留原本的灰階
  const PRESET_COLORS = KOREAN_PRESETS;

  return (
    <div className="h-full flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex justify-between items-center mb-3">
        <button onClick={onClose} className="flex items-center gap-2 text-[#888] hover:text-white transition-colors">
          <ArrowLeft size={14} />
          <span className="text-[10px] font-bold tracking-widest uppercase">返回</span>
        </button>
        <KeyboardSafeInput
          type="text"
          value={hexInput}
          onChange={handleHexInputChange}
          maxLength={7}
          aria-label="色號"
          style={{ fontSize: 16 }}
          className="shrink-0 h-8 w-[86px] bg-[#1A1A1A] border border-[#333] rounded-[7px] px-2 text-white font-mono text-xs outline-none focus:border-white/50"
        />
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
          {/* 預設是韓系拼貼常用色（與經典拼圖同一組）；呼叫端可以換掉 */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-0.5 py-0.5 mt-2">
            {/* 遮罩／紋理的色票也和其他顏色工具一致：第一格永遠是自訂色，
                不必先離開色票頁才找得到完整調色盤。 */}
            <label
              title="自訂顏色"
              aria-label="自訂顏色"
              className="w-8 h-8 rounded-full shrink-0 relative cursor-pointer ring-1 ring-white/40 flex items-center justify-center overflow-hidden active:scale-90 transition-transform"
              style={{ background: 'conic-gradient(#f43,#fa3,#fd3,#3d6,#3cf,#63f,#f3a,#f43)' }}
            >
              <span className="absolute inset-[5px] rounded-full bg-[#080808] flex items-center justify-center">
                <Icon name="colorize" className="text-[13px] text-white" />
              </span>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff'}
                onChange={e => handlePresetClick(e.target.value.toUpperCase())}
                className="absolute inset-0 opacity-0 cursor-pointer" aria-label="自訂顏色" />
            </label>
            {(swatches || KOREAN_PRESETS).map(c => {
              const active = c.toUpperCase() === (color || '').toUpperCase();
              return (
                <button
                  key={c}
                  onClick={() => handlePresetClick(c)}
                  title={c}
                  className={`shrink-0 w-8 h-8 rounded-[7px] transition-all active:scale-90 ${
                    active ? 'border-2 border-white' : 'border border-white/20'
                  }`}
                  style={{ backgroundColor: c }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

interface CollageToolProps {
  onHome: (keepDraft?: boolean) => void;
  onRequestExit?: () => Promise<ExitChoice>;
  /** 濾鏡清單，跟「編輯」「經典拼圖」同一份 */
  lutList?: { id: string; name: string; url: string }[];
  initialFile?: File | null;
  /** 首頁多選的其餘照片：按選取順序加入同一個圖片排版區域。 */
  initialExtras?: File[];
  onImportNew: () => void;
  /** 接續上次時把存下來的參數餵回來 */
  initialState?: any;
  /** 從歷史紀錄點開來的那一筆的 key。再記一次的時候沿用它＝更新同一筆 */
  histKey?: string | null;
}

export const CollageTool: React.FC<CollageToolProps> = ({ onHome, onRequestExit, initialFile, initialExtras, onImportNew, initialState, histKey, lutList = [] }) => {
  useKeyboardRecovery();
  const [imageState, setImageState] = useState<any>(null);
  const [photoRegion, setPhotoRegion] = useState<PhotoRegion | null>(null);
  const photoRegionRef = useRef(photoRegion);
  const committedRegionRef=useRef(photoRegion);
  if(committedRegionRef.current!==photoRegion){photoRegionRef.current=photoRegion;committedRegionRef.current=photoRegion;}
  const regionPaintRef=useRef<()=>void>(()=>{});
  const regionPaintRaf=useRef(0);
  useEffect(()=>()=>{if(regionPaintRaf.current)cancelAnimationFrame(regionPaintRaf.current);},[]);
  const decodedRegionPhotos = useRef(new Map<string, HTMLImageElement>());
  const regionDrawables=useRef(new Map<string,ImageBitmap>());
  const [layout, setLayout] = useState('mask-bottom');
  useEffect(()=>{
    let cancelled=false;const sources=new Set(photoRegion?.photos.map(p=>p.src).filter(Boolean));
    for(const [src,bitmap] of regionDrawables.current)if(!sources.has(src)){bitmap.close();regionDrawables.current.delete(src);}
    // The normal grid renderer already retains original GPU textures. Native
    // ImageBitmaps duplicate every decoded photograph and are needed only by
    // the surrounding-layout CPU fallback, not by swapping or grid zoom.
    const needsPinnedBitmap=layout===AROUND;
    if(!needsPinnedBitmap){for(const bitmap of regionDrawables.current.values())bitmap.close();regionDrawables.current.clear();}
    void(async()=>{for(const src of needsPinnedBitmap?sources:[]){
      if(regionDrawables.current.has(src))continue;
      await awaitPhotoIdle();if(cancelled)return;
      const img=decodedRegionPhotos.current.get(src);if(!img||typeof createImageBitmap!=='function')continue;
      let bitmap:ImageBitmap|null=null,surface:HTMLCanvasElement|null=null;
      try{bitmap=await createImageBitmap(img);
        await awaitPhotoIdle();if(cancelled)return;
        surface=document.createElement('canvas');surface.width=bitmap.width;surface.height=bitmap.height;
        const g=get2dWide(surface)!;g.drawImage(bitmap,0,0);
        // Materialize deferred decode/upload while idle, not in the first
        // geometry draw. This single-pixel read does not resample the source.
        g.getImageData(0,0,1,1);bitmap.close();bitmap=null;
        const drawable=await createImageBitmap(surface);surface.width=surface.height=1;
        if(cancelled){drawable.close();return;}
        regionDrawables.current.set(src,drawable);
      }catch{/* Keep the decoded image on browsers without bitmap support. */}
      finally{bitmap?.close();if(surface)surface.width=surface.height=1;}
    }
    await awaitPhotoIdle();if(cancelled)return;
    const region=photoRegionRef.current;
    if(region&&region.photos.length>1){
      const decoded=new Map(decodedRegionPhotos.current);
      try{creativeSeam.current??=new CreativeSeamless();creativeSeam.current.warm(region,decoded);}catch{}
    }
    })();
    return ()=>{cancelled=true;};
  },[photoRegion?.photos.map(p=>p.src).join('|'),imageState,layout]);
  useEffect(()=>()=>{for(const bitmap of regionDrawables.current.values())bitmap.close();regionDrawables.current.clear();},[]);
  const creativeSeam = useRef<CreativeSeamless|null>(null);
  useEffect(()=>()=>creativeSeam.current?.dispose(),[]);
  const [photoLayoutOpen, setPhotoLayoutOpen] = useState(false);
  const [selectedRegionPhoto, setSelectedRegionPhoto] = useState<number | null>(null);
  const selectedRegionPhotoRef = useRef<number | null>(null);
  selectedRegionPhotoRef.current = selectedRegionPhoto;
  const regionUploadRef = useRef<HTMLInputElement>(null);
  const regionUploadIndex = useRef(0);
  const photoImportEpoch = useRef(0);
  const photoRegionEpoch = useRef(0);
  const loadRegion = async (region: PhotoRegion) => {
    await Promise.all([...region.photos,...(region.overflowPhotos||[])].map(photo => {
      if (!photo.src || decodedRegionPhotos.current.has(photo.src)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => { decodedRegionPhotos.current.set(photo.src, img); resolve(); };
        img.onerror = reject;
        img.src = photo.src;
      });
    }));
    return {...region,multi:region.multi ?? region.photos.length>1};
  };
  const [maskScale, setMaskScale] = useState(DEFAULT_MASK_SCALE);
  const liveMaskScale=useRef<number|null>(null);
  const maskScaleValue=useRef(maskScale);maskScaleValue.current=maskScale;
  const occupancyFrame=useRef(0);
  useEffect(()=>()=>cancelAnimationFrame(occupancyFrame.current),[]);
  const [canvasRatio, setCanvasRatio] = useState<CanvasRatio>('1:1');
  const [canvasRatioBeforeFull, setCanvasRatioBeforeFull] = useState<CanvasRatio|null>(null);
  const [holeType, setHoleType] = useState('star'); 
  const [customText, setCustomText] = useState('Abai'); 
  const [holeSize, setHoleSize] = useState(25); 
  const [sizeJitter, setSizeJitter] = useState(0); 
  const [holeAngle, setHoleAngle] = useState(0);
  /* 連線：每個圖案拉一條極細的線到最近的鄰居。只有前六種圖案支援。
     線跟圖案走同一條路 —— 在遮罩上是挖穿的，在圖片上是遮罩色的實心線。 */
  /** 'none' 沒有線｜'solid' 連線｜'dash' 虛線。兩種線本來就是同一件事，
      只差線型，所以做成一個三態 —— 也就不可能同時打開。 */
  const [linkMode, setLinkMode] = useState<'none' | 'solid' | 'dash'>('none');
  /* 連線的顏色。null＝維持原本的樣子（在圖片上是遮罩色的實心線、
     在遮罩上是挖穿的）；指定顏色之後兩側都用那個顏色畫。 */
  const [linkColor, setLinkColor] = useState<string | null>(null);
  const linkSupported = linkableType(holeType);
  /* 動態播放中的那一格。不是 state —— 每一格都在動，走 ref 讓 renderToCanvas
     直接讀，才不會每一格都觸發一次 React 重繪。null 代表「不在播動態」。 */
  const animRef = useRef<{
    hole: (h: any, i: number) => MoFrame & { fx: number };
    /** 第 ia 顆與第 ib 顆之間那條線畫到幾成（0～1）。兩端都冒出來之後才會開始 */
    link: (ia: number, ib: number) => number;
    /** 發光在這一格的亮度倍率（0～1），只受發光自己那組常駐動畫影響 */
    glow: (h: any) => number;
    /** 同上，但這是「線」用的（故障那款線比較收斂） */
    glowLink: (h: any) => number;
    /** 圖片／文字物件的發光亮度 */
    glowObj: (o: any) => number;
    obj: (o: any, i: number) => MoFrame & { fx: number };
  } | null>(null);
  const [holeCount, setHoleCount] = useState(11);
  /** 滿版本身沒有遮罩圖案，但數量欄不能被重設成 0；離開滿版時精準還原。 */
  const [holes, setHoles] = useState<any[]>([]); 
  /* 浮動物件：疊在拼圖最上層的圖片與文字。
     跟「挖洞」完全分開 —— 洞是把遮罩打穿，這些是貼上去的圖層。
     座標一律用「輸出畫布」的座標系（跟遮罩同一套），縮放時再乘上倍率。 */
  const [objects, setObjects] = useState<any[]>([]);
  const objectsRef = useRef<any[]>([]);
  objectsRef.current = objects;
  const [selectedObj, setSelectedObj] = useState<string | null>(null);
  /** 最初匯入的底圖不是「新增圖片」物件；它有自己獨立、只負責構圖的選取狀態。 */
  const [baseSelected, setBaseSelected] = useState(false);
  const baseSelectedRef = useRef(false);
  baseSelectedRef.current = baseSelected;
  const [maskSelected, setMaskSelected] = useState(false);
  const maskSelectedRef = useRef(false);
  maskSelectedRef.current = maskSelected;
  const baseDragRef = useRef<any>(null);
  const basePinchRef = useRef<any>(null);
  /* 動畫目標提示：切換目標時只短暫畫虛線框，不改動正式選取狀態。 */
  const motionTargetFlashRef = useRef<{ id: string; started: number; duration: number } | null>(null);
  const [motionTargetFlashSeq, setMotionTargetFlashSeq] = useState(0);
  const selectedObjRef = useRef<string | null>(null);
  selectedObjRef.current = selectedObj;
  const objDragRef = useRef<any>(null);
  const [objDragging, setObjDragging] = useState(false);
  const objDraggingRef = useRef(false);
  const [objStretching, setObjStretching] = useState(false);
  const objStretchRef = useRef<any>(null);
  /* ── 形狀的第二段選取 ────────────────────────────────────────────
     選中圖片之後**再點一次圖片**，才進到「選中形狀」：
       · 選取框改成沿著形狀描一圈，方框收起來
       · 在圖案裡面拖曳 ＝ 調整圖片在形狀裡的位置
       · 兩指捏 ＝ 調整圖片在形狀裡的大小
       · 點到形狀外面就退回「只選中圖片」
     單純選中圖片（第一段）時不能調位置，跟一般物件一樣是搬移。
     ref 是給指標事件那幾支用的 —— 它們不會跟著 state 重新綁定。 */
  const [shapeSel, setShapeSel] = useState<string | null>(null);
  const shapeSelRef = useRef<string | null>(null);
  /** 剛剛因為「手指按在形狀外面」而退掉的那一顆。第二根手指跟上時要復原。 */
  const shapeSelUndoRef = useRef<string | null>(null);
  /** 這一下的按壓是不是「剛從選中形狀退回選中圖片」——是的話就不要再取消選取 */
  const justLeftShapeRef = useRef(false);
  useEffect(() => { shapeSelRef.current = shapeSel; }, [shapeSel]);
  // 取消選取、或換選別的物件 → 形狀選取一起收掉
  useEffect(() => { if (shapeSel && shapeSel !== selectedObj) setShapeSel(null); }, [selectedObj, shapeSel]);
  /** 這一點是不是落在某顆圖片的形狀裡面（物件座標→形狀命中判斷） */
  const hitShapeOf = (o: any, px: number, py: number) => {
    if (!o || !o.img || !isImgShaped(o.imgShape)) return false;
    const r0 = ((o.rot || 0) * Math.PI) / 180;
    const ax = px - (o.x + o.w / 2), ay = py - (o.y + o.h / 2);
    const ux = ax * Math.cos(-r0) - ay * Math.sin(-r0) + o.w / 2;
    const uy = ax * Math.sin(-r0) + ay * Math.cos(-r0) + o.h / 2;
    return isPointInImgShape(o.imgShape, o.w, o.h, ux, uy);
  };
  const objPinchRef = useRef<any>(null);
  /* 每個圖片物件跑完管線之後的成品，快取起來 —— 參數沒變就不重跑。
     key 是「物件 id + 參數指紋」，所以只有動到的那一張會重算。 */
  const objFxCache = useRef<Map<string, { key: string; cv: HTMLCanvasElement }>>(new Map());
  const regionFxSurfaces = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const regionPreviewCaps=useRef(new Map<string,number>());
  const regionStaticSnapshot=useRef<{cv:HTMLCanvasElement}|null>(null);
  const regionPhotoEditingRef=useRef(false);
  useEffect(()=>{
    const keys=new Set(photoRegion?.photos.map((p,i)=>`region-fx-${i}@${p.src}`)||[]);
    for(const [key,cv] of regionFxSurfaces.current)if(!keys.has(key)){releasePhotoFxSurface(cv);cv.width=cv.height=1;regionFxSurfaces.current.delete(key);objFxCache.current.delete(key);regionPreviewCaps.current.delete(key);}
  },[photoRegion]);
  useEffect(()=>()=>{for(const cv of regionFxSurfaces.current.values()){releasePhotoFxSurface(cv);cv.width=cv.height=1;}regionFxSurfaces.current.clear();},[]);
  const regionBlendTool=useRef('');
  const regionBlend=useRef<PhotoAdjustmentBlend|null>(null);
  const regionWarmStage=useRef<{index:number;canvas:HTMLCanvasElement}|null>(null);
  const regionSceneKey=useRef('');
  const regionGpuSceneKey=useRef('');
  const sceneSourceTokens=useRef(new Map<string,number>());
  const sceneTokenCounter=useRef(0);
  const compactSceneValue=(_key:string,value:any)=>{
    if(typeof value==='string'&&(value.startsWith('data:')||value.startsWith('blob:'))){
      const map=sceneSourceTokens.current;
      if(!map.has(value)){if(map.size>=64)map.delete(map.keys().next().value!);map.set(value,++sceneTokenCounter.current);}
      return `source:${map.get(value)}`;
    }return value;
  };
  const regionColour=useRef<PhotoSceneColour|null>(null);
  const regionColourActive=useRef(false);
  const regionSpatialActive=useRef(false);
  const regionPreflight=useRef(false);
  const regionSelectionFeedbackPending=useRef(false);
  const regionPrimedSource=useRef('');
  const regionPlacements=useRef<FxPlacement[]|null>(null);
  const regionSpatialInput=useRef<HTMLCanvasElement|null>(null);
  const regionSpatial=useRef<{key:string;scale:number;scene:FxScene;input:HTMLCanvasElement;shown?:HTMLCanvasElement}|null>(null);
  useEffect(()=>()=>{const r=regionSpatial.current;if(r){r.shown?.remove();r.scene.black.width=r.scene.black.height=r.scene.white.width=r.scene.white.height=1;}if(regionSpatialInput.current)releasePhotoFxSurface(regionSpatialInput.current);},[]);
  useEffect(()=>()=>regionColour.current?.dispose(),[]);
  const regionSceneStamp=useRef<{key:string;renderer:any;scale:number;source:CanvasImageSource;w:number;h:number;sceneW:number;sceneH:number}|null>(null);
  regionBlend.current??=new PhotoAdjustmentBlend(()=>{
    // Warming the cache does not change the visible result. Repainting the
    // exact collage here queues avoidable GPU work just before the first drag.
    if(import.meta.env.DEV&&canvasRef.current)canvasRef.current.dataset.regionBlendReady=String(regionBlend.current?.isReady);
  });
  useEffect(()=>()=>regionBlend.current?.clear(),[]);
  /** 每顆物件上一次的「效果參數指紋 / 算完的時間 / 花了多久」——
      用來判斷「這顆的參數是不是正在被連續改動」（也就是手指還在滑桿上）。 */
  const fxLiveRef = useRef<Map<string, { key: string; at: number; liveUntil: number }>>(new Map());
  /** 手一停就補一張完整尺寸的 */
  const fxSettleRef = useRef<number | null>(null);
  /** 影片物件固定用的那幾張離屏畫布（每顆一組，不重複配置） */
  const vidScratchRef = useRef<Map<string, VidScratch>>(new Map());
  /** 這次工作階段讀進來過的每一段影片 —— 離開時要一段不漏地收掉。
      只看「現在還在畫面上的」是不夠的：刪掉的物件被上一步救得回來，
      所以它的 <video> 一直留著，那一段也要有人負責收。 */
  const bornVidsRef = useRef<Set<HTMLVideoElement>>(new Set());
  /* 圖片編輯面板拿到的那顆物件。影片要把 src 換成第一格的縮圖（卡片牆是拿
     src 去重畫的，影片的網址畫不出東西）——但**不能每次 render 都生一顆新的**：
     卡片牆看的是這顆物件的身分，身分一直換就等於整面卡片一直重做。
     同一顆物件就回同一份。 */
  const panelImgRef = useRef<{ from: any; out: any } | null>(null);
  const panelImgOf = (o: any) => {
    if (!o || !o.vid || !o.poster) return o;
    if (panelImgRef.current && panelImgRef.current.from === o) return panelImgRef.current.out;
    const out = { ...o, src: o.poster };
    panelImgRef.current = { from: o, out };
    return out;
  };
  const [fxTick, setFxTick] = useState(0);
  /**
   * onScreenPx：這一顆在**畫布上實際佔幾個像素**（呼叫端算好傳進來）。
   *
   * 影片是一秒幾十次地重跑整條效果管線，處理的像素多一個就多一分成本。
   * 一段 1080p 的影片顯示在 268px 寬的框裡，卻照 1600px 去跑濾鏡 ——
   * 那是 36 倍用不到的像素。這裡把工作尺寸夾到「畫面上真的看得到的大小」
   * （再多給 15% 的餘裕，縮放、抗鋸齒都還夠用）。
   * 匯出走的是另一條路（isMain 為 false、倍率是匯出倍率），
   * 算出來的 onScreenPx 本來就是全解析度，所以一個像素都不會少。
   */
  const regionEffectCapacity=(photo:any,index:number,w:number,h:number,onScreenPx:number)=>{
    const transform=latestImageTransform.current,sourceSize=Math.max(w,h);
    const cell=photoRegionRef.current&&regionRects(photoRegionRef.current,Math.abs(transform.w),Math.abs(transform.h))[index];
    const scale=onScreenPx/Math.max(1,Math.abs(transform.w),Math.abs(transform.h));
    let required=onScreenPx;
    if(cell){const dw=Math.abs(transform.w)*cell.w,dh=Math.abs(transform.h)*cell.h,crop=photoCrop(photo,dw,dh);
      required=sourceSize*Math.max(dw*scale/Math.max(1,crop.sw),dh*scale/Math.max(1,crop.sh));}
    const id=`region-fx-${index}@${photo.src}`;
    // Reserve the source's normal photo-resolution tier before its first
    // effect input. A preview pinch must not cross the old 1600 -> 2048 tier
    // and rebuild the whole filter/effect pipeline under the fingers.
    // Larger originals still grow to physical display demand; no lower-quality
    // interaction mode is used and only the current slot owns a shader pool.
    const cap=photoPreviewCapacity(required,Math.max(regionPreviewCaps.current.get(id)||0,Math.min(sourceSize,4096)),sourceSize);
    regionPreviewCaps.current.set(id,cap);return cap;
  };
  const fxCanvasOf = useCallback((o: any, isMain = false, onScreenPx = 0, prepareNative = false): CanvasImageSource | null => {
    if (!o.img) return null;
    const warm=regionWarmStage.current;
    if(warm&&o.id?.startsWith(`region-fx-${warm.index}@`))return warm.canvas;
    const shape = {
      r: o.imgRadius || 0, f: o.feather || 0,
      sw: o.imgStrokeWidth || 0, sg: o.imgStrokeGap || 0, sc: o.imgStrokeColor || '#FFFFFF', sd: o.imgStrokeDash || 0,
      g: o.imgGlow || 0, gc: o.imgGlowColor || '#FFFFFF',
      /* 外形（圓形／星型／愛心）與圖片在形狀裡的位移。
         沒選形狀時 k 是 undefined，下面每一段都走原本那條路。 */
      k: o.imgShape as string | undefined, px: o.imgShapeX || 0, py: o.imgShapeY || 0,
      z: o.imgShapeZoom || 1,
    };
    const hasShape = shape.r || shape.f || shape.sw || shape.g || isImgShaped(shape.k);
    if(!isMain&&o.id?.startsWith('region-fx-')){
      const preview=objFxCache.current.get(o.id);
      const required=Math.min(2400,Math.max(o.img.naturalWidth||o.img.width,o.img.naturalHeight||o.img.height));
      if(!hasShape&&preview?.key.startsWith(JSON.stringify([o.fx,shape])+'|')&&Math.max(preview.cv.width,preview.cv.height)>=required)return preview.cv;
      // History/export must not replace a live photo's work surface or cache
      // key with a different-sized result halfway through a gesture.
      o={...o,id:`export-${o.id}`};
    }
    /* 影片裁切過的話，就算沒有效果也沒有形狀，也還是要走下面那條路
       （每一格都要先把構圖套上去）。照片的構圖是烤成一張新圖的，不受影響。 */
    const needGeo = isVideoEl(o.img) && o.geo && !isGeoIdentity(o.geo);
    /* 影片這一格要落成多大：就是它在畫布上實際佔的大小（多給 15% 餘裕）。
       一段 1080p 的影片顯示在 268px 的框裡，沒有任何理由去處理 1920px。 */
    const vidCap = isVideoEl(o.img) && onScreenPx > 0
      ? Math.max(64, Math.ceil(onScreenPx * 1.15)) : 0;
    /* 什麼都沒套的時候直接用來源本人。影片的「來源本人」是那一格的畫布
       （見 utils/videoSource 的 videoFrame）——**不能**把 <video> 直接交出去，
       那會讓畫布端每一格多付十幾毫秒（那正是導入影片後掉格數的原因）。 */
    if ((!o.fx || !hasPhotoFx(o.fx)) && !hasShape && !needGeo && !(isMain&&o.id?.startsWith('region-fx-')&&regionBlendTool.current)) return videoFrame(o.img, vidCap);

    /* ── 拖圖片調整的滑桿時先用小一號的工作尺寸 ─────────────────────────
       每動一格都要把整張圖重新套一次調整。1600px 的工作尺寸在沒有 GPU 的
       裝置上實測一格 145ms —— 等於六幀才動一次，那就是主人說的「編輯圖片
       特別卡」。

       這裡只在「上一次算得很慢、而且就是剛剛」的時候才降一級：那必然是
       手指還按在滑桿上。手一停（220ms 沒有新的變化）就自動用完整尺寸重算，
       所以**停下來看到的、以及匯出的，跟以前一模一樣**，只有拖曳過程中的
       那幾格是小一號的。匯出走的是另一張畫布（isMain 為 false），
       永遠不會落到這條路上。 */
    const now = performance.now();
    const baseKey = JSON.stringify([o.fx, shape]);
    let lv = fxLiveRef.current.get(o.id);
    if (!lv) { lv = { key: '', at: 0, liveUntil: 0 }; fxLiveRef.current.set(o.id, lv); }
    /* 「正在連續改動」的判斷有兩個重點：
       ① 一定要看**參數本身有沒有變** —— 只看時間的話，拖物件、取消選取那些
          根本沒改到效果的動作也會被誤判成拖滑桿。
       ② 一旦判定為「拖曳中」，就用一個到期時間撐著，不要每次呼叫重新判斷 ——
          同一格畫面裡 fxCanvasOf 可能被呼叫不只一次，第二次的參數已經跟
          第一次一樣了，逐次判斷會在 640 與 1600 之間來回重算（實測 640 與
          1600 各算了 30 次，等於完全沒省到）。 */
    const regionPhoto = o.id?.startsWith('region-fx-');
    if (isMain && !regionPhoto && lv.key && lv.key !== baseKey) lv.liveUntil = now + 300;
    const live = isMain && !regionPhoto && lv.liveUntil > now;
    /* 匯出時工作尺寸放寬到 2400：成品現在最少也有 2400px 長邊（見 EXPORT_MIN_DIM），
       圖片物件如果還卡在 1600，畫上去等於被放大過 —— 那一顆就會比旁邊的
       圖形與文字糊。預覽維持 1600（拖曳中 640），手感完全沒動到。 */
    let cap = live ? 640 : (isMain ? 1600 : 2400);
    // Base-photo previews must use the preview route, not the export route.
    // Keep ordinary full preview density (never its live/640 shortcut), and
    // grow it to the actual canvas pixel footprint when the view is enlarged.
    if (isMain && regionPhoto) {
      // Photo cells use independent crop coordinates. Their preview density
      // must be derived from that cell, not from all the other photos.
      const slot=Number(o.id.slice('region-fx-'.length).split('@')[0]);
      // Use the actual photo's device-pixel footprint (including crop zoom),
      // not the entire nine-photo region or the native file size. Capacity
      // only grows, and always exceeds physical display demand; no live/640
      // quality shortcut is used for a base photograph.
      cap=regionEffectCapacity(o,slot,o.img.naturalWidth||o.img.width,o.img.naturalHeight||o.img.height,onScreenPx);
      if(prepareNative)cap=Math.max(o.img.naturalWidth||o.img.width,o.img.naturalHeight||o.img.height);
    }
    /* 只有影片吃這個夾子 —— 圖片的成品是算一次就留著的，多算沒有代價，
       維持原本的尺寸才不會讓任何既有的畫面變糊。 */
    if (vidCap > 0) cap = Math.min(cap, vidCap);
    /* ── 來源是影片的時候 ────────────────────────────────────────────
       參數（濾鏡、形狀、描邊…）從頭到尾不會變，但內容每一格都不一樣 ——
       鑰匙裡不多放一個「現在是第幾格」，畫面就會停在第一幀。
       暫停時 videoToken 不會變，那些快取一樣全部命中，一格都不會白算。 */
    const vTok = isVideoEl(o.img) ? videoToken(o.img) : 0;
    const isVid = vTok !== 0 || isVideoEl(o.img);
    const key = baseKey + '|' + cap + '|lutReady:' + !!getLoadedLut(o.fx?.lut) + (isVid ? '|v' + vTok : '');
    const hit = objFxCache.current.get(o.id);
    // An immutable original-resolution result is independent of the display
    // footprint. Zoom/occupancy changes sample it; they never rebake effects.
    if(hit?.cv instanceof HTMLCanvasElement&&hit.cv.dataset.regionImmutable==='1'
      &&hit.key.startsWith(baseKey+'|')&&hit.key.includes('|lutReady:'+!!getLoadedLut(o.fx?.lut))
      &&Math.max(hit.cv.width,hit.cv.height)>=cap)return hit.cv;
    // A geometry-only redraw must not prepare effects or touch a GPU pool.
    // In particular the fallback blend preparation used to precede this hit.
    // The key contains every pixel-affecting parameter. A selected photo's
    // crop, hover or tab change must not rebuild its effect endpoints.
    if (hit && hit.key === key) return hit.cv;
    /* ── 這裡以前有一個「影片＋形狀就限速到 20fps」的閘門，已經拿掉 ────────
       當初加它是因為那條路一格要開三、四張離屏畫布，一秒六十次會把記憶體灌爆。
       現在那幾張都固定重複使用（vidScratchRef），而且工作尺寸夾到了螢幕上
       真正的大小（見上面的 onScreenPx）—— 一格的成本已經跟「不套形狀」同一個
       量級，限速反而變成唯一讓它看起來卡的原因（實測 12fps）。
       跟不上的時候該降的是「整張畫面一秒畫幾格」，那件事由影片那支迴圈的
       自適應保險絲統一負責，不該由單一顆物件自己偷偷少畫。 */

    /* 影片固定用同一組離屏畫布（每顆物件一組）：
         geo  —— 套完構圖（裁切／角度／翻轉）的那一格
         base —— 再套完濾鏡／調節的那張
         cv／off —— 只有套了形狀才會用到的那兩張（見下面）
       尺寸一樣就連 width 都不重設，等於整段完全不配置記憶體。 */
    let scratch: VidScratch | null = null;
    if (isVid || o.id?.startsWith('region-fx-')) {
      scratch = vidScratchRef.current.get(o.id) || null;
      if (!scratch) {
        scratch = {
          geo: document.createElement('canvas'),
          base: document.createElement('canvas'),
          cv: document.createElement('canvas'),
          off: document.createElement('canvas'),
        };
        vidScratchRef.current.set(o.id, scratch);
      }
    }

    let srcEl: CanvasImageSource = videoFrame(o.img, vidCap);
    let w0 = (srcEl as any).naturalWidth || (srcEl as any).width || o.img.videoWidth;
    let h0 = (srcEl as any).naturalHeight || (srcEl as any).height || o.img.videoHeight;
    /* ── 影片的構圖（裁切／角度／翻轉／縮放）───────────────────────────
       照片是把裁切的結果烤成一張新圖；影片不行 —— 內容每一格都不一樣。
       所以影片改成「把 geo 留在物件上，每一格畫的時候才套」。
       整段就是一次 setTransform ＋ 一次 drawImage（見 utils/compose 的 geoAffine），
       畫布固定重複使用，所以一秒幾十次也不會多配置一個位元組。 */
    if (isVid && scratch && o.geo && !isGeoIdentity(o.geo)) {
      const gc = geoFrameCanvas(srcEl, w0, h0, o.geo, cap, scratch.geo);
      srcEl = gc; w0 = gc.width; h0 = gc.height;
    }
    /* 只有構圖、沒有效果也沒有形狀：套完構圖那一張就是成品了，
       不必再多跑一次 applyPhotoFx（那等於整張再複製一次）。 */
    if (srcEl !== o.img && !hasShape && (!o.fx || !hasPhotoFx(o.fx))) {
      objFxCache.current.set(o.id, { key, cv: srcEl as HTMLCanvasElement });
      return srcEl;
    }
    // 上限 1600：物件在畫面上不會比這更大，再高只是白燒記憶體
    const k = Math.min(1, cap / Math.max(w0, h0));
    const iw = Math.max(1, Math.round(w0 * k)), ih = Math.max(1, Math.round(h0 * k));
    const selectedBase=regionPhoto&&isMain&&o.id?.startsWith(`region-fx-${selectedRegionPhotoRef.current??0}@`);
    const main=canvasRef.current;
    if(selectedBase&&regionBlendTool.current&&!supportsSceneColour(o.fx)&&!supportsResidentPhotoEffects(o.fx)&&!warm&&main&&main.width*main.height<=4_000_000&&!animRef.current&&!isVid&&!objectsRef.current.some(v=>isVideoEl(v.img)||isBackdropMask(v.kind))) {
      const renderer=renderToCanvasRef.current,scale=previewScaleRef.current;
      const stamp=regionSceneStamp.current;
      if(stamp?.key!==regionSceneKey.current||stamp.scale!==scale||stamp.sceneW!==main.width||stamp.sceneH!==main.height)regionBlend.current!.clear();
      regionSceneStamp.current={key:regionSceneKey.current,renderer,scale,source:srcEl,w:iw,h:ih,sceneW:main.width,sceneH:main.height};
      regionBlend.current!.prepare(srcEl,iw,ih,o.fx||{},regionBlendTool.current,(photo,fx)=>{
        const previous=photoRegionRef.current,index=selectedRegionPhotoRef.current??0;
        const capture=document.createElement('canvas');
        if(!previous)return photo;
        try {
          regionWarmStage.current={index,canvas:photo};
          photoRegionRef.current={...previous,photos:previous.photos.map((p,i)=>i===index?{...p,fx}:p)};
          renderer(capture,scale,true);
          return capture;
        }finally{photoRegionRef.current=previous;regionWarmStage.current=null;}
      });
    }
    if (hit && hit.key === key) return hit.cv;
    /* cacheSource：o.img 是載進來就不再變的一張 <img>，同一個尺寸的來源像素
       讀一次就夠。拖滑桿時每一格省掉一次 drawImage ＋ 一次 getImageData。
       影片剛好相反 —— 它每一格都不一樣，留著只會畫出上一格。

       out：影片是一秒幾十次地重算，每次開一張新畫布的話，手機的畫布記憶體
       幾秒就被系統收走（＝閃退）。把上一次那張交回去重用，尺寸一樣就
       連 width 都不重設，等於整段完全不配置記憶體。
       沒套形狀的時候回傳的就是 base 本人 —— 那時候快取裡那張跟 scratch.base
       是同一張，交回去重用完全正確。 */
    let reuse = scratch ? scratch.base : undefined;
    if(regionPhoto){
      reuse=regionFxSurfaces.current.get(o.id);
      if(!reuse){reuse=document.createElement('canvas');regionFxSurfaces.current.set(o.id,reuse);}
    }
    const base = applyPhotoFx(srcEl, iw, ih, o.fx || {}, {
      cacheSource: !isVid, fast: live, out: reuse, gpuSurface: regionPhoto,
    });
    const finish = () => {
      if (!isMain) return;
      lv!.key = baseKey;
      lv!.at = performance.now();
      if (live) {
        // 手一停就補一張完整尺寸的
        if (fxSettleRef.current) window.clearTimeout(fxSettleRef.current);
        fxSettleRef.current = window.setTimeout(() => {
          const cur = fxLiveRef.current.get(o.id);
          if (cur) cur.liveUntil = 0;
          objFxCache.current.delete(o.id);
          setFxTick(t => t + 1);
        }, 240);
      }
    };
    if (!hasShape) {
      let result=base;
      if(regionPhoto&&isMain&&reuse&&base!==reuse&&!regionSliderHeld.current&&!regionTouches.current.size&&(!regionPhotoEditingRef.current||prepareNative)){
        // Geometry-only rendering needs immutable photo pixels, not an entire
        // native-size shader pool. Release the pool immediately after copying,
        // including when the user never pauses long enough for an idle job.
        const snapshot=hit?.cv instanceof HTMLCanvasElement&&hit.cv.dataset.regionImmutable==='1'?hit.cv:document.createElement('canvas');
        if(snapshot.width!==base.width)snapshot.width=base.width;
        if(snapshot.height!==base.height)snapshot.height=base.height;
        snapshot.getContext('2d')!.clearRect(0,0,snapshot.width,snapshot.height);
        snapsho…127668 tokens truncated…);
                }} 
                className={`flex-1 py-3 text-[11px] font-bold border-b-2 transition-[color] duration-150 ${
                  activeTab === id ? 'text-white border-white' : 'text-[#555] border-transparent'
                }`}
              >
                {id === 'setting' ? <Crop size={16} className="mx-auto" /> : id === 'add' ? <Plus size={16} className="mx-auto" /> : id === 'objedit' ? <SlidersHorizontal size={16} className="mx-auto" /> : id === 'motion' ? <Film size={16} className="mx-auto" /> : <Star size={16} className="mx-auto" />}
              </button>
            ))}
          </div>
        )}
        
        {/* 圖案頁使用左側分類＋獨立捲動內容，不額外加入浮動按鈕的 pb-20。 */}
        {/* 圖片編輯那一頁是「滑桿 5rem ＋ 工具列 6rem ＋ 分類列 h-16」的三段式，
            自己就把整個高度切好了。再包一層 p-5 會整個縮一圈、上面那根滑桿
            還會被擠出可視範圍 —— 所以這一頁完全不加內距，跟經典拼圖一樣。 */}
        {/* overscrollBehavior 用 none 而不是 contain：contain 只擋住「把捲動傳給外層」，
            自己還是會橡皮筋 —— 已經到頂了再往上拉，畫面不該有任何位移。
            動畫頁底部另外留 pb-12，最後一根滑桿才不會貼在最下緣。 */}
        <div ref={scrollContainerRef} style={{ overscrollBehavior: 'none' }} className={`relative flex-1 min-h-0 ${objEditText ? 'overflow-hidden px-5 py-0' : photoLayoutOpen || objEditImage ? 'overflow-hidden' : `${activeTab === 'shape' && !colorPickerTarget ? 'px-5 py-0' : 'p-5'} ${activeTab === 'motion' && !colorPickerTarget ? 'pb-12' : (activeTab === 'shape' && !colorPickerTarget ? '' : colorPickerTarget || activeTab === 'objedit' ? 'pb-5' : 'pb-20')} custom-scrollbar ${
          (activeTab === 'setting' && !colorPickerTarget) ||
          (activeTab === 'add' && !colorPickerTarget) ||
          (activeTab === 'objedit' && !colorPickerTarget) ||
          (activeTab === 'motion' && !colorPickerTarget)
            ? 'overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]' 
            : 'overflow-hidden'
        }`}`}>
          {photoLayoutOpen&&photoRegion&&<div role="dialog" aria-label="所有圖片佈局" data-photo-layout-options className="absolute inset-0 z-[61] bg-[#0A0A0A] flex flex-col animate-in fade-in duration-200">
            <div className="h-10 shrink-0 flex items-center gap-2 px-5">
              <button aria-label="返回圖片排版" onClick={()=>changePhotoLayoutOpen(false)} className="w-9 h-9 -ml-2 flex items-center justify-center text-white/60 active:scale-90"><Icon name="arrow_back" className="text-[20px]"/></button>
              <span className="text-[10px] font-bold text-[#888] tracking-widest">圖片排版</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-none px-5 pb-5"><div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
              {PHOTO_LAYOUT_COUNTS.flatMap(count=>photoTemplates(count).map((t,i)=>{const selected=photoRegion.photos.length===count&&photoRegion.templateIndex===i;return <button key={`${count}-${i}`} aria-label={`${count}張 ${t.name}`} aria-pressed={selected} title={`${count}張: ${t.name}`} data-layout-count={count} data-layout-index={i} onClick={()=>applyPhotoTemplate(count,i)} className={`p-1.5 rounded-xl border flex items-center justify-center transition-colors aspect-square ${selected?'bg-white/[0.07] border-white/60 text-white':'bg-white/[0.02] border-white/5 text-white/60 hover:border-white/15 hover:bg-white/[0.04]'} active:bg-white/10`}>{layoutThumbnail(t.rects,false,true)}</button>;}))}
            </div></div>
          </div>}
          {colorPickerTarget ? (
            <ColorPickerEmbedded 
              color={colorPickerTarget === 'mask' ? maskColor
                : colorPickerTarget === 'holeGlow' ? holeGlowColor
                : colorPickerTarget === 'linkColor' ? (linkColor || maskColor)
                : colorPickerTarget === 'shapeObj'
                  ? ((objects.find(o => o.id === selectedObj)?.color) || SHAPE_DEFAULT_COLOR)
                : colorPickerTarget === 'shapeInner'
                  ? ((objects.find(o => o.id === selectedObj)?.innerColor) || '#FFFFFF')
                : colorPickerTarget === 'shapeDot'
                  ? ((objects.find(o => o.id === selectedObj)?.dotColor) || '#FFFFFF')
                : colorPickerTarget === 'shapeStripeA'
                  ? ((objects.find(o => o.id === selectedObj)?.stripeA)
                    || (objects.find(o => o.id === selectedObj)?.color) || SHAPE_DEFAULT_COLOR)
                : colorPickerTarget === 'shapeStripeB'
                  ? ((objects.find(o => o.id === selectedObj)?.stripeB) || '#FFFFFF')
                : colorPickerTarget === 'shapeStroke'
                  ? ((objects.find(o => o.id === selectedObj)?.strokeColor) || '#000000')
                : colorPickerTarget === 'shapeGlow'
                  ? ((objects.find(o => o.id === selectedObj)?.glowColor)
                    || (objects.find(o => o.id === selectedObj)?.color) || SHAPE_DEFAULT_COLOR)
                : colorPickerTarget === 'textStroke'
                  ? ((objects.find(o => o.id === selectedObj)?.strokeColor) || '#000000')
                : colorPickerTarget === 'textGlow'
                  ? ((objects.find(o => o.id === selectedObj)?.glowColor) || '#FFFFFF')
                : colorPickerTarget === 'stripeA' ? stripeA
                : colorPickerTarget === 'stripeB' ? stripeB
                : dotColor} 
              onChange={c => { if(colorPickerTarget==='mask') {
                  setMaskColor(c);
                  /* 圖案的光就是遮罩的光暈 —— 換遮罩顏色時發光一起換成同一個色。
                     反過來不成立：單獨挑發光顏色時，遮罩的顏色不會被動到。 */
                  setHoleGlowColor(c);
                }
                else if(colorPickerTarget==='holeGlow') setHoleGlowColor(c);
                else if(colorPickerTarget==='shapeInner')
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, innerColor:c } : o));
                else if(colorPickerTarget==='linkColor') setLinkColor(c);
                else if(colorPickerTarget==='shapeObj')
                  // 換圖形顏色時發光也跟著同色（單獨挑發光顏色則不會反向影響）
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, color: c, glowColor: c } : o));
                else if(colorPickerTarget==='shapeDot')
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, dotColor: c } : o));
                else if(colorPickerTarget==='shapeStripeA')
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, stripeA: c } : o));
                else if(colorPickerTarget==='shapeStripeB')
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, stripeB: c } : o));
                else if(colorPickerTarget==='shapeStroke')
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, strokeColor: c } : o));
                else if(colorPickerTarget==='shapeGlow')
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, glowColor: c } : o));
                else if(colorPickerTarget==='textStroke')
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, strokeColor: c } : o));
                else if(colorPickerTarget==='textGlow')
                  setObjects(prev => prev.map(o => o.id === selectedObj ? { ...o, glowColor: c } : o));
                else if(colorPickerTarget==='stripeA') setStripeA(c);
                else if(colorPickerTarget==='stripeB') setStripeB(c);
                else setDotColor(c); }}
              /* 紋理與條紋的顏色一律用遮罩那一組色票 —— 全 App 一致 */
              swatches={colorPickerTarget === 'holeGlow' || colorPickerTarget === 'linkColor'
                || colorPickerTarget === 'shapeGlow' ? DEFAULT_COLORS
                : colorPickerTarget === 'mask' ? MASK_SWATCHES
                : colorPickerTarget === 'textStroke' || colorPickerTarget === 'shapeStroke' ? STROKE_COLORS : DEFAULT_COLORS}
              onClose={() => setColorPickerTarget(null)}
              title={colorPickerTarget === 'mask' ? '遮罩顏色'
                : colorPickerTarget === 'holeGlow' ? '發光顏色'
                : colorPickerTarget === 'linkColor' ? '連線顏色'
                : colorPickerTarget === 'shapeObj' ? '圖形顏色'
                : colorPickerTarget === 'shapeInner' ? '圖案顏色'
                : colorPickerTarget === 'shapeDot' ? '點點顏色'
                : colorPickerTarget === 'shapeStripeA' ? '條紋顏色一'
                : colorPickerTarget === 'shapeStripeB' ? '條紋顏色二'
                : colorPickerTarget === 'shapeStroke' ? '描邊顏色'
                : colorPickerTarget === 'shapeGlow' ? '發光顏色'
                : colorPickerTarget === 'textStroke' ? '描邊顏色'
                : colorPickerTarget === 'textGlow' ? '發光顏色'
                : colorPickerTarget === 'stripeA' ? '條紋顏色一'
                : colorPickerTarget === 'stripeB' ? '條紋顏色二' : '紋理顏色'}
            />
          ) : (
            <>
              {activeTab === 'setting' && <div className="max-w-md mx-auto space-y-4 pb-4 animate-in fade-in duration-300">


                <div className="grid grid-cols-2 gap-3 items-start">
                  <div className="flex flex-col min-w-0">
                    <div className="text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
                      <span>排版</span>
                    </div>
                    <div className="h-9 flex items-center justify-between gap-1.5 bg-[#111] border border-[#222] px-1.5 rounded-[6px] w-full">
                      {[FULL, 'mask-bottom', 'mask-top', 'mask-left', 'mask-right', AROUND].map(t => (
                        <button key={t} onClick={() => {
                          if(t===FULL){
                            if(layout!==FULL||canvasRatioBeforeFull===null)setCanvasRatioBeforeFull(canvasRatio);
                            setCanvasRatio('3:4');
                          }
                          if (t === layout) return;
                          const leavingFull = layout === FULL && t !== FULL;
                          const restoredRatio = canvasRatioBeforeFull || canvasRatio;
                          const desiredCount=creativePatternCountForLayout(holeCount,layout,t);
                          setHoleCount(desiredCount);
                          if (leavingFull) {
                            setCanvasRatio(restoredRatio);
                            setCanvasRatioBeforeFull(null);
                          }
                          // 排版、比例、圖案在同一批更新裡一起換，中間不會露出半舊半新的那一格
                          setLayout(t);
                          if (t === AROUND) setMaskScale(AROUND_SCALE);
                          /* 從四周包圍切回四邊那幾種時，比例要回到預設的 1/2 ——
                             包圍用的是自己那套刻度，數值直接留著的話會變成
                             1/1.7 這種莫名其妙的值（四邊之間互相切換則不動，
                             那是使用者自己調過的比例，不該被蓋掉）。 */
                          else if (layout === AROUND) setMaskScale(DEFAULT_MASK_SCALE);
                          /* 包圍排版的圖案本來就會再乘一個固定倍率縮小，
                             同一個「大小」值看起來會比別的排版小一點點，
                             所以進來時把大小補 +10、離開時原封退回去 ——
                             來回切換不會愈疊愈大。 */
                          if (t === AROUND && layout !== AROUND) setHoleSize(v => Math.min(100, v + 10));
                          else if (t !== AROUND && layout === AROUND) setHoleSize(v => Math.max(0, v - 10));
                          setSelectedTarget(null);
                          // Count changes regenerate once via the existing effect;
                          // unchanged counts (including the cap) regenerate here.
                          if (holeCount === desiredCount) {
                            generateRandomHoles(true, t, 'none', desiredCount,t===FULL?'3:4':leavingFull?restoredRatio:undefined);
                          }
                        }} className="focus:outline-none" aria-label={t === FULL ? '滿版' : `遮罩排版 ${t}`} title={t === FULL ? '滿版' : undefined}>
                          <LayoutIcon type={t} active={layout === t} />
                        </button>
                      ))}
                    </div>
                  </div>

                  {photoRegion?.multi ? photoLayoutControls : ratioControls}
                </div>

                  {/* 原本的比例滑桿實際控制遮罩佔圖片多少，現在改名為「佔比」。
                      並排的四種：滑桿 0 = 1/1（遮罩跟原圖一樣大）、100 = 1/5
                      （最細的一條），分母 = 1 + 值×0.04，所以 50 就是 1/3。
                      四周包圍：1/N 是「單邊邊框寬度佔圖片的比例」，滑到最後
                      （比別人長的那一段尾巴）就是邊框 0 —— 圖片剛好滿版。 */}
                  <div className={photoRegion?.multi ? 'grid grid-cols-2 gap-3' : ''}>
                  {photoRegion?.multi && ratioControls}
                  {(() => {
                    const around = layout === AROUND;
                    const b = around ? aroundB(maskScale) : 0;
                    const num = (v: number) => v.toFixed(1).replace(/\.0$/, '');
                    const label = around
                      ? (b < 0.004 ? '滿版' : `1/${num(1 / b)}`)
                      : `1/${num(1 / maskScale)}`;
                    const max = around ? AROUND_STEPS : 100;
                    const value = around
                      ? Math.round(Math.max(0, Math.min(max, (1 - b) * AROUND_STEPS)))
                      : Math.round(Math.max(0, Math.min(100, (1 / maskScale - 1) * 25)));
                    const apply = (v: number) => {
                      liveMaskScale.current=around?aroundK((AROUND_STEPS-v)/AROUND_STEPS):1/(1+v*.04);
                      const output=document.querySelector('[data-creative-occupancy-value]');
                      if(output){const border=aroundB(liveMaskScale.current);output.textContent=around?(border<.004?'滿版':`1/${num(1/border)}`):`1/${num(1/liveMaskScale.current)}`;}
                      if(occupancyFrame.current)return;
                      occupancyFrame.current=requestAnimationFrame(()=>{
                        occupancyFrame.current=0;
                        const frame=motionFrameRef.current,canvas=canvasRef.current,stage=stageRef.current;
                        if(!frame||!canvas||!stage||!imageState||liveMaskScale.current===null)return;
                        const cs=collageSizeOf(layout,imageState.baseW,imageState.baseH,liveMaskScale.current,canvasRatio),b=stage.getBoundingClientRect();
                        const fit=creativePreviewFit(b.width,b.height,cs.w,cs.h),scale=fitScale(cs.w*fit,cs.w,1);
                        viewTRef.current={k:1,tx:0,ty:0};
                        if(frame.parentElement){frame.parentElement.style.transition='none';frame.parentElement.style.transform='translate(0px,0px)';}
                        frame.style.transition='none';frame.style.width=`${cs.w*fit}px`;frame.style.height=`${cs.h*fit}px`;
                        baseCssWRef.current=cs.w*fit;previewScaleRef.current=scale;lastPatternPaintRef.current=null;
                        renderToCanvasRef.current(canvas,scale);
                      });
                    };
                    const commit=()=>{cancelAnimationFrame(occupancyFrame.current);occupancyFrame.current=0;const next=liveMaskScale.current;liveMaskScale.current=null;if(next!==null)setMaskScale(next);};
                    return (
                      <div data-creative-occupancy className={`flex flex-col w-full ${layout === FULL ? 'opacity-35 pointer-events-none' : ''}`}>
                        <div className="flex items-baseline justify-between text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
                          <span>佔比</span>
                          <span data-creative-occupancy-value className="text-white font-sans tabular-nums tracking-normal normal-case">{label}</span>
                        </div>
                        {/* 滑桿就是滑桿：不套外框、不墊底色方塊，只留一條軌道 */}
                        <div className="h-9 flex items-center px-1 w-full">
                          {/* 比例是最重的一根滑桿（每動一格整張拼圖要重畫），
                              所以也走「一格畫面最多送一次」（見 useRafOnChange）。 */}
                          <RegionLiveRange
                            min={0} max={max} step={1}
                            value={value}
                            onChange={apply}
                            onCommit={commit}
                            label="佔比"
                          />
                        </div>
                      </div>
                    );
                  })()}
                  </div>
                  {photoRegion && photoRegion.photos.length>1 && seamlessPhotoBase(photoRegion) && <div className="space-y-3" data-creative-seamless>
                    <span className="text-[10px] font-bold text-[#888]">無縫拼圖</span>
                    <div>
                      <RegionLiveRange value={creativeSeamlessSliderValue(photoRegion)} onChange={v=>commitRegion(withCreativeSeamlessAmount(photoRegionRef.current!,v),true)} onCommit={finishRegionEdit}/>
                    </div>
                  </div>}
                {/* 遮罩的三項（自訂遮罩、顏色、紋理）接在排版與比例下面 ——
                    它們講的都是「這張版面長什麼樣」，本來就該在同一頁。
                    -mt-1 是為了讓它跟上面那排的間距，跟這三項彼此之間一樣。 */}
                <div className="grid grid-cols-2 gap-3 !mt-3">

                <div className="min-w-0 h-[47px] flex items-center justify-between gap-2 bg-[#111] px-2.5 border border-[#222] rounded-[6px]">
                  <span className="text-[10px] font-bold text-[#888]">更換圖片</span>
                  <button onClick={(e) => {
                      e.stopPropagation();
                      replaceFileInputRef.current?.click();
                    }} className="px-2 h-6 text-[9px] bg-white text-black font-bold rounded-[4px] hover:bg-gray-200 transition-colors tracking-wider whitespace-nowrap">上傳</button>
                </div>

                <div className={`min-w-0 h-[47px] flex items-center justify-between gap-1.5 bg-[#111] px-2.5 border border-[#222] rounded-[6px] ${layout === FULL ? 'opacity-35 pointer-events-none' : ''}`}>
                  <span className="text-[10px] font-bold text-[#888] shrink-0">自訂遮罩</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); maskFileInputRef.current?.click(); }} className="px-2 h-6 text-[9px] bg-white text-black font-bold rounded-[4px] hover:bg-gray-200 transition-colors tracking-wider whitespace-nowrap">
                        上傳
                      </button>
                    </div>
                    {maskImageState ? <button className="w-7 h-6 shrink-0 rounded-[4px] border border-white/10 flex items-center justify-center" aria-label="還原素色" onClick={() => setMaskImageState(null)}><ReplayIcon size={12} /></button>
                      : <button className="w-7 h-6 shrink-0 rounded-[4px] shadow-inner border border-white/10 hover:ring-1 hover:ring-white/30 transition-shadow"
                      aria-label="遮罩顏色" onClick={() => setColorPickerTarget('mask')} style={{ backgroundColor: maskColor }} />}
                  </div>
                </div>
                {/* 紋理整組收在同一格：選項、顏色、兩根滑桿全部在同一個框裡
                    （跟經典拼圖那一頁排法一致）。 */}
                <div data-creative-texture hidden={!!maskImageState || layout === FULL} className="bg-[#111] border border-[#222] rounded-[6px] overflow-hidden col-span-2 order-3 w-full">
                  <div className="h-[47px] flex items-center justify-between px-3">
                    <span className="text-[10px] font-bold text-[#888]">紋理</span>
                    <div className="flex items-center gap-2">
                      <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                        {TEX_OPTIONS.map(([t, label]) => (
                          <button key={t} onClick={() => setPatternType(t as any)} className={`px-2 h-6 text-[10px] font-bold rounded-[2px] transition-all ${patternType === t ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'}`}>{label}</button>
                        ))}
                      </div>
                      {/* 顏色格常駐：關閉時也看得到，切換時這一列的寬度不變、不會閃。
                          條紋有兩個顏色，所以放兩塊小的；其他三種是一塊大的。 */}
                      {patternType === 'stripe' ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setColorPickerTarget('stripeA')}
                            title="條紋顏色一"
                            className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                            style={{ backgroundColor: stripeA }}
                          />
                          <button
                            onClick={() => setColorPickerTarget('stripeB')}
                            title="條紋顏色二"
                            className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                            style={{ backgroundColor: stripeB }}
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => setColorPickerTarget('dot')}
                          title="紋理顏色"
                          className="w-8 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                          style={{ backgroundColor: dotColor }}
                        />
                      )}
                    </div>
                  </div>
                  {patternType === 'stripe' ? (
                    /* 條紋沒有間距（一條接著一條），只有條數；右邊那一格是方向 */
                    <div className="grid grid-cols-2 gap-x-7 gap-y-4 px-3 pt-2 pb-3 border-t border-[#1c1c1c] items-end">
                      {/* 左右各留 8px：滑桿為了好按，本人比外框寬 14px（見 styles.css
                          的 .slider-wrap），不留這一點的話畫出來的線會比自己那一欄長，
                          右邊還會伸進「方向」那一欄的間隙裡。 */}
                      <div className="px-2">
                        <CompactSlider wide label="數量" value={stripeN} min={0} max={STRIPE_N_MAX} step={1} onChange={setStripeN} />
                      </div>
                      <div className="flex flex-col">
                        <div className="text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">方向</div>
                        <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                          {STRIPE_DIRS.map(([d, label]) => (
                            <button key={d} onClick={() => setStripeDir(d)}
                              className={`flex-1 h-6 text-[10px] font-bold rounded-[2px] transition-all ${stripeDir === d ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : patternType !== 'none' && (
                    <div className="grid grid-cols-2 gap-x-7 gap-y-4 px-3 pt-2 pb-3 border-t border-[#1c1c1c]">
                      <CompactSlider wide label="大小" value={maskTextureSizeToUi(dotSize)} min={0} max={100} step={1} onChange={(v:number)=>setDotSize(maskTextureSizeFromUi(v))} />
                      <CompactSlider wide label="間距" value={maskTextureGapToUi(dotGap)} min={0} max={100} step={1} onChange={(v:number)=>setDotGap(maskTextureGapFromUi(v))} />
                      <div className="col-span-2" data-mask-texture-squash>
                        <CompactSlider wide label="壓扁" value={maskTextureSquashToUi(dotSquash)} min={0} max={100} onChange={(v:number)=>setDotSquash(maskTextureSquashFromUi(v))} />
                      </div>
                    </div>
                  )}
                </div>
                </div>
              </div>}
              {activeTab === 'add' && (() => {
                const sel = objects.find(o => o.id === selectedObj) || null;
                const patch = (d: any) => setObjects(prev => prev.map(o => o.id === sel.id ? { ...o, ...d } : o));
                const addText = () => {
                  const offs2 = getLayoutOffsets();
                  if (!offs2) return;
                  /* 預設字身在開場已暖好；先同步認領再建立物件，第一幀就使用
                     最終字體與最終度量，不會生成後才像換字體一樣跳一下。 */
                  ensureFont(DEFAULT_FONT);
                  const id = Math.random().toString(36).slice(2, 9);
                  const size = Math.round(Math.min(offs2.cw, offs2.ch) * 0.09);
                  const w = size * 4, h = size * 1.3;
                  setObjects(prev => [...prev, {
                    id, type: 'text', text: TEXT_PLACEHOLDER, color: '#ffffff', size,
                    fontFamily: DEFAULT_FONT, bold: false, italic: false,
                    letterSpacing: 0, strokeWidth: 0, strokeColor: '#000000',
                    glow: 0, glowColor: '#ffffff',
                    x: offs2.cw / 2 - w / 2, y: offs2.ch / 2 - h / 2, w, h, rot: 0,
                  }]);
                  setSelectedObj(id);
                  setSelectedTarget(null);
                  setColorPickerTarget(null); setActiveTab('objedit');   // 新增完直接進編輯頁，跟經典拼圖一樣
                };
                /**
                 * 新增一顆符號。
                 *
                 * 符號就是文字物件，所以拖曳、縮放旋轉、圖層順序、選中之後再點
                 * 一次直接改字，全部跟文字共用同一套；差別只在 sym 有值，編輯頁
                 * 會換成符號那一組（顏色、大小、發光）。
                 * 字級照長度回推：符號長短差很多（最長的接近一百個字），字級寫死
                 * 的話長的會直接戳出畫面 —— 用「大約佔畫面七成寬」回推，挑哪一顆
                 * 加進來的份量都差不多。
                 * 刻意不跳去編輯頁、也不進入打字狀態，可以連著加好幾顆。
                 */
                const prepareAddSymbol = (txt: string) => {
                  const offs2 = getLayoutOffsets();
                  if (!offs2) return null;
                  return {
                    offs: offs2,
                    geometry: prepareCreativeSymbolPlacement(txt, offs2.cw, offs2.ch),
                  };
                };
                const addSymbol = (txt: string) => {
                  const prepared = prepareAddSymbol(txt);
                  if (!prepared) return;
                  const { offs: offs2, geometry } = prepared;
                  const { size, w, h } = geometry;
                  const id = Math.random().toString(36).slice(2, 9);
                  /* 字體在模組載入時預熱；這裡不再等待 Promise、清空所有符號快取，
                     或重掃清單。選中的物件會在同一次 click 立刻加入。 */
                  setObjects(prev => [...prev, {
                    id, type: 'text', text: txt, sym: txt, color: '#ffffff', size,
                    fontFamily: SYMBOL_FONT, bold: false, italic: false,
                    letterSpacing: 0, strokeWidth: 0, strokeColor: '#000000',
                    glow: 0, glowColor: '#ffffff',
                    /* 新增符號即使用符號專屬預設：泡泡進場、縮放 II 常駐。 */
                    mo: {
                      ...MO_DEFAULT,
                      in: 'bubble',
                      dur: durFromSpeed(80),
                      idle: 'symbol-breathe2',
                      amp: 60,
                      speed: 1.2,
                    },
                    x: offs2.cw / 2 - w / 2, y: offs2.ch / 2 - h / 2, w, h, rot: 0,
                  }]);
                  setSelectedObj(id);
                  setSelectedTarget(null);
                };
                /**
                 * 新增一個圖形。大小、粗細、顏色都用經典拼圖那邊同一組預設值，
                 * 所以兩個工具加出來的圖形長得一模一樣。
                 * 刻意留在這一頁、不跳去編輯頁 —— 常常是要連著加好幾個。
                 */
                const addShape = (it: any) => {
                  const offs2 = getLayoutOffsets();
                  if (!offs2) return;
                  const short = Math.min(offs2.cw, offs2.ch);
                  const w = Math.max(8, Math.round(short * SHAPE_DEFAULT_RATIO(it.kind)));
                  const h = it.ratio ? Math.max(4, Math.round(w * it.ratio)) : w;
                  const id = Math.random().toString(36).slice(2, 9);
                  const initialColor = shapeDefaultColorFor(it.kind);
                  setObjects(prev => [...prev, {
                    id, type: 'shape',
                    kind: it.kind, hole: it.hole, filled: it.filled, shapeItemId: it.id,
                    /* 框線的粗細以「新增時的長邊」為準，之後拉大拉小都不變 */
                    lineBase: (it.kind === 'wave' || it.kind === 'lightning-wave')
          ? Math.max(8, Math.round(short * 0.24)) : Math.max(w, h),
                    textureBaseW: w, textureBaseH: h,
                    lineW: SHAPE_DEFAULT_LINEW(it.kind), dash: 0,
                    color: initialColor,
                    glow: 0, glowColor: initialColor,
                    ...(DUAL_COLOR_SHAPE_KINDS.has(it.kind) ? { innerColor: '#FFFFFF' } : {}),
                    x: offs2.cw / 2 - w / 2, y: offs2.ch / 2 - h / 2,
                    w, h, rot: it.rot || 0,
                    ...(SPECIAL_LINE_KINDS.has(it.kind) ? { mo: { ...MO_DEFAULT, in: 'draw', dur: durFromSpeed(15), amp: 20 } } : {}),
                  }]);
                  setSelectedObj(id);
                  setSelectedTarget(null);
                };
                return (
                  <div className="max-w-md mx-auto space-y-4 animate-in fade-in duration-300">
                    {/* 按鈕與圖標尺寸跟經典拼圖的加號頁完全一致；
                        只差沒有「新增佈局」——創意拼圖的版面是排版＋遮罩決定的。 */}
                    {addSub === 'symbol' ? (
                      <SymbolPicker
                        onBack={() => setAddSub('root')}
                        onPrepare={(symbol) => { prepareAddSymbol(symbol); }}
                        selected={addPaletteChoice?.type === 'symbol' ? addPaletteChoice.symbol : null}
                        onPick={(symbol) => {
                          const choice = { type: 'symbol', symbol };
                          setAddPaletteChoice(choice);
                          if (brushMode === 'pen' && objectBrushChoice) setObjectBrushChoice(choice);
                          addSymbol(symbol);
                        }}
                      />
                    ) : addSub === 'root' ? (
                    /* key 是必要的：兩個分頁的最外層都是 <div>，沒有 key 的話
                       React 會當成同一顆、只換 className —— 清單那邊的 <button>
                       就被留下來直接變成這一頁的按鈕，而按鈕掛著 transition-all，
                       於是從「返回鍵那個大小」一路補間過來，看起來就是抖一下。 */
                    /* 分兩排：上排是「從相簿拿東西進來」（圖片／影片），
                       下排是「這個 App 自己生的東西」（文字／符號／圖形）。
                       五顆擠成一排會讓每一顆只剩七十幾像素，而且兩種性質的
                       東西混在一起也不好找。字都加 whitespace-nowrap，
                       格子再窄也不會被拆成兩行、變得比隔壁高一截。 */
                    <div key="add-root" className="flex flex-col gap-2 mt-5">
                    {/* 「匯入影片」拿掉之後剩四顆，就排成一排 ——
                        本來拆兩排是因為有五顆。 */}
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => objFileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center py-4 px-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                      >
                        <Icon name="add_photo_alternate" className="text-[24px] text-white/80" />
                        <span className="text-[11px] font-bold tracking-widest text-white/90 whitespace-nowrap">匯入圖片</span>
                      </button>
                      <button
                        onClick={addText}
                        className="flex flex-col items-center justify-center py-4 px-1 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                      >
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
                      /* 點進「新增圖形」才看得到的圖案清單，跟經典拼圖同一份：
                         三排（實心／邊框／線條），點一下就加到版面正中間。
                         （key 的理由見上面那一頁） */
                      <div key="add-shape" className="pt-1">
                        <div className="flex items-center gap-2 mb-3">
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
                          const ins = (arr: any[], item: any) => {
                            // 放在倒數第二個
                            const n = arr.slice();
                            n.splice(Math.max(0, n.length - 1), 0, item);
                            return n;
                          };
                          /** 把第 n 顆搬到第 m 個位置（都是從 1 算起） */
                          /** 把 id 是這個的那一顆搬到第 m 個位置（從 1 算起）。
                              用 id 找而不是用位置找 —— 清單中間再插新圖形時，
                              這條規則才不會跟著位移到別顆身上。 */
                          const moveTo = (arr: any[], id: string, m: number) => {
                            const i = arr.findIndex(z => z.id === id);
                            if (i < 0) return arr;
                            const a = arr.slice();
                            const [x] = a.splice(i, 1);
                            a.splice(Math.max(0, m - 1), 0, x);
                            return a;
                          };
                          const compositeItems = ADD_SHAPE_ITEMS.filter(i2 => i2.filled
                            && COMPOSITE_SHAPE_KINDS.has(i2.kind) && i2.kind !== 'star-double');
                          const solidList = [
                            ...moveTo(
                              [...ins(ADD_SHAPE_ITEMS.filter(i2 => i2.filled
                                && (!COMPOSITE_SHAPE_KINDS.has(i2.kind) || i2.kind === 'star-double')), HOLE_ITEM_CROSS), ...HOLE_ITEMS_EXTRA],
                              'heart-f', 9),
                            ...compositeItems,
                          ];
                          /* 邊框那排的順序跟實心那排對齊：第 6 顆窄菱形、第 9 顆愛心、
                             第 11 顆十字星，後面才接新加的橢圓／各種比例的框／雲朵／對話框。 */
                          const lineList = moveTo(moveTo(moveTo(moveTo(
                            [...ADD_SHAPE_ITEMS.filter(i2 => !i2.filled && !SPECIAL_LINE_KINDS.has(i2.kind)), HOLE_ITEM_CROSS_O],
                            'diamond-n-o', 6), 'heart-o', 9), 'cloud-oval-o', 13), 'hole-cross-star-o', 14);
                          return ([
                            ['實心', solidList.filter(i2 => !GRID_SHAPE_KINDS.has(i2.kind))],
                            ['邊框', lineList.filter(i2 => !GRID_SHAPE_KINDS.has(i2.kind))],
                            ['線條', ADD_SHAPE_ITEMS.filter(i2 => SPECIAL_LINE_KINDS.has(i2.kind))],
                            ['網格', ADD_SHAPE_ITEMS.filter(i2 => GRID_SHAPE_KINDS.has(i2.kind))],
                            ['遮罩', MASK_SHAPE_ITEMS],
                          ] as const);
                        })().map(([label, list]) => (
                          <div key={label} className="mb-3">
                            <div className="text-[9px] font-bold text-[#666] mb-1.5 tracking-widest">{label}</div>
                            <div className="grid grid-cols-6 gap-2">
                              {list.map(it => (
                                <button
                                  key={it.id}
                                  onClick={() => {
                                    const choice = { type: 'shape', item: it };
                                    setAddPaletteChoice(choice);
                                    if (brushMode === 'pen' && objectBrushChoice) setObjectBrushChoice(choice);
                                    addShape(it);
                                  }}
                                  aria-label={'label' in it ? String(it.label) : it.id}
                                  title={'label' in it ? String(it.label) : it.id}
                                  aria-pressed={addPaletteChoice?.type === 'shape' && addPaletteChoice.item?.id === it.id}
                                  className={`h-11 rounded-[10px] bg-white/5 border ${addPaletteChoice?.type === 'shape' && addPaletteChoice.item?.id === it.id ? 'border-white' : 'border-white/10 hover:border-white/30'} hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center text-white/85`}
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
                );
              })()}
              {activeTab === 'objedit' && (() => {
                const editRegionIndex = selectedRegionPhoto ?? (baseSelected ? 0 : null);
                // Live editing owns the ref until the gesture/debounce commits.
                // A tab/effect-card render must not feed the previous React
                // snapshot back into ImageAdjustPanel and erase a newer FX.
                const regionPhoto = editRegionIndex !== null ? photoRegionRef.current?.photos[editRegionIndex] : null;
                const regionEditing = !!regionPhoto?.src;
                const sel = regionEditing ? {...regionPhoto,id:`region-photo-${editRegionIndex}`,type:'image',img:decodedRegionPhotos.current.get(regionPhoto.src)} : objects.find(o => o.id === selectedObj) || null;
                const patch = (d: any) => {
                  if (regionEditing && photoRegionRef.current) {
                    clearPhotoDimmer();
                    commitRegion({...photoRegionRef.current,photos:photoRegionRef.current.photos.map((p,i)=>i===editRegionIndex ? {...p,...d} : p)},!!d.fx);
                  } else setObjects(prev => prev.map(o => o.id === sel.id ? { ...o, ...d } : o));
                };
                const move = (dir: number) => setObjects(prev => {
                  const i = prev.findIndex(o => o.id === sel.id);
                  const j = i + dir;
                  if (i < 0 || j < 0 || j >= prev.length) return prev;
                  const n = prev.slice(); const [x] = n.splice(i, 1); n.splice(j, 0, x); return n;
                });
                if (!sel) return (
                  // 位置與字樣跟經典拼圖同一份
                  <div className="h-full flex items-center justify-center pb-6">
                    <p className="text-[11px] text-white/40 text-center">請先選中圖片或文字</p>
                  </div>
                );
                if (sel.type === 'shape') {
                  if(isBackdropMask(sel.kind))return <BackdropMaskControls kind={sel.kind} settings={sel} onChange={patch}/>;
                  const isLine = SPECIAL_LINE_KINDS.has(sel.kind || '');
                  const isGrid = GRID_SHAPE_KINDS.has(sel.kind);
                  const hasWidth = isLine || isGrid || !sel.filled;
                  const hasDash = !sel.filled && (!isLine || sel.kind === 'line') && sel.kind !== 'grid-plus';
                  const isDoubleContour = DOUBLE_CONTOUR_SHAPE_KINDS.has(sel.kind || '');
                  /* 圖形調整：欄位與經典拼圖那顆 ShapeEditorPanel 一致。
                     圖層上下不放這裡 —— 選中時畫面上那排工具列本來就有。 */
                  return (
                    <div className="max-w-md mx-auto h-full animate-in fade-in duration-300">
                      <div className="h-full overflow-y-auto overflow-x-hidden no-scrollbar px-2">
                        {/* 底下留一段（跟經典拼圖的圖形編輯一樣的 pb-14）——
                            捲到最底時最後那一格不會貼著邊，也比較好按。 */}
                        <div className="flex flex-col gap-3.5 pt-1 pb-14">
                          {/* 最上面就是圖形自己的顏色，色票直接攤開（不再放「顏色」標題） */}
                          {swatchStrip(sel.color || SHAPE_DEFAULT_COLOR, SOFT_COLORS, (c: string) => patch({ color: c, glowColor: c }), true)}
                          {(DUAL_COLOR_SHAPE_KINDS.has(sel.kind || '') || /^square-(star|heart)-cutout$/.test(sel.kind || '')) && (
                            <div className="flex items-center gap-3 px-2">
                              <div className="flex-1 min-w-0">{shapeSlider('圖案大小', sel.innerSize ?? 64, 10, 90,
                                (v: number) => patch({ innerSize: v }))}</div>
                              {DUAL_COLOR_SHAPE_KINDS.has(sel.kind || '') && <button
                                title="圖案顏色" className="w-8 h-6 rounded-[4px] shrink-0 border border-white/10"
                                style={{backgroundColor:sel.innerColor || '#FFFFFF'}}
                                onClick={()=>setColorPickerTarget('shapeInner')} />}
                            </div>
                          )}
                          {hasWidth && <div className={`grid ${hasDash ? 'grid-cols-2' : 'grid-cols-1'} gap-5 px-2`}>
                            {isGrid ? shapeSlider(GRID_DOT_KINDS.has(sel.kind) ? '大小' : '粗細', Math.round(((sel.lineW ?? 6) - 6) / 12 * 100), 0, 100,
                              (v: number) => patch({ lineW: 6 + v * .12 }))
                              : shapeSlider('粗細', Math.round((sel.lineW ?? 6) * 10), 1, 100, (v: number) => patch({ lineW: v / 10 }))}
                            {hasDash && shapeSlider('虛線', sel.dash || 0, 0, 100, (v: number) => patch({ dash: v }))}
                          </div>}
                          {/* 發光、描邊各自跟自己的顏色並排；顏色是兩段式的
                              （點一下才攤開色票），所以從 0 拉到 1 的瞬間
                              不會有欄位突然冒出來閃一下。 */}
                          <div className="flex items-center gap-3 px-2 order-1 w-full">
                            <div className="flex-1 min-w-0">
                              {shapeSlider('發光', Math.min(100, Math.round(glowAmount(sel.glow) * 200)), 0, 100,
                                (v: number) => patch(v > 0 && !sel.glowInit
                                  /* 第一次拉起來：發光顏色預設用這個圖形自己的顏色 */
                                  ? { glow: v / 2, glowColor: sel.color || SHAPE_DEFAULT_COLOR, glowInit: true }
                                  : { glow: v / 2 }))}
                            </div>
                            <ColorPick compact label="顏色" value={sel.glowColor || sel.color || SHAPE_DEFAULT_COLOR}
                              colors={GLOW_SWATCH_COLORS} onPick={(c: string) => patch({ glowColor: c })}
                              onOpen={() => setColorPickerTarget('shapeGlow')} />
                          </div>
                          {!isDoubleContour && !isGrid && <div className="flex items-center gap-3 px-2 order-2 w-full">
                            <div className="flex-1 min-w-0">
                              {shapeSlider('描邊', Math.round(Math.min(8, sel.strokeW ?? 0) * 12.5), 0, 100,
                                (v: number) => patch({ strokeW: v / 12.5 }))}
                            </div>
                            <ColorPick compact label="顏色" value={sel.strokeColor || '#000000'}
                              onPick={(c: string) => patch({ strokeColor: c })}
                              onOpen={() => setColorPickerTarget('shapeStroke')} />
                          </div>}
                          {isDoubleContour && (
                            <div className="px-2 order-2 w-full">
                              {shapeSlider('外框粗細', sel.outlineWidth ?? 0, 0, 100,
                                (v: number) => patch({ outlineWidth: v }))}
                            </div>
                          )}
                          {/* 紋理整組收在同一格：種類、顏色、滑桿全部在同一個框裡
                              （跟經典拼圖的「背景紋理」同一種排法）。顏色常駐。
                              點點是一個顏色＋大小／間距；條紋是兩個顏色＋粗細／方向。 */}
                          {!isLine && !GRID_SHAPE_KINDS.has(sel.kind) && (() => {
                            const tex = texOf(sel);
                            return (
                          <div className="bg-[#111] border border-[#222] rounded-[6px] overflow-hidden order-3">
                            <div className="h-[47px] flex items-center justify-between px-3">
                              <span className="text-[10px] font-bold text-[#888]">紋理</span>
                              <div className="flex items-center gap-2">
                                <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                                  {TEX_OPTIONS.map(([id, label]) => (
                                    <button
                                      key={id}
                                      onClick={() => patch({ tex: id, dots: id === 'dot' })}
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
                                      onClick={() => setColorPickerTarget('shapeStripeA')}
                                      title="條紋顏色一"
                                      className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                                      style={{ backgroundColor: sel.stripeA || sel.color || SHAPE_DEFAULT_COLOR }}
                                    />
                                    <button
                                      onClick={() => setColorPickerTarget('shapeStripeB')}
                                      title="條紋顏色二"
                                      className="w-6 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                                      style={{ backgroundColor: sel.stripeB || '#FFFFFF' }}
                                    />
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setColorPickerTarget('shapeDot')}
                                    title="紋理顏色"
                                    className="w-8 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                                    style={{ backgroundColor: sel.dotColor || '#FFFFFF' }}
                                  />
                                )}
                              </div>
                            </div>
                            {tex === 'stripe' ? (
                              /* 條紋沒有間距可以調（一條接著一條），只有條數。
                                 右邊那一格放直式／橫式，跟滑桿並排。 */
                              <div className="grid grid-cols-2 gap-x-7 gap-y-4 px-3 pt-2 pb-3 border-t border-[#1c1c1c] items-end">
                                {/* 左右各留 8px，畫出來的線才會收在自己那一欄裡 */}
                                <div className="px-2">
                                  {shapeSlider('數量', sel.stripeN ?? STRIPE_N_DEFAULT, 0, STRIPE_N_MAX, (v: number) => patch({ stripeN: v }))}
                                </div>
                                <div className="space-y-1.5">
                                  <span className="text-[11px] font-bold text-white/70">方向</span>
                                  <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                                    {STRIPE_DIRS.map(([d, label]) => (
                                      <button
                                        key={d}
                                        onClick={() => patch({ stripeDir: d })}
                                        className={`flex-1 h-6 text-[10px] font-bold rounded-[2px] transition-all ${
                                          (sel.stripeDir === 'h' ? 'h' : 'v') === d ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'
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
                                {shapeSlider('大小', sel.dotSize ?? 50, 0, 100, (v: number) => patch({ dotSize: v }))}
                                {shapeSlider('間距', sel.dotGap ?? 20, 0, 100, (v: number) => patch({ dotGap: v }))}
                                {isGridTex(tex) && <div className="col-span-2">{shapeSlider('壓扁',maskTextureSquashToUi(sel.dotSquash??50),0,100,(v:number)=>patch({dotSquash:maskTextureSquashFromUi(v)}))}</div>}
                              </div>
                            )}
                          </div>
                            );
                          })()}
                          {shapeSupportsFeather(sel.kind, sel.filled, sel.hole) && (
                            <div className="px-2 order-5 w-full">
                              {shapeSlider('羽化', sel.shapeFeather || 0, 0, 100,
                                (v: number) => patch({ shapeFeather: v }))}
                            </div>
                          )}
                          {/* 粗細與虛線只有空心／線條才有，放在最後面 */}
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  sel.type === 'text' ? (
                    <div className="max-w-md mx-auto h-full animate-in fade-in duration-300">
                      <TextEditorPanel
                        symbol={!!sel.sym}
                        /* 描邊／發光的顏色改成點進獨立的顏色頁（跟紋理顏色同一種操作） */
                        onPickColor={(which: 'stroke' | 'glow') =>
                          setColorPickerTarget(which === 'stroke' ? 'textStroke' : 'textGlow')}
                        layer={{
                          text: sel.text, sym: sel.sym, color: sel.color, fontFamily: sel.fontFamily,
                          fontSize: sel.size, bold: sel.bold, italic: sel.italic,
                          letterSpacing: sel.letterSpacing, strokeWidth: sel.strokeWidth,
                          strokeColor: sel.strokeColor, glow: sel.glow, glowColor: sel.glowColor,
                        } as any}
                        onChange={(d: any) => {
                          if (d.fontFamily) ensureFont(d.fontFamily);
                          /* 第一次把發光拉起來：預設用這段文字（符號）自己的顏色，
                             一個物件只做這一次，之後手動挑過的顏色不會被蓋掉。 */
                          if (d.glow !== undefined && d.glow > 0 && !sel.glowInit) {
                            // 文字（含符號）的發光預設就是純白
                            d = { ...d, glowColor: '#ffffff', glowInit: true };
                          }
                          if (d.fontSize !== undefined) {
                            if (sel.sym) {
                              symbolSizeTuningRef.current = true;
                              if (symbolSizeTimerRef.current !== null) window.clearTimeout(symbolSizeTimerRef.current);
                              symbolSizeTimerRef.current = window.setTimeout(() => {
                                symbolSizeTuningRef.current = false;
                                symbolSizeTimerRef.current = null;
                                setFxTick(n => n + 1);
                              }, 140);
                            }
                            patch({ ...d, size: d.fontSize }); return;
                          }
                          patch(d);
                        }}
                      />
                    </div>
                  ) : (
                  <div className="h-full">
                    {/* 圖片調整直接用經典拼圖那顆元件 —— 同一份程式碼，
                        所以按鈕佈局、樣式、外觀都是逐像素相同。
                        形狀那一組（圓角／羽化／描邊／發光）也接上了，
                        畫布端會把它們畫進每個圖片物件的快取裡。 */}
                    <ImageAdjustPanel
                      /* 影片物件：卡片牆（濾鏡／特效）是拿 src 去重畫縮圖的，
                         而 <img src="blob:…mp4"> 畫不出東西 —— 卡片會整面空白。
                         換成匯入時烤好的第一格，卡片就跟圖片物件長得一模一樣。
                         真正畫到畫布上的還是 sel.img（那段影片本人），這裡換掉的
                         只有面板看的那條網址。 */
                      img={panelImgOf(sel)}
                      hideShape={regionEditing}
                      isolateFxUpdates={regionEditing}
                      onAdjustmentStart={regionEditing ? ()=>{regionSliderHeld.current=true;regionBlend.current?.setHeld(true);} : undefined}
                      onAdjustmentCommit={regionEditing ? finishRegionEdit : undefined}
                      set={(d: any) => patch(d)} lutList={lutList}
                      loadingLut={loadingLut} setLoadingLut={setLoadingLut}
                      lutRevision={lutRevision} setLutRevision={setLutRevision}
                      adjustSub={adjustSub} setAdjustSub={setAdjustSub}
                      effectCard={effectCard} setEffectCard={setEffectCard}
                      effectDetail={effectDetail} setEffectDetail={setEffectDetail}
                      shapeMenu={shapeMenu} setShapeMenu={setShapeMenu}
                      shapeTool={shapeTool} setShapeTool={setShapeTool}
                      tuneTool={tuneTool} setTuneTool={setTuneTool}
                      setTuningEdge={setTuningEdge}
                      openComposeFor={openComposeFor}
                      composeOpen={!!composeState} onLeaveCompose={applyComposeToObj}
                      deferSlider
                      inlineSlider
                      onSliderOpenChange={setObjSliderOpen}
                    />
                  </div>
                  )
                );
              })()}
              {activeTab === 'motion' && (() => {
                /* 動畫頁。最上面是常駐的播放列（往下捲也不會跑掉），
                   下面挑要調哪個元素，再下面就是那個元素的參數。
                   所有改動都是即時的，換動畫種類還會自動重播一次。 */
                /* 現在畫面上「真的有發光」的是哪幾種。只有一種時就叫「發光」，
                   超過一種才需要標明是圖案／圖片／文字。 */
                // 舊版把發光獨立成一頁，現在併回本體那一頁；殘留的舊選取要導回去
                if (moTarget.startsWith('glow')) setTimeout(() => setMoTarget('shape'), 0);
                const selObj = objects.find(o => o.id === moTarget) || null;
                const cur: MoCfg = moTarget === 'shape'
                  ? (moShape.idle === 'grid-wave' ? { ...moShape, idle: 'pattern-breathe' } : moShape)
                  : selObj ? moOf(selObj) : MO_DEFAULT;
                const setCur = (d: Partial<MoCfg>) => {
                  if (moTarget === 'shape') setMoShape(m => ({ ...m, ...d }));
                  else if (selObj) patchMo(selObj.id, d);
                };
                // 換動畫種類 → 從頭播一次，不用自己等一圈
                const pickKind = (d: Partial<MoCfg>) => {
                  if (d.idle && selObj) setCur({ ...d, ...idleDefaults(d.idle, { symbol: !!selObj.sym, text: selObj.type === 'text', image: selObj.type === 'image', shape: selObj.type === 'shape', grid: isGridTarget, line: isSpecialLineTarget }) });
                  else if (d.in === 'bubble' && selObj?.sym) setCur({ ...d, dur: durFromSpeed(80) });
                  else if (d.idle === 'symbol-breathe2' && selObj?.type === 'text') setCur({ ...d, amp: 60, speed: 1.2 });
                  else if (d.idle === 'breathe' && selObj?.sym) setCur({ ...d, amp: 30 });
                  /* 非網格物件也使用網格波浪的同一組預設參數；滑桿範圍本來
                     就共用同一套，切換種類時也不能沿用上一個動畫的怪速度。 */
                  else if (d.idle === 'pattern-breathe' && moTarget === 'shape') setCur({ ...d, amp: 100, speed: patternBreathSpeedFromUi(70) });
                  else if (d.idle === 'image-breathe' && selObj?.type === 'image') setCur({ ...d, amp: 100, speed: patternBreathSpeedFromUi(70) });
                  else if (d.idle === 'grid-wave') setCur({
                    ...d,
                    ...(isGridTarget ? GRID_WAVE_DEFAULT : NON_GRID_WAVE_DEFAULT),
                    ...(selObj?.type === 'shape' ? { speed: 1.8 } : {}),
                  });
                  else if (d.idle && isSpecialLineTarget) setCur({ ...d, amp: 20 });
                  else setCur(d);
                  replayMotion();
                };
                /* 發光的常駐動畫不再自成一頁 —— 直接接在「本體」那一頁的最下面：
                   圖案的接在圖案頁、圖片／文字的接在那個物件自己的頁。 */
                const glowPanel = (which: 'hole' | 'img' | 'text') => {
                  const gv = which === 'img' ? glowMoImg
                    : which === 'text' ? glowMoText
                    : { idle: glowIdle, amp: glowAmp, speed: glowSpeed };
                  const gset = (d: Partial<{ idle: string; amp: number; speed: number }>) => {
                    if (which === 'img') setGlowMoImg(v => ({ ...v, ...d }));
                    else if (which === 'text') setGlowMoText(v => ({ ...v, ...d }));
                    else {
                      if (d.idle !== undefined) setGlowIdle(d.idle);
                      if (d.amp !== undefined) setGlowAmp(d.amp);
                      if (d.speed !== undefined) setGlowSpeed(d.speed);
                    }
                  };
                  return (
                    <>
                      <div className="flex justify-between text-[10px] font-bold text-[#888] mt-6 mb-2 uppercase tracking-widest">
                        <span>發光動畫</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {(which === 'hole' ? GLOW_IDLES : GLOW_IDLES_OBJ).map(g => (
                          <button key={g.id}
                            onClick={() => { gset({ idle: g.id, speed: GLOW_SPEED_DEFAULT[g.id] ?? 180 }); replayMotion(); }}
                            className={cell(gv.idle === g.id)}>
                            {g.name}
                          </button>
                        ))}
                      </div>
                      {gv.idle !== 'none' && (
                        <div className="grid grid-cols-2 gap-x-7 gap-y-4 mt-4">
                          <CompactSlider label="幅度" value={gv.amp} min={0} max={100} step={1}
                            onCommit={replayMotion}
                            onChange={(v: number) => gset({ amp: v })} />
                          {/* 滑桿一律顯示 0～100，內部再換算成倍率 */}
                          <CompactSlider label="速度" value={glowSpeedToUi(gv.speed)} min={0} max={100} step={1}
                            onCommit={replayMotion}
                            onChange={(v: number) => gset({ speed: glowSpeedFromUi(v) })} />
                        </div>
                      )}
                    </>
                  );
                };
                /** 這一頁的本體有沒有在發光？沒有就不顯示發光那一段 */
                const glowHere = moTarget === 'shape'
                  ? (glowMode !== 'off' && holes.length > 0)
                  : selObj ? (selObj.type === 'text' ? !!selObj.glow : !!selObj.imgGlow)
                  : false;
                const glowWhich: 'hole' | 'img' | 'text' = moTarget === 'shape' ? 'hole'
                  : selObj?.type === 'text' ? 'text' : 'img';

                const chip = (on: boolean) =>
                  `px-3 h-8 shrink-0 rounded-[8px] border text-[11px] font-bold tracking-wider transition-all ${
                    on ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]'
                       : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`;
                const cell = (on: boolean) =>
                  `h-9 rounded-[8px] border text-[10px] font-bold tracking-wider transition-all ${
                    on ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]'
                       : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`;
                const label = (t: string) =>
                  <p className="text-[10px] font-bold text-[#666] uppercase tracking-widest mb-2 mt-4">{t}</p>;
                const isSymbolTarget = !!selObj?.sym;
                const isTextTarget = selObj?.type === 'text' && !selObj.sym;
                const isImageTarget = selObj?.type === 'image';
                const isSpecialLineTarget = !!selObj && selObj.type === 'shape' && SPECIAL_LINE_KINDS.has(selObj.kind);
                const isGridTarget = !!selObj && selObj.type === 'shape' && GRID_SHAPE_KINDS.has(selObj.kind);
                const kinds = moTarget === 'shape' ? IN_KINDS.filter(k => k.id !== 'flip') : isSymbolTarget ? SYMBOL_IN_KINDS.filter(k => k.id !== 'bounce') : isGridTarget ? GRID_IN_KINDS.filter(k => k.id !== 'bounce') : isSpecialLineTarget ? LINE_IN_KINDS.filter(k => k.id !== 'bounce') : IN_KINDS.filter(k => k.id !== 'bounce');
                return (
                  <div className="max-w-md mx-auto pb-4 animate-in fade-in duration-300">
                    {/* 要調哪一個元素（播放列不在這裡 —— 它跟分頁列一樣在捲動區外面） */}
                    <div className="flex gap-2 overflow-x-auto no-scrollbar [&::-webkit-scrollbar]:hidden pb-1">
                      <button onClick={() => chooseMotionTarget('shape')} className={chip(moTarget === 'shape')}>圖案</button>
                      {hasLink && <button onClick={() => chooseMotionTarget('link')} className={chip(moTarget === 'link')}>
                        {linkMode === 'dash' ? '虛線' : '連線'}
                      </button>}
                      {(() => {
                        /* 圖形有兩顆以上就編號（圖形1、圖形2…），只有一顆就單純叫「圖形」 */
                        const shapeIds = objects.filter(z => z.type === 'shape').map(z => z.id);
                        const imageIds = objects.filter(z => z.type === 'image').map(z => z.id);
                        const shapeNo = (id: string) =>
                          shapeIds.length > 1 ? `圖形${shapeIds.indexOf(id) + 1}` : '圖形';
                        const imageNo = (id: string) =>
                          imageIds.length > 1 ? `圖片${imageIds.indexOf(id) + 1}` : '圖片';
                        return objects.map(o => (
                        <button key={o.id}
                          onClick={() => chooseMotionTarget(o.id)}
                          className={chip(moTarget === o.id)}>
                          {/* 符號直接標「符號」：它的內容常常是組合附加符號或冷門字，
                              切前六個字很容易剛好切在一半、或整顆在這裡根本畫不出來 ——
                              那樣這顆鈕看起來就是空的，等於選不到，也就沒辦法給它動畫。 */}
                          {o.type === 'text' ? (o.sym ? '符號' : (o.text || '文字').slice(0, 6))
                            : o.type === 'shape' ? shapeNo(o.id)
                            : imageNo(o.id)}
                        </button>
                      ));
                      })()}
                    </div>

                    {moTarget === 'link' ? (
                      <>
                        <div className="grid grid-cols-2 gap-x-7 gap-y-4 mt-4">
                          <CompactSlider label="起始" value={Number(moLink.delay.toFixed(1))} min={0} max={3} step={0.1} decimals={1} fixedDecimals
                            onCommit={replayMotion}
                            onChange={(v: number) => setMoLink(m => ({ ...m, delay: v }))} />
                          {/* 面板上調速度（越大越快），內部照樣存秒數 */}
                          <CompactSlider label="速度" value={speedFromDur(moLink.dur)} min={0} max={100} step={1}
                            onCommit={replayMotion}
                            onChange={(v: number) => setMoLink(m => ({ ...m, dur: durFromSpeed(v) }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          {LINK_EASES.map(e => (
                            <button key={e.id}
                              onClick={() => { setMoLink(m => ({ ...m, ease: e.id })); replayMotion(); }}
                              className={cell(moLink.ease === e.id)}>
                              {e.name}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        {label('進場動畫')}
                        <div className="grid grid-cols-4 gap-2">
                          {kinds.map(k => selObj?.kind === 'grid-orbits' && k.id === 'spin' ? { id: 'signal', name: '信號' } : k).map(k => (
                            <button key={k.id} onClick={() => pickKind({ in: k.id })} className={cell(cur.in === k.id)}>
                              {k.name}
                            </button>
                          ))}
                        </div>
                        {moTarget==='shape'&&<><p className="text-[10px] font-bold text-[#666] mt-3 mb-2">進場方向</p><div className="grid grid-cols-5 gap-1.5">
                          {([['random','隨機'],['left-right','左至右'],['right-left','右至左'],['top-bottom','上至下'],['bottom-top','下至上']] as const).map(([direction,name])=><button key={direction} aria-pressed={(cur.direction||'left-right')===direction} className={cell((cur.direction||'left-right')===direction)} onClick={()=>{setCur({direction});replayMotion();}}>{name}</button>)}
                        </div></>}
                        <div className="grid grid-cols-2 gap-x-7 gap-y-4 mt-3">
                          <CompactSlider label="起始" value={Number(cur.delay.toFixed(1))} min={0} max={3} step={0.1} decimals={1} fixedDecimals
                            onCommit={replayMotion}
                            onChange={(v: number) => setCur({ delay: v })} />
                          <CompactSlider label="速度"
                            value={cur.in === 'bubble' ? Math.round((speedFromDur(cur.dur) - 50) * 2) : speedFromDur(cur.dur)}
                            min={0} max={100} step={1}
                            onCommit={replayMotion}
                            onChange={(v: number) => setCur({ dur: durFromSpeed(cur.in === 'bubble' ? 50 + v / 2 : v) })} />
                        </div>

                        {label('常駐動畫')}
                        <div className="grid grid-cols-4 gap-2">
                          {(moTarget === 'shape' ? PATTERN_IDLE_KINDS : isSymbolTarget ? SYMBOL_IDLE_KINDS : isTextTarget ? TEXT_IDLE_KINDS : isImageTarget ? IMAGE_IDLE_KINDS : isGridTarget ? GRID_IDLE_KINDS : IDLE_KINDS).map(k => selObj?.kind === 'grid-orbits' && k.id === 'spin' ? { id: 'signal', name: '信號' } : k).map(k => (
                            <button key={k.id} onClick={() => pickKind({ idle: k.id })} className={cell(cur.idle === k.id)}>
                              {k.name}
                            </button>
                          ))}
                        </div>
                        {cur.idle !== 'none' && (
                          <div className="grid grid-cols-2 gap-x-7 gap-y-4 mt-3">
                            <CompactSlider key={`${moTarget}-${selObj?.id || 'pattern'}-${cur.idle}-amp`} label="幅度"
                              value={(cur.idle === 'pattern-breathe' && moTarget === 'shape') || (cur.idle === 'image-breathe' && isImageTarget)
                                ? patternBreathAmpToUi(cur.amp) : cur.amp}
                              min={0} max={100} step={1}
                              onChange={(v: number) => setCur({
                                amp: (cur.idle === 'pattern-breathe' && moTarget === 'shape') || (cur.idle === 'image-breathe' && isImageTarget)
                                  ? patternBreathAmpFromUi(v) : v,
                              })} />
                            <CompactSlider key={`${moTarget}-${selObj?.id || 'pattern'}-${cur.idle}-speed`} label="速度"
                              value={(cur.idle === 'pattern-breathe' && moTarget === 'shape') || (cur.idle === 'image-breathe' && isImageTarget)
                                ? patternBreathSpeedToUi(cur.speed)
                                : cur.idle === 'symbol-breathe2' && (isSymbolTarget || isTextTarget)
                                ? symbolBreathe2SpeedToUi(cur.speed)
                                : cur.idle === 'grid-wave' && selObj?.type !== 'shape' && !isGridTarget
                                  ? nonGridWaveSpeedToUi(cur.speed)
                                  : cur.idle === 'grid-wave' ? Math.round(Math.max(0, Math.min(100, (cur.speed - .2) / 1.8 * 100)))
                                  : Math.round(cur.speed * 100)}
                              min={(cur.idle === 'pattern-breathe' && moTarget === 'shape') || (cur.idle === 'image-breathe' && isImageTarget)
                                || cur.idle === 'symbol-breathe2' && (isSymbolTarget || isTextTarget)
                                || cur.idle === 'grid-wave' ? 0 : 20}
                              max={(cur.idle === 'pattern-breathe' && moTarget === 'shape') || (cur.idle === 'image-breathe' && isImageTarget)
                                || cur.idle === 'symbol-breathe2' && (isSymbolTarget || isTextTarget)
                                || cur.idle === 'grid-wave' ? 100 : 180}
                              step={1}
                              onChange={(v: number) => setCur({
                                speed: (cur.idle === 'pattern-breathe' && moTarget === 'shape') || (cur.idle === 'image-breathe' && isImageTarget)
                                  ? patternBreathSpeedFromUi(v)
                                  : cur.idle === 'symbol-breathe2' && (isSymbolTarget || isTextTarget)
                                  ? symbolBreathe2SpeedFromUi(v)
                                  : cur.idle === 'grid-wave' && selObj?.type !== 'shape' && !isGridTarget
                                    ? nonGridWaveSpeedFromUi(v)
                                    : cur.idle === 'grid-wave' ? .2 + v * .018
                                    : v / 100,
                              })} />
                          </div>
                        )}

                        {/* 這個本體正在發光的話，發光的常駐動畫就接在這一頁最下面 */}
                        {glowHere && glowPanel(glowWhich)}

                        {/* 這張圖片有虛線描邊的話，虛線自己的常駐動畫再接在下面。
                            沒有虛線（或沒有描邊）就整段不出現，不佔版面。 */}
                        {selObj && selObj.type === 'image'
                          && (selObj.imgStrokeWidth || 0) > 0 && (selObj.imgStrokeDash || 0) > 0 && (() => {
                          const dk = selObj.dashAnim || 'none';
                          const dsp = selObj.dashSpeed ?? 100;
                          const setDash = (d: any) => {
                            setObjects(prev => prev.map(o => o.id === selObj.id ? { ...o, ...d } : o));
                          };
                          return (
                            <>
                              <div className="flex justify-between text-[10px] font-bold text-[#888] mt-6 mb-2 uppercase tracking-widest">
                                <span>虛線動畫</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {DASH_ANIMS.map(d => (
                                  <button key={d.id}
                                    onClick={() => { setDash({ dashAnim: d.id }); replayMotion(); }}
                                    className={cell(dk === d.id)}>
                                    {d.name}
                                  </button>
                                ))}
                              </div>
                              {dk !== 'none' && (
                                <div className="grid grid-cols-2 gap-x-7 gap-y-4 mt-4">
                                  <CompactSlider label="速度" value={dsp} min={20} max={180} step={1}
                                    onChange={(v: number) => setDash({ dashSpeed: v })} />
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })()}
              {activeTab === 'shape' && <div className="max-w-md mx-auto h-full min-h-0 flex flex-row animate-in fade-in duration-300">
                <div className="flex flex-col shrink-0 w-11 -ml-5 border-r border-white/10 select-none">
                  <button onClick={() => setShapeSub('shape')} title="圖案" aria-label="圖案"
                    className={`w-full flex-1 flex items-center justify-center outline-none transition-colors duration-150 ${shapeSub === 'shape' ? 'text-white' : 'text-[#5a5a5a]'}`}>
                    <Star size={18} className={`transition-transform duration-150 will-change-transform ${shapeSub === 'shape' ? 'scale-110' : 'scale-100'}`} />
                  </button>
                  <div className="w-full h-[1px] bg-white/10 shrink-0" />
                  <button onClick={() => setShapeSub('style')} title="參數" aria-label="參數"
                    className={`w-full flex-1 flex items-center justify-center outline-none transition-colors duration-150 ${shapeSub === 'style' ? 'text-white' : 'text-[#5a5a5a]'}`}>
                    <SlidersHorizontal size={18} className={`transition-transform duration-150 will-change-transform ${shapeSub === 'style' ? 'scale-110' : 'scale-100'}`} />
                  </button>
                </div>
                <div ref={patternPanelRef} data-pattern-panel className="flex-1 min-h-0 min-w-0 no-scrollbar pl-3 pr-2 h-full py-5 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {shapeSub === 'shape' && <div className="pt-0.5 pb-2">
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {['circle', 'square', 'cross-star', 'heart', 'star', 'flower', 'snow', 'burst', 'love', 'love3', 'pic333', 'vortex', 'random-num', 'seagrass', 'darkstar', 'sparkle', 'aster', 'theta', 'zzz', 'text'].map(s => (
                    <button key={s} data-pattern-choice={s} aria-label={`圖案 ${s}`} onClick={() => handleShapeClick(s)} className={`h-11 min-w-0 overflow-hidden flex items-center justify-center rounded-[8px] border transition-colors ${holeType === s ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`}>
                      {s === 'circle' ? <Circle size={18} /> : s === 'square' ? <Square size={18} /> : s === 'cross-star' ? <CrossStarIcon size={18} /> : s === 'heart' ? <Heart size={18} /> : s === 'star' ? <Star size={18} /> : s === 'love' ? <span className="text-xs font-black font-mono tracking-tighter leading-none">&lt;3</span> : s === 'love3' ? <span className="text-[10px] font-black font-mono tracking-tighter leading-none">&lt;333</span> : s === 'vortex' ? <VortexIcon size={18} /> : s === 'random-num' ? <span className="text-sm font-bold font-sans leading-none tracking-tight">(9)</span> : SHAPE_IMAGES[s] ? (
                        /* 去背的圖：拿它當遮罩、底色用 currentColor，
                           顏色就跟旁邊那些圖示走同一條規則 ——
                           沒選中時是暗的（#555），選中才變白。
                           （原本是用 filter 硬染成白色，所以永遠亮著。） */
                        <span
                          aria-hidden
                          style={{
                            display: 'block',
                            width: 26,
                            height: 26 / holeImgRatio(s),
                            maxWidth: 26,
                            maxHeight: 26,
                            backgroundColor: 'currentColor',
                            WebkitMaskImage: `url(${patternIconUrl(SHAPE_IMAGES[s])})`,
                            maskImage: `url(${patternIconUrl(SHAPE_IMAGES[s])})`,
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
                    </button>
                  ))}
                </div>
                {holeType === 'text' && (
                  <div ref={textInputWrapRef} className="pb-1">
                    <KeyboardSafeInput
                      type="text" 
                      maxLength={15} 
                      value={customText} 
                      onChange={e => setCustomText(e.target.value)} 
                      placeholder="輸入文字..." 
                      className="w-full p-2.5 bg-[#111] border border-transparent rounded-[8px] text-center text-sm font-bold focus:outline-none focus:border-white transition-colors text-white placeholder:text-[#333]" 
                    />
                    <div className="h-2" />
                  </div>
                )}
                </div>}
                {shapeSub === 'style' && <div className="pt-1 pb-2">
                  {/* 上下那一排的間距比左右大：滑桿撐大的觸控區有 56px 高，
                      原本 gap-4 排出來的行距只有 55px，兩排的觸控區剛好貼在一起，
                      拖上面那根的時候很容易碰到下面那根。gap-y-6 之後行距 63px，
                      中間留 7px 誰都不管的空白。左右維持 gap-4，寬度完全沒變。 */}
                  <div className="grid grid-cols-2 gap-x-7 gap-y-6">
                    <CompactSlider wide label="大小" value={Math.round(displayHoleSize)} min={0} max={100} onChange={handleHoleSizeChange} />
                    <CompactSlider wide label="數量" value={holeCount} min={0} max={30} onChange={setHoleCount} step={1} />
                    <CompactSlider wide label="變化" value={sizeJitter} min={0} max={50} onChange={setSizeJitter} />
                    <CompactSlider wide label="角度" value={displayAngle} min={0} max={360} onChange={handleAngleChange} step={1} />
                  </div>
                  {/* 連線：每個圖案拉一條極細的線到最近的鄰居。
                      版型跟上面那幾根滑桿一致 —— 左上是名稱，下面才是選項。
                      每一種圖案都支援（見上面 LINK_TYPES 的說明）。 */}
                  {/* 連線：按鈕與顏色並排成一列；顏色常駐（關閉時也看得到，
                      可以先挑好顏色再打開）。發光同一種排法，各佔一列。 */}
                  {/* 連線與發光都改成跟「紋理」同一種排法：
                      一格之內就把「名稱＋所有選項＋顏色」全部放完，
                      顏色點下去一樣是進獨立的調色頁。 */}
                  <div className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px] mt-6">
                    <span className="text-[10px] font-bold text-[#888]">連線</span>
                    <div className="flex items-center gap-2">
                      <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                        {([['none', '關閉'], ['solid', '實線'], ['dash', '虛線']] as const).map(([mode, name]) => (
                          <button
                            key={mode}
                            onClick={() => linkSupported && setLinkMode(mode)}
                            disabled={!linkSupported}
                            title={linkSupported ? `圖案之間的連線：${name}` : '這個圖案不支援連線'}
                            className={`px-2.5 h-6 text-[10px] font-bold rounded-[2px] transition-all ${
                              !linkSupported
                                ? 'text-[#2c2c2c] cursor-default'
                                : linkMode === mode
                                  ? 'bg-[#333] text-white shadow-sm'
                                  : 'text-[#555] hover:text-[#888]'
                            }`}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                      {/* 顏色格常駐（關閉時也在）：可以先挑好顏色再打開，
                          而且切換時整列的寬度不會變，就不會閃一下 */}
                      <button
                        onClick={() => setColorPickerTarget('linkColor')}
                        title="連線顏色"
                        className="w-8 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                        /* 還沒挑過顏色時就顯示遮罩色 —— 線在圖片上本來就是那個顏色 */
                        style={{ backgroundColor: linkColor || maskColor }}
                      />
                    </div>
                  </div>

                  <div className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px] mt-3">
                    <span className="text-[10px] font-bold text-[#888]">發光</span>
                    <div className="flex items-center gap-2">
                      <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                        {([['off', '關閉'], ['image', '開啟']] as const).map(([mode, name]) => (
                          <button
                            key={mode}
                            onClick={() => setGlowMode(mode)}
                            title={mode === 'image' ? '只有落在圖片上的那一段發光' : '不發光'}
                            className={`px-2.5 h-6 text-[10px] font-bold rounded-[2px] transition-all ${
                              glowMode === mode ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'
                            }`}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setColorPickerTarget('holeGlow')}
                        title="發光顏色"
                        className="w-8 h-6 rounded-[4px] shrink-0 border border-white/10 shadow-inner hover:border-white/40 transition-colors"
                        style={{ backgroundColor: holeGlowColor }}
                      />
                    </div>
                  </div>
                </div>}
                </div>
              </div>}
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

/* ── 滑桿為什麼會頓、這裡怎麼解 ────────────────────────────────────────
   iOS 的觸控事件是 120Hz 在送的（ProMotion），而我們每收到一次 input
   就要重畫一整張全解析度的拼圖。畫一張要十幾到幾十毫秒的話，
   一秒 120 次的請求等於「還沒畫完就又被要求重畫」——
   畫面看起來卡、CPU／GPU 全程滿載，手機就開始發燙。

   解法是把輸入「收斂到每一幀最多一次」（rAF coalescing，瀏覽器自己的
   pointerrawupdate／getCoalescedEvents 也是同一個思路）：
   手指滑動時把最新的值記下來，一格畫面只送出一次。
   中間被跳過的那些值本來就畫不出來（螢幕一格只能顯示一張），
   所以**畫質、效果、成品完全不受影響**，只是不再做白工。
   放開手指時一定會補送最後一個值，所以最終停在哪就是哪。 */
const useRafOnChange = (onChange: (v: number) => void) => {
  const pending = React.useRef<number | null>(null);
  const raf = React.useRef(0);
  const cb = React.useRef(onChange);
  cb.current = onChange;
  React.useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    pending.current = null;
  }, []);
  const push = React.useCallback((v: number) => {
    deferHeavyWork();
    pending.current = v;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const q = pending.current;
      pending.current = null;
      if (q !== null) cb.current(q);
    });
  }, []);
  const flush = React.useCallback(() => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    const q = pending.current;
    pending.current = null;
    if (q !== null) cb.current(q);
  }, []);
  return { push, flush };
};

/** This leaf owns the slider feedback. The large editor only commits state
 * at gesture end; its paint scheduler consumes the latest value each frame. */
const RegionLiveRange=({value,onChange,onCommit,min=0,max=100,step=1,label='融合程度'}:{value:number;onChange:(v:number)=>void;onCommit:()=>void;min?:number;max?:number;step?:number;label?:string})=>{
  const [shown,setShown]=React.useState(value);
  const release=React.useRef<(()=>void)|null>(null);
  const finish=()=>{release.current?.();release.current=null;onCommit();};
  React.useEffect(()=>()=>release.current?.(),[]);
  React.useEffect(()=>setShown(value),[value]);
  return <div className="slider-wrap w-full" style={{height:16}}>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={shown} className="premium-slider w-full"
      onChange={e=>{const v=Number(e.target.value);setShown(v);deferHeavyWork();onChange(v);}}
      onPointerDown={e=>{e.stopPropagation();release.current?.();release.current=holdPhotoInteraction();}}
      onPointerUp={finish} onPointerCancel={finish} onTouchEnd={finish} onKeyUp={finish}/></div>;
};

/** 只有一根軌道的滑桿，同樣把輸入收斂到每一幀一次 */
const RafRange = ({ min, max, step, value, onChange }: any) => {
  const { push, flush } = useRafOnChange(onChange);
  const release=React.useRef<(()=>void)|null>(null);
  const finish=()=>{flush();release.current?.();release.current=null;};
  React.useEffect(()=>()=>{release.current?.();},[]);
  return (
    <div className="slider-wrap w-full" style={{height:16}}>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={e => push(Number(e.target.value))}
      onPointerUp={finish}
      onPointerCancel={finish}
      onTouchEnd={finish}
      onKeyUp={flush}
      onPointerDown={e => {e.stopPropagation();release.current?.();release.current=holdPhotoInteraction();}}
      className="premium-slider w-full"
    />
    </div>
  );
};

/* wide＝圓點用「寬的那一種」（跟特效細項的並排滑桿同一顆）。
   只有指定要換的那幾頁會傳，其他地方維持原樣。 */
const CompactSlider = ({ label, value, min, max, onChange, step = "any", decimals = 0, fixedDecimals = false, onCommit, wide = false }: any) => {
  const { push, flush } = useRafOnChange(onChange);
  const done = () => { flush(); onCommit && onCommit(); };
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
  const requestedMax = Number.isFinite(Number(max)) ? Number(max) : 100;
  const safeMax = Math.max(safeMin, requestedMax);
  const numericValue = Number(value);
  const safeValue = Math.max(safeMin, Math.min(safeMax, Number.isFinite(numericValue) ? numericValue : safeMin));
  return (
  <div className="flex flex-col">
    <div className="flex justify-between text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
      <span>{label}</span>
      {/* 小數位要能顯示出來，不然 1.25 跟 1.5 在畫面上都是 1，看起來就像滑桿沒作用 */}
      <span className="text-white font-sans tabular-nums">
        {decimals > 0 ? (fixedDecimals ? safeValue.toFixed(decimals) : safeValue.toFixed(decimals).replace(/\.?0+$/, '') || '0') : Math.round(safeValue)}
      </span>
    </div>
    {/* onCommit：手指／滑鼠放開時才觸發（動畫頁拿它來自動重播） */}
    <div className="slider-wrap" style={{ height: 16 }}>
      <input type="range" min={safeMin} max={safeMax} step={step} value={safeValue}
        onChange={e => push(Number(e.target.value))}
        onPointerUp={done}
        onTouchEnd={done}
        onKeyUp={done}
        className={wide ? 'slim-slider w-full' : 'premium-slider w-full'} onPointerDown={e => e.stopPropagation()} />
    </div>
  </div>
  );
};

const LayoutIcon = ({ type, active }: any) => {
  const pos = type.split('-')[1];
  // 滿版：整個方塊都是照片，不存在遮罩分區。
  if (type === FULL) {
    return (
      <div className={`w-5 h-5 rounded-[2px] border transition-all shrink-0 ${active ? 'border-white scale-110 shadow-lg' : 'border-[#444]'}`} />
    );
  }
  // 四周包圍：畫成一個「框」，中間留白就是那張原圖
  if (pos === 'around') {
    return (
      <div className={`w-5 h-5 rounded-[2px] border ${active ? 'border-white scale-110 shadow-lg' : 'border-[#333]'} relative overflow-hidden transition-all shrink-0`}>
        <div className={`absolute inset-0 transition-colors ${active ? 'bg-white' : 'bg-[#333]'}`} />
        <div className="absolute inset-[4px] bg-[#111] rounded-[1px]" />
      </div>
    );
  }
  return (
    <div className={`w-5 h-5 rounded-[2px] border ${active ? 'border-white scale-110 shadow-lg' : 'border-[#333]'} relative overflow-hidden transition-all shrink-0`}>
      <div className={`absolute transition-colors ${active ? 'bg-white' : 'bg-[#333]'} ${pos === 'top' ? 'top-0 left-0 right-0 h-1/2' : pos === 'bottom' ? 'bottom-0 left-0 right-0 h-1/2' : pos === 'left' ? 'top-0 left-0 bottom-0 w-1/2' : 'top-0 right-0 bottom-0 w-1/2'}`} />
    </div>
  );
};
