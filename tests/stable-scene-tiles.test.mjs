import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';
const source=ts.transpileModule(fs.readFileSync(new URL('../utils/stableSceneTiles.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(){
 const sandbox={exports:{},requestAnimationFrame:f=>queueMicrotask(f),document:{createElement:()=>({width:0,height:0,getContext:()=>null})},DOMPoint:class{constructor(x,y){this.x=x;this.y=y;}matrixTransform(){return this;}}};
 vm.runInNewContext(source,sandbox);return new sandbox.exports.StableSceneTiles();
}
test('scene tiles cover a continuous shared raster with filter guards',async()=>{
 const scene=fixture(),windows=[];
 assert.equal(await scene.prepare('a',1540,1100,2,(c,v)=>{c.width=v.w;c.height=v.h;windows.push(v);},()=>true),true);
 assert.equal(windows.length,6);assert.equal(windows[0].x,-16);assert.equal(windows[1].x,752);
 assert.equal(windows.at(-1).x+windows.at(-1).w,1556);assert.equal(windows.at(-1).y+windows.at(-1).h,1116);
 const scales=[],draw=[];const ctx={canvas:{width:1540,height:1100},getTransform:()=>({inverse:()=>({})}),save(){},restore(){},scale:(x,y)=>scales.push([x,y]),drawImage:(...a)=>draw.push(a)};
 assert.equal(scene.paint(ctx,'a',999.3,713.75),true);
 assert.deepEqual(scales[0],[999.3/1540,713.75/1100]);assert.equal(draw.length,6);
 assert.equal(scene.paint(ctx,'stale',999.3,713.75),false);
 scene.dispose();assert.equal(scene.key,'');assert.ok(draw.every(a=>a[0].width===1));
});
test('cancelled generation never presents partially updated objects',async()=>{
 const scene=fixture();let calls=0;
 assert.equal(await scene.prepare('a',1540,1100,2,(c,v)=>{calls++;c.width=v.w;c.height=v.h;},()=>calls<1),false);
 assert.equal(scene.key,'');assert.equal(calls,1);
});
test('oversized snapshots are refused rather than downsampling or unbounded allocation',async()=>{
 const scene=fixture();let painted=0;
 assert.equal(await scene.prepare('huge',10000,10000,1,()=>painted++,()=>true),false);
 assert.equal(painted,0);assert.equal(scene.key,'');assert.equal(scene.status,'size budget');
});
test('both editors remove shape opacity controls without rewriting saved alpha',()=>{
 for(const file of ['CollageTool','GridLayoutTool']){
  const s=fs.readFileSync(new URL('../components/'+file+'.tsx',import.meta.url),'utf8');
  assert.ok(!/shapeSlider\('透明度'/.test(s));
  if(file==='GridLayoutTool')assert.ok(!/slider\('透明度', layer\.opacity/.test(s));
 }
});
