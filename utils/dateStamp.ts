/* 相機的日期戳記：底片相機那種橘紅色七段字「'25 11 23」，印在右下角。
 * 字形與畫法在原生端（ios/App/App/ABAIDateStamp.swift），觀景窗與拍出來的照片同一個位置。 */
export const dateStampText = (d = new Date()) =>
  `'${String(d.getFullYear() % 100).padStart(2, '0')} ${String(d.getMonth() + 1).padStart(2, ' ')} ${String(d.getDate()).padStart(2, '0')}`;
