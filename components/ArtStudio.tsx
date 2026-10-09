import {LiveRange} from './LiveRange';
import {TransformWrapper,TransformComponent} from 'react-zoom-pan-pinch';
import React,{useState,useRef,useEffect,useLayoutEffect,useCallback} from 'react';
import {ASCII_DEFAULTS} from '../utils/asciiRenderer';
import {ASCII_PRESETS,withAsciiPreset,withAsciiCoverage,withAsciiMetric} from '../utils/asciiControls';
import {SVGContext,asciiVector,paintAsciiViewport} from '../utils/artVector';
import {MATERIALS} from '../utils/artMaterials';
import {trackingDefaults,renderTracking,invalidateTracking,redistributeRegions,trackingChainAngle} from '../utils/artTracking';
import {ArtColorControls} from './ArtColorControls';
import {paintTrackingMaterials} from '../utils/artTrackingGpu';
import {processImageFile} from '../utils/imageLoader';
import {SaveButton} from './SaveButton';
import {ExportActionLift} from './ExportActionLift';
import {canExportHeic,exportHeic} from '../utils/heicExport';
import {KeyboardSafeInput} from './KeyboardSafeInput';
import {ChevronLeft,ImagePlus,Undo2,Redo2,MoreHorizontal} from 'lucide-react';
import './ArtStudio.css';

type EffectId='ascii'|'tracking';
const EFFECTS=[{id:'ascii' as const,name:'ASCII'},{id:'tracking' as const,name:'視覺追蹤'}];

export function ArtStudio({onClose,initialSrc=''}:{onClose:()=>void;initialSrc?:string}){
 const standalone=(navigator as Navigator & {standalone?:boolean}).standalone===true;
 const root=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  // Keep the application's viewport metadata untouched. An absolute editor
  // participates in WebKit's document bounds (unlike the stale fixed viewport
  // in Home Screen apps), keeping bottom controls visible and hit-testable.
  if(!(navigator as Navigator & {standalone?:boolean}).standalone)return;
  const visual=window.visualViewport;
  const align=()=>{
   if(document.activeElement?.matches('input,textarea,[contenteditable=true]'))return;
   root.current?.style.setProperty('--art-native-offset',`${visual?.offsetTop||0}px`);
  };
  visual?.addEventListener('resize',align);visual?.addEventListener('scroll',align);
  align();const frame=requestAnimationFrame(align);
  return()=>{
   cancelAnimationFrame(frame);visual?.removeEventListener('resize',align);visual?.removeEventListener('scroll',align);
  };
 },[]);
 const [src,setSrc]=useState(initialSrc),[settings,setSettings]=useState(ASCII_DEFAULTS);
 const [effect,setEffect]=useState<EffectId>('ascii'),[tab,setTab]=useState('效果'),[section,setSection]=useState('偵測');
 const [tracking,setTracking]=useState(()=>({...trackingDefaults,zones:[] as {x:number;y:number}[]}));
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[compare,setCompare]=useState(false),[ready,setReady]=useState(false);
 const [placing,setPlacing]=useState(false),[sourceRevision,setSourceRevision]=useState(0);
 useEffect(()=>{
  // Suppress only this row's edge rubber-banding. Interior horizontal swipes
  // remain native; no document or other editor gesture behavior is changed.
  const rows=root.current?.querySelectorAll<HTMLElement>('.art-scroll');
  const cleanups:(()=>void)[]=[];
  rows?.forEach(row=>{
   let start:{x:number;y:number}|null=null;
   const down=(e:TouchEvent)=>{start=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;};
   const move=(e:TouchEvent)=>{if(!start||e.touches.length!==1)return;const t=e.touches[0],dx=t.clientX-start.x,dy=t.clientY-start.y,max=Math.max(0,row.scrollWidth-row.clientWidth);if((Math.abs(dx)>=Math.abs(dy)&&((row.scrollLeft<=0&&dx>0)||(row.scrollLeft>=max-1&&dx<0)))||Math.abs(dy)>Math.abs(dx)){if(e.cancelable)e.preventDefault();}start={x:t.clientX,y:t.clientY};};
   const end=()=>{start=null;};
   row.addEventListener('touchstart',down,{passive:true});row.addEventListener('touchmove',move,{passive:false});row.addEventListener('touchend',end);row.addEventListener('touchcancel',end);
   cleanups.push(()=>{row.removeEventListener('touchstart',down);row.removeEventListener('touchmove',move);row.removeEventListener('touchend',end);row.removeEventListener('touchcancel',end);});
  });
  return()=>cleanups.forEach(cleanup=>cleanup());
 },[effect,tab,section]);
 const [exportFormat,setExportFormat]=useState<'jpg'|'png'|'heic'>('png'),[formatOpen,setFormatOpen]=useState(false),[exportPreview,setExportPreview]=useState('');
 const formatMenu=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!formatOpen)return;const close=(e:PointerEvent)=>{if(!formatMenu.current?.contains(e.target as Node))setFormatOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setFormatOpen(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[formatOpen]);
 const asciiCanvas=useRef<HTMLCanvasElement>(null),trackingCanvas=useRef<HTMLCanvasElement>(null),vector=useRef<SVGSVGElement>(null);
 const trackingGpu=useRef<HTMLCanvasElement>(null);
 const image=useRef<HTMLImageElement|null>(null),input=useRef<HTMLInputElement>(null),frame=useRef(0),importRevision=useRef(0);
 const [dimensions,setDimensions]=useState({w:600,h:800});
 const surface=useRef<HTMLDivElement>(null),preview=useRef<HTMLElement>(null);
 const placementHint=useRef<HTMLSpanElement>(null);
 const asciiInk=useRef<HTMLCanvasElement>(null),colorInk=useRef<HTMLCanvasElement>(null),inkMask=useRef<HTMLCanvasElement|null>(null),inkState=useRef({effect,settings,compare,ready});inkState.current={effect,settings,compare,ready};
 const syncVector=useCallback(()=>{if(!surface.current||!preview.current||!vector.current)return;const a=surface.current.getBoundingClientRect(),b=preview.current.getBoundingClientRect();Object.assign(vector.current.style,{left:`${a.left-b.left}px`,top:`${a.top-b.top}px`,width:`${a.width}px`,height:`${a.height}px`});if(placementHint.current)placementHint.current.style.top=`${Math.min(b.height-48,Math.max(18,a.top-b.top+16))}px`;const state=inkState.current;if(state.effect==='ascii'&&state.ready&&!state.compare&&asciiInk.current&&image.current){inkMask.current??=document.createElement('canvas');paintAsciiViewport(asciiInk.current,inkMask.current,image.current,state.settings,a,b,window.devicePixelRatio||1,colorInk.current);}},[]);
 useLayoutEffect(()=>{if(placing)syncVector();},[placing,syncVector]);
 useLayoutEffect(()=>{const observer=new ResizeObserver(syncVector);if(preview.current)observer.observe(preview.current);if(surface.current)observer.observe(surface.current);syncVector();return()=>observer.disconnect();},[dimensions,src,syncVector]);
 const timeline=useRef<string[]>([]),future=useRef<string[]>([]),historyTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [,refreshHistory]=useState(0);const restoring=useRef(false);
 const snapshot=JSON.stringify({effect,settings,tracking});
 const remember=()=>{if(timeline.current.at(-1)!==snapshot){timeline.current.push(snapshot);if(timeline.current.length>60)timeline.current.shift();future.current=[];refreshHistory(n=>n+1);}};
 useEffect(()=>{if(restoring.current){restoring.current=false;return;}if(!timeline.current.length)timeline.current.push(snapshot);historyTimer.current=setTimeout(remember,250);return()=>{if(historyTimer.current)clearTimeout(historyTimer.current);};},[snapshot]);
 const travel=(redo=false)=>{if(historyTimer.current)clearTimeout(historyTimer.current);if(timeline.current.at(-1)!==snapshot)remember();let next:string|undefined;if(redo){next=future.current.pop();if(next)timeline.current.push(next);}else if(timeline.current.length>1){future.current.push(timeline.current.pop()!);next=timeline.current.at(-1);}if(!next)return;restoring.current=true;const s=JSON.parse(next);if(s.effect!==effect)setTab('效果');setEffect(s.effect);setSettings(s.settings);setTracking(s.tracking);setPlacing(false);refreshHistory(n=>n+1);};
 const options=useRef(settings);options.current=settings;
 const [exportFile,setExportFile]=useState<File|null>(null),[exportUrl,setExportUrl]=useState('');
 useEffect(()=>{if(!exportFile){setExportUrl('');return;}const url=URL.createObjectURL(exportFile);setExportUrl(url);return()=>URL.revokeObjectURL(url);},[exportFile]);
 useEffect(()=>()=>{importRevision.current++;invalidateTracking();},[]);
 useEffect(()=>{
  setReady(false);if(!src||!asciiCanvas.current)return;
  let cancelled=false;const im=new Image();
  im.onload=()=>{if(cancelled)return;try{
   image.current=im;invalidateTracking();setDimensions({w:im.naturalWidth,h:im.naturalHeight});
   for(const c of [asciiCanvas.current!,trackingCanvas.current!]){c.width=im.naturalWidth;c.height=im.naturalHeight;}setReady(true);
  }catch(e){setError(String(e));}};
  im.onerror=()=>{if(!cancelled)setError('照片無法讀取，請重新選擇。');};im.src=src;
  return()=>{cancelled=true;im.onload=null;im.onerror=null;image.current=null;};
 },[src,sourceRevision]);
 const drawn=useRef({source:null as HTMLImageElement|null,raster:'',vector:''});
 const draw=useCallback((original=false)=>{
  if(!ready)return;
  const im=image.current;if(!im||!vector.current)return;
  const c=(effect==='ascii'?asciiCanvas.current:trackingCanvas.current)!.getContext('2d')!;
  if(drawn.current.source!==im)drawn.current={source:im,raster:'',vector:''};
 const rasterKey=JSON.stringify(original?['original',effect]:effect==='ascii'?['ascii',settings.background]:['tracking',...['materials','zones','count','size','sizeVariation','pixels','blur','seed','nodeSeed','variation','imageOpacity','detection','threshold','circles','minDistance','maxRadius','minRadius','shapes'].map(k=>tracking[k])]);
  if(drawn.current.raster!==rasterKey){
   if(original||effect==='ascii'){c.fillStyle='#080808';c.fillRect(0,0,im.width,im.height);if(original||settings.background)c.drawImage(im,0,0);}
   else if(trackingGpu.current&&paintTrackingMaterials(trackingGpu.current,im,tracking)){trackingGpu.current.style.display='block';trackingCanvas.current!.style.visibility='hidden';}
   else{if(trackingGpu.current)trackingGpu.current.style.display='none';trackingCanvas.current!.style.visibility='visible';renderTracking(c,im,.6,{...tracking,rasterOnly:true});}
   drawn.current.raster=rasterKey;
  }
  if(original||effect==='ascii'){if(trackingGpu.current)trackingGpu.current.style.display='none';trackingCanvas.current!.style.visibility='visible';}
  const vectorKey=JSON.stringify(original?['original']:effect==='ascii'?['ascii',settings]:['tracking',{...tracking,opacity:1}]);
  vector.current.style.opacity=original?'1':effect==='tracking'?String(tracking.opacity):'1';
  if(drawn.current.vector!==vectorKey){
   if(original||effect==='ascii')vector.current.innerHTML='';else{const ctx=new SVGContext(vector.current);renderTracking(ctx,im,.6,{...tracking,opacity:1,vectorOnly:true});ctx.flush();}
   drawn.current.vector=vectorKey;
  }
  if(effect==='ascii')syncVector();
 },[ready,effect,settings,tracking]);
 const paintLatest=useRef({draw,compare});
 useLayoutEffect(()=>{
  // One uninterrupted paint queue: incoming slider events replace the pending
  // settings, never cancel a frame that was already ready to paint.
  paintLatest.current={draw,compare};
  if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;const next=paintLatest.current;next.draw(next.compare);});
 },[draw,compare]);
 useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
 const updateTracking=(key:string,value:any)=>setTracking(s=>({...s,[key]:value}));
 const randomizeFeedback=(button:HTMLButtonElement)=>{
  button.getAnimations().forEach(animation=>animation.cancel());
  button.animate([{borderColor:'#ffffffb3'},{borderColor:'#ffffff16'}],{duration:260,easing:'ease-out'});
 };
 const randomizeNodes=(e:React.MouseEvent<HTMLButtonElement>)=>{
  setTracking(s=>({...s,nodeSeed:s.nodeSeed+1}));randomizeFeedback(e.currentTarget);
 };
 const randomizeMasks=(e:React.MouseEvent<HTMLButtonElement>)=>{
  setTracking(s=>redistributeRegions(s));randomizeFeedback(e.currentTarget);
 };
 const selectMany=(key:'shapes'|'materials',value:string)=>setTracking(s=>({...s,[key]:value==='none'?[]:s[key].includes(value)?s[key].filter((x:string)=>x!==value):[...s[key],value],...(key==='materials'&&value!=='none'?{count:s.count===0?10:s.count}:{})}));
 /* 連續的參數（大小、粗細、虛線、霧化…）用很細的刻度：拖的時候畫面跟著一點一點變，
    不會因為範圍小（例如 2～30）而一格一格跳。數字仍照 shown 的精度顯示。 */
 const slider=(name:string,value:number,min:number,max:number,change:(v:number)=>void,step=1,unit='',shown=step)=><label className="art-range"><span>{name}<output>{shown>=1?Math.round(value):Number(value.toFixed(String(shown).split('.')[1]?.length||1))}{unit}</output></span><LiveRange ariaLabel={name} min={min} max={max} step={step} value={value} onValue={change} className="" wrapClassName="art-range-track" height={24}/></label>;
 const range=(name:string,key:'columns'|'low',min:number,max:number)=>slider(name,settings[key],min,max,v=>setSettings(s=>({...s,[key]:v,high:100})));
 // 只有「數量」這種本來就是整數的參數照整數走
 const DISCRETE=new Set(['circles','count']);
 const tr=(name:string,key:string,min:number,max:number,step=1)=>max===1?slider(name,Number(tracking[key])*100,min*100,100,v=>updateTracking(key,v/100),0.01,'',1):slider(name,Number(tracking[key]),min,max,v=>updateTracking(key,v),DISCRETE.has(key)?step:step/100,'',step);
 const binary=(name:string,on:boolean,change:(value:boolean)=>void)=><div className="art-color" role="group" aria-label={name}><span>{name}</span><div className="art-presets">{[false,true].map(value=><button key={String(value)} aria-pressed={on===value} onClick={()=>change(value)}>{value?'開啟':'關閉'}</button>)}</div></div>;
 const tt=(name:string,key:string)=>binary(name,!!tracking[key],value=>updateTracking(key,value));
 const groups=(names:string[])=><div className="art-subtabs">{names.map(name=><button key={name} aria-pressed={section===name} onClick={()=>setSection(name)}>{name}</button>)}</div>;
 const tabs=effect==='ascii'?['效果','字符','範圍','外觀']:['效果','節點','元素','遮罩'];
 const selectTab=(name:string)=>{setTab(name);setPlacing(false);setSection(name==='節點'?'偵測':'編輯');};
 const save=async()=>{
  if(!ready||busy)return;setBusy(true);setFormatOpen(false);let url='',heicUrl='';
  try{
   draw(false);const raster=(effect==='ascii'?asciiCanvas.current:trackingGpu.current?.style.display==='block'?trackingGpu.current:trackingCanvas.current)!;
   const c=document.createElement('canvas'),scale=Math.max(1,3200/Math.max(dimensions.w,dimensions.h));c.width=Math.round(dimensions.w*scale);c.height=Math.round(dimensions.h*scale);
   const ctx=c.getContext('2d')!;ctx.drawImage(raster,0,0,c.width,c.height);
   const ink=effect==='ascii'?asciiVector(image.current!,settings):vector.current!.innerHTML;
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${dimensions.w} ${dimensions.h}"><g opacity="${effect==='tracking'?tracking.opacity:1}">${ink}</g></svg>`;
   url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const overlay=new Image();await new Promise<void>((resolve,reject)=>{overlay.onload=()=>resolve();overlay.onerror=()=>reject(Error('向量圖層無法匯出'));overlay.src=url;});ctx.drawImage(overlay,0,0,c.width,c.height);
   let blob:Blob|null;
   if(exportFormat==='heic'){heicUrl=await exportHeic(c);blob=await (await fetch(heicUrl)).blob();setExportPreview(c.toDataURL('image/png'));}
   else{blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve,exportFormat==='jpg'?'image/jpeg':'image/png',1));setExportPreview('');}
   if(!blob)throw Error('無法儲存圖片');setExportFile(new File([blob],`${effect==='ascii'?'ABAI-ASCII':'ABAI-Vision'}.${exportFormat}`,{type:blob.type}));
  }catch(e){setError(String(e));}finally{if(url)URL.revokeObjectURL(url);if(heicUrl)URL.revokeObjectURL(heicUrl);setBusy(false);}
 };
 const placeStart=useRef<{id:number;x:number;y:number}|null>(null);
 const placeDown=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(!placing)return;if(placeStart.current){placeStart.current=null;return;}placeStart.current={id:e.pointerId,x:e.clientX,y:e.clientY};};
 const placeUp=(e:React.PointerEvent<HTMLCanvasElement>)=>{
  const start=placeStart.current;placeStart.current=null;if(!placing||!start||start.id!==e.pointerId||Math.hypot(start.x-e.clientX,start.y-e.clientY)>8)return;
  const r=e.currentTarget.getBoundingClientRect();const point={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};
  setTracking(s=>({...s,zones:[...s.zones,point]}));
 };
 return <div ref={root} className={'art-studio safe-top'+(standalone?' art-contained':'')}>
  <header className="art-header"><button aria-label="返回" onClick={onClose}><ChevronLeft size={23}/></button><div className="art-history"><button aria-label="撤回" disabled={timeline.current.length<2&&timeline.current.at(-1)===snapshot} onClick={()=>travel()}><Undo2 size={18}/></button><button aria-label="重做" disabled={!future.current.length} onClick={()=>travel(true)}><Redo2 size={18}/></button></div><div className="art-save-menu" ref={formatMenu}><div className="art-save-pill"><button className="art-save" disabled={!ready||busy} onClick={save}>{busy?'儲存中':'儲存'}</button><i/><button aria-label="匯出選項" aria-expanded={formatOpen} onClick={()=>setFormatOpen(!formatOpen)}><MoreHorizontal size={16}/></button></div>{formatOpen&&<div className="art-format" role="dialog" aria-label="匯出格式"><span>匯出格式</span><div>{(['jpg','png','heic'] as const).map(format=><button key={format} disabled={format==='heic'&&!canExportHeic()} aria-pressed={exportFormat===format} onClick={()=>setExportFormat(format)}>{format.toUpperCase()}</button>)}</div></div>}</div></header>
  <section ref={preview} className="art-preview">
   {src?<div className="art-zoom"><TransformWrapper key={src} minScale={1} maxScale={8} centerOnInit onTransformed={syncVector} wheel={{step:.15}} doubleClick={{mode:"reset"}}><TransformComponent wrapperStyle={{width:"100%",height:"100%"}} contentStyle={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div ref={surface} className="art-surface" style={{aspectRatio:`${dimensions.w}/${dimensions.h}`,width:`min(calc(100cqw - 24px), calc((100cqh - 24px) * ${dimensions.w/dimensions.h}))`}}>
    <canvas ref={asciiCanvas} aria-label="字符藝術預覽" style={{display:effect==='ascii'?'block':'none'}}/>
    <canvas ref={trackingCanvas} aria-label="視覺追蹤預覽" style={{display:effect==='tracking'?'block':'none',cursor:placing?'crosshair':undefined}} onPointerDown={placeDown} onPointerUp={placeUp} onPointerCancel={()=>{placeStart.current=null;}}/>
    <canvas ref={trackingGpu} className="art-material-surface" aria-label="即時遮罩預覽" style={{display:'none',cursor:placing?'crosshair':undefined}} onPointerDown={placeDown} onPointerUp={placeUp} onPointerCancel={()=>{placeStart.current=null;}}/>
    </div>
   </TransformComponent></TransformWrapper></div>:<button className="art-import" onClick={()=>input.current?.click()}><ImagePlus size={28}/>匯入照片</button>}
   <svg ref={vector} className="art-vectors" viewBox={`0 0 ${dimensions.w} ${dimensions.h}`} aria-label="向量藝術圖層"/>
   <canvas ref={asciiInk} className="art-ink" aria-label="即時字符圖層" style={{display:effect==='ascii'&&!compare&&!settings.color?'block':'none'}}/>
   <canvas ref={colorInk} className="art-ink art-color-ink" aria-label="高清字符圖層" style={{display:effect==='ascii'&&!compare&&ready?'block':'none'}}/>
   {placing&&<span ref={placementHint} className="art-placement-hint">點擊圖片進行放置</span>}
   {src&&<button aria-label="前後對比" aria-pressed={compare} className="art-compare" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setCompare(true);}} onPointerUp={()=>setCompare(false)} onPointerCancel={()=>setCompare(false)} onLostPointerCapture={()=>setCompare(false)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();setCompare(true);}}} onKeyUp={e=>{if(e.key===' '||e.key==='Enter')setCompare(false);}} onBlur={()=>setCompare(false)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 6H4.5A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18H12" stroke="white" strokeWidth="1.5"/><path d="M12 3v18" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><path d="M12 6h7.5A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5H12" stroke="currentColor" strokeWidth="1.5"/></svg></button>}
  </section>
  <section className="art-panel" onPointerDownCapture={()=>{if(historyTimer.current)clearTimeout(historyTimer.current);remember();}}><nav aria-label="藝術工具">{tabs.map(label=><button key={label} aria-pressed={tab===label} onClick={()=>selectTab(label)}>{label}</button>)}</nav><div className={'art-controls'+(effect==='tracking'&&tab!=='效果'?' art-tracking-controls':'')}>
   {tab==='效果'&&<div className="art-effect-list art-presets">{EFFECTS.map(item=><button key={item.id} aria-pressed={effect===item.id} onClick={()=>{setEffect(item.id);setPlacing(false);}}>{item.name}</button>)}</div>}
   {effect==='ascii'&&tab==='字符'&&<><label className="art-chars">自訂字符<KeyboardSafeInput aria-label="字符序列" value={settings.characters} maxLength={48} onChange={e=>setSettings(s=>({...s,characters:e.target.value}))}/></label><div className="art-presets art-character-presets">{ASCII_PRESETS.map(x=><button key={x} aria-pressed={settings.characters===x} onClick={()=>setSettings(s=>withAsciiPreset(s,x))}>{x}</button>)}</div>{range('密度','columns',24,180)}</>}
   {effect==='ascii'&&tab==='範圍'&&<><div className="art-presets">{['亮部','暗部','邊緣','色彩'].map((x,index)=><button key={x} aria-pressed={settings.metric===[0,3,1,2][index]} onClick={()=>setSettings(s=>withAsciiMetric(s,[0,3,1,2][index]))}>{x}</button>)}</div>{slider('範圍',100-settings.low,0,100,v=>setSettings(s=>withAsciiCoverage(s,v)),1,'%')}</>}
   {effect==='ascii'&&tab==='外觀'&&<><div className="art-color"><span>字符顏色</span><div className="art-presets"><button aria-pressed={settings.color} onClick={()=>setSettings(s=>({...s,color:true}))}>原色</button><button aria-pressed={!settings.color} onClick={()=>setSettings(s=>({...s,color:false}))}>白色</button></div></div>{binary('保留底圖',settings.background,value=>setSettings(s=>({...s,background:value})))}{binary('發光',!!settings.glow,value=>setSettings(s=>({...s,glow:value?50:0})))}</>}
   {effect==='tracking'&&tab==='節點'&&<>{groups(['偵測','輪廓','連線','顏色'])}
    {section==='顏色'&&<ArtColorControls value={tracking.palette} onChange={color=>updateTracking('palette',color)}/>}
    {section==='偵測'&&<><div className="art-presets">{[['combined','綜合'],['bright','亮部'],['dark','暗部'],['contrast','邊緣']].map(([key,name])=><button key={key} aria-pressed={tracking.detection===key} onClick={()=>updateTracking('detection',key)}>{name}</button>)}</div><div className="art-detail-ranges">{tr('範圍','threshold',0,80)}{tr('數量','circles',5,150)}</div><div className="art-presets"><button onClick={randomizeNodes}>隨機分佈</button></div></>}
    {section==='輪廓'&&<><div className="art-presets art-scroll">{[['circle','圓形'],['square','方形'],['spark','星芒'],['star','星星'],['bracket','聚焦'],['selection','選中框'],['cross','交叉框']].map(([key,name])=><button key={key} aria-pressed={tracking.shapes.includes(key)} onClick={()=>selectMany('shapes',key)}>{name}</button>)}</div><div className="art-detail-ranges">{tr('大小','maxRadius',10,100)}{tr('變化','variation',0,100)}{tr('粗細','stroke',.3,3,.1)}{tr('間距','minDistance',10,100)}</div></>}
    {section==='連線'&&<><div className="art-presets art-scroll">{[['none','無'],['tree','標準'],['network','鄰近']].map(([key,name])=><button key={key} aria-pressed={tracking.linkMode===key} onClick={()=>updateTracking('linkMode',key)}>{name}</button>)}</div>{tracking.linkMode!=='none'&&<div className="art-detail-ranges">{tracking.linkMode!=='tree'&&tr('距離','links',0,400)}{tr('粗細','lineWeight',.2,2,.1)}</div>}</>}
   </>}
   {effect==='tracking'&&tab==='元素'&&<>
    <div className="art-element-stack">
     <section aria-label="取景框設定">{tt('取景框','frame')}<fieldset disabled={!tracking.frame} className="art-detail-ranges art-element-ranges" aria-label="取景框調整">{tr('大小','frameSize',10,100)}{tr('虛線','dash',2,30)}</fieldset></section>
     <section aria-label="圓圈設定">{tt('圓圈','chain')}<fieldset disabled={!tracking.chain} className="art-detail-ranges art-element-ranges" aria-label="圓圈調整">{tr('大小','baseRadius',30,400)}{slider('角度',Math.round(trackingChainAngle(tracking,dimensions.w,dimensions.h)),0,180,v=>updateTracking('angle',v))}</fieldset></section>
    </div>
   </>}
   {effect==='tracking'&&tab==='遮罩'&&<><div className="art-mask-toolbar">{groups(['編輯','細節'])}<button className="art-mask-random" onClick={randomizeMasks}>隨機分佈</button></div>
    {section==='編輯'&&<><div className="art-presets" role="group" aria-label="遮罩材質">{MATERIALS.map(([key,name])=><button key={key} aria-pressed={tracking.materials.includes(key)} onClick={()=>selectMany('materials',key)}>{name}</button>)}</div>{tr('數量','count',0,30)}<div className="art-detail-ranges">{tr('大小','size',20,400)}{tr('變化','sizeVariation',0,100)}</div></>}
    {section==='細節'&&<><div className="art-detail-ranges">{tracking.materials.includes('mosaic')&&tr('馬賽克','pixels',2,60)}{tracking.materials.includes('glass')&&tr('霧化','blur',0,60)}</div>{tt('框線','zoneStroke')}</>}
   </>}
  </div></section>
  <input hidden ref={input} type="file" accept="image/*" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;const revision=++importRevision.current;setBusy(true);setReady(false);setError('');setCompare(false);try{const next=await processImageFile(f);if(revision===importRevision.current){setSrc(next);setSourceRevision(revision);setTracking(s=>({...s,zones:[]}));}}catch(err){if(revision===importRevision.current)setError(String(err));}finally{if(revision===importRevision.current)setBusy(false);}}}/>
  {exportFile&&<div data-export-screen className="art-export" role="dialog" aria-modal="true" aria-label="儲存預覽"><ExportActionLift/><header><button aria-label="返回主頁" onClick={onClose}><ChevronLeft size={22}/></button></header><div data-export-media className="art-export-image">{exportUrl&&<img className="allow-callout" src={exportPreview||exportUrl} alt="匯出預覽"/>}</div><footer data-export-actions>{exportUrl&&<SaveButton urls={[exportUrl]}/>}<div><button onClick={()=>setExportFile(null)}>繼續編輯</button><button onClick={()=>{setExportFile(null);input.current?.click();}}>修下一張</button></div></footer></div>}
  {error&&<div role="alert" className="art-error" onClick={()=>setError('')}>{error}</div>}
 </div>;
}
