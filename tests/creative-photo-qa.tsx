import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {CollageTool} from '../components/CollageTool';
import {IgPreview} from '../components/IgPreview';
import {installSliderTouch} from '../utils/sliderTouch';
installSliderTouch();
const params=new URLSearchParams(location.search);
const colors=['#ef4444','#22c55e','#3b82f6','#eab308','#a855f7','#f97316','#06b6d4','#ec4899','#888888','#ffffff'];
// Serialize fixture encoding: concurrent native-size canvases and PNG encoders
// can exhaust an 8 GB test Mac before the application itself even starts.
const files:File[]=[];
const fixtureColors=colors.slice(0,params.has('mixedSwap')?5:params.has('single')?1:params.has('three')?3:params.has('four')?4:params.has('nine')?9:params.has('empty')||params.has('baseAudit')?2:10);
for(const [i,color] of fixtureColors.entries()){
 const portrait=params.has('portrait')||params.has('mixedSwap')&&i===4;
 const c=document.createElement('canvas');c.width=params.has('huge')?(portrait?3072:4096):params.has('large')?(portrait?1536:2048):portrait?600:900;c.height=params.has('huge')?(portrait?4096:3072):params.has('large')?(portrait?2048:1536):portrait?900:600;
 const g=c.getContext('2d')!;g.fillStyle=params.has('edgeAudit')?'white':color;
 if(params.has('gradient')){const gradient=g.createLinearGradient(0,0,c.width,c.height);gradient.addColorStop(0,color);gradient.addColorStop(.5,'#13254f');gradient.addColorStop(1,'#fef1b7');g.fillStyle=gradient;}
 g.fillRect(0,0,c.width,c.height);g.fillStyle='white';g.font='bold 100px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(String(i+1),c.width/2,c.height/2);
 if(params.has('detail')){for(let row=0;row<10;row++)for(let col=0;col<12;col++){g.fillStyle=(row+col)%2?'#fed298':'#26305c';g.fillRect(col*c.width/12,row*c.height/10,c.width/30,c.height/24);}}
 const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));c.width=c.height=1;files.push(new File([blob],`photo-${i+1}.png`,{type:'image/png'}));
}
const floating=params.has('swaps')?[{id:'qa-float-a',type:'image',src:URL.createObjectURL(files[9]),x:500,y:220,w:120,h:90,rot:0,opacity:100},{id:'qa-float-b',type:'image',src:URL.createObjectURL(files[1]),x:680,y:350,w:120,h:90,rot:0,opacity:100}]:[];
createRoot(document.getElementById('root')!).render(params.has('seamPresentation')&&params.has('split')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} initialState={{layout:'mask-right',canvasRatio:'3:2',holeCount:3,holeType:'circle',holeSize:35,holes:[{id:'seam-hole-a',x:80,y:120,side:'mask'},{id:'seam-hole-b',x:180,y:330,side:'mask'},{id:'seam-hole-c',x:100,y:510,side:'mask'}]}}/>
 : params.has('edgeAudit')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1,3)} initialState={{layout:'mask-right',canvasRatio:'3:2',holeCount:0}}/>
 : params.has('mixedSwap')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1,4)} initialState={{layout:'mask-right',canvasRatio:'3:2',holeCount:0,objects:[{id:'mixed-float',type:'image',src:URL.createObjectURL(files[4]),x:500,y:220,w:120,h:180,rot:0,opacity:100}]}}/>
 : params.has('swapStress')&&params.has('three')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} lutList={params.has('zeroEffects')?[{id:'qa-zero-f3',name:'F3',url:'/luts/f3.webp'}]:[]} initialState={{layout:'mask-right',canvasRatio:'3:2',holeCount:0}}/>
 : params.has('swapStress')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} initialState={{layout:'mask-right',canvasRatio:'3:2',holeCount:30,glowMode:'image',holeType:'star',holeSize:12,objects:Array.from({length:8},(_,i)=>({id:`swap-shape-${i}`,type:'shape',kind:i%2?'star':'grid-orbits',filled:i%2===1,color:'#fff',x:700,y:100+i*100,w:30,h:30,rot:0,shapeGlow:true,shapeGlowAmount:25}))}}/>
 : (params.has('coldEditAudit')||params.has('coldEffectsAudit')||params.has('liveVisible')||params.has('gestureCost'))&&params.has('realFilters')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} lutList={Array.from({length:22},(_,i)=>({id:`cold-${params.get('run')||'audit'}-f${i+1}`,name:`F${i+1}`,url:`/luts/f${i+1}.webp`}))} initialState={params.has('busyZoom')?{holeCount:30,holeType:'star',holeSize:15,linkMode:'solid',glowMode:'image',holes:Array.from({length:30},(_,i)=>({id:`busy-zoom-${i}`,x:50+(i%6)*140,y:50+Math.floor(i/6)*100,side:'image'}))}:{holeCount:0}}/>
 : params.has('spatialIntegrationAudit')&&params.has('around')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} initialState={{holeCount:2,layout:'mask-around',holeSize:45,holeType:'circle',holes:[{id:'audit-a',x:100,y:100,side:'mask'},{id:'audit-b',x:600,y:500,side:'mask'}]}}/>
 : params.has('lifecycleAudit')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} initialState={{holeCount:0,layout:'mask-right',canvasRatio:'3:2'}}/>
 : params.has('textureAudit')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialState={{canvasRatio:'1:1',holeCount:0,patternType:'dot',dotSize:15,dotGap:0,dotSquash:50}}/>
 : params.has('busyEdit')
 ? <CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={files[0]} initialExtras={files.slice(1)} initialState={{holeCount:30,layout:'mask-right',holeSize:15,holeType:'star',glowMode:'image',holes:Array.from({length:30},(_,i)=>({id:`busy-${i}`,x:30+(i%5)*48,y:55+Math.floor(i/5)*140,side:'mask'}))}}/>
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
if(params.has('edgeAudit'))void import('./creative-photo-edge-audit');
else if(params.has('seamPresentation'))void import('./creative-seam-presentation-audit');
else if(params.has('mixedSwap'))void import('./creative-mixed-swap-audit');
else if(params.has('coldInterleave'))void import('./creative-cold-interleave-audit');
else if(params.has('liveVisible'))void import('./creative-live-visible-audit');
else if(params.has('gestureCost'))void import('./creative-gesture-cost-audit');
else if(params.has('swapStress'))void import('./creative-swap-stress-audit');
else if(params.has('tabAudit'))void import('./creative-tab-switch-audit');
else if(params.has('sliderAudit'))void import('./slider-native-audit');
else if(params.has('lifecycleAudit'))void import('./creative-base-lifecycle-audit');
else if(params.has('spatialIntegrationAudit'))void import('./creative-spatial-integration-audit');
else if(params.has('spatialSceneAudit'))void import('./photo-spatial-scene-audit');
else if(params.has('coldEffectsAudit'))void import('./creative-cold-effects-audit');
else if(params.has('coldEditAudit'))void import('./creative-cold-edit-audit');
else if(params.has('sceneColourAudit'))void import('./photo-scene-colour-audit');
else if(params.has('singleEditAudit'))void import('./creative-single-edit-audit');
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
