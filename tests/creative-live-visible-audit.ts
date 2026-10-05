// Verify presented pixels during pointer-held edits, not just committed state.
void(async()=>{
 const tick=()=>new Promise(r=>requestAnimationFrame(r));
 const wait=async(n=4)=>{while(n--)await tick();};
 const report:any={kind:'creative-live-visible',route:location.search,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
 let stage:HTMLElement|null=null;
 for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}await wait(15);
 const canvas=stage!.querySelector<HTMLCanvasElement>('canvas')!;
 const geometry=JSON.parse(stage!.dataset.sceneGeometry!),rect=canvas.getBoundingClientRect();
 const p={x:rect.left+(geometry.ix+geometry.iw*.2)/geometry.cw*rect.width,y:rect.top+(geometry.iy+geometry.ih*.2)/geometry.ch*rect.height};
 const pointer=(type:string,id:number,q=p,target:HTMLElement=canvas)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:q.x,clientY:q.y,buttons:type==='pointerup'?0:1}));
 const cell=document.querySelector('[data-photo-cell="0"]')?.getBoundingClientRect();
 const roi=cell?{x:Math.ceil(64*(cell.x-rect.x)/rect.width)+1,y:Math.ceil(64*(cell.y-rect.y)/rect.height)+1,w:Math.max(1,Math.floor(64*cell.width/rect.width)-2),h:Math.max(1,Math.floor(64*cell.height/rect.height)-2)}
 :{x:Math.round(64*geometry.ix/geometry.cw),y:Math.round(64*geometry.iy/geometry.ch),w:Math.max(1,Math.floor(64*geometry.iw/geometry.cw)),h:Math.max(1,Math.floor(64*geometry.ih/geometry.ch))};
 const extract=(g:CanvasRenderingContext2D)=>g.getImageData(roi.x,roi.y,roi.w,roi.h).data;
 const pixels=()=>{
  const cv=document.createElement('canvas');cv.width=64;cv.height=64;const g=cv.getContext('2d')!;
  // Reconstruct the displayed sibling order. A stale overlay hiding a freshly
  // painted main canvas must fail this audit.
  for(const source of canvas.parentElement!.querySelectorAll('canvas')){
   if(getComputedStyle(source).display==='none'||!source.width||!source.height)continue;
   g.drawImage(source,0,0,64,64);
  }
  return extract(g);
 };
 const difference=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0)/a.length;
 pointer('pointerdown',4101);pointer('pointerup',4101);await wait();
 document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait();
 [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith('特效'))!.click();await wait();
 const original=pixels();
 if(new URLSearchParams(location.search).has('rapid')){
  const times:any[]=[];
  const stress=new URLSearchParams(location.search).has('longSwitch');
  const ids=stress?['softLight','halation','lightLeak','fxMosaic','fxGlass','fxLowfi','fxExposureSpill','fxMotion','fxSpin','fxAberration']:['fxMosaic','fxGlass','fxLowfi','fxExposureSpill'];
  for(let i=0;i<(stress?320:24);i++){
   const id=ids[i%ids.length];
   const card=document.querySelector<HTMLButtonElement>(`[data-fx-card="${id}"]`)!;
   if(!card)throw Error('missing effect '+id);
   const previous=pixels(),start=performance.now();card.click();await wait(2);
   let elapsed=performance.now()-start;const selectionMs=elapsed;
   let delta=difference(previous,pixels());
   const minimum=id==='fxSpin'?.005:.1;
   // Observe the next actual presentation, rather than assuming React and
   // WebKit always present on the second scheduled animation callback.
   for(let frame=0;delta<=minimum&&frame<4;frame++){await tick();elapsed=performance.now()-start;delta=difference(previous,pixels());}
   times.push({id,ms:elapsed,selectionMs,selected:card.getAttribute('aria-pressed')==='true',difference:delta,paint:canvas.dataset.paintMs,rebuilds:canvas.dataset.spatialRebuilds,reason:canvas.dataset.sceneRebuildReason,backend:canvas.dataset.regionFxBackend});
   if(stress&&i%20===19)await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'long-switch-progress',route:location.search,count:i+1,samples:times.slice(-20)})}).catch(()=>{});
   // Alternate fast clicks with settling: exercise native snapshot allocation
   // as well as the resident editing renderer, rather than only a hot loop.
   if(stress&&i%40===39)await wait(60);
  }
  check('rapid effects select and change presented pixels',times.every(t=>t.selected&&t.difference>(t.id==='fxSpin'?.005:.1)),times);
 }
 document.querySelector<HTMLButtonElement>('[data-fx-card="fxMosaic"]')!.click();await wait(20);
 const firstChange=difference(original,pixels());
 check('first effect changes presented photograph while selected',firstChange>.1,{difference:firstChange});
 const reference=document.createElement('canvas');
 document.dispatchEvent(new CustomEvent('abai:qa-preview-reference',{detail:{canvas:reference}}));
 const sample=document.createElement('canvas');sample.width=sample.height=64;
 sample.getContext('2d')!.drawImage(reference,0,0,64,64);
 const referenceDifference=difference(extract(sample.getContext('2d')!),pixels());
 // Native WebKit's P3 GPU-to-2D copy introduces <1.2% channel conversion
 // error; a frozen/missing effect fails the independent live-change checks.
 check('selected GPU result matches full renderer',referenceDifference<3,{difference:referenceDifference,tolerance:3});
 reference.width=reference.height=1;
 document.querySelector<HTMLButtonElement>('[data-fx-card="fxLowfi"]')!.click();await wait(40);
 const input=document.querySelector<HTMLInputElement>('footer input[type=range]')!;
 const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
 const before=pixels(),r=input.getBoundingClientRect(),q={x:r.left+r.width/2,y:r.top+r.height/2};
 pointer('pointerdown',4102,q,input);set.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));await wait(8);
 const during=pixels();check('effect pixels change before release',difference(before,during)>1,{difference:difference(before,during)});
 pointer('pointerup',4102,q,input);await wait(5);
 pointer('pointerdown',4104,{x:p.x-25,y:p.y});pointer('pointerdown',4105,{x:p.x+25,y:p.y});
 pointer('pointermove',4104,{x:p.x-55,y:p.y});pointer('pointermove',4105,{x:p.x+55,y:p.y});await wait(8);
 pointer('pointerup',4104,{x:p.x-55,y:p.y});pointer('pointerup',4105,{x:p.x+55,y:p.y});await wait();
 const poseBefore=pixels();pointer('pointerdown',4103);pointer('pointermove',4103,{x:p.x+45,y:p.y+25});await wait(8);
 const poseDuring=pixels();check('photo pixels move before release',difference(poseBefore,poseDuring)>1,{difference:difference(poseBefore,poseDuring)});
 pointer('pointerup',4103,{x:p.x+45,y:p.y+25});await wait();
 if(new URLSearchParams(location.search).has('realFilters')){
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith('濾鏡'))!.click();await wait();
  document.querySelectorAll<HTMLButtonElement>('[data-lut-card]')[2].click();await wait(80);
  const slider=document.querySelector<HTMLInputElement>('footer input[type=range]')!,b=slider.getBoundingClientRect(),q={x:b.left+b.width/2,y:b.top+b.height/2};
  const old=pixels();pointer('pointerdown',4106,q,slider);set.call(slider,'0');slider.dispatchEvent(new Event('input',{bubbles:true}));await wait(12);
  const changed=difference(old,pixels());check('filter pixels change before release',changed>1,{difference:changed});
  pointer('pointerup',4106,q,slider);await wait();
 }
 report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const pre=document.createElement('pre');pre.id='live-visible-result';pre.hidden=true;pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
