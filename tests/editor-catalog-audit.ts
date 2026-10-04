const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
void(async()=>{
 const checks:{name:string;pass:boolean;detail?:unknown}[]=[];
 const check=(name:string,pass:boolean,detail?:unknown)=>checks.push({name,pass,detail});
 const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(name));
 try{
  for(let i=0;i<500&&!button('特效');i++)await tick();
  button('特效')!.click();for(let i=0;i<10;i++)await tick();
  check('mosaic and glass brick visible',!!button('馬賽克')&&!!button('玻璃磚'));
  check('crystallize removed',!button('結晶化'));
  for(const name of ['馬賽克','玻璃磚']){
   button(name)!.click();for(let i=0;i<12;i++)await tick();
   check(name+' exposes usable slider',Array.from(document.querySelectorAll<HTMLInputElement>('input[type=range]')).some(r=>!r.disabled&&Number(r.max)>Number(r.min)));
   const back=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.title==='返回特效');back?.click();
   for(let i=0;i<4;i++)await tick();
  }
 }catch(e){check('exception',false,String(e));}
 const report={kind:'editor-catalog-v27',route:location.search,pass:checks.every(c=>c.pass),checks};
 const out=document.createElement('pre');out.id='editor-catalog-result';out.dataset.report=JSON.stringify(report);out.hidden=true;document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
