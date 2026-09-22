import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('special pattern tiles reuse exact-resolution pixels without rerasterizing each copy',()=>{
  const source=fs.readFileSync('utils/holeShapes.ts','utf8');
  let rasterCalls=0,imageCalls=0,density=1;const draws=[];
  const sourceImage={complete:true,naturalWidth:100,naturalHeight:100};
  const context=()=>({setTransform(){},clearRect(){},save(){},restore(){},translate(){},rotate(){},fillRect(){},
    fillText(){rasterCalls++;},drawImage(...args){draws.push(args);if(args[0]===sourceImage)imageCalls++;},getTransform(){return {a:density,b:0,c:0,d:density};}});
  const scope={exports:{},document:{createElement(){return {width:0,height:0,getContext:context};}},
    GLYPH_HOLES:{aster:'᯽'},glyphInk:(_,__,sz)=>({w:sz,h:sz,r:sz/2,ox:0,oy:0}),
    glyphFont:()=>'',isImageHole:t=>t==='pic333',getHoleImg:()=>sourceImage};
  vm.runInNewContext(compile(source.slice(source.indexOf('const TEXT_TMP_MAX'),source.indexOf('export const drawShapePath'))),scope);
  const draw=scope.exports.drawTextShape,ctx=context();
  for(let i=0;i<30;i++)draw(ctx,'aster','',i*20,80,160,'#ffffff',false,0,true);
  assert.equal(rasterCalls,1);
  const firstSide=draws.at(-1)[3];
  density=2;draw(ctx,'aster','',0,80,160,'#ffffff',false,0,true);
  assert.equal(rasterCalls,2);assert.equal(draws.at(-1)[3],firstSide*2);
  draw(ctx,'aster','',0,80,160,'#ffffff',false,45,true);assert.equal(rasterCalls,3);
  draw(ctx,'aster','',0,80,160,'#000000',false,45,true);assert.equal(rasterCalls,4);
  draw(ctx,'aster','',0,80,160,'#000000',false,45,false);assert.equal(rasterCalls,5,'non-opt-in renderers are unchanged');
  for(let i=0;i<30;i++)draw(ctx,'pic333','',i*20,80,160,'#ffffff',false,0,true);
  assert.equal(imageCalls,1,'third-row first pattern is decoded/composited once for identical copies');
});
test('group size still scales individually resized patterns',()=>{
  const source=fs.readFileSync('components/CollageTool.tsx','utf8');
  const start=source.indexOf('const getHoleSize =');
  const end=source.indexOf('\n\n  const isHoleFullyInsideMask',start);
  const scope={useCallback:fn=>fn,imageState:{globalScale:1},holeSize:0,sizeJitter:0,layout:'mask-right',AROUND:'around'};
  vm.runInNewContext(compile(source.slice(start,end)+'\nglobalThis.size=getHoleSize;'),scope);
  const individual={localScale:2};assert.equal(scope.size(individual),50);
  scope.holeSize=100;assert.equal(scope.size(individual),300);assert.equal(scope.size({}),150);
});
test('group rotation retains individually edited offsets and local size ratios',()=>{
  const source=fs.readFileSync('components/CollageTool.tsx','utf8');
  const start=source.indexOf('const handleAngleChange =');
  let holes=[{id:'a',localScale:2},{id:'b',angle:350,localScale:.5}];
  const scope={holeAngle:20,setHoles(fn){holes=fn(holes);},setHoleAngle(v){scope.holeAngle=v;}};
  vm.runInNewContext(compile(source.slice(start,source.indexOf('\n  };',start)+5)+'\nglobalThis.adjust=handleAngleChange;'),scope);
  scope.adjust(50);
  assert.equal(holes[0].angle,undefined);assert.equal(holes[1].angle,20);
  assert.equal(holes[0].localScale,2);assert.equal(holes[1].localScale,.5);
});
