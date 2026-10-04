// A LUT is a tiled volume, not an ordinary image. Image-resize/compression
// interpolation across tile boundaries mixes unrelated RGB cube positions.
// Rebuild only contaminated boundary samples from the SAME slice's interior.
export function repairLutAtlas(input,width,height){
 const tile=width/8,channels=input.length/(width*height),output=new Uint8ClampedArray(input);
 if(!Number.isInteger(tile)||height!==width||![3,4].includes(channels)||tile<8)throw Error('Unsupported LUT atlas');
 const pixel=(x,y,k)=>((y*width+x)*channels+k),changes={samples:0,maxDelta:0};
 // A conservative gate leaves ordinary quantisation and intentional toe
 // curvature untouched; only a conspicuous tile-boundary excursion qualifies.
 const smooth=x=>{const t=Math.max(0,Math.min(1,(x-16)/16));return t*t*(3-2*t);};
 // Repair x first, then y. The second pass sees already repaired x gutters,
 // so all four corners are reconstructed from valid same-tile samples.
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
