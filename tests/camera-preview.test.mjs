import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../utils/cameraPreview.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {cameraPreviewGeometry,preferCameraResolution}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('camera renders native screen pixels and crops the sensor only once',()=>{
 assert.deepEqual(cameraPreviewGeometry(300,450,3,1920,1080),{w:900,h:1350,cropX:.375,cropY:1});
 assert.deepEqual(cameraPreviewGeometry(450,300,2,1080,1920),{w:900,h:600,cropX:1,cropY:.375});
 const limited=cameraPreviewGeometry(300,450,3,1920,1080,1024);
 assert.equal(limited.h,1024);assert.ok(limited.w<=1024);
});
test('camera upgrades fallback capture to real supported resolution and focus',async()=>{
 let constraints;
 await preferCameraResolution({getCapabilities:()=>({width:{max:4096},height:{max:3072},focusMode:['continuous']}),applyConstraints:async c=>{constraints=c;}});
 assert.equal(constraints.width.ideal,4096);assert.equal(constraints.height.ideal,3072);
 assert.equal(constraints.advanced[0].focusMode,'continuous');
 await preferCameraResolution({getCapabilities:()=>({}),applyConstraints:async()=>{throw Error('should not renegotiate');}});
 await preferCameraResolution({getCapabilities:()=>({width:{max:1000},height:{max:1000}}),applyConstraints:async()=>{throw Error('unsupported');}});
});
test('effect processing stays in sensor coordinates and camera controls cannot be side-masked',()=>{
 const view=readFileSync(new URL('../components/Viewfinder.tsx',import.meta.url),'utf8');
 assert.match(view,/ensureTargets\(sourceW, sourceH\)/);
 assert.match(view,/tc = \(tc - \.5\) \* u_effectCrop \+ \.5/);
 assert.doesNotMatch(view,/className="[^"]*object-cover/);
 const ui=readFileSync(new URL('../components/CameraInterface.tsx',import.meta.url),'utf8');
 assert.match(ui,/grid grid-cols-3 gap-2 w-\[calc\(100%-96px\)\] min-w-0/);
 assert.match(ui,/data-camera-effects-back/);
});
