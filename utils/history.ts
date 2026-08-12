/**
 * 撤銷（上一步）歷史的共用規則。
 *
 * 目標有兩個，而且它們會互相拉扯：
 *   ① 可以一步一步退回「最剛開始的樣子」——不能編到一半就退不動了
 *   ② 不能因為留著歷史而吃光記憶體，導致卡頓或閃退
 *
 * ── 為什麼可以放心留這麼多格 ────────────────────────────────────
 * 三個工具存的都是「淺拷貝的參數快照」：物件與格子是 { ...o } 一層展開，
 * 圖片本身（data URL 字串、Image 物件）是**共用同一份**的參照，不會被複製。
 * 所以一格歷史的成本大約是幾百 bytes 到幾 KB，跟照片大小無關。
 *
 * 真正佔記憶體的是「歷史裡還參照著、但畫面上已經刪掉的圖片」——
 * 那是撤銷功能本來就要付的代價（不留著就退不回去），而且它的上限是
 * 使用者匯入過幾張照片，不是歷史有幾格。
 *
 * ── 上限怎麼訂 ──────────────────────────────────────────────────
 * 還是留一個很大的上限當保險，防止某個 bug 造成無限累積（例如某個
 * 動作每一幀都記一格）。正常操作幾乎不可能碰到。
 *
 * 萬一真的碰到上限，丟的是「第 1 格開始的最舊那幾格」，
 * **第 0 格（最剛開始的樣子）永遠留著** —— 這樣不管怎麼修剪，
 * 一路按上一步一定回得到原始狀態，目標 ① 不會被破壞。
 */
export const HISTORY_LIMIT = 500;

/**
 * 記一格歷史。
 *
 * @param history 目前的歷史陣列
 * @param index   目前停在第幾格（在中間時，後面那些「未來」會被蓋掉，這是撤銷的標準行為）
 * @param entry   要記進去的新快照
 * @returns 新的 { history, index }
 */
export function pushHistory<T>(
  history: T[],
  index: number,
  entry: T,
  limit: number = HISTORY_LIMIT,
): { history: T[]; index: number } {
  const kept = history.slice(0, index + 1);
  const next = [...kept, entry];

  if (next.length <= limit) return { history: next, index: next.length - 1 };

  /* 超出上限：保留第 0 格，從第 1 格開始丟最舊的。 */
  const overflow = next.length - limit;
  const trimmed = [next[0], ...next.slice(1 + overflow)];
  return { history: trimmed, index: trimmed.length - 1 };
}
