
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
  /* 磨皮：一顆水滴（滋潤、變光滑）加一道柔和的反光，線條粗細跟其他圖示一致 */
  skin_smooth: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2C8.3 7.6 6 10.9 6 14.1a6 6 0 0 0 12 0c0-3.2-2.3-6.5-6-10.9z"/><path d="M9.1 14.6a3.1 3.1 0 0 0 2.4 2.7"/></g>',
  /* 色輪：一個圓、正中心一個實心點 */
  /* 白色色階／黑色色階：一座直方圖，右端（白點）／左端（黑點）立一根標竿 —— 跟 Lightroom 直方圖上那兩端的意思一樣。
     白色那根頂端是實心圓（亮），黑色那根是空心圓（暗）。 */
  tone_whites: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19.5h18"/><path d="M3.5 19.5c2.6-.6 3.6-8 6.6-8s3.5 5.4 5.7 5.4"/><path d="M19 8v11.5"/></g><circle cx="19" cy="5.6" r="2.4" fill="#fff"/>',
  tone_blacks: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19.5h18"/><path d="M20.5 19.5c-2.6-.6-3.6-8-6.6-8s-3.5 5.4-5.7 5.4"/><path d="M5 8.4v11.1"/><circle cx="5" cy="5.6" r="2"/></g>',
  /* 修補：一塊斜放的 OK 繃（中間透氣孔的四個點），跟去痘的圖標分得開 */
  patch_heal: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"><rect x="3.2" y="8.6" width="17.6" height="6.8" rx="3.4" transform="rotate(-45 12 12)"/><rect x="8.9" y="8.9" width="6.2" height="6.2" rx="1" transform="rotate(-45 12 12)"/></g><g fill="#fff"><circle cx="11" cy="11" r=".8"/><circle cx="13" cy="11" r=".8"/><circle cx="11" cy="13" r=".8"/><circle cx="13" cy="13" r=".8"/></g>',
  grade_wheels: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="2.4" fill="#fff"/>',
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
