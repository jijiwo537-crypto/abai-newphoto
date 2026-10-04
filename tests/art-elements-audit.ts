const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
const wait=async()=>{for(let i=0;i<4;i++)await frame();};
void(async()=>{
 const checks:{name:string;pass:boolean;detail?:unknown}[]=[];
 const check=(name:string,pass:boolean,detail?:unknown)=>checks.push({name,pass,detail});
 while(!document.querySelector('.art-effect-list'))await frame();
 const click=(name:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===name)!.click();
 click('視覺追蹤');await wait();click('元素');await wait();
 check('composition renamed elements and text subpage removed',!document.querySelector('.art-subtabs')&&!document.body.textContent?.includes('角落文字'));
 check('viewfinder starts off on first entry',(document.querySelector('fieldset[aria-label="取景框調整"]') as HTMLFieldSetElement).disabled);
 check('golden ratio and selector row removed',!document.body.textContent?.includes('黃金比例')&&!document.querySelector('.art-elements'));
 const group=(key:string)=>document.querySelector<HTMLElement>(`section[aria-label="${key}設定"]`)!;
 for(const name of ['取景框','圓圈']){
  const section=group(name),toggle=(text:string)=>Array.from(section.querySelectorAll('button')).find(b=>b.textContent===text)!;
  check(name+' two sliders visible',section.querySelectorAll('input[type=range]').length===2);
  toggle('關閉').click();await wait();
  check(name+' disabled while off',Array.from(section.querySelectorAll('input')).every(i=>i.matches(':disabled')));
  toggle('開啟').click();await wait();
  check(name+' enabled while on',Array.from(section.querySelectorAll('input')).every(i=>i.matches(':enabled')));
  toggle('關閉').click();await wait();
 }
 click('節點');await wait();click('元素');await wait();
 check('reentry retains manual off states',Array.from(document.querySelectorAll('.art-element-stack fieldset')).every(f=>(f as HTMLFieldSetElement).disabled));
 const bounds=Array.from(document.querySelectorAll('.art-element-stack input')).map(i=>{const r=i.getBoundingClientRect();return{x:r.x,y:r.y,bottom:r.bottom,width:r.width};});
 const panel=document.querySelector('.art-controls')!.getBoundingClientRect();
 check('both groups fit without scrolling',bounds.every(r=>r.bottom<=panel.bottom&&r.y>=panel.top)&&document.querySelector('.art-controls')!.scrollHeight<=document.querySelector('.art-controls')!.clientHeight+1,{bounds,panel:{top:panel.top,bottom:panel.bottom}});
 const report={kind:'art-elements-v26',pass:checks.every(c=>c.pass),checks};
 const out=document.createElement('pre');out.id='art-elements-result';out.dataset.report=JSON.stringify(report);out.hidden=true;document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
