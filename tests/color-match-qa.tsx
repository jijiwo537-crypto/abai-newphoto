import React from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {ColorMatchStudio} from '../components/ColorMatchStudio';
import {loadDraft,clearDraft} from '../utils/toolDraft';
const photo=(color:string)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="${color}"/><rect x="80" y="110" width="240" height="390" fill="#b89473"/><circle cx="210" cy="280" r="70" fill="white"/></svg>`);
const original=photo('#54788c'),replacement=photo('#ac887a'),reference=photo('#b5929c');
const query=new URLSearchParams(location.search);
let choice:'save'|'discard'|'cancel'='cancel',promptCount=0,left=false;
function Fixture(){
 const [src,setSrc]=React.useState(original),[ref,setRef]=React.useState<string|null>(null);
 return <><ColorMatchStudio imageSrc={src} referenceSrc={ref} referenceLoading={query.has('loading')} onCancel={()=>{left=true;}} onHome={()=>{left=true;}} onPickReference={()=>setRef(reference)} onImportNew={()=>setSrc(replacement)} onRequestExit={async()=>{promptCount++;return choice;}}/>
 <button id="qa-change-reference" style={{position:'fixed',top:0,left:0,zIndex:99999}} onClick={()=>setRef(photo('#89a35e'))}>更換參考圖</button></>;
}
const root=createRoot(document.getElementById('root')!);
if(query.has('app'))void import('../App').then(({default:App})=>root.render(<App/>));
else root.render(<Fixture/>);
if(query.has('audit')&&!query.has('app'))void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const until=async(test:()=>boolean)=>{for(let i=0;i<600;i++){if(test())return;await wait();}throw Error('Timed out waiting for render');};
 const checks:any[]=[],check=(name:string,pass:boolean,detail?:any)=>checks.push({name,pass,detail});
 const button=(text:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.includes(text))!;
 try{
  await until(()=>!!document.querySelector('[data-color-match-stage] img'));await wait(10);
  const stage=document.querySelector<HTMLElement>('[data-color-match-stage]')!,zoom=document.querySelector<HTMLElement>('[data-color-match-zoom]')!;
  stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-1,clientX:200,clientY:240}));await wait(8);
  const pose=zoom.style.transform,frames:any[]=[];let watching=true;
  const capture=async()=>{while(watching){frames.push(Array.from(zoom.children).some(n=>!n.classList.contains('hidden')&&n.getBoundingClientRect().width>0));await wait();}};void capture();
  button('導入參考圖片').click();await until(()=>!!document.querySelector('[data-cm-method="mkl"]')?.getAttribute('aria-pressed')&& !document.querySelector('button[data-cm-method]')?.closest('[aria-label="仿色方法"]')?.classList.contains('opacity-30'));await wait(15);watching=false;
  check('reference import keeps original framing',zoom.style.transform===pose,{before:pose,after:zoom.style.transform});
  check('reference upload never blanks the preview',frames.length>0&&frames.every(Boolean),{frames:frames.length});
  check('reference analysis does not darken the full image',!stage.querySelector('.inset-0.bg-black\\/45'));
  const gpu=Array.from(zoom.querySelectorAll('canvas')).find(c=>!c.classList.contains('hidden'))!;
  check('GPU presents a rendered non-empty canvas',!!gpu&&gpu.width===480&&gpu.height===640);
  check('strength maximum is 150',document.querySelector<HTMLInputElement>('[data-cm-slider="強度"]')?.max==='150');
  const referenceBefore=Array.from(document.querySelectorAll<HTMLImageElement>('section img')).map(i=>i.src).find(s=>s===reference);
  button('替換原始圖片').click();await wait(40);
  check('replacing original keeps the reference',!!referenceBefore&&Array.from(document.querySelectorAll<HTMLImageElement>('section img')).some(i=>i.src===reference));
  const back=document.querySelector<HTMLButtonElement>('header button')!;
  choice='cancel';back.click();await wait(4);check('back prompts when a reference exists',promptCount===1&&!left);
  choice='save';back.click();await until(()=>left);const draft=await loadDraft();
  check('saved draft restores both images and parameters',draft?.tool==='match'&&!!draft.src&&!!draft.state.referenceSrc&&draft.state.strength===100);
  if(draft){const blob=await(await fetch(draft.state.referenceSrc)).blob();check('reference draft is persisted, not an expired URL',blob.size>0);URL.revokeObjectURL(draft.src);URL.revokeObjectURL(draft.state.referenceSrc);}
  await clearDraft();
 }catch(e){check('runtime exception',false,String(e));}
 const report={kind:'color-match-reference-draft',ua:navigator.userAgent,pass:checks.every(c=>c.pass),checks};
 const pre=document.createElement('pre');pre.id='match-result';pre.dataset.report=JSON.stringify(report);pre.style.cssText='position:fixed;top:70px;left:8px;z-index:999999;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
