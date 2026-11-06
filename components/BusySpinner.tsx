/* 等待中的轉圈＋小字（點陣、仿色共用同一款）：
   小圈在正中間，下面一行小字（帶一點陰影，蓋在亮的照片上也看得到），字後面的點 1→2→3→1→2→3 循環（點的位置先留好，字不會左右晃）。 */
import React, { useEffect, useState } from 'react';

const DOT_STEPS = [1, 2, 3];

/** texts 給好幾句的話：點點跑完兩輪（2.4 秒）換下一句，輪流顯示 */
/** hold：最後一句出現之後就停在那一句，不再從頭輪 */
export function LoadingText({ text, texts, hold }: { text: string; texts?: string[]; hold?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI(v => v + 1), 400); return () => clearInterval(id); }, []);
  const list = texts && texts.length ? texts : [text];
  const step = Math.floor(i / (DOT_STEPS.length * 2));
  const cur = list[hold ? Math.min(step, list.length - 1) : step % list.length];
  return (
    <p className="text-[11px] tracking-[0.1em] text-white/60 whitespace-nowrap" style={{ textShadow: '0 1px 3px rgba(0,0,0,.7)' }} data-loading-text>
      <span className="invisible">...</span>{cur}<span className="inline-block w-[1.2em] text-left">{'.'.repeat(DOT_STEPS[i % DOT_STEPS.length])}</span>
    </p>
  );
}

export function BusySpinner({ text, texts, hold }: { text: string; texts?: string[]; hold?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.45))' }}>
      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      <LoadingText text={text} texts={texts} hold={hold} />
    </div>
  );
}
