import React,{useEffect,useRef,useState} from 'react';
import {maskDefaults,type MaskSettings} from '../utils/backdropMasks';
export function BackdropMaskControls({kind,settings,onChange,onInteraction}:{kind:string;settings:MaskSettings&{opacity?:number};onChange:(p:any)=>void;onInteraction?:(active:boolean)=>void}){
 const defaults=maskDefaults(kind);
 const controls:{label:string;key:keyof MaskSettings|'opacity';min:number;max:number;value:number}[]=[];
 if(kind==='mask-mosaic')controls.push({label:'馬賽克',key:'maskCells',min:5,max:200,value:settings.maskCells??50});
 if(kind==='mask-bricks')controls.push({label:'格數',key:'maskCells',min:4,max:60,value:settings.maskCells??22},{label:'折射',key:'maskRefract',min:0,max:100,value:settings.maskRefract??100});
 controls.push({label:'強度',key:'maskAmount',min:0,max:100,value:settings.maskAmount??defaults.maskAmount!});
 if(kind==='mask-frost-feather')controls.push({label:'羽化',key:'maskFeather',min:0,max:100,value:settings.maskFeather??35});
 controls.push({label:'透明度',key:'opacity',min:0,max:100,value:settings.opacity??100});
 return <div data-mask-editor={kind} className="max-w-md mx-auto h-full px-4 pt-1 overflow-y-auto no-scrollbar">
  <div className="flex flex-col gap-5 pb-14">{controls.map(c=><MaskRange key={c.key} {...c} onInteraction={onInteraction} onChange={value=>onChange({[c.key]:value})}/>)}</div>
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
