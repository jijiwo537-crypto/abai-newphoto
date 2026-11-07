/* 系統照片選擇器、存進相簿（對應 ios/App/App/NativePhotosPlugin.swift）。
 *
 * ‧ installNativeFilePicker：App 裡所有「選照片／影片」的 <input type=file> 一律改用系統照片選擇器。
 *   不需要相簿權限，原檔（HEIC 就是 HEIC）直接交給原生端；選好的檔案照樣塞回那個 input、
 *   觸發 change 事件，所以各個工具的程式完全不用改。其他種類的檔案（字型、LUT…）照舊用網頁的選擇器。
 * ‧ saveToPhotos：「儲存圖片」直接存進相簿（不跳分享面板），存到一半切到背景也會做完。
 *   照片如果是從選擇器選來的、而且使用者允許完整相簿權限，就存成「原本那張照片的可逆編輯」：
 *   Photos 保留原圖，隨時能回復。 */
import { isNative } from './native';
import { nativePlugin, rememberNativeFile, fileSrc, blobToBase64 } from './nativeBridge';
import { nativeImage, withBackgroundTask } from './nativeImage';
import { haptic } from './haptics';

interface PickedItem { path: string; name: string; type: string; size: number; assetId?: string; width?: number; height?: number }
interface NativePhotosApi {
  pick(o: { limit: number; filter: 'images' | 'videos' | 'any' }): Promise<{ items: PickedItem[] }>;
  authorize(o: { level: 'addOnly' | 'readWrite' }): Promise<{ status: string }>;
  save(o: { path: string; kind: 'photo' | 'video'; assetId?: string; adjustment?: string }): Promise<{ saved: boolean; mode: string; assetId?: string }>;
  readAdjustment(o: { assetId: string }): Promise<{ adjustment?: string; originalPath?: string }>;
}

export const nativePhotos = () => nativePlugin<NativePhotosApi>('NativePhotos');

/** 系統選擇器選檔，回傳一般的 File（同時記下原生路徑與相簿 id） */
export async function pickNativeFiles(limit: number, filter: 'images' | 'videos' | 'any'): Promise<File[] | null> {
  const p = await nativePhotos();
  if (!p) return null;
  const { items } = await p.pick({ limit, filter });
  const files: File[] = [];
  for (const it of items) {
    try {
      const blob = await (await fetch(fileSrc(it.path))).blob();
      const f = new File([blob], it.name || 'photo', { type: it.type || blob.type, lastModified: Date.now() });
      rememberNativeFile(f, it.path, it.assetId);
      files.push(f);
    } catch { /* 這一個讀不到就跳過 */ }
  }
  return files;
}

/** 這個 input 收的是照片／影片嗎？（其他種類照舊用網頁的選擇器） */
function mediaFilter(input: HTMLInputElement): 'images' | 'videos' | 'any' | null {
  const accept = (input.accept || '').toLowerCase();
  if (!accept) return null;
  const parts = accept.split(',').map(s => s.trim()).filter(Boolean);
  const img = parts.some(s => s.startsWith('image/') || /^\.(jpe?g|png|heic|heif|webp|gif|avif|dng|cr2|cr3|nef|arw|raf|orf|rw2|tiff?)$/.test(s));
  const vid = parts.some(s => s.startsWith('video/') || /^\.(mov|mp4|m4v)$/.test(s));
  const other = parts.some(s => !(s.startsWith('image/') || s.startsWith('video/') || /^\.(jpe?g|png|heic|heif|webp|gif|avif|dng|cr2|cr3|nef|arw|raf|orf|rw2|tiff?|mov|mp4|m4v)$/.test(s)));
  if (other) return null;
  return img && vid ? 'any' : img ? 'images' : vid ? 'videos' : null;
}

let installed = false;
export function installNativeFilePicker() {
  if (installed || !isNative()) return;
  installed = true;
  const open = async (input: HTMLInputElement, filter: 'images' | 'videos' | 'any') => {
    let files: File[] | null = null;
    try { files = await pickNativeFiles(input.multiple ? 0 : 1, filter); } catch { files = null; }
    if (files === null) { input.dataset.abaiNativePicker = 'off'; input.click(); delete input.dataset.abaiNativePicker; return; }
    if (!files.length) return;
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  /* 用 capture 在最前面攔：程式裡 input.click() 和使用者點 <label> 都會經過這裡 */
  document.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'file' || t.dataset.abaiNativePicker === 'off') return;
    const filter = mediaFilter(t);
    if (!filter) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void open(t, filter);
  }, true);
}

/** 可逆編輯要的資料：哪一張原圖、這次的編輯清單 */
export interface SaveContext { assetId?: string; adjustment?: unknown | (() => unknown) }
let saveContext: SaveContext | null = null;
/** 工具在存檔前告訴這裡「這次的成品來自哪一張照片、做了哪些編輯」 */
export function setSaveContext(ctx: SaveContext | null) { saveContext = ctx; }

/** 存進相簿。回傳 null＝不是 App（呼叫端走原本的分享／下載） */
export async function saveToPhotos(files: File[]): Promise<'saved' | 'failed' | null> {
  const p = await nativePhotos();
  const img = await nativeImage();
  if (!p || !img) return null;
  return withBackgroundTask('abai-save', async () => {
    let ok = 0;
    const single = files.length === 1 ? saveContext : null;
    if (single?.assetId) {
      try { await p.authorize({ level: 'readWrite' }); } catch { /* 沒給就存成新照片 */ }
    }
    for (const f of files) {
      try {
        const ext = (f.name.split('.').pop() || (f.type.split('/')[1] ?? 'jpg')).toLowerCase();
        const { path } = await img.writeTemp({ data: await blobToBase64(f), ext });
        const kind = f.type.startsWith('video') ? 'video' : 'photo';
        await p.save({
          path, kind,
          assetId: single?.assetId,
          adjustment: single?.adjustment ? JSON.stringify({ app: 'abai', v: 1, at: Date.now(),
            state: typeof single.adjustment === 'function' ? (single.adjustment as () => unknown)() : single.adjustment }) : undefined,
        });
        img.remove({ path }).catch(() => {});
        ok++;
      } catch { /* 下一個 */ }
    }
    haptic(ok === files.length ? 'success' : 'error');
    return ok === files.length ? 'saved' : 'failed';
  });
}
