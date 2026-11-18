/* 「隨機音符」按鈕被點的回饋：跟散落圖形邊框的「隨機分佈」同一種 —— 框線亮一下再淡回去 */
export function scoreRandomFeedback(btn: HTMLElement) {
  btn.getAnimations().forEach(a => a.cancel());
  btn.animate([{ borderColor: '#ffffffb3' }, { borderColor: '#ffffff16' }], { duration: 260, easing: 'ease-out' });
}
/** 按鈕樣式（跟「隨機分佈」一樣：細框、灰字、整排寬） */
export const SCORE_RANDOM_BTN = 'w-full h-10 text-[13px] whitespace-nowrap border border-[#ffffff16] rounded-[8px] text-[#aaa] bg-transparent text-center';
