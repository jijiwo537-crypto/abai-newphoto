export const clampHomeScroll = (position: number, extent: number) => Math.max(0, Math.min(Math.max(0, extent), position));

/** Home-only kinetic scrolling. Never hands vertical overshoot to iOS rubber-banding. */
export function installHomeScroll(el: HTMLElement) {
  let x = 0, y = 0, at = 0, velocity = 0, frame = 0;
  let axis: 'x' | 'y' | null = null;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; velocity = 0; };
  const start = (e: TouchEvent) => {
    stop(); axis = null;
    if (e.touches.length !== 1) return;
    x = e.touches[0].clientX; y = e.touches[0].clientY; at = performance.now();
  };
  const move = (e: TouchEvent) => {
    if (e.touches.length !== 1) { stop(); return; }
    const point = e.touches[0], now = performance.now();
    const dx = point.clientX - x, dy = point.clientY - y;
    axis ||= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis === 'y' && e.cancelable) {
      e.preventDefault();
      const old = el.scrollTop;
      el.scrollTop = clampHomeScroll(old - dy, el.scrollHeight - el.clientHeight);
      const dt = Math.max(8, now - at);
      velocity = (el.scrollTop - old) / dt;
    }
    x = point.clientX; y = point.clientY; at = now;
  };
  const end = () => {
    if (axis !== 'y' || performance.now() - at > 100 || Math.abs(velocity) < .02) { stop(); return; }
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - previous); previous = now;
      const raw = el.scrollTop + velocity * dt;
      const next = clampHomeScroll(raw, el.scrollHeight - el.clientHeight);
      el.scrollTop = next;
      velocity *= Math.exp(-dt / 260);
      if (next !== raw || Math.abs(velocity) < .02) { stop(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: false });
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', stop, { passive: true });
  el.addEventListener('wheel', stop, { passive: true });
  const destroy = () => {
    stop();
    el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move);
    el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', stop); el.removeEventListener('wheel', stop);
  };
  return { stop, destroy };
}
