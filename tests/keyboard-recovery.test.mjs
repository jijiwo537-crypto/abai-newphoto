import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('keyboard pan is compensated and original tool geometry restored after dismissal', () => {
  const events = () => ({ handlers: new Map(), addEventListener(k, f) { this.handlers.set(k, f); }, removeEventListener(k) { this.handlers.delete(k); } });
  class Element {
    constructor(editable = false) {
      this.editable = editable;
      this.style = { translate: '', values: new Map(), getPropertyValue(k) { return this.values.get(k)?.[0] || ''; }, getPropertyPriority(k) { return this.values.get(k)?.[1] || ''; }, setProperty(k,v,p) { this.values.set(k,[v,p]); } };
    }
    matches() { return this.editable; }
    getBoundingClientRect() { return {height:852}; }
  }
  const root = new Element(), input = new Element(true);
  root.style.setProperty('height','100dvh','');
  const vv = {...events(), height:852, offsetTop:0};
  const win = {...events(), scrollX:0, scrollY:0, innerHeight:852, visualViewport:vv, setTimeout:()=>1, scrollTo({left,top}) {this.scrollX=left; this.scrollY=top;} };
  const doc = {...events(), activeElement:input, querySelectorAll:()=>[root]};
  let setup, cleanup;
  const module = {exports:{}};
  const code = ts.transpileModule(readFileSync(new URL('../utils/useKeyboardRecovery.ts',import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(code, {exports:module.exports, require:()=>({useEffect:fn=>setup=fn}), HTMLElement:Element, document:doc, window:win, clearTimeout:()=>{}});
  module.exports.useKeyboardRecovery(); cleanup=setup();
  doc.handlers.get('focusin')({target:input});
  assert.equal(root.style.getPropertyValue('height'),'852px');
  vv.height=480; vv.offsetTop=62; win.scrollY=20;
  vv.handlers.get('resize')();
  assert.equal(root.style.translate,'0 82px');
  doc.activeElement=null; vv.handlers.get('resize')();
  assert.equal(root.style.getPropertyValue('height'),'852px');
  vv.height=852; vv.offsetTop=0; vv.handlers.get('resize')();
  assert.equal(win.scrollY,0);
  assert.equal(root.style.getPropertyValue('height'),'100dvh');
  assert.equal(root.style.translate,'');
  cleanup();
  assert.equal(vv.handlers.size,0);
  assert.equal(doc.handlers.size,0);
});

test('temporary fields sit above the visual keyboard viewport with white focus styling', () => {
  const source=readFileSync(new URL('../components/KeyboardSafeInput.tsx',import.meta.url),'utf8');
  assert.match(source,/vv\.offsetTop \+ vv\.height/);
  assert.match(source,/bottom - panel\.current\.offsetHeight - 6/);
  assert.match(source,/preview\.width-16/);
  assert.match(source,/left-1\/2 -translate-x-1\/2/);
  assert.match(source,/caretColor: '#fff'/);
  assert.match(source,/fontSize: 16/);
  assert.match(source,/focus\(\{ preventScroll: true \}\)/);
});
