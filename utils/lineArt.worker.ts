/* 線稿模型（Informative Drawings, Caroline Chan, MIT License）— CPU 版（單執行緒 WebAssembly）。
   沒有 WebGPU 的裝置用這支；GPU 那支自我檢查沒過也會改用這支。 */
import * as ort from 'onnxruntime-web/wasm';
// 套件的 exports 沒有開放 dist 子路徑，直接指到檔案（Vite 會把它當成靜態資源輸出）
// @ts-ignore 靜態資源網址（?url）
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
// @ts-ignore 靜態資源網址（?url）
import mjsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import { serve, threads } from './lineArtEngine';

serve(async url => {
  ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl } as any;
  ort.env.wasm.numThreads = threads();
  return { ort: ort as any, s: await ort.InferenceSession.create(url, { executionProviders: ['wasm'] }), ep: 'wasm' };
});
