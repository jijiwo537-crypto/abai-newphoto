import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Geometry/layer regression tests without a browser GPU. Visual QA additionally
// runs grid-qa.html in iOS Safari and a Home Screen web app.
const compiled = ts.transpileModule(fs.readFileSync(new URL('../components/ClassicVectorScene.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const {ClassicVectorScene} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
let nextFrame = 0;
globalThis.requestAnimationFrame = () => ++nextFrame;
globalThis.cancelAnimationFrame = () => {};
globalThis.window = {devicePixelRatio:3};
globalThis.ResizeObserver = class {observe(){} disconnect(){}};
class Canvas {
  dataset={};style={};width=0;height=0;
  ctx={save(){},restore(){},clearRect(){},drawImage(){},setTransform(...args){this.matrix=args;}};
  getContext(){return this.ctx;}
  remove(){host.children=host.children.filter(v=>v!==this);}
}
globalThis.HTMLCanvasElement=Canvas;
globalThis.document={createElement:()=>new Canvas()};
const noop=()=>{};
const listeners=new Map();
const host={children:[],parentElement:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)},
  querySelectorAll:()=>[],appendChild(c){this.children.push(c);},
  getBoundingClientRect:()=>({left:20,top:100})};
const viewport={addEventListener:noop,removeEventListener:noop,
  getBoundingClientRect:()=>({left:0,top:80,width:390,height:500})};
let zoom=1;
const scene=new ClassicVectorScene();
const detach=scene.attach(host,viewport,()=>zoom);
const matrices=[];
scene.set('text',{z:60,paint:(ctx,density)=>matrices.push({matrix:ctx.matrix,density})});
scene.set('symbol',{z:62,paint:noop});
scene.flush();
assert.equal(host.children.length,1,'adjacent vectors share one scene canvas');
assert.equal(host.children[0].width,454*3);
assert.equal(host.children[0].height,564*3);
for(const value of [.25,.75,1,1.5,3,6]){
  zoom=value; scene.flush();
  const last=matrices.at(-1);
  assert.equal(last.density,3*value);
  assert.equal(last.matrix[0],3*value);
  assert.equal(last.matrix[4],156,'screen origin stays exact at every zoom');
  assert.equal(host.children[0].width,454*3,'pinch never reallocates an object bitmap');
  assert.equal(parseFloat(host.children[0].style.width)*value,454,'layout cancels parent zoom without a second transform');
  assert.equal(host.children[0].style.transform,'none');
}
zoom=2;
listeners.get('abai-preview-transform')();
assert.equal(matrices.at(-1).density,6,'geometry event repaints synchronously, not one animation frame later');
const photo={style:{zIndex:'61'},dataset:{}};
host.children.push(photo);scene.flush();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,2,'photo between vectors keeps its layer position');
scene.set('text',{z:60,opacity:.3,paint:noop});scene.flush();
scene.remove('symbol');scene.flush();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,1);
detach();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,0,'unmount releases surfaces');
console.log('PASS: shared canvas, six zoom factors, fixed backing size, interleaved layers, opacity, cleanup');
