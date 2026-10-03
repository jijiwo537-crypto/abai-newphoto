/** Real editor: nine-cell feathering, SVG chrome and live preview pinch. */
void(async()=>{
 const next=()=>new Promise<number>(r=>requestAnimationFrame(r));
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await next();};
 const params=new URLSearchParams(location.search),stress=params.has('stress');
 const report:any={kind:stress?'creative-v8-stress':'creative-v8',run:location.search,ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount===(stress?'9':'2')&&stage.querySelector('canvas')?.width)break;await wait(1);}await wait(25);
  if(!stage)throw Error('Missing stage');const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!;
  if(!stress){
   document.querySelector<HTMLButtonElement>('[aria-label="所有圖片佈局"]')!.click();await wait();
   document.querySelector<HTMLButtonElement>('[data-layout-count="9"][data-layout-index="0"]')!.click();await wait();
   document.querySelector<HTMLButtonElement>('[aria-label="返回圖片排版"]')!.click();await wait();
   check('seven blank slots remain independently clickable',document.querySelectorAll('[data-photo-cell] button').length===7);
   check('blank labels and plus share one vector scene',document.querySelectorAll('svg[data-photo-cell-chrome] [data-empty-prompt]').length===7);
   check('all pluses are closed filled paths without overlap strokes',[...document.querySelectorAll('[data-empty-plus]')].every(p=>p.getAttribute('d')?.endsWith('Z')&&!p.hasAttribute('stroke')));
   check('minimum-size labels use 8px scene units',[...document.querySelectorAll('[data-empty-label]')].every(p=>p.getAttribute('font-size')==='8'));
   const lines=[...document.querySelectorAll('[data-empty-separator]')].map(l=>['x1','y1','x2','y2'].map(k=>l.getAttribute(k)).join('|'));
   check('empty cells share unique dashed separators',lines.length===8&&new Set(lines).size===8,lines);
  }
  document.querySelector<HTMLButtonElement>('button[title="更多"]')!.click();await wait();
  const menu=document.querySelector<HTMLElement>('[aria-label="創意拼圖更多選項"]')!;
  check('more popup restores flat old-style rows on a darker surface',getComputedStyle(menu).backgroundColor==='rgb(16, 16, 16)'&&!menu.querySelector('.premium-glass-button'));
  const menutop=menu.getBoundingClientRect().top;
  document.querySelector<HTMLButtonElement>('[data-creative-export-options-toggle]')!.click();await wait();
  const exp=document.querySelector<HTMLElement>('[aria-label="創意拼圖匯出設定"]')!;
  check('more popup aligns with save format popup',Math.abs(menutop-exp.getBoundingClientRect().top)<=1);
  document.querySelector<HTMLButtonElement>('[data-creative-export-options-toggle]')!.click();await wait();
  const seamSlider=document.querySelector<HTMLInputElement>('[data-creative-seamless] input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(seamSlider,'2');seamSlider.dispatchEvent(new Event('input',{bubbles:true}));seamSlider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));await wait(15);
  // Solid-color fixture samples stay away from the high-frequency numeral
  // glyphs: CPU and GPU use different, equally valid minification kernels.
  const points=[[.1,.1],[.1,.5],[.43,.43],[.9,.7]],g=canvas.getContext('2d')!;let pixels:number[][]=[];
  window.dispatchEvent(new CustomEvent('qa-render-reference',{detail:(c:HTMLCanvasElement)=>{const rg=c.getContext('2d')!;pixels=points.map(([u,v])=>[...rg.getImageData(Math.round(c.width*u),Math.round(c.height*v),1,1,{colorSpace:'srgb'}).data]);}}));
  const diffs=points.map(([u,v],idx)=>{
   const a=g.getImageData(Math.round(canvas.width*u),Math.round(canvas.height*v),1,1,{colorSpace:'srgb'}).data;
   const b=pixels[idx];
   return {delta:Math.max(...[0,1,2].map(i=>Math.abs(a[i]-b[i]))),a:[...a],b:[...b]};
  });check('cached originals preserve feather colors relative to export',diffs.every(n=>n.delta<=4),{diffs,viewport:canvas.dataset.viewport,full:canvas.dataset.fullSize,size:[canvas.width,canvas.height]});
  const builds=Number(canvas.dataset.featherBuilds||0),s=stage.getBoundingClientRect(),cr=canvas.getBoundingClientRect();
  const yy=Math.min(s.bottom-3,cr.bottom+8),mid=(s.left+s.right)/2,span=Math.min(s.width*.15,60);
  const pointer=(type:string,id:number,x:number)=>stage!.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:yy,buttons:type==='pointerup'?0:1}));
  const prompt=document.querySelector<SVGGraphicsElement>('[data-empty-prompt]'),local=prompt?.getAttribute('transform');
  pointer('pointerdown',801,mid-span);await next();pointer('pointerdown',802,mid+span);await next();
  const frames:number[]=[],paintStart=Number(canvas.dataset.paintCount||0);let previous=await next(),drift=0;
  for(let i=0;i<120;i++){
   const d=span*(1.55+.55*Math.sin(i*.045));pointer('pointermove',801,mid-d);pointer('pointermove',802,mid+d);
   const time=await next();frames.push(time-previous);previous=time;
   if(prompt){const m=prompt.getScreenCTM()!,svg=prompt.ownerSVGElement!.getScreenCTM()!;const relative=m.a/svg.a;const initial=Number(local!.match(/scale\(([^)]+)\)/)![1]);drift=Math.max(drift,Math.abs(relative-initial));}
  }
  const live=canvas.parentElement!.getBoundingClientRect();pointer('pointerup',801,mid-span);pointer('pointerup',802,mid+span);await wait();
  const settled=canvas.parentElement!.getBoundingClientRect(),fps=120000/frames.reduce((a,b)=>a+b,0);
  report.metrics={fps,mode:canvas.dataset.featherMode,nativeBytes:Number(canvas.dataset.featherBytes),viewportBuilds:Number(canvas.dataset.viewportFeatherBuilds||0),frameP95:[...frames].sort((a,b)=>a-b)[114],paints:Number(canvas.dataset.paintCount||0)-paintStart,buildsBefore:builds,buildsAfter:Number(canvas.dataset.featherBuilds||0),drift};
  if(canvas.dataset.featherMode==='native')check('pinching does not rebuild native-resolution feather masks',builds>0&&Number(canvas.dataset.featherBuilds||0)===builds,report.metrics);
  else check('large originals use bounded physical-pixel surfaces without downsampling',canvas.dataset.featherMode==='viewport'&&report.metrics.viewportBuilds>0,report.metrics);
  check('all 120 live preview frames repaint',report.metrics.paints>=120,report.metrics);
  if(/iPhone/.test(navigator.userAgent))check('iPhone seamless pinch sustains at least 50fps',fps>=50,report.metrics);
  check('empty chrome uses the exact scene matrix',drift<1e-7&&(!prompt||prompt.getAttribute('transform')===local),{drift});
  check('release preserves live position and dimensions',Math.max(Math.abs(live.x-settled.x),Math.abs(live.y-settled.y),Math.abs(live.width-settled.width),Math.abs(live.height-settled.height))<.1);
  if(params.has('proof')){
   pointer('pointerdown',803,mid-span);pointer('pointerdown',804,mid+span);
   pointer('pointermove',803,mid-span*.03);pointer('pointermove',804,mid+span*.03);
   pointer('pointerup',803,mid-span*.03);pointer('pointerup',804,mid+span*.03);await wait(15);
   document.querySelector<HTMLButtonElement>('button[title="更多"]')!.click();await wait();
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 if(!params.has('proof')){const pre=document.createElement('pre');pre.id='creative-v8-result';pre.style.cssText='position:fixed;top:65px;left:8px;z-index:999999;max-height:180px;overflow:auto;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
