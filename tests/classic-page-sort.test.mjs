import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');

test('page sorting vector ink uses the page CSS matrix, not its own easing clock', () => {
  const paint = source.slice(source.indexOf('if (sortPage) {'), source.indexOf('const scale = image.scale * shiftS'));
  assert.match(paint, /scene\.pageTransform\(sortPage\.index\)/);
  assert.doesNotMatch(paint, /getComputedStyle|querySelectorAll/);
  assert.match(paint, /shiftS = matrix\.a/);
  assert.match(paint, /shiftX = matrix\.e/);
  assert.match(paint, /ctx\.clip\(\)/);
});

test('seams retain their stacking order and reveal only after settle, with a fade', () => {
  const seams = source.slice(source.indexOf("vectorScene.set('__page-seams'"), source.indexOf('// Measure container size dynamically'));
  assert.match(seams, /settledSortSeams/);
  assert.match(seams, /globalAlpha = t \* t \* \(3 - 2 \* t\)/);
  assert.match(seams, /z: 400000/);
  assert.match(source, /flushSync\(\(\) => setDragSettle\(t < 1/);
  assert.match(source, /dx: dragSettle\.x, s: dragSettle.s, live: true/);
});

test('sorting clips survive exit until normal strip clipping resumes', () => {
  assert.match(source, /if \(!pagesMode && !pagesVisual\)/);
  assert.match(source, /sortPage=\{pagesMode \|\| \(pagesVisual && !!sortOriginalIndices\.current\)/);
  assert.match(source, /clipPath: pagesMode \|\| \(pagesVisual && !!sortOriginalIndices\.current\)/);
});

test('sorting preserves whole-object owners and clips to the destination canvas after exchange', () => {
  assert.match(source, /sortObjectOwners\.current\?\.get\(f\.id\)/);
  assert.match(source, /const p = sortingPageOf\(f, stride, count\)/);
  assert.match(source, /clipLeft: 0/);
  assert.match(source, /const left = sortPage\.clipLeft, right = left \+ sortPage\.totalWidth/);
  // Only the object moves. The destination canvas must not inherit the old
  // outer mask, otherwise a previously hidden left edge can never reappear.
  for (const width of [171, 309, 450]) for (const original of [0, 1, 2]) for (const index of [0, 1, 2]) {
    const delta = (index - original) * width;
    const destinationLeft = -index * width;
    assert.equal(destinationLeft + index * width, 0);
    assert.equal(destinationLeft + width * 3 + index * width, width * 3);
    assert.equal(delta, index * width - original * width);
  }
  assert.match(source, /const left = -pageIdx \* previewW/);
});

test('mode transitions anchor the actual visible pose and ignore their own scroll callbacks', () => {
  assert.match(source, /viewport.left \+ el.clientWidth \/ 2 - rendered.left/);
  assert.match(source, /canvasZoomRef.current \|\| kAnimRef.current/);
  assert.match(source, /overflowAnchor: 'none'/);
});

test('displaced pages and object wrappers consume one animation pose without CSS catch-up', () => {
  assert.match(source, /flushSync\(\(\) => setSortShiftFrame\(pose\)\)/);
  assert.match(source, /x: sortShiftFrame\[idx\] \?\? 0/);
  assert.match(source, /transition: sortPage \? 'none'/);
  assert.match(source, /transition: pagesMode \? 'none'/);
});

test('sorting seams use fixed slots, not moving page edges', () => {
  assert.match(source, /seam\(slot \* previewW - width \/ 2, 0, previewH\)/);
  assert.match(source, /ctx.fillRect\(x,y,width,h\)/);
  assert.match(source, /pageDragIdx \?\? dragSettle\?\.page \?\? null/);
});

test('sorting preserves normal minimum scale, logical size and idle clipping', () => {
  assert.match(source, /PAGES_MODE_SCALE = PREVIEW_MIN_SCALE/);
  assert.match(source, /ZOOM_MIN = PREVIEW_MIN_SCALE/);
  assert.match(source, /activeTab === 'pages' && normalPreviewSize.current/);
  assert.match(source, /pageDragIdx !== null \|\| dragSettle \? '' : 'shadow/);
});

test('aligned photos avoid a second antialiased clipping edge', () => {
  assert.match(source, /cy \+ halfY <= sortPage.height \+ .000001\) return undefined/);
});
