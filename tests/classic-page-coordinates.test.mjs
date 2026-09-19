import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../utils/classicPageCoordinates.ts',import.meta.url),'utf8');
const {joinLegacyPages}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
test('old page positions migrate once without changing dimensions, local placement, or layouts',()=>{
 const pages=[{layouts:[]},{layouts:[]},{layouts:[]}];
 const old={pages,pageWidth:300,floatingImages:[
  {id:'first',x:0,width:300,height:400,scale:1},
  {id:'second',x:301,width:300,height:400,scale:1},
  {id:'third',x:622,width:80,height:90,scale:2},
 ],brushStrokes:[{points:[{x:10,y:10},{x:311,y:30},{x:612,y:50}]}]};
 const next=joinLegacyPages(old,999);
 assert.deepEqual(next.floatingImages.map(x=>x.x),[0,300,620]);
 assert.deepEqual(next.brushStrokes[0].points.map(x=>x.x),[10,310,610]);
 assert.equal(next.pages,pages);
 assert.equal(next.floatingImages[2].scale,2);
 assert.equal(old.floatingImages[1].x,301);
 assert.equal(joinLegacyPages(next,300),next);
});
test('single page and off-canvas objects do not get an invented negative page offset',()=>{
 const old={pages:[{}],floatingImages:[{x:-100,width:20},{x:350,width:50}]};
 assert.deepEqual(joinLegacyPages(old,300).floatingImages.map(f=>f.x),[-100,350]);
});
