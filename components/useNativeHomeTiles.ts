/* 主頁的入口按鈕（編輯、相機、四個工具、藝術效果、點陣文字）在 App 裡換成原生的玻璃按鈕。
 *
 * 網頁照常把按鈕排好（位置、大小、圖示、字），這裡量好之後交給原生在同一個位置畫一份（見 NativeGlassPlugin 的 tile），
 * 網頁那幾顆藏起來（visibility: hidden，位置照樣佔著）。按原生的＝按網頁那一顆。
 *   ‧ 編輯：白底黑字；其他：深色玻璃
 *   ‧ 進場：App 打開、主頁第一次出來時，一顆一顆從下方浮上來、玻璃長出來（有層次）。之後從任何頁面回主頁都直接在原位，不重播
 *   ‧ 捲動：跟著網頁按鈕的實際位置位移（上半屏有視差，量網頁按鈕本身最準）；上半屏開始淡出時原生收起、換回網頁的按鈕一起淡出，滑回來再換回原生
 *   ‧ 任何東西蓋到按鈕上（彈出視窗、相簿、其他頁面滑進來）、切到其他分頁、開機畫面還在：原生收起
 * 網頁版、外掛不在的舊版 App：什麼都不做 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { nativeGlass, offsetGlass } from '../utils/nativeGlass';
import { isNative } from '../utils/native';

const GROUP = 'home-tiles';
/** 這次打開 App 已經播過進場了 */
let entered = false;

const rgba = (c: string) => { const m = (c.match(/[\d.]+/g) || []).map(Number); return [m[0] ?? 255, m[1] ?? 255, m[2] ?? 255, m[3] ?? 1]; };

export function useNativeHomeTiles(scrollRef: RefObject<HTMLDivElement>, heroRef: RefObject<HTMLDivElement>, enabled: boolean): boolean {
  const [native, setNative] = useState(false);
  const enabledRef = useRef(enabled);
  const since = useRef(0);
  const kick = useRef<() => void>(() => {});
  if (enabledRef.current !== enabled) { enabledRef.current = enabled; since.current = performance.now(); }
  useEffect(() => { kick.current(); }, [enabled]);

  useEffect(() => {
    if (!isNative()) return;
    const root = scrollRef.current;
    if (!root) return;
    let alive = true, shown = false, raf = 0, dead = false;
    let els: HTMLElement[] = [];
    let base: { x: number; y: number } | null = null;
    let sub: { remove: () => void } | null = null;
    const collect = () => Array.from(root.querySelectorAll<HTMLElement>('[data-home-tile]')) as HTMLElement[];
    const setWebHidden = (h: boolean) => { for (const el of collect()) el.style.visibility = h ? 'hidden' : ''; };
    const build = (enter: boolean) => {
      els = collect();
      return els.map((el, i) => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        const white = cs.backgroundColor.replace(/\s/g, '') === 'rgb(255,255,255)';
        const card = el.dataset.homeTile === 'art' || el.dataset.homeTile === 'dot';
        const parts = (Array.from(el.querySelectorAll<HTMLElement>('[data-ht]')) as HTMLElement[]).map(p => {
          const q = p.getBoundingClientRect(), ps = getComputedStyle(p), t = p.dataset.ht;
          const box = { x: q.left - r.left, y: q.top - r.top, w: q.width, h: q.height };
          const size = parseFloat(ps.fontSize) || 12, kern = parseFloat(ps.letterSpacing) || 0;
          if (t === 'icon') return { type: 'symbol', symbol: el.dataset.ns, ...box, size: Math.round(size * 0.9), color: rgba(ps.color) };
          if (t === 'pill') return { type: 'pill', text: (p.childNodes[0]?.textContent || '').trim(), ...box, size, kern, padL: parseFloat(ps.paddingLeft) || 16, padR: parseFloat(ps.paddingRight) || 12 };
          /* 原生的字型跟網頁不同，字寬會差一點：置中的字把框放寬、照中心對齊；卡片上靠左的字往右放寬 */
          const wide = card ? { x: box.x, w: r.width - box.x - 10 } : { x: box.x - 24, w: box.w + 48 };
          return { type: 'text', text: (p.textContent || '').trim(), ...box, ...wide, size, kern, weight: parseInt(ps.fontWeight) || 400, color: rgba(ps.color), align: card ? 'left' : 'center' };
        });
        return { kind: 'tile', id: el.dataset.homeTile, x: r.left, y: r.top, w: r.width, h: r.height, radius: parseFloat(cs.borderTopLeftRadius) || 13,
          ...(white ? { fill: 'white' } : { dark: true }), parts, ...(enter ? { enterDelay: 80 + i * 60 } : {}) };
      });
    };
    const booting = () => document.documentElement.classList.contains('booting');
    /** 有沒有東西蓋在任何一顆上面（或已經捲出畫面） */
    const covered = () => collect().some(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return true;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !hit || !root.contains(hit);
    });
    const faded = () => { const h = heroRef.current; return !!h && parseFloat(getComputedStyle(h).opacity) < 0.97; };
    const sync = async () => {
      raf = 0;
      if (!alive) return;
      const p = await nativeGlass();
      if (!p || !alive) { if (!p) dead = true; return; }
      const settling = performance.now() - since.current < 600;   // 分頁剛滑回來：等它停好再量
      const want = enabledRef.current && !settling && !booting() && !faded() && !covered();
      if (!want) {
        if (shown) { shown = false; base = null; void p.hide({ group: GROUP, animate: false }); setWebHidden(false); setNative(false); }
        if (enabledRef.current && settling) schedule(650);
        return;
      }
      const first = collect()[0]?.getBoundingClientRect();
      if (!first) return;
      if (!shown) {
        const enter = !entered;
        entered = true;
        shown = true; base = { x: first.left, y: first.top };
        await p.show({ group: GROUP, items: build(enter), animate: false });
        if (!alive) return;
        setWebHidden(true); setNative(true);
        return;
      }
      /* 已經在畫面上：只跟著位移（不重建） */
      if (base) void offsetGlass(GROUP, first.left - base.x, first.top - base.y);
    };
    const schedule = (delay = 0) => {
      if (dead || raf) return;
      if (delay) { raf = window.setTimeout(() => { raf = 0; schedule(); }, delay) as unknown as number; return; }
      raf = requestAnimationFrame(() => { void sync(); });
    };
    kick.current = () => schedule();
    void nativeGlass().then(async p => {
      if (!p || !alive) return;
      const s2 = await p.addListener('tap', d => {
        if (d.group !== GROUP) return;
        const el = collect().find(e => e.dataset.homeTile === d.id);
        el?.click();
      });
      if (alive) sub = s2; else s2.remove();
      schedule();
    });
    const onScroll = () => schedule();
    root.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const mo = new MutationObserver(() => schedule());
    mo.observe(document.body, { childList: true, subtree: true });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    /* 保險：有些蓋上來的東西（純 CSS 動畫）不會觸發上面任何一個 */
    const iv = window.setInterval(() => schedule(), 400);
    return () => {
      alive = false;
      cancelAnimationFrame(raf); window.clearTimeout(raf);
      root.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      mo.disconnect(); window.clearInterval(iv);
      sub?.remove();
      kick.current = () => {};
      if (shown) void nativeGlass().then(p => p?.hide({ group: GROUP, animate: false }));
      setWebHidden(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return native;
}
