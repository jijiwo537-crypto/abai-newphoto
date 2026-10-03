import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {CollageTool} from '../components/CollageTool';
import {IgPreview} from '../components/IgPreview';
import {installSliderTouch} from '../utils/sliderTouch';
installSliderTouch();
const params=new URLSearchParams(location.search);
const colors=['#ef4444','#22c55e','#3b82f6','#eab308','#a855f7','#f97316','#06b6d4','#ec4899','#888888','#ffffff'];
const files=await Promise.all(colors.slice(0,params.has('single')?1:params.has('four')?4:params.has('empty')||params.has('baseAudit')?2:10).map(async(color,i)=>{
 const c=document.createElement('canvas');c.width=params.has('huge')?4096:params.has('large')?2048:params.has('portrait')?600:900;c.height=params.has('huge')?3072:params.has('large')?1536:params.has('portrait')?900:600;
 const g=c.getContext('2d')!;g.fillStyle=color;g.fillRect(0,0,c.width,c.height);g.fillStyle='white';g.font='bold 100px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(String(i+1),c.width/2,c.height/2);
 const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));return new File([blob],`photo-${i+1}.png`,{type:'image/png'});
}));
const floating=params.has('swaps')?[{id:'qa-float-a',type:'image',src:URL.createObjectURL(files[9]),x:500,y:220,w:120,h:90,rot:0,opacity:100},{id:'qa-float-b',type:'image',src:URL.createObjectURL(files[1]),x:680,y:350,w:120,h:90,rot:0,opacity:100}]:[];
createRoot(document.getElementById('root')!).render(params.has('textureAudit')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialState={{canvasRatio:'1:1',holeCount:0,patternType:'dot',dotSize:15,dotGap:0,dotSquash:50}}/>
 : params.has('baseAudit')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1,2)} initialState={{holeCount:1,layout:'mask-right',holeSize:65,holeType:'circle',holes:[{id:'mask-hole',x:100,y:100,side:'mask'}],objects:[{id:'cover',type:'shape',kind:'rect',filled:true,color:'#121212',x:350,y:200,w:100,h:200,rot:0}]}}/>
 : params.has('v10')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1,2)} initialState={{holeCount:6,holeType:'circle'}}/>
 : params.has('v9')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1,2)} initialState={{holeCount:0}}/>
 : params.has('v8')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={params.has('stress')?files.slice(1):files.slice(1,2)} initialState={{holeCount:0,layout:'image-full',canvasRatio:'3:2'}}/>
 : params.has('ig')
 ? <IgPreview shots={files.slice(0,2).map(f=>URL.createObjectURL(f))} frame={{w:3,h:2}} pageCount={2} faces={[]} onClose={()=>{}}/>
 : <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} initialState={params.has('direction')?{layout:'image-full',canvasRatio:'3:2',holeCount:4,holeSize:15,maskColor:'#FFFFFF',holes:[{id:'right',x:700,y:100,side:'image'},{id:'left',x:100,y:200,side:'image'},{id:'middle',x:400,y:500,side:'image'},{id:'absent',x:-200,y:200,side:'mask'}]}:params.has('audit')||params.has('four')?{holeCount:0,layout:'image-full',canvasRatio:'3:2',objects:floating}:{holeCount:0}}/>);
if(params.has('singleEditAudit'))void import('./creative-single-edit-audit');
else if(params.has('baseAudit'))void import('./creative-base-photo-audit');
else if(params.has('textureAudit'))void import('./mask-texture-audit');
else if(params.has('exportAudit'))void import('./collage-export-audit');
else if(params.has('v10'))void import('./creative-v10-audit');
else if(params.has('v9'))void import('./creative-v9-audit');
else if(params.has('v8'))void import('./creative-v8-audit');
else if(params.has('v7'))void import('./creative-v7-audit');
else if(params.has('guideAudit'))void import('./creative-guides-audit');
else if(params.has('v6'))void import('./creative-v6-audit');
else if(params.has('direction')||(params.has('four')&&!params.has('manual')))void import('./creative-v5-audit');
else if(params.has('encode'))void import('./creative-export-audit');
else if(params.has('controls'))void import('./creative-tools-audit');
else if(params.has('perf'))void import('./creative-photo-perf');
else if(params.has('audit'))void import('./creative-photo-audit');
if(params.has('empty'))void import('./creative-empty-audit');
