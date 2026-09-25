import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const grid = readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');
const creative = readFileSync(new URL('../components/CollageTool.tsx', import.meta.url), 'utf8');

test('classic media uses a shared affine preview transform, not per-child CSS zoom layout', () => {
  const block = grid.slice(grid.indexOf('// CSS zoom relayouts every descendant'), grid.indexOf('// CSS zoom relayouts every descendant') + 650);
  assert.match(block, /zoom = ''/);
  assert.match(block, /scale\(\$\{k\}\)/);
  assert.doesNotMatch(block, /zoom = String/);
});

test('video decoder box stays fixed while its wrapper performs object scaling', () => {
  assert.match(grid, /stableVectorTransform = !!image\.isVideo/);
  assert.match(grid, /<VideoLayer\s+image=\{image\}\s+boxW=\{image\.width\}\s+boxH=\{image\.height\}/);
  assert.match(grid, /\}, \[on, fxKey, lutRevision, dpr, videoRef\]\)/);
});

test('creative animation retains transient flashes but hides persistent selection chrome', () => {
  assert.match(creative, /activeTab !== 'motion' && selectedPattern/);
  assert.match(creative, /activeTab !== 'motion' && !composeState/);
  assert.match(creative, /activeTab !== 'motion' && imageState && selectedObj/);
  assert.match(creative, /isMain && !motionLockRef\.current && selectedObj/);
});

test('grid line width uses the same object-relative unit in both editors', () => {
  assert.match(grid, /1\.5 \* \(lineBase \/ 160\) \* Math\.max/);
  assert.match(creative, /const unit = \(\(o as any\)\.lineBase \|\| Math\.max\(o\.w, o\.h\)\) \* s \/ 160/);
  assert.match(creative, /1\.5 \* unit \* Math\.max/);
});
