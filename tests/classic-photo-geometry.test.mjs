import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('export const cornerR ='), source.indexOf('/* ── 圖片的外形'));
const compiled = await transform(section, { loader: 'ts', format: 'esm' });
const { cornerR, roundRectPath } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);

test('round corners stay circular at every radius and join the straight edges tangentially', () => {
  for (const [w, h] of [[100, 400], [400, 100], [13.7, 21.9]]) {
    for (const pct of [.1, 1, 25, 50, 75, 100]) {
      const arcs = [];
      const g = { beginPath() {}, ellipse(...args) { arcs.push(args); }, lineTo() {}, closePath() {}, rect() {} };
      const r = cornerR(pct, w, h);
      roundRectPath(g, 0, 0, w, h, r, r);
      assert.equal(arcs.length, 4);
      for (const [cx, cy, rx, ry] of arcs) {
        assert.equal(rx, ry);
        assert.ok(cx - rx >= -1e-9 && cx + rx <= w + 1e-9);
        assert.ok(cy - ry >= -1e-9 && cy + ry <= h + 1e-9);
      }
      assert.equal(arcs[0][1] - arcs[0][3], 0);
      assert.equal(arcs[1][0] + arcs[1][2], w);
      assert.equal(arcs[2][1] + arcs[2][3], h);
      assert.equal(arcs[3][0] - arcs[3][2], 0);
    }
  }
});

test('oversized round rect normalizes both radii together, never stretches circular corners', () => {
  const arcs = [];
  roundRectPath({ beginPath() {}, ellipse(...a) { arcs.push(a); }, lineTo() {}, closePath() {}, rect() {} }, 0, 0, 100, 400, 200, 200);
  assert.deepEqual(arcs.map(a => a.slice(2, 4)), Array(4).fill([50, 50]));
});

test('all page boundaries participate in drag, pinch, corner and stretch snapping', () => {
  assert.ok(!source.includes('pageRectsNear(getAllPageRects(), cx).forEach'));
  assert.ok(!source.includes('pageRectsNear(getAllPageRects(), next.x'));
  assert.match(source, /const pageRects = getAllPageRects\(\);/);
  assert.match(source, /Math\.abs\(cand - ns\) \* extent \/ 2 \* previewK/);
  // A 3 px horizontal miss on a tall object must remain 3 px, not be
  // multiplied by its unrelated height and rejected from the 4 px snap range.
  const width = 200, height = 2000, zoom = 2, delta = .015;
  assert.equal(delta * width / 2 * zoom, 3);
  assert.equal(delta * Math.max(width, height) / 2 * zoom, 30);
});

test('decoded plain photos paint from original pixels in the same scene matrix', () => {
  assert.match(source, /const isSceneInk = isCanvasVector \|\| isScenePhoto/);
  assert.match(source, /ctx\.drawImage\(source, -image.width \/ 2, -image.height \/ 2, image.width, image.height\)/);
  assert.match(source, /data-classic-scene-hit=\{scene && isSceneInk/);
});

test('actual drag solver snaps cross-page objects to both outer edges at all preview scales', async () => {
  const body = source.slice(source.indexOf('  const applySnapping = ('), source.indexOf('  const [draggedFloatingIndex'));
  const code = await transform(`export function solver(k, item) {
    const enableSnapping=true,kRef={current:k},floatingImages=[item];
    const pages=Array.from({length:3},(_,pageIdx)=>({pageIdx,left:pageIdx*300,right:(pageIdx+1)*300,top:0,bottom:400,centerX:pageIdx*300+150,centerY:200}));
    const getAllPageRects=()=>pages;
    const pageRectsNear=(p,c)=>p.filter(r=>c>=r.left&&c<=r.right);
    const rotExtent=(w,h,r)=>({bw:Math.abs(w*Math.cos(r*Math.PI/180))+Math.abs(h*Math.sin(r*Math.PI/180)),bh:Math.abs(w*Math.sin(r*Math.PI/180))+Math.abs(h*Math.cos(r*Math.PI/180))});
    const SHAPE_FIT={square:[0,0,1,1]},GRID_SHAPE_KINDS=new Set();
    const seamXs=()=>[300,600],pageGuidelinesAt=()=>[],dedupeGuidelines=g=>g;
    ${body}
    return applySnapping;
  }`, { loader:'ts',format:'esm' });
  const { solver }=await import(`data:text/javascript;base64,${Buffer.from(code.code).toString('base64')}`);
  for(const k of [.4,1,2,4]) for(const kind of ['photo','text','symbol','shape']) {
    const f=solver(k,{id:'target',...(kind==='shape'?{shape:'square',shapeFilled:true}:{})});
    const miss=3/k;
    // 800px wide: its centre is in the middle page, not either outer page.
    const left=f('target',miss,-700,800,1800,1,true);
    assert.equal(left.snappedX,0,`${kind} left at ${k}`);
    assert.ok(left.guidelines.some(g=>g.type==='vertical'&&g.coord===0));
    const right=f('target',100-miss,-700,800,1800,1,true);
    assert.equal(right.snappedX,100,`${kind} right at ${k}`);
    assert.ok(right.guidelines.some(g=>g.type==='vertical'&&g.coord===900));
  }
});
