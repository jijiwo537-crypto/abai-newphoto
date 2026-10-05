void(async()=>{
 const tick=()=>new Promise<number>(r=>requestAnimationFrame(r));
 const report:any={kind:'creative-cold-interleave',route:location.search,ua:navigator.userAgent,samples:[],checks:[]};
 const post=()=>{
  let result=document.getElementById('cold-interleave-result');
  if(!result){result=document.createElement('pre');result.id='cold-interleave-result';result.hidden=true;document.body.append(result);}
  result.dataset.report=JSON.stringify(report);
  return fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 };
 const wait=async(n=2)=>{for(let i=0;i<n;i++)await tick();};
 const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith(name));
 try{
  report.phase='starting';await post();
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry&&document.querySelector('[data-photo-cell="0"]'))break;await tick();}
  if(!stage)throw Error('stage missing');
  const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!;
  const point=()=>{const r=document.querySelector('[data-photo-cell="0"]')!.getBoundingClientRect();return{x:r.x+r.width*.2,y:r.y+r.height*.2};};
  const pointer=(type:string,id:number,p:{x:number;y:number},target:HTMLElement=canvas)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
  const p=point();pointer('pointerdown',8701,p);pointer('pointerup',8701,p);await wait();
  document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait();
  report.phase='editor';await post();button('特效')!.click();await wait();
  for(const id of ['fxLowfi','fxGlass','fxMosaic','fxExposureSpill','halation','softLight','fxLowfi','fxGlass','fxMosaic','softLight']){
   const start=performance.now();document.querySelector<HTMLButtonElement>(`[data-fx-card="${id}"]`)!.click();await tick();
   report.samples.push({kind:'effect',id,ms:performance.now()-start,paint:canvas.dataset.paintMs,sections:canvas.dataset.slowPaintSections,halo:[...canvas.parentElement!.querySelectorAll<HTMLCanvasElement>('canvas')].map(c=>c.dataset.haloPhases).filter(Boolean)});
   report.phase=id;await post();
   const q=point(),before=stage.dataset.photoTransforms;pointer('pointerdown',8702,q);
   const frames:number[]=[];let previous=performance.now();
   for(let i=0;i<12;i++){const delta=(i<6?i:12-i)*(report.samples.length%4?2:-2);pointer('pointermove',8702,{x:q.x+delta,y:q.y+delta/2});const next=await tick();frames.push(next-previous);previous=next;}
   pointer('pointerup',8702,q);await tick();
   report.samples.push({kind:'immediate drag',id,max:Math.max(...frames),mean:frames.reduce((a,b)=>a+b)/frames.length,changed:before!==stage.dataset.photoTransforms});await post();
  }
  document.querySelector<HTMLButtonElement>('[data-creative-tab="setting"]')!.click();await wait();
  const box=stage.getBoundingClientRect();pointer('pointerdown',8703,{x:box.x+2,y:box.y+2});pointer('pointerup',8703,{x:box.x+2,y:box.y+2});await wait();
  const q={x:box.x+box.width/2,y:box.y+box.height/2};pointer('pointerdown',8704,{x:q.x-40,y:q.y},stage);pointer('pointerdown',8705,{x:q.x+40,y:q.y},stage);
  const frames:number[]=[];let previous=performance.now();
  const slowFrames:any[]=[];
  for(let i=0;i<90;i++){const d=40*(1.3+.3*Math.sin(i*.15));pointer('pointermove',8704,{x:q.x-d,y:q.y},stage);pointer('pointermove',8705,{x:q.x+d,y:q.y},stage);const next=await tick();frames.push(next-previous);if(next-previous>30)slowFrames.push({i,ms:next-previous,paint:canvas.dataset.paintMs,sections:canvas.dataset.slowPaintSections,fxMs:canvas.dataset.regionFxMs,backend:canvas.dataset.regionFxBackend});previous=next;}
  pointer('pointerup',8704,{x:q.x-40,y:q.y},stage);pointer('pointerup',8705,{x:q.x+40,y:q.y},stage);
  report.samples.push({kind:'preview pinch',max:Math.max(...frames),mean:frames.reduce((a,b)=>a+b)/frames.length,slowFrames});
  report.phase='complete';
 }catch(e){report.error=String(e);}
 await post();
})();
