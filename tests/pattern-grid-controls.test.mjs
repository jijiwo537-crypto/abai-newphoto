import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const grid = fs.readFileSync('components/GridLayoutTool.tsx','utf8');
const creative = fs.readFileSync('components/CollageTool.tsx','utf8');
const start = grid.indexOf('export const shapePathD =');
const scope = {exports:{},r3:n=>Math.round(n*1000)/1000};
vm.runInNewContext(compile(grid.slice(start,grid.indexOf('\n};',start)+3)),scope);
const path = scope.exports.shapePathD;
test('orbit grid keeps complete rings inside the stretched frame',()=>{
  const radii = d => [...d.matchAll(/A\s*([\d.]+)/g)].map(m=>Number(m[1]));
  const base=Math.max(...radii(path('grid-orbits',160,160,160,160)));
  for(const [w,h] of [[320,160],[160,320]]){
    const d=path('grid-orbits',w,h,160,160);
    assert.ok(Math.max(...radii(d))<=Math.min(w,h)/2);
    assert.doesNotMatch(d,/NaN|Infinity/);
  }
  assert.equal(path('grid-orbits',160,160,160,160,2.325,0),'');
  assert.ok(Math.max(...radii(path('grid-orbits',320,320,160,160)))>base);
  const full=new Set(radii(path('grid-orbits',160,160,160,160)));
  for(const p of [.01,.25,.51,.99]) for(const r of radii(path('grid-orbits',160,160,160,160,2.325,p))) assert.ok(full.has(r),'signal must reveal fixed rings, not scale them');
});
test('signal reveals circles progressively and joins its loop continuously',()=>{
  const context={exports:{}};
  vm.runInNewContext(compile(fs.readFileSync('utils/objectMotion.ts','utf8')),context);
  const frame=context.exports.objectMotionFrame;
  const cfg={in:'signal',idle:'signal',delay:0,dur:1,speed:1,amp:100};
  assert.equal(frame(cfg,0).ringReveal,0);
  assert.equal(frame(cfg,.5).ringReveal,.5);
  assert.ok(Math.abs(frame(cfg,.99999).ringReveal-frame(cfg,1).ringReveal)<.001);
  for(let t=0;t<8;t+=.02){const r=frame(cfg,t).ringReveal;assert.ok(r>=0&&r<=1);}
});
test('pattern panel scroll targets its own scroll container',()=>{
  assert.match(creative,/ref=\{patternPanelRef\}/);
  assert.match(creative,/const el = patternPanelRef.current/);
  assert.doesNotMatch(creative,/if \(patternType === 'none'\)[^]*?scrollTop = 0/);
});
test('grid texture controls are excluded in both editors',()=>{
  assert.match(grid,/!isLine && !isGridShape/);
  assert.match(creative,/!isLine && !GRID_SHAPE_KINDS.has\(sel.kind\)/);
});
