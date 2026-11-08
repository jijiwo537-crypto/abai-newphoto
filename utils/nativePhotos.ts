/* 系統照片選擇器、存進相簿（對應 ios/App/App/NativePhotosPlugin.swift）。
 *
 * ‧ installNativeFilePicker：App 裡所有「選照片／影片」的 <input type=file> 一律改用系統照片選擇器。
 *   不需要相簿權限，原檔（HEIC 就是 HEIC）直接交給原生端；選好的檔案照樣塞回那個 input、
 *   觸發 change 事件，所以各個工具的程式完全不用改。其他種類的檔案（字型、LUT…）照舊用網頁的選擇器。
 * ‧ saveToPhotos：「儲存圖片」直接存進相簿（不跳分享面板），存到一半切到背景也會做完。
 *   照片如果是從選擇器選來的、而且使用者允許完整相簿權限，就存成「原本那張照片的可逆編輯」：
 *   Photos 保留原圖，隨時能回復。 */
import { isNative } from './native';
import { nativePlugin, rememberNativeFile, fileSrc } from './nativeBridge';
import { nativeImage, withBackgroundTask, blobToNativeFile } from './nativeImage';
import { haptic } from './haptics';
import { PHOTO_EXTS, RAW_EXTS, VIDEO_EXTS } from './fileTypes';

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

/** 這個 input 收的是照片／影片嗎？（字型、LUT 這類其他檔案照舊用網頁的選擇器）
 *  副檔名清單跟 utils/fileTypes 同一份：RAW、PSD、EXR 這些也都算照片 */
const IMAGE_EXT = new Set([...PHOTO_EXTS, ...RAW_EXTS]);
const VIDEO_EXT = new Set(VIDEO_EXTS);
function mediaFilter(input: HTMLInputElement): 'images' | 'videos' | 'any' | null {
  const accept = (input.accept || '').toLowerCase();
  if (!accept) return null;
  const parts = accept.split(',').map(s => s.trim()).filter(Boolean);
  const kind = (s: string) => s.startsWith('image/') ? 'img' : s.startsWith('video/') ? 'vid'
    : s.startsWith('.') && IMAGE_EXT.has(s.slice(1)) ? 'img' : s.startsWith('.') && VIDEO_EXT.has(s.slice(1)) ? 'vid' : 'other';
  const kinds = parts.map(kind);
  if (kinds.includes('other')) return null;
  const img = kinds.includes('img'), vid = kinds.includes('vid');
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
export interface SaveOutcome { status: 'saved' | 'failed'; error?: string }
/** 存進相簿。回傳 null＝不是 App 或這版 App 沒有相簿外掛（呼叫端走原本的分享／下載） */
export async function saveToPhotos(files: File[]): Promise<SaveOutcome | null> {
  const p = await nativePhotos();
  const img = await nativeImage();
  if (!p || !img) return null;
  return withBackgroundTask('abai-save', async () => {
    let ok = 0, error = '';
    const single = files.length === 1 ? saveContext : null;
    if (single?.assetId) {
      try { await p.authorize({ level: 'readWrite' }); } catch { /* 沒給就存成新照片 */ }
    }
    for (const f of files) {
      let path = '';
      try {
        const ext = (f.name.includes('.') ? f.name.split('.').pop()! : (f.type.split('/')[1] ?? 'jpg')).toLowerCase();
        path = await blobToNativeFile(f, ext);
        const kind = f.type.startsWith('video') ? 'video' : 'photo';
        await p.save({
          path, kind,
          assetId: single?.assetId,
          adjustment: single?.adjustment ? JSON.stringify({ app: 'abai', v: 1, at: Date.now(),
            state: typeof single.adjustment === 'function' ? (single.adjustment as () => unknown)() : single.adjustment }) : undefined,
        });
        ok++;
      } catch (e: any) {
        error = String(e?.message ?? e ?? '');
      } finally {
        if (path) img.remove({ path }).catch(() => {});
      }
    }
    haptic(ok === files.length ? 'success' : 'error');
    return ok === files.length ? { status: 'saved' } : { status: 'failed', error: error || '存檔失敗' };
  });
}
