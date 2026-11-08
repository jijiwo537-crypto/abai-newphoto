/**
 * 原生外殼（Capacitor）的橋接。
 *
 * 這個檔案只有一條規矩：**網頁版跑起來，要跟沒有這個檔案時一模一樣。**
 * 所以每一個原生外掛都用 `await import(...)` 延遲載入 —— Vite 會把它們切成
 * 獨立的 chunk，瀏覽器永遠不會去下載，也就談不上影響。
 *
 * 唯一靜態引入的是 @capacitor/core。它在網頁裡只是一層很薄的空殼，
 * isNativePlatform() 直接回 false，不碰 DOM、不發請求、不註冊任何東西。
 */
import { Capacitor } from '@capacitor/core';

/**
 * 現在是不是跑在包好的 App 裡？
 *
 * 注意：**「加到主畫面」的 PWA 一樣回 false**。那個本質上還是 Safari，
 * 走的是網頁那條路 —— 這正是我們要的，不能讓現有使用者的行為變掉。
 */
/** 「加到主畫面」的網頁版（不是包好的 App）。那一版的 WebKit 有自己的視窗怪現象，
 *  幾個工具要額外補償；包好的 App 沒有這個現象，套了反而整個畫面往下移 */
export const isHomeScreenWebApp = (): boolean =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true && !isNative();

export const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/**
 * App 的自訂網址協定。第三方登入授權完，系統瀏覽器要靠它把使用者送回 App。
 * 這個字串必須同時對上三個地方，改一個就要改三個：
 *   ① capacitor.config.ts 的 appId
 *   ② iOS 專案 Info.plist 的 CFBundleURLSchemes
 *   ③ Supabase 後台 → Authentication → URL Configuration → Redirect URLs
 */
export const APP_SCHEME = 'com.abai.photo';

/**
 * App 啟動時做一次的原生設定。網頁環境會在第一行就回去，一個外掛都不會載。
 *
 * 狀態列：字設成白色，畫面延伸到狀態列和動態島後面，跟「加到主畫面」的版本一樣
 * （版面是照那一版調的；index.html 也讓 App 走 navigator.standalone 那條判斷）。
 * 另外裝上系統照片選擇器、觸覺回饋、照實際記憶體調整的照片快取預算。
 */
export async function setupNativeShell(): Promise<void> {
  if (!isNative()) return;
  /* 自動測試（只有 CI 用啟動參數打開時才會做事；不等下面任何一步） */
  (window as any).__abaiQA = (s: string) => { void import('./nativeQA').then(m => m.runNativeQA(s)).catch(e => ((window as any).__abaiQALog ||= []).push(`import failed ${String(e)}`)); };
  void import('./nativeQA').then(m => m.runNativeQA()).catch(e => ((window as any).__abaiQALog ||= []).push(`import failed ${String(e)}`));
  /* 原生功能：系統照片選擇器、觸覺回饋、照系統實際記憶體調整的照片快取預算 */
  try {
    const [{ installNativeFilePicker }, { prepareHaptics }, { watchNativeMemoryBudget }] = await Promise.all([
      import('./nativePhotos'), import('./haptics'), import('./nativeImage'),
    ]);
    installNativeFilePicker();
    prepareHaptics();
    /* iPhone 的網頁沒有 navigator.vibrate：App 裡接到原生的觸覺回饋，原本寫好的震動點就都會震 */
    const { haptic } = await import('./haptics');
    try {
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (pattern: number | number[]) => {
          const ms = Array.isArray(pattern) ? Math.max(0, ...pattern) : pattern;
          if (ms > 0) haptic(ms >= 30 ? 'snap' : 'press');
          return true;
        },
      });
    } catch { /* 改不了就算了 */ }
    void watchNativeMemoryBudget();
    /* 測試期的保險：這版 App 沒有包到原生外掛的話（打包時漏了步驟），直接講清楚，
       不要默默退回網頁的選照片和存檔，讓人以為是 bug */
    const { nativePlugin } = await import('./nativeBridge');
    if (!(await nativePlugin('NativePhotos'))) {
      setTimeout(() => alert('這個版本沒有包到 ABAI 的原生功能（系統相簿、直接存相簿等）。\n請在 Mac 上執行 ios/prepare-device.sh 重新打包後再裝一次。'), 1500);
    }
  } catch { /* 舊版 App 沒有這些外掛：照網頁的方式跑 */ }
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // Capacitor 的命名是以「背景」為準：Style.Dark ＝ 深色背景，所以字是白的。
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    /* 外掛沒裝、或這個平台不支援，就當作沒這回事 —— 不能因此讓 App 起不來 */
  }
}
