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
test('batch import caps decoding at cell count and commits to original layout id', () => {
  const body=source.slice(source.indexOf('const handleReplaceFileChange'),source.indexOf('const handleRemoveImage'));
  assert.match(body,/slice\(0, targetLayout.images.length\)/);
  assert.match(body,/files.length > 1\s*\? targetLayout.images.map/);
  assert.match(body,/layout.id !== targetLayout.id/);
  assert.match(body,/loadedFiles.forEach/);
});
