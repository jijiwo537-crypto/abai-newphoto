import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const collage=read('../components/CollageTool.tsx'),fx=read('../utils/photoFx.ts'),gl=read('../utils/glEffects.ts'),panel=read('../components/GridLayoutTool.tsx');
test('background work cannot force itself through a held interaction timeout',async()=>{
 let time=0;const queue=[];
 const context={performance:{now:()=>time},setTimeout:(fn,ms)=>queue.push({at:time+ms,fn}),Symbol,Set,Date};
 vm.createContext(context);vm.runInContext(ts.transpile(read('../utils/photoInteractionIdle.ts').replace(/export /g,''),{target:ts.ScriptTarget.ES2022})+';this.api={holdPhotoInteraction,awaitPhotoIdle};',context);
 const release=context.api.holdPhotoInteraction();let done=false;context.api.awaitPhotoIdle(1).then(()=>done=true);
 const advance=async(ms)=>{const target=time+ms;for(let i=0;i<300;i++){queue.sort((a,b)=>a.at-b.at);if(!queue.length||queue[0].at>target)break;const job=queue.shift();time=job.at;job.fn();await Promise.resolve();await Promise.resolve();}time=target;await Promise.resolve();};
 await advance(5000);assert.equal(done,false);release();release();await advance(500);await Promise.resolve();assert.equal(done,true);
});
test('filter thumbnails invalidate only their own decoded LUT and yield before painting',()=>{
 assert.match(panel,/await awaitPhotoIdle\(\)/);
 assert.match(panel,/lut:\$\{l.id\}\|\$\{getLoadedLut\(l.id\)\?'ready':'pending'\}/);
 assert.doesNotMatch(panel,/cacheKey=.*lutRevision/);
 assert.match(panel,/releaseBackgroundHold.current=holdPhotoInteraction\(\)/);
});
test('spatial base sliders keep an immutable input and a resident final scene',()=>{
 assert.match(fx,/effectInputs = new WeakMap/);assert.match(fx,/d.params.map\(e => e.id\)/);
 assert.match(fx,/retained.source.getContext\('2d'\).*inputKey, retained.surface, false, opts\?\.scene/);
 assert.match(collage,/regionSpatialActive.current=activeTab!=='motion'&&activeTab!=='setting'&&\(baseSelected\|\|selectedRegionPhoto!==null\);/);
 assert.match(collage,/targetCanvas===canvasRef.current&&!previewCapture/);
 assert.match(collage,/shown!==resident.input&&shown.width===targetCanvas.width/);
 assert.match(collage,/resident.shown&&resident.shown!==shown\)resident.shown.remove/);
 assert.match(gl,/composeFxScene\(gl,texs\[cur\],scene\)/);
});
test('legacy optics reuse the editor kernels without a release-resolution switch',()=>{
 assert.match(fx,/layer:new HalationLayer/);assert.match(fx,/layer.renderSoft/);assert.match(fx,/layer.renderBlur/);assert.match(fx,/layer.renderSimple/);
 const layer=read('../utils/halationLayer.ts');assert.match(layer,/composeFxScene\(gl,this.sceneResult!,this.scene\)/);
 assert.match(collage,/cap=photoPreviewCapacity\(onScreenPx/);
 assert.match(fx,/releasePhotoFxSurface/);assert.match(gl,/disposeFxScene\(gl\)/);
});
test('colour worker and actual float shader are primed before the first input',()=>{
 const colour=read('../utils/photoSceneColour.ts');assert.match(colour,/constructor\(\)[\s\S]*postMessage\(\{warm:/);
 assert.match(colour,/const identity=new Float32Array\(32\*32\*32\*4\)/);
 assert.match(read('../utils/photoLut.worker.ts'),/if\(event.data.warm\)/);
});
