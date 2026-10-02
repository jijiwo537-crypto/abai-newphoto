import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const creative = readFileSync(new URL('../components/CollageTool.tsx', import.meta.url), 'utf8');
const classic = readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');
const miter = new Function('w', 'h', 'base = 4', `return ${classic.match(/export const shapeMiterLimit[^=]*= \(w:[\s\S]*?=>\s*([^;]+);/)[1]}`);
const fit = new Function('stageW', 'stageH', 'w', 'h', `return ${creative.match(/export const creativePreviewFit[\s\S]*?=>\s*([^;]+);/)[1]}`);
test('all preview ratios retain the original contain-fit size, including short square viewports', () => {
  for (const height of [240, 330, 380, 496, 650])
    for (const [w, h] of [[600, 600], [600, 800], [800, 600]])
      assert.equal(fit(393, height, w, h), Math.min(361 / w, (height - 32) / h));
  assert.equal(600 * fit(393, 330, 600, 600), 298);
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
test('pattern pages restore the original left icon rail and independent content scroll', () => {
  const block = creative.slice(creative.indexOf("{activeTab === 'shape' && <div"));
  assert.match(block, /title="圖案" aria-label="圖案"/);
  assert.match(block, /title="參數" aria-label="參數"/);
  assert.match(block, /w-11 -mt-5 -mb-5 -ml-5 border-r/);
  assert.match(block, /no-scrollbar pl-3 pr-2 h-full/);
  assert.ok(!block.includes('aria-label="圖案工具"'));
});
test('replace photo precedes custom mask without swapping their input handlers', () => {
  const block = creative.slice(creative.indexOf('grid grid-cols-2 gap-3 !mt-3'));
  assert.ok(block.indexOf('更換圖片') < block.indexOf('自訂遮罩'));
  assert.ok(block.indexOf('replaceFileInputRef.current?.click()') < block.indexOf('maskFileInputRef.current?.click()'));
});
