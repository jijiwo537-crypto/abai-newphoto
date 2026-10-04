let busyUntil=0;
const holds=new Set<symbol>();
const now=()=>typeof performance==='undefined'?Date.now():performance.now();
const nap=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export function deferHeavyWork(ms=350){busyUntil=Math.max(busyUntil,now()+ms);}
/** Synchronous paint-side guard for nonessential draft thumbnails. */
export function isPhotoInteractionBusy(){return holds.size>0||now()<busyUntil;}
/** A stationary finger still owns the slider. Background work may not use a
 * timeout to force itself onto the main thread during that interaction. */
export function holdPhotoInteraction(){
 const token=Symbol();holds.add(token);deferHeavyWork();
 return ()=>{if(holds.delete(token))deferHeavyWork();};
}
export async function awaitPhotoIdle(waitMs=4000){
 for(;;){
  while(holds.size||now()<busyUntil)await nap(40);
  const ric=(globalThis as any).requestIdleCallback;
  if(typeof ric==='function')await new Promise<void>(resolve=>ric(()=>resolve(),{timeout:waitMs}));
  else await nap(0);
  // A pointer can land between requesting an idle callback and its delivery.
  if(!holds.size&&now()>=busyUntil)return;
 }
}
