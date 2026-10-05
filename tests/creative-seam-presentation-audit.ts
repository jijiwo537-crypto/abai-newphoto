import {copySeamPreviewPixels} from '../utils/seamlessPreview';
import {get2dWide} from '../utils/colorSpace';
void(async()=>{
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r())),wait=async(n=4)=>{while(n--)await frame();};
 const report:any={kind:'creative-seam-presentation',checks:[]};
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoTransforms)break;await frame();}await wait(50);
  document.querySelector<HTMLButtonElement>('[data-creative-tab="setting"]')!.click();await wait();
  const input=document.querySelector<HTMLInputElement>('[data-creative-seamless] input')!,setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  for(const amount of [1,30,70,100]){
   setter.call(input,String(amount));input.dispatchEvent(new Event('input',{bubbles:true}));await wait(8);
   const main=stage!.querySelector<HTMLCanvasElement>('canvas:not([data-creative-seam-presentation])')!,gpu=stage!.querySelector<HTMLCanvasElement>('[data-creative-seam-presentation]');
   if(main.dataset.creativePhotoComposition!=='single-canvas')throw Error('photos not composed into main canvas');
   const actual=document.createElement('canvas');actual.width=main.width;actual.height=main.height;const g=get2dWide(actual)!;
   if(gpu)copySeamPreviewPixels(gpu,g,Number(gpu.dataset.presentationX||0),Number(gpu.dataset.presentationY||0));g.drawImage(main,0,0);
   const reference=document.createElement('canvas');document.dispatchEvent(new CustomEvent('abai:qa-preview-reference',{detail:{canvas:reference,export:true}}));
   const a=g.getImageData(0,0,actual.width,actual.height).data,b=get2dWide(reference)!.getImageData(0,0,actual.width,actual.height).data;
   let max=0,sum=0,n=0;for(let y=8;y<actual.height-8;y+=13)for(let x=8;x<actual.width-8;x+=13){const i=(y*actual.width+x)*4;for(let k=0;k<4;k++){const d=Math.abs(a[i+k]-b[i+k]);max=Math.max(max,d);sum+=d;n++;}}
   report.checks.push({name:'direct preview matches export '+amount,pass:max<=3,detail:{max,mean:sum/n,size:[actual.width,actual.height]}});
   actual.width=actual.height=reference.width=reference.height=1;
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
