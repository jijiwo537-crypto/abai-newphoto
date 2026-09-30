import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const scope={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/previewViewport.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
const crop=scope.exports.previewViewport;
test('visible crop retains source pixel coordinates and overscan, never rescales',()=>{
 const r=crop(4000,4000,{left:-500,top:-400,width:1000,height:1000},{left:0,top:0,right:400,bottom:500});
 assert.deepEqual({...r},{x:1904,y:1504,w:1792,h:2192});
});
test('unzoomed scene remains full size and completely offscreen scenes remain valid',()=>{
 assert.deepEqual({...crop(1200,1600,{left:10,top:10,width:300,height:400},{left:0,top:0,right:400,bottom:600})},{x:0,y:0,w:1200,h:1600});
 for(const left of [-10000,10000]){
  const r=crop(1200,1600,{left,top:left,width:300,height:400},{left:0,top:0,right:400,bottom:600});
  assert.ok(r.w>=1&&r.h>=1&&r.x>=0&&r.y>=0&&r.x+r.w<=1200&&r.y+r.h<=1600);
 }
});
