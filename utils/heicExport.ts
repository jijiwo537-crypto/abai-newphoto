import { Capacitor, registerPlugin } from '@capacitor/core';
const encoder = registerPlugin<{ encode(options: { png: string }): Promise<{ base64: string }> }>('HeicExport');
export const canExportHeic = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('HeicExport');
export async function exportHeic(canvas: HTMLCanvasElement): Promise<string> {
  if (!canExportHeic()) throw new Error('HEIC encoder is not installed');
  const { base64 } = await encoder.encode({ png: canvas.toDataURL('image/png').split(',')[1] });
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') throw new Error('Invalid HEIC output');
  return URL.createObjectURL(new Blob([bytes], { type: 'image/heic' }));
}

/** 從已經編好的圖片網址（例如原尺寸分段做出來的 PNG）轉 HEIC：不需要一整張畫布 */
export async function exportHeicFromUrl(url: string): Promise<string> {
  if (!canExportHeic()) throw new Error('HEIC encoder is not installed');
  const blob = await (await fetch(url)).blob();
  const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const { base64 } = await encoder.encode({ png: b64 });
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') throw new Error('Invalid HEIC output');
  return URL.createObjectURL(new Blob([bytes], { type: 'image/heic' }));
}
