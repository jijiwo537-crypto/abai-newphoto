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
  'circle', 'square', 'cross-star', 'heart', 'star',
  'hexstar',
  'flower', 'snow', 'burst', 'love', 'love3',
  'pic333', 'vortex', 'random-num', 'seagrass', 'darkstar',
  'sparkle', 'aster', 'theta', 'zzz', 'text',
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
    'circle-f', 'square-f', 'rounded-f', 'triangle-f', 'diamond-f', 'diamond-n-f',
    'pentagon-f', 'hexagon-f', 'heart-f', 'star-f', 'star-rounded-f', 'star-double-f',
    'hexstar-f',
    'square-star-dual-f', 'square-heart-dual-f', 'square-star-cutout-f', 'square-heart-cutout-f',
    'circle-star-dual-f', 'circle-heart-dual-f', 'circle-star-cutout-f', 'circle-heart-cutout-f', 'hole-cross-star-f', 'sparkle4-f', 'arrow-f',
    'blur-star-f', 'blur-star-rounded-f', 'blur-heart-f', 'blur-circle-f', 'blur-cross-star-f', 'blur-square-f',
    'hole-flower', 'hole-snow', 'hole-burst', 'hole-love', 'hole-love3', 'hole-pic333',
    'hole-vortex', 'hole-seagrass', 'hole-darkstar', 'hole-sparkle', 'hole-aster', 'hole-theta',
    'hole-abai',
  ],
  outline: [
    'circle-o', 'square-o', 'rounded-o', 'triangle-o', 'diamond-o', 'diamond-n-o',
    'pentagon-o', 'hexagon-o', 'heart-o', 'star-o', 'star8-o', 'star8-oval-o',
    'hexstar-o',
    'cloud-oval-o', 'hole-cross-star-o', 'sparkle4-o', 'arrow-o', 'ellipse-o', 'cloud-o', 'bubble-o',
    'bubble-mirror-o',
  ],
  line: ['line-h', 'line-v', 'line-d1', 'line-d2', 'line-wave', 'line-lightning-wave'],
  grid: [
    'grid-horizontal', 'grid-cross', 'grid-frame', 'grid-dots-staggered', 'grid-dots', 'grid-dots-fade',
    'grid-dots-fade-diagonal', 'grid-diagonal', 'grid-diag-cross', 'grid-plus', 'grid-orbits', 'grid-chevron',
  ],
  mask: ['mask-mosaic', 'mask-bricks', 'mask-frost', 'mask-negative', 'mask-negative-mono', 'mask-monochrome'],
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
