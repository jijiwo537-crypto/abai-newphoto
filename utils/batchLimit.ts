/** 批量編輯一次最多幾張（主頁導入、編輯器裡新增、相機相簿多選進編輯都照這個數）。
 *  編輯器裡所有會跟著張數變多的東西都有固定上限（解好的圖最多 8 張且總像素有上限、預熱 2 張、
 *  濾鏡縮圖最多留 15 張的份、存檔一次一張、成品頁只解看得到的那幾張），張數多只是清單變長，記憶體不會跟著長 */
export const BATCH_MAX = 50;
/** 裡面有 RAW 時最多幾張：RAW 每一張都要原生沖一次（沖的時候很吃記憶體、也慢），存檔時每張都要從 RAW 原尺寸再沖 */
export const BATCH_RAW_MAX = 10;
/** 這一批（含已經在編輯器裡的）最多可以有幾張 */
export const batchCap = (hasRaw: boolean) => (hasRaw ? BATCH_RAW_MAX : BATCH_MAX);
export const BATCH_RAW_NOTE = `含 RAW 照片時，一次最多 ${BATCH_RAW_MAX} 張`;
