import {applyPhotoFx,loadLut} from '../utils/photoFx';
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
 for(const fx of [{fxMosaic:100,fxMosaicCells:60},{fxGlass:55},{fxExposureSpill:50},{fxLowfi:50},{fxGlass:40,lut:'spatial-audit',lutAmount:70},{soft:40,softRadius:60},{fringeIntensity:50,fringeSize:40},{leakOpacity:70,leakAngle:45},{blur:50},{vignette:50}]){
  const live=applyPhotoFx(source,320,240,fx,{cacheSource:true,gpuSurface:true,out:input,scene});
  const gl=live.getContext('webgl')!,bytes=new Uint8Array(480*360*4);gl.readPixels(0,0,480,360,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
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
 const report={kind:'photo-spatial-scene',pass:checks.every(c=>c.pass),checks};
 const pre=document.createElement('pre');pre.hidden=true;pre.id='spatial-scene-result';pre.dataset.report=JSON.stringify(report);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
