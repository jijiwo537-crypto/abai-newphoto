void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const report:any={kind:'camera-return-v34',ua:navigator.userAgent,checks:[],samples:[]};
 try{
  for(let i=0;i<300&&!document.querySelector('[data-camera-main-row]');i++)await tick();
  for(let i=0;i<12;i++){
   document.querySelector<HTMLButtonElement>('[aria-label="開啟特效"]')!.click();await tick();
   document.querySelector<HTMLButtonElement>('[data-camera-effects-back]')!.click();
   const rects=[];
   for(let f=0;f<10;f++){await tick();const el=document.querySelector<HTMLElement>('[aria-label="色溫"]')!,r=el.getBoundingClientRect();rects.push([r.x,r.y,r.width,r.height]);}
   const shift=Math.max(...rects.flatMap(r=>r.map((v,k)=>Math.abs(v-rects[0][k]))));
   report.samples.push({round:i+1,shift});report.checks.push({name:'stable thermostat '+i,pass:shift<.01});
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const pre=document.createElement('pre');pre.hidden=true;pre.id='camera-return-result';pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
