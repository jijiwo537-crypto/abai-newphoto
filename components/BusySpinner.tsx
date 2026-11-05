/* 等待中的轉圈＋小字（點陣、仿色共用同一款）：
   小圈在正中間，下面一行小字（帶一點陰影，蓋在亮的照片上也看得到），字後面的點 1→2→3→1→2→3 循環（點的位置先留好，字不會左右晃）。 */
import React, { useEffect, useState } from 'react';

const DOT_STEPS = [1, 2, 3];

export function LoadingText({ text }: { text: string }) {
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI(v => (v + 1) % DOT_STEPS.length), 400); return () => clearInterval(id); }, []);
  return (
    <p className="text-[11px] tracking-[0.1em] text-white/60 whitespace-nowrap" style={{ textShadow: '0 1px 3px rgba(0,0,0,.7)' }} data-loading-text>
      <span className="invisible">...</span>{text}<span className="inline-block w-[1.2em] text-left">{'.'.repeat(DOT_STEPS[i])}</span>
    </p>
  );
}

export function BusySpinner({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.45))' }}>
      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      <LoadingText text={text} />
    </div>
  );
}
