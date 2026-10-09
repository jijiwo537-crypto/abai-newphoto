import React,{useLayoutEffect,useEffect,useRef} from 'react';
import {applyPhotoFx,hasPhotoFx,releasePhotoFxSurface,settlePhotoFx,getLoadedLut,type PhotoFx} from '../utils/photoFx';
import {awaitPhotoIdle} from '../utils/photoInteractionIdle';
import {subscribeCellPhoto,subscribeCellPrime} from '../utils/liveCellPhoto';
import {resolveSeamSurface} from '../utils/seamlessSurfaceGeometry';
import {drawSeamShared,releaseSeamShared,drawSeamPreview,type SeamTexture} from '../utils/seamlessPreview';
import {previews as seamlessPreviews} from './SeamlessLayout';
import {drawCoveredPhoto} from '../utils/coveredPhoto';
import {get2dWide} from '../utils/colorSpace';
import {cellPhotoPlacement} from '../utils/layoutCellPhoto';

/* 拖融合程度滑桿的那幾格：共用的 GPU 畫面每格都要複製進這個佈局的 2D 畫布（iOS 上是一次
   同步讀回）。拖曳中改成整個編輯器共用的一張 WebGL 畫布直接疊在原位顯示，同一組像素；
   放開後回到原本那條路，這張就收掉。同一時間只會有一個佈局在拖。 */
let liveSeam:HTMLCanvasElement|null=null;
const surfaceTokens=new WeakMap<object,number>();let surfaceSerial=0;
const surfaceToken=(o:object)=>{let t=surfaceTokens.get(o);if(!t)surfaceTokens.set(o,t=++surfaceSerial);return t;};
const dropLiveSeam=(owner?:HTMLCanvasElement|null)=>{if(liveSeam&&(!owner||liveSeam.previousSibling===owner)){liveSeam.remove();}};
type Cell={id:string;url:string;naturalWidth?:number;naturalHeight?:number;zoom:number;offsetX:number;offsetY:number;rotation:number;opacity?:number;imgRadius?:number;fx?:PhotoFx};
type Rect={x:number;y:number;w:number;h:number};
type Resource={url:string;image:HTMLImageElement;input:HTMLCanvasElement;key:string;output:CanvasImageSource|null;
  /** Editor-sized proxy used while a slider is held (same size as the home editor preview). */
  preview?:HTMLCanvasElement;previewKey?:string;previewOutput?:HTMLCanvasElement|null;pending?:string;primed?:boolean};
// The home editor previews at 1800px. Matching it keeps every slider frame
// independent of the photo's native size (12MP+ on phones).
const LIVE_PREVIEW=1800;
/** 每個佈局畫布（含畫面外多畫的那一圈）最多幾個實體像素 */
const OVERSCAN_PIXELS=9_000_000;
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
  const ref=useRef<HTMLCanvasElement>(null),editSurface=useRef<HTMLCanvasElement>(null),editPresentation=useRef(false),lastView=useRef(''),plane=useRef<SVGSVGElement>(null),resources=useRef(new Map<string,Resource>()),live=useRef(new Map<string,PhotoFx>()),frame=useRef(0),drawRef=useRef<(viewOnly?:boolean)=>void>(()=>{});
  /** 上一次真的畫出來的範圍（佈局座標）與當時的倍率／旋轉：純平移時拿來判斷要不要重畫 */
  const paintedView=useRef<{fwd:number[];cover:{x0:number;y0:number;x1:number;y1:number}}|null>(null),settleTimer=useRef<ReturnType<typeof setTimeout>|0>(0);
  // The layout canvas is a plain 2D bitmap fed by the editor-wide shared GPU
  // renderer (drawSeamShared), so it can never lose a context or turn grey.
  const fusionLive=useRef(fusion),liveDrag=useRef(false);
  // What the flat (effect-editing) canvas currently holds: its geometry and each cell's pixels.
  const flatState=useRef<{geom:string;sigs:string[]}|null>(null);
  /** 拖特效時直接疊在原位的那一格 GPU 預覽（見 flat 那一段） */
  const liveCell=useRef<HTMLDivElement|null>(null);
  const dropLiveCell=()=>{const host=liveCell.current;if(!host)return;host.remove();const clip=host.firstElementChild?.firstElementChild;clip?.replaceChildren();};
  useLayoutEffect(()=>{fusionLive.current=fusion;},[fusion]);
  // The fusion slider repaints uniforms directly, without a React render.
  useLayoutEffect(()=>{if(!previewId||fusion===undefined)return;seamlessPreviews.set(previewId,(v,isLive)=>{fusionLive.current=v;liveDrag.current=!!isLive;drawRef.current();});return()=>{seamlessPreviews.delete(previewId);};},[previewId,fusion===undefined]);
  const schedule=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;drawRef.current();});};
  useEffect(()=>{const element=ref.current;return()=>{cancelAnimationFrame(frame.current);if(settleTimer.current)clearTimeout(settleTimer.current);for(const r of resources.current.values())releaseResource(r);resources.current.clear();if(element){releaseSeamShared(element);dropLiveSeam(element);}dropLiveCell();};},[]);
  useEffect(()=>{
    // Repaint in the SAME transform frame, not a second rAF one frame later.
    // Sources and FX remain cached; zoom only resamples their visible pixels.
    const paint=()=>drawRef.current(true);
    window.addEventListener('abai-preview-transform',paint,true);
    window.addEventListener('scroll',paint,true);window.addEventListener('resize',paint);
    const observer=new ResizeObserver(paint);if(plane.current)observer.observe(plane.current);
    return()=>{observer.disconnect();window.removeEventListener('abai-preview-transform',paint,true);window.removeEventListener('scroll',paint,true);window.removeEventListener('resize',paint);};
  },[]);
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
    drawRef.current=(viewOnly=false)=>{
      const cv=ref.current,flat=editSurface.current,root=plane.current;if(!cv||!flat||!root||width<=0||height<=0)return;
      const aw=Math.max(1,width-gap),ah=Math.max(1,height-gap);
      const points=Array.from(root.querySelectorAll<SVGCircleElement>('[data-layout-probe]')).map(n=>{const b=n.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
      const bounds=root.getBoundingClientRect(),clip=root.closest('[data-grid-preview-viewport]')?.getBoundingClientRect();
      // Always render at physical screen density directly from full originals,
      // never a fixed-size intermediate stretched by CSS. Bound allocation to
      // the visible viewport, rather than to the possibly huge layout.
      const dpr=devicePixelRatio||1;
      const vis={left:Math.max(0,clip?.left??0),top:Math.max(0,clip?.top??0),right:Math.min(innerWidth,clip?.right??innerWidth),bottom:Math.min(innerHeight,clip?.bottom??innerHeight)};
      /* 看得到的範圍外面多畫一圈：
         ① 快速滑動時瀏覽器先把畫面捲過去、捲動事件晚一兩格才到 —— 以前剛滑進來的那一條
            是空的（白的），等重畫才出來。
         ② 放大到頁面被畫面邊緣切到時，瀏覽器實際擺放這張畫布會跟量到的位置差到 1px，
            邊緣就露出一條底色（白線）。多畫一圈之後邊緣永遠落在畫好的像素裡。
         ③ 單純平移、而且多畫的那圈還夠用時就不重畫（見 viewOnly），滑動也更省。 */
      const [pa,pb,pc]=points;
      const fwd=pa&&pb&&pc?[(pb.x-pa.x)/width,(pb.y-pa.y)/width,(pc.x-pa.x)/height,(pc.y-pa.y)/height]:null;
      const painted=paintedView.current;
      const sameScale=!!fwd&&!!painted&&fwd.every((v,i)=>Math.abs(v-painted.fwd[i])<=1e-7*Math.max(1,Math.abs(v)));
      /* 正在縮放（倍率每一格都在變、每一格都同步重畫）時只多畫一小圈，手勢才不會變重；
         停下來之後再補畫完整的那一圈。 */
      const zooming=!!fwd&&!!painted&&!sameScale;
      const vw=Math.max(0,vis.right-vis.left),vh=Math.max(0,vis.bottom-vis.top);
      const grow=!zooming&&vw*vh>0?Math.max(1,Math.min(1.8,Math.sqrt(OVERSCAN_PIXELS/(vw*vh*dpr*dpr)))):1;
      const mx=Math.max(8,vw*(grow-1)/2),my=Math.max(8,vh*(grow-1)/2);
      if(viewOnly&&sameScale){
        // 同一個倍率、只是平移：看得到的範圍（再多留半圈）還在畫好的範圍裡就不必重畫
        const inv=new DOMMatrix([fwd[0],fwd[1],fwd[2],fwd[3],pa.x,pa.y]).inverse();
        const need=[[vis.left-mx/2,vis.top-my/2],[vis.right+mx/2,vis.top-my/2],[vis.left-mx/2,vis.bottom+my/2],[vis.right+mx/2,vis.bottom+my/2]].map(([x,y])=>({x:inv.a*x+inv.c*y+inv.e,y:inv.b*x+inv.d*y+inv.f}));
        const nx0=Math.max(0,Math.min(...need.map(q=>q.x))),nx1=Math.min(width,Math.max(...need.map(q=>q.x))),ny0=Math.max(0,Math.min(...need.map(q=>q.y))),ny1=Math.min(height,Math.max(...need.map(q=>q.y)));
        const c=painted.cover;
        if(nx0>=c.x0-1e-6&&ny0>=c.y0-1e-6&&nx1<=c.x1+1e-6&&ny1<=c.y1+1e-6){
          // 停下來之後再對齊一次實體像素（平移了非整數像素時，畫面會被瀏覽器重新取樣）
          if(settleTimer.current)clearTimeout(settleTimer.current);
          settleTimer.current=setTimeout(()=>{settleTimer.current=0;drawRef.current();},160);
          return;
        }
      }
      if(settleTimer.current){clearTimeout(settleTimer.current);settleTimer.current=0;}
      if(zooming)settleTimer.current=setTimeout(()=>{settleTimer.current=0;drawRef.current();},160);
      const surface=resolveSeamSurface(points,width,height,width,height,bounds,{left:vis.left-mx,top:vis.top-my,right:vis.right+mx,bottom:vis.bottom+my},dpr);
      if(surface&&fwd){
        const [ia,ib,ic,id,ie,iff]=surface.rasterView;const sw=surface.width,sh=surface.height;
        const cs=[[0,0],[sw,0],[0,sh],[sw,sh]].map(([x,y])=>({x:ia*x+ic*y+ie,y:ib*x+id*y+iff}));
        paintedView.current={fwd,cover:{x0:Math.min(...cs.map(q=>q.x)),y0:Math.min(...cs.map(q=>q.y)),x1:Math.max(...cs.map(q=>q.x)),y1:Math.max(...cs.map(q=>q.y))}};
      }else paintedView.current=null;
      if(!surface){cv.style.display='none';flat.style.display='none';return;}cv.style.display='block';
      const W=surface.pixelWidth,H=surface.pixelHeight;
      const viewKey=JSON.stringify(surface.rasterView);
      if(lastView.current!==viewKey){editPresentation.current=false;lastView.current=viewKey;}
      if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;
      cv.style.width=`${surface.width}px`;cv.style.height=`${surface.height}px`;
      cv.style.transform=`matrix(${surface.transform.join(',')})`;cv.style.clipPath=`polygon(${surface.clip})`;
      const sources:SeamTexture[]=[],clips:Rect[]=[],radii:number[]=[],crops:{tx:number;ty:number;scale:number;angle:number}[]=[],contents:string[]=[],previewCells:number[]=[];
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
        if(!im?.naturalWidth){sources.push(null);radii.push(radius);crops.push({tx:0,ty:0,scale:1,angle:0});contents.push('empty');return;}
        const liveFx=live.current.get(c.id),fx=liveFx||c.fx||{},key=fxKey(fx),r0=resource!;
        const bake=()=>{
          r0.pending=undefined;
          r0.output=hasPhotoFx(fx)?settlePhotoFx(applyPhotoFx(im,im.naturalWidth,im.naturalHeight,fx,{cacheSource:true,gpuSurface:true,out:r0.input}),r0.input):im;
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
        // Shared with every other preview path and the export (one framing rule).
        const {scale,dx,dy,angle}=cellPhotoPlacement(r.w*aw,r.h*ah,iw,ih,c);
        const cr=c.imgRadius?Math.min(cw,ch)*Math.min(.5,Math.max(0,c.imgRadius/100)):Math.min(radius,cw/2,ch/2);
        sources.push({image:source,width:iw,height:ih});radii.push(cr);
        contents.push(`${surfaceToken(source)}|${shown?r0.previewKey:source===im?'image':r0.key}`);
        if(shown)previewCells.push(i);
        crops.push({tx:dx*Math.cos(angle)+dy*Math.sin(angle),ty:-dx*Math.sin(angle)+dy*Math.cos(angle),scale,angle});
      });
      const fused=fusionLive.current!==undefined;
      if(editPresentation.current&&!fused){
        // WebKit can directly crop a native FX canvas into a physical-pixel
        // 2D surface. Re-uploading its entire multi-megapixel framebuffer to a
        // second GL context on EACH slider tick is substantially slower.
        // This is not a lower-quality draft: both paths sample full originals
        // at identical screen density. Retain these exact pixels on release.
        const resized=flat.width!==W||flat.height!==H;
        if(flat.width!==W)flat.width=W;if(flat.height!==H)flat.height=H;
        flat.style.width=cv.style.width;flat.style.height=cv.style.height;flat.style.transform=cv.style.transform;flat.style.clipPath=cv.style.clipPath;
        const v=surface.view,m=new DOMMatrix([v.xx/W,v.yx/W,v.xy/H,v.yy/H,v.x0,v.y0]).inverse();
        // Cover the 2D canvas's half-texel footprint and clip antialiasing at
        // shared edges: each clip overlaps its neighbours by ~1 raster pixel.
        const bleedX=noVisibleGutter?(Math.abs(v.xx/W)+Math.abs(v.xy/H))*1.25:0;
        const bleedY=noVisibleGutter?(Math.abs(v.yx/W)+Math.abs(v.yy/H))*1.25:0;
        const cellBox=(i:number)=>{
          // Layout rects, not the normalized clips: those are already scaled
          // by the full width and would shift every cell by the gutter.
          const r=rects[i];
          const x0=gap+r.x*aw,y0=gap+r.y*ah,w0=Math.max(0,r.w*aw-gap),h0=Math.max(0,r.h*ah-gap);
          const leftBleed=noVisibleGutter&&r.x>1e-6?bleedX:0,rightBleed=noVisibleGutter&&r.x+r.w<1-1e-6?bleedX:0;
          const topBleed=noVisibleGutter&&r.y>1e-6?bleedY:0,bottomBleed=noVisibleGutter&&r.y+r.h<1-1e-6?bleedY:0;
          return {x0,y0,w0,h0,x:x0-leftBleed,y:y0-topBleed,cw:w0+leftBleed+rightBleed,ch:h0+topBleed+bottomBleed};
        };
        /* 拖特效滑桿時只有正在編輯的那一格在變：其他格子的像素原封不動留在畫布上，
           只把那一格（含與鄰格重疊的那一圈）所在的整數像素方塊清掉、照原本的順序與參數把
           所有格子在這個方塊裡重畫一次（鄰格只會畫到重疊的那一兩個像素）。不必每一格都把
           每張原圖重新縮放一次；放開時畫面不重畫，所以放開那一格就是拖曳中最後一格。 */
        /* 正在拖特效的那一格（顯示的是編輯尺寸的 GPU 預覽）：跟主頁編輯一樣，那張 GPU 畫布
           直接疊在原位顯示（同一個裁切、旋轉、圓角、透明度），2D 這張不再每一格把它
           複製進來 —— iPhone 上那一下是整張從 GPU 讀回，是拖滑桿最主要的成本。
           放開後一樣疊著那一張（拖曳中最後一格＝放開那一格），閒下來算好原圖尺寸
           的成品才換回這張 2D 畫布（以前也是在那個時候換）。 */
        const overlayIdx=previewCells.length===1&&sources[previewCells[0]]?.image instanceof HTMLCanvasElement?previewCells[0]:-1;
        if(overlayIdx>=0)contents[overlayIdx]='overlay';
        const geom=JSON.stringify([W,H,v,gap,radius,noVisibleGutter,rects,crops,radii,sources.map((t,i)=>i===overlayIdx?'overlay':t&&[t.width,t.height]),cells.map(c=>[c.opacity??100])]);
        const prev=flatState.current,sigs=contents;
        let region:{l:number;t:number;r:number;b:number}|null={l:0,t:0,r:W,b:H};
        if(!resized&&prev&&prev.geom===geom&&prev.sigs.length===sigs.length){
          region=null;
          sigs.forEach((sig,i)=>{
            if(sig===prev.sigs[i])return;
            const {x,y,cw,ch}=cellBox(i);
            for(const [px,py] of [[x,y],[x+cw,y],[x,y+ch],[x+cw,y+ch]]){
              const q=m.transformPoint({x:px,y:py});
              region=region?{l:Math.min(region.l,q.x),t:Math.min(region.t,q.y),r:Math.max(region.r,q.x),b:Math.max(region.b,q.y)}:{l:q.x,t:q.y,r:q.x,b:q.y};
            }
          });
          if(region){const R=region as {l:number;t:number;r:number;b:number};region={l:Math.max(0,Math.floor(R.l)-2),t:Math.max(0,Math.floor(R.t)-2),r:Math.min(W,Math.ceil(R.r)+2),b:Math.min(H,Math.ceil(R.b)+2)};}
        }
        flatState.current={geom,sigs};
        if(region&&region.r>region.l&&region.b>region.t){
        const g=get2dWide(flat)!;g.save();g.setTransform(1,0,0,1,0,0);
        const full=region.l===0&&region.t===0&&region.r===W&&region.b===H;
        if(!full){g.beginPath();g.rect(region.l,region.t,region.r-region.l,region.b-region.t);g.clip();}
        g.clearRect(region.l,region.t,region.r-region.l,region.b-region.t);g.setTransform(m);g.imageSmoothingQuality='high';
        clips.forEach((_,i)=>{
          const source=sources[i],crop=crops[i],c=cells[i];
          const {x0,y0,w0,h0,x,y,cw,ch}=cellBox(i);
          if(i===overlayIdx)return;
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
        g.restore();
        }
        if(overlayIdx>=0){
          const i=overlayIdx,source=sources[i]!,crop=crops[i],{x0,y0,w0,h0,x,y,cw,ch}=cellBox(i);
          const cx=x0+w0/2+crop.tx*Math.cos(crop.angle)-crop.ty*Math.sin(crop.angle),cy=y0+h0/2+crop.tx*Math.sin(crop.angle)+crop.ty*Math.cos(crop.angle);
          const host=liveCell.current||(liveCell.current=document.createElement('div'));
          if(host.previousSibling!==flat)flat.after(host);
          // 同一個外框（尺寸、transform、clip-path）；裡面用「版面座標 → 這個外框」的矩陣擺放
          Object.assign(host.style,{position:'absolute',left:'0',top:'0',transformOrigin:'0 0',pointerEvents:'none',zIndex:'0',display:'block',overflow:'visible',
            width:flat.style.width,height:flat.style.height,transform:flat.style.transform,clipPath:flat.style.clipPath});
          const sx=parseFloat(flat.style.width)/W,sy=parseFloat(flat.style.height)/H;
          let plane=host.firstElementChild as HTMLDivElement|null;
          if(!plane){plane=document.createElement('div');host.appendChild(plane);plane.appendChild(document.createElement('div'));}
          Object.assign(plane.style,{position:'absolute',left:'0',top:'0',width:`${width}px`,height:`${height}px`,transformOrigin:'0 0',
            transform:`matrix(${sx*m.a},${sy*m.b},${sx*m.c},${sy*m.d},${sx*m.e},${sy*m.f})`});
          const clip=plane.firstElementChild as HTMLDivElement;
          Object.assign(clip.style,{position:'absolute',left:`${x}px`,top:`${y}px`,width:`${cw}px`,height:`${ch}px`,overflow:'hidden',
            borderRadius:`${radii[i]||0}px`,opacity:String((cells[i].opacity??100)/100)});
          const image=source.image as HTMLCanvasElement;
          if(image.parentElement!==clip||clip.childNodes.length!==1)clip.replaceChildren(image);
          const dw=source.width*crop.scale,dh=source.height*crop.scale;
          Object.assign(image.style,{position:'absolute',display:'block',pointerEvents:'none',left:`${cx-x-dw/2}px`,top:`${cy-y-dh/2}px`,
            width:`${dw}px`,height:`${dh}px`,transformOrigin:'50% 50%',transform:crop.angle?`rotate(${crop.angle}rad)`:'none'});
        }else dropLiveCell();
      }else{
        dropLiveCell();
        flatState.current=null;
        // Geometry-only frames change GPU uniforms, never re-run effects.
        let direct=false;
        if(fused&&liveDrag.current&&cv.parentElement){
          try{
            const layer=liveSeam||(liveSeam=document.createElement('canvas'));
            if(layer.width!==W)layer.width=W;if(layer.height!==H)layer.height=H;
            Object.assign(layer.style,{position:'absolute',left:'0',top:'0',transformOrigin:'0 0',pointerEvents:'none',zIndex:'0',display:'block',
              width:cv.style.width,height:cv.style.height,transform:cv.style.transform,clipPath:cv.style.clipPath});
            if(layer.previousSibling!==cv)cv.after(layer);
            drawSeamPreview(layer,cells,clips,sources,fusionLive.current!,surface.view,true,true,true);
            cv.style.visibility='hidden';direct=true;
          }catch{dropLiveSeam(cv);}
        }
        if(!direct){dropLiveSeam(cv);cv.style.visibility='';}
        if(direct){/* 這一格由上面那層顯示 */}
        else if(fused)drawSeamShared(cv,cells,clips,sources,fusionLive.current!,surface.view);
        else drawSeamShared(cv,cells,clips,sources,-1,{...surface.view,isolated:true,sealEdges:noVisibleGutter,radii,crops});
      }
      const flatShown=editPresentation.current&&!fused;
      flat.style.display=flatShown?'block':'none';cv.style.display=flatShown?'none':'block';
      flat.toggleAttribute('data-layout-photo-surface',flatShown);cv.toggleAttribute('data-layout-photo-surface',!flatShown);
      const shown=flatShown?flat:cv;
      if(import.meta.env.DEV){shown.dataset.paintCount=String(Number(shown.dataset.paintCount||0)+1);shown.dataset.rasterView=JSON.stringify(surface.rasterView);shown.dataset.sourceKeys=JSON.stringify([...resources.current.values()].map(r=>r.key));}
    };
    drawRef.current();
  },[cells,rects,width,height,gap,radius,revision,fusion]);
  return <><svg ref={plane} data-layout-photo-plane viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden style={{position:'absolute',left:0,top:0,pointerEvents:'none',zIndex:0,overflow:'hidden'}}><g opacity={0}><circle data-layout-probe cx={0} cy={0} r={.005}/><circle data-layout-probe cx={width} cy={0} r={.005}/><circle data-layout-probe cx={0} cy={height} r={.005}/></g></svg><canvas ref={ref} data-layout-photo-surface style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0}}/><canvas ref={editSurface} style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0,display:'none'}}/></>;
}
