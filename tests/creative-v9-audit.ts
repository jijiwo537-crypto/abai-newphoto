/** Mounted editor checks: defaults, icon-only brush and seamless thresholds. */
void(async()=>{
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'creative-v9',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='2'&&stage.querySelector('canvas')?.width)break;await wait(1);}await wait(25);
  const canvas=stage!.querySelector<HTMLCanvasElement>('canvas')!,ctx=canvas.getContext('2d')!;
  const pixel=[...ctx.getImageData(Math.round(canvas.width*.5),Math.round(canvas.height*.9),1,1,{colorSpace:'srgb'}).data];
  check('fresh mask uses CFE6DE without changing imported photos',pixel.every((v,i)=>Math.abs(v-[207,230,222,255][i])<=1),pixel);
  const brush=document.querySelector<HTMLButtonElement>('[data-creative-brush-toggle]')!;
  for(const mode of ['pen','eraser','off']){
   brush.click();await wait(14);const style=getComputedStyle(brush);
   check(mode+' brush mode has no surrounding frame or background',style.backgroundColor==='rgba(0, 0, 0, 0)'&&style.borderWidth==='0px'&&style.boxShadow==='none',{bg:style.backgroundColor,border:style.borderWidth,shadow:style.boxShadow});
   check(mode+' uses only icon brightness',style.color===(mode==='off'?'rgb(136, 136, 136)':'rgb(255, 255, 255)'));
  }
  const seam=document.querySelector<HTMLElement>('[data-creative-seamless]')!,slider=seam.querySelector<HTMLInputElement>('input')!;
  check('seamless slider exists while disabled with no switch buttons',!!slider&&slider.value==='0'&&seam.querySelectorAll('button').length===0);
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  for(const value of [1,2,30,100,1,0]){
   const before=Number(canvas.dataset.paintCount||0);
   setter.call(slider,String(value));slider.dispatchEvent(new Event('input',{bubbles:true}));
   slider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));await wait(8);
   const state=JSON.parse(stage!.dataset.photoSeamless!);
   check('amount '+value+' retains value and enables from one',state.on===(value>=1)&&state.amount===value&&slider.value===String(value),state);
   check('amount '+value+' repaints without removing the slider',Number(canvas.dataset.paintCount||0)>before&&slider.isConnected);
  }
  const footer=document.querySelector('footer')!,frame=canvas.parentElement!;
  const before={h:footer.getBoundingClientRect().height,w:frame.getBoundingClientRect().width};
  document.querySelector<HTMLButtonElement>('[aria-label="所有圖片佈局"]')!.click();
  const frames:any[]=[];for(let i=0;i<30;i++){await wait(1);frames.push({h:footer.getBoundingClientRect().height,w:frame.getBoundingClientRect().width});}
  const end=frames.at(-1)!;
  check('catalog expands footer and shrinks preview',end.h>before.h+60&&end.w<before.w-5,{before,end});
  check('catalog transition has intermediate frames without overshoot',new Set(frames.map(f=>Math.round(f.h))).size>2&&frames.every((f,i)=>f.h>=before.h&&f.h<=end.h+.5&&(!i||f.h>=frames[i-1].h-.5)),frames);
  document.querySelector<HTMLButtonElement>('[aria-label="返回圖片排版"]')!.click();await wait(30);
  check('catalog return restores preview geometry',Math.abs(footer.getBoundingClientRect().height-before.h)<1&&Math.abs(frame.getBoundingClientRect().width-before.w)<1);
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 if(!new URLSearchParams(location.search).has('proof')){const pre=document.createElement('pre');pre.style.cssText='position:fixed;top:65px;left:8px;z-index:999999;max-height:170px;overflow:auto;background:#111e;color:white;font-size:10px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 if(new URLSearchParams(location.search).has('keyboard'))document.querySelector<HTMLButtonElement>('[aria-label="遮罩顏色"]')?.click();
})();
