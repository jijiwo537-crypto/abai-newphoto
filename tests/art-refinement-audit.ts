// Development-only audit of real mounted controls. Synthetic input, not a
// claim of physical-device gesture testing. Never imported by the main app.
export async function auditArtRefinement(){
 const settle=async(n=4)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const click=(name:string)=>{const b=[...document.querySelectorAll<HTMLButtonElement>('.art-studio button')].find(n=>n.textContent?.trim()===name||n.getAttribute('aria-label')===name);if(!b)throw Error(name);b.click();};
 const input=(name:string)=>document.querySelector<HTMLInputElement>(`.art-controls input[type=range][aria-label="${name}"]`)!;
 const change=async(name:string,value:number)=>{const n=input(name);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(n,String(value));n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));await settle();};
 while(!document.querySelector('.art-save:not(:disabled)'))await settle();
 if(new URLSearchParams(location.search).has('sliders')){
  try{const response=await fetch('http://127.0.0.1:5192/photo');if(response.ok){const data=new DataTransfer();data.items.add(new File([await response.blob()],'photo.jpg',{type:'image/jpeg'}));const n=document.querySelector<HTMLInputElement>('.art-studio input[type=file]')!;n.files=data.files;n.dispatchEvent(new Event('change',{bubbles:true}));await settle();while(document.querySelector('.art-save:disabled'))await settle();}}catch{}
  const frames:any[]=[];
  const measure=async(page:string)=>{
   await settle(8);
   for(const n of document.querySelectorAll<HTMLInputElement>('.art-controls input[type=range]')){
    const initial=n.value,set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!,times=[];let last=performance.now();
    for(let i=0;i<35;i++){await settle(1);const now=performance.now();if(i>5)times.push(now-last);last=now;const step=Number(n.step)||1,min=+n.min,max=+n.max;set.call(n,String(min+Math.round((max-min)*(.5+.4*Math.sin(i*.3))/step)*step));n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}
    set.call(n,initial);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));await settle();times.sort((a,b)=>a-b);frames.push({page,name:n.getAttribute('aria-label'),p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1)});
   }
  };
  click('字符');await measure('ASCII 字符');click('範圍');await measure('ASCII 範圍');click('效果');await settle();click('視覺追蹤');await settle();
  for(const [tab,section] of [['節點','偵測'],['節點','輪廓'],['節點','連線'],['構圖','顏色'],['構圖','元素'],['遮罩','編輯']]){click(tab);await settle();click(section);await measure(tab+'/'+section);}
  click('構圖');await settle();click('元素');await settle();for(const name of ['圓圈','黃金比例']){click(name);await measure('元素/'+name);}
  click('遮罩');await settle();click('編輯');await settle();await change('數量',30);click('材質');await settle();click('霧玻璃');click('負片');await settle();click('細節');await measure('30 遮罩/細節');
  await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'art-slider-refinement',ua:navigator.userAgent,input:'synthetic real mounted controls',frames})});
  click('效果');await settle();
 }
 click('視覺追蹤');await settle();click('節點');await settle();click('輪廓');await settle();click('圓形');click('選中框');click('交叉框');await settle();await change('大小',80);await change('變化',100);
 const rects=[...document.querySelectorAll('.art-vectors path')].map(n=>n.getAttribute('d')?.match(/^M[-\d.e]+ [-\d.e]+h([-\d.e]+)v([-\d.e]+)/)).filter(Boolean).map(m=>({width:+m![1],height:+m![2]}));
 const ratio=(r:{width:number;height:number})=>Math.max(r.width/r.height,r.height/r.width);
 const contours=[...document.querySelectorAll('.art-scroll button')].map(n=>n.textContent);
 const scroll=document.querySelector<HTMLElement>('.art-scroll')!;scroll.scrollLeft=scroll.scrollWidth;await settle();
 const scrollBoundary={left:scroll.scrollLeft,max:scroll.scrollWidth-scroll.clientWidth,overscroll:getComputedStyle(scroll).overscrollBehavior};
 click('偵測');await settle();click('隨機分佈');
 const randomButton=[...document.querySelectorAll('button')].find(n=>n.textContent==='隨機分佈')!;
 const randomFeedback=randomButton.getAnimations().flatMap(a=>(a.effect as KeyframeEffect).getKeyframes());
 click('構圖');await settle();click('元素');await settle();const positions=[];
 for(const name of ['取景框','圓圈','黃金比例']){click(name);await settle();positions.push({name,y:[...document.querySelectorAll('.art-element-ranges input')].map(n=>n.getBoundingClientRect().y)});}
 const angles=[];for(const a of [90,180]){await change('角度',a);angles.push({value:input('角度').value,step:input('角度').step});}
 const compare=document.querySelector<HTMLButtonElement>('.art-compare')!;compare.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await settle();
 const feedback={pressed:compare.getAttribute('aria-pressed'),background:getComputedStyle(compare).backgroundColor,shadow:getComputedStyle(compare).boxShadow};compare.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));await settle();
 click('顏色');await settle();click('薄荷');await settle();await change('色相',200);await change('飽和度',65);await change('明度',90);
 const panel=document.querySelector('.art-controls')!.getBoundingClientRect(),sliders=[...document.querySelectorAll('.art-controls input[type=range]')].map(n=>({name:n.getAttribute('aria-label'),bottom:n.getBoundingClientRect().bottom}));
 const report={ua:navigator.userAgent,input:'synthetic real mounted controls',contours,rects:{count:rects.length,squares:rects.filter(r=>Math.abs(r.width-r.height)<1e-8).length,portrait:rects.filter(r=>r.height>r.width).length,landscape:rects.filter(r=>r.width>r.height).length,maxRatio:Math.max(...rects.map(ratio))},positions,angles,feedback,randomFeedback,scrollBoundary,colorSliders:sliders,clipped:sliders.some(r=>r.bottom>panel.bottom),swatches:[...document.querySelectorAll('.art-swatches button')].map(n=>n.getAttribute('aria-label')),viewport:[innerWidth,innerHeight]};
 (window as any).__artRefinement=report;
 await fetch('http://127.0.0.1:5192/results',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(report)}).catch(()=>{});
}
