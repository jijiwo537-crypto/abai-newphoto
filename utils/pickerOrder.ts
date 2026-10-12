/* 圖案與圖形在選單裡的排列順序 —— 整個 App 只有這一份。
 *
 * - PATTERN_ORDER：創意拼圖「圖案」那一格一格的按鈕。
 * - SHAPE_ORDER：「新增圖形」清單，創意拼圖和跨頁拼圖共用（兩邊永遠一樣）。
 *
 * 想換順序：打開網站上的 order.html，長按拖曳排好，按「複製順序」，
 * 把複製到的文字貼給 Claude，替換掉底下這兩個常數就好。
 * 清單裡沒寫到的項目（例如之後新加的圖形）會自動接在該區的最後面，不會消失。
 */
export const PATTERN_ORDER: string[] = [
  'circle', 'square', 'heart', 'star', 'cross-star',
  'hexstar', 'burst', 'snow', 'flower', 'love',
  'love3', 'pic333', 'vortex', 'seagrass', 'random-num',
  'darkstar', 'sparkle', 'aster', 'theta', 'zzz',
  'text', 'sparkle4',
];

export const SHAPE_SECTIONS = [
  ['solid', '實心'],
  ['outline', '邊框'],
  ['line', '線條'],
  ['grid', '網格'],
  ['mask', '遮罩'],
] as const;
export type ShapeSection = typeof SHAPE_SECTIONS[number][0];

export const SHAPE_ORDER: Record<ShapeSection, string[]> = {
  solid: [
    'circle-f', 'square-f', 'rounded-f', 'diamond-f', 'triangle-f', 'diamond-n-f',
    'pentagon-f', 'hexagon-f', 'heart-f', 'hexstar-f', 'star-f', 'star-rounded-f',
    'star-double-f', 'hole-cross-star-f', 'sparkle4-f', 'hole-love', 'hole-love3', 'hole-pic333',
    'blur-star-f', 'blur-star-rounded-f', 'blur-cross-star-f', 'blur-heart-f', 'blur-circle-f', 'blur-square-f',
    'square-star-dual-f', 'square-heart-dual-f', 'square-star-cutout-f', 'square-heart-cutout-f', 'circle-star-cutout-f', 'circle-heart-cutout-f',
    'circle-heart-dual-f', 'circle-star-dual-f', 'arrow-f', 'hole-flower', 'hole-snow', 'hole-burst',
    'hole-vortex', 'hole-seagrass', 'hole-darkstar', 'hole-sparkle', 'hole-aster', 'hole-theta',
    'hole-abai',
  ],
  outline: [
    'circle-o', 'square-o', 'rounded-o', 'diamond-o', 'triangle-o', 'diamond-n-o',
    'pentagon-o', 'hexagon-o', 'heart-o', 'sparkle4-o', 'hole-cross-star-o', 'star-o',
    'hexstar-o', 'star8-o', 'star8-oval-o', 'cloud-oval-o', 'arrow-o', 'ellipse-o',
    'cloud-o', 'bubble-mirror-o', 'bubble-o',
  ],
  line: [
    'line-h', 'line-v', 'line-d1', 'line-d2', 'line-wave', 'line-lightning-wave',
  ],
  grid: [
    'grid-horizontal', 'grid-diagonal', 'grid-diag-cross', 'grid-cross', 'grid-frame', 'grid-chevron',
    'grid-orbits', 'grid-plus', 'grid-dots-staggered', 'grid-dots', 'grid-dots-fade', 'grid-dots-fade-diagonal',
  ],
  mask: [
    'mask-mosaic', 'mask-bricks', 'mask-frost', 'mask-negative', 'mask-negative-mono', 'mask-monochrome',
  ],
};

/** 依照 order 排列 items；order 沒提到的照原本順序接在最後面。 */
export const orderBy = <T extends { id: string }>(items: T[], order: string[]): T[] => {
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((it, i) => ({ it, r: rank.has(it.id) ? rank.get(it.id)! : order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map(x => x.it);
};

/** 把一串項目（字串 id）依 PATTERN_ORDER 排好，沒列到的接在最後 */
export const orderedPatterns = (all: string[]): string[] =>
  orderBy(all.map(id => ({ id })), PATTERN_ORDER).map(x => x.id);
