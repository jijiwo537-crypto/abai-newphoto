import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {CollageTool} from '../components/CollageTool';
const file=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#567890"/></svg>'],'qa.svg',{type:'image/svg+xml'});
const holes=Array.from({length:80},(_,i)=>({id:`qa-${i}`,x:35+(i%8)*70,y:35+Math.floor(i/8)*75,localScale:1,side:'both'}));
const state={layout:'mask-right',maskScale:.5,holeType:'star',holeSize:32,sizeJitter:0,holeAngle:0,holeCount:80,maskColor:'#d4eee5',glowMode:'image',holeGlowColor:'#fff',holes,moShape:{in:'none',idle:'none',speed:1,amp:100}};
async function benchmark(){
 const input=document.querySelector<HTMLInputElement>('input[type=range]'); if(!input)return;
 const frames:number[]=[];let previous=performance.now();
 for(let n=0;n<180;n++){
  await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;
  input.value=String(Number(input.min)+(Number(input.max)-Number(input.min))*(.35+.2*Math.sin(n/14)));
  input.dispatchEvent(new Event('input',{bubbles:true}));
 }
 frames.sort((a,b)=>a-b);const out=document.querySelector('output')!;
 out.textContent=`80 patterns: median ${frames[90].toFixed(1)} ms, p95 ${frames[171].toFixed(1)} ms, worst ${frames[179].toFixed(1)} ms`;
}
function zoom(){const c=document.querySelector('canvas')!;const r=c.getBoundingClientRect();for(let i=0;i<4;i++)setTimeout(()=>c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:r.left+r.width/2,clientY:r.top+r.height/2})),i*120);}
createRoot(document.getElementById('root')!).render(<><CollageTool initialFile={file} initialState={state} onHome={()=>{}} onImportNew={()=>{}}/><div style={{position:'fixed',left:0,top:55,zIndex:999999,background:'#222',color:'#fff',fontSize:10}}><button onClick={benchmark}>Measure current slider</button> <button onClick={zoom}>Zoom preview</button><output/></div></>);
