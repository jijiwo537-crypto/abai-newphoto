import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';

// Geometry/layer regression tests without a browser GPU. Visual QA additionally
// runs grid-qa.html in iOS Simulator Safari.
const compiled = (await build({entryPoints:[new URL('../components/ClassicVectorScene.ts', import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node',target:'es2022'})).outputFiles[0].text;
const {ClassicVectorScene,sceneRectBounds,unionSceneBounds} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
let nextFrame = 0;
globalThis.requestAnimationFrame = () => ++nextFrame;
globalThis.cancelAnimationFrame = () => {};
globalThis.window = {devicePixelRatio:3};
globalThis.ResizeObserver = class {observe(){} disconnect(){}};
let actualRect={left:-32,top:48,width:454,height:564};
let frameOperations=[];
class Canvas {
  dataset={};style={};width=0;height=0;
  ctx={save(){},restore(){},clearRect(...args){this.lastClear=args;frameOperations.push('paint');},drawImage(){},setTransform(...args){this.matrix=args;},getTransform(){const [a,b,c,d,e,f]=this.matrix;return {a,b,c,d,e,f};}};
  getContext(){return this.ctx;}
  getBoundingClientRect(){
    frameOperations.push('measure');
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
let pageNodes=[], styleReads=0;
globalThis.getComputedStyle=()=>{styleReads++;return {transform:'none'};};
globalThis.DOMMatrixReadOnly=class {a=1;b=0;c=0;d=1;e=0;f=0;};
const host={children:[],parentElement:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)},
  querySelectorAll:selector=>selector===':scope > [data-page-id]'?pageNodes:[],appendChild(c){this.children.push(c);},
  getBoundingClientRect:()=>({left:20,top:100})};
const scrollListeners=new Map();
const viewport={scrollLeft:0,scrollTop:0,addEventListener:(name,fn)=>scrollListeners.set(name,fn),removeEventListener:(name)=>scrollListeners.delete(name),
  getBoundingClientRect:()=>({left:0,top:80,width:390,height:500})};
let zoom=1;
const scene=new ClassicVectorScene();
const detach=scene.attach(host,viewport,()=>zoom);
const matrices=[];
scene.set('text',{z:60,paint:(ctx,density)=>{matrices.push({matrix:ctx.matrix,density});}});
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
  assert.equal(parseFloat(host.children[0].style.width),454,'CSS bitmap size stays constant during pinch');
  assert.equal(host.children[0].style.transform,`translate(${-52/value}px, ${-52/value}px) scale(${1/value})`,'one inverse affine transform cancels parent scale and translation');
}
zoom=2;
listeners.get('abai-preview-transform')();
assert.equal(matrices.at(-1).density,9,'geometry event repaints synchronously, not one animation frame later');
let frameCount=nextFrame;
scrollListeners.get('scroll')();
assert.equal(nextFrame,frameCount,'delayed scroll event for an already painted pinch position schedules no duplicate frame');
viewport.scrollLeft=20;scrollListeners.get('scroll')();
assert.equal(nextFrame,frameCount+1,'new native scroll position still requests a paint');
scene.flush();frameCount=nextFrame;scrollListeners.get('scroll')();
assert.equal(nextFrame,frameCount,'paint commits the new scroll position');
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
host.children.push(photo);frameOperations=[];scene.flush();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,2,'photo between vectors keeps its layer position');
assert.ok(frameOperations.lastIndexOf('measure')<frameOperations.indexOf('paint'),
  'all stacking surfaces are measured before any surface paints, without interleaved layout/paint');
scene.set('text',{z:60,opacity:.3,paint:noop});scene.flush();
scene.remove('symbol');scene.flush();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,1);
let pageBoundsReads=0;
pageNodes=[0,1].map(i=>({getBoundingClientRect(){pageBoundsReads++;frameOperations.push('page-measure');return {left:20+i*300*zoom,top:100,width:300*zoom,height:400*zoom};}}));styleReads=0;
const poses=[];
for(let i=0;i<100;i++)scene.set(`tiny-${i}`,{z:70,paint:()=>{poses.push(scene.pageTransform(i%2));}});
frameOperations=[];scene.flush();
assert.equal(styleReads,2,'100 small objects read page styles only once per page per frame');
assert.equal(pageBoundsReads,2,'separator geometry is read once per page');
assert.deepEqual(scene.pageBounds(),[{x:0,y:0,width:300,height:400},{x:300,y:0,width:300,height:400}]);
assert.ok(frameOperations.lastIndexOf('page-measure')<frameOperations.indexOf('paint'),'page geometry is captured before painting');
assert.equal(poses.length,100);
assert.ok(poses.every((pose,i)=>pose===poses[i%2]),'every object receives the identical page snapshot');
const previousPose=poses[0];poses.length=0;styleReads=0;scene.flush();
assert.equal(styleReads,2);
assert.notEqual(poses[0],previousPose,'the shared snapshot refreshes on each frame');
detach();
assert.equal(host.children.filter(v=>v instanceof Canvas).length,0,'unmount releases surfaces');
pageNodes=[];host.children=[];
const bounded=new ClassicVectorScene();bounded.attach(host,viewport,()=>1);
let footprint={x:20,y:30,width:15,height:12};
bounded.set('tiny',{z:1,paint:()=>footprint});bounded.flush();
footprint={x:70,y:80,width:18,height:16};bounded.flush();
assert.deepEqual(host.children[0].ctx.lastClear,[20,30,15,12],'old footprint is erased before moving small ink');
bounded.remove('tiny');bounded.set('unknown',{z:1,paint:noop});bounded.flush();
assert.deepEqual(host.children[0].ctx.lastClear,[70,80,18,16],'old bounded ink is removed when changing painter');
bounded.flush();assert.deepEqual(host.children[0].ctx.lastClear,[0,0,454*4.5,564*4.5],'unknown painters retain full clear');
const b=sceneRectBounds({getTransform:()=>({a:0,b:2,c:-2,d:0,e:100,f:80})},-10,-5,20,10,3);
assert.deepEqual(b,{x:87,y:57,width:26,height:46},'rotated bounds include every corner and pixel padding');
assert.deepEqual(unionSceneBounds({x:0,y:0,width:0,height:0},b),b);
let deadline=performance.now()+1000;
bounded.set('fade',{z:2,paint:noop,animateUntil:()=>deadline});frameCount=nextFrame;bounded.flush();
assert.equal(nextFrame,frameCount+1,'active fade schedules its next frame');
deadline=0;frameCount=nextFrame;bounded.flush();assert.equal(nextFrame,frameCount,'finished fades stop scheduling');
console.log('PASS: shared canvas, six zoom factors, fixed backing size, interleaved layers, opacity, cleanup');
