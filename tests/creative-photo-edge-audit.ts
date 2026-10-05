import {copySeamPreviewPixels} from '../utils/seamlessPreview';
import {get2dWide} from '../utils/colorSpace';
void(async()=>{
 const tick=()=>new Promise<void>(r=>requestAnimationFrame(()=>r())),wait=async(n=3)=>{while(n--)await tick();};
 const report:any={kind:'creative-photo-edges',checks:[],samples:[]};
 try{
  let stage:HTMLElement|null=null;
  for(let i=0;i<600;i++){stage=document.querySelector('[data-creative-stage]');if(stage?.dataset.photoCount==='3'&&stage.querySelector('[data-creative-seam-presentation]'))break;await tick();}
  if(!stage)throw Error('missing stage');await wait(60);
  const main=stage.querySelector<HTMLCanvasElement>('canvas:not([data-creative-seam-presentation])')!;
  const scan=()=>{
   const gpu=stage!.querySelector<HTMLCanvasElement>('[data-creative-seam-presentation]')!;
   const copy=document.createElement('canvas');copy.width=main.width;copy.height=main.height;const g=get2dWide(copy)!;
   copySeamPreviewPixels(gpu,g,Number(gpu.dataset.presentationX||0),Number(gpu.dataset.presentationY||0));g.drawImage(main,0,0);
   const pixels=g.getImageData(0,0,copy.width,copy.height).data,b=main.getBoundingClientRect(),viewport=stage!.getBoundingClientRect();let min=255,bad=0,n=0;
   for(const cell of stage!.querySelectorAll<HTMLElement>('[data-photo-cell]')){
    const r=cell.getBoundingClientRect();const l=Math.max(r.left,viewport.left,b.left),t=Math.max(r.top,viewport.top,b.top),rr=Math.min(r.right,viewport.right,b.right),bb=Math.min(r.bottom,viewport.bottom,b.bottom);
    if(rr-l<4||bb-t<4)continue;
    // Inspect every physical pixel along the shared borders, not a sparse
    // screenshot grid which can miss a one-pixel crack at fractional zoom.
    const x0=Math.max(0,Math.ceil((l-b.left)/b.width*copy.width-.5)),x1=Math.min(copy.width-1,Math.floor((rr-b.left)/b.width*copy.width-.5));
    const y0=Math.max(0,Math.ceil((t-b.top)/b.height*copy.height-.5)),y1=Math.min(copy.height-1,Math.floor((bb-b.top)/b.height*copy.height-.5));
    const sample=(x:number,y:number)=>{const k=(y*copy.width+x)*4,v=Math.min(pixels[k],pixels[k+1],pixels[k+2]);min=Math.min(min,v);bad+=v<245?1:0;n++;};
    for(let x=x0+2;x<=x1-2;x++){sample(x,y0);sample(x,y1);}
    for(let y=y0+2;y<=y1-2;y++){sample(x0,y);sample(x1,y);}
   }
   copy.width=copy.height=1;return {min,bad,n,bytes:gpu.dataset.residentTextureBytes};
  };
  for(let i=0;i<60;i++){
   const r=stage.getBoundingClientRect();stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,deltaY:i<30?-30:30}));await wait(3);
   if(i%3===0)report.samples.push({i,...scan()});
  }
  report.checks.push({name:'no dark cracks in filled photo borders through zoom',pass:report.samples.every((s:any)=>s.bad===0),detail:report.samples});report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
