/* 線條圖示（不透明）：SVG 只當遮罩，顏色用 currentColor 整塊填一次。
   直接用半透明顏色畫線的話，線跟線交會處會疊兩層變白；當遮罩就只有一層。
   大小、擦除、反轉跟編輯器遮色片頁是同一組圖（見 ImageEditor 的 MASK_GLYPH_BODY）。 */
import React from 'react';

const BODY: Record<string, string> = {
  size: '<circle cx="9" cy="15" r="4"/><circle cx="15.5" cy="8.5" r="2"/>',
  erase: '<path d="M8.5 19.5h11"/><path d="M5 15.5l8.5-8.5 5 5-6.5 6.5H8z"/><path d="M9.5 11l5 5"/>',
  invert: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="#fff" stroke="none"/>',
  /* 線條：一條起伏的線 */
  lines: '<path d="M3.5 15c2.2 0 2.6-6 5-6s2.8 6 5.1 6 2.6-6 5-6 1.6 1.5 1.9 2.2"/>',
  /* 粗細：由細到粗三條線 */
  weight: '<path d="M5 6.5h14" stroke-width="1.2"/><path d="M5 12h14" stroke-width="2.2"/><path d="M5 17.8h14" stroke-width="3.4"/>',
};
const URL_OF: Record<string, string> = Object.fromEntries(Object.entries(BODY).map(([k, body]) => [k,
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`)}")`]));

export const Glyph: React.FC<{ k: keyof typeof BODY | string; size?: number }> = ({ k, size = 18 }) => {
  const url = URL_OF[k];
  if (!url) return null;
  return <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size, backgroundColor: 'currentColor',
    WebkitMaskImage: url, maskImage: url, WebkitMaskSize: '100% 100%', maskSize: '100% 100%', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' }} />;
};
