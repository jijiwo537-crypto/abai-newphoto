import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import{createHash}from'node:crypto';
const source=fs.readFileSync('utils/photoPixelCore.ts','utf8');
// photoPixelCore 現在還 import 調色、局部調整等模組：用 esbuild 整包打包再載入（data: URL 才能自給自足）
import esbuild from 'esbuild';
const bundled=await esbuild.build({stdin:{contents:source,resolveDir:'utils',sourcefile:'photoPixelCore.ts',loader:'ts'},bundle:true,format:'esm',write:false,platform:'neutral',logLevel:'silent'});
const core=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
test('resident film strength matches every original full precision master without rebaking',()=>{
 const identity=[{x:0,y:0},{x:255,y:255}];
 const p={brightness:23,exposure:-14,contrast:19,highlights:-32,shadows:20,temp:30,tint:-21,sat:40,vib:25,lutAmount:100,sharpen:0,hsl:Array.from({length:8},()=>({h:0,s:0,l:0})),curves:{rgb:identity,r:identity,g:identity,b:identity}};
 const film={size:4,data:Uint8ClampedArray.from({length:4*4*4*3},(_,i)=>(i*31+47)%256)};
 const plain=core.bakePixelMaster({...p,lutAmount:0},null),full=core.bakePixelMaster(p,film);
 for(const strength of [0,1,10,33,50,70,99,100]){
  const weight=(strength/100)**2,expected=core.bakePixelMaster({...p,lutAmount:100*weight},film);
  let worst=0;for(let i=0;i<expected.length;i++)worst=Math.max(worst,Math.abs(plain[i]+(full[i]-plain[i])*weight-expected[i]));
  assert.ok(worst<2e-7,`strength ${strength}: error ${worst}`);
 }
});
test('worker extraction preserves the original pixel function byte for byte',()=>{
 // 原本釘死原始碼雜湊，之後每次正常修調色（保色相、白／黑色階…）都會誤報。
 // 真正要保證的是：只有一份像素函式，編輯器與 worker 都從 photoPixelCore 拿，沒有複製一份。
 const editor=fs.readFileSync('components/ImageEditor.tsx','utf8');
 assert.match(editor,/import \{ generateBaseCorrectionLut, processPixels \} from '\.\.\/utils\/photoPixelCore'/);
 assert.doesNotMatch(editor,/const processPixels\s*=/);
 for(const w of ['utils/photoLut.worker.ts','utils/lutDecode.worker.ts'])assert.match(fs.readFileSync(w,'utf8'),/from '\.\/photoPixelCore'/);
 assert.equal((source.match(/export const processPixels =/g)||[]).length,1);
});
test('full-precision master tetrahedra preserve the standard pixel pipeline',()=>{
 core.setPixelDither(new Float32Array(4096));
 const curve=Uint8Array.from({length:256},(_,i)=>i),curves={rgb:curve,r:curve,g:curve,b:curve};
 const src=Uint8ClampedArray.from({length:4096},(_,i)=>(Math.imul(i+17,15485863)>>>8)&255);
 const defaults={brightness:0,exposure:0,contrast:0,highlights:0,shadows:0,temp:0,tint:0,sat:0,vib:0,lutAmount:100,sharpen:0,hsl:Array.from({length:8},()=>({h:0,s:0,l:0})),curves:{rgb:[{x:0,y:0},{x:255,y:255}],r:[{x:0,y:0},{x:255,y:255}],g:[{x:0,y:0},{x:255,y:255}],b:[{x:0,y:0},{x:255,y:255}]}};
 for(const adjustments of [{brightness:23},{temp:30,tint:-21,sat:40,vib:25,highlights:-32,shadows:20,contrast:15,exposure:-20}]){
  const p={...defaults,...adjustments},master=core.bakePixelMaster(p,null),base=new Uint8Array(256),expected=new Uint8ClampedArray(src.length);
  core.generateBaseCorrectionLut(p.exposure,p.contrast,p.brightness,base);core.processPixels(src,expected,1024,1,p,null,0,base,null,false,curves);
  for(let i=0;i<src.length;i+=4){
   const f=[src[i],src[i+1],src[i+2]].map(v=>v*31/255),a=f.map(Math.floor),d=f.map((v,j)=>v-a[j]),order=[0,1,2].sort((x,y)=>d[y]-d[x]);
   const high=a.map(v=>Math.min(31,v+1)),first=[...a],second=[...a];first[order[0]]=high[order[0]];second[order[0]]=high[order[0]];second[order[1]]=high[order[1]];
   const points=[a,first,second,high],weights=[1-d[order[0]],d[order[0]]-d[order[1]],d[order[1]]-d[order[2]],d[order[2]]];
   for(let c=0;c<3;c++){const value=points.reduce((sum,v,j)=>sum+master[((v[2]*32+v[1])*32+v[0])*4+c]*weights[j]*255,0);assert.ok(Math.abs(Math.round(value)-expected[i+c])<=1);}
  }
 }
});
