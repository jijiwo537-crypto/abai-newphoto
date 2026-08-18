
import './styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installSliderTouch } from './utils/sliderTouch';
import { setupNativeShell } from './utils/native';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/* 滑桿撐大的那一圈觸控範圍：只認拖曳，點擊照樣傳給底下的按鈕。
   裝在 document 上、只裝一次，跟任何元件的生命週期無關。 */
installSliderTouch();

/* 包成 App 時的原生設定（目前只有狀態列的字色）。
   網頁版在函式第一行就會回去，什麼都不會載、什麼都不會做。 */
void setupNativeShell();

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
