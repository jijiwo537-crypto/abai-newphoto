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
  const node = snapshot ? (
    <div ref={ref} {...rest} className={`fixed inset-0 ${snapshot.className} [&_button]:pointer-events-none`} style={style}
      dangerouslySetInnerHTML={{ __html: snapshot.html }} />
  ) : (
    <div ref={ref} {...rest} className={`fixed inset-0 ${className}`} style={style}>
      {children}
    </div>
  );
  if (typeof document === 'undefined') return node;
  /* 電腦上 App 放在一個模擬手機的框（.abai-frame，有 transform）裡：掛在框上就剛好蓋住那支「手機」。
     手機上這個框沒有 transform，fixed 就以螢幕為準。 */
  const host = (document.querySelector('.abai-frame') as HTMLElement | null) ?? document.body;
  return createPortal(node, host);
};
