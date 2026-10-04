import {backdropMaskDiagnostics} from '../utils/backdropMasks';
void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await tick();};
 const report:any={kind:'backdrop-mask-interactions-v35',route:location.search,ua:navigator.userAgent,checks:[],frames:[],paint:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const errors:string[]=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<400;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry&&stage.dataset.sceneObjects?.includes('qa-mask'))break;await tick();}await wait(40);
  if(!stage)throw Error('scene missing');const canvas=stage.querySelector<HTMLCanvasElement>('canvas')!,g=canvas.getContext('2d')!;
  const geometry=()=>JSON.parse(stage!.dataset.sceneGeometry!),object=()=>JSON.parse(stage!.dataset.sceneObjects!).find((o:any)=>o.id==='qa-mask');
  const point=(x:number,y:number)=>{const o=geometry(),r=canvas.parentElement!.getBoundingClientRect();return {x:r.left+r.width*x/o.cw,y:r.top+r.height*y/o.ch};};
  const pointer=(type:string,id:number,p:{x:number;y:number})=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
  const tap=(p:{x:number;y:number})=>{pointer('pointerdown',3501,p);pointer('pointerup',3501,p);};
  const pixel=()=>{const o=object(),geo=geometry(),[full]=JSON.parse(canvas.dataset.fullSize||'[1]'),v=JSON.parse(canvas.dataset.viewport||'{"x":0,"y":0}'),s=full/geo.cw;return Array.from(g.getImageData(Math.floor((o.x+o.w*.5)*s-v.x),Math.floor((o.y+o.h*.5)*s-v.y),1,1).data);};
  const start=pixel();const o=object();tap(point(o.x+o.w/2,o.y+o.h/2));await wait();check('mask selected',stage.dataset.selectedObject==='qa-mask');
  document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait();
  if(new URLSearchParams(location.search).get('mask')==='mask-negative'){
   check('negative has a read-only explanation',document.querySelector('[data-mask-editor]')?.textContent==='該物件不可編輯');
   check('negative has no controls',!document.querySelector('[data-mask-editor] input')&&!document.querySelector('[data-mask-shapes]'));
   report.pass=report.checks.every((c:any)=>c.pass);report.diagnostics={...backdropMaskDiagnostics};
   const result=document.createElement('pre');result.id='mask-interaction-result';result.hidden=true;result.dataset.report=JSON.stringify(report);document.body.append(result);
   await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});return;
  }
  check('shape controls visible before sliders',document.querySelectorAll('[data-mask-shapes] button').length===3);
  check('no opacity slider',!document.querySelector('[data-mask-editor] input[aria-label="透明度"]'));
  for(const shape of ['圓形','星形','方形']){[...document.querySelectorAll<HTMLButtonElement>('[data-mask-shapes] button')].find(b=>b.textContent===shape)!.click();await wait();check(shape+' selected',document.querySelector('[data-mask-shapes] [aria-pressed="true"]')?.textContent===shape);check(shape+' keeps visible center',pixel()[3]===255);}
  for(let round=0;round<8;round++){
   const beforeDeselect=pixel();
   document.querySelector<HTMLButtonElement>('[data-creative-tab="setting"]')!.click();await wait();
   tap(point(geometry().cw-8,8));await wait();if(!new URLSearchParams(location.search).has('huge'))check('mask actually deselected '+round,stage.dataset.selectedObject!=='qa-mask');check('deselection keeps mask pixels '+round,JSON.stringify(pixel())===JSON.stringify(beforeDeselect),{before:beforeDeselect,after:pixel()});
   const o=object(),p=point(o.x+o.w/2,o.y+o.h/2);tap(p);await wait(2);
   pointer('pointerdown',3502,p);for(let i=0;i<16;i++){const t=performance.now();pointer('pointermove',3502,{x:p.x+Math.sin(i/15*Math.PI)*20,y:p.y+Math.sin(i/15*Math.PI)*10});await tick();report.frames.push(performance.now()-t);report.paint.push(Number(canvas.dataset.paintMs));}pointer('pointerup',3502,p);await wait();
   document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait();
   check('editor remains usable '+round,!!document.querySelector('[data-mask-shapes]'));
  }
  check('no runtime errors',!errors.length,errors);report.diagnostics={...backdropMaskDiagnostics};report.timings={mean:report.frames.reduce((a:number,b:number)=>a+b)/report.frames.length,max:Math.max(...report.frames)};report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const result=document.createElement('pre');result.id='mask-interaction-result';result.hidden=true;result.dataset.report=JSON.stringify(report);document.body.append(result);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
