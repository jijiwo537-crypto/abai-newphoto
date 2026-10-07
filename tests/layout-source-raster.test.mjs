import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const layout=readFileSync(new URL('../components/LayoutPhotoSurface.tsx',import.meta.url),'utf8');
const seam=readFileSync(new URL('../components/SeamlessLayout.tsx',import.meta.url),'utf8');
const creative=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
test('ordinary and fused layout capture the non-bubbling strip transform event',()=>{
 for(const s of [layout,seam]){
  assert.match(s,/addEventListener\('abai-preview-transform',paint,true\)/);
  assert.match(s,/removeEventListener\('abai-preview-transform',paint,true\)/);
 }
});
test('ordinary layout samples full source into bounded screen pixels, not a fixed CSS raster',()=>{
 assert.match(layout,/resolveSeamSurface\(points,width,height,width,height/);
 assert.match(layout,/const W=surface.pixelWidth,H=surface.pixelHeight/);
 assert.match(layout,/drawSeamShared\(cv,cells,clips,sources,-1/);
 assert.match(layout,/applyPhotoFx\(im,im.naturalWidth,im.naturalHeight/);
 assert.doesNotMatch(layout,/4096\/Math.max\(width,height\)/);
 assert.match(layout,/noVisibleGutter=gap<=\.001&&radius<=\.001/);
 assert.match(layout,/const bleedX=noVisibleGutter\?\(Math\.abs\(v\.xx\/W\)\+Math\.abs\(v\.xy\/H\)\)\*1\.25/);
 assert.match(layout,/crop's optical center on the unbled cell/);
});
test('photo selection paints cached pixels before resident scene preparation',()=>{
 const tap=creative.slice(creative.indexOf('const regionPointerUp='),creative.indexOf('const handlePointerDown ='));
 assert.match(tap,/regionSelectionFeedbackPending.current=true/);
 assert.match(tap,/regionPaintRef.current\(\)/);
 assert.match(creative,/!regionSelectionFeedbackPending.current&&\(basePhotoEditing/);
 assert.match(creative,/if\(live\)\{regionSelectionFeedbackPending.current=false/);
});
test('exact shared boundary pixel belongs to the right/lower cell, not a transparent tie',()=>{
 const gpu=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
 assert.match(gpu,/if\(isolated&&!sealEdges\?inside:distance<nearest\)/);
 assert.match(gpu,/if\(!inside&&!sealEdges\)weight=0\./);
 assert.match(gpu,/lessThan\(p,bounds.zw\)/);
 assert.match(gpu,/g.ex,g.ey,g.ex\+g.ew,g.ey\+g.eh/);
});
test('preview paths and export frame layout photos with one shared rule',async()=>{
 const grid=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
 const util=readFileSync(new URL('../utils/layoutCellPhoto.ts',import.meta.url),'utf8');
 assert.match(layout,/cellPhotoPlacement\(r\.w\*aw,r\.h\*ah,iw,ih,c\)/);
 assert.match(grid,/cellPhotoPlacement\(w,h,iw,ih,c\|\|\{\}\)/);
 assert.match(grid,/cellPhotoPlacement\(rawW, rawH, w_img, h_img, cell\)/);
 assert.match(grid,/const slotW = rect\.w \* areaW, slotH = rect\.h \* areaH;\s*const place = cellPhotoPlacement\(slotW, slotH, imgW, imgH, cell\)/);
 assert.doesNotMatch(grid,/1\.015 \+ 0\.005/);
 assert.doesNotMatch(grid+layout,/\*1\.02\*|\* 1\.02;/);
 assert.match(util,/CELL_COVER_BLEED = 1\.02/);
 const ts=(await import('typescript')).default,vm=await import('node:vm'),scope={exports:{}};
 vm.runInNewContext(ts.transpileModule(util,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,scope);
 const p=scope.exports.cellPhotoPlacement(300,400,600,800,{zoom:1.5,offsetX:.1,offsetY:-.2,rotation:90});
 assert.ok(Math.abs(p.scale-Math.max(300/800,400/600)*1.02*1.5)<1e-12);
 assert.equal(p.dx,30);assert.equal(p.dy,-80);
});
