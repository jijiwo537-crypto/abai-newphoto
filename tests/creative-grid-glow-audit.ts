void(async()=>{
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n:number)=>{while(n--)await frame();};
 const report:any={kind:'creative-grid-glow',checks:[],samples:[]};
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.querySelector('canvas'))break;await frame();}
  if(!stage)throw Error('missing scene');await wait(90);
  const cv=stage.querySelector<HTMLCanvasElement>('canvas')!;
  for(let i=0;i<12;i++){
   // Fixture coordinates are logical scene coordinates, not DOM order.
   const cutout=new URLSearchParams(location.search).has('solid')&&i>=10;
   const b=cv.parentElement!.getBoundingClientRect(),x=b.left+((cutout?45:100)+i%4*210)/900*b.width,y=b.top+((cutout?45:90)+Math.floor(i/4)*180)/600*b.height;
   for(const type of ['pointerdown','pointerup'])cv.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:911,clientX:x,clientY:y,buttons:type==='pointerup'?0:1}));
   await wait(5);document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(6);
   if(stage.dataset.selectedObject!==`glow-${i}`)throw Error('wrong selected shape '+i+': '+stage.dataset.selectedObject);
   const row=Array.from(document.querySelectorAll('span')).find(e=>e.textContent==='發光')?.parentElement?.parentElement;
   const slider=row?.querySelector<HTMLInputElement>('input[type="range"]');if(!slider)throw Error('missing glow slider '+i);
   const before=cv.getContext('2d')!.getImageData(0,0,cv.width,cv.height).data;
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'100');
   slider.dispatchEvent(new Event('input',{bubbles:true}));await wait(3);
   const after=cv.getContext('2d')!.getImageData(0,0,cv.width,cv.height).data;
   let changed=0;for(let p=0;p<Math.min(before.length,after.length);p+=4)if(Math.abs(before[p+1]-after[p+1])+Math.abs(before[p+2]-after[p+2])>10)changed++;
   report.samples.push({i,changed});report.checks.push({name:'grid '+i+' glow updates before release',pass:changed>20});
   report.checks.push({name:'grid '+i+' has no opacity control',pass:!Array.from(document.querySelectorAll('span')).some(e=>e.textContent==='透明度')});
  }
  if(!new URLSearchParams(location.search).has('solid')){
   const row=Array.from(document.querySelectorAll('span')).find(e=>e.textContent==='粗細')?.parentElement?.parentElement;
   const input=row?.querySelector<HTMLInputElement>('input[type="range"]');if(!input)throw Error('missing thickness control');
   const positions:number[][]=[];
   for(let v=0;v<=50;v++){
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,String(v));input.dispatchEvent(new Event('input',{bubbles:true}));await wait(2);
    positions.push(Array.from(document.querySelectorAll('[data-stretch-handle] span')).map(e=>{const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2];}).flat());
   }
   const good=positions.every(p=>p.length===8)&&positions.slice(1).every((p,i)=>{
    const old=positions[i];return p.every((value,k)=>Math.abs(value-old[k])<.1)
      &&p[1]<=old[1]+.016&&p[2]>=old[2]-.016&&p[5]>=old[5]-.016&&p[6]<=old[6]+.016;
   });
   report.checks.push({name:'four edge dots follow thickness continuously without reversing or jumping',pass:good});
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.id='grid-glow-result';pre.hidden=true;pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
