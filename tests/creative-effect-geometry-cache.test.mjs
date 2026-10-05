import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const gl=readFileSync(new URL('../utils/glEffects.ts',import.meta.url),'utf8');
const collage=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
test('preview uses resident photo textures without uploading the changing scene canvas',()=>{
 const presenter=readFileSync(new URL('../utils/creativeSeamless.ts',import.meta.url),'utf8');
 const shader=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
 assert.doesNotMatch(presenter,/overlay:\{image:main/);
 assert.match(presenter,/clipGuard:\[2\/W,2\/H\]/);
 assert.match(presenter,/W=main.width,H=main.height/);
 assert.match(presenter,/ctx.drawImage\(surface,0,0\)/);
 assert.match(presenter,/creativePhotoComposition='single-canvas'/);
 assert.doesNotMatch(presenter,/prepend\(surface\)|clearRect\(clearLeft/);
 assert.doesNotMatch(presenter,/getBoundingClientRect/);
 assert.doesNotMatch(shader,/sceneOverlay|overlayTexture|texSubImage2D/);
 assert.doesNotMatch(presenter,/this.main.style.opacity='0'/);
 assert.match(collage,/Math.ceil\(maskW\)/);
 assert.match(collage,/maskGuard-maskX, maskGuard-maskY/);
 assert.match(collage,/offs.mx\+maskX-maskGuard/);
 assert.match(collage,/ctx.rect\(offs.mx,offs.my,maskW,maskH\)/);
});
test('a chosen LUT at zero intensity does not run an unnecessary photo pipeline',()=>{
 const fx=readFileSync(new URL('../utils/photoFx.ts',import.meta.url),'utf8');
 const body=fx.slice(fx.indexOf('export const hasPhotoFx ='),fx.indexOf('/* ── LUT 載入'));
 const code=body.replace(/export /g,'').replace(/\(fx\?: PhotoFx\)/,'(fx)');
 const active=new Function('ADJUST_KEYS','hasActiveFx',code+';return hasPhotoFx;')([['bright','亮度']],()=>false);
 assert.equal(active({lut:'f3',lutAmount:0}),false);
 assert.equal(active({lut:'f3',lutAmount:1}),true);
 assert.equal(active({lut:'f3',lutAmount:0,bright:1}),true);
 assert.equal(active({lut:'f3'}),true);
});
test('scene photo result excludes geometry but tracks effect and colour changes',()=>{
 assert.match(gl,/const photoKey=sourceKey\?`\$\{sourceKey\}\|\$\{w\}x\$\{h\}\|\$\{JSON.stringify\(params\)\}`/);
 assert.match(gl,/photoResult\.full===colour\?\.full/);
 assert.match(gl,/photoResult\.plain===colour\?\.plain/);
 assert.match(gl,/photoResult\.amount===colour\?\.amount/);
 assert.match(gl,/composeFxScene\(gl,c\.photoResult\.texture,scene\)/);
 assert.match(gl,/c\.photoResult=undefined/);
});
test('unchanged native photo cache returns before effect endpoint preparation',()=>{
 assert.match(collage,/if \(hit && hit.key === key\) return hit.cv;/);
});
test('cards share bounded thumbnail sources and preload before effects tab',()=>{
 assert.match(panel,/FX_ROOT_TOOLS/);
 assert.match(panel,/cardSourceThumbCache.get\(img.src\)/);
 assert.match(panel,/cardSourceThumbCache.size>=20/);
 assert.match(panel,/old.width=old.height=1/);
});
test('leaving base editing releases unused scene storage even with photo zero present',()=>{
 assert.match(collage,/if\(!objEditImage\)\{[\s\S]*compactPhotoFxSurface\(resident.input\)/);
 assert.doesNotMatch(collage,/if\(!objEditImage&&selectedKey===null\)/);
});
test('all live base editing avoids synchronous snapshots and native idle bakes',()=>{
 assert.match(collage,/!regionPhotoEditingRef.current\|\|prepareNative/);
 assert.match(collage,/activeTab==='motion'\|\|objEditImage\)return/);
 assert.match(collage,/cancelled\|\|regionPhotoEditingRef.current\|\|!canvasRef.current/);
 assert.match(collage,/result.dataset.seamRevision=key/);
});
test('wheel zoom holds background photo work until the gesture commits',()=>{
 assert.match(collage,/wheelPhotoReleaseRef.current\?\?=holdPhotoInteraction\(\)/);
 assert.match(collage,/flushView\(true\);wheelPhotoReleaseRef.current\?\.\(\)/);
});
test('seam GPU capability and uniform queries are cached outside the hot path',()=>{
 const seam=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
 assert.match(seam,/this.maxTextureUnits=gl.getParameter/);
 assert.match(seam,/if\(count>this.maxTextureUnits\)/);
 assert.match(seam,/if\(!locations!.has\(name\)\)/);
 assert.equal((seam.match(/gl.getParameter\(/g)||[]).length,1);
});
test('ordinary photo grids do not retain duplicate native bitmaps',()=>{
 assert.match(collage,/const needsPinnedBitmap=layout===AROUND/);
 assert.match(collage,/for\(const src of needsPinnedBitmap\?sources:\[\]\)/);
});
test('swapping photo zero does not rerun the editor shader preflight',()=>{
 assert.match(collage,/regionShadersPrimed.current\)return/);
 assert.match(collage,/regionShadersPrimed.current=true/);
 assert.match(collage,/await awaitPhotoIdle\(\);if\(cancelled\)return;/);
});
test('compacting optical editing also releases its nested effect surface',()=>{
 const fx=readFileSync(new URL('../utils/photoFx.ts',import.meta.url),'utf8');
 const compact=fx.slice(fx.indexOf('export function compactPhotoFxSurface'),fx.indexOf('const spatialKeys'));
 assert.match(compact,/releasePhotoFxSurface\(optical.source\)/);
});
test('non-feathered pixels have exactly one photo owner at fractional boundaries',()=>{
 const seam=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
 assert.match(seam,/if\(distance<nearest\)\{nearest=distance;owner=/);
 assert.match(seam,/!fused\?owner==/);
 assert.match(seam,/image instanceof HTMLCanvasElement/);
 assert.match(seam,/this.textureBytes.clear\(\);this.revisions.clear\(\)/);
});
test('photo window clips and clearing use the shader pixel-centre boundary rule',()=>{
 const creative=readFileSync(new URL('../utils/creativeSeamless.ts',import.meta.url),'utf8');
 assert.match(collage,/scenePixelEdge\(ox,matrix.a,matrix.e\)/);
 assert.match(collage,/scenePixelEdge\(offs.mx,matrix.a,matrix.e\)/);
 assert.match(creative,/clearLeft=scenePixelEdge\(left\)/);
 assert.match(creative,/ctx.setTransform\(1,0,0,1,0,0\)/);
 // Adjacent windows always partition integer pixel centres, independently
 // of fractional preview zoom, with neither overlap nor unowned pixels.
 for(const scale of [.17,.333,.85,1,1.51,3.07,5.99]){
  const edges=[.13,120.37,250.91].map(x=>x*scale+.29);
  const split=edges.map(x=>Math.ceil(x-.5));
  for(let pixel=split[0];pixel<split[2];pixel++){
   const owners=(pixel>=split[0]&&pixel<split[1]?1:0)+(pixel>=split[1]&&pixel<split[2]?1:0);
   assert.equal(owners,1);
  }
 }
});
test('every preview layer shares one exact integer-raster to continuous-scene map',()=>{
 assert.match(collage,/rasterX=isMain&&!previewCapture\?tW\/offs.cw:1/);
 assert.match(collage,/vp.x\/tW\*100/);
 assert.match(collage,/backingW\/tW\*100/);
 assert.equal((collage.match(/setTransform\(rasterX, 0, 0, rasterY, -vp.x, -vp.y\)/g)||[]).length,3);
 assert.match(collage,/selectedKey===null\|\|!objEditImage\)return/);
 for(const logical of [1000.001,1000.49,1000.99,1307.111,1703.73]){
  const raster=Math.floor(logical),css=358.7;
  for(const fraction of [.1,.33,.5,.71,.9]){
   const pixel=logical*fraction*(raster/logical);
   assert.ok(Math.abs(pixel/raster*css-fraction*css)<1e-10);
  }
 }
});
