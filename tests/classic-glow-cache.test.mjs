import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
const source=fs.readFileSync(new URL('../components/ClassicGlowCache.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',format:'esm'});
const {paintCachedClassicGlow}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let allocations=0,shadows=0;
globalThis.window={devicePixelRatio:3};
globalThis.document={createElement:()=>{
 allocations++;
 return {width:0,height:0,getContext(){
  return {setTransform(...m){this.matrix=m;},setLineDash(){},
   stroke(){shadows++;assert.ok(this.matrix[4]<0);assert.ok(this.shadowOffsetX>0);}};
 }};
}};
test('soft glow is computed once while preview/object transforms retain vector ink',()=>{
 const painted=[],ctx={drawImage:(...args)=>painted.push(args)};
 for(let i=0;i<240;i++)assert.equal(paintCachedClassicGlow(ctx,{},'rings',70,70,.656,[],'#fff',[1,2,3]),true);
 assert.equal(allocations,1);assert.equal(shadows,3);assert.equal(painted.length,240);
 assert.ok(painted.every(p=>p[0]===painted[0][0]&&p[3]===painted[0][3]),'same texture and scale throughout the gesture');
 assert.ok(painted[0][0].width>70*3*3,'fixed supersampling covers maximum preview zoom');
 const before=allocations;
 assert.equal(paintCachedClassicGlow(ctx,{},'huge',10000,10000,10,[],'#fff',[500]),false);
 assert.equal(allocations,before,'oversized cache falls back to original full-quality painter without allocating');
});
test('grid glow keeps the same renderer while tuning and at rest; source strokes stay vector',()=>{
 const grid=fs.readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
  assert.match(grid,/density \* Math.abs\(scale\), !motionFrame/);
  assert.match(grid,/cacheGlow && GRID_SHAPE_KINDS.has\(image.shape\) && !solid/);
 assert.match(grid,/for \(let i=0;i<3;i\+\+\) ctx.stroke\(path\)/);
 assert.match(grid,/density: number, cacheGlow = false/);
});
