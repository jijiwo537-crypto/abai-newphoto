import React,{useLayoutEffect,useEffect,useRef} from 'react';
import {applyPhotoFx,hasPhotoFx,releasePhotoFxSurface,settlePhotoFx,getLoadedLut,type PhotoFx} from '../utils/photoFx';
import {awaitPhotoIdle} from '../utils/photoInteractionIdle';
import {subscribeCellPhoto,subscribeCellPrime,isEditingCell,subscribeEditingCell} from '../utils/liveCellPhoto';
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
const OVERSCAN_PIXELS=5_000_000;
/** 手勢中補畫的那一張（盡量是整個佈局）最多幾個實體像素；不夠就降一點解析度，停下來再畫清楚 */
const GESTURE_PIXELS=6_000_000;
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
export function LayoutPhotoSurface({cells,rects,width,height,gap,radius,revision,fusion,previewId,dims}:{cells:Cell[];rects:Rect[];width:number;height:number;gap:number;radius:number;revision:number;fusion?:number;previewId?:string;
  /** 每一格的亮度倍率（長按互換時被懸停的那一格 < 1）。直接在畫照片時變暗，範圍跟照片完全一致。 */
  dims?:number[]}){
  const ref=useRef<HTMLCanvasElement>(null),editSurface=useRef<HTMLCanvasElement>(null),editPresentation=useRef(false),lastView=useRef(''),plane=useRef<SVGSVGElement>(null),resources=useRef(new Map<string,Resource>()),live=useRef(new Map<string,PhotoFx>()),frame=useRef(0),drawRef=useRef<(viewOnly?:boolean)=>void>(()=>{});
  /** 上一次真的畫出來的範圍（佈局座標）與當時的倍率／旋轉：純平移時拿來判斷要不要重畫 */
  const paintedView=useRef<{fwd:number[];gesture:boolean;headroom?:number;cover:{x0:number;y0:number;x1:number;y1:number}}|null>(null),settleTimer=useRef<ReturnType<typeof setTimeout>|0>(0),lastPaintAt=useRef(-1e9);
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
    window.addEventListener('abai-preview-transform',paint,true);window.addEventListener('abai-layout-visual',paint);
    window.addEventListener('scroll',paint,true);window.addEventListener('resize',paint);
    const observer=new ResizeObserver(paint);if(plane.current)observer.observe(plane.current);
    return()=>{observer.disconnect();window.removeEventListener('abai-preview-transform',paint,true);window.removeEventListener('abai-layout-visual',paint);window.removeEventListener('scroll',paint,true);window.removeEventListener('resize',paint);};
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
  // 編輯結束（或換編輯別格）：之前延後的原尺寸成品現在排進去
  useEffect(()=>subscribeEditingCell(()=>schedule()),[]);
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
    drawRef.current=(viewOnly=false,settle=false)=>{
      const cv=ref.current,flat=editSurface.current,root=plane.current;if(!cv||!flat||!root||width<=0||height<=0)return;
      const aw=Math.max(1,width-gap),ah=Math.max(1,height-gap);
      const points=Array.from(root.querySelectorAll<SVGCircleElement>('[data-layout-probe]')).map(n=>{const b=n.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
      const bounds=root.getBoundingClientRect(),clip=root.closest('[data-grid-preview-viewport]')?.getBoundingClientRect();
      // Always render at physical screen density directly from full originals,
      // never a fixed-size intermediate stretched by CSS. Bound allocation to
      // the visible viewport, rather than to the possibly huge layout.
      const dpr=devicePixelRatio||1;
      const vis={left:Math.max(0,clip?.left??0),top:Math.max(0,clip?.top??0),right:Math.min(innerWidth,clip?.right??innerWidth),bottom:Math.min(innerHeight,clip?.bottom??innerHeight)};
      /* 整個佈局在手勢中當成「一張圖片」：
         放大縮小、平移時，已經畫好的這張畫布直接跟著頁面一起縮放移動（純合成，不重畫）——
         以前每動一格都整張重畫三次，每次還要從 GPU 讀回幾百萬像素：拖起來卡，而且每一格
         重新對齊像素，佈局裡的照片看起來會抖。只有畫好的範圍蓋不住畫面時才補畫一次，
         手勢停下來（160ms 沒有新的變化）再照實際倍率畫一張最清楚的。
         平常（停著）在看得到的範圍外多畫一圈：快速滑動時剛滑進來的部分已經畫好；
         放大到頁面被切到時，瀏覽器擺放畫布的那 1px 誤差也不會露出底色。 */
      const [pa,pb,pc]=points;
      const fwd=pa&&pb&&pc?[(pb.x-pa.x)/width,(pb.y-pa.y)/width,(pc.x-pa.x)/height,(pc.y-pa.y)/height]:null;
      const painted=paintedView.current;
      const sameScale=!!fwd&&!!painted&&fwd.every((v,i)=>Math.abs(v-painted.fwd[i])<=1e-7*Math.max(1,Math.abs(v)));
      const vw=Math.max(0,vis.right-vis.left),vh=Math.max(0,vis.bottom-vis.top);
      const settleLater=()=>{if(settleTimer.current)clearTimeout(settleTimer.current);settleTimer.current=setTimeout(()=>{settleTimer.current=0;drawRef.current(false,true);},160);};
      const worldBox=(corners:number[][],m:DOMMatrix)=>{const q=corners.map(([x,y])=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}));
        return {x0:Math.max(0,Math.min(...q.map(v=>v.x))),y0:Math.max(0,Math.min(...q.map(v=>v.y))),x1:Math.min(width,Math.max(...q.map(v=>v.x))),y1:Math.min(height,Math.max(...q.map(v=>v.y)))};};
      if(viewOnly&&fwd&&painted){
        const inv=new DOMMatrix([fwd[0],fwd[1],fwd[2],fwd[3],pa.x,pa.y]).inverse();
        const n=worldBox([[vis.left,vis.top],[vis.right,vis.top],[vis.left,vis.bottom],[vis.right,vis.bottom]],inv),c=painted.cover;
        /* 現在比畫好的那張「放大」了多少。瀏覽器把它拉大超過它多畫的那份解析度（headroom）
           就會糊 —— 那就是快速放大時看到的「先糊再變清楚」。縮小時拉小不會糊，直接沿用。 */
        const mag=Math.hypot(fwd[0],fwd[1])/Math.max(1e-9,Math.hypot(painted.fwd[0],painted.fwd[1]));
        /* 提早補畫：不是等看得到的範圍「已經」超出畫好的那張（那一格邊上就是白的）才畫，
           而是快要碰到時（還差一成）就先補 —— 剛滑進畫面的部分一出現就已經畫好了。 */
        const ex=(n.x1-n.x0)*.1,ey=(n.y1-n.y0)*.1;
        const need={x0:Math.max(0,n.x0-ex),y0:Math.max(0,n.y0-ey),x1:Math.min(width,n.x1+ex),y1:Math.min(height,n.y1+ey)};
        if(need.x0>=c.x0-1e-6&&need.y0>=c.y0-1e-6&&need.x1<=c.x1+1e-6&&need.y1<=c.y1+1e-6&&mag<=(painted.headroom||1)*1.0005){
          // 畫好的那張還蓋得住、也夠清楚：手勢中不重畫。倍率變了停下來再照實際倍率畫一張
          if(!sameScale||painted.gesture)settleLater();
          return;
        }
      }
      if(settleTimer.current){clearTimeout(settleTimer.current);settleTimer.current=0;}
      /* 手勢中真的要補畫（畫好的範圍蓋不住了）：盡量一次畫整個佈局，之後整段手勢都不必再畫。 */
      const gesture=viewOnly&&!!painted&&!sameScale;
      let density=dpr,area={left:vis.left,top:vis.top,right:vis.right,bottom:vis.bottom},mx=8,my=8;
      let headroom=1,settleAfterPaint=false;
      if(gesture){
        const zoomingIn=!!painted&&Math.hypot(fwd![0],fwd![1])>Math.hypot(painted.fwd[0],painted.fwd[1])*1.0005;
        if(zoomingIn){
          /* 正在放大：只畫看得到的那一塊，但密度一次多給到 GESTURE_PIXELS 的上限（最多 2.5 倍）——
             接下來放大到那個倍數之前，瀏覽器拉大這張都還是清楚的，不必每一格重畫
             （每重畫一次都要把整張從共用的 GPU 畫面抄過來，iPhone 上很貴）。 */
          // 範圍＝看得到的那塊四周再多兩成（手勢中邊放大邊移動，剛移進來的地方已經畫好）
          headroom=vw*vh>0?Math.max(1,Math.min(2.5,Math.sqrt(GESTURE_PIXELS/(vw*vh*1.96*dpr*dpr)))):1;
          density=dpr*headroom;mx=vw*.2;my=vh*.2;
        }else{
          /* 縮小或平移到畫好的範圍外：一律照螢幕密度（清楚）。整個佈局畫得下就一次畫完，
             接下來整段手勢都蓋得住；畫不下就畫看得到的那塊再往外多一大圈（最多 2.5 倍），
             要再縮小 2.5 倍才需要補下一次。 */
          const whole=bounds.width*bounds.height*dpr*dpr;
          if(whole>0&&whole<=GESTURE_PIXELS){area={left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom};mx=my=0;}
          else{const g=vw*vh>0?Math.max(1,Math.min(2.5,Math.sqrt(GESTURE_PIXELS/(vw*vh*dpr*dpr)))):1;mx=Math.max(8,vw*(g-1)/2);my=Math.max(8,vh*(g-1)/2);}
        }
        // 「停下來再畫清楚」的計時要從這次畫完才開始算（見最後），不然畫得久一點計時就先到了
        settleAfterPaint=true;
      }else if(!settle&&performance.now()-lastPaintAt.current<250){
        /* 內容連續在變（拖照片、在格子裡縮放照片、拖滑桿）：每一格都得重畫，只畫看得到的
           那一塊加一小圈，停下來再補完整的那圈 —— 不然每一格都要多畫三倍的像素。 */
        settleLater();
      }else{
        const g=vw*vh>0?Math.max(1,Math.min(1.8,Math.sqrt(OVERSCAN_PIXELS/(vw*vh*dpr*dpr)))):1;
        mx=Math.max(8,vw*(g-1)/2);my=Math.max(8,vh*(g-1)/2);
      }
      lastPaintAt.current=performance.now();
      /* 佈局貼齊（或超出）頁面邊緣的那幾邊往外多蓋一個裝置像素（見 resolveSeamSurface 的 grow）。
         只在沒有外圈間距時做：有間距時邊上本來就該露出頁面底色。 */
      const pageBox=root.closest('[data-page-id]')?.getBoundingClientRect();
      /* 內容往外多畫 1.5 個螢幕像素（裁切線另外只開到半個螢幕像素，見 resolveSeamSurface）：
         排頁面時整頁縮到 0.4 倍、這張還沒重畫就先被瀏覽器縮小，1.5 縮完仍有 0.6，蓋得住那半個像素。 */
      const edgeTol=1/dpr,g1=1.5,sealed=gap<=.001&&radius<=.001;
      /* 整條頁面的最外圈（第一頁左邊、最後一頁右邊、上下）跟照片同一招：內容往外多蓋 4 個螢幕像素，
         而且這幾邊「自己不裁」，只讓整條頁面那一刀去切。同一條邊裁兩次，兩刀的抗鋸齒會疊在一起，
         邊上那一排蓋不滿、頁面底色就透出來 —— 這就是照片從來沒縫、佈局一直有縫的差別。
         4 個像素：排頁面縮到 0.4 倍、這張還沒重畫時仍剩 1.6 個像素。
         頁與頁中間的交界不能壓到隔壁頁，照舊只多蓋一點點、裁在半個像素外。 */
      const strip=root.closest('[data-page-id]')?.parentElement?.getBoundingClientRect();
      const G=4;
      const outer=strip&&sealed?{l:bounds.left<=strip.left+edgeTol,t:bounds.top<=strip.top+edgeTol,r:bounds.right>=strip.right-edgeTol,b:bounds.bottom>=strip.bottom-edgeTol}:undefined;
      const grow=pageBox&&sealed?{l:outer?.l?G:bounds.left<=pageBox.left+edgeTol?g1:0,t:outer?.t?G:bounds.top<=pageBox.top+edgeTol?g1:0,
        r:outer?.r?G:bounds.right>=pageBox.right-edgeTol?g1:0,b:outer?.b?G:bounds.bottom>=pageBox.bottom-edgeTol?g1:0,open:outer}:undefined;
      const surface=resolveSeamSurface(points,width,height,width,height,bounds,{left:area.left-mx,top:area.top-my,right:area.right+mx,bottom:area.bottom+my},density,grow);
      if(surface&&fwd){
        const [ia,ib,ic,id,ie,iff]=surface.rasterView;const sw=surface.width,sh=surface.height;
        const cs=[[0,0],[sw,0],[0,sh],[sw,sh]].map(([x,y])=>({x:ia*x+ic*y+ie,y:ib*x+id*y+iff}));
        paintedView.current={fwd,gesture,headroom,cover:{x0:Math.min(...cs.map(q=>q.x)),y0:Math.min(...cs.map(q=>q.y)),x1:Math.max(...cs.map(q=>q.x)),y1:Math.max(...cs.map(q=>q.y))}};
      }else paintedView.current=null;
      if(!surface){cv.style.display='none';flat.style.display='none';return;}cv.style.display='block';
      // 長按互換時要變暗的格子跟著這一次的畫面參數一起交給著色器（見 seamlessPreview 的 dim）
      (surface.view as {dims?:number[]}).dims=dims;
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
              // 還在編輯這一格：先不算原尺寸成品（見 liveCellPhoto 的 setEditingCell），編輯結束會再排一次
              if(isEditingCell(c.id)){r0.pending=undefined;return;}
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
        const prev=flatState.current,sigs=contents.map((c,i)=>c+'|d'+(dims?.[i]??1));
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
          // 被懸停的那一格：同一個裁切範圍裡蓋一層黑（source-atop＝只蓋在剛畫上去的像素上）
          const dm=dims?.[i]??1;
          if(dm<1){g.save();g.globalCompositeOperation='source-atop';g.fillStyle=`rgba(0,0,0,${1-dm})`;g.beginPath();if(radii[i]>0)g.roundRect(x,y,cw,ch,radii[i]);else g.rect(x,y,cw,ch);g.fill();g.restore();}
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
      if(settleAfterPaint)settleLater();
    };
    drawRef.current();
  },[cells,rects,width,height,gap,radius,revision,fusion,(dims||[]).join(',')]);
  return <><svg ref={plane} data-layout-photo-plane viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden style={{position:'absolute',left:0,top:0,pointerEvents:'none',zIndex:0,overflow:'hidden'}}><g opacity={0}><circle data-layout-probe cx={0} cy={0} r={.005}/><circle data-layout-probe cx={width} cy={0} r={.005}/><circle data-layout-probe cx={0} cy={height} r={.005}/></g></svg><canvas ref={ref} data-layout-photo-surface style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0}}/><canvas ref={editSurface} style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0,display:'none'}}/></>;
}
