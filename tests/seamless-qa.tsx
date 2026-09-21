import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {GridLayoutTool} from '../components/GridLayoutTool';
import {renderSeamlessLayout} from '../utils/seamlessLayout';
const photo=(color:string)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${color}"/><circle cx="300" cy="240" r="95" fill="#fff"/><path d="M0 800L300 380L600 800" fill="#333"/></svg>`);
const cells=['#ff4030','#2080ee','#50ce80'].map((color,i)=>({id:`seam-photo-${i}`,url:photo(color),zoom:1,offsetX:0,offsetY:0,rotation:0,naturalWidth:600,naturalHeight:800}));
const state={coordinateVersion:2,pageWidth:309,selectedRatio:'3:4',isLandscape:false,floatingImages:[],pages:[{id:'seam-page',bgColor:'#ff00ff',layouts:[{id:'seam-layout',images:cells.slice(0,2),templateIndex:1,t:{x:0,y:0,scale:.9},gap:8,radius:4,z:0,seamless:true,seamlessAmount:70}]}]};
async function verify(){
 const sets=[[{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}], [{x:0,y:0,w:1,h:.5},{x:0,y:.5,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}]];
 const report=[];
 for(const rects of sets) for(const strength of [0,50,100]) for(const size of [192,768]) {
  const frame=await renderSeamlessLayout(cells.slice(0,rects.length),rects,size,size,strength);
  const data=frame.getContext('2d')!.getImageData(0,0,size,size).data;
  let holes=0; for(let i=3;i<data.length;i+=4) if(data[i]!==255)holes++;
  report.push(`${rects.length} photos / ${strength} / ${size}px: ${holes===0?'PASS opaque':'FAIL '+holes}`);
 }
 const panel=document.createElement('div');panel.style.cssText='position:fixed;inset:0;z-index:9999999;background:#151515;color:white;overflow:auto;padding:20px';
 const close=document.createElement('button');close.textContent='Close QA';close.onclick=()=>panel.remove();panel.append(close);
 const pre=document.createElement('pre');pre.textContent=report.join('\n');panel.append(pre);
 for(const strength of [0,50,100]){const c=await renderSeamlessLayout(cells.slice(0,2),sets[0],600,400,strength);c.style.cssText='width:30%;margin:1%;';panel.append(c)}
 document.body.append(panel);
}
createRoot(document.getElementById('root')!).render(<><GridLayoutTool initialState={state} onHome={()=>{}}/><button style={{position:'fixed',top:0,left:0,zIndex:999999,background:'#333',color:'white'}} onClick={verify}>Verify seamless pixels</button></>);
