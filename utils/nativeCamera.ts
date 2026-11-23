/* 原生相機（專業模式，對應 ios/App/App/NativeCameraPlugin.swift）。
 * 4800 萬像素、ProRAW、零快門延遲、相機控制按鈕。網頁版每一支都回 null。 */
import { nativePlugin, fileSrc } from './nativeBridge';
import { nativeImage } from './nativeImage';

export type CameraMenuItem =
  | { id: string; type: 'toggle'; title: string; symbol: string; value: boolean }
  | { id: string; type: 'choice'; title: string; symbol: string; value: string; options: { label: string; value: string }[] };

export interface NativeCameraApi {
  available(): Promise<{ available: boolean; proRAW: boolean; raw?: boolean }>;
  start(o: { position: 'back' | 'front'; x: number; y: number; w: number; h: number; radius?: number; lut?: string; amount?: number; proRAW?: boolean }): Promise<{ proRAW: boolean; raw?: boolean; turns?: number; minZoom?: number; maxZoom?: number; maxWidth: number; maxHeight: number; flash?: boolean; screenFlash?: boolean }>;
  stop(): Promise<void>;
  setRect(o: { x: number; y: number; w: number; h: number; radius?: number }): Promise<void>;
  capture(o: { flash: 'off' | 'on' | 'auto'; raw?: boolean; turns?: number }): Promise<{ path: string; width: number; height: number; rawPath?: string; location?: { lat: number; lon: number; alt?: number; time?: number } }>;
  /** 日期戳記（null＝不印），觀景窗右下角；zoom＝小框構圖的倍率（字印在框的右下角、照框的大小） */
  setDate(o: { date: string | null; zoom?: number }): Promise<void>;
  /** 觀景窗現在這一格（離開相機的過場用） */
  snapshot(): Promise<{ path: string }>;
  /** 水平儀：開著時送 level 事件 { roll（度）, flat } */
  setLevel(o: { on: boolean }): Promise<void>;
  /** 位置：開著時拍照會帶 location，寫進照片的 GPS */
  setLocation(o: { on: boolean }): Promise<{ authorized?: boolean; denied?: boolean }>;
  /** 原生設定選單（iOS 26 起是液態玻璃）。改了送 menu { id, value }，關掉送 menuClosed */
  showMenu(o: { anchor: { x: number; y: number; w: number; h: number }; items: CameraMenuItem[] }): Promise<void>;
  setZoom(o: { uiZoom?: number; factor?: number }): Promise<{ factor: number }>;
  focus(o: { x: number; y: number }): Promise<void>;
  setExposureBias(o: { ev: number }): Promise<void>;
  setWhiteBalance(o: { kelvin?: number; auto?: boolean }): Promise<void>;
  setFx(o: { soft: number; blur: number; lowfi: number }): Promise<void>;
  setLut(o: { lut: string; amount?: number }): Promise<void>;
  addListener(event: 'shutter' | 'zoom' | 'orientation' | 'level' | 'menu' | 'menuClosed', cb: (data: any) => void): Promise<{ remove: () => void }>;
}

export const nativeCamera = () => nativePlugin<NativeCameraApi>('NativeCamera');

/** './luts/f3.webp' → 'f3.webp'（原生端用 App 內建的同一份檔案）；原始＝'' */
export const lutFileName = (url: string | undefined | null) => (url ? url.split('/').pop()!.split('?')[0] : '');

/** 拍一張：原生全解析度拍照 → 原生端套濾鏡、裁成畫面比例（16 位元流程）→ 回傳網頁可用的網址 */
export async function captureNative(o: {
  flash: 'off' | 'on' | 'auto'; raw: boolean; lut: string; aspect: number; zoom: number;
  /** 手機怎麼拿（0 直、1 頂端朝左、3 頂端朝右）：橫拿拍出橫的照片 */
  turns?: number;
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
}): Promise<{ url: string; rawPath?: string; renderedPath?: string } | null> {
  const cam = await nativeCamera(), img = await nativeImage();
  if (!cam || !img) return null;
  const shot = await cam.capture({ flash: o.flash, raw: o.raw, turns: o.turns ?? 0 });
  const out = await img.render({
    path: shot.path, lut: o.lut || undefined, amount: o.amount ?? 1, aspect: o.aspect, zoom: o.zoom, fx: o.fx, kelvin: o.kelvin,
    develop: o.develop || undefined, date: o.date || undefined, gps: shot.location || undefined,
    format: 'jpeg', quality: 0.95,
  });
  img.remove({ path: shot.path }).catch(() => {});
  const blob = await (await fetch(fileSrc(out.path))).blob();
  /* 有 RAW 時成品檔先留著：要跟 RAW 配成同一張存進相簿（存完再刪，見 saveRawPair） */
  if (!shot.rawPath) img.remove({ path: out.path }).catch(() => {});
  return { url: URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })), rawPath: shot.rawPath, renderedPath: shot.rawPath ? out.path : undefined };
}

/** 底片模式（RAW）拍的時候少曝光幾格：保護亮部（RAW 的暗部之後拉得回來，爆掉的亮部救不回來）。
 *  所以觀景窗看起來暗暗的 —— 存下來的成品照片、重新沖洗的預設值都會沖回這麼多格 */
export const RAW_PROTECT_EV = 1;

export interface RawDevelop {
  /** 曝光（EV）；色溫（K）、色調：不給＝拍攝當下的白平衡 */
  exposure: number; temperature?: number; tint?: number;
}

/** 拍照當下的「樣子」：重新沖洗時照樣套上（濾鏡、特效、裁切、日期），沖出來跟相機拍的一致 */
export interface RawLook {
  lut: string; amount: number; aspect: number; zoom: number;
  fx?: { soft: number; blur: number; lowfi: number };
  date?: string | null;
}

/** 相機拍的 RAW（DNG 檔路徑）→ 沖成一張圖：iOS 內建的 RAW 解碼（從感光元件的原始資料算，亮部、暗部留得比一般照片多），
 *  再套上拍照當下的濾鏡、特效、裁切、日期（跟拍照同一支原生程式）。
 *  preview：沖洗時的即時預覽（長邊 1400、快速模式）。回傳網址與拍攝當下的白平衡；沒有原生解碼或失敗回 null */
export async function developRaw(rawPath: string, dev: RawDevelop = { exposure: 0 }, look: RawLook | null = null, preview = false):
  Promise<{ url: string; asShotTemperature?: number; asShotTint?: number } | null> {
  const dec = await nativePlugin<{ decodeFile(o: Record<string, unknown>): Promise<{ path: string; asShotTemperature?: number; asShotTint?: number }> }>('RawDecode');
  const img = await nativeImage();
  if (!dec || !img) return null;
  let decoded = '', rendered = '';
  try {
    const r = await dec.decodeFile({
      path: rawPath, exposure: dev.exposure, temperature: dev.temperature, tint: dev.tint,
      maxPixel: preview ? 1400 : 0, draft: preview,
    });
    decoded = r.path;
    let out = r.path;
    if (look) {
      const o = await img.render({
        path: r.path, lut: look.lut || undefined, amount: look.amount, aspect: look.aspect, zoom: look.zoom,
        fx: look.fx, date: look.date || undefined, format: 'jpeg', quality: preview ? 0.85 : 0.95,
      });
      rendered = o.path; out = o.path;
    }
    const blob = await (await fetch(fileSrc(out))).blob();
    return { url: URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })), asShotTemperature: r.asShotTemperature, asShotTint: r.asShotTint };
  } catch { return null; }
  finally {
    for (const p of [decoded, rendered]) if (p) img.remove({ path: p }).catch(() => {});
  }
}
