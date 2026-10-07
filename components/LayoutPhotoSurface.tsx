import React,{useLayoutEffect,useEffect,useRef,useState} from 'react';
import {applyPhotoFx,hasPhotoFx,releasePhotoFxSurface,getLoadedLut,type PhotoFx} from '../utils/photoFx';
import {awaitPhotoIdle} from '../utils/photoInteractionIdle';
import {subscribeCellPhoto,subscribeCellPrime} from '../utils/liveCellPhoto';
import {resolveSeamSurface} from '../utils/seamlessSurfaceGeometry';
import {drawSeamPreview,disposeSeamPreview,type SeamTexture} from '../utils/seamlessPreview';
import {previews as seamlessPreviews} from './SeamlessLayout';
import {drawCoveredPhoto} from '../utils/coveredPhoto';
import {get2dWide} from '../utils/colorSpace';

type Cell={id:string;url:string;naturalWidth?:number;naturalHeight?:number;zoom:number;offsetX:number;offsetY:number;rotation:number;opacity?:number;imgRadius?:number;fx?:PhotoFx};
type Rect={x:number;y:number;w:number;h:number};
type Resource={url:string;image:HTMLImageElement;input:HTMLCanvasElement;key:string;output:CanvasImageSource|null;
  /** Editor-sized proxy used while a slider is held (same size as the home editor preview). */
  preview?:HTMLCanvasElement;previewKey?:string;previewOutput?:HTMLCanvasElement|null;pending?:string;primed?:boolean};
// The home editor previews at 1800px. Matching it keeps every slider frame
// independent of the photo's native size (12MP+ on phones).
const LIVE_PREVIEW=1800;
const previewSize=(im:HTMLImageElement)=>{const k=Math.min(1,LIVE_PREVIEW/Math.max(im.naturalWidth,im.naturalHeight));return [Math.max(1,Math.round(im.naturalWidth*k)),Math.max(1,Math.round(im.naturalHeight*k))];};
// Effect pixels depend on the cell's own LUT being decoded, not on every
// unrelated background LUT load that bumps the editor-wide revision.
const fxKey=(fx:PhotoFx)=>JSON.stringify([fx,fx.lut?!!getLoadedLut(fx.lut):0]);
const releasePreview=(r:Resource)=>{if(!r.preview)return;releasePhotoFxSurface(r.preview);r.preview.width=r.preview.height=1;r.preview=undefined;r.previewKey=undefined;r.previewOutput=null;};
const releaseResource=(r:Resource)=>{r.image.onload=null;r.pending=undefined;releasePhotoFxSurface(r.input);r.input.width=r.input.height=1;if(r.preview){releasePhotoFxSurface(r.preview);r.preview.width=r.preview.height=1;}};
/** Every cell is painted in one unchanged layout plane. Selection never swaps
 * SVG/HTML geometry, and neighbour edges cannot be independently composited. */
/** fusion: seamless blend amount (0..100), or undefined for separate cells.
 * Both modes share this one GPU surface and its resident textures, so
 * toggling seamless only changes shader uniforms (no re-decode/re-upload). */
export function LayoutPhotoSurface({cells,rects,width,height,gap,radius,revision,fusion,previewId}:{cells:Cell[];rects:Rect[];width:number;height:number;gap:number;radius:number;revision:number;fusion?:number;previewId?:string}){
  const ref=useRef<HTMLCanvasElement>(null),editSurface=useRef<HTMLCanvasElement>(null),editPresentation=useRef(false),lastView=useRef(''),plane=useRef<SVGSVGElement>(null),resources=useRef(new Map<string,Resource>()),live=useRef(new Map<string,PhotoFx>()),frame=useRef(0),drawRef=useRef(()=>{});
  // An evicted WebGL context never comes back on the same <canvas>; replace
  // the element so the next paint gets a fresh context instead of staying blank.
  const [surfaceGeneration,setSurfaceGeneration]=useState(0);
  const lastRemount=useRef(-1e9);
  const fusionLive=useRef(fusion);
  useLayoutEffect(()=>{fusionLive.current=fusion;},[fusion]);
  // The fusion slider repaints uniforms directly, without a React render.
  useLayoutEffect(()=>{if(!previewId||fusion===undefined)return;seamlessPreviews.set(previewId,v=>{fusionLive.current=v;drawRef.current();});return()=>{seamlessPreviews.delete(previewId);};},[previewId,fusion===undefined]);
  const schedule=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;drawRef.current();});};
  useEffect(()=>{const element=ref.current;return()=>{cancelAnimationFrame(frame.current);for(const r of resources.current.values())releaseResource(r);resources.current.clear();if(element&&!element.isConnected)disposeSeamPreview(element);};},[]);
  useEffect(()=>{
    // Repaint in the SAME transform frame, not a second rAF one frame later.
    // Sources and FX remain cached; zoom only resamples their visible pixels.
    const paint=()=>drawRef.current();
    window.addEventListener('abai-preview-transform',paint,true);
    window.addEventListener('scroll',paint,true);window.addEventListener('resize',paint);
    const observer=new ResizeObserver(paint);if(plane.current)observer.observe(plane.current);
    const element=ref.current;
    const lost=(e:Event)=>{e.preventDefault();if(element)disposeSeamPreview(element);const now=performance.now();if(now-lastRemount.current<2000)return;lastRemount.current=now;setSurfaceGeneration(g=>g+1);};
    element?.addEventListener('webglcontextlost',lost);element?.addEventListener('webglcontextrestored',paint);
    return()=>{observer.disconnect();window.removeEventListener('abai-preview-transform',paint,true);window.removeEventListener('scroll',paint,true);window.removeEventListener('resize',paint);element?.removeEventListener('webglcontextlost',lost);element?.removeEventListener('webglcontextrestored',paint);};
  },[surfaceGeneration]);
  useLayoutEffect(()=>{
    const clean=cells.map(c=>subscribeCellPhoto(c.id,fx=>{live.current.set(c.id,fx);schedule();}));
    // Selecting a cell for editing prepares its live proxy while idle (source
    // downscale + upload into the SHARED colour GPU). It must not create
    // per-cell WebGL contexts: iOS Safari evicts the oldest live context once
    // too many exist, which blanked the layout/seamless canvases to grey.
    const primes=cells.map(c=>subscribeCellPrime(c.id,()=>{void(async()=>{
      await awaitPhotoIdle();
      const r=resources.current.get(c.id),im=r?.image;if(!r||r.primed||!im?.naturalWidth||live.current.has(c.id))return;
      r.primed=true;const [pw,ph]=previewSize(im);
      applyPhotoFx(im,pw,ph,{exposure:1},{cacheSource:true});
    })();}));
    return()=>{clean.forEach(fn=>fn());primes.forEach(fn=>fn());};
  },[cells.map(c=>c.id).join('|')]);
  useLayoutEffect(()=>{live.current.clear();},[cells]);
  useLayoutEffect(()=>{
    const active=new Set(cells.map(c=>c.id));
    for(const [id,r] of resources.current)if(!active.has(id)){releaseResource(r);resources.current.delete(id);}
    cells.forEach(c=>{
      if(!c.url)return;
      const old=resources.current.get(c.id);if(old?.url===c.url)return;
      if(old)releaseResource(old);
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
      // The GPU path is one opaque raster: adjacent cells share exact float
      // edges and every sample has an owner (sealEdges), so the browser's
      // resampling of this canvas can never open a gap between them. Only the
      // 2D effect canvas below antialiases each clip separately and needs a
      // subpixel overlap. No overlap with a real gutter or rounded corners.
      const noVisibleGutter=gap<=.001&&radius<=.001&&cells.every(c=>!(c.imgRadius||0));
      rects.forEach((r,i)=>{
        const c=cells[i];if(!c)return;
        const x=gap+r.x*aw,y=gap+r.y*ah,cw=Math.max(0,r.w*aw-gap),ch=Math.max(0,r.h*ah-gap);
        const resource=c.url?resources.current.get(c.id):undefined,im=resource?.image;
        clips.push({x:x/width,y:y/height,w:cw/width,h:ch/height});
        if(!im?.naturalWidth){sources.push(null);radii.push(radius);crops.push({tx:0,ty:0,scale:1,angle:0});return;}
        const liveFx=live.current.get(c.id),fx=liveFx||c.fx||{},key=fxKey(fx),r0=resource!;
        const bake=()=>{
          r0.pending=undefined;
          r0.output=hasPhotoFx(fx)?applyPhotoFx(im,im.naturalWidth,im.naturalHeight,fx,{cacheSource:true,gpuSurface:true,out:r0.input}):im;
          if(r0.output instanceof HTMLCanvasElement)r0.output.dataset.seamRevision=key;
          r0.key=key;
        };
        let shown:CanvasImageSource|null=null;
        if(liveFx&&hasPhotoFx(fx)){
          // Slider held: render the editor-sized proxy, never native pixels.
          if(r0.previewKey!==key){
            // At most one live effect surface (one extra GPU context) at a time.
            for(const other of resources.current.values())if(other!==r0)releasePreview(other);
            r0.preview??=document.createElement('canvas');const [pw,ph]=previewSize(im);
            r0.previewOutput=applyPhotoFx(im,pw,ph,fx,{cacheSource:true,gpuSurface:true,out:r0.preview});
            r0.previewOutput.dataset.seamRevision=key;r0.previewKey=key;
          }
          editPresentation.current=true;shown=r0.previewOutput!;
        }else if(r0.key!==key){
          if(hasPhotoFx(fx)&&r0.previewKey===key&&r0.previewOutput){
            // Just released: keep the identical proxy on screen and finish the
            // native-resolution pixels when the editor is idle, not on pointerup.
            editPresentation.current=true;shown=r0.previewOutput;
            if(r0.pending!==key){r0.pending=key;void awaitPhotoIdle().then(()=>{
              if(r0.pending!==key||resources.current.get(c.id)!==r0||live.current.has(c.id))return;
              bake();schedule();
            });}
          }else{
            if(hasPhotoFx(fx))editPresentation.current=true;
            bake();
          }
        }
        const source=shown||resource!.output!,iw=(source as any).naturalWidth||(source as any).width,ih=(source as any).naturalHeight||(source as any).height;
        const turn=Math.abs(c.rotation%180)===90;
        const scale=Math.max(r.w*aw/(turn?ih:iw),r.h*ah/(turn?iw:ih))*1.02*c.zoom;
        const dx=c.offsetX*r.w*aw,dy=c.offsetY*r.h*ah,angle=c.rotation*Math.PI/180;
        const cr=c.imgRadius?Math.min(cw,ch)*Math.min(.5,Math.max(0,c.imgRadius/100)):Math.min(radius,cw/2,ch/2);
        sources.push({image:source,width:iw,height:ih});radii.push(cr);
        crops.push({tx:dx*Math.cos(angle)+dy*Math.sin(angle),ty:-dx*Math.sin(angle)+dy*Math.cos(angle),scale,angle});
      });
      const fused=fusionLive.current!==undefined;
      if(editPresentation.current&&!fused){
        // WebKit can directly crop a native FX canvas into a physical-pixel
        // 2D surface. Re-uploading its entire multi-megapixel framebuffer to a
        // second GL context on EACH slider tick is substantially slower.
        // This is not a lower-quality draft: both paths sample full originals
        // at identical screen density. Retain these exact pixels on release.
        if(flat.width!==W)flat.width=W;if(flat.height!==H)flat.height=H;
        flat.style.width=cv.style.width;flat.style.height=cv.style.height;flat.style.transform=cv.style.transform;flat.style.clipPath=cv.style.clipPath;
        const v=surface.view,m=new DOMMatrix([v.xx/W,v.yx/W,v.xy/H,v.yy/H,v.x0,v.y0]).inverse();
        const g=get2dWide(flat)!;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,W,H);g.setTransform(m);g.imageSmoothingQuality='high';
        // Cover the 2D canvas's half-texel footprint and clip antialiasing at
        // shared edges: each clip overlaps its neighbours by ~1 raster pixel.
        const bleedX=noVisibleGutter?(Math.abs(v.xx/W)+Math.abs(v.xy/H))*1.25:0;
        const bleedY=noVisibleGutter?(Math.abs(v.yx/W)+Math.abs(v.yy/H))*1.25:0;
        clips.forEach((_,i)=>{
          // Layout rects, not the normalized clips: those are already scaled
          // by the full width and would shift every cell by the gutter.
          const r=rects[i],source=sources[i],crop=crops[i],c=cells[i];
          const x0=gap+r.x*aw,y0=gap+r.y*ah,w0=Math.max(0,r.w*aw-gap),h0=Math.max(0,r.h*ah-gap);
          const leftBleed=noVisibleGutter&&r.x>1e-6?bleedX:0,rightBleed=noVisibleGutter&&r.x+r.w<1-1e-6?bleedX:0;
          const topBleed=noVisibleGutter&&r.y>1e-6?bleedY:0,bottomBleed=noVisibleGutter&&r.y+r.h<1-1e-6?bleedY:0;
          const x=x0-leftBleed,y=y0-topBleed,cw=w0+leftBleed+rightBleed,ch=h0+topBleed+bottomBleed;
          if(!source){g.fillStyle='#121212';g.fillRect(x,y,cw,ch);return;}
          // Keep the crop's optical center on the unbled cell, so the overlap
          // never moves the photo's framing.
          const cx=x0+w0/2+crop.tx*Math.cos(crop.angle)-crop.ty*Math.sin(crop.angle),cy=y0+h0/2+crop.tx*Math.sin(crop.angle)+crop.ty*Math.cos(crop.angle);
          const {image,width:iw,height:ih}=source;
          g.save();g.globalAlpha=(c.opacity??100)/100;
          if(radii[i]>0||crop.angle){g.beginPath();g.roundRect(x,y,cw,ch,radii[i]);g.clip();g.translate(cx,cy);g.rotate(crop.angle);g.drawImage(image,-iw*crop.scale/2,-ih*crop.scale/2,iw*crop.scale,ih*crop.scale);}
          else drawCoveredPhoto(g,image,(x-cx)/crop.scale+iw/2,(y-cy)/crop.scale+ih/2,cw/crop.scale,ch/crop.scale,x,y,cw,ch);
          g.restore();
        });
      }else{
        // Geometry-only frames change GPU uniforms, never re-run effects.
        if(fused)drawSeamPreview(cv,cells,clips,sources,fusionLive.current!,surface.view);
        else drawSeamPreview(cv,cells,clips,sources,-1,{...surface.view,isolated:true,sealEdges:noVisibleGutter,radii,crops});
      }
      const flatShown=editPresentation.current&&!fused;
      flat.style.display=flatShown?'block':'none';cv.style.display=flatShown?'none':'block';
      flat.toggleAttribute('data-layout-photo-surface',flatShown);cv.toggleAttribute('data-layout-photo-surface',!flatShown);
      const shown=flatShown?flat:cv;
      if(import.meta.env.DEV){shown.dataset.paintCount=String(Number(shown.dataset.paintCount||0)+1);shown.dataset.rasterView=JSON.stringify(surface.rasterView);shown.dataset.sourceKeys=JSON.stringify([...resources.current.values()].map(r=>r.key));}
    };
    drawRef.current();
  },[cells,rects,width,height,gap,radius,revision,surfaceGeneration,fusion]);
  return <><svg ref={plane} data-layout-photo-plane viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden style={{position:'absolute',left:0,top:0,pointerEvents:'none',zIndex:0,overflow:'hidden'}}><g opacity={0}><circle data-layout-probe cx={0} cy={0} r={.005}/><circle data-layout-probe cx={width} cy={0} r={.005}/><circle data-layout-probe cx={0} cy={height} r={.005}/></g></svg><canvas key={surfaceGeneration} ref={ref} data-layout-photo-surface style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0}}/><canvas ref={editSurface} style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0,display:'none'}}/></>;
}
