void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'creative-white-guides-v8',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoObjects?.includes('qa-float-a')&&stage.querySelector('canvas')?.width)break;await wait();}await wait(30);
  const canvas=stage!.querySelector<HTMLCanvasElement>('canvas')!,geo=JSON.parse(stage!.dataset.sceneGeometry!),frame=canvas.parentElement!.getBoundingClientRect();
  const point=(x:number,y:number)=>({x:frame.left+frame.width*x/geo.cw,y:frame.top+frame.height*y/geo.ch});
  const pointer=(type:string,id:number,p:{x:number;y:number})=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
  const a=point(560,265),b=point(60,265);pointer('pointerdown',851,a);pointer('pointerup',851,a);await wait(5);
  pointer('pointerdown',852,a);pointer('pointermove',852,b);await wait(5);
  const line=document.querySelector<SVGLineElement>('[data-creative-alignment-guides] line');
  check('dragging an actual photo to the canvas edge triggers a white 1.6px dashed guide',!!line&&line.getAttribute('stroke')==='white'&&line.getAttribute('stroke-width')==='1.6'&&line.getAttribute('stroke-dasharray')==='6 5'&&line.getAttribute('vector-effect')==='non-scaling-stroke');
  const before=line&&getComputedStyle(line).strokeDashoffset;await wait(8);
  check('the dash phase animates while the photo stays snapped',!!line&&before!==getComputedStyle(line).strokeDashoffset,{before,after:line&&getComputedStyle(line).strokeDashoffset});
  pointer('pointerup',852,b);await wait(5);check('guides clear on release',!document.querySelector('[data-creative-alignment-guides]'));
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
