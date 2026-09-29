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
