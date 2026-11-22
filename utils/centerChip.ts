/* 動畫頁上方「要調哪一個」那一列：選中的那顆自動捲到盡量正中間。
   用 ref callback 呼叫（每次畫都會叫到），只有選中的東西換了才捲。 */
const last = new WeakMap<HTMLElement, string>();
export const centerActiveChip = (el: HTMLElement | null, key: string | null | undefined) => {
  if (!el || !key || last.get(el) === key) return;
  const first = !last.has(el);
  last.set(el, key);
  requestAnimationFrame(() => {
    const b = el.querySelector<HTMLElement>(`[data-chip="${CSS.escape(key)}"]`);
    if (!b) return;
    const left = b.offsetLeft + b.offsetWidth / 2 - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, Math.min(el.scrollWidth - el.clientWidth, left)), behavior: first ? 'auto' : 'smooth' });
  });
};
