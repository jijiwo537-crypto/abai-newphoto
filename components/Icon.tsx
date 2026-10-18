
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
 */
const INLINE: Record<string, (fill: boolean) => React.ReactNode> = {
  /* 虛線：上面一條實線、下面一條虛線 */
  line_style: () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M2.5 7.5h19" />
      <path d="M2.5 16.5h3.5M10.25 16.5h3.5M18 16.5h3.5" />
    </svg>
  ),
  /* 調色輪：上一個、下兩個圓圈（陰影／中間調／亮部），各帶一顆調整點 */
  grade_wheels: (fill) => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="7" r="4.6" />
      <circle cx="6.6" cy="16.6" r="4.6" />
      <circle cx="17.4" cy="16.6" r="4.6" />
      <g fill="currentColor" stroke="none" opacity={fill ? 1 : 0.9}>
        <circle cx="13.6" cy="5.6" r="1.3" />
        <circle cx="5.2" cy="18" r="1.3" />
        <circle cx="18.6" cy="15" r="1.3" />
      </g>
    </svg>
  ),
};

export const Icon: React.FC<IconProps> = ({ name, className = "", onClick, fill = false }) => {
  const inline = INLINE[name];
  if (inline) {
    return (
      <span
        className={`select-none inline-flex items-center justify-center align-middle ${className}`}
        onClick={onClick}
      >
        {inline(fill)}
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
