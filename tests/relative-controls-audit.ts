// Development-only pixel + mounted-control verification in actual WebKit.
import {applyGlEffects} from '../utils/glEffects';
import {applyPhotoFx} from '../utils/photoFx';
import {paintTrackingMaterials} from '../utils/artTrackingGpu';
import {trackingDefaults,renderTracking,invalidateTracking} from '../utils/artTracking';
import {SVGContext} from '../utils/artVector';
export async function auditRelativeControls(){
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const settle=async()=>{for(let i=0;i<5;i++)await frame();};
 const hash=(c:HTMLCanvasElement)=>{const cp=document.createElement('canvas');cp.width=c.width;cp.height=c.height;const g=cp.getContext('2d')!;g.drawImage(c,0,0);let h=2166136261;for(const x of g.getImageData(0,0,c.width,c.height).data)h=Math.imul(h^x,16777619);return h>>>0;};
 const photo=document.createElement('canvas');photo.width=320;photo.height=400;const g=photo.getContext('2d',{willReadFrequently:true})!;
 const results:any={kind:'relative-controls',ua:navigator.userAgent,soft:[],mosaic:[],scope:[],ui:{}};
 const surface=document.createElement('canvas');
 for(const [name,low,high] of [['dim',10,60],['bright',170,230]] as [string,number,number][]){
  const gradient=g.createLinearGradient(0,0,320,400);gradient.addColorStop(0,`rgb(${low},${low},${low})`);gradient.addColorStop(1,`rgb(${high},${high},${high})`);g.fillStyle=gradient;g.fillRect(0,0,320,400);const original=hash(photo);
  const immutable=document.createElement('canvas');immutable.width=320;immutable.height=400;immutable.getContext('2d')!.drawImage(photo,0,0);
  for(const coverage of [0,10,30,70,100]){
   const first=applyPhotoFx(immutable,320,400,{soft:100,softThreshold:100-coverage,softRadius:70});
   const second=applyGlEffects(g,320,400,{fxExposureSpill:60,fxSpillRange:coverage},name,surface);
   results.soft.push({name,coverage,first:hash(first),sample:[...first.getContext('2d')!.getImageData(160,200,1,1).data],second:second?hash(second):null,original});await frame();
  }
 }
 // Non-uniform photograph: nearby high-end settings must produce different pixels.
 for(let y=0;y<400;y++)for(let x=0;x<320;x++){g.fillStyle=`rgb(${(x*13+y*7)%256},${(x*5+y*17)%256},${(x*3+y*23)%256})`;g.fillRect(x,y,1,1);}
 const gpu=document.createElement('canvas');
 for(const pixels of [40,41,42,50,51,52,57,58,59,60]){
  const ok=paintTrackingMaterials(gpu,photo,{...trackingDefaults,shapes:[],circles:0,count:1,zones:[{x:.5,y:.5}],size:90,materials:['mosaic'],pixels,zoneStroke:false});
  results.mosaic.push({pixels,ok,hash:ok?hash(gpu):null});await frame();
 }
 for(const threshold of [10,30,50,70,90]){invalidateTracking();const c=new SVGContext();renderTracking(c,photo,.6,{...trackingDefaults,threshold,vectorOnly:true,zoneStroke:false});results.scope.push({threshold,paths:c.parts.join('')});}
 while(!document.querySelector('.art-save:not(:disabled)'))await settle();
 const click=(label:string)=>{const b=[...document.querySelectorAll<HTMLButtonElement>('.art-studio button')].find(b=>b.textContent?.trim()===label);if(!b)throw Error('Missing '+label);b.click();};
 click('視覺追蹤');await settle();click('節點');await settle();results.ui.nodes=[...document.querySelectorAll('.art-subtabs button')].map(b=>b.textContent);
 click('輪廓');await settle();results.ui.size=document.querySelector<HTMLInputElement>('input[aria-label="大小"]')?.value;
 click('顏色');await settle();results.ui.swatches=document.querySelectorAll('.art-swatches button').length;
 click('構圖');await settle();results.ui.composition=[...document.querySelectorAll('.art-subtabs button')].map(b=>b.textContent);
 click('遮罩');await settle();results.ui.maskTabs=[...document.querySelectorAll('.art-subtabs button')].map(b=>b.textContent);
 const input=(name:string,n:number)=>{const el=document.querySelector<HTMLInputElement>('input[aria-label="'+name+'"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,String(n));el.dispatchEvent(new Event('input',{bubbles:true}));};
 input('數量',0);await settle();click('材質');await settle();results.ui.materials=[...document.querySelectorAll('.art-presets button')].map(b=>b.textContent);
 click('像素');await settle();click('編輯');await settle();results.ui.firstMaterialCount=document.querySelector<HTMLInputElement>('input[aria-label="數量"]')?.value;
 results.scope=results.scope.map((r:any)=>{let h=2166136261;for(const s of r.paths)h=Math.imul(h^s.charCodeAt(0),16777619);return {threshold:r.threshold,hash:h>>>0};});
 (window as any).__relativeAudit=results;
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(results)}).catch(()=>{});
 const out=document.createElement('pre');out.textContent=JSON.stringify(results,null,2);Object.assign(out.style,{position:'fixed',inset:'80px 8px',overflow:'auto',background:'#000d',color:'white',fontSize:'10px',zIndex:99999});document.body.append(out);
}
