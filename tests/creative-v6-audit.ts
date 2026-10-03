/** Actual production component/rendering checks, run on desktop and mobile WebKit. */
void(async()=>{
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'creative-v6',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name)!;
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='4'&&stage.querySelector('canvas')?.width)break;await wait(1);}await wait(25);
  const canvas=stage!.querySelector('canvas')!,g=canvas.getContext('2d')!;
  const pixel=(u:number,v:number)=>[...g.getImageData(Math.round(canvas.width*u),Math.round(canvas.height*v),1,1,{colorSpace:'srgb'}).data];
  button('3:4').click();await wait();check('landscape photo starts with landscape ratio',stage!.dataset.canvasRatio==='4:3');
  document.querySelector<HTMLButtonElement>('[aria-label="滿版"]')!.click();await wait(12);
  check('full layout forces portrait 3:4 even when already selected',stage!.dataset.canvasRatio==='3:4'&&Math.abs(canvas.width/canvas.height-.75)<.002);
  const point=(u:number,v:number)=>{const r=canvas.getBoundingClientRect();return {x:r.left+r.width*u,y:r.top+r.height*v};};
  const pointer=(type:string,id:number,p:{x:number;y:number})=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
  const tap=(id:number,u:number,v:number)=>{const p=point(u,v);pointer('pointerdown',id,p);pointer('pointerup',id,p);};
  document.querySelector<HTMLButtonElement>('[data-photo-template="0"]')!.click();await wait();
  tap(961,.1,.1);await wait();check('first tap selects one photo',stage!.dataset.selectedRegionPhoto==='0');
  tap(962,.9,.1);await wait();check('tap another photo first clears all selection',stage!.dataset.selectedRegionPhoto==='');
  tap(963,.9,.1);await wait();check('following tap selects next photo',stage!.dataset.selectedRegionPhoto==='1');
  document.querySelector<HTMLButtonElement>('[data-photo-template="5"]')!.click();await wait(10);
  const beforeTop=pixel(.42,.18),beforeBottom=pixel(.42,.68),beforeSeam=pixel(.1,.5);
  const seam=document.querySelector<HTMLElement>('[data-creative-seamless]');check('special square layout exposes seamless controls',!!seam);
  seam!.querySelectorAll<HTMLButtonElement>('button')[1].click();await wait(20);
  const afterSeam=pixel(.1,.5);
  check('only large background photos blend',afterSeam[0]>beforeSeam[0]+20&&afterSeam[1]<beforeSeam[1]-20,{beforeSeam,afterSeam});
  check('both foreground square photos remain pixel-identical',JSON.stringify(beforeTop)===JSON.stringify(pixel(.42,.18))&&JSON.stringify(beforeBottom)===JSON.stringify(pixel(.42,.68)),{beforeTop,afterTop:pixel(.42,.18),beforeBottom,afterBottom:pixel(.42,.68)});
  let exported:any,exportSeam:number[]|undefined;
  window.dispatchEvent(new CustomEvent('qa-render-reference',{detail:(c:HTMLCanvasElement)=>{const ctx=c.getContext('2d')!;exported=[.18,.68].map(v=>[...ctx.getImageData(Math.round(c.width*.42),Math.round(c.height*v),1,1,{colorSpace:'srgb'}).data]);exportSeam=[...ctx.getImageData(Math.round(c.width*.1),Math.round(c.height*.5),1,1,{colorSpace:'srgb'}).data];}}));
  check('export keeps foreground photos unchanged too',!!exported&&exported.every((p:number[],i:number)=>p.every((n,j)=>Math.abs(n-[beforeTop,beforeBottom][i][j])<=2)),exported);
  check('export blends the two background halves',!!exportSeam&&exportSeam[0]>beforeSeam[0]+20&&exportSeam[1]<beforeSeam[1]-20,exportSeam);
  document.querySelector<HTMLButtonElement>('[aria-label="所有圖片佈局"]')!.click();await wait();
  const {photoTemplates}=await import('../utils/creativePhotoLayout');
  const additions=[{n:3,name:'上層方形'},{n:3,name:'上層橫式'},{n:3,name:'下層橫式'},{n:4,name:'上下雙層橫式'}];
  check('all four additional layouts are selectable',additions.every(({n,name})=>!!document.querySelector(`[data-layout-count="${n}"][data-layout-index="${photoTemplates(n).findIndex(t=>t.name===name)}"]`)));
  for(const {n,name}of additions){
   const index=photoTemplates(n).findIndex(t=>t.name===name);
   document.querySelector<HTMLButtonElement>(`[data-layout-count="${n}"][data-layout-index="${index}"]`)!.click();await wait(10);
   check('mounted layout '+name,stage!.dataset.photoTemplateIndex===String(index)&&stage!.dataset.photoCount===String(n)&&!!document.querySelector('[data-creative-seamless]'));
   check('picker remains open after '+name,!!document.querySelector('[data-photo-layout-options]'));
  }
  document.querySelector<HTMLButtonElement>('[aria-label="返回圖片排版"]')!.click();await wait();
  document.querySelector<HTMLButtonElement>('button[title="更多"]')!.click();await wait();
  const glass=document.querySelector<HTMLElement>('[aria-label="創意拼圖更多選項"]')!,menuTop=glass.getBoundingClientRect().top;
  check('more menu uses the original flat rows and darker solid surface',getComputedStyle(glass).backgroundColor==='rgb(16, 16, 16)'&&!glass.querySelector('.premium-glass-button'));
  document.querySelector<HTMLButtonElement>('[data-creative-export-options-toggle]')!.click();await wait();
  // The actual menu is attached directly below the header.
  const exportGlass=document.querySelector<HTMLElement>('[aria-label="創意拼圖匯出設定"]')!;
  check('both top menus start at the same height',Math.abs(menuTop-exportGlass.getBoundingClientRect().top)<=1,{more:menuTop,export:exportGlass.getBoundingClientRect().top});
  check('export option buttons retain opaque solid styling',[...exportGlass.querySelectorAll('button')].some(b=>getComputedStyle(b).backgroundColor==='rgb(48, 48, 52)'));
  document.querySelector<HTMLButtonElement>('[data-creative-export-options-toggle]')!.click();await wait();
  document.querySelector<HTMLButtonElement>('[aria-label="遮罩排版 mask-bottom"]')!.click();await wait();button('1:1').click();await wait();
  document.querySelector<HTMLButtonElement>('[aria-label="滿版"]')!.click();await wait(12);
  check('switching from masked layout forces 3:4 as well',stage!.dataset.canvasRatio==='3:4'&&Math.abs(canvas.width/canvas.height-.75)<.002);
  document.querySelector<HTMLButtonElement>('[data-creative-tab="motion"]')!.click();await wait(30);button('圖案').click();button('淡入').click();await wait();
  const p=[...document.querySelectorAll('p')].find(p=>p.textContent==='進場方向')!;
  const directions=[...p.nextElementSibling!.querySelectorAll<HTMLButtonElement>('button')];
  check('entrance direction label and random-first order',directions.map(b=>b.textContent?.trim()).join('|')==='隨機|左至右|右至左|上至下|下至上');
  check('default entrance still left to right',directions[1].getAttribute('aria-pressed')==='true');
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.id='creative-v6-result';pre.style.cssText='position:fixed;top:65px;left:8px;z-index:999999;max-height:220px;overflow:auto;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
