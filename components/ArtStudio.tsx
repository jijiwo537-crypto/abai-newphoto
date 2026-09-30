import {TransformWrapper,TransformComponent} from 'react-zoom-pan-pinch';
import React,{useState,useRef,useEffect} from 'react';
import {AsciiRenderer,ASCII_DEFAULTS} from '../utils/asciiRenderer';
import {processImageFile} from '../utils/imageLoader';
import {shareFiles} from '../utils/shareAll';
import './ArtStudio.css';
import {KeyboardSafeInput} from './KeyboardSafeInput';
import {ChevronLeft,ScanLine,Type,Palette,Columns2,ImagePlus} from 'lucide-react';
export function ArtStudio({onClose,initialSrc=''}:{onClose:()=>void;initialSrc?:string}){
 const [src,setSrc]=useState(initialSrc),[settings,setSettings]=useState(ASCII_DEFAULTS),[tab,setTab]=useState<'字符'|'範圍'|'外觀'>('字符'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[compare,setCompare]=useState(false),[ready,setReady]=useState(false);
 const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<AsciiRenderer|null>(null),input=useRef<HTMLInputElement>(null),frame=useRef(0),options=useRef(settings);options.current=settings;
 const importRevision=useRef(0);
 const [sourceRevision,setSourceRevision]=useState(0);
 const [exportFile,setExportFile]=useState<File|null>(null),[exportUrl,setExportUrl]=useState('');
 const savePrepared = async () => {
  if (!exportFile || busy) return;
  setBusy(true);
  try {
   const result = await shareFiles([exportFile]);
   if (result === 'failed') setError('無法儲存，請再試一次。');
   else if (result !== 'cancelled') setExportFile(null);
  } catch (err) {
   setError(err instanceof Error ? err.message : '無法儲存，請再試一次。');
  } finally { setBusy(false); }
 };
 useEffect(()=>{if(!exportFile){setExportUrl('');return;}const url=URL.createObjectURL(exportFile);setExportUrl(url);return()=>URL.revokeObjectURL(url);},[exportFile]);
 useEffect(()=>()=>{importRevision.current++;},[]);
 useEffect(()=>{setReady(false);if(!src||!canvas.current)return;let cancelled=false;const image=new Image();image.onload=()=>{if(cancelled)return;try{renderer.current=new AsciiRenderer(canvas.current!);renderer.current.setImage(image);renderer.current.draw(options.current);setReady(true);}catch(e){renderer.current?.dispose();renderer.current=null;setError(String(e));}};image.onerror=()=>{if(!cancelled)setError('照片無法讀取，請重新選擇。');};image.src=src;return()=>{cancelled=true;image.onload=null;image.onerror=null;renderer.current?.dispose();renderer.current=null;};},[src,sourceRevision]);
 useEffect(()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>renderer.current?.draw(settings,compare));return()=>cancelAnimationFrame(frame.current);},[settings,compare]);
 const range=(name:string,key:'columns'|'low'|'high'|'glow',min:number,max:number)=><label className="art-range"><span>{name}<output>{settings[key]}</output></span><input aria-label={name} type="range" min={min} max={max} value={settings[key]} onChange={e=>{const value=+e.target.value;setSettings(s=>({...s,[key]:key==='low'?Math.min(value,s.high-1):key==='high'?Math.max(value,s.low+1):value}));}}/></label>;
 return <div className="art-studio"><header><button aria-label="返回" onClick={onClose}><ChevronLeft size={23}/></button><button disabled={!ready||busy} onClick={async()=>{setBusy(true);try{renderer.current?.draw(settings);const blob=await new Promise<Blob|null>(r=>canvas.current!.toBlob(r,'image/png'));if(!blob)throw Error('無法儲存圖片');setExportFile(new File([blob],'ABAI-ASCII.png',{type:'image/png'}));}catch(e){setError(String(e));}finally{setBusy(false);}}}>{busy?'儲存中':'儲存'}</button></header>
 <section className="art-preview">{src?<div className="art-zoom"><TransformWrapper key={src} minScale={1} maxScale={8} centerOnInit wheel={{step:.15}} doubleClick={{mode:"reset"}}><TransformComponent wrapperStyle={{width:"100%",height:"100%"}} contentStyle={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}><canvas ref={canvas} aria-label="ASCII 藝術預覽"/></TransformComponent></TransformWrapper></div>:<button className="art-import" onClick={()=>input.current?.click()}><ImagePlus size={28}/>匯入照片</button>}{src&&<button aria-label="前後對比" className="art-compare" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setCompare(true);}} onPointerUp={()=>setCompare(false)} onPointerCancel={()=>setCompare(false)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 6H4.5A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18H12" stroke="white" strokeWidth="1.5"/><path d="M12 3v18" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><path d="M12 6h7.5A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5H12" stroke="currentColor" strokeWidth="1.5"/></svg></button>}</section>
 <section className="art-panel"><div className="art-controls">
 {tab==='字符'&&<><label className="art-chars">自訂字符<KeyboardSafeInput aria-label="字符序列" value={settings.characters} maxLength={96} onChange={e=>setSettings(s=>({...s,characters:e.target.value}))}/></label><div className="art-presets">{[' .:-=+*#%@',' ·○◎●','01','░▒▓█'].map(x=><button key={x} aria-pressed={settings.characters===x} onClick={()=>setSettings(s=>({...s,characters:x}))}>{x}</button>)}</div>{range('密度','columns',24,180)}</>}
 {tab==='範圍'&&<><div className="art-presets">{['亮部','暗部','邊緣','色彩'].map((x,index)=><button key={x} aria-pressed={settings.metric===[0,3,1,2][index]} onClick={()=>setSettings(s=>({...s,metric:[0,3,1,2][index],high:100}))}>{x}</button>)}</div>{range('範圍','low',0,99)}</>}
 {tab==='外觀'&&<><div className="art-color"><span>字符顏色</span><div className="art-presets"><button aria-pressed={settings.color} onClick={()=>setSettings(s=>({...s,color:true}))}>原色</button><button aria-pressed={!settings.color} onClick={()=>setSettings(s=>({...s,color:false}))}>白色</button></div></div><button className="art-toggle" role="switch" aria-checked={settings.background} onClick={()=>setSettings(s=>({...s,background:!s.background}))}>保留底圖 <i/></button>{range('發光','glow',0,100)}</>}
</div><nav>{([{label:'字符',Icon:Type},{label:'範圍',Icon:ScanLine},{label:'外觀',Icon:Palette}] as const).map(({label,Icon})=><button key={label} aria-pressed={tab===label} onClick={()=>setTab(label)}><Icon size={21} strokeWidth={1.6}/><span>{label}</span></button>)}<button aria-label="更換照片" onClick={()=>input.current?.click()}><ImagePlus size={21} strokeWidth={1.6}/><span>照片</span></button></nav></section><input hidden ref={input} type="file" accept="image/*" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;const revision=++importRevision.current;setBusy(true);setReady(false);setError('');setCompare(false);try{const next=await processImageFile(f);if(revision===importRevision.current){setSrc(next);setSourceRevision(revision);}}catch(err){if(revision===importRevision.current)setError(String(err));}finally{if(revision===importRevision.current)setBusy(false);}}}/>{exportFile&&<div className="art-export" role="dialog" aria-modal="true" aria-label="藝術效果儲存預覽"><div><button aria-label="關閉儲存預覽" onClick={()=>setExportFile(null)}>×</button><h2>作品已準備好</h2>{exportUrl&&<img src={exportUrl} alt="ASCII 匯出預覽"/>}<button disabled={busy} onClick={savePrepared}>{busy?'儲存中':'儲存圖片'}</button></div></div>}{error&&<div role="alert" className="art-error" onClick={()=>setError('')}>{error}</div>}</div>;
}
