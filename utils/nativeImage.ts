/* 原生影像核心的網頁端（對應 ios/App/App/NativeImagePlugin.swift）。
 * 網頁版每一支都回 null／什麼都不做，呼叫端照原本的網頁流程走。 */
import { nativePlugin, fileSrc, nativePathOf } from './nativeBridge';
import { setImageBudget } from './memoryBudget';

interface NativeImageApi {
  memory(): Promise<{ available: number; physical: number }>;
  info(o: { path: string }): Promise<{ width: number; height: number }>;
  downsample(o: { path: string; maxPixel: number; quality?: number }): Promise<{ path: string; width: number; height: number }>;
  writeTemp(o: { data: string; ext: string }): Promise<{ path: string }>;
  appendTemp(o: { data: string; ext: string; path?: string }): Promise<{ path: string }>;
  render(o: Record<string, unknown>): Promise<{ path: string; width: number; height: number; previewPath?: string }>;
  encode(o: { path?: string; data?: string; format: string; quality?: number }): Promise<{ path: string }>;
  remove(o: { path: string }): Promise<void>;
  /** 搬進相機相簿資料夾（永久保存）；舊版 App 沒有這支 */
  persist?(o: { path: string }): Promise<{ path: string }>;
  keepDir?(o?: { paths?: string[] }): Promise<{ path: string; missing?: string[] }>;
  beginBackgroundTask(o: { name: string }): Promise<{ id: number }>;
  endBackgroundTask(o: { id: number }): Promise<void>;
  capabilities(): Promise<{ hdrGainMap: boolean; heic10: boolean; edrHeadroom: number }>;
}

export const nativeImage = () => nativePlugin<NativeImageApi>('NativeImage');

/** 原生縮小解碼：回傳網頁可以直接讀的小檔網址（不是 App 就回 null） */
export async function nativeDownsample(path: string, maxPixel: number): Promise<{ url: string; path: string; width: number; height: number } | null> {
  const p = await nativeImage();
  if (!p) return null;
  try { const r = await p.downsample({ path, maxPixel }); return { ...r, url: fileSrc(r.path) }; } catch { return null; }
}

export async function nativeImageSize(path: string): Promise<{ width: number; height: number } | null> {
  const p = await nativeImage();
  if (!p) return null;
  try { return await p.info({ path }); } catch { return null; }
}

/** 匯入給「工作尺寸有上限」的工具（例如藝術效果最多 1600 萬像素）：
 *  從相簿選來、超過上限的照片在原生端解碼時就縮好，WebKit 不必先把整張 4800 萬像素解開
 *  （光那一下就要約 200MB，前面編輯過很多東西時，網頁會因此被系統收掉，看起來就是閃退）。
 *  工具本來就會縮到同一個尺寸，所以成品一樣。回傳 null＝不需要／做不到，照原本的方式讀。 */
export async function nativeImportCapped(file: Blob | string, maxPixels: number): Promise<string | null> {
  const path = nativePathOf(file);
  if (!path) return null;
  const size = await nativeImageSize(path);
  if (!size || !size.width || !size.height || size.width * size.height <= maxPixels * 1.02) return null;
  const long = Math.max(size.width, size.height), short = Math.min(size.width, size.height);
  const maxLong = Math.floor(Math.sqrt(maxPixels * long / short));
  const r = await nativeDownsample(path, maxLong);
  return r?.url ?? null;
}

/** 存檔這類「做到一半不能停」的事：切到背景時系統再多給一點時間 */
export async function withBackgroundTask<T>(name: string, run: () => Promise<T>): Promise<T> {
  const p = await nativeImage();
  let id: number | null = null;
  try { if (p) id = (await p.beginBackgroundTask({ name })).id; } catch { /* 拿不到就照常做 */ }
  try { return await run(); }
  finally { if (p && id != null) p.endBackgroundTask({ id }).catch(() => {}); }
}

/* 照片快取的記憶體預算跟著系統實際給的空間走：
   系統還讓這個 App 用多少（os_proc_available_memory），照片快取最多用其中三分之一，
   範圍 128～512MB。每 5 秒（App 在前景時）更新一次。 */
let watching = false;
export async function watchNativeMemoryBudget(): Promise<void> {
  if (watching) return;
  const p = await nativeImage();
  if (!p) return;
  watching = true;
  const MB = 1024 * 1024;
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const { available } = await p.memory();
      if (available > 0) setImageBudget(Math.max(128 * MB, Math.min(512 * MB, available / 3)));
    } catch { /* 下次再試 */ }
  };
  void tick();
  setInterval(tick, 5000);
}

/** 把網頁的檔案（Blob）寫到原生暫存資料夾，回傳路徑。分段傳（每段 3MB），大圖也不會卡在橋接上 */
/* ── 網頁 → 原生的二進位通道（見 ios/App/App/MainViewController.swift 的 ABAIIOSchemeHandler）──
   位元組原封不動走 WebKit 自己的資源載入寫成原生暫存檔，不必先轉 base64、不經過外掛的 JSON 訊息。
   第一次用之前先送一小段探測、再從原生讀回來逐位元組比對；任何一步不對（舊版 App 沒有這條通道、
   系統不給送、內容對不上）就整個工作階段都不用，照舊走 base64 —— 只會比較慢，不會壞。 */
const IO_PUT = 'abai-io://local/put';
const IO_CHUNK = 8 * 1024 * 1024;
let ioProbe: Promise<boolean> | null = null;
async function ioPost(body: Uint8Array, ext: string, path?: string): Promise<{ path: string; size: number } | null> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  /* 原生端沒回應（理論上不會）也不能讓存檔卡住：一段 8MB 給 20 秒，超過就放棄、改走 base64 */
  const t = ctl ? setTimeout(() => ctl.abort(), 20000) : 0;
  try {
    const r = await fetch(`${IO_PUT}?ext=${encodeURIComponent(ext)}${path ? `&path=${encodeURIComponent(path)}` : ''}`,
      { method: 'POST', body, cache: 'no-store', signal: ctl?.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.path === 'string' && typeof j.size === 'number' ? { path: j.path, size: j.size } : null;
  } catch { return null; }
  finally { if (t) clearTimeout(t); }
}
/** 這條通道能不能用（每個工作階段探一次） */
export function nativeIoReady(): Promise<boolean> {
  if (!ioProbe) ioProbe = (async () => {
    try {
      const p = await nativeImage();
      if (!p) return false;
      const probe = new Uint8Array(257);
      for (let i = 0; i < probe.length; i++) probe[i] = (i * 151 + 7) & 255;
      const r = await ioPost(probe, 'probe');
      if (!r) return false;
      let ok = r.size === probe.length;
      if (ok) {
        try {
          const back = new Uint8Array(await (await fetch(fileSrc(r.path), { cache: 'no-store' })).arrayBuffer());
          ok = back.length === probe.length && back.every((v, i) => v === probe[i]);
        } catch { ok = false; }
      }
      p.remove({ path: r.path }).catch(() => {});
      return ok;
    } catch { return false; }
  })();
  return ioProbe;
}
/** 位元組（可以分好幾塊）寫成一個原生暫存檔，回傳路徑；通道不能用或中途失敗回 null（不留半個檔） */
export async function writeNativeFileFast(parts: (Uint8Array | Blob)[], ext: string): Promise<string | null> {
  if (!(await nativeIoReady())) return null;
  let path: string | undefined, total = 0;
  const fail = () => { if (path) void nativeImage().then(p => p?.remove({ path: path! })).catch(() => {}); return null; };
  for (const part of parts) {
    const size = part instanceof Blob ? part.size : part.byteLength;
    for (let off = 0; off < size; off += IO_CHUNK) {
      const end = Math.min(size, off + IO_CHUNK);
      const body = part instanceof Blob ? new Uint8Array(await part.slice(off, end).arrayBuffer()) : part.subarray(off, end);
      const r = await ioPost(body, ext, path);
      total += end - off;
      if (!r || r.size !== total) return fail();
      path = r.path;
    }
  }
  return path ?? null;
}

/** 原尺寸成品的像素直接交給原生（.abpx：RGBA、sRGB、不透明，見 ABAIImageCore.rawPixels）：
 *  不壓 PNG、不轉 base64。有透明（不是每個像素都不透明）、或通道不能用就回 null，呼叫端照舊做 PNG */
export async function pixelsToNativeFile(px: Uint8ClampedArray, w: number, h: number, p3 = false): Promise<string | null> {
  if (!w || !h || px.length !== w * h * 4) return null;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return null;
  const t = new Uint8Array(16);
  t[0] = 0x41; t[1] = 0x42; t[2] = 0x50; t[3] = 0x58;
  const dv = new DataView(t.buffer);
  dv.setUint32(4, w, true); dv.setUint32(8, h, true);
  if (p3) t[12] = 1;
  return writeNativeFileFast([new Uint8Array(px.buffer, px.byteOffset, px.byteLength), t], 'abpx');
}

/** 過一段時間再刪掉這些原生暫存檔。計時器放在模組層（不在元件裡），不會連著整個元件的變數一起被抓住 */
export function removeNativeFilesLater(paths: string[], ms = 0): void {
  if (!paths.length) return;
  const list = paths.slice();
  const go = () => { void nativeImage().then(p => { if (p) for (const path of list) p.remove({ path }).catch(() => {}); }).catch(() => {}); };
  if (ms > 0) setTimeout(go, ms); else go();
}

export async function blobToNativeFile(blob: Blob, ext: string): Promise<string> {
  const p = await nativeImage();
  if (!p) throw new Error('沒有原生影像外掛');
  if (blob.size > 0) {
    const fast = await writeNativeFileFast([blob], ext);
    if (fast) return fast;
  }
  const CHUNK = 3 * 1024 * 1024;
  let path: string | undefined;
  for (let off = 0; off < blob.size || off === 0; off += CHUNK) {
    const part = blob.slice(off, off + CHUNK);
    const buf = new Uint8Array(await part.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000) as unknown as number[]);
    path = (await p.appendTemp({ data: btoa(s), ext, path })).path;
    if (blob.size === 0) break;
  }
  return path!;
}
