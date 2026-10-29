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

test('color match progress is a top capsule like the beauty 刪除中 one', () => {
  // 分析中：跟人像「刪除中」同一款膠囊、同一個位置（照片上緣往下 16px），不再擋在照片正中間
  const status = match.match(/<div role="status" aria-label="分析色彩中"[\s\S]*?<\/div>/)?.[0];
  assert.ok(status);
  assert.match(status, /rounded-full bg-black\/60 backdrop-blur-sm text-\[12px\]/);
  assert.match(status, /top: Math\.round\(imgTop \+ 16\)/);
  assert.match(status, /animate-spin/);
  assert.doesNotMatch(status, /inset-0/);
});
