import { useCallback, useEffect, useRef, useState } from 'react';

/* 滑桿「一格一格跳」與「跟不上手指」的共同解法。
 *
 * ① 白點只看自己的狀態：手指每動一下，這顆元件自己（很小）重畫一次，
 *    白點立刻跟上。以前白點的值綁在整個編輯器的 state 上，而編輯器每一幀
 *    才收一次值（甚至每個事件都整棵重畫）—— React 在兩次重畫之間會把白點
 *    拉回舊值，看起來就是一幀一幀地跳。
 * ② 白點連續移動（input 一律 step="any"），交給程式的值才照原本的 step 取整：
 *    只有 20～30 格的滑桿（間距、數量、循環間隔…）不再一格一格地跳，
 *    但存下來的值跟以前一樣是整數／原本的刻度。
 * ③ 交給程式的值一幀最多一次，而且只在「取整之後真的變了」才送；
 *    放開時把最後一個值送出去，白點也停在那個值上。 */
export const snapToStep = (raw: number, min: number, max: number, step: number | string | undefined) => {
  const s = typeof step === 'number' ? step : parseFloat(String(step ?? ''));
  const clamped = Math.min(max, Math.max(min, raw));
  if (!Number.isFinite(s) || s <= 0) return clamped;
  const dec = (String(s).split('.')[1] || '').length;
  return Math.min(max, Math.max(min, +(min + Math.round((clamped - min) / s) * s).toFixed(dec)));
};

export function useSmoothSlider(
  value: number, min: number, max: number, step: number | string | undefined,
  onValue: (v: number) => void, onCommit?: () => void,
) {
  const [shown, setShown] = useState(value);
  const dragging = useRef(false);
  const sent = useRef(value);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  const cb = useRef(onValue); cb.current = onValue;
  const commitCb = useRef(onCommit); commitCb.current = onCommit;
  // 外部改了值（復原、換物件）而且手指不在上面時才同步過來。
  useEffect(() => { if (!dragging.current) { setShown(value); sent.current = value; } }, [value]);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  const deliver = () => {
    frame.current = 0;
    const v = pending.current; pending.current = null;
    if (v !== null && v !== sent.current) { sent.current = v; cb.current(v); }
  };
  const input = useCallback((raw: number) => {
    if (!Number.isFinite(raw)) return;
    dragging.current = true;
    setShown(raw);
    pending.current = snapToStep(raw, min, max, step);
    if (!frame.current) frame.current = requestAnimationFrame(deliver);
  }, [min, max, step]);
  const end = useCallback(() => {
    if (!dragging.current && pending.current === null) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    deliver();
    dragging.current = false;
    setShown(sent.current);
    commitCb.current?.();
  }, []);
  return { shown, input, end };
}
