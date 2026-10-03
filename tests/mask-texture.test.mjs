import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../utils/maskTexture.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source.replace(/import .*?;\n/,'const patternGlyph=()=>{};\n'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {maskTextureScale,paintMaskTexture,maskTextureVisibility,maskTextureSizeFromUi,maskTextureSizeToUi,maskTextureSquashFromUi,maskTextureSquashToUi}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('squash centre preserves size, left compresses vertically, right horizontally',()=>{
 assert.deepEqual(maskTextureScale(50),{x:1,y:1});
 assert.deepEqual(maskTextureScale(0),{x:1,y:.1});
 assert.ok(Math.abs(maskTextureScale(100).x-.1)<1e-9);
 assert.equal(maskTextureScale(100).y,1);
 assert.deepEqual(maskTextureScale(NaN),{x:1,y:1});
});
test('half-covered edge glyphs disappear under a single mask clip',()=>{
 const centres=[],scales=[];let clips=0,depth=0;
 const ctx={save(){depth++;},restore(){depth--;},beginPath(){},rect(){},clip(){clips++;},translate(x,y){centres.push([x,y]);},scale(x,y){scales.push([x,y]);}};
 paintMaskTexture(ctx,'dot',80,40,10,40,50);
 assert.ok(!centres.some(([x,y])=>x===0&&y===20));
 assert.ok(!centres.some(([x,y])=>x===80&&y===20));
 assert.ok(centres.some(([x,y])=>x===40&&y===20));
 assert.equal(clips,1);assert.equal(depth,0);
 const baseline=JSON.stringify(centres.filter(([,y])=>y===20));centres.length=0;
 paintMaskTexture(ctx,'dot',80,40,10,40,0);
 assert.equal(JSON.stringify(centres.filter(([,y])=>y===20)),baseline);
});
test('visible area counts the actual glyph, including compressed and corner cases',()=>{
 for(const type of ['dot','star','heart']){
  assert.equal(maskTextureVisibility(type,40,20,10,10,80,40),1);
  assert.ok(maskTextureVisibility(type,-20,20,10,10,80,40)<.01);
 }
 assert.ok(Math.abs(maskTextureVisibility('dot',0,20,10,10,80,40)-.5)<1e-6);
 assert.ok(maskTextureVisibility('dot',1,20,10,10,80,40)>.5);
 assert.ok(maskTextureVisibility('dot',-1,20,10,10,80,40)<.5);
 assert.ok(Math.abs(maskTextureVisibility('dot',0,0,10,10,80,40)-.25)<1e-6);
 assert.ok(maskTextureVisibility('dot',1,20,1,10,80,40)>.99);
});
test('size slider maps 0–100 to existing physical 0–130 without changing saved defaults',()=>{
 assert.equal(maskTextureSizeFromUi(100),130);
 assert.equal(maskTextureSizeFromUi(0),0);
 assert.ok(Math.abs(maskTextureSizeFromUi(maskTextureSizeToUi(15))-15)<1e-7);
 for(let n=0;n<=100;n++)assert.equal(maskTextureSizeToUi(maskTextureSizeFromUi(n)),n);
 const src=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
 assert.match(src,/value=\{maskTextureSizeToUi\(dotSize\)\}/);
 assert.match(src,/setDotSize\(maskTextureSizeFromUi\(v\)\)/);
});
test('squash 0–100 represents old 20–80, centred at 50',()=>{
 assert.equal(maskTextureSquashFromUi(0),20);assert.equal(maskTextureSquashFromUi(100),80);assert.equal(maskTextureSquashFromUi(50),50);
 for(let n=0;n<=100;n++)assert.equal(maskTextureSquashToUi(maskTextureSquashFromUi(n)),n);
});
test('squash participates in rendering cache, history and full-width non-stripe UI',()=>{
 const src=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
 assert.match(src,/setDotSquash\(st\.dotSquash \?\? 50\)/);
 assert.match(src,/setDotSquash\(e\.dotSquash \?\? 50\)/);
 assert.ok((src.match(/dotSize, dotGap, dotSquash/g)||[]).length>=5);
 assert.match(src,/col-span-2" data-mask-texture-squash/);
 assert.match(src,/paintMaskTexture\(fCtx, patternType, maskW, maskH,[\s\S]*?dotSquash\)/);
});
