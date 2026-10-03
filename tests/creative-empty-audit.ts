const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
const report:any={kind:'creative-empty-cell',ua:navigator.userAgent,checks:[]};
const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
try{
  let stage:HTMLElement|null=null;for(let i=0;i<300;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='2')break;await wait();}
  if(!stage)throw Error('Missing two-photo fixture');await wait(20);
  document.querySelector<HTMLButtonElement>('button[aria-label="所有圖片佈局"]')!.click();await wait(2);
  document.querySelector<HTMLButtonElement>('[data-layout-count="9"][data-layout-index="0"]')!.click();await wait(5);
  check('template selection keeps the picker open',!!document.querySelector('[data-photo-layout-options]'));
  document.querySelector<HTMLButtonElement>('[aria-label="返回圖片排版"]')!.click();await wait(2);
  const photos=()=>JSON.parse(stage!.dataset.photoTransforms!);
  check('larger layout keeps both photos and exposes seven empty slots',photos().length===9&&photos().filter((p:any)=>p.src).length===2&&document.querySelectorAll('[data-photo-cell] button').length===7);
  const input=document.querySelector<HTMLInputElement>('input[aria-label="填入圖片排版"]')!,dt=new DataTransfer();
  document.querySelector<HTMLButtonElement>('[data-photo-cell="2"] button')!.click();
  for(const color of ['#1ab5ee','#fed012']){
    const c=document.createElement('canvas');c.width=c.height=100;const g=c.getContext('2d')!;g.fillStyle=color;g.fillRect(0,0,100,100);
    const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!)));dt.items.add(new File([blob],color+'.png',{type:'image/png'}));
  }
  input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  for(let i=0;i<300;i++){await wait();if(photos().filter((p:any)=>p.src).length===4)break;}
  check('batch upload fills successive empty slots without touching originals',!!photos()[0].src&&!!photos()[1].src&&!!photos()[2].src&&!!photos()[3].src&&photos().slice(4).every((p:any)=>!p.src));
  check('empty placeholders disappear only for filled cells',document.querySelectorAll('[data-photo-cell] button').length===5);
  report.pass=report.checks.every((c:any)=>c.pass);
}catch(error){report.pass=false;report.error=String(error);}
const result=document.createElement('pre');result.id='creative-empty-result';result.style.cssText='position:fixed;top:60px;left:8px;z-index:9999;background:#111e;color:white;font-size:10px';result.textContent=JSON.stringify(report,null,2);document.body.append(result);
await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
