import {bakePixelMaster,setPixelDither} from './photoPixelCore';
let film:any=null;
self.onmessage=(event:MessageEvent)=>{
 const {id,key,generation,params,dither,filmChanged,filmData}=event.data;
 if(dither){setPixelDither(dither);return;}
 try{
  if(filmChanged)film=filmData;
  // The existing photo pipeline blends film twice. With identity HSL/curves
  // this is algebraically the same film weight squared, without a second bake.
  const amount=params.lutAmount/100;
  const tex=bakePixelMaster({...params,lutAmount:film&&amount<1?params.lutAmount*amount:params.lutAmount},film);
  self.postMessage({id,key,generation,tex,master:true},[tex.buffer]);
 }catch(error){self.postMessage({id,key,generation,error:String(error)});}
};
