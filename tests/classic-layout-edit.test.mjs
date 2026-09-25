import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');

test('slow preview pinch retains sub-threshold motion without staircase jumps', () => {
  const body = source.match(/const z = (cz\.lastZoom[^;]+);/)[1];
  const next = new Function('cz', 'rawZ', `return ${body}`);
  let lastZoom = 1;
  for (let i = 1; i <= 1000; i++) {
    const value = next({ lastZoom }, 1 + i * .00015);
    assert.ok(value > lastZoom, 'every small movement advances the canvas');
    assert.ok(value - lastZoom <= .000151, 'no accumulated jump');
    lastZoom = value;
  }
});

test('layout creation and common editing are separate routes without sidebar tabs', () => {
  assert.ok(!source.includes('layoutSubTab'));
  assert.ok(source.includes("activeTab === 'adjust' && !layoutEditMode"));
  assert.ok(source.includes("activeTab === 'layout' || layoutEditMode"));
  const picker = source.slice(source.indexOf('allTemplatesFlattened.map'), source.indexOf('/* Adjustment sliders'));
  assert.ok(picker.includes('handleAddLayoutToPage(activePageIndex, idx, count)'));
  assert.ok(!picker.includes('setTemplateIndex('));
  assert.ok(source.includes("e.stopPropagation(); setActiveTab('adjust');"));
});

test('rounded layout photos have no dark backing and use the inner padded dimensions', () => {
  const cell = source.slice(source.indexOf('id={`cell-container-${idx}`}'), source.indexOf('/* Thin solid outline'));
  assert.ok(cell.includes("backgroundColor: 'transparent'"));
  assert.ok(cell.includes('Math.max(0, cellWidth - gap)'));
  assert.ok(cell.includes('Math.max(0, cellHeight - gap)'));
});
