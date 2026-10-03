/** Isolated gestures drive the mounted production editor on real WebKit. */
void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'creative-photo-region-v2',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='9'&&stage.querySelector('canvas')?.width)break;await wait();}
  if(!stage)throw Error('Missing mounted creative stage');await wait(30);
  check('10 imports capped at 9',stage.dataset.photoCount==='9');
  const buttons=()=>[...document.querySelectorAll<HTMLButtonElement>('button')];
  const button=(text:string)=>buttons().find(b=>b.textContent?.trim()===text)!;
  button('3:4').click();await wait(8);check('landscape initial ratio',stage.dataset.canvasRatio==='4:3');
  button('3:4').click();await wait(8);check('second click portrait',stage.dataset.canvasRatio==='3:4');
  button('3:4').click();await wait(8);
  const control=document.querySelector<HTMLElement>('[data-photo-layout-control]')!,ratio=document.querySelector<HTMLElement>('[data-photo-ratio-control]')!;
  const cr=control.getBoundingClientRect(),rr=ratio.getBoundingClientRect();
  const slider=ratio.parentElement!.querySelector<HTMLInputElement>('input[type=range]')!,sr=slider.getBoundingClientRect();
  check('photo layout has five buttons',control.querySelectorAll('button').length===5);
  check('layout is above right occupancy, ratio below left',cr.top<rr.top&&sr.left>rr.right&&Math.abs(sr.width-cr.width)<15,{cr,rr,sr});
  document.querySelector<HTMLButtonElement>('[data-photo-template="1"]')!.click();await wait(8);
  check('quick template changes geometry',stage.dataset.photoTemplateIndex==='1');
  document.querySelector<HTMLButtonElement>('[data-photo-template="0"]')!.click();await wait(8);
  const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!,g=canvas.getContext('2d')!;
  const pixel=(u:number,v:number)=>[...g.getImageData(Math.round(canvas.width*u),Math.round(canvas.height*v),1,1,{colorSpace:'srgb'}).data];
  const rect=canvas.getBoundingClientRect(),point=(u:number,v:number)=>({x:rect.left+rect.width*u,y:rect.top+rect.height*v});
  const a=point(.08,.08),b=point(.75,.75),p2=point(.22,.08);
  const pointer=(type:string,id:number,p:{x:number,y:number})=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'||type==='pointercancel'?0:1}));
  const transforms=()=>JSON.parse(stage!.dataset.photoTransforms!);
  pointer('pointerdown',59,a);pointer('pointermove',59,point(.12,.08));pointer('pointerup',59,point(.12,.08));await wait(3);
  check('unselected photo cannot be dragged or auto-selected',stage.dataset.selectedRegionPhoto===''&&transforms().every((p:any)=>p.x===0&&p.zoom===1),{selected:stage.dataset.selectedRegionPhoto,photos:transforms()});
  pointer('pointerdown',60,a);pointer('pointerup',60,a);await wait(3);
  check('tap selects one photo, not the whole region',stage.dataset.selectedRegionPhoto==='0'&&!!document.querySelector('[data-photo-cell="0"]'));
  pointer('pointerdown',61,a);await wait(2);
  pointer('pointerdown',62,p2);await wait(2);const baseline=transforms();
  check('second finger does not jump size',baseline[0].zoom===1);
  pointer('pointermove',62,point(.30,.08));await wait(4);
  const zoomed=transforms();check('pinch scales only selected photo',zoomed[0].zoom>1.4&&zoomed.slice(1).every((p:any)=>p.zoom===1),zoomed.map((p:any)=>p.zoom));
  pointer('pointerup',62,point(.30,.08));pointer('pointerup',61,a);await wait(3);
  pointer('pointerdown',63,a);pointer('pointermove',63,point(.10,.08));await wait(2);
  const moved=transforms()[0];pointer('pointerdown',64,p2);await wait(2);
  const handoff=transforms()[0];check('drag-to-pinch handoff preserves current crop',moved.x===handoff.x&&moved.zoom===handoff.zoom,{moved,handoff});
  pointer('pointerup',64,p2);pointer('pointerup',63,point(.10,.08));await wait(4);
  const before=pixel(.08,.08),last=pixel(.75,.75);
  pointer('pointerdown',71,a);await new Promise(r=>setTimeout(r,340));await wait(2);
  const thumb=document.querySelector<HTMLCanvasElement>('[data-creative-swap-thumbnail]'),tr=thumb?.getBoundingClientRect();
  check('opaque white long-press border',!!thumb&&getComputedStyle(thumb).borderColor==='rgb(255, 255, 255)');
  check('thumbnail center follows finger',!!tr&&Math.abs(tr.left+tr.width/2-a.x)<1&&Math.abs(tr.top+tr.height/2-a.y)<1,{tr,a});
  check('held source is visibly dimmed',pixel(.08,.08)[0]<before[0]*.6,{before,during:pixel(.08,.08)});
  pointer('pointermove',71,b);await wait(3);
  check('dim follows hovered photo, never the source simultaneously',pixel(.08,.08)[0]===before[0]&&pixel(.75,.75)[0]<last[0]*.6);
  pointer('pointermove',71,point(.5,-.05));await wait(3);
  check('all photos restore when finger leaves image',pixel(.08,.08)[0]===before[0]&&pixel(.75,.75)[0]===last[0]);
  pointer('pointermove',71,b);pointer('pointerup',71,b);await wait(8);
  check('region photos swap',Math.abs(pixel(.08,.08)[0]-pixel(.08,.08)[1])<3&&pixel(.75,.75)[0]>180);
  await new Promise(r=>setTimeout(r,600));document.querySelector<HTMLButtonElement>('button[title="復原"]')!.click();await wait(8);
  check('undo photo swap',pixel(.08,.08)[0]>180&&pixel(.08,.08)[1]<100);
  document.querySelector<HTMLButtonElement>('button[title="重做"]')!.click();await wait(8);
  check('redo photo swap',Math.abs(pixel(.08,.08)[0]-pixel(.08,.08)[1])<3);
  pointer('pointerdown',72,a);pointer('pointerdown',73,b);await new Promise(r=>setTimeout(r,340));await wait(2);
  check('second finger cancels long press',!document.querySelector('[data-creative-swap-thumbnail]'));
  pointer('pointerup',72,a);pointer('pointerup',73,b);await wait(4);
  const seam=document.querySelector<HTMLElement>('[data-creative-seamless]')!;
  seam.querySelectorAll<HTMLButtonElement>('button')[1].click();await wait(12);
  const enabled=pixel(1/3,.08);check('seamless immediately blends shared edges',enabled[1]>140&&enabled[1]<185&&enabled[0]>65&&enabled[0]<115,enabled);
  seam.querySelectorAll<HTMLButtonElement>('button')[0].click();await wait(5);
  check('seamless switches off immediately',pixel(.08,.08)[0]===pixel(.08,.08)[1]);
  const {loadDraft}=await import('../utils/toolDraft');let draft:any;
  for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,200));draft=await loadDraft();if(draft?.state?.photoRegion?.photos?.length===9&&draft.state.photoRegion.photos.some((p:any)=>p.zoom>1))break;}
  check('draft retains originals and independent crop metadata',draft?.state?.photoRegion?.photos?.length===9&&draft.state.photoRegion.photos.some((p:any)=>p.zoom>1));
  document.querySelector<HTMLButtonElement>('button[aria-label="所有圖片佈局"]')!.click();await wait(2);
  const choices=document.querySelectorAll<HTMLButtonElement>('[data-layout-count]');
  const picker=document.querySelector<HTMLElement>('[data-photo-layout-options]')!,pickerRect=picker.getBoundingClientRect();
  const footerRect=document.querySelector('footer')!.getBoundingClientRect();
  check('more opens only inside the lower tool panel',pickerRect.top>=footerRect.top&&pickerRect.bottom<=footerRect.bottom+1&&!!picker.querySelector('[aria-label="返回圖片排版"]'));
  const back=picker.querySelector<HTMLElement>('[aria-label="返回圖片排版"]')!,br=back.getBoundingClientRect();
  check('lower layout back button remains actionable',back.contains(document.elementFromPoint(br.x+br.width/2,br.y+br.height/2)));
  const {TEMPLATE_MAP}=await import('../utils/layoutTemplates');
  check('shared catalog plus four creative overlays, 2 to 10 photos, no one-photo option',Array.from({length:9},(_,i)=>i+2).every(n=>[...choices].filter(b=>b.dataset.layoutCount===String(n)).length===TEMPLATE_MAP[n].length+(n===3?3:n===4?1:0))&&![...choices].some(b=>b.dataset.layoutCount==='1'));
  document.querySelector<HTMLButtonElement>('[data-layout-count="2"]')!.click();await wait(5);
  document.querySelector<HTMLButtonElement>('button[aria-label="所有圖片佈局"]')!.click();await wait(2);
  document.querySelector<HTMLButtonElement>('[data-layout-count="9"][data-layout-index="0"]')!.click();await wait(5);
  check('smaller layout does not lose imported photos',transforms().every((p:any)=>!!p.src));
  // The brush exercises both the first stamp and every move against production
  // geometry. A second stroke on top of the first cannot bypass the spacing.
  document.querySelector<HTMLButtonElement>('button[title="開啟畫筆"]')!.click();await wait(2);
  const brushRect=canvas.getBoundingClientRect(),brushPoint=(u:number,v:number)=>({x:brushRect.left+u*brushRect.width,y:brushRect.top+v*brushRect.height});
  const brushStart=brushPoint(.05,.18);pointer('pointerdown',81,brushStart);
  for(let u=.055;u<.95;u+=.005)pointer('pointermove',81,brushPoint(u,.18));pointer('pointerup',81,brushPoint(.95,.18));await wait(5);
  const stamps=()=>JSON.parse(stage!.dataset.patternStamps!);const count=stamps().length;
  pointer('pointerdown',82,brushStart);pointer('pointerup',82,brushStart);await wait(2);
  check('a new brush stroke can paint over existing ink',count>2&&stamps().length===count+1,{count,after:stamps().length});
  const {patternPathBounds}=await import('../utils/holeShapes');const {stampBounds,brushStepReached}=await import('../utils/patternBrushSpacing');
  const bounds=stamps().slice(0,count).map((h:any)=>{const b=patternPathBounds('star',h.size);return stampBounds(h.x+b.x+b.w/2,h.y+b.y+b.h/2,b.w,b.h,h.angle||0,h.size);});
  check('stroke cadence is 20 percent shorter and independent of old artwork',bounds.every((a:any,i:number)=>!i||brushStepReached(bounds[i-1],a)),bounds);
  if(new URLSearchParams(location.search).has('swaps')){
    // Stop the brush before testing floating-photo / region swaps.
    document.querySelector<HTMLButtonElement>('button[title="畫筆模式（再按切換為橡皮擦）"]')!.click();await wait(2);
    document.querySelector<HTMLButtonElement>('button[title="橡皮擦模式（再按關閉）"]')!.click();await wait(2);
    const objectPhotos=()=>JSON.parse(stage!.dataset.photoObjects!);
    const scene=JSON.parse(stage.dataset.sceneGeometry!),frame=canvas.getBoundingClientRect();
    const objectPoint=(o:any)=>({x:frame.left+(o.x+o.w/2)*frame.width/scene.cw,y:frame.top+(o.y+o.h/2)*frame.height/scene.ch});
    const oa=objectPhotos().find((o:any)=>o.id==='qa-float-a'),ob=objectPhotos().find((o:any)=>o.id==='qa-float-b'),pa=objectPoint(oa),pb=objectPoint(ob);
    const region0=transforms()[0].src;
    pointer('pointerdown',91,a);await new Promise(r=>setTimeout(r,340));pointer('pointermove',91,pa);pointer('pointerup',91,pa);await wait(8);
    check('base region and ordinary floating photo swap',transforms()[0].src===oa.src&&objectPhotos().find((o:any)=>o.id===oa.id).src===region0);
    pointer('pointerdown',92,pa);await new Promise(r=>setTimeout(r,340));await wait(2);
    check('ordinary photo supports decoded long-press thumbnail',!!document.querySelector('[data-creative-swap-thumbnail]'));
    pointer('pointermove',92,pb);pointer('pointerup',92,pb);await wait(8);
    check('ordinary photos swap without losing either content',objectPhotos().find((o:any)=>o.id===oa.id).src===ob.src&&objectPhotos().find((o:any)=>o.id===ob.id).src===region0);
    pointer('pointerdown',93,pb);await new Promise(r=>setTimeout(r,340));pointer('pointermove',93,a);pointer('pointerup',93,a);await wait(8);
    check('ordinary photo can swap back into base region',transforms()[0].src===region0&&objectPhotos().find((o:any)=>o.id===ob.id).src===oa.src);
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(error){report.pass=false;report.error=String(error);}
 const pre=document.createElement('pre');pre.id='creative-photo-result';pre.style.cssText='position:fixed;top:60px;left:8px;max-height:130px;max-width:95vw;overflow:auto;z-index:999999;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 const close=document.createElement('button');close.textContent='關閉驗證報告';close.style.cssText='position:fixed;top:45px;left:8px;z-index:999999;background:#222;color:white;font-size:10px';close.onclick=()=>{pre.remove();close.remove();};document.body.append(close);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
