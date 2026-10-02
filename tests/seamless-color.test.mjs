import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../utils/colorSpace.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function configure(gl,p3=true){
  const document={createElement:()=>({getContext:()=>({getContextAttributes:()=>({colorSpace:p3?'display-p3':'srgb'})})})};
  return new Function('exports','document',`${code};return exports;`)({},document).configureWebglWide(gl);
}
test('P3 DOM textures and framebuffer use the same primaries',()=>{
  const gl={drawingBufferColorSpace:'srgb',unpackColorSpace:'srgb'};
  assert.deepEqual(configure(gl),{colorSpace:'display-p3',directUpload:true});
  assert.equal(gl.drawingBufferColorSpace,gl.unpackColorSpace);
});
test('WebKit without unpackColorSpace must use explicit original-resolution pixel conversion',()=>{
  const gl={drawingBufferColorSpace:'srgb'};
  assert.deepEqual(configure(gl),{colorSpace:'display-p3',directUpload:false});
  assert.equal('unpackColorSpace' in gl,false);
});
test('unsupported P3 contexts retain matching sRGB, not a fake expando',()=>{
  const gl={};assert.deepEqual(configure(gl),{colorSpace:'srgb',directUpload:false});
  assert.equal('drawingBufferColorSpace' in gl,false);
  const narrow={drawingBufferColorSpace:'srgb',unpackColorSpace:'srgb'};
  assert.deepEqual(configure(narrow,false),{colorSpace:'srgb',directUpload:false});
  assert.equal(narrow.drawingBufferColorSpace,'srgb');
});
test('ignored or throwing color-space setters cannot produce mismatched import/output',()=>{
  const ignored={get drawingBufferColorSpace(){return 'srgb'},set drawingBufferColorSpace(_) {}};
  assert.deepEqual(configure(ignored),{colorSpace:'srgb',directUpload:false});
  const partial={drawingBufferColorSpace:'srgb',get unpackColorSpace(){return 'srgb'},set unpackColorSpace(_){throw Error('Unsupported')}};
  assert.deepEqual(configure(partial),{colorSpace:'display-p3',directUpload:false});
});
