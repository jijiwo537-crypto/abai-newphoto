void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n:number)=>{for(let i=0;i<n;i++)await tick();};
 const btn=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(name));
 const samples:any[]=[];let error:string|undefined;
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<400;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}
  const canvas=stage!.querySelector('canvas')!,o=JSON.parse(stage!.dataset.sceneGeometry!),r=canvas.getBoundingClientRect();
  const x=r.left+(o.ix+o.iw*.2)/o.cw*r.width,y=r.top+(o.iy+o.ih*.2)/o.ch*r.height;
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2401,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerdown'?1:0}));
  await wait(2);document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(2);btn('調節')!.click();await tick();
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  for(const name of ['亮度','曝光','對比','高光','陰影','色溫','色調','飽和度','自然飽和度']){
   const clicked=performance.now();btn(name)!.click();await tick();
   const slider=document.querySelector<HTMLInputElement>('input[type=range][min="-100"]')!;
   const pointer=(type:string)=>{const b=slider.getBoundingClientRect();slider.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2402,pointerType:'touch',clientX:b.x+b.width/2,clientY:b.y+b.height/2,buttons:type==='pointerdown'?1:0}));};
   for(let round=0;round<3;round++){
    const start=performance.now(),ms:number[]=[];pointer('pointerdown');
    for(let i=0;i<40;i++){const t=performance.now();setter.call(slider,String(Math.round(Math.sin(i*Math.PI/20)*80)));slider.dispatchEvent(new Event('input',{bubbles:true}));await tick();ms.push(performance.now()-t);}
    pointer('pointerup');await wait(4);
    const surface=stage!.querySelector<HTMLCanvasElement>('[data-base-colour-presentation]');
    const times:number[]=JSON.parse(surface?.dataset.colourFrameTimes||'[]').filter((t:number)=>t>=start),intervals=times.slice(1).map((t,i)=>t-times[i]);
    const jobs=JSON.parse(surface?.dataset.colourJobs||'[]').filter((j:any)=>j.at>=start);
    samples.push({name,round:round+1,clickToDrag:round===0?start-clicked:undefined,mean:ms.reduce((a,b)=>a+b)/ms.length,max:Math.max(...ms),over50:ms.filter(v=>v>50).length,visualUpdates:times.length,meanVisual:intervals.length?intervals.reduce((a,b)=>a+b)/intervals.length:null,maxVisual:intervals.length?Math.max(...intervals):null,maxBake:Math.max(...jobs.map((j:any)=>j.bake)),maxJob:Math.max(...jobs.map((j:any)=>j.total)),backend:canvas.dataset.regionFxBackend});
   }
  }
 }catch(e){error=String(e);}
 const report={kind:'creative-cold-edit',route:location.search,ua:navigator.userAgent,error,samples};
 const pre=document.createElement('pre');pre.id='cold-edit-result';pre.hidden=true;pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
