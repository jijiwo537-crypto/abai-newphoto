/* 幀預算：滑桿手感跟畫面計算脫鉤。
 * iPhone 上滑桿白點、手指事件和畫面計算都在同一條主執行緒。畫面計算如果每一幀都把它佔滿，白點就跟不上手（「滑起來只有 30 幀」）。
 * 規則：一次畫面計算花了 d 毫秒，接下來至少空出 d 毫秒不再做下一次 —— 主執行緒至少一半時間是空的，
 * 手指事件、白點一定即時處理；畫面計算跟不上時自動跳過中間的值，只畫最新的那一個（結果不變，只是少畫幾格中間值）。 */
let busyUntil = 0;
/** 現在可以做下一次畫面計算了嗎 */
export const frameBudgetOk = () => performance.now() >= busyUntil;
/** 做一次畫面計算並記下花了多久 */
export function runMeasured(fn: () => void) {
  const t0 = performance.now();
  try { fn(); } finally {
    const t1 = performance.now(), d = t1 - t0;
    noteWork(d);
    // 很便宜的（< 4ms）不必讓：一幀 8ms 裡本來就留得下手指的時間
    busyUntil = d >= 4 ? t1 + d : 0;
  }
}
/** 下一幀做 fn（預算不夠就再等一幀）。回傳取消函式 */
export function budgetedFrame(fn: () => void): () => void {
  let id = 0, dead = false;
  const tick = () => { if (dead) return; if (!frameBudgetOk()) { id = requestAnimationFrame(tick); return; } runMeasured(fn); };
  id = requestAnimationFrame(tick);
  return () => { dead = true; cancelAnimationFrame(id); };
}

/* ── 滑桿卡頓偵測（偵錯紀錄用） ─────────────────────────────
 * 拖滑桿期間每一幀量一次間隔；放手時記一筆：拖了多久、幾幀、最長一幀、超過 20ms（掉到 50 幀以下）的有幾幀、
 * 畫面計算（runMeasured）平均／最長花多久。卡在哪裡一看就知道：最長一幀很長但畫面計算很短＝別的東西佔住主執行緒。 */
let workSum = 0, workN = 0, workMax = 0;
export function startJankProbe(label: string, log: (tag: string, msg: string) => void): () => void {
  const t0 = performance.now(); let last = t0, frames = 0, slow = 0, worst = 0, raf = 0, alive = true;
  workSum = 0; workN = 0; workMax = 0;
  const tick = (t: number) => { if (!alive) return; const d = t - last; last = t; if (frames++ > 0) { if (d > worst) worst = d; if (d > 20) slow++; } raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  return () => {
    if (!alive) return; alive = false; cancelAnimationFrame(raf);
    const dur = performance.now() - t0; if (dur < 120) return;
    log('滑桿', `${label}：拖 ${Math.round(dur)}ms、${frames} 幀（約 ${Math.round(frames * 1000 / dur)}fps）、最長一幀 ${Math.round(worst)}ms、慢幀(>20ms) ${slow}、畫面計算 ${workN} 次 平均 ${workN ? (workSum / workN).toFixed(1) : 0}ms 最長 ${workMax.toFixed(1)}ms`);
  };
}
export function noteWork(d: number) { workSum += d; workN++; if (d > workMax) workMax = d; }
