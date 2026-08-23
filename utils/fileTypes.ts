/**
 * 「這個 App 收哪些檔案」——只有這一份清單。
 *
 * 以前這串 accept 字串被複製在三個檔案裡，而且三份還不一樣
 * （相簿那一份少了 .cr3、.pef、.x3f），拼圖的入口更是只寫
 * "image/*,video/*" —— iOS 的相簿在那種情況下**根本不會把 RAW 檔列出來**，
 * 使用者看到的就是「我的 RAW 檔不見了」。
 *
 * 這一份刻意不 import 任何解碼器（heic2any、magick-wasm 都很重），
 * 所以只是要一串 accept 的地方不會把 13MB 的 wasm 拖進來。
 */

/** 相機 RAW 的副檔名（不含點）。順序照廠牌好認：Canon／Nikon／Sony／… */
export const RAW_EXTS = [
  'cr2', 'cr3', 'crw',          // Canon
  'nef', 'nrw',                 // Nikon
  'arw', 'srf', 'sr2',          // Sony
  'raf',                        // Fujifilm
  'orf',                        // Olympus / OM System
  'rw2',                        // Panasonic
  'pef', 'ptx',                 // Pentax
  'srw',                        // Samsung
  'dng',                        // Adobe／Google／Leica／Ricoh
  'raw', 'rwl',                 // Leica
  'x3f',                        // Sigma
  '3fr', 'fff',                 // Hasselblad
  'iiq',                        // Phase One
  'mos',                        // Leaf
  'mrw',                        // Minolta
  'erf',                        // Epson
  'kdc', 'dcr',                 // Kodak
  'gpr',                        // GoPro
];

/** 一般網頁圖片 ＋ 手機格式 ＋ 專業格式（TIFF/PSD 那類） */
export const PHOTO_EXTS = [
  'jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'bmp', 'avif',
  'heic', 'heif', 'heics', 'hif',
  'tif', 'tiff', 'psd', 'psb', 'jp2', 'jxl', 'exr', 'hdr', 'pbm', 'ppm', 'tga',
];

export const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'webm', 'ogv', '3gp', 'avi', 'mkv', 'hevc'];

const dot = (list: string[]) => list.map(e => '.' + e).join(',');

/** 圖片輸入框的 accept：所有照片格式 ＋ 所有 RAW */
export const RAW_ACCEPT = `image/*,${dot(PHOTO_EXTS)},${dot(RAW_EXTS)}`;
/** 圖片或影片都收的地方（拼圖的入口、換底、新增物件） */
export const MEDIA_ACCEPT = `image/*,video/*,${dot(PHOTO_EXTS)},${dot(RAW_EXTS)},${dot(VIDEO_EXTS)}`;

const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();

export const isRawFile = (f: File | string): boolean =>
  RAW_EXTS.includes(extOf(typeof f === 'string' ? f : f.name));

export const isVideoFileName = (f: File | string): boolean => {
  const n = typeof f === 'string' ? f : f.name;
  const t = typeof f === 'string' ? '' : (f.type || '');
  return t.startsWith('video/') || VIDEO_EXTS.includes(extOf(n));
};

/**
 * 瀏覽器自己就畫得出來的那幾種？
 * 是的話整個解碼流程都可以跳過（絕大多數使用者的 JPEG/PNG 走這條，零成本）。
 *
 * ⚠ HEIC 不算在內：Safari 讀得出來，但 Chrome／Android 讀不出來，
 *   而我們要的是「兩邊行為一樣」。真的讀得出來時，processImageFile
 *   第一步的原生偵測還是會直接放行，不會白做工。
 */
export const isPlainWebImage = (f: File): boolean => {
  const e = extOf(f.name);
  const t = (f.type || '').toLowerCase();
  if (['jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(e)) return true;
  return /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(t);
};
