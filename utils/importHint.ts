/** 導入中的轉圈要顯示什麼字：單張 RAW 要先解析一段時間，顯示「正在解析 RAW」而不是一般的「匯入中」 */
import { useSyncExternalStore } from 'react';

let rawHint = false;
const subs = new Set<() => void>();
export function setRawImportHint(on: boolean) {
  if (rawHint === on) return;
  rawHint = on;
  subs.forEach(f => f());
}
export function useRawImportHint() {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => rawHint);
}
