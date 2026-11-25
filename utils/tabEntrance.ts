/* 編輯器切換功能分頁時，按鈕的進場動畫（濾鏡、特效的縮圖卡，調節、遮色片、人像、仿色的按鈕，構圖的控制）。
 *
 * 只動按鈕本身，不動欄位、面板、照片：短、輕、有層次 —— 依序淡入、往上浮一點點。
 *   ‧ 只用透明度和 translate（獨立的位移屬性，跟元素自己的 transform 疊加、不會蓋掉它），交給合成器播，
 *     主執行緒在切分頁時再忙也不會卡
 *   ‧ 只動畫面上看得到的前幾顆（捲在外面的不動，省下不必要的工作）
 *   ‧ 結束後不留任何樣式（fill: backwards 只在等待延遲的那段頂著起點），元素回到原本的樣子
 *   ‧ 系統開了「減少動態效果」就完全不播 */

const EASE = 'cubic-bezier(.22,1,.36,1)';
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** 這個元素現在在不在畫面上（橫向捲動列裡捲在外面的不算） */
function inView(el: Element, clip?: DOMRect | null): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const vw = window.innerWidth || 0;
  const L = clip ? Math.max(0, clip.left) : 0, R = clip ? Math.min(vw, clip.right) : vw;
  return r.right > L && r.left < R;
}

export interface RiseOpts {
  /** 往上浮多少 px */ y?: number;
  /** 每一顆的時間 */ dur?: number;
  /** 一顆接一顆的間隔 */ stagger?: number;
  /** 最多動幾顆（之後的直接出現） */ max?: number;
  /** 整組先等多久 */ delay?: number;
  /** 只動在這個框裡看得到的（橫向捲動列用） */ clip?: Element | null;
}

/** 一組按鈕依序淡入、往上浮 */
export function riseIn(els: Iterable<Element>, o: RiseOpts = {}): void {
  if (reduced()) return;
  const { y = 10, dur = 340, stagger = 26, max = 10, delay = 0, clip = null } = o;
  const clipRect = clip ? clip.getBoundingClientRect() : null;
  let k = 0;
  for (const el of els) {
    if (k >= max) break;
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    if (!inView(el, clipRect)) continue;
    const end = getComputedStyle(el).opacity || '1';
    try {
      /* y 為 0 時只動透明度（不碰位移，結束時不會有任何位置上的跳動） */
      el.animate(y ? [
        { opacity: 0, translate: `0 ${y}px` },
        { opacity: end, translate: '0 0' },
      ] : [{ opacity: 0 }, { opacity: end }], { duration: dur, delay: delay + k * stagger, easing: EASE, fill: 'backwards' });
    } catch { /* 不支援就直接出現 */ }
    k++;
  }
}

/** 單一元素淡入（可帶一點縮放：從 s 長到 1） */
export function fadeIn(el: Element | null | undefined, o: { dur?: number; delay?: number; scaleX?: number; scale?: number; y?: number } = {}): void {
  if (!el || reduced()) return;
  const { dur = 320, delay = 0, scaleX, scale, y = 0 } = o;
  const end = getComputedStyle(el).opacity || '1';
  const from: Keyframe = { opacity: 0 };
  const to: Keyframe = { opacity: end };
  if (scaleX != null) { from.scale = `${scaleX} 1`; to.scale = '1 1'; }
  else if (scale != null) { from.scale = `${scale}`; to.scale = '1'; }
  if (y) { from.translate = `0 ${y}px`; to.translate = '0 0'; }
  try { el.animate([from, to], { duration: dur, delay, easing: EASE, fill: 'backwards' }); } catch { /* 直接出現 */ }
}
