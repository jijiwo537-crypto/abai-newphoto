import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const s=fs.readFileSync('components/CollageTool.tsx','utf8');
test('only centre photo painting requests swap dimming',()=>{
 assert.match(s,/allowDim = false/);assert.match(s,/isMain && allowDim && swapSource/);
 assert.match(s,/offs\.ix, offs\.iy, iw, ih, kIn, true/);
});
test('base selected frame is painted before foreground objects, not as a DOM border',()=>{
 const cell=s.slice(s.indexOf('return <div key={i} data-photo-cell'),s.indexOf('return <div key={i} data-photo-cell')+500);
 assert.doesNotMatch(cell,/border:/);assert.match(s,/Base-photo chrome belongs to the base layer/);
 assert.match(s,/ctx\.clip\('evenodd'\)/);
});
test('base photos edit through the same image panel without shapes',()=>{
 assert.match(s,/hideShape=\{regionEditing\}/);assert.match(s,/photos:photoRegionRef\.current\.photos\.map/);
 assert.match(s,/region-fx-\$\{i\}@\$\{p\.src\}/);
 assert.match(s,/region-processed-\$\{i\}@\$\{p\.src\}/);
 assert.match(s,/width:\(processed as any\)\.naturalWidth \|\| \(processed as any\)\.width/);
});
test('base-photo composition persists back to the region and thumbnail excludes its frame',()=>{
 assert.match(s,/regionIndex >= 0 \? photoRegionRef\.current\?\.photos\[regionIndex\]/);
 assert.match(s,/src:newSrc,origSrc:srcUrl,geo:st\.geo,width:el\.naturalWidth,height:el\.naturalHeight/);
 assert.match(s,/if \(selectedRegionPhotoRef\.current !== null\) renderToCanvas\(tc, s \* tk\)/);
});
