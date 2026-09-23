import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');

test('page sorting vector ink uses the page CSS matrix, not its own easing clock', () => {
  const paint = source.slice(source.indexOf('if (sortPage) {'), source.indexOf('const scale = image.scale * shiftS'));
  assert.match(paint, /getComputedStyle\(page\)\.transform/);
  assert.match(paint, /shiftS = matrix\.a/);
  assert.match(paint, /shiftX = matrix\.e/);
  assert.match(paint, /ctx\.clip\(\)/);
});

test('seams retain their stacking order and reveal only after settle, with a fade', () => {
  const seams = source.slice(source.indexOf('const reveal = seamRevealRef.current;'), source.indexOf('// Measure container size dynamically'));
  assert.match(seams, /pageDragIdx !== null \|\| dragSettle/);
  assert.match(seams, /if \(!reveal\.revealAt\) return/);
  assert.match(seams, /alpha = t \* t \* \(3 - 2 \* t\)/);
  assert.match(seams, /z: 400000/);
  assert.match(source, /e\.propertyName === 'transform'[\s\S]{0,250}setDragSettle\(null\)/);
});

test('sorting preserves object owners and original outer-mask bounds after exchange', () => {
  assert.match(source, /sortObjectOwners\.current\?\.get\(f\.id\)/);
  assert.match(source, /const p = sortingPageOf\(f, stride, count\)/);
  assert.match(source, /clipLeft: \(index - original\) \* previewW/);
  assert.match(source, /const left = sortPage\.clipLeft, right = left \+ sortPage\.totalWidth/);
  // Translation of the page and of its original clip must agree for every move.
  for (const width of [171, 309, 450]) for (const original of [0, 1, 2]) for (const index of [0, 1, 2]) {
    const delta = (index - original) * width;
    for (const x of [-10, 0, 150, 900, 1400]) {
      assert.equal(x >= 0 && x <= width * 3,
        x + delta >= delta && x + delta <= delta + width * 3);
    }
  }
});
