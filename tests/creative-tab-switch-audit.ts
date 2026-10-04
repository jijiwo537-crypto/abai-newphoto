void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r())),wait=async(n=3)=>{for(let i=0;i<n;i++)await tick();};
 const report:any={kind:'creative-tab-switch-v35',route:location.search,ua:navigator.userAgent,checks:[],samples:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith(name));
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}await wait(20);
  if(!stage)throw Error('missing stage');const canvas=stage.querySelector('canvas')!;
  const o=JSON.parse(stage.dataset.sceneGeometry!),r=canvas.getBoundingClientRect(),x=r.left+(o.ix+o.iw*.2)/o.cw*r.width,y=r.top+(o.iy+o.ih*.2)/o.ch*r.height;
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:3690,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerdown'?1:0}));await wait();
  document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(20);button('特效')!.click();await wait();
  document.querySelector<HTMLButtonElement>('[data-fx-card="fxLowfi"]')!.click();await wait(30);
  for(let round=0;round<12;round++){
   const sample=(name:string,t:number)=>({round,name,ms:performance.now()-t,paint:Number(canvas.dataset.paintMs),backend:canvas.dataset.regionFxBackend,spatial:canvas.dataset.spatialRebuilds,colour:canvas.dataset.colourRebuilds,reason:canvas.dataset.sceneRebuildReason});
   for(const name of ['濾鏡','調節','特效']){const b=button(name)!;const t=performance.now();b.click();await tick();report.samples.push(sample(name,t));await wait(2);}
   for(const id of ['setting','shape','add','objedit']){const b=document.querySelector<HTMLButtonElement>(`[data-creative-tab="${id}"]`)!;const t=performance.now();b.click();await tick();report.samples.push(sample(id,t));check('active '+id+' '+round,b.classList.contains('text-white'));await wait(3);}
  }
  check('photo editor remains usable',!!button('特效'));report.timings={mean:report.samples.reduce((n:number,s:any)=>n+s.ms,0)/report.samples.length,max:Math.max(...report.samples.map((s:any)=>s.ms))};
  check('no long tab-switch tasks',report.timings.max<100,report.timings);report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.hidden=true;pre.id='tab-switch-result';pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
