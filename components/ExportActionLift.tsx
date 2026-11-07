import React, {useLayoutEffect, useRef} from 'react';

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
  return <span hidden ref={ref}/>;
}
