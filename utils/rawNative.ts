/**
 * iOS 原生的 RAW 解碼（Core Image 的 CIRAWFilter）。
 *
 * 為什麼要有這一條
 * ─────────────────────────────────────────────────────────────
 * LibRaw（WASM）兩邊都能跑，但它是編譯成 WebAssembly 的 C 程式碼，
 * 一張 24MP 的 RAW 實測要 4.3 秒（桌機），手機上還要再乘幾倍。
 * iOS 系統本身就內建一套 RAW 解碼 —— 「照片」App 打開 RAW 用的就是它，
 * Apple 自己維護各家相機的支援、跑在原生程式碼上、還吃得到硬體加速。
 * 能用的時候當然用它。
 *
 * 這一支的規矩
 * ─────────────────────────────────────────────────────────────
 * ① **網頁版完全不受影響**：isNative() 一開始就擋掉，一個外掛都不會載。
 * ② **外掛不存在也不會壞**：Xcode 專案裡還沒加那個 Swift 檔之前，
 *    這裡會安靜地回 null，呼叫端自動走 LibRaw。所以這個檔案可以先進版控，
 *    等原生那邊補上就自動生效，中間沒有任何一刻是壞的。
 * ③ 失敗一律回 null，不丟例外 —— 解碼失敗不該讓匯入整個中斷。
 *
 * ⚠ 老實說：Swift 那一段我沒有辦法在這裡編譯或執行（沒有 Xcode），
 *   所以原生路徑是「照 Apple 文件寫好、但尚未在真機驗證」的狀態。
 *   在真機上跑起來之前，實際生效的一直是 LibRaw 那條（那條有測過）。
 */

import { isNative } from './native';

/** 對應 ios/App/App/RawDecodePlugin.swift 裡的 jsName */
const PLUGIN_NAME = 'RawDecode';

export interface NativeRawResult {
  /** 解好的影像，data:image/jpeg;base64,… */
  url: string;
  width: number;
  height: number;
}

let pluginProbe: any | undefined;

/** 拿外掛（沒有就回 null）。只探一次，結果記起來。 */
async function getPlugin(): Promise<any | null> {
  if (pluginProbe !== undefined) return pluginProbe;
  pluginProbe = null;
  if (!isNative()) return null;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const p: any = registerPlugin(PLUGIN_NAME);
    /* registerPlugin 對「根本沒實作」的外掛也會給你一個物件，
       所以要真的呼叫一次才知道在不在。用 available() 這支很便宜的探針。 */
    const ok = await p.available();
    pluginProbe = ok?.available ? p : null;
  } catch {
    pluginProbe = null;
  }
  return pluginProbe;
}

/** 這台裝置能不能走原生解碼 */
export async function nativeRawAvailable(): Promise<boolean> {
  return !!(await getPlugin());
}

/** File → base64（不含前綴）。大檔案要用分段，避免爆掉呼叫堆疊。 */
async function toBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = '';
  const CH = 0x8000;                 // 一次 32K，超過會踩到參數數量上限
  for (let i = 0; i < buf.length; i += CH) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + CH) as unknown as number[]);
  }
  return btoa(s);
}

/**
 * 用 iOS 原生解一個 RAW 檔。
 * @returns 解好的結果；不是原生環境、外掛沒裝、或解不出來都回 null
 */
export async function decodeRawNative(file: File): Promise<NativeRawResult | null> {
  const p = await getPlugin();
  if (!p) return null;
  try {
    const data = await toBase64(file);
    const r = await p.decode({ data, name: file.name });
    if (!r?.jpeg) return null;
    return {
      url: `data:image/jpeg;base64,${r.jpeg}`,
      width: r.width || 0,
      height: r.height || 0,
    };
  } catch {
    return null;
  }
}
