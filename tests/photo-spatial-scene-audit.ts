import {applyPhotoFx,loadLut,compactPhotoFxSurface,releasePhotoFxSurface} from '../utils/photoFx';
import {get2dWide} from '../utils/colorSpace';
import type {FxScene} from '../utils/glEffects';
void(async()=>{
 const checks:any[]=[];
 const source=document.createElement('canvas');source.width=320;source.height=240;
 const g=source.getContext('2d')!,data=g.createImageData(320,240);
 for(let y=0;y<240;y++)for(let x=0;x<320;x++)data.data.set([x%256,y,(x+y)%256,255],(y*320+x)*4);g.putImageData(data,0,0);
 const draw=(photo:CanvasImageSource)=>{const cv=document.createElement('canvas');cv.width=480;cv.height=360;const c=get2dWide(cv)!;
  c.fillStyle='#CFE6DE';c.fillRect(0,0,480,360);c.drawImage(photo,0,0,320,240,30,40,400,260);
  c.fillStyle='rgba(20,30,40,.6)';c.fillRect(110,130,100,80);return cv;};
 const flat=(color:string)=>{const cv=document.createElement('canvas');cv.width=320;cv.height=240;const c=cv.getContext('2d')!;c.fillStyle=color;c.fillRect(0,0,320,240);return cv;};
 const scene:FxScene={black:draw(flat('black')),white:draw(flat('white')),placements:[{rect:[30,40,400,260],uv:[0,0,1,1],clip:[30,40,400,260]}]};
 const input=document.createElement('canvas');
 await loadLut('spatial-audit','/luts/f1.webp',true);
 for(const fx of [{fxMosaic:100,fxMosaicCells:60},{fxGlass:55},{fxExposureSpill:50},{fxExposureSpill:50,lut:'spatial-audit',lutAmount:70},{fxLowfi:50},...[0,25,50,75,100].map(lutAmount=>({fxLowfi:50,lut:'spatial-audit',lutAmount})),{fxGlass:40,lut:'spatial-audit',lutAmount:70},{soft:40,softRadius:60},{fringeIntensity:50,fringeSize:40},{leakOpacity:70,leakAngle:45},{blur:50},{vignette:50}]){
  const live=applyPhotoFx(source,320,240,fx,{cacheSource:true,gpuSurface:true,out:input,scene});
  const gl=live.getContext('webgl')!,bytes=new Uint8Array(480*360*4);gl.readPixels(0,0,480,360,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
  const firstSelection=live.dataset.fxPhases;
  // Moving the photo must recompose cached pixels, while keeping exactly the
  // same output as a cold effect render at the new UV coordinates.
  scene.placements[0].uv=[.12,.08,.75,.8];
  const moved=applyPhotoFx(source,320,240,fx,{cacheSource:true,gpuSurface:true,out:input,scene});
  const mg=moved.getContext('webgl')!,movedPixels=new Uint8Array(bytes.length);mg.readPixels(0,0,480,360,mg.RGBA,mg.UNSIGNED_BYTE,movedPixels);
  compactPhotoFxSurface(input);
  const coldMoved=applyPhotoFx(source,320,240,fx,{cacheSource:true,gpuSurface:true,out:input,scene});
  const cg=coldMoved.getContext('webgl')!,coldPixels=new Uint8Array(bytes.length);cg.readPixels(0,0,480,360,cg.RGBA,cg.UNSIGNED_BYTE,coldPixels);
  checks.push({fx,geometryCacheExact:true,pass:movedPixels.every((v,i)=>v===coldPixels[i])&&movedPixels.some((v,i)=>v!==bytes[i])});
  scene.placements[0].uv=[0,0,1,1];
  compactPhotoFxSurface(input);
  const rebuilt=applyPhotoFx(source,320,240,fx,{cacheSource:true,gpuSurface:true,out:input,scene});
  const reg=rebuilt.getContext('webgl')!,again=new Uint8Array(bytes.length);reg.readPixels(0,0,480,360,reg.RGBA,reg.UNSIGNED_BYTE,again);
  let compactMax=0,compactTotal=0;for(let i=0;i<bytes.length;i++){const d=Math.abs(bytes[i]-again[i]);compactMax=Math.max(compactMax,d);compactTotal+=d;}
  checks.push({fx,compactRestoresExactPixels:true,compactMax,compactMean:compactTotal/bytes.length,firstSelection,secondSelection:rebuilt.dataset.fxPhases,pass:bytes.every((v,i)=>v===again[i])});
  const flipped=new Uint8ClampedArray(bytes.length);for(let y=0;y<360;y++)flipped.set(bytes.subarray(y*480*4,(y+1)*480*4),(359-y)*480*4);
  const copy=document.createElement('canvas');copy.width=480;copy.height=360;const c=get2dWide(copy)!;
  c.putImageData(new ImageData(flipped,480,360,{colorSpace:(gl as any).drawingBufferColorSpace==='display-p3'?'display-p3':'srgb'}),0,0);
  const actual=c.getImageData(0,0,480,360).data,expected=draw(applyPhotoFx(source,320,240,fx)).getContext('2d')!.getImageData(0,0,480,360).data;
  let max=0,total=0,count=0;for(let y=0;y<360;y++)for(let x=0;x<480;x++){
   // Raster interpolation is different at the one-pixel crop seam only.
   if([29,30,429,430].includes(x)||[39,40,299,300].includes(y))continue;
   for(let k=0;k<3;k++){const i=(y*480+x)*4+k,d=Math.abs(actual[i]-expected[i]);max=Math.max(max,d);total+=d;count++;}
  }
  checks.push({fx,max,mean:total/count,pass:total/count<1.5&&max<30});
 }
 // Optical families share the base texture but use different layer sizes.
 for(const fx of [{fringeIntensity:100,fringeSize:10},{leakOpacity:100,leakAngle:45},{soft:70,softRadius:40},{fringeIntensity:100,fringeSize:10},{blur:50},{fringeIntensity:50,fringeSize:60}]){
  const live=applyPhotoFx(source,320,240,fx,{cacheSource:true,gpuSurface:true,out:input,scene});
  const gl=live.getContext('webgl')!,pixels=new Uint8Array(480*360*4);gl.readPixels(0,0,480,360,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const flipped=new Uint8ClampedArray(pixels.length);for(let y=0;y<360;y++)flipped.set(pixels.subarray(y*480*4,(y+1)*480*4),(359-y)*480*4);
  const copy=document.createElement('canvas');copy.width=480;copy.height=360;const c=get2dWide(copy)!;
  c.putImageData(new ImageData(flipped,480,360,{colorSpace:(gl as any).drawingBufferColorSpace==='display-p3'?'display-p3':'srgb'}),0,0);
  const actual=c.getImageData(0,0,480,360).data,expected=draw(applyPhotoFx(source,320,240,fx)).getContext('2d')!.getImageData(0,0,480,360).data;
  let max=0,total=0,count=0;for(let y=41;y<299;y++)for(let x=31;x<429;x++)for(let k=0;k<3;k++){const i=(y*480+x)*4+k,d=Math.abs(actual[i]-expected[i]);max=Math.max(max,d);total+=d;count++;}
  checks.push({fx,opticalSwitch:true,max,mean:total/count,pass:total/count<1.5&&max<30});
  copy.width=copy.height=1;
 }
 releasePhotoFxSurface(input);
 // Geometry changes also use isolated photograph caches without an FxScene.
 // Verify the resident optical path against the unchanged export renderer.
 for(const fx of [{soft:40,softRadius:60},{fringeIntensity:50,fringeSize:40},{leakOpacity:70,leakAngle:45},{blur:50},{vignette:50}]){
  const output=document.createElement('canvas');
  const live=applyPhotoFx(source,320,240,fx,{cacheSource:true,gpuSurface:true,out:output});
  const copy=document.createElement('canvas');copy.width=320;copy.height=240;
  const c=get2dWide(copy)!;c.drawImage(live,0,0,320,240);
  // Compare in one color space: reading the P3 copy against raw sRGB export
  // bytes would incorrectly report color-management as a rendering defect.
  const baseline=document.createElement('canvas');baseline.width=320;baseline.height=240;
  const b=get2dWide(baseline)!;b.drawImage(applyPhotoFx(source,320,240,fx),0,0);
  const actual=c.getImageData(0,0,320,240).data,expected=b.getImageData(0,0,320,240).data;
  let max=0,total=0,count=0;for(let i=0;i<actual.length;i++)if(i%4!==3){const d=Math.abs(actual[i]-expected[i]);max=Math.max(max,d);total+=d;count++;}
  checks.push({fx,isolatedPhotograph:true,max,mean:total/count,pass:total/count<1.5&&max<30});
  releasePhotoFxSurface(output);output.width=output.height=copy.width=copy.height=baseline.width=baseline.height=1;
 }
 const report={kind:'photo-spatial-scene',pass:checks.every(c=>c.pass),checks};
 const summary=document.createElement('p');summary.id='spatial-scene-summary';summary.textContent=`${report.pass?'通過':'未通過'}：${checks.filter(c=>c.pass).length}/${checks.length} 項像素檢查`;document.body.append(summary);
 const pre=document.createElement('pre');pre.hidden=true;pre.id='spatial-scene-result';pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
