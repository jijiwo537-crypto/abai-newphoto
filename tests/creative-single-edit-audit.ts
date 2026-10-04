import {copySceneColourPixels} from '../utils/photoSceneColour';
void(async()=>{
 const checks:any[]=[],check=(name:string,pass:boolean,detail?:any)=>checks.push({name,pass,detail});
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 try{
  let stage:HTMLElement;for(let i=0;i<400;i++){stage=document.querySelector('[data-creative-stage]')!;if(stage?.dataset.sceneGeometry)break;await wait(1);}await wait(12);
  if(new URLSearchParams(location.search).has('busyEdit')){
   document.querySelector<HTMLButtonElement>('[data-creative-tab="shape"]')?.click();await wait(4);
   document.querySelector<HTMLButtonElement>('button[aria-label="參數"]')!.click();await wait(4);
   const link=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.title==='圖案之間的連線：實線')!;
   check('stress fixture enables links on 30 glowing patterns',!!link&&!link.disabled);
   link.click();await wait(4);
  }
  const canvas=stage!.querySelector('canvas')!,o=JSON.parse(stage!.dataset.sceneGeometry!),r=canvas.getBoundingClientRect();
  const x=r.left+(o.ix+o.iw*.2)/o.cw*r.width,y=r.top+(o.iy+o.ih*.2)/o.ch*r.height;
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2441,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerdown'?1:0}));
  await wait(8);document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(8);
  const btn=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(name));
  check('single base opens image editor',!!btn('濾鏡')&&!!btn('調節')&&!!btn('構圖'));
  check('base editor omits shape',!btn('造型'));btn('調節')!.click();await wait();btn('亮度')!.click();await wait();
  const input=Array.from(document.querySelectorAll<HTMLInputElement>('input[type=range]')).find(el=>el.min==='-100')!;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  const hold=(el:HTMLInputElement,type:string)=>{const box=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2551,pointerType:'touch',clientX:box.left+box.width/2,clientY:box.top+box.height/2,buttons:type==='pointerdown'?1:0}));};
  const pixel=()=>{
   const visible=stage!.querySelector<HTMLCanvasElement>('[data-base-colour-presentation]');
   let source=canvas;
   if(visible&&visible.style.display!=='none'){source=document.createElement('canvas');source.width=canvas.width;source.height=canvas.height;copySceneColourPixels(visible,source.getContext('2d',{colorSpace:canvas.getContext('2d')!.getContextAttributes().colorSpace})!);}
   return Array.from(source.getContext('2d')!.getImageData(Math.round((o.ix+o.iw*.1)*canvas.width/o.cw),Math.round((o.iy+o.ih*.1)*canvas.height/o.ch),1,1).data);
  };
  if(new URLSearchParams(location.search).has('blendAudit')){const start=performance.now();while(canvas.dataset.regionBlendReady!=='true'&&performance.now()-start<10000)await wait(2);}
  await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'base-edit-preflight',route:location.search,ua:navigator.userAgent,canvas:[canvas.width,canvas.height],fxSize:canvas.dataset.regionFxSize,ready:canvas.dataset.regionBlendReady})}).catch(()=>{});
  const before=pixel(),times:number[]=[],sizes:string[]=[];
  hold(input,'pointerdown');
  for(let v=1;v<=20;v++){const t=performance.now();setter.call(input,String(v));input.dispatchEvent(new Event('input',{bubbles:true}));await wait(1);times.push(performance.now()-t);sizes.push(canvas.dataset.regionFxSize||'');}
  const liveBrightness={fxMs:canvas.dataset.regionFxMs,paintMs:canvas.dataset.paintMs,backend:canvas.dataset.regionFxBackend};
  const dragPixel=pixel();hold(input,'pointerup');
  check('release color delta measured',true,{drag:dragPixel,release:pixel(),maxDelta:Math.max(...pixel().slice(0,3).map((v,i)=>Math.abs(v-dragPixel[i])))});
  check('single base adjustment updates throughout drag',pixel()[1]>before[1],{before,after:pixel()});
  check('single base slider retains latest value',input.value==='20');
  await wait(20);
  const fixedSize=sizes[0],dimensions=JSON.parse(fixedSize);
  check('drag and settled processing keep identical full preview resolution',sizes.every(s=>s===fixedSize)&&canvas.dataset.regionFxSize===fixedSize&&Math.max(...dimensions)>=1600,{sizes:[...new Set(sizes)],settled:canvas.dataset.regionFxSize});
  check('full quality drag timing collected',times.every(Number.isFinite),{meanFrame:times.reduce((a,b)=>a+b)/times.length,maxFrame:Math.max(...times),...liveBrightness});
  for(const name of ['曝光','對比','高光','陰影','色溫','色調','飽和度','自然飽和度']){
   btn(name)!.click();await wait(4);
   if(new URLSearchParams(location.search).has('blendAudit')){const start=performance.now();while(canvas.dataset.regionBlendReady!=='true'&&performance.now()-start<10000)await wait(2);}
   const slider=Array.from(document.querySelectorAll<HTMLInputElement>('input[type=range]')).find(el=>el.min==='-100')!;
   const ms:number[]=[],latency:number[]=[],sameEvent:boolean[]=[];const painted=Number(canvas.dataset.paintCount),colourStart=performance.now();
   // Do not read GPU pixels between animation frames: getImageData forces a
   // synchronous GPU readback and measures the test's own stall, not tuning.
   hold(slider,'pointerdown');
   for(let v=1;v<=30;v++){const t=performance.now(),count=canvas.dataset.paintCount;setter.call(slider,String(v));slider.dispatchEvent(new Event('input',{bubbles:true}));latency.push(performance.now()-t);sameEvent.push(canvas.dataset.paintCount!==count);await wait(1);ms.push(performance.now()-t);}
   const liveMetrics={fxMs:canvas.dataset.regionFxMs,paintMs:canvas.dataset.paintMs,backend:canvas.dataset.regionFxBackend};
   hold(slider,'pointerup');
   await wait(4);
   const visible=stage!.querySelector<HTMLCanvasElement>('[data-base-colour-presentation]');
   const colourTimes:number[]=JSON.parse(visible?.dataset.colourFrameTimes||'[]').filter((t:number)=>t>=colourStart),colourIntervals=colourTimes.slice(1).map((t,i)=>t-colourTimes[i]);
   check(`${name} live update and final value`,slider.value==='30'&&Number(canvas.dataset.paintCount)>painted,{meanFrame:ms.reduce((a,b)=>a+b)/ms.length,maxFrame:Math.max(...ms),meanInputMs:latency.reduce((a,b)=>a+b)/latency.length,sameEvent:sameEvent.filter(Boolean).length,inputs:sameEvent.length,colourFrames:colourTimes.length,meanColourFrame:colourIntervals.length?colourIntervals.reduce((a,b)=>a+b)/colourIntervals.length:null,maxColourFrame:colourIntervals.length?Math.max(...colourIntervals):null,...liveMetrics});
  }
 }catch(e){check('exception',false,String(e));}
 const idleTimes:number[]=[];for(let i=0;i<10;i++){const t=performance.now();await wait(2);idleTimes.push(performance.now()-t);}
 const report={kind:'creative-single-edit',route:location.search,ua:navigator.userAgent,visibility:document.visibilityState,idleTwoFrames:idleTimes.reduce((a,b)=>a+b)/idleTimes.length,pass:checks.every(c=>c.pass),checks};
 const pre=document.createElement('pre');pre.id='single-edit-result';pre.dataset.report=JSON.stringify(report);pre.style.display='none';document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
