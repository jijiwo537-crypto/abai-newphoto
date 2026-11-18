/* 「隨機音符」按鈕被點的回饋（創意拼圖、跨頁拼圖共用）：
 *   ‧ 左邊的圖示：跟創意拼圖「隨機圖案」那顆同一段動畫（轉一圈、中間縮一下）
 *   ‧ 按鈕外框：跟邊框貼圖第四個（散落星星邊框）同一種感覺 —— 外框亮起柔光，
 *     沿著外框冒出幾顆小星星閃一下就消失
 * 系統開了「減少動態效果」就都不做。 */
export function scoreRandomFeedback(btn: HTMLElement) {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const icon = btn.querySelector('svg');
  icon?.getAnimations().forEach(a => a.cancel());
  icon?.animate([
    { transform: 'rotate(0deg) scale(1)' },
    { transform: 'rotate(150deg) scale(.9)', offset: .4 },
    { transform: 'rotate(360deg) scale(1)' },
  ], { duration: 680, easing: 'cubic-bezier(.22,1,.36,1)' });
  // 外框柔光
  btn.getAnimations().filter(a => (a as any).id === 'score-glow').forEach(a => a.cancel());
  const glow = btn.animate([
    { boxShadow: '0 0 0 0 rgba(255,255,255,0), inset 0 0 0 0 rgba(255,255,255,0)', borderColor: 'rgba(255,255,255,.1)' },
    { boxShadow: '0 0 14px 2px rgba(255,255,255,.55), inset 0 0 10px 0 rgba(255,255,255,.35)', borderColor: 'rgba(255,255,255,.9)', offset: .25 },
    { boxShadow: '0 0 0 0 rgba(255,255,255,0), inset 0 0 0 0 rgba(255,255,255,0)', borderColor: 'rgba(255,255,255,.1)' },
  ], { duration: 820, easing: 'ease-out' });
  (glow as any).id = 'score-glow';
  // 沿著外框散落的小星星
  const r = btn.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;pointer-events:none;z-index:9999;overflow:visible`;
  document.body.appendChild(layer);
  const N = 10, per = 2 * (r.width + r.height);
  for (let i = 0; i < N; i++) {
    // 沿著周長平均放，再加一點點亂數
    let d = (i + .2 + Math.random() * .6) / N * per, x: number, y: number;
    if (d < r.width) { x = d; y = 0; } else if ((d -= r.width) < r.height) { x = r.width; y = d; } else if ((d -= r.height) < r.width) { x = r.width - d; y = r.height; } else { x = 0; y = r.height - (d - r.width); }
    const s = document.createElement('span');
    const size = 6 + Math.random() * 5;
    s.textContent = '✦';
    s.style.cssText = `position:absolute;left:${x}px;top:${y}px;font-size:${size}px;line-height:1;color:#fff;text-shadow:0 0 6px rgba(255,255,255,.9);transform:translate(-50%,-50%) scale(0);opacity:0`;
    layer.appendChild(s);
    const out = 4 + Math.random() * 6, dx = (x - r.width / 2) / (r.width / 2) * out, dy = (y - r.height / 2) / (r.height / 2) * out;
    s.animate([
      { transform: 'translate(-50%,-50%) scale(0) rotate(0deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * .5}px),calc(-50% + ${dy * .5}px)) scale(1) rotate(45deg)`, opacity: 1, offset: .35 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.2) rotate(90deg)`, opacity: 0 },
    ], { duration: 640 + Math.random() * 220, delay: Math.random() * 120, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 1100);
}
