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
    /* 整個 WebView 不跟著手指回彈、不能整頁捲動：版面本來就是固定一頁，
       需要捲動的地方（首頁清單、面板）都是自己的捲動區塊。這樣才不會一拉就露出網頁感 */
    scrollEnabled: false,
    /* 長按圖片、連結不跳出 Safari 的預覽卡片 */
    allowsLinkPreview: false,
  },

  plugins: {
    StatusBar: {
      /* Capacitor 的命名以「背景」為準：DARK ＝ 深色背景，所以時間、電量是白字 */
      style: 'DARK',
      /* 畫面延伸到狀態列和動態島後面 —— 跟「加到主畫面」的版本一模一樣（那一版是
         black-translucent），整個版面也是照那個樣子調的。設成 false 的話，網頁會被往下擠，
         動態島那一排變成一條黑色色塊，底部的空間也會算錯。 */
      overlaysWebView: true,
    },
  },
};

export default config;
