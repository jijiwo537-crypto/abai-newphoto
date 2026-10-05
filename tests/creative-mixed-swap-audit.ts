void(async()=>{
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r())),wait=async(n=3)=>{while(n--)await frame();};
 const report:any={kind:'creative-mixed-swap',checks:[],samples:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoObjects&&JSON.parse(stage.dataset.photoObjects).length)break;await frame();}await wait(50);
  if(!stage)throw Error('missing stage');const cv=stage.querySelector('canvas')!;
  const objects=()=>JSON.parse(stage!.dataset.photoObjects!),photos=()=>JSON.parse(stage!.dataset.photoTransforms!);
  const objectPoint=()=>{const o=objects()[0],g=JSON.parse(stage!.dataset.sceneGeometry!),r=cv.parentElement!.getBoundingClientRect();return {x:r.left+(o.x+o.w/2)/g.cw*r.width,y:r.top+(o.y+o.h/2)/g.ch*r.height};};
  const cellPoint=()=>{const r=document.querySelector('[data-photo-cell="0"]')!.getBoundingClientRect();return {x:r.x+r.width*.2,y:r.y+r.height*.2};};
  const pointer=(type:string,p:{x:number;y:number},id:number)=>cv.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
  for(let i=0;i<6;i++){
   const from=i%2?objectPoint():cellPoint(),to=i%2?cellPoint():objectPoint(),old=objects()[0],before=photos()[0],id=8000+i;
   pointer('pointerdown',from,id);await new Promise(r=>setTimeout(r,350));await wait(2);
   check('hold thumbnail '+i,!!document.querySelector('[data-creative-swap-thumbnail]'));
   pointer('pointermove',to,id);await wait(2);const start=performance.now();pointer('pointerup',to,id);await frame();
   const releasedMs=performance.now()-start;
   const next=objects()[0],photo=photos()[0];
   check('swap on first frame '+i,next.src===before.src&&photo.src===old.src,{next,photo});
   const image=new Image();image.src=next.src;await image.decode();
   check('new source aspect preserved '+i,Math.abs(next.w/next.h-image.naturalWidth/image.naturalHeight)<1e-8);
   check('centre and area preserved '+i,Math.abs(next.x+next.w/2-old.x-old.w/2)<1e-8&&Math.abs(next.y+next.h/2-old.y-old.h/2)<1e-8&&Math.abs(next.w*next.h-old.w*old.h)<1e-6);
   report.samples.push({kind:'mixed swap first frame',ms:releasedMs});await wait(4);
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
