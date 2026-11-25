/* 美顏、仿色存檔的最後一步（App 裡）：網頁算好的無損成品交給原生收尾 —— 跟編輯器的「網頁成品＋原生補回」同一條路：
 *   ‧ 沒被改到的地方換回原圖超出 sRGB 的顏色（廣色域）與 HDR 亮部（原圖有的話，HEIC／JPEG 會帶增益圖）
 *   ‧ HEIC 用 10 位元編碼（之前是 8 位元 PNG 直接轉）
 *   ‧ 原圖的拍攝資訊（機型、鏡頭、光圈、快門、ISO、時間、GPS）寫進成品
 * 做不到（網頁版、照片不是從檔案來的、原生失敗）回 null，呼叫端照舊用網頁的編碼 */
import { isNative } from './native';
import { nativePathOf, fileSrc } from './nativeBridge';
import { nativeImage, blobToNativeFile } from './nativeImage';

export async function nativeFinish(pngUrl: string, originalSrc: string, fmt: 'jpg' | 'png' | 'heic'): Promise<string | null> {
  if (!isNative()) return null;
  const path = nativePathOf(originalSrc);
  if (!path) return null;
  const api = await nativeImage();
  if (!api) return null;
  let basePath = '', outPath = '';
  try {
    basePath = await blobToNativeFile(await (await fetch(pngUrl)).blob(), 'png');
    const nf = fmt === 'heic' ? 'heic10' : fmt === 'jpg' ? 'jpeg' : 'png';
    const r = await api.render({ path, basePath, format: nf, quality: 1, hdr: nf !== 'png', keepGamut: true });
    outPath = r.path;
    const blob = await (await fetch(fileSrc(r.path))).blob();
    if (!blob.size) return null;
    return URL.createObjectURL(new Blob([blob], { type: nf === 'jpeg' ? 'image/jpeg' : nf === 'png' ? 'image/png' : 'image/heic' }));
  } catch { return null; }
  finally {
    if (basePath) api.remove({ path: basePath }).catch(() => {});
    if (outPath) api.remove({ path: outPath }).catch(() => {});
  }
}

/** 只寫拍攝資訊：畫面完全用網頁的成品（不補色、不動任何像素），原生只負責編碼成指定格式、寫入原圖的拍攝資訊。
 *  給「原生沒辦法補色」的存檔用（例如有模糊類效果）。metaPath：拍攝資訊從哪個檔讀（RAW 給原本的 RAW 檔） */
export async function nativeEncodeWithMeta(pngUrl: string, metaPath: string | null | undefined, fmt: 'jpg' | 'png' | 'heic'): Promise<string | null> {
  if (!isNative() || !metaPath) return null;
  const api = await nativeImage();
  if (!api) return null;
  let basePath = '', outPath = '';
  try {
    basePath = await blobToNativeFile(await (await fetch(pngUrl)).blob(), 'png');
    const nf = fmt === 'heic' ? 'heic' : fmt === 'jpg' ? 'jpeg' : 'png';
    /* path 給網頁成品本身（不去解原圖：原圖是 RAW 時整張解碼又重又可能失敗，失敗就沒有拍攝資訊）；拍攝資訊從 metaPath 的檔頭讀 */
    const r = await api.render({ path: basePath, basePath, baseOnly: true, metaPath, format: nf, quality: 1, hdr: false });
    outPath = r.path;
    const blob = await (await fetch(fileSrc(r.path))).blob();
    if (!blob.size) return null;
    return URL.createObjectURL(new Blob([blob], { type: nf === 'jpeg' ? 'image/jpeg' : nf === 'png' ? 'image/png' : 'image/heic' }));
  } catch { return null; }
  finally {
    if (basePath) api.remove({ path: basePath }).catch(() => {});
    if (outPath) api.remove({ path: outPath }).catch(() => {});
  }
}

/** 編輯器存檔的成品：原生檔（呼叫端負責刪）＋成品頁顯示用的小圖 */
export interface NativeOut { path: string; previewPath?: string }
/** 網頁算好的成品（原生檔路徑，或 PNG 網址）只做編碼＋寫入拍攝資訊（不補色、不動像素），日期也在這一次印上。
 *  跟 nativeEncodeWithMeta 一樣，只是成品留在原生、不讀回網頁（存相簿時直接用這個檔），並順便出一張顯示用的小圖。
 *  base.path 由呼叫端負責刪；base.url 這裡上傳、用完就刪。失敗回 null */
export async function nativeEncodeBase(base: { path?: string; url?: string }, metaPath: string | null | undefined, fmt: 'jpg' | 'png' | 'heic',
  o: { date?: string; preview?: number } = {}): Promise<NativeOut | null> {
  if (!isNative() || !metaPath || (!base.path && !base.url)) return null;
  const api = await nativeImage();
  if (!api) return null;
  let tmp = '';
  try {
    const basePath = base.path || (tmp = await blobToNativeFile(await (await fetch(base.url!)).blob(), 'png'));
    const nf = fmt === 'heic' ? 'heic' : fmt === 'jpg' ? 'jpeg' : 'png';
    const r = await api.render({ path: basePath, basePath, baseOnly: true, metaPath, format: nf, quality: 1, hdr: false, date: o.date || undefined, preview: o.preview || 0 });
    return r?.path ? { path: r.path, previewPath: r.previewPath } : null;
  } catch { return null; }
  finally { if (tmp) api.remove({ path: tmp }).catch(() => {}); }
}
