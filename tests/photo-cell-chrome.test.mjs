import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../utils/photoCellChrome.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {emptyCellSeparators,SOLID_PLUS_PATH}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('adjacent blank cells share exactly one dashed separator',()=>{
 const rects=[{x:0,y:0,w:.5,h:.5},{x:.5,y:0,w:.5,h:.5},{x:0,y:.5,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}];
 assert.equal(emptyCellSeparators(rects,[true,true,true,true]).length,4);
 assert.deepEqual(emptyCellSeparators(rects,[false,false,true,true]),[{x1:.5,y1:.5,x2:.5,y2:1}]);
 assert.equal(emptyCellSeparators(rects,[false,true,true,false]).length,0);
});
test('overlapping inset photos do not generate arbitrary internal seams',()=>{
 assert.deepEqual(emptyCellSeparators([{x:0,y:0,w:1,h:1},{x:.3,y:.3,w:.4,h:.4}],[true,true]),[]);
});
test('plus is a closed filled outline rather than two overlapping strokes',()=>{
 assert.equal((SOLID_PLUS_PATH.match(/M/g)||[]).length,1);assert.ok(SOLID_PLUS_PATH.endsWith('Z'));
});
test('feather resource keys depend on photo/crop, never preview zoom or pan',()=>{
 const s=readFileSync(new URL('../utils/creativeFeatherSurface.ts',import.meta.url),'utf8');
 assert.match(s,/cropKey=JSON.stringify\(\[p,g\]\)/);assert.match(s,/density=image\?1\/tr.scale:1/);
 assert.doesNotMatch(s,/cropKey=JSON.stringify\([^\n]*(?:m\.a|m\.e|left|right)/);
 assert.match(s,/Integer source-pixel origin/);
});
