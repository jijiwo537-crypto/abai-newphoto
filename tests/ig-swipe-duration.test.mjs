import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../components/IgPreview.tsx', import.meta.url), 'utf8');
test('IG release duration is 1.5 times original without changing finger tracking', () => {
  assert.match(source, /duration = 450/);
  assert.match(source, /const duration = 1.5 \* Math.max\(290, Math.min\(430/);
  for (const remaining of [0, 50, 200, 500]) for (const v of [.1, .7, 2]) {
    const before = Math.max(290, Math.min(430, remaining / Math.max(.72, Math.abs(v) * .92)));
    assert.ok(1.5 * before >= 435 && 1.5 * before <= 645);
  }
});
