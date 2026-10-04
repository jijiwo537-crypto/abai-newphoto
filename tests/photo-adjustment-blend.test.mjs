import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const helper=readFileSync(new URL('../utils/photoAdjustmentBlend.ts',import.meta.url),'utf8');
const collage=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
test('base tuning caches full-density frames without interaction resolution reduction',()=>{
 assert.match(helper,/applyPhotoFx\(source,w,h/);
 assert.match(helper,/immutable.width=projected.width;immutable.height=projected.height/);
 assert.match(helper,/drawImage\(this.stages\[endpoint\]/);
 assert.doesNotMatch(helper,/640|fast:true|readPixels/);
 assert.match(helper,/ctx.getImageData\(0,0,1,1\)/);
 assert.doesNotMatch(helper.slice(helper.indexOf('  paint('),helper.indexOf('  clear()')),/getImageData/);
 assert.match(helper,/if\(this.held\).*setTimeout\(build,80\)/);
 assert.match(helper,/this.generation\+\+/);
 assert.match(helper,/project\?16_000_000:4_000_000/);
 assert.match(helper,/projected.width\*projected.height>4_000_000/);
 assert.match(helper,/canvas.width=canvas.height=1/);
});
test('only selected creative base preview blends; release and export retain exact processing',()=>{
 assert.match(collage,/selectedBase=regionPhoto&&isMain/);
 assert.match(collage,/regionSliderHeld.current&&!previewCapture/);
 assert.match(collage,/regionSliderHeld.current=false;[\s\S]*?regionBlend.current\?\.setHeld\(false\)/);
 assert.match(collage,/regionBlend.current\?\.clear\(\);regionPaintRef.current\(\);\},\[lutRevision\]/);
 assert.match(collage,/stamp\?\.key===regionSceneKey.current/);
 assert.match(collage,/\[regionBlendTool.current\]:0/);
});
