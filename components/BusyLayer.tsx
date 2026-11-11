import React from 'react';
import { createPortal } from 'react-dom';

/**
 * 匯出中／存相簿時蓋住整個畫面的那一層（轉圈、文字、取消鍵）。
 *
 * 一定要掛在 document.body，不能留在工具的版面裡：工具的最外層有 transform，
 * 「position: fixed」碰到有 transform 的祖先就改成以那個祖先為準，而那個祖先在 iPhone 上的大小、
 * 位置（狀態列、100vh 比可見畫面高…）跟螢幕不一樣 —— 轉圈就會偏下，而且每台裝置偏得不一樣。
 * 掛到 body 之後，它永遠以手機螢幕為準。所有工具共用這一個，轉圈的位置完全相同，
 * 「匯出中」換成「存相簿」時看不出換了一層。
 *
 * 位置：剛好蓋滿整個螢幕，轉圈在螢幕的正中央（垂直置中）；百分比、文字、取消鍵掛在它下方。
 */
export const BusyLayer: React.FC<{ className?: string; style?: React.CSSProperties; children?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>> =
  ({ className = '', style, children, ...rest }) => {
    const node = (
      <div {...rest} className={`fixed inset-0 ${className}`} style={style}>
        {children}
      </div>
    );
    if (typeof document === 'undefined') return node;
    /* 電腦上 App 放在一個模擬手機的框（.abai-frame，有 transform）裡：掛在框上就剛好蓋住那支「手機」。
       手機上這個框沒有 transform，fixed 就以螢幕為準。 */
    const host = (document.querySelector('.abai-frame') as HTMLElement | null) ?? document.body;
    return createPortal(node, host);
  };
