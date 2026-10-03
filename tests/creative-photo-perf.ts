/** Mounted editor frame audit. Synthetic input belongs only to this QA fixture. */
void(async()=>{
 const next=()=>new Promise<number>(r=>requestAnimationFrame(r));
 const report:any={kind:'creative-photo-performance',ua:navigator.userAgent,checks:[],metrics:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='9'&&stage.querySelector('canvas')?.width)break;await next();}
  if(!stage)throw Error('No stage');for(let i=0;i<30;i++)await next();
  const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!;
  const pointer=(type:string,id:number,x:number,y:number)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerup'?0:1}));
  const measure=async(name:string,move:(i:number)=>void)=>{
   const intervals:number[]=[],paints:number[]=[];let previous=await next();const start=Number(canvas.dataset.paintCount||0);
   for(let i=0;i<120;i++){move(i);const t=await next();intervals.push(t-previous);previous=t;paints.push(Number(canvas.dataset.paintMs||0));}
   const sorted=[...intervals].sort((a,b)=>a-b),fps=1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),p95=sorted[Math.floor(sorted.length*.95)];
   const detail={name,fps,p95,paintP95:[...paints].sort((a,b)=>a-b)[Math.floor(paints.length*.95)],painted:Number(canvas.dataset.paintCount||0)-start};report.metrics.push(detail);
   check(`${name}: >=50 fps and preview keeps up`,fps>=50&&detail.painted>=110,detail);
  };
  const r=canvas.getBoundingClientRect(),x=r.left+r.width*.08,y=r.top+r.height*.08;
  pointer('pointerdown',301,x,y);pointer('pointerdown',302,x+r.width*.10,y);pointer('pointermove',302,x+r.width*.20,y);await next();pointer('pointerup',302,x+r.width*.20,y);pointer('pointerup',301,x,y);await next();
  pointer('pointerdown',303,x,y);await measure('selected photo pan',i=>pointer('pointermove',303,x+Math.sin(i*.08)*20,y+Math.cos(i*.08)*15));pointer('pointerup',303,x,y);await next();
  const seam=document.querySelector<HTMLElement>('[data-creative-seamless]')!,on=seam.querySelectorAll<HTMLButtonElement>('button')[1],off=seam.querySelectorAll<HTMLButtonElement>('button')[0];
  const started=performance.now(),before=Number(canvas.dataset.paintCount||0);on.click();let toggled=0;
  while(Number(canvas.dataset.paintCount||0)===before&&toggled<30){await next();toggled++;}
  check('seam toggle paints within two frames',toggled<=2,{frames:toggled,ms:performance.now()-started});
  pointer('pointerdown',304,x,y);await measure('seamless selected photo pan',i=>pointer('pointermove',304,x+Math.sin(i*.08)*20,y+Math.cos(i*.08)*15));pointer('pointerup',304,x,y);await next();
  const slider=seam.querySelector<HTMLInputElement>('input[type=range]')!,setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  slider.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:305}));
  await measure('fusion slider',i=>{setter.call(slider,String(Math.round((Math.sin(i*.06)+1)*50)));slider.dispatchEvent(new Event('input',{bubbles:true}));});
  slider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:305}));await next();
  const last=Number(canvas.dataset.paintCount||0);off.click();await next();await next();check('seam disable immediately repaints',Number(canvas.dataset.paintCount||0)>last);
  if(new URLSearchParams(location.search).has('zoom')){
    on.click();await next();await next();const s=stage.getBoundingClientRect(),cr=canvas.getBoundingClientRect();
    const yy=Math.min(s.bottom-3,cr.bottom+8),mid=(s.left+s.right)/2,span=Math.min(s.width*.15,60);
    const viewPointer=(type:string,id:number,xx:number)=>stage!.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:xx,clientY:yy,buttons:type==='pointerup'?0:1}));
    viewPointer('pointerdown',306,mid-span);await next();viewPointer('pointerdown',307,mid+span);await next();
    await measure('seamless preview pinch',i=>{const d=span*(1.6+.6*Math.sin(i*.04));viewPointer('pointermove',306,mid-d);viewPointer('pointermove',307,mid+d);});
    const live=canvas.parentElement!.getBoundingClientRect();
    viewPointer('pointerup',306,mid-span);viewPointer('pointerup',307,mid+span);await next();await next();
    const settled=canvas.parentElement!.getBoundingClientRect();
    check('preview release retains exact live scene position and size',Math.max(Math.abs(live.x-settled.x),Math.abs(live.y-settled.y),Math.abs(live.width-settled.width),Math.abs(live.height-settled.height))<.1,{live:{x:live.x,y:live.y,w:live.width,h:live.height},settled:{x:settled.x,y:settled.y,w:settled.width,h:settled.height}});
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(error){report.pass=false;report.error=String(error);}
 const pre=document.createElement('pre');pre.id='creative-performance-result';pre.style.cssText='position:fixed;inset:50px 8px auto;max-height:200px;overflow:auto;z-index:999999;color:white;background:#111e;font-size:11px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
