// Mounted GridLayoutTool: exercise real corner-resize and preview touch handlers.
void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 while(!document.querySelector('svg[data-seamless-master]'))await wait();await wait(30);
 const layout=document.querySelector<HTMLElement>('[data-layout-id="seam-layout"]')!;
 (layout.querySelector('[data-cell-id]') as HTMLElement).click();await wait(4);
 const canvas=layout.querySelector<HTMLCanvasElement>('canvas')!,svg=layout.querySelector<SVGSVGElement>('svg[data-seamless-master]')!;
 const source=svg.querySelector('image')!.getAttribute('href'),paints=Number(canvas.dataset.paintCount),samples:any[]=[];
 // Safari's getScreenCTM omits CSS scale on an SVG root. Read the actual
 // rendered bounds instead; this also catches ancestor/layout rounding.
 const geometry=()=>{const r=svg.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};};
 const initial=geometry();
 const handle=document.querySelector<HTMLElement>('[data-layout-wrapper] .cursor-nwse-resize.top-full.left-full');
 if(!handle)throw new Error('Missing selected layout bottom-right resize handle');
 const h=handle.getBoundingClientRect(),x=h.left+h.width/2,y=h.top+h.height/2;
 const pointer=(type:string,dx:number)=>handle.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:81,pointerType:'touch',clientX:x+dx,clientY:y+dx*initial.h/initial.w,buttons:type==='pointerup'?0:1}));
 pointer('pointerdown',0);
 if(new URLSearchParams(location.search).has('frameAudit')){
  let step=0;
  const controls=document.createElement('div');controls.style.cssText='position:fixed;bottom:12px;left:12px;z-index:999999;display:flex;gap:12px;color:white';
  const info=document.createElement('output');info.id='seam-frame-geometry';info.style.cssText='font-size:9px;max-width:160px;overflow:hidden';
  const show=()=>{const report={kind:'seamless-pixel-step',ua:navigator.userAgent,step,...geometry()};info.textContent=JSON.stringify(report);void fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});};show();
  for(const direction of [-1,1]){const b=document.createElement('button');b.textContent=direction>0?'下一幀':'上一幀';b.style.cssText='background:#222;color:white;padding:10px;border:1px solid #888';b.onclick=async()=>{
   step+=direction;const r=handle.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2;
   for(const type of ['pointerdown','pointermove','pointerup']){const dx=type==='pointerdown'?0:direction*.5;handle.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:81,pointerType:'touch',clientX:cx+dx,clientY:cy+dx*initial.h/initial.w,buttons:type==='pointerup'?0:1}));}
   await wait(2);show();
  };controls.append(b);}
  controls.append(info);document.body.append(controls);return;
 }
 for(let i=1;i<=360;i++){pointer('pointermove',(i<=180?i:360-i)*.12);await wait();samples.push(geometry());}
 pointer('pointerup',0);await wait(4);
 const maxPivotDrift=Math.max(...samples.map(s=>Math.hypot(s.x-initial.x,s.y-initial.y)));
 const backwardSteps=samples.slice(1).filter((s,i)=>i<179?s.w<samples[i].w-1e-5:s.w>samples[i].w+1e-5).length;
 const sourceStable=svg.querySelector('image')!.getAttribute('href')===source&&Number(canvas.dataset.paintCount)===paints;
 // Tap blank space to deselect; a pinch started on the workspace must zoom the
 // whole preview, not an individually selected cell/layout.
 const workspace=layout.closest<HTMLElement>('[data-grid-preview-viewport]')!;
 const wr=workspace.getBoundingClientRect(),px=wr.left+5,py=wr.top+5;
 const touches=(type:string,d:number)=>{const list=type==='touchend'?[]:[new Touch({identifier:1,target:workspace,clientX:wr.left+wr.width/2-d/2,clientY:wr.top+wr.height/2}),new Touch({identifier:2,target:workspace,clientX:wr.left+wr.width/2+d/2,clientY:wr.top+wr.height/2})];workspace.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:list,targetTouches:list,changedTouches:list}));};
 workspace.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:82,clientX:px,clientY:py}));workspace.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:82,clientX:px,clientY:py}));await wait(4);
 touches('touchstart',80);const preview:any[]=[];
 for(let i=1;i<=360;i++){touches('touchmove',80+(i<=180?i:360-i)*.15);await wait();preview.push(geometry());}
 touches('touchend',0);await wait(4);
 const previewBackward=preview.slice(1).filter((s,i)=>i<179?s.w<preview[i].w-1e-5:i>181&&s.w>preview[i].w+1e-5).length;
 const localWidth=svg.width.baseVal.value,localHeight=svg.height.baseVal.value;
 const report={kind:'seamless-slow-geometry',ua:navigator.userAgent,pass:maxPivotDrift<.03&&backwardSteps===0&&previewBackward===0&&sourceStable&&preview[179].w>preview[0].w+10,frames:720,maxPivotDrift,backwardSteps,previewBackward,sourceStable,localWidth,localHeight,objectStart:initial,objectEnd:samples.at(-1),previewStart:preview[0],previewPeak:preview[179],previewEnd:preview.at(-1)};
 const out=document.createElement('pre');out.id='seamless-slow-result';out.style.cssText='position:fixed;top:60px;left:8px;max-height:180px;overflow:auto;z-index:999999;background:#111e;color:white;font-size:10px';out.textContent=JSON.stringify(report,null,2);document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
