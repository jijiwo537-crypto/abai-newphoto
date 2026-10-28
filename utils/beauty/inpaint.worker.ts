/// <reference lib="webworker" />
/* 修補在背景執行緒算：大一點的範圍要幾百毫秒，放在主執行緒的話整個畫面會停住。
   演算法跟同步版是同一支（utils/beauty/inpaint），結果一模一樣。 */
import { inpaintCrop } from './inpaint';

self.onmessage = (e: MessageEvent<{ id: number; rgba: Uint8ClampedArray; w: number; h: number; alpha: Float32Array; seed: number }>) => {
  const { id, rgba, w, h, alpha, seed } = e.data;
  let out: Uint8ClampedArray | null = null;
  try { out = inpaintCrop(rgba, w, h, alpha, seed); } catch { out = null; }
  (self as any).postMessage({ id, rgba: out }, out ? [out.buffer] : []);
};
