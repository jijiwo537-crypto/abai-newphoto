import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const grid = fs.readFileSync('components/GridLayoutTool.tsx', 'utf8');
const match = fs.readFileSync('components/ColorMatchStudio.tsx', 'utf8');

test('background color controller keeps the shared preview height', () => {
  assert.match(grid, /data-classic-controller\s+style=\{\{ height: 'max\(calc\(36dvh - 6px\), 304px\)'/);
  assert.doesNotMatch(grid, /activeTab === 'color' \? 'max\(45dvh/);
});

test('only active background texture allows color panel scrolling', () => {
  assert.match(grid, /data-texture-active=\{patternType !== 'none'\}/);
  assert.match(grid, /patternType !== 'none' \? '[^']*overflow-y-auto overflow-x-hidden overscroll-contain' : '[^']*overflow-hidden'/);
  assert.match(grid, /flex-1 min-h-0 no-scrollbar/);
});

test('color match progress is centered over a translucent dim (never opaque, never in a corner)', () => {
  const status = match.match(/\{\(busy \|\| referenceLoading\) && \(([\s\S]*?)\n        \)\}/)?.[1];
  assert.ok(status);
  assert.match(status, /absolute inset-0 flex items-center justify-center/);
  // 加載時照片稍微變暗（半透明），看得出正在算；不能是整片不透明，也不能跑到角落
  assert.match(status, /bg-black\/55/);
  assert.doesNotMatch(status, /bg-(?!black\/55)|top-3|right-3/);
});
