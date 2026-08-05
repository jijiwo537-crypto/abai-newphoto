/** @type {import('tailwindcss').Config} */
/* 這一份是從 index.html 裡原本那段 CDN 的 tailwind.config 原樣搬過來的，
   數值一個都沒有改 —— 換成建置時產生 CSS，畫面才會跟原本完全一樣。 */
export default {
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
