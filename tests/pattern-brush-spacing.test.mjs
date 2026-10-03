import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../utils/patternBrushSpacing.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {stampBounds,stampsHaveSafeGap}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('brush stamps require half-size empty space, including a new stroke',()=>{
 const a=stampBounds(0,0,100,100,0,100);
 assert.equal(stampsHaveSafeGap(a,stampBounds(149,0,100,100,0,100)),false);
 assert.equal(stampsHaveSafeGap(a,stampBounds(150,0,100,100,0,100)),true);
 assert.equal(stampsHaveSafeGap(a,a),false);
});
test('rotation, size variation and wide custom characters never bypass the gap',()=>{
 const a=stampBounds(0,0,100,100,45,100);
 assert.equal(stampsHaveSafeGap(a,stampBounds(150,0,100,100,45,100)),false);
 const b=stampBounds(0,0,300,70,0,100);
 assert.equal(stampsHaveSafeGap(b,stampBounds(300,0,100,100,0,100)),false);
 assert.equal(stampsHaveSafeGap(b,stampBounds(350,0,100,100,0,100)),true);
});
test('scene-space spacing is invariant under preview zoom',()=>{
 const a=stampBounds(5,15,20,35,27,35),b=stampBounds(100,100,60,30,51,60);
 for(const k of [.2,1,8]){
  const scale=r=>Object.fromEntries(Object.entries(r).map(([key,v])=>[key,v*k]));
  assert.equal(stampsHaveSafeGap(scale(a),scale(b)),stampsHaveSafeGap(a,b));
 }
 const src=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
 assert.equal((src.match(/if \(canBrushStamp\(newHole\)\)/g)||[]).length,2);
});
