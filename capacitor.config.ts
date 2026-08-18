import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 原生外殼的設定。只有 `npx cap sync` 與 Xcode 會讀這個檔，
 * 網頁版的打包（vite build）完全不會碰到它。
 *
 * appId 就是 Bundle ID —— **上架之後永遠不能改**，改了等於是另一個 App。
 * 它同時也是自訂網址協定（com.abai.photo://），第三方登入靠它回到 App，
 * 所以要跟 utils/native.ts 的 APP_SCHEME 一致。
 */
const config: CapacitorConfig = {
  appId: 'com.abai.photo',
  appName: 'ABAI',
  webDir: 'dist',

  ios: {
    /* 別讓 iOS 自作主張加上捲動內距 —— 我們的版面自己處理安全區域 */
    contentInset: 'never',
    /* 網頁還沒畫出來、以及橡皮筋回彈時露出來的底色。跟 App 的黑底一致，
       不設的話會閃一下白色，很像當掉。 */
    backgroundColor: '#000000',
  },

  plugins: {
    StatusBar: {
      /* Capacitor 的命名以「背景」為準：DARK ＝ 深色背景，所以時間、電量是白字 */
      style: 'DARK',
      backgroundColor: '#000000',
      /* 刻意設 false：讓畫面延伸到瀏海底下會把 100vh 連狀態列一起算進去，
         版面會整個被撐開（網頁版試過兩次都是這樣壞的）。要做也要等能在
         模擬器上邊改邊看的時候。 */
      overlaysWebView: false,
    },
  },
};

export default config;
