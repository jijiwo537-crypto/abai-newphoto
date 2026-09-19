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
let actualRect={left:-32,top:48,width:454,height:564};
class Canvas {
  dataset={};style={};width=0;height=0;
  ctx={save(){},restore(){},clearRect(){},drawImage(){},setTransform(...args){this.matrix=args;}};
  getContext(){return this.ctx;}
  getBoundingClientRect(){
    if(host.parentElement.style?.zoom){
      const k=Number(host.parentElement.style.zoom)*Number(this.style.zoom||1);
      return {left:20+parseFloat(this.style.left||0)*k,top:100+parseFloat(this.style.top||0)*k,
        width:parseFloat(this.style.width)*k,height:parseFloat(this.style.height)*k};
    }
    return actualRect;
  }
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
assert.equal(host.children[0].width,454*4.5);
assert.equal(host.children[0].height,564*4.5);
for(const value of [.25,.75,1,1.5,3,6]){
  zoom=value; scene.flush();
  const last=matrices.at(-1);
  assert.equal(last.density,4.5*value);
  assert.equal(last.matrix[0],4.5*value);
  assert.equal(last.matrix[4],234,'screen origin stays exact at every zoom');
  assert.equal(host.children[0].width,454*4.5,'pinch never reallocates an object bitmap');
  assert.equal(parseFloat(host.children[0].style.width)*value,454,'layout cancels parent zoom without a second transform');
  assert.equal(host.children[0].style.transform,'none');
}
zoom=2;
listeners.get('abai-preview-transform')();
assert.equal(matrices.at(-1).density,9,'geometry event repaints synchronously, not one animation frame later');
actualRect={left:-32.0078125,top:48.015625,width:454.015625,height:563.984375};
for(const value of [.25,.75,1,1.5,3,6]){
  zoom=value;scene.flush();const m=matrices.at(-1).matrix,c=host.children[0];
  const screenX=actualRect.left+(m[0]*85+m[4])*actualRect.width/c.width;
  const screenY=actualRect.top+(m[3]*60+m[5])*actualRect.height/c.height;
  assert.ok(Math.abs(screenX-(20+85*value))<1e-9,'fractional CSS width cannot shift ink horizontally');
  assert.ok(Math.abs(screenY-(100+60*value))<1e-9,'fractional CSS height cannot shift ink vertically');
}
actualRect={left:-32,top:48,width:454,height:564};
host.parentElement.style={};
for(const value of [.25,.75,1,1.5,3,6]){
  zoom=value;host.parentElement.style.zoom=String(value);scene.flush();
  const canvas=host.children[0],r=canvas.getBoundingClientRect();
  assert.ok(Math.abs(r.left+32)<1e-9,'native-zoom framebuffer stays at viewport origin');
  assert.ok(Math.abs(r.width-454)<1e-9,'native-zoom framebuffer has constant physical width');
  assert.equal(parseFloat(canvas.style.width),454,'pinch does not resize CSS bitmap layout');
}
host.parentElement.style={};
let animationTime=0,paintedTime=-1,opacityReads=0;
scene.set('clock',{z:64,opacity:()=>{opacityReads++;return .5;},paint:()=>{paintedTime=animationTime;}});
for(const t of [0,.016,.033,.5,.5,0]){
  animationTime=t;scene.flush();assert.equal(paintedTime,t,'paint reads current clock, including pause and replay, without re-registering');
}
assert.equal(opacityReads,6,'opacity follows the same live frame as geometry');
scene.remove('clock');
const photo={style:{zIndex:'61'},dataset:{}};
host.children.push(photo);scene.flush();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,2,'photo between vectors keeps its layer position');
scene.set('text',{z:60,opacity:.3,paint:noop});scene.flush();
scene.remove('symbol');scene.flush();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,1);
detach();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,0,'unmount releases surfaces');
console.log('PASS: shared canvas, six zoom factors, fixed backing size, interleaved layers, opacity, cleanup');
