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
test('animation captures the actual starting rectangle and glides with one transform toward the live end rectangle',()=>{
  assert.ok(creative.includes('motionStartRectRef.current = motionFrameRef.current?.getBoundingClientRect()'));
  // One transform on the frame, re-aimed every frame at the CURRENT layout box (the footer may still be resizing),
  // and re-aligned in the same frame when the layout box changes size.
  assert.ok(creative.includes('const w = first.width + (nw - first.width) * e, h = first.height + (nh - first.height) * e;'));
  assert.ok(creative.includes('frame.style.transform = `translate(${dx}px,${dy}px) scale(${w / nw},${h / nh})`;'));
  assert.ok(creative.includes('observer = new ResizeObserver(() => { apply(); });'));
  // Leaving the layout catalog through a tab: the footer height snaps, so the end rectangle is fixed.
  assert.ok(creative.includes('footerSnapRef.current ?'));
});
test('playback block restores sliding entry with equal shorter entry/exit timing',()=>{
  assert.ok(creative.includes("transform: barIn ? 'translateY(0)' : 'translateY(130px)'"));
  assert.ok(creative.includes('transform 240ms ${MOTION_EASE}, opacity 240ms ${MOTION_EASE}'));
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
  assert.ok(creative.includes("boxShadow: 'none'"));
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
