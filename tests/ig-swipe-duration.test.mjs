import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../components/IgPreview.tsx', import.meta.url), 'utf8');
test('IG release duration is doubled without changing finger tracking', () => {
  assert.match(source, /duration = 600/);
  assert.match(source, /const duration = 2 \* Math.max\(290, Math.min\(430/);
  for (const remaining of [0, 50, 200, 500]) for (const v of [.1, .7, 2]) {
    const before = Math.max(290, Math.min(430, remaining / Math.max(.72, Math.abs(v) * .92)));
    assert.ok(2 * before >= 580 && 2 * before <= 860);
  }
});
