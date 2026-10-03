import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {CollageTool} from '../components/CollageTool';
const q=new URLSearchParams(location.search);
const photo=(color:string)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${color}"/><circle cx="300" cy="400" r="100" fill="white"/></svg>`);
const src=photo('#54788c'),src2=photo('#bc9080');
const file=new File([decodeURIComponent(src.split(',')[1])],'qa.svg',{type:'image/svg+xml'});
const file2=new File([decodeURIComponent(src2.split(',')[1])],'qa2.svg',{type:'image/svg+xml'});
const creative={holeCount:0,canvasRatio:'1:1',objects:[
 {id:'test-shape',type:'shape',kind:'star',filled:true,color:'#FFFFFF',tex:'dot',dotColor:'#ff00ff',dotSize:90,dotGap:20,textureBaseW:110,textureBaseH:110,x:35,y:50,w:110,h:110,rot:0,opacity:100},
 {id:'test-text',type:'text',text:'ABAI',size:48,x:175,y:100,w:150,h:55,rot:0,color:'#FFFFFF',opacity:100},
 {id:'test-symbol',type:'text',text:'✦',sym:true,size:80,x:400,y:300,w:80,h:80,rot:0,color:'#FFFFFF',opacity:100},
 {id:'test-photo',type:'image',src,origSrc:src,x:360,y:450,w:80,h:105,rot:0,opacity:100},
]};
createRoot(document.getElementById('root')!).render(<CollageTool initialFile={file} initialExtras={Array.from({length:q.has('single')?0:q.has('nine')?8:1},()=>file2)} initialState={creative} onHome={()=>{}} onImportNew={()=>{}}/>);
void import('./selected-workspace-audit');
