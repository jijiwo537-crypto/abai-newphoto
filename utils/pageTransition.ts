import { flushSync } from 'react-dom';

/* ── 返回的過場：目前的畫面往右滑走，露出底下的畫面 ──────────────────────
 *
 * 用瀏覽器的 View Transitions：先把「現在的畫面」拍成一張快照，畫面換成目標（同一格就換好），
 * 再讓快照往右滑出去；底下的新畫面從左邊一點點（-28%、稍暗）跟著滑回原位 —— 跟 iOS 的返回一樣的手感。
 * 動的是快照，不是真的編輯器：再重的畫面（大圖、WebGL、上百個物件）滑起來都是順的。
 *
 * 規矩：要換畫面的那些 setState 全部放進 update 裡（包含收尾的清理），
 * 不能有一部分先在外面改 —— 先改的話，快照拍到的就已經是換到一半的畫面。
 *
 * 不支援的系統（iOS 18 以前）或使用者開了「減少動態效果」：直接換，不播動畫。 */

const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

let running: Promise<void> | null = null;

export function slideBack(update: () => void): Promise<void> {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void> } };
  if (!doc.startViewTransition || reduceMotion()) { update(); return Promise.resolve(); }
  const root = document.documentElement;
  root.dataset.vt = 'back';
  let ran = false;
  const t = doc.startViewTransition(() => { ran = true; flushSync(update); });
  const done = t.finished.catch(() => {}).finally(() => {
    // 被下一個過場打斷時 update 可能沒跑到：補跑，畫面一定會換過去
    if (!ran) update();
    if (running === done) { delete root.dataset.vt; running = null; }
  });
  running = done;
  return done;
}

/* ── 進相機：相機整頁從下方升上來，主頁留在原地、稍微變暗 ──
 * 一樣用 View Transitions（動的是快照）。升起的過程中相機的原生畫面還沒挖空露出來（見 transitionDone），
 * 觀景窗是黑的；升到定位、過場結束才露出鏡頭畫面 —— 停好之後跟直接打開相機完全一樣。 */
export const viewTransitionsSupported = () => {
  const doc = document as Document & { startViewTransition?: unknown };
  return !!doc.startViewTransition && !reduceMotion();
};
export function slideUp(update: () => void): Promise<void> {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void> } };
  if (!doc.startViewTransition || reduceMotion()) { update(); return Promise.resolve(); }
  const root = document.documentElement;
  root.dataset.vt = 'up';
  let ran = false;
  const t = doc.startViewTransition(() => { ran = true; flushSync(update); });
  const done = t.finished.catch(() => {}).finally(() => {
    if (!ran) update();
    if (running === done) { delete root.dataset.vt; running = null; }
  });
  running = done;
  return done;
}
/** 現在的換頁過場播完（沒有過場就立刻） */
export const transitionDone = (): Promise<void> => running ?? Promise.resolve();
