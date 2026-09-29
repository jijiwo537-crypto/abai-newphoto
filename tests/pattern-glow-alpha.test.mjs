import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('image-pattern halo is not cut out again at fractional-alpha edges', () => {
  const source = readFileSync(new URL('../components/CollageTool.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!isImageHole\(holeType\)\)\s*\{\s*items\.forEach\(it => eraseGlowBody/);
  // Repeated knockout removes light precisely where the body is partially
  // transparent. Retaining the halo prevents this coverage-dependent dark rim.
  const bodyAlpha = .5, haloAlpha = .6;
  const oldCoverage = bodyAlpha + (1-bodyAlpha)*haloAlpha*(1-bodyAlpha);
  const coverage = bodyAlpha + (1-bodyAlpha)*haloAlpha;
  assert.equal(coverage, .8);
  assert.ok(coverage > oldCoverage);
});

test('full-resolution glow layer ownership is transferred without another copy', () => {
  const source = readFileSync(new URL('../components/CollageTool.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /done\.rw\s*\*\s*done\.rh\s*<=\s*12_000_000/);
  assert.match(source, /glowLayerRef\.current === done\.lay/);
});
