
import { canvasToUrl, revokeUrl } from '../utils/blobUrl';
import { get2dWide } from '../utils/colorSpace';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { Download, RefreshCw, Type, Circle, Heart, Star, Square, Settings2, Palette, X, Plus, ChevronLeft, ArrowLeft, RotateCcw, Paintbrush, Eraser, MousePointer, Link, Link2Off } from 'lucide-react';
import { Icon } from './Icon';
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
const isTextHole = (t: string) => t === 'text' || t === 'love' || t === 'random-num' || t in GLYPH_HOLES;

/** 這個洞實際上要畫出來的字串 */
const holeGlyph = (holeType: string, customText: string, h?: any) =>
  GLYPH_HOLES[holeType]
  ?? (holeType === 'love' ? '<3'
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
  if (holeType === 'love') {
    tempCtx.font = `bold ${sz * 1.05}px "Inter", "Segoe UI", sans-serif`;
    tempCtx.textAlign = 'center';
    tempCtx.textBaseline = 'middle';
    tempCtx.fillText('<3', 0, 0);
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
  initialFile?: File | null;
  onImportNew: () => void;
  /** 接續上次時把存下來的參數餵回來 */
  initialState?: any;
}

export const CollageTool: React.FC<CollageToolProps> = ({ onHome, initialFile, onImportNew, initialState }) => {
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
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null); 
  const [colorPickerTarget, setColorPickerTarget] = useState<string | null>(null); 
  const [maskImageState, setMaskImageState] = useState<any>(null);
  const [imageTransform, setImageTransform] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [maskTransform, setMaskTransform] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [activeTab, setActiveTab] = useState('setting');
  const [maskColor, setMaskColor] = useState('#FFF2E6'); 
  const [patternType, setPatternType] = useState('none'); 
  const [dotColor, setDotColor] = useState('#737373'); 
  const [dotSize, setDotSize] = useState(10); 
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
    if (activeTab !== 'shape' || holeType !== 'text') return;
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
  }, [activeTab, holeType]);

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

  const generateRandomHoles = useCallback((isInitial: boolean = false) => {
    if (!imageState) return;
    const { baseW, baseH, globalScale: gs } = imageState;
    const mappedHoleSize = 25 + (holeSize / 100) * 125;
    const s = mappedHoleSize * gs;
    const p = s/2 + 25 * gs;
    const newHoles = [];
    for (let i = 0; i < holeCount; i++) {
      let att = 0, valid = false, hx = 0, hy = 0;
      while (!valid && att < 500) {
        hx = p + Math.random() * (baseW - p * 2); hy = p + Math.random() * (baseH - p * 2); valid = true;
        for (let ex of newHoles) if (Math.hypot(ex.x - hx, ex.y - hy) < s * 1.2) { valid = false; break; }
        att++;
      }
      newHoles.push({ id: Math.random().toString(36).substr(2, 9), x: hx, y: hy, randomFactor: Math.random() * 2 - 1, randomNumber: Math.floor(Math.random() * 10), side: symmetryEnabled ? 'both' : 'image' });
    }
    setHoles(newHoles);
    if (isInitial) {
      resetHistory(newHoles);
    } else {
      pushHistory(newHoles);
    }
  }, [imageState, holeCount, holeSize, sizeJitter, pushHistory, resetHistory, symmetryEnabled]);

  useEffect(() => { 
    setSelectedTarget(null);
    generateRandomHoles(true); 
  }, [imageState, holeCount]);

  const getLayoutOffsets = useCallback(() => {
    if (!imageState) return null;
    let { baseW: bw, baseH: bh } = imageState;
    const mw = Math.round(bw * (layout.includes('left') || layout.includes('right') ? maskScale : 1));
    const mh = Math.round(bh * (layout.includes('top') || layout.includes('bottom') ? maskScale : 1));

    if (layout === 'mask-bottom') return { cw: bw, ch: bh + mh, ix: 0, iy: 0, mx: 0, my: bh };
    if (layout === 'mask-top') return { cw: bw, ch: bh + mh, ix: 0, iy: mh, mx: 0, my: 0 };
    if (layout === 'mask-right') return { cw: bw + mw, ch: bh, ix: 0, iy: 0, mx: bw, my: 0 };
    if (layout === 'mask-left') return { cw: bw + mw, ch: bh, ix: mw, iy: 0, mx: 0, my: 0 };
    return { cw: bw, ch: bh, ix: 0, iy: 0, mx: 0, my: 0 };
  }, [imageState, layout, maskScale]);

  const getHoleSize = useCallback((h: any) => {
    const gs = imageState?.globalScale || 1;
    const mappedHoleSize = 25 + (holeSize / 100) * 125;
    const baseSize = Math.max(25, mappedHoleSize + (h.randomFactor || 0) * sizeJitter);
    return baseSize * gs * (h.localScale || 1);
  }, [holeSize, sizeJitter, imageState?.globalScale]);

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
    const mw = Math.round(imageState.baseW * (layout.includes('left') || layout.includes('right') ? maskScale : 1));
    const mh = Math.round(imageState.baseH * (layout.includes('top') || layout.includes('bottom') ? maskScale : 1));

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
        return isHoleFullyInsideMask(h, 1, mw, mh) && checkInRectMask(offs.mx, offs.my);
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
        return isHoleFullyInsideMask(h, 1, mw, mh) && checkInCircleMask(offs.mx, offs.my);
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
      const mw = Math.round(imageState.baseW * (layout.includes('left') || layout.includes('right') ? maskScale : 1));
      const mh = Math.round(imageState.baseH * (layout.includes('top') || layout.includes('bottom') ? maskScale : 1));

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
    
    const sx = canvasRef.current.width / rect.width, sy = canvasRef.current.height / rect.height;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    const gs = imageState.globalScale || 1, offs = getLayoutOffsets();

    if (activePointers.current.size === 1) {
      strokeStartHolesRef.current = holesRef.current;
      // Determine clickedSide
      let clickedSide: 'image' | 'mask' | undefined = undefined;
      if (offs) {
        const { baseW: bw, baseH: bh } = imageState;
        const scaleX = layout.includes('left') || layout.includes('right') ? maskScale : 1.0;
        const scaleY = layout.includes('top') || layout.includes('bottom') ? maskScale : 1.0;
        const inOriginal = x >= offs.ix && x <= offs.ix + bw && y >= offs.iy && y <= offs.iy + bh;
        const inMask = x >= offs.mx && x <= offs.mx + bw * scaleX && y >= offs.my && y <= offs.my + bh * scaleY;
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
                side: symmetryEnabled ? 'both' : clickedSide
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
    const kk = Math.max(1, Math.min(6, k));
    // 限制平移範圍，免得把圖拖出畫面找不回來
    const mx = Math.max(0, (kk - 1) * c.w * 0.5);
    const my = Math.max(0, (kk - 1) * c.h * 0.5);
    setViewT({ k: kk, tx: Math.max(-mx, Math.min(mx, tx)), ty: Math.max(-my, Math.min(my, ty)) });
  }, []);
  // 換一張圖就把縮放歸零
  const viewResetKeyRef = useRef('');
  useEffect(() => {
    const key = imageState ? `${imageState.baseW}x${imageState.baseH}` : '';
    if (key !== viewResetKeyRef.current) {
      viewResetKeyRef.current = key;
      setViewT({ k: 1, tx: 0, ty: 0 });
    }
  }, [imageState]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId) || !canvasRef.current || !imageState) return;
    activePointers.current.set(e.pointerId, e);
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = canvasRef.current.width / rect.width, sy = canvasRef.current.height / rect.height;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    const gs = imageState?.globalScale || 1;
    // 雙指縮放預覽時完全不碰筆刷與拖曳
    if (viewPinchRef.current && activePointers.current.size >= 2) {
      e.stopPropagation();
      const pts: any[] = Array.from(activePointers.current.values());
      const pin = viewPinchRef.current;
      const c = stageBox();
      const dist = Math.max(1, Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY));
      const k = Math.max(1, Math.min(6, pin.k0 * (dist / pin.d0)));
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
              side: symmetryEnabled ? 'both' : intr.clickedSide
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
      const nx = Math.max(0, Math.min(imageState.baseW, intr.initX + dx));
      const ny = Math.max(0, Math.min(imageState.baseH, intr.initY + dy));
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

    const scaleX = layout.includes('left') || layout.includes('right') ? maskScale : 1.0;
    const scaleY = layout.includes('top') || layout.includes('bottom') ? maskScale : 1.0;
    const maskW = Math.round(sw * scaleX);
    const maskH = Math.round(sh * scaleY);

    const getLayoutOffsetsS = () => {
      if (layout === 'mask-bottom') return { cw: sw, ch: sh + maskH, ix: 0, iy: 0, mx: 0, my: sh };
      if (layout === 'mask-top') return { cw: sw, ch: sh + maskH, ix: 0, iy: maskH, mx: 0, my: 0 };
      if (layout === 'mask-right') return { cw: sw + maskW, ch: sh, ix: 0, iy: 0, mx: sw, my: 0 };
      if (layout === 'mask-left') return { cw: sw + maskW, ch: sh, ix: maskW, iy: 0, mx: 0, my: 0 };
      return { cw: sw, ch: sh, ix: 0, iy: 0, mx: 0, my: 0 };
    };

    const offs = getLayoutOffsetsS();
    if (targetCanvas.width !== offs.cw || targetCanvas.height !== offs.ch) {
      targetCanvas.width = offs.cw;
      targetCanvas.height = offs.ch;
    }

    ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, 0, offs.cw, offs.ch);
    ctx.fillStyle = '#1A1A1A'; ctx.fillRect(offs.ix, offs.iy, sw, sh); ctx.fillRect(offs.mx, offs.my, maskW, maskH);

    const isMain = renderScale === 1 && targetCanvas === canvasRef.current;
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
      const drawX = (maskW - drawW) / 2;
      const drawY = (maskH - drawH) / 2;
      bCtx.drawImage(mImg, drawX, drawY, drawW, drawH);
    }

    const fCanvas = isMain ? fullMaskCanvasRef.current : document.createElement('canvas');
    fCanvas.width = maskW; fCanvas.height = maskH;
    const fCtx = get2dWide(fCanvas)!;
    fCtx.drawImage(bCanvas, 0, 0);

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

    drawImg(imageState.img, imageTransform, offs.ix, offs.iy, sw, sh);
    // Draw scaled image on the mask side too if it exists
    drawImg(imageState.img, imageTransform, offs.mx, offs.my, maskW, maskH);

    ctx.save(); ctx.translate(offs.ix, offs.iy);
    const basePat = ctx.createPattern(bCanvas, 'repeat');
    if (basePat) {
      ctx.fillStyle = basePat;
      holes.forEach(h => {
        const side = h.side || 'both';
        if (side !== 'both' && side !== 'image') return; // Only show on image side

        const sz = getHoleSize(h) * s;
        const currentAngle = h.angle !== undefined ? h.angle : holeAngle;
        if (isTextHole(holeType)) {
          const tText = holeGlyph(holeType, customText, h);
          drawTextShape(ctx, holeType, tText, h.x * s, h.y * s, sz, basePat, false, currentAngle);
        } else {
          ctx.save();
          ctx.translate(h.x * s, h.y * s);
          ctx.rotate(currentAngle * Math.PI / 180);
          drawShapePath(ctx, holeType, 0, 0, sz);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    ctx.restore();

    const lmc = isMain ? lowerMaskCanvasRef.current : document.createElement('canvas');
    lmc.width = maskW; lmc.height = maskH;
    const lmx = get2dWide(lmc)!;
    lmx.drawImage(fCanvas, 0, 0);
    lmx.globalCompositeOperation = 'destination-out';
    holes.forEach(h => {
      const side = h.side || 'both';
      if (side !== 'both' && side !== 'mask') return; // Only show on mask side

      if (!isHoleFullyInsideMask(h, s, maskW, maskH)) {
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

    // ctx.beginPath();
    // if (layout.includes('bottom') || layout.includes('top')) { ctx.moveTo(0, sh); ctx.lineTo(sw, sh); }
    // else { ctx.moveTo(sw, 0); ctx.lineTo(sw, sh); }
    // ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = sgs; ctx.stroke();

    if (renderScale === 1 && selectedTarget && interactionRef.current) {
      const selectedHole = holes.find(hx => hx.id === selectedTarget);
      if (selectedHole) {
        const h = selectedHole;
        const sz = getHoleSize(h);
        const currentAngle = h.angle !== undefined ? h.angle : holeAngle;
        const hSide = h.side || 'both';

        ctx.save(); 
        ctx.strokeStyle = '#FFFFFF'; 
        ctx.lineWidth = 4 * sgs; 
        ctx.setLineDash([10 * sgs, 10 * sgs]);

        // 左側選取框 (帶旋轉, 只有在 image 側時顯示)
        if (hSide === 'both' || hSide === 'image') {
          ctx.save();
          ctx.translate(h.x + offs.ix, h.y + offs.iy);
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
          ctx.translate(h.x + offs.mx, h.y + offs.my);
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
      bCanvas.width = 0; fCanvas.width = 0; lmc.width = 0;
    }
  }, [imageState, layout, maskColor, maskImageState, maskTransform, patternType, dotColor, dotGap, dotSize, holes, holeType, getHoleSize, customText, selectedTarget, holeAngle, maskScale, isHoleFullyInsideMask]);

  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || !imageState) return;
    renderToCanvas(canvasRef.current, 1);
  }, [imageState, renderToCanvas]);

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
        const getCollageSize = (w: number, h: number) => {
          const mw = Math.round(w * (layout.includes('left') || layout.includes('right') ? maskScale : 1));
          const mh = Math.round(h * (layout.includes('top') || layout.includes('bottom') ? maskScale : 1));
          
          if (layout === 'mask-bottom' || layout === 'mask-top') return { w, h: h + mh };
          if (layout === 'mask-right' || layout === 'mask-left') return { w: w + mw, h };
          return { w, h };
        };

        const rawSize = getCollageSize(originalW, originalH);
        
        // 2. Cap internal resolution to 4096px (Safari Mobile limit safe zone)
        // This is why ImageEditor is stable - it doesn't push beyond hardware limits.
        const MAX_FINAL_DIM = 4096;
        let finalScale = 1.0;
        if (Math.max(rawSize.w, rawSize.h) > MAX_FINAL_DIM) {
          finalScale = MAX_FINAL_DIM / Math.max(rawSize.w, rawSize.h);
        }

        const exportW = Math.round(originalW * finalScale);
        const exportH = Math.round(originalH * finalScale);
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
        .premium-slider { -webkit-appearance: none; width: 100%; height: 2px; background: #222; border-radius: 2px; outline: none; touch-action: none; }
        .premium-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; cursor: pointer; }
        /* 圓球跟經典拼圖的顏色滑桿一致：沿用原生 thumb + accent-color，不自己畫 */
        .designer-color-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 3px; outline: none; touch-action: none; accent-color: #ffffff; cursor: pointer; }
      `}</style>
      
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
            <div className="relative shadow-2xl rounded-lg overflow-hidden max-h-[60vh] max-w-full mb-4">
              <img 
                src={finalImage} 
                alt="Final Result" 
                className="max-w-full max-h-[60vh] object-contain allow-callout relative z-10" 
              />
              <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded-lg"></div>
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
            <button 
              onClick={(e) => {
                e.stopPropagation();
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
              style={{
                transform: `translate(${viewT.tx}px, ${viewT.ty}px) scale(${viewT.k})`,
                transition: viewPinchRef.current ? 'none' : 'transform 90ms linear',
              }}
            >
              <canvas 
                ref={canvasRef} 
                onPointerDown={handlePointerDown} 
                onPointerMove={handlePointerMove} 
                onPointerUp={handlePointerUp}
                className="max-w-full max-h-full block drop-shadow-[0_20px_50px_rgba(255,255,255,0.05)] pointer-events-auto" 
                style={{ 
                  touchAction: 'none',
                  cursor: brushMode === 'pen' ? 'crosshair' : brushMode === 'eraser' ? 'pointer' : 'default' 
                }}
              />
            </div>
          </div>
        )}

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

      <footer className={`bg-[#0a0a0a] border-t border-[#1a1a1a] transition-all duration-500 flex flex-col z-[50] no-select ${imageState ? 'translate-y-0' : 'translate-y-full absolute bottom-0 w-full'}`} style={{ height: '34dvh' }}>
        {!colorPickerTarget && (
          <div className="flex px-4 pt-1 border-b border-[#1a1a1a]">
            {['setting', 'shape', 'mask'].map(id => (
              <button 
                key={id} 
                onClick={() => setActiveTab(id)} 
                className={`flex-1 py-3 text-[11px] font-bold border-b-2 transition-[color] duration-150 ${
                  activeTab === id ? 'text-white border-white' : 'text-[#555] border-transparent'
                }`}
              >
                {id === 'setting' ? <Settings2 size={16} className="mx-auto" /> : id === 'shape' ? <Star size={16} className="mx-auto" /> : <Palette size={16} className="mx-auto" />}
              </button>
            ))}
          </div>
        )}
        
        <div ref={scrollContainerRef} className={`flex-1 p-5 ${colorPickerTarget ? 'pb-5' : 'pb-20'} custom-scrollbar ${
          (activeTab === 'mask' && !colorPickerTarget && patternType !== 'none') ||
          (activeTab === 'shape' && !colorPickerTarget)
            ? 'overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]' 
            : 'overflow-hidden'
        }`}>
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
                    <div className="flex gap-2 bg-[#111] border border-[#222] p-1.5 rounded-[6px] w-fit">
                      {['mask-bottom', 'mask-top', 'mask-left', 'mask-right'].map(t => (
                        <button key={t} onClick={() => setLayout(t)} className="focus:outline-none">
                          <LayoutIcon type={t} active={layout === t} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col flex-1">
                    <div className="text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest pl-2">
                      <span>比例</span>
                    </div>
                    <div className="flex gap-1 bg-[#111] border border-[#222] p-1 rounded-[6px] w-full">
                      {[
                        { label: '1/1', val: 1.0 },
                        { label: '1/2', val: 0.5 },
                        { label: '1/3', val: 1.0 / 3.0 }
                      ].map(s => (
                        <button
                          key={s.label}
                          onClick={() => setMaskScale(s.val)}
                          className={`flex-1 py-1.5 rounded-[4px] text-[10px] font-bold transition-all border ${
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

                <div className="grid grid-cols-2 gap-4">
                  <CompactSlider 
                    label="大小" 
                    value={holeSize} 
                    min={0} 
                    max={100} 
                    onChange={setHoleSize} 
                  />
                  <CompactSlider label="數量" value={holeCount} min={0} max={50} onChange={setHoleCount} step={1} />
                  <CompactSlider label="變化" value={sizeJitter} min={0} max={50} onChange={setSizeJitter} />
                  <CompactSlider 
                    label="角度" 
                    value={displayAngle} 
                    min={0} 
                    max={360} 
                    onChange={handleAngleChange} 
                    step={1} 
                  />
                </div>
              </div>}
              {activeTab === 'shape' && <div className="max-w-md mx-auto flex flex-col justify-start pt-1.5 pb-4 animate-in fade-in duration-300">
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {['circle', 'square', 'cross-star', 'heart', 'star', 'flower', 'love', 'vortex', 'random-num', 'seagrass', 'darkstar', 'sparkle', 'aster', 'text'].map(s => (
                    <button key={s} onClick={() => handleShapeClick(s)} className={`py-3 flex items-center justify-center rounded-[8px] border transition-all ${holeType === s ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`}>
                      {s === 'circle' ? <Circle size={18} /> : s === 'square' ? <Square size={18} /> : s === 'cross-star' ? <CrossStarIcon size={18} /> : s === 'heart' ? <Heart size={18} /> : s === 'star' ? <Star size={18} /> : s === 'flower' ? <span className="text-lg font-bold font-sans leading-none">❋</span> : s === 'love' ? <span className="text-xs font-black font-mono tracking-tighter leading-none">&lt;3</span> : s === 'vortex' ? <VortexIcon size={18} /> : s === 'random-num' ? <span className="text-sm font-bold font-sans leading-none tracking-tight">(9)</span> : GLYPH_HOLES[s] ? <span className="text-lg font-bold font-sans leading-none">{GLYPH_HOLES[s]}</span> : <Type size={18} />}
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
                    {/* 捲到底時輸入框下面還留一點空隙，不會貼著邊 */}
                    <div className="h-6" />
                  </div>
                )}
              </div>}
              {activeTab === 'mask' && <div className="max-w-md mx-auto space-y-3 pb-4 animate-in fade-in duration-300">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between bg-[#111] p-3 border border-[#222] rounded-[8px] h-[52px]">
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
                  <div className="flex items-center justify-between bg-[#111] p-3 border border-[#222] rounded-[8px] cursor-pointer hover:bg-[#151515] transition-colors h-[52px]" onClick={() => setColorPickerTarget('mask')}>
                    <span className="text-[10px] font-bold text-[#888]">顏色</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-white/40">{maskColor}</span>
                      <div className="w-6 h-5 rounded-[4px] shadow-inner border border-white/10" style={{ backgroundColor: maskColor }} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between bg-[#111] p-3 border border-[#222] rounded-[8px]">
                  <span className="text-[10px] font-bold text-[#888]">紋理</span>
                  <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                    {['none', 'dot'].map(t => (
                      <button key={t} onClick={() => setPatternType(t)} className={`px-4 py-1 text-[10px] font-bold rounded-[2px] transition-all ${patternType === t ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'}`}>{t === 'none' ? '無' : '點點'}</button>
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
  return (
    <div className={`w-5 h-5 rounded-[2px] border ${active ? 'border-white scale-110 shadow-lg' : 'border-[#333]'} relative overflow-hidden transition-all shrink-0`}>
      <div className={`absolute transition-colors ${active ? 'bg-white' : 'bg-[#333]'} ${pos === 'top' ? 'top-0 left-0 right-0 h-1/2' : pos === 'bottom' ? 'bottom-0 left-0 right-0 h-1/2' : pos === 'left' ? 'top-0 left-0 bottom-0 w-1/2' : 'top-0 right-0 bottom-0 w-1/2'}`} />
    </div>
  );
};
