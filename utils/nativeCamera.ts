/* 原生相機（專業模式，對應 ios/App/App/NativeCameraPlugin.swift）。
 * 4800 萬像素、ProRAW、零快門延遲、相機控制按鈕。網頁版每一支都回 null。 */
import { nativePlugin, fileSrc } from './nativeBridge';
import { nativeImage } from './nativeImage';

export interface NativeCameraApi {
  available(): Promise<{ available: boolean; proRAW: boolean }>;
  start(o: { position: 'back' | 'front'; x: number; y: number; w: number; h: number; lut?: string; amount?: number; proRAW?: boolean }): Promise<{ proRAW: boolean; maxWidth: number; maxHeight: number; flash?: boolean; screenFlash?: boolean }>;
  stop(): Promise<void>;
  setRect(o: { x: number; y: number; w: number; h: number }): Promise<void>;
  capture(o: { flash: 'off' | 'on' | 'auto'; raw?: boolean }): Promise<{ path: string; width: number; height: number; rawPath?: string }>;
  setZoom(o: { uiZoom?: number; factor?: number }): Promise<{ factor: number }>;
  focus(o: { x: number; y: number }): Promise<void>;
  setExposureBias(o: { ev: number }): Promise<void>;
  setWhiteBalance(o: { kelvin?: number; auto?: boolean }): Promise<void>;
  setFx(o: { soft: number; blur: number; lowfi: number }): Promise<void>;
  setLut(o: { lut: string; amount?: number }): Promise<void>;
  addListener(event: 'shutter' | 'zoom', cb: (data: any) => void): Promise<{ remove: () => void }>;
}

export const nativeCamera = () => nativePlugin<NativeCameraApi>('NativeCamera');

/** './luts/f3.webp' → 'f3.webp'（原生端用 App 內建的同一份檔案）；原始＝'' */
export const lutFileName = (url: string | undefined | null) => (url ? url.split('/').pop()!.split('?')[0] : '');

/** 拍一張：原生全解析度拍照 → 原生端套濾鏡、裁成畫面比例（16 位元流程）→ 回傳網頁可用的網址 */
export async function captureNative(o: {
  flash: 'off' | 'on' | 'auto'; raw: boolean; lut: string; aspect: number; zoom: number;
  /** 相機特效（0～1），拍出來的照片跟觀景窗看到的一樣 */
  fx?: { soft: number; blur: number; lowfi: number };
}): Promise<{ url: string; rawPath?: string } | null> {
  const cam = await nativeCamera(), img = await nativeImage();
  if (!cam || !img) return null;
  const shot = await cam.capture({ flash: o.flash, raw: o.raw });
  const out = await img.render({ path: shot.path, lut: o.lut || undefined, amount: 1, aspect: o.aspect, zoom: o.zoom, fx: o.fx, format: 'jpeg', quality: 0.95 });
  img.remove({ path: shot.path }).catch(() => {});
  const blob = await (await fetch(fileSrc(out.path))).blob();
  img.remove({ path: out.path }).catch(() => {});
  return { url: URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })), rawPath: shot.rawPath };
}
