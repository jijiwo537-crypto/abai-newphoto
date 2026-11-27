/* 穩定性紀錄的網頁端（原生：ios/App/App/StabilityPlugin.swift）。網頁版什麼都不做。
 * ‧ 啟動時打招呼：網頁程序被 iOS 關掉、自己重新載入時，原生那邊就知道發生過一次
 * ‧ 每 5 秒回報一次「現在在哪個工具」（只放在原生的記憶體裡，不寫檔）
 * ‧ 程式錯誤記下來（一次開啟最多 20 筆，不洗版） */
import { nativePlugin } from './nativeBridge';
import { isNative } from './native';

interface StabilityApi {
  hello(): Promise<{ reloads: number }>;
  beat(o: { where: string; extra?: string }): Promise<{ availableMB: number }>;
  log(o: { msg: string }): Promise<void>;
  copyReport(): Promise<{ ok: boolean }>;
}
const api = () => nativePlugin<StabilityApi>('Stability');
let started = false;

export function startStability(where: () => string) {
  if (started || !isNative()) return;
  started = true;
  void api().then(p => {
    if (!p) return;
    p.hello().catch(() => {});
    window.setInterval(() => { p.beat({ where: where() }).catch(() => {}); }, 5000);
    let n = 0;
    const log = (msg: string) => { if (n++ < 20) p.log({ msg }).catch(() => {}); };
    window.addEventListener('error', e => log(`網頁錯誤：${e.message} @ ${(e.filename || '').replace(/^.*\//, '')}:${e.lineno}（${where()}）`));
    window.addEventListener('unhandledrejection', e => log(`網頁錯誤：${String((e.reason && (e.reason.message || e.reason)) || e.reason).slice(0, 300)}（${where()}）`));
  }).catch(() => {});
}

/** 記一筆（例如存檔失敗）；網頁版不做事 */
export function stabilityLog(msg: string) {
  if (!isNative()) return;
  void api().then(p => p?.log({ msg }).catch(() => {})).catch(() => {});
}

/** 複製整份紀錄到剪貼簿（原生端直接寫，不靠網頁的剪貼簿權限）。回傳是否成功 */
export async function copyStabilityReport(): Promise<boolean> {
  try { const p = await api(); if (!p) return false; return !!(await p.copyReport()).ok; } catch { return false; }
}
