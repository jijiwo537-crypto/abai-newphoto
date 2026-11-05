/* AI 仿色：用 WCT2（開源深度學習的寫實風格轉換，MIT License）先在小圖上算出「參考圖風格的原圖」，
   再把「原圖顏色 → AI 結果顏色」的對應學成一顆平滑的 3D LUT，套回原尺寸照片。
   為什麼不直接用 AI 的輸出：
     - 網路在手機上只能跑小圖（記憶體），直接放大會糊、還會有 AI 特有的斑塊與紋理
     - LUT 是「同一個顏色永遠換成同一個顏色」的全域對應：細節一點都不動，斑塊自然消失，
       全解析度也是 GPU 一次畫完，而且強度、膚色保護都能沿用同一條管線
   AI 會連明暗一起換（氣氛：黃昏、夜景、暗調），所以這個模式不鎖亮度。 */
import type { Lut3D } from './colorTransfer';

/** 網路吃的尺寸：長邊幾像素（寬高都要是 8 的倍數：編碼器有三次減半） */
const NET_LONG = 320;

let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./wct2.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
    worker.onerror = e => { for (const p of pending.values()) p.rej(e); pending.clear(); worker?.terminate(); worker = null; };
  }
  return worker;
}
const base = () => new URL((import.meta as any).env?.BASE_URL || '/', location.href).href;
const call = (msg: any, transfer: Transferable[] = []) => new Promise<any>((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); getWorker().postMessage({ ...msg, id, base: base() }, transfer);
});
/** 先把模型載好（選了 AI 模式才叫） */
export const warmAiColorMatch = () => call({ type: 'warm' }).catch(() => {});

/** 縮成網路要的尺寸，回傳 RGB 0～1 的平面陣列（CHW）與同一張的 RGBA 像素 */
function prep(src: CanvasImageSource, W: number, H: number) {
  const k = NET_LONG / Math.max(W, H);
  const w = Math.max(8, Math.round(W * k / 8) * 8), h = Math.max(8, Math.round(H * k / 8) * 8);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, n = w * h, data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { data[i] = px[i * 4] / 255; data[n + i] = px[i * 4 + 1] / 255; data[2 * n + i] = px[i * 4 + 2] / 255; }
  c.width = c.height = 0;
  return { data, w, h, px };
}

/**
 * 從成對的顏色（原圖 → AI 結果）學一顆 N³ 的 LUT。
 *   1. 每一組顏色用三線性權重灑進周圍 8 個格點，記下「位移」（結果－原色）的加權平均
 *   2. 沒有樣本的格點：反覆跟鄰居平均，把位移擴散過去（有樣本的格點固定不動）
 *   3. 最後整顆再輕輕抹平兩次：相近的顏色換得相近，不會有斷層
 * skip 是不要學的像素（皮膚：膚色另外保護，不讓 AI 把臉的對應帶進整顆 LUT）
 */
export function distillLut(src: Uint8ClampedArray, dst: Float32Array, n: number, N = 33, skip?: (i: number) => boolean): Lut3D {
  const M = N - 1, cells = N * N * N;
  const acc = new Float64Array(cells * 3), wsum = new Float64Array(cells);
  for (let i = 0; i < n; i++) {
    if (skip?.(i)) continue;
    const r = src[i * 4] / 255, g = src[i * 4 + 1] / 255, b = src[i * 4 + 2] / 255;
    const dr = dst[i] - r, dg = dst[n + i] - g, db = dst[2 * n + i] - b;
    const x = r * M, y = g * M, z = b * M;
    const x0 = Math.min(M - 1, Math.floor(x)), y0 = Math.min(M - 1, Math.floor(y)), z0 = Math.min(M - 1, Math.floor(z));
    const fx = x - x0, fy = y - y0, fz = z - z0;
    for (let k = 0; k < 8; k++) {
      const ox = k & 1, oy = (k >> 1) & 1, oz = (k >> 2) & 1;
      const wt = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
      if (wt <= 0) continue;
      const c = ((z0 + oz) * N + (y0 + oy)) * N + (x0 + ox);
      acc[c * 3] += dr * wt; acc[c * 3 + 1] += dg * wt; acc[c * 3 + 2] += db * wt; wsum[c] += wt;
    }
  }
  // 有多少樣本 → 多可信（樣本太少的格點也讓鄰居分擔一點）
  const disp = new Float64Array(cells * 3), conf = new Float64Array(cells);
  for (let c = 0; c < cells; c++) {
    if (wsum[c] > 1e-9) { disp[c * 3] = acc[c * 3] / wsum[c]; disp[c * 3 + 1] = acc[c * 3 + 1] / wsum[c]; disp[c * 3 + 2] = acc[c * 3 + 2] / wsum[c]; }
    conf[c] = Math.min(1, wsum[c] / 4);
  }
  let D = new Float64Array(cells * 3), Cc = new Float64Array(cells);
  for (let c = 0; c < cells; c++) { D[c * 3] = disp[c * 3] * conf[c]; D[c * 3 + 1] = disp[c * 3 + 1] * conf[c]; D[c * 3 + 2] = disp[c * 3 + 2] * conf[c]; Cc[c] = conf[c]; }
  const nb = (x: number, y: number, z: number, f: (c: number) => void) => {
    if (x > 0) f((z * N + y) * N + x - 1); else f((z * N + y) * N + x);
    if (x < M) f((z * N + y) * N + x + 1); else f((z * N + y) * N + x);
    if (y > 0) f((z * N + y - 1) * N + x); else f((z * N + y) * N + x);
    if (y < M) f((z * N + y + 1) * N + x); else f((z * N + y) * N + x);
    if (z > 0) f(((z - 1) * N + y) * N + x); else f((z * N + y) * N + x);
    if (z < M) f(((z + 1) * N + y) * N + x); else f((z * N + y) * N + x);
  };
  for (let it = 0; it < 80; it++) {
    const D2 = new Float64Array(cells * 3), C2 = new Float64Array(cells);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = (z * N + y) * N + x;
      let a = 0, b = 0, d = 0, w = 0;
      nb(x, y, z, k => { a += D[k * 3]; b += D[k * 3 + 1]; d += D[k * 3 + 2]; w += Cc[k]; });
      const q = conf[c], p = 1 - q;
      D2[c * 3] = q * disp[c * 3] * q + p * a / 6; D2[c * 3 + 1] = q * disp[c * 3 + 1] * q + p * b / 6; D2[c * 3 + 2] = q * disp[c * 3 + 2] * q + p * d / 6;
      C2[c] = q + p * w / 6;
    }
    D = D2; Cc = C2;
  }
  let F = new Float64Array(cells * 3);
  for (let c = 0; c < cells; c++) { const k = Math.max(1e-9, Cc[c]); F[c * 3] = D[c * 3] / k; F[c * 3 + 1] = D[c * 3 + 1] / k; F[c * 3 + 2] = D[c * 3 + 2] / k; }
  for (let it = 0; it < 2; it++) {
    const G = new Float64Array(cells * 3);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = (z * N + y) * N + x;
      let a = 2 * F[c * 3], b = 2 * F[c * 3 + 1], d = 2 * F[c * 3 + 2];
      nb(x, y, z, k => { a += F[k * 3]; b += F[k * 3 + 1]; d += F[k * 3 + 2]; });
      G[c * 3] = a / 8; G[c * 3 + 1] = b / 8; G[c * 3 + 2] = d / 8;
    }
    F = G;
  }
  const data = new Float32Array(cells * 3);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = (z * N + y) * N + x;
    data[c * 3] = Math.min(1, Math.max(0, x / M + F[c * 3]));
    data[c * 3 + 1] = Math.min(1, Math.max(0, y / M + F[c * 3 + 1]));
    data[c * 3 + 2] = Math.min(1, Math.max(0, z / M + F[c * 3 + 2]));
  }
  return { size: N, data };
}

/** 算出 AI 仿色的 LUT。skin(u, v)：原圖那一點是皮膚的程度（0～1），皮膚不參與學習 */
export async function aiColorMatchLut(
  src: CanvasImageSource, sw: number, sh: number,
  ref: CanvasImageSource, rw: number, rh: number,
  skin?: (u: number, v: number) => number,
): Promise<Lut3D> {
  const c = prep(src, sw, sh), s = prep(ref, rw, rh);
  const r = await call({ type: 'run', content: { data: c.data, w: c.w, h: c.h }, style: { data: s.data, w: s.w, h: s.h } }, [c.data.buffer, s.data.buffer]);
  try { (globalThis as any).__aiColorMs = Math.round(r.ms); } catch { /* noop */ }
  const n = c.w * c.h;
  let skipped = 0;
  const skip = skin ? (i: number) => { const x = i % c.w, y = (i - x) / c.w; const v = skin((x + 0.5) / c.w, (y + 0.5) / c.h) > 0.35; if (v) skipped++; return v; } : undefined;
  let lut = distillLut(c.px, r.out as Float32Array, n, 33, skip);
  // 皮膚佔了大半張（大頭照）：拿掉之後樣本太少，就整張一起學
  if (skin && skipped > n * 0.75) lut = distillLut(c.px, r.out as Float32Array, n, 33);
  return lut;
}
