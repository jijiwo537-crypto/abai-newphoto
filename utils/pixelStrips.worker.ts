/* 存檔的 CPU 像素運算分條在背景執行緒算（見 utils/pixelParallel）。
 * 跟主執行緒用同一支 processPixels、同一張抖色表、同一支銳化細節（sharpenDetailRows）——
 * 每一條算出來的像素，跟主執行緒一次算整張的那一段一模一樣。 */
import { processPixels, setPixelDither, sharpenDetailRows } from './photoPixelCore';

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.dither) { setPixelDither(m.dither); return; }
  const post = (msg: unknown, t?: Transferable[]) => (self as unknown as Worker).postMessage(msg, t || []);
  try {
    const { id, src, w, y0, y1, t0, fullH, p, lut, lutSize, base, curves, sharpen, local } = m;
    const rows = y1 - y0, off = (y0 - t0) * w * 4;
    const body = (src as Uint8ClampedArray).subarray(off, off + rows * w * 4);
    const detail = sharpen ? sharpenDetailRows(src, w, t0, y0, y1, fullH) : null;
    const dst = new Uint8ClampedArray(rows * w * 4);
    processPixels(body, dst, w, rows, p, lut, lutSize, base, detail, false, curves, local, { y0, fullH });
    post({ id, y0, dst }, [dst.buffer]);
  } catch (err) {
    post({ id: m && m.id, error: String((err as any)?.message ?? err) });
  }
};
