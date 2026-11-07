/* 解碼後照片的共用記憶體預算。
 *
 * 各個照片快取在這裡登記「目前佔多少」和「能不能放掉一張閒置的」。總量超過預算時，
 * 從最久沒用到的閒置照片開始放掉，直到回到預算內。
 *   ‧ 閒置＝畫面上已經不用這一份（例如放大看完又縮回去，畫面已換回小副本），放掉看不出差別；
 *   ‧ 畫面正在用、或存檔要用的照片不在這裡放，記憶體真的吃緊時交給 memoryPressure 處理。 */

export interface BudgetHolder {
  /** 目前佔用的位元組（解碼後的大小，寬×高×4） */
  bytes(): number;
  /** 最久沒用的閒置項目從什麼時候開始閒置；沒有可放的回傳 Infinity */
  oldestIdle(): number;
  /** 放掉最久沒用的那一個閒置項目；沒有可放的回傳 false */
  evictIdle(): boolean;
}

/** iPhone 上網頁的記憶體上限比桌機低很多，照片快取預設 256MB（約五張 1200 萬像素的原圖）。
 *  包成 App 時改成照系統實際給的空間調整（見 utils/nativeImage 的 watchNativeMemoryBudget）。 */
export const IMAGE_BUDGET = 256 * 1024 * 1024;
let budget = IMAGE_BUDGET;
export const imageBudget = () => budget;
export function setImageBudget(bytes: number) {
  const tighter = bytes < budget;
  budget = bytes;
  if (tighter) scheduleBudgetCheck();
}

const holders = new Map<string, BudgetHolder>();
let queued = false;

export function registerBudget(name: string, h: BudgetHolder): () => void {
  holders.set(name, h);
  return () => { if (holders.get(name) === h) holders.delete(name); };
}

export function budgetUsed(): number {
  let total = 0;
  for (const h of holders.values()) { try { total += h.bytes(); } catch { /* 單一項出錯不影響總計 */ } }
  return total;
}

/** 超過預算就放掉閒置的照片。回傳放掉了幾張 */
export function enforceBudget(limit = budget): number {
  let freed = 0;
  for (let guard = 0; guard < 200 && budgetUsed() > limit; guard++) {
    let pick: BudgetHolder | null = null, at = Infinity;
    for (const h of holders.values()) { const t = h.oldestIdle(); if (t < at) { at = t; pick = h; } }
    if (!pick || !pick.evictIdle()) break;
    freed++;
  }
  return freed;
}

/** 快取有變動時呼叫：同一輪裡多次變動只檢查一次 */
export function scheduleBudgetCheck() {
  if (queued) return;
  queued = true;
  setTimeout(() => { queued = false; enforceBudget(); }, 0);
}
