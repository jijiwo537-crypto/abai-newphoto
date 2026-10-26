/** 從 IndexedDB 拿出來的 Blob 先複製進記憶體再給網址用。
 *  iOS Safari 的 IndexedDB Blob 第一次讀得到，之後再讀常常失敗（WebKitBlobResource error），
 *  編輯器第一次載入沒事，但人像、仿色等之後才去讀同一個網址就會整張空白。
 *  複製一份之後跟資料庫就沒有關係了。讀不到時退回原本那個 Blob。 */
export const memBlob = async (b: Blob): Promise<Blob> => {
  try { return new Blob([await b.arrayBuffer()], { type: b.type }); } catch { return b; }
};
