void(async()=>{
 const tick=()=>new Promise<number>(r=>requestAnimationFrame(r)),wait=async(n=3)=>{while(n--)await tick();};
 const report:any={kind:'layout-source-raster-zoom',checks:[],frames:[]};
 try{
  const seamless=!new URLSearchParams(location.search).has('off'),selector=seamless?'[data-seamless-layout]':'[data-layout-photo-surface]';
  let root:HTMLElement|null=null,cv:HTMLCanvasElement|null=null;
  for(let n=0;n<300;n++){root=document.querySelector('[data-layout-id="seam-layout"]');cv=root?.querySelector(selector)||null;if(cv&&cv.width>100)break;await tick();}await wait(15);
  if(!root||!cv)throw Error('missing layout');
  const source=cv.dataset.sourceUploads||cv.dataset.sourceKeys;
  const workspace=root.closest<HTMLElement>('[data-grid-preview-viewport]')!,wr=workspace.getBoundingClientRect();
  const touches=(type:string,d:number)=>{const list=type==='touchend'?[]:[new Touch({identifier:1,target:workspace,clientX:wr.left+wr.width/2-d/2,clientY:wr.top+wr.height/2}),new Touch({identifier:2,target:workspace,clientX:wr.left+wr.width/2+d/2,clientY:wr.top+wr.height/2})];workspace.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:list,targetTouches:list,changedTouches:list}));};
  touches('touchstart',80);
  let previous=await tick();
  for(let i=0;i<80;i++){
   const paint=Number(cv.dataset.paintCount||0);touches('touchmove',80+(i<40?i:80-i)*2);const t=await tick(),b=cv.getBoundingClientRect();
   const probe=root.querySelector<SVGSVGElement>(seamless?'[data-seamless-master]':'[data-layout-photo-plane]')!,pb=probe.getBoundingClientRect();
   report.frames.push({ms:t-previous,w:b.width,h:b.height,pw:cv.width,ph:cv.height,paint:Number(cv.dataset.paintCount||0)-paint,layoutW:pb.width});previous=t;
  }
  touches('touchend',0);await wait();
  const check=(name:string,pass:boolean)=>report.checks.push({name,pass});
  check('every zoom frame resamples the original sources',report.frames.slice(1).every((f:any)=>f.paint>0));
  check('constant physical pixel density at every scale',report.frames.every((f:any)=>Math.abs(f.pw/f.w-devicePixelRatio)<.025&&Math.abs(f.ph/f.h-devicePixelRatio)<.025));
  check('zoom never reprocesses or reloads photograph effects',(cv.dataset.sourceUploads||cv.dataset.sourceKeys)===source);
  check('slow continuous zoom without geometry reversals',report.frames.slice(2,39).every((f:any,i:number)=>f.layoutW>=report.frames[i+1].layoutW-.01));
  const sampling=document.createElement('canvas');sampling.width=cv.width;sampling.height=cv.height;const ctx=sampling.getContext('2d')!;ctx.drawImage(cv,0,0);const pixels=ctx.getImageData(0,0,cv.width,cv.height).data;let holes=0;for(let y=3;y<cv.height-3;y++)for(let x=3;x<cv.width-3;x++)if(pixels[(y*cv.width+x)*4+3]!==255)holes++;
  // Radius/gap are explicitly zero in this fixture; all interior pixels must
  // belong to exactly one photo, including fractional three-photo junctions.
  check('no transparent photo junctions',holes===0);sampling.width=sampling.height=1;
  report.holes=holes;report.fps=1000/(report.frames.reduce((s:number,f:any)=>s+f.ms,0)/report.frames.length);report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const out=document.createElement('pre');out.id='layout-raster-result';out.dataset.report=JSON.stringify(report);out.style.cssText='position:fixed;top:65px;left:8px;z-index:999999;color:white;background:#101010e8;font-size:10px;padding:6px;pointer-events:none';out.textContent=`佈局原始照片縮放：${report.pass?'PASS':'FAIL'}\n${report.fps?.toFixed(1)} fps／透明縫隙 ${report.holes}\n${report.checks.filter((c:any)=>!c.pass).map((c:any)=>c.name).join('\n')}${report.error||''}`;document.body.append(out);
})();
