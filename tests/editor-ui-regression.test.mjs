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
  assert.match(editor, /data-hsl-panel/);
  assert.match(editor, /data-curves-panel/);
  assert.match(editor, /ref={setDetailPanelHost}/);
  assert.match(editor, /height: activeCategory === 'compose' \? '0px' : '5rem'/);
});
test('compose divider is opt-in, preserving other callers', () => {
  assert.match(compose, /showFooterDivider = false/);
  assert.match(compose, /borderBottom: showFooterDivider/);
  assert.match(editor, /footerHeight={footerHeight}\s+showFooterDivider/);
});
test('export uses real MIME encoding and does not fake HEIC', () => {
  assert.match(editor, /exportFormat === 'jpg' \? 'image\/jpeg' : 'image\/png', 1/);
  assert.match(editor, /canExportHeic\(\)/);
  assert.match(editor, /exportHeic\(/);
});
test('home owns vertical overshoot without intercepting the recommendation carousel', () => {
  const guard = readFileSync(new URL('../utils/homeScroll.ts', import.meta.url), 'utf8');
  assert.match(home, /installHomeScroll\(sc\)/);
  assert.match(guard, /axis === 'y' && e.cancelable/);
  assert.match(guard, /el.scrollTop <= 0 && dy > 0/);
  assert.doesNotMatch(guard, /requestAnimationFrame|velocity/);
});
test('keyboard fields edit in a viewport-top portal rather than panning bottom toolbars', () => {
  const field = readFileSync(new URL('../components/KeyboardSafeInput.tsx', import.meta.url), 'utf8');
  assert.match(field, /createPortal/);
  assert.match(field, /focus\(\{ preventScroll: true \}\)/);
  assert.match(field, /fontSize: 16/);
  for (const name of ['CollageTool', 'GridLayoutTool']) {
    const tool = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), 'utf8');
    assert.match(tool, /<KeyboardSafeInput/);
  }
});
test('halation retains exact precomputed pixels and blur for strength/hue changes', () => {
  assert.match(editor, /fringeIntensity: _strength, fringeHue: _hue, fringeFeather: _feather/);
  assert.match(editor, /halationPreparedRef.current = \{ key: preparationKey, source: srcData, blurred: highImgData \}/);
  assert.match(editor, /TARGET_PROC_SIZE = 800/);
});
