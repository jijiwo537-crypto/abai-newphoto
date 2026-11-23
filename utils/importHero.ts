/* 從主頁導入單張照片時的過場：相簿裡那張小縮圖，流暢地放大、飛到導入後照片在工具裡的位置。
 *
 * 1. 在相簿點下去的那一刻（begin）：在小縮圖的位置放一張一模一樣的「替身」（裁成正方形），
 *    馬上放大到畫面中央（完整比例）—— 讀原檔、開工具的那段時間它就停在那裡。
 * 2. 工具畫出來之後（land）：在畫面上找「照片本人」—— 看得到、夠大、長寬比跟這張照片一樣的那一個 <img>／<canvas>，
 *    等它位置穩定了，替身從中央飛過去、剛好疊在它上面，再把替身拿掉。
 *    找不到（例如工具把照片裁成別的比例）就讓替身淡掉，不會卡在畫面上。
 *
 * 只在主頁（畫面上沒有任何工具頁 .safe-top）、只選一張、而且是編輯、美顏、仿色的導入入口（input 帶 data-import-hero）時啟用。 */

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
let ghost: HTMLImageElement | null = null;
let ar = 1;
let staged: Promise<void> = Promise.resolve();
let token = 0;

const fitRect = (W: number, H: number, aspect: number, scale: number) => {
  let w = W * scale, h = w / aspect;
  if (h > H * 0.78) { h = H * 0.78; w = h * aspect; }
  return { left: (W - w) / 2, top: (H - h) / 2, width: w, height: h };
};

/** 這次導入要不要播：在主頁（沒有工具頁）才播 */
export const heroAllowed = () => !document.querySelector('.safe-top');

/** 相簿裡點下去的那一刻。rect：那一格的位置；src：那一格的縮圖 */
export function beginImportHero(rect: DOMRect, src: string, aspect?: number) {
  cancelImportHero();
  const my = ++token;
  const g = document.createElement('img');
  g.setAttribute('data-import-hero', '');
  g.alt = '';
  g.draggable = false;
  Object.assign(g.style, {
    position: 'fixed', zIndex: '2147483000', pointerEvents: 'none', objectFit: 'cover', margin: '0',
    left: '0px', top: '0px', width: '0px', height: '0px', transformOrigin: '0 0', willChange: 'transform, clip-path',
  } as CSSStyleDeclaration);
  document.body.appendChild(g);
  ghost = g;
  staged = (async () => {
    g.src = src;
    await g.decode().catch(() => {});
    if (my !== token) return;
    ar = aspect && isFinite(aspect) && aspect > 0 ? aspect : g.naturalWidth && g.naturalHeight ? g.naturalWidth / g.naturalHeight : 1;
    const W = window.innerWidth, H = window.innerHeight;
    const B = fitRect(W, H, ar, 0.88);
    /* 替身本身放在「中央」的位置與大小，用 transform 把它縮回那一格（再裁成正方形） */
    Object.assign(g.style, { left: `${B.left}px`, top: `${B.top}px`, width: `${B.width}px`, height: `${B.height}px`, objectFit: 'fill' });
    const k = Math.max(rect.width / B.width, rect.height / B.height);
    const ix = Math.max(0, (B.width - rect.width / k) / 2), iy = Math.max(0, (B.height - rect.height / k) / 2);
    const from = { transform: `translate(${rect.left - B.left - ix * k}px, ${rect.top - B.top - iy * k}px) scale(${k})`, clipPath: `inset(${iy}px ${ix}px)` };
    const to = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px)' };
    await g.animate([from, to], { duration: 440, easing: EASE, fill: 'forwards' }).finished.catch(() => {});
  })();
}

/** 這張圖在畫面上真正顯示的範圍（img 是 object-fit: contain 時，元素比圖大） */
function contentRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect();
  if (el instanceof HTMLImageElement && el.naturalWidth && getComputedStyle(el).objectFit === 'contain') {
    const a = el.naturalWidth / el.naturalHeight;
    let w = r.width, h = w / a;
    if (h > r.height) { h = r.height; w = h * a; }
    return new DOMRect(r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h);
  }
  return r;
}

function findTarget(): HTMLElement | null {
  const W = window.innerWidth, H = window.innerHeight;
  let best: HTMLElement | null = null, bestArea = 0;
  document.querySelectorAll<HTMLElement>('img, canvas').forEach(el => {
    if (el === ghost || el.closest('[data-abai-gallery]')) return;
    if (el instanceof HTMLImageElement && (!el.complete || !el.naturalWidth)) return;
    const r = contentRect(el);
    if (r.width < 40 || r.height < 40) return;
    const area = r.width * r.height;
    if (area < W * H * 0.12) return;
    if (r.right < 0 || r.bottom < 0 || r.left > W || r.top > H) return;
    if (Math.abs(r.width / r.height - ar) / ar > 0.06) return;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return;
    /* 看得到：中心點最上面那一層是它（或跟它同一塊） */
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit) || (el.parentElement && el.parentElement.contains(hit)))) return;
    if (area > bestArea) { bestArea = area; best = el; }
  });
  return best;
}

/** 工具畫出來了（或正在畫）：找到照片本人就飛過去 */
export async function landImportHero() {
  const g = ghost, my = token;
  if (!g) return;
  await staged;
  if (my !== token) return;
  const t0 = performance.now();
  let last: DOMRect | null = null, stable = 0, target: HTMLElement | null = null;
  while (performance.now() - t0 < 6000) {
    await new Promise(r => requestAnimationFrame(r));
    if (my !== token) return;
    const el = findTarget();
    if (!el) { stable = 0; last = null; continue; }
    const r = contentRect(el);
    if (last && Math.abs(r.left - last.left) < 1 && Math.abs(r.top - last.top) < 1 && Math.abs(r.width - last.width) < 1) stable++;
    else stable = 0;
    last = r;
    if (stable >= 4) { target = el; break; }
  }
  if (!target || !last) { fadeOut(g); return; }
  const B = g.getBoundingClientRect();
  const k = last.width / B.width;
  const prevOpacity = target.style.opacity;
  target.style.opacity = '0';
  await g.animate([{ transform: 'translate(0px, 0px) scale(1)' }, { transform: `translate(${last.left - B.left}px, ${last.top - B.top}px) scale(${k})` }],
    { duration: 460, easing: EASE, fill: 'forwards', composite: 'replace' }).finished.catch(() => {});
  target.style.opacity = prevOpacity;
  if (my !== token) return;
  fadeOut(g, 140);
}

function fadeOut(g: HTMLImageElement, ms = 220) {
  if (ghost === g) ghost = null;
  g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {}).finally(() => g.remove());
}

/** 取消（使用者按了取消、選了很多張、出錯） */
export function cancelImportHero() {
  token++;
  if (ghost) { const g = ghost; ghost = null; fadeOut(g, 160); }
}

export const importHeroActive = () => !!ghost;
