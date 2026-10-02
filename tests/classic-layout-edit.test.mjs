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

test('layout edit is fixed and top-aligned while the creation picker remains scrollable',()=>{
  assert.match(source,/activeTab === 'layout' \? 'overflow-y-auto overflow-x-hidden no-scrollbar' : 'overflow-hidden'/);
  const edit=source.slice(source.indexOf('/* Adjustment sliders'),source.indexOf("{activeTab === 'ratio' &&"));
  assert.doesNotMatch(edit,/pb-24|pt-2\.5/);
  assert.match(edit,/w-full min-w-0 space-y-4/);
  const ratio=source.slice(source.indexOf('data-page-ratio-panel'),source.indexOf("{activeTab === 'color'"));
  assert.match(ratio,/space-y-1\.5/);assert.match(ratio,/p-1 py-3 rounded-xl border/);
  assert.match(ratio,/grid grid-cols-2 gap-1\.5/);assert.match(ratio,/py-2\.5 rounded-xl border/);
});

test('overall page changes freeze legacy layout aspect but preserve explicitly edited shapes',()=>{
  const body=source.match(/const changePageShape = \(ratio = selectedRatio, landscape = isLandscape\) => \{([\s\S]*?)\n  \};/)[1];
  let pages=[{id:'p',layouts:[{id:'old',t:{x:2,y:3,scale:.9}},{id:'edited',ratio:'2:3',landscape:true,t:{x:4,y:5,scale:1.1}}]}];
  const original=structuredClone(pages), changes=[];
  new Function('selectedRatio','isLandscape','setPages','setSelectedRatio','setIsLandscape','ratio','landscape',body)(
    '3:4',false,fn=>{pages=fn(pages);},v=>changes.push(v),v=>changes.push(v),'9:16',true);
  assert.equal(pages[0].layouts[0].ratio,'3:4');assert.equal(pages[0].layouts[0].landscape,false);
  assert.deepEqual(pages[0].layouts[0].t,original[0].layouts[0].t);
  assert.deepEqual(pages[0].layouts[1],original[0].layouts[1]);assert.deepEqual(changes,['9:16',true]);
  assert.match(source,/makeLayout\(templateIdx, count\), ratio: selectedRatio, landscape: isLandscape/);
});
