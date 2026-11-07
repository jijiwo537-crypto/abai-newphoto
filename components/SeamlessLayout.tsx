import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prepareSeamSource, type SeamSource, type SeamPhoto, type SeamRect } from '../utils/seamlessLayout';
import { drawSeamPreview, disposeSeamPreview } from '../utils/seamlessPreview';
import { resolveSeamSurface } from '../utils/seamlessSurfaceGeometry';
import {subscribeCellPhoto} from '../utils/liveCellPhoto';
import {applyPhotoFx,hasPhotoFx,releasePhotoFxSurface,settlePhotoFx,getLoadedLut,type PhotoFx} from '../utils/photoFx';
import {awaitPhotoIdle} from '../utils/photoInteractionIdle';

// 即時滑桿畫格用首頁編輯器的 1800px 預覽大小。貼圖保留原圖的邏輯寬高，裁切和融合都不變
const LIVE_PREVIEW=1800;
const liveSize=(w:number,h:number)=>{const k=Math.min(1,LIVE_PREVIEW/Math.max(w,h));return [Math.max(1,Math.round(w*k)),Math.max(1,Math.round(h*k))];};
const lutReady=(fx?:PhotoFx)=>fx?.lut?!!getLoadedLut(fx.lut):0;

// 融合輸入只更新版面繪製，不更新整個編輯器
/** live＝手指還在滑桿上（畫面可以走直接顯示的 GPU 層）；放開那一次傳 false */
export const previews = new Map<string, (amount: number, live?: boolean) => void>();
export function SeamlessAmountSlider({ previewId, value, onCommit }: { previewId: string; value: number; onCommit: (value: number) => void }) {
  const [live,setLive]=useState(value);
  const latest=useRef(value),frame=useRef(0),committed=useRef(value);
  useEffect(()=>{latest.current=value;committed.current=value;setLive(value);},[value]);
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
  const update=(v:number)=>{latest.current=v;setLive(v);if(!frame.current)frame.current=requestAnimationFrame(()=>{
    frame.current=0;previews.get(previewId)?.(Math.round(latest.current*100)/100,true);
  });};
  // 拇指和預覽連續跟著手指。存的數值保留拖到的值（小數兩位）：放開時取整數，融合帶會明顯跳一下
  const commit=()=>{cancelAnimationFrame(frame.current);frame.current=0;const v=Math.round(latest.current*100)/100;latest.current=v;setLive(v);previews.get(previewId)?.(v,false);if(committed.current!==v){committed.current=v;onCommit(v);}};
  return <div className="space-y-1.5 col-span-2">
    <div className="flex justify-between text-[11px] font-bold text-white/70"><span>融合程度</span><span className="font-mono text-white">{Math.round(live)}</span></div>
    {/* 跟其他滑桿同一套：同樣大的觸控範圍，拖動時頁面不會跟著捲 */}
    <div className="slider-wrap w-full" style={{height:16}}>
    <input aria-label="融合程度" type="range" min={0} max={100} step="any" value={live} className="premium-slider w-full"
      onChange={e=>update(Number(e.target.value))} onPointerUp={commit} onPointerCancel={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit}/>
    </div>
  </div>;
}

export function SeamlessLayout({ previewId, enabled = true, cells:inputCells, rects, width, height, scale = 1, amount, revision }: { previewId?: string; enabled?: boolean; cells: (SeamPhoto&{id?:string})[]; rects: SeamRect[]; width: number; height: number; scale?: number; amount: number; revision: number }) {
  const cells=inputCells;
  const cellsRef=useRef(cells);
  useLayoutEffect(()=>{cellsRef.current=cells;},[cells]);
  const sourcesRef=useRef<SeamSource[]|null>(null),originals=useRef(new Map<string,SeamSource>());
  const liveFrame=useRef(0),dirtyPhotos=useRef(new Set<string>());
  const canvas=useRef<HTMLCanvasElement>(null);
  const effectSurfaces=useRef(new Map<string,HTMLCanvasElement>());
  const liveSurfaces=useRef(new Map<string,HTMLCanvasElement>()),liveKeys=useRef(new Map<string,string>());
  useEffect(()=>{const urls=new Set(cells.map(c=>c.url));for(const key of originals.current.keys())if(!urls.has(key))originals.current.delete(key);const ids=new Set(cells.map((c,i)=>c.id||String(i)));for(const map of [effectSurfaces.current,liveSurfaces.current])for(const [id,cv] of map)if(!ids.has(id)){releasePhotoFxSurface(cv);cv.width=cv.height=1;map.delete(id);liveKeys.current.delete(id);}},[cells]);
  useEffect(()=>()=>{for(const map of [effectSurfaces.current,liveSurfaces.current]){for(const cv of map.values()){releasePhotoFxSurface(cv);cv.width=cv.height=1;}map.clear();}liveKeys.current.clear();},[]);
  const svg=useRef<SVGSVGElement>(null),paintCurrent=useRef<()=>void>(()=>{}),warmKey=useRef('');
  useEffect(()=>{
    const clean=cells.filter(c=>c.id).map(c=>subscribeCellPhoto(c.id!,fx=>{
      cellsRef.current=cellsRef.current.map(p=>p.id===c.id?{...p,fx}:p);dirtyPhotos.current.add(c.id!);
      if(liveFrame.current)return;
      liveFrame.current=requestAnimationFrame(()=>{
        liveFrame.current=0;const current=sourcesRef.current;if(!current)return;
        sourcesRef.current=current.map((source,i)=>{
          const photo=cellsRef.current[i];if(!photo?.id||!dirtyPhotos.current.has(photo.id))return source;
          const original=originals.current.get(photo.url);if(!original)return source;
          if(!hasPhotoFx(photo.fx))return original;
          // 同一時間只有一張即時特效畫布（多一個 GPU context）。還在畫面上的（原圖像素還沒好）絕不放掉
          const shown=new Set((sourcesRef.current||[]).map(s=>s?.image));
          for(const [id,cv] of liveSurfaces.current)if(id!==photo.id&&!shown.has(cv)){releasePhotoFxSurface(cv);cv.width=cv.height=1;liveSurfaces.current.delete(id);liveKeys.current.delete(id);}
          let input=liveSurfaces.current.get(photo.id);if(!input){input=document.createElement('canvas');liveSurfaces.current.set(photo.id,input);}
          const [pw,ph]=liveSize(original.width,original.height);
          const image=applyPhotoFx(original.image,pw,ph,photo.fx!,{cacheSource:true,gpuSurface:true,out:input});
          const key=JSON.stringify([photo.url,photo.fx,lutReady(photo.fx)]);
          image.dataset.seamRevision=key;liveKeys.current.set(photo.id,key);return {...original,image};
        });dirtyPhotos.current.clear();paintCurrent.current();
      });
    }));
    return()=>{clean.forEach(f=>f());cancelAnimationFrame(liveFrame.current);liveFrame.current=0;dirtyPhotos.current.clear();};
  },[cells.map(c=>c.id).join('|')]);
  const [ready,setReady]=useState(false),[prepared,setPrepared]=useState<{key:string;sources:SeamSource[]}|null>(null),[live,setLive]=useState(amount);
  const [contextRevision,restoreContext]=useState(0);
  const lastRemount=useRef(-1e9);
  useEffect(()=>{
    const element=canvas.current;if(!element)return;
    // WebGL context 太多時 iOS Safari 會收掉最舊的，而且同一個元素不會再恢復。
    // 換一張新的 <canvas>（用 contextRevision 當 key），不要讓照片變空白或灰色。有頻率限制，
    // GPU 不夠用時才不會一直換畫布
    const lost=(e:Event)=>{e.preventDefault();warmKey.current='';
      const now=performance.now();if(now-lastRemount.current<2000){setReady(false);return;}
      lastRemount.current=now;restoreContext(v=>v+1);},restored=()=>restoreContext(v=>v+1);
    element.addEventListener('webglcontextlost',lost);element.addEventListener('webglcontextrestored',restored);
    return()=>{element.removeEventListener('webglcontextlost',lost);element.removeEventListener('webglcontextrestored',restored);disposeSeamPreview(element);};
  },[contextRevision]);
  useEffect(()=>{
    const paint=()=>paintCurrent.current();
    // 整條會對自己發這個事件、不冒泡，所以一定要用 capture，不然上層的縮放會拉伸「最後一格」點陣
    window.addEventListener('abai-preview-transform',paint,true);window.addEventListener('scroll',paint,true);window.addEventListener('resize',paint);
    const observer=new ResizeObserver(paint);if(svg.current)observer.observe(svg.current);
    return()=>{observer.disconnect();window.removeEventListener('abai-preview-transform',paint,true);window.removeEventListener('scroll',paint,true);window.removeEventListener('resize',paint);};
  },[]);
  const liveAmount=useRef(amount);
  useLayoutEffect(()=>{liveAmount.current=amount;setLive(amount);},[amount]);
  // 拖融合只改著色器 uniform：直接重畫，不要每次都重新 render 這個元件（或讓 React 重排）
  useLayoutEffect(()=>{if(!previewId)return;previews.set(previewId,v=>{liveAmount.current=v;if(svg.current)svg.current.dataset.seamlessAmount=String(v);paintCurrent.current();});return()=>{previews.delete(previewId);};},[previewId]);
  // 來源解碼和特效處理跟融合、uniform 縮放無關。不相關的背景 LUT 載入會讓整個編輯器的版本號變動；
  // 只有這個版面自己的 LUT 好了才會改它的特效像素
  const sourceKey=JSON.stringify(cells.map(c=>[c.url,c.fx||{},lutReady(c.fx)]));
  useEffect(()=>{
    let cancelled=false;
    Promise.all(cells.map(async(c,i)=>{
      const original=await prepareSeamSource({...c,fx:undefined},0);
      if(!cancelled&&original)originals.current.set(c.url,original);
      if(cancelled||!original||!hasPhotoFx(c.fx))return original;
      const id=c.id||String(i),key=JSON.stringify([c.url,c.fx,lutReady(c.fx)]);
      // 剛放開的滑桿已經用預覽大小顯示這些特效，原圖像素等閒置再做完，不在 pointerup 時做
      if(liveKeys.current.get(id)===key){await awaitPhotoIdle();if(cancelled)return original;}
      let input=effectSurfaces.current.get(id);
      if(!input){input=document.createElement('canvas');effectSurfaces.current.set(id,input);}
      const image=settlePhotoFx(applyPhotoFx(original.image,original.width,original.height,c.fx!,{cacheSource:true,gpuSurface:true,out:input}),input);
      image.dataset.seamRevision=key;
      return {...original,image};
    })).then(sources=>{if(!cancelled){sourcesRef.current=sources;setPrepared({key:sourceKey,sources});}}).catch(error=>{if(!cancelled)console.error('Seamless sources:',error);});
    return()=>{cancelled=true;};
  },[sourceKey]);
  const aspect=Math.round(width/Math.max(.000001,height)*1e8)/1e8;
  // 下一組完整的來源好之前，維持上一格完整的畫面；調參數時不能露出原圖或空白的備援
  const sources=prepared?.sources||null;
  const placementKey=JSON.stringify(cells.map(c=>[c.zoom,c.offsetX,c.offsetY,c.rotation,c.opacity]));
  // 保留已經建好的來源解析度平面。縮放絕不改原圖貼圖；看得到的像素用固定的螢幕密度取樣
  let masterH=1024;
  sources?.forEach((s,i)=>{const r=rects[i];if(!s||!r)return;const turn=Math.abs((cells[i].rotation||0)%180)===90;
    masterH=Math.max(masterH,Math.min((turn?s.height:s.width)/Math.max(.000001,r.w*aspect),(turn?s.width:s.height)/Math.max(.000001,r.h)));});
  const w=Math.round(masterH*aspect),h=Math.round(masterH);
  useLayoutEffect(()=>{
    const paint=()=>{
      const element=canvas.current,root=svg.current;
      if(!sources||!element||!root){setReady(false);return;}
      // 開關關掉時，選中版面的 GPU 和照片保持預熱，再打開時不用解碼、編譯著色器或重新上傳。
      // 沒在用的預熱畫布不會因為工作區手勢重畫
      const key=`${sourceKey}:${contextRevision}`;
      if(!enabled&&warmKey.current===key)return;
      // SVG 標記的範圍包含 WebKit 上層的 CSS 矩陣（getScreenCTM 不含）。所有裁切座標都從這同一個共用平面來
      const points=Array.from(root.querySelectorAll<SVGCircleElement>('[data-seam-probe]') as NodeListOf<SVGCircleElement>).map(n=>{const b=n.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};});
      if(points.length!==3)return;
      const bounds=root.getBoundingClientRect(),clip=root.closest('[data-grid-preview-viewport]')?.getBoundingClientRect();
      const surface=resolveSeamSurface(points,w,h,width*scale,height*scale,bounds,{left:Math.max(0,clip?.left??0),top:Math.max(0,clip?.top??0),right:Math.min(innerWidth,clip?.right??innerWidth),bottom:Math.min(innerHeight,clip?.bottom??innerHeight)},window.devicePixelRatio||1);
      if(!surface){element.style.display='none';return;}element.style.display='block';
      if(element.width!==surface.pixelWidth)element.width=surface.pixelWidth;if(element.height!==surface.pixelHeight)element.height=surface.pixelHeight;
      // 把 HTML 的 GPU 畫布反投影到同一個版面平面。WebGL 不放進 foreignObject，才不會觸發 WebKit 的軟體讀回；
      // 顯示的像素照樣鎖在上面的 SVG 標記上
      element.style.width=`${surface.width}px`;element.style.height=`${surface.height}px`;
      element.style.transform=`matrix(${surface.transform.join(',')})`;
      element.style.clipPath=`polygon(${surface.clip})`;
      root.dataset.rasterView=JSON.stringify(surface.rasterView);
      try{drawSeamPreview(element,cellsRef.current,rects,sourcesRef.current||sources,liveAmount.current,surface.view);warmKey.current=key;setReady(true);element.dataset.paintCount=String(Number(element.dataset.paintCount||0)+1);}
      catch(error){setReady(false);console.error('Seamless GPU:',error);}
    };
    paintCurrent.current=paint;paint();
  },[sources,placementKey,rects,w,h,live,contextRevision,width,height,scale,enabled]);
  return <><style>{`[data-seamless="true"]:has(> svg[data-seamless-master][data-ready="true"]) [id^="cell-container-"] { background-color: transparent !important; }
    [data-seamless="true"]:has(> svg[data-seamless-master][data-ready="true"]) .layout-photo-content { visibility: hidden; }`}</style>
    <svg ref={svg} data-seamless-master data-active={enabled} data-ready={ready} data-seamless-amount={live} data-source-key={sourceKey} data-seamless-crop={JSON.stringify(cells.map(c=>[c.zoom,c.offsetX,c.offsetY,c.rotation,c.opacity??100]))} data-seamless-rects={JSON.stringify(rects)} viewBox={`0 0 ${w} ${h}`} width={width} height={height} preserveAspectRatio="none" aria-hidden
      style={{position:'absolute',left:0,top:0,pointerEvents:'none',zIndex:0,transform:`scale(${scale})`,transformOrigin:'0 0',isolation:'isolate',overflow:'hidden'}}>
      <g opacity={0}><circle data-seam-probe cx={0} cy={0} r={.005}/><circle data-seam-probe cx={w} cy={0} r={.005}/><circle data-seam-probe cx={0} cy={h} r={.005}/></g>
    </svg>
    <canvas key={contextRevision} ref={canvas} data-seamless-layout width={1} height={1} style={{position:'absolute',left:0,top:0,zIndex:0,pointerEvents:'none',transformOrigin:'0 0',visibility:ready&&enabled?'visible':'hidden'}}/>
  </>;
}
