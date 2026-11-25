import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * 匯出中／存相簿時蓋住整個畫面的那一層（轉圈、文字、百分比、取消鍵）。
 *
 * 一定要掛在 App 的最外層，不能留在工具的版面裡：工具的最外層有 transform，
 * 「position: fixed」碰到有 transform 的祖先就改成以那個祖先為準，而那個祖先在 iPhone 上的大小、
 * 位置跟螢幕不一樣 —— 轉圈就會偏，而且每台裝置偏得不一樣。
 * 位置：剛好蓋滿整個螢幕，轉圈在螢幕正中央；百分比、文字、取消鍵掛在它下方。
 *
 * 「匯出中」之後還有一層「等成品頁準備好／存相簿」（SaveButton）。那是另一個元素，
 * 為了看起來是**同一段**轉圈，這裡做兩件事：
 *   ① 每一層的轉圈都對齊同一個時鐘（動畫從時間軸 0 起算）：換手時角度連續，不會從頭轉、跳一格。
 *   ② 每一層畫完都記下自己當下的內容；接手的那一層（continueLast）照原樣顯示同樣的字、百分比、按鈕。
 *      接手那一層上的按鈕只是樣子一樣，按了沒有作用（那時已經在收尾，不能取消）。
 */
let last: { html: string; className: string; at: number } | null = null;

const alignSpinners = (root: HTMLElement) => {
  root.querySelectorAll('.animate-spin, .animate-pulse').forEach(el =>
    (el as HTMLElement).getAnimations?.().forEach(a => { try { if (a.startTime !== 0) a.startTime = 0; } catch { /* 不支援就算了 */ } }));
};

export const BusyLayer: React.FC<{
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  /** 接手上一層：照原樣顯示上一層最後的內容（15 秒內的才算） */
  continueLast?: boolean;
} & React.HTMLAttributes<HTMLDivElement>> = ({ className = '', style, children, continueLast = false, ...rest }) => {
  const ref = useRef<HTMLDivElement>(null);
  const snapshot = continueLast && last && Date.now() - last.at < 15000 ? last : null;
  // 每次畫完：轉圈對齊時鐘；不是接手的那一層就記下自己現在的內容
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    alignSpinners(el);
    if (!continueLast) last = { html: el.innerHTML, className, at: Date.now() };
  });
  /* 「15 秒內」要從上一層**收掉**的那一刻算，不是從它最後一次重畫算：
     存很久的時候那一層幾十秒都沒重畫，接手時就被當成過期，只剩轉圈、字不見了 */
  useLayoutEffect(() => () => { if (!continueLast && last) last.at = Date.now(); }, [continueLast]);
  const node = snapshot ? (
    <div ref={ref} data-busy-layer {...rest} className={`fixed inset-0 ${snapshot.className} [&_button]:pointer-events-none`} style={style}
      dangerouslySetInnerHTML={{ __html: snapshot.html }} />
  ) : (
    <div ref={ref} data-busy-layer {...rest} className={`fixed inset-0 ${className}`} style={style}>
      {children}
    </div>
  );
  if (typeof document === 'undefined') return node;
  /* 電腦上 App 放在一個模擬手機的框（.abai-frame，有 transform）裡：掛在框上就剛好蓋住那支「手機」。
     手機上這個框沒有 transform，fixed 就以螢幕為準。 */
  const host = (document.querySelector('.abai-frame') as HTMLElement | null) ?? document.body;
  return createPortal(node, host);
};

/** 等「處理中」那一層真的畫到螢幕上再開始做事。
 *  不能只靠 setTimeout 等一下：剛打開 App 時主執行緒還在暖機（建 GPU 貼圖、烘濾鏡），固定等 100ms 時那一層常常還沒畫出來，
 *  接著存檔的大量運算一開始就卡住畫面，使用者等於完全沒看到處理中的動畫。
 *  做法：等到畫面上有處理中那一層（最多等 1.5 秒），再多等兩個畫面更新（確定已經畫出去）才回來。 */
export function afterBusyPainted(): Promise<void> {
  return new Promise(resolve => {
    const t0 = performance.now();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    /* 保險：分頁在背景時 requestAnimationFrame 不會跑，不能卡住 */
    const guard = window.setTimeout(finish, 2000);
    const look = () => {
      if (document.querySelector('[data-busy-layer]') || performance.now() - t0 > 1500) {
        requestAnimationFrame(() => requestAnimationFrame(() => { window.clearTimeout(guard); finish(); }));
        return;
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}

/* ── 存檔用的「儲存中」：從按下儲存到存進相簿都是**同一個**畫面元素 ──
   以前是兩層接力（算圖那一層收掉、存相簿那一層照抄內容再接上），轉圈對得上，但「儲存中」那行字的亮暗呼吸
   重新開始，看得出斷一下。現在這一層不交給 React 管：由誰要用就登記一下，最後一個用的人放手後
   （同一次畫面更新裡沒有人接手）才拿掉 —— 算完圖直接接著存相簿時，從頭到尾是同一個元素、動畫一路播完。 */
let held: HTMLDivElement | null = null;
let holders = 0;
let releaseTimer = 0;
function ensureHeld(label: string): void {
  if (releaseTimer) { cancelAnimationFrame(releaseTimer); releaseTimer = 0; }
  if (held && held.isConnected) return;
  const host = (document.querySelector('.abai-frame') as HTMLElement | null) ?? document.body;
  const el = document.createElement('div');
  el.setAttribute('data-busy-layer', '');
  el.setAttribute('data-held-busy', '');
  el.setAttribute('aria-label', label);
  el.className = 'fixed inset-0 z-[10000] bg-black flex items-center justify-center';
  el.innerHTML = '<div class="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin"></div>'
    + '<p data-busy-label style="position:absolute;left:0;right:0;top:calc(50% + 44px);text-align:center" class="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white"></p>';
  (el.querySelector('p') as HTMLElement).textContent = label;
  host.appendChild(el);
  held = el;
  last = null;   // 之後要接手的那一層不能抄到更早以前別的畫面
  alignSpinners(el);
}
function releaseHeld(): void {
  holders = Math.max(0, holders - 1);
  if (holders > 0 || releaseTimer) return;
  /* 等兩格：同一次更新裡接手的那一層（存相簿）會先登記，就不拿掉 */
  releaseTimer = requestAnimationFrame(() => {
    releaseTimer = requestAnimationFrame(() => {
      releaseTimer = 0;
      if (holders === 0 && held) { held.remove(); held = null; }
    });
  });
}
/** 現在有沒有一層「儲存中」正在顯示（存相簿那一段用：有就接著用同一層） */
export const heldBusyShowing = () => !!(held && held.isConnected);
/** 掛著時顯示「儲存中」（同一個元素一路用到最後一個放手的人）。不畫任何 React 節點 */
export const HeldBusy: React.FC<{ label?: string; claimOnly?: boolean }> = ({ label = '儲存中', claimOnly = false }) => {
  useLayoutEffect(() => {
    if (claimOnly && !heldBusyShowing() && !releaseTimer) return;
    holders++;
    ensureHeld(label);
    return releaseHeld;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};
