
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { isNative } from '../utils/native';
import { nativeCamera, captureNative, lutFileName, RAW_PROTECT_EV, stampDateOnto, rawDevelopPreview, type RawLook } from '../utils/nativeCamera';
import { lutMaxAmount, lutDefaultAmount } from '../utils/photoFx';
import { haptic, dialHaptic } from '../utils/haptics';
import { nativePhotos } from '../utils/nativePhotos';
import { nativeImage } from '../utils/nativeImage';
import { punchThrough } from '../utils/nativePreview';
import { Icon } from './Icon';
import { CameraSettings } from '../types';
import { GalleryOverlay } from './GalleryOverlay';
import { usePhotoThumbs, thumbFromCanvas } from '../utils/photoThumbs';
import { Viewfinder, FX_ZERO, type ViewfinderFx } from './Viewfinder';
import { ImageEditor, DEFAULT_PARAMS } from './ImageEditor';
import { createPortal } from 'react-dom';
import { slideBack } from '../utils/pageTransition';
import { fileSrc, nativePathOf, rememberNativePath } from '../utils/nativeBridge';
import { processImageFile } from '../utils/imageLoader';
import { RAW_ACCEPT } from '../utils/fileTypes';
import {CAMERA_FX_ITEMS} from '../utils/cameraEffects';
import { dateStampText } from '../utils/dateStamp';
import {preferCameraResolution} from '../utils/cameraPreview';

// MediaStream 型別補上 zoom
declare global {
  interface MediaTrackCapabilities {
    zoom?: { min: number; max: number };
  }
  interface MediaTrackConstraintSet {
    zoom?: number;
  }
}

type AspectRatio = '3:2' | '4:3' | '1:1' | '16:9';
/** 點一下比例鍵的輪替順序。4:3 是感光元件的原生比例（完全不裁切）。 */
const ASPECT_CYCLE: AspectRatio[] = ['3:2', '4:3', '1:1', '16:9'];
/** 直式時「寬 ÷ 高」 */
const PORTRAIT_RATIO: Record<AspectRatio, number> = { '3:2': 2 / 3, '4:3': 3 / 4, '1:1': 1, '16:9': 9 / 16 };
type TimerMode = 0 | 3 | 10;
type ActiveControl = 'none' | 'kelvin' | 'exposure' | 'filters' | 'effects';

/* 五種即時特效只切換開關；預覽和快門共用 WebGL 管線。
   柔光ll、低保真的初始參數直接讀取編輯器定義。 */
const FX_ITEMS = CAMERA_FX_ITEMS;

/** 變焦按鈕上寫幾倍就真的是幾倍 */
const ZOOM_STEPS: { label: string; factor: number; mm: string }[] = [
  { label: '0.5x', factor: 0.5, mm: '13mm' },
  { label: '1.0x', factor: 1.0, mm: '24mm' },
  { label: '2.0x', factor: 2.0, mm: '48mm' },
  { label: '3.0x', factor: 3.0, mm: '77mm' },
];

/**
 * 相機照片用高品質 JPEG：相同解析度的記憶體與編碼時間都遠低於 PNG，iOS 不會
 * 因第二張仍在主執行緒壓 PNG 而整個介面卡住。Safari 偶爾不回呼 toBlob，必須
 * 自己截止；逾時後讓 finally 解鎖快門，不能永遠停在「拍攝中」。
 */
const canvasToBlobUrl = (cvs: HTMLCanvasElement, timeoutMs = 4500): Promise<string> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('toBlob timeout'))), timeoutMs);
    try {
      cvs.toBlob(
        b => finish(() => b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        /* 0.92：跟品質 1 肉眼分不出差別，但檔案小 2–3 倍、編碼更快 ——
           Apple 相機與多數專業相機 App 的 JPEG 也落在這個區間。 */
        0.92,
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });

interface CameraInterfaceProps {
  onHome: () => void;
  lutList: { id: string, name: string, url: string }[];
  onImportNew?: () => void;
}

// 收哪些檔案：全 App 同一份清單（utils/fileTypes）

type CameraTickScaleProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onStep: (value: number, index: number) => void;
  /** 手指劃過整條刻度帶時走過幾倍的全範圍（越大越靈敏） */
  sensitivity?: number;
};

/** 與構圖「梯形」同款：拖的是整條刻度帶，當前刻度永遠吸附在中央。 */
const CameraTickScale: React.FC<CameraTickScaleProps> = ({
  label, value, min, max, step, onStep, sensitivity = 2.16,
}) => {
  const dragRef = useRef<{ startX: number; startValue: number; width: number } | null>(null);
  const [visualValue, setVisualValue] = useState<number | null>(null);
  const total = Math.max(1, Math.round((max - min) / step));
  const shown = Math.max(min, Math.min(max, visualValue ?? value));
  const activeIndex = Math.max(0, Math.min(total, Math.round((shown - min) / step)));
  const finish = useCallback((el?: HTMLDivElement, pointerId?: number) => {
    dragRef.current = null;
    if (el && pointerId !== undefined) {
      try { el.releasePointerCapture(pointerId); } catch { /* already released */ }
    }
    setVisualValue(null);
  }, []);
  return (
    <div
      className="relative h-12 flex-1 min-w-0 max-w-[214px] overflow-hidden cursor-ew-resize select-none"
      style={{ touchAction: 'none' }}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = Math.max(min, Math.min(max, value + (e.key === 'ArrowLeft' ? -step : step)));
        const index = Math.round((next - min) / step);
        onStep(min + index * step, index);
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = {
          startX: e.clientX,
          startValue: value,
          width: Math.max(1, e.currentTarget.getBoundingClientRect().width),
        };
        setVisualValue(value);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const raw = Math.max(min, Math.min(max,
          /* 同一段手指距離改成原本的兩倍靈敏度。仍然在 min/max 內逐格吸附，
             所以加快反應不會犧牲中央刻度的精準度。 */
          drag.startValue + ((drag.startX - e.clientX) / drag.width) * (max - min) * sensitivity));
        const index = Math.max(0, Math.min(total, Math.round((raw - min) / step)));
        const snapped = min + index * step;
        /* 相機刻度必須真的「卡」在中央刻度上。舊版雖然把數值 round 了，
           刻度帶卻仍用 raw 小數位移，所以中央最長線會落在中心左右約 3px，
           曝光看起來尤其明顯。視覺與輸出改成共用同一個 snapped 值。 */
        setVisualValue(snapped);
        onStep(snapped, index);
      }}
      onPointerUp={(e) => finish(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => finish(e.currentTarget, e.pointerId)}
    >
      {Array.from({ length: total + 1 }, (_, index) => {
          const tickValue = min + index * step;
          const offset = ((tickValue - shown) / step) * 6;
          if (Math.abs(offset) > 190) return null;
          const major = index % 10 === 0;
          const zero = Math.abs(tickValue) < step / 2;
          const selected = index === activeIndex;
          const baseHeight = zero ? 19 : (major ? 17 : 10);
          const baseOpacity = zero ? .68 : (major ? .52 : .28);
          return (
            <i
              key={index}
              data-camera-tick={selected ? 'active' : undefined}
              className="absolute bottom-0 w-px bg-white rounded-full pointer-events-none"
              style={{
                left: `calc(50% + ${offset}px)`,
                height: selected ? 27 : baseHeight,
                opacity: selected ? 1 : baseOpacity,
                transform: 'translateX(-50%)',
                transition: selected
                  ? 'none'
                  : `height 280ms cubic-bezier(0.22,1,0.36,1), opacity 280ms ease${visualValue === null ? ', left 180ms cubic-bezier(0.2,0.8,0.2,1)' : ''}`,
              }}
            />
          );
        })}
    </div>
  );
};

/** 小框構圖的最大倍率：框最小是畫面的 1/4 邊長（再小就拍不出能用的解析度） */
const SMALL_FRAME_MAX = 4;

type SmallFrameApi = { set: (zoom: number, pinching: boolean) => void };

/**
 * 小框構圖（跟 Dazz 同款）：雙指縮放時不放大畫面，而是在畫面中央出現一個
 * 跟目前比例一樣的白框，框外稍微變暗；拍下去只留框裡的部分。
 * 縮放中框的正中央顯示這個框等於多少焦段。
 *
 * 自己是一個小元件、由父層透過 ref 推數值：捏的過程中每一格只重畫這一小塊，
 * 不會把整個相機介面（濾鏡列、按鈕…）一起重畫，手勢才跟得上 60fps。
 */
const SmallFrameOverlay = React.memo(React.forwardRef<SmallFrameApi, { baseMm: number }>(({ baseMm }, ref) => {
  const [zoom, setZoom] = useState(1);
  const [pinching, setPinching] = useState(false);
  React.useImperativeHandle(ref, () => ({
    set: (z, p) => { setZoom(z); setPinching(p); },
  }), []);
  const on = zoom > 1.001;
  const pct = 100 / Math.max(1, zoom);
  return (
    <div className="absolute inset-0 z-[15] pointer-events-none" aria-hidden="true">
      {/* 框：白色細線；框外用一圈很大的陰影壓暗（外層 overflow-hidden 會把它裁在畫面裡） */}
      <div
        data-camera-small-frame={on ? 'on' : 'off'}
        className="absolute left-1/2 top-1/2"
        style={{
          width: `${pct}%`, height: `${pct}%`,
          transform: 'translate(-50%, -50%)',
          // 跟觀景窗同一個圓角（rounded-camera＝12px），框外的暗色也跟著圓角走
          borderRadius: 12,
          boxShadow: '0 0 0 1.5px rgba(255,255,255,0.95), 0 0 0 200vmax rgba(0,0,0,0.42)',
          opacity: on ? 1 : 0,
          transition: 'opacity 260ms cubic-bezier(0.2,0,0,1)',
          willChange: 'width, height, opacity',
        }}
      />
      {/* 焦段：只在縮放的過程中出現，放手後慢慢淡掉 */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ opacity: pinching ? 1 : 0, transition: pinching ? 'opacity 160ms ease-out' : 'opacity 420ms ease-in 380ms' }}
      >
        <span data-camera-small-frame-mm className="text-sm font-medium text-white tracking-[0.1em] leading-none tabular-nums select-none mr-[-0.1em] [text-shadow:0_1px_2px_rgba(0,0,0,0.45)]">
          {Math.round(baseMm * Math.max(1, zoom))}mm
        </span>
      </div>
    </div>
  );
}));

/* 相機的相簿：存在相機頁外面（模組層級），離開相機再進來照片都還在（App 沒被關掉之前）。
   照片網址、RAW、日期、愛心、濾鏡標籤、縮圖都在這裡，相機頁卸載時不能回收。 */
const camRoll = {
  photos: [] as string[],
  rawOf: new Map<string, { path: string; protectEV: number; look: RawLook }>(),
  rawShots: new Set<string>(),
  dateOf: new Map<string, { clean: string; date: string }>(),
  favorites: new Set<string>(),
  labels: new Map<string, string>(),
  owned: new Set<string>(),
  thumbs: {} as Record<string, string>,
  loaded: false,
};

/* 相機的相簿存到手機上（只記檔案路徑，照片本身在原生的相機相簿資料夾）：關掉 App、更新 App 之後還在 */
const ROLL_KEY = 'abai-camera-roll-v1';
type RollEntry = { path: string; raw?: { path: string; protectEV: number; look: RawLook }; clean?: { path: string; date: string }; fav?: boolean; label?: string };
/* App 更新後，整個 App 資料夾的路徑會換（裡面的檔案都還在）。記住的路徑一律接到「相簿資料夾現在的位置」上 */
const KEEP_KEY = 'abai-keep-dir';
const KEEP_SEG = '/abai-camera-roll/';
let keepDirNow: string | null = (() => { try { return localStorage.getItem(KEEP_KEY); } catch { return null; } })();
const remapKeep = (p: string) => {
  const i = p.indexOf(KEEP_SEG);
  return i < 0 || !keepDirNow ? p : keepDirNow.replace(/\/+$/, '') + p.slice(i + KEEP_SEG.length - 1);
};
/** 問原生相簿資料夾現在在哪、哪些照片檔案已經不在了（很早以前存在暫存區、被系統清掉的）。
    有變動就把手機上的清單修好、回 true，呼叫端要重新讀一次相簿 */
async function refreshKeepDir(): Promise<boolean> {
  try {
    const img = await nativeImage();
    if (!img?.keepDir) return false;
    const r = await img.keepDir();
    let changed = false;
    if (r?.path && r.path !== keepDirNow) {
      keepDirNow = r.path; changed = true;
      try { localStorage.setItem(KEEP_KEY, r.path); } catch { /* 存不了就下次再問 */ }
    }
    const list = JSON.parse(localStorage.getItem(ROLL_KEY) || '[]') as RollEntry[];
    if (!Array.isArray(list) || !list.length) return changed;
    const fixed = list.filter(e => e?.path).map(e => remapKeep(e.path));
    const { missing = [] } = await img.keepDir({ paths: fixed });
    if (missing.length) {
      const gone = new Set(missing);
      localStorage.setItem(ROLL_KEY, JSON.stringify(list.filter(e => e?.path && !gone.has(remapKeep(e.path)))));
      changed = true;
    }
    return changed;
  } catch { return false; }
}
/** 重新從手機上的清單讀一次（路徑換過了）。容器原地清空重填：拿著它們的 ref 不用換 */
function reloadCamRoll() {
  camRoll.photos = [];
  camRoll.rawOf.clear(); camRoll.rawShots = new Set(); camRoll.dateOf.clear();
  camRoll.favorites = new Set(); camRoll.labels.clear();
  for (const k of Object.keys(camRoll.thumbs)) delete camRoll.thumbs[k];
  camRoll.loaded = false;
  loadCamRoll();
}
function loadCamRoll() {
  if (camRoll.loaded) return;
  camRoll.loaded = true;
  try {
    const list = JSON.parse(localStorage.getItem(ROLL_KEY) || '[]') as RollEntry[];
    if (!Array.isArray(list)) return;
    for (const e0 of list) {
      if (!e0?.path) continue;
      const e: RollEntry = { ...e0, path: remapKeep(e0.path),
        raw: e0.raw?.path ? { ...e0.raw, path: remapKeep(e0.raw.path) } : e0.raw,
        clean: e0.clean?.path ? { ...e0.clean, path: remapKeep(e0.clean.path) } : e0.clean };
      const url = fileSrc(e.path); rememberNativePath(url, e.path);
      camRoll.photos.push(url);
      if (e.raw?.path) { camRoll.rawOf.set(url, e.raw); camRoll.rawShots.add(url); }
      if (e.clean?.path) { const cu = fileSrc(e.clean.path); rememberNativePath(cu, e.clean.path); camRoll.dateOf.set(url, { clean: cu, date: e.clean.date }); }
      if (e.fav) camRoll.favorites.add(url);
      if (e.label) camRoll.labels.set(url, e.label);
    }
  } catch { /* 讀不到就從空的開始 */ }
}
function saveCamRoll() {
  try {
    const list: RollEntry[] = [];
    for (const url of camRoll.photos) {
      const path = nativePathOf(url);
      if (!path) continue;   // 不是原生檔案的（網頁相機拍的）存不住，只留在這一次
      const d = camRoll.dateOf.get(url), cleanPath = d ? nativePathOf(d.clean) : undefined;
      list.push({ path, raw: camRoll.rawOf.get(url), clean: d && cleanPath ? { path: cleanPath, date: d.date } : undefined,
        fav: camRoll.favorites.has(url) || undefined, label: camRoll.labels.get(url) });
    }
    localStorage.setItem(ROLL_KEY, JSON.stringify(list));
  } catch { /* 存不了就算了 */ }
}

export const CameraInterface: React.FC<CameraInterfaceProps> = ({ onHome, lutList, onImportNew }) => {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [captureNotice, setCaptureNotice] = useState('');
  useEffect(() => {
    if (!captureNotice) return;
    const timer = window.setTimeout(() => setCaptureNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [captureNotice]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewfinderRef = useRef<{
    getCanvas: () => HTMLCanvasElement | null;
    isLutReady?: () => boolean;
    maxTextureSize?: () => number;
    renderStill?: (src: TexImageSource, w: number, h: number) => HTMLCanvasElement | null;
    releaseStill?: () => void;
    restorePreview?: () => void;
  }>(null);
  
  // 邏輯上的鏡頭方向跟畫面上的分開記，切換時才不會閃一下翻轉
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [visualFacingMode, setVisualFacingMode] = useState<'user' | 'environment'>('environment');
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  // 用 ref 存串流，卸載時一定收得掉
  const streamRef = useRef<MediaStream | null>(null);

  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [capabilities, setCapabilities] = useState<MediaTrackCapabilities | null>(null);

  const [settings, setSettings] = useState<CameraSettings>({
    kelvin: 5500,
    focalLength: '1.0x',
    exposure: '0.0'
  });
  
  const [activeControl, setActiveControl] = useState<ActiveControl>('none');
  const [selectedLutIdx, setSelectedLutIdx] = useState(0);
  const readPref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const writePref = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 私密模式 */ } };
  /** 日期戳記（橘紅色七段字，印在右下角） */
  const [dateOn, setDateOnState] = useState(() => readPref('abai-camera-date') === '1');
  const setDateOn = (on: boolean) => { setDateOnState(on); writePref('abai-camera-date', on ? '1' : null); };
  /** 保留原始圖片：成品之外，原始的那張也存進手機相簿（開 RAW：真正的 RAW 檔；沒開 RAW：沒套濾鏡的原圖） */
  const [keepOriginal, setKeepOriginalState] = useState(() => readPref('abai-camera-keep-original') === '1');
  const setKeepOriginal = (on: boolean) => { setKeepOriginalState(on); writePref('abai-camera-keep-original', on ? '1' : null); };
  const keepOriginalRef = useRef(keepOriginal); keepOriginalRef.current = keepOriginal;
  const [fx, setFx] = useState<ViewfinderFx>(FX_ZERO);
  const fxOn = FX_ITEMS.some(item => fx[item.id] > 0);

  const [flashOn, setFlashOn] = useState(false);
  /* 專業模式（只有 App 裡有）：原生相機，4800 萬像素、ProRAW、零快門延遲、相機控制按鈕。
     觀景窗由原生畫、即時套濾鏡；即時特效在這個模式不套用。 */
  const [proAvailable, setProAvailable] = useState(false);
  const [proRawSupported, setProRawSupported] = useState(false);
  /* App 裡一律用原生相機（真正的閃光燈、真正的拍照）；特效也在原生觀景窗上畫，切換不會重開相機。
     只有原生相機開不起來時才退回網頁相機。可以另外開的是 RAW。 */
  const [proPreferred, setProPreferred] = useState(true);
  const proMode = proAvailable && proPreferred;
  const [proRaw, setProRaw] = useState(false);
  /** 拍出來的照片 → 同一張的 RAW 檔（App 暫存裡的 DNG）＋拍的時候用的濾鏡。
      編輯時從 RAW 沖，再自動套上同一個濾鏡（RAW 檔本身是感光元件的原始資料，存不進濾鏡） */
  const rawOfRef = useRef(camRoll.rawOf);
  const [rawShots, setRawShots] = useState<Set<string>>(() => { loadCamRoll(); return new Set(camRoll.rawShots); });
  useEffect(() => { camRoll.rawShots = rawShots; saveCamRoll(); }, [rawShots]);
  /** 有日期戳記的照片 → 沒印日期的同一張＋日期字。編輯一律改沒印的那張，存檔時才重新印上日期：
      調色、濾鏡不會改到日期；日期是光加上去的，畫面調暗了字自然更清楚 */
  const dateOfRef = useRef(camRoll.dateOf);
  const forgetDate = (url: string) => {
    const d = dateOfRef.current.get(url); if (!d) return;
    dateOfRef.current.delete(url);
    if (ownedUrlsRef.current.has(d.clean)) { URL.revokeObjectURL(d.clean); ownedUrlsRef.current.delete(d.clean); }
  };
  const forgetRaw = (url: string) => {
    if (!rawOfRef.current.delete(url)) return;
    setRawShots(prev => { const n = new Set(prev); n.delete(url); return n; });
  };
  const proModeRef = useRef(false); proModeRef.current = proMode;
  /* App 裡先確定有沒有原生相機，再決定要不要開網頁相機：不然一進來會先開網頁相機、馬上又換掉，畫面閃一下 */
  const [proProbed, setProProbed] = useState(() => !isNative());
  /** 原生相機開起來後回報的：這顆鏡頭有沒有閃光燈（前鏡頭是螢幕補光） */
  const [nativeFlash, setNativeFlash] = useState(false);
  const proProbedRef = useRef(proProbed); proProbedRef.current = proProbed;

  useEffect(() => {
    if (!isNative()) return;
    let done = false;
    const finish = () => { if (!done) { done = true; setProProbed(true); } };
    const t = setTimeout(finish, 2500);
    void nativeCamera()
      .then(c => c ? c.available().then(r => { setProAvailable(!!r.available); setProRawSupported(!!r.proRAW); }) : undefined)
      .catch(() => {})
      .finally(() => { clearTimeout(t); finish(); });
  }, []);
  
  // 預設比例 3:2
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:2');
  
  const [timer, setTimer] = useState<TimerMode>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  /* 右上角「⋯」選單裡的設定（記住，下次開相機照舊） */
  const prefGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const prefSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 私密模式 */ } };
  /** 水平儀：畫面中間一條線，手機擺平時變黃 */
  const [levelOn, setLevelOnState] = useState(() => prefGet('abai-camera-level') === '1');
  const setLevelOn = (v: boolean) => { setLevelOnState(v); prefSet('abai-camera-level', v ? '1' : null); };
  /** 位置：拍照時把地點寫進照片 */
  const [locationOn, setLocationOnState] = useState(() => prefGet('abai-camera-location') === '1');
  const setLocationOn = (v: boolean) => { setLocationOnState(v); prefSet('abai-camera-location', v ? '1' : null); };
  /** 縮放模式：全螢幕＝雙指直接放大縮小（跟內建相機一樣）；線框＝雙指捏出小框構圖 */
  /* 預設是全螢幕；只有自己在選單裡改成線框才記住線框（換了新的 key，舊版預設存下來的「線框」不算數） */
  const [zoomMode, setZoomModeState] = useState<'full' | 'frame'>(() => prefGet('abai-camera-zoom-mode-v2') === 'frame' ? 'frame' : 'full');
  const setZoomMode = (v: 'full' | 'frame') => { setZoomModeState(v); prefSet('abai-camera-zoom-mode-v2', v === 'frame' ? 'frame' : null); };
  useEffect(() => { prefSet('abai-camera-zoom-mode', null); }, []);
  const zoomModeRef = useRef(zoomMode); zoomModeRef.current = zoomMode;
  /** 全螢幕縮放：雙指捏到的倍率（介面倍率，1＝主鏡頭）。null＝停在按鈕的倍率上 */
  const [liveZoom, setLiveZoom] = useState<number | null>(null);
  const liveZoomRef = useRef<number | null>(null); liveZoomRef.current = liveZoom;
  const zoomSendRaf = useRef(0);
  // 磨皮已移除：清掉舊版記住的開關
  useEffect(() => { try { localStorage.removeItem('abai-camera-skin-v3'); } catch { /* 私密模式 */ } }, []);
  
  const [focalLengthMm, setFocalLengthMm] = useState<string | null>(null);
  const focalLengthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 小框構圖 ─────────────────────────────────────────────
     frameZoomRef：目前框的倍率（1 = 沒有框）。拍照時讀這個。
     捏的過程不走 React state（見 SmallFrameOverlay），放手時才定下來。 */
  const frameZoomRef = useRef(1);
  const smallFrameRef = useRef<SmallFrameApi>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ d0: number; z0: number; full?: boolean } | null>(null);
  /** 這一次觸控裡有沒有捏過 —— 有的話放手時不能當成「點一下對焦」 */
  const gesturePinchedRef = useRef(false);
  /** 捏完之後很短的時間內，瀏覽器補送的 click 也不能觸發對焦 */
  const focusGuardUntilRef = useRef(0);
  const pinchDist = () => {
    const pts = [...pointersRef.current.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };
  const onFramePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return;
    /* 第一根手指（isPrimary）＝新的一次觸控：清掉上一次沒收到放開事件的殘留手指。
       不清的話，殘留的那一筆會讓「一根手指」被當成兩指，單手就能拉動線框。 */
    if (e.isPrimary) { pointersRef.current.clear(); pinchRef.current = null; }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    /* 點過對焦之後單指上下拖：調曝光（對焦框旁出現一條曝光線，沒有太陽）。先記起點，移動夠多才算數 */
    evDraggedRef.current = false;
    evDragRef.current = pointersRef.current.size === 1
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, ev0: parseFloat(settingsExposureRef.current) || 0, active: false }
      : null;
    if (pointersRef.current.size === 2) {
      const d = pinchDist();
      if (d > 8 && zoomModeRef.current === 'full' && proModeRef.current) {
        /* 全螢幕縮放：從目前的倍率開始捏 */
        const cur = liveZoomRef.current ?? (ZOOM_STEPS.find(z => z.label === focalRef.current)?.factor ?? 1);
        pinchRef.current = { d0: d, z0: cur, full: true };
        gesturePinchedRef.current = true;
        if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; }
      } else if (d > 8) {
        pinchRef.current = { d0: d, z0: frameZoomRef.current };
        gesturePinchedRef.current = true;
        // 第二根手指下來就不是長按鎖定了
        if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; }
        smallFrameRef.current?.set(frameZoomRef.current, true);
      }
    }
  };
  const onFramePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (moveExposureDrag(e)) return;
    const p = pinchRef.current;
    // 只有兩根手指同時在畫面上才縮放（線框、全螢幕都一樣），單指拖動不做任何事
    if (!p || pointersRef.current.size !== 2) return;
    const d = pinchDist();
    if (!d) return;
    if (p.full) {
      /* 全螢幕縮放：兩指拉開＝放大（跟內建相機一樣），鏡頭真的變焦；一格最多送一次 */
      const r = nativeZoomRangeRef.current;
      const z = Math.max(r?.min ?? 1, Math.min(Math.min(r?.max ?? 10, 15), p.z0 * d / p.d0));
      liveZoomRef.current = z;
      setLiveZoom(z);
      if (!zoomSendRaf.current) zoomSendRaf.current = requestAnimationFrame(() => {
        zoomSendRaf.current = 0;
        const v = liveZoomRef.current; if (v == null) return;
        void nativeCamera().then(c => c?.setZoom({ uiZoom: v })).catch(() => {});
      });
      return;
    }
    // 框跟著手指走：兩指往內捏＝框往內縮，往外拉開＝框變大；拉回滿版框就消失
    const z = Math.max(1, Math.min(SMALL_FRAME_MAX, p.z0 * p.d0 / d));
    frameZoomRef.current = z;
    smallFrameRef.current?.set(z, true);
  };
  const onFramePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.delete(e.pointerId)) return;
    endExposureDrag(e.pointerId);
    if (pinchRef.current?.full && pointersRef.current.size < 2) {
      pinchRef.current = null;
      focusGuardUntilRef.current = performance.now() + 400;
    } else if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null;
      // 很接近 1 倍就直接收掉框，不留一條貼著邊的白線
      if (frameZoomRef.current < 1.04) frameZoomRef.current = 1;
      smallFrameRef.current?.set(frameZoomRef.current, false);
      focusGuardUntilRef.current = performance.now() + 400;
    }
    if (pointersRef.current.size === 0) setTimeout(() => { gesturePinchedRef.current = false; }, 0);
  };
  
  const [photos, setPhotos] = useState<string[]>(() => { loadCamRoll(); return camRoll.photos; });
  useEffect(() => { camRoll.photos = photos; saveCamRoll(); }, [photos]);
  const { thumbs, seed: seedThumb } = usePhotoThumbs(photos, camRoll.thumbs);
  /* 只回收自己建立的 blob 網址；匯入的、編輯回存的字串不要亂動 */
  const ownedUrlsRef = useRef(camRoll.owned);
  const releaseUrl = useCallback((url: string) => {
    if (ownedUrlsRef.current.has(url)) { URL.revokeObjectURL(url); ownedUrlsRef.current.delete(url); }
  }, []);
  /* 離開相機不回收：照片留在相機的相簿裡（camRoll），下次進來還在 */
  const [showGallery, setShowGallery] = useState(false);
  /** 相簿開始往下滑走（還沒滑完）：相機的按鈕這一刻就要放回來，滑完才出現會慢半拍 */
  const [galleryLeaving, setGalleryLeaving] = useState(false);
  useEffect(() => { if (!showGallery) setGalleryLeaving(false); }, [showGallery]);
  const galleryCover = showGallery && !galleryLeaving;
  const [editingPhoto, setEditingPhoto] = useState<{ src: string, index: number, init?: { params: typeof DEFAULT_PARAMS; selectedLutIdx: number } | null; pro?: boolean; batch?: string[]; /** 存檔時要重新印上的日期 */ date?: string; /** 從 RAW 沖洗接過來：直接出現在原位，不再從下面滑上來 */ instant?: boolean; /** 這張有 RAW：一般編輯直接在 RAW 上調 */ raw?: { path: string; protectEV: number; look: RawLook | null } } | null>(null);
  const [editorEntered, setEditorEntered] = useState(false);
  const [editorLeaving, setEditorLeaving] = useState(false);
  const editorExitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editingPhoto) { setEditorEntered(false); setEditorLeaving(false); return; }
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setEditorEntered(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [editingPhoto]);
  useEffect(() => () => { if (editorExitTimer.current) clearTimeout(editorExitTimer.current); }, []);
  const closeGalleryEditor = () => {
    if (editorLeaving) return;
    setEditorLeaving(true);
    editorExitTimer.current = setTimeout(() => { setEditingPhoto(null); setEditorLeaving(false); }, 460);
  };
  /* 相簿打開時（含大圖、RAW 沖洗）把原生觀景窗藏起來：後面任何透明的地方都不會透出相機畫面。
     相簿是從下面滑上來的，等它蓋滿再藏；關的時候先放回來再滑走 */
  useEffect(() => {
    if (!proMode) return;
    const hide = showGallery;
    const t = window.setTimeout(() => { void nativeCamera().then(c => c?.setPreviewHidden?.({ hidden: hide })).catch(() => {}); }, hide ? 420 : 0);
    return () => window.clearTimeout(t);
  }, [showGallery, proMode]);
  /* 相簿：愛心、每張拍照時用的濾鏡（大圖右上的標籤） */
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(camRoll.favorites));
  useEffect(() => { camRoll.favorites = favorites; saveCamRoll(); }, [favorites]);
  /* App 更新過（相簿資料夾換了位置）：路徑接到新位置、重新讀一次 */
  useEffect(() => {
    let alive = true;
    void refreshKeepDir().then(changed => {
      if (!alive || !changed) return;
      reloadCamRoll();
      setPhotos(camRoll.photos); setRawShots(new Set(camRoll.rawShots)); setFavorites(new Set(camRoll.favorites));
    });
    return () => { alive = false; };
  }, []);
  const labelsRef = useRef(camRoll.labels);
  /* 進相簿（或從相簿進編輯）就把小框收掉：回到相機時應該是重新開始的滿版畫面，
     不是停在上一次捏的位置。frameZoomRef 也一起歸 1，免得畫面上沒有框、拍下去卻還是裁過的。 */
  useEffect(() => {
    if (!showGallery && !editingPhoto) return;
    frameZoomRef.current = 1;
    pinchRef.current = null;
    smallFrameRef.current?.set(1, false);
    pushDateRef.current();
  }, [showGallery, editingPhoto]);
  const [editorId, setEditorId] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isImportingLocal, setIsImportingLocal] = useState(false);
  const [localImportPreviewUrl, setLocalImportPreviewUrl] = useState<string | null>(null);

  const [focusPoint, setFocusPoint] = useState<{ x: number, y: number, nonce: number } | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocusEventRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const lastCameraTickRef = useRef<string>('');
  const focusPointRef = useRef(focusPoint); focusPointRef.current = focusPoint;

  const EV_PX_PER_EV = 160;  // 手指走幾 px 算 1 EV（±2 EV 全程跟以前 ±1 EV 一樣長）
  /** 曝光範圍：跟原相機一樣 ±2 EV */
  const EV_MAX = 2;
  const EV_LINE = 64;        // 曝光線上、下各多長；線上的空隙從一端走到另一端＝-EV_MAX 到 +EV_MAX
  const EV_SLOP = 8;         // 先走這麼多才算開始拖（避免點一下時手指微晃就改到曝光）
  const evDragRef = useRef<{ id: number; x: number; y: number; ev0: number; active: boolean } | null>(null);
  /** 這一次觸控有拖過曝光：放手時不當成點擊對焦 */
  const evDraggedRef = useRef(false);
  const [evDragging, setEvDragging] = useState(false);
  /** 這次對焦有拖過曝光：曝光線＋太陽留著，放手 1 秒後跟對焦框一起淡掉（單純點對焦不出現太陽） */
  const [evShown, setEvShown] = useState(false);
  /* 手機怎麼拿（原生相機用重力感應回報；介面本身鎖在直的）：0 直拿、1 頂端朝左、3 頂端朝右。
     圖示跟著轉正（跟內建相機一樣滑順地轉過去），橫拿拍出來是橫的照片，日期也印在那張照片的長邊上 */
  const [uiTurns, setUiTurns] = useState(0);
  const uiTurnsRef = useRef(0); uiTurnsRef.current = uiTurns;
  const uiAngle = uiTurns === 1 ? 90 : uiTurns === 3 ? -90 : 0;
  const settingsExposureRef = useRef('0.0'); settingsExposureRef.current = settings.exposure;
  const hideFocusLater = (ms: number) => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => { setFocusPoint(null); focusTimerRef.current = null; }, ms);
  };
  const moveExposureDrag = (e: React.PointerEvent<HTMLDivElement>): boolean => {
    const d = evDragRef.current;
    if (!d || d.id !== e.pointerId || pointersRef.current.size !== 1 || pinchRef.current) return false;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.active) {
      // 要先有對焦框（點過對焦）才能拖；直向明顯大於橫向才算
      if (!focusPointRef.current || Math.abs(dy) < EV_SLOP || Math.abs(dy) < Math.abs(dx) * 1.2) return false;
      d.active = true;
      // 從越過門檻的那一點開始算，不會一開始就跳一格
      d.y = e.clientY;
      evDraggedRef.current = true;
      if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; }
      if (focusTimerRef.current) { clearTimeout(focusTimerRef.current); focusTimerRef.current = null; }
      setEvDragging(true); setEvShown(true);
      return true;
    }
    /* 連續的值（存到小數第二位就夠細，不會一格一格跳） */
    const n = Math.max(-EV_MAX, Math.min(EV_MAX, d.ev0 - (e.clientY - d.y) / EV_PX_PER_EV));
    const r = Math.round(n * 100) / 100;
    const val = `${r > 0 ? '+' : ''}${r.toFixed(2)}`;
    if (val !== settingsExposureRef.current) {
      settingsExposureRef.current = val;   // 拖對焦框旁的太陽調曝光：不震
      setSettings(prev => ({ ...prev, exposure: val }));
    }
    return true;
  };
  const endExposureDrag = (id: number) => {
    const d = evDragRef.current;
    if (!d || d.id !== id) return;
    evDragRef.current = null;
    if (d.active) { setEvDragging(false); hideFocusLater(1400); }
  };
  
  const localFileInputRef = useRef<HTMLInputElement>(null);

  // 量容器大小，比例切換時才能平順過渡
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({ 
          w: entry.contentRect.width, 
          h: entry.contentRect.height 
        });
      }
    });
    
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
  }, []);

  // 啟動相機
  useEffect(() => {
    let mounted = true;
    const startCamera = async () => {
      // 開新的串流前先停掉舊的（從 ref 拿，比較保險）
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      // 專業模式由原生相機接手，網頁這邊不開串流（同一時間只能有一方用相機）
      if (proModeRef.current || !proProbedRef.current) { streamRef.current = null; return; }
      
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            /* 先向瀏覽器要求感光元件最接近原生照片的 4:3、高解析度串流。
               ideal 不是硬性條件：舊 iPhone／WebView 做不到時會自動給裝置最高可用值，
               不會像 exact 那樣直接讓相機啟動失敗。限制 30fps 是把頻寬優先留給解析度。 */
            facingMode: { ideal: facingMode },
            width: { ideal: 4096 },
            height: { ideal: 3072 },
            aspectRatio: { ideal: 4 / 3 },
            frameRate: { ideal: 30, max: 30 },
            resizeMode: { ideal: 'none' },
          } as MediaTrackConstraints,
          audio: false
        };

        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
           mediaStream = await navigator.mediaDevices.getUserMedia({
             ...constraints,
             video: { facingMode, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30, max: 30 } }
           });
        }

        if (!mounted) {
            // 等待中元件已經卸載的話，立刻停掉串流
            mediaStream.getTracks().forEach(t => t.stop());
            return;
        }

        setStream(mediaStream);
        streamRef.current = mediaStream; // 更新 ref
        
        const vTrack = mediaStream.getVideoTracks()[0];
        await preferCameraResolution(vTrack,viewfinderRef.current?.maxTextureSize?.()??4096);
        if(!mounted){mediaStream.getTracks().forEach(t=>t.stop());return;}
        setVideoTrack(vTrack);
        /* 有些 Android 是「軌道真的跑起來之後」才把 torch／zoom 這些能力填進去，
           開機那一瞬間問會拿到空的 —— 結果就是明明有閃光燈卻顯示沒有。
           所以隔一下再問幾次。getCapabilities 在部分瀏覽器不存在，要先確認。 */
        const readCaps = () => {
          if (!mounted) return;
          try {
            if (typeof (vTrack as any).getCapabilities === 'function') {
              setCapabilities(vTrack.getCapabilities());
            }
          } catch { /* 問不到就維持原本的 */ }
        };
        readCaps();
        setTimeout(readCaps, 500);
        setTimeout(readCaps, 1500);

        if (videoEl) {
          videoEl.srcObject = mediaStream;
          videoEl.onloadedmetadata = () => {
             if (mounted) {
                 videoEl.play().catch(e => console.error("Video play error:", e));
                 setVisualFacingMode(facingMode); 
             }
          };
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        // 退而求其次
        if (!streamRef.current && mounted) {
             try {
                const basicStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                if (mounted) {
                    setStream(basicStream);
                    streamRef.current = basicStream; // 更新 ref
                    const basicTrack=basicStream.getVideoTracks()[0];
                    await preferCameraResolution(basicTrack,viewfinderRef.current?.maxTextureSize?.()??4096);
                    if(!mounted){basicStream.getTracks().forEach(t=>t.stop());return;}
                    setVideoTrack(basicTrack);
                    if (videoEl) {
                        videoEl.srcObject = basicStream;
                        videoEl.play();
                        setVisualFacingMode(facingMode);
                    }
                } else {
                    basicStream.getTracks().forEach(t => t.stop());
                }
             } catch(e) {}
        }
      }
    };
    startCamera();
    
    return () => {
        mounted = false;
        // 卸載時從 ref 停掉所有 track，馬上把相機權限還回去
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
        if (videoEl) {
            videoEl.srcObject = null;
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode, videoEl, proMode, proProbed]);

  /* ---------- 閃光燈 ----------
     網頁連拍管線只使用不會暫停串流的 torch 約束。ImageCapture.takePhoto
     雖然有裝置能同步硬體閃光，但也正是部分行動 WebView 拍第二張會鎖死的來源；
     所以沒有 torch 就明確停用，不顯示一顆實際不會補光的按鈕。 */
  /* 注意是比對「值」不是「有沒有這個鍵」：部分裝置會列出 torch 但值是 false，
     只看鍵存不存在的話會誤判成有閃光燈，按下去卻什麼都不會發生。 */
  const hasTorch = (capabilities as any)?.torch === true;
  /* 原生相機：後鏡頭是真的閃光燈（拍的那一下才閃，會先預閃測光），前鏡頭是螢幕補光 */
  const flashAvailable = proMode ? nativeFlash : hasTorch;

  /* 沒有閃光燈的鏡頭就把開關關掉，不然按鈕亮著卻不會亮燈 */
  useEffect(() => { if (!flashAvailable && flashOn) setFlashOn(false); }, [flashAvailable, flashOn]);

  const setTorch = useCallback(async (on: boolean) => {
    if (!videoTrack || !hasTorch) return false;
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: on } as any] });
      return true;
    } catch (e) { return false; }
  }, [videoTrack, hasTorch]);

  /* 離開相機時務必把手電筒關掉，不然會一直亮著 */
  useEffect(() => () => { setTorch(false); }, [setTorch]);

  /* 硬體變焦能做多少就做多少，剩下的用數位變焦補上，
     所以按鈕上寫 2.0x 看到的就真的是 2 倍。 */
  const [digitalZoom, setDigitalZoom] = useState(1);
  const hwZoom = capabilities?.zoom;
  /** 沒有超廣角鏡頭時 0.5x 是做不到的（數位變焦只能放大不能變廣） */
  /* 原生相機：開相機時回報這顆鏡頭的倍率範圍（介面倍率，1＝主鏡頭）。網頁相機才看串流的 zoom 能力 */
  const [nativeZoomRange, setNativeZoomRange] = useState<{ min: number; max: number } | null>(null);
  const nativeZoomRangeRef = useRef(nativeZoomRange); nativeZoomRangeRef.current = nativeZoomRange;
  const canWide = proMode ? !!nativeZoomRange && nativeZoomRange.min < 0.99 : !!hwZoom && (hwZoom.min ?? 1) < 1;

  /* 變焦平滑過渡：從目前倍率用 ease-out 在約 0.32 秒內推到目標（像原生相機的變焦轉盤），不是直接跳過去。
     每一格把總倍率拆成「硬體能做的」＋「剩下的數位變焦」；硬體約束上一個還沒套用完就先不送下一個，不會塞車 */
  const zoomNowRef = useRef(1);
  const zoomAnimRef = useRef(0);
  const hwBusyRef = useRef(false);
  const hwWantRef = useRef<number | null>(null);
  const applyZoom = useCallback((zoomFactor: string) => {
    const want = ZOOM_STEPS.find(z => z.label === zoomFactor)?.factor ?? 1;
    const min = hwZoom?.min ?? 1;
    const max = hwZoom?.max ?? 1;
    const pushHw = (hw: number) => {
      if (!videoTrack || !hwZoom) return;
      hwWantRef.current = hw;
      if (hwBusyRef.current) return;
      const send = () => {
        const v = hwWantRef.current; hwWantRef.current = null;
        if (v == null) { hwBusyRef.current = false; return; }
        hwBusyRef.current = true;
        let p: Promise<void> | undefined;
        try { p = videoTrack.applyConstraints({ advanced: [{ zoom: v } as any] }); } catch { p = undefined; }
        (p || Promise.resolve()).catch(() => {}).then(send);
      };
      send();
    };
    const setAt = (z: number) => {
      zoomNowRef.current = z;
      const hw = hwZoom ? Math.max(min, Math.min(max, z)) : 1;
      // 硬體只到 2 倍、想要 3 倍的話，剩下的 1.5 倍交給數位變焦
      setDigitalZoom(Math.max(1, z / hw));
      pushHw(hw);
    };
    cancelAnimationFrame(zoomAnimRef.current);
    const from = zoomNowRef.current;
    if (Math.abs(from - want) < 1e-3) { setAt(want); return; }
    const t0 = performance.now(), dur = 320;
    // 用對數空間插值：1→2 和 2→4 看起來一樣快
    const la = Math.log(from), lb = Math.log(want);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      setAt(Math.exp(la + (lb - la) * e));
      if (k < 1) zoomAnimRef.current = requestAnimationFrame(step);
    };
    zoomAnimRef.current = requestAnimationFrame(step);
  }, [videoTrack, hwZoom]);
  useEffect(() => () => cancelAnimationFrame(zoomAnimRef.current), []);

  useEffect(() => {
    applyZoom(settings.focalLength);
  }, [settings.focalLength, applyZoom]);

  /* 換鏡頭之後 0.5x 可能就沒了，停在做不到的倍率會看起來像壞掉 */
  useEffect(() => {
    if (!canWide && settings.focalLength === '0.5x') {
      setSettings(prev => ({ ...prev, focalLength: '1.0x' }));
    }
  }, [canWide, settings.focalLength]);

  const toggleCamera = () => {
    triggerHaptic();
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };
  
  const triggerHaptic = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(8);
    }
  };

  /** 刻度轉盤：同一格只算一次。App 裡每一格都有段落感（網頁版保持安靜）：
   *  曝光每 0.1 EV 一下、整數 EV 和 0 明顯一點；白平衡每 100K 一下、整千和預設 5500K 明顯一點；到頭是擋塊 */
  const triggerCameraTick = useCallback((control: 'kelvin' | 'exposure', index: number) => {
    const key = `${control}:${index}`;
    if (lastCameraTickRef.current === key) return;
    lastCameraTickRef.current = key;
    if (control === 'exposure') dialHaptic(index, 21, index % 10 === 0);
    else { const k = 2500 + index * 100; dialHaptic(index, 66, k % 1000 === 0 || k === 5500); }
  }, []);

  /** 目前鏡頭的等效焦段（小框構圖的焦段＝這個 × 框的倍率） */
  const lensMm = parseInt(ZOOM_STEPS.find(z => z.label === settings.focalLength)?.mm || '24', 10) || 24;
  const focalRef = useRef(settings.focalLength); focalRef.current = settings.focalLength;
  const handleZoomClick = (val: string) => {
    haptic('detentMajor');
    setLiveZoom(null);
    if (proModeRef.current) void nativeCamera().then(c => c?.setZoom({ uiZoom: parseFloat(val) || 1 }));
    setSettings(prev => ({ ...prev, focalLength: val }));
    const mm = parseInt(ZOOM_STEPS.find(z => z.label === val)?.mm || '', 10);
    // 有小框時，顯示的是框的焦段（跟縮放時中間那個數字同一套）
    setFocalLengthMm(mm ? `${Math.round(mm * frameZoomRef.current)}mm` : '');
    if (focalLengthTimerRef.current) clearTimeout(focalLengthTimerRef.current);
    focalLengthTimerRef.current = setTimeout(() => setFocalLengthMm(null), 1000);
  };

  /* 對焦／曝光鎖定：長按畫面就把對焦與測光固定住（像 iOS 的 AE/AF LOCK），
     再點一下解除。裝置沒開放 manual 模式時不顯示、也不會假裝鎖住。 */
  const [aeafLock, setAeafLock] = useState(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canLock = (() => {
    const c = capabilities as any;
    return !!c && ((Array.isArray(c.focusMode) && c.focusMode.includes('manual')) ||
                   (Array.isArray(c.exposureMode) && c.exposureMode.includes('manual')));
  })();

  const applyLock = useCallback(async (on: boolean) => {
    if (!videoTrack) return;
    const c = capabilities as any;
    const adv: any = {};
    if (Array.isArray(c?.focusMode)) {
      if (on && c.focusMode.includes('manual')) adv.focusMode = 'manual';
      else if (!on && c.focusMode.includes('continuous')) adv.focusMode = 'continuous';
    }
    if (Array.isArray(c?.exposureMode)) {
      if (on && c.exposureMode.includes('manual')) adv.exposureMode = 'manual';
      else if (!on && c.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
    }
    if (!Object.keys(adv).length) return;
    try { await videoTrack.applyConstraints({ advanced: [adv] }); setAeafLock(on); } catch { /* 不支援就算了 */ }
  }, [videoTrack, capabilities]);

  /* 換鏡頭之後鎖定狀態不成立了，要清掉 */
  useEffect(() => { setAeafLock(false); }, [facingMode]);

  const handleFocus = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>) => {
    // 剛剛是雙指縮放小框，或是上下拖在調曝光，不是點一下對焦
    if (evDraggedRef.current || gesturePinchedRef.current || performance.now() < focusGuardUntilRef.current) return;
    if (showSettingsMenu) {
      /* 收起選單不能吃掉這次點擊；同一次點擊仍然要顯示並執行對焦。 */
      setShowSettingsMenu(false);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (proModeRef.current && rect.width && rect.height) void nativeCamera().then(c => c?.focus({ x: x / rect.width, y: y / rect.height }));
    /* 同一次觸控在新 WebKit 會依序送 pointerup 與 click。click 是舊版保底，
       但新版本不能因此讓相機硬體重做兩次對焦。 */
    const now = performance.now();
    const prevFocus = lastFocusEventRef.current;
    if (prevFocus && now - prevFocus.at < 180 && Math.hypot(x - prevFocus.x, y - prevFocus.y) < 3) return;
    lastFocusEventRef.current = { x, y, at: now };
    /* nonce 強制每次點擊都換一個節點，連續點同一位置時 CSS 動畫才會重播。 */
    setFocusPoint({ x, y, nonce: Date.now() }); setEvShown(false);
    /* 框多留一下：這段時間內上下拖可以調曝光 */
    hideFocusLater(1300);

    /* 把點到的位置換算成 0–1 的座標送給相機，才是真的「點哪裡對哪裡」。
       同時把測光點也指過去（專業相機 app 都是這樣一起做的）。
       裝置不支援指定座標時退回原本的持續自動對焦。 */
    if (videoTrack && capabilities) {
        const nx = Math.min(1, Math.max(0, x / (rect.width || 1)));
        const ny = Math.min(1, Math.max(0, y / (rect.height || 1)));
        const caps = capabilities as any;
        const adv: any = {};
        if ('pointsOfInterest' in caps) adv.pointsOfInterest = [{ x: nx, y: ny }];
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('single-shot')) adv.focusMode = 'single-shot';
        else if ('focusMode' in caps) adv.focusMode = 'continuous';
        if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('single-shot')) adv.exposureMode = 'single-shot';
        if (Object.keys(adv).length) queueFocusConstraints(videoTrack, adv);
    }
  };

  /* 對焦卡頓：
     ① applyConstraints 會讓相機重新設定一次（部分裝置那一下會停送一兩格），如果它跟對焦框的
        第一格擠在同一個事件裡，畫面要等它回來才畫得出對焦框 —— 看起來就是點下去頓一下。
        現在先讓對焦框畫出來（下一格之後才送），
     ② 連點時如果每一下都送一次，上一次還沒套完又來一次，相機就會一直在重設。
        現在同時間只會有一個在路上，排隊的只留最新的那一個點。 */
  const focusApplyRef = useRef<{ busy: boolean; next: { track: MediaStreamTrack; adv: any } | null }>({ busy: false, next: null });
  const queueFocusConstraints = (track: MediaStreamTrack, adv: any) => {
    const q = focusApplyRef.current;
    q.next = { track, adv };
    if (q.busy) return;
    const pump = () => {
      const job = q.next;
      q.next = null;
      if (!job || job.track.readyState !== 'live') { q.busy = false; return; }
      q.busy = true;
      let p: Promise<void>;
      try { p = job.track.applyConstraints({ advanced: [job.adv] }); } catch { p = Promise.resolve(); }
      // 有些裝置永遠不回應：最多等 1.2 秒就放行下一個
      withLimit(p, 1200).catch(() => {}).finally(pump);
    };
    q.busy = true;
    requestAnimationFrame(() => setTimeout(pump, 0));
  };

  /* 所有會跟相機硬體打交道的呼叫一律有截止時間；裝置不回應也不能鎖死介面。 */
  const withLimit = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  /** 等下一個真正的影片幀，而不是在兩幀之間重複讀同一張 drawing buffer。 */
  const waitForCameraFrame = useCallback(async (video: HTMLVideoElement, ms = 900) => {
    if (video.paused) {
      try { await withLimit(video.play(), 700); } catch { /* loadeddata 後再試 */ }
    }
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      await withLimit(new Promise<void>((resolve) => {
        const done = () => { video.removeEventListener('loadeddata', done); resolve(); };
        video.addEventListener('loadeddata', done, { once: true });
      }), ms).catch(() => {});
    }
    const requestFrame = (video as any).requestVideoFrameCallback as undefined | ((cb: () => void) => number);
    if (requestFrame) {
      await withLimit(new Promise<void>(resolve => requestFrame.call(video, () => resolve())), ms).catch(() => {});
    } else {
      await withLimit(new Promise<void>(resolve => requestAnimationFrame(() => resolve())), ms).catch(() => {});
    }
  }, []);

  /** 只把「完全沒有任何色彩資料」視為壞幀；真正的夜景仍會保留。 */
  const canvasHasFrame = useCallback((canvas: HTMLCanvasElement) => {
    try {
      const probe = document.createElement('canvas');
      probe.width = 12; probe.height = 12;
      const p = probe.getContext('2d', { willReadFrequently: true });
      if (!p) return false;
      p.drawImage(canvas, 0, 0, 12, 12);
      const px = p.getImageData(0, 0, 12, 12).data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] !== 0 || px[i + 1] !== 0 || px[i + 2] !== 0) return true;
      }
      return false;
    } catch { return false; }
  }, []);

  const capturingRef = useRef(false);
  /* 編碼高解析照片時若使用者又按快門，不丟掉那次操作：排進短佇列，上一張完成
     就立刻取下一張新幀。上限 3 是避免極端連點在手機上累積無限工作。 */
  const captureQueueRef = useRef(0);
  const capturePhotoRef = useRef<() => void>(() => {});
  const proOptsRef = useRef({ lut: '', amount: 1, aspect: 2 / 3, flash: false, raw: false, lutIdx: 0, date: false });
  /* 濾鏡強度跟編輯頁一致：每顆濾鏡的最大強度（例如 F3 是 70%），見 utils/photoFx 的 LUT_MAX_AMOUNT */
  const lutAmt = lutMaxAmount(lutList[selectedLutIdx]?.id) / 100;
  proOptsRef.current = { lut: lutFileName(lutList[selectedLutIdx]?.url), amount: lutAmt, aspect: PORTRAIT_RATIO[aspectRatio] ?? 2 / 3, flash: flashOn, raw: proRaw, lutIdx: selectedLutIdx, date: dateOn };
  const capturePhoto = useCallback(async () => {
    /* 專業模式：原生全解析度拍照，原生端套濾鏡、裁成畫面比例；ProRAW 開著時 RAW 檔直接存進相簿 */
    if (proModeRef.current) {
      if (capturingRef.current) return;
      capturingRef.current = true; setIsCapturing(true); setCaptureNotice('');
      try {
        const o = proOptsRef.current;
        /* 橫拿：照片是橫的，比例反過來（寬÷高） */
        const turns = uiTurnsRef.current;
        const aspect = turns === 1 || turns === 3 ? 1 / o.aspect : o.aspect;
        const look: RawLook = { lut: o.lut, amount: o.amount, aspect, zoom: frameZoomRef.current, fx: { ...nativeFxRef.current }, date: o.date ? dateStampText() : null };
        const baseZoom = liveZoomRef.current ?? (ZOOM_STEPS.find(z => z.label === focalRef.current)?.factor ?? 1);
        const r = await captureNative({ flash: o.flash ? 'on' : 'off', raw: o.raw, turns, baseZoom, lut: look.lut, amount: look.amount, aspect: look.aspect, zoom: look.zoom, fx: look.fx, kelvin: nativeParamsRef.current.kelvin, develop: o.raw ? RAW_PROTECT_EV : 0, date: look.date, keepOriginal: keepOriginalRef.current });
        if (!r) { setCaptureNotice('未能儲存照片，請再拍一次'); return; }
        ownedUrlsRef.current.add(r.url);
        if (r.cleanUrl && look.date) { ownedUrlsRef.current.add(r.cleanUrl); dateOfRef.current.set(r.url, { clean: r.cleanUrl, date: look.date }); }
        if (o.lutIdx > 0 && lutList[o.lutIdx]?.url) labelsRef.current.set(r.url, lutList[o.lutIdx].name);
        setPhotos(prev => [r.url, ...prev]);
        if (r.rawPath) {
          rawOfRef.current.set(r.url, { path: r.rawPath, protectEV: o.raw ? RAW_PROTECT_EV : 0, look: { ...look, zoom: r.cropZoom } });   // 小框拍照時鏡頭已經變焦過，RAW 只要補剩下的裁切
          setRawShots(prev => new Set(prev).add(r.url));
        }
        /* 存進手機相簿（跟 Dazz 一樣）：每一張都存套好濾鏡、特效、日期的成品。真正的 RAW 留在 App 的相機相簿裡（重新編輯用）。
           保留原始圖片開著：原始的那張也另外存一張 —— 開 RAW 存 RAW 檔本身（相簿裡就是真正的 RAW），沒開 RAW 存沒套濾鏡的原圖 */
        const keepRaw = keepOriginalRef.current ? r.rawPath : undefined, orig = r.originalPath;
        void (async () => {
          const ph = await nativePhotos();
          if (!ph) return;
          try {
            if (keepRaw) await ph.save({ path: keepRaw, kind: 'photo' });
            else if (orig) await ph.save({ path: orig, kind: 'photo' });
          } catch { /* 原始那張存不了：成品照樣存 */ }
          finally { if (orig) void nativeImage().then(i => i?.remove({ path: orig })).catch(() => {}); }
          await ph.save({ path: r.path, kind: 'photo' }).catch(() => {});   // 成品檔留著（相機相簿裡那張的原生路徑，編輯存檔用）
        })();
      } catch { setCaptureNotice('未能儲存照片，請再拍一次'); }
      finally { capturingRef.current = false; setIsCapturing(false); }
      return;
    }
    const video = videoEl;
    if (!video || !videoTrack || videoTrack.readyState === 'ended') return;
    if (capturingRef.current) {
      captureQueueRef.current = Math.min(3, captureQueueRef.current + 1);
      return;
    }
    capturingRef.current = true;
    setIsCapturing(true);
    setCaptureNotice('');

    try {
      /* 補光只走持續的 torch 約束；ImageCapture.takePhoto 在行動 WebView 上會暫停
         串流或讓第二次呼叫永久等待，所以新的連拍管線完全不再依賴它。 */
      let torchOn = false;
      if (flashOn && hasTorch) {
        try { torchOn = await withLimit(setTorch(true), 700); } catch { torchOn = false; }
        if (torchOn) await new Promise(resolve => setTimeout(resolve, 220));
      }

      await waitForCameraFrame(video);
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

      /* Viewfinder 的 WebGL 畫布本來就以 videoWidth × videoHeight 繪製，
         所以直接取它能同時保留最高可用像素，以及畫面上看到的曝光、色溫、
         LUT、柔光、朦朧與數位變焦。若 GPU 當下尚未交出有效幀，才退回原始影片。 */
      let captureSource: HTMLCanvasElement | HTMLVideoElement = video;
      for (let attempt = 0; attempt < 3; attempt++) {
        const rendered = viewfinderRef.current?.getCanvas();
        if (viewfinderRef.current?.isLutReady?.() && rendered && rendered.width > 0 && rendered.height > 0 && canvasHasFrame(rendered)) {
          captureSource = rendered;
          break;
        }
        await waitForCameraFrame(video, 600);
      }
      // 選的處理流程不能用時，絕不偷偷存下沒處理過的原始畫面：濾鏡和特效會整個不見
      if (captureSource === video) {
        setCaptureNotice('相機影像尚未就緒，請再拍一次');
        return;
      }

      const srcW = captureSource instanceof HTMLVideoElement ? captureSource.videoWidth : captureSource.width;
      const srcH = captureSource instanceof HTMLVideoElement ? captureSource.videoHeight : captureSource.height;
      const targetRatio = PORTRAIT_RATIO[aspectRatio] ?? 2 / 3;
      const srcRatio = srcW / srcH;

      let cropW = srcW;
      let cropH = srcH;
      let offsetX = 0;
      let offsetY = 0;
      if (srcRatio > targetRatio) {
        cropW = srcH * targetRatio;
        offsetX = (srcW - cropW) / 2;
      } else {
        cropH = srcW / targetRatio;
        offsetY = (srcH - cropH) / 2;
      }
      /* 小框構圖：只留框裡的那一塊（框永遠在正中央、比例跟畫面一樣） */
      const fz = frameZoomRef.current;
      if (fz > 1.001) {
        const w2 = cropW / fz, h2 = cropH / fz;
        offsetX += (cropW - w2) / 2; offsetY += (cropH - h2) / 2;
        cropW = w2; cropH = h2;
      }

      /* 保留相機實際提供的完整像素；畫布重用，相簿只持有編碼後的 Blob。 */
      const outputScale = 1;
      const outW = Math.max(1, Math.round(cropW * outputScale));
      const outH = Math.max(1, Math.round(cropH * outputScale));
      const photoCanvas = canvasRef.current || document.createElement('canvas');
      photoCanvas.width = outW;
      photoCanvas.height = outH;
      const ctx = photoCanvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const draw = () => {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, outW, outH);
        ctx.filter = 'none';
        /* GPU 畫布已包含所有即時效果；只有 GPU 尚未就緒而退回 video 時，
           才在 2D 備援裡補上曝光，確保任何情況至少都能得到清楚、非黑的照片。 */
        if (captureSource instanceof HTMLVideoElement) {
          const exposure = parseFloat(settings.exposure) || 0;
          ctx.filter = `brightness(${Math.max(0.25, Math.min(4, Math.pow(2, exposure)))})`;
        }
        ctx.drawImage(captureSource, offsetX, offsetY, cropW, cropH, 0, 0, outW, outH);
        ctx.restore();
      };

      /* 第一幀若剛好是相機切換／回前景產生的全黑幀，就等下一幀重畫；
         最多三次，每次都有時限，永遠不會把黑圖加進相簿。 */
      // 每次檢查都要從 GPU 讀回來，結果記住，不重讀
      let hasFrame = false;
      for (let attempt = 0; attempt < 3 && !hasFrame; attempt++) {
        draw();
        hasFrame = canvasHasFrame(photoCanvas);
        if (hasFrame) break;
        await waitForCameraFrame(video, 600);
        const rendered = viewfinderRef.current?.getCanvas();
        if (rendered && canvasHasFrame(rendered)) captureSource = rendered;
      }
      if (!hasFrame) return;
      // 裁好的照片已經在 2D 畫布上了，先把全尺寸的 GPU 暫存還回去，JPEG 編碼也要記憶體
      viewfinderRef.current?.restorePreview?.();

      const thumb = await thumbFromCanvas(photoCanvas, outW, outH);
      const url = await canvasToBlobUrl(photoCanvas);
      ownedUrlsRef.current.add(url);
      seedThumb(url, thumb);
      setPhotos(prev => [url, ...prev]);
    } catch {
      /* 相機或編碼器失敗時不要把 rejection 丟到全域；不新增黑圖，直接恢復快門。 */
      setCaptureNotice('未能儲存照片，請再拍一次');
    } finally {
      /* 任一步驟失敗或逾時都會走到這裡：熄燈、解鎖快門與整個介面。 */
      setTorch(false);
      /* JPEG blob 已經有自己的壓縮資料，不能把這張 4K RGBA 畫布繼續留著。
         它在 iPhone 上可能佔 50MB 以上，會直接擠掉下一頁匯出所需的 GPU。 */
      const photoCanvas = canvasRef.current;
      if (photoCanvas) { photoCanvas.width = 1; photoCanvas.height = 1; }
      capturingRef.current = false;
      setIsCapturing(false);
      if (captureQueueRef.current > 0) {
        captureQueueRef.current -= 1;
        requestAnimationFrame(() => capturePhotoRef.current());
      }
    }
  }, [aspectRatio, canvasHasFrame, flashOn, hasTorch, seedThumb, setTorch, settings.exposure, videoTrack, videoEl, waitForCameraFrame]);
  capturePhotoRef.current = capturePhoto;

  /* 專業模式開著時：原生相機畫在網頁底下，觀景窗那一塊挖成透明；實體按鈕（音量鍵、相機控制）當快門 */
  useEffect(() => {
    if (!proMode) return;
    let alive = true, restore: (() => void) | null = null, sub: { remove: () => void } | null = null, orientSub: { remove: () => void } | null = null, ro: ResizeObserver | null = null;
    void (async () => {
      const cam = await nativeCamera();
      const canvas = viewfinderRef.current?.getCanvas?.() ?? null;
      const el = canvas?.parentElement;
      if (!cam || !el || !alive) return;
      /* 圓角照觀景窗外框（rounded-camera）：原生畫面在網頁底下，要自己切成一樣的圓角 */
      const frame = (el.closest('.rounded-camera') as HTMLElement | null) ?? el;
      const rect = () => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, radius: parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0 }; };
      try {
        const info = await cam.start({ position: facingMode === 'user' ? 'front' : 'back', ...rect(), lut: proOptsRef.current.lut, amount: proOptsRef.current.amount, proRAW: true });
        if (alive) {
          setNativeFlash(!!info?.flash);
          if (typeof info?.turns === 'number') setUiTurns(info.turns);
          if (typeof info?.minZoom === 'number' && typeof info?.maxZoom === 'number') setNativeZoomRange({ min: info.minZoom, max: info.maxZoom });
        }
        /* 能不能拍 RAW 要等相機真的開起來才知道：還沒接上鏡頭的 AVCapturePhotoOutput 一律回報「不支援 ProRAW」，
           所以 available() 那邊永遠是 false（RAW 開關才會一直沒出現）。以開相機後回報的為準 */
        if (alive && info) {
          const rawOk = !!(info.raw ?? info.proRAW);
          setProRawSupported(rawOk);
          if (!rawOk && proRaw) { setProRaw(false); setCaptureNotice('這顆鏡頭不支援 RAW'); }
        }
        void cam.setFx(nativeFxRef.current).catch(() => {});
        /* 開起來就把目前的曝光、白平衡套上去 */
        void cam.setExposureBias({ ev: deviceBias(nativeParamsRef.current) }).catch(() => {});
        void cam.setRawMode?.({ on: nativeParamsRef.current.raw })?.catch(() => {});
        pushDateRef.current();
        void cam.setWhiteBalance({ kelvin: nativeParamsRef.current.kelvin }).catch(() => {});
      } catch (e: any) {
        /* 被後面那一次開相機取代（翻轉鏡頭、換頁）不算失敗；真的開不起來才換成網頁相機 */
        if (alive && !/superseded/.test(String(e?.message ?? e))) { setProPreferred(false); setCaptureNotice('原生相機無法啟動，已換成一般相機'); }
        return;
      }
      if (!alive) return;
      restore = punchThrough(el, canvas ? [canvas] : []);
      ro = new ResizeObserver(() => { void cam.setRect(rect()).catch(() => {}); });
      ro.observe(el);
      sub = await cam.addListener('shutter', () => capturePhotoRef.current());
      orientSub = await cam.addListener('orientation', (d: any) => { if (typeof d?.turns === 'number') setUiTurns(d.turns); });
      if (!alive) { sub.remove(); orientSub.remove(); }
    })();
    return () => {
      alive = false; ro?.disconnect(); sub?.remove(); orientSub?.remove(); restore?.(); setUiTurns(0);
      void nativeCamera().then(c => c?.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proMode, facingMode, editingPhoto]);
  /* 原生相機的即時特效：直接畫在原生觀景窗上 */
  const nativeFx = { soft: (fx.soft || 0) / 100, blur: (fx.blur || 0) / 100, lowfi: (fx.lowfi || 0) / 100 };
  const nativeFxRef = useRef(nativeFx); nativeFxRef.current = nativeFx;
  useEffect(() => {
    if (proMode) void nativeCamera().then(c => c?.setFx(nativeFxRef.current)).catch(() => {});
  }, [proMode, fx.soft, fx.blur, fx.lowfi]);
  /* 原生相機：曝光、白平衡直接調鏡頭本身（拍出來的照片就是這樣，不是事後調亮） */
  const nativeParamsRef = useRef({ exposure: settings.exposure, kelvin: settings.kelvin, raw: proRaw });
  nativeParamsRef.current = { exposure: settings.exposure, kelvin: settings.kelvin, raw: proRaw };
  /* 底片模式（RAW 開著）：鏡頭少曝光 RAW_PROTECT_EV 格保護亮部 —— 跟 Dazz 一樣，觀景窗會暗暗的；
     拍出來的成品照片在原生端沖回來，RAW 之後也可以重新沖洗 */
  const deviceBias = (p: { exposure: string; raw: boolean }) => (parseFloat(p.exposure) || 0) - (p.raw ? RAW_PROTECT_EV : 0);
  useEffect(() => {
    if (proMode) void nativeCamera().then(c => c?.setExposureBias({ ev: deviceBias({ exposure: settings.exposure, raw: proRaw }) })).catch(() => {});
  }, [proMode, settings.exposure, proRaw]);
  /* RAW 開著：原生關掉「為了速度降低合成品質」的選項，每一張 RAW 都跟原相機一樣完整多張合成 */
  useEffect(() => {
    if (proMode) void nativeCamera().then(c => c?.setRawMode?.({ on: proRaw })).catch(() => {});
  }, [proMode, proRaw]);
  /* 日期戳記：觀景窗右下角（原生端畫，跟照片同一個位置） */
  const dateOnRef = useRef(dateOn); dateOnRef.current = dateOn;
  /* 日期只印在拍出來的照片上，觀景窗不顯示（跟底片相機一樣，沖出來才看得到） */
  const pushDate = () => {
    if (!proModeRef.current) return;
    void nativeCamera().then(c => c?.setDate({ date: null })).catch(() => {});
  };
  const pushDateRef = useRef(pushDate); pushDateRef.current = pushDate;
  useEffect(() => { pushDate(); }, [proMode, dateOn]);
  useEffect(() => {
    if (proMode) void nativeCamera().then(c => c?.setWhiteBalance({ kelvin: settings.kelvin })).catch(() => {});
  }, [proMode, settings.kelvin]);
  useEffect(() => {
    if (proMode) void nativeCamera().then(c => c?.setLut({ lut: lutFileName(lutList[selectedLutIdx]?.url), amount: lutMaxAmount(lutList[selectedLutIdx]?.id) / 100 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proMode, selectedLutIdx]);
  useEffect(() => () => { captureQueueRef.current = 0; }, []);

  /* 倒數用的計時器要抓在 ref 上：離開相機時一定要取消，
     不然頁面關掉之後它還會跳出來呼叫拍照。 */
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopCountdown = useCallback(() => {
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    setCountdown(null);
  }, []);
  useEffect(() => () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  }, []);

  /* 快門鍵的手感：按下縮到 0.86、放開彈回。用 Web Animations 跑 transform —— 這種動畫在合成器上跑，
     拍照時主執行緒卡住也不會停格（用 class 切換＋CSS transition 的話，要等主執行緒才會開始動） */
  const shutterInnerRef = useRef<HTMLDivElement>(null);
  const shutterAnimRef = useRef<Animation | null>(null);
  const shutterDownRef = useRef(false);
  const shutterPress = (down: boolean, tap = false) => {
    const el = shutterInnerRef.current;
    if (!el || typeof el.animate !== 'function') return;
    if (!tap && down === shutterDownRef.current) return;
    const cur = getComputedStyle(el).transform;
    const from = cur && cur !== 'none' ? cur : 'scale(1)';
    shutterAnimRef.current?.cancel();
    if (tap) {
      // 鍵盤／輔助功能觸發的點擊（沒有按下的過程）：一次做完縮下去再彈回
      shutterAnimRef.current = el.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.86)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(0.2,0.8,0.2,1)' });
      shutterAnimRef.current.onfinish = () => { shutterAnimRef.current = null; };
      return;
    }
    shutterDownRef.current = down;
    shutterAnimRef.current = el.animate([{ transform: from }, { transform: down ? 'scale(0.86)' : 'scale(1)' }],
      { duration: down ? 120 : 260, easing: 'cubic-bezier(0.2,0.8,0.2,1)', fill: 'forwards' });
    if (!down) shutterAnimRef.current.onfinish = () => { shutterAnimRef.current = null; };
  };
  const handleShutterClick = () => {
    if (countdown !== null) {          // 倒數中再按一下＝取消
      stopCountdown();
      return;
    }
    if (timer > 0) {
      setCountdown(timer);
      countdownTimerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev === null || prev <= 1) {
            if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
            capturePhoto();
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      capturePhoto();
    }
  };

  /* 切到別的 app 或鎖屏時把影像擷取關掉 —— 串流跟每一幀的 GPU 運算
     都還在跑的話很耗電。回到前景再打開，不需要重新要一次權限。 */
  useEffect(() => {
    const onVis = () => {
      const tracks = streamRef.current?.getVideoTracks() || [];
      const hidden = document.visibilityState === 'hidden';
      tracks.forEach(t => { t.enabled = !hidden; });
      if (hidden) {
        stopCountdown();
        setTorch(false);
        videoEl?.pause();
      } else {
        videoEl?.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [videoEl, stopCountdown, setTorch]);

  /* 編輯器蓋上來後，舊版的相機串流與高解析 WebGL 觀景窗仍在背後逐幀運算。
     iPhone 接著又建立全解析編輯畫布時會耗盡圖形記憶體，造成成功頁拿到黑圖。
     編輯期間暫停軌道，並由下方條件渲染卸載 Viewfinder；返回時沿用原串流恢復。 */
  useEffect(() => {
    if (!editingPhoto) return;
    captureQueueRef.current = 0;
    stopCountdown();
    setTorch(false);
    if (videoTrack?.readyState === 'live') videoTrack.enabled = false;
    videoEl?.pause();
    return () => {
      if (document.visibilityState === 'visible' && videoTrack?.readyState === 'live') {
        videoTrack.enabled = true;
        videoEl?.play().catch(() => {});
      }
    };
  }, [editingPhoto, setTorch, stopCountdown, videoEl, videoTrack]);

  const getFrameStyle = (): React.CSSProperties => {
    const d = frameDims();
    if (!d) return { opacity: 0 };
    return { width: `${d.w}px`, height: `${d.h}px`, marginBottom: `${d.mb}px` };
  };
  /** 這個比例的觀景窗最後會是多大（CSS px）。動畫中框在變，這個不變 —— 觀景窗的畫布照它配置。 */
  const frameDims = (): { w: number; h: number; mb: number } | null => {
    if (containerSize.w === 0 || containerSize.h === 0) return null;

    const maxW = containerSize.w;
    const maxH = containerSize.h;
    
    // 算 3:2 的基準高度（直式 2:3 ＝ 0.666…）
    const ratio32 = 2/3;
    let h32 = maxW / ratio32;
    let w32 = maxW;
    
    if (h32 > maxH) {
        h32 = maxH;
        w32 = h32 * ratio32;
    }

    let targetW = 0;
    let targetH = 0;

    switch (aspectRatio) {
      case '16:9':
        // 16:9（直式 9:16）：高度要跟 3:2 一樣
        targetH = h32;
        targetW = targetH * (9/16);
        break;
      case '4:3':
      case '1:1':
        // 比 3:2 矮的比例：寬度維持 3:2 的寬，高度照比例縮短
        targetW = w32;
        targetH = w32 / PORTRAIT_RATIO[aspectRatio];
        break;
      case '3:2':
      default:
        targetH = h32;
        targetW = w32;
        break;
    }

    /* 4:3、1:1 比 3:2 矮。外層是貼底排的，不處理的話矮的框會整個沉到底、上面空一大塊。
       改成放在 3:2 那一格的正中間 —— 框的中心跟 3:2 時一樣，切換比例時是上下一起收，
       不是只有上緣往下掉。 */
    return { w: targetW, h: targetH, mb: Math.max(0, (h32 - targetH) / 2) };
  };

  /* 開編輯：有 RAW 的那幾張，底圖是從 RAW 沖出來的（不是已經壓成 JPEG 的成品），曝光、白平衡、高光、陰影都在 RAW 上調。
     沖底圖要一點時間：在大圖頁看到 RAW 照片時就先在背景沖好（prepRaw），點「編輯」時通常已經好了 */
  const rawPrepRef = useRef(new Map<string, Promise<string | null>>());
  const rawInfoOf = (src: string) => {
    const r = rawOfRef.current.get(src);
    /* 日期不在 RAW 這裡印：存檔時才印（stampDate） */
    return r ? { path: r.path, protectEV: r.protectEV, look: { ...r.look, date: null } as RawLook } : null;
  };
  const prepRaw = (src: string) => {
    const r = rawInfoOf(src);
    if (!r) return null;
    let p = rawPrepRef.current.get(src);
    if (!p) {
      p = rawDevelopPreview(r.path, { exposure: r.protectEV, highlights: 0, shadows: 0 }, r.look, 2048, true).then(x => x?.url ?? null);
      rawPrepRef.current.set(src, p);
      void p.then(u => { if (!u) rawPrepRef.current.delete(src); });   // 沒沖出來：下次再試
    }
    return p;
  };
  const openingRef = useRef(false);
  const openEditor = async (src: string, idx: number, pro = false) => {
    if (openingRef.current) return;
    const d = dateOfRef.current.get(src);
    const r = rawInfoOf(src);
    if (r) {
      openingRef.current = true;
      try {
        const url = await prepRaw(src);
        if (url) {
          setEditingPhoto({ src: url, index: idx, init: null, pro, date: d?.date, raw: r });
          setEditorId(prev => prev + 1);
          return;
        }
      } finally { openingRef.current = false; }
    }
    /* 一般照片（或 RAW 沖不出來）：編拍好的那張；有日期的編沒印日期的那張 */
    setEditingPhoto({ src: d?.clean ?? src, index: idx, init: null, pro, date: d?.date });
    setEditorId(prev => prev + 1);
  };
  /** 相簿多選「編輯」：好幾張一起進編輯（編輯頁上面一排可以切換、同步套用） */
  const openEditMany = (indices: number[]) => {
    const srcs = indices.map(i => photos[i]).filter(Boolean);
    if (!srcs.length) return;
    if (srcs.length === 1) { openEditor(srcs[0], indices[0]); return; }
    setEditingPhoto({ src: srcs[0], index: indices[0], init: null, batch: srcs });
    setEditorId(prev => prev + 1);
  };
  /* 離開相機回主頁：整頁往右滑走（見 utils/pageTransition）。
     原生相機的畫面在網頁底下、是挖空透出來的，整頁拍快照時那一塊會是空的 ——
     先跟原生拿觀景窗現在這一格，用一張圖蓋住觀景窗，再滑走：看起來就是相機畫面定格、跟著整頁一起滑出去 */
  const [exitShot, setExitShot] = useState<string | null>(null);
  const exitingRef = useRef(false);
  const exitCamera = async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    if (proModeRef.current) {
      try {
        const cam = await nativeCamera();
        const shot = cam ? await cam.snapshot() : null;
        if (shot?.path) {
          const src = fileSrc(shot.path);
          const im = new Image(); im.src = src;
          await im.decode().catch(() => {});
          setExitShot(src);
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
      } catch { /* 拿不到就直接滑 */ }
    }
    await slideBack(() => onHome());
  };

  /* ── 原生設定選單 ─────────────────────────────────────────── */
  const openNativeMenu = (btn: HTMLElement) => {
    const r = btn.getBoundingClientRect();
    /* 面板貼在觀景窗右上角裡面（不超出相機畫面） */
    const f = (btn.closest('.rounded-camera') as HTMLElement | null)?.getBoundingClientRect();
    void nativeCamera().then(c => c?.showMenu({
      anchor: { x: r.left, y: r.top, w: r.width, h: r.height },
      bounds: f ? { x: f.left, y: f.top, w: f.width, h: f.height } : undefined,
      items: [
        { id: 'grid', type: 'toggle', title: '構圖線', symbol: 'grid', value: showGrid },
        { id: 'level', type: 'toggle', title: '水平線', symbol: 'abai.level', value: levelOn },
        { id: 'location', type: 'toggle', title: '位置', symbol: 'location', value: locationOn },
        { id: 'date', type: 'toggle', title: '日期', symbol: 'calendar', value: dateOn },
        { id: 'keepOriginal', type: 'toggle', title: '保留原始圖片', symbol: 'photo.on.rectangle', value: keepOriginal },
        { id: 'timer', type: 'choice', title: '定時', symbol: 'timer', value: String(timer), options: [{ label: '關閉', value: '0' }, { label: '3 秒', value: '3' }, { label: '10 秒', value: '10' }] },
        { id: 'zoomMode', type: 'choice', title: '縮放模式', symbol: 'plus.magnifyingglass', value: zoomMode, options: [{ label: '全螢幕', value: 'full' }, { label: '線框', value: 'frame' }] },
      ],
    })).catch(() => {});
  };
  const menuHandlerRef = useRef<(id: string, v: any) => void>(() => {});
  menuHandlerRef.current = (id, v) => {
    if (id === 'grid') setShowGrid(!!v);
    else if (id === 'level') setLevelOn(!!v);
    else if (id === 'location') setLocationOn(!!v);
    else if (id === 'date') setDateOn(!!v);
    else if (id === 'keepOriginal') setKeepOriginal(!!v);
    else if (id === 'timer') setTimer((Number(v) || 0) as TimerMode);
    else if (id === 'zoomMode') {
      const m = v === 'full' ? 'full' : 'frame';
      if (m === zoomModeRef.current) return;
      setZoomMode(m);
      /* 換模式時看到的畫面不變：
         線框 → 全螢幕：小框的倍率變成鏡頭真的變焦（2x 的框＝鏡頭直接 2x），框收掉；
         全螢幕 → 線框：鏡頭停在原本的倍率，不跳回按鈕那一格 */
      const fz = frameZoomRef.current;
      pinchRef.current = null;
      if (m === 'full' && fz > 1.001) {
        const cur = liveZoomRef.current ?? (ZOOM_STEPS.find(z => z.label === focalRef.current)?.factor ?? 1);
        const r = nativeZoomRangeRef.current;
        const z = Math.max(r?.min ?? 1, Math.min(Math.min(r?.max ?? 10, 15), cur * fz));
        frameZoomRef.current = 1; smallFrameRef.current?.set(1, false);
        liveZoomRef.current = z; setLiveZoom(z);
        void nativeCamera().then(c => c?.setZoom({ uiZoom: z })).catch(() => {});
      }
    }
  };
  useEffect(() => {
    if (!proMode) return;
    let alive = true; const subs: { remove: () => void }[] = [];
    void nativeCamera().then(async c => {
      if (!c || !alive) return;
      subs.push(await c.addListener('menu', (d: any) => menuHandlerRef.current(String(d?.id), d?.value)));
      subs.push(await c.addListener('level', (d: any) => levelBus.emit(Number(d?.roll) || 0, !!d?.flat)));
      if (!alive) subs.forEach(x => x.remove());
    });
    return () => { alive = false; subs.forEach(x => x.remove()); };
  }, [proMode]);
  /* 水平儀、位置：開關交給原生（相機重開時也要再設一次） */
  useEffect(() => {
    if (proMode) void nativeCamera().then(c => c?.setLevel({ on: levelOn })).catch(() => {});
  }, [proMode, levelOn, facingMode]);
  useEffect(() => {
    if (!proMode) return;
    void nativeCamera().then(c => c?.setLocation({ on: locationOn })).then(r => {
      if (locationOn && r?.denied) setCaptureNotice('請到「設定」開啟 Abai 的定位權限');
    }).catch(() => {});
  }, [proMode, locationOn, facingMode]);

  const handleSaveEdit = async (newSrc: string, shouldClose: boolean = true) => {
    if (editingPhoto) {
      /* 有日期的照片：編輯的是沒印日期的那張，存回來時才印上去 */
      let finalSrc = newSrc;
      if (editingPhoto.date) {
        const stamped = await stampDateOnto(newSrc, editingPhoto.date);
        if (stamped) { finalSrc = stamped; ownedUrlsRef.current.add(stamped); dateOfRef.current.set(stamped, { clean: newSrc, date: editingPhoto.date }); }
      }
      setPhotos(prev => {
        const next = [...prev];
        forgetRaw(next[editingPhoto.index]);   // 存回來的是編輯完的成品，不再是 RAW
        forgetDate(next[editingPhoto.index]);
        releaseUrl(next[editingPhoto.index]);
        next[editingPhoto.index] = finalSrc;
        return next;
      });
      if (shouldClose) {
        closeGalleryEditor();
      }
    }
  };

  const handleLocalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsImportingLocal(true);
      setLocalImportPreviewUrl(null);
      try {
        const objectUrl = await processImageFile(file, (previewUrl) => {
            setLocalImportPreviewUrl(previewUrl);
        });
        /* 直接用讀進來的檔案（瀏覽器本來就能顯示，方向也已經轉正），不再整張畫進畫布重新編成 PNG：
           48MP 的 iPhone 照片超過手機的畫布上限，直接畫的話這一步就是空白或閃退；不重編碼也完全無損 */
        const img = new Image();
        img.onload = () => {
            ownedUrlsRef.current.add(objectUrl);
            setPhotos(prev => [objectUrl, ...prev]);
            setEditingPhoto({ src: objectUrl, index: 0 });
            setEditorId(prev => prev + 1);
            setIsImportingLocal(false);
            setLocalImportPreviewUrl(null);
        };
        img.onerror = () => {
             setIsImportingLocal(false);
             setLocalImportPreviewUrl(null);
             alert("無法載入此圖片");
        };
        img.src = objectUrl;
      } catch (err) {
        console.error("Failed to process image:", err);
        alert("無法處理此圖片格式");
        setIsImportingLocal(false);
        setLocalImportPreviewUrl(null);
      }
    }
    if (localFileInputRef.current) {
        localFileInputRef.current.value = '';
    }
  };

  return (
    <div data-camera-root style={{ ['--cam-rot' as any]: `${uiAngle}deg` }} className="safe-top flex flex-col h-screen max-h-screen justify-end pb-6 overflow-hidden select-none bg-black font-sans text-white animate-in fade-in duration-300">
      {captureNotice && <div role="status" className="fixed top-20 left-1/2 -translate-x-1/2 z-[300] rounded-full bg-black/85 px-4 py-2 text-xs whitespace-nowrap pointer-events-none">{captureNotice}</div>}
      
      {isImportingLocal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          {localImportPreviewUrl && (
             <img src={localImportPreviewUrl} alt="Preview" className="absolute inset-0 w-full h-full object-contain opacity-30 blur-sm mix-blend-screen" />
          )}
          <div className="flex flex-col items-center gap-4 text-white relative z-10">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin shadow-[0_0_15px_rgba(255,255,255,0.5)]"></div>
            <p className="text-sm font-black tracking-[0.2em] uppercase animate-pulse drop-shadow-md">載入中...</p>
          </div>
        </div>
      )}

      {/* 「編輯下一張」用的隱藏檔案輸入 */}
      <input 
        type="file" 
        ref={localFileInputRef} 
        className="hidden" 
        accept={RAW_ACCEPT}
        onChange={handleLocalFileChange}
      />

      <main className="flex-1 relative flex flex-col justify-end px-4 overflow-hidden">
        {/* pb-0 讓觀景框低一點 */}
        <div className="w-full h-full flex items-end justify-center pb-0" ref={containerRef}>
          <div 
            className="relative rounded-camera overflow-hidden bg-black flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
            style={{ ...getFrameStyle(), touchAction: 'none' }}
            onPointerDown={onFramePointerDown}
            onPointerMove={onFramePointerMove}
            onPointerUp={onFramePointerEnd}
            onPointerCancel={onFramePointerEnd}
          >
            {/* 返回鍵屬於相機畫面本身，和右上角的更多按鈕平行對稱。 */}
            {/* 濾鏡列打開時也留著：選濾鏡時一樣要能直接回主頁 */}
            {!galleryCover && !editingPhoto && activeControl !== 'effects' && (
              <div className="absolute top-1 left-2 z-50">
                <button
                  aria-label="返回主頁"
                  onClick={(e) => { e.stopPropagation(); void exitCamera(); }}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white transition-colors"
                >
                  <Icon name="chevron_left" className="text-[28px] drop-shadow-md" />
                </button>
              </div>
            )}

            {!editingPhoto && <Viewfinder
              ref={viewfinderRef}
              video={videoEl}
              lutUrl={lutList[selectedLutIdx].url}
              lutAmount={lutMaxAmount(lutList[selectedLutIdx]?.id) / 100}
              exposure={parseFloat(settings.exposure)}
              kelvin={settings.kelvin}
              isUserFacing={visualFacingMode === 'user'}
              /* 原生相機時特效由原生端畫，網頁這張（被挖空、看不到）不必再跟著算一次 */
              fx={proMode ? FX_ZERO : fx}
              digitalZoom={digitalZoom}
              displayBox={frameDims()}
              /* click 保留為鍵盤／舊版 WebKit 的保底；新 iOS 由 pointerup 立即觸發。 */
              onClick={handleFocus}
              onPointerDown={() => {
                if (!canLock) return;
                if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
                // 按住 550ms 就鎖定；已經鎖住的話長按是解除
                lockTimerRef.current = setTimeout(() => { triggerHaptic(); applyLock(!aeafLock); }, 550);
              }}
              onPointerUp={(e) => {
                if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; }
                /* iOS 的 WebGL canvas 偶爾不會合成出 synthetic click；直接在真實的
                   pointerup 顯示對焦框，點一下就一定有回饋，也少掉 300ms click 延遲。 */
                handleFocus(e);
              }}
              onPointerCancel={() => { if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null; } }}
            />}

            {levelOn && proMode && !galleryCover && <LevelOverlay turns={uiTurns} />}

            {/* 離開相機的定格畫面（見 exitCamera） */}
            {exitShot && <img src={exitShot} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover z-[35] pointer-events-none" />}

            {/* 鎖定中的提示，位置與樣式照 iOS 相機 */}
            {aeafLock && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                <span className="px-2 py-[3px] rounded-[4px] bg-yellow-300/90 text-black text-[10px] font-black tracking-[0.14em]">
                  AE/AF 鎖定
                </span>
              </div>
            )}

            {showGrid && (
                /* 輔助線：跟 iOS 相機一樣是淡淡的半透明白。透明度加在整組外層（opacity），
                   四條線本身是實色 —— 交叉的地方是同一層，不會疊兩次變得比較白 */
                <div className="absolute inset-0 z-10 pointer-events-none w-full h-full opacity-[0.38]">
                    <div className="absolute top-1/3 left-0 right-0 h-px -translate-y-1/2 bg-white"></div>
                    <div className="absolute top-2/3 left-0 right-0 h-px -translate-y-1/2 bg-white"></div>
                    <div className="absolute left-1/3 top-0 bottom-0 w-px -translate-x-1/2 bg-white"></div>
                    <div className="absolute left-2/3 top-0 bottom-0 w-px -translate-x-1/2 bg-white"></div>
                </div>
            )}
            
            {!editingPhoto && <SmallFrameOverlay ref={smallFrameRef} baseMm={lensMm} />}

            {focalLengthMm && (
                <div 
                    key={focalLengthMm} 
                    className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
                >
                    <div className="text-sm font-medium text-white animate-[camFadeOut_1s_ease-out_forwards] tracking-[0.1em] leading-none select-none mr-[-0.1em] translate-y-4">
                        {focalLengthMm}
                    </div>
                </div>
            )}

            {/* 設定選單按鈕 */}
            <div className="absolute top-1 right-2 z-50">
                <button 
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        triggerHaptic();
                        /* App 裡：iOS 原生的選單（iOS 26 起是液態玻璃＋原生開關）；網頁版才用自己畫的 */
                        if (proModeRef.current) { openNativeMenu(e.currentTarget); return; }
                        setShowSettingsMenu(!showSettingsMenu); 
                    }}
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white active:scale-90 transition-transform"
                >
                    <Icon name="more_horiz" className="cam-rot text-2xl drop-shadow-md" />
                </button>
                
                {showSettingsMenu && (
                    <div className="absolute top-12 right-2 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-[18px] px-3.5 py-3 w-44 shadow-[0_12px_40px_rgba(0,0,0,0.45)] flex flex-col gap-3 animate-in fade-in zoom-in-90 slide-in-from-top-1 duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] origin-top-right select-none" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 text-[13px] font-medium text-white/90">
                                <Icon name="grid_3x3" className="text-lg text-white/70" />
                                <span>構圖線</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); setShowGrid(!showGrid); triggerHaptic(); }}
                                className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] border border-white/10 ${showGrid ? 'bg-white/40' : 'bg-white/10'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)] ${showGrid ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        {proMode && (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 text-[13px] font-medium text-white/90">
                                <Icon name="calendar_today" className="text-lg text-white/70" />
                                <span>日期</span>
                            </div>
                            <button
                                aria-label="日期戳記"
                                onClick={(e) => { e.stopPropagation(); setDateOn(!dateOn); triggerHaptic(); }}
                                className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] border border-white/10 ${dateOn ? 'bg-white/40' : 'bg-white/10'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)] ${dateOn ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        )}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 text-[13px] font-medium text-white/90">
                                <Icon name="timer" className="text-lg text-white/70" />
                                <span>定時</span>
                            </div>
                            <button 
                                onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setTimer(prev => prev === 0 ? 3 : prev === 3 ? 10 : 0);
                                    triggerHaptic();
                                }}
                                className="h-6 px-2.5 rounded-full bg-white/10 text-[11px] font-semibold tabular-nums text-white/85 border border-white/10 min-w-[3rem] flex items-center justify-center active:scale-90 transition-[transform,background-color] duration-200"
                            >
                                {timer === 0 ? 'OFF' : `${timer}s`}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            
            {focusPoint && (() => {
                /* 單純點對焦只有框；上下拖過之後框的右邊（點在很右邊時改左邊）出現曝光線＋太陽，太陽的位置＝目前的曝光 */
                const ev = Math.max(-EV_MAX, Math.min(EV_MAX, parseFloat(settings.exposure) || 0)) / EV_MAX;
                const frameW = frameDims()?.w ?? 0;
                const lineLeft = frameW > 0 && focusPoint.x > frameW - 70;
                const lineX = lineLeft ? -39 - 13 : 39 + 13;
                const gapY = -ev * EV_LINE;
                return (
                <div
                    key={focusPoint.nonce}
                    className="absolute z-40 pointer-events-none animate-[camFocusHold_1.3s_linear_forwards]"
                    style={{ left: focusPoint.x, top: focusPoint.y, transform: 'translate(-50%, -50%)', ...(evDragging ? { animationName: 'none', opacity: 1 } : evShown ? { animation: 'camFocusEvEnd 1.35s linear forwards' } : {}) }}
                >
                    {/* 陰影改成畫在 SVG 裡的一條淡黑線：CSS 的 drop-shadow 濾鏡疊在每格都在重畫的
                        觀景窗上，縮放動畫的每一格都要重算一次模糊，對焦那一下就會頓。 */}
                    <div className="w-[78px] h-[78px] animate-[camFocusIn_0.92s_cubic-bezier(0.2,0.72,0.2,1)_forwards]" style={{ willChange: 'transform' }}>
                         <svg width="100%" height="100%" viewBox="0 0 78 78" fill="none" xmlns="http://www.w3.org/2000/svg">
                             <g transform="translate(0 1)" stroke="rgba(0,0,0,0.28)" strokeWidth="1">
                               <rect x="4.5" y="4.5" width="69" height="69"/>
                               <path d="M39 4.5V13M39 73.5V65M4.5 39H13M73.5 39H65" strokeLinecap="square"/>
                             </g>
                             <rect x="4.5" y="4.5" width="69" height="69" stroke="#fff" strokeWidth="1"/>
                             {/* 四條刻度全部向框內延伸，不再凸出框外。 */}
                             <path d="M39 4.5V13M39 73.5V65M4.5 39H13M73.5 39H65" stroke="#fff" strokeWidth="1" strokeLinecap="square"/>
                         </svg>
                    </div>
                    {evShown && (
                      <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(${lineX}px, 0)` }}>
                        <div className="absolute left-0 w-px bg-white/85" style={{ top: -EV_LINE, height: Math.max(0, EV_LINE + gapY - 11) }} />
                        <div className="absolute left-0 w-px bg-white/85" style={{ top: gapY + 11, height: Math.max(0, EV_LINE - gapY - 11) }} />
                        <svg width="20" height="20" viewBox="0 0 20 20" className="absolute" style={{ left: -10, top: gapY - 10 }} aria-hidden>
                          <circle cx="10" cy="10" r="3.6" fill="#fff" />
                          <g stroke="#fff" strokeWidth="1.4" strokeLinecap="round">
                            <path d="M10 1.6v2.2M10 16.2v2.2M1.6 10h2.2M16.2 10h2.2M4.06 4.06l1.56 1.56M14.38 14.38l1.56 1.56M4.06 15.94l1.56-1.56M14.38 5.62l1.56-1.56" />
                          </g>
                        </svg>
                      </div>
                    )}
                </div>
                );
            })()}

            <video ref={setVideoEl} autoPlay playsInline muted className="hidden" />
            <canvas ref={canvasRef} className="hidden" />

            {/* 這裡原本有一層「拍照中就整片白 + 一直脈動」的遮罩，
                拍照稍微久一點就變成白畫面閃個不停、看起來像沒在拍。
                真正的補光是相機的閃光燈在做，畫面不需要跟著變白。 */}

            {countdown !== null && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <span className="text-7xl font-black drop-shadow-2xl">{countdown}</span>
              </div>
            )}

            {/* RAW 開關：觀景窗左下角（跟內建相機一樣，關著的時候 RAW 上面有一條斜線） */}
            {!galleryCover && proMode && proRawSupported && (
              <button
                aria-label={proRaw ? '關閉 RAW' : '開啟 RAW'}
                aria-pressed={proRaw}
                onClick={(e) => {
                  e.stopPropagation();
                  setProRaw(v => !v);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                className={`cam-rot absolute bottom-[15px] left-3 z-[61] h-[30px] px-2 rounded-[8px] flex items-center justify-center backdrop-blur-xl active:scale-90 transition-[transform,background-color,color] duration-200 ${proRaw ? 'bg-white text-black' : 'bg-black/30 text-white/70'}`}
              >
                <span className="relative text-[11px] font-bold tracking-[0.04em] leading-none">
                  RAW
                </span>
              </button>
            )}

            {!galleryCover && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center z-[60] gap-2">
                {ZOOM_STEPS.map(({ label: val, factor }) => {
                  const unavailable = val === '0.5x' && !canWide;
                  /* 全螢幕縮放捏到的倍率：亮在不超過它的最大那一顆上，字改成實際倍率（跟內建相機一樣） */
                  const liveStep = liveZoom == null ? null : [...ZOOM_STEPS].reverse().find(z => z.factor <= liveZoom + 0.01)?.label ?? ZOOM_STEPS[0].label;
                  const on = liveStep ? liveStep === val : settings.focalLength === val;
                  const shown = on && liveZoom != null ? `${(Math.round(liveZoom * 10) / 10).toString()}×` : on ? val.replace('.0', '').replace('x', '×') : val.replace('.0', '').replace('x', '');
                  return (
                  <button 
                    key={val}
                    disabled={unavailable}
                    onClick={() => handleZoomClick(val)}
                    className={`cam-rot w-[34px] h-[34px] rounded-full flex items-center justify-center text-[10px] font-semibold tabular-nums tracking-[-0.02em] transition-[transform,background-color,color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] backdrop-blur-xl active:scale-90 ${on ? 'bg-white text-black scale-100 shadow-[0_2px_10px_rgba(0,0,0,0.35)]' : unavailable ? 'bg-black/30 text-white/20 scale-[0.82]' : 'bg-black/30 text-white/80 scale-[0.82]'}`}
                    data-zoom-factor={factor}
                  >
                    {shown}
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 比上一版下移 16px；仍比最初多留 24px，底部不會再顯得擁擠。 */}
      <section className="flex flex-col px-6 pt-4 pb-12">
        <div className={`flex justify-center relative mb-2 h-14`}>
          {activeControl === 'none' ? (
            <div data-camera-main-row key="camera-main-controls" className="flex items-center justify-between w-full max-sm px-0 h-14 gap-1 overflow-x-auto no-scrollbar [&>button]:w-[52px] [&>button]:h-[52px] [&>button]:flex [&>button]:items-center [&>button]:justify-center">
              <button onClick={() => setActiveControl('exposure')} className="relative p-3 active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] shrink-0 text-white/90">
                <Icon name="exposure" className="text-[25px]" />
              </button>
              
              <button aria-label="色溫" onClick={() => setActiveControl('kelvin')} className="relative p-3 w-[52px] h-[52px] flex items-center justify-center active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] shrink-0 text-white/90">
                <Icon name="device_thermostat" className="text-[25px]" />
              </button>

              <button 
                onClick={() => setAspectRatio(prev => ASPECT_CYCLE[(ASPECT_CYCLE.indexOf(prev) + 1) % ASPECT_CYCLE.length])}
                className="p-3 active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] flex flex-col items-center shrink-0 text-white/90"
              >
                <div className="w-[27px] h-[27px] border-[1.5px] border-current rounded-[7px] flex items-center justify-center">
                  <span className="text-[9.5px] font-semibold tracking-[-0.02em] leading-none tabular-nums">{aspectRatio}</span>
                </div>
              </button>

              <button
                disabled={!flashAvailable}
                title={flashAvailable ? '閃光燈' : '這顆鏡頭沒有閃光燈'}
                className={`relative p-3 active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] shrink-0 ${flashAvailable ? 'text-white/90' : 'text-white/25'}`}
                onClick={() => setFlashOn(!flashOn)}
              >
                  <Icon name="bolt" className="text-[25px]" fill={flashOn} />
              </button>

              <button aria-label="開啟特效" onClick={() => setActiveControl('effects')} className="relative p-3 active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] shrink-0 text-white/90">
                <Icon name="magic_button" className="text-[25px]" fill={fxOn} />
                <span aria-hidden className={`absolute bottom-[5px] left-1/2 -ml-[2px] w-1 h-1 rounded-full bg-white transition-[opacity,transform] duration-300 ${fxOn ? 'opacity-100 scale-100' : 'opacity-0 scale-0'}`} />
              </button>

              <button aria-label="切換鏡頭" onClick={toggleCamera} className="p-3 active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] shrink-0 text-white/90">
                <Icon name="flip_camera_ios" className="text-[25px]" />
              </button>
            </div>
          ) : activeControl === 'filters' ? (
            /* 濾鏡列跟其他控制列同一個 56px 高度：打開時上面的觀景窗、按鈕都不會被推動 */
            <div data-camera-filter-row className="w-full flex items-center h-full overflow-hidden animate-in fade-in duration-200">
               <div className="flex overflow-x-auto overflow-y-hidden w-full no-scrollbar gap-2 px-4 scroll-smooth items-center">
                 {lutList.map((lut, idx) => (
                   <button
                    key={lut.id}
                    onClick={() => { haptic('tick'); setSelectedLutIdx(idx); }}
                    className={`shrink-0 h-8 px-3.5 rounded-full text-[12px] font-medium whitespace-nowrap ring-1 ring-inset transition-[background-color,color,transform] duration-200 active:scale-95 ${selectedLutIdx === idx ? 'bg-white text-black ring-white' : 'bg-white/[0.07] text-white/70 ring-white/10'}`}
                   >
                     {lut.url ? lut.name : '原始'}
                   </button>
                 ))}
               </div>
            </div>
          ) : activeControl === 'effects' ? (
            /* 特效與曝光／白平衡共用同一個 56px 控制列高度，打開時觀景窗不會上移。 */
            <div data-camera-effects-row key="camera-effect-controls" className="w-full relative flex items-center justify-center animate-in h-full">
              {/* 剩兩個特效：每顆維持原本三等分的寬度，整組置中 */}
              <div className="flex justify-center gap-2 w-[calc(100%-96px)] min-w-0">
                {FX_ITEMS.map(it => {
                  const on = fx[it.id] > 0;
                  return (
                    <button
                      key={it.id}
                      aria-pressed={on}
                      data-camera-effect={it.id}
                      onClick={() => { triggerHaptic(); setFx(prev => ({ ...prev, [it.id]: on ? 0 : it.on })); }}
                      className={`min-w-0 w-[calc((100%-16px)/3)] shrink-0 px-1 h-10 rounded-full text-[11px] font-bold border transition-colors active:scale-95 ${
                        on ? 'bg-white text-black border-white' : 'bg-white/5 text-white/60 border-white/15'
                      }`}
                    >
                      {it.label}
                    </button>
                  );
                })}
              </div>
              <button aria-label="返回相機" data-camera-effects-back onClick={()=>{triggerHaptic();setActiveControl('none');}} className="absolute right-5 top-1/2 -translate-y-1/2 w-7 h-9 text-white/45 hover:text-white flex items-center justify-center active:scale-90 transition-all"><Icon name="expand_more" className="text-lg" /></button>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center animate-in h-full justify-center">
               <div className="w-full flex flex-col items-center">
                 <div className="mb-1 h-5 flex items-center justify-center">
                    <span className="text-[11px] font-semibold tracking-[0.16em] text-white/90 tabular-nums uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
                      {activeControl === 'kelvin' && `${settings.kelvin}K`}
                      {activeControl === 'exposure' && `EV ${(() => { const n = parseFloat(settings.exposure) || 0; return `${n > 0.049 ? '+' : ''}${n.toFixed(1)}`; })()}`}
                    </span>
                 </div>

                 <div className="flex items-center justify-center w-full px-5 relative">
                    {/* 收合鍵改成絕對定位；否則它會佔掉右側寬度，把整條刻度推離螢幕中心。 */}
                    <div
                      data-camera-scale={activeControl}
                      className="relative flex items-center h-12 w-[214px] max-w-[calc(100%-72px)] -translate-y-4"
                    >
                        {activeControl === 'exposure' && (
                          <CameraTickScale
                            label="曝光"
                            value={Math.round(parseFloat(settings.exposure) * 10)} min={-EV_MAX * 10} max={EV_MAX * 10} step={1}
                            /* 範圍改成 ±2 EV 後，手指走同樣距離的變化量要跟以前 ±1 EV 時一樣 */
                            sensitivity={2.16 / EV_MAX}
                            onStep={(raw, index) => {
                              const n = raw / 10;
                              const val = `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
                              if (val === settings.exposure) return;
                              triggerCameraTick('exposure', index);
                              setSettings(prev => ({ ...prev, exposure: val }));
                            }}
                          />
                        )}
                        {activeControl === 'kelvin' && (
                          <CameraTickScale
                            label="白平衡"
                            value={settings.kelvin} min={2500} max={9000} step={100}
                            /* 色溫有 65 格，跟曝光（20 格）用同一個靈敏度的話，手指動 1.5px 就跳一格（100K），
                               很難停在想要的值。改成手指約 5.5px 一格 —— 跟曝光每格的手感一樣。 */
                            sensitivity={0.6}
                            onStep={(val, index) => {
                              if (val === settings.kelvin) return;
                              triggerCameraTick('kelvin', index);
                              setSettings(prev => ({ ...prev, kelvin: val }));
                            }}
                          />
                        )}
                    </div>
                    <button onClick={() => { triggerHaptic(); setActiveControl('none'); }} className="absolute right-5 top-1/2 -translate-y-1/2 w-7 h-9 text-white/45 hover:text-white flex items-center justify-center active:scale-90 transition-all">
                      <Icon name="expand_more" className="text-lg" />
                    </button>
                 </div>
               </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 items-center w-full max-w-sm mx-auto pt-0">
          <div className="flex justify-center">
            <button onClick={() => setShowGallery(true)} className="cam-rot w-[58px] h-[58px] rounded-[16px] overflow-hidden bg-zinc-900 ring-1 ring-inset ring-white/15 active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]">
              {photos.length > 0 ? (
                 thumbs[photos[0]] ? <img key={photos[0]} src={thumbs[photos[0]]} className="w-full h-full object-cover animate-in fade-in zoom-in-50 duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]" alt="Latest" /> : <div className="w-full h-full bg-white/10" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Icon name="image" className="text-white/25 text-[22px]" />
                </div>
              )}
            </button>
          </div>

          <div className="flex justify-center">
            <button 
              aria-label="拍照"
              disabled={countdown !== null}
              aria-busy={isCapturing}
              className={`group relative w-[76px] h-[76px] flex items-center justify-center transition-opacity duration-200 ${countdown !== null ? 'opacity-50' : ''}`}
              onPointerDown={() => shutterPress(true)}
              onPointerUp={() => shutterPress(false)}
              onPointerCancel={() => shutterPress(false)}
              onPointerLeave={() => shutterPress(false)}
              onClick={() => {
                /* 拍照那一下主執行緒會忙一陣子（讀畫面、編碼）。按鈕的縮放動畫交給合成器跑（Web Animations），
                   真正開始拍再晚兩格，讓動畫先開始 —— 主執行緒忙的時候動畫照樣順 */
                if (!shutterAnimRef.current) shutterPress(true, true);
                if (countdown === null) haptic('shutter');
                requestAnimationFrame(() => requestAnimationFrame(handleShutterClick));
              }}
            >
              <div className="absolute inset-0 rounded-full border-[3px] border-white/90"></div>
              {/* 按下去內圈縮一點、放開彈回（跟原生相機一樣的手感） */}
              <div ref={shutterInnerRef} className="w-[62px] h-[62px] rounded-full bg-white" style={{ willChange: 'transform' }} />
            </button>
          </div>

          <div className="flex justify-center">
            <button 
              onClick={() => {
                triggerHaptic();
                setActiveControl(prev => prev === 'filters' ? 'none' : 'filters');
              }} 
              className={`w-12 h-12 rounded-full flex items-center justify-center ring-1 ring-inset active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${activeControl === 'filters' ? 'bg-white/20 ring-white/40' : 'bg-white/[0.07] ring-white/15'}`}
            >
              <Icon name="photo_camera" className={`cam-rot text-white text-[22px] transition-opacity ${activeControl === 'filters' ? 'opacity-100' : 'opacity-85'}`} />
            </button>
          </div>
        </div>
      </section>

      {showGallery && (
        <GalleryOverlay 
          photos={photos} 
          thumbs={thumbs}
          onClose={() => setShowGallery(false)}
          onCloseStart={() => { setGalleryLeaving(true); if (proModeRef.current) void nativeCamera().then(c => c?.setPreviewHidden?.({ hidden: false })).catch(() => {}); }} 
          rawShots={rawShots}
          suspended={!!editingPhoto}
          onDelete={(indices) => setPhotos(prev => {
            const del = new Set(indices);
            prev.forEach((u, i) => {
              if (!del.has(i)) return;
              /* 相機相簿資料夾裡的檔案一起刪掉（成品、沒印日期的、RAW） */
              const files = [nativePathOf(u), rawOfRef.current.get(u)?.path, (() => { const d = dateOfRef.current.get(u); return d ? nativePathOf(d.clean) : undefined; })()];
              void nativeImage().then(n => files.forEach(f => { if (f) void n?.remove({ path: f }).catch(() => {}); }));
              forgetRaw(u); forgetDate(u); releaseUrl(u); labelsRef.current.delete(u);
            });
            return prev.filter((_, i) => !del.has(i));
          })}
          onEdit={(src, idx) => openEditor(src, idx)}
          onViewing={src => { void prepRaw(src); }}
          onEditMany={openEditMany}
          favorites={favorites}
          onFavorite={(srcs, on) => setFavorites(prev => { const n = new Set(prev); srcs.forEach(s => on ? n.add(s) : n.delete(s)); return n; })}
          labelOf={src => labelsRef.current.get(src) ?? null}
        />
      )}

      {editingPhoto && createPortal(
        <div className={`fixed inset-0 z-[300] bg-black transition-transform duration-[440ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${editorLeaving ? 'translate-y-full' : editorEntered || editingPhoto.instant ? 'translate-x-0 translate-y-0' : 'translate-y-full'}`} style={editingPhoto.instant && !editorEntered ? { transition: 'none' } : undefined} data-camera-editor>
        <ImageEditor 
          compactBottomBar
          fullTabs={!!editingPhoto.pro}
          batchSrcs={editingPhoto.batch}
          key={editorId}
          imageSrc={editingPhoto.src}
          raw={editingPhoto.raw ?? null}
          stampDate={editingPhoto.date}
          initialState={editingPhoto.init ?? null}
          lutList={lutList}
          onSave={handleSaveEdit}
          onCancel={closeGalleryEditor}
          onHome={onHome}
          onImportNew={() => localFileInputRef.current?.click()}
        />
        </div>, document.body
      )}
    </div>
  );
};


/* ── 水平儀 ─────────────────────────────────────────────────────────
 * 原生端每秒 30 次送傾斜角度；只讓這個小元件自己重畫（整個相機頁跟著重畫太重）。
 * 跟內建相機一樣：兩邊兩小段固定，中間那段跟著地平線轉；擺平（±1°）時三段接成一條、變黃，震一下。
 * 差太多（超過 12°）或手機平放時不顯示。 */
const levelBus = (() => {
  const subs = new Set<(roll: number, flat: boolean) => void>();
  return {
    emit: (r: number, f: boolean) => subs.forEach(fn => fn(r, f)),
    on: (fn: (roll: number, flat: boolean) => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
})();

const LevelOverlay: React.FC<{ turns: number }> = ({ turns }) => {
  const [roll, setRoll] = useState<number | null>(null);
  useEffect(() => levelBus.on((r, flat) => setRoll(flat ? null : r)), []);
  /* 橫拿時「水平」的參考角度是 ±90° */
  const ref = turns === 1 ? -90 : turns === 3 ? 90 : 0;
  let dev = (roll ?? 999) - ref;
  while (dev > 180) dev -= 360;
  while (dev < -180) dev += 360;
  const visible = roll != null && Math.abs(dev) <= 12;
  const level = visible && Math.abs(dev) < 1;
  useEffect(() => { if (level) haptic('tick'); }, [level]);
  if (!visible) return null;
  const color = level ? '#ffd60a' : 'rgba(255,255,255,0.9)';
  return (
    <div aria-hidden className="absolute left-1/2 top-1/2 z-[30] pointer-events-none" style={{ rotate: 'var(--cam-rot, 0deg)', transition: 'rotate 460ms cubic-bezier(0.25,0.9,0.3,1)' }}>
      <div className="absolute -translate-y-1/2 h-px" style={{ left: -88, width: 34, background: color, boxShadow: '0 0 2px rgba(0,0,0,0.35)' }} />
      <div className="absolute -translate-y-1/2 h-px" style={{ left: 54, width: 34, background: color, boxShadow: '0 0 2px rgba(0,0,0,0.35)' }} />
      <div className="absolute -translate-y-1/2 h-px" style={{ left: level ? -54 : -44, width: level ? 108 : 88, background: color, rotate: `${level ? 0 : -dev}deg`, boxShadow: '0 0 2px rgba(0,0,0,0.35)', transition: 'left 160ms, width 160ms' }} />
    </div>
  );
};
