// Keep saved optical parameters in their original units; all displayed
// diffusion steps remain whole 0–100 slider units.
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
