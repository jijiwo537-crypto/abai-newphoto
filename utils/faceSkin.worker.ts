/// <reference lib="webworker" />
/* 找臉在背景執行緒做：載入模型（編譯 wasm、建 GPU 環境）跟每一格的偵測都不佔主執行緒，
   打開磨皮、拍照時畫面不會卡。主執行緒每一格送一張縮小的畫面（ImageBitmap）過來，這裡回傳臉的點。 */
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { drawSkinMask, maskSize, type MaskBufs } from './faceSkinDraw';

// MediaPipe 在 worker 裡用 importScripts 載它的 wasm 載入程式；module worker 沒有這支，補一個同步版
if (typeof (self as any).importScripts !== 'function') {
  (self as any).importScripts = (url: string) => {
    const x = new XMLHttpRequest(); x.open('GET', url, false); x.send();
    (0, eval)(x.responseText);
  };
}

let lm: FaceLandmarker | null = null;
let lastT = 0;
/* 遮罩也在這裡畫（含柔邊），畫好轉成 ImageBitmap 傳回去：主執行緒不用讀回像素、不用跑柔邊，每一格都順 */
const canOff = typeof OffscreenCanvas !== 'undefined';
let off: OffscreenCanvas | null = null;
let offG: OffscreenCanvasRenderingContext2D | null = null;
const bufs: MaskBufs = { a: null, t: null };
self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const fileset = await FilesetResolver.forVisionTasks(m.base + 'mediapipe');
      const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: m.base + 'models/face_landmarker.task', delegate },
        runningMode: 'VIDEO', numFaces: 4,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      /* 背景執行緒裡只用 CPU（XNNPACK）：在 iPhone 上背景執行緒建 GPU 環境會一直等不到回應（磨皮遲遲不出現就是這個）。
         模型很小、送進來的畫面也縮小過，CPU 一格十幾毫秒，而且不佔主執行緒 */
      lm = await make('CPU');
      (self as any).postMessage({ type: 'ready' });
    } catch (err) {
      (self as any).postMessage({ type: 'fail', error: String(err) });
    }
    return;
  }
  if (m.type === 'frame') {
    const bmp: ImageBitmap = m.bitmap;
    let faces: number[][] = [];
    try {
      if (lm) {
        const t = Math.max(m.t, lastT + 1); lastT = t;
        const res = lm.detectForVideo(bmp, t);
        faces = (res.faceLandmarks || []).map(f => { const a = new Array(f.length * 2); f.forEach((p, i) => { a[i * 2] = p.x; a[i * 2 + 1] = p.y; }); return a; });
      }
    } catch { faces = []; }
    bmp.close();
    if (canOff && m.vw && m.vh) {
      try {
        const [mw, mh] = maskSize(m.vw, m.vh);
        if (!off) { off = new OffscreenCanvas(mw, mh); offG = off.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D; }
        if (off.width !== mw || off.height !== mh) { off.width = mw; off.height = mh; }
        if (offG) {
          const { frac, box } = drawSkinMask(offG, mw, mh, faces, m.vw, m.vh, bufs);
          const bitmap = off.transferToImageBitmap();
          (self as any).postMessage({ type: 'faces', n: faces.length, frac, box, bitmap, id: m.id }, [bitmap]);
          return;
        }
      } catch { /* 改由主執行緒畫 */ }
    }
    (self as any).postMessage({ type: 'faces', faces, id: m.id });
  }
};
