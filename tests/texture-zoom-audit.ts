void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'photo-texture-slow-zoom',ua:navigator.userAgent};
 try{
  let photo:SVGSVGElement|null=null;
  for(let i=0;i<600;i++){photo=document.querySelector('[data-classic-photo]');if(photo?.querySelector('image')?.getAttribute('href'))break;await wait();}
  if(!photo)throw Error('Photo did not mount');await wait(15);
  const texture=document.querySelector<SVGSVGElement>('[data-pattern-vector]')!,workspace=texture.closest<HTMLElement>('[data-grid-preview-viewport]')!;
  const page=texture.closest<HTMLElement>('[data-page-id]')!,wr=workspace.getBoundingClientRect();
  const group=photo.querySelector('g g')!;
  const initial=group.getAttribute('transform');
  const touches=(type:string,d:number)=>{const list=type==='touchend'?[]:[new Touch({identifier:51,target:workspace,clientX:wr.left+wr.width/2-d/2,clientY:wr.top+wr.height/2}),new Touch({identifier:52,target:workspace,clientX:wr.left+wr.width/2+d/2,clientY:wr.top+wr.height/2})];workspace.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:list,targetTouches:list,changedTouches:list}));};
  const samples:any[]=[];touches('touchstart',40);for(let i=0;i<20;i++){touches('touchmove',200);await wait();}
  for(let i=0;i<720;i++){touches('touchmove',200-(i<360?i:719-i)*.43);await wait();
   const a=page.getBoundingClientRect(),b=texture.getBoundingClientRect(),image=photo.querySelector('g g > image')!.getBoundingClientRect();
   samples.push({width:a.width,centerX:a.x+a.width/2,centerY:a.y+a.height/2,drift:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y),Math.abs(a.width-b.width),Math.abs(a.height-b.height)),photoX:(image.x-a.x)/a.width,photoY:(image.y-a.y)/a.height,photoW:image.width/a.width,photoH:image.height/a.height,matrix:group.getAttribute('transform')});
  }
  touches('touchend',0);await wait(4);
  const drift=Math.max(...samples.map(s=>s.drift)),relativeDrift=Math.max(...samples.flatMap(s=>['photoX','photoY','photoW','photoH'].map(k=>Math.abs(s[k]-samples[0][k]))));
  const backwards=samples.slice(1).filter((s,i)=>i<359?s.width>samples[i].width+.001:i>359&&s.width<samples[i].width-.001).length;
  const centerJitter=Math.max(...['centerX','centerY'].map(key=>Math.max(...samples.map(s=>s[key]))-Math.min(...samples.map(s=>s[key]))));
  Object.assign(report,{pass:drift<.03&&relativeDrift<.0001&&centerJitter<.0002&&backwards===0&&samples.every(s=>s.matrix===initial),frames:samples.length,drift,relativeDrift,centerJitter,backwards,matrixStable:samples.every(s=>s.matrix===initial),start:samples[0].width,end:samples.at(-1).width});
 }catch(e){report.pass=false;report.error=String(e);}
 const out=document.createElement('pre');out.id='texture-zoom-result';out.style.cssText='position:fixed;top:60px;left:8px;z-index:999999;background:#111d;color:white;font-size:10px;max-width:95vw';out.textContent=JSON.stringify(report,null,2);document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
