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

test('normal photos share the strip clip rather than multiplying fractional edge coverage', () => {
  assert.match(grid, /clip: photoClip,/);
  assert.doesNotMatch(grid, /clip: photoClip \|\| \(!sortPage/);
  assert.match(grid, /pageDragIdx !== null \|\| dragSettle \? '' : 'overflow-hidden'/);
});

test('scene style and opacity read the current slider draft at paint time', () => {
  assert.match(grid, /paint: \(ctx, density\) => \{[\s\S]*?const image = \{ \.\.\.committedImage, \.\.\.classicVectorDraft\(committedImage.id\) \}/);
  assert.match(grid, /return subscribeClassicVectorDraft\(committedImage.id, \(\) => scene.flush\(\)\)/);
  assert.match(grid, /if \(vectorTuningIdRef.current === id\) return;/);
});

test('shape slider owns its interaction lifecycle rather than unrelated panel cancellation', () => {
  const panel=grid.slice(grid.indexOf('export const ShapeEditorPanel'),grid.indexOf('export const ShapeEditorPanel')+18000);
  assert.match(panel,/onInteractionChange=\{setTuning\}/);
  assert.doesNotMatch(panel,/onPointer(?:Up|Cancel)Capture=\{\(\) => setTuning\(false\)\}/);
  const range=grid.slice(grid.indexOf('export const SmoothRange'),grid.indexOf('export const CrossStarIcon'));
  assert.match(range,/onValueRef.current\(next\);[\s\S]*?onInteractionRef.current\?\.\(false\)/);
});

test('sorting hides selection ink before the deferred selection reset', () => {
  assert.match(grid,/ref=\{setChromeLayerNode\}[\s\S]*?display: pagesMode \|\| pagesVisual \? 'none' : undefined/);
});

test('transition UI lifetime follows the actual pose, including equal-size mode changes', () => {
  assert.doesNotMatch(grid, /pagesVisualTimerRef/);
  const settled = grid.slice(grid.indexOf('if (Math.abs(kRef.current - pagesScale)'), grid.indexOf('kAnimRef.current = {', grid.indexOf('if (Math.abs(kRef.current - pagesScale)')));
  assert.match(settled, /kAnimRef.current = null/);
  assert.match(settled, /setPagesVisual\(pagesMode\)/);
  const pinch = grid.slice(grid.indexOf('canvasZoomRef.current = { startDist:'), grid.indexOf('canvasZoomRef.current = { startDist:') + 650);
  assert.match(pinch, /kAnimRef.current = null/);
  assert.match(pinch, /setPagesVisual\(false\)/);
});

test('alignment guides use a separate two-screen-pixel scene entry above seams', () => {
  const guide = grid.slice(grid.indexOf("vectorScene.set('__alignment-guides'"), grid.indexOf('// Measure container size dynamically', grid.indexOf("vectorScene.set('__alignment-guides'")));
  assert.match(guide, /z: 475000/);
  assert.match(guide, /const width = 2 \/ k/);
  assert.match(guide, /ctx.fillRect\(x, y, w, h\)/);
  assert.doesNotMatch(grid, /return activeGuidelines.map/);
});

test('oversized sorting objects are clipped once until the strip clip is suspended', () => {
  assert.match(grid, /if \(sortPage.clipContents && !containedPhoto\)/);
  assert.match(grid, /sortPage\?\.clipContents \? \{ clipPath:/);
  assert.match(grid, /clipLeft: 0, clipContents: pageDragIdx !== null \|\| !!dragSettle/);
  assert.match(grid, /a.sortPage\?\.clipContents === b.sortPage\?\.clipContents/);
});
