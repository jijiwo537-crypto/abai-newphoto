/* App 自己的相簿畫面（對應 ios/App/App/PhotoLibraryPlugin.swift、components/NativeGallery.tsx）。
 *
 * openGallery 會在畫面最上層開一個相簿，選好就回傳一般的 File（同時記下原生路徑與相簿 id，
 * 之後縮圖、存回原圖的可逆編輯都用得到）。
 *   回傳 File[]：選好了（空陣列＝按了取消）
 *   回傳 null  ：用不了這個相簿（不是 App、這版 App 沒有、或使用者選擇改用系統選擇器）
 * 網頁版完全不會載入這支。 */
import { nativePlugin, fileSrc, rememberNativeFile } from './nativeBridge';

export type GalleryFilter = 'images' | 'videos' | 'any';
export type LibraryStatus = 'authorized' | 'limited' | 'denied' | 'restricted' | 'notDetermined';
export interface LibraryAlbum { id: string; title: string; count: number; cover: string }
export interface LibraryAsset { id: string; w: number; h: number; video: boolean; duration: number }
interface ExportedItem { path: string; name: string; type: string; assetId?: string; width?: number; height?: number }

export interface PhotoLibraryApi {
  access(): Promise<{ status: LibraryStatus }>;
  request(): Promise<{ status: LibraryStatus }>;
  albums(o: { filter: GalleryFilter }): Promise<{ albums: LibraryAlbum[] }>;
  assets(o: { album: string; filter: GalleryFilter; offset: number; limit: number }): Promise<{ total: number; items: LibraryAsset[] }>;
  thumbs(o: { ids: string[]; size: number }): Promise<{ items: { id: string; path: string }[] }>;
  export(o: { ids: string[] }): Promise<{ items: ExportedItem[] }>;
  manageLimited(): Promise<void>;
  openSettings(): Promise<void>;
  addListener(event: 'libraryChanged', fn: () => void): Promise<{ remove: () => Promise<void> }>;
}

export const photoLibrary = () => nativePlugin<PhotoLibraryApi>('PhotoLibrary');

/* ── 縮圖：畫面上看得到哪幾格就批次跟原生要，做好的記在這裡，下次打開相簿立刻就有 ── */
export const THUMB_SIZE = 360;
const thumbUrl = new Map<string, string>();
const waiting = new Map<string, Array<(url: string) => void>>();
let queued: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/* 縮圖跟誰要：相簿畫面打開時交給這裡 */
let source: PhotoLibraryApi | null = null;
export const setThumbSource = (api: PhotoLibraryApi | null) => { source = api; };

export const cachedThumb = (id: string) => thumbUrl.get(id);

export function requestThumb(id: string, done: (url: string) => void): () => void {
  const hit = thumbUrl.get(id);
  if (hit) { done(hit); return () => {}; }
  let list = waiting.get(id);
  if (!list) { list = []; waiting.set(id, list); queued.push(id); }
  list.push(done);
  if (!timer) timer = setTimeout(flush, 16);
  return () => {
    const l = waiting.get(id);
    if (!l) return;
    const i = l.indexOf(done);
    if (i >= 0) l.splice(i, 1);
    /* 還沒送出去、也沒人要了（滑過去了）：從待辦拿掉，先做真正停在畫面上的 */
    if (!l.length) { waiting.delete(id); queued = queued.filter(q => q !== id); }
  };
}

async function flush() {
  timer = null;
  const p = source ?? await photoLibrary();
  if (!p) { queued = []; waiting.clear(); return; }
  while (queued.length) {
    const ids = queued.splice(0, 24);
    try {
      const { items } = await p.thumbs({ ids, size: THUMB_SIZE });
      for (const it of items) {
        const url = fileSrc(it.path);
        thumbUrl.set(it.id, url);
        waiting.get(it.id)?.forEach(fn => fn(url));
        waiting.delete(it.id);
      }
    } catch { /* 這一批拿不到就算了，格子保持灰底 */ }
    for (const id of ids) if (!thumbUrl.has(id)) waiting.delete(id);
  }
}

/** 把選好的照片（相簿 id）拿出原檔，變成一般的 File */
export async function exportAssets(ids: string[]): Promise<File[]> {
  const p = await photoLibrary();
  if (!p) throw new Error('沒有相簿外掛');
  const { items } = await p.export({ ids });
  const files: File[] = [];
  let lastError = '';
  for (const it of items) {
    try {
      const res = await fetch(fileSrc(it.path));
      if (!res.ok) throw new Error(`讀檔失敗（${res.status}）`);
      const blob = await res.blob();
      const f = new File([blob], it.name || 'photo', { type: it.type || blob.type, lastModified: Date.now() });
      rememberNativeFile(f, it.path, it.assetId);
      files.push(f);
    } catch (e: any) { lastError = String(e?.message ?? e ?? ''); }
  }
  if (ids.length && !files.length) throw new Error(lastError || '照片讀不進來');
  return files;
}

let opening: Promise<File[] | null> | null = null;

/** 打開相簿。limit：最多選幾張（0＝不限，1＝點一下就完成） */
export function openGallery(o: { limit: number; filter: GalleryFilter }): Promise<File[] | null> {
  if (opening) return opening;              // 連點兩下不會疊兩個相簿
  opening = (async () => {
    const p = await photoLibrary();
    if (!p) return null;
    const [{ createRoot }, { createElement }, { NativeGallery }] = await Promise.all([
      import('react-dom/client'), import('react'), import('../components/NativeGallery'),
    ]);
    return await new Promise<File[] | null>(resolve => {
      const host = document.createElement('div');
      host.setAttribute('data-abai-gallery', '');
      document.body.appendChild(host);
      const root = createRoot(host);
      const close = (files: File[] | null) => {
        resolve(files);
        /* 等收起來的動畫跑完再拆掉 */
        setTimeout(() => { root.unmount(); host.remove(); }, 40);
      };
      root.render(createElement(NativeGallery, { api: p, limit: o.limit, filter: o.filter, onClose: close }));
    });
  })().finally(() => { opening = null; });
  return opening;
}
