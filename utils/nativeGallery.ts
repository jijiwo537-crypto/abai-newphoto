/* App 自己的相簿畫面（對應 ios/App/App/PhotoLibraryPlugin.swift、components/NativeGallery.tsx）。
 *
 * openGallery 會在畫面最上層開一個相簿，選好就回傳一般的 File（同時記下原生路徑與相簿 id，
 * 之後縮圖、存回原圖的可逆編輯都用得到）。
 *   回傳 File[]：選好了（空陣列＝按了取消）
 *   回傳 null  ：用不了這個相簿（不是 App、這版 App 沒有、或使用者選擇改用系統選擇器）
 * 網頁版完全不會載入這支。 */
import { nativePlugin, fileSrc, rememberNativeFile, isVideoItem, nativeVideoFile } from './nativeBridge';

export type GalleryFilter = 'images' | 'videos' | 'any';
export type LibraryStatus = 'authorized' | 'limited' | 'denied' | 'restricted' | 'notDetermined';
export interface LibraryAlbum { id: string; title: string; count: number; cover: string }
export interface LibraryAsset { id: string; w: number; h: number; video: boolean; duration: number; /** 檔案類型可能帶透明（PNG／WebP…），還沒確認 */ maybeAlpha?: boolean }
interface ExportedItem { path: string; name: string; type: string; assetId?: string; width?: number; height?: number }

export interface PhotoLibraryApi {
  access(): Promise<{ status: LibraryStatus }>;
  request(): Promise<{ status: LibraryStatus }>;
  albums(o: { filter: GalleryFilter }): Promise<{ albums: LibraryAlbum[] }>;
  assets(o: { album: string; filter: GalleryFilter; offset: number; limit: number }): Promise<{ total: number; items: LibraryAsset[] }>;
  /** 這幾張是不是去背圖（舊版 App 沒有這支） */
  alphaFlags?(o: { ids: string[] }): Promise<{ flags: Record<string, boolean> }>;
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

/* 一次送一小批、最多三批同時在跑：一批裡有張要從 iCloud 下載，也不會卡住其他格子 */
let inflight = 0;
const retried = new Set<string>();
async function flush() {
  timer = null;
  const p = source ?? await photoLibrary();
  if (!p) { queued = []; waiting.clear(); return; }
  while (queued.length && inflight < 3) {
    const ids = queued.splice(0, 12);
    inflight++;
    void p.thumbs({ ids, size: THUMB_SIZE }).then(({ items }) => {
      for (const it of items) {
        const url = fileSrc(it.path);
        thumbUrl.set(it.id, url);
        waiting.get(it.id)?.forEach(fn => fn(url));
        waiting.delete(it.id);
      }
    }).catch(() => { /* 整批失敗：下面重試一次 */ }).finally(() => {
      inflight--;
      /* 這一批沒拿到的：還有人在等就再試一次（剛開相簿時系統還在準備縮圖，偶爾會空手而回） */
      for (const id of ids) {
        if (thumbUrl.has(id) || !waiting.has(id)) continue;
        if (retried.has(id)) { waiting.delete(id); continue; }
        retried.add(id); queued.push(id);
      }
      if (queued.length && !timer) timer = setTimeout(flush, queued.length ? 120 : 16);
    });
  }
}

/** 相簿一打開就先把第一頁的縮圖要好（不等格子出現在畫面上） */
export function prefetchThumbs(ids: string[]) {
  for (const id of ids) if (!thumbUrl.has(id) && !waiting.has(id)) { waiting.set(id, []); queued.push(id); }
  if (queued.length && !timer) timer = setTimeout(flush, 0);
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
      if (isVideoItem(it)) { files.push(nativeVideoFile(it)); continue; }
      const res = await fetch(fileSrc(it.path));
      if (!res.ok) throw new Error(`${it.name || '檔案'} 讀檔失敗（${res.status}）`);
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
export function openGallery(o: { limit: number; filter: GalleryFilter; noAlpha?: boolean }): Promise<File[] | null> {
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
      root.render(createElement(NativeGallery, { api: p, limit: o.limit, filter: o.filter, noAlpha: !!o.noAlpha, onClose: close }));
    });
  })().finally(() => { opening = null; });
  return opening;
}
