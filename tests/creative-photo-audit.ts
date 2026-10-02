/** Runs against the mounted production component in mobile WebKit, not a
 * reimplementation of its gesture/painting pipeline. Synthetic inputs belong
 * to this isolated fixture and never touch a user's project. */
void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'creative-photo-region',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='9'&&stage.querySelector('canvas')?.width)break;await wait();}
  if(!stage)throw Error('Missing mounted creative stage');await wait(30);
  check('10 imported files are capped at 9',stage.dataset.photoCount==='9',stage.dataset.photoCount);
  const ratio=()=>stage!.dataset.canvasRatio;
  const buttons=()=>[...document.querySelectorAll<HTMLButtonElement>('button')];
  const button=(label:string)=>buttons().find(b=>b.textContent?.trim()===label)!;
  button('3:4').click();await wait(8);check('landscape first click',ratio()==='4:3',ratio());
  button('3:4').click();await wait(8);check('repeat click toggles portrait',ratio()==='3:4',ratio());
  button('3:4').click();await wait(8);check('repeat click toggles back',ratio()==='4:3',ratio());
  const control=document.querySelector<HTMLElement>('[data-photo-layout-control]')!,row=control.parentElement!,slider=row.querySelector<HTMLInputElement>('input[type=range]')!;
  const cr=control.getBoundingClientRect(),sr=slider.getBoundingClientRect();
  check('occupancy right half',sr.left>cr.right&&Math.abs(sr.width-cr.width)<12,{controlWidth:cr.width,sliderWidth:sr.width});
  control.querySelector('button')!.click();await wait(2);button('橫向').click();await wait(8);check('layout selector changes region',stage.dataset.photoArrangement==='horizontal');
  control.querySelector('button')!.click();await wait(2);button('均分').click();await wait(8);
  const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!,g=canvas.getContext('2d')!;
  const pixel=(u:number,v:number)=>[...g.getImageData(Math.round(canvas.width*u),Math.round(canvas.height*v),1,1,{colorSpace:'srgb'}).data];
  const before=pixel(.08,.08),last=pixel(.75,.75);
  check('first photo is red, last photo is gray',before[0]>180&&before[1]<100&&Math.abs(last[0]-last[1])<3,{before,last});
  const rect=canvas.getBoundingClientRect(),a={x:rect.left+rect.width*.08,y:rect.top+rect.height*.08},b={x:rect.left+rect.width*.75,y:rect.top+rect.height*.75};
  const pointer=(type:string,id:number,p:{x:number,y:number})=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'||type==='pointercancel'?0:1}));
  pointer('pointerdown',71,a);await new Promise(r=>setTimeout(r,340));await wait(2);
  const thumb=document.querySelector<HTMLCanvasElement>('[data-creative-swap-thumbnail]');
  const border=thumb&&getComputedStyle(thumb).borderColor;
  check('long press shows decoded thumbnail with opaque white border',!!thumb&&border==='rgb(255, 255, 255)',border);
  pointer('pointermove',71,b);pointer('pointerup',71,b);await wait(8);
  const after=pixel(.08,.08),end=pixel(.75,.75);
  check('swap changes entire photo cells, not floating objects',Math.abs(after[0]-after[1])<3&&end[0]>180&&end[1]<100,{after,end});
  await new Promise(r=>setTimeout(r,600));
  document.querySelector<HTMLButtonElement>('button[title="復原"]')!.click();await wait(8);
  const undone=pixel(.08,.08);check('undo restores photo order',undone[0]>180&&undone[1]<100,undone);
  document.querySelector<HTMLButtonElement>('button[title="重做"]')!.click();await wait(8);
  const redone=pixel(.08,.08);check('redo restores swapped photo order',Math.abs(redone[0]-redone[1])<3,redone);
  // Second finger during the waiting period must cancel only the swap timer.
  pointer('pointerdown',72,a);pointer('pointerdown',73,b);await new Promise(r=>setTimeout(r,340));await wait(2);
  check('second finger cancels long press',!document.querySelector('[data-creative-swap-thumbnail]'));
  pointer('pointerup',72,a);pointer('pointerup',73,b);await wait(4);
  pointer('pointerdown',74,a);pointer('pointermove',74,{x:a.x+14,y:a.y});await new Promise(r=>setTimeout(r,340));await wait(2);
  check('ordinary drag cancels long press',!document.querySelector('[data-creative-swap-thumbnail]'));pointer('pointerup',74,a);await wait(4);
  const {loadDraft}=await import('../utils/toolDraft');let draft:any;
  for(let i=0;i<30;i++){
   await new Promise(r=>setTimeout(r,200));draft=await loadDraft();
   if(draft?.state?.photoRegion?.photos?.length===9&&draft?.state?.photoRegion?.arrangement==='grid')break;
  }
  check('autosave retains all original photo assets and arrangement',draft?.state?.photoRegion?.photos?.length===9&&draft?.state?.photoRegion?.arrangement==='grid',draft?{tool:draft.tool,count:draft.state?.photoRegion?.photos?.length,arrangement:draft.state?.photoRegion?.arrangement}:null);
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(error){report.pass=false;report.error=String(error);}
 const pre=document.createElement('pre');pre.id='creative-photo-result';pre.style.cssText='position:fixed;top:60px;left:8px;max-height:130px;max-width:95vw;overflow:auto;z-index:999999;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 const close=document.createElement('button');close.textContent='關閉驗證報告';close.style.cssText='position:fixed;top:45px;left:8px;z-index:999999;background:#222;color:white;font-size:10px';close.onclick=()=>{pre.remove();close.remove();};document.body.append(close);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
