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
 assert.match(layout,/drawSeamPreview\(cv,cells,clips,sources,-1/);
 assert.match(layout,/applyPhotoFx\(im,im.naturalWidth,im.naturalHeight/);
 assert.doesNotMatch(layout,/4096\/Math.max\(width,height\)/);
 assert.match(layout,/noVisibleGutter=gap<=\.001&&radius<=\.001/);
 assert.match(layout,/const bleedX=noVisibleGutter\?\(Math\.abs\(surface\.view\.xx\/W\)\+Math\.abs\(surface\.view\.xy\/H\)\)\*\.5/);
 assert.match(layout,/crop's optical center fixed/);
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
 assert.match(gpu,/if\(isolated\?inside:distance<nearest\)/);
 assert.match(gpu,/lessThan\(p,bounds.zw\)/);
 assert.match(gpu,/g.ex,g.ey,g.ex\+g.ew,g.ey\+g.eh/);
});
