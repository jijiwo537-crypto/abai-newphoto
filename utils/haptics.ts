/* 觸覺回饋（對應 ios/App/App/HapticsPlugin.swift）。網頁版什麼都不做。
 *
 * 一套分層的手感，越重要的事震得越明顯，平常的操作只有很輕的觸感：
 *   detent       滑桿、轉盤上的一般刻度：很輕、很脆（像精密旋鈕的段落感）
 *   detentMajor  主刻度、回到 0、回到預設值：明顯一點的一下
 *   edge         拉到頭：硬硬的一下（碰到擋塊）
 *   tick         切換選項、選濾鏡、開關（系統的「選取」手感）
 *   press        一般按鈕：柔和的輕觸
 *   snap         物件吸附到對齊線
 *   shutter      快門：俐落的一下＋很輕的回彈（機械快門感）
 *   success | error  存檔完成／失敗
 * 呼叫是「射後不理」：不等原生回覆，不會拖慢手勢。 */
import { crossedZero } from './hapticDetents';
import { isNative } from './native';
import { nativePlugin } from './nativeBridge';

type Kind = 'tick' | 'detent' | 'detentMajor' | 'press' | 'shutter' | 'snap' | 'edge' | 'edgeSoft' | 'success' | 'error';
let api: any = null;
let loading = false;

function load() {
  if (api || loading || !isNative()) return;
  loading = true;
  void (async () => {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      api = registerPlugin('ABAIHaptics');
      api.prepare?.();
    } catch { api = null; }
  })();
}

/** App 啟動時呼叫一次，先把 Taptic Engine 叫醒 */
export function prepareHaptics() { load(); installClickHaptics(); }

/* 同一種回饋太密就略過（快速拖動時不會變成一串嗡嗡聲）。刻度最短 28ms 一下，其他 40ms */
const last: Partial<Record<Kind, number>> = {};
const GAP: Partial<Record<Kind, number>> = { detent: 28, detentMajor: 34 };
export function haptic(kind: Kind) {
  if (!isNative()) return;
  if (!api) { load(); return; }
  const now = performance.now();
  if (now - (last[kind] ?? -1e9) < (GAP[kind] ?? 40)) return;
  last[kind] = now;
  try {
    switch (kind) {
      case 'tick': api.selection(); break;
      case 'detent': api.impact({ style: 'light', intensity: 0.42 }); break;
      case 'detentMajor': api.impact({ style: 'rigid', intensity: 0.62 }); break;
      case 'press': api.impact({ style: 'soft', intensity: 0.55 }); break;
      case 'shutter': api.shutter(); break;
      case 'snap': api.impact({ style: 'light', intensity: 0.7 }); break;
      case 'edge': api.impact({ style: 'rigid', intensity: 0.85 }); break;
      // 濾鏡、特效、調節拉到頭：柔和、有質感的一下（不是硬硬的擋塊）
      case 'edgeSoft': api.impact({ style: 'soft', intensity: 0.62 }); break;
      default: api.notify({ type: kind === 'success' ? 'success' : 'error' });
    }
  } catch { /* 沒有就算了 */ }
}

/** 滑桿用（App 裡）：全部跟「編輯 → 濾鏡」那根強度滑桿同一套手感
 *  ‧ 0 在中間的雙向滑桿（調節那種 -100～100）：慢慢經過 0 明顯一下；手指很快掃過去不震
 *  ‧ 拉到頭（最小、最大都算）：柔和、有質感的一下
 *  ‧ 中間其他位置不震（不再有一段一段的細刻度） */
/* 滑得很快時「經過 0」不震：手指只是快速掃過，不是想停在 0。
   速度＝這一次移動了全長的幾成 ÷ 經過的時間；超過「0.5 秒掃完全長」就算快 */
let lastMove = 0;
export function sliderSlow(prev: number, next: number, min: number, max: number) {
  const now = performance.now(), dt = Math.max(1, Math.min(200, now - lastMove));
  lastMove = now;
  return Math.abs(next - prev) / Math.max(1e-9, max - min) / dt < 1 / 500;
}
let handledAt = -1;
/** 有自己震動邏輯的滑桿呼叫這個（同一個事件裡全域那套就不再重複震） */
export function markSliderHandled() { handledAt = performance.now(); }
export function sliderHaptic(prev: number, next: number, min: number, max: number) {
  markSliderHandled();
  if (!isNative() || prev === next || !(max > min) || !Number.isFinite(prev) || !Number.isFinite(next)) return;
  const slow = sliderSlow(prev, next, min, max);
  if (min < 0 && max > 0 && crossedZero(prev, next) && slow) haptic('detentMajor');
  if ((next >= max && prev < max) || (next <= min && prev > min)) haptic('edgeSoft');
}

/* 每根滑桿「上一個值」：全域那套靠它判斷有沒有經過 0、是不是剛拉到頭。
   手機上滑桿是 utils/sliderTouch 用程式拖的，它改值之前先呼叫 noteRangeValue 記下舊值 */
const rangePrev = new WeakMap<HTMLInputElement, number>();
export function noteRangeValue(el: HTMLInputElement) { rangePrev.set(el, parseFloat(el.value)); }

/** 刻度轉盤用（相機的曝光、白平衡）：跟編輯頁「構圖角度」轉盤同一種手感 —— 每一格一下柔和、乾淨的輕觸 */
export function dialHaptic(_index: number, _count: number, _major: boolean) {
  if (!isNative()) return;
  haptic('press');
}

/* App 裡的開關、分頁、選項：點下去就有「選取」的觸感。
   靠屬性自動判斷（aria-pressed、role=tab／switch／radio，或寫了 data-haptic），不必每顆按鈕各自呼叫 */
let clickHapticsInstalled = false;
export function installClickHaptics() {
  if (clickHapticsInstalled || !isNative()) return;
  clickHapticsInstalled = true;
  /* 沒有自己設計震動的滑桿（各工具裡直接用 <input type=range> 的）：全部套濾鏡滑桿那一套 ——
     慢慢經過 0 一下、拉到頭柔和的一下。
     掛在 window 的冒泡階段：React 的處理先跑完，有自己震動的滑桿已經標記過，這裡就跳過 */
  const grab = (e: Event) => {
    const el = e.target as HTMLInputElement | null;
    if (el && el.tagName === 'INPUT' && el.type === 'range') noteRangeValue(el);
  };
  window.addEventListener('pointerdown', grab, true);
  window.addEventListener('focusin', grab, true);
  window.addEventListener('input', e => {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'range' || el.dataset.haptic === 'none') return;
    const next = parseFloat(el.value), prev = rangePrev.get(el);
    rangePrev.set(el, next);
    if (performance.now() - handledAt < 8) return;   // 這個滑桿自己震過了
    if (prev === undefined) return;
    const min = parseFloat(el.min || '0'), max = parseFloat(el.max || '100');
    sliderHaptic(prev, next, min, max);
  });
  document.addEventListener('click', e => {
    const el = (e.target as Element | null)?.closest?.('[data-haptic],[aria-pressed],[role="tab"],[role="switch"],[role="radio"],[role="menuitemradio"]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    const k = el.getAttribute('data-haptic');
    if (k === 'none') return;
    haptic(k === 'press' || k === 'detentMajor' || k === 'shutter' ? k : 'tick');
  }, true);
}

/** 對齊線：多出一條新的線（剛吸上去）時輕震一下 */
export function snapHaptic(prevCount: number, nextCount: number) {
  if (nextCount > prevCount) haptic('snap');
}

void nativePlugin; // 讓打包工具知道這支跟 nativeBridge 一起載入
