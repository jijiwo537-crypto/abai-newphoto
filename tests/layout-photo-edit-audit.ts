void(async()=>{
 const tick=()=>new Promise<number>(r=>requestAnimationFrame(r)),wait=async(n=3)=>{while(n--)await tick();};
 const report:any={kind:'layout-photo-edit-v57',checks:[],metrics:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let root:HTMLElement|null=null,cv:HTMLCanvasElement|null=null;
  const seamless=!new URLSearchParams(location.search).has('off'),surface=seamless?'[data-seamless-layout]':'[data-layout-photo-surface]';
  for(let n=0;n<600;n++){root=document.querySelector('[data-layout-id="seam-layout"]');cv=root?.querySelector(surface)||null;if(cv&&cv.width>200)break;await tick();}await wait(20);
  if(!root||!cv)throw Error('layout surface missing');
  const sample=document.createElement('canvas');sample.width=64;sample.height=64;const g=sample.getContext('2d')!;
  const pixels=()=>{g.clearRect(0,0,64,64);g.drawImage(cv!,0,0,64,64);return g.getImageData(2,2,60,27).data;};
  const diff=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0)/a.length;
  const box=()=>{const b=root!.getBoundingClientRect();return [b.x,b.y,b.width,b.height];};
  const initial=box(),before=pixels();root.querySelector<HTMLElement>('[data-cell-id="0"]')!.click();await wait();
  check('selecting layout preserves geometry and picture pixels',box().every((v,i)=>Math.abs(v-initial[i])<.01)&&diff(before,pixels())===0,{before:initial,after:box(),pixelDelta:diff(before,pixels())});
  root.querySelector<HTMLElement>('[data-cell-id="0"]')!.click();await wait();document.querySelector<HTMLButtonElement>('button[title="編輯"]')!.click();await wait();
  const button=(suffix:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim().endsWith(suffix))!;
  button('特效').click();await wait();document.querySelector<HTMLButtonElement>('[data-fx-card="fxLowfi"]')!.click();await wait(20);
  // Optical parameter painting may use WebKit's direct native-canvas path;
  // the visible physical-pixel surface must remain unchanged for the gesture.
  cv=root.querySelector<HTMLCanvasElement>(surface)!;
  const input=document.querySelector<HTMLInputElement>('footer input[type=range]')!;if(!input)throw Error('slider missing');
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  const event=(type:string)=>input.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:5701,pointerType:'touch'}));
  const strong=pixels();event('pointerdown');const frames:number[]=[];let previous=await tick();
  const canvasIdentity=cv,spatial=[cv.width,cv.height];
  for(let i=0;i<90;i++){setter.call(input,String(20+i%70));input.dispatchEvent(new Event('input',{bubbles:true}));const t=await tick();frames.push(t-previous);previous=t;}
  const held=pixels();check('held slider changes visible layout photograph',diff(strong,held)>.5,{delta:diff(strong,held)});
  check('one persistent surface and resolution during editing',root.querySelector(surface)===canvasIdentity&&cv.width===spatial[0]&&cv.height===spatial[1]);
  event('pointerup');await wait(20);check('release preserves last live pixels',diff(held,pixels())<.1,{delta:diff(held,pixels())});
  const p95=[...frames].sort((a,b)=>a-b)[Math.floor(frames.length*.95)];report.metrics.push({frames:frames.length,p95,max:Math.max(...frames),fps:1000/(frames.reduce((a,b)=>a+b)/frames.length)});
  const scan=document.createElement('canvas');scan.width=cv.width;scan.height=cv.height;const sc=scan.getContext('2d')!;sc.drawImage(cv,0,0);const full=sc.getImageData(0,0,cv.width,cv.height).data;let transparent=0;for(let y=2;y<cv.height-2;y++)for(let x=2;x<cv.width-2;x++)if(full[(y*cv.width+x)*4+3]!==255)transparent++;scan.width=scan.height=1;
  check('zero-gap layout has no transparent photo boundary pixels',transparent===0,{transparent,size:spatial});
  sample.width=sample.height=1;report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.id='layout-photo-edit-result';pre.hidden=true;pre.dataset.report=JSON.stringify(report);document.body.append(pre);
})();
