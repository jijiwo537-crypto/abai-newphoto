import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const code=ts.transpileModule(read('../utils/photoPreviewResolution.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {photoPreviewCapacity}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('occupancy edits retain pixel density without per-frame capacity changes',()=>{
 let cap=0;
 for(const screen of [800,2100,1900,950,2099,900]){const next=photoPreviewCapacity(screen,cap,4096);assert.ok(next>=screen);assert.ok(next>=cap);cap=next;}
 assert.equal(cap,2304);
 assert.equal(photoPreviewCapacity(8000,cap,4096),4096);
 assert.equal(photoPreviewCapacity(900,0,1200),1200);
});
test('effects preflight uses the real persistent surface and shares captured endpoints',()=>{
 const collage=read('../components/CollageTool.tsx'),fx=read('../utils/photoFx.ts');
 assert.match(fx,/warmFx\(id,retained.surface\)/);
 assert.match(collage,/await awaitPhotoIdle\(\);if\(cancelled\)return/);
 assert.match(collage,/scene:\{black:scenes\[1\],white:scenes\[2\],placements\}/);
 assert.match(collage,/input:resident\?\.input\|\|regionSpatialInput.current/);
});
test('leaving base editing retires GPU resources but preserves cached pixels',()=>{
 const collage=read('../components/CollageTool.tsx'),gl=read('../utils/glEffects.ts');
 assert.match(collage,/snapshot.width=cached.cv.width;snapshot.height=cached.cv.height/);
 assert.match(collage,/releasePhotoFxSurface\(surface\)/);
 assert.match(collage,/regionColour.current\?\.dispose\(\);regionColour.current=null/);
 assert.match(collage,/regionSpatialActive.current=activeTab==='objedit'/);
 assert.match(collage,/regionColourActive.current=activeTab==='objedit'/);
 assert.match(gl,/getExtension\('WEBGL_lose_context'\)\?\.loseContext\(\)/);
});
test('camera effect cards stay symmetric while close control matches exposure',()=>{
 const ui=read('../components/CameraInterface.tsx');
 const row=ui.slice(ui.indexOf('<div data-camera-effects-row'),ui.indexOf(') : (',ui.indexOf('<div data-camera-effects-row')));
 assert.match(row,/justify-center/);assert.match(row,/right-5 top-1\/2/);assert.match(row,/name="expand_more"/);assert.doesNotMatch(row,/name="arrow_back"/);
 const home=read('../components/HomePage.tsx');assert.doesNotMatch(home,/探索影像的另一種可能/);
});
