/** User-visible controls and actual mounted renderer; synthetic QA input only. */
void(async()=>{
 const next=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));const wait=async(n=3)=>{for(let i=0;i<n;i++)await next();};
 const report:any={kind:'creative-tools',ua:navigator.userAgent,checks:[]};const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const click=(selector:string)=>{const b=document.querySelector<HTMLButtonElement>(selector);if(!b)throw Error('Missing '+selector);b.click();};
 const text=(name:string)=>{const b=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);if(!b)throw Error('Missing '+name);b.click();};
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<400;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.querySelector('canvas')?.width)break;await next();}await wait(25);
  click('[data-creative-export-options-toggle]');await wait();
  const panel=document.querySelector<HTMLElement>('[aria-label="創意拼圖匯出設定"]')!;
  check('four real export controls and same translucent material',panel.textContent?.includes('影片幀率')&&panel.textContent?.includes('影片畫質')&&getComputedStyle(panel).backgroundColor==='rgba(18, 18, 20, 0.82)');
  text('JPG');text('30');text('高');await wait();
  check('format, frame rate and quality selections persist visibly', [...panel.querySelectorAll('[aria-pressed=true]')].map(b=>b.textContent).join('|')==='JPG|自動|30|高');
  click('[data-creative-export-options-toggle]');click('[data-creative-tab="add"]');await wait();text('新增圖形');await wait();
  const shape=document.querySelector<HTMLButtonElement>('footer button[aria-pressed][aria-label]')!;shape.click();await wait();
  click('header button[title="開啟畫筆"]');await wait();
  const canvas=stage!.querySelector('canvas')!,rect=canvas.parentElement!.getBoundingClientRect(),x=rect.left+rect.width*.4,y=rect.top+rect.height*.4;
  const pointer=(type:string,id:number,xx=x,yy=y)=>stage!.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:xx,clientY:yy,buttons:type==='pointerup'?0:1}));
  pointer('pointerdown',201);pointer('pointerup',201);await wait();
  const stamped=()=>JSON.parse(stage!.dataset.brushObjects||'[]');check('shape brush stamps an editable object',stamped().length===1);
  click('header button[title*="再按切換為橡皮擦"]');await wait();pointer('pointerdown',202);pointer('pointerup',202);await wait();
  check('same palette button cycles to working object eraser',stamped().length===0);
  click('[data-creative-tab="motion"]');await wait(30);
  check('brush button is hidden throughout the animation page',!document.querySelector('header button[title*="畫筆"]')&&!document.querySelector('header button[title*="橡皮擦"]'));
  text('圖案');await wait();
  for(const name of ['右至左','上至下','下至上','隨機','左至右']){text(name);await wait();check('direction '+name,[...document.querySelectorAll('[aria-pressed=true]')].some(b=>b.textContent===name));}
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.id='creative-tools-result';pre.style.cssText='position:fixed;inset:70px 8px auto;z-index:999999;max-height:220px;overflow:auto;background:#111e;color:white;font-size:11px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
