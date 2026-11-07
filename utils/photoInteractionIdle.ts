import {sliderHeld,SLIDER_RELEASE_EVENT} from './sliderTouch';
let busyUntil=0;
const holds=new Set<symbol>();
const now=()=>typeof performance==='undefined'?Date.now():performance.now();
const nap=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export function deferHeavyWork(ms=350){busyUntil=Math.max(busyUntil,now()+ms);}
/* 放開滑桿之後也先別急著開始背景工作：常常是調一下、看一眼、馬上再調 */
if(typeof window!=='undefined')window.addEventListener(SLIDER_RELEASE_EVENT,()=>deferHeavyWork(600));
/** Synchronous paint-side guard for nonessential draft thumbnails. */
/* 手指正按在任何一根滑桿上也算忙：滑桿不一定每一根都有登記 holdPhotoInteraction（例如編輯頁的調節滑桿），
   以前拖滑桿時背景的卡片縮圖照樣一張一張算，預覽就一卡一卡的 */
const busyNow=()=>holds.size>0||now()<busyUntil||sliderHeld();
export function isPhotoInteractionBusy(){return busyNow();}
/** A stationary finger still owns the slider. Background work may not use a
 * timeout to force itself onto the main thread during that interaction. */
export function holdPhotoInteraction(){
 const token=Symbol();holds.add(token);deferHeavyWork();
 return ()=>{if(holds.delete(token))deferHeavyWork();};
}
export async function awaitPhotoIdle(waitMs=4000){
 for(;;){
  while(busyNow())await nap(40);
  const ric=(globalThis as any).requestIdleCallback;
  if(typeof ric==='function')await new Promise<void>(resolve=>ric(()=>resolve(),{timeout:waitMs}));
  else await nap(0);
  // A pointer can land between requesting an idle callback and its delivery.
  if(!busyNow())return;
 }
}
