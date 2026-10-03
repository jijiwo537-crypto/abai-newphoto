/** Mounted preview, picker persistence and ratio-restoration regression checks. */
void(async()=>{
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'creative-v7',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name)!;
 const layout=(name:string)=>document.querySelector<HTMLButtonElement>(`[aria-label="${name==='image-full'?'滿版':'遮罩排版 '+name}"]`)!.click();
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='4'&&stage.querySelector('canvas')?.width)break;await wait(1);}await wait(25);
  // Begin on a masked layout, then test both orientation directions and 3:4 itself.
  layout('mask-bottom');await wait();
  for(const [label,target]of [['1:1','1:1'],['3:4','4:3'],['4:5','5:4'],['16:9','16:9'],['3:4','3:4']]){
   if(stage!.dataset.canvasRatio!==target){button(label).click();await wait();if(stage!.dataset.canvasRatio!==target){button(label).click();await wait();}}
   const original=stage!.dataset.canvasRatio;
   layout('image-full');await wait(8);check('enter full from '+target,stage!.dataset.canvasRatio==='3:4');
   layout('image-full');await wait();layout('mask-top');await wait(8);
   check('leave full restores '+target,stage!.dataset.canvasRatio===original,{original,actual:stage!.dataset.canvasRatio});
  }
  // Existing history and saved draft must include the remembered ratio.
  const historySettled=async()=>{await new Promise(r=>setTimeout(r,650));await wait();};
  button('1:1').click();await historySettled();layout('image-full');await historySettled();layout('mask-bottom');await historySettled();
  // Walk the existing history (which also records generated pattern changes)
  // back to full layout, then verify its remembered ratio survives restoration.
  let undos=0;while(stage!.dataset.canvasRatio!=='3:4'&&undos<3){document.querySelector<HTMLButtonElement>('button[title="復原"]')!.click();undos++;await new Promise(r=>setTimeout(r,300));await wait();}
  check('undo history restores full 3:4',stage!.dataset.canvasRatio==='3:4',{actual:stage!.dataset.canvasRatio,undos});
  layout('mask-top');await wait(8);check('undo preserves original ratio for subsequent exit',stage!.dataset.canvasRatio==='1:1');
  layout('image-full');await wait();await new Promise(r=>setTimeout(r,1200));
  const {loadDraft}=await import('../utils/toolDraft');let draft:any;
  for(let i=0;i<25;i++){draft=await loadDraft();if(draft?.state?.canvasRatio==='3:4'&&draft.state.canvasRatioBeforeFull==='1:1')break;await new Promise(r=>setTimeout(r,200));}
  check('automatic draft stores the pre-full ratio',draft?.state?.canvasRatio==='3:4'&&draft.state.canvasRatioBeforeFull==='1:1',{ratio:draft?.state?.canvasRatio,before:draft?.state?.canvasRatioBeforeFull,tool:draft?.tool});
  document.querySelector<HTMLButtonElement>('[aria-label="所有圖片佈局"]')!.click();await wait();
  const picker=document.querySelector<HTMLElement>('[data-photo-layout-options]')!,scroller=picker.lastElementChild as HTMLElement;
  const choices=[...picker.querySelectorAll<HTMLButtonElement>('[data-layout-count]')];
  const {photoTemplates,regionRects}=await import('../utils/creativePhotoLayout');
  for(const [n,name]of [[3,'上層橫式'],[3,'下層橫式'],[4,'上下雙層橫式']]){
   const i=photoTemplates(n as number).findIndex(t=>t.name===name),b=choices.find(b=>b.dataset.layoutCount===String(n)&&b.dataset.layoutIndex===String(i))!;
   scroller.scrollTop=b.offsetTop;await wait();const top=scroller.scrollTop;b.click();await wait(8);
   check('selection stays in picker '+name,picker.isConnected&&b.getAttribute('aria-pressed')==='true'&&Math.abs(scroller.scrollTop-top)<1,{scroll:scroller.scrollTop,top});
   const scene=JSON.parse(stage!.dataset.sceneGeometry!),r=regionRects({photos:Array.from({length:n as number},()=>({src:'',width:900,height:600})),arrangement:'grid',templateIndex:i},scene.iw,scene.ih);
   check('landscape inset enlarged '+name,r.slice(2).every(r=>Math.abs(r.w*scene.iw/Math.min(scene.iw,scene.ih)-.39936)<1e-8));
  }
  document.querySelector<HTMLButtonElement>('[aria-label="返回圖片排版"]')!.click();await wait();
  for(const name of ['image-full','mask-bottom','mask-top','mask-left','mask-right','mask-around']){
   layout(name);await wait(8);if(stage!.dataset.canvasRatio!=='3:4'){button('3:4').click();await wait();if(stage!.dataset.canvasRatio!=='3:4'){button('3:4').click();await wait();}}
   document.querySelector<HTMLButtonElement>('button[title="更多"]')!.click();await wait();
   const preview=button('預覽');check('3:4 preview is available '+name,!!preview&&preview.getBoundingClientRect().width>0);
   preview.click();for(let i=0;i<400&&!document.querySelector('[data-ig="heart"]');i++)await wait(1);await wait(8);
   const shots=[...document.querySelectorAll<HTMLImageElement>('img')].filter(img=>img.className.includes('object-contain')&&img.naturalWidth>0);
   check('3:4 actual preview opens '+name,!!document.querySelector('[data-ig="heart"]')&&shots.some(img=>Math.abs(img.naturalWidth/img.naturalHeight-.75)<.003),shots.map(img=>({w:img.naturalWidth,h:img.naturalHeight})));
   document.querySelector<HTMLButtonElement>('button[title="關閉視窗"]')!.click();await wait(8);
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 if(!new URLSearchParams(location.search).has('proof')){
  const pre=document.createElement('pre');pre.id='creative-v7-result';pre.style.cssText='position:fixed;top:65px;left:8px;z-index:999999;max-height:220px;overflow:auto;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 }
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 if(report.pass&&new URLSearchParams(location.search).has('proof')){
  layout('image-full');await wait();document.querySelector<HTMLButtonElement>('[aria-label="所有圖片佈局"]')!.click();await wait();
  const {photoTemplates}=await import('../utils/creativePhotoLayout');const i=photoTemplates(4).findIndex(t=>t.name==='上下雙層橫式');
  document.querySelector<HTMLButtonElement>(`[data-layout-count="4"][data-layout-index="${i}"]`)!.click();await wait();
  document.querySelector<HTMLButtonElement>('[aria-label="返回圖片排版"]')!.click();await wait();
  document.querySelector<HTMLButtonElement>('button[title="更多"]')!.click();await wait();button('預覽').click();
 }
})();
