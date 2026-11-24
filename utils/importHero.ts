/* 從主頁導入單張照片（編輯、美顏、仿色）時的過場：相簿裡那張小縮圖，一路流暢地放大、飛到工具裡照片的位置。
 *
 * 做法：替身是一塊「跟著目標走」的框，每一格都用彈簧（臨界阻尼，不會晃）往目標靠近：
 *   ‧ 一點下去就開始動：目標先是「預估的位置」，工具畫出來、找到照片本人之後，目標換成照片真正的位置 ——
 *     彈簧會順順地轉過去，不會停一下再跳。工具之後自己又調整了照片的大小或位置，替身也會一路跟過去。
 *   ‧ 框的長寬比從那一格的正方形慢慢變成照片的比例；裡面的圖是 object-fit: cover，所以是從裁切的正方形「展開」成整張。
 *   ‧ 照片本人一找到就先藏起來（畫面上只會有一張），等它的位置連續 0.4 秒都沒變、替身也追上了，
 *     才把照片本人放回來、替身用 0.2 秒淡掉 —— 交接時兩張完全重疊，看不出切換。
 *   ‧ 清楚：點下去的那一刻用相簿的縮圖，同時去要 1024 的大縮圖（很快），原檔讀好後再換成原生縮到 1600 的版本。
 *     不直接解原檔：原檔可能是 4800 萬畫素／HEIC，工具本身也在解同一張，兩份全尺寸同時在記憶體裡有被系統關掉的風險。
 *
 * 安全：任何情況（找不到、取消、出錯）一定放回照片本人、恢復「匯入中」的轉圈；最多 12 秒一定收掉。
 * 只在主頁（畫面上沒有任何工具頁 .safe-top）、只選一張、而且是帶 data-import-hero 的導入入口時啟用。 */
import { nativePathOf } from './nativeBridge';
import { nativeDownsample, nativeImage } from './nativeImage';

type R = { x: number; y: number; w: number; h: number };

let ghost: HTMLDivElement | null = null;
let ar = 1;
let token = 0;
let tempPath: string | null = null;
let raf = 0;
/* 藏起來的「照片本人」：任何情況都一定要放回來，不然工具裡的預覽會看不到 */
let hiddenEl: HTMLElement | null = null, hiddenPrev = '';
function unhide() { if (hiddenEl) { hiddenEl.style.opacity = hiddenPrev; hiddenEl = null; } }
let failsafe = 0;
/** 開始找照片本人了沒（原檔交給工具之後才開始找，之前畫面上的大圖都不是它） */
let landing = false;

/** 這次導入要不要播：在主頁（沒有工具頁）才播 */
export const heroAllowed = () => !document.querySelector('.safe-top');

function safeInsets() {
  const d = document.createElement('div');
  Object.assign(d.style, { position: 'fixed', visibility: 'hidden', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' });
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  const r = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  d.remove();
  return r;
}
/** 預估照片在工具裡會停的位置（工具畫出來之前先往這裡飛；之後換成真正的位置） */
function predict(aspect: number): R {
  const W = window.innerWidth, H = window.innerHeight, s = safeInsets();
  const top = s.top + 64, bottom = H - 300 - s.bottom;
  const boxW = W - 24, boxH = Math.max(160, bottom - top);
  let w = boxW, h = w / aspect;
  if (h > boxH) { h = boxH; w = h * aspect; }
  return { x: (W - w) / 2, y: top + (boxH - h) / 2, w, h };
}

const layer = (src: string) => {
  const im = document.createElement('img');
  im.alt = ''; im.draggable = false; im.decoding = 'async'; im.src = src;
  Object.assign(im.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', display: 'block' } as CSSStyleDeclaration);
  return im;
};
/** 換上更清楚的一層（解好才放上去、很快地淡入） */
function upgrade(src: string, my: number) {
  const g = ghost;
  if (!g) return;
  const im = layer(src);
  im.style.opacity = '0';
  void im.decode().then(() => {
    if (my !== token || !g.isConnected) return;
    g.appendChild(im);
    im.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out', fill: 'forwards' });
  }, () => {});
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
    if (ghost?.contains(el) || el.closest('[data-abai-gallery]')) return;
    if (el instanceof HTMLImageElement && (!el.complete || !el.naturalWidth)) return;
    const r = contentRect(el);
    if (r.width < 40 || r.height < 40) return;
    const area = r.width * r.height;
    if (area < W * H * 0.12) return;
    if (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) return;
    if (Math.abs(r.width / r.height - ar) / ar > 0.05) return;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') return;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit) || (el.parentElement && el.parentElement.contains(hit)))) return;
    if (area > bestArea) { bestArea = area; best = el; }
  });
  return best;
}
/** 藏的是「跟照片一樣大」的最外層那一塊（工具常常是好幾張 canvas 疊在一起） */
function outer(el: HTMLElement): HTMLElement {
  const r = el.getBoundingClientRect();
  let top = el;
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const q = n.getBoundingClientRect();
    if (Math.abs(q.left - r.left) > 1.5 || Math.abs(q.top - r.top) > 1.5 || Math.abs(q.width - r.width) > 1.5 || Math.abs(q.height - r.height) > 1.5) break;
    top = n;
  }
  return top;
}
function hide(el: HTMLElement | null) {
  const o = el ? outer(el) : null;
  if (hiddenEl === o) return;
  unhide();
  if (o) { hiddenEl = o; hiddenPrev = o.style.opacity; o.style.opacity = '0'; }
}

/** 相簿裡點下去的那一刻。rect：那一格的位置；src：那一格的縮圖；aspect：照片的寬÷高；big：拿大縮圖（短邊約 1024）的函式 */
export function beginImportHero(rect: DOMRect, src: string, aspect?: number, big?: () => Promise<string | null>) {
  cancelImportHero();
  const my = ++token;
  ar = aspect && isFinite(aspect) && aspect > 0 ? aspect : 1;
  landing = false;
  const g = document.createElement('div');
  g.setAttribute('data-import-hero', '');
  Object.assign(g.style, {
    position: 'fixed', zIndex: '2147483000', pointerEvents: 'none', overflow: 'hidden', margin: '0',
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, willChange: 'left, top, width, height',
  } as CSSStyleDeclaration);
  g.appendChild(layer(src));
  document.body.appendChild(g);
  ghost = g;
  document.documentElement.setAttribute('data-import-hero', '');
  window.clearTimeout(failsafe);
  failsafe = window.setTimeout(() => cancelImportHero(), 12000);
  if (big) void big().then(u => { if (u && my === token) upgrade(u, my); });
  run(my, { x: rect.left, y: rect.top, w: rect.width, h: rect.height });
}

/** 彈簧追目標：每一格往目標靠近（臨界阻尼：最快到、不會超過再彈回來） */
function run(my: number, start: R) {
  const g = ghost!;
  const cur = { ...start }, vel = { x: 0, y: 0, w: 0, h: 0 };
  const K = 120, D = 2 * Math.sqrt(K);
  let last = performance.now();
  let target: HTMLElement | null = null, tr: R | null = null, stable = 0;
  const t0 = performance.now();
  const step = (now: number) => {
    if (my !== token || !g.isConnected) return;
    const dt = Math.min(0.034, Math.max(0.001, (now - last) / 1000)); last = now;
    /* 目標：找到照片本人就跟著它；還沒有就先往預估的位置飛 */
    if (landing) {
      if (target && !target.isConnected) { target = null; hide(null); }
      const prev = hiddenEl; if (prev) prev.style.opacity = hiddenPrev;
      let el: HTMLElement | null = null;
      try { el = findTarget(); } catch { el = null; }
      if (prev) prev.style.opacity = '0';
      if (el) {
        if (el !== target) { target = el; stable = 0; }
        hide(el);
        const r = contentRect(el);
        const n = { x: r.left, y: r.top, w: r.width, h: r.height };
        if (tr && Math.abs(n.x - tr.x) < 0.5 && Math.abs(n.y - tr.y) < 0.5 && Math.abs(n.w - tr.w) < 0.5 && Math.abs(n.h - tr.h) < 0.5) stable++;
        else stable = 0;
        tr = n;
      }
    }
    const goal = tr ?? predict(ar);
    (['x', 'y', 'w', 'h'] as const).forEach(k => {
      const a = K * (goal[k] - cur[k]) - D * vel[k];
      vel[k] += a * dt; cur[k] += vel[k] * dt;
    });
    g.style.left = `${cur.x}px`; g.style.top = `${cur.y}px`; g.style.width = `${Math.max(1, cur.w)}px`; g.style.height = `${Math.max(1, cur.h)}px`;
    const close = tr && Math.abs(cur.x - tr.x) < 0.6 && Math.abs(cur.y - tr.y) < 0.6 && Math.abs(cur.w - tr.w) < 0.6 && Math.abs(cur.h - tr.h) < 0.6;
    /* 照片位置連續約 0.4 秒都沒動、替身也追上了：交接 */
    if (tr && close && stable >= 24) {
      Object.assign(g.style, { left: `${tr.x}px`, top: `${tr.y}px`, width: `${tr.w}px`, height: `${tr.h}px` });
      unhide();
      finish(g, 200);
      return;
    }
    if (now - t0 > 11000) { cancelImportHero(); return; }
    raf = requestAnimationFrame(step);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(step);
}

/** 原檔讀好了：換成原生縮到長邊 1600 的版本（不解原檔全尺寸） */
export function setImportHeroFile(file: File) {
  const my = token;
  if (!ghost) return;
  void (async () => {
    try {
      const path = nativePathOf(file);
      if (!path) return;
      const small = await nativeDownsample(path, 1600);
      if (!small || my !== token || !ghost) return;
      tempPath = small.path;
      upgrade(small.url, my);
    } catch { /* 換不了就維持縮圖 */ }
  })();
}

/** 原檔交給工具了：開始找照片本人、跟過去、交接 */
export function landImportHero() {
  if (ghost) landing = true;
}

function finish(g: HTMLDivElement, ms: number) {
  if (ghost === g) ghost = null;
  cancelAnimationFrame(raf);
  unhide();
  window.clearTimeout(failsafe);
  document.documentElement.removeAttribute('data-import-hero');
  const tmp = tempPath; tempPath = null;
  g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {}).finally(() => {
    g.remove();
    if (tmp) void nativeImage().then(p => p?.remove({ path: tmp })).catch(() => {});
  });
}

/** 取消（使用者按了取消、選了很多張、出錯、逾時） */
export function cancelImportHero() {
  token++;
  landing = false;
  cancelAnimationFrame(raf);
  unhide();
  if (ghost) finish(ghost, 160);
  else { window.clearTimeout(failsafe); document.documentElement.removeAttribute('data-import-hero'); }
}

export const importHeroActive = () => !!ghost;
