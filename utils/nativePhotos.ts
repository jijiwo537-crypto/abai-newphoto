/* 選照片、存進相簿（對應 ios/App/App/NativePhotosPlugin.swift、PhotoLibraryPlugin.swift）。
 *
 * ‧ installNativeFilePicker：App 裡所有「選照片／影片」的 <input type=file> 一律直接打開
 *   App 自己的相簿畫面（components/NativeGallery），不會再出現「拍照／照片圖庫／選擇檔案」那個選單。
 *   相簿權限被拒、或使用者在相簿畫面選了「改用系統的照片選擇器」，就改開系統的照片選擇器（那個不需要權限）。
 *   選好的檔案照樣塞回那個 input、觸發 change 事件，所以各個工具的程式完全不用改。
 *   其他種類的檔案（字型、LUT…）照舊用網頁的選擇器。
 * ‧ saveToPhotos：「儲存圖片」直接存進相簿（不跳分享面板），存到一半切到背景也會做完。
 *   照片如果是從選擇器選來的、而且使用者允許完整相簿權限，就存成「原本那張照片的可逆編輯」：
 *   Photos 保留原圖，隨時能回復。 */
import { isNative } from './native';
import { nativePlugin, rememberNativeFile, fileSrc, isVideoItem, nativeVideoFile, nativePathOf } from './nativeBridge';
import { nativeImage, withBackgroundTask, blobToNativeFile } from './nativeImage';
import { haptic } from './haptics';
import { PHOTO_EXTS, RAW_EXTS, VIDEO_EXTS } from './fileTypes';
import { openGallery, photoLibrary } from './nativeGallery';
import { allowsAlpha, dropAlphaFiles, ALPHA_NOT_ALLOWED_MSG } from './alphaGuard';

interface PickedItem { path: string; name: string; type: string; size: number; assetId?: string; width?: number; height?: number }
interface NativePhotosApi {
  pick(o: { limit: number; filter: 'images' | 'videos' | 'any' }): Promise<{ items: PickedItem[] }>;
  authorize(o: { level: 'addOnly' | 'readWrite' }): Promise<{ status: string }>;
  save(o: { path: string; kind: 'photo' | 'video'; assetId?: string; adjustment?: string; rawPath?: string }): Promise<{ saved: boolean; mode: string; assetId?: string }>;
  readAdjustment(o: { assetId: string }): Promise<{ adjustment?: string; originalPath?: string }>;
  requestReview?(): Promise<{ asked: boolean }>;
}

export const nativePhotos = () => nativePlugin<NativePhotosApi>('NativePhotos');

/** 系統選擇器選檔，回傳一般的 File（同時記下原生路徑與相簿 id） */
export async function pickNativeFiles(limit: number, filter: 'images' | 'videos' | 'any'): Promise<File[] | null> {
  const p = await nativePhotos();
  if (!p) return null;
  const { items } = await p.pick({ limit, filter });
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
  /* 選了卻一張都讀不進來：說清楚，不要看起來像沒反應 */
  if (items.length && !files.length) throw new Error(lastError || '照片讀不進來');
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
  /* 先確定這版 App 真的有相簿（自己的或系統的），才接手；都沒有就照網頁原本的選擇器，不會變成「點了沒反應」 */
  let ready = false;
  let gallery = false;
  void nativePhotos().then(p => { ready = ready || !!p; });
  void photoLibrary().then(p => { gallery = !!p; ready = ready || !!p; });
  const open = async (input: HTMLInputElement, filter: 'images' | 'videos' | 'any') => {
    /* 多選的上限：輸入框自己寫 data-max（例如批量編輯 15 張）；沒寫＝不限 */
    const maxAttr = Number(input.getAttribute('data-max'));
    const limit = input.multiple ? (maxAttr > 0 ? Math.floor(maxAttr) : 0) : 1;
    let files: File[] | null = null;
    /** 從自己的相簿選的時候用的是哪一種導入（見 data-pick-modes）；系統選擇器、網頁版沒有這個 */
    let pickMode = '';
    delete input.dataset.pickMode;
    /* 自動測試（utils/nativeQA）先放好的檔案：直接用，不開相簿 */
    const qa = (window as any).__abaiQAFiles as ((f: typeof filter) => File[] | null) | undefined;
    if (qa) files = qa(filter);
    if (!files) try {
      /* 去背圖只有帶 data-allow-alpha 的匯入入口能選（見 utils/alphaGuard） */
      /* data-raw-max：選到 RAW 時最多幾張（批量編輯：RAW 10 張、一般照片 50 張） */
      const rawLimit = Math.max(0, Math.floor(Number(input.getAttribute('data-raw-max')) || 0));
      /* data-instant：點了照片就直接進工具（點陣文字）。照片一點下去先發 abai-pick-begin（帶縮圖），
         讓工具馬上打開；原檔拿好後照常發 change。拿不到發 abai-pick-fail */
      const instant = input.hasAttribute('data-instant') && limit === 1;
      /* data-pick-modes：相簿上面多一排「編輯／拼圖／批量編輯」（編輯的導入）。選了哪一種記在 input.dataset.pickMode，
         App 讀完就清掉；data-pick-start 是這一次要先停在哪一種（用一次就清掉） */
      const modes = input.hasAttribute('data-pick-modes') && limit !== 1;
      const start = input.getAttribute('data-pick-start');
      input.removeAttribute('data-pick-start');
      if (gallery) files = await openGallery({ limit, filter, noAlpha: !allowsAlpha(input), hero: input.getAttribute('data-import-hero') || undefined, quiet: maxAttr > 0, rawLimit,
        ...(modes ? {
          modes: true,
          initialMode: start === 'collage' || start === 'batch' ? start : 'edit',
          onMode: (m: 'edit' | 'collage' | 'batch') => { pickMode = m; },
        } : {}),
        ...(instant ? {
          onInstant: (thumb: string | null) => input.dispatchEvent(new CustomEvent('abai-pick-begin', { detail: { thumb } })),
          onInstantFail: () => input.dispatchEvent(new CustomEvent('abai-pick-fail')),
        } : {}) });
      /* 自己的相簿用不了（權限被拒、使用者選了系統的）→ 系統照片選擇器 */
      if (files === null) files = await pickNativeFiles(limit, filter);
    }
    catch (e: any) { alert(`開不了相簿：${String(e?.message ?? e ?? '')}`); return; }
    if (files && limit > 1 && files.length > limit) files = files.slice(0, limit);
    /* 從主頁導入單張的過場：工具畫出來後，替身飛到照片的位置；其他情況收掉 */
    const { landImportHero, cancelImportHero, importHeroActive, setImportHeroFile } = await import('./importHero');
    if (importHeroActive()) {
      if (files && files.length === 1) { setImportHeroFile(files[0]); void landImportHero(); }
      else cancelImportHero();
    }
    /* 直接進工具的那種（已經先打開工具了）：最後沒有拿到照片就通知它退回去 */
    const failInstant = () => { if (input.hasAttribute('data-instant')) input.dispatchEvent(new CustomEvent('abai-pick-fail')); };
    if (!files) { failInstant(); return; }
    if (!files.length) { failInstant(); return; }    // 使用者按了取消
    /* 系統照片選擇器（或舊版 App 的相簿）沒辦法事先藏去背圖：選完再過濾 */
    if (!allowsAlpha(input) && filter !== 'videos') {
      const { kept, dropped } = await dropAlphaFiles(files);
      if (dropped) { cancelImportHero(); alert(ALPHA_NOT_ALLOWED_MSG); }
      files = kept;
      if (!files.length) { failInstant(); return; }
    }
    if (pickMode) input.dataset.pickMode = pickMode;
    try {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      input.files = dt.files;
    } catch (e: any) { alert(`照片交不進來：${String(e?.message ?? e ?? '')}`); return; }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  /* 用 capture 在最前面攔：程式裡 input.click() 和使用者點 <label> 都會經過這裡 */
  document.addEventListener('click', e => {
    const t = e.target;
    if (!ready || !(t instanceof HTMLInputElement) || t.type !== 'file') return;
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
/** buzz：存好時要不要在這裡就震動（不給＝要）。成品頁自動存檔時傳 false：震動改由成品頁在「畫面真的掀開」的那一格震（見 SaveButton） */
export async function saveToPhotos(files: File[], buzz = true): Promise<SaveOutcome | null> {
  const p = await nativePhotos();
  const img = await nativeImage();
  if (!p || !img) return null;
  return withBackgroundTask('abai-save', async () => {
    let ok = 0, error = '';
    /* 一律存成一張新照片（不覆蓋原圖）：使用者要的是「多一張成品」 */
    const single: SaveContext | null = null;
    if (single?.assetId) {
      try { await p.authorize({ level: 'readWrite' }); } catch { /* 沒給就存成新照片 */ }
    }
    for (const f of files) {
      let path = '';
      /* 原生本來就有這個檔（成品直接在原生編碼好的、從相簿選進來的）：直接存那個檔，不再搬一次；那個檔不是這裡建的，不刪 */
      const own = nativePathOf(f);
      try {
        const ext = (f.name.includes('.') ? f.name.split('.').pop()! : (f.type.split('/')[1] ?? 'jpg')).toLowerCase();
        path = own || await blobToNativeFile(f, ext);
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
        if (path && !own) img.remove({ path }).catch(() => {});
      }
    }
    if (buzz) haptic(ok === files.length ? 'success' : 'error');
    return ok === files.length ? { status: 'saved' } : { status: 'failed', error: error || '存檔失敗' };
  });
}

/* ── 請使用者評分 ──────────────────────────────────────────────
   「儲存成功」算一次（一次存好幾張也只算一次）。第 1 次儲存成功時請 iOS 跳評分視窗，
   之後每多 5 次再請一次（第 6、11、16… 次）。
   要不要真的顯示由 iOS 決定：已經評過分的人不會再看到、一年最多三次 —— App 讀不到「評過了沒」，
   所以這裡只管「什麼時候開口」，不重複打擾是系統保證的。只有 App 有，網頁版什麼都不做。 */
const REVIEW_KEY = 'abai.review.saves';
/** 第 n 次儲存成功（從 1 算起）要不要開口 */
export const shouldAskReview = (n: number) => n >= 1 && (n - 1) % 5 === 0;
/** 記一次「儲存成功」，輪到的話就請系統跳評分視窗。回傳這是第幾次 */
export function noteExportForReview(): number {
  let n = 0;
  try { n = (Number(localStorage.getItem(REVIEW_KEY)) || 0) + 1; localStorage.setItem(REVIEW_KEY, String(n)); } catch { return 0; }
  if (isNative() && shouldAskReview(n)) {
    /* 等成品頁完全出現、震動結束再跳，不跟「存好了」搶同一瞬間 */
    setTimeout(() => { void nativePhotos().then(p => p?.requestReview?.()).catch(() => {}); }, 900);
  }
  return n;
}
