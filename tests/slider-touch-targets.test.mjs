import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('creative occupancy and seamless sliders retain layout with enlarged touch zones',()=>{
 const s=read('components/CollageTool.tsx');
 for(const name of ['RegionLiveRange','RafRange']){
  const block=s.slice(s.indexOf('const '+name+' =')>=0?s.indexOf('const '+name+' ='):s.indexOf('const '+name+'='));
  assert.match(block.slice(0,1600),/slider-wrap w-full/);
 }
 assert.match(read('styles.css'),/slider-wrap::before[^}]*height: 56px/);
});
test('slider ownership prevents native panel scrolling and grabs the 44px thumb zone',()=>{
 assert.match(read('styles.css'),/\.slider-wrap \{[^}]*touch-action: none/);
 assert.match(read('components/GridLayoutTool.tsx'),/\.slider-wrap \{[^}]*touch-action: none/);
 assert.match(read('components/CollageTool.tsx'),/\.slider-wrap \{[^}]*touch-action: none/);
 const s=read('utils/sliderTouch.ts');
 assert.match(s,/Math.abs\(x0-center\)<=22/);
 assert.match(s,/let live = onThumb/);
 assert.match(s,/advance\(m.clientX, m.clientY\).*m.preventDefault/);
});
test('beauty has enlarged invisible touch area; color match already has a 64px transparent thumb',()=>{
 assert.match(read('components/BeautyStudio.tsx'),/slider-wrap flex-1/);
 assert.match(read('components/BeautyStudio.tsx'),/--thumb-w: 16px/);
 assert.match(read('components/ColorMatchStudio.tsx'),/height: 64px; width: 64px/);
});
test('lowfi default and filter icon match the requested settings without card button borders',()=>{
 assert.match(read('utils/glEffects.ts'),/id:'fxLowfiGrain'[^\n]*def:50/);
 for(const p of ['components/ImageEditor.tsx','components/GridLayoutTool.tsx']){
  assert.doesNotMatch(read(p),/bg-black\/55 border border-white\/25/);
 }
});
test('off-center thumb drag claims immediately, updates diagonally, prevents scroll and releases',()=>{
 const listeners=new Map(),events=[];
 class Input {
  min='0';max='100';step='1';dataset={};disabled=false;_value='50';
  get value(){return this._value;}set value(v){this._value=v;}
  getBoundingClientRect(){return {left:100,right:300,top:100,bottom:116,width:200,height:16};}
  dispatchEvent(e){events.push(e.type);return true;}
 }
 class Event {constructor(type,init={}){this.type=type;Object.assign(this,init);}}
 const input=new Input();
 const wrap={classList:{contains:c=>c==='slider-wrap'},querySelector:()=>input,getBoundingClientRect:()=>input.getBoundingClientRect(),setPointerCapture:()=>events.push('capture'),releasePointerCapture:()=>events.push('release')};
 const add=(name,fn)=>listeners.set(name,fn);
 const sandbox={exports:{},require:()=>({fineSliderValue:()=>50}),HTMLInputElement:Input,Event,PointerEvent:Event,MouseEvent:Event,getComputedStyle:()=>({getPropertyValue:()=>14}),document:{addEventListener:add,querySelectorAll:()=>[wrap]},window:{addEventListener:add,removeEventListener:(name)=>listeners.delete(name)}};
 vm.runInNewContext(ts.transpileModule(read('utils/sliderTouch.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
 sandbox.exports.installSliderTouch();
 listeners.get('pointerdown')({target:wrap,clientX:200,clientY:128,pointerId:1,pointerType:'touch'});
 assert.deepEqual(events,['pointerdown','capture']);
 let prevented=0;
 listeners.get('touchmove')({touches:[{clientX:280,clientY:145}],cancelable:true,preventDefault:()=>prevented++});
 assert.equal(prevented,1);assert.ok(Number(input.value)>80);
 listeners.get('pointerup')({pointerId:1,type:'pointerup',clientX:280,clientY:145});
 assert.ok(events.includes('pointerup'));assert.ok(events.includes('release'));assert.equal(listeners.has('touchmove'),false);
});
