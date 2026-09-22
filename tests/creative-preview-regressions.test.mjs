import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const creative=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
const classic=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
test('grid stroke controls are excluded in both editors',()=>{
  assert.ok(creative.includes('!isDoubleContour && !isGrid &&'));
  assert.ok(classic.includes('!isDoubleContour && !isGridShape &&'));
});
test('animation tab locks preview gestures, not object gestures',()=>{
  assert.ok(creative.includes("motionLockRef.current = activeTab === 'motion'"));
  assert.ok(creative.includes('if (motionLockRef.current) { viewPinchRef.current = null; return; }'));
  assert.ok(creative.includes('if (motionLockRef.current) return;'));
});
test('animation translation and size transitions share duration and easing',()=>{
  assert.ok(creative.includes('motionUiOn ? `transform 420ms ${MOTION_EASE}`'));
  assert.ok(creative.includes('motionUiOn ? `width 420ms ${MOTION_EASE}, height 420ms ${MOTION_EASE}`'));
});
test('adding a selected shape does not reset palette scrolling',()=>{
  assert.ok(creative.includes('}, [activeTab, shapeSub, colorPickerTarget]);'));
});
test('pattern count is capped for controls and generation',()=>{
  assert.ok(creative.includes('value={holeCount} min={0} max={30}'));
  assert.ok(creative.includes('Math.min(30, Math.max(0, countOverride ?? holeCount))'));
});
test('preview content does not use a full-surface CSS blur filter',()=>{
  assert.ok(!creative.includes('drop-shadow-[0_20px_50px'));
  assert.ok(creative.includes("boxShadow: '0 20px 50px rgba(255,255,255,0.05)'"));
});
test('motion uses one size endpoint without a nested scale transition',()=>{
  assert.ok(creative.includes('const displayScale = motionUiOn ? mScale : viewT.k;'));
  assert.ok(creative.includes('const Hc = baseCss.h;'));
  assert.ok(!creative.includes('scale(${mScale})'));
  assert.ok(creative.includes("width: '100%', height: '100%'"));
});
test('zoomed painting clips work, not resolution, and invalidates partial thumbnails',()=>{
  assert.ok(creative.includes('targetCanvas === canvasRef.current && !motionLockRef.current && viewTRef.current.k > 1.25'));
  assert.ok(creative.includes('JSON.stringify([maskKey, visiblePaint,'));
  assert.ok(creative.includes('if (isMain && visiblePaint) thumbRef.current = null;'));
  assert.ok(creative.includes('if (isMain && !visiblePaint)'));
  assert.ok(creative.includes('maxPreviewScale, viewT.k, viewT.tx, viewT.ty]'));
});
test('entry transition keeps its bitmap until geometry has settled',()=>{
  assert.ok(creative.includes('motionTransitionUntilRef.current = performance.now() + 420;'));
  assert.ok(creative.includes('Math.max(90, motionTransitionUntilRef.current - performance.now() + 32)'));
  assert.ok(creative.includes('if (now < motionTransitionUntilRef.current) return;'));
  assert.ok(creative.includes('if (performance.now() < motionTransitionUntilRef.current) return;'));
});
