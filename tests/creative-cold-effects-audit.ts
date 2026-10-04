void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n:number)=>{for(let i=0;i<n;i++)await tick();};
 const btn=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(name));
 const samples:any[]=[];let error:string|undefined;
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<400;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}
  const canvas=stage!.querySelector('canvas')!,o=JSON.parse(stage!.dataset.sceneGeometry!),r=canvas.getBoundingClientRect();
  const x=r.left+(o.ix+o.iw*.2)/o.cw*r.width,y=r.top+(o.iy+o.ih*.2)/o.ch*r.height;
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2411,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerdown'?1:0}));
  await wait(2);document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(2);
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  for(const id of location.search.includes('oneEffect')?['filter',new URLSearchParams(location.search).get('effect')||'fxLowfi','filter']:['filter','fxMosaic','fxGlass','fxExposureSpill','fxLowfi',...(location.search.includes('combined')?['filter']:[]),...(location.search.includes('legacy')?['softLight','halation','lightLeak','blur','colorNoise']:[])]){
   const startSelect=performance.now();
   if(id==='filter'){
    btn('濾鏡')?.click();await tick();
    const card=document.querySelector<HTMLButtonElement>('[data-lut-card]')!;card.click();
    for(let i=0;i<400&&!document.querySelector('input[type=range]');i++)await tick();
   }else{
    if(!document.querySelector(`[data-fx-card="${id}"]`)){btn('返回特效')?.click();btn('特效')!.click();await tick();}
    document.querySelector<HTMLButtonElement>(`[data-fx-card="${id}"]`)!.click();await tick();
   }
   const slider=document.querySelector<HTMLInputElement>('input[type=range]')!;
   if(!slider)throw Error('missing slider '+id);
   const pointer=(type:string)=>{const b=slider.getBoundingClientRect();slider.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2412,pointerType:'touch',clientX:b.x+b.width/2,clientY:b.y+b.height/2,buttons:type==='pointerdown'?1:0}));};
   for(let round=0;round<3;round++){
    const ms:number[]=[],presented:string[]=[],phases:any[]=[];pointer('pointerdown');
    for(let i=0;i<20;i++){const t=performance.now(),v=10+Math.round(80*Math.sin(i*Math.PI/20));setter.call(slider,String(v));slider.dispatchEvent(new Event('input',{bubbles:true}));await tick();ms.push(performance.now()-t);presented.push(document.querySelector<HTMLElement>('[data-base-colour-presentation]')?.dataset.presentedColourKey||'');phases.push({backend:canvas.dataset.regionFxBackend,paint:canvas.dataset.paintMs,timing:document.querySelector<HTMLElement>('[data-base-spatial-presentation]')?.dataset.colourFxTiming});}
    pointer('pointerup');await wait(4);
    samples.push({id,round:round+1,fxPhases:document.querySelector<HTMLElement>('[data-base-spatial-presentation]')?.dataset.fxPhases,selectionMs:round===0?performance.now()-startSelect-ms.reduce((a,b)=>a+b):undefined,mean:ms.reduce((a,b)=>a+b)/ms.length,max:Math.max(...ms),over50:ms.filter(v=>v>50).length,presentedUpdates:presented.filter((v,i)=>v&&v!==presented[i-1]).length,presented: id==='filter'?presented:undefined,phases:id==='filter'?phases:undefined});
   }
   if(location.search.includes('details')){
    const detail=document.querySelector<HTMLElement>(`[data-fx-card="${id}"] [aria-label="調整細項"]`);
    if(detail){detail.click();await wait(2);
     const names=id==='fxExposureSpill'||id==='softLight'?['範圍','擴散','色相']:id==='halation'?['範圍','擴散','色相']:id==='fxLowfi'?['顆粒','色差','濾鏡','對比','光暈']:id==='lightLeak'?['角度','色相']:[];
     for(const name of names){const button=btn(name);if(!button)continue;button.click();await tick();
      const input=document.querySelector<HTMLInputElement>('input[type=range]')!,b=input.getBoundingClientRect();
      input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2413,pointerType:'touch',clientX:b.x+b.width*.5,clientY:b.y+b.height*.5,buttons:1}));
      const ms:number[]=[];for(let i=0;i<20;i++){const t=performance.now(),v=Number(input.min)+(Number(input.max)-Number(input.min))*(.1+.8*Math.sin(i*Math.PI/20));setter.call(input,String(Math.round(v)));input.dispatchEvent(new Event('input',{bubbles:true}));await tick();ms.push(performance.now()-t);}
      input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2413,pointerType:'touch',clientX:b.x+b.width*.5,clientY:b.y+b.height*.5}));await wait(2);
      samples.push({id,detail:name,mean:ms.reduce((a,b)=>a+b)/ms.length,max:Math.max(...ms),over50:ms.filter(v=>v>50).length});
     }
    }
   }
  }
 }catch(e){error=String(e);}
 const report={kind:'creative-cold-effects',route:location.search,ua:navigator.userAgent,error,samples};
 const pre=document.createElement('pre');pre.id='cold-effects-result';pre.hidden=true;pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 const proof=document.createElement('pre');proof.textContent=error||samples.map(s=>`${s.id}${s.detail?' '+s.detail:' #'+s.round}: ${s.mean.toFixed(1)}ms / max ${s.max.toFixed(0)}ms`).join('\n');proof.style.cssText='position:fixed;inset:80px 8px 80px;z-index:99999;overflow:auto;background:#111;color:white;font:11px monospace;padding:12px;pointer-events:none';document.body.append(proof);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
