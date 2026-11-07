import {bakePixelMaster,setPixelDither} from './photoPixelCore';
let film:any=null;
self.onmessage=async(event:MessageEvent)=>{
 if(event.data.warm){
  const base=event.data.warm;
  /* 預熱：讓 JavaScript 引擎在使用者第一次拖滑桿之前就把烤色表這段程式編譯到最快的那一層。
     iPhone 的引擎一開始是用「直譯」跑，同一段要跑過很多次才會升級；沒預熱的話頭幾秒每烤一張要好幾倍時間，
     預覽就只能一格一格地跟上。每一項調整（含白色／黑色）單獨、一起、正負都跑過，每一條分支都熱好 */
  const keys=['brightness','exposure','contrast','highlights','shadows','whites','blacks','temp','tint','sat','vib'];
  const jobs:Record<string,number>[]=[];
  for(const k of keys)for(const v of [60,-60])jobs.push({[k]:v});
  for(let i=0;i<6;i++){const v=[75,-75,30,-30,100,-100][i];jobs.push(Object.fromEntries(keys.map((k,j)=>[k,j%2?-v:v])));}
  for(const j of jobs){
   await new Promise<void>(r=>setTimeout(r,0));
   bakePixelMaster({...base,...j},null);
  }
  self.postMessage({warmReady:true});return;
 }
 const {id,key,generation,params,dither,filmChanged,filmData,paired}=event.data;
 if(dither){setPixelDither(dither);return;}
 try{
  const started=performance.now();
  if(filmChanged)film=filmData;
  if(paired&&film){
   const plain=bakePixelMaster({...params,lutAmount:0},null);
   const tex=bakePixelMaster({...params,lutAmount:100},film);
   self.postMessage({id,key,generation,tex,plain,master:true,bakeMs:performance.now()-started},[tex.buffer,plain.buffer]);return;
  }
  // 現有的照片流程會混合兩次底片。HSL 和曲線不變時，數學上就是底片權重的平方，不必烤第二次
  const amount=params.lutAmount/100;
  const tex=bakePixelMaster({...params,lutAmount:film&&amount<1?params.lutAmount*amount:params.lutAmount},film);
  self.postMessage({id,key,generation,tex,master:true,bakeMs:performance.now()-started},[tex.buffer]);
 }catch(error){self.postMessage({id,key,generation,error:String(error)});}
};
