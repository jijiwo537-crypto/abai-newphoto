import {drawSeamPreview,disposeSeamPreview} from '../utils/seamlessPreview';
import {prepareSeamSource,renderSeamlessLayout} from '../utils/seamlessLayout';
import {get2dWide} from '../utils/colorSpace';
const colors=['color(display-p3 1 0 0)','color(display-p3 0 1 0)','color(display-p3 1 .5 0)','color(display-p3 1 0 .65)','color(display-p3 .2 .8 .7)','color(display-p3 .6 .2 1)', '#ff4030','#2080ee','#50ce80','#fff','#777','#121212'];
const label=(text:string,canvas:HTMLCanvasElement)=>{const section=document.createElement('section');section.style.cssText='margin-bottom:12px';section.textContent=text;canvas.style.cssText='display:block;width:100%;max-width:384px;margin-top:4px';section.append(canvas);document.getElementById('colors')!.append(section);};
void(async()=>{
  let report:any={kind:'seamless-color',ua:navigator.userAgent,run:location.search};
  try{
    const width=384,height=128,source=document.createElement('canvas');source.width=width;source.height=height;
    const ctx=get2dWide(source)!;
    colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i%6*64,Math.floor(i/6)*64,64,64);});
    label('原圖',source);
    const cell={url:source.toDataURL('image/png'),zoom:1,offsetX:0,offsetY:0,rotation:0};
    const decoded=await prepareSeamSource(cell,0),rects=[{x:0,y:0,w:1,h:1}];
    const target=document.createElement('canvas');target.width=width;target.height=height;
    drawSeamPreview(target,[cell],rects,[decoded],100,{width,height,xx:width,xy:0,x0:0,yx:0,yy:height,y0:0});label('無縫預覽',target);
    const exported=await renderSeamlessLayout([cell],rects,width,height,100);label('無縫匯出',exported);
    const read=(c:HTMLCanvasElement)=>{
      const gpu=c.getContext('webgl2');
      if(gpu){
        // Read the tagged framebuffer directly: Safari's drawImage(WebGL)
        // copy currently treats P3 bytes as sRGB. The displayed GPU canvas
        // remains correctly tagged; screen pixels are also checked separately.
        const raw=new Uint8Array(width*height*4),data=new Uint8ClampedArray(raw.length);
        gpu.readPixels(0,0,width,height,gpu.RGBA,gpu.UNSIGNED_BYTE,raw);
        for(let y=0;y<height;y++)data.set(raw.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
        return new ImageData(data,width,height,{colorSpace:c.dataset.colorSpace as PredefinedColorSpace});
      }
      const sample=document.createElement('canvas');sample.width=width;sample.height=height;const s=get2dWide(sample)!;s.drawImage(c,0,0);return s.getImageData(0,0,width,height);
    };
    const reference=read(source),preview=read(target),output=read(exported);
    const comparisons=colors.map((color,i)=>{const k=((Math.floor(i/6)*64+32)*width+i%6*64+32)*4,original=Array.from(reference.data.slice(k,k+4)),gpu=Array.from(preview.data.slice(k,k+4)),cpu=Array.from(output.data.slice(k,k+4));return{color,original,preview:gpu,export:cpu,previewError:Math.max(...gpu.map((v,i)=>Math.abs(v-original[i]))),exportError:Math.max(...cpu.map((v,i)=>Math.abs(v-original[i])))};});
    const probe=document.createElement('canvas').getContext('webgl2')!;
    report={...report,colorSpace:reference.colorSpace,drawingBuffer:target.dataset.colorSpace||'srgb',supportsOutput:'drawingBufferColorSpace' in probe,supportsUnpack:'unpackColorSpace' in probe,comparisons,maxPreviewError:Math.max(...comparisons.map(c=>c.previewError)),maxExportError:Math.max(...comparisons.map(c=>c.exportError))};
    report.pass=report.maxPreviewError<=1&&report.maxExportError<=1;
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    // Real inputs update every frame, with constant source textures and quality.
    const times:number[]=[];for(let i=0;i<180;i++){
      await new Promise<void>(r=>requestAnimationFrame(()=>r()));times.push(performance.now());
      drawSeamPreview(target,[cell],rects,[decoded],i%101,{width,height,xx:width,xy:0,x0:0,yx:0,yy:height,y0:0});
    }
    const intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
    report={...report,frames:180,medianFrameMs:intervals[Math.floor(intervals.length/2)],p95FrameMs:intervals[Math.floor(intervals.length*.95)],sourceUploads:target.dataset.sourceUploads};
    const after=read(target);report.finalPixelUnchanged=colors.every((_,i)=>{const k=((Math.floor(i/6)*64+32)*width+i%6*64+32)*4;return Math.max(...[0,1,2].map(j=>Math.abs(after.data[k+j]-reference.data[k+j])))<=1;});report.pass&&=report.finalPixelUnchanged;
    const junctions:any[]=[];
    for(const color of ['color(display-p3 1 .5 .2)','#2080ee','#777']){
      const solid=document.createElement('canvas');solid.width=width;solid.height=height;const sc=get2dWide(solid)!;sc.fillStyle=color;sc.fillRect(0,0,width,height);
      const photo={...cell,url:solid.toDataURL('image/png')},prepared=await prepareSeamSource(photo,0),expected=read(solid).data;
      for(const boxes of [[{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}],[{x:0,y:0,w:1,h:.5},{x:0,y:.5,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}]]){
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        for(const amount of [0,50,100]){
          const photos=boxes.map(()=>photo);drawSeamPreview(canvas,photos,boxes,boxes.map(()=>prepared),amount,{width,height,xx:width,xy:0,x0:0,yx:0,yy:height,y0:0});
          const preview=read(canvas).data,exported=read(await renderSeamlessLayout(photos,boxes,width,height,amount)).data;
          let gpuError=0,cpuError=0;for(let k=0;k<expected.length;k++){gpuError=Math.max(gpuError,Math.abs(preview[k]-expected[k]));cpuError=Math.max(cpuError,Math.abs(exported[k]-expected[k]));}
          junctions.push({color,photos:boxes.length,amount,gpuError,cpuError});
        }
        disposeSeamPreview(canvas);
      }
    }
    report.junctions=junctions;report.pass&&=junctions.every(x=>x.gpuError<=1&&x.cpuError<=1);
    // Cross both 1024px tile boundaries at non-integer cell seams, with
    // rotation/offsets. Compare the complete export to a single GPU viewport.
    const tw=2055,th=1357,tiled=document.createElement('canvas');tiled.width=tw;tiled.height=th;
    const boxes=[{x:0,y:0,w:1,h:.5},{x:0,y:.5,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}];
    const photos=boxes.map((_,i)=>({...cell,zoom:1.6,rotation:i*23,offsetX:.23,offsetY:-.17}));
    drawSeamPreview(tiled,photos,boxes,boxes.map(()=>decoded),70,{width:tw,height:th,xx:tw,xy:0,x0:0,yx:0,yy:th,y0:0});
    const gpu=tiled.getContext('webgl2');let baseline:Uint8ClampedArray;
    if(gpu){const raw=new Uint8Array(tw*th*4);baseline=new Uint8ClampedArray(raw.length);gpu.readPixels(0,0,tw,th,gpu.RGBA,gpu.UNSIGNED_BYTE,raw);for(let y=0;y<th;y++)baseline.set(raw.subarray((th-1-y)*tw*4,(th-y)*tw*4),y*tw*4);}
    else{const sample=document.createElement('canvas');sample.width=tw;sample.height=th;const s=get2dWide(sample)!;s.drawImage(tiled,0,0);baseline=s.getImageData(0,0,tw,th).data;}
    const tiledExport=await renderSeamlessLayout(photos,boxes,tw,th,70),pixels=tiledExport.getContext('2d')!.getImageData(0,0,tw,th).data;
    let tileError=0,holes=0;for(let k=0;k<pixels.length;k++){tileError=Math.max(tileError,Math.abs(pixels[k]-baseline[k]));if(k%4===3&&pixels[k]!==255)holes++;}
    report.tiled={width:tw,height:th,maxError:tileError,holes};report.pass&&=tileError<=2&&holes===0;disposeSeamPreview(tiled);
    const transparent=document.createElement('canvas');transparent.width=width;transparent.height=height;
    const tc=get2dWide(transparent)!;tc.fillStyle='color(display-p3 .8 .3 .9 / .5)';tc.fillRect(0,0,width,height);
    const translucent={...cell,url:transparent.toDataURL('image/png')},alphaSource=await prepareSeamSource(translucent,0);
    const normal=document.createElement('canvas');normal.width=width;normal.height=height;const nc=get2dWide(normal)!;nc.fillStyle='#121212';nc.fillRect(0,0,width,height);nc.drawImage(transparent,0,0);
    const alphaCanvas=document.createElement('canvas');alphaCanvas.width=width;alphaCanvas.height=height;
    drawSeamPreview(alphaCanvas,[translucent],rects,[alphaSource],100,{width,height,xx:width,xy:0,x0:0,yx:0,yy:height,y0:0});
    const normalPixel=read(normal).data,alphaPixel=read(alphaCanvas).data;let alphaError=0;for(let k=0;k<normalPixel.length;k++)alphaError=Math.max(alphaError,Math.abs(normalPixel[k]-alphaPixel[k]));
    report.alphaError=alphaError;report.pass&&=alphaError<=2;disposeSeamPreview(alphaCanvas);
    // Keep the actual rendered canvases visible for screenshot inspection.
    addEventListener('pagehide',()=>disposeSeamPreview(target),{once:true});
  }catch(error){report={...report,pass:false,error:String(error)};}
  document.getElementById('result')!.textContent=JSON.stringify(report,null,2);
  document.getElementById('summary')!.textContent=`${report.pass?'通過':'未通過'}｜預覽最大色差 ${report.maxPreviewError}／255，匯出 ${report.maxExportError}／255｜${report.frames} 幀`;
  await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
