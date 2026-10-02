import test from 'node:test';
import assert from 'node:assert/strict';
import {blurAlpha} from '../utils/alphaBoxBlur.js';

test('compact halation kernel matches four clamped Uint8 box passes exactly',()=>{
  const w=31,h=23,source=Uint8ClampedArray.from({length:w*h},(_,i)=>(i*71+i*i*13)%256);
  const reference=(src,vertical,r)=>{
    const dst=new Uint8ClampedArray(src.length);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let sum=0;for(let k=-r;k<=r;k++)sum+=src[(vertical?Math.max(0,Math.min(h-1,y+k)):y)*w+(vertical?x:Math.max(0,Math.min(w-1,x+k)))];
      dst[y*w+x]=sum/(2*r+1);
    }return dst;
  };
  for(const radius of [0,1,2.9,7,30]){
    let expected=source;const r=Math.floor(radius);
    if(r>=1)for(let p=0;p<2;p++)expected=reference(reference(expected,false,r),true,r);
    const output=new Uint8ClampedArray(source.length),scratch=new Uint8ClampedArray(source.length);
    assert.deepEqual(blurAlpha(source,output,scratch,w,h,radius),expected);
    assert.notEqual(output,source);
  }
});
