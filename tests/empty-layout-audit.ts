void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'empty-layout-slow-zoom',ua:navigator.userAgent};
 try{
  let surface:SVGRectElement|null=null;
  for(let i=0;i<600;i++){surface=document.querySelector('[data-layout-empty-surface]');if(surface)break;await wait();}
  if(!surface)throw Error('Shared empty background not mounted');await wait(20);
  const layout=surface.closest<HTMLElement>('[data-layout-wrapper]')!,workspace=layout.closest<HTMLElement>('[data-grid-preview-viewport]')!;
  const svg=surface.closest('svg')!,lines=layout.querySelector<SVGElement>('[data-layout-grid-lines]')!;
  const wr=workspace.getBoundingClientRect();
  const touches=(type:string,d:number)=>{const list=type==='touchend'?[]:[new Touch({identifier:21,target:workspace,clientX:wr.left+wr.width/2-d/2,clientY:wr.top+wr.height/2}),new Touch({identifier:22,target:workspace,clientX:wr.left+wr.width/2+d/2,clientY:wr.top+wr.height/2})];workspace.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:list,targetTouches:list,changedTouches:list}));};
  const sample=()=>{const a=layout.getBoundingClientRect(),b=svg.getBoundingClientRect(),c=surface!.getBoundingClientRect();return{w:a.width,h:a.height,x:a.x,y:a.y,drift:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y),Math.abs(a.width-b.width),Math.abs(a.height-b.height),Math.abs(b.x-c.x),Math.abs(b.y-c.y),Math.abs(b.width-c.width),Math.abs(b.height-c.height))};};
  const samples:any[]=[];
  touches('touchstart',80);
  if(new URLSearchParams(location.search).has('frameStep')){
   let step=0;const box=document.createElement('div');box.style.cssText='position:fixed;bottom:8px;left:8px;display:flex;gap:8px;z-index:999999;color:white';
   for(const direction of [-1,1]){const button=document.createElement('button');button.textContent=direction>0?'下一幀':'上一幀';button.style.cssText='padding:8px;background:#222;color:white;flex-shrink:0;white-space:nowrap';button.onclick=async()=>{step+=direction;touches('touchstart',80);touches('touchmove',80+direction*.08);await wait(2);touches('touchend',0);out.textContent=JSON.stringify({step,...sample()});};box.append(button);}
   const out=document.createElement('output');out.id='empty-frame-result';out.style.cssText='font-size:8px;max-width:150px;overflow:hidden;white-space:nowrap';out.textContent=JSON.stringify(sample());box.append(out);document.body.append(box);return;
  }
  for(let i=1;i<=360;i++){touches('touchmove',80+(i<=180?i:360-i)*.12);await wait();samples.push(sample());}
  touches('touchend',0);await wait(4);
  const maxPlaneDrift=Math.max(...samples.map(s=>s.drift));
  const backwardSteps=samples.slice(1).filter((s,i)=>i<179?s.w<samples[i].w-1e-5:i>181&&s.w>samples[i].w+1e-5).length;
  // Only the internal x=half-width division is stroked, never the perimeter.
  const path=lines.querySelector('path')!.getAttribute('d');
  const noOuterFrame=!!path&&!/\bZ\b/.test(path);
  const pixelCanvas=document.createElement('canvas');pixelCanvas.width=309;pixelCanvas.height=412;
  const img=new Image();img.src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="309" height="412" viewBox="0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}">${svg.innerHTML}<path d="${path}" stroke="rgba(255,255,255,.1)" fill="none"/></svg>`);
  await img.decode();const g=pixelCanvas.getContext('2d')!;g.drawImage(img,0,0);const data=g.getImageData(0,0,309,412).data;
  let whitePerimeterPixels=0;for(let y=0;y<412;y++)for(let x=0;x<309;x++){if(x!==0&&x!==308&&y!==0&&y!==411)continue;const p=(y*309+x)*4;if(data[p]>40&&data[p+1]>40&&data[p+2]>40)whitePerimeterPixels++;}
  Object.assign(report,{pass:maxPlaneDrift<.03&&backwardSteps===0&&noOuterFrame&&whitePerimeterPixels===0&&samples[179].w>samples[0].w+10,frames:samples.length,maxPlaneDrift,backwardSteps,noOuterFrame,whitePerimeterPixels,start:samples[0],peak:samples[179],end:samples.at(-1)});
 }catch(error){report.pass=false;report.error=String(error);}
 const out=document.createElement('pre');out.id='empty-layout-result';out.style.cssText='position:fixed;top:60px;left:8px;max-height:140px;max-width:95vw;overflow:auto;z-index:999999;background:#111e;color:white;font-size:10px';out.textContent=JSON.stringify(report,null,2);document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
