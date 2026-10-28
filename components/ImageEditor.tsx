
import { freshGrade, isGradeIdentity, isGradeToolIdentity, makeGrade, normGrade, type ColorGrade, type GradeFast } from '../utils/colorGrade';
import { PrimariesPanel, COLOUR_PANEL_H } from './PrimariesPanel';
import { EditBar, EditBarTab, EDIT_BAR_H } from './EditBar';
import { BeautyStudio, type StudioResult } from './BeautyStudio';
import { ColorMatchStudio } from './ColorMatchStudio';
import { TemplatePanel } from './TemplatePanel';
import { ComposeStudio, COMPOSE_WARMUP_CLASSES } from './ComposeStudio';
import { LUT_DEFAULT_AMOUNT } from '../utils/photoFx';
import { GLOW_FX_IDS, hasGlow, glowSig, stripGlow, pickGlow } from '../utils/glowFx';
import { isIdentityCurve, boundedCurvePath } from '../utils/editorCurveGeometry';
import { loadCachedLut, saveCachedLut } from '../utils/lutStore';
import {repairLutAtlas,needsLutAtlasRepair,LUT_ATLAS_REPAIR_REVISION} from '../utils/lutAtlasRepair.js';
import { bakeColorLut, bakedToTexture } from '../utils/lutBake';
import { LutGpu } from '../utils/lutGpu';
import { preferWebgl2, surfaceGl, isWebgl2, type GpuImage } from '../utils/fxSurfaceGl';
import { FX_DEFS, FX_DEFAULTS, applyGlEffects, presentFxSource, disposeFxSurface, hasActiveFx, warmFx, type FxDef } from '../utils/glEffects';
import {warmLowfiLut} from '../utils/lowfiLut';
import { orderEffectCards } from '../utils/effectDisplayOrder';
import {effectControlValue,effectStoredValue,effectControlMin,effectControlStep,isContinuousEffectControl} from '../utils/effectControlValues';
import {effectPreset,LEGACY_EFFECT_PRESETS} from '../utils/effectPresets';
import {effectDetailIcon} from '../utils/effectDetailIcons';
import {HalationLayer} from '../utils/halationLayer';
import {highlightHistogram,selectHighlights,highlightWeight,luminanceBin} from '../utils/highlightSelection';
import { maskList, snapOf, hasMaskAdj, anyMask, maskAlpha, maskCacheId, freshMask, newMaskId, MASK_ADJ_KEYS, MASK_SNAP_KEYS, rgbToLab, type MaskSnap, type MaskType } from '../utils/masks';
import { DEFAULT_GEO, FULL_CROP, GeoParams, composeCanvas, isGeoIdentity, sameGeoPixels, validGeo } from '../utils/compose';
import { SaveButton } from './SaveButton';
import { ExportActionLift } from './ExportActionLift';
/* IG 貼文預覽跟拼圖那兩個工具共用同一顆元件 */
import { IgPreview } from './IgPreview';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { addExport } from '../utils/exportHistory';
import { canvasToUrl, revokeUrls, revokeUrlsLater } from '../utils/blobUrl';
import { canExportHeic, exportHeic } from '../utils/heicExport';
import { PREMIUM_GLASS } from '../utils/premiumGlass';
import { StuckEscape } from './StuckEscape';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { ChevronLeft } from 'lucide-react';
import ExifReader from 'exifreader';
import { Icon } from './Icon';
import type { ExitChoice } from '../types';

import { pushHistory as pushHistoryEntry } from '../utils/history';
interface Point { x: number; y: number; }

interface Curves {
  rgb: Point[];
  r: Point[];
  g: Point[];
  b: Point[];
}

export interface EditorParams {
  brightness: number;
  exposure: number; contrast: number; highlights: number; shadows: number;
  /** Lightroom 白色／黑色 */
  whites: number; blacks: number;
  temp: number; tint: number; sat: number; vib: number;
  sharpen: number; grain: number; soft: number; softThreshold: number;
  softRadius: number; softColor: number; lutAmount: number;
  vignette: number; blur: number; colorNoise: number; colorNoise2: number;
  leakOpacity: number; leakAngle: number; leakHue: number;
  fringeIntensity: number; fringeHue: number; fringeSize: number; fringeFeather: number;
  curves: Curves;
  hsl: HslAdjust;
  /** 色輪（Log／一級調色／HDR），見 utils/colorGrade */
  grade?: ColorGrade;
  maskExposure: number;
  maskBrightness: number;
  maskContrast: number;
  maskHighlights: number;
  maskWhites: number;
  maskBlacks: number;
  maskShadows: number;
  maskTemp: number;
  maskTint: number;
  maskSat: number;
  maskVib: number;
  maskCreated: boolean;
  /* GLSL 特效的參數（強度 + 各自的細項），由 utils/glEffects.ts 的 FX_DEFS 定義。
     用樣板字面值的索引簽章只收 fx 開頭的鍵 —— 其他欄位打錯字照樣會被抓出來。 */
  [fxKey: `fx${string}`]: number;
  maskCx: number;
  maskCy: number;
  maskAngle: number;
  maskD: number;
  maskShowOverlay: boolean;
  /* ── 多個遮色片（見 utils/masks）：上面那組 mask* 是「目前選中的那一個」，masks 存全部 ── */
  maskId?: string;
  maskType?: MaskType;
  maskInvert?: boolean;
  maskRx?: number; maskRy?: number; maskFeather?: number;
  maskStrokes?: MaskSnap['maskStrokes']; maskBrushSize?: number; maskBrushFeather?: number; maskBrushFlow?: number; maskBrushErase?: boolean;
  maskColors?: MaskSnap['maskColors']; maskColorRange?: number; maskColorSmooth?: number;
  maskLumLo?: number; maskLumHi?: number; maskLumSmooth?: number;
  /** 明度範圍：點了照片、還沒讀到亮度的那一點（下一次重畫時換成上下限） */
  maskLumSample?: { x: number; y: number } | null;
  masks?: MaskSnap[];
  maskActive?: number;
}

/* ---------------------------------------------------------------------------
   HSL（色相／飽和度／明度）

   八個色帶的中心，跟 Lightroom、Camera Raw、Capture One 用的是同一組
   （HSL 色相角）。八個中心的間距刻意不平均 —— 紅橙黃擠在 0～60 度，
   是因為膚色、夕陽、樹葉這些最常被單獨調的東西都落在那一段。

   權重用「相鄰兩個中心之間內插」算，所以任何色相的八個權重加起來一定是 1
   （partition of unity），不會有某個色相被重複調到或漏掉。內插用 smoothstep
   而不是線性 —— 在中心點上斜率是 0，色相漸層掃過去時不會出現折角。

   另外彩度接近 0 的像素色相是雜訊（atan/max-min 會亂跳），所以低彩度時
   權重整個淡出，不然灰牆、白紙上會冒出隨機的色斑。                        */
export type HslBand = { h: number; s: number; l: number };
export type HslAdjust = HslBand[];

export const HSL_BANDS = [
  { id: 'red', label: '紅', hue: 0, swatch: '#ff3b30' },
  { id: 'orange', label: '橙', hue: 30, swatch: '#ff9500' },
  { id: 'yellow', label: '黃', hue: 60, swatch: '#ffd60a' },
  { id: 'green', label: '綠', hue: 120, swatch: '#34c759' },
  { id: 'aqua', label: '青', hue: 180, swatch: '#32ade6' },
  { id: 'blue', label: '藍', hue: 240, swatch: '#0a84ff' },
  { id: 'purple', label: '紫', hue: 270, swatch: '#af52de' },
  { id: 'magenta', label: '洋紅', hue: 300, swatch: '#ff2d70' },
] as const;

/* 三根滑桿推到底時各自最多能動多少。刻意做得保守 ——
   HSL 只要一過頭就會出現色塊與斷階，寧可讓使用者多推一點。 */
/** 色相滑桿推到底時，色相最多轉幾度 */
const HSL_MAX_HUE_SHIFT = 15;
/** 飽和度滑桿推到底時，彩度最多乘／除多少 */
const HSL_MAX_SAT = 0.5;
/** 明度滑桿推到底時，最多往黑或白靠多少 */
const HSL_MAX_LUM = 0.1;
const HSL_CENTERS = Float32Array.from(HSL_BANDS.map(b => b.hue));
const HSL_SLIDERS = [
  { key: 'h' as const, label: '色相' },
  { key: 's' as const, label: '飽和度' },
  { key: 'l' as const, label: '明度' },
];

export const DEFAULT_HSL: HslAdjust = HSL_BANDS.map(() => ({ h: 0, s: 0, l: 0 }));

export const isHslIdentity = (x: HslAdjust | undefined): boolean =>
  !x || x.every(b => b.h === 0 && b.s === 0 && b.l === 0);

const DEFAULT_CURVES: Curves = {
  rgb: [{x:0,y:0}, {x:255,y:255}],
  r: [{x:0,y:0}, {x:255,y:255}],
  g: [{x:0,y:0}, {x:255,y:255}],
  b: [{x:0,y:0}, {x:255,y:255}]
};

/** 曲線與 HSL 的變更簽章。兩者都不是單一數字，快取要靠這個字串判斷有沒有變 */
export const toneSig = (p: EditorParams): string =>
  `${p.whites || 0},${p.blacks || 0}#` + JSON.stringify(p.curves) + '#' + JSON.stringify(p.hsl ?? DEFAULT_HSL) + '#' + (isGradeIdentity(p.grade) ? '' : JSON.stringify(p.grade));

export const DEFAULT_PARAMS: EditorParams = {
  brightness: 0,
  exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0,
  temp: 0, tint: 0, sat: 0, vib: 0,
  sharpen: 0, grain: 0, soft: 0, softThreshold: 80,
  softRadius: 100, softColor: 0, lutAmount: 100,
  vignette: 0, blur: 0, colorNoise: 0, colorNoise2: 0,
  leakOpacity: 0, leakAngle: 45, leakHue: 15,
  fringeIntensity: 0, fringeHue: 8, fringeSize: 10, fringeFeather: 100,
  curves: JSON.parse(JSON.stringify(DEFAULT_CURVES)),
  hsl: JSON.parse(JSON.stringify(DEFAULT_HSL)),
  grade: freshGrade(),
  maskExposure: 0,
  maskBrightness: 0,
  maskContrast: 0,
  maskHighlights: 0,
  maskWhites: 0,
  maskBlacks: 0,
  maskShadows: 0,
  maskTemp: 0,
  maskTint: 0,
  maskSat: 0,
  maskVib: 0,
  maskCreated: false,
  maskCx: 0.5,
  maskCy: 0.5,
  maskAngle: 0,
  maskD: 0.25,
  maskShowOverlay: true,
  ...FX_DEFAULTS,
};

type Category = 'filter' | 'adjust' | 'effects' | 'leak' | 'soft' | 'grain' | 'halation' | 'mask' | 'compose' | 'fx'
  | 'template' | 'beauty' | 'match';
/** 自己整頁接管的分頁（美顏、仿色直接用那兩個工具本身） */
const STUDIO_CATS: Category[] = ['beauty', 'match'];
/** 已經在這一頁時再點一次不做事的分頁（舊的幾頁照舊：再點一次會回到該頁第一個工具） */
const SELF_CONTAINED_TABS = ['template', 'beauty', 'match', 'compose'];
type MaskDragType = 'center' | 'start' | 'end' | 'rotate' | 'create' | 'rcreate' | 'rcenter' | 'rx' | 'ry' | 'rrot' | 'paint' | 'sample' | 'pinch';
type CurveChannel = 'rgb' | 'r' | 'g' | 'b';
type LegacyKind = 'soft' | 'halation' | 'leak' | 'blur' | 'simple';

interface ToolDef {
  id: string; 
  label: string;
  icon: string;
  min: number;
  max: number;
  step?: number;
}

const MASK_TOOLS: ToolDef[] = [
  { id: 'maskBrightness', label: '亮度', icon: 'light_mode', min: -100, max: 100 },
  { id: 'maskExposure', label: '曝光', icon: 'brightness_6', min: -100, max: 100 },
  { id: 'maskContrast', label: '對比', icon: 'contrast', min: -100, max: 100 },
  { id: 'maskHighlights', label: '高光', icon: 'tone_highlights', min: -100, max: 100 },
  { id: 'maskShadows', label: '陰影', icon: 'tone_shadows', min: -100, max: 100 },
  { id: 'maskWhites', label: '白色', icon: 'tone_whites', min: -100, max: 100 },
  { id: 'maskBlacks', label: '黑色', icon: 'tone_blacks', min: -100, max: 100 },
  { id: 'maskTemp', label: '色溫', icon: 'device_thermostat', min: -100, max: 100 },
  { id: 'maskTint', label: '色調', icon: 'colorize', min: -100, max: 100 },
  { id: 'maskSat', label: '飽和度', icon: 'palette', min: -100, max: 100 },
  { id: 'maskVib', label: '自然飽和度', icon: 'color_lens', min: -100, max: 100 },
];

/** 五種遮色片（新增時選的那一排）與各自的參數工具（滑桿跟調整用同一根） */
const MASK_TYPES: [MaskType, string][] = [['linear', '線性漸層'], ['radial', '放射漸層'], ['brush', '筆刷'], ['color', '顏色範圍'], ['luma', '明度範圍']];
const MASK_TYPE_TOOLS: Record<MaskType, ToolDef[]> = {
  linear: [],
  radial: [{ id: 'maskFeather', label: '羽化', icon: 'feather', min: 0, max: 100 }],
  brush: [
    { id: 'maskBrushSize', label: '大小', icon: 'size', min: 1, max: 100 },
    { id: 'maskBrushFeather', label: '羽化', icon: 'feather', min: 0, max: 100 },
    { id: 'maskBrushFlow', label: '濃度', icon: 'flow', min: 1, max: 100 },
  ],
  color: [{ id: 'maskColorRange', label: '範圍', icon: 'range', min: 0, max: 100 }, { id: 'maskColorSmooth', label: '柔化', icon: 'feather', min: 0, max: 100 }],
  luma: [
    { id: 'maskLumLo', label: '下限', icon: 'lumlo', min: 0, max: 100 },
    { id: 'maskLumHi', label: '上限', icon: 'lumhi', min: 0, max: 100 },
    { id: 'maskLumSmooth', label: '平滑', icon: 'feather', min: 0, max: 100 },
  ],
};
const MASK_TYPE_TOOL_LIST = Object.values(MASK_TYPE_TOOLS).flat();

/** 遮色片的九個調整套在一段 RGBA 像素上（跟全圖的調節同一套公式：utils/photoToneMath）。
    整張圖（CPU）跟烤 GPU 查色表（33³ 個格點）都用這一支，兩邊的顏色一模一樣。 */
const MASK_TONE8 = new Float32Array(256);
/* 寫回 8 位元前加 ±0.375 階的固定抖動（跟 photoPixelCore 同一種）：遮色片把對比、曝光拉大時，
   平滑的天空、牆面不會出現一圈一圈的色階。表是固定的，同一張圖每次算出來都一樣。 */
const MASK_DITHER = Float32Array.from({ length: 4096 }, (_, i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return (x - Math.floor(x) - 0.5) * 0.75; });
function maskTonePixels(data: Uint8ClampedArray, m: MaskSnap) {
  const len = data.length;
  const stage = makeToneStage({ exposure: m.maskExposure, brightness: m.maskBrightness, contrast: m.maskContrast,
    shadows: m.maskShadows, highlights: m.maskHighlights, whites: m.maskWhites || 0, blacks: m.maskBlacks || 0, temp: m.maskTemp, tint: m.maskTint, sat: m.maskSat });
  const vibVal = (m.maskVib * 0.5 * 2.5) / 100;
  const hasVib = vibVal !== 0, satK = stage.sat;
  const c3 = new Float32Array(3);
  // 只有曝光（線性光裡乘一個倍率）時三個色版各自獨立，可以用一張 256 格的表；
  // 色調曲線與高光肩部是保色相的（photoToneMath.hueTone），要整個顏色一起算。
  if (!stage.wb && satK === 1 && !hasVib && !stage.tone && stage.peak <= 1) {
    const t8 = MASK_TONE8;
    for (let i = 0; i < 256; i++) { applyToneStage(stage, i, i, i, c3); t8[i] = c3[0]; }
    for (let i = 0; i < len; i += 4) { const d = MASK_DITHER[(i >>> 2) & 4095]; data[i] = t8[data[i]] + d; data[i + 1] = t8[data[i + 1]] + d; data[i + 2] = t8[data[i + 2]] + d; }
    return;
  }
  const tone = makeToneFast(stage);
  for (let i = 0; i < len; i += 4) {
    tone(data[i], data[i + 1], data[i + 2], c3);
    if (satK !== 1) applySaturation(satK, c3);
    let r = c3[0], gg = c3[1], b = c3[2];
    if (hasVib) {
      const avg = (r + gg + b) * 0.33333;
      const b1 = vibranceGain(vibVal, r, gg, b);
      r = avg + (r - avg) * b1; gg = avg + (gg - avg) * b1; b = avg + (b - avg) * b1;
    }
    const d = MASK_DITHER[(i >>> 2) & 4095];
    data[i] = r + d; data[i + 1] = gg + d; data[i + 2] = b + d;
  }
}

/** 遮色片介面用的線條圖示（專案的 Material 圖示是子集，這幾顆自己畫）。
    畫法跟 Icon 的內嵌圖示一樣：SVG 只當「形狀」（遮罩），顏色用 currentColor 整塊填一次。
    直接用半透明的顏色畫線的話，線跟線交會、線跟實心塊重疊的地方會疊兩層變白；
    當遮罩用就只有一層，整顆圖示是均勻、不透明的線條。 */
const MASK_GLYPH_BODY: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  linear: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.5h16"/><path d="M4 14.5h16" stroke-dasharray="2 2.2"/>',
  radial: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" stroke-dasharray="2 2"/>',
  brush: '<path d="M14.5 4.5l5 5-7.5 7.5-5-5z"/><path d="M7 12.5c-2 0-3 1.5-3 3.2 0 1.6-.7 2.8-1.5 3.3 3.2.6 6.9-.3 7.5-3.5"/>',
  color: '<path d="M14.5 5.5l4 4-8.5 8.5H6v-4z"/><path d="M13 4l7 7"/><path d="M4 20l2-2"/>',
  luma: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="#fff" stroke="none"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .4 4.2 1M21.5 12s-3.5 6.5-9.5 6.5c-1.6 0-3-.4-4.2-1"/><path d="M4 20L20 4"/>',
  invert: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="#fff" stroke="none"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/><path d="M10 11v5M14 11v5"/>',
  feather: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8" stroke-dasharray="1.5 2.5"/>',
  size: '<circle cx="9" cy="15" r="4"/><circle cx="15.5" cy="8.5" r="2"/>',
  flow: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/>',
  erase: '<path d="M8.5 19.5h11"/><path d="M5 15.5l8.5-8.5 5 5-6.5 6.5H8z"/><path d="M9.5 11l5 5"/>',
  range: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  /* 下限／上限是一對：一條界線＋指向範圍那一側的箭頭（下限在底、往上；上限在頂、往下） */
  lumlo: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><path d="M4.5 12h15v5a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 17z" fill="#fff" stroke="none"/>',
  lumhi: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><path d="M4.5 12h15V7A2.5 2.5 0 0 0 17 4.5H7A2.5 2.5 0 0 0 4.5 7z" fill="#fff" stroke="none"/>',
  clearsamples: '<path d="M14.5 5.5l4 4-8.5 8.5H6v-4z"/><path d="M16 17l4 4M20 17l-4 4"/>',
  /* 收起／展開右邊那一欄 */
  fold: '<path d="M7 14.5l5-5 5 5"/>',
  unfold: '<path d="M7 9.5l5 5 5-5"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5"/>',
};
const MASK_GLYPH_URL: Record<string, string> = Object.fromEntries(Object.entries(MASK_GLYPH_BODY).map(([k, body]) => [k,
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`)}")`]));
/* 筆刷、顏色範圍用跟其他頁一樣的圖示：筆刷＝人像的「修容」，顏色範圍＝調節的「色調」 */
const MASK_GLYPH_ICON: Record<string, string> = { brush: 'brush', color: 'colorize' };
const MaskGlyph: React.FC<{ k: string; size?: number }> = ({ k, size = 18 }) => {
  if (MASK_GLYPH_ICON[k]) return <span aria-hidden className="inline-flex items-center justify-center shrink-0 leading-none" style={{ width: size, height: size, fontSize: size + 2 }}><Icon name={MASK_GLYPH_ICON[k]} className="!text-[1em] leading-none" /></span>;
  const url = MASK_GLYPH_URL[k];
  if (!url) return null;
  return <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size, backgroundColor: 'currentColor',
    WebkitMaskImage: url, maskImage: url, WebkitMaskSize: '100% 100%', maskSize: '100% 100%', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' }} />;
};

/** 共用「HSL 那個面板外框」的工具：同一個外框、同一個高度，彼此切換時圖片完全不動 */
const COLOUR_PANEL_TOOLS = ['hsl', 'grade'];
const isColourPanelTool = (id: string) => COLOUR_PANEL_TOOLS.includes(id);

const ADJUST_TOOLS: ToolDef[] = [
  { id: 'brightness', label: '亮度', icon: 'light_mode', min: -100, max: 100 },
  { id: 'exposure', label: '曝光', icon: 'brightness_6', min: -100, max: 100 },
  { id: 'contrast', label: '對比', icon: 'contrast', min: -100, max: 100 },
  { id: 'highlights', label: '高光', icon: 'tone_highlights', min: -100, max: 100 },
  { id: 'shadows', label: '陰影', icon: 'tone_shadows', min: -100, max: 100 },
  // Lightroom 的白色／黑色：調整最亮、最暗那一端（見 utils/photoToneMath 的 endPoints）
  { id: 'whites', label: '白色', icon: 'tone_whites', min: -100, max: 100 },
  { id: 'blacks', label: '黑色', icon: 'tone_blacks', min: -100, max: 100 },
  { id: 'temp', label: '色溫', icon: 'device_thermostat', min: -100, max: 100 },
  { id: 'tint', label: '色調', icon: 'colorize', min: -100, max: 100 },
  { id: 'sat', label: '飽和度', icon: 'palette', min: -100, max: 100 },
  { id: 'vib', label: '自然飽和度', icon: 'color_lens', min: -100, max: 100 },
  { id: 'curves', label: '曲線', icon: 'show_chart', min: 0, max: 0 }, // Curves tool
  // 不能再用 gradient —— 那是下面「遮色片」分頁在用的圖標，兩個長一樣會混淆
  { id: 'hsl', label: 'HSL', icon: 'invert_colors', min: 0, max: 0 },   // HSL tool
  // 色輪：Log／一級調色／HDR 三種（達芬奇的色輪調色板）
  { id: 'grade', label: '色輪', icon: 'grade_wheels', min: 0, max: 0 },
  /* 銳化本來在特效那一排，搬過來排最後。它底層還是 GLSL 那一層算的
     （params.fxSharpen），只是入口移到調節，圖標用空心三角形。 */
  { id: 'fxSharpen', label: '銳化', icon: 'change_history', min: 0, max: 100 },
];

const SOFT_LIGHT_TOOLS: ToolDef[] = [
  { id: 'soft', label: '強度', icon: 'blur_on', min: 0, max: 100 },
  { id: 'softThreshold', label: '範圍', icon: 'tonality', min: 0, max: 100, step: 1 },
  { id: 'softRadius', label: '擴散', icon: 'flare', min: 20, max: 100 },
  { id: 'softColor', label: '色相', icon: 'palette', min: 0, max: 100 },
];

const HALATION_TOOLS: ToolDef[] = [
  { id: 'fringeIntensity', label: '強度', icon: 'flare', min: 0, max: 100 },
  { id: 'fringeSize', label: '擴散', icon: 'blur_on', min: 0, max: 100 },
  { id: 'fringeFeather', label: '範圍', icon: 'tonality', min: 0, max: 100 },
  { id: 'fringeHue', label: '色相', icon: 'palette', min: 0, max: 360 },
];

const GRAIN_TOOLS: ToolDef[] = [
  { id: 'grain', label: '顆粒', icon: 'grain', min: 0, max: 100 },
  { id: 'colorNoise', label: '彩噪I', icon: 'texture', min: 0, max: 100 },
  { id: 'colorNoise2', label: '彩噪II', icon: 'texture', min: 0, max: 100 },
];

/* 特效的排列順序：
     先是原本就有的基本款（柔光→光暈→漏光→模糊→噪點→暗角→亮角），
     再依性質分組往後接：模糊動態 → 光學 → 復古質感 → 故障 → 圖形化。
   有多個參數的特效（含新加的）點下去會像柔光那樣展開自己的參數列。 */
/** 把所有特效都關掉的一組覆寫值 —— 算特效縮圖時用，讓每一格只有自己那一個效果 */
const NO_EFFECT_PARAMS: Record<string, number> = {
  soft: 0, fringeIntensity: 0, leakOpacity: 0, blur: 0, colorNoise: 0, colorNoise2: 0,
  grain: 0, vignette: 0,
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, 0])),
};

const EFFECT_TOOLS: ToolDef[] = orderEffectCards<ToolDef>([
  /* 這三顆的強度各自對應到自己的參數（見 EFFECT_AMOUNT），範圍就是 0～100 */
  { id: 'softLight', label: '柔光', icon: 'blur_on', min: 0, max: 100 },
  { id: 'halation', label: '光暈', icon: 'flare', min: 0, max: 100 },
  { id: 'lightLeak', label: '漏光', icon: 'leak_add', min: 0, max: 100 },
  { id: 'colorNoise', label: '噪點', icon: 'grain', min: 0, max: 100 },
  /* 朦朧（原本叫「模糊」）跟後面那一組模糊類排在一起 */
  { id: 'blur', label: '朦朧', icon: 'blur_linear', min: 0, max: 100 },
  /* 暗角搬到下面跟亮角放一起了（fxVignette），這裡不再放單滑桿那顆。
     舊作品裡的 params.vignette 仍然照樣算得出來，只是不再從介面調整。 */
  /* 銳化已經搬到「調節」的最後面了，這一排不再列它 */
  /* 與拼圖圖片編輯共用完整特效清單；銳化仍只在調節中。 */
  ...FX_DEFS.filter(d => d.id !== 'fxSharpen')
    .map(d => ({ id: d.id, label: d.label, icon: d.icon, min: 0, max: 100 })),
], item => item.id);

/* 特效卡片按下去之後，上面那根滑桿要調的是「這個特效的強度」。
   柔光／光暈／漏光的強度不是卡片 id 本身，各自對應到自己的參數 ——
   沒有對到的話那根滑桿的範圍會是 0～0，看起來就是「拖不動」。 */
const EFFECT_AMOUNT: Record<string, string> = {
  softLight: 'soft',
  halation: 'fringeIntensity',
  lightLeak: 'leakOpacity',
};
const effectAmountId = (id: string) => EFFECT_AMOUNT[id] || id;

/** 每一張特效卡片「自己的」參數鍵 —— 一次只能套一個，切到別顆時其餘的都要歸零 */
const EFFECT_OWN_KEYS: Record<string, string[]> = {
  softLight: ['soft'],
  halation: ['fringeIntensity'],
  lightLeak: ['leakOpacity'],
  colorNoise: ['colorNoise', 'grain', 'colorNoise2'],
  blur: ['blur'],
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, [d.id]])),
};

/** 現在畫面上還有沒有「還沒合併」的特效（合併過的參數是 0，所以自然不算） */
const hasLiveEffect = (p: any) => Object.keys(NO_EFFECT_PARAMS).some(k => (p?.[k] || 0) !== 0);

/* 發光類特效在原圖上算：定義見 utils/glowFx.ts */
/** 只留發光類、其餘（含所有顏色）都是預設：在原圖上算光用 */
const glowOnly = (p: EditorParams): EditorParams => ({
  ...DEFAULT_PARAMS, ...NO_EFFECT_PARAMS,
  ...pickGlow(p),
} as EditorParams);

/**
 * 特效牽涉到的「所有」參數鍵 —— 強度之外，連細項也算進來
 * （柔光的門檻／半徑／色調、光暈的色相／大小／羽化、漏光的角度／色相，
 *  以及每一個新特效自己那幾根）。
 *
 * 點一張特效卡片＝從頭來過：整組回到預設值，而不是只把強度歸位 ——
 * 以前只重設強度，上一次在細項面板裡調過的東西會留著，
 * 於是「同一顆特效點兩次」得到的結果不一樣。
 */
const EFFECT_ALL_KEYS: string[] = Array.from(new Set([
  ...Object.keys(NO_EFFECT_PARAMS),
  'softThreshold', 'softRadius', 'softColor',
  'leakAngle', 'leakHue',
  'fringeHue', 'fringeSize', 'fringeFeather',
  ...FX_DEFS.flatMap(d => d.params.map(p => p.id)),
]));

/** 把所有特效參數（含細項）整組打回預設值 */
const resetAllEffectParams = (base: any) => {
  const out = { ...base };
  for (const k of EFFECT_ALL_KEYS) out[k] = (DEFAULT_PARAMS as any)[k] ?? 0;
  return out;
};

/** 卡片 → 它的細項面板是哪一個分頁（沒有的就是沒有細項可調） */
const EFFECT_DETAIL_CAT: Record<string, 'soft' | 'leak' | 'halation' | 'fx'> = {
  softLight: 'soft',
  lightLeak: 'leak',
  halation: 'halation',
};

/** 任何一個 fx 鍵 → 它屬於哪個特效（強度鍵本身也對應到自己） */
const FX_OWNER: Record<string, FxDef> = (() => {
  const m: Record<string, FxDef> = {};
  for (const d of FX_DEFS) {
    m[d.id] = d;
    for (const p of d.params) m[p.id] = d;
  }
  return m;
})();

/** 新特效自己的參數列（強度 + 細項），對應 FX_DEFS */
const FX_TOOLS: Record<string, ToolDef[]> = Object.fromEntries(
  FX_DEFS.map(d => {
    // 設了 rootParam 的特效沒有「強度」（固定 100）：第一根改成它的那個參數。
    const root = d.rootParam ? d.params.find(x => x.id === d.rootParam) : null;
    return [d.id, [
    root ? { id: root.id, label: d.rootLabel ?? root.label, icon: effectDetailIcon(root.label, root.icon), min: root.min, max: root.max, step: root.step }
      : { id: d.id, label: '強度', icon: effectDetailIcon('強度', d.icon), min: 0, max: 100 },
    // hidden 的那幾根不給調整（值永遠是預設），介面上就不要出現
    ...d.params.filter(p => !p.hidden)
      .map(p => ({ id: p.id, label: p.label, icon: effectDetailIcon(p.label, p.icon), min: p.min, max: p.max, step: p.step })),
  ] as ToolDef[]];
  }),
);

/** 最外層那根滑桿要改調哪一個參數（沒設就是調「強度」）。
    來源是 FX_DEFS 的 rootParam，跟拼圖那邊讀同一份定義。 */
const FX_ROOT_PARAM: Record<string, ToolDef> = Object.fromEntries(
  FX_DEFS.filter(d => d.rootParam).map(d => {
    const p = d.params.find(x => x.id === d.rootParam)!;
    return [d.id, { id: p.id, label: d.rootLabel ?? p.label, icon: effectDetailIcon(p.label, p.icon), min: p.min, max: p.max, step: p.step } as ToolDef];
  }),
);

const LEAK_TOOLS: ToolDef[] = [
  { id: 'leakOpacity', label: '強度', icon: 'opacity', min: 0, max: 100 },
  { id: 'leakAngle', label: '角度', icon: 'rotate_right', min: 0, max: 360 },
  { id: 'leakHue', label: '色相', icon: 'palette', min: 0, max: 360 },
];

// ... (helpers remain same)
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b;
  if (s === 0) {
      r = g = b = l; 
  } else {
      const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
  }
  return [(r * 255 + 0.5) | 0, (g * 255 + 0.5) | 0, (b * 255 + 0.5) | 0];
}

// ... (getSplineY, generateCurveLut, boxBlurH, boxBlurV, fastBlur, precomputeSharpenDetail, generateNoisePattern - no changes)
// --- CURVE SPLINE MATH ---
function getSplineY(x: number, points: Point[]): number {
    const pts = [...points].sort((a,b)=>a.x-b.x);
    const n = pts.length;
    if (n === 2) {
        if (x <= pts[0].x) return pts[0].y;
        if (x >= pts[1].x) return pts[1].y;
        return pts[0].y + (x-pts[0].x)/(pts[1].x-pts[0].x)*(pts[1].y-pts[0].y);
    }
    const dx = [], ms = [], c1s = [];
    for(let i=0; i<n-1; i++) { 
        dx[i] = pts[i+1].x - pts[i].x; 
        ms[i] = (pts[i+1].y - pts[i].y) / dx[i]; 
    }
    c1s[0] = ms[0]; 
    for(let i=0; i<n-2; i++) {
        const m = ms[i], mNext = ms[i+1];
        if (m*mNext <= 0) {
            c1s.push(0);
        } else {
            c1s.push(3*(dx[i]+dx[i+1])/((dx[i]+2*dx[i+1])/m+(dx[i+1]+2*dx[i])/mNext));
        }
    }
    c1s.push(ms[ms.length-1]);
    
    if(x <= pts[0].x) return pts[0].y; 
    if(x >= pts[n-1].x) return pts[n-1].y;
    
    let k = 0; while(x > pts[k+1].x) k++;
    const t = (x - pts[k].x) / dx[k];
    const t2 = t*t;
    const t3 = t2*t;
    const h00 = 2*t3 - 3*t2 + 1;
    const h10 = t3 - 2*t2 + t;
    const h01 = -2*t3 + 3*t2;
    const h11 = t3 - t2;
    
    return pts[k].y * h00 + dx[k] * c1s[k] * h10 + pts[k+1].y * h01 + dx[k] * c1s[k+1] * h11;
}

export function generateCurveLut(channelPoints: Point[]): Uint8Array {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        lut[i] = Math.max(0, Math.min(255, Math.round(getSplineY(i, channelPoints))));
    }
    return lut;
}

// 60FPS Optimization: Pre-calculate Exposure, Contrast, and Brightness into a single 1D LUT
// Reuses the output buffer to prevent Garbage Collection stutter.
// Shared, byte-identical colour maths can also run in a worker.
export { generateBaseCorrectionLut, processPixels } from '../utils/photoPixelCore';
import { generateBaseCorrectionLut, processPixels } from '../utils/photoPixelCore';
import { makeToneStage, applyToneStage, applySaturation, makeToneFast, vibranceGain } from '../utils/photoToneMath';
import { buildLocalBase, makeLocalGain, type LocalBase } from '../utils/localTone';
/* Cache keys name the photo by a short id, not by its source string: a
   data: URL is megabytes, and serialising it into a key on every slider step
   cost ~15ms per frame. */
const SRC_IDS = new Map<string, number>();
const srcIdOf = (src: string) => { let id = SRC_IDS.get(src); if (id === undefined) { id = SRC_IDS.size + 1; SRC_IDS.set(src, id); } return id; };
const IDENTITY_BASE_LUT = Uint8Array.from({ length: 256 }, (_, i) => i);
const IDENTITY_CURVE_LUTS = { rgb: IDENTITY_BASE_LUT, r: IDENTITY_BASE_LUT, g: IDENTITY_BASE_LUT, b: IDENTITY_BASE_LUT };

function boxBlurH(s: Uint8ClampedArray, d: Uint8ClampedArray, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let i = 0; i < h; i++) {
    let ti = i * w, li = ti, ri = ti + r;
    let fvR = s[ti * 4], fvG = s[ti * 4 + 1], fvB = s[ti * 4 + 2], fvA = s[ti * 4 + 3];
    let lvR = s[(ti + w - 1) * 4], lvG = s[(ti + w - 1) * 4 + 1], lvB = s[(ti + w - 1) * 4 + 2], lvA = s[(ti + w - 1) * 4 + 3];
    let vR = (r + 1) * fvR, vG = (r + 1) * fvG, vB = (r + 1) * fvB, vA = (r + 1) * fvA;
    for (let j = 0; j < r; j++) { vR += s[(ti + j) * 4]; vG += s[(ti + j) * 4 + 1]; vB += s[(ti + j) * 4 + 2]; vA += s[(ti + j) * 4 + 3]; }
    for (let j = 0; j <= r; j++) {
      vR += s[ri * 4] - fvR; vG += s[ri * 4 + 1] - fvG; vB += s[ri * 4 + 2] - fvB; vA += s[ri * 4 + 3] - fvA;
      d[ti * 4] = vR * iarr; d[ti * 4 + 1] = vG * iarr; d[ti * 4 + 2] = vB * iarr; d[ti * 4 + 3] = vA * iarr;
      ri++; ti++;
    }
    for (let j = r + 1; j < w - r; j++) {
      vR += s[ri * 4] - s[li * 4]; vG += s[ri * 4 + 1] - s[li * 4 + 1]; vB += s[ri * 4 + 2] - s[li * 4 + 2]; vA += s[ri * 4 + 3] - s[li * 4 + 3];
      d[ti * 4] = vR * iarr; d[ti * 4 + 1] = vG * iarr; d[ti * 4 + 2] = vB * iarr; d[ti * 4 + 3] = vA * iarr;
      ri++; li++; ti++;
    }
    for (let j = w - r; j < w; j++) {
      vR += lvR - s[li * 4]; vG += lvG - s[li * 4 + 1]; vB += lvB - s[li * 4 + 2]; vA += lvA - s[li * 4 + 3];
      d[ti * 4] = vR * iarr; d[ti * 4 + 1] = vG * iarr; d[ti * 4 + 2] = vB * iarr; d[ti * 4 + 3] = vA * iarr;
      li++; ti++;
    }
  }
}

function boxBlurV(s: Uint8ClampedArray, d: Uint8ClampedArray, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let i = 0; i < w; i++) {
    let ti = i, li = ti, ri = ti + r * w;
    let fvR = s[ti * 4], fvG = s[ti * 4 + 1], fvB = s[ti * 4 + 2], fvA = s[ti * 4 + 3];
    let lvR = s[(ti + (h - 1) * w) * 4], lvG = s[(ti + (h - 1) * w) * 4 + 1], lvB = s[(ti + (h - 1) * w) * 4 + 2], lvA = s[(ti + (h - 1) * w) * 4 + 3];
    let vR = (r + 1) * fvR, vG = (r + 1) * fvG, vB = (r + 1) * fvB, vA = (r + 1) * fvA;
    for (let j = 0; j < r; j++) { vR += s[(ti + j * w) * 4]; vG += s[(ti + j * w) * 4 + 1]; vB += s[(ti + j * w) * 4 + 2]; vA += s[(ti + j * w) * 4 + 3]; }
    for (let j = 0; j <= r; j++) {
      vR += s[ri * 4] - fvR; vG += s[ri * 4 + 1] - fvG; vB += s[ri * 4 + 2] - fvB; vA += s[ri * 4 + 3] - fvA;
      d[ti * 4] = vR * iarr; d[ti * 4 + 1] = vG * iarr; d[ti * 4 + 2] = vB * iarr; d[ti * 4 + 3] = vA * iarr;
      ri += w; ti += w;
    }
    for (let j = r + 1; j < h - r; j++) {
      vR += s[ri * 4] - s[li * 4]; vG += s[ri * 4 + 1] - s[li * 4 + 1]; vB += s[ri * 4 + 2] - s[li * 4 + 2]; vA += s[ri * 4 + 3] - s[li * 4 + 3];
      d[ti * 4] = vR * iarr; d[ti * 4 + 1] = vG * iarr; d[ti * 4 + 2] = vB * iarr; d[ti * 4 + 3] = vA * iarr;
      ri += w; li += w; ti += w;
    }
    for (let j = h - r; j < h; j++) {
      vR += lvR - s[li * 4]; vG += lvG - s[li * 4 + 1]; vB += lvB - s[li * 4 + 2]; vA += lvA - s[li * 4 + 3];
      d[ti * 4] = vR * iarr; d[ti * 4 + 1] = vG * iarr; d[ti * 4 + 2] = vB * iarr; d[ti * 4 + 3] = vA * iarr;
      li += w; ti += w;
    }
  }
}

export function fastBlur(imageData: ImageData, width: number, height: number, radius: number, sharedBuffer: Uint8ClampedArray | null) {
  if (radius < 1) return imageData;
  const data = imageData.data;
  const res = (sharedBuffer && sharedBuffer.length >= data.length) ? sharedBuffer : new Uint8ClampedArray(data.length);
  const r = Math.floor(radius);
  for (let pass = 0; pass < 2; pass++) {
    boxBlurH(data, res, width, height, r);
    boxBlurV(res, data, width, height, r);
  }
  return imageData;
}

function precomputeSharpenDetail(sourceData: Uint8ClampedArray, w: number, h: number): Int8Array {
  const len = sourceData.length;
  const detail = new Int8Array(len);
  const stride = w * 4;
  
  for (let y = 1; y < h - 1; y++) {
    const rowOffset = y * stride;
    const upOffset = rowOffset - stride;
    const downOffset = rowOffset + stride;

    for (let x = 1; x < w - 1; x++) {
      const i = rowOffset + (x * 4);
      const left = i - 4; const right = i + 4;
      const up = upOffset + (x * 4);
      const down = downOffset + (x * 4);
      
      for (let c = 0; c < 3; c++) {
         const val = sourceData[i + c];
         const avg = (sourceData[up + c] + sourceData[down + c] + sourceData[left + c] + sourceData[right + c]) * 0.25;
         detail[i + c] = (val - avg) >> 1; // Fit perfectly into Int8
      }
    }
  }
  return detail;
}

const patternIds = new WeakMap<object, number>();
let nextPatternId = 1;
const patternIdOf = (c: HTMLCanvasElement | null) => { if (!c) return 0; let id = patternIds.get(c); if (!id) { id = nextPatternId++; patternIds.set(c, id); } return id; };
export function generateNoisePattern(type: 'grain' | 'color', size: number = 512): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;
    const len = data.length;
    
    for (let i = 0; i < len; i += 4) {
        if (type === 'grain') {
            const v = (Math.random() * 255) | 0;
            data[i] = v; data[i+1] = v; data[i+2] = v;
        } else {
            data[i] = (Math.random() * 255) | 0;
            data[i+1] = (Math.random() * 255) | 0;
            data[i+2] = (Math.random() * 255) | 0;
        }
        data[i+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

/**
 * 每一顆濾鏡點下去時的預設強度。
 *
 * 這件事本來是靠比對檔名決定的（url.includes('IMG_9026') 之類）。
 * 濾鏡檔改名成 f1…f23 之後那些比對就通通對不上，所有濾鏡都變成 100 ——
 * 看起來就是「每一顆都比以前濃」。改成直接用濾鏡 id 對照，
 * 以後換檔名、換圖床都不會再影響到強度。
 *
 * 沒列在這裡的就是 100。
 */
/* 這份表搬到 utils/photoFx 共用了 —— 拼圖那邊挑同一顆濾鏡要有同樣的濃淡。
   這裡沿用同一份（見檔頭的 import），行為一個字都沒有變。 */


// ... (ImageEditorProps and BufferSet interfaces remain same)
interface ImageEditorProps {
  /** 從歷史紀錄點開來的那一筆的 key。再記一次的時候沿用它＝更新同一筆 */
  histKey?: string | null;
  imageSrc: string;
  /** 批量編輯：這次匯入的所有照片。沒給或只有一張時，介面跟以前完全一樣。 */
  batchSrcs?: string[];
  /** 批量編輯裡按「新增」：再挑照片接進來 */
  onAddPhotos?: () => void;
  lutList: { id: string, name: string, url: string }[];
  onSave: (newSrc: string) => void;
  onCancel: (keepDraft?: boolean) => void;
  onHome?: () => void;
  onRequestExit?: () => Promise<ExitChoice>;
  onImportNew?: () => void;
  originalFile?: File | null;
  /** 接續上次時把存下來的參數餵回來（跳出應用再回來用的） */
  initialState?: { params?: EditorParams; geo?: GeoParams; selectedLutIdx?: number } | null;
  /** 只有主頁直接進入的獨立編輯器使用：縮短底部分頁列的空白，但保留完整圖標與文字。 */
  compactBottomBar?: boolean;
  /** 主頁進來的編輯：分類列可以左右滑，多了模板、人像、仿色、文字、圖形、符號、圖片 */
  fullTabs?: boolean;
}

interface HistoryItem {
  params: EditorParams;
  selectedLutIdx: number;
  /** 構圖是幾何操作，跟色彩參數分開存，撤銷時才不會只回復一半 */
  geo?: GeoParams;
  /** 這一步當下的來源圖清單。合併會把烤好的圖換成新來源，
      撤銷時要連來源一起換回去，不然只回復參數＝那一層永遠留在圖上。 */
  srcs?: string[];
  isSoftActive: boolean;
  isBlurActive: boolean;
  isGrainActive: boolean;
  isHalationActive: boolean;
  softManuallyAdjusted: boolean;
  blurManuallyAdjusted: boolean;
  grainManuallyAdjusted: boolean;
  halationManuallyAdjusted: boolean;
}

interface BufferSet {
    /** 交給顏色那一段的像素：沒有發光類特效時就是原圖；有的話是「原圖＋光」
        （見 syncGlowSource）。 */
    source: Uint8ClampedArray | null;
    /** 原圖本身（第一次需要時從 source 記下來） */
    original?: Uint8ClampedArray | null;
    /** source 目前是哪一組發光參數算出來的（'' ＝ 原圖） */
    glowKey?: string;
    dest: Uint8ClampedArray | null;
    shared: Uint8ClampedArray | null;
    lutted: Uint8ClampedArray | null;
    lut0: Uint8ClampedArray | null;
    lut100: Uint8ClampedArray | null;
    temp: Uint8ClampedArray | null;
    sharpenDetail: Int8Array | null;
    w: number;
    h: number;
}

interface FastSliderProps {
    value: number; min: number; max: number; step: number; 
    toolId: string; label: string; snapZero: boolean;
    onUpdate: (id: string, val: number) => void;
    onInteractStart: () => void;
    onInteractEnd: () => void;
    onReset: (e: any, id: string) => void;
    onValueClick?: (id: string) => void;
    disabled?: boolean;
    softActive?: boolean;
    onToggleSoft?: () => void;
    blurActive?: boolean;
    onToggleBlur?: () => void;
    grainActive?: boolean;
    onToggleGrain?: () => void;
    halationActive?: boolean;
    onToggleHalation?: () => void;
    maskShowOverlay?: boolean;
    onToggleMaskOverlay?: () => void;
    onClearMask?: () => void;
    isMaskCategory?: boolean;
    /** 遮色片還沒建立：按鈕照樣顯示，但不能按 */
    maskLocked?: boolean;
    /** 排得緊一點：HSL 一次要放三根，用原本的間距會把下面的工具列擠出畫面 */
    compact?: boolean;
    /** 有細項可以調的話，數值右邊會多一顆編輯鍵，按了展開那個特效的全部滑桿 */
    onEdit?: () => void;
    /** 更緊：特效細項一次要排到四排、而且兩根並排。
        除了字級與軌道高度再收一點，最重要的是左右不外擴 ——
        一般的滑桿刻意向外多長 32px 讓手指可以按到螢幕邊緣，
        兩根並排時那個外擴會互相重疊，中間就會按錯根。 */
    dense?: boolean;
}

const FastSlider = React.memo(({ 
    value, min, max, step, toolId, label, snapZero, 
    onUpdate, onInteractStart, onInteractEnd, onReset, onValueClick, disabled,
    softActive, onToggleSoft, blurActive, onToggleBlur, grainActive, onToggleGrain,
    halationActive, onToggleHalation, maskShowOverlay, onToggleMaskOverlay, onClearMask, isMaskCategory, maskLocked, compact, dense, onEdit
}: FastSliderProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const valueTextRef = useRef<HTMLSpanElement>(null);
    // Stored legacy threshold stays compatible with existing projects. The
    // user-facing range now means the brightest N percent, increasing right.
    const displayValue = effectControlValue(toolId,value);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.value = displayValue.toString();
        }
        if (valueTextRef.current) {
            valueTextRef.current.textContent = displayValue.toFixed(0);
        }
    }, [value, toolId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = parseFloat(e.target.value);
        if (snapZero && min < 0 && Math.abs(val) < 2) {
            val = 0;
            if (inputRef.current) {
                inputRef.current.value = "0";
            }
        }
        if (valueTextRef.current) {
            valueTextRef.current.textContent = val.toFixed(0);
        }
        onUpdate(toolId,effectStoredValue(toolId,val));
    };

    const isLutAmount = toolId === 'lutAmount';

    return (
        <div className={`w-full ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className={`flex justify-between items-center cursor-pointer select-none ${compact ? 'leading-none' : 'mb-1 translate-y-2'}`} onDoubleClick={(e) => onReset(e, toolId)} title="雙擊重置">
                {isLutAmount ? (
                    <>
                        {/* 這裡本來是柔光／朦朧／光暈／噪點四顆特效鈕。
                            它們動到的是跟「特效」分頁同一組參數，兩邊互相牽動很容易搞混，
                            所以整組拿掉了 —— 特效一律從特效分頁開。
                            左上角改成跟其他滑桿一致的標題文字。 */}
                        <span className="font-black text-white/40 uppercase pointer-events-none text-[10px] tracking-[0.2em]">強度</span>
                        <span 
                            ref={valueTextRef}
                            className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2.5 py-0.5 rounded active:bg-white/20 transition-colors cursor-pointer select-none"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onValueClick) onValueClick(toolId);
                                else onReset(e, toolId);
                            }}
                            onTouchEnd={(e) => {
                                e.stopPropagation();
                                if (onValueClick) onValueClick(toolId);
                            }}
                        >
                            {displayValue.toFixed(0)}
                        </span>
                    </>
                ) : isMaskCategory ? (
                    <>
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[calc(100%-3.5rem)] py-1">
                            {onToggleMaskOverlay && (
                                <button 
                                    disabled={maskLocked}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (maskLocked) return;
                                        onToggleMaskOverlay();
                                        e.currentTarget.blur();
                                    }}
                                    className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors border shrink-0 ${maskLocked ? 'opacity-30' : ''} ${
                                        maskShowOverlay 
                                            ? 'bg-white text-black border-white shadow-lg font-black' 
                                            : 'bg-white/5 text-white/40 border-white/10 hover:text-white/60 hover:border-white/25'
                                    }`}
                                >
                                    <Icon name="visibility" className="text-[10px] shrink-0" fill={maskShowOverlay} />
                                    <span>顯示遮罩</span>
                                </button>
                            )}
                            {onToggleMaskOverlay && onClearMask && (
                                <button 
                                    disabled={maskLocked}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (maskLocked) return;
                                        onClearMask();
                                        e.currentTarget.blur();
                                    }}
                                    className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors border shrink-0 bg-white/5 text-red-400 border-white/10 hover:bg-red-500 hover:text-white hover:border-red-500 ${maskLocked ? 'opacity-30' : ''}`}
                                >
                                    <Icon name="delete" className="text-[10px] shrink-0" />
                                    <span>清除遮色片</span>
                                </button>
                            )}
                        </div>
                        <span 
                            ref={valueTextRef}
                            className="text-xs font-sans tabular-nums font-bold bg-white/10 px-2.5 py-0.5 rounded active:bg-white/20 transition-colors cursor-pointer select-none"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onValueClick) onValueClick(toolId);
                                else onReset(e, toolId);
                            }}
                            onTouchEnd={(e) => {
                                e.stopPropagation();
                                if (onValueClick) onValueClick(toolId);
                            }}
                        >
                            {displayValue.toFixed(0)}
                        </span>
                    </>
                ) : (
                    <>
                        <span className={`font-black text-white/40 uppercase pointer-events-none ${dense ? 'text-[9px] tracking-[0.12em] truncate' : 'text-[10px] tracking-[0.2em]'}`}>{label}</span>
                        {/* 數值與編輯鍵一起靠右，才不會被 justify-between 拆到三個地方 */}
                        <span className="shrink-0 flex items-center gap-2">
                            <span 
                                ref={valueTextRef}
                                className={`font-sans tabular-nums font-bold bg-white/10 rounded active:bg-white/20 transition-colors ${dense ? 'text-[10px] leading-none px-1.5 py-[4px]' : 'text-xs px-2 py-0.5'}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onValueClick) onValueClick(toolId);
                                    else onReset(e, toolId); // Fallback to onReset if onValueClick not provided
                                }}
                                onTouchEnd={(e) => {
                                    e.stopPropagation();
                                    if (onValueClick) onValueClick(toolId);
                                }}
                            >
                                {displayValue.toFixed(0)}
                            </span>
                            {onEdit && (
                                <button
                                    aria-label="調整細項"
                                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                    className="shrink-0 w-7 h-7 -my-1 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 transition-[background-color,transform] text-white/80"
                                >
                                    <Icon name="edit" className="text-[15px]" />
                                </button>
                            )}
                        </span>
                    </>
                )}
            </div>

            <div style={dense ? {touchAction:'none'} : undefined} className={`slider-wrap relative flex items-center justify-center touch-none ${dense ? 'h-[26px]' : compact ? 'h-[30px]' : 'h-12'}`}>
                <input 
                    ref={inputRef}
                    type="range" aria-label={label} min={effectControlMin(toolId,min)} max={max} step={effectControlStep(toolId,step)}
                    data-smooth-range={isContinuousEffectControl(toolId)?'true':undefined}
                    defaultValue={displayValue}
                    data-fine-drag={dense ? 'true' : undefined}
                    style={dense ? {left:0,width:'100%',height:26,margin:'-13px 0 0',touchAction:'none','--thumb-w':'18px'} as React.CSSProperties : undefined}
                    disabled={disabled}
                    onChange={handleChange}
                    onPointerDown={onInteractStart}
                    onPointerUp={onInteractEnd}
                    onPointerCancel={onInteractEnd}
                    onKeyDown={onInteractStart}
                    onKeyUp={onInteractEnd}
                    className={dense ? 'custom-range dense' : compact ? 'custom-range compact' : 'custom-range'}
                />
            </div>
        </div>
    );
});

const formatExifDate = (rawDateStr: string): string => {
  if (!rawDateStr || rawDateStr === '未知' || rawDateStr === '-') return '-';
  // Standard EXIF date format is YYYY:MM:DD HH:MM:SS or similar
  const regex = /^(\d{4})[-:](\d{2})[-:](\d{2})\s+(\d{2}):(\d{2})/;
  const match = rawDateStr.trim().match(regex);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const minute = match[5];
    
    let period = '';
    let displayHour = hour;
    if (hour === 0) {
      period = '凌晨';
      displayHour = 12;
    } else if (hour < 5) {
      period = '凌晨';
      displayHour = hour;
    } else if (hour < 8) {
      period = '早上';
      displayHour = hour;
    } else if (hour < 11) {
      period = '上午';
      displayHour = hour;
    } else if (hour < 13) {
      period = '中午';
      displayHour = hour;
    } else if (hour < 18) {
      period = '下午';
      displayHour = hour - 12;
    } else {
      period = '晚上';
      displayHour = hour - 12;
    }
    
    return `${year}年${month}月${day}日 ${period}${displayHour}:${minute}`;
  }
  
  try {
    const date = new Date(rawDateStr.replace(/:/g, (match, offset) => offset < 10 ? '-' : ':'));
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hour = date.getHours();
      const minute = String(date.getMinutes()).padStart(2, '0');
      
      let period = '';
      let displayHour = hour;
      if (hour === 0) {
        period = '凌晨';
        displayHour = 12;
      } else if (hour < 5) {
        period = '凌晨';
        displayHour = hour;
      } else if (hour < 8) {
        period = '早上';
        displayHour = hour;
      } else if (hour < 11) {
        period = '上午';
        displayHour = hour;
      } else if (hour < 13) {
        period = '中午';
        displayHour = hour;
      } else if (hour < 18) {
        period = '下午';
        displayHour = hour - 12;
      } else {
        period = '晚上';
        displayHour = hour - 12;
      }
      return `${year}年${month}月${day}日 ${period}${displayHour}:${minute}`;
    }
  } catch (e) {}

  return rawDateStr;
};

/**
 * 濾鏡解好的立方體資料，以及正在下載中的那幾顆。
 *
 * 一定要放在模組層、不能放在元件的 useRef 裡：編輯器每次開關都是一個新的元件實體，
 * 放在裡面等於「每進一次編輯器就把 24 顆濾鏡重新下載＋重新解一次」。
 * 內容只跟濾鏡檔本身有關，跟哪一張照片、哪一次編輯都無關，所以整個 App 共用一份就好。
 */
const LUT_CACHE: Record<string, { data: Uint8ClampedArray; size: number }> = {};
const LUT_LOADING: Record<string, Promise<void>> = {};
/** 真的還在下載／解碼中的濾鏡（失敗或完成就拿掉）：重畫只在這段期間等它 */
const LUT_IN_FLIGHT = new Set<string>();

/* ---- 按鈕縮圖 -------------------------------------------------------------
   縮圖不走 data URL，直接把畫布畫到畫布上：
     - 少一次 PNG 編碼（量到 25 張 128×152 要 22ms）
     - 更重要的是少一次解碼 —— <img> 換 src 之後要等瀏覽器把新圖解好才會換上去，
       中間那一下就是「縮圖突然抖一下」。畫布是同一個節點改內容，不會有這個空檔。
   省下來的成本全部拿去提高解析度。                                          */

/** 縮圖的倍率：跟著螢幕的實際像素密度走，最多 3 倍（手機幾乎都是 2 或 3） */
const THUMB_DPR = (() => {
  const d = typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2;
  return Math.min(3, Math.max(2, Math.round(d)));
})();

/** sig：這一格是照哪一組條件算出來的，一樣就不用重算 */
type ThumbEntry = { cvs: HTMLCanvasElement; pixels?: ImageData; v: number; sig: string; pending?: number };
type ThumbStore = React.MutableRefObject<Record<string, ThumbEntry>>;

/** 把一張算好的縮圖收進倉庫（重複使用同一張畫布，不要一直生新的） */
function putThumb(store: ThumbStore, id: string, src: HTMLCanvasElement, sig = ''): void {
  if (!src.width || !src.height) return;
  let e = store.current[id];
  if (!e) e = store.current[id] = { cvs: document.createElement('canvas'), v: 0, sig: '' };
  const c = e.cvs;
  if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
  const sx = src.getContext('2d', { willReadFrequently: true });
  if (!sx) return;
  /* WebKit 偶爾會在兩張 GPU Canvas 用 drawImage 互拷時，先提交一部分紋理；
     使用者看到的就是縮圖半邊已套濾鏡、半邊仍是奇怪顏色。先讀成一張完整的
     CPU ImageData，再以單次 putImageData 發布，顯示端永遠只會拿到完整一幀。 */
  let frame: ImageData;
  try { frame = sx.getImageData(0, 0, src.width, src.height); }
  catch { return; }
  c.getContext('2d')!.putImageData(frame, 0, 0);
  e.pending = (e.pending || 0) + 1;   // 晚到的非同步快照不能蓋掉這一張
  /* 像素與備援畫布都完整寫完後才發布版本。 */
  e.sig = sig;
  e.v++;
}

/**
 * 同 putThumb，但不做同步回讀：特效縮圖是 GPU 畫出來的，getImageData 會讓主執行緒
 * 等 GPU 把它畫完、再整塊搬回 CPU（一格一次，整排 20 幾次）—— 切到特效頁那一下的卡頓
 * 大半就是這個。createImageBitmap 是同一瞬間的完整快照（之後 src 被下一格覆蓋也不影響），
 * 非同步交付，交付後一次蓋進倉庫的畫布，所以顯示端一樣只會拿到完整的一幀。
 */
function putThumbAsync(store: ThumbStore, id: string, src: HTMLCanvasElement, onReady: () => void, sig = ''): void {
  if (!src.width || !src.height) return;
  if (typeof createImageBitmap !== 'function') { putThumb(store, id, src, sig); onReady(); return; }
  let e = store.current[id];
  if (!e) e = store.current[id] = { cvs: document.createElement('canvas'), v: 0, sig: '' };
  const entry = e, token = (entry.pending = (entry.pending || 0) + 1);
  createImageBitmap(src).then(bmp => {
    if (entry.pending !== token || store.current[id] !== entry) { bmp.close(); return; }
    const c = entry.cvs;
    if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
    const g = c.getContext('2d')!;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy';
    g.drawImage(bmp, 0, 0); g.restore(); bmp.close();
    entry.pixels = undefined; entry.sig = sig; entry.v++;
    onReady();
  }).catch(() => { if (entry.pending === token) { putThumb(store, id, src); onReady(); } });
}

/** 已經掛在畫面上的縮圖格子，算好一張就直接叫它們自己重畫 */
type ThumbPainters = React.MutableRefObject<Set<() => void>>;

/**
 * 卡片上的那一格縮圖。自己從倉庫把畫布畫過來 ——
 * 離開分頁再回來時這個節點會重建（內容是空的），這裡負責補畫回去。
 * 還沒算到自己那一格就先畫 fallback（濾鏡是「原始」、特效是沒套特效的底圖），
 * 整排才不會有空洞。
 *
 * 刻意不走 React state：縮圖是畫布，內容換了不需要重新 render。
 * 之前每送一批就 setState 一次，等於把整個編輯器重畫十幾遍，
 * 光是那些重畫就佔掉整輪的三分之二（量到特效整排 2292ms → 改成直接畫之後 780ms）。
 */
const ThumbCanvas = React.memo<{
  store: ThumbStore; id: string; fallbackId?: string; painters: ThumbPainters; attr: string; name: string;
}>(({ store, id, fallbackId, painters, attr, name }) => {
  const host = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLCanvasElement | null>(null);
  const drawn = useRef('');
  /* 倉庫裡那張畫布本身就掛上來（搬節點，不複製像素）—— 跟創意拼圖的卡片同一招。
     以前每次進分頁都新建 20 幾張畫布、配置 GPU 記憶體再 putImageData 一整張，
     切到「濾鏡」「特效」那一下的延遲主要就是這個。
     還沒算到自己那一格時頂著的 fallback（大家共用同一張）才複製一份。 */
  const paint = useCallback(() => {
    const h = host.current;
    if (!h) return;
    const own = store.current[id];
    const e = own || (fallbackId ? store.current[fallbackId] : undefined);
    // 兩份都還沒有時清掉舊照片，不能把上一張／上一顆濾鏡的殘片冒充新縮圖。
    if (!e) { h.replaceChildren(); drawn.current = ''; return; }
    const key = `${own ? id : fallbackId}#${e.v}`;
    if (drawn.current === key && h.firstChild) return;      // 沒換內容就不要重畫
    drawn.current = key;
    let shown: HTMLCanvasElement;
    if (own && (!e.cvs.parentElement || e.cvs.parentElement === h)) shown = e.cvs;
    else {
      const c = (copy.current ||= document.createElement('canvas'));
      if (c.width !== e.cvs.width || c.height !== e.cvs.height) { c.width = e.cvs.width; c.height = e.cvs.height; }
      /* 一定要整張蓋掉（copy）：新的縮圖只要有一塊不是完全不透明，上一張的內容
         就會從那裡透出來，看起來就是「縮圖有一部分怪怪的」。 */
      const cx = c.getContext('2d')!;
      cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalAlpha = 1; cx.filter = 'none'; cx.globalCompositeOperation = 'copy';
      cx.drawImage(e.cvs, 0, 0); cx.restore();
      shown = c;
    }
    shown.setAttribute(attr, name);
    shown.dataset.thumbReady = own ? '1' : '0';
    shown.className = 'absolute inset-0 w-full h-full object-cover';
    if (h.firstChild !== shown) h.replaceChildren(shown);
  }, [store, id, fallbackId, attr, name]);
  /* useLayoutEffect：卡片是每次進頁才掛上來的，排在 useEffect 的話
     瀏覽器會先畫一幀空白，下一幀才補上圖 —— 那就是「一進特效頁閃一下」。 */
  useLayoutEffect(() => {
    const set = painters.current;
    set.add(paint);
    paint();                                 // 剛掛上來（或換照片）先補畫一次
    const h = host.current;
    // 卸下時把倉庫的畫布還回去（拿下來），下一次進分頁才能直接再掛上
    return () => { set.delete(paint); drawn.current = ''; h?.replaceChildren(); };
  }, [painters, paint]);
  return <div ref={host} className="absolute inset-0" />;
});

/** 等這一幀畫出來之後才開始（再加 delay）：切分頁時先讓新分頁出現，縮圖再慢慢補。
 *  回傳取消函式。 */
function afterPaint(fn: () => void, delay = 0): () => void {
  let t = 0, dead = false;
  const r = requestAnimationFrame(() => { if (!dead) t = window.setTimeout(fn, delay); });
  return () => { dead = true; cancelAnimationFrame(r); window.clearTimeout(t); };
}

/**
 * 一格一格把縮圖算出來，每做滿約 14ms 就讓瀏覽器喘一口氣，整排算完才呼叫 done。
 * make 回傳 false 代表這一格這輪先跳過（例如濾鏡檔還沒下載完）。
 * emit 是「把已經算好的貼上畫面」，一批做完就叫一次（很便宜，只是幾個 drawImage）。
 */
function runThumbChunks<T>(
  items: T[],
  make: (item: T) => boolean,
  emit: () => void,
  cancelled: () => boolean,
  done: () => void,
): void {
  let i = 0;
  let dirty = false;
  const flush = () => { if (dirty) { emit(); dirty = false; } };
  const step = () => {
    if (cancelled()) return;
    const deadline = performance.now() + 14;
    while (i < items.length) {
      if (make(items[i])) dirty = true;
      i++;
      if (performance.now() >= deadline) break;
    }
    flush();
    if (i >= items.length) { done(); return; }
    setTimeout(step, 0);
  };
  step();
}

export const ImageEditor: React.FC<ImageEditorProps> = ({ histKey, imageSrc, batchSrcs, onAddPhotos, lutList, onSave, onCancel, onHome, onRequestExit, onImportNew, originalFile, initialState, compactBottomBar = false, fullTabs = false }) => {
  if (import.meta.env.DEV) (window as any).__editorRenders = ((window as any).__editorRenders || 0) + 1;
  const curveClipId = React.useId();
  /* 底部分類列（EditBar：只有文字、選中的有底線、下面留空間好按）。
     這個值也同步參與控制區與構圖舞台計算。 */
  const footerHeight = EDIT_BAR_H;
  const [detailPanelHost, setDetailPanelHost] = useState<HTMLDivElement | null>(null);
  const lastUiInputRef = useRef(0);
  /* ── 批量編輯 ───────────────────────────────────────────────────────────
     一次匯入多張時，編輯器本身完全不變 —— 畫面上永遠只有「目前這一張」，
     其他張的參數各自收在旁邊。連結中的照片共用同一份參數（改一張＝全部一起改），
     解除連結的照片有自己的一份，之後怎麼調都不會再互相影響。            */
  const incoming = (batchSrcs && batchSrcs.length ? batchSrcs : [imageSrc]).filter(Boolean);
  /** 清單自己留一份：縮圖列上可以刪照片，刪掉不必回頭改上層的狀態 */
  const [srcList, setSrcList] = useState<string[]>(incoming);
  /** 給 addToHistory／撤銷用的最新來源清單（callback 裡讀 state 會是舊的） */
  const srcListRef = useRef<string[]>(incoming);
  const safeIdxRef = useRef(0);
  srcListRef.current = srcList;
  useEffect(() => { setSrcList(incoming); }, [batchSrcs, imageSrc]);
  const [batchIdx, setBatchIdx] = useState(0);
  /** 再點一次已經選中的那張才會跳出的小選單 */
  const [batchMenu, setBatchMenu] = useState<number | null>(null);
  const safeIdx = Math.min(batchIdx, Math.max(0, srcList.length - 1));
  safeIdxRef.current = safeIdx;
  const activeSrc = srcList[safeIdx] || imageSrc;
  /** 哪幾張還跟著一起連動（預設全部連動） */
  const [linked, setLinked] = useState<boolean[]>(() => srcList.map(() => true));
  useEffect(() => {
    setLinked(prev => (prev.length === srcList.length ? prev : srcList.map((_, i) => prev[i] ?? true)));
  }, [srcList.length]);
  useEffect(() => { setBatchMenu(null); }, [srcList.length]);
  const [params, setParams] = useState<EditorParams>(DEFAULT_PARAMS);
  const [activeCategory, setActiveCategory] = useState<Category>('filter');
  /** 目前展開的是哪一個新特效（activeCategory === 'fx' 時才有意義） */
  const [activeFxId, setActiveFxId] = useState<string>(FX_DEFS[0].id);
  const [activeToolId, setActiveToolId] = useState<string>('filter_select');
  /* 繪圖迴圈是掛在 ref 上的（不隨每次 render 重建），所以它要知道「現在選的是
     哪一根滑桿」只能透過 ref。每次 render 直接指派，永遠是最新的。 */
  const activeToolIdRef = useRef(activeToolId);
  activeToolIdRef.current = activeToolId;
  const [selectedLutIdx, setSelectedLutIdx] = useState(0);
  const selectedLutIdxNowRef = useRef(0);
  selectedLutIdxNowRef.current = selectedLutIdx;
  const [isSoftActive, setIsSoftActive] = useState(false);
  const [isBlurActive, setIsBlurActive] = useState(false);
  const [isGrainActive, setIsGrainActive] = useState(false);
  const [isHalationActive, setIsHalationActive] = useState(false);
  
  const [softManuallyAdjusted, setSoftManuallyAdjusted] = useState(false);
  const [blurManuallyAdjusted, setBlurManuallyAdjusted] = useState(false);
  const [grainManuallyAdjusted, setGrainManuallyAdjusted] = useState(false);
  const [halationManuallyAdjusted, setHalationManuallyAdjusted] = useState(false);

  const userSoftRef = useRef<number>(50);
  const userBlurRef = useRef<number>(40);
  const userGrainRef = useRef({ grain: 0, colorNoise: 40, colorNoise2: 0 });
  const userHalationRef = useRef<number>(50);
  const [showOriginal, setShowOriginal] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'processing' | 'success'>('idle');
  const saveRequestRef = useRef(0);
  const saveBusyRef = useRef(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg' | 'heic'>('png');
  const [encodedExports, setEncodedExports] = useState<string[]>([]);
  const encodedExportsRef = useRef<string[]>([]);
  useEffect(() => () => revokeUrls(encodedExportsRef.current), []);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isInitialCreatingMask, setIsInitialCreatingMask] = useState(false);
  const [dismissedMaskHint, setDismissedMaskHint] = useState(false);

  useEffect(() => {
    setDismissedMaskHint(false);
  }, [imageSrc]);

  // EXIF Metadata State
  const [showExifPanel, setShowExifPanel] = useState(false);
  /* 點面板以外的任何地方就收起來。
     光靠那片 fixed inset-0 的遮罩不保險 —— 只要祖先有 backdrop-filter／
     transform，fixed 就會被關進那個祖先裡、蓋不滿整個畫面。
     開著的時候在 document 上聽一次按下（捕獲階段），不是按在面板或那顆
     資訊鍵上就關掉。 */
  const exifPanelRef = useRef<HTMLDivElement>(null);
  const exifBtnRef = useRef<HTMLButtonElement>(null);
  /** 那片「點外面就收起來」的透明遮罩本人 */
  const exifShieldRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showExifPanel) return;
    const onDown = (ev: Event) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (exifPanelRef.current?.contains(t) || exifBtnRef.current?.contains(t)) return;
      /* 按在那片遮罩上就交給它自己的 onClick（鬆手才關）——
         這裡如果搶著在按下的當下就關掉，遮罩會在鬆手前消失，
         瀏覽器就把那一次 click 重新命中到底下的東西上。
         這支監聽留給「遮罩蓋不到的地方」（祖先有 backdrop-filter／transform
         時 fixed 會被關進去，那正是它存在的理由）。 */
      if (exifShieldRef.current === t) return;
      setShowExifPanel(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [showExifPanel]);
  /* ── IG 預覽 ──────────────────────────────────────────────────────
     用「現在這一份參數」實際輸出一張，再交給共用的 IgPreview 元件顯示，
     所以看到的就是按下儲存會拿到的那一張。 */
  const [igOpen, setIgOpen] = useState(false);
  const [igShot, setIgShot] = useState<string>('');
  const [igBusy, setIgBusy] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<string>('-');
  const [exifData, setExifData] = useState<{
    fileName: string;
    fileFormat: string;
    date: string;
    cameraModel: string;
    iso: string;
    shutter: string;
    focalLength: string;
    aperture: string;
  }>({
    fileName: '-',
    fileFormat: '-',
    date: '-',
    cameraModel: '-',
    iso: '-',
    shutter: '-',
    focalLength: '-',
    aperture: '-'
  });

  useEffect(() => {
    let active = true;
    const fetchMetadata = async () => {
      let name = '-';
      let format = '-';
      let date = '-';
      let model = '-';
      let iso = '-';
      let shutter = '-';
      let focal = '-';
      let aperture = '-';

      if (originalFile) {
        name = originalFile.name;
        const ext = originalFile.name.split('.').pop()?.toUpperCase() || '';
        format = ext;
      } else if (imageSrc) {
        if (imageSrc.startsWith('data:image/')) {
          name = 'camera_capture.jpg';
          format = 'JPEG';
        } else if (imageSrc.startsWith('blob:')) {
          name = 'photo_import.jpg';
          format = 'JPEG';
        } else {
          const parts = imageSrc.split('/');
          const filenamePart = parts[parts.length - 1] || 'photo.jpg';
          name = filenamePart.split('?')[0];
          const ext = name.split('.').pop()?.toUpperCase() || '';
          format = ext || 'JPEG';
        }
      }

      try {
        let tags: any = null;
        if (originalFile) {
          tags = await ExifReader.load(originalFile);
        } else if (imageSrc && !imageSrc.startsWith('data:')) {
          tags = await ExifReader.load(imageSrc);
        }

        if (tags) {
          const make = tags['Make']?.description || '';
          const modelDesc = tags['Model']?.description || '';
          if (modelDesc) {
            if (make && !modelDesc.toLowerCase().includes(make.toLowerCase())) {
              model = `${make} ${modelDesc}`;
            } else {
              model = modelDesc;
            }
          } else if (make) {
            model = make;
          }
          if (model) {
            const lower = model.toLowerCase().trim();
            if (lower === 'unknown' || lower === '未知' || lower === 'none' || lower === '') {
              model = '-';
            }
          }

          const dt = tags['DateTimeOriginal']?.description || tags['DateTime']?.description || tags['ModifyDate']?.description;
          if (dt) {
            date = formatExifDate(dt);
          }

          const isoVal = tags['ISOSpeedRatings']?.description || tags['ISOSpeedRatings']?.value || tags['ISO']?.description;
          if (isoVal) {
            iso = `ISO ${isoVal}`;
          }

          const expTime = tags['ExposureTime']?.description || tags['ExposureTime']?.value;
          if (expTime) {
            shutter = typeof expTime === 'number' 
              ? (expTime < 1 ? `1/${Math.round(1 / expTime)}s` : `${expTime}s`) 
              : (String(expTime).endsWith('s') ? String(expTime) : `${expTime}s`);
          }

          const focalLen = tags['FocalLength']?.description || tags['FocalLength']?.value;
          if (focalLen) {
            focal = String(focalLen).endsWith('mm') ? String(focalLen) : `${focalLen}mm`;
          }

          const fNum = tags['FNumber']?.description || tags['FNumber']?.value;
          if (fNum) {
            aperture = typeof fNum === 'number' || !String(fNum).startsWith('f/') ? `f/${fNum}` : String(fNum);
          }
        }
      } catch (err) {
        console.warn("Error parsing EXIF metadata:", err);
      }

      if (active) {
        if (originalImgRef.current) {
          setImageDimensions(`${originalImgRef.current.naturalWidth}×${originalImgRef.current.naturalHeight}`);
        }
        setExifData({
          fileName: name,
          fileFormat: format,
          date: date,
          cameraModel: model,
          iso: iso,
          shutter: shutter,
          focalLength: focal,
          aperture: aperture
        });
      }
    };

    fetchMetadata();
    return () => { active = false; };
  }, [imageSrc, originalFile]);
  const [loadingLutId, setLoadingLutId] = useState<string | null>(null);
  /* 又有一顆濾鏡下載解析好了。
     縮圖那一支 effect 靠這個知道「可以把那一格重算了」——
     背景預載不會動到 loadingLutId，少了這個通知，還沒載完就先算過的那幾格
     會一直停在沒套濾鏡的墊底圖，直到使用者去點某一顆濾鏡才更新。 */
  const [lutReadyTick, setLutReadyTick] = useState(0);
  useEffect(()=>{let active=true;void warmLowfiLut().then(()=>{if(active){setLutReadyTick(t=>t+1);setParams(p=>({...p}));}}).catch(console.error);return()=>{active=false;};},[]);
  /** 濾鏡檔載好了，但畫面還沒用它算過 —— 轉圈要撐到那一輪畫完 */
  const pendingLutPaintRef = useRef<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  /* 陣列與游標各自用 setState 更新的話，同一拍被呼叫兩次（例如點濾鏡時
     選取與載入完成各記一次）就會「只多一筆、游標卻加了兩次」——
     游標指到陣列外，撤銷就會少退一步、重做整個按不動。
     所以真正的值放在 ref，setState 只是拿來重繪。 */
  const historyRef = useRef<HistoryItem[]>([]);
  const historyIdxRef = useRef(-1);
  const writeHistory = (arr: HistoryItem[], idx: number) => {
    historyRef.current = arr;
    historyIdxRef.current = idx;
    setHistory(arr);
    setHistoryIndex(idx);
  };
  const [finalImage, setFinalImage] = useState<string | null>(null);
  /** 批量編輯時，一次存出來的所有成品 */
  const [finalImages, setFinalImages] = useState<string[]>([]);
  /* 成品是 blob 網址，換掉舊的之前要回收，不然按第二次儲存
     上一輪那幾張會一直留在記憶體裡。 */
  const finalImagesRef = useRef<string[]>([]);
  /* 導出畫面那一排成品。
     成品是照 srcList 的順序排的，所以第一張永遠在最左邊 ——
     但這一排是原生捲動容器，捲動位置會被瀏覽器保留／被 scroll-snap 挑到
     離目前位置最近的那一張，於是常常一進來就停在「剛剛在編輯的那一張」。
     每次出現這個畫面都明確捲回最左邊，才會一定從第一張開始看。 */
  const finalStripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (saveState !== 'success') return;
    const el = finalStripRef.current;
    if (!el) return;
    // 這一拍就歸零（不要 smooth，也不要等下一幀）—— 使用者不會看到它從中間滑回去
    el.scrollLeft = 0;
    // 圖片是非同步解碼的，寬度長出來之後瀏覽器可能再挑一次定位點，所以下一幀再壓一次
    const id = requestAnimationFrame(() => { if (finalStripRef.current) finalStripRef.current.scrollLeft = 0; });
    return () => cancelAnimationFrame(id);
  }, [saveState, finalImages]);
  /* 離開時晚一點再回收：導出紀錄的縮圖與分享用的檔案都是非同步去讀這個
     網址的，按下儲存後馬上離開的話會來不及讀完。 */
  /* 計時器放在 utils/blobUrl 裡：寫成這裡的箭頭函式的話，它會抓住整個修圖頁的變數
     （所有像素緩衝），離開後 15 秒內那一兩百 MB 都放不掉。 */
  useEffect(() => () => revokeUrlsLater(finalImagesRef.current as any, 15000), []);
  const [isPortrait, setIsPortrait] = useState(false);

  // Curve Specific State
  const [currentCurveChannel, setCurrentCurveChannel] = useState<CurveChannel>('rgb');
  const [dragPointIdx, setDragPointIdx] = useState<number>(-1);
  const lastCurveTapRef = useRef<number>(0);
  const lastTapRef = useRef<Record<string, number>>({});
  const lastCreatedIdxRef = useRef<number>(-1);
  const lastCreatedTimeRef = useRef<number>(0);

  const [canvasBounds, setCanvasBounds] = useState({ width: 0, height: 0, top: 0, left: 0 });
  // 預覽緩衝的實際比例。構圖裁切之後畫面比例會變，版面必須跟著走，
  // 不能再從已經被舊比例撐開的 canvas 量回來。
  const [previewAspect, setPreviewAspect] = useState<{ w: number; h: number } | null>(null);
  /** 外框比例只由 React 的單一尺寸計算控制。舊程式會在繪圖途中直接把 DOM
   *  width 改回 100%，與固定像素高度衝突，iOS 上就會偶發把長圖壓扁。 */
  const previewFitRef = useRef<HTMLDivElement>(null);
  const applyPreviewAspect = useCallback((w: number, h: number) => {
    if (!(w > 0 && h > 0)) return;
    setPreviewAspect(prev => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);
  // 構圖參數。套用之後整個預覽緩衝會用新的幾何重建，色彩流程完全不用知道它的存在。
  const [geo, setGeo] = useState<GeoParams>(() => ({ ...DEFAULT_GEO, crop: { ...FULL_CROP } }));
  const [draftGeo, setDraftGeo] = useState<GeoParams | null>(null);
  const composePreviewRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);
  const composeStageLimitRef = useRef<{width:number;height:number}|null>(null);
  const releaseComposePreview = () => {
    const snapshot = composePreviewRef.current;
    composePreviewRef.current = null;
    composeStageLimitRef.current = null;
    if (snapshot instanceof HTMLCanvasElement) snapshot.width = snapshot.height = 0;
  };
  const bufferGeoRef = useRef<GeoParams>(DEFAULT_GEO);
  const geoRef = useRef<GeoParams>({ ...DEFAULT_GEO, crop: { ...FULL_CROP } });
  useEffect(() => { geoRef.current = geo; }, [geo]);

  /* ── 批量編輯：每一張的參數怎麼收 ─────────────────────────────────────
     連結中的照片共用 sharedSnapRef 這一份；解除連結的各自收在 soloSnapsRef。
     畫面上「正在編輯的那一份」永遠是元件本身的 state，切換照片時才存回去／讀出來。 */
  type BatchSnap = {
    params: EditorParams; geo: GeoParams; selectedLutIdx: number;
    isSoftActive: boolean; isBlurActive: boolean; isGrainActive: boolean; isHalationActive: boolean;
    softManuallyAdjusted: boolean; blurManuallyAdjusted: boolean;
    grainManuallyAdjusted: boolean; halationManuallyAdjusted: boolean;
    /** 四顆開關「關掉再開要回到多少」的記憶值，也要跟著一起走 */
    userSoft: number; userBlur: number; userHalation: number;
    userGrain: { grain: number; colorNoise: number; colorNoise2: number };
  };
  const liveRef = useRef<BatchSnap | null>(null);
  liveRef.current = {
    params, geo, selectedLutIdx,
    isSoftActive, isBlurActive, isGrainActive, isHalationActive,
    softManuallyAdjusted, blurManuallyAdjusted, grainManuallyAdjusted, halationManuallyAdjusted,
    userSoft: userSoftRef.current, userBlur: userBlurRef.current,
    userHalation: userHalationRef.current, userGrain: { ...userGrainRef.current },
  };
  const cloneSnap = (s: BatchSnap): BatchSnap => JSON.parse(JSON.stringify(s));
  /** 遮色片與構圖是「這張照片自己的事」，不跟著連動 —— 每張各存一份 */
  const ownGeoRef = useRef<Record<number, GeoParams>>({});
  const ownMaskRef = useRef<Record<number, Partial<EditorParams>>>({});
  const isOwnKey = (k: string) => k.startsWith('mask');
  /* 遮色片的欄位有些是選填的（沒有就是預設）：一律列出來，沒有的也寫成 undefined，
     套到別張照片時才會蓋掉、不會把這張的遮色片帶過去 */
  const OWN_MASK_KEYS = Array.from(new Set([...Object.keys(DEFAULT_PARAMS).filter(isOwnKey), ...MASK_SNAP_KEYS, 'masks', 'maskActive', 'maskLumSample']));
  const pickMask = (p: EditorParams): Partial<EditorParams> => {
    const out: any = {};
    for (const k of new Set([...OWN_MASK_KEYS, ...Object.keys(p).filter(isOwnKey)])) out[k] = (p as any)[k];
    return out;
  };
  const sharedSnapRef = useRef<BatchSnap | null>(null);
  const soloSnapsRef = useRef<Record<number, BatchSnap>>({});
  /** 換照片時要套上去的那一份，以及它是給哪一張的 */
  const pendingSnapRef = useRef<BatchSnap | null>(null);
  const pendingSnapSrcRef = useRef<string | null>(null);
  const pendingSnapIdxRef = useRef<number | null>(null);
  const applySnap = (snap: BatchSnap, forIdx?: number) => {
    const i = forIdx ?? safeIdx;
    // 連動的只有色彩／濾鏡／特效；遮色片與構圖用這張自己的那一份。
    // 沒動過的那幾張就用預設值 —— 不能沿用快照裡別人的遮色片／構圖。
    const ownMask = ownMaskRef.current[i] || pickMask(DEFAULT_PARAMS);
    const nextParams = { ...cloneSnap(snap).params, ...ownMask } as EditorParams;
    setParams(nextParams);
    const ownGeo = ownGeoRef.current[i]
      ? JSON.parse(JSON.stringify(ownGeoRef.current[i]))
      : { ...DEFAULT_GEO, crop: { ...FULL_CROP } };
    geoRef.current = ownGeo;
    setGeo(ownGeo);
    setSelectedLutIdx(snap.selectedLutIdx);
    setIsSoftActive(snap.isSoftActive);
    setIsBlurActive(snap.isBlurActive);
    setIsGrainActive(snap.isGrainActive);
    setIsHalationActive(snap.isHalationActive);
    setSoftManuallyAdjusted(snap.softManuallyAdjusted);
    setBlurManuallyAdjusted(snap.blurManuallyAdjusted);
    setGrainManuallyAdjusted(snap.grainManuallyAdjusted);
    setHalationManuallyAdjusted(snap.halationManuallyAdjusted);
    // 舊快照沒存這幾個記憶值，取不到就維持現在的
    if (typeof snap.userSoft === 'number') userSoftRef.current = snap.userSoft;
    if (typeof snap.userBlur === 'number') userBlurRef.current = snap.userBlur;
    if (typeof snap.userHalation === 'number') userHalationRef.current = snap.userHalation;
    if (snap.userGrain) userGrainRef.current = { ...snap.userGrain };
  };
  const applySnapRef = useRef(applySnap);
  applySnapRef.current = applySnap;
  /** 把「現在畫面上這一份」收回它該去的地方 */
  const stashCurrent = () => {
    const live = liveRef.current;
    if (!live) return;
    // 遮色片與構圖各留各的
    ownGeoRef.current[safeIdx] = JSON.parse(JSON.stringify(live.geo));
    ownMaskRef.current[safeIdx] = pickMask(live.params);
    if (linked[safeIdx] === false) soloSnapsRef.current[safeIdx] = cloneSnap(live);
    else sharedSnapRef.current = cloneSnap(live);
  };
  const snapFor = (i: number): BatchSnap | null =>
    (linked[i] === false ? soloSnapsRef.current[i] : sharedSnapRef.current) ?? null;
  /* 切走時把「畫好的整張」（含這張自己的遮色片、特效、濾鏡）留一份。背景預熱的那份只有連動的色彩調整，
     沒有遮色片也沒有特效 —— 切回來先畫預熱那份的話，遮色片／特效要等整條管線重跑完才補上，看起來就是慢半拍、
     像在重新載入。參數完全沒變的話直接畫留下來的這份，切過去的那一格就是最後的樣子。最多留三張（記憶體）。 */
  const maskShotRef = useRef<Map<string, { canvas: HTMLCanvasElement; sig: string; ov: HTMLCanvasElement | null }>>(new Map());
  /* 鍵的順序不能算進去：同一份參數經過 { ...快照, ...這張的遮色片 } 合起來時鍵的順序會不一樣，
     直接 JSON.stringify 會被當成「不一樣」，留下來的那份就永遠用不到 */
  const stableJson = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o: any, k) => { o[k] = (x as any)[k]; return o; }, {}) : x);
  const maskShotSig = (p: EditorParams, lutIdx: number, g: GeoParams) => stableJson([p, lutIdx, g]);
  const keepMaskShot = () => {
    const live = liveRef.current, src = srcList[safeIdx];
    const shots = maskShotRef.current;
    if (!live || !src) return;
    const old = shots.get(src); shots.delete(src);
    const shown = visibleEditorCanvas(), b = buffers.current.preview;
    if (!shown || !b || !b.w || !b.h || !shown.width || !shown.height || isSwitching || showOriginalRef.current || isDirtyRef.current) { if (old) old.canvas.width = 0; return; }
    const c = old?.canvas || document.createElement('canvas');
    if (c.width !== b.w || c.height !== b.h) { c.width = b.w; c.height = b.h; }
    const g = c.getContext('2d'); if (!g) return;
    g.globalCompositeOperation = 'copy'; g.drawImage(shown, 0, 0, b.w, b.h); g.globalCompositeOperation = 'source-over';
    /* 遮色片頁的紅色範圍在自己那一層：一起留一份，切回來時跟照片同一格出現 */
    const ovEl = maskOverlayCanvasRef.current;
    let ov: HTMLCanvasElement | null = old?.ov || null;
    if (ovEl && ovEl.style.display !== 'none' && ovEl.width > 0) {
      ov ||= document.createElement('canvas');
      if (ov.width !== ovEl.width || ov.height !== ovEl.height) { ov.width = ovEl.width; ov.height = ovEl.height; }
      const og = ov.getContext('2d')!; og.globalCompositeOperation = 'copy'; og.drawImage(ovEl, 0, 0); og.globalCompositeOperation = 'source-over';
    } else if (ov) { ov.width = 0; ov = null; }
    shots.set(src, { canvas: c, sig: maskShotSig(paramsRef.current, live.selectedLutIdx, live.geo), ov });
    while (shots.size > 3) { const k = shots.keys().next().value as string; const o = shots.get(k)!; o.canvas.width = 0; if (o.ov) o.ov.width = 0; shots.delete(k); }
  };
  /** 第 i 張留下來的那份還對得上它現在該有的樣子嗎 */
  const shotValid = (i: number, snap: BatchSnap | null) => {
    const shot = maskShotRef.current.get(srcList[i]);
    if (!shot || !snap) return null;
    const ownMask = ownMaskRef.current[i] || pickMask(DEFAULT_PARAMS);
    const ownGeo = ownGeoRef.current[i] || { ...DEFAULT_GEO, crop: { ...FULL_CROP } };
    return shot.sig === maskShotSig({ ...cloneSnap(snap).params, ...ownMask } as EditorParams, snap.selectedLutIdx, ownGeo) ? shot : null;
  };
  const paintMaskShot = (i: number, snap: BatchSnap | null): boolean => {
    const shot = shotValid(i, snap), cvs = displayCanvasRef.current;
    if (!shot || !cvs) return false;
    showFxSurface(false); fxInputKeyRef.current = '';
    const { width: w, height: h } = shot.canvas;
    if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
    const ctx = cvs.getContext('2d'); if (!ctx) return false;
    ctx.globalCompositeOperation = 'copy'; ctx.drawImage(shot.canvas, 0, 0); ctx.globalCompositeOperation = 'source-over';
    cvs.style.filter = 'none';
    const ovEl = maskOverlayCanvasRef.current;
    if (ovEl && shot.ov && activeCategory === 'mask') {
      if (ovEl.width !== shot.ov.width || ovEl.height !== shot.ov.height) { ovEl.width = shot.ov.width; ovEl.height = shot.ov.height; }
      const og = ovEl.getContext('2d')!; og.globalCompositeOperation = 'copy'; og.drawImage(shot.ov, 0, 0); og.globalCompositeOperation = 'source-over';
      ovEl.style.display = 'block';
    }
    warmPaintedSrcRef.current = srcList[i];
    applyPreviewAspect(w, h);
    /* 畫上去的就是最後的樣子：整條管線（發光類特效還要整張讀回重算光暈）晚一點再跑，
       連續切好幾張時，中間經過的那幾張就不用每張都算一次 */
    shotHoldUntilRef.current = performance.now() + 320;
    return true;
  };
  const shotHoldUntilRef = useRef(0);
  /** 切換要預覽哪一張 */
  const switchTo = (i: number) => {
    if (i === safeIdx || i < 0 || i >= srcList.length) return;
    setBatchMenu(null);
    keepMaskShot();
    stashCurrent();
    // 上一張的紅色遮色片範圍不能留在下一張上（看起來就像遮色片被帶過去了）
    if (maskOverlayCanvasRef.current) maskOverlayCanvasRef.current.style.display = 'none';
    hideMaskLive();
    pendingSnapRef.current = snapFor(i);
    pendingSnapSrcRef.current = srcList[i];
    pendingSnapIdxRef.current = i;
    setBatchIdx(i);
    // 背景已經算好的話，當下就把調整後的畫面畫上去 —— 手指一離開就換好了，
    // 不用等圖片重新解碼、重新算一輪。算不到就先蓋一層「渲染中」，別讓畫面停在上一張。
    // 但如果這張的圖早就解碼過（來回切換的情況），重建是同一拍同步做完的，
    // 蓋一層「渲染中」只會閃一下，反而更像在等 —— 那就別蓋。
    // 轉圈只在「真的要重跑一輪」時才蓋。這張的圖如果早就解好了（來回切換的情況），
    // 重建是同一拍同步做完的，蓋上去只會閃一下，看起來反而更像在等。
    // 註：重建是同步的，所以「先等一下再蓋」行不通 —— 主執行緒被卡住時計時器根本輪不到。
    const decoded = viewedImgRef.current.get(srcList[i]) || warmImgRef.current.get(srcList[i]);
    const instant = !!(decoded && decoded.complete && decoded.naturalWidth);
    if (!paintMaskShot(i, pendingSnapRef.current || liveRef.current) && !paintWarmNow(srcList[i], pendingSnapRef.current || liveRef.current) && !instant) setIsSwitching(true);
  };
  /* ---- 縮圖的點按 ----------------------------------------------------------
     用 pointerup 而不是 click：手機上兩下點得快時，第二下的 click 常常被瀏覽器
     當成連擊手勢吞掉，看起來就是「點兩下沒反應」。順便補一個長按，
     不想連點兩下的人可以按著不放叫出同一個選單。                            */
  /* 選單是縮圖自己的子節點，所以捲動時它本來就跟著縮圖一起走 —— 不用 rAF 追、
     也不會有一格的延遲。這裡只記「相對縮圖要偏多少」，用來讓靠右邊的縮圖
     把選單往左挪一點，不然會被捲動列的右緣切掉。 */
  /** HSL 目前在調哪一個色帶 */
  const [hslBandIdx, setHslBandIdx] = useState(0);
  const [batchMenuDx, setBatchMenuDx] = useState(0);
  /** 選單大約的寬度，只用來決定要不要往左挪 */
  const BATCH_MENU_W = 92;
  /** 切過去了但新的那張還在算 —— 預覽上蓋一層「渲染中」 */
  const [isSwitching, setIsSwitching] = useState(false);

  const pressRef = useRef<{ i: number; x: number; y: number; moved: boolean; timer: number } | null>(null);
  const openBatchMenu = (i: number) => {
    const el = document.querySelector(`[data-batch-thumb="${i}"]`) as HTMLElement | null;
    const row = el?.closest('[data-batch-row]') as HTMLElement | null;
    if (el && row) {
      const r = el.getBoundingClientRect(), rr = row.getBoundingClientRect();
      setBatchMenuDx(Math.min(0, rr.right - (r.left + BATCH_MENU_W)));
    } else {
      setBatchMenuDx(0);
    }
    setBatchMenu(i);
  };
  const cancelThumbPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };
  const beginThumbPress = (i: number, e: React.PointerEvent<HTMLElement>) => {
    cancelThumbPress();
    pressRef.current = {
      i, x: e.clientX, y: e.clientY, moved: false,
      timer: window.setTimeout(() => { if (pressRef.current && !pressRef.current.moved) { openBatchMenu(i); cancelThumbPress(); } }, 450),
    };
  };
  const moveThumbPress = (e: React.PointerEvent<HTMLElement>) => {
    const st = pressRef.current;
    if (!st) return;
    if (Math.abs(e.clientX - st.x) > 8 || Math.abs(e.clientY - st.y) > 8) { st.moved = true; window.clearTimeout(st.timer); }
  };
  const endThumbPress = (i: number, e: React.PointerEvent<HTMLElement>, active: boolean) => {
    const st = pressRef.current;
    cancelThumbPress();
    if (!st || st.i !== i || st.moved) return;   // 在捲動就不算點擊
    // 已經選中的再點一下＝開選單。這裡刻意不做開關切換 ——
    // 連點兩下時會變成開了又關，看起來就像沒反應。
    if (active) openBatchMenu(i);
    else { setBatchMenu(null); switchTo(i); }
  };

  /** 從縮圖列刪掉一張（至少留一張） */
  const removePhoto = (i: number) => {
    if (srcList.length <= 1) return;
    const nextIdx = i < safeIdx ? safeIdx - 1 : Math.min(safeIdx, srcList.length - 2);
    // 各自那份參數的索引要跟著往前挪（含遮色片與構圖那兩份）
    const reindex = <T,>(src: Record<number, T>): Record<number, T> => {
      const out: Record<number, T> = {};
      (Object.entries(src) as [string, T][]).forEach(([k, v]) => {
        const n = Number(k);
        if (n === i) return;
        out[n > i ? n - 1 : n] = v;
      });
      return out;
    };
    soloSnapsRef.current = reindex(soloSnapsRef.current);
    ownGeoRef.current = reindex(ownGeoRef.current);
    ownMaskRef.current = reindex(ownMaskRef.current);
    setLinked(prev => prev.filter((_, n) => n !== i));
    if (nextIdx !== safeIdx) {
      stashCurrent();
      pendingSnapRef.current = snapFor(i < safeIdx ? safeIdx : nextIdx + (i <= nextIdx ? 1 : 0));
      pendingSnapSrcRef.current = srcList.filter((_, n) => n !== i)[nextIdx] || null;
    }
    setSrcList(prev => prev.filter((_, n) => n !== i));
    setBatchIdx(nextIdx);
  };

  /** 連結／解除連結。解除的當下先把現在的樣子留給它，之後就各走各的。 */
  const toggleLink = (i: number) => {
    const live = liveRef.current;
    setLinked(prev => {
      const next = [...prev];
      const on = next[i] !== false;
      next[i] = !on;
      if (on) {
        soloSnapsRef.current[i] = cloneSnap((i === safeIdx ? live : sharedSnapRef.current) || live!);
      } else {
        delete soloSnapsRef.current[i];
        if (i === safeIdx && sharedSnapRef.current) applySnap(sharedSnapRef.current);
      }
      return next;
    });
  };

  // ---- 跳出應用再回來還在 ----
  // 調整都是非破壞性的參數，所以存「照片 + 參數」就能完整接回上次的狀態。
  // 還原的動作放在下面那個「換照片就全部歸零」的 effect 最後面 ——
  // 那個 effect 會把 params/geo/濾鏡 全部打回預設，先還原就會被它蓋掉。
  const initialStateRef = useRef(initialState);
  /** 接續的參數是屬於哪一張照片的（換照片之後就不該再套） */
  const resumeSrcRef = useRef<string | null>(null);

  // 照片先存一次，之後只要參數變了就（延遲）更新參數那一份
  const draftSrcSavedRef = useRef<string | null>(null);
  const latestEditorDraftRef = useRef({ params, geo, selectedLutIdx });
  latestEditorDraftRef.current = { params, geo, selectedLutIdx };
  useEffect(() => {
    if (!imageSrc) return;
    const timer = window.setInterval(() => {
      const first = draftSrcSavedRef.current !== imageSrc;
      draftSrcSavedRef.current = imageSrc;
      const latest = latestEditorDraftRef.current;
      const hasEditedContent =
        Boolean(initialState) ||
        historyIndex > 0 ||
        JSON.stringify(latest.params) !== JSON.stringify(DEFAULT_PARAMS) ||
        !isGeoIdentity(latest.geo) ||
        latest.selectedLutIdx !== 0 ||
        activeSrc !== imageSrc;
      /* 未編輯時仍可預存原圖，但不能建立首頁的「繼續編輯」提示。 */
      saveToolDraft('editor', first ? imageSrc : null, {
        ...latest,
        __histKey: histKey || initialState?.__histKey || null,
      }, hasEditedContent);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [imageSrc, activeSrc, historyIndex, initialState, histKey]);
  const applyGeoRef = useRef<(g: GeoParams) => void>(() => {});
  const activeDragRef = useRef<{
    type: MaskDragType;
    startX: number;
    startY: number;
    initialCx: number;
    initialCy: number;
    initialAngle: number;
    initialD: number;
    initialRx: number;
    initialRy: number;
    lastX?: number;
    lastY?: number;
  } | null>(null);

  const updateCanvasBounds = useCallback(() => {
    const canvas = displayCanvasRef.current;
    if (canvas) {
      const parent = canvas.offsetParent as HTMLElement | null;
      if (parent) {
        // 遮色片 SVG 和 canvas 一起位于缩放层内，所以这里必须保存「层内坐标」，
        // 不能用 getBoundingClientRect()：后者包含当前缩放倍率，复位 transform 又
        // 不会触发 ResizeObserver，之后创建的遮色片就会沿用放大后的错误尺寸。
        const next = { width: canvas.offsetWidth, height: canvas.offsetHeight, top: canvas.offsetTop, left: canvas.offsetLeft };
        /* 沒變就回傳原物件：每次切分頁都會量一次（加上 ResizeObserver 一掛上就回報一次），
           以前每次都塞一個新物件，等於整個編輯器白白多 render 兩遍。 */
        setCanvasBounds(prev => prev && prev.width === next.width && prev.height === next.height && prev.top === next.top && prev.left === next.left ? prev : next);
      }
    }
  }, []);

  useEffect(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    
    // Initial measure
    updateCanvasBounds();
    
    const observer = new ResizeObserver(() => {
      updateCanvasBounds();
    });
    
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [updateCanvasBounds, activeCategory]);

  /* 手勢座標先按畫布目前的螢幕矩形正規化，再換回 SVG 的層內尺寸。
     因此即使圖片仍在縮放復位動畫中，遮色片也不會產生倍率或位移誤差。 */
  const maskPoint = (e: React.PointerEvent) => {
    const r = displayCanvasRef.current?.getBoundingClientRect();
    if (!r?.width || !r.height) return null;
    return { x: ((e.clientX - r.left) / r.width) * canvasBounds.width, y: ((e.clientY - r.top) / r.height) * canvasBounds.height };
  };
  /* ── 放射遮色片的雙指手勢（整個預覽區都算，不必按在遮色片上）＋ 點空白處取消選中 ──
     掛在預覽區的「捕獲」階段：第二根手指一落下就接手（第一根如果正在拖把手，那一下停在原地），
     之後兩指的移動＝搬移中心、距離比例＝等比縮放、角度差＝旋轉，全部走即時疊層。 */
  const boxPtrsRef = useRef(new Map<number, { x: number; y: number }>());
  const maskPinchRef = useRef<null | { d0: number; a0: number; mx0: number; my0: number; rx0: number; ry0: number; cx0: number; cy0: number; ang0: number }>(null);
  /** 雙指結束後還留在畫面上的那根手指：它之後的移動／放開都不算（不然會變成拖把手） */
  const maskSwallowRef = useRef(new Set<number>());
  const maskTapRef = useRef<null | { id: number; x: number; y: number; t: number }>(null);
  /** 放射：單指在預覽區任何地方拖＝搬移整個遮色片（超過 6px 才算拖，不然就是點一下） */
  const maskMoveRef = useRef<null | { id: number; x0: number; y0: number; cx0: number; cy0: number; on: boolean }>(null);
  const finishMaskGesture = () => {
    activeDragRef.current = null;
    setIsInteracting(false);
    if (!releaseMaskLive(paramsRef.current)) isDirtyRef.current = true;
    uiFirstRef.current = true;
    flushParamsSync();
    addToHistory(paramsRef.current, selectedLutIdx);
  };
  const pinchPts = () => { const [a, b] = [...boxPtrsRef.current.values()]; return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  const onBoxPointerDown = (e: React.PointerEvent) => {
    if (activeCategory !== 'mask') return;
    boxPtrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = paramsRef.current;
    const mt = p.maskType ?? 'linear';
    if (boxPtrsRef.current.size === 1) {
      // 按在按鈕、兩邊的欄位、參考線／把手、其他遮色片的小圓點上都不算「點空白處」
      const onUi = !!(e.target as Element).closest?.('button, input, [data-mask-stack], [data-mask-params], #ui-guides, #ui-radial, [data-mask-pin]');
      maskTapRef.current = !onUi && p.maskCreated && (mt === 'linear' || mt === 'radial') && !maskPicking
        ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
      maskMoveRef.current = !onUi && p.maskCreated && mt === 'radial' && !maskPicking && !maskDeselectedRef.current
        ? { id: e.pointerId, x0: e.clientX, y0: e.clientY, cx0: p.maskCx, cy0: p.maskCy, on: false } : null;
    }
    if (boxPtrsRef.current.size === 2 && mt === 'radial' && p.maskCreated && !maskPicking && !maskDeselectedRef.current) {
      maskTapRef.current = null;
      maskMoveRef.current = null;   // 單指搬移停在這裡，接下來只縮放
      const k = pinchPts();
      maskPinchRef.current = { d0: k.d, a0: k.a, mx0: k.mx, my0: k.my, rx0: p.maskRx ?? 0.25, ry0: p.maskRy ?? 0.25, cx0: p.maskCx, cy0: p.maskCy, ang0: p.maskAngle };
      // 第一根手指如果正在拖把手：就停在這裡，接下來交給雙指
      activeDragRef.current = { type: 'pinch', startX: 0, startY: 0, initialCx: 0, initialCy: 0, initialAngle: 0, initialD: 0, initialRx: 0, initialRy: 0 };
      primeMaskLive(p, !!p.maskShowOverlay);
      setIsInteracting(true);
      e.stopPropagation(); e.preventDefault();
    }
  };
  const onBoxPointerMove = (e: React.PointerEvent) => {
    if (!boxPtrsRef.current.has(e.pointerId)) return;
    boxPtrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const tap = maskTapRef.current;
    if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) maskTapRef.current = null;
    if (maskSwallowRef.current.has(e.pointerId)) { e.stopPropagation(); return; }
    const mv = maskMoveRef.current;
    if (mv && mv.id === e.pointerId && !maskPinchRef.current) {
      if (!mv.on) {
        if (Math.hypot(e.clientX - mv.x0, e.clientY - mv.y0) <= 6) return;
        mv.on = true; maskTapRef.current = null;
        activeDragRef.current = { type: 'rcenter', startX: 0, startY: 0, initialCx: 0, initialCy: 0, initialAngle: 0, initialD: 0, initialRx: 0, initialRy: 0 };
        primeMaskLive(paramsRef.current, !!paramsRef.current.maskShowOverlay);
        setIsInteracting(true);
      }
      e.stopPropagation();
      const r = displayCanvasRef.current?.getBoundingClientRect(); if (!r?.width || !r.height) return;
      const p = { ...paramsRef.current };
      p.maskCx = Math.max(-0.5, Math.min(1.5, mv.cx0 + (e.clientX - mv.x0) / r.width));
      p.maskCy = Math.max(-0.5, Math.min(1.5, mv.cy0 + (e.clientY - mv.y0) / r.height));
      paramsRef.current = p;
      if (!maskInert(p) && !updateMaskLive(p)) isDirtyRef.current = true;
      if (!applyMaskGuides(p)) scheduleParamsSync();
      return;
    }
    const pin = maskPinchRef.current;
    if (!pin || boxPtrsRef.current.size < 2) return;
    e.stopPropagation();
    const r = displayCanvasRef.current?.getBoundingClientRect(); if (!r?.width || !r.height) return;
    const k = pinchPts();
    const s = Math.max(0.05, k.d / pin.d0);
    const p = { ...paramsRef.current };
    // 雙指只縮放：中心、角度都不動（要搬移用單指）
    p.maskRx = Math.max(6 / r.width, pin.rx0 * s);
    p.maskRy = Math.max(6 / r.width, pin.ry0 * s);
    paramsRef.current = p;
    if (!maskInert(p) && !updateMaskLive(p)) isDirtyRef.current = true;
    if (!applyMaskGuides(p)) scheduleParamsSync();
  };
  const onBoxPointerUp = (e: React.PointerEvent) => {
    if (!boxPtrsRef.current.has(e.pointerId)) return;
    boxPtrsRef.current.delete(e.pointerId);
    if (maskSwallowRef.current.delete(e.pointerId)) { e.stopPropagation(); return; }
    const mv = maskMoveRef.current;
    if (mv && mv.id === e.pointerId) {
      maskMoveRef.current = null;
      if (mv.on) { e.stopPropagation(); maskTapRef.current = null; finishMaskGesture(); return; }
    }
    if (maskPinchRef.current) {
      e.stopPropagation();
      if (boxPtrsRef.current.size < 2) {
        maskPinchRef.current = null;
        boxPtrsRef.current.forEach((_, id) => maskSwallowRef.current.add(id));
        finishMaskGesture();
      }
      return;
    }
    const tap = maskTapRef.current; maskTapRef.current = null;
    if (tap && tap.id === e.pointerId && e.type === 'pointerup' && performance.now() - tap.t < 450 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= 8) setMaskDeselected(true);
  };

  /** 調筆刷大小時在照片正中間畫一個實際大小的空心圓（跟人像的筆刷一樣），直接改屬性不經過 React */
  const showSizeRing = (p: EditorParams) => {
    const c = document.querySelector('#mask-svg-overlay [data-mask-size-ring]');
    if (!c) return;
    c.setAttribute('r', String(brushR(p) * canvasBounds.width));
    c.setAttribute('visibility', 'visible');
  };
  const hideSizeRing = () => document.querySelector('#mask-svg-overlay [data-mask-size-ring]')?.setAttribute('visibility', 'hidden');
  /** 筆刷半徑（佔寬度的比例）：大小 1～100 對應寬度的 0.6%～15% */
  const brushR = (p: EditorParams) => 0.006 + ((p.maskBrushSize ?? 40) / 100) * 0.144;
  const addDabs = (p: EditorParams, x0: number, y0: number, x1: number, y1: number) => {
    const W = canvasBounds.width, H = canvasBounds.height;
    const r = brushR(p), rpx = r * W;
    const dist = Math.hypot(x1 - x0, y1 - y0), step = Math.max(1, rpx * 0.25);
    const n = Math.max(1, Math.ceil(dist / step));
    const list = p.maskStrokes!;
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      list.push(p.maskBrushErase ? { x: x / W, y: y / H, r, e: 1 } : { x: x / W, y: y / H, r });
    }
  };

  const handleMaskPointerDown = (e: React.PointerEvent<SVGElement>, type: MaskDragType) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch (err) { /* 沒抓到也無所謂 */ }
    const pt = maskPoint(e); if (!pt) return;
    const p = paramsRef.current;
    const W = canvasBounds.width, H = canvasBounds.height;

    /* 顏色／明度範圍：點一下就是取樣（實際的顏色等下一次重畫從「套遮色片之前」那張讀，見遮色片那段） */
    if (type === 'sample') {
      const next = { ...p, maskShowOverlay: true };
      if (p.maskType === 'color') {
        // 顏色範圍只取一個點：再點別的地方就是換成那個顏色
        next.maskColors = [{ r: -1, g: -1, b: -1, x: pt.x / W, y: pt.y / H }];
        next.maskCreated = true;
      } else next.maskLumSample = { x: pt.x / W, y: pt.y / H };
      paramsRef.current = next; isDirtyRef.current = true;
      flushParamsSync(); addToHistory(next, selectedLutIdx);
      return;
    }

    activeDragRef.current = {
      type, startX: pt.x, startY: pt.y, lastX: pt.x, lastY: pt.y,
      initialCx: p.maskCx * W, initialCy: p.maskCy * H,
      initialAngle: p.maskAngle, initialD: p.maskD * W,
      initialRx: (p.maskRx ?? 0.25) * W, initialRy: (p.maskRy ?? 0.25) * W,
    };
    if (type === 'create' || type === 'rcreate') setIsInitialCreatingMask(true);
    // 拖已經存在的遮色片：當場掛上即時疊層（用留好的底），第一下就跟手，不用先等整條管線
    else primeMaskLive(p, !!p.maskShowOverlay);
    if (type === 'paint') {
      // 筆刷：這一筆從這一點開始；即時疊層負責顯示，放手才寫回參數與復原紀錄
      maskPaintingRef.current = true;
      const next = { ...p, maskCreated: true, maskShowOverlay: true, maskStrokes: [...(p.maskStrokes || [])] };
      addDabs(next, pt.x, pt.y, pt.x, pt.y);
      paramsRef.current = next;
      if (!maskInert(next) && !updateMaskLive(next)) isDirtyRef.current = true;
    }
    setIsInteracting(true);
  };

  const handleMaskPointerMove = (e: React.PointerEvent<SVGElement>) => {
    if (!activeDragRef.current) {
      // 筆刷游標只在「選中的是筆刷、而且正在用它」的時候跟著手指（選種類時、其他種類都不畫）
      const p0 = paramsRef.current;
      if (p0.maskType === 'brush' && !maskPickingRef.current) { const pt = maskPoint(e); if (pt) moveBrushCursor(pt.x, pt.y); }
      return;
    }
    const pt = maskPoint(e); if (!pt) return;
    const canvasX = pt.x, canvasY = pt.y;
    const drag = activeDragRef.current;
    const p = { ...paramsRef.current };
    const cWidth = canvasBounds.width;
    const cHeight = canvasBounds.height;
    const dx = canvasX - drag.startX, dy = canvasY - drag.startY;

    if (drag.type === 'create') {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 5) {
        p.maskCreated = true;
        p.maskShowOverlay = true;
        p.maskCx = (drag.startX + dx / 2) / cWidth;
        p.maskCy = (drag.startY + dy / 2) / cHeight;
        p.maskD = Math.max(8, dist / 2) / cWidth;
        p.maskAngle = Math.atan2(dy, dx);
      }
    } else if (drag.type === 'center' || drag.type === 'rcenter') {
      p.maskCx = Math.max(0, Math.min(1, (drag.initialCx + dx) / cWidth));
      p.maskCy = Math.max(0, Math.min(1, (drag.initialCy + dy) / cHeight));
    } else if (drag.type === 'end' || drag.type === 'start') {
      const deltaNormal = dx * Math.cos(drag.initialAngle) + dy * Math.sin(drag.initialAngle);
      const newD = drag.type === 'end' ? Math.max(8, drag.initialD + deltaNormal) : Math.max(8, drag.initialD - deltaNormal);
      p.maskD = newD / cWidth;
    } else if (drag.type === 'rotate' || drag.type === 'rrot') {
      const a0 = Math.atan2(drag.startY - drag.initialCy, drag.startX - drag.initialCx);
      const a1 = Math.atan2(canvasY - drag.initialCy, canvasX - drag.initialCx);
      let diff = a1 - a0; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      p.maskAngle = drag.initialAngle + diff;
    } else if (drag.type === 'rcreate') {
      // 放射：按下的地方是中心，拖出去的距離是半徑（先是正圓，之後再拉兩軸）
      const dist = Math.hypot(dx, dy);
      if (dist > 5) {
        p.maskCreated = true; p.maskShowOverlay = true;
        p.maskCx = drag.startX / cWidth; p.maskCy = drag.startY / cHeight;
        p.maskRx = p.maskRy = Math.max(8, dist) / cWidth;
        p.maskAngle = 0;
      }
    } else if (drag.type === 'rx' || drag.type === 'ry') {
      // 沿著橢圓自己的軸量：拉右邊那顆改橫向半徑、上面那顆改縱向半徑
      const a = drag.initialAngle;
      const lx = (canvasX - drag.initialCx) * Math.cos(a) + (canvasY - drag.initialCy) * Math.sin(a);
      const ly = -(canvasX - drag.initialCx) * Math.sin(a) + (canvasY - drag.initialCy) * Math.cos(a);
      if (drag.type === 'rx') p.maskRx = Math.max(6, Math.abs(lx)) / cWidth;
      else p.maskRy = Math.max(6, Math.abs(ly)) / cWidth;
    } else if (drag.type === 'paint') {
      p.maskStrokes = paramsRef.current.maskStrokes;   // 同一筆：直接往後接
      addDabs(p, drag.lastX ?? canvasX, drag.lastY ?? canvasY, canvasX, canvasY);
      drag.lastX = canvasX; drag.lastY = canvasY;
      moveBrushCursor(canvasX, canvasY);
    }

    paramsRef.current = p;
    if (!(p.maskCreated && (maskInert(p) || updateMaskLive(p)))) isDirtyRef.current = true;
    /* 參考線直接改屬性，不必整個編輯器 render 一次；還沒掛上（剛開始建立）才走 React */
    if (drag.type !== 'paint' && !applyMaskGuides(p)) scheduleParamsSync();
  };

  /** 把遮色片參考線（線性：中心、軸線、起始線、結束線、旋轉把手；放射：橢圓與把手）直接改到新位置。找不到就回傳 false。 */
  const applyMaskGuides = (p: EditorParams) => {
    const svg = document.getElementById('mask-svg-overlay');
    if (!svg || !p.maskCreated) return false;
    const W = canvasBounds.width, H = canvasBounds.height;
    if ((p.maskType ?? 'linear') === 'radial') {
      const g = svg.querySelector('#ui-radial');
      if (!g) return false;
      const rx = (p.maskRx ?? 0.25) * W, ry = (p.maskRy ?? 0.25) * W, f = 1 - (p.maskFeather ?? 50) / 100;
      g.setAttribute('transform', `translate(${p.maskCx * W}, ${p.maskCy * H}) rotate(${(p.maskAngle * 180) / Math.PI})`);
      g.querySelectorAll('[data-radial-outer]').forEach(el => { el.setAttribute('rx', String(rx)); el.setAttribute('ry', String(ry)); });
      const inner = g.querySelector('[data-radial-inner]'); if (inner) { inner.setAttribute('rx', String(rx * f)); inner.setAttribute('ry', String(ry * f)); }
      g.querySelector('[data-radial-rx]')?.setAttribute('transform', `translate(${rx}, 0)`);
      g.querySelector('[data-radial-ry]')?.setAttribute('transform', `translate(0, ${-ry})`);
      g.querySelector('[data-radial-rxl]')?.setAttribute('transform', `translate(${-rx}, 0)`);
      g.querySelector('[data-radial-ryb]')?.setAttribute('transform', `translate(0, ${ry})`);
      g.querySelector('[data-radial-rot]')?.setAttribute('transform', `translate(0, ${-ry - 30})`);
      return true;
    }
    const g = svg.querySelector('#ui-guides');
    if (!g) return false;
    const d = p.maskD * W;
    g.setAttribute('transform', `translate(${p.maskCx * W}, ${p.maskCy * H}) rotate(${(p.maskAngle * 180) / Math.PI})`);
    const axis = g.querySelector('[data-mask-axis]');
    if (axis) { axis.setAttribute('x1', String(-d)); axis.setAttribute('x2', String(d)); }
    g.querySelector('[data-mask-rot]')?.setAttribute('transform', `translate(${d}, 0)`);
    g.querySelector('[data-mask-start]')?.setAttribute('transform', `translate(${-d}, 0)`);
    g.querySelector('[data-mask-end]')?.setAttribute('transform', `translate(${d}, 0)`);
    return true;
  };
  /** 筆刷游標（跟著手指的圓圈）：直接改屬性 */
  const moveBrushCursor = (x: number, y: number) => {
    const c = document.querySelector('#mask-svg-overlay [data-brush-cursor]');
    if (c) { c.setAttribute('cx', String(x + canvasBounds.left)); c.setAttribute('cy', String(y + canvasBounds.top)); c.setAttribute('visibility', 'visible'); }
  };

  const handleMaskPointerUp = (e: React.PointerEvent<SVGElement>) => {
    if (!activeDragRef.current) return;
    const drag = activeDragRef.current;
    const p = { ...paramsRef.current };
    if (drag.type === 'create' || drag.type === 'rcreate') {
      const size = drag.type === 'create' ? p.maskD * canvasBounds.width : (p.maskRx ?? 0) * canvasBounds.width;
      if (size < 15) p.maskCreated = false;
      setIsInitialCreatingMask(false);
    }
    if (drag.type === 'paint') {
      maskPaintingRef.current = false;
      p.maskStrokes = [...(p.maskStrokes || [])];
      if (!p.maskStrokes.some(s => !s.e)) p.maskCreated = false;   // 全部擦光了
      const c = document.querySelector('#mask-svg-overlay [data-brush-cursor]'); c?.setAttribute('visibility', 'hidden');
    }
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch (err) { /* 同上 */ }
    activeDragRef.current = null;
    setIsInteracting(false);
    paramsRef.current = p;
    /* 放手後整條管線照常重畫一次、把遮色片畫進畫布，同一格裡把疊層收掉（見遮色片那段） */
    if (!p.maskCreated) hideMaskLive();
    if (!releaseMaskLive(p)) isDirtyRef.current = true;
    uiFirstRef.current = true;
    flushParamsSync();
    addToHistory(p, selectedLutIdx);
  };

  /* ── 遮色片清單：新增、選取、刪除、反轉、顯示紅色範圍 ────────────────────
     選中的那一個住在 params 的 mask* 欄位；換選取時先把它寫回 masks，再把新的那一個攤開。 */
  /* 下面那一排只放九個調整；遮色片自己的參數（羽化、範圍…）在照片左邊那一欄（點了浮出滑桿） */
  const MASK_DEFAULT_TOOL: Record<MaskType, string> = { linear: 'maskBrightness', radial: 'maskBrightness', brush: 'maskBrightness', color: 'maskBrightness', luma: 'maskBrightness' };
  const commitMaskParams = (next: EditorParams) => {
    paramsRef.current = next; isDirtyRef.current = true;
    flushParamsSync(); addToHistory(next, selectedLutIdx);
  };
  const withActiveStored = (p: EditorParams): MaskSnap[] => {
    const { list, active } = maskList(p);
    if (!list.length) return [];
    const out = [...list]; out[active] = snapOf(p);
    return out;
  };
  const loadMask = (p: EditorParams, m: MaskSnap, masks: MaskSnap[], idx: number): EditorParams => {
    const next: any = { ...p, masks, maskActive: idx, maskLumSample: null };
    for (const k of MASK_SNAP_KEYS) next[k] = (m as any)[k];
    return next;
  };
  const addMask = (type: MaskType) => {
    const p = paramsRef.current;
    // 還沒畫出來的那一個（選了種類又改選別種）就不留了
    const masks = withActiveStored(p).filter(m => m.maskCreated);
    const m = freshMask(type, newMaskId());
    const list = [...masks, m];
    const next = loadMask({ ...p, maskShowOverlay: true }, m, list, list.length - 1);
    setMaskPicking(false);
    setMaskDeselected(false);
    setDismissedMaskHint(false);
    setActiveToolId(MASK_DEFAULT_TOOL[type]);
    hideMaskLive();
    commitMaskParams(next);
  };
  const selOverlayScratchRef = useRef<HTMLCanvasElement | null>(null);
  /** 顏色／明度範圍上一次畫好的紅色範圍（縮小版，依遮色片 id） */
  const maskRangeOvCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const selectMask = (i: number) => {
    const p = paramsRef.current;
    const masks = withActiveStored(p);
    setMaskDeselected(false);
    if (!masks[i] || i === maskList(p).active) return;
    setMaskPicking(false);
    uiFirstRef.current = true;
    if (!MASK_TOOLS.some(x => x.id === activeToolId)) setActiveToolId(MASK_DEFAULT_TOOL[masks[i].maskType]);
    commitMaskParams(loadMask(p, masks[i], masks, i));
    /* 紅色範圍當場換成新選的這一個（線性、放射、筆刷不必看畫面，馬上畫得出來），
       不必等整條管線重畫完 —— 以前中間會有一段完全沒有紅色。
       顏色／明度範圍要看畫面：先拿上一次畫好、留下來的那份頂著，管線畫好就換成精確的；
       從來沒畫過（例如剛載入）才先收掉，不能先露出舊的那一個。 */
    const ov = maskOverlayCanvasRef.current, np = paramsRef.current, nm = snapOf(np);
    if (ov) {
      const geo = nm.maskType === 'linear' || nm.maskType === 'radial' || nm.maskType === 'brush';
      const saved = geo ? null : maskRangeOvCacheRef.current.get(nm.maskId) || null;
      if (np.maskShowOverlay && nm.maskCreated && ov.width > 1 && (geo || saved)) {
        const a = geo ? maskAlpha(selOverlayScratchRef.current ??= document.createElement('canvas'), maskCacheId(nm), nm, ov.width, ov.height, null, '', true) : saved!;
        const og = ov.getContext('2d')!;
        og.globalCompositeOperation = 'copy'; og.fillStyle = 'rgba(220,38,38,0.5)'; og.fillRect(0, 0, ov.width, ov.height);
        og.imageSmoothingQuality = 'high';
        og.globalCompositeOperation = 'destination-in'; og.drawImage(a, 0, 0, ov.width, ov.height);
        og.globalCompositeOperation = 'source-over';
        ov.style.display = 'block';
      } else ov.style.display = 'none';
    }
  };
  const deleteMask = () => {
    const p = paramsRef.current;
    const { active } = maskList(p);
    const masks = withActiveStored(p).filter((_, i) => i !== active);
    hideMaskLive();
    if (!masks.length) {
      const f = freshMask((p.maskType as MaskType) || 'linear');
      const next: any = { ...p, masks: [], maskActive: 0, maskLumSample: null };
      for (const k of MASK_SNAP_KEYS) next[k] = (f as any)[k];
      next.maskCreated = false;
      setMaskPicking(true);
      commitMaskParams(next);
      return;
    }
    const idx = Math.min(active, masks.length - 1);
    commitMaskParams(loadMask(p, masks[idx], masks, idx));
  };
  const toggleMaskInvert = () => commitMaskParams({ ...paramsRef.current, maskInvert: !paramsRef.current.maskInvert });
  const toggleMaskOverlay = () => { const p = paramsRef.current; paramsRef.current = { ...p, maskShowOverlay: !p.maskShowOverlay }; isDirtyRef.current = true; flushParamsSync(); };
  const [maskPicking, setMaskPickingState] = useState(false);
  /* 按了＋在選新的種類：參考線收起來，紅色範圍也一起藏（繪圖迴圈看這個 ref） */
  const maskPickingRef = useRef(false);
  const setMaskPicking = (v: boolean | ((o: boolean) => boolean)) => setMaskPickingState(o => {
    const n = typeof v === 'function' ? v(o) : v;
    if (n !== maskPickingRef.current) { maskPickingRef.current = n; isDirtyRef.current = true; }
    return n;
  });
  const pinDownRef = useRef<{ i: number; x: number; y: number } | null>(null);
  /** 左邊那一欄目前浮出滑桿的是哪一個參數 */
  const [maskParamOpen, setMaskParamOpen] = useState<string | null>(null);
  /** 下排工具列在調哪一組：調節（亮度、曝光…九個）／編輯（這個遮色片自己的羽化、範圍、大小…） */
  const [maskEditMode, setMaskEditMode] = useState<'adjust' | 'edit'>('adjust');
  /* 換了選中的遮色片：回到「調節」。新增筆刷（還沒畫）例外 —— 直接停在「編輯／大小」，先調好筆刷再下筆 */
  useEffect(() => {
    if (activeCategory !== 'mask') return;
    const p = paramsRef.current;
    if (p.maskType === 'brush' && !p.maskCreated) { setMaskEditMode('edit'); setActiveToolId('maskBrushSize'); }
    else { setMaskEditMode('adjust'); setActiveToolId(t => MASK_TOOLS.some(x => x.id === t) ? t : MASK_TOOLS[0].id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.maskId, activeCategory]);
  /** 參數膠囊展開了沒（平常只有一顆「調節」圖示） */
  const [maskCapOpen, setMaskCapOpen] = useState(false);
  /* 參數方塊的過場：maskPanelTool＝方塊現在畫的是哪一個（縮回去的那段時間還留著），
     maskPanelOn＝方塊是展開的樣子。先掛上（還是那顆按鈕的大小），下一幀才展開，才補得出動畫。 */
  const [maskPanelTool, setMaskPanelTool] = useState<string | null>(null);
  const [maskPanelOn, setMaskPanelOn] = useState(false);
  /** 剛縮回去的那一顆：方塊拿掉的那一幀，按鈕要「當場」出現（不能再跑淡入，不然會閃一下） */
  const maskPanelLastRef = useRef<string | null>(null);
  useEffect(() => {
    if (maskParamOpen) {
      maskPanelLastRef.current = maskParamOpen;
      setMaskPanelTool(maskParamOpen);
      let id2 = 0;
      const id = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => setMaskPanelOn(true)); });
      return () => { cancelAnimationFrame(id); cancelAnimationFrame(id2); };
    }
    setMaskPanelOn(false);
    const t = window.setTimeout(() => setMaskPanelTool(null), 400);
    const t2 = window.setTimeout(() => { maskPanelLastRef.current = null; }, 520);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [maskParamOpen]);
  /** 右邊那一欄收起來了沒 */
  const [maskRailOpen, setMaskRailOpen] = useState(true);
  /* 線性／放射：點預覽區其他地方＝取消選中（參考線收起來、紅色範圍不顯示、九個調整先鎖住）。
     點清單裡那一格、或照片上那個遮色片的小圓點就再選回來。 */
  const [maskDeselected, setMaskDeselectedState] = useState(false);
  const maskDeselectedRef = useRef(false);
  const setMaskDeselected = (v: boolean) => {
    if (maskDeselectedRef.current === v) return;
    // 參考線、清單、下排這一幀就換好（UI 先畫），照片的紅色範圍下一幀跟上 —— 點下去當場就有反應
    maskDeselectedRef.current = v; setMaskDeselectedState(v); uiFirstRef.current = true; isDirtyRef.current = true;
  };
  useEffect(() => { if (activeCategory !== 'mask') setMaskDeselected(false); }, [activeCategory]);
  useEffect(() => { setMaskParamOpen(null); }, [activeCategory, params.maskId, params.maskType, maskPicking, maskDeselected]);
  useEffect(() => { if (activeCategory !== 'mask' || maskPicking || maskDeselected) setMaskCapOpen(false); }, [activeCategory, maskPicking, maskDeselected, params.maskId]);
  /* 換選取（或剛新增）的時候，清單裡那一格捲到看得到的地方 */
  useEffect(() => {
    if (activeCategory !== 'mask') return;
    const el = document.querySelector('[data-mask-chips] [data-on="1"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeCategory, params.maskId, params.masks?.length]);

  // Single Canvas for all rendering
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fxSurfaceRef=useRef<HTMLCanvasElement>(null);
  /** 這一次重畫是按了濾鏡／特效按鈕觸發的：走 GPU 直出 */
  const tapFastRef=useRef(false);
  /* 手機記憶體吃緊時瀏覽器會收走 GPU 的 context：收走後那張畫布再也不能用，
     只能走慢很多的 2D 備用路徑（點特效要等一下）。所以一被收走就換一張全新的畫布，
     下一格就回到 GPU，速度跟平常一樣。 */
  const [surfaceGen,setSurfaceGen]=useState(0);
  const onSurfaceLost=useCallback(()=>{
    requestAnimationFrame(()=>{
      for(const r of [softPresentRef,halationPresentRef,leakPresentRef,blurPresentRef,simplePresentRef]){try{r.current?.dispose();}catch{}r.current=null;}
      try{surfaceGpuRef.current?.dispose();}catch{}
      surfaceGpuRef.current=undefined;surfaceSrcKeyRef.current='';
      fxInputKeyRef.current='';legacyPreviewRef.current=null;
      showFxSurface(false);
      setSurfaceGen(g=>g+1);
      isDirtyRef.current=true;
    });
  },[]);
  const fxSurfaceShownRef=useRef(false);
  const fxInputKeyRef=useRef('');
  const legacyPreviewRef=useRef<{kind:LegacyKind;key:string}|null>(null);
  const showFxSurface=(shown:boolean)=>{
    // Both surfaces share the same absolute box and the parent's transform.
    // Present the GPU result directly: copying it to 2D forces a synchronous
    // framebuffer readback on iOS for every slider frame.
    fxSurfaceShownRef.current=shown;
    const surface=fxSurfaceRef.current,display=displayCanvasRef.current;
    if(surface)surface.style.visibility=shown?'visible':'hidden';
    // Keep the original canvas hit-testable for zoom and mask gestures.
    if(display){display.style.visibility='visible';display.style.opacity=shown?'0':'1';}
  };
  const visibleEditorCanvas=()=>fxSurfaceShownRef.current ? fxSurfaceRef.current : displayCanvasRef.current;
  const presentEditorSource=(ctx:CanvasRenderingContext2D,w:number,h:number)=>{
    const surface=fxSurfaceRef.current;
    showFxSurface(!!surface&&presentFxSource(ctx,w,h,surface));
  };
  useEffect(()=>{const surface=fxSurfaceRef.current;return()=>{if(surface)disposeFxSurface(surface);};},[]);
  /* 合併換來源時不要先切回 2D 畫布（那張還是舊的、沒濾鏡的，會閃一下）；讓新來源的第一次重畫決定 */
  useLayoutEffect(()=>{if(!srcSwapRef.current)showFxSurface(false);fxInputKeyRef.current='';legacyPreviewRef.current=null;},[activeSrc]);
  const helperCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  
  // Ref for showOriginal to be accessed inside loop
  const showOriginalRef = useRef(false);

  // Buffer management - full is now lazily allocated on save
  const buffers = useRef<{ preview: BufferSet, fast: BufferSet }>({ 
      preview: { source: null, dest: null, shared: null, lutted: null, lut0: null, lut100: null, temp: null, sharpenDetail: null, w: 0, h: 0 },
      fast: { source: null, dest: null, shared: null, lutted: null, lut0: null, lut100: null, temp: null, sharpenDetail: null, w: 0, h: 0 }
  });
  const sharpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (sharpenTimerRef.current !== null) clearTimeout(sharpenTimerRef.current);
  }, []);

  // Reusable 1D LUT buffer to avoid GC stutter during slider interaction
  const baseCorrectionLutRef = useRef<Uint8Array>(new Uint8Array(256));

  // Patterns for Grain/Noise Overlay
  const grainPatternRef = useRef<HTMLCanvasElement | null>(null);
  const noisePatternRef = useRef<HTMLCanvasElement | null>(null);

  /* 濾鏡解好的資料掛在模組層（見檔案上方 LUT_CACHE）——
     編輯器是「currentView === 'editor' 才掛」的元件，回首頁再進來就是全新的一份，
     快取如果放在 useRef 裡，24 顆濾鏡每次進編輯器都要重新下載＋重新解一次。
     那就是「每次點濾鏡都要加載」。 */
  const lutDataRef = useRef(LUT_CACHE);
  const loadingPromisesRef = useRef(LUT_LOADING);
  const toolsScrollRef = useRef<HTMLDivElement>(null);
  /** 是不是「從特效細項退回來」——只有這個情況才把按鈕對回畫面中間 */
  const backFromFxRef = useRef(false);
  const paramsRef = useRef(params);
  const isDirtyRef = useRef(true);

  // 拖曳遮色片與曲線時，原本每一次 pointermove 都直接 setParams，會讓整個
  // 編輯器元件重繪 —— 這是那兩個功能卡頓的主因（滑桿沒這問題是因為
  // FastSlider 用 memo + ref 繞開了）。改為立即寫入 paramsRef（畫布的渲染
  // 迴圈本來就讀這裡），而把 React 狀態同步壓到每個動畫影格最多一次。
  const paramsSyncRafRef = useRef<number | null>(null);
  const scheduleParamsSync = useCallback(() => {
    if (paramsSyncRafRef.current !== null) return;
    paramsSyncRafRef.current = requestAnimationFrame(() => {
      paramsSyncRafRef.current = null;
      setParams({ ...paramsRef.current });
    });
  }, []);
  const flushParamsSync = useCallback(() => {
    if (paramsSyncRafRef.current !== null) {
      cancelAnimationFrame(paramsSyncRafRef.current);
      paramsSyncRafRef.current = null;
    }
    setParams({ ...paramsRef.current });
  }, []);
  useEffect(() => () => {
    if (paramsSyncRafRef.current !== null) cancelAnimationFrame(paramsSyncRafRef.current);
  }, []);
  const lastRenderedShowOriginalRef = useRef(false);
  const renderTimeoutRef = useRef<any>(null);
  const lastSliderMoveTimeRef = useRef(0);
  
  // Optimize re-renders by caching the last processed pixels state with zero-cost primitive checks
  /** b.lut0（只有調節、沒有濾鏡的那一份）上次是照什麼算出來的 */
  /* lut0（只有調節、沒有濾鏡的那一份）跟選哪顆濾鏡無關，所以只要調節沒動就能一直沿用。
     但畫面會在「低解析度代理」與「完整預覽」兩種尺寸之間交替，只記一份的話
     每次換尺寸就得重算一次 —— 兩種尺寸各記一份，換來換去都不用再算。 */
  const lut0StateRef = useRef<Record<number, any>>({});
  const lastProcessedParamsRef = useRef<{
      brightness: number;
      exposure: number;
      contrast: number;
      highlights: number;
      shadows: number;
      whites?: number;
      blacks?: number;
      temp: number;
      tint: number;
      sat: number;
      vib: number;
      sharpen: number;
      lutAmount: number;
      selectedLutIdx: number;
      bufferWidth: number;
      lutSize: number;
      curvesRef: Curves | null;
      hslRef: HslAdjust | null; gradeRef?: ColorGrade | null;
  }>({
      brightness: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      temp: 0, tint: 0, sat: 0, vib: 0, sharpen: 0, lutAmount: 0,
      selectedLutIdx: -1, bufferWidth: 0, lutSize: 0, curvesRef: null, hslRef: null
  });

  // Curve Cache
  const lastCurveLutStrRef = useRef<string>('');
  const curveLutsCacheRef = useRef<{ rgb: Uint8Array, r: Uint8Array, g: Uint8Array, b: Uint8Array } | null>(null);
  
  // Track user-set blur to restore it when switching away from filters that force blur (f16/f17)
  const userManualBlurRef = useRef<number>(0);

  // Buffer cache for fast highlights/shadows rendering during drag interaction
  const extremeBuffersRef = useRef<{
    activeToolId: string;
    base: Uint8ClampedArray | null;
    min: Uint8ClampedArray | null;
    max: Uint8ClampedArray | null;
  }>({
    activeToolId: '',
    base: null,
    min: null,
    max: null
  });

  // A cache for pixel processing results of each filter to make switching instantaneous
  /** 目前緩衝區裡裝的是哪一張照片的像素（批量編輯換照片時會變） */
  const buffersSrcRef = useRef<string>('');
  /** 預覽緩衝區的 source 目前混進的是哪一組發光（每換一組加一號；0 ＝ 原圖） */
  const glowGenRef = useRef(0);
  const glowSerialRef = useRef(0);
  /** 「顏色那一段的輸入是哪一份像素」：照片＋（若有）發光那一組。快取鍵一律用它。 */
  /** 人像／仿色剛交回來、還在背景編碼的那一張：緩衝區先用暫時的鍵，畫面照樣當作是這張照片 */
  const bufferAliasRef = useRef<{ key: string; for: string } | null>(null);
  const srcIdent = () => srcIdOf(buffersSrcRef.current) + (glowGenRef.current ? `|g${glowGenRef.current}` : '');
  /** 緩衝區換人了。縮圖那兩支 effect 靠這個知道「可以重算了」——
      連結中的照片參數一模一樣，光看 params 是看不出換過照片的。 */
  const [buffersTick, setBuffersTick] = useState(0);
  /** 現在該顯示哪一張 —— 每次 render 都更新，繪圖迴圈用它擋掉「畫到舊照片」 */
  const activeSrcRef = useRef<string>(activeSrc);
  activeSrcRef.current = activeSrc;
  const filterPixelCacheRef = useRef<Record<string, {
    src: string;
    lut0: Uint8ClampedArray;
    lut100: Uint8ClampedArray | null;
    width: number;
    height: number;
    brightness: number;
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    temp: number;
    tint: number;
    sat: number;
    vib: number;
    sharpen: number;
    toneStr: string;
  }>>({});

  /* 快取的鍵要帶上解析度。畫面會在「低解析度代理」與「完整預覽」兩種尺寸之間
     交替（剛換濾鏡先出代理那張、下一幀再補完整的），兩者共用同一個鍵的話
     會一直互相覆蓋 —— 結果就是每點一次濾鏡都得整份重算，
     連剛剛才看過的那一顆也一樣。實測是 100% 沒命中。 */
  const cacheKeyOf = (lutId: string, w: number) => `${lutId}@${w}`;
  const getCachedFilterPixels = useCallback((lutId: string, p: EditorParams, w: number, h: number) => {
    const cached = filterPixelCacheRef.current[cacheKeyOf(lutId, w)];
    if (!cached) return null;
    // 批量編輯時兩張照片的尺寸常常一模一樣，只比尺寸會拿到「另一張的像素」——
    // 一定要連「這份是哪一張的」也對得上才敢用。
    if (cached.src !== buffersSrcRef.current) return null;
    if (cached.width !== w || cached.height !== h) return null;
    if (cached.brightness !== p.brightness) return null;
    if (cached.exposure !== p.exposure) return null;
    if (cached.contrast !== p.contrast) return null;
    if (cached.highlights !== p.highlights) return null;
    if (cached.shadows !== p.shadows) return null;
    if (cached.temp !== p.temp) return null;
    if (cached.tint !== p.tint) return null;
    if (cached.sat !== p.sat) return null;
    if (cached.vib !== p.vib) return null;
    if (cached.sharpen !== p.sharpen) return null;
    if (cached.toneStr !== toneSig(p)) return null;
    return cached;
  }, []);

  /* 一份 lut0 + lut100 在 1350×1800 就要 19 MB，手機上留太多份會直接把記憶體吃光
     （進而觸發回收、變得更卡）。只留最近用到的幾份，夠涵蓋「兩顆濾鏡來回比較」
     這個最常見的情境。 */
  /* 6 份在 1800px 預覽約 117 MB，疊上特效的 GPU 緩衝後會超過 iPhone 給單一分頁的
     記憶體上限，Safari 直接把頁面重新載入。2 份仍涵蓋「兩顆濾鏡來回比較」。 */
  /* 依裝置的記憶體決定留幾份，而不是一律砍：iPhone（不公開記憶體大小、單一分頁上限最嚴）
     給 40 MB，約 2 份；記憶體 ≥8GB 的電腦／手機給 120 MB，約 6 份（跟原本一樣快）；
     其他給 60 MB，約 3 份。照片小的時候一份小，能留的份數自然變多。 */
  const FILTER_CACHE_BUDGET = (() => {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const mem = (navigator as any).deviceMemory as number | undefined;
    return (ios ? 40 : mem && mem >= 8 ? 120 : 60) * 1024 * 1024;
  })();
  const cacheOrderRef = useRef<string[]>([]);
  const cacheFilterPixels = useCallback((lutId: string, p: EditorParams, w: number, h: number, lut0: Uint8ClampedArray, lut100: Uint8ClampedArray | null) => {
    const key = cacheKeyOf(lutId, w);
    const order = cacheOrderRef.current;
    const at = order.indexOf(key);
    if (at >= 0) order.splice(at, 1);
    order.push(key);
    // 新的這份加上舊的，總量超過預算就從最久沒用的開始丟（至少留新的這份）
    const bytesOf = (k: string) => { const e = filterPixelCacheRef.current[k]; return e ? e.lut0.byteLength + (e.lut100?.byteLength || 0) : 0; };
    let total = lut0.byteLength + (lut100?.byteLength || 0);
    for (const k of order) if (k !== key) total += bytesOf(k);
    while (order.length > 1 && total > FILTER_CACHE_BUDGET) {
      const drop = order.shift()!;
      total -= bytesOf(drop);
      delete filterPixelCacheRef.current[drop];
    }
    filterPixelCacheRef.current[key] = {
      src: buffersSrcRef.current,
      lut0: new Uint8ClampedArray(lut0),
      lut100: lut100 ? new Uint8ClampedArray(lut100) : null,
      width: w,
      height: h,
      brightness: p.brightness,
      exposure: p.exposure,
      contrast: p.contrast,
      highlights: p.highlights,
      shadows: p.shadows,
      temp: p.temp,
      tint: p.tint,
      sat: p.sat,
      vib: p.vib,
      sharpen: p.sharpen,
      toneStr: toneSig(p)
    };
  }, []);

  /* ---- 背景預熱 ----------------------------------------------------------
     目前這張弄好、使用者手停下來之後，就在背景把其他連結中的照片先算好：
     先解碼，再把「調節 + 濾鏡」那兩張像素圖（lut0 / lut100）算出來放著。
     切過去的時候 render() 直接拿現成的，不用當場重算 —— 這是切換時最花時間的一段。
     特效（顆粒、柔焦、光暈那些）沒有先算：它們吃的是一整組跟著畫布走的快取畫布，
     搬到背景會動到現有的繪圖流程，所以留在切換後才算。
     一次只做一張、每一步之間都讓出主執行緒，才不會跟前景搶資源。
     記憶體有限，最多只留 WARM_MAX 張，多的就丟掉最舊的。                     */
  type WarmPixels = {
    w: number; h: number;
    lutId: string;
    p: EditorParams;
    lut0: Uint8ClampedArray;
    lut100: Uint8ClampedArray | null;
  };
  const WARM_MAX = 2;
  const warmImgRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const warmPixelsRef = useRef<Map<string, WarmPixels>>(new Map());
  /* 使用者「真的看過」的那幾張，解好的圖另外收在這裡。
     背景預熱那份（warmImgRef）會一直被後面排隊的照片擠掉 —— 照片一多，
     擠掉的正好就是使用者正在來回切的那兩張，於是切回去又要重解一次碼。
     這一份只有切換時會寫，預熱碰不到，來回切才會是即時的。 */
  const VIEWED_IMG_MAX = 5;
  const viewedImgRef = useRef<Map<string, HTMLImageElement>>(new Map());

  /* ---- 底下那條批量縮圖列的小圖 -----------------------------------------
     格子只有 36×36，但以前 <img> 的 src 直接掛的是原圖 ——
     瀏覽器會把每一張都完整解碼、而且只要那個 <img> 還在畫面上就一直留著。
     十張 1200 萬像素的照片就是好幾百 MB 的點陣圖釘在記憶體裡，
     拖滑桿時的卡頓、以及照片一多就變慢，都是從這裡來的。
     這裡先把每一張縮成 72×72 再給那條列用，原圖用完就可以被回收。 */
  const STRIP_THUMB = 72;
  const [stripThumbs, setStripThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    const missing = srcList.filter(s => s && !stripThumbs[s]);
    if (!missing.length) return;
    let alive = true;
    const make = (s: string) => new Promise<void>(resolve => {
      /* iOS WebKit 的 load 只代表檔案讀到了，像素不一定已經畫得進 canvas ——
         這時 drawImage 畫出來是透明的，再存成 JPEG 就變成一格全黑
         （剛匯入時第一張最常中，因為它一進來就被拿去做縮圖）。
         先等 decode() 再跨一幀才畫；畫完檢查真的有像素，沒有就等一下重畫。 */
      const finish = async (img: HTMLImageElement, attempt = 0) => {
        if (!alive) return resolve();
        try { if (typeof img.decode === 'function') await img.decode(); } catch { /* onload 已成功 */ }
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        if (!alive) return resolve();
        try {
          const c = document.createElement('canvas');
          c.width = STRIP_THUMB; c.height = STRIP_THUMB;
          const cx = c.getContext('2d', { willReadFrequently: true })!;
          cx.imageSmoothingQuality = 'high';
          const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
          const k = Math.max(STRIP_THUMB / sw, STRIP_THUMB / sh);
          cx.drawImage(img, (STRIP_THUMB - sw * k) / 2, (STRIP_THUMB - sh * k) / 2, sw * k, sh * k);
          const d = cx.getImageData(0, 0, STRIP_THUMB, STRIP_THUMB).data;
          let painted = false;
          for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) { painted = true; break; }
          if (!painted && attempt < 4) { setTimeout(() => { void finish(img, attempt + 1); }, 150 * (attempt + 1)); return; }
          const url = c.toDataURL('image/jpeg', 0.82);
          setStripThumbs(prev => (prev[s] ? prev : { ...prev, [s]: url }));
        } catch { /* 跨來源之類的就算了，那一格留底色 */ }
        resolve();
      };
      const had = viewedImgRef.current.get(s) || warmImgRef.current.get(s);
      if (had && had.complete && had.naturalWidth) return finish(had);
      const im = new Image();
      if (!s.startsWith('blob:') && !s.startsWith('data:')) im.crossOrigin = 'anonymous';
      im.onload = () => finish(im);
      im.onerror = () => resolve();
      im.src = s;
    });
    (async () => { for (const s of missing) { if (!alive) return; await make(s); } })();
    return () => { alive = false; };
  }, [srcList, stripThumbs]);
  /** 這張的圖已經解好了嗎？順便把它移到最新，才不會被下一張擠掉 */
  const takeDecoded = (src: string): HTMLImageElement | null => {
    const im = viewedImgRef.current.get(src) || warmImgRef.current.get(src);
    if (!im || !im.complete || !im.naturalWidth) return null;
    viewedImgRef.current.delete(src);
    viewedImgRef.current.set(src, im);
    return im;
  };
  const rememberDecoded = (src: string, im: HTMLImageElement) => {
    viewedImgRef.current.delete(src);
    viewedImgRef.current.set(src, im);
    while (viewedImgRef.current.size > VIEWED_IMG_MAX) {
      const oldest = viewedImgRef.current.keys().next().value as string;
      if (oldest === src) break;
      const old = viewedImgRef.current.get(oldest);
      viewedImgRef.current.delete(oldest);
      // 讓瀏覽器真的丟掉那張解碼好的大圖（合併越多張，留著的全尺寸圖越多）
      if (old && old !== originalImgRef.current) old.src = '';
    }
  };
  /** 預熱出來的像素圖跟現在的參數還對得上嗎？對得上才敢用 */
  const warmSigOf = (p: EditorParams, lutId: string, w: number, h: number) =>
    [lutId, w, h, p.brightness, p.exposure, p.contrast, p.highlights, p.shadows,
     p.temp, p.tint, p.sat, p.vib, p.sharpen, toneSig(p)].join('|');
  const warmSigRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (srcList.length <= 1) return;
    // 手指還在滑桿上就完全不做。這裡一張照片要跑兩趟 processPixels、
    // 最大到 1800px，一趟就是好幾十毫秒的同步運算 —— 排在拖曳中間就是一次掉格。
    // isInteracting 一變成 true，清理函式會把正在跑的那一輪也一起停掉。
    // （量到 3 張照片時 p99 畫格 89.7ms，單張只有 20.3ms，差距就是這個。）
    if (isInteracting) return;
    let cancelled = false;
    const yieldTo = (fn: () => void) => { if (!cancelled) window.setTimeout(fn, 0); };
    const t = window.setTimeout(() => {
      // 只預熱「連結中」的 —— 沒連結的那幾張參數各走各的，先算了也是白算
      // 已經留著「畫好的整張」而且還對得上的，切過去直接用那份，不必再背景算一次（省下每張兩趟整張運算）
      const queue = srcList.filter((u, i) => u !== activeSrc && linked[i] !== false && !shotValid(i, liveRef.current));
      const live = liveRef.current;
      if (!live) return;
      const lut = lutList[live.selectedLutIdx];
      if (!lut) return;
      const activeLut = lut.url ? lutDataRef.current[lut.id] : null;
      // 濾鏡檔還沒下載完就先不算，等下一輪（參數沒變的話下一輪自然會補上）
      if (lut.url && !activeLut) return;
      const p: EditorParams = JSON.parse(JSON.stringify(live.params));

      const step = () => {
        if (cancelled) return;
        const src = queue.shift();
        if (!src) return;

        const PREVIEW_SIZE = 1800;
        const done = () => yieldTo(step);
        const withImg = (img: HTMLImageElement) => {
          if (cancelled) return;
          let pw = img.naturalWidth || img.width, ph = img.naturalHeight || img.height;
          if (!pw || !ph) return done();
          if (pw > PREVIEW_SIZE || ph > PREVIEW_SIZE) {
            const r = Math.min(PREVIEW_SIZE / pw, PREVIEW_SIZE / ph);
            pw = (pw * r) | 0; ph = (ph * r) | 0;
          }
          pw = Math.max(1, pw); ph = Math.max(1, ph);
          const sig = warmSigOf(p, lut.id, pw, ph);
          if (warmSigRef.current.get(src) === sig) return done(); // 這張已經是最新的了
          let source: Uint8ClampedArray;
          try {
            const c = document.createElement('canvas');
            c.width = pw; c.height = ph;
            const cx = c.getContext('2d', { willReadFrequently: true })!;
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(img, 0, 0, pw, ph);
            source = cx.getImageData(0, 0, pw, ph).data;
          } catch { return done(); }
          // 讓一次主執行緒，再開始算像素
          yieldTo(() => {
            if (cancelled) return;
            let lut0: Uint8ClampedArray, lut100: Uint8ClampedArray | null = null;
            const baseLut = new Uint8Array(256);
            // 自己算一份曲線表 —— 不去碰前景那份共用快取
            const curveLuts = {
              rgb: generateCurveLut(p.curves.rgb), r: generateCurveLut(p.curves.r),
              g: generateCurveLut(p.curves.g), b: generateCurveLut(p.curves.b),
            };
            try {
              generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, baseLut);
              lut0 = new Uint8ClampedArray(source.length);
              processPixels(source, lut0, pw, ph, p, null, 0, baseLut, null, false, curveLuts, localFor(p, source, pw, ph, `warm|${pw}x${ph}|${src}`));
            } catch { return done(); }
            yieldTo(() => {
              if (cancelled) return;
              try {
                if (activeLut) {
                  lut100 = new Uint8ClampedArray(source.length);
                  processPixels(source, lut100, pw, ph, { ...p, lutAmount: 100 }, activeLut.data, activeLut.size, baseLut, null, false, curveLuts, localFor(p, source, pw, ph, `warm|${pw}x${ph}|${src}`));
                }
              } catch { lut100 = null; }
              if (cancelled) return;
              warmPixelsRef.current.set(src, { w: pw, h: ph, lutId: lut.id, p, lut0, lut100 });
              warmSigRef.current.set(src, sig);
              // 超過上限就丟掉最舊的（Map 依插入順序）
              while (warmPixelsRef.current.size > WARM_MAX) {
                const oldest = warmPixelsRef.current.keys().next().value as string;
                warmPixelsRef.current.delete(oldest);
                warmSigRef.current.delete(oldest);
              }
              done();
            });
          });
        };

        // 看過的那幾張已經解好了，別再解一次（只讀不動順序，免得預熱把它們往前推）
        const cached = warmImgRef.current.get(src) || viewedImgRef.current.get(src);
        if (cached && cached.complete && cached.naturalWidth) return withImg(cached);
        const im = new Image();
        if (!src.startsWith('blob:') && !src.startsWith('data:')) im.crossOrigin = 'anonymous';
        im.onload = () => {
          warmImgRef.current.set(src, im);
          while (warmImgRef.current.size > WARM_MAX + 1) {
            const oldest = warmImgRef.current.keys().next().value as string;
            if (oldest === src) break;
            warmImgRef.current.delete(oldest);
          }
          yieldTo(() => withImg(im));
        };
        im.onerror = done;
        im.src = src;
      };
      step();
    }, 900);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [activeSrc, srcList, linked, params, selectedLutIdx, lutList, isInteracting]);
  /** 切過去時，把背景算好的那份直接塞進 render() 本來就在用的快取 */
  const seedWarmPixels = useCallback((src: string, w: number, h: number) => {
    const warm = warmPixelsRef.current.get(src);
    if (!warm || warm.w !== w || warm.h !== h) return;
    const p = warm.p;
    filterPixelCacheRef.current[cacheKeyOf(warm.lutId, warm.w)] = {
      src,
      lut0: warm.lut0,
      lut100: warm.lut100,
      width: w, height: h,
      brightness: p.brightness, exposure: p.exposure, contrast: p.contrast,
      highlights: p.highlights, shadows: p.shadows, temp: p.temp, tint: p.tint,
      sat: p.sat, vib: p.vib, sharpen: p.sharpen,
      toneStr: toneSig(p),
    };
    // 已經交棒給前景的快取了，預熱區就把位子讓出來給還沒算的那幾張
    warmPixelsRef.current.delete(src);
    warmSigRef.current.delete(src);
  }, []);
  /** 把背景算好的那張直接畫到畫布上（lut0 與 lut100 依濾鏡強度混合） */
  const paintWarmNow = (src: string, snap: BatchSnap | null): boolean => {
    showFxSurface(false);fxInputKeyRef.current='';
    const warm = warmPixelsRef.current.get(src);
    const cvs = displayCanvasRef.current;
    if (!warm || !cvs) return false;
    // 預熱之後參數又被改過的話，那份就不能用了 —— 畫上去會是舊的調整。
    if (snap) {
      const lut = lutList[snap.selectedLutIdx];
      if (!lut || warmSigRef.current.get(src) !== warmSigOf(snap.params, lut.id, warm.w, warm.h)) return false;
    }
    const { w, h, lut0, lut100 } = warm;
    const amt = Math.max(0, Math.min(100, warm.p.lutAmount ?? 0)) / 100;
    const out = new Uint8ClampedArray(lut0.length);
    if (lut100 && amt > 0) {
      for (let i = 0; i < out.length; i++) out[i] = lut0[i] + (lut100[i] - lut0[i]) * amt;
    } else {
      out.set(lut0);
    }
    if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
    const ctx = cvs.getContext('2d');
    if (!ctx) return false;
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    cvs.style.filter = 'none';
    warmPaintedSrcRef.current = src;
    // 比例跟畫布尺寸同一拍寫進去，換照片時才不會有一兩幀被拉伸
    applyPreviewAspect(w, h);
    return true;
  };
  /** 已經用預熱的畫面補過的那一張 —— 待會就別再畫一次「還沒調整」的樣子 */
  const warmPaintedSrcRef = useRef<string | null>(null);
  const seedWarmPixelsRef = useRef(seedWarmPixels);
  seedWarmPixelsRef.current = seedWarmPixels;
  /** 像素迴圈的 JIT 暖機，整個編輯器開著只需要做一次 */
  const pipelineWarmedRef = useRef(false);

  const fastPreviewCacheRef = useRef<{
      active: boolean;
      toolId: string;
      baseCanvas: HTMLCanvasElement | null;
      minCanvas: HTMLCanvasElement | null;
      maxCanvas: HTMLCanvasElement | null;
  }>({ active: false, toolId: '', baseCanvas: null, minCanvas: null, maxCanvas: null });

  const cachedBlurCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedSoftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedNoise2CanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedHalationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedVignetteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compiledGrainPatternRef = useRef<CanvasPattern | null>(null);
  const compiledNoisePatternRef = useRef<CanvasPattern | null>(null);
  /** 特效拖曳現在用全解析度嗎（見 render 裡的說明，會照耗時自動切換） */
  const fxFullResRef = useRef(true);
  /** 剛換濾鏡：先用低解析度畫一張，下一幀再補全解析度 */
  const quickFilterRef = useRef(false);
  const lut0CanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lut100CanvasRef = useRef<HTMLCanvasElement | null>(null);

  /* ── 遮色片用的兩張離屏畫布 ────────────────────────────────────────────
     以前這兩張是每一幀 document.createElement 出來的，1800×1350 兩張，
     拖一次遮色片就是幾百張畫布的配置與回收。改成整個編輯階段共用同兩張。
     maskTemp：整張套上遮色片調整後的樣子（沒有去背，所以可以留著重複用）
     maskOut ：把 maskTemp 用漸層去背之後、真正要疊回畫面的那張
     maskAdjKey：maskTemp 目前裝的是照什麼參數算的；空字串代表不可沿用 */
  const maskTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskOutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskAdjKeyRef = useRef<string>('');
  /* 拖遮色片形狀／刷筆刷時的即時疊層（見遮色片那段）：maskLiveAdj 裝「整張套上這個遮色片調整後的樣子」，
     每一格只把它用目前的選取範圍挖一次，貼在 maskLive 那張（疊在照片上面的畫布）。
     maskLiveKey：maskLiveAdj 目前裝的是照什麼算的。 */
  const maskLiveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskLiveAdjRef = useRef<HTMLCanvasElement | null>(null);
  const maskLiveAlphaRef = useRef<HTMLCanvasElement | null>(null);
  const maskAlphaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskBaseCopyRef = useRef<HTMLCanvasElement | null>(null);
  const maskPrefixRef = useRef<HTMLCanvasElement | null>(null);
  const maskPrefixKeyRef = useRef('');
  const maskLiveRef = useRef(false);
  const maskLiveKeyRef = useRef('');
  /** 正在用筆刷塗（跟拖形狀一樣走即時疊層） */
  const maskPaintingRef = useRef(false);
  /* 即時疊層用比較小的解析度（長邊最多 1100）：拖曳中每一格只要挖這張，手機上才跟得上手指；
     放手後整條管線用原解析度重畫一次 */
  const paintMaskLive = (m: MaskSnap) => {
    const el = maskLiveCanvasRef.current, adj = maskLiveAdjRef.current; if (!el || !adj) return;
    const w = adj.width, h = adj.height;
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    const al = maskLiveAlphaRef.current ??= document.createElement('canvas');
    // 顏色／明度範圍看的是拖曳開始時那張畫面（pre），拖的時候用縮小的那張算選取
    maskAlpha(al, maskCacheId(m), m, w, h, maskLivePreRef.current, `live|${maskLivePreKeyRef.current}`, true);
    const g = el.getContext('2d')!;
    g.globalCompositeOperation = 'copy'; g.drawImage(adj, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(al, 0, 0);
    g.globalCompositeOperation = 'source-over';
    el.style.display = 'block';
    if (maskOverlayCanvasRef.current) maskOverlayCanvasRef.current.style.display = 'none';   // 疊層自己有紅色
    maskLiveRef.current = true;
  };
  /** 拖曳／塗抹的每一步：疊層已經掛著就直接重挖一次，不重跑管線 */
  const updateMaskLive = (p: EditorParams) => {
    const el = maskLiveCanvasRef.current;
    const adj = maskLiveAdjRef.current;
    if (!maskLiveRef.current || !el || !adj) return false;
    paintMaskLive(snapOf(p));
    return true;
  };
  const maskSkipDirtyRef = useRef(false);
  const maskOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 剛剛的變化只有「紅色範圍顯示／隱藏」 */
  const overlayOnlyRef = useRef(false);
  /** 上一次整條管線畫的是哪一份參數（用來確認真的只有紅色範圍的開關不一樣） */
  const lastFullRenderParamsRef = useRef<EditorParams | null>(null);
  /** 只更新紅色範圍那一層。做不到（缺少上一次算好的東西）就回傳 false，照舊整張重畫 */
  const paintOverlayOnlyRef = useRef<(p: EditorParams) => boolean>(() => false);
  /* 「選中這一個以外都畫好」的整張（原解析度）：每次正常重畫時順手留一份，
     開始拖的那一下直接拿來當底、掛上即時疊層，不必先等整條管線跑一次（就是開始拖時那一頓） */
  const maskNoActiveRef = useRef<HTMLCanvasElement | null>(null);
  const maskNoActiveKeyRef = useRef('');
  const maskPreKeyOf = (p: EditorParams, w: number, h: number, list: MaskSnap[], active: number) =>
    `${w}x${h}|${srcIdent()}|${selectedLutIdxNowRef.current}|${JSON.stringify(Object.entries(p).filter(([k]) => !k.startsWith('mask')))}|${JSON.stringify(list.filter((_, i) => i !== active))}`;
  const primeMaskLive = (p: EditorParams, overlay: boolean) => {
    if (maskLiveRef.current) return true;
    if (maskInert(p)) return false;
    const snap = maskNoActiveRef.current, el = displayCanvasRef.current;
    if (!snap || !el || hasActiveFx(p)) return false;
    const { list, active } = maskList(p);
    const act = list[active];
    if (!act?.maskCreated) return false;
    const w = el.width, h = el.height;
    if (snap.width !== w || snap.height !== h) return false;
    const key = maskPreKeyOf(p, w, h, list, active);
    if (key !== maskNoActiveKeyRef.current) return false;
    const g = el.getContext('2d')!;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy'; g.drawImage(snap, 0, 0); g.restore();
    // 平常畫面是透過 GPU 那層顯示的；拖的這段改看 2D 畫布（底）＋即時疊層，放手後的重畫再切回去
    if (fxSurfaceShownRef.current) showFxSurface(false);
    const k = Math.min(1, MASK_LIVE_MAX / Math.max(w, h));
    const lw = Math.max(1, Math.round(w * k)), lh = Math.max(1, Math.round(h * k));
    const pre = maskLivePreRef.current ??= document.createElement('canvas');
    if (maskLivePreKeyRef.current !== key || pre.width !== lw || pre.height !== lh) {
      if (pre.width !== lw || pre.height !== lh) { pre.width = lw; pre.height = lh; }
      const pg = pre.getContext('2d')!;
      pg.globalCompositeOperation = 'copy'; pg.imageSmoothingQuality = 'high'; pg.drawImage(snap, 0, 0, lw, lh); pg.globalCompositeOperation = 'source-over';
      maskLivePreKeyRef.current = key;
      maskLiveKeyRef.current = '';
    }
    liveAdjust(act, overlay);
    paintMaskLive(act);
    return true;
  };
  /** 放手時：這個遮色片沒有任何調整、紅色範圍也沒開 → 畫面跟拖之前一模一樣，收掉疊層就好，不必整條重畫（放手那一頓） */
  /** 這個遮色片沒有任何調整、紅色範圍也關著：搬它、縮放它畫面都不會變，只要動參考線，不必重畫 */
  const maskInert = (p: EditorParams) => !p.maskShowOverlay && !!p.maskCreated && !hasMaskAdj(snapOf(p));
  const releaseMaskLive = (p: EditorParams) => {
    if (!maskInert(p)) return false;
    if (maskLiveRef.current) hideMaskLive();
    maskSkipDirtyRef.current = true;
    return true;
  };
  const hideMaskLive = () => {
    const el = maskLiveCanvasRef.current;
    if (el) el.style.display = 'none';
    maskLiveRef.current = false;
  };
  /** 把整張畫面套上這個遮色片的調整，放進 dst（跟全圖的調節同一套公式：utils/photoToneMath） */
  const adjustMaskInto = (dst: HTMLCanvasElement, src: CanvasImageSource, m: MaskSnap, w: number, h: number) => {
    if (dst.width !== w || dst.height !== h) { dst.width = w; dst.height = h; }
    const g = dst.getContext('2d', { willReadFrequently: true })!;
    g.globalCompositeOperation = 'copy'; g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-over';
    const imgData = g.getImageData(0, 0, w, h);
    maskTonePixels(imgData.data, m);
    g.putImageData(imgData, 0, 0);
  };
  /* ── 即時疊層（拖遮色片形狀、刷筆刷、拖任何一根遮色片滑桿）──────────────────
     底下的主畫布先畫好「選中這一個以外」的樣子，選中這一個的結果畫在上面那張畫布：
       pre ：這一次拖曳開始時的畫面（縮成長邊 1100），整段拖曳都不會變；
       adj ：pre 套上選中這一個的調整（GPU 一次查表：調整先烤成 33³ 的查色表，
             跟 CPU 同一支公式；沒有 GPU 才在縮小的 pre 上用 CPU 算）；
       上面那張 ＝ adj 用目前的選取範圍挖出來。
     所以拖滑桿的每一格只有：烤一顆小表＋一次 GPU 查表＋幾次 2D 合成，整條管線一次都不重跑；
     拖範圍類的滑桿（範圍、平滑、羽化…）連表都不用烤，只重算選取範圍。 */
  const MASK_LIVE_MAX = 1100;
  const maskLivePreRef = useRef<HTMLCanvasElement | null>(null);
  const maskLivePreKeyRef = useRef('');
  const maskGpuRef = useRef<LutGpu | null | undefined>(undefined);
  const maskGpuSrcRef = useRef('');
  /** 正在拖遮色片的滑桿（走即時疊層）；maskRangeDrag：拖的是遮色片自己的參數（範圍、羽化…）→ 紅色遮罩跟著即時變 */
  const maskSliderLiveRef = useRef(false);
  const maskRangeDragRef = useRef(false);
  const liveAdjust = (m: MaskSnap, overlay: boolean) => {
    const pre = maskLivePreRef.current; if (!pre) return;
    const la = maskLiveAdjRef.current ??= document.createElement('canvas');
    if (la.width !== pre.width || la.height !== pre.height) { la.width = pre.width; la.height = pre.height; maskLiveKeyRef.current = ''; }
    const key = `${maskLivePreKeyRef.current}|${overlay ? 1 : 0}|${MASK_ADJ_KEYS.map(k => (m as any)[k]).join(',')}`;
    if (maskLiveKeyRef.current === key) return;
    const lg = la.getContext('2d')!;
    if (hasMaskAdj(m)) {
      let done = false;
      if (maskGpuRef.current === undefined) maskGpuRef.current = LutGpu.create();
      const gpu = maskGpuRef.current;
      if (gpu && !gpu.lost && gpu.fits(pre.width, pre.height)) {
        const sk = `${maskLivePreKeyRef.current}|${pre.width}x${pre.height}`;
        if (maskGpuSrcRef.current !== sk && gpu.setSourceImage(pre, pre.width, pre.height)) maskGpuSrcRef.current = sk;
        if (maskGpuSrcRef.current === sk) {
          const tex = bakedToTexture(bakeColorLut((src, dst) => { dst.set(src); maskTonePixels(dst, m); }, 33));
          const out = gpu.setLut(tex, 33) ? gpu.draw() : null;
          if (out) { lg.globalCompositeOperation = 'copy'; lg.drawImage(out, 0, 0); lg.globalCompositeOperation = 'source-over'; done = true; }
        }
      }
      if (!done) adjustMaskInto(la, pre, m, pre.width, pre.height);
    } else { lg.globalCompositeOperation = 'copy'; lg.fillStyle = 'rgba(0,0,0,0)'; lg.fillRect(0, 0, la.width, la.height); lg.globalCompositeOperation = 'source-over'; }
    if (overlay) { lg.fillStyle = 'rgba(220,38,38,0.5)'; lg.fillRect(0, 0, la.width, la.height); }
    maskLiveKeyRef.current = key;
  };
  /** 拖滑桿的每一格：疊層已經掛著就只更新疊層（不跑管線）。回傳 false 代表還沒掛好，照舊整條重畫 */
  const maskLiveFrame = (p: EditorParams, overlay: boolean) => {
    if (!maskLiveRef.current || !maskLivePreRef.current) return false;
    const m = snapOf(p);
    if (!m.maskCreated) return false;
    liveAdjust(m, overlay);
    paintMaskLive(m);
    return true;
  };
  /* 拖遮色片滑桿時留下來的底圖（顏色鏈與特效都跑完、還沒上遮色片的樣子）。
     那一整段時間它完全不會變，所以只從主畫布回讀一次。
     maskBaseData：留下來的那一份；maskScratch：每一幀拿來算的工作區；
     maskBaseKey：留的是哪一塊（空字串代表不可沿用）。 */
  const maskBaseDataRef = useRef<ImageData | null>(null);
  const maskScratchRef = useRef<ImageData | null>(null);
  const maskBaseKeyRef = useRef<string>('');
  /** 曝光＋亮度＋對比合成的一維查色表（見遮色片那段的說明）。
      浮點那張給「後面還有其他步驟」時用（精度不能先掉）；
      整數那張給「只有色調」的快速路徑用。 */
  const maskToneLutRef = useRef<Float32Array>(new Float32Array(256));
  const maskTone8Ref = useRef<Uint8ClampedArray>(new Uint8ClampedArray(256));

  /* ── 前後對比：按下去之前那張先留一份 ──────────────────────────────────
     放開按鈕時，畫面要回到的就是按下去之前的那一張，一個像素都不會不一樣。
     所以與其整條管線再跑一次（有遮色片效果時量到 95ms，按起來就是「頓一下
     才回來」），不如按下去的時候先把畫布複製一份，放開直接貼回去 —— 一次
     GPU 搬移，跟照片多大、開了多少特效都無關。
     只有「按著的期間畫面沒有任何其他變化」才敢貼（isDirtyRef 沒被舉起來），
     否則照樣走完整重畫。 */
  const compareSnapRef = useRef<HTMLCanvasElement | null>(null);
  const compareSnapKeyRef = useRef<string>('');

  /* ── GPU 顏色鏈 ───────────────────────────────────────────────────────
     整條顏色鏈是純粹的 RGB→RGB 函數，所以先用**現有的 processPixels 本身**
     在 N³ 個格點上算一次（33³ 只要 2.2ms），烤成一顆 3D 查色表，
     再讓 GPU 用一個 draw call 把整張圖查完（實測 0.1ms，對照 CPU 逐像素 70.8ms）。
     顏色公式一行都沒有重寫 —— 真理來源仍然是那份 CPU 程式碼。

     拖曳中用 33³、手放開用 65³：兩者的色差分別是 4 與 3 個色階（肉眼分辨不出），
     而**解析度全程都是全解析度**，不再降級成模糊的代理。 */
  const gpuRef = useRef<LutGpu | null | undefined>(undefined);
  const gpuSrcKeyRef = useRef('');
  /** 上一輪有沒有走 GPU。切換時要強制重算，否則 CPU 那份像素會停在舊的。 */
  const lastGpuRef = useRef(false);
  /* 這台裝置的 GPU 到底比 CPU 快嗎？—— 不用猜的，開起來實際量。
     有真正顯示卡的手機上，GPU 查表是壓倒性的快；但在沒有硬體加速的環境
     （某些桌機瀏覽器、無障礙模式、虛擬機）GPU 是軟體模擬的，反而更慢。
     所以「靜止時要不要用 GPU」由實測決定：
       · 先各記一次兩條路的耗時
       · GPU 明顯比較快才讓它接手靜止時的繪製
     拖曳中則永遠用 GPU —— 那不是為了快，是為了**不降解析度**，
     那是主人明確要求的畫質，即使慢一點也值得。 */
  const gpuMsRef = useRef(0);
  const cpuMsRef = useRef(0);
  const gpuWinsRef = useRef<boolean | null>(null);
  const gpuWarmKeyRef = useRef('');
  /* 烤好的 3D 查色表快取。鍵＝格點數｜顏色參數｜哪一顆濾鏡。
     跟圖片無關，所以換照片也不必清。 */
  const bakeCacheRef = useRef<Map<string, Uint8Array>>(new Map());
  /* getCurveLuts 宣告在這之後，這裡用 ref 間接取用，避免暫時死區 */
  const curveLutsFnRef = useRef<(c: Curves) => { rgb: Uint8Array; r: Uint8Array; g: Uint8Array; b: Uint8Array }>(
    () => ({ rgb: new Uint8Array(256), r: new Uint8Array(256), g: new Uint8Array(256), b: new Uint8Array(256) }));
  /* 只把「會影響顏色鏈」的參數寫進鍵。銳化、顆粒、模糊那些不在裡面 ——
     它們不是烤進表裡的東西，放進去只會讓快取白白失效。 */
  const bakeSigRef = useRef((p: EditorParams) =>
    `${p.brightness},${p.exposure},${p.contrast},${p.highlights},${p.shadows},${p.whites || 0},${p.blacks || 0},`
    + `${p.temp},${p.tint},${p.sat},${p.vib},${p.lutAmount},`
    + `${JSON.stringify(p.curves)},${JSON.stringify(p.hsl)},${isGradeIdentity(p.grade) ? '' : JSON.stringify(p.grade)}`);
  const exportC0Ref = useRef<HTMLCanvasElement | null>(null);
  const exportC100Ref = useRef<HTMLCanvasElement | null>(null);

  /**
   * 先把 GPU 暖起來：上傳整張圖的貼圖、建立 3D 查色表、跑一次空的 draw。
   * 這些是一次性的成本（一張 148 萬像素的圖光上傳就要好幾毫秒），
   * 不先做的話它們會全部落在「手指剛按上滑桿的那一幀」，
   * 看起來就是主人說的「開始拖動時抖一下」。
   * 在閒置時做掉，拖曳的第一幀就只剩烤表 2.2ms ＋ 畫 0.1ms。
   */
  /**
   * 閒著的時候，把「還沒烤過的濾鏡查色表」先烤起來。
   *
   * 這是「點濾鏡零延遲」真正的關鍵：有快取只解決了「再點回去」，
   * 第一次點還是要現烤（65³ 約 16ms）。趁使用者在看縮圖、還沒按下去的時候
   * 先把表備好，按下去就只剩換綁一張貼圖 ＋ 一個 draw call。
   *
   * 一次只烤一顆，烤完就把主執行緒還回去 —— 不能為了預熱反而讓介面頓。
   */
  const warmBakes = useCallback((p: EditorParams) => {
    if (!lutList.length) return false;
    const sig = bakeSigRef.current(p);
    for (const l of lutList) {
      if (!l.url) continue;
      const data = lutDataRef.current[l.id];
      if (!data) continue;                       // 這顆還沒下載解碼，跳過
      const key = `65|${sig}|${l.id}#${data.size}`;
      if (bakeCacheRef.current.has(key)) continue;
      const base = new Uint8Array(256);
      generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, base);
      const cl = curveLutsFnRef.current(p.curves);
      const tex = bakedToTexture(bakeColorLut(
        (bs, bd, bw, bh) => processPixels(bs, bd, bw, bh,
          { ...p, lutAmount: 100 }, data.data, data.size, base, null, false, cl),
        65,
      ));
      const cache = bakeCacheRef.current;
      if (cache.size >= 40) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, tex);
      return true;                               // 這一輪只烤一顆
    }
    return false;
  }, [lutList]);

  const warmGpu = useCallback((src: Uint8ClampedArray, w: number, h: number, key: string) => {
    if (gpuWarmKeyRef.current === key) return;
    const g = getGpu();
    if (!g || !g.fits(w, h)) return;
    try {
      if (!g.setSource(src, w, h)) return;
      gpuSrcKeyRef.current = key;
      // 用一顆「什麼都不改」的表做暖機，畫出來就是原圖，不會影響任何狀態
      const n = 2;
      const tex = new Uint8Array(n * n * n * 4);
      for (let b2 = 0; b2 < n; b2++) for (let g2 = 0; g2 < n; g2++) for (let r2 = 0; r2 < n; r2++) {
        const i = ((b2 * n + g2) * n + r2) * 4;
        tex[i] = r2 * 255; tex[i + 1] = g2 * 255; tex[i + 2] = b2 * 255; tex[i + 3] = 255;
      }
      g.setFront(null);
      g.setLut(tex, n);
      g.draw();
      gpuWarmKeyRef.current = key;
    } catch { /* 暖機失敗不影響任何功能，照常走原本的路 */ }
  }, []);
  const getGpu = (): LutGpu | null => {
    if (gpuRef.current === undefined) {
      try { gpuRef.current = LutGpu.create(); } catch { gpuRef.current = null; }
    }
    const g = gpuRef.current;
    /* 上下文被系統收走（iOS 記憶體吃緊、切到背景回來）之後要能**重建**。
       原本這裡只是回 null，而 gpuRef 已經有值、不會再進上面那個建立分支 ——
       等於一掉就永久退回 CPU，整個工作階段都回不去。 */
    if (g && g.lost) {
      gpuRef.current = undefined;
      gpuSrcKeyRef.current = '';
      gpuWarmKeyRef.current = '';
      bakeCacheRef.current.clear();   // 表在舊上下文裡，重建後要重新上傳
      return null;                    // 這一輪先走 CPU，下一輪就會建好新的
    }
    return g || null;
  };
  useEffect(() => () => { gpuRef.current?.dispose(); }, []);

  /**
   * 烤表 → GPU 畫 → 複製進 target 畫布。need 有給就順便把像素讀回來。
   * 任何一步失敗都回傳 false，呼叫端原封不動走回 CPU 路徑。
   */
  /* Front-stage parameters for the GPU, with the two 1-D tables cached so
     an exposure / white-balance drag re-uploads nothing but uniforms, and a
     brightness/contrast/shadows/highlights drag only a 1025-entry table. */
  /* 局部陰影／亮部（utils/localTone）：每張來源算一次保邊亮度底圖，滑桿只重算 1025 格的增益表。
     陰影、亮部都是 0 的時候完全不碰，畫面、速度都跟以前一樣。 */
  const localBaseCacheRef = useRef<Map<string, LocalBase>>(new Map());
  const localGainRef = useRef<{ key: string; gain: Float32Array | null }>({ key: '', gain: null });
  const localFor = (p: EditorParams, src: Uint8ClampedArray | null | undefined, w: number, h: number, key: string) => {
    if ((!p.shadows && !p.highlights) || !src || !w || !h || src.length < w * h * 4) return null;
    const m = localBaseCacheRef.current;
    let base = m.get(key);
    if (!base) {
      base = buildLocalBase(src, w, h); m.set(key, base);
      if (m.size > 4) { const old = m.keys().next().value; if (old !== undefined) m.delete(old); }
    }
    const gk = `${p.exposure},${p.brightness},${p.contrast},${p.shadows},${p.highlights},${p.whites || 0},${p.blacks || 0},${p.temp},${p.tint}`;
    const g = localGainRef.current;
    if (g.key !== gk || !g.gain) { g.key = gk; g.gain = makeLocalGain(p); }
    return { base, gain: g.gain };
  };
  const gpuFrontCacheRef = useRef<{ toneKey: string; tone: Float32Array | null; curveSrc: unknown; curves: Uint8Array | null; hslKey: string; hsl: { h: Float32Array; s: Float32Array; l: Float32Array } | null; gradeKey?: string; grade?: GradeFast | null }>({ toneKey: '', tone: null, curveSrc: null, curves: null, hslKey: '', hsl: null, gradeKey: '', grade: null });
  const gpuFrontFor = (p: EditorParams, local: { base: LocalBase; gain: Float32Array } | null = null) => {
    const c = gpuFrontCacheRef.current;
    const toneKey = `${p.brightness},${p.contrast},${p.whites || 0},${p.blacks || 0},` + (local ? 'L' : `${p.shadows},${p.highlights}`);
    const stage = makeToneStage(p, c.toneKey === toneKey ? c.tone : undefined, !!local);
    if (c.toneKey !== toneKey) { c.toneKey = toneKey; c.tone = stage.tone; }
    const luts = getCurveLuts(p.curves);
    if (c.curveSrc !== luts) {
      c.curveSrc = luts;
      const identity = Object.values(p.curves).every(isIdentityCurve);
      if (identity) c.curves = null;
      else { const t = new Uint8Array(1024); for (let i = 0; i < 256; i++) { t[i * 4] = luts.r[i]; t[i * 4 + 1] = luts.g[i]; t[i * 4 + 2] = luts.b[i]; t[i * 4 + 3] = luts.rgb[i]; } c.curves = t; }
    }
    const hslKey = JSON.stringify(p.hsl);
    if (c.hslKey !== hslKey) {
      c.hslKey = hslKey;
      // Same scaling as photoPixelCore: hue ±15°, saturation ±50 %, lightness ±10 %.
      c.hsl = isHslIdentity(p.hsl) ? null : {
        h: Float32Array.from(p.hsl, b => b.h / 100 * 15),
        s: Float32Array.from(p.hsl, b => b.s / 100 * 0.5),
        l: Float32Array.from(p.hsl, b => b.l / 100 * 0.1),
      };
    }
    const gradeKey = isGradeIdentity(p.grade) ? '' : JSON.stringify(p.grade);
    if (c.gradeKey !== gradeKey) { c.gradeKey = gradeKey; c.grade = makeGrade(p.grade); }
    return { wb: stage.wb, k: stage.ev ? Math.pow(2, stage.ev) : 1, peak: stage.peak, tone: c.tone, curves: c.curves, sat: stage.sat,
      vib: (p.vib * 0.5) / 100, hsl: c.hsl, grade: c.grade, local };
  };
  const gpuPaint = (
    target: HTMLCanvasElement, src: Uint8ClampedArray, w: number, h: number,
    p: EditorParams, film: Uint8ClampedArray | null, filmSize: number,
    grid: number, srcKey: string, need: Uint8ClampedArray | null,
    filmKey = '',
  ): boolean => {
    const g = getGpu();
    if (!g || !g.fits(w, h)) return false;
    try {
      if (gpuSrcKeyRef.current !== srcKey) {
        if (!g.setSource(src, w, h)) return false;
        gpuSrcKeyRef.current = srcKey;
      }
      /* ── Front stage on the GPU (uniforms) ─────────────────────────────
         White balance, exposure, the tone curve, curves and saturation are
         evaluated per pixel in the shader from a few numbers and two tiny
         1-D tables. Dragging any of those sliders (or a curve point) never
         bakes a 3D table — that bake was what made every slider and the
         curve editor stutter. */
      const front = gpuFrontFor(p, localFor(p, src, w, h, srcKey));
      /* ── Film LUT: the only 3D table left ───────────────────────────────
         Vibrance and HSL are in the shader too, so this table depends on
         nothing but which film is applied. It is always the fine 65³ grid
         (baked once per film, cached): no slider ever rebuilds it, and the
         preview during a drag is exactly the preview after release. */
      if (!film || !p.lutAmount) {
        if (!g.setFront(front, false)) return false;
      } else {
        const key = `film|65|${p.lutAmount}|${filmKey}`;
        let tex = bakeCacheRef.current.get(key);
        if (!tex) {
          const pFilm = { ...DEFAULT_PARAMS, lutAmount: p.lutAmount, curves: DEFAULT_CURVES, hsl: DEFAULT_PARAMS.hsl } as EditorParams;
          tex = bakedToTexture(bakeColorLut(
            (bs, bd, bw, bh) => processPixels(bs, bd, bw, bh, pFilm, film, filmSize, IDENTITY_BASE_LUT, null, false, IDENTITY_CURVE_LUTS),
            65,
          ));
          const cache = bakeCacheRef.current;
          if (cache.size >= 40) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          cache.set(key, tex);
        }
        if (!g.setLut(tex, 65)) return false;
        if (!g.setFront(front, true)) return false;
      }
      const out = g.draw();
      if (!out) return false;
      if (need && !g.readInto(need)) return false;
      if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
      const tctx = target.getContext('2d');
      if (!tctx) return false;
      tctx.clearRect(0, 0, w, h);
      tctx.drawImage(out, 0, 0);
      return true;
    } catch {
      return false;
    }
  };
  /* Effects that draw on the 2D canvas between the colour stage and the
     GLSL effects; while any is on, the direct GPU path cannot be used. */
  const uses2dEffects = (p: EditorParams) => !!(p.grain || p.colorNoise || p.colorNoise2 || p.blur || p.soft || p.leakOpacity || p.fringeIntensity || p.vignette || anyMask(p));
  /** The 2D display buffers were skipped by the direct path; the next normal
      render must recompute them even if the parameters did not change. */
  const displayStaleRef = useRef(false);
  /** The final colour image (film strength mixed in the shader) on the colour
      GPU's own canvas, with no copy into a 2D canvas. */
  const gpuFinal = (p: EditorParams, film: Uint8ClampedArray | null, filmSize: number, filmKey: string, srcKey: string, b: { source: Uint8ClampedArray | null; w: number; h: number }): HTMLCanvasElement | null => {
    const g = getGpu();
    return g && gpuColourOn(g, gpuSrcKeyRef, p, film, filmSize, filmKey, srcKey, b) ? g.draw() : null;
  };
  /* The colour stage inside the on-screen effect surface's own WebGL2
     context. Its result is a texture there, which the effects (GLSL effects,
     soft light, halation, leak) read directly: no full-resolution copy of the
     photo from one GPU context to another on each slider step, and no
     readback. Same shader and inputs as getGpu(), so the same 8-bit pixels. */
  const surfaceGpuRef = useRef<LutGpu | null | undefined>(undefined);
  const surfaceSrcKeyRef = useRef('');
  const getSurfaceGpu = (): LutGpu | null => {
    const surface = fxSurfaceRef.current;
    if (!surface) return null;
    if (surfaceGpuRef.current === undefined) {
      try { const gl = surfaceGl(surface); surfaceGpuRef.current = isWebgl2(gl) ? LutGpu.createOn(gl) : null; } catch { surfaceGpuRef.current = null; }
    }
    const g = surfaceGpuRef.current;
    if (g && (g.lost || g.canvas !== surface)) { surfaceGpuRef.current = undefined; surfaceSrcKeyRef.current = ''; return null; }
    return g || null;
  };
  /** b 是預覽緩衝區：這條路上傳的永遠是原圖（original），發光在 GPU 上另外算成
      一張貼圖再交給顏色那一段 —— 拖發光滑桿時不必把像素讀回來。 */
  const gpuFinalImage = (p: EditorParams, film: Uint8ClampedArray | null, filmSize: number, filmKey: string, _srcKey: string, b: BufferSet): GpuImage | null => {
    const g = getSurfaceGpu();
    if (!g || !b.source) return null;
    const original = b.original || b.source;
    const origKey = `${b.w}x${b.h}|${srcIdOf(buffersSrcRef.current)}`;
    if (!gpuColourOn(g, surfaceSrcKeyRef, p, film, filmSize, filmKey, origKey, { source: original, w: b.w, h: b.h })) return null;
    let glow: WebGLTexture | null = null;
    if (hasGlow(p)) { glow = glowGpu(p, { original, w: b.w, h: b.h }, origKey); if (!glow) return null; }
    return g.drawImage(glow);
  };

  /* 閒著的時候先把畫面那塊 GPU 表面上的顏色那一段建好、原圖傳上去。以前是第一次
     拖過 0 的那一格才當場編譯＋上傳（實測半秒），拖滑桿時就會「突然卡一下」。 */
  const warmSurfaceColour = () => {
    const b = buffers.current.preview;
    if (!b.source || !fxSurfaceRef.current || isInteractingRef.current) return;
    const lut = lutList[selectedLutIdx], data = lut?.url ? lutDataRef.current[lut.id] : null;
    gpuFinalImage(stripGlow(paramsRef.current), data ? data.data : null, data ? data.size : 0, data ? `${lut.id}#${data.size}` : '', `${b.w}x${b.h}|${srcIdent()}`, b);
  };
  const warmSurfaceColourRef = useRef(warmSurfaceColour);
  warmSurfaceColourRef.current = warmSurfaceColour;
  /* ── 發光：GPU 上從原圖算成一張「原圖＋光」的貼圖（與畫面同一個 context） ── */
  /** tex：特效畫進去的那張（由下往上）；td：翻回由上往下、與上傳的原圖同一種排法的那張 */
  const glowTexRef = useRef<{ tex: WebGLTexture; td: WebGLTexture; w: number; h: number; key: string; gl: WebGLRenderingContext } | null>(null);
  const glowLayerRef = useRef<HalationLayer | null>(null);
  const glowGpu = (p: EditorParams, b: { original: Uint8ClampedArray; w: number; h: number }, origKey: string): WebGLTexture | null => {
    const surface = fxSurfaceRef.current, g = getSurfaceGpu();
    if (!surface || !g || !g.fits(b.w, b.h)) return null;
    const softOn = p.soft > 0, haloOn = p.fringeIntensity > 0, fxOn = GLOW_FX_IDS.some(id => ((p as any)[id] || 0) > 0);
    // 編輯一次只開一個特效；萬一同時有兩種，交給 CPU 那條依序疊。
    if (Number(softOn) + Number(haloOn) + Number(fxOn) !== 1) return null;
    const gl = surfaceGl(surface);
    if (!gl) return null;
    const key = `${origKey}|${glowSig(p)}`;
    let t = glowTexRef.current;
    if (t && (t.gl !== gl || t.w !== b.w || t.h !== b.h)) { try { t.gl.deleteTexture(t.tex); t.gl.deleteTexture(t.td); } catch { /* 舊 context */ } t = glowTexRef.current = null; }
    if (t && t.key === key) return t.td;
    if (surfaceSrcKeyRef.current !== origKey) { if (!g.setSource(b.original, b.w, b.h)) return null; surfaceSrcKeyRef.current = origKey; }
    const up = g.sourceUpTex();
    const ctx = displayCanvasRef.current?.getContext('2d');
    if (!up || !ctx) return null;
    if (!t) {
      // td 的取樣設定要跟上傳原圖的那張一樣（LINEAR），顏色那段取出來才一模一樣
      const mk = (filter: number) => {
        const tex = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, b.w, b.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        return tex;
      };
      t = glowTexRef.current = { tex: mk(gl.NEAREST), td: mk(gl.LINEAR), w: b.w, h: b.h, key: '', gl };
    }
    const pg = glowOnly(p);
    let ok = false;
    try {
      if (softOn || haloOn) {
        const layer = (glowLayerRef.current ||= new HalationLayer(surface));
        layer.sourceImage = up; layer.targetTexture = t.tex;
        try {
          ok = !!(softOn
            ? layer.renderSoft(ctx, b.w, b.h, `${origKey}|soft`, pg, hslToRgb(pg.softColor / 100, 1, .5), null)
            : layer.render(ctx, b.w, b.h, `${origKey}|halo`, pg, hslToRgb(pg.fringeHue / 360, .8, .35)));
        } finally { layer.sourceImage = null; layer.targetTexture = null; }
      } else {
        ok = !!applyGlEffects(ctx, b.w, b.h, pg, `${origKey}|glow`, surface, false, undefined, undefined, { image: up, toTexture: t.tex });
      }
      /* 翻回與原圖相同的列序：拖曳時顏色那段取這張、放手後取讀回來的像素，
         兩邊用同一組座標取同一格，所以拖曳中與放手後逐像素一樣。 */
      if (ok) ok = g.flipInto(t.tex, t.td, b.w, b.h);
    } catch { ok = false; }
    if (!ok) { t.key = ''; return null; }
    t.key = key;
    return t.td;
  };
  /** 把那張貼圖（已是由上往下）讀回來。只在放手後做一次。 */
  const readGlowPixels = (tex: WebGLTexture, gl: WebGLRenderingContext, w: number, h: number): Uint8ClampedArray | null => {
    try {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const out = new Uint8ClampedArray(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(out.buffer));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
      return out;
    } catch { return null; }
  };
  /** 沒有 GPU 表面時：在一張離屏畫布上對原圖跑同一套特效（匯出也是這條） */
  const glowCpu = (p: EditorParams, original: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray | null => {
    try {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true })!;
      x.putImageData(new ImageData(original as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);   // 只讀，不必複製
      applyComplexEffectsRef.current(x, w, h, glowOnly(p), Math.max(w, h) / 1080, null, false, true, original);
      const d = x.getImageData(0, 0, w, h).data;
      c.width = c.height = 1;
      return d;
    } catch { return null; }
  };
  /** 讓 b.source 對上這組參數的發光：沒有發光＝原圖，有的話＝原圖＋光。
      同一組就什麼都不做；只有換了發光參數（或換照片）才重算。 */
  const syncGlowSource = (b: BufferSet, p: EditorParams): boolean => {
    if (!b.source) return false;
    if (!b.original) b.original = b.source;
    const origKey = `${b.w}x${b.h}|${srcIdOf(buffersSrcRef.current)}`;
    const sig = glowSig(p), key = sig ? `${origKey}|${sig}` : '';
    if (key === (b.glowKey || '')) return true;
    if (!key) b.source = b.original;
    else {
      let out: Uint8ClampedArray | null = null;
      // GPU 那張貼圖只給預覽用；縮圖等其他緩衝區走 CPU，才不會把預覽那張擠掉
      const tex = b === buffers.current.preview ? glowGpu(p, { original: b.original, w: b.w, h: b.h }, origKey) : null;
      if (tex && glowTexRef.current) out = readGlowPixels(tex, glowTexRef.current.gl, b.w, b.h);
      if (!out) out = glowCpu(p, b.original, b.w, b.h);
      if (!out) return false;
      b.source = out;
    }
    b.glowKey = key;
    // 號碼只往上加、不重複用：關掉再開另一組發光時，舊快取的鍵不能剛好對上
    if (b === buffers.current.preview) glowGenRef.current = key ? ++glowSerialRef.current : 0;
    lastProcessedParamsRef.current = { ...lastProcessedParamsRef.current, bufferWidth: 0 };
    return true;
  };
  const gpuColourOn = (g: LutGpu, srcKeyRef: React.MutableRefObject<string>, p: EditorParams, film: Uint8ClampedArray | null, filmSize: number, filmKey: string, srcKey: string, b: { source: Uint8ClampedArray | null; w: number; h: number }): boolean => {
    if (!b.source || !g.fits(b.w, b.h)) return false;
    try {
      if (srcKeyRef.current !== srcKey) { if (!g.setSource(b.source, b.w, b.h)) return false; srcKeyRef.current = srcKey; }
      const front = gpuFrontFor(p, localFor(p, b.source, b.w, b.h, srcKey));
      if (!film || !p.lutAmount) { if (!g.setFront(front, false)) return false; }
      else {
        const key = `film|65|100|${filmKey}`;
        let tex = bakeCacheRef.current.get(key);
        if (!tex) {
          const pFilm = { ...DEFAULT_PARAMS, lutAmount: 100, curves: DEFAULT_CURVES, hsl: DEFAULT_PARAMS.hsl } as EditorParams;
          tex = bakedToTexture(bakeColorLut((bs, bd, bw, bh) => processPixels(bs, bd, bw, bh, pFilm, film, filmSize, IDENTITY_BASE_LUT, null, false, IDENTITY_CURVE_LUTS), 65));
          bakeCacheRef.current.set(key, tex);
        }
        if (!g.setLut(tex, 65)) return false;
        if (!g.setFront(front, true, p.lutAmount / 100)) return false;
      }
      return true;
    } catch { return false; }
  };
  useEffect(() => () => { surfaceGpuRef.current?.dispose(); surfaceGpuRef.current = null; }, []);
  // After a drag rendered through the direct GPU path, run one normal render.
  useEffect(() => { if (!isInteracting && displayStaleRef.current) isDirtyRef.current = true; }, [isInteracting]);
  const pixelBufferCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const lazyCacheTimeoutRef = useRef<any>(null);
  const forceRecalculateEffectsRef = useRef<boolean>(false);

  const blurCacheStateRef = useRef<{
    /** 這份快取是「哪一張照片」算出來的。
        批量編輯時兩張照片的尺寸常常一模一樣、連結中的參數也一樣，
        少了這一欄就會命中別張的快取 —— 畫面上就會出現不屬於這張圖的
        光暈／模糊／顆粒（位置完全對不上，因為那是另一張的亮部）。 */
    src: string;
    w: number;
    h: number;
    blur: number;
    lutId: string;
    brightness: number;
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    temp: number;
    tint: number;
    sat: number;
    vib: number;
    toneStr: string;
  } | null>(null);

  const softCacheStateRef = useRef<{
    /** 這份快取是「哪一張照片」算出來的。
        批量編輯時兩張照片的尺寸常常一模一樣、連結中的參數也一樣，
        少了這一欄就會命中別張的快取 —— 畫面上就會出現不屬於這張圖的
        光暈／模糊／顆粒（位置完全對不上，因為那是另一張的亮部）。 */
    src: string;
    w: number;
    h: number;
    soft: number;
    softThreshold: number;
    softRadius: number;
    softColor: number;
    lutId: string;
    brightness: number;
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    temp: number;
    tint: number;
    sat: number;
    vib: number;
    toneStr: string;
  } | null>(null);

  const noise2CacheStateRef = useRef<{
    /** 這份快取是「哪一張照片」算出來的。
        批量編輯時兩張照片的尺寸常常一模一樣、連結中的參數也一樣，
        少了這一欄就會命中別張的快取 —— 畫面上就會出現不屬於這張圖的
        光暈／模糊／顆粒（位置完全對不上，因為那是另一張的亮部）。 */
    src: string;
    w: number;
    h: number;
    colorNoise2: number;
    lutId: string;
    brightness: number;
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    temp: number;
    tint: number;
    sat: number;
    vib: number;
    toneStr: string;
  } | null>(null);

  const halationPreparedRef = useRef<{ key: string; source: Uint8ClampedArray; blurred: ImageData } | null>(null);
  const halationLayerRef = useRef<HalationLayer | null>(null);
  const softLayerRef = useRef<HalationLayer | null>(null);
  const softIdleTimerRef = useRef(0), halationIdleTimerRef = useRef(0);
  const halationPresentRef=useRef<HalationLayer|null>(null),softPresentRef=useRef<HalationLayer|null>(null);
  const leakPresentRef=useRef<HalationLayer|null>(null),blurPresentRef=useRef<HalationLayer|null>(null),simplePresentRef=useRef<HalationLayer|null>(null);
  /** 按了特效卡片：下一幀先讓按鈕／分頁的變化畫出來，再下一幀才算圖。
      以前點下去是「UI 跟整張圖在同一幀一起出來」，算圖多久按鈕就慢多久才亮。 */
  const uiFirstRef = useRef(false);
  /* 在特效頁閒著的時候，一顆一顆把特效的著色器（在畫面那塊 GPU 表面上）先編好，
     柔光／光暈／漏光的圖層也先建好 —— 第一次點某顆特效時就不用當場編譯。
     手指在動或剛操作過就先等一下，一次只做一顆。 */
  useEffect(() => {
    if (activeCategory !== 'effects') return;
    const ids = EFFECT_TOOLS.map(t => t.id).filter(id => FX_TOOLS[id]);
    let i = 0, timer = 0, dead = false;
    const step = () => {
      if (dead) return;
      if (isInteractingRef.current || performance.now() - lastUiInputRef.current < 400) { timer = window.setTimeout(step, 250); return; }
      const surface = fxSurfaceRef.current;
      if (!surface) return;
      try {
        if (i < ids.length) warmFx(ids[i], surface);
        else if (i === ids.length) {
          (softPresentRef.current ||= new HalationLayer(surface)).warm();
          (halationPresentRef.current ||= new HalationLayer(surface)).warm();
          (leakPresentRef.current ||= new HalationLayer(surface)).warm();
          (blurPresentRef.current ||= new HalationLayer(surface)).warm();
          (simplePresentRef.current ||= new HalationLayer(surface)).warm();
        } else return;
      } catch { /* 預熱失敗不影響任何功能 */ }
      i++;
      timer = window.setTimeout(step, 40);
    };
    const cancel = afterPaint(step, 700);
    return () => { dead = true; cancel(); window.clearTimeout(timer); };
  }, [activeCategory]);
  useEffect(() => {
    if (!activeSrc) return;
    let tries = 0, timer = 0, dead = false;
    const step = () => {
      if (dead) return;
      // 照片還沒解碼好或手指還在動：晚一點再試（最多幾秒）
      if ((!buffers.current.preview.source || isInteractingRef.current) && ++tries < 12) { timer = window.setTimeout(step, 500); return; }
      try { warmSurfaceColourRef.current(); } catch { /* 預熱失敗不影響任何功能 */ }
    };
    const cancel = afterPaint(step, 900);
    return () => { dead = true; cancel(); window.clearTimeout(timer); };
  }, [activeSrc, activeCategory]);
  useEffect(()=>()=>{clearTimeout(softIdleTimerRef.current);clearTimeout(halationIdleTimerRef.current);halationLayerRef.current?.dispose();softLayerRef.current?.dispose();halationPresentRef.current?.dispose();softPresentRef.current?.dispose();leakPresentRef.current?.dispose();blurPresentRef.current?.dispose();simplePresentRef.current?.dispose();},[]);
  const halationCacheStateRef = useRef<{
    /** 這份快取是「哪一張照片」算出來的。
        批量編輯時兩張照片的尺寸常常一模一樣、連結中的參數也一樣，
        少了這一欄就會命中別張的快取 —— 畫面上就會出現不屬於這張圖的
        光暈／模糊／顆粒（位置完全對不上，因為那是另一張的亮部）。 */
    src: string;
    w: number;
    h: number;
    fringeIntensity: number;
    fringeSize: number;
    fringeFeather: number;
    fringeHue: number;
    lutId: string;
    brightness: number;
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    temp: number;
    tint: number;
    sat: number;
    vib: number;
    toneStr: string;
  } | null>(null);


  // ... (getCurveLuts, useEffect refs, addToHistory, undo, redo, loadLut - no changes)
  const getCurveLuts = (curves: Curves) => {
      const s = JSON.stringify(curves);
      if (s !== lastCurveLutStrRef.current || !curveLutsCacheRef.current) {
          curveLutsCacheRef.current = {
              rgb: generateCurveLut(curves.rgb),
              r: generateCurveLut(curves.r),
              g: generateCurveLut(curves.g),
              b: generateCurveLut(curves.b)
          };
          lastCurveLutStrRef.current = s;
      }
      return curveLutsCacheRef.current;
  };

  curveLutsFnRef.current = getCurveLuts;

  // 合併期間介面的參數已經歸零，但畫面要維持原樣，所以這時候不要把它同步進繪圖用的 ref
  useEffect(() => {
    if (mergeFreezeRef.current) return;
    paramsRef.current = params;
    if (maskSkipDirtyRef.current) { maskSkipDirtyRef.current = false; return; }
    isDirtyRef.current = true;
  }, [params]);
  /* 這裡以前還會順手把 isDirtyRef 設成 true。拿掉了 ——
     繪圖迴圈本來就會單獨比對「這一幀要顯示原圖嗎」跟上一幀不同就重畫，
     不需要靠髒旗標。而且掛著髒旗標會讓迴圈分不出「使用者按了前後對比」
     跟「畫面真的有東西變了」，放開按鈕時就沒辦法直接把按下去之前那張貼回來
     （見下面 compareSnapRef 那一段）。 */
  useEffect(() => { showOriginalRef.current = showOriginal; }, [showOriginal]);

  /* 回到「濾鏡」或「特效」分頁時，把目前套用中的那一顆捲到畫面正中間
     （在最前面或最後面的，捲到盡頭為止，盡量靠近中間）。沒有套用任何一顆
     ＝停在「原始」，就是最前面。
     用 useLayoutEffect：在畫出來之前就把捲動位置設好，才不會先閃一下最前面。
     以前濾鏡是用寫死的卡片寬度（80）與間距（16）去算，跟實際的卡片（64、8）
     對不上，越後面的濾鏡偏得越多；特效則一律回到最前面。改成量按鈕本身。 */
  useLayoutEffect(() => {
    const container = toolsScrollRef.current;
    if (!container) return;
    let selector = '';
    if (activeCategory === 'filter') {
      const id = lutList[selectedLutIdx]?.id;
      if (id && selectedLutIdx > 0) selector = `[data-filter-card="${CSS.escape(id)}"]`;
    } else if (activeCategory === 'effects') {
      backFromFxRef.current = false;
      const on = EFFECT_TOOLS.find(t => isEffectOn(t.id));
      if (on) selector = `[data-fx-tool="${CSS.escape(on.id)}"]`;
    }
    const center = () => {
      const el = selector ? container.querySelector<HTMLElement>(selector) : null;
      if (!el) { container.scrollLeft = 0; return !selector; }
      const er = el.getBoundingClientRect(), cr = container.getBoundingClientRect();
      container.scrollLeft += (er.left + er.width / 2) - (cr.left + cr.width / 2);
      return true;
    };
    // 卡片可能下一幀才掛上來（分頁剛切換）：那就再對一次
    if (!center()) requestAnimationFrame(center);
  }, [activeCategory]); // Only trigger on category switch

  // Force close or open the mask overlay depending on activeCategory
  useEffect(() => {
    /* 只是紅色範圍的開關：照片本身一個像素都沒變，不必把整條管線重跑一次
       （有遮色片時進出遮色片頁以前每次都要重算整張，大照片在手機上要半秒以上）。
       標記起來，下一格只更新紅色那一層（見 paintOverlayOnly）。 */
    if (activeCategory === 'mask') {
      if (paramsRef.current.maskCreated && !paramsRef.current.maskShowOverlay) {
        overlayOnlyRef.current = true;
        setParams(prev => ({ ...prev, maskShowOverlay: true }));
      }
    } else {
      if (paramsRef.current.maskShowOverlay) {
        overlayOnlyRef.current = true;
        setParams(prev => ({ ...prev, maskShowOverlay: false }));
      }
    }
  }, [activeCategory]);

  const addToHistory = useCallback((
    p: EditorParams, 
    idx: number, 
    activeSoft?: boolean, 
    activeBlur?: boolean, 
    activeGrain?: boolean,
    activeHalation?: boolean,
    manSoft?: boolean,
    manBlur?: boolean,
    manGrain?: boolean,
    manHalation?: boolean
  ) => {
    const sActive = activeSoft !== undefined ? activeSoft : isSoftActive;
    const bActive = activeBlur !== undefined ? activeBlur : isBlurActive;
    const gActive = activeGrain !== undefined ? activeGrain : isGrainActive;
    const hActive = activeHalation !== undefined ? activeHalation : isHalationActive;
    const sMan = manSoft !== undefined ? manSoft : softManuallyAdjusted;
    const bMan = manBlur !== undefined ? manBlur : blurManuallyAdjusted;
    const gMan = manGrain !== undefined ? manGrain : grainManuallyAdjusted;
    const hMan = manHalation !== undefined ? manHalation : halationManuallyAdjusted;
    
    const currentItem = historyRef.current[historyIdxRef.current];
    if (currentItem && 
        currentItem.selectedLutIdx === idx && 
        JSON.stringify(currentItem.params) === JSON.stringify(p) &&
        currentItem.isSoftActive === sActive &&
        currentItem.isBlurActive === bActive &&
        currentItem.isGrainActive === gActive &&
        currentItem.isHalationActive === hActive &&
        currentItem.softManuallyAdjusted === sMan &&
        currentItem.blurManuallyAdjusted === bMan &&
        currentItem.grainManuallyAdjusted === gMan &&
        currentItem.halationManuallyAdjusted === hMan &&
        JSON.stringify(currentItem.geo || DEFAULT_GEO) === JSON.stringify(geoRef.current) &&
        JSON.stringify(currentItem.srcs || srcListRef.current) === JSON.stringify(srcListRef.current)
    ) {
        return;
    }
    {
      const pushed = pushHistoryEntry(historyRef.current, historyIdxRef.current, {
        params: JSON.parse(JSON.stringify(p)),
        selectedLutIdx: idx,
        geo: JSON.parse(JSON.stringify(geoRef.current)),
        isSoftActive: sActive,
        isBlurActive: bActive,
        isGrainActive: gActive,
        isHalationActive: hActive,
        softManuallyAdjusted: sMan,
        blurManuallyAdjusted: bMan,
        grainManuallyAdjusted: gMan,
        halationManuallyAdjusted: hMan,
        srcs: [...srcListRef.current]
      });
      /* 上限交給 pushHistoryEntry 管：留到 500 格，第 0 格（原圖的樣子）永遠留著。
         srcs 是字串陣列的淺拷貝，字串本身共用同一份，所以一格很便宜。 */
      writeHistory(pushed.history, pushed.index);
    }
  }, [historyIndex, history, isSoftActive, isBlurActive, isGrainActive, isHalationActive, softManuallyAdjusted, blurManuallyAdjusted, grainManuallyAdjusted, halationManuallyAdjusted]);

  const undo = () => {
    if (historyIdxRef.current > 0) {
      const prev = historyRef.current[historyIdxRef.current - 1];
      setParams(JSON.parse(JSON.stringify(prev.params)));
      setSelectedLutIdx(prev.selectedLutIdx);
      if (prev.isSoftActive !== undefined) setIsSoftActive(prev.isSoftActive);
      if (prev.isBlurActive !== undefined) setIsBlurActive(prev.isBlurActive);
      if (prev.isGrainActive !== undefined) setIsGrainActive(prev.isGrainActive);
      if (prev.isHalationActive !== undefined) setIsHalationActive(prev.isHalationActive);
      if (prev.softManuallyAdjusted !== undefined) setSoftManuallyAdjusted(prev.softManuallyAdjusted);
      if (prev.blurManuallyAdjusted !== undefined) setBlurManuallyAdjusted(prev.blurManuallyAdjusted);
      if (prev.grainManuallyAdjusted !== undefined) setGrainManuallyAdjusted(prev.grainManuallyAdjusted);
      if (prev.halationManuallyAdjusted !== undefined) setHalationManuallyAdjusted(prev.halationManuallyAdjusted);
      /* 合併那一步換掉了來源圖，撤銷要連來源一起退回去 ——
         只回復參數的話，烤進去的那一層還留在圖上。
         來源換回去之後幾何是舊那張自己的，不用再套一次構圖。 */
      const prevSrcs = prev.srcs;
      const swapped = !!prevSrcs && JSON.stringify(prevSrcs) !== JSON.stringify(srcListRef.current);
      const prevGeo = prev.geo || DEFAULT_GEO;
      if (swapped) {
        /* 換來源時幾何要先擺好：緩衝區是照 geoRef 重建的，
           順序反過來的話會先重建一次沒裁切的，再重建一次裁切的（畫面閃兩下）。 */
        geoRef.current = JSON.parse(JSON.stringify(prevGeo));
        setGeo(geoRef.current);
        srcListRef.current = [...prevSrcs!];
        swapToSrc([...prevSrcs!]);
      } else if (JSON.stringify(prevGeo) !== JSON.stringify(geoRef.current)) {
        applyGeoRef.current(prevGeo);
      }
      writeHistory(historyRef.current, historyIdxRef.current - 1);
    }
  };

  const redo = () => {
    if (historyIdxRef.current < historyRef.current.length - 1) {
      const next = historyRef.current[historyIdxRef.current + 1];
      setParams(JSON.parse(JSON.stringify(next.params)));
      setSelectedLutIdx(next.selectedLutIdx);
      if (next.isSoftActive !== undefined) setIsSoftActive(next.isSoftActive);
      if (next.isBlurActive !== undefined) setIsBlurActive(next.isBlurActive);
      if (next.isGrainActive !== undefined) setIsGrainActive(next.isGrainActive);
      if (next.isHalationActive !== undefined) setIsHalationActive(next.isHalationActive);
      if (next.softManuallyAdjusted !== undefined) setSoftManuallyAdjusted(next.softManuallyAdjusted);
      if (next.blurManuallyAdjusted !== undefined) setBlurManuallyAdjusted(next.blurManuallyAdjusted);
      if (next.grainManuallyAdjusted !== undefined) setGrainManuallyAdjusted(next.grainManuallyAdjusted);
      if (next.halationManuallyAdjusted !== undefined) setHalationManuallyAdjusted(next.halationManuallyAdjusted);
      const nextSrcs = next.srcs;
      const swapped = !!nextSrcs && JSON.stringify(nextSrcs) !== JSON.stringify(srcListRef.current);
      const nextGeo = next.geo || DEFAULT_GEO;
      if (swapped) {
        geoRef.current = JSON.parse(JSON.stringify(nextGeo));
        setGeo(geoRef.current);
        srcListRef.current = [...nextSrcs!];
        swapToSrc([...nextSrcs!]);
      } else if (JSON.stringify(nextGeo) !== JSON.stringify(geoRef.current)) {
        applyGeoRef.current(nextGeo);
      }
      writeHistory(historyRef.current, historyIdxRef.current + 1);
    }
  };

  /* 把一顆濾鏡的查色表準備好（下載／解碼／收進本機）。
     點濾鏡跟背景預載走同一支 —— 兩邊各寫一份的話，預載那份不會問本機快取，
     重開 App 就又整批重新下載一次。 */
  const ensureLutData = useCallback(async (lut: { id: string; url: string }) => {
    if (!lut.url || lutDataRef.current[lut.id]) return;
    if (!loadingPromisesRef.current[lut.id]) {
      LUT_IN_FLIGHT.add(lut.id);
      loadingPromisesRef.current[lut.id] = (async () => {
        // 先問本機：以前解過的表直接讀回來，不用下載也不用重新解碼重排
        const cacheUrl=needsLutAtlasRepair(lut.url)?lut.url+'#'+LUT_ATLAS_REPAIR_REVISION:lut.url;
        const cached = await loadCachedLut(lut.id, cacheUrl);
        if (cached) {
          lutDataRef.current[lut.id] = cached;
          setLutReadyTick(t => t + 1);
          return;
        }
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const size = img.width === img.height ? img.width / 8 : 64;
            const size2 = size * size;
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(img, 0, 0);
            const originalData = ctx.getImageData(0, 0, img.width, img.height).data;
            const data=needsLutAtlasRepair(lut.url)?repairLutAtlas(originalData,img.width,img.height).data:originalData;
            const lutData = new Uint8ClampedArray(size * size * size * 3);
            for (let b = 0; b < size; b++) {
              for (let g = 0; g < size; g++) {
                for (let r = 0; r < size; r++) {
                  const blockX = (b % 8) * size; const blockY = (b / 8 | 0) * size;
                  const pxIdx = ((blockY + g) * img.width + (blockX + r)) * 4;
                  const lutIdx = (b * size2 + g * size + r) * 3;
                  lutData[lutIdx] = data[pxIdx]; lutData[lutIdx + 1] = data[pxIdx + 1]; lutData[lutIdx + 2] = data[pxIdx + 2];
                }
              }
            }
            lutDataRef.current[lut.id] = { data: lutData, size };
            LUT_IN_FLIGHT.delete(lut.id);
            setLutReadyTick(t => t + 1);
            saveCachedLut(lut.id, cacheUrl, lutData, size);
            resolve();
          };
          // 載入失敗：不要留下「已完成」的承諾，下次點才會重試；也不再擋住重畫
          img.onerror = () => { LUT_IN_FLIGHT.delete(lut.id); delete loadingPromisesRef.current[lut.id]; isDirtyRef.current = true; resolve(); };
          img.src = lut.url;
        });
      })().finally(() => LUT_IN_FLIGHT.delete(lut.id));
    }
    await loadingPromisesRef.current[lut.id];
  }, []);

  const loadLut = useCallback(async (idx: number) => {
    const lut = lutList[idx];
    if (lut.url && !lutDataRef.current[lut.id]) {
      setLoadingLutId(lut.id);
      await ensureLutData(lut);
      pendingLutPaintRef.current = lut.id;
      isDirtyRef.current = true;
    }
  }, [lutList, ensureLutData]);

  // Eagerly preload all LUTs in the background sequentially to ensure instant filter switching without clogging network
  useEffect(() => {
     // 手指還在滑桿上就先停 —— 解一顆濾鏡要跑 64³ 次迴圈，是一整塊同步運算，
     // 排在拖曳中間就是一次掉格。放開手之後這一輪會重跑，載過的會直接跳過，不會白做。
     if (isInteracting) return;
     let active = true;
     const preload = async () => {
         for (let i = 0; i < lutList.length; i++) {
             if (!active) break;
             const lut = lutList[i];
             if (!lut.url || lutDataRef.current[lut.id]) continue;
             await ensureLutData(lut);
             await new Promise(r => setTimeout(r, 50));   // 讓主執行緒喘一口氣
         }
     };
     preload();
     return () => { active = false; };
  }, [lutList, isInteracting, ensureLutData]);

  /* ---- 濾鏡縮圖 -------------------------------------------------------------
     每一張都是「目前這張預覽圖套上那顆濾鏡」的樣子，而不是一個抽象的圖示。
     縮圖只有 72×86，一顆濾鏡才 6 千多個像素，所以整排重算也很快；
     真正花時間的是每顆濾鏡都要烘一次 32³ 的主 LUT，所以：
       - 只有停在「濾鏡」分頁時才算
       - 參數停下來 300ms 之後才算（拖滑桿的當下不算）
     離開濾鏡分頁就完全沒有成本。                                            */
  /* 卡片是 64×76 CSS px，用螢幕的實際像素密度去算（手機是 2 或 3 倍），
     貼上去就是原生解析度，不會糊。以前為了求快只用 2 倍、還分成
     「先低解析鋪滿、再高解析蓋上去」兩輪，那個蓋上去的瞬間就是會抖一下的原因。
     改成畫布直畫（少掉 PNG 編碼與解碼）之後一輪就夠快，所以只算一輪、
     只有最終品質。整排不會空白是靠 fallback：還沒輪到的格子先畫
     「原始」那一張（特效是沒套特效的底圖）。
     這些都只影響按鈕上的縮圖，預覽與輸出的畫質完全沒有碰到。 */
  const CARD_W = 64, CARD_H = 76;
  const THUMB_W = CARD_W * THUMB_DPR, THUMB_H = CARD_H * THUMB_DPR;
  /** 縮圖倉庫：鍵是「照片 + 按鈕」，值是畫好的離屏畫布。卡片上的 <canvas> 從這裡取。 */
  const filterThumbStore = useRef<Record<string, ThumbEntry>>({});
  const fxThumbStore = useRef<Record<string, ThumbEntry>>({});
  /** 掛在畫面上的縮圖格子，算好一張就直接叫它們重畫（完全不經過 React state） */
  const thumbPainters = useRef<Set<() => void>>(new Set());
  const repaintThumbs = useCallback(() => { thumbPainters.current.forEach(f => f()); }, []);
  /* 批量編輯時每一張照片的縮圖各留一份，來回切換就不用重算（切回去是瞬間的）。
     只留最近幾張，記憶體才不會一直長大。 */
  /* 多圖編輯時每一張都留（一張兩排約 8MB），最多 8 張 */
  const THUMB_CACHE_SRCS = 8;
  const thumbSrcsRef = useRef<string[]>([]);
  /** 倉庫的鍵。分隔符用空格：按鈕 id 跟照片的 URL 都不可能有空格 */
  const THUMB_SEP = ' ';
  /* 按鈕縮圖永遠畫「這張照片最初的樣子」。
     合併會產生一張新的來源圖，但縮圖不該跟著變成合併後的樣子 ——
     所以每張合併出來的圖都記住它是從哪一張原圖來的，縮圖一律認那一張。
     這樣合併時整排縮圖的簽章沒變，一格都不用重算（合併也就快得多）。 */
  const thumbOriginRef = useRef<Record<string, string>>({});
  const thumbSrcOf = (src: string) => thumbOriginRef.current[src] || src;
  /* 前後對比要看的是「最原始那張」，不是合併之後的。
     合併會把效果烤進圖裡、換成一張新的來源圖，之後緩衝區裡的原圖
     就已經是合併過的了，所以第一次載進來時先把那張留一份下來。 */
  const pristineRef = useRef<{ key: string; canvas: HTMLCanvasElement }[]>([]);
  const PRISTINE_KEEP = 3;   // 批量編輯時最多留幾張（一張預覽尺寸就好幾 MB，不能無限留）
  const pristineOf = (src: string) => pristineRef.current.find(x => x.key === src)?.canvas || null;
  /* 鍵裡放照片的短編號，不放網址本身：照片網址可能是好幾 MB 的 data URL，
     每次重畫 React 比對 25 顆縮圖的 id 字串都要逐字比過一遍，點一下就卡上百毫秒。 */
  const thumbSrcKey = (src: string) => 's' + srcIdOf(thumbSrcOf(src));
  const thumbKey = (src: string, id: string) => thumbSrcKey(src) + THUMB_SEP + id;
  const noteThumbSrc = (src: string) => {
    const list = thumbSrcsRef.current;
    const at = list.indexOf(src);
    if (at >= 0) list.splice(at, 1);
    list.unshift(src);
    const drop = list.splice(THUMB_CACHE_SRCS);
    if (!drop.length) return;
    const dropKeys = drop.map(d => 's' + srcIdOf(d));
    for (const store of [filterThumbStore, fxThumbStore]) {
      for (const k of Object.keys(store.current)) {
        if (dropKeys.indexOf(k.slice(0, k.indexOf(THUMB_SEP))) >= 0) delete store.current[k];
      }
    }
  };
  /* 濾鏡／特效按鈕縮圖的底圖：一律是「這張照片剛載進來的樣子」（留底的那一份），
     不管之後套了濾鏡、特效、合併、構圖、人像、仿色都不變 —— 所以只有換照片才需要重算。
     還沒有留底（極少數）才退回目前的緩衝區。 */
  const thumbBaseCanvas = (b: BufferSet): HTMLCanvasElement => {
    const keep = pristineOf(thumbSrcOf(buffersSrcRef.current));
    if (keep && keep.width && keep.height) return keep;
    const c = document.createElement('canvas');
    c.width = b.w; c.height = b.h;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.original || b.source!), b.w, b.h), 0, 0);
    return c;
  };
  /* ── 濾鏡／特效按鈕的縮圖 ──────────────────────────────────────────
     以前是「點進濾鏡／特效頁才開始算」，而且換一張照片特效那排就整排重算，
     所以每次點進去、每次換照片，縮圖都要等一下才出來。
     現在：照片一載好就在背景（閒著的時候、一格一格讓出主執行緒）把這張的兩排都算好，
     接著把多圖編輯裡其他照片的也算好。每一格各自記得「是哪張原圖、哪一顆」算的，
     算過的永遠不重算 —— 點進去、換照片，縮圖都已經在了。 */
  /** 「還沒算到這一格」時先頂著的底圖（沒有套任何特效的樣子）的鍵 */
  const FX_THUMB_BASE = '__base';
  /* applyComplexEffects 宣告在後面，用 ref 取用（它每次 render 都會更新） */
  const applyComplexEffectsRef = useRef<any>(() => {});
  /** 把一張圖置中裁切縮成縮圖大小，回傳像素 */
  const thumbPixelsFrom = (src: CanvasImageSource, sw: number, sh: number) => {
    const W = THUMB_W, H = THUMB_H;
    const small = document.createElement('canvas');
    small.width = W; small.height = H;
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    sctx.imageSmoothingQuality = 'high';
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale, dh = sh * scale;
    sctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return sctx.getImageData(0, 0, W, H).data;
  };
  const flatThumbTables = () => {
    const flat = DEFAULT_PARAMS;
    const baseLut = new Uint8Array(256);
    generateBaseCorrectionLut(flat.exposure, flat.contrast, flat.brightness, baseLut);
    const curveLuts = {
      rgb: generateCurveLut(flat.curves.rgb), r: generateCurveLut(flat.curves.r),
      g: generateCurveLut(flat.curves.g), b: generateCurveLut(flat.curves.b),
    };
    return { flat, baseLut, curveLuts };
  };
  /** 這張原圖的濾鏡那排還缺幾格（濾鏡檔還沒下載的不算缺） */
  const filterThumbsMissing = (forSrc: string) => lutList.some(l => (!l.url || lutDataRef.current[l.id])
    && filterThumbStore.current[thumbKey(forSrc, l.id)]?.sig !== forSrc + '|' + l.id);
  const fxThumbsMissing = (forSrc: string) => EFFECT_TOOLS.some(t => fxThumbStore.current[thumbKey(forSrc, t.id)]?.sig !== forSrc + '|' + t.id);
  /** 算一張原圖的濾鏡那排（已經算過的格子跳過） */
  const buildFilterThumbs = (forSrc: string, thumbSrc: Uint8ClampedArray, cancelled: () => boolean, done: () => void) => {
    const W = THUMB_W, H = THUMB_H;
    const { flat, baseLut, curveLuts } = flatThumbTables();
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const cctx = cvs.getContext('2d')!;
    runThumbChunks(
      lutList,
      (lut: { id: string; name: string; url: string }) => {
        const data = lut.url ? lutDataRef.current[lut.id] : null;
        if (lut.url && !data) return false;    // 濾鏡檔還沒下載完，等下一輪
        const key = thumbKey(forSrc, lut.id);
        const itemSig = forSrc + '|' + lut.id;
        if (filterThumbStore.current[key]?.sig === itemSig) return false;
        /* 縮圖要照這顆濾鏡「按下去之後真正套用的強度」畫 */
        const amount = lut.url ? (LUT_DEFAULT_AMOUNT[lut.id] ?? 100) : 100;
        const dst = new Uint8ClampedArray(thumbSrc);
        try {
          processPixels(thumbSrc, dst, W, H,
            { ...flat, lutAmount: amount }, data ? data.data : null, data ? data.size : 0,
            baseLut, null, false, curveLuts);
        } catch { return false; }
        cctx.putImageData(new ImageData(dst, W, H), 0, 0);
        putThumb(filterThumbStore, key, cvs, itemSig);
        return true;
      },
      repaintThumbs, cancelled, done,
    );
  };
  /** 算一張原圖的特效那排（已經算過的格子跳過） */
  const buildFxThumbs = (forSrc: string, thumbSrc: Uint8ClampedArray, cancelled: () => boolean, done: () => void) => {
    const W = THUMB_W, H = THUMB_H;
    const { flat, baseLut, curveLuts } = flatThumbTables();
    const baseData = new Uint8ClampedArray(thumbSrc.length);
    try {
      processPixels(thumbSrc, baseData, W, H, { ...flat, ...NO_EFFECT_PARAMS } as EditorParams, null, 0, baseLut, null, false, curveLuts);
    } catch { done(); return; }
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const cctx = cvs.getContext('2d', { willReadFrequently: true })!;
    // 先把「沒套任何特效」的底圖收進倉庫 —— 還沒輪到的格子先用它頂著
    const baseKey = thumbKey(forSrc, FX_THUMB_BASE);
    if (fxThumbStore.current[baseKey]?.sig !== forSrc + '|base') {
      cctx.putImageData(new ImageData(new Uint8ClampedArray(baseData), W, H), 0, 0);
      putThumbAsync(fxThumbStore, baseKey, cvs, repaintThumbs, forSrc + '|base');
    }
    runThumbChunks(
      EFFECT_TOOLS,
      (tool) => {
        const key = thumbKey(forSrc, tool.id), itemSig = forSrc + '|' + tool.id;
        if (fxThumbStore.current[key]?.sig === itemSig) return false;
        cctx.putImageData(new ImageData(new Uint8ClampedArray(baseData), W, H), 0, 0);
        const blurDefault = 40;   // 範例固定一種，不跟著目前的濾鏡變
        const demo: EditorParams = { ...flat, ...NO_EFFECT_PARAMS, ...effectPreset(tool.id,FX_DEFS,blurDefault) } as EditorParams;
        try {
          applyComplexEffectsRef.current(cctx, W, H, demo, Math.max(W, H) / 1080,
            new Uint8ClampedArray(baseData.length), false, true, baseData);
        } catch { /* 單一格算不出來就留基底圖 */ }
        putThumbAsync(fxThumbStore, key, cvs, repaintThumbs, itemSig);
        return false;   // 交付時自己叫重畫
      },
      repaintThumbs, cancelled, done,
    );
  };
  /* 背景排程：先這一張（正在看濾鏡／特效頁的那一排優先、而且不等），再其他照片。
     拖滑桿時整個停下來，放手後接著做。 */
  const thumbJobRef = useRef(0);
  useEffect(() => {
    if (isInteracting) return;
    const job = ++thumbJobRef.current;
    const cancelled = () => job !== thumbJobRef.current;
    const b0 = buffers.current.preview;
    if (!b0 || !b0.source || !b0.w || !b0.h) return;
    const cur = thumbSrcOf(buffersSrcRef.current);
    const order: ('filter' | 'fx')[] = activeCategory === 'effects' ? ['fx', 'filter'] : ['filter', 'fx'];
    const urgent = (activeCategory === 'filter' && filterThumbsMissing(cur)) || (activeCategory === 'effects' && fxThumbsMissing(cur));
    const others = srcList.map(thumbSrcOf).filter((u, i, a) => u !== cur && a.indexOf(u) === i);
    const run = () => {
      if (cancelled()) return;
      noteThumbSrc(cur);
      let pixels: Uint8ClampedArray | null = null;
      const curPixels = () => {
        if (!pixels) { const b = buffers.current.preview; const c = thumbBaseCanvas(b); pixels = thumbPixelsFrom(c, c.width, c.height); }
        return pixels;
      };
      const steps: (() => void)[] = [];
      const next = () => { if (cancelled()) return; const f = steps.shift(); if (f) window.setTimeout(f, 0); };
      for (const k of order) steps.push(() => {
        if (thumbSrcOf(buffersSrcRef.current) !== cur) return next();
        if (k === 'filter') { if (filterThumbsMissing(cur)) buildFilterThumbs(cur, curPixels(), cancelled, next); else next(); }
        else { if (fxThumbsMissing(cur)) buildFxThumbs(cur, curPixels(), cancelled, next); else next(); }
      });
      // 其他照片：解好的圖直接用，沒有就載一次（只用來縮小，不留）
      for (const u of others) steps.push(() => {
        if (!filterThumbsMissing(u) && !fxThumbsMissing(u)) return next();
        const use = (im: HTMLImageElement) => {
          if (cancelled()) return;
          const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
          if (!w || !h) return next();
          const px = thumbPixelsFrom(im, w, h);
          noteThumbSrc(u);
          buildFilterThumbs(u, px, cancelled, () => buildFxThumbs(u, px, cancelled, next));
        };
        const ready = viewedImgRef.current.get(u) || warmImgRef.current.get(u);
        if (ready && ready.complete && ready.naturalWidth) use(ready);
        else loadImg(u).then(use).catch(() => next());
      });
      next();
    };
    // 正在看的那一排缺格子：下一幀就開始；其他的等閒下來（不跟換照片、開分頁搶主執行緒）
    let idle = 0;
    const ric = (window as any).requestIdleCallback as ((f: () => void, o?: any) => number) | undefined;
    const cancelT = urgent ? afterPaint(run, 0) : afterPaint(() => { idle = ric ? ric(run, { timeout: 1500 }) : window.setTimeout(run, 200); }, 350);
    return () => { thumbJobRef.current++; cancelT(); if (idle) { if (ric) (window as any).cancelIdleCallback?.(idle); else clearTimeout(idle); } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, lutList, activeSrc, buffersTick, lutReadyTick, srcList, isInteracting]);

  const handleFilterSelect = (idx: number) => {
    releaseFreeze(true);
    tapFastRef.current = true;
    /* 合併還在背景烤：這時候點的會被烤完的歸零蓋掉（要再按一次），先記著，烤完再套 */
    if (mergingRef.current) { pendingTapRef.current = () => tapHandlersRef.current.lut(idx); return; }
    quickFilterRef.current = true;   // 先出低解析度那張，畫面才會馬上有反應
    if (idx > 0) {
      loadLut(idx);
    }
    const lutId = lutList[idx].id;

    const defaultAmount = LUT_DEFAULT_AMOUNT[lutId] ?? 100;

    let targetSoft = 0;
    let softThresholdVal = paramsRef.current.softThreshold;
    if (isSoftActive) {
      if (softManuallyAdjusted) {
        targetSoft = userSoftRef.current;
      } else {
        targetSoft = 50;
        softThresholdVal = 80;
      }
    }

    let targetBlur = 0;
    if (isBlurActive) {
      if (blurManuallyAdjusted) {
        targetBlur = userBlurRef.current;
      } else {
        targetBlur = (lutId === 'f22' || lutId === 'f23') ? 30 : 40;
      }
    }

    let targetGrain = 0;
    let targetGrainBW = paramsRef.current.grain;
    let targetGrainNoise2 = paramsRef.current.colorNoise2;
    if (isGrainActive) {
      if (grainManuallyAdjusted) {
        targetGrain = userGrainRef.current.colorNoise;
        targetGrainBW = userGrainRef.current.grain;
        targetGrainNoise2 = userGrainRef.current.colorNoise2;
      } else {
        targetGrain = 20;
        targetGrainBW = 0;
        targetGrainNoise2 = 0;
      }
    } else {
      targetGrain = 0;
      targetGrainBW = 0;
      targetGrainNoise2 = 0;
    }

    const newParams = { 
        ...paramsRef.current, 
        lutAmount: defaultAmount,
        soft: targetSoft,
        softThreshold: softThresholdVal,
        shadows: paramsRef.current.shadows,
        highlights: paramsRef.current.highlights,
        grain: targetGrainBW,
        temp: paramsRef.current.temp,
        exposure: paramsRef.current.exposure,
        blur: targetBlur,
        fringeIntensity: paramsRef.current.fringeIntensity,
        fringeSize: paramsRef.current.fringeSize,
        fringeHue: paramsRef.current.fringeHue,
        colorNoise: targetGrain,
        colorNoise2: targetGrainNoise2,
        tint: paramsRef.current.tint
    };
    setParams(newParams);
    setSelectedLutIdx(idx);
    setActiveToolId('filter_select');
    addToHistory(newParams, idx, isSoftActive, isBlurActive, isGrainActive, softManuallyAdjusted, blurManuallyAdjusted, grainManuallyAdjusted);
  };

  /* 「打開柔光／朦朧／噪點／光暈」要套的值。
     四顆開關與特效清單的卡片共用同一份規則 —— 兩個入口分頭寫的話，
     同一個特效從清單點開跟從開關打開會得到不一樣的預設值。
     patch 是要疊上去的參數，manual 是「使用者自己調過」那個旗標的新值。 */
  /* fresh = true 代表「從頭來過」：不理會使用者上次調過的值，一律給預設。
     特效卡片走這條（點下去就是整組重置），四顆開關維持原本的記憶行為。 */
  const softOnPatch = (fresh = false) => {
    if (!fresh && softManuallyAdjusted && userSoftRef.current !== 0) {
      return { patch: { soft: userSoftRef.current }, manual: softManuallyAdjusted };
    }
    const lutId = lutList[selectedLutIdx]?.id || 'none';
    const softThresholdVal = 80;
    userSoftRef.current = 100;
    return { patch: { ...LEGACY_EFFECT_PRESETS.softLight,softThreshold:softThresholdVal }, manual: false };
  };
  const blurOnPatch = (fresh = false) => {
    if (!fresh && blurManuallyAdjusted && userBlurRef.current !== 0) {
      return { patch: { blur: userBlurRef.current }, manual: blurManuallyAdjusted };
    }
    const lutId = lutList[selectedLutIdx]?.id || 'none';
    const targetBlur = (lutId === 'f22' || lutId === 'f23') ? 30 : 40;
    userBlurRef.current = targetBlur;
    return { patch: { blur: targetBlur }, manual: false };
  };
  const grainOnPatch = (fresh = false) => {
    const g = userGrainRef.current;
    if (!fresh && grainManuallyAdjusted && !(g.grain === 0 && g.colorNoise === 0 && g.colorNoise2 === 0)) {
      return { patch: { grain: g.grain, colorNoise: g.colorNoise, colorNoise2: g.colorNoise2 }, manual: grainManuallyAdjusted };
    }
    userGrainRef.current = { grain: 0, colorNoise: 40, colorNoise2: 0 };
    return { patch: { ...LEGACY_EFFECT_PRESETS.colorNoise }, manual: false };
  };
  const halationOnPatch = (fresh = false) => {
    if (!fresh && halationManuallyAdjusted && userHalationRef.current !== 0) {
      return { patch: { fringeIntensity: userHalationRef.current }, manual: halationManuallyAdjusted };
    }
    userHalationRef.current = 100;
    return { patch: { ...LEGACY_EFFECT_PRESETS.halation }, manual: false };
  };

  const toggleSoftLight = () => {
    const nextActive = !isSoftActive;
    setIsSoftActive(nextActive);

    let nextParams;
    let nextSoftManual = softManuallyAdjusted;
    if (nextActive) {
      const on = softOnPatch();
      nextParams = { ...paramsRef.current, ...on.patch };
      nextSoftManual = on.manual;
      if (!on.manual) setSoftManuallyAdjusted(false);
    } else {
      nextParams = {
        ...paramsRef.current,
        soft: 0
      };
    }

    setParams(nextParams);
    paramsRef.current = nextParams;
    isDirtyRef.current = true;
    addToHistory(nextParams, selectedLutIdx, nextActive, isBlurActive, isGrainActive, nextSoftManual, blurManuallyAdjusted, grainManuallyAdjusted);
  };

  const toggleBlur = () => {
    const nextActive = !isBlurActive;
    setIsBlurActive(nextActive);
    
    let nextParams;
    let nextBlurManual = blurManuallyAdjusted;
    if (nextActive) {
      const on = blurOnPatch();
      nextParams = { ...paramsRef.current, ...on.patch };
      nextBlurManual = on.manual;
      if (!on.manual) setBlurManuallyAdjusted(false);
    } else {
      nextParams = {
        ...paramsRef.current,
        blur: 0
      };
    }

    setParams(nextParams);
    paramsRef.current = nextParams;
    isDirtyRef.current = true;
    addToHistory(nextParams, selectedLutIdx, isSoftActive, nextActive, isGrainActive, softManuallyAdjusted, nextBlurManual, grainManuallyAdjusted);
  };

  const toggleGrain = () => {
    const nextActive = !isGrainActive;
    setIsGrainActive(nextActive);
    
    let nextParams;
    let nextGrainManual = grainManuallyAdjusted;
    if (nextActive) {
      const on = grainOnPatch();
      nextParams = { ...paramsRef.current, ...on.patch };
      nextGrainManual = on.manual;
      if (!on.manual) setGrainManuallyAdjusted(false);
    } else {
      nextParams = {
        ...paramsRef.current,
        grain: 0,
        colorNoise: 0,
        colorNoise2: 0
      };
    }

    setParams(nextParams);
    paramsRef.current = nextParams;
    isDirtyRef.current = true;
    addToHistory(nextParams, selectedLutIdx, isSoftActive, isBlurActive, nextActive, softManuallyAdjusted, blurManuallyAdjusted, nextGrainManual);
  };

  const toggleHalation = () => {
    const nextActive = !isHalationActive;
    setIsHalationActive(nextActive);
    
    let nextParams;
    let nextHalationManual = halationManuallyAdjusted;
    if (nextActive) {
      const on = halationOnPatch();
      nextParams = { ...paramsRef.current, ...on.patch };
      nextHalationManual = on.manual;
      if (!on.manual) setHalationManuallyAdjusted(false);
    } else {
      nextParams = {
        ...paramsRef.current,
        fringeIntensity: 0
      };
    }

    setParams(nextParams);
    paramsRef.current = nextParams;
    isDirtyRef.current = true;
    addToHistory(nextParams, selectedLutIdx, isSoftActive, isBlurActive, isGrainActive, nextActive, softManuallyAdjusted, blurManuallyAdjusted, grainManuallyAdjusted, nextHalationManual);
  };

  // ... (handleEffectToolSelect, applyComplexEffects)
  /* 特效的著色器是「第一次用到才編譯」，20 幾支一起編就是進特效分頁要等一秒的主因
     （量到第一次進去 902ms，第二次進去 25ms）。編輯器開好之後趁空檔一支一支先編起來，
     真的點進去時就已經是熱的。排在 idle 裡，不跟預覽搶主執行緒。 */
  useEffect(() => {
    let stop = false;
    let i = 0;
    const idle: (cb: () => void) => void =
      (window as any).requestIdleCallback
        ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 2000 })
        : (cb) => { window.setTimeout(cb, 120); };
    const step = () => {
      if (stop || i >= FX_DEFS.length) return;
      warmFx(FX_DEFS[i++].id);
      idle(step);
    };
    // 開場那一秒讓給第一張預覽，不要跟它搶
    const t = window.setTimeout(() => idle(step), 1200);
    return () => { stop = true; window.clearTimeout(t); };
  }, []);

  /* 點特效卡片＝選中它，上面那根滑桿就是它的強度（也只有強度），不換頁。
     還沒開的話順手用「預設強度」套上去 —— 點下去就看得到效果，不用先把滑桿從 0 拖出來。
     已經開著的就只是選中，不會把使用者調好的值蓋掉。
     要調細項的話按卡片右上角那顆編輯鍵。 */
  /* 按下合併之後，實際的烤圖（原始解析度重畫 + 編碼 PNG）還要跑一下，
     但使用者不需要等它 —— 預覽畫面本來就已經是合併後的樣子了。
     所以按下去就先把介面切成「合併完」的狀態：按鈕馬上收起來、
     濾鏡／特效回到「原始」。來源圖等背景烤好再換，過程中畫面不動。 */
  const [mergePending, setMergePending] = useState(false);
  /* 這一次正在烤的是濾鏡還是特效。烤好之前來源圖還沒換，
     次數表查到的還是舊的那張（＝還沒加上這一次），
     所以顯示的時候要把它加上去，按鈕才不會先消失一下再變成「已合併N」。 */
  const mergePendingBakeRef = useRef<{ lut: number; fx: number }>({ lut: 0, fx: 0 });
  /** 合併期間繪圖要用的那一份參數（介面已經歸零了，畫面還要維持原樣） */
  const mergeFreezeRef = useRef<{ params: EditorParams; lutIdx: number } | null>(null);
  /* 這張圖被合併過幾次 —— 濾鏡與特效分開算（同一次合併如果兩邊都有套，兩邊都加一）。
     用來源圖當鍵，撤銷／重做換回舊的來源時數字自然跟著回去。 */
  const mergeDepthRef = useRef<Record<string, { lut: number; fx: number }>>({});
  const mergeDepthOf = (src: string) => mergeDepthRef.current[src] || { lut: 0, fx: 0 };

  /* 合併按下去的那一拍參數就已經歸零了（見 mergeEffects），
     所以這幾個照著 state 算就是「合併完」的樣子，不用另外判斷合併中。 */
  const lutCardOn = (idx: number) => selectedLutIdx === idx;
  const isEffectOn = (toolId: string) =>
    (EFFECT_OWN_KEYS[toolId] || [toolId]).some(k => ((params as any)[k] || 0) !== 0);



  /* 選中哪一顆是介面狀態，不是「強度是不是 0」：滑桿拉到 0 時那一顆仍然是選中的，
     白框留在它身上、「原始」不能亮。只有按了「原始」（或一開始什麼都沒選，
     activeToolId 停在 'softLight' 這個「特效頁、不顯示滑桿」的記號）才亮。 */
  const pickedFxId = activeCategory === 'effects' && activeToolId !== 'softLight'
    && EFFECT_TOOLS.some(t => t.id === activeFxId) ? activeFxId : null;
  /** 現在一個特效都沒開、也沒有選中任何一顆嗎（「原始」那張卡片要不要亮白框） */
  const noEffectOn = !pickedFxId && !hasLiveEffect(params);

  /**
   * 進「特效」分頁。
   *
   * 現在真的有開著的特效 → 選中它，上面那根強度滑桿跟著出現；
   * 一個都沒開（＝停在「原始」）→ 誰都不選，上面就不該有滑桿。
   * 以前是一律選第一顆（柔光）的強度鍵，所以明明停在「原始」，
   * 上面卻掛著一根調不到東西的柔光滑桿 —— 那根拖了也看不出變化，
   * 因為柔光根本沒開。
   */
  const enterEffects = () => {
    setActiveCategory('effects');
    const on = EFFECT_TOOLS.find(t => isEffectOn(t.id));
    setActiveFxId(on ? on.id : EFFECT_TOOLS[0].id);
    // 'softLight' 這個值本身就代表「特效頁但不顯示滑桿」（見滑桿那一段的排除清單）
    setActiveToolId(on ? effectAmountId(on.id) : 'softLight');
  };

  /** 「原始」：把所有特效關掉 */
  const clearAllEffects = () => {
    if (mergingRef.current) { pendingTapRef.current = () => tapHandlersRef.current.none(); return; }
    uiFirstRef.current = true;
    const next = { ...paramsRef.current, ...NO_EFFECT_PARAMS } as EditorParams;
    paramsRef.current = next;
    isDirtyRef.current = true;
    setParams(next);
    setIsSoftActive(false); setIsBlurActive(false);
    setIsGrainActive(false); setIsHalationActive(false);
    setActiveToolId('softLight');
    addToHistory(next, selectedLutIdx, false, false, false, false);
  };

  const handleEffectToolSelect = (toolId: string) => {
    releaseFreeze(true);
    tapFastRef.current = true;
    if (mergingRef.current) { pendingTapRef.current = () => tapHandlersRef.current.fx(toolId); return; }
    uiFirstRef.current = true;
    if (FX_TOOLS[toolId]) warmFx(toolId);   // 先把著色器編好，第一次拖才不會卡
    setActiveFxId(toolId);
    const amountId = effectAmountId(toolId);
    setActiveToolId(amountId);

    /* 一次只能套一個特效，而且點下去就是「從頭來過」：
       所有特效的參數（含每一顆的細項）先全部打回預設，再把這一顆打開。
       以前只把別顆的強度歸零、而且這一顆已經開著就整個不動 ——
       於是上一次在細項面板調過的門檻／半徑／色相會留著，
       同一顆特效點兩次得到的結果不一樣。現在點一下就是乾淨的預設狀態。
       四顆開關（柔光／朦朧／噪點／光暈）的狀態也要跟著關掉，
       不然參數是 0 但按鈕還亮著。
       想疊第二個特效就要先按「合併」把現在這個烤進圖層。 */
    const next = resetAllEffectParams(paramsRef.current) as EditorParams;

    // 一律套這一顆的預設值（fresh = true：不理會上次調過的記憶）
    let manSoft = softManuallyAdjusted, manBlur = blurManuallyAdjusted;
    let manGrain = grainManuallyAdjusted, manHalation = halationManuallyAdjusted;
    if (toolId === 'softLight') { const on = softOnPatch(true); Object.assign(next, on.patch); manSoft = on.manual; }
    else if (toolId === 'blur') { const on = blurOnPatch(true); Object.assign(next, on.patch); manBlur = on.manual; }
    else if (toolId === 'colorNoise') { const on = grainOnPatch(true); Object.assign(next, on.patch); manGrain = on.manual; }
    else if (toolId === 'halation') { const on = halationOnPatch(true); Object.assign(next, on.patch); manHalation = on.manual; }
    else {
      Object.assign(next,effectPreset(toolId,FX_DEFS));
    }

    const sOn = toolId === 'softLight', bOn = toolId === 'blur';
    const gOn = toolId === 'colorNoise', hOn = toolId === 'halation';
    setIsSoftActive(sOn); setIsBlurActive(bOn);
    setIsGrainActive(gOn); setIsHalationActive(hOn);
    setSoftManuallyAdjusted(manSoft); setBlurManuallyAdjusted(manBlur);
    setGrainManuallyAdjusted(manGrain); setHalationManuallyAdjusted(manHalation);

    paramsRef.current = next;
    isDirtyRef.current = true;
    setParams(next);
    addToHistory(next, selectedLutIdx, sOn, bOn, gOn, hOn, manSoft, manBlur, manGrain, manHalation);
  };

  /** 打開這顆特效的細項面板 */
  const openEffectDetail = (toolId: string) => {
    const cat = EFFECT_DETAIL_CAT[toolId];
    backFromFxRef.current = true;      // 退回來時把這一顆對回畫面中間
    if (cat) {
      setActiveCategory(cat);
      const first = cat === 'soft' ? SOFT_LIGHT_TOOLS[0] : cat === 'leak' ? LEAK_TOOLS[0] : HALATION_TOOLS[0];
      setActiveToolId(first.id);
      return;
    }
    if (FX_TOOLS[toolId]) {
      warmFx(toolId);
      setActiveFxId(toolId);
      setActiveToolId(FX_TOOLS[toolId][0].id);
      setActiveCategory('fx');
    }
  };

  /** 這顆卡片有沒有細項可以調 */
  const effectHasDetail = (toolId: string) =>
    !!EFFECT_DETAIL_CAT[toolId] || !!(FX_TOOLS[toolId] && FX_TOOLS[toolId].length > 1);

  const fxInputKey=(p:EditorParams)=>`${srcIdent()}|${selectedLutIdx}|${!!lutDataRef.current[lutList[selectedLutIdx]?.id]}|${activeCategory}|${JSON.stringify(Object.fromEntries(Object.entries(p).filter(([key])=>!key.startsWith('fx'))))}|${forceRecalculateEffectsRef.current}`;
  /* Luminance histogram of the colour-processed photo (for soft light).
     Source data, in order of preference:
       · colourSampleRef — 128px reads of the GPU colour result without and
         with the film, taken when the colours were last computed;
       · the CPU result buffers, only when cpuColourKeyRef says they hold
         exactly the current colours (on the GPU path they are stale);
       · otherwise null → the soft layer samples the canvas itself.
     The film strength is applied by mixing the two samples, so moving the
     strength slider never needs new colour data. */
  const colourSampleRef = useRef<{ key: string; d0: Uint8Array | null; d1: Uint8Array | null }>({ key: '', d0: null, d1: null });
  const cpuColourKeyRef = useRef('');
  const colourBinsRef = useRef<{ key: string; bins: Float64Array | null }>({ key: '', bins: null });
  const colourKeyOf = (p: EditorParams) => `${srcIdent()}|${lutList[selectedLutIdx]?.id}|${bakeSigRef.current({ ...p, lutAmount: 0 })}`;
  const colourBinsFor = (p: EditorParams): Float64Array | null => {
    const key = colourKeyOf(p);
    const lut = lutList[selectedLutIdx], hasFilm = !!(lut?.url && lutDataRef.current[lut.id]);
    const a = hasFilm ? p.lutAmount / 100 : 0;
    const binsKey = `${key}|${a}`;
    if (colourBinsRef.current.key === binsKey) return colourBinsRef.current.bins;
    let mixed: Uint8ClampedArray | null = null;
    const smp = colourSampleRef.current;
    if (smp.key === key && smp.d0 && (!hasFilm || smp.d1)) {
      const d0 = smp.d0, d1 = hasFilm ? smp.d1 : null;
      mixed = new Uint8ClampedArray(d0.length);
      for (let i = 0; i < d0.length; i++) mixed[i] = d1 ? d0[i] + (d1[i] - d0[i]) * a : d0[i];
      for (let i = 3; i < mixed.length; i += 4) mixed[i] = 255;
    } else if (cpuColourKeyRef.current === key) {
      const b = buffers.current.preview;
      if (!b.lut0 || (hasFilm && !b.lut100)) return null;
      const n = b.w * b.h, step = Math.max(1, Math.floor(n / 16384));
      mixed = new Uint8ClampedArray(Math.ceil(n / step) * 4);
      for (let i = 0, j = 0; i < n; i += step, j += 4) {
        const o = i * 4;
        for (let k = 0; k < 3; k++) mixed[j + k] = hasFilm ? b.lut0[o + k] + (b.lut100![o + k] - b.lut0[o + k]) * a : b.lut0[o + k];
        mixed[j + 3] = 255;
      }
    }
    if (!mixed) return null;
    const bins = highlightHistogram(mixed);
    colourBinsRef.current = { key: binsKey, bins };
    return bins;
  };
  const legacyInputKey=(p:EditorParams,w:number,h:number,kind:LegacyKind)=>{
    const excluded=kind==='soft'?['soft','softThreshold','softRadius','softColor']:kind==='leak'?['leakOpacity','leakAngle','leakHue']:kind==='blur'?['blur']:kind==='simple'?['colorNoise','vignette']:['fringeIntensity','fringeSize','fringeFeather','fringeHue'];
    return JSON.stringify([srcIdent(),w,h,lutList[selectedLutIdx]?.id,!!lutDataRef.current[lutList[selectedLutIdx]?.id],toneSig(p),Object.fromEntries(Object.entries(p).filter(([k])=>!excluded.includes(k)))]);
  };
  /* 只開了「一種」舊式特效（柔光／光暈／漏光／朦朧，或噪點＋暗角）而且後面沒有別的東西
     要畫在 2D 上：那一層直接在畫面那塊 GPU 表面上算、直接顯示。拖曳中與放開後走同一條，
     所以拖到哪一格、放開就是哪一格；朦朧與噪點以前每動一格都要在 CPU 上整張重算再複製。 */
  const legacyGpuKind=(p:EditorParams):LegacyKind|null=>{
    if(p.grain||p.colorNoise2||anyMask(p)||p.sharpen||hasActiveFx(p))return null;
    const optical=[p.soft>0&&'soft',p.fringeIntensity>0&&'halation',p.leakOpacity>0&&'leak',p.blur>0&&'blur'].filter(Boolean) as LegacyKind[];
    const simple=p.colorNoise>0||p.vignette>0;
    if(optical.length===1&&!simple)return optical[0];
    if(!optical.length&&simple)return 'simple';
    return null;
  };
  const legacyLayer=(kind:LegacyKind,surface:HTMLCanvasElement)=>kind==='soft'?(softPresentRef.current ||= new HalationLayer(surface))
    :kind==='halation'?(halationPresentRef.current ||= new HalationLayer(surface))
    :kind==='leak'?(leakPresentRef.current ||= new HalationLayer(surface))
    :kind==='blur'?(blurPresentRef.current ||= new HalationLayer(surface)):(simplePresentRef.current ||= new HalationLayer(surface));
  const renderLegacy=(layer:HalationLayer,kind:LegacyKind,ctx:CanvasRenderingContext2D,w:number,h:number,key:string,p:EditorParams,bins:Float64Array|null)=>
    kind==='soft'?layer.renderSoft(ctx,w,h,key,p,hslToRgb(p.softColor/100,1,.5),bins)
    :kind==='halation'?layer.render(ctx,w,h,key,p,hslToRgb(p.fringeHue/360,.8,.35))
    :kind==='leak'?layer.renderLeak(ctx,w,h,key,p,hslToRgb(p.leakHue/360,1,.5))
    :kind==='blur'?layer.renderBlur(ctx,w,h,key,p.blur)
    :noisePatternRef.current?layer.renderSimple(ctx,w,h,key,p,noisePatternRef.current,p.colorNoise>0?noiseLayerFor(w,h):null):null;
  /* 噪點層用 2D 畫布照原本 applyComplexEffects 的方式鋪一次（同一張圖樣、同一個縮放），
     GPU 只負責 overlay —— 噪點長得跟以前 2D 疊出來的一模一樣，尺寸不變就一直沿用。 */
  const noiseLayerRef=useRef<HTMLCanvasElement|null>(null);
  const noiseLayerFor=(w:number,h:number)=>{
    let c=noiseLayerRef.current;const pattern=noisePatternRef.current;
    if(c&&c.width===w&&c.height===h&&c.dataset.pattern===String(patternIdOf(pattern)))return c;
    if(!pattern)return null;
    c ||=document.createElement('canvas');c.width=w;c.height=h;
    const g=c.getContext('2d')!,fill=g.createPattern(pattern,'repeat'),scale=Math.max(w,h)/1080;
    if(!fill)return null;
    g.save();g.scale(scale,scale);g.fillStyle=fill;g.fillRect(0,0,w/scale,h/scale);g.restore();
    c.dataset.pattern=String(patternIdOf(pattern));noiseLayerRef.current=c;return c;
  };
  const applyComplexEffects = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, p: EditorParams, scale: number, sharedBuf: Uint8ClampedArray | null, isInteracting: boolean, baking: boolean, sourcePixelData: Uint8ClampedArray | null) => {
    const lut = lutList[selectedLutIdx];
    const lutId = lut?.id || 'none';
    const toneStr = toneSig(p);

    // 朦朧或噪點（＋暗角）單獨開著：跟拖曳中同一條 GPU 路線（見 legacyGpuKind）
    if (!baking && !forceRecalculateEffectsRef.current && ctx.canvas === displayCanvasRef.current && fxSurfaceRef.current) {
      const kind = legacyGpuKind(p);
      if (kind === 'blur' || kind === 'simple') {
        const key = legacyInputKey(p, w, h, kind);
        if (renderLegacy(legacyLayer(kind, fxSurfaceRef.current), kind, ctx, w, h, key, p, null)) { legacyPreviewRef.current = { kind, key }; showFxSurface(true); return; }
      }
    }

    let blurNeedsLazyRefine = false;
    let softNeedsLazyRefine = false;
    let noise2NeedsLazyRefine = false;
    let halationNeedsLazyRefine = false;

    // 1. GRAIN (Fast overlay, always run)
    if (p.grain > 0 && grainPatternRef.current) {
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = (p.grain / 100) * 0.42; 
        if (!compiledGrainPatternRef.current) {
            compiledGrainPatternRef.current = ctx.createPattern(grainPatternRef.current, 'repeat');
        }
        const pattern = compiledGrainPatternRef.current;
        if (pattern) {
            // Apply scale to make grain size resolution-independent (based on 1080p reference)
            const grainScale = scale; 
            ctx.scale(grainScale, grainScale);
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, w / grainScale, h / grainScale);
        }
        ctx.restore();
    }

    // 2. COLOR NOISE (Fast overlay, always run)
    if (p.colorNoise > 0 && noisePatternRef.current) {
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = (p.colorNoise / 100) * 0.63;
        if (!compiledNoisePatternRef.current) {
            compiledNoisePatternRef.current = ctx.createPattern(noisePatternRef.current, 'repeat');
        }
        const pattern = compiledNoisePatternRef.current;
        if (pattern) {
            const noiseScale = scale;
            ctx.scale(noiseScale, noiseScale);
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, w / noiseScale, h / noiseScale);
        }
        ctx.restore();
    }

    // 3. COLOR NOISE II (Advanced masked, cache-supported)
    let useNoise2Cache = false;
    if (!baking && !forceRecalculateEffectsRef.current && cachedNoise2CanvasRef.current && noise2CacheStateRef.current) {
        const c = noise2CacheStateRef.current;
        // 一定要是「同一張照片」算出來的才敢用（見型別上的註解）
        const sameSize = c.src === buffersSrcRef.current && c.w === w && c.h === h;
        const sameParams = c.colorNoise2 === p.colorNoise2;
        
        if (sameSize && sameParams) {
            useNoise2Cache = true;
            const sameBase = c.lutId === lutId &&
                c.brightness === p.brightness &&
                c.exposure === p.exposure &&
                c.contrast === p.contrast &&
                c.highlights === p.highlights &&
                c.shadows === p.shadows &&
                c.temp === p.temp &&
                c.tint === p.tint &&
                c.sat === p.sat &&
                c.vib === p.vib &&
                c.toneStr === toneStr;
            if (!sameBase) {
                noise2NeedsLazyRefine = true;
            }
        }
    }

    if (p.colorNoise2 > 0 && noisePatternRef.current && sourcePixelData) {
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';

        if (useNoise2Cache && cachedNoise2CanvasRef.current) {
            ctx.drawImage(cachedNoise2CanvasRef.current, 0, 0, w, h);
        } else {
            const TARGET_PROC_SIZE = 800; 
            const procScale = Math.min(1.0, TARGET_PROC_SIZE / Math.max(w, h));
            const hw = (w * procScale) | 0;
            const hh = (h * procScale) | 0;

            if (!cachedNoise2CanvasRef.current) {
                cachedNoise2CanvasRef.current = document.createElement('canvas');
            }
            const temp = cachedNoise2CanvasRef.current;
            if (temp.width !== hw || temp.height !== hh) { 
                temp.width = hw; 
                temp.height = hh; 
            }
            const tCtx = temp.getContext('2d', { willReadFrequently: true })!;
            
            tCtx.drawImage(ctx.canvas, 0, 0, hw, hh);
            const sImgData = tCtx.getImageData(0, 0, hw, hh);
            const sData = sImgData.data;
            
            tCtx.save();
            const noiseScale = scale * 2 * procScale; 
            tCtx.scale(noiseScale, noiseScale);
            tCtx.fillStyle = tCtx.createPattern(noisePatternRef.current, 'repeat')!;
            tCtx.fillRect(0, 0, hw / noiseScale, hh / noiseScale);
            tCtx.restore();
            
            const nImgData = tCtx.getImageData(0, 0, hw, hh);
            const nData = nImgData.data;
            const baseAlpha = (p.colorNoise2 / 100) * 0.756 * 255;
            
            const len = nData.length;
            for (let i = 0; i < len; i += 4) {
                const luma = (sData[i] * 0.299 + sData[i+1] * 0.587 + sData[i+2] * 0.114) / 255;
                const mask = 1.0 - (luma * luma * luma); 
                nData[i+3] = baseAlpha * mask;
            }
            tCtx.putImageData(nImgData, 0, 0);
            
            ctx.drawImage(temp, 0, 0, w, h);

            if (!baking) {
                noise2CacheStateRef.current = {
                    src: buffersSrcRef.current, w, h, colorNoise2: p.colorNoise2, lutId,
                    brightness: p.brightness, exposure: p.exposure, contrast: p.contrast,
                    highlights: p.highlights, shadows: p.shadows, temp: p.temp, tint: p.tint,
                    sat: p.sat, vib: p.vib, toneStr
                };
            }
        }
        ctx.restore();
    }

    // 4. BLUR (Cache-supported)
    let useBlurCache = false;
    if (!baking && !forceRecalculateEffectsRef.current && cachedBlurCanvasRef.current && blurCacheStateRef.current) {
        const c = blurCacheStateRef.current;
        const sameSize = c.src === buffersSrcRef.current && c.w === w && c.h === h;
        const sameParams = c.blur === p.blur;
        
        if (sameSize && sameParams) {
            useBlurCache = true;
            const sameBase = c.lutId === lutId &&
                c.brightness === p.brightness &&
                c.exposure === p.exposure &&
                c.contrast === p.contrast &&
                c.highlights === p.highlights &&
                c.shadows === p.shadows &&
                c.temp === p.temp &&
                c.tint === p.tint &&
                c.sat === p.sat &&
                c.vib === p.vib &&
                c.toneStr === toneStr;
            if (!sameBase) {
                blurNeedsLazyRefine = true;
            }
        }
    }

    if (p.blur > 0) {
        ctx.save();
        ctx.globalAlpha = (p.blur / 240) * 1.5;

        if (useBlurCache && cachedBlurCanvasRef.current) {
            ctx.drawImage(cachedBlurCanvasRef.current, 0, 0, w, h);
        } else {
            const TARGET_PROC_SIZE = 800;
            const procScale = Math.min(1.0, TARGET_PROC_SIZE / Math.max(w, h));
            const tw = (w * procScale) | 0;
            const th = (h * procScale) | 0;

            if (!cachedBlurCanvasRef.current) {
                cachedBlurCanvasRef.current = document.createElement('canvas');
            }
            const temp = cachedBlurCanvasRef.current;
            if (temp.width !== tw || temp.height !== th) { 
                temp.width = tw; 
                temp.height = th; 
            }
            
            const tCtx = temp.getContext('2d', { willReadFrequently: true })!;
            tCtx.clearRect(0, 0, tw, th);
            tCtx.drawImage(ctx.canvas, 0, 0, tw, th);
            
            const tImgData = tCtx.getImageData(0, 0, tw, th);
            const r = (p.blur / 6) * scale * procScale * 1.5;
            
            fastBlur(tImgData, tw, th, r, sharedBuf);
            tCtx.putImageData(tImgData, 0, 0);

            ctx.drawImage(temp, 0, 0, w, h);

            if (!baking) {
                blurCacheStateRef.current = {
                    src: buffersSrcRef.current, w, h, blur: p.blur, lutId,
                    brightness: p.brightness, exposure: p.exposure, contrast: p.contrast,
                    highlights: p.highlights, shadows: p.shadows, temp: p.temp, tint: p.tint,
                    sat: p.sat, vib: p.vib, toneStr
                };
            }
        }
        ctx.restore();
    }

    // 5. SOFT LIGHT GLOW (Cache-supported)
    let useSoftCache = false;
    if (!baking && !forceRecalculateEffectsRef.current && cachedSoftCanvasRef.current && softCacheStateRef.current) {
        const c = softCacheStateRef.current;
        const sameSize = c.src === buffersSrcRef.current && c.w === w && c.h === h;
        const sameParams = c.soft === p.soft &&
            c.softThreshold === p.softThreshold &&
            c.softRadius === p.softRadius &&
            c.softColor === p.softColor;
        
        if (sameSize && sameParams) {
            useSoftCache = true;
            const sameBase = c.lutId === lutId &&
                c.brightness === p.brightness &&
                c.exposure === p.exposure &&
                c.contrast === p.contrast &&
                c.highlights === p.highlights &&
                c.shadows === p.shadows &&
                c.temp === p.temp &&
                c.tint === p.tint &&
                c.sat === p.sat &&
                c.vib === p.vib &&
                c.toneStr === toneStr;
            if (!sameBase) {
                softNeedsLazyRefine = true;
            }
        }
    }

    /* 沒在用的獨立特效層把自己的 WebGL context 與整張大小的貼圖還回去：
       疊過柔光／光暈再關掉時，它們原本會一直佔著記憶體到離開編輯器。 */
    /* 關掉後等 8 秒都沒再開才釋放：來回切換時不用重建（重建要重新編譯著色器，會頓一下）。 */
    if (ctx.canvas === displayCanvasRef.current) {
      const idle = (ref: typeof softLayerRef, on: boolean, timer: React.MutableRefObject<number>) => {
        if (on) { if (timer.current) { clearTimeout(timer.current); timer.current = 0; } return; }
        if (!ref.current || timer.current) return;
        timer.current = window.setTimeout(() => { timer.current = 0; ref.current?.dispose(); ref.current = null; }, 8000);
      };
      idle(softLayerRef, p.soft > 0, softIdleTimerRef);
      idle(halationLayerRef, p.fringeIntensity > 0, halationIdleTimerRef);
    }
    if (p.soft > 0) {
      const direct=!baking&&!forceRecalculateEffectsRef.current&&ctx.canvas===displayCanvasRef.current&&fxSurfaceRef.current&&!p.leakOpacity&&!p.fringeIntensity&&!p.vignette&&!anyMask(p)&&!hasActiveFx(p);
      if(direct){
        const key=legacyInputKey(p,w,h,'soft');
        softPresentRef.current ||= new HalationLayer(fxSurfaceRef.current!);
        if(softPresentRef.current.renderSoft(ctx,w,h,key,p,hslToRgb(p.softColor/100,1,.5),colourBinsFor(p))){legacyPreviewRef.current={kind:'soft',key};showFxSurface(true);return;}
      }
      ctx.save(); 
      ctx.globalCompositeOperation = 'screen'; 
      ctx.globalAlpha = (p.soft / 100) * (p.softColor > 0 ? 3.0 : 1.5);
      let acceleratedSoft:HTMLCanvasElement|null=null;
      if(!baking&&!forceRecalculateEffectsRef.current){
        const {soft,softThreshold,softRadius,softColor,fringeIntensity,fringeSize,fringeFeather,fringeHue,leakOpacity,leakAngle,leakHue,vignette,...upstream}=p;
        const input=Object.fromEntries(Object.entries(upstream).filter(([key])=>!key.startsWith('fx')));
        softLayerRef.current ||= new HalationLayer();
        acceleratedSoft=softLayerRef.current.renderSoft(ctx,w,h,JSON.stringify([srcIdent(),w,h,lutId,toneStr,input]),p,hslToRgb(p.softColor/100,1,.5),colourBinsFor(p));
      }
      if(acceleratedSoft){
        ctx.drawImage(acceleratedSoft,0,0,w,h);
      } else if (useSoftCache && cachedSoftCanvasRef.current) {
        ctx.drawImage(cachedSoftCanvasRef.current, 0, 0, w, h);
      } else {
        const TARGET_PROC_SIZE = 800;
        const procScale = Math.min(1.0, TARGET_PROC_SIZE / Math.max(w, h));
        const mw = (w * procScale) | 0;
        const mh = (h * procScale) | 0;

        if (!cachedSoftCanvasRef.current) {
            cachedSoftCanvasRef.current = document.createElement('canvas');
        }
        const maskCanvas = cachedSoftCanvasRef.current;
        if (maskCanvas.width !== mw || maskCanvas.height !== mh) { maskCanvas.width = mw; maskCanvas.height = mh; }
        const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
        mCtx.drawImage(ctx.canvas, 0, 0, mw, mh);
        
        const currentData = mCtx.getImageData(0, 0, mw, mh).data;
        const highlightSelection = selectHighlights(highlightHistogram(currentData),100-p.softThreshold);
        const mImgData = mCtx.createImageData(mw, mh);
        const mData = mImgData.data;
        
        let r_c = 0, g_c = 0, b_c = 0;
        if (p.softColor > 0) {
          const [tr, tg, tb] = hslToRgb(p.softColor / 100, 1.0, 0.5);
          r_c = tr; g_c = tg; b_c = tb;
        }
        
        for (let i = 0; i < currentData.length; i += 4) {
          const r = currentData[i], g = currentData[i+1], b = currentData[i+2];
          mData[i] = p.softColor > 0 ? r_c : r; mData[i+1] = p.softColor > 0 ? g_c : g; mData[i+2] = p.softColor > 0 ? b_c : b;
          
          mData[i+3] = 255*highlightWeight(luminanceBin(r,g,b),highlightSelection);
        }

        const blurRadius = (p.softRadius / 100) * 80 * scale * procScale;
        fastBlur(mImgData, mw, mh, blurRadius, sharedBuf);
        mCtx.putImageData(mImgData, 0, 0);

        ctx.drawImage(maskCanvas, 0, 0, w, h);

        if (!baking) {
            softCacheStateRef.current = {
                src: buffersSrcRef.current, w, h, soft: p.soft, softThreshold: p.softThreshold, softRadius: p.softRadius, softColor: p.softColor, lutId,
                brightness: p.brightness, exposure: p.exposure, contrast: p.contrast,
                highlights: p.highlights, shadows: p.shadows, temp: p.temp, tint: p.tint,
                sat: p.sat, vib: p.vib, toneStr
            };
        }
      }
      ctx.restore();
    }

    // 6. LIGHT LEAK (Always run, fast gradient overlay)
    if (p.leakOpacity > 0) {
        if(!baking&&!forceRecalculateEffectsRef.current&&ctx.canvas===displayCanvasRef.current&&fxSurfaceRef.current&&!p.fringeIntensity&&!p.vignette&&!anyMask(p)&&!hasActiveFx(p)){
          const key=legacyInputKey(p,w,h,'leak');leakPresentRef.current ||=new HalationLayer(fxSurfaceRef.current);
          if(leakPresentRef.current.renderLeak(ctx,w,h,key,p,hslToRgb(p.leakHue/360,1,.5))){legacyPreviewRef.current={kind:'leak',key};showFxSurface(true);return;}
        }
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const opacity = p.leakOpacity;
        const angle = p.leakAngle;
        const hue = p.leakHue;
        const rad = (angle - 180) * (Math.PI / 180);
        const r = Math.max(w, h) * 1.5;
        const cx = w / 2;
        const cy = h / 2;
        const x1 = cx + Math.cos(rad) * r;
        const y1 = cy + Math.sin(rad) * r;
        const x2 = cx - Math.cos(rad) * r;
        const y2 = cy - Math.sin(rad) * r;
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        const [lr, lg, lb] = hslToRgb(hue / 360, 1.0, 0.5); 
        grad.addColorStop(0, `rgba(${lr},${lg},${lb},${opacity/100})`);
        grad.addColorStop(0.5, `rgba(${lr},${lg},${lb},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }

    // 7. HALATION / FRINGE (Cache-supported)
    let useHalationCache = false;
    if (!baking && !forceRecalculateEffectsRef.current && cachedHalationCanvasRef.current && halationCacheStateRef.current) {
        const c = halationCacheStateRef.current;
        const sameSize = c.src === buffersSrcRef.current && c.w === w && c.h === h;
        const sameParams = c.fringeIntensity === p.fringeIntensity &&
            c.fringeSize === p.fringeSize &&
            c.fringeFeather === p.fringeFeather &&
            c.fringeHue === p.fringeHue;
        
        if (sameSize && sameParams) {
            useHalationCache = true;
            const sameBase = c.lutId === lutId &&
                c.brightness === p.brightness &&
                c.exposure === p.exposure &&
                c.contrast === p.contrast &&
                c.highlights === p.highlights &&
                c.shadows === p.shadows &&
                c.temp === p.temp &&
                c.tint === p.tint &&
                c.sat === p.sat &&
                c.vib === p.vib &&
                c.toneStr === toneStr;
            if (!sameBase) {
                halationNeedsLazyRefine = true;
            }
        }
    }

    let acceleratedHalation: HTMLCanvasElement | null = null;
    const directHalation=p.fringeIntensity>0&&!baking&&!forceRecalculateEffectsRef.current&&ctx.canvas===displayCanvasRef.current&&fxSurfaceRef.current&&!p.vignette&&!anyMask(p)&&!hasActiveFx(p);
    if(directHalation){
      const key=legacyInputKey(p,w,h,'halation');
      halationPresentRef.current ||= new HalationLayer(fxSurfaceRef.current!);
      if(halationPresentRef.current.render(ctx,w,h,key,p,hslToRgb(p.fringeHue/360,.8,.35))){legacyPreviewRef.current={kind:'halation',key};showFxSurface(true);return;}
    }
    if (p.fringeIntensity > 0 && !baking && !forceRecalculateEffectsRef.current) {
        const {fringeIntensity,fringeSize,fringeFeather,fringeHue,...upstream}=p;
        // Parameters after this layer do not alter its source pixels.
        const input=Object.fromEntries(Object.entries(upstream).filter(([key])=>!key.startsWith('fx')&&key!=='vignette'));
        const key=JSON.stringify([srcIdent(),w,h,lutId,toneStr,input]);
        halationLayerRef.current ||= new HalationLayer();
        acceleratedHalation=halationLayerRef.current.render(ctx,w,h,key,p,hslToRgb(p.fringeHue/360,.8,.35));
    }
    if (acceleratedHalation) {
        ctx.save();ctx.globalCompositeOperation='screen';ctx.drawImage(acceleratedHalation,0,0,w,h);ctx.restore();
    } else if (p.fringeIntensity > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen'; 

        if (useHalationCache && cachedHalationCanvasRef.current) {
            ctx.drawImage(cachedHalationCanvasRef.current, 0, 0, w, h);
        } else {
            const TARGET_PROC_SIZE = 800; 
            const procScale = Math.min(1.0, TARGET_PROC_SIZE / Math.max(w, h));
            const hw = (w * procScale) | 0;
            const hh = (h * procScale) | 0;

            if (!cachedHalationCanvasRef.current) {
                cachedHalationCanvasRef.current = document.createElement('canvas');
            }
            const hCanvas = cachedHalationCanvasRef.current;
            if (hCanvas.width !== hw || hCanvas.height !== hh) { hCanvas.width = hw; hCanvas.height = hh; }
            const hCtx = hCanvas.getContext('2d', { willReadFrequently: true })!;
            
            const { fringeIntensity: _strength, fringeHue: _hue, fringeFeather: _feather, ...sourceParams } = p;
            const preparationKey = JSON.stringify([srcIdent(), w, h, hw, hh, lutId, toneStr, sourceParams]);
            const prepared = !baking && !forceRecalculateEffectsRef.current && halationPreparedRef.current?.key === preparationKey
              ? halationPreparedRef.current : null;
            let srcData: Uint8ClampedArray;
            let highImgData: ImageData;
            if (prepared) {
              srcData = prepared.source;
              highImgData = prepared.blurred;
            } else {
            hCtx.drawImage(ctx.canvas, 0, 0, hw, hh);
            srcData = hCtx.getImageData(0, 0, hw, hh).data;
            const len = srcData.length;
            
            const highData = new Uint8ClampedArray(len);
            const threshold = 160;
            for (let i = 0; i < len; i += 4) {
                const luma = srcData[i]*0.299 + srcData[i+1]*0.587 + srcData[i+2]*0.114;
                if (luma > threshold) {
                    const intensity = Math.pow((luma - threshold) / (255 - threshold), 1.5);
                    highData[i] = 255;
                    highData[i+1] = 255;
                    highData[i+2] = 255;
                    highData[i+3] = intensity * 255;
                } else {
                    highData[i+3] = 0;
                }
            }
            
            highImgData = new ImageData(highData, hw, hh);
            const maxBlur = hw * 0.08 * 0.8553125; 
            const sizeMultiplier = p.fringeSize / 100;
            const blurRadius = Math.max(1, maxBlur * sizeMultiplier);
            
            fastBlur(highImgData, hw, hh, blurRadius, sharedBuf); 
            if (!baking) halationPreparedRef.current = { key: preparationKey, source: srcData, blurred: highImgData };
            }
            const len = srcData.length;
            
            const glowImgData = new ImageData(new Uint8ClampedArray(len), hw, hh);
            const glowPixels = glowImgData.data;
            const blurredPixels = highImgData.data;
            
            const hue = p.fringeHue;
            const [fR, fG, fB] = hslToRgb(hue/360, 0.8, 0.35);
            const globalIntensity = (p.fringeIntensity / 50) * 3.0;
            const falloffCurve = 1.0 + ((100 - p.fringeFeather) / 100) * 4.0;
            
            for (let i = 0; i < len; i += 4) {
                const alpha = blurredPixels[i+3] / 255; 
                if (alpha > 0.005) {
                    const luma = srcData[i]*0.299 + srcData[i+1]*0.587 + srcData[i+2]*0.114;
                    const darkness = Math.max(0, 255 - luma) / 255;
                    const darkMask = Math.pow(darkness, falloffCurve);
                    const strength = Math.min(1.0, alpha * darkMask * globalIntensity);
                    
                    if (strength > 0.001) {
                        glowPixels[i] = fR * strength;
                        glowPixels[i+1] = fG * strength;
                        glowPixels[i+2] = fB * strength;
                        glowPixels[i+3] = 255;
                    }
                }
            }
            
            hCtx.putImageData(glowImgData, 0, 0);
            ctx.drawImage(hCanvas, 0, 0, w, h);

            if (!baking) {
                halationCacheStateRef.current = {
                    src: buffersSrcRef.current, w, h, fringeIntensity: p.fringeIntensity, fringeSize: p.fringeSize, fringeFeather: p.fringeFeather, fringeHue: p.fringeHue, lutId,
                    brightness: p.brightness, exposure: p.exposure, contrast: p.contrast,
                    highlights: p.highlights, shadows: p.shadows, temp: p.temp, tint: p.tint,
                    sat: p.sat, vib: p.vib, toneStr
                };
            }
        }
        ctx.restore();
    }

    // 8. VIGNETTE (Pre-calculated extreme state, slider controls opacity/strength)
    if (p.vignette > 0) {
      ctx.save(); 
      ctx.globalCompositeOperation = 'multiply';
      
      // Calculate/cache the extreme vignette canvas only when dimensions change
      if (!cachedVignetteCanvasRef.current || 
          cachedVignetteCanvasRef.current.width !== w || 
          cachedVignetteCanvasRef.current.height !== h) {
          
          if (!cachedVignetteCanvasRef.current) {
              cachedVignetteCanvasRef.current = document.createElement('canvas');
          }
          const vCvs = cachedVignetteCanvasRef.current;
          vCvs.width = w;
          vCvs.height = h;
          const vCtx = vCvs.getContext('2d')!;
          vCtx.clearRect(0, 0, w, h);
          
          // Create extreme gradient (maximum vignette depth: fully black at corners)
          const grad = vCtx.createRadialGradient(w/2, h/2, w/3, w/2, h/2, Math.max(w, h));
          grad.addColorStop(0, "rgba(0,0,0,0)"); 
          grad.addColorStop(1, "rgba(0,0,0,1.0)");
          vCtx.fillStyle = grad; 
          vCtx.fillRect(0, 0, w, h);
      }
      
      const strength = p.vignette / 100;
      ctx.globalAlpha = Math.min(1.0, strength * 0.8);
      ctx.drawImage(cachedVignetteCanvasRef.current, 0, 0, w, h);
      
      if (strength > 1.25) {
          ctx.globalAlpha = Math.min(1.0, (strength - 1.25) * 0.8);
          ctx.drawImage(cachedVignetteCanvasRef.current, 0, 0, w, h);
      }
      ctx.restore();
    }

    // 9. 遮色片（可以好幾個、五種，見 utils/masks）
    // 紅色遮罩只是編輯時看得到遮色片範圍用的輔助顯示，烘焙（導出、縮圖）出來的圖片絕對不能有它。
    /* 拖遮色片自己的參數（範圍、平滑、羽化…）時，紅色遮罩一定顯示、而且跟著滑桿即時變：那正是使用者要看的東西。
       拖九個調整時照舊收起來，才看得到調出來的樣子。 */
    const showOverlay = !baking && activeCategory === 'mask'
      && (maskRangeDragRef.current || (!!p.maskShowOverlay && !(isInteracting && !activeDragRef.current && !maskPaintingRef.current)));
    const { list: maskItems, active: maskAct } = maskList(p);
    const actMask = maskItems[maskAct];
    /* 拖遮色片形狀（建立／移動／拉長／旋轉）或刷筆刷時走「即時疊層」：底下的畫布先套好其他遮色片，
       選中的這一個「調整後的整張圖」算一次放在上面那張畫布，之後每一次移動只重畫選取範圍
       （幾次 GPU 的 2D 合成），整條管線一次都不用重跑。後面還有 GLSL 特效時特效要吃遮色片的結果，不能這樣疊。 */
    const sliderLive = maskSliderLiveRef.current;
    const maskLive = (!!activeDragRef.current || maskPaintingRef.current || sliderLive) && !baking && ctx.canvas === displayCanvasRef.current
      && !!maskLiveCanvasRef.current && !hasActiveFx(p) && !!actMask?.maskCreated
      && (sliderLive || actMask.maskType === 'linear' || actMask.maskType === 'radial' || actMask.maskType === 'brush');
    if (!maskLive && maskLiveRef.current && ctx.canvas === displayCanvasRef.current && !baking) hideMaskLive();
    const maskWork = maskItems.some((m, i) => m.maskCreated && (hasMaskAdj(m) || (i === maskAct && showOverlay)));
    const ovEl = !baking && ctx.canvas === displayCanvasRef.current ? maskOverlayCanvasRef.current : null;
    let ovDrawn = false;
    /** 留一份「選中這一個以外都畫好」的畫面（只有選中的後面沒有其他有調整的遮色片時，這時候的畫面剛好就是） */
    const snapNoActive = () => {
      if (baking || maskLive || ctx.canvas !== displayCanvasRef.current || activeCategory !== 'mask' || hasActiveFx(p) || !actMask?.maskCreated) return;
      if (maskItems.slice(maskAct + 1).some(m => m.maskCreated && hasMaskAdj(m))) { maskNoActiveKeyRef.current = ''; return; }
      const c = maskNoActiveRef.current ??= document.createElement('canvas');
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = c.getContext('2d')!; g.globalCompositeOperation = 'copy'; g.drawImage(ctx.canvas, 0, 0); g.globalCompositeOperation = 'source-over';
      maskNoActiveKeyRef.current = maskPreKeyOf(p, w, h, maskItems, maskAct);
    };
    if (maskWork) {
      const sc = () => { const c = document.createElement('canvas'); return c; };
      const tempC = maskTempCanvasRef.current ??= sc();
      const outC = maskOutCanvasRef.current ??= sc();
      const alphaC = maskAlphaCanvasRef.current ??= sc();
      for (const c of [tempC, outC, alphaC]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      /* 顏色／明度範圍看的是「套遮色片之前」的畫面：先複製一份（GPU 搬移），範圍沒變就沿用算好的選取 */
      let baseCopy: HTMLCanvasElement | null = null;
      if (maskItems.some(m => m.maskCreated && (m.maskType === 'color' || m.maskType === 'luma'))) {
        baseCopy = maskBaseCopyRef.current ??= sc();
        if (baseCopy.width !== w || baseCopy.height !== h) { baseCopy.width = w; baseCopy.height = h; }
        const bg = baseCopy.getContext('2d')!; bg.globalCompositeOperation = 'copy'; bg.drawImage(ctx.canvas, 0, 0); bg.globalCompositeOperation = 'source-over';
      }
      /* 點了照片、還沒讀到顏色／亮度的取樣：從這張「套遮色片之前」的畫面讀（5×5 平均），寫回參數 */
      if (baseCopy) {
        const bgc = baseCopy.getContext('2d', { willReadFrequently: true })!;
        const readAt = (x: number, y: number) => {
          const px = Math.max(0, Math.min(w - 5, Math.round(x * w) - 2)), py = Math.max(0, Math.min(h - 5, Math.round(y * h) - 2));
          const d = bgc.getImageData(px, py, 5, 5).data; let r = 0, g = 0, b = 0;
          for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; }
          return [Math.round(r / 25), Math.round(g / 25), Math.round(b / 25)] as const;
        };
        let resolved = false;
        const pr = paramsRef.current;
        const pools = [maskItems.flatMap(m => m.maskColors || []), pr.maskColors || [], ...(pr.masks || []).map(m => m.maskColors || [])];
        for (const pool of pools) for (const c of pool) if (c.r < 0) { const [r, g, b] = readAt(c.x, c.y); c.r = r; c.g = g; c.b = b; resolved = true; }
        const ls = pr.maskLumSample;
        if (ls && actMask?.maskType === 'luma' && !baking) {
          const [r, g, b] = readAt(ls.x, ls.y);
          const L = rgbToLab(r, g, b)[0];
          pr.maskLumLo = actMask.maskLumLo = Math.max(0, Math.round(L - 15));
          pr.maskLumHi = actMask.maskLumHi = Math.min(100, Math.round(L + 15));
          pr.maskLumSample = null;
          resolved = true;
        }
        if (resolved) scheduleParamsSync();
      }
      const baseKey = baseCopy ? `${w}x${h}|${srcIdent()}|${selectedLutIdx}|${JSON.stringify(Object.entries(p).filter(([k]) => !k.startsWith('mask')))}` : '';
      const fastRange = isInteracting && !baking;
      const alphaOf = (m: MaskSnap) => maskAlpha(alphaC, maskCacheId(m), m, w, h, baseCopy, baseKey, fastRange);
      const composite = (src: HTMLCanvasElement) => {
        const og = outC.getContext('2d')!;
        og.globalCompositeOperation = 'copy'; og.drawImage(src, 0, 0);
        og.globalCompositeOperation = 'destination-in'; og.drawImage(alphaC, 0, 0);
        og.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(outC, 0, 0); ctx.restore();
      };
      const applyOne = (m: MaskSnap) => { adjustMaskInto(tempC, ctx.canvas, m, w, h); alphaOf(m); composite(tempC); };
      /* 選中那一個「之前」的遮色片在調選中這一個時都不會變：套完它們的樣子留一份，
         下一格直接貼回來，只重算選中的這一個（以及它後面的）。 */
      const live2d = !baking && ctx.canvas === displayCanvasRef.current;
      const before = maskItems.slice(0, maskAct).filter(m => m.maskCreated && hasMaskAdj(m));
      if (before.length && live2d) {
        const pk = `${w}x${h}|${srcIdent()}|${selectedLutIdx}|${JSON.stringify(Object.entries(p).filter(([k]) => !k.startsWith('mask')))}|${JSON.stringify(maskItems.slice(0, maskAct))}`;
        const pc = maskPrefixRef.current ??= sc();
        if (maskPrefixKeyRef.current === pk && pc.width === w && pc.height === h) {
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'copy'; ctx.drawImage(pc, 0, 0); ctx.restore();
        } else {
          before.forEach(applyOne);
          if (pc.width !== w || pc.height !== h) { pc.width = w; pc.height = h; }
          const pg = pc.getContext('2d')!; pg.globalCompositeOperation = 'copy'; pg.drawImage(ctx.canvas, 0, 0); pg.globalCompositeOperation = 'source-over';
          maskPrefixKeyRef.current = pk;
        }
      } else before.forEach(applyOne);
      snapNoActive();
      maskItems.forEach((m, i) => {
        if (i <= maskAct - 1) return;            // 前面的已經套好了
        if (!m.maskCreated || !hasMaskAdj(m)) return;
        if (i === maskAct && maskLive) return;   // 選中的這一個交給即時疊層
        applyOne(m);
      });
      if (maskLive && actMask) {
        // 這一次拖曳／刷的第一格：把「選中這一個以外都畫好」的畫面縮小留一份當 pre，之後每一格只動上面那張
        const lw = Math.max(1, Math.round(w * Math.min(1, MASK_LIVE_MAX / Math.max(w, h))));
        const lh = Math.max(1, Math.round(h * Math.min(1, MASK_LIVE_MAX / Math.max(w, h))));
        const preKey = `${w}x${h}|${srcIdent()}|${selectedLutIdx}|${JSON.stringify(Object.entries(p).filter(([k]) => !k.startsWith('mask')))}|${JSON.stringify(maskItems.filter((_, i) => i !== maskAct))}`;
        const pre = maskLivePreRef.current ??= sc();
        if (maskLivePreKeyRef.current !== preKey || pre.width !== lw || pre.height !== lh) {
          if (pre.width !== lw || pre.height !== lh) { pre.width = lw; pre.height = lh; }
          const pg = pre.getContext('2d')!;
          pg.globalCompositeOperation = 'copy'; pg.imageSmoothingQuality = 'high'; pg.drawImage(ctx.canvas, 0, 0, lw, lh); pg.globalCompositeOperation = 'source-over';
          maskLivePreKeyRef.current = preKey;
          maskLiveKeyRef.current = '';
        }
        liveAdjust(actMask, showOverlay);
        paintMaskLive(actMask);
      } else if (showOverlay && actMask?.maskCreated && ovEl) {
        // 紅色輔助：選中的那一個的範圍，畫在自己那一層（顯示／隱藏交給 CSS，跟參考線同一幀）
        alphaOf(actMask);
        if (ovEl.width !== w || ovEl.height !== h) { ovEl.width = w; ovEl.height = h; }
        const og = ovEl.getContext('2d')!;
        og.globalCompositeOperation = 'copy'; og.fillStyle = 'rgba(220,38,38,0.5)'; og.fillRect(0, 0, w, h);
        og.globalCompositeOperation = 'destination-in'; og.drawImage(alphaC, 0, 0);
        og.globalCompositeOperation = 'source-over';
        ovDrawn = true;
        /* 顏色／明度範圍要看畫面才算得出來：留一份縮小的，下次切回這一個時先拿來顯示（見 selectMask） */
        if (actMask.maskType === 'color' || actMask.maskType === 'luma') {
          const k = Math.min(1, 640 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
          const cache = maskRangeOvCacheRef.current;
          let c = cache.get(actMask.maskId);
          if (!c) { c = document.createElement('canvas'); cache.set(actMask.maskId, c); if (cache.size > 12) { const old = cache.keys().next().value; if (old !== undefined) cache.delete(old); } }
          if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
          const cg = c.getContext('2d')!; cg.globalCompositeOperation = 'copy'; cg.drawImage(alphaC, 0, 0, cw, ch); cg.globalCompositeOperation = 'source-over';
        }
      }
    } else snapNoActive();
    if (ovEl && !maskLive) ovEl.style.display = ovDrawn ? 'block' : 'none';

    const needsRefinement = blurNeedsLazyRefine || softNeedsLazyRefine || noise2NeedsLazyRefine || halationNeedsLazyRefine;
    if (needsRefinement && !baking) {
        if (lazyCacheTimeoutRef.current) {
            clearTimeout(lazyCacheTimeoutRef.current);
        }
        lazyCacheTimeoutRef.current = setTimeout(() => {
            forceRecalculateEffectsRef.current = true;
            isDirtyRef.current = true;
        }, 150);
    } else {
        if (!needsRefinement && lazyCacheTimeoutRef.current) {
            clearTimeout(lazyCacheTimeoutRef.current);
            lazyCacheTimeoutRef.current = null;
        }
    }

    /* 10. GLSL 特效 —— 接在整條 2D 管線的最後面。
           把畫布丟進 WebGL 跑完再畫回來，所以上面每一段都完全不用改動；
           預覽與導出走的是同一支函式，兩邊看到的結果一致。
           全部強度都是 0 的話這裡直接跳過，不會有任何額外成本。 */
    if (hasActiveFx(p)) {
      // GLSL-only slider changes do not change this pipeline's input pixels.
      // Retain the upload and highlight convolution at their full resolution.
      const sourceKey=!baking && !needsRefinement ? fxInputKey(p) : undefined;
      const surface=!baking && ctx.canvas===displayCanvasRef.current ? fxSurfaceRef.current : null;
      const painted=applyGlEffects(ctx,w,h,p,sourceKey,surface||undefined);
      if(surface){showFxSurface(!!painted);fxInputKeyRef.current=painted&&sourceKey ? `${w}x${h}|${sourceKey}` : '';if(!painted)applyGlEffects(ctx,w,h,p);}
    }

    if (forceRecalculateEffectsRef.current) {
        forceRecalculateEffectsRef.current = false;
    }
  }, [selectedLutIdx, lutList, activeCategory]);
  useEffect(() => { applyComplexEffectsRef.current = applyComplexEffects; }, [applyComplexEffects]);

  const renderParamsToCanvas = useCallback((p: EditorParams, targetCanvas: HTMLCanvasElement) => {
    const b = buffers.current.preview;
    if (!b.source) return;
    syncGlowSource(b, p);
    p = stripGlow(p);
    
    targetCanvas.width = b.w;
    targetCanvas.height = b.h;
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true })!;
    
    const currentIdx = selectedLutIdx;
    const lut = lutList[currentIdx];
    const activeLut = lut.url ? lutDataRef.current[lut.id] : null;
    const lutSize = activeLut ? activeLut.size : 0;
    
    const len = b.source.length;
    
    // Allocate local buffers for rendering this off-screen step
    const tempDest = new Uint8ClampedArray(len);
    const tempLut0 = new Uint8ClampedArray(len);
    const tempLut100 = activeLut ? new Uint8ClampedArray(len) : null;
    
    /* ── 先試 GPU ─────────────────────────────────────────────────────
       跟預覽同一套：用現有的 processPixels 在 65³ 個格點上算一次烤成查色表，
       GPU 一個 draw call 查完整張圖，然後直接把兩張畫布疊上去。
       完全不把像素讀回來（那一步量過要 61ms）。

       不能走 GPU 的情況跟預覽一致：
         · 銳化 —— 要看鄰居像素，烤不進查色表
         · colorNoise2 —— 它的雜訊遮罩要吃 tempDest 的像素
       任何一步失敗都原封不動走回下面的 CPU 路徑。 */
    if (!p.sharpen && !p.colorNoise2) {
      const srcKey = `${b.w}x${b.h}|${srcIdent()}`;
      if (!exportC0Ref.current) exportC0Ref.current = document.createElement('canvas');
      const ok0 = gpuPaint(exportC0Ref.current, b.source, b.w, b.h,
        { ...p, lutAmount: 0 }, null, 0, 65, srcKey, null);
      let ok = ok0;
      if (ok0 && activeLut) {
        if (!exportC100Ref.current) exportC100Ref.current = document.createElement('canvas');
        ok = gpuPaint(exportC100Ref.current, b.source, b.w, b.h,
          { ...p, lutAmount: 100 }, activeLut.data, lutSize, 65, srcKey, null);
      }
      if (ok) {
        ctx.clearRect(0, 0, b.w, b.h);
        ctx.drawImage(exportC0Ref.current, 0, 0);
        if (activeLut && exportC100Ref.current) {
          ctx.save();
          ctx.globalAlpha = p.lutAmount / 100;
          ctx.drawImage(exportC100Ref.current, 0, 0);
          ctx.restore();
        }
        const scaleG = Math.max(b.w, b.h) / 1080;
        // 這條路沒有 tempDest 的像素，但 colorNoise2 已經被排除，用不到它
        applyComplexEffects(ctx, b.w, b.h, p, scaleG, new Uint8ClampedArray(len), true, false, null);
        return;
      }
    }

    const localBaseCorrectionLut = new Uint8Array(256);
    generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, localBaseCorrectionLut);
    
    // 1. Generate tempLut0 with 0% LUT influence
    processPixels(b.source, tempLut0, b.w, b.h, p, null, 0, localBaseCorrectionLut, b.sharpenDetail, false, getCurveLuts(p.curves), localFor(p, b.source, b.w, b.h, `${b.w}x${b.h}|${srcIdent()}`));
    
    // 2. Generate tempLut100 with 100% LUT influence (if activeLut is present)
    if (activeLut && tempLut100) {
        const p100 = { ...p, lutAmount: 100 };
        processPixels(b.source, tempLut100, b.w, b.h, p100, activeLut.data, lutSize, localBaseCorrectionLut, b.sharpenDetail, false, getCurveLuts(p.curves), localFor(p, b.source, b.w, b.h, `${b.w}x${b.h}|${srcIdent()}`));
    }
    
    // 3. Blend them based on lutAmount
    if (activeLut && tempLut100) {
        const amount = p.lutAmount / 100;
        const invAmount = 1.0 - amount;
        for (let i = 0; i < len; i += 4) {
            tempDest[i]     = tempLut0[i] * invAmount + tempLut100[i] * amount;
            tempDest[i + 1] = tempLut0[i + 1] * invAmount + tempLut100[i + 1] * amount;
            tempDest[i + 2] = tempLut0[i + 2] * invAmount + tempLut100[i + 2] * amount;
            tempDest[i + 3] = tempLut0[i + 3];
        }
    } else {
        tempDest.set(tempLut0);
    }
    
    ctx.putImageData(new ImageData(tempDest, b.w, b.h), 0, 0);
    
    const scale = Math.max(b.w, b.h) / 1080;
    const tempShared = new Uint8ClampedArray(len);
    applyComplexEffects(ctx, b.w, b.h, p, scale, tempShared, true, false, tempDest);
  }, [selectedLutIdx, lutList, applyComplexEffects, getCurveLuts]);

  /* ── 拖曳中的極速預覽：三份全解析度的畫面 ─────────────────────────────
     亮度那一類滑桿拖起來之所以是滿格的，是因為事先把「這根滑桿轉到 0／−100／
     ＋100」三張畫面各算一份，拖曳中就只是在三張之間做 GPU 混合。

     問題是那三份以前是**手指按下去的那一瞬間**才同步算的：全解析度跑三趟
     processPixels，量到手一碰滑桿主執行緒就被佔住 270～303ms（亮度 303、
     曝光 289、對比 270），而且每按一次就來一次。

     改成趁閒置先算好：使用者是先點工具、再去碰滑桿的，中間那段時間畫面
     完全閒著。繪圖迴圈的閒置分支每一輪只算三份裡的一份（約 95ms），
     分三輪做完，按下去的時候通常一步都不用做。
     沒先算完也不會壞 —— setupFastPreview 會把缺的補上，行為跟以前一樣。 */
  const FAST_BLEND_TOOLS = ['brightness', 'exposure', 'contrast', 'highlights', 'shadows', 'temp', 'tint', 'sat', 'vib'];

  /** 已經先算好的那份是「給誰、照什麼參數」算的；stage 是三份裡算到第幾份 */
  const fastWarmRef = useRef<{ sig: string; stage: number }>({ sig: '', stage: 0 });

  /* 那三份是把這根滑桿固定在 0／±100 算出來的，所以「這根滑桿現在是多少」
     完全不影響結果 —— 簽章一律用把它歸零之後的參數，拖曳中才不會一直失效。 */
  const fastSig = useCallback((toolId: string) => {
    const b = buffers.current.preview;
    const pBase = { ...paramsRef.current, [toolId]: 0 } as EditorParams;
    const lut = lutList[selectedLutIdx];
    return `${toolId}|${b.w}x${b.h}|${srcIdent()}|${lut?.id || 'none'}|${pBase.sharpen}|${bakeSigRef.current(pBase)}`;
  }, [lutList, selectedLutIdx]);

  /** 算三份裡的下一份。回傳 true 代表這一次真的有做事（沒事做就回 false）。 */
  const buildFastStage = useCallback((toolId: string): boolean => {
    const b = buffers.current.preview;
    if (!b.source || !b.dest) return false;
    const sig = fastSig(toolId);
    if (fastWarmRef.current.sig !== sig) fastWarmRef.current = { sig, stage: 0 };
    const st = fastWarmRef.current.stage;
    if (st >= 3) return false;

    const len = b.source.length;
    const eb = extremeBuffersRef.current;
    if (!eb.base || eb.base.length !== len) {
      eb.base = new Uint8ClampedArray(len);
      eb.min = new Uint8ClampedArray(len);
      eb.max = new Uint8ClampedArray(len);
    }
    const lut = lutList[selectedLutIdx];
    const activeLut = lut.url ? lutDataRef.current[lut.id] : null;
    const lutSize = activeLut ? activeLut.size : 0;
    const activeLutData = activeLut ? activeLut.data : null;
    const curveLuts = getCurveLuts(paramsRef.current.curves);

    const val = st === 0 ? 0 : st === 1 ? -100 : 100;
    const target = st === 0 ? eb.base! : st === 1 ? eb.min! : eb.max!;
    const pS = { ...paramsRef.current, [toolId]: val } as EditorParams;
    generateBaseCorrectionLut(pS.exposure, pS.contrast, pS.brightness, baseCorrectionLutRef.current);
    processPixels(b.source, target, b.w, b.h, pS, activeLutData, lutSize, baseCorrectionLutRef.current, b.sharpenDetail, false, curveLuts, localFor(pS, b.source, b.w, b.h, `${b.w}x${b.h}|${srcIdent()}`));

    // 同步到對應的離屏畫布（拖曳中是靠它們做 GPU 混合的）
    const cache = fastPreviewCacheRef.current;
    const key = st === 0 ? 'baseCanvas' : st === 1 ? 'minCanvas' : 'maxCanvas';
    if (!cache[key]) cache[key] = document.createElement('canvas');
    const cv = cache[key]!;
    if (cv.width !== b.w || cv.height !== b.h) { cv.width = b.w; cv.height = b.h; }
    cv.getContext('2d')!.putImageData(new ImageData(target, b.w, b.h), 0, 0);

    fastWarmRef.current = { sig, stage: st + 1 };
    if (fastWarmRef.current.stage >= 3) eb.activeToolId = toolId;
    return true;
  }, [fastSig, lutList, selectedLutIdx, getCurveLuts]);

  /** 閒置時呼叫：目前選的工具如果吃這套，就往下算一份 */
  const warmFastPreview = useCallback(() => {
    const t = activeToolIdRef.current;
    if (!FAST_BLEND_TOOLS.includes(t)) return false;
    // With a usable GPU the drag re-bakes the real colour table; the
    // crossfade images would only cost memory and idle time.
    const pb = buffers.current.preview, pp = paramsRef.current;
    if (!pp.sharpen && !pp.colorNoise2 && pb.source && getGpu()?.fits(pb.w, pb.h)) return false;
    return buildFastStage(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildFastStage]);
  const warmFastPreviewRef = useRef(warmFastPreview);
  warmFastPreviewRef.current = warmFastPreview;

  const setupFastPreview = useCallback((toolId: string) => {
    setIsInteracting(true);
    fastPreviewCacheRef.current.active = false;
    isDirtyRef.current = true;
    lastRenderDurationRef.current = 12; // Reset interaction timing to avoid carry-over throttles

    if (!FAST_BLEND_TOOLS.includes(toolId)) return;
    {
      const pb = buffers.current.preview, pp = paramsRef.current;
      if (!pp.sharpen && !pp.colorNoise2 && pb.source && getGpu()?.fits(pb.w, pb.h)) return;
    }

    // 閒置時沒算完的補上（通常已經算完了，這裡一步都不用做）
    let guard = 4;
    while (guard-- > 0 && buildFastStage(toolId)) { /* 一次一份 */ }

    const b = buffers.current.preview;
    if (b.source && b.dest && fastWarmRef.current.stage >= 3) {
      extremeBuffersRef.current.activeToolId = toolId;
      const cache = fastPreviewCacheRef.current;
      if (cache.baseCanvas && cache.minCanvas && cache.maxCanvas) {
        cache.active = true;
        cache.toolId = toolId;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildFastStage]);

  paintOverlayOnlyRef.current = (p: EditorParams) => {
    const ovEl = maskOverlayCanvasRef.current, b = buffers.current.preview;
    if (!ovEl || !b || !b.w || !b.h) return false;
    const { list, active } = maskList(p);
    const act = list[active];
    if (activeCategory !== 'mask' || !p.maskShowOverlay || !act?.maskCreated) { ovEl.style.display = 'none'; return true; }
    const w = b.w, h = b.h, alphaC = maskAlphaCanvasRef.current;
    if (!alphaC || alphaC.width !== w || alphaC.height !== h) return false;
    let baseCopy: HTMLCanvasElement | null = null, baseKey = '';
    if (list.some(m => m.maskCreated && (m.maskType === 'color' || m.maskType === 'luma'))) {
      baseCopy = maskBaseCopyRef.current;
      if (!baseCopy || baseCopy.width !== w || baseCopy.height !== h) return false;
      baseKey = `${w}x${h}|${srcIdent()}|${selectedLutIdx}|${JSON.stringify(Object.entries(p).filter(([k]) => !k.startsWith('mask')))}`;
    }
    maskAlpha(alphaC, maskCacheId(act), act, w, h, baseCopy, baseKey, false);
    if (ovEl.width !== w || ovEl.height !== h) { ovEl.width = w; ovEl.height = h; }
    const og = ovEl.getContext('2d')!;
    og.globalCompositeOperation = 'copy'; og.fillStyle = 'rgba(220,38,38,0.5)'; og.fillRect(0, 0, w, h);
    og.globalCompositeOperation = 'destination-in'; og.drawImage(alphaC, 0, 0);
    og.globalCompositeOperation = 'source-over';
    ovEl.style.display = 'block';
    return true;
  };
  const render = useCallback((p: EditorParams, overrideLutIdx?: number) => {
    if (p.sharpen > 0) for (const bb of [buffers.current.preview, buffers.current.fast]) {
      const base = bb.original || bb.source;
      if (base && !bb.sharpenDetail) bb.sharpenDetail = precomputeSharpenDetail(base, bb.w, bb.h);
    }
    /* 選中的濾鏡還在下載：先不畫，畫面留在上一張。不然會先閃一張「沒有濾鏡」的，
       載好才變成有濾鏡的（loadLut 載好會再標記重畫）。 */
    { const l = lutList[overrideLutIdx ?? selectedLutIdx];
      if (l?.url && !lutDataRef.current[l.id] && LUT_IN_FLIGHT.has(l.id)) return; }
    lastFullRenderParamsRef.current = p;
    const activeToolId = activeToolIdRef.current;
    const cache = fastPreviewCacheRef.current;

    // The extreme-blend proxy canvases are built at full preview resolution, so that path
    // must keep using the preview buffer. Everything else drops to the low-res proxy while
    // the user drags and snaps back to full resolution on release.
    const FAST_BLEND_TOOLS = ['brightness', 'exposure', 'contrast', 'highlights', 'shadows', 'temp', 'tint', 'sat', 'vib'];
    /* The three-image crossfade is only a stand-in for devices without a
       usable GPU. Exposure, white balance and the tone curve are non-linear,
       so "halfway between 0 and +100" is not what +50 looks like. With the
       GPU path the colour table is re-baked every frame (33³, ~2ms), so the
       drag shows exactly what release will show. */
    const pb = buffers.current.preview;
    const gpuLiveColour = !p.sharpen && !p.colorNoise2 && !!pb.source && !!getGpu()?.fits(pb.w, pb.h);
    const isFastBlendActive = isInteracting && !gpuLiveColour && !hasGlow(p) &&
        extremeBuffersRef.current.activeToolId === activeToolId &&
        FAST_BLEND_TOOLS.includes(activeToolId) &&
        cache.active && cache.toolId === activeToolId &&
        !!(cache.baseCanvas && cache.minCanvas && cache.maxCanvas);

    const proxy = buffers.current.fast;
    /* 拖曳「新特效」的參數時不要降到低解析度代理。
       代理只有 ≤900px，GLSL 特效在上面算出來的結果跟全解析度本來就不一樣
       （取樣到的細節不同），這是拖曳中與鬆手看起來不一樣的最後一個來源。
       這些參數不會改到像素管線，所以 processPixels 本來就會被跳過，
       留在全解析度只多花一次 applyComplexEffects + 一次 GPU pass，划得來。 */
    /* 拖特效滑桿時盡量用全解析度算 —— 低解析度代理取樣到的細節不一樣，
       換句話說「拖曳中」與「鬆手」會長得不一樣，那是使用者反應過的問題。

       但全解析度不是免費的：照片一大，一次就要幾十甚至幾百毫秒，
       拖起來會嚴重掉格（量到 3000×4000 的照片拖銳化 p95 269ms）。
       所以照實際算出來的耗時自己切換，並且留一段遲滯避免在兩種模式之間來回跳：
         － 一次超過 60ms 就降級用代理（保順暢）
         － 回到 24ms 以下才升回全解析度（保一致）
       門檻抓在 60ms：這之內畫面更新雖然不到 60fps，但迴圈本來就會照耗時節流、
       滑桿本身還是順的；真正會讓整個介面一頓一頓的是那種一次兩三百毫秒的。
       小圖／快的裝置會一直待在全解析度，也就完全沒有落差。 */
    /* 「拖曳中」與「鬆手」不一樣的根本原因：拖的時候畫的是 ≤900px 的代理，
       鬆手畫的是全解析度。凡是會看鄰居像素的運算（銳化、模糊、顆粒、暈影、
       清晰度…）在兩種解析度上算出來就是不一樣，所以一放手畫面就跳一下。

       以前只有「新特效」那幾個工具會嘗試留在全解析度。現在改成**所有工具都先
       試著用全解析度**，只有真的算不動才降級，而且留一段遲滯避免來回跳：
         · 一次超過 60ms → 降到代理（保順暢）
         · 回到 24ms 以下 → 升回全解析度（保一致）
       在手機上拍的一般照片、以及大多數裝置上，這代表拖曳中畫的就是鬆手那一張，
       完全沒有落差；只有又大又慢的情況才會暫時降級。 */
    /* 拖曳中**一律用全解析度**，低解析度代理已經完全不用了。
       以前這裡有一段「算太慢就降級成 ≤900px 的代理、快了再升回來」的自動調節，
       但那正是主人說的「拖動滑桿時圖片會變低像素的感覺」——
       只要有一幀超過 60ms 就會掉下去，掉下去的那段時間畫面就是糊的。
       主人明確說過寧可慢一點也不要畫質降級，而且顏色鏈已經交給 GPU
       （烤表 2.2ms ＋ 畫 0.1ms），全解析度本來就跑得動。 */
    /* 剛換濾鏡時先用低解析度那份畫一張（運算量只有 1/4，按下去馬上看得到），
       同一拍再標記 dirty，下一幀用全解析度重畫蓋上去 —— 最終畫質沒有妥協。 */
    /* 有發光時不走低解析度那張（那張沒有對應的發光），直接全解析度 ——
       旗標也在這裡收掉，不能留到之後（例如合併完沒有發光了）才突然觸發。 */
    if (quickFilterRef.current && hasGlow(p)) quickFilterRef.current = false;
    /* 旗標一定在點完濾鏡後的這一次就收掉：留著的話，下一次（常常是點特效）會先畫一張
       低解析度的再換全解析度，疊了特效時看起來就是閃一下。有特效時也不走低解析度那張。 */
    const quickPass = quickFilterRef.current && !!proxy.source && !isInteracting && !hasLiveEffect(p);
    quickFilterRef.current = false;
    const useProxy = quickPass;
    const b = useProxy ? proxy : buffers.current.preview;

    const cvs = displayCanvasRef.current;
    if (!b.source || !b.dest || !cvs) return;
    
    if (cvs.width !== b.w || cvs.height !== b.h) { 
        cvs.width = b.w; 
        cvs.height = b.h; 
    }
    
    const ctx = cvs.getContext('2d')!;
    /* 發光類特效在原圖上算（見 syncGlowSource）。拖曳中而且有 GPU 表面時，
       發光參數變了交給下面的 GPU 直通路線（不讀回像素）；其他情況先在這裡對齊。 */
    const glowPending = glowSig(p) ? `${b.w}x${b.h}|${srcIdOf(buffersSrcRef.current)}|${glowSig(p)}` !== (b.glowKey || '') : !!b.glowKey;
    if (!(isInteracting && glowPending && getSurfaceGpu())) syncGlowSource(b, p);
    const glowStale = glowPending && b.glowKey !== (glowSig(p) ? `${b.w}x${b.h}|${srcIdOf(buffersSrcRef.current)}|${glowSig(p)}` : '');
    const pPost0 = stripGlow(p);
    const legacy=legacyPreviewRef.current;
    if(!glowStale&&!showOriginalRef.current&&!forceRecalculateEffectsRef.current&&!displayStaleRef.current&&legacy&&legacy.key===legacyInputKey(pPost0,b.w,b.h,legacy.kind)){
      const on=legacy.kind==='soft'?pPost0.soft>0:legacy.kind==='halation'?pPost0.fringeIntensity>0:legacy.kind==='leak'?pPost0.leakOpacity>0
        :legacy.kind==='blur'?pPost0.blur>0&&legacyGpuKind(pPost0)==='blur':legacyGpuKind(pPost0)==='simple';
      const painted=on&&fxSurfaceRef.current?renderLegacy(legacyLayer(legacy.kind,fxSurfaceRef.current),legacy.kind,ctx,b.w,b.h,legacy.key,pPost0,colourBinsFor(pPost0)):null;
      if(painted){showFxSurface(true);return;}
    }
    legacyPreviewRef.current=null;
    const fastKey=`${b.w}x${b.h}|${fxInputKey(pPost0)}`;
    if(!glowStale && !showOriginalRef.current && hasActiveFx(pPost0) && fxInputKeyRef.current===fastKey && fxSurfaceRef.current){
      if(applyGlEffects(ctx,b.w,b.h,pPost0,fxInputKey(pPost0),fxSurfaceRef.current)){showFxSurface(true);return;}
    }
    showFxSurface(false);fxInputKeyRef.current='';

    // Maintain offscreen pixel buffer canvas for putImageData with willReadFrequently
    if (!pixelBufferCanvasRef.current) {
        pixelBufferCanvasRef.current = document.createElement('canvas');
    }
    const pixelBufferCanvas = pixelBufferCanvasRef.current;
    if (pixelBufferCanvas.width !== b.w || pixelBufferCanvas.height !== b.h) {
        pixelBufferCanvas.width = b.w;
        pixelBufferCanvas.height = b.h;
    }
    const pixelBufferCtx = pixelBufferCanvas.getContext('2d', { willReadFrequently: true })!;

    const currentIdx = overrideLutIdx !== undefined ? overrideLutIdx : selectedLutIdx;
    const pRender = { ...p };
    /** 顏色之後要套的特效：發光類已經混在 b.source（或 GPU 那張貼圖）裡了 */
    const pPost = stripGlow(pRender);

    // Check if we are at effectively original state (No edits)
    const isNoEdits = currentIdx === 0 && 
        pRender.brightness === 0 && pRender.exposure === 0 && pRender.contrast === 0 && 
        pRender.highlights === 0 && pRender.shadows === 0 && !pRender.whites && !pRender.blacks && pRender.temp === 0 && pRender.tint === 0 && 
        pRender.sat === 0 && pRender.vib === 0 && pRender.sharpen === 0 && 
        pRender.grain === 0 && pRender.soft === 0 && pRender.blur === 0 && pRender.colorNoise === 0 && 
        pRender.colorNoise2 === 0 && pRender.vignette === 0 && pRender.leakOpacity === 0 && 
        pRender.fringeIntensity === 0 &&
        // 新的 GLSL 特效也算「有編輯」，不然只開這些的時候會被當成沒動過而畫回原圖
        !hasActiveFx(pRender) &&
        !anyMask(pRender) &&
        Object.values(pRender.curves).every(isIdentityCurve) &&
        isHslIdentity(pRender.hsl) && isGradeIdentity(pRender.grade);

    /* 拖到 0（整張回到原圖）時不要在拖曳中改走 2D：那一格要把整張原圖寫進 2D 再上傳一次，
       正是「拖到最邊邊就卡一下」的那一下。拖曳中照樣走下面的 GPU 直通（同一張原圖）。 */
    const noEditsOnGpu = isNoEdits && isInteracting && !isFastBlendActive && !showOriginalRef.current && !!fxSurfaceRef.current && !!b.source && !!getSurfaceGpu();
    if (showOriginalRef.current || (isNoEdits && !noEditsOnGpu)) {
        /* 這張已經合併過了 —— 緩衝區裡的「原圖」其實是合併後的結果，
           所以前後對比要改畫一開始留下來的那張才是真的原圖。
           裁切過的話兩者比例會不一樣，等比縮到畫面內、其餘留黑。 */
        const pristine = showOriginalRef.current && thumbOriginRef.current[buffersSrcRef.current]
          ? pristineOf(thumbSrcOf(buffersSrcRef.current)) : null;
        if (pristine) {
            ctx.save();
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, b.w, b.h);
            const r = Math.min(b.w / pristine.width, b.h / pristine.height);
            const dw = pristine.width * r, dh = pristine.height * r;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(pristine, (b.w - dw) / 2, (b.h - dh) / 2, dw, dh);
            ctx.restore();
        } else {
            pixelBufferCtx.putImageData(new ImageData(b.original || b.source, b.w, b.h), 0, 0);
            ctx.drawImage(pixelBufferCanvas, 0, 0);
        }
        cvs.style.filter = 'none';
        presentEditorSource(ctx,b.w,b.h);
        return;
    }

    const lut = lutList[currentIdx];
    const activeLut = lut.url ? lutDataRef.current[lut.id] : null;
    const lutSize = activeLut ? activeLut.size : 0;
    /* 點濾鏡／特效按鈕：跟拖滑桿一樣先走 GPU 直出，按下去那一格就看到結果。
       CPU 那條（整張讀回、逐像素算）在換了來源（合併後）快取全空時要將近一秒。
       GPU 出來的像素跟 CPU 那條一樣（同一套著色器、同樣 8 位元），所以這張就是最終結果，
       不再背景補算（補算那將近一秒會卡住下一次點擊）。2D 緩衝標成過期
       （displayStaleRef），之後真的需要走 2D 的那一次自己會重算。 */
    /* 手放開之後的一般重畫也一樣走 GPU 直出（像素跟 CPU 那條相同）：
       CPU 那條要整張讀回、逐像素算，換了來源（合併後）快取全空時更要將近一秒。
       只有遮色片（要畫編輯用的遮罩）與烘焙輸出時才走原本那條。 */
    const tapFast = tapFastRef.current || (!anyMask(pRender) && !showOriginalRef.current);
    tapFastRef.current = false;

    /* ── Direct GPU path while dragging ─────────────────────────────────
       When nothing after the colour stage draws on the 2D canvas (no grain,
       blur, soft light, leak, halation, vignette or gradient mask), the
       colour result is a GPU image that goes straight to the on-screen GPU
       surface — through the GLSL effects if any are on. This removes the
       two or three full-resolution canvas-to-canvas copies per frame
       (WebGL → 2D → 2D → WebGL) that a phone pays for on every slider step.
       The pixels are the same 8-bit values the normal path produces; after
       release one normal render brings the 2D buffers up to date. */
    if ((isInteracting || tapFast) && !isFastBlendActive && fxSurfaceRef.current && b.source && !pRender.sharpen && !pRender.colorNoise2 && !uses2dEffects(pPost)) {
        const srcKey = `${b.w}x${b.h}|${srcIdent()}`;
        const spill = !!pPost.fxExposureSpill;
        const filmKey = activeLut ? `${lut.id}#${lutSize}` : '';
        /* Colour stage in the surface's own context: the effects read its
           texture, nothing crosses between GPU contexts, nothing is read
           back (Lo-fi's halo mask is computed on the GPU too). */
        const image = gpuFinalImage(pRender, activeLut ? activeLut.data : null, lutSize, filmKey, srcKey, b);
        if (image) {
            const surface = fxSurfaceRef.current;
            const imageKey = `${srcKey}|${colourKeyOf(pRender)}|${activeLut ? pRender.lutAmount : 0}|${filmKey}|${glowSig(pRender)}`;
            const shown = hasActiveFx(pPost)
                ? !!applyGlEffects(ctx, b.w, b.h, pPost, imageKey, surface, false, undefined, undefined, { image })
                : presentFxSource(ctx, b.w, b.h, surface, image);
            if (shown) { showFxSurface(true); displayStaleRef.current = true; cvs.style.filter = 'none'; return; }
        }
        syncGlowSource(b, pRender);
        const out = gpuFinal(pRender, activeLut ? activeLut.data : null, lutSize, filmKey, `${b.w}x${b.h}|${srcIdent()}`, b);
        if (out) {
            const bins = spill ? (() => { const sm = getGpu()?.readSmall(); if (!sm) return null; const d = new Uint8ClampedArray(sm.data); for (let i = 3; i < d.length; i += 4) d[i] = 255; return highlightHistogram(d); })() : null;
            const surface = fxSurfaceRef.current;
            const shown = hasActiveFx(pPost)
                ? !!applyGlEffects(ctx, b.w, b.h, pPost, undefined, surface, false, undefined, undefined, { canvas: out, bins })
                : presentFxSource(ctx, b.w, b.h, surface, out);
            if (shown) { showFxSurface(true); displayStaleRef.current = true; cvs.style.filter = 'none'; return; }
        }
    }
    /* Same while dragging with 2D effects on: the colour result reaches the
       2D canvas in one copy (instead of two full-size intermediate canvases),
       then the effects run as usual. */
    if ((isInteracting || tapFast) && !isFastBlendActive && b.source && !pRender.sharpen && !pRender.colorNoise2 && uses2dEffects(pPost)) {
        const srcKey = `${b.w}x${b.h}|${srcIdent()}`;
        const filmKey = activeLut ? `${lut.id}#${lutSize}` : '';
        /* Only soft light, halation or light leak on: its GPU layer presents
           on the effect surface. With the colour stage in that same context
           it takes the colour result as a texture — no copy, no readback. */
        const p0 = pPost, kind = legacyGpuKind(p0);
        if (kind && fxSurfaceRef.current) {
            const image = gpuFinalImage(pRender, activeLut ? activeLut.data : null, lutSize, filmKey, srcKey, b);
            if (image) {
                const layer = legacyLayer(kind, fxSurfaceRef.current);
                const key = legacyInputKey(p0, b.w, b.h, kind);
                layer.sourceImage = image;
                let painted: HTMLCanvasElement | null = null;
                try { painted = renderLegacy(layer, kind, ctx, b.w, b.h, key, p0, null); } finally { layer.sourceImage = null; }
                if (painted) { legacyPreviewRef.current = { kind, key }; showFxSurface(true); displayStaleRef.current = true; cvs.style.filter = 'none'; return; }
            }
        }
        syncGlowSource(b, pRender);
        const out = gpuFinal(pRender, activeLut ? activeLut.data : null, lutSize, filmKey, `${b.w}x${b.h}|${srcIdent()}`, b);
        if (out) {
            if (pPost.soft > 0 || pPost.fxExposureSpill) {
                const sm = getGpu()?.readSmall();
                if (sm) {
                    const d = new Uint8ClampedArray(sm.data); for (let i = 3; i < d.length; i += 4) d[i] = 255;
                    const a = activeLut ? pRender.lutAmount / 100 : 0;
                    colourBinsRef.current = { key: `${colourKeyOf(pRender)}|${a}`, bins: highlightHistogram(d) };
                }
            }
            /* Fallback when the surface has no WebGL2 colour stage: the layer
               reads the colour GPU's canvas and presents on the GPU surface —
               the 2D canvas is not touched at all. */
            if (kind && fxSurfaceRef.current) {
                const layer = legacyLayer(kind, fxSurfaceRef.current);
                const key = legacyInputKey(p0, b.w, b.h, kind);
                layer.sourceOverride = out;
                let painted: HTMLCanvasElement | null = null;
                try { painted = renderLegacy(layer, kind, ctx, b.w, b.h, key, p0, colourBinsFor(p0)); } finally { layer.sourceOverride = null; }
                if (painted) { legacyPreviewRef.current = { kind, key }; showFxSurface(true); displayStaleRef.current = true; cvs.style.filter = 'none'; return; }
            }
            ctx.globalCompositeOperation = 'copy'; ctx.drawImage(out, 0, 0); ctx.globalCompositeOperation = 'source-over';
            cvs.style.filter = 'none';
            displayStaleRef.current = true;
            applyComplexEffects(ctx, b.w, b.h, pPost, Math.max(b.w, b.h) / 1080, b.shared, isInteracting, false, b.dest);
            if (!fxSurfaceShownRef.current) presentEditorSource(ctx, b.w, b.h);
            return;
        }
    }

    // 一般路線：顏色那一段吃的是「原圖＋光」（放手後在這裡從 GPU 那張讀回一次）
    syncGlowSource(b, pRender);
    if (isFastBlendActive) {
        // Fast proxy GPU-accelerated blending: handled entirely on the GPU in the drawing step below for maximum FPS.
    } else {
        // Zero-cost sub-microsecond check: Separate pixel processing params from composite effects
        const lastP = lastProcessedParamsRef.current;
        let shouldReprocessPixels =
            pRender.brightness !== lastP.brightness ||
            pRender.exposure !== lastP.exposure ||
            pRender.contrast !== lastP.contrast ||
            pRender.highlights !== lastP.highlights ||
            pRender.shadows !== lastP.shadows ||
            (pRender.whites || 0) !== (lastP.whites || 0) ||
            (pRender.blacks || 0) !== (lastP.blacks || 0) ||
            pRender.temp !== lastP.temp ||
            pRender.tint !== lastP.tint ||
            pRender.sat !== lastP.sat ||
            pRender.vib !== lastP.vib ||
            pRender.sharpen !== lastP.sharpen ||
            currentIdx !== lastP.selectedLutIdx ||
            b.w !== lastP.bufferWidth ||
            lutSize !== lastP.lutSize ||
            pRender.curves !== lastP.curvesRef ||
            pRender.hsl !== lastP.hslRef ||
            pRender.grade !== (lastP as any).gradeRef ||
            displayStaleRef.current;
        displayStaleRef.current = false;

        /* ── 先試 GPU ─────────────────────────────────────────────────
           成功的話兩張離屏畫布（lut0／lut100）就已經畫好，
           下面兩次全解析度的 processPixels 完全不必跑。
           銳化要看鄰居像素、不是純 RGB→RGB，烤不進查色表，所以有銳化就走 CPU。
           拖曳中用 33³ 的表（烤 2.2ms），手放開改用 65³（色差 3 色階以內）。 */
        /* ── GPU 顏色鏈 ──────────────────────────────────────────────────
           **完全不把像素從 GPU 讀回來**（量過：讀回要 61ms，比整條 CPU 管線還貴）。
           那份像素其實只有一個地方要：colorNoise2 的雜訊遮罩。
           所以只要沒開那個特效，就整條走 GPU，畫面直接貼 GPU 畫布。

           不能走 GPU 的兩種情況：
             · 銳化 —— 要看鄰居像素，不是純 RGB→RGB，烤不進查色表
             · colorNoise2 —— 它需要 b.dest 的像素
           兩者都自動退回原本的 CPU 路徑，畫面與匯出完全照舊。

           格點：拖曳中 33³（烤 2.2ms），其餘 65³（烤 16ms、色差 3 色階以內）。 */
        /* 這裡本來還有一套「先各量一次 CPU 與 GPU、慢就不用 GPU」的校準。
           拿掉了，因為它跟 LutGpu.create() 裡的「軟體模擬 GL 直接不給用」是
           同一件事的兩種做法，而校準那套有兩個實際的壞處：
             · 只憑一次取樣就下永久判斷，遇到剛好被別的工作卡住的那一幀就會誤判
             · 一旦判成「不用 GPU」，整個工作階段都回不去，真手機也被關掉
           軟體 GL 的情況已經在建立時就擋掉了，這裡不需要再猜一次。 */
        const gpuAllowedNow = true;
        const gpuEligible = !pRender.sharpen && !pRender.colorNoise2 && !!b.source && gpuAllowedNow;
        /* 只有「上一輪走 GPU、這一輪要走 CPU」時才強制重算 ——
           因為 GPU 那輪沒有產生 b.dest 的像素，CPU 這輪得補上。
           反過來（CPU→GPU，也就是手指剛按上滑桿的那一刻）畫布內容本來就是對的，
           強制重畫一次只會在拖曳第一幀多壓一次全解析度運算，看起來就是抖一下。 */
        if (lastGpuRef.current && !gpuEligible) shouldReprocessPixels = true;
        let gpuDone = false;
        if (shouldReprocessPixels && gpuEligible) {
            const tGpu = performance.now();
            const grid = isInteracting ? 33 : 65;
            const srcKey = `${b.w}x${b.h}|${srcIdent()}`;
            if (!lut0CanvasRef.current) lut0CanvasRef.current = document.createElement('canvas');
            /* 調節那一份完全不看濾鏡，所以濾鏡鍵固定是 'none' ——
               換濾鏡時這張表就會直接命中快取，一次都不用重烤。 */
            const okBase = gpuPaint(lut0CanvasRef.current, b.source, b.w, b.h,
                { ...pRender, lutAmount: 0 }, null, 0, grid, srcKey, null, 'none');
            // Soft light needs the colour result's luminance histogram: read a
            // 128px copy from the colour GPU itself (no 2D canvas readback).
            const wantBins = pRender.soft > 0;
            const small0 = okBase && wantBins ? getGpu()?.readSmall() ?? null : null;
            let small100: { data: Uint8Array } | null = null;
            if (okBase && activeLut) {
                if (!lut100CanvasRef.current) lut100CanvasRef.current = document.createElement('canvas');
                gpuDone = gpuPaint(lut100CanvasRef.current, b.source, b.w, b.h,
                    { ...pRender, lutAmount: 100 }, activeLut.data, lutSize, grid, srcKey, null,
                    `${lut.id}#${lutSize}`);
                if (gpuDone && wantBins) small100 = getGpu()?.readSmall() ?? null;
            } else {
                gpuDone = okBase;
            }
            if (gpuDone && small0) colourSampleRef.current = { key: colourKeyOf(pRender), d0: small0.data, d1: activeLut ? small100?.data ?? null : null };
            if (gpuDone && !isInteracting) {
                gpuMsRef.current = performance.now() - tGpu;
                /* 兩邊都量到了就下判斷。留 1.2 倍的餘裕：
                   差不多快的時候寧可用 GPU，因為它不佔主執行緒、介面比較不會頓。 */
                if (cpuMsRef.current > 0 && gpuWinsRef.current === null) {
                    gpuWinsRef.current = gpuMsRef.current < cpuMsRef.current * 1.2;
                }
            }
        }

        lastGpuRef.current = gpuDone;
        if (shouldReprocessPixels) {
            const cached = gpuDone ? null : getCachedFilterPixels(lut.id, pRender, b.w, b.h);
            if (cached && (activeLut ? cached.lut100 !== null : true)) {
                // 命中的也算「最近用過」，不要被當成最舊的踢掉
                const hitKey = cacheKeyOf(lut.id, b.w);
                const ord = cacheOrderRef.current;
                const hi = ord.indexOf(hitKey);
                if (hi >= 0) { ord.splice(hi, 1); ord.push(hitKey); }
                b.lut0!.set(cached.lut0);
                cpuColourKeyRef.current = colourKeyOf(pRender);
                if (activeLut && b.lut100 && cached.lut100) {
                    b.lut100.set(cached.lut100);
                }
                
                lastProcessedParamsRef.current = {
                    brightness: pRender.brightness,
                    exposure: pRender.exposure,
                    contrast: pRender.contrast,
                    highlights: pRender.highlights,
                    shadows: pRender.shadows,
                    whites: pRender.whites, blacks: pRender.blacks,
                    temp: pRender.temp,
                    tint: pRender.tint,
                    sat: pRender.sat,
                    vib: pRender.vib,
                    sharpen: pRender.sharpen,
                    lutAmount: pRender.lutAmount,
                    selectedLutIdx: currentIdx,
                    bufferWidth: b.w,
                    lutSize: lutSize,
                    curvesRef: pRender.curves,
                    hslRef: pRender.hsl, gradeRef: pRender.grade
                };
            } else if (gpuDone) {
                /* GPU 畫好了畫面，但沒有產生 b.lut0／b.lut100 的像素 ——
                   本來就不需要（沒有人要那份像素，見上面的說明）。
                   把這一輪的參數記下來，靜止的畫面才不會每幀重畫一次。 */
                lastProcessedParamsRef.current = {
                    brightness: pRender.brightness, exposure: pRender.exposure,
                    contrast: pRender.contrast, highlights: pRender.highlights,
                    whites: pRender.whites, blacks: pRender.blacks,
                    shadows: pRender.shadows, temp: pRender.temp, tint: pRender.tint,
                    sat: pRender.sat, vib: pRender.vib, sharpen: pRender.sharpen,
                    lutAmount: pRender.lutAmount, selectedLutIdx: currentIdx,
                    bufferWidth: b.w, lutSize: lutSize,
                    curvesRef: pRender.curves, hslRef: pRender.hsl, gradeRef: pRender.grade,
                };
            } else {
                const tCpu = performance.now();
                generateBaseCorrectionLut(pRender.exposure, pRender.contrast, pRender.brightness, baseCorrectionLutRef.current);
                
                /* b.lut0＝「只有調節、完全沒有濾鏡」的那一份，跟選哪一顆濾鏡無關。
                   只換濾鏡時整份沿用 —— 原本每點一次濾鏡都連它一起重算，
                   等於白跑一趟全解析度的像素運算（等待時間有一半在這裡）。 */
                const l0 = lut0StateRef.current[b.w] || {};
                const canReuseLut0 =
                    l0.buf === b.lut0 &&
                    l0.w === b.w && l0.h === b.h && l0.src === buffersSrcRef.current &&
                    l0.brightness === pRender.brightness && l0.exposure === pRender.exposure &&
                    l0.contrast === pRender.contrast && l0.highlights === pRender.highlights &&
                    l0.shadows === pRender.shadows && l0.temp === pRender.temp &&
                    l0.whites === pRender.whites && l0.blacks === pRender.blacks &&
                    l0.tint === pRender.tint && l0.sat === pRender.sat &&
                    l0.vib === pRender.vib && l0.sharpen === pRender.sharpen &&
                    l0.curves === pRender.curves && l0.hsl === pRender.hsl && l0.grade === pRender.grade &&
                    l0.detail === b.sharpenDetail;
                if (!canReuseLut0) {
                    processPixels(b.source, b.lut0!, b.w, b.h, pRender, null, 0, baseCorrectionLutRef.current, b.sharpenDetail, false, getCurveLuts(pRender.curves), localFor(pRender, b.source, b.w, b.h, `${b.w}x${b.h}|${srcIdent()}`));
                    lut0StateRef.current[b.w] = {
                        buf: b.lut0,
                        w: b.w, h: b.h, src: buffersSrcRef.current,
                        brightness: pRender.brightness, exposure: pRender.exposure, contrast: pRender.contrast,
                        highlights: pRender.highlights, shadows: pRender.shadows, temp: pRender.temp,
                        whites: pRender.whites, blacks: pRender.blacks,
                        tint: pRender.tint, sat: pRender.sat, vib: pRender.vib, sharpen: pRender.sharpen,
                        curves: pRender.curves, hsl: pRender.hsl, grade: pRender.grade, detail: b.sharpenDetail,
                    };
                }
                
                // 2. Generate b.lut100: Base adjustments applied with 100% LUT influence (if activeLut is present)
                if (activeLut) {
                    const p100 = { ...pRender, lutAmount: 100 };
                    processPixels(b.source, b.lut100!, b.w, b.h, p100, activeLut.data, lutSize, baseCorrectionLutRef.current, b.sharpenDetail, false, getCurveLuts(pRender.curves), localFor(p100, b.source, b.w, b.h, `${b.w}x${b.h}|${srcIdent()}`));
                }
                
                cpuColourKeyRef.current = colourKeyOf(pRender);
                if (!isInteracting) cpuMsRef.current = performance.now() - tCpu;
                if (!lut.url || activeLut) {
                    cacheFilterPixels(lut.id, pRender, b.w, b.h, b.lut0!, activeLut ? b.lut100! : null);
                }
                
                // Cache the processed parameters with zero allocations
                lastProcessedParamsRef.current = {
                    brightness: pRender.brightness,
                    exposure: pRender.exposure,
                    contrast: pRender.contrast,
                    highlights: pRender.highlights,
                    shadows: pRender.shadows,
                    whites: pRender.whites, blacks: pRender.blacks,
                    temp: pRender.temp,
                    tint: pRender.tint,
                    sat: pRender.sat,
                    vib: pRender.vib,
                    sharpen: pRender.sharpen,
                    lutAmount: pRender.lutAmount,
                    selectedLutIdx: currentIdx,
                    bufferWidth: b.w,
                    lutSize: lutSize,
                    curvesRef: pRender.curves,
                    hslRef: pRender.hsl, gradeRef: pRender.grade
                };
            }

            // Sync with GPU-backed offscreen canvases for instant rendering during slider adjustments
            if (!lut0CanvasRef.current) {
                lut0CanvasRef.current = document.createElement('canvas');
            }
            if (!gpuDone) {
              if (lut0CanvasRef.current.width !== b.w || lut0CanvasRef.current.height !== b.h) {
                  lut0CanvasRef.current.width = b.w;
                  lut0CanvasRef.current.height = b.h;
              }
              lut0CanvasRef.current.getContext('2d')!.putImageData(new ImageData(b.lut0!, b.w, b.h), 0, 0);
            }

            if (activeLut) {
                if (!lut100CanvasRef.current) {
                    lut100CanvasRef.current = document.createElement('canvas');
                }
                if (!gpuDone) {
                  if (lut100CanvasRef.current.width !== b.w || lut100CanvasRef.current.height !== b.h) {
                      lut100CanvasRef.current.width = b.w;
                      lut100CanvasRef.current.height = b.h;
                  }
                  lut100CanvasRef.current.getContext('2d')!.putImageData(new ImageData(b.lut100!, b.w, b.h), 0, 0);
                }
            }
        }

        // Perform linear blending between b.lut0 and b.lut100 on the CPU ONLY when idle
        // to keep b.dest 100% accurate without any UI overhead during drag
        if (!isInteracting && !gpuDone) {
            if (activeLut) {
                const len = b.source.length;
                const amount = pRender.lutAmount / 100;
                const invAmount = 1.0 - amount;
                
                const lut0 = b.lut0!;
                const lut100 = b.lut100!;
                const dest = b.dest!;
                
                for (let i = 0; i < len; i += 4) {
                    dest[i]     = lut0[i] * invAmount + lut100[i] * amount;
                    dest[i + 1] = lut0[i + 1] * invAmount + lut100[i + 1] * amount;
                    dest[i + 2] = lut0[i + 2] * invAmount + lut100[i + 2] * amount;
                    dest[i + 3] = lut0[i + 3];
                }
            } else {
                b.dest!.set(b.lut0!);
            }
        }
    }
    
    // Always put valid pixels to canvas before applying effects.
    // If we are in interactive adjustment blend mode, blend the pre-calculated offscreen canvases on the GPU for 120 FPS.
    // If we are adjusting filter strength (or anything else), draw the GPU-accelerated canvases for 120fps.
    if (isFastBlendActive) {
        const val = pRender[activeToolId as keyof EditorParams] as number;
        const amount = val / 100;
        
        ctx.drawImage(cache.baseCanvas!, 0, 0);
        
        if (val > 0) {
            ctx.save();
            ctx.globalAlpha = amount;
            ctx.drawImage(cache.maxCanvas!, 0, 0);
            ctx.restore();
        } else if (val < 0) {
            ctx.save();
            ctx.globalAlpha = -amount;
            ctx.drawImage(cache.minCanvas!, 0, 0);
            ctx.restore();
        }
    } else {
        if (lut0CanvasRef.current) {
            ctx.drawImage(lut0CanvasRef.current, 0, 0);
        } else {
            pixelBufferCtx.putImageData(new ImageData(b.lut0!, b.w, b.h), 0, 0);
            ctx.drawImage(pixelBufferCanvas, 0, 0);
        }

        if (activeLut && lut100CanvasRef.current) {
            ctx.save();
            ctx.globalAlpha = pRender.lutAmount / 100;
            ctx.drawImage(lut100CanvasRef.current, 0, 0);
            ctx.restore();
        }
    }
    cvs.style.filter = 'none';
    
    const scale = Math.max(b.w, b.h) / 1080;
    // Pass b.dest as sourcePixelData for noise masking
    applyComplexEffects(ctx, b.w, b.h, pPost, scale, b.shared, isInteracting, false, b.dest);
    if(!fxSurfaceShownRef.current&&!maskLiveRef.current)presentEditorSource(ctx,b.w,b.h);

    if (quickPass) {
      isDirtyRef.current = true;          // 接著馬上排一次全解析度的
      lastRenderTimeRef.current = 0;
    }

  }, [isInteracting, selectedLutIdx, lutList, applyComplexEffects, getCurveLuts]);

  useEffect(() => {
    /* 合併／撤銷合併也是換來源（烤好的那張變成新的原圖），但那不是「換照片」：
       參數、歷史、分頁都由那邊自己安排好了，這裡只要把緩衝區換成新的那張。
       走完整的歸零反而會把剛排好的東西洗掉，畫面也會閃一下。 */
    if (srcSwapRef.current) {
      srcSwapRef.current = false;
      if (preinstalledSrcRef.current === activeSrc) { preinstalledSrcRef.current = null; return; }
      const ready = takeDecoded(activeSrc);
      const install = (im: HTMLImageElement) => {
        originalImgRef.current = im;
        // 合併後的預覽圖是預覽尺寸，顯示的尺寸維持照片原本的（存檔會烤回原尺寸）
        if (!fullJobsRef.current[activeSrc]) setImageDimensions(`${im.naturalWidth}×${im.naturalHeight}`);
        const g = geoRef.current;
        const sw = im.naturalWidth, sh = im.naturalHeight;
        // 撤銷回到「有裁切」的那一步時，緩衝區要照那個幾何重算，不然裁切會不見
        const src: CanvasImageSource = isGeoIdentity(g) ? im : composeCanvas(im, sw, sh, g, 2400);
        const w = isGeoIdentity(g) ? sw : (src as HTMLCanvasElement).width;
        const h = isGeoIdentity(g) ? sh : (src as HTMLCanvasElement).height;
        // 換成合併好的那張：CPU 路徑留著的濾鏡結果是舊來源算的，一定要重算
        lastProcessedParamsRef.current = { ...lastProcessedParamsRef.current, bufferWidth: 0, selectedLutIdx: -1 } as any;
        lut0StateRef.current = {} as any; lut0CanvasRef.current = null; lut100CanvasRef.current = null;
        buildBuffersFromRef.current(src, w, h, false, activeSrc);
      };
      /* 合併剛做好的那張：像素已經在手上（一張普通的 2D 畫布），直接拿來建緩衝區，
         不用等 JPEG 解碼、也不用從 GPU 讀回 —— 合併後馬上就能點。
         解碼好的 <img>（構圖、輸出尺寸等要用）在背景接上。 */
      const fresh = mergeCanvasRef.current;
      if (!ready && fresh && fresh.url === activeSrc) {
        mergeCanvasRef.current = null;
        const c = fresh.cvs;
        lastProcessedParamsRef.current = { ...lastProcessedParamsRef.current, bufferWidth: 0, selectedLutIdx: -1 } as any;
        lut0StateRef.current = {} as any; lut0CanvasRef.current = null; lut100CanvasRef.current = null;
        buildBuffersFromRef.current(c, c.width, c.height, false, activeSrc);
        c.width = c.height = 0;
        tapFastRef.current = true;   // 換上之後那一次也走 GPU 直出，不跑 CPU 整張重算
        loadImg(activeSrc).then(im => {
          rememberDecoded(activeSrc, im);
          if (srcListRef.current[safeIdxRef.current] === activeSrc) originalImgRef.current = im;
        }).catch(() => {}).finally(() => { mergeImgPendingRef.current = false; });
        return;
      }
      if (ready) install(ready);
      else {
        const im = new Image();
        if (!activeSrc.startsWith('blob:') && !activeSrc.startsWith('data:')) im.crossOrigin = 'anonymous';
        im.onload = () => { rememberDecoded(activeSrc, im); install(im); };
        im.src = activeSrc;
      }
      return;
    }
    /* 多圖編輯換照片：停在原本的分頁（以前一律跳回「濾鏡」，在特效頁換照片會被丟到濾鏡頁）。
       特效頁要照新照片自己的參數重新選中（它沒套那個特效就停在「原始」，不能留著上一張的白框）。 */
    const batchSwitch = srcListRef.current.length > 1 && !!pendingSnapRef.current && pendingSnapSrcRef.current === activeSrc;
    const keepCat = batchSwitch && !['compose', 'template', 'beauty', 'match'].includes(activeCategory);
    setParams(JSON.parse(JSON.stringify(DEFAULT_PARAMS)));
    if (!keepCat) {
      setActiveCategory('filter');
      setActiveToolId('filter_select');
    } else if (['effects', 'leak', 'soft', 'halation', 'fx'].includes(activeCategory)) {
      const sp = pendingSnapRef.current!.params;
      const on = EFFECT_TOOLS.find(t => (EFFECT_OWN_KEYS[t.id] || [t.id]).some(k => ((sp as any)[k] || 0) !== 0));
      setActiveCategory('effects');
      setActiveFxId(on ? on.id : EFFECT_TOOLS[0].id);
      setActiveToolId(on ? effectAmountId(on.id) : 'softLight');
    }
    setSelectedLutIdx(0);
    const freshGeo = { ...DEFAULT_GEO, crop: { ...FULL_CROP } };
    geoRef.current = freshGeo;
    setGeo(freshGeo);
    setDraftGeo(null);
    // 接續上次：一定要在上面那些歸零之後才套回去。
    // 這裡刻意不用「只做一次」的旗標 —— StrictMode 會把 effect 跑兩次，
    // 只做一次的話第二次的歸零就把還原蓋掉了。改成「同一張照片就一直套」。
    if (resumeSrcRef.current === null) resumeSrcRef.current = activeSrc;
    const resume = resumeSrcRef.current === activeSrc ? initialStateRef.current : null;
    if (resume) {
      if (resume.params) setParams(resume.params);
      if (resume.geo) { geoRef.current = resume.geo; setGeo(resume.geo); }
      if (typeof resume.selectedLutIdx === 'number') setSelectedLutIdx(resume.selectedLutIdx);
    }
    setSaveState('idle');
    setFinalImage(null);
    setShowOriginal(false);
    lastRenderedShowOriginalRef.current = false;
    filterPixelCacheRef.current = {}; cacheOrderRef.current = [];
    extremeBuffersRef.current = {
      activeToolId: '',
      base: null,
      min: null,
      max: null
    };
    lastProcessedParamsRef.current = {
      brightness: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      temp: 0, tint: 0, sat: 0, vib: 0, sharpen: 0, lutAmount: 0,
      selectedLutIdx: -1, bufferWidth: 0, lutSize: 0, curvesRef: null, hslRef: null
    };

    cachedBlurCanvasRef.current = null;
    cachedSoftCanvasRef.current = null;
    cachedNoise2CanvasRef.current = null;
    cachedHalationCanvasRef.current = null;
    cachedVignetteCanvasRef.current = null;
    compiledGrainPatternRef.current = null;
    compiledNoisePatternRef.current = null;
    lut0CanvasRef.current = null;
    lut100CanvasRef.current = null;
    pixelBufferCanvasRef.current = null;

    if (lazyCacheTimeoutRef.current) {
      clearTimeout(lazyCacheTimeoutRef.current);
      lazyCacheTimeoutRef.current = null;
    }
    forceRecalculateEffectsRef.current = false;

    blurCacheStateRef.current = null;
    softCacheStateRef.current = null;
    noise2CacheStateRef.current = null;
    halationCacheStateRef.current = null;
    
    if (!grainPatternRef.current) grainPatternRef.current = generateNoisePattern('grain');
    if (!noisePatternRef.current) noisePatternRef.current = generateNoisePattern('color');

    setIsSoftActive(false);
    setIsBlurActive(false);
    setIsGrainActive(false);
    setIsHalationActive(false);
    setSoftManuallyAdjusted(false);
    setBlurManuallyAdjusted(false);
    setGrainManuallyAdjusted(false);
    setHalationManuallyAdjusted(false);
    userSoftRef.current = 50;
    userBlurRef.current = 40;
    userGrainRef.current = { grain: 0, colorNoise: 40, colorNoise2: 0 };
    userHalationRef.current = 50;

    const initialItem: HistoryItem = { 
      params: JSON.parse(JSON.stringify(DEFAULT_PARAMS)), 
      selectedLutIdx: 0,
      isSoftActive: false,
      isBlurActive: false,
      isGrainActive: false,
      isHalationActive: false,
      softManuallyAdjusted: false,
      blurManuallyAdjusted: false,
      grainManuallyAdjusted: false,
      halationManuallyAdjusted: false
    };
    writeHistory([initialItem], 0);

    // 批量編輯：換到另一張時，把那一張該有的參數套回來。
    // 一定要放在最後 —— 上面那些歸零（含柔光／朦朧／噪點／光暈四顆開關跟它們的
    // 記憶值）跟這裡是同一批 setState，先套後歸零的話開關會被關回去，
    // 畫面套了效果但按鈕顯示是關的。
    // 跟上面的 resume 一樣用「同一張照片就一直套」而不是「只套一次」——
    // StrictMode 會把 effect 跑兩次，只套一次的話第二次的歸零就把它蓋掉了。
    if (pendingSnapRef.current && pendingSnapSrcRef.current === activeSrc) {
      applySnapRef.current(pendingSnapRef.current, pendingSnapIdxRef.current ?? undefined);
    }

    let loadIsCurrent = true;
    const ready = (img: HTMLImageElement) => {
      if (!loadIsCurrent) return;
      originalImgRef.current = img;
      // 解好的圖留著。批量編輯來回切同幾張時，回頭那一次就不用再解碼一遍 ——
      // 那正是「照片明明沒動，切回去卻還要等」的來源。
      rememberDecoded(activeSrc, img);
      setIsPortrait(img.height > img.width);

      // Update dimensions dynamically
      setImageDimensions(`${img.naturalWidth}×${img.naturalHeight}`);

      buildBuffersFromRef.current(img, img.width, img.height, true, activeSrc);
      // 這張自己的裁切／旋轉要在圖解好之後才補得回去。上面 applySnap 那時候
      // originalImgRef 還是空的，只設得了狀態、套不到畫布上 —— 所以切回一張
      // 裁切過的照片會看到未裁切的整張，看起來就是「忽然放大了一下」。
      // 兩次 buildBuffers 都在同一拍裡，React 只會提交一次，中間不會出現兩種尺寸。
      const own = geoRef.current;
      if (own && !isGeoIdentity(own)) applyGeoRef.current(own);
      setIsSwitching(false);
    };

    // 已經解好的就直接用，不要再繞一次 new Image()
    const done = takeDecoded(activeSrc);
    if (done) {
      ready(done);
    } else {
      const img = new Image();
      if (!activeSrc.startsWith('blob:') && !activeSrc.startsWith('data:')) {
          img.crossOrigin = "anonymous";
      }
      let committed = false;
      const commitDecodedImage = async () => {
        if (committed) return;
        committed = true;
        /* iOS WebKit 的 load 事件只代表檔案已經讀到，不保證像素已經能畫進
           canvas。若在這裡立刻 drawImage，偶爾會先提交一張透明 canvas；之後
           使用者點一下畫面觸發重新合成，照片才突然出現。

           先等 decode()，再跨一個 animation frame 才建立緩衝，第一個可見幀
           就一定已經有完整像素。舊版 WebKit 沒有 decode 或 decode 拒絕時，
           仍使用已成功 onload 的圖片，不會因此卡住。 */
        try {
          if (typeof img.decode === 'function') await img.decode();
        } catch { /* onload 已成功，仍可安全使用這張圖 */ }
        if (!loadIsCurrent) return;
        requestAnimationFrame(() => {
          if (loadIsCurrent) ready(img);
        });
      };
      img.onload = commitDecodedImage;
      img.onerror = () => {
        if (!loadIsCurrent) return;
        setIsSwitching(false);
        console.error("Failed to load image in canvas:", activeSrc);
        alert("無法在畫布中解析此圖片，這可能是記憶體不足或格式損毀。");
        setIsEditorLoading(false);
        onCancel();
      };
      img.src = activeSrc;
      /* blob/data URL 在快取命中時可能在綁定 onload 前後立刻完成；補查一次，
         但用 committed 保證只會建立一次緩衝。 */
      if (img.complete && img.naturalWidth > 0) void commitDecodedImage();
    }
    return () => {
      loadIsCurrent = false;
      if (lazyCacheTimeoutRef.current) {
        clearTimeout(lazyCacheTimeoutRef.current);
      }
    };
  }, [activeSrc, onCancel]);

  // Handle Loading State manually since it might take a second to build buffers
  const [isEditorLoading, setIsEditorLoading] = useState(true);

  // 構圖會改變來源畫面的尺寸與內容，所以緩衝區的建立必須能重跑。第一次載入與每次套用
  // 構圖都走這裡，差別只在 initial 決定要不要做暖機與解鎖 UI。
  const buildBuffersFrom = useCallback((
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    initial: boolean,
    warmKey?: string
  ) => {
      if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) return;
      if (sharpenTimerRef.current !== null) clearTimeout(sharpenTimerRef.current);
      if (initial) bufferGeoRef.current = DEFAULT_GEO;
      // Preview Size
      const PREVIEW_SIZE = 1800;
      let pw = srcW, ph = srcH;
      if (pw > PREVIEW_SIZE || ph > PREVIEW_SIZE) { const r = Math.min(PREVIEW_SIZE / pw, PREVIEW_SIZE / ph); pw = (pw * r) | 0; ph = (ph * r) | 0; }
      pw = Math.max(1, pw); ph = Math.max(1, ph);

      const pc = document.createElement('canvas');
      pc.width = pw; pc.height = ph;
      const pctx = pc.getContext('2d', { willReadFrequently: true })!;
      pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(source, 0, 0, pw, ph);
      // 同上：比例與畫布尺寸必須同一幀生效
      applyPreviewAspect(pw, ph);
      const pData = pctx.getImageData(0, 0, pw, ph).data;
      const pLen = pData.length;

      /* 同尺寸就沿用原本那幾塊大陣列（每塊約 10MB）：合併、構圖後重建緩衝區時不再整批重配，
         手機上就不會在合併後幾秒冒出一次很久的記憶體回收（那段期間點什麼都卡）。 */
      const prevBufs = buffers.current;
      const reuse = (old: Uint8ClampedArray | null | undefined, len: number) => old && old.length === len ? old : new Uint8ClampedArray(len);
      buffers.current = {
          preview: {
              source: pData,
              dest: reuse(prevBufs.preview.dest, pLen),
              shared: reuse(prevBufs.preview.shared, pLen),
              lutted: reuse(prevBufs.preview.lutted, pLen),
              lut0: reuse(prevBufs.preview.lut0, pLen),
              lut100: reuse(prevBufs.preview.lut100, pLen),
              temp: reuse(prevBufs.preview.temp, pLen),
              sharpenDetail: null, 
              w: pw, h: ph
          },
          fast: { // Built right below: low-res proxy used only while the user is actively dragging
              source: null, dest: null, shared: null, lutted: null, lut0: null, lut100: null, temp: null, sharpenDetail: null, w: 0, h: 0
          }
      };

      // Interactive proxy: a downscaled copy of the preview buffer. Tools that have to
      // re-run the whole pixel pipeline on every pointer move (curves, mask, and every
      // effect that is not in FAST_BLEND_TOOLS) render against this while dragging, then
      // fall back to the full preview buffer the moment the finger lifts.
      /* 代理的長寬一定要跟預覽「完全同一個比例」。
         以前是 (w*r)|0 直接截掉小數，例如 3024×4032 會變成 675×900 —— 比例差了
         千分之一。畫布是用 object-contain 排版的，它會照畫布「自己的」比例去留黑邊，
         比例一變、黑邊就變，圖片就整個位移了半個像素左右 ——
         那就是主人說的「拖濾鏡滑桿時圖片會異常位移」。
         改成先把 w:h 約分，再取「不超過 PROXY_SIZE 的最大整數倍」，
         比例就跟原圖一模一樣，位移的來源從根本上消失。 */
      const PROXY_SIZE = 900;
      let fw = pw, fh = ph;
      if (fw > PROXY_SIZE || fh > PROXY_SIZE) {
        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
        const g = gcd(pw, ph) || 1;
        const aw = pw / g, ah = ph / g;
        const m = Math.floor(PROXY_SIZE / Math.max(aw, ah));
        if (m >= 1) { fw = aw * m; fh = ah * m; }
        else {
          // 約分後還是比 PROXY_SIZE 大（極端長寬比）才退回等比縮放
          const r = Math.min(PROXY_SIZE / fw, PROXY_SIZE / fh);
          fw = Math.max(1, Math.round(fw * r));
          fh = Math.max(1, Math.round(fh * r));
        }
      }
      if (fw < pw || fh < ph) {
          const fc = document.createElement('canvas');
          fc.width = fw; fc.height = fh;
          const fctx = fc.getContext('2d', { willReadFrequently: true })!;
          fctx.imageSmoothingQuality = 'high';
          fctx.drawImage(pc, 0, 0, fw, fh);
          const fData = fctx.getImageData(0, 0, fw, fh).data;
          const fLen = fData.length;
          buffers.current.fast = {
              source: fData,
              dest: reuse(prevBufs.fast.dest, fLen),
              shared: reuse(prevBufs.fast.shared, fLen),
              lutted: reuse(prevBufs.fast.lutted, fLen),
              lut0: reuse(prevBufs.fast.lut0, fLen),
              lut100: reuse(prevBufs.fast.lut100, fLen),
              temp: reuse(prevBufs.fast.temp, fLen),
              sharpenDetail: null,
              w: fw, h: fh
          };
          fc.width = fc.height = 0;
      }

      // 緩衝區換人了，所有跟「上一份像素」綁在一起的快取一律作廢。
      // 這件事一定要在這裡做，不能只在載入的 effect 裡做 —— 圖片是非同步解碼的，
      // 中間可能已經用舊緩衝區畫過一輪，把舊照片的像素寫回那些快取裡。
      if (initial) {
        filterPixelCacheRef.current = {}; cacheOrderRef.current = [];
        lastProcessedParamsRef.current = { ...lastProcessedParamsRef.current, bufferWidth: 0, curvesRef: null, hslRef: null, selectedLutIdx: -1 };
        extremeBuffersRef.current = { activeToolId: '', base: null, min: null, max: null };
        fastPreviewCacheRef.current.active = false;
        lut0StateRef.current = {};
        lut0CanvasRef.current = null;
        lut100CanvasRef.current = null;
      }
      if (warmKey) { buffersSrcRef.current = warmKey; setBuffersTick(t => t + 1); }
      /* 這張是原圖（不是合併出來的）才留底：留的是預覽尺寸那一份，
         前後對比只是拿來看的，不需要原始解析度。 */
      if (warmKey && !thumbOriginRef.current[warmKey] && !pristineOf(warmKey)) {
        const keep = document.createElement('canvas');
        keep.width = pw; keep.height = ph;
        keep.getContext('2d')!.drawImage(pc, 0, 0);
        pristineRef.current.unshift({ key: warmKey, canvas: keep });
        pristineRef.current.length = Math.min(pristineRef.current.length, PRISTINE_KEEP);
      }
      // 背景先算好的「調節 + 濾鏡」像素圖，塞回 render() 本來就在用的快取，
      // 待會第一次帶著參數繪製時就直接拿來用，不用當場重算。
      if (initial && warmKey) seedWarmPixelsRef.current(warmKey, pw, ph);

      const WARMUP_PARAMS = {
        ...DEFAULT_PARAMS,
        shadows: 1,
        highlights: 1,
        curves: {
          rgb: [{x:0,y:0}, {x:127,y:127}, {x:255,y:255}],
          r: [{x:0,y:0}, {x:255,y:255}],
          g: [{x:0,y:0}, {x:255,y:255}],
          b: [{x:0,y:0}, {x:255,y:255}]
        }
      };
      const WARMUP_HSL_PARAMS: EditorParams = {
        ...DEFAULT_PARAMS,
        // 身分值會直接跳過整段 HSL；給一個肉眼無關的小值，讓瀏覽器在使用者
        // 碰滑桿前就完成這條熱路徑的 JIT 編譯。
        hsl: DEFAULT_HSL.map((band, i) => i === 0 ? { ...band, h: 1 } : { ...band }),
      };
      
      // Warmup logic using shared buffer
      generateBaseCorrectionLut(0,0,0, baseCorrectionLutRef.current);
      if (initial) {
        // 這兩趟空跑是為了讓 JIT 先把像素迴圈編譯起來，整個編輯器開著只需要做一次。
        // 批量編輯換照片時再做一次是白花時間（換一張要多等 0.15～0.27 秒）。
        if (!pipelineWarmedRef.current) {
          processPixels(pData, buffers.current.preview.dest!, pw, ph, WARMUP_PARAMS, null, 0, baseCorrectionLutRef.current, null, false, getCurveLuts(WARMUP_PARAMS.curves));
          processPixels(pData, buffers.current.preview.dest!, pw, ph, DEFAULT_PARAMS, null, 0, baseCorrectionLutRef.current, null, false, getCurveLuts(DEFAULT_PARAMS.curves));
          // HSL 分支以前没有被上面两次身分参数覆盖，首次拖动时才触发 JIT，
          // 因而只在前几次手势卡顿。用最多 192×192 的工作区先跑两次，足以
          // 优化热点，又不会拿整张 1800px 预览做无意义的重运算。
          const hw = Math.min(pw, 192), hh = Math.min(ph, 192);
          const hLen = hw * hh * 4;
          const hSrc = pData.subarray(0, hLen);
          const hDst = new Uint8ClampedArray(hLen);
          const hCurves = getCurveLuts(WARMUP_HSL_PARAMS.curves);
          processPixels(hSrc, hDst, hw, hh, WARMUP_HSL_PARAMS, null, 0, baseCorrectionLutRef.current, null, false, hCurves);
          processPixels(hSrc, hDst, hw, hh, WARMUP_HSL_PARAMS, null, 0, baseCorrectionLutRef.current, null, false, hCurves);
          pipelineWarmedRef.current = true;
        }
        // 已經用預熱的畫面補上調整後的樣子了，就別再畫一次原圖 —— 那會閃一下。
        if (warmPaintedSrcRef.current !== warmKey) render(DEFAULT_PARAMS, 0);
        warmPaintedSrcRef.current = null;
        // 這一筆畫的是「還沒調整」的樣子。批量編輯換照片時，參數其實早就套好了，
        // 只是圖片解碼比 React 慢一步，這一筆就會把調整後的畫面蓋掉 ——
        // 畫面於是停在原圖，要等使用者再去動一下才會恢復。
        // 標記成髒的，下一個影格就會用現在的參數重畫一次。
        isDirtyRef.current = true;
        lastRenderTimeRef.current = 0;
      } else {
        // 幾何改變後所有快取都對不上舊尺寸，全部作廢再重畫一次
        filterPixelCacheRef.current = {}; cacheOrderRef.current = [];
        lastProcessedParamsRef.current = { ...lastProcessedParamsRef.current, bufferWidth: 0, curvesRef: null, hslRef: null };
        extremeBuffersRef.current = { activeToolId: '', base: null, min: null, max: null };
        fastPreviewCacheRef.current.active = false;
        lut0StateRef.current = {};
        lut0CanvasRef.current = null;
        lut100CanvasRef.current = null;
        pixelBufferCanvasRef.current = null;
        cachedBlurCanvasRef.current = null;
        cachedSoftCanvasRef.current = null;
        cachedNoise2CanvasRef.current = null;
        cachedHalationCanvasRef.current = null;
        cachedVignetteCanvasRef.current = null;
        blurCacheStateRef.current = null;
        softCacheStateRef.current = null;
        noise2CacheStateRef.current = null;
        halationCacheStateRef.current = null;
        isDirtyRef.current = true;
        lastRenderTimeRef.current = 0;
      }

      // Instantly unlock UI, run sharp block async
      if (initial) {
        setIsEditorLoading(false);
        /* 解析遮罩收起來後再明確排一個完整畫質繪製幀。這不是等互動重畫：
           即使 iOS 把前一幀 canvas 合成延後，下一幀也會主動提交照片。 */
        requestAnimationFrame(() => {
          isDirtyRef.current = true;
          lastRenderTimeRef.current = 0;
        });
      }

      // 工作只屬於建立時的那份 buffers；快速切頁／換圖時取消舊工作，
      // 不讓舊尺寸的銳化結果寫進新的照片，也不堆積大量待算的像素陣列。
      const ownedBuffers = buffers.current;
      sharpenTimerRef.current = setTimeout(() => {
        sharpenTimerRef.current = null;
        if (buffers.current !== ownedBuffers) return;
        // 沒開銳化就先不算（合併／換圖後那一下少一大塊工作）；開了銳化時重畫前才補算
        if (!(paramsRef.current.sharpen > 0)) return;
        ownedBuffers.preview.sharpenDetail = precomputeSharpenDetail(pData, pw, ph);
        const f = ownedBuffers.fast;
        if (f.source) f.sharpenDetail = precomputeSharpenDetail(f.source, f.w, f.h);
      }, 10);
      pc.width = pc.height = 0;
  }, [render, getCurveLuts]);

  // 套用構圖：用新的幾何把來源重新算一次，再整個重建預覽緩衝。
  const applyGeo = useCallback((g: GeoParams) => {
    if (!validGeo(g)) return false;
    if (sameGeoPixels(bufferGeoRef.current, g)) {
      geoRef.current = g;
      setGeo(g);
      return false;
    }
    const img = originalImgRef.current;
    if (!img) return false;
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const src = isGeoIdentity(g) ? img : composeCanvas(img, sw, sh, g, 2400);
    const w = 'width' in src ? (src as HTMLCanvasElement).width : sw;
    const h = 'height' in src ? (src as HTMLCanvasElement).height : sh;
    buildBuffersFromRef.current(src, isGeoIdentity(g) ? sw : w, isGeoIdentity(g) ? sh : h, false);
    bufferGeoRef.current = g;
    geoRef.current = g;
    setGeo(g);
    if (src !== img) (src as HTMLCanvasElement).width = (src as HTMLCanvasElement).height = 0;
    return true;
  }, []);

  useEffect(() => { applyGeoRef.current = applyGeo; }, [applyGeo]);

  const buildBuffersFromRef = useRef(buildBuffersFrom);
  useEffect(() => { buildBuffersFromRef.current = buildBuffersFrom; }, [buildBuffersFrom]);


  // ... (rest of the component, render loop, UI handlers, JSX remain same as previous version)
  const isInteractingRef = useRef(isInteracting);
  useEffect(() => {
    isInteractingRef.current = isInteracting;
    // Entering or leaving a drag swaps the render target between the low-res proxy and the
    // full preview buffer, so force one render at the new resolution.
    isDirtyRef.current = true;
    lastRenderTimeRef.current = 0;
  }, [isInteracting]);

  const lastRenderTimeRef = useRef<number>(0);
  const lastRenderDurationRef = useRef<number>(16); // Default 16ms

  // Unified, high-performance continuous requestAnimationFrame scheduler
  // Eliminates race conditions, enables 60fps renders, and processes before/after comparing cleanly
  useEffect(() => {
    let rafId: number;
    let isActive = true;

    /* 剛載好的濾鏡已經算過一輪了 —— 這時候才收掉那顆按鈕上的轉圈。
       比對 id 是為了「連點兩顆都還沒載的濾鏡」那種情況：
       先載好的那顆不能把還在載的那顆的轉圈一起收掉。 */
    const clearPendingLutPaint = () => {
        const doneId = pendingLutPaintRef.current;
        if (!doneId) return;
        pendingLutPaintRef.current = null;
        setLoadingLutId(cur => (cur === doneId ? null : cur));
    };

    const tick = () => {
        if (!isActive) return;

        const b = buffers.current.preview;
        const cvs = displayCanvasRef.current;
        /* 閒著的時候先把 GPU 暖起來（上傳貼圖、建表、跑一次空 draw）。
           不先做的話這些一次性成本會落在手指按下滑桿的第一幀，就是「抖一下」。 */
        if (!isDirtyRef.current && !isInteractingRef.current && performance.now() - lastUiInputRef.current > 800 && b?.source && b.w && b.h) {
            warmGpu(b.source, b.w, b.h, `${b.w}x${b.h}|${srcIdent()}`);
            /* 貼圖暖好之後，接著一顆一顆把濾鏡的查色表也烤起來。
               每次閒置只烤一顆，主執行緒馬上還回去。 */
            const baked = gpuWarmKeyRef.current ? warmBakes(paramsRef.current) : false;
            /* 查色表都烤完了才輪到這個：把「拖曳中要用的那三張全解析度畫面」
               先算好，手指碰到滑桿那一下就不用停下來算（原本會卡 270～303ms）。
               一樣一次只算一份（量到約 85～115ms），不會一口氣佔住主執行緒。

               而且要等畫面「真的停下來 250ms 以上」才開始 —— 剛點完工具、
               或正在捲工具列的那一小段時間別去搶主執行緒，不然預熱本身
               會變成新的頓點。 */
            if (!baked && performance.now() - lastRenderTimeRef.current > 250) warmFastPreviewRef.current();
        }
        // 換照片時，新圖還在解碼，緩衝區裡裝的還是上一張 —— 這時候畫出去就是舊照片。
        // 等緩衝區換成現在這一張再畫。
        const alias = bufferAliasRef.current;
        const buffersReady = buffersSrcRef.current === activeSrcRef.current
          || (!!alias && alias.key === buffersSrcRef.current && alias.for === activeSrcRef.current);
        if (cvs && b && b.source && b.dest && buffersReady) {
            const currentParams = paramsRef.current;
            const currentShowOriginal = showOriginalRef.current;
            const interacting = isInteractingRef.current;
            const now = performance.now();
            
            const flipped = currentShowOriginal !== lastRenderedShowOriginalRef.current;
            /* ── 前後對比：按下／放開都不要再跑一次整條管線 ─────────────
               按下去：先把現在畫布上那張（＝編輯後）複製一份留著。
               放開  ：按著的期間如果什麼都沒變（isDirtyRef 是乾淨的），
                       直接把那份貼回來就好，一次搬移，不必重算。 */
            if (flipped) {
                const snapKey = `${b.w}x${b.h}|${srcIdent()}`;
                if (currentShowOriginal) {
                    if (!compareSnapRef.current) compareSnapRef.current = document.createElement('canvas');
                    const snap = compareSnapRef.current;
                    if (snap.width !== b.w || snap.height !== b.h) { snap.width = b.w; snap.height = b.h; }
                    const sctx = snap.getContext('2d')!;
                    sctx.globalCompositeOperation = 'copy';
                    /* 一定要縮放到 b.w×b.h：畫面上看得到的那張可能是 GPU 特效畫布，尺寸跟緩衝區不一樣。
                       以前照原尺寸貼在 (0,0)，比較小的那張放開時就縮在左上角（「縮小又往左上跑」）。 */
                    const shown = visibleEditorCanvas() || cvs;
                    if (shown.width > 0 && shown.height > 0) sctx.drawImage(shown, 0, 0, b.w, b.h);
                    sctx.globalCompositeOperation = 'source-over';
                    compareSnapKeyRef.current = isDirtyRef.current || !(shown.width > 0 && shown.height > 0) ? '' : snapKey;
                } else if (!isDirtyRef.current && compareSnapRef.current && compareSnapKeyRef.current === snapKey) {
                    const dctx = cvs.getContext('2d')!;
                    if (cvs.width !== b.w || cvs.height !== b.h) { cvs.width = b.w; cvs.height = b.h; }
                    dctx.globalCompositeOperation = 'copy';
                    dctx.drawImage(compareSnapRef.current, 0, 0, b.w, b.h);
                    dctx.globalCompositeOperation = 'source-over';
                    cvs.style.filter = 'none';
                    // Comparison presented the original on the GPU surface.
                    // Restoring only the hidden 2D canvas leaves that original
                    // visible forever (notably mosaic / glass-brick effects).
                    presentEditorSource(dctx, b.w, b.h);
                    lastRenderedShowOriginalRef.current = false;
                    lastRenderTimeRef.current = now;
                    rafId = requestAnimationFrame(tick);
                    return;
                }
            }

            if ((isDirtyRef.current || flipped) && uiFirstRef.current && !interacting) {
                // The tapped card / tab paints in this frame; the photo follows in the next.
                uiFirstRef.current = false;
                shotHoldUntilRef.current = 0;   // 使用者點了東西：不再等，下一格就照常畫
                rafId = requestAnimationFrame(tick);
                return;
            }
            /* 剛切過來、畫面已經是留下來的最終樣子：先不重跑（見 paintMaskShot）。一有操作就照常畫 */
            if (isDirtyRef.current && !flipped && !interacting && !uiFirstRef.current && now < shotHoldUntilRef.current) {
                rafId = requestAnimationFrame(tick);
                return;
            }
            /* 拖遮色片滑桿、即時疊層已經掛好：每一格都由疊層自己畫，管線不重跑（放手時會補一次完整的） */
            if (isDirtyRef.current && !flipped && maskLiveRef.current && (maskSliderLiveRef.current || !!activeDragRef.current || maskPaintingRef.current)) isDirtyRef.current = false;
            /* 只有紅色範圍的開關變了：只畫那一層，照片不重算 */
            if (isDirtyRef.current && !flipped && overlayOnlyRef.current) {
                overlayOnlyRef.current = false;
                const last = lastFullRenderParamsRef.current;
                const same = !!last && last !== currentParams && (() => {
                    const keys = new Set([...Object.keys(last), ...Object.keys(currentParams)]);
                    for (const k of keys) if (k !== 'maskShowOverlay' && (last as any)[k] !== (currentParams as any)[k]) return false;
                    return true;
                })();
                if (same && !interacting && paintOverlayOnlyRef.current(currentParams)) {
                    isDirtyRef.current = false;
                    lastFullRenderParamsRef.current = currentParams;
                    rafId = requestAnimationFrame(tick);
                    return;
                }
            }
            if (isDirtyRef.current || flipped) {
                const elapsed = now - lastRenderTimeRef.current;

                // Consume the latest parameters once per display frame; do not add
                // a timer after slider input or defer the visible effect until release.
                const throttleMs = 0;
                
                if (elapsed >= throttleMs) {
                    isDirtyRef.current = false;
                    lastRenderedShowOriginalRef.current = currentShowOriginal;
                    lastRenderTimeRef.current = now;
                    
                    {
                        // For non-interactive/final renders, do it synchronously to ensure instant high-quality paint
                        if (renderTimeoutRef.current) {
                            clearTimeout(renderTimeoutRef.current);
                            renderTimeoutRef.current = null;
                        }
                        const start = performance.now();
                        render(currentParams, mergeFreezeRef.current?.lutIdx);
                        const duration = performance.now() - start;
                        lastRenderDurationRef.current = duration;
                        clearPendingLutPaint();
                    }
                }
            }
        }
        rafId = requestAnimationFrame(tick);
    };
    
    rafId = requestAnimationFrame(tick);
    return () => {
        isActive = false;
        cancelAnimationFrame(rafId);
        if (renderTimeoutRef.current) {
            clearTimeout(renderTimeoutRef.current);
        }
    };
  }, [render]);

  useEffect(() => {
    isDirtyRef.current = true;
  }, [selectedLutIdx, loadingLutId]);

  const resetParam = (id: keyof EditorParams) => {
    let defaultValue = DEFAULT_PARAMS[id];
    
    // Specific defaults based on current LUT
    const url = lutList[selectedLutIdx]?.url || '';
    const lutId = lutList[selectedLutIdx]?.id || 'none';
    if (id === 'lutAmount') {
        if (url.includes('IMG_3371') || url.includes('Untitled_grid') || url.includes('IMG_3328') || 
            url.includes('IMG_3373') || url.includes('IMG_3374') || 
            url.includes('IMG_9026') || url.includes('IMG_0214') || lutId === 'f4') defaultValue = 70;
        else if (url.includes('IMG_0285') || url.includes('IMG_0286') || url.includes('IMG_8998') || url.includes('IMG_7932')) defaultValue = 50;
        else if (url.includes('sample_colorscale') || url.includes('IMG_7936')) defaultValue = 80;
        else if (url.includes('IMG_30222')) defaultValue = 50;
        else if (url.includes('IMG_7938') || url.includes('IMG_7940') || url.includes('IMG_7211')) defaultValue = 100;
    } else if (id === 'blur') {
        defaultValue = isBlurActive ? (blurManuallyAdjusted ? userBlurRef.current : ((lutId === 'f22' || lutId === 'f23') ? 30 : 40)) : 0;
    } else if (id === 'colorNoise') {
        defaultValue = isGrainActive ? (grainManuallyAdjusted ? userGrainRef.current.colorNoise : 20) : 0;
    }

    const nextParams = { ...params, [id]: defaultValue };

    // Update manually adjusted state and active toggles if resetting specific parameters
    let nextSoftActive = isSoftActive;
    let nextBlurActive = isBlurActive;
    let nextGrainActive = isGrainActive;
    let nextSoftManual = softManuallyAdjusted;
    let nextBlurManual = blurManuallyAdjusted;
    let nextGrainManual = grainManuallyAdjusted;

    if (id === 'soft') {
        nextSoftActive = defaultValue > 0;
        nextSoftManual = false;
        setSoftManuallyAdjusted(false);
        setIsSoftActive(defaultValue > 0);
    } else if (id === 'blur') {
        nextBlurActive = defaultValue > 0;
        nextBlurManual = false;
        setBlurManuallyAdjusted(false);
        setIsBlurActive(defaultValue > 0);
    } else if (id === 'grain' || id === 'colorNoise' || id === 'colorNoise2') {
        const nextP = { ...nextParams, [id]: defaultValue };
        const hasGrain = nextP.grain > 0 || nextP.colorNoise > 0 || nextP.colorNoise2 > 0;
        nextGrainActive = hasGrain;
        nextGrainManual = false;
        setGrainManuallyAdjusted(false);
        setIsGrainActive(hasGrain);
    }

    setParams(nextParams);
    paramsRef.current = nextParams;
    addToHistory(nextParams, selectedLutIdx, nextSoftActive, nextBlurActive, nextGrainActive, nextSoftManual, nextBlurManual, nextGrainManual);
  };

  const handleDoubleTap = (e: React.MouseEvent | React.TouchEvent, id: keyof EditorParams) => {
      const now = Date.now();
      const last = lastTapRef.current[id as string] || 0;
      if (now - last < 300) {
          resetParam(id);
          lastTapRef.current[id as string] = 0;
          if (e.type === 'touchend') e.preventDefault();
      } else {
          lastTapRef.current[id as string] = now;
      }
  };

  /** 把一張照片用指定的一組參數算出成品（存檔用的原始解析度） */
  const renderOneCanvas = (img: HTMLImageElement, snap: BatchSnap): HTMLCanvasElement => {
    const g = snap.geo;
    const p = snap.params;
    const ow = img.naturalWidth || img.width;
    const oh = img.naturalHeight || img.height;
    // 存檔用原始解析度重跑一次構圖，預覽時的 2400px 版本只是給畫面看的
    const geoSource: CanvasImageSource = isGeoIdentity(g) ? img : composeCanvas(img, ow, oh, g);
    const w0 = isGeoIdentity(g) ? ow : (geoSource as HTMLCanvasElement).width;
    const h0 = isGeoIdentity(g) ? oh : (geoSource as HTMLCanvasElement).height;
    /* iOS Safari 單張畫布上限約 1677 萬像素，超過時畫布是空的、記憶體也會爆而重新載入
       （48MP 照片疊特效存檔時）。只有超過上限的照片才等比縮到上限內，其他照片不變。 */
    const IOS_MAX_PX = 16_000_000;
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const capK = isIOS && w0 * h0 > IOS_MAX_PX ? Math.sqrt(IOS_MAX_PX / (w0 * h0)) : 1;
    const w = Math.max(1, Math.floor(w0 * capK)), h = Math.max(1, Math.floor(h0 * capK));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctxOriginal = c.getContext('2d', { willReadFrequently: true })!;
    ctxOriginal.drawImage(geoSource, 0, 0, w, h);
    const originalData = ctxOriginal.getImageData(0, 0, w, h).data;
    /* 發光類特效先在原圖上算（跟預覽同一個順序），濾鏡與調節再套在「原圖＋光」上 */
    const sourceData = hasGlow(p) ? (glowCpu(p, originalData, w, h) || originalData) : originalData;
    const len = sourceData.length;
    /* 像素已經讀出來後立即釋放來源畫布。12MP 的一張 RGBA 畫布約 48MB；
       舊版匯出時同時保留多份，iOS 會因此收走 WebGL context。 */
    c.width = 1; c.height = 1;
    if (geoSource instanceof HTMLCanvasElement && geoSource !== c) {
      geoSource.width = 1; geoSource.height = 1;
    }

    /* 大型緩衝只在真的需要時建立。正常 GPU 匯出不再預先多佔兩張全尺寸圖，
       銳化為零時也不計算完全用不到的 detail。 */
    let destData: Uint8ClampedArray | null = null;
    const sharpenDetail = p.sharpen > 0 ? precomputeSharpenDetail(sourceData, w, h) : null;

    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const lut = lutList[snap.selectedLutIdx];
    const activeLut = lut && lut.url ? lutDataRef.current[lut.id] : null;
    const lutSize = activeLut ? activeLut.size : 0;

    generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, baseCorrectionLutRef.current);

    /* ── 匯出也走 GPU ──────────────────────────────────────────────
       這裡是原始解析度（動輒一兩千萬像素），CPU 逐像素是整個存檔最慢的一步。
       改成：用現有的 processPixels 在 65³ 個格點上算一次烤成查色表（16ms），
       GPU 一個 draw call 查完整張圖，直接畫進畫布 —— 不需要把像素讀回來，
       因為接下來就是編碼成 PNG，畫布本身就是要的東西。

       不能走 GPU 的情況：
         · 銳化 —— 要看鄰居像素（這裡有 sharpenDetail），烤不進查色表
         · colorNoise2 —— 它的雜訊遮罩要吃 destData 的像素
         · 圖片超過裝置的貼圖上限 —— gpuPaint 內部會擋掉
       任何一步失敗都原封不動走下面原本的 CPU 路徑，成品完全一樣。 */
    let gpuOk = false;
    if (!p.sharpen && !p.colorNoise2) {
      const gc = document.createElement('canvas');
      gpuOk = gpuPaint(gc, sourceData, w, h, p,
        activeLut ? activeLut.data : null, lutSize, 65, `export|${w}x${h}|${Math.random()}`, null,
        activeLut ? `${lut?.id}#${lutSize}` : 'none');
      if (gpuOk) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(gc, 0, 0);
        /* Safari 記憶體吃緊時偶爾不回 WebGL 錯誤，卻只交出全黑 drawing buffer。
           驗證真實像素；只有來源有色彩而輸出完全為零時才退回 CPU。 */
        const sourceHasColor = (() => {
          const stride = Math.max(4, Math.floor(sourceData.length / (512 * 4)) * 4);
          for (let i = 0; i < sourceData.length; i += stride) {
            if (sourceData[i] || sourceData[i + 1] || sourceData[i + 2]) return true;
          }
          return false;
        })();
        if (sourceHasColor) {
          try {
            const probe = document.createElement('canvas');
            probe.width = 16; probe.height = 16;
            const probeCtx = probe.getContext('2d', { willReadFrequently: true });
            probeCtx?.drawImage(canvas, 0, 0, 16, 16);
            const px = probeCtx?.getImageData(0, 0, 16, 16).data;
            let outputHasColor = false;
            if (px) for (let i = 0; i < px.length; i += 4) {
              if (px[i] || px[i + 1] || px[i + 2]) { outputHasColor = true; break; }
            }
            if (!outputHasColor) gpuOk = false;
            probe.width = 1; probe.height = 1;
          } catch { gpuOk = false; }
        }
      }
      // 貼圖已經被換成匯出那張了，讓預覽下次重新上傳自己的
      gpuSrcKeyRef.current = '';
      gpuWarmKeyRef.current = '';
    }
    if (!gpuOk) {
      destData = new Uint8ClampedArray(len);
      processPixels(sourceData, destData, w, h, p, activeLut ? activeLut.data : null, lutSize, baseCorrectionLutRef.current, sharpenDetail, false, getCurveLuts(p.curves), localFor(p, sourceData, w, h, `export-cpu|${w}x${h}`));
      ctx.putImageData(new ImageData(destData, w, h), 0, 0);
    }
    const scale = Math.max(w, h) / 1080;
    applyComplexEffects(ctx, w, h, stripGlow(p), scale, null, false, true, gpuOk ? null : destData);
    return canvas;
  };

  /** 導出用：跟合併走同一支全解析度管線，只是最後轉成 PNG。
      成品用 blob 網址 —— 批次十張的話 dataURL 會是好幾百 MB 的字串。 */
  const renderOne = (img: HTMLImageElement, snap: BatchSnap): Promise<string> =>
    canvasToUrl(renderOneCanvas(img, snap));

  const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    if (!src.startsWith('blob:') && !src.startsWith('data:')) im.crossOrigin = 'anonymous';
    // decode() 之後才交出去：iOS 的 load 時像素不一定畫得進 canvas（會烤出透明／黑圖）
    im.onload = async () => { try { if (typeof im.decode === 'function') await im.decode(); } catch { /* load 已成功 */ } res(im); };
    im.onerror = () => rej(new Error('load failed'));
    im.src = src;
  });

  /* ── 合併：畫面先換、原尺寸晚點才烤 ───────────────────────────────────
     合併按下去時只做「預覽尺寸」的那一張（直接拿畫面上現成的結果，幾乎不用算），
     原尺寸那張（12MP 要算將近一秒、再編碼解碼）記成一筆待辦，等真的要用
     （存檔、輸出、IG 預覽）時才依序烤出來。這樣合併後不管點什麼都跟沒合併一樣快。
     key 是合併後那張預覽圖的網址；input 是合併前那張（可能也是待辦，會一路往前接）。 */
  /* bake：人像／仿色換上來的預覽尺寸照片，原尺寸那張由那個工具自己重播（見 installStudioResult） */
  const fullJobsRef = useRef<Record<string, { input: string; snap?: BatchSnap; bake?: (fullSrc: string) => Promise<string | null>; run?: Promise<string>; session?: string }>>({});
  const resolveFullSrc = (u: string): Promise<string> => {
    const job = fullJobsRef.current[u];
    if (!job) return Promise.resolve(u);
    if (!job.run && job.bake) job.run = (async () => {
      const input = await resolveFullSrc(job.input);
      const url = await job.bake!(input);
      if (!url) return input;
      mergedUrlsRef.current.push(url);
      return url;
    })().catch(() => job.input);
    if (!job.run) job.run = (async () => {
      const input = await resolveFullSrc(job.input);
      const img = input === srcListRef.current[safeIdxRef.current] && originalImgRef.current?.src === input
        ? originalImgRef.current : await loadImg(input);
      if (Number(job.snap!.params.fxLowfi) > 0) await warmLowfiLut();
      const cvs = renderOneCanvas(img, job.snap!);
      const url = await canvasToUrl(cvs);
      cvs.width = cvs.height = 0;
      if (!url) return input;
      mergedUrlsRef.current.push(url);
      return url;
    })().catch(() => job.input);
    return job.run;
  };
  /** 存檔／輸出用：這張照片原尺寸的樣子（有待辦就先烤完） */
  const loadFullImg = async (u: string, fallback: HTMLImageElement | null) => {
    if (!fullJobsRef.current[u]) return fallback || await loadImg(u);
    return await loadImg(await resolveFullSrc(u));
  };

  /** 離開編輯器時，如果調整過但沒導出，也記一筆到歷史紀錄。
      縮圖直接用畫面上的預覽（已經是顯示解析度，很小很安全）。 */
  const recordProgress = useCallback(async () => {
    /* 是否需要詢問已由 requestLeave 按實際成品判斷。
       恢復的已編輯專案會把當前成品設成 history 第 0 格，因此這裡不能再用
       historyIndex <= 0 跳過；否则按了「儲存」也不會寫入歷史紀錄。 */
    const cv = visibleEditorCanvas();
    if (!cv || !cv.width || !cv.height) return;
    try {
      const p = paramsRef.current;
      // 畫面上這一張可能正蓋著遮色片的紅色遮罩（那只是編輯時的輔助顯示）。
      // 直接抓的話首頁的歷史縮圖就會是紅的 —— 先用同一支 render 重畫一張沒有遮罩的。
      if (anyMask(p) && p.maskShowOverlay && activeCategory === 'mask') {
        render({ ...p, maskShowOverlay: false });
      }
      await addExport('editor', cv.toDataURL('image/png'), srcList[safeIdx] || imageSrc, {
        params: p, geo, selectedLutIdx,
      }, histKey || undefined);
    } catch { /* 記錄失敗不能影響離開 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIndex, srcList, safeIdx, imageSrc, geo, selectedLutIdx, activeCategory, render]);

  const requestLeave = useCallback(async () => {
    /* 是否要詢問不能只看「這次進來後有沒有新增 history」。
       從自動暫存恢復時 history 會從 0 重新開始，但畫面本身可能早已不是原圖；
       這種情況直接返回會讓使用者誤以為編輯不需要保存。
       因此以實際成品判斷：參數、濾鏡、構圖、已烤進來源的合併，任一不同即為已編輯。 */
    const paramsChanged = JSON.stringify(paramsRef.current) !== JSON.stringify(DEFAULT_PARAMS);
    const geoChanged = !isGeoIdentity(geo);
    const sourceChanged = activeSrc !== imageSrc;
    const hasEditedContent =
      historyIndex > 0 || paramsChanged || geoChanged || selectedLutIdx !== 0 || sourceChanged;
    if (!hasEditedContent) {
      onCancel(Boolean(initialState));
      return;
    }
    const choice = onRequestExit ? await onRequestExit() : 'discard';
    if (choice === 'cancel') return;
    if (choice === 'save') {
      await saveToolDraft('editor', imageSrc, {
        params: paramsRef.current, geo, selectedLutIdx,
        __histKey: histKey || initialState?.__histKey || null,
      });
      await recordProgress();
    }
    onCancel(choice === 'save');
  }, [historyIndex, initialState, onRequestExit, onCancel, imageSrc, activeSrc, geo, selectedLutIdx, recordProgress]);

  /* 「合併」：把現在畫面上的樣子用全解析度烤成一張新的原圖，參數整組歸零。
     特效一次只能套一個，合併過的那一層已經變成點陣圖的一部分，
     所以合併完就可以再疊下一個特效。
     烤進去的是整條管線的結果（濾鏡＋調節＋特效），不是只有特效那一段 ——
     特效是接在最後面算的，只抽特效出來烤的話跟畫面上看到的不會一樣。 */
  const mergingRef = useRef(false);
  const freezeCanvasRef = useRef<HTMLCanvasElement>(null);
  const freezeHeldRef = useRef(false);
  const holdFreeze = (src: HTMLCanvasElement) => {
    const c = freezeCanvasRef.current; if (!c) return;
    c.width = src.width; c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    c.style.display = 'block'; freezeHeldRef.current = true;
  };
  /** 收掉定格：等底下真的畫好（再兩幀）才拿開，拿開那一下畫面不會變 */
  const releaseFreeze = (now = false) => {
    if (!freezeHeldRef.current) return;
    const off = () => { const c = freezeCanvasRef.current; freezeHeldRef.current = false; if (c) { c.style.display = 'none'; c.width = c.height = 1; } };
    if (now) off(); else requestAnimationFrame(() => requestAnimationFrame(off));
  };
  /** 合併時已經直接裝好像素的那張（換來源時不用再重建緩衝區） */
  const preinstalledSrcRef = useRef<string | null>(null);
  /** 合併後那張預覽圖的像素（畫布）與網址：換來源時直接拿來建緩衝區 */
  const mergeCanvasRef = useRef<{ url: string; cvs: HTMLCanvasElement } | null>(null);
  /** 合併後的 <img> 還在背景解碼：這段期間不能再合併（要用它當輸入） */
  const mergeImgPendingRef = useRef(false);
  /** 批量時其他照片還在背景合併 */
  const mergeOthersPendingRef = useRef(false);
  /** 合併烤圖期間點的濾鏡／特效：烤完、歸零的狀態套用之後再補上 */
  const pendingTapRef = useRef<null | (() => void)>(null);
  const tapHandlersRef = useRef({ fx: handleEffectToolSelect, lut: handleFilterSelect, none: clearAllEffects });
  tapHandlersRef.current = { fx: handleEffectToolSelect, lut: handleFilterSelect, none: clearAllEffects };
  useEffect(() => {
    if (mergePending || mergingRef.current || !pendingTapRef.current) return;
    const t = pendingTapRef.current; pendingTapRef.current = null; t();
  }, [mergePending]);
  /* 合併通常一瞬間就好，這時候閃一下轉圈反而礙眼。
     只有真的等超過 200ms（要載圖、圖很大）才把轉圈放到預覽正中央。 */
  /** 我們自己換來源（合併／撤銷合併）時立起來：換照片那一整套歸零就跳過 */
  const srcSwapRef = useRef(false);
  /** 換來源時把新的那張圖先解好，緩衝區才能在同一拍換過去（不然畫面會閃一下） */
  const swapToSrc = (next: string[]) => {
    srcSwapRef.current = true;
    setSrcList(next);
  };
  /** 自己造出來的合併圖網址，換掉或離開時要收回去 */
  const mergedUrlsRef = useRef<string[]>([]);
  useEffect(() => () => { mergedUrlsRef.current.forEach(u => { try { URL.revokeObjectURL(u); } catch {} }); }, []);

  /** 現在有沒有東西可以合併：特效或濾鏡任一個有套就算（合併過的都已經歸零） */
  const hasMergeable = hasLiveEffect(params) || (selectedLutIdx > 0 && (params.lutAmount ?? 100) > 0);
  /** 這張在目前這一頁已經合併進去幾個了（撤銷會跟著回去）。
      正在烤的那一次也先算進去 —— 使用者按下去就該看到數字，不用等背景。 */
  const mergedCount = (() => {
    const d = mergeDepthOf(activeSrc);
    const p = mergePending ? mergePendingBakeRef.current : { lut: 0, fx: 0 };
    return activeCategory === 'effects' ? d.fx + p.fx : d.lut + p.lut;
  })();

  /** after：介面照樣立刻切成合併完的樣子；烤圖等它（合併鍵的動畫）結束才開始 */
  const mergeEffects = (after?: Promise<unknown>) => {
    if (!originalImgRef.current || mergingRef.current || mergeImgPendingRef.current || mergeOthersPendingRef.current) return;
    mergingRef.current = true;
    if (isInteracting) setIsInteracting(false);

    /* ── 按下的這一拍，介面就整個切成「合併完」的樣子 ──
       濾鏡／特效回到原始、滑桿收起來、四顆開關關掉、合併鍵變成「已合併N」。
       畫面上的圖還是維持現在的樣子（效果已經在上面了），等背景烤好、
       新的來源圖解碼完再無縫換掉 —— 所以看起來就是「按下去就好了」。

       畫面要能繼續照舊畫，靠的是把這一刻的參數與濾鏡編號凍在 mergeFreezeRef：
       繪圖迴圈認凍住的那一份，介面認已經歸零的 state，兩邊互不干擾。 */
    stashCurrent();
    const live = cloneSnap(liveRef.current!);
    mergePendingBakeRef.current = {
      lut: selectedLutIdx > 0 && (paramsRef.current.lutAmount ?? 100) > 0 ? 1 : 0,
      fx: hasLiveEffect(paramsRef.current) ? 1 : 0,
    };
    mergeFreezeRef.current = { params: paramsRef.current, lutIdx: selectedLutIdx };
    setMergePending(true);

    const uiFresh = JSON.parse(JSON.stringify(DEFAULT_PARAMS)) as EditorParams;
    setParams(uiFresh);
    setSelectedLutIdx(0);
    setIsSoftActive(false); setIsBlurActive(false);
    setIsGrainActive(false); setIsHalationActive(false);
    setSoftManuallyAdjusted(false); setBlurManuallyAdjusted(false);
    setGrainManuallyAdjusted(false); setHalationManuallyAdjusted(false);
    /* 剛剛那個特效／濾鏡已經不在了，它的滑桿也不該再留在下面。
       回到跟點「原始」一樣的位置：特效那一族回柔光、濾鏡頁回強度。
       正在看某個特效的細項時就退回特效清單（那個特效已經沒了）。 */
    if (['effects', 'leak', 'soft', 'halation', 'fx'].includes(activeCategory)) {
      setActiveToolId('softLight');
      if (activeCategory === 'fx') setActiveCategory('effects');
    } else if (activeCategory === 'filter') {
      setActiveToolId('filter_select');
    }

    /* 不放任何動畫也不延遲：按下去就開始烤。
       這一段本來就是同步運算，排 setTimeout 只是多等一輪。 */
    /* ── 畫面上這一張：當場、同步換好 ─────────────────────────────────
       直接拿畫面上現成的結果（GPU 已經畫好的那張）當作新的照片：複製、編成網址、
       裝進緩衝區、參數歸零，全部在這一次點擊裡做完。所以合併後馬上點任何按鈕都會
       立刻套用（不用排隊等背景）。同時蓋上一張定格畫面，直到解碼等收尾都做完才拿開，
       從按下合併到做完，畫面一個像素都不會變。原尺寸那張照舊記成待辦、存檔時才烤。 */
    let syncUrl: string | null = null;
    {
      const i = safeIdx;
      const base = cloneSnap(live);
      const snap0: BatchSnap = {
        ...base,
        params: { ...base.params, ...(ownMaskRef.current[i] || pickMask(DEFAULT_PARAMS)) } as EditorParams,
        geo: ownGeoRef.current[i] ? JSON.parse(JSON.stringify(ownGeoRef.current[i])) : base.geo,
      };
      /* 畫面上那張已經是「裁切後＋濾鏡＋特效」的結果（緩衝區本來就照構圖建），
         所以有裁切也能直接用；只有正在構圖頁（畫面顯示的是未裁切的整張）時不行。
         遮色片的紅色遮罩只是編輯輔助：先同步重畫一張不帶遮罩的，再複製。 */
      if (anyMask(snap0.params) && snap0.params.maskShowOverlay) {
        try { render({ ...paramsRef.current, maskShowOverlay: false }, selectedLutIdx); } catch { /* 重畫失敗就走背景那條 */ }
      }
      const shown = visibleEditorCanvas();
      if (linked[i] !== false && shown && shown.width > 0 && !showOriginalRef.current && activeCategory !== 'compose') {
        let cvs: HTMLCanvasElement | null = document.createElement('canvas');
        cvs.width = shown.width; cvs.height = shown.height;
        cvs.getContext('2d', { willReadFrequently: true })!.drawImage(shown, 0, 0);
        const probe = document.createElement('canvas'); probe.width = probe.height = 8;
        const pg = probe.getContext('2d', { willReadFrequently: true })!;
        pg.drawImage(cvs, 0, 0, 8, 8);
        const d = pg.getImageData(0, 0, 8, 8).data;
        let mx = 0, minA = 255;
        for (let q = 0; q < d.length; q += 4) { mx = Math.max(mx, d[q], d[q + 1], d[q + 2]); minA = Math.min(minA, d[q + 3]); }
        let url = '';
        if (mx > 0 && minA >= 250) { try { url = cvs.toDataURL('image/jpeg', 0.95); } catch { url = ''; } }
        if (url.length > 64) {
          holdFreeze(cvs);
          const { lut: bl, fx: bf } = mergePendingBakeRef.current;
          fullJobsRef.current[url] = { input: srcList[i], snap: cloneSnap(snap0) };
          thumbOriginRef.current[url] = thumbSrcOf(srcList[i]);
          const was = mergeDepthOf(srcList[i]);
          mergeDepthRef.current[url] = { lut: was.lut + bl, fx: was.fx + bf };
          delete ownMaskRef.current[i]; delete ownGeoRef.current[i];
          // 像素直接裝進緩衝區（鍵就是新網址，跟換來源後一致）
          lastProcessedParamsRef.current = { ...lastProcessedParamsRef.current, bufferWidth: 0, selectedLutIdx: -1 } as any;
          lut0StateRef.current = {} as any; lut0CanvasRef.current = null; lut100CanvasRef.current = null;
          buildBuffersFromRef.current(cvs, cvs.width, cvs.height, false, url);
          cvs.width = cvs.height = 0; cvs = null;
          const fresh = JSON.parse(JSON.stringify(DEFAULT_PARAMS)) as EditorParams;
          const freshGeo = { ...DEFAULT_GEO, crop: { ...FULL_CROP } };
          mergeFreezeRef.current = null;
          paramsRef.current = fresh; geoRef.current = freshGeo; setGeo(freshGeo);
          tapFastRef.current = true; isDirtyRef.current = true;
          const next = [...srcList]; next[i] = url;
          preinstalledSrcRef.current = url;
          srcListRef.current = next;
          swapToSrc(next);
          sharedSnapRef.current = null; pendingSnapRef.current = null; pendingSnapSrcRef.current = null;
          mergeImgPendingRef.current = true;
          loadImg(url).then(im => {
            rememberDecoded(url, im);
            if (srcListRef.current[safeIdxRef.current] === url) originalImgRef.current = im;
          }).catch(() => {}).finally(() => { mergeImgPendingRef.current = false; releaseFreeze(); });
          syncUrl = url;
          mergingRef.current = false;          // 之後的點擊照常、立刻套用
          setMergePending(false);
          // 其他連結中的照片也要合併時，交給下面背景那段（不影響畫面）
          const others = srcList.some((_, n) => n !== i && linked[n] !== false);
          if (!others) {
            addToHistory(fresh, 0, false, false, false, false, false, false, false, false);
            return;
          }
          // 其他照片在背景合併：不擋點擊（畫面這張已經好了），只擋再按一次合併與存檔
          mergeOthersPendingRef.current = true;
        }
      }
    }

    (async () => {
      try {
        /* 介面已經在這一拍切成合併完的樣子；烤圖等合併鍵的動畫播完、
           再讓一幀才開始，動畫才不會被烤圖卡在半路。 */
        /* 每一個等待都有時限：任何一個沒回來（動畫被打斷、分頁切到背景），
           合併就會一直卡在「進行中」，之後點的濾鏡／特效全部被排隊、看起來選中卻沒套用。 */
        const race = <T,>(pr: Promise<T>, ms: number) => Promise.race([pr, new Promise<void>(r => setTimeout(r, ms))]);
        if (after && !syncUrl) await race(after, 1000);
        await race(new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0))), 100);
        // 這一次烤進去的是哪一種（按下的當下就記好了，兩邊都套的話兩邊都算）
        const { lut: bakedLut, fx: bakedFx } = mergePendingBakeRef.current;
        const next = [...srcList];
        const made: string[] = [];
        for (let i = 0; i < srcList.length; i++) {
          // 沒連結的那幾張有自己的一份參數，這次合併不關它們的事
          if (linked[i] === false) continue;
          if (syncUrl && i === safeIdx) { next[i] = syncUrl; continue; }   // 這張剛剛已經同步換好了
          const base = cloneSnap(live);
          const snap: BatchSnap = {
            ...base,
            params: { ...base.params, ...(ownMaskRef.current[i] || pickMask(DEFAULT_PARAMS)) } as EditorParams,
            geo: ownGeoRef.current[i]
              ? JSON.parse(JSON.stringify(ownGeoRef.current[i]))
              : (i === safeIdx ? base.geo : { ...DEFAULT_GEO, crop: { ...FULL_CROP } }),
          };
          /* 預覽尺寸那張：畫面上這一張直接複製現成的結果（GPU 已經畫好了，不用再算）；
             其他張（或畫面不是最新的時候）就把來源縮到預覽尺寸再算，成本約原尺寸的五分之一。 */
          let cvs: HTMLCanvasElement | null = null;
          const shown = i === safeIdx ? visibleEditorCanvas() : null;
          if (shown && shown.width > 0 && !isDirtyRef.current && !showOriginalRef.current && isGeoIdentity(snap.geo) && !(anyMask(snap.params) && snap.params.maskShowOverlay)) {
            cvs = document.createElement('canvas'); cvs.width = shown.width; cvs.height = shown.height;
            const cx = cvs.getContext('2d', { willReadFrequently: true })!;
            cx.drawImage(shown, 0, 0);
            /* GPU 畫布在某些時機（剛被收回 context、剛換新畫布）讀出來是全黑／全透明：
               抽樣檢查，讀到空的就不要用（會整個黑掉），改走下面重算的路。 */
            const probe = document.createElement('canvas'); probe.width = probe.height = 8;
            const pg = probe.getContext('2d', { willReadFrequently: true })!;
            pg.drawImage(cvs, 0, 0, 8, 8);
            const d = pg.getImageData(0, 0, 8, 8).data;
            let mx = 0; for (let k = 0; k < d.length; k += 4) mx = Math.max(mx, d[k], d[k + 1], d[k + 2]);
            let minA = 255; for (let k = 3; k < d.length; k += 4) minA = Math.min(minA, d[k]);
            if (mx === 0 || minA < 250) { cvs.width = cvs.height = 0; cvs = null; }
          }
          if (!cvs) {
            const src0 = i === safeIdx && originalImgRef.current ? originalImgRef.current : await loadImg(srcList[i]);
            const ow = src0.naturalWidth || src0.width, oh = src0.naturalHeight || src0.height;
            const k = Math.min(1, 1800 / Math.max(ow, oh));
            const small = document.createElement('canvas');
            small.width = Math.max(1, Math.round(ow * k)); small.height = Math.max(1, Math.round(oh * k));
            small.getContext('2d')!.drawImage(src0, 0, 0, small.width, small.height);
            cvs = renderOneCanvas(small as unknown as HTMLImageElement, snap);
            small.width = small.height = 0;
          }
          /* 走 canvasToUrl 不直接叫 toBlob：iOS 的 toBlob 在畫布很大又碰上
             記憶體吃緊時有機會永遠不回來（見 utils/blobUrl 的看門狗），
             那會讓整批烤圖停在「正在存檔」，而那一層蓋著返回鍵。 */
          /* 預覽用的那張用高品質 JPEG：PNG 編碼在手機上要好幾百毫秒、而且就卡在合併後那一下；
             這張只給畫面用（存檔走原尺寸那條，不受影響）。 */
          const url = await canvasToUrl(cvs, 'image/jpeg', 0.98);
          if (url && i === safeIdx) { mergeCanvasRef.current = { url, cvs }; mergeImgPendingRef.current = true; }
          else cvs.width = cvs.height = 0;
          if (!url) continue;               // 這一張烤不出來就維持原樣，不要留半成品
          made.push(url);
          // 原尺寸那張記成待辦，要用時才烤（resolveFullSrc）
          fullJobsRef.current[url] = { input: srcList[i], snap: cloneSnap(snap) };
          // 縮圖要一直是最初那張的樣子，所以把血緣接上去（可能已經合併過好幾次）
          thumbOriginRef.current[url] = thumbSrcOf(srcList[i]);
          const was = mergeDepthOf(srcList[i]);
          mergeDepthRef.current[url] = { lut: was.lut + bakedLut, fx: was.fx + bakedFx };
          next[i] = url;
          // 這一張的遮色片與構圖也一起烤進去了，留著會再套一次
          delete ownMaskRef.current[i];
          delete ownGeoRef.current[i];
        }
        // 共用的那一份參數已經變成圖了，不能再套回去
        sharedSnapRef.current = null;
        pendingSnapRef.current = null;
        pendingSnapSrcRef.current = null;
        mergedUrlsRef.current.push(...made);

        /* 先把烤好的那張解碼完再換來源。
           不先解好的話，換來源之後緩衝區還是舊的那張、參數卻已經歸零，
           中間就會畫出一張「沒有特效的舊圖」—— 那就是合併時閃的那一下。 */
        if (syncUrl) {
          // 畫面那張早就換好、參數也歸零了；這裡只把其他照片的新網址接上，不碰畫面與參數
          srcListRef.current = next;
          setSrcList(next);
          addToHistory(paramsRef.current, latestEditorDraftRef.current.selectedLutIdx, false, false, false, false, false, false, false, false);
          return;
        }
        const shownUrl = next[safeIdx];
        if (shownUrl && shownUrl !== srcList[safeIdx] && mergeCanvasRef.current?.url !== shownUrl) {
          /* load 之後還要等 decode()（再跨一幀）：iOS 的 load 只代表檔案讀到了，
             這時拿去建緩衝區可能畫進一張透明的 —— 濾鏡／特效縮圖都從緩衝區算，
             於是合併後整排縮圖變黑。 */
          await new Promise<void>(res => {
            const im = new Image();
            im.onload = async () => {
              try { if (typeof im.decode === 'function') await Promise.race([im.decode(), new Promise(r => setTimeout(r, 1500))]); } catch { /* load 已成功 */ }
              await Promise.race([new Promise<void>(r => requestAnimationFrame(() => r())), new Promise(r => setTimeout(r, 100))]);
              rememberDecoded(shownUrl, im); res();
            };
            im.onerror = () => res();
            im.src = shownUrl;
          });
        }

        // 參數整組歸零（效果都烤進圖裡了），四顆開關與濾鏡也一起收乾淨。
        // 介面早就是這個樣子了，這裡是把繪圖那一側也一起解凍。
        const fresh = JSON.parse(JSON.stringify(DEFAULT_PARAMS)) as EditorParams;
        const freshGeo = { ...DEFAULT_GEO, crop: { ...FULL_CROP } };
        mergeFreezeRef.current = null;
        paramsRef.current = fresh;
        geoRef.current = freshGeo;
        isDirtyRef.current = true;
        swapToSrc(next);
        setParams(fresh);
        setGeo(freshGeo);
        setSelectedLutIdx(0);
        setIsSoftActive(false); setIsBlurActive(false);
        setIsGrainActive(false); setIsHalationActive(false);
        setSoftManuallyAdjusted(false); setBlurManuallyAdjusted(false);
        setGrainManuallyAdjusted(false); setHalationManuallyAdjusted(false);
        // 合併是一步操作，撤銷要能把來源與參數一起退回去（srcs 存在歷史裡）
        srcListRef.current = next;
        addToHistory(fresh, 0, false, false, false, false, false, false, false, false);
      } catch (e) {
        console.error('merge failed', e);
        pendingTapRef.current = null;
        if (mergeCanvasRef.current) { mergeCanvasRef.current.cvs.width = mergeCanvasRef.current.cvs.height = 0; mergeCanvasRef.current = null; }
        mergeImgPendingRef.current = false;
        // 烤失敗就把凍住的參數放回去，畫面與介面重新對齊
        const frozen = mergeFreezeRef.current;
        mergeFreezeRef.current = null;
        if (frozen) {
          paramsRef.current = frozen.params;
          setParams(frozen.params);
          setSelectedLutIdx(frozen.lutIdx);
          isDirtyRef.current = true;
        }
      } finally {
        if (!syncUrl) mergingRef.current = false;
        mergeOthersPendingRef.current = false;
        setMergePending(false);
      }
    })();
  };

  /** 眼睛：用現在的參數輸出一張，然後打開 IG 預覽 */
  const openIgPreview = async () => {
    if (!originalImgRef.current || igBusy) return;
    setIgBusy(true);
    try {
      stashCurrent();
      const live = liveRef.current!;
      const snap: BatchSnap = {
        ...cloneSnap(live),
        params: { ...cloneSnap(live).params, ...(ownMaskRef.current[safeIdx] || pickMask(DEFAULT_PARAMS)) } as EditorParams,
        geo: ownGeoRef.current[safeIdx]
          ? JSON.parse(JSON.stringify(ownGeoRef.current[safeIdx]))
          : cloneSnap(live).geo,
      };
      const url = await renderOne(await loadFullImg(srcListRef.current[safeIdx], originalImgRef.current), snap);
      revokeUrls(igShot && igShot !== url ? [igShot] : []);
      setIgShot(url);
      setIgOpen(true);
    } catch (e) { console.error('IG preview failed', e); }
    setIgBusy(false);
  };

  const handleSave = () => {
    if (!originalImgRef.current || saveBusyRef.current || saveState !== 'idle') return;
    saveBusyRef.current = true;
    const request = ++saveRequestRef.current;
    if (isInteracting) setIsInteracting(false);
    setSaveState('processing');
    setTimeout(async () => {
        try {
            // 人像／仿色剛交回來的那張還在背景編碼：先等它換進來源清單
            await studioInstallRef.current;
            // 其他照片還在背景合併時先等它做完（最多 20 秒），存的才會是合併後的
            for (let w = 0; w < 200 && (mergeOthersPendingRef.current || mergingRef.current); w++) await new Promise(r => setTimeout(r, 100));
            // 先把現在畫面上這一份收回去，共用的那一份才會是最新的 ——
            // 不然「調到一半直接按儲存」時，其他連結中的照片會拿到上一次切換時的舊參數。
            stashCurrent();
            const live = liveRef.current!;
            const out: string[] = [];
            const encoded: string[] = [];
            const srcs = srcListRef.current;
            for (let i = 0; i < srcs.length; i++) {
              // 連結中的一律套現在這一份；解除連結的用它自己留下來的那一份。
              // 沒有留下來的（例如從頭到尾沒被切過去過）就直接用現在這一份，
              // 不能因為「還沒載入過」就跳過不套 —— 那就變成沒連結了。
              const base = linked[i] === false ? (soloSnapsRef.current[i] || live) : live;
              // 遮色片與構圖不連動，要用這一張自己的
              const snap: BatchSnap = {
                ...cloneSnap(base),
                params: { ...cloneSnap(base).params, ...(ownMaskRef.current[i] || pickMask(DEFAULT_PARAMS)) } as EditorParams,
                geo: ownGeoRef.current[i]
                  ? JSON.parse(JSON.stringify(ownGeoRef.current[i]))
                  : (i === safeIdx ? cloneSnap(base).geo : { ...DEFAULT_GEO, crop: { ...FULL_CROP } }),
              };
              const img = await loadFullImg(srcs[i], i === safeIdx ? originalImgRef.current : null);
              // Only lowfi exports depend on this LUT; other formats/effects
              // must not be blocked by a lookup-image network failure.
              if (Number(snap.params.fxLowfi) > 0) await warmLowfiLut();
              const canvas = renderOneCanvas(img, snap);
              out.push(await canvasToUrl(canvas, exportFormat === 'jpg' ? 'image/jpeg' : 'image/png', 1));
              if (exportFormat === 'heic') encoded.push(await exportHeic(canvas));
            }
            if (request !== saveRequestRef.current) { revokeUrls([...out, ...encoded]); return; }
            revokeUrls(finalImagesRef.current.filter(u => !out.includes(u)));
            finalImagesRef.current = out;
            revokeUrls(encodedExportsRef.current);
            encodedExportsRef.current = encoded;
            setEncodedExports(encoded);
            setFinalImages(out);
            setFinalImage(out[safeIdx] || out[0]);
            setSaveState('success');
            // 首頁的「最近輸出」：記下成品縮圖＋這張圖導出當下的原圖與參數
            addExport('editor', out[safeIdx] || out[0], srcListRef.current[safeIdx] || imageSrc, {
              params: paramsRef.current, geo, selectedLutIdx,
            }, histKey || undefined);
        } catch (e) { console.error("Save failed", e); if (request === saveRequestRef.current) setSaveState('idle'); }
        finally { if (request === saveRequestRef.current) saveBusyRef.current = false; }
    }, 100);
  };
  
  // ... (activeTool useMemo and remaining UI render logic is identical)
  const activeTool = useMemo(() => {
    if (activeToolId === 'filter_select') {
      if (selectedLutIdx === 0) return null;
      return { id: 'lutAmount' as keyof EditorParams, label: '強度', min: 0, max: 100, step: 0.1 };
    }
    if (activeToolId === 'curves' || isColourPanelTool(activeToolId)) return null; 
    if (activeCategory === 'fx') return (FX_TOOLS[activeFxId] || []).find(t => t.id === activeToolId);
    let tool = [...ADJUST_TOOLS, ...EFFECT_TOOLS].find(t => t.id === activeToolId);
    /* 特效那一頁選中柔光／光暈／漏光時，外層那根滑桿調的是它們各自的強度參數
       （soft／fringeIntensity／leakOpacity）。 */
    if (!tool && activeCategory === 'effects') {
      const card = EFFECT_TOOLS.find(t => effectAmountId(t.id) === activeToolId);
      const src = [...SOFT_LIGHT_TOOLS, ...HALATION_TOOLS, ...LEAK_TOOLS].find(t => t.id === activeToolId);
      if (card && src) tool = { ...src };
    }
    /* 有些特效的「強度」沒有意義（馬賽克調到一半只是把原圖疊回來一半），
       那種在 FX_DEFS 裡設了 rootParam：最外層這根直接改調它指定的參數。
       擺在改標籤之前 —— 這一根的名字要是「格數」，不是「強度」。 */
    if (activeCategory === 'effects') {
      const rootP = FX_ROOT_PARAM[activeToolId];
      if (rootP) return rootP;
    }
    /* 特效最外層那根滑桿一律叫「強度」——
       選中哪一顆卡片，卡片自己已經有白框跟名字了，滑桿上再寫一次特效名字沒有意義。 */
    if (tool && activeCategory === 'effects') tool = { ...tool, label: '強度' };
    if (!tool && activeCategory === 'leak') tool = LEAK_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'soft') tool = SOFT_LIGHT_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'halation') tool = HALATION_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'grain') tool = GRAIN_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'mask') tool = MASK_TOOLS.find(t => t.id === activeToolId) || MASK_TYPE_TOOL_LIST.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'fx') tool = (FX_TOOLS[activeFxId] || []).find(t => t.id === activeToolId);
    return tool;
  }, [activeToolId, selectedLutIdx, activeCategory, activeFxId]);

  /* 進出 HSL 完全不做動畫。面板本身是直接掛上／拿掉，但滑桿列收合是 CSS
     transition，得知道「這一次 render 是不是跟 HSL 有關」才能把時間關掉：
     ref 在 effect 裡才更新，所以離開 HSL 的那一次 render 讀到的還是舊值。 */
  const prevToolIdRef = useRef(activeToolId);
  const hslSwitch = isColourPanelTool(activeToolId) || isColourPanelTool(prevToolIdRef.current);
  /* 從 HSL 直接切到曲線時，曲線不做入場 —— HSL 那一側本來就是瞬間收掉的，
     曲線再慢慢長出來會像是「面板閃了一下又重來」。ref 在 effect 裡才更新，
     所以切過去的那一次 render 讀到的還是 hsl，剛好就是要關掉動畫的那一次。 */
  useEffect(() => { prevToolIdRef.current = activeToolId; }, [activeToolId]);

  /* HSL 的面板是蓋在預覽上的，會擋掉圖片下半部（量到 414×896 遮 34%、
     375×667 遮 58%）。進 HSL 時把圖縮小並上移，讓整張圖剛好落在面板上方。

     不寫死數字：直接量預覽區與面板的實際位置換算 ——
       maxHeight   = 面板上緣 - 內容區上緣      （縮到塞得下）
       marginBottom= 內容區下緣 - 面板上緣      （被蓋住的那一段）
     marginBottom 會被 flex 的置中一起算進去，等於把圖改成在「沒被蓋住的
     那塊區域」置中，跟圖多高無關。用 useLayoutEffect 是為了在同一次繪製前
     就把值算好，不會先閃一下原尺寸。ResizeObserver 負責轉向／視窗變化。 */
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [previewBoxSize, setPreviewBoxSize] = useState({ width: 0, height: 0 });
  const [previewLayoutReady, setPreviewLayoutReady] = useState(false);
  /* 預覽區在螢幕上的實際位置（不四捨五入）：構圖、人像、仿色要把圖放在跟編輯器一模一樣的像素上 */
  const [previewBoxClient, setPreviewBoxClient] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  /* 以預覽區「實際剩餘尺寸」限制圖片，而不是用 100vh 猜工具列高度。
     這樣超長直圖也一定完整落在上下安全距離內，不會被底欄或頂欄裁掉。 */
  useLayoutEffect(() => {
    const box = previewBoxRef.current;
    if (!box) return;
    let settleTimer = 0;
    let lastW = -1;
    let lastH = -1;
    const measure = () => {
      const rect = box.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setPreviewBoxClient(prev => prev && prev.left === rect.left && prev.top === rect.top && prev.width === rect.width && prev.height === rect.height
        ? prev : { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      if (next.width === lastW && next.height === lastH) return;
      lastW = next.width;
      lastH = next.height;
      setPreviewLayoutReady(false);
      setPreviewBoxSize(prev => prev.width === next.width && prev.height === next.height ? prev : next);
      window.clearTimeout(settleTimer);
      /* iOS 安裝版會在 safe-area 與動態樣式套妥後再送一次 ResizeObserver。
         連續 80ms 沒再改尺寸才發布預覽，兩次量測都只發生在全黑解析層後面。 */
      settleTimer = window.setTimeout(() => setPreviewLayoutReady(true), 80);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => { ro.disconnect(); window.clearTimeout(settleTimer); };
  }, []);

  /* 預覽的縮放／平移（雙指放大、拖動）。
     進遮色片時要把它「流暢地」推回原本的大小與位置：遮色片是畫在圖上的，
     使用者放大過或推到一邊之後才進來的話，畫面對不上、也不好下筆。
     resetTransform 自己會判斷「本來就在原位就不動」，所以沒縮放過的人
     不會看到任何動畫。 */
  const zoomRef = useRef<ReactZoomPanPinchRef | null>(null);
  /** 遮色片頁：取消選中（而且不是在選新種類）時預覽可以縮放；一選回某個遮色片就推回原位 */
  const maskZoomable = activeCategory === 'mask' && maskDeselected && !maskPicking;
  useEffect(() => {
    if (activeCategory !== 'mask' || maskZoomable) return;
    // 這一頁的縮放是關掉的（disabled），但這支 API 不看那個開關，照樣推得回去
    zoomRef.current?.resetTransform(320, 'easeOut');
  }, [activeCategory, maskZoomable]);

  /* ── 色輪：拖曳中只寫 paramsRef，放手才進 state 與復原紀錄 ── */
  const onGradeChange = useCallback((g: ColorGrade) => {
    const cur = paramsRef.current;
    paramsRef.current = { ...cur, grade: g } as EditorParams;
    isDirtyRef.current = true;
    lastSliderMoveTimeRef.current = performance.now();
  }, []);
  const onGradeStart = useCallback(() => setupFastPreview(activeToolIdRef.current), [setupFastPreview]);
  const commitGradeRef = useRef<() => void>(() => {});
  commitGradeRef.current = () => {
    setIsInteracting(false);
    fastPreviewCacheRef.current.active = false;
    setParams({ ...paramsRef.current });
    addToHistory(paramsRef.current, selectedLutIdx);
  };
  const onGradeCommit = useCallback(() => commitGradeRef.current(), []);

  const [hslFit, setHslFit] = useState<{ mb: number; mh: number; colour: boolean } | null>(null);
  const measureHslFit = useCallback(() => {
    const box = previewBoxRef.current;
    const panel = detailPanelHost?.querySelector(isColourPanelTool(activeToolIdRef.current) ? '[data-hsl-panel]' : '[data-curves-panel]') as HTMLElement | null;
    if (!box || !panel) return;
    const b = box.getBoundingClientRect();
    const panelTop = detailPanelHost!.getBoundingClientRect().top - panel.offsetHeight - (activeToolIdRef.current === 'curves' ? 12 : 0);
    const PAD = 16;   // TransformComponent 的 p-4
    const GAP = 8;    // 別讓圖整個貼在面板上緣，貼著看起來像破圖
    const mb = Math.max(0, Math.round(b.bottom - PAD - panelTop + GAP));
    const mh = Math.max(120, Math.round(panelTop - GAP - (b.top + PAD)));
    const colour = isColourPanelTool(activeToolIdRef.current);
    setHslFit(prev => (prev && prev.mb === mb && prev.mh === mh && prev.colour === colour) ? prev : { mb, mh, colour });
  }, [detailPanelHost]);
  useLayoutEffect(() => {
    if (!isColourPanelTool(activeToolId) && activeToolId !== 'curves') { setHslFit(prev => (prev ? null : prev)); return; }
    measureHslFit();
    const box = previewBoxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureHslFit());
    ro.observe(box);
    return () => ro.disconnect();
  }, [activeToolId, measureHslFit]);
  /* 直接綁 activeToolId 而不是等 state 被清掉：離開 HSL 時 state 要下一次
     render 才會變成 null，而那一次 render 的 hslSwitch 已經翻回 false，
     尺寸就會用 500ms 補間跑回去。用這個值的話同一次 render 就還原了。 */
  /* 只認 HSL／色輪自己量出來的那一份：從曲線切過來時，state 裡還是曲線面板量的值，
     拿來用會先縮成曲線的大小、下一格再縮成 HSL 的大小 —— 就是「跳一下」 */
  const hslFitNow = isColourPanelTool(activeToolId) && hslFit?.colour ? hslFit : null;
  /* 前後對比鍵：面板剛掛上、還沒量好的那一格，先用上一次 HSL／色輪量到的位置（面板高度固定，位置一樣），
     從曲線切過來時才不會先掉到預設位置再往上爬 */
  const lastColourFitRef = useRef<{ mb: number; mh: number } | null>(null);
  if (hslFitNow) lastColourFitRef.current = hslFitNow;
  const cmpFit = hslFitNow || (isColourPanelTool(activeToolId) ? lastColourFitRef.current : null);

  /* iOS WebKit 對「width:100% + aspect-ratio + max-width + max-height」會做兩次
     constraint pass。長圖特別明顯：先按寬度放大，再被高度上限夾小。
     先算成唯一的整數像素尺寸，瀏覽器從第一幀到最後一幀都只拿到同一個盒子。 */
  const previewFitSize = useMemo(() => {
    if (!previewAspect || !previewBoxSize.width || !previewBoxSize.height) return null;
    const maxW = Math.max(1, previewBoxSize.width - 32);
    const maxH = Math.max(1, hslFitNow ? hslFitNow.mh : previewBoxSize.height - 32);
    const scale = Math.min(maxW / previewAspect.w, maxH / previewAspect.h);
    return {
      width: Math.max(1, Math.round(previewAspect.w * scale)),
      height: Math.max(1, Math.round(previewAspect.h * scale)),
    };
  }, [previewAspect, previewBoxSize, hslFitNow]);

  /* 一般狀態（沒有 HSL／色輪面板）下預覽圖在螢幕上的框。構圖、人像、仿色照這個框擺圖，
     切過去時圖片連半個像素都不會動 */
  const previewAlign = useMemo(() => {
    if (!previewAspect || !previewBoxClient || !previewBoxSize.width || !previewBoxSize.height) return null;
    const maxW = Math.max(1, previewBoxSize.width - 32), maxH = Math.max(1, previewBoxSize.height - 32);
    const scale = Math.min(maxW / previewAspect.w, maxH / previewAspect.h);
    const width = Math.max(1, Math.round(previewAspect.w * scale)), height = Math.max(1, Math.round(previewAspect.h * scale));
    const b = previewBoxClient;
    return { left: b.left + (b.width - width) / 2, top: b.top + (b.height - height) / 2, width, height };
  }, [previewAspect, previewBoxSize, previewBoxClient]);

  /* 進出 HSL／色輪時圖片縮放的過場：以前直接對寬、高、下邊距做 CSS transition，
     260ms 裡每一幀都重新排版，畫布的 ResizeObserver 也每一幀都回報 → 整個編輯器
     每一幀 render 一次，手機上就是偶爾卡一下。改成 FLIP：尺寸一次到位（只排版、
     只回報一次），再用 transform 從舊的位置大小補回去，補間完全交給合成器。 */
  const lastFitRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = previewFitRef.current; if (!el) return;
    const prev = lastFitRectRef.current;
    el.style.transition = 'none'; el.style.transform = '';
    const r = el.getBoundingClientRect();
    lastFitRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
    if (!prev || !hslSwitch || activeCategory === 'compose' || !prev.width || !r.width || !el.offsetWidth) return;
    if (Math.abs(prev.left - r.left) < 0.5 && Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5) return;
    const z = r.width / el.offsetWidth;   // 外層縮放（使用者放大預覽時）
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${(prev.left - r.left) / z}px,${(prev.top - r.top) / z}px) scale(${prev.width / r.width},${prev.height / r.height})`;
    void el.offsetWidth;
    el.style.transition = 'transform 260ms cubic-bezier(.22,1,.36,1)';
    el.style.transform = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFitSize, hslFitNow?.mb]);

  /* 底部功能欄哪幾列要收起來。構圖現在不再是另外開一頁 —— ComposeStudio 只蓋住
     預覽區，分頁列照樣留在原位，所以滑桿列與小分類列都讓給它自己那兩排。 */
  /* 進出構圖不做高度補間。ComposeStudio 是預覽區的 absolute inset-0，
     底部欄如果花 380ms 慢慢收起來，預覽區的下緣就會一路往下滑（量到 17 個
     不同高度、下緣 642→815），看起來就是「從上往下長出來」；而且 ComposeStudio
     的 ResizeObserver 會跟著重算舞台，量到 18 種尺寸 —— 那就是抖動。
     一步到位之後預覽區只有一個尺寸，舞台也只量一次。 */
  const prevCategoryRef = useRef(activeCategory);
  const composeSwitch = activeCategory === 'compose' || prevCategoryRef.current === 'compose';
  useEffect(() => { prevCategoryRef.current = activeCategory; }, [activeCategory]);

  /* 進出特效細項也完全不做動畫（柔光／光暈／漏光／新特效都一樣）。
     跟 HSL 同一個做法：ref 要等 effect 才更新，所以「離開的那一次 render」
     讀到的還是舊分頁 —— 剛好就是要把時間關掉的那一次。 */
  const DETAIL_CATS = ['fx', 'soft', 'leak', 'halation'];
  const detailSwitch = DETAIL_CATS.includes(activeCategory) || DETAIL_CATS.includes(prevCategoryRef.current);

  /* 遮色片还没建立时，版面跟建立后保持一致，只锁住暂时不能使用的控制项。 */
  /* 拖遮色片形狀時 params 這份 state 不會每一步更新（參考線直接改屬性），
     拖曳中若有別的原因 render，參考線要照最新的位置畫，不能跳回按下去那一刻 */
  const maskView = activeDragRef.current ? paramsRef.current : params;
  const maskListView = maskList(maskView);
  /** 這張照片有沒有任何遮色片（含剛新增、還沒畫出來的那一個）。沒有的話先選要新增哪一種 */
  const maskHasAny = maskListView.list.length > 0 || !!params.masks?.length;
  /* 還沒畫出遮色片時，九個調整先不能動（不知道要調哪裡）；筆刷大小這些參數照樣可以先調 */
  const maskLocked = activeCategory === 'mask' && (!params.maskCreated || maskDeselected) && MASK_TOOLS.some(t => t.id === activeToolId);
  /* ── 人像（美顏）與仿色：直接用那兩個工具本身，蓋在編輯器上 ─────────────
     它們改的是「照片本身」：做完換成新的來源圖，濾鏡、調節這些參數照樣疊在上面、還能再調。
     切去別的分頁就自動套用；套用也是一步，可以復原。 */
  const studioCommitRef = useRef<(() => StudioResult | null) | null>(null);
  /* 換上工具交回來的預覽尺寸成品：跟「合併」同一招 —— 像素直接裝進緩衝區、當場換好，
     原尺寸那張記成待辦（存檔時才由那個工具重播）。濾鏡、調節這些參數不動，照樣疊在上面。
     所以按「完成」或切去別的分頁都是立刻的，不用等算圖。 */
  /* 兩段：
     一、按下去的這一拍：像素直接裝進緩衝區（暫用一個代號當鍵），畫面當場就是新的；
     二、背景把它編成 JPEG（toBlob 不擋主執行緒，toDataURL 同步要兩三百毫秒 —— 就是以前切分頁卡一下的元兇），
        好了才把來源清單換成那個網址。存檔會先等這一段做完。 */
  const studioInstallRef = useRef<Promise<void>>(Promise.resolve());
  /** 每個工具（beauty／match）這一次掛上來最後交出去的那張（工具看到自己交出去的照片回來，不用重開） */
  const studioLastOutRef = useRef<Record<string, string>>({});
  const pendingKeySeqRef = useRef(0);
  const installStudioResult = (res: StudioResult) => {
    const i = safeIdxRef.current;
    const cvs = res.preview;
    const was = srcListRef.current[i];
    const pend = `${was}#studio${++pendingKeySeqRef.current}`;
    const prevJob = fullJobsRef.current[was];
    // 同一個工具連續交好幾次：原尺寸那張永遠從這個工具一開始拿到的那張重播，不會重複套
    const input = res.session && prevJob?.session === res.session ? prevJob.input : was;
    thumbOriginRef.current[pend] = thumbSrcOf(input);
    const g = geoRef.current;
    const src: CanvasImageSource = isGeoIdentity(g) ? cvs : composeCanvas(cvs, cvs.width, cvs.height, g, 2400);
    const w = isGeoIdentity(g) ? cvs.width : (src as HTMLCanvasElement).width;
    const h = isGeoIdentity(g) ? cvs.height : (src as HTMLCanvasElement).height;
    lastProcessedParamsRef.current = { ...lastProcessedParamsRef.current, bufferWidth: 0, selectedLutIdx: -1 } as any;
    lut0StateRef.current = {} as any; lut0CanvasRef.current = null; lut100CanvasRef.current = null;
    bufferAliasRef.current = { key: pend, for: was };
    buildBuffersFromRef.current(src, w, h, false, pend);
    tapFastRef.current = true; isDirtyRef.current = true;
    const before = studioInstallRef.current;
    studioInstallRef.current = (async () => {
      await before;
      const blob = await new Promise<Blob | null>(r => { try { cvs.toBlob(r, 'image/jpeg', 0.95); } catch { r(null); } });
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      mergedUrlsRef.current.push(url);
      fullJobsRef.current[url] = { input, bake: res.bake, session: res.session };
      thumbOriginRef.current[url] = thumbSrcOf(input);
      const kind = res.session?.split('-')[0];
      if (kind) studioLastOutRef.current[kind] = url;
      const cur = srcListRef.current;
      if (cur[i] !== was) return;          // 這段時間照片被換掉了（復原、換別張）：這次就作廢
      const next = [...cur]; next[i] = url;
      srcListRef.current = next;
      if (safeIdxRef.current === i && buffersSrcRef.current === pend) {
        // 同一批像素換個名字而已：GPU 那邊認的編號沿用，不用再上傳一次整張貼圖
        SRC_IDS.set(url, srcIdOf(pend));
        buffersSrcRef.current = url;
        bufferAliasRef.current = null;
        preinstalledSrcRef.current = url;
        swapToSrc(next);
      } else setSrcList(next);
      loadImg(url).then(im => {
        rememberDecoded(url, im);
        if (srcListRef.current[safeIdxRef.current] === url) originalImgRef.current = im;
      }).catch(() => {});
      addToHistory(paramsRef.current, selectedLutIdxNowRef.current);
    })().catch(() => {});
  };
  const studioPrevRef = useRef<{ cat: Category; tool: string }>({ cat: 'filter', tool: 'filter_select' });
  const [matchRefSrc, setMatchRefSrc] = useState<string | null>(null);
  const matchRefInputRef = useRef<HTMLInputElement>(null);
  /* 取消＝丟掉這次在工具裡畫的東西：工具一直掛著（進出才會是立刻的），所以換一個新的 */
  const [studioGen, setStudioGen] = useState({ beauty: 0, match: 0 });
  const backFromStudio = () => {
    const { cat, tool } = studioPrevRef.current;
    setActiveCategory(cat); setActiveToolId(tool);
  };
  const studioActs = useRef({ done: (_r: StudioResult | null) => {}, cancel: () => {} });
  studioActs.current.done = (r) => { if (r) installStudioResult(r); backFromStudio(); };
  studioActs.current.cancel = () => {
    const k = activeCategory === 'match' ? 'match' : 'beauty';
    // 取消＝這個工具從現在這張照片重新開始（之前交出去的已經是照片的一部分了）
    delete studioLastOutRef.current[k];
    setStudioSrc(v => ({ ...v, [k]: activeSrc }));
    setStudioGen(g => ({ ...g, [k]: g[k] + 1 }));
    backFromStudio();
  };
  /* 傳給工具的東西都要固定不變：工具一直掛在後面，編輯器每 render 一次它就跟著 render 的話會拖慢編輯器 */
  const studioEmbed = useMemo(() => ({
    commitRef: studioCommitRef,
    onDone: (r: StudioResult | null) => studioActs.current.done(r),
    onCancel: () => studioActs.current.cancel(),
  }), []);
  const studioNoop = useCallback(() => {}, []);
  const pickMatchRef = useCallback(() => matchRefInputRef.current?.click(), []);
  const leaveCategory = (next: () => void) => {
    const commit = STUDIO_CATS.includes(activeCategory) ? studioCommitRef.current : null;
    const res = commit ? commit() : null;
    if (res) installStudioResult(res);
    next();
  };
  /* 主頁進來的編輯：照片載好、閒下來就先把美顏與仿色掛上（藏在後面），第一次點進去就不用等它解析 */
  const [studiosWarm, setStudiosWarm] = useState(false);
  useEffect(() => {
    if (!fullTabs || studiosWarm || isEditorLoading) return;
    const ric = (window as any).requestIdleCallback as ((f: () => void, o?: any) => number) | undefined;
    const id = ric ? ric(() => setStudiosWarm(true), { timeout: 800 }) : window.setTimeout(() => setStudiosWarm(true), 400);
    return () => { if (ric) (window as any).cancelIdleCallback?.(id); else clearTimeout(id); };
  }, [fullTabs, studiosWarm, isEditorLoading]);
  /* 人像／仿色拿到的對齊框：構圖改過比例的話它們顯示的是原圖，比例對不上就自己置中（studioAlign 會判斷） */
  const studioAlign = useMemo(() => previewAlign,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewAlign?.left, previewAlign?.top, previewAlign?.width, previewAlign?.height]);
  /* 兩個工具各自記得自己是拿哪一張照片開的。照片換成「它自己剛交出去的那張」時不用重開
     （工具裡的狀態本來就是那張）；被別的東西換掉（換照片、復原、另一個工具交圖）才重開 ——
     而且是藏在後面時等閒下來才重開，不會跟使用者正在做的事搶主執行緒。 */
  const [studioSrc, setStudioSrc] = useState<{ beauty: string; match: string }>(() => ({ beauty: activeSrc, match: activeSrc }));
  const studioWant = (k: 'beauty' | 'match') =>
    studioSrc[k] === activeSrc || studioLastOutRef.current[k] === activeSrc ? studioSrc[k] : activeSrc;
  const beautySrc = activeCategory === 'beauty' ? studioWant('beauty') : studioSrc.beauty;
  const matchSrc = activeCategory === 'match' ? studioWant('match') : studioSrc.match;
  useEffect(() => {
    const stale = (['beauty', 'match'] as const).filter(k => studioWant(k) !== studioSrc[k]);
    if (!stale.length) return;
    const apply = (ks: readonly ('beauty' | 'match')[]) => setStudioSrc(v => {
      const n = { ...v };
      for (const k of ks) { n[k] = activeSrc; delete studioLastOutRef.current[k]; }
      return n;
    });
    const now = stale.filter(k => k === activeCategory), later = stale.filter(k => k !== activeCategory);
    if (now.length) apply(now);
    if (!later.length) return;
    const ric = (window as any).requestIdleCallback as ((f: () => void, o?: any) => number) | undefined;
    /* 藏在後面的工具重新載入很重（人像要解析整張臉、仿色要重建貼圖）。多圖編輯時連續切照片，
       每切一次就重載一次的話，下一次切換就會卡在它後面。所以等使用者在這張停一下（1.2 秒）、
       主執行緒也閒著了才重載；就算之前直接點進去，也有「畫好才翻過去」那一層接著，不會黑。 */
    let id = 0;
    const t = window.setTimeout(() => { id = ric ? ric(() => apply(later), { timeout: 2500 }) : window.setTimeout(() => apply(later), 0); }, 1200);
    return () => { clearTimeout(t); if (id) { if (ric) (window as any).cancelIdleCallback?.(id); else clearTimeout(id); } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSrc, activeCategory, studioSrc]);
  /* 工具重新掛上（換了照片、第一次進去）的那一下，它的照片還沒解碼好，整塊是黑的。
     記下每個工具「這一份」是不是已經畫出照片了；還沒的話先不把它翻到前面，
     下面編輯器自己的預覽（同一個框）繼續顯示，畫好的那一格才換過去。 */
  const beautyKey = `beauty-${beautySrc}-${studioGen.beauty}`, matchKey = `match-${matchSrc}-${studioGen.match}`;
  const [studioPainted, setStudioPainted] = useState<{ beauty: string; match: string }>({ beauty: '', match: '' });
  const beautyPainted = useCallback(() => setStudioPainted(v => v.beauty === beautyKey ? v : { ...v, beauty: beautyKey }), [beautyKey]);
  const matchPainted = useCallback(() => setStudioPainted(v => v.match === matchKey ? v : { ...v, match: matchKey }), [matchKey]);
  /* 保底：真的一直沒回報（例如圖解不開）也不能卡在編輯器畫面 */
  const [studioForce, setStudioForce] = useState('');
  const studioWaitKey = activeCategory === 'beauty' ? beautyKey : activeCategory === 'match' ? matchKey : '';
  useEffect(() => {
    if (!studioWaitKey) return;
    const t = window.setTimeout(() => setStudioForce(studioWaitKey), 700);
    return () => clearTimeout(t);
  }, [studioWaitKey]);
  const studioShown = (k: 'beauty' | 'match') => activeCategory === k
    && (studioPainted[k] === (k === 'beauty' ? beautyKey : matchKey) || studioForce === (k === 'beauty' ? beautyKey : matchKey));
  const beautyEl = useMemo(() => (
    <BeautyStudio key={beautyKey} imageSrc={beautySrc} embedded={studioEmbed} align={studioAlign} onPainted={beautyPainted}
      onCancel={studioNoop} onHome={studioNoop} onImportNew={studioNoop} onSendToEditor={studioNoop} />
  ), [beautyKey, beautySrc, studioEmbed, studioNoop, studioAlign, beautyPainted]);
  const matchEl = useMemo(() => (
    <ColorMatchStudio key={matchKey} imageSrc={matchSrc} embedded={studioEmbed} align={studioAlign} onPainted={matchPainted}
      referenceSrc={matchRefSrc} onPickReference={pickMatchRef}
      onCancel={studioNoop} onHome={studioNoop} onImportNew={studioNoop} />
  ), [matchKey, matchSrc, matchRefSrc, studioEmbed, studioNoop, pickMatchRef, studioAlign, matchPainted]);

  /** 模板與疊圖層分頁：滑桿列與小分類列都收起來，整塊控制區給它自己的面板 */
  const ownPanel = activeCategory === 'template' || STUDIO_CATS.includes(activeCategory);
  /** 遮色片在選新增哪一種的時候，滑桿列先收起來（沒有東西可以調） */
  /* 取消選中時，下面那一排直接變成「新增遮色片」的五種（不是一排變暗、按不了的調整） */
  const maskTypePicking = activeCategory === 'mask' && (maskPicking || !maskHasAny || maskDeselected);
  /** 左下角的參數膠囊：只有「選中了某個遮色片」時才出現（選種類、取消選中時都收掉），線性漸層沒有自己的參數 */
  const maskCapsuleShown = false && activeCategory === 'mask' && !maskTypePicking && !maskDeselected && maskListView.list.length > 0
    && (MASK_TYPE_TOOLS[(params.maskType ?? 'linear') as MaskType].length > 0 || params.maskType === 'brush');
  const sliderRowHidden = activeToolId === 'curves' || isColourPanelTool(activeToolId) || activeCategory === 'compose' || ownPanel || maskTypePicking;
  const subStripHidden = activeCategory === 'compose' || ownPanel;


  // Every effect detail page uses the same fixed slider + parameter strip.
  /* 從構圖直接切到別的分頁 ＝ 等同按了「完成」，裁切照樣套用。
     只有明確按「取消」才會丟掉（onCancel 會先把 draftGeo 清成 null，
     所以這個 effect 不會重複套一次）。 */
  useEffect(() => {
    if (activeCategory !== 'compose' && draftGeo) {
      if (applyGeo(draftGeo)) addToHistory(paramsRef.current, selectedLutIdx);
      setDraftGeo(null);
      releaseComposePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, draftGeo]);

  /* 進構圖之前待在哪一頁 —— 按完成之後回去那一頁，不要一律跳回濾鏡 */
  const beforeComposeRef = useRef<{ cat: Category; tool: string }>({ cat: 'filter', tool: 'filter_select' });

  /** 左上返回与构图内的取消共用同一条“放弃草稿几何”路径。
      先同步清空 draft，再切回进入构图前的分页，避免离开构图的自动套用 effect
      在同一批更新中读到旧 draft，并确保它绝不会继续冒泡成退出整个编辑器。 */
  const cancelCompose = useCallback(() => {
    const previous = beforeComposeRef.current;
    releaseComposePreview();
    flushSync(() => setDraftGeo(null));
    setActiveCategory(previous.cat);
    setActiveToolId(previous.tool);
  }, []);

  const isParamAdjusted = useCallback((id: string): boolean => {
    /* GLSL 特效：跟柔光／光暈同一套規則 —— 強度是 0 就整組都不亮白點，
       不管細項被動過沒有。細項本身則是「跟預設不同才算」，而且最小值不是 0 的
       那幾個（格數之類，0 會變成除以零）停在最小值時也不算調整過。 */
    const fxOwner = FX_OWNER[id];
    if (fxOwner) {
      if ((params[fxOwner.id] || 0) === 0) return false;
      if (id === fxOwner.id) return true;
      const pd = fxOwner.params.find(x => x.id === id);
      if (!pd) return false;
      const v = params[id];
      if (v === pd.def) return false;
      if (pd.min > 0 && v === pd.min) return false;
      return true;
    }
    if (id === 'curves') {
      return JSON.stringify(params.curves) !== JSON.stringify(DEFAULT_CURVES);
    }
    if (id === 'hsl') {
      return !isHslIdentity(params.hsl);
    }
    if (id === 'grade') {
      return !isGradeToolIdentity(params.grade, 'wheels') || !isGradeToolIdentity(params.grade, 'hdr');
    }
    if (id === 'softLight' || id === 'soft' || id === 'softThreshold' || id === 'softRadius' || id === 'softColor') {
      if (params.soft === 0) return false;
      if (id === 'softLight') {
        return params.soft !== DEFAULT_PARAMS.soft || 
               params.softThreshold !== DEFAULT_PARAMS.softThreshold ||
               params.softRadius !== DEFAULT_PARAMS.softRadius ||
               params.softColor !== DEFAULT_PARAMS.softColor;
      }
      const val = params[id as keyof EditorParams];
      const def = DEFAULT_PARAMS[id as keyof EditorParams];
      return val !== undefined && def !== undefined && val !== def;
    }
    if (id === 'halation' || id === 'fringeIntensity' || id === 'fringeHue' || id === 'fringeSize' || id === 'fringeFeather') {
      if (params.fringeIntensity === 0) return false;
      if (id === 'halation') {
        return params.fringeIntensity !== DEFAULT_PARAMS.fringeIntensity ||
               params.fringeHue !== DEFAULT_PARAMS.fringeHue ||
               params.fringeSize !== DEFAULT_PARAMS.fringeSize ||
               params.fringeFeather !== DEFAULT_PARAMS.fringeFeather;
      }
      const val = params[id as keyof EditorParams];
      const def = DEFAULT_PARAMS[id as keyof EditorParams];
      return val !== undefined && def !== undefined && val !== def;
    }
    if (id === 'lightLeak' || id === 'leakOpacity' || id === 'leakAngle' || id === 'leakHue') {
      if (params.leakOpacity === 0) return false;
      if (id === 'lightLeak') {
        return params.leakOpacity !== DEFAULT_PARAMS.leakOpacity ||
               params.leakAngle !== DEFAULT_PARAMS.leakAngle ||
               params.leakHue !== DEFAULT_PARAMS.leakHue;
      }
      const val = params[id as keyof EditorParams];
      const def = DEFAULT_PARAMS[id as keyof EditorParams];
      return val !== undefined && def !== undefined && val !== def;
    }
    const val = params[id as keyof EditorParams];
    const def = DEFAULT_PARAMS[id as keyof EditorParams];
    if (val !== undefined && def !== undefined) {
      return val !== def;
    }
    return false;
  }, [params]);

  const handleCurveStartDrag = (e: React.MouseEvent | React.TouchEvent, idx: number) => {
      e.stopPropagation();
      setDragPointIdx(idx);
      setIsInteracting(true);
      lastRenderDurationRef.current = 12; // Reset duration to prevent slow throttle carry-over
  };
  
  const handleCurveMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (dragPointIdx === -1) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const svg = document.getElementById('curvesSvg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    let x = Math.max(0, Math.min(200, Math.round((clientX - rect.left) * (200 / rect.width))));
    let y = Math.max(0, Math.min(200, Math.round(200 - (clientY - rect.top) * (200 / rect.height))));
    const x255 = (x / 200) * 255;
    const currentPoints = [...paramsRef.current.curves[currentCurveChannel]];
    if (dragPointIdx > 0 && x255 <= currentPoints[dragPointIdx - 1].x) x = (currentPoints[dragPointIdx - 1].x / 255) * 200 + 1;
    if (dragPointIdx < currentPoints.length - 1 && x255 >= currentPoints[dragPointIdx + 1].x) x = (currentPoints[dragPointIdx + 1].x / 255) * 200 - 1;
    const newPoints = [...currentPoints];
    newPoints[dragPointIdx] = { x: (x / 200) * 255, y: (y / 200) * 255 };
    const newCurves = { ...paramsRef.current.curves, [currentCurveChannel]: newPoints };
    paramsRef.current = { ...paramsRef.current, curves: newCurves };
    isDirtyRef.current = true;
    /* Do not re-render the editor per move: that rebuilt the whole React tree
       (~every panel) on each frame and was what made curves unusable. The
       canvas loop reads paramsRef; the curve graphic is updated in place and
       React state is written once, on release (handleCurveEndDrag). */
    paintCurveSvg(newPoints);
  };
  const curvePathRef = useRef<SVGPathElement | null>(null);
  const paintCurveSvg = (pts: { x: number; y: number }[]) => {
    curvePathRef.current?.setAttribute('d', boundedCurvePath(pts, getSplineY));
    const dots = document.querySelectorAll<SVGCircleElement>('#curvesSvg circle.curve-point');
    pts.forEach((p, i) => { const d = dots[i]; if (d) { d.setAttribute('cx', String((p.x / 255) * 200)); d.setAttribute('cy', String(200 - (p.y / 255) * 200)); } });
  };
  
  const handleCurveEndDrag = () => {
      flushParamsSync();
      setDragPointIdx(-1);
      setIsInteracting(false);
      addToHistory(paramsRef.current, selectedLutIdx);
  };

  /* 手機上一次點擊會先送觸控、再補送一次模擬的滑鼠按下：兩個都算的話，
     「點一下」會被當成點兩下（節點被誤刪），真的點兩下反而對不上。
     觸控之後 800ms 內的滑鼠事件一律當成那一次觸控的補送，直接忽略。
     時間一律用事件自己的 timeStamp（手指碰到的那一刻），不用「處理到的時間」：
     第一下之後畫面正在重畫、第二下晚一點才被處理，用處理時間算就會以為隔了很久。 */
  const curveTouchAtRef = useRef(0);
  const curveTapIdxRef = useRef(-1);
  const isGhostMouse = (e: React.MouseEvent | React.TouchEvent) => {
      if ('touches' in e) { curveTouchAtRef.current = e.timeStamp; return false; }
      return e.timeStamp - curveTouchAtRef.current < 800;
  };
  const handlePointTap = (e: React.MouseEvent | React.TouchEvent, idx: number) => {
      e.stopPropagation();
      if (isGhostMouse(e)) return;
      const now = e.timeStamp;
      const isRecentCreate = lastCreatedIdxRef.current === idx && (now - lastCreatedTimeRef.current < 350);
      // 點兩下（同一個節點、300ms 內）＝刪掉這個節點；兩端的節點不能刪
      if (!isRecentCreate && curveTapIdxRef.current === idx && (now - lastCurveTapRef.current < 300)) {
          const currentPoints = [...params.curves[currentCurveChannel]];
          if (currentPoints.length > 2 && idx > 0 && idx < currentPoints.length - 1) {
              currentPoints.splice(idx, 1);
              const newCurves = { ...params.curves, [currentCurveChannel]: currentPoints };
              setParams(prev => ({ ...prev, curves: newCurves }));
              addToHistory({ ...params, curves: newCurves }, selectedLutIdx);
          }
          lastCurveTapRef.current = 0;
          curveTapIdxRef.current = -1;
      } else {
          lastCurveTapRef.current = now;
          curveTapIdxRef.current = idx;
          handleCurveStartDrag(e, idx);
      }
  };
  
  const handleCurveBgClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (isGhostMouse(e)) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const svg = document.getElementById('curvesSvg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(200, Math.round((clientX - rect.left) * (200 / rect.width))));
    const y = Math.max(0, Math.min(200, Math.round(200 - (clientY - rect.top) * (200 / rect.height))));
    const x255 = (x / 200) * 255;
    const y255 = (y / 200) * 255;
    const currentPoints = params.curves[currentCurveChannel];
    let closestIdx = -1;
    let minDist = 32; 
    for (let i = 0; i < currentPoints.length; i++) {
        const p = currentPoints[i];
        const dist = Math.sqrt(Math.pow(p.x - x255, 2) + Math.pow(p.y - y255, 2));
        if (dist < minDist) {
            minDist = dist;
            closestIdx = i;
        }
    }
    if (closestIdx !== -1) {
        handlePointTap(e, closestIdx);
        return;
    }
    const curveY = getSplineY(x255, currentPoints);
    if (Math.abs(y255 - curveY) < 32) {
         if (currentPoints.some(p => Math.abs(p.x - x255) < 12)) return;
         const newPoints = [...currentPoints, { x: x255, y: curveY }].sort((a,b) => a.x - b.x);
         const newIdx = newPoints.findIndex(p => p.x === x255);
         const newCurves = { ...params.curves, [currentCurveChannel]: newPoints };
         setParams(prev => ({ ...prev, curves: newCurves }));
         paramsRef.current = { ...paramsRef.current, curves: newCurves };
         lastCreatedIdxRef.current = newIdx;
         lastCreatedTimeRef.current = e.timeStamp;
         setDragPointIdx(newIdx);
         setIsInteracting(true);
         lastRenderDurationRef.current = 12; // Reset duration to prevent slow throttle carry-over
    }
  };

  const resetAllCurves = () => {
      const newCurves = JSON.parse(JSON.stringify(DEFAULT_CURVES));
      setParams(prev => ({ ...prev, curves: newCurves }));
      addToHistory({ ...params, curves: newCurves }, selectedLutIdx);
  };

  const getCurvePathD = () => {
      return boundedCurvePath(params.curves[currentCurveChannel], getSplineY);
  };
  
  const getCurveColor = () => {
      switch(currentCurveChannel) {
          case 'r': return '#ef4444';
          case 'g': return '#22c55e';
          case 'b': return '#3b82f6';
          default: return '#fff';
      }
  };

  return (
    <div className={`safe-top ${compactBottomBar ? 'relative w-full h-[100dvh]' : 'fixed inset-0'} bg-[#080808] z-[60] flex flex-col font-sans text-white overflow-hidden no-callout`}
         onMouseMove={dragPointIdx !== -1 ? (e) => handleCurveMove(e) : undefined}
         onMouseUp={dragPointIdx !== -1 ? handleCurveEndDrag : undefined}
         onTouchMove={dragPointIdx !== -1 ? (e) => handleCurveMove(e) : undefined}
         onTouchEnd={dragPointIdx !== -1 ? handleCurveEndDrag : undefined}
    >
      <style>{`
        .no-callout {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
            touch-action: none;
        }
        .allow-callout {
            -webkit-touch-callout: default !important;
            -webkit-user-select: auto !important;
            user-select: auto !important;
            touch-action: auto !important;
            pointer-events: auto !important;
            cursor: context-menu;
        }
        .custom-range.compact { height: 30px; }
        /* 特效細項那種並排的滑桿：
           1) 不能向外多長 32px —— 兩根並排時觸控範圍會重疊，中間會按錯根
           2) 軌道的漸層本來左右各留 32px 透明（用來蓋掉外擴的那一段），
              沒有外擴就不能留，不然 147px 的滑桿只剩 83px 看得到軌道
           3) 拇指外框從 64px 收到 40px，26px 高的滑桿才裝得下 */
        .custom-range.dense { height: 26px; width: 100%; margin: 0; }
        /* 拇指的「盒子」有多寬，圓點就走不到兩端多少 —— 瀏覽器讓拇指中心只能在
           盒寬/2 到 寬-盒寬/2 之間移動。一般滑桿是靠向外多長 32px（＝盒寬一半）
           把這件事藏起來的，並排的滑桿不能外擴，所以改成兩邊同時處理：
           盒子收到 18px（剛好包住 15px 的圓點），軌道也只畫 9px..寬-9px。
           兩者對齊之後，圓點就真的走得到軌道的頭尾了。
           （盒子變小不影響操作 —— range 本來就是按在軌道上任何一點都會跳過去。） */
        .custom-range.dense::-webkit-slider-runnable-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-moz-range-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-webkit-slider-thumb { height: 26px; width: 18px; margin-top: -12px; }
        .custom-range.dense::-moz-range-thumb { height: 26px; width: 18px; }
        .custom-range { 
          -webkit-appearance: none; 
          width: calc(100% + 64px); 
          height: 40px; 
          background: rgba(0,0,0,0); 
          outline: none; 
          margin: 0 -32px; 
          padding: 0;
          touch-action: none;
          -webkit-tap-highlight-color: rgba(0,0,0,0);
        }
        .custom-range:focus {
          outline: none;
        }
        .custom-range::-webkit-slider-runnable-track { 
          width: 100%; 
          height: 2px; 
          background: linear-gradient(to right, rgba(0,0,0,0) 32px, #333 32px, #333 calc(100% - 32px), rgba(0,0,0,0) calc(100% - 32px)); 
          border-radius: 2px; 
          cursor: pointer;
        }
        .custom-range::-webkit-slider-thumb { 
          -webkit-appearance: none; 
          height: 64px; 
          width: 64px; 
          background-color: rgba(0,0,0,0);
          background-image: radial-gradient(circle at center, #ffffff 0, #ffffff 7.5px, rgba(255,255,255,0) 8px, rgba(255,255,255,0) 100%);
          border: none;
          outline: none;
          cursor: pointer; 
          margin-top: -31px; 
          transition: transform 0.1s;
          box-shadow: none;
        }
        .custom-range::-webkit-slider-thumb:active {
          transform: scale(1.15);
        }
        .custom-range::-moz-range-track { 
          width: 100%; 
          height: 2px; 
          background: linear-gradient(to right, rgba(0,0,0,0) 32px, #333 32px, #333 calc(100% - 32px), rgba(0,0,0,0) calc(100% - 32px)); 
          border-radius: 2px; 
          cursor: pointer;
        }
        .custom-range::-moz-range-thumb {
          height: 64px; 
          width: 64px; 
          background-color: rgba(0,0,0,0);
          background-image: radial-gradient(circle at center, #ffffff 0, #ffffff 7.5px, rgba(255,255,255,0) 8px, rgba(255,255,255,0) 100%);
          border: none;
          outline: none;
          cursor: pointer; 
          transition: transform 0.1s;
          box-shadow: none;
        }
        .custom-range::-moz-range-thumb:active {
          transform: scale(1.15);
        }
        .curve-point { 
            fill: #fff; 
            cursor: pointer; 
            filter: drop-shadow(0 0 4px rgba(255,255,255,0.6)); 
            transition: filter 0.2s; 
        }
        .curve-point.active { filter: drop-shadow(0 0 12px #fff); }
        /* 進場、退場都用這條 easeOutQuint：起步快、收尾很柔。
           退場曾經改成它的鏡射（easeIn）好變成「進場的倒放」，但 easeIn
           開頭是平的 —— 前 190ms 幾乎還是全不透明，放開手會覺得曲線賴著不走。
           要「一放開就開始消失」就得讓退場也從快的那一端起跑。 */
        .panel-ease { transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1); }

        /* 一直都是實心；沒選中維持原尺寸，選中時整顆稍微放大。
           用 transform 不會動到版面（欄距 20px，放大 3.2px 也不會擠到隔壁），
           而且只有 transform 在補間，沒有顏色可以閃。 */
        .channel-dot {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            cursor: pointer;
            box-sizing: border-box;
            background: currentColor;
            transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .channel-dot.active { transform: scale(1.1); }
      `}</style>
      
      {saveState === 'idle' && (isEditorLoading || !previewLayoutReady) && (
        /* 首次解碼期間必須完全遮住預覽；半透明遮罩會把底下 canvas 從初始尺寸
           切換到正確比例的那一幀透出來，看起來就像圖片上下抖了一下。 */
        <div data-editor-initial-loading className="absolute inset-0 z-[120] flex items-center justify-center bg-[#080808]">
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
                  onClick={(e) => { e.stopPropagation(); recordProgress(); if(onHome) onHome(); }}
                  className="p-2 -ml-2 text-[#888] hover:text-white transition-colors active:scale-90"
                >
                  <ChevronLeft size={22} />
                </button>
              </header>
              <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
                  {/* 一次存多張時排成可以左右滑的一排，每一張都能長按儲存 */}
                  {/* items-center：橫式的照片要跟直式的一樣停在中間，不然會黏在上緣 */}
                  <div
                    ref={finalStripRef}
                    className={`w-full flex flex-row items-center gap-4 ${finalImages.length > 1 ? 'overflow-x-auto no-scrollbar snap-x snap-mandatory px-[max(0px,calc(50%-40vw))]' : 'justify-center'}`}
                  >
                    {(finalImages.length ? finalImages : [finalImage!]).map((src, i) => (
                      <div
                        key={src}
                        className="shrink-0 snap-center flex flex-col items-center gap-2"
                        /* 一次只准滑一張。
                           snap-mandatory 只保證「最後會停在某個定位點」，慣性滑動
                           照樣會衝過好幾張再吸住 —— 那就是「明明只滑一次卻跳過不只一張」。
                           scroll-snap-stop: always 就是專門管這件事的：
                           每個定位點都必須停下來，再快的一下也只前進一張。 */
                        style={{ scrollSnapStop: 'always' }}
                      >
                        <div data-export-media className="relative shadow-2xl rounded overflow-hidden max-h-[60vh]">
                          <img
                              src={src}
                              alt={`Final Result ${i + 1}`}
                              className="max-w-[80vw] max-h-[60vh] object-contain allow-callout relative z-10"
                          />
                          <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded"></div>
                        </div>
                      </div>
                    ))}
                  </div>
              </div>
              <div data-export-actions className="bg-black flex flex-col gap-3 px-6 pb-6 pt-2">
                   <SaveButton urls={encodedExports.length ? encodedExports : finalImages.length ? finalImages : (finalImage ? [finalImage] : [])} />
                   <div className="flex items-center justify-center gap-4">
                   <button 
                       onClick={() => { setSaveState('idle'); }}
                       className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-sm"
                   >
                       繼續編輯
                   </button>
                   <button 
                       onClick={() => { if (onImportNew) onImportNew(); }}
                       className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-sm"
                   >
                       修下一張
                   </button>
                   </div>
              </div>
          </div>
      )}

      {/* 面板開著時標題列要在那片 z-[59] 的遮罩**上面**，
          不然按資訊鍵按到的是遮罩，一次點擊會被算成兩次（見下面 EXIF 那一段）。
          面板收起來時就回到原本的 z-20，其餘完全不變。 */}
      {exportMenuOpen && <button aria-label="關閉匯出選項" className="absolute inset-0 z-[80]" onClick={() => setExportMenuOpen(false)} />}
      {saveState !== 'success' && (
      <header className={`h-14 relative flex items-center justify-between px-4 shrink-0 bg-black/40 ${exportMenuOpen ? '' : 'backdrop-blur-xl'} ${showExifPanel || exportMenuOpen ? 'z-[90]' : 'z-20'}`}>
        <div className="w-20">
            {/* 构图中的返回只退出构图并丢弃 draftGeo；其他分页才离开编辑器。 */}
            <button
              onClick={activeCategory === 'compose' ? cancelCompose : requestLeave}
              aria-label={activeCategory === 'compose' ? '退出构图并放弃变更' : '返回'}
              className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90"
            >
              <ChevronLeft size={22} />
            </button>
        </div>
        {activeCategory !== 'compose' ? (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4">
           <button onClick={undo} disabled={historyIndex <= 0} className={`p-2 transition-all ${historyIndex <= 0 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}><Icon name="undo" className="text-xl" /></button>
           <button onClick={redo} disabled={historyIndex >= history.length - 1} className={`p-2 transition-all ${historyIndex >= history.length - 1 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}><Icon name="redo" className="text-xl" /></button>
        </div>
        ) : <div aria-hidden="true" />}
        {activeCategory !== 'compose' ? (
        <div className="flex justify-end items-center gap-1">
            <div className="h-8 flex items-center bg-white text-black rounded-full overflow-hidden">
              <button onClick={handleSave} className="px-4 py-1.5 text-[11px] font-black whitespace-nowrap">儲存</button>
              <span aria-hidden="true" className="w-px h-4 bg-black/20" />
              <button aria-label="匯出選項" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen(v => !v)} className="h-8 px-2 flex items-center"><Icon name="more_horiz" className="text-xl" /></button>
            </div>
            {exportMenuOpen && <>
              <div role="dialog" aria-label="匯出選項" className="absolute left-4 right-4 top-full mt-2 z-[81] rounded-xl border border-white/15 p-3 shadow-xl" style={PREMIUM_GLASS}>
                <div className="text-xs text-white/50 mb-2">匯出格式</div>
                <div className="flex gap-2">
                  {(['jpg', 'png'] as const).map(format => <button key={format} aria-pressed={exportFormat === format} onClick={() => setExportFormat(format)} className={`flex-1 py-2 rounded-lg text-xs ${exportFormat === format ? 'bg-white text-black' : 'bg-[#303034]'}`}>{format.toUpperCase()}</button>)}
                  <button disabled={!canExportHeic()} aria-pressed={exportFormat === 'heic'} onClick={() => setExportFormat('heic')} className={`flex-1 py-2 rounded-lg text-xs disabled:opacity-35 ${exportFormat === 'heic' ? 'bg-white text-black' : 'bg-[#303034]'}`}>HEIC</button>
                </div>
              </div>
            </>}
        </div>
        ) : <div className="w-28" aria-hidden="true" />}
      </header>
      )}

      {/* IG 貼文預覽：跟兩個拼圖工具共用同一顆元件 */}
      {igOpen && igShot && (
        <div
          className="fixed inset-0 z-[120] bg-black overflow-y-auto animate-in fade-in duration-200"
          style={{ overscrollBehavior: 'none', scrollbarWidth: 'none', paddingTop: 48, paddingBottom: 48 }}
        >
          <IgPreview
            shots={[igShot]}
            frame={(() => {
              const im = originalImgRef.current;
              return im ? { w: im.naturalWidth, h: im.naturalHeight } : { w: 1, h: 1 };
            })()}
            pageCount={1}
            faces={[igShot]}
            supported
            slot="editor"
            embedded
            flow
            onClose={() => setIgOpen(false)}
          />
          {/* 關閉鍵不另外加：IgPreview 自己那一顆就夠了（onClose 已經接上去），
              多一顆只是右上角多一個重複的按鈕。 */}
        </div>
      )}

      {/* EXIF panel overlay。點面板以外的任何地方就收起來 */}
      {showExifPanel && (
        /* 點面板外面就收起來，而且**鬆手才收**（onClick）——
           跟資訊鍵那一顆的手感一致。
           它同時也把點擊擋住，所以底下的滑桿、分頁不會被順手按到。
           標題列在面板開著時會被抬到這一層上面，所以資訊鍵不會被它蓋住。 */
        <div ref={exifShieldRef} className="fixed inset-0 z-[59]" onClick={() => setShowExifPanel(false)} />
      )}
      {showExifPanel && (
        <div ref={exifPanelRef} className="absolute top-16 right-4 left-4 md:left-auto md:right-4 mx-auto md:mx-0 bg-black/90 border border-white/10 rounded-2xl p-5 shadow-2xl backdrop-blur-xl z-[70] w-[320px] max-w-[calc(100vw-2rem)] text-white/90 text-xs flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-1">
            <span className="font-bold tracking-wider text-[11px] text-white/40 uppercase">EXIF資訊</span>
          </div>
          
          <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-2.5">
            <span className="text-white/40">名稱</span>
            <span className="font-mono truncate select-all text-white/90" title={exifData.fileName}>{exifData.fileName || '-'}</span>

            <span className="text-white/40">格式</span>
            <span className={`${(!exifData.fileFormat || exifData.fileFormat === '-') ? 'font-mono' : 'font-medium'} text-white/90`}>{exifData.fileFormat || '-'}</span>

            <span className="text-white/40">尺寸</span>
            <span className="font-mono text-white/90">{imageDimensions || '-'}</span>

            <span className="text-white/40">日期</span>
            <span className="font-mono text-white/90">{exifData.date || '-'}</span>

            <span className="text-white/40">型號</span>
            <span className={`${(!exifData.cameraModel || exifData.cameraModel === '-') ? 'font-mono' : 'font-medium'} text-white/90`}>{exifData.cameraModel || '-'}</span>

            <span className="text-white/40">ISO</span>
            <span className="font-mono text-white/90">{exifData.iso || '-'}</span>

            <span className="text-white/40">快門</span>
            <span className="font-mono text-white/90">{exifData.shutter || '-'}</span>

            <span className="text-white/40">焦距</span>
            <span className="font-mono text-white/90">{exifData.focalLength || '-'}</span>

            <span className="text-white/40">光圈</span>
            <span className="font-mono text-white/90">{exifData.aperture || '-'}</span>
          </div>
        </div>
      )}

      <div
        ref={previewBoxRef}
        data-editor-preview-box
        /* min-h-0 是長圖的關鍵：flex 子項預設 min-height:auto，會拿內容高度
           撐開自己，把下面工具列推出 viewport。預覽只能使用剩餘空間，長圖
           由內層等比例 contain；工具列因此永遠留在螢幕內。 */
        className={`flex-1 min-h-0 relative flex overflow-hidden bg-[#080808]`}
        style={activeCategory === 'mask' ? { touchAction: 'none' } : undefined}
        onPointerDownCapture={onBoxPointerDown}
        onPointerMoveCapture={onBoxPointerMove}
        onPointerUpCapture={onBoxPointerUp}
        onPointerCancelCapture={onBoxPointerUp}
      >
        <TransformWrapper
          ref={zoomRef}
          initialScale={1}
          minScale={0.5} 
          maxScale={5} 
          doubleClick={{ disabled: true }}
          wheel={{ step: 0.3 }}
          pinch={{ step: 240 }}
          panning={{ velocityDisabled: false }}
          alignmentAnimation={{ sizeX: 0, sizeY: 0 }}
          /* 遮色片：沒有選中任何一個、也不是在新增的時候，預覽照常可以縮放 */
          disabled={activeCategory === 'mask' && !maskZoomable}
        >
          <TransformComponent wrapperClass="!w-full !h-full absolute inset-0" contentClass="!w-full !h-full flex items-center justify-center p-4">
            <div className="relative shadow-2xl w-full h-full flex items-center justify-center">
              {/* Sizing wrapper to ensure canvas and interactive overlay scale/move together perfectly */}
              <div
                ref={previewFitRef}
                /* 預覽框尺寸是量測結果，不應該做補間；首次進頁若從暫存高度動畫到
                   實際高度，圖片就會明顯上下抖動。HSL 原本也要求無進退場動畫。 */
                className="relative flex items-center justify-center max-w-[calc(100%-32px)]"
                style={{
                  /* 尺寸與比例尚未量完時不先畫錯誤位置；useLayoutEffect 會在首幀
                     顯示前完成量測，所以長圖不會再先抖一下才歸位。 */
                  visibility: !isEditorLoading && previewLayoutReady && previewAspect && previewBoxSize.width && previewBoxSize.height ? 'visible' : 'hidden',
                  width: previewFitSize ? `${previewFitSize.width}px` : undefined,
                  height: previewFitSize ? `${previewFitSize.height}px` : undefined,
                  maxHeight: 'none',
                  marginBottom: hslFitNow ? `${hslFitNow.mb}px` : '0px',
                  aspectRatio: undefined,
                  maxWidth: 'none',
                }}
              >
                {/* Single Canvas for Display and Compare */}
                {/* objectFit:'fill' 而不是 object-contain：外面那層已經用 aspectRatio
                    鎖成正確比例了，這裡再讓畫布「照自己的比例」留黑邊，
                    只要畫布尺寸換一下（全解析度↔代理）黑邊就會跟著變、圖片就位移。
                    填滿之後畫布尺寸怎麼換，畫面上的位置都完全不動。 */}
                <canvas 
                    ref={displayCanvasRef} 
                    style={{ objectFit: 'fill' }}
                    className="absolute inset-0 w-full h-full pointer-events-auto rounded-sm"
                />

                {/* 合併時的定格畫面：從按下合併到全部做完，畫面完全不變（使用者一操作就收掉） */}
                <canvas ref={freezeCanvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none rounded-sm" style={{display:'none',objectFit:'fill',zIndex:5}} />
                <canvas key={surfaceGen} ref={el=>{(fxSurfaceRef as React.MutableRefObject<HTMLCanvasElement|null>).current=el;if(el){preferWebgl2(el);el.addEventListener('webglcontextlost',onSurfaceLost,{once:true});}}} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none rounded-sm" style={{visibility:'hidden',objectFit:'fill'}} />
                {/* 拖遮色片形狀時的即時疊層（見 applyComplexEffects 的遮色片那段） */}
                <canvas ref={maskLiveCanvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none rounded-sm" style={{display:'none',objectFit:'fill',zIndex:4}} />
                {/* 紅色範圍自己一層：選中／取消選中、按＋時跟參考線在同一幀出現／消失（用 CSS 切，不必重算照片） */}
                <canvas ref={maskOverlayCanvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none rounded-sm"
                  style={{display:'none',objectFit:'fill',zIndex:4,visibility: activeCategory === 'mask' && !maskDeselected && !maskPicking ? 'visible' : 'hidden'}} />

                {/* 換過去了但還在算的時候，壓暗＋轉圈，別讓人以為沒反應。
                    只留轉圈 —— 「渲染中」三個字反而讓人覺得等很久。 */}
                {isSwitching && (
                  <div
                    data-switch-overlay
                    className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 rounded-sm pointer-events-none animate-in fade-in duration-150"
                  >
                    <div className="w-7 h-7 border-2 border-white/25 border-t-white rounded-full animate-spin" />
                  </div>
                )}

              {/* Linear Mask Interactive Vector Overlay */}
              {activeCategory === 'mask' && canvasBounds.width > 0 && (
                <>
                  <svg
                    id="mask-svg-overlay"
                    /* 參考線與把手可以超出照片、畫在照片外面那圈暗色上（不會因為出了照片邊就被切掉）；
                       那兩條「無限長」的邊界線由外面的預覽區（overflow-hidden）負責裁到預覽區為止，
                       不會畫到工具列上。紅色範圍是畫在畫布裡的，本來就不會超出照片。 */
                    className="absolute inset-0 w-full h-full select-none pointer-events-auto overflow-visible z-30"
                    style={{
                      touchAction: 'none',
                    }}
                    onPointerMove={handleMaskPointerMove}
                    onPointerUp={handleMaskPointerUp}
                    onPointerCancel={handleMaskPointerUp}
                  >
                  {/* 整片的觸控區：線性／放射還沒畫出來時拖曳建立；筆刷一直是塗抹；顏色／明度範圍是點選取樣 */}
                  {(() => {
                    const mt = maskView.maskType ?? 'linear';
                    if (maskPicking || !maskHasAny) return null;
                    const kind: MaskDragType | null = mt === 'brush' ? 'paint' : (mt === 'color' || mt === 'luma') ? 'sample'
                      : !params.maskCreated ? (mt === 'radial' ? 'rcreate' : 'create') : null;
                    if (!kind) return null;
                    return <rect id="ui-bg-hit" width="100%" height="100%" fill="transparent"
                      style={{ cursor: kind === 'paint' ? 'none' : 'crosshair' }}
                      onPointerDown={(e) => handleMaskPointerDown(e, kind)}
                      onPointerLeave={() => { if (kind === 'paint' && !activeDragRef.current) document.querySelector('#mask-svg-overlay [data-brush-cursor]')?.setAttribute('visibility', 'hidden'); }} />;
                  })()}

                  <g transform={`translate(${canvasBounds.left}, ${canvasBounds.top})`}>
                    {/* Vector guides */}
                    {params.maskCreated && (maskView.maskType ?? 'linear') === 'linear' && !maskPicking && !maskDeselected && !(isInteracting && !activeDragRef.current) && (
                      <g
                        id="ui-guides"
                      style={{
                        willChange: 'transform',
                      }}
                      transform={`translate(${maskView.maskCx * canvasBounds.width}, ${maskView.maskCy * canvasBounds.height}) rotate(${(maskView.maskAngle * 180) / Math.PI})`}
                    >
                      {/* Connecting axis line */}
                      <line
                        data-mask-axis
                        className="pointer-events-none"
                        x1={-maskView.maskD * canvasBounds.width}
                        y1={0}
                        x2={maskView.maskD * canvasBounds.width}
                        y2={0}
                        stroke="rgba(255, 255, 255, 0.5)"
                        strokeWidth="1px"
                        strokeDasharray="2,4"
                      />

                      {/* Rotator group */}
                      <g
                        id="ui-rotator-group"
                        style={{
                          display: activeDragRef.current?.type && activeDragRef.current.type !== 'rotate' ? 'none' : 'block',
                          opacity: activeDragRef.current?.type && activeDragRef.current.type !== 'rotate' ? 0 : 1,
                          pointerEvents: activeDragRef.current?.type && activeDragRef.current.type !== 'rotate' ? 'none' : 'auto',
                        }}
                        data-mask-rot
                        transform={`translate(${maskView.maskD * canvasBounds.width}, 0)`}
                      >
                        {/* Rotator Arm */}
                        <line
                          className="pointer-events-none"
                          x1={0}
                          y1={0}
                          x2={35}
                          y2={0}
                          stroke="#000000"
                          strokeWidth="2.1px"
                          strokeLinecap="round"
                        />
                        <line
                          className="pointer-events-none"
                          x1={0}
                          y1={0}
                          x2={35}
                          y2={0}
                          stroke="#ffffff"
                          strokeWidth="1.5px"
                          strokeLinecap="round"
                        />
                        {/* Rotator handle */}
                        <circle
                          cx={35}
                          cy={0}
                          r={16}
                          fill="transparent"
                          style={{ cursor: 'alias' }}
                          onPointerDown={(e) => handleMaskPointerDown(e, 'rotate')}
                        />
                        <circle
                          className="pointer-events-none"
                          cx={35}
                          cy={0}
                          r={6}
                          fill="#ffffff"
                          stroke="#000000"
                          strokeWidth="0.5px"
                          style={{
                            filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.45))',
                          }}
                        />
                      </g>

                      {/* Start line (100% boundary) */}
                      <g data-mask-start transform={`translate(${-maskView.maskD * canvasBounds.width}, 0)`}>
                        <line
                          x1={0}
                          y1={-10000}
                          x2={0}
                          y2={10000}
                          stroke="transparent"
                          strokeWidth="18px"
                          style={{ cursor: 'grab' }}
                          onPointerDown={(e) => handleMaskPointerDown(e, 'start')}
                        />
                        <line
                          className="pointer-events-none"
                          x1={0}
                          y1={-10000}
                          x2={0}
                          y2={10000}
                          stroke="#000000"
                          strokeWidth="2.1px"
                          strokeLinecap="round"
                        />
                        <line
                          className="pointer-events-none"
                          x1={0}
                          y1={-10000}
                          x2={0}
                          y2={10000}
                          stroke="#ffffff"
                          strokeWidth="1.5px"
                          strokeLinecap="round"
                        />
                      </g>

                      {/* End line (0% boundary) */}
                      <g data-mask-end transform={`translate(${maskView.maskD * canvasBounds.width}, 0)`}>
                        <line
                          x1={0}
                          y1={-10000}
                          x2={0}
                          y2={10000}
                          stroke="transparent"
                          strokeWidth="18px"
                          style={{ cursor: 'grab' }}
                          onPointerDown={(e) => handleMaskPointerDown(e, 'end')}
                        />
                        <line
                          className="pointer-events-none"
                          x1={0}
                          y1={-10000}
                          x2={0}
                          y2={10000}
                          stroke="#000000"
                          strokeWidth="2.1px"
                          strokeLinecap="round"
                        />
                        <line
                          className="pointer-events-none"
                          x1={0}
                          y1={-10000}
                          x2={0}
                          y2={10000}
                          stroke="#ffffff"
                          strokeWidth="1.5px"
                          strokeLinecap="round"
                        />
                      </g>

                      {/* Center line */}
                      <g>
                        <line
                          x1={0}
                          y1={-10000}
                          x2={0}
                          y2={10000}
                          stroke="transparent"
                          strokeWidth="18px"
                          style={{ cursor: 'grab' }}
                          onPointerDown={(e) => handleMaskPointerDown(e, 'center')}
                        />
                        <line
                          className="pointer-events-none"
                          x1={0}
                          y1={-10000}
                          x2={0}
                          y2={10000}
                          stroke="#ffffff"
                          strokeWidth="1.5px"
                          strokeLinecap="round"
                        />
                      </g>

                      {/* Center Positioning Pin */}
                      <g>
                        <rect
                          x={-16}
                          y={-16}
                          width={32}
                          height={32}
                          fill="transparent"
                          style={{ cursor: 'move' }}
                          onPointerDown={(e) => handleMaskPointerDown(e, 'center')}
                        />
                        <rect
                          className="pointer-events-none"
                          x={-6}
                          y={-6}
                          width={12}
                          height={12}
                          fill="#ffffff"
                          stroke="#000000"
                          strokeWidth="0.5px"
                          style={{
                            filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.45))',
                          }}
                        />
                      </g>
                    </g>
                  )}
                    {/* 放射：橢圓外框（100%→0% 的邊界）、內側虛線（羽化從這裡開始）、中心、兩軸把手、旋轉把手 */}
                    {params.maskCreated && maskView.maskType === 'radial' && !maskPicking && !maskDeselected && !(isInteracting && !activeDragRef.current) && (() => {
                      const W = canvasBounds.width, H = canvasBounds.height;
                      const rx = (maskView.maskRx ?? 0.25) * W, ry = (maskView.maskRy ?? 0.25) * W, f = 1 - (maskView.maskFeather ?? 50) / 100;
                      const knob = (data: string, type: MaskDragType, tf: string, cursor: string) => (
                        <g {...{ [data]: true }} transform={tf}>
                          <circle r={16} fill="transparent" style={{ cursor }} onPointerDown={(e) => handleMaskPointerDown(e, type)} />
                          <circle className="pointer-events-none" r={5.5} fill="#fff" stroke="#000" strokeWidth="0.5" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.45))' }} />
                        </g>
                      );
                      return (
                        <g id="ui-radial" transform={`translate(${maskView.maskCx * W}, ${maskView.maskCy * H}) rotate(${(maskView.maskAngle * 180) / Math.PI})`}>
                          <ellipse data-radial-outer className="pointer-events-none" rx={rx} ry={ry} fill="none" stroke="#000" strokeWidth="2.1" />
                          <ellipse data-radial-outer className="pointer-events-none" rx={rx} ry={ry} fill="none" stroke="#fff" strokeWidth="1.5" />
                          <ellipse data-radial-inner className="pointer-events-none" rx={rx * f} ry={ry * f} fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="1" strokeDasharray="3,4" />
                          <g>
                            <rect x={-16} y={-16} width={32} height={32} fill="transparent" style={{ cursor: 'move' }} onPointerDown={(e) => handleMaskPointerDown(e, 'rcenter')} />
                            <rect className="pointer-events-none" x={-6} y={-6} width={12} height={12} fill="#fff" stroke="#000" strokeWidth="0.5" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.45))' }} />
                          </g>
                          {/* 四個邊都能拉：左右兩顆改橫向半徑、上下兩顆改縱向半徑（以中心對稱） */}
                          {knob('data-radial-rx', 'rx', `translate(${rx}, 0)`, 'ew-resize')}
                          {knob('data-radial-rxl', 'rx', `translate(${-rx}, 0)`, 'ew-resize')}
                          {knob('data-radial-ry', 'ry', `translate(0, ${-ry})`, 'ns-resize')}
                          {knob('data-radial-ryb', 'ry', `translate(0, ${ry})`, 'ns-resize')}
                          <g data-radial-rot transform={`translate(0, ${-ry - 30})`}>
                            <circle r={16} fill="transparent" style={{ cursor: 'alias' }} onPointerDown={(e) => handleMaskPointerDown(e, 'rrot')} />
                            <circle className="pointer-events-none" r={6} fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="2,2.2" />
                          </g>
                        </g>
                      );
                    })()}
                    {/* 顏色範圍：取樣點 */}
                    {maskView.maskType === 'color' && !maskPicking && (maskView.maskColors || []).map((c, k) => (
                      <g key={k} className="pointer-events-none" transform={`translate(${c.x * canvasBounds.width}, ${c.y * canvasBounds.height})`}>
                        <circle r={8} fill={c.r >= 0 ? `rgb(${c.r},${c.g},${c.b})` : 'transparent'} stroke="#fff" strokeWidth="2" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.6))' }} />
                      </g>
                    ))}
                    {/* 其他遮色片的位置（線性、放射）：點一下切過去。只顯示跟現在這一個同種類的（正在弄明度時不會冒出放射的點） */}
                    {!activeDragRef.current && maskListView.list.map((m, i) => ((i === maskListView.active && !maskDeselected) || !m.maskCreated || (m.maskType !== 'linear' && m.maskType !== 'radial') || m.maskType !== maskView.maskType) ? null : (
                      <g key={m.maskId + i} data-mask-pin={i} transform={`translate(${m.maskCx * canvasBounds.width}, ${m.maskCy * canvasBounds.height})`}>
                        {/* 點一下（放開、而且沒有拖動）才選中，手指只是碰到不算 */}
                        <circle r={16} fill="transparent" style={{ cursor: 'pointer' }}
                          onPointerDown={(e) => { e.stopPropagation(); pinDownRef.current = { i, x: e.clientX, y: e.clientY }; }}
                          onPointerUp={(e) => { const d = pinDownRef.current; pinDownRef.current = null; if (d && d.i === i && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 8) selectMask(i); }} />
                        <circle className="pointer-events-none" r={6.5} fill="rgba(0,0,0,.45)" stroke="#fff" strokeWidth="1.5" />
                      </g>
                    ))}
                  </g>
                  {maskView.maskType === 'brush' && (
                    <circle data-mask-size-ring className="pointer-events-none" visibility="hidden"
                      cx={canvasBounds.left + canvasBounds.width / 2} cy={canvasBounds.top + canvasBounds.height / 2}
                      r={brushR(maskView) * canvasBounds.width} fill="none" stroke="#fff" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,.8))' }} />
                  )}
                  {maskView.maskType === 'brush' && !maskPicking && (
                    <circle data-brush-cursor className="pointer-events-none" visibility="hidden" cx={0} cy={0}
                      r={brushR(maskView) * canvasBounds.width} fill="none" stroke="#fff" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,.8))' }} />
                  )}
                </svg>
              </>
              )}
              </div>
            </div>
          </TransformComponent>
        </TransformWrapper>

        {/* 遮色片清單（右上角，跟 Lightroom 一樣一個遮色片一格）：＋新增、點一格切換，
            下面是選中那一個的動作：顯示範圍、反轉、刪除。全部只有圖示。
            最底下那一塊實心方塊是收納鍵：點一下整欄收進方塊裡（只剩方塊），再點一下展開。
            收合用 grid 的列高從 1fr 補間到 0fr（真的改變高度，方塊跟著滑上去），每一顆再各自淡出縮小、錯開一點時間。 */}
        {/* 一個畫出來的遮色片都沒有時，整欄不出現（沒東西可以選、可以操作） */}
        {activeCategory === 'mask' && maskListView.list.some(m => m.maskCreated) && (() => {
          /* 收合：毛玻璃的高度補間（grid 的 1fr ⇄ 0fr，寬度不變），裡面的按鈕在原地縮小淡掉；
             展開時盒子長開，按鈕在原地像果凍一樣彈出來（縮放帶一點回彈），依序錯開一點點。 */
          const EASE = 'cubic-bezier(.32,.72,0,1)';
          const JELLY = 'cubic-bezier(.34,1.85,.5,1)';
          const DUR = 400;
          const list = maskListView.list;
          /* 清單只放真的畫出來的遮色片（剛選了種類、還沒在照片上拉出來的那一個不算） */
          const made = list.filter(m => m.maskCreated);
          const NAMES: Record<string, string> = { linear: '線性', radial: '放射', brush: '筆刷', color: '顏色', luma: '明度' };
          const seen: Record<string, number> = {};
          const total: Record<string, number> = {};
          made.forEach(m => { total[m.maskType] = (total[m.maskType] || 0) + 1; });
          let n = 0;
          const fade = (node: React.ReactNode, key: string) => {
            const i = n++;
            return (
              <div key={key} className="flex items-center justify-center" style={{
                transformOrigin: '50% 50%',
                transition: maskRailOpen
                  ? `opacity 200ms ease ${60 + i * 26}ms, transform 520ms ${JELLY} ${60 + i * 26}ms`
                  : 'opacity 150ms ease 0ms, transform 180ms cubic-bezier(.5,0,.75,0) 0ms',
                opacity: maskRailOpen ? 1 : 0, transform: maskRailOpen ? 'scale(1)' : 'scale(.55)',
              }}>{node}</div>
            );
          };
          const act = 'w-9 h-8 flex items-center justify-center active:scale-90 transition-transform duration-150';
          return (
            <div data-mask-stack data-open={maskRailOpen ? '1' : '0'} onPointerDown={e => e.stopPropagation()}
              /* 黑色毛玻璃底板包住整欄 */
              className="absolute right-3 top-3 z-[40] flex flex-col items-center rounded-[12px] bg-black/45 backdrop-blur-xl p-1.5 shadow-[0_8px_28px_rgba(0,0,0,.4),inset_0_0_0_1px_rgba(255,255,255,.08)]">
              <div className="grid" style={{ gridTemplateRows: maskRailOpen ? '1fr' : '0fr', transition: `grid-template-rows ${DUR}ms ${EASE}` }}>
                {/* 四周多留 6px 再用負邊距抵回去：按鈕果凍放大的那一下不會被這一層的裁切切到 */}
                <div className="min-h-0 overflow-hidden -m-1.5 p-1.5" aria-hidden={!maskRailOpen}>
                  <div className="flex flex-col items-center gap-2 pb-2">
                    {fade(
                      /* 還沒有任何畫出來的遮色片時，選種類是唯一能做的事：不給「×」（沒有可以退回去的地方） */
                      <button data-mask-add aria-label="新增遮色片" tabIndex={maskRailOpen ? 0 : -1} onClick={() => setMaskPicking(v => made.length ? !v : true)}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${maskPicking && made.length ? 'bg-white/20 text-white' : 'bg-white text-black'}`}>
                        <MaskGlyph k={maskPicking && made.length ? 'close' : 'plus'} />
                      </button>, 'add')}
                    {made.length > 0 && (
                      /* 一次最多看到 4 個；超過就在這一段裡上下滑（不會把下面的按鈕擠到太下面） */
                      <div data-mask-chips className="flex flex-col items-center gap-2 overflow-y-auto no-scrollbar overscroll-contain p-1.5 -m-1.5"
                        /* 4 顆＋3 個間距，再加上下各 6px 的內距（p-1.5），第 4 顆才會完整露出來 */
                        style={{ maxHeight: 4 * 36 + 3 * 8 + 12, touchAction: 'pan-y', scrollSnapType: 'y proximity' }}>
                        {list.map((m, i) => {
                          if (!m.maskCreated) return null;
                          const on = i === maskListView.active && !maskPicking && !maskDeselected;
                          const t = m.maskType;
                          seen[t] = (seen[t] || 0) + 1;
                          const name = (NAMES[t] || '') + (total[t] > 1 ? String(seen[t]) : '');
                          return fade(
                            <button data-mask-chip={i} data-on={on ? '1' : '0'} aria-label={`遮色片 ${name}`} tabIndex={maskRailOpen ? 0 : -1} onClick={() => selectMask(i)}
                              /* 方形；選中不填滿，只有白色外框，整格從偏暗變回正常亮度 */
                              className="relative shrink-0 w-9 h-9 rounded-[9px] flex items-center justify-center bg-white/[0.08] text-white text-[9.5px] font-medium tracking-[0.02em] leading-none transition-[opacity,box-shadow] duration-200"
                              style={{
                                scrollSnapAlign: 'start',
                                opacity: on ? 1 : 0.5,
                                boxShadow: on ? 'inset 0 0 0 1.5px #fff' : m.maskCreated ? 'inset 0 0 0 1px rgba(255,255,255,.22)' : 'none',
                                outline: m.maskCreated ? undefined : '1px dashed rgba(255,255,255,.55)', outlineOffset: -1,
                              }}>
                              {name}
                              {m.maskInvert && <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-white text-black flex items-center justify-center"><MaskGlyph k="invert" size={9} /></span>}
                            </button>, `chip-${m.maskId}-${i}`);
                        })}
                      </div>
                    )}
                    {/* 沒有選中任何遮色片時，顯示範圍／反轉／刪除先收起來（沒有對象可以操作） */}
                    {made.length > 0 && !maskPicking && !maskDeselected && (<>
                      {fade(<span className="block w-6 h-px bg-white/20 my-0.5" />, 'sep')}
                      {/* 這三顆只有圖示，沒有底圓 */}
                      {fade(
                        <button data-mask-overlay aria-label={params.maskShowOverlay ? '隱藏範圍' : '顯示範圍'} aria-pressed={!!params.maskShowOverlay} tabIndex={maskRailOpen ? 0 : -1} onClick={toggleMaskOverlay}
                          className={`${act} ${params.maskShowOverlay ? 'text-[#ef4444]' : 'text-white/75'}`}>
                          <MaskGlyph k={params.maskShowOverlay ? 'eye' : 'eyeoff'} size={20} />
                        </button>, 'overlay')}
                      {fade(
                        <button data-mask-invert aria-label="反轉" aria-pressed={!!params.maskInvert} tabIndex={maskRailOpen ? 0 : -1} onClick={toggleMaskInvert}
                          className={`${act} ${params.maskInvert ? 'text-white' : 'text-white/75'}`}>
                          <MaskGlyph k="invert" size={20} />
                        </button>, 'invert')}
                      {fade(
                        <button data-mask-delete aria-label="刪除遮色片" tabIndex={maskRailOpen ? 0 : -1} onClick={deleteMask} className={`${act} text-[#f87171]`}>
                          <MaskGlyph k="trash" size={20} />
                        </button>, 'delete')}
                    </>)}
                  </div>
                </div>
              </div>
              {/* 實心方塊＝收納鍵 */}
              <button data-mask-rail-toggle aria-label={maskRailOpen ? '收起遮色片工具' : '展開遮色片工具'} aria-expanded={maskRailOpen}
                onClick={() => { setMaskParamOpen(null); setMaskRailOpen(v => !v); }}
                className="relative w-9 h-9 rounded-[9px] bg-white text-black flex items-center justify-center active:scale-95 transition-transform duration-150">
                <span className="flex items-center justify-center" style={{ transition: `transform ${DUR}ms ${EASE}`, transform: maskRailOpen ? 'none' : 'rotate(180deg)' }}>
                  <MaskGlyph k="fold" size={18} />
                </span>
                {!maskRailOpen && made.length > 0 && (
                  <span className="absolute -top-2 -left-2 min-w-[18px] h-[18px] px-1 rounded-full bg-black text-white text-[10px] font-bold leading-[18px] text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,.35)] animate-in fade-in zoom-in-75 duration-300">{made.length}</span>
                )}
              </button>
            </div>
          );
        })()}
        {/* 遮色片自己的參數（羽化、範圍、筆刷大小…）：照片左下角一顆膠囊，跟右下角的前後對比鍵同一排（拇指最好按的地方）。
            平常只有一顆「調節」圖示；點它，膠囊往右長開、裡面的參數依序淡入；
            點某個參數，同一個膠囊往上長高、上面出現那個參數的滑桿（選中的圖示從灰變亮）；
            點別的參數直接換滑桿，再點一次選中的那個收起滑桿，點「調節」整個收回。
            從頭到尾只有「一塊」毛玻璃在改變寬高，不會有好幾個形狀各自變形。 */}
        {maskCapsuleShown && (() => {
          const mt = (params.maskType ?? 'linear') as MaskType;
          const tools = MASK_TYPE_TOOLS[mt];
          const items: { id: string; label: string; icon: string; slider: ToolDef | null; on: boolean; run: () => void }[] = [
            ...tools.map(t => ({ id: t.id, label: t.label, icon: t.icon, slider: t as ToolDef | null, on: maskParamOpen === t.id, run: () => setMaskParamOpen(o => o === t.id ? null : t.id) })),
          ];
          if (mt === 'brush') items.push({ id: 'maskBrushErase', label: '擦除', icon: 'erase', slider: null, on: !!params.maskBrushErase,
            run: () => { const p = paramsRef.current; uiFirstRef.current = true; paramsRef.current = { ...p, maskBrushErase: !p.maskBrushErase }; flushParamsSync(); } });
          const B = 36, STEP = 40, SLIDER_H = 58, MIN_SLIDER_W = 236;
          const rowW = B + items.length * STEP + 4;
          const sliderOn = maskCapOpen && maskPanelOn && !!maskPanelTool;
          const W = maskCapOpen ? (sliderOn ? Math.max(rowW, MIN_SLIDER_W) : rowW) : B;
          const H = B + (sliderOn ? SLIDER_H : 0);
          const EASE = 'cubic-bezier(.32,.72,0,1)';
          const pItem = items.find(it => it.id === maskPanelTool) || null;
          const v = pItem?.slider ? (snapOf(params) as any)[pItem.id] : 0;
          const imgGap = previewFitSize && previewBoxSize.width ? Math.max(0, (previewBoxSize.width - previewFitSize.width) / 2) : 16;
          return (
            <div data-mask-params className="absolute z-[40]" onPointerDown={e => e.stopPropagation()}
              /* 跟右下角前後對比鍵的中心同一條水平線（那顆中心離預覽區底部 32px） */
              style={{ left: Math.max(12, imgGap), bottom: 32 - B / 2 }}>
              <div data-mask-capsule data-open={maskCapOpen ? '1' : '0'} className="relative overflow-hidden"
                style={{
                  width: W, height: H, borderRadius: 18,
                  background: 'rgba(0,0,0,.45)', WebkitBackdropFilter: 'blur(24px)', backdropFilter: 'blur(24px)',
                  boxShadow: '0 6px 22px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.08)',
                  transition: `width 380ms ${EASE}, height 380ms ${EASE}`,
                }}>
                {/* 上面：滑桿（膠囊長高之後才淡入；收起時先淡掉） */}
                {pItem?.slider && (
                  <div data-mask-param-panel={pItem.id} className="absolute left-0 top-0" style={{
                    width: Math.max(rowW, MIN_SLIDER_W), height: SLIDER_H, padding: '8px 14px 0',
                    opacity: sliderOn ? 1 : 0, transform: sliderOn ? 'none' : 'translateY(6px)',
                    pointerEvents: sliderOn ? 'auto' : 'none',
                    transition: sliderOn ? 'opacity 220ms ease 160ms, transform 320ms ease 160ms' : 'opacity 110ms ease, transform 110ms ease',
                  }}>
                    <FastSlider
                      key={pItem.id}
                      value={typeof v === 'number' ? v : 0}
                      min={pItem.slider.min} max={pItem.slider.max} step={pItem.slider.step ?? 1}
                      toolId={pItem.id} label={pItem.label} dense
                      onUpdate={(id, val) => {
                        const nextParams = { ...paramsRef.current, [id]: val };
                        paramsRef.current = nextParams;
                        lastSliderMoveTimeRef.current = performance.now();
                        if (id === 'maskBrushSize') showSizeRing(nextParams);
                        if (maskSliderLiveRef.current && maskLiveFrame(nextParams, true)) return;
                        isDirtyRef.current = true;
                      }}
                      onInteractStart={() => {
                        if (pItem.id === 'maskBrushSize') showSizeRing(paramsRef.current);
                        if (paramsRef.current.maskCreated) { maskSliderLiveRef.current = true; maskRangeDragRef.current = true; }
                        setupFastPreview(pItem.id);
                      }}
                      onInteractEnd={() => {
                        hideSizeRing();
                        maskSliderLiveRef.current = false; maskRangeDragRef.current = false; maskLiveKeyRef.current = '';
                        setIsInteracting(false);
                        fastPreviewCacheRef.current.active = false;
                        isDirtyRef.current = true;
                        setParams({ ...paramsRef.current });
                        addToHistory(paramsRef.current, selectedLutIdx);
                      }}
                      onReset={handleDoubleTap}
                    />
                  </div>
                )}
                {/* 下面：一排圖示（貼著膠囊底部，長高時它們不動） */}
                <div className="absolute left-0 bottom-0 h-9 flex items-center" style={{ width: rowW }}>
                  <button data-mask-cap-toggle aria-label={maskCapOpen ? '收起遮色片參數' : '遮色片參數'} aria-expanded={maskCapOpen}
                    onClick={() => { if (maskCapOpen) setMaskParamOpen(null); setMaskCapOpen(o => !o); }}
                    className="shrink-0 w-9 h-9 flex items-center justify-center text-white active:scale-90 transition-transform duration-150">
                    <Icon name="tune" className="text-[20px]" />
                  </button>
                  {items.map((it, i) => (
                    <button key={it.id} data-mask-param={it.id} data-on={it.on ? '1' : '0'} aria-label={it.label} aria-pressed={it.on}
                      tabIndex={maskCapOpen ? 0 : -1} onClick={it.run}
                      className="shrink-0 w-9 h-9 ml-1 flex items-center justify-center active:scale-90"
                      style={{
                        /* 選中＝圖示從灰變成正常亮度（沒有白圈） */
                        color: it.on ? '#fff' : 'rgba(255,255,255,.42)',
                        opacity: maskCapOpen ? 1 : 0,
                        transform: maskCapOpen ? 'none' : 'translateX(-8px) scale(.85)',
                        transition: maskCapOpen
                          ? `color 200ms ease, opacity 220ms ease ${80 + i * 35}ms, transform 360ms ${EASE} ${80 + i * 35}ms`
                          : 'color 200ms ease, opacity 120ms ease, transform 160ms ease',
                      }}>
                      <MaskGlyph k={it.icon} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
        {/* 提示（不擋手勢）：還沒畫出來時告訴使用者這一種要怎麼做。
            放在照片上緣往下一點的地方（不貼著照片頂邊） */}
        {activeCategory === 'mask' && (() => {
          const mt = params.maskType ?? 'linear';
          const tip = maskPicking || !maskHasAny ? '選一種遮色片'
            : !params.maskCreated ? ({ linear: '在照片上拖曳，拉出線性漸層', radial: '從中心往外拖曳，畫出放射範圍', brush: '在要調整的地方塗抹', color: '點選要選取的顏色', luma: '點選照片，選取那一段亮度' } as Record<string, string>)[mt]
            : mt === 'color' ? '點其他地方可以換一個顏色' : mt === 'luma' ? '點照片可以重新取樣亮度' : '';
          if (!tip || isInteracting) return null;
          // 放在照片下緣往上一點（不貼著照片底邊，也不擋上面的工具列）
          const imgGap = previewFitSize && previewBoxSize.height ? Math.max(0, (previewBoxSize.height - previewFitSize.height) / 2) : 0;
          // 多圖編輯時下緣是縮圖列，提示改放在照片上緣往下一點
          if (srcList.length > 1) return <div data-mask-tip className="absolute left-1/2 -translate-x-1/2 z-[38] pointer-events-none px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[12px] text-white/90 whitespace-nowrap" style={{ top: Math.round(imgGap + 16) }}>{tip}</div>;
          // 左下角的參數膠囊出現時提示再往上讓一排，不疊在一起
          return <div data-mask-tip className="absolute left-1/2 -translate-x-1/2 z-[38] pointer-events-none px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-[12px] text-white/90 whitespace-nowrap" style={{ bottom: Math.round(imgGap + 16 + (maskCapsuleShown ? 46 : 0)), transition: 'bottom 260ms cubic-bezier(.22,1,.36,1)' }}>{tip}</div>;
        })()}
        
      {/* 批量編輯的縮圖列：跟「前後對比」同一排（畫面底部那一條），
            只有多張時才出現，浮在畫面上不佔版面 —— 單張時的編輯介面跟以前一樣。
            點一下＝換成預覽這一張；再點一下已選中的那張才會跳出小選單。 */}
        {saveState !== 'success' && srcList.length > 1 && (
          <div
            data-batch-strip
            className={`absolute bottom-2 left-[14px] right-[50px] ${activeToolId === 'curves' ? 'z-50' : 'z-30'}`}
          >
            {batchMenu !== null && (
              <div
                className="fixed inset-0 z-10"
                onPointerDown={(e) => { e.stopPropagation(); setBatchMenu(null); }}
              />
            )}
            {/* 左右各留 2px，選中的白框才不會被捲動列的邊緣切掉 */}
            {/* 縮圖列要壓在遮罩上面 —— 不然選單開著的時候，點縮圖的那一下會被遮罩吃掉，
                第二下就變成只是把選單關掉，看起來就是「點兩下沒反應」。
                選單打開時才在上面撐一大塊留白：捲動列是 overflow-x-auto，瀏覽器會把
                overflow-y 也一起變成 auto，往上彈的東西只要超出這個框就會被裁掉。
                留白算在框裡面，選單才看得到；再用等量的負 margin 拉回來，版面不變
                （pt 比 mt 多 4px，就是原本的 pt-1）。
                留白會蓋到上面的預覽，所以只在選單開著的時候才撐 —— 平常這條列
                就是一條普通的捲動列，手指照樣滑得動。 */}
            <div
              data-batch-row
              onPointerDown={(e) => { if (e.target === e.currentTarget) setBatchMenu(null); }}
              className={`relative z-20 flex items-end gap-1.5 overflow-x-auto no-scrollbar px-[2px] pb-1 ${
                batchMenu !== null ? 'pt-[100px] -mt-[96px]' : 'pt-1'
              }`}
            >
              {srcList.map((src, i) => {
                const on = linked[i] !== false;
                const active = i === safeIdx;
                return (
                  <div key={src + i} className={`relative shrink-0 ${batchMenu === i ? 'z-10' : ''}`}>
                    {/* 選單就掛在縮圖底下 —— 同一個 DOM 子樹，捲動時完全同步，一格都不會差 */}
                    {batchMenu === i && (
                      <div
                        className="absolute bottom-full mb-2 rounded-lg bg-[#1b1b1b] border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.6)] overflow-hidden"
                        style={{ left: batchMenuDx }}
                      >
                        <button
                          onClick={() => { toggleLink(i); setBatchMenu(null); }}
                          className="block w-full px-3 h-9 text-[11px] font-bold text-white/90 whitespace-nowrap text-left active:bg-white/10"
                        >
                          {on ? '取消連結' : '重新連結'}
                        </button>
                        <div className="h-px bg-white/10" />
                        <button
                          onClick={() => { removePhoto(i); setBatchMenu(null); }}
                          className="block w-full px-3 h-9 text-[11px] font-bold text-white/90 whitespace-nowrap text-left active:bg-white/10"
                        >
                          刪除
                        </button>
                      </div>
                    )}
                    <button
                      onPointerDown={(e) => beginThumbPress(i, e)}
                      onPointerMove={(e) => moveThumbPress(e)}
                      onPointerUp={(e) => endThumbPress(i, e, active)}
                      onPointerCancel={cancelThumbPress}
                      onContextMenu={(e) => e.preventDefault()}
                      title={`第 ${i + 1} 張`}
                      data-batch-thumb={i}
                      className={`block w-9 h-9 rounded-[4px] overflow-hidden bg-[#1a1a1a] transition-all active:scale-95 touch-manipulation select-none ${
                        active ? 'ring-[length:1.5px] ring-white' : ''
                      }`}
                    >
                      {/* 沒選中的不用半透明 —— 實心、壓暗就好，才不會透出後面的畫面。
                          src 一定要用縮好的小圖，不能掛原圖（見上面 stripThumbs 的說明）。
                          還沒縮好之前就留底色，這一格本來就只有 36px。 */}
                      {stripThumbs[src] && (
                        <img
                          src={stripThumbs[src]}
                          alt=""
                          draggable={false}
                          className={`w-full h-full object-cover pointer-events-none transition-all ${active ? '' : 'filter brightness-[0.5]'}`}
                        />
                      )}
                    </button>
                    {/* 連結中是白底黑線的鎖鏈、沒有斜線；解除連結的維持黑底白線、打叉 */}
                    <span className={`absolute -top-1 -right-1 w-[14px] h-[14px] rounded-full flex items-center justify-center pointer-events-none ${on ? 'bg-white' : 'bg-black'}`}>
                      <Icon name={on ? 'link' : 'link_off'} className={`text-[9px] leading-none ${on ? 'text-black' : 'text-white/80'}`} />
                    </span>
                  </div>
                );
              })}
              {onAddPhotos && (
                <button
                  onClick={() => { setBatchMenu(null); onAddPhotos(); }}
                  title="新增照片"
                  data-batch-add
                  className="shrink-0 w-9 h-9 rounded-[4px] bg-[#2e2e2e] flex items-center justify-center text-[#b9b9b9] active:scale-95 transition-all touch-manipulation"
                >
                  <Icon name="add" className="text-[16px] leading-none" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 合併：把現在畫面上的樣子烤進圖層，烤完才能再疊下一個特效／濾鏡。
             位置跟右下角的前後對比鍵左右對稱。
             只有「現在真的套著特效或濾鏡」時才出現 —— 合併過的參數已經歸零，不算。
             遮色片與調節這兩頁不出現：那兩頁在調的東西跟「烤進圖層」是兩回事，
             按鈕擺在那裡只會讓人以為是在合併遮色片。 */}
        {(hasMergeable || mergedCount > 0)
          && activeCategory !== 'mask' && activeCategory !== 'adjust' && (
          <button
            aria-label="合併特效"
            onClick={hasMergeable ? (e) => {
              /* 點下去的回饋：上面的菱形往下壓進下面那一層、再回到原位
                 （第一幀＝最後一幀＝原本的樣子）。時長與曲線跟創意拼圖「隨機圖案」
                 那顆一樣（680ms）。介面在按下的這一拍就切成合併完的樣子；
                 真正的烤圖（主執行緒會停一下）排在動畫之後，動畫才不會卡在半路 ——
                 合併前後畫面一模一樣，所以烤圖晚一點開始看不出來。 */
              const els = Array.from((e.currentTarget as HTMLElement).querySelectorAll('[data-merge-top]')) as Element[];
              let done: Promise<unknown> | undefined;
              if (els.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                for (const el of els) {
                  el.getAnimations().forEach(a => a.cancel());
                  const a = el.animate([
                    { transform: 'translateY(0)' },
                    { transform: 'translateY(3.5px)', offset: .4 },
                    { transform: 'translateY(0)' },
                  ], { duration: 680, easing: 'cubic-bezier(.22,1,.36,1)' });
                  done = a.finished.catch(() => {});
                }
              }
              mergeEffects(done);
            } : undefined}
            disabled={!hasMergeable}
            /* 固定寬度：底下的字會在「合併特效／合併濾鏡／已合併N」之間換，
               寬度跟著字變的話，置中在上面的圖標就會左右跳。 */
            /* 多圖編輯時左下角是縮圖列：以前合併鍵就藏在第一張縮圖底下，點縮圖稍微偏一點（縮圖之間的縫、
               縮圖上緣）就會按到看不見的合併 —— 濾鏡／特效突然變回「原始」、畫面卻還是套著的樣子。
               多張時往上挪到縮圖列上面，兩個永遠不會疊在一起。 */
            className={`absolute ${srcList.length > 1 ? 'bottom-[58px]' : 'bottom-2'} left-2 w-14 py-2 flex flex-col items-center justify-center gap-1 select-none touch-none z-20 text-white active:scale-90 transition-transform`}
          >
            {/* 兩個疊在一起的菱形：上面那片完整畫出來，下面那片被上面那片蓋住，
                只露出下半截（用遮罩挖掉上面那片的位置，遮罩跟著上面那片一起動）。
                線條要跟前後對比鍵「畫在螢幕上一樣粗」：34 的 viewBox 畫成 28px
                （0.824 倍），所以 strokeWidth 1.82 ≈ 1.5px。顏色寫死白色，
                不吃 currentColor（按鈕停用時會被瀏覽器調淡）。 */}
            <svg width="28" height="23" viewBox="0 0 34 28" fill="none" xmlns="http://www.w3.org/2000/svg"
                 className="block drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              <defs>
                <mask id={`${curveClipId}-merge`} maskUnits="userSpaceOnUse" x="0" y="0" width="34" height="28">
                  <rect width="34" height="28" fill="#fff" />
                  <path data-merge-top="" d="M17 2 30 9.5 17 17 4 9.5Z" fill="#000" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
                </mask>
              </defs>
              <path d="M17 8.5 30 16 17 23.5 4 16Z" stroke="#fff" strokeWidth="1.82" strokeLinejoin="round" mask={`url(#${curveClipId}-merge)`} />
              <path data-merge-top="" d="M17 2 30 9.5 17 17 4 9.5Z" stroke="#fff" strokeWidth="1.82" strokeLinejoin="round" />
            </svg>
            <span className="text-[9px] leading-none font-medium tracking-wide whitespace-nowrap drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              {hasMergeable
                ? (activeCategory === 'effects' ? '合併特效' : '合併濾鏡')
                : `已合併${mergedCount}`}
            </span>
          </button>
        )}

        {/* Compare Button */}
        {(() => {
        const compareButton = (
        <button
            aria-label="前後對比"
            /* 跟圖片、面板同一條曲線同一段時間移動；曲線時放在格子右下角 */
            style={{ bottom: activeToolId === 'curves' ? 22 : cmpFit ? cmpFit.mb + 16 : 8, transition: 'bottom 260ms cubic-bezier(.22,1,.36,1)' }}
            onPointerDown={(e) => { 
                e.preventDefault(); 
                try {
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                } catch(err) {}
                setShowOriginal(true); 
            }} 
            onPointerUp={(e) => { 
                e.preventDefault(); 
                try {
                    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                } catch(err) {}
                setShowOriginal(false); 
            }} 
            onPointerCancel={(e) => { 
                setShowOriginal(false); 
            }}
            className={`absolute bottom-2 right-2 p-3 flex items-center justify-center select-none touch-none transition-all active:scale-90 ${showOriginal ? 'text-white' : 'text-white/40'} ${activeToolId === 'curves' ? 'z-50' : isColourPanelTool(activeToolId) ? 'z-[45]' : 'z-20'}`}
        >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              <path d="M12 6H4.5C3.67157 6 3 6.67157 3 7.5V16.5C3 17.3284 3.67157 18 4.5 18H12" stroke="white" strokeWidth="1.5" />
              <line x1="12" y1="3" x2="12" y2="21" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M12 6H19.5C20.3284 6 21 6.67157 21 7.5V16.5C21 17.3284 20.3284 18 19.5 18H12" stroke="currentColor" strokeWidth="1.5" />
            </svg>
        </button>);
        return activeToolId === 'curves' && detailPanelHost ? createPortal(compareButton, detailPanelHost) : compareButton;
        })()}

        {/* --- HSL 面板 ---
             跟曲線一樣做成蓋在預覽上的浮層，而不是把底部功能欄撐高 ——
             底部那兩列（小分類、分頁）因此完全不會被推動。
             進出不做任何動畫：直接掛上、直接拿掉。 */}
        {detailPanelHost && createPortal(<AnimatePresence>
        {/* HSL 與色輪共用同一個面板外框（同一個 key）：
             兩者之間來回切換時外框不卸載、不做進出場，只換裡面的內容。
             兩者一樣高，圖片在兩個工具裡縮放一樣、切換時不會動。
             不用 backdrop-blur：底色幾乎不透明，模糊看不出來，但它讓進場那 260ms
             （圖片同時在縮）每一格都要重算一次整塊模糊，手機上就是偶爾卡一下。 */}
        {isColourPanelTool(activeToolId) && <motion.div key="hsl"
           initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0 } }} transition={{ duration: .26, ease: [.22, 1, .36, 1] }}
           data-hsl-panel
           className="absolute inset-x-0 bottom-0 z-40 bg-[#111] border-t border-white/5 overflow-hidden"
           style={{ height: COLOUR_PANEL_H }}
        >
        {activeToolId === 'grade' ? (
          <PrimariesPanel grade={params.grade} width={detailPanelHost.clientWidth || window.innerWidth}
            onStart={onGradeStart} onChange={onGradeChange} onCommit={onGradeCommit} />
        ) : (
<div className="w-full flex flex-col px-8 pt-2 pb-2">
              {/* 這一排伸進外層的左右內距裡（w = 100%+4rem 配 -mx-8），才排得下。
                  外層的 border box 是整個畫面寬，所以伸出去不會被裁掉。
                  內層用 w-max + mx-auto：排得下的時候自動置中，排不下的時候
                  margin 自己變 0 改成靠左捲 —— 直接用 justify-center 的話，
                  內容超出時第一顆會被切掉而且捲不回來。 */}
              <div className="w-[calc(100%+4rem)] -mx-8 px-1 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-2 w-max mx-auto py-1.5">
                {HSL_BANDS.map((band, i) => {
                  const on = hslBandIdx === i;
                  const touched = params.hsl && params.hsl[i] && (params.hsl[i].h !== 0 || params.hsl[i].s !== 0 || params.hsl[i].l !== 0);
                  return (
                    <button
                      key={band.id}
                      data-hsl-band={i}
                      onClick={() => setHslBandIdx(i)}
                      title={band.label}
                      className="shrink-0 flex flex-col items-center gap-1 group"
                    >
                      {/* 沒選中＝空心圈（4px，夠粗看得清楚）；選中＝實心。
                          邊框永遠寫死同一個顏色 —— 只留 background 在變。
                          之前選中時沒寫 border，transition-all 會把邊框顏色從色票色
                          補間到 Tailwind 的預設灰白，按下去就閃一圈白邊。 */}
                      <span
                        className={`block w-8 h-8 rounded-full transition-colors ${on ? '' : 'group-hover:opacity-90'}`}
                        style={{ border: `4px solid ${band.swatch}`, background: on ? band.swatch : 'transparent' }}
                      />
                      {/* 改過的記號放在按鈕下面、隔一點點。固定佔位只切換透明度，
                          高度才不會跳，也不會被捲動列的邊緣裁掉 */}
                      <span className={`w-1.5 h-1.5 rounded-full bg-white transition-opacity ${touched ? 'opacity-100' : 'opacity-0'}`} />
                    </button>
                  );
                })}
              </div>
              </div>
              {HSL_SLIDERS.map(sl => (
                <FastSlider
                  key={`${hslBandIdx}-${sl.key}`}
                  value={(params.hsl && params.hsl[hslBandIdx] ? params.hsl[hslBandIdx][sl.key] : 0)}
                  min={-100} max={100} step={1}
                  toolId={`hsl.${hslBandIdx}.${sl.key}`}
                  label={sl.label}
                  snapZero
                  compact
                  onUpdate={(id, val) => {
                    const [, bi, key] = id.split('.');
                    const cur = paramsRef.current;
                    const next = (cur.hsl || DEFAULT_HSL).map((b, i2) =>
                      i2 === Number(bi) ? { ...b, [key]: val } : b);
                    const p2 = { ...cur, hsl: next };
                    paramsRef.current = p2;
                    isDirtyRef.current = true;
                    lastSliderMoveTimeRef.current = performance.now();
                  }}
                  onInteractStart={() => setupFastPreview('hsl')}
                  onInteractEnd={() => {
                    setIsInteracting(false);
                    fastPreviewCacheRef.current.active = false;
                    setParams({ ...paramsRef.current });
                    addToHistory(paramsRef.current, selectedLutIdx);
                  }}
                  onReset={() => {
                    const cur = paramsRef.current;
                    const next = (cur.hsl || DEFAULT_HSL).map((b, i2) =>
                      i2 === hslBandIdx ? { ...b, [sl.key]: 0 } : b);
                    const p2 = { ...cur, hsl: next };
                    paramsRef.current = p2;
                    setParams(p2);
                    isDirtyRef.current = true;
                    addToHistory(p2, selectedLutIdx);
                  }}
                />
              ))}
            </div>
        )}
        </motion.div>}
        </AnimatePresence>, detailPanelHost)}

        {/* --- CURVE OVERLAY UI --- */}
        {detailPanelHost && createPortal(<AnimatePresence>
        {activeToolId === 'curves' && <motion.div key="curves" data-curves-panel
           /* 離開時直接收掉：留著淡出的話，下一個工具出現的那一下會看到這一層的殘影 */
           initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0 } }} transition={{ duration: .26, ease: [.22, 1, .36, 1] }}
           className="absolute left-0 right-0 z-40 flex flex-col items-center justify-end pb-2"
           style={{ height: '250px', bottom: 12, background: 'transparent', pointerEvents: 'none' }}
        >
           <div className="flex items-center justify-center w-full h-full relative pointer-events-none">
               {/* Wrapper to center the box, with controls anchored relative to it. Enable pointer events for children. */}
               {/* pointer-events 不會被祖先的 none 蓋掉：只要子孫自己寫 auto，
                   即使外層是 none 它照樣吃得到觸控。曲線收起來的時候這一塊
                   （240×240 的格子加左邊那排通道點）是看不見但還在原地的，
                   於是在預覽下半部拖曳就會被它攔走 —— 建立遮色片、拖預覽都會怪怪的。
                   所以這裡也要跟著開關。 */}
               <div className={`relative ${activeToolId === 'curves' ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                   
                   {/* Left Controls */}
                   {/* 色點與重置鍵都縮成 26px（原本 32px 的八成）。
                        原本是 justify-between 撐滿 242px，變小之後空隙會跟著變大，
                        所以改成置中＋固定 16px 間距（也是原本 20px 的八成）。 */}
                   <div className="absolute right-full top-0 h-[242px] flex flex-col justify-center items-center gap-4 pr-3">
                       {([['rgb', '#ffffff'], ['r', '#ff3b30'], ['g', '#4cd964'], ['b', '#007aff']] as const).map(([ch, col]) => (
                         <div
                           key={ch}
                           data-curve-channel={ch}
                           onClick={() => setCurrentCurveChannel(ch)}
                           className={`channel-dot ${currentCurveChannel === ch ? 'active' : ''}`}
                           style={{ color: col }}
                         />
                       ))}

                       {/* 跟色點一樣 32px，圖標自己畫：一圈開口的箭頭，
                           線粗跟色點的邊框同樣 3px，四顆排下來才是同一套東西。 */}
                       {/* 線用不透明的純白：text-white/70 那種帶 alpha 的顏色
                           畫出來是半透明的，底下的照片會透上來。 */}
                       <button onClick={resetAllCurves} className="w-[26px] h-[26px] shrink-0 flex items-center justify-center bg-transparent text-white active:scale-90 transition-transform" title="重置全部">
                           <svg viewBox="0 0 32 32" className="w-full h-full block" fill="none">
                               <path d="M26 16a10 10 0 1 1-3.1-7.25" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                               {/* 折角繞自己的頂點 (25.6,9.3) 逆時針轉 15°：原本兩臂剛好是
                                   正上與正左，尖角是規規矩矩的 90° 朝右下，看起來像鈍鉤不像箭頭。
                                   往逆時針轉尖端才會朝著弧線行進的外側，讀起來才是箭頭。
                                   整個折角再往左 0.8、往下 0.8，尖角才坐在弧線末端上。
                                   兩臂長度都還是 5.4。 */}
                               <path d="M23.4 4.88L24.8 10.1L19.58 11.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                           </svg>
                       </button>
                   </div>

                   {/* Curve Box */}
                   {/* 外框就是格線的最外面那一圈：跟裡面的線同色同粗，
                        整塊看起來才是一張完整的 4×4 格線。 */}
                   <div className="relative w-[240px] h-[240px] bg-transparent border border-white shrink-0 touch-none rounded-sm"
                        onMouseDown={handleCurveBgClick}
                        onTouchStart={handleCurveBgClick}
                   >
                       <svg id="curvesSvg" viewBox="0 0 200 200" className="absolute top-[-1px] left-[-1px] w-[240px] h-[240px] overflow-visible cursor-crosshair">
                           <defs><clipPath id={curveClipId}><rect width="200" height="200" /></clipPath></defs>
                           {/* 不用半透明：半透明的線會透出底下的照片，亮的地方看起來
                               忽隱忽現，而且交叉點疊了兩層 alpha 會比別處亮一塊。
                               改成不透明的實色，整張格線在哪都是同一個樣子。
                               non-scaling-stroke：viewBox 是 200 但畫出來是 240px，
                               不加的話 strokeWidth=1 會被放大成 1.2px，跟外框的
                               1px CSS border 對不齊，粗細看得出來不一樣。 */}
                           <g stroke="#fff" strokeWidth="1" shapeRendering="crispEdges" style={{ vectorEffect: 'non-scaling-stroke' }}>
                             {[50, 100, 150].map(v => (
                               <React.Fragment key={v}>
                                 <line x1={v} y1="0" x2={v} y2="200" style={{ vectorEffect: 'non-scaling-stroke' }} />
                                 <line x1="0" y1={v} x2="200" y2={v} style={{ vectorEffect: 'non-scaling-stroke' }} />
                               </React.Fragment>
                             ))}
                           </g>
                           <path 
                               ref={curvePathRef}
                               d={getCurvePathD()}
                               clipPath={`url(#${curveClipId})`}
                               fill="none" 
                               stroke={getCurveColor()} 
                               strokeWidth="1.5" 
                               strokeLinecap="round" 
                               strokeLinejoin="round" 
                               style={{ vectorEffect: 'non-scaling-stroke' }}
                           />
                           {params.curves[currentCurveChannel].map((p, i) => (
                               <circle 
                                   key={i}
                                   cx={(p.x / 255) * 200} cy={200 - ((p.y / 255) * 200)} r={window.innerWidth < 768 ? 6 : 4}
                                   className={`curve-point ${dragPointIdx === i ? 'active' : ''}`}
                                   style={{ fill: getCurveColor() }}
                                   onMouseDown={(e) => handlePointTap(e, i)}
                                   onTouchStart={(e) => handlePointTap(e, i)}
                               />
                           ))}
                       </svg>
                   </div>
               </div>
           </div>
        </motion.div>}
        </AnimatePresence>, detailPanelHost)}

        {/* 只是掛給 Tailwind 的瀏覽器版 JIT 看的，本身不畫任何東西 ——
             編輯器一開就讓它把構圖那些 class 的規則先產生好，
             使用者第一次點構圖時才不會先看到一幀沒有樣式的畫面。 */}
        <div aria-hidden="true" className={COMPOSE_WARMUP_CLASSES} style={{ display: 'none' }} />
        {/* 濾鏡頁滑桿上面那四顆開關的 class：先讓 JIT 產生規則，
             不然規則晚一幀到，那四顆會從「沒樣式」補間到「有樣式」（看起來像自己動了一下）。 */}
        <div aria-hidden="true" style={{ display: 'none' }}
             className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors border shrink-0 bg-white text-black border-white shadow-lg bg-white/5 text-white/40 border-white/10 hover:text-white/60 hover:border-white/25 gap-1.5 overflow-x-auto no-scrollbar py-1 max-w-[calc(100%-3.5rem)] flex-col px-2 py-2 text-[9px] font-medium whitespace-nowrap" />

      </div>

      {/* 構圖不能放在上面的 overflow-hidden 預覽盒裡：iOS 會連 fixed 子層一起裁切，
          造成後方的前後對比鍵露出、控制列斷開，舞台也被錯誤縮小。
          移成 safe-top 的直屬覆蓋層後，仍只覆蓋標題列與底部分頁列之間。 */}
      {activeCategory === 'compose' && draftGeo && (composePreviewRef.current || originalImgRef.current) && (
        <ComposeStudio
          image={composePreviewRef.current || originalImgRef.current!}
          geo={draftGeo}
          onChange={setDraftGeo}
          footerHeight={footerHeight}
          showFooterDivider
          stageLimit={composeStageLimitRef.current || previewFitSize}
          stageInset={16}
          alignCenter={previewAlign ? { x: previewAlign.left + previewAlign.width / 2, y: previewAlign.top + previewAlign.height / 2 } : null}
          onCancel={cancelCompose}
          onApply={() => {
            if (applyGeo(draftGeo)) addToHistory(paramsRef.current, selectedLutIdx);
            setDraftGeo(null);
            releaseComposePreview();
            setActiveCategory(beforeComposeRef.current.cat);
            setActiveToolId(beforeComposeRef.current.tool);
          }}
        />
      )}

      {/* 小分類列收起來時（遮色片建立中／構圖），這個外框的上緣會直接貼到
          分頁列自己的上緣邊線，兩條 1px 疊在一起看起來就是一條比較粗的線
          （量到亮度剖面多一列：正常只有 29，疊到的時候是 29 + 26）。
          那種狀態下就把外框這一條收掉，留分頁列自己那條。 */}
      <div
        onPointerDownCapture={() => { lastUiInputRef.current = performance.now(); }}
        className={`relative ${subStripHidden || activeToolId === 'curves' ? '' : 'border-t border-white/5'} flex flex-col shrink-0 z-[55]`}
        /* 一般、曲線、HSL 與特效細項都佔相同的總控制區高度；內容較少時只在
           內部留位，預覽區不再跟著分頁切換反覆變高變矮。構圖由自己的三列接管。 */
        style={{ height: `calc(11rem + ${footerHeight}px)`, background: activeToolId === 'curves' ? 'linear-gradient(to bottom, transparent 5rem, #111111 5rem)' : '#111111' }}
      >
        <div ref={setDetailPanelHost} style={{ position: 'absolute', left: 0, right: 0, top: '5rem', height: 0, zIndex: 60 }} />
        <div 
          className={`flex flex-col justify-center panel-ease transition-all overflow-hidden bg-[#111] px-8`}
          style={{
              /* 時間長度走 inline style，不要用 duration-0 / duration-[380ms] 這種 class。
                 這個 App 掛的是 Tailwind 的瀏覽器版 JIT，規則是「在 DOM 看到那個 class
                 才產生」的：duration-0 剛好就是進構圖的那一刻第一次出現，規則會晚一幀，
                 於是第一次進構圖時這一列是用 380ms 在收，預覽區高度連著動 20 幾幀，
                 ComposeStudio 的 ResizeObserver 每一幀重算舞台 —— 那就是閃爍。
                 第二次進來規則已經在了，所以只有第一次會發生。inline style 沒有這個問題。 */
              transitionDuration: '0ms',
              /* HSL 面板已經搬到預覽區上面當浮層了（跟曲線同一個做法），
                 所以這裡只要跟曲線一樣把滑桿列收成 0 就好。
                 這樣底部功能欄的高度變化跟開曲線時完全一樣，
                 小分類列與分頁列都待在原地不動。 */
              // 特效細項與其他工具維持同一個滑桿欄高度。
              height: activeCategory === 'compose' || ownPanel ? '0px' : '5rem',
              pointerEvents: sliderRowHidden ? 'none' : undefined,
              opacity: sliderRowHidden ? 0 : 1,
              /* 收起來時是 0px 而不是 none —— 寫 none 的話 border-color 會退回
                 currentColor（白的），transition 就從「幾乎不透明的白」補間到 5% 白，
                 離開曲線的瞬間底下會亮出一條白線（量到第一幀是 rgba(255,255,255,0.93)）。
                 兩邊寫同一個顏色，只讓寬度動，就沒有東西可以亮。 */
              borderBottom: sliderRowHidden ? '0px solid rgba(255, 255, 255, 0.05)' : '1px solid rgba(255, 255, 255, 0.05)'
          }}
        >
          {activeTool && !['lightLeak', 'softLight'].includes(activeToolId) && activeToolId !== 'curves' && !isColourPanelTool(activeToolId) && (
              <div className="w-full">
                  <FastSlider 
                      value={(() => {
                        const v = activeCategory === 'mask' ? (snapOf(params) as any)[activeTool.id] : params[activeTool.id as keyof EditorParams];
                        return typeof v === 'number' ? v : 0;
                      })()}
                      min={activeTool.min} max={activeTool.max} step={activeTool.step ?? 1}
                      toolId={activeTool.id} label={activeToolId === 'filter_select' ? '強度' : activeTool.label}
                      snapZero={activeTool.min < 0}
                      disabled={!!loadingLutId || maskLocked}
                      onUpdate={(id, val) => { 
                          if (id === 'blur') userManualBlurRef.current = val;
                          const nextParams = { ...paramsRef.current, [id]: val };
                          paramsRef.current = nextParams; 
                          lastSliderMoveTimeRef.current = performance.now();
                          if (id === 'maskBrushSize') showSizeRing(nextParams);
                          // 遮色片：疊層掛好之後每一格只更新疊層，不重跑整條管線
                          if (maskSliderLiveRef.current && maskLiveFrame(nextParams, maskRangeDragRef.current)) return;
                          isDirtyRef.current = true;
                      }}
                      onInteractStart={() => {
                          if (activeTool.id === 'maskBrushSize') showSizeRing(paramsRef.current);
                          if (activeCategory === 'mask' && paramsRef.current.maskCreated) {
                            maskSliderLiveRef.current = true;
                            maskRangeDragRef.current = MASK_TYPE_TOOL_LIST.some(t => t.id === activeTool.id);
                            primeMaskLive(paramsRef.current, maskRangeDragRef.current);
                          }
                          setupFastPreview(activeTool.id);
                      }}
                      onInteractEnd={() => { 
                          hideSizeRing();
                          if (maskSliderLiveRef.current) { maskSliderLiveRef.current = false; maskRangeDragRef.current = false; maskLiveKeyRef.current = ''; isDirtyRef.current = true; }
                          setIsInteracting(false); 
                          fastPreviewCacheRef.current.active = false; 
                          
                          // Check which parameters were modified and update states
                          const p = paramsRef.current;
                          const id = activeTool?.id;
                          
                          let activeS = isSoftActive;
                          let activeB = isBlurActive;
                          let activeG = isGrainActive;
                          let activeH = isHalationActive;
                          let manS = softManuallyAdjusted;
                          let manB = blurManuallyAdjusted;
                          let manG = grainManuallyAdjusted;
                          let manH = halationManuallyAdjusted;

                          if (id) {
                              if (['soft', 'softThreshold', 'softRadius', 'softColor'].includes(id)) {
                                  manS = true;
                                  setSoftManuallyAdjusted(true);
                                  userSoftRef.current = p.soft;
                                  activeS = p.soft > 0;
                                  setIsSoftActive(activeS);
                              } else if (id === 'blur') {
                                  manB = true;
                                  setBlurManuallyAdjusted(true);
                                  userBlurRef.current = p.blur;
                                  activeB = p.blur > 0;
                                  setIsBlurActive(activeB);
                              } else if (['grain', 'colorNoise', 'colorNoise2'].includes(id)) {
                                  manG = true;
                                  setGrainManuallyAdjusted(true);
                                  userGrainRef.current = {
                                      grain: p.grain,
                                      colorNoise: p.colorNoise,
                                      colorNoise2: p.colorNoise2
                                  };
                                  activeG = p.grain > 0 || p.colorNoise > 0 || p.colorNoise2 > 0;
                                  setIsGrainActive(activeG);
                              } else if (['fringeIntensity', 'fringeHue', 'fringeSize', 'fringeFeather'].includes(id)) {
                                  manH = true;
                                  setHalationManuallyAdjusted(true);
                                  userHalationRef.current = p.fringeIntensity;
                                  activeH = p.fringeIntensity > 0;
                                  setIsHalationActive(activeH);
                              }
                          }
                          
                          setParams({ ...p }); 
                          addToHistory(p, selectedLutIdx, activeS, activeB, activeG, activeH, manS, manB, manG, manH); 
                      }}
                      onReset={handleDoubleTap}
                      onValueClick={resetParam}
                      softActive={isSoftActive}
                      onToggleSoft={toggleSoftLight}
                      blurActive={isBlurActive}
                      onToggleBlur={toggleBlur}
                      grainActive={isGrainActive}
                      onToggleGrain={toggleGrain}
                      halationActive={isHalationActive}
                      onToggleHalation={toggleHalation}
                  />
              </div>
          )}
        </div>
        <div 
          ref={toolsScrollRef} 
          className="flex items-center px-4 overflow-x-auto no-scrollbar gap-2 bg-[#080808] panel-ease transition-all overflow-hidden"
          style={{
              // 同上：時間長度不能靠 class，不然第一次進構圖時規則還沒產生。
              transitionDuration: '0ms',
              // HSL 開著的時候小分類列照樣留著（跟曲線一樣）。收起來的話，
              // 面板下緣會往下掉 96px，整條工具列看起來就是往下沉了一次。
              // 構圖的小分類（裁切／角度／翻轉／梯形）由 ComposeStudio 自己畫在
              // 預覽區底部，這一列就讓給它，不然會有兩排小分類。
              // 特效細項時這一列讓給上面的滑桿群（高度剛好對調，總高不變）
              height: subStripHidden ? '0px' : '6rem',
              opacity: subStripHidden ? 0 : 1,
              /* 曲線的格子直接疊在這一列上面（滑桿列收起來了），補一條跟其他工具一樣的分隔線 */
              /* 遮色片在選種類的時候滑桿列也收起來了，一樣要補那條線 */
              borderTop: activeToolId === 'curves' || maskTypePicking ? '1px solid rgba(255, 255, 255, 0.05)' : undefined,
          }}
        >
          {activeCategory === 'filter' && lutList.map((lut, idx) => (
            <button key={lut.id} onClick={() => handleFilterSelect(idx)} data-filter-card={lut.id} className="flex flex-col items-center gap-2 shrink-0 group w-[64px]">
              {/* 沒選中時完全不畫邊框 —— 之前用 border-2 border-transparent，
                  那 2px 露出的是後面的底色，在縮圖旁邊看起來就是一圈灰框。
                  選中改用內描邊的 ring，畫在框內，不會影響版面也不會有位移。 */}
              <div className={`relative w-full h-[76px] rounded-lg transition-all bg-[#111] overflow-hidden ${loadingLutId === lut.id ? 'opacity-50' : 'opacity-100'}`}>
                {/* 縮圖＝目前這張預覽圖套上這顆濾鏡的樣子。
                    還沒算到的（或濾鏡檔還在下載的）先畫「原始」那一張，整排才不會有空洞。 */}
                <div className="absolute inset-0 bg-[#1a1a1a]" />
                <ThumbCanvas store={filterThumbStore} id={thumbKey(activeSrc, lut.id)}
                             fallbackId={thumbKey(activeSrc, lutList[0]?.id || '')}
                             painters={thumbPainters} attr="data-filter-thumb" name={lut.id} />
                {loadingLutId === lut.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                )}
                {/* 下半部壓一條深色帶，編號放在上面才讀得清楚 */}
                {/* pb-[2px] 是把選中時那條 2px 白線讓出來 ——
                    文字才會置中在「遮罩上緣」與「白線」之間，而不是整條帶子的正中間 */}
                <div className="absolute inset-x-0 bottom-0 h-[16px] bg-[#0b0b0b]/90 flex items-center justify-center pb-[2px]">
                  <span className={`text-[8px] font-black uppercase tracking-widest leading-none ${lutCardOn(idx) ? 'text-white' : 'text-white/60'}`}>
                    {lut.url ? lut.name : '原始'}
                  </span>
                </div>
                {lutCardOn(idx) && (
                  <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />
                )}
              </div>
            </button>
          ))}
          {activeCategory === 'adjust' && ADJUST_TOOLS.map(tool => (
            <button key={tool.id} onClick={() => setActiveToolId(tool.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}><Icon name={tool.icon} className="text-lg" fill={activeToolId === tool.id} /></div>
              <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${activeToolId === tool.id ? 'text-white' : 'text-white/20'}`}>{tool.label}</span>
              <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${isParamAdjusted(tool.id) ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
            </button>
          ))}
          {/* 特效改成跟濾鏡同一種卡片：縮圖是這個特效的預設效果，名稱壓在下緣。
               選中的那一顆右上角會多一顆編輯鍵（跟「調節」同一個圖標），按它才展開細項。 */}
          {/* 「原始」：排在最前面，點下去就是把所有特效關掉。
               縮圖直接用那張「沒套任何特效」的底圖。 */}
          {activeCategory === 'effects' && (
            <button data-fx-tool="fxNone" onClick={clearAllEffects}
                    className="flex flex-col items-center gap-2 shrink-0 group w-[64px]">
              <div className="relative w-full h-[76px] rounded-lg bg-[#111] overflow-hidden">
                <div className="absolute inset-0 bg-[#1a1a1a]" />
                <ThumbCanvas store={fxThumbStore} id={thumbKey(activeSrc, FX_THUMB_BASE)}
                             painters={thumbPainters} attr="data-fx-thumb" name={FX_THUMB_BASE} />
                <div className="absolute inset-x-0 bottom-0 h-[16px] bg-[#0b0b0b]/90 flex items-center justify-center pb-[2px]">
                  <span className={`text-[8px] font-black uppercase tracking-widest leading-none whitespace-nowrap ${noEffectOn ? 'text-white' : 'text-white/60'}`}>
                    原始
                  </span>
                </div>
                {noEffectOn && (
                  <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />
                )}
              </div>
            </button>
          )}
          {activeCategory === 'effects' && EFFECT_TOOLS.map(tool => (
            <button key={tool.id} data-fx-tool={tool.id} onClick={() => handleEffectToolSelect(tool.id)} className="flex flex-col items-center gap-2 shrink-0 group w-[64px]">
              <div className="relative w-full h-[76px] rounded-lg bg-[#111] overflow-hidden">
                {/* 這一格還沒算到就先畫沒套特效的底圖，整排才不會有空洞 */}
                <div className="absolute inset-0 bg-[#1a1a1a]" />
                <ThumbCanvas store={fxThumbStore} id={thumbKey(activeSrc, tool.id)}
                             fallbackId={thumbKey(activeSrc, FX_THUMB_BASE)}
                             painters={thumbPainters} attr="data-fx-thumb" name={tool.id} />
                <div className="absolute inset-x-0 bottom-0 h-[16px] bg-[#0b0b0b]/90 flex items-center justify-center pb-[2px]">
                  <span className={`text-[8px] font-black tracking-widest leading-none whitespace-nowrap ${isParamAdjusted(tool.id) ? 'text-white' : 'text-white/60'}`} style={{textTransform:'none'}}>
                    {tool.label}
                  </span>
                </div>
                {/* 選中的那一顆沿用濾鏡那圈內描邊，不佔版面也不會位移 */}
                {/* 白框＝這一顆正在生效。合併完參數就歸零，選取自然取消 ——
                     使用者才能把同一顆濾鏡／特效再套一次。 */}
                {(isEffectOn(tool.id) || pickedFxId === tool.id) && (
                  <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />
                )}
                {/* 編輯鍵：選中而且真的有細項可調才出現。
                     用 span 不用 button —— 這整張卡片本身就是一顆 button，
                     button 裡面不能再放 button。stopPropagation 讓它不會順便重選卡片。 */}
                {(isEffectOn(tool.id) || pickedFxId === tool.id) && effectHasDetail(tool.id) && (
                  <span
                    role="button"
                    aria-label="調整細項"
                    onClick={(e) => { e.stopPropagation(); openEffectDetail(tool.id); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    /* 位置與尺寸走 inline style：這幾個是全 App 唯一用到的 arbitrary class，
                       瀏覽器版 Tailwind 的 JIT 要等看到才產生規則，第一次會先畫錯一幀 */
                    style={{ position: 'absolute', top: 3, right: 3, width: 22, height: 22 }}
                    className="rounded-full flex items-center justify-center bg-black/55 text-white active:scale-90 transition-transform"
                  >
                    <Icon name="tune" className="text-[13px]" />
                  </span>
                )}
              </div>
            </button>
          ))}
          {activeCategory === 'soft' && (
             <div className="flex items-center gap-4">
                <button 
                    onClick={() => { setActiveCategory('effects'); setActiveToolId('softLight'); }}
                    className="flex flex-col items-center justify-center gap-2 shrink-0 group w-12"
                >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all text-white">
                        <Icon name="arrow_back" className="text-xl" />
                    </div>
                </button>
                <div className="w-[1px] h-8 bg-white/10 mx-2"></div>
                {SOFT_LIGHT_TOOLS.map(tool => (
                    <button key={tool.id} data-fx-param={tool.id} onClick={() => setActiveToolId(tool.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}><Icon name={effectDetailIcon(tool.label, tool.icon)} className="text-lg" fill={activeToolId === tool.id} /></div>
                        <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${activeToolId === tool.id ? 'text-white' : 'text-white/20'}`}>{tool.label}</span>
                        <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${isParamAdjusted(tool.id) ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
                    </button>
                ))}
             </div>
          )}
          {activeCategory === 'leak' && (
             <div className="flex items-center gap-4">
                <button 
                    onClick={() => { setActiveCategory('effects'); setActiveToolId('lightLeak'); }}
                    className="flex flex-col items-center justify-center gap-2 shrink-0 group w-12"
                >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all text-white">
                        <Icon name="arrow_back" className="text-xl" />
                    </div>
                </button>
                <div className="w-[1px] h-8 bg-white/10 mx-2"></div>
                {LEAK_TOOLS.map(tool => (
                    <button key={tool.id} data-fx-param={tool.id} onClick={() => setActiveToolId(tool.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}><Icon name={effectDetailIcon(tool.label, tool.icon)} className="text-lg" fill={activeToolId === tool.id} /></div>
                        <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${activeToolId === tool.id ? 'text-white' : 'text-white/20'}`}>{tool.label}</span>
                        <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${isParamAdjusted(tool.id) ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
                    </button>
                ))}
             </div>
          )}
          {activeCategory === 'halation' && (
             <div className="flex items-center gap-4">
                <button 
                    onClick={() => { setActiveCategory('effects'); setActiveToolId('halation'); }}
                    className="flex flex-col items-center justify-center gap-2 shrink-0 group w-12"
                >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all text-white">
                        <Icon name="arrow_back" className="text-xl" />
                    </div>
                </button>
                <div className="w-[1px] h-8 bg-white/10 mx-2"></div>
                {HALATION_TOOLS.map(tool => (
                    <button key={tool.id} data-fx-param={tool.id} onClick={() => setActiveToolId(tool.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}><Icon name={effectDetailIcon(tool.label, tool.icon)} className="text-lg" fill={activeToolId === tool.id} /></div>
                        <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${activeToolId === tool.id ? 'text-white' : 'text-white/20'}`}>{tool.label}</span>
                        <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${isParamAdjusted(tool.id) ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
                    </button>
                ))}
             </div>
          )}
          {activeCategory === 'fx' && (
             <div className="flex items-center gap-4">
                <button aria-label="返回特效" onClick={() => { setActiveCategory('effects'); setActiveToolId(activeFxId); }} className="flex flex-col items-center justify-center gap-2 shrink-0 group w-12">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all text-white"><Icon name="arrow_back" className="text-xl" /></div>
                </button>
                <div className="w-[1px] h-8 bg-white/10 mx-2" />
                {(FX_TOOLS[activeFxId] || []).map(tool => (
                    <button key={tool.id} data-fx-param={tool.id} onClick={() => setActiveToolId(tool.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                        <div className={'w-10 h-10 rounded-full flex items-center justify-center transition-all ' + (activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10')}><Icon name={tool.icon} className="text-lg" fill={activeToolId === tool.id} /></div>
                        <span className={'text-[9px] font-bold tracking-tighter whitespace-nowrap ' + (activeToolId === tool.id ? 'text-white' : 'text-white/20')}>{tool.label}</span>
                        <div className={'w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ' + (isParamAdjusted(tool.id) ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50')} />
                    </button>
                ))}
             </div>
          )}
          {activeCategory === 'mask' && (() => {
            /* 還沒有任何遮色片、或按了＋：這一列換成五種遮色片讓使用者選 */
            if (maskPicking || !maskHasAny || maskDeselected) return (
              <div data-mask-types className="flex items-center gap-2">
                {MASK_TYPES.map(([t, label]) => (
                  <button key={t} data-mask-type={t} onClick={() => addMask(t)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white/5 text-white/70 group-hover:bg-white/10"><MaskGlyph k={t} /></div>
                    <span className="text-[9px] font-bold tracking-tighter whitespace-nowrap text-white/60">{label}</span>
                    <div className="w-1 h-1 mt-0.5" />
                  </button>
                ))}
              </div>
            );
            const toolBtn = (id: string, label: string, glyph: React.ReactNode, on: boolean, onClick: () => void, dim = false, adjusted = false) => (
              <button key={id} data-mask-tool={id} disabled={dim} onClick={onClick} className={`flex flex-col items-center gap-1 shrink-0 group w-16 ${dim ? 'opacity-30' : ''}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${on ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}>{glyph}</div>
                <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${on ? 'text-white' : 'text-white/20'}`}>{label}</span>
                <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${adjusted ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
              </button>
            );
            /* 最左邊一顆切換鍵：調節（九個調整）⇄ 編輯（這個遮色片自己的參數）。線性漸層沒有自己的參數，就不放切換鍵 */
            const mt = (params.maskType ?? 'linear') as MaskType;
            const typeTools = MASK_TYPE_TOOLS[mt];
            const canEdit = typeTools.length > 0 || mt === 'brush';
            const mode = canEdit ? maskEditMode : 'adjust';
            const switchMode = (e: React.MouseEvent<HTMLButtonElement>) => {
              const next = mode === 'adjust' ? 'edit' : 'adjust';
              // 圖示先轉（直接改樣式，不等整個編輯器重畫完）
              const ic = e.currentTarget.querySelector<HTMLElement>('[data-mode-icon]');
              if (ic) ic.style.transform = next === 'edit' ? 'rotate(-90deg)' : 'none';
              uiFirstRef.current = true;
              setMaskEditMode(next);
              setActiveToolId(next === 'edit' ? (typeTools[0]?.id ?? MASK_TOOLS[0].id) : MASK_TOOLS[0].id);
            };
            return (
              <div className="flex items-center gap-2">
                {canEdit && (<>
                  <button data-mask-mode={mode} onClick={switchMode} aria-label={mode === 'adjust' ? '切換到編輯遮色片' : '切換到調節'}
                    className="flex flex-col items-center gap-1 shrink-0 w-12">
                    <div className="relative w-10 h-10 rounded-[12px] flex items-center justify-center bg-white/[0.08] text-white">
                      {/* 調節＝橫的調整圖示；編輯＝同一個逆時針轉 90 度（直式），切換時轉過去 */}
                      <span data-mode-icon className="flex transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ transform: mode === 'edit' ? 'rotate(-90deg)' : 'none' }}>
                        <Icon name="tune" className="text-[20px]" />
                      </span>
                      <span className="absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full bg-[#2a2a2a] flex items-center justify-center text-[10px] leading-none text-white/80">⇄</span>
                    </div>
                    <span className="text-[9px] font-bold tracking-tighter whitespace-nowrap text-white/70">{mode === 'adjust' ? '調節' : '編輯'}</span>
                    <div className="w-1 h-1 mt-0.5" />
                  </button>
                  <div className="w-[1px] h-8 bg-white/10 mx-0.5 shrink-0" />
                </>)}
                {mode === 'adjust'
                  ? MASK_TOOLS.map(tool => toolBtn(tool.id, tool.label, <Icon name={tool.icon} className="text-lg" fill={activeToolId === tool.id} />,
                    activeToolId === tool.id, () => { if (params.maskCreated && !maskDeselected) setActiveToolId(tool.id); }, !params.maskCreated || maskDeselected, isParamAdjusted(tool.id)))
                  : <>
                    {typeTools.map(t => toolBtn(t.id, t.label, <MaskGlyph k={t.icon} />, activeToolId === t.id, () => setActiveToolId(t.id)))}
                    {mt === 'brush' && toolBtn('maskBrushErase', '擦除', <MaskGlyph k="erase" />, !!params.maskBrushErase,
                      () => { const p = paramsRef.current; uiFirstRef.current = true; paramsRef.current = { ...p, maskBrushErase: !p.maskBrushErase }; flushParamsSync(); })}
                  </>}
              </div>
            );
          })()}
        </div>
        {ownPanel && !STUDIO_CATS.includes(activeCategory) && (
          <div key={activeCategory} data-edit-panel={activeCategory} className="flex-1 min-h-0 overflow-hidden bg-[#111] animate-in fade-in duration-200">
            {activeCategory === 'template' && <TemplatePanel />}
          </div>
        )}
        {/* 分類列：跟拼圖的照片編輯同一個元件（EditBar）。
            主頁進來的（fullTabs）多了七個分頁，一次看得到七個、可以左右滑。 */}
        {(() => {
          const enterCompose = () => {
              if (activeCategory === 'compose') return;
              if (activeCategory !== 'compose') beforeComposeRef.current = { cat: activeCategory, tool: activeToolId };
              // Capture the actual, already fitted preview before the compose
              // footer changes the available space. previewAspect is a {w,h}
              // object, never a numeric ratio; dividing by it produced NaN and
              // invalid crop geometry after the first pointer move.
              const bounds = previewFitRef.current?.getBoundingClientRect();
              composeStageLimitRef.current = bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0
                ? {width:bounds.width,height:bounds.height} : previewFitSize;
              const shown = visibleEditorCanvas();
              if (shown && isGeoIdentity(geo)) {
                const snapshot = document.createElement('canvas');
                snapshot.width = shown.width;
                snapshot.height = shown.height;
                snapshot.getContext('2d')?.drawImage(shown, 0, 0);
                composePreviewRef.current = snapshot;
              } else {
                composePreviewRef.current = originalImgRef.current;
              }
              setDraftGeo(geo);
              setActiveCategory('compose');
            };
          const effectsOn = ['effects', 'leak', 'soft', 'halation', 'fx'].includes(activeCategory);
          const tabs: [string, string, boolean, () => void][] = [
            ['filter', '濾鏡', activeCategory === 'filter', () => { setActiveCategory('filter'); setActiveToolId('filter_select'); }],
            ['adjust', '調節', activeCategory === 'adjust', () => { setActiveCategory('adjust'); setActiveToolId(ADJUST_TOOLS[0].id); }],
            ['effects', '特效', effectsOn, enterEffects],
            ['compose', '構圖', activeCategory === 'compose', enterCompose],
            ['mask', '遮色片', activeCategory === 'mask', () => { setActiveCategory('mask'); setActiveToolId(params.maskCreated ? MASK_TOOLS[0].id : MASK_DEFAULT_TOOL[(params.maskType ?? 'linear') as MaskType]); }],
          ];
          if (fullTabs) {
            const go = (c: Category) => () => {
              // 記住從哪一頁進美顏／仿色，按「完成」「取消」就回到那一頁
              if (STUDIO_CATS.includes(c) && !STUDIO_CATS.includes(activeCategory)) studioPrevRef.current = { cat: activeCategory, tool: activeToolId };
              setActiveCategory(c); setActiveToolId(c);
            };
            tabs.unshift(['template', '模板', activeCategory === 'template', go('template')]);
            tabs.push(
              ['beauty', '人像', activeCategory === 'beauty', go('beauty')],
              ['match', '仿色', activeCategory === 'match', go('match')],
            );
          }
          return (
            <EditBar scroll={fullTabs} className="mt-auto">
              {tabs.map(([id, label, on, fn]) => (
                <EditBarTab key={id} id={id} label={label} active={on} scroll={fullTabs}
                  onClick={() => { if (on && SELF_CONTAINED_TABS.includes(id)) return; leaveCategory(fn); }} />
              ))}
            </EditBar>
          );
        })()}
      </div>
      {/* 人像、仿色：直接用那兩個工具，蓋住編輯器（分類列留著，切分頁會自動套用）。
          兩個都一直掛著、只切換看不看得到：進出都是立刻的，不會先黑一下再載入。
          兩邊的欄位高度跟編輯器一樣，預覽大小相同，切換時圖片不會跳。 */}
      {fullTabs && (studiosWarm || STUDIO_CATS.includes(activeCategory)) && (
        <>
          <div data-studio-host="beauty" className={`absolute inset-x-0 top-0 z-[70] ${studioShown('beauty') ? '' : 'vis-off'}`} aria-hidden={activeCategory !== 'beauty'}
            style={{ bottom: footerHeight + 1, pointerEvents: activeCategory === 'beauty' ? 'auto' : 'none' }}>
            {beautyEl}
          </div>
          <div data-studio-host="match" className={`absolute inset-x-0 top-0 z-[70] ${studioShown('match') ? '' : 'vis-off'}`} aria-hidden={activeCategory !== 'match'}
            style={{ bottom: footerHeight + 1, pointerEvents: activeCategory === 'match' ? 'auto' : 'none' }}>
            {matchEl}
          </div>
        </>
      )}
      <input ref={matchRefInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setMatchRefSrc(URL.createObjectURL(f)); }} />
      {saveState === 'processing' && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white">正在存檔</p>
          {/* 這一層蓋住返回鍵，所以一定要有出口（見 StuckEscape） */}
          <StuckEscape onEscape={() => { ++saveRequestRef.current; saveBusyRef.current = false; setSaveState('idle'); }} />
        </div>
      )}
    </div>
  );
};
