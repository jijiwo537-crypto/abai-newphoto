// Runs only in the installed standalone QA fixture, never in the production app.
// Uses real controls and rAF timing on iOS WebKit; synthetic input is explicitly
// recorded as such and is not a substitute for physical-device touch testing.
export async function auditArtControls(){
 const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const settle=async(n=4)=>{for(let i=0;i<n;i++)await frame();};
 const click=(name:string)=>{const b=Array.from(document.querySelectorAll<HTMLButtonElement>('.art-studio button')).find(b=>b.textContent?.trim()===name||b.getAttribute('aria-label')===name);if(!b)throw Error('Missing control: '+name);b.click();};
 const binary=(name:string,on:boolean)=>{const group=document.querySelector(`[role=group][aria-label="${name}"]`)!;Array.from(group.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===(on?'開啟':'關閉'))!.click();};
 const results:any[]=[];
 let characterPixels=0;
 const multilingual:any[]=[];
 const benchmark=async(page:string)=>{
  await settle(8);
  for(const input of document.querySelectorAll<HTMLInputElement>('.art-controls input[type=range]')){
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
   const initial=input.value,frames:number[]=[];let last=performance.now();
   for(let i=0;i<50;i++){await frame();const now=performance.now();if(i>5)frames.push(now-last);last=now;setter.call(input,String(+input.min+(+input.max-+input.min)*i/49));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
   setter.call(input,initial);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await settle();frames.sort((a,b)=>a-b);
   results.push({page,slider:input.getAttribute('aria-label'),p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1)});
  }
 };
 while(!document.querySelector('.art-studio')){document.querySelector<HTMLButtonElement>('#root button')?.click();await frame();}
 while(!document.querySelector('.art-save:not(:disabled)'))await frame();
 // Optional local fixture endpoint; no photograph is uploaded or bundled.
 try{const response=await fetch('http://127.0.0.1:5192/photo');if(response.ok){const data=new DataTransfer();data.items.add(new File([await response.blob()],'fixture.jpg',{type:'image/jpeg'}));const input=document.querySelector<HTMLInputElement>('.art-studio input[type=file]')!;input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));while(document.querySelector('.art-save:disabled'))await frame();}}catch{}
 await settle(30);
 click('外觀');await settle();click('字符');await benchmark('白色字符');
 const ink=document.querySelector<HTMLCanvasElement>('.art-ink')!,pixels=ink.getContext('2d')!.getImageData(0,0,ink.width,ink.height).data;for(let i=3;i<pixels.length;i+=4)if(pixels[i])characterPixels++;
 click('外觀');await settle();binary('發光',true);await settle();click('字符');await benchmark('發光字符');click('外觀');await settle();binary('發光',false);click('原色');await settle();click('字符');await benchmark('原色字符');click('範圍');await benchmark('字符範圍');
 click('字符');await settle();document.querySelector<HTMLInputElement>('.art-chars input')!.click();await settle();
 const entry=document.querySelector<HTMLInputElement>('[role=dialog] input')!,setEntry=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
 for(const text of ['中文字','あいうが','한글한','中한あ✶']){setEntry.call(entry,text);entry.dispatchEvent(new Event('input',{bubbles:true}));entry.dispatchEvent(new Event('change',{bubbles:true}));await settle();multilingual.push({text,inkVisible:getComputedStyle(document.querySelector('.art-color-ink')!).display!=='none'});}
 document.querySelector<HTMLButtonElement>('[role=dialog] button[aria-label=完成]')!.click();await settle();await benchmark('多語字符');click('外觀');await settle();click('白色');await settle();click('字符');await benchmark('多語白色字符');
 click('效果');await settle();click('視覺追蹤');await settle();
 for(const [tab,section] of [['節點','偵測'],['節點','輪廓'],['節點','連線'],['構圖','外觀'],['構圖','圓圈鏈'],['構圖','取景框'],['區域','放置']]){click(tab);await settle();click(section);await benchmark(tab+'/'+section);}
 click('區域');await settle();click('霧玻璃');click('負片');await settle();click('細節');await benchmark('區域/細節');
 click('節點');await settle();click('輪廓');await settle();click('星星');click('方形');await settle();
 const bounds=(selector:string)=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};
 const report={renderer:'screen glyph outlines / fitted graphemes',userAgent:navigator.userAgent,standalone:(navigator as any).standalone,input:'synthetic real mounted controls',characterPixels,multilingual,viewport:[innerWidth,innerHeight],results,history:bounds('.art-history'),nav:bounds('.art-panel nav'),selected:Array.from(document.querySelectorAll('.art-presets button[aria-pressed=true]')).map(b=>b.textContent)};
 const geometry=document.getElementById('art-geometry');if(geometry)geometry.style.display='none';
 const out=document.createElement('pre');out.textContent='iPhone audit complete';Object.assign(out.style,{position:'fixed',top:'65px',left:'12px',zIndex:'9999',color:'#0f0',fontSize:'10px',pointerEvents:'none'});document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(report)}).catch(()=>{});
 // Leave the updated multilingual white-character appearance page visible for
 // the native screenshot check, after recording the tracking selections.
 click('效果');await settle();click('字符');await settle();click('外觀');await settle();
}
