
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from './Icon';
import { CameraSettings } from '../types';
import { GalleryOverlay } from './GalleryOverlay';
import { usePhotoThumbs, thumbFromCanvas } from '../utils/photoThumbs';
import { Viewfinder, FX_ZERO, type ViewfinderFx } from './Viewfinder';
import { ImageEditor } from './ImageEditor';
import { createPortal } from 'react-dom';
import { processImageFile } from '../utils/imageLoader';
import {CAMERA_FX_ITEMS} from '../utils/cameraEffects';
import {preferCameraResolution} from '../utils/cameraPreview';
import { preloadFaceSkin } from '../utils/faceSkin';

// Extend MediaStream types to support zoom
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

const RAW_ACCEPT = "image/*,.heic,.heif,.dng,.cr2,.cr3,.nef,.arw,.orf,.rw2,.raf,.srw,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.tif";

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
  
  // Logic facing mode vs Visual facing mode (to prevent flip glitch)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [visualFacingMode, setVisualFacingMode] = useState<'user' | 'environment'>('environment');
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Ref to hold stream for reliable cleanup on unmount
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
  const [fx, setFx] = useState<ViewfinderFx>(FX_ZERO);
  const fxOn = FX_ITEMS.some(item => fx[item.id] > 0);

  const [flashOn, setFlashOn] = useState(false);
  
  // Default Aspect Ratio changed to 3:2
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:2');
  
  const [timer, setTimer] = useState<TimerMode>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  /** 人臉磨皮：只有開／關（強度固定），記住上次的選擇 */
  // 磨皮預設關閉，使用者打開過才記住（換一個鍵：上一版預設開啟時每個人都存了 1）
  const [skinSmooth, setSkinSmooth] = useState(() => { try { return localStorage.getItem('abai-camera-skin-v3') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('abai-camera-skin-v3', skinSmooth ? '1' : '0'); } catch { /* 私密模式 */ } }, [skinSmooth]);
  /* 找臉模型：打開設定選單（準備要按磨皮）就先開始載入；磨皮開著時載完才算好，開關上顯示載入中 */
  const [skinReady, setSkinReady] = useState(false);
  // 磨皮隨時待命：進相機、畫面穩定後（閒下來時）就在背景載好找臉模型，一按就有
  useEffect(() => {
    let live = true;
    const go = () => preloadFaceSkin().then(ok => { if (live) setSkinReady(ok); });
    const ric = (window as any).requestIdleCallback as ((f: () => void, o?: any) => number) | undefined;
    const id = ric ? ric(go, { timeout: 1500 }) : window.setTimeout(go, 800);
    return () => { live = false; if (ric) (window as any).cancelIdleCallback?.(id); else clearTimeout(id); };
  }, []);
  useEffect(() => {
    if (!showSettingsMenu && !skinSmooth) return;
    let live = true;
    preloadFaceSkin().then(ok => { if (live) setSkinReady(ok); });
    return () => { live = false; };
  }, [showSettingsMenu, skinSmooth]);
  
  const [focalLengthMm, setFocalLengthMm] = useState<string | null>(null);
  const focalLengthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 小框構圖 ─────────────────────────────────────────────
     frameZoomRef：目前框的倍率（1 = 沒有框）。拍照時讀這個。
     捏的過程不走 React state（見 SmallFrameOverlay），放手時才定下來。 */
  const frameZoomRef = useRef(1);
  const smallFrameRef = useRef<SmallFrameApi>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ d0: number; z0: number } | null>(null);
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
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const d = pinchDist();
      if (d > 8) {
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
    const p = pinchRef.current;
    if (!p || pointersRef.current.size < 2) return;
    const d = pinchDist();
    if (!d) return;
    // 框跟著手指走：兩指往內捏＝框往內縮，往外拉開＝框變大；拉回滿版框就消失
    const z = Math.max(1, Math.min(SMALL_FRAME_MAX, p.z0 * p.d0 / d));
    frameZoomRef.current = z;
    smallFrameRef.current?.set(z, true);
  };
  const onFramePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.delete(e.pointerId)) return;
    if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null;
      // 很接近 1 倍就直接收掉框，不留一條貼著邊的白線
      if (frameZoomRef.current < 1.04) frameZoomRef.current = 1;
      smallFrameRef.current?.set(frameZoomRef.current, false);
      focusGuardUntilRef.current = performance.now() + 400;
    }
    if (pointersRef.current.size === 0) setTimeout(() => { gesturePinchedRef.current = false; }, 0);
  };
  
  const [photos, setPhotos] = useState<string[]>([]);
  const { thumbs, seed: seedThumb } = usePhotoThumbs(photos);
  /* 只回收自己建立的 blob 網址；匯入的、編輯回存的字串不要亂動 */
  const ownedUrlsRef = useRef<Set<string>>(new Set());
  const releaseUrl = useCallback((url: string) => {
    if (ownedUrlsRef.current.has(url)) { URL.revokeObjectURL(url); ownedUrlsRef.current.delete(url); }
  }, []);
  useEffect(() => () => { ownedUrlsRef.current.forEach(u => URL.revokeObjectURL(u)); ownedUrlsRef.current.clear(); }, []);
  const [showGallery, setShowGallery] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState<{ src: string, index: number } | null>(null);
  /* 進相簿（或從相簿進編輯）就把小框收掉：回到相機時應該是重新開始的滿版畫面，
     不是停在上一次捏的位置。frameZoomRef 也一起歸 1，免得畫面上沒有框、拍下去卻還是裁過的。 */
  useEffect(() => {
    if (!showGallery && !editingPhoto) return;
    frameZoomRef.current = 1;
    pinchRef.current = null;
    smallFrameRef.current?.set(1, false);
  }, [showGallery, editingPhoto]);
  const [editorId, setEditorId] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isImportingLocal, setIsImportingLocal] = useState(false);
  const [localImportPreviewUrl, setLocalImportPreviewUrl] = useState<string | null>(null);

  const [focusPoint, setFocusPoint] = useState<{ x: number, y: number, nonce: number } | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocusEventRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const lastCameraTickRef = useRef<string>('');
  
  const localFileInputRef = useRef<HTMLInputElement>(null);

  // Measure container size for smooth aspect ratio transitions
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

  // Initialize Camera
  useEffect(() => {
    let mounted = true;
    const startCamera = async () => {
      // Stop any existing stream before starting a new one (using Ref for safety)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
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
            // If component unmounted during async call, stop stream immediately
            mediaStream.getTracks().forEach(t => t.stop());
            return;
        }

        setStream(mediaStream);
        streamRef.current = mediaStream; // Update Ref
        
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
        // Fallback
        if (!streamRef.current && mounted) {
             try {
                const basicStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                if (mounted) {
                    setStream(basicStream);
                    streamRef.current = basicStream; // Update Ref
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
        // Strictly stop all tracks on unmount using the Ref to release camera permissions immediately
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
        if (videoEl) {
            videoEl.srcObject = null;
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode, videoEl]);

  /* ---------- 閃光燈 ----------
     網頁連拍管線只使用不會暫停串流的 torch 約束。ImageCapture.takePhoto
     雖然有裝置能同步硬體閃光，但也正是部分行動 WebView 拍第二張會鎖死的來源；
     所以沒有 torch 就明確停用，不顯示一顆實際不會補光的按鈕。 */
  /* 注意是比對「值」不是「有沒有這個鍵」：部分裝置會列出 torch 但值是 false，
     只看鍵存不存在的話會誤判成有閃光燈，按下去卻什麼都不會發生。 */
  const hasTorch = (capabilities as any)?.torch === true;
  const flashAvailable = hasTorch;

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
  const canWide = !!hwZoom && (hwZoom.min ?? 1) < 1;

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

  /** 相機刻度保持安靜；只去重狀態更新，避免拖動時重複渲染同一格。 */
  const triggerCameraTick = useCallback((control: 'kelvin' | 'exposure', index: number) => {
    const key = `${control}:${index}`;
    if (lastCameraTickRef.current === key) return;
    lastCameraTickRef.current = key;
  }, []);

  /** 目前鏡頭的等效焦段（小框構圖的焦段＝這個 × 框的倍率） */
  const lensMm = parseInt(ZOOM_STEPS.find(z => z.label === settings.focalLength)?.mm || '24', 10) || 24;
  const handleZoomClick = (val: string) => {
    triggerHaptic();
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
    // 剛剛是雙指縮放小框，不是點一下對焦
    if (gesturePinchedRef.current || performance.now() < focusGuardUntilRef.current) return;
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
    /* 同一次觸控在新 WebKit 會依序送 pointerup 與 click。click 是舊版保底，
       但新版本不能因此讓相機硬體重做兩次對焦。 */
    const now = performance.now();
    const prevFocus = lastFocusEventRef.current;
    if (prevFocus && now - prevFocus.at < 180 && Math.hypot(x - prevFocus.x, y - prevFocus.y) < 3) return;
    lastFocusEventRef.current = { x, y, at: now };
    /* nonce 強制每次點擊都換一個節點，連續點同一位置時 CSS 動畫才會重播。 */
    setFocusPoint({ x, y, nonce: Date.now() });
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      setFocusPoint(null);
      focusTimerRef.current = null;
    }, 880);

    /* 把點到的位置換算成 0–1 的座標送給相機，才是真的「點哪裡對哪裡」。
       同時把測光點也指過去（專業相機 app 都是這樣一起做的）。
       裝置不支援指定座標時退回原本的持續自動對焦，行為跟以前一樣。 */
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
     ① applyConstraints 會讓相機重新設定一次（部分裝置那一下會停送一兩格），以前它跟對焦框的
        第一格擠在同一個事件裡，畫面要等它回來才畫得出對焦框 —— 看起來就是點下去頓一下。
        現在先讓對焦框畫出來（下一格之後才送），
     ② 連點的時候以前每一下都送一次，上一次還沒套完又來一次，相機就一直在重設。
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
  const capturePhoto = useCallback(async () => {
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
      // Never silently save the raw camera frame when the chosen processing
      // pipeline is unavailable: it would discard both the LUT and effects.
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
      // Each check is a GPU readback; remember the result instead of re-reading.
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
      // The 2D crop holds the photo now; give the full-size GPU buffers back
      // before JPEG encoding needs its own memory.
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
    
    // Calculate 3:2 Reference Height (Portrait 2:3 = 0.666...)
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
        // 16:9 (Portrait 9:16) - Requirement: Height matches 3:2 height
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

    /* 4:3、1:1 比 3:2 矮。外層是貼底排的，以前矮的框就整個沉到底、上面空一大塊。
       改成放在 3:2 那一格的正中間 —— 框的中心跟 3:2 時一樣，切換比例時是上下一起收，
       不是只有上緣往下掉。 */
    return { w: targetW, h: targetH, mb: Math.max(0, (h32 - targetH) / 2) };
  };

  const handleSaveEdit = (newSrc: string, shouldClose: boolean = true) => {
    if (editingPhoto) {
      setPhotos(prev => {
        const next = [...prev];
        releaseUrl(next[editingPhoto.index]);
        next[editingPhoto.index] = newSrc;
        return next;
      });
      if (shouldClose) {
        setEditingPhoto(null);
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
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(blob => {
                  const src = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
                  if (blob) ownedUrlsRef.current.add(src);
                  setPhotos(prev => [src, ...prev]);
                  setEditingPhoto({ src, index: 0 });
                  setEditorId(prev => prev + 1);
                }, 'image/png');
            }
            URL.revokeObjectURL(objectUrl);
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
    <div className="safe-top flex flex-col h-screen max-h-screen justify-end pb-6 overflow-hidden select-none bg-black font-sans text-white animate-in fade-in duration-300">
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

      {/* Hidden Input for Local 'Edit Next' Import */}
      <input 
        type="file" 
        ref={localFileInputRef} 
        className="hidden" 
        accept={RAW_ACCEPT}
        onChange={handleLocalFileChange}
      />

      <main className="flex-1 relative flex flex-col justify-end px-4 overflow-hidden">
        {/* pb-0 to lower viewfinder frame */}
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
            {!showGallery && !editingPhoto && activeControl !== 'filters' && activeControl !== 'effects' && (
              <div className="absolute top-1 left-2 z-50">
                <button
                  aria-label="返回主頁"
                  onClick={(e) => { e.stopPropagation(); onHome(); }}
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
              exposure={parseFloat(settings.exposure)}
              kelvin={settings.kelvin}
              isUserFacing={visualFacingMode === 'user'}
              fx={fx}
              digitalZoom={digitalZoom}
              displayBox={frameDims()}
              skinSmooth={skinSmooth}
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

            {/* Settings Menu Button */}
            <div className="absolute top-1 right-2 z-50">
                <button 
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        setShowSettingsMenu(!showSettingsMenu); 
                        triggerHaptic();
                    }}
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white active:scale-90 transition-transform"
                >
                    <Icon name="more_horiz" className="text-2xl drop-shadow-md" />
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
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 text-[13px] font-medium text-white/90">
                                <Icon name="skin_smooth" className="text-lg text-white/70" />
                                <span>磨皮</span>
                            </div>
                            <button
                                aria-label="人臉磨皮" aria-pressed={skinSmooth} data-camera-skin
                                onClick={(e) => { e.stopPropagation(); setSkinSmooth(!skinSmooth); triggerHaptic(); }}
                                className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] border border-white/10 ${skinSmooth ? 'bg-white/40' : 'bg-white/10'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)] flex items-center justify-center ${skinSmooth ? 'translate-x-5' : 'translate-x-0'}`}>
                                    {skinSmooth && !skinReady && <span aria-label="載入中" className="w-2.5 h-2.5 rounded-full border-[1.5px] border-black/20 border-t-black/70 animate-spin" />}
                                </div>
                            </button>
                        </div>
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
            
            {focusPoint && (
                <div
                    key={focusPoint.nonce}
                    className="absolute z-40 pointer-events-none"
                    style={{ left: focusPoint.x, top: focusPoint.y, transform: 'translate(-50%, -50%)' }}
                >
                    {/* 陰影改成畫在 SVG 裡的一條淡黑線：CSS 的 drop-shadow 濾鏡疊在每格都在重畫的
                        觀景窗上，縮放動畫的每一格都要重算一次模糊，對焦那一下就會頓。 */}
                    <div className="w-[78px] h-[78px] animate-[camFocusTap_0.92s_cubic-bezier(0.2,0.72,0.2,1)_forwards]" style={{ willChange: 'transform, opacity' }}>
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
                </div>
            )}

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

            {!showGallery && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center z-[60] gap-2">
                {ZOOM_STEPS.map(({ label: val }) => {
                  const unavailable = val === '0.5x' && !canWide;
                  return (
                  <button 
                    key={val}
                    disabled={unavailable}
                    onClick={() => handleZoomClick(val)}
                    className={`w-[34px] h-[34px] rounded-full flex items-center justify-center text-[10px] font-semibold tabular-nums tracking-[-0.02em] transition-[transform,background-color,color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] backdrop-blur-xl active:scale-90 ${settings.focalLength === val ? 'bg-white text-black scale-100 shadow-[0_2px_10px_rgba(0,0,0,0.35)]' : unavailable ? 'bg-black/30 text-white/20 scale-[0.82]' : 'bg-black/30 text-white/80 scale-[0.82]'}`}
                  >
                    {settings.focalLength === val ? val.replace('.0', '').replace('x', '×') : val.replace('.0', '').replace('x', '')}
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 比上一版下移 16px；仍比最初多留 24px，底部不會再顯得擁擠。 */}
      <section className="flex flex-col px-6 pt-4 pb-16">
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
                  <span aria-hidden className={`absolute bottom-[5px] left-1/2 -ml-[2px] w-1 h-1 rounded-full bg-white transition-[opacity,transform] duration-300 ${flashOn && flashAvailable ? 'opacity-100 scale-100' : 'opacity-0 scale-0'}`} />
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
                    onClick={() => { triggerHaptic(); setSelectedLutIdx(idx); }}
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
              <div className="grid grid-cols-3 gap-2 w-[calc(100%-96px)] min-w-0">
                {FX_ITEMS.map(it => {
                  const on = fx[it.id] > 0;
                  return (
                    <button
                      key={it.id}
                      aria-pressed={on}
                      data-camera-effect={it.id}
                      onClick={() => { triggerHaptic(); setFx(prev => ({ ...prev, [it.id]: on ? 0 : it.on })); }}
                      className={`min-w-0 px-1 h-10 rounded-full text-[11px] font-bold border transition-colors active:scale-95 ${
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
                      {activeControl === 'exposure' && `EV ${settings.exposure}`}
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
                            value={Math.round(parseFloat(settings.exposure) * 10)} min={-10} max={10} step={1}
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
            <button onClick={() => setShowGallery(true)} className="w-12 h-12 rounded-[14px] overflow-hidden bg-zinc-900 ring-1 ring-inset ring-white/15 active:scale-[0.86] transition-[transform,opacity,color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]">
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
              onClick={handleShutterClick}
            >
              <div className="absolute inset-0 rounded-full border-[3px] border-white/90"></div>
              {/* 按下去內圈縮一點、放開彈回（跟原生相機一樣的手感） */}
              <div className={`w-[62px] h-[62px] rounded-full bg-white transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-active:scale-[0.86] ${isCapturing ? 'scale-[0.86]' : ''}`} />
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
              <Icon name="photo_camera" className={`text-white text-[22px] transition-opacity ${activeControl === 'filters' ? 'opacity-100' : 'opacity-85'}`} />
            </button>
          </div>
        </div>
      </section>

      {showGallery && (
        <GalleryOverlay 
          photos={photos} 
          thumbs={thumbs}
          onClose={() => setShowGallery(false)} 
          onDelete={(idx) => setPhotos(prev => { releaseUrl(prev[idx]); return prev.filter((_, i) => i !== idx); })}
          onImport={(newPhotos) => setPhotos(prev => [...newPhotos, ...prev])}
          onEdit={(src, idx) => { setShowGallery(false); setEditingPhoto({ src, index: idx }); setEditorId(prev => prev + 1); }}
        />
      )}

      {editingPhoto && createPortal(
        <div className="fixed inset-0 z-[300] bg-black" data-camera-editor>
        <ImageEditor 
          compactBottomBar
          key={editorId}
          imageSrc={editingPhoto.src}
          lutList={lutList}
          onSave={handleSaveEdit}
          onCancel={() => setEditingPhoto(null)}
          onHome={onHome}
          onImportNew={() => localFileInputRef.current?.click()}
        />
        </div>, document.body
      )}
    </div>
  );
};
