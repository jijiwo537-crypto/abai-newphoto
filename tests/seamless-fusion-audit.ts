import { renderSeamlessLayout } from '../utils/seamlessLayout';
import { get2dWide } from '../utils/colorSpace';
const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
const output=async(report:any)=>{
  const pre=document.createElement('pre');pre.id='fusion-audit-result';pre.textContent=JSON.stringify(report,null,2);pre.style.cssText='position:fixed;top:58px;left:4px;z-index:999999;color:white;background:#111e;font-size:10px;max-width:90vw;max-height:130px;overflow:auto';document.body.append(pre);
  await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
};
void(async()=>{
  try{
    while(!document.querySelector('svg[data-seamless-master][data-ready="true"]'))await wait();await wait(20);
    const layout=document.querySelector<HTMLElement>('[data-layout-id="seam-layout"]')!;
    layout.querySelector<HTMLElement>('[data-cell-id]')!.click();await wait(4);
    document.querySelector<HTMLButtonElement>('button[title="佈局調整"]')!.click();await wait(5);
    const slider=document.querySelector<HTMLInputElement>('input[aria-label="融合程度"]')!;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
    const change=(value:number)=>{setter.call(slider,String(value));slider.dispatchEvent(new Event('input',{bubbles:true}));};
    const svg=()=>layout.querySelector<SVGSVGElement>('svg[data-seamless-master]')!;
    const sources=JSON.parse(svg().dataset.sourceKey!)[1].map((c:any)=>c[0]);
    const clonePixels=async()=>{
      const master=layout.querySelector<HTMLCanvasElement>('canvas[data-seamless-layout]')!,c=document.createElement('canvas');c.width=master.width;c.height=master.height;const ctx=get2dWide(c)!,gl=master.getContext('webgl2');
      if(gl){const raw=new Uint8Array(c.width*c.height*4),pixels=new Uint8ClampedArray(raw.length);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);for(let y=0;y<c.height;y++)pixels.set(raw.subarray((c.height-1-y)*c.width*4,(c.height-y)*c.width*4),y*c.width*4);ctx.putImageData(new ImageData(pixels,c.width,c.height,{colorSpace:master.dataset.colorSpace as PredefinedColorSpace}),0,0);}
      else ctx.drawImage(master,0,0);
      return ctx.getImageData(0,0,c.width,c.height).data;
    };
    // Native SVG and export must share cover/crop and smoothstep feather geometry.
    const pixels:any[]=[];
    for(const amount of [0,50,100]){
      change(amount);await wait(4);const data=await clonePixels();
      const crop=JSON.parse(svg().dataset.seamlessCrop!),cells=sources.map((url:string,i:number)=>({url,zoom:crop[i][0],offsetX:crop[i][1],offsetY:crop[i][2],rotation:crop[i][3],opacity:crop[i][4]}));
      const root=svg(),master=layout.querySelector<HTMLCanvasElement>('canvas[data-seamless-layout]')!,view=JSON.parse(root.dataset.rasterView!),m=new DOMMatrix(view.slice(0,6)),forward=m.inverse(),world=root.viewBox.baseVal;
      const outputW=master.width,outputH=master.height,dpr=devicePixelRatio||1,cpuW=Math.ceil(Math.hypot(forward.a,forward.b)*world.width*dpr),cpuH=Math.ceil(Math.hypot(forward.c,forward.d)*world.height*dpr);
      const cpu=await renderSeamlessLayout(cells,JSON.parse(root.dataset.seamlessRects!),cpuW,cpuH,amount);
      const expectedCanvas=document.createElement('canvas');expectedCanvas.width=outputW;expectedCanvas.height=outputH;
      const matrix=new DOMMatrix([m.a*view[6]/outputW,m.b*view[6]/outputW,m.c*view[7]/outputH,m.d*view[7]/outputH,m.e,m.f]).inverse();
      const ec=get2dWide(expectedCanvas)!;ec.setTransform(matrix);ec.scale(world.width/cpuW,world.height/cpuH);ec.drawImage(cpu,0,0);cpu.width=cpu.height=0;
      const expected=ec.getImageData(0,0,outputW,outputH).data;
      let total=0,holes=0,compared=0;
      for(let y=2;y<outputH-2;y++)for(let x=2;x<outputW-2;x++){const i=(y*outputW+x)*4;if(data[i+3]!==255)holes++;if(expected[i+3]<255)continue;compared++;for(let c=0;c<3;c++)total+=Math.abs(data[i+c]-expected[i+c]);}
      pixels.push({amount,meanRGBDifference:total/Math.max(1,compared*3),holes,compared});
    }
    // Continuously change the actual mounted React input without releasing it.
    // Observe displayed results and frame deadlines, not only React state.
    const times:number[]=[],displayed:number[]=[];let expected=100;
    for(let i=0;i<180;i++){
      await wait();times.push(performance.now());displayed.push(Number(svg().dataset.seamlessAmount));
      expected=i<90?i:179-i;change(expected);
    }
    await wait(4);const finalVisible=Number(svg().dataset.seamlessAmount);
    const intervals=times.slice(1).map((t,i)=>t-times[i]);
    slider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:5}));await wait(8);
    const committed=Number(slider.value);
    // Toggle repeatedly: no stale master, no cancelling the latest frame.
    const toggle=document.querySelector<HTMLButtonElement>('button[aria-label="無縫拼圖"]')!;
    let togglePass=true;
    const retained=layout.querySelector<HTMLCanvasElement>('canvas[data-seamless-layout]')!,uploads=retained.dataset.sourceUploads;
    const toggleLatency:number[]=[];
    for(let i=0;i<3;i++){
      let start=performance.now();toggle.click();await wait();toggleLatency.push(performance.now()-start);
      togglePass&&=svg().dataset.active==='false'&&retained.style.visibility==='hidden';
      start=performance.now();toggle.click();await wait();toggleLatency.push(performance.now()-start);
      togglePass&&=svg().dataset.active==='true'&&retained.style.visibility==='visible'&&layout.querySelector('canvas[data-seamless-layout]')===retained&&retained.dataset.sourceUploads===uploads;
    }
    const sorted=[...intervals].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)],p95=sorted[Math.floor(sorted.length*.95)];
    const master=layout.querySelector<HTMLCanvasElement>('canvas[data-seamless-layout]')!;
    const report={kind:'seamless-live-fusion',ua:navigator.userAgent,scenario:location.search,masterWidth:master.width,masterHeight:master.height,frames:180,pixels,distinctLiveFrames:new Set(displayed).size,finalVisible,committed,togglePass,toggleLatency,sourceStable:JSON.stringify(sources)===JSON.stringify(JSON.parse(svg().dataset.sourceKey!)[1].map((c:any)=>c[0])),medianFrameMs:median,p95FrameMs:p95,framesOver34ms:intervals.filter(t=>t>34).length};
    await output({...report,pass:pixels.every(p=>p.holes===0&&p.meanRGBDifference<2)&&new Set(displayed).size>70&&finalVisible===0&&committed===0&&togglePass&&median<22&&p95<34});
    if(new URLSearchParams(location.search).has('visual')){
      const input=document.querySelector<HTMLInputElement>('input[aria-label="融合程度"]')!;setter.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));await wait(5);
    }
  }catch(error){await output({kind:'seamless-live-fusion',ua:navigator.userAgent,pass:false,error:String(error)});}
})();
