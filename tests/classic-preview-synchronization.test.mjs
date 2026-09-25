import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const grid = readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');
const creative = readFileSync(new URL('../components/CollageTool.tsx', import.meta.url), 'utf8');

test('shape glow maps display 0..100 to strength 0..50 in both editors', () => {
  assert.match(grid, /shapeGlow: v \/ 2/);
  assert.match(creative, /glow: v \/ 2, glowColor/);
  assert.match(creative, /: \{ glow: v \/ 2 \}/);
});

test('empty cell chrome updates in the same geometry frame, not a following frame', () => {
  assert.match(grid, /addEventListener\('abai-preview-transform', place\)/);
  assert.match(grid, /removeEventListener\('abai-preview-transform', place\)/);
  const start = grid.indexOf('const LayoutEmptyPromptLayer');
  const prompt = grid.slice(start, grid.indexOf('export const ColorPick:', start));
  assert.doesNotMatch(prompt, /\.offsetWidth|\.offsetHeight/);
  assert.match(prompt, /label\.style\.fontSize = '9px'/);
  assert.match(prompt, /translate\(-50%, -50%\) scale\(\$\{ui\}\)/);
});

test('plain layout cells use shared SVG geometry while filters and seamless rendering remain separate', () => {
  assert.match(grid, /const nativeLayout = !insetLayout && !layout\.seamless\s*&& layout\.images\.every\(c => !hasPhotoFx\(c\.fx\)\)/);
  assert.match(grid, /data-layout-photo-layer="1" width=\{lw\} height=\{lh\}/);
  assert.match(grid, /clipPath id=\{clip\} clipPathUnits="userSpaceOnUse"/);
  assert.match(grid, /display:nativeInset \|\| nativeLayout \? 'none' : 'contents'/);
});

test('selection bounds use scene stroke scale rather than legacy DOM compensation', () => {
  assert.match(grid, /shapeStroke\.lw \* renderScale \* sc/);
  assert.match(grid, /shapeStroke\.outer \* renderScale \* sc/);
});

test('source edge coverage is clipped at the actual canvas boundary', () => {
  assert.match(grid, /clip: photoClip \|\| \(!sortPage && stripWidth > 0 && canvasHeight\s*\? \{ x: 0, y: 0, width: stripWidth, height: canvasHeight \}/);
});
