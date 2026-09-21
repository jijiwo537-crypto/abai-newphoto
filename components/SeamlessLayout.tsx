import React, { useEffect, useRef } from 'react';
import { renderSeamlessLayout, type SeamPhoto, type SeamRect } from '../utils/seamlessLayout';

export function SeamlessLayout({ cells, rects, width, height, amount, revision }: { cells: SeamPhoto[]; rects: SeamRect[]; width: number; height: number; amount: number; revision: number }) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    let cancelled=false;
    const raf=requestAnimationFrame(()=>{
      const ratio=window.devicePixelRatio || 1;
      renderSeamlessLayout(cells,rects,width*ratio,height*ratio,amount,revision,()=>cancelled).then(frame=>{
        if(cancelled || !ref.current) return;
        const canvas=ref.current; canvas.width=frame.width; canvas.height=frame.height;
        canvas.getContext('2d')!.drawImage(frame,0,0);
        canvas.dataset.ready='true';
      }).catch(error=>{
        if(cancelled || error?.name === 'AbortError') return;
        if(!cancelled && ref.current) delete ref.current.dataset.ready;
        console.error('Seamless layout:',error);
      });
    });
    return ()=>{cancelled=true;cancelAnimationFrame(raf)};
  },[cells,rects,width,height,amount,revision]);
  return <><style>{`[data-seamless="true"]:has(> canvas[data-ready="true"]) [id^="cell-container-"] { background-color: transparent !important; }
  [data-seamless="true"]:has(> canvas[data-ready="true"]) .layout-photo-content { visibility: hidden; }`}</style><canvas ref={ref} data-seamless-layout aria-hidden style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:0}}/></>;
}
