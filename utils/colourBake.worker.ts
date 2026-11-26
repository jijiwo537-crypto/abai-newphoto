/* 背景執行緒：烤色彩表（33³）。跟主執行緒 photoFx 的 surfaceColourImage 烤的是同一支 processPixels、
 * 同一張抖色表、同一組參數，結果逐位元一樣 —— 只是不佔主執行緒，好幾張照片可以同時烤（見 photoFx 的 prebakeColours）。 */
import { processPixels, generateBaseCorrectionLut, setPixelDither } from './photoPixelCore';
import { bakeColorLut, bakedToTexture } from './lutBake';

self.onmessage = (event: MessageEvent) => {
  const d = event.data;
  if (d.dither) { setPixelDither(d.dither); return; }
  const { id, params, film, filmSize, curves } = d;
  try {
    const base = new Uint8Array(256);
    generateBaseCorrectionLut(params.exposure, params.contrast, params.brightness, base);
    const tex = bakedToTexture(bakeColorLut((a, dd, w, h) => processPixels(a, dd, w, h, params, film, filmSize, base, null, false, curves), 33));
    (self as unknown as Worker).postMessage({ id, tex }, [tex.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String(error) });
  }
};
