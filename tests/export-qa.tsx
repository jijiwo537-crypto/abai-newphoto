import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import '../components/ArtStudio.css';
import {ExportActionLift} from '../components/ExportActionLift';

const kinds=['editor','creative','grid','beauty','match','art'];
const ratios=[[600,800],[1600,600],[500,2200]];
const isVideo=new URLSearchParams(location.search).has('video');
let videoFixture='';
const scenarios=isVideo?['creative','grid'].map(kind=>({kind,w:600,h:800})):kinds.flatMap(kind=>ratios.map(([w,h])=>({kind,w,h})));
const fixture=(w:number,h:number)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#557569"/><path d="M0 0L${w} ${h}M0 ${h}L${w} 0" stroke="white" stroke-width="12"/><text x="20" y="40" fill="white" font-size="28">TOP — KEEP FIXED</text></svg>`);
function Audit(){
 const [index,setIndex]=React.useState(0),[report,setReport]=React.useState<any>(null);
 const results=React.useRef<any[]>([]),s=scenarios[index];
 React.useEffect(()=>{let stop=false;void(async()=>{
  while(isVideo&&(document.querySelector('video')?.readyState||0)<1){if(stop)return;await new Promise<void>(r=>requestAnimationFrame(()=>r()));}
  for(let i=0;i<12;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));if(stop)return;
  const root=document.querySelector('[data-export-screen]') as HTMLElement;
  const geometry=JSON.parse(root.dataset.exportGeometry||'{}'),img=root.querySelector<HTMLImageElement|HTMLVideoElement>('img,video')!;
  const r=img.getBoundingClientRect();let clipped=false;
  for(let p=img.parentElement;p&&p!==root;p=p.parentElement){const css=getComputedStyle(p);if(['hidden','auto','scroll','clip'].includes(css.overflowY)){const pr=p.getBoundingClientRect();if(r.top<pr.top-.5||r.bottom>pr.bottom+.5)clipped=true;}}
  const rr=root.getBoundingClientRect();
  const pass=geometry.media?.length&&geometry.media.every((m:any,i:number)=>Math.abs(m.top-geometry.originalTops[i])<.5&&m.bottom<=geometry.actionTop-15.5)&&r.left>=rr.left-.5&&r.right<=rr.right+.5&&Math.abs(geometry.previousGap/2-geometry.buttonGap)<.5&&!clipped;
  results.current.push({...s,pass:!!pass,clipped,...geometry});
  if(index+1<scenarios.length)setIndex(index+1);else{const out={kind:'export-geometry',ua:navigator.userAgent,viewport:{w:innerWidth,h:innerHeight},pass:results.current.every(r=>r.pass),cases:results.current};setReport(out);await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(out)}).catch(()=>{});}
 })();return()=>{stop=true;};},[index]);
 const art=s.kind==='art',beauty=s.kind==='beauty',match=s.kind==='match',grid=s.kind==='grid';
 const actions=<><button className="h-12 rounded-full bg-white text-black text-sm font-bold">儲存圖片</button>{beauty&&<button className="h-12 rounded-full border border-white/20 text-white">接著調色</button>}<div className="flex gap-3"><button className={`${beauty||match?'h-12':'h-14'} flex-1 rounded-full border border-white/20 bg-white/5 text-white`}>繼續編輯</button><button className={`${beauty||match?'h-12':'h-14'} flex-1 rounded-full border border-white/20 bg-white/5 text-white`}>修下一張</button></div></>;
 const Preview=isVideo?'video':'img';
 const media=<div data-export-media className={art?'art-export-image':`relative shadow-2xl rounded overflow-hidden ${grid?'':beauty?'max-h-[52vh] max-w-full mb-4':match?'max-h-[62vh]':'max-h-[60vh] max-w-full mb-4'}`}><Preview autoPlay={isVideo} muted={isVideo} playsInline={isVideo} alt="匯出預覽" src={isVideo?videoFixture:fixture(s.w,s.h)} className={art?'':grid?'max-w-[80vw] max-h-[52vh] md:max-w-[38vh] object-contain':beauty?'max-w-full max-h-[52vh] object-contain':match?'max-w-full max-h-[62vh] object-contain':'max-w-[80vw] max-h-[60vh] object-contain'}/></div>;
 return <div style={{position:'relative',height:'100dvh',maxWidth:390,margin:'0 auto'}}><div key={index} data-export-screen className={art?'art-export':'absolute inset-0 bg-black flex flex-col'}><ExportActionLift/><header className="h-14 shrink-0 flex items-center px-5 text-white">‹</header>{art?media:grid?<div className="flex-1 flex flex-col items-center justify-center p-6 relative min-h-0"><div className="w-full flex-1 min-h-0 flex items-center"><div className="w-full flex flex-row gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory px-[max(0px,calc(50%-40vw))] md:flex-wrap md:justify-center md:overflow-visible md:px-0"><div className="shrink-0 snap-center flex flex-col items-center">{media}</div></div></div></div>:s.kind==='editor'?<div className="flex-1 flex flex-col items-center justify-center p-6 relative"><div className="w-full flex flex-row items-center gap-4 justify-center"><div className="shrink-0 snap-center flex flex-col items-center gap-2">{media}</div></div></div>:<div className="flex-1 flex flex-col items-center justify-center p-6 relative">{media}</div>}{art?<footer data-export-actions>{actions}</footer>:<div data-export-actions className={`flex flex-col gap-3 px-6 ${beauty||match?'pb-8':'pb-6 pt-2'}`}>{actions}</div>}</div>{report&&<pre id="export-audit-result" style={{position:'fixed',top:56,left:4,right:4,maxHeight:170,overflow:'auto',fontSize:9,color:'white',background:'#111e',zIndex:99999}}>{JSON.stringify(report,null,2)}</pre>}</div>;
}
async function start(){
 if(isVideo){
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
  const g=canvas.getContext('2d')!;g.fillStyle='#557569';g.fillRect(0,0,600,800);g.fillStyle='white';g.fillRect(0,0,600,30);
  const stream=canvas.captureStream(30),recorder=new MediaRecorder(stream);
  const chunks:Blob[]=[];recorder.ondataavailable=e=>chunks.push(e.data);
  const done=new Promise<void>(r=>{recorder.onstop=()=>r();});recorder.start();
  for(let i=0;i<12;i++){g.fillRect(20+i,100,80,80);await new Promise<void>(r=>requestAnimationFrame(()=>r()));}
  recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());videoFixture=URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType}));
 }
 createRoot(document.getElementById('root')!).render(<Audit/>);
}
void start().catch(error=>{document.body.textContent='VIDEO AUDIT ERROR: '+String(error);});
