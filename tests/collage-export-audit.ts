void(async()=>{
 const wait=async(n=5)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const report:any={kind:'collage-export-menu',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 try{
  let toggle:HTMLButtonElement|null=null;for(let i=0;i<500;i++){toggle=document.querySelector('[data-grid-export-options-toggle],[data-creative-export-options-toggle]');if(toggle)break;await wait(1);}await wait(35);
  report.editor=toggle!.hasAttribute('data-grid-export-options-toggle')?'grid':'creative';
  toggle!.click();await wait();
  const panel=document.querySelector<HTMLElement>('[data-collage-export-options]')!;
  const button=(name:string)=>[...panel.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!;
  report.signature=[...panel.children].map(row=>({label:row.querySelector('span')?.textContent,buttons:[...row.querySelectorAll('button')].map(b=>b.textContent)}));
  check('same four export groups and MOV third',JSON.stringify(report.signature)===JSON.stringify([
   {label:'圖片格式',buttons:['JPG','PNG','HEIC']},{label:'影片格式',buttons:['自動','MP4','MOV']},{label:'影片幀率',buttons:['自動','30','50','60','120']},{label:'影片畫質',buttons:['標準','高','最高']}])) ;
  check('MOV gated by real QuickTime capability',button('MOV').disabled===!(['video/quicktime;codecs=avc1','video/quicktime'].some(t=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(t))));
  for(const name of ['JPG','60','標準']){button(name).click();await wait();check(name+' selection updates immediately',button(name).getAttribute('aria-pressed')==='true');}
  const save=[...document.querySelectorAll<HTMLButtonElement>('header button')].find(b=>b.textContent?.trim()==='儲存')!;
  save.click();await wait();
  if(report.editor==='creative'){[...document.querySelectorAll<HTMLButtonElement>('header button')].find(b=>b.textContent?.replace(/\s/g,'')==='儲存圖片')!.click();}
  let img:HTMLImageElement|null=null;for(let i=0;i<1800;i++){img=document.querySelector('[data-export-media] img');if(img?.src)break;await wait(1);}
  if(!img?.src)throw Error('export preview did not appear');
  const blob=await(await fetch(img.src)).blob(),bytes=new Uint8Array(await blob.arrayBuffer());
  check('selected JPG produces actual JPEG file',blob.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216,{type:blob.type,bytes:blob.size});
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 if(new URLSearchParams(location.search).has('proof')){
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='繼續編輯')?.click();await wait(12);
  document.querySelector<HTMLButtonElement>('[data-grid-export-options-toggle],[data-creative-export-options-toggle]')?.click();
 }
})();
