void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const checks:any[]=[],check=(name:string,pass:boolean,detail?:any)=>checks.push({name,pass,detail});
 try{
  for(let i=0;i<600&&!document.querySelector('[data-classic-photo] image[href]');i++)await wait();await wait(25);
  const page=document.querySelector<HTMLElement>('[data-page-id]')!,photo=document.querySelector<SVGSVGElement>('[data-classic-photo]')!;
  const rect=()=>{const r=page.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
  const initial=rect(),source=photo.querySelector('g g > image')!.getAttribute('href');
  const snapshots:any[]=[];
  for(let i=0;i<6;i++)for(const mode of ['頁面順序','動畫']){
   document.querySelector<HTMLButtonElement>(`button[title="${mode}"]`)!.click();await wait(30);
   check(`${mode} ${i+1} keeps original decoded image`,photo.querySelector('g g > image')!.getAttribute('href')===source);
   document.querySelector<HTMLButtonElement>('button[title="版型比例"]')!.click();await wait(30);snapshots.push(rect());
  }
  const drift=Math.max(...snapshots.flatMap(s=>Object.keys(initial).map(key=>Math.abs(s[key]-initial[key]))));
  check('12 mode round-trips return to the identical preview pose',drift<.03,{drift,initial,final:snapshots.at(-1)});
  check('all source textures remain decoded',!!source&&!!photo.querySelector('image[href]'));
 }catch(e){check('runtime exception',false,String(e));}
 const report={kind:'classic-mode-pose-v19',ua:navigator.userAgent,pass:checks.every(c=>c.pass),checks};
 const pre=document.createElement('pre');pre.id='mode-result';pre.dataset.report=JSON.stringify(report);pre.style.cssText='position:fixed;top:60px;left:8px;max-height:240px;overflow:auto;z-index:999999;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
