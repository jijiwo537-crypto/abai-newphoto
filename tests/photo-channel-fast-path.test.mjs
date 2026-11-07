import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const source=fs.readFileSync('utils/photoPixelCore.ts','utf8');
import esbuild from 'esbuild';
/* 用 esbuild 把整個 photoPixelCore（連同它 import 的調色、局部調整模組）打包起來載入；
   參考版本＝同一份原始碼拿掉「獨立通道快速路徑」那一段。不再手動拼前置程式碼。 */
// 抖動表在模組載入時用 Math.random 建；兩份要一模一樣才能逐位元比，載入時換成固定種子
const seeded=()=>{let x=12345;return()=>((x=Math.imul(x^x>>>15,2246822507)+0x6d2b79f5|0)>>>0)/4294967296;};
const load=async code=>{const rnd=Math.random;Math.random=seeded();try{return await load0(code);}finally{Math.random=rnd;}};
const load0=async code=>{const out=await esbuild.build({stdin:{contents:code,resolveDir:'utils',sourcefile:'photoPixelCore.ts',loader:'ts'},bundle:true,format:'esm',write:false,platform:'neutral',logLevel:'silent'});return (await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'))).processPixels;};
const stripped=source.replace(/  \/\/ 各通道的修正互相獨立時[\s\S]*?(?=  \/\/ 拆成明確的迴圈)/,'');
assert.notEqual(stripped,source,'fast-path block must exist');
const fast=await load(source),reference=await load(stripped);
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
