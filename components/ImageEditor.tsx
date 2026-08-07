
import { ComposeStudio, COMPOSE_WARMUP_CLASSES } from './ComposeStudio';
import { loadCachedLut, saveCachedLut } from '../utils/lutStore';
import { FX_DEFS, FX_DEFAULTS, applyGlEffects, hasActiveFx, warmFx, type FxDef } from '../utils/glEffects';
import { DEFAULT_GEO, FULL_CROP, GeoParams, composeCanvas, isGeoIdentity } from '../utils/compose';
import { SaveButton } from './SaveButton';
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { addExport } from '../utils/exportHistory';
import { canvasToUrl, revokeUrls } from '../utils/blobUrl';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { ChevronLeft } from 'lucide-react';
import ExifReader from 'exifreader';
import { Icon } from './Icon';

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

/** 把「不是這一顆」的特效全部歸零。已經合併進圖層的不受影響 —— 它們早就歸零了，
    效果烤在點陣圖裡，這裡再歸零一次也動不到。 */
const clearOtherEffects = (base: any, keepId: string) => {
  const keep = new Set(EFFECT_OWN_KEYS[keepId] || [keepId]);
  const out = { ...base };
  for (const k of Object.keys(NO_EFFECT_PARAMS)) if (!keep.has(k)) out[k] = 0;
  return out;
};

/** 現在畫面上還有沒有「還沒合併」的特效（合併過的參數是 0，所以自然不算） */
const hasLiveEffect = (p: any) => Object.keys(NO_EFFECT_PARAMS).some(k => (p?.[k] || 0) !== 0);

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
const LUT_DEFAULT_AMOUNT: Record<string, number> = {
  f12: 50, f13: 50, f14: 50, f20: 50, f22: 50,
  f3: 70, f4: 70, f6: 70, f7: 70, f15: 70, f19: 70,
  f17: 80, f23: 80,
};

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
  imageSrc: string;
  /** 批量編輯：這次匯入的所有照片。沒給或只有一張時，介面跟以前完全一樣。 */
  batchSrcs?: string[];
  /** 批量編輯裡按「新增」：再挑照片接進來 */
  onAddPhotos?: () => void;
  lutList: { id: string, name: string, url: string }[];
  onSave: (newSrc: string) => void;
  onCancel: () => void;
  onHome?: () => void;
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
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[calc(100%-3.5rem)] py-1">
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onToggleSoft) onToggleSoft();
                                    e.currentTarget.blur();
                                }}
                                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors border shrink-0 ${
                                    softActive 
                                        ? 'bg-white text-black border-white shadow-lg' 
                                        : 'bg-white/5 text-white/40 border-white/10 hover:text-white/60 hover:border-white/25'
                                }`}
                            >
                                <Icon name="blur_on" className="text-[10px] shrink-0" fill={softActive} />
                                <span>柔光</span>
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onToggleBlur) onToggleBlur();
                                    e.currentTarget.blur();
                                }}
                                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors border shrink-0 ${
                                    blurActive 
                                        ? 'bg-white text-black border-white shadow-lg' 
                                        : 'bg-white/5 text-white/40 border-white/10 hover:text-white/60 hover:border-white/25'
                                }`}
                            >
                                {/* 跟特效那一排同一個參數，名字要一致 */}
                                <Icon name="blur_linear" className="text-[10px] shrink-0" fill={blurActive} />
                                <span>朦朧</span>
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onToggleHalation) onToggleHalation();
                                    e.currentTarget.blur();
                                }}
                                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors border shrink-0 ${
                                    halationActive 
                                        ? 'bg-white text-black border-white shadow-lg' 
                                        : 'bg-white/5 text-white/40 border-white/10 hover:text-white/60 hover:border-white/25'
                                }`}
                            >
                                <Icon name="flare" className="text-[10px] shrink-0" fill={halationActive} />
                                <span>光暈</span>
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onToggleGrain) onToggleGrain();
                                    e.currentTarget.blur();
                                }}
                                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-colors border shrink-0 ${
                                    grainActive 
                                        ? 'bg-white text-black border-white shadow-lg' 
                                        : 'bg-white/5 text-white/40 border-white/10 hover:text-white/60 hover:border-white/25'
                                }`}
                            >
                                <Icon name="grain" className="text-[10px] shrink-0" fill={grainActive} />
                                <span>噪點</span>
                            </button>
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
function putThumb(store: ThumbStore, id: string, src: HTMLCanvasElement, sig = ''): void {
  let e = store.current[id];
  if (!e) e = store.current[id] = { cvs: document.createElement('canvas'), v: 0, sig: '' };
  e.sig = sig;
  const c = e.cvs;
  if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
  const cx = c.getContext('2d')!;
  cx.clearRect(0, 0, c.width, c.height);
  cx.drawImage(src, 0, 0);
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
    // 兩份都還沒有就什麼都不做 —— 保留上一張的內容，總比清成空白好
    if (!e) return;
    const key = `${own ? id : fallbackId}#${e.v}`;
    if (drawn.current === key) return;      // 沒換內容就不要重畫
    drawn.current = key;
    if (el.width !== e.cvs.width || el.height !== e.cvs.height) { el.width = e.cvs.width; el.height = e.cvs.height; }
    el.getContext('2d')!.drawImage(e.cvs, 0, 0);
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

export const ImageEditor: React.FC<ImageEditorProps> = ({ imageSrc, batchSrcs, onAddPhotos, lutList, onSave, onCancel, onHome, onImportNew, originalFile, initialState }) => {
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
  const [isInteracting, setIsInteracting] = useState(false);
  const [isInitialCreatingMask, setIsInitialCreatingMask] = useState(false);
  const [dismissedMaskHint, setDismissedMaskHint] = useState(false);

  useEffect(() => {
    setDismissedMaskHint(false);
  }, [imageSrc]);

  // EXIF Metadata State
  const [showExifPanel, setShowExifPanel] = useState(false);
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
  // 構圖參數。套用之後整個預覽緩衝會用新的幾何重建，色彩流程完全不用知道它的存在。
  const [geo, setGeo] = useState<GeoParams>(() => ({ ...DEFAULT_GEO, crop: { ...FULL_CROP } }));
  const [draftGeo, setDraftGeo] = useState<GeoParams | null>(null);
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
  useEffect(() => {
    if (!imageSrc) return;
    const first = draftSrcSavedRef.current !== imageSrc;
    const t = setTimeout(() => {
      draftSrcSavedRef.current = imageSrc;
      saveToolDraft('editor', first ? imageSrc : null, { params, geo, selectedLutIdx });
    }, first ? 300 : 1200);
    return () => clearTimeout(t);
  }, [imageSrc, params, geo, selectedLutIdx]);
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
      const rect = canvas.getBoundingClientRect();
      const parentRect = canvas.parentElement?.getBoundingClientRect();
      if (parentRect) {
        setCanvasBounds({
          width: rect.width,
          height: rect.height,
          top: rect.top - parentRect.top,
          left: rect.left - parentRect.left,
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

    const overlay = e.currentTarget.ownerDocument.getElementById('mask-svg-overlay');
    const rect = overlay?.getBoundingClientRect();
    if (!rect) return;

    const clientX = e.clientX;
    const clientY = e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Convert parent container coordinates (x, y) to canvas bounds coordinate space
    const canvasX = x - canvasBounds.left;
    const canvasY = y - canvasBounds.top;

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
    
    setIsInteracting(true);
  };

  const handleMaskPointerMove = (e: React.PointerEvent<SVGElement>) => {
    if (!activeDragRef.current) return;
    
    const overlay = e.currentTarget.ownerDocument.getElementById('mask-svg-overlay');
    const rect = overlay?.getBoundingClientRect();
    if (!rect) return;

    const clientX = e.clientX;
    const clientY = e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Convert parent container coordinates (x, y) to canvas bounds coordinate space
    const canvasX = x - canvasBounds.left;
    const canvasY = y - canvasBounds.top;

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
  const helperCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  
  // Ref for showOriginal to be accessed inside loop
  const showOriginalRef = useRef(false);

  // Buffer management - full is now lazily allocated on save
  const buffers = useRef<{ preview: BufferSet, fast: BufferSet }>({ 
      preview: { source: null, dest: null, shared: null, lutted: null, lut0: null, lut100: null, temp: null, sharpenDetail: null, w: 0, h: 0 },
      fast: { source: null, dest: null, shared: null, lutted: null, lut0: null, lut100: null, temp: null, sharpenDetail: null, w: 0, h: 0 }
  });

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
              processPixels(source, lut0, pw, ph, p, null, 0, baseLut, null, false, curveLuts);
            } catch { return done(); }
            yieldTo(() => {
              if (cancelled) return;
              try {
                if (activeLut) {
                  lut100 = new Uint8ClampedArray(source.length);
                  processPixels(source, lut100, pw, ph, { ...p, lutAmount: 100 }, activeLut.data, activeLut.size, baseLut, null, false, curveLuts);
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
    setPreviewAspect({ w, h });
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
  const pixelBufferCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const lazyCacheTimeoutRef = useRef<any>(null);
  const forceRecalculateEffectsRef = useRef<boolean>(false);

  const blurCacheStateRef = useRef<{
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

  const halationCacheStateRef = useRef<{
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

  // 合併期間介面的參數已經歸零，但畫面要維持原樣，所以這時候不要把它同步進繪圖用的 ref
  useEffect(() => {
    if (mergeFreezeRef.current) return;
    paramsRef.current = params;
    isDirtyRef.current = true;
  }, [params]);
  useEffect(() => { showOriginalRef.current = showOriginal; isDirtyRef.current = true; }, [showOriginal]);

  // Auto-scroll to selected filter when switching back to filter category
  // 用 useLayoutEffect：在畫出來之前就把捲動位置設好，才不會先閃一下最前面
  useLayoutEffect(() => {
    const container = toolsScrollRef.current;
    if (container) {
        if (activeCategory === 'filter') {
            const itemWidth = 80; // w-20 (5rem)
            const gap = 16; // gap-4 (1rem)
            const padding = 16; // px-4 (1rem)

            const itemCenter = padding + (itemWidth + gap) * selectedLutIdx + itemWidth / 2;
            const scrollLeft = itemCenter - container.clientWidth / 2;

            container.scrollTo({ left: scrollLeft, behavior: 'auto' });
        } else if (activeCategory === 'effects' && backFromFxRef.current) {
            backFromFxRef.current = false;
            /* 從某個特效的細項退回來時，把「剛剛在編輯的那一顆」擺回畫面中間。
               不直接還原 scrollLeft —— 退回來的那一瞬間量到的可捲距離還是細項列
               （比較短）的，設進去會被夾成 43 之類的值，等於還是跳回最前面。
               對準按鈕本身就沒有這個問題，而且回來時剛好停在你剛編輯的特效上。 */
            const target = container.querySelector<HTMLElement>(`[data-fx-tool="${activeToolId}"]`);
            const center = () => {
                const el = container.querySelector<HTMLElement>(`[data-fx-tool="${activeToolId}"]`);
                if (!el) return;
                container.scrollLeft = el.offsetLeft - container.clientWidth / 2 + el.offsetWidth / 2;
            };
            center();
            if (!target) requestAnimationFrame(center);
        } else {
            container.scrollLeft = 0;
        }
    }
  }, [activeCategory]); // Only trigger on category switch

  // Force close or open the mask overlay depending on activeCategory
  useEffect(() => {
    if (activeCategory === 'mask') {
      if (paramsRef.current.maskCreated && !paramsRef.current.maskShowOverlay) {
        setParams(prev => ({ ...prev, maskShowOverlay: true }));
      }
    } else {
      if (paramsRef.current.maskShowOverlay) {
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
      const kept = historyRef.current.slice(0, historyIdxRef.current + 1);
      const arr = [...kept, {
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
      }].slice(-100);
      writeHistory(arr, arr.length - 1);
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
      loadingPromisesRef.current[lut.id] = (async () => {
        // 先問本機：以前解過的表直接讀回來，不用下載也不用重新解碼重排
        const cached = await loadCachedLut(lut.id, lut.url);
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
            const data = ctx.getImageData(0, 0, img.width, img.height).data;
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
            setLutReadyTick(t => t + 1);
            saveCachedLut(lut.id, lut.url, lutData, size);   // 收進本機，下次不用再解一次
            resolve();
          };
          img.onerror = () => resolve();
          img.src = lut.url;
        });
      })();
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
  const THUMB_CACHE_SRCS = 3;
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
  const thumbKey = (src: string, id: string) => thumbSrcOf(src) + THUMB_SEP + id;
  const noteThumbSrc = (src: string) => {
    const list = thumbSrcsRef.current;
    const at = list.indexOf(src);
    if (at >= 0) list.splice(at, 1);
    list.unshift(src);
    const drop = list.splice(THUMB_CACHE_SRCS);
    if (!drop.length) return;
    for (const store of [filterThumbStore, fxThumbStore]) {
      for (const k of Object.keys(store.current)) {
        if (drop.indexOf(k.slice(0, k.indexOf(THUMB_SEP))) >= 0) delete store.current[k];
      }
    }
  };
  const thumbSigRef = useRef('');
  useEffect(() => {
    if (activeCategory !== 'filter') return;
    let cancelled = false;
    // 還沒有這張照片的縮圖時不等（那正是「整排都還是上一張」的那一刻），
    // 已經對得上了才用防抖，拖滑桿時就不會一直重算。
    const fresh = thumbSigRef.current.split('|')[0] !== thumbSrcOf(buffersSrcRef.current);
    const t = window.setTimeout(() => {
      const b = buffers.current.preview;
      if (!b || !b.source || !b.w || !b.h) return;
      // 這一批縮圖是為了哪一組「照片 + 調整」算的
      // 每一格共通的部分（照片 + 調整）；每一顆濾鏡再各自加上「檔案載到了沒」
      /* 縮圖固定畫「原圖套上這顆濾鏡」的樣子，不跟著目前的編輯走 ——
         每動一次滑桿就把整排重算一次太浪費，而且比較不出這顆濾鏡本身的樣子。 */
      const baseSig = [thumbSrcOf(buffersSrcRef.current), b.w, b.h].join('|');
      const sig = baseSig + '|' + lutList.map(l => (l.url && lutDataRef.current[l.id]) ? 1 : 0).join('');
      if (sig === thumbSigRef.current) return;
      const forSrc = thumbSrcOf(buffersSrcRef.current);
      noteThumbSrc(forSrc);

      const W = THUMB_W, H = THUMB_H;
      const src = document.createElement('canvas');
      src.width = b.w; src.height = b.h;
      src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.source), b.w, b.h), 0, 0);
      const small = document.createElement('canvas');
      small.width = W; small.height = H;
      const sctx = small.getContext('2d', { willReadFrequently: true })!;
      sctx.imageSmoothingQuality = 'high';
      // 置中裁切成縮圖的比例，才不會變形
      const scale = Math.max(W / b.w, H / b.h);
      const dw = b.w * scale, dh = b.h * scale;
      sctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const thumbSrc = sctx.getImageData(0, 0, W, H).data;

      const flat = DEFAULT_PARAMS;          // 一律用預設參數（＝原圖）
      const baseLut = new Uint8Array(256);
      generateBaseCorrectionLut(flat.exposure, flat.contrast, flat.brightness, baseLut);
      const curveLuts = {
        rgb: generateCurveLut(flat.curves.rgb), r: generateCurveLut(flat.curves.r),
        g: generateCurveLut(flat.curves.g), b: generateCurveLut(flat.curves.b),
      };
      const cvs = document.createElement('canvas');
      cvs.width = W; cvs.height = H;
      const cctx = cvs.getContext('2d')!;

      runThumbChunks(
        lutList,
        (lut: { id: string; name: string; url: string }) => {
          const data = lut.url ? lutDataRef.current[lut.id] : null;
          if (lut.url && !data) return false;    // 濾鏡檔還沒下載完，等下一輪
          const key = thumbKey(forSrc, lut.id);
          const itemSig = baseSig + '|' + lut.id;
          /* 縮圖要照這顆濾鏡「按下去之後真正套用的強度」畫。
             以前一律用 100%，但有 13 顆的預設強度是 50／70／80，
             縮圖看起來就比實際套上去的濃 —— 這就是「縮圖跟濾鏡對不上」。 */
          const amount = lut.url ? (LUT_DEFAULT_AMOUNT[lut.id] ?? 100) : 100;
          // 背景預載每載好一顆就會再跑一輪，這裡跳過已經是最新的那些格子，
          // 才不會為了補一格把整排重算一次
          if (filterThumbStore.current[key]?.sig === itemSig) return false;
          const dst = new Uint8ClampedArray(thumbSrc.length);
          try {
            processPixels(thumbSrc, dst, W, H,
              { ...flat, lutAmount: amount }, data ? data.data : null, data ? data.size : 0,
              baseLut, null, false, curveLuts);
          } catch { return false; }
          cctx.putImageData(new ImageData(dst, W, H), 0, 0);
          putThumb(filterThumbStore, key, cvs, itemSig);
          return true;
        },
        repaintThumbs,
        () => cancelled,
        () => { thumbSigRef.current = sig; },
      );
    }, fresh ? 0 : 300);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [activeCategory, lutList, previewAspect, loadingLutId, activeSrc, buffersTick, lutReadyTick]);

  /* 特效縮圖：跟濾鏡那排同一套 —— 先把目前的預覽縮成小圖，
     再分別套上每一個特效的預設效果。GLSL 那些直接走 applyGlEffects，
     原本就有的柔光／光暈／漏光／模糊／噪點則走 applyComplexEffects。 */
  const FX_THUMB_DEMO: Record<string, Partial<EditorParams>> = {
    softLight: { soft: 70, softThreshold: 60, softRadius: 100, softColor: 0 },
    halation: { fringeIntensity: 80, fringeSize: 30, fringeFeather: 100, fringeHue: 8 },
    lightLeak: { leakOpacity: 75, leakAngle: 45, leakHue: 15 },
    blur: { blur: 45 },
    colorNoise: { colorNoise: 70 },
  };
  /** 「還沒算到這一格」時先頂著的底圖（沒有套任何特效的樣子）的鍵 */
  const FX_THUMB_BASE = '__base';
  /* applyComplexEffects 宣告在後面，用 ref 取用（它每次 render 都會更新） */
  const applyComplexEffectsRef = useRef<any>(() => {});
  const fxThumbSigRef = useRef('');
  useEffect(() => {
    if (activeCategory !== 'effects') return;
    let cancelled = false;
    const fresh = fxThumbSigRef.current.split('|')[0] !== thumbSrcOf(buffersSrcRef.current);
    const t = window.setTimeout(() => {
      const b = buffers.current.preview;
      if (!b || !b.source || !b.w || !b.h) return;
      const sig = [thumbSrcOf(buffersSrcRef.current), b.w, b.h].join('|');
      if (sig === fxThumbSigRef.current) return;
      const forSrc = thumbSrcOf(buffersSrcRef.current);
      noteThumbSrc(forSrc);

      const W = THUMB_W, H = THUMB_H;
      const src = document.createElement('canvas');
      src.width = b.w; src.height = b.h;
      src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.source), b.w, b.h), 0, 0);

      // 底圖固定是原圖：不套濾鏡也不套調整
      const flat = DEFAULT_PARAMS;
      const baseLut = new Uint8Array(256);
      generateBaseCorrectionLut(flat.exposure, flat.contrast, flat.brightness, baseLut);
      const curveLuts = {
        rgb: generateCurveLut(flat.curves.rgb), r: generateCurveLut(flat.curves.r),
        g: generateCurveLut(flat.curves.g), b: generateCurveLut(flat.curves.b),
      };

      const small = document.createElement('canvas');
      small.width = W; small.height = H;
      const sctx = small.getContext('2d', { willReadFrequently: true })!;
      sctx.imageSmoothingQuality = 'high';
      const scale = Math.max(W / b.w, H / b.h);
      const dw = b.w * scale, dh = b.h * scale;
      sctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const thumbSrc = sctx.getImageData(0, 0, W, H).data;
      const baseData = new Uint8ClampedArray(thumbSrc.length);
      try {
        processPixels(thumbSrc, baseData, W, H,
          { ...flat, ...NO_EFFECT_PARAMS } as EditorParams, null, 0,
          baseLut, null, false, curveLuts);
      } catch { return; }

      const cvs = document.createElement('canvas');
      cvs.width = W; cvs.height = H;
      const cctx = cvs.getContext('2d', { willReadFrequently: true })!;
      // 先把「沒套任何特效」的底圖收進倉庫 —— 還沒輪到的格子先用它頂著，
      // 一進特效分頁整排就有東西可看，不會是一排空格。
      cctx.putImageData(new ImageData(new Uint8ClampedArray(baseData), W, H), 0, 0);
      putThumb(fxThumbStore, thumbKey(forSrc, FX_THUMB_BASE), cvs);
      repaintThumbs();

      runThumbChunks(
        EFFECT_TOOLS,
        (tool) => {
          cctx.putImageData(new ImageData(new Uint8ClampedArray(baseData), W, H), 0, 0);
          const demo: EditorParams = { ...flat, ...NO_EFFECT_PARAMS, ...(FX_THUMB_DEMO[tool.id] || {}) } as EditorParams;
          if (FX_TOOLS[tool.id]) demo[tool.id as `fx${string}`] = 100;
          try {
            applyComplexEffectsRef.current(cctx, W, H, demo, Math.max(W, H) / 1080,
              new Uint8ClampedArray(baseData.length), false, true, baseData);
          } catch { /* 單一格算不出來就留基底圖 */ }
          putThumb(fxThumbStore, thumbKey(forSrc, tool.id), cvs);
          return true;
        },
        repaintThumbs,
        () => cancelled,
        () => { fxThumbSigRef.current = sig; },
      );
    }, fresh ? 0 : 300);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [activeCategory, lutList, previewAspect, activeSrc, buffersTick]);

  const handleFilterSelect = (idx: number) => {
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
        if (lutId === 'f21') softThresholdVal = 60;
        else if (lutId === 'f4') softThresholdVal = 75;
        else softThresholdVal = 70;
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
  const softOnPatch = () => {
    if (softManuallyAdjusted && userSoftRef.current !== 0) {
      return { patch: { soft: userSoftRef.current }, manual: softManuallyAdjusted };
    }
    const lutId = lutList[selectedLutIdx]?.id || 'none';
    const softThresholdVal = lutId === 'f21' ? 60 : lutId === 'f4' ? 75 : 70;
    userSoftRef.current = 100;
    return { patch: { soft: 100, softThreshold: softThresholdVal }, manual: false };
  };
  const blurOnPatch = () => {
    if (blurManuallyAdjusted && userBlurRef.current !== 0) {
      return { patch: { blur: userBlurRef.current }, manual: blurManuallyAdjusted };
    }
    const lutId = lutList[selectedLutIdx]?.id || 'none';
    const targetBlur = (lutId === 'f22' || lutId === 'f23') ? 30 : 40;
    userBlurRef.current = targetBlur;
    return { patch: { blur: targetBlur }, manual: false };
  };
  const grainOnPatch = () => {
    const g = userGrainRef.current;
    if (grainManuallyAdjusted && !(g.grain === 0 && g.colorNoise === 0 && g.colorNoise2 === 0)) {
      return { patch: { grain: g.grain, colorNoise: g.colorNoise, colorNoise2: g.colorNoise2 }, manual: grainManuallyAdjusted };
    }
    userGrainRef.current = { grain: 0, colorNoise: 40, colorNoise2: 0 };
    return { patch: { colorNoise: 40, grain: 0, colorNoise2: 0 }, manual: false };
  };
  const halationOnPatch = () => {
    if (halationManuallyAdjusted && userHalationRef.current !== 0) {
      return { patch: { fringeIntensity: userHalationRef.current }, manual: halationManuallyAdjusted };
    }
    userHalationRef.current = 100;
    return { patch: { fringeIntensity: 100, fringeHue: 8, fringeSize: 10, fringeFeather: 100 }, manual: false };
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

  /** 現在一個特效都沒開嗎（「原始」那張卡片要不要亮白框） */
  const noEffectOn = !hasLiveEffect(params);

  /** 「原始」：把所有特效關掉 */
  const clearAllEffects = () => {
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
    if (FX_TOOLS[toolId]) warmFx(toolId);   // 先把著色器編好，第一次拖才不會卡
    setActiveFxId(toolId);
    const amountId = effectAmountId(toolId);
    setActiveToolId(amountId);

    /* 一次只能套一個特效：先把其他特效整組歸零，再把這一顆打開。
       四顆開關（柔光／朦朧／噪點／光暈）的狀態也要跟著關掉，
       不然參數是 0 但按鈕還亮著。
       想疊第二個特效就要先按「合併」把現在這個烤進圖層。 */
    const next = clearOtherEffects(paramsRef.current, toolId) as EditorParams;
    const wasOn = ((paramsRef.current as any)[amountId] || 0) !== 0;

    // 這一顆本來就開著就不動它的值（只是把別的關掉）；沒開才套預設強度
    let manSoft = softManuallyAdjusted, manBlur = blurManuallyAdjusted;
    let manGrain = grainManuallyAdjusted, manHalation = halationManuallyAdjusted;
    if (!wasOn) {
      if (toolId === 'softLight') { const on = softOnPatch(); Object.assign(next, on.patch); manSoft = on.manual; }
      else if (toolId === 'blur') { const on = blurOnPatch(); Object.assign(next, on.patch); manBlur = on.manual; }
      else if (toolId === 'colorNoise') { const on = grainOnPatch(); Object.assign(next, on.patch); manGrain = on.manual; }
      else if (toolId === 'halation') { const on = halationOnPatch(); Object.assign(next, on.patch); manHalation = on.manual; }
      else {
        const on = EFFECT_ON_AMOUNT[toolId];
        if (on) (next as any)[amountId] = on;
      }
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
      setActiveCategory('fx');
    }
  };

  /** 這顆卡片有沒有細項可以調 */
  const effectHasDetail = (toolId: string) =>
    !!EFFECT_DETAIL_CAT[toolId] || !!(FX_TOOLS[toolId] && FX_TOOLS[toolId].length > 1);

  const applyComplexEffects = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, p: EditorParams, scale: number, sharedBuf: Uint8ClampedArray | null, isInteracting: boolean, baking: boolean, sourcePixelData: Uint8ClampedArray | null) => {
    const lut = lutList[selectedLutIdx];
    const lutId = lut?.id || 'none';
    const toneStr = toneSig(p);

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
        const sameSize = c.w === w && c.h === h;
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
                    w, h, colorNoise2: p.colorNoise2, lutId,
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
        const sameSize = c.w === w && c.h === h;
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
                    w, h, blur: p.blur, lutId,
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
        const sameSize = c.w === w && c.h === h;
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

    if (p.soft > 0) {
      ctx.save(); 
      ctx.globalCompositeOperation = 'screen'; 
      ctx.globalAlpha = (p.soft / 100) * (p.softColor > 0 ? 3.0 : 1.5);

      if (useSoftCache && cachedSoftCanvasRef.current) {
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
        
        const glowThreshold = (p.softThreshold / 100) * 255;
        const currentData = mCtx.getImageData(0, 0, mw, mh).data;
        const mImgData = mCtx.createImageData(mw, mh);
        const mData = mImgData.data;
        
        let r_c = 0, g_c = 0, b_c = 0;
        if (p.softColor > 0) {
          const [tr, tg, tb] = hslToRgb(p.softColor / 100, 1.0, 0.5);
          r_c = tr; g_c = tg; b_c = tb;
        }
        
        for (let i = 0; i < currentData.length; i += 4) {
          const r = currentData[i], g = currentData[i+1], b = currentData[i+2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          mData[i] = p.softColor > 0 ? r_c : r; mData[i+1] = p.softColor > 0 ? g_c : g; mData[i+2] = p.softColor > 0 ? b_c : b;
          
          const diff = lum - glowThreshold;
          mData[i+3] = diff > 0 ? Math.min(255, diff * 5) : 0;
        }

        const blurRadius = (p.softRadius / 100) * 80 * scale * procScale;
        fastBlur(mImgData, mw, mh, blurRadius, sharedBuf);
        mCtx.putImageData(mImgData, 0, 0);

        ctx.drawImage(maskCanvas, 0, 0, w, h);

        if (!baking) {
            softCacheStateRef.current = {
                w, h, soft: p.soft, softThreshold: p.softThreshold, softRadius: p.softRadius, softColor: p.softColor, lutId,
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
        const sameSize = c.w === w && c.h === h;
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

    if (p.fringeIntensity > 0) {
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
            
            hCtx.drawImage(ctx.canvas, 0, 0, hw, hh);
            const srcImgData = hCtx.getImageData(0, 0, hw, hh);
            const srcData = srcImgData.data;
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
            
            const highImgData = new ImageData(highData, hw, hh);
            const maxBlur = hw * 0.08 * 0.8553125; 
            const sizeMultiplier = p.fringeSize / 100;
            const blurRadius = Math.max(1, maxBlur * sizeMultiplier);
            
            fastBlur(highImgData, hw, hh, blurRadius, sharedBuf); 
            
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
                    w, h, fringeIntensity: p.fringeIntensity, fringeSize: p.fringeSize, fringeFeather: p.fringeFeather, fringeHue: p.fringeHue, lutId,
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

    // 9. LINEAR MASK (線性遮色片)
    const hasMaskAdjustments = 
      p.maskExposure !== 0 || 
      p.maskBrightness !== 0 || 
      p.maskContrast !== 0 || 
      p.maskHighlights !== 0 || 
      p.maskShadows !== 0 || 
      p.maskTemp !== 0 || 
      p.maskTint !== 0 || 
      p.maskSat !== 0 || 
      p.maskVib !== 0;

    if (p.maskCreated && (hasMaskAdjustments || p.maskShowOverlay)) {
      ctx.save();
      
      const cos = Math.cos(p.maskAngle);
      const sin = Math.sin(p.maskAngle);

      const cx = p.maskCx * w;
      const cy = p.maskCy * h;
      const d = p.maskD * w;

      const x1 = cx - d * cos;
      const y1 = cy - d * sin;
      const x2 = cx + d * cos;
      const y2 = cy + d * sin;

      // Create offscreen canvas for applying exposure and/or red overlay to the whole image
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d')!;

      // Draw the current state of main canvas onto temp canvas
      tempCtx.drawImage(ctx.canvas, 0, 0);

      // Apply exposure and/or red overlay to the pixels in tempCanvas
      const imgData = tempCtx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const len = data.length;

      // 紅色遮罩只是編輯時看得到遮色片範圍用的輔助顯示，
      // 烘焙（導出、縮圖）出來的圖片絕對不能有它。
      const showOverlay = !baking && p.maskShowOverlay && activeCategory === 'mask' && !(isInteracting && !activeDragRef.current);

      // Pre-calculate mask adjustment constants (effects intensity increased by 150%, i.e. 2.5x multiplier)
      const exp = Math.pow(2, (p.maskExposure * 0.175 * 2.5) / 100);
      const brightVal = p.maskBrightness * 0.25 * 2.5;
      const conFactor = (259 * ((p.maskContrast * 0.2975 * 2.5) + 255)) / (255 * (259 - (p.maskContrast * 0.2975 * 2.5)));
      
      const shadows = p.maskShadows / 100;
      const highlights = p.maskHighlights / 100;
      const shLut = new Float32Array(256);
      if (p.maskShadows !== 0 || p.maskHighlights !== 0) {
          for (let i = 0; i < 256; i++) {
              const luma = i / 255;
              let offset = 0;
              if (shadows !== 0) {
                  const shadowMask = Math.pow(1.0 - luma, 3.0);
                  offset -= shadows * shadowMask * 17.5 * 2.5; 
              }
              if (highlights !== 0) {
                  const highlightMask = Math.pow(luma, 3.0);
                  offset += highlights * highlightMask * 35.0 * 2.5;
              }
              shLut[i] = offset;
          }
      }

      const tempK = p.maskTemp * 0.15 * 0.3 * 2.5;
      const tintK = p.maskTint * 0.04 * 2 * 0.3 * 2.5;
      let rAdj = 0, gAdj = 0, bAdj = 0;
      if (tempK > 0) { rAdj = tempK * 1.2; gAdj = tempK * 0.4; bAdj = -tempK * 0.8; }
      else { bAdj = Math.abs(tempK) * 1.2; rAdj = -Math.abs(tempK) * 0.5; }
      gAdj += tintK;
      const hasTempTint = rAdj !== 0 || gAdj !== 0 || bAdj !== 0;

      const protectLut = new Float32Array(256);
      if (hasTempTint) {
          for (let i = 0; i < 256; i++) {
              let pr = (i - 5) * 0.02;
              protectLut[i] = pr < 0 ? 0 : pr;
          }
      }

      const satMult = Math.max(0, 1 + (p.maskSat * 0.5 * 2.5 / 100));
      const vibVal = (p.maskVib * 0.5 * 2.5) / 100;
      const hasVib = vibVal !== 0;

      if (hasMaskAdjustments || showOverlay) {
          const redR = 220, redG = 38, redB = 38, redAlpha = 0.5;
          for (let i = 0; i < len; i += 4) {
              let r = data[i];
              let g = data[i+1];
              let b = data[i+2];

              if (hasMaskAdjustments) {
                  // 1. Exposure
                  if (p.maskExposure !== 0) {
                      r *= exp;
                      g *= exp;
                      b *= exp;
                  }

                  // 2. Brightness
                  if (p.maskBrightness !== 0) {
                      r += brightVal;
                      g += brightVal;
                      b += brightVal;
                  }

                  // 3. Contrast
                  if (p.maskContrast !== 0) {
                      r = conFactor * (r - 128) + 128;
                      g = conFactor * (g - 128) + 128;
                      b = conFactor * (b - 128) + 128;
                  }

                  r = r < 0 ? 0 : r > 255 ? 255 : r;
                  g = g < 0 ? 0 : g > 255 ? 255 : g;
                  b = b < 0 ? 0 : b > 255 ? 255 : b;

                  // 4. Shadows & Highlights (Logarithmic roll-off)
                  if (p.maskShadows !== 0 || p.maskHighlights !== 0) {
                      const lumaKey = (r * 77 + g * 150 + b * 29) >> 8;
                      const shOffset = shLut[lumaKey];
                      r += shOffset; g += shOffset; b += shOffset;
                      r = r < 0 ? 0 : r > 255 ? 255 : r;
                      g = g < 0 ? 0 : g > 255 ? 255 : g;
                      b = b < 0 ? 0 : b > 255 ? 255 : b;
                  }

                  // 5. Temp & Tint
                  if (hasTempTint) {
                      const protect = protectLut[(r * 77 + g * 150 + b * 29) >> 8];
                      r += rAdj * protect;
                      g += gAdj * protect;
                      b += bAdj * protect;
                      r = r < 0 ? 0 : r > 255 ? 255 : r;
                      g = g < 0 ? 0 : g > 255 ? 255 : g;
                      b = b < 0 ? 0 : b > 255 ? 255 : b;
                  }

                  // 6. Saturation
                  const avg = (r + g + b) * 0.33333;
                  if (satMult !== 1) {
                      r = avg + (r - avg) * satMult;
                      g = avg + (g - avg) * satMult;
                      b = avg + (b - avg) * satMult;
                  }

                  // 7. Vibrance
                  if (hasVib) {
                      let max = r > g ? (r > b ? r : b) : (g > b ? g : b);
                      let min = r < g ? (r < b ? r : b) : (g < b ? g : b);
                      const curSat = max === 0 ? 0 : (max - min) / max;
                      const boost = vibVal > 0 ? vibVal * (1 - curSat * curSat) : vibVal;
                      const b1 = 1 + boost;
                      r = avg + (r - avg) * b1;
                      g = avg + (g - avg) * b1;
                      b = avg + (b - avg) * b1;
                  }

                  r = r < 0 ? 0 : r > 255 ? 255 : r;
                  g = g < 0 ? 0 : g > 255 ? 255 : g;
                  b = b < 0 ? 0 : b > 255 ? 255 : b;
              }

              // Apply red overlay
              if (showOverlay) {
                  r = r * (1.0 - redAlpha) + redR * redAlpha;
                  g = g * (1.0 - redAlpha) + redG * redAlpha;
                  b = b * (1.0 - redAlpha) + redB * redAlpha;
              }

              data[i] = r;
              data[i+1] = g;
              data[i+2] = b;
          }
          tempCtx.putImageData(imgData, 0, 0);
      }

      // Create the linear gradient on an offscreen mask canvas
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = w;
      maskCanvas.height = h;
      const maskCtx = maskCanvas.getContext('2d')!;

      const grad = maskCtx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(1, 'rgba(255,255,255,0.0)');

      maskCtx.fillStyle = grad;
      maskCtx.fillRect(0, 0, w, h);

      // Mask the tempCanvas using 'destination-in' composite operation
      tempCtx.save();
      tempCtx.globalCompositeOperation = 'destination-in';
      tempCtx.drawImage(maskCanvas, 0, 0);
      tempCtx.restore();

      // Draw the masked temp canvas onto the main canvas
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
    }

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
      applyGlEffects(ctx, w, h, p);
    }

    if (forceRecalculateEffectsRef.current) {
        forceRecalculateEffectsRef.current = false;
    }
  }, [selectedLutIdx, lutList, activeCategory]);
  useEffect(() => { applyComplexEffectsRef.current = applyComplexEffects; }, [applyComplexEffects]);

  const renderParamsToCanvas = useCallback((p: EditorParams, targetCanvas: HTMLCanvasElement) => {
    const b = buffers.current.preview;
    if (!b.source) return;
    
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
    
    const localBaseCorrectionLut = new Uint8Array(256);
    generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, localBaseCorrectionLut);
    
    // 1. Generate tempLut0 with 0% LUT influence
    processPixels(b.source, tempLut0, b.w, b.h, p, null, 0, localBaseCorrectionLut, b.sharpenDetail, false, getCurveLuts(p.curves));
    
    // 2. Generate tempLut100 with 100% LUT influence (if activeLut is present)
    if (activeLut && tempLut100) {
        const p100 = { ...p, lutAmount: 100 };
        processPixels(b.source, tempLut100, b.w, b.h, p100, activeLut.data, lutSize, localBaseCorrectionLut, b.sharpenDetail, false, getCurveLuts(p.curves));
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

  const setupFastPreview = useCallback((toolId: string) => {
    setIsInteracting(true);
    fastPreviewCacheRef.current.active = false;
    isDirtyRef.current = true;
    lastRenderDurationRef.current = 12; // Reset interaction timing to avoid carry-over throttles

    const FAST_BLEND_TOOLS = ['brightness', 'exposure', 'contrast', 'highlights', 'shadows', 'temp', 'tint', 'sat', 'vib'];

    if (FAST_BLEND_TOOLS.includes(toolId)) {
        const b = buffers.current.preview;
        if (b.source && b.dest) {
            const len = b.source.length;
            if (!extremeBuffersRef.current.base || extremeBuffersRef.current.base.length !== len) {
                extremeBuffersRef.current.base = new Uint8ClampedArray(len);
                extremeBuffersRef.current.min = new Uint8ClampedArray(len);
                extremeBuffersRef.current.max = new Uint8ClampedArray(len);
            }
            extremeBuffersRef.current.activeToolId = toolId;

            const lut = lutList[selectedLutIdx];
            const activeLut = lut.url ? lutDataRef.current[lut.id] : null;
            const lutSize = activeLut ? activeLut.size : 0;
            const activeLutData = activeLut ? activeLut.data : null;
            const curveLuts = getCurveLuts(paramsRef.current.curves);

            // 1. Base state (current parameter with toolId = 0)
            const pBase = { ...paramsRef.current, [toolId]: 0 };
            generateBaseCorrectionLut(pBase.exposure, pBase.contrast, pBase.brightness, baseCorrectionLutRef.current);
            processPixels(b.source, extremeBuffersRef.current.base, b.w, b.h, pBase, activeLutData, lutSize, baseCorrectionLutRef.current, b.sharpenDetail, false, curveLuts);

            // 2. Min state (current parameter with toolId = -100)
            const pMin = { ...paramsRef.current, [toolId]: -100 };
            generateBaseCorrectionLut(pMin.exposure, pMin.contrast, pMin.brightness, baseCorrectionLutRef.current);
            processPixels(b.source, extremeBuffersRef.current.min, b.w, b.h, pMin, activeLutData, lutSize, baseCorrectionLutRef.current, b.sharpenDetail, false, curveLuts);

            // 3. Max state (current parameter with toolId = +100)
            const pMax = { ...paramsRef.current, [toolId]: 100 };
            generateBaseCorrectionLut(pMax.exposure, pMax.contrast, pMax.brightness, baseCorrectionLutRef.current);
            processPixels(b.source, extremeBuffersRef.current.max, b.w, b.h, pMax, activeLutData, lutSize, baseCorrectionLutRef.current, b.sharpenDetail, false, curveLuts);

            // Sync with fastPreviewCacheRef.current canvases for high-performance GPU blending
            const cache = fastPreviewCacheRef.current;
            cache.active = true;
            cache.toolId = toolId;

            if (!cache.baseCanvas) cache.baseCanvas = document.createElement('canvas');
            if (cache.baseCanvas.width !== b.w || cache.baseCanvas.height !== b.h) {
                cache.baseCanvas.width = b.w;
                cache.baseCanvas.height = b.h;
            }
            cache.baseCanvas.getContext('2d')!.putImageData(new ImageData(extremeBuffersRef.current.base, b.w, b.h), 0, 0);

            if (!cache.minCanvas) cache.minCanvas = document.createElement('canvas');
            if (cache.minCanvas.width !== b.w || cache.minCanvas.height !== b.h) {
                cache.minCanvas.width = b.w;
                cache.minCanvas.height = b.h;
            }
            cache.minCanvas.getContext('2d')!.putImageData(new ImageData(extremeBuffersRef.current.min, b.w, b.h), 0, 0);

            if (!cache.maxCanvas) cache.maxCanvas = document.createElement('canvas');
            if (cache.maxCanvas.width !== b.w || cache.maxCanvas.height !== b.h) {
                cache.maxCanvas.width = b.w;
                cache.maxCanvas.height = b.h;
            }
            cache.maxCanvas.getContext('2d')!.putImageData(new ImageData(extremeBuffersRef.current.max, b.w, b.h), 0, 0);
        }
    }
  }, [selectedLutIdx, lutList, getCurveLuts]);

  const render = useCallback((p: EditorParams, overrideLutIdx?: number) => {
    const cache = fastPreviewCacheRef.current;

    // The extreme-blend proxy canvases are built at full preview resolution, so that path
    // must keep using the preview buffer. Everything else drops to the low-res proxy while
    // the user drags and snaps back to full resolution on release.
    const FAST_BLEND_TOOLS = ['brightness', 'exposure', 'contrast', 'highlights', 'shadows', 'temp', 'tint', 'sat', 'vib'];
    const isFastBlendActive = isInteracting &&
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
    const draggingFxTool = isInteracting && !!FX_OWNER[activeToolId];
    if (draggingFxTool) {
      const d = lastRenderDurationRef.current;
      if (fxFullResRef.current && d > 60) fxFullResRef.current = false;
      else if (!fxFullResRef.current && d < 24) fxFullResRef.current = true;
    }
    const draggingFx = draggingFxTool && fxFullResRef.current;
    /* 剛換濾鏡時先用低解析度那份畫一張（運算量只有 1/4，按下去馬上看得到），
       同一拍再標記 dirty，下一幀用全解析度重畫蓋上去 —— 最終畫質沒有妥協。 */
    const quickPass = quickFilterRef.current && !!proxy.source && !isInteracting;
    const useProxy = (isInteracting && !isFastBlendActive && !!proxy.source && !draggingFx) || quickPass;
    const b = useProxy ? proxy : buffers.current.preview;

    const cvs = displayCanvasRef.current;
    if (!b.source || !b.dest || !cvs) return;
    
    if (cvs.width !== b.w || cvs.height !== b.h) { 
        cvs.width = b.w; 
        cvs.height = b.h; 
    }
    
    const ctx = cvs.getContext('2d')!;

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

    // Check if we are at effectively original state (No edits)
    const isNoEdits = currentIdx === 0 && 
        pRender.brightness === 0 && pRender.exposure === 0 && pRender.contrast === 0 && 
        pRender.highlights === 0 && pRender.shadows === 0 && pRender.temp === 0 && pRender.tint === 0 && 
        pRender.sat === 0 && pRender.vib === 0 && pRender.sharpen === 0 && 
        pRender.grain === 0 && pRender.soft === 0 && pRender.blur === 0 && pRender.colorNoise === 0 && 
        pRender.colorNoise2 === 0 && pRender.vignette === 0 && pRender.leakOpacity === 0 && 
        pRender.fringeIntensity === 0 &&
        // 新的 GLSL 特效也算「有編輯」，不然只開這些的時候會被當成沒動過而畫回原圖
        !hasActiveFx(pRender) &&
        !pRender.maskCreated &&
        pRender.curves.rgb.length === 2 && pRender.curves.rgb[0].y === 0 && pRender.curves.rgb[1].y === 255 &&
        pRender.curves.r.length === 2 && pRender.curves.r[0].y === 0 && pRender.curves.r[1].y === 255 &&
        pRender.curves.g.length === 2 && pRender.curves.g[0].y === 0 && pRender.curves.g[1].y === 255 &&
        pRender.curves.b.length === 2 && pRender.curves.b[0].y === 0 && pRender.curves.b[1].y === 255 &&
        isHslIdentity(pRender.hsl);

    if (showOriginalRef.current || isNoEdits) {
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
            pixelBufferCtx.putImageData(new ImageData(b.source, b.w, b.h), 0, 0);
            ctx.drawImage(pixelBufferCanvas, 0, 0);
        }
        cvs.style.filter = 'none';
        return;
    }

    const lut = lutList[currentIdx];
    const activeLut = lut.url ? lutDataRef.current[lut.id] : null;
    const lutSize = activeLut ? activeLut.size : 0;

    if (isFastBlendActive) {
        // Fast proxy GPU-accelerated blending: handled entirely on the GPU in the drawing step below for maximum FPS.
    } else {
        // Zero-cost sub-microsecond check: Separate pixel processing params from composite effects
        const lastP = lastProcessedParamsRef.current;
        const shouldReprocessPixels = 
            pRender.brightness !== lastP.brightness ||
            pRender.exposure !== lastP.exposure ||
            pRender.contrast !== lastP.contrast ||
            pRender.highlights !== lastP.highlights ||
            pRender.shadows !== lastP.shadows ||
            pRender.temp !== lastP.temp ||
            pRender.tint !== lastP.tint ||
            pRender.sat !== lastP.sat ||
            pRender.vib !== lastP.vib ||
            pRender.sharpen !== lastP.sharpen ||
            currentIdx !== lastP.selectedLutIdx ||
            b.w !== lastP.bufferWidth ||
            lutSize !== lastP.lutSize ||
            pRender.curves !== lastP.curvesRef ||
            pRender.hsl !== lastP.hslRef;

        if (shouldReprocessPixels) {
            const cached = getCachedFilterPixels(lut.id, pRender, b.w, b.h);
            if (cached && (activeLut ? cached.lut100 !== null : true)) {
                // 命中的也算「最近用過」，不要被當成最舊的踢掉
                const hitKey = cacheKeyOf(lut.id, b.w);
                const ord = cacheOrderRef.current;
                const hi = ord.indexOf(hitKey);
                if (hi >= 0) { ord.splice(hi, 1); ord.push(hitKey); }
                b.lut0!.set(cached.lut0);
                if (activeLut && b.lut100 && cached.lut100) {
                    b.lut100.set(cached.lut100);
                }
                
                lastProcessedParamsRef.current = {
                    brightness: pRender.brightness,
                    exposure: pRender.exposure,
                    contrast: pRender.contrast,
                    highlights: pRender.highlights,
                    shadows: pRender.shadows,
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
                    hslRef: pRender.hsl
                };
            } else {
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
                    l0.tint === pRender.tint && l0.sat === pRender.sat &&
                    l0.vib === pRender.vib && l0.sharpen === pRender.sharpen &&
                    l0.curves === pRender.curves && l0.hsl === pRender.hsl &&
                    l0.detail === b.sharpenDetail;
                if (!canReuseLut0) {
                    processPixels(b.source, b.lut0!, b.w, b.h, pRender, null, 0, baseCorrectionLutRef.current, b.sharpenDetail, false, getCurveLuts(pRender.curves));
                    lut0StateRef.current[b.w] = {
                        buf: b.lut0,
                        w: b.w, h: b.h, src: buffersSrcRef.current,
                        brightness: pRender.brightness, exposure: pRender.exposure, contrast: pRender.contrast,
                        highlights: pRender.highlights, shadows: pRender.shadows, temp: pRender.temp,
                        tint: pRender.tint, sat: pRender.sat, vib: pRender.vib, sharpen: pRender.sharpen,
                        curves: pRender.curves, hsl: pRender.hsl, detail: b.sharpenDetail,
                    };
                }
                
                // 2. Generate b.lut100: Base adjustments applied with 100% LUT influence (if activeLut is present)
                if (activeLut) {
                    const p100 = { ...pRender, lutAmount: 100 };
                    processPixels(b.source, b.lut100!, b.w, b.h, p100, activeLut.data, lutSize, baseCorrectionLutRef.current, b.sharpenDetail, false, getCurveLuts(pRender.curves));
                }
                
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
                    hslRef: pRender.hsl
                };
            }

            // Sync with GPU-backed offscreen canvases for instant rendering during slider adjustments
            if (!lut0CanvasRef.current) {
                lut0CanvasRef.current = document.createElement('canvas');
            }
            if (lut0CanvasRef.current.width !== b.w || lut0CanvasRef.current.height !== b.h) {
                lut0CanvasRef.current.width = b.w;
                lut0CanvasRef.current.height = b.h;
            }
            lut0CanvasRef.current.getContext('2d')!.putImageData(new ImageData(b.lut0!, b.w, b.h), 0, 0);

            if (activeLut) {
                if (!lut100CanvasRef.current) {
                    lut100CanvasRef.current = document.createElement('canvas');
                }
                if (lut100CanvasRef.current.width !== b.w || lut100CanvasRef.current.height !== b.h) {
                    lut100CanvasRef.current.width = b.w;
                    lut100CanvasRef.current.height = b.h;
                }
                lut100CanvasRef.current.getContext('2d')!.putImageData(new ImageData(b.lut100!, b.w, b.h), 0, 0);
            }
        }

        // Perform linear blending between b.lut0 and b.lut100 on the CPU ONLY when idle
        // to keep b.dest 100% accurate without any UI overhead during drag
        if (!isInteracting) {
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
    applyComplexEffects(ctx, b.w, b.h, pRender, scale, b.shared, isInteracting, false, b.dest);

    if (quickPass) {
      quickFilterRef.current = false;
      isDirtyRef.current = true;          // 接著馬上排一次全解析度的
      lastRenderTimeRef.current = 0;
    }

  }, [isInteracting, selectedLutIdx, lutList, applyComplexEffects, activeToolId, getCurveLuts]);

  useEffect(() => {
    /* 合併／撤銷合併也是換來源（烤好的那張變成新的原圖），但那不是「換照片」：
       參數、歷史、分頁都由那邊自己安排好了，這裡只要把緩衝區換成新的那張。
       走完整的歸零反而會把剛排好的東西洗掉，畫面也會閃一下。 */
    if (srcSwapRef.current) {
      srcSwapRef.current = false;
      const ready = takeDecoded(activeSrc);
      const install = (im: HTMLImageElement) => {
        originalImgRef.current = im;
        setImageDimensions(`${im.naturalWidth}×${im.naturalHeight}`);
        const g = geoRef.current;
        const sw = im.naturalWidth, sh = im.naturalHeight;
        // 撤銷回到「有裁切」的那一步時，緩衝區要照那個幾何重算，不然裁切會不見
        const src: CanvasImageSource = isGeoIdentity(g) ? im : composeCanvas(im, sw, sh, g, 2400);
        const w = isGeoIdentity(g) ? sw : (src as HTMLCanvasElement).width;
        const h = isGeoIdentity(g) ? sh : (src as HTMLCanvasElement).height;
        buildBuffersFromRef.current(src, w, h, false, activeSrc);
      };
      if (ready) install(ready);
      else {
        const im = new Image();
        if (!activeSrc.startsWith('blob:') && !activeSrc.startsWith('data:')) im.crossOrigin = 'anonymous';
        im.onload = () => { rememberDecoded(activeSrc, im); install(im); };
        im.src = activeSrc;
      }
      return;
    }
    setParams(JSON.parse(JSON.stringify(DEFAULT_PARAMS)));
    setActiveCategory('filter');
    setActiveToolId('filter_select');
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

    const ready = (img: HTMLImageElement) => {
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
      img.onload = () => ready(img);
      img.onerror = () => {
        setIsSwitching(false);
        console.error("Failed to load image in canvas:", activeSrc);
        alert("無法在畫布中解析此圖片，這可能是記憶體不足或格式損毀。");
        setIsEditorLoading(false);
        onCancel();
      };
      img.src = activeSrc;
    }
    return () => {
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
      setPreviewAspect({ w: pw, h: ph });
      const pData = pctx.getImageData(0, 0, pw, ph).data;
      const pLen = pData.length;

      // Precalculate sharpen detail immediately in a fast async chunk to prevent locking the UI
      const precalcSharpenAsync = async (data: Uint8ClampedArray, width: number, height: number): Promise<Int8Array> => {
          return new Promise(resolve => {
              setTimeout(() => {
                  resolve(precomputeSharpenDetail(data, width, height));
              }, 10);
          });
      };

      buffers.current = {
          preview: {
              source: pData,
              dest: new Uint8ClampedArray(pLen),
              shared: new Uint8ClampedArray(pLen),
              lutted: new Uint8ClampedArray(pLen),
              lut0: new Uint8ClampedArray(pLen),
              lut100: new Uint8ClampedArray(pLen),
              temp: new Uint8ClampedArray(pLen),
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
      const PROXY_SIZE = 900;
      let fw = pw, fh = ph;
      if (fw > PROXY_SIZE || fh > PROXY_SIZE) { const r = Math.min(PROXY_SIZE / fw, PROXY_SIZE / fh); fw = Math.max(1, (fw * r) | 0); fh = Math.max(1, (fh * r) | 0); }
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
              dest: new Uint8ClampedArray(fLen),
              shared: new Uint8ClampedArray(fLen),
              lutted: new Uint8ClampedArray(fLen),
              lut0: new Uint8ClampedArray(fLen),
              lut100: new Uint8ClampedArray(fLen),
              temp: new Uint8ClampedArray(fLen),
              sharpenDetail: null,
              w: fw, h: fh
          };
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
      
      // Warmup logic using shared buffer
      generateBaseCorrectionLut(0,0,0, baseCorrectionLutRef.current);
      if (initial) {
        // 這兩趟空跑是為了讓 JIT 先把像素迴圈編譯起來，整個編輯器開著只需要做一次。
        // 批量編輯換照片時再做一次是白花時間（換一張要多等 0.15～0.27 秒）。
        if (!pipelineWarmedRef.current) {
          processPixels(pData, buffers.current.preview.dest!, pw, ph, WARMUP_PARAMS, null, 0, baseCorrectionLutRef.current, null, false, getCurveLuts(WARMUP_PARAMS.curves));
          processPixels(pData, buffers.current.preview.dest!, pw, ph, DEFAULT_PARAMS, null, 0, baseCorrectionLutRef.current, null, false, getCurveLuts(DEFAULT_PARAMS.curves));
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
      if (initial) setIsEditorLoading(false);

      precalcSharpenAsync(pData, pw, ph).then((pDetail) => {
          if (buffers.current) {
              buffers.current.preview.sharpenDetail = pDetail;
          }
          const f = buffers.current?.fast;
          if (f && f.source) {
              return precalcSharpenAsync(f.source, f.w, f.h).then((fDetail) => {
                  if (buffers.current?.fast) buffers.current.fast.sharpenDetail = fDetail;
              });
          }
      });
  }, [render, getCurveLuts]);

  // 套用構圖：用新的幾何把來源重新算一次，再整個重建預覽緩衝。
  const applyGeo = useCallback((g: GeoParams) => {
    const img = originalImgRef.current;
    if (!img) return;
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const src = isGeoIdentity(g) ? img : composeCanvas(img, sw, sh, g, 2400);
    const w = 'width' in src ? (src as HTMLCanvasElement).width : sw;
    const h = 'height' in src ? (src as HTMLCanvasElement).height : sh;
    buildBuffersFromRef.current(src, isGeoIdentity(g) ? sw : w, isGeoIdentity(g) ? sh : h, false);
    geoRef.current = g;
    setGeo(g);
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
        // 換照片時，新圖還在解碼，緩衝區裡裝的還是上一張 —— 這時候畫出去就是舊照片。
        // 等緩衝區換成現在這一張再畫。
        const buffersReady = buffersSrcRef.current === activeSrcRef.current;
        if (cvs && b && b.source && b.dest && buffersReady) {
            const currentParams = paramsRef.current;
            const currentShowOriginal = showOriginalRef.current;
            const interacting = isInteractingRef.current;
            const now = performance.now();
            
            if (isDirtyRef.current || currentShowOriginal !== lastRenderedShowOriginalRef.current) {
                const elapsed = now - lastRenderTimeRef.current;
                
                // Adaptive Throttle: If user is interacting, we decouple the slider visual UI from canvas renders
                // by enforcing a healthy throttling rate during dragging. This leaves the main thread completely free
                // to process mouse/touch events and paint the slider handle at a perfect, fluid, lag-free 120 FPS.
                // If rendering is extremely fast (< 8ms, e.g. proxy extreme blends for brightness/exposure/contrast),
                // we do NOT throttle to allow simultaneous high-framerate image rendering.
                // With the low-res interactive proxy a full pipeline pass is now cheap enough
                // that the old "at least 80ms between frames" floor became the bottleneck, so
                // the gap is tied to the measured render cost instead of a fixed minimum.
                const throttleMs = interacting
                    ? (lastRenderDurationRef.current > 8
                        ? Math.max(24, lastRenderDurationRef.current * 1.2)
                        : 0)
                    : 0;
                
                if (elapsed >= throttleMs) {
                    isDirtyRef.current = false;
                    lastRenderedShowOriginalRef.current = currentShowOriginal;
                    lastRenderTimeRef.current = now;
                    
                    if (interacting) {
                        // Defer the heavy render calculation to a setTimeout (macro-task)
                        // so the browser can paint the UI (including the smooth slider handle and text)
                        // at 120 FPS first before executing the heavy canvas image processing.
                        if (renderTimeoutRef.current) {
                            clearTimeout(renderTimeoutRef.current);
                        }
                        renderTimeoutRef.current = setTimeout(() => {
                            const start = performance.now();
                            render(currentParams, mergeFreezeRef.current?.lutIdx);
                            const duration = performance.now() - start;
                            lastRenderDurationRef.current = duration;
                            renderTimeoutRef.current = null;
                            clearPendingLutPaint();
                        }, 0);
                    } else {
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
    
    tick();
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
    const w = isGeoIdentity(g) ? ow : (geoSource as HTMLCanvasElement).width;
    const h = isGeoIdentity(g) ? oh : (geoSource as HTMLCanvasElement).height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctxOriginal = c.getContext('2d', { willReadFrequently: true })!;
    ctxOriginal.drawImage(geoSource, 0, 0, w, h);
    const sourceData = ctxOriginal.getImageData(0, 0, w, h).data;
    const len = sourceData.length;

    const destData = new Uint8ClampedArray(len);
    const sharedData = new Uint8ClampedArray(len);
    const sharpenDetail = precomputeSharpenDetail(sourceData, w, h);

    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const lut = lutList[snap.selectedLutIdx];
    const activeLut = lut && lut.url ? lutDataRef.current[lut.id] : null;
    const lutSize = activeLut ? activeLut.size : 0;

    generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, baseCorrectionLutRef.current);

    processPixels(sourceData, destData, w, h, p, activeLut ? activeLut.data : null, lutSize, baseCorrectionLutRef.current, sharpenDetail, false, getCurveLuts(p.curves));
    ctx.putImageData(new ImageData(destData, w, h), 0, 0);
    const scale = Math.max(w, h) / 1080;
    applyComplexEffects(ctx, w, h, p, scale, sharedData, false, true, destData);
    return canvas;
  };

  /** 導出用：跟合併走同一支全解析度管線，只是最後轉成 PNG。
      成品用 blob 網址 —— 批次十張的話 dataURL 會是好幾百 MB 的字串。 */
  const renderOne = (img: HTMLImageElement, snap: BatchSnap): Promise<string> =>
    canvasToUrl(renderOneCanvas(img, snap));

  const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    if (!src.startsWith('blob:') && !src.startsWith('data:')) im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('load failed'));
    im.src = src;
  });

  /** 離開編輯器時，如果調整過但沒導出，也記一筆到歷史紀錄。
      縮圖直接用畫面上的預覽（已經是顯示解析度，很小很安全）。 */
  const recordProgress = useCallback(() => {
    // isDirtyRef 是「畫面要重畫」的旗標，畫完就會被清掉，不能拿來判斷有沒有編輯過。
    // 有沒有動過看歷史：index 0 是剛載入的狀態。
    if (historyIndex <= 0) return;
    const cv = displayCanvasRef.current;
    if (!cv || !cv.width || !cv.height) return;
    try {
      const p = paramsRef.current;
      // 畫面上這一張可能正蓋著遮色片的紅色遮罩（那只是編輯時的輔助顯示）。
      // 直接抓的話首頁的歷史縮圖就會是紅的 —— 先用同一支 render 重畫一張沒有遮罩的。
      if (p.maskCreated && p.maskShowOverlay && activeCategory === 'mask') {
        render({ ...p, maskShowOverlay: false });
      }
      addExport('editor', cv.toDataURL('image/png'), srcList[safeIdx] || imageSrc, {
        params: p, geo, selectedLutIdx,
      });
    } catch { /* 記錄失敗不能影響離開 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIndex, srcList, safeIdx, imageSrc, geo, selectedLutIdx, activeCategory, render]);

  /* 「合併」：把現在畫面上的樣子用全解析度烤成一張新的原圖，參數整組歸零。
     特效一次只能套一個，合併過的那一層已經變成點陣圖的一部分，
     所以合併完就可以再疊下一個特效。
     烤進去的是整條管線的結果（濾鏡＋調節＋特效），不是只有特效那一段 ——
     特效是接在最後面算的，只抽特效出來烤的話跟畫面上看到的不會一樣。 */
  const mergingRef = useRef(false);
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

  const mergeEffects = () => {
    if (!originalImgRef.current || mergingRef.current) return;
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
    (async () => {
      try {
        // 這一次烤進去的是哪一種（按下的當下就記好了，兩邊都套的話兩邊都算）
        const { lut: bakedLut, fx: bakedFx } = mergePendingBakeRef.current;
        const next = [...srcList];
        const made: string[] = [];
        for (let i = 0; i < srcList.length; i++) {
          // 沒連結的那幾張有自己的一份參數，這次合併不關它們的事
          if (linked[i] === false) continue;
          const base = cloneSnap(live);
          const snap: BatchSnap = {
            ...base,
            params: { ...base.params, ...(ownMaskRef.current[i] || pickMask(DEFAULT_PARAMS)) } as EditorParams,
            geo: ownGeoRef.current[i]
              ? JSON.parse(JSON.stringify(ownGeoRef.current[i]))
              : (i === safeIdx ? base.geo : { ...DEFAULT_GEO, crop: { ...FULL_CROP } }),
          };
          const img = i === safeIdx && originalImgRef.current
            ? originalImgRef.current
            : await loadImg(srcList[i]);
          const cvs = renderOneCanvas(img, snap);
          const blob = await new Promise<Blob | null>(res => cvs.toBlob(res, 'image/png'));
          if (!blob) continue;              // 這一張烤不出來就維持原樣，不要留半成品
          const url = URL.createObjectURL(blob);
          made.push(url);
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
        const shownUrl = next[safeIdx];
        if (shownUrl && shownUrl !== srcList[safeIdx]) {
          await new Promise<void>(res => {
            const im = new Image();
            im.onload = () => { rememberDecoded(shownUrl, im); res(); };
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
        mergingRef.current = false;
        setMergePending(false);
      }
    })();
  };

  const handleSave = () => {
    if (!originalImgRef.current) return;
    if (isInteracting) setIsInteracting(false);
    setSaveState('processing');
    setTimeout(async () => {
        try {
            // 先把現在畫面上這一份收回去，共用的那一份才會是最新的 ——
            // 不然「調到一半直接按儲存」時，其他連結中的照片會拿到上一次切換時的舊參數。
            stashCurrent();
            const live = liveRef.current!;
            const out: string[] = [];
            for (let i = 0; i < srcList.length; i++) {
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
              const img = i === safeIdx && originalImgRef.current
                ? originalImgRef.current
                : await loadImg(srcList[i]);
              out.push(await renderOne(img, snap));
            }
            revokeUrls(finalImagesRef.current.filter(u => !out.includes(u)));
            finalImagesRef.current = out;
            setFinalImages(out);
            setFinalImage(out[safeIdx] || out[0]);
            setSaveState('success');
            // 首頁的「最近輸出」：記下成品縮圖＋這張圖導出當下的原圖與參數
            addExport('editor', out[safeIdx] || out[0], srcList[safeIdx] || imageSrc, {
              params: paramsRef.current, geo, selectedLutIdx,
            });
        } catch (e) { console.error("Save failed", e); setSaveState('idle'); }
    }, 100);
  };
  
  // ... (activeTool useMemo and remaining UI render logic is identical)
  const activeTool = useMemo(() => {
    if (activeToolId === 'filter_select') {
      if (selectedLutIdx === 0) return null;
      return { id: 'lutAmount' as keyof EditorParams, label: '強度', min: 0, max: 100, step: 0.1 };
    }
    if (activeToolId === 'curves' || activeToolId === 'hsl') return null; 
    let tool = [...ADJUST_TOOLS, ...EFFECT_TOOLS].find(t => t.id === activeToolId);
    /* 特效那一頁選中柔光／光暈／漏光時，外層那根滑桿調的是它們各自的強度參數
       （soft／fringeIntensity／leakOpacity）。 */
    if (!tool && activeCategory === 'effects') {
      const card = EFFECT_TOOLS.find(t => effectAmountId(t.id) === activeToolId);
      const src = [...SOFT_LIGHT_TOOLS, ...HALATION_TOOLS, ...LEAK_TOOLS].find(t => t.id === activeToolId);
      if (card && src) tool = { ...src };
    }
    /* 特效最外層那根滑桿一律叫「強度」——
       選中哪一顆卡片，卡片自己已經有白框跟名字了，滑桿上再寫一次特效名字沒有意義。 */
    if (tool && activeCategory === 'effects') tool = { ...tool, label: '強度' };
    if (!tool && activeCategory === 'leak') tool = LEAK_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'soft') tool = SOFT_LIGHT_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'halation') tool = HALATION_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'grain') tool = GRAIN_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'mask') tool = MASK_TOOLS.find(t => t.id === activeToolId);
    if (!tool && activeCategory === 'fx') tool = (FX_TOOLS[activeFxId] || []).find(t => t.id === activeToolId);
    return tool;
  }, [activeToolId, selectedLutIdx, activeCategory, activeFxId]);

  /* 進出 HSL 完全不做動畫。面板本身是直接掛上／拿掉，但滑桿列收合是 CSS
     transition，得知道「這一次 render 是不是跟 HSL 有關」才能把時間關掉：
     ref 在 effect 裡才更新，所以離開 HSL 的那一次 render 讀到的還是舊值。 */
  const prevToolIdRef = useRef(activeToolId);
  const hslSwitch = activeToolId === 'hsl' || prevToolIdRef.current === 'hsl';
  /* 從 HSL 直接切到曲線時，曲線不做入場 —— HSL 那一側本來就是瞬間收掉的，
     曲線再慢慢長出來會像是「面板閃了一下又重來」。ref 在 effect 裡才更新，
     所以切過去的那一次 render 讀到的還是 hsl，剛好就是要關掉動畫的那一次。 */
  const curvesFromHsl = activeToolId === 'curves' && prevToolIdRef.current === 'hsl';
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
  const [hslFit, setHslFit] = useState<{ mb: number; mh: number } | null>(null);
  const measureHslFit = useCallback(() => {
    const box = previewBoxRef.current;
    const panel = document.querySelector('[data-hsl-panel]') as HTMLElement | null;
    if (!box || !panel) return;
    const b = box.getBoundingClientRect();
    const pn = panel.getBoundingClientRect();
    const PAD = 16;   // TransformComponent 的 p-4
    const GAP = 8;    // 別讓圖整個貼在面板上緣，貼著看起來像破圖
    const mb = Math.max(0, Math.round(b.bottom - PAD - pn.top + GAP));
    const mh = Math.max(120, Math.round(pn.top - GAP - (b.top + PAD)));
    setHslFit(prev => (prev && prev.mb === mb && prev.mh === mh) ? prev : { mb, mh });
  }, []);
  useLayoutEffect(() => {
    if (activeToolId !== 'hsl') { setHslFit(prev => (prev ? null : prev)); return; }
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
  const hslFitNow = activeToolId === 'hsl' ? hslFit : null;

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

  /* 遮色片還沒建立時，版面跟建立後一模一樣 —— 只是那些控制項不能動。
     （原本會把兩列都收起來、預覽也放大，變成一個完全不同的畫面。） */
  const maskLocked = activeCategory === 'mask' && !params.maskCreated;
  const sliderRowHidden = activeToolId === 'curves' || activeToolId === 'hsl' || activeCategory === 'compose';
  const subStripHidden = activeCategory === 'compose';

  /* ---- 新特效的細項面板 ------------------------------------------------------
     以前是兩層：小分類列放參數按鈕，滑桿列一次只顯示按到的那一根。
     現在把那一個特效的滑桿全部一次攤開，不用再點第二層。

     高度是借來的，不是長出來的：滑桿列從 5rem 撐到 11rem，小分類列同時收成 0，
     兩者相加還是 5rem + 6rem —— 底部欄總高完全沒變，所以預覽圖的大小也沒變。 */
  const fxPanel = activeCategory === 'fx';
  const fxRows = useMemo(() => {
    const tools = FX_TOOLS[activeFxId] || [];
    if (!tools.length) return [] as ToolDef[][];
    const out: ToolDef[][] = [];
    // 剛好兩根的時候上下各站一行 —— 兩根擠在同一排左右並排會太窄，字都快貼在一起了
    if (tools.length === 2) return [[tools[0]], [tools[1]]];
    // 奇數根的時候「強度」自己站一行，剩下的兩兩一排
    const solo = tools.length % 2 === 1;
    if (solo) out.push([tools[0]]);
    const rest = tools.slice(solo ? 1 : 0);
    for (let i = 0; i < rest.length; i += 2) out.push(rest.slice(i, i + 2));
    return out;
  }, [activeFxId]);
  /** 每一排的高度：排數少就排鬆一點，最多四排時剛好塞得下 */
  const fxRowH = fxRows.length ? Math.min(52, Math.floor(172 / fxRows.length)) : 52;

  /* 從構圖直接切到別的分頁 ＝ 等同按了「完成」，裁切照樣套用。
     只有明確按「取消」才會丟掉（onCancel 會先把 draftGeo 清成 null，
     所以這個 effect 不會重複套一次）。 */
  useEffect(() => {
    if (activeCategory !== 'compose' && draftGeo) {
      applyGeo(draftGeo);
      addToHistory(paramsRef.current, selectedLutIdx);
      setDraftGeo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, draftGeo]);

  /* 進構圖之前待在哪一頁 —— 按完成之後回去那一頁，不要一律跳回濾鏡 */
  const beforeComposeRef = useRef<{ cat: Category; tool: string }>({ cat: 'filter', tool: 'filter_select' });

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
    const currentPoints = [...params.curves[currentCurveChannel]];
    if (dragPointIdx > 0 && x255 <= currentPoints[dragPointIdx - 1].x) x = (currentPoints[dragPointIdx - 1].x / 255) * 200 + 1;
    if (dragPointIdx < currentPoints.length - 1 && x255 >= currentPoints[dragPointIdx + 1].x) x = (currentPoints[dragPointIdx + 1].x / 255) * 200 - 1;
    const newPoints = [...currentPoints];
    newPoints[dragPointIdx] = { x: (x / 200) * 255, y: (y / 200) * 255 };
    const newCurves = { ...params.curves, [currentCurveChannel]: newPoints };
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
      const pts = [...params.curves[currentCurveChannel]].sort((a,b)=>a.x-b.x);
      let pathD = `M ${pts[0].x/255*200} ${200 - (pts[0].y/255*200)}`;
      for (let i = 0.5; i <= 200.5; i += 0.5) {
          const x255 = (i/200)*255;
          const y255 = getSplineY(Math.min(x255, 255), pts);
          pathD += ` L ${i} ${200 - (y255/255*200)}`;
      }
      return pathD;
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
    <div className="fixed inset-0 bg-[#080808] z-[60] flex flex-col animate-in slide-in-from-right duration-300 font-sans text-white overflow-hidden no-callout"
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
      
      {isEditorLoading && (
        <div className="absolute inset-0 z-[120] flex items-center justify-center bg-[#080808]/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4 text-white">
            <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
            <p className="text-[10px] font-black tracking-[0.2em] uppercase animate-pulse opacity-70">解析中...</p>
          </div>
        </div>
      )}

      {saveState === 'success' && finalImage && (
          <div className="absolute inset-0 z-[110] bg-black flex flex-col animate-in fade-in duration-500">
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
                  <div className={`w-full flex flex-row items-center gap-4 ${finalImages.length > 1 ? 'overflow-x-auto no-scrollbar snap-x snap-mandatory px-[max(0px,calc(50%-40vw))]' : 'justify-center'}`}>
                    {(finalImages.length ? finalImages : [finalImage!]).map((src, i) => (
                      <div key={src} className="shrink-0 snap-center flex flex-col items-center gap-2">
                        <div className="relative shadow-2xl overflow-hidden max-h-[60vh]">
                          <img
                              src={src}
                              alt={`Final Result ${i + 1}`}
                              className="max-w-[80vw] max-h-[60vh] object-contain allow-callout relative z-10"
                          />
                          <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10"></div>
                        </div>
                      </div>
                    ))}
                  </div>
              </div>
              <div className="bg-black flex flex-col gap-3 px-6 pb-6 pt-2">
                   <SaveButton urls={finalImages.length ? finalImages : (finalImage ? [finalImage] : [])} />
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

      {saveState !== 'success' && (
      <header className="h-14 relative flex items-center justify-between px-4 shrink-0 bg-black/40 backdrop-blur-xl z-20">
        <div className="w-24">
            <button onClick={() => { recordProgress(); onCancel(); }} className="p-2 -ml-2 text-white/40 hover:text-white transition-colors"><Icon name="close" className="text-2xl" /></button>
        </div>
        <div className="flex items-center gap-4">
           <button onClick={undo} disabled={historyIndex <= 0} className={`p-2 transition-all ${historyIndex <= 0 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}><Icon name="undo" className="text-xl" /></button>
           <button onClick={redo} disabled={historyIndex >= history.length - 1} className={`p-2 transition-all ${historyIndex >= history.length - 1 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}><Icon name="redo" className="text-xl" /></button>
        </div>
        <div className="w-24 flex justify-end items-center gap-1">
            <button 
                onClick={() => setShowExifPanel(prev => !prev)} 
                className={`p-2 rounded-full transition-colors ${showExifPanel ? 'text-white' : 'text-white/40 hover:text-white'}`}
                title="照片資訊"
            >
                <Icon name="info" className="text-xl" />
            </button>
            <button onClick={handleSave} className="bg-white text-black px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg active:scale-95 transition-transform whitespace-nowrap">儲存</button>
        </div>
      </header>
      )}

      {/* EXIF panel overlay */}
      {showExifPanel && (
        <div className="absolute top-16 right-4 left-4 md:left-auto md:right-4 mx-auto md:mx-0 bg-black/90 border border-white/10 rounded-2xl p-5 shadow-2xl backdrop-blur-xl z-[70] w-[320px] max-w-[calc(100vw-2rem)] text-white/90 text-xs flex flex-col gap-3">
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
        className={`flex-1 relative flex bg-[#080808]`}
      >
        <TransformWrapper 
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
            <div className="relative shadow-2xl transition-transform active:scale-[0.99] duration-300 w-full h-full flex items-center justify-center">
              {/* Sizing wrapper to ensure canvas and interactive overlay scale/move together perfectly */}
              <div 
                /* 進出 HSL 不做動畫，所以那一次切換把過場關掉 */
                className={`relative flex items-center justify-center ease-[cubic-bezier(0.2,0,0,1)] max-w-[calc(100%-32px)] ${hslSwitch ? 'transition-none' : 'transition-[max-height] duration-500'}`}
                style={{
                  maxHeight: hslFitNow
                    ? `${hslFitNow.mh}px`
                    : 'calc(100vh - 340px)',
                  marginBottom: hslFitNow ? `${hslFitNow.mb}px` : undefined,
                  aspectRatio: previewAspect ? `${previewAspect.w}/${previewAspect.h}` : undefined,
                  width: previewAspect ? '100%' : 'auto',
                }}
              >
                {/* Single Canvas for Display and Compare */}
                <canvas 
                    ref={displayCanvasRef} 
                    className={previewAspect ? "w-full h-full object-contain pointer-events-auto rounded-sm" : "max-w-full object-contain pointer-events-auto rounded-sm"} 
                />

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
                    className="absolute inset-0 w-full h-full select-none pointer-events-auto overflow-visible z-30"
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
                <div className="flex flex-col items-center gap-4 bg-[#111111] px-8 py-6 rounded-3xl border border-white/10 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.8)] max-w-xs text-center pointer-events-auto">
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
                    className="w-full mt-2 py-2 px-4 bg-white/10 hover:bg-white/20 active:scale-95 text-white text-[11px] font-bold rounded-xl transition-all uppercase tracking-[0.1em]"
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
             位置跟右下角的前後對比鍵左右對稱，線條粗細也跟它一致（1.2）。
             只有「現在真的套著特效或濾鏡」時才出現 —— 合併過的參數已經歸零，不算。 */}
        {(hasMergeable || mergedCount > 0) && (
          <button
            aria-label="合併特效"
            onClick={hasMergeable ? mergeEffects : undefined}
            disabled={!hasMergeable}
            className="absolute bottom-2 left-2 px-2 py-2 flex flex-col items-center justify-center gap-1 select-none touch-none z-20 text-white"
          >
            {/* 疊在一起的兩層（沒有箭頭）：扁、細線，寬度比前後對比鍵窄一點 */}
            <svg width="28" height="18" viewBox="0 0 34 22" fill="none" xmlns="http://www.w3.org/2000/svg"
                 className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              <path d="M17 2.5 30 8.5 17 14.5 4 8.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M4 13 17 19 30 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
        {activeCategory === 'compose' && draftGeo && originalImgRef.current && (
          <ComposeStudio
            image={originalImgRef.current}
            geo={draftGeo}
            onChange={setDraftGeo}
            onCancel={() => {
              setDraftGeo(null);
              setActiveCategory(beforeComposeRef.current.cat);
              setActiveToolId(beforeComposeRef.current.tool);
            }}
            onApply={() => {
              applyGeo(draftGeo);
              addToHistory(paramsRef.current, selectedLutIdx);
              setDraftGeo(null);
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
          <button onClick={() => { setActiveCategory('effects'); setActiveFxId(EFFECT_TOOLS[0].id); setActiveToolId(effectAmountId(EFFECT_TOOLS[0].id)); }} className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${['effects', 'leak', 'soft', 'halation', 'fx'].includes(activeCategory) ? 'text-white' : 'text-white/20'}`}>
            <Icon name="magic_button" className="text-xl" fill={['effects', 'leak', 'soft', 'halation', 'fx'].includes(activeCategory)} /><span className="text-[9px] font-black uppercase tracking-[0.2em]">特效</span>
          </button>
          <button onClick={() => {
              if (activeCategory !== 'compose') beforeComposeRef.current = { cat: activeCategory, tool: activeToolId };
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
          <p className="text-[10px] text-white/40 mt-3 uppercase tracking-widest font-bold">優化高品質渲染中</p>
        </div>
      )}
    </div>
  );
};
