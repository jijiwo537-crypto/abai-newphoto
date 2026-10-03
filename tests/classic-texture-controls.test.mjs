import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const range = fs.readFileSync('utils/classicTextureSize.ts','utf8');
const grid = fs.readFileSync('components/GridLayoutTool.tsx','utf8');
const from = new Function('value', 'return ' + range.match(/classicTextureSizeFromUi = \(value: number\) => ([^;]+)/)[1]);
const to = new Function('value', 'return ' + range.match(/classicTextureSizeToUi = \(value: number\) => ([^;]+)/)[1]);
test('classic background texture UI 0–100 maps to original 15–130 units',()=>{
 assert.equal(from(0),15); assert.ok(Math.abs(from(100)-130)<1e-9);
 for(let i=0;i<=100;i++)assert.equal(to(from(i)),i);
 assert.equal(from(-20),15);assert.equal(to(200),100);
 assert.match(grid,/size: classicTextureSizeFromUi\(v\)/);
});
test('texture page gains 36px scroll room without changing the preview',()=>{
 assert.match(grid,/data-classic-texture-bottom-space className=\{patternType !== 'none' \? 'h-\[44px\]' : 'h-2'\}/);
 assert.match(grid,/height: 'max\(36dvh, 310px\)'/);
});
test('add-symbol buttons use the creative third-row second vortex icon',()=>{
 for(const file of ['GridLayoutTool','CollageTool'])assert.match(fs.readFileSync(`components/${file}.tsx`,'utf8'),/data-add-symbol-icon="vortex"><VortexIcon size=\{18\}/);
});
