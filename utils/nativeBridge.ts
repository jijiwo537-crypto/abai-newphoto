/* 原生外掛的共用小工具。
 * 規矩跟 utils/native.ts 一樣：網頁版跑起來要跟沒有這個檔案時一模一樣 ——
 * 不是 App 就直接回 null，@capacitor/core 以外什麼都不載。 */
import { Capacitor } from '@capacitor/core';
import { isNative } from './native';

const probes = new Map<string, Promise<any | null>>();

/** 拿某個 App 內建外掛；不是 App、或這版 App 沒有這支外掛，回 null（只探一次） */
export function nativePlugin<T = any>(name: string): Promise<T | null> {
  if (!isNative()) return Promise.resolve(null);
  let p = probes.get(name);
  if (!p) {
    p = (async () => {
      try {
        const { registerPlugin } = await import('@capacitor/core');
        const plugin: any = registerPlugin(name);
        /* registerPlugin 對沒實作的外掛也會給物件，要真的呼叫一次才知道在不在 */
        const r = await plugin.available();
        return r?.available ? plugin : null;
      } catch { return null; }
    })();
    probes.set(name, p);
  }
  return p;
}

/** 原生檔案路徑 → 網頁可以直接讀的網址（capacitor://localhost/_capacitor_file_/…） */
export const fileSrc = (path: string) => Capacitor.convertFileSrc(path.startsWith('file://') ? path : `file://${path}`);

/** Blob → base64（不含 data: 前綴），分段轉換避免爆掉呼叫堆疊 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

/* ── 檔案與原生路徑的對照 ──
   從系統照片選擇器來的檔案，原生端已經有一份在暫存資料夾。記下 File → 路徑，
   再記下 blob 網址 → 路徑，之後縮圖、讀尺寸就能交給原生做，WebKit 不必解開整張原圖。 */
const fileInfo = new WeakMap<Blob, { path: string; assetId?: string }>();
const urlPath = new Map<string, { path: string; assetId?: string }>();
let urlPatched = false;

export function rememberNativeFile(file: Blob, path: string, assetId?: string) {
  fileInfo.set(file, { path, assetId });
  if (urlPatched) return;
  urlPatched = true;
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const u = create(obj);
    const info = obj instanceof Blob ? fileInfo.get(obj) : undefined;
    if (info) urlPath.set(u, info);
    return u;
  };
  URL.revokeObjectURL = (u: string) => { urlPath.delete(u); revoke(u); };
}

/** 這個網址（blob: 或 File）在原生端的路徑；沒有就 undefined */
export const nativePathOf = (src: string | Blob | null | undefined): string | undefined => {
  if (!src) return undefined;
  if (typeof src === 'string') return urlPath.get(src)?.path;
  return fileInfo.get(src)?.path;
};

/** 這個檔案在相簿裡的 id（從系統選擇器選的照片才有） */
export const nativeAssetIdOf = (src: string | Blob | null | undefined): string | undefined => {
  if (!src) return undefined;
  if (typeof src === 'string') return urlPath.get(src)?.assetId;
  return fileInfo.get(src)?.assetId;
};
