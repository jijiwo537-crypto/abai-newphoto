/* 圖標方案（order.html 的「圖標」頁讓主人挑）。分成兩組、各自成對：
   高光↔陰影 一對、白色↔黑色 一對。線條粗細跟 App 其他圖示（亮度、曝光、對比）一樣，畫法盡量簡單。
   這個檔是產生出來的資料，挑好之後把那兩對貼進 components/Icon.tsx 的 INLINE。 */
export type IconPair = { id: string; name: string; desc: string; a: string; b: string };

/** App 現在用的（只當對照） */
export const CURRENT_HS: IconPair = { id: 'current', name: '目前 App 裡的', desc: '', a: '<defs><mask id="h"><circle cx="12" cy="12" r="6.4" fill="#fff"/><circle cx="15.5" cy="15.5" r="6.4" fill="#000"/></mask></defs><circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><rect width="24" height="24" fill="#fff" mask="url(#h)"/>', b: '<defs><mask id="s"><circle cx="12" cy="12" r="6.4" fill="#fff"/><circle cx="8.5" cy="8.5" r="6.4" fill="#000"/></mask></defs><circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><g mask="url(#s)"><path d="M-24 0 0 24M-20.8 0 3.2 24M-17.6 0 6.4 24M-14.4 0 9.6 24M-11.2 0 12.8 24M-8 0 16 24M-4.8 0 19.2 24M-1.6 0 22.4 24M1.6 0 25.6 24M4.8 0 28.8 24M8 0 32 24M11.2 0 35.2 24M14.4 0 38.4 24M17.6 0 41.6 24M20.8 0 44.8 24M24 0 48 24" stroke="#fff" stroke-width="1.5" fill="none"/></g>' };
export const CURRENT_WB: IconPair = { id: 'current', name: '目前 App 裡的', desc: '', a: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="12" r="6.4" fill="#fff"/>', b: '<defs><mask id="b"><circle cx="12" cy="12" r="6.4" fill="#fff"/></mask></defs><circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/><g mask="url(#b)"><path d="M-24 0 0 24M-20.8 0 3.2 24M-17.6 0 6.4 24M-14.4 0 9.6 24M-11.2 0 12.8 24M-8 0 16 24M-4.8 0 19.2 24M-1.6 0 22.4 24M1.6 0 25.6 24M4.8 0 28.8 24M8 0 32 24M11.2 0 35.2 24M14.4 0 38.4 24M17.6 0 41.6 24M20.8 0 44.8 24M24 0 48 24" stroke="#fff" stroke-width="1.5" fill="none"/></g>' };

/** 高光（a）↔ 陰影（b） */
export const HS_PAIRS: IconPair[] = [
  { id: 'cap', name: '圓・上下', desc: '圓的上半實心＝亮部；下半實心＝暗部',
    a: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12a8 8 0 0 1 16 0z" fill="#fff"/>',
    b: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12a8 8 0 0 0 16 0z" fill="#fff"/>' },
  { id: 'capthird', name: '圓・頂底', desc: '只填圓的最頂端／最底端一小塊',
    a: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.3 8.4a8 8 0 0 1 11.4 0z" fill="#fff"/>',
    b: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.3 15.6a8 8 0 0 0 11.4 0z" fill="#fff"/>' },
  { id: 'dot', name: '圓裡的點', desc: '一個圓，小實心點在上面／在下面',
    a: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="8.2" r="2.3" fill="#fff"/>',
    b: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15.8" r="2.3" fill="#fff"/>' },
  { id: 'arc', name: '球面反光', desc: '圓內一道弧線：左上的反光／右下的背光',
    a: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.6 11.2a4.6 4.6 0 0 1 3.6-3.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    b: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.4 12.8a4.6 4.6 0 0 1-3.6 3.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'quarter', name: '圓・斜角', desc: '右上一角實心／左下一角實心',
    a: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 4a8 8 0 0 1 8 8h-8z" fill="#fff"/>',
    b: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 20a8 8 0 0 1-8-8h8z" fill="#fff"/>' },
  { id: 'square', name: '方塊・上下', desc: '圓角方塊上半／下半實心',
    a: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 4h10a3 3 0 0 1 3 3v5H4V7a3 3 0 0 1 3-3z" fill="#fff"/>',
    b: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12h16v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="#fff"/>' },
  { id: 'lines', name: '三條橫線', desc: '三條線，最上面那條粗＝高光；最下面那條粗＝陰影',
    a: '<path d="M4 6.5h16" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12h16M4 17.5h16" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    b: '<path d="M4 6.5h16M4 12h16" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17.5h16" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'wave', name: '波峰波谷', desc: '同一條波浪，點在波峰＝高光；點在波谷＝陰影',
    a: '<path d="M3 12c2.2 0 3.3-5 6-5s3.8 10 6 10 3.8-5 6-5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="7" r="2.3" fill="#fff"/>',
    b: '<path d="M3 12c2.2 0 3.3-5 6-5s3.8 10 6 10 3.8-5 6-5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15" cy="17" r="2.3" fill="#fff"/>' },
  { id: 'bars', name: '長條', desc: '三根長條由矮到高，最高那根實心＝高光；最矮那根實心＝陰影',
    a: '<rect x="4" y="13" width="3.6" height="7" rx="1" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="10.2" y="9" width="3.6" height="11" rx="1" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="16.4" y="4" width="3.6" height="16" rx="1" fill="#fff"/>',
    b: '<rect x="4" y="13" width="3.6" height="7" rx="1" fill="#fff"/><rect x="10.2" y="9" width="3.6" height="11" rx="1" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="16.4" y="4" width="3.6" height="16" rx="1" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'arch', name: '弧與點', desc: '實心點上方一道弧＝光從上面來；下方一道弧＝影子在下面',
    a: '<path d="M5 12a7 7 0 0 1 14 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15" r="2.6" fill="#fff"/>',
    b: '<path d="M5 12a7 7 0 0 0 14 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.6" fill="#fff"/>' },
];

/** 白色（a）↔ 黑色（b） */
export const WB_PAIRS: IconPair[] = [
  { id: 'disc', name: '實心／空心圓', desc: '白色＝實心圓；黑色＝空心圓',
    a: '<circle cx="12" cy="12" r="8" fill="#fff"/>',
    b: '<circle cx="12" cy="12" r="7.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'core', name: '圓環＋核心', desc: '白色＝圓環裡一顆大實心；黑色＝圓環裡空的小圈',
    a: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="4.6" fill="#fff"/>',
    b: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'box', name: '實心／空心方塊', desc: '白色＝實心圓角方塊；黑色＝空心方塊',
    a: '<rect x="4" y="4" width="16" height="16" rx="3.5" fill="#fff"/>',
    b: '<rect x="4.5" y="4.5" width="15" height="15" rx="3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'end', name: '推到底', desc: '箭頭推到右邊的牆＝白點；推到左邊的牆＝黑點',
    a: '<path d="M19.5 5v14M4 12h11.5M11.5 8l4 4-4 4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    b: '<path d="M4.5 5v14M20 12H8.5M12.5 8l-4 4 4 4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'slider', name: '滑軌端點', desc: '一條橫線，實心圓點在最右端／空心圓點在最左端',
    a: '<path d="M3.5 12h11" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17.5" cy="12" r="3" fill="#fff"/>',
    b: '<path d="M9.5 12h11" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="12" r="2.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'bar', name: '色階條兩端', desc: '一根膠囊，右端實心＝白；左端實心＝黑',
    a: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 8.5h3.5a3.5 3.5 0 0 1 0 7H14z" fill="#fff"/>',
    b: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 8.5H6.5a3.5 3.5 0 0 0 0 7H10z" fill="#fff"/>' },
  { id: 'corner', name: '方塊角落', desc: '方框右上角實心＝白；左下角實心＝黑',
    a: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 4h5a3 3 0 0 1 3 3v5z" fill="#fff"/>',
    b: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 20H7a3 3 0 0 1-3-3v-5z" fill="#fff"/>' },
  { id: 'diamond', name: '實心／空心菱形', desc: '白色＝實心菱形；黑色＝空心菱形',
    a: '<path d="M12 3.5l8.5 8.5-8.5 8.5-8.5-8.5z" fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>',
    b: '<path d="M12 4l8 8-8 8-8-8z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'double', name: '雙圈', desc: '白色＝兩圈都畫、中間填滿；黑色＝只剩外圈和一點',
    a: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="5" fill="#fff"/>',
    b: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.6" fill="#fff"/>' },
  { id: 'bracket', name: '括號端點', desc: '右括號＋實心點＝最白那端；左括號＋空心點＝最黑那端',
    a: '<path d="M15 5h3.5v14H15" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="12" r="3.2" fill="#fff"/>',
    b: '<path d="M9 5H5.5v14H9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15" cy="12" r="3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
];
