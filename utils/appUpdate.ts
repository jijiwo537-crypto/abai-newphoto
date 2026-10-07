/* 加到主畫面的 iOS App 不會因為網站更新而重新載入：切回來時它只是從記憶體
   恢復原本那一版，GitHub Pages 的 index.html 也會被快取 10 分鐘。
   這裡在 App 回到前景（以及停在前景時每 5 分鐘）用 no-store 抓一次
   index.html，比對打包後主程式的檔名（內容一變，雜湊檔名就變）。
   有新版時只在「可以安全重新載入」（停在首頁、沒有編輯中的作品）才換版，
   不會把正在編輯的東西洗掉；不安全的時候先記著，回到首頁再換。 */
const scriptOf = (doc: Document) =>
  doc.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/"]')?.getAttribute('src') || '';

export function watchAppUpdates(canReload: () => boolean): { stop: () => void; retry: () => void } {
  const none = { stop: () => {}, retry: () => {} };
  if (!import.meta.env.PROD || typeof window === 'undefined') return none;
  const current = scriptOf(document);
  if (!current) return none;
  let pending = '', checking = false, last = 0;
  const reloadIfSafe = () => {
    if (!pending || !canReload()) return;
    // A cached page could come back as the old build again; never loop.
    try {
      const [target, at] = (sessionStorage.getItem('abai-update-target') || '').split('|');
      if (target === pending && Date.now() - Number(at) < 120_000) return;
      sessionStorage.setItem('abai-update-target', `${pending}|${Date.now()}`);
    } catch { /* storage unavailable: still reload once */ }
    location.reload();
  };
  const check = async () => {
    if (checking || pending || document.visibilityState !== 'visible') return;
    if (Date.now() - last < 30_000) { reloadIfSafe(); return; }
    checking = true; last = Date.now();
    try {
      const res = await fetch(`./index.html?update=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const latest = scriptOf(new DOMParser().parseFromString(await res.text(), 'text/html'));
        if (latest && latest !== current) pending = latest;
      }
    } catch { /* 離線就下次再看 */ }
    finally { checking = false; }
    reloadIfSafe();
  };
  const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  const timer = window.setInterval(onVisible, 5 * 60_000);
  void check();
  return {
    stop: () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.clearInterval(timer);
    },
    // 有新版、但當下不能換時，回到首頁再試一次。
    retry: reloadIfSafe,
  };
}
