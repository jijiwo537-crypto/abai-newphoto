/// <reference lib="webworker" />
/* 找臉在背景執行緒做：載入模型（編譯 wasm、建 GPU 環境）跟每一格的偵測都不佔主執行緒，
   打開磨皮、拍照時畫面不會卡。主執行緒每一格送一張縮小的畫面（ImageBitmap）過來，這裡回傳臉的點。 */
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe 在 worker 裡用 importScripts 載它的 wasm 載入程式；module worker 沒有這支，補一個同步版
if (typeof (self as any).importScripts !== 'function') {
  (self as any).importScripts = (url: string) => {
    const x = new XMLHttpRequest(); x.open('GET', url, false); x.send();
    (0, eval)(x.responseText);
  };
}

let lm: FaceLandmarker | null = null;
let lastT = 0;
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
      try { lm = await make('GPU'); } catch { lm = await make('CPU'); }
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
    (self as any).postMessage({ type: 'faces', faces, id: m.id });
  }
};
