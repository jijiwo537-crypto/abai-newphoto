import React from 'react';
import {createRoot} from 'react-dom/client';
import {CollageTool} from '../components/CollageTool';
import {ArtStudio} from '../components/ArtStudio';
import {ImageEditor} from '../components/ImageEditor';
import {installSliderTouch} from '../utils/sliderTouch';
import '../styles.css';
installSliderTouch();
const query=new URLSearchParams(location.search);
if(query.has('creative')){
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
 const c=document.createElement('canvas');c.width=1200;c.height=1600;const g=c.getContext('2d')!;
 const grad=g.createLinearGradient(0,0,1200,1600);grad.addColorStop(0,'#173959');grad.addColorStop(1,'#dfae96');g.fillStyle=grad;g.fillRect(0,0,1200,1600);g.fillStyle='white';g.fillRect(350,150,100,900);g.beginPath();g.arc(800,800,200,0,Math.PI*2);g.fill();
 createRoot(document.getElementById('root')!).render(<ImageEditor imageSrc={c.toDataURL()} lutList={[{id:'none',name:'原始',url:''}]} onSave={()=>{}} onCancel={()=>{}}/>);
}else createRoot(document.getElementById('root')!).render(<ArtStudio onClose={()=>{}}/>);

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
