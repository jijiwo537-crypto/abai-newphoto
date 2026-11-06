/* AI 寫實仿色（CAP-VSTNet，Wen et al., CVPR 2023《Content Affinity Preserved Versatile Style Transfer》，MIT License）
   在背景執行緒跑。網路是「可逆」的：同一個網路往前把照片變成 32 個通道的特徵，往回又能一點不差地還原成照片。
     1. 原圖、參考圖各往前跑一次（fwd.onnx）
     2. 把原圖特徵的統計換成參考圖的（cWCT：白化－上色，用 Cholesky 分解）
     3. 往回跑一次（inv.onnx）就是「參考圖色調的原圖」
   因為可逆，不會有一般 AI 那種內容被洗掉、細節糊掉的問題。網路自己重寫後匯出，權重存 16 位元、計算全程 32 位元。
   為了省記憶體：往前那顆用完就先放掉，再載往回那顆；整個執行緒算完就由主畫面關掉（記憶體整塊還給系統）。 */
import * as ort from 'onnxruntime-web/wasm';
// @ts-ignore 靜態資源網址（?url）
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
// @ts-ignore 靜態資源網址（?url）
import mjsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import { threads } from './lineArtEngine';

/* 記憶體：關掉 CPU 記憶體池與預先配置（enableCpuMemArena／enableMemPattern）。
   開著的話 onnxruntime 會把用過的大塊記憶體留著不還、還會照最大的那一次先保留，尖峰高很多；
   關掉只慢一點點，手機上比較不會因為記憶體不夠被系統把網頁關掉 */
const OPT = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' as const, enableCpuMemArena: false, enableMemPattern: false };

/** cWCT：把 c（C×N）的平均與共變異數換成 s 的。T ＝ Ls · Lc⁻¹（Ls、Lc 是兩邊共變異數的 Cholesky 下三角） */
export function cwct(c: Float32Array, s: Float32Array, C: number, Nc: number, Ns: number) {
  const stat = (x: Float32Array, N: number) => {
    const m = new Float64Array(C), S = new Float64Array(C * C);
    for (let i = 0; i < C; i++) { let t = 0; const o = i * N; for (let k = 0; k < N; k++) t += x[o + k]; m[i] = t / N; }
    for (let i = 0; i < C; i++) for (let j = i; j < C; j++) {
      let t = 0; const oi = i * N, oj = j * N, mi = m[i], mj = m[j];
      for (let k = 0; k < N; k++) t += (x[oi + k] - mi) * (x[oj + k] - mj);
      S[i * C + j] = S[j * C + i] = t / Math.max(1, N - 1);
    }
    return { m, S };
  };
  const chol = (S: Float64Array) => {
    for (let e = 0; ; e += 2e-5) {
      const L = new Float64Array(C * C); let ok = true;
      for (let i = 0; i < C && ok; i++) for (let j = 0; j <= i; j++) {
        let t = S[i * C + j] + (i === j ? e : 0);
        for (let k = 0; k < j; k++) t -= L[i * C + k] * L[j * C + k];
        if (i === j) { if (!(t > 0)) { ok = false; break; } L[i * C + i] = Math.sqrt(t); }
        else L[i * C + j] = t / L[j * C + j];
      }
      if (ok) return L;
    }
  };
  const a = stat(c, Nc), b = stat(s, Ns);
  const Lc = chol(a.S), Ls = chol(b.S);
  // Lc⁻¹（下三角）
  const Ic = new Float64Array(C * C);
  for (let col = 0; col < C; col++) for (let i = col; i < C; i++) {
    let t = i === col ? 1 : 0;
    for (let k = col; k < i; k++) t -= Lc[i * C + k] * Ic[k * C + col];
    Ic[i * C + col] = t / Lc[i * C + i];
  }
  const T = new Float64Array(C * C);   // 兩個下三角相乘還是下三角
  for (let i = 0; i < C; i++) for (let j = 0; j < C; j++) { let t = 0; for (let k = 0; k < C; k++) t += Ls[i * C + k] * Ic[k * C + j]; T[i * C + j] = t; }
  // out ＝ T (c − μc) ＋ μs，一次一個像素（C 個通道）
  const out = new Float32Array(C * Nc), v = new Float64Array(C);
  for (let k = 0; k < Nc; k++) {
    for (let i = 0; i < C; i++) v[i] = c[i * Nc + k] - a.m[i];
    for (let i = 0; i < C; i++) { let t = b.m[i]; const r = i * C; for (let j = 0; j <= i; j++) t += T[r + j] * v[j]; out[i * Nc + k] = t; }
  }
  return out;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, base, content, style } = e.data || {};
  try {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl } as any;
    ort.env.wasm.numThreads = threads();
    if (type === 'warm') { (self as any).postMessage({ id, ok: true }); return; }
    const t0 = performance.now();
    const img = (d: { data: Float32Array; w: number; h: number }) => new ort.Tensor('float32', d.data, [1, 3, d.h, d.w]);
    const fwd = await ort.InferenceSession.create(`${base}models/cap/fwd.onnx`, OPT);
    const zc = (await fwd.run({ x: img(content) })).z;
    const zs = (await fwd.run({ x: img(style) })).z;
    await fwd.release();
    const C = zc.dims[1], Nc = zc.dims[2] * zc.dims[3], Ns = zs.dims[2] * zs.dims[3];
    const z = cwct(zc.data as Float32Array, zs.data as Float32Array, C, Nc, Ns);
    zs.dispose?.();
    const inv = await ort.InferenceSession.create(`${base}models/cap/inv.onnx`, OPT);
    const y = (await inv.run({ z: new ort.Tensor('float32', z, zc.dims as number[]) })).y;
    const out = new Float32Array(y.data as Float32Array);
    await inv.release();
    (self as any).postMessage({ id, ok: true, out, ms: performance.now() - t0 }, [out.buffer]);
  } catch (err: any) {
    (self as any).postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
