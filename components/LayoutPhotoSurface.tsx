import React,{useLayoutEffect,useEffect,useRef} from 'react';
import {applyPhotoFx,hasPhotoFx,releasePhotoFxSurface,type PhotoFx} from '../utils/photoFx';
import {subscribeCellPhoto} from '../utils/liveCellPhoto';
import {drawCoveredPhoto} from '../utils/coveredPhoto';
import {get2dWide} from '../utils/colorSpace';

type Cell={id:string;url:string;naturalWidth?:number;naturalHeight?:number;zoom:number;offsetX:number;offsetY:number;rotation:number;opacity?:number;imgRadius?:number;fx?:PhotoFx};
type Rect={x:number;y:number;w:number;h:number};
type Resource={url:string;image:HTMLImageElement;input:HTMLCanvasElement;key:string;output:CanvasImageSource|null};
/** Every cell is painted in one unchanged layout plane. Selection never swaps
 * SVG/HTML geometry, and neighbour edges cannot be independently composited. */
export function LayoutPhotoSurface({cells,rects,width,height,gap,radius,revision}:{cells:Cell[];rects:Rect[];width:number;height:number;gap:number;radius:number;revision:number}){
  const ref=useRef<HTMLCanvasElement>(null),resources=useRef(new Map<string,Resource>()),live=useRef(new Map<string,PhotoFx>()),frame=useRef(0),drawRef=useRef(()=>{});
  const schedule=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;drawRef.current();});};
  useEffect(()=>()=>{cancelAnimationFrame(frame.current);for(const r of resources.current.values()){r.image.onload=null;releasePhotoFxSurface(r.input);r.input.width=r.input.height=1;}resources.current.clear();},[]);
  useLayoutEffect(()=>{
    const clean=cells.map(c=>subscribeCellPhoto(c.id,fx=>{live.current.set(c.id,fx);schedule();}));
    return()=>clean.forEach(fn=>fn());
  },[cells.map(c=>c.id).join('|')]);
  useLayoutEffect(()=>{live.current.clear();},[cells]);
  useLayoutEffect(()=>{
    const active=new Set(cells.map(c=>c.id));
    for(const [id,r] of resources.current)if(!active.has(id)){r.image.onload=null;releasePhotoFxSurface(r.input);r.input.width=r.input.height=1;resources.current.delete(id);}
    cells.forEach(c=>{
      if(!c.url)return;
      const old=resources.current.get(c.id);if(old?.url===c.url)return;
      if(old){old.image.onload=null;releasePhotoFxSurface(old.input);old.input.width=old.input.height=1;}
      const image=new Image();image.onload=schedule;image.src=c.url;
      resources.current.set(c.id,{url:c.url,image,input:document.createElement('canvas'),key:'',output:null});
    });
    drawRef.current=()=>{
      const cv=ref.current;if(!cv||width<=0||height<=0)return;
      const aw=Math.max(1,width-gap),ah=Math.max(1,height-gap);
      // Source density is constant throughout a gesture; a selected state or
      // finger release never changes the quality tier.
      let density=1;
      cells.forEach((c,i)=>{const r=rects[i],im=resources.current.get(c.id)?.image;if(!r||!im?.naturalWidth)return;
        const turn=Math.abs(c.rotation%180)===90;
        density=Math.max(density,Math.min((turn?im.naturalHeight:im.naturalWidth)/(r.w*aw),(turn?im.naturalWidth:im.naturalHeight)/(r.h*ah)));});
      density=Math.min(density,4096/Math.max(width,height));
      const W=Math.max(1,Math.round(width*density)),H=Math.max(1,Math.round(height*density));
      if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;
      const g=get2dWide(cv)!;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,W,H);g.scale(W/width,H/height);
      rects.forEach((r,i)=>{
        const c=cells[i];if(!c)return;
        const x=gap+r.x*aw,y=gap+r.y*ah,cw=Math.max(0,r.w*aw-gap),ch=Math.max(0,r.h*ah-gap);
        const resource=resources.current.get(c.id),im=resource?.image;
        if(!im?.naturalWidth){g.fillStyle='#0c0c0c';g.fillRect(x,y,cw,ch);return;}
        const fx=live.current.get(c.id)||c.fx||{},key=JSON.stringify([fx,revision]);
        if(resource!.key!==key){
          resource!.output=hasPhotoFx(fx)?applyPhotoFx(im,im.naturalWidth,im.naturalHeight,fx,{cacheSource:true,gpuSurface:true,out:resource!.input}):im;
          resource!.key=key;
        }
        const source=resource!.output!,iw=(source as any).naturalWidth||(source as any).width,ih=(source as any).naturalHeight||(source as any).height;
        const turn=Math.abs(c.rotation%180)===90;
        const scale=Math.max(r.w*aw/(turn?ih:iw),r.h*ah/(turn?iw:ih))*1.02*c.zoom;
        const cx=x+cw/2+c.offsetX*r.w*aw,cy=y+ch/2+c.offsetY*r.h*ah;
        const cr=c.imgRadius?Math.min(cw,ch)*Math.min(.5,Math.max(0,c.imgRadius/100)):Math.min(radius,cw/2,ch/2);
        g.save();g.globalAlpha=(c.opacity??100)/100;
        if(cr>0||c.rotation){g.beginPath();g.roundRect(x,y,cw,ch,cr);g.clip();g.translate(cx,cy);g.rotate(c.rotation*Math.PI/180);g.drawImage(source,-iw*scale/2,-ih*scale/2,iw*scale,ih*scale);}
        else drawCoveredPhoto(g,source,(x-cx)/scale+iw/2,(y-cy)/scale+ih/2,cw/scale,ch/scale,x,y,cw,ch);
        g.restore();
      });
      if(import.meta.env.DEV)cv.dataset.paintCount=String(Number(cv.dataset.paintCount||0)+1);
    };
    drawRef.current();
  },[cells,rects,width,height,gap,radius,revision]);
  return <canvas ref={ref} data-layout-photo-surface style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:0}}/>;
}
