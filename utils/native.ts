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
 * 目前只做狀態列：把時間、電量那排字設成白色，因為我們的底是黑的。
 * 這裡刻意**不去動** overlaysWebView（也就是讓畫面延伸到瀏海底下）——
 * 那會讓 100vh 連狀態列一起算進去，版面會整個被撐開。之前在網頁版試過兩次
 * 都是這樣壞掉的，要做也得等能在模擬器上邊改邊看的時候再說。
 */
export async function setupNativeShell(): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // Capacitor 的命名是以「背景」為準：Style.Dark ＝ 深色背景，所以字是白的。
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* 外掛沒裝、或這個平台不支援，就當作沒這回事 —— 不能因此讓 App 起不來 */
  }
}
