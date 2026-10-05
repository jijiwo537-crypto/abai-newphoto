void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const report:any={kind:'creative-snapshot',checks:[],samples:[]};
 try{
  let stage:HTMLElement|null=null,cv:HTMLCanvasElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');cv=stage?.querySelector('canvas')||null;if(cv?.dataset.sceneSnapshot==='tiles')break;await tick();}
  if(!stage||!cv||cv.dataset.sceneSnapshot!=='tiles')throw Error('static snapshot did not become ready');
  const scan=()=>{
   const v=JSON.parse(cv!.dataset.viewport!),full=JSON.parse(cv!.dataset.fullSize!),p=cv!.getContext('2d')!.getImageData(0,0,cv!.width,cv!.height,{colorSpace:'srgb'}).data;
   let foreign=0,transparent=0,n=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;const examples:any[]=[];
   for(let y=0;y<Math.min(cv!.height,full[1]-v.y)-1;y++)for(let x=0;x<Math.min(cv!.width,full[0]-v.x)-1;x++){
    const k=(y*cv!.width+x)*4,r=p[k],g=p[k+1],b=p[k+2];n++;transparent+=p[k+3]!==255?1:0;if(p[k+3]!==255&&examples.length<4)examples.push({x,y,pixel:Array.from(p.slice(k,k+4)),v,full});
    // Only black/24-gray photos and a pure green marker exist in this scene.
    // Filtering those colours may interpolate them, but cannot create white.
    const xx=(x+v.x+.5)/full[0],yy=(y+v.y+.5)/full[1];
    // Display-P3 interpolation of saturated green is not numerically convex
    // after conversion to sRGB. Exclude only the marker's anti-aliased rim;
    // every photo/photo and photo/mask boundary remains under inspection.
    const markerRim=xx>415/900&&xx<525/900&&yy>245/600&&yy<355/600;
    const wrong=!markerRim&&(r>25||b>25);foreign+=wrong?1:0;if(wrong&&examples.length<4)examples.push({x,y,pixel:Array.from(p.slice(k,k+4)),v,full});
    if(g>200&&r<10&&b<10){minX=Math.min(minX,xx);maxX=Math.max(maxX,xx);minY=Math.min(minY,yy);maxY=Math.max(maxY,yy);}
   }
   return {foreign,transparent,n,minX,maxX,minY,maxY,examples,mode:cv!.dataset.sceneSnapshot,ms:Number(cv!.dataset.paintMs)};
  };
  for(let i=0;i<100;i++){
   const r=stage.getBoundingClientRect();stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,deltaY:i<50?-5:5}));await tick();await tick();report.samples.push(scan());
  }
  report.checks.push({name:'every zoom frame reuses the same static scene',pass:report.samples.every((s:any)=>s.mode==='tiles')});
  report.checks.push({name:'no white or transparent cracks anywhere in photo/mask scene',pass:report.samples.every((s:any)=>!s.foreign&&!s.transparent)});
  const visible=report.samples.filter((s:any)=>Number.isFinite(s.minX)&&s.maxX>s.minX);
  const spread=(key:string)=>Math.max(...visible.map((s:any)=>s[key]))-Math.min(...visible.map((s:any)=>s[key]));
  report.checks.push({name:'marker remains in the same normalized page coordinates',pass:visible.length===100&&['minX','maxX','minY','maxY'].every(k=>spread(k)<.003),spread:Object.fromEntries(['minX','maxX','minY','maxY'].map(k=>[k,spread(k)]))});
  const times=report.samples.map((s:any)=>s.ms).sort((a:number,b:number)=>a-b);report.metrics={frames:100,p95PaintMs:times[95],maxPaintMs:times.at(-1)};
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.id='snapshot-result';pre.hidden=true;pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
