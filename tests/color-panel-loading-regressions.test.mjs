import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const grid = fs.readFileSync('components/GridLayoutTool.tsx', 'utf8');
const match = fs.readFileSync('components/ColorMatchStudio.tsx', 'utf8');

test('background color controller keeps the shared preview height', () => {
  assert.match(grid, /data-classic-controller\s+style=\{\{ height: 'max\(36dvh, 310px\)'/);
  assert.doesNotMatch(grid, /activeTab === 'color' \? 'max\(45dvh/);
});

test('only active background texture allows color panel scrolling', () => {
  assert.match(grid, /data-texture-active=\{patternType !== 'none'\}/);
  assert.match(grid, /patternType !== 'none' \? 'overflow-y-auto overflow-x-hidden overscroll-contain' : 'overflow-hidden'/);
  assert.match(grid, /flex-1 min-h-0 no-scrollbar/);
});

test('color match progress is centered without an opaque backing', () => {
  const status = match.match(/\{\(busy \|\| referenceLoading\) && \(([\s\S]*?)\n        \)\}/)?.[1];
  assert.ok(status);
  assert.match(status, /absolute inset-0 flex items-center justify-center/);
  assert.doesNotMatch(status, /bg-|top-3|right-3/);
});
