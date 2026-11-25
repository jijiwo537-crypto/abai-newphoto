import React, {useEffect, useLayoutEffect, useRef} from 'react';
import { nativeGlass } from '../utils/nativeGlass';
import { isNative } from '../utils/native';

/**
 * 成品底部的空間減半（基本間距加上 56px 的上移）。圖片的上緣維持原位，必要時只把下緣縮短
 */
export function ExportActionLift() {
  const ref=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{
    const root=ref.current?.closest<HTMLElement>('[data-export-screen]');
    const actions=root?.querySelector<HTMLElement>('[data-export-actions]');
    if(!root||!actions)return;
    const apply=()=>{
      actions.style.transform='';
      const media=Array.from(root.querySelectorAll<HTMLImageElement|HTMLVideoElement>('[data-export-media] img, [data-export-media] video'));
      const holders=Array.from(new Set(media.map(m=>m.closest<HTMLElement>('[data-export-media]')!)));
      holders.forEach(h=>{h.style.transform='';h.style.minHeight='';});
      media.forEach(m=>{m.style.maxHeight='';m.style.maxWidth='';});
      const original=media.map(m=>m.getBoundingClientRect());
      const widths=media.map(m=>getComputedStyle(m).maxWidth);
      const holderHeights=holders.map(h=>h.getBoundingClientRect().height);
      const actionTop=actions.getBoundingClientRect().top;
      const buttons=Array.from(actions.querySelectorAll('button'));
      const buttonBottom=Math.max(...buttons.map(b=>b.getBoundingClientRect().bottom));
      const baseGap=Number.isFinite(buttonBottom)?root.getBoundingClientRect().bottom-buttonBottom:24;
      const previousGap=baseGap+56;
      const lift=previousGap/2-baseGap;
      actions.style.transform=`translateY(${-lift}px)`;
      const bottom=actions.getBoundingClientRect().top-16;
      // 保留原本在版面裡佔的空間。不然比較矮的照片又會把底部拉上來，
      // 橫向的成品列也可能裁掉往上移的上緣（尤其是 Safari 的 flex min-content 尺寸）
      holders.forEach((h,i)=>h.style.minHeight=`${holderHeights[i]}px`);
      media.forEach((m,i)=>{
        // 桌機也是手機寬度的外框；只用 80vw 的話成品可能比外框還寬。這裡維持它原本的上緣
        m.style.maxWidth=widths[i]==='none'?`${Math.max(1,root.clientWidth-48)}px`:`min(${widths[i]}, ${Math.max(1,root.clientWidth-48)}px)`;
        const r=original[i];if(r.height>0&&r.bottom>bottom)
          m.style.maxHeight=`${Math.max(1,bottom-r.top)}px`;
      });
      // 所有尺寸都寫完再讀：置中的上層元素高度可能變了
      const offsets=new Map<HTMLElement,number>();
      media.forEach((m,i)=>{
        const h=m.closest<HTMLElement>('[data-export-media]')!;
        if(!offsets.has(h))offsets.set(h,original[i].top-m.getBoundingClientRect().top);
      });
      offsets.forEach((dy,h)=>{h.style.transform=`translateY(${dy}px)`;});
      if(import.meta.env.DEV)root.dataset.exportGeometry=JSON.stringify({originalTops:original.map(r=>r.top),originalActionTop:actionTop,actionTop:actions.getBoundingClientRect().top,previousGap,buttonGap:root.getBoundingClientRect().bottom-Math.max(...buttons.map(b=>b.getBoundingClientRect().bottom)),media:media.map(m=>{const r=m.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};})});
    };
    apply();
    root.addEventListener('load',apply,true);
    root.addEventListener('loadedmetadata',apply,true);
    const observer=new ResizeObserver(apply);observer.observe(root);
    return()=>{observer.disconnect();root.removeEventListener('load',apply,true);root.removeEventListener('loadedmetadata',apply,true);};
  },[]);
  useNativeExportActions(ref);
  return <span hidden ref={ref}/>;
}

/* ── 成品頁下方的按鈕換成原生的（App 裡）──
 * 所有工具的成品頁都有這一列（data-export-actions），也都掛著這個元件，所以在這裡統一處理：
 * 網頁照常把按鈕排好（位置、大小、字），App 裡在同一個位置疊原生按鈕 —— 白色的那顆（儲存）是白底黑字，其他的是比別處淺一點的深色玻璃；
 * 網頁的那幾顆藏起來（visibility: hidden，位置照樣佔著）。按下原生按鈕＝按下網頁那一顆（同一個 onClick）。
 * 「儲存中」那層還蓋著的時候不顯示（原生按鈕疊在整個網頁上面，會蓋到轉圈上）；按了會離開成品頁的按鈕，原生那組先收掉（不跟著網頁滑走）。
 * 外掛不在（舊版 App）、網頁版：什麼都不做，網頁按鈕照常顯示 */
const GROUP = 'export-actions';
function useNativeExportActions(ref: React.RefObject<HTMLSpanElement>) {
  useEffect(() => {
    if (!isNative()) return;
    const root = ref.current?.closest<HTMLElement>('[data-export-screen]');
    const actions = root?.querySelector<HTMLElement>('[data-export-actions]');
    if (!root || !actions) return;
    let alive = true, shown = false, leaving = false, raf = 0, last = '';
    let sub: { remove: () => void } | null = null;
    let list: HTMLButtonElement[] = [];
    const buttons = () => (Array.from(actions.querySelectorAll<HTMLButtonElement>("button")) as HTMLButtonElement[]).filter(b => { const r = b.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
    const setWebHidden = (h: boolean) => { for (const b of Array.from(actions.querySelectorAll<HTMLButtonElement>("button")) as HTMLButtonElement[]) b.style.visibility = h ? 'hidden' : ''; };
    const busy = () => !!document.querySelector('[data-busy-layer]');
    const sync = async () => {
      raf = 0;
      if (!alive || leaving) return;
      const p = await nativeGlass();
      if (!p || !alive || leaving) return;
      if (busy() || !root.isConnected) {
        if (shown) { shown = false; last = ''; void p.hide({ group: GROUP, animate: false }); setWebHidden(false); }
        return;
      }
      list = buttons();
      const items = list.map((b, i) => {
        const r = b.getBoundingClientRect();
        const white = getComputedStyle(b).backgroundColor.replace(/\s/g, '') === 'rgb(255,255,255)';
        return { kind: 'circle', id: 'b' + i, title: (b.textContent || '').trim(), x: r.left, y: r.top, w: r.width, h: r.height,
          /* 網頁上白色的那顆（儲存）＝白底；其他的深色玻璃只在成品頁淡一點（0.18，別處是 0.3）；其他的＝深色玻璃（跟 ⋯ 選單同一種） */
          enabled: !b.disabled, ...(white ? { fill: 'white', titleColor: 'black' } : { dark: true, darkAlpha: 0.18 }) };
      });
      const sig = JSON.stringify(items);
      if (sig === last && shown) return;
      /* 只有字或能不能按變了（位置、顏色都一樣）：原地更新那幾顆，不重建整組 —— 重建時玻璃會重新長出來，看起來會變色一下 */
      const shape = (l: typeof items) => JSON.stringify(l.map(({ title: _t, enabled: _e, ...rest }) => rest));
      if (shown && last && shape(JSON.parse(last)) === shape(items)) {
        const prev = JSON.parse(last) as typeof items;
        last = sig;
        for (let i = 0; i < items.length; i++) {
          if (prev[i].title !== items[i].title || prev[i].enabled !== items[i].enabled)
            void p.update({ group: GROUP, id: items[i].id, title: items[i].title, enabled: items[i].enabled });
        }
        return;
      }
      last = sig; shown = true;
      /* 不做淡入：玻璃材質不能半透明，淡入的過程中顏色會畫錯（開頭「變色一下」）。
         成品頁本身就是在「儲存中」那層拿掉的那一格整頁直接換上，按鈕跟著同一格直接出現 */
      await p.show({ group: GROUP, items, animate: false });
      if (alive && !leaving) setWebHidden(true);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { void sync(); }); };
    void nativeGlass().then(async p => {
      if (!p || !alive) return;
      const s2 = await p.addListener('tap', d => {
        if (d.group !== GROUP) return;
        const b = list[Number(String(d.id).slice(1))];
        if (!b || b.disabled) return;
        /* 儲存（再按一次是分享）留在成品頁；其他的都會離開成品頁：原生那組先收掉，網頁的跟著頁面一起滑走 */
        if (!b.hasAttribute('data-save-btn')) { leaving = true; shown = false; void p.hide({ group: GROUP, animate: true }); setWebHidden(false); }
        b.click();
      });
      if (alive) sub = s2; else s2.remove();
      schedule();
    });
    /* 按鈕的字、能不能按（儲存中… → 已存到相簿）、「儲存中」那層出現／拿掉、位置變了：重新送一次 */
    const mo = new MutationObserver(schedule);
    mo.observe(actions, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class', 'style'] });
    const bodyMo = new MutationObserver(schedule);
    bodyMo.observe(document.body, { childList: true, subtree: true });
    const ro = new ResizeObserver(schedule); ro.observe(root);
    window.addEventListener('resize', schedule);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      mo.disconnect(); bodyMo.disconnect(); ro.disconnect();
      window.removeEventListener('resize', schedule);
      sub?.remove();
      if (shown || leaving) void nativeGlass().then(p => p?.hide({ group: GROUP, animate: false }));
      setWebHidden(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
