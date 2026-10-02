// Development-only audit: real mounted brush, fixed full-quality canvas.
export async function auditBeauty(){
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const click=(s:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim().endsWith(s))?.click();
 while(!document.querySelector<HTMLCanvasElement>('canvas.beauty-paint')?.width)await frame();
 for(let i=0;i<30;i++)await frame();click('液化');await frame();await frame();
 if(document.querySelectorAll('input[type=range]').length!==2)throw Error('liquify controls not mounted');
 const canvas=document.querySelector<HTMLCanvasElement>('canvas.beauty-paint')!;
 const size=[canvas.width,canvas.height],r=canvas.getBoundingClientRect();
 const periods:number[]=[],processing:number[]=[];
 canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:61,pointerType:'touch',clientX:r.x+r.width*.38,clientY:r.y+r.height*.3}));
 let last=performance.now();
 for(let i=0;i<100;i++){
  await frame();const start=performance.now();if(i>15)periods.push(start-last);last=start;
  window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:61,pointerType:'touch',clientX:r.x+r.width*(.4+.1*Math.sin(i*.05)),clientY:r.y+r.height*(.3+i*.004)}));
  if(i>15)processing.push(performance.now()-start);
  if(canvas.width!==size[0]||canvas.height!==size[1])throw Error('interaction resolution changed');
 }
 window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:61,pointerType:'touch'}));
 await frame();
 const stats=(a:number[])=>{a.sort((a,b)=>a-b);return{median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}};
 const nav=document.querySelector('[data-beauty-toolbar]')!.getBoundingClientRect(),root=document.querySelector('.beauty-root')!.getBoundingClientRect();
 const report={kind:'beauty-liquify',ua:navigator.userAgent,standalone:(navigator as any).standalone===true,size,frame:stats(periods),processing:stats(processing),bottomGap:root.bottom-nav.bottom,viewport:{innerHeight,visual:visualViewport?.height,offset:visualViewport?.offsetTop,root:{top:root.top,bottom:root.bottom,height:root.height},nav:{top:nav.top,bottom:nav.bottom},margin:getComputedStyle(document.querySelector('.beauty-root')!).marginTop},sliders:Array.from(document.querySelectorAll<HTMLInputElement>('input[type=range]')).map(i=>i.value)};
 (window as any).__beautyAudit=report;
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 console.log(JSON.stringify(report));
}
