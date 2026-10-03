/** Cross-page production component popup and single-scene blank-cell chrome. */
void(async()=>{
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'cross-page-chrome-v8',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let prompt:SVGGraphicsElement|null=null;
  for(let i=0;i<600;i++){prompt=document.querySelector('[data-layout-empty-prompt]');if(prompt)break;await wait();}await wait(20);
  if(!prompt)throw Error('Empty-cell prompt missing');
  const svg=prompt.ownerSVGElement!;
  check('cross-page label and plus share a single SVG world matrix',svg.hasAttribute('data-layout-empty-prompts')&&svg.querySelectorAll('[data-layout-empty-prompt]').length===2);
  check('plus is a closed filled path and label is 8px',svg.querySelector('[data-layout-empty-plus]')?.getAttribute('d')?.endsWith('Z')===true&&svg.querySelector('[data-layout-empty-label]')?.getAttribute('font-size')==='8');
  const layer=document.querySelector('[data-layout-grid-lines]')!;
  check('two adjacent blanks have one dashed shared segment',layer.querySelector('path')?.getAttribute('d')?.match(/M/g)?.length===1&&layer.querySelector('path')?.getAttribute('stroke-dasharray')==='3 3');
  const workspace=document.querySelector<HTMLElement>('[data-grid-preview-viewport]')!,wr=workspace.getBoundingClientRect();
  const touches=(type:string,d:number)=>{const list=type==='touchend'?[]:[new Touch({identifier:91,target:workspace,clientX:wr.left+wr.width/2-d/2,clientY:wr.top+wr.height/2}),new Touch({identifier:92,target:workspace,clientX:wr.left+wr.width/2+d/2,clientY:wr.top+wr.height/2})];workspace.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:list,targetTouches:list,changedTouches:list}));};
  const initial=prompt.getAttribute('transform'),initialRelative=prompt.getScreenCTM()!.a/svg.getScreenCTM()!.a;let drift=0;
  touches('touchstart',80);
  for(let i=0;i<120;i++){touches('touchmove',80+(i<60?i:120-i)*.8);await wait();drift=Math.max(drift,Math.abs(prompt.getScreenCTM()!.a/svg.getScreenCTM()!.a-initialRelative));}
  touches('touchend',0);await wait(4);
  check('120 slow zoom frames never independently reposition or rescale chrome',drift<1e-7&&prompt.getAttribute('transform')===initial,{drift});
  document.querySelector<HTMLButtonElement>('button[title="更多"]')!.click();await wait(5);
  const menu=document.querySelector<HTMLElement>('[aria-label="跨頁拼圖更多選項"]')!,header=document.querySelector('header')!;
  check('cross-page popup is darker and preserves the original row style',getComputedStyle(menu).backgroundColor==='rgb(16, 16, 16)'&&!menu.querySelector('.premium-glass-button'));
  check('cross-page popup is moved down below the header',menu.getBoundingClientRect().top-header.getBoundingClientRect().bottom>=7,{gap:menu.getBoundingClientRect().top-header.getBoundingClientRect().bottom});
  document.querySelector<HTMLButtonElement>('button[title="更多"]')!.click();await wait(45);
  document.querySelector<HTMLElement>('[data-cell-id]')!.click();await wait(5);
  const wrapper=document.querySelector<HTMLElement>('[data-layout-wrapper][data-layout-id]')!,box=wrapper.getBoundingClientRect();
  const drag=(type:string,dx:number)=>{const list=type==='touchend'?[]:[new Touch({identifier:93,target:wrapper,clientX:box.left+box.width/2+dx,clientY:box.top+box.height/2})];wrapper.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:list,targetTouches:list,changedTouches:list}));};
  drag('touchstart',0);drag('touchmove',2);await wait(4);
  const blue=()=>{let count=0,hash=0;for(const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-classic-scene]')){const ctx=canvas.getContext('2d')!,data=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=0;i<data.length;i+=4){if(data[i]<115&&data[i+1]>85&&data[i+1]<180&&data[i+2]>180&&data[i+3]>100){count++;hash=(hash+i)%1000000007;}}}return {count,hash};};
  const before=blue();await wait(8);const after=blue();
  check('actual snapped blue guides remain visible and animate their dash phase',before.count>20&&after.count>20&&before.hash!==after.hash,{before,after});
  drag('touchend',2);await wait(3);
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
