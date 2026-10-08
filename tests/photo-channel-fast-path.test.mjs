import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const source=fs.readFileSync('utils/photoPixelCore.ts','utf8');
const fn=source.slice(source.indexOf('export const processPixels ='));
const pre=`const masterLUT_R=new Float32Array(32768),masterLUT_G=new Float32Array(32768),masterLUT_B=new Float32Array(32768);
const ditherTable=Float32Array.from({length:4096},(_,i)=>((i*71%1024)/1024-.5)*.75);
const DEFAULT_HSL=Array.from({length:8},()=>({h:0,s:0,l:0}));const HSL_CENTERS=Float32Array.from([0,30,60,120,180,240,270,300]);
const HSL_MAX_HUE_SHIFT=15,HSL_MAX_SAT=.5,HSL_MAX_LUM=.1;const isHslIdentity=x=>!x||x.every(b=>b.h===0&&b.s===0&&b.l===0);
`+fs.readFileSync('utils/photoToneMath.ts','utf8').replace(/^export /gm,'')+'\n';
const load=async code=>{const js=ts.transpileModule(pre+code,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;return (await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))).processPixels;};
const fast=await load(fn),reference=await load(fn.replace(/  \/\/ With independent channel corrections[\s\S]*?(?=  \/\/ Split into explicit loops)/,''));
test('full-resolution channel fast path is byte-identical to existing tetrahedral pipeline',()=>{
 const src=Uint8ClampedArray.from({length:16384},(_,i)=>(Math.imul(i+9,15485863)>>>7)&255);
 const curve=Uint8Array.from({length:256},(_,i)=>i),curves={rgb:curve,r:curve,g:curve,b:curve};
 for(const gain of [.6,1,1.5])for(const offset of [-30,0,40])for(const extra of [{},{temp:50},{sat:50},{highlights:50}]){
  const p={temp:0,tint:0,sat:0,vib:0,sharpen:0,shadows:0,highlights:0,lutAmount:100,curves:Object.fromEntries(['rgb','r','g','b'].map(k=>[k,[{x:0,y:0},{x:255,y:255}]])),...extra};
  const base=Uint8Array.from({length:256},(_,v)=>Math.max(0,Math.min(255,Math.round(v*gain+offset))));
  const a=new Uint8ClampedArray(src.length),b=new Uint8ClampedArray(src.length);
  fast(src,a,64,64,p,null,0,base,null,false,curves);reference(src,b,64,64,p,null,0,base,null,false,curves);assert.deepEqual(a,b);
 }
});
