void(async()=>{
 const checks:any[]=[],check=(name:string,pass:boolean,detail?:any)=>checks.push({name,pass,detail});
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 try{
  let stage:HTMLElement;for(let i=0;i<400;i++){stage=document.querySelector('[data-creative-stage]')!;if(stage?.dataset.sceneGeometry)break;await wait(1);}await wait(12);
  const canvas=stage!.querySelector('canvas')!,o=JSON.parse(stage!.dataset.sceneGeometry!),r=canvas.getBoundingClientRect();
  const x=r.left+(o.ix+o.iw*.2)/o.cw*r.width,y=r.top+(o.iy+o.ih*.2)/o.ch*r.height;
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2441,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerdown'?1:0}));
  await wait(8);document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(8);
  const btn=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(name));
  check('single base opens image editor',!!btn('濾鏡')&&!!btn('調節')&&!!btn('構圖'));
  check('base editor omits shape',!btn('造型'));btn('調節')!.click();await wait();btn('亮度')!.click();await wait();
  const input=Array.from(document.querySelectorAll<HTMLInputElement>('input[type=range]')).find(el=>el.min==='-100')!;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  const pixel=()=>Array.from(canvas.getContext('2d')!.getImageData(Math.round((o.ix+o.iw*.1)*canvas.width/o.cw),Math.round((o.iy+o.ih*.1)*canvas.height/o.ch),1,1).data);
  const before=pixel(),times:number[]=[];
  for(let v=1;v<=20;v++){const t=performance.now();setter.call(input,String(v));input.dispatchEvent(new Event('input',{bubbles:true}));await wait(2);times.push(performance.now()-t);}
  check('single base adjustment updates throughout drag',pixel()[1]>before[1],{before,after:pixel()});
  check('single base slider retains latest value',input.value==='20');
  check('full quality drag timing collected',times.every(Number.isFinite),{meanTwoFrames:times.reduce((a,b)=>a+b)/times.length,maxTwoFrames:Math.max(...times),fxMs:canvas.dataset.regionFxMs,backend:canvas.dataset.regionFxBackend});
 }catch(e){check('exception',false,String(e));}
 const report={kind:'creative-single-edit',ua:navigator.userAgent,pass:checks.every(c=>c.pass),checks};
 const pre=document.createElement('pre');pre.id='single-edit-result';pre.dataset.report=JSON.stringify(report);pre.style.display='none';document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
