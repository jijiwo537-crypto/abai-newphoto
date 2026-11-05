/* 線條圖示（不透明）：SVG 只當遮罩，顏色用 currentColor 整塊填一次。
   直接用半透明顏色畫線的話，線跟線交會處會疊兩層變白；當遮罩就只有一層。
   大小、擦除、反轉跟編輯器遮色片頁是同一組圖（見 ImageEditor 的 MASK_GLYPH_BODY）。 */
import React from 'react';

const BODY: Record<string, string> = {
  size: '<circle cx="9" cy="15" r="4"/><circle cx="15.5" cy="8.5" r="2"/>',
  erase: '<path d="M8.5 19.5h11"/><path d="M5 15.5l8.5-8.5 5 5-6.5 6.5H8z"/><path d="M9.5 11l5 5"/>',
  invert: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="#fff" stroke="none"/>',
  /* 輪廓：側臉的外框線（描出照片裡的輪廓） */
  contour: '<path d="M8.6 20.5v-4.4C6.1 14.8 4.5 12.3 4.5 9.4 4.5 5.9 7.6 3.5 11.3 3.5c3.6 0 6.2 2.4 6.6 5.6l1.7 3.1c.3.5-.1 1-.6 1h-1.3v2.4c0 1-.8 1.8-1.8 1.8h-1.8v3.1"/>',
  /* 間距：點一組一組排（2×2 一組，組與組之間空較多） */
  spacing: '<g fill="#fff" stroke="none"><rect x="3.6" y="3.6" width="2.8" height="2.8" rx=".5"/><rect x="7.6" y="3.6" width="2.8" height="2.8" rx=".5"/><rect x="13.6" y="3.6" width="2.8" height="2.8" rx=".5"/><rect x="17.6" y="3.6" width="2.8" height="2.8" rx=".5"/><rect x="3.6" y="7.6" width="2.8" height="2.8" rx=".5"/><rect x="7.6" y="7.6" width="2.8" height="2.8" rx=".5"/><rect x="13.6" y="7.6" width="2.8" height="2.8" rx=".5"/><rect x="17.6" y="7.6" width="2.8" height="2.8" rx=".5"/><rect x="3.6" y="13.6" width="2.8" height="2.8" rx=".5"/><rect x="7.6" y="13.6" width="2.8" height="2.8" rx=".5"/><rect x="13.6" y="13.6" width="2.8" height="2.8" rx=".5"/><rect x="17.6" y="13.6" width="2.8" height="2.8" rx=".5"/><rect x="3.6" y="17.6" width="2.8" height="2.8" rx=".5"/><rect x="7.6" y="17.6" width="2.8" height="2.8" rx=".5"/><rect x="13.6" y="17.6" width="2.8" height="2.8" rx=".5"/><rect x="17.6" y="17.6" width="2.8" height="2.8" rx=".5"/></g>',
};
const URL_OF: Record<string, string> = Object.fromEntries(Object.entries(BODY).map(([k, body]) => [k,
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`)}")`]));

export const Glyph: React.FC<{ k: keyof typeof BODY | string; size?: number }> = ({ k, size = 18 }) => {
  const url = URL_OF[k];
  if (!url) return null;
  return <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size, backgroundColor: 'currentColor',
    WebkitMaskImage: url, maskImage: url, WebkitMaskSize: '100% 100%', maskSize: '100% 100%', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' }} />;
};
