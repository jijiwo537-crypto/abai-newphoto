/* 橫向捲動列兩側的淡出（相機濾鏡列、構圖比例列）。
 * 只在「那一邊還有東西可以滑」時才淡：停在最左邊時左側完全不淡；往右滑，左側的淡出跟著滑動距離慢慢長出來（最多 FADE px）。
 * 漸層的形狀用平滑曲線（smootherstep）切成很多段、數字直接算好寫進去（不靠 CSS 變數）：
 * 起點、終點的斜率都是 0，看不到「漸層在這裡結束」的那條分界 */
const FADE = 56;
const N = 12;
const curve = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function maskFor(l: number, r: number): string {
  const parts: string[] = [];
  if (l > 0.5) for (let i = 0; i <= N; i++) parts.push(`rgba(0,0,0,${curve(i / N).toFixed(4)}) ${(l * i / N).toFixed(2)}px`);
  else parts.push('#000 0px');
  if (r > 0.5) for (let i = N; i >= 0; i--) parts.push(`rgba(0,0,0,${curve(i / N).toFixed(4)}) calc(100% - ${(r * i / N).toFixed(2)}px)`);
  else parts.push('#000 100%');
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** ref callback 用：掛上就開始跟著捲動更新 */
export function edgeFadeRef(el: HTMLElement | null): void {
  if (!el || (el as any).__edgeFade) return;
  (el as any).__edgeFade = true;
  let last = '';
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    const l = Math.max(0, Math.min(FADE, el.scrollLeft)), r = Math.max(0, Math.min(FADE, max - el.scrollLeft));
    const key = `${Math.round(l)}|${Math.round(r)}`;
    if (key === last) return;
    last = key;
    const m = maskFor(Math.round(l), Math.round(r));
    el.style.setProperty('-webkit-mask-image', m);
    el.style.setProperty('mask-image', m);
  };
  update();
  el.addEventListener('scroll', update, { passive: true });
  try { new ResizeObserver(update).observe(el); } catch { /* 舊瀏覽器：只跟著捲動更新 */ }
}
