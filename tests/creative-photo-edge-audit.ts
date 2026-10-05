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
   const composited=new URLSearchParams(location.search).has('composited');
   const viewport=stage!.getBoundingClientRect(),mainBox=main.getBoundingClientRect();
   const copy=document.createElement('canvas');copy.width=composited?Math.ceil(viewport.width*3):main.width;copy.height=composited?Math.ceil(viewport.height*3):main.height;const g=get2dWide(copy)!;
   const b=composited?viewport:mainBox;
   if(composited){
    // Reproduce the CSS filter footprint and fractional layer placement, not
    // only the framebuffer. This catches transparent texels outside the window.
    const tile=document.createElement('canvas');tile.width=gpu.width;tile.height=gpu.height;
    copySeamPreviewPixels(gpu,get2dWide(tile)!);
    g.fillStyle='#000';g.fillRect(0,0,copy.width,copy.height);
    const paint=(source:HTMLCanvasElement,box:DOMRect)=>g.drawImage(source,(box.left-b.left)/b.width*copy.width,(box.top-b.top)/b.height*copy.height,box.width/b.width*copy.width,box.height/b.height*copy.height);
    paint(tile,gpu.getBoundingClientRect());
    if(!new URLSearchParams(location.search).has('guardFootprint')&&getComputedStyle(main).opacity!=='0')paint(main,mainBox);
    tile.width=tile.height=1;
   }else{copySeamPreviewPixels(gpu,g,Number(gpu.dataset.presentationX||0),Number(gpu.dataset.presentationY||0));if(getComputedStyle(main).opacity!=='0')g.drawImage(main,0,0);}
   const pixels=g.getImageData(0,0,copy.width,copy.height).data;let min=255,bad=0,n=0;const examples:any[]=[];
   for(const cell of stage!.querySelectorAll<HTMLElement>('[data-photo-cell]')){
    const r=cell.getBoundingClientRect(),inset=composited&&!new URLSearchParams(location.search).has('guardFootprint')?1/3:0;const l=Math.max(r.left+inset,viewport.left,b.left),t=Math.max(r.top+inset,viewport.top,b.top),rr=Math.min(r.right-inset,viewport.right,b.right),bb=Math.min(r.bottom-inset,viewport.bottom,b.bottom);
    if(rr-l<4||bb-t<4)continue;
    // Inspect every physical pixel along the shared borders, not a sparse
    // screenshot grid which can miss a one-pixel crack at fractional zoom.
    const x0=Math.max(0,Math.ceil((l-b.left)/b.width*copy.width-.5)),x1=Math.min(copy.width-1,Math.floor((rr-b.left)/b.width*copy.width-.5));
    const y0=Math.max(0,Math.ceil((t-b.top)/b.height*copy.height-.5)),y1=Math.min(copy.height-1,Math.floor((bb-b.top)/b.height*copy.height-.5));
    const sample=(x:number,y:number)=>{const k=(y*copy.width+x)*4,v=Math.min(pixels[k],pixels[k+1],pixels[k+2]);min=Math.min(min,v);bad+=v<245?1:0;n++;if(v<245&&examples.length<4)examples.push({x,y,v,cell:{x:r.x,y:r.y,w:r.width,h:r.height},stage:{x:b.x,y:b.y,w:b.width,h:b.height},gpu:gpu.getBoundingClientRect().toJSON()});};
    for(let x=x0+2;x<=x1-2;x++){sample(x,y0);sample(x,y1);}
    for(let y=y0+2;y<=y1-2;y++){sample(x0,y);sample(x1,y);}
   }
   let maskBad=0,maskSamples=0;const maskExamples:any[]=[];
   const cells=Array.from(stage!.querySelectorAll<HTMLElement>('[data-photo-cell]')).map(c=>c.getBoundingClientRect());
   const edgeRight=Math.max(...cells.map(c=>c.right)),edgeTop=Math.min(...cells.map(c=>c.top)),edgeBottom=Math.max(...cells.map(c=>c.bottom));
   const px=(x:number)=>Math.ceil((x-b.left)/b.width*copy.width-.5),py=(y:number)=>Math.ceil((y-b.top)/b.height*copy.height-.5);
   const ex=px(edgeRight),ay=Math.max(0,py(Math.max(edgeTop+4,viewport.top+4))),by=Math.min(copy.height,py(Math.min(edgeBottom-4,viewport.bottom-4)));
   // The mask side must remain exactly its own colour, not a white photo
   // overdraw/fringe. Test at native pixels (CSS resizing may legitimately
   // interpolate the two neighbouring colours across one physical pixel).
   if(!composited&&ex>=0&&ex+10<copy.width)for(let yy=ay;yy<by;yy++){
    const reference=(yy*copy.width+ex+10)*4;
    // At the viewport's right edge the far reference can lie outside the
    // deliberately bounded presentation surface, where no scene is rendered.
    if(pixels[reference+3]!==255)continue;
    for(let xx=ex;xx<=ex+2;xx++){
     const k=(yy*copy.width+xx)*4;let delta=0;
     for(let channel=0;channel<4;channel++)delta=Math.max(delta,Math.abs(pixels[k+channel]-pixels[reference+channel]));
     maskBad+=delta>2?1:0;maskSamples++;
     if(delta>2&&maskExamples.length<2)maskExamples.push({xx,yy,ex,delta,pixel:Array.from(pixels.slice(k,k+4)),reference:Array.from(pixels.slice(reference,reference+4)),edgeRight,box:b.toJSON(),size:[copy.width,copy.height]});
    }
   }
   copy.width=copy.height=1;return {min,bad,n,maskBad,maskSamples,maskExamples,examples,bytes:gpu.dataset.residentTextureBytes};
  };
  const eachFrame=new URLSearchParams(location.search).has('eachFrame'),frames=eachFrame?120:60;
  for(let i=0;i<frames;i++){
   const r=stage.getBoundingClientRect();stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,deltaY:(i<frames/2?-1:1)*(eachFrame?15:30)}));await wait(3);
   if(eachFrame||i%3===0)report.samples.push({i,...scan()});
  }
  report.checks.push({name:'no dark cracks in filled photo borders through zoom',pass:report.samples.every((s:any)=>s.bad===0),detail:report.samples});
  if(!new URLSearchParams(location.search).has('composited'))report.checks.push({name:'photo and mask have no overdraw or white fringe at shared boundary',pass:report.samples.some((s:any)=>s.maskSamples>0)&&report.samples.every((s:any)=>s.maskBad===0),detail:report.samples.map((s:any)=>({i:s.i,bad:s.maskBad,n:s.maskSamples,examples:s.maskExamples}))});
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.error=String(e);report.pass=false;}
 const result=document.createElement('pre');result.id='photo-edge-result';result.hidden=true;result.dataset.report=JSON.stringify(report);document.body.append(result);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
