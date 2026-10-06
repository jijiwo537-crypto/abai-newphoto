Warning: truncated output (original token count: 101906)
Total output lines: 7807


import { ComposeStudio, COMPOSE_WARMUP_CLASSES } from './ComposeStudio';
import { LUT_DEFAULT_AMOUNT } from '../utils/photoFx';
import { isIdentityCurve, boundedCurvePath } from '../utils/editorCurveGeometry';
import { loadCachedLut, saveCachedLut } from '../utils/lutStore';
import {repairLutAtlas,needsLutAtlasRepair,LUT_ATLAS_REPAIR_REVISION} from '../utils/lutAtlasRepair.js';
import { bakeColorLut, bakedToTexture } from '../utils/lutBake';
import { LutGpu } from '../utils/lutGpu';
import { FX_DEFS, FX_DEFAULTS, applyGlEffects, presentFxSource, disposeFxSurface, hasActiveFx, warmFx, type FxDef } from '../utils/glEffects';
import {warmLowfiLut} from '../utils/lowfiLut';
import { orderEffectCards } from '../utils/effectDisplayOrder';
import {effectControlValue,effectStoredValue,effectControlMin,effectControlStep,isContinuousEffectControl} from '../utils/effectControlValues';
import {effectPreset,LEGACY_EFFECT_PRESETS} from '../utils/effectPresets';
import {effectDetailIcon} from '../utils/effectDetailIcons';
import {HalationLayer} from '../utils/halationLayer';
import {highlightHistogram,selectHighlights,highlightWeight,luminanceBin} from '../utils/highlightSelection';
import { DEFAULT_GEO, FULL_CROP, GeoParams, composeCanvas, isGeoIdentity, sameGeoPixels, validGeo } from '../utils/compose';
import { SaveButton } from './SaveButton';
import { ExportActionLift } from './ExportActionLift';
/* IG 貼文預覽跟拼圖那兩個工具共用同一顆元件 */
import { IgPreview } from './IgPreview';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { addExport } from '../utils/exportHistory';
import { canvasToUrl, revokeUrls } from '../utils/blobUrl';
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
  temp: number; tint: number; sat: number; vib: number;
  sharpen: number; grain: number; soft: number; softThreshold: number;
  softRadius: number; softColor: number; lutAmount: number;
  vignette: number; blur: number; colorNoise: number; colorNoise2: number;
  leakOpacity: number; leakAngle: number; leakHue: number;
  fringeIntensity: number; fringeHue: number; fringeSize: number; fringeFeather: number;
  curves: Curves;
  hsl: HslAdjust;
  maskExposure: number;
  maskBrightness: number;
  maskContrast: number;
  maskHighlights: number;
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
/** HSL 面板的高度（量出來的，見上面的說明） */
const HSL_PANEL_H = 196;
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
  JSON.stringify(p.curves) + '#' + JSON.stringify(p.hsl ?? DEFAULT_HSL);

export const DEFAULT_PARAMS: EditorParams = {
  brightness: 0,
  exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  temp: 0, tint: 0, sat: 0, vib: 0,
  sharpen: 0, grain: 0, soft: 0, softThreshold: 80,
  softRadius: 100, softColor: 0, lutAmount: 100,
  vignette: 0, blur: 0, colorNoise: 0, colorNoise2: 0,
  leakOpacity: 0, leakAngle: 45, leakHue: 15,
  fringeIntensity: 0, fringeHue: 8, fringeSize: 10, fringeFeather: 100,
  curves: JSON.parse(JSON.stringify(DEFAULT_CURVES)),
  hsl: JSON.parse(JSON.stringify(DEFAULT_HSL)),
  maskExposure: 0,
  maskBrightness: 0,
  maskContrast: 0,
  maskHighlights: 0,
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

type Category = 'filter' | 'adjust' | 'effects' | 'leak' | 'soft' | 'grain' | 'halation' | 'mask' | 'compose' | 'fx';
type CurveChannel = 'rgb' | 'r' | 'g' | 'b';

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
  { id: 'maskHighlights', label: '高光', icon: 'wb_sunny', min: -100, max: 100 },
  { id: 'maskShadows', label: '陰影', icon: 'brightness_low', min: -100, max: 100 },
  { id: 'maskTemp', label: '色溫', icon: 'device_thermostat', min: -100, max: 100 },
  { id: 'maskTint', label: '色調', icon: 'colorize', min: -100, max: 100 },
  { id: 'maskSat', label: '飽和度', icon: 'palette', min: -100, max: 100 },
  { id: 'maskVib', label: '自然飽和度', icon: 'color_lens', min: -100, max: 100 },
];

const ADJUST_TOOLS: ToolDef[] = [
  { id: 'brightness', label: '亮度', icon: 'light_mode', min: -100, max: 100 },
  { id: 'exposure', label: '曝光', icon: 'brightness_6', min: -100, max: 100 },
  { id: 'contrast', label: '對比', icon: 'contrast', min: -100, max: 100 },
  { id: 'highlights', label: '高光', icon: 'wb_sunny', min: -100, max: 100 },
  { id: 'shadows', label: '陰影', icon: 'brightness_low', min: -100, max: 100 },
  { id: 'temp', label: '色溫', icon: 'device_thermostat', min: -100, max: 100 },
  { id: 'tint', label: '色調', icon: 'colorize', min: -100, max: 100 },
  { id: 'sat', label: '飽和度', icon: 'palette', min: -100, max: 100 },
  { id: 'vib', label: '自然飽和度', icon: 'color_lens', min: -100, max: 100 },
  { id: 'curves', label: '曲線', icon: 'show_chart', min: 0, max: 0 }, // Curves tool
  // 不能再用 gradient —— 那是下面「遮色片」分頁在用的圖標，兩個長一樣會混淆
  { id: 'hsl', label: 'HSL', icon: 'invert_colors', min: 0, max: 0 },   // HSL tool
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
  FX_DEFS.map(d => [d.id, [
    { id: d.id, label: '強度', icon: effectDetailIcon('強度', d.icon), min: 0, max: 100 },
    // hidden 的那幾根不給調整（值永遠是預設），介面上就不要出現
    ...d.params.filter(p => !p.hidden)
      .map(p => ({ id: p.id, label: p.label, icon: effectDetailIcon(p.label, p.icon), min: p.min, max: p.max, step: p.step })),
  ] as ToolDef[]]),
);

/** 最外層那根滑桿要改調哪一個參數（沒設就是調「強度」）。
    來源是 FX_DEFS 的 rootParam，跟拼圖那邊讀同一份定義。 */
const FX_ROOT_PARAM: Record<string, ToolDef> = Object.fromEntries(
  FX_DEFS.filter(d => d.rootParam).map(d => {
    const p = d.params.find(x => x.id === d.rootParam)!;
    return [d.id, { id: p.id, label: p.label, icon: effectDetailIcon(p.label, p.icon), min: p.min, max: p.max, step: p.step } as ToolDef];
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
    source: Uint8ClampedArray | null;
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

            <div style={dense ? {touchAction:'pan-y'} : undefined} className={`relative flex items-center justify-center touch-none ${dense ? 'slider-wrap h-[26px]' : compact ? 'h-[30px]' : 'h-12'}`}>
                <input 
                    ref={inputRef}
                    type="range" aria-label={label} min={effectControlMin(toolId,min)} max={max} step={effectControlStep(toolId,step)}
                    data-smooth-range={isContinuousEffectControl(toolId)?'true':undefined}
                    defaultValue={displayValue}
                    data-fine-drag={dense ? 'true' : undefined}
                    style={dense ? {left:0,width:'100%',height:26,margin:'-13px 0 0',touchAction:'pan-y','--thumb-w':'18px'} as React.CSSProperties : undefined}
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
type ThumbEntry = { cvs: HTMLCanvasElement; pixels?: ImageData; v: number; sig: string };
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
  e.pixels = frame;
  /* 像素與備援畫布都完整寫完後才發布版本。 */
  e.sig = sig;
  e.v++;
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
const ThumbCanvas: React.FC<{
  store: ThumbStore; id: string; fallbackId?: string; painters: ThumbPainters; attr: string; name: string;
}> = ({ store, id, fallbackId, painters, attr, name }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = useRef('');
  const paint = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const own = store.current[id];
    const e = own || (fallbackId ? store.current[fallbackId] : undefined);
    // 兩份都還沒有時清掉舊照片，不能把上一張／上一顆濾鏡的殘片冒充新縮圖。
    if (!e) {
      if (el.width && el.height) el.getContext('2d')?.clearRect(0, 0, el.width, el.height);
      drawn.current = '';
      el.dataset.thumbReady = '0';
      return;
    }
    const key = `${own ? id : fallbackId}#${e.v}`;
    if (drawn.current === key) return;      // 沒換內容就不要重畫
    drawn.current = key;
    const cx = el.getContext('2d')!;
    /* 畫之前一定要先清空。
       drawImage 是「疊上去」不是「換掉」：新的縮圖只要有任何一塊不是完全
       不透明（像素管線算出來的 alpha 不見得每一格都剛好 255），上一張留在
       這塊畫布上的內容就會從那些地方透出來，跟新的混在一起 —— 看起來就是
       「縮圖有一部分怪怪的」，而且離開分頁再回來（畫布重建、內容是空的）
       就恢復正常。這正是主人描述的那個現象。
       重設 width／height 本來就會順便清空，但尺寸沒變時不會走那條路，
       所以這裡明確清一次。 */
    if (el.width !== e.cvs.width || el.height !== e.cvs.height) { el.width = e.cvs.width; el.height = e.cvs.height; }
    /* 跟倉庫同樣以完整 CPU 幀一次提交；若是舊快取沒有 pixels 才退回 canvas。 */
    if (e.pixels) cx.putImageData(e.pixels, 0, 0);
    else {
      cx.save();
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalAlpha = 1;
      cx.filter = 'none';
      cx.globalCompositeOperation = 'copy';
      cx.drawImage(e.cvs, 0, 0);
      cx.restore();
    }
    el.dataset.thumbReady = own ? '1' : '0';
  }, [store, id, fallbackId]);
  /* useLayoutEffect：卡片是每次進頁才掛上來的，排在 useEffect 的話
     瀏覽器會先畫一幀空白畫布，下一幀才補上圖 —— 那就是「一進特效頁閃一下」。 */
  useLayoutEffect(() => {
    const set = painters.current;
    set.add(paint);
    paint();                                 // 剛掛上來（或換照片）先補畫一次
    return () => { set.delete(paint); };
  }, [painters, paint]);
  const props: any = { [attr]: name };
  return <canvas ref={ref} {...props} className="absolute inset-0 w-full h-full object-cover" />;
};

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

export const ImageEditor: React.FC<ImageEditorProps> = ({ histKey, imageSrc, batchSrcs, onAddPhotos, lutList, onSave, onCancel, onHome, onRequestExit, onImportNew, originalFile, initialState, compactBottomBar = false }) => {
  const curveClipId = React.useId();
  /* 主頁入口逐層沿用 ImageAdjustPanel 的 64px 內容 + 12px 底距；相機內的
     非 compact 編輯器維持既有 48px。這個值也同步參與控制區與構圖舞台計算。 */
  const footerHeight = compactBottomBar ? 76 : 48;
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
  srcListRef.current = srcList;
  useEffect(() => { setSrcList(incoming); }, [batchSrcs, imageSrc]);
  const [batchIdx, setBatchIdx] = useState(0);
  /** 再點一次已經選中的那張才會跳出的小選單 */
  const [batchMenu, setBatchMenu] = useState<number | null>(null);
  const safeIdx = Math.min(batchIdx, Math.max(0, srcList.length - 1));
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
  useEffect(() => () => { const keep = finalImagesRef.current; setTimeout(() => revokeUrls(keep as any), 15000); }, []);
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
  const pickMask = (p: EditorParams): Partial<EditorParams> => {
    const out: any = {};
    Object.keys(p).forEach(k => { if (isOwnKey(k)) out[k] = (p as any)[k]; });
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
  /** 切換要預覽哪一張 */
  const switchTo = (i: number) => {
    if (i === safeIdx || i < 0 || i >= srcList.length) return;
    setBatchMenu(null);
    stashCurrent();
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
    if (!paintWarmNow(srcList[i], pendingSnapRef.current || liveRef.current) && !instant) setIsSwitching(true);
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
    type: 'center' | 'start' | 'end' | 'rotate' | 'create';
    startX: number;
    startY: number;
    initialCx: number;
    initialCy: number;
    initialAngle: number;
    initialD: number;
  } | null>(null);

  const updateCanvasBounds = useCallback(() => {
    const canvas = displayCanvasRef.current;
    if (canvas) {
      const parent = canvas.offsetParent as HTMLElement | null;
      if (parent) {
        // 遮色片 SVG 和 canvas 一起位于缩放层内，所以这里必须保存「层内坐标」，
        // 不能用 getBoundingClientRect()：后者包含当前缩放倍率，复位 transform 又
        // 不会触发 ResizeObserver，之后创建的遮色片就会沿用放大后的错误尺寸。
        setCanvasBounds({
          width: canvas.offsetWidth,
          height: canvas.offsetHeight,
          top: canvas.offsetTop,
          left: canvas.offsetLeft,
        });
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

  const handleMaskPointerDown = (e: React.PointerEvent<SVGElement>, type: 'center' | 'start' | 'end' | 'rotate' | 'create') => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch(err) {}

    const canvasRect = displayCanvasRef.current?.getBoundingClientRect();
    if (!canvasRect?.width || !canvasRect.height) return;
    // 手势坐标先按画布当前的屏幕矩形正规化，再换回 SVG 的层内尺寸。
    // 因此即使图片仍在缩放复位动画中，遮色片也不会产生倍率或位移误差。
    const canvasX = ((e.clientX - canvasRect.left) / canvasRect.width) * canvasBounds.width;
    const canvasY = ((e.clientY - canvasRect.top) / canvasRect.height) * canvasBounds.height;

    const p = paramsRef.current;

    activeDragRef.current = {
      type,
      startX: canvasX,
      startY: canvasY,
      initialCx: p.maskCx * canvasBounds.width,
      initialCy: p.maskCy * canvasBounds.height,
      initialAngle: p.maskAngle,
      initialD: p.maskD * canvasBounds.width,
    };
    
    if (type === 'create') {
      setIsInitialCreatingMask(true);
    }

    // 新的一次拖曳：離屏那兩份都重算一次，不要沿用上一次留下來的
    maskAdjKeyRef.current = '';
    maskBaseKeyRef.current = '';

    setIsInteracting(true);
  };

  const handleMaskPointerMove = (e: React.PointerEvent<SVGElement>) => {
    if (!activeDragRef.current) return;
    
    const canvasRect = displayCanvasRef.current?.getBoundingClientRect();
    if (!canvasRect?.width || !canvasRect.height) return;
    const canvasX = ((e.clientX - canvasRect.left) / canvasRect.width) * canvasBounds.width;
    const canvasY = ((e.clientY - canvasRect.top) / canvasRect.height) * canvasBounds.height;

    const drag = activeDragRef.current;
    const p = { ...paramsRef.current };

    const cWidth = canvasBounds.width;
    const cHeight = canvasBounds.height;

    if (drag.type === 'create') {
      const dx = canvasX - drag.startX;
      const dy = canvasY - drag.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 5) {
        p.maskCreated = true;
        p.maskShowOverlay = true;
        const absoluteCx = drag.startX + dx / 2;
        const absoluteCy = drag.startY + dy / 2;
        p.maskCx = absoluteCx / cWidth;
        p.maskCy = absoluteCy / cHeight;
        p.maskD = Math.max(8, dist / 2) / cWidth;
        p.maskAngle = Math.atan2(dy, dx);
      }
    } else if (drag.type === 'center') {
      const dx = canvasX - drag.startX;
      const dy = canvasY - drag.startY;
      const absoluteCx = drag.initialCx + dx;
      const absoluteCy = drag.initialCy + dy;
      p.maskCx = Math.max(0, Math.min(1, absoluteCx / cWidth));
      p.maskCy = Math.max(0, Math.min(1, absoluteCy / cHeight));
    } else if (drag.type === 'end' || drag.type === 'start') {
      const dx = canvasX - drag.startX;
      const dy = canvasY - drag.startY;
      const cos0 = Math.cos(drag.initialAngle);
      const sin0 = Math.sin(drag.initialAngle);
      
      const deltaNormal = dx * cos0 + dy * sin0;

      let newD = drag.initialD;
      if (drag.type === 'end') {
        newD = Math.max(8, drag.initialD + deltaNormal);
      } else {
        newD = Math.max(8, drag.initialD - deltaNormal);
      }
      p.maskD = newD / cWidth;
    } else if (drag.type === 'rotate') {
      const initialMouseAngle = Math.atan2(drag.startY - drag.initialCy, drag.startX - drag.initialCx);
      const currentMouseAngle = Math.atan2(canvasY - drag.initialCy, canvasX - drag.initialCx);
      
      let angleDiff = currentMouseAngle - initialMouseAngle;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      p.maskAngle = drag.initialAngle + angleDiff;
    }

    paramsRef.current = p;
    isDirtyRef.current = true;
    scheduleParamsSync();
  };

  const handleMaskPointerUp = (e: React.PointerEvent<SVGElement>) => {
    if (!activeDragRef.current) return;

    const drag = activeDragRef.current;
    const p = { ...paramsRef.current };

    if (drag.type === 'create') {
      const currentD = p.maskD * canvasBounds.width;
      if (currentD < 15) {
        p.maskCreated = false;
      }
      setIsInitialCreatingMask(false);
    }

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch(err) {}

    activeDragRef.current = null;
    setIsInteracting(false);
    paramsRef.current = p;
    flushParamsSync();
  };

  // Single Canvas for all rendering
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fxSurfaceRef=useRef<HTMLCanvasElement>(null);
  const fxSurfaceShownRef=useRef(false);
  const fxInputKeyRef=useRef('');
  const legacyPreviewRef=useRef<{kind:'soft'|'halation'|'leak';key:string}|null>(null);
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
  useLayoutEffect(()=>{showFxSurface(false);fxInputKeyRef.current='';},[activeSrc]);
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
      hslRef: HslAdjust | null;
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
  const FILTER_CACHE_KEEP = 6;
  const cacheOrderRef = useRef<string[]>([]);
  const cacheFilterPixels = useCallback((lutId: string, p: EditorParams, w: number, h: number, lut0: Uint8ClampedArray, lut100: Uint8ClampedArray | null) => {
    const key = cacheKeyOf(lutId, w);
    const order = cacheOrderRef.current;
    const at = order.indexOf(key);
    if (at >= 0) order.splice(at, 1);
    order.push(key);
    while (order.length > FILTER_CACHE_KEEP) {
      const drop = order.shift()!;
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
      const finish = (img: HTMLImageElement) => {
        if (!alive) return resolve();
        try {
          const c = document.createElement('canvas');
          c.width = STRIP_THUMB; c.height = STRIP_THUMB;
          const cx = c.getContext('2d')!;
          cx.imageSmoothingQuality = 'high';
          const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
          const k = Math.max(STRIP_THUMB / sw, STRIP_THUMB / sh);
          cx.drawImage(img, (STRIP_THUMB - sw * k) / 2, (STRIP_THUMB - sh * k) / 2, sw * k, sh * k);
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
      viewedImgRef.current.delete(oldest);
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
      const queue = srcList.filter((u, i) => u !== activeSrc && linked[i] !== false);
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
     …51906 tokens truncated…[id];
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
    scheduleParamsSync();
  };
  
  const handleCurveEndDrag = () => {
      flushParamsSync();
      setDragPointIdx(-1);
      setIsInteracting(false);
      addToHistory(paramsRef.current, selectedLutIdx);
  };

  const handlePointTap = (e: React.MouseEvent | React.TouchEvent, idx: number) => {
      e.stopPropagation();
      const now = Date.now();
      const isRecentCreate = lastCreatedIdxRef.current === idx && (now - lastCreatedTimeRef.current < 350);
      if (!isRecentCreate && (now - lastCurveTapRef.current < 300)) {
          const currentPoints = [...params.curves[currentCurveChannel]];
          if (currentPoints.length > 2 && idx > 0 && idx < currentPoints.length - 1) {
              currentPoints.splice(idx, 1);
              const newCurves = { ...params.curves, [currentCurveChannel]: currentPoints };
              setParams(prev => ({ ...prev, curves: newCurves }));
              addToHistory({ ...params, curves: newCurves }, selectedLutIdx);
          }
          lastCurveTapRef.current = 0;
      } else {
          lastCurveTapRef.current = now;
          handleCurveStartDrag(e, idx);
      }
  };
  
  const handleCurveBgClick = (e: React.MouseEvent | React.TouchEvent) => {
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
         lastCreatedTimeRef.current = Date.now();
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
          touch-action: pan-y;
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
          disabled={activeCategory === 'mask'}
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
                  transition: hslSwitch && activeCategory !== 'compose' ? 'width 260ms cubic-bezier(.22,1,.36,1), height 260ms cubic-bezier(.22,1,.36,1), margin-bottom 260ms cubic-bezier(.22,1,.36,1)' : 'none',
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
                <canvas ref={fxSurfaceRef} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none rounded-sm" style={{visibility:'hidden',objectFit:'fill'}} />

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
                    /* 一定要 overflow-hidden：那兩條「無限長」的邊界線是 y=±10000 畫的，
                       overflow-visible 會讓它們一路畫到整個螢幕上（照片外面、
                       連工具列那一帶都是線），而且線上的 18px 觸控帶也跟著跑出去。
                       SVG 預設就是裁切到自己的框，這裡把它拿回來。 */
                    className="absolute inset-0 w-full h-full select-none pointer-events-auto overflow-hidden z-30"
                    style={{
                      touchAction: 'none',
                    }}
                    onPointerMove={handleMaskPointerMove}
                    onPointerUp={handleMaskPointerUp}
                    onPointerCancel={handleMaskPointerUp}
                  >
                  {/* Background hit area to create mask by dragging */}
                  {!params.maskCreated && (
                    <rect
                      id="ui-bg-hit"
                      width="100%"
                      height="100%"
                      fill="transparent"
                      style={{ cursor: 'crosshair' }}
                      onPointerDown={(e) => handleMaskPointerDown(e, 'create')}
                    />
                  )}

                  <g transform={`translate(${canvasBounds.left}, ${canvasBounds.top})`}>
                    {/* Vector guides */}
                    {params.maskCreated && !(isInteracting && !activeDragRef.current) && (
                      <g
                        id="ui-guides"
                      style={{
                        willChange: 'transform',
                      }}
                      transform={`translate(${params.maskCx * canvasBounds.width}, ${params.maskCy * canvasBounds.height}) rotate(${(params.maskAngle * 180) / Math.PI})`}
                    >
                      {/* Connecting axis line */}
                      <line
                        className="pointer-events-none"
                        x1={-params.maskD * canvasBounds.width}
                        y1={0}
                        x2={params.maskD * canvasBounds.width}
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
                        transform={`translate(${params.maskD * canvasBounds.width}, 0)`}
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
                      <g transform={`translate(${-params.maskD * canvasBounds.width}, 0)`}>
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
                      <g transform={`translate(${params.maskD * canvasBounds.width}, 0)`}>
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
                  </g>
                </svg>
              </>
              )}
              </div>
            </div>
          </TransformComponent>
        </TransformWrapper>

        {/* Mask creation Hint/Instruction card */}
        {activeCategory === 'mask' && (
          <AnimatePresence>
            {!params.maskCreated && !isInitialCreatingMask && !dismissedMaskHint && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: [0.215, 0.61, 0.355, 1] }}
                className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-20 select-none"
              >
                {/* 卡片本身不能吃手勢：它就蓋在照片正中央，吃掉的話
                    「請在圖片上拖曳」這句話等於騙人 —— 拖過去根本畫不出來。
                    只有下面那顆「我知道了」需要點得到。 */}
                <div className="flex flex-col items-center gap-4 bg-[#111111] px-8 py-6 rounded-3xl border border-white/10 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.8)] max-w-xs text-center pointer-events-none">
                  {/* Animated Drawing Gesture Visual */}
                  <div className="relative w-20 h-16 flex items-center justify-center mb-1">
                    {/* Breathing circle 1 */}
                    <motion.div 
                      animate={{ 
                        scale: [1, 1.8, 1],
                        opacity: [0.15, 0.4, 0.15]
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className="absolute w-10 h-10 rounded-full bg-white/20"
                    />
                    {/* Drawing pointer indicator */}
                    <motion.div
                      animate={{
                        x: [-24, 24, -24],
                        y: [-12, 12, -12],
                        scale: [0.95, 1.1, 0.95],
                      }}
                      transition={{
                        duration: 2.5,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className="relative z-10 flex items-center justify-center"
                    >
                      <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.6)] border border-black/10">
                        <Icon name="gesture" className="text-[12px] text-black" />
                      </div>
                      {/* Trailing dash line effect */}
                      <svg className="absolute overflow-visible pointer-events-none w-24 h-12 -z-10" viewBox="0 0 100 50">
                        <motion.path
                          d="M 20 15 Q 50 35 80 15"
                          fill="none"
                          stroke="rgba(255,255,255,0.3)"
                          strokeWidth="2"
                          strokeDasharray="4 4"
                          animate={{
                            strokeDashoffset: [0, -20]
                          }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                            ease: "linear"
                          }}
                        />
                      </svg>
                    </motion.div>
                  </div>
                  
                  <div className="space-y-1.5">
                    <h4 className="text-[12px] font-black text-white uppercase tracking-[0.2em]">建立遮色片</h4>
                    <p className="text-[10px] text-white/50 leading-relaxed font-medium">請在圖片上拖曳，繪製出遮色片</p>
                  </div>

                  <button
                    onClick={() => setDismissedMaskHint(true)}
                    className="pointer-events-auto w-full mt-2 py-2 px-4 bg-white/10 hover:bg-white/20 active:scale-95 text-white text-[11px] font-bold rounded-xl transition-all uppercase tracking-[0.1em]"
                  >
                    我知道了
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        
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
            onClick={hasMergeable ? mergeEffects : undefined}
            disabled={!hasMergeable}
            className="absolute bottom-2 left-2 px-2 py-2 flex flex-col items-center justify-center gap-1 select-none touch-none z-20 text-white"
          >
            {/* 疊在一起的兩層（沒有箭頭）：扁，寬度比前後對比鍵窄一點。
                線條要跟前後對比鍵「畫在螢幕上一樣粗」，而不是屬性寫一樣的數字：
                那一顆是 24 的 viewBox 畫成 24px（1:1），這一顆是 34 的 viewBox
                畫成 28px（0.824 倍），所以 strokeWidth 要除回去 —— 1.5 / (28/34)
                ≈ 1.82，畫出來才剛好是 1.5px。以前寫 1.2 的實際粗度只有 0.99px，
                不滿一個像素就會被抗鋸齒攤成灰的，看起來就像半透明。
                顏色也直接寫死白色，不吃 currentColor（按鈕停用時會被瀏覽器調淡）。 */}
            <svg width="28" height="18" viewBox="0 0 34 22" fill="none" xmlns="http://www.w3.org/2000/svg"
                 className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              <path d="M17 2.5 30 8.5 17 14.5 4 8.5Z" stroke="#fff" strokeWidth="1.82" strokeLinejoin="round" />
              <path d="M4 13 17 19 30 13" stroke="#fff" strokeWidth="1.82" strokeLinecap="round" strokeLinejoin="round" />
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
            style={{ bottom: activeToolId === 'curves' ? 270 : activeToolId === 'hsl' && hslFit ? hslFit.mb + 16 : 8, transition: 'bottom 260ms ease' }}
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
            className={`absolute bottom-2 right-2 p-3 flex items-center justify-center select-none touch-none transition-all active:scale-90 ${showOriginal ? 'text-white' : 'text-white/40'} ${activeToolId === 'curves' ? 'z-50' : 'z-20'}`}
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
        {activeToolId === 'hsl' && <motion.div key="hsl"
           initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} transition={{ duration: .26, ease: [.22, 1, .36, 1] }}
           data-hsl-panel
           className="absolute inset-x-0 bottom-0 z-40 px-8 pt-2 pb-2 bg-[#111]/95 backdrop-blur-xl border-t border-white/5"
        >
<div className="w-full flex flex-col">
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
        </motion.div>}
        </AnimatePresence>, detailPanelHost)}

        {/* --- CURVE OVERLAY UI --- */}
        {detailPanelHost && createPortal(<AnimatePresence>
        {activeToolId === 'curves' && <motion.div key="curves" data-curves-panel
           initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} transition={{ duration: .26, ease: [.22, 1, .36, 1] }}
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
              height: activeCategory === 'compose' ? '0px' : '5rem',
              pointerEvents: sliderRowHidden ? 'none' : undefined,
              opacity: sliderRowHidden ? 0 : 1,
              /* 收起來時是 0px 而不是 none —— 寫 none 的話 border-color 會退回
                 currentColor（白的），transition 就從「幾乎不透明的白」補間到 5% 白，
                 離開曲線的瞬間底下會亮出一條白線（量到第一幀是 rgba(255,255,255,0.93)）。
                 兩邊寫同一個顏色，只讓寬度動，就沒有東西可以亮。 */
              borderBottom: sliderRowHidden ? '0px solid rgba(255, 255, 255, 0.05)' : '1px solid rgba(255, 255, 255, 0.05)'
          }}
        >
          {activeTool && !['lightLeak', 'softLight'].includes(activeToolId) && activeToolId !== 'curves' && activeToolId !== 'hsl' && (
              <div className="w-full">
                  <FastSlider 
                      value={typeof params[activeTool.id as keyof EditorParams] === 'number' ? params[activeTool.id as keyof EditorParams] as number : 0}
                      min={activeTool.min} max={activeTool.max} step={activeTool.step ?? 1}
                      toolId={activeTool.id} label={activeToolId === 'filter_select' ? '強度' : activeTool.label}
                      snapZero={activeTool.min < 0}
                      disabled={!!loadingLutId || maskLocked}
                      isMaskCategory={activeCategory === 'mask'}
                      maskLocked={maskLocked}
                      maskShowOverlay={params.maskShowOverlay}
                      onToggleMaskOverlay={activeCategory === 'mask' ? () => {
                          const p = paramsRef.current;
                          p.maskShowOverlay = !p.maskShowOverlay;
                          setParams({ ...p });
                          isDirtyRef.current = true;
                      } : undefined}
                      onClearMask={activeCategory === 'mask' ? () => {
                          const p = paramsRef.current;
                          p.maskCreated = false;
                          p.maskBrightness = 0;
                          p.maskExposure = 0;
                          p.maskContrast = 0;
                          p.maskHighlights = 0;
                          p.maskShadows = 0;
                          p.maskTemp = 0;
                          p.maskTint = 0;
                          p.maskSat = 0;
                          p.maskVib = 0;
                          p.maskCx = 0.5;
                          p.maskCy = 0.5;
                          p.maskAngle = 0;
                          p.maskD = 0.25;
                          setParams({ ...p });
                          isDirtyRef.current = true;
                      } : undefined}
                      onUpdate={(id, val) => { 
                          if (id === 'blur') userManualBlurRef.current = val;
                          const nextParams = { ...paramsRef.current, [id]: val };
                          paramsRef.current = nextParams; 
                          isDirtyRef.current = true;
                          lastSliderMoveTimeRef.current = performance.now();
                      }}
                      onInteractStart={() => setupFastPreview(activeTool.id)}
                      onInteractEnd={() => { 
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
                {isEffectOn(tool.id) && (
                  <div className="absolute inset-0 rounded-lg ring-2 ring-inset ring-white pointer-events-none" />
                )}
                {/* 編輯鍵：選中而且真的有細項可調才出現。
                     用 span 不用 button —— 這整張卡片本身就是一顆 button，
                     button 裡面不能再放 button。stopPropagation 讓它不會順便重選卡片。 */}
                {isEffectOn(tool.id) && effectHasDetail(tool.id) && (
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
          {activeCategory === 'mask' && (
             <div className={`flex items-center gap-2 ${maskLocked ? 'opacity-30' : ''}`}>
                {MASK_TOOLS.map(tool => (
                    <button key={tool.id} disabled={maskLocked} onClick={() => { if (!maskLocked) setActiveToolId(tool.id); }} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}><Icon name={tool.icon} className="text-lg" fill={activeToolId === tool.id} /></div>
                        <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${activeToolId === tool.id ? 'text-white' : 'text-white/20'}`}>{tool.label}</span>
                        <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${isParamAdjusted(tool.id) ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
                    </button>
                ))}
             </div>
          )}
        </div>
        {/* compact 主頁入口與 ImageAdjustPanel 使用完全相同的分類列 class；
            根容器也已改成相同的 normal-flow 100dvh，因此三條分隔線不再偏移。 */}
        <div
          className={`flex border-t border-white/10 bg-black shrink-0 mt-auto ${compactBottomBar ? 'h-16 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] box-content' : ''}`}
          style={compactBottomBar ? undefined : { height: footerHeight, paddingBottom: 0 }}
        >
          <button onClick={() => { setActiveCategory('filter'); setActiveToolId('filter_select'); }} className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${activeCategory === 'filter' ? 'text-white' : 'text-white/20'}`}>
            <Icon name="palette" className="text-xl" fill={activeCategory === 'filter'} /><span className="text-[9px] font-black uppercase tracking-[0.2em]">濾鏡</span>
          </button>
          <button onClick={() => { setActiveCategory('adjust'); setActiveToolId(ADJUST_TOOLS[0].id); }} className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${activeCategory === 'adjust' ? 'text-white' : 'text-white/20'}`}>
            <Icon name="tune" className="text-xl" fill={activeCategory === 'adjust'} /><span className="text-[9px] font-black uppercase tracking-[0.2em]">調節</span>
          </button>
          <button onClick={enterEffects} className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${['effects', 'leak', 'soft', 'halation', 'fx'].includes(activeCategory) ? 'text-white' : 'text-white/20'}`}>
            <Icon name="magic_button" className="text-xl" fill={['effects', 'leak', 'soft', 'halation', 'fx'].includes(activeCategory)} /><span className="text-[9px] font-black uppercase tracking-[0.2em]">特效</span>
          </button>
          <button onClick={() => {
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
            }} className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${activeCategory === 'compose' ? 'text-white' : 'text-white/20'}`}>
            {/* crop_rotate 兩側各有一支旋轉箭頭，改成單純的裁切符號 */}
            <Icon name="crop" className="text-xl" fill={activeCategory === 'compose'} /><span className="text-[9px] font-black uppercase tracking-[0.2em]">構圖</span>
          </button>
          <button onClick={() => { setActiveCategory('mask'); setActiveToolId(MASK_TOOLS[0].id); }} className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${activeCategory === 'mask' ? 'text-white' : 'text-white/20'}`}>
            <Icon name="gradient" className="text-xl" fill={activeCategory === 'mask'} /><span className="text-[9px] font-black uppercase tracking-[0.2em]">遮色片</span>
          </button>
        </div>
      </div>
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
