import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const editor = readFileSync(new URL('../components/ImageEditor.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../components/HomePage.tsx', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../components/ComposeStudio.tsx', import.meta.url), 'utf8');
test('tool selection does not restart the pixel renderer', () => {
  assert.match(editor, /const activeToolId = activeToolIdRef.current/);
  assert.doesNotMatch(editor, /applyComplexEffects, activeToolId, getCurveLuts/);
  assert.match(editor, /performance.now\(\) - lastUiInputRef.current > 800/);
});
test('HSL and curves share a control-strip anchored portal', () => {
  assert.match(editor, /activeToolId === 'hsl' && detailPanelHost && createPortal/);
  assert.match(editor, /activeToolId === 'curves' && detailPanelHost && createPortal/);
  assert.match(editor, /ref={setDetailPanelHost}/);
  assert.match(editor, /height: activeCategory === 'compose' \? '0px' : \(fxPanel \? '11rem' : '5rem'\)/);
});
test('compose divider is opt-in, preserving other callers', () => {
  assert.match(compose, /showFooterDivider = false/);
  assert.match(compose, /borderBottom: showFooterDivider/);
  assert.match(editor, /footerHeight={footerHeight}\s+showFooterDivider/);
});
test('export uses real MIME encoding and does not fake HEIC', () => {
  assert.match(editor, /exportFormat === 'jpg' \? 'image\/jpeg' : 'image\/png', 1/);
  assert.match(editor, /<button disabled[^>]*>HEIC<\/button>/);
});
test('home edge guard checks the current boundary during each move', () => {
  const guard = home.slice(home.indexOf('const block = (e: TouchEvent)'), home.indexOf('const down = (e: TouchEvent)'));
  assert.match(guard, /const atTop = sc.scrollTop <= 0/);
  assert.match(guard, /e.cancelable/);
  assert.doesNotMatch(home, /if \(atTop \|\| atBottom\)/);
});
