import {copySeamPreviewPixels} from '../utils/seamlessPreview';
import {get2dWide} from '../utils/colorSpace';
void(async()=>{
 const params=new URLSearchParams(location.search),count=params.has('three')?3:4;
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));const wait=async(n=3)=>{for(let i=0;i<n;i++)await tick();};
 const report:any={kind:'creative-swap-stress-v35',route:location.search,ua:navigator.userAgent,checks:[],samples:[]},errors:string[]=[];
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount===String(count)&&document.querySelectorAll('[data-photo-cell]').length===count)break;await tick();}await wait(60);
  if(!stage||document.querySelectorAll('[data-photo-cell]').length!==count)throw Error(`Expected ${count} visible cells`);const canvas=stage.querySelector('canvas')!;
  const pointer=(type:string,p:{x:number;y:number},id:number)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
  const point=(index:number)=>{const r=document.querySelector(`[data-photo-cell="${index}"]`)!.getBoundingClientRect();return {x:r.x+r.width*.2,y:r.y+r.height*.2};};
  const brightness=(p:{x:number;y:number})=>{const box=canvas.getBoundingClientRect(),sample=document.createElement('canvas');sample.width=sample.height=8;const g=sample.getContext('2d')!;
   const gpu=canvas.parentElement!.querySelector<HTMLCanvasElement>('[data-creative-seam-presentation]');
   if(gpu&&gpu.style.display==='block'){
    const copy=document.createElement('canvas');copy.width=gpu.width;copy.height=gpu.height;copySeamPreviewPixels(gpu,get2dWide(copy)!);
    const bounds=gpu.getBoundingClientRect();
    g.drawImage(copy,(p.x-bounds.x)/bounds.width*copy.width-4,(p.y-bounds.y)/bounds.height*copy.height-4,8,8,0,0,8,8);copy.width=copy.height=1;
   }
   g.drawImage(canvas,(p.x-box.x)/box.width*canvas.width-4,(p.y-box.y)/box.height*canvas.height-4,8,8,0,0,8,8);
   const px=g.getImageData(0,0,8,8).data;let sum=0;for(let i=0;i<px.length;i+=4)sum+=px[i]+px[i+1]+px[i+2];return sum/(64*3);};
  pointer('pointerdown',point(0),3590);pointer('pointerup',point(0),3590);await wait();
  document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(30);
  if(params.has('zeroEffects')){
   [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith('濾鏡'))!.click();await wait(60);
   document.querySelector<HTMLButtonElement>('[data-lut-card]')!.click();await wait(30);
   const input=document.querySelector<HTMLInputElement>('input[type=range]')!;
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));await wait(10);
  }
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith('特效'))!.click();await wait(20);
  document.querySelector<HTMLButtonElement>('[data-fx-card="fxLowfi"]')!.click();await wait(30);
  if(params.has('zeroEffects')){
   const input=document.querySelector<HTMLInputElement>('input[type=range]')!;
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));await wait(10);
  }
  document.querySelector<HTMLButtonElement>('[data-creative-tab="setting"]')!.click();await wait(10);
  for(let round=0;round<18;round++){
   const from=round%count,to=(round+1)%count,p=point(from),q=point(to),before=JSON.parse(stage.dataset.photoTransforms!),light=brightness(q);
   // A tap first clears any previous selected crop; the long hold owns swapping.
   pointer('pointerdown',p,3591);pointer('pointerup',p,3591);await wait();
   pointer('pointerdown',p,3600+round);await new Promise(r=>setTimeout(r,350));await wait(2);
   check('thumbnail visible '+round,!!document.querySelector('[data-creative-swap-thumbnail]'));
   const times:number[]=[];for(let i=1;i<=8;i++){const t=performance.now();pointer('pointermove',{x:p.x+(q.x-p.x)*i/8,y:p.y+(q.y-p.y)*i/8},3600+round);await tick();times.push(performance.now()-t);}
   await tick();check('hover photograph darkens '+round,brightness(q)<light*.6,{before:light,during:brightness(q)});
   const releaseStart=performance.now();pointer('pointerup',q,3600+round);await tick();
   const releaseMs=performance.now()-releaseStart;
   const immediate=JSON.parse(stage.dataset.photoTransforms!);
   check('exchange visible on first frame '+round,immediate[from].src===before[to].src&&immediate[to].src===before[from].src);
   const firstPixels=brightness(q);
   await wait(4);
   const settledPixels=brightness(q);
   // Cells can be differently clipped by the page, so source/target screen
   // samples do not share UVs. Compare the first presented target to its
   // settled target instead, and require it to change from the original.
   check('exchanged photograph pixels visible on first frame '+round,Math.abs(firstPixels-settledPixels)<4&&Math.abs(firstPixels-light)>1,{before:light,first:firstPixels,settled:settledPixels});
   const after=JSON.parse(stage.dataset.photoTransforms!);check('exchange keeps all sources '+round,after.length===count&&new Set(after.map((p:any)=>p.src)).size===count);
   check('exchange changes target sources '+round,after[from].src===before[to].src&&after[to].src===before[from].src);
   check('thumbnail released '+round,!document.querySelector('[data-creative-swap-thumbnail]'));
   check('release presents without a long stall '+round,releaseMs<80,{from,to,releaseMs});
   report.samples.push({round,from,to,releaseMs,mean:times.reduce((a,b)=>a+b)/times.length,max:Math.max(...times)});
  }
  check('no runtime errors',!errors.length,errors);report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const result=document.createElement('pre');result.hidden=true;result.id='swap-stress-result';result.dataset.report=JSON.stringify(report);document.body.append(result);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
