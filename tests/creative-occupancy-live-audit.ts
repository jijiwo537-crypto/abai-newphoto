void(async()=>{
 const tick=()=>new Promise(r=>requestAnimationFrame(r)),wait=async(n=3)=>{while(n--)await tick();};
 const report:any={kind:'occupancy-live-v58',checks:[]};
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}await wait(30);
  const input=document.querySelector<HTMLInputElement>('[data-creative-occupancy] input')!;
  const cv=stage!.querySelector<HTMLCanvasElement>('canvas')!;
  const sample=document.createElement('canvas');sample.width=120;sample.height=120;const g=sample.getContext('2d')!;
  const pixels=()=>{g.clearRect(0,0,120,120);g.drawImage(cv,0,0,120,120);return g.getImageData(0,0,120,120).data;};
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  for(const value of [5,80,20,60]){
   input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:581,pointerType:'touch'}));
   setter.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));await wait(4);
   const held=pixels();input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:581,pointerType:'touch'}));await wait(10);
   const final=pixels(),delta=held.reduce((s,v,i)=>s+Math.abs(v-final[i]),0)/held.length;
   report.checks.push({value,delta,pass:delta<.5});
  }
  sample.width=sample.height=1;report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const el=document.createElement('pre');el.id='occupancy-live-result';el.dataset.report=JSON.stringify(report);el.hidden=true;document.body.append(el);
})();
