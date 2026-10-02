import React, { useEffect, useRef, useState } from 'react';
import { renderSeamlessLayout, type SeamPhoto, type SeamRect } from '../utils/seamlessLayout';

export function SeamlessLayout({ cells, rects, width, height, scale = 1, amount, revision }: { cells: SeamPhoto[]; rects: SeamRect[]; width: number; height: number; scale?: number; amount: number; revision: number }) {
  const ref=useRef<HTMLCanvasElement>(null);
  const [master,setMaster]=useState<{url:string;w:number;h:number}|null>(null);
  useEffect(()=>()=>{if(master)URL.revokeObjectURL(master.url);},[master]);
  // Uniform object/preview zoom changes the display matrix only. The feathered master
  // and all its photos retain the same sampling grid throughout the gesture.
  const aspect=Math.round(width/Math.max(.000001,height)*1e8)/1e8;
  useEffect(()=>{
    let cancelled=false;
    const raf=requestAnimationFrame(()=>{
      renderSeamlessLayout(cells,rects,aspect,1,amount,revision,()=>cancelled,true).then(async frame=>{
        if(cancelled || !ref.current) return;
        const blob=await new Promise<Blob>((resolve,reject)=>frame.toBlob(b=>b?resolve(b):reject(new Error('無縫佈局編碼失敗')),'image/png'));
        if(cancelled)return;
        const url=URL.createObjectURL(blob);
        try { const image=new Image();image.src=url;await image.decode(); }
        catch(error){URL.revokeObjectURL(url);throw error;}
        if(cancelled || !ref.current){URL.revokeObjectURL(url);return;}
        setMaster({url,w:frame.width,h:frame.height});
        // Keep a readable pixel master for development audits only, not a
        // second full-resolution backing store in the shipping iPhone app.
        if(import.meta.env.DEV){const canvas=ref.current;canvas.width=frame.width;canvas.height=frame.height;canvas.getContext('2d')!.drawImage(frame,0,0);canvas.dataset.ready='true';canvas.dataset.paintCount=String(Number(canvas.dataset.paintCount||0)+1);}
        frame.width=0;frame.height=0;
      }).catch(error=>{
        if(cancelled || error?.name === 'AbortError') return;
        if(!cancelled && ref.current) delete ref.current.dataset.ready;
        console.error('Seamless layout:',error);
      });
    });
    return ()=>{cancelled=true;cancelAnimationFrame(raf)};
  },[cells,rects,aspect,amount,revision]);
  return <><style>{`[data-seamless="true"]:has(> svg[data-seamless-master]) [id^="cell-container-"] { background-color: transparent !important; }
  [data-seamless="true"]:has(> svg[data-seamless-master]) .layout-photo-content { visibility: hidden; }`}</style>
    {/* The canvas is the source master only, never a CSS-resized display layer.
        SVG shares the photos' native rendering path and one continuous matrix. */}
    <canvas hidden ref={ref} data-seamless-layout aria-hidden/>
    {master&&<svg data-seamless-master viewBox={`0 0 ${master.w} ${master.h}`} width={width} height={height} preserveAspectRatio="none" aria-hidden
      style={{position:'absolute',left:0,top:0,pointerEvents:'none',zIndex:0,transform:`scale(${scale})`,transformOrigin:'0 0'}}>
      <image href={master.url} x={0} y={0} width={master.w} height={master.h} preserveAspectRatio="none"/>
    </svg>}
  </>;
}
