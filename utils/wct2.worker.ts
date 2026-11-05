/* AI 仿色（WCT2，Yoo et al. 2019《Photorealistic Style Transfer via Wavelet Transforms》，NAVER，MIT License）
   在背景執行緒跑：VGG 編碼器 4 層＋解碼器 4 層（ONNX，CPU 版 WebAssembly），
   每一層之間把內容特徵換成參考圖特徵的統計（WCT，見 wctMath），小波的高頻也各自換。
   主畫面只拿最後那張小圖去學一顆 3D LUT（見 aiColorMatch），所以這裡用小尺寸跑就夠。 */
import * as ort from 'onnxruntime-web/wasm';
// @ts-ignore 靜態資源網址（?url）
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
// @ts-ignore 靜態資源網址（?url）
import mjsUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import { threads } from './lineArtEngine';
import { styleStat, wctInPlace, type StyleStat } from './wctMath';

const NAMES = ['e1', 'e2', 'e3', 'e4', 'd4', 'd3', 'd2', 'd1'] as const;
let sessions: Promise<Record<string, ort.InferenceSession>> | null = null;
function load(base: string) {
  if (!sessions) sessions = (async () => {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl } as any;
    ort.env.wasm.numThreads = threads();
    const out: Record<string, ort.InferenceSession> = {};
    for (const n of NAMES) out[n] = await ort.InferenceSession.create(`${base}models/wct2/${n}.onnx`, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return out;
  })().catch(e => { sessions = null; throw e; });
  return sessions;
}

type T = ort.Tensor;
const C_OF = (t: T) => t.dims[1], N_OF = (t: T) => t.dims[2] * t.dims[3];
const f32 = (t: T) => t.data as Float32Array;

self.onmessage = async (e: MessageEvent) => {
  const { id, type, base, content, style } = e.data || {};
  try {
    const S = await load(base);
    if (type === 'warm') { (self as any).postMessage({ id, ok: true }); return; }
    const run = async (n: string, feeds: Record<string, T>) => S[n].run(feeds);
    const img = (d: { data: Float32Array; w: number; h: number }) => new ort.Tensor('float32', d.data, [1, 3, d.h, d.w]);
    const t0 = performance.now();

    // ── 參考圖：每一層的特徵統計 ──
    const st: Record<string, StyleStat> = {};
    const stat = (k: string, t: T) => { st[k] = styleStat(f32(t), C_OF(t), N_OF(t)); };
    let s1 = (await run('e1', { x: img(style) })).y; stat('e1', s1);
    const s2 = await run('e2', { x: s1 }); stat('e2', s2.y); ['lh', 'hl', 'hh'].forEach(k => stat('p1' + k, s2[k]));
    const s3 = await run('e3', { x: s2.y }); stat('e3', s3.y); ['lh', 'hl', 'hh'].forEach(k => stat('p2' + k, s3[k]));
    const s4 = await run('e4', { x: s3.y }); stat('e4', s4.y); ['lh', 'hl', 'hh'].forEach(k => stat('p3' + k, s4[k]));
    let sd = (await run('d4', { x: s4.y, orig: s4.orig, lh: s4.lh, hl: s4.hl, hh: s4.hh })).y; stat('d3', sd);
    sd = (await run('d3', { x: sd, orig: s3.orig, lh: s3.lh, hl: s3.hl, hh: s3.hh })).y; stat('d2', sd);
    sd = (await run('d2', { x: sd, orig: s2.orig, lh: s2.lh, hl: s2.hl, hh: s2.hh })).y; stat('d1', sd);
    s1 = null as any;

    // ── 原圖：一層一層編碼，每層都換成參考圖的統計 ──
    const w = (k: string, t: T) => { wctInPlace(f32(t), C_OF(t), N_OF(t), st[k]); return t; };
    const c1 = w('e1', (await run('e1', { x: img(content) })).y);
    const c2 = await run('e2', { x: c1 }); w('e2', c2.y);
    const c3 = await run('e3', { x: c2.y }); w('e3', c3.y);
    const c4 = await run('e4', { x: c3.y }); w('e4', c4.y);
    // 小波高頻（細節的方向性）也各自換
    for (const [c, p] of [[c2, 'p1'], [c3, 'p2'], [c4, 'p3']] as const) for (const k of ['lh', 'hl', 'hh']) w(p + k, c[k]);
    let x = (await run('d4', { x: c4.y, orig: c4.orig, lh: c4.lh, hl: c4.hl, hh: c4.hh })).y;
    x = (await run('d3', { x: w('d3', x), orig: c3.orig, lh: c3.lh, hl: c3.hl, hh: c3.hh })).y;
    x = (await run('d2', { x: w('d2', x), orig: c2.orig, lh: c2.lh, hl: c2.hl, hh: c2.hh })).y;
    x = (await run('d1', { x: w('d1', x) })).y;
    const out = new Float32Array(f32(x));
    (self as any).postMessage({ id, ok: true, out, ms: performance.now() - t0 }, [out.buffer]);
  } catch (err: any) {
    (self as any).postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
