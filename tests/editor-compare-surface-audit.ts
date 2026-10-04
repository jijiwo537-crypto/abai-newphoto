void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n=8)=>{for(let i=0;i<n;i++)await tick();};
 const checks:any[]=[];
 const button=(s:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(s));
 const visible=()=>Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas')).filter(c=>c.width>500&&getComputedStyle(c).visibility!=='hidden'&&getComputedStyle(c).opacity!=='0').at(-1)!;
 const sample=()=>{const c=visible(),tmp=document.createElement('canvas');tmp.width=32;tmp.height=32;tmp.getContext('2d')!.drawImage(c,0,0,32,32);return Array.from(tmp.getContext('2d')!.getImageData(0,0,32,32).data);};
 try{
  for(let i=0;i<400&&!button('特效');i++)await tick();await wait(30);
  button('特效')!.click();await wait();
  for(const name of ['馬賽克','玻璃磚']){
   button(name)!.click();await wait(30);
   const compare=document.querySelector<HTMLButtonElement>('button[aria-label="前後對比"]')!;
   const before=sample();
   for(let j=0;j<3;j++){
    const r=compare.getBoundingClientRect();
    const event=(type:string)=>compare.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:543,clientX:r.x+r.width/2,clientY:r.y+r.height/2,buttons:type==='pointerdown'?1:0}));
    event('pointerdown');await wait(8);const original=sample();event(j===2?'pointercancel':'pointerup');await wait(8);const after=sample();
    const delta=Math.max(...after.map((v,i)=>Math.abs(v-before[i])));
    checks.push({name:`${name} comparison ${j+1}`,pass:delta<=2&&original.some((v,i)=>Math.abs(v-before[i])>2),delta});
   }
   button('返回特效')?.click();await wait();
  }
 }catch(e){checks.push({name:'exception',pass:false,error:String(e)});}
 const report={kind:'editor-compare-v28',route:location.search,ua:navigator.userAgent,pass:checks.every(c=>c.pass),checks};
 const el=document.createElement('pre');el.id='compare-audit-result';el.dataset.report=JSON.stringify(report);el.hidden=true;document.body.append(el);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
