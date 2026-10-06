import React,{useLayoutEffect,useEffect,useRef} from 'react';
import {applyPhotoFx,hasPhotoFx,releasePhotoFxSurface,type PhotoFx} from '../utils/photoFx';
import {subscribeCellPhoto} from '../utils/liveCellPhoto';
import {resolveSeamSurface} from '../utils/seamlessSurfaceGeometry';
import {drawSeamPreview,disposeSeamPreview,type SeamTexture} from '../utils/seamlessPreview';
import {drawCoveredPhoto} from '../utils/coveredPhoto';
import {get2dWide} from '../utils/colorSpace';

type Cell={id:string;url:string;naturalWidth?:number;naturalHeight?:number;zoom:number;offsetX:number;offsetY:number;rotation:number;opacity?:number;imgRadius?:number;fx?:PhotoFx};
type Rect={x:number;y:number;w:number;h:number};
type Resource={url:string;image:HTMLImageElement;input:HTMLCanvasElement;key:string;output:CanvasImageSource|null};
/** Every cell is painted in one unchanged layout plane. Selection never swaps
 * SVG/HTML geometry, and neighbour edges cannot be independently composited. */
export function LayoutPhotoSurface({cells,rects,width,height,gap,radius,revision}:{cells:Cell[];rects:Rect[];width:number;height:number;gap:number;radius:number;revision:number}){
  const ref=useRef<HTMLCanvasElement>(null),editSurface=useRef<HTMLCanvasElement>(null),editPresentation=useRef(false),lastView=useRef(''),plane=useRef<SVGSVGElement>(null),resources=useRef(new Map<string,Resource>()),live=useRef(new Map<string,PhotoFx>()),frame=useRef(0),drawRef=useRef(()=>{});
  const schedule=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;drawRef.current();});};
  useEffect(()=>{const element=ref.current;return()=>{cancelAnimationFrame(frame.current);for(const r of resources.current.values()){r.image.onload=null;releasePhotoFxSurface(r.input);r.input.width=r.input.height=1;}resources.current.clear();if(element&&!element.isConnected)disposeSeamPreview(element);};},[]);
  useEffect(()=>{
    // Repaint in the SAME transform frame, not a second rAF one frame later.
    // Sources and FX remain cached; zoom only resamples their visible pixels.
    const paint=()=>drawRef.current();
    window.addEventListener('abai-preview-transform',paint,true);
    window.addEventListener('scroll',paint,true);window.addEventListener('resize',paint);
    const observer=new ResizeObserver(paint);if(plane.current)observer.observe(plane.current);
    const lost=(e:Event)=>e.preventDefault();ref.current?.addEventListener('webglcontextlost',lost);ref.current?.addEventListener('webglcontextrestored',paint);
    return()=>{observer.disconnect();window.removeEventListener('abai-preview-transform',paint,true);window.removeEventListener('scroll',paint,true);window.removeEventListener('resize',paint);ref.current?.removeEventListener('webglcontextlost',lost);ref.current?.removeEventListener('webglcontextrestored',paint);};
  },[]);
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
      const cv=ref.current,flat=editSurface.current,root=plane.current;if(!cv||!flat||!root||width<=0||height<=0)return;
      const aw=Math.max(1,width-gap),ah=Math.max(1,height-gap);
      const points=Array.from(root.querySelectorAll<SVGCircleElement>('[data-layout-probe]')).map(n=>{const b=n.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
      const bounds=root.getBoundingClientRect(),clip=root.closest('[data-grid-preview-viewport]')?.getBoundingClientRect();
      // Always render at physical screen density directly from full originals,
      // never a fixed-size intermediate stretched by CSS. Bound allocation to
      // the visible viewport, rather than to the possibly huge layout.
      const surface=resolveSeamSurface(points,width,height,width,height,bounds,{left:Math.max(0,clip?.left??0),top:Math.max(0,clip?.top??0),right:Math.min(innerWidth,clip?.right??innerWidth),bottom:Math.min(innerHeight,clip?.bottom??innerHeight)},devicePixelRatio||1);
      if(!surface){cv.style.display='none';flat.style.display='none';return;}cv.style.display='block';
      const W=surface.pixelWidth,H=surface.pixelHeight;
      const viewKey=JSON.stringify(surface.rasterView);
      if(lastView.current!==viewKey){editPresentation.current=false;lastView.current=viewKey;}
      if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;
      cv.style.width=`${surface.width}px`;cv.style.height=`${surface.height}px`;
      cv.style.transform=`matrix(${surface.transform.join(',')})`;cv.style.clipPath=`polygon(${surface.clip})`;
      const sources:SeamTexture[]=[],clips:Rect[]=[],radii:number[]=[],crops:{tx:number;ty:number;scale:number;angle:number}[]=[];
      rects.forEach((r,i)=>{
        const c=cells[i];if(!c)return;
        const x=gap+r.x*aw,y=gap+r.y*ah,cw=Math.max(0,r.w*aw-gap),ch=Math.max(0,r.h*ah-gap);
        const resource=c.url?resources.current.get(c.id):undefined,im=resource?.image;
        clips.push({x:x/width,y:y/height,w:cw/width,h:ch/height});
        if(!im?.naturalWidth){sources.push(null);radii.push(radius);crops.push({tx:0,ty:0,scale:1,angle:0});return;}
        const fx=live.current.get(c.id)||c.fx||{},key=JSON.stringify([fx,revision]);
        if(resource!.key!==key){
          if(hasPhotoFx(fx))editPresentation.current=true;
          resource!.output=hasPhotoFx(fx)?applyPhotoFx(im,im.naturalWidth,im.naturalHeight,fx,{cacheSource:true,gpuSurface:true,out:resource!.input}):im;
          if(resource!.output instanceof HTMLCanvasElement)resource!.output.dataset.seamRevision=key;
          resource!.key=key;
        }
        const source=resource!.output!,iw=(source as any).naturalWidth||(source as any).width,ih=(source as any).naturalHeight||(source as any).height;
        const turn=Math.abs(c.rotation%180)===90;
        const scale=Math.max(r.w*aw/(turn?ih:iw),r.h*ah/(turn?iw:ih))*1.02*c.zoom;
        const dx=c.offsetX*r.w*aw,dy=c.offsetY*r.h*ah,angle=c.rotation*Math.PI/180;
        const cr=c.imgRadius?Math.min(cw,ch)*Math.min(.5,Math.max(0,c.imgRadius/100)):Math.min(radius,cw/2,ch/2);
        sources.push({image:source,width:iw,height:ih});radii.push(cr);
        crops.push({tx:dx*Math.cos(angle)+dy*Math.sin(angle),ty:-dx*Math.sin(angle)+dy*Math.cos(angle),scale,angle});
      });
      if(editPresentation.current){
        // WebKit can directly crop a native FX canvas into a physical-pixel
        // 2D surface. Re-uploading its entire multi-megapixel framebuffer to a
        // second GL context on EACH slider tick is substantially slower.
        // This is not a lower-quality draft: both paths sample full originals
        // at identical screen density. Retain these exact pixels on release.
        if(flat.width!==W)flat.width=W;if(flat.height!==H)flat.height=H;
        flat.style.width=cv.style.width;flat.style.height=cv.style.height;flat.style.transform=cv.style.transform;flat.style.clipPath=cv.style.clipPath;
        const v=surface.view,m=new DOMMatrix([v.xx/W,v.yx/W,v.xy/H,v.yy/H,v.x0,v.y0]).inverse();
        const g=get2dWide(flat)!;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,W,H);g.setTransform(m);g.imageSmoothingQuality='high';
        clips.forEach((r,i)=>{
          const source=sources[i],crop=crops[i],c=cells[i],x=r.x*width,y=r.y*height,cw=r.w*width,ch=r.h*height;
          if(!source){g.fillStyle='#121212';g.fillRect(x,y,cw,ch);return;}
          const cx=x+cw/2+crop.tx*Math.cos(crop.angle)-crop.ty*Math.sin(crop.angle),cy=y+ch/2+crop.tx*Math.sin(crop.angle)+crop.ty*Math.cos(crop.angle);
          const {image,width:iw,height:ih}=source;
          g.save();g.globalAlpha=(c.opacity??100)/100;
          if(radii[i]>0||crop.angle){g.beginPath();g.roundRect(x,y,cw,ch,radii[i]);g.clip();g.translate(cx,cy);g.rotate(crop.angle);g.drawImage(image,-iw*crop.scale/2,-ih*crop.scale/2,iw*crop.scale,ih*crop.scale);}
          else drawCoveredPhoto(g,image,(x-cx)/crop.scale+iw/2,(y-cy)/crop.scale+ih/2,cw/crop.scale,ch/crop.scale,x,y,cw,ch);
          g.restore();
        });
      }else{
        // Geometry-only frames change GPU uniforms, never re-run effects.
        drawSeamPreview(cv,cells,clips,sources,-1,{...surface.view,isolated:true,radii,crops});
      }
      flat.style.display=editPresentation.current?'block':'none';cv.style.display=editPresentation.current?'none':'block';
      flat.toggleAttribute('data-layout-photo-surface',editPresentation.current);cv.toggleAttribute('data-layout-photo-surface',!editPresentation.current);
      const shown=editPresentation.current?flat:cv;
      if(import.meta.env.DEV){shown.dataset.paintCount=String(Number(shown.dataset.paintCount||0)+1);shown.dataset.rasterView=JSON.stringify(surface.rasterView);shown.dataset.sourceKeys=JSON.stringify([...resources.current.values()].map(r=>r.key));}
    };
    drawRef.current();
  },[cells,rects,width,height,gap,radius,revision]);
  return <><svg ref={plane} data-layout-photo-plane viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden style={{position:'absolute',left:0,top:0,pointerEvents:'none',zIndex:0,overflow:'hidden'}}><g opacity={0}><circle data-layout-probe cx={0} cy={0} r={.005}/><circle data-layout-probe cx={width} cy={0} r={.005}/><circle data-layout-probe cx={0} cy={height} r={.005}/></g></svg><canvas ref={ref} data-layout-photo-surface style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0}}/><canvas ref={editSurface} style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0,display:'none'}}/></>;
}
