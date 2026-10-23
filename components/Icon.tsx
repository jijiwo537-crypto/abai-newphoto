
import React from 'react';

interface IconProps {
  name: string;
  className?: string;
  onClick?: () => void;
  fill?: boolean;
}

/**
 * 圖示字型裡沒有、但我們需要的圖，改用內嵌 SVG 自己畫。
 *
 * 專案裡的 Material Symbols 是**子集**（只打包了有用到的那些字），
 * 不在子集裡的名字會直接把英文印在畫面上，而且寬到蓋掉隔壁的東西。
 * 這裡列的就是那幾個 —— 名字照舊，呼叫端完全不用改。
 *
 * 畫法：SVG 只當「形狀」（遮罩），顏色用 currentColor 整塊填一次。
 * 圖示常常是半透明的顏色（沒選中時 text-white/40），如果直接用半透明的線去畫，
 * 兩條線交會、線跟點重疊的地方會疊兩層，變成一個比較白的點。當遮罩用的話，
 * 重疊的地方還是同一層，整個圖示是均勻、不透明感的線條 —— 跟字型圖示一樣。
 */
const INLINE: Record<string, string> = {
  /* 虛線：上面一條實線、下面一條虛線 */
  line_style: '<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M2.5 7.5h19"/><path d="M2.5 16.5h3.5M10.25 16.5h3.5M18 16.5h3.5"/></g>',
  /* 色輪：一個圓（色輪）、一個偏離中心的實心點（調整點），跟 Material 圖示同一種線寬 */
  /* 磨皮：一大一小兩顆四角星（變光滑、變乾淨），不畫人 */
  skin_smooth: '<path fill="#fff" d="M10 3.2c.5 3.6 1.9 5.3 5.6 5.8-3.7.5-5.1 2.2-5.6 5.8-.5-3.6-1.9-5.3-5.6-5.8 3.7-.5 5.1-2.2 5.6-5.8z"/><path fill="#fff" d="M17.2 12.6c.3 2.1 1.1 3.1 3.3 3.4-2.2.3-3 1.3-3.3 3.4-.3-2.1-1.1-3.1-3.3-3.4 2.2-.3 3-1.3 3.3-3.4z"/><circle cx="6.3" cy="18.6" r="1.3" fill="#fff"/>',
  grade_wheels: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="14.6" cy="9.4" r="2.4" fill="#fff"/>',
};
const maskOf = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`)}")`;
const MASKS: Record<string, string> = Object.fromEntries(Object.entries(INLINE).map(([k, v]) => [k, maskOf(v)]));

export const Icon: React.FC<IconProps> = ({ name, className = "", onClick, fill = false }) => {
  const mask = MASKS[name];
  if (mask) {
    return (
      <span
        className={`select-none inline-flex items-center justify-center align-middle ${className}`}
        onClick={onClick}
      >
        <span aria-hidden style={{
          display: 'block', width: '1em', height: '1em', backgroundColor: 'currentColor',
          WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
          WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
        }} />
      </span>
    );
  }
  return (
    <span
      className={`material-symbols-outlined select-none inline-block align-middle ${className}`}
      style={{ fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 300, 'opsz' 24` }}
      onClick={onClick}
    >
      {name}
    </span>
  );
};
