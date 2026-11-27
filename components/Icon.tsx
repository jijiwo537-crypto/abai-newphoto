
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
  /* 調色盤（仿色）：畫家的調色盤外框（右下有拇指孔的缺口）＋四個顏料點，線寬跟主頁其他圖示（細體）一樣 */
  palette: '<path fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" d="M12 3.6c-4.8 0-8.5 3.6-8.5 8.3 0 4.6 3.6 8.5 8.2 8.5 1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1c2.6 0 4.6-2.1 4.6-4.6 0-3.6-4.1-6.2-9.2-6.2z"/><g fill="#fff"><circle cx="7.6" cy="11.7" r="1.2"/><circle cx="9.6" cy="7.9" r="1.2"/><circle cx="14.3" cy="7.9" r="1.2"/><circle cx="16.6" cy="11.4" r="1.2"/></g>',
  /* 主頁「仿色」的調色盤：跟跨頁拼圖第五個分頁（背景）同一個圖形（lucide 的 palette），
     縮成跟主頁其他圖示一樣大（外框約佔 24 格裡的 16.4 格），線寬換算後是 1.5（跟創意拼圖的外框一樣粗） */
  palette_round: '<g fill="none" stroke="#fff" stroke-width="1.83" stroke-linecap="round" stroke-linejoin="round" transform="translate(12 12) scale(.82) translate(-12 -12)"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><g fill="#fff"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/></g></g>',
  /* 專業相機：機身外框加鏡頭（相機設定選單的「專業」） */
  pro_camera: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"><path d="M3.5 8.2a1.7 1.7 0 0 1 1.7-1.7h2.6l1.5-2h5.4l1.5 2h2.6a1.7 1.7 0 0 1 1.7 1.7v9.6a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z"/><circle cx="12" cy="12.8" r="3.6"/></g>',
  /* 愛心（相機相簿）：實心、空心 */
  favorite: '<path fill="#fff" d="M12 20.6s-7.6-4.6-9.7-9.3C.7 7.8 2.9 4 6.7 4c2.2 0 3.7 1.2 4.4 2.5.2.3.6.3.8 0C12.6 5.2 14.1 4 16.3 4c3.8 0 6 3.8 4.4 7.3-2.1 4.7-8.7 9.3-8.7 9.3z"/>',
  favorite_border: '<path fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" d="M12 20.1s-7.2-4.4-9.1-8.8C1.4 8 3.4 4.6 6.8 4.6c2 0 3.5 1.1 4.2 2.4.4.6 1.6.6 2 0 .7-1.3 2.2-2.4 4.2-2.4 3.4 0 5.4 3.4 3.9 6.7-1.9 4.4-9.1 8.8-9.1 8.8z"/>',
  /* 分享（iOS 那種：方框＋往上的箭頭） */
  ios_share: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11.5M8 7.3l4-3.8 4 3.8"/><path d="M8.5 10H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10h-2"/></g>',
  /* 專業編輯：魔法棒＋兩顆小星 */
  auto_fix_high: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l10.5-10.5M13 8l3 3"/></g><path fill="#fff" d="M18 2.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM7.5 4l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L5.5 6l1.4-.6zM19.5 12.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
  /* 日曆（相機的日期戳記）：外框、上面兩個掛環、一條分隔線 */
  calendar_today: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></g>',
  /* RAW 檔：摺角的檔案外框，裡面三條長短不同的線 */
  raw_file: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/><path d="M9 12h6M9 15h6M9 18h3.5"/></g>',
  /* 虛線：上面一條實線、下面一條虛線 */
  line_style: '<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M2.5 7.5h19"/><path d="M2.5 16.5h3.5M10.25 16.5h3.5M18 16.5h3.5"/></g>',
  /* 色輪：一個圓（色輪）、一個偏離中心的實心點（調整點），跟 Material 圖示同一種線寬 */
  /* 空心星星（點陣的輪廓）：五角星外框，線寬跟其他圖示一樣 */
  star_outline: '<path fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" d="M12 3.3l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.7l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z"/>',
  /* 發光（點陣）：一顆四芒的閃光（四邊內凹的星形，發光、閃耀常用的樣子）加右上角一顆小閃光；
     跟「明暗」的太陽、「輪廓」的五角星分得開，線寬跟其他圖示一樣 */
  dot_glow: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"><path d="M10 4.5c.55 4.3 2.7 6.45 7 7-4.3.55-6.45 2.7-7 7-.55-4.3-2.7-6.45-7-7 4.3-.55 6.45-2.7 7-7z"/></g><path fill="#fff" d="M18.2 2.6c.3 1.75 1.05 2.5 2.8 2.8-1.75.3-2.5 1.05-2.8 2.8-.3-1.75-1.05-2.5-2.8-2.8 1.75-.3 2.5-1.05 2.8-2.8z"/>',
  /* 磨皮：一顆水滴（滋潤、變光滑）加一道柔和的反光，線條粗細跟其他圖示一致 */
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
  /* 創意拼圖：外框裡左邊一大格、右邊上下兩格。外框大小（24 格裡佔 17 格）、線寬（1.5，實測跟跨頁拼圖的字型圖示一樣粗）跟跨頁拼圖的 grid_view（Material Symbols 粗細 300）一樣，
     兩顆並排時大小、粗細一致 */
  collage_layout: '<g fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"><rect x="4.075" y="4.075" width="15.85" height="15.85" rx=".55"/><path d="M11.6 4.075v15.85M11.6 12h8.325"/></g>',
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
