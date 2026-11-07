/* 觸覺回饋（對應 ios/App/App/HapticsPlugin.swift）。網頁版什麼都不做。
 *   haptic('tick')     滑桿經過 0、切換選項
 *   haptic('snap')     物件吸附到對齊線
 *   haptic('edge')     滑桿拉到頭
 *   haptic('success' | 'error')  存檔完成／失敗
 * 呼叫是「射後不理」：不等原生回覆，不會拖慢手勢。 */
import { isNative } from './native';
import { nativePlugin } from './nativeBridge';

type Kind = 'tick' | 'snap' | 'edge' | 'success' | 'error';
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
export function prepareHaptics() { load(); }

/* 同一種回饋 40ms 內只震一次：滑桿快速來回經過 0 時不會連震 */
const last: Partial<Record<Kind, number>> = {};
export function haptic(kind: Kind) {
  if (!isNative()) return;
  if (!api) { load(); return; }
  const now = performance.now();
  if (now - (last[kind] ?? -1e9) < 40) return;
  last[kind] = now;
  try {
    if (kind === 'tick') api.selection();
    else if (kind === 'snap') api.impact({ style: 'light', intensity: 0.7 });
    else if (kind === 'edge') api.impact({ style: 'rigid', intensity: 0.8 });
    else api.notify({ type: kind === 'success' ? 'success' : 'error' });
  } catch { /* 沒有就算了 */ }
}

/** 滑桿用：值從上一格到這一格有沒有「經過 0」或「碰到頭」，有就震一下 */
export function sliderHaptic(prev: number, next: number, min: number, max: number) {
  if (!isNative() || prev === next) return;
  if (min < 0 && max > 0 && (prev < 0 ? next >= 0 : prev > 0 ? next <= 0 : false)) haptic('tick');
  else if ((next <= min && prev > min) || (next >= max && prev < max)) haptic('edge');
}

/** 對齊線：多出一條新的線（剛吸上去）時輕震一下 */
export function snapHaptic(prevCount: number, nextCount: number) {
  if (nextCount > prevCount) haptic('snap');
}

void nativePlugin; // 讓打包工具知道這支跟 nativeBridge 一起載入
