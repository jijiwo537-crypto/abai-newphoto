import React,{useEffect,useRef,useState} from 'react';
import {ART_SWATCHES,artHexToHsv,artHsvToHex} from '../utils/artColors';

export function ArtColorControls({value,onChange}:{value:string;onChange:(color:string)=>void}){
 const [hsv,setHsv]=useState(()=>artHexToHsv(value));
 const sent=useRef(value);
 useEffect(()=>{if(value.toLowerCase()!==sent.current.toLowerCase()){sent.current=value;setHsv(artHexToHsv(value));}},[value]);
 const pick=(color:string)=>{sent.current=color;setHsv(artHexToHsv(color));onChange(color);};
 const change=(key:'h'|'s'|'v',n:number)=>{const next={...hsv,[key]:n},color=artHsvToHex(next);sent.current=color;setHsv(next);onChange(color);};
 const range=(name:string,key:'h'|'s'|'v',max:number,bar:string)=><label className="art-range art-color-range"><span>{name}<output>{Math.round(hsv[key])}{key==='h'?'°':'%'}</output></span><input aria-label={name} type="range" min={0} max={max} step={1} value={hsv[key]} style={{'--art-color-bar':bar} as React.CSSProperties} onChange={e=>change(key,+e.target.value)}/></label>;
 return <div className="art-color-controls">
  <div className="art-swatches" role="group" aria-label="顏色色票">{ART_SWATCHES.map(([color,name])=><button key={color} aria-label={name} aria-pressed={value.toLowerCase()===color} style={{backgroundColor:color}} onClick={()=>pick(color)}/>)}<label className="art-custom-color" title="自訂顏色"><span/><input aria-label="自訂顏色" type="color" value={value} onChange={e=>pick(e.target.value)}/></label></div>
  {range('色相','h',360,'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)')}
  <div className="art-detail-ranges">{range('飽和度','s',100,`linear-gradient(to right,#808080,${artHsvToHex({...hsv,s:100,v:100})})`)}{range('明度','v',100,`linear-gradient(to right,#000,${artHsvToHex({...hsv,v:100})})`)}</div>
 </div>;
}
