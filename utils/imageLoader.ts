import heic2any from 'heic2any';
import { isPlainWebImage, isVideoFileName } from './fileTypes';

// ImageMagick 只在最後一道防線用到（TIFF、PSD、以及 HEIC/RAW 解碼失敗時），
// 但它的 JS 膠水層與 13.7MB 的 wasm 若靜態載入，等於每位使用者一開 app
// 就要付這個成本。改成動態載入後，一般 JPEG/PNG 使用者完全不會下載到它。
type MagickModule = typeof import('@imagemagick/magick-wasm');
let magick: MagickModule | null = null;
let magickLoading: Promise<void> | null = null;

export async function initMagick() {
  if (magick) return;
  if (magickLoading) return magickLoading;
  magickLoading = (async () => {
    const [mod, wasm] = await Promise.all([
      import('@imagemagick/magick-wasm'),
      import('@imagemagick/magick-wasm/magick.wasm?url'),
    ]);
    try {
      await mod.initializeImageMagick(new URL(wasm.default, import.meta.url));
    } catch (e) {
      console.warn("Magick possibly already initialized", e);
    }
    magick = mod;
  })();
  try {
    await magickLoading;
  } finally {
    magickLoading = null;
  }
}

// -------------------------------------------------------------
// RAW Embedded JPEG Extractor (Bulletproof)
// Most camera RAW formats (ARW, CR2, NEF, DNG) embed a full-size
// JPEG preview. Extracting it directly from bytes is instant and 
// avoids heavy WebAssembly decoder crashes.
// -------------------------------------------------------------
function getJpegSizeFromRaw(bytes: Uint8Array, start: number): number {
  let i = start + 2; 
  while (i < bytes.length - 1) {
      if (bytes[i] !== 0xFF) { 
          i++; continue; 
      }
      const marker = bytes[i + 1];
      if (marker === 0xD9) return i + 2 - start; // EOI
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
          i += 2; continue;
      }
      if (marker === 0xFF) {
          i++; continue; 
      }
      if (marker === 0xDA) { // SOS (Start of Scan)
          // Enter compressed entropy data and scan blindly for EOI
          let j = i + 2;
          while (j < bytes.length - 1) {
              if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) return j + 2 - start;
              j++;
          }
          return -1;
      }
      // Skip variable length segments
      if (i + 3 < bytes.length) {
          const len = (bytes[i + 2] << 8) | bytes[i + 3];
          i += 2 + len;
      } else {
          return -1;
      }
  }
  return -1;
}

async function extractLargestJpegFromRaw(file: File, onPreview?: (url: string) => void): Promise<string | null> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  let largestSize = 0;
  let bestBlob: Blob | null = null;
  let previewFired = false;

  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8) {
      const size = getJpegSizeFromRaw(bytes, i);
      
      // Fire low-res preview instantly for the first reasonable JPEG found
      if (size !== -1 && !previewFired && size > 5000 && onPreview) {
          const previewBlob = new Blob([bytes.slice(i, i + size)], { type: 'image/jpeg' });
          onPreview(URL.createObjectURL(previewBlob));
          previewFired = true;
      }

      if (size !== -1 && size > largestSize) {
        largestSize = size;
        bestBlob = new Blob([bytes.slice(i, i + size)], { type: 'image/jpeg' });
      }
      if (size !== -1) {
        i += size - 1; // Skip the jpeg we just found
      }
    }
  }

  // If we found a JPEG larger than 50KB, it's definitely a preview/high-res image.
  if (bestBlob && largestSize > 50000) {
    return URL.createObjectURL(bestBlob);
  }
  return null;
}

export async function processImageFile(file: File, onPreview?: (url: string) => void): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const mimeType = file.type.toLowerCase();
  
  const isHeic = ['heic', 'heif', 'heics'].includes(extension) || mimeType.includes('heic') || mimeType.includes('heif');
  const isRaw = ['arw', 'cr2', 'cr3', 'nef', 'dng', 'raf', 'orf', 'rw2', 'srw', 'pef', 'x3f'].includes(extension);

  // 1. First, attempt to check if the browser natively supports rendering this file.
  try {
    const nativeUrl = URL.createObjectURL(file);
    const isSupported = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = nativeUrl;
    });
    
    if (isSupported) {
      return nativeUrl;
    } else {
      URL.revokeObjectURL(nativeUrl);
    }
  } catch (e) {
    console.warn("Native browser check failed", e);
  }
  
  // 2. If it's a RAW camera file (Sony ARW, Canon CR2, etc.), intercept it early!
  // ImageMagick WASM lacks delegates for many camera formats. Extracting the embedded preview is perfectly sharp.
  if (isRaw) {
      try {
          const extractedUrl = await extractLargestJpegFromRaw(file, onPreview);
          if (extractedUrl) return extractedUrl;
      } catch (err) {
          console.warn('RAW JPEG extraction failed, falling back to decoder', err);
      }
  }

  // 3. If it's a HEIC file, attempt heic2any.
  if (isHeic) {
    try {
      const convertedBlob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.95,
        multiple: true 
      });
      const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error('Error processing HEIC image with heic2any, falling back to ImageMagick:', err);
    }
  } 
  
  // 4. Last Resort: Force convert using ImageMagick WASM (for TIFF, PSD, failing HEIC/RAW, etc.)
  try {
    await initMagick();
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    return await new Promise<string>((resolve, reject) => {
      try {
        magick!.ImageMagick.read(uint8Array, (image) => {
          image.write(magick!.MagickFormat.Jpeg, (data) => {
            const blob = new Blob([data], { type: 'image/jpeg' });
            resolve(URL.createObjectURL(blob));
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error processing special format image with ImageMagick:', err);
    
    // final desperate fallback for any other files that have standard structure
    try {
         const desperationUrl = await extractLargestJpegFromRaw(file);
         if (desperationUrl) return desperationUrl;
    } catch(e) {}

    throw new Error("無法解析此圖片格式，抱歉！核心模組不支援該特殊編碼或檔案已損毀。\n" + file.name);
  }
}


/**
 * 把「任何圖片檔」變成一個各處都吃得下的 File。
 *
 * ── 為什麼需要這一支 ──────────────────────────────────────────────
 * processImageFile 回傳的是一條網址，但拼圖那幾支工具收的是 File
 * （它們自己 createObjectURL、自己丟進 <img>）。所以以前只有「編輯」「相機」
 * 「相簿」走得到解碼，**拼圖的入口與工具內的匯入完全沒有解碼**——
 * 丟一張 RAW 或 HEIC 進創意拼圖，<img> 載不出來，畫面就是空的。
 * 這一支把解碼補在最前面，而且回傳還是 File，所以下游一行都不用改。
 *
 * 影片原樣放行；瀏覽器本來就讀得懂的 JPEG/PNG/WebP… 也原樣放行
 * （不多一次轉檔、不掉畫質、不多花時間）。
 * 只有真的需要解碼的（RAW／HEIC／TIFF／PSD…）才會走解碼器。
 */
export async function normalizeImageFile(
  file: File,
  onPreview?: (url: string) => void,
): Promise<File> {
  if (isVideoFileName(file) || isPlainWebImage(file)) return file;
  const url = await processImageFile(file, onPreview);
  try {
    const blob = await (await fetch(url)).blob();
    /* 副檔名換成 .jpg：下游有些地方會看副檔名判斷型別，
       留著 .ARW 會讓它們以為還是 RAW。 */
    const base = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: blob.type || 'image/jpeg', lastModified: file.lastModified });
  } finally {
    /* 上面已經把位元組讀進 blob 了，這條中繼網址就沒用了。
       （processImageFile 內部若直接回傳原生網址，收掉它也沒關係 ——
       因為那種情況在上面 isPlainWebImage 就先攔掉了。） */
    try { URL.revokeObjectURL(url); } catch { /* 不是 blob 網址就算了 */ }
  }
}

/** 一批一起處理，順序不變。任何一個失敗就把那一個原樣放行（讓下游自己報錯）。 */
export async function normalizeImageFiles(
  files: File[],
  onPreview?: (url: string) => void,
): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    try { out.push(await normalizeImageFile(f, onPreview)); }
    catch { out.push(f); }
  }
  return out;
}
