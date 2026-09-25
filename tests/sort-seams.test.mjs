import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import test from 'node:test';
import assert from 'node:assert/strict';
const { code } = await transform(readFileSync(new URL('../utils/sortSeams.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
const { settledSortSeams } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('seams only connect resting adjacent slots, never travel with pages', () => {
  const poses = [0, 1, 2, 3].map(index => ({ index, x: index * 300, scale: 1 }));
  assert.deepEqual(settledSortSeams(poses, 300, null), [1, 2, 3]);
  assert.deepEqual(settledSortSeams(poses, 300, 1), [3]);
  for (let x = 301; x < 600; x += 3) {
    assert.deepEqual(settledSortSeams([{...poses[0],x:70,scale:1.05},{...poses[1],x:x-300},poses[2],poses[3]],300,0),[3]);
  }
  assert.deepEqual(settledSortSeams([{...poses[0],x:900,scale:1.05},{...poses[1],x:0},{...poses[2],x:300},{...poses[3],x:600}],300,0),[1,2]);
});
