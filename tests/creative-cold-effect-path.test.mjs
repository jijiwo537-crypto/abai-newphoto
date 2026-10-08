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
 assert.match(collage,/cap=regionEffectCapacity\(o,slot/);
 assert.match(fx,/releasePhotoFxSurface/);assert.match(gl,/disposeFxScene\(gl\)/);
});
test('colour worker and actual float shader are primed before the first input',()=>{
 const colour=read('../utils/photoSceneColour.ts');assert.match(colour,/constructor\(\)[\s\S]*postMessage\(\{warm:/);
 assert.match(colour,/const identity=new Float32Array\(32\*32\*32\*4\)/);
 assert.match(read('../utils/photoLut.worker.ts'),/if\(event.data.warm\)/);
});
test('editor LUTs decode and bake their exact master tables outside the UI thread',()=>{
 const worker=read('../utils/lutDecode.worker.ts'),colour=read('../utils/photoSceneColour.ts');
 assert.match(fx,/new Worker\(new URL\('\.\/lutDecode.worker.ts'/);
 assert.match(worker,/new OffscreenCanvas/);
 assert.match(worker,/needsLutAtlasRepair\(url\)\?repairLutAtlas/);
 assert.match(worker,/bakePixelMaster\(\{\.\.\.params,lutAmount:100\},cached\)/);
 assert.match(fx,/preparedPlainFilter\?\?=/);
 assert.match(colour,/getPreparedFilterPair\(fx.lut\)/);
 assert.match(read('../App.tsx'),/warmEditorLuts\(LUT_LIST\)/);
});
test('cold thumbnails are serialized and button clicks defer optional background work',()=>{
 assert.match(panel,/cardThumbWork\.then\(async/);
 assert.match(panel,/if\(cancelled\(\)\)return/);
 assert.match(panel,/onClickCapture=.*deferHeavyWork/);
 assert.match(panel,/<CardSourceThumb src=\{src\}/);
 assert.match(panel,/if\(request!==lutChoiceSerial.current\)return/);
});
test('panel rerenders read the live base photograph rather than overwrite a newer effect',()=>{
 assert.match(collage,/const regionPhoto = editRegionIndex !== null \? photoRegionRef.current\?\.photos\[editRegionIndex\]/);
});
test('the pinch-resized preview frame has no large blurred chrome layer',()=>{
 assert.doesNotMatch(collage,/boxShadow: '0 20px 50px rgba\(255,255,255,0\.05\)'/);
});
test('optical switching reuses its source and context, and geometry hits precede blend preparation',()=>{
 assert.match(fx,/const sourceKey=effectInputKey\(source,oW,oH,baseFx\)/);
 assert.match(fx,/if\(!optical\|\|optical.layer.lost\)/);
 assert.doesNotMatch(fx,/if\(!optical\|\|optical.key!==key\|\|optical.layer.lost\)/);
 assert.match(fx,/optical.layer.warm\(\)/);
 const start=collage.indexOf('const hit = objFxCache.current.get(o.id);');
 assert.ok(collage.indexOf('if (hit && hit.key === key && (!regionBlendTool.current',start)<collage.indexOf('regionBlend.current!.prepare',start));
 assert.match(collage,/const snapshot=hit\?\.cv instanceof HTMLCanvasElement&&hit.cv.dataset.regionImmutable==='1'\?hit.cv/);
});
test('320 optical changes allocate one renderer and update the correct effect each time',()=>{
 const branchStart=fx.indexOf('  if(opts?.gpuSurface&&opts.cacheSource');
 assert.ok(branchStart>=0);
 const branch=fx.slice(branchStart,fx.indexOf('  const residentEffects =',branchStart));
 let allocations=0,disposals=0,sourcePaints=0;const calls=[];
 const canvas=()=>({width:1,height:1,getContext:()=>({})});
 class Layer{
  lost=false;constructor(){allocations++;}setScene(){}dispose(){disposals++;}
  renderSoft(){calls.push('soft');return canvas();}render(){calls.push('halo');return canvas();}
  renderLeak(){calls.push('leak');return canvas();}
 }
 const context={opticalInputs:new WeakMap(),opticalKeys:new Set(['soft','softThreshold','softRadius','softColor','fringeIntensity','fringeSize','fringeFeather','fringeHue','leakOpacity','leakAngle','leakHue','blur','colorNoise','vignette']),HalationLayer:Layer,document:{createElement:canvas},hasActiveFx:()=>false,effectInputKey:(_s,w,h,p)=>JSON.stringify([w,h,p]),applyPhotoFx:(_s,_w,_h,_p,o)=>{sourcePaints++;return o.out;},releasePhotoFxSurface:()=>{},toParams:()=>({}),hslToRgb:()=>[],getNoisePattern:canvas,newSurface:canvas,getLoadedLut:()=>null,ADJUST_KEYS:[['brightness'],['exposure']],surfaceColourImage:()=>null};
 vm.createContext(context);
 const code='this.run=function(source,out,fx){const oW=100,oH=100,opts={scene:{},cacheSource:true,gpuSurface:true};'+branch+'};';
 vm.runInContext(ts.transpile(code,{target:ts.ScriptTarget.ES2022}),context);
 const out=canvas(),source=canvas();
 for(let i=0;i<320;i++)context.run(source,out,[{soft:40},{fringeIntensity:20},{leakOpacity:50}][i%3]);
 assert.equal(allocations,1);assert.equal(disposals,0);assert.equal(sourcePaints,1);
 assert.deepEqual(calls.slice(0,6),['soft','halo','leak','soft','halo','leak']);
 context.run(source,out,{soft:20,brightness:3});assert.equal(sourcePaints,2);assert.equal(allocations,1);
});
