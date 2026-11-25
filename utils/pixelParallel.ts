/* 存檔時的 CPU 像素運算（銳化、局部陰影／亮部、雜訊那幾條 GPU 走不了的路）分條交給幾個背景執行緒一起算。
 *
 * 結果跟主執行緒一次算整張逐位元一樣（同一支 processPixels、同一張抖色表、位置照整張圖算，見 photoPixelCore 的 strip）。
 * 記憶體：一次只有「執行緒數」條在路上（每條幾 MB），不會整張多複製一份；銳化細節也在背景分條算，主執行緒不用多配一張。
 * 任何一步失敗（建不了執行緒、某一條出錯、太久沒回來）都回 null，呼叫端照舊在主執行緒算 —— 只會變回原本的速度，不會壞。 */
import { copyPixelDither } from './photoPixelCore';
import type { LocalBase } from './localTone';

let pool: Worker[] | null = null;
let broken = false;
let seq = 0;

function getPool(): Worker[] | null {
  if (broken) return null;
  if (pool) return pool;
  if (typeof Worker !== 'function') { broken = true; return null; }
  /* 手機有 2 顆大核心＋4 顆小核心：開 3～4 個（留一顆給畫面） */
  const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  try {
    pool = Array.from({ length: n }, () => new Worker(new URL('./pixelStrips.worker.ts', import.meta.url), { type: 'module' }));
  } catch { broken = true; pool = null; return null; }
  const d = copyPixelDither();
  pool.forEach(w => w.postMessage({ dither: d }));
  return pool;
}

let idleTimer = 0;
/** 收掉背景執行緒（閒著也佔記憶體）。ms：過這麼久還沒再用到才收（連續存檔時不必每次重開、重新暖機） */
export function releasePixelPool(ms = 0): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
  if (ms > 0) { idleTimer = setTimeout(() => { idleTimer = 0; releasePixelPool(); }, ms) as unknown as number; return; }
  const p = pool;
  pool = null;
  p?.forEach(w => { try { w.terminate(); } catch { /* 已經收掉了 */ } });
}

/** 太小的圖不值得分（主執行緒一下就算完） */
const MIN_PIXELS = 1_500_000;

export function processPixelsParallel(
  src: Uint8ClampedArray, w: number, h: number,
  p: unknown, lut: Uint8ClampedArray | null, lutSize: number, base: Uint8Array,
  curves: { rgb: Uint8Array; r: Uint8Array; g: Uint8Array; b: Uint8Array },
  local: { base: LocalBase; gain: Float32Array } | null, sharpen: boolean,
): Promise<Uint8ClampedArray | null> {
  if (w * h < MIN_PIXELS || src.length !== w * h * 4) return Promise.resolve(null);
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
  const workers = getPool();
  if (!workers) return Promise.resolve(null);
  /* 每個執行緒輪到 4 條左右：快的核心多做幾條，慢的小核心不會拖住最後 */
  const rowsPer = Math.max(64, Math.ceil(h / (workers.length * 4)));
  const strips: [number, number][] = [];
  for (let y = 0; y < h; y += rowsPer) strips.push([y, Math.min(h, y + rowsPer)]);
  const dest = new Uint8ClampedArray(w * h * 4);
  /* 局部底圖只帶需要的（CPU 快取那張放大圖不帶，背景會自己算） */
  const localMsg = local ? { base: { data: local.base.data, w: local.base.w, h: local.base.h }, gain: local.gain } : null;
  return new Promise(resolve => {
    let next = 0, done = 0, over = false;
    const pending = new Map<number, { y0: number; len: number }>();
    const finish = (ok: boolean) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      workers.forEach(wk => { wk.onmessage = null; wk.onerror = null; });
      /* 失敗的話這批執行緒可能卡住了：整批換掉，下次重開 */
      if (!ok) releasePixelPool();
      resolve(ok ? dest : null);
    };
    /* 保險：12MP 正常一兩秒；一分鐘都沒好就是哪裡卡住了 */
    const timer = setTimeout(() => finish(false), 60000);
    const send = (wk: Worker) => {
      if (over || next >= strips.length) return;
      const [y0, y1] = strips[next++];
      const t0 = Math.max(0, y0 - 1), t1 = Math.min(h, y1 + 1);   // 上下多帶一列（銳化要看鄰居）
      const buf = src.slice(t0 * w * 4, t1 * w * 4);
      const id = ++seq;
      pending.set(id, { y0, len: (y1 - y0) * w * 4 });
      try {
        wk.postMessage({ id, src: buf, w, y0, y1, t0, fullH: h, p, lut, lutSize, base, curves, sharpen, local: localMsg }, [buf.buffer]);
      } catch { finish(false); }
    };
    for (const wk of workers) {
      wk.onmessage = (e: MessageEvent) => {
        const m = e.data;
        const job = m ? pending.get(m.id) : undefined;
        if (over || !job) return;
        pending.delete(m.id);
        if (m.error || !(m.dst instanceof Uint8ClampedArray) || m.dst.length !== job.len) { finish(false); return; }
        dest.set(m.dst, job.y0 * w * 4);
        done++;
        if (done === strips.length) { finish(true); return; }
        send(wk);
      };
      wk.onerror = () => finish(false);
    }
    for (const wk of workers) send(wk);
  });
}
