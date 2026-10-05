import {backdropMaskDiagnostics} from '../utils/backdropMasks';
// Mounted production-component input, not a standalone renderer microbenchmark.
void(async()=>{
 const params=new URLSearchParams(location.search),tick=()=>new Promise<number>(r=>requestAnimationFrame(r));
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await tick();};
 const report:any={kind:'creative-gesture-cost-v36',route:location.search,ua:navigator.userAgent,checks:[],metrics:[]};
 const errors:string[]=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}await wait(30);
  if(!stage)throw Error('missing scene');const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!;
  const point=(x:number,y:number)=>{const g=JSON.parse(stage!.dataset.sceneGeometry!),r=canvas.parentElement!.getBoundingClientRect();return{x:r.left+x/g.cw*r.width,y:r.top+y/g.ch*r.height};};
  const pointer=(type:string,id:number,p:{x:number;y:number},target:HTMLElement=canvas)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
  const tap=(p:{x:number;y:number})=>{pointer('pointerdown',3601,p);pointer('pointerup',3601,p);};
  const measure=async(name:string,move:(i:number)=>void)=>{
   const frames:number[]=[],paint:number[]=[],fx:number[]=[],render:number[]=[],composite:number[]=[],slowSections:any[]=[],uploads=backdropMaskDiagnostics.uploads,rebuilds=Number(canvas.dataset.spatialRebuilds||0),painted=Number(canvas.dataset.paintCount||0);let previous=await tick();
   for(let i=0;i<90;i++){move(i);const t=await tick();frames.push(t-previous);previous=t;paint.push(Number(canvas.dataset.paintMs||0));fx.push(Number(canvas.dataset.regionFxMs||0));render.push(backdropMaskDiagnostics.renderMs);composite.push(backdropMaskDiagnostics.compositeMs);}
   const mean=(a:number[])=>a.reduce((n,v)=>n+v,0)/a.length,p95=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length*.95)];
   if(canvas.dataset.slowPaintSections)slowSections.push(JSON.parse(canvas.dataset.slowPaintSections));
   const metric={name,fps:1000/mean(frames),frameP95:p95(frames),maxFrame:Math.max(...frames),paintP95:p95(paint),maxPaint:Math.max(...paint),fxP95:p95(fx),maxFx:Math.max(...fx),maskRenderP95:p95(render),maskCompositeP95:p95(composite),uploads:backdropMaskDiagnostics.uploads-uploads,rebuilds:Number(canvas.dataset.spatialRebuilds||0)-rebuilds,painted:Number(canvas.dataset.paintCount||0)-painted,backend:canvas.dataset.regionFxBackend,size:[canvas.width,canvas.height],slowSections};report.metrics.push(metric);check(name+' sustained >=50fps',metric.fps>=50,metric);
  };
  if(params.has('mask')){
   const o=JSON.parse(stage.dataset.sceneObjects!).find((o:any)=>o.id==='qa-mask');tap(point(o.x+o.w/2,o.y+o.h/2));await wait();check('mask selected',stage.dataset.selectedObject==='qa-mask');
  }else{
   const g=JSON.parse(stage.dataset.sceneGeometry!);tap(point(g.ix+g.iw*.2,g.iy+g.ih*.2));await wait();
   document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(20);
   const b=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith('特效'))!;let t=performance.now();b.click();await tick();report.effectEntryMs=performance.now()-t;await wait(2);
   if(params.has('filterGesture')){
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith('濾鏡'))!.click();
    await wait(30);document.querySelector<HTMLButtonElement>('[data-lut-card]')!.click();await wait(90);
   }else{document.querySelector<HTMLButtonElement>('[data-fx-card="fxLowfi"]')!.click();await wait(25);}
  }
  let geo=JSON.parse(stage.dataset.sceneGeometry!),p=params.has('mask')?point(geo.cw*.5,geo.ch*.5):point(geo.ix+geo.iw*.2,geo.iy+geo.ih*.2);
  const posesBefore=stage.dataset.photoTransforms;pointer('pointerdown',3602,p);
  await measure('selected drag',i=>pointer('pointermove',3602,{x:p.x+Math.sin(i*.1)*28,y:p.y+Math.cos(i*.1)*19}));pointer('pointerup',3602,p);await wait();
  // Resize the selected item with two fingers, then switch to unselected preview.
  pointer('pointerdown',3603,{x:p.x-35,y:p.y});pointer('pointerdown',3604,{x:p.x+35,y:p.y});
  await measure('selected pinch',i=>{const d=35*(1.4+.3*Math.sin(i*.06));pointer('pointermove',3603,{x:p.x-d,y:p.y});pointer('pointermove',3604,{x:p.x+d,y:p.y});});
  pointer('pointerup',3603,{x:p.x-35,y:p.y});pointer('pointerup',3604,{x:p.x+35,y:p.y});await wait();
  if(!params.has('mask')){
   check('selected photo pose really changed',posesBefore!==stage.dataset.photoTransforms);
   const input=document.querySelector<HTMLInputElement>('input[type=range]')!;
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
   const b=input.getBoundingClientRect(),q={x:b.x+b.width*.5,y:b.y+b.height*.5};pointer('pointerdown',3605,q,input);
   await measure('effect slider',i=>{setter.call(input,String(10+Math.round(80*(.5+.5*Math.sin(i*.1)))));input.dispatchEvent(new Event('input',{bubbles:true}));});
   pointer('pointerup',3605,q,input);await wait();
  }
  document.querySelector<HTMLButtonElement>('[data-creative-tab="setting"]')!.click();await wait();
  const outer=stage.getBoundingClientRect();tap({x:outer.left+2,y:outer.top+2});await wait();
  check('preview selection cleared',!stage.dataset.selectedObject&&!stage.dataset.selectedRegionPhoto);
  const midPoint={x:(outer.left+outer.right)/2,y:(outer.top+outer.bottom)/2},touchWidths:number[]=[];
  pointer('pointerdown',3606,{x:midPoint.x-35,y:midPoint.y},stage);pointer('pointerdown',3607,{x:midPoint.x+35,y:midPoint.y},stage);
  await measure('preview touch pinch',i=>{touchWidths.push(canvas.parentElement!.getBoundingClientRect().width);const d=35*(1.55+.5*Math.sin(i*.075));pointer('pointermove',3606,{x:midPoint.x-d,y:midPoint.y},stage);pointer('pointermove',3607,{x:midPoint.x+d,y:midPoint.y},stage);});
  pointer('pointerup',3606,{x:midPoint.x-35,y:midPoint.y},stage);pointer('pointerup',3607,{x:midPoint.x+35,y:midPoint.y},stage);await wait();
  check('touch preview really zoomed',Math.max(...touchWidths)-Math.min(...touchWidths)>30);
  // Wheel uses the same live view paint as pinch, without selected-item
  // arbitration. Also assert the frame really changes; idle rAF is not FPS.
  const s=stage.getBoundingClientRect(),mid=(s.left+s.right)/2,y=(s.top+s.bottom)/2,widths:number[]=[];
  await measure('preview zoom',i=>{widths.push(canvas.parentElement!.getBoundingClientRect().width);stage!.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:mid,clientY:y,deltaY:i%24<12?-10:10}));});await wait();
  check('preview actually zoomed',Math.max(...widths)-Math.min(...widths)>30,{min:Math.min(...widths),max:Math.max(...widths)});
  check('no runtime errors',!errors.length,errors);report.maskDiagnostics={...backdropMaskDiagnostics};report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const pre=document.createElement('pre');pre.id='gesture-cost-result';pre.hidden=true;pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
