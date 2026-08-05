/**
 * 成品圖一律用 blob 網址，不要用 dataURL。
 *
 * dataURL 是把整張 PNG 翻譯成一長串 base64 文字，翻譯本身還會膨脹約 33%，
 * 而且那串文字整份留在記憶體裡。一張 4000×3000 的無損 PNG 大約 20MB，
 * 批次導出十張就是 200MB —— 手機瀏覽器會直接把分頁殺掉。
 *
 * blob 網址存的是同一份二進位資料（同一張無損 PNG，位元組完全一樣），
 * 程式手上只拿到一個幾十位元組的參照。畫質零影響，記憶體省超過 99%。
 * 唯一的代價是用完要記得 revoke，所以這裡把回收也一起包好。
 */

/** 畫布 → blob 網址。轉不出來時退回 dataURL，至少不會整個失敗。 */
export function canvasToUrl(cvs: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<string> {
  return new Promise(resolve => {
    try {
      cvs.toBlob(
        b => resolve(b ? URL.createObjectURL(b) : cvs.toDataURL(type, quality)),
        type,
        quality,
      );
    } catch {
      resolve(cvs.toDataURL(type, quality));
    }
  });
}

export const isBlobUrl = (s: string | null | undefined): boolean => !!s && s.startsWith('blob:');

/** 只回收 blob 網址；dataURL 與一般網址原樣放過 */
export function revokeUrl(s: string | null | undefined): void {
  if (isBlobUrl(s)) {
    try { URL.revokeObjectURL(s!); } catch { /* 已經收過就算了 */ }
  }
}

export function revokeUrls(list: (string | null | undefined)[] | null | undefined): void {
  if (list) list.forEach(revokeUrl);
}
