import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {GridLayoutTool} from '../components/GridLayoutTool';
import {installSliderTouch} from '../utils/sliderTouch';
installSliderTouch();
import {renderSeamlessLayout} from '../utils/seamlessLayout';
import {SeamlessLayout} from '../components/SeamlessLayout';
const photo=(color:string)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${new URLSearchParams(location.search).has('flat')?'#333':color}"/>${new URLSearchParams(location.search).has('flat')?'':'<circle cx="300" cy="240" r="95" fill="#fff"/><path d="M0 800L300 380L600 800" fill="#333"/>'}</svg>`);
const params=new URLSearchParams(location.search);
const cells=['#ff4030','#2080ee','#50ce80'].map((color,i)=>({id:`seam-photo-${i}`,url:params.has('large')?photo(color).replace('width%3D%22600%22%20height%3D%22800%22','width%3D%222400%22%20height%3D%223200%22%20viewBox%3D%220%200%20600%20800%22'):photo(color),zoom:params.has('transformed')?1.6:1,offsetX:params.has('transformed')?.23:0,offsetY:params.has('transformed')?-.17:0,rotation:params.has('transformed')?i*23:0,naturalWidth:params.has('large')?2400:600,naturalHeight:params.has('large')?3200:800,...(params.has('cellFx')?{fx:{soft:40,exposure:10}}:{})}));
if(params.has('layoutRasterAudit')){
 cells.forEach((cell,i)=>{const cv=document.createElement('canvas');cv.width=1200;cv.height=1600;const g=cv.getContext('2d')!;g.fillStyle=['#ba4c38','#3870ba','#389e70'][i];g.fillRect(0,0,1200,1600);g.strokeStyle='#fff';g.lineWidth=2;for(let x=0;x<1200;x+=12){g.beginPath();g.moveTo(x,0);g.lineTo(x,1600);g.stroke();}g.fillStyle='black';g.font='64px sans-serif';g.fillText('ABAI 012345',250,500);cell.url=cv.toDataURL();cell.naturalWidth=1200;cell.naturalHeight=1600;cv.width=cv.height=1;});
 void import('./layout-raster-zoom-audit');
}
const zoomCells=cells.slice(0,2),zoomRects=[{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}];
const state={coordinateVersion:2,pageWidth:309,selectedRatio:'3:4',isLandscape:false,floatingImages:[],pages:[{id:'seam-page',bgColor:'#ff00ff',layouts:[{id:'seam-layout',images:cells.slice(0,params.has('junction')?3:2),templateIndex:params.has('junction')?0:1,t:{x:0,y:0,scale:.9},gap:8,radius:4,z:0,seamless:!params.has('off'),seamlessAmount:70}]}]};
if(params.has('textureZoom')){
 const raster=document.createElement('canvas');raster.width=1200;raster.height=1600;const c=raster.getContext('2d')!;c.fillStyle='#728791';c.fillRect(0,0,1200,1600);c.fillStyle='#eee';for(let y=0;y<1600;y+=16)for(let x=0;x<1200;x+=16)if((x+y)%32===0)c.fillRect(x,y,8,8);
 Object.assign(state,{floatingImages:[{id:'photo-texture',src:params.has('raster')?raster.toDataURL():photo('#728791'),x:params.has('cross')?-40:40,y:40,width:params.has('cross')?480:229,height:320,scale:1,rotation:0,opacity:100}]});
 Object.assign(state.pages[0],{layouts:[],pattern:{type:params.get('texture')||'dot',size:80,gap:0,color:'#FFFFFF',squash:50}});
 if(params.has('multi'))state.pages.push({...state.pages[0],id:'seam-page-2',layouts:[]});
 if(!params.has('modeAudit'))void import('./texture-zoom-audit');
}
// 遮罩圖形（測拖曳流暢度）：?mask=mask-frost&maskCount=2
if(params.get('mask')){const kind=params.get('mask')!,n=Number(params.get('maskCount')||1);(state as any).floatingImages=Array.from({length:n},(_,i)=>({id:`qa-mask-${i}`,src:'',x:30+i*90,y:60+i*70,width:150,height:150,scale:1,rotation:0,opacity:100,shape:kind,shapeFilled:true,maskShape:'square',maskAmount:kind.includes('frost')?50:100,maskCells:kind==='mask-mosaic'?15:20,maskRefract:100,maskFeather:0}));}
// 一張浮動照片（測動畫、選取框）：?floatPhoto
if(params.has('floatPhoto'))(state as any).floatingImages=[{id:'photo-float',src:photo('#728791'),x:40,y:40,width:150,height:200,scale:1,rotation:15,opacity:100}];
// 影片圖層（測縮圖、匯出）：?video=網址
if(params.get('video'))(state as any).floatingImages=[{id:'qa-video',src:params.get('video'),isVideo:true,x:30,y:20,width:240,height:135,scale:1,rotation:0,opacity:100}];
if(params.has('modeAudit'))void import('./classic-mode-audit');
if(params.has('empty')){
 const layout=state.pages[0].layouts[0];layout.images.forEach(c=>{c.url='';});
 layout.t.scale=1;layout.gap=0;layout.radius=0;layout.seamless=false;
}
if(params.has('emptyAudit'))void import('./empty-layout-audit');
if(params.has('layoutRasterAudit')){state.pages[0].layouts[0].gap=0;state.pages[0].layouts[0].radius=0;}
if(params.has('cellEditAudit')){state.pages[0].layouts[0].gap=0;state.pages[0].layouts[0].radius=0;void import('./layout-photo-edit-audit');}
if(params.has('exportAudit'))void import('./collage-export-audit');
if(params.has('chromeAudit'))void import('./collage-chrome-audit');
if(new URLSearchParams(location.search).has('slowAudit'))void import('./seamless-slow-audit');
if(new URLSearchParams(location.search).has('fusionAudit'))void import('./seamless-fusion-audit');
if(params.has('panelAudit'))void import('./layout-panel-audit');
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
function ZoomAudit(){
 const [scale,setScale]=React.useState(1),[result,setResult]=React.useState('正在逐幀檢查');
 React.useEffect(()=>{let stopped=false;void(async()=>{
  const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
  while(!document.querySelector('svg[data-seamless-master][data-ready="true"]')){if(stopped)return;await frame();}
  const canvas=document.querySelector('canvas[data-seamless-layout]') as HTMLCanvasElement;
  const initial={uploads:Number(canvas.dataset.sourceUploads)},samples:any[]=[];
  for(let i=0;i<120;i++){if(stopped)return;setScale(.35+1.65*(.5-.5*Math.cos(i*Math.PI/30)));await frame();
   const rect=canvas.getBoundingClientRect();samples.push({w:canvas.width,h:canvas.height,cssW:rect.width,cssH:rect.height});}
  setScale(1);await frame();
  const report={kind:'seamless-zoom-master',ua:navigator.userAgent,pass:Number(canvas.dataset.sourceUploads)===initial.uploads&&samples.every(s=>s.w/s.cssW>=devicePixelRatio-.01),frames:samples.length,initial,finalUploads:Number(canvas.dataset.sourceUploads),cssMin:Math.min(...samples.map(s=>s.cssW)),cssMax:Math.max(...samples.map(s=>s.cssW))};
  setResult(JSON.stringify(report,null,2));await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 })();return()=>{stopped=true;};},[]);
 return <div style={{height:'100dvh',background:'#080808',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}><div data-seamless="true" style={{position:'relative',width:240*scale,height:320*scale,flexShrink:0}}><SeamlessLayout cells={zoomCells} rects={zoomRects} width={240*scale} height={320*scale} amount={70} revision={0}/></div><pre style={{position:'fixed',top:12,left:8,zIndex:99999,color:'white',fontSize:11,background:'#111d',maxWidth:'95vw'}}>{result}</pre></div>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('zoomAudit')?<ZoomAudit/>:<><GridLayoutTool initialState={state} onHome={()=>{}}/><button style={{position:'fixed',top:0,left:0,zIndex:999999,background:'#333',color:'white'}} onClick={verify}>Verify seamless pixels</button></>);
