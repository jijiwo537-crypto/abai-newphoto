import React, { useEffect, useRef } from 'react';
import { renderSeamlessLayout, type SeamPhoto, type SeamRect } from '../utils/seamlessLayout';

export function SeamlessLayout({ cells, rects, width, height, amount, revision }: { cells: SeamPhoto[]; rects: SeamRect[]; width: number; height: number; amount: number; revision: number }) {
  const ref=useRef<HTMLCanvasElement>(null);
  // Uniform object/preview zoom changes CSS size only. The feathered master
  // and all its photos retain the same sampling grid throughout the gesture.
  const aspect=Math.round(width/Math.max(.000001,height)*1e8)/1e8;
  useEffect(()=>{
    let cancelled=false;
    const raf=requestAnimationFrame(()=>{
      renderSeamlessLayout(cells,rects,aspect,1,amount,revision,()=>cancelled,true).then(frame=>{
        if(cancelled || !ref.current) return;
        const canvas=ref.current; canvas.width=frame.width; canvas.height=frame.height;
        canvas.getContext('2d')!.drawImage(frame,0,0);
        canvas.dataset.ready='true';
        if(import.meta.env.DEV)canvas.dataset.paintCount=String(Number(canvas.dataset.paintCount||0)+1);
      }).catch(error=>{
        if(cancelled || error?.name === 'AbortError') return;
        if(!cancelled && ref.current) delete ref.current.dataset.ready;
        console.error('Seamless layout:',error);
      });
    });
    return ()=>{cancelled=true;cancelAnimationFrame(raf)};
  },[cells,rects,aspect,amount,revision]);
  return <><style>{`[data-seamless="true"]:has(> canvas[data-ready="true"]) [id^="cell-container-"] { background-color: transparent !important; }
  [data-seamless="true"]:has(> canvas[data-ready="true"]) .layout-photo-content { visibility: hidden; }`}</style><canvas ref={ref} data-seamless-layout aria-hidden style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:0}}/></>;
}
