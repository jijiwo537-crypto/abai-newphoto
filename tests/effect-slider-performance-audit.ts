import {FX_DEFS} from '../utils/glEffects';

export async function auditEffectSliders(){
 const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const wait=async(n=3)=>{for(let i=0;i<n;i++)await frame();};
 const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label||b.getAttribute('aria-label')===label);
 while(![...document.querySelectorAll('button')].some(b=>b.textContent?.includes('特效')))await frame();
 await wait(30);[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('特效'))!.click();await wait();
 const results:any[]=[],set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
 const sample=()=>{const gpu=document.querySelector<HTMLCanvasElement>('canvas[aria-hidden=true]')!,c=getComputedStyle(gpu).visibility==='visible'?gpu:gpu.previousElementSibling as HTMLCanvasElement,small=document.createElement('canvas');small.width=120;small.height=160;const ctx=small.getContext('2d')!;ctx.drawImage(c,0,0,120,160);return ctx.getImageData(0,0,120,160).data;};
 const update=(el:HTMLInputElement,v:number)=>{set.call(el,String(v));el.dispatchEvent(new Event('input',{bubbles:true}));};
 const legacy=[{id:'halation',params:['fringeIntensity','fringeFeather','fringeSize','fringeHue']},{id:'softLight',params:['soft','softThreshold','softRadius','softColor']},{id:'lightLeak',params:['leakOpacity','leakAngle','leakHue']}];
 for(const fx of [...legacy,...FX_DEFS.map(d=>({id:d.id,params:d.params.filter(p=>!p.hidden).map(p=>p.id)}))]){
  const card=document.querySelector<HTMLElement>(`[data-fx-tool="${fx.id}"]`);if(!card)continue;
  card.click();await wait(3);const detail=card.querySelector<HTMLElement>('[aria-label="調整細項"]');if(!detail)continue;detail.click();await wait(3);
  for(const key of fx.params){
   const tool=document.querySelector<HTMLButtonElement>(`[data-fx-param="${key}"]`)||[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.querySelector('span')?.textContent===key);if(!tool)continue;
   tool.click();await wait(4);const el=document.querySelector<HTMLInputElement>('input[type=range]')!,c=document.querySelector<HTMLCanvasElement>('canvas[aria-hidden=true]')!,size=[c.width,c.height],samples:number[]=[];
   el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:91,pointerType:'touch'}));let previous=performance.now();
   for(let i=0;i<30;i++){await frame();const now=performance.now();if(i>5)samples.push(now-previous);previous=now;update(el,Math.round(+el.min+(+el.max-+el.min)*(.5+.3*Math.sin(i*.25))));}
   await wait(3);const during=sample(),last=+el.value;el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:91,pointerType:'touch'}));await wait(3);
   const after=sample();let releaseDelta=0;for(let i=0;i<after.length;i++)releaseDelta=Math.max(releaseDelta,Math.abs(after[i]-during[i]));
   samples.sort((a,b)=>a-b);results.push({effect:fx.id,key,p50:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],size,finalSize:[c.width,c.height],sameOnRelease:releaseDelta===0,releaseDelta,last});
   void fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'slider-progress',ua:navigator.userAgent,result:results.at(-1)})}).catch(()=>{});
  }
  const back=button('返回特效')||[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='arrow_back');back!.click();await wait(3);
 }
 const report={kind:'effect-slider-performance',ua:navigator.userAgent,results};
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 const pre=document.createElement('pre');pre.textContent=JSON.stringify(report,null,2);pre.style.cssText='position:fixed;inset:90px 8px 10px;overflow:auto;background:#111;color:white;font-size:10px;z-index:99999';document.body.append(pre);
}
