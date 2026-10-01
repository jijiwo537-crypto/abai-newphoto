// Real mounted dense controls and the installed pointer proxy, with
// synthetic sub-pixel events. No physical-touch claim.
export async function auditFineSlider(){
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n=5)=>{for(let i=0;i<n;i++)await frame();};
 const click=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes(label))!.click();
 while(![...document.querySelectorAll('button')].some(b=>b.textContent?.includes('特效')))await frame();
 await wait(20);click('特效');await wait();
 (document.querySelector('[data-fx-tool=fxExposureSpill]') as HTMLElement).click();await wait(20);
 document.querySelector<HTMLElement>('[data-fx-tool=fxExposureSpill] [aria-label="調整細項"]')!.click();await wait(20);
 const sliders=[...document.querySelectorAll<HTMLInputElement>('input[data-fine-drag]')],results=[];
 for(const el of sliders){
  const r=el.getBoundingClientRect(),min=+el.min,max=+el.max,start=+el.value,x=r.left+9+(start-min)/(max-min)*(r.width-18),y=r.top+r.height/2;
  const wrap=el.parentElement!,values=[];
  wrap.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:91,pointerType:'touch',clientX:x,clientY:y}));
  for(let i=0;i<16;i++){window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:91,pointerType:'touch',clientX:x+i,clientY:y}));values.push(+el.value);await frame();}
  window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:91,pointerType:'touch',clientX:x+15,clientY:y}));await wait();
  results.push({start,values,final:el.value,step:el.step,jump:Math.max(...values.slice(1).map((v,i)=>Math.abs(v-values[i])))});
 }
 const report={kind:'editor-fine-sliders',ua:navigator.userAgent,results,passed:sliders.length===4&&results.every(r=>r.jump<=1&&r.values[0]===r.start&&r.values.at(-1)!==r.start)};
 (window as any).__fineSliderAudit=report;
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 const out=document.createElement('pre');out.textContent=JSON.stringify(report,null,2);Object.assign(out.style,{position:'fixed',inset:'80px 8px',background:'#000d',color:'white',fontSize:'12px',zIndex:99999});document.body.append(out);
}
