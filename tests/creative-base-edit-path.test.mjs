import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const collage=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
const fx=readFileSync(new URL('../utils/photoFx.ts',import.meta.url),'utf8');
test('new creative texture defaults use the displayed 10/20 mapping',()=>{
 assert.match(collage,/useState\(maskTextureSizeFromUi\(10\)\)/);
 assert.match(collage,/useState\(maskTextureGapFromUi\(20\)\)/);
 assert.match(collage,/if \(st.dotSize !== undefined\) setDotSize\(st.dotSize\)/);
 assert.match(collage,/if \(st.dotGap !== undefined\) setDotGap\(st.dotGap\)/);
});
test('base FX paints live, commits on release, and retains its full-resolution path',()=>{
 assert.match(collage,/fxCanvasOf\(\{\.\.\.p,id:`region-fx-\$\{i\}@\$\{p.src\}`,img:original\}, isMain/);
 assert.match(collage,/if \(isMain && regionPhoto\) \{[\s\S]{0,80}cap=photoPreviewCapacity\(onScreenPx/);
 assert.match(collage,/const live = isMain && !regionPhoto/);
 assert.match(collage,/isolateFxUpdates=\{regionEditing\}/);
 assert.match(collage,/onAdjustmentCommit=\{regionEditing \? finishRegionEdit : undefined\}/);
 assert.match(panel,/if\(!sliderInput.current\)setLocalFx\(next\)/);
 assert.match(panel,/onPointerUpCapture=\{isolateFxUpdates \? finishAdjustment/);
 assert.match(panel,/isolateFxUpdates \? \{defaultValue:value\} : \{value\}/);
 assert.match(collage,/!regionSliderHeld.current && nowT > regionLiveUntil.current && nowT - thumbAtRef.current > 400/);
 assert.match(collage,/if\(live\)regionLiveUntil.current=performance.now\(\)\+350/);
});
test('base-photo colour math keeps the existing full-quality shared renderer',()=>{
 assert.doesNotMatch(collage,/preferSeparableCpu: o.id\?\.startsWith\('region-fx-'\)/);
 assert.match(collage,/regionFxSurfaces.current.get\(o.id\)/);
 assert.match(fx,/willReadFrequently: !opts\?\.gpuSurface/);
 assert.match(collage,/gpuSurface: regionPhoto/);
 assert.match(fx,/processPixels\(/);
});
