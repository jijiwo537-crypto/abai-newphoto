import { Capacitor, registerPlugin } from '@capacitor/core';
const encoder = registerPlugin<{ encode(options: { png: string }): Promise<{ base64: string }> }>('HeicExport');
export const canExportHeic = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('HeicExport');
export async function exportHeic(canvas: HTMLCanvasElement): Promise<string> {
  if (!canExportHeic()) throw new Error('HEIC encoder is not installed');
  /* 優先：畫布像素直接分塊交給原生、原生編 HEIC（跟編輯器同一條路）。
     舊的做法是整張先壓成 PNG、再變成一大串 base64 一次傳過去 —— 2000 萬像素的拼圖要好幾百 MB 記憶體。
     有透明、或原生那條不通就照舊 */
  const native = await heicViaPixels(canvas).catch(() => null);
  if (native) return native;
  const { base64 } = await encoder.encode({ png: canvas.toDataURL('image/png').split(',')[1] });
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') throw new Error('Invalid HEIC output');
  return URL.createObjectURL(new Blob([bytes], { type: 'image/heic' }));
}

/** 從已經編好的圖片網址（例如原尺寸分段做出來的 PNG）轉 HEIC：不需要一整張畫布 */
export async function exportHeicFromUrl(url: string): Promise<string> {
  if (!canExportHeic()) throw new Error('HEIC encoder is not installed');
  const blob = await (await fetch(url)).blob();
  /* 優先：分塊寫成原生暫存檔、原生直接讀檔編碼（記憶體固定在幾 MB）。
     舊的做法是整張 PNG 轉成一大串 base64 一次傳過去：大照片（幾十 MB 的 PNG）要好幾百 MB 記憶體，
     iPhone 會直接把 App 關掉（白屏後重啟） */
  try {
    const { nativeImage, blobToNativeFile } = await import('./nativeImage');
    const { fileSrc } = await import('./nativeBridge');
    const api = await nativeImage();
    if (api) {
      let inPath = '', outPath = '';
      try {
        inPath = await blobToNativeFile(blob, 'png');
        outPath = (await api.encode({ path: inPath, format: 'heic', quality: 0.97 })).path;
        const out = await (await fetch(fileSrc(outPath))).blob();
        if (out.size) return URL.createObjectURL(new Blob([out], { type: 'image/heic' }));
      } finally {
        if (inPath) api.remove({ path: inPath }).catch(() => {});
        if (outPath) api.remove({ path: outPath }).catch(() => {});
      }
    }
  } catch { /* 原生那條不行才走下面的舊做法（小圖） */ }
  if (blob.size > 24 * 1024 * 1024) throw new Error('HEIC 編碼失敗（檔案太大）');
  const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const { base64 } = await encoder.encode({ png: b64 });
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') throw new Error('Invalid HEIC output');
  return URL.createObjectURL(new Blob([bytes], { type: 'image/heic' }));
}

/** 畫布 → 原始像素（保留畫布本身的色彩空間：廣色域畫布照 Display P3 交過去，不轉色）→ 原生編 HEIC。做不到回 null */
async function heicViaPixels(canvas: HTMLCanvasElement): Promise<string | null> {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx || !w || !h) return null;
  const p3 = (ctx.getContextAttributes?.() as any)?.colorSpace === 'display-p3';
  const { nativeImage, pixelsToNativeFile } = await import('./nativeImage');
  const { fileSrc } = await import('./nativeBridge');
  const api = await nativeImage();
  if (!api) return null;
  let inPath: string | null = null, outPath = '';
  try {
    inPath = await pixelsToNativeFile(ctx.getImageData(0, 0, w, h).data, w, h, p3);
    if (!inPath) return null;
    outPath = (await api.encode({ path: inPath, format: 'heic', quality: 0.97 })).path;
    const out = await (await fetch(fileSrc(outPath))).blob();
    const head = new Uint8Array(await out.slice(4, 8).arrayBuffer());
    if (!out.size || String.fromCharCode(...head) !== 'ftyp') return null;
    return URL.createObjectURL(new Blob([out], { type: 'image/heic' }));
  } finally {
    if (inPath) api.remove({ path: inPath }).catch(() => {});
    if (outPath) api.remove({ path: outPath }).catch(() => {});
  }
}
