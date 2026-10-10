import React,{useLayoutEffect,useEffect,useRef} from 'react';
import {applyPhotoFx,hasPhotoFx,releasePhotoFxSurface,settlePhotoFx,getLoadedLut,type PhotoFx} from '../utils/photoFx';
import {awaitPhotoIdle} from '../utils/photoInteractionIdle';
import {subscribeCellPhoto,subscribeCellPrime,isEditingCell,subscribeEditingCell} from '../utils/liveCellPhoto';
import {resolveSeamSurface} from '../utils/seamlessSurfaceGeometry';
import {drawSeamShared,releaseSeamShared,drawSeamPreview,seamTextureEpoch,type SeamTexture} from '../utils/seamlessPreview';
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
/** 間距／圓角滑桿拖動中：直接把值交給這個佈局重畫（不經過 React，整個編輯器不必每一格重新渲染）。
 *  傳的是佈局本身的值（還沒乘佈局縮放），null＝放開、回到 props。 */
export const layoutGeomPreviews=new Map<string,(g:{gap?:number;radius?:number}|null)=>void>();
/* 底圖（整個佈局一張、跟著佈局一起縮放、不因視角重畫）：所有佈局共用的總像素預算。
   一個佈局最多 4M，佈局多時平分 12M（每張 2D 畫布 4 bytes/px）。iOS Safari 所有畫布加起來有記憶體上限，
   超過時畫布會默默畫不出來（整個佈局消失），所以底圖夠用時，上面那張清晰畫布的點陣也會釋放掉。 */
const BASE_PIXELS=4_000_000,BASE_TOTAL=12_000_000;
let liveBases=0;
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
export function LayoutPhotoSurface({cells,rects,width,height,gap:gapProp,radius:radiusProp,geomScale=1,revision,fusion,previewId,dims}:{cells:Cell[];rects:Rect[];width:number;height:number;gap:number;radius:number;
  /** 佈局縮放（props 的 gap／radius 已經乘過；滑桿直接傳來的值要乘這個） */
  geomScale?:number;revision:number;fusion?:number;previewId?:string;
  /** 每一格的亮度倍率（長按互換時被懸停的那一格 < 1）。直接在畫照片時變暗，範圍跟照片完全一致。 */
  dims?:number[]}){
  const baseRef=useRef<HTMLCanvasElement>(null);
  /** 底圖目前畫的是什麼：內容簽章、密度（每個佈局單位幾個像素）、邊緣狀態（哪幾邊往外多蓋） */
  const baseState=useRef<{key:string;s:number;edges:string}|null>(null),baseDirty=useRef(true);
  const ref=useRef<HTMLCanvasElement>(null),editSurface=useRef<HTMLCanvasElement>(null),editPresentation=useRef(false),lastView=useRef(''),plane=useRef<SVGSVGElement>(null),resources=useRef(new Map<string,Resource>()),live=useRef(new Map<string,PhotoFx>()),frame=useRef(0),drawRef=useRef<(viewOnly?:boolean)=>void>(()=>{});
  /** 上一次真的畫出來的範圍（佈局座標）與當時的倍率／旋轉：純平移時拿來判斷要不要重畫 */
  const paintedView=useRef<{fwd:number[];gesture:boolean;headroom?:number;cover:{x0:number;y0:number;x1:number;y1:number}}|null>(null),settleTimer=useRef<ReturnType<typeof setTimeout>|0>(0),lastPaintAt=useRef(-1e9);
  /** 底圖重畫的計時：最後一次內容變動後 400ms 都沒再動才畫（拖滑桿中間停一下不會突然卡一下） */
  const baseTimer=useRef<ReturnType<typeof setTimeout>|0>(0),lastEditAt=useRef(-1e9),retries=useRef(0);
  // The layout canvas is a plain 2D bitmap fed by the editor-wide shared GPU
  // renderer (drawSeamShared), so it can never lose a context or turn grey.
  const fusionLive=useRef(fusion),liveDrag=useRef(false);
  const geomLive=useRef<{gap?:number;radius?:number}|null>(null),geomScaleRef=useRef(geomScale);geomScaleRef.current=geomScale;
  // React 已經把放開時的值寫進 props：拖動中的暫時值就不需要了（同一次 render，不會閃回舊值）
  useLayoutEffect(()=>{geomLive.current=null;},[gapProp,radiusProp]);
  useLayoutEffect(()=>{if(!previewId)return;layoutGeomPreviews.set(previewId,g=>{geomLive.current=g?{...geomLive.current,...g}:null;drawRef.current();});return()=>{layoutGeomPreviews.delete(previewId);};},[previewId]);
  // What the flat (effect-editing) canvas currently holds: its geometry and each cell's pixels.
  const flatState=useRef<{geom:string;sigs:string[]}|null>(null);
  /** 拖特效時直接疊在原位的那一格 GPU 預覽（見 flat 那一段） */
  const liveCell=useRef<HTMLDivElement|null>(null);
  const dropLiveCell=()=>{const host=liveCell.current;if(!host)return;host.remove();const clip=host.firstElementChild?.firstElementChild;clip?.replaceChildren();};
  useLayoutEffect(()=>{fusionLive.current=fusion;},[fusion]);
  // The fusion slider repaints uniforms directly, without a React render.
  useLayoutEffect(()=>{if(!previewId||fusion===undefined)return;seamlessPreviews.set(previewId,(v,isLive)=>{fusionLive.current=v;liveDrag.current=!!isLive;drawRef.current();});return()=>{seamlessPreviews.delete(previewId);};},[previewId,fusion===undefined]);
  const schedule=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;drawRef.current();});};
  useEffect(()=>{liveBases++;const b=baseRef.current;return()=>{liveBases--;if(baseTimer.current)clearTimeout(baseTimer.current);if(b){releaseSeamShared(b);b.width=b.height=1;}};},[]);
  useEffect(()=>{const element=ref.current;return()=>{cancelAnimationFrame(frame.current);if(settleTimer.current)clearTimeout(settleTimer.current);for(const r of resources.current.values())releaseResource(r);resources.current.clear();if(element){releaseSeamShared(element);dropLiveSeam(element);}dropLiveCell();};},[]);
  useEffect(()=>{
    // Repaint in the SAME transform frame, not a second rAF one frame later.
    // Sources and FX remain cached; zoom only resamples their visible pixels.
    const paint=()=>drawRef.current(true);
    window.addEventListener('abai-preview-transform',paint,true);window.addEventListener('abai-layout-visual',paint);
    // 原圖的完整解析度材質剛準備好（見 seamlessPreview 的 stripPixels）：照新的材質重畫
    const texReady=()=>schedule();window.addEventListener('abai-seam-texture',texReady);
    window.addEventListener('scroll',paint,true);window.addEventListener('resize',paint);
    const observer=new ResizeObserver(paint);if(plane.current)observer.observe(plane.current);
    return()=>{observer.disconnect();window.removeEventListener('abai-preview-transform',paint,true);window.removeEventListener('abai-layout-visual',paint);window.removeEventListener('abai-seam-texture',texReady);window.removeEventListener('scroll',paint,true);window.removeEventListener('resize',paint);};
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
      // decode()：解碼在背景執行緒做完才通知重畫，第一次畫這張時主執行緒不必同步解碼整張原圖
      const image=new Image();image.src=c.url;
      void image.decode().catch(()=>{}).then(()=>{if(resources.current.get(c.id)?.image===image)schedule();});
      resources.current.set(c.id,{url:c.url,image,input:document.createElement('canvas'),key:'',output:null});
    });
    const drawImpl=(viewOnly=false,settle=false)=>{
      const gl=geomLive.current;
      const gap=gl?.gap!==undefined?gl.gap*geomScaleRef.current:gapProp,radius=gl?.radius!==undefined?gl.radius*geomScaleRef.current:radiusProp;
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
      /* 佈局貼齊（或超出）頁面邊緣的那幾邊往外多蓋（見 resolveSeamSurface 的 grow）。
         只在沒有外圈間距、沒轉角度時做：有間距時邊上本來就該露出頁面底色。
         整條頁面的最外圈（第一頁左邊、最後一頁右邊、上下）跟照片同一招：往外多蓋一大圈，
         而且這幾邊「自己不裁」，只讓整條頁面那一刀去切（同一條邊裁兩次，兩刀的抗鋸齒疊在一起，
         邊上那一排蓋不滿、頁面底色就透出來）。頁與頁中間的交界不能壓到隔壁頁，只多蓋一點點、裁在半個像素外。 */
      const pageBox=root.closest('[data-page-id]')?.getBoundingClientRect();
      const strip=root.closest('[data-page-id]')?.parentElement?.getBoundingClientRect();
      const edgeTol=1/dpr,sealed=gap<=.001&&radius<=.001;
      const axisScreen=!!(pa&&pb&&pc)&&Math.abs(pb.y-pa.y)<1e-3&&Math.abs(pc.x-pa.x)<1e-3&&pb.x>pa.x&&pc.y>pa.y;
      const outer=strip&&sealed&&axisScreen?{l:bounds.left<=strip.left+edgeTol,t:bounds.top<=strip.top+edgeTol,r:bounds.right>=strip.right-edgeTol,b:bounds.bottom>=strip.bottom-edgeTol}:undefined;
      const onPage=pageBox&&sealed&&axisScreen?{l:bounds.left<=pageBox.left+edgeTol,t:bounds.top<=pageBox.top+edgeTol,r:bounds.right>=pageBox.right-edgeTol,b:bounds.bottom>=pageBox.bottom-edgeTol}:undefined;
      const edges=JSON.stringify([outer,onPage]);
      /* 底圖：整個佈局一張，放在這個佈局自己的座標裡，跟著頁面／佈局一起被縮放移動（純合成，不重畫）。
         畫面外的部分也一直都在 —— 快速放大縮小、排頁面縮小時不會有任何一塊是空的。
         它的解析度夠用（每個佈局單位的像素 ≥ 螢幕上需要的）就只顯示它，上面那張「看得到的範圍」的
         清晰畫布整個關掉、完全不畫 —— 縮小、平移、進出排頁面都不必再每一格重畫幾百萬像素。
         放大到超過它的解析度時，才用上面那張只畫看得到的範圍補清楚。 */
      const bc=baseRef.current,bs=baseState.current;
      const scr=fwd?Math.hypot(fwd[0],fwd[1]):0;
      const baseEdgesOk=!!bs&&bs.edges===edges;
      /* 邊緣狀態變了（佈局被拖離頁面邊緣等）或內容改了還沒重畫：底圖要藏起來（不然清晰那張透明的地方 ——
         間距、圓角 —— 會透出舊的那張，看起來像兩張圖）。但一定要等清晰那張「這一格真的畫成功」才藏（見最後），
         兩張絕不能同時看不到。清晰那張已經顯示著有效的畫面時，可以馬上藏。 */
      if(bc&&!(baseEdgesOk&&!baseDirty.current)&&cv.style.display==='block'&&cv.style.visibility!=='hidden'&&paintedView.current)bc.style.visibility='hidden';
      const baseSharp=baseEdgesOk&&!baseDirty.current&&bs!.s>=dpr*scr*.999;
      let basePainted=false;
      const detailOff=()=>{
        if(bc)bc.style.visibility='';
        cv.style.display='none';flat.style.display='none';dropLiveSeam(cv);cv.style.visibility='';dropLiveCell();
        paintedView.current=null;flatState.current=null;
        // 只顯示底圖時，清晰那兩張的點陣放掉（各可能是幾 MB 到二十幾 MB），要用時再配置
        if(cv.width>1||cv.height>1){cv.width=cv.height=1;lastView.current='';}
        if(flat.width>1||flat.height>1)flat.width=flat.height=1;
        cv.removeAttribute('data-layout-photo-surface');flat.removeAttribute('data-layout-photo-surface');bc?.setAttribute('data-layout-photo-surface','');
      };
      if(viewOnly&&baseSharp&&!editPresentation.current&&!liveDrag.current){detailOff();return;}
      if(viewOnly&&!baseEdgesOk)settleLater();
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
        /* 底圖有效時，清晰那張蓋不到的地方底下一直有底圖（不會空白），縮小時清晰那張只是變小、仍然清楚：
           手勢中只有「放大到超過清晰那張的解析度」才需要重畫。 */
        const baseUnder=baseEdgesOk&&!baseDirty.current;
        if((baseUnder||need.x0>=c.x0-1e-6&&need.y0>=c.y0-1e-6&&need.x1<=c.x1+1e-6&&need.y1<=c.y1+1e-6)&&mag<=(painted.headroom||1)*1.0005){
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
      const liveEdit=!gesture&&!settle&&performance.now()-lastPaintAt.current<250;
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
          // 整個佈局：範圍要留出貼齊頁面那幾邊往外多蓋的量（grow），不然多蓋的那一圈被這裡切掉，邊上又會透出底色
          if(whole>0&&whole<=GESTURE_PIXELS){area={left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom};mx=my=6;}
          else{const g=vw*vh>0?Math.max(1,Math.min(2.5,Math.sqrt(GESTURE_PIXELS/(vw*vh*dpr*dpr)))):1;mx=Math.max(8,vw*(g-1)/2);my=Math.max(8,vh*(g-1)/2);}
        }
        // 「停下來再畫清楚」的計時要從這次畫完才開始算（見最後），不然畫得久一點計時就先到了
        settleAfterPaint=true;
      }else if(liveEdit){
        /* 內容連續在變（拖照片、在格子裡縮放照片、拖滑桿）：每一格都得重畫，只畫看得到的
           那一塊加一小圈，停下來再補完整的那圈 —— 不然每一格都要多畫三倍的像素。 */
        settleLater();
      }else{
        const g=vw*vh>0?Math.max(1,Math.min(1.8,Math.sqrt(OVERSCAN_PIXELS/(vw*vh*dpr*dpr)))):1;
        mx=Math.max(8,vw*(g-1)/2);my=Math.max(8,vh*(g-1)/2);
      }
      lastPaintAt.current=performance.now();
      const G=4,g1=1.5;
      const grow=onPage?{l:outer?.l?G:onPage.l?g1:0,t:outer?.t?G:onPage.t?g1:0,r:outer?.r?G:onPage.r?g1:0,b:outer?.b?G:onPage.b?g1:0,open:outer}:undefined;
      const surface=resolveSeamSurface(points,width,height,width,height,bounds,{left:area.left-mx,top:area.top-my,right:area.right+mx,bottom:area.bottom+my},density,grow);
      if(surface&&fwd){
        const [ia,ib,ic,id,ie,iff]=surface.rasterView;const sw=surface.width,sh=surface.height;
        const cs=[[0,0],[sw,0],[0,sh],[sw,sh]].map(([x,y])=>({x:ia*x+ic*y+ie,y:ib*x+id*y+iff}));
        paintedView.current={fwd,gesture,headroom,cover:{x0:Math.min(...cs.map(q=>q.x)),y0:Math.min(...cs.map(q=>q.y)),x1:Math.max(...cs.map(q=>q.x)),y1:Math.max(...cs.map(q=>q.y))}};
      }else paintedView.current=null;
      if(surface){
        const viewKey=JSON.stringify(surface.rasterView);
        if(lastView.current!==viewKey){editPresentation.current=false;lastView.current=viewKey;}
      }
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
      /* 底圖：內容（照片、特效成品、裁切、融合程度、變暗）或邊緣狀態變了才重畫。
         正在連續編輯（拖滑桿、拖照片、拖融合程度）時先不畫，只標記過期，停下來（settle）再畫一次。 */
      if(bc&&!viewOnly){
        const key=JSON.stringify([width,height,gap,radius,rects,crops,radii,contents,dims||[],fused?fusionLive.current:-1,cells.map(c=>c.opacity??100),noVisibleGutter,seamTextureEpoch()]);
        if(!settle)lastEditAt.current=performance.now();
        const busy=!settle||performance.now()-lastEditAt.current<350||live.current.size>0||liveDrag.current;
        const baseLater=()=>{if(baseTimer.current)clearTimeout(baseTimer.current);baseTimer.current=setTimeout(()=>{baseTimer.current=0;drawRef.current(false,true);},400);};
        if(bs&&bs.key===key&&bs.edges===edges)baseDirty.current=false;
        else if(busy){
          /* 內容變了：舊的底圖立刻藏起來（這一格由清晰那張顯示新的內容），底圖等真的停下來才畫 ——
             不在拖滑桿、拖照片的任何一格裡多畫一張整個佈局的大圖。 */
          baseDirty.current=true;baseLater();
        }
        else{
          /* 密度：每個佈局單位幾個像素。預算內盡量高（最多螢幕密度的 6 倍），單邊不超過 4096（GPU 上限）。
             往外多蓋的量用佈局單位：最外圈 12（縮到 0.33 倍仍有 4 個螢幕像素），頁與頁交界 3（裁切線在半個螢幕像素外）。 */
          const budget=Math.min(BASE_PIXELS,BASE_TOTAL/Math.max(1,liveBases));
          const BG=12,Bg=3;
          const gu=onPage?{l:outer?.l?BG:onPage.l?Bg:0,t:outer?.t?BG:onPage.t?Bg:0,r:outer?.r?BG:onPage.r?Bg:0,b:outer?.b?BG:onPage.b?Bg:0}:{l:0,t:0,r:0,b:0};
          const ew=width+gu.l+gu.r,eh=height+gu.t+gu.b;
          const d=Math.max(.05,Math.min(dpr*6,Math.sqrt(budget/(ew*eh)),4096/ew,4096/eh));
          const pts=[{x:0,y:0},{x:width*d,y:0},{x:0,y:height*d}];
          const bsurf=resolveSeamSurface(pts,width,height,width,height,{left:0,top:0,right:width*d,bottom:height*d},{left:-1e7,top:-1e7,right:1e7,bottom:1e7},1,
            onPage?{l:gu.l*d,t:gu.t*d,r:gu.r*d,b:gu.b*d,open:outer}:undefined);
          if(bsurf){
            // 尺寸要變時先記下：畫失敗的話這張的像素已被清空，要當成沒有底圖
            const resized=bc.width!==bsurf.pixelWidth||bc.height!==bsurf.pixelHeight;
            (bsurf.view as {dims?:number[]}).dims=dims;
            const style={width:`${bsurf.width}px`,height:`${bsurf.height}px`,transform:`matrix(${bsurf.transform.join(',')})`,clipPath:`polygon(${bsurf.clip})`};
            if(resized){bc.width=bsurf.pixelWidth;bc.height=bsurf.pixelHeight;}
            const ok=fused?drawSeamShared(bc,cells,clips,sources,fusionLive.current!,bsurf.view)
              :drawSeamShared(bc,cells,clips,sources,-1,{...bsurf.view,isolated:true,sealEdges:noVisibleGutter,radii,crops});
            if(ok){
              Object.assign(bc.style,style);bc.style.display='block';
              baseState.current={key,s:d,edges};baseDirty.current=false;basePainted=true;
              if((import.meta as any).env?.DEV)bc.dataset.paintCount=String(Number(bc.dataset.paintCount||0)+1);
            }else{
              // 沒畫成：尺寸沒變的話原本的像素還在，照舊；尺寸變了就當作沒有底圖。等一下再試
              if(resized){baseState.current=null;bc.style.display='none';}
              baseDirty.current=true;baseLater();
            }
          }
        }
      }
      const bsNow=baseState.current;
      const baseOnly=!!bsNow&&!baseDirty.current&&bsNow.edges===edges&&bsNow.s>=dpr*scr*.999&&!editPresentation.current&&!(fused&&liveDrag.current);
      if(baseOnly||!surface){
        detailOff();
        if(!surface)bc?.removeAttribute('data-layout-photo-surface');
        if(!basePainted&&(baseDirty.current||!bsNow||bsNow.edges!==edges))settleLater();
        return;
      }
      cv.style.display='block';
      // 長按互換時要變暗的格子跟著這一次的畫面參數一起交給著色器（見 seamlessPreview 的 dim）
      (surface.view as {dims?:number[]}).dims=dims;
      const W=surface.pixelWidth,H=surface.pixelHeight;
      let detailOk=true;const detailResized=cv.width!==W||cv.height!==H;
      if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;
      cv.style.width=`${surface.width}px`;cv.style.height=`${surface.height}px`;
      cv.style.transform=`matrix(${surface.transform.join(',')})`;cv.style.clipPath=`polygon(${surface.clip})`;
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
        else if(fused)drawSeamShared(cv,cells,clips,sources,fusionLive.current!,surface.view)||(detailOk=false);
        else drawSeamShared(cv,cells,clips,sources,-1,{...surface.view,isolated:true,sealEdges:noVisibleGutter,radii,crops})||(detailOk=false);
        // 沒畫成而且這張剛換過尺寸（像素已經被清空）：這張先不要顯示，讓底圖頂著
        if(!detailOk&&detailResized)cv.style.visibility='hidden';
      }
      const flatShown=editPresentation.current&&!fused;
      flat.style.display=flatShown?'block':'none';cv.style.display=flatShown?'none':'block';
      flat.toggleAttribute('data-layout-photo-surface',flatShown);cv.toggleAttribute('data-layout-photo-surface',!flatShown);bc?.removeAttribute('data-layout-photo-surface');
      const shown=flatShown?flat:cv;
      if(import.meta.env.DEV){shown.dataset.paintCount=String(Number(shown.dataset.paintCount||0)+1);shown.dataset.rasterView=JSON.stringify(surface.rasterView);shown.dataset.sourceKeys=JSON.stringify([...resources.current.values()].map(r=>r.key));}
      if(settleAfterPaint||(!basePainted&&baseDirty.current))settleLater();
      // 清晰那張這一格畫成功，過期的底圖才藏；沒畫成就讓底圖（就算舊一點）繼續顯示，下一格再試
      if(bc){const b=baseState.current,stale=!b||baseDirty.current||b.edges!==edges;bc.style.visibility=detailOk&&stale?'hidden':'';}
      if(!detailOk&&retries.current++<5)schedule();else if(detailOk)retries.current=0;
    };
    // 任何一格出錯（例如畫布記憶體不夠）都不能讓佈局整個不見：底圖留著，下一格再試
    drawRef.current=(viewOnly=false,settle=false)=>{
      try{drawImpl(viewOnly,settle);}
      catch(e){const b=baseRef.current;if(b&&baseState.current)b.style.visibility='';console.warn('layout paint failed',e);if(retries.current++<5)schedule();}
    };
    drawRef.current();
  },[cells,rects,width,height,gapProp,radiusProp,revision,fusion,(dims||[]).join(',')]);
  return <><svg ref={plane} data-layout-photo-plane viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden style={{position:'absolute',left:0,top:0,pointerEvents:'none',zIndex:0,overflow:'hidden'}}><g opacity={0}><circle data-layout-probe cx={0} cy={0} r={.005}/><circle data-layout-probe cx={width} cy={0} r={.005}/><circle data-layout-probe cx={0} cy={height} r={.005}/></g></svg><canvas ref={baseRef} data-layout-base style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0,display:'none'}}/><canvas ref={ref} data-layout-photo-surface style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0}}/><canvas ref={editSurface} style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',pointerEvents:'none',zIndex:0,display:'none'}}/></>;
}
