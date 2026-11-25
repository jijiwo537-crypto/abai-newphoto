/* 橫向捲動列兩側的淡出（相機濾鏡列、構圖比例列）。
 * 只在「那一邊還有東西可以滑」時才淡：在最左邊時左側完全不淡，第一顆按鈕清清楚楚；往右滑一點，
 * 左側的淡出才跟著滑動距離慢慢長出來（最多 FADE px）。右側同理。
 * 漸層用多個色階（接近平滑曲線），不是兩點直線，尾端不會有一條明顯的分界。 */
const FADE = 36;
const stops = (side: 'l' | 'r') => {
  const v = side === 'l' ? 'var(--ef-l,0px)' : 'var(--ef-r,0px)';
  const at = (k: number) => side === 'l' ? `calc(${v} * ${k})` : `calc(100% - ${v} * ${k})`;
  return [[0, 0], [0.2, 0.04], [0.4, 0.16], [0.6, 0.38], [0.8, 0.7], [1, 1]] as const;
};
function maskOf(): string {
  const l = stops('l').map(([k, a]) => `rgba(0,0,0,${a}) calc(var(--ef-l,0px) * ${k})`).join(', ');
  const r = stops('r').slice().reverse().map(([k, a]) => `rgba(0,0,0,${a}) calc(100% - var(--ef-r,0px) * ${k})`).join(', ');
  return `linear-gradient(to right, ${l}, ${r})`;
}
const MASK = maskOf();

/** ref callback 用：掛上就開始跟著捲動更新，元素拿掉時自動停 */
export function edgeFadeRef(el: HTMLElement | null): void {
  if (!el || (el as any).__edgeFade) return;
  (el as any).__edgeFade = true;
  el.style.setProperty('-webkit-mask-image', MASK);
  el.style.setProperty('mask-image', MASK);
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.style.setProperty('--ef-l', `${Math.max(0, Math.min(FADE, el.scrollLeft))}px`);
    el.style.setProperty('--ef-r', `${Math.max(0, Math.min(FADE, max - el.scrollLeft))}px`);
  };
  update();
  el.addEventListener('scroll', update, { passive: true });
  try { new ResizeObserver(update).observe(el); } catch { /* 舊瀏覽器：只跟著捲動更新 */ }
}
