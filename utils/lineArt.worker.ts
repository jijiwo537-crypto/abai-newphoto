/* 線稿模型（Informative Drawings, Caroline Chan, MIT License）在背景執行緒跑：
   推論要好幾秒，放在主執行緒的話整個畫面會卡住。
   輸入：RGB 0~1 的平面陣列 [1,3,H,W]；輸出：灰階 0~1 [1,1,H,W]（白底黑線）。 */
import * as ort from 'onnxruntime-web/wasm';
// 套件的 exports 沒有開放 dist 子路徑，直接指到檔案（Vite 會把它當成靜態資源輸出）
// @ts-ignore 靜態資源網址（?url）
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
// @ts-ignore 靜態資源網址（?url）
import mjsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';

let session: Promise<ort.InferenceSession> | null = null;
const load = (modelUrl: string) => {
  if (!session) {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl } as any;
    ort.env.wasm.numThreads = (self as any).crossOriginIsolated ? Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)) : 1;
    session = ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
    session.catch(() => { session = null; });
  }
  return session;
};

self.onmessage = async (e: MessageEvent) => {
  const { id, type, modelUrl, data, width, height } = e.data || {};
  try {
    const s = await load(modelUrl);
    if (type === 'warm') { (self as any).postMessage({ id, ok: true }); return; }
    const out = await s.run({ input: new ort.Tensor('float32', data as Float32Array, [1, 3, height, width]) });
    const t = out.output;
    const res = new Float32Array(t.data as Float32Array);
    (self as any).postMessage({ id, ok: true, data: res, width: t.dims[3], height: t.dims[2] }, [res.buffer]);
  } catch (err: any) {
    (self as any).postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
