// Mounted-control round trips in actual iOS WebKit.
// Native input events verify React/storage mapping, not physical-touch FPS.
import {FX_DEFS} from '../utils/glEffects';
export async function auditFineSlider(){
 // Background WebKit can suspend rAF; these functional checks are not FPS tests.
 const frame=()=>new Promise<void>(r=>{let done=false;const finish=()=>{if(!done){done=true;r();}};requestAnimationFrame(finish);setTimeout(finish,40);});
 const wait=async(n=5)=>{for(let i=0;i<n;i++)await frame();};
 const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label||b.getAttribute('aria-label')===label)!;
 const results:any[]=[],details:any[]=[];
 (window as any).__detailProgress={results,details};
 const previewHash=()=>{const source=document.querySelector<HTMLCanvasElement>('canvas[aria-hidden=true]');if(!source)return null;const c=document.createElement('canvas');c.width=160;c.height=200;const g=c.getContext('2d')!;g.drawImage(source,0,0,160,200);let h=2166136261;for(const n of g.getImageData(0,0,160,200).data)h=Math.imul(h^n,16777619);return h>>>0;};
 while(!button('magic_button特效')){if([...document.querySelectorAll('button')].some(b=>b.textContent?.includes('特效')))break;await frame();}
 await wait(20);[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('特效'))!.click();await wait();
 for(const fx of FX_DEFS.filter(d=>d.params.filter(p=>!p.hidden).length)){
  const card=document.querySelector<HTMLElement>('[data-fx-tool='+fx.id+']');if(!card)continue;
  card.click();await wait(5);card.querySelector<HTMLElement>('[aria-label="調整細項"]')!.click();await wait(5);
  const params=[...document.querySelectorAll<HTMLButtonElement>('[data-fx-param]')];
  for(const p of params){p.click();await wait(2);const sliders=[...document.querySelectorAll<HTMLInputElement>('input[type=range]')];const el=sliders[0],r=el.getBoundingClientRect();
   details.push({id:p.dataset.fxParam,count:sliders.length,width:r.width,value:+el.value,min:+el.min,max:+el.max,label:el.getAttribute('aria-label')});
  }
  button('返回特效').click();await wait(2);
 }
 document.querySelector<HTMLElement>('[data-fx-tool=fxExposureSpill]')!.click();await wait();
 document.querySelector<HTMLElement>('[data-fx-tool=fxExposureSpill] [aria-label="調整細項"]')!.click();await wait();
 for(const key of ['fxExposureSpill','fxSpillRange','fxSpillDiffusion','fxSpillHue']){
  document.querySelector<HTMLElement>('[data-fx-param='+key+']')!.click();await wait();
  const el=document.querySelector<HTMLInputElement>('input[type=range]')!,start=+el.value,max=+el.max,values=[];
  const before=previewHash();
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:91,pointerType:'touch'}));
  for(let i=0;i<16;i++){setter.call(el,String(Math.min(max,start+i)));el.dispatchEvent(new Event('input',{bubbles:true}));values.push(+el.value);await frame();}
  const during=previewHash();el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:91,pointerType:'touch'}));await wait();
  results.push({key,start,values,final:el.value,before,during,after:previewHash(),jump:Math.max(...values.slice(1).map((v,i)=>Math.abs(v-values[i])))});
 }
 const report={kind:'editor-fine-sliders-oct02',ua:navigator.userAgent,details,results,passed:details.length>40&&details.every(r=>r.count===1&&r.width>innerWidth*.7)&&details.find(r=>r.id==='fxSpillRange')?.value===20&&details.find(r=>r.id==='fxSpillDiffusion')?.min===0&&results.every(r=>r.jump===1&&+r.final===r.start+15)};
 (window as any).__fineSliderAudit=report;
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
 const out=document.createElement('pre');out.textContent=JSON.stringify({passed:report.passed,controls:details.length,results},null,2);Object.assign(out.style,{position:'fixed',inset:'80px 8px',background:'#000d',color:'white',fontSize:'12px',zIndex:99999});document.body.append(out);
}
