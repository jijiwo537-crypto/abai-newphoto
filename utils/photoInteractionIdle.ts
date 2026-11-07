let busyUntil=0;
const holds=new Set<symbol>();
const now=()=>typeof performance==='undefined'?Date.now():performance.now();
const nap=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export function deferHeavyWork(ms=350){busyUntil=Math.max(busyUntil,now()+ms);}
/* 「手指是不是正按在任何一根滑桿上」由 utils/sliderTouch 登記在 globalThis 上（這支檔案刻意不 import 它，
   維持沒有相依、可以單獨載入）。放開滑桿之後也先別急著開始背景工作：常常是調一下、看一眼、馬上再調 */
const sliderHeld=()=>!!(globalThis as any).__abaiSliderHeld?.();
if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('abai-slider-release',()=>deferHeavyWork(600));
/** 繪製端的同步檢查，給不重要的草稿縮圖用 */
/* 手指正按在任何一根滑桿上也算忙：滑桿不一定每一根都有登記 holdPhotoInteraction（例如編輯頁的調節滑桿），
   以前拖滑桿時背景的卡片縮圖照樣一張一張算，預覽就一卡一卡的 */
const busyNow=()=>holds.size>0||now()<busyUntil||sliderHeld();
export function isPhotoInteractionBusy(){return busyNow();}
/**
 * 手指停著不動也還是在操作滑桿。這段期間背景工作不能用計時器硬擠到主執行緒上
 */
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
  // 要求閒置回呼和它真的被呼叫之間，可能剛好有指標按下
  if(!busyNow())return;
 }
}
