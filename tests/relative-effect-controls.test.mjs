import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightHistogram,selectHighlights,highlightWeight} from '../utils/highlightSelection.js';
import {mosaicGrid,rankCandidates,scopedCandidates} from '../utils/artSampling.js';
import {fineSliderValue} from '../utils/sliderPrecision.js';
import {effectControlValue,effectStoredValue,effectControlMin} from '../utils/effectControlValues.js';
import {trackingDefaults} from '../utils/artTracking.js';
import {readFileSync} from 'node:fs';
test('both soft lights select the requested brightest fraction, including dim and tied photos',()=>{
 for(const values of [Array.from({length:256},(_,i)=>i),Array.from({length:256},(_,i)=>Math.floor(i/8)),Array(256).fill(12),Array.from({length:256},(_,i)=>225+Math.floor(i/9))]){
  const bins=highlightHistogram(values.flatMap(v=>[v,v,v,255]));
  for(const coverage of [0,1,10,30,50,80,100]){
   const selected=selectHighlights(bins,coverage);
   const actual=bins.reduce((sum,n,i)=>sum+n*highlightWeight(i,selected),0);
   assert.ok(Math.abs(actual-256*coverage/100)<1e-8);
   assert.ok(Number.isFinite(selected.tie));
  }
 }
 const editor=readFileSync(new URL('../components/ImageEditor.tsx',import.meta.url),'utf8');
 const photo=readFileSync(new URL('../utils/photoFx.ts',import.meta.url),'utf8');
 assert.match(editor,/selectHighlights\(highlightHistogram\(currentData\),100-p.softThreshold\)/);
 assert.match(photo,/selectHighlights\(highlightHistogram\(cur\),100-\(fx.softThreshold \?\? DEFAULT_PARAMS.softThreshold\)\)/);
 assert.match(editor,/effectControlValue\(toolId,value\)/);
 const gpu=readFileSync(new URL('../utils/glEffects.ts',import.meta.url),'utf8');
 assert.match(gpu,/selectHighlights\(c.highlightBins,params.fxSpillRange\?\?20\)/);
 for(const key of ['fxSpillRange','fxSpillDiffusion','fxSpillHue'])assert.match(gpu,new RegExp("id:'"+key+"'"));
 assert.doesNotMatch(gpu,/fxSpillStreak/);
});
test('mosaic density increases at every step with complete cells at all edges',()=>{
 const grids=Array.from({length:71},(_,i)=>mosaicGrid(180,240,30+i,.5));
 assert.equal(new Set(grids.map(g=>g.x)).size,71);
 for(let i=1;i<grids.length;i++)assert.ok(grids[i].pitch<grids[i-1].pitch&&grids[i].x>grids[i-1].x);
 for(const w of [1,31.7,180,3000])for(const h of [1,43.9,240,4000])for(const n of [2,16,40,60]){
  const g=mosaicGrid(w,h,n,.5);assert.ok(Number.isInteger(g.x)&&Number.isInteger(g.y));
  assert.ok(Math.abs(g.x*g.pitch-w)<1e-9);assert.ok(Math.abs(g.y*g.cellHeight-h)<1e-9);
 }
});
test('softll diffusion displays 0–100, maps to optical 10–100, and preserves default 50',()=>{
 assert.equal(effectControlMin('fxSpillDiffusion',10),0);
 assert.equal(effectStoredValue('fxSpillDiffusion',0),10);
 assert.equal(effectStoredValue('fxSpillDiffusion',100),100);
 assert.equal(effectControlValue('fxSpillDiffusion',50),44);
 for(let n=0;n<=100;n++)assert.equal(effectControlValue('fxSpillDiffusion',effectStoredValue('fxSpillDiffusion',n)),n);
 assert.equal(effectControlValue('softThreshold',80),20);
 assert.equal(effectStoredValue('softThreshold',20),80);
});
test('every effect detail shares fixed full-width geometry and both soft lights default to 20',()=>{
 const editor=readFileSync(new URL('../components/ImageEditor.tsx',import.meta.url),'utf8');
 const shared=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
 const art=readFileSync(new URL('../components/ArtStudio.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(editor+shared,/fxRows|fxRowH|height: fxDetailOpen \? '11rem'/);
 assert.match(editor,/soft: 0, softThreshold: 80/);
 assert.match(editor,/const softThresholdVal = 80/);
 assert.match(shared,/\['softThreshold', '範圍', 'tonality', 0, 100, 80\]/);
 assert.match(shared,/effectControlValue\(key,fxVal\(key,dflt\)\)/);
 assert.match(art,/count:s.count===0\?10:s.count/);
});
test('photo-relative node scope changes deterministic sampling on a low-contrast image',()=>{
 const points=rankCandidates(Array.from({length:400},(_,i)=>({score:.001+i*.00001,sample:((i*37)%397+1)/399})));
 const samples=[10,30,50,70,90].map(t=>scopedCandidates(points,t).slice(0,55));
 assert.equal(new Set(samples.map(s=>JSON.stringify(s))).size,5);
 for(let i=0;i<samples.length;i++)assert.ok(samples[i].every(n=>n.confidence>=[10,30,50,70,90][i]/100));
 assert.deepEqual(scopedCandidates(points,30),scopedCandidates(points,30));
 assert.equal(trackingDefaults.maxRadius,40);
});
test('dense slider thumb never jumps on grab and advances by one unit per pixel at most',()=>{
 for(const max of [100,180,360])for(const start of [0,20,60]){
  assert.equal(fineSliderValue(start,0,0,max,1,90),start);
  for(let d=0;d<50;d++)assert.ok(fineSliderValue(start,d+1,0,max,1,90)-fineSliderValue(start,d,0,max,1,90)<=1);
 }
 assert.equal(fineSliderValue(359,10,0,360,1,90),360);
 assert.equal(fineSliderValue(1,-10,0,100,1,90),0);
 assert.equal(fineSliderValue(.5,1,0,1,.1,90),.5);
});
