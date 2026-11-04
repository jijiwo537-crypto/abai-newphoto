/* 線稿模型的推論（兩支 worker 共用）：輸入 RGB 0~1 平面陣列 [1,3,H,W]，輸出灰階 0~1 [1,1,H,W] */
type OrtLike = typeof import('onnxruntime-web/wasm');
export interface Engine { ort: OrtLike; s: any; ep: 'webgpu' | 'wasm' }
export const threads = () => ((self as any).crossOriginIsolated ? Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)) : 1);
export const runOnce = async (e: Engine, data: Float32Array, w: number, h: number) => {
  const out = await e.s.run({ input: new e.ort.Tensor('float32', data, [1, 3, h, w]) });
  const t = out.output as any;
  return { data: new Float32Array(await t.getData()), width: t.dims[3] as number, height: t.dims[2] as number };
};
/** 跑 worker 的訊息迴圈；load 第一次被叫到時建好引擎（失敗會丟出 'gpu-unusable'，主執行緒改用 CPU 那支） */
export function serve(load: (url: string) => Promise<Engine>) {
  let engine: Promise<Engine> | null = null;
  self.onmessage = async (ev: MessageEvent) => {
    const { id, type, modelUrl, data, width, height } = ev.data || {};
    try {
      const t0 = performance.now();
      if (!engine) { engine = load(modelUrl); engine.catch(() => { engine = null; }); }
      const e = await engine;
      const t1 = performance.now();
      if (type === 'warm') { (self as any).postMessage({ id, ok: true, loadMs: t1 - t0, ep: e.ep }); return; }
      const r = await runOnce(e, data, width, height);
      (self as any).postMessage({ id, ok: true, ...r, waitMs: t1 - t0, runMs: performance.now() - t1, ep: e.ep }, [r.data.buffer]);
    } catch (err: any) {
      (self as any).postMessage({ id, ok: false, error: String(err?.message || err) });
    }
  };
}
