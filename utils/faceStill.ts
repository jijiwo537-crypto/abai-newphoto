/* 在「一張照片」裡找臉（仿色的膚色保護用）。
 *
 * 用的是相機磨皮同一個模型：Google MediaPipe Face Landmarker（每張臉 478 個點），
 * 模型與執行檔都放在自己網站上，不連外部網路。這裡是「單張照片」模式：
 *   1. 整張縮到長邊 1280 找一次
 *   2. 再切成 2×2（互相重疊）各找一次 —— 模型內建的找臉器擅長「近一點的臉」，
 *      合照、遠景裡的小臉在整張圖上常常找不到，切塊放大之後就找得到了
 *   3. 同一張臉被找到好幾次的，只留一次
 * 回傳每張臉 478 點的比例座標（x0, y0, x1, y1, …），跟 faceSkinDraw 用的格式一樣。 */
import type { FaceLandmarker } from '@mediapipe/tasks-vision';

let engine: Promise<FaceLandmarker | null> | null = null;

/** 載入模型（只載一次；失敗的話下次再試） */
export function loadStillFaces(): Promise<FaceLandmarker | null> {
  if (engine) return engine;
  engine = (async () => {
    try {
      const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
      const base = new URL('./', document.baseURI).href;
      const fileset = await FilesetResolver.forVisionTasks(base + 'mediapipe');
      const make = (delegate: 'CPU' | 'GPU') => FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + 'models/face_landmarker.task', delegate },
        runningMode: 'IMAGE', numFaces: 8,
        minFaceDetectionConfidence: 0.35, minFacePresenceConfidence: 0.35,
      });
      try { return await make('CPU'); } catch { return await make('GPU'); }
    } catch (e) {
      console.warn('face landmarker', e);
      engine = null;
      return null;
    }
  })();
  return engine;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const boxOf = (f: number[]): Box => {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let i = 0; i < f.length; i += 2) {
    const x = f[i], y = f[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
};
const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = ix * iy, u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
};

/** 找出照片裡所有的臉。W、H 是來源的尺寸。找不到臉（或模型載不起來）就回傳空陣列 */
export async function detectFacesStill(src: CanvasImageSource, W: number, H: number): Promise<number[][]> {
  const lm = await loadStillFaces();
  if (!lm || !W || !H) return [];
  const LONG = 1280;
  const k = Math.min(1, LONG / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const full = document.createElement('canvas');
  full.width = w; full.height = h;
  const g = full.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);

  const faces: number[][] = [], boxes: Box[] = [];
  const add = (f: number[]) => {
    const b = boxOf(f);
    if (b.x1 - b.x0 < 0.01 || boxes.some(o => iou(o, b) > 0.3)) return;
    faces.push(f); boxes.push(b);
  };
  const run = (c: HTMLCanvasElement, ox: number, oy: number, sx: number, sy: number) => {
    try {
      const r = lm.detect(c);
      for (const pts of r.faceLandmarks || []) {
        const f: number[] = [];
        for (const p of pts) f.push(ox + p.x * sx, oy + p.y * sy);
        add(f);
      }
    } catch (e) { console.warn('face detect', e); }
  };
  run(full, 0, 0, 1, 1);
  // 2×2 互相重疊的切塊：每塊是整張的 60%，放大到同樣的解析度再找一次（找小臉）
  const T = 0.6, tile = document.createElement('canvas'), tg = tile.getContext('2d')!;
  const tw = Math.round(w * T), th = Math.round(h * T);
  tile.width = Math.max(1, Math.round(tw / T)); tile.height = Math.max(1, Math.round(th / T));
  for (const [fx, fy] of [[0, 0], [1 - T, 0], [0, 1 - T], [1 - T, 1 - T]]) {
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(full, fx * w, fy * h, tw, th, 0, 0, tile.width, tile.height);
    run(tile, fx, fy, T, T);
  }
  full.width = full.height = 0; tile.width = tile.height = 0;
  return faces;
}
