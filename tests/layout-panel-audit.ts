// Exercise mounted editor controls on desktop and native iPhone WebKit.
const frame=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
const button=(root:Element,label:string)=>Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===label)!;
const metrics=(root:Element)=>Array.from(root.querySelectorAll('button')).slice(0,7).map(b=>{
  const r=b.getBoundingClientRect(),s=getComputedStyle(b);return{x:r.x,y:r.y,w:r.width,h:r.height,radius:s.borderRadius,border:s.borderWidth};
});
void(async()=>{
  let report:any={kind:'layout-panel-shape-toggle',ua:navigator.userAgent,scenario:location.search};
  try{
    while(!document.querySelector('[data-page-ratio-panel]'))await frame();await frame(25);
    const pagePanel=document.querySelector('[data-page-ratio-panel]')!,pageMetrics=metrics(pagePanel);
    const layout=()=>document.querySelector<HTMLElement>('[data-layout-id="seam-layout"]')!;
    const aspect=()=>{const r=layout().getBoundingClientRect();return r.width/r.height;};
    const initialAspect=aspect();
    // Initial fixture is a legacy saved layout without a ratio field.
    button(pagePanel,'1:1').click();await frame(25);
    const squarePageAspect=aspect();
    document.querySelector<HTMLButtonElement>('button[title="版型比例"]')!.click();await frame(2);
    button(document.querySelector('[data-page-ratio-panel]')!,'9:16').click();await frame(25);
    const tallPageAspect=aspect();
    // Selected disabled layout prewarms original-resolution textures.
    layout().querySelector<HTMLElement>('[data-cell-id]')!.click();await frame(4);
    document.querySelector<HTMLButtonElement>('button[title="佈局調整"]')!.click();await frame(5);
    const editor=document.querySelector<HTMLElement>('[data-layout-editor="true"]')!,layoutMetrics=metrics(editor);
    while(!layout().querySelector('svg[data-seamless-master][data-ready="true"]'))await frame();
    const canvas=layout().querySelector<HTMLCanvasElement>('canvas[data-seamless-layout]')!,uploads=canvas.dataset.sourceUploads;
    const toggle=document.querySelector<HTMLButtonElement>('button[aria-label="無縫拼圖"]')!;
    const times:number[]=[],states:any[]=[];
    for(let i=0;i<8;i++){
      const start=performance.now();toggle.click();await frame();times.push(performance.now()-start);
      states.push({on:toggle.getAttribute('aria-checked'),active:layout().querySelector<SVGSVGElement>('[data-seamless-master]')!.dataset.active,visibility:canvas.style.visibility,same:layout().querySelector('canvas[data-seamless-layout]')===canvas,uploads:canvas.dataset.sourceUploads});
    }
    const bounds=editor.getBoundingClientRect(),scrollRange=Math.max(0,editor.scrollHeight-editor.clientHeight),overflow=getComputedStyle(editor).overflowY;
    const lastBottom=Math.max(...Array.from(editor.querySelectorAll('input,button')).map(n=>n.getBoundingClientRect().bottom));
    button(editor,'2:3').click();await frame(5);button(editor,'橫式').click();await frame(5);
    const explicitAspect=aspect();
    document.querySelector<HTMLButtonElement>('button[title="版型比例"]')!.click();await frame(4);
    button(document.querySelector('[data-page-ratio-panel]')!,'1:1').click();await frame(25);
    const finalAspect=aspect();
    const sameGeometry=pageMetrics.every((m,i)=>Object.keys(m).every(k=>typeof m[k as keyof typeof m]==='number'?Math.abs(Number(m[k as keyof typeof m])-Number(layoutMetrics[i][k as keyof typeof m]))<.1:m[k as keyof typeof m]===layoutMetrics[i][k as keyof typeof m]));
    report={...report,pageMetrics,layoutMetrics,sameGeometry,initialAspect,squarePageAspect,tallPageAspect,explicitAspect,finalAspect,scrollRange,overflow,controlsWithinPanel:lastBottom<=bounds.bottom+.1,toggleMs:times,toggleStates:states,uploads};
    // CSS bounds have 1/64px precision; test ratio within that physical limit.
    report.pass=sameGeometry&&scrollRange===0&&overflow==='hidden'&&lastBottom<=bounds.bottom+.1&&Math.abs(squarePageAspect-initialAspect)<1e-4&&Math.abs(tallPageAspect-initialAspect)<1e-4&&Math.abs(explicitAspect-1.5)<1e-4&&Math.abs(finalAspect-1.5)<1e-4&&states.every((s,i)=>s.on===(i%2?'false':'true')&&s.active===s.on&&s.visibility===(i%2?'hidden':'visible')&&s.same&&s.uploads===uploads);
  }catch(error){report={...report,pass:false,error:String(error)};}
  const out=document.createElement('pre');out.id='layout-panel-result';out.style.cssText='position:fixed;top:65px;left:8px;z-index:999999;background:#111e;color:white;font-size:9px;max-width:95vw;max-height:150px;overflow:auto';out.textContent=JSON.stringify(report,null,2);document.body.append(out);
  await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
