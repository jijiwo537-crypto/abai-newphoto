import React,{useEffect,useRef,useState} from 'react';
import {maskDefaults,glassCells,GLASS_MAX_CELLS,type MaskSettings} from '../utils/backdropMasks';
export function BackdropMaskControls({kind,settings,onChange,onInteraction}:{kind:string;settings:MaskSettings&{opacity?:number};onChange:(p:any)=>void;onInteraction?:(active:boolean)=>void}){
 const defaults=maskDefaults(kind);
 // 兩種負片只能換形狀，沒有滑桿
 const shapeOnly=kind==='mask-negative'||kind==='mask-negative-mono';
 const controls:{label:string;key:keyof MaskSettings|'opacity';min:number;max:number;value:number}[]=[];
 if(kind==='mask-mosaic')controls.push({label:'格數',key:'maskCells',min:5,max:200,value:settings.maskCells??15});
 if(kind==='mask-bricks')controls.push({label:'格數',key:'maskCells',min:4,max:GLASS_MAX_CELLS,value:glassCells(settings)},{label:'折射',key:'maskRefract',min:0,max:100,value:settings.maskRefract??100});
 if(!shapeOnly&&kind!=='mask-mosaic'&&kind!=='mask-bricks')controls.push({label:'強度',key:'maskAmount',min:0,max:100,value:settings.maskAmount??defaults.maskAmount!});
 if(kind==='mask-frost-feather')controls.push({label:'羽化',key:'maskFeather',min:0,max:100,value:settings.maskFeather??35});
 return <div data-mask-editor={kind} className="max-w-md mx-auto h-full px-4 pt-1 overflow-y-auto no-scrollbar">
  <div className="grid grid-cols-3 gap-2 mb-5" data-mask-shapes>{([['square','方形'],['circle','圓形'],['star','星形']] as const).map(([shape,label])=><button key={shape} aria-pressed={(settings.maskShape||defaults.maskShape)===shape} onClick={()=>onChange({maskShape:shape})} className={`h-9 rounded-lg border text-xs transition-colors ${(settings.maskShape||defaults.maskShape)===shape?'border-white bg-white text-black':'border-white/15 text-white/50'}`}>{label}</button>)}</div>
  {controls.length>0&&<div className="flex flex-col gap-5 pb-14">{controls.map(c=><MaskRange key={c.key} {...c} onInteraction={onInteraction} onChange={value=>onChange({[c.key]:value})}/>)}</div>}
 </div>;
}
function MaskRange({label,value,min,max,onChange,onInteraction}:any){
 const [shown,setShown]=useState(value),frame=useRef(0),pending=useRef<number|null>(null),callback=useRef(onChange);callback.current=onChange;
 useEffect(()=>setShown(value),[value]);useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
 const flush=()=>{cancelAnimationFrame(frame.current);frame.current=0;if(pending.current!==null){callback.current(pending.current);pending.current=null;}onInteraction?.(false);};
 return <div className="space-y-2"><div className="flex items-center justify-between"><span className="text-[11px] font-bold text-white/70">{label}</span><span className="text-xs tabular-nums text-white">{shown}</span></div>
 <div className="slider-wrap" style={{height:16}}><input aria-label={label} type="range" min={min} max={max} step="1" value={shown} className="premium-slider w-full"
 onChange={e=>{const v=Number(e.target.value);setShown(v);pending.current=v;if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;const p=pending.current;pending.current=null;if(p!==null)callback.current(p);});}}
 onPointerDown={()=>onInteraction?.(true)} onPointerUp={flush} onPointerCancel={flush} onTouchEnd={flush} onKeyUp={flush}/></div></div>;
}
