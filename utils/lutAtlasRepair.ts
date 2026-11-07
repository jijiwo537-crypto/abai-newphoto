// LUT 是分塊排列的立體資料，不是一般的圖片。縮圖或壓縮時跨塊邊界的內插，
// 會把不相關的 RGB 立方體位置混在一起。只用「同一片」內部的資料重建被污染的邊界取樣
export function repairLutAtlas(input,width,height){
 const tile=width/8,channels=input.length/(width*height),output=new Uint8ClampedArray(input);
 if(!Number.isInteger(tile)||height!==width||![3,4].includes(channels)||tile<8)throw Error('Unsupported LUT atlas');
 const pixel=(x,y,k)=>((y*width+x)*channels+k),changes={samples:0,maxDelta:0};
 // 保守的判斷：一般的量化和刻意的趾部彎曲不動，只有明顯的塊邊界偏移才算
 const smooth=x=>{const t=Math.max(0,Math.min(1,(x-16)/16));return t*t*(3-2*t);};
 // 先修 x 再修 y。第二次看到的是已經修好的 x 邊，四個角都能從同一塊內有效的取樣重建
 for(const axis of [0,1]){
  const before=new Uint8ClampedArray(output);
  for(let by=0;by<8;by++)for(let bx=0;bx<8;bx++){
  for(let cross=0;cross<tile;cross++)for(const side of [0,1])for(let d=0;d<2;d++)for(let k=0;k<3;k++){
   const coordinate=n=>side?tile-1-n:n;
   const index=n=>pixel(bx*tile+(axis?cross:coordinate(n)),by*tile+(axis?coordinate(n):cross),k);
   const anchor=before[index(2)],slope=(before[index(4)]-anchor)/2;
   const predicted=Math.max(0,Math.min(255,anchor+(d-2)*slope));
   const i=index(d),delta=predicted-before[i],weight=smooth(Math.abs(delta));
   output[i]=before[i]+delta*weight;
   const applied=Math.abs(output[i]-input[i]);if(output[i]!==before[i]){changes.samples++;changes.maxDelta=Math.max(changes.maxDelta,applied);}
  }
  }
 }
 return {data:output,...changes};
}
export const LUT_ATLAS_REPAIR_REVISION='atlas-boundary-v1';
export function needsLutAtlasRepair(url){return /(?:^|\/)f(?:3|19)\.webp(?:[?#]|$)/i.test(url);}
export function repairedLutCanvas(image){
 const canvas=document.createElement('canvas');canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),result=repairLutAtlas(pixels.data,canvas.width,canvas.height);
 pixels.data.set(result.data);ctx.putImageData(pixels,0,0);return canvas;
}
