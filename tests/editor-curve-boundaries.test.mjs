import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const load = code => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(code, {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const geometry = await load(read('utils/editorCurveGeometry.ts'));
const editor = read('components/ImageEditor.tsx');
const math = await load(editor.slice(editor.indexOf('function getSplineY('), editor.indexOf('// 60FPS Optimization: Pre-calculate')).replace('function getSplineY(', 'export function getSplineY('));

test('endpoints at top/bottom with inset x coordinates are still edited curves', () => {
  assert.equal(geometry.isIdentityCurve([{x:0,y:0},{x:255,y:255}]), true);
  for (const p of [[{x:50,y:0},{x:205,y:255}],[{x:0,y:0},{x:200,y:255}],[{x:50,y:0},{x:255,y:255}]]) {
    assert.equal(geometry.isIdentityCurve(p), false);
    const lut = math.generateCurveLut(p);
    assert.equal(lut[0], 0); assert.equal(lut[255],255);
    assert.ok(lut.some((v,i)=>v!==i));
  }
  assert.match(editor,/Object.values\(pRender.curves\).every\(isIdentityCurve\)/);
});

test('path extends horizontally to both edges and never leaves the 200x200 grid', () => {
  for (const p of [[{x:45,y:0},{x:220,y:255}],[{x:30,y:255},{x:210,y:0}],[{x:20,y:150},{x:100,y:255},{x:160,y:0},{x:230,y:90}]]) {
    const path=geometry.boundedCurvePath(p,math.getSplineY);
    const coords=Array.from(path.matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g),m=>[+m[1],+m[2]]);
    assert.equal(coords.length,401);assert.equal(coords[0][0],0);assert.equal(coords.at(-1)[0],200);
    assert.equal(coords[0][1],200-p[0].y/255*200);
    assert.equal(coords.at(-1)[1],200-p.at(-1).y/255*200);
    for(const [x,y] of coords) {assert.ok(x>=0&&x<=200);assert.ok(y>=0&&y<=200);}
  }
  assert.match(editor,/clipPath=\{`url\(#\$\{curveClipId\}\)`\}/);
});
