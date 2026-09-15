
import { canvasToUrl, revokeUrl } from '../utils/blobUrl';
import { get2dWide } from '../utils/colorSpace';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { addExport } from '../utils/exportHistory';
import { Download, RefreshCw, Type, Circle, Heart, Star, Square, Shapes, Hexagon, Blocks, Sparkles, Asterisk, Crop, Palette, X, Plus, ChevronLeft, ArrowLeft, Paintbrush, Eraser, MousePointer, Link, Link2Off, SlidersHorizontal, MoveUp, MoveDown, Copy, Sliders, Trash2, Play, Pause, ImageIcon, Film } from 'lucide-react';
import { Icon } from './Icon';
import { SYMBOLS } from '../utils/symbols';
/* 文字編輯面板直接沿用經典拼圖那一顆 —— 用同一份程式碼，
   才是真正的「100% 一樣」（字體卡片牆、字距、粗體、描邊、發光全都在裡面）。 */
import {
  TextEditorPanel, ImageAdjustPanel,
  /* 圓角／羽化／描邊／發光全部改用經典拼圖那幾支：同一份程式碼，
     連羽化的三次盒狀模糊、發光的距離場都一樣，不會再有兩套外觀。 */
  cornerR, roundRectPath, makeShapeMask, makeGlowCanvas, GLOW_BLUR_UNIT, GLOW_EXTENT,
  /* 圖片外形（形狀）：圓形／星型／愛心也共用同一份路徑與同一支算圖 */
  isImgShaped, withImgOutline, drawImgBase, IMG_SHAPES, isPointInImgShape, imgShapeBox, imgShapeInk, imgShapePan, clampImgZoom, zoomAboutShapeCenter,
  /* 「新增圖形」整套跟經典拼圖共用：同一份清單、同一支路徑、同一顆色票元件，
     兩邊的圖形不可能長得不一樣。 */
  ADD_SHAPE_ITEMS, ShapeGlyph, HoleGlyph, CrossStarIcon, VortexIcon, swatchStrip, ColorPick, SmoothRange, GLOW_COLORS as GLOW_SWATCH_COLORS, SOFT_COLORS,
  /* 「新增符號」也是共用的：同一份符號清單、同一頁按鈕 */
  SymbolPicker, symbolFontReady,
  shapePathD, shapeGlowBlurs, drawFeatheredShapeBody, shapeSupportsFeather, SHAPE_DEFAULT_LINEW, SHAPE_DEFAULT_RATIO, SHAPE_DEFAULT_COLOR, SHAPE_FIT, shapeSupportsStretch, SPECIAL_LINE_KINDS, GRID_SHAPE_KINDS, GRID_DOT_KINDS, DUAL_COLOR_SHAPE_KINDS, COMPOSITE_SHAPE_KINDS,
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
  isTextHole, holeGlyph, glyphFont, glyphInk, drawTextShape, drawShapePath,
  drawHoleShape, paintDots, paintTex, texOf, glowAmount,
  HoleShapeItem, HOLE_ITEM_CROSS, HOLE_ITEM_CROSS_O, HOLE_ITEMS_EXTRA,
} from '../utils/holeShapes';
/* 構圖跟「編輯」「經典拼圖」共用同一個 ComposeStudio */
import { patternGlyph, paintPattern, paintStripesRect, TEX_OPTIONS, TEX_SWATCHES, STRIPE_DIRS, STRIPE_A, STRIPE_B, isGridTex,
  STRIPE_N_DEFAULT, STRIPE_N_MAX } from '../utils/pattern';
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
import { PhotoFx, ADJUST_KEYS, applyPhotoFx, hasPhotoFx, loadLut, getLoadedLut, deferHeavyWork } from '../utils/photoFx';
import { SaveButton } from './SaveButton';
import type { ExitChoice } from '../types';

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
export const shapePathBox = (
  kind: string, w: number, h: number,
  gridBaseW = w, gridBaseH = h,
  gridDotRadius = Math.min(gridBaseW, gridBaseH) / 160 * 2.325,
) => new Path2D(shapePathD(kind, w, h, gridBaseW, gridBaseH, gridDotRadius));

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
    const fit = SHAPE_FIT[o.kind] || [0, 0, 1, 1];
    const unit = ((o as any).lineBase || Math.max(o.w, o.h)) * scale / 160;
    const line = Math.max(.4, (o.lineW ?? 6) * unit);
    const edge = gap + ((o.filled && o.kind !== 'line') ? 0 : line / 2) + (o.strokeW || 0) * unit;
    return {
      x: bw * fit[0] - edge, y: bh * fit[1] - edge,
      w: Math.max(1, bw * fit[2]) + edge * 2,
      // 線條本身的墨水高度是 0，框高只應由線寬與留白組成；額外塞 1px
      // 會只加在下方，造成線條看起來偏離選中框中心。
      h: (o.kind === 'line' ? 0 : Math.max(1, bh * fit[3])) + edge * 2,
    };
  }
  if (o.type === 'shape') return { x: -gap, y: -gap, w: bw + gap * 2, h: bh + gap * 2 };
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
        style={{ touchAction: 'none' }}
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
export type MoFrame = { k: number; dx: number; dy: number; rot: number; a: number; burst?: number; draw?: number; seq?: number; gridWave?: number; gridReveal?: number; waveMix?: number; idleT?: number };
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
   淡的那一圈以 #D2E8E1 為基準（＝遮罩的預設色），
   深一點的那一圈以 #B8E3D8 為基準，兩種濃淡都給得到。
   第一顆固定純白。 */
const MASK_BASE_LIGHT = '#D2E8E1';
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
export const MASK_SWATCHES: string[] = TEX_SWATCHES;

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
    const q = Math.max(0, p);
    return { ...FLAT, fx: 1, burst: 0, gridWave: q, ...(q < 1 ? { gridReveal: easeOutCubic(q) } : null) };
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
    gridWave: g.gridWave, waveMix: blend,
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
const KOREAN_PRESETS = [
  '#FFFFFF', '#FAF6F0', '#EAE6DF', '#F1E7DB', '#E7DACB',
  '#F6DCD8', '#F4C2C2',
  '#F7E9C8', '#FFF1A5',
  '#DCE7DB', '#CBEAD6', '#9BD4C3', '#B8E3D8', '#D2E8E1',
  '#D7E3EF', '#E2DCEC',
];

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
  const PRESET_COLORS = [
    ...KOREAN_PRESETS,
    '#F0F0F0', '#D9D9D9', '#BFBFBF', '#A6A6A6', '#8C8C8C',
    '#737373', '#595959', '#404040', '#262626', '#1A1A1A', '#000000',
  ];

  return (
    <div className="h-full flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex justify-between items-center mb-3">
        <button onClick={onClose} className="flex items-center gap-2 text-[#888] hover:text-white transition-colors">
          <ArrowLeft size={14} />
          <span className="text-[10px] font-bold tracking-widest uppercase">返回</span>
        </button>
        <input
          type="text"
          value={hexInput}
          onChange={handleHexInputChange}
          maxLength={7}
          aria-label="色號"
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
  /** 從首頁一次選了好幾個時，第一個之後的那些 —— 會自動變成物件 */
  initialExtras?: File[];
  onImportNew: () => void;
  /** 接續上次時把存下來的參數餵回來 */
  initialState?: any;
  /** 從歷史紀錄點開來的那一筆的 key。再記一次的時候沿用它＝更新同一筆 */
  histKey?: string | null;
}

export const CollageTool: React.FC<CollageToolProps> = ({ onHome, onRequestExit, initialFile, initialExtras, onImportNew, initialState, histKey, lutList = [] }) => {
  const [imageState, setImageState] = useState<any>(null);
  const [layout, setLayout] = useState('mask-bottom');
  const [maskScale, setMaskScale] = useState(DEFAULT_MASK_SCALE);
  const [canvasRatio, setCanvasRatio] = useState<CanvasRatio>('1:1');
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
  const holeCountBeforeFullRef = useRef(11);
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
  const fxCanvasOf = useCallback((o: any, isMain = false, onScreenPx = 0): CanvasImageSource | null => {
    if (!o.img) return null;
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
    if ((!o.fx || !hasPhotoFx(o.fx)) && !hasShape && !needGeo) return videoFrame(o.img, vidCap);

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
    if (isMain && lv.key && lv.key !== baseKey) lv.liveUntil = now + 300;
    const live = isMain && lv.liveUntil > now;
    /* 匯出時工作尺寸放寬到 2400：成品現在最少也有 2400px 長邊（見 EXPORT_MIN_DIM），
       圖片物件如果還卡在 1600，畫上去等於被放大過 —— 那一顆就會比旁邊的
       圖形與文字糊。預覽維持 1600（拖曳中 640），手感完全沒動到。 */
    let cap = live ? 640 : (isMain ? 1600 : 2400);
    /* 只有影片吃這個夾子 —— 圖片的成品是算一次就留著的，多算沒有代價，
       維持原本的尺寸才不會讓任何既有的畫面變糊。 */
    if (vidCap > 0) cap = Math.min(cap, vidCap);
    /* ── 來源是影片的時候 ────────────────────────────────────────────
       參數（濾鏡、形狀、描邊…）從頭到尾不會變，但內容每一格都不一樣 ——
       鑰匙裡不多放一個「現在是第幾格」，畫面就會停在第一幀。
       暫停時 videoToken 不會變，那些快取一樣全部命中，一格都不會白算。 */
    const vTok = isVideoEl(o.img) ? videoToken(o.img) : 0;
    const isVid = vTok !== 0 || isVideoEl(o.img);
    const key = baseKey + '|' + cap + (isVid ? '|v' + vTok : '');
    const hit = objFxCache.current.get(o.id);
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
    if (isVid) {
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
    /* cacheSource：o.img 是載進來就不再變的一張 <img>，同一個尺寸的來源像素
       讀一次就夠。拖滑桿時每一格省掉一次 drawImage ＋ 一次 getImageData。
       影片剛好相反 —— 它每一格都不一樣，留著只會畫出上一格。

       out：影片是一秒幾十次地重算，每次開一張新畫布的話，手機的畫布記憶體
       幾秒就被系統收走（＝閃退）。把上一次那張交回去重用，尺寸一樣就
       連 width 都不重設，等於整段完全不配置記憶體。
       沒套形狀的時候回傳的就是 base 本人 —— 那時候快取裡那張跟 scratch.base
       是同一張，交回去重用完全正確。 */
    const reuse = scratch ? scratch.base : undefined;
    const base = applyPhotoFx(srcEl, iw, ih, o.fx || {}, {
      cacheSource: !isVid, fast: live, out: reuse,
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
    if (!hasShape) { objFxCache.current.set(o.id, { key, cv: base }); finish(); return base; }

    /* 這一段是經典拼圖 FloatingImageLayer 那條管線的逐段複製（同樣的函式、
       同樣的順序）：先把圖畫進一張「比框大 lw 一圈」的離屏畫布，用
       destination-in 套遮罩（有羽化才用 makeShapeMask 那張三次盒狀模糊的，
       只有圓角就直接填路徑，邊才不會被放大成階梯），描邊沿著外緣描，
       最後才用距離場算光暈墊在底下。

       經典拼圖的描邊／發光是「工作區單位」的絕對粗細（滑桿 0–20，浮動圖片
       的基準長邊是 160）。這裡沒有工作區單位，所以一律換算成「長邊的比例」：
       ×(長邊/160)，剛好等於經典拼圖預設大小那一張的觀感。 */
    const UNIT = Math.max(iw, ih) / 160;
    const lw = shape.sw * UNIT;
    const blurUnit = (shape.g / 20) * GLOW_BLUR_UNIT * UNIT;
    // 留邊固定用「最大強度」算，拖滑桿時邊界才不會每一格都變、圖看起來在抖
    const pad = Math.ceil(
      (shape.g ? GLOW_BLUR_UNIT * GLOW_EXTENT * UNIT : 0) + (shape.sw ? 20 * UNIT : 0) + 2,
    );
    const W = iw + pad * 2, H = ih + pad * 2;
    /* 影片：這一段每 50ms 就要重跑一次，兩張大畫布不能每次都開新的
       同一顆物件固定用同兩張，尺寸一樣就只清內容、完全不重新配置。 */
    const reuseCv = (t: HTMLCanvasElement, w2: number, h2: number) => {
      if (t.width !== w2 || t.height !== h2) { t.width = w2; t.height = h2; return; }
      const g0 = t.getContext('2d');
      if (!g0) return;
      g0.setTransform(1, 0, 0, 1, 0, 0);
      g0.globalAlpha = 1;
      g0.globalCompositeOperation = 'source-over';
      g0.clearRect(0, 0, w2, h2);
    };
    const cv = scratch ? scratch.cv : document.createElement('canvas');
    if (scratch) reuseCv(cv, W, H);
    else { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d')!;

    // 描邊往外長，所以形狀那一張要比框大 lw 一圈
    const strokeGap = shape.sg * UNIT;
    const strokeExtent = lw + strokeGap;
    const swid = iw + strokeExtent * 2, shgt = ih + strokeExtent * 2;
    let shaped: CanvasImageSource = base;
    let drawW = iw, drawH = ih, drawX = (W - iw) / 2, drawY = (H - ih) / 2;
    if (shape.f || shape.r || shape.sw || isImgShaped(shape.k)) {
      const offW = Math.max(1, Math.round(swid)), offH = Math.max(1, Math.round(shgt));
      const off = scratch ? scratch.off : document.createElement('canvas');
      if (scratch) reuseCv(off, offW, offH);
      else { off.width = offW; off.height = offH; }
      const oc = off.getContext('2d')!;
      drawImgBase(oc, base, strokeExtent, strokeExtent, iw, ih, o);
      if (shape.f || shape.r || isImgShaped(shape.k)) {
        oc.globalCompositeOperation = 'destination-in';
        if (shape.f) {
          oc.drawImage(makeShapeMask(iw, ih, shape.r, shape.f, shape.k), strokeExtent, strokeExtent, iw, ih);
        } else {
          const R = cornerR(shape.r, iw, ih);
          withImgOutline(oc, strokeExtent, strokeExtent, iw, ih, shape.k, R, R, p => {
            oc.fillStyle = '#fff';
            p ? oc.fill(p) : oc.fill();
          });
        }
        oc.globalCompositeOperation = 'source-over';
      }
      if (lw > 0) {
        const sr = shape.r ? cornerR(shape.r, iw, ih) + strokeGap + lw / 2 : 0;
        withImgOutline(oc, lw / 2, lw / 2, iw + strokeGap * 2 + lw, ih + strokeGap * 2 + lw, shape.k, sr, sr, p => {
        oc.lineWidth = lw;
        oc.lineJoin = 'miter';
        oc.miterLimit = 4;
        /* 虛線：一段的長度用線寬當單位，跟經典拼圖同一條式子 */
        if (shape.sd > 0) {
          const seg = lw * (0.6 + (shape.sd / 100) * 4);
          oc.setLineDash([seg, seg * 0.85]);
          oc.lineCap = 'butt';
        } else {
          oc.setLineDash([]);
        }
        oc.strokeStyle = shape.sc;
        p ? oc.stroke(p) : oc.stroke();
        oc.setLineDash([]);
        });
      }
      shaped = off;
      drawW = off.width; drawH = off.height;
      drawX = (W - swid) / 2; drawY = (H - shgt) / 2;
    }

    if (shape.g) {
      // 光暈本身很平滑，算在有上限的小張上再放大貼回來（跟經典拼圖同一招）
      const gk = Math.min(1, 420 / Math.max(W, H));
      const glow = makeGlowCanvas(
        shaped, W * gk, H * gk, drawX * gk, drawY * gk, drawW * gk, drawH * gk,
        blurUnit * gk, shape.gc,
      );
      c.drawImage(glow, 0, 0, W, H);
    }
    c.drawImage(shaped, drawX, drawY, drawW, drawH);

    /* 留邊在兩個方向都是同樣的畫布像素，但換算成「佔框的比例」時
       長邊與短邊不一樣 —— 兩軸要各自記一份，不然非正方形的圖會被拉扁。 */
    (cv as any).__padX = pad / iw;
    (cv as any).__padY = pad / ih;
    objFxCache.current.set(o.id, { key, cv });
    finish();
    return cv;
  }, []);
  /** 圖片與遮罩的交界線（畫布座標）。四周包圍是原圖那個框的四條邊。 */
  const seamLinesRef = useRef<() => { xs: number[]; ys: number[] }>(() => ({ xs: [], ys: [] }));

  /** 旋轉之後真正佔的框（外接矩形）。0/180 度就是原本的寬高，90 度會對調。 */
  const aabbOf = (w: number, h: number, rot: number) => {
    const r = ((rot || 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(r)), s2 = Math.abs(Math.sin(r));
    return { bw: w * c + h * s2, bh: w * s2 + h * c };
  };

  /**
   * 這個位置上「現在剛好對齊」的每一條線。
   * 跟經典拼圖的 pageGuidelinesAt 同一套：吸附只挑最近的一條，
   * 但畫面上要把「當下同時對齊的每一條」都亮出來 —— 置中放大到剛好滿版時，
   * 左右（或上下）兩條會一起亮，而不是只亮一條。
   * edgeOnly：兩指縮放時中心點根本不會動，中線會整趟掛著，所以只畫邊。
   */
  /* 其他物件的對齊候選線：外接框的左右緣／上下緣，以及中心。
     排除自己，不然永遠會跟自己對齊。 */
  const objLinesRef = useRef<(id?: string) => { xs: number[]; ys: number[]; cxs: number[]; cys: number[] }>(() =>
    ({ xs: [], ys: [], cxs: [], cys: [] }));
  objLinesRef.current = (selfId?: string) => {
    const xs: number[] = [], ys: number[] = [], cxs: number[] = [], cys: number[] = [];
    /* 符號自成一群：符號只跟符號對齊，其他物件也看不到符號的邊。
       符號通常是一堆散在畫面上的小裝飾，跟照片、文字混在一起對齊，
       畫面上會到處亮線、也很難拖到想要的位置。
       （找不到自己時一律當「不是符號」——那一邊比較保守。） */
    const isSym = (z: any) => !!(z && z.type === 'text' && z.sym);
    const selfSym = isSym(objectsRef.current.find((z: any) => z && z.id === selfId));
    for (const o of objectsRef.current) {
      if (!o || o.id === selfId || !o.w || !o.h) continue;
      if (isSym(o) !== selfSym) continue;
      // 跟自己一樣用「旋轉之後的外接框」，轉過的物件才不會亮在半個身子外
      const { bw, bh } = aabbOf(o.w, o.h, o.rot || 0);
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      // 只收邊緣（左右／上下）。中心刻意不收 —— 見 linesAt 裡的說明。
      xs.push(cx - bw / 2, cx + bw / 2);
      ys.push(cy - bh / 2, cy + bh / 2);
    }
    return { xs, ys, cxs, cys };
  };

  const linesAt = useCallback((cx: number, cy: number, bw: number, bh: number, edgeOnly = false, selfId?: string) => {
    const o = getLayoutOffsetsRef.current?.();
    if (!o) return [] as any[];
    const seams = seamLinesRef.current();
    const others = objLinesRef.current(selfId);
    const out: any[] = [];
    const EPS_C = 0.75;   // 中線是精準吸附
    const EPS_E = 0.6;    // 邊只留給次像素捨入；有縫就不該畫線
    const L = cx - bw / 2, R = cx + bw / 2, T = cy - bh / 2, B = cy + bh / 2;
    const xs = [0, o.cw, ...seams.xs, ...(edgeOnly ? [] : others.xs)];
    const ys = [0, o.ch, ...seams.ys, ...(edgeOnly ? [] : others.ys)];
    /* 底圖與遮罩各自的中心。以前只有「整張成品畫布」的中心會亮線，
       左右／上下排版時，物件移到某一半的正中央完全沒有回饋。 */
    const regionCenters = (() => {
      const st = imageState;
      if (!st) return { xs: [] as number[], ys: [] as number[] };
      return {
        xs: [o.ix + o.iw / 2, ...(o.mw > 0 ? [o.mx + o.mw / 2] : [])],
        ys: [o.iy + o.ih / 2, ...(o.mh > 0 ? [o.my + o.mh / 2] : [])],
      };
    })();
    if (!edgeOnly && Math.abs(cx - o.cw / 2) < EPS_C) out.push({ x: o.cw / 2 });
    if (!edgeOnly && Math.abs(cy - o.ch / 2) < EPS_C) out.push({ y: o.ch / 2 });
    if (!edgeOnly) {
      for (const v of regionCenters.xs) if (Math.abs(cx - v) < EPS_C) out.push({ x: v });
      for (const v of regionCenters.ys) if (Math.abs(cy - v) < EPS_C) out.push({ y: v });
    }
    for (const v of xs) {
      if (Math.abs(L - v) < EPS_E || Math.abs(R - v) < EPS_E) out.push({ x: v });
      else if (!edgeOnly && seams.xs.includes(v) && Math.abs(cx - v) < EPS_C) out.push({ x: v });
    }
    for (const v of ys) {
      if (Math.abs(T - v) < EPS_E || Math.abs(B - v) < EPS_E) out.push({ y: v });
      else if (!edgeOnly && seams.ys.includes(v) && Math.abs(cy - v) < EPS_C) out.push({ y: v });
    }
    /* 物件跟物件**只對邊緣**，不對中心 —— 中線只留給畫布自己那一條。
       物件的中心線亮起來太容易，一堆物件在畫面上時會整片都是線。 */
    // 同一條線可能被多個來源推進來（例如畫布邊界剛好也是交界）
    const seen = new Set<string>();
    return out.filter(g => {
      const k = (g.x !== undefined ? 'x' : 'y') + Math.round((g.x !== undefined ? g.x : g.y) * 10);
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  }, [imageState, layout, maskScale]);

  /** 把位置吸附到畫布中線／邊界／遮罩交界，並回報要亮哪幾條線 */
  const snapToGuides = useCallback((x0: number, y0: number, w0: number, h0: number, rot = 0, edgeOnly = false, selfId?: string) => {
    const offsG = getLayoutOffsetsRef.current?.();
    if (!offsG || !w0 || !h0 || !enableSnappingRef.current) return { x: x0, y: y0, guides: [] as any[] };
    /* 判定一律用「旋轉之後的外接框」—— 轉了 90 度還拿原本的寬高去比，
       線就會亮在離邊緣半個身子的地方。 */
    const { bw, bh } = aabbOf(w0, h0, rot);
    let cx = x0 + w0 / 2, cy = y0 + h0 / 2;
    /* 經典／創意拼圖共用 8 個螢幕像素的吸附距離。這裡先換算成
       畫布座標，因此不同手機尺寸與預覽倍率下的吸附力道仍然一致。 */
    const cssW = baseCssWRef.current;
    const perCss = cssW > 0 ? offsG.cw / cssW : 3;   // 一個畫面像素等於幾個畫布單位
    const snap = Math.max(0.75, perCss * 4);
    const seams = seamLinesRef.current();
    /**
     * 單軸吸附：候選是「這條線」＋「中心要位移多少才貼上去」。
     *  1. 中心線只跟「物件中心」配對 —— 邊緣碰到中心線不算對齊。
     *  2. 取最近的那一條，不是第一條符合的。
     *  3. 兩條一樣近但要往相反方向拉，就不要動 —— 以前是這一格黏一邊、
     *     下一格黏另一邊，看起來就是在抖。
     */
    const others = objLinesRef.current(selfId);
    const regionCenters = (() => {
      const st = imageState;
      if (!st) return { xs: [] as number[], ys: [] as number[] };
      return {
        xs: [offsG.ix + offsG.iw / 2, ...(offsG.mw > 0 ? [offsG.mx + offsG.mw / 2] : [])],
        ys: [offsG.iy + offsG.ih / 2, ...(offsG.mh > 0 ? [offsG.my + offsG.mh / 2] : [])],
      };
    })();
    /* centreOnly：只跟「我的中心」配對的線（其他物件的中心）。
       邊緣碰到別人的中心不算對齊，跟畫布中線是同一條規則。 */
    const axis = (c0: number, half: number, centre: number, edges: number[], seamList: number[], centreOnly: number[] = []) => {
      const cands: { d: number }[] = [];
      if (!edgeOnly) cands.push({ d: centre - c0 });
      for (const v of [...edges, ...seamList]) {
        cands.push({ d: v - (c0 - half) });
        cands.push({ d: v - (c0 + half) });
      }
      if (!edgeOnly) for (const v of [...seamList, ...centreOnly]) cands.push({ d: v - c0 });
      const near = cands.filter(z => Math.abs(z.d) < snap).sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
      if (!near.length) return 0;
      const best = near[0];
      const TIE = Math.max(0.75, snap * 0.06);
      if (near.some(z => Math.abs(Math.abs(z.d) - Math.abs(best.d)) < TIE && Math.abs(z.d - best.d) > TIE)) return 0;
      return best.d;
    };
    /* 畫布的邊界／中線／交界，再加上「其他物件的邊緣」——
       所以圖片跟圖片、圖片跟文字之間也吸得到、也會亮線。 */
    cx += axis(cx, bw / 2, offsG.cw / 2, [0, offsG.cw, ...(edgeOnly ? [] : others.xs)], seams.xs, regionCenters.xs);
    cy += axis(cy, bh / 2, offsG.ch / 2, [0, offsG.ch, ...(edgeOnly ? [] : others.ys)], seams.ys, regionCenters.ys);
    return { x: cx - w0 / 2, y: cy - h0 / 2, guides: linesAt(cx, cy, bw, bh, edgeOnly, selfId) };
  }, [linesAt, imageState, layout, maskScale]);

  /**
   * 兩指縮放時把「倍率」也吸一下：找一個倍率讓外接框的某一邊剛好落在
   * 畫布邊界／遮罩交界上。置中放大時左右（或上下）算出來的倍率是同一個，
   * 所以兩條邊會同時貼上去、兩條線一起亮 —— 這就是經典拼圖捏合時的手感。
   */
  const snapPinchScale = useCallback((k: number, w0: number, h0: number, cx: number, cy: number, rot: number, selfId?: string) => {
    const o = getLayoutOffsetsRef.current?.();
    if (!o || !enableSnappingRef.current) return { k, guides: [] as any[] };
    const { bw, bh } = aabbOf(w0, h0, rot);
    if (bw < 1 || bh < 1) return { k, guides: [] as any[] };
    const shown = Math.max(1, baseCssWRef.current * Math.max(1, viewTRef.current.k));
    const perCss = o.cw / shown;
    const snap = Math.max(0.75, perCss * 4);
    const centreEps = Math.max(0.35, perCss * 0.75);
    const xs = [0, o.cw], ys = [0, o.ch];
    /* 縮放時通常只認整張畫布外緣。唯一例外是另一個物件跟目前物件
       中心完全重合：這時把那個物件的四邊加入，才能做同心等寬／等高。 */
    for (const z of objectsRef.current) {
      if (!z || z.id === selfId || !z.w || !z.h) continue;
      const zcx = z.x + z.w / 2, zcy = z.y + z.h / 2;
      if (Math.abs(zcx - cx) > centreEps || Math.abs(zcy - cy) > centreEps) continue;
      const a = aabbOf(z.w, z.h, z.rot || 0);
      xs.push(zcx - a.bw / 2, zcx + a.bw / 2);
      ys.push(zcy - a.bh / 2, zcy + a.bh / 2);
    }
    const cands: { k: number; axis: 'x' | 'y'; line: number; delta: number }[] = [];
    for (const v of xs) {
      for (const cand of [(2 * (cx - v)) / bw, (2 * (v - cx)) / bw])
        cands.push({ k: cand, axis: 'x', line: v, delta: Math.abs(cand - k) * bw / 2 });
    }
    for (const v of ys) {
      for (const cand of [(2 * (cy - v)) / bh, (2 * (v - cy)) / bh])
        cands.push({ k: cand, axis: 'y', line: v, delta: Math.abs(cand - k) * bh / 2 });
    }
    const best = cands.filter(c => c.k > 0.05 && c.k <= 8 && c.delta < snap)
      .sort((a, b) => a.delta - b.delta)[0];
    const bestK = best ? best.k : k;
    if (!best) return { k, guides: [] as any[] };
    const bw1 = bw * bestK, bh1 = bh * bestK;
    const guides: any[] = [];
    for (const v of xs) if (Math.min(Math.abs(cx - bw1 / 2 - v), Math.abs(cx + bw1 / 2 - v)) < centreEps) guides.push({ x: v });
    for (const v of ys) if (Math.min(Math.abs(cy - bh1 / 2 - v), Math.abs(cy + bh1 / 2 - v)) < centreEps) guides.push({ y: v });
    return { k: bestK, guides };
  }, []);

  /* ── 構圖：跟「編輯」「經典拼圖」共用同一個 ComposeStudio ──────────────
     套用完把裁切結果 bake 成新的一張圖塞回這個物件，寬度不變、
     高度依新的長寬比重算，並讓中心留在原地。 */
  const [composeState, setComposeState] = useState<{ id: string; img: HTMLImageElement | HTMLVideoElement; geo: GeoParams; vid?: boolean } | null>(null);

  const openComposeFor = useCallback((id: string) => {
    const o = objectsRef.current.find(z => z.id === id);
    if (!o || !o.src) return;
    /* 影片直接把那個 <video> 交給構圖介面 —— 它跟 <img> 一樣畫得上畫布。
       （另外開一張 <img> 去讀影片的網址是讀不到的，那正是經典拼圖那邊
       「一按構圖就沒反應」的原因。）
       進構圖的期間影片是停著的（見影片那支迴圈），所以你在裁的是一格
       定住的畫面，框拖起來不會一直在動。 */
    if (isVideoEl(o.img)) {
      setComposeState({ id, img: o.img, geo: o.geo || DEFAULT_GEO, vid: true });
      return;
    }
    const el = new Image();
    el.onload = () => setComposeState({ id, img: el, geo: o.geo || DEFAULT_GEO });
    // baked 過就從原圖接續，參數還原成上次的樣子
    el.src = o.origSrc || o.src;
  }, []);

  const applyComposeToObj = useCallback(() => {
    setComposeState(st => {
      if (!st) return null;
      const o = objectsRef.current.find(z => z.id === st.id);
      if (!o) return null;
      const srcUrl = o.origSrc || o.src;
      const finish = (newSrc: string, aspect: number) => {
        const el = new Image();
        el.onload = () => {
          setObjects(prev => prev.map(f => {
            if (f.id !== st.id) return f;
            const nh = Math.max(8, f.w / aspect);
            return { ...f, img: el, src: newSrc, origSrc: srcUrl, geo: st.geo, y: f.y + (f.h - nh) / 2, h: nh };
          }));
          objFxCache.current.delete(st.id);
          setFxTick(n => n + 1);
          setComposeState(null);
        };
        el.src = newSrc;
      };
      const sw = (st.img as any).naturalWidth || (st.img as any).videoWidth || st.img.width;
      const sh = (st.img as any).naturalHeight || (st.img as any).videoHeight || st.img.height;
      /* ── 影片：不烤 ─────────────────────────────────────────────────
         照片的構圖是把裁切結果烤成一張新圖再換掉 src。影片這樣做的話，
         換上去的是一張靜態圖 —— 那正是「裁切後影片就沒了」。
         改成把 geo 留在物件上，每一格畫的時候才套（見 fxCanvasOf）。
         這裡只要把框的高度改成裁切後的長寬比，並讓中心留在原地。 */
      if (isVideoEl(st.img)) {
        const q = ((st.geo.quarter % 4) + 4) % 4;
        const swap = q === 1 || q === 3;
        const bw = swap ? sh : sw, bh = swap ? sw : sh;
        const c = st.geo.crop;
        const aspect = (bw * c.w) / Math.max(1e-6, bh * c.h);
        setObjects(prev => prev.map(f => {
          if (f.id !== st.id) return f;
          const nh = Math.max(8, f.w / aspect);
          return { ...f, geo: st.geo, y: f.y + (f.h - nh) / 2, h: nh };
        }));
        objFxCache.current.delete(st.id);
        setFxTick(n => n + 1);
        setComposeState(null);
        return null;
      }
      if (isGeoIdentity(st.geo)) { finish(srcUrl, sw / sh); return st; }
      const baked = composeCanvas(st.img, sw, sh, st.geo, 2400);
      baked.toBlob(blob => {
        if (!blob) { setComposeState(null); return; }
        finish(URL.createObjectURL(blob), baked.width / baked.height);
      }, 'image/png');
      return st;
    });
  }, []);

  /** 拖曳物件時亮起來的對齊線（畫布座標） */
  const getLayoutOffsetsRef = useRef<any>(null);
  const [guides, setGuides] = useState<any[]>([]);
  /* 拖形狀滑桿的期間把選取框與工具列收起來 —— 不然圓角／羽化／描邊／發光
     的邊緣變化整個被白框壓住，根本看不出來調到哪。 */
  const [tuningEdge, setTuningEdge] = useState(false);
  /* header 的三個點：對稱與對齊都收在裡面（跟經典拼圖同一套） */
  /* 兩指縮放物件的期間把那排白色鍵收起來 —— 它掛在物件下緣，
     物件一邊變大它就一邊亂跳（經典拼圖也是這樣處理的）。