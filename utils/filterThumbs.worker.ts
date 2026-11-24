/* 濾鏡縮圖在背景執行緒算（跟主畫面完全不搶）：一張一張算好就送回去，主執行緒只負責貼上。
 * 跟主執行緒用同一支 processPixels、同一張抖色表 —— 算出來的每一個像素跟原本在主執行緒算的一模一樣。 */
import { processPixels, setPixelDither } from './photoPixelCore';

const luts = new Map<string, { data: Uint8ClampedArray; size: number }>();
let current = 0;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.dither) { setPixelDither(m.dither); return; }
  if (m.lut) { luts.set(m.lut.id, { data: m.lut.data, size: m.lut.size }); return; }
  if (m.cancel) { if (m.cancel === current) current = 0; return; }
  const { id, src, W, H, flat, baseLut, curveLuts, jobs } = m;
  current = id;
  for (const j of jobs as { key: string; lutId: string | null; amount: number; sig: string }[]) {
    if (current !== id) return;   // 換照片、離開了：剩下的不算
    const t = j.lutId ? luts.get(j.lutId) : null;
    if (j.lutId && !t) continue;
    const dst = new Uint8ClampedArray(src);
    try {
      processPixels(src, dst, W, H, { ...flat, lutAmount: j.amount }, t ? t.data : null, t ? t.size : 0, baseLut, null, false, curveLuts);
    } catch { continue; }
    (self as unknown as Worker).postMessage({ id, key: j.key, sig: j.sig, px: dst }, [dst.buffer]);
    await new Promise<void>(r => setTimeout(r, 0));   // 讓「取消」有機會插進來
  }
  if (current === id) (self as unknown as Worker).postMessage({ id, done: true });
};
