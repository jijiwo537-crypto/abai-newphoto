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
  /** 背景預熱去背判斷（舊版 App 沒有這支） */
  warmAlpha?(o: { limit: number }): Promise<{ started?: boolean; checked?: number }>;
  rawHero?(o: { id: string; size: number }): Promise<{ path?: string }>;
  rawIds?(o: { ids: string[] }): Promise<{ raw: string[] }>;
  thumbs(o: { ids: string[]; size: number; skipRaw?: boolean }): Promise<{ items: { id: string; path: string }[] }>;
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
/** 大一點的縮圖（短邊約 1024，相簿縮圖檔案快取）：導入過場用，飛的時候要夠清楚。拿不到回 null */
export async function bigThumb(id: string, size = 1024): Promise<string | null> {
  try {
    const p = source ?? await photoLibrary();
    if (!p) return null;
    const { items } = await p.thumbs({ ids: [id], size, skipRaw: true });
    return items[0]?.path ? fileSrc(items[0].path) : null;
  } catch { return null; }
}

/** 這幾張裡哪些是 RAW（問不到就當作都不是） */
export async function rawAssetIds(ids: string[]): Promise<Set<string>> {
  try {
    const p = source ?? await photoLibrary();
    if (!p?.rawIds) return new Set();
    return new Set((await p.rawIds({ ids })).raw || []);
  } catch { return new Set(); }
}

/** RAW 照片導入過場用的預覽：跟編輯器同一套 RAW 引擎沖的（無銳化、同樣明暗）。不是 RAW、拿不到回 null */
export async function rawHeroThumb(id: string, size = 1024): Promise<string | null> {
  try {
    const p = source ?? await photoLibrary();
    if (!p?.rawHero) return null;
    const r = await p.rawHero({ id, size });
    return r?.path ? fileSrc(r.path) : null;
  } catch { return null; }
}

export const cachedThumb = (id: string) => thumbUrl.get(id);

/* 解碼好的縮圖：網址拿到之後先在背景解碼並留著，相簿格子一出現就直接有圖（不會先灰一下再淡入）。
   最多留 240 張（每張 360px，約 0.5MB），超過就丟最舊的。 */
const decodedThumbs = new Map<string, HTMLImageElement>();
const decodeThumb = (id: string, url: string) => {
  if (decodedThumbs.has(id)) return;
  const im = new Image();
  im.src = url;
  void im.decode().then(() => {
    decodedThumbs.set(id, im);
    while (decodedThumbs.size > 240) { const k = decodedThumbs.keys().next().value; if (k === undefined) break; decodedThumbs.delete(k); }
  }).catch(() => { /* 解不出來就照原本淡入 */ });
};
export const isThumbDecoded = (id: string) => decodedThumbs.has(id);

/* 「最近項目」第一頁的清單（依篩選分開記）：預熱或上一次打開時拿到的，下次打開先用它畫，不用等 */
const firstPages = new Map<string, { total: number; items: LibraryAsset[] }>();
export const cachedFirstPage = (filter: GalleryFilter) => firstPages.get(filter);
export const rememberFirstPage = (filter: GalleryFilter, page: { total: number; items: LibraryAsset[] }) => { firstPages.set(filter, page); };

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
        decodeThumb(it.id, url);
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
export function openGallery(o: { limit: number; filter: GalleryFilter; noAlpha?: boolean; /** 導入單張時播放大過場：哪一個工具（edit／beauty／match），終點照它的版面算 */ hero?: string; /** 有上限但不在相簿裡寫出「最多可選 N 張」 */ quiet?: boolean; /** 選到 RAW 時最多幾張（0＝不限） */ rawLimit?: number;
  /** 點下去就直接進工具（不顯示匯入中）：見 NativeGallery 的 onInstant */ onInstant?: (thumb: string | null) => void; onInstantFail?: () => void }): Promise<File[] | null> {
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
      root.render(createElement(NativeGallery, { api: p, limit: o.limit, filter: o.filter, noAlpha: !!o.noAlpha, hero: o.hero, quiet: !!o.quiet, rawLimit: o.rawLimit || 0, onInstant: o.onInstant, onInstantFail: o.onInstantFail, onClose: close }));
    });
  })().finally(() => { opening = null; });
  return opening;
}

/** App 打開後在背景預熱相簿：哪些是去背圖、第一頁的清單、前幾十張縮圖（已解碼）。
 *  之後打開相簿一出來就是完整的，不會先灰一片。沒有相簿權限時什麼都不做（不會跳詢問）。 */
export function warmGalleryAlpha() {
  setTimeout(() => {
    void (async () => {
      const p = await photoLibrary();
      if (!p) return;
      const { status } = await p.access();
      if (status !== 'authorized' && status !== 'limited') return;
      void p.warmAlpha?.({ limit: 800 }).catch(() => {});
      for (const filter of ['images', 'any'] as GalleryFilter[]) {
        try {
          const r = await p.assets({ album: 'recents', filter, offset: 0, limit: 150 });
          rememberFirstPage(filter, r);
          prefetchThumbs(r.items.slice(0, 48).map(a => a.id));
        } catch { /* 拿不到就等打開時再拿 */ }
      }
    })().catch(() => {});
  }, 2500);
}
