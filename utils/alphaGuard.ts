/* 去背（有透明像素）的圖片只能匯入兩個地方：
 *   ‧ 創意拼圖：進去之後的「匯入圖片」（一開始選底圖不行）
 *   ‧ 跨頁拼圖：從一開始到裡面的「匯入圖片」都可以
 * 那些 <input type=file> 會帶 data-allow-alpha。其他地方：
 *   ‧ App 的相簿畫面直接不顯示去背圖（見 components/NativeGallery 的 noAlpha）
 *   ‧ 系統照片選擇器、網頁的檔案選擇器沒辦法事先藏：選完之後在這裡過濾掉並提示
 * 一般（不透明）的 PNG 照常可以用；判斷是把圖縮成 96px 逐像素看。 */
import { isNative } from './native';

const ALPHA_TYPES = /png|webp|gif|avif|tiff/i;
const ALPHA_EXT = /\.(png|webp|gif|avif|tiff?)$/i;

export const ALPHA_NOT_ALLOWED_MSG = '去背圖片只能在創意拼圖的「匯入圖片」和跨頁拼圖使用';

/** 這個檔案是去背圖嗎（有任何一個不是完全不透明的像素） */
export async function fileHasAlpha(f: File): Promise<boolean> {
  if (!(ALPHA_TYPES.test(f.type || '') || ALPHA_EXT.test(f.name || ''))) return false;
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(f, { resizeWidth: 96, resizeHeight: 96, resizeQuality: 'low', premultiplyAlpha: 'none' } as ImageBitmapOptions);
  } catch {
    try { bmp = await createImageBitmap(f); } catch { return false; }
  }
  try {
    const c = document.createElement('canvas'); c.width = 96; c.height = 96;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return false;
    g.clearRect(0, 0, 96, 96);
    g.drawImage(bmp, 0, 0, 96, 96);
    const d = g.getImageData(0, 0, 96, 96).data;
    c.width = c.height = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    return false;
  } catch { return false; }
  finally { bmp.close?.(); }
}

/** 拿掉去背圖。回傳留下來的與被拿掉幾張 */
export async function dropAlphaFiles(files: File[]): Promise<{ kept: File[]; dropped: number }> {
  const flags = await Promise.all(files.map(f => fileHasAlpha(f).catch(() => false)));
  const kept = files.filter((_, i) => !flags[i]);
  return { kept, dropped: files.length - kept.length };
}

export const allowsAlpha = (input: HTMLInputElement) => input.hasAttribute('data-allow-alpha');

/** 網頁版（不是 App）：檔案選完、工具還沒接手前先過濾。
 *  在 capture 階段攔下 change，非同步檢查完再把留下的檔案交回 input、重新送一次 change。 */
let installed = false;
const passing = new WeakSet<HTMLInputElement>();
export function installAlphaGuard() {
  if (installed || isNative()) return;     // App 裡在 utils/nativePhotos 的選擇流程裡處理
  installed = true;
  document.addEventListener('change', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'file' || allowsAlpha(t)) return;
    if (passing.has(t)) { passing.delete(t); return; }
    const files = Array.from(t.files || []);
    if (!files.some(f => ALPHA_TYPES.test(f.type || '') || ALPHA_EXT.test(f.name || ''))) return;
    e.stopImmediatePropagation();
    void (async () => {
      const { kept, dropped } = await dropAlphaFiles(files);
      if (dropped) alert(ALPHA_NOT_ALLOWED_MSG);
      if (!kept.length) { t.value = ''; return; }
      try {
        const dt = new DataTransfer();
        kept.forEach(f => dt.items.add(f));
        t.files = dt.files;
      } catch { t.value = ''; return; }
      passing.add(t);
      t.dispatchEvent(new Event('change', { bubbles: true }));
    })();
  }, true);
}
