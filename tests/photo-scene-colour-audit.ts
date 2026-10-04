import {PhotoSceneColour,copySceneColourPixels} from '../utils/photoSceneColour';
import {applyPhotoFx,colorKeyOf,hasPhotoFx,loadLut} from '../utils/photoFx';
import {get2dWide} from '../utils/colorSpace';
void(async()=>{
 const checks:any[]=[],check=(name:string,pass:boolean,detail?:any)=>checks.push({name,pass,detail});
 const source=document.createElement('canvas');source.width=256;source.height=128;
 const src=source.getContext('2d')!,data=src.createImageData(256,128);
 for(let y=0;y<128;y++)for(let x=0;x<256;x++)data.data.set([x,y*2,(x+y)%256,255],(y*256+x)*4);src.putImageData(data,0,0);
 const scene=(photo:CanvasImageSource)=>{const cv=document.createElement('canvas');cv.width=256;cv.height=128;const c=get2dWide(cv)!;c.drawImage(photo,0,0);c.fillStyle='#112233';c.fillRect(100,30,50,60);return cv;};
 const flat=(fill:string)=>{const c=document.createElement('canvas');c.width=256;c.height=128;const g=c.getContext('2d')!;g.fillStyle=fill;g.fillRect(0,0,256,128);return c;};
 const original=scene(source),black=scene(flat('black')),white=scene(flat('white'));
 const main=document.createElement('canvas');main.width=256;main.height=128;
 const presenter=new PhotoSceneColour();
 try{
  check('GPU scene preparation succeeds',presenter.prepare(main,'audit',1,[original,black,white]));
  await loadLut('scene-audit-filter','/luts/f1.webp',true);
  for(const fx of [{},{brightness:30},{exposure:-20},{contrast:30,shadows:20,highlights:-30},{temp:23,tint:-21},{sat:-27,vib:30},{lut:'scene-audit-filter',lutAmount:50,contrast:20},{lut:'scene-audit-filter',lutAmount:100}]){
   check('resident presentation draws',presenter.draw(fx));
   if(hasPhotoFx(fx)){const end=performance.now()+5000;while(presenter.canvas.dataset.presentedColourKey!==colorKeyOf(fx)&&performance.now()<end)await new Promise(r=>requestAnimationFrame(r));}
   const copy=document.createElement('canvas');copy.width=256;copy.height=128;const c=get2dWide(copy)!;copySceneColourPixels(presenter.canvas,c);
   const a=c.getImageData(0,0,256,128).data,b=scene(applyPhotoFx(source,256,128,fx,{cacheSource:true,gpuSurface:true})).getContext('2d')!.getImageData(0,0,256,128).data;
   let max=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d;}
   check('colour and foreground remain consistent with standard renderer',max<=3&&sum/a.length<.5,{fx,max,mean:sum/a.length});
  }
 }catch(e){check('exception',false,String(e));}finally{presenter.dispose();}
 const report={kind:'photo-scene-colour',pass:checks.every(c=>c.pass),checks};
 const pre=document.createElement('pre');pre.id='scene-colour-result';pre.dataset.report=JSON.stringify(report);pre.hidden=true;document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
