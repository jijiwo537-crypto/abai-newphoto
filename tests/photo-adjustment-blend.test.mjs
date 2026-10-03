import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const helper=readFileSync(new URL('../utils/photoAdjustmentBlend.ts',import.meta.url),'utf8');
const collage=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
test('base tuning caches full-density frames without interaction resolution reduction',()=>{
 assert.match(helper,/applyPhotoFx\(source,w,h/);
 assert.match(helper,/immutable.width=w;immutable.height=h/);
 assert.match(helper,/drawImage\(this.stages\[endpoint\]/);
 assert.doesNotMatch(helper,/640|fast:true|readPixels|getImageData/);
 assert.match(helper,/if\(this.held\).*setTimeout\(build,80\)/);
 assert.match(helper,/this.generation\+\+/);
 assert.match(helper,/canvas.width=canvas.height=1/);
});
test('only selected creative base preview blends; release and export retain exact processing',()=>{
 assert.match(collage,/selectedBase=regionPhoto&&isMain/);
 assert.match(collage,/if\(regionSliderHeld.current\)/);
 assert.match(collage,/regionSliderHeld.current=false;[\s\S]*?regionBlend.current\?\.setHeld\(false\)/);
 assert.match(collage,/regionBlend.current\?\.clear\(\);regionPaintRef.current\(\);\},\[lutRevision\]/);
});
