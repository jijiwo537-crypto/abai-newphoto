/* 從主頁導入單張照片（編輯、美顏、仿色）時的過場：相簿裡那張小縮圖，一步到位地放大、飛到工具裡照片的位置。
 *
 * 只有兩個關鍵幀：起點＝整張照片完整地縮在相簿那一格裡（不裁切），終點＝照片在工具裡會停的位置。
 * 終點在點下去的那一刻就算得出來 —— 三個工具的照片框都是固定的版面（見 FRAME）：
 *   上緣＝狀態列下面 72、左右各 16、下面保留一段固定高度給工具列；照片照比例放進這個框、置中。
 * 所以一點下去就整段播完，中間不找、不修正。飛完就停在終點等工具畫好，
 * 照片本人的位置確定之後，放回照片本人、替身淡掉（兩張完全重疊，看不出切換）。
 *
 * 清楚：起點用相簿的縮圖，同時去要 1024 的大縮圖（很快），原檔讀好後再換成原生縮到 1600 的版本。
 * 不直接解原檔：原檔可能是 4800 萬畫素／HEIC，工具本身也在解同一張，兩份全尺寸同時在記憶體裡有被系統關掉的風險。
 * 安全：任何情況（找不到、取消、出錯）一定放回照片本人、恢復「匯入中」的轉圈；最多 12 秒一定收掉。
 * 只在主頁（畫面上沒有任何工具頁 .safe-top）、只選一張、而且是帶 data-import-hero 的導入入口時啟用。 */
import { nativePathOf } from './nativeBridge';
import { ms as motionMs } from './motionTimings';
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
/** 三個工具照片框下面保留的高度（工具列、分頁列；固定值，不含安全區域）—— 在 375／390／430 寬的手機上量過，都一樣 */
const FRAME: Record<string, number> = { edit: 262, beauty: 237, match: 216 };
/** 照片在工具裡會停的位置（工具頁從狀態列下面開始；照片框上緣 72、左右 16、下面保留 FRAME） */
function predict(kind: string, aspect: number): R {
  const W = window.innerWidth, H = window.innerHeight, s = safeInsets();
  const top = s.top + 72, boxW = W - 32, boxH = Math.max(120, H - top - (FRAME[kind] ?? 262));
  let w = boxW, h = w / aspect;
  if (h > boxH) { h = boxH; w = h * aspect; }
  return { x: (W - w) / 2, y: top + (boxH - h) / 2, w, h };
}

const layer = (src: string) => {
  const im = document.createElement('img');
  im.alt = ''; im.draggable = false; im.decoding = 'async'; im.src = src;
  /* contain：整張一定看得到，不會被裁（縮圖的比例跟照片記錄的比例萬一差一點點，也只是邊上多一點空白） */
  Object.assign(im.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', display: 'block' } as CSSStyleDeclaration);
  return im;
};
/** 換上更清楚的一層（解好才放上去、很快地淡入） */
/** 換成更準的畫面（例如 RAW：我們自己沖的無銳化版本），跟最後編輯器裡的一模一樣 */
export function upgradeImportHero(src: string) { if (ghost) upgrade(src, token); }
function upgrade(src: string, my: number) {
  const g = ghost;
  if (!g) return;
  const im = layer(src);
  im.style.opacity = '0';
  void im.decode().then(() => {
    if (my !== token || !g.isConnected) return;
    g.appendChild(im);
    im.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionMs('importUpgrade'), easing: 'ease-out', fill: 'forwards' });
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
    /* 夠大：跟預期的照片框差不多大（極寬的全景、極長的照片面積本來就小，不能用整個螢幕的比例來判斷） */
    if (end && area < end.w * end.h * 0.5) return;
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

/* ── 工具介面的進場 ──
 * 照片由替身飛進來；工具的其他介面（上方標題列、下方工具列、分頁）不再一口氣冒出來，而是分層進場：
 *   上方的列：從上方 10px 輕輕落下＋淡入；下方的各列：由上而下依序從下方 26px 升起＋淡入，每列錯開 45ms。
 * 只用 transform／opacity（GPU 合成），動畫用 fill: backwards（開始前就套第一格、結束後完全移除），
 * 播完之後元素身上沒有任何殘留的樣式，跟沒有動畫的版本 100% 一樣。
 * 照片本身（以及包著照片的那幾層）不動：用預期的照片框判斷哪一塊是照片，只動照片以外的介面。 */
const ENTER_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
let enterObs: MutationObserver | null = null, enterRoot: HTMLElement | null = null, enterT0 = 0;
const entered = new WeakSet<Element>();
function chromeBlocks(root: HTMLElement, E: R): HTMLElement[] {
  const out: HTMLElement[] = [];
  const cx = E.x + E.w / 2, cy = E.y + E.h / 2;
  const walk = (el: HTMLElement, depth: number) => {
    for (const c of Array.from(el.children) as HTMLElement[]) {
      if (c.hasAttribute('data-import-hero') || c.hasAttribute('data-import-spinner')) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) { if (depth < 8 && c.children.length) walk(c, depth + 1); continue; }
      const coversPhoto = r.left <= cx && r.right >= cx && r.top <= cy && r.bottom >= cy && r.width * r.height >= E.w * E.h * 0.5;
      if (coversPhoto) { if (depth < 8) walk(c, depth + 1); continue; }
      out.push(c);
    }
  };
  walk(root, 0);
  return out;
}
function runEnter(root: HTMLElement, E: R, late: boolean) {
  const blocks = chromeBlocks(root, E).filter(b => !entered.has(b));
  if (!blocks.length) return;
  const rects = blocks.map(b => b.getBoundingClientRect());
  const top: number[] = [], bottom: number[] = [];
  rects.forEach((r, i) => ((r.top + r.height / 2) < E.y ? top : bottom).push(i));
  bottom.sort((a, b) => rects[a].top - rects[b].top);
  const play = (el: HTMLElement, dy: number, delay: number, dur: number) => {
    entered.add(el);
    el.animate([{ opacity: 0, transform: `translate3d(0, ${dy}px, 0)` }, { opacity: 1, transform: 'translate3d(0, 0, 0)' }],
      { duration: dur, delay, easing: ENTER_EASE, fill: 'backwards' });
  };
  /* 晚一點才出現的介面（工具載入中途才長出來的列）：直接短短淡入升起，不再錯開 */
  top.forEach(i => play(blocks[i], -10, late ? 0 : 40, late ? 320 : 420));
  bottom.forEach((i, n) => play(blocks[i], 26, late ? 0 : 90 + Math.min(n, 6) * 45, late ? 360 : 520));
}
function startEnter(E: R) {
  stopEnter();
  const check = () => {
    const root = document.querySelector<HTMLElement>('.safe-top');
    if (!root) return;
    const now = performance.now();
    if (root !== enterRoot) { enterRoot = root; enterT0 = now; runEnter(root, E, false); return; }
    /* 進場開始後 1.2 秒內新長出來的介面也接著進場；之後就不再管，維持原樣 */
    if (now - enterT0 < 1200) runEnter(root, E, true); else stopEnter();
  };
  /* MutationObserver 在 React 寫進畫面之後、瀏覽器畫出來之前就會跑：第一格就是動畫的起點，不會先閃一下完整介面 */
  enterObs = new MutationObserver(check);
  enterObs.observe(document.body, { childList: true, subtree: true });
  check();
}
function stopEnter() { enterObs?.disconnect(); enterObs = null; enterRoot = null; }

/** 終點（替身停在這裡等工具畫好） */
let end: R | null = null;

/** 相簿裡點下去的那一刻。kind：哪一個工具；rect：那一格的位置；src：那一格的縮圖；aspect：照片的寬÷高；big：拿大縮圖的函式 */
export function beginImportHero(kind: string | undefined, rect: DOMRect, src: string, aspect?: number, big?: () => Promise<string | null>) {
  cancelImportHero();
  const my = ++token;
  ar = aspect && isFinite(aspect) && aspect > 0 ? aspect : 1;
  landing = false;
  const E = predict(kind ?? 'edit', ar);
  end = E;
  /* 現在已經有工具頁（不在主頁）不播：heroAllowed 已經擋掉，這裡只在主頁開始 */
  startEnter(E);
  const g = document.createElement('div');
  g.setAttribute('data-import-hero', '');
  /* 替身本身就是終點的大小與位置；起點用 transform 把它縮回那一格、再裁成那一格的正方形 */
  Object.assign(g.style, {
    position: 'fixed', zIndex: '2147483000', pointerEvents: 'none', overflow: 'hidden', margin: '0',
    left: `${E.x}px`, top: `${E.y}px`, width: `${E.w}px`, height: `${E.h}px`, transformOrigin: '0 0', willChange: 'transform',
  } as CSSStyleDeclaration);
  g.appendChild(layer(src));
  document.body.appendChild(g);
  ghost = g;
  document.documentElement.setAttribute('data-import-hero', '');
  window.clearTimeout(failsafe);
  failsafe = window.setTimeout(() => cancelImportHero(), 12000);
  if (big) void big().then(u => { if (u && my === token) upgrade(u, my); });
  /* 起點：整張照片完整地縮在那一格裡（不裁切），終點：照片在工具裡的位置。兩個關鍵幀，一段播完 */
  const C = rect;
  const k = Math.min(C.width / E.w, C.height / E.h);
  const sx = C.left + (C.width - E.w * k) / 2, sy = C.top + (C.height - E.h * k) / 2;
  g.animate([
    { transform: `translate(${sx - E.x}px, ${sy - E.y}px) scale(${k})` },
    { transform: 'translate(0px, 0px) scale(1)' },
  ], { duration: motionMs('importFly'), easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' });
  watch(my);
}

/** 飛完就停在終點：等工具把照片畫好、位置穩定，放回照片本人、替身淡掉。替身這段完全不動 */
function watch(my: number) {
  const g = ghost!;
  let target: HTMLElement | null = null, tr: R | null = null, stable = 0;
  const t0 = performance.now();
  const step = (now: number) => {
    if (my !== token || !g.isConnected) return;
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
        /* 照片本人的位置連續約 0.3 秒都沒動：交接（兩張重疊，替身淡掉） */
        if (stable >= 18 && now - t0 > motionMs('importFly')) { unhide(); finish(g, motionMs('importLand')); return; }
      }
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
  stopEnter();
  landing = false;
  cancelAnimationFrame(raf);
  unhide();
  if (ghost) finish(ghost, 160);
  else { window.clearTimeout(failsafe); document.documentElement.removeAttribute('data-import-hero'); }
}

export const importHeroActive = () => !!ghost;
