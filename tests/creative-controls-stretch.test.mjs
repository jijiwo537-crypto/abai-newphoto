import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const creative = readFileSync(new URL('../components/CollageTool.tsx', import.meta.url), 'utf8');
const classic = readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');
const miter = new Function('w', 'h', 'base = 4', `return ${classic.match(/export const shapeMiterLimit[^=]*= \(w:[\s\S]*?=>\s*([^;]+);/)[1]}`);
const fit = new Function('stageW', 'stageH', 'w', 'h', `return ${creative.match(/export const creativePreviewFit[\s\S]*?=>\s*([^;]+);/)[1]}`);
test('square reset retains at least 8px hit-target clearance in short and tall viewports', () => {
  for (const height of [240, 330, 380, 496, 650]) {
    const size = 600 * fit(393, height, 600, 600);
    assert.ok((height - size) / 2 - 48 >= 8 - 1e-8);
  }
  assert.equal(600 * fit(393, 496, 600, 600), 361);
  assert.equal(fit(393, 496, 600, 800), Math.min(361 / 600, 464 / 800));
});
test('deforming a path does not switch its acute corners to a bevel', () => {
  assert.equal(miter(160, 160), 4);
  for (const [w, h] of [[24, 800], [800, 24], [40, 600], [600, 40]]) {
    // Top join of the triangle path is 1/sin(atan((w/2)/h)).
    const triangleJoin = Math.hypot(w / 2, h) / (w / 2);
    assert.ok(miter(w, h) > triangleJoin);
    assert.equal(miter(w, h), miter(h, w));
  }
  assert.ok(creative.includes('ctx.miterLimit = shapeMiterLimit(bw, bh)'));
  assert.ok(classic.includes('ctx.miterLimit = shapeMiterLimit(drawW, drawH)'));
  assert.ok(classic.includes('ctx.miterLimit = shapeMiterLimit(fw, fh)'));
  assert.ok(classic.includes('target.miterLimit = shapeMiterLimit(w, h, 12)'));
});
test('pattern pages use fixed top text tabs and reclaim the left rail width', () => {
  const block = creative.slice(creative.indexOf("{activeTab === 'shape' && <div"));
  assert.match(block, /role="tablist" aria-label="圖案工具"/);
  assert.match(block, /\['shape', '圖案'\], \['style', '編輯'\]/);
  assert.ok(!block.includes('border-r'));
  assert.ok(!block.includes('no-scrollbar pl-3 pr-2 h-full'));
  assert.match(block, /flex-1 min-h-0 min-w-0 no-scrollbar/);
});
test('replace photo precedes custom mask without swapping their input handlers', () => {
  const block = creative.slice(creative.indexOf('grid grid-cols-2 gap-3 !mt-3'));
  assert.ok(block.indexOf('更換圖片') < block.indexOf('自訂遮罩'));
  assert.ok(block.indexOf('replaceFileInputRef.current?.click()') < block.indexOf('maskFileInputRef.current?.click()'));
});
