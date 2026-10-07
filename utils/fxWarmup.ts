import {FX_DEFS,warmFx} from './glEffects';
import {awaitPhotoIdle} from './photoInteractionIdle';

/* 特效著色器是「第一次用到才編譯」—— 首頁的編輯器開好後會趁空檔一支一支
   先編好，所以第一次點特效不會等。拼圖編輯器共用同一個預設 GL 環境，
   這裡做同一件事：一次一支、只在沒有手勢的空檔，整個頁面只需要做一次。 */
let started=false;
export function warmPhotoEffectsWhenIdle(){
  if(started||typeof window==='undefined')return;
  started=true;
  void(async()=>{
    // 開場先讓給第一張預覽
    await new Promise(resolve=>setTimeout(resolve,1200));
    for(const d of FX_DEFS){await awaitPhotoIdle();warmFx(d.id);}
  })();
}
