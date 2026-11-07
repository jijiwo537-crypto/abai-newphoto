/* 記憶體壓力：各處登記「可以丟掉、之後再重建」的快取，記憶體吃緊時一起放掉。
 *
 * 專業 App 的做法：系統說記憶體快不夠時（iOS 的 didReceiveMemoryWarning），先自己把快取清掉，
 * 而不是等系統直接把整個 App 收掉。
 *   ‧ App 版：原生外掛 MemoryPressure（ios/App/App/MemoryPressurePlugin.swift）收到系統警告就通知這裡；
 *   ‧ 網頁版：瀏覽器沒有這個通知，改成「切到背景時」清一次（iOS 最常在背景時把網頁收掉）。
 * 登記的清理一定要是「清了之後畫面照樣正確、只是之後要重算／重讀」的東西。 */
import { isNative } from './native';

export type TrimLevel = 'background' | 'critical';
type Trim = (level: TrimLevel) => void;
const trims = new Map<string, Trim>();

/** 登記一項清理；回傳取消登記的函式（元件卸載時呼叫） */
export function registerTrim(name: string, fn: Trim): () => void {
  trims.set(name, fn);
  return () => { if (trims.get(name) === fn) trims.delete(name); };
}

/** 現在就清（每一項各自包起來：其中一項出錯不影響其他項） */
export function trimMemory(level: TrimLevel) {
  for (const [name, fn] of trims) {
    try { fn(level); } catch (e) { console.warn('trim failed', name, e); }
  }
}

/** App 版：接上系統的記憶體警告。網頁版什麼都不做。回傳停止監聽的函式 */
export function watchMemoryPressure(): () => void {
  if (!isNative()) return () => {};
  let off: (() => void) | null = null, dead = false;
  void (async () => {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin<{ addListener: (e: string, cb: () => void) => Promise<{ remove: () => void }> }>('MemoryPressure');
      const h = await plugin.addListener('memoryWarning', () => trimMemory('critical'));
      if (dead) h.remove(); else off = () => h.remove();
    } catch { /* 沒有這支外掛（舊版 App）：就當沒有這回事 */ }
  })();
  return () => { dead = true; off?.(); };
}
