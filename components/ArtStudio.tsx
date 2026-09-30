import {TransformWrapper,TransformComponent} from 'react-zoom-pan-pinch';
import React,{useState,useRef,useEffect,useLayoutEffect,useCallback} from 'react';
import {AsciiRenderer,ASCII_DEFAULTS} from '../utils/asciiRenderer';
import {trackingDefaults,renderTracking,invalidateTracking} from '../utils/artTracking';
import {processImageFile} from '../utils/imageLoader';
import {SaveButton} from './SaveButton';
import {KeyboardSafeInput} from './KeyboardSafeInput';
import {ChevronLeft,ImagePlus} from 'lucide-react';
import './ArtStudio.css';

type EffectId='ascii'|'tracking';
const EFFECTS=[{id:'ascii' as const,name:'字符',sample:'Aa'},{id:'tracking' as const,name:'視覺追蹤',sample:'◎'}];

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
 const asciiCanvas=useRef<HTMLCanvasElement>(null),trackingCanvas=useRef<HTMLCanvasElement>(null),renderer=useRef<AsciiRenderer|null>(null);
 const image=useRef<HTMLImageElement|null>(null),input=useRef<HTMLInputElement>(null),textureInput=useRef<HTMLInputElement>(null),frame=useRef(0),importRevision=useRef(0);
 const options=useRef(settings);options.current=settings;
 const [exportFile,setExportFile]=useState<File|null>(null),[exportUrl,setExportUrl]=useState('');
 useEffect(()=>{if(!exportFile){setExportUrl('');return;}const url=URL.createObjectURL(exportFile);setExportUrl(url);return()=>URL.revokeObjectURL(url);},[exportFile]);
 useEffect(()=>()=>{importRevision.current++;invalidateTracking();},[]);
 useEffect(()=>{
  setReady(false);if(!src||!asciiCanvas.current)return;
  let cancelled=false;const im=new Image();
  im.onload=()=>{if(cancelled)return;try{
   image.current=im;invalidateTracking();renderer.current=new AsciiRenderer(asciiCanvas.current!);renderer.current.setImage(im);renderer.current.draw(options.current);
   const c=trackingCanvas.current!;c.width=im.naturalWidth;c.height=im.naturalHeight;setReady(true);
  }catch(e){renderer.current?.dispose();renderer.current=null;setError(String(e));}};
  im.onerror=()=>{if(!cancelled)setError('照片無法讀取，請重新選擇。');};im.src=src;
  return()=>{cancelled=true;im.onload=null;im.onerror=null;renderer.current?.dispose();renderer.current=null;image.current=null;};
 },[src,sourceRevision]);
 const draw=useCallback((original=false)=>{
  if(!ready)return;
  if(effect==='ascii')renderer.current?.draw(settings,original);
  else if(image.current&&trackingCanvas.current){const c=trackingCanvas.current.getContext('2d')!;if(original)c.drawImage(image.current,0,0);else renderTracking(c,image.current,.6,tracking);}
 },[ready,effect,settings,tracking]);
 useEffect(()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>draw(compare));return()=>cancelAnimationFrame(frame.current);},[draw,compare]);
 const updateTracking=(key:string,value:any)=>setTracking(s=>({...s,[key]:value}));
 const slider=(name:string,value:number,min:number,max:number,change:(v:number)=>void,step=1)=><label className="art-range"><span>{name}<output>{Number(value.toFixed(2))}</output></span><input aria-label={name} type="range" min={min} max={max} step={step} value={value} onChange={e=>change(+e.target.value)}/></label>;
 const range=(name:string,key:'columns'|'low',min:number,max:number)=>slider(name,settings[key],min,max,v=>setSettings(s=>({...s,[key]:v,high:100})));
 const tr=(name:string,key:string,min:number,max:number,step=1)=>slider(name,Number(tracking[key]),min,max,v=>updateTracking(key,v),step);
 const toggle=(name:string,on:boolean,change:()=>void)=><button className="art-toggle" role="switch" aria-checked={on} onClick={change}>{name}<i/></button>;
 const tt=(name:string,key:string)=>toggle(name,!!tracking[key],()=>updateTracking(key,!tracking[key]));
 const groups=(names:string[])=><div className="art-subtabs">{names.map(name=><button key={name} aria-pressed={section===name} onClick={()=>setSection(name)}>{name}</button>)}</div>;
 const tabs=effect==='ascii'?['效果','字符','範圍','外觀']:['效果','節點','構圖','區域'];
 const selectTab=(name:string)=>{setTab(name);setPlacing(false);setSection(name==='節點'?'偵測':name==='構圖'?'圓圈鏈':'遮蔽');};
 const save=async()=>{if(!ready||busy)return;setBusy(true);try{draw(false);const c=effect==='ascii'?asciiCanvas.current:trackingCanvas.current;const blob=await new Promise<Blob|null>(resolve=>c!.toBlob(resolve,'image/png'));if(!blob)throw Error('無法儲存圖片');setExportFile(new File([blob],effect==='ascii'?'ABAI-ASCII.png':'ABAI-Vision.png',{type:'image/png'}));}catch(e){setError(String(e));}finally{setBusy(false);}};
 const placeStart=useRef<{id:number;x:number;y:number}|null>(null);
 const placeDown=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(!placing)return;if(placeStart.current){placeStart.current=null;return;}placeStart.current={id:e.pointerId,x:e.clientX,y:e.clientY};};
 const placeUp=(e:React.PointerEvent<HTMLCanvasElement>)=>{
  const start=placeStart.current;placeStart.current=null;if(!placing||!start||start.id!==e.pointerId||Math.hypot(start.x-e.clientX,start.y-e.clientY)>8)return;
  const r=e.currentTarget.getBoundingClientRect();const point={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};
  setTracking(s=>({...s,zones:[...s.zones,point]}));
 };
 return <div ref={root} className={'art-studio safe-top'+(standalone?' art-contained':'')}>
  <header className="art-header"><button aria-label="返回" onClick={onClose}><ChevronLeft size={23}/></button><button className="art-replace" aria-label="更換照片" onClick={()=>input.current?.click()}><ImagePlus size={20}/></button><button className="art-save" disabled={!ready||busy} onClick={save}>{busy?'儲存中':'儲存'}</button></header>
  <section className="art-preview">
   {src?<div className="art-zoom"><TransformWrapper key={src} minScale={1} maxScale={8} centerOnInit wheel={{step:.15}} doubleClick={{mode:"reset"}}><TransformComponent wrapperStyle={{width:"100%",height:"100%"}} contentStyle={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <canvas ref={asciiCanvas} aria-label="字符藝術預覽" style={{display:effect==='ascii'?'block':'none'}}/>
    <canvas ref={trackingCanvas} aria-label="視覺追蹤預覽" style={{display:effect==='tracking'?'block':'none',cursor:placing?'crosshair':undefined}} onPointerDown={placeDown} onPointerUp={placeUp} onPointerCancel={()=>{placeStart.current=null;}}/>
   </TransformComponent></TransformWrapper></div>:<button className="art-import" onClick={()=>input.current?.click()}><ImagePlus size={28}/>匯入照片</button>}
   {placing&&<span className="art-placement-hint">點選照片放置區域</span>}
   {src&&<button aria-label="前後對比" className="art-compare" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setCompare(true);}} onPointerUp={()=>setCompare(false)} onPointerCancel={()=>setCompare(false)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 6H4.5A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18H12" stroke="white" strokeWidth="1.5"/><path d="M12 3v18" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><path d="M12 6h7.5A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5H12" stroke="currentColor" strokeWidth="1.5"/></svg></button>}
  </section>
  <section className="art-panel"><div className={'art-controls'+(effect==='tracking'&&tab!=='效果'?' art-tracking-controls':'')}>
   {tab==='效果'&&<div className="art-effect-list">{EFFECTS.map(item=><button key={item.id} className="art-effect-card" aria-label={item.name} aria-pressed={effect===item.id} onClick={()=>{setEffect(item.id);setPlacing(false);}}><span aria-hidden="true" className={'art-effect-sample '+item.id}>{item.id==='ascii'?<span>Aa<br/><small>.:+*#</small></span>:<svg width="80" height="70" viewBox="0 0 80 70" fill="none" aria-hidden="true"><path d="M16 45L40 16L65 42L16 45L46 59L65 42" stroke="currentColor" strokeWidth=".7"/><circle cx="16" cy="45" r="8" stroke="currentColor"/><circle cx="40" cy="16" r="5" stroke="currentColor"/><circle cx="65" cy="42" r="11" stroke="currentColor"/><circle cx="46" cy="59" r="3" stroke="currentColor"/></svg>}</span><span>{item.name}</span></button>)}</div>}
   {effect==='ascii'&&tab==='字符'&&<><label className="art-chars">自訂字符<KeyboardSafeInput aria-label="字符序列" value={settings.characters} maxLength={48} onChange={e=>setSettings(s=>({...s,characters:e.target.value}))}/></label><div className="art-presets">{[' .:-=+*#%@',' ·○◎●','01','░▒▓█'].map(x=><button key={x} aria-pressed={settings.characters===x} onClick={()=>setSettings(s=>({...s,characters:x}))}>{x}</button>)}</div>{range('密度','columns',24,180)}</>}
   {effect==='ascii'&&tab==='範圍'&&<><div className="art-presets">{['亮部','暗部','邊緣','色彩'].map((x,index)=><button key={x} aria-pressed={settings.metric===[0,3,1,2][index]} onClick={()=>setSettings(s=>({...s,metric:[0,3,1,2][index],high:100}))}>{x}</button>)}</div>{range('範圍','low',0,99)}</>}
   {effect==='ascii'&&tab==='外觀'&&<><div className="art-color"><span>字符顏色</span><div className="art-presets"><button aria-pressed={settings.color} onClick={()=>setSettings(s=>({...s,color:true}))}>原色</button><button aria-pressed={!settings.color} onClick={()=>setSettings(s=>({...s,color:false}))}>白色</button></div></div>{toggle('保留底圖',settings.background,()=>setSettings(s=>({...s,background:!s.background})))}{toggle('發光',!!settings.glow,()=>setSettings(s=>({...s,glow:s.glow?0:50})))}</>}
   {effect==='tracking'&&tab==='節點'&&<>{groups(['偵測','輪廓','連線'])}
    {section==='偵測'&&<><div className="art-presets">{[['combined','綜合'],['bright','亮部'],['dark','暗部'],['contrast','邊緣']].map(([key,name])=><button key={key} aria-pressed={tracking.detection===key} onClick={()=>updateTracking('detection',key)}>{name}</button>)}</div>{tr('範圍','threshold',0,80)}{tr('數量','circles',5,150)}</>}
    {section==='輪廓'&&<><div className="art-presets">{[['circle','圓形'],['square','方形']].map(([key,name])=><button key={key} aria-pressed={tracking.shape===key} onClick={()=>updateTracking('shape',key)}>{name}</button>)}</div>{tr('大小','maxRadius',10,80)}{tr('粗細','stroke',.3,3,.1)}</>}
    {section==='連線'&&<>{tr('距離','links',0,400)}{tr('粗細','lineWeight',.2,2,.1)}{tr('節點間距','minDistance',10,100)}</>}
   </>}
   {effect==='tracking'&&tab==='構圖'&&<>{groups(['圓圈鏈','取景框','外觀','文字'])}
    {section==='圓圈鏈'&&<>{tt('圓圈鏈','chain')}{tr('大小','baseRadius',30,400)}{tr('角度','angle',0,180)}</>}
    {section==='取景框'&&<>{tt('取景框','frame')}{tr('大小','frameSize',10,100)}{tr('虛線','dash',2,30)}</>}
    {section==='外觀'&&<><div className="art-presets">{[['#ffffff','白色'],['#a8ffdc','薄荷'],['#ffd178','琥珀'],['#ff7899','玫瑰']].map(([key,name])=><button key={key} aria-pressed={tracking.palette===key} onClick={()=>updateTracking('palette',key)}>{name}</button>)}</div>{tr('線條透明度','opacity',0,1,.01)}{tr('底圖透明度','imageOpacity',0,1,.01)}</>}
    {section==='文字'&&<>{tt('角落文字','labels')}<div className="art-text-fields">{[['topLeft','左上'],['topRight','右上'],['bottomLeft','左下'],['bottomRight','右下']].map(([key,name])=><label key={key}>{name}<KeyboardSafeInput aria-label={name+'文字'} value={tracking[key]} maxLength={40} onChange={e=>updateTracking(key,e.target.value)}/></label>)}</div></>}
   </>}
   {effect==='tracking'&&tab==='區域'&&<>{groups(['遮蔽','大小','紋理'])}
    {section==='遮蔽'&&<><div className="art-presets">{[['mosaic','馬賽克'],['glass','毛玻璃'],['mixed','交錯']].map(([key,name])=><button key={key} aria-pressed={tracking.mode===key} onClick={()=>updateTracking('mode',key)}>{name}</button>)}</div><div className="art-presets"><button aria-pressed={placing} onClick={()=>setPlacing(!placing)}>放置區域</button><button disabled={!tracking.zones.length} onClick={()=>updateTracking('zones',tracking.zones.slice(0,-1))}>復原</button><button disabled={!tracking.zones.length&&!tracking.count} onClick={()=>setTracking(s=>({...s,zones:[],count:0}))}>清除</button></div>{tr('隨機區域','count',0,12)}</>}
    {section==='大小'&&<>{tr('區域大小','size',20,400)}{tracking.mode!=='glass'&&tr('像素大小','pixels',2,60)}{tracking.mode!=='mosaic'&&tr('模糊','blur',0,60)}</>}
    {section==='紋理'&&<>{tt('顆粒','noise')}{tr('強度','textureOpacity',0,1,.01)}<div className="art-presets"><button onClick={()=>textureInput.current?.click()}>上傳紋理</button><button disabled={!tracking.texture} onClick={()=>updateTracking('texture',null)}>移除紋理</button></div></>}
   </>}
  </div><nav aria-label="藝術工具">{tabs.map(label=><button key={label} aria-pressed={tab===label} onClick={()=>selectTab(label)}>{label}</button>)}</nav></section>
  <input hidden ref={input} type="file" accept="image/*" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;const revision=++importRevision.current;setBusy(true);setReady(false);setError('');setCompare(false);try{const next=await processImageFile(f);if(revision===importRevision.current){setSrc(next);setSourceRevision(revision);setTracking(s=>({...s,zones:[]}));}}catch(err){if(revision===importRevision.current)setError(String(err));}finally{if(revision===importRevision.current)setBusy(false);}}}/>
  <input hidden ref={textureInput} type="file" accept="image/*" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{const url=await processImageFile(file),im=new Image();im.onload=()=>updateTracking('texture',im);im.src=url;}catch(e){setError(String(e));}}}/>
  {exportFile&&<div className="art-export" role="dialog" aria-modal="true" aria-label="儲存預覽"><header><button aria-label="返回主頁" onClick={onClose}><ChevronLeft size={22}/></button></header><div className="art-export-image">{exportUrl&&<img className="allow-callout" src={exportUrl} alt="匯出預覽"/>}</div><footer>{exportUrl&&<SaveButton urls={[exportUrl]}/>}<div><button onClick={()=>setExportFile(null)}>繼續編輯</button><button onClick={()=>{setExportFile(null);input.current?.click();}}>修下一張</button></div></footer></div>}
  {error&&<div role="alert" className="art-error" onClick={()=>setError('')}>{error}</div>}
 </div>;
}
