/**
 * 介面過場動畫的時長（毫秒），集中在這裡。
 *
 * 測試網站網址加上 ?motion 會出現「動畫時長」面板（components/MotionTuner.tsx）：
 * 每一項可以拖滑桿調整、預覽，調整的值存在這台裝置（localStorage），App 立刻照新的值播；
 * 「複製設定」把調整過的值複製成一段文字，貼給開發者改成新的預設值。
 */
import { isNative } from './native';

export interface MotionItem {
  id: string;
  /** 分組（面板上的標題） */
  group: string;
  label: string;
  /** 在哪裡、怎麼操作看得到 */
  where: string;
  /** 預設時長（毫秒） */
  def: number;
  /** 預覽用的動作：move＝位移、scale＝縮放、fade＝淡入淡出、press＝按下 */
  kind: 'move' | 'scale' | 'fade' | 'press';
  easing: string;
}

const IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';
const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

export const MOTION_ITEMS: MotionItem[] = [
  { id: 'importFly', group: '導入照片', label: '照片飛進工具', where: '首頁 → 點「編輯／人像／仿色」→ 從相簿選一張一般照片（RAW 不播）', def: 460, kind: 'move', easing: IOS },
  { id: 'importUpgrade', group: '導入照片', label: '飛行中換成清楚的圖', where: '同上，飛的途中小縮圖換成大圖的淡入', def: 120, kind: 'fade', easing: 'ease-out' },
  { id: 'importLand', group: '導入照片', label: '落地後替身淡出', where: '同上，照片停在工具裡之後替身消失', def: 200, kind: 'fade', easing: 'ease-out' },

  { id: 'pageBack', group: '換頁', label: '返回上一頁（往右滑走）', where: '任何工具按左上角返回、儲存畫面按「繼續編輯」（iOS 18 以後）', def: 560, kind: 'move', easing: IOS },

  { id: 'camGalleryOpen', group: '相機相簿', label: '點開大圖', where: '相機 → 左下角相簿 → 點一張照片', def: 440, kind: 'scale', easing: IOS },
  { id: 'camGalleryOpenFade', group: '相機相簿', label: '大圖打開後替身淡出', where: '同上，照片放大到定位後', def: 220, kind: 'fade', easing: 'ease-out' },
  { id: 'camGalleryClose', group: '相機相簿', label: '下拉關閉（縮回格子）', where: '大圖往下拉超過一段距離後放開', def: 420, kind: 'scale', easing: IOS },
  { id: 'camGalleryBounce', group: '相機相簿', label: '下拉沒關閉時回彈', where: '大圖往下拉一點點就放開', def: 320, kind: 'move', easing: IOS },

  { id: 'camGallerySheet', group: '相機', label: '相簿從下方滑上來', where: '相機 → 左下角最新照片', def: 560, kind: 'move', easing: 'cubic-bezier(0.15, 0.9, 0.25, 1)' },
  { id: 'camGallerySheetClose', group: '相機', label: '相簿滑下去（回到相機）', where: '相簿左上角關閉', def: 400, kind: 'move', easing: 'cubic-bezier(0.3, 0.55, 0.3, 1)' },
  { id: 'camEditorSlide', group: '相機', label: '從相簿進編輯（整頁滑上來／滑下去）', where: '相機相簿 → 大圖 → 編輯；編輯頁返回', def: 440, kind: 'move', easing: 'cubic-bezier(0.4,0,0.2,1)' },
  { id: 'camViewerFade', group: '相機', label: '大圖用按鈕關閉時淡出', where: '相機相簿 → 大圖 → 左上角返回', def: 300, kind: 'fade', easing: 'ease' },
  { id: 'camViewerButtons', group: '相機', label: '大圖上的按鈕淡入淡出', where: '相機相簿 → 大圖：打開後按鈕出現、往下拉時按鈕消失', def: 200, kind: 'fade', easing: 'ease' },
  { id: 'camFrameResize', group: '相機', label: '切換比例時觀景窗縮放', where: '相機 → 比例按鈕（例如 3:4 → 1:1）', def: 300, kind: 'scale', easing: 'cubic-bezier(0.2,0,0,1)' },
  { id: 'camRotate', group: '相機', label: '橫拿手機時圖示轉正', where: '相機 → 把手機轉成橫的', def: 460, kind: 'scale', easing: 'cubic-bezier(0.25,0.9,0.3,1)' },
  { id: 'camLastThumb', group: '相機', label: '拍完後左下角縮圖彈出', where: '相機 → 拍一張', def: 500, kind: 'scale', easing: 'cubic-bezier(0.2,0.8,0.2,1)' },
  { id: 'camControlsRow', group: '相機', label: '濾鏡列、特效列出現', where: '相機 → 下方濾鏡或特效按鈕', def: 200, kind: 'fade', easing: 'ease' },
  { id: 'shutterDown', group: '相機', label: '快門按下', where: '相機 → 按住快門', def: 120, kind: 'press', easing: 'cubic-bezier(0.2,0.8,0.2,1)' },
  { id: 'shutterUp', group: '相機', label: '快門放開', where: '相機 → 放開快門', def: 260, kind: 'press', easing: 'cubic-bezier(0.2,0.8,0.2,1)' },

  { id: 'homeBackdrop', group: '首頁', label: '彈出視窗的背景淡入', where: '首頁 → 登入、登出、刪除紀錄等視窗後面變暗的那層', def: 200, kind: 'fade', easing: 'ease-out' },
  { id: 'homeLoginSheet', group: '首頁', label: '登入面板從下方滑上來', where: '首頁 → 登入', def: 320, kind: 'move', easing: OUT },
  { id: 'homeAccountPage', group: '首頁', label: '帳號頁從右邊滑進來', where: '首頁 → 帳號', def: 320, kind: 'move', easing: OUT },
  { id: 'homeDialog', group: '首頁', label: '確認視窗彈出', where: '首頁 → 登出、刪除紀錄的確認視窗', def: 220, kind: 'scale', easing: OUT },
  { id: 'homeSettingsBackdrop', group: '首頁', label: '設定的背景淡入', where: '首頁 → 設定', def: 260, kind: 'fade', easing: 'ease-out' },
  { id: 'homeContact', group: '首頁', label: '聯絡我們視窗彈出', where: '首頁 → 設定 → 聯絡我們', def: 260, kind: 'scale', easing: OUT },
  { id: 'homeToast', group: '首頁', label: '「已複製」提示', where: '首頁 → 設定 → 聯絡我們 → 複製', def: 220, kind: 'move', easing: OUT },

  { id: 'editorPanel', group: '編輯器', label: 'HSL／曲線面板出現', where: '編輯 → 調整 → HSL 或 曲線', def: 260, kind: 'move', easing: 'cubic-bezier(.22,1,.36,1)' },
  { id: 'editorMerge', group: '編輯器', label: '合併按鈕的動畫', where: '編輯 → 套一個濾鏡或特效 → 右下角「合併」', def: 680, kind: 'press', easing: 'cubic-bezier(.22,1,.36,1)' },
];

const KEY = 'abai-motion-v1';
let cache: Record<string, number> | null = null;
const read = (): Record<string, number> => {
  if (cache) return cache;
  /* App（正式版）一律用預設值：調整只在測試網站上做 */
  if (isNative()) { cache = {}; return cache; }
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { cache = {}; }
  return cache!;
};
const DEF = Object.fromEntries(MOTION_ITEMS.map(m => [m.id, m.def]));

/** 這一項現在的時長（毫秒）：有調整過用調整的，沒有就是預設 */
export function ms(id: string): number {
  const v = read()[id];
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : (DEF[id] ?? 300);
}
/** 秒（framer-motion 用） */
export const sec = (id: string) => ms(id) / 1000;

export function setMotion(id: string, v: number | null) {
  const o = { ...read() };
  if (v == null || v === DEF[id]) delete o[id]; else o[id] = Math.round(v);
  cache = o;
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* 存不了就只在這一次有效 */ }
  applyCssMotion();
}
export function resetMotion() { cache = {}; try { localStorage.removeItem(KEY); } catch { /* 沒關係 */ } applyCssMotion(); }
export const motionOverrides = () => ({ ...read() });

/** 寫在 CSS 裡的那幾個（返回的滑走）用 CSS 變數 */
export function applyCssMotion() {
  try {
    const r = document.documentElement.style;
    r.setProperty('--vt-back-ms', `${ms('pageBack')}ms`);
    r.setProperty('--cam-rot-ms', `${ms('camRotate')}ms`);
  } catch { /* 沒有 DOM */ }
}

/* ── 相機相簿的升降曲線：照使用者給的參考影片逐格量出來的 ──
 * 上升：指數減速 p = 1 − e^(−12.5·t)（第一格就走 20%，0.18 秒到 90%，0.37 秒到 99%）
 * 下降：從靜止出發的臨界阻尼彈簧 p = 1 − (1 + 16.5·t)·e^(−16.5·t)（先加速、0.1 秒走一半、0.29 秒到 95%）
 * 這兩種曲線 cubic-bezier 畫不準，用 CSS linear() 逐點描（iOS 17.2 起支援）；更舊的系統用最接近的 cubic-bezier */
const linearSupported = (() => { try { return CSS.supports('transition-timing-function', 'linear(0, 1)'); } catch { return false; } })();
function linearEase(f: (t: number) => number, durS: number, n = 40) {
  const end = f(durS);
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) { const t = (i / n) * durS; pts.push((Math.min(1, f(t) / end)).toFixed(4)); }
  pts[n] = '1';
  return `linear(${pts.join(', ')})`;
}
/** 相簿上升的曲線（時長變了曲線形狀跟著縮放，起步一樣俐落） */
export function sheetOpenEase(): string {
  const d = ms('camGallerySheet') / 1000;
  if (!linearSupported) return 'cubic-bezier(0.15, 0.9, 0.25, 1)';
  const k = 12.5 * (0.56 / Math.max(0.05, d));
  return linearEase(t => 1 - Math.exp(-k * t), d);
}
/** 相簿下降的曲線 */
export function sheetCloseEase(): string {
  const d = ms('camGallerySheetClose') / 1000;
  if (!linearSupported) return 'cubic-bezier(0.3, 0.55, 0.3, 1)';
  const w = 16.5 * (0.4 / Math.max(0.05, d));
  return linearEase(t => 1 - (1 + w * t) * Math.exp(-w * t), d);
}
