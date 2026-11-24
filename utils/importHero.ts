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
 * 只用 transform 和 opacity（GPU 合成；元素原本的 transform，例如置中用的 -50%，接在後面保留），動畫用 fill: backwards（開始前就套第一格、結束後完全移除），
 * 播完之後元素身上沒有任何殘留的樣式，跟沒有動畫的版本 100% 一樣。
 * 照片本身（以及包著照片的那幾層）不動：用預期的照片框判斷哪一塊是照片，只動照片以外的介面。 */
const ENTER_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/* 進場的時機：工具頁一掛上來，介面就先停在動畫的第一格（看不見、暫停），
 * 等照片真正就定位（替身交接、或 RAW 沖好顯示出來）的那一刻才一起開播 —— 使用者看得到的時候動畫才開始。
 * 任何情況（取消、出錯、逾時）都一定開播（介面一定會出現），播完沒有殘留。 */
let enterObs: MutationObserver | null = null, enterRoot: HTMLElement | null = null, enterE: R | null = null;
/* ── 進場的效能 ──
 * 等開播的期間：元素用一段「停在第一格」的動畫藏著，同時先標 will-change，讓系統趁照片還在飛的時候
 * 就把這些介面各自畫成 GPU 圖層（最花時間的一步提前做完）。
 * 開播：停著的那段丟掉、同一格立刻建一段全新的動畫 —— 全新、從頭跑的 transform／opacity 動畫一定整段交給 GPU，
 * 主執行緒再忙（工具正在初始化、解碼大圖）也不掉格。播完把 will-change 還原，不留任何樣式。 */
type Job = { el: HTMLElement; k: Keyframe[]; opts: KeyframeAnimationOptions; held?: Animation; wc?: string };
function hold(j: Job) {
  j.held = j.el.animate(j.k, { ...j.opts, delay: 0, duration: 1 });
  j.held.pause();   // 停在第一格（fill backwards → 看不見）
  j.wc = j.el.style.willChange;
  j.el.style.willChange = 'transform, opacity';
}
function startJob(j: Job) {
  try {
    j.held?.cancel();
    if (j.wc === undefined) { j.wc = j.el.style.willChange; j.el.style.willChange = 'transform, opacity'; }
    const a = j.el.animate(j.k, j.opts);
    const restore = () => { if (j.el.style.willChange === 'transform, opacity') j.el.style.willChange = j.wc ?? ''; };
    a.finished.then(restore, restore);
  } catch { /* 元素已經不在 */ }
}
let landed = true, afterLand: Job[] = [];
let revealT = 0, revealed = true, pending: Job[] = [], enterFailsafe = 0, enterStopT = 0, rawRaf = 0;
const entered = new WeakSet<Element>();
/** 這一塊裡有沒有照片（夠大的 img／canvas）：有的話不能整塊動，要往裡面拆 */
function hasPhoto(el: HTMLElement, E: R): boolean {
  if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement) { const r = el.getBoundingClientRect(); return r.width * r.height >= E.w * E.h * 0.2; }
  for (const m of Array.from(el.querySelectorAll('img, canvas'))) { const r = m.getBoundingClientRect(); if (r.width * r.height >= E.w * E.h * 0.2) return true; }
  return false;
}
/** 現在看得到嗎（提示、狀態文字平常是透明或藏起來的：不能被進場動畫拉出來） */
function shownOpacity(el: HTMLElement): number {
  const st = getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none') return 0;
  return parseFloat(st.opacity) || 0;
}
/** 裡面有沒有自己設了圖層高度（z-index）的東西：
 *  整塊做透明度／位移動畫時，這一塊會暫時變成獨立圖層，裡面的 z-index 只在這一塊裡面比，
 *  原本應該蓋在照片上面的按鈕就會掉到照片底下。這種塊不整塊動，往裡面拆（有 z-index 的那個元素自己動，層級不變） */
function hasRaisedZ(el: HTMLElement, E: R): boolean {
  for (const d of Array.from(el.querySelectorAll<HTMLElement>('[class*="z-"],[style*="z-index"]'))) {
    const st = getComputedStyle(d);
    if (st.zIndex === 'auto' || st.position === 'static') continue;
    /* 只有疊在照片上的才有圖層問題（照片下方面板裡的 z-index 不影響跟照片的上下關係） */
    const q = d.getBoundingClientRect();
    if (q.right > E.x && q.left < E.x + E.w && q.bottom > E.y && q.top < E.y + E.h) return true;
  }
  return false;
}
function hasBackdrop(el: HTMLElement): boolean {
  const st = getComputedStyle(el) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
  return (!!st.backdropFilter && st.backdropFilter !== 'none') || (!!st.webkitBackdropFilter && st.webkitBackdropFilter !== 'none');
}
type Block = { el: HTMLElement; kids?: HTMLElement[]; onPhoto?: boolean; glass?: boolean };
function chromeBlocks(root: HTMLElement, E: R): Block[] {
  const out: HTMLElement[] = [];
  const tags = new Map<HTMLElement, { onPhoto?: boolean; glass?: boolean }>();
  const cx = E.x + E.w / 2, cy = E.y + E.h / 2;
  /* 照片的範圍：預期的照片框，加上工具裡實際的大圖（美顏等工具的照片不一定剛好在預期位置） */
  const zones: R[] = [E];
  root.querySelectorAll('img, canvas').forEach(m => { const q = m.getBoundingClientRect(); if (q.width * q.height >= E.w * E.h * 0.2) zones.push({ x: q.left, y: q.top, w: q.width, h: q.height }); });
  const onPhoto = (q: DOMRect) => zones.some(z => Math.min(q.right, z.x + z.w) - Math.max(q.left, z.x) > 2 && Math.min(q.bottom, z.y + z.h) - Math.max(q.top, z.y) > 2);
  /* inBox：在包著照片的那一塊裡面（照片周圍的空間） */
  const walk = (el: HTMLElement, depth: number, inBox = false) => {
    for (const c of Array.from(el.children) as HTMLElement[]) {
      if (c.hasAttribute('data-import-hero') || c.hasAttribute('data-import-spinner')) continue;
      if (shownOpacity(c) < 0.01) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) { if (depth < 8 && c.children.length) walk(c, depth + 1, inBox); continue; }
      const coversPhoto = r.left <= cx && r.right >= cx && r.top <= cy && r.bottom >= cy && r.width * r.height >= E.w * E.h * 0.5;
      if (coversPhoto || hasPhoto(c, E) || (c.children.length && hasRaisedZ(c, E))) { if (depth < 8) walk(c, depth + 1, inBox || coversPhoto || hasPhoto(c, E)); continue; }
      /* 疊在照片上的浮動按鈕（前後對比、標準／專業、換圖…）：不參與進場 ——
         它們本來就被飛進來的替身蓋著，跟照片一起出現；做透明度動畫會讓 iOS 暫時改變它的圖層與毛玻璃材質 */
      if (onPhoto(r)) { out.push(c); tags.set(c, { onPhoto: true }); continue; }
      /* 毛玻璃（backdrop-filter）的元素：做透明度動畫時 iOS 會暫時拿不到後面的畫面，材質跟就定位後不一樣 ——
         它自己不動；包著它的那一塊往裡面拆，其他部分照樣進場 */
      /* 照片區裡的毛玻璃：毛玻璃算的是「它後面的畫面」，替身還沒交接前，後面的照片本人是藏起來的（透明），
         這時候算出來的材質是一片黑、跟就定位後不同。所以它跟照片上的按鈕一樣，等照片本人出現後才開播 —— 動畫不變，材質從第一格就對 */
      if (hasBackdrop(c)) { out.push(c); if (inBox) tags.set(c, { onPhoto: true }); continue; }
      if (inBox && c.querySelector('[class*="backdrop-"],[style*="backdrop"]')) { if (depth < 8) walk(c, depth + 1, inBox); continue; }
      out.push(c);
    }
  };
  walk(root, 0);
  /* 下方的大面板（工具列＋分頁疊在一起）：整塊（連底色）一起升起淡入，裡面的每一列再各自多升一段、錯開 —— 層次出得來，底色也跟著動 */
  return out.map(el => {
    const tg = tags.get(el);
    if (tg) return { el, ...tg };
    const r = el.getBoundingClientRect();
    const kids = (Array.from(el.children) as HTMLElement[]).filter(k => { const q = k.getBoundingClientRect(); return q.width > 1 && q.height > 1; });
    return r.top > cy && r.height > 90 && kids.length >= 2 && kids.length <= 8 ? { el, kids } : { el };
  });
}
/** 元素原本的 transform（例如置中用的 -50%）：動畫用 transform 才會整段在 GPU 上跑，原本的 transform 接在後面保留 */
function baseTransform(el: HTMLElement): string { const t = getComputedStyle(el).transform; return t && t !== 'none' ? t : ''; }
function runEnter(root: HTMLElement, E: R) {
  const blocks = chromeBlocks(root, E).filter(b => !entered.has(b.el));
  if (!blocks.length) return;
  /* 開播之後過一陣子才長出來的：短短進場、不錯開；開播當下（0.35 秒內）工具換版面重新長出來的，照樣完整分層進場 */
  const late = revealed && performance.now() - revealT > 350;
  const rects = blocks.map(b => b.el.getBoundingClientRect());
  const top: number[] = [], bottom: number[] = [], over: number[] = [];
  rects.forEach((r, i) => (blocks[i].onPhoto ? over : (r.top + r.height / 2) < E.y ? top : bottom).push(i));
  bottom.sort((a, b) => rects[a].top - rects[b].top);
  over.sort((a, b) => rects[a].top - rects[b].top || rects[a].left - rects[b].left);
  /* after：疊在照片上的按鈕要等飛進來的替身完全交接掉才開播 ——
     替身永遠在最上層，先播的話按鈕看起來會在照片底下 */
  const anim = (el: HTMLElement, k: Keyframe[], delay: number, dur: number, after = false) => {
    const job: Job = { el, k, opts: { duration: dur, delay, easing: ENTER_EASE, fill: 'backwards' } };
    if (after && !landed) { hold(job); afterLand.push(job); }
    else if (!revealed) { hold(job); pending.push(job); }
    else startJob(job);
  };
  const play = (b: Block | HTMLElement, dy: number, delay: number, dur: number, after = false) => {
    const el = b instanceof HTMLElement ? b : b.el;
    entered.add(el);
    const t = baseTransform(el);
    const from = `translate3d(0, ${dy}px, 0)${t ? ' ' + t : ''}`, to = t || 'translate3d(0, 0, 0)';
    const o = shownOpacity(el);
    anim(el, [{ opacity: 0, transform: from }, { opacity: o, transform: to }], delay, dur, after);
  };
  let n = 0;
  top.forEach(i => play(blocks[i], late ? -8 : -14, 0, late ? 320 : 480));
  for (const i of bottom) {
    const b = blocks[i], d = late ? 0 : 60 + Math.min(n, 6) * 55;
    play(b, late ? 20 : 30, d, late ? 360 : 600);
    n++;
    if (b.kids && !late) b.kids.forEach((k, m) => {
      entered.add(k);
      const t = baseTransform(k);
      anim(k, [{ transform: `translate3d(0, 18px, 0)${t ? ' ' + t : ''}` }, { transform: t || 'translate3d(0, 0, 0)' }], d + 50 + Math.min(m, 6) * 55, 560);
    });
  }
  /* 照片上的按鈕：照片落定後，由上而下、由左而右依序浮上來 */
  over.forEach((i, m) => play(blocks[i], 10, Math.min(m, 5) * 50, 420, true));
}
/** 替身交接完了（或根本沒有替身）：照片上的按鈕開播 */
function landNow() {
  landed = true;
  const list = afterLand; afterLand = [];
  for (const j of list) startJob(j);
}
/** 開播：暫停在第一格的介面一起開始進場 */
function revealEnter() {
  if (revealed) return;
  revealed = true; revealT = performance.now();
  window.clearTimeout(enterFailsafe);
  cancelAnimationFrame(rawRaf);
  const list = pending; pending = [];
  for (const j of list) startJob(j);
  if (!ghost) landNow();   // RAW（沒有替身）：照片上的按鈕跟著一起開播
  /* 開播後 0.8 秒內新長出來的介面也接著進場，之後就不再管 */
  window.clearTimeout(enterStopT);
  enterStopT = window.setTimeout(() => { enterObs?.disconnect(); enterObs = null; }, 800);
}
function startEnter(E: R, failsafeMs: number) {
  stopEnter();
  revealed = false; landed = false; enterE = E; enterRoot = null;
  enterFailsafe = window.setTimeout(revealEnter, failsafeMs);
  const check = () => {
    const root = document.querySelector<HTMLElement>('.safe-top');
    if (!root || !enterE) return;
    if (root !== enterRoot) enterRoot = root;
    runEnter(root, enterE);
  };
  /* MutationObserver 在 React 寫進畫面之後、瀏覽器畫出來之前就會跑：介面第一次出現時就已經停在第一格，不會先閃一下 */
  /* 同一格裡的多次變動合併成一次檢查（在這一格畫出來之前跑），不會在 React 掛介面時反覆量版面拖慢主執行緒 */
  /* 同一格裡的多次變動合併成一次檢查（在這一格畫出來之前跑：新長出來的介面第一次出現就已經藏好） */
  let queued = false;
  enterObs = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; check(); }); });
  enterObs.observe(document.body, { childList: true, subtree: true });
  check();
}
function stopEnter() {
  revealEnter();
  landNow();
  window.clearTimeout(enterStopT);
  enterObs?.disconnect(); enterObs = null; enterRoot = null; enterE = null;
}

/** 單張 RAW 導入（不播飛行過場）：介面一樣分層進場，時機是 RAW 沖好、照片出現在工具裡的那一刻 */
export function beginToolEntrance(kind: string | undefined, aspect?: number) {
  if (!heroAllowed() || ghost) return;
  const a = aspect && isFinite(aspect) && aspect > 0 ? aspect : 1;
  const E = predict(kind ?? 'edit', a);
  startEnter(E, 15000);
  let last: R | null = null, stable = 0;
  const t0 = performance.now();
  const step = () => {
    if (revealed) return;
    const root = document.querySelector<HTMLElement>('.safe-top');
    let best: R | null = null, area = 0;
    root?.querySelectorAll<HTMLElement>('img, canvas').forEach(el => {
      if (el instanceof HTMLImageElement && (!el.complete || !el.naturalWidth)) return;
      const r = contentRect(el);
      const ar2 = r.width * r.height;
      if (ar2 < E.w * E.h * 0.3 || ar2 <= area) return;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit) || (el.parentElement && el.parentElement.contains(hit)))) return;
      area = ar2; best = { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const b = best as R | null;
    if (b && last && Math.abs(b.x - last.x) < 0.5 && Math.abs(b.y - last.y) < 0.5 && Math.abs(b.w - last.w) < 0.5) stable++; else stable = 0;
    last = b;
    if (b && stable >= 6 && performance.now() - t0 > 200) { revealEnter(); return; }
    rawRaf = requestAnimationFrame(step);
  };
  rawRaf = requestAnimationFrame(step);
}
export function cancelToolEntrance() { stopEnter(); }

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
  startEnter(E, 13000);
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
  let target: HTMLElement | null = null, tr: R | null = null, stableSince = 0, lastFind = 0;
  const t0 = performance.now();
  const step = (now: number) => {
    if (my !== token || !g.isConnected) return;
    /* 找照片本人要量版面、暫時改透明度：每 80ms 做一次就夠，不要每一格都做（會跟進場動畫搶主執行緒） */
    if (landing && now - lastFind < 80) { raf = requestAnimationFrame(step); return; }
    if (landing) lastFind = now;
    /* 介面不用等照片完全就定位：替身飛到七成、工具頁已經掛上來，就開始進場（跟照片落地重疊，更連貫） */
    if (!revealed && now - t0 > motionMs('importFly') * 0.7 && document.querySelector('.safe-top')) revealEnter();
    if (landing) {
      if (target && !target.isConnected) { target = null; hide(null); }
      const prev = hiddenEl; if (prev) prev.style.opacity = hiddenPrev;
      let el: HTMLElement | null = null;
      try { el = findTarget(); } catch { el = null; }
      if (prev) prev.style.opacity = '0';
      if (el) {
        if (el !== target) { target = el; stableSince = 0; }
        hide(el);
        const r = contentRect(el);
        const n = { x: r.left, y: r.top, w: r.width, h: r.height };
        if (tr && Math.abs(n.x - tr.x) < 0.5 && Math.abs(n.y - tr.y) < 0.5 && Math.abs(n.w - tr.w) < 0.5 && Math.abs(n.h - tr.h) < 0.5) { if (!stableSince) stableSince = now; }
        else stableSince = 0;
        tr = n;
        /* 照片本人的位置連續約 0.3 秒都沒動：交接（兩張重疊，替身淡掉） */
        if (stableSince && now - stableSince >= 300 && now - t0 > motionMs('importFly')) { unhide(); revealEnter(); finish(g, motionMs('importLand')); return; }
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
    landNow();
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
