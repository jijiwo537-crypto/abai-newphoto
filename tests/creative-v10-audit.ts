void(async()=>{
 const wait=async(n=8)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'creative-v10',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='2'&&stage.querySelector('canvas')?.width)break;await wait(1);}await wait(20);
  const count=()=>Number(stage!.dataset.patternCount);
  const texture=()=>document.querySelector<HTMLElement>('[data-creative-texture]')!;
  const seam=document.querySelector<HTMLElement>('[data-creative-seamless]')!;
  check('seamless renders slider without visible fusion label',!!seam.querySelector('input')&&!seam.textContent?.includes('融合程度'));
  check('initial six patterns and normal texture visible',count()===6&&!texture().hidden,{count:count()});
  const click=async(label:string)=>{document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();await wait(20);};
  await click('遮罩排版 mask-top');check('non-full transitions retain count',count()===6);
  for(const [label,expected] of [['滿版',6],['遮罩排版 mask-bottom',6],['滿版',6],['遮罩排版 mask-left',6],['滿版',6],['遮罩排版 mask-bottom',6]] as const){
   await click(label);
   check(label+' count '+expected,count()===expected,{count:count()});
   check(label+' texture visibility',texture().hidden===(label==='滿版'));
   if(label==='滿版'){check('full remains 3:4',stage!.dataset.canvasRatio==='3:4');await click('滿版');check('reselecting full does not multiply twice',count()===expected);}
  }
  check('leaving full restores original ratio',stage!.dataset.canvasRatio==='1:1');
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
