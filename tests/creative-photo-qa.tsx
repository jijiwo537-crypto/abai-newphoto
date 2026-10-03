import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {CollageTool} from '../components/CollageTool';
import {IgPreview} from '../components/IgPreview';
const params=new URLSearchParams(location.search);
const colors=['#ef4444','#22c55e','#3b82f6','#eab308','#a855f7','#f97316','#06b6d4','#ec4899','#888888','#ffffff'];
const files=await Promise.all(colors.slice(0,params.has('single')?1:params.has('empty')?2:10).map(async(color,i)=>{
 const c=document.createElement('canvas');c.width=params.has('portrait')?600:900;c.height=params.has('portrait')?900:600;
 const g=c.getContext('2d')!;g.fillStyle=color;g.fillRect(0,0,c.width,c.height);g.fillStyle='white';g.font='bold 100px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(String(i+1),c.width/2,c.height/2);
 const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));return new File([blob],`photo-${i+1}.png`,{type:'image/png'});
}));
const floating=params.has('swaps')?[{id:'qa-float-a',type:'image',src:URL.createObjectURL(files[9]),x:500,y:220,w:120,h:90,rot:0,opacity:100},{id:'qa-float-b',type:'image',src:URL.createObjectURL(files[1]),x:680,y:350,w:120,h:90,rot:0,opacity:100}]:[];
createRoot(document.getElementById('root')!).render(params.has('ig')
 ? <IgPreview shots={files.slice(0,2).map(f=>URL.createObjectURL(f))} frame={{w:3,h:2}} pageCount={2} faces={[]} onClose={()=>{}}/>
 : <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} initialState={params.has('audit')?{holeCount:0,layout:'image-full',canvasRatio:'3:2',objects:floating}:{holeCount:0}}/>);
if(params.has('audit'))void import('./creative-photo-audit');
if(params.has('empty'))void import('./creative-empty-audit');
