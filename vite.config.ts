import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      // 用相對路徑輸出，網站放在網域根目錄或 GitHub Pages 的 /<repo>/ 子路徑都能正常載入
      base: './',
      plugins: [react()],
      /* libraw-wasm 自己會開一個 module worker（new Worker(new URL('./worker.js', import.meta.url))）。
         Vite 的依賴預先打包會把那支 worker 的路徑弄丟，開發伺服器會一直
         「找不到 worker.js」然後整頁重載。排除掉就照原樣載入，
         正式建置本來就會正確切成獨立 chunk，不受影響。 */
      optimizeDeps: {
        exclude: ['libraw-wasm'],
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
