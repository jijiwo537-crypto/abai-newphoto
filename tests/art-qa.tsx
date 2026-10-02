import React from 'react';
import {createRoot} from 'react-dom/client';
import {CollageTool} from '../components/CollageTool';
import {ArtStudio} from '../components/ArtStudio';
import {ImageEditor} from '../components/ImageEditor';
import {BeautyStudio} from '../components/BeautyStudio';
import {ColorMatchStudio} from '../components/ColorMatchStudio';
import {ImageAdjustPanel} from '../components/GridLayoutTool';
import {FX_DEFAULTS} from '../utils/glEffects';
import {installSliderTouch} from '../utils/sliderTouch';
import '../styles.css';
installSliderTouch();
const query=new URLSearchParams(location.search);
if(query.has('beautyAudit'))void import('./beauty-interaction-audit').then(m=>m.auditBeauty());
if(query.has('sliderPerf'))void import('./effect-slider-performance-audit').then(m=>m.auditEffectSliders()).catch(e=>{const out=document.createElement('pre');out.textContent=String(e);out.style.cssText='position:fixed;inset:100px 8px;z-index:99999;color:white;background:#111';document.body.append(out);});
if(query.has('halationAudit'))void import('./halation-performance-audit').then(m=>m.auditHalation()).catch(e=>{(window as any).__halationError=String(e);const out=document.createElement('pre');out.textContent=String(e);out.style.cssText='position:fixed;inset:100px 8px;z-index:99999;color:white;background:#111';document.body.append(out);});
if(query.has('glyphglow'))void import('./art-glyph-glow-audit');
if(query.has('relativeAudit'))void import('./relative-controls-audit').then(m=>m.auditRelativeControls());
if(query.has('fineAudit'))void import('./editor-fine-slider-audit').then(m=>m.auditFineSlider()).catch(e=>fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'fine-audit-error',error:String(e),stack:e.stack})}));
if(query.has('editor')&&query.has('composeAudit'))void import('./editor-compose-audit');
if(query.has('fixture')&&query.has('refinement'))void import('./art-refinement-audit').then(m=>m.auditArtRefinement());
if(query.has('fixture')&&(query.has('audit')||(query.has('geometry')&&(navigator as any).standalone)))void import('./art-controls-audit').then(m=>m.auditArtControls());
function ArtFixture({src}:{src:string}){const [open,setOpen]=React.useState(!query.has('geometry'));return open?<ArtStudio initialSrc={src} onClose={()=>setOpen(false)}/>:<div style={{position:'relative',height:'100vh',background:'#090909'}}><button style={{position:'absolute',top:100,color:'white'}} onClick={()=>setOpen(true)}>重新進入藝術效果</button></div>;}
function SharedPanelFixture({src}:{src:string}){
 const [img,setImg]=React.useState({id:'qa-panel',src,fx:{...FX_DEFAULTS,fxExposureSpill:60,softThreshold:80}}),[card,setCard]=React.useState('fxExposureSpill'),[detail,setDetail]=React.useState(true),[sub,setSub]=React.useState('effect');
 return <div style={{height:'100dvh',display:'flex',flexDirection:'column',background:'#080808',color:'white'}}><img src={src} style={{minHeight:0,flex:1,objectFit:'contain',padding:16}}/><div style={{height:'calc(11rem + 58px)'}}><ImageAdjustPanel img={img} set={p=>setImg(s=>({...s,...p}))} lutList={[{id:'none',name:'原始',url:''}]} loadingLut={null} setLoadingLut={()=>{}} lutRevision={0} setLutRevision={()=>{}} adjustSub={sub as any} setAdjustSub={setSub} effectCard={card} setEffectCard={setCard} effectDetail={detail} setEffectDetail={setDetail} shapeMenu="" setShapeMenu={()=>{}} shapeTool="" setShapeTool={()=>{}} tuneTool="" setTuneTool={()=>{}} setTuningEdge={()=>{}} openComposeFor={()=>{}}/></div></div>;
}
if(query.has('geometry')){let lastTap='';document.addEventListener('pointerup',e=>{lastTap=(e.target as HTMLElement).closest('button')?.textContent?.slice(0,16)||'canvas';});setInterval(()=>{let el=document.querySelector<HTMLElement>('.art-studio');if(!el)return;let out=document.getElementById('art-geometry');if(!out){out=document.createElement('pre');out.id='art-geometry';Object.assign(out.style,{position:'fixed',top:'120px',left:'8px',zIndex:'9999',fontSize:'10px',background:'#000b',color:'#0f0',pointerEvents:'none'});document.body.append(out);}const r=el.getBoundingClientRect(),nav=el.querySelector('nav')?.getBoundingClientRect();out.textContent=JSON.stringify({standalone:(navigator as any).standalone,tap:lastTap,screen:screen.height,inner:innerHeight,width:innerWidth,visual:visualViewport?.height,scale:visualViewport?.scale,offset:visualViewport?.offsetTop,top:r.top,bottom:r.bottom,height:r.height,navBottom:nav?.bottom,margin:getComputedStyle(el).marginTop},null,2);},500);}
if(query.has('beauty')||query.has('match')){
 const c=document.createElement('canvas');c.width=1200;c.height=1600;const g=c.getContext('2d')!;const grad=g.createLinearGradient(0,0,1200,1600);grad.addColorStop(0,'#173959');grad.addColorStop(1,'#dfae96');g.fillStyle=grad;g.fillRect(0,0,1200,1600);g.fillStyle='white';g.fillRect(350,150,100,900);g.beginPath();g.arc(800,800,200,0,Math.PI*2);g.fill();const src=c.toDataURL();
 createRoot(document.getElementById('root')!).render(query.has('beauty')?<BeautyStudio imageSrc={src} onCancel={()=>{}} onHome={()=>{}} onImportNew={()=>{}} onSendToEditor={()=>{}}/>:<ColorMatchStudio imageSrc={src} referenceSrc={src} onCancel={()=>{}} onHome={()=>{}} onImportNew={()=>{}} onPickReference={()=>{}}/>);
}else if(query.has('creative')){
 const c=document.createElement('canvas');c.width=600;c.height=800;
 const g=c.getContext('2d')!;const grad=g.createLinearGradient(0,0,600,800);grad.addColorStop(0,'#1b527f');grad.addColorStop(1,'#bd9670');g.fillStyle=grad;g.fillRect(0,0,600,800);
 g.fillStyle='white';g.font='80px sans-serif';g.fillText('PHOTO',80,400);
 const holes=Array.from({length:30},(_,i)=>({id:`qa-${i}`,x:70+(i%5)*108,y:65+Math.floor(i/5)*132,side:'both',sizeRand:(i%7)/7,angleRand:0}));
 const objects=query.has('objects')?[
  {id:'qa-shape',type:'shape',kind:'star',w:170,h:170,x:230,y:250,color:'#ff5533',opacity:50},
  {id:'qa-below',type:'shape',kind:'circle',w:140,h:140,x:480,y:390,color:'#6655ff',below:true},
  {id:'qa-text',type:'text',text:'ABAI',size:40,w:140,h:50,x:340,y:350,color:'#ffffff',font:'sans-serif'},
  {id:'qa-photo',type:'image',src:c.toDataURL(),w:170,h:160,x:470,y:270,rot:15},
 ]:[];
 c.toBlob(blob=>createRoot(document.getElementById('root')!).render(<CollageTool onHome={()=>{}} onImportNew={()=>{}} initialFile={new File([blob!],'photo.png',{type:'image/png'})} initialState={{layout:'mask-right',holeCount:30,holes,objects,holeType:query.get('kind')||'star',glowMode:'image',holeSize:65,sizeJitter:55}}/>));
}else if(query.has('editor')){
 const c=document.createElement('canvas');c.width=query.has('large')?3000:1200;c.height=query.has('long')?5000:query.has('large')?4000:1600;const g=c.getContext('2d')!;g.scale(c.width/1200,c.height/1600);
 const grad=g.createLinearGradient(0,0,1200,1600);grad.addColorStop(0,'#173959');grad.addColorStop(1,'#dfae96');g.fillStyle=grad;g.fillRect(0,0,1200,1600);g.fillStyle='white';g.fillRect(350,150,100,900);g.beginPath();g.arc(800,800,200,0,Math.PI*2);g.fill();
 createRoot(document.getElementById('root')!).render(query.has('sharedPanel')?<SharedPanelFixture src={c.toDataURL()}/>:<ImageEditor imageSrc={c.toDataURL()} lutList={[{id:'none',name:'原始',url:''}]} onSave={()=>{}} onCancel={()=>{}}/>);
}else {
 const c=document.createElement('canvas');c.width=600;c.height=800;
 const g=c.getContext('2d')!;const gradient=g.createLinearGradient(0,0,600,800);gradient.addColorStop(0,'#34547f');gradient.addColorStop(1,'#d7ac94');g.fillStyle=gradient;g.fillRect(0,0,600,800);g.fillStyle='white';g.font='90px sans-serif';g.fillText('ABAI',80,400);
 createRoot(document.getElementById('root')!).render(<ArtFixture src={query.has('fixture')?c.toDataURL():''}/>);
}

if(query.has('alignbench')) void (async()=>{
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const click=(text:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes(text))?.click();
 while(!document.querySelector('canvas[aria-hidden=true]'))await frame();
 for(let i=0;i<30;i++)await frame();click('特效');await frame();
 const samples:any[]=[];
 for(let round=0;round<3;round++)for(const id of ['fxNone','fxExposureSpill']){
  (document.querySelector(`[data-fx-tool=${id}]`) as HTMLElement).click();
  for(let i=0;i<20;i++){await frame();const b=document.querySelector('canvas[aria-hidden=true]')!;const a=b.previousElementSibling!;const r=a.getBoundingClientRect(),s=b.getBoundingClientRect();samples.push({x:r.x,y:r.y,w:r.width,h:r.height,dx:s.x-r.x,dy:s.y-r.y,dw:s.width-r.width,dh:s.height-r.height});}
 }
 const report={kind:'fx-alignment',samples};
 const out=document.createElement('pre');out.textContent=JSON.stringify({kind:report.kind,sampleCount:samples.length,unique:[...new Set(samples.map(s=>JSON.stringify(s)))]},null,2);Object.assign(out.style,{position:'fixed',inset:'60px 10px auto',zIndex:'99999',background:'#111',color:'white',fontSize:'11px'});document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();

// Development-only WebKit/Chromium benchmark. It uses the real mounted controls
// and leaves results visible; synthetic events are not a substitute for touch QA.
if(query.has('bench')&&query.has('creative')) void (async()=>{
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n=3)=>{for(let i=0;i<n;i++)await frame();};
 while(!document.querySelector<HTMLCanvasElement>('canvas[data-paint-count]'))await frame();
 await wait(30);
 (document.querySelectorAll('button')[10] as HTMLButtonElement).click();await wait();
 const click=(text:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===text||b.getAttribute('aria-label')===text||b.title===text)?.click();
 click('參數');await wait();click('實線');await wait(10);
 const results:any[]=[];
 const run=async(label:string,index:number)=>{
  const el=document.querySelectorAll<HTMLInputElement>('input[type=range]')[index];
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  const deltas:number[]=[];let last=performance.now();
  for(let i=0;i<100;i++){await frame();const t=performance.now();if(i>15)deltas.push(t-last);last=t;setter.call(el,String(+el.min+(+el.max-+el.min)*(.5+.4*Math.sin(i*.07))));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
  deltas.sort((a,b)=>a-b);const c=document.querySelector<HTMLCanvasElement>('canvas[data-paint-count]')!;
  results.push({label,p50:deltas[Math.floor(deltas.length*.5)],p95:deltas[Math.floor(deltas.length*.95)],max:deltas.at(-1),size:[c.width,c.height],full:c.dataset.fullSize});
 };
 await run('base-size',0);
 const c=document.querySelector('canvas[data-paint-count]')!;
 for(let i=0;i<7;i++){c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:innerWidth/2,clientY:280}));await wait(3);}
 await wait(20);await run('zoom-size',0);await run('zoom-angle',3);await run('zoom-variation',2);
 const report={ua:navigator.userAgent,kind:query.get('kind')||'star',results};
 const out=document.createElement('pre');out.textContent=JSON.stringify(report,null,2);Object.assign(out.style,{position:'fixed',inset:'60px 10px auto',zIndex:'99999',background:'#111',color:'white',fontSize:'11px',maxHeight:'75vh',overflow:'auto'});document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(report)}).catch(()=>{});
})();

if(query.has('fxbench')) void (async()=>{
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 while(!Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('特效')))await frame();
 for(let i=0;i<30;i++)await frame();
 Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('特效'))!.click();
 const results:any[]=[];
 for(const id of ['fxLowfi','fxExposureSpill']){
  while(!document.querySelector(`[data-fx-tool=${id}]`))await frame();
  (document.querySelector(`[data-fx-tool=${id}]`) as HTMLElement).click();
  for(let i=0;i<40;i++)await frame();
  const el=document.querySelector<HTMLInputElement>('input[type=range]')!;
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  const ds:number[]=[];let prev=performance.now();
  for(let i=0;i<100;i++){await frame();const t=performance.now();if(i>15)ds.push(t-prev);prev=t;set.call(el,String(50+40*Math.sin(i*.08)));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
  ds.sort((a,b)=>a-b);results.push({id,p50:ds[Math.floor(ds.length*.5)],p95:ds[Math.floor(ds.length*.95)],max:ds.at(-1)});
 }
 const report={ua:navigator.userAgent,kind:'editor-fx',results};
 const out=document.createElement('pre');out.textContent=JSON.stringify(report,null,2);Object.assign(out.style,{position:'fixed',inset:'60px 10px auto',zIndex:'99999',background:'#111',color:'white',fontSize:'11px'});document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(report)}).catch(()=>{});
})();
