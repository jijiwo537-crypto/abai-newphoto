import {applyGlEffects,presentFxSource,FX_DEFAULTS,disposeFxSurface} from '../utils/glEffects';
import {HalationLayer} from '../utils/halationLayer';
// Development-only: exercise the mounted editor and real GPU presentation path.
export async function auditEffectRegistration(){
 const frame=()=>new Promise<void>(r=>{let done=false;const finish=()=>{if(!done){done=true;r();}};requestAnimationFrame(finish);setTimeout(finish,40);});
 const wait=async(n=5)=>{for(let i=0;i<n;i++)await frame();};
 const checks:any[]=[];const check=(name:string,pass:boolean,detail?:any)=>checks.push({name,pass,detail});
 const click=(text:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.includes(text))?.click();
 while(!document.querySelector('canvas[aria-hidden=true]'))await frame();await wait(25);click('特效');await wait();
 const visible=()=>{const gpu=document.querySelector<HTMLCanvasElement>('canvas[aria-hidden=true]')!,base=gpu.previousElementSibling as HTMLCanvasElement;return getComputedStyle(gpu).visibility==='visible'?gpu:base;};
 const sample=()=>{const c=visible(),r=c.getBoundingClientRect(),copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;const g=copy.getContext('2d',{willReadFrequently:true})!;g.drawImage(c,0,0);return {rect:[r.x,r.y,r.width,r.height],w:c.width,h:c.height,pixels:g.getImageData(0,0,c.width,c.height).data};};
 const card=(id:string)=>document.querySelector<HTMLElement>(`[data-fx-tool=${id}]`)!;
 for(const [w,h] of [[601,799],[1200,1600]]){
  const src=document.createElement('canvas');src.width=w;src.height=h;
  const cx=src.getContext('2d',{willReadFrequently:true})!,pixels=cx.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;pixels.data[k]=x%2?230:20;pixels.data[k+1]=y%2?180:40;pixels.data[k+2]=(x*13+y*7)%256;pixels.data[k+3]=255;}cx.putImageData(pixels,0,0);
  const output=document.createElement('canvas');output.width=w;output.height=h;const oc=output.getContext('2d',{willReadFrequently:true})!;
  const compare=(canvas:HTMLCanvasElement|null)=>{if(!canvas)return -1;oc.drawImage(canvas,0,0);const data=oc.getImageData(0,0,w,h).data;let max=0;for(let i=0;i<data.length;i++)max=Math.max(max,Math.abs(data[i]-pixels.data[i]));return max;};
  const plain=document.createElement('canvas');const plainMax=presentFxSource(cx,w,h,plain)?compare(plain):-1;check('same-surface original one-pixel registration '+w,plainMax>=0&&plainMax<=2,{max:plainMax});disposeFxSurface(plain);
  for(const id of ['fxPearl','fxExposureSpill','fxLowfi']){const surface=document.createElement('canvas');const result=applyGlEffects(cx,w,h,{...FX_DEFAULTS,[id]:.00001},`registration-${w}x${h}`,surface);const max=compare(result);check(id+' GPU one-pixel registration '+w,max>=0&&max<=2,{max});disposeFxSurface(surface);}
  const surface=document.createElement('canvas'),layer=new HalationLayer(surface);
  const max=compare(layer.renderSoft(cx,w,h,'base',{soft:0,softRadius:100,softThreshold:80,softColor:0},[255,255,255]));check('legacy presentation one-pixel registration '+w,max>=0&&max<=2,{max});layer.dispose();
 }
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
 card('fxNone').click();await wait(15);const base=sample();
 const edge=(s:ReturnType<typeof sample>)=>{const y=Math.round(s.h*300/1600),expected=Math.round(s.w*350/1200);let best=expected,max=0;for(let x=expected-6;x<expected+6;x++){const d=Math.abs(s.pixels[(y*s.w+x)*4+1]-s.pixels[(y*s.w+x-1)*4+1]);if(d>max){max=d;best=x;}}return best;};
 for(const id of ['fxPearl','fxExposureSpill','fxLowfi','softLight','halation','lightLeak']){
  card(id).click();await wait(10);
  const active=sample();check(id+' active framing and image registration',active.rect.every((v,i)=>v===base.rect[i])&&edge(active)===edge(base),{edge:edge(active),baseline:edge(base),rect:active.rect});
  check(id+' retains the same presentation surface',visible()===document.querySelector('canvas[aria-hidden=true]'));
  const el=document.querySelector<HTMLInputElement>('input[type=range]')!;
  // Zero strength still takes the edited color-chain path, unlike fxNone.
  setter.call(el,'0');el.dispatchEvent(new Event('input',{bubbles:true}));await wait(10);
  const result=sample();let max=0,total=0;
  for(let i=0;i<base.pixels.length;i++){const d=Math.abs(base.pixels[i]-result.pixels[i]);max=Math.max(max,d);total+=d;}
  check(id+' zero-strength pixel registration',max<=2&&result.w===base.w&&result.h===base.h,{max,mean:total/base.pixels.length,rect:result.rect,baseRect:base.rect});
  check(id+' fixed preview bounds',result.rect.every((v,i)=>v===base.rect[i]));
 }
 card('fxPearl').click();await wait();card('fxPearl').querySelector<HTMLElement>('[aria-label="調整細項"]')!.click();await wait();
 document.querySelector<HTMLElement>('[data-fx-param=fxPearlFreq]')!.click();await wait();
 const pearl=document.querySelector<HTMLInputElement>('input[type=range]')!,values=[];
 for(let i=0;i<15;i++){setter.call(pearl,String(10+i*.1));pearl.dispatchEvent(new Event('input',{bubbles:true}));values.push(+pearl.value);await frame();}
 check('pearl accepts sub-unit values',new Set(values).size===15,{step:pearl.step,values});
 const baselineSize=[visible().width,visible().height];
 pearl.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:91,pointerType:'touch'}));
 const times:number[]=[];let previous=performance.now();
 for(let i=0;i<45;i++){await frame();const now=performance.now();if(i>10)times.push(now-previous);previous=now;setter.call(pearl,String(10+4*Math.sin(i*.06)));pearl.dispatchEvent(new Event('input',{bubbles:true}));}
 await wait();const during=sample();pearl.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:91,pointerType:'touch'}));await wait();const after=sample();
 let releaseDelta=0;for(let i=0;i<during.pixels.length;i++)releaseDelta=Math.max(releaseDelta,Math.abs(during.pixels[i]-after.pixels[i]));
 times.sort((a,b)=>a-b);check('pearl retains full resolution while sliding',baselineSize[0]===during.w&&baselineSize[1]===during.h&&after.w===during.w&&after.h===during.h,{size:baselineSize,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)]});
 check('pearl has no release-only image change',releaseDelta===0,{releaseDelta});
 const report={pass:checks.every(c=>c.pass),checks,ua:navigator.userAgent};
 void fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'effect-registration-v18',...report})}).catch(()=>{});
 const out=document.createElement('pre');out.id='effect-registration-report';out.dataset.report=JSON.stringify(report);out.style.cssText='position:fixed;top:80px;left:8px;max-height:200px;overflow:auto;z-index:99999;background:#111e;color:white;font-size:10px';out.textContent=`PASS ${report.pass}\n`+checks.map(c=>`${c.pass?'✓':'✕'} ${c.name} ${c.detail?JSON.stringify(c.detail):''}`).join('\n');if(new URLSearchParams(location.search).has('quiet'))out.hidden=true;document.body.append(out);
}
