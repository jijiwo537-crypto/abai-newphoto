// Development-only audit against the mounted editor, also run in iOS Safari.
void(async()=>{
 const errors:string[]=[];window.addEventListener('error',e=>{errors.push(e.message);void fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'compose-window-error',error:e.message})});});window.addEventListener('unhandledrejection',e=>{errors.push(String(e.reason));void fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'compose-audit-error',error:String(e.reason)})});});
 const wait=async(n=10)=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame);};
 const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(label));
 const rect=(el:Element)=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height};};
 while(!button('構圖')||!document.querySelector('canvas'))await wait();await wait(90);
 const before=rect(document.querySelector('canvas')!);button('構圖')!.click();await wait(30);
 const stage=Array.from(document.querySelectorAll('canvas')).at(-1)!;
 const after=rect(stage);let finite=true;
 const observe=new MutationObserver(()=>{for(const el of document.querySelectorAll<HTMLElement>('[data-geo]'))if(/NaN|Infinity/.test(el.style.cssText))finite=false;});observe.observe(document.body,{subtree:true,attributes:true,attributeFilter:['style']});
 let reads=0;const original=CanvasRenderingContext2D.prototype.getImageData;
 CanvasRenderingContext2D.prototype.getImageData=function(...args:Parameters<typeof original>){if(this.canvas.width>=1000&&this.canvas.height>=1000)reads++;return original.apply(this,args);};
 const routes=['濾鏡','調節','特效','遮色片'];
 for(let i=0;i<24;i++){
  button(routes[i%4])!.click();await wait(3);button('構圖')!.click();await wait(3);
  const crop=document.querySelector<HTMLElement>('[data-geo]');if(!crop)throw Error('Missing compose stage in cycle '+i);crop.click();await wait(2);
  if(i%4===3)void fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'compose-progress',cycle:i+1,reads,errors})});
 }
 const noOpReads=reads;
 let changedCrops=0;
 for(let i=0;i<8;i++){
  void fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'compose-crop-progress',cycle:i,phase:'start'})});
  button('自由')!.click();await wait(3);
  const crop=document.querySelector<HTMLElement>('[data-geo]')!,r=crop.getBoundingClientRect();
  const handle=crop.lastElementChild as HTMLElement;
  handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:50+i,clientX:r.right,clientY:r.y+r.height/2}));
  handle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:50+i,clientX:r.right-r.width*.015,clientY:r.y+r.height/2}));
  handle.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:50+i}));await wait(3);
  if(crop.getBoundingClientRect().width<r.width)changedCrops++;
  button(routes[i%4])!.click();await wait(8);button('構圖')!.click();await wait(8);
  void fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'compose-crop-progress',cycle:i,phase:'end'})});
 }
 button('濾鏡')!.click();await wait(20);
 const canvas=document.querySelector('canvas')!,cropped=canvas.width;
 const undo=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()==='undo')!,redo=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()==='redo')!;
 undo.click();await wait(10);const restored=canvas.width;redo.click();await wait(10);const redone=canvas.width;
 const historyWorks=restored>cropped&&redone===cropped;
 observe.disconnect();CanvasRenderingContext2D.prototype.getImageData=original;
 const visible=Array.from(document.querySelectorAll('canvas')).some(c=>c.width>0&&c.height>0&&c.getBoundingClientRect().width>0&&getComputedStyle(c).visibility!=='hidden');
 const passed=Math.abs(before.width-after.width)<1.1&&Math.abs(before.height-after.height)<1.1&&finite&&errors.length===0&&noOpReads===0&&changedCrops===8&&visible&&historyWorks;
 const report={kind:'editor-compose-stress',passed,before,after,cycles:32,noOpReads,changedCrops,finite,errors,visible,historyWorks,cropped,restored,redone,userAgent:navigator.userAgent};
 const out=document.createElement('pre');out.id='compose-audit-result';Object.assign(out.style,{position:'fixed',top:'80px',left:'12px',right:'12px',zIndex:'99999',background:'#000c',fontSize:'11px',color:passed?'#8f8':'#f88',pointerEvents:'none'});out.textContent=JSON.stringify(report,null,2);document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
