void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r())),wait=async(n=3)=>{while(n--)await tick();};
 const report:any={kind:'creative-text-warp',checks:[],samples:[]};
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.querySelector('canvas[data-text-logical-frame]'))break;await tick();}
  if(!stage)throw Error('missing text scene');await wait(60);
  const main=stage.querySelector<HTMLCanvasElement>('canvas[data-text-logical-frame]')!,fonts=new Set<string>();
  for(let i=0;i<80;i++){
   const box=stage.getBoundingClientRect();stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:box.x+box.width/2,clientY:box.y+box.height/2,deltaY:i<40?-3:3}));await wait(3);
   const f=JSON.parse(main.dataset.textLogicalFrame!),[a,b,c,d,e,h]=f.matrix;fonts.add(f.font);
   const p=main.getContext('2d')!.getImageData(0,0,main.width,main.height).data;
   let l=Infinity,t=Infinity,r=-Infinity,z=-Infinity,n=0;
   for(let y=0;y<main.height;y++)for(let x=0;x<main.width;x++){const k=(y*main.width+x)*4;if(p[k+1]>150&&p[k+1]>p[k]*2&&p[k+1]>p[k+2]*2){const det=a*d-b*c,xx=(d*(x+.5-e)-c*(y+.5-h))/det,yy=(-b*(x+.5-e)+a*(y+.5-h))/det;l=Math.min(l,xx);r=Math.max(r,xx);t=Math.min(t,yy);z=Math.max(z,yy);n++;}}
   if(!n)throw Error('text disappeared');report.samples.push({l,r,t,z,n,scale:a});
  }
  const spread=(key:string)=>Math.max(...report.samples.map((s:any)=>s[key]))-Math.min(...report.samples.map((s:any)=>s[key]));
  report.checks.push({name:'preview zoom preserves logical font size',pass:fonts.size===1,fonts:[...fonts]});
  report.checks.push({name:'deformed glyph ink stays locked to its affine scene coordinates',pass:['l','r','t','z'].every(k=>spread(k)<1.5),spread:Object.fromEntries(['l','r','t','z'].map(k=>[k,spread(k)]))});
  report.checks.push({name:'test really zoomed',pass:spread('scale')>.2});
  const matrix=JSON.parse(main.dataset.textLogicalFrame!).matrix,box=main.getBoundingClientRect();
  const x=box.left+matrix[4]/main.width*box.width,y=box.top+matrix[5]/main.height*box.height;
  for(const type of ['pointerdown','pointerup'])main.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:5591,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerup'?0:1}));
  await wait(5);document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(30);
  const editor=document.querySelector<HTMLElement>('[data-text-editor]'),scroll=document.querySelector<HTMLElement>('[data-text-editor-scroll]');
  if(!editor||!scroll)throw Error('text editing pane missing');
  for(const name of ['字體','樣式']){
   editor.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.click();await wait(5);
   const a=editor.getBoundingClientRect(),b=scroll.getBoundingClientRect();
   report.checks.push({name:name+' scroll fills pane without upper/lower strips',pass:Math.abs(a.top-b.top)<1&&Math.abs(a.bottom-b.bottom)<1});
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.id='text-warp-result';pre.hidden=true;pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
