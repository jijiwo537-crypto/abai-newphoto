
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
  neutral_gray: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M12 3.4a8.6 8.6 0 0 1 0 17.2z" fill="#fff"/><path d="M12 7.6a4.4 4.4 0 0 0 0 8.8z" fill="#fff" fill-opacity=".5"/>',
  skin_smooth: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2C8.3 7.6 6 10.9 6 14.1a6 6 0 0 0 12 0c0-3.2-2.3-6.5-6-10.9z"/><path d="M9.1 14.6a3.1 3.1 0 0 0 2.4 2.7"/></g>',
  /* 色輪：一個圓、正中心一個實心點 */
  /* 高光／陰影／白色／黑色：同一組「一顆球」的圖。實心 = 亮、斜線 = 暗（素描畫陰影的畫法）。
     高光：左上受光的那一彎是實心；陰影：右下背光的那一彎是斜線（兩個左右鏡像、互相呼應）。
     白色：整顆實心（最亮的那一端）；黑色：整顆斜線（最暗的那一端）。跟亮度的太陽圖分得開。 */
  tone_highlights: '<defs><mask id="h"><circle cx="12" cy="12" r="6.4" fill="#fff"/><circle cx="15.5" cy="15.5" r="6.4" fill="#000"/></mask></defs><circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><rect width="24" height="24" fill="#fff" mask="url(#h)"/>',
  tone_shadows: '<defs><mask id="s"><circle cx="12" cy="12" r="6.4" fill="#fff"/><circle cx="8.5" cy="8.5" r="6.4" fill="#000"/></mask></defs><circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><g mask="url(#s)"><path d="M-24 0 0 24M-20.8 0 3.2 24M-17.6 0 6.4 24M-14.4 0 9.6 24M-11.2 0 12.8 24M-8 0 16 24M-4.8 0 19.2 24M-1.6 0 22.4 24M1.6 0 25.6 24M4.8 0 28.8 24M8 0 32 24M11.2 0 35.2 24M14.4 0 38.4 24M17.6 0 41.6 24M20.8 0 44.8 24M24 0 48 24" stroke="#fff" stroke-width="1.5" fill="none"/></g>',
  tone_whites: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="12" r="6.4" fill="#fff"/>',
  tone_blacks: '<defs><mask id="b"><circle cx="12" cy="12" r="6.4" fill="#fff"/></mask></defs><circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><g mask="url(#b)"><path d="M-24 0 0 24M-20.8 0 3.2 24M-17.6 0 6.4 24M-14.4 0 9.6 24M-11.2 0 12.8 24M-8 0 16 24M-4.8 0 19.2 24M-1.6 0 22.4 24M1.6 0 25.6 24M4.8 0 28.8 24M8 0 32 24M11.2 0 35.2 24M14.4 0 38.4 24M17.6 0 41.6 24M20.8 0 44.8 24M24 0 48 24" stroke="#fff" stroke-width="1.5" fill="none"/></g>',
  /* 刪除：一塊斜放的橡皮擦（前端一截實心＝擦掉的那一頭），底下一條擦過的痕跡 */
  erase_spot: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.6 4.3 20 9.7a1.6 1.6 0 0 1 0 2.3l-7.4 7.4H8.3L4 15.1a1.6 1.6 0 0 1 0-2.3l8.3-8.5a1.6 1.6 0 0 1 2.3 0z"/><path d="M12.6 19.4H20"/></g><path d="M4 15.1a1.6 1.6 0 0 1 0-2.3l4.4-4.5 7 7-4 4.1H8.3z" fill="#fff"/>',
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
