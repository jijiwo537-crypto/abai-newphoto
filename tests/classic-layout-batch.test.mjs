import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../components/GridLayoutTool.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('GridLayoutTool.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ast.statements.filter(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => ['resolveLayoutRect', 'TEMPLATE_MAP'].includes(d.name.getText(ast))));
const js = ts.transpileModule(declarations.map(d => d.getText(ast)).join('\n') + '\nexport {resolveLayoutRect,TEMPLATE_MAP};', {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {resolveLayoutRect,TEMPLATE_MAP} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('new four-photo layout preserves previous indexes and has square foreground cells', () => {
  assert.equal(TEMPLATE_MAP[4][0].name, '四格棋盤');
  const rects = TEMPLATE_MAP[4].at(-1).rects;
  assert.equal(rects.length,4);
  for (const [w,h] of [[400,400],[300,400],[400,300],[225,400]]) {
    for(const [i,r] of rects.entries()) {
      const box=resolveLayoutRect(r,w,h);
      if(i<2) assert.deepEqual(box,r);
      else {
        assert.ok(Math.abs(box.w*w-box.h*h)<1e-8);
        assert.ok(Math.abs(box.x+box.w/2-.5)<1e-8);
        assert.ok(Math.abs(box.y+box.h/2-(i===2?.25:.75))<1e-8);
      }
    }
  }
});
test('layout panel fills available width, without the removed sidebar width cap', () => {
  const panel=source.slice(source.indexOf('data-layout-panel="1"'),source.indexOf('data-layout-panel="1"')+16000);
  assert.match(panel,/w-full min-w-0/);
  assert.doesNotMatch(panel,/max-w-xs/);
  assert.match(panel,/strokeWidth="2.5"/);
  assert.match(panel,/key=\{activeTab === 'layout' \? 'layout-create'/);
});
test('inset size uses stored 50..100, defaults to 80, and keeps a stable center', () => {
  const raw=TEMPLATE_MAP[4].at(-1).rects[2];
  for(const value of [0,50,100]) {
    const r=resolveLayoutRect(raw,300,400,value);
    assert.ok(Math.abs(r.x+r.w/2-.5)<1e-10);
    assert.ok(Math.abs(r.y+r.h/2-.25)<1e-10);
    assert.ok(Math.abs(r.w*300-r.h*400)<1e-10);
  }
  assert.ok(Math.abs(resolveLayoutRect(raw,300,400).w-.256*1.3)<1e-10);
  assert.deepEqual(resolveLayoutRect(raw,300,400,0),resolveLayoutRect(raw,300,400,50));
  assert.deepEqual(resolveLayoutRect(raw,300,400,200),resolveLayoutRect(raw,300,400,100));
  assert.match(source,/overlaySize: 50 \+ Number\(e.target.value\) \/ 2/);
  assert.match(source,/data-inset-photo-layer/);
  assert.match(source,/!insetLayout && <LayoutEmptyPromptLayer/);
  assert.match(source,/aria-label="大小" type="range" min="0" max="100"/);
});
test('inset photos share page units and layout chrome stays outside the image',()=>{
 assert.doesNotMatch(source,/data-inset-photo-layer="1"[^\n]*viewBox/);
 assert.match(source,/outline: `\$\{0.75 \* layoutUiInv\}px solid/);
});
test('layout corner resize preserves the opposite corner, including rotation',()=>{
 for(const a of [0,30,90,173])for(const sx of [-1,1])for(const sy of [-1,1])for(const ratio of [.2,.7,1,2,4]){
  const r=a*Math.PI/180,dx=sx*120,dy=sy*160;
  const ox=dx*Math.cos(r)-dy*Math.sin(r),oy=dx*Math.sin(r)+dy*Math.cos(r);
  const x=31,y=27,newX=x+ox*(ratio-1),newY=y+oy*(ratio-1);
  assert.ok(Math.abs((newX-ox*ratio)-(x-ox))<1e-9);
  assert.ok(Math.abs((newY-oy*ratio)-(y-oy))<1e-9);
 }
 assert.match(source,/patchLayoutT\(\{ scale, x: g.baseX \+ g.ox \* \(ratio - 1\), y: g.baseY \+ g.oy \* \(ratio - 1\)/);
});
test('batch import caps decoding at cell count and commits to original layout id', () => {
  const body=source.slice(source.indexOf('const handleReplaceFileChange'),source.indexOf('const handleRemoveImage'));
  assert.match(body,/slice\(0, targetLayout.images.length\)/);
  assert.match(body,/files.length > 1\s*\? targetLayout.images.map/);
  assert.match(body,/layout.id !== targetLayout.id/);
  assert.match(body,/loadedFiles.forEach/);
});
