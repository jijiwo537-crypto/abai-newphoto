import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const scope = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/effectDisplayOrder.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, scope);
const { orderEffectCards } = scope.exports;

test('new effects follow requested anchors without changing source or other card order', () => {
  const ids = ['softLight','halation','blur','fxLowfi','fxExposureSpill','fxMotion','fxZoom','fxSpin','fxMist'];
  const cards = ids.map(id => ({ id }));
  const ordered = orderEffectCards(cards, item => item.id);
  assert.deepEqual(Array.from(ordered, item => item.id),
    ['softLight','fxExposureSpill','halation','blur','fxMotion','fxZoom','fxSpin','fxLowfi','fxMist']);
  assert.deepEqual(cards.map(item => item.id), ids);
  assert.deepEqual(Array.from(orderEffectCards(ordered, item => item.id)), Array.from(ordered));
  const tuples = cards.map(({id}) => [id,id,'icon']);
  assert.deepEqual(Array.from(orderEffectCards(tuples, item => item[0]), item => item[0]), Array.from(ordered,item=>item.id));
});

test('saved IDs and chosen lowfi defaults are retained with the new names', () => {
  const source = fs.readFileSync('utils/glEffects.ts','utf8');
  assert.match(source, /id:'fxLowfi',label:'低保真',icon:'grain',onAmount:50/);
  assert.match(source, /id:'fxExposureSpill',label:'柔光ll'/);
  for (const [id,value] of [['Grain',70],['Aberration',100],['Contrast',55]]) {
    assert.match(source,new RegExp(`id:'fxLowfi${id}'[^\\n]+def:${value}`));
  }
  for (const file of ['components/ImageEditor.tsx','components/GridLayoutTool.tsx']) {
    assert.match(fs.readFileSync(file,'utf8'), /orderEffectCards</);
  }
});
