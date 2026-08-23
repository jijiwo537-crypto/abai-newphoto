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

/** toBlob 等多久就放棄、改走另一條路（理由見下面） */
const TO_BLOB_TIMEOUT = 8000;

/**
 * 畫布 → blob 網址。轉不出來時退回 dataURL，至少不會整個失敗。
 *
 * ⚠ 那個看門狗不是「保險起見」，是真的會發生：畫布很大又碰上記憶體吃緊時，
 * iOS 的 toBlob 有機會**永遠不回來** —— 不丟錯，那個 callback 就是不執行。
 * 呼叫端於是一直等下去，畫面上是「正在存檔」轉圈轉到天荒地老，
 * 而那一層是蓋住返回鍵的 —— 這就是「有時候退不出去」。
 * 等超過就自己改走 toDataURL（同步的，一定有結果）；兩條都不行才回空字串，
 * 讓呼叫端把它當成失敗收掉，而不是卡在那裡。
 */
export function canvasToUrl(cvs: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<string> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (s: string) => { if (!settled) { settled = true; resolve(s); } };
    const fallback = () => { try { finish(cvs.toDataURL(type, quality)); } catch { finish(''); } };
    const timer = setTimeout(fallback, TO_BLOB_TIMEOUT);
    try {
      cvs.toBlob(
        b => {
          clearTimeout(timer);
          if (b) finish(URL.createObjectURL(b));
          else fallback();
        },
        type,
        quality,
      );
    } catch {
      clearTimeout(timer);
      fallback();
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
