import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import{createHash}from'node:crypto';
const source=fs.readFileSync('utils/photoPixelCore.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const core=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('worker extraction preserves the original pixel function byte for byte',()=>{
 assert.equal(createHash('sha256').update(source.slice(source.indexOf('export const processPixels =')).trim()).digest('hex'),'4069c42ee40bb26d6e62a522b677dd691504aea14dde99637b36090d8b5cd7c5');
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
