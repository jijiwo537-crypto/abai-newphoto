void(async()=>{
 const tick=()=>new Promise<number>(r=>requestAnimationFrame(r)),wait=async(n=3)=>{while(n--)await tick();};
 const report:any={kind:'creative-three-photo-selection',checks:[],samples:[]};
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}await wait(30);
  if(!stage)throw Error('stage missing');
  const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!;
  const tap=(x:number,y:number)=>{for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:5901,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerdown'?1:0}));};
  const point=(i:number)=>{const g=JSON.parse(stage!.dataset.sceneGeometry!),b=canvas.parentElement!.getBoundingClientRect();const p=i===0?[.5,.25]:i===1?[.25,.75]:[.75,.75];return{x:b.left+(g.ix+g.iw*p[0])/g.cw*b.width,y:b.top+(g.iy+g.ih*p[1])/g.ch*b.height};};
  const clear=async()=>{const b=stage!.getBoundingClientRect();tap(b.left+1,b.top+1);await wait();};
  const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith(name))!;
  for(let i=0;i<3;i++){
   await clear();const p=point(i);tap(p.x,p.y);await wait();
   if(stage.dataset.selectedRegionPhoto!==String(i))throw Error('selection setup '+i);
   document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait();button('濾鏡').click();await wait();
   for(let n=0;n<300&&!document.querySelector('[data-lut-card]');n++)await tick();
   document.querySelector<HTMLButtonElement>('[data-lut-card]')!.click();await wait(40);
   button('特效').click();await wait();document.querySelector<HTMLButtonElement>('[data-fx-card="fxLowfi"]')!.click();await wait(30);
  }
  report.checks.push({name:'all three photos have filter and effect',pass:JSON.parse(stage.dataset.photoEffects!).every((p:any)=>!!p.lut&&p.fxLowfi>0)});
  for(const tab of ['setting','objedit']){
   document.querySelector<HTMLButtonElement>(`[data-creative-tab="${tab}"]`)!.click();await wait(10);
   for(let round=0;round<3;round++)for(let i=0;i<3;i++){
    await clear();const p=point(i),t=performance.now(),painted=Number(canvas.dataset.paintCount||0);tap(p.x,p.y);const syncMs=performance.now()-t,immediatePaint=Number(canvas.dataset.paintCount||0)-painted;await tick();
    report.samples.push({tab,round,index:i,ms:performance.now()-t,syncMs,immediatePaint,selected:stage.dataset.selectedRegionPhoto,painted:Number(canvas.dataset.paintCount||0)-painted,paintMs:Number(canvas.dataset.paintMs||0),spatial:canvas.dataset.spatialRebuilds});await wait(2);
   }
  }
  report.checks.push({name:'selection feedback before next frame',pass:report.samples.every((s:any)=>s.selected===String(s.index)&&s.immediatePaint>0&&s.syncMs<16.7)});
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const el=document.createElement('pre');el.id='selection-latency-result';el.dataset.report=JSON.stringify(report);el.style.cssText='position:fixed;top:65px;left:8px;z-index:999999;color:white;background:#101010e8;font-size:10px;padding:6px;pointer-events:none';el.textContent=`三張濾鏡＋特效：${report.pass?'PASS':'FAIL'}\n選中即時繪製 ${Math.max(...report.samples.map((s:any)=>s.syncMs)).toFixed(1)} ms\n${report.error||''}`;document.body.append(el);
})();
