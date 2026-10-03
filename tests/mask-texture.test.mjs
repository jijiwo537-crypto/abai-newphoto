import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../utils/maskTexture.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source.replace(/import .*?;\n/,'const patternGlyph=()=>{};\n'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {maskTextureScale,paintMaskTexture}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('squash centre preserves size, left compresses vertically, right horizontally',()=>{
 assert.deepEqual(maskTextureScale(50),{x:1,y:1});
 assert.deepEqual(maskTextureScale(0),{x:1,y:.1});
 assert.ok(Math.abs(maskTextureScale(100).x-.1)<1e-9);
 assert.equal(maskTextureScale(100).y,1);
 assert.deepEqual(maskTextureScale(NaN),{x:1,y:1});
});
test('edge glyphs are retained under a single mask clip',()=>{
 const centres=[],scales=[];let clips=0,depth=0;
 const ctx={save(){depth++;},restore(){depth--;},beginPath(){},rect(){},clip(){clips++;},translate(x,y){centres.push([x,y]);},scale(x,y){scales.push([x,y]);}};
 paintMaskTexture(ctx,'dot',80,40,10,40,50);
 assert.ok(centres.some(([x,y])=>x===0&&y===20));
 assert.ok(centres.some(([x,y])=>x===80&&y===20));
 assert.equal(clips,1);assert.equal(depth,0);
 const baseline=JSON.stringify(centres.filter(([,y])=>y===20));centres.length=0;
 paintMaskTexture(ctx,'dot',80,40,10,40,0);
 assert.equal(JSON.stringify(centres.filter(([,y])=>y===20)),baseline);
});
test('squash participates in rendering cache, history and full-width non-stripe UI',()=>{
 const src=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
 assert.match(src,/setDotSquash\(st\.dotSquash \?\? 50\)/);
 assert.match(src,/setDotSquash\(e\.dotSquash \?\? 50\)/);
 assert.ok((src.match(/dotSize, dotGap, dotSquash/g)||[]).length>=5);
 assert.match(src,/col-span-2" data-mask-texture-squash/);
 assert.match(src,/paintMaskTexture\(fCtx, patternType, maskW, maskH,[\s\S]*?dotSquash\)/);
});
