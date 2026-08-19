/** @type {import('tailwindcss').Config} */
/* 這一份是從 index.html 裡原本那段 CDN 的 tailwind.config 原樣搬過來的，
   數值一個都沒有改 —— 換成建置時產生 CSS，畫面才會跟原本完全一樣。 */
export default {
  /* 手機上「手指離開了、發光還留著」的元凶：`hover:` 這類樣式在觸控裝置上
     一被觸發就會黏住，要等你點別的地方才消失。
     打開這個旗標之後，Tailwind 會把每一條 hover 樣式包進
     `@media (hover: hover)` —— 有滑鼠的裝置照舊，觸控裝置根本不套用。
     一行設定解決全站（135 處 hover 全部涵蓋），不必逐個元件去改。 */
  future: {
    hoverOnlyWhenSupported: true,
  },
  darkMode: 'class',
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#FFFFFF',
        'background-dark': '#000000',
        'gray-panel': '#1A1A1A',
        'gray-control': '#333333',
      },
      fontFamily: {
        /* 中文改用系統字型：iOS／macOS 是蘋方，Android 是思源黑體。
           原本從 Google Fonts 載 Noto Sans TC 要 420 個檔案（中文字太多，
           必須切成上百個子集），全部自己放的話光是上傳就不切實際，
           而且系統字型在各平台上本來就是最合適的中文顯示。 */
        sans: ['Inter', 'PingFang TC', 'Hiragino Sans CNS', 'Noto Sans TC',
               'Microsoft JhengHei', 'sans-serif'],
        serif: ['Playfair Display', 'serif'],
      },
      borderRadius: {
        camera: '12px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
  ],
};
