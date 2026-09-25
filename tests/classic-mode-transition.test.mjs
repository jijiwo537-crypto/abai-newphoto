import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');

test('tab changes stop inertia and discard the pending pan before React changes layout', () => {
  const start=source.indexOf('  const stopPreviewForModeChange = () => {');
  const end=source.indexOf('\n  };',start)+5;
  const fn=source.slice(start,end).replace('const stopPreviewForModeChange', 'const stop');
  const run = new Function('stopInertia','panRef','containerRef','pagesColRef','pendingModeAnchorRef','kRef', `${fn};stop();`);
  let cancelled=0;
  const pan={current:{v:3}},anchor={current:null};
  const el={clientWidth:390,scrollLeft:127.25,offsetWidth:390,style:{overflowX:'auto'},getBoundingClientRect:()=>({left:10})};
  run(()=>cancelled++,pan,{current:el},{current:{getBoundingClientRect:()=>({left:-80.5})}},anchor,{current:.4});
  assert.equal(cancelled,1);
  assert.equal(pan.current,null);
  assert.equal(el.scrollLeft,127.25);
  assert.equal(anchor.current,(10+195+80.5)/.4);
  assert.match(source,/if \(id !== activeTab\) stopPreviewForModeChange\(\);\s+setActiveTab/);
});

test('seams already visible in normal mode do not restart their fade on entering sort', () => {
  assert.match(source,/sortSeamVisibleSince.current.set\(slot, performance.now\(\) - 160\)/);
  assert.ok(!source.includes('sortSeamVisibleSince.current.clear()'));
  // Dragged / displaced boundaries still start a fresh fade after settling.
  assert.match(source,/if \(!visible.has\(slot\)\) since.delete\(slot\)/);
});

test('exactly aligned photos avoid double clipping and retain their original geometry', () => {
  assert.match(source,/if \(!containedPhoto\) \{\s+ctx.beginPath/);
  assert.match(source,/ctx.drawImage\(source, -image.width \/ 2, -image.height \/ 2, image.width, image.height\)/);
  assert.match(source,/source, sw - 1, 0, 1, sh, l \+ w - pad, t, pad \* 2, h/);
  assert.match(source,/source, 0, sh - 1, sw, 1, l, t \+ h - pad, w, pad \* 2/);
  assert.match(source,/if \(!image.imgRadius && image.rotation % 360 === 0 && !motionFrame\)/);
});
