import {bakePixelMaster,setPixelDither} from './photoPixelCore';
let film:any=null;
self.onmessage=async(event:MessageEvent)=>{
 if(event.data.warm){
  const base=event.data.warm;
  for(let i=0;i<8;i++){
   await new Promise<void>(r=>setTimeout(r,0));
   const v=i%2?75:-75;
   bakePixelMaster({...base,brightness:v,exposure:-v,contrast:v,highlights:v,shadows:-v,temp:v,tint:-v,sat:v,vib:-v},null);
  }
  self.postMessage({warmReady:true});return;
 }
 const {id,key,generation,params,dither,filmChanged,filmData}=event.data;
 if(dither){setPixelDither(dither);return;}
 try{
  const started=performance.now();
  if(filmChanged)film=filmData;
  // The existing photo pipeline blends film twice. With identity HSL/curves
  // this is algebraically the same film weight squared, without a second bake.
  const amount=params.lutAmount/100;
  const tex=bakePixelMaster({...params,lutAmount:film&&amount<1?params.lutAmount*amount:params.lutAmount},film);
  self.postMessage({id,key,generation,tex,master:true,bakeMs:performance.now()-started},[tex.buffer]);
 }catch(error){self.postMessage({id,key,generation,error:String(error)});}
};
