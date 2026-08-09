
import { canvasToUrl, revokeUrl } from '../utils/blobUrl';
import { get2dWide } from '../utils/colorSpace';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { Download, RefreshCw, Type, Circle, Heart, Star, Square, Crop, Palette, X, Plus, ChevronLeft, ArrowLeft, RotateCcw, Paintbrush, Eraser, MousePointer, Link, Link2Off, SlidersHorizontal, MoveUp, MoveDown, Copy, Sliders, Trash2 } from 'lucide-react';
import { Icon } from './Icon';
/* 文字編輯面板直接沿用經典拼圖那一顆 —— 用同一份程式碼，
   才是真正的「100% 一樣」（字體卡片牆、字距、粗體、描邊、發光全都在裡面）。 */
import {
  TextEditorPanel, ImageAdjustPanel,
  /* 圓角／羽化／描邊／發光全部改用經典拼圖那幾支：同一份程式碼，
     連羽化的三次盒狀模糊、發光的距離場都一樣，不會再有兩套外觀。 */
  cornerR, roundRectPath, makeShapeMask, makeGlowCanvas, GLOW_BLUR_UNIT, GLOW_EXTENT,
} from './GridLayoutTool';
import { DEFAULT_FONT, ensureFont, fontStack } from '../utils/fonts';
/* 構圖跟「編輯」「經典拼圖」共用同一個 ComposeStudio */
import { ComposeStudio } from './ComposeStudio';
import { DEFAULT_GEO, GeoParams, composeCanvas, isGeoIdentity } from '../utils/compose';
/* 圖片調整走跟「編輯」「經典拼圖」完全同一條像素管線 —— 同一份程式碼，
   所以濾鏡與調節的效果不可能有差。 */
import { PhotoFx, ADJUST_KEYS, applyPhotoFx, hasPhotoFx, loadLut, getLoadedLut } from '../utils/photoFx';
import { SaveButton } from './SaveButton';

// --- 自製極簡單線十字星圖標 ---
const CrossStarIcon = ({ size = 20, strokeWidth = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 Q12 12 2 12 Q12 12 12 22 Q12 12 22 12 Q12 12 12 2" />
  </svg>
);

// --- 自製單線旋渦圖標 ---
const VortexIcon = ({ size = 20, strokeWidth = 2.2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
    <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5 8.5 8.5 0 0 1-8.5 8.5 7.5 7.5 0 0 1-7.5-7.5 6.5 6.5 0 0 1 6.5-6.5 5.5 5.5 0 0 1 5.5 5.5 4.5 4.5 0 0 1-4.5 4.5 3.5 3.5 0 0 1-3.5-3.5 2.5 2.5 0 0 1 2.5-2.5 1.5 1.5 0 0 1 1.5 1.5" />
  </svg>
);

/** 四周包圍：遮罩把原圖整圈包起來 */
const AROUND = 'mask-around';
/** 四周包圍的預設比例（可以再改，只是一進去先給這個） */
const AROUND_SCALE = 1 / 3;
/** 單邊上限（Safari Mobile 安全值） */
const MAX_FINAL_DIM = 4096;
/** 導出畫布的總像素上限。真正把分頁殺掉的是「面積」不是「邊長」 */
const MAX_EXPORT_PIXELS = 20_000_000;
/**
 * 預覽時「主畫布 + 三張遮罩暫存畫布」加起來的像素預算。
 * 一張畫布是 4 bytes/px，四張加起來就是 ×4 —— 8M 像素等於 128MB，
 * 手機瀏覽器到這個量級就開始被系統回收（就是主人遇到的閃退到主畫面）。
 */
const MAX_PREVIEW_PIXELS = 56_000_000;

/**
 * 這張拼圖在某個「畫布倍率」下，主畫布加三張遮罩暫存畫布總共要幾個像素。
 * 記憶體是四張一起算的 —— 只看主畫布會低估三倍，那正是手機被回收的原因。
 */
const previewPixelsAt = (
  layout: string, bw: number, bh: number, maskScale: number, ps: number, maskCanvases: number,
) => {
  const cs = collageSizeOf(layout, bw, bh, maskScale);
  const md = maskDims(layout, bw, bh, maskScale);
  return (cs.w * cs.h + maskCanvases * md.mw * md.mh) * ps * ps;
};

/** 這個排版下遮罩相對原圖的尺寸；四周包圍時遮罩就是整張輸出畫布 */
const maskDims = (layout: string, bw: number, bh: number, maskScale: number) => {
  if (layout === AROUND) {
    return {
      mw: Math.round(bw * (1 + maskScale * 2)),
      mh: Math.round(bh * (1 + maskScale * 2)),
      padX: Math.round(bw * maskScale),
      padY: Math.round(bh * maskScale),
    };
  }
  return {
    mw: Math.round(bw * (layout.includes('left') || layout.includes('right') ? maskScale : 1)),
    mh: Math.round(bh * (layout.includes('top') || layout.includes('bottom') ? maskScale : 1)),
    padX: 0,
    padY: 0,
  };
};

/** 原圖 w×h 在這個排版下拼完之後，整張畫布有多大 */
const collageSizeOf = (layout: string, w: number, h: number, maskScale: number) => {
  const { mw, mh } = maskDims(layout, w, h, maskScale);
  if (layout === 'mask-bottom' || layout === 'mask-top') return { w, h: h + mh };
  if (layout === 'mask-right' || layout === 'mask-left') return { w: w + mw, h };
  if (layout === AROUND) return { w: mw, h: mh };
  return { w, h };
};

/** 把 id 轉成一個穩定的數字，用來打散順序（同一顆圖案永遠拿同一格，不會閃） */
/** 兩份圖案清單是不是完全一樣（id、位置、所屬側都沒變） */
const sameHoles = (a: any[], b: any[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].x !== b[i].x || a[i].y !== b[i].y
      || (a[i].side || 'both') !== (b[i].side || 'both')
      || (a[i].angle ?? null) !== (b[i].angle ?? null)
      || (a[i].localScale ?? 1) !== (b[i].localScale ?? 1)) return false;
  }
  return true;
};

const hashId = (id: string) => {
  let x = 0;
  for (let i = 0; i < (id || '').length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0;
  return x;
};

const getHoleNumber = (h: any) => {
  if (h && h.randomNumber !== undefined) return h.randomNumber;
  const hash = h && h.id ? h.id.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0) : 0;
  return hash % 10;
};

/**
 * 用文字畫出來的洞：id → 實際要畫的那個字。
 * 'love'（<3）、'text'（使用者自己打的字）、'random-num'（編號）不是固定的字，
 * 所以不放在這張表裡，由 holeGlyph() 另外處理。
 */
const GLYPH_HOLES: Record<string, string> = {
  flower:   '❋',   // ❋ 原本就有
  vortex:   '🌀',   // 🌀 原本就有
  seagrass: '𓇼',   // 𓇼 海草
  darkstar: '𖤐',   // 𖤐 暗星
  sparkle:  '⊹',   // ⊹ 小閃
  aster:    '᯽',   // ᯽ 星花
};

/** 這個洞是用文字畫的（而不是用路徑畫的）嗎 */
const isTextHole = (t: string) => t === 'text' || t === 'love' || t === 'love3' || t === 'random-num' || t in GLYPH_HOLES;

/** 這個洞實際上要畫出來的字串 */
const holeGlyph = (holeType: string, customText: string, h?: any) =>
  GLYPH_HOLES[holeType]
  ?? (holeType === 'love' ? '<3'
    : holeType === 'love3' ? '<333'
    : holeType === 'random-num' ? `(${getHoleNumber(h)})`
    : customText);

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

const drawTextShape = (
  targetCtx: CanvasRenderingContext2D,
  holeType: string,
  text: string,
  cx: number,
  cy: number,
  sz: number,
  fillStyle: any,
  isDestinationOut: boolean = false,
  holeAngle: number = 0
) => {
  const tempCanvas = document.createElement('canvas');
  const pad = Math.ceil(sz * 1.5);
  tempCanvas.width = pad * 2;
  tempCanvas.height = pad * 2;
  const tempCtx = tempCanvas.getContext('2d')!;

  // 1. 在 tempCanvas 上畫純黑色的文字形狀
  tempCtx.fillStyle = '#000000';
  tempCtx.save();
  tempCtx.translate(pad, pad);
  tempCtx.rotate(holeAngle * Math.PI / 180);
  if (holeType === 'love' || holeType === 'love3') {
    // 跟 <3 同一套字體與比例，只是字串長一點
    tempCtx.font = `bold ${sz * 1.05}px "Inter", "Segoe UI", sans-serif`;
    tempCtx.textAlign = 'center';
    tempCtx.textBaseline = 'middle';
    tempCtx.fillText(holeType === 'love3' ? '<333' : '<3', 0, 0);
  } else {
    const renderStr = GLYPH_HOLES[holeType] ?? text;
    tempCtx.font = `500 ${sz}px "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    tempCtx.textAlign = 'center';
    tempCtx.textBaseline = 'middle';
    tempCtx.fillText(renderStr, 0, 0);
  }
  tempCtx.restore();

  // 2. 如果是填充照片或顏色
  if (!isDestinationOut && fillStyle) {
    tempCtx.save();
    tempCtx.globalCompositeOperation = 'source-in';
    tempCtx.fillStyle = fillStyle;
    tempCtx.translate(pad - cx, pad - cy);
    tempCtx.fillRect(cx - pad, cy - pad, tempCanvas.width, tempCanvas.height);
    tempCtx.restore();
  }

  // 3. 繪製到 targetCtx
  targetCtx.save();
  if (isDestinationOut) {
    targetCtx.globalCompositeOperation = 'destination-out';
  }
  targetCtx.drawImage(tempCanvas, cx - pad, cy - pad);
  targetCtx.restore();
};

const drawShapePath = (ctx: CanvasRenderingContext2D, type: string, cx: number, cy: number, size: number) => {
  ctx.beginPath();
  const r = size / 2;
  switch (type) {
    case 'circle': ctx.arc(cx, cy, r, 0, Math.PI * 2); break;
    case 'square': ctx.rect(cx - r, cy - r, size, size); break;
    case 'heart':
      ctx.moveTo(cx, cy - r * 0.25);
      ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.0, cx + r * 1.3, cy - r * 0.1, cx, cy + r * 0.9);
      ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.1, cx - r * 0.6, cy - r * 1.0, cx, cy - r * 0.25);
      break;
    case 'star':
      const spikes = 5;
      const step = Math.PI / spikes;
      let rot = (Math.PI / 2) * 3;
      ctx.moveTo(cx, cy - r);
      for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r); 
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * (r / 2.2), cy + Math.sin(rot) * (r / 2.2)); 
        rot += step;
      }
      break;
    case 'cross-star':
      const stepCross = Math.PI / 4;
      let rotCross = (Math.PI / 2) * 3;
      ctx.moveTo(cx, cy - r);
      for (let i = 0; i < 4; i++) {
        ctx.lineTo(cx + Math.cos(rotCross) * r, cy + Math.sin(rotCross) * r); 
        rotCross += stepCross;
        ctx.lineTo(cx + Math.cos(rotCross) * (r * 0.25), cy + Math.sin(rotCross) * (r * 0.25)); 
        rotCross += stepCross;
      }
      break;
    default: ctx.rect(cx - r, cy - r, size, size);
  }
  ctx.closePath();
};

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  onClose: () => void;
  title: string;
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

const ColorPickerEmbedded: React.FC<ColorPickerProps> = ({ color, onChange, onClose, title }) => {
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
            <input type="range" min="0" max="360" value={hsv.h} onInput={e => handleHsvChange('h', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>飽和度</span>
                <span className="text-white/40">{Math.round(hsv.s)}%</span>
              </div>
              <input type="range" min="0" max="100" value={hsv.s} onInput={e => handleHsvChange('s', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: `linear-gradient(to right, #808080, ${hsvToHex(hsv.h, 100, 100)})` }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>明度</span>
                <span className="text-white/40">{Math.round(hsv.v)}%</span>
              </div>
              <input type="range" min="0" max="100" value={hsv.v} onInput={e => handleHsvChange('v', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: `linear-gradient(to right, #000, ${hsvToHex(hsv.h, hsv.s, 100)})` }} />
            </div>
          </div>
          {/* 韓系拼貼常用色，與經典拼圖同一組 */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-0.5 py-0.5 mt-2">
            {KOREAN_PRESETS.map(c => {
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
  onHome: () => void;
  /** 濾鏡清單，跟「編輯」「經典拼圖」同一份 */
  lutList?: { id: string; name: string; url: string }[];
  initialFile?: File | null;
  onImportNew: () => void;
  /** 接續上次時把存下來的參數餵回來 */
  initialState?: any;
}

export const CollageTool: React.FC<CollageToolProps> = ({ onHome, initialFile, onImportNew, initialState, lutList = [] }) => {
  const [imageState, setImageState] = useState<any>(null);
  const [layout, setLayout] = useState('mask-bottom');
  const [maskScale, setMaskScale] = useState(0.5);
  const [holeType, setHoleType] = useState('star'); 
  const [customText, setCustomText] = useState('Abai'); 
  const [holeSize, setHoleSize] = useState(25); 
  const [sizeJitter, setSizeJitter] = useState(0); 
  const [holeAngle, setHoleAngle] = useState(0);
  const [holeCount, setHoleCount] = useState(11);
  const [holes, setHoles] = useState<any[]>([]); 
  /* 浮動物件：疊在拼圖最上層的圖片與文字。
     跟「挖洞」完全分開 —— 洞是把遮罩打穿，這些是貼上去的圖層。
     座標一律用「輸出畫布」的座標系（跟遮罩同一套），縮放時再乘上倍率。 */
  const [objects, setObjects] = useState<any[]>([]);
  const objectsRef = useRef<any[]>([]);
  objectsRef.current = objects;
  const [selectedObj, setSelectedObj] = useState<string | null>(null);
  const selectedObjRef = useRef<string | null>(null);
  selectedObjRef.current = selectedObj;
  const objDragRef = useRef<any>(null);
  const objPinchRef = useRef<any>(null);
  /* 每個圖片物件跑完管線之後的成品，快取起來 —— 參數沒變就不重跑。
     key 是「物件 id + 參數指紋」，所以只有動到的那一張會重算。 */
  const objFxCache = useRef<Map<string, { key: string; cv: HTMLCanvasElement }>>(new Map());
  const [fxTick, setFxTick] = useState(0);
  const fxCanvasOf = useCallback((o: any): CanvasImageSource | null => {
    if (!o.img) return null;
    const shape = {
      r: o.imgRadius || 0, f: o.feather || 0,
      sw: o.imgStrokeWidth || 0, sc: o.imgStrokeColor || '#FFFFFF',
      g: o.imgGlow || 0, gc: o.imgGlowColor || '#FFFFFF',
    };
    const hasShape = shape.r || shape.f || shape.sw || shape.g;
    if ((!o.fx || !hasPhotoFx(o.fx)) && !hasShape) return o.img;
    const key = JSON.stringify([o.fx, shape]);
    const hit = objFxCache.current.get(o.id);
    if (hit && hit.key === key) return hit.cv;

    const w0 = o.img.naturalWidth || o.img.width;
    const h0 = o.img.naturalHeight || o.img.height;
    // 上限 1600：物件在畫面上不會比這更大，再高只是白燒記憶體
    const k = Math.min(1, 1600 / Math.max(w0, h0));
    const iw = Math.max(1, Math.round(w0 * k)), ih = Math.max(1, Math.round(h0 * k));
    const base = applyPhotoFx(o.img, iw, ih, o.fx || {});
    if (!hasShape) { objFxCache.current.set(o.id, { key, cv: base }); return base; }

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
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d')!;

    // 描邊往外長，所以形狀那一張要比框大 lw 一圈
    const swid = iw + lw * 2, shgt = ih + lw * 2;
    let shaped: CanvasImageSource = base;
    let drawW = iw, drawH = ih, drawX = (W - iw) / 2, drawY = (H - ih) / 2;
    if (shape.f || shape.r || shape.sw) {
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(swid));
      off.height = Math.max(1, Math.round(shgt));
      const oc = off.getContext('2d')!;
      oc.drawImage(base, lw, lw, iw, ih);
      if (shape.f || shape.r) {
        oc.globalCompositeOperation = 'destination-in';
        if (shape.f) {
          oc.drawImage(makeShapeMask(iw, ih, shape.r, shape.f), lw, lw, iw, ih);
        } else {
          const R = cornerR(shape.r, iw, ih);
          roundRectPath(oc, lw, lw, iw, ih, R, R);
          oc.fillStyle = '#fff';
          oc.fill();
        }
        oc.globalCompositeOperation = 'source-over';
      }
      if (lw > 0) {
        const sr = shape.r ? cornerR(shape.r, iw, ih) + lw / 2 : 0;
        roundRectPath(oc, lw / 2, lw / 2, iw + lw, ih + lw, sr, sr);
        oc.lineWidth = lw;
        oc.lineJoin = 'miter';
        oc.miterLimit = 4;
        oc.strokeStyle = shape.sc;
        oc.stroke();
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
    return cv;
  }, []);
  /** 圖片與遮罩的交界線（畫布座標）。四周包圍是原圖那個框的四條邊。 */
  const seamLinesRef = useRef<() => { xs: number[]; ys: number[] }>(() => ({ xs: [], ys: [] }));

  /** 把位置吸附到畫布中線／邊界／遮罩交界，並回報要亮哪幾條線 */
  const snapToGuides = useCallback((x0: number, y0: number, w0: number, h0: number) => {
    const offsG = getLayoutOffsetsRef.current?.();
    const gl: any[] = [];
    let nx = x0, ny = y0;
    if (offsG && w0 && h0) {
      const snap = Math.max(4, Math.min(offsG.cw, offsG.ch) * 0.012);
      const seams = seamLinesRef.current();
      /**
       * 單軸吸附。candidate 是「這條線」＋「要位移多少才貼上去」。
       * 規則：
       *  1. 中心線只跟「物件中心」配對 —— 邊緣碰到中心線不算對齊。
       *  2. 取最近的那一條，不是第一條符合的。
       *  3. 兩條一樣近但要往相反方向拉（例如置中放大到上下同時快貼邊），
       *     就兩條都亮著、位置完全不動 —— 以前是這一格黏上面、下一格黏下面，
       *     看起來就是在抖。
       */
      const axis = (pos: number, size: number, centre: number, edges: number[], seamList: number[]) => {
        const cands: { v: number; d: number }[] = [{ v: centre, d: centre - (pos + size / 2) }];
        for (const v of edges) {
          cands.push({ v, d: v - pos });
          cands.push({ v, d: v - (pos + size) });
        }
        for (const v of seamList) {
          cands.push({ v, d: v - pos });
          cands.push({ v, d: v - (pos + size) });
          cands.push({ v, d: v - (pos + size / 2) });
        }
        const near = cands.filter(c => Math.abs(c.d) < snap);
        if (!near.length) return { off: 0, lines: [] as number[] };
        near.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
        const best = near[0];
        const TIE = Math.max(0.75, snap * 0.06);
        const rivals = near.filter(c => Math.abs(Math.abs(c.d) - Math.abs(best.d)) < TIE
                                     && Math.abs(c.d - best.d) > TIE);
        if (rivals.length) {
          return { off: 0, lines: Array.from(new Set([best.v, ...rivals.map(r => r.v)])) };
        }
        return { off: best.d, lines: [best.v] };
      };
      const rx = axis(nx, w0, offsG.cw / 2, [0, offsG.cw], seams.xs);
      nx += rx.off; rx.lines.forEach(v => gl.push({ x: v }));
      const ry = axis(ny, h0, offsG.ch / 2, [0, offsG.ch], seams.ys);
      ny += ry.off; ry.lines.forEach(v => gl.push({ y: v }));
    }
    return { x: nx, y: ny, guides: gl };
  }, []);

  /* ── 構圖：跟「編輯」「經典拼圖」共用同一個 ComposeStudio ──────────────
     套用完把裁切結果 bake 成新的一張圖塞回這個物件，寬度不變、
     高度依新的長寬比重算，並讓中心留在原地。 */
  const [composeState, setComposeState] = useState<{ id: string; img: HTMLImageElement; geo: GeoParams } | null>(null);

  const openComposeFor = useCallback((id: string) => {
    const o = objectsRef.current.find(z => z.id === id);
    if (!o || !o.src) return;
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
      const sw = st.img.naturalWidth || st.img.width;
      const sh = st.img.naturalHeight || st.img.height;
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
  const guidesRef = useRef<any[]>([]);
  const objFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null); 
  const [colorPickerTarget, setColorPickerTarget] = useState<string | null>(null); 
  const [maskImageState, setMaskImageState] = useState<any>(null);
  const [imageTransform, setImageTransform] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [maskTransform, setMaskTransform] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [activeTab, setActiveTab] = useState('setting');
  /* 圖片編輯頁是自己排好三段式高度的整頁面板：外面不能再包內距，
     footer 也要夠高（5rem 滑桿 ＋ 6rem 工具列 ＋ h-16 分類列 ＋ 分頁列）。 */
  const objEditImage = activeTab === 'objedit' && !colorPickerTarget
    && !!objects.find(o => o.id === selectedObj && o.type === 'image');
  /** 「圖案」頁的左側子分頁：挑圖案／調參數 */
  const [shapeSub, setShapeSub] = useState<'shape' | 'style'>('shape');
  /** 編輯頁的左側子分頁 */
  const [objSub, setObjSub] = useState<'main' | 'style'>('main');
  /* 圖片調整面板的 UI 狀態 —— 跟經典拼圖同一組，只是各自持有，
     這樣兩邊的「停在哪個子分頁」互不干擾。 */
  const [adjustSub, setAdjustSub] = useState<'shape' | 'tune' | 'filter' | 'effect'>('filter');
  const [effectCard, setEffectCard] = useState<string | null>(null);
  const [effectDetail, setEffectDetail] = useState(false);
  const [shapeMenu, setShapeMenu] = useState('root');
  /* 一進編輯頁不預先選好任何工具：滑桿要點下工具鈕才浮出來 */
  const [shapeTool, setShapeTool] = useState('');
  const [tuneTool, setTuneTool] = useState('');
  const [loadingLut, setLoadingLut] = useState<string | null>(null);
  const [lutRevision, setLutRevision] = useState(0);
  const [maskColor, setMaskColor] = useState('#FFF2E6'); 
  const [patternType, setPatternType] = useState('none'); 
  const [dotColor, setDotColor] = useState('#595959'); 
  const [dotSize, setDotSize] = useState(20); 
  const [dotGap, setDotGap] = useState(20);
  const [saveState, setSaveState] = useState<'idle' | 'processing' | 'success'>('idle');
  const [finalImage, setFinalImage] = useState<string | null>(null);
  /* 成品是 blob 網址：換一張新的之前先回收，離開時也要回收 */
  const finalUrlRef = useRef<string | null>(null);
  /* 離開時晚一點再回收：導出紀錄的縮圖與分享用的檔案都是非同步去讀這個
     網址的，按下儲存後馬上離開的話會來不及讀完。 */
  useEffect(() => () => { const keep = finalUrlRef.current; setTimeout(() => revokeUrl(keep as any), 15000); }, []);
  const [, setForceRender] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textInputWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maskFileInputRef = useRef<HTMLInputElement>(null);
  const dummyCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const baseMaskCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas')); 
  const fullMaskCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas')); 
  const lowerMaskCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const activePointers = useRef<Map<number, any>>(new Map());
  const interactionRef = useRef<any>(null);
  const holesRef = useRef<any[]>([]);
  const [brushMode, setBrushMode] = useState<'off' | 'pen' | 'eraser'>('off');
  const [symmetryEnabled, setSymmetryEnabled] = useState(true);
  const lastDrawPosRef = useRef<{ x: number, y: number } | null>(null);

  useEffect(() => {
    if (patternType === 'none' && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [patternType]);

  // 選中「自訂文字」時，自動把下方的輸入框捲進視野，並在底下留一點空隙
  useEffect(() => {
    if (activeTab !== 'shape' || shapeSub !== 'shape' || holeType !== 'text') return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      const target = textInputWrapRef.current;
      if (!target) return;
      // 只捲到「輸入框完整露出」為止，不是一路捲到底 ——
      // 捲過頭的話上面那排形狀會整個跑掉，手指要再撥回來
      const need = target.offsetTop + target.offsetHeight - el.clientHeight;
      if (need > el.scrollTop) el.scrollTo({ top: need, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [activeTab, shapeSub, holeType]);

  const [historyState, setHistoryState] = useState<{
    history: any[][];
    index: number;
  }>({
    history: [[]],
    index: 0
  });

  const pushHistory = useCallback((newHoles: any[]) => {
    setHistoryState(prev => {
      const sliced = prev.history.slice(0, prev.index + 1);
      const cloned = JSON.parse(JSON.stringify(newHoles));
      const current = sliced[sliced.length - 1];
      if (current && JSON.stringify(current) === JSON.stringify(cloned)) {
        return prev;
      }
      const nextHistory = [...sliced, cloned].slice(-100);
      return {
        history: nextHistory,
        index: nextHistory.length - 1
      };
    });
  }, []);

  const resetHistory = useCallback((initialHoles: any[]) => {
    const cloned = JSON.parse(JSON.stringify(initialHoles));
    setHistoryState({
      history: [cloned],
      index: 0
    });
  }, []);

  const undo = useCallback(() => {
    if (historyState.index > 0) {
      const prevIndex = historyState.index - 1;
      const prevHoles = historyState.history[prevIndex];
      setHoles(JSON.parse(JSON.stringify(prevHoles)));
      setHistoryState(prev => ({ ...prev, index: prevIndex }));
      setSelectedTarget(null);
    }
  }, [historyState]);

  const redo = useCallback(() => {
    if (historyState.index < historyState.history.length - 1) {
      const nextIndex = historyState.index + 1;
      const nextHoles = historyState.history[nextIndex];
      setHoles(JSON.parse(JSON.stringify(nextHoles)));
      setHistoryState(prev => ({ ...prev, index: nextIndex }));
      setSelectedTarget(null);
    }
  }, [historyState]);

  useEffect(() => { holesRef.current = holes; }, [holes]);

  // ---- 跳出應用再回來還在：參數自動存檔 ----
  // 照片本身由 App 那邊存進 IndexedDB（跟其他工具共用一份草稿），
  // 這裡只負責把面板上的設定存起來、以及接續時套回去。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !initialState) return;
    restoredRef.current = true;
    const st = initialState;
    if (st.layout !== undefined) setLayout(st.layout);
    if (st.maskScale !== undefined) setMaskScale(st.maskScale);
    if (st.holeType !== undefined) setHoleType(st.holeType);
    if (st.customText !== undefined) setCustomText(st.customText);
    if (st.holeSize !== undefined) setHoleSize(st.holeSize);
    if (st.sizeJitter !== undefined) setSizeJitter(st.sizeJitter);
    if (st.holeAngle !== undefined) setHoleAngle(st.holeAngle);
    if (st.holeCount !== undefined) setHoleCount(st.holeCount);
    if (Array.isArray(st.holes)) setHoles(st.holes);
    if (st.maskColor !== undefined) setMaskColor(st.maskColor);
    if (st.patternType !== undefined) setPatternType(st.patternType);
    if (st.dotColor !== undefined) setDotColor(st.dotColor);
    if (st.dotSize !== undefined) setDotSize(st.dotSize);
    if (st.dotGap !== undefined) setDotGap(st.dotGap);
    if (st.symmetryEnabled !== undefined) setSymmetryEnabled(st.symmetryEnabled);
  }, [initialState]);

  useEffect(() => {
    if (!imageState) return;
    const t = setTimeout(() => {
      saveToolDraft('collage', null, {
        layout, maskScale, holeType, customText, holeSize, sizeJitter, holeAngle,
        holeCount, holes, maskColor, patternType, dotColor, dotSize, dotGap, symmetryEnabled,
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [
    imageState, layout, maskScale, holeType, customText, holeSize, sizeJitter, holeAngle,
    holeCount, holes, maskColor, patternType, dotColor, dotSize, dotGap, symmetryEnabled,
  ]);

  useEffect(() => {
    if (initialFile) {
      const e = { target: { files: [initialFile] } } as any;
      handleImageUpload(e);
    }
  }, [initialFile]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    // 這張照片就是草稿要存的那張（回來才接得回去）
    saveToolDraft('collage', url, null);
    const img = new Image();
    img.onload = () => {
      let bw = img.width, bh = img.height;
      const originalW = bw;
      const originalH = bh;
      // Limit working resolution to 1080px for stability
      if (Math.max(bw, bh) > 1080) { 
        const s = 1080 / Math.max(bw, bh); 
        bw *= s; 
        bh *= s; 
      }
      bw = Math.round(bw); bh = Math.round(bh);
      const gs = Math.max(bw, bh) / 1080;
      setImageState({ img, baseW: bw, baseH: bh, originalW, originalH, globalScale: gs });
      setImageTransform({ x: 0, y: 0, w: bw, h: bh });
      setLayout(bh > bw * 1.1 ? 'mask-right' : 'mask-bottom');
      setSelectedTarget(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    e.target.value = '';
  };

  const handleMaskImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (!imageState) return;
      const { baseW, baseH } = imageState;
      const scale = Math.max(baseW / img.width, baseH / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      setMaskImageState({ img });
      setMaskTransform({ x: (baseW - w) / 2, y: (baseH - h) / 2, w, h });
      setSelectedTarget(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    e.target.value = '';
  };

  const handleShapeClick = (id: string) => {
    let nextSize = holeSize;
    if (id === 'cross-star') {
      nextSize = 30;
    } else if (id === 'star') {
      nextSize = 35;
    } else if (id === 'flower') {
      nextSize = 45;
    } else if (id === 'vortex') {
      nextSize = 35;
    } else if (id === 'heart') {
      nextSize = 30;
    } else if (id === 'love') {
      nextSize = 25;
    } else if (id === 'love3') {
      // 字更長，同樣的「大小」值看起來會比較大，所以預設調小一點
      nextSize = 18;
    } else if (id === 'circle') {
      nextSize = 20;
    } else if (id === 'square') {
      nextSize = 15;
    } else if (id === 'random-num') {
      nextSize = 15;
    } else if (id === 'seagrass') {
      nextSize = 40;
    } else if (id === 'darkstar') {
      nextSize = 45;
    } else if (id === 'sparkle') {
      // 字身在字框裡本來就偏小，起始尺寸給大一點才跟其他圖案差不多大
      nextSize = 70;
    } else if (id === 'aster') {
      nextSize = 40;
    } else if (id === 'text') {
      nextSize = 15;
    }
    setHoleSize(nextSize);
    setHoleType(id);
  };

  const generateRandomHoles = useCallback((isInitial: boolean = false, layoutOverride?: string) => {
    if (!imageState) return;
    const { baseW, baseH, globalScale: gs } = imageState;
    const mappedHoleSize = 25 + (holeSize / 100) * 125;
    const s = mappedHoleSize * gs;
    /* 四周包圍時遮罩是整張畫布，圖案就單純隨機灑在整圈上 ——
       這種排版沒有「左右兩塊要對稱」的概念，所以一律 side: 'mask'。 */
    const lay = layoutOverride || layout;
    const around = lay === AROUND;
    /* 邊界安全距離。四周包圍時圖案灑在整張畫布上，只留半個圖案的話
       最外圈會有一半跑到畫面外，所以多留將近一個圖案的餘裕
       —— 但使用者自己拖出去仍然可以（那是刻意的）。 */
    /* 注意：四周包圍時 getHoleSize 會再乘上 (1 + 2×比例) 把圖案補回原本的視覺大小，
       安全距離也必須用「補過之後」的尺寸算，不然邊緣還是會被切到。 */
    const drawnS = around ? s * (1 + maskScale * 2) : s;
    const p = around ? drawnS * 0.75 + 25 * gs : s / 2 + 25 * gs;
    const md = maskDims(lay, baseW, baseH, maskScale);
    const fieldW = around ? md.mw : baseW;
    const fieldH = around ? md.mh : baseH;

    const newHoles = [];
    for (let i = 0; i < holeCount; i++) {
      let att = 0, valid = false, hx = 0, hy = 0;
      while (!valid && att < 500) {
        hx = p + Math.random() * (fieldW - p * 2); hy = p + Math.random() * (fieldH - p * 2); valid = true;
        for (let ex of newHoles) if (Math.hypot(ex.x - hx, ex.y - hy) < s * 1.2) { valid = false; break; }
        att++;
      }
      newHoles.push({
        id: Math.random().toString(36).substr(2, 9), x: hx, y: hy,
        randomFactor: Math.random() * 2 - 1, randomNumber: Math.floor(Math.random() * 10),
        side: around ? 'mask' : (symmetryEnabled ? 'both' : 'image'),
      });
    }
    setHoles(newHoles);
    if (isInitial) {
      resetHistory(newHoles);
    } else {
      pushHistory(newHoles);
    }
  }, [imageState, holeCount, holeSize, sizeJitter, pushHistory, resetHistory, symmetryEnabled, layout, maskScale]);

  useEffect(() => { 
    setSelectedTarget(null);
    generateRandomHoles(true); 
    /* 這裡刻意「不」放 layout：換排版時是在按鈕裡跟 setLayout 同一批更新
       一起重灑的，放進來反而會多跑一輪 —— 那多出來的一格畫面就是
       「新版面配舊座標的圖案」，看起來就是閃一下。 */
  }, [imageState, holeCount]);

  const getLayoutOffsets = useCallback(() => {
    if (!imageState) return null;
    let { baseW: bw, baseH: bh } = imageState;
    const { mw, mh, padX, padY } = maskDims(layout, bw, bh, maskScale);

    if (layout === 'mask-bottom') return { cw: bw, ch: bh + mh, ix: 0, iy: 0, mx: 0, my: bh };
    if (layout === 'mask-top') return { cw: bw, ch: bh + mh, ix: 0, iy: mh, mx: 0, my: 0 };
    if (layout === 'mask-right') return { cw: bw + mw, ch: bh, ix: 0, iy: 0, mx: bw, my: 0 };
    if (layout === 'mask-left') return { cw: bw + mw, ch: bh, ix: mw, iy: 0, mx: 0, my: 0 };
    // 四周包圍：遮罩就是整張畫布，原圖擺正中央
    if (layout === AROUND) return { cw: mw, ch: mh, ix: padX, iy: padY, mx: 0, my: 0 };
    return { cw: bw, ch: bh, ix: 0, iy: 0, mx: 0, my: 0 };
  }, [imageState, layout, maskScale]);
  getLayoutOffsetsRef.current = getLayoutOffsets;

  /* 圖片與遮罩的交界：並排的四種各有一條，四周包圍是原圖那個框的四條邊。 */
  seamLinesRef.current = () => {
    const o = getLayoutOffsets();
    if (!o || !imageState) return { xs: [] as number[], ys: [] as number[] };
    const { baseW: bw, baseH: bh } = imageState;
    if (layout === 'mask-bottom') return { xs: [], ys: [bh] };
    if (layout === 'mask-top') return { xs: [], ys: [o.iy] };
    if (layout === 'mask-right') return { xs: [bw], ys: [] };
    if (layout === 'mask-left') return { xs: [o.ix], ys: [] };
    if (layout === AROUND) return { xs: [o.ix, o.ix + bw], ys: [o.iy, o.iy + bh] };
    return { xs: [], ys: [] };
  };

  const getHoleSize = useCallback((h: any) => {
    const gs = imageState?.globalScale || 1;
    const mappedHoleSize = 25 + (holeSize / 100) * 125;
    const baseSize = Math.max(25, mappedHoleSize + (h.randomFactor || 0) * sizeJitter);
    /* 四周包圍的畫布比原圖大 (1 + 2×比例) 倍，但在螢幕上是縮到同樣大小顯示的，
       所以同一個「大小」值畫出來會看起來變小。這裡把那個倍率補回去，
       切過去的瞬間圖案在眼睛裡的大小不會變。 */
    const layoutK = layout === AROUND ? 1 + maskScale * 2 : 1;
    return baseSize * gs * layoutK * (h.localScale || 1);
  }, [holeSize, sizeJitter, imageState?.globalScale, layout, maskScale]);

  const isHoleFullyInsideMask = useCallback((h: any, s: number, maskW: number, maskH: number) => {
    const sz = getHoleSize(h) * s;
    const hx = h.x * s;
    const hy = h.y * s;

    if (isTextHole(holeType)) {
      const tctx = dummyCanvasRef.current.getContext('2d')!;
      tctx.font = `500 ${sz}px system-ui`;
      const renderStr = holeGlyph(holeType, customText, h);
      const tw = tctx.measureText(renderStr).width;
      const th = sz;
      return (
        hx - tw / 2 >= 0 &&
        hx + tw / 2 <= maskW &&
        hy - th / 2 >= 0 &&
        hy + th / 2 <= maskH
      );
    } else {
      const r = sz / 2;
      return (
        hx - r >= 0 &&
        hx + r <= maskW &&
        hy - r >= 0 &&
        hy + r <= maskH
      );
    }
  }, [getHoleSize, holeType, customText]);

  const checkHitHole = useCallback((hx: number, hy: number, h: any, gs: number, offs: any, clickedSide?: 'image' | 'mask') => {
    const s = getHoleSize(h);
    const { mw, mh } = maskDims(layout, imageState.baseW, imageState.baseH, maskScale);

    const side = h.side || 'both';
    if (clickedSide) {
      if (side !== 'both' && side !== clickedSide) {
        return false;
      }
    }

    if (isTextHole(holeType)) {
      const tctx = dummyCanvasRef.current.getContext('2d')!;
      tctx.font = `500 ${s}px system-ui`;
      const renderStr = holeGlyph(holeType, customText, h);
      const tw = tctx.measureText(renderStr).width;
      const th = s;

      const checkInRectImg = (ox: number, oy: number) => (hx >= ox + h.x - tw/2 && hx <= ox + h.x + tw/2 && hy >= oy + h.y - th/2 && hy <= oy + h.y + th/2);
      const checkInRectMask = (ox: number, oy: number) => (hx >= ox + h.x - tw/2 && hx <= ox + h.x + tw/2 && hy >= oy + h.y - th/2 && hy <= oy + h.y + th/2);

      if (clickedSide === 'image') {
        return checkInRectImg(offs.ix, offs.iy);
      } else if (clickedSide === 'mask') {
        return (layout === AROUND || isHoleFullyInsideMask(h, 1, mw, mh)) && checkInRectMask(offs.mx, offs.my);
      }

      const hitImg = (side === 'both' || side === 'image') && checkInRectImg(offs.ix, offs.iy);
      const hitMask = (side === 'both' || side === 'mask') && isHoleFullyInsideMask(h, 1, mw, mh) && checkInRectMask(offs.mx, offs.my);
      return hitImg || hitMask;
    } else {
      const checkInCircleImg = (ox: number, oy: number) => Math.hypot(hx - (h.x + ox), hy - (h.y + oy)) <= s / 2;
      const checkInCircleMask = (ox: number, oy: number) => Math.hypot(hx - (h.x + ox), hy - (h.y + oy)) <= s / 2;

      if (clickedSide === 'image') {
        return checkInCircleImg(offs.ix, offs.iy);
      } else if (clickedSide === 'mask') {
        return (layout === AROUND || isHoleFullyInsideMask(h, 1, mw, mh)) && checkInCircleMask(offs.mx, offs.my);
      }

      const hitImg = (side === 'both' || side === 'image') && checkInCircleImg(offs.ix, offs.iy);
      const hitMask = (side === 'both' || side === 'mask') && isHoleFullyInsideMask(h, 1, mw, mh) && checkInCircleMask(offs.mx, offs.my);
      return hitImg || hitMask;
    }
  }, [getHoleSize, holeType, customText, layout, maskScale, imageState, isHoleFullyInsideMask]);

  const checkHitHoleSegment = useCallback((pA: { x: number, y: number }, pB: { x: number, y: number }, h: any, gs: number, offs: any, clickedSide?: 'image' | 'mask') => {
    const s = getHoleSize(h);
    const getDistToSegment = (px: number, py: number) => {
      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(px - pA.x, py - pA.y);
      let t = ((px - pA.x) * dx + (py - pA.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (pA.x + t * dx), py - (pA.y + t * dy));
    };

    const side = h.side || 'both';
    if (clickedSide) {
      if (side !== 'both' && side !== clickedSide) {
        return false;
      }
    }

    if (isTextHole(holeType)) {
      for (let step = 0; step <= 5; step++) {
        const t = step / 5;
        const hx = pA.x + (pB.x - pA.x) * t;
        const hy = pA.y + (pB.y - pA.y) * t;
        if (checkHitHole(hx, hy, h, gs, offs, clickedSide)) return true;
      }
      return false;
    } else {
      const { mw, mh } = maskDims(layout, imageState.baseW, imageState.baseH, maskScale);

      if (clickedSide === 'image') {
        const dist1 = getDistToSegment(h.x + offs.ix, h.y + offs.iy);
        return dist1 <= s / 2;
      } else if (clickedSide === 'mask') {
        if (!isHoleFullyInsideMask(h, 1, mw, mh)) return false;
        const dist2 = getDistToSegment(h.x + offs.mx, h.y + offs.my);
        return dist2 <= s / 2;
      }

      const dist1 = getDistToSegment(h.x + offs.ix, h.y + offs.iy);
      const hitImg = (side === 'both' || side === 'image') && dist1 <= s / 2;

      let hitMask = false;
      if (isHoleFullyInsideMask(h, 1, mw, mh)) {
        const dist2 = getDistToSegment(h.x + offs.mx, h.y + offs.my);
        hitMask = (side === 'both' || side === 'mask') && dist2 <= s / 2;
      }

      return hitImg || hitMask;
    }
  }, [getHoleSize, holeType, checkHitHole, layout, maskScale, imageState, isHoleFullyInsideMask]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!imageState || !canvasRef.current) return;
    const target = e.target as HTMLElement;
    if (!target || target.closest('.no-pointer-events')) return;
    
    // Check if we already have this pointer to prevent potential browser issues
    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.delete(e.pointerId);
    }
    
    activePointers.current.set(e.pointerId, e); 
    try {
      target.setPointerCapture(e.pointerId);
    } catch (err) {
      // Just ignore if capture fails, some environments are strict
    }
    setForceRender(p => p + 1);
    
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    
    /* 除掉預覽倍率：畫布可能被畫得比工作解析度更細，但挖洞的座標一律是
       工作解析度，換算時要還原回去，不然放大之後點擊位置會整個偏掉。 */
    const ps = previewScaleRef.current;
    const sx = canvasRef.current.width / rect.width / ps, sy = canvasRef.current.height / rect.height / ps;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    const gs = imageState.globalScale || 1, offs = getLayoutOffsets();

    if (activePointers.current.size === 1) {
      /* 浮動物件優先：它是疊在最上層的圖層，點到它就不該再往下傳給挖洞或筆刷。
         由上往下找（陣列後面的疊在上面）。 */
      if (brushMode === 'off') {
        const list = objectsRef.current;
        for (let i = list.length - 1; i >= 0; i--) {
          const o = list[i];
          const cxo = o.x + o.w / 2, cyo = o.y + o.h / 2;
          const rad = -(o.rot || 0) * Math.PI / 180;
          const dx0 = x - cxo, dy0 = y - cyo;
          const lx = dx0 * Math.cos(rad) - dy0 * Math.sin(rad);
          const ly = dx0 * Math.sin(rad) + dy0 * Math.cos(rad);
          if (Math.abs(lx) <= o.w / 2 && Math.abs(ly) <= o.h / 2) {
            e.stopPropagation();
            setSelectedTarget(null);
            if (selectedObjRef.current === o.id) {
              // 已經選中的再點一次 → 進編輯頁（跟經典拼圖同樣的手感）；這一下也可以拖
              setActiveTab('objedit');
              objDragRef.current = { id: o.id, startX: x, startY: y, ox: o.x, oy: o.y };
            } else {
              /* 還沒選中的物件：這一下只能「點選」，不能順手拖走。
                 放開時沒移動才算選中，移動了就什麼都不做。 */
              objDragRef.current = { id: o.id, startX: x, startY: y, ox: o.x, oy: o.y, selectOnly: true, moved: false };
            }
            return;
          }
        }
        /* 已經選中東西時，就算沒點在它身上，拖曳畫布任何地方也是在移動它
           —— 選中之後整個畫布就是那個物件的操作區，跟經典拼圖一樣。 */
        const cur = objectsRef.current.find(z => z.id === selectedObjRef.current);
        if (cur) {
          e.stopPropagation();
          // fromBlank：這一下沒點在物件身上。放開時若完全沒移動，就當成「點旁邊」取消選取。
          objDragRef.current = { id: cur.id, startX: x, startY: y, ox: cur.x, oy: cur.y, fromBlank: true, moved: false };
          return;
        }
      }
      strokeStartHolesRef.current = holesRef.current;
      // Determine clickedSide
      let clickedSide: 'image' | 'mask' | undefined = undefined;
      if (offs) {
        const { baseW: bw, baseH: bh } = imageState;
        const md = maskDims(layout, bw, bh, maskScale);
        /* 四周包圍是特殊的：遮罩就是整張畫布，圖案可以自由跨進跨出圖片，
           沒有「左邊那塊 / 右邊那塊」的對稱關係。所以整張畫布一律當成
           同一個場（side 'mask'），命中判定與拖曳都用遮罩座標系 ——
           不然點圖片上的圖案會抓不到，抓到遮罩上的又會瞬間跳到圖片座標去。 */
        const around = layout === AROUND;
        const inOriginal = !around && x >= offs.ix && x <= offs.ix + bw && y >= offs.iy && y <= offs.iy + bh;
        const inMask = (around || !inOriginal)
          && x >= offs.mx && x <= offs.mx + md.mw && y >= offs.my && y <= offs.my + md.mh;
        if (inOriginal) clickedSide = 'image';
        else if (inMask) clickedSide = 'mask';
      }

      if (brushMode === 'pen') {
        e.stopPropagation();
        if (offs && clickedSide) {
          const { baseW: bw, baseH: bh } = imageState;
          let localX = -1;
          let localY = -1;
          if (clickedSide === 'image') {
            localX = x - offs.ix;
            localY = y - offs.iy;
          } else if (clickedSide === 'mask') {
            localX = x - offs.mx;
            localY = y - offs.my;
          }

          if (localX >= 0 && localY >= 0) {
            const mappedHoleSize = 25 + (holeSize / 100) * 125;
            const minDistance = mappedHoleSize * 0.75;
            const tooClose = holesRef.current.some(h => {
              const side = h.side || 'both';
              if (side !== 'both' && side !== clickedSide) return false;
              return Math.hypot(localX - h.x, localY - h.y) < minDistance;
            });
            if (!tooClose) {
              const newHole = {
                id: Math.random().toString(36).substr(2, 9),
                x: localX,
                y: localY,
                randomFactor: Math.random() * 2 - 1,
                randomNumber: Math.floor(Math.random() * 10),
                side: layout === AROUND ? clickedSide : (symmetryEnabled ? 'both' : clickedSide)
              };
              const nextHoles = [...holesRef.current, newHole];
              holesRef.current = nextHoles;
              setHoles(nextHoles);
              lastDrawPosRef.current = { x: localX, y: localY };
            }
            interactionRef.current = { type: 'brush_draw', startX: x, startY: y, clickedSide };
          }
        }
        return;
      } else if (brushMode === 'eraser') {
        e.stopPropagation();
        if (offs && clickedSide) {
          const hitHoles = holesRef.current.filter(h => checkHitHole(x, y, h, gs, offs, clickedSide));
          if (hitHoles.length > 0) {
            const hitIds = new Set(hitHoles.map(h => h.id));
            setHoles(prev => prev.filter(h => !hitIds.has(h.id)));
          }
          interactionRef.current = { type: 'brush_erase', lastX: x, lastY: y, startX: x, startY: y, clickedSide };
        }
        return;
      }

      let hitHole = null;
      for (let i = holesRef.current.length - 1; i >= 0; i--) {
        const h = holesRef.current[i];
        if (checkHitHole(x, y, h, gs, offs, clickedSide)) { hitHole = h; break; }
      }

      if (hitHole) {
        e.stopPropagation();
        setSelectedTarget(hitHole.id);
        interactionRef.current = { type: 'move_hole', id: hitHole.id, startX: x, startY: y, initX: hitHole.x, initY: hitHole.y, isClick: true, hitItself: true, clickedSide };
      } else if (selectedTarget) {
        const currentHole = holesRef.current.find(h => h.id === selectedTarget);
        if (currentHole) {
          e.stopPropagation();
          interactionRef.current = { type: 'move_hole', id: selectedTarget, startX: x, startY: y, initX: currentHole.x, initY: currentHole.y, isClick: true, hitItself: false, clickedSide };
        } else {
          setSelectedTarget(null);
        }
      }
    } else if (activePointers.current.size === 2 && selectedObjRef.current) {
      /* 選中物件時兩指是在縮放／旋轉那個物件 —— 不再縮放整個預覽。
         沒選中任何東西時才會落到下面那條「雙指縮放預覽」。 */
      e.stopPropagation();
      objDragRef.current = null;
      const pts2: any[] = Array.from(activePointers.current.values());
      const oo = objectsRef.current.find(z => z.id === selectedObjRef.current);
      if (oo) {
        objPinchRef.current = {
          id: oo.id,
          d0: Math.max(1, Math.hypot(pts2[0].clientX - pts2[1].clientX, pts2[0].clientY - pts2[1].clientY)),
          a0: Math.atan2(pts2[1].clientY - pts2[0].clientY, pts2[1].clientX - pts2[0].clientX) * 180 / Math.PI,
          w0: oo.w, h0: oo.h, size0: oo.size || 0, rot0: oo.rot || 0,
          rotOn: false, rotBias: 0,   // 旋轉的不動區：超過門檻才開始轉
          cx0: oo.x + oo.w / 2, cy0: oo.y + oo.h / 2,
        };
      }
    } else if (activePointers.current.size === 2 && selectedTarget) {
      e.stopPropagation();
      const pts: any[] = Array.from(activePointers.current.values());
      const p1 = { x: (pts[0].clientX - rect.left) * sx, y: (pts[0].clientY - rect.top) * sy };
      const p2 = { x: (pts[1].clientX - rect.left) * sx, y: (pts[1].clientY - rect.top) * sy };
      const hole = holesRef.current.find(h => h.id === selectedTarget);
      if (hole) interactionRef.current = { type: 'pinch_hole', id: selectedTarget, startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y) };
    } else if (activePointers.current.size === 2) {
      // 沒選中東西 → 雙指縮放整個預覽
      e.stopPropagation();
      const intr = interactionRef.current;
      // 第一根手指剛剛畫下去的那一下要收回來，不然縮放會順手戳一個洞
      if ((intr?.type === 'brush_draw' || intr?.type === 'brush_erase') && strokeStartHolesRef.current) {
        holesRef.current = strokeStartHolesRef.current;
        setHoles(strokeStartHolesRef.current);
      }
      interactionRef.current = null;
      lastDrawPosRef.current = null;
      const pts: any[] = Array.from(activePointers.current.values());
      const c = stageBox();
      const v = viewTRef.current;
      const mx = (pts[0].clientX + pts[1].clientX) / 2 - c.x;
      const my = (pts[0].clientY + pts[1].clientY) / 2 - c.y;
      viewPinchRef.current = {
        d0: Math.max(1, Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY)),
        k0: v.k,
        cx: (mx - v.tx) / v.k,
        cy: (my - v.ty) / v.k,
      };
    }
  };

  /* ---- 預覽縮放 ------------------------------------------------------------
     自己實作雙指縮放平移。react-zoom-pan-pinch 靠 touch 事件、畫布上的筆刷與
     拖曳靠 pointer 事件，兩者會互搶（美顏那邊也踩過同一個坑）。
     規則：選中挖洞時雙指仍然是縮放那個洞（原本的行為）；沒選中東西時雙指才是
     縮放整個預覽。單指一律維持原本的筆刷／拖曳。                              */
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewT, setViewT] = useState({ k: 1, tx: 0, ty: 0 });
  const viewTRef = useRef(viewT);
  viewTRef.current = viewT;
  const viewPinchRef = useRef<{ d0: number; k0: number; cx: number; cy: number } | null>(null);
  /* 預覽畫布要畫多細。
     工作解析度只有 1080（為了拖曳順），螢幕上又是 CSS transform 放大 ——
     放到 6 倍等於把 1080 拉成 6480，當然糊。
     所以縮放停下來之後，照「螢幕上實際佔幾個裝置像素」重畫一次；
     算得出多少就放到多少，放不到就不讓你再放大（見 maxZoom），
     這樣任何倍率下都是 1 個畫布像素對 1 個裝置像素，不會有糊掉的區間。 */
  const [previewScale, setPreviewScale] = useState(1);
  const previewScaleRef = useRef(1);
  previewScaleRef.current = previewScale;
  const previewTimer = useRef<number | null>(null);
  /** 畫布在 1 倍時的 CSS 尺寸（放大時直接用它 × 倍率當版面尺寸） */
  const baseCssWRef = useRef(0);
  const [baseCss, setBaseCss] = useState<{ w: number; h: number } | null>(null);
  /** 第一根手指落下時的挖洞狀態 —— 第二根手指跟上時要把它畫的那一下收回去 */
  const strokeStartHolesRef = useRef<any[] | null>(null);
  const stageBox = () => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0, w: 1, h: 1 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };
  const applyView = useCallback((k: number, tx: number, ty: number) => {
    const c = stageBox();
    const kk = Math.max(1, Math.min(maxZoomRef.current, k));
    // 限制平移範圍，免得把圖拖出畫面找不回來
    const mx = Math.max(0, (kk - 1) * c.w * 0.5);
    const my = Math.max(0, (kk - 1) * c.h * 0.5);
    setViewT({ k: kk, tx: Math.max(-mx, Math.min(mx, tx)), ty: Math.max(-my, Math.min(my, ty)) });
  }, []);
  /* 「還能放大到幾倍而不糊」的上限 —— 由記憶體預算反推。
     算不到那麼細就不讓你再放大，所以任何倍率下都是清楚的，
     而且畫布總量永遠壓在預算內（分頁不會被系統回收）。
     這一行由 renderCanvas 算完之後寫進來（那時才知道畫布佔多少 CSS 寬）。 */
  const maxZoomRef = useRef(6);
  /** 這張拼圖在預算內能畫到的最大畫布倍率 */
  const maxPreviewScale = useCallback(() => {
    if (!imageState) return 1;
    // 沒有紋理時暫存畫布只有兩張（底色、挖完洞的）
    const one = previewPixelsAt(layout, imageState.baseW, imageState.baseH, maskScale, 1,
      patternType === 'dot' ? 3 : 2);
    return Math.max(1, Math.sqrt(MAX_PREVIEW_PIXELS / Math.max(1, one)));
  }, [imageState, layout, maskScale, patternType]);
  /* 縮放停下來 160ms 後照倍率重畫。拖曳中刻意不重畫 —— 每一格都重烤一張
     幾百萬像素的圖會直接卡死，而且拖曳中本來就看不出銳利度差別。 */
  useEffect(() => {
    if (!imageState || !canvasRef.current) return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      const cs = collageSizeOf(layout, imageState.baseW, imageState.baseH, maskScale);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const cssW = baseCss ? baseCss.w : baseCssWRef.current;
      if (!cssW || !cs.w) return;
      const budget = maxPreviewScale();
      // 要多少畫布像素才會「一個畫布像素對一個裝置像素」
      /* ×1.15 的餘裕：剛好 1:1 時圖案邊緣的抗鋸齒沒有取樣空間，
         多一點點就會明顯銳利，而且成本只有 32%。 */
      const want = Math.min(budget, Math.max(1, (cssW * viewT.k * dpr * 1.15) / cs.w));
      const snapped = Math.max(1, Math.round(want * 4) / 4);   // 取到 0.25，避免一直重畫
      setPreviewScale(prev => (Math.abs(prev - snapped) < 0.01 ? prev : snapped));
    }, 90);
    return () => { if (previewTimer.current) window.clearTimeout(previewTimer.current); };
    /* baseCss 一定要進依賴：第一次算出基準尺寸之前這個 effect 會直接 return，
       而 viewT.k 不會再變 —— 少了它就會永遠停在 previewScale = 1，
       也就是「只有放大過才變清楚」的原因。 */
  }, [viewT.k, imageState, layout, maskScale, maxPreviewScale, baseCss]);

  useEffect(() => {
    if (activeTab !== 'objedit' || adjustSub !== 'filter') return;
    let alive = true;
    (async () => {
      for (const l of lutList) {
        if (!alive) return;
        if (!l.url || getLoadedLut(l.id)) continue;
        await loadLut(l.id, l.url);
        if (!alive) return;
        setLutRevision(n => n + 1);
        setFxTick(t => t + 1);
      }
    })();
    return () => { alive = false; };
  }, [activeTab, adjustSub, lutList]);

  /* 拼圖的形狀一變（換排版、換比例），1 倍時的版面尺寸就不一樣了 ——
     要先放掉寫死的尺寸讓 max-w/max-h 重新貼合，否則會卡在舊尺寸。 */
  useEffect(() => {
    setBaseCss(null);
    // 縮放也一起歸零：新的形狀要先用 max-w/max-h 量一次基準尺寸才量得準
    setViewT({ k: 1, tx: 0, ty: 0 });
    setPreviewScale(1);
  }, [layout, maskScale]);

  // 換一張圖就把縮放歸零
  const viewResetKeyRef = useRef('');
  useEffect(() => {
    const key = imageState ? `${imageState.baseW}x${imageState.baseH}` : '';
    if (key !== viewResetKeyRef.current) {
      viewResetKeyRef.current = key;
      setViewT({ k: 1, tx: 0, ty: 0 });
      setPreviewScale(1);
      setBaseCss(null);
    }
  }, [imageState]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId) || !canvasRef.current || !imageState) return;
    activePointers.current.set(e.pointerId, e);
    const rect = canvasRef.current.getBoundingClientRect();
    const ps = previewScaleRef.current;
    const sx = canvasRef.current.width / rect.width / ps, sy = canvasRef.current.height / rect.height / ps;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    const gs = imageState?.globalScale || 1;
    // 雙指縮放預覽時完全不碰筆刷與拖曳
    // 兩指縮放／旋轉浮動物件
    if (objPinchRef.current && activePointers.current.size >= 2) {
      e.stopPropagation();
      const pts2: any[] = Array.from(activePointers.current.values());
      const pin = objPinchRef.current;
      const dist = Math.max(1, Math.hypot(pts2[0].clientX - pts2[1].clientX, pts2[0].clientY - pts2[1].clientY));
      const ang = Math.atan2(pts2[1].clientY - pts2[0].clientY, pts2[1].clientX - pts2[0].clientX) * 180 / Math.PI;
      const k = Math.max(0.15, Math.min(8, dist / pin.d0));
      const nw = pin.w0 * k, nh = pin.h0 * k;
      /* 旋轉有一段「不動區」：兩指轉不到 ROT_START 度就當成純縮放。
         超過之後把門檻扣掉再開始轉，所以不會在跨過門檻那一瞬間跳一下。
         另外靠近 0/90/180/270 就吸過去 —— 想轉正只要大概轉回去就會自己歸位。 */
      const ROT_START = 8;   // 度：低於這個角度完全不轉
      const ROT_SNAP = 6;    // 度：離直角這麼近就吸正
      const wrap180 = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
      let dRot = wrap180(ang - pin.a0);
      if (!pin.rotOn) {
        if (Math.abs(dRot) < ROT_START) dRot = 0;
        else { pin.rotOn = true; pin.rotBias = dRot > 0 ? ROT_START : -ROT_START; }
      }
      if (pin.rotOn) dRot -= pin.rotBias;
      let nrot = ((pin.rot0 + dRot) % 360 + 360) % 360;
      const upright = (Math.round(nrot / 90) * 90) % 360;
      if (Math.abs(wrap180(nrot - upright)) < ROT_SNAP) nrot = upright;
      // 縮放中也吃對齊線：邊緣或中心一靠上去就吸附，跟拖曳時同一套
      const sres = snapToGuides(pin.cx0 - nw / 2, pin.cy0 - nh / 2, nw, nh);
      guidesRef.current = sres.guides;
      setGuides(sres.guides);
      setObjects(prev => prev.map(o => o.id === pin.id
        ? { ...o, w: nw, h: nh, size: pin.size0 ? pin.size0 * k : o.size,
            x: sres.x, y: sres.y, rot: nrot }
        : o));
      return;
    }
    // 拖曳浮動物件
    if (objDragRef.current && activePointers.current.size === 1) {
      e.stopPropagation();
      const d = objDragRef.current;
      if (Math.hypot(x - d.startX, y - d.startY) > 3) d.moved = true;
      if (d.selectOnly) return;   // 還沒選中：這一下不搬東西
      let nx = d.ox + (x - d.startX), ny = d.oy + (y - d.startY);
      /* 對齊線：拖到接近畫布中線或邊界時吸附，並把那條線畫出來。
         門檻用畫布短邊的 1.2%，不管圖多大手感都一樣。 */
      const oNow = objectsRef.current.find(z => z.id === d.id);
      const r2 = snapToGuides(nx, ny, oNow?.w || 0, oNow?.h || 0);
      nx = r2.x; ny = r2.y;
      guidesRef.current = r2.guides;
      setGuides(r2.guides);
      setObjects(prev => prev.map(o => o.id === d.id ? { ...o, x: nx, y: ny } : o));
      return;
    }
    if (viewPinchRef.current && activePointers.current.size >= 2) {
      e.stopPropagation();
      const pts: any[] = Array.from(activePointers.current.values());
      const pin = viewPinchRef.current;
      const c = stageBox();
      const dist = Math.max(1, Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY));
      const k = Math.max(1, Math.min(maxZoomRef.current, pin.k0 * (dist / pin.d0)));
      const mx = (pts[0].clientX + pts[1].clientX) / 2 - c.x;
      const my = (pts[0].clientY + pts[1].clientY) / 2 - c.y;
      applyView(k, mx - pin.cx * k, my - pin.cy * k);
      return;
    }
    const intr = interactionRef.current;
    if (!intr) return;

    e.stopPropagation();

    if (Math.hypot(x - intr.startX, y - intr.startY) > 3) intr.isClick = false;

    if (intr.type === 'brush_draw') {
      const offs = getLayoutOffsets();
      if (offs && lastDrawPosRef.current && intr.clickedSide) {
        const { baseW: bw, baseH: bh } = imageState;
        let localX = -1;
        let localY = -1;
        if (intr.clickedSide === 'image') {
          localX = x - offs.ix;
          localY = y - offs.iy;
        } else if (intr.clickedSide === 'mask') {
          localX = x - offs.mx;
          localY = y - offs.my;
        }

        if (localX >= 0 && localY >= 0) {
          const mappedHoleSize = 25 + (holeSize / 100) * 125;
          const minDistance = mappedHoleSize * 0.75;
          const tooClose = holesRef.current.some(h => {
            const side = h.side || 'both';
            if (side !== 'both' && side !== intr.clickedSide) return false;
            return Math.hypot(localX - h.x, localY - h.y) < minDistance;
          });
          if (!tooClose) {
            const newHole = {
              id: Math.random().toString(36).substr(2, 9),
              x: localX,
              y: localY,
              randomFactor: Math.random() * 2 - 1,
              side: layout === AROUND ? intr.clickedSide : (symmetryEnabled ? 'both' : intr.clickedSide)
            };
            const nextHoles = [...holesRef.current, newHole];
            holesRef.current = nextHoles;
            setHoles(nextHoles);
            lastDrawPosRef.current = { x: localX, y: localY };
          }
        }
      }
    } else if (intr.type === 'brush_erase') {
      const offs = getLayoutOffsets();
      if (offs && intr.clickedSide) {
        const pA = { x: intr.lastX ?? intr.startX, y: intr.lastY ?? intr.startY };
        const pB = { x, y };
        const hitHoles = holesRef.current.filter(h => checkHitHoleSegment(pA, pB, h, gs, offs, intr.clickedSide));
        if (hitHoles.length > 0) {
          const hitIds = new Set(hitHoles.map(h => h.id));
          setHoles(prev => prev.filter(h => !hitIds.has(h.id)));
        }
        intr.lastX = x;
        intr.lastY = y;
      }
    } else if (intr.type === 'move_hole') {
      const dx = x - intr.startX;
      const dy = y - intr.startY;
      // 四周包圍時圖案活動範圍是整張畫布，用原圖尺寸夾會把它擠回左上角
      const fld = maskDims(layout, imageState.baseW, imageState.baseH, maskScale);
      const limX = layout === AROUND ? fld.mw : imageState.baseW;
      const limY = layout === AROUND ? fld.mh : imageState.baseH;
      const nx = Math.max(0, Math.min(limX, intr.initX + dx));
      const ny = Math.max(0, Math.min(limY, intr.initY + dy));
      setHoles(prev => prev.map(h => h.id === intr.id ? { ...h, x: nx, y: ny } : h));
    } else if (intr.type === 'pinch_hole') {
      const pts: any[] = Array.from(activePointers.current.values());
      if (pts.length < 2) return;
      const p1 = { x: (pts[0].clientX - rect.left) * sx, y: (pts[0].clientY - rect.top) * sy };
      const p2 = { x: (pts[1].clientX - rect.left) * sx, y: (pts[1].clientY - rect.top) * sy };
      const scale = Math.hypot(p1.x - p2.x, p1.y - p2.y) / intr.startDist;
      setHoles(prev => prev.map(h => h.id === intr.id ? { ...h, localScale: Math.max(0.2, Math.min(10, (h.localScale || 1) * scale)) } : h));
      // Update start distance to allow continuous pinch
      intr.startDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // 點在物件以外的地方、而且完全沒有拖動 → 取消選取
    if (objDragRef.current?.fromBlank && !objDragRef.current.moved) setSelectedObj(null);
    // 還沒選中的物件：只有「點下去沒移動」才算選中，拖了就當作沒發生
    if (objDragRef.current?.selectOnly && !objDragRef.current.moved) {
      setSelectedObj(objDragRef.current.id);
      setSelectedTarget(null);
    }
    objDragRef.current = null;
    if (guidesRef.current.length) { guidesRef.current = []; setGuides([]); }
    if (activePointers.current.size <= 2) objPinchRef.current = null;
    try {
      const target = e.target as HTMLElement;
      if (target && target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}
    
    const intr = interactionRef.current;
    if (intr) {
      e.stopPropagation();
      if (intr.isClick && !intr.hitItself) setSelectedTarget(null);
      if (intr.type === 'brush_draw' || intr.type === 'brush_erase' || intr.type === 'move_hole' || intr.type === 'pinch_hole') {
        if (!(intr.type === 'move_hole' && intr.isClick)) {
          pushHistory(holesRef.current);
        }
      }
    }
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) viewPinchRef.current = null;
    if (activePointers.current.size === 0) {
      interactionRef.current = null;
      lastDrawPosRef.current = null;
      strokeStartHolesRef.current = null;
    }
    setForceRender(p => p + 1);
  };

  const renderToCanvas = useCallback((targetCanvas: HTMLCanvasElement, renderScale: number = 1) => {
    if (!imageState) return;
    const { baseW, baseH, globalScale: gs } = imageState;
    const ctx = get2dWide(targetCanvas, { alpha: false });
    if (!ctx) return;

    const s = renderScale;
    const sw = baseW * s;
    const sh = baseH * s;
    const sgs = gs * s;

    const mdS = maskDims(layout, sw, sh, maskScale);
    const maskW = mdS.mw;
    const maskH = mdS.mh;

    const getLayoutOffsetsS = () => {
      if (layout === 'mask-bottom') return { cw: sw, ch: sh + maskH, ix: 0, iy: 0, mx: 0, my: sh };
      if (layout === 'mask-top') return { cw: sw, ch: sh + maskH, ix: 0, iy: maskH, mx: 0, my: 0 };
      if (layout === 'mask-right') return { cw: sw + maskW, ch: sh, ix: 0, iy: 0, mx: sw, my: 0 };
      if (layout === 'mask-left') return { cw: sw + maskW, ch: sh, ix: maskW, iy: 0, mx: 0, my: 0 };
      if (layout === AROUND) return { cw: maskW, ch: maskH, ix: mdS.padX, iy: mdS.padY, mx: 0, my: 0 };
      return { cw: sw, ch: sh, ix: 0, iy: 0, mx: 0, my: 0 };
    };

    const offs = getLayoutOffsetsS();
    if (targetCanvas.width !== offs.cw || targetCanvas.height !== offs.ch) {
      targetCanvas.width = offs.cw;
      targetCanvas.height = offs.ch;
    }

    ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, 0, offs.cw, offs.ch);
    ctx.fillStyle = '#1A1A1A'; ctx.fillRect(offs.ix, offs.iy, sw, sh); ctx.fillRect(offs.mx, offs.my, maskW, maskH);

    const isMain = targetCanvas === canvasRef.current;
    const bCanvas = isMain ? baseMaskCanvasRef.current : document.createElement('canvas');
    bCanvas.width = maskW; bCanvas.height = maskH;
    const bCtx = get2dWide(bCanvas)!;
    bCtx.fillStyle = maskColor;
    bCtx.fillRect(0, 0, maskW, maskH);
    if (maskImageState && maskImageState.img) {
      const mImg = maskImageState.img;
      const scale = Math.max(maskW / mImg.width, maskH / mImg.height);
      const drawW = mImg.width * scale;
      const drawH = mImg.height * scale;
      /* 置中截取（cover）。
         這裡一律置中截取（cover）。 */
      const drawX = (maskW - drawW) / 2;
      const drawY = (maskH - drawH) / 2;
      bCtx.drawImage(mImg, drawX, drawY, drawW, drawH);
    }

    /* 沒有點點紋理的時候，「含紋理的遮罩」就等於「底色遮罩」本身 ——
       不必再開一張同樣大的畫布。一張全尺寸畫布動輒幾十 MB，
       省下來的預算直接換成更高的預覽解析度（圖案的鋸齒就是這樣來的）。 */
    const needPattern = patternType === 'dot';
    const fCanvas = !needPattern ? bCanvas
      : (isMain ? fullMaskCanvasRef.current : document.createElement('canvas'));
    if (needPattern) {
      fCanvas.width = maskW; fCanvas.height = maskH;
    }
    const fCtx = get2dWide(fCanvas)!;
    if (needPattern) fCtx.drawImage(bCanvas, 0, 0);

    if (patternType === 'dot') {
      fCtx.fillStyle = dotColor; 
      // 根據 UI 值 (0~100) 映射到實際大小 (5~20) 與實際間距 (40~140)
      const actualDotSize = (5 + (dotSize / 100) * 15) * sgs;
      const actualDotGap = (40 + dotGap) * sgs;
      
      const r = actualDotSize / 2;
      // 邊緣的預留空間，上下左右完全一樣，且預留空間縮小以充分貼合邊界
      const pad = r + 2 * sgs; 
      
      const dx = actualDotGap;
      const dy = actualDotGap * Math.sqrt(3) / 2; // 半落重複 staggered 三角網格高度
      
      const rangeX = Math.ceil(maskW / dx) + 2;
      const rangeY = Math.ceil(maskH / dy) + 2;
      
      for (let j = -rangeY; j <= rangeY; j++) {
        const py = maskH / 2 + j * dy;
        
        const isOddRow = Math.abs(j) % 2 === 1;
        const shiftX = isOddRow ? dx / 2 : 0;
        
        for (let i = -rangeX; i <= rangeX; i++) {
          const px = maskW / 2 + i * dx + shiftX;
          // 邊界檢查 (上下距離與左右距離皆必須在 [pad, size-pad] 內)
          if (
            px - r >= pad && 
            px + r <= maskW - pad &&
            py - r >= pad &&
            py + r <= maskH - pad
          ) {
            fCtx.beginPath();
            fCtx.arc(px, py, r, 0, Math.PI * 2);
            fCtx.fill();
          }
        }
      }
    }

    const drawImg = (img: any, t: any, ox: number, oy: number, w: number, h: number) => {
      if (!img || !t) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, w, h);
      ctx.clip();
      ctx.drawImage(img, ox + t.x * s, oy + t.y * s, t.w * s, t.h * s);
      ctx.restore();
    };

    /* 四周包圍時「墊在遮罩底下那張圖」要以畫布中心等比放大到整張畫布 ——
       它跟中央那張是同一個構圖，只是被推到鏡頭外面，從洞裡看出去才對得起來。 */
    const drawBackdropAround = () => {
      const img = imageState.img, t = imageTransform;
      if (!img || !t) return;
      const k = maskW / sw;
      const cx = offs.cw / 2, cy = offs.ch / 2;
      const x0 = offs.ix + t.x * s, y0 = offs.iy + t.y * s;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, offs.cw, offs.ch); ctx.clip();
      ctx.drawImage(img, cx + (x0 - cx) * k, cy + (y0 - cy) * k, t.w * s * k, t.h * s * k);
      ctx.restore();
    };
    const drawCentreImage = () => drawImg(imageState.img, imageTransform, offs.ix, offs.iy, sw, sh);
    const drawBackdrop = () => (layout === AROUND
      ? drawBackdropAround()
      : drawImg(imageState.img, imageTransform, offs.mx, offs.my, maskW, maskH));

    const drawImageSideHoles = () => {
    ctx.save(); ctx.translate(offs.ix, offs.iy);
    const basePat = ctx.createPattern(bCanvas, 'repeat');
    if (basePat) {
      ctx.fillStyle = basePat;
      /* 圖片側的圖案要顯示「遮罩上同一個相對位置」的那一塊。
         遮罩跟圖片不一定一樣大（例如下方那條只有一半高），直接貼的話
         pattern 會 repeat，圖案就會拿到繞回去的、對不上的那一段。
         這裡把圖案的位置從圖片座標換算成遮罩座標，再把 pattern 平移過去。 */
      const rx = sw > 0 ? maskW / sw : 1;
      const ry = sh > 0 ? maskH / sh : 1;
      holes.forEach(h => {
        const side = h.side || 'both';
        if (side !== 'both' && side !== 'image') return; // Only show on image side

        const sz = getHoleSize(h) * s;
        const currentAngle = h.angle !== undefined ? h.angle : holeAngle;
        const hx = h.x * s, hy = h.y * s;
        const mxp = hx * rx, myp = hy * ry;     // 遮罩上的對應點
        ctx.save();
        // pattern 錨在目前的原點，所以先位移，讓遮罩上的 (mxp,myp) 正好落在圖案位置
        ctx.translate(hx - mxp, hy - myp);
        if (isTextHole(holeType)) {
          const tText = holeGlyph(holeType, customText, h);
          drawTextShape(ctx, holeType, tText, mxp, myp, sz, basePat, false, currentAngle);
        } else {
          // 以圖案自己的中心為軸旋轉，但不動到 pattern 的錨點
          ctx.translate(mxp, myp);
          ctx.rotate(currentAngle * Math.PI / 180);
          ctx.translate(-mxp, -myp);
          drawShapePath(ctx, holeType, mxp, myp, sz);
          ctx.fill();
        }
        ctx.restore();
      });
    }
    ctx.restore();
    };

    let lmc: HTMLCanvasElement = isMain ? lowerMaskCanvasRef.current : document.createElement('canvas');
    const drawMaskLayer = () => {
    lmc.width = maskW; lmc.height = maskH;
    const lmx = get2dWide(lmc)!;
    lmx.drawImage(fCanvas, 0, 0);
    lmx.globalCompositeOperation = 'destination-out';
    holes.forEach(h => {
      const side = h.side || 'both';
      if (side !== 'both' && side !== 'mask') return; // Only show on mask side

      if (layout !== AROUND && !isHoleFullyInsideMask(h, s, maskW, maskH)) {
        return;
      }
      const sz = getHoleSize(h) * s;
      const currentAngle = h.angle !== undefined ? h.angle : holeAngle;
      if (isTextHole(holeType)) {
        const tText = holeGlyph(holeType, customText, h);
        drawTextShape(lmx, holeType, tText, h.x * s, h.y * s, sz, null, true, currentAngle);
      } else {
        lmx.save();
        lmx.translate(h.x * s, h.y * s);
        lmx.rotate(currentAngle * Math.PI / 180);
        drawShapePath(lmx, holeType, 0, 0, sz);
        lmx.fill();
        lmx.restore();
      }
    });
    ctx.drawImage(lmc, offs.mx, offs.my);
    };

    /* 一般四邊那四種是「圖跟遮罩並排」，誰先誰後都蓋不到對方；
       四周包圍是「遮罩鋪滿整張、原圖疊在正中央」，順序必須反過來。 */
    /* 四周包圍時遮罩鋪滿整張、原圖疊在正中央，所以落在圖片上的那些洞
       會被原圖蓋掉、整個看不見。這裡在原圖之上、只在圖片框內，
       再用「遮罩本身」把那些洞畫一次 ——
       於是同一個圖案跨在交界上時：框那一段是挖穿的（看到放大的底圖），
       圖片那一段是遮罩顏色的實心圖案，兩種樣式同時成立。 */
    const drawHolesOverImage = () => {
      const pat = ctx.createPattern(bCanvas, 'repeat');
      if (!pat) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(offs.ix, offs.iy, sw, sh); ctx.clip();
      ctx.translate(offs.mx, offs.my);      // 洞的座標是遮罩座標系
      ctx.fillStyle = pat;
      holes.forEach(h => {
        const sd = h.side || 'both';
        if (sd !== 'both' && sd !== 'mask') return;
        const sz = getHoleSize(h) * s;
        const currentAngle = h.angle !== undefined ? h.angle : holeAngle;
        const hx = h.x * s, hy = h.y * s;
        // 四周包圍的洞本來就是遮罩座標，對應點就是自己
        ctx.save();
        if (isTextHole(holeType)) {
          drawTextShape(ctx, holeType, holeGlyph(holeType, customText, h), hx, hy, sz, pat, false, currentAngle);
        } else {
          ctx.translate(hx, hy);
          ctx.rotate(currentAngle * Math.PI / 180);
          ctx.translate(-hx, -hy);
          drawShapePath(ctx, holeType, hx, hy, sz);
          ctx.fill();
        }
        ctx.restore();
      });
      ctx.restore();
    };

    /* 浮動物件（圖片／文字）。順序就是陣列順序（後面的蓋前面的）；
       標了 below 的那些會被畫在「所有圖案之下」，見下面兩次呼叫。 */
    const drawObjects = (list: any[]) => list.forEach(o => {
      ctx.save();
      ctx.translate((o.x + o.w / 2) * s, (o.y + o.h / 2) * s);
      ctx.rotate((o.rot || 0) * Math.PI / 180);
      ctx.globalAlpha = o.alpha ?? 1;
      if (o.type === 'image' && o.img) {
        const src2: any = fxCanvasOf(o) || o.img;
        /* 有形狀效果時畫布比原圖大一圈（留給發光與描邊），
           畫的時候要等比放大回去，圖片本體才會剛好落在原本的框上。 */
        const padX = (src2 as any).__padX || 0, padY = (src2 as any).__padY || 0;
        const ew = o.w * s * (1 + padX * 2), eh = o.h * s * (1 + padY * 2);
        ctx.drawImage(src2, -ew / 2, -eh / 2, ew, eh);
      } else if (o.type === 'text') {
        /* 文字的每一項屬性都跟經典拼圖對齊：字體、粗體／斜體、字距、描邊、發光。
           面板本身就是那邊那顆元件，所以這裡只要照著畫。 */
        const fam = o.fontFamily || DEFAULT_FONT;
        const weight = o.bold ? 800 : 400;
        const style = o.italic ? 'italic ' : '';
        ctx.font = `${style}${weight} ${o.size * s}px ${fontStack(fam)}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        (ctx as any).letterSpacing = `${(o.letterSpacing || 0) * s}px`;
        /* 順序跟經典拼圖一致：先只用「填色的形狀」畫光（三段模糊疊起來），
           再畫描邊，最後才填色。
           光如果跟描邊一起算，會沿著描邊外緣散開 —— 看起來就是描邊突然粗一圈，
           那正是主人覺得怪的地方。強度也對齊那邊的 (glow/20)×14×k。 */
        /* 描邊與發光都要跟著字級等比。
           經典拼圖那邊的滑桿是配著「字級 40px」在調的（描邊 0～2px、發光 0～20），
           我們的文字通常被放大好幾倍，用原值畫就會細得像沒有 —— 這就是主人說
           「太細了」的原因。以 40px 為基準等比放大，兩邊看起來才一樣。 */
        const tk = (o.size / 40) * s;
        if (o.glow) {
          ctx.save();
          ctx.fillStyle = o.color || '#ffffff';
          ctx.shadowColor = o.glowColor || '#ffffff';
          for (const k2 of [1, 2, 3]) {
            ctx.shadowBlur = (o.glow / 20) * 14 * k2 * tk;
            ctx.fillText(o.text || '', 0, 0);
          }
          ctx.restore();
        }
        if (o.strokeWidth) {
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeStyle = o.strokeColor || '#FFFFFF';
          ctx.lineWidth = o.strokeWidth * 2 * tk;
          ctx.strokeText(o.text || '', 0, 0);
        }
        ctx.fillStyle = o.color || '#ffffff';
        ctx.fillText(o.text || '', 0, 0);
        ctx.shadowBlur = 0;
        (ctx as any).letterSpacing = '0px';
      }
      ctx.globalAlpha = 1;
      if (isMain && selectedObj === o.id && !guides.length && !tuningEdge) {
        // 選中框維持虛線（跟挖洞那邊同一種語言）
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * sgs * s;
        ctx.setLineDash([8 * sgs * s, 8 * sgs * s]);
        ctx.strokeRect(-o.w * s / 2, -o.h * s / 2, o.w * s, o.h * s);
        ctx.setLineDash([]);
      }
      ctx.restore();
    });

    /* 標了 below 的物件插在「底圖鋪好之後、所有圖案之前」——
       所以圖片側的圖案會蓋在它上面，遮罩側則是被遮罩蓋住、只從洞裡透出來。
       兩種排版的插入點不同，但相對於圖案的層級是一致的。 */
    const belowObjs = objects.filter(o => o.below);
    const aboveObjs = objects.filter(o => !o.below);
    if (layout === AROUND) {
      drawBackdrop();
      drawMaskLayer();
      drawCentreImage();
      drawObjects(belowObjs);
      drawHolesOverImage();
      drawImageSideHoles();
    } else {
      drawCentreImage();
      drawBackdrop();
      drawObjects(belowObjs);
      drawImageSideHoles();
      drawMaskLayer();
    }

    // ctx.beginPath();
    // if (layout.includes('bottom') || layout.includes('top')) { ctx.moveTo(0, sh); ctx.lineTo(sw, sh); }
    // else { ctx.moveTo(sw, 0); ctx.lineTo(sw, sh); }
    // ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = sgs; ctx.stroke();

    drawObjects(aboveObjs);

    if (isMain && guides.length) {
      ctx.save();
      /* 經典拼圖那邊是 2 CSS px 的 bg-blue-500。這裡畫在畫布上，
         所以要把 2 CSS px 換算成畫布單位（畫布可能比螢幕細很多倍）。 */
      const cssW0 = baseCssWRef.current || 1;
      const shown = cssW0 * Math.max(1, viewTRef.current.k);
      ctx.strokeStyle = '#3B82F6';
      const glw = Math.max(1, 2 * (offs.cw * s) / shown);
      ctx.lineWidth = glw;
      /* 畫布最外圈那兩條線本來剛好壓在邊界上，一半會被畫布外的黑底吃掉，
         看起來就比中間那幾條細一半。往內縮半個線寬，整條都留在畫布裡。 */
      const clamp = (v: number, max: number) => Math.min(Math.max(v, glw / 2), max - glw / 2);
      guides.forEach(g => {
        ctx.beginPath();
        if (g.x !== undefined) {
          const gx = clamp(g.x * s, offs.cw);
          ctx.moveTo(gx, 0); ctx.lineTo(gx, offs.ch);
        } else {
          const gy = clamp(g.y * s, offs.ch);
          ctx.moveTo(0, gy); ctx.lineTo(offs.cw, gy);
        }
        ctx.stroke();
      });
      ctx.restore();
    }

    /* 選取框只畫在螢幕上那張。畫布可能被畫得更細，所以尺寸與座標都要乘上 s，
       不然放大重畫之後虛線框會停在原本的小尺寸、對不上那個洞。 */
    if (isMain && selectedTarget && interactionRef.current) {
      const selectedHole = holes.find(hx => hx.id === selectedTarget);
      if (selectedHole) {
        const h = selectedHole;
        const sz = getHoleSize(h) * s;
        const currentAngle = h.angle !== undefined ? h.angle : holeAngle;
        const hSide = h.side || 'both';

        ctx.save(); 
        ctx.strokeStyle = '#FFFFFF'; 
        ctx.lineWidth = 4 * sgs; 
        ctx.setLineDash([10 * sgs, 10 * sgs]);

        // 左側選取框 (帶旋轉, 只有在 image 側時顯示)
        if (hSide === 'both' || hSide === 'image') {
          ctx.save();
          ctx.translate(h.x * s + offs.ix, h.y * s + offs.iy);
          ctx.rotate(currentAngle * Math.PI / 180);
          if (isTextHole(holeType)) {
            const tctx = dummyCanvasRef.current.getContext('2d')!;
            const renderStr = holeGlyph(holeType, customText, h);
            tctx.font = `500 ${sz}px sans-serif`;
            const tw = tctx.measureText(renderStr).width + 16 * sgs, th = sz + 16 * sgs;
            ctx.strokeRect(-tw / 2, -th / 2, tw, th);
          } else {
            const szz = sz + 16 * sgs;
            ctx.strokeRect(-szz / 2, -szz / 2, szz, szz);
          }
          ctx.restore();
        }

        // 右側選取框 (帶旋轉, 只有在 mask 側且完全在裡面時才顯示)
        if ((hSide === 'both' || hSide === 'mask') && isHoleFullyInsideMask(h, 1, maskW, maskH)) {
          ctx.save();
          ctx.translate(h.x * s + offs.mx, h.y * s + offs.my);
          ctx.rotate(currentAngle * Math.PI / 180);
          if (isTextHole(holeType)) {
            const tctx = dummyCanvasRef.current.getContext('2d')!;
            const renderStr = holeGlyph(holeType, customText, h);
            tctx.font = `500 ${sz}px sans-serif`;
            const tw = tctx.measureText(renderStr).width + 16 * sgs, th = sz + 16 * sgs;
            ctx.strokeRect(-tw / 2, -th / 2, tw, th);
          } else {
            const szz = sz + 16 * sgs;
            ctx.strokeRect(-szz / 2, -szz / 2, szz, szz);
          }
          ctx.restore();
        }

        ctx.restore();
      }
    }
    
    if (!isMain) {
      bCanvas.width = 0; if (fCanvas !== bCanvas) fCanvas.width = 0; lmc.width = 0;
    }
  }, [imageState, layout, maskColor, maskImageState, maskTransform, patternType, dotColor, dotGap, dotSize, holes, holeType, getHoleSize, customText, selectedTarget, holeAngle, maskScale, isHoleFullyInsideMask, objects, selectedObj, guides, tuningEdge, fxCanvasOf, fxTick]);

  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || !imageState) return;
    renderToCanvas(canvasRef.current, previewScaleRef.current);
    // 記住 1 倍時的 CSS 寬度（畫布是 max-w-full 等比縮放，換算全靠它）
    const r = canvasRef.current.getBoundingClientRect();
    if (r.width > 0 && imageState) {
      /* 基準尺寸用「舞台大小 ＋ 拼圖長寬比」直接算（contain 貼合），
         不去量畫布 —— 畫布的尺寸是我們自己寫死的，量它會跟自己打架。 */
      const stEl = stageRef.current;
      const cs0 = collageSizeOf(layout, imageState.baseW, imageState.baseH, maskScale);
      let cssW = 0, cssH = 0;
      if (stEl && cs0.w > 0 && cs0.h > 0) {
        const sb = stEl.getBoundingClientRect();
        const availW = Math.max(1, sb.width - 32), availH = Math.max(1, sb.height - 32);
        const f = Math.min(availW / cs0.w, availH / cs0.h);
        cssW = cs0.w * f; cssH = cs0.h * f;
        setBaseCss(prev => (prev && Math.abs(prev.w - cssW) < 0.5 && Math.abs(prev.h - cssH) < 0.5)
          ? prev : { w: cssW, h: cssH });
      }
      baseCssWRef.current = cssW || r.width;
      const cs = collageSizeOf(layout, imageState.baseW, imageState.baseH, maskScale);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      // 上限＝「畫得到的最細畫布」對應到螢幕上的倍率
      const z = (cs.w * maxPreviewScale()) / Math.max(1, (cssW || r.width) * dpr);
      /* 以前這裡硬給 1.5 的下限：畫布明明畫不到那麼細，卻還讓你放大到 1.5 倍 ——
         那段就是一定會糊的區間。改成「畫得到多少就只給多少」，
         任何倍率下都保證 1 個畫布像素 ≥ 1 個裝置像素。 */
      maxZoomRef.current = Math.max(1, Math.min(6, Math.floor(z * 20) / 20));
    }
  }, [imageState, renderToCanvas, previewScale, layout, maskScale, maxPreviewScale]);

  useEffect(() => { 
    if (saveState !== 'idle') return;
    let id = requestAnimationFrame(() => renderCanvas()); 
    return () => cancelAnimationFrame(id); 
  }, [renderCanvas, saveState]);

  const handleSave = () => {
    if (!imageState) return;
    setSelectedTarget(null);
    setSaveState('processing');
    
    setTimeout(async () => {
      try {
        const { originalW, originalH, baseW, baseH } = imageState;
        
        // 1. Calculate the collage total size at original resolution
        const rawSize = collageSizeOf(layout, originalW, originalH, maskScale);

        /* 兩道保險，缺一不可：
             ① 最長邊 ≤ 4096（Safari Mobile 的單邊上限）
             ② 總像素 ≤ MAX_EXPORT_PIXELS（真正會爆的是面積不是邊長）
           而且量的是「拼完之後的畫布」不是原圖 —— 拿原圖量的話，
           四周包圍那種畫布是原圖的 1.67 倍寬高，會整個超出去。 */
        let finalScale = 1.0;
        if (Math.max(rawSize.w, rawSize.h) > MAX_FINAL_DIM) {
          finalScale = MAX_FINAL_DIM / Math.max(rawSize.w, rawSize.h);
        }
        const area = rawSize.w * finalScale * rawSize.h * finalScale;
        if (area > MAX_EXPORT_PIXELS) finalScale *= Math.sqrt(MAX_EXPORT_PIXELS / area);

        const exportW = Math.floor(originalW * finalScale);
        const exportScale = exportW / baseW;

        const exportCanvas = document.createElement('canvas');
        // Render at optimized resolution
        renderToCanvas(exportCanvas, exportScale);
        
        // 一樣是無損 PNG，只是改用 blob 網址拿在手上（dataURL 會多吃一份 33% 膨脹的字串）
        const url = await canvasToUrl(exportCanvas);
        revokeUrl(finalUrlRef.current);
        finalUrlRef.current = url;
        setFinalImage(url);
        setSaveState('success');
        
        // Explicit cleanup
        exportCanvas.width = 0; exportCanvas.height = 0;
      } catch (e) {
        console.error("Failed to save collage", e);
        setSaveState('idle');
      }
    }, 150);
  };

  const selectedHole = holes.find(hx => hx.id === selectedTarget);
  const displayAngle = selectedHole ? (selectedHole.angle ?? holeAngle) : holeAngle;

  const handleAngleChange = (val: number) => {
    if (selectedTarget) {
      setHoles(prev => prev.map(h => h.id === selectedTarget ? { ...h, angle: val } : h));
    } else {
      setHoleAngle(val);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#0A0A0A] text-white font-sans overflow-hidden animate-in fade-in duration-300">
      <style>{`
        .no-select {
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            user-select: none !important;
        }
        .no-callout {
            -webkit-touch-callout: none !important;
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            user-select: none !important;
        }
        .allow-callout {
            -webkit-touch-callout: default !important;
            -webkit-user-select: auto !important;
            -moz-user-select: auto !important;
            -ms-user-select: auto !important;
            user-select: auto !important;
            pointer-events: auto !important;
            touch-action: auto !important;
            cursor: pointer !important;
            z-index: 150 !important;
            display: block !important;
        }
        .interactive-area {
            touch-action: none;
        }
        .main-canvas-container {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        /* 圖片編輯那一頁的滑桿：跟「編輯」「經典拼圖」用同一組樣式，連軌道與圓點都一樣。
           這一份是從 GridLayoutTool 逐字複製過來的 —— 那顆面板是共用元件，
           樣式卻寫在各自的 <style> 裡，少這一份就會退回瀏覽器原生滑桿。 */
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
        .custom-range:focus { outline: none; }
        .custom-range.dense { height: 26px; width: 100%; margin: 0; }
        .custom-range.dense::-webkit-slider-runnable-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-moz-range-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-webkit-slider-thumb { height: 26px; width: 18px; margin-top: -12px; }
        .custom-range.dense::-moz-range-thumb { height: 26px; width: 18px; }
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
        .custom-range::-webkit-slider-thumb:active { transform: scale(1.15); }
        .custom-range::-moz-range-track { height: 2px; background: #333; border-radius: 2px; }
        .custom-range::-moz-range-thumb {
          height: 15px; width: 15px; border-radius: 50%;
          background: #fff; border: none; cursor: pointer;
        }
        .premium-slider { -webkit-appearance: none; width: 100%; height: 2px; background: #222; border-radius: 2px; outline: none; touch-action: none; }
        .premium-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; cursor: pointer; }
        /* 圓球跟經典拼圖的顏色滑桿一致：沿用原生 thumb + accent-color，不自己畫 */
        .designer-color-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 3px; outline: none; touch-action: none; accent-color: #ffffff; cursor: pointer; }
      `}</style>

      {/* 構圖：跟「編輯」同一個介面，套用後 bake 回這個物件 */}
      {composeState && (
        <ComposeStudio
          image={composeState.img}
          geo={composeState.geo}
          onChange={g => setComposeState(st => (st ? { ...st, geo: g } : st))}
          onCancel={() => setComposeState(null)}
          onApply={applyComposeToObj}
        />
      )}

      {saveState === 'success' && finalImage && (
        <div className="absolute inset-0 z-[110] bg-black flex flex-col animate-in fade-in duration-500">
          <header className="h-14 flex items-center px-5 shrink-0 z-20 bg-black/40 backdrop-blur-xl">
            <button 
              onClick={(e) => { e.stopPropagation(); onHome(); }}
              className="p-2 -ml-2 text-[#888] hover:text-white transition-colors active:scale-90"
            >
              <ChevronLeft size={22} />
            </button>
          </header>
          <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
            <div className="relative shadow-2xl rounded overflow-hidden max-h-[60vh] max-w-full mb-4">
              <img 
                src={finalImage} 
                alt="Final Result" 
                className="max-w-full max-h-[60vh] object-contain allow-callout relative z-10" 
              />
              <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded"></div>
            </div>
          </div>
          <div className="bg-black flex flex-col gap-3 px-6 pb-6 pt-2">
            <SaveButton urls={finalImage ? [finalImage] : []} />
            <div className="flex items-center justify-center gap-4">
            <button 
              onClick={(e) => { e.stopPropagation(); setSaveState('idle'); }}
              className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-sm"
            >
              繼續編輯
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onImportNew(); }}
              className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-sm"
            >
              拼下一張
            </button>
            </div>
          </div>
        </div>
      )}

      {saveState === 'processing' && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white">正在存檔</p>
          <p className="text-[10px] text-white/40 mt-3 uppercase tracking-widest font-bold">優化高品質渲染中</p>
        </div>
      )}

      {saveState !== 'success' && (
      <header className="h-14 flex items-center justify-between px-5 z-[100] bg-black/40 backdrop-blur-xl">
        <div className="w-20 flex items-center shrink-0">
          <button 
            onClick={(e) => { e.stopPropagation(); onHome(); }}
            className="p-2 -ml-2 text-[#888] hover:text-white transition-colors active:scale-90"
            title="繼續編輯"
          >
            <ChevronLeft size={22} />
          </button>
        </div>
        {imageState && (
          <div className="flex items-center gap-2 md:gap-3">
            {/* 對稱鎖定工具 */}
            {/* 四周包圍是一整片場、沒有「左右兩塊要對稱」的概念，
                所以那個排版下這顆對稱鍵先收起來，免得按了不知道在做什麼 */}
            {/* 四周包圍沒有對稱的概念，所以那個排版下這顆用「隱形」而不是「移除」——
                移除的話旁邊的工具會整排往左跳一格。 */}
            <button 
              aria-hidden={layout === AROUND}
              tabIndex={layout === AROUND ? -1 : 0}
              /* transition-all 會把 visibility 也納入過場，切換時看起來慢半拍；
                 隱藏的那一刻把過場關掉，就是「馬上」不見。 */
              style={layout === AROUND
                ? { visibility: 'hidden', pointerEvents: 'none', transition: 'none' }
                : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (layout === AROUND) return;
                setSymmetryEnabled(prev => {
                  const next = !prev;
                  if (!next) {
                    // Decouple existing holes: split any hole of side: 'both' into 'image' and 'mask' sides
                    const decoupled: any[] = [];
                    holesRef.current.forEach(h => {
                      const side = h.side || 'both';
                      if (side === 'both') {
                        decoupled.push({
                          ...h,
                          id: h.id + '_img',
                          side: 'image'
                        });
                        decoupled.push({
                          ...h,
                          id: h.id + '_msk',
                          side: 'mask'
                        });
                      } else {
                        decoupled.push(h);
                      }
                    });
                    /* 全部本來就已經是拆開的（沒有一顆 'both'），
                       那這一下根本沒改到任何東西 —— 不該佔一格上一步。 */
                    if (sameHoles(decoupled, holesRef.current)) return next;
                    setHoles(decoupled);
                    setTimeout(() => pushHistory(decoupled), 0);
                  } else {
                    // Convert back to both but merge ones that were split or are in the same spot
                    const combined: any[] = [];
                    const seenBaseIds = new Set<string>();
                    
                    holesRef.current.forEach(h => {
                      // Extract base ID if it was decoupled
                      const baseId = h.id.replace(/_img$|_msk$/, '');
                      if (seenBaseIds.has(baseId)) return;
                      
                      combined.push({
                        ...h,
                        id: baseId,
                        side: 'both'
                      });
                      seenBaseIds.add(baseId);
                    });
                    if (sameHoles(combined, holesRef.current)) return next;
                    setHoles(combined);
                    setTimeout(() => pushHistory(combined), 0);
                  }
                  return next;
                });
              }}
              className={`p-1.5 rounded-md border transition-all active:scale-90 flex items-center justify-center ${
                symmetryEnabled 
                  ? 'bg-transparent border-transparent text-[#888] hover:text-white'
                  : 'bg-white/10 border-white text-white font-bold shadow-[0_0_8px_rgba(255,255,255,0.2)]'
              }`}
              title={symmetryEnabled ? '對稱鎖定：開啟中（點擊解除對稱，獨立調整兩邊）' : '對稱鎖定：已解除（可單獨建立、調整、刪除，點擊還原對稱）'}
            >
              {symmetryEnabled ? <Link size={18} /> : <Link2Off size={18} />}
            </button>

            {/* 畫筆/橡皮擦工具 */}
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setBrushMode(prev => {
                  if (prev === 'off') return 'pen';
                  if (prev === 'pen') return 'eraser';
                  return 'off';
                });
              }}
              className={`p-1.5 rounded-md border transition-all active:scale-90 flex items-center justify-center ${
                brushMode === 'pen' || brushMode === 'eraser'
                  ? 'bg-white/10 border-white text-white font-bold shadow-[0_0_8px_rgba(255,255,255,0.2)]' 
                  : 'bg-transparent border-transparent text-[#888] hover:text-white'
              }`}
              title={brushMode === 'pen' ? '畫筆模式（再按切換為橡皮擦）' : brushMode === 'eraser' ? '橡皮擦模式（再按關閉）' : '開啟畫筆'}
            >
              {brushMode === 'eraser' ? <Eraser size={18} /> : brushMode === 'pen' ? <Paintbrush size={18} /> : <MousePointer size={18} />}
            </button>

            {/* 分割線 */}
            <div className="w-px h-4 bg-white/10 mx-1 shrink-0" />

            <button 
              onClick={(e) => { e.stopPropagation(); undo(); }} 
              disabled={historyState.index <= 0} 
              className={`p-2 text-white transition-all ${historyState.index <= 0 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}
              title="復原"
            >
              <Icon name="undo" className="text-xl" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); redo(); }} 
              disabled={historyState.index >= historyState.history.length - 1} 
              className={`p-2 text-white transition-all ${historyState.index >= historyState.history.length - 1 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}
              title="重做"
            >
              <Icon name="redo" className="text-xl" />
            </button>
          </div>
        )}
        <div className="w-20 flex justify-end shrink-0">
          {imageState && (
            <button onClick={(e) => { e.stopPropagation(); handleSave(); }} className="bg-white text-black px-6 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg active:scale-95 transition-transform whitespace-nowrap">儲存</button>
          )}
        </div>
        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
        <input type="file" accept="image/*" className="hidden" ref={maskFileInputRef} onChange={handleMaskImageUpload} />
      </header>
      )}
      
      <main 
        className="flex-1 flex items-center justify-center relative p-4 interactive-area overflow-hidden no-callout no-select"
        onPointerDown={() => setSelectedTarget(null)}
      >
        {imageState && (
          <div
            ref={stageRef}
            className="absolute inset-0 overflow-hidden"
            style={{ touchAction: 'none' }}
            onWheel={(e) => {
              const c = stageBox();
              const v = viewTRef.current;
              const k = Math.max(1, Math.min(6, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
              const ax = e.clientX - c.x, ay = e.clientY - c.y;
              applyView(k, ax - ((ax - v.tx) / v.k) * k, ay - ((ay - v.ty) / v.k) * k);
            }}
          >
            <div
              className="w-full h-full flex items-center justify-center p-4"
              /* 只平移，不縮放。
                 縮放交給畫布自己的 CSS 尺寸 —— transform: scale() 會讓瀏覽器
                 先把畫布用「版面尺寸」光柵化成一張貼圖再拉大，畫布內部畫得再細
                 也救不回來，那就是圖案與遮罩邊緣一直有鋸齒的根本原因。 */
              style={{
                transform: `translate(${viewT.tx}px, ${viewT.ty}px)`,
                transition: viewPinchRef.current ? 'none' : 'transform 90ms linear',
              }}
            >
              <canvas 
                ref={canvasRef} 
                onPointerDown={handlePointerDown} 
                onPointerMove={handlePointerMove} 
                onPointerUp={handlePointerUp}
                className={`block drop-shadow-[0_20px_50px_rgba(255,255,255,0.05)] pointer-events-auto ${baseCss ? '' : 'max-w-full max-h-full'}`}
                style={{ 
                  touchAction: 'none',
                  // 1 倍時交給 max-w/max-h 自己貼合；放大之後直接寫死尺寸，
                  // 畫布就是實打實地被排版成那麼大，不經過任何貼圖拉伸
                  ...(baseCss ? { width: baseCss.w * viewT.k, height: baseCss.h * viewT.k } : null),
                  /* 尺寸過場只在「正在縮放」時才有意義。換排版時畫布形狀會整個換掉，
                     這時候讓寬高做動畫就會看到那種果凍般的伸縮（桌機用滾輪縮放特別明顯）。 */
                  transition: (viewPinchRef.current || viewT.k === 1) ? 'none' : 'width 90ms linear, height 90ms linear',
                  cursor: brushMode === 'pen' ? 'crosshair' : brushMode === 'eraser' ? 'pointer' : 'default' 
                }}
              />
            </div>
          </div>
        )}

        {/* 選中的圖片／文字下方浮出的工具列 —— 跟經典拼圖同一組動作。
            位置是用畫布的螢幕矩形換算的（畫布內部座標 → CSS 座標）。 */}
        {/* 構圖那一頁是全螢幕的，這排白色鍵不能浮在它上面 */}
        {/* 對齊線亮著、或正在拖形狀滑桿時，這排鍵也要一起讓開 */}
        {imageState && selectedObj && !composeState && !guides.length && !tuningEdge && (() => {
          const o = objects.find(z => z.id === selectedObj);
          const cvsEl = canvasRef.current;
          if (!o || !cvsEl) return null;
          const r = cvsEl.getBoundingClientRect();
          const stEl = stageRef.current;
          const sr = stEl ? stEl.getBoundingClientRect() : { left: 0, top: 0 };
          const ps = previewScaleRef.current;
          const k = r.width / Math.max(1, cvsEl.width / ps);   // 畫布內部單位 → CSS
          const cx = r.left - sr.left + (o.x + o.w / 2) * k;
          const by = r.top - sr.top + (o.y + o.h) * k + 10;
          const act = (fn: () => void) => (ev: React.PointerEvent) => { ev.stopPropagation(); ev.preventDefault(); fn(); };
          /* 比原本多一層：陣列最底下再往下按一次，就整個掉到「所有圖案之下」（below）。
             從 below 往上按就先回到圖案之上的最底層，再往上才是換順序。
             圖片與文字走的是同一套，沒有差別。 */
          const move = (dir: number) => setObjects(prev => {
            const i = prev.findIndex(z => z.id === o.id);
            if (i < 0) return prev;
            const cur = prev[i];
            const n = prev.slice();
            if (dir < 0) {
              if (i === 0) {
                if (cur.below) return prev;               // 已經是最底層了
                n[0] = { ...cur, below: true }; return n;
              }
              const [x0] = n.splice(i, 1); n.splice(i - 1, 0, x0); return n;
            }
            if (cur.below) { n[i] = { ...cur, below: false }; return n; }
            if (i >= prev.length - 1) return prev;
            const [x1] = n.splice(i, 1); n.splice(i + 1, 0, x1); return n;
          });
          const dup = () => {
            const id = Math.random().toString(36).slice(2, 9);
            setObjects(prev => [...prev, { ...o, id, x: o.x + o.w * 0.08, y: o.y + o.h * 0.08 }]);
            setSelectedObj(id);
          };
          return (
            <div
              className="absolute z-[70] flex items-center gap-0.5 bg-white rounded-full p-0.5 shadow-xl pointer-events-auto"
              style={{ left: cx, top: by, transform: 'translateX(-50%)', touchAction: 'none' }}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {[
                { t: '下移一層', on: act(() => move(-1)), el: <MoveDown size={14} />, off: objects[0]?.id === o.id && !!o.below },
                { t: '上移一層', on: act(() => move(1)), el: <MoveUp size={14} />, off: objects[objects.length - 1]?.id === o.id && !o.below },
                { t: '複製', on: act(dup), el: <Copy size={14} />, off: false },
                { t: o.type === 'text' ? '編輯文字' : '圖片調整', on: act(() => setActiveTab('objedit')), el: <Sliders size={14} />, off: false },
                { t: '刪除', on: act(() => { setObjects(prev => prev.filter(z => z.id !== o.id)); setSelectedObj(null); }), el: <Trash2 size={14} />, off: false },
              ].map(b => (
                <button key={b.t} title={b.t} disabled={b.off}
                  onPointerDown={b.off ? undefined : b.on}
                  className={`w-7 h-7 rounded-full flex items-center justify-center ${b.off ? 'text-black/25 cursor-default' : 'text-black hover:bg-black/10'}`}>
                  {b.el}
                </button>
              ))}
            </div>
          );
        })()}

        {imageState && (
          <div className="absolute bottom-6 right-6 z-[60]" onPointerDown={(e) => e.stopPropagation()}>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                generateRandomHoles();
              }} 
              className="p-3 bg-[#111] hover:bg-[#1a1a1a] border border-white/10 hover:border-white/20 text-[#aaa] hover:text-white rounded-full active:scale-95 transition-all shadow-[0_4px_16px_rgba(0,0,0,0.5)] flex items-center justify-center backdrop-blur-md"
              title="隨機圖形"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        )}

      </main>

      <input
        type="file"
        ref={objFileInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const url = URL.createObjectURL(f);
          const im = new Image();
          im.onload = () => {
            const offs2 = getLayoutOffsets();
            if (offs2) {
              const id = Math.random().toString(36).slice(2, 9);
              // 新增進來預設佔畫布短邊的四成，置中擺放
              const target = Math.min(offs2.cw, offs2.ch) * 0.4;
              const k = target / Math.max(im.width, im.height);
              const w = im.width * k, h = im.height * k;
              setObjects(prev => [...prev, {
                /* src 一定要留著：濾鏡／特效卡片的縮圖是拿它去重畫的，
                   構圖也要從它重新載一張原圖。所以這條 objectURL 不能 revoke。 */
                id, type: 'image', img: im, src: url,
                x: offs2.cw / 2 - w / 2, y: offs2.ch / 2 - h / 2, w, h, rot: 0,
              }]);
              setSelectedObj(id);
              setSelectedTarget(null);
              setActiveTab('objedit');   // 匯入完直接進編輯頁，跟新增文字一致
            }
          };
          im.src = url;
          e.target.value = '';
        }}
      />

      <footer className={`bg-[#0a0a0a] border-t border-[#1a1a1a] transition-transform duration-500 flex flex-col z-[50] no-select ${imageState ? 'translate-y-0' : 'translate-y-full absolute bottom-0 w-full'}`} style={{ height: objEditImage ? 'max(34dvh, 300px)' : '34dvh' }}>
        {!colorPickerTarget && (
          <div className="flex px-4 pt-1 border-b border-[#1a1a1a]">
            {['setting', 'add', 'objedit', 'shape'].map(id => (
              <button 
                key={id} 
                onClick={() => setActiveTab(id)} 
                className={`flex-1 py-3 text-[11px] font-bold border-b-2 transition-[color] duration-150 ${
                  activeTab === id ? 'text-white border-white' : 'text-[#555] border-transparent'
                }`}
              >
                {id === 'setting' ? <Crop size={16} className="mx-auto" /> : id === 'add' ? <Plus size={16} className="mx-auto" /> : id === 'objedit' ? <SlidersHorizontal size={16} className="mx-auto" /> : <Star size={16} className="mx-auto" />}
              </button>
            ))}
          </div>
        )}
        
        {/* pb-20 本來是留給右下角那顆浮動按鈕的空間，但「圖案」頁是左右分欄、
            自己就會捲，那 80px 只會在下面留一條黑色空白、把工具欄擠得很小。 */}
        {/* 圖片編輯那一頁是「滑桿 5rem ＋ 工具列 6rem ＋ 分類列 h-16」的三段式，
            自己就把整個高度切好了。再包一層 p-5 會整個縮一圈、上面那根滑桿
            還會被擠出可視範圍 —— 所以這一頁完全不加內距，跟經典拼圖一樣。 */}
        <div ref={scrollContainerRef} className={`flex-1 ${objEditImage ? 'overflow-hidden' : `p-5 ${colorPickerTarget || activeTab === 'shape' || activeTab === 'objedit' ? 'pb-5' : 'pb-20'} custom-scrollbar ${
          (activeTab === 'setting' && !colorPickerTarget) ||
          (activeTab === 'add' && !colorPickerTarget) ||
          (activeTab === 'objedit' && !colorPickerTarget) ||
          (activeTab === 'shape' && !colorPickerTarget)
            ? 'overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]' 
            : 'overflow-hidden'
        }`}`}>
          {colorPickerTarget ? (
            <ColorPickerEmbedded 
              color={colorPickerTarget === 'mask' ? maskColor : dotColor} 
              onChange={c => { if(colorPickerTarget==='mask') setMaskColor(c); else setDotColor(c); }}
              onClose={() => setColorPickerTarget(null)}
              title={colorPickerTarget === 'mask' ? '遮罩顏色' : '點點'}
            />
          ) : (
            <>
              {activeTab === 'setting' && <div className="max-w-md mx-auto space-y-4 pb-4 animate-in fade-in duration-300">


                <div className="flex gap-4 items-start">
                  <div className="flex flex-col">
                    <div className="text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
                      <span>排版</span>
                    </div>
                    <div className="h-9 flex items-center gap-2 bg-[#111] border border-[#222] px-1.5 rounded-[6px] w-fit">
                      {['mask-bottom', 'mask-top', 'mask-left', 'mask-right', AROUND].map(t => (
                        <button key={t} onClick={() => {
                          // 排版、比例、圖案在同一批更新裡一起換，中間不會露出半舊半新的那一格
                          setLayout(t);
                          if (t === AROUND) setMaskScale(AROUND_SCALE);
                          setSelectedTarget(null);
                          generateRandomHoles(true, t);
                        }} className="focus:outline-none">
                          <LayoutIcon type={t} active={layout === t} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col flex-1">
                    <div className="text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest pl-2">
                      <span>比例</span>
                    </div>
                    <div className="h-9 flex items-center gap-1 bg-[#111] border border-[#222] px-1 rounded-[6px] w-full">
                      {[
                        { label: '1/1', val: 1.0 },
                        { label: '1/2', val: 0.5 },
                        { label: '1/3', val: 1.0 / 3.0 }
                      ].map(s => (
                        <button
                          key={s.label}
                          onClick={() => setMaskScale(s.val)}
                          className={`flex-1 h-6 rounded-[4px] text-[10px] font-bold transition-all border ${
                            Math.abs(maskScale - s.val) < 0.05
                              ? 'border-white text-white bg-transparent'
                              : 'border-transparent text-[#888] hover:text-white bg-transparent'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {/* 遮罩的三項（自訂遮罩、顏色、紋理）接在排版與比例下面 ——
                    它們講的都是「這張版面長什麼樣」，本來就該在同一頁。
                    -mt-1 是為了讓它跟上面那排的間距，跟這三項彼此之間一樣。 */}
                <div className="space-y-3 !mt-3">

                <div className="grid grid-cols-2 gap-3">
                  <div className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px]">
                    <span className="text-[10px] font-bold text-[#888] shrink-0">自訂遮罩</span>
                    <div className="flex gap-1.5 overflow-hidden">
                      {maskImageState && (
                        <button onClick={(e) => { e.stopPropagation(); setMaskImageState(null); }} className="flex items-center justify-center p-1.5 text-[10px] bg-[#222] text-white font-bold rounded-[4px] border border-[#333] hover:bg-[#333] transition-all" title="還原素色">
                          <RotateCcw size={12} />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); maskFileInputRef.current?.click(); }} className="px-2 py-1.5 text-[10px] bg-white text-black font-bold rounded-[4px] hover:bg-gray-200 transition-colors uppercase tracking-widest whitespace-nowrap">
                        {maskImageState ? '更換' : '選擇'}
                      </button>
                    </div>
                  </div>
                  <div className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px] cursor-pointer hover:bg-[#151515] transition-colors" onClick={() => setColorPickerTarget('mask')}>
                    <span className="text-[10px] font-bold text-[#888]">顏色</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-white/40">{maskColor}</span>
                      <div className="w-6 h-5 rounded-[4px] shadow-inner border border-white/10" style={{ backgroundColor: maskColor }} />
                    </div>
                  </div>
                </div>
                <div className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px]">
                  <span className="text-[10px] font-bold text-[#888]">紋理</span>
                  <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                    {['none', 'dot'].map(t => (
                      <button key={t} onClick={() => setPatternType(t)} className={`px-4 h-6 text-[10px] font-bold rounded-[2px] transition-all ${patternType === t ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'}`}>{t === 'none' ? '無' : '點點'}</button>
                    ))}
                  </div>
                </div>
                {patternType === 'dot' && (
                  <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-[8px] p-4 space-y-3 animate-in fade-in zoom-in-95 duration-300">
                    <div className="grid grid-cols-2 gap-4">
                      <CompactSlider label="大小" value={dotSize} min={0} max={100} onChange={setDotSize} />
                      <CompactSlider label="間距" value={dotGap} min={0} max={100} onChange={setDotGap} />
                    </div>
                    <div className="flex items-center justify-between bg-[#111] p-2.5 border border-[#222] rounded-[6px] cursor-pointer hover:bg-[#151515] transition-colors" onClick={() => setColorPickerTarget('dot')}>
                      <span className="text-[10px] font-bold text-[#888]">顏色</span>
                      <div className="w-8 h-4 rounded-[3px] border border-white/5 shadow-inner" style={{ backgroundColor: dotColor }} />
                    </div>
                  </div>
                )}
                </div>
              </div>}
              {activeTab === 'add' && (() => {
                const sel = objects.find(o => o.id === selectedObj) || null;
                const patch = (d: any) => setObjects(prev => prev.map(o => o.id === sel.id ? { ...o, ...d } : o));
                const addText = () => {
                  const offs2 = getLayoutOffsets();
                  if (!offs2) return;
                  const id = Math.random().toString(36).slice(2, 9);
                  const size = Math.round(Math.min(offs2.cw, offs2.ch) * 0.09);
                  const w = size * 4, h = size * 1.3;
                  setObjects(prev => [...prev, {
                    id, type: 'text', text: 'Abai', color: '#ffffff', size,
                    fontFamily: DEFAULT_FONT, bold: false, italic: false,
                    letterSpacing: 0, strokeWidth: 0, strokeColor: '#000000',
                    glow: 0, glowColor: '#ffffff',
                    x: offs2.cw / 2 - w / 2, y: offs2.ch / 2 - h / 2, w, h, rot: 0,
                  }]);
                  setSelectedObj(id);
                  setSelectedTarget(null);
                  ensureFont(DEFAULT_FONT);
                  setActiveTab('objedit');   // 新增完直接進編輯頁，跟經典拼圖一樣
                };
                return (
                  <div className="max-w-md mx-auto space-y-4 animate-in fade-in duration-300">
                    {/* 按鈕與圖標尺寸跟經典拼圖的加號頁完全一致；
                        只差沒有「新增佈局」——創意拼圖的版面是排版＋遮罩決定的。 */}
                    <div className="flex justify-center gap-4 mt-6">
                      <button
                        onClick={() => objFileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center py-4 px-6 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                      >
                        <Icon name="add_photo_alternate" className="text-[24px] text-white/80" />
                        <span className="text-[11px] font-bold tracking-widest text-white/90">匯入照片</span>
                      </button>
                      <button
                        onClick={addText}
                        className="flex flex-col items-center justify-center py-4 px-6 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                      >
                        <Type size={24} strokeWidth={1.5} className="text-white opacity-80" />
                        <span className="text-[11px] font-bold tracking-widest text-white/90">新增文字</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
              {activeTab === 'objedit' && (() => {
                const sel = objects.find(o => o.id === selectedObj) || null;
                const patch = (d: any) => setObjects(prev => prev.map(o => o.id === sel.id ? { ...o, ...d } : o));
                const move = (dir: number) => setObjects(prev => {
                  const i = prev.findIndex(o => o.id === sel.id);
                  const j = i + dir;
                  if (i < 0 || j < 0 || j >= prev.length) return prev;
                  const n = prev.slice(); const [x] = n.splice(i, 1); n.splice(j, 0, x); return n;
                });
                if (!sel) return (
                  <div className="max-w-md mx-auto pt-8 text-center animate-in fade-in duration-300">
                    <p className="text-[11px] text-[#666] leading-relaxed">
                      先在預覽上點一下要編輯的圖片或文字
                    </p>
                  </div>
                );
                return (
                  sel.type === 'text' ? (
                    <div className="max-w-md mx-auto h-full animate-in fade-in duration-300">
                      <TextEditorPanel
                        layer={{
                          text: sel.text, color: sel.color, fontFamily: sel.fontFamily,
                          fontSize: sel.size, bold: sel.bold, italic: sel.italic,
                          letterSpacing: sel.letterSpacing, strokeWidth: sel.strokeWidth,
                          strokeColor: sel.strokeColor, glow: sel.glow, glowColor: sel.glowColor,
                        } as any}
                        onChange={(d: any) => {
                          if (d.fontFamily) ensureFont(d.fontFamily);
                          if (d.fontSize !== undefined) { patch({ ...d, size: d.fontSize }); return; }
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
                      img={sel} set={(d: any) => patch(d)} lutList={lutList}
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
                      deferSlider
                    />
                  </div>
                  )
                );
              })()}
              {activeTab === 'shape' && <div className="max-w-md mx-auto h-full flex flex-row animate-in fade-in duration-300">
                {/* 左側細長分頁列：上面挑圖案、下面調參數 ——
                    跟經典拼圖「新增佈局」裡面完全同一種版型（只有圖示、中間一條分隔線） */}
                <div className="flex flex-col shrink-0 w-11 -mt-5 -mb-5 -ml-5 border-r border-white/10 select-none">
                  <button
                    onClick={() => setShapeSub('shape')}
                    title="圖案" aria-label="圖案"
                    /* 只做「發亮 + 圖標微放大」。原本是整顆 transition-all，
                       連 outline / 邊框那些也一起過場，點下去跟移開時看起來會抖。 */
                    className={`w-full flex-1 flex items-center justify-center outline-none transition-colors duration-150 ${shapeSub === 'shape' ? 'text-white' : 'text-[#5a5a5a]'}`}
                  >
                    <Star size={18} className={`transition-transform duration-150 will-change-transform ${shapeSub === 'shape' ? 'scale-110' : 'scale-100'}`} />
                  </button>
                  <div className="w-full h-[1px] bg-white/10 shrink-0" />
                  <button
                    onClick={() => setShapeSub('style')}
                    title="參數" aria-label="參數"
                    className={`w-full flex-1 flex items-center justify-center outline-none transition-colors duration-150 ${shapeSub === 'style' ? 'text-white' : 'text-[#5a5a5a]'}`}
                  >
                    <SlidersHorizontal size={18} className={`transition-transform duration-150 will-change-transform ${shapeSub === 'style' ? 'scale-110' : 'scale-100'}`} />
                  </button>
                </div>
                <div className="flex-1 min-w-0 no-scrollbar pl-3 pr-1 h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {shapeSub === 'shape' && <div className="pt-0.5 pb-2">
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {['circle', 'square', 'cross-star', 'heart', 'star', 'flower', 'love', 'love3', 'vortex', 'random-num', 'seagrass', 'darkstar', 'sparkle', 'aster', 'text'].map(s => (
                    <button key={s} onClick={() => handleShapeClick(s)} className={`py-3 flex items-center justify-center rounded-[8px] border transition-all ${holeType === s ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`}>
                      {s === 'circle' ? <Circle size={18} /> : s === 'square' ? <Square size={18} /> : s === 'cross-star' ? <CrossStarIcon size={18} /> : s === 'heart' ? <Heart size={18} /> : s === 'star' ? <Star size={18} /> : s === 'flower' ? <span className="text-lg font-bold font-sans leading-none">❋</span> : s === 'love' ? <span className="text-xs font-black font-mono tracking-tighter leading-none">&lt;3</span> : s === 'love3' ? <span className="text-[10px] font-black font-mono tracking-tighter leading-none">&lt;333</span> : s === 'vortex' ? <VortexIcon size={18} /> : s === 'random-num' ? <span className="text-sm font-bold font-sans leading-none tracking-tight">(9)</span> : GLYPH_HOLES[s] ? <span className="text-lg font-bold font-sans leading-none">{GLYPH_HOLES[s]}</span> : <Type size={18} />}
                    </button>
                  ))}
                </div>
                {holeType === 'text' && (
                  <div ref={textInputWrapRef} className="pb-1">
                    <input 
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
                {shapeSub === 'style' && <div className="pt-1 pb-2 grid grid-cols-2 gap-4">
                  <CompactSlider label="大小" value={holeSize} min={0} max={100} onChange={setHoleSize} />
                  <CompactSlider label="數量" value={holeCount} min={0} max={50} onChange={setHoleCount} step={1} />
                  <CompactSlider label="變化" value={sizeJitter} min={0} max={50} onChange={setSizeJitter} />
                  <CompactSlider label="角度" value={displayAngle} min={0} max={360} onChange={handleAngleChange} step={1} />
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

const CompactSlider = ({ label, value, min, max, onChange, step = "any" }: any) => (
  <div className="flex flex-col">
    <div className="flex justify-between text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
      <span>{label}</span>
      <span className="text-white font-sans">{Math.round(value)}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="premium-slider" onPointerDown={e => e.stopPropagation()} />
  </div>
);

const LayoutIcon = ({ type, active }: any) => {
  const pos = type.split('-')[1];
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
