/* SA-LUT（Gong et al., ICCV 2025《SA-LUT: Spatial Adaptive 4D Look-Up Table for Photorealistic Style Transfer》）
   在背景執行緒跑：兩張圖各縮成 512×512 算出一顆「4D LUT」（兩顆 17³ 的 3D LUT，依情境值混合），
   另外在 128×128 上算出每個位置的情境值（原論文是 512，但那一步的注意力在手機上要十幾 GB；
   實測 128 跟 512 的成品肉眼分不出來）。網路架構自己重寫後匯出，權重存成 16 位元、計算全程 32 位元。 */
import * as ort from 'onnxruntime-web/wasm';
// @ts-ignore 靜態資源網址（?url）
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
// @ts-ignore 靜態資源網址（?url）
import mjsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import { threads } from './lineArtEngine';

let sessions: Promise<{ lut: ort.InferenceSession; ctx: ort.InferenceSession }> | null = null;
function load(base: string) {
  if (!sessions) sessions = (async () => {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl } as any;
    ort.env.wasm.numThreads = threads();
    const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' as const };
    const lut = await ort.InferenceSession.create(`${base}models/salut/lut.onnx`, opt);
    const ctx = await ort.InferenceSession.create(`${base}models/salut/ctx.onnx`, opt);
    return { lut, ctx };
  })().catch(e => { sessions = null; throw e; });
  return sessions;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, base, c512, s512, c128, s128 } = e.data || {};
  try {
    const S = await load(base);
    if (type === 'warm') { (self as any).postMessage({ id, ok: true }); return; }
    const t0 = performance.now();
    const T = (d: Float32Array, n: number) => new ort.Tensor('float32', d, [1, 3, n, n]);
    const r1 = await S.lut.run({ style: T(s512, 512), content: T(c512, 512) });
    const r2 = await S.ctx.run({ content: T(c128, 128), style: T(s128, 128) });
    const lut = new Float32Array(r1.lut.data as Float32Array), ctx = new Float32Array(r2.ctx.data as Float32Array);
    (self as any).postMessage({ id, ok: true, lut, ctx, ms: performance.now() - t0 }, [lut.buffer, ctx.buffer]);
  } catch (err: any) {
    (self as any).postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
