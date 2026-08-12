/**
 * 頭貼。
 *
 * 只存在這台裝置上（localStorage），**不會上傳到雲端** —— 換手機、清瀏覽器
 * 資料就沒了，這是刻意的：頭貼是個人照片，不上傳就不會有隱私與儲存成本的問題。
 *
 * 存法：裁成正方形、縮到 AVATAR_PX、轉成 JPEG 的 data URL。
 * 一張大概 20～40KB，離 localStorage 的 5MB 上限很遠。
 * 每個帳號一把 key，換帳號登入不會看到別人的頭貼。
 */

/** 存起來的邊長。72px 的顯示尺寸 ×3 倍螢幕還有餘裕，放大看也不糊。 */
const AVATAR_PX = 256;
const KEY_PREFIX = 'abai.avatar.';

const keyOf = (accountId: string) => `${KEY_PREFIX}${accountId}`;

/** 讀這個帳號的頭貼，沒有就回 null */
export const loadAvatar = (accountId: string): string | null => {
  if (!accountId) return null;
  try { return localStorage.getItem(keyOf(accountId)); } catch { return null; }
};

export const removeAvatar = (accountId: string): void => {
  if (!accountId) return;
  try { localStorage.removeItem(keyOf(accountId)); } catch { /* 無痕模式會擋，忽略 */ }
};

/**
 * 把使用者選的檔案處理成頭貼並存起來，回傳 data URL。
 *
 * 中間那段是「置中裁成正方形」：取短邊當邊長，從長邊的中間切，
 * 所以直式、橫式照片都不會被壓扁，也不會偏一邊。
 */
export const saveAvatarFromFile = async (accountId: string, file: File): Promise<string> => {
  if (!accountId) throw new Error('沒有帳號');
  if (!file.type.startsWith('image/')) throw new Error('請選一張圖片');

  /* createImageBitmap 會照 EXIF 把手機拍的直式照片轉正；
     Safari 舊版沒有這個選項，所以退回 <img> 那條路。 */
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
  } catch {
    src = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('讀不到這張圖片')); };
      img.src = url;
    });
  }

  const sw = (src as any).width as number;
  const sh = (src as any).height as number;
  if (!sw || !sh) throw new Error('讀不到這張圖片');

  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2;
  const sy = (sh - side) / 2;

  const cvs = document.createElement('canvas');
  cvs.width = AVATAR_PX;
  cvs.height = AVATAR_PX;
  const ctx = cvs.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as any, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  if ('close' in src) (src as ImageBitmap).close();

  const dataUrl = cvs.toDataURL('image/jpeg', 0.88);
  try {
    localStorage.setItem(keyOf(accountId), dataUrl);
  } catch {
    throw new Error('這台裝置的儲存空間不足');
  }
  return dataUrl;
};
