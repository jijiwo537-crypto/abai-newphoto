/* SA-LUT 仿色（見 salut.worker）：算出兩顆 3D LUT＋一張情境圖，交給 GPU 依情境值逐點混合兩顆 LUT。
   跟其他做法走同一條管線（強度、紅色與膚色保護、全解析度 GPU 一次畫完）。 */
import type { Lut3D } from './colorTransfer';

export type SalutResult = { lut0: Lut3D; lut1: Lut3D; ctx: { w: number; h: number; data: Float32Array } };

let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./salut.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
    worker.onerror = e => { for (const p of pending.values()) p.rej(e); pending.clear(); worker?.terminate(); worker = null; };
  }
  return worker;
}
const base = () => new URL((import.meta as any).env?.BASE_URL || '/', location.href).href;
const call = (msg: any, transfer: Transferable[] = []) => new Promise<any>((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); getWorker().postMessage({ ...msg, id, base: base() }, transfer);
});
export const warmSalut = () => call({ type: 'warm' }).catch(() => {});

/** 縮成 n×n（跟原作一樣直接壓成正方形），回傳 RGB 0～1 的平面陣列（CHW） */
function square(src: CanvasImageSource, n: number) {
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, n, n);
  const px = g.getImageData(0, 0, n, n).data, m = n * n, out = new Float32Array(3 * m);
  for (let i = 0; i < m; i++) { out[i] = px[i * 4] / 255; out[m + i] = px[i * 4 + 1] / 255; out[2 * m + i] = px[i * 4 + 2] / 255; }
  c.width = c.height = 0;
  return out;
}

export async function salutColorMatch(src: CanvasImageSource, ref: CanvasImageSource): Promise<SalutResult> {
  const c512 = square(src, 512), s512 = square(ref, 512), c128 = square(src, 128), s128 = square(ref, 128);
  const r = await call({ type: 'run', c512, s512, c128, s128 }, [c512.buffer, s512.buffer, c128.buffer, s128.buffer]);
  try { (globalThis as any).__salutMs = Math.round(r.ms); } catch { /* noop */ }
  // SA-LUT 的 LUT 排法是 [通道][情境][b][g][r]（r 變最快），換成我們的 [b][g][r][通道]
  const N = 17, N3 = N * N * N, L = r.lut as Float32Array;
  const mk = (k: number): Lut3D => {
    const data = new Float32Array(N3 * 3);
    for (let i = 0; i < N3; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = L[c * 2 * N3 + k * N3 + i];
    return { size: N, data };
  };
  return { lut0: mk(0), lut1: mk(1), ctx: { w: 128, h: 128, data: r.ctx as Float32Array } };
}
