export const clampHomeScroll = (position: number, extent: number) => Math.max(0, Math.min(Math.max(0, extent), position));

/** Keep WebKit's native touch tracking and momentum; only block outward edge pulls. */
export function installHomeScroll(el: HTMLElement) {
  let x = 0, y = 0;
  let axis: 'x' | 'y' | null = null;
  const stop = () => { el.scrollTop = clampHomeScroll(el.scrollTop, el.scrollHeight - el.clientHeight); };
  const start = (e: TouchEvent) => {
    axis = null;
    if (e.touches.length !== 1) return;
    x = e.touches[0].clientX; y = e.touches[0].clientY;
  };
  const move = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const point = e.touches[0], dx = point.clientX - x, dy = point.clientY - y;
    if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
    axis ||= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    const extent = Math.max(0, el.scrollHeight - el.clientHeight);
    if (axis === 'y' && e.cancelable &&
      ((el.scrollTop <= 0 && dy > 0) || (el.scrollTop >= extent && dy < 0))) e.preventDefault();
    x = point.clientX; y = point.clientY;
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: false });
  const destroy = () => {
    el.removeEventListener('touchstart', start);
    el.removeEventListener('touchmove', move);
  };
  return { stop, destroy };
}
