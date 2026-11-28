import { isNative } from './native';
import heic2any from 'heic2any';
import { isPlainWebImage, isVideoFileName, isRawFile } from './fileTypes';

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
// RAW 內嵌 JPEG 擷取：大部分相機 RAW（ARW、CR2、NEF、DNG）都內嵌一張全尺寸的 JPEG 預覽，
// 直接從位元組取出來是瞬間的事，也避開笨重的 WebAssembly 解碼器當掉
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
          // 進入壓縮的熵編碼資料，直接往後找 EOI
          let j = i + 2;
          while (j < bytes.length - 1) {
              if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) return j + 2 - start;
              j++;
          }
          return -1;
      }
      // 跳過長度不固定的區段
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
      
      // 找到第一張像樣的 JPEG 就馬上給低解析度預覽
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
        i += size - 1; // 跳過剛找到的那張 JPEG
      }
    }
  }

  // 找到超過 50KB 的 JPEG，那一定是預覽或高解析度的圖
  if (bestBlob && largestSize > 50000) {
    return URL.createObjectURL(bestBlob);
  }
  return null;
}

/** App 裡用我們的 RAW 引擎沖原尺寸（跟編輯器匯入 RAW 同一組參數：曝光、高光、陰影都是 0）。回傳檔案網址，失敗回 null */
async function developRawWithEngine(file: File, ext: string, onPreview?: (url: string) => void): Promise<string | null> {
  const { nativePathOf } = await import('./nativeBridge');
  const { rawDevelopFull } = await import('./nativeCamera');
  /* 從 App 自己的相簿來的有原生路徑；系統檔案 app 來的沒有，就分段寫成原生檔（不會一次產生一整個檔案大小的文字） */
  let path = nativePathOf(file);
  if (!path) { const { blobToNativeFile } = await import('./nativeImage'); path = await blobToNativeFile(file, ext || 'dng'); }
  /* 沖原尺寸要一兩秒：先給內嵌的預覽墊著（跟原本一樣） */
  if (onPreview) { try { const pv = await extractLargestJpegFromRaw(file); if (pv) onPreview(pv); } catch { /* 沒有就算了 */ } }
  return rawDevelopFull(path, { exposure: 0, highlights: 0, shadows: 0 }, null, 'jpeg');
}

export async function processImageFile(file: File, onPreview?: (url: string) => void): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const mimeType = file.type.toLowerCase();
  
  const isHeic = ['heic', 'heif', 'heics'].includes(extension) || mimeType.includes('heic') || mimeType.includes('heif');
  /* 跟 App 允許選的 RAW 清單同一份（以前這裡只認 11 種，Nikon NRW、Leica RWL、哈蘇 3FR、GoPro GPR… 會掉到最後的萬用轉檔） */
  const isRaw = isRawFile(file);

  /* 0. App 裡（iOS 的網頁層本來就看得懂 JPEG／HEIC／PNG／WebP）：常見格式直接用，不再先整張載入一次測試 ——
        批量一次導入幾十張時，每張都先完整解一次碼會讓記憶體一下子衝很高 */
  /* HEIC 要 iOS 17 以上的網頁層才看得懂（App 支援到 iOS 15）：舊系統照原本的方式先測試 */
  const iosMajor = Number((/OS (\d+)_/.exec(navigator.userAgent) || [])[1]) || 0;
  const fastOk = ['jpg', 'jpeg', 'png', 'webp'].includes(extension) || ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
    || (iosMajor >= 17 && (isHeic));
  if (!isRaw && isNative() && fastOk) {
    return URL.createObjectURL(file);
  }
  /* App 裡的 RAW：用編輯器同一套 RAW 引擎沖（不銳化、亮部保護），所有工具裡同一張 RAW 長得一樣。
     原生直接讀檔案路徑、沖好寫成檔案，網頁只拿到一個檔案網址 —— 不再把整個 RAW 轉成文字傳過去、再把成品轉成文字傳回來。
     （iOS 的網頁層自己也看得懂部分 RAW，但那是系統預設的沖法，跟編輯器不一樣，所以要排在下面「瀏覽器直接顯示」之前。）
     沖不出來（舊版 App、系統不認得的格式）就照原本的路走。 */
  if (isRaw && isNative()) {
    const dev = await developRawWithEngine(file, extension, onPreview).catch(() => null);
    if (dev) return dev;
  }
  // 1. 先看瀏覽器能不能直接顯示這個檔
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
  
  // 2. 相機 RAW。
  //
  //    順序是刻意的：**先抽內嵌預覽當「先給你看」的那一張**（幾乎瞬間），
  //    再交給 LibRaw 做真正的去馬賽克。專業軟體開 RAW 也是這個順序 ——
  //    先讓你看到東西，全解碼在後面追上來。
  //
  //    為什麼真解碼值得等：內嵌的那張是相機沖好的 8-bit 成品，
  //    爆掉的亮部已經沒了、白平衡也定死了。LibRaw 是從感光元件的
  //    馬賽克資料重新算，所以亮部回復得回來、白平衡可以重新套。
  if (isRaw) {
      let previewUrl: string | null = null;
      try {
          previewUrl = await extractLargestJpegFromRaw(file, onPreview);
          // 抽到就先送出去墊著（呼叫端會先畫這張）
          if (previewUrl && onPreview) onPreview(previewUrl);
      } catch (err) {
          console.warn('RAW 內嵌預覽抽取失敗', err);
      }
      /* 真解碼有兩條路，依序試：
           ① iOS 原生（Core Image 的 CIRAWFilter）—— 系統內建、有硬體加速，
              但只有包成 App 而且 Xcode 專案裡加了那支外掛時才存在。
           ② LibRaw（WebAssembly）—— 兩邊都能跑，慢一些但到處都在。
         兩條都不行才退回內嵌預覽。 */
      try {
          const { decodeRawNative } = await import('./rawNative');
          const nativeOut = await decodeRawNative(file);
          if (nativeOut?.url) {
              if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch { /* 收過了 */ } }
              return nativeOut.url;
          }
      } catch (err) {
          console.warn('原生 RAW 解碼不可用，改用 LibRaw', err);
      }
      try {
          const { decodeRawToUrl } = await import('./rawDecode');
          const decoded = await decodeRawToUrl(file);
          if (decoded) {
              // 真解碼成功 → 墊檔那張可以收掉了
              if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch { /* 收過了 */ } }
              return decoded;
          }
      } catch (err) {
          console.warn('LibRaw 解碼失敗，改用內嵌預覽', err);
      }
      // 真解碼不行（很舊的機型、沒見過的壓縮方式…）→ 內嵌那張本來就夠好用
      if (previewUrl) return previewUrl;
  }

  // 3. HEIC 的話試 heic2any
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
  
  // 4. 最後手段：用 ImageMagick WASM 強制轉檔（TIFF、PSD，以及前面失敗的 HEIC／RAW 等）
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
    
    // 其他結構標準的檔案的最後備援
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
 * （它們自己 createObjectURL、自己丟進 <img>）。所以只有「編輯」「相機」
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
    const out = new File([blob], `${base}.jpg`, { type: blob.type || 'image/jpeg', lastModified: file.lastModified });
    /* RAW 引擎沖出來的是原生檔：記下路徑，下游（拼圖縮圖、原生縮小）可以直接讀原生檔，不必在網頁裡解整張 */
    if (isNative()) { const { nativePathOf, rememberNativeFile } = await import('./nativeBridge'); const np = nativePathOf(url); if (np) rememberNativeFile(out, np); }
    return out;
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
