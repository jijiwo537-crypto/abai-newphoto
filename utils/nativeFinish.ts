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
