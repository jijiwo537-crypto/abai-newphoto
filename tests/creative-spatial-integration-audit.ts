import {get2dWide} from '../utils/colorSpace';
void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n:number)=>{for(let i=0;i<n;i++)await tick();};
 const checks:any[]=[];let error:string|undefined;
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.sceneGeometry)break;await tick();}
  const canvas=stage!.querySelector('canvas')!,o=JSON.parse(stage!.dataset.sceneGeometry!),r=canvas.getBoundingClientRect();
  const x=r.left+(o.ix+o.iw*.2)/o.cw*r.width,y=r.top+(o.iy+o.ih*.2)/o.ch*r.height;
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:2431,pointerType:'touch',clientX:x,clientY:y,buttons:type==='pointerdown'?1:0}));
  await wait(2);document.querySelector<HTMLButtonElement>('[data-creative-tab="objedit"]')!.click();await wait(2);
  const btn=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim().endsWith(name));
  btn('特效')!.click();await wait(2);
  for(const id of ['fxGlass','fxExposureSpill','softLight','halation']){
   if(!document.querySelector(`[data-fx-card="${id}"]`)){btn('返回特效')?.click();await wait(2);}
   document.querySelector<HTMLButtonElement>(`[data-fx-card="${id}"]`)!.click();await wait(5);
   const live=document.querySelector<HTMLCanvasElement>('[data-base-spatial-presentation]')!;
   if(!live){checks.push({id,pass:false,reason:'resident scene missing'});continue;}
   const gl=live.getContext('webgl')!,w=live.width,h=live.height,bytes=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   const flipped=new Uint8ClampedArray(bytes.length);for(let y=0;y<h;y++)flipped.set(bytes.subarray(y*w*4,(y+1)*w*4),(h-y-1)*w*4);
   const actual=document.createElement('canvas');actual.width=w;actual.height=h;const a=get2dWide(actual)!;
   a.putImageData(new ImageData(flipped,w,h,{colorSpace:(gl as any).drawingBufferColorSpace==='display-p3'?'display-p3':'srgb'}),0,0);
   const reference=document.createElement('canvas');document.dispatchEvent(new CustomEvent('abai:qa-preview-reference',{detail:{canvas:reference}}));
   const px=a.getImageData(0,0,w,h).data,expected=reference.getContext('2d')!.getImageData(0,0,w,h).data;
   let total=0,max=0,large=0;for(let i=0;i<px.length;i++){const d=Math.abs(px[i]-expected[i]);total+=d;max=Math.max(max,d);if(d>5)large++;}
   checks.push({id,pass:total/px.length<1&&large/px.length<.01,max,mean:total/px.length,largeFraction:large/px.length,w,h,samples:[[.2,.2],[.5,.3],[.5,.6]].map(([x,y])=>{const i=(Math.floor(y*h)*w+Math.floor(x*w))*4;return{actual:Array.from(px.slice(i,i+4)),expected:Array.from(expected.slice(i,i+4))};})});
  }
 }catch(e){error=String(e);}
 const report={kind:'creative-spatial-integration',route:location.search,error,pass:!error&&checks.every(c=>c.pass),checks};
 const pre=document.createElement('pre');pre.hidden=true;pre.id='spatial-integration-result';pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
