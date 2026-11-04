/* 線稿模型 — GPU 版（WebGPU）。手機 CPU 上一張要十幾秒，GPU 上快很多。
   載入時用一張 64×64 的小圖在 GPU 與 CPU 各跑一次比對：GPU 不能用、出錯或結果差太多，
   就回報失敗，主執行緒改用 CPU 那支（結果跟以前完全一樣）。 */
import * as ort from 'onnxruntime-web/webgpu';
// @ts-ignore 靜態資源網址（?url）
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
// @ts-ignore 靜態資源網址（?url）
import mjsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import { serve, threads, runOnce, type Engine } from './lineArtEngine';

const P = 64;
serve(async url => {
  const gpuApi = (navigator as any).gpu;
  if (!gpuApi || !(await gpuApi.requestAdapter())) throw new Error('gpu-unusable: no adapter');
  ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl } as any;
  ort.env.wasm.numThreads = threads();
  const gpu: Engine = { ort: ort as any, s: await ort.InferenceSession.create(url, { executionProviders: ['webgpu'] }), ep: 'webgpu' };
  const cpu: Engine = { ort: ort as any, s: await ort.InferenceSession.create(url, { executionProviders: ['wasm'] }), ep: 'wasm' };
  const probe = new Float32Array(3 * P * P);
  for (let i = 0; i < probe.length; i++) probe[i] = ((i * 2654435761) >>> 0) % 1000 / 1000;
  const a = await runOnce(gpu, probe.slice(), P, P), b = await runOnce(cpu, probe.slice(), P, P);
  await cpu.s.release();
  let worst = 0; for (let i = 0; i < a.data.length; i++) worst = Math.max(worst, Math.abs(a.data[i] - b.data[i]));
  if (!(worst < 2e-3)) { await gpu.s.release(); throw new Error(`gpu-unusable: differs by ${worst}`); }
  return gpu;
});
