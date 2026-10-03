void(async()=>{
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const checks:any[]=[],check=(name:string,pass:boolean,detail?:any)=>checks.push({name,pass,detail});
 try{
  let stage:HTMLElement;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]')!;if(stage?.dataset.photoCount==='2'&&stage.dataset.sceneGeometry&&document.querySelector('[data-photo-cell="0"]'))break;await wait(1);}await wait(20);
  const canvas=stage!.querySelector('canvas')!,g=canvas.getContext('2d')!;
  const scene=()=>JSON.parse(stage.dataset.sceneGeometry!);
  const pixels=(rect:any)=>{const o=scene(),k=canvas.width/o.cw;return g.getImageData(Math.round(rect.x*k),Math.round(rect.y*k),Math.max(1,Math.floor(rect.w*k)),Math.max(1,Math.floor(rect.h*k))).data;};
  const digest=(rect:any)=>{let n=2166136261;for(const x of pixels(rect))n=Math.imul(n^x,16777619);return n>>>0;};
  const o=scene(),mask={x:o.mx+2,y:o.my+2,w:o.mw-4,h:o.mh-4};
  const cell=document.querySelector('[data-photo-cell="0"]')!.getBoundingClientRect(),point={x:cell.left+cell.width*.2,y:cell.top+cell.height*.2};
  const frame=canvas.getBoundingClientRect(),bottom=(cell.bottom-frame.top)/frame.height*o.ch;
  const nextCell=document.querySelector('[data-photo-cell="1"]')!.getBoundingClientRect();
  const secondY=(nextCell.top+nextCell.height*.2-frame.top)/frame.height*o.ch;
  const pointer=(type:string,id:number)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:point.x,clientY:point.y,buttons:type==='pointerup'?0:1}));
  const exposedRect={x:100,y:bottom-1,w:40,h:4},exposedBefore=digest(exposedRect);
  const maskBefore=digest(mask),imageRect={x:o.ix+o.iw*.05,y:o.iy+o.ih*.05,w:o.iw*.15,h:o.ih*.15},imageBefore=digest(imageRect);
  pointer('pointerdown',2201);await new Promise(r=>setTimeout(r,380));await wait(8);
  check('holding a base photo dims only its central photo',digest(imageRect)!==imageBefore);
  check('mask backdrop and its photo cutouts remain unchanged',digest(mask)===maskBefore);
  pointer('pointerup',2201);await wait(8);
  pointer('pointerdown',2202);pointer('pointerup',2202);await wait(8);
  check('base photo selected',stage.dataset.selectedRegionPhoto==='0');
  check('selection is not an above-scene DOM border',getComputedStyle(document.querySelector('[data-photo-cell="0"]')!).borderTopWidth==='0px');
  // A filled object covers the selected photo's right-hand frame.
  const ink=pixels({x:380,y:bottom-1,w:1,h:2});
  check('base frame stays beneath the foreground object',Array.from(ink).every((v,i)=>i%4===3||v<80));
  check('base frame remains visible outside the covering object',digest(exposedRect)!==exposedBefore);
  document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(15);
  const btn=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(name))!;
  check('base photo opens the shared image editor',!!btn('濾鏡')&&!!btn('調節')&&!!btn('特效')&&!!btn('構圖'));
  check('base photo has no shape editing category',!btn('造型'));
  const before=digest(imageRect),otherRect={x:20,y:secondY,w:40,h:40},otherBefore=digest(otherRect);btn('調節').click();await wait(5);btn('亮度').click();await wait(6);
  const slider=Array.from(document.querySelectorAll<HTMLInputElement>('input[type="range"]')).find(s=>s.min==='-100')!;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(slider,'45');slider.dispatchEvent(new Event('input',{bubbles:true}));await wait(25);
  check('adjustment immediately changes only the selected base photo',digest(imageRect)!==before);
  check('other base photos keep their own adjustment parameters',digest(otherRect)===otherBefore);
  const cellRight=(cell.right-frame.left)/frame.width*o.cw;
  const corners=[[20,20],[cellRight-20,80],[100,bottom-20]].map(([x,y])=>Array.from(pixels({x,y,w:1,h:1})).slice(0,4));
  check('high-resolution effect surfaces keep the complete cell covered',corners.every(p=>p[0]>220&&p[1]>40&&p[3]===255),corners);
  const {loadDraft}=await import('../utils/toolDraft');await new Promise(r=>setTimeout(r,1500));const draft=await loadDraft();
  check('base photo adjustments persist in the draft',draft?.state?.photoRegion?.photos[0]?.fx?.brightness===45);
 }catch(e){check('runtime exception',false,String(e));}
 const report={kind:'creative-base-photo',ua:navigator.userAgent,pass:checks.every(c=>c.pass),checks};
 const pre=document.createElement('pre');pre.id='base-photo-result';pre.dataset.report=JSON.stringify(report);pre.style.cssText='position:fixed;top:60px;left:8px;max-width:95vw;max-height:220px;overflow:auto;background:#111e;color:white;font-size:10px;z-index:99999';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 if(new URLSearchParams(location.search).has('proof'))pre.style.display='none';
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
