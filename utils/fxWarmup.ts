import {FX_DEFS,warmFx} from './glEffects';
import {awaitPhotoIdle,deferHeavyWork} from './photoInteractionIdle';
import {warmBackdropMasks} from './backdropMasks';

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
    // 遮罩的顯示卡環境最先暖好（建立 WebGL＋編譯著色器要幾百毫秒），
    // 不然等到點「新增圖形」才做，面板剛滑出來就會整個卡住一下。
    await warmMasksWhenIdle();
    for(const d of FX_DEFS){await awaitPhotoIdle();warmFx(d.id);}
  })();
}

/* 遮罩著色器：整個頁面只暖一次。進「新增圖形」時也會叫一次（萬一開場還沒輪到），
   但會先讓面板滑出來的動畫跑完（deferHeavyWork），再找沒有手勢的空檔做。 */
let masksWarm:Promise<void>|null=null;
export function warmMasksWhenIdle(){
  if(typeof window==='undefined')return Promise.resolve();
  if(!masksWarm)masksWarm=(async()=>{await awaitPhotoIdle();warmBackdropMasks();})();
  return masksWarm;
}
export function warmMasksAfterPanelOpens(){deferHeavyWork(900);void warmMasksWhenIdle();}
