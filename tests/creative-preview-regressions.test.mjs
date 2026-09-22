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
  assert.ok(creative.includes('motionLockRef.current = entering;'));
  assert.ok(creative.includes('if (motionLockRef.current) { viewPinchRef.current = null; return; }'));
  assert.ok(creative.includes('if (motionLockRef.current) return;'));
});
test('animation captures the actual starting rectangle and uses one transform animation',()=>{
  assert.ok(creative.includes('motionStartRectRef.current = motionFrameRef.current?.getBoundingClientRect()'));
  assert.ok(creative.includes('motionFrameAnimationRef.current = frame.animate(['));
  assert.ok(creative.includes('first.width/last.width'));
  assert.ok(creative.includes("{transform:'translate(0px,0px) scale(1,1)'}"));
});
test('playback block retains a full visible fade before unmounting',()=>{
  assert.ok(creative.includes("transform: barIn ? 'translateY(0)' : 'translateY(12px)'"));
  assert.ok(creative.includes('opacity 420ms linear'));
  assert.ok(creative.includes('setBarMounted(false), 460'));
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
test('preview gestures do not request a full content repaint on every move',()=>{
  assert.ok(!creative.includes('visiblePaint'));
  assert.ok(!creative.includes('maxPreviewScale, viewT.k, viewT.tx, viewT.ty]'));
  assert.ok(creative.includes('cached.scale === s'));
});
test('entry transition keeps its bitmap until geometry has settled',()=>{
  assert.ok(creative.includes('motionTransitionUntilRef.current = performance.now() + 420;'));
  assert.ok(creative.includes('Math.max(90, motionTransitionUntilRef.current - performance.now() + 32)'));
  assert.ok(creative.includes('if (now < motionTransitionUntilRef.current) return;'));
  assert.ok(creative.includes('if (performance.now() < motionTransitionUntilRef.current) return;'));
});
