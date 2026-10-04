import {repairLutAtlas,needsLutAtlasRepair} from './lutAtlasRepair.js';
import {bakePixelMaster} from './photoPixelCore';

self.onmessage=async({data:{id,url,params,cached}}:MessageEvent)=>{
  try{
    if(cached){
      const plain=bakePixelMaster({...params,lutAmount:0},null);
      const tex=bakePixelMaster({...params,lutAmount:100},cached);
      self.postMessage({id,size:cached.size,data:cached.data,plain,tex},[cached.data.buffer,plain.buffer,tex.buffer]);return;
    }
    const response=await fetch(url);if(!response.ok)throw Error(String(response.status));
    const image=await createImageBitmap(await response.blob());
    const w=image.width,h=image.height,size=w===h?w/8:64;
    const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    ctx.drawImage(image,0,0);image.close();
    const original=ctx.getImageData(0,0,w,h).data;
    const pixels=needsLutAtlasRepair(url)?repairLutAtlas(original,w,h).data:original;
    const table=new Uint8ClampedArray(size**3*3);
    for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++){
      const p=((((b/8)|0)*size+g)*w+(b%8)*size+r)*4;
      const t=(b*size*size+g*size+r)*3;
      table[t]=pixels[p];table[t+1]=pixels[p+1];table[t+2]=pixels[p+2];
    }
    const film={data:table,size};
    const plain=bakePixelMaster({...params,lutAmount:0},null);
    const tex=bakePixelMaster({...params,lutAmount:100},film);
    self.postMessage({id,size,data:table,plain,tex},[table.buffer,plain.buffer,tex.buffer]);
  }catch(error){self.postMessage({id,error:String(error)});}
};
