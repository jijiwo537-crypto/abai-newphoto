
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from './Icon';
import { CameraSettings } from '../types';
import { GalleryOverlay } from './GalleryOverlay';
import { Viewfinder, FX_ZERO, type ViewfinderFx } from './Viewfinder';
import { ImageEditor } from './ImageEditor';
import { processImageFile } from '../utils/imageLoader';

// Extend MediaStream types to support zoom
declare global {
  interface MediaTrackCapabilities {
    zoom?: { min: number; max: number };
  }
  interface MediaTrackConstraintSet {
    zoom?: number;
  }
}

type AspectRatio = '16:9' | '3:2';
type TimerMode = 0 | 3 | 10;
type ActiveControl = 'none' | 'kelvin' | 'exposure' | 'filters' | 'effects';

/* 拍照時就能即時看到的三種特效。名稱與滑桿範圍跟編輯頁一致，
   拍下來的就是畫面上看到的樣子（快門是直接抓 WebGL 畫布）。 */
/* 跟編輯頁同款的兩個特效（編輯頁的「朦朧」就是這條模糊）。
   拍照時只要開關，不用調整 —— 強度固定用調好的這一組。 */
const FX_ITEMS: { id: keyof ViewfinderFx; label: string; on: number }[] = [
  { id: 'soft', label: '柔光', on: 70 },
  { id: 'blur', label: '朦朧', on: 70 },
];

/** 變焦按鈕上寫幾倍就真的是幾倍 */
const ZOOM_STEPS: { label: string; factor: number; mm: string }[] = [
  { label: '0.5x', factor: 0.5, mm: '13mm' },
  { label: '1.0x', factor: 1.0, mm: '24mm' },
  { label: '2.0x', factor: 2.0, mm: '48mm' },
  { label: '3.0x', factor: 3.0, mm: '77mm' },
];

/** 把畫布存成無損 PNG 的 Blob 網址 —— dataURL 字串會把記憶體吃光 */
const canvasToBlobUrl = (cvs: HTMLCanvasElement): Promise<string> =>
  new Promise((resolve, reject) => {
    cvs.toBlob(b => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob failed'))), 'image/png');
  });

interface CameraInterfaceProps {
  onHome: () => void;
  lutList: { id: string, name: string, url: string }[];
  onImportNew?: () => void;
}

const RAW_ACCEPT = "image/*,.heic,.heif,.dng,.cr2,.cr3,.nef,.arw,.orf,.rw2,.raf,.srw,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.tif";

export const CameraInterface: React.FC<CameraInterfaceProps> = ({ onHome, lutList, onImportNew }) => {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewfinderRef = useRef<{ getCanvas: () => HTMLCanvasElement | null }>(null);
  
  // Logic facing mode vs Visual facing mode (to prevent flip glitch)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [visualFacingMode, setVisualFacingMode] = useState<'user' | 'environment'>('environment');
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Ref to hold stream for reliable cleanup on unmount
  const streamRef = useRef<MediaStream | null>(null);

  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [capabilities, setCapabilities] = useState<MediaTrackCapabilities | null>(null);

  const [settings, setSettings] = useState<CameraSettings>({
    kelvin: 5200,
    focalLength: '1.0x',
    exposure: '0.0'
  });
  
  const [activeControl, setActiveControl] = useState<ActiveControl>('none');
  const [selectedLutIdx, setSelectedLutIdx] = useState(0);
  const [fx, setFx] = useState<ViewfinderFx>(FX_ZERO);
  const fxOn = fx.soft > 0 || fx.blur > 0;
  const [flashOn, setFlashOn] = useState(false);
  
  // Default Aspect Ratio changed to 3:2
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:2');
  
  const [timer, setTimer] = useState<TimerMode>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  
  const [focalLengthMm, setFocalLengthMm] = useState<string | null>(null);
  const focalLengthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [photos, setPhotos] = useState<string[]>([]);
  /* 只回收自己建立的 blob 網址；匯入的、編輯回存的字串不要亂動 */
  const ownedUrlsRef = useRef<Set<string>>(new Set());
  const releaseUrl = useCallback((url: string) => {
    if (ownedUrlsRef.current.has(url)) { URL.revokeObjectURL(url); ownedUrlsRef.current.delete(url); }
  }, []);
  useEffect(() => () => { ownedUrlsRef.current.forEach(u => URL.revokeObjectURL(u)); ownedUrlsRef.current.clear(); }, []);
  const [showGallery, setShowGallery] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState<{ src: string, index: number } | null>(null);
  const [editorId, setEditorId] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isImportingLocal, setIsImportingLocal] = useState(false);
  const [localImportPreviewUrl, setLocalImportPreviewUrl] = useState<string | null>(null);

  const [focusPoint, setFocusPoint] = useState<{ x: number, y: number, visible: boolean } | null>(null);
  
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
            facingMode: { exact: facingMode },
            width: { ideal: 3840 }, 
            height: { ideal: 2160 } 
          },
          audio: false
        };

        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
           mediaStream = await navigator.mediaDevices.getUserMedia({
             ...constraints,
             video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }
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
        setVideoTrack(vTrack);
        setCapabilities(vTrack.getCapabilities());

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
                    setVideoTrack(basicStream.getVideoTracks()[0]);
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

  /* 閃光燈只在按下快門那一刻亮，不再一直開著手電筒。
     前鏡頭沒有手電筒，改用整片白色螢幕補光（真的相機 app 都是這樣做）。 */
  const hasTorch = !!capabilities && 'torch' in capabilities;
  const [screenFlash, setScreenFlash] = useState(false);

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

  const applyZoom = useCallback((zoomFactor: string) => {
    const want = ZOOM_STEPS.find(z => z.label === zoomFactor)?.factor ?? 1;
    const min = hwZoom?.min ?? 1;
    const max = hwZoom?.max ?? 1;

    const hw = hwZoom ? Math.max(min, Math.min(max, want)) : 1;
    // 硬體只到 2 倍、想要 3 倍的話，剩下的 1.5 倍交給數位變焦
    setDigitalZoom(Math.max(1, want / hw));

    if (!videoTrack || !hwZoom) return;
    try {
        videoTrack.applyConstraints({ advanced: [{ zoom: hw }] });
    } catch (e) {
        console.warn("Zoom not supported", e);
    }
  }, [videoTrack, hwZoom]);

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

  const handleZoomClick = (val: string) => {
    triggerHaptic();
    setSettings(prev => ({ ...prev, focalLength: val }));
    setFocalLengthMm(ZOOM_STEPS.find(z => z.label === val)?.mm || '');
    if (focalLengthTimerRef.current) clearTimeout(focalLengthTimerRef.current);
    focalLengthTimerRef.current = setTimeout(() => setFocalLengthMm(null), 1000);
  };

  const handleFocus = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (showSettingsMenu) {
        setShowSettingsMenu(false);
        return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    setFocusPoint({ x, y, visible: true });
    
    setTimeout(() => {
        setFocusPoint(prev => prev ? { ...prev, visible: false } : null);
    }, 800);

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
        if (Object.keys(adv).length) {
          try { videoTrack.applyConstraints({ advanced: [adv] }); } catch(e) {}
        }
    }
  };

  /* 有些裝置的 takePhoto／applyConstraints 會卡住不回來，
     整個拍照流程就停在半路 —— 白畫面收不掉、快門也一直是停用的。
     所有會跟相機硬體打交道的呼叫一律加上時限，逾時就走下一條路。 */
  const withLimit = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  const capturingRef = useRef(false);
  const capturePhoto = useCallback(async () => {
    if (!viewfinderRef.current) return;
    if (capturingRef.current) return;      // 上一張還沒拍完就不要再進來
    capturingRef.current = true;

    try {
    /* 閃光：後鏡頭點手電筒；前鏡頭沒有手電筒，改把螢幕整片打白當補光。
       後鏡頭如果連手電筒都沒有，打白螢幕照不到被攝物，只會閃一下眼睛，
       所以就不打了。 */
    let torchOn = false;
    if (flashOn) {
      try { torchOn = await withLimit(setTorch(true), 800); } catch { torchOn = false; }
      if (!torchOn && visualFacingMode === 'user') setScreenFlash(true);
      await new Promise(r => setTimeout(r, 260));
    }

    setIsCapturing(true);

    /* 跟相機要一張「完整感光元件解析度」的靜態照，再走跟預覽同一條 GPU
       管線 —— 顏色、濾鏡、特效完全一致，但畫素比預覽影像多好幾倍。

       要用 takePhoto()：grabFrame() 取的只是「預覽影像」那一幀，解析度
       跟預覽一模一樣，換了等於沒換。takePhoto 才會真的按下感光元件那一張，
       而且要自己把 imageWidth/imageHeight 指定成裝置支援的最大值，
       不指定的話多數裝置只會給預設（通常還是預覽大小）。

       iOS Safari 至今沒有 ImageCapture，會自動落到下面的退路，
       解析度跟原本一樣，不會變差。 */
    let webglCanvas: HTMLCanvasElement | null = null;
    const vf = viewfinderRef.current as any;
    const liveW = videoEl?.videoWidth || 0;
    try {
      const IC = (window as any).ImageCapture;
      if (IC && videoTrack && vf.renderStill) {
        const ic = new IC(videoTrack);
        let bmp: ImageBitmap | null = null;
        try {
          let opts: any = undefined;
          try {
            const caps: any = await withLimit<any>(ic.getPhotoCapabilities(), 800);
            if (caps?.imageWidth?.max && caps?.imageHeight?.max) {
              opts = { imageWidth: caps.imageWidth.max, imageHeight: caps.imageHeight.max };
            }
          } catch { /* 拿不到能力表就用預設設定拍 */ }
          const blob: any = await withLimit<any>(ic.takePhoto(opts), 2500);
          if (blob) bmp = await createImageBitmap(blob);
        } catch {
          // takePhoto 在部分裝置上不穩，退一步用預覽那一幀
          try { bmp = await withLimit<any>(ic.grabFrame(), 800); } catch { bmp = null; }
        }
        if (bmp && bmp.width > liveW) {
          webglCanvas = vf.renderStill(bmp, bmp.width, bmp.height);
        }
        if (bmp && (bmp as any).close) (bmp as any).close();
      }
    } catch (e) { /* 不支援就用預覽畫布，畫質跟原本一樣 */ }
    if (!webglCanvas) webglCanvas = viewfinderRef.current.getCanvas();

    if (torchOn) setTorch(false);
    setScreenFlash(false);

    if (webglCanvas) {
      // Crop logic based on aspectRatio
      let targetRatio = 2/3; // Default 3:2 (Portrait 2:3)
      if (aspectRatio === '16:9') targetRatio = 9/16;
      
      const srcW = webglCanvas.width;
      const srcH = webglCanvas.height;
      const srcRatio = srcW / srcH;
      
      let cropW = srcW;
      let cropH = srcH;
      let offsetX = 0;
      let offsetY = 0;

      // Calculate crop dimensions to center the crop
      if (srcRatio > targetRatio) {
        // Source is wider than target, crop width
        cropW = srcH * targetRatio;
        cropH = srcH;
        offsetX = (srcW - cropW) / 2;
      } else {
        // Source is taller than target (or same), crop height (if needed)
        cropW = srcW;
        cropH = srcW / targetRatio;
        offsetY = (srcH - cropH) / 2;
      }

      const tempCvs = document.createElement('canvas');
      tempCvs.width = cropW;
      tempCvs.height = cropH;
      const ctx = tempCvs.getContext('2d');
      if (ctx) {
        /* 前鏡頭的預覽是鏡像的（照鏡子的感覺），但存下來要是正常方向，
           不然字會反過來 —— 這裡把它翻回去。 */
        if (visualFacingMode === 'user') {
          ctx.translate(cropW, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(webglCanvas, offsetX, offsetY, cropW, cropH, 0, 0, cropW, cropH);
        try {
          const url = await canvasToBlobUrl(tempCvs);
          ownedUrlsRef.current.add(url);
          setPhotos(prev => [url, ...prev]);
        } catch (e) {
          setPhotos(prev => [tempCvs.toDataURL('image/png'), ...prev]);
        }
      }
    }
    } finally {
      /* 不管中間哪一步出錯，白畫面一定要收掉、快門一定要恢復，
         不然畫面就會卡在一片白、看起來像「一直沒拍」。 */
      setScreenFlash(false);
      capturingRef.current = false;
      setTimeout(() => setIsCapturing(false), 200);
    }
  }, [aspectRatio, flashOn, setTorch, videoTrack, videoEl, visualFacingMode]);

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

  const getFrameStyle = (): React.CSSProperties => {
    if (containerSize.w === 0 || containerSize.h === 0) return { opacity: 0 };

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
      case '3:2':
      default:
        targetH = h32;
        targetW = w32;
        break;
    }

    return { 
        width: `${targetW}px`, 
        height: `${targetH}px` 
    };
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
    <div className="flex flex-col h-screen max-h-screen justify-end pb-4 overflow-hidden select-none bg-black font-sans text-white animate-in fade-in duration-300">
      
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

      {/* Home Button (Top Left) */}
      {/* 前鏡頭沒有手電筒，按快門時整片打白當補光 */}
      {screenFlash && (
        <div className="fixed inset-0 z-[300] bg-white pointer-events-none" />
      )}

      {/* 濾鏡／特效面板打開時退出鍵先收起來，關掉面板才回來 */}
      {!showGallery && !editingPhoto && activeControl !== 'filters' && activeControl !== 'effects' && (
        <div className="absolute top-2 left-4 z-[60]">
           <button 
             onClick={() => { onHome(); }} 
             className="w-10 h-10 rounded-full flex items-center justify-center text-white/70 hover:text-white transition-colors"
           >
             <Icon name="arrow_back" className="text-2xl" />
           </button>
        </div>
      )}

      <div className="h-[2vh]"></div>

      <main className="flex-1 relative flex flex-col justify-end px-4 overflow-hidden">
        {/* pb-0 to lower viewfinder frame */}
        <div className="w-full h-full flex items-end justify-center pb-0" ref={containerRef}>
          <div 
            className="relative rounded-camera overflow-hidden bg-zinc-900 shadow-2xl flex items-center justify-center border border-white/5 transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
            style={getFrameStyle()}
          >
            <Viewfinder 
              ref={viewfinderRef}
              video={videoEl}
              lutUrl={lutList[selectedLutIdx].url}
              exposure={parseFloat(settings.exposure)}
              kelvin={settings.kelvin}
              isUserFacing={visualFacingMode === 'user'}
              fx={fx}
              digitalZoom={digitalZoom}
              onClick={handleFocus}
            />

            {showGrid && (
                <div className="absolute inset-0 z-10 pointer-events-none w-full h-full">
                    <div className="absolute top-1/3 left-0 right-0 h-[1.5px] bg-white/30"></div>
                    <div className="absolute top-2/3 left-0 right-0 h-[1.5px] bg-white/30"></div>
                    <div className="absolute left-1/3 top-0 bottom-0 w-[1.5px] bg-white/30"></div>
                    <div className="absolute left-2/3 top-0 bottom-0 w-[1.5px] bg-white/30"></div>
                </div>
            )}
            
            {focalLengthMm && (
                <div 
                    key={focalLengthMm} 
                    className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
                >
                    <div className="text-sm font-medium text-white animate-[fadeOut_1s_ease-out_forwards] tracking-[0.1em] leading-none select-none mr-[-0.1em] translate-y-4">
                        {focalLengthMm}
                    </div>
                    <style>{`@keyframes fadeOut { 0% { opacity: 1; } 50% { opacity: 1; } 100% { opacity: 0; } }`}</style>
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
                    <div className="absolute top-12 right-2 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl p-3 w-40 shadow-2xl flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200 origin-top-right select-none" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-bold text-white/90">
                                <Icon name="grid_3x3" className="text-lg text-white/70" />
                                <span>構圖線</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); setShowGrid(!showGrid); triggerHaptic(); }}
                                className={`w-11 h-6 rounded-full p-1 transition-all duration-300 backdrop-blur-md border border-white/10 ${showGrid ? 'bg-white/40' : 'bg-white/10'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${showGrid ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-bold text-white/90">
                                <Icon name="timer" className="text-lg text-white/70" />
                                <span>定時</span>
                            </div>
                            <button 
                                onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setTimer(prev => prev === 0 ? 3 : prev === 3 ? 10 : 0);
                                    triggerHaptic();
                                }}
                                className="h-6 px-2 rounded-md bg-white/10 text-[10px] font-black border border-white/10 min-w-[3rem] flex items-center justify-center hover:bg-white/20 transition-colors"
                            >
                                {timer === 0 ? 'OFF' : `${timer}s`}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            
            {focusPoint && focusPoint.visible && (
                <div 
                    className="absolute z-40 pointer-events-none"
                    style={{ left: focusPoint.x, top: focusPoint.y, transform: 'translate(-50%, -50%)' }}
                >
                    <div className="w-14 h-14 animate-[focusSnap_0.3s_cubic-bezier(0.175,0.885,0.32,1.275)_forwards]">
                         <svg width="100%" height="100%" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                             <path d="M4 12V4H12" stroke="white" strokeWidth="1" strokeLinecap="square"/>
                             <path d="M28 4H36V12" stroke="white" strokeWidth="1" strokeLinecap="square"/>
                             <path d="M4 28V36H12" stroke="white" strokeWidth="1" strokeLinecap="square"/>
                             <path d="M28 36H36V28" stroke="white" strokeWidth="1" strokeLinecap="square"/>
                         </svg>
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-1 h-1 bg-white rounded-full animate-[focusFlash_0.4s_ease-out_forwards_0.1s] opacity-0"></div>
                    </div>
                    <style>{`
                        @keyframes focusSnap { 0% { transform: scale(1.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
                        @keyframes focusFlash { 0% { opacity: 0; transform: scale(0.5); } 50% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0; transform: scale(1); } }
                    `}</style>
                </div>
            )}
            
            <video ref={setVideoEl} autoPlay playsInline muted className="hidden" />
            <canvas ref={canvasRef} className="hidden" />

            {isCapturing && flashOn && <div className="absolute inset-0 bg-white z-20 animate-pulse"></div>}

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
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-black transition-all border backdrop-blur-2xl ${settings.focalLength === val ? 'bg-white text-black border-white shadow-xl scale-110' : unavailable ? 'bg-black/20 border-white/5 text-white/20' : 'bg-black/20 border-white/10 text-white/60 hover:bg-black/40'}`}
                  >
                    {val.replace('.0', '')}
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Toolbar section: pt-4 pb-10 */}
      <section className="flex flex-col px-6 pt-4 pb-10">
        <div className={`flex justify-center relative mb-2 transition-all duration-300 ${activeControl === 'filters' || activeControl === 'effects' ? 'h-30' : 'h-14'}`}>
          {activeControl === 'none' ? (
            <div className="flex items-center justify-between w-full max-sm px-0 animate-in h-full gap-1 overflow-x-auto no-scrollbar">
              <button onClick={() => setActiveControl('exposure')} className="p-3 active:scale-90 transition-transform shrink-0">
                <Icon name="exposure" className="text-[28px]" />
              </button>
              
              <button onClick={() => setActiveControl('kelvin')} className="p-3 active:scale-90 transition-transform shrink-0">
                <Icon name="device_thermostat" className="text-[28px]" />
              </button>

              <button 
                onClick={() => setAspectRatio(prev => prev === '3:2' ? '16:9' : '3:2')} 
                className="p-3 active:scale-90 transition-transform flex flex-col items-center shrink-0"
              >
                <div className="w-8 h-8 border-[2px] border-white rounded-[6px] flex items-center justify-center">
                  <span className="text-[10px] font-black leading-none">{aspectRatio}</span>
                </div>
              </button>

              <button className="p-3 active:scale-90 transition-transform shrink-0 text-white" onClick={() => setFlashOn(!flashOn)}>
                  <Icon name="bolt" className="text-[28px]" fill={flashOn} />
              </button>

              <button onClick={() => setActiveControl('effects')} className="p-3 active:scale-90 transition-transform shrink-0 text-white">
                <Icon name="magic_button" className="text-[28px]" fill={fxOn} />
              </button>

              <button onClick={toggleCamera} className="p-3 active:scale-90 transition-transform shrink-0">
                <Icon name="flip_camera_ios" className="text-[28px]" />
              </button>
            </div>
          ) : activeControl === 'filters' ? (
            <div className="w-full flex items-end animate-in h-full overflow-hidden justify-center pb-1">
               <div className="flex overflow-x-auto overflow-y-hidden w-full no-scrollbar gap-2 px-4 scroll-smooth min-h-[84px] items-center">
                 {lutList.map((lut, idx) => (
                   <button 
                    key={lut.id} 
                    onClick={() => { triggerHaptic(); setSelectedLutIdx(idx); }}
                    className="flex flex-col items-center gap-2 group flex-shrink-0"
                   >
                     <div className={`w-16 h-16 rounded-xl border-2 transition-all ${selectedLutIdx === idx ? 'border-white scale-105 shadow-lg' : 'border-white/10 opacity-60'}`}>
                        <div className="w-full h-full bg-zinc-800 rounded-lg overflow-hidden flex flex-col items-center justify-center relative">
                          {!lut.url ? (
                            <>
                                <Icon name="do_not_disturb_on" className="text-white/40 text-xl mb-0.5" />
                                <span className="text-[10px] font-bold text-white/60 leading-none">原始</span>
                            </>
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-700/50">
                                <Icon name="photo_camera" className="text-white/20 text-2xl mb-1" />
                                <span className="text-[9px] font-bold text-white/80 leading-tight text-center px-1 uppercase truncate w-full">
                                    {lut.name}
                                </span>
                            </div>
                          )}
                        </div>
                     </div>
                   </button>
                 ))}
               </div>
            </div>
          ) : activeControl === 'effects' ? (
            <div className="w-full flex flex-col items-center animate-in h-full justify-center gap-3 px-4">
              <div className="flex items-center justify-center gap-3">
                {FX_ITEMS.map(it => {
                  const on = fx[it.id] > 0;
                  return (
                    <button
                      key={it.id}
                      onClick={() => { triggerHaptic(); setFx(prev => ({ ...prev, [it.id]: on ? 0 : it.on })); }}
                      className={`px-5 h-10 rounded-full text-[12px] font-bold tracking-[0.12em] border transition-all active:scale-90 ${
                        on ? 'bg-white text-black border-white' : 'bg-white/5 text-white/60 border-white/15'
                      }`}
                    >
                      {it.label}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => { triggerHaptic(); setActiveControl('none'); }} className="w-7 h-7 bg-white/5 hover:bg-white/15 text-white/40 hover:text-white rounded-full flex items-center justify-center active:scale-90 transition-all border border-white/5 backdrop-blur-lg">
                <Icon name="expand_more" className="text-base" />
              </button>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center animate-in h-full justify-center">
               <div className="w-full flex flex-col items-center">
                 <div className="mb-1">
                    <span className="text-[10px] font-bold tracking-[0.2em] text-white/90 bg-white/10 px-4 py-1 rounded-full border border-white/10 backdrop-blur-xl uppercase">
                      {activeControl === 'kelvin' && `${settings.kelvin}K`}
                      {activeControl === 'exposure' && `EV ${settings.exposure}`}
                    </span>
                 </div>

                 <div className="flex items-center w-full px-4 relative">
                    <div className="w-8"></div>
                    <div className="flex-1 flex justify-center">
                      <div className="relative flex items-center h-8 w-full max-w-[220px]">
                        {activeControl === 'exposure' && (
                          <>
                            {/* Visual Track */}
                            <div className="absolute inset-x-0 h-4 z-0 flex items-center overflow-hidden pointer-events-none">
                                <div className="w-full h-full opacity-30" style={{ background: 'repeating-linear-gradient(90deg, #fff, #fff 1px, transparent 1px, transparent 10px)', maskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)' }} />
                                <div className="absolute left-1/2 -translate-x-1/2 w-[1.5px] h-full bg-white/60"></div>
                            </div>
                            
                            {/* Visual Thumb - Independent of input */}
                            <div 
                                className="absolute top-1/2 -translate-y-1/2 h-8 w-[2px] bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,1)] z-10 pointer-events-none transition-none"
                                style={{ left: `${((parseFloat(settings.exposure) + 1) / 2) * 100}%`, transform: 'translate(-50%, -50%)' }}
                            ></div>

                            {/* Interactive Input - Invisible but large hit area */}
                            <input 
                                type="range" 
                                min="-1" 
                                max="1" 
                                step="0.1" 
                                value={parseFloat(settings.exposure)} 
                                onChange={(e) => { const rawVal = parseFloat(e.target.value); const val = (rawVal > 0 ? '+' : '') + rawVal.toFixed(1); if (val !== settings.exposure) { triggerHaptic(); setSettings(prev => ({ ...prev, exposure: val })); } }} 
                                className="absolute left-0 -top-4 w-full h-16 opacity-0 z-20 cursor-pointer [&::-webkit-slider-thumb]:w-12 [&::-webkit-slider-thumb]:h-12 [&::-webkit-slider-thumb]:appearance-none" 
                            />
                          </>
                        )}
                        {activeControl === 'kelvin' && (
                          <>
                            <div className="absolute inset-x-0 h-6 z-0 flex items-center justify-center overflow-hidden pointer-events-none">
                                <div className="absolute inset-x-0 h-[2px] blur-[8px] opacity-60" style={{ background: 'linear-gradient(to right, #FF8A00, #FFC700, #FFFFFF, #B4DFFF, #0094FF)' }} />
                                <div className="w-full h-4 opacity-40" style={{ background: 'repeating-linear-gradient(90deg, #fff, #fff 1px, transparent 1px, transparent 12px)', maskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)' }} />
                            </div>

                            <div 
                                className="absolute top-1/2 -translate-y-1/2 h-8 w-[2px] bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,1)] z-10 pointer-events-none transition-none"
                                style={{ left: `${((settings.kelvin - 2500) / 6500) * 100}%`, transform: 'translate(-50%, -50%)' }}
                            ></div>

                            <input 
                                type="range" 
                                min="2500" 
                                max="9000" 
                                step="100" 
                                value={settings.kelvin} 
                                onChange={(e) => { const val = parseInt(e.target.value); if (val !== settings.kelvin) { triggerHaptic(); setSettings(prev => ({ ...prev, kelvin: val })); } }} 
                                className="absolute left-0 -top-4 w-full h-16 opacity-0 z-20 cursor-pointer [&::-webkit-slider-thumb]:w-12 [&::-webkit-slider-thumb]:h-12 [&::-webkit-slider-thumb]:appearance-none" 
                            />
                          </>
                        )}
                      </div>
                    </div>
                    <button onClick={() => { triggerHaptic(); setActiveControl('none'); }} className="flex-shrink-0 w-8 h-8 bg-white/5 hover:bg-white/15 text-white/40 hover:text-white rounded-full flex items-center justify-center active:scale-90 transition-all border border-white/5 backdrop-blur-lg">
                      <Icon name="expand_more" className="text-lg" />
                    </button>
                 </div>
               </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 items-center w-full max-w-sm mx-auto pt-0">
          <div className="flex justify-center">
            <button onClick={() => setShowGallery(true)} className="w-14 h-14 rounded-2xl overflow-hidden border border-white/10 bg-zinc-900 active:scale-90 transition-all shadow-lg ring-1 ring-white/5">
              {photos.length > 0 ? (
                 <img src={photos[0]} className="w-full h-full object-cover" alt="Latest" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Icon name="image" className="text-white/10 text-2xl" />
                </div>
              )}
            </button>
          </div>

          <div className="flex justify-center">
            <button 
              disabled={countdown !== null || isCapturing}
              className={`relative w-[72px] h-[72px] flex items-center justify-center transition-all ${countdown !== null || isCapturing ? 'opacity-50' : 'active:scale-95'}`}
              onClick={handleShutterClick}
            >
              <div className="absolute inset-0 rounded-full border-[2.5px] border-white/30"></div>
              <div className="w-[58px] h-[58px] rounded-full flex items-center justify-center shadow-2xl bg-white">
                 <div className="w-[54px] h-[54px] rounded-full border border-black/5"></div>
              </div>
            </button>
          </div>

          <div className="flex justify-center">
            <button 
              onClick={() => {
                triggerHaptic();
                setActiveControl(prev => prev === 'filters' ? 'none' : 'filters');
              }} 
              className={`w-14 h-14 rounded-2xl bg-white/5 backdrop-blur-xl flex items-center justify-center border border-white/10 active:scale-90 transition-all hover:bg-white/10 ${activeControl === 'filters' ? 'bg-white/20 border-white/40 shadow-inner' : ''}`}
            >
              <Icon name="photo_camera" className={`text-white text-2xl transition-opacity ${activeControl === 'filters' ? 'opacity-100' : 'opacity-80'}`} />
            </button>
          </div>
        </div>
      </section>

      {showGallery && (
        <GalleryOverlay 
          photos={photos} 
          onClose={() => setShowGallery(false)} 
          onDelete={(idx) => setPhotos(prev => { releaseUrl(prev[idx]); return prev.filter((_, i) => i !== idx); })}
          onImport={(newPhotos) => setPhotos(prev => [...newPhotos, ...prev])}
          onEdit={(src, idx) => { setShowGallery(false); setEditingPhoto({ src, index: idx }); setEditorId(prev => prev + 1); }}
        />
      )}

      {editingPhoto && (
        <ImageEditor 
          key={editorId}
          imageSrc={editingPhoto.src}
          lutList={lutList}
          onSave={handleSaveEdit}
          onCancel={() => setEditingPhoto(null)}
          onHome={onHome}
          onImportNew={() => localFileInputRef.current?.click()}
        />
      )}
    </div>
  );
};
