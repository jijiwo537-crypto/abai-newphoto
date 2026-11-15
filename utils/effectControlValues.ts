// 存下來的光學參數維持原本的單位；顯示的擴散級數都是 0～100 的整數滑桿單位
/* 濾鏡強度：存的是實際強度（0～這顆濾鏡的最大強度），滑桿一律顯示 0～100。
   編輯頁換濾鏡時用 setLutCap 告訴這裡目前這顆的最大強度 */
let lutCap=100;
export function setLutCap(cap){lutCap=cap>0?cap:100;}
export function effectControlValue(key,value){
 if(key==='lutAmount')return Math.min(100,value*100/lutCap);
 if(key==='softThreshold')return 100-value;
 if(key==='fxSpillDiffusion')return Math.round((value-10)/.9);
 return value;
}
export function effectStoredValue(key,value){
 if(key==='lutAmount')return value*lutCap/100;
 if(key==='softThreshold')return 100-value;
 if(key==='fxSpillDiffusion')return 10+value*.9;
 return value;
}
export function effectControlMin(key,min){return key==='fxSpillDiffusion'?0:min;}

// 光學的距離、角度是連續的，跟格子數或亂數種子不同。它們存的範圍很小，直接對應的話全寬的滑桿只有 21～81 段
const continuous = new Set(['fxPearlFreq','fxRgbAmount','fxBlocksAmount','fxSliceAmount','fxSpinAngle','fxMotionLength']);
export function effectControlStep(key,step=1){return continuous.has(key)?Math.min(step,.1):step;}
export function isContinuousEffectControl(key){return continuous.has(key);}
