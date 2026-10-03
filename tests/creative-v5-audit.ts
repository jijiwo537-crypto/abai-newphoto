/** Mounted production renderer, including pixel checks on real mobile WebKit. */
void(async()=>{
 const wait=async(n=3)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'creative-v5',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const click=(name:string)=>{const b=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);if(!b)throw Error('Missing '+name);b.click();};
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<400;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.querySelector('canvas')?.width)break;await wait(1);}await wait(25);
  const canvas=stage!.querySelector('canvas')!,g=canvas.getContext('2d')!;
  const pixel=(u:number,v:number)=>[...g.getImageData(Math.round(canvas.width*u),Math.round(canvas.height*v),1,1,{colorSpace:'srgb'}).data];
  const point=(u:number,v:number)=>{const r=canvas.getBoundingClientRect();return {x:r.left+r.width*u,y:r.top+r.height*v};};
  const pointer=(type:string,id:number,p:{x:number;y:number})=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
  // Compare choice gaps against the actual header border, not the pill's bottom.
  click('儲存');await wait(15);
  const choices=[...document.querySelectorAll<HTMLButtonElement>('button')].filter(b=>/^儲存[圖片影片]{2}$/.test(b.textContent?.trim()||''));
  const header=document.querySelector('header')!.getBoundingClientRect(),r0=choices[0].getBoundingClientRect(),r1=choices[1].getBoundingClientRect();
  check('save choices have equal header and inter-button gaps',Math.abs((r0.top-header.bottom)-(r1.top-r0.bottom))<1,{headerGap:r0.top-header.bottom,choiceGap:r1.top-r0.bottom});click('儲存');await wait();
  const spacers=document.querySelectorAll('header div[aria-hidden=true]');check('top dividers retain two original spacing slots',spacers.length===2&&[...spacers].every(s=>Math.abs(s.getBoundingClientRect().width-1)<.1));
  if(new URLSearchParams(location.search).has('four')){
   document.querySelector<HTMLButtonElement>('[data-photo-template="5"]')!.click();await wait(10);
   const p=point(.42,.12),before=pixel(.42,.12);
   pointer('pointerdown',801,p);await new Promise(r=>setTimeout(r,340));await wait(4);const dim=pixel(.42,.12);
   check('overlapping blue photo darkens without exposing lower red photo',before[2]>200&&dim[3]===255&&dim[0]<60&&dim[2]>dim[0]*2&&dim[2]<before[2]*.5,{before,dim});pointer('pointerup',801,p);await wait();
   // Deselect by tapping a different cell, then choose the lower background only on release.
   const other=point(.75,.15);pointer('pointerdown',802,other);pointer('pointerup',802,other);await wait();
   document.querySelector<HTMLButtonElement>('[data-photo-template="0"]')!.click();await wait();
   const a=point(.1,.1),b=point(.9,.9),beforeRect=canvas.getBoundingClientRect(),beforePhotos=stage!.dataset.photoTransforms;
   pointer('pointerdown',803,a);pointer('pointerdown',804,b);pointer('pointermove',804,point(1.05,1.05));await wait(4);
   check('unselected full-photo canvas pinch changes preview, not photo crop',canvas.getBoundingClientRect().width>beforeRect.width&&stage!.dataset.photoTransforms===beforePhotos);
   pointer('pointerup',804,b);pointer('pointerup',803,a);await wait();
  }else{
   document.querySelector<HTMLButtonElement>('[data-creative-tab="motion"]')!.click();await wait(30);click('圖案');click('淡入');await wait(5);
   const holes=JSON.parse(stage!.dataset.patternStamps!).filter((h:any)=>h.id!=='absent');
   const orders:any={'左至右':['left','middle','right'],'右至左':['right','middle','left'],'上至下':['right','left','middle'],'下至上':['middle','left','right']};
   for(const [direction,expected]of Object.entries(orders)){
    click(direction);await wait(5);const appeared=new Map<string,number>();
    for(let t=0;t<=5;t+=.025){window.dispatchEvent(new CustomEvent('qa-render-reference',{detail:{time:t,read:(c:HTMLCanvasElement)=>{
     const ctx=c.getContext('2d')!;for(const h of holes){const p=ctx.getImageData(Math.round(c.width*h.x/900),Math.round(c.height*h.y/600),1,1,{colorSpace:'srgb'}).data;if(p[1]>90&&!appeared.has(h.id))appeared.set(h.id,t);}
    }}}));}
    const ids=[...appeared].sort((a,b)=>a[1]-b[1]).map(([id])=>id);
    check('actual rendered entrance '+direction,JSON.stringify(ids)===JSON.stringify(expected),{ids,appeared:[...appeared]});
   }
   // Capture only group-flash strokeRect calls, not geometry or cached artwork.
   const original=CanvasRenderingContext2D.prototype.strokeRect;let flashes=0;
   CanvasRenderingContext2D.prototype.strokeRect=function(...args:any[]){if(this.getLineDash().length===2)flashes++;return original.apply(this,args as any);};
   try{click('圖案');await wait(1);let min=Infinity;for(let i=0;i<8;i++){flashes=0;window.dispatchEvent(new CustomEvent('qa-full-repaint',{detail:{time:0}}));min=Math.min(min,flashes);await wait(1);}check('faded entrance keeps frames for real patterns and excludes absent mask pattern',min===3,{min});}
   finally{CanvasRenderingContext2D.prototype.strokeRect=original;}
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.id='creative-v5-result';pre.style.cssText='position:fixed;top:65px;left:8px;z-index:999999;max-height:220px;overflow:auto;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
