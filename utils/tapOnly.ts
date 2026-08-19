/* ── 按鈕只認「點一下」，不認「按著不放」 ──────────────────────────────
 *
 * 網頁的預設行為是：按下去、放開，不管中間隔了多久都算一次 click。
 * 所以手指壓在按鈕上想事情、或是壓著等畫面反應，最後把手拿開的那一刻
 * 功能還是會被觸發 —— 使用者的感覺是「我又沒有要按它」。
 *
 * 這裡把「按太久才放開」的那一次 click 攔下來：
 *   ‧ 按下去到放開 ≦ 600ms → 正常的點一下，原封不動放行
 *   ‧ 超過 600ms          → 當作「按著不放」，這一次 click 不算數
 *
 * 幾件刻意留著不管的事：
 *   ‧ 只管 <button>／<a>／role="button" 這種真的是按鈕的東西。
 *     畫布、觀景窗那些用 onClick 接手勢的地方完全不受影響
 *     （相機長按 550ms 鎖 AE/AF 就是靠那條路，不能被攔掉）。
 *   ‧ 程式自己送的 click（isTrusted 是 false）一律放行 ——
 *     滑桿把點擊轉交給底下按鈕、以及各處 el.click() 觸發的檔案選擇都走這條。
 *   ‧ 鍵盤按 Enter／空白鍵送出的 click 沒有對應的按壓，也一律放行。
 *
 * 放開之後如果手指已經移到別的元素上，瀏覽器本來就會把 click 派給兩者的
 * 共同祖先（也就是誰都不會被按到），那一段不用我們處理。
 */

/** 按多久以內才算「點一下」 */
const MAX_TAP_MS = 600;
/** click 必須緊接在放開之後；隔太久的就不是同一次操作（鍵盤那種） */
const PAIR_WINDOW_MS = 400;

/** 這個 click 是不是打在「按鈕」上 */
const isButtonish = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
};

let installed = false;

export const installTapOnly = () => {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  let downId = -1;
  let downAt = 0;
  /** 上一次放開時「按了多久」；-1 代表沒有可以配對的按壓 */
  let heldMs = -1;
  let upAt = 0;

  document.addEventListener('pointerdown', (e: PointerEvent) => {
    // 滑鼠只管主鍵；右鍵、中鍵本來就不會產生 click
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    downId = e.pointerId;
    downAt = e.timeStamp;
    heldMs = -1;
  }, true);

  document.addEventListener('pointerup', (e: PointerEvent) => {
    if (e.pointerId !== downId) return;
    heldMs = e.timeStamp - downAt;
    upAt = e.timeStamp;
    downId = -1;
  }, true);

  // 被瀏覽器收去捲動之類的，這一次按壓就當作沒發生過
  document.addEventListener('pointercancel', (e: PointerEvent) => {
    if (e.pointerId !== downId) return;
    downId = -1;
    heldMs = -1;
  }, true);

  document.addEventListener('click', (e: MouseEvent) => {
    const held = heldMs;
    const paired = e.timeStamp - upAt;
    heldMs = -1;                       // 一次按壓只配對一次 click
    if (!e.isTrusted) return;          // 程式自己送的
    if (held < 0) return;              // 沒有對應的按壓（鍵盤、程式呼叫 .click()）
    if (paired > PAIR_WINDOW_MS) return;
    if (held <= MAX_TAP_MS) return;    // 正常的點一下
    if (!isButtonish(e.target)) return;
    /* 到這裡＝「按著不放」很久才鬆手。在 document 的捕獲階段就攔下來，
       事件根本不會往下走到 React 掛在 #root 的那顆監聽器上。 */
    e.stopPropagation();
    e.preventDefault();
  }, true);
};
