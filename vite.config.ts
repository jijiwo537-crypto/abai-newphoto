import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import { localizeUI } from './scripts/localize-ui';

/* 相機人臉磨皮用的 MediaPipe 執行檔（wasm）：放在自己網站的 mediapipe/ 底下，不連外部 CDN。
   開發時直接從 node_modules 送出去；建置時複製進輸出資料夾。 */
const mediapipeWasm = () => {
  const dir = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
  return {
    name: 'mediapipe-wasm',
    configureServer(server: any) {
      server.middlewares.use('/mediapipe', (req: any, res: any, next: any) => {
        const f = path.join(dir, path.basename((req.url || '').split('?')[0]));
        if (!fs.existsSync(f)) return next();
        res.setHeader('Content-Type', f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        fs.createReadStream(f).pipe(res);
      });
    },
    writeBundle(opts: any) {
      const out = path.join(opts.dir || path.resolve(__dirname, 'dist'), 'mediapipe');
      fs.mkdirSync(out, { recursive: true });
      for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(out, f));
    },
  };
};

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      // 用相對路徑輸出，網站放在網域根目錄或 GitHub Pages 的 /<repo>/ 子路徑都能正常載入
      base: './',
      // 第二個頁面 order.html：調整圖案／圖形排列順序用的小工具（給主人排好再把順序貼回來）
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            order: path.resolve(__dirname, 'order.html'),
          },
        },
      },
      plugins: [localizeUI(), react(), mediapipeWasm()],
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
