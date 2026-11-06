/* AI 仿色：用開源深度學習的寫實風格轉換（CAP-VSTNet，MIT License）先在小圖上算出「參考圖風格的原圖」，
   再把「原圖顏色 → AI 結果顏色」的對應學成一顆平滑的 3D LUT，套回原尺寸照片。
   為什麼不直接用 AI 的輸出：
     - 網路在手機上只能跑小圖（記憶體），直接放大會糊、還會有 AI 特有的斑塊與紋理
     - LUT 是「同一個顏色永遠換成同一個顏色」的全域對應：細節一點都不動，斑塊自然消失，
       全解析度也是 GPU 一次畫完，而且強度、膚色保護都能沿用同一條管線
   AI 會連明暗一起換（氣氛：黃昏、夜景、暗調），所以這個模式不鎖亮度。 */
import { rgbToLab, labToRgbSoft, type Lut3D } from './colorTransfer';

/** AI 寫實（CAP-VSTNet，見 capvst.worker） */
export type AiEngine = 'cap';
/** 網路吃的尺寸：長邊幾像素，寬高要是 4 的倍數 */
const NET: Record<AiEngine, { long: number; mult: number; files: string[] }> = {
  cap: { long: 384, mult: 4, files: ['models/cap/fwd.onnx', 'models/cap/inv.onnx'] },
};

/* 記憶體：WebAssembly 的記憶體只會長大、不會縮小，模型跑完就算不用了也一直佔著（實測一次 450～720MB），
   多算幾次之後 iPhone 就會把整個網頁關掉重開（＝崩潰）。
   所以每次都開一個新的背景執行緒，算完（不管成功失敗）立刻關掉，記憶體整塊還給系統；
   同一時間只會有一個在跑（新的一來，舊的直接關掉）。 */
let current: { w: Worker | null; rej: (e: any) => void } | null = null;
const spawn = (_e: AiEngine) => new Worker(new URL('./capvst.worker.ts', import.meta.url), { type: 'module' });
const base = () => new URL((import.meta as any).env?.BASE_URL || '/', location.href).href;
/* 上一個執行緒關掉之後，它的記憶體要過一下子才真的還給系統。馬上又開一個的話，兩份會同時佔著 ——
   快速切換參考圖時就是這樣疊上去的（實測尖峰多一倍，iPhone 會直接把網頁關掉重開）。
   所以關掉之後至少隔 600ms 才開下一個。 */
const COOLDOWN = 600;
let lastEnd = 0;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function runOnce(engine: AiEngine, msg: any, transfer: Transferable[]) {
  if (current) { current.w.terminate(); current.rej(new Error('cancelled')); current = null; lastEnd = performance.now(); }
  return new Promise<any>((res, rej) => {
    const me: { w: Worker | null; rej: (e: any) => void } = { w: null, rej };
    current = me as any;
    const wait = COOLDOWN - (performance.now() - lastEnd);
    (wait > 0 ? sleep(wait) : Promise.resolve()).then(() => {
      if (current !== (me as any)) return;   // 等的這段時間又被取消了：根本不開
      const w = spawn(engine); me.w = w;
      const done = () => { w.terminate(); lastEnd = performance.now(); if (current === (me as any)) current = null; };
      w.onmessage = e => { done(); e.data.ok ? res(e.data) : rej(new Error(e.data.error)); };
      w.onerror = e => { done(); rej(e); };
      w.postMessage({ ...msg, id: 1, base: base() }, transfer);
    });
  });
}
/** 不要了（換了別的做法、離開仿色）：正在算的直接關掉 */
export function cancelAiColorMatch() { if (current) { current.w?.terminate(); current.rej(new Error('cancelled')); current = null; lastEnd = performance.now(); } }
/** 選了 AI 模式先把模型下載進快取（不載進記憶體） */
const warmed = new Set<AiEngine>();
export const warmAiColorMatch = (e: AiEngine = 'cap') => {
  if (warmed.has(e)) return; warmed.add(e);
  for (const f of NET[e].files) fetch(base() + f).then(r => r.arrayBuffer()).catch(() => warmed.delete(e));
};

/** 縮成網路要的尺寸，回傳 RGB 0～1 的平面陣列（CHW）與同一張的 RGBA 像素 */
function prep(src: CanvasImageSource, W: number, H: number, long: number, m: number) {
  const k = long / Math.max(W, H);
  const w = Math.max(m, Math.round(W * k / m) * m), h = Math.max(m, Math.round(H * k / m) * m);
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

/* AI 偶爾會把明暗改太多（整張壓得很暗、亮部整片衝白）。不能整個鎖住亮度 —— 黃昏、夜景、暗調本來就要改明暗，
   所以只「收」太大的那一段：每一個顏色的亮度變化（Lab 的 L，0～100）
     · 12 以內：原封不動（正常幅度的光影調整完全不受影響）
     · 超過 12：越大收得越多，平滑地逼近 30，永遠不會超過（沒有硬切，漸層不會斷）
   色相與飽和度照 AI 的結果，只動亮度。 */
const L_KNEE = 12, L_CEIL = 30;
const softKnee = (d: number) => {
  const a = Math.abs(d);
  if (a <= L_KNEE) return d;
  const r = L_CEIL - L_KNEE;
  return Math.sign(d) * (L_KNEE + r * Math.tanh((a - L_KNEE) / r));
};
export function limitLightness(lut: Lut3D): Lut3D {
  const N = lut.size, M = N - 1, d = lut.data, out = new Float32Array(d.length);
  const li = [0, 0, 0], lo = [0, 0, 0], rgb = [0, 0, 0];
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = ((z * N + y) * N + x) * 3;
    rgbToLab(x / M, y / M, z / M, li);
    rgbToLab(d[c], d[c + 1], d[c + 2], lo);
    const dL = lo[0] - li[0], k = softKnee(dL);
    if (k === dL) { out[c] = d[c]; out[c + 1] = d[c + 1]; out[c + 2] = d[c + 2]; continue; }
    labToRgbSoft(li[0] + k, lo[1], lo[2], rgb);
    out[c] = Math.min(1, Math.max(0, rgb[0])); out[c + 1] = Math.min(1, Math.max(0, rgb[1])); out[c + 2] = Math.min(1, Math.max(0, rgb[2]));
  }
  return { size: N, data: out };
}

/** 算出 AI 仿色的 LUT。skin(u, v)：原圖那一點是皮膚的程度（0～1），皮膚不參與學習 */
export async function aiColorMatchLut(
  src: CanvasImageSource, sw: number, sh: number,
  ref: CanvasImageSource, rw: number, rh: number,
  skin?: (u: number, v: number) => number, engine: AiEngine = 'cap',
): Promise<Lut3D> {
  const { long, mult } = NET[engine];
  const c = prep(src, sw, sh, long, mult), s = prep(ref, rw, rh, long, mult);
  const r = await runOnce(engine, { type: 'run', content: { data: c.data, w: c.w, h: c.h }, style: { data: s.data, w: s.w, h: s.h } }, [c.data.buffer, s.data.buffer]);
  try { (globalThis as any).__aiColorMs = Math.round(r.ms); } catch { /* noop */ }
  const n = c.w * c.h;
  let skipped = 0;
  const skip = skin ? (i: number) => { const x = i % c.w, y = (i - x) / c.w; const v = skin((x + 0.5) / c.w, (y + 0.5) / c.h) > 0.35; if (v) skipped++; return v; } : undefined;
  let lut = distillLut(c.px, r.out as Float32Array, n, 33, skip);
  // 皮膚佔了大半張（大頭照）：拿掉之後樣本太少，就整張一起學
  if (skin && skipped > n * 0.75) lut = distillLut(c.px, r.out as Float32Array, n, 33);
  return limitLightness(lut);
}
