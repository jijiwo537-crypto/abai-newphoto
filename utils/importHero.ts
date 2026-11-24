/* 從主頁導入單張照片（編輯、美顏、仿色）時的過場：相簿裡那張小縮圖，一路流暢地放大、飛到工具裡照片的位置。
 *
 * 1. 點下去的那一刻（beginImportHero）：在那一格「原地」放一張一模一樣的替身（同位置、同大小、同樣裁成正方形）。
 *    讀原檔、開工具的那段時間它就停在原地，不先移到別的地方（不會有兩段式的移動）。
 * 2. 原檔讀好了（setImportHeroFile）：替身裡面疊上原檔解出來的高畫質版本（淡入），飛的時候就是清楚的。
 * 3. 工具畫出來之後（landImportHero）：找到照片本人（看得到、夠大、長寬比一樣的 <img>／<canvas>），
 *    等它位置穩定，替身從那一格一次飛過去、同時從正方形展開成完整比例，剛好疊在它上面。
 * 4. 落地：照片本人先在底下出現，替身再用 0.28 秒淡掉 —— 替身和正式預覽之間是柔和地交接，不會一下跳過去。
 *    找不到照片（例如被裁成別的比例）就讓替身淡掉，不會卡在畫面上。
 *
 * 只在主頁（畫面上沒有任何工具頁 .safe-top）、只選一張、而且是帶 data-import-hero 的導入入口時啟用。 */

const EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
let ghost: HTMLDivElement | null = null;
let ar = 1;
let fullUrl: string | null = null;
let token = 0;
/** 一點下去就開始的那一段飛行（飛到預估的位置）；落地時等它飛完再做最後一點點修正 */
let flight: Promise<void> = Promise.resolve();

/** 安全區域（瀏海、底部橫條）的大小 */
function safeInsets() {
  const d = document.createElement('div');
  Object.assign(d.style, { position: 'fixed', visibility: 'hidden', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' });
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  const r = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  d.remove();
  return r;
}
/** 預估照片在工具裡會停的位置：工具頁上方標題列下面、下方工具面板上面那一塊的正中間（照片完整比例放進去） */
function predictRect(aspect: number): DOMRect {
  const W = window.innerWidth, H = window.innerHeight, s = safeInsets();
  const top = s.top + 72, bottom = H - 262 - s.bottom;
  const boxW = W - 32, boxH = Math.max(120, bottom - top);
  let w = boxW, h = w / aspect;
  if (h > boxH) { h = boxH; w = h * aspect; }
  return new DOMRect((W - w) / 2, top + (boxH - h) / 2, w, h);
}

/** 這次導入要不要播：在主頁（沒有工具頁）才播 */
export const heroAllowed = () => !document.querySelector('.safe-top');

const layer = (src: string) => {
  const im = document.createElement('img');
  im.alt = ''; im.draggable = false; im.decoding = 'async'; im.src = src;
  Object.assign(im.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', display: 'block' } as CSSStyleDeclaration);
  return im;
};

/** 相簿裡點下去的那一刻。rect：那一格的位置；src：那一格的縮圖；aspect：照片的寬÷高 */
export function beginImportHero(rect: DOMRect, src: string, aspect?: number) {
  cancelImportHero();
  ++token;
  ar = aspect && isFinite(aspect) && aspect > 0 ? aspect : 1;
  const g = document.createElement('div');
  g.setAttribute('data-import-hero', '');
  Object.assign(g.style, {
    position: 'fixed', zIndex: '2147483000', pointerEvents: 'none', overflow: 'hidden', margin: '0', background: '#000',
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    transformOrigin: '0 0',
  } as CSSStyleDeclaration);
  g.appendChild(layer(src));
  document.body.appendChild(g);
  ghost = g;
  document.documentElement.setAttribute('data-import-hero', '');
  /* 手指一放就開始飛：從那一格放大、展開成完整比例，飛向照片在工具裡預估會停的位置（一路不停） */
  const P = predictRect(ar);
  const C = rect;
  const k = Math.max(C.width / P.width, C.height / P.height);
  const ix = Math.max(0, (P.width - C.width / k) / 2), iy = Math.max(0, (P.height - C.height / k) / 2);
  Object.assign(g.style, { left: `${P.left}px`, top: `${P.top}px`, width: `${P.width}px`, height: `${P.height}px`, background: 'transparent' });
  flight = g.animate([
    { transform: `translate(${C.left - P.left - ix * k}px, ${C.top - P.top - iy * k}px) scale(${k})`, clipPath: `inset(${iy}px ${ix}px)` },
    { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px)' },
  ], { duration: 520, easing: EASE, fill: 'forwards' }).finished.then(() => {}, () => {});
}

/** 原檔讀好了：疊上高畫質版本（淡入）。RAW 之類瀏覽器解不了的，就維持縮圖 */
export function setImportHeroFile(file: File) {
  const g = ghost, my = token;
  if (!g) return;
  const url = URL.createObjectURL(file);
  const im = layer(url);
  im.style.opacity = '0';
  void im.decode().then(() => {
    if (my !== token || !g.isConnected) { URL.revokeObjectURL(url); return; }
    if (im.naturalWidth && im.naturalHeight) ar = im.naturalWidth / im.naturalHeight;
    g.appendChild(im);
    fullUrl = url;
    im.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
  }, () => URL.revokeObjectURL(url));
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
    if (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) return;   // 整張都在畫面裡（還在滑進來的不算）
    if (Math.abs(r.width / r.height - ar) / ar > 0.05) return;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') return;
    /* 看得到：中心點最上面那一層是它（或跟它同一塊）。替身本身不接受點擊，不會擋到 */
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit) || (el.parentElement && el.parentElement.contains(hit)))) return;
    if (area > bestArea) { bestArea = area; best = el; }
  });
  return best;
}

/** 工具畫出來了（或正在畫）：找到照片本人、位置穩定了，就一次飛過去 */
export async function landImportHero() {
  const g = ghost, my = token;
  if (!g) return;
  const t0 = performance.now();
  let last: DOMRect | null = null, stable = 0, target: HTMLElement | null = null;
  /* 一找到照片本人就先把它藏起來（等位置穩定的這段時間，畫面上不會同時有兩張） */
  let hidden: HTMLElement | null = null, hiddenPrev = '';
  /* 藏的是「跟照片一樣大」的最外層那一塊：工具常常是好幾張 canvas 疊在一起，只藏一張還看得到另一張 */
  const outer = (el: HTMLElement | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    let top = el;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const q = n.getBoundingClientRect();
      if (Math.abs(q.left - r.left) > 1.5 || Math.abs(q.top - r.top) > 1.5 || Math.abs(q.width - r.width) > 1.5 || Math.abs(q.height - r.height) > 1.5) break;
      top = n;
    }
    return top;
  };
  const hide = (el0: HTMLElement | null) => {
    const el = outer(el0);
    if (hidden === el) return;
    if (hidden) hidden.style.opacity = hiddenPrev;
    hidden = el;
    if (el) { hiddenPrev = el.style.opacity; el.style.opacity = '0'; }
  };
  while (performance.now() - t0 < 8000) {
    await new Promise(r => requestAnimationFrame(r));
    if (my !== token) { hide(null); return; }
    /* 找的時候先放回來（藏起來的那張也要能被找到），找完再藏 */
    const prevHidden = hidden; if (prevHidden) prevHidden.style.opacity = hiddenPrev;
    const el = findTarget();
    if (prevHidden) prevHidden.style.opacity = '0';
    hide(el);
    if (!el) { stable = 0; last = null; continue; }
    const r = contentRect(el);
    if (last && Math.abs(r.left - last.left) < 0.5 && Math.abs(r.top - last.top) < 0.5 && Math.abs(r.width - last.width) < 0.5 && Math.abs(r.height - last.height) < 0.5) stable++;
    else stable = 0;
    last = r;
    /* 連續 10 格（約 0.17 秒）都沒動才算到位：工具的版面、進場動畫都走完了 */
    if (stable >= 10) { target = el; break; }
  }
  if (!target || !last) { hide(null); finish(g, 240); return; }
  const T = last;
  await flight;
  if (my !== token) { hide(null); return; }
  /* 最後的修正：從預估的位置移到照片真正的位置（同樣的比例，只有平移和縮放；預估得準的話幾乎看不出來） */
  const P = g.getBoundingClientRect();
  const k = P.width / T.width;
  Object.assign(g.style, { left: `${T.left}px`, top: `${T.top}px`, width: `${T.width}px`, height: `${T.height}px` });
  g.getAnimations().forEach(a => a.cancel());
  const dist = Math.hypot(P.left - T.left, P.top - T.top) + Math.abs(P.width - T.width);
  await g.animate([{ transform: `translate(${P.left - T.left}px, ${P.top - T.top}px) scale(${k})` }, { transform: 'translate(0px, 0px) scale(1)' }],
    { duration: Math.min(380, 160 + dist * 1.2), easing: EASE, fill: 'forwards' }).finished.catch(() => {});
  /* 落地：照片本人先在底下出現，替身再慢慢淡掉 */
  hide(null);
  if (my !== token) return;
  finish(g, 280);
}

function finish(g: HTMLDivElement, ms: number) {
  if (ghost === g) ghost = null;
  if (!ghost) document.documentElement.removeAttribute('data-import-hero');
  const url = fullUrl; fullUrl = null;
  g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {}).finally(() => {
    g.remove();
    if (url) URL.revokeObjectURL(url);
  });
}

/** 取消（使用者按了取消、選了很多張、出錯） */
export function cancelImportHero() {
  token++;
  if (ghost) finish(ghost, 160);
}

export const importHeroActive = () => !!ghost;
