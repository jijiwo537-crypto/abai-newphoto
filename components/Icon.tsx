
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
  /* 調色輪：一個色輪（外圈＋十字刻度）加上偏離中心的調整點，跟達芬奇的色輪同一個樣子 */
  grade_wheels: (fill) => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.6" strokeWidth={1.8} />
      <path d="M12 5.6v1.9M12 16.5v1.9M5.6 12h1.9M16.5 12h1.9" strokeWidth={1.4} />
      <path d="M12 12l2.6-2.6" strokeWidth={1.2} opacity={0.7} />
      <circle cx="14.9" cy="9.1" r="2.15" fill={fill ? 'currentColor' : 'none'} strokeWidth={1.5} />
    </svg>
  ),
  /* 色彩切片：六等分的圓，其中一片往外拉出 */
  color_slice: (fill) => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
      <path d="M11 13 L11 4.4 A8.6 8.6 0 1 0 18.45 17.3 Z" />
      <path d="M11 13 L3.55 17.3 M11 13 L3.55 8.7" opacity={0.75} />
      <path d="M13.2 11.2 L13.2 2.6 A8.6 8.6 0 0 1 20.65 6.9 Z" fill={fill ? 'currentColor' : 'none'} />
    </svg>
  ),
  /* 色彩扭曲器：極座標網格，其中一個節點被拉歪 */
  color_warper: (fill) => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.8" strokeWidth={1.6} />
      <path d="M12 3.2V20.8M3.2 12H20.8M5.8 5.8L18.2 18.2M18.2 5.8L5.8 18.2" strokeWidth={0.9} opacity={0.55} />
      <path d="M12 7.4C14.2 7.2 16.6 8.6 16.2 11.2C15.9 13.6 15 16.6 12 16.6C9.6 16.6 7.4 14.6 7.4 12C7.4 9.5 9.6 7.6 12 7.4Z" strokeWidth={1.3} />
      <circle cx="16.2" cy="11.2" r="1.9" fill={fill ? 'currentColor' : 'none'} strokeWidth={1.4} />
    </svg>
  ),
  /* 限定器：滴管 */
  qualifier: (fill) => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.2 6.3l3.5 3.5" />
      <path d="M16.6 3.9a2.47 2.47 0 0 1 3.5 3.5l-2.2 2.2-3.5-3.5z" fill={fill ? 'currentColor' : 'none'} />
      <path d="M15.4 8.6L6.8 17.2 4.6 19.4l.4-2.6L13.6 8.2" />
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
