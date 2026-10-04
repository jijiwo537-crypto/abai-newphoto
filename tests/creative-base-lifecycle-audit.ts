void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n=3)=>{for(let i=0;i<n;i++)await tick();};
 const report:any={kind:'creative-base-lifecycle',route:location.search,ua:navigator.userAgent,samples:[],checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith(name));
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<400;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}
  if(!stage)throw Error('missing stage');await wait(8);
  const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!,geometry=JSON.parse(stage.dataset.sceneGeometry!),r=canvas.getBoundingClientRect();
  const x=r.left+(geometry.ix+geometry.iw*.2)/geometry.cw*r.width,y=r.top+(geometry.iy+geometry.ih*.2)/geometry.ch*r.height;
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2401,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerdown'?1:0}));
  await wait(2);
  const edit=()=>{document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();};
  const setting=()=>{document.querySelector<HTMLButtonElement>('[data-creative-tab="setting"]')!.click();};
  for(let round=0;round<16;round++){
   edit();await wait(round===0?45:4);
   button('特效')!.click();await wait(2);
   const id=['fxMosaic','fxGlass','fxLowfi','fxExposureSpill'][round%4],card=document.querySelector<HTMLButtonElement>(`[data-fx-card="${id}"]`);
   if(!card)throw Error('missing '+id);
   const start=performance.now();card.click();await tick();const clickMs=performance.now()-start;
   await wait(3);
   const backend=canvas.dataset.regionFxBackend;
   check('effect applied '+round,!!document.querySelector(`[data-fx-card="${id}"] .ring-white`),backend);
   setting();await wait(3);
   const inputs=[...document.querySelectorAll<HTMLInputElement>('footer input[type=range]')];
   const slider=inputs.find(s=>s.closest('.flex-col')?.textContent?.includes('佔比'))||inputs[0];
   if(!slider)throw Error('occupancy slider missing');
   const box=slider.getBoundingClientRect();
   slider.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2402,pointerType:'touch',clientX:box.x+box.width*.5,clientY:box.y+box.height*.5,buttons:1}));
   const ms:number[]=[],effectMs:number[]=[],sizes=new Set<string>();
   for(let i=0;i<24;i++){
    const t=performance.now();setter.call(slider,String(20+Math.round(60*Math.sin(i*Math.PI/24))));slider.dispatchEvent(new Event('input',{bubbles:true}));await tick();ms.push(performance.now()-t);
    effectMs.push(Number(canvas.dataset.regionFxMs||0));sizes.add(canvas.dataset.regionFxSize||'');
   }
   slider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2402,pointerType:'touch',clientX:box.x+box.width*.5,clientY:box.y+box.height*.5}));
   await wait(3);
   report.samples.push({round:round+1,id,clickMs,mean:ms.reduce((a,b)=>a+b)/ms.length,max:Math.max(...ms),over50:ms.filter(v=>v>50).length,maxEffectMs:Math.max(...effectMs),sourceSizes:[...sizes],spatialOverlays:stage.querySelectorAll('[data-base-spatial-presentation]').length});
   check('editing GPU overlay retired '+round,stage.querySelectorAll('[data-base-spatial-presentation]').length===0);
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const result=document.createElement('pre');result.id='base-lifecycle-result';result.hidden=true;result.dataset.report=JSON.stringify(report);document.body.append(result);
 const proof=document.createElement('pre');proof.textContent=report.error||report.samples.map((s:any)=>`${s.round} ${s.id}: click ${s.clickMs.toFixed(0)}ms; occupancy ${s.mean.toFixed(1)}ms / max ${s.max.toFixed(0)}ms; FX ${s.maxEffectMs.toFixed(1)}ms`).join('\n');proof.style.cssText='position:fixed;inset:80px 8px 80px;z-index:99999;overflow:auto;background:#111;color:white;font:11px monospace;padding:12px;pointer-events:none';document.body.append(proof);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
