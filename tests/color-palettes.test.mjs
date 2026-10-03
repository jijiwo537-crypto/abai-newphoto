import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LEGACY_TEXT_COLORS,TEXT_COLORS,SHAPE_COLORS,DEFAULT_COLORS,MASK_DEEP_COLORS,CREATIVE_MASK_COLORS} from '../utils/colorPalettes.js';
import {ART_SWATCHES} from '../utils/artColors.js';
test('text preserves every original swatch in its original order',()=>{
 assert.deepEqual(TEXT_COLORS.slice(0,16),LEGACY_TEXT_COLORS);
 assert.deepEqual(LEGACY_TEXT_COLORS.slice(0,2),['#000000','#FFFFFF']);
 assert.equal(LEGACY_TEXT_COLORS[2],'#A8E6D3');
});
test('all non-text palettes begin with white and append the entire mask family',()=>{
 for(const colors of [SHAPE_COLORS,DEFAULT_COLORS,CREATIVE_MASK_COLORS]){
  assert.equal(colors[0],'#FFFFFF');assert.equal(new Set(colors).size,colors.length);
  for(const color of MASK_DEEP_COLORS)assert.ok(colors.includes(color));
 }
 assert.equal(MASK_DEEP_COLORS[0],'#E3BFB8');assert.equal(MASK_DEEP_COLORS.at(-1),'#E3B8C3');
 assert.deepEqual(CREATIVE_MASK_COLORS.slice(1,15),[...MASK_DEEP_COLORS].reverse());
 for(const color of LEGACY_TEXT_COLORS)assert.ok(CREATIVE_MASK_COLORS.includes(color));
});
test('art retains its original front group followed by old text colors',()=>{
 const colors=ART_SWATCHES.map(([hex])=>hex.toUpperCase());
 assert.deepEqual(colors.slice(0,8),['#FFFFFF','#FF7899','#FFD178','#F5EE9E','#A8FFDC','#9DE7FF','#A6BCFF','#D0ADFF']);
 assert.deepEqual(colors.slice(8),LEGACY_TEXT_COLORS.filter(c=>c!=='#FFFFFF'));
});
test('color subpages are fixed, omit hexadecimal fields and reset on edit',()=>{
 const grid=fs.readFileSync('components/GridLayoutTool.tsx','utf8');
 assert.match(grid,/data-fixed-color-page className="h-full overflow-hidden/);
 assert.doesNotMatch(grid.slice(grid.indexOf('const ColorPickerEmbedded:'),grid.indexOf('const ColorPickerEmbedded:')+6500),/aria-label="色號"/);
 assert.match(grid,/key=\{`shape-editor-\$\{layer.id\}-\$\{objectEditorRevision\}`\}/);
 assert.match(grid,/key=\{`text-editor-\$\{layer.id\}-\$\{objectEditorRevision\}`\}/);
 assert.match(fs.readFileSync('components/CollageTool.tsx','utf8'),/setColorPickerTarget\(null\); setActiveTab\('objedit'\)/);
});
test('lowfi halo matches existing mask kernel and strength does not regenerate it',()=>{
 const mask=fs.readFileSync('utils/lowfiHalo.ts','utf8'),gl=fs.readFileSync('utils/glEffects.ts','utf8');
 assert.match(mask,/blurAlpha\(a,blurred,scratch,mw,mh,Math.floor\(Math.max\(1,mw\*\.08\*\.8553125\*\.1\)\)\)/);
 assert.match(mask,/if\(!key\|\|key!==this.key\|\|this.mask.width!==mw\|\|this.mask.height!==mh\)/);
 assert.match(gl,/c.lowfiHalo\?\.dispose\(gl\)/);assert.match(gl,/vec3\(51\.,18\.,161\.\)\/255\./);
});
