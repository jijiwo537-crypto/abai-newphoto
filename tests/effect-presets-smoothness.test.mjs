import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {effectPreset} from '../utils/effectPresets.js';
import {effectControlStep,isContinuousEffectControl} from '../utils/effectControlValues.js';
import {fineSliderValue} from '../utils/sliderPrecision.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('effect thumbnails and activation use the same actual presets',()=>{
 const definitions=[{id:'fxExample',onAmount:60,params:[{id:'range',def:20},{id:'radius',def:50}]}];
 assert.deepEqual(effectPreset('fxExample',definitions),{fxExample:60,range:20,radius:50});
 assert.deepEqual(effectPreset('halation',definitions),{fringeIntensity:100,fringeSize:10,fringeFeather:100,fringeHue:8});
 assert.deepEqual(effectPreset('blur',definitions,30),{blur:30});
 assert.deepEqual(effectPreset('colorNoise',definitions),{grain:0,colorNoise:40,colorNoise2:0});
 assert.deepEqual(effectPreset('missing',definitions),{});
 const editor=read('components/ImageEditor.tsx'),shared=read('components/GridLayoutTool.tsx');
 assert.doesNotMatch(editor,/FX_THUMB_DEMO|demo\[tool.id as/);
 assert.match(editor,/effectPreset\(tool.id,FX_DEFS,blurDefault\)/);
 assert.match(editor,/Object.assign\(next,effectPreset\(toolId,FX_DEFS\)\)/);
 assert.match(shared,/fx=\{effectPreset\(id,FX_DEFS\) as PhotoFx\}/);
});
test('continuous optical controls have fine sub-unit movement without changing discrete controls',()=>{
 for(const key of ['fxPearlFreq','fxRgbAmount','fxBlocksAmount','fxSliceAmount','fxSpinAngle','fxMotionLength']){
  assert.equal(effectControlStep(key),.1);assert.ok(isContinuousEffectControl(key));
 }
 for(const key of ['fxGlassBlocks','fxBlocksSeed','fxSpillRange','fxLowfiFilter'])assert.equal(effectControlStep(key),1);
 for(const travel of [90,280,440]){
  const values=Array.from({length:41},(_,i)=>fineSliderValue(5,i,0,20,.1,travel,true));
  assert.ok(new Set(values).size>10);assert.equal(values[0],5);
  assert.equal(fineSliderValue(0,travel,0,20,.1,travel,true),20);
  assert.ok(values.slice(1).every((v,i)=>v-values[i]<=.3));
 }
});
test('crosspage color picker header has neither HEX nor an extra color sample',()=>{
 const source=read('components/GridLayoutTool.tsx');
 const header=source.slice(source.indexOf('data-fixed-color-page'),source.indexOf('色票只排一排',source.indexOf('data-fixed-color-page')));
 assert.doesNotMatch(header,/backgroundColor|toUpperCase|input|shadow-inner/);
 assert.match(header,/aria-label="返回"/);
});
