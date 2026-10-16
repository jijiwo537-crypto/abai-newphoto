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
  'circle', 'square', 'heart', 'star', 'star-rounded',
  'sparkle4', 'cross-star', 'hexstar', 'p-star-double', 'darkstar',
  'burst-dash', 'burst', 'snow', 'flower', 'aster',
  'love', 'love3', 'pic333', 'spinner', 'vortex',
  'seagrass', 'sparkle', 'question', 'theta', 'zzz',
  'p-star-o', 'p-sparkle4-o', 'q-mark', 'excl-mark', 'anger-mark',
  'p-blur-star-rounded', 'p-blur-cross-star', 'p-blur-sparkle4', 'p-blur-heart',
  'random-num', 'music-eighth', 'music-beamed', 'music-sixteenth', 'music-clef',
  'text',
];

export const SHAPE_SECTIONS = [
  ['solid', '實心'],
  ['outline', '外框'],
  ['burst', '星芒'],
  ['line', '線條'],
  ['grid', '網格'],
  ['mask', '遮罩'],
  ['frame', '邊框'],
] as const;
export type ShapeSection = typeof SHAPE_SECTIONS[number][0];

export const SHAPE_ORDER: Record<ShapeSection, string[]> = {
  solid: [
    'star-f', 'star-rounded-f', 'star-double-f', 'hole-cross-star-f', 'sparkle4-f', 'hexstar-f',
    'heart-f', 'triangle-f', 'circle-f', 'square-f', 'rounded-f', 'diamond-f',
    'pentagon-f', 'hexagon-f', 'diamond-n-f', 'hole-love', 'hole-love3', 'hole-pic333',
    'blur-star-f', 'blur-star-rounded-f', 'blur-cross-star-f', 'blur-sparkle4-f', 'blur-heart-f', 'blur-circle-f',
    'square-star-dual-f', 'square-heart-dual-f', 'square-star-cutout-f', 'square-heart-cutout-f', 'arrow-f', 'arrow-double-f',
    'circle-star-dual-f', 'circle-heart-dual-f', 'circle-star-cutout-f', 'circle-heart-cutout-f', 'hole-vortex', 'spinner-f',
    'burst-dash-f', 'hole-burst', 'hole-snow', 'hole-flower', 'hole-aster', 'hole-seagrass',
    'hole-darkstar', 'hole-sparkle', 'hole-question', 'hole-q-mark', 'hole-excl-mark', 'hole-anger-mark',
    'hole-abai', 'hole-theta', 'hole-music-eighth', 'hole-music-beamed', 'hole-music-sixteenth', 'hole-music-clef',
  ],
  outline: [
    'circle-o', 'square-o', 'diamond-o', 'heart-o', 'triangle-o', 'pentagon-o',
    'diamond-n-o', 'sparkle4-o', 'hole-cross-star-o', 'star-o', 'hexstar-o', 'star8-o',
    'rounded-o', 'track-select-o', 'track-select8-o', 'track-cross-o', 'arrow-o', 'arrow-double-o',
  ],
  frame: ['mist-frame', 'frame-speed', 'frame-scatter'],
  burst: [
    'hole-sb-tiny-cross', 'hole-sb-cross-thin', 'hole-sb-flat-six', 'hole-sb-six',
    'hole-sb-eight', 'hole-sb-eight-even',
    'hole-sb-ring-soft-cross', 'hole-sb-ring-flat-six', 'hole-sb-ring-cross', 'hole-sb-ring-six', 'hole-sb-ring-star8', 'hole-sb-halo-eight',
  ],
  line: [
    'line-h', 'line-v', 'line-d1', 'line-d2', 'line-wave', 'line-lightning-wave',
  ],
  grid: [
    'grid-horizontal', 'grid-diagonal', 'grid-diag-cross', 'grid-cross', 'grid-frame', 'grid-chevron',
    'grid-dots-staggered', 'grid-dots', 'grid-dots-fade', 'grid-dots-fade-diagonal', 'grid-plus', 'grid-orbits',
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
