import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync('utils/textureSpacing.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {spacedTextureRadius:r,maskTextureGapFromUi:from,maskTextureGapToUi:to}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('mask gap UI 0–100 maps to -10–100; saved gaps round trip',()=>{
 assert.equal(from(0),-10);assert.ok(Math.abs(from(100)-100)<1e-9);
 for(let v=-10;v<=100;v++)assert.ok(Math.abs(from(to(v))-v)<=.55+1e-9);
 for(let v=0;v<=100;v++)assert.equal(to(from(v)),v);
});
test('old minimum gap preserves its maximum size; largest gap doubles actual diameter',()=>{
 for(const kind of ['dot','star','heart']){
  assert.equal(r(12.25,40,1,600,600,kind),12.25);
  assert.equal(r(12.25,140,1,600,600,kind),24.5);
 }
});
test('all shapes remain separated at every gap, size, layout unit and zoom',()=>{
 for(const kind of ['dot','star','heart'])for(const scale of [.08,.5,1,6,20])for(let gap=30;gap<=140;gap++)for(const size of [2.5,6,12.25]){
  const extent=kind==='star'?1.38:kind==='heart'?1.22:1;
  const radius=r(size*scale,gap*scale,scale,600*scale,600*scale,kind);
  assert.ok(radius*2*extent<=gap*scale*.96+1e-9);
  assert.ok(Math.abs(radius/scale-r(size,gap,1,600,600,kind))<1e-9);
 }
});
test('real narrow layout dimensions bound growth, independent of slider value',()=>{
 assert.ok(r(12.25,140,1,30,600,'star')<r(12.25,140,1,600,600,'star'));
 assert.equal(r(12.25,140,1,600,600,'star'),r(12.25,140,1,600,800,'star'));
});
test('preview and export use the same continuous radius, without changing object textures',()=>{
 const read=p=>fs.readFileSync(p,'utf8');
 assert.match(read('components/PatternLayer.tsx'),/spacedTextureRadius\(baseRadius,dx,w\/1000,w,h,o.type\)/);
 assert.match(read('utils/pattern.ts'),/spacedTextureRadius\(baseRadius, dgap, s, w, h, o.type\)/);
 assert.match(read('components/CollageTool.tsx'),/spacedTextureRadius\(actualDotSize \/ 2, actualDotGap, sgs, maskW, maskH, patternType\)/);
 assert.doesNotMatch(read('utils/holeShapes.ts'),/spacedTextureRadius/);
});
