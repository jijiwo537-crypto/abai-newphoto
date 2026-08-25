import React, { useEffect, useState } from 'react';

/** 卡住多久之後才長出那顆出口鍵（毫秒） */
export const STUCK_MS = 6000;

/**
 * 「正在存檔／正在匯出／處理中」那種蓋滿整個畫面的一層，一定會蓋住返回鍵。
 *
 * 只要底下那件事有任何一步卡住 —— iOS 的 canvas.toBlob 不回來（不丟錯，
 * 那個 callback 就是不執行）、MediaRecorder 的 onstop 不觸發、編碼器被系統
 * 收走 —— 使用者就被關在那個畫面裡，連退回主頁都做不到。
 * 那就是「有時候返回鍵失靈」。
 *
 * 這顆鍵平常**不存在**：等超過 delayMs 才長出來。正常的導出兩三秒就結束，
 * 使用者根本看不到它，所以對正常流程一個像素都沒有影響；
 * 真的卡住的時候，它就是唯一的出口。
 *
 * 全 App 的忙碌畫面都掛這一顆，行為與外觀因此完全一致。
 */
export const StuckEscape: React.FC<{
  /** 按下去要做什麼 —— 一律是「把那個忙碌狀態收掉，回到可以操作的畫面」 */
  onEscape: () => void;
  label?: string;
  delayMs?: number;
  /**
   * 先把位置佔著（看不見、也點不到），時間到才顯形。
   *
   * 給「上面還有轉圈動畫」的那種畫面用：這顆鍵是後來才冒出來的，
   * 而外層是置中排列 —— 它一出現，上面那顆轉圈就會被往上頂一截，
   * 看起來像畫面自己抖了一下。位置先留著就完全不會位移。
   */
  reserveSpace?: boolean;
}> = ({ onEscape, label = '取消，回到編輯', delayMs = STUCK_MS, reserveSpace = false }) => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);
  if (!show && !reserveSpace) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onEscape(); }}
      aria-hidden={!show}
      className={`mt-8 px-6 h-10 rounded-full border border-white/25 text-white/80 text-[12px] font-bold tracking-[0.2em] active:scale-95 transition-transform${
        show ? '' : ' opacity-0 pointer-events-none'}`}
    >
      {label}
    </button>
  );
};
