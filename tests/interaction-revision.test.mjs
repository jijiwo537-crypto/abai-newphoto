import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const load = async name => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source(name), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64'));

test('home keeps native momentum and blocks only outward edge pulls', async () => {
  const { installHomeScroll } = await load('utils/homeScroll.ts');
  const listeners = new Map();
  const el = { scrollTop: 400, scrollHeight: 2000, clientHeight: 800,
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const gesture = installHomeScroll(el);
  let prevented = 0;
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], cancelable: true, preventDefault: () => prevented++ });
  listeners.get('touchstart')(touch(30, 50));
  listeners.get('touchmove')(touch(31, 200));
  assert.equal(el.scrollTop, 400);
  assert.equal(prevented, 0);
  el.scrollTop = 0;
  listeners.get('touchmove')(touch(31, 300));
  assert.equal(prevented, 1);
  listeners.get('touchstart')(touch(300, 100));
  listeners.get('touchmove')(touch(20, 102));
  assert.equal(prevented, 1);
  el.scrollTop = 1200;
  listeners.get('touchstart')(touch(30, 300));
  listeners.get('touchmove')(touch(30, 100));
  assert.equal(prevented, 2);
  assert.equal(listeners.has('touchend'), false);
  gesture.destroy();
});
test('classic and creative use identical object idle defaults', async () => {
  const { idleDefaults } = await load('utils/animationDefaults.ts');
  for (const file of ['components/GridLayoutTool.tsx', 'components/CollageTool.tsx']) assert.match(source(file), /idleDefaults\(/);
  assert.deepEqual(idleDefaults('symbol-breathe2', { symbol: true }), { amp: 60, speed: 1.2 });
  assert.equal(idleDefaults('grid-wave', { shape: true, grid: true }).speed, 1.8);
});

test('drag-to-pinch preserves the committed position; thumbnails are keyed to their photo', () => {
  const creative = source('components/CollageTool.tsx');
  const branch = creative.slice(creative.indexOf('} else if (activePointers.current.size === 2 && selectedTarget)'), creative.indexOf('} else if (activePointers.current.size === 2 && (baseSelectedRef.current'));
  assert.match(branch, /flushMoveNow\(\)/);
  assert.doesNotMatch(branch, /initX|initY|setHoles/);
  assert.match(source('components/GridLayoutTool.tsx'), /paintedKey === cacheKey \? 'visible' : 'hidden'/);
});

test('curves float without a panel or grid backdrop and retain their established geometry', () => {
  const editor = source('components/ImageEditor.tsx');
  const curves = editor.slice(editor.indexOf('<motion.div key="curves"'), editor.indexOf('id="curvesSvg"'));
  assert.match(curves, /height: '250px', bottom: 12, background: 'transparent'/);
  assert.match(curves, /w-\[240px\] h-\[240px\] bg-transparent/);
  assert.doesNotMatch(curves, /backdropFilter|shadow-2xl|bg-\[#0c0c0c\]/);
  assert.match(editor, /transparent 5rem, #111111 5rem/);
});

test('touch devices retain parallax while overscroll remains contained', () => {
  const home = source('components/HomePage.tsx');
  assert.match(home, /libLiftRef\.current = reduceMotion\.current \? 0/);
  const css = source('styles.css');
  assert.match(css, /@media\s*\(pointer:\s*coarse\)/);
  assert.doesNotMatch(home, /matchMedia\('\(pointer: coarse\)'\)/);
  const touchRules = css.slice(css.indexOf('@media (pointer: coarse)'), css.indexOf('/* 首頁使用透明狀態列'));
  assert.doesNotMatch(touchRules, /animation:\s*none|--lib-lift:\s*0/);
  assert.match(touchRules, /overscroll-behavior-y:\s*none/);
  assert.match(home, /const h = rangeWritten\.current > 0 \? rangeWritten\.current/);
});

test('parallax has one property owner from first layout and neutral black panels', () => {
 const home=source('components/HomePage.tsx');
 assert.match(home,/const cssTimeline = useRef\(typeof CSS/);
 assert.match(home,/const y = rawY \* edge \* edge \* \(3 - 2 \* edge\)/);
 for(const file of ['components/HomePage.tsx','components/ImageEditor.tsx']){
  assert.match(source(file),/PREMIUM_GLASS/);
  assert.doesNotMatch(source(file),/rgba\(30,32,37,.84\)/);
 }
 const h=800;const f=y=>{const q=Math.min(1,Math.max(0,y)/(h*.12));return Math.max(0,y)*q*q*(3-2*q)};
 assert.equal(f(0),0);assert.ok(f(.1)<.00001);assert.equal(f(96),96);
 let last=0;for(let y=0;y<=800;y+=.1){const v=f(y);assert.ok(v>=last);last=v;}
});
