import React from 'react';import {createRoot} from 'react-dom/client';import {GridLayoutTool} from '../components/GridLayoutTool';
const p=new URLSearchParams(location.search);const inK=p.get('in')||'none',idle=p.get('idle')||'none';
const kinds=['line','star','heart','wave','grid-h','stitch-x'];
const fl=kinds.map((k,i)=>({id:'s'+i,src:'',x:20+(i%2)*140,y:30+Math.floor(i/2)*120,width:k==='line'||k==='wave'||k==='stitch-x'?110:80,height:k==='line'?18:k==='wave'||k==='stitch-x'?16:80,scale:1,rotation:0,opacity:100,shape:k,shapeFilled:k==='star',color:'#DCE7DB',shapeLineW:6,shapeGlow:300,shapeGlowColor:'#ffff00',mo:{delay:0,dur:Number(p.get('dur')||3),in:inK,idle,amp:50,speed:1}}));
createRoot(document.getElementById('root')!).render(<GridLayoutTool onHome={()=>{}} initialState={{coordinateVersion:2,pageWidth:300,selectedRatio:'3:4',pages:[{id:'p1',bgColor:'#c03030',layouts:[]}],floatingImages:fl} as any}/>);
