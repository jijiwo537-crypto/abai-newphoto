import React from 'react';
import { useSmoothSlider } from '../utils/smoothSlider';

/** 一根標準滑桿：包在 .slider-wrap 裡（跟其他滑桿一樣大的觸控範圍、
 *  拖動時頁面不會捲動），白點連續跟手，交給程式的值一幀一次、照 step 取整。 */
export function LiveRange({ value, min, max, step = 1, onValue, onCommit, className = 'premium-slider w-full', wrapClassName = '', ariaLabel, disabled, height = 16, onPointerDown }: {
  value: number; min: number; max: number; step?: number | string;
  onValue: (v: number) => void; onCommit?: () => void;
  className?: string; wrapClassName?: string; ariaLabel?: string; disabled?: boolean; height?: number;
  onPointerDown?: (e: React.PointerEvent<HTMLInputElement>) => void;
}) {
  const { shown, input, end } = useSmoothSlider(value, min, max, step, onValue, onCommit);
  return (
    <div className={`slider-wrap w-full ${wrapClassName}`} style={{ height }}>
      <input type="range" aria-label={ariaLabel} min={min} max={max} step="any" value={shown} disabled={disabled}
        onChange={e => input(Number(e.target.value))} onPointerDown={onPointerDown}
        onPointerUp={end} onPointerCancel={end} onTouchEnd={end} onKeyUp={end} onBlur={end}
        className={className} />
    </div>
  );
}
