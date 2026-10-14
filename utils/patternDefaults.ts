/* 創意拼圖「圖案」每一種的起始大小（「大小」滑桿的 0～100）。
   點一個圖案就換成它自己的大小；沒列到的一律 25。
   App 一開始的圖案（星星）也照這張表，不然開場的星星跟「切走再切回來」的
   星星大小不一樣，看起來就是越切越大。
   排序工具（order.html）的「大小」頁讀的也是這一份。 */
export const PATTERN_SIZE_FALLBACK = 25;

export const PATTERN_DEFAULT_SIZES: Record<string, number> = {
  'cross-star': 30, sparkle4: 30, 'p-blur-cross-star': 30, 'p-blur-sparkle4': 30,
  star: 35, 'star-rounded': 35, 'p-star-double': 35, 'p-blur-star': 35,
  flower: 45,
  vortex: 35,
  heart: 30, 'heart-icon': 30, 'heart-classic': 30,
  hexstar: 35,
  love: 25,
  // 字更長，同樣的「大小」值看起來會比較大，所以預設調小一點
  love3: 18,
  circle: 20,
  square: 15,
  'random-num': 15,
  seagrass: 40,
  darkstar: 45,
  // 字身在字框裡本來就偏小，起始尺寸給大一點才跟其他圖案差不多大
  sparkle: 70,
  aster: 40,
  snow: 50,
  burst: 45,
  // 橫的一長條，長邊當大小，所以要給大一點才看得清楚
  pic333: 60,
  theta: 30,
  // 一顆是三個字連在一起，同樣的「大小」值看起來會比較大
  yaya: 22, zzz: 22,
  text: 15,
  'p-blur-star-rounded': 20, 'p-blur-heart': 20,
  'p-star-o': 35,
  'p-sparkle4-o': 30, 'anger-mark': 30,
  'q-mark': 25,
  // 驚嘆號又細又高，長邊當大小的話看起來比較小
  'excl-mark': 30,
};

/** 音符的字身細長，給大一點才跟星星那些看起來差不多大 */
const MUSIC_SIZE = 40;

/** 這個圖案的起始大小。overrides：排序工具裡試調的值（只在預覽裡用） */
export const patternDefaultSize = (id: string, overrides?: Record<string, number> | null): number => {
  const o = overrides?.[id];
  if (typeof o === 'number' && Number.isFinite(o)) return Math.max(0, Math.min(100, Math.round(o)));
  if (id in PATTERN_DEFAULT_SIZES) return PATTERN_DEFAULT_SIZES[id];
  if (id.startsWith('music-')) return MUSIC_SIZE;
  return PATTERN_SIZE_FALLBACK;
};
