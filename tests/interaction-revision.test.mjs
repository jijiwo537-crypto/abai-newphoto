import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const load = async name => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source(name), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64'));

test('vertical touch and momentum never overshoot either boundary; horizontal gestures remain native', async () => {
  const { installHomeScroll } = await load('utils/homeScroll.ts');
  const callbacks = new Map(); let id = 0;
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = fn => { callbacks.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = key => callbacks.delete(key);
  const listeners = new Map();
  const el = { scrollTop: 400, scrollHeight: 2000, clientHeight: 800,
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const gesture = installHomeScroll(el);
  let prevented = 0;
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], cancelable: true, preventDefault: () => prevented++ });
  try {
    listeners.get('touchstart')(touch(30, 50));
    listeners.get('touchmove')(touch(31, 1000));
    assert.equal(el.scrollTop, 0);
    listeners.get('touchend')();
    for (const [key, fn] of [...callbacks]) { callbacks.delete(key); fn(performance.now() + 16); }
    assert.equal(el.scrollTop, 0);
    listeners.get('touchstart')(touch(30, 1000));
    listeners.get('touchmove')(touch(31, -1000));
    assert.equal(el.scrollTop, 1200);
    const before = prevented;
    listeners.get('touchstart')(touch(300, 100));
    listeners.get('touchmove')(touch(20, 102));
    assert.equal(prevented, before);
    assert.equal(el.scrollTop, 1200);
    gesture.stop(); assert.equal(callbacks.size, 0);
  } finally {
    gesture.destroy(); globalThis.requestAnimationFrame = oldRequest; globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('classic and creative use identical object idle defaults', async () => {
  const { idleDefaults } = await load('utils/animationDefaults.ts');
  for (const file of ['components/GridLayoutTool.tsx', 'components/CollageTool.tsx']) assert.match(source(file), /idleDefaults\(/);
  assert.deepEqual(idleDefaults('symbol-breathe2', { symbol: true }), { amp: 60, speed: 1.2 });
  assert.equal(idleDefaults('grid-wave', { shape: true, grid: true }).speed, 1.8);
});

test('drag-to-pinch preserves the committed position; thumbnails are keyed to their photo', () => {
  const creative = source('components/CollageTool.tsx');
  const branch = creative.slice(creative.indexOf('} else if (activePointers.current.size === 2 && selectedTarget)'), creative.indexOf('} else if (activePointers.current.size === 2 && baseSelectedRef.current)'));
  assert.match(branch, /flushMoveNow\(\)/);
  assert.doesNotMatch(branch, /initX|initY|setHoles/);
  assert.match(source('components/GridLayoutTool.tsx'), /paintedKey === cacheKey \? 'visible' : 'hidden'/);
});
