import React, {useLayoutEffect, useRef} from 'react';

/** Lift the complete export action group one button-height. Keep each result's
 * original top coordinate; only shorten its lower edge if space is required. */
export function ExportActionLift() {
  const ref=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{
    const root=ref.current?.closest<HTMLElement>('[data-export-screen]');
    const actions=root?.querySelector<HTMLElement>('[data-export-actions]');
    if(!root||!actions)return;
    const apply=()=>{
      const media=Array.from(root.querySelectorAll<HTMLImageElement|HTMLVideoElement>('[data-export-media] img, [data-export-media] video'));
      const holders=Array.from(new Set(media.map(m=>m.closest<HTMLElement>('[data-export-media]')!)));
      holders.forEach(h=>{h.style.transform='';h.style.minHeight='';});
      media.forEach(m=>{m.style.maxHeight='';m.style.maxWidth='';});
      const original=media.map(m=>m.getBoundingClientRect());
      const widths=media.map(m=>getComputedStyle(m).maxWidth);
      const holderHeights=holders.map(h=>h.getBoundingClientRect().height);
      const actionTop=actions.getBoundingClientRect().top-(actions.style.transform?-56:0);
      actions.style.transform='translateY(-56px)';
      const bottom=actions.getBoundingClientRect().top-16;
      // Reserve the original flow footprint. Otherwise a shorter photo can
      // pull the footer up again, and a horizontal result strip can clip its
      // translated top edge (especially Safari's flex min-content sizing).
      holders.forEach((h,i)=>h.style.minHeight=`${holderHeights[i]}px`);
      media.forEach((m,i)=>{
        // Desktop also uses a phone-width app shell; 80vw alone can otherwise
        // make a result wider than that shell. Preserve its original top here.
        m.style.maxWidth=widths[i]==='none'?`${Math.max(1,root.clientWidth-48)}px`:`min(${widths[i]}, ${Math.max(1,root.clientWidth-48)}px)`;
        const r=original[i];if(r.height>0&&r.bottom>bottom)
          m.style.maxHeight=`${Math.max(1,bottom-r.top)}px`;
      });
      // Read after all size writes: centring parents may have changed height.
      const offsets=new Map<HTMLElement,number>();
      media.forEach((m,i)=>{
        const h=m.closest<HTMLElement>('[data-export-media]')!;
        if(!offsets.has(h))offsets.set(h,original[i].top-m.getBoundingClientRect().top);
      });
      offsets.forEach((dy,h)=>{h.style.transform=`translateY(${dy}px)`;});
      if(import.meta.env.DEV)root.dataset.exportGeometry=JSON.stringify({originalTops:original.map(r=>r.top),originalActionTop:actionTop,actionTop:actions.getBoundingClientRect().top,media:media.map(m=>{const r=m.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};})});
    };
    apply();
    root.addEventListener('load',apply,true);
    root.addEventListener('loadedmetadata',apply,true);
    const observer=new ResizeObserver(apply);observer.observe(root);
    return()=>{observer.disconnect();root.removeEventListener('load',apply,true);root.removeEventListener('loadedmetadata',apply,true);};
  },[]);
  return <span hidden ref={ref}/>;
}
