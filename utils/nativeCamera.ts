/* 原生相機（專業模式，對應 ios/App/App/NativeCameraPlugin.swift）。
 * 4800 萬像素、ProRAW、零快門延遲、相機控制按鈕。網頁版每一支都回 null。 */
import { nativePlugin, fileSrc } from './nativeBridge';
import { nativeImage } from './nativeImage';

export interface NativeCameraApi {
  available(): Promise<{ available: boolean; proRAW: boolean; raw?: boolean }>;
  start(o: { position: 'back' | 'front'; x: number; y: number; w: number; h: number; radius?: number; lut?: string; amount?: number; proRAW?: boolean }): Promise<{ proRAW: boolean; raw?: boolean; maxWidth: number; maxHeight: number; flash?: boolean; screenFlash?: boolean }>;
  stop(): Promise<void>;
  setRect(o: { x: number; y: number; w: number; h: number; radius?: number }): Promise<void>;
  capture(o: { flash: 'off' | 'on' | 'auto'; raw?: boolean }): Promise<{ path: string; width: number; height: number; rawPath?: string }>;
  /** 日期戳記（null＝不印），觀景窗右下角 */
  setDate(o: { date: string | null }): Promise<void>;
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
  /** 濾鏡強度 0～1（每顆濾鏡的最大強度，跟編輯頁一致） */
  amount?: number;
  /** 相機特效（0～1），拍出來的照片跟觀景窗看到的一樣 */
  fx?: { soft: number; blur: number; lowfi: number };
  /** 色溫（跟觀景窗一樣的公式），拍出來的照片跟看到的一樣 */
  kelvin?: number;
  /** 底片模式（RAW）：拍的時候少曝光了幾格保護亮部，成品照片沖回這麼多格（亮部柔收） */
  develop?: number;
  /** 日期戳記的字 */
  date?: string | null;
}): Promise<{ url: string; rawPath?: string } | null> {
  const cam = await nativeCamera(), img = await nativeImage();
  if (!cam || !img) return null;
  const shot = await cam.capture({ flash: o.flash, raw: o.raw });
  const out = await img.render({
    path: shot.path, lut: o.lut || undefined, amount: o.amount ?? 1, aspect: o.aspect, zoom: o.zoom, fx: o.fx, kelvin: o.kelvin,
    develop: o.develop || undefined, date: o.date || undefined,
    format: 'jpeg', quality: 0.95,
  });
  img.remove({ path: shot.path }).catch(() => {});
  const blob = await (await fetch(fileSrc(out.path))).blob();
  img.remove({ path: out.path }).catch(() => {});
  return { url: URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })), rawPath: shot.rawPath };
}

/** 底片模式（RAW）拍的時候少曝光幾格：保護亮部（RAW 的暗部之後拉得回來，爆掉的亮部救不回來）。
 *  所以觀景窗看起來暗暗的 —— 存下來的成品照片、重新沖洗的預設值都會沖回這麼多格 */
export const RAW_PROTECT_EV = 1;

export interface RawDevelop {
  /** 曝光（EV）；色溫（K）、色調：不給＝拍攝當下的白平衡 */
  exposure: number; temperature?: number; tint?: number;
}

/** 相機拍的 RAW（DNG 檔路徑）→ 沖成一張圖（iOS 內建的 RAW 解碼，從感光元件的原始資料算，
 *  亮部、暗部留得比一般照片多）。preview：沖洗時的即時預覽（長邊 1400、快速模式）。
 *  回傳網址與拍攝當下的白平衡；沒有原生解碼或失敗回 null */
export async function developRaw(rawPath: string, dev: RawDevelop = { exposure: 0 }, preview = false):
  Promise<{ url: string; asShotTemperature?: number; asShotTint?: number } | null> {
  const dec = await nativePlugin<{ decodeFile(o: Record<string, unknown>): Promise<{ path: string; asShotTemperature?: number; asShotTint?: number }> }>('RawDecode');
  const img = await nativeImage();
  if (!dec) return null;
  try {
    const r = await dec.decodeFile({
      path: rawPath, exposure: dev.exposure, temperature: dev.temperature, tint: dev.tint,
      maxPixel: preview ? 1400 : 0, draft: preview,
    });
    const blob = await (await fetch(fileSrc(r.path))).blob();
    img?.remove({ path: r.path }).catch(() => {});
    return { url: URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })), asShotTemperature: r.asShotTemperature, asShotTint: r.asShotTint };
  } catch { return null; }
}
