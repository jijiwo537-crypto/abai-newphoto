// 存下來的光學參數維持原本的單位；顯示的擴散級數都是 0～100 的整數滑桿單位
export function effectControlValue(key,value){
 if(key==='softThreshold')return 100-value;
 if(key==='fxSpillDiffusion')return Math.round((value-10)/.9);
 return value;
}
export function effectStoredValue(key,value){
 if(key==='softThreshold')return 100-value;
 if(key==='fxSpillDiffusion')return 10+value*.9;
 return value;
}
export function effectControlMin(key,min){return key==='fxSpillDiffusion'?0:min;}

// 光學的距離、角度是連續的，跟格子數或亂數種子不同。它們存的範圍很小，直接對應的話全寬的滑桿只有 21～81 段
const continuous = new Set(['fxPearlFreq','fxRgbAmount','fxBlocksAmount','fxSliceAmount','fxSpinAngle','fxMotionLength']);
export function effectControlStep(key,step=1){return continuous.has(key)?Math.min(step,.1):step;}
export function isContinuousEffectControl(key){return continuous.has(key);}
