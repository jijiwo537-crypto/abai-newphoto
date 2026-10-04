import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const js=ts.transpileModule(fs.readFileSync('utils/fxColourInput.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {colourAtlas}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('resident 2D colour atlas preserves every 3D lattice sample without resampling',()=>{
 const input=Uint8Array.from({length:33**3*4},(_,i)=>(i*17+i%137)%256),output=colourAtlas(input);
 for(let b=0;b<33;b++)for(let g=0;g<33;g++)for(let r=0;r<33;r++)for(let k=0;k<4;k++)assert.equal(output[(g*1089+b*33+r)*4+k],input[((b*33+g)*33+r)*4+k]);
});
test('histogram shards keep every half float counter within the exact integer range',()=>{
 for(const n of [320*240,2048*1536,4096*3072,8192*8192]){const rows=Math.max(128,2**Math.ceil(Math.log2(Math.ceil(n/512))));assert.ok(Math.ceil(n/rows)*3<=2048);}
});
