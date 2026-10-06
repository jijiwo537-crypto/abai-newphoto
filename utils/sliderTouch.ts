/* ── 滑桿：拖得到、但不會搶走別人的點擊 ──────────────────────────────
 *
 * 滑桿看得到的只有一條 2px 的線加一顆 14px 的白點，手指按不準，所以外面那層
 * .slider-wrap 用 ::before 在滑桿上下各鋪了一塊 28px 的透明區 —— 手指不用剛好
 * 壓在白點上也拖得動。它是絕對定位、不佔版面，所以間距與對齊完全不變。
 *
 * 那一塊透明區會蓋住上下相鄰的按鈕，所以「按下去」不能一律算數：
 *   ‧ 按在看得見的那一條上   → 跟原生一樣：值直接跳到手指的位置
 *   ‧ 按在多出來的那一圈裡：
 *       手指橫向移動超過 4px → 當作拖曳
 *       放開時還沒移動       → 當作點擊，把這一下轉交給底下那個元素
 *   ‧ 滑桿區允許原生 pan-y。手勢方向明確向上／下時交還瀏覽器捲動；
 *     明確向左／右時才由自訂滑桿接手。
 *
 * ── 為什麼整套手勢都自己接（滑桿掛了 pointer-events: none）─────────────
 * 試過兩種比較省事的做法，都不行：
 *   ① 把滑桿本人撐高、在它的 pointerdown 上 preventDefault ——
 *      Chromium 的 range 拖曳不是走「相容滑鼠事件」那條路，preventDefault
 *      擋不掉，值照樣跳到手指的位置。
 *   ② 只把透明區鋪在 ::before 上、滑桿維持原本高度 ——
 *      手指觸控有「觸控校正」（touch adjustment）：點在旁邊的空白處時，
 *      瀏覽器會自己往附近找一個「可以按的東西」，range 就是它最愛的那種，
 *      所以還是被滑桿接走（實測 elementFromPoint 指向 div，事件的 target
 *      卻是 input）。
 * 滑桿一旦 pointer-events: none 就完全不是觸控的候選人，事件一定落在透明區
 * 上，接下來要拖要點都由這裡說了算 —— 沒有任何原生行為要對抗。
 *
 * 值的算式跟瀏覽器一致：白點的中心在 [左緣 + 拇指寬/2, 右緣 - 拇指寬/2]
 * 之間走，所以從哪裡開始拖，拉到同一個 x 都會得到同一個值。拇指寬寫在 CSS
 * 的 --thumb-w 上，兩邊不可能各走各的。
 */

import {fineSliderValue} from './sliderPrecision';
/** 看得見的那一條有多高（單邊）。這個範圍內按下去就直接跳值，跟原生一樣。 */
const CORE_HALF = 9;
/** 手指橫向移動超過這麼多就算「在拖滑桿」，不算「點一下」 */
const DRAG_SLOP = 4;
/** 直向手勢較早交還頁面，避免手指落在滑桿擴大的觸控區時卡住滾動。 */
const SCROLL_SLOP = 7;
/** 明確的方向優先權；輕微斜向起手仍留在判斷區，不立即改變值。 */
const INTENT_RATIO = 1.15;
/** touchmove 一定要非被動，不然 preventDefault 沒有作用 */
const TM_OPT = { passive: false, capture: true } as AddEventListenerOptions;
/** 轉交點擊時最多往下找幾層（底下可能又是另一根滑桿的透明區） */
const FORWARD_DEPTH = 4;
/** 透明區比看得見的那一條往左右各多出多少（＝CSS 的 ::before left/right） */
const ZONE_X = 7;
/** 透明區的上下半高（＝CSS 的 ::before height 56px 的一半） */
const ZONE_Y = 28;

/* ── 兩根滑桿靠太近的時候，該算誰的？ ─────────────────────────────
 *
 * 撐大的透明區有 56px 高，但版面上滑桿與滑桿的間距不一定有這麼多 ——
 * 量過最擠的兩處：創意拼圖「圖案／參數」那一頁只有 55px（疊 1px），
 * 調色頁的色相與飽和度只差 38px（整整疊掉 19px）。
 *
 * 疊在一起的那一段，原本是「DOM 順序在後面的那一根」贏（它畫在上面），
 * 所以在色相下緣按下去其實拖到的是飽和度 —— 使用者的感覺就是
 * 「這兩根靠太近，會拖到隔壁那根」。
 *
 * 改成看距離：疊到的每一根都算一次「手指到那條軌道的距離」，最近的那根贏。
 * 等於把重疊的區域從中線切開，一人一半，兩根都拖得到，也不會互搶。
 */
const inZone = (r: DOMRect, x: number, y: number) => {
  const cy = r.top + r.height / 2;
  return x >= r.left - ZONE_X && x <= r.right + ZONE_X && y >= cy - ZONE_Y && y <= cy + ZONE_Y;
};

/** 手指到這條軌道（看得見的那個方框）有多遠 */
const distTo = (r: DOMRect, x: number, y: number) => {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
};

/** 這一下按在好幾根滑桿的透明區裡時，挑離手指最近的那一根 */
const nearestWrap = (from: HTMLElement, x: number, y: number): HTMLElement => {
  let best = from;
  let bestD = distTo(from.getBoundingClientRect(), x, y);
  const all = document.querySelectorAll<HTMLElement>('.slider-wrap');
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    if (n === from) continue;
    const r = n.getBoundingClientRect();
    if (!r.width || !inZone(r, x, y)) continue;
    // 沒有滑桿、或滑桿是關著的，就不要把這一下搶過去
    const inp = n.querySelector('input[type=range]') as HTMLInputElement | null;
    if (!inp || inp.disabled) continue;
    const d = distTo(r, x, y);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
};

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

/** 改值並通知 React（直接寫 .value 的話 React 收不到 onChange／onInput） */
const setValue = (el: HTMLInputElement, v: string) => {
  if (el.value === v || !valueSetter) return;
  valueSetter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

/** 這根滑桿的拇指有多寬（CSS 的 --thumb-w） */
const thumbWidth = (el: HTMLInputElement) => {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--thumb-w'));
  return Number.isFinite(v) && v > 0 ? v : 14;
};

/** 手指在 clientX 的時候，這根滑桿應該是多少 */
const valueAt = (el: HTMLInputElement, clientX: number) => {
  const r = el.getBoundingClientRect();
  const t = thumbWidth(el);
  const travel = Math.max(1, r.width - t);
  const f = Math.min(1, Math.max(0, (clientX - (r.left + t / 2)) / travel));
  const min = el.min === '' ? 0 : parseFloat(el.min);
  const max = el.max === '' ? 100 : parseFloat(el.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return el.value;
  const raw = min + f * (max - min);
  const step = parseFloat(el.step);            // step="any" 或沒寫會是 NaN
  if (!Number.isFinite(step) || step <= 0) return String(raw);
  const snapped = min + Math.round((raw - min) / step) * step;
  // 0.1 + 0.2 那種浮點尾巴：照 step 的小數位數收乾淨
  const dec = (String(step).split('.')[1] || '').length;
  return String(Math.min(max, Math.max(min, +snapped.toFixed(dec))));
};

/** 把這一下點擊轉交給透明區底下的那個元素 */
const forwardTap = (wrap: HTMLElement, x: number, y: number) => {
  const hidden: HTMLElement[] = [];
  let cur: HTMLElement = wrap;
  let target: HTMLElement | null = null;
  for (let i = 0; i < FORWARD_DEPTH; i++) {
    hidden.push(cur);
    cur.style.pointerEvents = 'none';
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!under) break;
    // 底下又是另一根滑桿的透明區的話，繼續往下找
    if (under.classList && under.classList.contains('slider-wrap')) { cur = under; continue; }
    target = under;
    break;
  }
  hidden.forEach(n => { n.style.pointerEvents = ''; });
  if (!target) return;
  target.dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true, view: window, clientX: x, clientY: y,
  }));
};

let installed = false;

export const installSliderTouch = () => {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('pointerdown', (e: PointerEvent) => {
    const hit = e.target as HTMLElement | null;
    if (!hit || !hit.classList || !hit.classList.contains('slider-wrap')) return;
    // 透明區跟隔壁那根疊到的話，交給離手指近的那一根（見上面 nearestWrap 的說明）
    const wrap = nearestWrap(hit, e.clientX, e.clientY);
    const el = wrap.querySelector('input[type=range]') as HTMLInputElement | null;
    if (!el || el.disabled) return;

    const r = el.getBoundingClientRect();
    const inCore = Math.abs(e.clientY - (r.top + r.height / 2)) <= CORE_HALF;
    const id = e.pointerId;
    const isTouch = e.pointerType === 'touch';
    const x0 = e.clientX, y0 = e.clientY;
    const min=Number(el.min||0),max=Number(el.max||100),step=Number(el.step||1);
    const start=Number(el.value),travel=Math.max(1,r.width-thumbWidth(el));
    const center=r.left+thumbWidth(el)/2+(start-min)/(max-min)*travel;
    const fine=el.dataset.fineDrag==='true'&&Math.abs(x0-center)<=Math.max(14,thumbWidth(el));

    // 白點周圍至少44px的觸控區立即取得手勢，但不跳值。
    // 其他透明區仍等待橫向拖動，避免遮住相鄰按鈕的點擊。
    const onThumb = Math.abs(x0-center)<=22 && Math.abs(y0-(r.top+r.height/2))<=22;
    // Touch 上即使起點落在白點，也先辨認手勢方向；否則垂直滑頁只要
    // 從白點旁起手就會永遠被滑桿鎖住。滑鼠仍保留白點立即拖曳手感。
    let live = onThumb && !isTouch;
    let dead = false;   // 已經認定使用者是在捲面板，這一下從頭到尾不關滑桿的事
    let done = false;
    let notifiedStart = false;

    /* input 本體是 pointer-events:none，iPhone 上真正接到按下的是
       .slider-wrap。經典拼圖的「只重畫當前物件」模式原本等在 input
       的 pointerdown，因此手機上根本從未開啟，每一格還是重畫整個專案。
       當這支代理真正判定為橫向拖曳時，補送一個只用來通知
       React 的 pointerdown；放手時原本就會補送 pointerup。所有滑桿的
       當前手感與透明觸控區都不變。 */
    const notifyStart = (cx: number, cy: number) => {
      if (notifiedStart) return;
      notifiedStart = true;
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: id,
        pointerType: e.pointerType, clientX: cx, clientY: cy,
      }));
    };

    /** 手指移到 (cx, cy)：回傳 true 代表「這一下是滑桿的，別讓瀏覽器拿去捲」 */
    const advance = (cx: number, cy: number): boolean => {
      if (dead) return false;
      if (!live) {
        const dx = Math.abs(cx - x0), dy = Math.abs(cy - y0);
        /* 先辨認明確縱向意圖，再辨認橫向拖動。舊版的 14px 門檻、
           2:1 方向比，加上 touch-action:none，會把整個頁面捲動鎖在滑桿上。
           pan-y 由 CSS 預先允許，縱向意圖一旦成立便不 preventDefault，
           瀏覽器可自然接手；橫向手勢仍使用同一個精確值映射。 */
        if (dy > SCROLL_SLOP && dy > dx * INTENT_RATIO) {
          dead = true; return false;
        } else if (dx > (fine ? .5 : DRAG_SLOP) && dx > dy * INTENT_RATIO) {
          live = true;
          notifyStart(cx, cy);
          /* 抓住這根指頭：接下來不管手指飄到哪一顆按鈕、哪一根滑桿上面，
             事件都只會送到這裡，別人不會亮起來、也不會被按到。 */
          try { wrap.setPointerCapture(id); } catch { /* 抓不到就算了，事件還是收得到 */ }
        } else return false;
      }
      setValue(el, fine ? String(fineSliderValue(start,cx-x0,min,max,step,travel,el.dataset.smoothRange==='true')) : valueAt(el, onThumb ? cx-x0+center : cx));
      return true;
    };

    const onMove = (m: PointerEvent) => {
      if (m.pointerId !== id) return;
      if (advance(m.clientX, m.clientY) && m.cancelable) m.preventDefault();
    };

    /* 觸控事件負責精確改值；只有橫向意圖成立後才 preventDefault。
       CSS pan-y 讓縱向手勢從 slider-wrap 起手也可以自然捲動頁面。 */
    const onTouchMove = (t: TouchEvent) => {
      if (t.touches.length !== 1) return;          // 兩指以上是縮放，不要碰
      const f = t.touches[0];
      if (advance(f.clientX, f.clientY) && t.cancelable) t.preventDefault();
    };

    const end = (cancelled: boolean, cx: number, cy: number) => {
      if (done) return;
      done = true;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('touchmove', onTouchMove, TM_OPT);
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('touchcancel', onTouchEnd, true);
      try { wrap.releasePointerCapture(id); } catch { /* 同上 */ }
      // 手指明顯在直向滑、或整段被取消：這一下跟滑桿無關
      if (dead || (cancelled && !live)) return;
      // 沒拖過、又是按在看得見的那一條上：跟原生一樣，值跳到手指的位置
      if (!live && inCore) { live = true; notifyStart(cx, cy); if(!fine)setValue(el, valueAt(el, cx)); }
      if (live) {
        /* 有些滑桿是「手放開才算數」的（動畫頁放開後自動重播）——
           它們掛的是滑桿本人的 onPointerUp／onTouchEnd，補一顆給它們。 */
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: id }));
        return;
      }
      // 沒拖過、也不是按在那一條上 ＝ 使用者其實是想按底下那顆按鈕
      forwardTap(wrap, cx, cy);
    };

    function onPointerEnd(u: PointerEvent) {
      if (u.pointerId !== id) return;
      /* 已經在拖了卻收到 pointercancel（瀏覽器想插手）：不收工。
         touchmove／touchend 那條路還活著，讓它把這一段拖完。 */
      if (u.type === 'pointercancel' && live && isTouch) return;
      end(u.type === 'pointercancel', u.clientX, u.clientY);
    }
    function onTouchEnd(t: TouchEvent) {
      const f = t.changedTouches[0];
      end(t.type === 'touchcancel', f ? f.clientX : x0, f ? f.clientY : y0);
    }

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    if (isTouch) {
      window.addEventListener('touchmove', onTouchMove, TM_OPT);
      window.addEventListener('touchend', onTouchEnd, true);
      window.addEventListener('touchcancel', onTouchEnd, true);
    }
    if (onThumb && !isTouch) {
      notifyStart(x0,y0);
      try { wrap.setPointerCapture(id); } catch { /* Detached test surfaces have no capture. */ }
    }
  }, true);
};
