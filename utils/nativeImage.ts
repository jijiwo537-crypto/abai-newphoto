/* 原生影像核心的網頁端（對應 ios/App/App/NativeImagePlugin.swift）。
 * 網頁版每一支都回 null／什麼都不做，呼叫端照原本的網頁流程走。 */
import { nativePlugin, fileSrc } from './nativeBridge';
import { setImageBudget } from './memoryBudget';

interface NativeImageApi {
  memory(): Promise<{ available: number; physical: number }>;
  info(o: { path: string }): Promise<{ width: number; height: number }>;
  downsample(o: { path: string; maxPixel: number; quality?: number }): Promise<{ path: string; width: number; height: number }>;
  writeTemp(o: { data: string; ext: string }): Promise<{ path: string }>;
  appendTemp(o: { data: string; ext: string; path?: string }): Promise<{ path: string }>;
  render(o: Record<string, unknown>): Promise<{ path: string; width: number; height: number }>;
  encode(o: { path?: string; data?: string; format: string; quality?: number }): Promise<{ path: string }>;
  remove(o: { path: string }): Promise<void>;
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
export async function blobToNativeFile(blob: Blob, ext: string): Promise<string> {
  const p = await nativeImage();
  if (!p) throw new Error('沒有原生影像外掛');
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
