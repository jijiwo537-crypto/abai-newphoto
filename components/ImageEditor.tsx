Warning: truncated output (original token count: 101359)
Total output lines: 7956


import { ComposeStudio, COMPOSE_WARMUP_CLASSES } from './ComposeStudio';
import { LUT_DEFAULT_AMOUNT } from '../utils/photoFx';
import { loadCachedLut, saveCachedLut } from '../utils/lutStore';
import { bakeColorLut, bakedToTexture } from '../utils/lutBake';
import { LutGpu } from '../utils/lutGpu';
import { FX_DEFS, FX_DEFAULTS, applyGlEffects, hasActiveFx, warmFx, type FxDef } from '../utils/glEffects';
import { DEFAULT_GEO, FULL_CROP, GeoParams, composeCanvas, isGeoIdentity } from '../utils/compose';
import { SaveButton } from './SaveButton';
/* IG 貼文預覽跟拼圖那兩個工具共用同一顆元件 */
import { IgPreview } from './IgPreview';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { addExport } from '../utils/exportHistory';
import { canvasToUrl, revokeUrls } from '../utils/blobUrl';
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
const HSL_PANEL_H = 220;
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
  sharpen: 0, grain: 0, soft: 0, softThreshold: 70,
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
  { id: 'softThreshold', label: '範圍', icon: 'tonality', min: 0, max: 95 },
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

const EFFECT_TOOLS: ToolDef[] = [
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
  ...FX_DEFS.filter(d => d.id !== 'fxSharpen')
    .map(d => ({ id: d.id, label: d.label, icon: d.icon, min: 0, max: 100 })),
];

/* 特效卡片按下去之後，上面那根滑桿要調的是「這個特效的強度」。
   柔光／光暈／漏光的強度不是卡片 id 本身，各自對應到自己的參數 ——
   沒有對到的話那根滑桿的範圍會是 0～0，看起來就是「拖不動」。 */
const EFFECT_AMOUNT: Record<string, string> = {
  softLight: 'soft',
  halation: 'fringeIntensity',
  lightLeak: 'leakOpacity',
};
const effectAmountId = (id: string) => EFFECT_AMOUNT[id] || id;

/** 在清單裡點下這顆特效時要套的強度（已經開著的就不動它） */
const EFFECT_ON_AMOUNT: Record<string, number> = {
  lightLeak: 100,
  ...Object.fromEntries(FX_DEFS.map(d => [d.id, d.onAmount ?? 100])),
};

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
    // 強度用 percent —— tune 是「調節」分頁的圖標，不能拿來重複用
    { id: d.id, label: '強度', icon: 'percent', min: 0, max: 100 },
    // hidden 的那幾根不給調整（值永遠是預設），介面上就不要出現
    ...d.params.filter(p => !p.hidden)
      .map(p => ({ id: p.id, label: p.label, icon: p.icon, min: p.min, max: p.max, step: p.step })),
  ] as ToolDef[]]),
);

/** 最外層那根滑桿要改調哪一個參數（沒設就是調「強度」）。
    來源是 FX_DEFS 的 rootParam，跟拼圖那邊讀同一份定義。 */
const FX_ROOT_PARAM: Record<string, ToolDef> = Object.fromEntries(
  FX_DEFS.filter(d => d.rootParam).map(d => {
    const p = d.params.find(x => x.id === d.rootParam)!;
    return [d.id, { id: p.id, label: p.label, icon: p.icon, min: p.min, max: p.max, step: p.step } as ToolDef];
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
export function generateBaseCorrectionLut(exposure: number, contrast: number, brightness: number, output: Uint8Array): void {
    const exp = Math.pow(2, (exposure * 0.175) / 100);
    // Standard contrast formula
    const conFactor = (259 * ((contrast * 0.2975) + 255)) / (255 * (259 - (contrast * 0.2975)));
    // Reduce effect amplitude by 50% (from 0.5 to 0.25)
    const brightVal = brightness * 0.25;

    for (let i = 0; i < 256; i++) {
        let val = i;
        // 1. Exposure
        val *= exp;
        // 2. Brightness
        val += brightVal;
        // 3. Contrast
        val = conFactor * (val - 128) + 128;
        // Clamp
        output[i] = Math.max(0, Math.min(255, val + 0.5)) | 0;
    }
}

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

const DITHER_SIZE = 4096;
const ditherTable = new Float32Array(DITHER_SIZE);
for (let i = 0; i < DITHER_SIZE; i++) {
    ditherTable[i] = (Math.random() - 0.5) * 0.75;
}

const masterLUT_R = new Float32Array(32768);
const masterLUT_G = new Float32Array(32768);
const masterLUT_B = new Float32Array(32768);

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

export const processPixels = (
  sourceData: Uint8ClampedArray,
  destData: Uint8ClampedArray,
  w: number,
  h: number,
  p: EditorParams,
  lutData: Uint8ClampedArray | null,
  lutSize: number,
  baseCorrectionLut: Uint8Array, 
  sharpenDetail: Int8Array | null,
  useNearestLut: boolean,
  curveLuts: { rgb: Uint8Array, r: Uint8Array, g: Uint8Array, b: Uint8Array }
) => {
  if (!sourceData || !destData || sourceData.length !== destData.length) return;

  const cLutM = curveLuts.rgb;
  const cLutR = curveLuts.r;
  const cLutG = curveLuts.g;
  const cLutB = curveLuts.b;
  
  const hasCurves = p.curves.rgb.length > 2 || p.curves.r.length > 2 || p.curves.g.length > 2 || p.curves.b.length > 2 ||
                    p.curves.rgb.some((pt: any) => pt.y !== pt.x) || p.curves.r.some((pt: any) => pt.y !== pt.x) || 
                    p.curves.g.some((pt: any) => pt.y !== pt.x) || p.curves.b.some((pt: any) => pt.y !== pt.x);

  // Temperature & Tint Constants
  const tempK = p.temp * 0.15 * 0.3;
  const tintK = p.tint * 0.04 * 2 * 0.3;
  let rAdj = 0, gAdj = 0, bAdj = 0;
  if (tempK > 0) { rAdj = tempK * 1.2; gAdj = tempK * 0.4; bAdj = -tempK * 0.8; }
  else { bAdj = Math.abs(tempK) * 1.2; rAdj = -Math.abs(tempK) * 0.5; }
  gAdj += tintK;
  
  const hasTempTint = rAdj !== 0 || gAdj !== 0 || bAdj !== 0;

  // Saturation & Vibrance Constants
  const satMult = 1 + (p.sat * 0.5 / 100);
  const vibVal = (p.vib * 0.5) / 100;
  const hasVib = vibVal !== 0;

  // Film LUT Constants
  const lutAmount = p.lutAmount / 100;
  const hasLut = !!lutData && lutAmount > 0;
  const lutSizeSq = lutSize * lutSize;
  const lutMax = lutSize - 1;
  
  // HSL Constants —— 八個色帶先攤平成三個小陣列，內迴圈就不用一直走物件
  const hslArr = p.hsl && p.hsl.length === 8 ? p.hsl : DEFAULT_HSL;
  const hasHsl = !isHslIdentity(hslArr);
  const hslCenters = HSL_CENTERS;
  const hslH = new Float32Array(8), hslS = new Float32Array(8), hslL = new Float32Array(8);
  for (let k = 0; k < 8; k++) {
    hslH[k] = hslArr[k].h / 100;
    hslS[k] = hslArr[k].s / 100 * HSL_MAX_SAT;
    hslL[k] = hslArr[k].l / 100 * HSL_MAX_LUM;
  }

  // Sharpen Constants (Multiply amount since Int8 is halved)
  const hasSharpen = p.sharpen > 0 && !!sharpenDetail;
  const sharpenAmount = p.sharpen > 0 ? ((p.sharpen / 100) * 0.59) * 2.0 : 0;
  
  // Shadows / Highlights Constants - Professional Logarithmic Transition
  const shadows = p.shadows / 100;
  const highlights = p.highlights / 100;

  const shLut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
      const luma = i / 255;
      let offset = 0;
      
      // Professional Shadows: Rec.709 inspired toe correction
      if (shadows !== 0) {
          // Left (negative) should strengthen (brighten/lift)
          // Right (positive) should reduce
          const shadowMask = Math.pow(1.0 - luma, 3.0);
          offset -= shadows * shadowMask * 17.5; 
      }
      
      // Professional Highlights: Soft shoulder roll-off
      if (highlights !== 0) {
          // Left (negative) should strengthen (darken/compress)
          // Right (positive) should reduce (brighten/boost)
          const highlightMask = Math.pow(luma, 3.0);
          offset += highlights * highlightMask * 35.0;
      }
      
      shLut[i] = offset;
  }

  const protectLut = new Float32Array(256);
  if (hasTempTint) {
      for (let i = 0; i < 256; i++) {
          let pr = (i - 5) * 0.02;
          protectLut[i] = pr < 0 ? 0 : pr;
      }
  }

  // --- SMART OPTIMIZATION: MASTER 3D LUT BAKING ---
  // In order to process 2.56M pixels at 60fps within a single CPU thread without losing resolution,
  // we adopt the DaVinci Resolve proxy pattern: we bake the ENTIRE math-heavy color pipeline 
  // into an interim 32x32x32 3D Master LUT (takes < 2ms to generate).
  
  const MASTER_DIM = 32;
  const MASTER_MAX = 31;
  let masterIdx = 0;

  for (let l_b = 0; l_b < MASTER_DIM; l_b++) {
      for (let l_g = 0; l_g < MASTER_DIM; l_g++) {
          for (let l_r = 0; l_r < MASTER_DIM; l_r++) {
              let r = (l_r * 255.0) / 31.0;
              let g = (l_g * 255.0) / 31.0;
              let b = (l_b * 255.0) / 31.0;

              // 1. Base Correction
              const ri = r | 0; const gi = g | 0; const bi = b | 0;
              r = baseCorrectionLut[ri];
              g = baseCorrectionLut[gi];
              b = baseCorrectionLut[bi];

              // 2. Shadows & Highlights (Logarithmic roll-off)
              const lumaKey = (r * 77 + g * 150 + b * 29) >> 8;
              const shOffset = shLut[lumaKey];
              r += shOffset; g += shOffset; b += shOffset;
              r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;

              // 3. Temp & Tint
              if (hasTempTint) {
                  const protect = protectLut[(r * 77 + g * 150 + b * 29) >> 8];
                  r += rAdj * protect; g += gAdj * protect; b += bAdj * protect;
                  r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
              }

              // 4. Curves
              if (hasCurves) {
                  const ri2 = r | 0; const gi2 = g | 0; const bi2 = b | 0;
                  const cr = cLutR[cLutM[ri2]]; const cg = cLutG[cLutM[gi2]]; const cb = cLutB[cLutM[bi2]];
                  r = r + (cr - r) * 0.7; g = g + (cg - g) * 0.7; b = b + (cb - b) * 0.7;
              }

              // 5. Saturation
              const avg = (r + g + b) * 0.33333;
              if (satMult !== 1) {
                  r = avg + (r - avg) * satMult; g = avg + (g - avg) * satMult; b = avg + (b - avg) * satMult;
              }

              // 6. Vibrance
              if (hasVib) {
                  let max = r > g ? (r > b ? r : b) : (g > b ? g : b);
                  let min = r < g ? (r < b ? r : b) : (g < b ? g : b);
                  const curSat = max === 0 ? 0 : (max - min) / max;
                  const boost = vibVal > 0 ? vibVal * (1 - curSat * curSat) : vibVal;
                  const b1 = 1 + boost;
                  r = avg + (r - avg) * b1; g = avg + (g - avg) * b1; b = avg + (b - avg) * b1;
              }

              r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;

              // 7. LUT (Film)
              if (hasLut && lutData) {
                  const s = 0.00392156862 * lutMax;
                  const rf = r * s; const gf = g * s; const bf = b * s;
                  const r0 = rf | 0; const r1 = r0 + 1 > lutMax ? lutMax : r0 + 1;
                  const g0 = gf | 0; const g1 = g0 + 1 > lutMax ? lutMax : g0 + 1;
                  const b0 = bf | 0; const b1 = b0 + 1 > lutMax ? lutMax : b0 + 1;
                  const dr = rf - r0; const dg = gf - g0; const db = bf - b0;
                  const b0sz = b0 * lutSizeSq; const b1sz = b1 * lutSizeSq;
                  const g0sz = g0 * lutSize; const g1sz = g1 * lutSize;
                  const i000 = (b0sz + g0sz + r0) * 3; const i100 = (b0sz + g0sz + r1) * 3;
                  const i010 = (b0sz + g1sz + r0) * 3; const i110 = (b0sz + g1sz + r1) * 3;
                  const i001 = (b1sz + g0sz + r0) * 3; const i101 = (b1sz + g0sz + r1) * 3;
                  const i011 = (b1sz + g1sz + r0) * 3; const i111 = (b1sz + g1sz + r1) * 3;
                  const r_00 = lutData[i000] + (lutData[i100] - lutData[i000]) * dr;
                  const r_01 = lutData[i001] + (lutData[i101] - lutData[i001]) * dr;
                  const r_10 = lutData[i010] + (lutData[i110] - lutData[i010]) * dr;
                  const r_11 = lutData[i011] + (lutData[i111] - lutData[i011]) * dr;
                  const r_0 = r_00 + (r_10 - r_00) * dg; const r_1 = r_01 + (r_11 - r_01) * dg;
                  const lr = r_0 + (r_1 - r_0) * db;
                  const g_00 = lutData[i000+1] + (lutData[i100+1] - lutData[i000+1]) * dr;
                  const g_01 = lutData[i001+1] + (lutData[i101+1] - lutData[i001+1]) * dr;
                  const g_10 = lutData[i010+1] + (lutData[i110+1] - lutData[i010+1]) * dr;
                  const g_11 = lutData[i011+1] + (lutData[i111+1] - lutData[i011+1]) * dr;
                  const g_0 = g_00 + (g_10 - g_00) * dg; const g_1 = g_01 + (g_11 - g_01) * dg;
                  const lg = g_0 + (g_1 - g_0) * db;
                  const b_00 = lutData[i000+2] + (lutData[i100+2] - lutData[i000+2]) * dr;
                  const b_01 = lutData[i001+2] + (lutData[i101+2] - lutData[i001+2]) * dr;
                  const b_10 = lutData[i010+2] + (lutData[i110+2] - lutData[i010+2]) * dr;
                  const b_11 = lutData[i011+2] + (lutData[i111+2] - lutData[i011+2]) * dr;
                  const b_0 = b_00 + (b_10 - b_00) * dg; const b_1 = b_01 + (b_11 - b_01) * dg;
                  const lb = b_0 + (b_1 - b_0) * db;
                  r += (lr - r) * lutAmount; g += (lg - g) * lutAmount; b += (lb - b) * lutAmount;
              }

              // 8. HSL —— 放在最後，所以使用者看到什麼顏色就是在調什麼顏色
              if (hasHsl) {
                  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
                  const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
                  const chroma = mx - mn;
                  // 彩度太低的時候色相是雜訊，權重淡出，灰牆才不會冒出色斑
                  const gt = chroma * 0.00392156862;   // /255
                  const tg = gt <= 0.03 ? 0 : gt >= 0.12 ? 1 : (gt - 0.03) / 0.09;
                  const gate = tg * tg * (3 - 2 * tg);
                  if (gate > 0) {
                      let hue: number;
                      if (mx === r) hue = 60 * (((g - b) / chroma) % 6);
                      else if (mx === g) hue = 60 * ((b - r) / chroma + 2);
                      else hue = 60 * ((r - g) / chroma + 4);
                      if (hue < 0) hue += 360;
                      const lgt = (mx + mn) * 0.00196078431;   // /2/255
                      const sat = chroma / (255 - Math.abs(mx + mn - 255));

                      // 落在哪兩個色帶中心之間，用 smoothstep 內插（兩顆權重加起來 = 1）
                      let i0 = 7;
                      for (let k = 0; k < 7; k++) { if (hue < hslCenters[k + 1]) { i0 = k; break; } }
                      const c0 = hslCenters[i0];
                      const c1 = i0 === 7 ? 360 : hslCenters[i0 + 1];
                      const i1 = i0 === 7 ? 0 : i0 + 1;
                      const tt = c1 === c0 ? 0 : (hue - c0) / (c1 - c0);
                      const wb = tt * tt * (3 - 2 * tt);
                      const wa = 1 - wb;

                      const dh = (hslH[i0] * wa + hslH[i1] * wb) * gate;
                      const ds = (hslS[i0] * wa + hslS[i1] * wb) * gate;
                      const dl = (hslL[i0] * wa + hslL[i1] * wb) * gate;

                      let h2 = hue + dh * HSL_MAX_HUE_SHIFT;
                      if (h2 < 0) h2 += 360; else if (h2 >= 360) h2 -= 360;
                      let s2 = sat * (1 + ds);
                      s2 = s2 < 0 ? 0 : s2 > 1 ? 1 : s2;
                      let l2 = dl >= 0 ? lgt + (1 - lgt) * dl : lgt * (1 + dl);
                      l2 = l2 < 0 ? 0 : l2 > 1 ? 1 : l2;

                      // HSL → RGB
                      const cc = (1 - Math.abs(2 * l2 - 1)) * s2;
                      const hp = h2 / 60;
                      const xx = cc * (1 - Math.abs((hp % 2) - 1));
                      let r2 = 0, g2 = 0, b2 = 0;
                      if (hp < 1) { r2 = cc; g2 = xx; }
                      else if (hp < 2) { r2 = xx; g2 = cc; }
                      else if (hp < 3) { g2 = cc; b2 = xx; }
                      else if (hp < 4) { g2 = xx; b2 = cc; }
                      else if (hp < 5) { r2 = xx; b2 = cc; }
                      else { r2 = cc; b2 = xx; }
                      const mm = l2 - cc * 0.5;
                      r = (r2 + mm) * 255; g = (g2 + mm) * 255; b = (b2 + mm) * 255;
                      r = r < 0 ? 0 : r > 255 ? 255 : r;
                      g = g < 0 ? 0 : g > 255 ? 255 : g;
                      b = b < 0 ? 0 : b > 255 ? 255 : b;
                  }
              }

              masterLUT_R[masterIdx] = r; masterLUT_G[masterIdx] = g; masterLUT_B[masterIdx] = b;
              masterIdx++;
          }
      }
  }

  // --- APPLY MASTER LUT TO PIXELS ---
  const len = sourceData.length;
  const sLUT = 0.12156862745; // 31 / 255
  let ditherIdx = 0;

  // Split into explicit loops to guarantee CPU JIT vectorization and no block de-opts
  if (useNearestLut) {
      // Nearest-neighbor sampling: extremely fast for high-res previews during interaction (~60fps)
      for (let i = 0; i < len; i += 4) {
          const r = sourceData[i], g = sourceData[i+1], b = sourceData[i+2];

          // Quantize to 32x32x32 master LUT index (branchless)
          const r_idx = (r * 0.12156862745 + 0.5) | 0;
          const g_idx = (g * 0.12156862745 + 0.5) | 0;
          const b_idx = (b * 0.12156862745 + 0.5) | 0;

          const masterIdx = (b_idx << 10) | (g_idx << 5) | r_idx;

          const dither = ditherTable[ditherIdx & 4095];
          ditherIdx++;

          destData[i] = masterLUT_R[masterIdx] + dither;
          destData[i+1] = masterLUT_G[masterIdx] + dither;
          destData[i+2] = masterLUT_B[masterIdx] + dither;
          destData[i+3] = 255;
      }
  } else if (hasSharpen) {
      for (let i = 0; i < len; i += 4) {
          let r = sourceData[i], g = sourceData[i+1], b = sourceData[i+2];

          const rf = r * sLUT; const gf = g * sLUT; const bf = b * sLUT;
          const r0 = rf | 0; const g0 = gf | 0; const b0 = bf | 0;
          const r1 = r0 === 31 ? 31 : r0 + 1;
          const g1 = g0 === 31 ? 31 : g0 + 1;
          const b1 = b0 === 31 ? 31 : b0 + 1;
          
          const dr = rf - r0; const dg = gf - g0; const db = bf - b0;

          const b0_O = b0 << 10; const b1_O = b1 << 10;
          const g0_O = g0 << 5; const g1_O = g1 << 5;

          const i000 = b0_O | g0_O | r0;
          const i111 = b1_O | g1_O | r1;
          let iA, iB, w0, w1, w2, w3;

          if (dr > dg) {
              if (dg > db) {
                  iA = b0_O | g0_O | r1; iB = b0_O | g1_O | r1; w0 = 1.0 - dr; w1 = dr - dg; w2 = dg - db; w3 = db;
              } else if (dr > db) {
                  iA = b0_O | g0_O | r1; iB = b1_O | g0_O | r1; w0 = 1.0 - dr; w1 = dr - db; w2 = db - dg; w3 = dg;
              } else {
                  iA = b1_O | g0_O | r0; iB = b1_O | g0_O | r1; w0 = 1.0 - db; w1 = db - dr; w2 = dr - dg; w3 = dg;
              }
          } else {
              if (db > dg) {
                  iA = b1_O | g0_O | r0; iB = b1_O | g1_O | r0; w0 = 1.0 - db; w1 = db - dg; w2 = dg - dr; w3 = dr;
              } else if (db > dr) {
                  iA = b0_O | g1_O | r0; iB = b1_O | g1_O | r0; w0 = 1.0 - dg; w1 = dg - db; w2 = db - dr; w3 = dr;
              } else {
                  iA = b0_O | g1_O | r0; iB = b0_O | g1_O | r1; w0 = 1.0 - dg; w1 = dg - dr; w2 = dr - db; w3 = db;
              }
          }

          r = masterLUT_R[i000] * w0 + masterLUT_R[iA] * w1 + masterLUT_R[iB] * w2 + masterLUT_R[i111] * w3;
          g = masterLUT_G[i000] * w0 + masterLUT_G[iA] * w1 + masterLUT_G[iB] * w2 + masterLUT_G[i111] * w3;
          b = masterLUT_B[i000] * w0 + masterLUT_B[iA] * w1 + masterLUT_B[iB] * w2 + masterLUT_B[i111] * w3;

          const detail = sharpenDetail![i]; 
          r += detail * sharpenAmount; g += detail * sharpenAmount; b += detail * sharpenAmount;

          const dither = ditherTable[ditherIdx & 4095];
          ditherIdx++;

          destData[i] = r + dither; destData[i+1] = g + dither; destData[i+2] = b + dither; destData[i+3] = 255;
      }
  } else {
      for (let i = 0; i < len; i += 4) {
          let r = sourceData[i], g = sourceData[i+1], b = sourceData[i+2];

          const rf = r * sLUT; const gf = g * sLUT; const bf = b * sLUT;
          const r0 = rf | 0; const g0 = gf | 0; const b0 = bf | 0;
          const r1 = r0 === 31 ? 31 : r0 + 1;
          const g1 = g0 === 31 ? 31 : g0 + 1;
          const b1 = b0 === 31 ? 31 : b0 + 1;
          
          const dr = rf - r0; const dg = gf - g0; const db = bf - b0;

          const b0_O = b0 << 10; const b1_O = b1 << 10;
          const g0_O = g0 << 5; const g1_O = g1 << 5;

          const i000 = b0_O | g0_O | r0;
          const i111 = b1_O | g1_O | r1;
          let iA, iB, w0, w1, w2, w3;

          if (dr > dg) {
              if (dg > db) {
                  iA = b0_O | g0_O | r1; iB = b0_O | g1_O | r1; w0 = 1.0 - dr; w1 = dr - dg; w2 = dg - db; w3 = db;
              } else if (dr > db) {
                  iA = b0_O | g0_O | r1; iB = b1_O | g0_O | r1; w0 = 1.0 - dr; w1 = dr - db; w2 = db - dg; w3 = dg;
              } else {
                  iA = b1_O | g0_O | r0; iB = b1_O | g0_O | r1; w0 = 1.0 - db; w1 = db - dr; w2 = dr - dg; w3 = dg;
              }
          } else {
              if (db > dg) {
                  iA = b1_O | g0_O | r0; iB = b1_O | g1_O | r0; w0 = 1.0 - db; w1 = db - dg; w2 = dg - dr; w3 = dr;
              } else if (db > dr) {
                  iA = b0_O | g1_O | r0; iB = b1_O | g1_O | r0; w0 = 1.0 - dg; w1 = dg - db; w2 = db - dr; w3 = dr;
              } else {
                  iA = b0_O | g1_O | r0; iB = b0_O | g1_O | r1; w0 = 1.0 - dg; w1 = dg - dr; w2 = dr - db; w3 = db;
              }
          }

          r = masterLUT_R[i000] * w0 + masterLUT_R[iA] * w1 + masterLUT_R[iB] * w2 + masterLUT_R[i111] * w3;
          g = masterLUT_G[i000] * w0 + masterLUT_G[iA] * w1 + masterLUT_G[iB] * w2 + masterLUT_G[i111] * w3;
          b = masterLUT_B[i000] * w0 + masterLUT_B[iA] * w1 + masterLUT_B[iB] * w2 + masterLUT_B[i111] * w3;

          const dither = ditherTable[ditherIdx & 4095];
          ditherIdx++;

          destData[i] = r + dither; destData[i+1] = g + dither; destData[i+2] = b + dither; destData[i+3] = 255;
      }
  }
};

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

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.value = value.toString();
        }
        if (valueTextRef.current) {
            valueTextRef.current.textContent = value.toFixed(0);
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
        onUpdate(toolId, val);
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
                            {value.toFixed(0)}
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
                            {value.toFixed(0)}
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
                                {value.toFixed(0)}
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

            <div className={`relative flex items-center justify-center touch-none ${dense ? 'h-[26px]' : compact ? 'h-[30px]' : 'h-12'}`}>
                <input 
                    ref={inputRef}
                    type="range" min={min} max={max} step={step}
                    defaultValue={value}
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
type ThumbEntry = { cvs: HTMLCanvasElement; v: number; sig: string };
type ThumbStore = React.MutableRefObject<Record<string, ThumbEntry>>;

/** 把一張算好的縮圖收進倉庫（重複使用同一張畫布，不要一直生新的） */
function putThumb(store:…71359 tokens truncated…inter-events-none"
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
        <button
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
        </button>

        {/* --- HSL 面板 ---
             跟曲線一樣做成蓋在預覽上的浮層，而不是把底部功能欄撐高 ——
             底部那兩列（小分類、分頁）因此完全不會被推動。
             進出不做任何動畫：直接掛上、直接拿掉。 */}
        {activeToolId === 'hsl' && (
        <div
           data-hsl-panel
           className="absolute inset-x-0 bottom-0 z-40 px-8 pt-2 pb-4 bg-[#111]/95 backdrop-blur-xl border-t border-white/5"
        >
<div className="w-full flex flex-col pb-4">
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
        </div>
        )}

        {/* --- CURVE OVERLAY UI --- */}
        <div 
           /* 收起來時只淡出＋以底部為原點縮小，不做位移：原本用 translate-y-full，
              整塊格線與通道點會從下方功能欄「穿過去」，看起來就是那一塊淺灰色的東西
              （量到離開後 60ms 那一幀真的疊在亮度那一列上）。
              origin-bottom + scale ≤ 1 保證它永遠不會超出原本的範圍，
              視覺上就是「從底部長出來」。
              進退用同一條 easeOut，收起來才會一按就開始淡掉；退場再短一點，
              手指離開按鈕的當下曲線就已經看不太到了。 */
           className={`absolute left-0 right-0 z-40 flex flex-col items-center justify-end pb-2 origin-bottom panel-ease transition-[opacity,transform] ${
             activeToolId === 'curves'
               ? `${curvesFromHsl ? 'duration-0' : 'duration-[380ms]'} scale-100 opacity-100`
               : 'duration-[260ms] scale-[0.96] opacity-0 pointer-events-none'
           }`}
           style={{ height: '250px', bottom: 0 }}
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
                   <div className="relative w-[240px] h-[240px] bg-[#0c0c0c]/30 border border-white shrink-0 touch-none rounded-sm shadow-2xl"
                        onMouseDown={handleCurveBgClick}
                        onTouchStart={handleCurveBgClick}
                   >
                       <svg id="curvesSvg" viewBox="0 0 200 200" className="absolute top-[-1px] left-[-1px] w-[240px] h-[240px] overflow-visible cursor-crosshair">
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
        </div>

        {/* 只是掛給 Tailwind 的瀏覽器版 JIT 看的，本身不畫任何東西 ——
             編輯器一開就讓它把構圖那些 class 的規則先產生好，
             使用者第一次點構圖時才不會先看到一幀沒有樣式的畫面。 */}
        <div aria-hidden="true" className={COMPOSE_WARMUP_CLASSES} style={{ display: 'none' }} />
        {/* 濾鏡頁滑桿上面那四顆開關的 class：先讓 JIT 產生規則，
             不然規則晚一幀到，那四顆會從「沒樣式」補間到「有樣式」（看起來像自己動了一下）。 */}
        <div aria-hidden="true" style={{ display: 'none' }}
             className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors border shrink-0 bg-white text-black border-white shadow-lg bg-white/5 text-white/40 border-white/10 hover:text-white/60 hover:border-white/25 gap-1.5 overflow-x-auto no-scrollbar py-1 max-w-[calc(100%-3.5rem)] flex-col px-2 py-2 text-[9px] font-medium whitespace-nowrap" />

        {/* 構圖：只蓋住預覽區，不再是另外開一整頁 —— 下方的分頁列留在原位。
             它自己的小分類（裁切／角度／翻轉／梯形）就接在分頁列上面，
             位置跟其他功能的小分類列一樣。 */}
        {activeCategory === 'compose' && draftGeo && (composePreviewRef.current || originalImgRef.current) && (
          <ComposeStudio
            image={composePreviewRef.current || originalImgRef.current!}
            geo={draftGeo}
            onChange={setDraftGeo}
            onCancel={() => {
              composePreviewRef.current = null;
              setDraftGeo(null);
              setActiveCategory(beforeComposeRef.current.cat);
              setActiveToolId(beforeComposeRef.current.tool);
            }}
            onApply={() => {
              applyGeo(draftGeo);
              addToHistory(paramsRef.current, selectedLutIdx);
              setDraftGeo(null);
              composePreviewRef.current = null;
              setActiveCategory(beforeComposeRef.current.cat);
              setActiveToolId(beforeComposeRef.current.tool);
            }}
          />
        )}
      </div>

      {/* 小分類列收起來時（遮色片建立中／構圖），這個外框的上緣會直接貼到
          分頁列自己的上緣邊線，兩條 1px 疊在一起看起來就是一條比較粗的線
          （量到亮度剖面多一列：正常只有 29，疊到的時候是 29 + 26）。
          那種狀態下就把外框這一條收掉，留分頁列自己那條。 */}
      <div className={`bg-[#111111] ${subStripHidden ? '' : 'border-t border-white/5'} flex flex-col shrink-0 pb-safe z-[55]`}>
        <div 
          className={`flex flex-col justify-center panel-ease transition-all overflow-hidden bg-[#111] ${fxPanel ? 'px-4' : 'px-8'}`}
          style={{
              /* 時間長度走 inline style，不要用 duration-0 / duration-[380ms] 這種 class。
                 這個 App 掛的是 Tailwind 的瀏覽器版 JIT，規則是「在 DOM 看到那個 class
                 才產生」的：duration-0 剛好就是進構圖的那一刻第一次出現，規則會晚一幀，
                 於是第一次進構圖時這一列是用 380ms 在收，預覽區高度連著動 20 幾幀，
                 ComposeStudio 的 ResizeObserver 每一幀重算舞台 —— 那就是閃爍。
                 第二次進來規則已經在了，所以只有第一次會發生。inline style 沒有這個問題。 */
              transitionDuration: hslSwitch || composeSwitch || detailSwitch ? '0ms' : '380ms',
              /* HSL 面板已經搬到預覽區上面當浮層了（跟曲線同一個做法），
                 所以這裡只要跟曲線一樣把滑桿列收成 0 就好。
                 這樣底部功能欄的高度變化跟開曲線時完全一樣，
                 小分類列與分頁列都待在原地不動。 */
              // 特效細項：把小分類列那 6rem 借過來（它同時收成 0），總高不變
              height: sliderRowHidden ? '0px' : (fxPanel ? '11rem' : '5rem'),
              opacity: sliderRowHidden ? 0 : 1,
              /* 收起來時是 0px 而不是 none —— 寫 none 的話 border-color 會退回
                 currentColor（白的），transition 就從「幾乎不透明的白」補間到 5% 白，
                 離開曲線的瞬間底下會亮出一條白線（量到第一幀是 rgba(255,255,255,0.93)）。
                 兩邊寫同一個顏色，只讓寬度動，就沒有東西可以亮。 */
              borderBottom: sliderRowHidden ? '0px solid rgba(255, 255, 255, 0.05)' : '1px solid rgba(255, 255, 255, 0.05)'
          }}
        >
          {/* 新特效：那個特效的滑桿一次全部攤開（左邊一顆返回，右邊兩兩一排）。
               奇數根時「強度」自己站第一排。 */}
          {fxPanel && (
            <div className="w-full h-full flex items-center gap-3">
              <button
                onClick={() => { setActiveCategory('effects'); setActiveToolId(activeFxId); }}
                aria-label="返回特效"
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors text-white"
              >
                <Icon name="arrow_back" className="text-xl" />
              </button>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                {fxRows.map((row, ri) => (
                  <div key={ri} className="flex items-center gap-4" style={{ height: fxRowH }}>
                    {row.map(t => (
                      <div key={t.id} className="flex-1 min-w-0">
                        <FastSlider
                          value={typeof params[t.id as keyof EditorParams] === 'number' ? params[t.id as keyof EditorParams] as number : 0}
                          min={t.min} max={t.max} step={t.step || 0.1}
                          toolId={t.id} label={t.label} snapZero={t.min < 0}
                          compact dense
                          onUpdate={(id, val) => {
                            paramsRef.current = { ...paramsRef.current, [id]: val };
                            isDirtyRef.current = true;
                            lastSliderMoveTimeRef.current = performance.now();
                          }}
                          onInteractStart={() => { setActiveToolId(t.id); setupFastPreview(t.id); }}
                          onInteractEnd={() => {
                            setIsInteracting(false);
                            fastPreviewCacheRef.current.active = false;
                            setParams({ ...paramsRef.current });
                            addToHistory(paramsRef.current, selectedLutIdx);
                          }}
                          onReset={handleDoubleTap}
                          onValueClick={resetParam}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!fxPanel && activeTool && !['lightLeak', 'softLight'].includes(activeToolId) && activeToolId !== 'curves' && activeToolId !== 'hsl' && (
              <div className="w-full">
                  <FastSlider 
                      value={typeof params[activeTool.id as keyof EditorParams] === 'number' ? params[activeTool.id as keyof EditorParams] as number : 0}
                      min={activeTool.min} max={activeTool.max} step={activeTool.step || 0.1}
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
              transitionDuration: composeSwitch || detailSwitch ? '0ms' : '380ms',
              // HSL 開著的時候小分類列照樣留著（跟曲線一樣）。收起來的話，
              // 面板下緣會往下掉 96px，整條工具列看起來就是往下沉了一次。
              // 構圖的小分類（裁切／角度／翻轉／梯形）由 ComposeStudio 自己畫在
              // 預覽區底部，這一列就讓給它，不然會有兩排小分類。
              // 特效細項時這一列讓給上面的滑桿群（高度剛好對調，總高不變）
              height: (subStripHidden || fxPanel) ? '0px' : '6rem',
              opacity: (subStripHidden || fxPanel) ? 0 : 1,
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
                  <span className={`text-[8px] font-black uppercase tracking-widest leading-none whitespace-nowrap ${isParamAdjusted(tool.id) ? 'text-white' : 'text-white/60'}`}>
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
                    className="rounded-full flex items-center justify-center bg-black/55 border border-white/25 text-white active:scale-90 transition-transform"
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
                    <button key={tool.id} onClick={() => setActiveToolId(tool.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}><Icon name={tool.icon} className="text-lg" fill={activeToolId === tool.id} /></div>
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
                    <button key={tool.id} onClick={() => setActiveToolId(tool.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}><Icon name={tool.icon} className="text-lg" fill={activeToolId === tool.id} /></div>
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
                    <button key={tool.id} onClick={() => setActiveToolId(tool.id)} className="flex flex-col items-center gap-1 shrink-0 group w-16">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${activeToolId === tool.id ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40 group-hover:bg-white/10'}`}><Icon name={tool.icon} className="text-lg" fill={activeToolId === tool.id} /></div>
                        <span className={`text-[9px] font-bold uppercase tracking-tighter whitespace-nowrap ${activeToolId === tool.id ? 'text-white' : 'text-white/20'}`}>{tool.label}</span>
                        <div className={`w-1 h-1 rounded-full mt-0.5 transition-all duration-200 ${isParamAdjusted(tool.id) ? 'bg-white opacity-100 scale-100' : 'bg-transparent opacity-0 scale-50'}`} />
                    </button>
                ))}
             </div>
          )}
          {/* 新特效的參數按鈕列已經拿掉了 —— 那個特效的滑桿現在全部直接顯示在上面那一列，
               不用再點第二層。這一列在特效細項時是收起來的（高度讓給滑桿群）。 */}
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
        <div className="flex h-16 border-t border-white/10 bg-black pb-[calc(env(safe-area-inset-bottom,0px)+12px)] box-content">
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
              if (activeCategory !== 'compose') beforeComposeRef.current = { cat: activeCategory, tool: activeToolId };
              const shown = displayCanvasRef.current;
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
          <div className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white">正在存檔</p>
          {/* 這一層蓋住返回鍵，所以一定要有出口（見 StuckEscape） */}
          <StuckEscape onEscape={() => setSaveState('idle')} />
        </div>
      )}
    </div>
  );
};
