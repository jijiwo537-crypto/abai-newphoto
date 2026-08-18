
import './styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installSliderTouch } from './utils/sliderTouch';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/* 滑桿撐大的那一圈觸控範圍：只認拖曳，點擊照樣傳給底下的按鈕。
   裝在 document 上、只裝一次，跟任何元件的生命週期無關。 */
installSliderTouch();

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
