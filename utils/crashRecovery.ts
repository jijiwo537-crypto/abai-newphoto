/* 被系統強制關掉（記憶體不夠時 iOS 會直接收掉網頁）之後，重新打開時自動接回剛才的編輯。
 *
 * 專業的修圖 App 都是這樣做：使用者不該因為系統把 App 收掉，就得自己找回剛才的作品。
 *   ‧ 待在工具裡時，每 2 秒記一下「我在哪個工具、現在幾點」（心跳）；
 *   ‧ 正常回到首頁時把記號清掉；
 *   ‧ 下次打開時如果記號還在、而且是剛剛（30 秒內）才停的 → 判定是被系統關掉的，
 *     直接用草稿接回去（草稿本來就會一直自動存）。
 *   ‧ 防止無限循環：2 分鐘內連續被關掉兩次，就不自動接回，改回原本「先問要不要繼續」，
 *     免得一打開就又因為同一個原因被關掉。
 * 包成 App 之後也一樣有效：Capacitor 在網頁被系統收掉時會自動重新載入（WebViewDelegationHandler）。 */

const KEY = 'abai-active-tool';
const CRASHES = 'abai-crash-log';
const BEAT_MS = 2000, FRESH_MS = 30_000, LOOP_WINDOW_MS = 120_000;

interface Beat { tool: string; at: number; since?: number }
const read = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 私密瀏覽等：沒有就算了 */ } };
const drop = (k: string) => { try { localStorage.removeItem(k); } catch { /* noop */ } };

let timer: ReturnType<typeof setInterval> | null = null;

/** 進到某個工具（每次切換工具都叫一次） */
export function markToolActive(tool: string) {
  const since = Date.now();
  const beat = () => write(KEY, { tool, at: Date.now(), since } satisfies Beat);
  beat();
  if (timer) clearInterval(timer);
  timer = setInterval(beat, BEAT_MS);
}

/** 正常回到首頁（不是被關掉） */
export function markToolInactive() {
  if (timer) { clearInterval(timer); timer = null; }
  drop(KEY);
}

/**
 * App 打開時問一次：上次是不是在某個工具裡被系統關掉的？
 * 回傳 { tool, since, auto }：since 是進入那個工具的時間；auto=true 表示可以直接自動接回，
 * false 表示最近連續被關，改成先問。
 * 回傳 null：上次是正常離開的。
 */
export function detectUnexpectedExit(): { tool: string; since: number; auto: boolean } | null {
  const beat = read<Beat>(KEY);
  drop(KEY);
  if (!beat || Date.now() - beat.at > FRESH_MS) return null;
  const now = Date.now();
  const log = (read<number[]>(CRASHES) || []).filter(t => now - t < LOOP_WINDOW_MS);
  log.push(now);
  write(CRASHES, log);
  return { tool: beat.tool, since: beat.since ?? 0, auto: log.length < 2 };
}
